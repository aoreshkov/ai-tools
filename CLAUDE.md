# ai-tools

A Claude Code plugin marketplace. Public on GitHub as `aoreshkov/ai-tools`.

## Layout

- `.claude-plugin/marketplace.json` - the marketplace. `review-kit` is a relative path;
  `kotlin-lib` and `oracle-forms` are `git-subdir` sources pinned (`ref` tag + `sha`
  commit) to releases of `aoreshkov/kotlin-lib-mcp` and `aoreshkov/oracle-forms-mcp`.
  Those repos own the plugins; this repo only points at them.
- `review-kit/` - the multi-lens review plugin.
  - `.claude-plugin/plugin.json` - manifest; `version` pins what installed copies get.
  - `workflows/review.js` - the dynamic workflow script (orchestration lives here).
  - `agents/{planner,reviewer,verifier,reporter}.md` - the four roles it spawns.
  - `evals/seeded-defects/` - `claude plugin eval` case: a scaffolded Kotlin repo with
    five known defects. Model calls; a manual pre-release gate, never CI. Defect scores
    count only when `workflow-completed` passes (see README).
- `test/review.test.mjs` - runs `review.js` against stubbed `agent()`, `pipeline()` and
  `parallel()`. No model calls.
- `scripts/seeded-defects-real-run.mjs` - runs the seeded-defects case as a real
  `claude -p` session with workflows on, for when `plugin eval` cannot start the workflow,
  and applies its graders. Model calls; manual, never CI. Keep it out of `test/`, where
  `node --test` would run it.
- `docs/` - private analysis and plans. Gitignored; never commit, reference or link it.

## Checks

Run all three before every commit (Node 20 or later).

```bash
node --test
claude plugin validate . --strict
claude plugin validate ./review-kit --strict
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

## Releases

- Bump `version` in `review-kit/.claude-plugin/plugin.json` on every user-visible change,
  and add a `CHANGELOG.md` entry. Installed copies do not update otherwise.
- Tag releases `review-kit-vX.Y.Z` with notes from the changelog.
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
