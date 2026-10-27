---
type: regex
match: not_contains
pattern: '## Findings(?:(?!\r?\n## )[\s\S])*fixture/core/LatencyReport\.kt'
target:
  source: file
  path: review-report.md
---
