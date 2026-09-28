# Design Decisions

English | [日本語](DESIGN.ja.md)

This document records the decisions made so far and why. Each decision lists what was rejected, so that the same ground is not covered twice. Decisions are numbered and are never renumbered; a reversed decision is marked as superseded rather than deleted.

Vocabulary follows [GLOSSARY.md](../GLOSSARY.md).

## The problem

Spec-driven development gives an AI agent a natural-language document as the source of truth and has it implement the code. It has two sources of truth, the document and the code, and the two drift apart. A natural-language document cannot be executed or tested, so nobody notices when it becomes wrong. Maintaining it is a cost that nothing enforces.

Nindub removes the document. What remains as the source of truth must be executable, so that drift is detected mechanically.

## Decisions

### D1. The Map precedes the Terrain

The Map is written first, by humans together with AI. The Terrain is generated from the Map by AI. The Map is the single source of truth.

**Rejected:** deriving a compressed "miniature" from existing code. A miniature derived from code can only describe what the code does today, not what it should do, and it faithfully reproduces bugs. It is also either a lossy summary (and then not a source of truth) or a full copy (and then no smaller than the code).

### D2. The Map is a program, not a document

The Map is written in Nindub, a very-high-level language. It is executable and testable on its own, with no Terrain present. This is what makes it a source of truth: when the Terrain disagrees with the Map, a test fails.

**Rejected:** a structured but non-executable description (schemas plus prose, or a diagram). Anything that cannot be run cannot be checked against the Terrain.

### D3. The Map covers the whole project, not only a domain core

A Map describes everything observable about a project: state, operations, screens, side effects, and external dependencies.

**Rejected:** limiting the Map to domain logic (state, operations, invariants) and leaving UI, side effects and integrations to conventional development. This was considered when it seemed that only return values could be observed. Narrowing to a core would make Nindub a typed domain layer, indistinguishable from existing practice, and the whole-project claim is where the value is. D6 shows how the rest becomes observable.

### D4. One file, zoomable

A project is one Map file. Each element of the Map is either broken down further in Nindub or realized in the Terrain. Zoom follows a Pin from an element to where the Terrain realizes it. Scale is how deep the Zoom goes. The file is one document with nested structure, not a flat list.

*Amended by D17: Pins are not written in the Map file.*

### D5. The Surface rule decides what goes in the Map

Observable behavior belongs in the Map. Anything unobservable is the Terrain's discretion: data structures, choice of database, libraries, frameworks, optimizations.

*Generalized by D20: "observable" means checkable by some instrument, not only visible to a user. The database, the framework and the module structure can be observed with the right instrument, and a Map may claim them (D21).*

For user interfaces the line is drawn the same way. What each screen shows and what happens when the user acts on it is observable and belongs in the Map. Color, layout, typography, animation and the UI framework are the Terrain's discretion, exactly as the choice of database is. Humans judge appearance by looking; Survey judges behavior.

### D6. Survey compares observations, never state

Survey runs the same sequence of inputs against the Map and the Terrain and compares what comes out. It never inspects the Terrain's internal state. Four channels are observed:

*Amended by D23: Survey also compares the Terrain's declared state, which under D23 has the Map's shape and is read by Nindub's own code. "Never state" now means "never through a mapping anyone writes".*

| Channel | What is compared | Precedent |
|---|---|---|
| Results | return values and declared errors of actions and queries | model-based testing |
| View | the structure of each screen, as data: what is shown and what can be acted on. Never pixels. | Elm's view, the browser accessibility tree |
| Effects | side effects emitted as data (send this email, charge this card), not performed | effects as data, the outbox pattern |
| Ports | requests made to external services, declared with their types and errors | ports and adapters |

To make this possible, the Map has first-class constructs for each channel: `action`, `query`, `view`, `effect`, and `port`, alongside `state`, types, and invariants.

**Rejected:** comparing the Terrain's state with the Map's state. That requires a function that knows the Terrain's internals, which leads to D7.

