// The Nindub interpreter: runs a Map on its own, with no Terrain.
//
// A Runtime holds the Map's state and answers calls to its actions, queries
// and views. Every call returns an Observation (D6): the result, the
// effects emitted, and the requests made to ports. Nondeterminism (ids,
// the clock, port responses) is injected by whoever constructs the
// Runtime (D8), so two Runtimes given the same inputs behave identically.

import type * as ast from "./ast.ts";
import { resolve, type ResolvedItem, type ResolvedMap } from "./resolve.ts";
import {
  type Element,
  type Env,
  type Value,
  UNIT,
  NONE,
  bool,
  describe,
  emptyTable,
  equal,
  err,
  int,
  isVariant,
  keyOf,
  ok,
  rowKey,
  some,
  struct,
  text,
  toText,
  truthy,
  variant,
  vec,
} from "./values.ts";

export class RuntimeError extends Error {
  readonly span: ast.Span | null;
  constructor(message: string, span: ast.Span | null = null) {
    super(span ? `${span.start.line}:${span.start.col}: ${message}` : message);
    this.span = span;
  }
}

// An invariant failed after an action. This is a bug in the Map, not a
// failure of the action, and it is reported separately.
export class InvariantViolation extends RuntimeError {
  readonly invariant: string;
  constructor(description: string, span: ast.Span) {
    super(`invariant violated: ${description}`, span);
    this.invariant = description;
  }
}

export interface PortRequest {
  port: string;
  fn: string;
  args: Value[];
  response: Value;
}

export interface Observation {
  kind: "action" | "query" | "view";
  name: string;
  args: Value[];
  result: Value;
  effects: Value[]; // struct values, one per `emit`
  ports: PortRequest[];
  // The injected values this call consumed, in order. Survey hands the same
  // values to the Terrain so that both sides see the same world (D8).
  injected: { clock: bigint[]; ids: string[] };
}

export interface Injections {
  // Called for `clock.now()`. Return milliseconds or any monotone bigint.
  clock?: () => bigint;
  // Called for `ids.fresh()`.
  ids?: () => string;
  // Called for `Port.fn(args)`. Must return the Map-level value the port
  // declares (usually a Result).
  ports?: (port: string, fn: string, args: Value[]) => Value;
}

// Early return out of an action or query body (`requires ... else`,
// `let ... else`).
class ReturnSignal {
  readonly value: Value;
  constructor(value: Value) {
    this.value = value;
  }
}

interface Frame {
  observation: Observation;
  // Set while rendering a view: element-producing statements append here.
  sink: Element[] | null;
}

export class Runtime {
  readonly map: ast.MapDecl;
  readonly resolved: ResolvedMap;
  private readonly items = new Map<string, ResolvedItem>();
  private readonly enums = new Map<string, ast.Enum>();
  private readonly structs = new Map<string, ast.Struct>();
  private readonly effects = new Map<string, ast.Effect>();
  private readonly state = new Map<string, Value>();
  private readonly injections: Required<Injections>;
  private frames: Frame[] = [];

  constructor(map: ast.MapDecl, injections: Injections = {}) {
    this.map = map;
    let tick = 0n;
    let counter = 0;
    this.injections = {
      clock: injections.clock ?? (() => tick++),
      ids: injections.ids ?? (() => `id-${++counter}`),
      ports:
        injections.ports ??
        ((port, fn) => {
          throw new RuntimeError(`no response injected for ${port}.${fn}`);
        }),
    };
    this.resolved = resolve(map);
    for (const item of this.resolved.items) {
      if ("name" in item) this.items.set(item.name, item);
      if (item.kind === "enum") this.enums.set(item.name, item);
      if (item.kind === "struct") this.structs.set(item.name, item);
      if (item.kind === "effect") this.effects.set(item.name, item);
      if (item.kind === "state") this.state.set(item.name, this.initialState(item.type));
    }
  }

