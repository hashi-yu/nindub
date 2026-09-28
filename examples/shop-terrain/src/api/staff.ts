// region api::staff

import { type Deps, type Order, type OrderId, type Result, type SkuId, type UserId, err, ok } from "../domain.ts";

const isStaff = (deps: Deps, user: UserId) => deps.store.staff.has(user);

/** @nindub action grant at POST /staff */
export async function grant(deps: Deps, granter: UserId, user: UserId): Promise<Result<null>> {
  if (deps.store.staff.size() > 0 && !isStaff(deps, granter)) return err("Forbidden");
  deps.store.staff.put({ id: user });
  return ok(null);
}

/** @nindub action add_sku at POST /products */
export async function addSku(deps: Deps, staffUser: UserId, name: string, price: number, stock: number): Promise<Result<SkuId>> {
  if (!isStaff(deps, staffUser)) return err("Forbidden");
  if (price < 0) return err("InvalidPrice");
  if (stock < 0) return err("InvalidQuantity");
  const id = deps.freshId();
  deps.store.skus.put({ id, name, price, stock });
  return ok(id);
}

/** @nindub action restock at POST /products/{sku}/restock */
export async function restock(deps: Deps, staffUser: UserId, sku: SkuId, qty: number): Promise<Result<null>> {
  if (!isStaff(deps, staffUser)) return err("Forbidden");
  if (qty <= 0) return err("InvalidQuantity");
  const item = deps.store.skus.get(sku);
  if (!item) return err("NotFound");
  item.stock += qty;
  deps.store.skus.put(item);
  return ok(null);
}

/** @nindub action ship at POST /orders/{id}/ship */
export async function ship(deps: Deps, staffUser: UserId, id: OrderId): Promise<Result<null>> {
  if (!isStaff(deps, staffUser)) return err("Forbidden");
  const order = deps.store.orders.get(id);
  if (!order) return err("NotFound");
  if (order.status.kind !== "Paid") return err("NotShippable");
  order.status = { kind: "Shipped", charge: order.status.charge };
  deps.store.orders.put(order);
  await deps.shipping.ship({ order: id, customer: order.customer });
  return ok(null);
}

/** @nindub query all_orders at GET /admin/orders */
export async function allOrders(deps: Deps, staffUser: UserId): Promise<Result<Order[]>> {
  if (!isStaff(deps, staffUser)) return err("Forbidden");
  return ok(deps.store.orders.all().sort((a, b) => a.placed_at - b.placed_at));
}
