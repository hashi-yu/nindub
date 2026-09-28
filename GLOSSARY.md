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
| **Pin** | An annotation in the Terrain naming the Map element it realizes and the transport (function call, HTTP, browser) through which that element is observed. Pins point from the Terrain to the Map, never the other way; the Map file contains none. The tool collects them into a generated index. |
| **Amendment** | A proposed change to the Map, submitted by AI during Realize with a reason and the Survey result against the unamended Map. A human accepts it, rejects it, or rules it discretion. The Map changes only through accepted Amendments. |
| **Zoom** | Following a Pin to look at the level below. |
| **Scale** | How deep a Zoom goes. Each element of the Map is either broken down further in Nindub or Pinned to the Terrain. |
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
