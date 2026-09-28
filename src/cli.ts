#!/usr/bin/env node
// nindub command line.
//
//   nindub outline <file.nindub> [--depth N]   the overview: regions, roads, signatures
//   nindub parse   <file.nindub>               print the AST as JSON
//   nindub run     <file.nindub>               run the Map alone; read calls from stdin
//   nindub survey  <file.nindub> --terrain <url> [--seed N] [--steps N] [--script file] [--plan] [--no-state]
//                                              compare the Map with a Terrain (docs/SURVEY.md)
//   nindub serve   <file.nindub> [--port N]    serve the Map itself as a Terrain (for trying survey)

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { LexError } from "./lexer.ts";
import { outline } from "./outline.ts";
import { parse, parseExpr, ParseError } from "./parser.ts";
import { resolve, ResolveError } from "./resolve.ts";
import { Runtime, RuntimeError } from "./runtime.ts";
import { formatReport, survey } from "./survey.ts";
import { HttpTerrain, RuntimeTerrain, serve } from "./terrain.ts";
import { toJSON, type Value } from "./values.ts";

function usage(): never {
  process.stderr.write(
    [
      "usage:",
      "  nindub outline <file.nindub> [--depth N]",
      "  nindub parse   <file.nindub>",
      "  nindub run     <file.nindub>",
      "  nindub survey  <file.nindub> --terrain <url> [--seed N] [--steps N] [--script file] [--plan] [--no-state]",
      "  nindub serve   <file.nindub> [--port N]",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

const jsonReplacer = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);
const show = (v: unknown) => JSON.stringify(v, jsonReplacer, 2);

function loadMap(file: string) {
  try {
    const map = parse(readFileSync(file, "utf8"));
    resolve(map); // structural checks; the result is rebuilt by Runtime
    return map;
  } catch (e) {
    if (e instanceof ParseError || e instanceof LexError || e instanceof ResolveError) {
      process.stderr.write(`${file}:${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
}

const HELP = `Type a call to an action, query or view, e.g.
  create("alice", "Buy milk")
  list("alice")
  List("alice")
Commands:
  :state                      print all state
  :port Port.fn <expr>        set the response a port returns, e.g. :port Directory.email_of Ok("a@example.com")
  :calls                      list actions, queries and views
  :help                       this text
  :quit`;

async function run(file: string) {
  const map = loadMap(file);
  const canned = new Map<string, Value>();
  const rt = new Runtime(map, {
    ports: (port, fn) => {
      const v = canned.get(`${port}.${fn}`);
      if (!v) throw new RuntimeError(`no response set for ${port}.${fn}; use :port ${port}.${fn} <expr>`);
      return v;
    },
  });
  const out = (s: string) => process.stdout.write(s + "\n");
  const interactive = process.stdin.isTTY === true;
  if (interactive) out(`Map ${map.name}. :help for commands.`);

  const rl = createInterface({ input: process.stdin, output: interactive ? process.stdout : undefined, prompt: "> " });
  if (interactive) rl.prompt();
  for await (const raw of rl) {
    const line = raw.trim();
    try {
      if (line === "" || line.startsWith("//")) {
        // skip
      } else if (line === ":quit" || line === ":q") {
        break;
      } else if (line === ":help") {
        out(HELP);
      } else if (line === ":state") {
        const state: Record<string, unknown> = {};
        for (const name of rt.states()) state[name] = toJSON(rt.getState(name));
        out(show(state));
      } else if (line === ":calls") {
        for (const c of rt.callables()) {
          out(`${c.kind} ${c.name}(${c.params.map((p) => `${p.name}: ${p.type.kind === "named" ? p.type.name : "()"}`).join(", ")})`);
        }
      } else if (line.startsWith(":port ")) {
        const m = /^:port\s+(\w+)\.(\w+)\s+(.+)$/.exec(line);
        if (!m) throw new RuntimeError("usage: :port Port.fn <expr>");
        canned.set(`${m[1]}.${m[2]}`, rt.evalTop(parseExpr(m[3]!)));
        out(`${m[1]}.${m[2]} now returns ${JSON.stringify(toJSON(canned.get(`${m[1]}.${m[2]}`)!), jsonReplacer)}`);
      } else if (line.startsWith(":")) {
        throw new RuntimeError(`unknown command ${line.split(" ")[0]}; :help lists them`);
      } else {
        const expr = parseExpr(line);
        // A direct call to an action, query or view shows its whole Observation.
        const callee = expr.kind === "call" && expr.callee.kind === "path" ? expr.callee.segments.join("::") : null;
        const callable = callee ? rt.callables().find((c) => c.name === callee) : undefined;
        if (callable && expr.kind === "call") {
          const args = expr.args.map((a) => rt.evalTop(a.value));
          const obs = rt.call(callable.name, args);
          const shown: Record<string, unknown> = { [obs.kind]: obs.name, result: toJSON(obs.result) };
          if (obs.effects.length) shown["effects"] = obs.effects.map(toJSON);
          if (obs.ports.length) {
            shown["ports"] = obs.ports.map((p) => ({ [`${p.port}.${p.fn}`]: p.args.map(toJSON), response: toJSON(p.response) }));
          }
          out(show(shown));
        } else {
          out(show(toJSON(rt.evalTop(expr))));
        }
      }
    } catch (e) {
      if (e instanceof RuntimeError || e instanceof ParseError || e instanceof LexError || e instanceof TypeError) {
        out(`error: ${e.message}`);
      } else {
        throw e;
      }
    }
    if (interactive) rl.prompt();
  }
}

// Pull `--name value` options and `--flag` switches out of argv; the rest
// are positionals.
const FLAGS = new Set(["plan", "no-state"]);
const argv = process.argv.slice(2);
const opts = new Map<string, string>();
const flags = new Set<string>();
for (let i = 0; i < argv.length; ) {
  if (argv[i]!.startsWith("--")) {
    const name = argv[i]!.slice(2);
    if (FLAGS.has(name)) {
      flags.add(name);
      argv.splice(i, 1);
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined) usage();
    opts.set(name, v);
    argv.splice(i, 2);
  } else {
    i++;
  }
}
const intOpt = (name: string, min: number): number | undefined => {
  const raw = opts.get(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) usage();
  return n;
};
const [command, file] = argv;
if (!file) usage();
switch (command) {
  case "outline": {
    const depth = intOpt("depth", 1);
    process.stdout.write(outline(loadMap(file), depth === undefined ? {} : { depth }));
    break;
  }
  case "parse":
    process.stdout.write(show(loadMap(file)) + "\n");
    break;
  case "run":
    await run(file);
    break;
  case "survey": {
    const target = opts.get("terrain");
    if (!target) usage();
    const map = loadMap(file);
    const scriptFile = opts.get("script");
    const report = await survey(map, new HttpTerrain(target), {
      ...(intOpt("seed", 0) !== undefined ? { seed: intOpt("seed", 0)! } : {}),
      ...(intOpt("steps", 1) !== undefined ? { steps: intOpt("steps", 1)! } : {}),
      ...(scriptFile ? { script: readFileSync(scriptFile, "utf8") } : {}),
      ...(flags.has("plan") ? { plan: true } : {}),
      ...(flags.has("no-state") ? { state: false } : {}),
    });
    process.stdout.write(formatReport(report, map.name, target));
    process.exit(report.drift || report.error ? 1 : 0);
  }
  case "serve": {
    const map = loadMap(file);
    const server = await serve(new RuntimeTerrain(resolve(map), map), intOpt("port", 0) ?? 0);
    process.stderr.write(`serving Map ${map.name} as a Terrain at ${server.url}/__nindub/call\n`);
    break;
  }
  default:
    usage();
}
