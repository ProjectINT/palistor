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

## Skill Inventory

| Skill | Type | Domain | What it covers | Failure modes |
| --- | --- | --- | --- | --- |
| `palistor` | core | forms | Mental model (config → store → `useForm` → spread), fields and groups, validation, visibility, computed values, submit / reset, group resolve, persist, i18n, notifications, store context, typing, routing to the other skills | 14 |
| `palistor-lists` | sub-skill | lists | `defineList`, list and row proxies, list resolve (loading / error / reload), add / remove / temporary ids / rekey, editing a row through a separate template, filtering, pagination | 28 |
| `palistor-flows` | sub-skill | flows | `defineFlow` / `defineStep`, navigation, branching through step `isVisible`, per-step and final validation, step lifecycle, persisted navigation, typing | 13 |
| `palistor-field-mapping` | sub-skill | ui-integration | The field spread, one adapter per input kind, `fieldMapping` / `defineFieldMapping`, single vocabulary, typing mapped props, limits of renaming | 11 |

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
| 14 | Waiting for a resolve that nothing reads | MEDIUM | cube/core/cube.ts (touch), cube/core/node.ts | `references/async-resolve.md` |

### palistor-lists (28 failure modes)

| # | Mistake | Priority | Source | Documented in |
| --- | --- | --- | --- | --- |
| 1 | Treating a failed or not-yet-started list as empty | HIGH | cube/contract/sliceC/listResolveError.test.ts, cube/core/resolve.ts (touch) | `SKILL.md` |
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
| 22 | Ignoring ctx.page | HIGH | cube/contract/sliceG/pagination.test.ts (A1, B1) | `references/pagination.md` |
| 23 | Replacing the rows with a spinner on list.loading | HIGH | cube/contract/sliceG/pagination.test.ts (A3), cube/core/listCube.ts (loading) | `references/pagination.md` |
| 24 | Calling an optional pagination method directly | MEDIUM | store/store/types.ts (ListProxyNode) | `references/pagination.md` |
| 25 | Jumping to a page that does not exist | MEDIUM | cube/core/pagination.ts (setPage) | `references/pagination.md` |
| 26 | Using total to decide whether more rows exist | MEDIUM | cube/contract/sliceG/pagination.test.ts (A2, D7), cube/core/pagination.ts (hasNextPage) | `references/pagination.md` |
| 27 | Reading the list's own rows inside its resolver | MEDIUM | cube/contract/sliceG/pagination.test.ts (F7) | `references/pagination.md` |
| 28 | Mapping a field prop onto a pagination name | MEDIUM | cube/contract/sliceG/pagination.test.ts (F1) | `references/pagination.md` |

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

## Tensions

| Tension | Skills | Agent implication |
| --- | --- | --- |
| Hide a field vs keep the form submittable | `palistor` ↔ `palistor-flows` | `isVisible` hides a field but submit still validates it; only a hidden flow step is exempt. An agent that only hides a required field ships a form that cannot be submitted |
| Inferred config vs typed callbacks | all four | The config must stay an inferred literal for precise proxy types, so nothing types callback parameters. Un-annotated callbacks pass `intent validate` (`strict: false`) and fail the consumer build (TS7006) |
| One vocabulary under a field mapping | `palistor` ↔ `palistor-field-mapping` | Core examples use `isRequired`; with a `fieldMapping` the same config must use the mapped name, or the store throws at module load |
| Form field rules vs row field rules | `palistor` ↔ `palistor-lists` | A form field validates `isRequired` and hides errors until submit; a row field ignores `isRequired` and validates live |

## Cross-References

| From | To | Reason |
| --- | --- | --- |
| `palistor` | `palistor-lists` | Collections, `store.set / rekey / delete / invalidate`, the two-argument `useForm` |
| `palistor` | `palistor-flows` | Multi-step screens; the only exemption from submit validation is a hidden step |
| `palistor` | `palistor-field-mapping` | The core skill shows one native adapter; UI-kit adapters and renaming live there |
| `palistor-lists`, `palistor-flows`, `palistor-field-mapping` | `palistor` | All three assume config, store, `useForm`, group resolve options, `usePersist` and the annotation rule |
| `palistor-field-mapping` | `palistor-lists` | A mapping renames `dirty` / `loading` on lists and rows, never list methods or pagination members |

## Reference Files

| Skill | References | Why they are separate |
| --- | --- | --- |
| `palistor` | `config-options`, `proxy-api`, `async-resolve`, `integrations`, `typescript` | Dense surfaces and conditional tasks (loading data, drafts, i18n, typing) that the common path does not need |
| `palistor-lists` | `list-api`, `entity-editing`, `filtering`, `pagination` | Each is an independent sub-task with its own vocabulary and mistakes |
| `palistor-flows` | `flow-api` | Full member tables, exported types, lifecycle and reset rules |
| `palistor-field-mapping` | — | Fits in one file |

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
| `palistor-lists` | A paginated list logs `pagination invariant: window ordinal 1 … has no cached page` on every query-key change (looks like a runtime defect; the skill does not mention it) | open |
| `palistor-lists` | Not probed at runtime, documented from README, types and contract-test titles: persistence round-trip, `scrollAnchor`, `keepPreviousData`, `maxPages`, `gcTime`, `revalidateOnHydrate`, list Suspense, nested-list pagination | open |
| all | Typing gaps documented as workarounds instead of being fixed (library sources were out of scope): un-annotated config callbacks (TS7006), `FormConfig` cannot describe nested groups, `defineStep` narrows inline defaults to literals, `useForm(subtree)` rejected in a mapped store, pagination and filter members optional, raw-array lists untyped, a typed template rejects `onSubmit` / template `resolve`, `store.set` rejects interface-typed objects, `PalistorRef` has no `id`, two-argument `useForm` returns `any` | open |

## Recommended Skill File Structure

- **Core skill:** `palistor` (the entry point; every other skill requires it).
- **Sub-skills:** `palistor-lists`, `palistor-flows`, `palistor-field-mapping` — each a task worth discovering on its own.
- **Framework skills:** none; the library is React-only.
- **Composition skills:** none yet. A UI-kit composition (MUI, Ant Design) would be the first candidate; today `palistor-field-mapping` covers it generically.
- **Layout:** flat, `skills/<name>/SKILL.md` at the repository root, names prefixed `palistor-` so they do not collide after third-party installers copy them into `.claude/skills/`.

## Coverage and batch history

### Assessed scope

The whole public entry (`index.ts`): `Palistor`, `useForm`, `usePersist`, `useTranslator`,
`useNotifier`, `useStoreContext`, `defineList`, `defineFlow`, `defineStep`, `defineFieldMapping`, the
storage drivers and the exported types. Not assessed: the subpath exports (`palistor/store/store`,
`palistor/react/*`, `palistor/cube`) and the modular entries planned in `experiments/ModulesPlan.md`.

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
