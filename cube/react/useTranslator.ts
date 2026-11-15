import { useEffect } from "react";
import type { Translate } from "../core";

/**
 * Registers a translation function with a store (store.setTranslator on mount
 * and whenever `translator` changes, setTranslator(null) on unmount). Call it
 * once in a layout or provider. Function-valued `label` / `placeholder` /
 * `description`, computed flags and `validate` then receive it; without one
 * they get the identity, so a label function returns its key.
 *
 * Only nodes whose translated output actually changes re-render on a switch
 * (store re-rendered every component that read any leaf).
 */
export function useTranslator(store: { setTranslator(t: Translate | null): void }, translator: Translate): void {
  useEffect(() => {
    store.setTranslator(translator);
    return () => {
      store.setTranslator(null);
    };
  }, [store, translator]);
}
