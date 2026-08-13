# Palistor — Architecture

## System layers

```
┌─────────────────────────────────────────────────────────┐
│                     React component                      │
│  const form = useForm(store)                            │
│  <input value={form.email.value} />                     │
└────────────────────┬────────────────────────────────────┘
                     │ GET / SET
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Tracking Proxy  (Layer 2)                   │
│  createTrackingProxy.ts                                  │
│  • GET FIELD_STATE_PROP → records the config node       │
│    into refs.accessed (the component's tracked set)     │
│  • GET items/map/length/dirty (ListProxy)               │
│    → records the listNode into refs.accessed            │
│  • GET of a child node → recursive tracking proxy       │
│  • SET → passes through to the Store Proxy              │
└────────────────────┬────────────────────────────────────┘
                     │ GET / SET
                     ▼
┌─────────────────────────────────────────────────────────┐
│               Store Proxy  (Layer 1)                     │
│  buildProxy.ts                                          │
│  • GET FIELD_STATE_PROP → reads from nodeState          │
│  • GET CONFIG_NODE → returns the config node itself     │
│  • GET "values" on a group → groupSlot.get(node)        │
│    (a live reference into the nested valuesCache object)│
│  • GET of a child key → recursive store proxy           │
│  • GET on a group with resolve (idle) → triggerResolve  │
│  • GET on a group with resolve (pending + suspense)     │
│    → throw promise (React Suspense)                     │
│  • SET "value" → runs the Write Pipeline                │
│  • OWNKEYS / DESC → computeProxyKeys → hides internal   │
│    config keys from spread / Object.keys()              │
└────────────────────┬────────────────────────────────────┘
                     │
           ┌─────────┼──────────┐
           ▼         │          ▼
┌──────────────────┐ │ ┌────────────────────────────────────┐
│  Config (static) │ │ │  nodeState: WeakMap<node,FieldState>│
│  Immutable tree  │ │ │  { value, isVisible, isInvalid,    │
│  of nodes        │ │ │    loading, …}                     │
└──────────────────┘ │ └────────────────────────────────────┘
                     ▼
          ┌──────────────────────────────────┐
          │  resolveStates: Map<node, state> │
          │  { status, promise, error,       │
          │    dependencies, attempt }       │
          └──────────────────────────────────┘
```

---

## Palistor — the kernel class

`Palistor` is the single entry point. It implements `ProxyStore` (the public API)
and simultaneously serves as the DI container for all internal subsystems.

```
Palistor<TConfig>  (implements ProxyStore)
  │
  ├─ @internal nodes         NodeRegistry   — nodeState, nodePaths, nodeParents,
  │                                           leafNodes, groupLeafMap, proxyCache
  ├─ @internal services      ServiceRegistry — translator, notifier, delegates
  ├─ @internal dirty         DirtyTracker   — initialValueMap(getter), capture, merge, collectSnapshot
  ├─ @internal values        ValuesCache    — the mutable values snapshot
  ├─ @internal groupDepsMap  GroupDepsMap   — deps, trackingWrap, isBuilt
  ├─ @internal hub           NotificationHub — versions, subscriptions, postNotifyHook
  ├─ @internal resolveManager ResolveManager — trigger, retrigger, eager launch
  ├─ @internal entityRegistry  EntityRegistry — the normalized entity registry + resolved cache
  ├─ @internal entityProjectionObjs  Map<string, Record<string, unknown>> — POJO mirrors for valuesCache
  │
  ├─ @internal writePipeline    WritePipeline(kernel)
  ├─ @internal resetPipeline    ResetPipeline(kernel)
  ├─ @internal submitPipeline   SubmitPipeline(kernel)
  ├─ @internal onChangePipeline OnChangePipeline(kernel)
  ├─ @internal proxyBuilder     ProxyBuilder(kernel)
  │
  └─ persist               PersistManager  — public (ProxyStore); created at init, activated via enable() from usePersist
```

All pipelines take the `kernel` (Palistor) in their constructor and read the
subsystems they need from it directly — no sprawling deps arguments.

> **Note:** `set()` and `delete()` are part of the `ProxyStore` interface (typed).
> `rekey()` and `invalidate()` are public Palistor methods outside the `ProxyStore` interface;
> see the "store.set / store.delete / store.rekey / store.invalidate" section.

### Constructor sequence

```
new Palistor(options):
  1. ServiceRegistry               translate/notify delegates
  2. NodeRegistry                  config parsing, leaf registration + ListState
  3. DirtyTracker + buildValuesCache
  4. EntityRegistry + registerList(ls) for all listStates
  5. GroupDepsMap + first recompute()   builds the groupDeps map via trackingWrap
     dirty.capture(rootConfig)          baseline snapshot after init
  6. NotificationHub               { leafNodes, nodePaths }
  7. ResolveManager
  8. Pipeline classes              Write, Reset, Submit, onChange, ProxyBuilder
     proxyBuilder.build(rootConfig)   → this._proxy
  9. PersistManager
 10. hub.setPostNotifyHook(resolveManager.createPostNotifyHook())
 11. resolveManager.launchEager()  launches eager (lazy: false) resolvers
```

### Palistor's @internal methods

| Method | Description |
|---|---|
| `recompute(changedNodes?)` | Two modes: with `changedNodes` → targeted; without → full |
| `notifyChanged(changed)` | Calls `hub.notifyChanged` with the DirtyDeps |
| `setValuesNode(node, patch)` | `formatPatch(writePipeline/formatPatch.ts) → applyPatch → recomputeAndNotify`. `formatPatch` recursively applies formatters to the patch before the write. |
| `triggerEntityTemplateResolve(entityId, templateNode, entityProxy)` | Runs resolve for an entity-template binding (called from `useForm` on mount). Loading flag + resolver + markResolved. |
| `executeEntityTemplateSubmit(entityId, templateNode, entityProxy)` | Submits an entity through a template: validate → onSubmit → afterSubmit |
| `_setEntitiesRaw(items)` | Upserts entities without recompute/notify (returns changedNodes) |
| `_syncListValuesCache(listNode)` | Rebuilds the valuesCache array from `listState.itemIds → entityProjectionObjs` |

---

## Write Pipeline

```
form.email.value = "X"   (SET trap in buildProxy)
  │
  ├─── WritePipeline.execute(node, rawValue, prev?, opts?) → WriteResult { changed, skipped? }
  │      │
  │      │  opts.via present → entity mode:
  │      │    view = kernel.nodes.getView(node, opts.via)
  │      │    allValues = view.parent.getValues()   ← entity values (a lazy snapshot)
  │      │  opts.via absent → config mode:
  │      │    view = identity (storage = rules = node)
  │      │    allValues = valuesCache.values
  │      │
  │      ├─ 1.   formatValue(raw, view.rules, allValues)   the formatter from the template (entity) / node (config)
  │      ├─ 1.5  skip?                Object.is(formatted, current) → { changed: empty, skipped: true }
  │      ├─ 2.   storeValue(view.storage, …)   nodeState + updateValuesCacheEntry O(1)
  │      │         entity sync: view.storage.value = processed (for walkAndSyncEntityNode)
  │      ├─ 2.5  setter branch:
  │      │         config mode → runSetter(node, …) → applyPatch() on the config siblings
  │      │         entity mode → _applyEntitySetterPatch() → storeValue() on the entity siblings
  │      ├─ 3.   recompute(changedNodes)  targeted group recompute
  │      └─ 4.   mergeChanged(view.storage, patchedNodes, recomputedNodes)
  │
  ├─ 5. notifyChanged(result.changed)    ← SET trap / onValueChange, after the WritePipeline
  │      ├─ recomputeDirtyTargeted
  │      ├─ nodeVersions[node]++ for the changed nodes
  │      ├─ globalListeners → useSyncExternalStore → getSnapshot()
  │      └─ postNotifyHook → findResolvesToRetrigger → resetResolveState → triggerResolve
  └─ 6. onChangePipeline.fire(…, opts?)  ← fire-and-forget onChange (entity mode forwards opts)
```

---

## Submit Pipeline

