# Survey

English | [日本語](SURVEY.ja.md)

Survey feeds the same sequence of calls to the Map and to a Terrain and compares what comes out (D6). It is exploratory: passing means no Drift was found in what was explored (D12).

```
$ node src/cli.ts survey examples/todo.nindub --terrain http://localhost:3000 --seed 7 --steps 200
survey Todo against http://localhost:3000  seed 7  steps 23
 1 create("u1", "Buy milk")                          ok
 2 complete("u3", "id-1")                            ok
 ...
23 complete("u1", "id-1")                            DRIFT in effects
    map:     [{"name":"SendMail","fields":{"to":"a@example.com","subject":"Done: Buy milk","body":"You completed \"Buy milk\"."}}]
    terrain: []

replay with --script and these lines:
create("u1", "Buy milk")
...
```

## How a step works

1. Survey generates a call, or takes the next line of `--script`. Arguments come from the declared types: ids from those seen in earlier results (plus the occasional unknown one), texts from a list that includes the empty string and strings just inside and outside the 200-character limit, and so on. The generator is seeded, so a run repeats exactly.
2. Survey runs the call on the Map. The Observation records the result, the effects emitted, the port requests made with the responses that were injected, and the clock and id values consumed.
3. Survey sends the same call to the Terrain **with the same injected values**: the clock values, the ids, and the port responses, in order (D8). Spare port responses are added, so a Terrain that calls a port the Map did not can still finish.
4. Survey compares three channels, in order: **result**, **effects**, **ports** (which port functions were called, with which arguments). The first difference is a Drift, and the run stops with the sequence that reproduces it.
5. If the Terrain keeps its state in Nindub's store (below), Survey reads that state and compares it with the Map's: the **state** channel (D23). A Table is compared as a set of rows keyed by id; a Vec keeps its order. A divergence in state therefore shows at the step that caused it, whether or not anything reads it. `--no-state` turns this off.

Views are not surveyed yet; that needs the browser instrument.

## Planning the next call (`--plan`)

By default step 1 picks a call at random. With `--plan`, Survey uses the Map to choose, by three rules that know nothing about any particular Map:

- **Arguments come from the state.** A candidate call's ids are taken together from one row of the Map's state (a user and a sku in that user's cart), the way stateful property-based testing draws from its model. Other values, and ids the row does not offer, are generated as usual.
- **Prefer something new.** Candidate actions are tried on a fork of the Map, and one whose kind of step this run has not made yet is made; if there is none, a random call. A kind of step is the action, the branches its body took, and the shape of what it wrote (how many lines a cart has, whether a sequence grew or was reordered). This is coverage guidance as in fuzzing, with the Map's own control flow and state as the coverage.
- **Start over when stuck.** When nothing new has happened for 30 steps, both sides are reset (`:reset` in the report and in scripts). The Shop can wedge itself: a first `grant` to a user nobody knows leaves nobody able to add a sku.

The Terrain only ever sees the call that was chosen.

When a Drift is found, the report names the step that last wrote each state cell behind it:

```
 9 add_to_cart("u2", "id-1", 2)                     DRIFT in state
    map:     {"carts":[{"id":"u2","lines":[{"sku":"id-5",...},{"sku":"id-1",...}]}]}
    terrain: {"carts":[{"id":"u2","lines":[{"sku":"id-1",...},{"sku":"id-5",...}]}]}
    carts[u2] was last written at step 9
```

Measured on the Shop before Amendment 2 (the Map moved a merged cart line to the end, the Terrain kept it in place), seeds 10 to 39: random generation found the Drift in 2 of 30 runs of 600 steps; planning with the state channel in 27 of 30 (600 steps) and 29 of 30 (1200), at the `add_to_cart` step itself. No false Drift on the current Map. This is search, so it is a rate, not a guarantee (D12); an enumerative explorer over the Map's abstract states is the open alternative.

## The harness protocol

The first instrument is two HTTP endpoints on the Terrain. It is deliberately minimal: it lets the loop close before the instruments that drive a Terrain's real routes and screens exist (D22).

`POST {terrain}/__nindub/reset` — return to the initial state. Survey calls it once before a run, so that both sides start where the Map starts. Reply with any 2xx.

`POST {terrain}/__nindub/call`

```json
{
  "name": "complete",
  "args": ["u1", "id-1"],
  "clock": ["3"],
  "ids": [],
  "ports": { "Directory.email_of": [{ "Ok": "a@example.com" }, { "Err": "DirectoryError::Unknown" }] }
}
```

- `args` are the action's or query's arguments in the wire encoding below, in declaration order.
- `clock` and `ids` are the values the Terrain's clock and id source must return, in order, for this call. The Terrain must not use its own clock or generate its own ids during the call.
- `ports` maps `Port.fn` to the responses the Terrain's port client must return, in order. The Terrain must not contact the real service.

Reply:

```json
{
  "result": { "Ok": null },
  "effects": [{ "name": "SendMail", "fields": { "to": "a@example.com", "subject": "Done: Buy milk", "body": "You completed \"Buy milk\"." } }],
  "ports": [{ "port": "Directory", "fn": "email_of", "args": ["u1"] }]
}
```

- `effects` are the effects the call emitted, in order, none of them performed.
- `ports` are the requests the call made, in order.
- If the Terrain could not complete the call (it ran out of injected values, or threw), reply with `"error": "..."` and whatever `ports` were requested. Survey reports it as Drift, not as a transport failure.

`POST {terrain}/__nindub/state` — the declared state, in the Map's shape (D23):

```json
{ "todos": [{ "id": "id-1", "owner": "u1", "title": "Buy milk", "done": true, "created_at": 0 }] }
```

A Terrain that keeps its state in Nindub's store gets this for free (below). One that does not answers 404, and Survey compares observations only.

`nindub serve examples/todo.nindub` serves the Map itself behind this protocol, which is the reference for what a conforming Terrain answers.

## Nindub's store

Under D23 the Map's `state` declarations are also the shape a Terrain stores that state in, and Nindub provides that shape as a store, so that the Terrain's author writes no code for Survey to read state through. In TypeScript:

```ts
import { NindubStore } from "nindub/src/store.ts";
const store = new NindubStore(parse(readFileSync("shop.nindub", "utf8")));
const carts = store.table<CartRow>("carts"); // get, has, put, delete, all, size
```

`put` accepts a row in the wire encoding and checks it against the declared row type; a row of the wrong shape is refused when it is written, not found later. `store.state()` is what `POST /__nindub/state` answers; `store.snapshot()` and `store.restore()` let an action roll back. The store fixes only the shape of declared state. Indexes, caches, denormalized copies and everything else about how a Terrain reaches its data remain its own. The store's first backend is in memory; a `Postgres` region will be read directly by the database instrument of D21 when it exists.

## Wire encoding

The encoding is the interpreter's JSON rendering of values:

| Nindub | JSON |
|---|---|
| `()` | `null` |
| `bool`, `Int`, `Text`, `Email` | boolean, number, string, string |
| `Id<T>` | string |
| `Instant` | number |
| struct | object of its fields |
| bare enum variant | `"Enum::Variant"` |
| variant with payload | `{ "Variant": payload }` (one payload) or `{ "Variant": [payloads] }` |
| `Ok(x)`, `Err(e)`, `Some(x)`, `None` | `{ "Ok": x }`, `{ "Err": e }`, `{ "Some": x }`, `"Option::None"` |
| `Vec<T>`, `Table<T>` | array |

Object key order does not matter.
