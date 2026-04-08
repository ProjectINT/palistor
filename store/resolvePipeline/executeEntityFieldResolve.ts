import { recomputeAndNotify } from "../compute/recompute";
import type { FieldState } from "../compute/index";
import type { EntityNode, EntityGroupNode, EntityLeafNode } from "../entityRegistry/types";
import { storeValue } from "../writePipeline/storeValue";
import { createValuesTrackingProxy } from "./createValuesTrackingProxy";
import { createContextTrackingProxy } from "./createContextTrackingProxy";
import type { ContextTrackingResult } from "./createContextTrackingProxy";
import type { Resolve, ResolveDeps } from "./types";
import { EntityResolveStateMap } from "./types";
import type { TemplateFieldResolveEntry } from "./initResolveStates";

// ─── Deps ────────────────────────────────────────────────────────────────────

/**
 * Dependencies for executeEntityFieldResolve.
 * Extends ResolveDeps with entity-specific state map.
 */
export interface EntityFieldResolveDeps extends ResolveDeps {
  /** Per-entity field resolve states: (entityId, templateFieldNode) → ResolveState. */
  entityStates: EntityResolveStateMap;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a flat values object from an entity node, reading current values
 * from nodeState where available (same as buildEntityValues in buildEntityProjectionProxy).
 */
function buildEntityValuesFromNode(
  entityNode: EntityNode | EntityGroupNode,
  nodeState: WeakMap<object, FieldState>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(entityNode)) {
    const field = (entityNode as Record<string, unknown>)[key];
    if (field && typeof field === "object") {
      if ("value" in field) {
        values[key] =
          (nodeState.get(field as object) as { value: unknown } | undefined)?.value ??
          (field as EntityLeafNode).value;
      } else {
        values[key] = buildEntityValuesFromNode(field as EntityGroupNode, nodeState);
      }
    }
  }
  return values;
}

// ─── Core execution ───────────────────────────────────────────────────────────

/**
 * Execute a per-entity field resolve.
 *
 * Pipeline:
 * 1. Get/create ResolveState in entityStates
 * 2. Set status = pending, loading = true on entity leaf nodeState → recomputeAndNotify
 * 3. Build entity values via buildEntityValuesFromNode → wrap in tracking proxy
 * 4. Wrap store.context in context-tracking proxy for auto context-deps
 * 5. Call resolve.resolver(entityValues, storeProxy)
 * 6. On success: write result to entity leaf (nodeState + entityNode.field.value)
 *    Set status = resolved, save auto-deps, recomputeAndNotify
 * 7. On error (after all retries): call onError, set status = error, recomputeAndNotify
 * 8. Retry logic from resolve.options.retry
 * 9. pendingRetrigger support
 */
