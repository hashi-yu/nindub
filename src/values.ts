// Runtime values of a Nindub Map, and how they are compared and printed.
//
// Values are immutable. The only mutable cells in the runtime are the
// `state` items, and they are replaced whole on every change. This keeps
// `let todo = todos.get(id)` a snapshot, as a reader of the Map expects.

import type * as ast from "./ast.ts";

export type Value =
  | { t: "unit" }
  | { t: "bool"; v: boolean }
  | { t: "int"; v: bigint }
  | { t: "text"; v: string }
  | { t: "id"; v: string }
  | { t: "instant"; v: bigint }
  | { t: "struct"; name: string; fields: Record<string, Value> }
  | { t: "enum"; name: string; variant: string; payload: Value[] }
  | { t: "table"; rows: ReadonlyMap<string, Value> } // keyed by the row's `id`
  | { t: "vec"; items: Value[] }
  | { t: "range"; start: bigint; end: bigint; inclusive: boolean }
  | { t: "closure"; params: ast.ClosureParam[]; body: ast.Expr; env: Env }
  | { t: "fn"; name: string; kind: "action" | "query" | "view" | "builtin" }
  | { t: "variantCtor"; name: string; variant: string }
  | { t: "injected"; name: string; type: string }
  | { t: "port"; name: string }
  | { t: "actionRef"; name: string; args: Value[] } // a deferred action, inside a view
  | { t: "viewRef"; name: string; args: Value[] } // a deferred navigation, inside a view
  | { t: "element"; element: Element };

// What a view produces: the structure of a screen, as data (D6).
export type Element =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "item"; text: string; attrs: Record<string, Value>; children: Element[] }
  | { kind: "button"; label: string; action: Value; then: Value | null }
  | { kind: "form"; label: string; fields: { name: string; type: string }[]; submit: Value }
  | { kind: "link"; label: string; to: Value };

export interface Env {
  vars: Map<string, Value>;
  parent: Env | null;
}

export const UNIT: Value = { t: "unit" };
export const bool = (v: boolean): Value => ({ t: "bool", v });
export const int = (v: bigint | number): Value => ({ t: "int", v: BigInt(v) });
export const text = (v: string): Value => ({ t: "text", v });
export const id = (v: string): Value => ({ t: "id", v });
export const instant = (v: bigint | number): Value => ({ t: "instant", v: BigInt(v) });
export const vec = (items: Value[]): Value => ({ t: "vec", items });
export const struct = (name: string, fields: Record<string, Value>): Value => ({ t: "struct", name, fields });
export const variant = (name: string, variantName: string, payload: Value[] = []): Value => ({
  t: "enum",
  name,
  variant: variantName,
  payload,
});
export const ok = (v: Value): Value => variant("Result", "Ok", [v]);
export const err = (v: Value): Value => variant("Result", "Err", [v]);
export const some = (v: Value): Value => variant("Option", "Some", [v]);
export const NONE: Value = variant("Option", "None");
export const emptyTable = (): Value => ({ t: "table", rows: new Map() });

export function isVariant(v: Value, name: string, variantName: string): v is Extract<Value, { t: "enum" }> {
  return v.t === "enum" && v.name === name && v.variant === variantName;
}

export function truthy(v: Value): boolean {
  if (v.t !== "bool") throw new TypeError(`expected bool, got ${describe(v)}`);
  return v.v;
}

export function equal(a: Value, b: Value): boolean {
  if (a.t !== b.t) return false;
  switch (a.t) {
    case "unit":
      return true;
    case "bool":
    case "int":
    case "text":
    case "id":
    case "instant":
      return a.v === (b as typeof a).v;
    case "struct": {
      const bb = b as typeof a;
      if (a.name !== bb.name) return false;
      const keys = Object.keys(a.fields);
      if (keys.length !== Object.keys(bb.fields).length) return false;
      return keys.every((k) => bb.fields[k] !== undefined && equal(a.fields[k]!, bb.fields[k]!));
    }
    case "enum": {
      const bb = b as typeof a;
      return (
        a.name === bb.name &&
        a.variant === bb.variant &&
        a.payload.length === bb.payload.length &&
        a.payload.every((p, i) => equal(p, bb.payload[i]!))
      );
    }
    case "vec": {
      const bb = b as typeof a;
      return a.items.length === bb.items.length && a.items.every((x, i) => equal(x, bb.items[i]!));
    }
    case "table": {
      const bb = b as typeof a;
      if (a.rows.size !== bb.rows.size) return false;
      for (const [k, v] of a.rows) {
        const o = bb.rows.get(k);
        if (!o || !equal(v, o)) return false;
      }
      return true;
    }
    case "range": {
      const bb = b as typeof a;
      return a.start === bb.start && a.end === bb.end && a.inclusive === bb.inclusive;
    }
    case "actionRef":
    case "viewRef": {
      const bb = b as typeof a;
      return a.name === bb.name && a.args.length === bb.args.length && a.args.every((x, i) => equal(x, bb.args[i]!));
    }
    default:
      return a === b;
  }
}

