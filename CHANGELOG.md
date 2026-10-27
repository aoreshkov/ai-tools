# Changelog

## review-kit 0.3.0

- **Version collision.** A pre-release build had used the version strings 0.2.x, and
  Claude Code names a plugin's cache directory after its version. So an install of the
  released 0.2.2 could keep the older directory and run code that refused `model`,
  `effort` and `verifyOnly`. 0.3.0 is above every earlier string. The README's
  Requirements give the recovery steps for a 0.2.x install.
- Every result, `ok: false` included, carries `version`, and the log's first line names
  it. The report header names it too. A test keeps the script's version equal to
  `plugin.json`.
- New argument `previous`: an earlier result's `continuation`, passed unchanged.
  - One run reviews the pairs left (capped or blocked), re-verifies the findings left
    unverified next to that review, and carries the confirmed ones.
  - The report states combined coverage, for example "coverage: 62 of 62 (12 in an
    earlier run)", and lists the pairs earlier runs reviewed. Before this, a continuation
    reported only its own pairs, and findings left unverified were lost.
  - Continuations chain through `coverage.reviewedPairs` and
    `coverage.priorReviewedPairs`.
  - A continuation carries a digest, and one that changed on the way stops the run as
    `bad-args`.
  - `previous` cannot be combined with `plan`, `carry`, `verifyOnly`, `mode`, `since`,
    `changed`, `modules`, `lenses` or `verify`. With it, `pairs: []` only re-verifies.
  - `plan`, `pairs`, `carry` and `verifyOnly` work as before.
- Every result that can be continued carries `next`, the caller's instructions for the
  relaunch, including a needs-confirmation stop.
  - `whenToUse` drops those instructions and is 1,172 characters with `description`,
    down from 1,986. The skill listing cut the old entry at about 1,536 characters, so
    the `verifyOnly` instructions never reached a caller. A test keeps the entry under
    1,400.
  - `whenToUse` now asks for `out` in the repository's ignored documents folder.
- Every run logs the report path, and says so when it is the default at the repository
  root.
- The reporter gets compact JSON, and its confirmed findings arrive in candidate groups
  (same file, within 5 lines). It still decides every merge.
- README: Claude Code 2.1.305 or later (reliable resume of multi-agent pipeline items),
  tested on 2.1.311; keep the machine awake during long runs; same-session continuation
  by `resumeFromRunId`.
- CI pins Claude Code 2.1.311.

## Marketplace: kotlin-lib 1.0.0

- `kotlin-lib` moves from 0.4.0 (`aoreshkov/kotlin-lib-mcp` v0.7.0) to 1.0.0 (v0.9.1),
  pinned to that tag and its commit.
- It runs the server on a JDK 25 or later instead of Docker. On first use the plugin
  downloads the released server and checks its checksum. Its options are `java`, for a
  `java` executable that is not on `PATH`, and `server_version`.
- Libraries are cached in the OS cache directory, not the `kotlin-lib-mcp-cache` Docker
  volume, so each library is fetched once more after the update.
- New in the server since v0.7.0: deprecations in the index and `diff_api` for public-API
  changes between two versions.
- The entry's description and the README requirement say so.

## Marketplace: oracle-forms 1.4.0

- `oracle-forms` moves from 1.2.0 (`aoreshkov/oracle-forms-mcp` v0.13.0) to 1.4.0
  (v0.16.0), pinned to that tag and its commit.
- It now needs a JDK 25 or later, up from 21. A new `java` option takes the path to a
  `java` executable that is not on `PATH`.
- The entry's description and the README requirement say so.

## token-meter 0.2.2

- A failed repository read during a branch refresh is logged to the debug log and keeps
  the branch last read, instead of being dropped silently and clearing the branch.
- A failed read of the hidden setting is logged, and the band stays as it is instead of
  coming back after the user hid it.
- A failed effort write in `turn.step` is logged instead of dropped. The request still
  goes on unchanged.
- The debug lines no longer name the plugin themselves: Claude Code already prefixes it.
- Tests: a failing store write and read, a failing repository read, and a measurement
  that cannot be read, each with its debug line.

## review-kit 0.2.2

- A reporter that answers `written: false` has its `detail` kept on one line and bounded
  in `reportError` and the log, as 0.2.1 already promised. Only a thrown error was.
- A planner error is kept on one line and bounded in the log and in `detail`, like every
  other cause.
