// Recursive-descent parser for Nindub. See docs/LANGUAGE.md and src/ast.ts.

import type * as ast from "./ast.ts";
import { lex, type Pos, type Span, type Token } from "./lexer.ts";

export class ParseError extends Error {
  readonly pos: Pos;
  constructor(message: string, pos: Pos) {
    super(`${pos.line}:${pos.col}: ${message}`);
    this.pos = pos;
  }
}

const ITEM_KEYWORDS = new Set([
  "type",
  "opaque",
  "struct",
  "enum",
  "inject",
  "state",
  "invariant",
  "port",
  "effect",
  "action",
  "query",
  "view",
]);

const RESERVED = new Set([
  ...ITEM_KEYWORDS,
  "map",
  "fn",
  "let",
  "else",
  "if",
  "for",
  "in",
  "match",
  "requires",
  "emit",
  "true",
  "false",
]);

// Binary operator precedence, low to high. Higher binds tighter.
const BINARY_PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 3,
  "<=": 3,
  ">": 3,
  ">=": 3,
  "+": 4,
  "-": 4,
  "*": 5,
  "/": 5,
};
const RANGE_PRECEDENCE = 2.5; // between `&&` and comparisons, like Rust

export function parse(source: string): ast.MapDecl {
  return new Parser(lex(source)).parseMap();
}

/** Parse a single expression (REPL input). */
export function parseExpr(source: string): ast.Expr {
  const p = new Parser(lex(source));
  const e = p.parseExpr();
  p.expectEnd();
  return e;
}

class Parser {
  private i = 0;
  // While parsing the head of `if`, `match` or `for ... in`, a `{` starts
  // the body, not a struct literal. Same rule as Rust.
  private noStructLiteral = false;

  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // ---------------------------------------------------------------- tokens

