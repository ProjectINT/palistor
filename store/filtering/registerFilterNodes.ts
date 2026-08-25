import { resolveFlag, type FieldState } from "../compute/index";
import type { ComputeEntry, GroupComputeMap } from "../store/registerNodes";
import type { AnyConfigNode, ListState, TranslateFn } from "../store/types";
import type { FilterFieldRuntime, FilterState, NormalizedFilterBlock } from "./types";

type MaybeFlag = boolean | ((values: unknown) => boolean) | undefined;

/** Same guard registerNodes uses: computed flags at init may read values that
 *  don't exist yet — fall back to the default, the first full recompute fixes it. */
function safeFlag(
  configValue: MaybeFlag,
  defaultValue: boolean,
  translate: TranslateFn,
): boolean {
  try {
    return resolveFlag(configValue as never, {}, defaultValue, translate);
  } catch {
    return defaultValue;
  }
}

/**
 * Register a normalized filter block as ordinary Palistor leaf nodes and
 * assemble the {@link FilterState} sidecar.
 *
 * The fields live in a synthetic group at `$filters.<listPath>` — a reserved
 * namespace OUTSIDE the config tree, which is what keeps `$filters` view
 * state: `getValues()` strips it, `store.reset()` never reaches it, submit
 * walks the config tree and never sees it. Registering them as real leaves
 * (nodeState + computeNodes + groupComputeMap) buys the whole compute/notify
 * pipeline — computed props, derived values, validation, per-node
 * notification and tracking-proxy subscriptions — with no new pipeline code.
 *
 * Dot-paths (`nodePaths`/`nodeParents`) are assigned later, by NodeRegistry's
 * filter phase (they are built after registerNodes for the whole tree).
 */
export function registerFilterNodes(
  normalized: NormalizedFilterBlock,
  listState: ListState,
  listPath: string,
  computeNodes: ComputeEntry[],
  nodeState: WeakMap<object, FieldState>,
  groupComputeMap: GroupComputeMap,
  translate: TranslateFn,
): FilterState {
  const groupNode: AnyConfigNode = {};
  (groupNode as { __kind?: string }).__kind = "group";

  const fields = new Map<string, FilterFieldRuntime>();
  const fieldsByPath = new Map<string, FilterFieldRuntime>();
  const nodeSet = new Set<object>();
  const paths = new Set<string>();
  const serverPaths = new Set<string>();
  const groupEntries: ComputeEntry[] = [];

  let hasClientFields = false;
  let hasServerFields = false;

  for (const field of normalized.fields) {
    const { key, node } = field;
    const path = `$filters.${listPath}.${key}`;

    (node as { __kind?: string }).__kind = "leaf";
    (groupNode as Record<string, unknown>)[key] = node;

    // Initial value: preserve the declared default verbatim (null included);
    // a derived field is computed by the first full recompute.
    const initialValue = field.isDerived
      ? undefined
      : field.defaultValue !== undefined
        ? field.defaultValue
        : "";

    nodeState.set(node, {
      value: initialValue,
      isVisible: safeFlag(node.isVisible as MaybeFlag, true, translate),
      isRequired: safeFlag(node.isRequired as MaybeFlag, false, translate),
      isDisabled: safeFlag(node.isDisabled as MaybeFlag, false, translate),
      isReadOnly: safeFlag(node.isReadOnly as MaybeFlag, false, translate),
      dirty: false,
      revalidate: false,
    });

    const entry: ComputeEntry = { node, path };
    computeNodes.push(entry);
    groupEntries.push(entry);

    const runtime: FilterFieldRuntime = {
      key,
      node,
      path,
      isClient: field.isClient,
      isDerived: field.isDerived,
      where: field.where,
      param: field.param,
      debounce: field.debounce,
      defaultValue: field.defaultValue,
    };

    fields.set(key, runtime);
    fieldsByPath.set(path, runtime);
    nodeSet.add(node);
    paths.add(path);
    if (!field.isClient && !field.isDerived) {
      hasServerFields = true;
      serverPaths.add(path);
    }
    if (field.isClient) hasClientFields = true;
  }

  groupComputeMap.set(groupNode, groupEntries);
  nodeState.set(groupNode, {
    value: undefined,
    isVisible: true,
    isRequired: false,
    isDisabled: false,
    isReadOnly: false,
    dirty: false,
    revalidate: false,
  });

  return {
    listState,
    listPath,
    groupNode,
    fields,
    fieldsByPath,
    nodeSet,
    hasClientFields,
    hasServerFields,
    paths,
    serverPaths,
    key: "",
    serverKey: "",
    issuedKey: null,
    pendingTimer: null,
    memo: null,
    all: normalized.all,
    toParams: normalized.toParams,
    persist: normalized.persist,
    forceImmediate: false,
  };
}
