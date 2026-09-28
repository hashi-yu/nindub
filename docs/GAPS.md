# Gaps and Proposals

English | [日本語](GAPS.ja.md)

**Status: proposal.** This document collects the gaps found in Nindub as of `main` at f2596b5 (which includes the interpreter and Remap), and proposals to close them. Nothing here is decided. A proposal that is adopted is recorded in [DESIGN.md](DESIGN.md) as D23 or later, and marked "decided" here. Changes on `main` since f2596b5 are summarized under "Since f2596b5" below.

Vocabulary follows [GLOSSARY.md](../GLOSSARY.md).

## How to read this

- Part 1 lists the gaps. Each gap has a number (H1, H2, ...) and points at the decision or the code it comes from. The "Status" column says whether the gap existed before the interpreter and Remap were added (existing), whether it appeared or became visible with that addition (new), or whether that addition partly resolved it (partly resolved).
- Part 2 lists the proposals (P1, P2, ...), ordered from fewest dependencies to most. Each one names the gaps it closes and the existing decisions it would change.
- Part 3 checks that the proposals do not conflict with each other.
- Part 4 lists what remains open even if every proposal is adopted.

## Since f2596b5

`main` at 05e2c47 added regions and roads (D21), a generalized Surface rule (D20), and Survey over a harness protocol (D22), with Todo and Shop Terrains. Checked against it:

| Gap | Now |
|---|---|
| H10 | **Resolved.** A query can no longer modify state, emit an effect, or call a port. This is P3, stricter than proposed (no port calls at all). |
| H11, H12, H14 | Still reproduce: `insert` overwrites a row with the same id, nested actions check invariants midway, field types are not checked. |
| H15 | **Partly resolved.** Harness replies carry effect names, and the wire decoder uses the declared types. A `form`'s submit is still opaque. |
| H21 | **Partly resolved.** The wire encoding is defined for the harness protocol (`docs/SURVEY.md`). Real routes are not observed yet (D22). |
| H23 | **Resolved.** `POST /__nindub/reset`. |
| H24 | **Resolved for Survey.** Port responses are generated from the declared types. |
| H1, H2 | Acknowledged by D22: the protocol may bypass the Terrain's real HTTP layer. Not yet closed. |
| H9 | Confirmed: Survey of the Shop found a collation Drift in `products()`. |
| H31 | Acknowledged in the Shop findings; coverage is the open question. |
| H32 | **Reframed by D20.** "Observable" became "checkable by some instrument". P13's first item is superseded. |
| H33 | **Resolved by D21.** Regions, `impl` blocks and `nindub outline` give the Map its Scale. |

---

## Part 1: Gaps

### A. Gaps that let a Terrain slip past Survey

| # | Gap | Source | Status |
|---|---|---|---|
| H1 | **AI chooses where Survey observes.** The AI that writes the Terrain also writes the Pins. It can build an endpoint that behaves exactly as the Map says, Pin that, and let the production path behave differently. The hole D7 closed for Projection is still open on the Pin side. | D7, D17 | existing |
| H2 | **Entrances without a Pin are invisible.** If the Terrain exposes an API the Map lacks (for example, delete everything), Survey never calls it, because it drives only Pinned paths. D18 then says Terrain changes Survey does not detect are "by definition within the Terrain's discretion", so the back door is officially discretion. That contradicts D5 (observable behavior belongs in the Map). | D5 vs D18 | existing |
| H3 | **Undeclared outbound traffic is invisible.** If the Terrain sends user data to an external API it never declared, Survey does not see it, because it observes only declared ports. | D6 | existing |
| H4 | **The Terrain can behave only while tested.** D11 requires injection points for the clock, ids and ports, so the Terrain can tell that it is running under Survey and change its behavior only then. | D8, D11 | existing |
| H5 | **Amendments can weaken the Map (acknowledged).** Human acceptance is the only defense, yet the Amendment carries only the Survey result of the Terrain against the unamended Map. Nothing mechanically shows **how the Map's own behavior changes**. | D18 | existing |
| H6 | **Tool-drafted Amendments bring the Terrain→Map direction back.** D17 lets the tool draft an Amendment "where a Drift determines it". A draft that a Drift determines is, in effect, a diff that makes the Map match the Terrain. Presented as the default, it pulls the ruling toward Accept. The direction D1 rejected (deriving the Map from the Terrain) returns in the form of a draft. | D1, D17 | new |