```
form.submit()                (SubmitPipeline.execute(node, entityOpts?))
  │
  ├─ view = kernel.nodes.getView(node, entityOpts?.via)
  │          ↑ config mode: identity view (storage = rules = node)
  │          ↑ entity mode: the view from nodeViews[(storage, templateField)]
  │
  ├─ 1. submitting = true (view.storage), setGroupRevalidate(true) → recompute → notifyChanged
  │
  ├─ Leaf path:
  │    ├─ 2. value = nodeState.get(view.storage)?.value
  │    ├─ 3. view.rules.beforeSubmit(value, view.parent.getValues())
  │    ├─ 5. validate:
  │    │      entity mode → computeFieldState(view.rules, value, entityValues, revalidate=true)
  │    │      config mode → leafState.isInvalid/errorMessage
  │    ├─ 6. view.rules.onSubmit(value, store, view.parent.proxy) → result
  │    └─ 7. view.rules.afterSubmit(result, { reset: view.onReset })
  │
  ├─ Group path:
  │    ├─ 2. groupValue from nodeState/groupSlot → structuredClone
  │    ├─ 3. applyLeafBeforeSubmit()    leaf-level beforeSubmit transforms
  │    ├─ 4. view.rules.beforeSubmit(values) → the group-level transform
  │    ├─ 5. collectLeafStates() → any errors? → { success: false, errors }
  │    ├─ 6. view.rules.onSubmit(values, store, view.parent.proxy) → result
  │    ├─ 7. view.rules.afterSubmit(result, { reset })
  │    └─ 8. persist.clear()
  │
  └─ finally: submitting = false (view.storage) → recompute → notifyChanged
```

**EntityLeafSubmitOptions:** `{ via: AnyConfigNode }` — passed from the entity leaf proxy (`submit()`).
The `view` supplies parentProxy, parentValues and onReset automatically through `getView(node, via)`.

---

## Reset Pipeline

```
form.reset(values?)          (ResetPipeline.execute(groupNode, values?))
  │
  ├─ 1. buildResetPatch(groupNode, initialValueMap, values?)
  │        ├─ explicit values → used directly as the patch
  │        └─ otherwise → collectInitialSnapshot (or collectDefaults as a fallback)
  │                   → then, if groupNode.reset() is set → transform the base through it
  │
  ├─ 2. applyPatch(groupNode, patch) → changedNodes
  │
  ├─ 3. if values were passed explicitly:
  │        captureInitialValues(groupNode) — a new baseline (dirty = false)
  │
  ├─ 4. setGroupRevalidate(groupNode, false) → clear the validation mode
  │
  └─ 5. recomputeAndNotify(changedNodes)
```

---

## onChange Pipeline

```
The WritePipeline returns its result → the SET trap calls OnChangePipeline.fire(node, newValue, prev, opts?):
  │
  ├─ Config mode (opts.via = undefined):
  │    ├─ findOnChangeAncestors(node, nodeParents)
  │    │    walks nodeParents upwards — collects nodes with onChange === Function
  │    └─ for each ancestor:
  │         ├─ fieldKey = computeFieldKey(nodePath, ancestorPath)
  │         │    the changed field's path relative to the ancestor (e.g. "address.city")
  │         └─ Promise.resolve(ancestor.onChange({ fieldKey, newValue, previousValue, allValues }))
  │              .then(patch) → applyPatch(ancestor, patch) + recomputeAndNotify
  │              .catch()     → errors are swallowed (fire-and-forget)
  │
  └─ Entity mode (opts.via = templateField):
       ├─ view = kernel.nodes.getView(storage, via)
       ├─ findOnChangeAncestors(view.rules, nodeParents)  ← walks the template tree
       │    nodePath = nodePaths.get(view.rules)
       │    allValues = view.parent.getValues()           ← a lazy entity-values snapshot
       └─ for each template ancestor:
            Promise.resolve(target.onChange({ fieldKey, newValue, previousValue, allValues }))
              .then(patch) → _applyEntityOnChangeResult: the patch applies to the entity siblings
                              (storeValue on entityParent[key]) + recomputeAndNotify
```

---

## Resolve Pipeline

```
GET form.car → the node is idle → triggerResolve()
  ├─ optimisticResolver → applyPatch, loading: true, notifyChanged
  └─ resolver(trackingProxy)         ← createValuesTrackingProxy (resolvePipeline/, ≠ the React tracking proxy)
                                        auto-deps: reads → accessedPaths, writes → the pendingWrites buffer
       ├─ OK  → batch flush: applyPatch(result) + buffered writes, loading: false,
       │        status: resolved, save auto-deps, mergeInitialValues (dirty baseline),
       │        recompute, notifyChanged (once)
       ├─ ERR → retry up to `attempts` times (delay ms) → when exhausted:
       │        onError(err, { notify }), loading: false, status: error
       └─ always: recompute + notifyChanged

Deps: explicit (config) ∪ auto-deps (from the resolver's tracking proxy)
On a dep change: notifyChanged → findResolvesToRetrigger → resetResolveState → triggerResolve

Suspense: status === "pending" → throw promise → React <Suspense> catches it
Errors: NEVER thrown — surfaced only reactively via form.car.isInvalid
```

### List resolve (executeListResolve)

Differs from a group resolve — a ListNode's resolver returns `Array<EntityData>`, not a patch:

- No trackingProxy: the resolver gets a plain values snapshot
- No optimisticResolver, no retry
- The result → `setEntitiesRaw(items)` — entity upserts, leaf-node registration
- `listState.itemIds` is filled from each result item's `.id`
- `listState.initialItemIds = [...itemIds]` → dirty = false right after resolve
- `listState.version++` → React notices the change
- `syncListValuesCache(listNode)` → the valuesCache syncs up

#### Public projection of the resolve state

`ResolveState.error` / `.status` have a public projection on the list proxy — `list.error`,
`list.resolveStatus`, plus `list.reload()` which re-triggers the resolver. No new state is stored:
all three read the single `ResolveState` returned by `ResolveManager.getListResolveState(listState)`,
which serves root (`this.states`) and per-entity (`this.entityStates`) lists alike.

- Reactivity: the tracking key is the `ListState` object (the same one `loading`/`dirty` use), so a
  resolve that flips the status bumps the version a component reading `error` subscribed to.
- `reload()` ⇒ `triggerListResolve(listState, force = true)`: the forced path bypasses the
  `resolved` dedup of `triggerEntityListResolve`, never the `pending` one.
- `error`, `resolveStatus` and `reload` are **not** in `MAPPABLE_KEYS` and are matched against the raw
  key before `externalToInternal` — see `LIST_ONLY_KEYS` in `store/constants.ts`.
- Groups/flows keep this state internal for now (`GROUP_SPREAD_KEYS` exposes `loading` only, sourced
  from `nodeState`, not from the resolve state).

---

## Tracking — granular re-renders

```
Render: read form.email.value, form.phone.value → accessed = {emailNode, phoneNode}

SET form.city.value → cityNode++ → getSnapshot checks only accessed → unchanged → no re-render ✓
SET form.email.value → emailNode++ → getSnapshot → changed → re-render ✓
```

`useForm(subtree)` in a child component creates **its own** tracking proxy — an independent re-render.
The `hasNavigated` flag: a Parent that navigates `form.passport` but never reads FIELD_STATE_PROPS
doesn't re-render when fields inside passport change.

---

## Modules

