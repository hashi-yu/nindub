// region api — the HTTP process. Real routes and the harness endpoints
// share the same functions; only the Deps differ.

import { randomUUID } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as cartApi from "./api/cart.ts";
import * as catalog from "./api/catalog.ts";
import * as ordersApi from "./api/orders.ts";
import * as staffApi from "./api/staff.ts";
import type { Deps, Result, ShopError } from "./domain.ts";
import { type HarnessCall, handleCall } from "./harness.ts";
import { openStore } from "./store/nindub.ts";

const STATUS: Record<ShopError, number> = {
  NotFound: 404,
  Forbidden: 403,
  InvalidQuantity: 400,
  InvalidPrice: 400,
  OutOfStock: 409,
  EmptyCart: 409,
  PaymentDeclined: 402,
  RefundFailed: 502,
  NotCancellable: 409,
  NotShippable: 409,
};

export function startServer(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const store = openStore();

  // Production deps. This example has no payment provider, shipping or
  // mail service behind it, so payments are declined and the rest is
  // logged.
  const production: Deps = {
    now: () => Date.now(),
    freshId: () => randomUUID(),
    store,
    payments: {
      async charge() { return { ok: false, error: "Unavailable" }; },
      async refund() { return { ok: false, error: "Unavailable" }; },
    },
    shipping: { async ship(s) { console.log(`ship ${s.order} to ${s.customer}`); } },
    mail: {
      async receipt(r) { console.log(`receipt ${r.order} to ${r.to}: ${r.total}`); },
      async refunded(r) { console.log(`refunded ${r.order} to ${r.to}: ${r.total}`); },
    },
  };

  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    const readJson = async (): Promise<Record<string, unknown>> => {
      let s = "";
      for await (const chunk of req) s += chunk;
      return s ? (JSON.parse(s) as Record<string, unknown>) : {};
    };
    const url = new URL(req.url ?? "/", "http://x");
    const user = req.headers["x-user"];
    const respond = <T>(r: Result<T, ShopError>) => (r.ok ? send(200, r.value) : send(STATUS[r.error], { error: r.error }));

    try {
      if (req.method === "POST" && url.pathname === "/__nindub/call") {
        return send(200, await handleCall(store, (await readJson()) as unknown as HarnessCall));
      }
      if (req.method === "POST" && url.pathname === "/__nindub/reset") {
        store.clear();
        return send(200, {});
      }
      if (req.method === "POST" && url.pathname === "/__nindub/state") return send(200, store.state());
      const p = url.pathname.split("/").filter(Boolean);
      const m = req.method;

      if (m === "GET" && p[0] === "products" && p.length === 1) return send(200, await catalog.products(production));
      if (m === "GET" && p[0] === "products" && p.length === 2) {
        const s = await catalog.product(production, p[1]!);
        return s ? send(200, s) : send(404, { error: "NotFound" });
      }
      if (typeof user !== "string") return send(401, { error: "x-user header required" });

      if (m === "POST" && p[0] === "products" && p.length === 1) {
        const b = await readJson();
        return respond(await staffApi.addSku(production, user, String(b["name"] ?? ""), Number(b["price"]), Number(b["stock"])));
      }
      if (m === "POST" && p[0] === "products" && p[2] === "restock") {
        const b = await readJson();
        return respond(await staffApi.restock(production, user, p[1]!, Number(b["qty"])));
      }
      if (m === "GET" && p[0] === "cart" && p.length === 1) return send(200, await cartApi.cart(production, user));
      if (m === "GET" && p[0] === "cart" && p[1] === "total") return send(200, await cartApi.cartTotal(production, user));
      if (m === "POST" && p[0] === "cart" && p[1] === "lines") {
        const b = await readJson();
        return respond(await cartApi.addToCart(production, user, String(b["sku"]), Number(b["qty"])));
      }
      if (m === "DELETE" && p[0] === "cart" && p[1] === "lines" && p[2]) return respond(await cartApi.removeFromCart(production, user, p[2]));
      if (m === "POST" && p[0] === "orders" && p.length === 1) return respond(await ordersApi.place(production, user));
      if (m === "GET" && p[0] === "orders" && p.length === 1) return send(200, await ordersApi.history(production, user));
      if (m === "GET" && p[0] === "orders" && p.length === 2) return respond(await ordersApi.order(production, user, p[1]!));
      if (m === "POST" && p[0] === "orders" && p[2] === "cancel") return respond(await ordersApi.cancel(production, user, p[1]!));
      if (m === "POST" && p[0] === "orders" && p[2] === "ship") return respond(await staffApi.ship(production, user, p[1]!));
      if (m === "POST" && p[0] === "staff" && p.length === 1) {
        const b = await readJson();
        return respond(await staffApi.grant(production, user, String(b["user"])));
      }
      if (m === "GET" && p[0] === "admin" && p[1] === "orders") return respond(await staffApi.allOrders(production, user));
      return send(404, { error: "no such route" });
    } catch (e) {
      return send(500, { error: String((e as Error).message) });
    }
  });

  return new Promise((resolveUrl) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolveUrl({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number(process.env["PORT"] ?? 3001);
  startServer(port).then(({ url }) => console.error(`shop terrain at ${url}`));
}
