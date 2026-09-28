// Survey the Todo Terrain against the Todo Map over the harness protocol.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "../../src/parser.ts";
import { formatReport, survey } from "../../src/survey.ts";
import { HttpTerrain } from "../../src/terrain.ts";
import { startServer } from "./src/server.ts";

const map = () => parse(readFileSync(new URL("../todo.nindub", import.meta.url), "utf8"));

test("the Todo Terrain has no Drift against the Todo Map", async () => {
  const server = await startServer();
  try {
    for (const seed of [1, 2, 3, 4, 5]) {
      const report = await survey(map(), new HttpTerrain(server.url), { seed, steps: 300 });
      assert.equal(report.drift, null, formatReport(report, "Todo", server.url));
      assert.equal(report.error, null, formatReport(report, "Todo", server.url));
    }
  } finally {
    await server.close();
  }
});

test("the real routes work too", async () => {
  const server = await startServer();
  try {
    const h = { "content-type": "application/json", "x-user": "alice" };
    const created = await fetch(`${server.url}/todos`, { method: "POST", headers: h, body: JSON.stringify({ title: "Buy milk" }) });
    assert.equal(created.status, 200);
    const id = (await created.json()) as string;
    const forbidden = await fetch(`${server.url}/todos/${id}/complete`, { method: "POST", headers: { ...h, "x-user": "bob" } });
    assert.equal(forbidden.status, 403);
    const done = await fetch(`${server.url}/todos/${id}/complete`, { method: "POST", headers: h });
    assert.equal(done.status, 200);
    const list = (await (await fetch(`${server.url}/todos`, { headers: h })).json()) as { done: boolean }[];
    assert.deepEqual(list.map((t) => t.done), [true]);
  } finally {
    await server.close();
  }
});
