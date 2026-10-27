# ai-tools

A Claude Code plugin marketplace. Public on GitHub as `aoreshkov/ai-tools`.

## Layout

- `.claude-plugin/marketplace.json` - the marketplace. `review-kit`, `token-audit` and
  `token-meter` are relative paths; `kotlin-lib` and `oracle-forms` are `git-subdir`
  sources pinned (`ref` tag + `sha` commit) to releases of `aoreshkov/kotlin-lib-mcp` and
  `aoreshkov/oracle-forms-mcp`. Those repos own the plugins; this repo only points at them.
- `review-kit/` - the multi-lens review plugin.
  - `.claude-plugin/plugin.json` - manifest; `version` pins what installed copies get.
  - `workflows/review.js` - the dynamic workflow script (orchestration lives here).
  - `agents/{planner,reviewer,verifier,reporter}.md` - the four roles it spawns.
  - `evals/seeded-defects/` - `claude plugin eval` case: a scaffolded Kotlin repo with
    five known defects. Model calls; a manual pre-release gate, never CI. Defect scores
    count only when `workflow-completed` passes and, in a real run, claude exited cleanly
    (see README).
- `token-audit/` - ranks a project's sessions by token use from local transcripts.
  - `skills/token-audit/SKILL.md` - forked skill; injects the ranking with `` !`node …` ``
    and runs the script for the breakdowns. `reference.md` defines the figures.
  - `skills/token-audit/scripts/audit.mjs` - CLI (`rank`, `session`, `categories`);
    `lib/` holds `locate` (files), `transcript` (pure JSONL parsing), `attribute` (pure
    attribution) and `format` (text and JSON).
  - `evals/triggers/` - `claude plugin eval` case: a natural question must invoke the
    skill (`tool_used: Skill`). Model calls; a manual pre-release gate, never CI.
- `token-meter/` - a mod: a band above the prompt with branch, context, limits and cost.
  - `hooks/register.tsx` - the hooks module (runs inside Claude Code, no Node APIs);
    `hooks/format.ts` holds its pure helpers.
  - `types/index.d.ts` - the `$.state` contract, named by `types` in `plugin.json`.
  - `tests/token-meter.test.tsx` - `claude plugin test` with the engine's test kit. Offline,
    no model calls. `.tsx`, not `.ts`: Node 22+ `node --test` collects `*.test.ts` and fails
    on `claude-code/testing`.
- `test/review.test.mjs` - runs `review.js` against stubbed `agent()`, `pipeline()` and
  `parallel()`. No model calls.
- `test/token-audit/` - token-audit tests over synthetic transcripts in
  `test/fixtures/token-audit/` (a config dir; `expected/` holds the `--json` snapshots).
  No model calls.
- `scripts/seeded-defects-real-run.mjs` - runs the seeded-defects case as a real
  `claude -p` session with workflows on, for when `plugin eval` cannot start the workflow,
  and applies its graders. Model calls; manual, never CI. Keep it out of `test/`, where
  `node --test` would run it.
- `docs/` - private analysis and plans. Gitignored; never commit, reference or link it.

## Checks

Run all six before every commit (Node 22 or later).

```bash
node --test
claude plugin validate . --strict
claude plugin validate ./review-kit --strict
claude plugin validate ./token-audit --strict
claude plugin validate ./token-meter --strict
claude plugin test ./token-meter
```

## Rules for `review.js`

- Load `/workflow-authoring` before editing it.
- No filesystem, no Node APIs, and no `Date.now()`, `Math.random()` or argless
  `new Date()`: they break resume. Dates come in through `args.today`.
- Planner prompts stay free of cap values (`maxJobs`, budget). The planner is the first
  agent, so any change to its prompt re-runs the whole workflow on resume.
- Every new arg goes into `KNOWN_ARGS`, the header comment, the README table, and
  `meta.whenToUse` if the invoking Claude needs to know when to pass it.
- Fail loudly: a narrow request never widens silently, and every cap or failure is
  counted into the report's coverage section.
- `meta` is a pure literal; its `phases` must match the `phase()` calls (a test checks).

