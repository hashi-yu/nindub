// Nindub's store for Terrains (D23).
//
// A Map's `state` declarations are also the shape its Terrain stores that
// state in. This module gives a Terrain that shape as a store: one table per
// `state` of type `Table<T>`, rows kept in the wire encoding
// (docs/SURVEY.md) and checked against `T` on the way in. Because the rows
// are already in the Map's shape, Survey can read them back and compare them
// with the Map's own state, and nobody has to write a mapping from the
// Terrain's storage to the Map: the Terrain's author writes no verification
// code at all (D7).
//
// The store is small on purpose. Indexes, caches and the rest of how a
// Terrain gets at its data stay its own business; only what the declared
// state looks like is fixed.

import type * as ast from "./ast.ts";
import { resolve } from "./resolve.ts";
import { toJSON } from "./values.ts";
import { TypeEnv, WireError, decode } from "./wire.ts";

export class StoreError extends Error {}

/** One `state name: Table<T>`. Rows are plain JSON in the wire encoding. */
export class StoreTable<T extends { id: string }> {
  readonly name: string;
  private rows = new Map<string, T>();
  private readonly rowType: ast.Type;
  private readonly env: TypeEnv;

  constructor(name: string, rowType: ast.Type, env: TypeEnv) {
    this.name = name;
    this.rowType = rowType;
    this.env = env;
  }

  get(id: string): T | undefined {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : undefined;
  }
  has(id: string): boolean {
    return this.rows.has(id);
  }
  /** Insert or replace a row. The row must have the shape the Map declares. */
  put(row: T): void {
    let canonical: T;
    try {
      canonical = toJSON(decode(row, this.rowType, this.env)) as T;
    } catch (e) {
      if (e instanceof WireError) throw new StoreError(`${this.name}: row does not have the Map's shape: ${e.message}`);
      throw e;
    }
    this.rows.set(String(canonical.id), canonical);
  }
  delete(id: string): void {
    this.rows.delete(id);
  }
  all(): T[] {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
  size(): number {
    return this.rows.size;
  }

  /** @internal */
  dump(): Map<string, T> {
    return new Map(this.rows);
  }
  /** @internal */
  load(rows: Map<string, T>): void {
    this.rows = new Map(rows);
  }
}

/** The declared state of a Map, as a Terrain stores it. */
export class NindubStore {
  private readonly tables = new Map<string, StoreTable<{ id: string }>>();

  constructor(map: ast.MapDecl) {
    const resolved = resolve(map);
    const env = new TypeEnv(resolved);
    for (const item of resolved.items) {
      if (item.kind !== "state") continue;
      const t = env.concrete(item.type);
      if (t.kind === "named" && t.name === "Table" && t.args[0]) {
        this.tables.set(item.name, new StoreTable(item.name, t.args[0], env));
      } else {
        throw new StoreError(`state ${item.name}: only Table state is supported by the store yet`);
      }
    }
  }

  /** The table for `state name: Table<T>`. */
  table<T extends { id: string }>(name: string): StoreTable<T> {
    const t = this.tables.get(name);
    if (!t) throw new StoreError(`no state ${name}`);
    return t as unknown as StoreTable<T>;
  }

  /** Every state, in the wire encoding: what `POST /__nindub/state` answers. */
  state(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, t] of this.tables) out[name] = t.all();
    return out;
  }

  /** A copy of everything, for atomic actions: take one before, restore on failure. */
  snapshot(): unknown {
    const out: Record<string, Map<string, { id: string }>> = {};
    for (const [name, t] of this.tables) out[name] = t.dump();
    return out;
  }
  restore(snapshot: unknown): void {
    const s = snapshot as Record<string, Map<string, { id: string }>>;
    for (const [name, t] of this.tables) t.load(s[name] ?? new Map());
  }
  /** Back to the initial state: the harness protocol's reset. */
  clear(): void {
    for (const t of this.tables.values()) t.load(new Map());
  }
}