### B. Gaps where Survey compares too much and takes away the Terrain's discretion

| # | Gap | Source | Status |
|---|---|---|---|
| H7 | **Caching, retries and batching become Drift, because port requests are compared as a sequence.** D5 makes optimization the Terrain's discretion, but D6 observes it. For example, caching `Directory.email_of` removes one request, and that is Drift. | D5 vs D6 | existing |
| H8 | **How many times `ids.fresh()` or `clock.now()` is called becomes Drift.** The interpreter's default clock advances by one on every read (see the `Runtime` constructor in `src/runtime.ts`). A Terrain that reads the clock once more, just for logging, shifts every later value. | D8 | existing (confirmed in code) |
| H9 | **A deterministic Map cannot say "either is fine".** Confirmed in the implementation:<br>- `sorted_by` keeps ties in insertion order<br>- Text comparison uses JavaScript's `<`, which is UTF-16 code-unit order<br>- `"Created " + t.created_at` renders a raw integer, such as `Created 0`<br>If the Terrain's database collation or date format differs, each of these is Drift. D18's Discretion ruling "records the point as unobserved", but **there is no place to record it**. | D2, D18 | existing (made concrete) |

### C. Gaps in the language's semantics and the interpreter

The following were found by reading `src/runtime.ts` and `src/values.ts` and confirmed by running small Maps with `nindub run`.

| # | Gap | Source | Status |
|---|---|---|---|
| H10 | **Queries and views can change state, emit effects and call ports.** Assignment, `insert`, `remove`, `emit` and port calls never check whether the caller is an action. LANGUAGE's "rendering a view never changes state or emits effects" does not hold in the implementation. Invariants are checked only after actions, so state a query corrupts is never checked at all. | LANGUAGE "Semantics worth knowing"; `runtime.ts`: `assign`, `emit` in `evalExpr`, `port` and `insert` in `evalMethod` | new |
| H11 | **`Table.insert` silently overwrites a row with the same id.** As a result, the Todo invariant "ids are unique" can never be false: it checks nothing. A Terrain's database would reject the duplicate primary key, so this is a Drift waiting to happen. | `runtime.ts` `insert`; `examples/todo.nindub` | new |
| H12 | **Nested actions check invariants on intermediate state.** Every successful inner action triggers an invariant check. A violation is reported even when the outer action would restore a valid state before it finishes. | `runtime.ts` `call`, `invoke` | new |
| H13 | **Failure and Map faults are undefined.** Port requests from a failed action stay in the Observation, but the docs do not say so. A Map runtime error (no injected response, no such row for `todos[id]`, no matching `match` arm, recursion that never ends) is not an Observation but an exception. What Survey compares when the Map itself fails is undefined. | LANGUAGE "An action is atomic"; `runtime.ts` `call` | new |
| H14 | **Types are not checked.** A Text can be stored in an `n: Int` field. `Id<User>` and `Id<Todo>` are indistinguishable at run time. Neither `match` exhaustiveness nor the set of errors each action can return is checked. Types are also what Survey's input generation relies on. | D16; roadmap "no type checker yet" | new |
| H15 | **The JSON form of an Observation loses information.** `toJSON`, which is meant to be used for comparison, has these problems:<br>- struct and effect type names are dropped, so `Ping` and `Pong` with the same fields are identical<br>- a payload-less enum becomes the string `"Error::Bad"`, identical to a Text with the same characters<br>- Id and Text have the same form<br>- an Int becomes a number or a string depending on its size<br>- a `form`'s submit becomes `"<closure>"`, so the view's Observation does not show which action the form calls | `values.ts` `toJSON`, `elementToJSON` | new |
| H16 | **There are two notions of equality.** As a Table key, an Id and a Text with the same characters address the same row (`keyOf`), but `==` says they differ (`equal`). A row found by `todos.get(x)` may fail `t.id == x`. | `values.ts` | new |
| H17 | **Number and text semantics are undocumented.** Int is unbounded (bigint), but a Terrain will use int64 or a JavaScript number. Division truncates toward zero. `Text.len()` counts code points. Ordering is by UTF-16 code unit. The unit of an Instant ("milliseconds or any monotone bigint") is not fixed. All of this has to be read out of the code. | `runtime.ts`, `values.ts` | new (makes H9 concrete) |
| H18 | **The Map's meaning changes with the interpreter's version.** The Map's text changes only by Remap (D17). Fixing a bug in the interpreter, or changing its semantics, changes what the same Map does, with no Remap. That is a way around D17. D19 says the semantics "will be pinned by tests", but the tests are 30 cases built mostly around the Todo example, which is no substitute for a definition of the language. | D17, D19 | new |
| H19 | **There is no way to check an invariant on the Terrain "through queries".** Invariants range over everything (`todos.all`), while queries read one user's data (`list(user)`). | LANGUAGE table | existing |
| H20 | **State cannot have an initial value.** Only empty `Table`, `Vec` and `Option` values are possible, so configuration or reference data that exists from the start cannot be expressed. | `runtime.ts` `initialState` | new |
| H21 | **The HTTP wire format is undecided.** If the Terrain decides how arguments and Results are encoded, the mapping has to live in the Pin or in the Terrain. That is an AI-written Projection in all but name, and it reopens the hole D7 closed. | D7 | existing |
| H22 | **Mapping view elements to UI parts is undecided.** Which on-screen control is the `title` field of a `form` is not defined. Nor is whether `.then(...)` navigates when the action returns `Err`. | LANGUAGE | existing (partly new) |
| H23 | **Survey has no way to reset the Terrain.** Each input sequence needs the Terrain back in its empty state, but D11's constraints do not require a way to do that. | D11 | existing |
| H24 | **Port responses for running a Map alone are thin.** The REPL's `:port` sets a response, which helps. But it sets one fixed response per function, independent of the arguments, so alice and bob cannot get different email addresses. How Survey supplies responses is still undecided. | `cli.ts` | partly resolved |

