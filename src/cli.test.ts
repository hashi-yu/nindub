import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
const todo = fileURLToPath(new URL("../examples/todo.nindub", import.meta.url));

const runScript = (script: string) => {
  const r = spawnSync(process.execPath, [cli, "run", todo], { input: script, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

test("`nindub parse` prints the AST", () => {
  const r = spawnSync(process.execPath, [cli, "parse", todo], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const ast = JSON.parse(r.stdout);
  assert.equal(ast.name, "Todo");
  assert.equal(ast.items.length, 20);
});

test("`nindub run` drives the Map from stdin", () => {
  const out = runScript(`
    :port Directory.email_of Ok("alice@example.com")
    create("alice", "Buy milk")
    complete("alice", "id-1")
    complete("bob", "id-1")
    list("alice")
    :state
  `);
  const objects = out
    .split(/\n(?=\{|\[|\w)/)
    .map((s) => s.trim())
    .filter(Boolean);
  assert.equal(objects[0], 'Directory.email_of now returns {"Ok":"alice@example.com"}');
  assert.deepEqual(JSON.parse(objects[1]!), { action: "create", result: { Ok: "id-1" } });
  assert.deepEqual(JSON.parse(objects[2]!), {
    action: "complete",
    result: { Ok: null },
    effects: [{ to: "alice@example.com", subject: "Done: Buy milk", body: 'You completed "Buy milk".' }],
    ports: [{ "Directory.email_of": ["alice"], response: { Ok: "alice@example.com" } }],
  });
  assert.deepEqual(JSON.parse(objects[3]!), { action: "complete", result: { Err: "Error::Forbidden" } });
  assert.deepEqual(JSON.parse(objects[4]!), {
    query: "list",
    result: [{ id: "id-1", owner: "alice", title: "Buy milk", done: true, created_at: 0 }],
  });
  assert.deepEqual(JSON.parse(objects[5]!), {
    todos: [{ id: "id-1", owner: "alice", title: "Buy milk", done: true, created_at: 0 }],
  });
});

test("`nindub run` reports errors and keeps going", () => {
  const out = runScript(`
    nope("x")
    create("alice", "ok")
  `);
  assert.match(out, /error: .*unknown name nope/);
  assert.match(out, /"Ok": "id-1"/);
});
