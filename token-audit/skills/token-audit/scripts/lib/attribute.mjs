// Attribution over parsed transcripts: per-call tokens, per-action split, result carry,
// categories, prompts and per-session totals. Pure: no filesystem, no output.

// Relative price weights (input, cache write, cache read, output). Relative, not dollars.
export const DEFAULT_WEIGHTS = Object.freeze({ in: 1, cw: 1.25, cr: 0.1, out: 5 })

// Tool results are estimated, not counted: characters / 3.5, and a fixed size per image.
export const CHARS_PER_TOKEN = 3.5
export const IMAGE_TOKENS = 1600

export const REPLY = '(reply / thinking)'
export const CATEGORIES = ['read/search', 'edit', 'build/test/wait', 'git', 'subagent', 'reply', 'other']

export function costEq(t, w = DEFAULT_WEIGHTS) {
  return t.in * w.in + t.cw * w.cw + t.cr * w.cr + t.out * w.out
}

export function sumUsage(usages) {
  const t = { calls: 0, in: 0, cw: 0, cr: 0, out: 0, total: 0 }
  for (const u of usages) {
    t.calls++
    t.in += u.in
    t.cw += u.cw
    t.cr += u.cr
    t.out += u.out
  }
  t.total = t.in + t.cw + t.cr + t.out
  return t
}

const contextOf = u => u.in + u.cw + u.cr

export function estimateTokens(result) {
  return result ? result.chars / CHARS_PER_TOKEN + result.images * IMAGE_TOKENS : 0
}

// ---------------------------------------------------------------------------------------
// Shell commands

const WORD = String.raw`(?:"[^"]*"|'[^']*'|\$\([^)]*\)|[^\s;&|]+)`
const ASSIGN = String.raw`[A-Za-z_]\w*=${WORD}?`
const PREFIXES = [
  new RegExp(String.raw`^(?:cd|pushd|Set-Location|sl)\s+${WORD}\s*(?:&&|;|\n)\s*`, 'i'),
  new RegExp(String.raw`^export\s+${ASSIGN}(?:\s+${ASSIGN})*\s*(?:&&|;|\n)\s*`),
  new RegExp(String.raw`^\$(?:env:)?\w+\s*=\s*${WORD}\s*(?:;|\n)\s*`, 'i'),
  /^\$\w+\s*=\s*/,
  new RegExp(String.raw`^(?:${ASSIGN}\s*)+(?:&&|;|\n)\s*`),
  new RegExp(String.raw`^(?:${ASSIGN}\s+)+`),
  /^&\s+/,
  /^\(\s*/,
]

// Strips leading comments, `cd x &&`, `export VAR=x &&`, `VAR=x &&`, `$env:VAR=x;`,
// `VAR=x cmd`, and PowerShell's `$v = x;`, `$v = ` and `&`, then splits the rest into words up to the first pipe
// or separator. A `for` loop is classified by the command in its body.
export function normalizeCommand(command) {
  let c = String(command || '').replace(/\\\r?\n/g, ' ').replace(/^(?:\s*#[^\n]*\n)+/, '').trim()
  for (let changed = true; changed;) {
    changed = false
    for (const p of PREFIXES) {
      const next = c.replace(p, '')
      if (next !== c) {
        c = next.trim()
        changed = true
      }
    }
  }
  const words = []
  const re = /"([^"]*)"|'([^']*)'|(\d*[<>]+&?\d*|\|\||&&|[|;&\n]|[^\s|;&<>"']+)/g
  for (let m; (m = re.exec(c));) {
    const w = m[1] ?? m[2] ?? m[3]
    if (m[3] && /^(?:\|\||&&|[|;&\n])$/.test(m[3])) break
    words.push(w)
  }
  const loop = words[0] === 'for' && /\bdo\s+([\s\S]*)/.exec(c)
  if (loop) return normalizeCommand(loop[1])
  const head = (words[0] || '').replace(/^.*[\\/]/, '').replace(/\.(?:exe|bat|cmd|sh)$/i, '')
  return { head, args: words.slice(1), text: c }
}

function gitSubcommand(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-C' || args[i] === '-c') i++
    else if (!args[i].startsWith('-')) return args[i]
  }
  return ''
}

// `:app:core:test` and `core:test` -> `:*:test`, so modules do not split one action.
const collapseTask = t => t.replace(/^:?(?:[\w.-]+:)+/, ':*:')

function gradleTasks(args) {
  const tasks = []
  for (const a of args) {
    if (/^\d*[<>]/.test(a)) break
    if (!a.startsWith('-') && !a.includes('=')) tasks.push(collapseTask(a))
    if (tasks.length === 2) break
  }
  return tasks.join(' ')
}

const inPlace = args => args.some(a => a === '--in-place' || /^-[\w]*i/.test(a))