### D7. Projection is mechanical

Projection is the adapter through which Survey drives and observes the Terrain. It is generated from the Map's declarations (the signatures of actions, queries, views, effects and ports) plus the transport named by the Pin (function call, HTTP, browser). No human and no AI writes it by hand.

*Amended by D21: the transport follows from the kind of the region an element lives in; the Pin adds only instrument-specific detail such as a route.*

**Rejected:** a hand-written or AI-written mapping from the Terrain's state to the Map's state. If AI writes the Projection, AI can write a Projection that makes Survey pass. That is the same hole as an agent editing the tests to make them pass. Comparing observations instead of state (D6) is what removes the need for a hand-written Projection.

### D8. Nondeterminism is injected, never ambient

Fresh identifiers, the clock, randomness and the responses of external services are inputs supplied by the Survey harness to both the Map and the Terrain. The Map has no ambient `now` or `random`. With the same seed and clock on both sides, comparison is deterministic.

### D9. Every state must be observable

Every piece of `state` in a Map must be reachable through some query or view. State that no observation reaches is, by the Surface rule, not the Map's business and is rejected by the Nindub linter.

### D10. Errors are declared, and compared by kind

Failures are declared as types in the Map (`requires ... else Forbidden`). Survey compares which failure occurred, not merely whether one did.

### D11. The Terrain's architecture is constrained, and this is accepted

Because of D6 through D8, a Terrain must expose the Map's interface, route side effects through a boundary the harness can intercept, expose its views as structured data, and accept an injected clock and id source. AI generating a Terrain from scratch can satisfy all of this; the constraints also make generated Terrains uniform.

The consequence is accepted: Nindub targets new projects whose Terrain is generated. Retrofitting a Map onto an existing codebase is not a goal.

### D12. Survey is exploratory, not proof

Survey is model-based testing: it generates sequences of inputs and looks for Drift. Passing means no Drift was found in what was explored, not that none exists. The Map's types and invariants make the exploration far better than naive random testing, but the claim is stated honestly.

### D13. Humans do not read the Terrain for behavior

Behavior is Survey's job. Performance, security, operability and appearance are not observable through Survey and remain human responsibilities. The claim is "you need not read the Terrain to know what it does", not "you never look at the Terrain".

### D14. Names, motto, and words we avoid

The language is **Nindub**, after the Sumerian architect god who drew the temple plan in the dream of Gudea of Lagash (Gudea cylinders, c. 2125 BC). Gudea built according to the plan; Nindub drew it. The method is **Nindub Driven Development**. The motto is Baudrillard's "the map precedes the territory". The vocabulary is fixed in the glossary; "spec", "model" and "blueprint" are avoided.

**Rejected:** Gudea (the builder, not the one who drew), Nawabari (taken by an active tool), Sashizu, Hinagata, Groma (each taken or generic).

### D15. Project conventions

- Open source, licensed MIT OR Apache-2.0.
- Every document is written in English (`NAME.md`) and Japanese (`NAME.ja.md`), kept in sync in the same commit.
- File extension for a Map: `.nindub` (`.gd` belongs to GDScript).

### D16. The syntax is Rust-flavored

Nindub borrows Rust's surface: `struct`, `enum`, `Result<T, E>`, `match`, `let ... else`, closures. The top-level vocabulary is Nindub's own (`state`, `action`, `query`, `view`, `effect`, `port`, `inject`, `invariant`). The first example is `examples/todo.nindub`; the constructs are described in `docs/LANGUAGE.md`.

**Rejected:** TypeScript-flavored syntax (too permissive; errors and absence are not first-class), Elm-flavored (unfamiliar to most readers and to AI), and a syntax invented from scratch (every hour spent on novel syntax is an hour not spent on the interpreter, and AI reads Rust well). A first draft put Pins in the Map as `#[pin(...)]` attributes; D17 removed them.

### D17. The Map changes only by Remap

