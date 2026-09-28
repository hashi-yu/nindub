# Todo Terrain

English | [日本語](README.ja.md)

The Terrain for [`../todo.nindub`](../todo.nindub): a TypeScript service, written from the Map's outline, that answers Survey over the harness protocol ([docs/SURVEY.md](../../docs/SURVEY.md)) and also exposes the product's real routes. No dependencies; Node runs it directly.

```sh
node examples/todo-terrain/src/server.ts                       # PORT=3000 by default
node src/cli.ts survey examples/todo.nindub --terrain http://127.0.0.1:3000 --steps 300
```

`npm test` runs the Survey against this Terrain for five seeds of 300 steps each.

## Layout, and how it follows the Map

| Map | Terrain |
|---|---|
| `region api: Service(ts)` | `src/api/todos.ts` (actions and queries), `src/server.ts` (the process) |
| `region store: Postgres` | `src/store/memory.ts` — **in memory, not Postgres; see the Amendment below** |
| `region directory: External`, `port Directory` | `Deps.directory` in `src/domain.ts`; the production client in `src/server.ts` |
| `region mailer: Outbound`, `effect SendMail` | `Deps.mail`; emitted as data under Survey, logged in production |
| `road sql -> store`, `road http -> directory`, `road mail -> mailer` | the three fields of `Deps` |
| `inject clock`, `inject ids` | `Deps.now`, `Deps.freshId` |
| `region browser: Client` | not realized yet (views need the browser instrument) |

Every function or type that realizes a Map element carries a Pin comment, `/** @nindub action create at POST /todos */`. Pins point from the Terrain to the Map (D17); the Map does not mention this directory.

The real routes (`POST /todos`, `GET /todos`, `GET /todos/{id}`, `POST /todos/{id}/complete`, `DELETE /todos/{id}`, user in the `x-user` header) and the harness endpoint call the same functions in `src/api/todos.ts`; only the `Deps` differ.

## Realize log

What Survey found while this Terrain was being made to pass, in order.

1. **Seed 1, 300 steps: no Drift.** The logic matched on the first run.
2. **Seed 2, step 6, `list("u1")`: Drift in result.** The Map answered `[]`; the Terrain answered ten todos. They were the previous seed's rows: Survey starts every run from the Map's initial state but had no way to tell the Terrain to do the same. This was a gap in the harness, not in the Terrain. Fixed by adding `POST /__nindub/reset` to the protocol; Survey now calls it before each run.
3. **Seeds 1 to 5, 300 steps each: no Drift.**

## Amendment 1: `region store` is declared `Postgres`, this Terrain uses memory

The Map says `region store: Postgres`. This Terrain keeps rows in a `Map` in memory. Survey over the harness protocol cannot see the difference (D22 states this limitation); the database instrument of D21, once it exists, would.

The options were (D18): **accept** (change the Map to `region store: Store` and Remap), **reject** (this Terrain must grow a Postgres store), or **discretion**.

**Ruling: discretion** (2026-09-28). The Map keeps `Postgres`: it states the intended production store, and that intent is right. This example Terrain is a stand-in for the store, and says so here. No Remap. When the database instrument exists, a Terrain that claims to realize `region store` will have to be Postgres, or raise a new Amendment.
