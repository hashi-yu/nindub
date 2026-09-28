import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "./parser.ts";
import { resolve, ResolveError } from "./resolve.ts";

const todo = parse(readFileSync(new URL("../examples/todo.nindub", import.meta.url), "utf8"));

const failsWith = (src: string, re: RegExp) =>
  assert.throws(
    () => resolve(parse(src)),
    (e: unknown) => e instanceof ResolveError && re.test(e.message),
    `expected ${re}`,
  );

test("resolves the Todo example: bodies joined to declarations, regions recorded", () => {
  const r = resolve(todo);
  assert.deepEqual(
    r.regions.map((x) => `${x.path.join("::")}:${x.kind?.name}`),
    ["browser:Client", "api:Service", "store:Postgres", "directory:External", "mailer:Outbound"],
  );
  const complete = r.items.find((i) => i.kind === "action" && i.name === "complete");
  assert.ok(complete && complete.kind === "action" && complete.body.stmts.length === 5);
  assert.equal(r.regionOf.get("complete")?.name, "api");
  assert.equal(r.regionOf.get("todos")?.name, "store");
  assert.equal(r.regionOf.get("Todo"), null);
});

test("a declaration without a body is an error", () => {
  failsWith(
    `map M; region api: Service { action a() -> (); }`,
    /a is declared but never defined/,
  );
});

test("an impl must match its declaration's signature", () => {
  failsWith(
    `map M;
     region api: Service { action a(x: Int) -> (); }
     impl api { action a(x: Text) -> () { () } }`,
    /signature of a differs/,
  );
});

test("an item may have only one body", () => {
  failsWith(
    `map M;
     region api: Service { action a() -> () { () } }
     impl api { action a() -> () { () } }`,
    /more than one body/,
  );
});

test("an impl of an unknown region, or of an item declared elsewhere, is an error", () => {
  failsWith(`map M; impl nope { }`, /unknown region nope/);
  failsWith(
    `map M;
     region a: Service { action f() -> (); }
     region b: Service { }
     impl b { action f() -> () { () } }`,
    /declared in region a, not b/,
  );
});

test("the region kind decides what may live there", () => {
  failsWith(`map M; region ui: Client { action a() -> () { () } }`, /an action cannot live in region ui of kind Client/);
  failsWith(`map M; region db: Postgres { view V() { } }`, /a view cannot live in region db of kind Postgres/);
  failsWith(`map M; region x: Spaceship { }`, /unknown region kind Spaceship/);
  // Types may live anywhere; a region without a kind accepts anything.
  resolve(parse(`map M; region db: Postgres { struct Row { id: Id<Row> } } region misc { action a() -> () { () } }`));
});

test("roads must point at existing regions", () => {
  failsWith(`map M; region api: Service { road sql -> db; }`, /road sql points at unknown region db/);
});

test("reaching into another region needs a road", () => {
  const withRoad = (road: string) => `
    map M;
    struct Row { id: Id<Row> }
    enum E { Nope }
    region api: Service { ${road} action a(id: Id<Row>) -> Result<(), E> { rows.insert(Row { id }); Ok(()) } }
    region db: Postgres { state rows: Table<Row>; }
  `;
  failsWith(withRoad(""), /a in region api uses rows from region db, but no road leads there/);
  resolve(parse(withRoad("road sql -> db;")));
});

test("a road from an enclosing region covers nested regions", () => {
  resolve(
    parse(`
      map M;
      struct Row { id: Id<Row> }
      region api: Service {
        road sql -> db;
        region todos { query n() -> Int { rows.len() } }
      }
      region db: Postgres { region main { state rows: Table<Row>; } }
    `),
  );
});

test("locals shadow item names and do not need roads", () => {
  resolve(
    parse(`
      map M;
      region api: Service { query q(rows: Int) -> Int { let x = rows; x } }
      region db: Postgres { state rows: Table<Row>; }
    `),
  );
});
