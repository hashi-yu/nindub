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

Views are not surveyed yet; that needs the browser instrument.

## Planning the next call (`--plan`)

By default step 1 picks a call at random. With `--plan`, Survey uses the Map to decide what to do next. The Map is a program Survey can run and copy, so it can try a call before making it; the Terrain is only ever sent the call that was chosen.

- **Read what was just written.** Every state cell an action wrote (`carts[u2]`, say) is owed a read until a query has read it on both sides. When something is owed, the next call is the query whose reads cover the most of it, with arguments drawn from the ids seen so far. Queries are pure, so candidates are tried on the Map itself. A Drift in state therefore shows at the first step where the Terrain's output can show it, instead of whenever a random read happens to come by.
- **Otherwise, do something new.** Candidate actions are tried on a fork of the Map, and the one that makes the rarest kind of step in this run is made. A kind of step is the action, the branches its body took, and the shape of what it wrote: how many lines a cart has, which status an order is in, whether a sequence grew or was reordered. Candidate arguments favour the ids found in recently written cells, so that one call can build on the last. This is coverage guidance as in fuzzing, with the Map's own control flow and state as the coverage.

Planned reads are marked `*` in the report. When a Drift is found, the report also names the step that last wrote each cell the drifting call read:

```
 9   add_to_cart("u2", "id-1", 2)                   ok
10 * cart("u2")                                     DRIFT in result
    map:     [{"sku":"id-5",...},{"sku":"id-1",...}]
    terrain: [{"sku":"id-1",...},{"sku":"id-5",...}]
    carts[u2] was last written at step 9
```

Measured on the Shop before Amendment 2 (the Map moved a merged cart line to the end, the Terrain kept it in place), seeds 10 to 39: random generation found the Drift in 2 of 30 runs of 600 steps, planning in 16 of 30; with 1200 steps, 3 of 30 and 23 of 30. Planning spends roughly half its steps on reads. What it cannot do is reach state that no query with known arguments reads; that stays a limit of observing a Terrain from outside.

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

`nindub serve examples/todo.nindub` serves the Map itself behind this protocol, which is the reference for what a conforming Terrain answers.

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
