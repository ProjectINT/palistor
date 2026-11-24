# palistor — Skill Spec

Palistor is a declarative state library for React: a config object describes fields, groups, lists and
step flows together with their rules; a store built from it holds the state outside React; components
read it through `useForm` and re-render only for the nodes they read. The skills teach an agent to put
behavior into the config instead of component state, and record the constraints the types do not show.

## Domains

| Domain | Description | Skills |
| --- | --- | --- |
| forms | Fields, groups and the rules between them: validation, visibility, computed values, submit, reset, loading data, drafts | `palistor` |
| lists | Lists of entities: loading, membership, row editing, filtering, pagination | `palistor-lists` |
| flows | Wizards: steps, navigation, branching, per-step and final validation | `palistor-flows` |
| ui-integration | The hop from a field to a UI component: adapters and prop renaming | `palistor-field-mapping` |
| server-rendering | A store under a server render: data, translations and context in the first HTML, nothing started on the server, hydration without a mismatch or a repeated request | `palistor-ssr` |

## Skill Inventory

| Skill | Type | Domain | What it covers | Failure modes |
| --- | --- | --- | --- | --- |
| `palistor` | core | forms | Mental model (config → store → `useForm` → spread), a component tree that mirrors the config (a node as a prop on every level, a group or a single field), fields and groups, validation, visibility, computed values, submit / reset, group resolve (`onError` with `notify` and `t`), persist, i18n, notifications, store context (hooks and constructor options), `store.start()` and the no-`window` rule, typing, routing to the other skills | 14 |
| `palistor-lists` | sub-skill | lists | `defineList`, list and row proxies, list resolve (loading / error / reload), add / remove / temporary ids / rekey, editing a row through a separate template, lists nested in rows (how they get their rows, `dirty` up the chain, reset), filtering (since batch 6 also the Apply mode: drafts and applied values), sorting (since batch 6: the client class with its snapshot order, the server class with `ctx.sort`), pagination (`nextCursor: null` ends a feed) | 41 |
| `palistor-flows` | sub-skill | flows | `defineFlow` / `defineStep`, navigation, branching through step `isVisible`, per-step and final validation, step lifecycle, persisted navigation, typing; first-step entry by kind of store (`new Palistor()`: constructor, `usePalistor`: after the first commit) | 13 |
| `palistor-field-mapping` | sub-skill | ui-integration | The field spread, one adapter per input kind, `fieldMapping` / `defineFieldMapping`, single vocabulary, typing mapped props, limits of renaming | 11 |
| `palistor-ssr` | sub-skill | server-rendering | `usePalistor` (a store per component instance), one store for the whole app (the hook called once in a layout provider; the entry of each client subtree reads it from a React context, nodes go down as props), `PalistorProvider` / `usePalistorContext`, the constructor options `initialData`, `translator`, `notifier`, `server`, what restarts a resolve that got `initialData`, server mode and `store.start()`, when a `usePalistor` store starts (held until its component has committed; `server: true` as the manual mode), `loading` and Suspense in a server render and in the browser's first render, `usePersist` over `initialData` | 9 |

## Failure Mode Inventory

Generated from the `### PRIORITY — title` headings of the skill files; the wrong and correct patterns
and the mechanism are written once, in the file named in the last column.

### palistor (14 failure modes)

| # | Mistake | Priority | Source | Documented in |
| --- | --- | --- | --- | --- |
| 1 | Form logic in useState / useEffect instead of the config | CRITICAL | README "Idea", cube/core/cube.ts (write, rawError) | `SKILL.md` |
| 2 | A hidden field still blocks submit | CRITICAL | cube/core/cube.ts (collectErrors) | `SKILL.md` |
| 3 | Passing store.proxy (or a part of it) to useForm | HIGH | store/store/types.ts (RawStoreProxyMarker), cube/react/useForm.ts | `SKILL.md` |
| 4 | Reading state in render without useForm | HIGH | cube/react/useForm.ts | `SKILL.md` |
| 5 | Expecting the whole form in a nested field's values | HIGH | cube/core/cube.ts (scopeValues) | `SKILL.md` |
| 6 | A number field fed by a text input | HIGH | cube/core/cube.ts (write) | `SKILL.md` |
| 7 | Reading validity that is not there yet | HIGH | cube/core/cube.ts (isInvalid, revalidate) | `SKILL.md` |
| 8 | useForm(store, selector) | MEDIUM | cube/react/useForm.ts (resolveEntity) | `SKILL.md` |
| 9 | Root submit where a group submit was meant | MEDIUM | cube/core/cube.ts (submit) | `SKILL.md` |
| 10 | Changing the config object after the store exists | MEDIUM | cube/core/cube.ts (constructor) | `SKILL.md` |
| 11 | Omitting onError | HIGH | store/resolvePipeline/types.ts | `references/async-resolve.md` |
| 12 | Loading in useEffect and writing with setValues | HIGH | cube/core/resolve.ts | `references/async-resolve.md` |
| 13 | Expecting the group's own values in resolver | MEDIUM | cube/core/resolve.ts (execute) | `references/async-resolve.md` |
| 14 | Waiting for a resolve that never starts (until batch 2: "…that nothing reads") | MEDIUM | cube/core/node.ts (groupNode), cube/core/resolve.ts (touch, start), cube/ssr/serverMode.test.tsx ("store.start()", "server: false in Node behaves like the client"), cube/ssr/usePalistor.test.tsx ("the render starts nothing and reads what a server render reads; the effect starts everything once", "server: true is the manual mode: the hook starts nothing, store.start() does") | `references/async-resolve.md` |

### palistor-lists (41 failure modes)

| # | Mistake | Priority | Source | Documented in |
| --- | --- | --- | --- | --- |
| 1 | Treating a failed or not-yet-started list as empty | HIGH | cube/contract/sliceC/listResolveError.test.ts, cube/contract/sliceC/listResolve.test.ts (loading before the first run), cube/core/resolve.ts (touch, due) | `SKILL.md` |
| 2 | One-argument useForm(row) with a row from getById, add or for…of | HIGH | cube/react/useForm.ts (wrap, resolveInput, resolveEntity) | `SKILL.md` |
| 3 | Reading row fields in a child component without useForm(row) | HIGH | cube/react/useForm.ts (wrap, track), cube/contract/sliceC/useFormEntity.test.tsx | `SKILL.md` |
| 4 | Expecting isRequired to validate a row | HIGH | cube/core/cube.ts (rowError, submitEntity), cube/contract/sliceC/entityTemplateResolve.test.tsx | `SKILL.md` |
| 5 | Confusing list.remove(id) with store.delete(id) | HIGH | cube/contract/sliceC/deleteListConsistency.test.ts, cube/core/hub.ts (deleteEntity) | `SKILL.md` |
| 6 | Expecting a re-read or re-mount to refetch | HIGH | cube/contract/sliceC/listResolveError.test.ts | `SKILL.md` |
| 7 | Template or rows without id | MEDIUM | cube/core/registry.ts (idOf) | `SKILL.md` |
| 8 | Declaring a list as a raw array | MEDIUM | store/store/types.ts (ConfigNodeToProxy), store/defineList.ts | `SKILL.md` |
| 9 | Index or row object as the React key | MEDIUM | cube/core/node.ts (listNode) | `SKILL.md` |
| 10 | Looking up the row you just added | MEDIUM | cube/contract/sliceC/listAddReturn.test.ts | `SKILL.md` |
| 11 | Reaching into store internals for list state | MEDIUM | cube/contract/sliceC/listResolveError.react.test.tsx | `SKILL.md` |
| 12 | Sending the onSubmit argument as the request body | HIGH | cube/contract/sliceC/entityTemplateResolve.test.tsx ("onSubmit called with entityProxy and store") | `references/entity-editing.md` |
| 13 | Expecting a field resolver to run when the list loads | HIGH | cube/contract/sliceC/entityFieldResolve.test.tsx ("the list resolver loads entities without triggering field resolves") | `references/entity-editing.md` |
| 14 | Reading form values in a field resolver | HIGH | cube/core/resolve.ts (execute: base = cube.item ?? hub.root), cube/contract/sliceC/entityFieldResolve.test.tsx | `references/entity-editing.md` |
| 15 | Passing a proxy node to store.invalidate | MEDIUM | cube/contract/sliceC/entityTemplateResolve.test.tsx ("invalidate(id, templateNode) clears only that pair") | `references/entity-editing.md` |
| 16 | Using store.invalidate to remove or refresh a row | MEDIUM | cube/palistor.ts (invalidate), cube/contract/sliceC/entityTemplateResolve.test.tsx | `references/entity-editing.md` |
| 17 | Reading a server filter through values or deps | HIGH | cube/contract/sliceE/filterSurface.test.tsx ("the resolver's values and getValues() never contain the filter") | `references/filtering.md` |
| 18 | where with param or debounce | HIGH | cube/contract/sliceE/filtering.test.ts (A6) | `references/filtering.md` |
| 19 | Filtering rows in the component | MEDIUM | cube/contract/sliceE/filteringExample.port.test.ts | `references/filtering.md` |
| 20 | Expecting store.reset() to clear the filters | MEDIUM | cube/contract/sliceE/filtering.test.ts (C1, F3) | `references/filtering.md` |
| 21 | Using list.length as the number of loaded rows | MEDIUM | cube/contract/sliceE/filtering.test.ts (C2, E2), cube/core/listCube.ts | `references/filtering.md` |
| 22 | An Apply button over automatic fields | HIGH | cube/contract/sliceE/filtering.test.ts (D2, D4), cube/core/filterApply.test.ts ("typing in a manual field", "apply()", "revert()") | `references/filtering.md` |
| 23 | A draft and an applied copy kept by hand | MEDIUM | cube/core/filter.ts (constructor: a field without `where` is a server field), cube/contract/sliceE/filtering.test.ts (C1, D2) | `references/filtering.md` |
| 24 | Expecting set, reset or clear to change the rows in manual mode | MEDIUM | cube/core/filterApply.test.ts ("set() writes the drafts and requests nothing; apply() sends them", "clear() writes the drafts; clear() + apply() is one request") | `references/filtering.md` |
| 25 | A field that only $all reads | MEDIUM | cube/core/filter.ts (`hasClient`), cube/core/listCube.ts (`visibleIds`), cube/contract/sliceE/filtering.test.ts (E3); authoring probe | `references/filtering.md` |
| 26 | Ignoring ctx.page | HIGH | cube/contract/sliceG/pagination.test.ts (A1, B1) | `references/pagination.md` |
| 27 | Replacing the rows with a spinner on list.loading | HIGH | cube/contract/sliceG/pagination.test.ts (A3), cube/core/listCube.ts (loading) | `references/pagination.md` |
| 28 | "Page N of M" from a new query while the previous rows are shown | MEDIUM | cube/core/pagination.ts (`ensureFamily`, `pageCount`, `total`); authoring probe | `references/pagination.md` |
| 29 | Calling an optional pagination method directly | MEDIUM | store/store/types.ts (ListProxyNode) | `references/pagination.md` |
| 30 | Jumping to a page that does not exist | MEDIUM | cube/core/pagination.ts (setPage, pastEnd), cube/core/pagination.test.ts ("cursor: the page that came with nextCursor: null has no next one; nextPage, setPage and prefetch request nothing") | `references/pagination.md` |
| 31 | Using total to decide whether more rows exist | MEDIUM | cube/contract/sliceG/pagination.test.ts (A2, D7), cube/core/pagination.ts (hasNextPage), cube/core/pagination.test.ts ("infinite: null wins over a total and a hasMore that say there is more") | `references/pagination.md` |
| 32 | Reading the list's own rows inside its resolver | MEDIUM | cube/contract/sliceG/pagination.test.ts (F7) | `references/pagination.md` |
| 33 | Mapping a field prop onto a pagination name | MEDIUM | cube/contract/sliceG/pagination.test.ts (F1) | `references/pagination.md` |
| 34 | Sorting rows in the component | HIGH | cube/core/listCube.ts (`visibleIds`), cube/core/sort.test.ts ("comparison by value", "the client filter narrows the sorted rows and keeps their order") | `references/sorting.md` |
| 35 | Sorting in the browser what only the server has | HIGH | cube/core/sort.ts (`parse`), cube/core/sortServer.test.ts ("a server sort's block") | `references/sorting.md` |
| 36 | A server-sorted list whose resolver ignores ctx.sort | HIGH | cube/core/sortServer.test.ts ("a server sort never reorders the loaded rows itself"), cube/core/sort.ts (`resort`) | `references/sorting.md` |
| 37 | Expecting an edited or added row to move into place | HIGH | cube/core/sort.test.ts ("the order is a snapshot"), cube/react/sort.react.test.tsx | `references/sorting.md` |
| 38 | No $locale on a client-sorted list rendered on the server | MEDIUM | cube/ssr/sortLocale.test.tsx | `references/sorting.md` |
| 39 | Date objects in a sorted column | MEDIUM | cube/core/sort.test.ts (comment on "dates by time…"); authoring probe | `references/sorting.md` |
| 40 | A header prop typed with keyof on an entity with groups | MEDIUM | store/store/types.ts (`SortKey`); authoring type check | `references/sorting.md` |
| 41 | A computed column named after no entity field | MEDIUM | store/store/types.ts (`SortBlock`), cube/core/sort.ts (`parse`) | `references/sorting.md` |

### palistor-flows (13 failure modes)

