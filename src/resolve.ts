// Resolution: from the parsed Map (regions with declarations, impl blocks
// with bodies) to a flat list of complete items, plus the checks that the
// structure layer makes possible:
//
// - every action, query, view and invariant has exactly one body
// - an impl's signature matches its declaration
// - an item's kind is allowed in its region's kind (D21)
// - roads point at regions that exist
// - a body that reaches into another region follows a road (D21)
//
// Names of items are unique across the whole Map; regions group items,
// they do not namespace them.

import type * as ast from "./ast.ts";
import { printParams, printType } from "./outline.ts";

export class ResolveError extends Error {
  readonly span: ast.Span;
  constructor(message: string, span: ast.Span) {
    super(`${span.start.line}:${span.start.col}: ${message}`);
    this.span = span;
  }
}

export interface ResolvedRegion {
  name: string;
  path: string[];
  kind: ast.RegionKind | null;
  roads: ast.Road[];
  parent: ResolvedRegion | null;
  span: ast.Span;
}

type WithBody<T> = T extends { body: ast.Block | null } ? Omit<T, "body"> & { body: ast.Block } : T;
type Leaf = Exclude<ast.Item, ast.Region | ast.Impl>;
export type ResolvedItem = WithBody<Leaf>;

export interface ResolvedMap {
  name: string;
  regions: ResolvedRegion[];
  items: ResolvedItem[];
  // Region an item lives in, by item key; null for items outside any region.
  regionOf: Map<string, ResolvedRegion | null>;
}

// Which item kinds may live in which region kinds. Types and injections
// may live anywhere.
const PLACEMENT: Record<string, Set<string>> = {
  Client: new Set(["view"]),
  Service: new Set(["action", "query"]),
  Postgres: new Set(["state", "invariant"]),
  Store: new Set(["state", "invariant"]),
  External: new Set(["port"]),
  Outbound: new Set(["effect"]),
};
const ANYWHERE = new Set(["type", "opaque", "struct", "enum", "inject"]);

// Items are keyed by name; invariants, which have none, by description.
export function itemKey(item: Leaf): string {
  return item.kind === "invariant" ? `invariant ${JSON.stringify(item.description)}` : item.name;
}

