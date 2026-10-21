# Security Policy

## Supported versions

| Version                            | Supported |
| ---------------------------------- | --------- |
| Latest `review-kit` release (0.x)  | ✅        |
| Latest `token-audit` release (0.x) | ✅        |
| Latest `token-meter` release (0.x) | ✅        |
| Older releases                     | ❌        |

`kotlin-lib` and `oracle-forms` are developed in their own repositories; report issues
in them there ([kotlin-lib-mcp](https://github.com/aoreshkov/kotlin-lib-mcp/security),
[oracle-forms-mcp](https://github.com/aoreshkov/oracle-forms-mcp/security)). Report a
problem with how this marketplace lists or pins them here.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Instead, use GitHub's private vulnerability reporting: go to the repository's **Security**
tab → **Report a vulnerability** (or use
[this link](https://github.com/aoreshkov/ai-tools/security/advisories/new)).

You can expect an initial response within a few days. Please include reproduction steps,
the affected version, and the Claude Code version. Once a fix is released, the advisory
will be published with credit to the reporter (unless you prefer to stay anonymous).

## Scope notes

`review-kit` runs agents over the repository under review and one of them writes a file.
Reports about these are particularly relevant:

- Content in a reviewed repository that makes an agent follow it as instructions (prompt
  injection), for example to write outside the report path or to suppress findings.
- A report path (`out`) or planner output that reaches outside the repository.
- A marketplace entry whose `ref`/`sha` pin can be made to install something other than
  the released plugin.

`token-audit` reads the session transcripts under your Claude config directory and prints
prompt snippets, titles and commands from them into a model's context. Reports about
these are particularly relevant:

- A path, session id or `--project` value that makes the script read outside the Claude
  config directory or the folder it was given.
- Transcript text that reaches the model as instructions rather than data, or that breaks
  out of the output's size limits.

`token-meter` is a mod: it runs inside Claude Code with your permissions. It reads only
git's `HEAD` (and a worktree's `.git` file), keeps only whether its band is hidden in its
own plugin store, runs no process and makes no network call. Reports about these are
particularly relevant:

- Any file read beyond those, any other write, or any process or network access.
- A hook that changes the event it handles instead of passing it on unchanged.
