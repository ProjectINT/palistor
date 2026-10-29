// The one place where Proxy really pays off is the component render boundary.
// Without it, the "current observer" is installed by the hook and lives until
// the next useForm. That works because a component body runs synchronously
// before its children render. Weak spot: reads from components WITHOUT
// useForm land in the last useForm's set → an extra re-render (not a bug, but
// not Palistor's precision either). Phase 1 replaces this with a thin tracking
// proxy at this boundary only.

import { useCallback, useRef, useSyncExternalStore } from "react";
import { Cube, enter, type Observer } from "../core";
import { Palistor } from "../palistor";

export function useForm(input: Palistor | Cube): Cube {
  const cube = input instanceof Palistor ? input.proxy : input;
  const frame = useRef<Observer>({ deps: new Set() }).current;
  enter(frame); // cube reads until the end of the component body land here

  const subscribe = useCallback((cb: () => void) => cube.root.subscribe(cb), [cube]);
  const snapshot = useCallback(() => {
    let s = 0;
    for (const c of frame.deps) s += c.version; // versions only grow → the sum is monotonic
    return s;
  }, [frame]);

  useSyncExternalStore(subscribe, snapshot);
  return cube;
}
