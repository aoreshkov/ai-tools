## What & why

<!-- What does this PR change, and what problem does it solve? Link the issue if one exists. -->

## How was it tested?

<!-- Unit tests? A real /review-kit:review run? On which repository and Claude Code version? -->

## Checklist

- [ ] `node --test` passes
- [ ] `claude plugin validate . --strict` and `claude plugin validate ./review-kit --strict` pass
- [ ] `version` bumped in `review-kit/.claude-plugin/plugin.json` and `CHANGELOG.md` updated (user-visible changes only)
- [ ] New workflow arguments are in `KNOWN_ARGS`, the header comment and the README table, and in `meta.whenToUse` when the invoking Claude must know when to pass them