### D. Gaps in process and documentation

| # | Gap | Source | Status |
|---|---|---|---|
| H25 | **Amendments can come from too few places.** The glossary defines an Amendment as something AI submits during Realize, and D18 says "only Drift raises an Amendment". Yet by D17 and Remap, an Amendment is the only way the Map changes. So there is no path for a human to add a feature, and no path for "silence", which D18 itself names as an example but which never produces Drift. | D17, D18, GLOSSARY | existing |
| H26 | **The first Map is never reviewed.** The first Map is "written by humans together with AI". AI's influence enters the source of truth at that point, and it does not go through the review an Amendment gets. | D1 | existing |
| H27 | **Concurrent Amendments are not handled.** When two Amendments are proposed against the same version of the Map and one of them is Remapped, the Survey result attached to the other is stale. In the glossary's own pull-request-and-merge analogy, there is no rebase and no re-check when the base moves. | GLOSSARY: Remap | new |
| H28 | **A Remap that renames a Map element leaves Pins dangling.** How a Pin that names an old element is detected, and who fixes it, is undefined. | D17 | new |
| H29 | **The acting user is passed as an argument, `user: UserId`.** In production, a client can send someone else's id. If the Terrain trusts the argument, Survey never notices, because it only ever passes the right id. Every carefully written `Forbidden` in the Map is bypassed. | LANGUAGE "Not yet designed" | existing |
| H30 | **Migrating data when the state's shape changes (acknowledged).** | Open questions | existing |
| H31 | **What Survey explored is not reported (acknowledged).** | D12 | existing |
| H32 | **"Observable" is ambiguous.** Latency is observable from outside, yet the Surface rule keeps it out of the Map. What is actually meant is "observable through the four channels", but it is never defined that way. | D5, D13 | existing |
| H33 | **Scale has lost its definition.** The glossary says each element "is broken down further in Nindub", but since Pins left the Map (D17), what is broken down, and how, inside one file, is undefined. | D4, GLOSSARY | existing |
| H34 | **The "why" is lost.** The Map is executable code, with no place for intent. An Amendment's reason is not kept anywhere after the Remap. | D2 | existing |
| H35 | **The docs have drifted from the code.** LANGUAGE still opens with "Nothing here is implemented yet". The linter D9 relies on does not exist. LANGUAGE's "rendering a view never changes state" is false, as H10 shows. | LANGUAGE, D9 | new |

### Seen in the example (`examples/todo.nindub`)