- A verify-only report says that the earlier run's coverage gaps are not available to it
  and are in that run's own result, instead of guessing where they are recorded.
- `scripts/seeded-defects-real-run.mjs`: a failed scaffold deletes the scratch workspace
  (unless `--keep`) and leaves no empty results folder.

## token-audit 0.2.2

- A record whose `timestamp` is not an ISO date and time is counted in one warning and
  left out, as a malformed `version` already was. Its first characters went straight
  into the `started` and `when` columns and the session header, newlines and escapes
  included.
- `--json` titles and action names lose control, C1 and bidi characters, as prompts and
  commands already did. `JSON.stringify` escapes only C0 controls.
- Subagent usage written into a parent transcript without a message id is counted in the
  subagent and session totals instead of being dropped.
- The `--json` shape is unchanged.

## review-kit 0.2.1

- A run whose reporter gave no answer (skipped, or died on an API error) now says so in
  `reportError`, as the planner and verifiers already did, so `report: null` always comes
  with a cause. A reporter error is kept on one line and bounded, like every other cause.
- Tests: each invalid-argument case checks the start of its own message, so a deleted
  check can no longer pass on another message that mentions the same key.
- `scripts/seeded-defects-real-run.mjs`: `result.json` sets `defectScoresCount` to false,
  and records `claudeFailed`, when the session did not finish cleanly, as the exit code
  already did. On Windows a timeout ends claude's whole process tree, not only the
  `cmd.exe` of an npm shim, and the run settles even if a process still holds its pipes.

## token-meter 0.2.1

- `/token-meter` and the once-a-minute refresh are set up before the band's figures are
  loaded, so a failed usage read at startup no longer leaves the session without them.
- A failed usage read or state write in any hook is logged to the debug log, and the
  rest of the hook still runs: after `/clear`, `/resume` and `/branch`, the branch is
  still read. The idle branch refresh can no longer leave an unhandled rejection.
- Tests: the figures-after-reset check runs once per source on a fresh state, so a source
  dropped from the filter fails it.

## token-audit 0.2.1

- Titles, prompts and commands lose terminal escape sequences, other control characters
  and bidi controls before they are printed, in text and in `--json`. Copied from a
  transcript, they could recolour or rewrite lines in a terminal, or reorder what a
  reader sees. Emoji joined with a zero-width joiner stay whole.
- A cut prompt always ends in `...`. One whose 111th character was a space, or whose text
  lost a control character, was shown as complete.
- A record whose `version` is not a version number (unbounded, or with newlines or
  escapes) is counted in one warning and left out of the version check, instead of being
  printed in the session header or the newer-than-tested warning.
- Checked against Claude Code 2.1.308 transcripts (was 2.1.306).
- The `--json` shape is unchanged.

## token-audit 0.2.0

- A transcript that cannot be read (deleted between listing and reading, locked, no
  permission) no longer aborts `rank` with a stack trace: that session is skipped and
  named with its error code. `session` and `categories` report it as
  `cannot read <file>: <code>` and exit 2.
- Skipped sessions get one summary warning instead of one each, and text output names the
  first five and counts the rest. `--json` still lists every one.
- `--project` also takes a project's working directory, mapped to its transcripts folder
  under `<config>/projects/`, with a warning naming the folder used. `--help` says so.
- `session` prints `output share of cost-eq (main session)`, under the weights in use, and
  the skill's output rule reads that figure instead of doing its own arithmetic over
  figures that mixed main and subagent tokens.
- A prompt longer than the 110-character snippet now ends in `...`, in text and in
  `--json` (`prompts[].text`); the JSON shape is unchanged.
- Titles, prompts and commands are cut at grapheme boundaries and to their width in UTF-8
  bytes too, so CJK or emoji text keeps output within 4 KB and never leaves half a
  character.
- `--weights` rejects empty parts (`1,,0.1,5` used to read as a weight of 0).
- Checked against Claude Code 2.1.306 transcripts; the newer-version warning now starts
  after 2.1.306.

## token-meter 0.2.0

- Hiding the band is kept until `/token-meter show`: through `/clear`, `/resume` and
  `/branch`, which reset the session's state and used to bring the band back, and in later
  sessions. It is stored under `hidden` in the mod's own `$.store`, the only thing it
  writes.