  private initialState(type: ast.Type): Value {
    if (type.kind === "named" && type.name === "Table") return emptyTable();
    if (type.kind === "named" && type.name === "Vec") return vec([]);
    if (type.kind === "named" && type.name === "Option") return NONE;
    throw new RuntimeError(`state of type ${type.kind === "named" ? type.name : "()"} needs an initial value`, type.span);
  }

  // ---------------------------------------------------------------- public API

  /** Current state, by name. */
  getState(name: string): Value {
    const v = this.state.get(name);
    if (!v) throw new RuntimeError(`no state ${name}`);
    return v;
  }

  /** Names of actions, queries and views, for tooling. */
  callables(): { name: string; kind: "action" | "query" | "view"; params: ast.Param[] }[] {
    const out: { name: string; kind: "action" | "query" | "view"; params: ast.Param[] }[] = [];
    for (const item of this.resolved.items) {
      if (item.kind === "action" || item.kind === "query" || item.kind === "view") {
        out.push({ name: item.name, kind: item.kind, params: item.params });
      }
    }
    return out;
  }

  /** Call an action, query or view by name. */
  call(name: string, args: Value[]): Observation {
    const item = this.items.get(name);
    if (!item || (item.kind !== "action" && item.kind !== "query" && item.kind !== "view")) {
      throw new RuntimeError(`no action, query or view named ${name}`);
    }
    if (args.length !== item.params.length) {
      throw new RuntimeError(`${name} takes ${item.params.length} arguments, got ${args.length}`, item.span);
    }
    const observation: Observation = {
      kind: item.kind,
      name,
      args,
      result: UNIT,
      effects: [],
      ports: [],
      injected: { clock: [], ids: [] },
    };
    const frame: Frame = { observation, sink: item.kind === "view" ? [] : null };
    this.frames.push(frame);
    const snapshot = new Map(this.state);
    try {
      const env = this.rootEnv();
      item.params.forEach((p, i) => env.vars.set(p.name, args[i]!));
      if (item.kind === "view") {
        this.execBlock(item.body, env);
        observation.result = vec(frame.sink!.map((e) => ({ t: "element", element: e })));
      } else {
        observation.result = this.evalBody(item.body, env);
      }
      if (item.kind === "action") {
        if (isVariant(observation.result, "Result", "Err")) {
          // A failed action changes nothing: state and effects roll back.
          this.restore(snapshot);
          observation.effects = [];
        } else {
          this.checkInvariants();
        }
      }
      return observation;
    } catch (e) {
      this.restore(snapshot);
      throw e;
    } finally {
      this.frames.pop();
    }
  }

  /** Evaluate an expression at top level (REPL). Calls run for real. */
  evalTop(expr: ast.Expr): Value {
    return this.evalExpr(expr, this.rootEnv());
  }

  // ---------------------------------------------------------------- environment

  private rootEnv(): Env {
    return { vars: new Map(), parent: null };
  }

  private child(env: Env): Env {
    return { vars: new Map(), parent: env };
  }

  private lookup(env: Env, name: string): Value | undefined {
    for (let e: Env | null = env; e; e = e.parent) {
      const v = e.vars.get(name);
      if (v) return v;
    }
    return undefined;
  }

  private frame(): Frame {
    const f = this.frames[this.frames.length - 1];
    if (!f) throw new RuntimeError("not inside a call");
    return f;
  }

  private restore(snapshot: Map<string, Value>) {
    for (const [k, v] of snapshot) this.state.set(k, v);
  }

  /** Names of state cells, for tooling. */
  states(): string[] {
    return [...this.state.keys()];
  }

  private checkInvariants() {
    for (const item of this.resolved.items) {
      if (item.kind !== "invariant") continue;
      const v = this.evalBody(item.body, this.rootEnv());
      if (!truthy(v)) throw new InvariantViolation(item.description, item.span);
    }
  }

  // ---------------------------------------------------------------- statements

  private evalBody(block: ast.Block, env: Env): Value {
    try {
      return this.evalBlock(block, env);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    }
  }

