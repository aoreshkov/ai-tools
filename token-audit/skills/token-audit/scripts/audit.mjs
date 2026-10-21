#!/usr/bin/env node
// token-audit: which Claude Code sessions, actions and prompts used the most tokens.
// Reads local session transcripts; Node 22+ (still runs on 20), built-ins only. Run with --help for usage.
//
// Exit codes: 0 ok, 1 usage error, 2 nothing found. --exit-zero reports errors on stdout
// and exits 0, for callers where a failing command aborts (skill `!` injection).

import path from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { parseTranscript, TESTED_MAX_VERSION, compareVersions } from './lib/transcript.mjs'
import { DEFAULT_WEIGHTS, analyzeSession, sessionTotals } from './lib/attribute.mjs'
import {
  AuditError, configDir, findSession, listSessions, projectForCwd, readLines, sessionFromPath, subagentFiles,
} from './lib/locate.mjs'
import { categoriesJson, categoriesText, rankJson, rankText, sessionJson, sessionText } from './lib/format.mjs'

const USAGE = `Usage:
  node audit.mjs rank       [--project <dir> | --session <id>] [--top N] [--json]
  node audit.mjs session    <id | id-prefix | path.jsonl> [--top N] [--json]
  node audit.mjs categories <id | id-prefix | path.jsonl> [--json]
Common options:
  --config-dir <dir>          Claude config dir (default: $CLAUDE_CONFIG_DIR, else ~/.claude)
  --weights in,cw,cr,out      relative cost weights (default 1,1.25,0.1,5)
  --include-subagents <bool>  add subagent transcripts to their session (default true)
  --exit-zero                 report errors on stdout and exit 0
Figures come from Claude Code's internal transcript format and are estimates.`

const DEFAULT_TOP = { rank: 5, actions: 8, results: 5, prompts: 5 }

export function run(argv, { env = process.env, cwd = process.cwd() } = {}) {
  const stdout = []
  const stderr = []
  let exitZero = argv.includes('--exit-zero')
  try {
    const opts = parseOptions(argv)
    exitZero = opts.exitZero
    if (opts.help) {
      stdout.push(USAGE)
      return { code: 0, stdout: stdout.join('\n'), stderr: '' }
    }
    const ctx = { ...opts, config: configDir(opts.configDir, env), cwd, warnings: [], versions: new Set(), bad: 0, noUsage: 0 }
    const result = COMMANDS[opts.command](ctx)
    stdout.push(result)
    stderr.push(...finishWarnings(ctx).map(w => `token-audit: warning: ${w}`))
    return { code: 0, stdout: stdout.join('\n'), stderr: stderr.join('\n') }
  } catch (e) {
    const known = e instanceof AuditError
    const message = `token-audit: ${known ? e.message : `internal error: ${e?.stack || e}`}`
    const code = known ? e.exitCode : 1
    if (exitZero) return { code: 0, stdout: message, stderr: '' }
    return { code, stdout: '', stderr: code === 1 && known ? `${message}\n\n${USAGE}` : message }
  }
}

function parseOptions(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        project: { type: 'string' },
        session: { type: 'string' },
        top: { type: 'string' },
        json: { type: 'boolean', default: false },
        'config-dir': { type: 'string' },
        weights: { type: 'string' },
        'include-subagents': { type: 'string', default: 'true' },
        'exit-zero': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })
  } catch (e) {
    throw new AuditError(e.message, 1)
  }
  const { values: v, positionals: [command, target, ...extra] } = parsed
  if (v.help) return { help: true, exitZero: v['exit-zero'] }
  if (!command) throw new AuditError('missing command', 1)
  if (!Object.hasOwn(COMMANDS, command)) throw new AuditError(`unknown command: ${command}`, 1)
  if (extra.length) throw new AuditError(`unexpected arguments: ${extra.join(' ')}`, 1)
  if (command === 'rank' && target) throw new AuditError('rank takes no positional argument; use --session or --project', 1)
  if (command !== 'rank' && !target) throw new AuditError(`${command} needs a session id or transcript path`, 1)
  // For session and categories, --project only says where to look for the id first.
  if (command !== 'rank' && v.session) throw new AuditError(`${command} takes the session as its argument, not --session`, 1)
  if (v.project && v.session) throw new AuditError('pass --project or --session, not both', 1)

  let top = null
  if (v.top != null) {
    if (!/^\d+$/.test(v.top) || +v.top < 1 || +v.top > 1000) throw new AuditError(`--top must be an integer 1..1000, got ${v.top}`, 1)
    top = +v.top
  }
  let weights = DEFAULT_WEIGHTS
  if (v.weights != null) {
    const w = v.weights.split(',').map(s => Number(s.trim()))
    if (w.length !== 4 || w.some(x => !Number.isFinite(x) || x < 0)) {
      throw new AuditError(`--weights takes four non-negative numbers in,cw,cr,out, got ${v.weights}`, 1)
    }
    weights = { in: w[0], cw: w[1], cr: w[2], out: w[3] }
  }
  const sub = String(v['include-subagents']).toLowerCase()
  if (!['true', 'false'].includes(sub)) throw new AuditError(`--include-subagents takes true or false, got ${v['include-subagents']}`, 1)

  return {
    command, target, top, weights, json: v.json, project: v.project, session: v.session,
    configDir: v['config-dir'], includeSubagents: sub === 'true', exitZero: v['exit-zero'],
  }
}

// ---------------------------------------------------------------------------------------

function load(ctx, file, options) {
  const parsed = parseTranscript(readLines(file), options)
  for (const v of parsed.stats.versions) ctx.versions.add(v)
  ctx.bad += parsed.stats.badLines
  ctx.noUsage += parsed.stats.noUsage
  return parsed
}

