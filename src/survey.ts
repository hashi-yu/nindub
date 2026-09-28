// Survey: feed the same sequence of calls to the Map and a Terrain and
// compare their Observations (D6). Exploratory, not proof (D12).
//
// For each step Survey runs the Map first, so that the injected values
// the Map consumed (clock, ids) and the port responses it received can be
// handed to the Terrain for the same step (D8). Then it compares three
// channels: result, effects, port requests.
//
// With `plan`, Survey uses the Map to choose what to do next instead of
// picking at random. Two rules:
//
// - Every cell an action wrote is a debt until a query has read it on both
//   sides, and a debt is read before anything can overwrite it. Queries are
//   pure, so candidates are tried on the Map itself. This finds a Drift at
//   the first step where the Terrain's output could show it, and names the
//   step that wrote the cell.
// - Otherwise a few candidate actions are tried on a fork of the Map, and
//   the one that does something new is made. "New" is a transition not
//   seen in this run: the action, the branches it took, and the shape of
//   what it wrote (how many lines a cart has, which status an order is in).
//   Random picks rarely build the states a Drift hides in (a cart with two
//   lines, then the same sku again); this is coverage guidance, as in
//   fuzzing, with the Map's own control flow and state as the coverage.
//   Candidate arguments favour the ids found in recently written cells,
//   so that the next action can build on the last one.

import type * as ast from "./ast.ts";
import { parseExpr } from "./parser.ts";
import { resolve } from "./resolve.ts";
import { Runtime, type Observation } from "./runtime.ts";
import { type Terrain, type TerrainReply, callOf, replyOf } from "./terrain.ts";
import { type Value, id, int, text, bool, equal, isVariant, toJSON, variant, struct, vec, NONE, some, UNIT } from "./values.ts";
import { TypeEnv } from "./wire.ts";

export interface SurveyOptions {
  seed?: number;
  steps?: number;
  // Replay these calls (REPL syntax, one per line) instead of generating.
  script?: string;
  // Plan the next call on the Map: read what was just written (see above).
  plan?: boolean;
}

export type Channel = "result" | "effects" | "ports";

export interface Drift {
  step: number; // 1-based
  call: string;
  channel: Channel;
  map: unknown;
  terrain: unknown;
  // The state cells the drifting call read that were written earlier and
  // not read since, with the step that wrote each: where to look first.
  blame: { cell: string; step: number }[];
}

export interface Step {
  call: string; // REPL syntax, replayable
  map: TerrainReply;
  // True when the planner chose this call to read a debt.
  probe?: boolean;
}

export interface Report {
  seed: number;
  steps: Step[];
  drift: Drift | null;
  error: { step: number; call: string; message: string } | null;
}

// ---------------------------------------------------------------- PRNG (mulberry32)

