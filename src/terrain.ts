// How Survey talks to a Terrain.
//
// The first instrument is the harness protocol: one HTTP endpoint on the
// Terrain, `POST /__nindub/call`, that runs one action or query with the
// injected values Survey supplies and reports what the Map would report:
// the result, the effects emitted, the port requests made. A Terrain that
// keeps its state in Nindub's store also answers `POST /__nindub/state`
// with that state in the Map's shape (D23). See docs/SURVEY.md.
// Instruments that drive a Terrain's real routes and screens come later
// (D22).

import * as http from "node:http";
import type { AddressInfo } from "node:net";
import type { ResolvedMap } from "./resolve.ts";
import { Runtime, RuntimeError, type Observation } from "./runtime.ts";
import { type Value, toJSON } from "./values.ts";
import { TypeEnv, WireError, decode } from "./wire.ts";

/** What Survey sends for one call. */
export interface TerrainCall {
  name: string;
  args: unknown[]; // JSON-encoded Values
  clock: string[]; // bigint as decimal strings, consumed in order
  ids: string[];
  ports: Record<string, unknown[]>; // "Port.fn" -> JSON responses, consumed in order
}

/** What the Terrain answers. */
export interface TerrainReply {
  result: unknown;
  effects: { name: string; fields: Record<string, unknown> }[];
  ports: { port: string; fn: string; args: unknown[] }[];
  // Set when the Terrain could not complete the call (it ran out of
  // injected values, or threw). Survey reports it as Drift, not as a
  // transport error.
  error?: string;
}

export interface Terrain {
  call(c: TerrainCall): Promise<TerrainReply>;
  /** Return to the initial state. Survey calls this before a run. */
  reset?(): Promise<void>;
  /**
   * The declared state, in the Map's shape (D23): `{ todos: [ ...rows ] }`.
   * Null when the Terrain does not offer it. Survey compares it with the
   * Map's state after every step.
   */
  state?(): Promise<Record<string, unknown> | null>;
}

/** Encode a Map Observation as the reply a conforming Terrain would give. */
export function replyOf(obs: Observation): TerrainReply {
  return {
    result: toJSON(obs.result),
    effects: obs.effects.map((e) => ({
      name: e.t === "struct" ? e.name : "?",
      fields: toJSON(e) as Record<string, unknown>,
    })),
    ports: obs.ports.map((p) => ({ port: p.port, fn: p.fn, args: p.args.map(toJSON) })),
  };
}

/** Build the call Survey sends, from the Map's Observation of the same step. */
export function callOf(obs: Observation): TerrainCall {
  const ports: Record<string, unknown[]> = {};
  for (const p of obs.ports) (ports[`${p.port}.${p.fn}`] ??= []).push(toJSON(p.response));
  return {
    name: obs.name,
    args: obs.args.map(toJSON),
    clock: obs.injected.clock.map((c) => c.toString()),
    ids: [...obs.injected.ids],
    ports,
  };
}

// ---------------------------------------------------------------- HTTP client

