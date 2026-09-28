// Abstract syntax of a Nindub Map. See docs/LANGUAGE.md.
//
// Every node carries a `span` so that errors and, later, Amendments can
// point at source positions.

import type { Span } from "./lexer.ts";

export interface Node {
  span: Span;
}

// ------------------------------------------------------------------ Map

export interface MapDecl extends Node {
  name: string;
  items: Item[];
}

export type Item =
  | TypeAlias
  | Opaque
  | Struct
  | Enum
  | Inject
  | State
  | Invariant
  | Port
  | Effect
  | Action
  | Query
  | View;

export interface ItemBase extends Node {
  doc: string[]; // doc comment lines preceding the item
}

export interface TypeAlias extends ItemBase {
  kind: "type";
  name: string;
  type: Type;
}

export interface Opaque extends ItemBase {
  kind: "opaque";
  name: string;
}

export interface Struct extends ItemBase {
  kind: "struct";
  name: string;
  fields: Field[];
}

export interface Field extends Node {
  name: string;
  type: Type;
}

export interface Enum extends ItemBase {
  kind: "enum";
  name: string;
  variants: Variant[];
}

export interface Variant extends Node {
  name: string;
  fields: Type[]; // tuple-style payload; empty for a bare variant
}

export interface Inject extends ItemBase {
  kind: "inject";
  name: string;
  type: Type;
}

export interface State extends ItemBase {
  kind: "state";
  name: string;
  type: Type;
}

export interface Invariant extends ItemBase {
  kind: "invariant";
  description: string;
  body: Block;
}

export interface Port extends ItemBase {
  kind: "port";
  name: string;
  fns: FnSig[];
}

export interface FnSig extends Node {
  name: string;
  params: Param[];
  returns: Type;
}

export interface Effect extends ItemBase {
  kind: "effect";
  name: string;
  fields: Field[];
}

export interface Action extends ItemBase {
  kind: "action";
  name: string;
  params: Param[];
  returns: Type;
  body: Block;
}

export interface Query extends ItemBase {
  kind: "query";
  name: string;
  params: Param[];
  returns: Type;
  body: Block;
}

export interface View extends ItemBase {
  kind: "view";
  name: string;
  params: Param[];
  body: Block;
}

export interface Param extends Node {
  name: string;
  type: Type;
}

// ------------------------------------------------------------------ Types

export type Type = NamedType | UnitType;

export interface NamedType extends Node {
  kind: "named";
  name: string;
  args: Type[];
}

export interface UnitType extends Node {
  kind: "unit";
}

// ------------------------------------------------------------------ Statements

export type Stmt = Let | Requires | Assign | ExprStmt | For;

export interface Let extends Node {
  kind: "let";
  pattern: Pattern;
  value: Expr;
  orElse: Expr | null; // `let p = e else err;`
}

export interface Requires extends Node {
  kind: "requires";
  condition: Expr;
  orElse: Expr;
}

export interface Assign extends Node {
  kind: "assign";
  target: Expr;
  value: Expr;
}

export interface ExprStmt extends Node {
  kind: "expr";
  expr: Expr;
  // `item(...) { ... }`: children of a view element.
  children: Block | null;
  // false when the expression is the block's tail (no trailing `;`).
  terminated: boolean;
}

export interface For extends Node {
  kind: "for";
  pattern: Pattern;
  iterable: Expr;
  body: Block;
}

export interface Block extends Node {
  stmts: Stmt[];
}

// ------------------------------------------------------------------ Expressions

export type Expr =
  | UnitLit
  | IntLit
  | StringLit
  | BoolLit
  | Path
  | StructLit
  | Call
  | MethodCall
  | FieldAccess
  | Index
  | Unary
  | Binary
  | Range
  | Closure
  | If
  | Match
  | BlockExpr
  | Emit;

// `()`
export interface UnitLit extends Node {
  kind: "unit";
}

export interface IntLit extends Node {
  kind: "int";
  value: bigint;
}

export interface StringLit extends Node {
  kind: "string";
  value: string;
}

export interface BoolLit extends Node {
  kind: "bool";
  value: boolean;
}

// `x`, `Error::NotFound`, `Ok`
export interface Path extends Node {
  kind: "path";
  segments: string[];
}

export interface StructLit extends Node {
  kind: "struct";
  path: Path;
  fields: FieldInit[];
}

export interface FieldInit extends Node {
  name: string;
  value: Expr; // for shorthand `{ id }`, a Path to `id`
}

export interface Arg extends Node {
  name: string | null; // `done: t.done` in a view element
  value: Expr;
}

export interface Call extends Node {
  kind: "call";
  callee: Expr;
  args: Arg[];
}

export interface MethodCall extends Node {
  kind: "method";
  receiver: Expr;
  method: string;
  args: Arg[];
}

export interface FieldAccess extends Node {
  kind: "field";
  object: Expr;
  field: string;
}

export interface Index extends Node {
  kind: "index";
  object: Expr;
  index: Expr;
}

export type UnaryOp = "!" | "-";

export interface Unary extends Node {
  kind: "unary";
  op: UnaryOp;
  operand: Expr;
}

export type BinaryOp =
  | "||"
  | "&&"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "+"
  | "-"
  | "*"
  | "/";

export interface Binary extends Node {
  kind: "binary";
  op: BinaryOp;
  left: Expr;
  right: Expr;
}

export interface Range extends Node {
  kind: "range";
  start: Expr;
  end: Expr;
  inclusive: boolean;
}

export interface Closure extends Node {
  kind: "closure";
  params: ClosureParam[];
  body: Expr;
}

export interface ClosureParam extends Node {
  name: string;
  type: Type | null;
}

export interface If extends Node {
  kind: "if";
  condition: Expr;
  then: Block;
  otherwise: Block | If | null;
}

export interface Match extends Node {
  kind: "match";
  scrutinee: Expr;
  arms: MatchArm[];
}

export interface MatchArm extends Node {
  pattern: Pattern;
  body: Expr;
}

export interface BlockExpr extends Node {
  kind: "block";
  block: Block;
}

export interface Emit extends Node {
  kind: "emit";
  effect: StructLit;
}

// ------------------------------------------------------------------ Patterns

export type Pattern = WildcardPattern | BindPattern | PathPattern;

export interface WildcardPattern extends Node {
  kind: "wildcard";
}

// A lowercase identifier binds; see parser for the rule.
export interface BindPattern extends Node {
  kind: "bind";
  name: string;
}

// `Ok(t)`, `Err(Error::NotFound)`, `Error::Forbidden`
export interface PathPattern extends Node {
  kind: "path";
  segments: string[];
  args: Pattern[];
}