export function resolve(map: ast.MapDecl): ResolvedMap {
  const regions: ResolvedRegion[] = [];
  const regionByPath = new Map<string, ResolvedRegion>();
  const declared = new Map<string, { item: Leaf; region: ResolvedRegion | null }>();
  const bodies = new Map<string, { item: Leaf; region: ResolvedRegion }>();

  // Pass 1: regions and their declarations.
  const collectRegion = (r: ast.Region, parent: ResolvedRegion | null) => {
    const path = [...(parent?.path ?? []), r.name];
    const key = path.join("::");
    if (regionByPath.has(key)) throw new ResolveError(`duplicate region ${key}`, r.span);
    const region: ResolvedRegion = { name: r.name, path, kind: r.regionKind, roads: r.roads, parent, span: r.span };
    if (region.kind && !PLACEMENT[region.kind.name]) {
      throw new ResolveError(`unknown region kind ${region.kind.name}`, region.kind.span);
    }
    regions.push(region);
    regionByPath.set(key, region);
    for (const item of r.items) {
      if (item.kind === "region") collectRegion(item, region);
      else if (item.kind === "impl") throw new ResolveError("impl blocks belong at the top level", item.span);
      else declare(item, region);
    }
  };
  const declare = (item: Leaf, region: ResolvedRegion | null) => {
    const key = itemKey(item);
    if (declared.has(key)) throw new ResolveError(`duplicate item ${key}`, item.span);
    declared.set(key, { item, region });
    if (region?.kind) {
      const allowed = PLACEMENT[region.kind.name]!;
      if (!allowed.has(item.kind) && !ANYWHERE.has(item.kind)) {
        const article = /^[aeiou]/.test(item.kind) ? "an" : "a";
        throw new ResolveError(
          `${article} ${item.kind} cannot live in region ${region.path.join("::")} of kind ${region.kind.name}`,
          item.span,
        );
      }
    }
  };
  for (const item of map.items) {
    if (item.kind === "region") collectRegion(item, null);
    else if (item.kind !== "impl") declare(item, null);
  }

  // Pass 2: impl blocks supply bodies.
  for (const item of map.items) {
    if (item.kind !== "impl") continue;
    const region = regionByPath.get(item.path.join("::"));
    if (!region) throw new ResolveError(`impl of unknown region ${item.path.join("::")}`, item.span);
    for (const inner of item.items) {
      if (inner.kind === "region" || inner.kind === "impl") {
        throw new ResolveError(`an impl block cannot contain a ${inner.kind}`, inner.span);
      }
      if (!hasBody(inner)) throw new ResolveError(`only actions, queries, views and invariants go in impl blocks`, inner.span);
      const key = itemKey(inner);
      const decl = declared.get(key);
      if (!decl) throw new ResolveError(`${key} is not declared in region ${region.path.join("::")}`, inner.span);
      if (decl.region !== region) {
        throw new ResolveError(`${key} is declared in region ${decl.region?.path.join("::") ?? "(none)"}, not ${region.path.join("::")}`, inner.span);
      }
      if (inner.body === null) throw new ResolveError(`${key} has no body in impl ${region.path.join("::")}`, inner.span);
      if (signature(decl.item) !== signature(inner)) {
        throw new ResolveError(`signature of ${key} differs from its declaration: ${signature(inner)} vs ${signature(decl.item)}`, inner.span);
      }
      if (bodies.has(key) || (hasBody(decl.item) && decl.item.body !== null)) {
        throw new ResolveError(`${key} has more than one body`, inner.span);
      }
      bodies.set(key, { item: inner, region });
    }
  }

  // Pass 3: assemble complete items.
  const items: ResolvedItem[] = [];
  const regionOf = new Map<string, ResolvedRegion | null>();
  for (const [key, { item, region }] of declared) {
    let complete: Leaf = item;
    if (hasBody(item) && item.body === null) {
      const b = bodies.get(key);
      if (!b) throw new ResolveError(`${key} is declared but never defined; add it to an impl block`, item.span);
      complete = { ...item, body: (b.item as typeof item).body };
    }
    items.push(complete as ResolvedItem);
    regionOf.set(key, region);
  }

  // Pass 4: roads exist, and cross-region references follow them.
  for (const region of regions) {
    for (const road of region.roads) {
      if (!regionByPath.has(road.to.join("::"))) {
        throw new ResolveError(`road ${road.name} points at unknown region ${road.to.join("::")}`, road.span);
      }
    }
  }
  const resolved: ResolvedMap = { name: map.name, regions, items, regionOf };
  for (const item of items) {
    const from = regionOf.get(itemKey(item)) ?? null;
    if (!from || !hasBody(item)) continue;
    for (const ref of freeNames(item)) {
      const target = declared.get(ref.name);
      if (!target || !target.region || target.region === from) continue;
      if (!connected(from, target.region, regionByPath)) {
        throw new ResolveError(
          `${itemKey(item)} in region ${from.path.join("::")} uses ${ref.name} from region ${target.region.path.join("::")}, but no road leads there`,
          ref.span,
        );
      }
    }
  }
  return resolved;
}

function hasBody(item: Leaf): item is ast.Action | ast.Query | ast.View | ast.Invariant {
  return item.kind === "action" || item.kind === "query" || item.kind === "view" || item.kind === "invariant";
}

function signature(item: Leaf): string {
  switch (item.kind) {
    case "action":
    case "query":
      return `${printParams(item.params)} -> ${printType(item.returns)}`;
    case "view":
      return printParams(item.params);
    default:
      return "";
  }
}

