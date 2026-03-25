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
export type { ListResolveDeps } from "./executeListResolve";
export type { AnyResolveEntry, GroupResolveEntry, ListResolveEntry } from "./initResolveStates";
export { initResolveStates } from "./initResolveStates";
export { executeResolve } from "./executeResolve";
export { executeListResolve } from "./executeListResolve";
export { findResolvesToRetrigger } from "./findResolvesToRetrigger";
export { resetResolveState } from "./resetResolveState";

