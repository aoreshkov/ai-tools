// Runs the seeded-defects eval case as a real `claude -p` session with dynamic
// workflows on, then applies the case's graders to the result.
//
// `claude plugin eval` cannot do this today: it loads no user settings, accepts
// only EVAL_* keys in `execution.env`, and does not pass CLAUDE_CODE_WORKFLOWS
// to its session, so on a plan where workflows default off the eval session has
// no Workflow tool and calls the agents itself. This script runs the same case
// with CLAUDE_CODE_WORKFLOWS=1 and none of your user settings.
//
// It calls the model: a manual pre-release check, never CI. Node 22 or later,
// and `bash` (Git Bash on Windows) for the scaffold script.
//
//   node scripts/seeded-defects-real-run.mjs [--keep]
//
// The trace, the report and the grader results land in
// review-kit/evals/results/real-run-<time>/ (gitignored). The scratch
// workspace is deleted afterwards unless --keep is passed.

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = join(ROOT, 'review-kit')
const CASE = join(PLUGIN, 'evals', 'seeded-defects')
const KEEP = process.argv.includes('--keep')

// ------------------------------------------------------------- the case --

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  return m ? { head: m[1], body: m[2] } : { head: '', body: text }
}

function scalar(head, key) {
  const m = head.match(new RegExp('^' + key + ':\\s*(.*)$', 'm'))
  if (!m) return undefined
  const v = m[1].trim()
  // YAML single quotes: backslashes are literal, '' is one quote.
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'")
  return v
}

const promptFile = frontmatter(readFileSync(join(CASE, 'prompt.md'), 'utf8'))
const PROMPT = promptFile.body.trim()
const MAX_TURNS = Number(scalar(promptFile.head, 'max_turns')) || 30
const TIMEOUT_S = Number(scalar(promptFile.head, 'timeout_seconds')) || 1800
const KILL_GRACE_MS = 10_000

const graders = readdirSync(join(CASE, 'graders'))
  .filter(f => f.endsWith('.md'))
  .sort()
  .map(f => {
    const { head } = frontmatter(readFileSync(join(CASE, 'graders', f), 'utf8'))
    const type = scalar(head, 'type')
    const g = { name: f.replace(/\.md$/, ''), type }
    if (type === 'regex') {
      g.pattern = new RegExp(scalar(head, 'pattern'))
      g.target = scalar(head, 'target') === 'trace' ? 'trace' : head.match(/^\s+path:\s*(.+)$/m)[1].trim()
    } else if (type === 'file_exists') {
      g.path = scalar(head, 'path')
    } else if (type === 'tool_used') {
      g.tool = scalar(head, 'tool')
      g.inputMatch = new RegExp(scalar(head, 'input_match') || '')
    } else {
      throw new Error(f + ': grader type ' + type + ' is not supported by this script')
    }
    return g
  })

// ------------------------------------------------------------- the run --

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const OUT = join(PLUGIN, 'evals', 'results', 'real-run-' + stamp)
// Outside review-kit/: writes inside a --plugin-dir are refused as sensitive.
const WORK = mkdtempSync(join(tmpdir(), 'review-kit-real-run-'))

console.log('workspace: ' + WORK)
const scaffold = spawnSync('bash', [join(CASE, 'scaffold.sh').replace(/\\/g, '/')], { cwd: WORK, stdio: 'inherit' })
if (scaffold.status !== 0) {
  console.error('scaffold failed (exit ' + scaffold.status + (scaffold.error ? ', ' + scaffold.error.message : '') + ')')
  // Nothing ran, so no results folder was made; the workspace goes as it would after a run.
  if (KEEP) console.error('workspace kept: ' + WORK)
  else rmSync(WORK, { recursive: true, force: true })
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })

// The prompt goes in on stdin, not as an argument: it has newlines, which a
// `.cmd` shim run through cmd.exe would split.
const claudeArgs = [
  '-p',
  '--plugin-dir', PLUGIN,
  // None of your user settings, as in an eval: no hooks, no default mode, no
  // enableWorkflows. Workflows come from the environment variable below.
  '--setting-sources', 'project',
  '--permission-mode', 'acceptEdits',
  // The workflow is offered to the model as a skill too; `-p` denies either
  // call without a rule.
  '--allowedTools', 'Workflow(review-kit:review)', 'Skill(review-kit:review)',
  '--max-turns', String(MAX_TURNS),
  '--output-format', 'stream-json',
  '--verbose',
]

