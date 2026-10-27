---
runs: 3
max_turns: 30
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep]
expected_outcome: review-report.md names all five seeded defects as confirmed findings and none of the four decoys.
---

Run a multi-lens code review of this whole repository and write the report to
review-report.md. Today is 2026-09-24. Keep it small: at most 8 module x lens reviewers,
and verify up to 8 findings per reviewer.