  // A block's value is its unterminated tail expression, else unit.
  private evalBlock(block: ast.Block, env: Env): Value {
    const scope = this.child(env);
    let last: Value = UNIT;
    for (const stmt of block.stmts) {
      last = this.execStmt(stmt, scope);
      if (stmt.kind !== "expr" || stmt.terminated) last = UNIT;
    }
    return last;
  }

  private execBlock(block: ast.Block, env: Env): void {
    this.evalBlock(block, env);
  }

  private execStmt(stmt: ast.Stmt, env: Env): Value {
    switch (stmt.kind) {
      case "let": {
        let value = this.evalExpr(stmt.value, env);
        if (stmt.orElse) {
          // `let x = e else err;` unwraps Some/Ok, or returns Err(err).
          if (isVariant(value, "Option", "Some") || isVariant(value, "Result", "Ok")) {
            value = value.payload[0]!;
          } else if (isVariant(value, "Option", "None") || isVariant(value, "Result", "Err")) {
            throw new ReturnSignal(err(this.evalExpr(stmt.orElse, env)));
          } else {
            throw new RuntimeError(`let-else needs an Option or Result, got ${describe(value)}`, stmt.value.span);
          }
        }
        if (!this.bind(stmt.pattern, value, env)) {
          throw new RuntimeError("pattern does not match", stmt.pattern.span);
        }
        return UNIT;
      }
      case "requires": {
        if (!truthy(this.evalExpr(stmt.condition, env))) {
          throw new ReturnSignal(err(this.evalExpr(stmt.orElse, env)));
        }
        return UNIT;
      }
      case "assign": {
        this.assign(stmt.target, this.evalExpr(stmt.value, env), env);
        return UNIT;
      }
      case "for": {
        const iterable = this.evalExpr(stmt.iterable, env);
        for (const item of this.iterate(iterable, stmt.iterable.span)) {
          const scope = this.child(env);
          if (!this.bind(stmt.pattern, item, scope)) {
            throw new RuntimeError("pattern does not match", stmt.pattern.span);
          }
          this.execBlock(stmt.body, scope);
        }
        return UNIT;
      }
      case "expr": {
        let value = this.evalExpr(stmt.expr, env);
        if (stmt.children) {
          if (value.t !== "element" || value.element.kind !== "item") {
            throw new RuntimeError("only `item(...)` takes children", stmt.span);
          }
          const children = this.collect(() => this.execBlock(stmt.children!, env));
          value = { t: "element", element: { ...value.element, children } };
        }
        // In a view, an element in statement position is placed on the screen.
        const frame = this.frames[this.frames.length - 1];
        if (frame?.sink && value.t === "element" && (stmt.terminated || stmt.children)) {
          frame.sink.push(value.element);
        }
        return value;
      }
    }
  }

  // Run `f` with a fresh element sink and return what it collected.
  private collect(f: () => void): Element[] {
    const frame = this.frame();
    const saved = frame.sink;
    const sink: Element[] = [];
    frame.sink = sink;
    try {
      f();
    } finally {
      frame.sink = saved;
    }
    return sink;
  }

  private iterate(v: Value, span: ast.Span): Value[] {
    if (v.t === "vec") return v.items;
    if (v.t === "table") return [...v.rows.values()];
    if (v.t === "range") {
      const out: Value[] = [];
      const end = v.inclusive ? v.end : v.end - 1n;
      for (let i = v.start; i <= end; i++) out.push(int(i));
      return out;
    }
    throw new RuntimeError(`cannot iterate over ${describe(v)}`, span);
  }

  // `todos[id].done = true` — rebuild the value along the place chain and
  // store it back into the state cell at the root.
  private assign(target: ast.Expr, value: Value, env: Env): void {
    const root = this.placeRoot(target);
    if (this.lookup(env, root.segments[0]!)) {
      throw new RuntimeError("only state can be assigned to; locals are immutable", target.span);
    }
    if (!this.state.has(root.segments[0]!)) {
      throw new RuntimeError(`no state ${root.segments[0]}`, root.span);
    }
    const updated = this.update(target, value, env);
    this.state.set(root.segments[0]!, updated);
  }

