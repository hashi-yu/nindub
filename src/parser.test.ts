import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, ParseError } from "./parser.ts";
import type * as ast from "./ast.ts";

const item = <K extends ast.Item["kind"]>(items: ast.Item[], kind: K, name?: string) => {
  const found = items.find(
    (i) => i.kind === kind && (name === undefined || ("name" in i && i.name === name)),
  ) as Extract<ast.Item, { kind: K }> | undefined;
  assert.ok(found, `no ${kind} ${name ?? ""}`);
  return found;
};

const body = (i: { body: ast.Block | null }) => {
  assert.ok(i.body, "expected a body");
  return i.body;
};

test("parses the Todo example: territory, legend, detail", () => {
  const src = readFileSync(new URL("../examples/todo.nindub", import.meta.url), "utf8");
  const map = parse(src);
  assert.equal(map.name, "Todo");
  assert.deepEqual(
    map.items.map((i) => (i.kind === "impl" ? `impl ${i.path.join("::")}` : `${i.kind} ${"name" in i ? i.name : ""}`.trim())),
    [
      "region browser",
      "region api",
      "region store",
      "region directory",
      "region mailer",
      "type UserId",
      "type TodoId",
      "opaque User",
      "struct Todo",
      "enum Error",
      "enum DirectoryError",
      "inject clock",
      "inject ids",
      "impl store",
      "impl api",
      "impl browser",
    ],
  );

  const api = item(map.items, "region", "api");
  assert.deepEqual(api.regionKind, { ...api.regionKind, name: "Service", args: ["ts"] });
  assert.deepEqual(
    api.roads.map((r) => `${r.name} -> ${r.to.join("::")}`),
    ["sql -> store", "http -> directory", "mail -> mailer"],
  );
  // Declarations in the region have no bodies; the impl block has them.
  const declared = item(api.items, "action", "complete");
  assert.equal(declared.body, null);
  const impl = map.items.find((i) => i.kind === "impl" && i.path[0] === "api") as ast.Impl;
  const complete = item(impl.items, "action", "complete");
  const [letStmt, requires, assign, matchStmt, tail] = body(complete).stmts;
  assert.ok(letStmt!.kind === "let" && letStmt!.orElse !== null);
  assert.equal(requires!.kind, "requires");
  assert.equal(assign!.kind, "assign");
  assert.ok(matchStmt!.kind === "expr" && matchStmt!.expr.kind === "match");
  assert.ok(tail!.kind === "expr" && !tail!.terminated);

  const browser = item(map.items, "region", "browser");
  assert.deepEqual(browser.doc, [
    "Where people are. Views live here and are observed through the",
    "browser's accessibility tree.",
  ]);
  const store = item(map.items, "region", "store");
  assert.equal(item(store.items, "invariant").body, null);
  const dir = item(item(map.items, "region", "directory").items, "port", "Directory");
  assert.equal(dir.fns[0]!.name, "email_of");
});

test("regions nest, and bodies may be inline", () => {
  const map = parse(`
    map M;
    region api: Service(ts) {
      road sql -> db;
      region todos {
        query n() -> Int { 1 }
      }
    }
    region db: Postgres { state rows: Table<Row>; }
  `);
  const api = item(map.items, "region", "api");
  const todos = item(api.items, "region", "todos");
  assert.equal(todos.regionKind, null);
  assert.ok(item(todos.items, "query", "n").body);
});

test("view elements take named arguments and children", () => {
  const map = parse(`
    map M;
    view List(user: UserId) {
      for t in list(user) {
        item(t.title, done: t.done) {
          if !t.done { button("Done", complete(user, t.id)); }
          link("Open", Detail(user, t.id));
        }
      }
    }
  `);
  const view = item(map.items, "view", "List");
  const loop = body(view).stmts[0]!;
  assert.equal(loop.kind, "for");
  if (loop.kind !== "for") return;
  const el = loop.body.stmts[0]!;
  assert.ok(el.kind === "expr" && el.expr.kind === "call");
  if (el.kind !== "expr" || el.expr.kind !== "call") return;
  assert.deepEqual(
    el.expr.args.map((a) => a.name),
    [null, "done"],
  );
  assert.equal(el.children?.stmts.length, 2);
});

