// The wire format: how Values cross to and from a Terrain as JSON.
//
// Encoding is `toJSON` from values.ts. Decoding needs the declared type,
// because JSON does not distinguish an id from a text or a struct from a
// map; the Map's declarations supply it.

import type * as ast from "./ast.ts";
import type { ResolvedMap } from "./resolve.ts";
import { type Value, NONE, bool, id, instant, int, some, struct, text, variant, vec } from "./values.ts";

export class WireError extends Error {}

// Type lookup over a resolved Map: aliases, structs, enums, ports.
export class TypeEnv {
  private readonly aliases = new Map<string, ast.Type>();
  private readonly structs = new Map<string, ast.Struct | ast.Effect>();
  private readonly enums = new Map<string, ast.Enum>();
  private readonly opaque = new Set<string>();
  readonly ports = new Map<string, ast.Port>();
  readonly callables = new Map<string, ast.Action | ast.Query | ast.View>();

  constructor(resolved: ResolvedMap) {
    for (const item of resolved.items) {
      switch (item.kind) {
        case "type":
          this.aliases.set(item.name, item.type);
          break;
        case "struct":
        case "effect":
          this.structs.set(item.name, item);
          break;
        case "enum":
          this.enums.set(item.name, item);
          break;
        case "opaque":
          this.opaque.add(item.name);
          break;
        case "port":
          this.ports.set(item.name, item);
          break;
        case "action":
        case "query":
        case "view":
          this.callables.set(item.name, item);
          break;
      }
    }
  }

  /** Follow aliases to a concrete type. */
  concrete(t: ast.Type): ast.Type {
    let cur = t;
    for (let i = 0; i < 32; i++) {
      if (cur.kind !== "named") return cur;
      const next = this.aliases.get(cur.name);
      if (!next) return cur;
      cur = next;
    }
    throw new WireError(`alias cycle at ${t.kind === "named" ? t.name : "()"}`);
  }

  struct(name: string) {
    return this.structs.get(name);
  }
  enum(name: string) {
    return this.enums.get(name);
  }
  isOpaque(name: string) {
    return this.opaque.has(name);
  }
}

/** Decode a JSON value as the given Nindub type. */
export function decode(json: unknown, type: ast.Type, env: TypeEnv): Value {
  const t = env.concrete(type);
  if (t.kind === "unit") {
    if (json !== null && json !== undefined) throw new WireError(`expected null for (), got ${JSON.stringify(json)}`);
    return { t: "unit" };
  }
  const fail = (): never => {
    throw new WireError(`cannot decode ${JSON.stringify(json)} as ${t.name}`);
  };
  switch (t.name) {
    case "Text":
    case "Email":
      return typeof json === "string" ? text(json) : fail();
    case "Int":
      return typeof json === "number" && Number.isInteger(json)
        ? int(json)
        : typeof json === "string" && /^-?\d+$/.test(json)
          ? int(BigInt(json))
          : fail();
    case "bool":
    case "Bool":
      return typeof json === "boolean" ? bool(json) : fail();
    case "Id":
      return typeof json === "string" ? id(json) : typeof json === "number" ? id(String(json)) : fail();
    case "Instant":
      return typeof json === "number" ? instant(json) : typeof json === "string" && /^-?\d+$/.test(json) ? instant(BigInt(json)) : fail();
    case "Vec": {
      const inner = t.args[0];
      if (!inner || !Array.isArray(json)) return fail();
      return vec(json.map((x) => decode(x, inner, env)));
    }
    case "Table": {
      const inner = t.args[0];
      if (!inner || !Array.isArray(json)) return fail();
      const rows = new Map<string, Value>();
      for (const x of json) {
        const row = decode(x, inner, env);
        if (row.t !== "struct") return fail();
        const k = row.fields["id"];
        if (!k || (k.t !== "id" && k.t !== "text" && k.t !== "int")) return fail();
        rows.set(String(k.v), row);
      }
      return { t: "table", rows };
    }
    case "Option": {
      const inner = t.args[0];
      if (!inner) return fail();
      if (json === null || json === undefined || json === "Option::None") return NONE;
      if (isObject(json) && "Some" in json) return some(decode(json["Some"], inner, env));
      return fail();
    }
    case "Result": {
      const [okT, errT] = t.args;
      if (!okT || !errT || !isObject(json)) return fail();
      if ("Ok" in json) return variant("Result", "Ok", [decode(json["Ok"], okT, env)]);
      if ("Err" in json) return variant("Result", "Err", [decode(json["Err"], errT, env)]);
      return fail();
    }
  }
  const s = env.struct(t.name);
  if (s) {
    if (!isObject(json)) return fail();
    const fields: Record<string, Value> = {};
    for (const f of s.fields) {
      if (!(f.name in json)) throw new WireError(`missing field ${f.name} in ${t.name}`);
      fields[f.name] = decode(json[f.name], f.type, env);
    }
    return struct(t.name, fields);
  }
  const e = env.enum(t.name);
  if (e) {
    if (typeof json === "string") {
      const [en, va] = json.includes("::") ? json.split("::", 2) : [t.name, json];
      const v = e.variants.find((x) => x.name === va);
      if (en !== t.name || !v || v.fields.length !== 0) return fail();
      return variant(t.name, va!, []);
    }
    if (isObject(json)) {
      const keys = Object.keys(json);
      const v = keys.length === 1 ? e.variants.find((x) => x.name === keys[0]) : undefined;
      if (!v) return fail();
      const payload = json[v.name];
      const items = v.fields.length === 1 ? [payload] : Array.isArray(payload) ? payload : fail();
      if (items.length !== v.fields.length) return fail();
      return variant(t.name, v.name, items.map((x, i) => decode(x, v.fields[i]!, env)));
    }
    return fail();
  }
  if (env.isOpaque(t.name)) return typeof json === "string" ? id(json) : fail();
  throw new WireError(`unknown type ${t.name}`);
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