  private peek(n = 0): Token {
    return this.tokens[Math.min(this.i + n, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const t = this.peek();
    if (t.kind !== "eof") this.i++;
    return t;
  }

  private at(text: string, kind: "punct" | "ident" = "punct"): boolean {
    const t = this.peek();
    return t.kind === kind && t.text === text;
  }

  private atKeyword(word: string): boolean {
    return this.at(word, "ident");
  }

  private eat(text: string, kind: "punct" | "ident" = "punct"): boolean {
    if (this.at(text, kind)) {
      this.next();
      return true;
    }
    return false;
  }

  private expect(text: string, kind: "punct" | "ident" = "punct"): Token {
    if (!this.at(text, kind)) this.fail(`expected \`${text}\``);
    return this.next();
  }

  private expectIdent(what = "identifier"): string {
    const t = this.peek();
    if (t.kind !== "ident") this.fail(`expected ${what}`);
    if (RESERVED.has(t.text)) this.fail(`\`${t.text}\` is a keyword and cannot be used as ${what}`);
    return this.next().text;
  }

  expectEnd(): void {
    if (this.peek().kind !== "eof") this.fail("expected end of input");
  }

  private fail(message: string): never {
    const t = this.peek();
    const found = t.kind === "eof" ? "end of file" : `\`${t.text}\``;
    throw new ParseError(`${message}, found ${found}`, t.span.start);
  }

  private spanFrom(start: Pos): Span {
    const prev = this.tokens[this.i - 1] ?? this.peek();
    return { start, end: prev.span.end };
  }

  private start(): Pos {
    return this.peek().span.start;
  }

  // ---------------------------------------------------------------- items

  parseMap(): ast.MapDecl {
    const start = this.start();
    // Leading `//!` comments describe the Map itself; skip them.
    while (this.peek().kind === "doc") this.next();
    this.expect("map", "ident");
    const name = this.expectIdent("map name");
    this.expect(";");
    const items: ast.Item[] = [];
    while (this.peek().kind !== "eof") items.push(this.parseItem());
    return { name, items, span: this.spanFrom(start) };
  }

  private parseDoc(): string[] {
    const doc: string[] = [];
    while (this.peek().kind === "doc") doc.push(this.next().text);
    return doc;
  }

  private parseItem(): ast.Item {
    const doc = this.parseDoc();
    const start = this.start();
    const t = this.peek();
    if (t.kind !== "ident" || !ITEM_KEYWORDS.has(t.text)) {
      this.fail(`expected an item (${[...ITEM_KEYWORDS].join(", ")})`);
    }
    this.next();
    const base = (span: Span) => ({ doc, span });
    switch (t.text) {
      case "type": {
        const name = this.expectIdent("type name");
        this.expect("=");
        const type = this.parseType();
        this.expect(";");
        return { kind: "type", name, type, ...base(this.spanFrom(start)) };
      }
      case "opaque": {
        const name = this.expectIdent("type name");
        this.expect(";");
        return { kind: "opaque", name, ...base(this.spanFrom(start)) };
      }
      case "struct": {
        const name = this.expectIdent("struct name");
        const fields = this.parseFields();
        return { kind: "struct", name, fields, ...base(this.spanFrom(start)) };
      }
      case "enum": {
        const name = this.expectIdent("enum name");
        const variants = this.parseVariants();
        return { kind: "enum", name, variants, ...base(this.spanFrom(start)) };
      }
      case "inject":
      case "state": {
        const name = this.expectIdent(`${t.text} name`);
        this.expect(":");
        const type = this.parseType();
        this.expect(";");
        return { kind: t.text, name, type, ...base(this.spanFrom(start)) };
      }
      case "invariant": {
        const d = this.peek();
        if (d.kind !== "string") this.fail("expected invariant description string");
        this.next();
        const body = this.parseBlock();
        return { kind: "invariant", description: d.text, body, ...base(this.spanFrom(start)) };
      }
      case "port": {
        const name = this.expectIdent("port name");
        this.expect("{");
        const fns: ast.FnSig[] = [];
        while (!this.at("}")) {
          const fstart = this.start();
          this.expect("fn", "ident");
          const fname = this.expectIdent("function name");
          const params = this.parseParams();
          this.expect("->");
          const returns = this.parseType();
          this.expect(";");
          fns.push({ name: fname, params, returns, span: this.spanFrom(fstart) });
        }
        this.expect("}");
        return { kind: "port", name, fns, ...base(this.spanFrom(start)) };
      }
      case "effect": {
        const name = this.expectIdent("effect name");
        const fields = this.parseFields();
        return { kind: "effect", name, fields, ...base(this.spanFrom(start)) };
      }
      case "action":
      case "query": {
        const name = this.expectIdent(`${t.text} name`);
        const params = this.parseParams();
        this.expect("->");
        const returns = this.parseType();
        const body = this.parseBlock();
        return { kind: t.text, name, params, returns, body, ...base(this.spanFrom(start)) };
      }
      case "view": {
        const name = this.expectIdent("view name");
        const params = this.parseParams();
        const body = this.parseBlock();
        return { kind: "view", name, params, body, ...base(this.spanFrom(start)) };
      }
      default:
        return this.fail("unreachable");
    }
  }

  private parseFields(): ast.Field[] {
    this.expect("{");
    const fields: ast.Field[] = [];
    while (!this.at("}")) {
      const start = this.start();
      const name = this.expectIdent("field name");
      this.expect(":");
      const type = this.parseType();
      fields.push({ name, type, span: this.spanFrom(start) });
      if (!this.eat(",")) break;
    }
    this.expect("}");
    return fields;
  }

  private parseVariants(): ast.Variant[] {
    this.expect("{");
    const variants: ast.Variant[] = [];
    while (!this.at("}")) {
      const start = this.start();
      const name = this.expectIdent("variant name");
      const fields: ast.Type[] = [];
      if (this.eat("(")) {
        while (!this.at(")")) {
          fields.push(this.parseType());
          if (!this.eat(",")) break;
        }
        this.expect(")");
      }
      variants.push({ name, fields, span: this.spanFrom(start) });
      if (!this.eat(",")) break;
    }
    this.expect("}");
    return variants;
  }

  private parseParams(): ast.Param[] {
    this.expect("(");
    const params: ast.Param[] = [];
    while (!this.at(")")) {
      const start = this.start();
      const name = this.expectIdent("parameter name");
      this.expect(":");
      const type = this.parseType();
      params.push({ name, type, span: this.spanFrom(start) });
      if (!this.eat(",")) break;
    }
    this.expect(")");
    return params;
  }

  // ---------------------------------------------------------------- types

  private parseType(): ast.Type {
    const start = this.start();
    if (this.eat("(")) {
      this.expect(")");
      return { kind: "unit", span: this.spanFrom(start) };
    }
    const name = this.expectIdent("type");
    const args: ast.Type[] = [];
    if (this.eat("<")) {
      while (!this.at(">")) {
        args.push(this.parseType());
        if (!this.eat(",")) break;
      }
      this.expect(">");
    }
    return { kind: "named", name, args, span: this.spanFrom(start) };
  }

  // ---------------------------------------------------------------- blocks and statements

  private parseBlock(): ast.Block {
    const start = this.start();
    this.expect("{");
    const stmts: ast.Stmt[] = [];
    while (!this.at("}")) {
      stmts.push(this.parseStmt());
      const last = stmts[stmts.length - 1]!;
      if (last.kind === "expr" && !last.terminated && !this.at("}")) {
        this.fail("expected `;` or `}` after expression");
      }
    }
    this.expect("}");
    return { stmts, span: this.spanFrom(start) };
  }

  private parseStmt(): ast.Stmt {
    const start = this.start();

    if (this.eat("let", "ident")) {
      const pattern = this.parsePattern();
      this.expect("=");
      const value = this.parseExpr();
      let orElse: ast.Expr | null = null;
      if (this.eat("else", "ident")) orElse = this.parseExpr();
      this.expect(";");
      return { kind: "let", pattern, value, orElse, span: this.spanFrom(start) };
    }

    if (this.eat("requires", "ident")) {
      const condition = this.parseExpr();
      this.expect("else", "ident");
      const orElse = this.parseExpr();
      this.expect(";");
      return { kind: "requires", condition, orElse, span: this.spanFrom(start) };
    }

    if (this.eat("for", "ident")) {
      const pattern = this.parsePattern();
      this.expect("in", "ident");
      const iterable = this.withNoStructLiteral(() => this.parseExpr());
      const body = this.parseBlock();
      return { kind: "for", pattern, iterable, body, span: this.spanFrom(start) };
    }

    const expr = this.parseExpr();

    if (this.eat("=")) {
      const value = this.parseExpr();
      this.expect(";");
      return { kind: "assign", target: expr, value, span: this.spanFrom(start) };
    }

    // `item(...) { children }` — a view element with children.
    let children: ast.Block | null = null;
    if ((expr.kind === "call" || expr.kind === "method") && this.at("{")) {
      children = this.parseBlock();
    }

    // Block-like expressions (if / match / block) need no `;`, as in Rust.
    const blockLike = expr.kind === "if" || expr.kind === "match" || expr.kind === "block";
    const terminated = this.eat(";") || children !== null || blockLike;
    return { kind: "expr", expr, children, terminated, span: this.spanFrom(start) };
  }

  private withNoStructLiteral<T>(f: () => T): T {
    const saved = this.noStructLiteral;
    this.noStructLiteral = true;
    try {
      return f();
    } finally {
      this.noStructLiteral = saved;
    }
  }

  // ---------------------------------------------------------------- expressions

  parseExpr(): ast.Expr {
    return this.parseBinary(0);
  }

  private parseBinary(minPrec: number): ast.Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind !== "punct") break;

      if (t.text === ".." || t.text === "..=") {
        if (RANGE_PRECEDENCE < minPrec) break;
        this.next();
        const right = this.parseBinary(RANGE_PRECEDENCE + 0.5);
        left = {
          kind: "range",
          start: left,
          end: right,
          inclusive: t.text === "..=",
          span: { start: left.span.start, end: right.span.end },
        };
        continue;
      }

      const prec = BINARY_PRECEDENCE[t.text];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.parseBinary(prec + 1);
      left = {
        kind: "binary",
        op: t.text as ast.BinaryOp,
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
    }
    return left;
  }

