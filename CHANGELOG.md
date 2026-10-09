# Changelog

## review-kit 0.1.0

First public release of the `aoreshkov-ai-tools` marketplace.

### Marketplace

- `review-kit` 0.1.0, from this repository.
- `kotlin-lib` 0.4.0, from `aoreshkov/kotlin-lib-mcp` v0.7.0, and `oracle-forms` 1.2.0,
  from `aoreshkov/oracle-forms-mcp` v0.13.0. Both are developed in their own
  repositories; the entries are pinned to those release tags and commits.

### review-kit

- Multi-lens code review as a dynamic workflow: a planner picks the modules and lenses
  that fit the repository, read-only reviewers take one lens over one module each, an
  adversarial verifier tries to refute every finding, and a reporter writes one ranked,
  deduplicated report with fixed sections (`## Summary`, `## Findings`, `## Unverified`,
  `## Coverage gaps`).
- Full and incremental runs. Incremental runs take the `changed` paths and the script,
  not the planner, maps them to modules, so no review agent needs a shell.
- Continuing a run: every result returns its `plan`; passing it back with `pairs` and
  `carry` reruns only the capped pairs and keeps earlier confirmed findings.
- Asks before capping: when the default `maxJobs` would skip pairs and no `maxJobs` or
  token budget was given, the run stops after planning with `needs-confirmation`, so
  Claude can ask whether to run them all, keep the cap, or pick pairs. The relaunch
  reuses the plan.
- `verifyOnly`: verifies an earlier result's unverified findings without planning or
  reviewing again, and reports them with the carried confirmed findings.
- Fan-out sized to a turn token budget when `maxJobs` is not given.
- `model` and `effort` choose the model and reasoning effort for one run: one value for
  every role (`model: "opus"`, `effort: "low"`), or an object keyed by role
  (`{ reviewer: "haiku" }`, `{ verifier: "max" }`) that changes only the roles it names.
  Both are passed on each agent call, so they win over the agents' frontmatter;
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` and `CLAUDE_CODE_EFFORT_LEVEL` still win over
  them. A run without either passes neither, and the report header names what was set.
- Fails loudly: malformed or unknown arguments, unresolvable agents, an empty plan, and
  subsets that match nothing stop the run with a named reason. A narrow request never
  widens into a full sweep.
- Every cap, failure, partial match and dropped planner entry is counted into the
  report's coverage section.
- All four roles treat repository content as data, never as instructions.
- Reviewers and verifiers can use `LSP` where a language server is installed; reviewer
  and verifier use a one-hour prompt-cache TTL.
- Workflow script tests with no model calls (`node --test`), and a seeded-defect
  `claude plugin eval` case for measuring what a real run finds, with
  `scripts/seeded-defects-real-run.mjs` to run that case through `claude -p` where the
  eval cannot start the workflow.