export function executeEntityFieldResolve(
  entityId: string,
  entry: TemplateFieldResolveEntry,
  entityNode: EntityNode,
  deps: EntityFieldResolveDeps,
): Promise<unknown> {
  const {
    nodeState,
    recompute,
    notifyChanged,
    notify,
    store,
    valuesCache,
    entityStates,
  } = deps;

  const { node: templateFieldNode, resolve, fieldKey } = entry;

  const state = entityStates.getOrCreate(
    entityId,
    templateFieldNode as object,
    new Set(resolve.deps ?? []),
  );

  // Deduplication: already running
  if (state.status === "pending" && state.promise) {
    return state.promise;
  }

  // Set state to pending
  state.status = "pending";
  state.attempt = 0;
  state.error = null;

  // Get entity leaf node for this field
  const entityLeafField = (entityNode as Record<string, unknown>)[fieldKey];
  const entityLeaf =
    entityLeafField && typeof entityLeafField === "object" && "value" in entityLeafField
      ? (entityLeafField as { value: unknown })
      : null;

  // Set loading = true in entity leaf nodeState
  if (entityLeaf) {
    const leafState = nodeState.get(entityLeaf as object);
    if (leafState) {
      nodeState.set(entityLeaf as object, { ...leafState, loading: true });
    }
  }

  // Notify: loading changed (entity leaf status changed to pending)
  const loadingChanged = new Set<object>();
  if (entityLeaf) loadingChanged.add(entityLeaf as object);
  loadingChanged.add(templateFieldNode as object);
  recomputeAndNotify(loadingChanged, recompute, notifyChanged);

  // Retry options
  const retryOpts = resolve.options?.retry ?? { attempts: 0, delay: 1000 };
  const maxAttempts = retryOpts.attempts;
  const retryDelay = retryOpts.delay ?? 1000;

  const promise = (async (): Promise<unknown> => {
    let lastError: unknown;
    let contextTracking: ContextTrackingResult | null = null;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      state.attempt = attempt;

      // Wait before retry (not on first attempt)
      if (attempt > 0) {
        await new Promise<void>((r) => setTimeout(r, retryDelay));
        // If status changed while waiting (e.g. reset) — abort
        if (state.status !== "pending") return;
      }

      try {
        // Build current entity values and wrap in tracking proxy for auto-deps
        const entityValues = buildEntityValuesFromNode(
          entityNode,
          nodeState as WeakMap<object, FieldState>,
        );
        const tracking = createValuesTrackingProxy(entityValues);

        // Wrap store.context in tracking proxy for context auto-deps
        contextTracking = createContextTrackingProxy(store.context);
        const storeProxy = new Proxy(store, {
          get(target, key) {
            if (key === "context") return contextTracking!.proxy;
            return (target as any)[key];
          },
        });

        const result = await resolve.resolver(tracking.proxy, storeProxy);

        // If status changed while awaiting — abort (e.g. reset, delete entity)
        if (state.status !== "pending") return result;

        // ── Success path ────────────────────────────────────────────────────
        const changed = new Set<object>();
        if (entityLeaf) changed.add(entityLeaf as object);
        changed.add(templateFieldNode as object);

        // Write resolved value to entity leaf
        if (entityLeaf !== null && result !== undefined) {
          // Update entityNode.field.value (keeps entity node in sync)
          (entityLeaf as { value: unknown }).value = result;
          // Update nodeState and valuesCache (via storeValue)
          storeValue(
            entityLeaf as unknown as import("../store/types").AnyConfigNode,
            result,
            nodeState,
            valuesCache,
          );
        }

        // Clear loading from entity leaf nodeState
        if (entityLeaf) {
          const leafState = nodeState.get(entityLeaf as object);
          if (leafState) {
            nodeState.set(entityLeaf as object, { ...leafState, loading: false });
          }
        }

        // Update resolve state
        state.status = "resolved";
        state.error = null;

        // Save auto-deps (entity-relative paths + context deps)
        const accessedPaths = tracking.getAccessedPaths();
        const mergedDeps = new Set<string>(resolve.deps ?? []);
        for (const p of accessedPaths) mergedDeps.add(p);
        for (const key of contextTracking!.getAccessedKeys()) {
          mergedDeps.add(`$context.${key}`);
        }
        state.dependencies = mergedDeps;

        // Recompute + notify (once)
        recomputeAndNotify(changed, recompute, notifyChanged);

        // If a dep changed while pending — retrigger immediately
        if (state.pendingRetrigger) {
          state.pendingRetrigger = false;
          state.status = "idle";
          state.promise = null;
          executeEntityFieldResolve(entityId, entry, entityNode, deps);
        }

        return result;
      } catch (err) {
        lastError = err;
        // Continue to next attempt
      }
    }

    // ── Error path (all retries exhausted) ──────────────────────────────────
    if (state.status !== "pending") return; // aborted externally

    const changed = new Set<object>();
    if (entityLeaf) changed.add(entityLeaf as object);
    changed.add(templateFieldNode as object);

    // Clear loading from entity leaf nodeState
    if (entityLeaf) {
      const leafState = nodeState.get(entityLeaf as object);
      if (leafState) {
        nodeState.set(entityLeaf as object, { ...leafState, loading: false });
      }
    }

    state.status = "error";
    state.error = lastError;

    // Save context deps even on error (for retrigger on setContext)
    if (contextTracking && contextTracking.getAccessedKeys().size > 0) {
      const mergedDeps = new Set<string>(resolve.deps ?? []);
      for (const key of contextTracking.getAccessedKeys()) {
        mergedDeps.add(`$context.${key}`);
      }
      state.dependencies = mergedDeps;
    }

    // Call error handler
    try {
      resolve.onError(lastError, { notify });
    } catch {
      // onError must not throw — suppress if it does
    }

    // Recompute + notify
    recomputeAndNotify(changed, recompute, notifyChanged);

    // If a dep changed while pending — retrigger immediately
    if (state.pendingRetrigger) {
      state.pendingRetrigger = false;
      state.status = "idle";
      state.promise = null;
      executeEntityFieldResolve(entityId, entry, entityNode, deps);
    }

    return undefined;
  })();

  state.promise = promise;
  return promise;
}