  private placeRoot(e: ast.Expr): ast.Path {
    if (e.kind === "path") {
      if (e.segments.length !== 1) throw new RuntimeError("cannot assign to a path", e.span);
      return e;
    }
    if (e.kind === "field") return this.placeRoot(e.object);
    if (e.kind === "index") return this.placeRoot(e.object);
    throw new RuntimeError("not a place expression", e.span);
  }

  private update(place: ast.Expr, value: Value, env: Env): Value {
    switch (place.kind) {
      case "path":
        return value;
      case "field": {
        const obj = this.evalExpr(place.object, env);
        if (obj.t !== "struct") throw new RuntimeError(`cannot set field on ${describe(obj)}`, place.span);
        if (!(place.field in obj.fields)) {
          throw new RuntimeError(`${obj.name} has no field ${place.field}`, place.span);
        }
        return this.update(place.object, struct(obj.name, { ...obj.fields, [place.field]: value }), env);
      }
      case "index": {
        const table = this.evalExpr(place.object, env);
        if (table.t !== "table") throw new RuntimeError(`cannot index into ${describe(table)}`, place.span);
        const key = keyOf(this.evalExpr(place.index, env));
        if (!table.rows.has(key)) throw new RuntimeError("no such row", place.index.span);
        const rows = new Map(table.rows);
        rows.set(key, value);
        return this.update(place.object, { t: "table", rows }, env);
      }
      default:
        throw new RuntimeError("not a place expression", place.span);
    }
  }

  // ---------------------------------------------------------------- patterns

  private bind(pattern: ast.Pattern, value: Value, env: Env): boolean {
    switch (pattern.kind) {
      case "wildcard":
        return true;
      case "bind":
        env.vars.set(pattern.name, value);
        return true;
      case "path": {
        const variantName = pattern.segments[pattern.segments.length - 1]!;
        if (value.t !== "enum" || value.variant !== variantName) return false;
        if (pattern.segments.length === 2 && value.name !== pattern.segments[0]) return false;
        if (pattern.args.length !== value.payload.length) return false;
        return pattern.args.every((p, i) => this.bind(p, value.payload[i]!, env));
      }
    }
  }

  // ---------------------------------------------------------------- expressions

  private evalExpr(e: ast.Expr, env: Env): Value {
    switch (e.kind) {
      case "unit":
        return UNIT;
      case "int":
        return int(e.value);
      case "string":
        return text(e.value);
      case "bool":
        return bool(e.value);
      case "path":
        return this.evalPath(e, env);
      case "struct":
        return this.evalStructLit(e, env);
      case "call":
        return this.evalCall(e, env);
      case "method":
        return this.evalMethod(e, env);
      case "field": {
        const obj = this.evalExpr(e.object, env);
        if (obj.t !== "struct") throw new RuntimeError(`cannot read field of ${describe(obj)}`, e.span);
        const v = obj.fields[e.field];
        if (!v) throw new RuntimeError(`${obj.name} has no field ${e.field}`, e.span);
        return v;
      }
      case "index": {
        const table = this.evalExpr(e.object, env);
        if (table.t !== "table") throw new RuntimeError(`cannot index into ${describe(table)}`, e.span);
        const row = table.rows.get(keyOf(this.evalExpr(e.index, env)));
        if (!row) throw new RuntimeError("no such row", e.index.span);
        return row;
      }
      case "unary": {
        const v = this.evalExpr(e.operand, env);
        if (e.op === "!") return bool(!truthy(v));
        if (v.t !== "int") throw new RuntimeError(`cannot negate ${describe(v)}`, e.span);
        return int(-v.v);
      }
      case "binary":
        return this.evalBinary(e, env);
      case "range": {
        const s = this.evalExpr(e.start, env);
        const t = this.evalExpr(e.end, env);
        if (s.t !== "int" || t.t !== "int") throw new RuntimeError("range bounds must be ints", e.span);
        return { t: "range", start: s.v, end: t.v, inclusive: e.inclusive };
      }
      case "closure":
        return { t: "closure", params: e.params, body: e.body, env };
      case "if": {
        if (truthy(this.evalExpr(e.condition, env))) return this.evalBlock(e.then, env);
        if (!e.otherwise) return UNIT;
        return "kind" in e.otherwise ? this.evalExpr(e.otherwise, env) : this.evalBlock(e.otherwise, env);
      }
      case "match": {
        const v = this.evalExpr(e.scrutinee, env);
        for (const arm of e.arms) {
          const scope = this.child(env);
          if (this.bind(arm.pattern, v, scope)) return this.evalExpr(arm.body, scope);
        }
        throw new RuntimeError(`no match arm for ${describe(v)}`, e.span);
      }
      case "block":
        return this.evalBlock(e.block, env);
      case "emit": {
        const effect = this.evalStructLit(e.effect, env);
        if (effect.t !== "struct" || !this.effects.has(effect.name)) {
          throw new RuntimeError(`emit needs an effect, got ${describe(effect)}`, e.span);
        }
        this.frame().observation.effects.push(effect);
        return UNIT;
      }
    }
  }

