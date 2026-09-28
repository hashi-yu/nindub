# The Nindub Language

English | [日本語](LANGUAGE.ja.md)

**Status: draft.** The syntax is decided by example, and the current example is [`examples/todo.nindub`](../examples/todo.nindub). This document explains what is in that file. Nothing here is implemented yet.

## Flavor

Nindub reads like Rust: `struct`, `enum`, `fn`, `let`, `match`, `Result<T, E>`, closures, `//` comments. The resemblance is deliberate (see [D16](DESIGN.md#d16-the-syntax-is-rust-flavored)). What differs is the top-level vocabulary: a Map is not made of functions and modules but of the constructs below, each of which corresponds to something Survey can observe.

## Top-level constructs

| Construct | What it declares | What Survey observes |
|---|---|---|
| `map Name;` | The Map's name. One per file. | — |
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
- Collections: `Table<T>` (keyed by `id`) with `get`, `insert`, `remove`, `filter`, `all`, `unique_by`, `sorted_by`; `Vec<T>`; `Option<T>`.

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

## Pins live in the Terrain, not in the Map

The Map never names a file, a route or a framework. Where an element is realized is the Terrain's discretion (D5), and the Map must not change because the Terrain was reorganized (D17). So a Pin points from the Terrain up at the Map, not the other way round:

```ts
// src/api/todos.ts
/** @nindub action create via http POST /todos */
export async function create(user: UserId, title: string) { ... }
```

- The annotation names the Map element the code realizes.
- `via` names the transport through which Survey observes it: `http ...` for actions and queries, `browser ...` for views. State is never observed; ports and effects are observed at the boundary they cross.

The Nindub tool collects Pins into a generated index next to the Map (`todo.pins`, committed like a lockfile). Zoom reads the index; a viewer shows Pins overlaid on the Map. Projection is generated from the element's signature in the Map and the transport in its Pin (D7).

## Amendments

While Realizing, AI will find places where the Map is wrong, incomplete or silent. It does not edit the Map. It submits an Amendment: a diff to the Map, with a reason, and the Survey result of the current Terrain against the unamended Map so that the behavior the change would permit is visible. A human accepts it (the Map changes), rejects it (the Terrain must change), or rules it discretion (the Map stays silent on purpose). See D18.

## Not yet designed

- `event`: input that arrives asynchronously (a webhook, a timer). Needed for D6's asynchrony story.
- Sessions and authentication: `user: UserId` is passed explicitly everywhere for now.
- Modules: a Map is one file; how large Maps are sectioned is open.
- The Terrain-side shape of `browser(...)` observation (accessibility tree is the candidate).
