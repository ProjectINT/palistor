/**
 * Initializes the caches for stable function references (React memoization).
 *
 * - onValueChange — functional value setter
 * - submit — submitNode wrapper
 * - reset — resetNode wrapper
 * - setValues — setValuesNode wrapper
 */
export function initProxyCaches() {
  return {
    onValueChange: new WeakMap<object, (v: unknown) => void>(),
    submit: new WeakMap<object, () => Promise<unknown>>(),
    reset: new WeakMap<object, (values?: Record<string, unknown>) => void>(),
    setValues: new WeakMap<object, (patch: Record<string, unknown>) => void>(),
  };
}

export type ProxyCaches = ReturnType<typeof initProxyCaches>;
