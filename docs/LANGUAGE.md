# The Nindub Language

English | [日本語](LANGUAGE.ja.md)

**Status: draft.** The syntax is decided by example, and the current example is [`examples/todo.nindub`](../examples/todo.nindub). This document explains what is in that file. The parser, the interpreter (`nindub run`), the outline (`nindub outline`) and Survey over the harness protocol (`nindub survey`, see [SURVEY.md](SURVEY.md)) exist.

## Flavor

Nindub reads like Rust: `struct`, `enum`, `fn`, `let`, `match`, `Result<T, E>`, closures, `//` comments. The resemblance is deliberate (see [D16](DESIGN.md#d16-the-syntax-is-rust-flavored)). What differs is the top-level vocabulary: a Map is not made of functions and modules but of the constructs below, each of which corresponds to something Survey can observe.

## Territory: regions and roads

A Map reads top-down. The top of the file is the **territory**: which regions exist, what lives in each, and what talks to what. Bodies come last, in `impl` blocks, so that the first screen of the file is the whole project at a glance (D21).

```rust
region api: Service(ts) {
    road sql  -> store;
    road http -> directory;

    action create(user: UserId, title: Text) -> Result<TodoId, Error>;
    query  list(user: UserId)                -> Vec<Todo>;
}

region store: Postgres {
    state todos: Table<Todo>;
    invariant "ids are unique";
}

impl api {
    action create(user: UserId, title: Text) -> Result<TodoId, Error> { ... }
    query  list(user: UserId) -> Vec<Todo> { ... }
}
```

- A **region** is a bounded part of the territory: a browser, a process, a database, an external service, an outbound channel. Items declared inside it live there. Regions nest (`region api { region todos { ... } }`, `impl api::todos { ... }`).
- A region's **kind** decides what may live in it and which instrument Survey observes it with:

  | Kind | May contain | Instrument |
  |---|---|---|
  | `Client` | `view` | browser (accessibility tree) |
  | `Service(lang)` | `action`, `query` | HTTP client |
  | `Postgres`, `Store` | `state`, `invariant` | database reader |
  | `External` | `port` | network boundary: requests captured, responses injected |
  | `Outbound` | `effect` | outbound boundary: effects captured, never performed |

  Types and `inject` may live anywhere, including outside any region. A region with no kind accepts anything and is observed by nothing in particular.
- A **road** `road name -> region;` declares that the enclosing region may reach the target. A body that uses an item from another region must have a road there (or the two regions must contain one another); otherwise resolution fails. Roads are how module dependencies are stated, and checked, in the Map.
- An item declared with a signature only (`action create(...) -> ...;`) must be defined exactly once in an `impl` of its region, with the same signature. A small Map may skip `impl` and write bodies inline.
- Item names are global; regions group items, they do not namespace them.

`nindub outline file.nindub` prints the territory without bodies; `--depth 1` prints regions and roads only. It is derived, so it is available even when a Map inlines its bodies.

## Top-level constructs

| Construct | What it declares | What Survey observes |
|---|---|---|
| `map Name;` | The Map's name. One per file. | — |
| `region name: Kind(args) { roads; items }` | A bounded part of the territory and what lives in it. | Through the instrument its kind names |
| `road name -> region;` | That the enclosing region may reach another. | As a dependency constraint on the Terrain |
| `impl region { items }` | Bodies for items the region declared. | — |
| `fn name(args) -> T { ... }` | A pure helper: callable from bodies in its region, never from outside. It may not change state, emit, call ports or call actions. May be declared in the region or defined only in an `impl` (private). | — |
| `struct`, `enum`, `type`, `opaque` | Types. `opaque` names a type whose contents the Map never sees (users from an external directory). | — |
| `inject name: Kind;` | A source of nondeterminism the Map needs: `Clock`, `IdSource`, `Random`. Supplied by Survey to both sides (D8). | The values supplied |
| `state name: Type;` | State the Map keeps. Must be reachable from some query or view (D9). | Never directly (D6) |
| `invariant "text" { expr }` | A condition that must hold on the state after every action. | Checked on the Map; on the Terrain, through queries |
| `action name(args) -> Result<T, E> { ... }` | An operation that may change state. | Result and error kind |
| `query name(args) -> T { ... }` | An operation that reads state without changing it. | Result |
| `view Name(args) { ... }` | A screen: what it shows and what can be acted on. | Its structure, as data |
| `effect Name { fields }` | A side effect on the world, emitted with `emit`, never performed. | The sequence of emitted effects |
| `port Name { fn ...; }` | An external service. Called like `Name.fn(...)`. | Requests made; responses are injected |

## Inside a body

- `requires cond else Error::Variant;` — a precondition. Failing it returns the named error. This is how errors are declared and made comparable by kind (D10).
- `let x = expr else Error::Variant;` — bind, or fail with the error if the expression is absent.
- `emit EffectName { ... };` — record an effect.
- `Port.fn(...)` — make a request to a port. The response is whatever Survey injects.
- `inject`ed values are used as `clock.now()`, `ids.fresh()`.
- Collections: `Table<T>` (keyed by `id`) with `get`, `insert`, `remove`, `contains`, `len`, `is_empty` and the sequence methods; `Vec<T>` with literals `[a, b]` and `filter`, `map`, `all`, `any`, `find`, `first`, `contains`, `push` (returns a new Vec), `sum`, `unique_by`, `sorted_by`, `len`, `is_empty`; `Option<T>` with `is_some`, `is_none`, `unwrap_or`.
- After `.`, keywords are ordinary names: `xs.map(...)` is fine although `map` opens the file.
- A block's value is its last expression when it has no `;`; an `if` or `match` at the end of a body is the body's value.

## Inside a view

A view body is a sequence of elements. Each element is either content or an affordance:

| Element | Kind |
|---|---|
| `heading(text)`, `text(text)`, `item(text, ...attrs) { children }` | content |
| `button(label, action_call)` | affordance: performs an action |
| `form(label, \|fields\| action_call)` | affordance: collects input, then performs an action |
| `link(label, ViewCall)` | affordance: navigates to another view |
| `.then(ViewCall)` | after an affordance's action, navigate |

Control flow (`if`, `for`, `match`) is ordinary. A view may call queries, never actions directly; actions are reachable only through affordances, so that what the user can do is exactly what the view declares.

## Running a Map alone

The interpreter runs a Map with no Terrain. Every call to an action, query or view returns an **Observation**: the result, the effects emitted, and the requests made to ports with the responses that were injected.

```
$ node src/cli.ts run examples/todo.nindub
> :port Directory.email_of Ok("alice@example.com")
> create("alice", "Buy milk")
{ "action": "create", "result": { "Ok": "id-1" } }
> complete("alice", "id-1")
{ "action": "complete", "result": { "Ok": null },
  "effects": [{ "to": "alice@example.com", "subject": "Done: Buy milk", "body": "You completed \"Buy milk\"." }],
  "ports": [{ "Directory.email_of": ["alice"], "response": { "Ok": "alice@example.com" } }] }
> List("alice")
```

In the REPL, string literals stand in for ids. Ids and the clock come from injected sources that count up deterministically; port responses are whatever `:port` set.

### Semantics worth knowing

- **An action is atomic.** If it returns `Err`, every state change and every effect it produced is discarded. Invariants are checked after each successful action; a violation is reported as a Map bug, separately from the action's own result.
- **Locals are snapshots.** `let todo = todos.get(id)` copies; a later `todos[id].done = true` does not change `todo`. Only `state` is mutable, and only through assignment to a place rooted in a state name or through `insert`/`remove` on a state Table.
- **Queries cannot call actions.** Actions may call other actions; their effects and port requests fold into the caller's Observation.
- **In a view, an action call is an affordance.** `button("Done", complete(user, id))` records that the button would call `complete` with those arguments; nothing runs. A query call in a view runs. Rendering a view therefore never changes state or emits effects.
- **`let x = e else err;`** unwraps `Some`/`Ok`, or returns `Err(err)` from the enclosing action or query. `requires c else err;` returns `Err(err)` when `c` is false.

## Pins live in the Terrain, not in the Map

The Map never names a file, a route or a framework. Where an element is realized is the Terrain's discretion (D5), and the Map must not change because the Terrain was reorganized (D17). So a Pin points from the Terrain up at the Map, not the other way round:

```ts
// src/api/todos.ts
/** @nindub action create at POST /todos */
export async function create(user: UserId, title: string) { ... }
```

- The annotation names the Map element the code realizes.
- Which instrument observes the element follows from the kind of the region it lives in (D21), not from the Pin. The Pin may add instrument-specific detail, such as an action's route or a view's URL.

The Nindub tool collects Pins into a generated index next to the Map (`todo.pins`, committed like a lockfile). Zoom reads the index; a viewer shows Pins overlaid on the Map. Projection is generated from the element's signature in the Map, its region's kind, and the detail in its Pin (D7).

## Amendments

While Realizing, AI will find places where the Map is wrong, incomplete or silent. It does not edit the Map. It submits an Amendment: a diff to the Map, with a reason, and the Survey result of the current Terrain against the unamended Map so that the behavior the change would permit is visible. A human accepts it (a Remap: the Map changes), rejects it (the Terrain must change), or rules it discretion (the Map stays silent on purpose). See D17 and D18.

## Not yet designed

- `event`: input that arrives asynchronously (a webhook, a timer). Needed for D6's asynchrony story.
- Sessions and authentication: `user: UserId` is passed explicitly everywhere for now.
- Modules: a Map is one file; how large Maps are sectioned is open.
- The Terrain-side shape of `browser(...)` observation (accessibility tree is the candidate).
