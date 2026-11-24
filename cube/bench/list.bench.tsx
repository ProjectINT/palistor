/**
 * Baseline: a 1 000-row list with 100 rendered row components; and the same
 * list with a `sort` block (Cube only, experiments/SortPlan.md: a sort change
 * fits a frame, a row edit in a sorted list costs what it costs unsorted).
 *
 * Timings cover the store write plus React's commit. The render counts are
 * deterministic and printed once per run (the Gate 1 criterion is "no more
 * re-renders than the store"). Skipped on an implementation that doesn't have
 * entities yet (store.set → NotImplementedError).
 *
 * Bench mode runs no beforeAll/afterAll hooks, so each bench mounts its list
 * in tinybench's setup/teardown, which wrap the warmup and the measured run.
 */

import { bench, describe } from "vitest";
import { act, render } from "@testing-library/react";
import { Palistor, defineList, useForm } from "@impl";

const ROWS = 1000;
const SHOWN = 100;

type Row = { id: string; name: string; price?: number };

const makeRows = (prefix: string, tag: string): Row[] =>
  Array.from({ length: ROWS }, (_, i) => ({ id: `${prefix}${i}`, name: `${tag} ${i}` }));

/** The sorted list's rows: a price that is a permutation of 0..999, so neither column is in list order. */
const makeSortedRows = (): Row[] =>
  Array.from({ length: ROWS }, (_, i) => ({ id: `u${i}`, name: `v0 ${i}`, price: (i * 7919) % ROWS }));

function mount(sorted = false) {
  const template = sorted ? { id: { value: "" }, name: { value: "" }, price: { value: 0 } } : { id: { value: "" }, name: { value: "" } };
  const store = new Palistor({
    config: { users: defineList({ template, ...(sorted ? { sort: true } : {}) }) } as any,
  });
  const renders = { list: 0, rows: 0 };

  function RowView({ item }: { item: any }) {
    const row = useForm(item) as any;
    renders.rows++;
    return <li>{row.name.value}</li>;
  }

  function List() {
    const form = useForm(store) as any;
    renders.list++;
    return <ul>{form.users.items.slice(0, SHOWN).map((item: any) => <RowView key={item.id} item={item} />)}</ul>;
  }

  const replace = (rows: Row[]) =>
    act(() => {
      store.set(rows);
      (store.proxy as any).users.setItems(rows.map((r) => r.id));
    });
  const update = (row: Row) => act(() => { store.set(row); });
  const users = () => (store.proxy as any).users;
  const sortBy = (key: string, dir: "asc" | "desc") => act(() => { users().sort.set(key, dir); });
  /** The id rendered at `index` (a sorted list shows another order than its membership). */
  const shownId = (index: number): string => users().items[index].id;

  replace(sorted ? makeSortedRows() : makeRows("u", "v0"));
  const view = render(<List />);
  return { renders, replace, update, sortBy, shownId, unmount: view.unmount };
}

function hasEntities() {
  try {
    new Palistor({ config: {} as any }).set([]);
    return true;
  } catch (e) {
    if ((e as Error).name === "NotImplementedError") return false;
    throw e;
  }
}

function renderCounts() {
  const m = mount();
  const counts: Record<string, { list: number; rows: number }> = { mount: { ...m.renders } };
  const step = (name: string, fn: () => void) => {
    const before = { ...m.renders };
    fn();
    counts[name] = { list: m.renders.list - before.list, rows: m.renders.rows - before.rows };
  };

  step("update all 1000 rows in place", () => m.replace(makeRows("u", "v1")));
  step("update one rendered row", () => m.update({ id: "u5", name: "only me" }));
  step("update one row outside the first 100", () => m.update({ id: "u500", name: "off screen" }));
  step("replace with 1000 new ids", () => m.replace(makeRows("w", "v2")));
  m.unmount();
  return counts;
}

/** The implementation has `list.sort` (Cube; the store's defineList drops the block). */
function hasSort() {
  const store = new Palistor({ config: { l: defineList({ template: { id: { value: "" } }, sort: true } as any) } as any });
  return (store.proxy as any).l.sort !== undefined;
}

/** The sorted list: a sort change, then a value edit of a rendered row. */
function sortedRenderCounts() {
  const m = mount(true);
  const counts: Record<string, { list: number; rows: number }> = {};
  const step = (name: string, fn: () => void) => {
    const before = { ...m.renders };
    fn();
    counts[name] = { list: m.renders.list - before.list, rows: m.renders.rows - before.rows };
  };
  step("sort by price", () => m.sortBy("price", "asc"));
  step("sort by name, desc", () => m.sortBy("name", "desc"));
  const id = m.shownId(5);
  step("edit one rendered row of the sorted list", () => m.update({ id, name: "only me" }));
  m.unmount();
  return counts;
}

/** A bench over a freshly mounted list: `fn` gets the mount and the iteration number. */
function listBench(name: string, fn: (m: ReturnType<typeof mount>, n: number) => void, sorted = false, prepare?: (m: ReturnType<typeof mount>) => void) {
  let m: ReturnType<typeof mount> | undefined;
  let n = 0;
  bench(name, () => fn(m!, ++n), {
    setup: () => { m = mount(sorted); prepare?.(m); },
    teardown: () => { m?.unmount(); m = undefined; },
  });
}

const supported = hasEntities();
const sorts = supported && hasSort();

describe.skipIf(!supported)(`list: ${ROWS} rows, ${SHOWN} rendered`, () => {
  if (supported) {
    process.stdout.write(`render counts (list component / row components):\n${JSON.stringify(renderCounts(), null, 2)}\n`);
  }

  listBench("replace with 1000 new ids", (m, n) => m.replace(makeRows(n % 2 ? "a" : "b", `v${n}`)));
  listBench("update all 1000 rows in place", (m, n) => m.replace(makeRows("u", `v${n}`)));
  listBench("edit one rendered row", (m, n) => m.update({ id: "u5", name: `edit ${n}` }));
});

describe.skipIf(!sorts)(`sorted list: ${ROWS} rows, ${SHOWN} rendered`, () => {
  if (sorts) {
    process.stdout.write(`sorted list render counts (list component / row components):\n${JSON.stringify(sortedRenderCounts(), null, 2)}\n`);
  }

  // Every press sorts all 1000 rows (numbers, then strings through the collator) and shows another first 100.
  listBench("change the sort on 1000 rows", (m, n) => (n % 2 ? m.sortBy("price", "asc") : m.sortBy("name", "desc")), true);

  let edited = "";
  listBench("edit one rendered row of a sorted list", (m, n) => m.update({ id: edited, name: `edit ${n}` }), true, (m) => {
    m.sortBy("price", "asc");
    edited = m.shownId(5);
  });
});
