/**
 * resolvePipeline — core of the async resolver system.
 *
 * Responsibilities:
 * - Type definitions (Resolve, ResolveState, etc.)
 * - Initialization of resolve states for all nodes with `resolve` in config
 * - Execution of resolve with retry, batching, optimistic updates
 * - Auto-deps tracking via createValuesTrackingProxy
 * - Side-effect buffering and single-flush application
 */

export type { NotifyFn, ResolveErrorContext, Resolve, ResolveStatus, ResolveState, ResolveDeps } from "./types";
export { initResolveStates } from "./initResolveStates";
export { executeResolve } from "./executeResolve";
export { findResolvesToRetrigger } from "./findResolvesToRetrigger";
export { resetResolveState } from "./resetResolveState";


