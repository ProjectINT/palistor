/**
 * createContextTrackingProxy — оборачивает плоский объект контекста в read-only Proxy,
 * который записывает ключи, к которым обращался резолвер.
 *
 * Используется в executeResolve для автоматического определения контекстных зависимостей:
 * если резолвер читает `store.context.accountId`, то `$context.accountId` добавляется
 * в auto-deps, и резолвер перезапустится при изменении этого ключа через `setContext`.
 */

export interface ContextTrackingResult {
  /** Прокси над context — передаётся внутри storeProxy в resolver */
  proxy: Record<string, unknown>;
  /** Ключи контекста, к которым обратился резолвер */
  getAccessedKeys: () => Set<string>;
}

export function createContextTrackingProxy(
  context: Record<string, unknown>,
): ContextTrackingResult {
  const accessedKeys = new Set<string>();

  const proxy = new Proxy(context, {
    get(_target, key) {
      // Skip symbol keys (e.g. Symbol.toPrimitive, Symbol.iterator)
      if (typeof key === "symbol") return Reflect.get(context, key);
      accessedKeys.add(key as string);
      return context[key as string];
    },
    set() {
      // Context is read-only inside resolvers
      throw new TypeError("store.context is read-only inside a resolver");
    },
  });

  return {
    proxy,
    getAccessedKeys: () => accessedKeys,
  };
}