- Token counts round before they pick a unit, so 999,500 tokens read `1.0M`, not `1000k`.
- Tests for `session.start` (the `/token-meter` command, its failure path, and the
  once-a-minute refresh of the branch and reset times), the band's colours and token
  counts, and that `session.measure` and `classic.SessionStart` pass their results on
  unchanged.

## review-kit 0.2.0

- A `pairs` run now reports the plan's coverage facts itself: lenses whose `appliesTo`
  names no planned module, `appliesTo` names that match no module, modules no lens
  applies to, and in an incremental run the changed files only those modules hold. The
  run it continues may have stopped at `needs-confirmation`, which writes no report, so
  these facts used to reach no report at all.
- New `coverage.unselectedPairs`: the applicable pairs a `pairs` run left out, kept apart
  from `cappedPairs`. When the run carries an earlier run's findings, the report says
  those pairs may be covered by that run.
- New `coverage.failureCauses`: one entry per distinct cause, with the pairs it blocked
  or the findings it left unverified. A reviewer that threw, returned nothing or replied
  without a findings list, and a verifier that failed, now say why, so a bad `agents`,
  `model` or `effort` override no longer fails silently. Unverified findings whose verifier
  failed carry `verifyError`, and each cause is logged once.
- The planner-unavailable message names the agent type that was tried, and mentions
  `agentPrefix` only when the prefix built that name.
- The `workflow-completed` eval grader no longer depends on the order of `ok`, `mode` and
  `report` in the result, and its test now uses the result the script really returns.
- `scripts/seeded-defects-real-run.mjs` prints claude's exit code, a spawn error or a
  timeout, and exits 1 on any of them whatever the graders say. It passes the prompt on
  stdin and runs an npm `.cmd` shim through a shell on Windows.

## token-meter 0.1.0

New plugin in the marketplace, from this repository. It is a mod and needs Claude Code
2.1.287 or later, in a terminal or the Desktop app.

- A band above the prompt with the folder, the git branch (the short commit when
  detached, a worktree's own branch in a worktree), the model (`Opus 5.5`, not the raw ID)
  and the effort, context use as a bar, percentage and tokens over the window, each rate-limit
  window with the time to its reset, and the session's cost once it has one.
- An alert line under the prompt (`⚠ token-meter: context 92%, 7d limit 95%`) only while
  context or a limit is at 90% or more, cleared when it drops.
- Figures come from Claude Code's `session.measure` event and `$.session`, and the effort
  from each main-thread model request, which is passed on unchanged. The branch comes from
  reading git's `HEAD` file after each response and once a minute. No other files, and no
  processes, network, environment, settings or model calls.
- The band gives way to surveys, narrows on small terminals, comes back with its figures
  after `/clear`, `/resume` and `/branch`, and is hidden or shown with its `hide` button
  or `/token-meter hide|show`.
- Tests with Claude Code's test kit (`claude plugin test ./token-meter`), offline and with
  no model calls, for the terminal and the Desktop app.

### Repository

- CI pins Claude Code 2.1.296 (was 2.1.294), the version the mod was written and tested
  against, and runs `claude plugin validate ./token-meter --strict` and
  `claude plugin test ./token-meter`.

## token-audit 0.1.0

New plugin in the marketplace, from this repository.

- `/token-audit:token-audit` ranks the current project's sessions by total tokens
  (with cost-eq, calls, output, cache write/read and subagent share). It then breaks the
  top 3, or a session you name, down by action, largest tool result, costliest prompt and
  category, and ends with recommendations, each tied to a number in the output.
- Runs as a forked skill that waits for its result, so the audit's own reading stays out
  of the conversation. The ranking is injected before the skill starts. The only
  pre-approved command is the bundled `node` script.
- `audit.mjs rank | session | categories` also runs on its own, with `--json`,
  `--top`, `--weights`, `--include-subagents`, `--config-dir` and `--exit-zero`. Exit
  codes: 0 ok, 1 usage error, 2 nothing found.
- Responses split over several transcript records are counted once. Shell commands are
  keyed and categorised by their leading command after `cd`, `export` and variable
  prefixes. Result carry stops at a compaction, and images count a fixed 1,600 tokens.
- Defensive about the internal transcript format: unparsable lines and records without
  usage are counted and reported, a session with no usable data fails loudly, and
  transcripts newer than the tested Claude Code version (2.1.296) raise a warning.
- Default text output stays within 60 lines and 4 KB. Prompts are cut to 110 characters
  and commands to 90.
- Tests over synthetic transcripts (`node --test`), with no model calls.

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
