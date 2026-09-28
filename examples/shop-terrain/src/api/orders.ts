// region api::orders

import { type Deps, type Order, type OrderId, type Result, type UserId, err, ok, statusCharge, statusKind } from "../domain.ts";

/** @nindub action place at POST /orders */
export async function place(deps: Deps, user: UserId): Promise<Result<OrderId>> {
  const cart = deps.store.carts.get(user);
  if (!cart || cart.lines.length === 0) return err("EmptyCart");
  for (const l of cart.lines) {
    const sku = deps.store.skus.get(l.sku);
    if (!sku || sku.stock < l.qty) return err("OutOfStock");
  }
  const total = cart.lines.reduce((sum, l) => sum + l.qty * l.unit_price, 0);
  const id = deps.freshId();

  // Charge first; only a successful charge changes anything.
  const charge = await deps.payments.charge(user, total);
  if (!charge.ok) return err("PaymentDeclined");

  for (const l of cart.lines) {
    const sku = deps.store.skus.get(l.sku)!;
    sku.stock -= l.qty;
    deps.store.skus.put(sku);
  }
  const order: Order = {
    id,
    customer: user,
    lines: cart.lines,
    total,
    status: { Paid: charge.value },
    placed_at: deps.now(),
  };
  deps.store.orders.put(order);
  deps.store.carts.delete(user);
  await deps.mail.receipt({ to: user, order: id, total });
  return ok(id);
}

/** @nindub action cancel at POST /orders/{id}/cancel */
export async function cancel(deps: Deps, user: UserId, id: OrderId): Promise<Result<null>> {
  const order = deps.store.orders.get(id);
  if (!order) return err("NotFound");
  if (order.customer !== user) return err("Forbidden");

  switch (statusKind(order.status)) {
    case "Placed":
      order.status = "Status::Cancelled";
      break;
    case "Paid": {
      const refund = await deps.payments.refund(statusCharge(order.status));
      if (!refund.ok) return err("RefundFailed");
      order.status = "Status::Refunded";
      await deps.mail.refunded({ to: user, order: id, total: order.total });
      break;
    }
    default:
      return err("NotCancellable");
  }
  deps.store.orders.put(order);
  for (const l of order.lines) {
    const sku = deps.store.skus.get(l.sku);
    if (sku) {
      sku.stock += l.qty;
      deps.store.skus.put(sku);
    }
  }
  return ok(null);
}

/** @nindub query order at GET /orders/{id} */
export async function order(deps: Deps, user: UserId, id: OrderId): Promise<Result<Order>> {
  const o = deps.store.orders.get(id);
  if (!o) return err("NotFound");
  if (o.customer !== user) return err("Forbidden");
  return ok(o);
}

/** @nindub query history at GET /orders */
export async function history(deps: Deps, user: UserId): Promise<Order[]> {
  return deps.store.orders
    .all()
    .filter((o) => o.customer === user)
    .sort((a, b) => a.placed_at - b.placed_at);
}