- Calling `complete` on a todo that is already done sends the email again. The view hides the button, but HTTP can still call the action. Whether this is intended cannot be read from the Map.
- The invariant "ids are unique" can never fail, because of H11.
- `text("Created " + t.created_at)` cannot be matched by any Terrain, because the Instant's format is undecided (H9, H17).

### How to reproduce

Running this Map with `node src/cli.ts run` reproduces H10, H11, H12, H13, H14 and H15. Enter `:port Ext.hit Ok(1)` first.

```rust
map Probe;
struct Row { id: Text, n: Int }
enum Error { Bad }
effect Ping { n: Int }
effect Pong { n: Int }
port Ext { fn hit(n: Int) -> Result<Int, Error>; }
state rows: Table<Row>;
invariant "n is never 5" { rows.all(|r| r.n != 5) }
query sneaky(k: Text) -> Int {           // H10: a query changes state, emits, calls a port
    rows.insert(Row { id: k, n: 1 });
    emit Ping { n: 1 };
    let r = Ext.hit(1) else Error::Bad;
    r
}
view Screen(k: Text) { heading("n=" + sneaky(k)); }                         // and so does rendering a view
action put(k: Text, n: Int) -> Result<(), Error> { rows.insert(Row { id: k, n }); Ok(()) }  // H11: same k overwrites
action step(k: Text) -> Result<(), Error> { put(k, 5); rows[k].n = 6; Ok(()) }            // H12: reported as a violation midway
action fail(k: Text) -> Result<(), Error> { let r = Ext.hit(9) else Error::Bad; requires false else Error::Bad; Ok(()) } // H13: the port request remains
action pp() -> Result<(), Error> { emit Ping { n: 1 }; emit Pong { n: 1 }; Ok(()) }       // H15: both render the same
action txt() -> Result<Text, Error> { Ok("Error::Bad") }                                   // H15: renders the same as the next
action en() -> Result<Error, Error> { Ok(Error::Bad) }
```

`put("z", "not an int")` also succeeds (H14).

---

## Part 2: Proposals

### P1. Fix the language's semantics in a document, and version them

- **Make a document the authority.** `docs/SEMANTICS.md` (English and Japanese) becomes the source of truth for what Nindub means, and the interpreter becomes its implementation. Each clause of the document comes with example tests that check it.
- **Answer to H11:** `insert` with an id that already exists is a Map fault (see "Map fault" below). Overwriting has its own, explicit operation, such as `upsert`.
- **Answer to H12:** invariants are checked at the end of the **outermost** action. Nested actions are part of one transaction.
- **Answer to H13:**
  - Port requests from a failed action cannot be taken back, so they stay in the Observation as requests that were sent. The document says so.
  - A Map runtime error (no response, no such row, no matching arm, a computation over its budget) is not an exception but an outcome called a **Map fault**, recorded in the Observation. Survey does not compare a Map fault against the Terrain; it reports it as a bug in the Map. Unbounded recursion runs against a step budget, and exceeding the budget is a Map fault.
- **Answer to H16:** Id and Text are distinct everywhere, including as Table keys and under `==`. The REPL converts a string literal to an Id according to the parameter's type (P2).
- **Answer to H17:**
  - Int is a signed 64-bit integer; overflow is a Map fault. Division truncates toward zero.
  - Text length counts code points, and ordering is by code point, not by UTF-16 code unit.
  - An Instant is milliseconds in UTC, and converts to Text in ISO 8601 form.
- **Answer to H19:** an invariant is defined as a self-check of the Map and as guidance for Survey's input generation. LANGUAGE's "on the Terrain, through queries" is removed: once observations agree, checking on the Map is enough.
- **Answer to H20:** `state name: Type = expr;` declares an initial value. The expression must be a constant.
- **Answer to H18:** the Map declares its language version at the top, for example `map Todo; nindub 0.1;`. An interpreter change that alters semantics bumps the version. Moving a Map to a new version is an Amendment, applied by a Remap, and it carries P10's Map-against-Map Survey run between the old and new versions. With this, D17's "the Map changes only by Remap" holds for the Map's meaning, not only its text.
- **Closes:** H11, H12, H13, H16, H17, H18, H19, H20
- **Changes to existing decisions:** LANGUAGE's "Semantics worth knowing" moves into SEMANTICS and grows. D17 and D19 gain the notion of a semantics version.

