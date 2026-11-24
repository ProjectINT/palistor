// Counters of the /ssr routes: how many times a fake endpoint was called, or a
// callback (a flow's onEnter, …) ran, in this browser tab. Shown under the
// blocks and read by the e2e specs.
//
// Browser only in practice: a store in server mode runs no resolver, so the
// server never counts anything, and <Counter> (Block.tsx) reads 0 there and in
// the render that hydrates the server's HTML.

const counts = new Map<string, number>();
const listeners = new Set<() => void>();

/** Count one occurrence of `name` (for example `"form.profile"`). */
export function track(name: string): void {
  counts.set(name, (counts.get(name) ?? 0) + 1);
  listeners.forEach((listener) => listener());
}

/** How many times `name` was tracked in this tab. */
export function eventCount(name: string): number {
  return counts.get(name) ?? 0;
}

export function subscribeEvents(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A fake endpoint call: counts `name`, then answers after `delay` ms from
 * memory. Nothing touches the network. `answer` may throw: the promise then
 * rejects, as a failed request would.
 */
export function fakeRequest<T>(name: string, answer: () => T, delay: number): Promise<T> {
  track(name);
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(answer());
      } catch (error) {
        reject(error);
      }
    }, delay),
  );
}