export class Random {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error("pick from empty");
    return xs[this.int(0, xs.length - 1)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

// ---------------------------------------------------------------- value generation

const TEXTS = ["", "a", "Buy milk", "Call mom", "x".repeat(200), "x".repeat(201), "日本語", "  ", "\"quoted\""];

/** Generates values of a declared type, drawing ids from what has been seen. */
export class Generator {
  private readonly pools = new Map<string, Set<string>>(); // Id<X> -> ids seen
  private missing = 0;

  private readonly rng: Random;
  private readonly env: TypeEnv;

  constructor(rng: Random, env: TypeEnv) {
    this.rng = rng;
    this.env = env;
  }

  /** Remember ids that appeared in a value, so later calls can refer to them. */
  observe(v: Value, type: ast.Type | null): void {
    const t = type ? this.env.concrete(type) : null;
    if (v.t === "id") {
      const target = t?.kind === "named" && t.name === "Id" && t.args[0]?.kind === "named" ? t.args[0].name : "*";
      this.pool(target).add(v.v);
      return;
    }
    if (v.t === "enum") {
      const inner = t?.kind === "named" ? t.args : [];
      v.payload.forEach((p, i) => this.observe(p, v.variant === "Err" ? (inner[1] ?? null) : (inner[i] ?? inner[0] ?? null)));
    } else if (v.t === "vec") {
      const inner = t?.kind === "named" ? (t.args[0] ?? null) : null;
      v.items.forEach((x) => this.observe(x, inner));
    } else if (v.t === "struct") {
      const decl = this.env.struct(v.name);
      for (const [k, f] of Object.entries(v.fields)) this.observe(f, decl?.fields.find((x) => x.name === k)?.type ?? null);
    }
  }

  /** The ids seen so far for an Id type, or nothing for other types. */
  knownIds(type: ast.Type): Value[] {
    const t = this.env.concrete(type);
    if (t.kind !== "named") return [];
    let target: string | null = null;
    if (t.name === "Id") target = t.args[0]?.kind === "named" ? t.args[0].name : "*";
    else if (this.env.isOpaque(t.name)) target = t.name;
    if (target === null) return [];
    return [...this.pool(target)].map(id);
  }

  private pool(target: string): Set<string> {
    let p = this.pools.get(target);
    if (!p) {
      p = new Set();
      this.pools.set(target, p);
      // Opaque types are populated from outside the Map: give them a fixed cast.
      if (this.env.isOpaque(target)) for (const u of ["u1", "u2", "u3"]) p.add(u);
    }
    return p;
  }

  generate(type: ast.Type): Value {
    const t = this.env.concrete(type);
    if (t.kind === "unit") return UNIT;
    switch (t.name) {
      case "Text":
        return text(this.rng.pick(TEXTS));
      case "Email":
        return text(`${this.rng.pick(["a", "b", "c"])}@example.com`);
      case "Int":
        return int(this.rng.pick([0, 1, 2, 7, -1, 100]));
      case "bool":
      case "Bool":
        return bool(this.rng.chance(0.5));
      case "Instant":
        return { t: "instant", v: BigInt(this.rng.int(0, 1000)) };
      case "Id": {
        const target = t.args[0]?.kind === "named" ? t.args[0].name : "*";
        const pool = [...this.pool(target)];
        if (pool.length === 0 || this.rng.chance(0.1)) return id(`missing-${++this.missing}`);
        return id(this.rng.pick(pool));
      }
      case "Vec": {
        const inner = t.args[0];
        if (!inner) break;
        return vec(Array.from({ length: this.rng.int(0, 3) }, () => this.generate(inner)));
      }
      case "Option": {
        const inner = t.args[0];
        if (!inner) break;
        return this.rng.chance(0.3) ? NONE : some(this.generate(inner));
      }
      case "Result": {
        const [okT, errT] = t.args;
        if (!okT || !errT) break;
        return this.rng.chance(0.7)
          ? variant("Result", "Ok", [this.generate(okT)])
          : variant("Result", "Err", [this.generate(errT)]);
      }
    }
    const s = this.env.struct(t.name);
    if (s) {
      const fields: Record<string, Value> = {};
      for (const f of s.fields) fields[f.name] = this.generate(f.type);
      return struct(t.name, fields);
    }
    const e = this.env.enum(t.name);
    if (e) {
      const v = this.rng.pick(e.variants);
      return variant(t.name, v.name, v.fields.map((f) => this.generate(f)));
    }
    if (this.env.isOpaque(t.name)) return this.generate({ kind: "named", name: "Id", args: [t], span: t.span });
    throw new Error(`cannot generate a ${t.name}`);
  }
}

// ---------------------------------------------------------------- calls as text

/** A call in REPL syntax, so that a sequence can be replayed and read. */
export function printCall(name: string, args: Value[]): string {
  return `${name}(${args.map(printArg).join(", ")})`;
}

function printArg(v: Value): string {
  switch (v.t) {
    case "text":
    case "id":
      return JSON.stringify(v.v);
    case "int":
    case "instant":
      return v.v.toString();
    case "bool":
      return String(v.v);
    case "unit":
      return "()";
    default:
      throw new Error(`cannot print a ${v.t} argument as a call`);
  }
}

// ---------------------------------------------------------------- the survey

export async function survey(map: ast.MapDecl, terrain: Terrain, options: SurveyOptions = {}): Promise<Report> {
  const seed = options.seed ?? 1;
  const rng = new Random(seed);
  const resolved = resolve(map);
  const env = new TypeEnv(resolved);
  const gen = new Generator(rng, env);

  // Callables Survey drives: actions and queries (views need the browser instrument).
  const callables = [...env.callables.values()].filter(
    (c): c is ast.Action | ast.Query => c.kind === "action" || c.kind === "query",
  );
  if (callables.length === 0) throw new Error("the Map has no actions or queries to survey");

  let tick = 0n;
  let counter = 0;
  const mapRt = new Runtime(map, {
    clock: () => tick++,
    ids: () => `id-${++counter}`,
    ports: (port, fn) => {
      const decl = env.ports.get(port)?.fns.find((f) => f.name === fn);
      if (!decl) throw new Error(`no port fn ${port}.${fn}`);
      return gen.generate(decl.returns);
    },
  });

  const scripted = options.script
    ? options.script
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("//") && !l.startsWith("#"))
    : null;
  const total = scripted ? scripted.length : (options.steps ?? 100);

  // Planning (see the header): cells written and not yet read, with the
  // step that wrote them.
  const plan = options.plan ?? false;
  const debt = new Map<string, number>();
  const queries = callables.filter((c): c is ast.Query => c.kind === "query");
  const owed = (cell: string): boolean => {
    if (debt.has(cell)) return true;
    if (cell.endsWith("[*]")) {
      const prefix = cell.slice(0, -3) + "[";
      for (const k of debt.keys()) if (k.startsWith(prefix)) return true;
    }
    return false;
  };
  const settle = (cell: string): void => {
    debt.delete(cell);
    if (cell.endsWith("[*]")) {
      const prefix = cell.slice(0, -3) + "[";
      for (const k of [...debt.keys()]) if (k.startsWith(prefix)) debt.delete(k);
    }
  };
  // Candidate arguments for a probe: every known id for Id parameters, a
  // generated value otherwise. Tuples are sampled when there are many.
  const candidates = (q: ast.Query): Value[][] => {
    const per = q.params.map((p) => {
      const ids = gen.knownIds(p.type);
      return ids.length > 0 ? ids : [gen.generate(p.type)];
    });
    let tuples: Value[][] = [[]];
    for (const vs of per) tuples = tuples.flatMap((t) => vs.map((v) => [...t, v]));
    while (tuples.length > 24) tuples.splice(rng.int(0, tuples.length - 1), 1);
    return tuples;
  };
  // The query and arguments whose reads cover the most debt, or null.
  const probe = (): { name: string; args: Value[] } | null => {
    let best: { name: string; args: Value[]; score: number } | null = null;
    for (const q of queries) {
      for (const args of candidates(q)) {
        let obs: Observation;
        try {
          obs = mapRt.call(q.name, args);
        } catch {
          continue; // a Map fault on this input; not a useful probe
        }
        const score = obs.reads.filter(owed).length;
        if (score > 0 && (!best || score > best.score)) best = { name: q.name, args, score };
      }
    }
    return best && { name: best.name, args: best.args };
  };

  // Lookahead for actions: try a few candidates on a fork of the Map and
  // keep the most promising. Forks get their own injections; their values
  // are never compared with anything.
  const actions = callables.filter((c): c is ast.Action => c.kind === "action");
  const scratch = new Generator(new Random((seed ^ 0x9e3779b9) >>> 0), env);
  const seenErrors = new Map<string, Set<string>>(); // action -> Err variants seen
  const lastWrite = new Map<string, number>(); // cell -> step
  const errorKey = (v: Value): string | null =>
    isVariant(v, "Result", "Err") ? JSON.stringify(toJSON(v.payload[0]!)) : null;
  const size = (v: Value | undefined): number => {
    if (!v) return 0;
    switch (v.t) {
      case "vec":
        return 1 + v.items.reduce((n, x) => n + size(x), 0);
      case "table":
        return 1 + [...v.rows.values()].reduce((n, x) => n + size(x), 0);
      case "struct":
        return 1 + Object.values(v.fields).reduce((n, x) => n + size(x), 0);
      case "enum":
        return 1 + v.payload.reduce((n, x) => n + size(x), 0);
      default:
        return 1;
    }
  };
  const cellValue = (rt: Runtime, cell: string): Value | undefined => {
    const m = /^([^[]+)(?:\[(.*)\])?$/.exec(cell);
    if (!m) return undefined;
    const state = rt.getState(m[1]!);
    if (m[2] === undefined || m[2] === "*") return state;
    return state.t === "table" ? state.rows.get(m[2]) : undefined;
  };
  // The shape of a value: collection sizes and enum variants, not contents.
  const shape = (v: Value | undefined): string => {
    if (!v) return "-";
    switch (v.t) {
      case "vec":
        return `[${Math.min(v.items.length, 3)}]`;
      case "table":
        return `{${Math.min(v.rows.size, 3)}}`;
      case "enum":
        return v.variant + (v.payload.length ? `(${v.payload.map(shape).join(",")})` : "");
      case "struct":
        return `{${Object.entries(v.fields)
          .map(([k, f]) => [k, shape(f)] as const)
          .filter(([, sh]) => sh !== "")
          .map(([k, sh]) => `${k}:${sh}`)
          .join(",")}}`;
      default:
        return "";
    }
  };
  // How a cell changed: a sequence that grew, shrank or was reordered is
  // a different kind of step from one whose contents changed in place.
  const change = (before: Value | undefined, after: Value | undefined): string => {
    if (!before) return "+";
    if (!after) return "-";
    if (before.t === "vec" && after.t === "vec") {
      if (before.items.length < after.items.length) return "grew";
      if (before.items.length > after.items.length) return "shrank";
      if (before.items.every((x, i) => equal(x, after.items[i]!))) return "";
      const key = (v: Value) => JSON.stringify(toJSON(v));
      const a = before.items.map(key).sort();
      const b = after.items.map(key).sort();
      return a.every((x, i) => x === b[i]) ? "reordered" : "changed";
    }
    if (before.t === "struct" && after.t === "struct") {
      return Object.keys(after.fields)
        .map((k) => [k, change(before.fields[k], after.fields[k])] as const)
        .filter(([, c]) => c !== "")
        .map(([k, c]) => `${k}.${c}`)
        .join(",");
    }
    return equal(before, after) ? "" : "changed";
  };
  const signature = (obs: Observation, before: Runtime, after: Runtime): string =>
    `${obs.name}|${obs.branches.join(",")}|${obs.writes
      .map((c) => shape(cellValue(after, c)) + "~" + change(cellValue(before, c), cellValue(after, c)))
      .join(";")}`;
  const seen = new Map<string, number>(); // signature -> times made
  // Ids that appeared in recently written cells or arguments, newest last.
  const focus: string[] = [];
  const idsIn = (v: Value, out: string[]): void => {
    switch (v.t) {
      case "id":
        out.push(v.v);
        break;
      case "vec":
        v.items.forEach((x) => idsIn(x, out));
        break;
      case "table":
        for (const x of v.rows.values()) idsIn(x, out);
        break;
      case "struct":
        Object.values(v.fields).forEach((x) => idsIn(x, out));
        break;
      case "enum":
        v.payload.forEach((x) => idsIn(x, out));
        break;
    }
  };
  // Candidate arguments for an action: the recently seen ids of the right
  // type plus one fresh value for Id parameters, two generated values for
  // the rest; tuples are sampled when there are many.
  const actionCandidates = (a: ast.Action): Value[][] => {
    const per = a.params.map((p) => {
      const known = gen.knownIds(p.type);
      if (known.length === 0) return [gen.generate(p.type), gen.generate(p.type), gen.generate(p.type)];
      const hot = [...focus].reverse().filter((x) => known.some((v) => v.t === "id" && v.v === x));
      const picks = [...new Set(hot)].slice(0, 4).map(id);
      picks.push(gen.generate(p.type));
      return picks;
    });
    let tuples: Value[][] = [[]];
    for (const vs of per) tuples = tuples.flatMap((t) => vs.map((v) => [...t, v]));
    while (tuples.length > 24) tuples.splice(rng.int(0, tuples.length - 1), 1);
    return tuples;
  };
  const lookahead = (step: number): { name: string; args: Value[] } => {
    const random = () => {
      const c = rng.pick(callables);
      return { name: c.name, args: c.params.map((p) => gen.generate(p.type)) };
    };
    // Keep some randomness, so that no state is starved.
    if (actions.length === 0 || rng.chance(0.1)) return random();
    let best: { name: string; args: Value[]; score: number } | null = null;
    const tries: { a: ast.Action; args: Value[] }[] = [];
    for (const a of actions) for (const args of actionCandidates(a)) tries.push({ a, args });
    for (const { a, args } of tries) {
      let n = 0;
      const fork = mapRt.fork({
        clock: () => BigInt(step * 1000 + n++),
        ids: () => `look-${n++}`,
        ports: (port, fn) => {
          const decl = env.ports.get(port)?.fns.find((f) => f.name === fn);
          if (!decl) throw new Error(`no port fn ${port}.${fn}`);
          return scratch.generate(decl.returns);
        },
      });
      let obs: Observation;
      try {
        obs = fork.call(a.name, args);
      } catch {
        continue;
      }
      let score = rng.next() * 0.5; // tie-break
      score += 3 / Math.sqrt(1 + (seen.get(signature(obs, mapRt, fork)) ?? 0)); // the rarer, the better
      const errKey = errorKey(obs.result);
      if (errKey === null) score += 1;
      else if (!seenErrors.get(a.name)?.has(errKey)) score += 1;
      for (const cell of obs.writes) {
        const growth = size(cellValue(fork, cell)) - size(cellValue(mapRt, cell));
        score += Math.max(0, Math.min(growth, 3)) * 0.25;
        const last = lastWrite.get(cell);
        if (last !== undefined && step - last <= 5) score += 0.5; // build on recent work
      }
      if (!best || score > best.score) best = { name: a.name, args, score };
    }
    return best ?? random();
  };

  const report: Report = { seed, steps: [], drift: null, error: null };
  // Both sides start from the initial state.
  try {
    await terrain.reset?.();
  } catch (e) {
    report.error = { step: 0, call: "reset", message: `terrain: ${(e as Error).message}` };
    return report;
  }
  for (let i = 0; i < total; i++) {
    let name: string;
    let args: Value[];
    let planned = false;
    if (scripted) {
      const expr = parseExpr(scripted[i]!);
      if (expr.kind !== "call" || expr.callee.kind !== "path") throw new Error(`line ${i + 1}: expected a call`);
      name = expr.callee.segments.join("::");
      args = expr.args.map((a) => mapRt.evalTop(a.value));
    } else {
      const chosen = plan && debt.size > 0 ? probe() : null;
      if (chosen) {
        ({ name, args } = chosen);
        planned = true;
      } else if (plan) {
        ({ name, args } = lookahead(i + 1));
      } else {
        const c = rng.pick(callables);
        name = c.name;
        args = c.params.map((p) => gen.generate(p.type));
      }
    }
    const call = printCall(name, args);

    const before = plan ? mapRt.fork() : mapRt; // the state this step started from
    let mapObs: Observation;
    try {
      mapObs = mapRt.call(name, args);
    } catch (e) {
      report.error = { step: i + 1, call, message: `map: ${(e as Error).message}` };
      break;
    }
    const decl = env.callables.get(name);
    gen.observe(mapObs.result, decl && decl.kind !== "view" ? decl.returns : null);
    const expected = replyOf(mapObs);
    report.steps.push(planned ? { call, map: expected, probe: true } : { call, map: expected });

    // Hand the Terrain the port responses the Map received, plus spares:
    // a Terrain that calls a port the Map did not must be able to finish,
    // so that the extra request shows up as Drift in the ports channel.
    const terrainCall = callOf(mapObs);
    for (const [portName, port] of env.ports) {
      for (const fn of port.fns) {
        const key = `${portName}.${fn.name}`;
        const list = (terrainCall.ports[key] ??= []);
        while (list.length < mapObs.ports.filter((p) => p.port === portName && p.fn === fn.name).length + 2) {
          list.push(toJSON(gen.generate(fn.returns)));
        }
      }
    }

    let actual: TerrainReply;
    try {
      actual = await terrain.call(terrainCall);
    } catch (e) {
      report.error = { step: i + 1, call, message: `terrain: ${(e as Error).message}` };
      break;
    }
    const drift = compare(i + 1, call, expected, actual);
    if (drift) {
      drift.blame = mapObs.reads.filter(owed).flatMap((cell) =>
        [...debt].filter(([k]) => k === cell || (cell.endsWith("[*]") && k.startsWith(cell.slice(0, -3) + "["))).map(([k, step]) => ({ cell: k, step })),
      );
      report.drift = drift;
      break;
    }
    // Both sides agreed: what this call read is settled, what it wrote is owed.
    for (const cell of mapObs.reads) settle(cell);
    for (const cell of mapObs.writes) {
      debt.set(cell, i + 1);
      lastWrite.set(cell, i + 1);
    }
    const errKey = errorKey(mapObs.result);
    if (errKey !== null) {
      let set = seenErrors.get(name);
      if (!set) seenErrors.set(name, (set = new Set()));
      set.add(errKey);
    }
    const sig = signature(mapObs, before, mapRt);
    seen.set(sig, (seen.get(sig) ?? 0) + 1);
    const fresh: string[] = [];
    mapObs.args.forEach((v) => idsIn(v, fresh));
    for (const cell of mapObs.writes) {
      const v = cellValue(mapRt, cell);
      if (v) idsIn(v, fresh);
    }
    focus.push(...fresh);
    focus.splice(0, Math.max(0, focus.length - 40));
  }
  return report;
}

export function compare(step: number, call: string, expected: TerrainReply, actual: TerrainReply): Drift | null {
  if (actual.error !== undefined) {
    return { step, call, channel: "result", map: expected.result, terrain: { error: actual.error, ports: actual.ports }, blame: [] };
  }
  if (!same(expected.result, actual.result)) {
    return { step, call, channel: "result", map: expected.result, terrain: actual.result, blame: [] };
  }
  if (!same(expected.effects, actual.effects)) {
    return { step, call, channel: "effects", map: expected.effects, terrain: actual.effects, blame: [] };
  }
  if (!same(expected.ports, actual.ports)) {
    return { step, call, channel: "ports", map: expected.ports, terrain: actual.ports, blame: [] };
  }
  return null;
}

// Structural equality of JSON values. Object key order does not matter.
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object" && !Array.isArray(b)) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => k in (b as object) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

// ---------------------------------------------------------------- report text

export function formatReport(report: Report, mapName: string, target: string): string {
  const lines: string[] = [`survey ${mapName} against ${target}  seed ${report.seed}  steps ${report.steps.length}`];
  const width = String(report.steps.length).length;
  report.steps.forEach((s, i) => {
    const n = String(i + 1).padStart(width);
    const last = i === report.steps.length - 1;
    const mark = last && report.drift ? `DRIFT in ${report.drift.channel}` : last && report.error ? "ERROR" : "ok";
    lines.push(`${n} ${(s.probe ? "* " : "  ") + s.call.padEnd(46)} ${mark}`);
  });
  if (report.drift) {
    lines.push(`    map:     ${JSON.stringify(report.drift.map)}`);
    lines.push(`    terrain: ${JSON.stringify(report.drift.terrain)}`);
    for (const b of report.drift.blame) lines.push(`    ${b.cell} was last written at step ${b.step}`);
  }
  if (report.error) {
    lines.push(`    ${report.error.message}`);
  }
  if (report.drift || report.error) {
    lines.push("", "replay with --script and these lines:", ...report.steps.map((s) => s.call));
  } else {
    lines.push("no drift");
  }
  return lines.join("\n") + "\n";
}

// Re-exported for the CLI.
export { toJSON };