  private evalPath(e: ast.Path, env: Env): Value {
    if (e.segments.length === 2) {
      const [enumName, variantName] = e.segments as [string, string];
      const en = this.enums.get(enumName);
      if (!en) throw new RuntimeError(`no enum ${enumName}`, e.span);
      const v = en.variants.find((x) => x.name === variantName);
      if (!v) throw new RuntimeError(`${enumName} has no variant ${variantName}`, e.span);
      return v.fields.length === 0 ? variant(enumName, variantName) : { t: "variantCtor", name: enumName, variant: variantName };
    }
    if (e.segments.length !== 1) throw new RuntimeError("unsupported path", e.span);
    const name = e.segments[0]!;
    const local = this.lookup(env, name);
    if (local) return local;
    const state = this.state.get(name);
    if (state) return state;
    const item = this.items.get(name);
    if (item) {
      switch (item.kind) {
        case "inject":
          return { t: "injected", name, type: item.type.kind === "named" ? item.type.name : "()" };
        case "port":
          return { t: "port", name };
        case "action":
        case "query":
        case "view":
          return { t: "fn", name, kind: item.kind };
        default:
          throw new RuntimeError(`${item.kind} ${name} is not a value`, e.span);
      }
    }
    switch (name) {
      case "None":
        return NONE;
      case "Ok":
        return { t: "variantCtor", name: "Result", variant: "Ok" };
      case "Err":
        return { t: "variantCtor", name: "Result", variant: "Err" };
      case "Some":
        return { t: "variantCtor", name: "Option", variant: "Some" };
      case "heading":
      case "text":
      case "item":
      case "button":
      case "form":
      case "link":
        return { t: "fn", name, kind: "builtin" };
    }
    throw new RuntimeError(`unknown name ${name}`, e.span);
  }

  private evalStructLit(e: ast.StructLit, env: Env): Value {
    const name = e.path.segments.join("::");
    const decl = this.structs.get(name) ?? this.effects.get(name);
    if (!decl) throw new RuntimeError(`no struct or effect ${name}`, e.span);
    const fields: Record<string, Value> = {};
    for (const f of e.fields) {
      if (!decl.fields.some((d) => d.name === f.name)) {
        throw new RuntimeError(`${name} has no field ${f.name}`, f.span);
      }
      fields[f.name] = this.evalExpr(f.value, env);
    }
    for (const d of decl.fields) {
      if (!(d.name in fields)) throw new RuntimeError(`missing field ${d.name} in ${name}`, e.span);
    }
    return struct(name, fields);
  }

  private evalArgs(args: ast.Arg[], env: Env): { positional: Value[]; named: Record<string, Value> } {
    const positional: Value[] = [];
    const named: Record<string, Value> = {};
    for (const a of args) {
      const v = this.evalExpr(a.value, env);
      if (a.name === null) positional.push(v);
      else named[a.name] = v;
    }
    return { positional, named };
  }