  private parseUnary(): ast.Expr {
    const start = this.start();
    if (this.at("!") || this.at("-")) {
      const op = this.next().text as ast.UnaryOp;
      const operand = this.parseUnary();
      return { kind: "unary", op, operand, span: this.spanFrom(start) };
    }
    return this.parsePostfix(this.parsePrimary());
  }

  private parsePostfix(expr: ast.Expr): ast.Expr {
    for (;;) {
      const start = expr.span.start;
      if (this.eat(".")) {
        const name = this.expectIdent("field or method name");
        if (this.at("(")) {
          const args = this.parseArgs();
          expr = { kind: "method", receiver: expr, method: name, args, span: this.spanFrom(start) };
        } else {
          expr = { kind: "field", object: expr, field: name, span: this.spanFrom(start) };
        }
        continue;
      }
      if (this.at("(")) {
        const args = this.parseArgs();
        expr = { kind: "call", callee: expr, args, span: this.spanFrom(start) };
        continue;
      }
      if (this.eat("[")) {
        const index = this.parseExpr();
        this.expect("]");
        expr = { kind: "index", object: expr, index, span: this.spanFrom(start) };
        continue;
      }
      return expr;
    }
  }

  private parseArgs(): ast.Arg[] {
    this.expect("(");
    const args: ast.Arg[] = [];
    // Arguments are parsed with struct literals allowed again.
    const saved = this.noStructLiteral;
    this.noStructLiteral = false;
    while (!this.at(")")) {
      const start = this.start();
      let name: string | null = null;
      // `name: expr` — a named argument (view elements use these).
      if (this.peek().kind === "ident" && this.peek(1).kind === "punct" && this.peek(1).text === ":") {
        name = this.next().text;
        this.next();
      }
      const value = this.parseExpr();
      args.push({ name, value, span: this.spanFrom(start) });
      if (!this.eat(",")) break;
    }
    this.noStructLiteral = saved;
    this.expect(")");
    return args;
  }