### P2. Check types

- A static type check runs before Survey. It checks:
  - the types of fields and arguments
  - the `T` in `Id<T>`
  - `match` exhaustiveness
  - which errors each action and query can actually return: the variants of `E` in `Result<T, E>` that its `requires` and `let ... else` can produce
- The check for D9 (all state is observable) is implemented here too.
- Survey's input generation follows these types.
- **Closes:** H14, and part of H35 (the missing linter).
- **Changes to existing decisions:** none. It implements D9 and D16.

### P3. Make reads pure in the language

- Inside queries and views, the type check (P2) rejects:
  - assignment to `state`, `insert`, `remove`
  - `emit`
  - calls to port functions that are not marked `query` (the mark is introduced in P5)
- LANGUAGE's "rendering a view never changes state or emits effects" becomes true. Survey can render a view any number of times without affecting the world.
- It also follows that checking invariants only after actions is enough.
- **Closes:** H10, and part of H35.
- **Changes to existing decisions:** none. It enforces the existing definition of Query (reads without changing state).

### P4. A canonical form for Observations, and fixed conventions per transport

- **One canonical form.** Observations have one lossless representation, used for the Map and for the Terrain (through the Projection) alike.
  - structs and effects carry their type name
  - enums are distinguishable from Text
  - Ids are distinguishable from Text
  - Ints are always decimal strings
  - a `form`'s submit is represented as a template of an action call, such as `create(user, $title)`, where `$title` is a field
- **Define `.then`.** It navigates only when the action returns `Ok`.
- **HTTP convention:** Nindub defines exactly one way to encode arguments, Results and errors. A Pin chooses only the method and the path.
- **Browser convention:** a fixed mapping from view elements to accessibility-tree nodes.
  - `heading` is a heading, `button` is a button named by its label, `item` is a list item
  - a `form` field is labelled by its parameter name
  - labels are compared exactly
