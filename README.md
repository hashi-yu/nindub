# Nindub

English | [日本語](README.ja.md)

> The map precedes the territory.

A very-high-level language for AI-driven development without specs.

You write your whole project as a single **Map** in Nindub. The Map is executable, testable, and the single source of truth. **Zoom** into any element of the Map and you reach the implementation that AI wrote for it (the **Terrain**). **Survey** mechanically verifies that the Terrain conforms to the Map.

We call this way of working **Nindub Driven Development**.

See [GLOSSARY.md](GLOSSARY.md) for the vocabulary, [docs/DESIGN.md](docs/DESIGN.md) for the design decisions made so far and why, and [docs/LANGUAGE.md](docs/LANGUAGE.md) with [examples/todo.nindub](examples/todo.nindub) for what a Map looks like.

## Development

The tool is written in TypeScript and runs on Node 22.18 or later with no build step.

```sh
npm install
npm run check                                  # typecheck + tests
node src/cli.ts outline examples/todo.nindub   # the territory: regions, roads, signatures
node src/cli.ts run examples/todo.nindub       # run the Map alone; type :help
node src/cli.ts parse examples/todo.nindub     # print a Map's AST as JSON

node src/cli.ts serve examples/todo.nindub     # serve the Map itself as a Terrain, then in another shell:
node src/cli.ts survey examples/todo.nindub --terrain http://127.0.0.1:PORT --steps 200
```

See [docs/SURVEY.md](docs/SURVEY.md) for how a Terrain answers Survey.

## Documentation

All documents are written in both English and Japanese. The English version lives in `NAME.md` and the Japanese version in `NAME.ja.md`. The two are always kept in sync.

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this project by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
