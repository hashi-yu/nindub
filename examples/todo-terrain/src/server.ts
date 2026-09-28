// region api — the HTTP process.
//
// Real routes (the product's API) and the harness endpoint share the same
// action and query functions. In production the deps use the real clock,
// random ids, and a directory client; under Survey the harness endpoint
// substitutes what Survey injected.

import { randomUUID } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as api from "./api/todos.ts";
import type { Deps, Result, TodoError } from "./domain.ts";
import { type HarnessCall, handleCall } from "./harness.ts";
import { NindubTodoStore } from "./store/nindub.ts";

const STATUS: Record<TodoError, number> = { NotFound: 404, Forbidden: 403, InvalidTitle: 400 };

export function startServer(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const store = new NindubTodoStore();

  // Production deps: `road http -> directory` and `road mail -> mailer`
  // point at services this example does not have, so the directory is
  // unreachable and mail is logged.
  const production: Deps = {
    now: () => Date.now(),
    freshId: () => randomUUID(),
    store,
    directory: { async email_of() { return { ok: false, error: "Unreachable" }; } },
    mail: { async send(m) { console.log(`mail to ${m.to}: ${m.subject}`); } },
  };

  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    const readJson = async (): Promise<unknown> => {
      let s = "";
      for await (const chunk of req) s += chunk;
      return s ? JSON.parse(s) : {};
    };
    const url = new URL(req.url ?? "/", "http://x");
    const user = req.headers["x-user"];

    try {
      if (req.method === "POST" && url.pathname === "/__nindub/call") {
        return send(200, await handleCall(store, (await readJson()) as HarnessCall));
      }
      if (req.method === "POST" && url.pathname === "/__nindub/reset") {
        store.clear();
        return send(200, {});
      }
      if (req.method === "POST" && url.pathname === "/__nindub/state") return send(200, store.state());
      if (typeof user !== "string") return send(401, { error: "x-user header required" });

      const respond = <T>(r: Result<T, TodoError>) => (r.ok ? send(200, r.value) : send(STATUS[r.error], { error: r.error }));
      const m = /^\/todos(?:\/([^/]+))?(?:\/(complete))?$/.exec(url.pathname);
      if (!m) return send(404, { error: "no such route" });
      const [, id, sub] = m;

      if (req.method === "POST" && !id) {
        const body = (await readJson()) as { title?: unknown };
        return respond(await api.create(production, user, String(body.title ?? "")));
      }
      if (req.method === "GET" && !id) return send(200, await api.list(production, user));
      if (id && req.method === "GET" && !sub) return respond(await api.get(production, user, id));
      if (id && req.method === "POST" && sub === "complete") return respond(await api.complete(production, user, id));
      if (id && req.method === "DELETE" && !sub) return respond(await api.remove(production, user, id));
      return send(405, { error: "method not allowed" });
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
  const port = Number(process.env["PORT"] ?? 3000);
  startServer(port).then(({ url }) => console.error(`todo terrain at ${url}`));
}