Nothing in the Map may change because the Terrain changed. The Map changes for exactly one reason: a human accepted an Amendment (D18) and it was applied. That act is a **Remap**. Reorganizing the Terrain, renaming its files, switching its framework or database, none of these touch the Map.

A Remap is always the application of one accepted Amendment: a partial correction. It is never a regeneration of the Map from the Terrain; that direction was rejected in D1, and the Terrain informs the Map only through this one gate. What is mechanical is Survey detecting Drift, the tool regenerating the Pin index, and, where a Drift determines it, the tool drafting the Amendment; the ruling is never mechanical.

Consequently Pins are not written in the Map. A Pin is an annotation in the Terrain naming the Map element it realizes and the transport through which it is observed. The Nindub tool collects Pins into a generated index committed next to the Map; Zoom and viewers use the index, and a viewer may show Pins overlaid on the Map. The Map file itself never names a file, route or framework.

**Rejected:** Pins as attributes in the Map (`#[pin(ts = "src/api/todos.ts::create", via = http("POST /todos"))]`). It reads well and makes Zoom trivial, but it makes the Map depend on the Terrain's file layout, which is the Terrain's discretion under D5, and it forces a Map edit whenever the Terrain is reorganized, which inverts the direction of truth.

### D18. AI proposes Amendments; a human decides

While Realizing, AI will find that the Map is wrong (an invariant cannot hold), incomplete (an error case is missing, a port is needed) or silent (the Map says nothing about pagination or duplicates). AI never edits the Map. It submits an Amendment: a diff to the Map, a reason, and the Survey result of the current Terrain against the unamended Map, so that the behavior the Amendment would permit is concrete.

A human makes one of three rulings:

| Ruling | Meaning | Effect |
|---|---|---|
| Accept | the Map was wrong or incomplete | Remap: the Map changes; Survey runs against the new Map |
| Reject | the Map is right | the Terrain must change; Survey runs against the old Map |
| Discretion | the Map is silent and should stay so | nothing changes; the point is recorded as unobserved |

Only Drift raises an Amendment. Terrain changes that Survey does not detect are, by definition, within the Terrain's discretion and need no review.

This channel reopens, in a different place, the hole that D7 closed for Projection: AI could propose an Amendment that weakens the Map until Survey passes, as an agent might delete a test to make the suite pass. Unlike Projection, this cannot be closed mechanically, because whether a change to the Map is right is a question about human intent. Human acceptance is therefore not a convenience but the only defense, and the attached Survey result exists to make that review concrete. It is also why the review surface is the Map diff, which is short and high-level, and not the Terrain diff (D13).

### D19. The tool is written in TypeScript

The parser, interpreter and Survey harness are TypeScript, run directly by Node's type stripping with no build step and no runtime dependencies.

Reasons: the fastest route to a working loop, which is the project's main risk; Playwright is native to the ecosystem, and the browser accessibility tree is the candidate Projection for views; the first Terrain is TypeScript too, so the HTTP adapters share a language; and AI reads and writes TypeScript reliably.

**Rejected:** Rust. It matches the surface syntax and ships a single binary, but neither helps the interpreter exist sooner, and browser automation would go through a separate process. If performance or distribution ever matter, the interpreter's semantics will by then be pinned by tests, and a rewrite is safe.

### D20. The Map may say anything an instrument can check

The Surface rule (D5) limited the Map to what a user can observe. That made the Map a specification of behavior and nothing else: it could not say where data is stored, how the API looks, or how the project is structured, and so it looked like a spec with an interpreter attached.

The rule is generalized: **the Map may state anything that some instrument can check mechanically, and anything the Map does not state is the Terrain's discretion.** Observers other than the user count: an HTTP client, a database reader, an import-graph analyzer, a benchmark, a log sink. Each is an instrument, and each is a Projection channel.