  private parsePrimary(): ast.Expr {
    const start = this.start();
    const t = this.peek();

    if (t.kind === "int") {
      this.next();
      return { kind: "int", value: BigInt(t.text), span: this.spanFrom(start) };
    }
    if (t.kind === "string") {
      this.next();
      return { kind: "string", value: t.text, span: this.spanFrom(start) };
    }
    if (t.kind === "punct") {
      if (t.text === "(") {
        this.next();
        if (this.eat(")")) return { kind: "unit", span: this.spanFrom(start) };
        const saved = this.noStructLiteral;
        this.noStructLiteral = false;
        const inner = this.parseExpr();
        this.noStructLiteral = saved;
        this.expect(")");
        return inner;
      }
      if (t.text === "{") {
        return { kind: "block", block: this.parseBlock(), span: this.spanFrom(start) };
      }
      if (t.text === "|") {
        return this.parseClosure();
      }
      this.fail("expected expression");
    }

    // identifiers and keywords
    switch (t.text) {
      case "true":
      case "false":
        this.next();
        return { kind: "bool", value: t.text === "true", span: this.spanFrom(start) };
      case "if":
        return this.parseIf();
      case "match":
        return this.parseMatch();
      case "emit": {
        this.next();
        const path = this.parsePath();
        if (!this.at("{")) this.fail("expected effect fields after `emit`");
        const effect = this.parseStructLit(path);
        return { kind: "emit", effect, span: this.spanFrom(start) };
      }
    }

    const path = this.parsePath();
    if (this.at("{") && !this.noStructLiteral && this.looksLikeStructLit()) {
      return this.parseStructLit(path);
    }
    return path;
  }

  private parsePath(): ast.Path {
    const start = this.start();
    const segments = [this.expectIdent()];
    while (this.at("::")) {
      this.next();
      segments.push(this.expectIdent());
    }
    return { kind: "path", segments, span: this.spanFrom(start) };
  }

