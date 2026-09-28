// Lexer for Nindub. Turns source text into a flat token list.
//
// Comments are dropped except doc comments (`///` and `//!`), which are kept
// as tokens so the parser can attach them to the following item.

export type TokenKind =
  | "ident"
  | "int"
  | "string"
  | "doc" // `///` or `//!` comment; `text` holds the comment body
  | "punct"
  | "eof";

export interface Pos {
  line: number; // 1-based
  col: number; // 1-based
  offset: number;
}

export interface Span {
  start: Pos;
  end: Pos;
}

export interface Token {
  kind: TokenKind;
  text: string;
  span: Span;
}

export class LexError extends Error {
  readonly pos: Pos;
  constructor(message: string, pos: Pos) {
    super(`${pos.line}:${pos.col}: ${message}`);
    this.pos = pos;
  }
}

// Longest first, so that `..=` wins over `..` and `::` over `:`.
const PUNCTS = [
  "..=",
  "::",
  "->",
  "=>",
  "..",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  ",",
  ";",
  ":",
  ".",
  "=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "!",
  "|",
  "&",
  "?",
  "#",
];

const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_]/.test(c);
const isDigit = (c: string) => /[0-9]/.test(c);

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  let line = 1;
  let col = 1;

  const pos = (): Pos => ({ line, col, offset });
  const peek = (n = 0) => source[offset + n] ?? "";
  const advance = (n = 1) => {
    for (let i = 0; i < n; i++) {
      if (source[offset] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      offset++;
    }
  };
  const push = (kind: TokenKind, text: string, start: Pos) =>
    tokens.push({ kind, text, span: { start, end: pos() } });

  while (offset < source.length) {
    const c = peek();

    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      advance();
      continue;
    }

    if (c === "/" && peek(1) === "/") {
      const start = pos();
      const isDoc = peek(2) === "/" || peek(2) === "!";
      let end = source.indexOf("\n", offset);
      if (end === -1) end = source.length;
      const raw = source.slice(offset, end);
      advance(end - offset);
      if (isDoc) {
        // Strip the marker and one optional leading space.
        push("doc", raw.slice(3).replace(/^ /, ""), start);
      }
      continue;
    }

    if (isIdentStart(c)) {
      const start = pos();
      let end = offset;
      while (end < source.length && isIdentPart(source[end]!)) end++;
      const text = source.slice(offset, end);
      advance(end - offset);
      push("ident", text, start);
      continue;
    }

    if (isDigit(c)) {
      const start = pos();
      let end = offset;
      while (end < source.length && (isDigit(source[end]!) || source[end] === "_")) end++;
      const text = source.slice(offset, end).replace(/_/g, "");
      advance(end - offset);
      push("int", text, start);
      continue;
    }

    if (c === '"') {
      const start = pos();
      advance();
      let value = "";
      for (;;) {
        const ch = peek();
        if (ch === "") throw new LexError("unterminated string", start);
        if (ch === "\n") throw new LexError("newline in string", pos());
        if (ch === '"') {
          advance();
          break;
        }
        if (ch === "\\") {
          const esc = peek(1);
          const map: Record<string, string> = { n: "\n", t: "\t", '"': '"', "\\": "\\" };
          const mapped = map[esc];
          if (mapped === undefined) throw new LexError(`unknown escape \\${esc}`, pos());
          value += mapped;
          advance(2);
          continue;
        }
        value += ch;
        advance();
      }
      push("string", value, start);
      continue;
    }

    const punct = PUNCTS.find((p) => source.startsWith(p, offset));
    if (punct) {
      const start = pos();
      advance(punct.length);
      push("punct", punct, start);
      continue;
    }

    throw new LexError(`unexpected character ${JSON.stringify(c)}`, pos());
  }

  tokens.push({ kind: "eof", text: "", span: { start: pos(), end: pos() } });
  return tokens;
}
