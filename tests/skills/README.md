# Skill task checks

Executable checks for the agent skills in `skills/`. Each directory is one
developer task a skill claims to enable; the check proves the grader accepts a
correct solution and rejects the mistake the skill warns about.

```
tests/skills/<task>/
  task.md         the developer's request — no solution, no API hints beyond what a developer would say
  fixture/        starting files a consumer agent edits
  solution/       reference solution (same file names as fixture/)
  mistake/        plausible wrong solution: one entry of the skill's Common Mistakes
  grade.ts(x)     the assertions — observable behavior, including the error path
  task.test.tsx   wires solution / mistake / subject into gradeTask (harness.ts)
```

Run:

```bash
npm run test:skills        # vitest project "skills"
npm run typecheck:skills   # fixtures, solutions and graders against the public types
```

Solutions import `"palistor"` exactly like a consumer; the vitest project and
`tsconfig.json` here resolve it to the package entry (`index.ts`).

## Grading a consumer agent

1. Give a fresh agent session `task.md` and a copy of `fixture/` in a project
   where the candidate package is installed (`npm pack`, then install the
   tarball and run the consumer setup from the README's "Agent Skills" section).
2. Copy the files it produced into `tests/skills/<task>/subject/` (git-ignored).
3. `npm run test:skills` — a `subject (consumer output)` block runs the same
   checks against it.

`discovery.md` holds the activation prompts (should load / should not load) for
each skill's `description`.
