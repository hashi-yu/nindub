// Survey: feed the same sequence of calls to the Map and a Terrain and
// compare their Observations (D6). Exploratory, not proof (D12).
//
// For each step Survey runs the Map first, so that the injected values
// the Map consumed (clock, ids) and the port responses it received can be
// handed to the Terrain for the same step (D8). Then it compares three
// channels: result, effects, port requests.

import type * as ast from "./ast.ts";
import { parseExpr } from "./parser.ts";
import { resolve } from "./resolve.ts";
import { Runtime, type Observation } from "./runtime.ts";
import { type Terrain, type TerrainReply, callOf, replyOf } from "./terrain.ts";
import { type Value, id, int, text, bool, toJSON, variant, struct, vec, NONE, some, UNIT } from "./values.ts";
import { TypeEnv } from "./wire.ts";

export interface SurveyOptions {
  seed?: number;
  steps?: number;
  // Replay these calls (REPL syntax, one per line) instead of generating.
  script?: string;
}

export type Channel = "result" | "effects" | "ports";

export interface Drift {
  step: number; // 1-based
  call: string;
  channel: Channel;
  map: unknown;
  terrain: unknown;
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

  const report: Report = { seed, steps: [], drift: null, error: null };
  for (let i = 0; i < total; i++) {
    let name: string;
    let args: Value[];
    if (scripted) {
      const expr = parseExpr(scripted[i]!);
      if (expr.kind !== "call" || expr.callee.kind !== "path") throw new Error(`line ${i + 1}: expected a call`);
      name = expr.callee.segments.join("::");
      args = expr.args.map((a) => mapRt.evalTop(a.value));
    } else {
      const c = rng.pick(callables);
      name = c.name;
      args = c.params.map((p) => gen.generate(p.type));
    }
    const call = printCall(name, args);

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
      report.drift = drift;
      break;
    }
  }
  return report;
}

export function compare(step: number, call: string, expected: TerrainReply, actual: TerrainReply): Drift | null {
  if (actual.error !== undefined) {
    return { step, call, channel: "result", map: expected.result, terrain: { error: actual.error, ports: actual.ports } };
  }
  if (!same(expected.result, actual.result)) {
    return { step, call, channel: "result", map: expected.result, terrain: actual.result };
  }
  if (!same(expected.effects, actual.effects)) {
    return { step, call, channel: "effects", map: expected.effects, terrain: actual.effects };
  }
  if (!same(expected.ports, actual.ports)) {
    return { step, call, channel: "ports", map: expected.ports, terrain: actual.ports };
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
    lines.push(`${n} ${s.call.padEnd(48)} ${mark}`);
  });
  if (report.drift) {
    lines.push(`    map:     ${JSON.stringify(report.drift.map)}`);
    lines.push(`    terrain: ${JSON.stringify(report.drift.terrain)}`);
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