// On Windows, `claude` is either the native claude.exe or an npm `.cmd` shim.
// Node spawns an .exe directly, but a .cmd or .bat only through a shell, and
// with a shell it joins the arguments unescaped, so the command line is built
// here from fixed, quoted arguments.
function claudeCommand(args) {
  if (process.platform !== 'win32') return { file: 'claude', args, shell: false }
  const dirs = (process.env.PATH || '').split(';').filter(Boolean)
  for (const ext of ['.exe', '.cmd', '.bat']) {
    const found = dirs.map(d => join(d, 'claude' + ext)).find(p => existsSync(p))
    if (!found) continue
    if (ext === '.exe') return { file: found, args, shell: false }
    const quote = a => '"' + a.replace(/"/g, '""') + '"'
    return { file: [found, ...args].map(quote).join(' '), args: [], shell: true }
  }
  return { file: 'claude', args, shell: false }
}

console.log('running claude -p (up to ' + TIMEOUT_S + 's, ' + MAX_TURNS + ' turns)...')
const started = process.hrtime.bigint()
const trace = await new Promise(done => {
  const command = claudeCommand(claudeArgs)
  const child = spawn(command.file, command.args, {
    cwd: WORK,
    env: { ...process.env, CLAUDE_CODE_WORKFLOWS: '1' },
    shell: command.shell,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let out = ''
  let err = ''
  let spawnError = ''
  let timedOut = false
  let settled = false
  const timer = setTimeout(() => {
    timedOut = true
    err += '\n[timed out after ' + TIMEOUT_S + 's]'
    stop()
  }, TIMEOUT_S * 1000)
  // On Windows, kill() would end only the process Node started: cmd.exe for a
  // .cmd shim, with claude as its child. taskkill /T ends the whole tree. A
  // process left holding the pipes would keep 'close' from firing, so after
  // the kill the run settles on 'exit', or after a grace period at the latest.
  const stop = () => {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill()
    }
    child.on('exit', finish)
    setTimeout(() => finish(null), KILL_GRACE_MS).unref()
  }
  const finish = code => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    done({ text: out, stderr: err, code, spawnError, timedOut })
  }
  // A spawn failure may emit 'error' without a 'close', so either one settles.
  child.on('error', e => {
    spawnError = e.message
    err += String(e) + '\n'
    finish(null)
  })
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { err += d })
  child.stdin.on('error', () => {})
  child.stdin.end(PROMPT)
  child.on('close', finish)
})
const seconds = Number((process.hrtime.bigint() - started) / 1000000000n)

writeFileSync(join(OUT, 'trace.jsonl'), trace.text)
if (trace.stderr.trim()) writeFileSync(join(OUT, 'stderr.txt'), trace.stderr)
// A run that did not finish cleanly fails the script whatever the graders
// say: a killed or crashed session can still leave a report that passes them.
const claudeFailed = trace.code !== 0 || trace.timedOut || !!trace.spawnError

// ----------------------------------------------------------- grading --

const messages = trace.text.split('\n').flatMap(line => {
  try { return [JSON.parse(line)] } catch { return [] }
})
const init = messages.find(m => m.type === 'system' && m.subtype === 'init')
const final = messages.filter(m => m.type === 'result').pop()
const toolUses = messages.flatMap(m =>
  Array.isArray(m.message?.content) ? m.message.content.filter(b => b.type === 'tool_use') : [])

// An eval trace carries a finished workflow's result inline. stream-json only
// names the task's output file, so read each one and grade the trace with
// those results appended.
const taskOutputs = messages
  .filter(m => m.type === 'system' && m.subtype === 'task_notification' && m.output_file)
  .map((m, i) => {
    const text = existsSync(m.output_file) ? readFileSync(m.output_file, 'utf8') : ''
    if (text) writeFileSync(join(OUT, 'task-' + (i + 1) + '-' + m.task_id + '.output'), text)
    return text
  })
const traceText = [trace.text, ...taskOutputs].join('\n')

function grade(g) {
  if (g.type === 'file_exists') {
    const ok = existsSync(join(WORK, g.path))
    return { ok, why: g.path + (ok ? ' exists' : ' is missing') }
  }
  if (g.type === 'tool_used') {
    const calls = toolUses.filter(t => t.name === g.tool && g.inputMatch.test(JSON.stringify(t.input)))
    return { ok: calls.length > 0, why: g.tool + ' called ' + calls.length + 'x with matching input' }
  }
  const file = g.target === 'trace' ? null : join(WORK, g.target)
  const text = file ? (existsSync(file) ? readFileSync(file, 'utf8') : '') : traceText
  const ok = g.pattern.test(text)
  return { ok, why: (ok ? 'matched in ' : 'no match in ') + (file ? g.target : 'trace') }
}

const results = graders.map(g => ({ name: g.name, ...grade(g) }))
if (existsSync(join(WORK, 'review-report.md'))) copyFileSync(join(WORK, 'review-report.md'), join(OUT, 'review-report.md'))

const completed = results.find(r => r.name === 'workflow-completed')
const summary = {
  claudeExit: trace.code,
  timedOut: trace.timedOut,
  spawnError: trace.spawnError || undefined,
  seconds,
  costUsd: final?.total_cost_usd,
  workflowToolAvailable: !!init?.tools?.includes('Workflow'),
  passed: results.filter(r => r.ok).length,
  total: results.length,
  claudeFailed,
  // The same rule as the exit code: a session that did not finish cleanly
  // measures nothing, whatever the graders say
  defectScoresCount: !claudeFailed && !!completed?.ok,
  graders: results,
}
writeFileSync(join(OUT, 'result.json'), JSON.stringify(summary, null, 2))

console.log('')
console.log('claude exit ' + trace.code +
  (trace.timedOut ? ' (timed out after ' + TIMEOUT_S + 's)' : '') +
  (trace.spawnError ? ' (could not start: ' + trace.spawnError + ')' : ''))
if (claudeFailed) console.log('claude did not finish cleanly; see stderr.txt. The grader results below do not count.')
console.log('Workflow tool available: ' + (summary.workflowToolAvailable ? 'yes' : 'NO'))
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name.padEnd(22) + r.why)
console.log('')
console.log(summary.passed + '/' + summary.total + ' graders passed in ' + seconds + 's' +
  (summary.costUsd !== undefined ? ', $' + summary.costUsd.toFixed(2) : '') + '.')
if (!summary.defectScoresCount) {
  console.log((claudeFailed ? 'claude did not finish cleanly' : 'workflow-completed failed') +
    ', so the found-* results do not measure the workflow.')
}
console.log('results: ' + OUT)

if (KEEP) console.log('workspace kept: ' + WORK)
else rmSync(WORK, { recursive: true, force: true })

process.exit(!claudeFailed && summary.passed === summary.total ? 0 : 1)