  // After a path, `{` is a struct literal if it is followed by `}` or by
  // `ident ,` / `ident :` / `ident }`. Otherwise it is a block (e.g. the
  // body of a view element that had no arguments — not currently valid, but
  // this keeps the rule local).
  private looksLikeStructLit(): boolean {
    const a = this.peek(1);
    const b = this.peek(2);
    if (a.kind === "punct" && a.text === "}") return true;
    if (a.kind !== "ident") return false;
    return b.kind === "punct" && (b.text === "," || b.text === ":" || b.text === "}");
  }

  private parseStructLit(path: ast.Path): ast.StructLit {
    this.expect("{");
    const fields: ast.FieldInit[] = [];
    while (!this.at("}")) {
      const start = this.start();
      const name = this.expectIdent("field name");
      let value: ast.Expr;
      if (this.eat(":")) {
        value = this.parseExpr();
      } else {
        value = { kind: "path", segments: [name], span: this.spanFrom(start) };
      }
      fields.push({ name, value, span: this.spanFrom(start) });
      if (!this.eat(",")) break;
    }
    this.expect("}");
    return { kind: "struct", path, fields, span: { start: path.span.start, end: this.spanFrom(path.span.start).end } };
  }

  private parseClosure(): ast.Closure {
    const start = this.start();
    this.expect("|");
    const params: ast.ClosureParam[] = [];
    while (!this.at("|")) {
      const pstart = this.start();
      const name = this.expectIdent("closure parameter");
      let type: ast.Type | null = null;
      if (this.eat(":")) type = this.parseType();
      params.push({ name, type, span: this.spanFrom(pstart) });
      if (!this.eat(",")) break;
    }
    this.expect("|");
    const body = this.parseExpr();
    return { kind: "closure", params, body, span: this.spanFrom(start) };
  }

  private parseIf(): ast.If {
    const start = this.start();
    this.expect("if", "ident");
    const condition = this.withNoStructLiteral(() => this.parseExpr());
    const then = this.parseBlock();
    let otherwise: ast.Block | ast.If | null = null;
    if (this.eat("else", "ident")) {
      otherwise = this.atKeyword("if") ? this.parseIf() : this.parseBlock();
    }
    return { kind: "if", condition, then, otherwise, span: this.spanFrom(start) };
  }

  private parseMatch(): ast.Match {
    const start = this.start();
    this.expect("match", "ident");
    const scrutinee = this.withNoStructLiteral(() => this.parseExpr());
    this.expect("{");
    const arms: ast.MatchArm[] = [];
    while (!this.at("}")) {
      const astart = this.start();
      const pattern = this.parsePattern();
      this.expect("=>");
      const body = this.parseExpr();
      arms.push({ pattern, body, span: this.spanFrom(astart) });
      // A `,` is optional after a block-bodied arm, required otherwise.
      const blockLike = body.kind === "block" || body.kind === "if" || body.kind === "match";
      if (!this.eat(",") && !blockLike && !this.at("}")) this.fail("expected `,` after match arm");
    }
    this.expect("}");
    return { kind: "match", scrutinee, arms, span: this.spanFrom(start) };
  }

  // ---------------------------------------------------------------- patterns

  private parsePattern(): ast.Pattern {
    const start = this.start();
    if (this.eat("_", "ident")) {
      return { kind: "wildcard", span: this.spanFrom(start) };
    }
    const segments = [this.expectIdent("pattern")];
    while (this.eat("::")) segments.push(this.expectIdent());
    const args: ast.Pattern[] = [];
    let hasArgs = false;
    if (this.eat("(")) {
      hasArgs = true;
      while (!this.at(")")) {
        args.push(this.parsePattern());
        if (!this.eat(",")) break;
      }
      this.expect(")");
    }
    // A single lowercase-initial segment with no arguments binds a variable;
    // anything else names a variant or constant.
    const single = segments.length === 1 && !hasArgs;
    const first = segments[0]!;
    if (single && /^[a-z_]/.test(first)) {
      return { kind: "bind", name: first, span: this.spanFrom(start) };
    }
    return { kind: "path", segments, args, span: this.spanFrom(start) };
  }
}