```
store/
  constants.ts              CONFIG_NODE / SOURCE_PROXY / STORE_REF / ENTITY_ID symbols
                            FIELD_STATE_PROPS (12): value, label, placeholder, description,
                              isRequired, isReadOnly, isDisabled, isVisible, isInvalid,
                              errorMessage, dirty, loading
                            SPREADABLE_FIELD_STATE_PROPS (11): FIELD_STATE_PROPS − {dirty, loading} + {onValueChange}
                            CONFIG_PROPS: a superset of FIELD_STATE_PROPS + validate, formatter,
                              setter, componentProps, types, dependencies, onSubmit, beforeSubmit,
                              afterSubmit, reset, onChange, resolve, deps
                            GROUP_SPREAD_KEYS (6): submitting, dirty, revalidate, loading, submit, reset
                            LIST_SPREAD_KEYS (13): items, length, loading, dirty, error,
                              resolveStatus, add, remove, getById, setItems, map, getValues, reload
                            LIST_ONLY_KEYS (3): error, resolveStatus, reload — list-scoped, NOT
                              mappable, matched before the externalToInternal translation
  traversal/
    nodeClassifier.ts       Layer 1: isLeaf, isGroup, isListNode, configKeys
    walkFull.ts             Layer 2: walkFull + the TreeVisitor interface
    index.ts                traversal utilities re-export
  applyPatch/
    applyPatch.ts           applies patches to the nodeState tree + valuesCache
  buildProxy/
    buildProxy.ts                  Proxy layer 1: ProxyBuilder (class)
    buildEntityProjectionProxy.ts  EntityProjectionProxy + leaf proxy (an entity through a template)
    buildListProxy.ts              ListProxyNode: items, add, remove, setItems, map, ...
    computeProxyKeys.ts            ownKeys for spread: SPREADABLE_FIELD_STATE_PROPS + componentProps for a leaf,
                                   LIST_SPREAD_KEYS for a list, GROUP_SPREAD_KEYS for a group
    handleLazyResolve.ts           idle → queueMicrotask(triggerResolve) (render-safe);
                                   pending + suspense=true → throw promise → React Suspense
    initProxyCaches.ts             WeakMap caches (onValueChange, submit, reset, setValues)
  compute/
    computeFieldState.ts    computes a single node's FieldState
    fieldStateChanged.ts    compares two FieldStates (for skip-notify)
    isEmpty.ts              value emptiness check utility
    resolveFlag.ts          flag resolution (bool | fn → bool)
    resolveString.ts        string resolution (string | fn → string) + translate
    types.ts                FieldState + helper types
    recompute/
      collectGroupLeafNodes.ts  collects all leaves of a group subtree (recursively: own + child groups via groupLeafMap)
      recomputeAndNotify.ts     helper: recompute → merge → notifyChanged
      recomputeLeaves.ts        recomputes a leaf list (computed + fieldState)
      recomputeTargeted.ts      targeted recompute over groupDeps (BFS)
      topologicalSortComputed.ts  Kahn's algorithm for computed nodes
      types.ts                  TrackingWrap + RecomputeTargetedDeps
  dirtyTracking/
    captureInitialValues.ts    initial-values snapshot for the dirty baseline
    collectInitialSnapshot.ts  a nested initial-values snapshot for reset (recursive; boundary — child groups with reset())
    isDirtyValue.ts            compares value with initial (primitives: ===, objects: JSON.stringify)
    mergeInitialValues.ts      baseline update after resolve
    recomputeDirtyTargeted.ts  recomputes the dirty flag for changed nodes + propagation to ancestors
    setGroupRevalidate.ts      sets revalidate=true/false on a group (submit/reset)
  groupDeps/
    createGroupDeps.ts        the initial group self-dependency map
    createTrackingValues.ts   a proxy intercepting cross-group READ accesses
    getNodeGroupPath.ts       the group path of an arbitrary node
    getRecipientGroups.ts     a group's recipients from groupDeps
    pairKey.ts                donor→recipient pair serialization
    resolveGroupByPath.ts     a group config node by string path
  init/
    createNotificationHub.ts  the NotificationHub class: versioning + subscriptions + dirty
                              Constructor: { leafNodes: LeafEntry[], nodePaths: WeakMap }
    createResolveManager.ts   the ResolveManager class: trigger, retrigger, eager launch
    initGroupSubmitting.ts    submitting/dirty/revalidate for group nodes
  onChangePipeline/
    computeFieldKey.ts        the fieldKey computation for onChange
    findOnChangeAncestors.ts  finds ancestors with an onChange handler
    onChangePipeline.ts       the OnChangePipeline class
  persist/
    drivers.ts                localStorage / sessionStorage drivers
    persistManager.ts         the PersistManager class: enable, disable, hydrate, flush, clear, isEnabled
    types.ts                  PersistDriver (getItem / setItem / removeItem) +
                              PersistOptions (key, driver, serialize?, deserialize?, debounce?, pick?, omit?)
  resetPipeline/
    buildResetPatch.ts        builds the reset patch from defaults + overrides
    collectDefaults.ts        collects the tree's default values
    resetPipeline.ts          the ResetPipeline class
  resolvePipeline/
    applyPendingWrites.ts         flushes the write buffer after resolve
    createValuesTrackingProxy.ts  the resolver's tracking write-proxy (auto-deps)
    executeListResolve.ts         resolve for a ListNode: resolver → Array<EntityData> → entity upserts → itemIds; ListResolveDeps
    executeResolve.ts             the core group logic: init → optimistic → trackingProxy → async → retry
    findResolvesToRetrigger.ts    finds resolve nodes depending on changedPaths
    initResolveStates.ts          a recursive config walk: nodes with resolve → ResolveState (idle);
                                  handles groups and ListNodes (listConfig.resolve)
    resetResolveState.ts          resets a resolve node's status to idle
    types.ts                      Resolve, ResolveDeps, ResolveState, ResolveStatus, ResolveErrorContext
  entityRegistry/
    entityRegistry.ts   the EntityRegistry class: upsert, get, delete, bind/unbind,
                        markResolved/isResolved/clearResolved, rekey, registerList
    generateId.ts       temporary ID generation (`_tmp_<ts_base36>_<rand8>_<seq>`)
    index.ts            re-exports
    types.ts            EntityNode, EntityLeafNode, EntityGroupNode, EntityData
  store/
    NodeRegistry/
      nodeRegistry.ts   the NodeRegistry class: nodeState, nodePaths, nodeParents, proxyCache,
                        listStates, allListStates, nodeViews, getView(storage, via?), setKernel()
                        registerDynamicLeaf(), unregisterLeaf(), findByPath(), getGroupPath()
      nodeView.ts       the NodeView interface { storage, rules, parent.{proxy,getValues}, onReset }
                        + makeIdentityView(node, kernel) — the identity view for config mode
                        + NodeViewKernel — the minimal kernel interface (avoids circular imports)
      index.ts          NodeView, NodeRegistry re-export
      nodeUtils.ts      isLeaf (re-export from traversal), isGroup, isListNode (length 1-2)
    dirtyTracker.ts           the DirtyTracker class: initialValueMap(getter), capture, merge, collectSnapshot
    groupDepsMap.ts           the GroupDepsMap class: deps (Set<string>), isBuilt, getTrackingWrap(), markBuilt()
    hasComputedProps.ts       checks whether a group has computed props
    index.ts                  Palistor + public type re-exports
    nodeMap.ts                buildNodeMaps: nodePaths + nodeParents
    palistor.ts               the Palistor class: kernel + ProxyStore (the system's main class)
    registerNodes.ts          leafNodes + nodeState initialization (ListNode guard → ListState)
    serviceRegistry.ts        the ServiceRegistry class: translator, notifier, delegates
    types.ts                  ConfigNode, ProxyStore, ListState, ListConfig etc.
  submitPipeline/
    applyLeafBeforeSubmit.ts  leaf-level beforeSubmit over the snapshot
    collectLeafStates.ts      leaf state collection (for error checking)
    submitPipeline.ts         the SubmitPipeline class; EntityLeafSubmitOptions { via: AnyConfigNode }
    types.ts                  SubmitResult: `{ success: true; result? }` | `{ success: false; errors: {path, message}[] }`
  valuesCache/
    valuesCache.ts            buildValuesCache + updateValuesCacheEntry (O(1))
  writePipeline/
    formatPatch.ts            recursive patch formatting through formatters
    formatValue.ts            single-value formatting via node.formatter
    mergeChanged.ts           merging sets of changed nodes
    runSetter.ts              invoking node.setter → applyPatch of dependent fields
    storeValue.ts             writing value into nodeState + updateValuesCacheEntry
    types.ts                  WriteDeps, WriteResult, Setter
    writePipeline.ts          the WritePipeline class
react/
  useForm.ts                  useSyncExternalStore + the tracking proxy
  createTrackingProxy.ts      Proxy layer 2: records accessed nodes
  useTranslator.ts            registers the translation function (i18n);
                              setTranslator(t) → hub.bumpLeafVersions() on change (bumps
                              the version of every leaf node → re-renders components with translatable fields)
  useNotifier.ts              registers the notification function (toast)
  usePersist.ts               the React hook wiring up persist
```