// `from` may reach `to` when one contains the other, or when a road from
// `from` (or an enclosing region) leads to `to` (or an enclosing region).
function connected(from: ResolvedRegion, to: ResolvedRegion, byPath: Map<string, ResolvedRegion>): boolean {
  const contains = (outer: ResolvedRegion, inner: ResolvedRegion) => {
    for (let r: ResolvedRegion | null = inner; r; r = r.parent) if (r === outer) return true;
    return false;
  };
  if (contains(from, to) || contains(to, from)) return true;
  for (let src: ResolvedRegion | null = from; src; src = src.parent) {
    for (const road of src.roads) {
      const dst = byPath.get(road.to.join("::"));
      if (dst && contains(dst, to)) return true;
    }
  }
  return false;
}

// Single-segment names used in an item's body that are not bound locally.
// These are the item's references to other items (state, actions, ports,
// effects, views...). Locals shadow items, as in the interpreter.
function freeNames(item: ast.Action | ast.Query | ast.View | ast.Invariant): { name: string; span: ast.Span }[] {
  const out: { name: string; span: ast.Span }[] = [];
  const bound: Set<string>[] = [new Set("params" in item ? item.params.map((p) => p.name) : [])];
  const isBound = (n: string) => bound.some((s) => s.has(n));
  const scoped = (f: () => void) => {
    bound.push(new Set());
    f();
    bound.pop();
  };
  const bindPattern = (p: ast.Pattern) => {
    if (p.kind === "bind") bound[bound.length - 1]!.add(p.name);
    else if (p.kind === "path") p.args.forEach(bindPattern);
  };
  const block = (b: ast.Block) => scoped(() => b.stmts.forEach(stmt));
  const stmt = (s: ast.Stmt) => {
    switch (s.kind) {
      case "let":
        expr(s.value);
        if (s.orElse) expr(s.orElse);
        bindPattern(s.pattern);
        break;
      case "requires":
        expr(s.condition);
        expr(s.orElse);
        break;
      case "assign":
        expr(s.target);
        expr(s.value);
        break;
      case "for":
        expr(s.iterable);
        scoped(() => {
          bindPattern(s.pattern);
          block(s.body);
        });
        break;
      case "expr":
        expr(s.expr);
        if (s.children) block(s.children);
        break;
    }
  };
  const expr = (e: ast.Expr): void => {
    switch (e.kind) {
      case "path":
        if (e.segments.length === 1 && !isBound(e.segments[0]!)) out.push({ name: e.segments[0]!, span: e.span });
        return;
      case "struct":
        out.push({ name: e.path.segments.join("::"), span: e.path.span });
        e.fields.forEach((f) => expr(f.value));
        return;
      case "emit":
        return expr(e.effect);
      case "call":
        expr(e.callee);
        e.args.forEach((a) => expr(a.value));
        return;
      case "method":
        expr(e.receiver);
        e.args.forEach((a) => expr(a.value));
        return;
      case "field":
        return expr(e.object);
      case "index":
        expr(e.object);
        return expr(e.index);
      case "unary":
        return expr(e.operand);
      case "binary":
        expr(e.left);
        return expr(e.right);
      case "range":
        expr(e.start);
        return expr(e.end);
      case "closure":
        return scoped(() => {
          e.params.forEach((p) => bound[bound.length - 1]!.add(p.name));
          expr(e.body);
        });
      case "if":
        expr(e.condition);
        block(e.then);
        if (e.otherwise) "kind" in e.otherwise ? expr(e.otherwise) : block(e.otherwise);
        return;
      case "match":
        expr(e.scrutinee);
        for (const arm of e.arms) {
          scoped(() => {
            bindPattern(arm.pattern);
            expr(arm.body);
          });
        }
        return;
      case "block":
        return block(e.block);
      default:
        return;
    }
  };
  if (item.body) block(item.body);
  return out;
}