export function commandKey(command) {
  const { head, args } = normalizeCommand(command)
  const h = head.toLowerCase()
  if (h === 'git') return ['git', gitSubcommand(args)].filter(Boolean).join(' ')
  if (h === 'gradlew' || h === 'gradle') return [h, gradleTasks(args)].filter(Boolean).join(' ')
  if (['npm', 'pnpm', 'yarn'].includes(h) && args[0] && !args[0].startsWith('-')) return `${h} ${args[0]}`
  if ((h === 'sed' || h === 'perl') && inPlace(args)) return `${h} -i`
  return head || '(empty)'
}

const SHELLS = new Set(['Bash', 'PowerShell'])

export function actionKey(tu) {
  const i = tu.input || {}
  if (SHELLS.has(tu.name)) return `${tu.name}: ${commandKey(i.command)}`
  if (tu.name === 'Agent' || tu.name === 'Task') return `Agent(${i.subagent_type || 'general-purpose'})`
  if (tu.name === 'Skill' && typeof i.skill === 'string') return `Skill(${i.skill})`
  return tu.name
}

// ---------------------------------------------------------------------------------------
// Categories

const TOOL_CATEGORY = {
  Edit: 'edit', MultiEdit: 'edit', Write: 'edit', NotebookEdit: 'edit',
  Read: 'read/search', Grep: 'read/search', Glob: 'read/search', LS: 'read/search', LSP: 'read/search',
  Agent: 'subagent', Task: 'subagent', Workflow: 'subagent',
}
const READ_COMMANDS = new Set([
  'cat', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'head', 'tail', 'find', 'fd', 'ls', 'dir', 'tree',
  'wc', 'less', 'more', 'tr', 'sort', 'uniq', 'cut', 'od', 'xxd', 'sed', 'awk', 'jq', 'file', 'stat', 'diff', 'type', 'findstr',
  'get-content', 'gc', 'select-string', 'sls', 'get-childitem', 'gci', 'get-item', 'test-path',
])
const BUILD_COMMANDS = new Set([
  'gradle', 'gradlew', 'mvn', 'mvnw', 'npm', 'npx', 'pnpm', 'yarn', 'cargo', 'go', 'make',
  'cmake', 'dotnet', 'pytest', 'tox', 'sbt', 'ant', 'docker', 'kotlinc', 'javac', 'java',
  'timeout', 'until', 'while', 'sleep', 'wsl', 'start-sleep', 'wait-process',
])
const EDIT_COMMANDS = new Set([
  'rm', 'mv', 'cp', 'mkdir', 'touch',
  'set-content', 'add-content', 'out-file', 'new-item', 'remove-item', 'move-item', 'copy-item',
])

