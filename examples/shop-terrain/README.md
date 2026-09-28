# Shop Terrain

English | [日本語](README.ja.md)

The Terrain for [`../shop.nindub`](../shop.nindub): a TypeScript service written from the Map's outline, answering Survey over the harness protocol ([docs/SURVEY.md](../../docs/SURVEY.md)) and exposing the product's real routes. No dependencies.

```sh
node examples/shop-terrain/src/server.ts                       # PORT=3001 by default
node src/cli.ts survey examples/shop.nindub --terrain http://127.0.0.1:3001 --steps 600
```

`npm test` surveys it for eight seeds of 600 steps and replays the scripts below.

## Layout

| Map | Terrain |
|---|---|
| `region api::catalog`, `::cart`, `::orders`, `::staff` | `src/api/catalog.ts`, `cart.ts`, `orders.ts`, `staff.ts` |
| `region api` (the process) | `src/server.ts`; the harness endpoints in `src/harness.ts` |
| `region db: Postgres` | `src/store/nindub.ts`: Nindub's store (D23) with its in-memory backend, a stand-in as in the Todo Terrain (Amendment 1 there, ruled discretion). Survey reads it through `POST /__nindub/state` |
| `port Payments` | `Deps.payments` |
| `effect Ship`, `Receipt`, `Refunded` | `Deps.shipping`, `Deps.mail` |
| `inject clock`, `ids` | `Deps.now`, `Deps.freshId` |
| `region web: Client` | not realized (views need the browser instrument) |

Actions are atomic here too: the harness snapshots the store before a call and restores it when the call returns `Err` or fails, discarding the effects it emitted. `place` charges before it touches stock, so a declined payment changes nothing either way.

## Realize log

This Terrain was written from the outline and the intent, not by transcribing the Map's bodies, so that Survey had something to find. It did.

1. **Seed 1, step 306, `products()`: Drift in result.** The Map sorts by name with plain string comparison (code units: `"Buy milk"` before `"a"`); the Terrain used `localeCompare` (`"a"` before `"Buy milk"`). A collation difference of exactly the kind that separates a JavaScript sort from a database `ORDER BY`. Fixed in the Terrain.
2. **Seeds 1–5 × 400: no Drift.** But one known difference remained uncaught: adding a sku already in the cart. The Map removes the old line and appends the merged one, so the line moves to the end; the Terrain updated it in place. **Seeds 10–39 × 600: Drift in 2 of 30 runs**, both around step 480, both on `cart(...)`. A 7-step script reproduces it. Two lessons: the random generator does reach such states, but rarely, because it needs a cart with two skus, a repeat add, and a read before a `place` empties the cart; and once found, a Drift is worth keeping as a script (`terrain.test.ts`), which is what the reproducing sequence is for.
3. **The Terrain was made to conform** (merged line moved to the end) while Amendment 2 asked whether the Map meant that.
4. **Amendment 2 accepted; first Remap.** The Map now keeps a merged line in place; the Terrain went back to updating in place. The 7-step script stays in the test and now checks the accepted behavior on both sides.

## Amendment 2: should a merged cart line move to the end?

`add_to_cart` for a sku already in the cart was written in the Map as `others.push(Line { ... })`: the merged line went last. Whether that was intent or an accident of how the body was written is a human question (D18). Most carts keep a line where it was.

The options were: **accept** (Map keeps the line's position; Remap), **reject** (Map means what it says), **discretion** (make cart order unobservable).

**Ruling: accept** (2026-09-28). It was an accident of the body, not intent. The Map was Remapped: `add_to_cart` now maps over the existing lines, replacing the matching one, and appends only when the sku is new. This is the first Remap in the project, and it went the way D18 describes: the Terrain's author noticed, Survey made the difference concrete, the human ruled, the Map changed.
