# Glossary

English | [日本語](GLOSSARY.ja.md)

## Names

### Nindub (the language)
A very-high-level language that describes all of a project's observable behavior. It is executable and testable.

The name comes from Nindub, the Sumerian architect god. According to the Gudea cylinders (c. 2125 BC), Gudea, ruler of Lagash, was commanded in a dream to build a temple, and Nindub drew the plan of the temple on a tablet of lapis lazuli. Gudea then built the temple according to that plan.

| The dream | Nindub Driven Development |
|---|---|
| The god's command | Human intent |
| The plan Nindub drew | The Map |
| The temple Gudea built | The Terrain |

### Nindub Driven Development (the method)
A way of developing software with no natural-language spec, where a Map written in Nindub is the single source of truth. Humans write the Map together with AI, AI Realizes the Terrain, and Survey guarantees that the two agree.

### Motto
> The map precedes the territory.

From Jean Baudrillard's *Simulacra and Simulation*. It inverts Alfred Korzybski's "the map is not the territory", and expresses the idea that the Map is the source of truth.

## Terms

| Term | Definition |
|---|---|
| **Map** | A single file, written in Nindub, that describes all of a project's observable behavior. It is executable and it is the source of truth. |
| **Terrain** | The implementation beneath the Map (TypeScript, Rust, Python, and so on). AI generates it, and humans do not read it to learn what it does. |
| **Region** | A bounded part of the territory: a browser, a process, a database, an external service, an outbound channel. Every action, query, view, state, port and effect lives in one. A region's kind (`Client`, `Service`, `Postgres`, `External`, `Outbound`) decides what may live in it and which instrument Survey observes it with. Regions nest. |
| **Road** | A declared connection from one region to another. A body may use an item from another region only along a road. Roads are the Map's statement of module dependencies, checked on the Terrain. |
| **Pin** | An annotation in the Terrain naming the Map element it realizes, with any instrument-specific detail (an action's route). Pins point from the Terrain to the Map, never the other way; the Map file contains none. The tool collects them into a generated index. |
| **Amendment** | A proposed change to the Map, submitted by AI during Realize with a reason and the Survey result against the unamended Map. A human accepts it, rejects it, or rules it discretion. An accepted Amendment is applied by a Remap. |
| **Remap** | Applying one accepted Amendment to the Map: the only way the Map changes, and the only gate through which the Terrain informs the Map. Always a partial correction; never a regeneration of the Map from the Terrain. Amendment is to Remap as a pull request is to a merge. |
| **Zoom** | Going down a level: from the territory into a region, from a region into its items, from an item along its Pin into the Terrain. |
| **Scale** | How deep a Zoom goes. The top of a Map shows regions and roads; below that, each region's items; below that, bodies; below that, the Terrain. `nindub outline --depth N` picks a Scale. |
| **Observation** | Anything that comes out of the Map or the Terrain in response to inputs. There are four channels: results, views, effects and ports. Survey compares observations, never internal state. |
| **Action** | An operation that may change state. Its result and declared errors are observed. |
| **Query** | An operation that reads state without changing it. Its result is observed. |
| **View** | A screen, described as the structure of what it shows and what can be acted on. Observed as data, never as pixels. |
| **Effect** | A side effect on the outside world (send an email, charge a card), emitted as data rather than performed. The sequence of effects is observed. |
| **Port** | An external service the project depends on, declared with its types and errors. Requests to it are observed; its responses are injected. |
| **Projection** | The adapter through which Survey drives and observes the Terrain. It is generated from the Map's declarations and the Pins' transports. Neither humans nor AI write it by hand. |
| **Survey** | Verification that feeds the same sequence of inputs to both the Map and the Terrain and compares their observations through the Projection. It is exploratory, not proof. |
| **Drift** | The state in which Survey reports a mismatch. |
| **Surface rule** | Observable behavior belongs in the Map. Anything unobservable (data structures, choice of database, optimizations, libraries, and for UIs color, layout and framework) is left to the Terrain. |
| **Realize** | What AI does to build the Terrain from the Map, fixing it until Survey passes. |

## Words we avoid

- **Spec**: Nindub Driven Development starts from rejecting specs.
- **Model**: It evokes UML-era model-driven development, and is easily confused with machine-learning models.
- **Blueprint**: It suggests a design drawn before building, and hides the fact that the Map is executable.
