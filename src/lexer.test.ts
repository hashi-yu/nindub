import { test } from "node:test";
import assert from "node:assert/strict";
import { lex, LexError } from "./lexer.ts";

const kinds = (src: string) => lex(src).map((t) => `${t.kind}:${t.text}`);

test("lexes identifiers, ints, strings and punctuation", () => {
  assert.deepEqual(kinds(`let x = todos.get(1_000);`), [
    "ident:let",
    "ident:x",
    "punct:=",
    "ident:todos",
    "punct:.",
    "ident:get",
    "punct:(",
    "int:1000",
    "punct:)",
    "punct:;",
    "eof:",
  ]);
});

test("prefers the longest punctuation", () => {
  assert.deepEqual(kinds(`1..=2 a::b -> => .. == != <= >=`).slice(0, -1), [
    "int:1",
    "punct:..=",
    "int:2",
    "ident:a",
    "punct:::",
    "ident:b",
    "punct:->",
    "punct:=>",
    "punct:..",
    "punct:==",
    "punct:!=",
    "punct:<=",
    "punct:>=",
  ]);
});

test("drops plain comments and keeps doc comments", () => {
  assert.deepEqual(kinds(`//! about the map\n// plain\n/// about x\nx`), [
    "doc:about the map",
    "doc:about x",
    "ident:x",
    "eof:",
  ]);
});

test("decodes string escapes", () => {
  const [s] = lex(`"a \\"b\\" \\n"`);
  assert.equal(s!.text, 'a "b" \n');
});

test("tracks line and column", () => {
  const tokens = lex(`a\n  b`);
  assert.deepEqual(tokens[1]!.span.start, { line: 2, col: 3, offset: 4 });
});

test("rejects unterminated strings", () => {
  assert.throws(() => lex(`"abc`), LexError);
});
