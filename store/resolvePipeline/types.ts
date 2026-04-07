import { type AnyConfigNode, type ProxyStore } from "../store/types";
import type { FieldState } from "../compute/index";
import type { ValuesCache } from "../valuesCache/valuesCache";

// ─── Public Types ────────────────────────────────────────────────────────────

/** Notification function registered via useNotifier. User defines the signature. */
export type NotifyFn = (...args: any[]) => void;

/** Error context passed to resolve.onError */
export interface ResolveErrorContext {
  /** Notification function from useNotifier. */
  notify: NotifyFn;
}

/** Async resolver configuration for a group node. */
export interface Resolve<T = Record<string, unknown>> {
  /**
   * Async data loader.
   * `thisForm` is a tracking write-proxy of the current form/group values:
   *   - Read: tracks dependencies (auto-deps)
   *   - Write: buffers side-effects (batch)
   * `store` is the ProxyStore instance for accessing other parts of the store.
   * Returns an object with values for THIS node's subtree.
   */
  resolver: (thisForm: Record<string, unknown>, store: ProxyStore<any>) => Promise<T>;

  /**
   * Synchronous placeholder — set instantly before resolver completes.
   * Structure mirrors resolver return type.
   */
  optimisticResolver?: (values: Record<string, unknown>) => Partial<T>;

  /**
   * Error handler called after retry exhaustion.
   * `ctx.notify` is the notification function from useNotifier.
   */
  onError: (error: unknown, ctx: ResolveErrorContext) => void;

  /**
   * Explicit dependencies — paths in the values tree.
   * When any of these paths change → re-run resolver.
   * Takes priority for first run (auto-deps not yet collected).
   * After first run: merged with auto-deps.
   */
  deps?: string[];

  /**
   * Context keys that must be present (non-null/undefined) before the resolver
   * is allowed to start. The resolver is queued until all keys satisfy the check.
   *
   * Prevents the initial "flash of error" when context is set asynchronously
   * (e.g., after the first render).
   *
   * @example
   * contextDeps: ['accountId']  // resolver won't run until context.accountId != null
   */
  contextDeps?: string[];

  options?: {
    /** Wait for first access to the node. Default: true */
    lazy?: boolean;
    /** Throw Promise for React Suspense (loading only). Default: false */
    suspense?: boolean;
    /** Retry options on error */
    retry?: {
      attempts: number;  // default: 0 (no retries)
      delay: number;     // default: 1000 ms
    };
  };
}

// ─── Internal State ──────────────────────────────────────────────────────────

export type ResolveStatus = "idle" | "pending" | "resolved" | "error";

export interface ResolveState {
  status: ResolveStatus;
  /** Current promise (for suspense and deduplication) */
  promise: Promise<unknown> | null;
  /** Last error */
  error: unknown | null;
  /** Paths in values tree that the resolver depends on (auto-deps) */
  dependencies: Set<string>;
  /** Current retry attempt number */
  attempt: number;
  /**
   * Set to true when a dep changes while this resolver is pending.
   * After the current resolution completes, the resolver will be retriggered.
   */
  pendingRetrigger?: boolean;
}

// ─── Dependencies for resolve execution ──────────────────────────────────────

export interface ResolveDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  resolveStates: Map<object, ResolveState>;
  recompute: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  notify: NotifyFn;
  getValues: () => Record<string, unknown>;
  /** Initial value snapshot for dirty tracking — updated after resolver success. */
  initialValueMap: WeakMap<object, unknown>;
  valuesCache: ValuesCache;
  /** The ProxyStore instance — passed as second argument to resolver. */
  store: ProxyStore<any>;
}
