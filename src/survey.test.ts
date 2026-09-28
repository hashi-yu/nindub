import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "./parser.ts";
import { resolve } from "./resolve.ts";
import { RuntimeTerrain, serve, HttpTerrain, type Terrain, type TerrainCall } from "./terrain.ts";
import { survey, Random, same } from "./survey.ts";

const todoSrc = readFileSync(new URL("../examples/todo.nindub", import.meta.url), "utf8");
const todo = () => parse(todoSrc);

const terrainOf = (src: string) => {
  const map = parse(src);
  return new RuntimeTerrain(resolve(map), map);
};

test("a Map surveyed against itself has no drift, and the run is deterministic", async () => {
  const a = await survey(todo(), terrainOf(todoSrc), { seed: 7, steps: 150 });
  assert.equal(a.drift, null);
  assert.equal(a.error, null);
  assert.equal(a.steps.length, 150);
  const b = await survey(todo(), terrainOf(todoSrc), { seed: 7, steps: 150 });
  assert.deepEqual(
    a.steps.map((s) => s.call),
    b.steps.map((s) => s.call),
  );
  // The generator exercises the interesting paths.
  const calls = a.steps.map((s) => s.call).join("\n");
  assert.match(calls, /create\("u[123]", "/);
  assert.match(calls, /complete\("u[123]", "id-\d+"\)/);
  assert.match(calls, /"missing-\d+"/, "unknown ids are tried too");
  assert.ok(a.steps.some((s) => JSON.stringify(s.map.result).includes("Forbidden")));
  assert.ok(a.steps.some((s) => s.map.effects.length > 0), "some completion sent mail");
});

test("the Shop Map surveys against itself: richer types, nested regions, ports with Ok and Err", async () => {
  const shopSrc = readFileSync(new URL("../examples/shop.nindub", import.meta.url), "utf8");
  const r = await survey(parse(shopSrc), terrainOf(shopSrc), { seed: 9, steps: 400 });
  assert.equal(r.drift, null, JSON.stringify(r.drift));
  assert.equal(r.error, null, JSON.stringify(r.error));
  const results = r.steps.map((s) => JSON.stringify(s.map.result));
  // The generator reaches the interesting outcomes, not only the errors.
  assert.ok(r.steps.some((s) => s.call.startsWith("place(") && s.map.effects.length > 0), "an order was placed and paid");
  assert.ok(results.some((x) => x.includes("Forbidden")), "a non-staff user was refused");
  assert.ok(results.some((x) => x.includes("OutOfStock")), "stock ran out");
  assert.ok(r.steps.some((s) => s.map.ports.some((p) => p.fn === "refund")), "a refund was requested");
});

test("a Terrain that forgets the ownership check drifts in the result channel", async () => {
  const buggy = todoSrc.replace(
    /action complete\(user: UserId, id: TodoId\) -> Result<\(\), Error> \{\n        let todo = todos.get\(id\) else Error::NotFound;\n        requires todo.owner == user else Error::Forbidden;/,
    `action complete(user: UserId, id: TodoId) -> Result<(), Error> {\n        let todo = todos.get(id) else Error::NotFound;`,
  );
  assert.notEqual(buggy, todoSrc, "the mutation applied");
  const r = await survey(todo(), terrainOf(buggy), { seed: 3, steps: 300 });
  assert.ok(r.drift, "expected drift");
  assert.equal(r.drift.channel, "result");
  assert.match(r.drift.call, /^complete\(/);
  assert.deepEqual(r.drift.map, { Err: "Error::Forbidden" });
  assert.deepEqual(r.drift.terrain, { Ok: null });
  assert.equal(r.steps.length, r.drift.step);
});

test("a Terrain that skips the mail drifts in the effects channel", async () => {
  const silent = todoSrc.replace(/Ok\(to\) => emit SendMail \{[^}]*\},/s, "Ok(to) => {},");
  assert.notEqual(silent, todoSrc);
  const r = await survey(todo(), terrainOf(silent), { seed: 5, steps: 300 });
  assert.equal(r.drift?.channel, "effects");
  assert.equal((r.drift?.terrain as unknown[]).length, 0);
});

test("a Terrain that calls the directory on every completion drifts in the ports channel", async () => {
  // Move the port call before the ownership check: it now fires for
  // forbidden completions too.
  const chatty = todoSrc.replace(
    /let todo = todos.get\(id\) else Error::NotFound;\n        requires todo.owner == user else Error::Forbidden;\n\n        todos\[id\].done = true;/,
    `let todo = todos.get(id) else Error::NotFound;\n        let _probe = Directory.email_of(user);\n        requires todo.owner == user else Error::Forbidden;\n\n        todos[id].done = true;`,
  );
  assert.notEqual(chatty, todoSrc);
  const r = await survey(todo(), terrainOf(chatty), { seed: 11, steps: 300 });
  assert.equal(r.drift?.channel, "ports", JSON.stringify(r.drift));
  assert.match(r.drift!.call, /^complete\(/);
  assert.equal((r.drift!.terrain as unknown[]).length, (r.drift!.map as unknown[]).length + 1);
});

test("a Terrain that runs out of injected values reports an error, which is Drift", async () => {
  const stingy: Terrain = {
    async call() {
      return { result: null, effects: [], ports: [{ port: "Directory", fn: "email_of", args: ["u1"] }], error: "ran out" };
    },
  };
  const r = await survey(todo(), stingy, { script: 'create("u1", "x")' });
  assert.equal(r.error, null);
  assert.equal(r.drift?.channel, "result");
  assert.deepEqual(r.drift?.terrain, { error: "ran out", ports: [{ port: "Directory", fn: "email_of", args: ["u1"] }] });
});

test("a script replays exactly and reports the step", async () => {
  const script = `
    create("u1", "Buy milk")
    complete("u2", "id-1")
    complete("u1", "id-1")
    list("u1")
  `;
  const r = await survey(todo(), terrainOf(todoSrc), { script });
  assert.equal(r.drift, null);
  assert.deepEqual(
    r.steps.map((s) => s.call),
    ['create("u1", "Buy milk")', 'complete("u2", "id-1")', 'complete("u1", "id-1")', 'list("u1")'],
  );
  assert.deepEqual(r.steps[1]!.map.result, { Err: "Error::Forbidden" });
  assert.deepEqual(r.steps[3]!.map.result, [{ id: "id-1", owner: "u1", title: "Buy milk", done: true, created_at: 0 }]);
});

test("the protocol works over HTTP, and reset lets one Terrain serve several runs", async () => {
  const server = await serve(terrainOf(todoSrc));
  try {
    for (const seed of [2, 3]) {
      const r = await survey(todo(), new HttpTerrain(server.url), { seed, steps: 60 });
      assert.equal(r.drift, null, JSON.stringify(r.drift));
      assert.equal(r.error, null);
      assert.equal(r.steps.length, 60);
    }
  } finally {
    await server.close();
  }
});

test("a Terrain that errors is reported as an error at its step", async () => {
  const broken: Terrain = {
    async call(c: TerrainCall) {
      if (c.name === "list") throw new Error("boom");
      return { result: null, effects: [], ports: [] };
    },
  };
  const r = await survey(todo(), broken, { script: 'create("u1", "x")\nlist("u1")' });
  // Step 1 drifts (null vs {Ok: id}) before list is reached.
  assert.equal(r.drift?.step, 1);
  const r2 = await survey(todo(), broken, { script: 'list("u1")' });
  assert.equal(r2.error?.step, 1);
  assert.match(r2.error!.message, /terrain: boom/);
});

test("Random is deterministic and same() ignores key order", () => {
  const a = new Random(42);
  const b = new Random(42);
  assert.deepEqual([a.next(), a.next(), a.int(0, 9)], [b.next(), b.next(), b.int(0, 9)]);
  assert.ok(same({ x: 1, y: [1, { z: null }] }, { y: [1, { z: null }], x: 1 }));
  assert.ok(!same({ x: 1 }, { x: 1, y: 2 }));
  assert.ok(!same([1, 2], [2, 1]));
});

// The Drift that random generation reached in 2 of 30 runs of 600 steps
// (examples/shop-terrain/README.md): a sku added again to a cart with two
// lines. Before Amendment 2 the Map moved the merged line to the end; the
// Terrain kept it in place. Here the Map is put back to the old behavior
// and surveyed against the current one.
const oldShop = (shopSrc: string) => {
  const old = shopSrc.replace(
    /let merged = Line \{ sku, qty: qty_now, unit_price: s\.price \};\n\s*let lines = match current \{\n\s*Some\(_\) => existing\.lines\.map\(\|l\| if l\.sku == sku \{ merged \} else \{ l \}\),\n\s*None => existing\.lines\.push\(merged\),\n\s*\};\n\s*carts\.insert\(CartRow \{ id: user, lines \}\);/,
    "let others = existing.lines.filter(|l| l.sku != sku);\n        carts.insert(CartRow { id: user, lines: others.push(Line { sku, qty: qty_now, unit_price: s.price }) });",
  );
  assert.notEqual(old, shopSrc, "the mutation applied");
  return old;
};

test("planning reaches the cart-line Drift, and the state channel shows it at the add_to_cart step itself", async () => {
  const shopSrc = readFileSync(new URL("../examples/shop.nindub", import.meta.url), "utf8");
  const r = await survey(parse(oldShop(shopSrc)), terrainOf(shopSrc), { seed: 11, steps: 300, plan: true });
  assert.equal(r.error, null, JSON.stringify(r.error));
  assert.ok(r.drift, "expected drift");
  assert.equal(r.drift.channel, "state");
  assert.match(r.drift.call, /^add_to_cart\(/);
  assert.ok("carts" in (r.drift.map as object));
  assert.equal(r.drift.blame[0]!.step, r.drift.step, "the very step that wrote the cart is blamed");
});

test("planning finds no Drift where there is none, and stays deterministic", async () => {
  const shopSrc = readFileSync(new URL("../examples/shop.nindub", import.meta.url), "utf8");
  const a = await survey(parse(shopSrc), terrainOf(shopSrc), { seed: 5, steps: 200, plan: true });
  assert.equal(a.drift, null, JSON.stringify(a.drift));
  assert.equal(a.error, null, JSON.stringify(a.error));
  const b = await survey(parse(shopSrc), terrainOf(shopSrc), { seed: 5, steps: 200, plan: true });
  assert.deepEqual(a.steps.map((s) => s.call), b.steps.map((s) => s.call));
});

test("a Terrain whose stored state differs from the Map's is caught by the state channel, with the same outputs", async () => {
  // The Terrain clobbers the creation time when it completes a todo: every
  // observation still matches until something reads the row.
  const buggy = todoSrc.replace(/todos\[id\]\.done = true;/, "todos[id].done = true;\n        todos[id].created_at = 0;");
  assert.notEqual(buggy, todoSrc, "the mutation applied");
  const r = await survey(todo(), terrainOf(buggy), { seed: 3, steps: 300 });
  assert.ok(r.drift, "expected drift");
  assert.equal(r.drift.channel, "state");
  assert.match(r.drift.call, /^complete\(/);
  assert.ok("todos" in (r.drift.map as object));
});
