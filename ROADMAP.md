# Roadmap

Ideas under consideration. Nothing here is promised or scheduled; each item needs a decision before it's built.

## Timelines

- **Declarations after a branch.** When a timeline is created with `chain.create()`, should stateObjects declared afterwards appear in every timeline (one shared shape, separate values), or only in the timeline that declared them (separate trees)? The first version shares the shape.
- **Faster timelines.** Each timeline runs its own copy of the engine, so it costs memory and code size. Look for ways to share more between timelines without slowing the main chain.

## Performance

- **Get after publish.** A get through a stateObject that has only ever been read measures about 0.5 ns. Once the same stateObject has also been published to, V8 optimizes its one function for both jobs and a get measures about 1.2 ns. Splitting the get and publish paths inside the stateObject function might recover the difference without changing the API.

## Examples

- Examples beyond `examples/browser-js`: framework bindings, Node.js and TypeScript.
