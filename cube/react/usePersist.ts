import { useEffect, useRef } from "react";
import type { Persist, PersistOptions } from "../core";

/**
 * Wires persistence from a component (store's usePersist): on mount
 * `store.persist.enable(options)` (hydrate, then autosave); on unmount a final
 * flush, then disable. Reconnects when the store, the key or the driver
 * changes; other options are read from the latest render.
 */
export function usePersist(store: { persist: Persist }, options: PersistOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    void store.persist.enable(optionsRef.current);
    return () => {
      void store.persist.flush(); // writes synchronously with a sync driver, before disable()
      store.persist.disable();
    };
  }, [store, options.key, options.driver]);
}
