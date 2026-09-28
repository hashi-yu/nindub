// Terrain for examples/shop.nindub — domain types and the Deps the api
// region reaches through its roads.

export type UserId = string;
export type SkuId = string;
export type OrderId = string;
export type ChargeId = string;

/** @nindub struct Sku */
export interface Sku {
  id: SkuId;
  name: string;
  price: number;
  stock: number;
}

/** @nindub struct Line */
export interface Line {
  sku: SkuId;
  qty: number;
  unit_price: number;
}

/** @nindub struct CartRow */
export interface CartRow {
  id: UserId;
  lines: Line[];
}

/** @nindub enum Status — stored in the wire encoding, as the store requires (D23). */
export type Status = "Status::Placed" | { Paid: ChargeId } | { Shipped: ChargeId } | "Status::Cancelled" | "Status::Refunded";

export function statusKind(s: Status): "Placed" | "Paid" | "Shipped" | "Cancelled" | "Refunded" {
  if (typeof s === "string") return s.slice("Status::".length) as "Placed" | "Cancelled" | "Refunded";
  return "Paid" in s ? "Paid" : "Shipped";
}
export function statusCharge(s: Status): ChargeId {
  if (typeof s === "string") throw new Error(`status ${s} has no charge`);
  return "Paid" in s ? s.Paid : s.Shipped;
}

/** @nindub struct Order */
export interface Order {
  id: OrderId;
  customer: UserId;
  lines: Line[];
  total: number;
  status: Status;
  placed_at: number;
}

/** @nindub struct Staff */
export interface Staff {
  id: UserId;
}

/** @nindub enum Error */
export type ShopError =
  | "NotFound"
  | "Forbidden"
  | "InvalidQuantity"
  | "InvalidPrice"
  | "OutOfStock"
  | "EmptyCart"
  | "PaymentDeclined"
  | "RefundFailed"
  | "NotCancellable"
  | "NotShippable";

/** @nindub enum PayError */
export type PayError = "Declined" | "Unavailable";

export type Result<T, E = ShopError> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** @nindub effect Ship */
export interface Ship {
  order: OrderId;
  customer: UserId;
}
/** @nindub effect Receipt */
export interface Receipt {
  to: UserId;
  order: OrderId;
  total: number;
}
/** @nindub effect Refunded */
export interface Refunded {
  to: UserId;
  order: OrderId;
  total: number;
}

/** @nindub region db — Nindub's store, in the Map's shape (D23). */
export interface Store {
  skus: Table<Sku>;
  carts: Table<CartRow>;
  orders: Table<Order>;
  staff: Table<Staff>;
  /** Snapshot and restore, so that a failed action leaves nothing behind. */
  snapshot(): unknown;
  restore(s: unknown): void;
  clear(): void;
  /** Every state in the wire encoding: what `POST /__nindub/state` answers. */
  state(): Record<string, unknown>;
}

export interface Table<T extends { id: string }> {
  get(id: string): T | undefined;
  has(id: string): boolean;
  put(row: T): void;
  delete(id: string): void;
  all(): T[];
  size(): number;
}

export interface Deps {
  now(): number;
  freshId(): string;
  store: Store;
  /** @nindub port Payments */
  payments: {
    charge(customer: UserId, amount: number): Promise<Result<ChargeId, PayError>>;
    refund(charge: ChargeId): Promise<Result<null, PayError>>;
  };
  /** @nindub region shipping */
  shipping: { ship(s: Ship): Promise<void> };
  /** @nindub region mailer */
  mail: { receipt(r: Receipt): Promise<void>; refunded(r: Refunded): Promise<void> };
}
