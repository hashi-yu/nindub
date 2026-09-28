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
