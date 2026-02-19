/**
 * Generates a unique ID string using crypto.randomUUID if available,
 * falling back to a timestamp-based approach.
 */
const generateId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

/**
 * Ensures the object type always has an `id` field.
 */
export type WithId<T extends object> = T & { id: string };

export type ProxyHandler<T extends object> = {
  get?: (target: WithId<T>, key: keyof WithId<T>) => any;
  set?: (target: WithId<T>, key: keyof WithId<T>, value: any) => boolean;
};

/**
 * Creates a Proxy from a plain object.
 * If the object does not have an `id` field, one is generated automatically.
 *
 * @param obj    - Plain object to wrap.
 * @param handler - Optional custom Proxy get/set traps.
 * @returns A Proxy wrapping the object, guaranteed to have an `id`.
 *
 * @example
 * const proxy = makeProxy({ name: "Alice" });
 * console.log(proxy.id); // auto-generated UUID
 * console.log(proxy.name); // "Alice"
 *
 * @example
 * const proxy = makeProxy({ id: "user-1", role: "admin" });
 * console.log(proxy.id); // "user-1"
 */
export const makeProxy = <T extends object>(
  obj: T,
  handler: ProxyHandler<T> = {}
): WithId<T> => {
  const target: WithId<T> = {
    id: generateId(),
    ...obj,
  } as WithId<T>;

  return new Proxy(target, {
    get(t, key: string | symbol) {
      if (handler.get) {
        return handler.get(t, key as keyof WithId<T>);
      }
      return Reflect.get(t, key);
    },

    set(t, key: string | symbol, value: any) {
      if (key === "id") {
        console.warn("[makeProxy] Attempted to overwrite `id`. Ignored.");
        return false;
      }
      if (handler.set) {
        return handler.set(t, key as keyof WithId<T>, value);
      }
      return Reflect.set(t, key, value);
    },
  });
};