test("`{` after an if or for head starts the body, not a struct literal", () => {
  const map = parse(`
    map M;
    query q(t: Todo) -> bool {
      if t.done { true } else { false }
    }
  `);
  const s = body(item(map.items, "query", "q")).stmts[0]!;
  assert.ok(s.kind === "expr" && s.expr.kind === "if");
  if (s.kind !== "expr" || s.expr.kind !== "if") return;
  assert.equal(s.expr.condition.kind, "field");
});

test("struct literals with shorthand fields", () => {
  const map = parse(`
    map M;
    action a(id: Id) -> () {
      todos.insert(Todo { id, done: false });
    }
  `);
  const s = body(item(map.items, "action", "a")).stmts[0]!;
  assert.ok(s.kind === "expr" && s.expr.kind === "method");
  if (s.kind !== "expr" || s.expr.kind !== "method") return;
  const arg = s.expr.args[0]!.value;
  assert.equal(arg.kind, "struct");
  if (arg.kind !== "struct") return;
  assert.deepEqual(
    arg.fields.map((f) => [f.name, f.value.kind]),
    [
      ["id", "path"],
      ["done", "bool"],
    ],
  );
});

test("ranges bind looser than arithmetic and tighter than &&", () => {
  const map = parse(`
    map M;
    invariant "r" { (1..=n + 1).contains(x) && ok }
  `);
  const tail = body(item(map.items, "invariant")).stmts[0]!;
  assert.ok(tail.kind === "expr" && tail.expr.kind === "binary" && tail.expr.op === "&&");
  if (tail.kind !== "expr" || tail.expr.kind !== "binary") return;
  const left = tail.expr.left;
  assert.equal(left.kind, "method");
  if (left.kind !== "method") return;
  assert.equal(left.receiver.kind, "range");
  if (left.receiver.kind !== "range") return;
  assert.equal(left.receiver.inclusive, true);
  assert.equal(left.receiver.end.kind, "binary");
});

test("patterns: wildcard, binding, variant with payload", () => {
  const map = parse(`
    map M;
    query q(r: Result<Todo, Error>) -> Text {
      match r {
        Ok(t) => t.title,
        Err(Error::NotFound) => "missing",
        Err(_) => "other",
      }
    }
  `);
  const s = body(item(map.items, "query", "q")).stmts[0]!;
  if (s.kind !== "expr" || s.expr.kind !== "match") assert.fail("expected match");
  const [a, b, c] = s.expr.arms.map((arm) => arm.pattern);
  assert.ok(a!.kind === "path" && a!.segments[0] === "Ok" && a!.args[0]!.kind === "bind");
  assert.ok(b!.kind === "path" && b!.args[0]!.kind === "path" && (b!.args[0] as ast.PathPattern).segments.join("::") === "Error::NotFound");
  assert.ok(c!.kind === "path" && c!.args[0]!.kind === "wildcard");
});

test("a trailing match or if is the block's value; keywords may be method names", () => {
  const map = parse(`
    map M;
    fn f(s: Status) -> Text {
      if s == Status::A { text("x"); }
      match s {
        Status::A => "a",
        _ => "b",
      }
    }
    query g(xs: Vec<Int>) -> Int { xs.map(|x| x).sum() }
    query h() -> Vec<Int> { [1, 2] }
  `);
  const f = item(map.items, "fn", "f");
  const [first, tail] = body(f).stmts;
  assert.ok(first!.kind === "expr" && first!.expr.kind === "if" && !first!.terminated);
  assert.ok(tail!.kind === "expr" && tail!.expr.kind === "match" && !tail!.terminated);
  const g = body(item(map.items, "query", "g")).stmts[0]!;
  assert.ok(g.kind === "expr" && g.expr.kind === "method" && g.expr.method === "sum");
  const h = body(item(map.items, "query", "h")).stmts[0]!;
  assert.ok(h.kind === "expr" && h.expr.kind === "vec" && h.expr.items.length === 2);
});

test("reports position on error", () => {
  assert.throws(
    () => parse(`map M;\nstate todos Table<Todo>;`),
    (e: unknown) => e instanceof ParseError && e.pos.line === 2 && /expected `:`/.test(e.message),
  );
});

test("rejects keywords as names", () => {
  assert.throws(() => parse(`map M;\nstate match: Table<Todo>;`), ParseError);
  assert.throws(() => parse(`map M;\nregion road: Service { }`), ParseError);
});
