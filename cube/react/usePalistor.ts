"use client";

import { useContext, useEffect, useRef } from "react";
import type { NotifyFn, Translate } from "../core";
import { Palistor as CubePalistor, type PalistorOptions as CubeOptions } from "../palistor";
import type { Palistor, PalistorOptions } from "../types";
import type { FieldMapping } from "../../store/store/types";
import { ProvidedContext, type Provided } from "./provider";

interface Made {
  store: CubePalistor;
  /** The options the store was built from. The function form is never called again, so they stay its options. */
  options: CubeOptions;
  /** What the store has from this hook: the constructor's values, then every push. The effect sends only what differs. */
  given: {
    context: Record<string, unknown>;
    translator: Translate | undefined;
    notifier: NotifyFn | undefined;
  };
}

/** The store for the options and the provider's values of the render that makes it. */
function make(options: CubeOptions | (() => CubeOptions), provided: Provided): Made {
  const own = typeof options === "function" ? options() : options;
  const context = { ...provided.context, ...own.context };
  const translator = own.translator ?? provided.translator;
  const notifier = own.notifier ?? provided.notifier;
  // The store gets its own copy: store.context is never the provider's object, nor the hook's record.
  const store = new CubePalistor({ ...own, context: { ...context }, translator, notifier });
  return { store, options: own, given: { context, translator, notifier } };
}

/** The keys of `next` whose value is not the one in `prev` (`Object.is`); null when there is none. */
function changedKeys(prev: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> | null {
  let patch: Record<string, unknown> | null = null;
  for (const k of Object.keys(next)) if (!Object.is(prev[k], next[k])) (patch ??= {})[k] = next[k];
  return patch;
}

/**
 * One store per component instance, wired to the nearest `<PalistorProvider>`:
 * replaces `useState(() => new Palistor(…))` + `useStoreContext` +
 * `useTranslator` + `useNotifier`.
 *
 * The store is built by the render that first reaches the hook, and the
 * provider's values go into its constructor. So that render's output — the
 * server's HTML too — is already translated, a resolver's first run sees the
 * context, and `initialData` is in place; no effect is needed for any of it.
 * The hook starts nothing itself: whether resolvers run is the constructor's
 * `server` option (default `typeof window === "undefined"`).
 *
 * **Options or a function.** `usePalistor(() => options)` calls the function
 * once per store, so a `config()` builder does not run on every render.
 * Passing the object costs whatever building it costs, on every render.
 *
 * **One store per committed instance.** The store is kept in a ref that is
 * filled once. Under `<StrictMode>` in development React still renders the
 * component twice and mounts its effects twice, but the options function is
 * called once and one store is built: eager resolves and a flow's first
 * `onEnter` start once, and nothing is sent to the store twice. A render that
 * React never commits is not an instance: its store is dropped (see Suspense).
 *
 * **Merge with the provider.** `context` is `{ ...provider, ...options.context }`
 * (the store's own keys win); `translator` and `notifier` are the option when
 * given, the provider's otherwise.
 *
 * **After mount** only these three are followed: the provider's always, the
 * options' when they are passed as an object. The function form was read
 * once — for a `context` that follows props use the object form or
 * `useStoreContext`. An effect sends the store what changed
 * (`store.setContext` / `setTranslator` / `setNotifier`), the translator and
 * the notifier before the context. `config`, `initialValues`, `initialData`,
 * `fieldMapping` and `server` are read once: to start over with new data,
 * give the component a new `key`.
 *
 * **Context is compared per key** (`Object.is`), against what this hook last
 * sent: a new object with the same values sends nothing, and only the changed
 * keys are sent, so only resolvers that read one of them (or list it in
 * `contextDeps`) re-run. A key the store got from elsewhere
 * (`store.setContext`, `useStoreContext`) is left alone until the provider or
 * the options change that same key. `setContext` merges: a key that
 * disappears keeps its last value in the store — pass it as `undefined` to
 * clear it.
 *
 * **Unmount** resets nothing: the store goes away with the component.
 *
 * **Suspense.** A component that suspends before its first commit keeps
 * nothing, this store included: every retry builds a new store, which starts
 * its requests again. Call `usePalistor` above the `<Suspense>` boundary and
 * read a `suspense: true` node in a child below it.
 *
 * @example
 * ```tsx
 * "use client";
 * export function CustomersView({ accountId, customers }: Props) {
 *   const store = usePalistor(() => ({
 *     config: customersConfig,
 *     context: { accountId },
 *     initialData: { customers },
 *   }));
 *   const form = useForm(store);
 *   // …
 * }
 * ```
 */
export function usePalistor<
  TConfig extends Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  const TMapping extends FieldMapping = {},
>(
  options: PalistorOptions<TConfig, TMapping> | (() => PalistorOptions<TConfig, TMapping>),
): Palistor<TConfig, TMapping>;
export function usePalistor(options: CubeOptions | (() => CubeOptions)): unknown {
  const provided = useContext(ProvidedContext);

  // A ref filled once, not a useState initializer: under StrictMode React calls an initializer
  // twice and drops one result, and a dropped store has already started what a constructor starts.
  const ref = useRef<Made | null>(null);
  if (ref.current === null) ref.current = make(options, provided);
  const made = ref.current;
  const { store, given } = made;

  const own = typeof options === "function" ? made.options : options;
  const providedContext = provided.context;
  const ownContext = own.context;
  const translator = own.translator ?? provided.translator;
  const notifier = own.notifier ?? provided.notifier;

  useEffect(() => {
    // The translator and the notifier first: a context change can start a resolver, which may use both.
    if (given.translator !== translator) {
      given.translator = translator;
      store.setTranslator(translator ?? null);
    }
    if (given.notifier !== notifier) {
      given.notifier = notifier;
      store.setNotifier(notifier ?? null);
    }
    const patch = changedKeys(given.context, { ...providedContext, ...ownContext });
    if (patch) {
      given.context = { ...given.context, ...patch }; // merged, as the store keeps it
      store.setContext(patch);
    }
  }, [store, given, providedContext, ownContext, translator, notifier]);

  return store;
}