| Concern | Instrument | How it appears in the Map |
|---|---|---|
| HTTP shape, authentication | HTTP client | region kind `Service`; routes in Pins, later in the Map |
| Persistence | database reader | region kind `Postgres`, `state` with its columns |
| External calls | network boundary | region kind `External`, `port` |
| Module structure | import-graph analysis | regions and roads |
| Language and framework | package manifest | region kind arguments, `Service(ts)` |
| Performance | benchmark | budgets (not yet designed) |
| Logging | log sink | effects |

What separates a Map from a spec is therefore not its content but its checkability: a spec may say "clean architecture"; a Map may say "region api has no road to region ui", and Survey checks it. Statements no instrument can check (naming taste, "readable") stay outside the Map, in agent instructions such as `CLAUDE.md`.

**Rejected:** keeping the Map to user-observable behavior. It is principled, but it leaves the whole "how" to the Terrain, which is exactly what a human who owns a project wants a say in, and it makes the Map indistinguishable from an executable spec.

*Amended by D23: the shape in which declared state is stored is no longer the Terrain's discretion; it is the Map's shape.*

### D21. Regions and roads: the territory at the top, the detail below

A Map is structured as a territory of **regions** connected by **roads**, with bodies in `impl` blocks after the overview.

- A region is a bounded part of the territory: a browser, a process, a database, an external service, an outbound channel. Every action, query, view, state, invariant, port and effect lives in one. Regions nest.
- A region's kind (`Client`, `Service(lang)`, `Postgres`/`Store`, `External`, `Outbound`) decides which items may live in it and which instrument Survey observes it with. This replaces the `via` transport in Pins (D7): the instrument follows from the region, the Pin adds only detail such as a route.
- A road `road name -> region;` declares that the enclosing region may reach another. A body that uses an item from another region must have a road there; resolution fails otherwise. On the Terrain, roads become import-graph constraints. This is how module dependencies are stated in the Map and checked (D20).
- The top of the file declares regions, roads and signatures; bodies follow in `impl region { ... }` blocks, and the tool checks that each declaration has exactly one body with the same signature. `nindub outline` derives the overview at any Scale, so a Map that inlines its bodies still has one.
- Item names remain global; regions group, they do not namespace. A Map with no regions is a single unnamed region with no kind, and none of the checks above apply.

**Rejected:** a flat list of items (the first draft). It is a dictionary, not a map: it says what exists but not where anything is or what talks to what, and a reader must read everything to see anything. Also rejected: making the overview a tool-only rendering. The file itself must read top-down, because the file is what humans and AI read. Also rejected: regions as namespaces. Global names keep bodies and Pins simple, and the Todo Map showed no need.

### D22. The first instrument is a harness protocol, not the Terrain's real routes

Survey's first Projection is one HTTP endpoint on the Terrain, `POST /__nindub/call`, that runs one action or query with the injected values Survey supplies (clock, ids, port responses) and answers with the result, the effects emitted and the port requests made (`docs/SURVEY.md`). Survey runs each step on the Map first and hands the Terrain exactly what the Map consumed, so both sides see the same world (D8).

This closes the loop before the instruments that drive a Terrain's real routes (`Service`), screens (`Client`) and database (`Postgres`) exist. It is a limitation, and it is stated as one: the endpoint could bypass the Terrain's real HTTP layer, so a green Survey over the protocol says the Terrain's *logic* matches the Map, not yet that its API does. The region-kind instruments of D21 replace it; the protocol stays as the reference for what an Observation of a Terrain contains.

**Rejected:** starting with real routes and a Pin index. It needs a side channel for injections on every request, a way to collect effects and port requests per request, and a browser, before the first Drift can be seen. The protocol needs none of that. Also rejected: comparing Terrain state. D6 stands; the protocol carries no state.

*Amended by D23: the protocol gains `POST /__nindub/state`, answered by Nindub's store, not by code the Terrain's author writes.*

### D23. Declared state has the Map's shape, and Survey reads it

A Map's `state` declarations are also the shape its Terrain keeps that state in. Nindub gives a Terrain that shape as a store (`src/store.ts`): one table per `state name: Table<T>`, rows in the wire encoding, checked against `T` when they are written. The store answers `POST /__nindub/state` with every state in the Map's shape, and Survey compares that with the Map's own state after every step: a fourth channel, `state`. A Table is compared as a set of rows keyed by id; a Vec keeps its order.

