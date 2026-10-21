// Pure helpers: no `$`, so tests import them directly.
import type { SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'
import type { Meter } from '../types'

export const ALERT_AT = 90
export const WARN_AT = 70

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

export type Figures = { context: SessionContextUsage; rateLimits: SessionRateLimit[]; cost?: SessionCost }

export const toMeter = (f: Figures): Meter => ({
  percent: f.context.percent ?? null,
  tokens: f.context.tokens ?? null,
  window: f.context.window,
  usd: f.cost?.usd ?? null,
  limits: f.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt ?? null })),
})

export const label = (kind: string): string => LABELS[kind] ?? kind

export const level = (pct: number): 'success' | 'warning' | 'error' =>
  pct >= ALERT_AT ? 'error' : pct >= WARN_AT ? 'warning' : 'success'

export const bar = (pct: number, width = 10): string => {
  const filled = Math.min(width, Math.max(0, Math.floor((pct * width) / 100)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// Rounded before the unit is picked, so 999,500 reads 1.0M and never 1000k.
export const tokens = (n: number): string => {
  const k = Math.round(n / 1000)
  return k >= 1000 ? `${(n / 1_000_000).toFixed(1)}M` : `${k}k`
}

const base = (path: string): string => path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? path

// The folder's name, led by the project root's when the session has moved below it.
export const place = (cwd: string, root: string): string => {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(cwd) === norm(root) || !norm(cwd).startsWith(norm(root) + '/')
    ? base(cwd)
    : `${base(root)}/…/${base(cwd)}`
}

// `claude-opus-5-5` reads as `Opus 5.5`, with ` 1M` for a `[1m]` context and any date
// suffix dropped; an ID of another shape is shown as it is.
export const modelName = (id: string): string => {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?(\[1m\])?$/i.exec(id)
  if (m === null) return id
  const [, family = '', major, minor, wide] = m
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}${wide ? ' 1M' : ''}`
}

// Time until an ISO reset, from a clock reading in milliseconds.
export const until = (resetsAt: string, nowMs: number): string => {
  const m = Math.max(0, Math.floor((Date.parse(resetsAt) - nowMs) / 60_000))
  if (m >= 1440) return `${Math.floor(m / 1440)}d${Math.floor((m % 1440) / 60)}h`
  if (m >= 60) return `${Math.floor(m / 60)}h${m % 60}m`
  return `${m}m`
}

// The alert line's text, or undefined when nothing has crossed ALERT_AT.
export const alertText = (m: Meter): string | undefined => {
  const parts: string[] = []
  if (m.percent !== null && m.percent >= ALERT_AT) parts.push(`context ${m.percent}%`)
  for (const l of m.limits) {
    if (l.percentUsed >= ALERT_AT) parts.push(`${label(l.kind)} limit ${Math.round(l.percentUsed)}%`)
  }
  return parts.length > 0 ? parts.join(', ') : undefined
}

// The branch a HEAD file names, or the commit's first 7 characters when HEAD is detached.
export const branchOf = (head: string): string | null => {
  const text = head.trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(text)
  if (ref !== null) return ref[1] ?? null
  return /^[0-9a-f]{40,64}$/i.test(text) ? text.slice(0, 7) : null
}

// Where a worktree's or submodule's `.git` file points: its `gitdir:` line, made absolute.
export const gitDirOf = (dotGit: string, dir: string): string | null => {
  const path = /^gitdir:\s*(.+)$/m.exec(dotGit)?.[1]?.trim()
  if (path === undefined || path === '') return null
  return /^([a-z]:)?[\\/]/i.test(path) ? path : `${dir}/${path}`
}

// The working directory and its parents, nearest first, ending at the repository's root
// when it is one of them; at most 32, so a root elsewhere cannot run the walk on.
export const dirsUp = (cwd: string, root: string): string[] => {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const stop = norm(root).toLowerCase()
  const dirs: string[] = []
  let dir = norm(cwd)
  while (dir !== '' && dirs.length < 32) {
    dirs.push(dir)
    if (dir.toLowerCase() === stop) break
    const cut = dir.lastIndexOf('/')
    if (cut === -1) break
    dir = dir.slice(0, cut)
  }
  return dirs
}

// A long branch name keeps its start and its end.
export const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.ceil((max - 1) / 2))}…${text.slice(text.length - Math.floor((max - 1) / 2))}`