  private evalCall(e: ast.Call, env: Env): Value {
    const callee = this.evalExpr(e.callee, env);
    const { positional, named } = this.evalArgs(e.args, env);

    if (callee.t === "variantCtor") {
      return variant(callee.name, callee.variant, positional);
    }
    if (callee.t === "closure") {
      return this.applyClosure(callee, positional, e.span);
    }
    if (callee.t !== "fn") throw new RuntimeError(`cannot call ${describe(callee)}`, e.span);

    if (callee.kind === "builtin") return this.evalElement(callee.name, positional, named, e.span);

    // At top level (REPL) every call runs for real and returns its result.
    const top = this.frames.length === 0;
    const inView = !top && this.frame().sink !== null;
    if (callee.kind === "action") {
      // Inside a view, an action call is an affordance, not an execution.
      if (inView) return { t: "actionRef", name: callee.name, args: positional };
    }
    if (callee.kind === "view") {
      if (inView) return { t: "viewRef", name: callee.name, args: positional };
      if (!top) throw new RuntimeError("a view can only be referenced from another view", e.span);
    }
    if (top) return this.call(callee.name, positional).result;
    return this.invoke(callee.name, positional, e.span);
  }

  // Call an action or query from within a body: its observation is folded
  // into the current one.
  private invoke(name: string, args: Value[], span: ast.Span): Value {
    const parent = this.frame().observation;
    const obs = this.call(name, args);
    parent.effects.push(...obs.effects);
    parent.ports.push(...obs.ports);
    parent.injected.clock.push(...obs.injected.clock);
    parent.injected.ids.push(...obs.injected.ids);
    if (obs.kind === "action" && span) {
      // Actions called from other actions are allowed; from queries they
      // would mutate state through a read, so refuse.
      if (parent.kind === "query" || parent.kind === "view") {
        throw new RuntimeError(`a ${parent.kind} cannot call action ${name}`, span);
      }
    }
    return obs.result;
  }

  private applyClosure(c: Extract<Value, { t: "closure" }>, args: Value[], span: ast.Span): Value {
    if (args.length !== c.params.length) {
      throw new RuntimeError(`closure takes ${c.params.length} arguments, got ${args.length}`, span);
    }
    const scope = this.child(c.env);
    c.params.forEach((p, i) => scope.vars.set(p.name, args[i]!));
    return this.evalExpr(c.body, scope);
  }

  private evalElement(name: string, args: Value[], named: Record<string, Value>, span: ast.Span): Value {
    if (this.frame().sink === null) throw new RuntimeError(`${name}(...) is only valid inside a view`, span);
    const textArg = (i: number) => {
      const v = args[i];
      if (!v) throw new RuntimeError(`${name} needs a text argument`, span);
      return toText(v);
    };
    let element: Element;
    switch (name) {
      case "heading":
      case "text":
        element = { kind: name, text: textArg(0) };
        break;
      case "item":
        element = { kind: "item", text: textArg(0), attrs: named, children: [] };
        break;
      case "button": {
        const action = args[1];
        if (!action || action.t !== "actionRef") throw new RuntimeError("button needs an action", span);
        element = { kind: "button", label: textArg(0), action, then: null };
        break;
      }
      case "form": {
        const submit = args[1];
        if (!submit || submit.t !== "closure") throw new RuntimeError("form needs a closure", span);
        const fields = submit.params.map((p) => ({
          name: p.name,
          type: p.type?.kind === "named" ? p.type.name : "()",
        }));
        element = { kind: "form", label: textArg(0), fields, submit };
        break;
      }
      case "link": {
        const to = args[1];
        if (!to || to.t !== "viewRef") throw new RuntimeError("link needs a view", span);
        element = { kind: "link", label: textArg(0), to };
        break;
      }
      default:
        throw new RuntimeError(`unknown element ${name}`, span);
    }
    return { t: "element", element };
  }

