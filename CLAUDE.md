# Notes for AI agents

- Every document is written in both English (`NAME.md`) and Japanese (`NAME.ja.md`). When you change one, change the other in the same commit.
- Use the vocabulary in `GLOSSARY.md` (Map, Terrain, Region, Road, Pin, Zoom, Scale, Observation, Action, Query, View, Effect, Port, Projection, Survey, Drift, Surface rule, Realize, Amendment, Remap). Avoid "spec", "model", and "blueprint".
- Run `npm run check` (typecheck + tests) before pushing. Source is TypeScript run directly by Node's type stripping, so use only erasable syntax: no `enum`, no parameter properties, `import type` for types, and `.ts` extensions on relative imports.
- `docs/DESIGN.md` records design decisions as numbered entries (D1, D2, ...) with what was rejected and why. Read it before proposing a design change. When a decision is made or reversed, add an entry or mark the old one superseded; never renumber.