- With these, the Projection is generated entirely from signatures and conventions, and is fully mechanical.
- **Closes:** H15, H21, H22
- **Changes to existing decisions:** it makes D6 (what a view's Observation contains) and D7 (what the Projection is built from) concrete. Neither is changed.

### P5. Clarify injection, and introduce a "port world"

- **Clock:** within the handling of one input, `clock.now()` returns the same value however often it is read. The interpreter's default clock changes to match.
- **Ids:** still injected, so D8 stands. But ids are compared up to a consistent renaming, so it does not matter how many ids the Terrain draws.
- **Port world:** for each run, Survey supplies one consistent world of port responses, in which the same request always gets the same response. The same port world also supplies port responses for the REPL and for running a Map alone: it can be written in a file, and responses can depend on the arguments. The port world returns each of a port's declared error variants at least once (P12).
- **The `query` mark on ports:** a port function can be marked `query`, meaning it reads without changing the outside world. Requests to `query` port functions are not compared; only their effect on results is. Requests to unmarked port functions are compared as a sequence, as before.
- Caching, batching and retrying reads become the Terrain's discretion again.
- **Closes:** H7, H8, H24
- **Changes to existing decisions:** D6's Port row changes from "requests are observed" to "requests other than to `query` functions are observed". D8 is extended.

### P6. Let the Map declare latitude (where Discretion is recorded)

- The Map stays deterministic and executable (D2 stands). On top of that, the Map can declare **latitude** for comparison: "here the Terrain may differ, within this range". For example:
  - the result of `query list` may come in any order, or ties on the same time may come in any order
  - when several `requires` fail at once, any of their errors may be returned
  - the format of dates and numbers embedded in `text()` is not compared, only their values
- The interpreter runs one behavior within the latitude, the one P1 defines.
- D18's Discretion ruling is recorded in the Map as **an Amendment that adds latitude**. D17's "the Map changes only by Remap" holds, and the Map stays the single source of truth.
- **Closes:** H9
- **Changes to existing decisions:** the Effect of Discretion in D18's table changes from "nothing changes" to "a Remap that adds latitude". A new term goes into the glossary, in both languages.

### P7. A closed surface: the Terrain's only ways in and out are its Pins and its declarations

- **Inbound:** the tool generates the production entry point (router or gateway) from the Pin index. Paths without a Pin cannot be reached from outside. The path Survey drives becomes the only path in production.
- **Pin coverage:** every action, query and view in the Map has exactly one Pin per transport; a missing or duplicate Pin is an error. The check runs whenever the Pin index is regenerated, including after a Remap (P10).
- **Outbound:** during Survey, the Terrain may reach nothing but declared ports. In production, an allowlist generated from the port declarations is recommended. Whatever actually performs effects (sends the email) sits outside the effect boundary, and under Survey the harness receives the effects instead.
- **Reset:** the Terrain must offer a way to return to its empty state for Survey. This joins D11's constraints (H23).
- **Closes:** H1, H2, H3, H23
- **Changes to existing decisions:** D18's "changes Survey does not detect are discretion" becomes "changes Survey does not detect **within the closed surface** are discretion". D11 gains an item.

### P8. Survey in production

- At P7's entry and exit points, production inputs, injected values and observations are recorded and replayed against the Map as the oracle.
- Survey and production must run the same build. Only what is injected differs, and code that detects whether it is running under Survey is rejected by the linter.
- The records contain user data. Where they are kept, and for how long, is decided by humans for each project.
- **Closes:** H4. Strengthens H31 (paths that real use takes join the exploration).
- **Changes to existing decisions:** none. D12 (exploration, not proof) still holds.

### P9. Separate the actor from the arguments

- The actor is written as its own context, not as an argument. For example: `action complete(id: TodoId) by user: UserId`.
- The Projection carries the actor in the authentication slot of P4's transport conventions (a cookie or a token), never as an argument.
- Survey also generates inputs that claim to be someone else.
- How authentication works is the Terrain's discretion. Only who may do what goes in the Map.
- **Closes:** H29
- **Changes to existing decisions:** it gives a direction to LANGUAGE's "Not yet designed: sessions and authentication".

### P10. Lay out the path from Amendment to Remap

- **Two origins.** An Amendment can come from a human (a new or changed feature) or from AI during Realize. Both go through the same review, and an accepted one is applied by a Remap. An AI-raised Amendment must carry evidence: a Drift, or a concrete input sequence that shows the problem. Pointing out a silence also takes an input sequence.
- **The first Map is a sequence of Amendments against the empty Map.** It goes through the same review as any other Amendment.
- **Attach a Map-against-Map Survey.** The Map before and after the Amendment are both executable, so the tool searches for input sequences whose observations differ and attaches them. A change that widens latitude (P6) is flagged prominently as weakening.
- **Present drafts neutrally.** When the tool drafts an Amendment from a Drift (D17), it shows the Map's and the Terrain's observations side by side for the same input sequence. The draft is labelled "derived from the Terrain's behavior", and its reason is written by a human, or by AI separately from the draft. Neither Accept nor Reject is the default.
- **Record the base version.** Every Amendment records which version of the Map it applies to. It can be Remapped only when its base is the current Map. Otherwise it is rebased onto the current Map, and its Survey and Map-against-Map Survey are run again.
- **Check Pins.** After a Remap, the tool regenerates the Pin index and runs P7's coverage check. A Pin that names a removed or renamed element is reported as work on the Terrain side; the Map does not change.
- **Keep the reasons.** The reasons of accepted Amendments are kept as a history. It is written in natural language, and it is not a source of truth: it is the record of why.
- **Closes:** H5, H6, H25, H26, H27, H28, H34
- **Changes to existing decisions:**
  - D18's "only Drift raises an Amendment" becomes "an AI-raised Amendment carries evidence".
  - The glossary's definition of Amendment is widened to cover both origins.
  - D17's drafting gains the condition that drafts are presented neutrally.
  - D17 itself and the definition of Remap are unchanged.

### P11. A Survey that checks migrations

- An Amendment that changes the shape of state includes a migration function written in Nindub, from the old Map's state to the new one's.
- Survey checks the migration in three steps:
  1. Run the first half of an input sequence against the old Map and the old Terrain.
  2. Migrate both. The Terrain's migration is written by AI.
  3. Run the second half against the new Map and the new Terrain, and compare observations.
- State is still never compared, so D6 holds.
- **Closes:** H30

### P12. Report coverage on the Map

- Survey reports, on the Map, whether each of the following was reached:
  - every `requires` and its `else`, and every `match` arm
  - every affordance in every view
  - every effect
  - every error variant of every port (P5's port world guarantees each is returned)
  - Map faults (P1)
- A pass is stated as "no Drift found at this coverage".
- **Closes:** H31
- **Changes to existing decisions:** it backs D12's honest claim with numbers.

### P13. Align definitions and documents

- Define "observable" in closed form as "observable through the four channels". Latency, resource use and appearance are stated as human responsibilities under D13 (H32).
- Redefine Scale: within the one file, the upper level is signatures and invariants and the lower level is bodies. Going below the Map means following a Pin (H33).
- Update LANGUAGE's status line, D9's mention of a linter, and the statement about rendering views, to match the code and P1–P3 (H35).
- **Closes:** H32, H33, H35

---

## Part 3: The proposals do not conflict

| Pair | How they relate |
|---|---|
| P1 and P6 | P1 fixes **what the Map does** (an Instant renders as ISO 8601, and so on). P6 declares **how far the Terrain may differ** (the format is not compared). They govern different things and do not overlap. |
| P1 and P10 | Moving to a new semantics version is an Amendment, applied by a Remap, and the difference between versions is shown by P10's Map-against-Map Survey. D17's single way for the Map to change is preserved. |
| P1 and P12 | Map faults are not compared by Survey; they appear in the coverage report. A Map fault that is found is fixed by a human-raised Amendment (P10). |
| P2 and P3 | Read purity (P3) is implemented as one of the type-check rules (P2). |
| P2 and P4 | The canonical form (P4) is determined by types. The REPL's conversion from strings to Ids (P1) also follows the types. |
| P3 and P5 | The only port calls P3 allows in queries and views are to functions carrying P5's `query` mark. One mark serves both. |
| P4 and P6 | Labels and effect type names are compared exactly (P4); only the contents of `text()` are subject to latitude (P6). The boundary is explicit. |
| P4 and P7 | The generated entry point (P7) and the Projection (P4) are built from the same Pin index and the same transport conventions, so what Survey drives always matches what production serves. |
| P4 and P9 | The actor travels in the authentication slot of P4's conventions and never appears among the arguments. |
| P5 and P8 | P5's deterministic injection (fixed clock per input, id renaming, port world) is what makes replaying production records against the Map in P8 possible. |
| P5 and P12 | The port world guarantees every port error is returned, so port errors can be counted in coverage. |
| P6 and P10 | A Discretion ruling becomes an Amendment that adds latitude, and P10 flags it as weakening. |
| P7 and P8 | P7's entry and exit points are exactly where P8 records. |
| P7 and P10 | One Pin coverage check serves both regeneration of the index and the check after a Remap. |
| P10 and P11 | An Amendment that changes the shape of state carries P11's migration function and the result of the Survey that checked it. |

The proposals were also checked against the existing decisions. None overturns the core of D1–D22. Only the places below would change, and each can be handled by adding an entry at D23 or later and marking the old text as superseded, without renumbering:

- D6's Port row (P5)
- an extension to D8 (P5)
- an added constraint in D11 (P7)
- the drafting condition in D17 (P10)
- in D18: the effect of Discretion (P6), the scope of "changes Survey does not detect" (P7), and "only Drift raises an Amendment" (P10)
- a semantics version in D19 (P1)
- LANGUAGE's statements about semantics and invariants (P1, P3)

## Part 4: What remains open

- **Concurrency:** interleaving of inputs that arrive at the same time (acknowledged). P5's fixed clock applies only within a single input.
- **Size at scale:** whether a large application fits in one Map (acknowledged). P13's Scale helps reading, but is not an answer.
- **Localization:** as long as labels are compared exactly (P4), they cannot be translated. Extending latitude to labels would require markers in the Terrain to identify UI parts, which opens a hole much like H1.
- **Whether the Map says what humans intend:** like the email sent again for an already-completed todo, a Map can run correctly and still not match what a human means. No machine decides that; P10 only makes the review concrete.
- **Performance, secure implementation, appearance:** still human responsibilities (D13).
- **One language on both sides:** the interpreter and the first Terrain are both TypeScript (D19). The same language quirks (string ordering, for example) can enter both sides alike and hide Drift. P1's written semantics, checked by example tests, reduces this. Removing it takes a Terrain written in another language (roadmap step 5).