  private evalMethod(e: ast.MethodCall, env: Env): Value {
    const recv = this.evalExpr(e.receiver, env);
    const { positional: args } = this.evalArgs(e.args, env);
    const m = e.method;
    const need = (n: number) => {
      if (args.length !== n) throw new RuntimeError(`${m} takes ${n} arguments, got ${args.length}`, e.span);
    };
    const closureArg = (i: number) => {
      const c = args[i];
      if (!c || c.t !== "closure") throw new RuntimeError(`${m} needs a closure`, e.span);
      return (v: Value) => this.applyClosure(c, [v], e.span);
    };

    switch (recv.t) {
      case "injected": {
        if (recv.type === "Clock" && m === "now") {
          need(0);
          const v = this.injections.clock();
          this.frame().observation.injected.clock.push(v);
          return { t: "instant", v };
        }
        if (recv.type === "IdSource" && m === "fresh") {
          need(0);
          const v = this.injections.ids();
          this.frame().observation.injected.ids.push(v);
          return { t: "id", v };
        }
        break;
      }
      case "port": {
        const decl = this.items.get(recv.name);
        if (!decl || decl.kind !== "port") throw new RuntimeError(`no port ${recv.name}`, e.span);
        const sig = decl.fns.find((f) => f.name === m);
        if (!sig) throw new RuntimeError(`port ${recv.name} has no fn ${m}`, e.span);
        need(sig.params.length);
        const response = this.injections.ports(recv.name, m, args);
        this.frame().observation.ports.push({ port: recv.name, fn: m, args, response });
        return response;
      }
      case "table": {
        const rows = recv.rows;
        switch (m) {
          case "get": {
            need(1);
            const row = rows.get(keyOf(args[0]!));
            return row ? some(row) : NONE;
          }
          case "contains":
            need(1);
            return bool(rows.has(keyOf(args[0]!)));
          case "insert": {
            need(1);
            const next = new Map(rows);
            next.set(rowKey(args[0]!), args[0]!);
            return this.replaceState(e.receiver, { t: "table", rows: next }, env);
          }
          case "remove": {
            need(1);
            const next = new Map(rows);
            next.delete(keyOf(args[0]!));
            return this.replaceState(e.receiver, { t: "table", rows: next }, env);
          }
          case "len":
            need(0);
            return int(rows.size);
          case "is_empty":
            need(0);
            return bool(rows.size === 0);
          default:
            return this.seqMethod([...rows.values()], m, args, closureArg, e.span);
        }
      }
      case "vec":
        return this.seqMethod(recv.items, m, args, closureArg, e.span);
      case "text":
        if (m === "len") {
          need(0);
          return int([...recv.v].length);
        }
        if (m === "is_empty") {
          need(0);
          return bool(recv.v.length === 0);
        }
        break;
      case "range":
        if (m === "contains") {
          need(1);
          const x = args[0]!;
          if (x.t !== "int") throw new RuntimeError("range.contains needs an int", e.span);
          return bool(x.v >= recv.start && (recv.inclusive ? x.v <= recv.end : x.v < recv.end));
        }
        break;
      case "enum":
        if (recv.name === "Option" || recv.name === "Result") {
          const isSome = recv.variant === "Some" || recv.variant === "Ok";
          if (m === "is_some" || m === "is_ok") return bool(isSome);
          if (m === "is_none" || m === "is_err") return bool(!isSome);
          if (m === "unwrap_or") {
            need(1);
            return isSome ? recv.payload[0]! : args[0]!;
          }
        }
        break;
      case "element":
        if (m === "then" && recv.element.kind === "button") {
          need(1);
          const to = args[0]!;
          if (to.t !== "viewRef") throw new RuntimeError("then needs a view", e.span);
          return { t: "element", element: { ...recv.element, then: to } };
        }
        break;
    }
    throw new RuntimeError(`${describe(recv)} has no method ${m}`, e.span);
  }

  // `todos.insert(x)` mutates the state cell the receiver names.
  private replaceState(receiver: ast.Expr, value: Value, env: Env): Value {
    if (receiver.kind !== "path" || receiver.segments.length !== 1 || !this.state.has(receiver.segments[0]!)) {
      throw new RuntimeError("only a state Table can be modified", receiver.span);
    }
    if (this.lookup(env, receiver.segments[0]!)) {
      throw new RuntimeError("a local shadows this state; locals are immutable", receiver.span);
    }
    this.state.set(receiver.segments[0]!, value);
    return UNIT;
  }