export class HttpTerrain implements Terrain {
  private readonly base: string;
  private hasState = true;
  constructor(base: string) {
    this.base = base.replace(/\/$/, "");
  }
  async reset(): Promise<void> {
    const res = await fetch(`${this.base}/__nindub/reset`, { method: "POST" });
    if (!res.ok) throw new Error(`terrain answered ${res.status} to reset`);
  }
  async state(): Promise<Record<string, unknown> | null> {
    if (!this.hasState) return null;
    const res = await fetch(`${this.base}/__nindub/state`, { method: "POST" });
    if (res.status === 404) {
      this.hasState = false;
      return null;
    }
    if (!res.ok) throw new Error(`terrain answered ${res.status} to state`);
    return (await res.json()) as Record<string, unknown>;
  }
  async call(c: TerrainCall): Promise<TerrainReply> {
    const res = await fetch(`${this.base}/__nindub/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(c),
    });
    const body = await res.text();
    let reply: Partial<TerrainReply>;
    try {
      reply = JSON.parse(body) as Partial<TerrainReply>;
    } catch {
      throw new Error(`terrain answered ${res.status} to ${c.name} with non-JSON: ${body.slice(0, 200)}`);
    }
    if (!res.ok && !reply.error) throw new Error(`terrain answered ${res.status} to ${c.name}: ${body.slice(0, 500)}`);
    return {
      result: reply.result ?? null,
      effects: reply.effects ?? [],
      ports: reply.ports ?? [],
      ...(reply.error ? { error: String(reply.error) } : {}),
    };
  }
}

// ---------------------------------------------------------------- a Map as a Terrain

/**
 * A Runtime driven through the protocol, consuming the injected values
 * Survey supplies. Used to test Survey (a Map against itself, or against a
 * deliberately different Map) and to show what a conforming Terrain does.
 */
export class RuntimeTerrain implements Terrain {
  runtime: Runtime;
  private readonly env: TypeEnv;
  private readonly mapDecl: Runtime["map"];
  private pending: TerrainCall = { name: "", args: [], clock: [], ids: [], ports: {} };
  // Port requests made during the current call, kept even if the call fails.
  private requests: TerrainReply["ports"] = [];

  constructor(resolved: ResolvedMap, mapDecl: Runtime["map"]) {
    this.env = new TypeEnv(resolved);
    this.mapDecl = mapDecl;
    this.runtime = this.fresh();
  }

  async reset(): Promise<void> {
    this.runtime = this.fresh();
  }

  async state(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const name of this.runtime.states()) out[name] = toJSON(this.runtime.getState(name));
    return out;
  }

  private fresh(): Runtime {
    return new Runtime(this.mapDecl, {
      clock: () => {
        const v = this.pending.clock.shift();
        if (v === undefined) throw new RuntimeError("terrain consumed more clock values than injected");
        return BigInt(v);
      },
      ids: () => {
        const v = this.pending.ids.shift();
        if (v === undefined) throw new RuntimeError("terrain consumed more ids than injected");
        return v;
      },
      ports: (port, fn, args) => {
        const key = `${port}.${fn}`;
        this.requests.push({ port, fn, args: args.map(toJSON) });
        const v = this.pending.ports[key]?.shift();
        if (v === undefined) throw new RuntimeError(`terrain requested ${key} more often than injected`);
        const decl = this.env.ports.get(port)?.fns.find((f) => f.name === fn);
        if (!decl) throw new RuntimeError(`no port fn ${key}`);
        return decode(v, decl.returns, this.env);
      },
    });
  }

  async call(c: TerrainCall): Promise<TerrainReply> {
    const decl = this.env.callables.get(c.name);
    if (!decl) throw new WireError(`no callable ${c.name}`);
    if (c.args.length !== decl.params.length) throw new WireError(`${c.name} takes ${decl.params.length} args`);
    const args: Value[] = decl.params.map((p, i) => decode(c.args[i], p.type, this.env));
    this.pending = { ...c, clock: [...c.clock], ids: [...c.ids], ports: Object.fromEntries(Object.entries(c.ports).map(([k, v]) => [k, [...v]])) };
    this.requests = [];
    try {
      return replyOf(this.runtime.call(c.name, args));
    } catch (e) {
      if (e instanceof RuntimeError) return { result: null, effects: [], ports: this.requests, error: e.message };
      throw e;
    }
  }
}

// ---------------------------------------------------------------- serving the protocol

/** Serve a Terrain over the harness protocol. Returns the base URL. */
export function serve(terrain: Terrain, port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/__nindub/reset") {
      await terrain.reset?.();
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    if (req.method === "POST" && req.url === "/__nindub/state") {
      const state = (await terrain.state?.()) ?? null;
      if (state === null) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state));
      return;
    }
    if (req.method !== "POST" || req.url !== "/__nindub/call") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const reply = await terrain.call(JSON.parse(body) as TerrainCall);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String((e as Error).message) }));
    }
  });
  return new Promise((resolveUrl) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolveUrl({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