// A session with assistant records but no usable call means the format changed under us.
function unreadable(parsed) {
  return parsed.stats.assistantRecords > 0 && !parsed.calls.some(c => c.usage) && parsed.sidechain.length === 0
}

function loadSession(ctx, s) {
  const parsed = load(ctx, s.file)
  const subagents = ctx.includeSubagents ? subagentFiles(s.projectDir, s.id).map(f => load(ctx, f, { sidechain: true })) : []
  return { parsed, subagents }
}

function finishWarnings(ctx) {
  const w = [...ctx.warnings]
  const newest = [...ctx.versions].sort(compareVersions).pop()
  if (newest && compareVersions(newest, TESTED_MAX_VERSION) > 0) {
    w.push(`transcripts from Claude Code ${newest} are newer than the tested ${TESTED_MAX_VERSION}; figures may be wrong`)
  }
  if (ctx.bad) w.push(`${ctx.bad} unparsable transcript line(s) skipped`)
  if (ctx.noUsage) w.push(`${ctx.noUsage} assistant record(s) without usage data skipped`)
  return w
}

function resolveTarget(ctx) {
  const t = ctx.target
  if (t.endsWith('.jsonl') || t.includes('/') || t.includes('\\')) return sessionFromPath(path.resolve(ctx.cwd, t))
  const projectDir = ctx.project ? path.resolve(ctx.cwd, ctx.project) : projectForCwd(ctx.config, ctx.cwd).dir
  return findSession(ctx.config, t, projectDir)
}

function rank(ctx) {
  let projectDir
  let currentId = null
  if (ctx.session) {
    try {
      const s = findSession(ctx.config, ctx.session)
      projectDir = s.projectDir
      currentId = s.id
    } catch (e) {
      if (!(e instanceof AuditError) || e.exitCode !== 2) throw e
      // A new session may not have written its transcript yet.
      ctx.warnings.push(`no transcript for session ${ctx.session} yet; ranking the working directory's project`)
    }
  }
  if (!projectDir && ctx.project) projectDir = path.resolve(ctx.cwd, ctx.project)
  if (!projectDir) {
    const p = projectForCwd(ctx.config, ctx.cwd)
    if (p.warning) ctx.warnings.push(p.warning)
    projectDir = p.dir
  }
  const files = listSessions(projectDir)
  if (!files.length) throw new AuditError(`no session transcripts in ${projectDir}`, 2)

  const sessions = []
  const skipped = []
  for (const s of files) {
    const { parsed, subagents } = loadSession(ctx, { ...s, projectDir })
    if (unreadable(parsed)) {
      skipped.push({ id: s.id, reason: 'assistant records without usable usage data' })
      ctx.warnings.push(`session ${s.id}: ${parsed.stats.assistantRecords} assistant records but no usable usage data; transcript format may have changed`)
      continue
    }
    const totals = sessionTotals(parsed, subagents, ctx.weights)
    if (!totals.all.calls) continue
    sessions.push({ id: s.id, title: parsed.stats.title, first: parsed.stats.first, last: parsed.stats.last, totals, current: s.id === currentId })
  }
  if (!sessions.length) throw new AuditError(`no session in ${projectDir} has usable token data`, 2)
  sessions.sort((a, b) => b.totals.all.total - a.totals.all.total || a.id.localeCompare(b.id))
  sessions.forEach((s, i) => { s.rank = i + 1 })

  const grand = sessions.reduce((g, s) => ({
    total: g.total + s.totals.all.total, costEq: g.costEq + s.totals.costEq, sub: g.sub + s.totals.sub.total,
  }), { total: 0, costEq: 0, sub: 0 })
  const cur = sessions.find(s => s.current)
  const d = {
    project: path.basename(projectDir), weights: ctx.weights, sessions, skipped, grand,
    top: ctx.top ?? DEFAULT_TOP.rank,
    current: cur ? { id: cur.id, rank: cur.rank, total: cur.totals.all.total } : null,
    warnings: ctx.warnings,
  }
  return ctx.json ? JSON.stringify(rankJson({ ...d, warnings: finishWarnings(ctx) }), null, 2) : rankText(d)
}

function sessionData(ctx) {
  const s = resolveTarget(ctx)
  const { parsed, subagents } = loadSession(ctx, s)
  if (unreadable(parsed)) {
    throw new AuditError(`session ${s.id} has ${parsed.stats.assistantRecords} assistant records but no usable usage data; the transcript format may have changed`, 2)
  }
  if (!parsed.calls.length) throw new AuditError(`session ${s.id} has no API calls yet`, 2)
  return {
    id: s.id, title: parsed.stats.title, first: parsed.stats.first, last: parsed.stats.last,
    versions: parsed.stats.versions, weights: ctx.weights,
    analysis: analyzeSession(parsed, { weights: ctx.weights, subagents }),
    top: ctx.top ? { actions: ctx.top, results: ctx.top, prompts: ctx.top } : DEFAULT_TOP,
  }
}

function session(ctx) {
  const d = sessionData(ctx)
  return ctx.json ? JSON.stringify(sessionJson({ ...d, warnings: finishWarnings(ctx) }), null, 2) : sessionText(d)
}

function categories(ctx) {
  const d = sessionData(ctx)
  return ctx.json ? JSON.stringify(categoriesJson({ ...d, warnings: finishWarnings(ctx) }), null, 2) : categoriesText(d)
}

const COMMANDS = { rank, session, categories }

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, stdout, stderr } = run(process.argv.slice(2))
  if (stdout) process.stdout.write(`${stdout}\n`)
  if (stderr) process.stderr.write(`${stderr}\n`)
  process.exitCode = code
}
