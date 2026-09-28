// Survey: feed the same sequence of calls to the Map and a Terrain and
// compare their Observations (D6). Exploratory, not proof (D12).
//
// For each step Survey runs the Map first, so that the injected values
// the Map consumed (clock, ids) and the port responses it received can be
// handed to the Terrain for the same step (D8). Then it compares three
// channels: result, effects, port requests.
//
// With `plan`, Survey uses the Map to choose what to do next instead of
// picking at random: a handful of candidate actions are tried on a fork of
// the Map, and one that does something this run has not done yet is made.
// "Something" is the action, the branches its body took, and the shape of
// what it wrote (how many lines a cart has, whether a sequence grew or was
// reordered). Random picks rarely build the states a Drift hides in; this
// is coverage guidance as in fuzzing, with the Map's own control flow and
// state as the coverage.
//
// When the Terrain keeps its state in Nindub's store, Survey also reads that
// state after every step and compares it with the Map's (D23): a fourth
// channel, `state`. A divergence then shows at the step that caused it,
// whether or not anything reads it.

import type * as ast from "./ast.ts";
import { parseExpr } from "./parser.ts";
import { resolve } from "./resolve.ts";
import { Runtime, type Observation } from "./runtime.ts";
import { type Terrain, type TerrainReply, callOf, replyOf } from "./terrain.ts";
import { type Value, id, int, text, bool, equal, toJSON, variant, struct, vec, NONE, some, UNIT } from "./values.ts";
import { TypeEnv } from "./wire.ts";

export interface SurveyOptions {
  seed?: number;
  steps?: number;
  // Replay these calls (REPL syntax, one per line) instead of generating.
  script?: string;
  // Try candidate actions on a fork of the Map and prefer a new kind of step.
  plan?: boolean;
  // Compare the Terrain's declared state with the Map's after every step,
  // when the Terrain offers it (D23). Default true.
  state?: boolean;
}

export type Channel = "result" | "effects" | "ports" | "state";

export interface Drift {
  step: number; // 1-based
  call: string;
  channel: Channel;
  map: unknown;
  terrain: unknown;
  // The state cells behind the Drift, with the step that last wrote each:
  // where to look first.
  blame: { cell: string; step: number }[];
}

export interface Step {
  call: string; // REPL syntax, replayable
  map: TerrainReply;
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

  // Planning (see the header). `lastWrite` also names the steps to blame.
  const plan = options.plan ?? false;
  const actions = callables.filter((c): c is ast.Action => c.kind === "action");
  const scratch = new Generator(new Random((seed ^ 0x9e3779b9) >>> 0), env);
  const lastWrite = new Map<string, number>(); // cell -> step
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
  // The kind of step a call made: what ran, which way, what it did to state.
  const signature = (obs: Observation, before: Runtime, after: Runtime): string =>
    `${obs.name}|${obs.branches.join(",")}|${obs.writes
      .map((c) => shape(cellValue(after, c)) + "~" + change(cellValue(before, c), cellValue(after, c)))
      .join(";")}`;
  const seen = new Set<string>();
  const random = () => {
    const c = rng.pick(callables);
    return { name: c.name, args: c.params.map((p) => gen.generate(p.type)) };
  };
  // One rule: of a few candidate actions tried on a fork, make one whose
  // kind of step this run has not made yet. Otherwise pick at random.
  const lookahead = (step: number): { name: string; args: Value[] } => {
    const novel: { name: string; args: Value[] }[] = [];
    for (const a of actions) {
      for (let k = 0; k < 3; k++) {
        const args = a.params.map((p) => gen.generate(p.type));
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
        try {
          if (!seen.has(signature(fork.call(a.name, args), mapRt, fork))) novel.push({ name: a.name, args });
        } catch {
          // a Map fault on this input; not a useful candidate
        }
      }
    }
    return novel.length > 0 ? rng.pick(novel) : random();
  };

  // The state channel (D23), while the Terrain answers.
  let stateOn = options.state ?? true;
  const stateNames = mapRt.states();
  const compareState = (actual: Record<string, unknown>): { name: string; map: unknown; terrain: unknown } | null => {
    for (const name of stateNames) {
      const value = mapRt.getState(name);
      const expected = toJSON(value);
      const got = actual[name];
      if (value.t === "table") {
        // A Table is a set of rows keyed by id: order is not part of it.
        const byId = (rows: unknown): unknown =>
          Array.isArray(rows) ? [...rows].sort((a, b) => String((a as { id: unknown })?.id).localeCompare(String((b as { id: unknown })?.id))) : rows;
        if (same(byId(expected), byId(got))) continue;
      } else if (same(expected, got)) {
        continue;
      }
      return { name, map: expected, terrain: got === undefined ? "(missing)" : got };
    }
    return null;
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
    if (scripted) {
      const expr = parseExpr(scripted[i]!);
      if (expr.kind !== "call" || expr.callee.kind !== "path") throw new Error(`line ${i + 1}: expected a call`);
      name = expr.callee.segments.join("::");
      args = expr.args.map((a) => mapRt.evalTop(a.value));
    } else {
      ({ name, args } = plan ? lookahead(i + 1) : random());
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
    report.steps.push({ call, map: expected });

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
      drift.blame = blameFor(lastWrite, mapObs.reads);
      report.drift = drift;
      break;
    }
    for (const cell of mapObs.writes) lastWrite.set(cell, i + 1);
    seen.add(signature(mapObs, before, mapRt));

    // The state channel (D23).
    if (stateOn && terrain.state) {
      let state: Record<string, unknown> | null;
      try {
        state = await terrain.state();
      } catch (e) {
        report.error = { step: i + 1, call, message: `terrain: ${(e as Error).message}` };
        break;
      }
      if (state === null) {
        stateOn = false;
      } else {
        const diff = compareState(state);
        if (diff) {
          report.drift = {
            step: i + 1,
            call,
            channel: "state",
            map: { [diff.name]: diff.map },
            terrain: { [diff.name]: diff.terrain },
            blame: blameFor(lastWrite, [`${diff.name}[*]`]),
          };
          break;
        }
      }
    }
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

// The last writers of the given cells (`name`, `name[key]` or `name[*]` for
// every row of a Table), most recent first, at most five.
function blameFor(lastWrite: Map<string, number>, cells: string[]): { cell: string; step: number }[] {
  const hits = new Map<string, number>();
  for (const cell of cells) {
    const prefix = cell.endsWith("[*]") ? cell.slice(0, -3) + "[" : null;
    for (const [k, step] of lastWrite) {
      if (k === cell || (prefix !== null && (k === cell.slice(0, -3) || k.startsWith(prefix)))) hits.set(k, step);
    }
  }
  return [...hits]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cell, step]) => ({ cell, step }));
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
    lines.push(`${n} ${s.call.padEnd(48)} ${mark}`);
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
