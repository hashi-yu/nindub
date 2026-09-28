import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "./parser.ts";
import { NindubStore, StoreError } from "./store.ts";

const todo = () => new NindubStore(parse(readFileSync(new URL("../examples/todo.nindub", import.meta.url), "utf8")));

test("the store has one table per declared Table state and answers the state endpoint in the Map's shape", () => {
  const store = todo();
  const todos = store.table<{ id: string; owner: string; title: string; done: boolean; created_at: number }>("todos");
  todos.put({ id: "id-1", owner: "u1", title: "Buy milk", done: false, created_at: 0 });
  assert.deepEqual(store.state(), { todos: [{ id: "id-1", owner: "u1", title: "Buy milk", done: false, created_at: 0 }] });
  assert.equal(todos.size(), 1);
  assert.ok(todos.has("id-1"));
  assert.throws(() => store.table("nope"), StoreError);
});

test("a row that does not have the Map's shape is refused when written", () => {
  const todos = todo().table<{ id: string } & Record<string, unknown>>("todos");
  assert.throws(() => todos.put({ id: "id-1", owner: "u1", title: "x", done: "yes", created_at: 0 }), /does not have the Map's shape/);
  assert.throws(() => todos.put({ id: "id-1", owner: "u1", done: true, created_at: 0 }), /missing field title/);
  assert.equal(todos.size(), 0);
});

test("snapshot and restore roll an action back", () => {
  const store = todo();
  const todos = store.table<{ id: string; owner: string; title: string; done: boolean; created_at: number }>("todos");
  todos.put({ id: "id-1", owner: "u1", title: "a", done: false, created_at: 0 });
  const before = store.snapshot();
  todos.put({ id: "id-2", owner: "u1", title: "b", done: false, created_at: 1 });
  todos.delete("id-1");
  store.restore(before);
  assert.deepEqual(todos.all().map((t) => t.id), ["id-1"]);
  store.clear();
  assert.equal(todos.size(), 0);
});