  private seqMethod(
    items: Value[],
    m: string,
    args: Value[],
    closureArg: (i: number) => (v: Value) => Value,
    span: ast.Span,
  ): Value {
    switch (m) {
      case "filter":
        return vec(items.filter((x) => truthy(closureArg(0)(x))));
      case "map":
        return vec(items.map((x) => closureArg(0)(x)));
      case "all":
        return bool(items.every((x) => truthy(closureArg(0)(x))));
      case "any":
        return bool(items.some((x) => truthy(closureArg(0)(x))));
      case "unique_by": {
        const f = closureArg(0);
        const seen: Value[] = [];
        for (const x of items) {
          const k = f(x);
          if (seen.some((s) => equal(s, k))) return bool(false);
          seen.push(k);
        }
        return bool(true);
      }
      case "sorted_by": {
        const f = closureArg(0);
        const keyed = items.map((x) => ({ x, k: f(x) }));
        keyed.sort((a, b) => this.compare(a.k, b.k, span));
        return vec(keyed.map((p) => p.x));
      }
      case "len":
        return int(items.length);
      case "is_empty":
        return bool(items.length === 0);
      case "contains":
        return bool(items.some((x) => equal(x, args[0]!)));
      case "first":
        return items[0] ? some(items[0]) : NONE;
      default:
        throw new RuntimeError(`no method ${m} on a sequence`, span);
    }
  }

  private compare(a: Value, b: Value, span: ast.Span): number {
    if ((a.t === "int" || a.t === "instant") && (b.t === "int" || b.t === "instant")) {
      return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    }
    if ((a.t === "text" || a.t === "id") && (b.t === "text" || b.t === "id")) {
      return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    }
    if (a.t === "bool" && b.t === "bool") return Number(a.v) - Number(b.v);
    throw new RuntimeError(`cannot compare ${describe(a)} with ${describe(b)}`, span);
  }

  private evalBinary(e: ast.Binary, env: Env): Value {
    if (e.op === "&&") {
      return bool(truthy(this.evalExpr(e.left, env)) && truthy(this.evalExpr(e.right, env)));
    }
    if (e.op === "||") {
      return bool(truthy(this.evalExpr(e.left, env)) || truthy(this.evalExpr(e.right, env)));
    }
    const l = this.evalExpr(e.left, env);
    const r = this.evalExpr(e.right, env);
    switch (e.op) {
      case "==":
        return bool(equal(l, r));
      case "!=":
        return bool(!equal(l, r));
      case "<":
        return bool(this.compare(l, r, e.span) < 0);
      case "<=":
        return bool(this.compare(l, r, e.span) <= 0);
      case ">":
        return bool(this.compare(l, r, e.span) > 0);
      case ">=":
        return bool(this.compare(l, r, e.span) >= 0);
      case "+":
        if (l.t === "text") return text(l.v + toText(r));
        if (l.t === "int" && r.t === "int") return int(l.v + r.v);
        if (l.t === "instant" && r.t === "int") return { t: "instant", v: l.v + r.v };
        break;
      case "-":
        if (l.t === "int" && r.t === "int") return int(l.v - r.v);
        if (l.t === "instant" && r.t === "int") return { t: "instant", v: l.v - r.v };
        if (l.t === "instant" && r.t === "instant") return int(l.v - r.v);
        break;
      case "*":
        if (l.t === "int" && r.t === "int") return int(l.v * r.v);
        break;
      case "/":
        if (l.t === "int" && r.t === "int") {
          if (r.v === 0n) throw new RuntimeError("division by zero", e.span);
          return int(l.v / r.v);
        }
        break;
    }
    throw new RuntimeError(`cannot apply ${e.op} to ${describe(l)} and ${describe(r)}`, e.span);
  }
}