---

## Traversal Layer — the layered tree-walking architecture

The config tree is walked in many places (init, reset, dirty, submit, valuesCache, etc.).
To remove the repeated classification pattern, a dedicated `store/traversal/` module exists.

```
┌─────────────────────────────────────────────────────┐
│  Layer 3: Actions (concrete operations)              │
│  recomputeDirtyTargeted, collectDefaults, buildValuesCache,  │
│  captureInitialValues, collectLeafStates, …          │
├─────────────────────────────────────────────────────┤
│  Layer 2: walkFull(node, visitor, path?)             │
│  A universal tree walk with the visitor pattern      │
├─────────────────────────────────────────────────────┤
│  Layer 1: Node Classifier                            │
│  isLeaf(), isGroup(), isListNode(), configKeys()     │
└─────────────────────────────────────────────────────┘
```

### Layer 1: Node Classifier (`traversal/nodeClassifier.ts`)

| Function | Description |
|---|---|
| `isLeaf(node)` | `true` when the object has a `"value"` field |
| `isGroup(node)` | `true` when the object is not an array and has no `"value"` |
| `isListNode(node)` | `true` when `Array.isArray(node)` (any array) |
| `configKeys(node)` | `Object.keys(node)` filtered by `CONFIG_PROPS` — replaces the repeating boilerplate |

> **`isListNode` distinction:** `traversal.isListNode` = any array. `nodeUtils.isListNode` = an array of length 1–2 (the strict check for proxy/ownKeys). Used in different layers deliberately.

### Layer 2: walkFull (`traversal/walkFull.ts`)

A universal full-config-tree walk with the visitor pattern.
Suited to operations that don't build a nested result.

```ts
walkFull(node, visitor, parentPath?)

interface TreeVisitor {
  onLeaf(node, key, path, parent): void;          // required
  onGroupEnter?(node, key, path, parent): boolean | void;  // false → skip subtree
  onGroupExit?(node, key, path, parent): void;    // for bottom-up aggregation
  onList?(node, key, path, parent): void;         // when absent — lists are skipped
}
```

**Who uses `walkFull`:** `captureInitialValues`, `collectLeafStates`, `initGroupSubmitting`.

**Who uses only Layer 1 (`configKeys` / `isLeaf` / `isListNode`):** functions that build a nested result (recursion + accumulator object) — `collectDefaults`, `collectInitialSnapshot`, `buildValuesCache`, `recomputeDirtyTargeted`, `setGroupRevalidate`, `createGroupDeps`.

**Parallel walks (config + patch):** `formatPatch`, `applyPatch`, `mergeInitialValues` — iterate over the patch keys, so `configKeys()` is not used, only `isLeaf`/`isListNode` from traversal.

---

## DirtyTracking — change tracking

`DirtyTracker` (`store/store/dirtyTracker.ts`) is the class encapsulating `initialValueMap: WeakMap<node, unknown>`.
Methods:

| Method | Description |
|---|---|
| `capture(node, nodeState)` | An initial-values snapshot via `walkFull` → writes `state.value` into `initialValueMap`. Called after init and after reset. |
| `merge(node, nodeState, patch)` | Updates the baseline from a patch — only the nodes in the patch. Called after a successful resolve (so resolver data isn't considered "dirty"). |
| `collectSnapshot(node)` | A nested `initialValueMap` snapshot for a subtree — used by `buildResetPatch` on reset. |
| `initialValueMap` (getter) | Direct WeakMap access — for modules taking a deps interface. |

### recomputeDirtyTargeted — the algorithm

```
WritePipeline/onChange returns changedNodes
  │
  └─ recomputeDirtyTargeted(changedNodes, ...):
       │
       ├─ 1. For every LEAF in changedNodes:
       │      isDirtyValue(state.value, initialValueMap.get(leaf))
       │      → leaf.dirty changed → Set changed, remember its groupPath
       │
       ├─ 2. BFS over the affected group paths:
       │      for every group → aggregate anyChildDirty from its immediate children
       │      (isLeaf: the dirty flag; isListNode: !arraysEqual(itemIds, initialItemIds))
       │      → update group.dirty; if changed → bubble the parent up into the queue
       │      (bubble-up: nodeParents.get(groupNode) → parentPath → queue)
       │
       └─ 3. Returns { anyDirty: boolean, changed: Set<object> }
              changed → notifyChanged → bumpVersion → React snapshot
```

### isDirtyValue — the algorithm

```ts
isDirtyValue(current, initial):
  === → false
  null == undefined (both empty) → false
  one is null/undefined → true
  different typeof → true
  typeof === "object" → JSON.stringify comparison (fallback: true on error)
  otherwise → true
```

---

## valuesCache — the form values snapshot

A globally current, mutable object mirroring the `value` of every leaf node.
Read synchronously in O(1) — instead of a tree walk on every computed/validate.

```
buildValuesCache(rootConfig, nodeState)
  └─ walks the tree once → builds { values, nodeSlot, groupSlot }
       ├─ values     — a nested object { email: "…", passport: { number: "…" } }
       │               Mutated in place — a stable reference forever
       ├─ nodeSlot   — WeakMap<node, { parent, key }> for O(1) updates
       │               Populated for leaf nodes AND groups (virtual leaves).
       │               For groups: parent = the parent group's values object.
       │               Used in recomputeLeaves for group-scoped values.
       └─ groupSlot  — WeakMap<groupNode, Record<string, unknown>>
                       Maps every group node → the corresponding nested object
                       inside values. Used by the proxy to implement
                       group.values: proxy.passport.values === groupSlot.get(passportNode).
                       The same live reference updated on every field write.

updateValuesCacheEntry(cache, node, newValue)
  └─ nodeSlot.get(node) → slot.parent[slot.key] = newValue   // O(1)
```

The update happens in `storeValue` on every write. All computed/validate/setter
functions get group-scoped values from `nodeSlot.get(node)?.parent` as `allValues` —
the parent group's values (for root-level fields this equals `valuesCache.values`).

**Lists in valuesCache:** a ListNode receives an empty array `[]` during the tree walk.
The `nodeSlot` is registered on the array object (not a leaf node). After every
list mutation (`add`, `remove`, `setItems`) `_syncListValuesCache` (a private
Palistor method) rebuilds `slot.parent[slot.key]` from `listState.itemIds` →
an array of POJO mirrors (`entityProjectionObjs`). This lets computed expressions
like `isVisible: (values) => values.users.length > 0` work correctly.

---

## Palistor.recompute() — the targeted recompute

### Two modes of one function

```ts
// Palistor method
recompute(changedNodes?: Set<object>): Set<object> {
  if (changedNodes && changedNodes.size > 0) {
    return recomputeTargeted(changedNodes, deps); // the hot path
  }
  // The full path: collect all leaves and recompute
  const leafNodes = collectGroupLeafNodes(rootConfig, groupLeafMap);
  return recomputeLeaves(leafNodes, nodeState, valuesCache, translate, trackingWrap?);
}
```

- **With `changedNodes`** — targeted recompute (write, onChange, resolve)
- **Without arguments** — full recompute (init, reset, submit, persist hydrate)

### groupDeps — the map of dependencies between groups

Built automatically during the first (init) `recompute()` by tracking GET accesses:

```
groupDeps: Set<string>   — "donor→recipient" pairs in the pairKey(donor, recipient) format

  At init: every leaf evaluates its computed/flags through the trackingValues proxy,
  which intercepts reads of other groups' values and records the pair.

  Example: the passport.city field reads values.address.country
    → donor = "address", recipient = "passport"
    → groupDeps.add("address→passport")

  The self-dependency is added explicitly in createGroupDeps:
    → groupDeps.add("address→address"), "passport→passport", "→" (root)
```

### `recomputeTargeted` — the algorithm

```
SET passport.number = "123456"
  │
  ├─ changedNodes = {passportNumberNode}
  │
  └─ recomputeTargeted(changedNodes):
       │
       ├─ 1. Source groups: {passportNumberNode} → {"passport"}
       │     (via nodeParents + nodePaths)
       │
       ├─ 2. BFS over groupDeps:
       │     "passport" → all recipients → …
       │     orderedGroups = ["passport", "calculator", ...]
       │     (topological order: donors before recipients)
       │
       └─ 3. Recompute each group's OWN leaves:
             recomputeLeaves(groupLeafMap.get(groupNode))
               ├─ Phase 1: topo-sort computed → value recompute
               └─ Phase 2: computeFieldState for all group leaves
```

### Visually: before vs. after

```
BEFORE (full recompute):

  SET passport.number = "123456"
    └─ recompute of ALL 50 fields
         ├─ personal:  name, email, phone    ← wasted
         ├─ address:   country, city         ← wasted
         ├─ payment:   amount, type          ← wasted
         ├─ passport:  number, issue, expiry ← needed
         └─ calculator: total                ← wasted

AFTER (recomputeTargeted via recompute()):

  SET passport.number = "123456"
    ├─ sourceGroup = "passport"
    ├─ groupDeps → nothing depends on passport
    └─ recompute of only: passport (3 fields)
         Savings: 94%
```

### recomputeLeaves — internals

```
recomputeLeaves(leafNodes[]):
  │
  ├─ Phase 1: computed values
  │   ├─ filter leafNodes: only node.value === Function
  │   ├─ topologicalSortComputed(computedEntries)
  │   │     Kahn's algorithm (BFS over dependencies)
  │   │     Guarantees the order: subtotal → tax → total
  │   └─ for each, in sorted order:
  │       groupValues = nodeSlot.get(node)?.parent ?? valuesCache.values
  │       computedValue = node.value(groupValues)
  │       if changed → nodeState.set(...) + updateValuesCacheEntry O(1)
  │
  └─ Phase 2: FieldState
      for every leaf:
        computeFieldState(node, currentValue, allValues, revalidate, translate)
        if fieldStateChanged(prev, next) → nodeState.set(node, next)
      returns Set<object> of changed nodes
```

### FieldState — the full interface

```ts
interface FieldState {
  value: unknown;          // the current value (string, number, anything)
  label?: string;          // the computed label
  placeholder?: string;
  description?: string;
  isRequired: boolean;     // required field
  isReadOnly: boolean;
  isDisabled: boolean;
  isVisible: boolean;
  isInvalid?: boolean;     // validation error (only when revalidate=true)
  errorMessage?: string;   // the error text
  submitting?: boolean;    // groups only: a submit is in flight
  dirty?: boolean;         // leaf: ≠ initial; group: at least one dirty descendant
  revalidate?: boolean;    // group: show errors? (false until the first submit)
  loading?: boolean;       // only for groups with resolve: loading in progress
}
```

### `recompute()` call sites

```
1. Palistor constructor (init)    → full — builds groupDeps via trackingWrap
2. WritePipeline.execute()        → targeted (changedNodes)
3. OnChangePipeline.fire()        → full (an onChange patch may touch any fields)
4. ResolvePipeline/executeResolve → full (resolve changes arbitrary fields)
5. SubmitPipeline.execute (start) → full (revalidate=true)
6. SubmitPipeline.execute (end)   → full
7. ResetPipeline.execute()        → full
8. PersistManager.enable() / .hydrate()   → full (via the private hydrateFromStorage)
9. Palistor.setValuesNode()       → full (the patch may be anything)
10. ListProxy.add / remove / setItems     → full (after every list mutation: _syncListValuesCache → recompute() → notifyChanged)
```

---

## EntityRegistry — the normalized entity registry

The single source of truth for all entity values. Stores `EntityNode` — a tree
of `{ value: unknown }` leaf nodes. Every leaf node is registered in `nodeState`
via `registerDynamicLeaf`, which plugs it into the standard infrastructure
(recompute, dirty, notification).

```
EntityRegistry
  ├─ entities: Map<string, EntityNode>          — all entities by ID
  ├─ bindings: Map<string, Set<object>>         — entity → bound template nodes
  ├─ resolvedCache: Map<string, Set<object>>    — entity+template → already resolved
  └─ registeredLists: Array<{ itemIds: string[] }> — for propagation on rekey

EntityNode:
  { id: { value: 'u1' }, name: { value: 'Alice' }, email: { value: '…' } }
  Nested groups: { address: { city: { value: '…' }, country: { value: '…' } } }
```

**Methods:**

| Method | Description |
|---|---|
| `upsert(data)` | Create or merge an entity by `data.id`. A recursive merge: new fields are added, existing ones update, absent ones are untouched. When `id` is missing — `_tmp_<ts_base36>_<rand8>_<seq>` is generated. |
| `get(id)` | Get an EntityNode by ID |
| `delete(id)` | Remove the entity + clear bindings + resolvedCache. Returns `boolean`. |
| `has(id)` | Check existence |
| `size` | Number of entities in the registry |
| `bind(id, templateNode)` | Register the entity↔template binding (called from `useForm` on mount) |
| `unbind(id, templateNode)` | Remove the binding (called from `useForm` on unmount) |
| `getBindings(id)` | Get the `ReadonlySet<object>` of the entity's bound template nodes |
| `markResolved(id, templateNode)` | Mark the entity+template pair as resolved |
| `isResolved(id, templateNode)` | Check the resolved cache — skip the resolve on a repeat open |
| `clearResolved(id, templateNode?)` | Reset the resolved cache |
| `rekey(oldId, newId)` | Rename the entity: updates the Map, id.value, bindings, resolvedCache and `itemIds` in all registered lists |
| `registerList(list)` | Register a ListState for propagation on `rekey` |

---

## NodeView — the single storage/rules/parent junction

`NodeView` is the abstraction joining three sources of knowledge about a node.
It lets `WritePipeline`, `SubmitPipeline` and `OnChangePipeline` work identically
in config mode and entity mode.

```ts
interface NodeView {
  storage: AnyConfigNode;          // the node holding the value (the nodeState key)
  rules: AnyConfigNode;            // the node with callbacks: formatter, setter, validate,
                                   //   onChange, beforeSubmit, onSubmit, afterSubmit
  parent: {
    proxy: object | undefined;     // the parent proxy (entityProjectionProxy or groupProxy)
    getValues: () => Record<string, unknown>; // a lazy snapshot — called at every
  };                               //   beforeSubmit/onSubmit, never cached ahead of time
  onReset: () => void;             // resets the storage to its initial value
}
```

**Config mode (identity view):** `storage = rules = node`. Cached in `NodeRegistry._identityViews`.
Built via `makeIdentityView(node, kernel)`.

**Entity mode:** `storage` = the entity leaf node, `rules` = the template field node.
Registered lazily in the `buildEntityProjectionProxy` GET trap on first field access
(skips phantom leaves absent from `nodeState`).
Stored in `NodeRegistry.nodeViews: WeakMap<storage, Map<rules, NodeView>>` — supports
multiple template bindings for one entity leaf.

**API:**
```ts
kernel.nodes.getView(node, via?)
  // via=undefined → the identity view (config mode)
  // via=templateField → the entity view (throws when not registered)
```

---

## Lists (ListNode / ListState)

### Declaring in a config

A ListNode is an array of length 1 or 2 (detected via `isListNode` from `nodeUtils.ts`):

```ts
// Minimal — template only:
users: [{ id: { value: '' }, name: { value: '' } }]

// With a list configuration:
users: [
  { id: { value: '' }, name: { value: '' } },
  { resolve: { resolver: async (values, store) => { … } } },
]
```

`array[0]` is the **template**: a regular group node describing the item fields. All
rules (formatter, setter, validate, isRequired, onChange) work on the template leaves.
`array[1]` (optional) is the **listConfig**: `ListConfig { resolve?: ListResolveConfig }` — its only field.

### ListState

Stored in `NodeRegistry.listStates: WeakMap<object, ListState>` and `allListStates: ListState[]`.
Created in `registerNodes` — once, at store initialization.

```ts
interface ListState {
  template: AnyConfigNode;          // child[0] — the item fields
  listConfig: ListConfig | undefined; // child[1], optional
  itemIds: string[];                // the current membership: an array of entity IDs
  version: number;                  // incremented on every mutation
  initialItemIds: string[];         // the snapshot at the last "clean" state (dirty baseline)
}
```

### The ListProxy API

`buildProxy` returns `buildListProxy(listNode, kernel)` on a GET of the list node.
The proxy exposes the `LIST_SPREAD_KEYS`:

| Key | Type | Behavior |
|---|---|---|
| `items` | `ReadonlyArray<EntityProjectionProxy>` | Maps `listState.itemIds` → `buildEntityProjectionProxy(…)`. Triggers the lazy resolve. |
| `length` | `number` | `listState.itemIds.length`. Triggers the lazy resolve. |
| `loading` | `boolean` | `getListResolveState(listState)?.status === "pending"` |
| `dirty` | `boolean` | `!arraysEqual(listState.itemIds, listState.initialItemIds)` |
| `error` | `unknown \| null` | `getListResolveState(listState)?.error ?? null` — the last resolve's error |
| `resolveStatus` | `ResolveStatus` | `getListResolveState(listState)?.status ?? "idle"` |
| `reload()` | `fn` | `triggerListResolve(listState, force = true)` — stable identity, no-op without a resolver |
| `add(id \| values)` | `fn` | A string → adds an existing entity by ID; an object → `kernel.set(values)` + add |
| `remove(id)` | `fn` | Removes from `itemIds` (the entity stays in the registry) |
| `getById(id)` | `fn` | Finds the EntityProjectionProxy in the current list |
| `setItems(ids)` | `fn` | A bulk replacement of `listState.itemIds` |
| `map(fn)` | `fn` | `(fn: (item, index, id) => R): R[]` — for React rendering |
| `[Symbol.iterator]` | | Iteration over the entity proxies |

Every mutation is followed by `syncListValuesCache` + `kernel.recompute()` + `kernel.notifyChanged()`.

### Lazy resolve for lists

On access to `items`, `length` or `map` the proxy checks: when `listConfig.resolve` is set
and `resolveState.status === "idle"` — it calls `kernel.resolveManager.triggerResolve(listNode)`.
The standard resolve pipeline performs `entityRegistry.upsert()` for every item and fills
`listState.itemIds`.

### List dirty

`dirty = !arraysEqual(listState.itemIds, listState.initialItemIds)` — membership only
(order matters). Dirty by values inside the items is the dirty of the entity leaf nodes.
`captureInitialValues` skips ListNodes; `initialItemIds` is updated explicitly
via the reset pipeline or after a resolve.

---

## EntityProjectionProxy

**EntityProjectionProxy** is a proxy over an `EntityNode` through a template. Used for
list items and for `useForm(entity, templateSelector)`.

### buildEntityProjectionProxy

```
buildEntityProjectionProxy(entityNode, templateNode, kernel, entityProxyCache)
  └─ for every templateNode key → kernel.proxyBuilder.build(entityNode[key], { via: templateField, parentEntityProxy })
```

The leaf proxy is built by the unified `ProxyBuilder._buildEntityLeafProxy(storage, rules)`, where:
- `storage` — the entity leaf node (stores the value in `nodeState`)
- `rules` — the template field node (describes behavior: `label`, `validate`, `formatter`, `setter`, `onSubmit`, `onChange`, …)
- `NodeView` — the `(storage, rules)` link registered in `kernel.nodes.nodeViews`; provides `parent.getValues()` (a lazy snapshot) and `onReset`

The leaf proxy's GET traps (`ProxyBuilder._buildEntityLeafProxy`):
- `value` → `nodeState.get(storage)?.value ?? storage.value`
- `label/placeholder/description` → from `rules` (a string or `(translate, entityValues)`)
- `isRequired/isReadOnly/isDisabled/isVisible` → a bool or `(entityValues)` from `rules`
- `isInvalid/errorMessage` → `rules.validate(value, entityValues, translate)`
- `dirty` → `nodeState.get(storage)?.dirty`
- `loading` → `nodeState.get(storage)?.loading`
- `submitting` → `nodeState.get(storage)?.submitting`
- `onValueChange` → fn → `writePipeline.execute(storage, v, prev, { via: rules })` + `onChangePipeline.fire(..., { via: rules })`
- `submit` → fn → `submitPipeline.execute(storage, { via: rules })`

The leaf proxy's `ownKeys`: `value, label, placeholder, description, isRequired, isReadOnly, isDisabled, isVisible, isInvalid, errorMessage, dirty, loading, submitting, onValueChange, submit`

The SET trap on `"value"` → `writePipeline.execute(storage, newValue, prev, { via: rules })`:
1. `formatValue(rawValue, rules, entityValues)` — the formatter from the template
2. `Object.is(formatted, current)` → skip when unchanged
3. `storeValue(storage, …)` — writes into `nodeState` + `updateValuesCacheEntry` via nodeSlot
4. `rules.setter(value, entityValues, prev)` → applyPatch onto the entity's sibling nodes
5. `kernel.recompute(changedNodes)` + `kernel.notifyChanged(allChanged)`

**The root entity proxy** (only when `"id" in entityNode`) additionally exposes via `ownKeys`:
- `id` → the value from nodeState (a string), not via a leaf proxy
- `loading` / `submitting` → from `nodeState.get(templateNode)` (a group status via `NodeView`)
- `submit` → `kernel.submitPipeline.execute(templateNode)` (the group entity-as-form submit)

**Nested groups:** when a templateNode field is a group node (no `"value"`), the proxy
recursively builds `buildEntityProjectionProxy(entityField, templateField, …)`.

**Phantom leaves:** when the entityNode lacks a field the template has — the storage node
materializes on the first write/submit via `_setEntitiesRaw`. Until materialization,
`submit()` and `onValueChange` are no-ops.

### Config mode vs entity mode: a comparison

| Property/Hook | Config leaf | Entity leaf |
|---|---|---|
| `.value` get/set | ✅ | ✅ |
| `.label`, `.placeholder`, `.description` | ✅ | ✅ from the template rules |
| `.isRequired/isReadOnly/isDisabled/isVisible` | ✅ | ✅ from the template rules |
| `.isInvalid`, `.errorMessage` | ✅ | ✅ |
| `.dirty` | ✅ | ✅ |
| `.loading` | ✅ | ✅ |
| `.submitting` | ✅ | ✅ |
| `.onValueChange` | ✅ | ✅ → WritePipeline + OnChangePipeline |
| `.submit()` | ✅ | ✅ → SubmitPipeline via `{ via: templateField }` |
| `onChange` (template) | ✅ | ✅ → bubbles through the template ancestors |
| `beforeSubmit` (template) | ✅ | ✅ |
| `afterSubmit` + `reset` | ✅ | ✅ |
| `setter` (sibling patch) | config siblings | entity siblings |

The entity proxy additionally exposes `ENTITY_ID` (symbol → entityId) and
`STORE_REF` (symbol → kernel) — extracted by `useForm(entity, templateSelector)`.

---

## Per-entity nested lists

A list declared **inside an entity template** (`editUser.contacts = defineList(...)`)
gets a **separate** membership for **each** owner. That is, Alice's and Bob's
`form.contacts` are two independent lists with independent resolve, state and
tracking versions. This solves the shared-`ListState` problem (one `itemIds`
for all owners).

### State storage

- **`EntityListState`** (`{ listConfigNode, itemIds, initialItemIds }`) — per-(owner, list).
  Lives in `EntityNode.lists: Map<listConfigNode, EntityListState>` (a **non-enumerable**
  field assigned via `Object.defineProperty` so it doesn't leak into flat values).
  Created lazily via `entityRegistry.getOrCreateEntityListState(owner, listConfigNode)`.
- **`EntityNode.owner`** (`{ ownerId, ownerListNode }`, **non-enumerable**) — the back-reference
  to the owner, set when the resolver results are ingested. Indexed in
  `entityRegistry.childrenByOwner: Map<ownerId, Set<childId>>` (the cascade-deletion foundation).
- **The resolve state** reuses the shared `ResolveManager.entityStates`, keyed by `(ownerId, listConfigNode)` —
  the same two-level Map as template-binding/field-resolve. No separate sub-registry.

### Flow

1. `buildEntityProjectionProxy`: the `Array.isArray(templateField)` branch → `buildEntityListProxy(owner, listConfigNode, kernel)`
   (instead of the previous `return undefined`).
2. `buildEntityListProxy` — structurally like `buildListProxy`, but reads the `EntityListState`, **not**
   the shared `listStates.get(listConfigNode)`. The first access to `items`/`length`/`map` lazily
   triggers the resolve via `queueMicrotask` (a synchronous resolve→notify inside a GET trap during a
   render would yield "Cannot update a component while rendering another").
3. `ResolveManager.triggerEntityListResolve(ownerId, listConfigNode, owner)`:
   the resolver receives the **owner's flat snapshot** (`buildEntityValues(owner, nodeState)`, `parentValues.id === ownerId`);
   the result → `setEntitiesRaw` + setting the `owner` reference on every child → filling `itemIds` → notify.

### Tracking isolation

The tracking key is **the `EntityListState` object itself** (per-owner, unique), not the shared `listConfigNode`.
`buildEntityListProxy` exposes it via the **`ENTITY_LIST_STATE`** brand symbol; `createTrackingProxy`
has a dedicated branch (before `FIELD_STATE_PROPS`, since `loading` belongs there) and tracks exactly
that object's version through the existing hub (`getNodeVersion(entityListState)` / `notifyChanged([entityListState])`).
No separate public `getEntityListVersion` is needed.

### Mutations + ownership

`buildEntityListProxy` publishes the mutations that change exactly this
`EntityListState`'s membership (not the shared `ListState`):

- **`add(values)`** — upserts a child entity (the id is generated when missing) + pushes into `itemIds`.
- **`add(id)`** — adds an existing entity (an error when not found in the registry).
- **`remove(id)`** — removes from `itemIds`. The entity **stays** in the registry (reusable);
  the cascade happens only on `delete(ownerId)`.
- **`setItems(ids)`** — replaces the membership (all ids must exist).

Every mutation sets `owner = { ownerId, ownerListNode }` on the child and indexes it in
`childrenByOwner`, then bumps the version of **its own** `EntityListState` via
`notifyChanged([entityListState])` + a full `recompute` (per-owner isolation is preserved).

**The "one owner per child" ownership model.** On re-parenting (the child already belonged to
another owner), `setEntityOwner` removes the stale membership from the old owner's
`childrenByOwner` — so a cascade deletion of the previous owner never touches the re-parented child.

**Cascade deletion.** `Palistor.delete(ownerId)` recursively removes all child entities from
`childrenByOwner.get(ownerId)` (full cleanup of leaf nodes + resolve states at every level),
then deletes the owner; `EntityRegistry.delete` cleans up `childrenByOwner` and `EntityNode.lists`.

**Reset.** A full `store.reset()` (`groupNode === rootConfig`) restores `itemIds = initialItemIds`
for all `EntityListState`s via `entityRegistry.resetEntityListStates()` and bumps their versions.

### getValues + dirty + persist

**Materialization in `getValues()`.** The per-entity list membership is written into the owner's
projectionObj at its **path**: `ownerProjectionObj[…path] = itemIds.map(childProjectionObj)`.
Since the owner's projectionObj is referenced by the root list array (`values.users[i]`),
and child projectionObjs recursively materialize their own lists, `store.getValues()` returns
a fully nested structure (including nested-of-nested). The reverse index `listConfigNode → fieldPath`
lives in `NodeRegistry.listFieldKeys` (built once by a config walk). The path is an array of keys
relative to the owner's entity scope: `["contacts"]` for a list directly under a template, or
`["profile", "contacts"]` for a list inside a **nested group**; `_syncEntityListValuesCache`
descends along the path, creating intermediate POJOs. The sync runs on resolve, mutations
and reset.

> ⚠️ A list enters `store.getValues()` only when its owner is **materialized** — i.e. it belongs to
> some root list (its projectionObj lives in the valuesCache). A single-binding entity
> (`useForm(user, s => s.editUser)`, not added to any root list) does not appear in form-level
> getValues — consistent with the behavior of scalar entity fields.

**`entityProxy.values` / `list.getValues()`.** Compute the values "live" via
`buildEntityValuesWithLists(entityNode, template, kernel)` — recursively walking the template
(including nested groups) and appending list fields from `EntityListState.itemIds` into the matching
nested spot of the value tree. The base `buildEntityValues` stays **list-free**: it feeds
resolvers/validators that must see only the owner's scalar snapshot.

**Dirty.** `list.dirty` — by membership (`itemIds ≠ initialItemIds`). `entityProxy.dirty`
(`isEntityDirty`) aggregates the owner's leaf-field dirt **and** the composition dirt of all its
per-entity lists. `dirty` tracking on the entity-list proxy is keyed by the `EntityListState` object (like items/length).

**Persist.** Serialization comes automatically via `getValues()` (the nested structure is already there).
Hydration: `applyPatch` skips list nodes, so the membership is restored in a separate pass —
`Palistor.restoreLists(values)` recursively creates child entities (`_setEntitiesRaw`), sets the
owner references, fills the `itemIds`/`initialItemIds` of root and per-entity lists, and syncs the
valuesCache. Old snapshots without nested lists load without errors (no data → no-op).

### Nested-of-nested

Both nesting axes are supported:

1. **Entity → entity → entity** (`users → contacts → emails`) — works recursively: every child
   is itself the root of its own projection proxy, so its list fields are built by the same
   helpers. Cascade deletion (`delete(ownerId)`) descends through `childrenByOwner` without
   touching sibling subtrees; tracking versions and mutations stay isolated per-(owner, list) at every level.

2. **A list inside a nested group** (`profile.contacts`) — a previously broken case.
   `buildEntityProjectionProxy` used to reset the owner when recursing into a structural group,
   and the list got the group instead of the entity (→ `undefined`). Now the real owner entity is
   threaded via the dedicated `ownerEntityNode` parameter through the `buildEntityProjectionProxy` →
   `buildEntityListProxy` recursion: the list is declared inside the group, but the owner is the
   nearest entity with an `id` (the root). The membership materializes in `getValues()` at the
   nested path (see `listFieldKeys` above), and cascade deletion plus the owner index work exactly
   like for top-level lists.

---

## store.set() / store.delete() / store.rekey() / store.invalidate()

Public `Palistor` methods for managing entity data.

### store.set(data | data[])

```
store.set({ id: 'u1', name: 'Alice', email: 'alice@corp.com' })
  │
  ├─ entityRegistry.upsert(item) → EntityNode
  ├─ getOrCreate entityProjectionObj (the POJO mirror for valuesCache)
  ├─ walkAndSyncEntityNode():
  │    ├─ New leaf nodes → nodes.registerDynamicLeaf(…)
  │    │                    + nodeSlot → projectionObj for O(1) updates
  │    └─ Existing leaf nodes → update state.value + updateValuesCacheEntry
  └─ batch: one recompute() + notifyChanged() for the whole array
```

Accepts a single object or an array — batched: one recompute/notify per batch.

### store.delete(id)

```
store.delete('u1')
  ├─ collectEntityLeaves(entityNode) → all the entity's leaf nodes
  ├─ nodes.unregisterLeaf(leaf) for each — prevents memory leaks
  ├─ entityRegistry.delete(id) — remove + clear bindings + resolvedCache
  └─ notifyChanged(deletedLeaves)
```

The entity is not removed from lists automatically — that is the caller's responsibility.

### store.rekey(oldId, newId)

Renames an entity (e.g. temp → real ID after a server save):
1. `entityRegistry.rekey(oldId, newId)` — updates the Map, id.value, bindings, resolvedCache,
   and `itemIds` in all registered ListStates
2. Moves the `entityProjectionObjs` entry
3. Updates `nodeState` for the id.value leaf
4. `recompute(changedNodes)` → merges changedNodes into the result
5. `notifyChanged(merged)`

### store.invalidate(id, templateNode?)

Resets the entity's resolved cache (for one template or all). The next `useForm(entity, selector)`
re-runs the resolve. `store.set()` does **not** reset the resolved cache — the data is compatible.

---

## Persist

`PersistManager` is created inside Palistor at initialization and activated via `persist.enable(options)` from the `usePersist` hook.

### PersistDriver

```ts
interface PersistDriver {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}
```

Built-in implementations: `localStorageDriver`, `sessionStorageDriver` (exported from the root `index.ts`).

### PersistOptions

```ts
interface PersistOptions {
  key: string;           // the unique storage key
  driver: PersistDriver;
  serialize?: (values) => string;   // defaults to JSON.stringify
  deserialize?: (raw) => object;    // defaults to JSON.parse
  debounce?: number;                // the auto-save delay in ms (default 100)
  pick?: string[];    // persist only the listed top-level fields
  omit?: string[];    // exclude the listed fields (ignored when pick is set)
}
```

### The PersistManager API

| Method | Description |
|---|---|
| `enable(options): Promise<void>` | Activate: hydrate from storage + auto-save on changes |
| `disable(): void` | Deactivate: unsubscribe from the store, cancel timers |
| `flush(): Promise<void>` | Force-save without the debounce |
| `hydrate(): Promise<void>` | Force re-read from storage and apply |
| `clear(): Promise<void>` | Remove the data under the current key |
| `isEnabled(): boolean` | Whether persistence is currently active |

Lifecycle via `usePersist`:
- **mount** → `store.persist.enable(options)` (hydrate + auto-save subscribe)
- **unmount** → `store.persist.flush()` + `store.persist.disable()`

---

## useForm: entity mode

```ts
// Standard mode (unchanged):
const form = useForm(store);
const section = useForm(form.passport);

// New: entity + a template selector
const u = useForm(entityProxy, (store) => store.editUserForm);
```

`entityProxy` is an object from `list.items[i]` or `list.getById(id)`.
`templateSelector` is a function returning a store-proxy subtree (a group node).

**Behavior:**

```
useForm(entityProxy, (s) => s.editUserForm)
  │
  ├─ Extract entityId = entityProxy[ENTITY_ID]
  ├─ Extract entityStore = entityProxy[STORE_REF]
  ├─ templateNode = templateSelector(entityStore.proxy)[CONFIG_NODE]
  ├─ entityNode = entityStore.entityRegistry.get(entityId)
  ├─ Build entityProxy = buildEntityProjectionProxy(entityNode, templateNode, …)
  │
  ├─ useEffect mount:
  │    ├─ entityRegistry.bind(entityId, templateNode)
  │    └─ if !isResolved → triggerEntityTemplateResolve(entityId, templateNode, entityProxy)
  │
  ├─ useEffect cleanup (unmount):
  │    └─ entityRegistry.unbind(entityId, templateNode)
  │       (the resolved cache REMAINS — a repeat open is instant)
  │
  └─ return createTrackingProxy(entityProxy, …) — an independent re-render
```

Resolved cache: `isResolved(entityId, templateNode) → true` on a repeat open of the same
entity+template → the resolve is skipped, the form shows the data instantly.

Two simultaneous `useForm`s with one entity+template are unsupported — the second one gets
`loading: true` while the first is pending.

---

## Key invariants

| Principle | Implementation |
|---|---|
| The config is immutable | `rootConfig` is never mutated |
| One proxy per node | `proxyCache: WeakMap` |
| Stable references | `WeakMap` caches for onValueChange / submit / reset / setValues |
| Targeted re-renders | the tracking proxy + `nodeVersions` |
| Immutable FieldState | `nodeState.set(node, { ...old, value: new })` |
| Resolve without extra re-renders | batch: a write buffer + one flush + one notifyChanged |
| Resolve deduplication | a pending status → no repeat launch |
| Resolve errors without throw | the `onError` callback + reactive `isInvalid`/`errorMessage` |
| One entity — one record | EntityRegistry: Map<id, EntityNode>, no data duplication |
| Shared leaf nodes | An entity leaf is one in-memory object across all views and lists |
| applyPatch skips ListNodes | Arrays: `if (Array.isArray(child)) continue` in applyPatch |
| List dirty is membership-only | `!arraysEqual(itemIds, initialItemIds)` — order matters |
| The resolved cache survives unmount | `unbind` leaves resolvedCache alone → a repeat open is instant |

---

## Palistor + useForm

`new Palistor(options)` — creates the form instance.
`useForm(store | subtree)` — the React hook connecting a component to the store via a tracking proxy.
`useForm(entityProxy, templateSelector)` — binds a list entity to a template.

```ts
// Store creation (outside React)
const store = new Palistor<Config>({
  config: orderConfig,
  initialValues: { email: "user@example.com" },
});

// The root component
function App() {
  useTranslator(store, useTranslations());  // i18n
  useNotifier(store, notifyError);          // a toast for resolve onError
  usePersist(store, { key: "order", driver: localStorageDriver });

  const form = useForm(store);
  return <PassportSection passport={form.passport} />;
}

// A nested component — takes a subtree from a prop
function PassportSection({ passport }) {
  const p = useForm(passport);  // ← an independent tracking proxy
  if (!p.isVisible) return null;
  return <input value={p.number.value} onChange={e => { p.number.value = e.target.value }} />;
}

// A list — iteration via list.map
function UserList({ users }) {
  const form = useForm(store);
  return (
    <ul>
      {form.users.map((user, i) => (
        <UserRow key={form.users.items[i][ENTITY_ID]} user={user} />
      ))}
    </ul>
  );
}

// The edit form — entity-mode useForm
function EditUserModal({ userProxy }) {
  // userProxy — from form.users.items[i] or form.users.getById(id)
  const u = useForm(userProxy, (s) => s.editUserForm);
  // u.name.value, u.email.value — entity leaf nodes through the template
  return <input value={u.name.value} onChange={e => { u.name.value = e.target.value }} />;
}
```

**Key decisions:**
- The state lives outside React — React subscribes via `useSyncExternalStore`
- i18n / notifications are wired via hooks (`useTranslator`, `useNotifier`), not a provider
- `useForm(subtree)` accepts a tracking-proxy subtree → an independent re-render
- The submit/reset/onChange callbacks are defined in the config, not at the useForm call
- `{...form.email}` is spread-safe: validate/formatter/setter are hidden via ownKeys
- Entity mode: `useForm(entityProxy, selector)` — bind on mount, unbind on unmount, the resolved cache survives unmount

---

## The public API (imports)

Palistor has no single barrel export for everything. Entry points:

### `@palistor` (root `index.ts`) — types

```ts
// Config and proxy types
import type {
  FormConfig, TranslateFn, MaybeComputed, DeepPartialValues, FieldTypeMeta,
  ConfigNode, FieldProxyNode, GroupProxyNode, ConfigProxy,
  ExtractValues, ProxyStoreOptions, ProxyStore, Unsubscribe,
} from "@palistor";

// Resolve types
import type { Resolve, NotifyFn, ResolveErrorContext } from "@palistor";

// Persist types
import type { PersistDriver, PersistOptions, PersistManager } from "@palistor";

// Value exports from root
import { useNotifier } from "@palistor";
import { localStorageDriver, sessionStorageDriver } from "@palistor"; // also available from @palistor/store/persist
```

### `@palistor/store/store` — the Palistor class

```ts
import { Palistor } from "@palistor/store/store";
```

### `@palistor/react/*` — the React hooks

```ts
import { useForm } from "@palistor/react/useForm";
import { usePersist } from "@palistor/react/usePersist";
import { useTranslator } from "@palistor/react/useTranslator";
```

### `@palistor/store/persist` — the persist drivers

```ts
import { localStorageDriver, sessionStorageDriver } from "@palistor/store/persist";
```

> **Note:** Subpath imports (`/store/store`, `/react/useForm`) instead of a barrel exist
> because the root `index.ts` was designed to be types-only, with concrete implementations
> imported directly by subpath. The `ENTITY_ID` and `STORE_REF` symbols are imported as
> `import { ENTITY_ID, STORE_REF } from "@palistor/store/constants"` when direct access is needed.
