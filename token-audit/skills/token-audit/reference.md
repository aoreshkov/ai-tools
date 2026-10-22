# token-audit reference

What each figure in the script's output means, and where it is only an estimate.

## Source

Claude Code writes one JSONL transcript per session to
`<config>/projects/<project>/<session-id>.jsonl` (`<config>` is `CLAUDE_CONFIG_DIR`, else
`~/.claude`), and subagent transcripts under `<project>/<session-id>/`. The format is
internal to Claude Code and may change in any release, so the script reads few fields,
skips what it cannot parse, and warns when transcripts come from a newer Claude Code than
it was tested with. Transcripts older than `cleanupPeriodDays` (30 days by default) are
deleted, so the ranking covers only what is still on disk.

## Figures

| Figure | Meaning |
|---|---|
| call | One API response. A response is split over several transcript records with the same message id; it is counted once. |
| total | Input + cache write + cache read + output tokens, from the API's usage data. Exact, not estimated. |
| context | Input + cache write + cache read of one call: what the model read to make it. |
| cost-eq | Tokens weighted by relative price: input 1, cache write 1.25, cache read 0.1, output 5 by default (`--weights` changes them). For comparing sessions, not dollars. |
| output share of cost-eq (main session) | Output tokens x the output weight, over the cost-eq of the main transcript, subagents left out on both sides. Follows `--weights`. |
| sub | Share of a session's tokens spent in subagents (their transcripts plus sidechain records). |
| round-trip tokens | An action's share of the call that issued it. A call that issued three tool uses gives each a third; a call with none is `(reply / thinking)`. |
| ~result | Estimated size of the tool result: characters / 3.5, plus 1,600 per image. |
| ~carry | ~result x the number of later calls in the same context segment. A compaction ends the segment. It approximates how often a result was re-read. |
| prompt tokens | Total of the calls between one user prompt and the next. Prompts show as 110-character snippets; one ending in `...` was cut. |
| parallel | Calls that issued more than one tool use. |
| compactions | Context compactions (`/compact` or automatic) in the session. |

## Categories

From the tool name, and for shell commands from the leading command after `cd`,
`export`, and variable assignments are stripped:

| Category | Tools and commands |
|---|---|
| read/search | Read, Grep, Glob, LSP; `cat`, `grep`, `rg`, `sed` (not `-i`), `head`, `tail`, `find`, `ls`, `wc`, `Get-Content`, ... |
| edit | Edit, Write, NotebookEdit; `sed -i`, `perl -i`, heredoc to a file, `rm`, `mv`, `cp`, `Set-Content`, ... |
| build/test/wait | `gradle(w)`, `mvn`, `npm`, `cargo`, `go`, `make`, `docker`, `java`, `timeout`, `until`, `while`, `sleep`, `wsl`, ... |
| git | `git`, `gh` |
| subagent | Agent, Workflow |
| reply | Calls with no tool use |
| other | Everything else, including MCP tools and scripts (`python`, `node`) |

## Locating a project

`rank` takes the working directory's project by default. `--project` names another: its
transcripts folder, `<config>/projects/<name>`, or its working directory, which is mapped to
that folder (the warning says which folder was used). A transcript that cannot be read is
skipped and named, with its error code; text output names the first five and counts the
rest, and `--json` lists them all.

## Limits

- Result sizes and carry are estimates; totals are not.
- Titles, prompts, commands and action names are shown without terminal escapes, control
  characters or bidi controls, in text and in `--json`, so they cannot recolour, rewrite or
  reorder the output. A timestamp that is not an ISO date and time is counted in a warning
  and left out.
- Only this machine's transcripts. For ongoing or team-wide tracking, Claude Code's
  OpenTelemetry export (`claude_code.token.usage`, `api_request` and `tool_result`
  events) is the supported source; `/usage` shows billing figures.
