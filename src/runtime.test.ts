import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "./parser.ts";
import { InvariantViolation, Runtime, RuntimeError, type Injections } from "./runtime.ts";
import { id, ok, err, text, toJSON, variant, type Value } from "./values.ts";

const todoSource = readFileSync(new URL("../examples/todo.nindub", import.meta.url), "utf8");
const todoMap = parse(todoSource);

const alice = id("alice");
const bob = id("bob");

function todo(injections: Injections = {}) {
  return new Runtime(todoMap, {
    ports: (port, fn, args) => {
      assert.equal(port, "Directory");
      assert.equal(fn, "email_of");
      const user = args[0]!;
      return user.t === "id" && user.v === "alice"
        ? ok(text("alice@example.com"))
        : err(variant("DirectoryError", "Unknown"));
    },
    ...injections,
  });
}

const json = (v: Value) => toJSON(v);

test("create inserts a todo with an injected id and time", () => {
  const rt = todo();
  const obs = rt.call("create", [alice, text("Buy milk")]);
  assert.deepEqual(json(obs.result), { Ok: "id-1" });
  assert.deepEqual(obs.effects, []);
  assert.deepEqual(obs.ports, []);
  assert.deepEqual(json(rt.getState("todos")), [
    { id: "id-1", owner: "alice", title: "Buy milk", done: false, created_at: 0 },
  ]);
});

test("requires returns the declared error and changes nothing", () => {
  const rt = todo();
  const obs = rt.call("create", [alice, text("")]);
  assert.deepEqual(json(obs.result), { Err: "Error::InvalidTitle" });
  assert.deepEqual(json(rt.getState("todos")), []);
});

test("complete emits a SendMail effect through the Directory port", () => {
  const rt = todo();
  rt.call("create", [alice, text("Buy milk")]);
  const obs = rt.call("complete", [alice, id("id-1")]);
  assert.deepEqual(json(obs.result), { Ok: null });
  assert.deepEqual(obs.effects.map(json), [
    { to: "alice@example.com", subject: "Done: Buy milk", body: 'You completed "Buy milk".' },
  ]);
  assert.equal(obs.ports.length, 1);
  assert.deepEqual(json(obs.ports[0]!.response), { Ok: "alice@example.com" });
  assert.deepEqual(json(rt.call("get", [alice, id("id-1")]).result), {
    Ok: { id: "id-1", owner: "alice", title: "Buy milk", done: true, created_at: 0 },
  });
});

test("when the port fails, completion succeeds and no mail is sent", () => {
  const rt = todo();
  rt.call("create", [bob, text("Walk")]);
  const obs = rt.call("complete", [bob, id("id-1")]);
  assert.deepEqual(json(obs.result), { Ok: null });
  assert.deepEqual(obs.effects, []);
  assert.deepEqual(json(obs.ports[0]!.response), { Err: "DirectoryError::Unknown" });
});

test("ownership is enforced by kind of error", () => {
  const rt = todo();
  rt.call("create", [alice, text("Buy milk")]);
  assert.deepEqual(json(rt.call("complete", [bob, id("id-1")]).result), { Err: "Error::Forbidden" });
  assert.deepEqual(json(rt.call("complete", [alice, id("nope")]).result), { Err: "Error::NotFound" });
  assert.deepEqual(json(rt.call("get", [bob, id("id-1")]).result), { Err: "Error::Forbidden" });
  assert.deepEqual(json(rt.call("remove", [bob, id("id-1")]).result), { Err: "Error::Forbidden" });
  assert.equal(json(rt.getState("todos") as Value) instanceof Array, true);
});

test("list returns only the caller's todos, oldest first", () => {
  const rt = todo();
  rt.call("create", [alice, text("b")]);
  rt.call("create", [bob, text("x")]);
  rt.call("create", [alice, text("a")]);
  const list = rt.call("list", [alice]).result;
  assert.deepEqual((json(list) as { title: string }[]).map((t) => t.title), ["b", "a"]);
});

test("remove deletes the row", () => {
  const rt = todo();
  rt.call("create", [alice, text("b")]);
  assert.deepEqual(json(rt.call("remove", [alice, id("id-1")]).result), { Ok: null });
  assert.deepEqual(json(rt.getState("todos")), []);
});

test("the List view renders structure, not pixels", () => {
  const rt = todo();
  rt.call("create", [alice, text("Buy milk")]);
  rt.call("create", [alice, text("Call mom")]);
  rt.call("complete", [alice, id("id-2")]);
  const obs = rt.call("List", [alice]);
  assert.equal(obs.kind, "view");
  assert.deepEqual(json(obs.result), [
    { heading: "Todos" },
    { form: "New todo", fields: [{ name: "title", type: "Text" }], submit: "<closure>" },
    {
      item: "Buy milk",
      done: false,
      children: [
        { button: "Done", action: { action: "complete", args: ["alice", "id-1"] } },
        { link: "Open", to: { view: "Detail", args: ["alice", "id-1"] } },
      ],
    },
    {
      item: "Call mom",
      done: true,
      children: [{ link: "Open", to: { view: "Detail", args: ["alice", "id-2"] } }],
    },
  ]);
  // Rendering a view runs no actions and emits nothing.
  assert.deepEqual(obs.effects, []);
});