**Why.** Observations find a divergence in state only when something reads it. Planning the next call (`nindub survey --plan`) brings the read forward, but a run that never reads the changed cell never finds the Drift, and on the Shop the cart-line Drift was still found in only about half of 30 runs of 600 steps. Divergence starts in the Terrain's state; that is where Survey should look, and D9 (every state is reachable through a query or view) is a design principle for Maps that Survey should not have to lean on.

**Why this way.** D7 rejected comparing state because it needs a function from the Terrain's storage to the Map's state, which the Terrain's author (AI) would write and could write to pass. Under D23 there is no such function: the storage already has the Map's shape, the code that reads it is Nindub's, and the Terrain's author writes nothing for verification. A Terrain that keeps a shadow store and feeds Nindub's store as decoration gains nothing, because its outputs then come from one store and its state from the other, and both channels cannot agree with the Map unless both are right. The state channel can only fail a Survey, never pass one, by construction rather than by rule. What the Terrain gives up is the physical shape of declared state; indexes, caches, denormalized copies, code structure and language stay its own. D11 already accepts constraints of this kind.

**What changes.** D6's "never state" is amended as above. D20's storage discretion no longer covers the shape of declared state. D22's protocol gains the endpoint, written by Nindub, so the one AI-written piece D22 accepted (the harness) is not joined by a second. The Todo Terrain's Amendment 1 ("Postgres declared, memory used", ruled discretion) stands, reworded: memory is the store's in-memory backend. When the `Postgres` reader of D21 exists, it reads the same shape from the database and the endpoint is not needed for that region.

**Measured** on the Shop before Amendment 2 (the Map moved a merged cart line to the end, the Terrain kept it in place), seeds 10 to 39: random generation found the Drift in 2 of 30 runs of 600 steps; planning (`--plan`, `docs/SURVEY.md`) with the state channel in 27 of 30 at 600 steps and 29 of 30 at 1200, each time at the `add_to_cart` step itself. Seeing the divergence is solved by the channel; reaching the state that hides it is the planner's job, and a rate rather than a guarantee (D12).

**Rejected:** a snapshot mapping written by the Terrain's author and used only to fail a Survey (the proposal in [hashi-yu/nindub#14](https://github.com/hashi-yu/nindub/pull/14)). It is sound, but it adds a second AI-written piece to the protocol with no planned exit, and it needs a rule to stay fail-only where D23 is fail-only by construction. Also rejected: a mapping trusted as a full oracle, as Quint Connect does; it trusts whoever writes the mapping, which here is the party under test. Also rejected: observations and planning alone; the ceiling above, and state that no query with known arguments reads stays invisible.

## Consequences worth noting

- The Map's actions, queries and views are the project's public interface. A separate API definition is unnecessary; it is derived from the Map.
- A Map runs without a Terrain, so it is also a structural prototype: screens and operations can be exercised before any implementation exists.
- Because the whole project is one Map, an AI agent that reads the Map has read the project. This is the original "miniature" idea, recovered from the other direction.

## Findings from the Shop Map (roadmap item 5)

`examples/shop.nindub` is the first Map that is not a Todo app: a catalog with stock, per-customer carts, orders with a five-state status machine, a payment port that can decline, shipping and receipts as effects, staff permissions with a bootstrap, and six screens. What it showed:

