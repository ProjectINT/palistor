/**
 * Which implementation "@impl" is. The contract is one for both; this flag
 * marks the few assertions where Cube differs from store on purpose. Every use
 * is listed in experiments/CubeExperiment.md (section «SSR»).
 */
import { Palistor } from "@impl";

/** Cube only: `store.start()` exists there (experiments/SsrPlan.md). */
export const onCube = typeof (Palistor as unknown as { prototype: { start?: unknown } }).prototype.start === "function";

/**
 * `loading` of a lazy resolve read before its first run. store: false until
 * the run has started (a microtask after the read). Cube: true — the read
 * makes the run due, so the server's HTML and the client's first render show
 * the same skeleton.
 */
export const LOADING_ON_FIRST_READ = onCube;
