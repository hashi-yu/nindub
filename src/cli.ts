#!/usr/bin/env node
// nindub command line.
//
//   nindub parse <file.nindub>   print the AST as JSON

import { readFileSync } from "node:fs";
import { LexError } from "./lexer.ts";
import { parse, ParseError } from "./parser.ts";

function usage(): never {
  process.stderr.write("usage: nindub parse <file.nindub>\n");
  process.exit(2);
}

const [command, file] = process.argv.slice(2);
if (command !== "parse" || !file) usage();

try {
  const map = parse(readFileSync(file, "utf8"));
  process.stdout.write(
    JSON.stringify(map, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2) + "\n",
  );
} catch (e) {
  if (e instanceof ParseError || e instanceof LexError) {
    process.stderr.write(`${file}:${e.message}\n`);
    process.exit(1);
  }
  throw e;
}