- **It fits in one file, and the outline still reads at a glance.** About 470 lines with comments (Todo: about 210). `nindub outline --depth 2` shows the whole system in 60 lines; nested regions (`api::catalog`, `api::cart`, `api::orders`, `api::staff`) are what keep the api region legible.
- **Atomic actions carried the hardest case for free.** `place` takes stock, then charges; a declined charge fails the action and the stock comes back. Nothing had to be written for the rollback.
- **The language needed four small things**, each found by the Map refusing to parse or run: keywords as method names (`xs.map` collided with `map Shop;`), Vec literals and `push`/`sum`/`find`, a trailing `match` as a body's value, and a place for view helpers, which became `fn`: a pure function, not observed, that queries and views may call.
- **Names are global, and it bit once**: `view Order` collided with `struct Order`, and became `OrderDetail`. Regions grouping without namespacing (D21) held, but a large Map will want a rule of thumb for naming.
- **The generator reached the interesting states without guidance**: paid orders, refunds, out-of-stock, forbidden staff actions, all within 400 random steps, because ids flow from results into later arguments.
- **What the Map could not say**: how the staff role is assigned in production (the bootstrap `grant` is a Map-level stand-in), and anything about money formatting, currencies or rounding beyond integer arithmetic.
- **Survey against a Terrain written from the outline found two real Drifts** (`examples/shop-terrain`): a collation difference in `products()` at step 306, and a cart-line ordering difference that random generation reached in only 2 of 30 runs of 600 steps. Coverage is the open question: the generator picks calls independently, so states that need a specific short sequence (two lines in a cart, a repeat add, a read before `place`) are rare. Found Drifts are kept as replay scripts.
- **The first Remap.** The cart-line Drift turned out to be the Map's accident, not the Terrain's bug: Amendment 2 was accepted and `add_to_cart` was Remapped to keep a merged line in place. The channel of D17 and D18 worked as designed on its first real use: the Terrain's author noticed, Survey made the difference concrete, the human ruled, the Map changed.

## Open questions

- **Syntax.** Rust-flavored (D16) and drafted in `examples/todo.nindub`; the view vocabulary in particular will change once something renders it.
- **Size at scale.** A Todo app and a small shop fit in one Map (see the findings above). Whether an authenticated, multi-tenant application does is still unknown.
- **Observing views in the Terrain.** The accessibility tree is the candidate mechanical Projection for browser UIs. Whether it is stable enough to compare is untested.
- **Concurrency.** Events and an injected clock cover asynchrony in principle; interleavings have not been thought through.
- **Changing the Map.** When state shape changes, the Terrain's stored data must migrate. Who writes the migration, and how Survey checks it, is open.
- **Survey coverage.** How to steer input generation using invariants, and how to report what was explored. The Shop showed the cost of independent random picks: a Drift needing a three-call setup appeared in 2 of 30 runs. Candidates: bias toward calls whose arguments are available (ids in pools), sequences that build on the previous result, and coverage reporting per action outcome. First result: `nindub survey --plan` (arguments from one row of the Map's state; prefer a kind of step this run has not made; start over when stuck) finds that Drift in 27 of 30 runs of 600 steps with the state channel (D23), which shows it at the step that causes it (`docs/SURVEY.md`). Each rule is generic, but the planner is a search and gives a rate, not a guarantee, and it took several rounds of measuring to reach. The alternative is to enumerate the Map's abstract transitions breadth-first up to a depth and replay them, which would make coverage a guarantee at the cost of state explosion; not decided. Whether planning becomes the default is not decided either.

## Roadmap

1. ~~Write `examples/todo.nindub` with a list screen, a detail screen, and a notification email on completion, so that the example exercises views, effects and ports and not only a domain core.~~ Done (draft).
2. ~~Write the interpreter so the Map runs alone.~~ Done: `nindub run` (dynamic; no type checker yet).
3. ~~Write the Survey harness: input generation, mechanical Projection, comparison.~~ Done over the harness protocol (D22): `nindub survey`.
4. ~~Have AI Realize a TypeScript Terrain and iterate until Survey passes.~~ Done: `examples/todo-terrain`, with its Realize log and first Amendment in its README.
5. ~~Then attempt something that is not a Todo app.~~ Done: `examples/shop.nindub` and `examples/shop-terrain`, with its Realize log and Amendment 2 in its README.

Next: the region-kind instruments of D21 (real routes, the browser, the database), the type checker, and `event`.
