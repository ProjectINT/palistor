import { useEffect } from "react";

/**
 * Registers non-reactive context with a store (store.setContext on mount and
 * whenever `ctx` changes). Read by resolvers and callbacks as `store.context`;
 * never part of the form values.
 */
export function useStoreContext(store: { setContext(ctx: Record<string, unknown>): void }, ctx: Record<string, unknown>): void {
  useEffect(() => {
    store.setContext(ctx);
  }, [store, ctx]);
}
