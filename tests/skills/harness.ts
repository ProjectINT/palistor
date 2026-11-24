/// <reference types="vite/client" />
import { describe, it, vi } from "vitest";

/** Named assertions over one loaded solution module. A check throws to fail. */
export type Checks<M> = Record<string, (mod: M) => void | Promise<void>>;

type Importer = () => Promise<unknown>;

/**
 * Grades one task directory (see README.md next to this file).
 *
 * - `solution` — every check passes.
 * - `mistake`  — the checks named in `rejects` FAIL (`it.fails`): the grader
 *   demonstrably catches the mistake the skill warns about.
 * - `mistakes` — optional further wrong solutions (one file each in
 *   `mistake/`), each with the checks it must fail, for a task that covers
 *   more than one entry of the skill's Common Mistakes.
 * - `subject`  — a consumer agent's output, graded by the same checks. Pass
 *   `import.meta.glob("./subject/<file>")`: nothing runs while the folder is
 *   absent.
 *
 * Every check gets a fresh module graph, so a module-level store (the layout
 * the skills teach) starts from its defaults each time. React and the testing
 * library stay single instances: they are external to the transformed graph.
 */
export function gradeTask<M>(options: {
  checks: Checks<M>;
  solution: Importer;
  mistake: Importer;
  rejects: readonly (keyof Checks<M> & string)[];
  mistakes?: ReadonlyArray<{ name: string; load: Importer; rejects: readonly (keyof Checks<M> & string)[] }>;
  subject?: Record<string, Importer>;
}): void {
  const { checks, solution, mistake, rejects, mistakes = [], subject = {} } = options;

  const fresh = (importer: Importer) => async () => {
    vi.resetModules();
    return (await importer()) as M;
  };

  for (const list of [rejects, ...mistakes.map((m) => m.rejects)]) {
    for (const name of list) {
      if (!(name in checks)) throw new Error(`gradeTask: unknown check "${name}" in rejects`);
    }
    if (list.length === 0) throw new Error("gradeTask: name at least one check the mistake must fail");
  }

  describe("reference solution", () => {
    const load = fresh(solution);
    for (const [name, check] of Object.entries(checks)) {
      it(name, async () => check(await load()));
    }
  });

  describe("mistake is rejected", () => {
    const load = fresh(mistake);
    for (const name of rejects) {
      it.fails(name, async () => checks[name](await load()));
    }
  });

  for (const extra of mistakes) {
    describe(`mistake is rejected: ${extra.name}`, () => {
      const load = fresh(extra.load);
      for (const name of extra.rejects) {
        it.fails(name, async () => checks[name](await load()));
      }
    });
  }

  const subjects = Object.entries(subject);
  if (subjects.length > 0) {
    describe("subject (consumer output)", () => {
      const load = fresh(subjects[0][1]);
      for (const [name, check] of Object.entries(checks)) {
        it(name, async () => check(await load()));
      }
    });
  }
}
