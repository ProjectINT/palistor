/**
 * Baseline: a 500-field form with 50 computed flags.
 *
 * Each write is followed by reading all 50 flags, the way a render would:
 * Cube computes lazily on read, the store eagerly on write, so timing only the
 * write would compare different amounts of work.
 *
 *   npx vitest bench --run --project store cube/bench
 *   npx vitest bench --run --project cube cube/bench
 */

import { bench, describe } from "vitest";
import { Palistor } from "@impl";

const FIELDS = 500;
const FLAGS = 50;

function makeConfig() {
  const config: Record<string, any> = { mode: { value: "a" } };
  for (let i = 0; i < FIELDS; i++) {
    config[`f${i}`] = i < FLAGS
      ? { value: "", isVisible: (v: any) => v.mode === "a" || i % 2 === 0 }
      : { value: "" };
  }
  return config;
}

function readFlags(form: any) {
  let visible = 0;
  for (let i = 0; i < FLAGS; i++) if (form[`f${i}`].isVisible) visible++;
  return visible;
}

describe("form: 500 fields, 50 computed flags", () => {
  bench("create the store", () => {
    new Palistor({ config: makeConfig() as any });
  });

  {
    const store = new Palistor({ config: makeConfig() as any });
    const form = store.proxy as any;
    let n = 0;
    bench("write a plain field + read 50 flags", () => {
      form.f499.value = String(++n);
      readFlags(form);
    });
  }

  {
    const store = new Palistor({ config: makeConfig() as any });
    const form = store.proxy as any;
    let n = 0;
    bench("write the field all flags depend on + read 50 flags", () => {
      form.mode.value = ++n % 2 ? "b" : "a";
      readFlags(form);
    });
  }
});
