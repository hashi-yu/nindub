// In-memory store (a stand-in for `region db: Postgres`, as in the Todo
// Terrain). Rows are copied on the way in and out so callers never share
// references with the store.

import type { CartRow, Order, Sku, Staff, Store, Table } from "../domain.ts";

class MemoryTable<T extends { id: string }> implements Table<T> {
  rows = new Map<string, T>();
  get(id: string): T | undefined {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : undefined;
  }
  has(id: string): boolean {
    return this.rows.has(id);
  }
  put(row: T): void {
    this.rows.set(row.id, structuredClone(row));
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
}

/** @nindub region db */
export class MemoryStore implements Store {
  skus = new MemoryTable<Sku>();
  carts = new MemoryTable<CartRow>();
  orders = new MemoryTable<Order>();
  staff = new MemoryTable<Staff>();

  snapshot(): unknown {
    return structuredClone({
      skus: this.skus.rows,
      carts: this.carts.rows,
      orders: this.orders.rows,
      staff: this.staff.rows,
    });
  }
  restore(s: unknown): void {
    const snap = structuredClone(s) as { skus: Map<string, Sku>; carts: Map<string, CartRow>; orders: Map<string, Order>; staff: Map<string, Staff> };
    this.skus.rows = snap.skus;
    this.carts.rows = snap.carts;
    this.orders.rows = snap.orders;
    this.staff.rows = snap.staff;
  }
  clear(): void {
    for (const t of [this.skus, this.carts, this.orders, this.staff]) t.rows.clear();
  }
}