export function describe(v: Value): string {
  switch (v.t) {
    case "struct":
      return `struct ${v.name}`;
    case "enum":
      return `${v.name}::${v.variant}`;
    case "injected":
      return `injected ${v.name}: ${v.type}`;
    case "port":
      return `port ${v.name}`;
    case "fn":
      return `${v.kind} ${v.name}`;
    default:
      return v.t;
  }
}

// A plain-data rendering, used by the CLI and by Survey for comparison.
export function toJSON(v: Value): unknown {
  switch (v.t) {
    case "unit":
      return null;
    case "bool":
      return v.v;
    case "int":
    case "instant":
      return Number.isSafeInteger(Number(v.v)) ? Number(v.v) : v.v.toString();
    case "text":
    case "id":
      return v.v;
    case "struct": {
      const out: Record<string, unknown> = {};
      for (const [k, f] of Object.entries(v.fields)) out[k] = toJSON(f);
      return out;
    }
    case "enum":
      if (v.payload.length === 0) return `${v.name}::${v.variant}`;
      return { [v.variant]: v.payload.length === 1 ? toJSON(v.payload[0]!) : v.payload.map(toJSON) };
    case "table":
      return [...v.rows.values()].map(toJSON);
    case "vec":
      return v.items.map(toJSON);
    case "range":
      return `${v.start}${v.inclusive ? "..=" : ".."}${v.end}`;
    case "closure":
      return "<closure>";
    case "fn":
      return `<${v.kind} ${v.name}>`;
    case "variantCtor":
      return `<${v.name}::${v.variant}>`;
    case "injected":
      return `<${v.name}>`;
    case "port":
      return `<port ${v.name}>`;
    case "actionRef":
      return { action: v.name, args: v.args.map(toJSON) };
    case "viewRef":
      return { view: v.name, args: v.args.map(toJSON) };
    case "element":
      return elementToJSON(v.element);
  }
}

export function elementToJSON(e: Element): unknown {
  switch (e.kind) {
    case "heading":
    case "text":
      return { [e.kind]: e.text };
    case "item": {
      const attrs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(e.attrs)) attrs[k] = toJSON(v);
      return { item: e.text, ...attrs, children: e.children.map(elementToJSON) };
    }
    case "button":
      return { button: e.label, action: toJSON(e.action), ...(e.then ? { then: toJSON(e.then) } : {}) };
    case "form":
      return { form: e.label, fields: e.fields, submit: toJSON(e.submit) };
    case "link":
      return { link: e.label, to: toJSON(e.to) };
  }
}

// Text rendering for `+` concatenation.
export function toText(v: Value): string {
  switch (v.t) {
    case "text":
    case "id":
      return v.v;
    case "int":
    case "instant":
      return v.v.toString();
    case "bool":
      return String(v.v);
    default:
      return JSON.stringify(toJSON(v));
  }
}

// A row's key in a Table: its `id` field.
// Keys compare by their text, so that an `Id` and a `Text` with the same
// characters address the same row. The REPL relies on this: string literals
// stand in for ids there.
export function rowKey(row: Value): string {
  if (row.t !== "struct") throw new TypeError(`a Table row must be a struct, got ${describe(row)}`);
  const k = row.fields["id"];
  if (!k) throw new TypeError(`a Table row must have an id field, ${row.name} does not`);
  return keyOf(k);
}

export function keyOf(v: Value): string {
  if (v.t !== "id" && v.t !== "text" && v.t !== "int") throw new TypeError(`cannot key a Table by ${describe(v)}`);
  return String(v.v);
}