// A heredoc whose output goes to a file: `cat > f <<EOF`, `cat <<'EOF' > f`, `tee f <<EOF`.
const HEREDOC_TO_FILE = /<<-?\s*['"]?\w+['"]?/
const REDIRECT_TO_FILE = /(?:^|[^\d&>])>>?\s*(?!&)["']?[\w./\\~$-]/

export function commandCategory(command) {
  const { head, args, text } = normalizeCommand(command)
  const h = head.toLowerCase()
  if ((h === 'cat' || h === 'tee') && HEREDOC_TO_FILE.test(text) && (h === 'tee' || REDIRECT_TO_FILE.test(text.split('\n')[0]))) return 'edit'
  if ((h === 'sed' || h === 'perl') && inPlace(args)) return 'edit'
  if (EDIT_COMMANDS.has(h)) return 'edit'
  if (h === 'git' || h === 'gh') return 'git'
  if (READ_COMMANDS.has(h)) return 'read/search'
  if (BUILD_COMMANDS.has(h)) return 'build/test/wait'
  return 'other'
}

export function categoryOf(tu) {
  if (SHELLS.has(tu.name)) return commandCategory(tu.input?.command)
  return TOOL_CATEGORY[tu.name] || 'other'
}

// What a tool use touched, for the largest-results table. Paths under the session's cwd
// are shown relative to it.
export function describe(tu, cwd) {
  const i = tu.input || {}
  let d
  if (SHELLS.has(tu.name)) d = i.command
  else if (i.file_path || i.notebook_path) d = i.file_path || i.notebook_path
  else if (tu.name === 'Grep') d = [i.pattern, i.path].filter(Boolean).join(' in ')
  else if (tu.name === 'Glob') d = [i.pattern, i.path].filter(Boolean).join(' in ')
  else if (i.description) d = i.description
  else if (i.url) d = i.url
  else if (i.query) d = i.query
  else d = JSON.stringify(i)
  d = String(d ?? '').replace(/\s+/g, ' ').trim()
  if (cwd) {
    const norm = s => s.replace(/\\/g, '/')
    const base = norm(cwd).replace(/\/$/, '') + '/'
    const nd = norm(d)
    const at = nd.toLowerCase().indexOf(base.toLowerCase())
    if (at >= 0) d = nd.slice(0, at) + nd.slice(at + base.length)
  }
  return d
}

// ---------------------------------------------------------------------------------------
// Sessions

// Usable calls: those with a usage block. Calls without one are counted by the parser.
const usable = parsed => parsed.calls.filter(c => c.usage)

// Totals of one session: its main transcript plus subagent transcripts.
export function sessionTotals(parsed, subagents = [], weights = DEFAULT_WEIGHTS) {
  const calls = usable(parsed)
  const main = sumUsage(calls.map(c => c.usage))
  const sub = sumUsage([...parsed.sidechain, ...subagents.flatMap(s => usable(s).map(c => c.usage))])
  const all = sumUsage([])
  for (const k of ['calls', 'in', 'cw', 'cr', 'out', 'total']) all[k] = main[k] + sub[k]
  return {
    main, sub, all,
    costEq: costEq(all, weights),
    peak: calls.reduce((m, c) => Math.max(m, contextOf(c.usage)), 0),
    compactions: parsed.stats.compactions,
    subagentTranscripts: subagents.length,
  }
}

const quantile = (values, p) => values.length ? values[Math.min(values.length - 1, Math.floor(p * (values.length - 1)))] : 0

export function analyzeSession(parsed, { weights = DEFAULT_WEIGHTS, subagents = [] } = {}) {
  const calls = usable(parsed)
  const totals = sessionTotals(parsed, subagents, weights)
  const main = totals.main
  const ctx = calls.map(c => contextOf(c.usage))
  const callTotal = c => contextOf(c.usage) + c.usage.out

  // Calls of each context segment end where the next compaction starts.
  const segmentEnd = new Map()
  for (const c of parsed.calls) segmentEnd.set(c.segment, c.idx + 1)

  const actions = new Map()
  const action = (key, category) => {
    let a = actions.get(key)
    if (!a) actions.set(key, (a = { key, category, uses: 0, tokens: 0, output: 0, resultTokens: 0, carry: 0 }))
    return a
  }
  for (const c of calls) {
    const parts = c.tools.length ? c.tools.map(t => [actionKey(t), categoryOf(t)]) : [[REPLY, 'reply']]
    const total = callTotal(c)
    for (const [key, category] of parts) {
      const a = action(key, category)
      a.uses++
      a.tokens += total / parts.length
      a.output += c.usage.out / parts.length
    }
  }

  const results = []
  for (const tu of parsed.toolUses.values()) {
    if (!tu.result) continue
    const tokens = estimateTokens(tu.result)
    const later = Math.max(0, (segmentEnd.get(tu.result.segment) ?? tu.result.callIdx) - tu.result.callIdx)
    const carry = tokens * later
    const a = action(actionKey(tu), categoryOf(tu))
    a.resultTokens += tokens
    a.carry += carry
    results.push({ key: actionKey(tu), tokens, carry, what: describe(tu, parsed.stats.cwd) })
  }

  const turnTotals = parsed.turns.map(t => ({ text: t.text, cut: t.cut, ts: t.ts, calls: 0, tokens: 0 }))
  for (const c of calls) {
    if (c.turn == null) continue
    turnTotals[c.turn].calls++
    turnTotals[c.turn].tokens += callTotal(c)
  }

  const byTokens = (a, b) => b.tokens - a.tokens
  return {
    totals,
    context: {
      compactions: parsed.stats.compactions,
      peak: totals.peak,
      avg: calls.length ? ctx.reduce((s, v) => s + v, 0) / calls.length : 0,
      profile: [0, 0.25, 0.5, 0.75, 1].map(p => quantile(ctx, p)),
    },
    parallelCalls: calls.filter(c => c.tools.length > 1).length,
    actions: [...actions.values()].filter(a => a.uses || a.resultTokens).sort(byTokens),
    results: results.sort((a, b) => b.carry - a.carry || b.tokens - a.tokens),
    turns: turnTotals.filter(t => t.calls).sort(byTokens),
    categories: categoryBreakdown(parsed),
    grand: main.total,
  }
}

export function categoryBreakdown(parsed) {
  const calls = usable(parsed)
  const agg = new Map(CATEGORIES.map(name => [name, { name, uses: 0, tokens: 0 }]))
  let grand = 0
  for (const c of calls) {
    const total = contextOf(c.usage) + c.usage.out
    grand += total
    const cats = c.tools.length ? c.tools.map(categoryOf) : ['reply']
    for (const name of cats) {
      const a = agg.get(name)
      a.uses++
      a.tokens += total / cats.length
    }
  }
  return [...agg.values()]
    .filter(a => a.uses)
    .map(a => ({ ...a, share: grand ? a.tokens / grand : 0 }))
    .sort((a, b) => b.tokens - a.tokens)
}
