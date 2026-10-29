/**
 * Baseline: a 1 000-row list with 100 rendered row components.
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

type Row = { id: string; name: string };

const makeRows = (prefix: string, tag: string): Row[] =>
  Array.from({ length: ROWS }, (_, i) => ({ id: `${prefix}${i}`, name: `${tag} ${i}` }));

function mount() {
  const store = new Palistor({
    config: { users: defineList({ template: { id: { value: "" }, name: { value: "" } } }) } as any,
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

  replace(makeRows("u", "v0"));
  const view = render(<List />);
  return { renders, replace, update, unmount: view.unmount };
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

/** A bench over a freshly mounted list: `fn` gets the mount and the iteration number. */
function listBench(name: string, fn: (m: ReturnType<typeof mount>, n: number) => void) {
  let m: ReturnType<typeof mount> | undefined;
  let n = 0;
  bench(name, () => fn(m!, ++n), {
    setup: () => { m = mount(); },
    teardown: () => { m?.unmount(); m = undefined; },
  });
}

const supported = hasEntities();

describe.skipIf(!supported)(`list: ${ROWS} rows, ${SHOWN} rendered`, () => {
  if (supported) {
    process.stdout.write(`render counts (list component / row components):\n${JSON.stringify(renderCounts(), null, 2)}\n`);
  }

  listBench("replace with 1000 new ids", (m, n) => m.replace(makeRows(n % 2 ? "a" : "b", `v${n}`)));
  listBench("update all 1000 rows in place", (m, n) => m.replace(makeRows("u", `v${n}`)));
});