test("the Detail view branches on the query result", () => {
  const rt = todo();
  rt.call("create", [alice, text("Buy milk")]);
  const found = json(rt.call("Detail", [alice, id("id-1")]).result) as unknown[];
  assert.deepEqual(found[0], { heading: "Buy milk" });
  assert.deepEqual(found[1], { text: "Not done" });
  assert.deepEqual(found[4], {
    button: "Delete",
    action: { action: "remove", args: ["alice", "id-1"] },
    then: { view: "List", args: ["alice"] },
  });
  const missing = json(rt.call("Detail", [alice, id("zzz")]).result);
  assert.deepEqual(missing, [{ heading: "Not found" }, { link: "Back", to: { view: "List", args: ["alice"] } }]);
  const forbidden = json(rt.call("Detail", [bob, id("id-1")]).result) as unknown[];
  assert.deepEqual(forbidden[0], { heading: "Not yours" });
});

test("an invariant violation is a Map bug, reported separately", () => {
  const rt = new Runtime(
    parse(`
      map M;
      struct Row { id: Id<Row>, n: Int }
      state rows: Table<Row>;
      invariant "n is small" { rows.all(|r| r.n < 10) }
      action put(id: Id<Row>, n: Int) -> Result<(), Error> {
        rows.insert(Row { id, n });
        Ok(())
      }
      enum Error { Never }
    `),
  );
  rt.call("put", [id("a"), { t: "int", v: 3n }]);
  assert.throws(() => rt.call("put", [id("b"), { t: "int", v: 30n }]), InvariantViolation);
  // The failing action rolled back.
  assert.deepEqual(json(rt.getState("rows")), [{ id: "a", n: 3 }]);
});

test("a failed action rolls back state and effects", () => {
  const rt = new Runtime(
    parse(`
      map M;
      struct Row { id: Id<Row> }
      effect Ping { id: Id<Row> }
      enum Error { Nope }
      state rows: Table<Row>;
      action put(id: Id<Row>, fail: bool) -> Result<(), Error> {
        rows.insert(Row { id });
        emit Ping { id };
        requires !fail else Error::Nope;
        Ok(())
      }
    `),
  );
  const obs = rt.call("put", [id("a"), { t: "bool", v: true }]);
  assert.deepEqual(json(obs.result), { Err: "Error::Nope" });
  assert.deepEqual(obs.effects, []);
  assert.deepEqual(json(rt.getState("rows")), []);
});

test("queries cannot call actions", () => {
  const rt = new Runtime(
    parse(`
      map M;
      struct Row { id: Id<Row> }
      enum Error { Nope }
      state rows: Table<Row>;
      action put(id: Id<Row>) -> Result<(), Error> { rows.insert(Row { id }); Ok(()) }
      query sneaky(id: Id<Row>) -> Result<(), Error> { put(id) }
    `),
  );
  assert.throws(() => rt.call("sneaky", [id("a")]), RuntimeError);
});

test("fns are pure helpers: callable from bodies, not from outside, and may not change the world", () => {
  const src = (body: string) => `
      map M;
      struct Row { id: Id<Row>, n: Int }
      enum Error { Nope }
      effect Ping { id: Id<Row> }
      state rows: Table<Row>;
      fn double(n: Int) -> Int { n * 2 }
      fn bad(id: Id<Row>) -> Int { ${body} }
      query q(n: Int) -> Int { double(n) }
      action a(id: Id<Row>) -> Result<Int, Error> { Ok(bad(id)) }
    `;
  const rt = new Runtime(parse(src("1")));
  assert.deepEqual(json(rt.call("q", [{ t: "int", v: 4n }]).result), 8);
  assert.throws(() => rt.call("double", [{ t: "int", v: 4n }]), /no action, query or view named double/);
  for (const body of ["rows.insert(Row { id, n: 1 }); 1", "emit Ping { id }; 1"]) {
    const r = new Runtime(parse(src(body)));
    assert.throws(() => r.call("a", [id("x")]), /a fn cannot/);
  }
});

test("locals are snapshots of state", () => {
  const rt = new Runtime(
    parse(`
      map M;
      struct Row { id: Id<Row>, n: Int }
      enum Error { Nope }
      state rows: Table<Row>;
      action bump(id: Id<Row>) -> Result<Int, Error> {
        rows.insert(Row { id, n: 1 });
        let before = rows[id];
        rows[id].n = 2;
        Ok(before.n + rows[id].n)
      }
    `),
  );
  assert.deepEqual(json(rt.call("bump", [id("a")]).result), { Ok: 3 });
});
