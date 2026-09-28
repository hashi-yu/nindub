// The harness protocol endpoint for the Shop Terrain (docs/SURVEY.md).

import * as cartApi from "./api/cart.ts";
import * as catalog from "./api/catalog.ts";
import * as ordersApi from "./api/orders.ts";
import * as staffApi from "./api/staff.ts";
import type { Deps, Order, PayError, Result, ShopError, Sku, Store } from "./domain.ts";

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
class BadCall extends Error {}

export async function handleCall(store: Store, call: HarnessCall): Promise<HarnessReply> {
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
  const portCall = async <T>(fn: string, args: unknown[], dec: (v: unknown) => T): Promise<Result<T, PayError>> => {
    requests.push({ port: "Payments", fn, args });
    const raw = take(ports[`Payments.${fn}`] ?? [], `Payments.${fn} responses`);
    return decodeResult(raw, dec, (e) => stripEnum(e) as PayError);
  };

  const deps: Deps = {
    now: () => Number(take(clock, "clock values")),
    freshId: () => take(ids, "ids"),
    store,
    payments: {
      charge: (customer, amount) => portCall("charge", [customer, amount], (v) => String(v)),
      refund: (charge) => portCall("refund", [charge], () => null),
    },
    shipping: {
      async ship(s) {
        effects.push({ name: "Ship", fields: { order: s.order, customer: s.customer } });
      },
    },
    mail: {
      async receipt(r) {
        effects.push({ name: "Receipt", fields: { to: r.to, order: r.order, total: r.total } });
      },
      async refunded(r) {
        effects.push({ name: "Refunded", fields: { to: r.to, order: r.order, total: r.total } });
      },
    },
  };

  // Actions are atomic: on Err (or failure) nothing the call did survives,
  // effects included.
  const snapshot = store.snapshot();
  try {
    const result = await dispatch(deps, call.name, call.args);
    if (isErr(result)) {
      store.restore(snapshot);
      return { result, effects: [], ports: requests };
    }
    return { result, effects, ports: requests };
  } catch (e) {
    store.restore(snapshot);
    if (e instanceof Exhausted || e instanceof BadCall) return { result: null, effects: [], ports: requests, error: e.message };
    throw e;
  }
}

const isErr = (r: unknown) => typeof r === "object" && r !== null && "Err" in r;

const str = (x: unknown, what: string): string => {
  if (typeof x !== "string") throw new BadCall(`${what} must be a string`);
  return x;
};
const num = (x: unknown, what: string): number => {
  if (typeof x !== "number" || !Number.isInteger(x)) throw new BadCall(`${what} must be an integer`);
  return x;
};

async function dispatch(deps: Deps, name: string, a: unknown[]): Promise<unknown> {
  switch (name) {
    case "products":
      return (await catalog.products(deps)).map(encodeSku);
    case "product": {
      const s = await catalog.product(deps, str(a[0], "sku"));
      return s ? { Some: encodeSku(s) } : "Option::None";
    }
    case "add_to_cart":
      return encodeResult(await cartApi.addToCart(deps, str(a[0], "user"), str(a[1], "sku"), num(a[2], "qty")), () => null);
    case "remove_from_cart":
      return encodeResult(await cartApi.removeFromCart(deps, str(a[0], "user"), str(a[1], "sku")), () => null);
    case "cart":
      return await cartApi.cart(deps, str(a[0], "user"));
    case "cart_total":
      return await cartApi.cartTotal(deps, str(a[0], "user"));
    case "place":
      return encodeResult(await ordersApi.place(deps, str(a[0], "user")), (id) => id);
    case "cancel":
      return encodeResult(await ordersApi.cancel(deps, str(a[0], "user"), str(a[1], "id")), () => null);
    case "order":
      return encodeResult(await ordersApi.order(deps, str(a[0], "user"), str(a[1], "id")), encodeOrder);
    case "history":
      return (await ordersApi.history(deps, str(a[0], "user"))).map(encodeOrder);
    case "grant":
      return encodeResult(await staffApi.grant(deps, str(a[0], "granter"), str(a[1], "user")), () => null);
    case "add_sku":
      return encodeResult(
        await staffApi.addSku(deps, str(a[0], "staff_user"), str(a[1], "name"), num(a[2], "price"), num(a[3], "stock")),
        (id) => id,
      );
    case "restock":
      return encodeResult(await staffApi.restock(deps, str(a[0], "staff_user"), str(a[1], "sku"), num(a[2], "qty")), () => null);
    case "ship":
      return encodeResult(await staffApi.ship(deps, str(a[0], "staff_user"), str(a[1], "id")), () => null);
    case "all_orders":
      return encodeResult(await staffApi.allOrders(deps, str(a[0], "staff_user")), (os) => os.map(encodeOrder));
    default:
      throw new BadCall(`unknown call ${name}`);
  }
}

// ---------------------------------------------------------------- wire encoding

const encodeSku = (s: Sku) => ({ id: s.id, name: s.name, price: s.price, stock: s.stock });

const encodeOrder = (o: Order) => ({
  id: o.id,
  customer: o.customer,
  lines: o.lines.map((l) => ({ sku: l.sku, qty: l.qty, unit_price: l.unit_price })),
  total: o.total,
  status: o.status, // already in the wire encoding (D23)
  placed_at: o.placed_at,
});

function encodeResult<T>(r: Result<T, ShopError>, enc: (v: T) => unknown): unknown {
  return r.ok ? { Ok: enc(r.value) } : { Err: `Error::${r.error}` };
}

function decodeResult<T, E>(raw: unknown, dec: (v: unknown) => T, decErr: (v: unknown) => E): Result<T, E> {
  if (typeof raw === "object" && raw !== null) {
    if ("Ok" in raw) return { ok: true, value: dec((raw as { Ok: unknown }).Ok) };
    if ("Err" in raw) return { ok: false, error: decErr((raw as { Err: unknown }).Err) };
  }
  throw new BadCall(`bad Result on the wire: ${JSON.stringify(raw)}`);
}

function stripEnum(v: unknown): string {
  const s = String(v);
  const i = s.indexOf("::");
  return i === -1 ? s : s.slice(i + 2);
}
