/**
 * Инициализация кэшей для стабильных ссылок на функции (React-мемоизация).
 *
 * - onValueChange — функциональный setter для value
 * - submit — обёртка submitNode
 * - reset — обёртка resetNode
 * - setValues — обёртка setValuesNode
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
