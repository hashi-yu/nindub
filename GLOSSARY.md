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
| **Terrain** | The implementation beneath the Map (TypeScript, Rust, Python, and so on). AI generates it, and humans normally do not read it. |
| **Pin** | A link from an element of the Map to a location in the Terrain. |
| **Zoom** | Following a Pin to look at the level below. |
| **Scale** | How deep a Zoom goes. Each element of the Map is either broken down further in Nindub or Pinned to the Terrain. |
| **Projection** | A function that maps the state of the Terrain onto the state of the Map. |
| **Survey** | Verification that runs the same sequence of operations against both the Map and the Terrain and compares the results through the Projection. |
| **Drift** | The state in which Survey reports a mismatch. |
| **Surface rule** | Observable behavior belongs in the Map. Anything unobservable (data structures, choice of database, optimizations, libraries) is left to the Terrain. |
| **Realize** | What AI does to build the Terrain from the Map, fixing it until Survey passes. |

## Words we avoid

- **Spec**: Nindub Driven Development starts from rejecting specs.
- **Model**: It evokes UML-era model-driven development, and is easily confused with machine-learning models.
- **Blueprint**: It suggests a design drawn before building, and hides the fact that the Map is executable.