| # | Mistake | Priority | Source | Documented in |
| --- | --- | --- | --- | --- |
| 1 | Calling flow.nextStep() from the Next button | HIGH | cube/core/flow.ts (nextStep), cube/contract/sliceI/flowNavigation.test.ts | `SKILL.md` |
| 2 | Inline step defaults without as | HIGH | store/flow/defineFlow.ts (defineStep<const K, const C>) | `SKILL.md` |
| 3 | A field-level condition that reads another step | HIGH | cube/core/cube.ts (scopeValues), cube/contract/sliceI/flowNavigation.test.ts ("branching via isVisible") | `SKILL.md` |
| 4 | A hidden required field inside a visible step | HIGH | cube/contract/sliceI/flowSurface.test.tsx ("a hidden step is exempt, a hidden leaf in a visible step is not") | `SKILL.md` |
| 5 | Sending the untaken branch to the server | HIGH | cube/contract/sliceI/flowNavigation.test.ts ("hidden steps keep their values and stay in flow.values") | `SKILL.md` |
| 6 | Rendering flow.errors after a failed step.submit() | MEDIUM | cube/core/flow.ts (validate, submit) | `SKILL.md` |
| 7 | Typing a step prop as FlowStepProxy<StepValues> | MEDIUM | store/store/types.ts (FlowStepProxy) | `SKILL.md` |
| 8 | Steps that throw when the module loads | MEDIUM | cube/defineFlow.ts, cube/contract/sliceI/defineFlow.test.ts | `SKILL.md` |
| 9 | Reading the flow through store.proxy in a component | MEDIUM | react/useForm.ts (ForbidRawStoreProxy), cube/contract/sliceI/flowSurface.test.tsx | `SKILL.md` |
| 10 | Looking for navigation methods on the step | MEDIUM | cube/contract/sliceI/flowNavigation.test.ts ("a step's onSubmit receives the flow proxy") | `SKILL.md` |
| 11 | A Back button that ignores canGoBack | MEDIUM | cube/contract/sliceI/flowNavigation.test.ts ("back on an empty stack") | `SKILL.md` |
| 12 | Expecting the current step in the values | MEDIUM | cube/contract/sliceI/defineFlow.test.ts ("status never enters values") | `SKILL.md` |
| 13 | Persisting with a pick or omit that drops the flow | MEDIUM | cube/contract/sliceI/flowSurface.test.tsx ("navigation alone autosaves under __flows[path], outside pick") | `SKILL.md` |

### palistor-field-mapping (11 failure modes)

| # | Mistake | Priority | Source | Documented in |
| --- | --- | --- | --- | --- |
| 1 | Config written in palistor's names while a map is active | HIGH | cube/core/mapping.ts (normalize), cube/contract/sliceH/skillExample.test.ts | `SKILL.md` |
| 2 | Spreading a field where palistor-only props are not consumed | HIGH | cube/contract/sliceH/fieldMapping.test.tsx ("only external names are visible in a spread") | `SKILL.md` |
| 3 | Wiring props by hand for every field | HIGH | store/constants.ts (SPREADABLE_FIELD_STATE_PROPS) | `SKILL.md` |
| 4 | Two palistor props mapped to one name | HIGH | cube/core/mapping.ts (FieldMap constructor) | `SKILL.md` |
| 5 | A field named like a mapped name | HIGH | cube/core/mapping.ts (normalize) | `SKILL.md` |
| 6 | A map that loses its literal types | HIGH | store/defineFieldMapping.ts | `SKILL.md` |
| 7 | new Palistor<typeof config>(…) with a map | HIGH | store/store/types.ts (ProxyStoreOptions), cube/contract/sliceH/fieldMapping.test.tsx ("static typing") | `SKILL.md` |
| 8 | useForm(subtree) in a mapped store | MEDIUM | react/useForm.ts (overloads) | `SKILL.md` |
| 9 | Expecting the map to convert values | MEDIUM | cube/core/mapping.ts (project) | `SKILL.md` |
| 10 | A new adapter for every field | MEDIUM | cube/contract/sliceH/fieldMapping.test.tsx ("componentProps keys are preserved") | `SKILL.md` |
| 11 | Renaming a prop to a name lists own | MEDIUM | cube/core/mapping.ts (RESERVED_LIST_KEYS) | `SKILL.md` |

### palistor-ssr (9 failure modes)

| # | Mistake | Priority | Source | Documented in |
| --- | --- | --- | --- | --- |
| 1 | A module-level store for request data | CRITICAL | cube/palistor.ts (constructor), cube/ssr/usePalistor.test.tsx ("two components with the same config get different stores") | `SKILL.md` |
| 2 | Translator, notifier or context applied through an effect | HIGH | cube/ssr/hydration.test.tsx ("a label through `translator`"), cube/ssr/usePalistor.test.tsx ("the provider's translator is applied in the first render"), cube/ssr/initialDataDeps.test.ts ("restarts when a `contextDeps` key changes"), cube/react/useTranslator.ts | `SKILL.md` |
| 3 | Server data passed as initialValues | HIGH | cube/palistor.ts (constructor), cube/core/restore.ts, cube/ssr/initialData.test.tsx ("the data is applied over initialValues") | `SKILL.md` |
| 4 | Expecting new props to replace the store's data | HIGH | cube/ssr/usePalistor.test.tsx ("an options object is read once too", "options passed as an object are followed too: context, translator and notifier, nothing else") | `SKILL.md` |
| 5 | A resolver dependency that is not declared | HIGH | cube/ssr/initialDataDeps.test.ts ("does not restart on a value or a context key it did not declare, before its first real run") | `SKILL.md` |
| 6 | Server data that answers another request | HIGH | cube/core/pagination.ts (accept), cube/ssr/initialDataLists.test.tsx ("no request right after construction; a filter change is one request for the first page", since batch 6 also "the data answers `$default`: no request after construction; a sort change is one request for the first page") | `SKILL.md` |
| 7 | Rows without id | MEDIUM | cube/ssr/initialData.test.tsx ("a row without an id is reported once per list") | `SKILL.md` |
| 8 | Waiting for a resolver where there is no window | MEDIUM | cube/ssr/serverMode.test.tsx ("construction starts nothing", "store.start()") | `SKILL.md` |
| 9 | `usePalistor` called in every component that needs the shared store (in the file it follows mistake 1) | HIGH | cube/ssr/usePalistor.test.tsx ("two components with the same config get different stores", "every reader below the provider has the same store: a write through one shows in the other, and the page changing keeps it") | `SKILL.md` |

## Tensions

| Tension | Skills | Agent implication |
| --- | --- | --- |
| Hide a field vs keep the form submittable | `palistor` ↔ `palistor-flows` | `isVisible` hides a field but submit still validates it; only a hidden flow step is exempt. An agent that only hides a required field ships a form that cannot be submitted |
| Inferred config vs typed callbacks | all four | The config must stay an inferred literal for precise proxy types, so nothing types callback parameters. Un-annotated callbacks pass `intent validate` (`strict: false`) and fail the consumer build (TS7006) |
| One vocabulary under a field mapping | `palistor` ↔ `palistor-field-mapping` | Core examples use `isRequired`; with a `fieldMapping` the same config must use the mapped name, or the store throws at module load |
| Form field rules vs row field rules | `palistor` ↔ `palistor-lists` | A form field validates `isRequired` and hides errors until submit; a row field ignores `isRequired` and validates live |
| Module-level store vs a store per component instance | `palistor` ↔ `palistor-ssr` | The core skill creates the store at module level. A screen rendered on the server with request data needs `usePalistor`: a module is shared by every request and `initialData` exists only in the constructor. A store the whole app shares is per instance too (one provider in the layout, a React context below it): an agent asked for a "global store" otherwise makes it at module level, or calls `usePalistor` in every component and gets a store per caller. The context replaces the module import for the entry of a client subtree only; an agent that reads it in every component drops the node-as-prop model the core skill teaches |
| `initialValues` vs `initialData` | `palistor` ↔ `palistor-ssr` | `initialValues` are defaults; `initialData` is a result that also fills lists and marks a resolve as answered. Server data passed as `initialValues` gives a skeleton on the server and a repeated request in the browser |
| Automatic dependency tracking vs `initialData` | `palistor`, `palistor-lists` ↔ `palistor-ssr` | "Nothing to declare" holds for a resolver that has run. A resolve that got `initialData` has not: until its first real run only `deps`, `contextDeps`, filter fields and the list's `reload()` restart it (a group has no `reload()`) |
| A store that starts in its constructor vs a store that starts after the commit | `palistor`, `palistor-lists`, `palistor-flows` ↔ `palistor-ssr` | "Starts when the store is created" holds for `new Palistor()` in the browser. A `usePalistor` store is held until its component has committed: an agent that expects a called resolver, `resolveStatus: "pending"` or `onEnter` inside the first render, or that lifts the hook above a `<Suspense>` boundary to save requests, follows a rule that no longer exists |
| `initialData` vs a resolver's result for nested lists | `palistor-lists` ↔ `palistor-ssr` | `initialData` (and a restored draft) fills the lists nested in rows; a list's resolver does not. An agent that returns nested arrays from the outer resolver gets empty nested lists |
| A client sort's snapshot vs a client filter's live projection | `palistor-lists` | The filter follows row edits at once; the client sort keeps its order until a sort action, a load, `setItems` or `sort.refresh()`. An agent that expects the sort to follow edits ships a ▲ column out of order; one that re-sorts in the component sorts one page only and loses the stable order |
| Draft vs applied values in a manual filter | `palistor-lists` | `filter.<field>.value` and `filter.values` are drafts; the rows, `ctx.filter`, `isActive`, `activeCount` and `filter.applied` follow the applied values; `set` / `reset` / `clear` write drafts. Chips built from `filter.values`, or a Clear button without `apply()`, disagree with the rows |

## Cross-References

| From | To | Reason |
| --- | --- | --- |
| `palistor` | `palistor-lists` | Collections, `store.set / rekey / delete / invalidate`, the two-argument `useForm` |
| `palistor` | `palistor-flows` | Multi-step screens; the only exemption from submit validation is a hidden step |
| `palistor` | `palistor-field-mapping` | The core skill shows one native adapter; UI-kit adapters and renaming live there |
| `palistor-lists`, `palistor-flows`, `palistor-field-mapping` | `palistor` | All three assume config, store, `useForm`, group resolve options, `usePersist` and the annotation rule |
| `palistor-field-mapping` | `palistor-lists` | A mapping renames `dirty` / `loading` on lists and rows, never list methods or pagination members |
| `palistor`, `palistor-lists`, `palistor-flows` | `palistor-ssr` | Rendering on the server: `usePalistor` / `PalistorProvider` instead of a module-level store and effect hooks, `initialData` for rows, pages and step data, the no-`window` rule; since batch 3 also when a `usePalistor` store starts (eager resolves, the first `onEnter`, Suspense) |
| `palistor-ssr` | `palistor`, `palistor-lists`, `palistor-flows` | Assumes config, store, `useForm`, resolve options (`deps`, `contextDeps`, `suspense`), `usePersist`; the list itself and the step lifecycle are documented there |

## Reference Files

| Skill | References | Why they are separate |
| --- | --- | --- |
| `palistor` | `config-options`, `proxy-api`, `async-resolve`, `integrations`, `typescript` | Dense surfaces and conditional tasks (loading data, drafts, i18n, typing) that the common path does not need |
| `palistor-lists` | `list-api`, `entity-editing`, `filtering`, `pagination`, `sorting` (batch 6) | Each is an independent sub-task with its own vocabulary and mistakes. `SKILL.md` keeps one short pattern per sub-task with a reading condition (474 lines after batch 6) |
| `palistor-flows` | `flow-api` | Full member tables, exported types, lifecycle and reset rules |
| `palistor-field-mapping` | — | Fits in one file |
| `palistor-ssr` | — | Fits in one file (387 lines after batch 3, 484 after batch 4, 497 after batch 5); the per-node shapes of `initialData` are one table. The next addition needs a reference file: the limit is 500 lines |

## Remaining Gaps

Decisions that belong to the maintainer. None blocks the skills; each states what the skills do today.

