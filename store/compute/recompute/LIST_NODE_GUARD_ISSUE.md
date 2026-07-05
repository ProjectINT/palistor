# Known issue: `collectGroupComputeNodes` is missing a ListNode guard

## File

`store/compute/recompute/collectGroupComputeNodes.ts`

## Summary

`collectGroupComputeNodes` has no array check (`Array.isArray`) when recursing
into child nodes. As a result the function descends into ListNode arrays and
processes their template nodes a second time.

**How it happens:**

1. In `registerNodes` the line `(child as any).__kind = hasChildren(child) ? "group" : "leaf"` runs **before** the `Array.isArray(child)` check.
2. `hasChildren` calls `configKeys(array)`, which returns the numeric keys `["0", "1"]` (template + listConfig). Both are objects → `hasChildren` returns `true`.
3. The ListNode array gets `__kind = "group"`.
4. In `collectGroupComputeNodes`, while walking the parent group's child keys: `isLeafNode(array)` returns `false` (kind = "group") — the guard doesn't fire, and the function recurses into the array.
5. `groupComputeMap.get(array)` is undefined (arrays are never registered in the map), but `configKeys(array)` returns `["0"]`, which leads to a recursion into the template node.
6. The template IS registered in `groupComputeMap` via `registerNodes(template, ...)`, so its compute entries are **duplicated** in the result.

```ts
// collectGroupComputeNodes.ts — the problematic section
for (const key of configKeys(groupNode as Record<string, unknown>)) {
  const child = groupNode[key] as AnyConfigNode;

  if (!child || typeof child !== "object") continue;
  if (isLeafNode(child)) continue;
  // ← missing here: if (Array.isArray(child)) continue;
  result.push(...collectGroupComputeNodes(child, groupComputeMap));
}
```

## Consequences

- **Correctness**: unaffected — processing a node twice in `recomputeLeaves` is idempotent.
- **Performance**: minor extra work on every full recompute (once at startup and on full-tree invalidation).
- **groupDepsMap**: during the first recompute with `trackingWrap`, the duplication may double-register dependencies for template nodes. No practical effect has been observed in the tests, but it could potentially cause extra recomputes when donor groups change.

## The fix

Add one guard to the recursion loop:

```ts
for (const key of configKeys(groupNode as Record<string, unknown>)) {
  const child = groupNode[key] as AnyConfigNode;

  if (!child || typeof child !== "object") continue;
  if (Array.isArray(child)) continue; // ListNode — skip
  if (isLeafNode(child)) continue;
  result.push(...collectGroupComputeNodes(child, groupComputeMap));
}
```

## Why it isn't fixed yet

Deferred — the behavior causes no visible failures in the current test suite.
The fix will land separately after assessing the impact on groupDepsMap in
real ListNode scenarios.
