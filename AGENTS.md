<!-- intent-maintainer:start -->
## Library Skill Maintenance

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before substantial library source, documentation, examples, tests, or skill work, run `npm exec --no -- intent meta generate-skill` and follow the packaged maintainer procedure.
Use the current request and repository evidence. For initial skills, propose a useful batch and reuse any scope already agreed with the maintainer.
Before handing off a skill batch or library change, run `npm exec --no -- intent maintainer review --json`. Follow the maintainer procedure to update affected guidance, run task checks, and record completed review outcomes. Report an evidence-backed no-op or missing evidence explicitly.
Create and incrementally maintain domain_map.yaml, skill_spec.md, and skill_tree.yaml in the established artifact location for every skill batch. Preserve prior tasks, maintainer decisions, and remaining work.
Keep maintainer decisions and changes in the repository; do not require the user to repeat the procedure in later sessions.
Use intent maintainer setup to initialize missing records, maintainer add to register skills, maintainer status to identify work, and maintainer sync to update generated metadata. Finish with intent maintainer check.
<!-- intent-maintainer:end -->

## Agent skills

The skills in `skills/palistor*/` ship inside the npm package and are the source of truth for agent
guidance; planning records live in `skills/_artifacts/`, task checks in `tests/skills/` (see its
README). Two rules the Intent validator does not enforce:

- Annotate every config callback parameter in skill examples (`(values: OrderValues) => …`).
  `intent validate` compiles examples with `strict: false`; a consumer's `tsc` reports the
  un-annotated ones as TS7006.
- A claim about behavior needs evidence from `cube/**` or a contract test (`cube/contract/**`), not
  from the README or an older skill.

## Releasing

A release publishes the skills too. Before publishing a version:

1. `npm exec --no -- intent maintainer status` — authoring gaps, files to sync, pending reviews.
2. Review every skill a source change flagged (`npm exec --no -- intent maintainer review`, procedure
   in `npm exec --no -- intent meta generate-skill`): update the guidance, or record an evidence-backed
   "unchanged".
3. `npm run typecheck:skills && npm run test:skills` — the task checks.
4. `npm exec --no -- intent validate --set-version <new version>` — only when the skills are verified
   for that version; it rewrites `metadata.library_version`. Update the "Targets palistor v…" line at
   the end of `skills/palistor/SKILL.md` to the same version.
5. `npm exec --no -- intent maintainer sync`, then `npm exec --no -- intent maintainer check` (exit
   code 0).
6. `npm pack --dry-run` — the tarball lists `skills/palistor*/**` and nothing from `skills/_artifacts`,
   `tests/` or `.intent/`.
