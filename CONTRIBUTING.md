# Contributing to ai-tools

Thanks for your interest! Bug reports, feature requests and pull requests are all welcome.
For significant changes, please open an issue first so we can discuss the direction before
you invest time.

`kotlin-lib` and `oracle-forms` are developed in their own repositories
([kotlin-lib-mcp](https://github.com/aoreshkov/kotlin-lib-mcp),
[oracle-forms-mcp](https://github.com/aoreshkov/oracle-forms-mcp)); contribute to them
there. This repository holds `review-kit`, `token-audit` and `token-meter`, and the
marketplace that lists all five.

## Prerequisites

- Node 22 or later (Active or Maintenance LTS).
- Claude Code, for `claude plugin validate` and for trying the plugin.

## Checks

Run all six before every commit. CI runs the same commands, and also installs each
remote marketplace entry to check its pin. None of it calls the model.

```bash
node --test
claude plugin validate . --strict
claude plugin validate ./review-kit --strict
claude plugin validate ./token-audit --strict
claude plugin validate ./token-meter --strict
claude plugin test ./token-meter
```

To try your change in a session without installing: `claude --plugin-dir ./review-kit` (or
`./token-meter`, which reloads on every save).
The seeded-defect eval in the README measures what a real run finds; it calls the model,
so it is a manual check before a release, not something a pull request has to run.

## Project conventions

- `review-kit/workflows/review.js` is a workflow script: no filesystem, no Node APIs, and
  no `Date.now()`, `Math.random()` or argless `new Date()`, because they break resume.
  Dates come in through `args.today`.
- Every new workflow argument goes into `KNOWN_ARGS`, the script's header comment, the
  README's argument table, and `meta.whenToUse` when the invoking Claude must know when to
  pass it (for example, a value carried back from an earlier result).
- Fail loudly: a narrow request never widens silently, and every cap or failure is counted
  into the report's coverage section.
- `meta` is a pure literal, and its `phases` must match the `phase()` calls (a test checks).
- A user-visible change bumps `version` in `review-kit/.claude-plugin/plugin.json` and adds
  a `CHANGELOG.md` entry; installed copies do not update otherwise.

## Pull requests

1. Fork, create a topic branch from `main`.
2. Add tests in `test/review.test.mjs` for new behavior, and make sure the checks pass.
3. Use a clear title in imperative mood.
4. Describe user-visible changes in `CHANGELOG.md`.

## Reporting issues

Use the issue forms. For security vulnerabilities, **do not open a public issue**; see
[SECURITY.md](SECURITY.md).
