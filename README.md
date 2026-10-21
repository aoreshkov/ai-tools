# ai-tools

Claude Code plugins for Kotlin/JVM work and Oracle Forms modernization, published as one
plugin marketplace.

## Plugins

| Plugin                          | What it does                                                                 | Needs                         | Lives in                                                               |
| ------------------------------- | ---------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| [`review-kit`](#review-kit)     | Multi-lens code review as a dynamic workflow                                 | Dynamic workflows turned on   | this repository                                                        |
| [`token-audit`](#token-audit)   | Ranks past sessions by token use and shows which actions and prompts drove it | Node 22+ on `PATH`           | this repository                                                        |
| [`token-meter`](#token-meter)   | A live band above the prompt: folder, branch, model, effort, context, limits, cost | Claude Code 2.1.287+          | this repository                                                        |
| [`kotlin-lib`](#kotlin-lib)     | MCP server and skills that read the real sources of any Maven Kotlin/Java library | Docker                   | [aoreshkov/kotlin-lib-mcp](https://github.com/aoreshkov/kotlin-lib-mcp)     |
| [`oracle-forms`](#oracle-forms) | MCP server and a skill that read Oracle Forms modules (`.fmb`, `.mmb`, `.pll`, `.olb`) | A JDK 21+ on `PATH`     | [aoreshkov/oracle-forms-mcp](https://github.com/aoreshkov/oracle-forms-mcp) |

`kotlin-lib` and `oracle-forms` are developed and released in their own repositories. This
marketplace points at a released tag of each, so it serves only released versions.

## Install

Add the marketplace once, then install the plugins you want:

```bash
claude plugin marketplace add aoreshkov/ai-tools
claude plugin install review-kit@aoreshkov-ai-tools
claude plugin install token-audit@aoreshkov-ai-tools
claude plugin install token-meter@aoreshkov-ai-tools
claude plugin install kotlin-lib@aoreshkov-ai-tools
claude plugin install oracle-forms@aoreshkov-ai-tools
```

In a session, `/plugin marketplace add aoreshkov/ai-tools` and `/plugin install` do the same.
`oracle-forms` asks for your forms directory on install.

### Updates

Background auto-update is off for third-party marketplaces until you turn it on: open
`/plugin`, go to **Marketplaces**, select `aoreshkov-ai-tools`, and select **Enable
auto-update**. Without it, run `/plugin marketplace update aoreshkov-ai-tools` in a session,
or `claude plugin update <plugin>@aoreshkov-ai-tools` in your shell.

### Installed from a plugin's own repository before?

`kotlin-lib-mcp` and `oracle-forms-mcp` each still publish a one-plugin marketplace with
the same plugin, so `kotlin-lib@kotlin-lib-mcp` and `kotlin-lib@aoreshkov-ai-tools` are two
separate installs. Keep only one: two installs start two copies of the same MCP server.
To move to this marketplace:

```bash
claude plugin uninstall kotlin-lib@kotlin-lib-mcp
claude plugin install kotlin-lib@aoreshkov-ai-tools
```

Library caches (the `kotlin-lib-mcp-cache` Docker volume) and Oracle Forms annotations (in
the OS cache directory) live outside the plugin, so they carry over. `oracle-forms`
downloads its server again and asks for its settings again, because both belong to the
install.

## kotlin-lib

Gives Claude the published sources jar of any Maven Kotlin/Java library, parsed with the
Kotlin Analysis API: resolved signatures, KDoc, the dependency tree, version diffs and
source search, instead of what the model remembers. The plugin runs the server's Docker
image and adds skills that make Claude reach for it, plus `/kotlin-lib:api`,
`/kotlin-lib:migrate` and a setup helper.

Documentation, tools and other ways to run it (release zip, IntelliJ, VS Code):
[kotlin-lib-mcp](https://github.com/aoreshkov/kotlin-lib-mcp) and its
[plugin README](https://github.com/aoreshkov/kotlin-lib-mcp/blob/main/plugin/README.md).

## oracle-forms

Serves the Oracle Forms modules in a directory, so Claude can read blocks, items, triggers,
program units and decoded PL/SQL without Forms Builder, and keep durable notes on them. On
first use the plugin downloads the released server and checks its checksum. The bundled
`trace-form` skill teaches the order to trace a screen in.

Documentation, configuration and the `.mcpb` bundle for Claude Desktop:
[oracle-forms-mcp](https://github.com/aoreshkov/oracle-forms-mcp) and its
[plugin README](https://github.com/aoreshkov/oracle-forms-mcp/blob/main/plugins/oracle-forms/README.md).

## review-kit

A multi-lens code review that runs as a [dynamic workflow](https://code.claude.com/docs/en/workflows).
One planner agent decides which modules and which review lenses fit the repository in
front of it; a fan-out of read-only reviewers each takes a single lens over a single
module; every finding is then handed to an adversarial verifier that tries to refute it;
what survives is deduplicated, ranked, and written to one report.

Lenses are data, not agent definitions. The plugin ships a default catalog (architecture,
source sets, Compose, concurrency, security, tests, dependencies, platform code, error
handling, API surface) and the planner selects from it, so a non-KMP project gets a
different set from the same plugin.

### Requirements

- Claude Code with [dynamic workflows](https://code.claude.com/docs/en/workflows) turned
  on (on Pro, the Dynamic workflows row in `/config`). Developed and tested on 2.1.281;
  the agents use `omitClaudeMd` (v2.1.271+) and a per-agent cache TTL (v2.1.248+).
- For a run to wait out a usage limit instead of failing: v2.1.271 or later, in an
  interactive session signed in with a claude.ai subscription.

To try it from a local checkout without installing:

```bash
claude --plugin-dir ./review-kit
```

### Use

```text
/review-kit:review
```

The workflow takes optional arguments — ask for them in your own words, or pass them
directly:

| Argument          | Default              | What it does                                            |
| ----------------- | -------------------- | ------------------------------------------------------- |
| `mode`            | `full`               | `full` or `incremental`                                  |
| `since`           | `HEAD~1`             | Incremental only: baseline git ref                       |
| `changed`         | —                    | Incremental only, required: repo-relative changed paths  |
| `today`           | —                    | Date string; workflow scripts cannot call `new Date()`   |
| `out`             | `review-report.md`   | Report path, repo-relative — add it to `.gitignore`      |
| `modules`         | all                  | List of module names, for a narrow run                   |
| `lenses`          | all                  | List of lens ids                                         |
| `maxJobs`         | `12`, or from budget | Cap on module × lens reviewers; see [Before a capped run](#before-a-capped-run) |
| `verify`          | `true`               | `false` skips verification; findings report as unconfirmed |
| `maxVerifyPerJob` | `2`                  | Adversarial checks per reviewer; the rest report as unverified |
| `agents`          | plugin agents        | Per-role agent overrides, e.g. `{ reviewer: "my:reviewer" }` |
| `agentPrefix`     | `review-kit:`        | Namespace for the default agents; `""` when they live in `.claude/agents/` |
| `model`           | each agent's own     | Model alias or full ID for every role (`"opus"`), or per role (`{ reviewer: "haiku" }`); see [Choosing models and effort](#choosing-models-and-effort) |
| `effort`          | each agent's own     | `low` to `max` for every role, or per role (`{ verifier: "max" }`) |
| `plan`            | —                    | A previous result's `plan`; skips the planner and keeps module names stable |
| `pairs`           | —                    | `"lens @ module"` labels to run, e.g. a previous result's `coverage.cappedPairs` |
| `carry`           | —                    | A previous result's `confirmed`; reported as carried, not re-verified |
| `verifyOnly`      | —                    | A previous result's `unverified`; verifies only those, no review |

Examples:

```text
Run /review-kit:review on just the :core module
Run /review-kit:review in incremental mode since origin/main
Run /review-kit:review with haiku reviewers and verifiers at max effort
```

#### Choosing models and effort

By default each role runs on the model and effort its agent file sets:

| Role     | Model    | Effort   |
| -------- | -------- | -------- |
| planner  | `opus`   | `high`   |
| reviewer | `sonnet` | `medium` |
| verifier | `opus`   | `high`   |
| reporter | `opus`   | `medium` |

`model` and `effort` change that for one run. Each takes either form:

- A string runs every role on it: `model: "opus"`, `effort: "low"`.
- An object keyed by role (`planner`, `reviewer`, `verifier`, `reporter`) changes only the
  roles it names: `model: { reviewer: "haiku" }`, `effort: { verifier: "max" }`.

A `model` value is anything `--model` accepts: an alias (`sonnet`, `opus`, `haiku`,
`fable`, `opus[1m]`) or your provider's model name (a full ID such as `claude-opus-5-5`, a
Bedrock inference profile ARN, a Foundry deployment). `inherit`, `default` and `opusplan`
are refused: none of them names a model a single agent can run on. A family alias resolves
to your session's exact model when the session is in that family; pass a full ID to pin a
version. An `effort` value is `low`, `medium`, `high`, `xhigh` or `max`; which levels
apply depends on the model.

The script passes both on each agent call. Claude Code ranks a per-call model above the
agent's frontmatter and `CLAUDE_CODE_SUBAGENT_MODEL`, but `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`
still wins over it, and an `availableModels` allowlist that blocks the model substitutes
another and warns in `/workflows`. A per-call effort overrides the frontmatter `effort`,
and `CLAUDE_CODE_EFFORT_LEVEL` still wins over both. Checked on 2.1.296: a full model ID,
the `haiku` and `sonnet` aliases, and every override's effort (including `max` on Haiku)
reached their agents, and a role with no override kept its frontmatter values. Each
agent's transcript records them as `requestedModel` and `effort`.

Every agent in a role gets the same model and effort, so the fan-out still shares one
prompt-cache prefix. A run without `model` or `effort` passes neither, and each agent's
own settings apply. Keep both the same when you continue or resume a run:
changing one re-runs the first agent it touches and every agent after it. The report's
header names what was set, and an override for a role the run never starts (the planner
when you pass `plan`, the reviewer in a `verifyOnly` run, the verifier with `verify:
false`) is logged rather than refused.

Cheaper reviewers find less. Verification catches what a weaker reviewer gets wrong, not
what it misses, so lower the reviewer model or effort for a quick pass, not for a release
gate.

#### Incremental runs

Claude computes the diff before launching the workflow — `git diff --name-only
<since>...HEAD` plus uncommitted and untracked files — and passes it as `changed`. No
review agent has a shell. The script, not the planner, assigns each changed file to the
modules whose paths contain it, reviews only those modules, and lists any changed file
that no module covers as a coverage gap.

#### Before a capped run

A workflow cannot ask you anything once it is running. So when more module × lens pairs
apply than the default cap of 12 runs, and you gave neither `maxJobs` nor a token budget,
the run stops after planning, before any reviewer starts. It returns
`reason: "needs-confirmation"` with the pairs it would run (`wouldRun`) and skip
(`wouldSkip`), and Claude asks you: run them all, keep the cap, or pick pairs. It then
relaunches with that result's `plan`, so the planner does not run again.

Passing `maxJobs` yourself, or setting a token budget, is that choice made up front: the
run never stops to ask. Do that in non-interactive runs (`claude -p`), where nobody can
answer.

#### Continuing a run

Every result returns the `plan` it reviewed. To finish a capped run, ask Claude to rerun
the skipped pairs; it passes the previous result's `plan`, its `coverage.cappedPairs` as
`pairs`, and its `confirmed` as `carry`. The planner does not run again, so module names
and reviewer prompts match the first run, only the listed pairs are reviewed, and the new
report keeps the earlier confirmed findings, marked as carried from an earlier run. A
carried finding that this run checks again is settled by this run's verdict.

Planner prompts never contain `maxJobs` or the budget, so resuming a run with a higher
cap reuses the cached plan instead of replanning from scratch.

#### Verifying what was left unverified

Each reviewer gets `maxVerifyPerJob` verifier checks (default 2); the findings past that
are reported under Unverified. When a run ends with unverified findings, Claude asks
whether to verify them. If you say yes, it relaunches with the previous result's
`unverified` as `verifyOnly`, its `plan` and its `confirmed` as `carry`. No planner or
reviewer runs: every listed finding goes to a verifier, and the new report holds the
newly confirmed findings next to the carried ones. A `verifyOnly` run reviews nothing, so
it refuses the arguments that shape a review (`mode`, `modules`, `lenses`, `pairs`,
`maxJobs`, `verify`, `maxVerifyPerJob`, `since`, `changed`). Its report does not repeat
the earlier run's coverage gaps.

#### Token budget

With a turn budget set (for example `+500k` in your prompt) and no `maxJobs`, the fan-out
is sized to fit inside it, at roughly 25k output tokens per module × lens job, and the
run logs the number it chose. The budget is a hard ceiling, so pass `maxJobs` yourself if
the estimate proves wrong for your repo.

#### It fails loudly, not quietly

A run stops with a named reason rather than producing a reassuring empty report:
arguments that are not an object, contain an unknown key (`maxjobs` for `maxJobs`), or
give a known key a value of the wrong type (`modules: "core"` for `["core"]`, `maxJobs:
"4"`, `since` or `changed` without `mode: "incremental"`), the plugin's agents not resolving, a planner that returned nothing, a supplied `plan`
with no usable module or lens, a `modules`/`lenses`/`pairs` subset that matches nothing
in the repo, a lens set that applies to no module, or an
incremental run with no `changed` list or no changed file inside the selected modules. A
narrow request never silently widens into a full sweep.

If the reporter itself fails, the run still returns every finding and says why no file
was written.

#### Coverage is reported, never implied

The fan-out is capped, agents can be blocked before they start, and verification is
budgeted per reviewer. Every one of those limits is counted and written into the report's
coverage section, so a partial run reads as a partial run. So are requested modules,
lenses and pairs that matched only in part: the run reviews what matched and names the
rest as never reviewed. A reviewer reply that cannot be read counts as a failed pair.
Planner output is held to the same standard: paths that point outside the repository,
modules or lenses dropped as unusable (no name, no paths, no focus, an `appliesTo` that
is not a list, or a name, id, title or path containing a control character such as a
newline), and lenses whose `appliesTo` names no planned module are all listed, as is
every `appliesTo` name that matches no module. So is a selected module that no selected
lens applies to, a requested lens that applies to none of the selected modules, and, in
an incremental run, the changed files that only such modules hold. Each agent also has a
`maxTurns` cap; one that hits it without an answer is counted as blocked.

A `pairs` run reports all of these facts itself, because the run it continues may have
stopped at `needs-confirmation`, which writes no report. It also lists the applicable
pairs it left out (`coverage.unselectedPairs`), apart from the capped ones; when it carries
an earlier run's findings, the report says those pairs may be covered by that run.
Every blocked pair and every finding whose verifier failed keeps its cause, and
`coverage.failureCauses` groups them, one entry per distinct cause with the pairs or
findings it hit. A bad `agents`, `model` or `effort` override therefore says what went
wrong instead of blocking every pair without a word.

Verification is counted the same way. A verdict that neither confirms nor refutes a
finding reports it as unverified (`verifier-inconclusive`), not as checked. A finding the
verifier re-graded keeps the reviewer's grade as `claimedSeverity` next to the verified
`severity`. An unverified or carried copy of a finding this run settled is counted as
superseded, apart from the lens-merged duplicates.

Text from the reviewed repository is fenced and labelled wherever it reaches an agent.
The reporter, the only role that can write, gets the planner's summary, every module,
lens and path name in the coverage facts, and every field of every finding as data. The
verifier gets the reviewer's whole claim the same way, location and lens included. The
planner and the reviewer get the changed file names fenced. The reviewer gets the
planner's lens focus and module notes marked as planner-written: they say what to look
for and never change its rules. Fenced text never contains `>>>`, so quoted repository
text cannot close its fence early. Every role treats repository content as material
under review, never as instructions, and a reviewer reports text that tries to steer the
review as a finding whatever its lens. A reviewer finding with no title, file or
integer line, or with a file containing a control character, is dropped and counted in
coverage, so a run's `confirmed` can always be passed back as `carry`.

#### One run is a sample, not a sweep

Each reviewer is a single model pass, and two runs over the same code can find different
things. In testing, a real defect found by one run was missed by the next, and verifiers
refuted about two thirds of what reviewers raised. A clean report is not proof that a
defect is absent. For code that matters, run the lens that matters twice, or continue a
run over its capped pairs, rather than reading one empty section as a clean bill.

### Permissions

The planner, reviewers and verifiers only read (`Read`, `Grep`, `Glob`, and `LSP` where a
language server is installed), and those need no approval inside the working directory. The reporter writes one file. For a run that
never stops to ask, add to the project's `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Skill(review-kit:review)",
      "Workflow(review-kit:review)",
      "Edit(/review-report.md)"
    ]
  }
}
```

`Workflow(review-kit:review)` approves this one workflow by name; there is no need to
allow every workflow with a bare `Workflow`. Claude often starts it through the
`review-kit:review` skill, which `Skill(review-kit:review)` approves. On 2.1.296, a `-p`
run with only the `Workflow` rule had that skill call denied. The session then reviewed
the code by calling the agents itself, without the workflow's caps or coverage counts.
The leading `/` in `Edit(/review-report.md)` anchors the path at the project root, where
the settings file lives. Adjust it if you pass `out`. The `Workflow` and `Edit` rules
were checked in a `claude -p --permission-mode default` run on 2.1.281. Without the
`Workflow` rule, `-p` refuses to launch the workflow, and without the `Edit` rule, the
run returns its findings with `report: null`.

Project rules apply only once the workspace is trusted, so open it interactively once
before relying on them in `-p` runs. In an interactive session the first launch asks for
approval, and "don't ask again" has the same effect as the rule.

### Cost notes

- Reviewers run on a mid-tier model, verification and synthesis on a stronger one. Each
  agent's frontmatter pins a model *family* (`sonnet`, `opus`), so every agent in a role
  resolves to the same model and the fan-out shares one prompt-cache prefix. A family
  alias resolves to your session's exact model when the session is in the same family,
  and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` overrides it entirely. For exactly
  reproducible runs, pass `model` with full model IDs (see
  [Choosing models and effort](#choosing-models-and-effort)).
- A full sweep runs for longer than the five-minute default prompt-cache lifetime, so
  the reviewer and verifier set `experimental.cacheTtl: 1h` in their frontmatter (v2.1.248
  or later). Claude Code ignores `1h` while a subscription is on usage credits. On older
  versions, `"subagentPromptCacheTtl": "1h"` in your settings does the same job.
- The reporter only formats verified data, so it skips loading your CLAUDE.md files.
- Start narrow. One module, or `maxJobs` at 4, tells you what a full sweep will cost.
- The caps bound the worst case at `maxJobs * (1 + maxVerifyPerJob) + 2` agents — 38 at
  the defaults. Typical runs are well under that, since most reviewers return few
  findings and only findings get verified. Real full runs have used 20–30 agents and
  1.5–1.8M subagent tokens, which is past the point (more than 25 agents or 1.5M tokens)
  where Claude Code shows a `Large workflow` warning. On Pro, where the default size
  guideline is `small`, expect to see it; it is advisory, and `maxJobs: 4` stays well
  below it.
- Run full sweeps in one long-lived interactive session. A workflow resumes only within
  the session that started it, and only an interactive session signed in to a
  subscription waits out a usage limit; `-p` and scheduled runs simply die at the limit.

## token-audit

Answers "which sessions, actions and prompts used the most tokens in this project?" from
the session transcripts Claude Code keeps on your machine. It ranks the project's sessions
by total tokens. For the costliest it shows the actions behind the cost (by the round-trip
tokens of the calls that issued them), the tool results re-read most often, the prompts
that drove the most calls, and a read/edit/build/git split. It then turns those numbers
into a few concrete habits to change.

```text
/token-audit:token-audit              top sessions, then the top 3 broken down
/token-audit:token-audit 10           top 10, then the top 3 broken down
/token-audit:token-audit 3f2a9c1e     one session, by id or id prefix
```

Asking "which sessions burned the most tokens here?" works too. The skill runs in a forked
subagent, so the audit's own reading stays out of your conversation and only the summary
comes back. The forked context starts small; running the audit inside a long session would
re-read that session's context on every step, the very cost it measures.

### What the numbers are

- Totals per call come from the API's usage data in the transcript, so they are exact.
  Each response is counted once even though the transcript splits it over several records.
- `cost-eq` weights tokens by relative price (input 1, cache write 1.25, cache read 0.1,
  output 5). It is for comparing sessions; for billing figures use `/usage` or the Console.
- Tool-result sizes and their carry (size times the later calls that re-read the result,
  until a compaction) are estimates, marked `~`.
- Subagent transcripts count toward the session that started them.

Definitions are in [`reference.md`](token-audit/skills/token-audit/reference.md).

### Limits

- **The transcript format is internal to Claude Code** and may change in any release.
  The script reads as few fields as it can, skips and counts what it cannot parse, fails
  a session loudly rather than reporting zero, and warns when transcripts come from a
  newer Claude Code than it was tested with.
- Only transcripts still on disk count: Claude Code deletes them after
  `cleanupPeriodDays` (30 days by default).
- One machine, one project at a time. For ongoing or team-wide tracking, use Claude Code's
  [OpenTelemetry export](https://code.claude.com/docs/en/monitoring-usage), the supported
  structured source.

### Permissions

The skill pre-approves exactly one command, `node "<skill dir>/scripts/audit.mjs" …`,
for Bash and for PowerShell. It runs nothing else, and the script only reads under your
Claude config directory (`CLAUDE_CONFIG_DIR`, else `~/.claude`). It writes nothing.

The script also runs on its own:

```bash
node token-audit/skills/token-audit/scripts/audit.mjs rank --top 10
node token-audit/skills/token-audit/scripts/audit.mjs rank --project ~/work/other-repo
node token-audit/skills/token-audit/scripts/audit.mjs session <id> --json
node token-audit/skills/token-audit/scripts/audit.mjs --help
```

`--project` takes a project's working directory or its transcripts folder under
`<config>/projects/`.

## token-meter

Keeps the session's figures in view in a band above the prompt:

```text
ai-tools ⎇ main  Opus 5.5 high  ctx ░░░░░░░░░░ 5% 48k/1.0M  5h 43% ↻3m  7d 32% ↻3d21h  $0.12  hide
```

- The folder (`root/…/folder` once the session moves below where it started), the git
  branch (the short commit when detached), the model, and the reasoning effort.
- Context use as a bar, a percentage and tokens over the window: green below 70%, yellow
  up to 90%, red from 90%.
- Each rate-limit window with the time to its reset (claude.ai Pro and Max, or a Claude
  apps gateway's spend limit).
- The session's cost, once it has one.

While context or a limit is at 90% or more, an alert line also shows under the prompt,
such as `⚠ token-meter: context 92%`, and it clears when the figure drops. The `hide`
button or `/token-meter hide` hides the band; `/token-meter show` brings it back. Hiding
is kept until you show the band again: through `/clear`, `/resume` and `/branch`, and in
later sessions.

It sits beside a custom [status line](https://code.claude.com/docs/en/statusline), not in
place of one: your status line still renders, and the alert line sits between it and the
prompt. Narrow terminals drop the bar, the token counts and the reset times, and shorten
long branch names.

### Requirements and limits

- Claude Code 2.1.287 or later, in a terminal or the Code tab of the Desktop app. It is a
  [mod](https://code.claude.com/docs/en/plugins/mods/overview): it draws nothing in the VS
  Code chat panel, in `claude -p` or in cloud sessions.
- Mods are early access, and their API may change in any Claude Code release.
- Until the first response, context reads `ctx --`. The effort appears with the first
  request, because the mod reads it from the request rather than from your settings. Rate
  limits show from the start.
- The branch is read again after each response and once a minute, so a checkout made
  outside the session can take up to a minute to show.
- It does not run under `--safe-mode` or `disableAllHooks`, in a folder you have not
  trusted, or where an organization allows only its own mods (`allowManagedModsOnly`).

### Permissions

A mod runs inside Claude Code with your permissions. `claude plugin validate
./token-meter` lists what this one handles and calls:

```text
hooks: session.start, classic.SessionStart{source=clear|resume|fork}, session.measure,
       turn.step, command.run{command=token-meter}, ui.render{component=AbovePrompt}
calls: $.clock.every, $.clock.now, $.command.register, $.fs.read, $.session.cwd,
       $.session.model, $.session.repo, $.session.root, $.session.usage, $.state.get,
       $.state.set, $.store.get, $.store.set, $.ui.invalidate, $.ui.log, $.ui.resolve,
       $.ui.status
```

The one file it reads is git's `HEAD`: `$.fs.read` opens `.git/HEAD` in the nearest
repository folder at or above the working directory, or, in a worktree, the `HEAD` its
`.git` file points to. Outside a git repository it reads nothing. The only thing it keeps
is whether the band is hidden, under `hidden` in its own `$.store`, which Claude Code holds
as a JSON file of the plugin's under your Claude configuration directory. It writes no
other files, starts no processes (git included), makes no network requests, reads no environment
variables or settings, and calls no model. `turn.step` sees each model request so the band
can show its effort, and passes every request on unchanged.

## Development

### Checks

The workflow script is tested with no model calls: `test/review.test.mjs` runs it
against stubbed `agent()`, `pipeline()` and `parallel()` and checks the plan, the caps,
the verification partition, and every fail-loud path. It needs Node 22 or later. CI runs
the same commands on every pull request and every push to `main`, with no model calls.

```bash
node --test
claude plugin validate . --strict
claude plugin validate ./review-kit --strict
claude plugin validate ./token-audit --strict
claude plugin validate ./token-meter --strict
claude plugin test ./token-meter
```

`token-meter` is tested with Claude Code's own test kit: `claude plugin test` loads the mod
the way a session does, fires measurements and model requests at it, and draws its band
for the terminal and the Desktop app, offline and with no model calls. Its test file is
`.test.tsx` so that `node --test` leaves it alone. To try a change in a session, run
`claude --plugin-dir ./token-meter` from this repository; saving a file reloads the mod.

`token-audit`'s script is tested the same way, over small synthetic transcripts in
`test/fixtures/token-audit/`: parsing, attribution, locating sessions, exit codes, the
output budget, and snapshots of the `--json` shapes. After an intended shape change,
refresh the snapshots with `UPDATE_SNAPSHOTS=1 node --test`. After changing the skill's
description, check that a plain question still invokes it (model calls, so manual):

```bash
claude plugin eval ./token-audit --ablation none
```

A seeded-defect eval in `review-kit/evals/seeded-defects` measures what a real run
finds. It builds a two-module Kotlin repo with five known defects, runs one small review,
and checks that each defect is in the report's confirmed `## Findings` section. The
prompt allows 8 reviewers and 5 verified findings per reviewer. Three of the defects
share a module and need different lenses to find, and the planner usually adds a third
module for the build files. At 4 reviewers, real runs reviewed that module through only
one lens and found 2 or 3 of the 5. At the default verification budget of 2, a found
defect could be left unverified and fail its grader. It calls the model, so it is a
manual pre-release check, not CI:

```bash
claude plugin eval ./review-kit --scaffold --ablation none --allow-tools Workflow Write
```

`--ablation none` skips the no-plugin baseline, which says little about a workflow that
only exists in the plugin. One run is a sample (see above), so compare changes over
several runs, not one.

Eval runs load none of your settings. On Pro, where dynamic workflows are off until
`/config` turns them on, the workflow therefore cannot start inside the eval. A case can
set only `EVAL_*` variables, and on 2.1.296 `CLAUDE_CODE_WORKFLOWS=1` in your shell does
not reach the eval session either. The session then calls the plugin's agents one by
one itself, so the defect graders can still pass. Read a run's defect scores only when
`workflow-completed` passed: it requires the workflow's own result, with the report
written, in the session trace. `workflow-used` only shows that the call was made, which
is also true of a call that failed.

Where the eval cannot start the workflow, run the same case as a real session instead:

```bash
node scripts/seeded-defects-real-run.mjs
```

It builds the scaffold in a scratch directory and runs the case's prompt through
`claude -p`. Workflows are turned on with `CLAUDE_CODE_WORKFLOWS=1`, your user settings
are left out, and the plugin comes from this checkout. It then applies the case's
graders. Results go to `review-kit/evals/results/real-run-<time>/`, and the script needs
`bash` for the scaffold. A run takes about 90 seconds and costs about a dollar. Pass
`--keep` to keep the scratch directory.

Release notes are in [CHANGELOG.md](CHANGELOG.md). To contribute, see
[CONTRIBUTING.md](CONTRIBUTING.md); to report a vulnerability, see [SECURITY.md](SECURITY.md).


### Releasing a listed MCP plugin

`kotlin-lib` and `oracle-forms` entries in `.claude-plugin/marketplace.json` use
`git-subdir` sources pinned to a release: `ref` names the tag, and `sha` names the commit
it points at, so a moved or deleted tag cannot change what users install. After tagging a
release in the plugin's repository:

1. Bump the plugin's `version` in its own `plugin.json` before tagging. Users get a new
   copy only when that string changes.
2. Point the entry at the new release. `ref` takes the tag; `sha` takes the commit, not
   the annotated tag object:

   ```bash
   git ls-remote https://github.com/aoreshkov/kotlin-lib-mcp.git 'refs/tags/v0.8.0^{}'
   ```

3. Copy any changed display field (`displayName`, `description`, `license`, and `keywords`
   into `tags`) from the plugin's `plugin.json` to its entry. For a remote source, users see
   only the entry's fields until they install.
4. Install from a scratch config directory, so your own settings stay untouched, and check
   that the plugin and its MCP server load:

   ```bash
   CLAUDE_CONFIG_DIR="$(mktemp -d)" sh -c '
     claude plugin marketplace add ./ &&
     claude plugin install kotlin-lib@aoreshkov-ai-tools &&
     claude plugin details kotlin-lib'
   ```

   `claude plugin validate` does not fetch remote sources, so a wrong `path`, `ref` or
   `sha` shows up only here. CI's `remote-plugins` job repeats this for every remote entry:
   it checks that `ref` still resolves to `sha`, installs the entry, and runs
   `validate --strict` on the fetched copy. It does not start the MCP server, so still
   check `claude plugin details` by hand.

Never put `version` on these entries: `plugin.json` already sets it, and it would win
anyway.

## Licence

`review-kit`, `token-audit`, `token-meter` and this repository: MIT. `kotlin-lib` and
`oracle-forms`: Apache-2.0, in their own repositories.