| Skill | Question | Status |
| --- | --- | --- |
| `palistor` | Should a hidden field or group be exempt from submit validation? Today it is validated in both implementations, so the README quick start (a hidden `passport` group with a required field) cannot submit for a card payment. The skills document the current behavior and the same-predicate workaround | open |
| `palistor` | Which release first ships the skills? `metadata.library_version` is the current `package.json` version; run `intent validate --set-version <version>` before that release | open |
| `palistor` | `setValues` and formatters: README and JSDoc say formatters are skipped, the runtime runs them | open |
| `palistor` | `ProxyStore.setContext` JSDoc says "replaces wholesale"; the runtime (and the README) merge | open |
| all | Public types live in `store/**`; when `store/` is removed (Cube plan, Phase 4) the `sources` of all four skills must be remapped | open |
| all | The package is also published to GitHub Packages as `@projectint/palistor`; every example imports from `"palistor"` | open |
| `palistor-lists` | The JSDoc of `ConfigNode.resolve` says a template field resolver starts after the list resolver; the contract test shows it is lazy only. The skill follows the test | open |
| `palistor-lists` | A paginated list logs `pagination invariant: window ordinal 1 … has no cached page` on every query-key change (looks like a runtime defect; the skill does not mention it) | resolved in Cube, 2026-11-24 (batch 3): the warning is no longer logged for a query-key change (a server filter, `deps`), from any page, nor after a failed first page; it stays for a window the pager holds for loaded. Evidence: `cube/core/pagination.ts` (`project`), `cube/core/pagination.test.ts` ("a window page that is not cached yet is not an invariant violation"); `cube/ssr/initialDataDeps.test.ts` and `cube/ssr/initialDataLists.test.tsx` assert that nothing is warned. The skills never mentioned the warning, so no guidance changed |
| `palistor-lists` | Not probed at runtime, documented from README, types and contract-test titles: persistence round-trip, `scrollAnchor`, `keepPreviousData`, `maxPages`, `gcTime`, `revalidateOnHydrate`, list Suspense, nested-list pagination | open. Batch 6 probed the persisted window (restored without a request only when `await store.persist.enable()` resolves before the list's first fetch; `usePersist` requests the first page once), `setScrollAnchor` (notifies nothing; written with the next change or `persist.flush()`) and `keepPreviousData` (`page` / `pageCount` / `total` already describe the new query) and corrected `pagination.md`. Still unprobed: `maxPages`, `gcTime`, `revalidateOnHydrate`, list Suspense, nested-list pagination |
| `palistor-lists` | No public way to group a filter change and a sort change: `filter.set` / `filter.apply()` followed by `sort.toggle()` in one handler is two requests (the core groups them only inside its internal batch). Expose `store.batch(fn)` or a combined action? The sorting reference states the two requests | open |
| `palistor-lists` | A `{ by }` / `{ compare }` sort field must be named after an entity leaf in the types (TS2353), any name works at run time. The sorting reference teaches the workaround | open |
| `palistor-lists` | Library or guidance? With `keepPreviousData` the pager already shows the new query's counts ("Page 1 of 0" over the previous rows); `usePersist` hydrates after the store has started, so a persisted window costs one request. Both documented as they are | open |
| `palistor-lists` | Batch 6 statements resting on authoring probes or third-party code, not on a named test: `Date` stored as `{}`, `$all` without a `where` field, `$toParams` not the request identity, the `usePersist` request, `setScrollAnchor`, the `keepPreviousData` pager, one request per quick press on a paginated server sort, two requests for filter + sort in one handler, `as const` for `$apply`, HeroUI rejecting a custom row (`@react-stately/collections`) | open |
| `palistor-lists` | A custom `pagination.queryKey` replaces the whole key, so the server filter and the server sort never reach it: a filter change or a sort change sends no request and the rows stay (`cube/core/pagination.ts`, `computeKey`; release-audit probe, batch 7). Looks like a library defect; `pagination.md` and `sorting.md` warn against the combination | open |
| `palistor-lists` | A typed `defineList<TEntity>` template cannot declare a group (TS2353), so a dotted sort key (`"address.city"`) works there only as `{ by }`; a client value sort on it throws at construction. `sorting.md` teaches the `by` form. Should typed templates accept groups? | open |
| `palistor-lists` | In a manual filter block with a non-empty automatic server field, `clear()` then `apply()` is two requests, the first with the old applied values. `filtering.md` documents it and the one-request form. Library or guidance? | open |
| `palistor-ssr` | A list resolve cannot declare a context dependency: `ListResolveConfig` has `deps` but no `contextDeps`, and a paginated list ignores `contextDeps`. A list that got `initialData` therefore does not reload on a context change; the skill recommends a `key` on the component or `list.reload()` | open |
| `palistor-ssr` | Statements without a test in `cube/ssr`: `suspense: true` without a `<Suspense>` boundary fails the server render (authoring probe); Next.js sends the fallback without logging because of the digest (comment on `clientOnly`, checked against Next 16; the tests assert the digest, not Next's reaction); a group with `resolve` that got `initialValues` still resolves (authoring probe, order of `seed` and `applyInitialData` in the constructor) | open |
| `palistor-ssr` | `metadata.library_version` is `0.1.0-cube.0` (the current `package.json` version), but the published `0.1.0-cube.0` has no SSR API. The release that first ships SSR sets the version (`AGENTS.md`, "Releasing") | resolved at `a0fc80b` (release `0.1.0-cube.1`): `intent validate --set-version 0.1.0-cube.1` set the five skills and the "Targets" line. Reopened in another form by batch 3, next row |
| all | Batch 3 describes behavior of the working tree after `0.1.0-cube.1` (Stage 5а), while `metadata.library_version` and the "Targets palistor v…" line still say `0.1.0-cube.1`. The tagged `v0.1.0-cube.1` starts a `usePalistor` store in its constructor and lacks the other changes. The release that ships Stage 5а must set the version (`AGENTS.md`, "Releasing", step 4) | resolved at `7572329` ("🔖 0.1.1-cube.3"): `intent validate --set-version 0.1.1-cube.3` set the five skills and the "Targets" line. Before that, at batch 4 `package.json` was `0.1.1-cube.1` (commit `69dc215`, "🔖 0.1.1-cube.1") while the five skills and the "Targets" line still say `0.1.0-cube.1`: the version step was not part of that commit |
| `palistor-ssr`, `palistor` | Plain Node cannot import the package entry: `dist/index.js` re-exports `./cube/index` without a file extension, so `node -e 'import("palistor")'` fails with `ERR_MODULE_NOT_FOUND` (observed on the `0.1.1-cube.1` tarball by the consumer session of batch 4 and reproduced). A bundler or Vite resolves it, so Next.js and a Vitest `node` environment work. "Run a store without a browser" (`palistor-ssr`) and the no-`window` rule (`palistor`) name "a Node script" next to a test: decide whether the build gets extensions (or a bundle) or the skills say "a script run through a bundler or a TypeScript runner". The skills are unchanged | open |
| `palistor-ssr` | Should the library ship the app-wide store's plumbing (a typed `createStoreContext`-like helper, or `<StoreProvider store>`)? `experiments/SsrPlan.md` ("Что не делаем") left it out: a typed context in the app is a few lines, and a library provider would add an untyped lookup. The skill and the README teach the app's own context (batch 4). Revisit if the rollout on the consumers shows the same lines repeated | open |
| `palistor-ssr` | The `/ssr` routes of `app-demo` (the code the README's "SSR & Next.js" section links to) hand the whole `store` to their child blocks, which call `useForm(store).x`; the README and the skills teach a node as a prop since batch 5. The demo was out of scope of that batch: decide whether to align it | open |
| `palistor`, `palistor-lists`, `palistor-ssr` | The exported `ResolveErrorContext` type is still the store implementation's `{ notify }`; `t` is passed at runtime and joins the type in 0.1 (CubePlan, Phase 4). The skills teach two strict-TypeScript forms: the full annotation in a plain config object, the cast inside `defineList` and `Resolve<T>`. Remove both when the type gains `t` | open |
| `palistor`, `palistor-ssr` | A group has no `reload()`, `resolveStatus` or `error`; a group API is planned for 0.1. The skills state the absence and promise nothing | open |
| `palistor-lists`, `palistor-ssr` | Statements of batch 3 that had no named test when the batch was written (authoring probes only): a list's resolver does not fill the nested lists of its rows; a draft restored by `usePersist` fills nested lists; a nested list's `reload()` clears `dirty` along the chain | resolved 2026-11-24, same batch: `cube/contract/sliceC/entityListResolve.test.ts` ("a root list's resolver and the lists nested in its rows", both implementations), `cube/contract/sliceF/entityListPersist.test.ts` ("round-trip: a reload restores the root and per-entity lists"), `cube/core/listDirty.test.tsx` ("the nested list's reload() makes its rows the baseline: the chain is clean again"); cited in `references/list-api.md` |
| `palistor` | The `loading` and server-mode rules exist in the Cube runtime only; `store/` keeps the previous behavior (`cube/contract/impl.ts`). The skills describe the package entry, which runs on Cube | open |
| all | Typing gaps documented as workarounds instead of being fixed (library sources were out of scope): un-annotated config callbacks (TS7006), `FormConfig` cannot describe nested groups, `defineStep` narrows inline defaults to literals, `useForm(subtree)` rejected in a mapped store (a group when the map renames a group prop; a field with any rename, also after batch 5 typed `useForm(field)`), pagination and filter members optional, raw-array lists untyped, a typed template rejects `onSubmit` / template `resolve`, `store.set` rejects interface-typed objects, `PalistorRef` has no `id`, two-argument `useForm` returns `any` | open |

## Recommended Skill File Structure

- **Core skill:** `palistor` (the entry point; every other skill requires it).
- **Sub-skills:** `palistor-lists`, `palistor-flows`, `palistor-field-mapping`, `palistor-ssr` — each a task worth discovering on its own.
- **Framework skills:** none; the library is React-only. `palistor-ssr` names Next.js App Router in its description because that is where the task arises, but its API (`usePalistor`, `PalistorProvider`, `initialData`) is plain React, so it is a sub-skill.
- **Composition skills:** none yet. A UI-kit composition (MUI, Ant Design) would be the first candidate; today `palistor-field-mapping` covers it generically.
- **Layout:** flat, `skills/<name>/SKILL.md` at the repository root, names prefixed `palistor-` so they do not collide after third-party installers copy them into `.claude/skills/`.

## Coverage and batch history

### Assessed scope

The whole public entry (`index.ts`): `Palistor`, `useForm`, `usePersist`, `useTranslator`,
`useNotifier`, `useStoreContext`, `defineList`, `defineFlow`, `defineStep`, `defineFieldMapping`, the
storage drivers and the exported types; since batch 2 also `usePalistor`, `PalistorProvider`,
`usePalistorContext`, the constructor options `translator` / `notifier` / `initialData` / `server`,
`store.start()` and the types `InitialData`, `PalistorOptions`, `PalistorProviderProps`. Not
assessed: the subpath exports (`palistor/store/store`, `palistor/react/*`, `palistor/cube`) and the
modular entries planned in `experiments/ModulesPlan.md`.

### Batch 1 — 2026-11-15: split of the single skill, Intent distribution

- **Source revision:** branch `feat/intent-skills`, based on `cube-architecture` at `d6fdee2`;
  `package.json` version `0.1.0-cube.0` (unpublished; npm `latest` is `0.0.32`). Tooling:
  `@tanstack/intent` 0.5.6, TypeScript 5.9.3.
- **Input:** the single skill `.github/skills/palistor/SKILL.md` (1 624 lines, not shipped in the
  tarball) and the task description `PALISTOR_AGENT_SKILLS_TZ.md`.
- **Evidence:** the runtime behind the package entry is the Cube core (`cube/**`); public types are
  re-exported from `store/**`; `cube/contract/**` runs on both implementations. Every behavioral
  claim was checked against these (source reading, contract tests, throwaway probe tests). README and
  the old skill were treated as hints.

#### Decisions

| Decision | Reason |
| --- | --- |
| Four skills: `palistor`, `palistor-lists`, `palistor-flows`, `palistor-field-mapping` | Each is a developer task worth discovering on its own; the single file cost about 20k tokens per load and exceeded the 500-line limit three times over |
| Based on `cube-architecture`, not on `main` | The task description was written against `main@1dc3604`. `cube-architecture` is strictly ahead of it, the package entry already runs on the Cube core, and `store/` is scheduled for removal |
| `sources` = Cube runtime files plus the `store/**` files that define public types | That is where behavior and the type surface live on this branch. `palistor-lists` also lists four shared core files (`cube.ts`, `node.ts`, `hub.ts`, `resolve.ts`): row validation, row submit and the list surface live there. Trim them if review noise outweighs drift detection |
| Qualified source form `ProjectINT/palistor:path` | Tells a consumer where the file is; `intent maintainer review` resolves it against `origin` |
| Config callback parameters are annotated in every example | Under `strict` an un-annotated parameter in an inferred config is TS7006. `intent validate` compiles with `strict: false` and ignores that code, so only `npm run typecheck:skills` and a consumer build catch it |
| Task checks in `tests/skills/<task>/`, vitest project `skills`, `npm run test:skills` and `npm run typecheck:skills` | The existing vitest projects have explicit `include` lists; solutions import `"palistor"` like a consumer and are type-checked under `strict` |
| `review.ignore` in `skill_tree.yaml` for tests, the demo app, plans, READMEs and repo plumbing | Otherwise every such edit becomes a pending "unmapped change" review |
| `CLAUDE.md` containing `@AGENTS.md` | The task description said to create only `AGENTS.md`. Claude Code reads `AGENTS.md` by itself from 2.1.277; the version installed here is 2.1.261, which would not load the maintainer instructions. The import never loads the file twice |
| `intent validate` also in `test.yml`, not only in `check-skills.yml` and `publish.yml` | `check-skills.yml` runs on pull requests and releases only; this repository is mostly developed by direct pushes |
| `store/__skill_verify_tmp.test.ts` deleted | `cube/contract/sliceH/skillExample.test.ts` is its verbatim port and runs on both implementations |
| Plugin distribution from the repository, plugin name `palistor`, no `version` in the plugin manifest | Without a version Claude Code treats the commit as the version, so updates arrive without a manual bump |
| English for skills and planning records | Skills are read by agents in any consumer project |

#### Where the old skill went

Line numbers refer to the old `.github/skills/palistor/SKILL.md`.

| Old lines | Section | New location |
| --- | --- | --- |
| 8–19 | When to Use | The four `description` fields; not repeated in a body |
| 20–32 | Architecture overview | `palistor` opening line. The two-proxy-layer and `nodeState` description is dropped: not observable, and obsolete on the Cube core |
| 33–61 | Imports | Imports of the examples; the full import list is dropped |
| 62–94 | Typing values and props | `palistor/references/typescript.md` |
| 95–117 | Entity refs, `defineList` typing | `palistor-lists/references/list-api.md` |
| 119–146 | Type table | Split between `typescript.md`, `list-api.md`, `palistor-flows/references/flow-api.md` and `palistor-field-mapping` |
| 147–186 | Leaf node | `palistor` Setup, "Put each rule in its config key", `references/config-options.md` |
| 187–252 | Leaf callbacks | `references/config-options.md` ("`onChange` in detail", "Order of a submit") |
| 253–289 | Group node | `palistor` "Group fields", `config-options.md`, `references/async-resolve.md` |
| 290–309 | List node | `palistor-lists` Setup |
| 310–329 | Flow node | `palistor-flows` Setup |
| 330–346 | Creating a store | `palistor` Setup, `references/proxy-api.md`; the type-argument warning → `palistor-field-mapping` |
| 347–439 | `useForm` | `palistor` Setup, "Split rendering into child components", Common Mistakes; entity mode → `palistor-lists` |
| 440–498 | Hooks | `palistor/references/integrations.md` |
| 499–559 | Field and group proxy API | `references/proxy-api.md`; spread material also in `palistor-field-mapping` |
| 560–585 | List proxy API | `palistor-lists/references/list-api.md` |
| 586–797 | Field mapping and adapters | `palistor-field-mapping` |
| 798–826 | Store methods | `references/proxy-api.md`; entity methods → `list-api.md` |
| 827–857 | Key patterns | `palistor` "Show a field conditionally", "Compute and cascade"; list rendering → `palistor-lists` |
| 858–1326 | Lists and entities | `palistor-lists` and its four references. The binding model (1312–1325) is dropped: internal |
| 1327–1560 | Flows | `palistor-flows` and `flow-api.md` |
| 1561–1599 | Common Mistakes | Split by owner, see the next table |
| 1600–1618 | Pipelines | Observable order kept in `config-options.md`, `async-resolve.md`, `palistor-lists`, `palistor-flows`; internal step names dropped |
| 1619–1624 | Re-render optimization | `palistor` "Split rendering…", `proxy-api.md` "Re-rendering" (corrected, see below) |

#### Where the 34 old mistake rows went

Rows are numbered in the order of the old table.

| # | Old row | Destination |
| --- | --- | --- |
| 1 | Reading `form.field` without `useForm` | `palistor`: "Reading state in render without `useForm`" |
| 2 | Passing `store.proxy.X` to `useForm` | `palistor`: "Passing `store.proxy` (or a part of it) to `useForm`" (`expect-error=TS2769`) |
| 3 | Mutating config after creation | `palistor`: "Changing the config object after the store exists" |
| 4 | Missing `dependencies` for computed | **Removed.** The runtime ignores `dependencies` (functions track what they read). Stated in "Put each rule in its config key" and `config-options.md` |
| 5 | `form.email.value` outside render | `palistor`: "Split rendering into child components" (last paragraph) and mistake 1 |
| 6 | `store.submit()` vs `form.group.submit()` | `palistor`: "Root submit where a group submit was meant" |
| 7 | `store.delete(id)` and lists | `palistor-lists`: "Confusing `list.remove(id)` with `store.delete(id)`" — corrected: `delete` does remove the row from every list |
| 8 | Array config with more than two elements | `palistor-lists`: "Declaring a list as a raw array" — the guard does not exist in the Cube runtime |
| 9 | Ignoring the `add(values)` return | `palistor-lists`: "Looking up the row you just added" |
| 10 | Omitting `resolve.onError` | Group and field half → `palistor/references/async-resolve.md` "Omitting `onError`" (`expect-error=TS2741`); list half → `palistor-lists` Setup and mistake 11 |
| 11 | Empty list vs failed resolve | `palistor-lists`: "Treating a failed or not-yet-started list as empty" |
| 12 | Reaching into `store.resolveManager` / `store.subscribe` | `palistor-lists`: "Reaching into store internals for list state" |
| 13 | Re-read of `list.items` does not refetch | `palistor-lists`: "Expecting a re-read or re-mount to refetch" |
| 14 | `useForm(store, selector)` | `palistor`: "`useForm(store, selector)`" |
| 15 | `list.items[0]` as React key | `palistor-lists`: "Index or row object as the React key" |
| 16 | Entity fields outside `useForm` | `palistor-lists`: "Reading row fields in a child component without `useForm(row)`" |
| 17 | Field resolve without access | `palistor-lists/references/entity-editing.md`: "Expecting a field resolver to run when the list loads" — corrected: lazy only |
| 18 | Template field resolver and form-level deps | `entity-editing.md`: "Reading form values in a field resolver" |
| 19 | `store.invalidate` vs `store.delete` | `entity-editing.md`: "Using `store.invalidate` to remove or refresh a row" |
| 20 | Template without `id` | `palistor-lists`: "Template or rows without `id`" (`expect-error=TS2741`) |
| 21 | Renamed names not typed | `palistor-field-mapping`: "A map that loses its literal types" |
| 22 | `new Palistor<typeof config>` loses mapping types | `palistor-field-mapping`: "`new Palistor<typeof config>(…)` with a map" |
| 23 | Expecting `fieldMapping` to transform values | `palistor-field-mapping`: "Expecting the map to convert values" |
| 24 | Two internal keys to one external name | `palistor-field-mapping`: "Two palistor props mapped to one name" — corrected: nothing forbids it, one prop silently replaces the other |
| 25 | Hand-wiring `value` / `onChange` per field | `palistor-field-mapping`: "Wiring props by hand for every field" |
| 26 | Spread leaks props to the DOM | `palistor-field-mapping`: "Spreading a field where palistor-only props are not consumed" |
| 27 | A fresh adapter per field | `palistor-field-mapping`: "A new adapter for every field" |
| 28, 29 | Raw group as a step; step with `value` or `status` | `palistor-flows`: "Steps that throw when the module loads" |
| 30 | Expecting `nextStep()` to visit a hidden step | `palistor-flows`: "Branch by hiding a step" and "Sending the untaken branch to the server" |
| 31 | Flow state outside `useForm` | `palistor-flows`: "Reading the flow through `store.proxy` in a component" |
| 32 | Step `onSubmit` third argument | `palistor-flows`: "Looking for navigation methods on the step" |
| 33 | `flow.back()` without `canGoBack` | `palistor-flows`: "A Back button that ignores `canGoBack`" |
| 34 | Navigation state in values | `palistor-flows`: "Expecting the current step in the values" |

#### Corrections: where the old skill or the README disagreed with the code

| Old claim | What the code does | Evidence |
| --- | --- | --- |
| Examples use un-annotated config callbacks (`(values) => …`) | Under `strict` each is TS7006; `FormConfig<V>` typing works only for a config without groups | `npm run typecheck:skills`; `tests/skills/tsconfig.json` |
| A hidden field is simply hidden | Submit validates every field of the subtree, hidden ones and hidden groups included; only a hidden flow step is exempt | `cube/core/cube.ts` (`collectErrors`), probe |
| A group's `isInvalid` means "any child invalid" | It reflects the group's own `validate` / `isRequired` only; there is no aggregate flag | `cube/core/cube.ts` (`isInvalid`), probe |
| `isInvalid` is `true` / `false` after a submit | It is `true` or `undefined`, never `false` | `cube/core/cube.ts` |
| "Use `dependencies` for cross-field computed props" | `dependencies` is ignored; functions track what they read | `cube/core/cube.ts` (no reads of it), probe |
| Reading only `field.value` re-renders only on value changes | Subscription is per node: any state change of a read field re-renders | `cube/react/useForm.ts` (`track`, `stateVersion`) |
| Submit order: validate, then `beforeSubmit` | `beforeSubmit` builds the payload first; validation checks the stored values; `submit()` rejects when `onSubmit` throws | `cube/core/cube.ts` (`submit`), probe |
| Not stated: which `values` a callback receives | `value` / `validate` / `setter` / flags get the parent group's values; `formatter`, texts and `onChange` get the whole form; a group resolver gets the whole form | `cube/core/cube.ts` (`scopeValues`, `ctxValues`), `cube/core/resolve.ts`, probe |
| Not stated: a number field bound to a text input | The store keeps the string; a `formatter` must convert | probe |
| `useStoreContext` clears the context on unmount | It does not; `setContext` merges | `cube/react/useStoreContext.ts`, `cube/core/hub.ts` |
| `setValues` skips formatters (README, JSDoc) | Formatters run; `setter` and `onChange` are skipped | `cube/core/cube.ts` (`setValues`), probe |
| `store.delete(id)` leaves the row in lists | It removes the row from every list | `cube/contract/sliceC/deleteListConsistency.test.ts` |
| Template field resolvers auto-start after the list resolver (also in the `ConfigNode.resolve` JSDoc) | They start lazily, on the first read of the field | `cube/contract/sliceC/entityFieldResolve.test.tsx` |
| `store.invalidate(id, store.proxy.editForm)` | The second argument must be the template config object; a proxy node is a no-op | `cube/contract/sliceC/entityTemplateResolve.test.tsx`, probe |
| A dependency change resets a list to idle until the next read | The list resolver re-runs immediately | `cube/core/resolve.ts` (`checkDeps`) |
| `back()` drops the left step from the visited set | The left step stays `"completed"` | `cube/contract/sliceI/flowNavigation.test.ts` |
| `FlowStepProxy<{ fullName: string }>` for a step prop | The type takes the step's config type; with a values interface every field is `never` | `store/store/types.ts` |
| `flow.errors` rendered under a Next button that calls `step.submit()` | Only `flow.validate()` and `flow.submit()` write `flow.errors` | `cube/core/flow.ts` |
| A config in palistor's names together with a `fieldMapping` | The constructor throws; the config must use the mapped names | `cube/contract/sliceH/skillExample.test.ts` |
| A mapped spread goes into a UI kit "without adapters" (README) | An adapter is still required: `isVisible` and `onValueChange` leak and the input stays read-only | `cube/contract/sliceH/fieldMapping.test.tsx` |

#### Check outcomes

Structural validation, executable task checks and consumer-agent evidence are reported separately.
What was not run is stated as such.

| Check | Result |
| --- | --- |
| `npm run build` | passes |
| `npm test` (vitest project `store`) | 167 files, 2226 passed, 2 todo. Baseline before the batch: 168 files, 2228 passed; the difference is the removed duplicate `store/__skill_verify_tmp.test.ts` (2 tests) |
| `npm run test:cube`, `npm run typecheck:cube` | 77 files, 975 passed, 1 todo (equal to the baseline); type-check passes |
| `npm exec --no -- intent validate` | 4 skill files pass, no packaging warnings. 57 fences are compiled against the source (4 skills and 10 references), 11 of them `expect-error`; no `no-check` fence |
| Strict compile of every example | 46 plain `ts` / `tsx` fences compiled with `tests/skills/tsconfig.json` (`strict: true`): no implicit-`any` and no type errors. Run with a one-off script; it is not part of the repository |
| `npm run typecheck:skills` | passes (fixtures, reference solutions, mistakes, graders) |
| `npm run test:skills` | 5 task checks: 36 checks pass on the reference solutions, 10 named checks fail on the mistakes as expected (`it.fails`) |
| Sizes | `SKILL.md`: 460 / 423 / 403 / 359 lines (limit 500; the 400-line target for `palistor` is not met). Descriptions: 722 / 770 / 675 / 822 characters (limit 1024) |
| `npm pack --dry-run` | 14 files under `skills/palistor*/`; nothing from `skills/_artifacts`, `tests/`, `.intent/` |
| Consumer probe | The tarball installed into an empty project: `intent list` shows `palistor` with 4 skills; `intent load palistor#palistor-lists` prints the skill. `intent install` needs an interactive terminal for its first run (it records `package.json#intent.skills`); with that key set it writes the "Skill Loading" block into `AGENTS.md` |
| `claude plugin validate .` (Claude Code 2.1.261) | passes with 4 warnings: the generated manifests have no description, author or version (the version is left out on purpose) |

Fresh consumer sessions (2026-11-15). Setup: the packed tarball and Intent installed in a disposable
project with a strict `tsconfig.json`, the `AGENTS.md` block written by `intent install`, the task
text and the fixture files. Each session was an isolated general-purpose subagent of the authoring
harness that received only the project path and the instruction to follow `AGENTS.md` and `TASK.md`;
it had no part of the authoring conversation. Its files were then graded by the unchanged checks.

| Task | Skills the agent loaded | Graded result |
| --- | --- | --- |
| `lists-server-list` | `palistor-lists`, `palistor`, `references/list-api.md` | 6 of 6 |
| `flow-branching-wizard` | `palistor-flows`, `palistor`, `flow-api.md`, three core references | 9 of 9 |
| `form-dependent-fields` | `palistor`, three core references | 5 of 7 as delivered. Both failures assert the payload key `method`, which the task text did not name (the agent called the field `delivery`); with that one key renamed the result is 7 of 7. The task text now states the keys. Not re-run after the fix |
| `field-mapping-adapter`, `lists-catalog-pages` | — | not run |

Changes made from what the sessions reported:

- `palistor` Setup is now one self-contained example. Before, the component example imported the
  store from a sibling example, which the validator resolves to `any`; a real type error
  (`onValueChange(e.target.value)` on a union field, TS2345) went unnoticed. No skill example imports
  from another example any more.
- `palistor`: `submit()` re-entrancy, the `.catch` on the Setup submit, `type` alias vs `interface`
  for values, the trim-formatter warning, removing a computed value from the payload.
- `palistor-lists` Setup branches on `resolveStatus` and reads `length` before any early return
  (`error` is `null` after a rejection with no value; an early return on `idle` never starts the load).
- `palistor-flows`: `try / catch` around `flow.submit()`, where the "finished" state lives.

Reported and not changed: the "Source:" citations name repository paths that are not in the
package; Intent's `AGENTS.md` block does not mention a skill's `requires`; the package's `dist` cannot
be imported by plain Node (extensionless ESM imports, no `"type": "module"`), so a consumer agent
cannot smoke-test without a bundler.

Not run: description activation (`tests/skills/discovery.md`); a comparison run without the skills.

`intent maintainer review --record` and `intent maintainer check` were run after this section was
written; their result is in the handoff message of the batch.

#### Remaining work

- Maintainer review of the four skills and of the open questions in "Remaining Gaps".
- A fresh consumer-agent session per task check, and an activation run of the prompts in
  `tests/skills/discovery.md` (see "Check outcomes" for what was and was not run).
- Before the first release that ships the skills: `intent validate --set-version <version>` and the
  "Targets palistor v…" line in `skills/palistor/SKILL.md` (procedure in `AGENTS.md`, "Releasing").
- When `store/` is removed: remap `sources` to the new home of the public types.

### Batch 2 — 2026-11-23: `palistor-ssr`; server mode and the `loading` rule

- **Source revision:** branch `cube-architecture` at `69faf7f` plus the uncommitted working tree of
  the SSR work (`experiments/SsrPlan.md`, Stages 1–4); `package.json` version `0.1.0-cube.0`.
  Tooling: `@tanstack/intent` 0.5.6, TypeScript 5.9.3.
- **Input:** `experiments/SsrPlan.md`, Stage 5 ("Skills"), and a fact sheet from the implementing
  session.
- **Evidence:** `cube/palistor.ts`, `cube/types.ts`, `cube/core/{hub,resolve,restore,pagination,flow,cube,listCube,node}.ts`,
  `cube/react/{usePalistor.ts,provider.tsx}`, the nine test files of `cube/ssr/`, and the six
  contract files whose `loading` expectations changed (`LOADING_ON_FIRST_READ`,
  `cube/contract/impl.ts`). Statements that no test covers were probed with throwaway tests and
  are listed in "Remaining Gaps".

#### Decisions

| Decision | Reason |
| --- | --- |
| A new skill `palistor-ssr`, not a section of `palistor` | "Render this screen on the server in Next.js" is found on its own: the request names neither forms nor lists, and its prerequisites (a store per component instance, constructor-time wiring) contradict the core skill's default setup |
| Type `sub-skill`, `requires: [palistor]`; `palistor-lists` and `palistor-flows` are conditional pointers | The API is plain React, not a framework binding; a server-rendered form needs neither lists nor flows |
| New domain `server-rendering` | The task cuts across forms, lists and flows |
| `sources` are runtime files only; the `cube/ssr` tests are cited in the body | Same rule as batch 1: tests are in `review.ignore`, and a behavior change always touches a runtime source |
| No reference file | 355 lines; the conditional detail (per-node shapes of `initialData`) is one table |
| The no-`window` rule has two homes with pointers: remediation for a form in `palistor/references/async-resolve.md` ("Waiting for a resolve that never starts"), the full description in `palistor-ssr` | Any user of the core skill can hit it in a Node test; only the SSR task needs the rest |
| Descriptions of `palistor` and `palistor-lists` got a pointer to `palistor-ssr` | Both already enumerate the sibling skills as boundaries |
| `palistor-ssr` added to the repository distribution selection (`distribution.skills` in `skill_tree.yaml`), manifests regenerated by `intent maintainer sync` | Requested with the batch; the selection was all skills before. `intent maintainer setup --distribution` was not run: it also rewrites `AGENTS.md` and CI, outside the batch |
| `domain_map.yaml` keeps its one-line strings | `intent maintainer add` re-wrapped every string of the file; the file was restored from `HEAD` and the new entries were added by hand to keep the diff readable |
| Mistake variant of the task check: the translator registered through `useTranslator` | `initialValues` with rows of a typed list does not compile (TS2345), and a task-check mistake is imported by the test, so it must type-check |

#### Guidance changed in the existing skills

Behavior that changed for every consumer, not only for server rendering.

| Where | Before | After | Evidence |
| --- | --- | --- | --- |
| `palistor/references/async-resolve.md`, Behavior | Reading `loading` alone does not start a lazy resolve; `loading` is `true` while a run is pending | The first read of the children, `value` or `loading` starts it; `loading` is `true` from that read (from creation with `lazy: false`) until the run lands, `false` while it waits for `contextDeps`; without `window` nothing starts until `store.start()` | `cube/core/node.ts` (`groupNode`), `cube/core/resolve.ts` (`due`), `cube/contract/sliceJ/suspense.react.test.tsx`, `cube/ssr/serverMode.test.tsx` |
| same file, mistake 14 | "Waiting for a resolve that nothing reads": rendering only `loading` shows `false` forever | "Waiting for a resolve that never starts": nothing reads it (`getValues()`, `group.values`, `dirty` do not count), or there is no `window` | probe; `cube/ssr/serverMode.test.tsx` |
| same file, Suspense | — | In a server render the fallback is sent; pointer to `palistor-ssr` | `cube/ssr/suspense.test.tsx` |
| `palistor/references/proxy-api.md` | Group `loading`: "Reading it does not start a lazy resolve"; no `start()` | Reading it starts a lazy resolve; `start()` in the store table; the new constructor options named with their owners | `cube/core/node.ts`, `cube/palistor.ts` |
| `palistor/references/integrations.md` | Only the effect hooks | The constructor takes `translator`, `notifier`, `context`; the hooks register after the first render; pointer to `palistor-ssr` | `cube/palistor.ts`, `cube/react/useTranslator.ts`, `cube/ssr/hydration.test.tsx` |
| `palistor/SKILL.md` | "Create the store at module level … never inside a component" | The same default, with the exception of a server-rendered screen with request data (`usePalistor`); routing table, decision list, description and version line name `palistor-ssr` | `cube/react/usePalistor.ts`, `cube/ssr/usePalistor.test.tsx` |
| `palistor-lists/SKILL.md`, "How it runs" | "`loading`, `error` and `resolveStatus` never start it" | `loading` (and `isInitialLoading`) start it, `error` and `resolveStatus` do not; `loading` is `true` from the first read while `resolveStatus` is still `"idle"`; the no-`window` rule | `cube/core/node.ts` (`listNode`), `cube/contract/sliceC/listResolve.test.ts`, `cube/contract/sliceC/defineList.test.ts`, `cube/ssr/serverMode.test.tsx` |
| same file, mistake 1 | "a list is `idle` with no items on the server render and on the first client render … Both look like no data" | A failed resolve looks empty to `!loading && length === 0`; a check of `length` alone also shows the empty state before the load; `loading` covers the first render | `cube/contract/sliceC/listResolveError.test.ts`, `cube/contract/sliceC/listResolve.test.ts` |
| `palistor-lists/references/list-api.md` | `loading`: "The resolver is running" | Running or about to run; reading it starts a lazy resolve; `resolveStatus` never starts it; row-field `loading` from the first read; Suspense in a server render | same |
| `palistor-lists/references/pagination.md` | `list.loading` reads the same signal as `isFetching`; `isInitialLoading`: "Fetching with nothing to show" | `loading` = `isFetching` plus the first fetch that is due; `isInitialLoading` is `true` from the first read and starts the first fetch; `initialData` for the first page | `cube/core/listCube.ts`, `cube/core/pagination.ts` (`due`, `isInitialLoading`, `accept`), `cube/contract/sliceG/pagination.test.ts`, `cube/ssr/initialDataLists.test.tsx` |
| `palistor-lists/references/entity-editing.md` | List resolve starts on `items` / `length` / `map` | … / `loading` | `cube/core/node.ts` |
| `palistor-flows/SKILL.md`, "Run code when a step opens" | "The first step is entered when the store is created — at module load, on the server too" | Entered at creation in the browser; without `window` no step is entered and `onEnter` / `onReady` are not called until `store.start()`; a step's `loading` never starts its resolve | `cube/ssr/serverMode.test.tsx`, `cube/core/flow.ts` (`enterCurrent`), `cube/core/node.ts` (`groupNode`) |
| `palistor-flows/references/flow-api.md` | `loading`: "any step's resolve is pending"; entry at store creation | … or the active step's is about to start; the no-`window` rule; a step that got `initialData` gets `onReady` right after `onEnter` | `cube/ssr/serverMode.test.tsx`, `cube/ssr/initialDataFlow.test.ts` |
| `tests/skills/lists-server-list` | The mistake failed two checks | It fails one: its `if (list.loading)` now covers the first render, so only the failed load is treated as empty | `npm run test:skills` |

Verified unchanged: `palistor-field-mapping` (its sources did not change; it names `loading` only as a
mappable prop), `palistor/references/config-options.md` and `typescript.md`,
`palistor-lists/references/filtering.md`, the template resolve of `useForm(row, selector)` (it starts
from an effect and `loading` still means "pending": `cube/core/cube.ts`, `loading`). No task check
runs in a `node` environment.

#### Check outcomes

| Check | Result |
| --- | --- |
| `npm exec --no -- intent validate skills` | 5 skill files pass; after `maintainer sync` no packaging warning |
| Strict compile of the new examples | The 5 plain `ts` / `tsx` fences of `palistor-ssr` compile with `strict: true` against the package entry (one-off script, as in batch 1); the sixth fence is `expect-error=TS2345` and is checked by `intent validate` |
| `npm run typecheck:skills` | passes |
| `npm run test:skills` | 6 task checks: 40 checks pass on the reference solutions, 10 named checks fail on the mistakes as expected. New: `ssr-server-list` (4 checks; the mistake fails 1) |
| Grader of `ssr-server-list` against other wrong solutions (throwaway, not in the repository) | Rows passed as `initialValues` with a cast: 4 of 4 checks fail. A module-level store filled during render: 4 of 4 fail |
| Sizes | `SKILL.md`: 466 / 425 / 404 / 359 / 355 lines (limit 500). Descriptions: 779 / 839 / 675 / 822 / 996 characters (limit 1024) |
| `npm pack --dry-run` | 15 files under `skills/palistor*/`, `skills/palistor-ssr/SKILL.md` among them; nothing from `skills/_artifacts`, `tests/`, `.intent/` |
| Fresh consumer session for `ssr-server-list` | not run |
| Description activation (`tests/skills/discovery.md`) | not run; prompts for `palistor-ssr` were added |
| `npm run test:cube`, `npm test`, `npm run build` | not run by this batch (the runtime was being edited by other sessions at the same time) |

`intent maintainer review --record` and `intent maintainer check` were run after this section was
written; their result is in the handoff message of the batch. The runtime was still changing when the
batch ended, so the recorded review may be reopened by later source edits.

#### Remaining work

- Maintainer review of `palistor-ssr`, of the changed passages above and of the new rows in
  "Remaining Gaps".
- A fresh consumer-agent session for `ssr-server-list` and an activation run of the `palistor-ssr`
  prompts.
- At the release that first ships SSR: `intent validate --set-version <version>` and the "Targets
  palistor v…" line in `skills/palistor/SKILL.md`.
- If `usePalistor` gets more consumers outside server rendering (one hook instead of `useState` +
  three effect hooks), decide whether its home stays `palistor-ssr` or moves to the core skill.

### Batch 3 — 2026-11-24: Stage 5а, fixes after the SSR demo

- **Source revision:** branch `cube-architecture` at `fe38200` plus the uncommitted working tree of
  Stage 5а (`experiments/SsrPlan.md`, «Этап 5а»); `package.json` version `0.1.0-cube.1`. Tooling:
  `@tanstack/intent` 0.5.6, TypeScript 5.9.3.
- **Input:** a fact sheet from the implementing session (seven behavior items, each with the tests
  that prove it) and `intent maintainer status`, which listed four skills and the planning records
  for review. An update: no skill was added and no description changed.
- **Evidence:** the working-tree diff of `cube/palistor.ts`, `cube/react/usePalistor.ts` and
  `cube/core/{hub,cube,listCube,pagination,resolve,restore,flow,config}.ts`; the tests
  `cube/ssr/usePalistor.test.tsx`, `cube/ssr/suspense.test.tsx`, `cube/ssr/initialDataLists.test.tsx`,
  `cube/core/pagination.test.ts`, `cube/core/resolve.test.ts`, `cube/core/listDirty.test.tsx`,
  `cube/contract/sliceC/entityListDirty.test.ts`, `cube/contract/sliceC/entityListResolve.test.ts`,
  `cube/contract/sliceC/entityFieldResolve.test.tsx`. Three statements had no named test while the
  batch was written and were probed with throwaway tests; the tests were added before handoff (see
  "Remaining Gaps", resolved row).

#### Decisions

| Decision | Reason |
| --- | --- |
| No new skill and no new failure-mode heading; every item goes into the section that owns the rule | Each item changes or completes a rule an existing section states. The one candidate mistake (an offset feed that sends `nextCursor: null`) is a rule of the resolver contract in `pagination.md`, where a resolver is written |
| "When a `usePalistor` store starts" lives in `palistor-ssr` ("Know when the store starts"). `palistor` (`async-resolve.md`, `proxy-api.md`), `palistor-lists` and `palistor-flows` state the one-line consequence and point there | The hook is owned by `palistor-ssr` since batch 2; the consequence (an eager resolve, the first `onEnter`, `resolveStatus` in the first render) reaches every user of the hook |
| `cube/react/usePalistor.ts` added to the `sources` of `palistor-lists` and `palistor-flows` | Both now state when a `usePalistor` store starts a list resolve or enters the first step; a later change of the hook must reopen them. Drop the entry if the extra review items outweigh that |
| The Suspense behavior of `usePalistor` is written as behavior, not as a retracted mistake | The earlier advice ("call `usePalistor` above the boundary and read the node below it") was in the hook's JSDoc and the README only; no skill ever stated it |
| `t` in `onError`: one home for the typing rule, `palistor/references/async-resolve.md` ("Typing `onError`"); compiled examples of the cast form in `palistor-ssr` Setup and `list-api.md`, of the full annotation in `async-resolve.md` and `palistor-ssr` | The exported `ResolveErrorContext` has no `t` until 0.1; the full annotation compiles only in a plain config object, the cast everywhere |
| The infinite example of `pagination.md` drops `hasMore: r.next !== null` | It compensated the defect this batch fixed; `nextCursor: null` alone ends the feed now |
| Nested lists stay in `palistor-lists/references/list-api.md` ("Lists nested inside a row"); `SKILL.md` carries one clause on `dirty` and one on `store.reset()` with a pointer | The typed template does not accept a nested list without the cast shown there, so whoever writes one reads that section |
| Descriptions unchanged; no discovery prompt added | The tasks that select each skill are the same |
| `metadata.library_version`, the "Targets palistor v…" line and the version fields of the planning records untouched | The maintainer sets the version at the release that ships Stage 5а; at release `0.1.0-cube.1` the planning records were left alone as well |
| No task check changed or added | See "Check outcomes" |

#### Guidance changed

| Where | Before | After | Evidence |
| --- | --- | --- | --- |
| `palistor-ssr/SKILL.md`, opening rule 2 and "How it runs" | "The server pass starts nothing"; a node with `initialData` reads `resolveStatus: "resolved"` | No render starts anything: a `usePalistor` store is held until its component has committed. `resolveStatus` is named for lists only. `reset()` returns to the data without a request. Exception: rows as `initialData` fill nested lists, a list's resolver does not | `cube/ssr/usePalistor.test.tsx` ("usePalistor: the store starts after the commit"), `cube/ssr/initialDataLists.test.tsx` ("the form reset keeps the server's result: the list stays resolved, and reading it requests nothing") |
| same file, new "Know when the store starts" | — (the hook's JSDoc said the constructor's `server` option decides) | Held store, `store.start()` in an effect, idempotent under StrictMode; `loading: true` and `resolveStatus: "idle"` until then; a render React throws away requests nothing; a child's earlier effect is not lost; `server: true` is the manual mode; `new Palistor()` is not held; the note for code written against the earlier behavior | the same file, describes "usePalistor: the store starts after the commit" and "usePalistor: a render React throws away starts nothing" |
| same file, "Decide what a node without server data shows" | Server-side fallback only; "after such a fallback the browser mounts the component as on any first mount" | Adds the browser side: the first render shows the defaults, the start brings the fallback; the component that owns the store may read the node itself; a reader of a group's fields only never shows the fallback; a boundary is still required | describe "usePalistor and Suspense" |
| same file, "Hand over what the server fetched" | "…and on `reload()`" | "…and on the list's `reload()`"; a group has no `reload()`, `resolveStatus` or `error` and is re-run by its declared `deps` / `contextDeps` only; only `initialData` and a restored draft fill a nested list; `nextCursor: null` in a first page | `cube/core/node.ts` (`groupNode`, `listNode`), `cube/ssr/initialDataLists.test.tsx`, `cube/core/pagination.test.ts` ("a first page given as initialData with nextCursor: null is a complete feed") |
| same file, Setup, "Translate and share context…", "Run a store without a browser" | `onError(error, ctx)` with `ctx.notify` only | `onError` gets `{ notify, t }`; Setup shows the cast form inside `defineList`, the Node example the full annotation; `server: true` in the hook's options; `suspense: true` after `start()` in Node | `cube/core/resolve.test.ts` ("onError gets the store's translator"), `cube/ssr/suspense.test.tsx` ("suspense: true after store.start() in Node") |
| `palistor/references/async-resolve.md` | `onError(error, { notify })`; `lazy: false` starts on store creation; Suspense: server note only | `onError(error, { notify, t })` and "Typing `onError`"; a group has no `error`, `resolveStatus` or `reload()`; a `usePalistor` store starts after the commit (Start, `options.lazy`, mistake 14); who suspends under `suspense: true` | `cube/core/resolve.test.ts`, `cube/core/hub.ts` (`errorContext`), `cube/contract/sliceJ/suspense.react.test.tsx`, `cube/ssr/usePalistor.test.tsx` |
| `palistor/references/typescript.md`, `integrations.md`, `proxy-api.md` | `ResolveErrorContext` = "the second argument of `onError`"; `notify` only; "the constructor calls `start()`"; group `dirty` = any field below | The type declares `notify` only while the argument also carries `t`; `notify(t("…"))` from the config; the constructor of `new Palistor()` calls `start()`, for a `usePalistor` store the hook does; group `dirty` also follows the lists below, nested ones included | same; `cube/core/listDirty.test.tsx` ("three levels: an edit in the deepest list makes every list, row and group above it dirty") |
| `palistor-lists/SKILL.md` | `lazy: false` starts at store creation; `dirty` = membership differs; `store.reset()` leaves a root list alone | Plus: a `usePalistor` store starts after the commit; `onError` gets `t`; `dirty` also follows nested lists; `store.reset()` returns nested lists to their loaded rows and requests nothing | `cube/contract/sliceC/entityListDirty.test.ts`, `cube/contract/sliceC/entityListResolve.test.ts`, `cube/contract/sliceC/entityFieldResolve.test.tsx` |
| `palistor-lists/references/list-api.md` | `onError(error, { notify })`; list `dirty` = membership; row `dirty` = fields; four bullets on nested lists | The cast example for `t`; list and row `dirty` include nested lists; four new bullets: how a nested list gets its rows, `dirty` up the chain, `store.reset()` (nothing requested, off-screen owners included, `reload()` to fetch again), what clears the chain after a submit | the three contract files above, `cube/core/listDirty.test.tsx`, `cube/ssr/initialDataLists.test.tsx` ("initialData: nested lists inside rows") |
| `palistor-lists/references/entity-editing.md` | — | A full `store.reset()` requests nothing for a row field that has its result; `onError` of every level gets `{ notify, t }` | `cube/contract/sliceC/entityFieldResolve.test.tsx` ("store.reset() runs nothing by itself; the next read re-runs on store, keeps the loaded result on Cube") |
| `palistor-lists/references/pagination.md` | `nextCursor` is the continuation; the infinite example returned `hasMore: r.next !== null` | An explicit `nextCursor: null` ends a `cursor` / `infinite` feed and wins over `total`, `hasMore: true` and a full page; a page without the field keeps the earlier rule; an offset feed must omit the field; nested lists of off-screen rows count in `dirty` | `cube/core/pagination.test.ts` ("nextCursor: null ends the feed (cursor and infinite)"), `cube/core/listDirty.test.tsx` ("a nested edit on a cached page that is off screen keeps the list dirty; reset clears it") |
| `palistor-flows/SKILL.md`, `references/flow-api.md` | The first step is entered when the store is created, in the browser | …for `new Palistor()`. In a `usePalistor` store it is entered after the component's first commit; a render React throws away never runs `onEnter` | `cube/ssr/usePalistor.test.tsx` ("the render starts nothing and reads what a server render reads; the effect starts everything once", "new Palistor() outside the hook is not held: in the browser its constructor starts it") |

No citation had to be renamed: the renamed and removed tests of `cube/ssr/usePalistor.test.tsx`
(describe "usePalistor and Suspense") were never quoted in a skill or in these records. Every quoted
test name in `skills/**` was checked against `cube/**` after the edit.

Verified unchanged: `palistor-field-mapping` (its sources `cube/core/mapping.ts`,
`store/defineFieldMapping.ts` and `store/constants.ts` are not in the diff, and it states none of
the changed behaviors), the body of `palistor/SKILL.md` (it says nothing about when a resolve
starts, about the `onError` context or about lists under a reset),
`palistor/references/config-options.md`, `palistor-lists/references/filtering.md`. The note about
the false "pagination invariant" warning existed only in these records.

#### Check outcomes

| Check | Result |
| --- | --- |
| `npm exec --no -- intent validate` | 5 skill files pass |
| Strict compile of the changed examples | 5 fences (`palistor-ssr` Setup and the Node example, `async-resolve.md` "Declare it", `list-api.md` "Declaring a list", the infinite feed of `pagination.md`) and one file of the inline forms quoted in prose (the full annotation in an edit template, the root `afterSubmit` that resets, the cast in a `Resolve<T>`) compile with `tests/skills/tsconfig.json` (`strict: true`); the same file proves with `@ts-expect-error` that the full annotation is rejected inside `defineList` and in a `Resolve<T>`. Temporary files, removed after the run; none needed a fix |
| `npm run typecheck:skills` | passes |
| `npm run test:skills` | 6 task checks: 40 checks pass on the reference solutions, 10 named checks fail on the mistakes as expected. Unchanged counts; the run is against the Stage 5а runtime |
| Task checks changed | none. `ssr-server-list` builds its store with `usePalistor` and hydrates server HTML: it passes unchanged with the store started after the commit (its list has `initialData`, so nothing was due at construction before either). No rewritten mistake is embodied by a `mistake/` directory. The new rules (`nextCursor: null`, nested `dirty` and reset, `t` in `onError`, the held first render) are reference-level and rest on the library tests cited above |
| `intent maintainer sync` | rewrote `skill_tree.yaml` only: the new source entry of `palistor-lists` and `palistor-flows` |
| `intent maintainer status` | 0 files to sync, 0 authoring issues, 5 pending review items (`palistor`, `palistor-lists`, `palistor-flows`, `palistor-ssr`, the planning records). Not recorded by this batch: the maintainer records the review |
| Sizes | `SKILL.md`: 471 / 435 / 416 / 372 / 387 lines (limit 500). Descriptions unchanged |
| Fresh consumer session, description activation | not run |
| `npm run test:cube`, `npm test`, `npm run build`, `npm pack --dry-run` | not run by this batch (no file outside `skills/` was edited) |

#### Remaining work

- Record the review: `intent maintainer review` for the four skills and the planning records
  (`palistor-field-mapping` is not listed; its outcome is "no change").
- At the release that ships Stage 5а: `intent validate --set-version <version>` and the "Targets
  palistor v…" line (`AGENTS.md`, "Releasing").
- When `ResolveErrorContext` gains `t` (0.1): replace the two strict-TypeScript forms by the plain
  destructuring in `async-resolve.md`, `list-api.md`, `entity-editing.md` and `palistor-ssr`.
- When a group gets its `reload()` / `resolveStatus` / `error` API (0.1): update `async-resolve.md`,
  `proxy-api.md` and the declared-dependency rule of `palistor-ssr`.
- A task check for a nested list (rows from `initialData`, `dirty` on the form, reset) would be the
  first executable evidence for that part of `palistor-lists`; today it rests on library tests.

### Batch 4 — 2026-11-24: one store for the whole app

- **Source revision:** branch `cube-architecture` at `69dc215`; `package.json` version
  `0.1.1-cube.1`. No runtime source changed. Tooling: `@tanstack/intent` 0.5.6, TypeScript 5.9.3.
- **Input:** the maintainer's question ("did the Cube work remove the global store? how is a global
  store made in Next.js?") and the request to add the recipe to the README and the skill. An update
  of `palistor-ssr`, with a pointer from `palistor`; no skill was added.
- **Evidence:** `cube/react/usePalistor.ts` (the store is kept in the component instance that called
  the hook), `cube/palistor.ts` (constructor: `initialData`, `hold`), and a new describe in
  `cube/ssr/usePalistor.test.tsx`, "usePalistor: one store handed down through a React context"
  (four tests: every reader below the provider has the same store and the page changing keeps it;
  the shared store starts once, after the provider's commit; each server render builds its own
  store; the provider's HTML hydrates without a mismatch). The statement that a layout stays mounted
  while its pages change is Next.js behavior, not the library's: the tests and the task check model
  it as a provider that stays mounted while its children change.

#### Decisions

| Decision | Reason |
| --- | --- |
| The recipe lives in `palistor-ssr` ("Share one store across the app"), not in a new skill | It is the per-instance rule applied once, in the layout: same hook, same `initialData`, same start. A request for "a global store in Next.js" must land where the reason (a module is shared by every request) is stated |
| The store reaches its readers through a React context the app declares; the library adds no provider for a store | The maintainer's earlier decision (`experiments/SsrPlan.md`, "Что не делаем"), kept: the app's own context is typed by the app's config. Recorded as an open question in "Remaining Gaps" |
| A new failure mode, "`usePalistor` called in every component that needs the shared store", placed right after the module-level mistake | It is the plausible wrong reading of "one store per component instance" for a shared store, and it survives a look at the page source: every copy starts from the same data |
| The description of `palistor-ssr` names the task ("one global store for a whole server-rendered app") and was shortened elsewhere to stay under 1024 characters | A request for a global store names neither server rendering nor `usePalistor`. Words removed: "has to be", "already", "on behalf of", "the constructor", "during a server render" → "on the server", "for config, store and useForm basics" → "(config, store, useForm)". No task was dropped |
| `metadata.purpose` unchanged | It describes the skill; the new section is one more case of "create one store per component instance" |
| `palistor/SKILL.md`: the Setup exception and the routing row name the app-wide store | The core skill is read first and says "create the store at module level"; without the pointer an agent asked for a global store stops there |
| The example passes `key={account?.id ?? "guest"}` to the provider | `initialData` is read once (existing rule, mistake "Expecting new props to replace the store's data"); a layout re-renders with another account without a page load on sign-in, sign-out and `router.refresh()` |
| `metadata.library_version`, the "Targets palistor v…" line and the version fields of the planning records untouched | Same rule as batch 3: the release step sets them (`AGENTS.md`, "Releasing") |

#### Guidance changed

| Where | Before | After | Evidence |
| --- | --- | --- | --- |
| `palistor-ssr/SKILL.md`, opening rule 3 | A store with request data is created per component instance | Adds: a store the whole app shares is created the same way, once, in the layout | `cube/ssr/usePalistor.test.tsx` ("usePalistor: one store handed down through a React context") |
| same file, new "Share one store across the app" | — | Provider with the only `usePalistor` call, a typed React context, `useAppStore()`, the layout with a `key`; one store per request on the server and per mounted layout in the browser; read once; starts after the provider's commit; below `<PalistorProvider>`; not importable outside React; when a module-level store stays right | the same describe; "two components with the same config get different stores"; "an options object is read once too"; "new Palistor() outside the hook is not held: in the browser its constructor starts it" |
| same file, Common Mistakes | 8 mistakes | The module-level mistake points at the new section; new HIGH mistake "`usePalistor` called in every component that needs the shared store" | "two components with the same config get different stores", "every reader below the provider has the same store: a write through one shows in the other, and the page changing keeps it" |
| same file, `description` | 996 characters | 1018 characters: the global-store task added, wording tightened | `intent validate` |
| `palistor/SKILL.md`, Setup and the routing table | The exception: a screen rendered on the server with request data | The exception: state with request data in a server-rendered app, one screen's or a store the whole app shares | same |
| `README.md`, `README.ru.md`, "SSR & Next.js" | "One store per component instance" only | New subsection "One store for the whole app" (the recipe, four consequences, a module-level vs layout-provider table) and a pointer from the `usePalistor` API section | same |
| `tests/skills/discovery.md` | 4 + 3 prompts for `palistor-ssr` | 5 + 4: a global-store request in a Next.js app loads it; a shared store in a client-only SPA does not | not run |

Verified unchanged: `palistor-lists`, `palistor-flows`, `palistor-field-mapping` and the references
of `palistor` (none states where a store is created beyond the pointer the core skill already had).

#### Check outcomes

| Check | Result |
| --- | --- |
| `npm exec --no -- intent validate skills` | 5 skill files pass |
| Strict compile of the new examples | The two `tsx` fences of "Share one store across the app" compile with `tests/skills/tsconfig.json` (`strict: true`) against the package entry. Temporary files, removed after the run |
| New task check `tests/skills/ssr-app-store` | 5 checks pass on the reference solution. The mistake (`usePalistor` in every component) fails the 2 named checks (shared edit, edit kept across a navigation) and passes the other 3: its HTML, hydration and per-request isolation are right, which is why it is easy to ship |
| Grader of `ssr-app-store` against another wrong solution (throwaway, not in the repository) | A module-level store filled during render: 2 of 5 checks fail (the edit is overwritten when the layout re-renders; a signed-out visitor's HTML shows the previous user) |
| `npm run typecheck:skills`, `npm run typecheck:cube` | pass |
| `npm run test:skills` | 7 task checks: 45 checks pass on the reference solutions, 12 named checks fail on the mistakes as expected (before the batch: 6, 40 and 10) |
| `npm run test:cube` | 87 files, 1167 tests pass (1 todo); `cube/ssr/usePalistor.test.tsx` has 44, the 4 new ones included |
| `npm pack` (tarball listed) | 15 files under `skills/palistor*/`; nothing from `skills/_artifacts`, `tests/` or `.intent/` |
| Sizes | `palistor-ssr/SKILL.md` 484 lines, `palistor/SKILL.md` 472 (limit 500). Description of `palistor-ssr`: 1018 characters (limit 1024) |
| Fresh consumer session for `ssr-app-store` | run once, passed: 5 of 5 checks on the agent's file. Setup: the candidate tarball (`npm pack` of this working tree) unpacked as `node_modules/palistor` of a scratch project outside the repository, `intent install` there (it wrote the project's `AGENTS.md`), the fixture and `task.md`; one Claude Code subagent (general-purpose, no authoring conversation) with the plain task. Observed: `intent list`, then `intent load palistor#palistor-ssr` and `palistor#palistor`; it followed "Share one store across the app" and, on its own, put the `key` inside the provider module and passed only the config's keys as `initialData`. Limits: the subagent ran on the authoring machine and was told, not forced, to stay inside the scratch project; one run is one observation, not a reliability figure; no run without the skill for comparison |
| Description activation (`tests/skills/discovery.md`) | the prompts were not run. One observation from the consumer session above: given `task.md`, the agent chose `palistor-ssr` first from the `intent list` descriptions |

#### Remaining work

- Maintainer review of the new section, of the shortened description and of the new row in
  "Remaining Gaps".
- An activation run of the `palistor-ssr` prompts (`tests/skills/discovery.md`).
- Findings of the consumer session that were not acted on: the skills carry `0.1.0-cube.1` while the
  package they ship in is `0.1.1-cube.1`, so the "Targets palistor v…" note points the agent at
  itself; the `key` is shown on the provider in the layout only, and an app that cannot rely on the
  layout has to put it inside the provider module (the agent did); plain Node cannot import the
  package ("Remaining Gaps").
- `palistor-ssr/SKILL.md` is 16 lines from the limit: the next addition should move the per-node
  `initialData` rules or the Suspense section into a reference file.
- The release leftovers of batch 3 still stand: `intent validate --set-version` and the "Targets
  palistor v…" line.

### Batch 5 — 2026-11-24: a node as a prop on every level; `useForm(field)` typed

- **Source revision:** branch `cube-architecture`, working tree on `69dc215`; `package.json` version
  `0.1.1-cube.1`. Source change of this batch: `cube/types.ts` (new type `UseForm`), `cube/index.ts`
  (`useForm` is exported with it). No run-time change. Tooling: `@tanstack/intent` 0.5.6,
  TypeScript 5.9.3.
- **Input:** the maintainer's objection to batch 4: every reader took the whole store from a React
  context (`useForm(useAppStore())`), while the architecture is "the parent hands a node down as a
  prop, the child resolves it with `useForm(props.node)`". His criteria, as stated in the session:
  the parent picks the node a component is connected to; the component does not know the store;
  re-renders stay isolated; the chain goes recursively as deep as the object. He approved a
  four-level example (order → customer → address → geo, one field component reused on three levels)
  and the field overload.
- **Evidence:** `cube/react/useForm.ts` (`resolveInput`: a node from another `useForm` carries its
  hub and its source node; a raw node throws); the contract, both implementations
  (`cube/contract/sliceA/useForm.test.tsx`: "a subtree can be passed to a child component as a
  prop", "useForm(subtree) — child components with independent subscriptions"); a new file
  `cube/react/nodeProps.test.tsx` (four levels on a `usePalistor` store: an edit re-renders the
  component of that field and no other; a section that reads a state of its own node follows that
  node's `dirty`; two instances of the tree never meet; a raw leaf is refused; type checks); in
  `cube/ssr/usePalistor.test.tsx` the describe of batch 4 now has entries that read the context and
  children that get nodes, plus one test ("the store is read from the context once per client
  subtree, the nodes go down as props"). Why a context is needed at all (a layout gets the page as
  opaque `children`; props from a Server Component are serialized) is Next.js and React behavior,
  not the library's.

#### Decisions

| Decision | Reason |
| --- | --- |
| The app-wide store recipe keeps the app's own context but narrows who reads it: the entry of each client subtree (the first Client Component below a Server Component), once. Below it nodes are props. Supersedes batch 4's "every reader takes the store from the context" | The maintainer's criteria above. Batch 4's shape worked (its tests passed) but tied each component to the app's store and to one path in it; the parent no longer picked the node. The reason for a context is only the Server Component boundary |
| `useForm` gets one more overload in Cube's types: a field (`FieldProxyNode<T>` in, the same type out). It is the last overload | The call always worked at run time and is in the contract, but had no type: the contract tests cast to `any`, a consumer typed the prop `any`. Approved by the maintainer. Last, so that an argument typed `any` keeps resolving to the store's first overload: existing consumer code compiles unchanged. First intentional difference between the `useForm` types of the two implementations; `store/` and `react/` are not edited (CubePlan rule), the contract stays typed by the store's types and the checks of the overload live in `cube/react/nodeProps.test.tsx` |
| The multi-level example is taught in the core skill ("Split rendering into child components") and in a new README section ("One component per node"); `palistor-ssr` points there | It is how components are connected with any store. The SSR recipe adds only the boundary rule |
| A node from a context instead of the store (one context per node) is not documented | Considered in the session: `useForm(useContext(NodeContext))` works, but the context, not the parent, picks the node, and a reader that skips `useForm` goes stale (its reads land in the provider's scope, the provider re-renders, the reader does not: probe on both implementations, not kept) |
| No library provider for a store, no `useForm(configNode)` | Unchanged from batch 4 (row in "Remaining Gaps"). `useForm(configNode)` was probed and rejected: a config object is not a key under a `fieldMapping`, is ambiguous when mounted twice, and cannot address a row |
| The task check `ssr-app-store` asks for the entries (`Header`, `SettingsView`) and a shared `TextField` that takes a field; a sixth check mounts `TextField` on a field of another store, outside the provider | Behavior that tells the two shapes apart: a leaf that reads the app's context fails it (verified once with a throwaway subject) |
| `palistor-ssr`: two bullets merged and three blank or comment lines removed in the rewritten section | The 500-line limit; no rule was dropped |
| `metadata.library_version`, the "Targets palistor v…" line and the version fields of the planning records untouched | Same rule as batches 3 and 4: the release step sets them (`AGENTS.md`, "Releasing") |

#### Guidance changed

| Where | Before | After | Evidence |
| --- | --- | --- | --- |
| `palistor/SKILL.md`, "Split rendering into child components" | One level: a section gets a group; fields spread into the adapter inside the section | The component tree mirrors the config: root → section → nested section → a one-field component (`FieldProxyNode<string>`, `useForm(field)`); the parent picks the node, the child imports no store, where the reads land decides who re-renders; `Source:` line | `cube/react/nodeProps.test.tsx`; `cube/contract/sliceA/useForm.test.tsx`; `cube/types.ts` (`UseForm`) |
| same file, frontmatter `sources` | — | adds `cube/types.ts` | the overload lives there |
| `palistor/references/typescript.md`, "Type component props" | A section and an adapter | Adds a one-field component and the statement that nodes are assignable level after level without a cast; the mapped-store limit; the `FieldProxyNode<T>` row of the table | type checks of `cube/react/nodeProps.test.tsx` |
| `palistor/references/proxy-api.md`, "Re-rendering" | "Give a section its own subscription by calling `useForm(subtree)`" | A group or a single field; the node is bound to its store and its place in the tree; any depth | same |
| `palistor-ssr/SKILL.md`, "Share one store across the app" | `AccountBadge` reads `useForm(useAppStore())`; "Every reader takes the store from the context" | Why a context is needed (Server Component boundary); entries `Header` and `SettingsView` read it once; `AccountBadge` (a field), `AccountSection` (a group) and `TextField` (a field) get nodes; the rule "one context read per client subtree, in its entry" and what reading the whole store everywhere costs | `cube/ssr/usePalistor.test.tsx` (the describe of batch 4, one test added); `cube/react/nodeProps.test.tsx` |
| same file, mistake "`usePalistor` called in every component that needs the shared store" | Correct: read the store from a React context | Correct: the entry of each client subtree reads the context and hands nodes down | same |
| `palistor-field-mapping/SKILL.md`, "Type adapter and subtree props" and mistake "`useForm(subtree)` in a mapped store" | Groups only | Also a mapped field: not accepted with any rename | type checks of `cube/react/nodeProps.test.tsx` ("Known gap") |
| `README.md`, `README.ru.md` | Quick start step 3 (one level); `useForm(source)` with `useForm(subtreeProp)`; the recipe of batch 4 | New "One component per node" in Concepts (the four-level example, four rules); `useForm(source)` lists a group, a field and a row; the recipe rewritten as in the skill, with a row in its comparison table; TypeScript: the one-field prop, the mapped-store limit; "Migrating to 0.1": `useForm(field)` is typed | same |

Verified unchanged: `palistor-lists` and `palistor-flows` (their rows and steps already go down as
props and are resolved with `useForm(row)` / `useForm(step)`), and the descriptions and purposes of
all five skills (no task was added, so `tests/skills/discovery.md` is unchanged by this batch).

#### Check outcomes

| Check | Result |
| --- | --- |
| `npm exec --no -- intent validate skills` | 5 skill files pass |
| Strict compile of the new examples | The `tsx` fences of both rewritten skill sections, of the new `typescript.md` example and of the README's two new examples compile with `tests/skills/tsconfig.json` (`strict: true`) against the package entry. Temporary files, removed after the run |
| Task check `tests/skills/ssr-app-store` | 6 checks pass on the reference solution; the mistake still fails its 2 named checks. A throwaway subject whose `TextField` reads the app's context (batch 4's shape) fails the sixth check and passes the other 5 |
| `npm run typecheck:cube`, `npm run typecheck:skills`, `npm run build` | pass; `dist/cube/index.d.ts` declares `useForm: UseForm` |
| `npm run test:cube` | 88 files, 1172 tests pass (1 todo): `cube/react/nodeProps.test.tsx` adds 4, `cube/ssr/usePalistor.test.tsx` 1 |
| `npm test` (store project, the contract included) | 167 files, 2234 tests pass (2 todo) |
| `npm run test:skills` | 7 task checks: 46 checks pass on the reference solutions, 12 named checks fail on the mistakes as expected |
| Sizes | `palistor/SKILL.md` 498 lines, `palistor-ssr/SKILL.md` 497 (limit 500) |
| Fresh consumer session for `ssr-app-store` | not run for this batch: the session of batch 4 graded the previous task text. Unverified |
| Description activation (`tests/skills/discovery.md`) | not run; no description changed |

#### Remaining work

- Maintainer review of the two rewritten sections and of the overload's place (Cube's types now
  differ from `react/useForm.ts` by one overload).
- A fresh consumer session for the new `ssr-app-store` task text.
- `useForm(node)` in a mapped store is still untyped, for a group and for a field ("Remaining
  Gaps"): a fix belongs to the types work of CubePlan, Phase 4.
- The `/ssr` routes of `app-demo` pass the store, not nodes ("Remaining Gaps").
- Both `palistor/SKILL.md` and `palistor-ssr/SKILL.md` are within 3 lines of the limit: the next
  addition to either moves a section into a reference file first.
- The release leftovers of batches 3 and 4 still stand: `intent validate --set-version` and the
  "Targets palistor v…" line.

### Batch 6 — 2026-11-24: list sorting (client and server class) and the filter's Apply mode

- **Source revision:** branch `cube-architecture` at `c239cd8`; `package.json` version `0.1.1-cube.2`.
  Source changes of this batch: `6e831a5` (list sorting, client class: `cube/core/sort.ts`, the `sort`
  block, `list.sort`, `useForm(sort)`), `06aa4ae` (filter `$apply: "manual"`: drafts and applied values,
  `apply()` / `revert()` / `isDraft` / `applied`, `useForm(filter)` typed) and `c239cd8` (server class:
  `ctx.sort`, `$sort` in the page key, one request per sort change, `invalidate()` inside a batch).
  Types in `store/store/types.ts` (`SortBlock`, `SortFieldConfig`, `SortProxyNode`, `SortKey`,
  `SortRequest`, `FilterBlock.$apply`, `FilterFieldConfig.apply`, `FilterProxyNode` members,
  `ListResolveContextWithSort`), exported by `cube/index.ts`. Tooling: `@tanstack/intent` 0.5.6,
  TypeScript 5.9.3.
- **Input:** `experiments/SortPlan.md` (intent and the user-facing examples: «Как это выглядит для
  пользователя», decisions 1–15, «Этап 1/2/3 → Skills», «Этап 5»), facts reported by the implementers,
  and six gaps the demo authors of `/lists` hit in the guidance. The plan and the reports were treated as
  hints; every statement was checked against `cube/**` and its tests.
- **Evidence:** `cube/core/sort.ts`, `cube/core/sort.test.ts`, `cube/core/sortServer.test.ts`,
  `cube/react/sort.react.test.tsx`, `cube/ssr/sortLocale.test.tsx`, `cube/ssr/initialDataLists.test.tsx`
  (section E), `cube/core/filter.ts`, `cube/core/filterApply.test.ts`,
  `cube/react/filterApply.react.test.tsx`, `cube/core/pagination.ts`, `cube/core/resolve.ts`,
  `cube/core/listCube.ts`, `cube/core/restore.ts`, `cube/core/persist.ts`, `cube/react/usePersist.ts`,
  `cube/contract/sliceE/filtering.test.ts`, `cube/contract/sliceG/pagination*.test.ts`; throwaway probe
  tests under `tests/skills/` (removed): `$all` without `where`, `$toParams` and the request identity,
  the persisted window under `usePersist` / `usePalistor`, `setScrollAnchor`, the `keepPreviousData`
  pager, a `Date` in a row, two requests for filter + sort in one handler, quick presses on a paginated
  server sort, and type checks (`as const` for `$apply`, `useForm(filter)`, `SortProxyNode` typing, a
  computed column's name). The HeroUI row rule: `@react-stately/collections` `CollectionBuilder` in
  `app-demo/node_modules` (`@heroui/table` 2.2.30) and `app-demo/src/app/lists/orders/OrdersView.tsx`.

#### Decisions

| Decision | Reason |
| --- | --- |
| Sorting lives in a new reference `palistor-lists/references/sorting.md`, with one short pattern ("Sort the rows") and a reading condition in `SKILL.md`; no new skill | Sorting is a sub-task of building a table with a list, like filtering and pagination; a developer looking for it starts from the list. The plan asked for exactly this layout |
| One reference for both classes: the client class first (the base case is the header click), the server class in its own section | The block, `list.sort` and the header are the same; who sorts is decided by `resolve.pagination` / `$server`. The server section replaced the placeholder written while `c239cd8` was in progress |
| The Apply mode goes into `filtering.md` as its own section, presented as the replacement of the hand-written `search` / `appliedSearch` pair | The plan's motivating consumer code (`admin-stores.ts`); the mistake that a task check can reject is the automatic-fields panel, so that is the HIGH entry and the hand-written pair a MEDIUM one |
| The six demo gaps are fixed where the guidance was wrong or silent, each against the code (`$all`, `$toParams`, persisted window, `setScrollAnchor`, `keepPreviousData`, HeroUI rows). Where the behavior looks like a library question (pager counts under `keepPreviousData`, `usePersist` costing a request, no public batch), the guidance states the behavior and "Remaining Gaps" records the question | No library code was changed (outside the batch's scope); a library gap is not presented as a feature |
| `palistor-lists`: description gains sorting (browser or API) and the Apply panel; `metadata.purpose` gains one word, "sorting" (`…filtering, sorting or paginating the list`) | Keep purpose and activation scope aligned (Intent's purpose contract). The previous purpose is otherwise preserved verbatim; the maintainer should confirm the one-word change |
| `palistor-lists` `sources` gains `cube/core/sort.ts`; `palistor-ssr` keeps its sources | `sort.ts` holds the behavior the reference describes. The SSR skill only routes to the sorting reference (`$default` order of `initialData`, `$locale`); `restore.ts` and `pagination.ts`, already its sources, carry the `initialData` side |
| `tests/skills/harness.ts` accepts optional extra mistakes (`mistakes: [{ name, load, rejects }]`) | `lists-server-list` now covers two entries of Common Mistakes (an empty-looking failed list, a client sort of a server-limited list); existing tasks are unchanged |
| `metadata.library_version`, the "Targets palistor v…" line and the version fields of the planning records untouched | Release step (`AGENTS.md`, "Releasing") |

#### Guidance changed

| Where | Before | After | Evidence |
| --- | --- | --- | --- |
| `palistor-lists/references/sorting.md` (new) | — | Header-click base case (`sort: true`, `SortHeader` with `useForm(sort)`); block grammar and construction errors; comparison defaults; the snapshot rule and `refresh()`; paging a sorted list in memory; `$locale` under SSR; HeroUI `sortDescriptor` / `onSortChange` and the `TableRow` + cell-component rule; server-side sorting (`ctx.sort`, request identity, filter interplay, `initialData`, persistence); typing; limits; 8 Common Mistakes | see Evidence above |
| `palistor-lists/references/filtering.md` | `$all` "always runs"; no Apply mode | `$all` runs only with a `where` field (`where: () => true` idiom); `$toParams` is not the request identity; members `apply` / `revert` / `isDraft` / `applied`; section "Apply with a button (manual mode)"; manual-mode constraints and reserved names; 4 Common Mistakes | `cube/core/filter.ts`, `cube/core/filterApply.test.ts`, `cube/react/filterApply.react.test.tsx`, `cube/contract/sliceE/filtering.test.ts` (E3), probes |
| `palistor-lists/references/pagination.md` | "With `usePersist` the current page is restored without a request"; `isPreviousData` row silent on the pager | `ctx.sort` in the resolver contract; the sort and `filter.apply()` in the query key; `keepPreviousData` pager values; the two conditions of a request-free restore (`await persist.enable()` before the first fetch; `usePersist` costs one request); `setScrollAnchor` needs the next change or `persist.flush()`; 1 Common Mistake | `cube/core/pagination.ts`, `cube/core/persist.ts`, `cube/contract/sliceG/pagination.test.ts` (E1), `pagination.phase2.test.ts` (J1), `cube/core/sortServer.test.ts`, probes |
| `palistor-lists/references/list-api.md` | — | `sort` key and member, `ctx.sort` in the resolver row, `items` order under a sort, `getValues()` order, `FilterProxyNode` / `SortProxyNode` / `SortKey` typing rows | `store/store/types.ts`, `cube/core/sort.test.ts` ("getById, getValues(), dirty…") |
| `palistor-lists/SKILL.md` | — | Description and purpose (above); `sort?` in the Setup sentence; pattern "Sort the rows" with a reading condition; the Apply panel in the filtering pointer; completion step 6; `list.sort!` in completion step 1; reference list | as above |
| `palistor-ssr/SKILL.md` | "The data must answer… the initial filter values, the first page, this context" | Adds the `$default` sort of a server-sorted list and `$locale` for a client-sorted one (routing to the sorting reference); the mistake "Server data that answers another request" names the `$default` sort and cites the new SSR test | `cube/ssr/initialDataLists.test.tsx` (section E), `cube/ssr/sortLocale.test.tsx` |
| `palistor/SKILL.md` | Routing row without sorting | Routing row names "sorting by a column" | — |
| `palistor/references/typescript.md` | — | `FilterProxyNode` / `SortProxyNode` (accepted by `useForm`) routed to `palistor-lists` | `cube/types.ts` (`UseForm`) |

Verified unchanged: `palistor-field-mapping` (its source `cube/core/mapping.ts` changed in `6e831a5`
only to pass a list's `sort` block through unmapped, `FieldMap.listOptions`; the skill's rules on what a
mapping renames are unaffected, and the sorting reference states that a mapping leaves the block as
written) and `palistor-flows` (none of its sources changed).

#### Check outcomes

| Check | Result |
| --- | --- |
| `npm exec --no -- intent validate skills` | 5 skill files pass |
| Strict compile of the examples | Every `ts` / `tsx` fence of `palistor-lists` (`SKILL.md` and its five references) compiles with `tests/skills/tsconfig.json` (`strict: true`) against the package entry (a typed stub for `@heroui/react`); the four `expect-error` fences fail with exactly their declared codes (TS2353, TS2741, TS2339, TS2722). Temporary files, removed after the run |
| Task check `tests/skills/lists-sortable-table` (new) | 6 checks pass on the reference solution; the mistake (page sliced, then sorted in a `useMemo`) fails its 2 named checks. Graded as a subject it fails 5 of 6, the first because page 1 holds the five rows of the server's page 1 re-ordered |
| Task check `tests/skills/lists-filter-panel` (new) | 5 checks pass on the reference solution; the mistake (automatic fields with `debounce`, Apply calls `refetch`) fails its 2 named checks (graded as a subject: a request after typing) |
| Task check `tests/skills/lists-server-list` (extended) | 7 checks pass (one new: the Name button asks the API to sort, one request per click); the original mistake still fails its check; the new mistake `mistake/members-client-sort.tsx` (a client sort, no `$server`) fails the new check |
| `npm run typecheck:skills` | pass |
| `npm run test:skills` | 9 task checks: 58 checks pass on the reference solutions, 17 named checks fail on the mistakes as expected |
| Sizes | `palistor-lists/SKILL.md` 474 lines, `palistor/SKILL.md` 498, `palistor-ssr/SKILL.md` 497 (limit 500) |
| Fresh consumer session for `lists-sortable-table` and `lists-filter-panel` | run once each on 2026-11-24, both passed: 6 of 6 and 5 of 5 checks on the agents' files. Setup as in batch 4: the candidate tarball (`npm pack` of the working tree with `c239cd8` and these skills) unpacked as `node_modules/palistor` of a scratch project outside the repository, a strict `tsconfig.json`, `intent install` there, the fixture and `task.md`; one Claude Code subagent per task (general-purpose, no authoring conversation) with the plain task. Observed in both: `intent list`, then `intent load palistor#palistor` and `palistor#palistor-lists`; the table agent read `references/sorting.md` and `list-api.md` and sliced its pages from `list.items`; the panel agent read `references/filtering.md` ("Apply with a button") and `pagination.md` and declared `$apply: "manual"`. Both type-checked with `tsc --noEmit` under `strict`. Limits: the subagents ran on the authoring machine and were told, not forced, to stay inside the scratch project; one run is one observation, not a reliability figure; no run without the skills for comparison |
| Fresh consumer session for the extended `lists-server-list` | not run. Unverified |
| Description activation (`tests/skills/discovery.md`, `palistor-lists` prompts 4–6 added) | the prompts were not run. One observation from the two consumer sessions above: given `task.md`, both agents chose `palistor-lists` from the `intent list` descriptions |

#### Remaining work

- Maintainer review of `sorting.md`, the manual-mode section, the corrected pagination statements and
  the one-word change of the `palistor-lists` purpose.
- A fresh consumer session on the extended `lists-server-list` task check, and an activation run of the new prompts.
- The library questions recorded in "Remaining Gaps" (no public batch, computed column naming, pager
  counts under `keepPreviousData`, the `usePersist` request) and tests in `cube/**` for the statements
  that rest on authoring probes.
- `palistor/SKILL.md` and `palistor-ssr/SKILL.md` are still within 3 lines of the limit; batch 6 kept
  their line counts by extending existing lines.
- The release leftovers of batches 3–5 still stand: `intent validate --set-version` and the "Targets
  palistor v…" line.

### Batch 7 — 2026-11-24: release audit of `0.1.1-cube.3`

The maintainer asked, before publishing `0.1.1-cube.3`, to check that the skills match the implemented
SortPlan. Two auditors without the authoring conversation read the batch 6 guidance (`sorting.md`, the
manual-mode section of `filtering.md`, the corrected `pagination.md` / `list-api.md` statements and the
matching `SKILL.md` passages) against `cube/**`, with probes. Every finding below was re-checked in the
code before an edit, the `queryKey` one also by a probe of its own. Source revision: `7572329`.
Planning records: `domain_map.yaml` gains the header line and three `gaps`; this file gains the three
"Remaining Gaps" rows, the resolved version row and this section; `skill_tree.yaml` is unchanged (no
skill, reference or source added or moved).

#### Guidance changed

| Where | Before | After | Evidence |
| --- | --- | --- | --- |
| `filtering.md`, manual mode | `set` / `reset` / `clear` "write drafts only"; "Clear all" = `clear()` + `apply()`, one request | Manual fields take drafts; an `apply: "auto"` field changes at once and requests. "Clear all" next to a non-empty automatic field is two requests; one-request form `set({ manual fields })` + `apply()` | `cube/core/filter.ts` (`setFields`, `issue`, `apply`); probe |
| `filtering.md` and `sorting.md`, limits | "The legacy implementation behind `palistor/store/*` rejects `$apply`" / "has no sort" | Removed: every published entry runs Cube (`./store/store` re-exports `Palistor` from `cube/index.ts`) | `package.json` `exports`, `cube/exports/store/store.ts` |
| `filtering.md`, typing | Annotate `where`, `$all`, `$toParams`, derived `value` | Annotate `where` and derived `value`; `$all` / `$toParams` are typed, and a narrower filter-values interface fails with TS2322 | `store/store/types.ts` (`FilterBlock`); type check |
| `filtering.md`, members and rules | `set()` "one request"; `apply()` always re-keys a paginated list; `initialData`: nothing until an `apply()` that changes a value; `isDraft` "by content"; `FilterProxyNode` "like a field" | `set()` requests only for an automatic server field; an `apply()` that moved only `where` fields re-filters without a request, and a no-op `apply()` leaves a pending debounce running; with `initialData` an automatic field's change also requests; `isDraft` compares JSON text (key order counts); the panel's fields are `any` | `cube/core/filter.ts`, `cube/core/config.ts` (`isDirtyValue`), `store/store/types.ts`; probes |
| `pagination.md` | `keepPreviousData`: `hasNextPage` / `hasPrevPage` `false`, `page` the first page; restore condition names values, context and sort; `flush()` unconditional; `queryKey` without a caveat | `page` = `initialPage`, `hasNextPage` `true` in `infinite`, `hasPrevPage` `true` when `initialPage` > `base`; the applied filter joins the restore condition (it is not persisted); a stale restored window is refetched after paint; `flush()` writes nothing while a page fetch is in flight; `queryKey` drops filter and sort from the key | `cube/core/pagination.ts` (`ensureFamily`, `hasNextPage`, `hasPrevPage`, `seed`, `computeKey`), `cube/core/persist.ts` (`save`, `fetchingPage`); probes |
| `sorting.md` | `dirOf` throws on an unknown key; "a row re-renders for its own values only"; dotted keys for groups, `"address.city": true` in a `SortBlock<Customer>`; comparison rules for every column; a cached sort shown regardless of `staleTime`; resolver `ctx` "typed from `TEntity`"; `list.sort.refresh()` | `dirOf` returns `null`; rows re-render with the table unless wrapped in `React.memo`; a typed template cannot declare a group, so a dotted key uses `{ by }` (example changed); `{ compare }` decides empties itself; cached and within `staleTime`; `ctx.sort` always present; `list.sort!.refresh()`; `queryKey` caveat in the server section | `cube/core/sort.ts` (`dirOf`, `parse`, `comparator`), `cube/react/sort.react.test.tsx` (the `memo` row), `cube/core/pagination.ts` (`retrigger`, `isFresh`, `computeKey`); probes and type checks |
| `palistor-lists/SKILL.md` | Every filter callback needs annotations; "any other field … re-fetches when it changes"; "one request for the first page"; "nested groups" | The same corrections in short form | as above |

Verified unchanged by the audit: the rest of `sorting.md` (toggle cycle, construction errors, comparison
defaults, snapshot moments, server request rules, SSR `$locale`, typing exports), the rest of the
manual-mode section (draft vs applied reads, `revert()`, automatic-mode no-ops, spread, construction
errors, `as const`), and `list-api.md`. Not changed on purpose: resolver callbacks such as
`resolver: async (values, store, ctx) =>` stay unannotated in examples. `ListResolver<TEntity>` types
them from context, and the strict compile below reports no TS7006 for them; the `AGENTS.md` rule is about
callbacks without a contextual type.

#### Check outcomes

| Check | Result |
| --- | --- |
| CI `test` job in a clean worktree outside `palirent` at `7572329` | `build`, `intent validate`, `typecheck:skills`, `typecheck:cube` pass; `test:skills` 58 pass + 17 expected fail; `test:cube` 1290; `npm test` 2234 |
| Strict compile of every `ts` / `tsx` fence of the five skills | 74 fences, compiled with Intent's options and with `strict: true` against the built package (HeroUI types from `app-demo`); no strict-only diagnostic, before and after the edits |
| `intent validate` | 5 skill files pass |
| `npm pack --dry-run` | 648 files: `dist`, the READMEs, `skills/palistor*/**`; nothing from `skills/_artifacts`, `tests/` or `.intent/`; the repo `dist` equals a clean build file for file |
| Task checks | unchanged: no recommended pattern changed, the corrections narrow statements |
| Fresh consumer session | not run for this batch |

#### Remaining work

- The three new rows in "Remaining Gaps": `queryKey` drops filter and sort; groups in a typed template;
  "Clear all" next to an automatic field.
- Statements resting on release-audit probes, not on named tests, join the batch 6 row of that kind.
