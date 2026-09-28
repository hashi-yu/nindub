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

For user interfaces the line is drawn the same way. What each screen shows and what happens when the user acts on it is observable and belongs in the Map. Color, layout, typography, animation and the UI framework are the Terrain's discretion, exactly as the choice of database is. Humans judge appearance by looking; Survey judges behavior.

### D6. Survey compares observations, never state

Survey runs the same sequence of inputs against the Map and the Terrain and compares what comes out. It never inspects the Terrain's internal state. Four channels are observed:

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

### D17. The Map changes only when a human accepts an Amendment

Nothing in the Map may change because the Terrain changed. The Map changes for exactly one reason: a human accepted an Amendment (D18). Reorganizing the Terrain, renaming its files, switching its framework or database, none of these touch the Map.

Consequently Pins are not written in the Map. A Pin is an annotation in the Terrain naming the Map element it realizes and the transport through which it is observed. The Nindub tool collects Pins into a generated index committed next to the Map; Zoom and viewers use the index, and a viewer may show Pins overlaid on the Map. The Map file itself never names a file, route or framework.

**Rejected:** Pins as attributes in the Map (`#[pin(ts = "src/api/todos.ts::create", via = http("POST /todos"))]`). It reads well and makes Zoom trivial, but it makes the Map depend on the Terrain's file layout, which is the Terrain's discretion under D5, and it forces a Map edit whenever the Terrain is reorganized, which inverts the direction of truth.

### D18. AI proposes Amendments; a human decides

While Realizing, AI will find that the Map is wrong (an invariant cannot hold), incomplete (an error case is missing, a port is needed) or silent (the Map says nothing about pagination or duplicates). AI never edits the Map. It submits an Amendment: a diff to the Map, a reason, and the Survey result of the current Terrain against the unamended Map, so that the behavior the Amendment would permit is concrete.

A human makes one of three rulings:

| Ruling | Meaning | Effect |
|---|---|---|
| Accept | the Map was wrong or incomplete | the Map changes; Survey runs against the new Map |
| Reject | the Map is right | the Terrain must change; Survey runs against the old Map |
| Discretion | the Map is silent and should stay so | nothing changes; the point is recorded as unobserved |

Only Drift raises an Amendment. Terrain changes that Survey does not detect are, by definition, within the Terrain's discretion and need no review.

This channel reopens, in a different place, the hole that D7 closed for Projection: AI could propose an Amendment that weakens the Map until Survey passes, as an agent might delete a test to make the suite pass. Unlike Projection, this cannot be closed mechanically, because whether a change to the Map is right is a question about human intent. Human acceptance is therefore not a convenience but the only defense, and the attached Survey result exists to make that review concrete. It is also why the review surface is the Map diff, which is short and high-level, and not the Terrain diff (D13).

## Consequences worth noting

- The Map's actions, queries and views are the project's public interface. A separate API definition is unnecessary; it is derived from the Map.
- A Map runs without a Terrain, so it is also a structural prototype: screens and operations can be exercised before any implementation exists.
- Because the whole project is one Map, an AI agent that reads the Map has read the project. This is the original "miniature" idea, recovered from the other direction.

## Open questions

- **Syntax.** Rust-flavored (D16) and drafted in `examples/todo.nindub`; the view vocabulary in particular will change once something renders it.
- **Size at scale.** A Todo app fits in one Map. Whether an authenticated, multi-tenant application does is unknown and is the real test of D3 and D4.
- **Observing views in the Terrain.** The accessibility tree is the candidate mechanical Projection for browser UIs. Whether it is stable enough to compare is untested.
- **Concurrency.** Events and an injected clock cover asynchrony in principle; interleavings have not been thought through.
- **Changing the Map.** When state shape changes, the Terrain's stored data must migrate. Who writes the migration, and how Survey checks it, is open.
- **Survey coverage.** How to steer input generation using invariants, and how to report what was explored.

## Roadmap

1. ~~Write `examples/todo.nindub` with a list screen, a detail screen, and a notification email on completion, so that the example exercises views, effects and ports and not only a domain core.~~ Done (draft).
2. Write the interpreter so the Map runs alone.
3. Write the Survey harness: input generation, mechanical Projection, comparison.
4. Have AI Realize a TypeScript Terrain and iterate until Survey passes.
5. Then attempt something that is not a Todo app.
