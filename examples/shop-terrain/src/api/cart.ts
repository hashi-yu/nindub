// region api::cart

import { type Deps, type Line, type Result, type SkuId, type UserId, err, ok } from "../domain.ts";

/** @nindub action add_to_cart at POST /cart/lines */
export async function addToCart(deps: Deps, user: UserId, sku: SkuId, qty: number): Promise<Result<null>> {
  if (qty <= 0) return err("InvalidQuantity");
  const item = deps.store.skus.get(sku);
  if (!item) return err("NotFound");

  const cart = deps.store.carts.get(user) ?? { id: user, lines: [] };
  const existing = cart.lines.find((l) => l.sku === sku);
  const wanted = (existing?.qty ?? 0) + qty;
  if (wanted > item.stock) return err("OutOfStock");

  // The Map moves a merged line to the end of the cart (and re-prices it).
  // This Terrain first updated it in place; Survey caught the difference
  // after ~480 random steps (see README, Realize log and Amendment 2).
  cart.lines = [...cart.lines.filter((l) => l.sku !== sku), { sku, qty: wanted, unit_price: item.price }];
  deps.store.carts.put(cart);
  return ok(null);
}

/** @nindub action remove_from_cart at DELETE /cart/lines/{sku} */
export async function removeFromCart(deps: Deps, user: UserId, sku: SkuId): Promise<Result<null>> {
  const cart = deps.store.carts.get(user);
  if (!cart || !cart.lines.some((l) => l.sku === sku)) return err("NotFound");
  cart.lines = cart.lines.filter((l) => l.sku !== sku);
  deps.store.carts.put(cart);
  return ok(null);
}

/** @nindub query cart at GET /cart */
export async function cart(deps: Deps, user: UserId): Promise<Line[]> {
  return deps.store.carts.get(user)?.lines ?? [];
}

/** @nindub query cart_total at GET /cart/total */
export async function cartTotal(deps: Deps, user: UserId): Promise<number> {
  return (await cart(deps, user)).reduce((sum, l) => sum + l.qty * l.unit_price, 0);
}
