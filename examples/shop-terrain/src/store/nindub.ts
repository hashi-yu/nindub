// region db, kept in Nindub's store (D23): one table per `state` of the
// Map, rows in the Map's shape, readable by Survey through
// `POST /__nindub/state`. The Map declares `region db: Postgres`; this
// example uses the store's in-memory backend (Amendment 1 of the Todo
// Terrain, ruled discretion), which is a stand-in the same way.

import { readFileSync } from "node:fs";
import { parse } from "../../../../src/parser.ts";
import { NindubStore } from "../../../../src/store.ts";
import type { CartRow, Order, Sku, Staff, Store } from "../domain.ts";

/** @nindub region db */
export function openStore(): Store {
  const map = parse(readFileSync(new URL("../../../shop.nindub", import.meta.url), "utf8"));
  const store = new NindubStore(map);
  return {
    skus: store.table<Sku>("skus"),
    carts: store.table<CartRow>("carts"),
    orders: store.table<Order>("orders"),
    staff: store.table<Staff>("staff"),
    snapshot: () => store.snapshot(),
    restore: (s) => store.restore(s),
    clear: () => store.clear(),
    state: () => store.state(),
  };
}
