// Survey the Shop Terrain against the Shop Map over the harness protocol.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "../../src/parser.ts";
import { formatReport, survey } from "../../src/survey.ts";
import { HttpTerrain } from "../../src/terrain.ts";
import { startServer } from "./src/server.ts";

const map = () => parse(readFileSync(new URL("../shop.nindub", import.meta.url), "utf8"));

test("the Shop Terrain has no Drift against the Shop Map", async () => {
  const server = await startServer();
  try {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const report = await survey(map(), new HttpTerrain(server.url), { seed, steps: 600 });
      assert.equal(report.drift, null, formatReport(report, "Shop", server.url));
      assert.equal(report.error, null, formatReport(report, "Shop", server.url));
    }
  } finally {
    await server.close();
  }
});

// Sequences Survey found Drift on while this Terrain was being realized,
// kept as scripts so they are checked every time (see README).
test("previously found Drifts stay fixed", async () => {
  const server = await startServer();
  try {
    const scripts = {
      "catalog order is code-unit order, not locale order": `
        grant("u1", "u1")
        add_sku("u1", "a", 1, 1)
        add_sku("u1", "Buy milk", 1, 1)
        products()
      `,
      "a sku added again moves to the end of the cart": `
        grant("u1", "u1")
        add_sku("u1", "A", 1, 10)
        add_sku("u1", "B", 1, 10)
        add_to_cart("u2", "id-1", 1)
        add_to_cart("u2", "id-2", 1)
        add_to_cart("u2", "id-1", 1)
        cart("u2")
      `,
    };
    for (const [name, script] of Object.entries(scripts)) {
      const report = await survey(map(), new HttpTerrain(server.url), { script });
      assert.equal(report.drift, null, `${name}\n${formatReport(report, "Shop", server.url)}`);
    }
  } finally {
    await server.close();
  }
});