## Rules for token-audit

- Node 22+ is the documented floor, but the code stays Node 20 compatible until something
  needs newer. Built-ins only, ESM. `transcript.mjs` and `attribute.mjs` stay pure (no
  filesystem, no output); only `locate.mjs` touches disk.
- The transcript format is internal to Claude Code. Read as few fields as possible,
  count what is skipped, and warn instead of guessing. After checking a newer release's
  transcripts, bump `TESTED_MAX_VERSION` in `transcript.mjs`.
- Default text output stays within 60 lines and 4 KB (a test checks): it lands in a
  model's context. Prompts are cut to 110 characters, commands to 90.
- Fixtures are synthetic. Never commit a real transcript or anything copied from one.
- A `--json` shape change is a deliberate act: update the snapshots with
  `UPDATE_SNAPSHOTS=1 node --test` and note it in the changelog.

## Rules for token-meter

- Load `/plugin-authoring` before editing it. The mods API is early access: the types file
  Claude Code writes for its version is the authority, not memory or older docs.
- Keep the `calls:` line of `claude plugin validate` free of `$.process`, `$.http`, `$.env`,
  `$.settings` and `$.model`, and of every `$.fs` call but `$.fs.read`. Reviewers and
  organization policy mods flag them. Figures come from `session.measure`, `$.session` and
  `turn.step`; `$.fs.read` opens only git's `HEAD` (and a worktree's `.git` file), because
  `$.session.repo()` has no branch. Never run git for it.
- `turn.step` and every other hook only observe: pass the event on unchanged.
- `$.ui.status` is for alerts only and is cleared otherwise. A `PromptHint` tail is never
  drawn while the user has a custom `statusLine` (checked on 2.1.296), so don't use it.
- State the band draws from lives in `$.state`, declared in `types/index.d.ts`; reload it in
  `classic.SessionStart` for `clear`, `resume` and `fork`.
- A value that must outlive that reset or the session (the user hiding the band) is also
  written to `$.store` and read back in the reload. The test kit's `$` has no `state` or
  `store` noun: seed `mock.store`, or hook `store.get`/`store.set` to read what was written.
- In a `Box` row, an empty string still takes a `columnGap`; leave an item out with `[]`.
- Type-check locally with TypeScript 5.4+: `npx -p typescript@5 tsc -p token-meter` works once a
  `claude --plugin-dir ./token-meter` session has written its gitignored `tsconfig.json`
  and `.claude-plugin/types/`.

## Releases

- Bump `version` in the plugin's `.claude-plugin/plugin.json` on every user-visible
  change, and add a `CHANGELOG.md` entry. Installed copies do not update otherwise.
  Never reuse a version string, including ones used before the first public commit:
  the cache directory is named after it, and a stale one can survive an install.
- review-kit: `SCRIPT_VERSION` in `review.js` moves with `plugin.json` (a test checks).
- Tag releases `review-kit-vX.Y.Z`, `token-audit-vX.Y.Z` or `token-meter-vX.Y.Z` with notes from
  the changelog.
- A remote entry moves only to a released tag: set `ref` to the tag and `sha` to its
  commit (`git ls-remote <url> 'refs/tags/<tag>^{}'`), sync the entry's display fields
  from that tag's `plugin.json`, never set `version` on the entry, and install it from a
  scratch `CLAUDE_CONFIG_DIR` before committing. The README's "Releasing a listed MCP
  plugin" section has the steps; `validate` does not fetch remote sources.
- Before any push, tag or release, check that no local path, private email or `docs/`
  content is in what goes out.

## CI

- Actions are pinned to full commit SHAs with a `# vX.Y.Z` comment; Dependabot bumps
  them. Never pin to a tag.
- `CLAUDE_CODE_VERSION` in `.github/workflows/ci.yml` is pinned and bumped by hand.
- The `remote-plugins` job installs every remote entry from a scratch config, checks that
  `ref` resolves to `sha`, and runs `validate --strict` on the fetched copy. It needs network
  access to the plugin repos but no model calls or login.
