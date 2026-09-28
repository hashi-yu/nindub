import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, ParseError } from "./parser.ts";
import type * as ast from "./ast.ts";

const item = <K extends ast.Item["kind"]>(map: ast.MapDecl, kind: K, name?: string) => {
  const found = map.items.find(
    (i) => i.kind === kind && (name === undefined || ("name" in i && i.name === name)),
  ) as Extract<ast.Item, { kind: K }> | undefined;
  assert.ok(found, `no ${kind} ${name ?? ""}`);
  return found;
};

test("parses the Todo example", () => {
  const src = readFileSync(new URL("../examples/todo.nindub", import.meta.url), "utf8");
  const map = parse(src);
  assert.equal(map.name, "Todo");
  assert.deepEqual(
    map.items.map((i) => i.kind),
    [
      "type",
      "type",
      "opaque",
      "struct",
      "enum",
      "inject",
      "inject",
      "state",
      "invariant",
      "invariant",
      "port",
      "enum",
      "effect",
      "action",
      "action",
      "action",
      "query",
      "query",
      "view",
      "view",
    ],
  );

  const todo = item(map, "struct", "Todo");
  assert.deepEqual(
    todo.fields.map((f) => f.name),
    ["id", "owner", "title", "done", "created_at"],
  );

  const user = item(map, "opaque", "User");
  assert.deepEqual(user.doc, [
    "Users live in an external directory (see `port Directory`). The Map",
    "only ever sees their ids.",
  ]);

  const dir = item(map, "port", "Directory");
  assert.equal(dir.fns[0]!.name, "email_of");
  assert.equal(dir.fns[0]!.returns.kind, "named");

  const complete = item(map, "action", "complete");
  const [letStmt, requires, assign, matchStmt, tail] = complete.body.stmts;
  assert.equal(letStmt!.kind, "let");
  assert.ok(letStmt!.kind === "let" && letStmt!.orElse !== null);
  assert.equal(requires!.kind, "requires");
  assert.equal(assign!.kind, "assign");
  assert.ok(matchStmt!.kind === "expr" && matchStmt!.expr.kind === "match");
  assert.ok(tail!.kind === "expr" && !tail!.terminated);
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
  const view = item(map, "view", "List");
  const loop = view.body.stmts[0]!;
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
  const q = item(map, "query", "q");
  const s = q.body.stmts[0]!;
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
  const a = item(map, "action", "a");
  const s = a.body.stmts[0]!;
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
  const inv = item(map, "invariant");
  const tail = inv.body.stmts[0]!;
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
  const q = item(map, "query", "q");
  const s = q.body.stmts[0]!;
  if (s.kind !== "expr" || s.expr.kind !== "match") assert.fail("expected match");
  const [a, b, c] = s.expr.arms.map((arm) => arm.pattern);
  assert.deepEqual(a, { ...a, kind: "path", segments: ["Ok"], args: [{ ...(a as ast.PathPattern).args[0]!, kind: "bind", name: "t" }] });
  assert.ok(b!.kind === "path" && b!.args[0]!.kind === "path" && (b!.args[0] as ast.PathPattern).segments.join("::") === "Error::NotFound");
  assert.ok(c!.kind === "path" && c!.args[0]!.kind === "wildcard");
});

test("reports position on error", () => {
  assert.throws(
    () => parse(`map M;\nstate todos Table<Todo>;`),
    (e: unknown) => e instanceof ParseError && e.pos.line === 2 && /expected `:`/.test(e.message),
  );
});

test("rejects keywords as names", () => {
  assert.throws(() => parse(`map M;\nstate match: Table<Todo>;`), ParseError);
});
