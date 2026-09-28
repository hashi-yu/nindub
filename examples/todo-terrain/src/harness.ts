// The harness protocol endpoint: POST /__nindub/call (docs/SURVEY.md).
//
// Survey sends one call with the clock values, ids and port responses the
// Map consumed for the same step. This module builds Deps that hand those
// out in order, runs the call, and reports the result, the effects emitted
// and the port requests made, in the wire encoding.

import * as api from "./api/todos.ts";
import type { Deps, DirectoryError, Result, SendMail, Todo, TodoError, TodoStore } from "./domain.ts";

export interface HarnessCall {
  name: string;
  args: unknown[];
  clock: string[];
  ids: string[];
  ports: Record<string, unknown[]>;
}

export interface HarnessReply {
  result: unknown;
  effects: { name: string; fields: Record<string, unknown> }[];
  ports: { port: string; fn: string; args: unknown[] }[];
  error?: string;
}

class Exhausted extends Error {}

export async function handleCall(store: TodoStore, call: HarnessCall): Promise<HarnessReply> {
  const clock = [...call.clock];
  const ids = [...call.ids];
  const ports = Object.fromEntries(Object.entries(call.ports ?? {}).map(([k, v]) => [k, [...v]]));
  const effects: HarnessReply["effects"] = [];
  const requests: HarnessReply["ports"] = [];

  const take = <T>(queue: T[], what: string): T => {
    const v = queue.shift();
    if (v === undefined) throw new Exhausted(`ran out of injected ${what}`);
    return v;
  };

  const deps: Deps = {
    now: () => Number(take(clock, "clock values")),
    freshId: () => take(ids, "ids"),
    store,
    directory: {
      async email_of(user) {
        requests.push({ port: "Directory", fn: "email_of", args: [user] });
        const raw = take(ports["Directory.email_of"] ?? [], "Directory.email_of responses");
        return decodeResult<string, DirectoryError>(raw, (x) => String(x), (e) => stripEnum(e) as DirectoryError);
      },
    },
    mail: {
      async send(m: SendMail) {
        effects.push({ name: "SendMail", fields: { to: m.to, subject: m.subject, body: m.body } });
      },
    },
  };

  try {
    const result = await dispatch(deps, call.name, call.args);
    return { result, effects, ports: requests };
  } catch (e) {
    if (e instanceof Exhausted || e instanceof BadCall) {
      return { result: null, effects, ports: requests, error: e.message };
    }
    throw e;
  }
}

class BadCall extends Error {}

const str = (x: unknown, what: string): string => {
  if (typeof x !== "string") throw new BadCall(`${what} must be a string`);
  return x;
};

async function dispatch(deps: Deps, name: string, args: unknown[]): Promise<unknown> {
  switch (name) {
    case "create":
      return encodeResult(await api.create(deps, str(args[0], "user"), str(args[1], "title")), (id) => id);
    case "complete":
      return encodeResult(await api.complete(deps, str(args[0], "user"), str(args[1], "id")), () => null);
    case "remove":
      return encodeResult(await api.remove(deps, str(args[0], "user"), str(args[1], "id")), () => null);
    case "get":
      return encodeResult(await api.get(deps, str(args[0], "user"), str(args[1], "id")), encodeTodo);
    case "list":
      return (await api.list(deps, str(args[0], "user"))).map(encodeTodo);
    default:
      throw new BadCall(`unknown call ${name}`);
  }
}

// ---------------------------------------------------------------- wire encoding

function encodeTodo(t: Todo): unknown {
  return { id: t.id, owner: t.owner, title: t.title, done: t.done, created_at: t.created_at };
}

function encodeResult<T>(r: Result<T, TodoError>, enc: (v: T) => unknown): unknown {
  return r.ok ? { Ok: enc(r.value) } : { Err: `Error::${r.error}` };
}

function decodeResult<T, E>(raw: unknown, dec: (v: unknown) => T, decErr: (v: unknown) => E): Result<T, E> {
  if (typeof raw === "object" && raw !== null) {
    if ("Ok" in raw) return { ok: true, value: dec((raw as { Ok: unknown }).Ok) };
    if ("Err" in raw) return { ok: false, error: decErr((raw as { Err: unknown }).Err) };
  }
  throw new BadCall(`bad Result on the wire: ${JSON.stringify(raw)}`);
}

// "DirectoryError::Unknown" -> "Unknown"
function stripEnum(v: unknown): string {
  const s = String(v);
  const i = s.indexOf("::");
  return i === -1 ? s : s.slice(i + 2);
}
