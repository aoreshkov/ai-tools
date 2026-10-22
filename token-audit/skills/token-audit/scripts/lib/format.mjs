// Text tables and JSON. The text output's own structure is ASCII, so it reads the same in
// every terminal and shell, and it stays short: it lands in a model's context. Text from
// the transcripts (titles, prompts, commands) is stripped of terminal escapes, control and
// bidi characters, then clipped at grapheme boundaries and to a width in UTF-8 bytes as
// well as in characters, so multibyte text cannot outgrow the budget or leave a broken
// character behind.

import { stripVTControlCharacters } from 'node:util'
import { costEq } from './attribute.mjs'

export const FORMAT = 'token-audit/1'
export const COMMAND_WIDTH = 90
export const PROMPT_WIDTH = 110
const TITLE_WIDTH = 40
// Text output names this many skipped sessions; --json lists them all.
const SKIPPED_SHOWN = 5

export function tok(n) {
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}
const pct = x => `${(100 * x).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`
const share = (part, whole) => (whole ? part / whole : 0)
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const fits = (t, n) => t.length <= n && Buffer.byteLength(t) <= n
// Bidi embeddings, overrides, isolates and marks reorder what a reader sees. The zero-width
// joiner is a format character too, but it holds emoji together, so it stays.
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g
// Whole escape sequences go first, so no `[31m` is left behind; other controls become
// spaces and collapse with the rest of the whitespace. Then at most n characters and n
// UTF-8 bytes, `...` included when cut, or always when `cut` says the text was already
// shortened. The cut falls between graphemes, so an emoji or an accented letter stays whole.
export const clip = (s, n, cut = false) => {
  const t = stripVTControlCharacters(String(s ?? '')).replace(/\p{Cc}/gu, ' ').replace(BIDI, '')
    .replace(/\s+/g, ' ').trim().toWellFormed()
  if (!cut && fits(t, n)) return t
  if (fits(`${t}...`, n)) return `${t}...`
  let kept = ''
  for (const { segment } of graphemes.segment(t)) {
    if (!fits(kept + segment, n - 3)) break
    kept += segment
  }
  return `${kept}...`
}
const when = ts => (ts ? ts.slice(0, 16).replace('T', ' ') : '-')
const shortWhen = ts => (ts ? ts.slice(5, 16).replace('T', ' ') : '-')
const shortId = id => id.slice(0, 8)
const round = n => Math.round(n)
const round4 = n => Math.round(n * 1e4) / 1e4

// Columns: [header, align] with align 'l' or 'r'. The last column is never padded.
function table(columns, rows) {
  const width = columns.map(([h], i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)))
  const line = cells => cells.map((c, i) => {
    const s = String(c)
    if (i === cells.length - 1) return s
    return columns[i][1] === 'r' ? s.padStart(width[i]) : s.padEnd(width[i])
  }).join('  ').trimEnd()
  return [line(columns.map(([h]) => h)), ...rows.map(line)]
}

const weightsLine = w =>
  `cost-eq = relative weights: input ${w.in}, cache write ${w.cw}, cache read ${w.cr}, output ${w.out} (not dollars)`

// ---------------------------------------------------------------------------------------
// rank

export function rankJson(d) {
  return {
    format: FORMAT,
    command: 'rank',
    project: d.project,
    weights: d.weights,
    totals: {
      sessions: d.sessions.length,
      total: round(d.grand.total),
      costEq: round(d.grand.costEq),
      subagents: round(d.grand.sub),
    },
    current: d.current ? { id: d.current.id, rank: d.current.rank } : null,
    sessions: d.sessions.slice(0, d.top).map(s => sessionRow(s)),
    skipped: d.skipped,
    warnings: d.warnings,
  }
}

const sessionRow = s => ({
  rank: s.rank,
  id: s.id,
  title: s.title,
  first: s.first,
  last: s.last,
  calls: s.totals.all.calls,
  total: round(s.totals.all.total),
  costEq: round(s.totals.costEq),
  input: round(s.totals.all.in),
  cacheWrite: round(s.totals.all.cw),
  cacheRead: round(s.totals.all.cr),
  output: round(s.totals.all.out),
  subagents: round(s.totals.sub.total),
  peakContext: round(s.totals.peak),
  compactions: s.totals.compactions,
  current: Boolean(s.current),
})

export function rankText(d) {
  const out = []
  const topShare = share(d.sessions.slice(0, 3).reduce((a, s) => a + s.totals.all.total, 0), d.grand.total)
  out.push(`Token use by session - project ${d.project}`)
  out.push(`${d.sessions.length} sessions, ${tok(d.grand.total)} tokens (subagents ${tok(d.grand.sub)}), cost-eq ${tok(d.grand.costEq)}; top 3 = ${pct(topShare)} of tokens`)
  out.push(weightsLine(d.weights))
  if (d.skipped.length) {
    const more = d.skipped.length > SKIPPED_SHOWN ? ` and ${d.skipped.length - SKIPPED_SHOWN} more` : ''
    out.push(`skipped ${d.skipped.length} unreadable session(s): ${d.skipped.slice(0, SKIPPED_SHOWN).map(s => shortId(s.id)).join(', ')}${more}`)
  }
  out.push('')
  const rows = d.sessions.slice(0, d.top).map(s => [
    `${s.rank}${s.current ? '*' : ''}`, shortId(s.id), when(s.first), tok(s.totals.all.total), tok(s.totals.costEq),
    s.totals.all.calls, tok(s.totals.all.out), tok(s.totals.all.cw), tok(s.totals.all.cr),
    pct(share(s.totals.sub.total, s.totals.all.total)), clip(s.title, TITLE_WIDTH),
  ])
  out.push(...table([['#', 'r'], ['session', 'l'], ['started', 'l'], ['total', 'r'], ['cost-eq', 'r'], ['calls', 'r'],
    ['output', 'r'], ['c.write', 'r'], ['c.read', 'r'], ['sub', 'r'], ['title', 'l']], rows))
  if (d.current) {
    out.push(d.current.rank <= d.top
      ? '* = this session'
      : `this session: #${d.current.rank} ${shortId(d.current.id)}, ${tok(d.current.total)} tokens`)
  }
  return out.join('\n')
}

// ---------------------------------------------------------------------------------------
// session

export function sessionJson(d) {
  const a = d.analysis
  const t = a.totals
  return {
    format: FORMAT,
    command: 'session',
    session: { id: d.id, title: d.title, first: d.first, last: d.last, versions: d.versions },
    weights: d.weights,
    totals: {
      calls: t.main.calls, input: round(t.main.in), cacheWrite: round(t.main.cw), cacheRead: round(t.main.cr),
      output: round(t.main.out), total: round(t.main.total),
    },
    subagents: { transcripts: t.subagentTranscripts, calls: t.sub.calls, total: round(t.sub.total) },
    costEq: round(t.costEq),
    context: {
      compactions: a.context.compactions, peak: round(a.context.peak), avg: round(a.context.avg),
      profile: a.context.profile.map(round),
    },
    parallelCalls: a.parallelCalls,
    actions: a.actions.slice(0, d.top.actions).map(x => ({
      key: x.key, category: x.category, uses: x.uses, tokens: round(x.tokens), share: round4(share(x.tokens, a.grand)),
      output: round(x.output), resultTokensEst: round(x.resultTokens), carryEst: round(x.carry),
    })),
    results: a.results.slice(0, d.top.results).map(x => ({
      key: x.key, tokensEst: round(x.tokens), carryEst: round(x.carry), what: clip(x.what, COMMAND_WIDTH),
    })),
    prompts: a.turns.slice(0, d.top.prompts).map(x => ({ text: clip(x.text, PROMPT_WIDTH, x.cut), ts: x.ts, calls: x.calls, tokens: round(x.tokens) })),
    warnings: d.warnings,
  }
}

export function sessionText(d) {
  const a = d.analysis
  const t = a.totals
  const m = t.main
  const out = []
  const version = d.versions.length ? ` - Claude Code ${d.versions[d.versions.length - 1]}` : ''
  out.push(`Session ${shortId(d.id)} "${clip(d.title, 60)}" - ${when(d.first)} -> ${when(d.last)} UTC${version}`)
  out.push(`${m.calls} calls, ${tok(m.total)} tokens: input ${tok(m.in)}, cache write ${tok(m.cw)}, cache read ${tok(m.cr)} (${pct(share(m.cr, m.total))}), output ${tok(m.out)}`)
  // The figure the skill's output rule reads: output's part of the main session's cost-eq,
  // under the weights in use. Main transcript only, like the output count above.
  const outShare = share(d.weights.out * m.out, costEq(m, d.weights))
  out.push(`cost-eq ${tok(t.costEq)} incl. subagents; output share of cost-eq (main session) ${pct(outShare)}; ${weightsLine(d.weights).replace('cost-eq = ', '')}`)
  out.push(`context: peak ${tok(a.context.peak)}, avg ${tok(a.context.avg)}, at 0/25/50/75/100% of calls ${a.context.profile.map(tok).join(' / ')}; compactions ${a.context.compactions}`)
  out.push(`parallel: ${a.parallelCalls} of ${m.calls} calls issued >1 tool use; subagents: ${t.subagentTranscripts} transcript(s), ${t.sub.calls} calls, ${tok(t.sub.total)} tokens`)

  out.push('', 'Top actions by round-trip tokens (~ = estimated from result size)')
  out.push(...table([['action', 'l'], ['uses', 'r'], ['tokens', 'r'], ['share', 'r'], ['output', 'r'], ['~result', 'r'], ['~carry', 'r']],
    a.actions.slice(0, d.top.actions).map(x => [
      clip(x.key, 40), x.uses, tok(x.tokens), pct(share(x.tokens, a.grand)), tok(x.output), `~${tok(x.resultTokens)}`, `~${tok(x.carry)}`,
    ])))

  if (a.results.length) {
    out.push('', 'Largest tool results by ~carry (size x later calls that re-read it)')
    out.push(...table([['action', 'l'], ['~size', 'r'], ['~carry', 'r'], ['what', 'l']],
      a.results.slice(0, d.top.results).map(x => [clip(x.key, 30), `~${tok(x.tokens)}`, `~${tok(x.carry)}`, clip(x.what, COMMAND_WIDTH)])))
  }

  if (a.turns.length) {
    out.push('', 'Costliest prompts')
    out.push(...table([['tokens', 'r'], ['calls', 'r'], ['when', 'l'], ['prompt', 'l']],
      a.turns.slice(0, d.top.prompts).map(x => [tok(x.tokens), x.calls, shortWhen(x.ts), clip(x.text, PROMPT_WIDTH, x.cut)])))
  }
  return out.join('\n')
}

// ---------------------------------------------------------------------------------------
// categories

export function categoriesJson(d) {
  const a = d.analysis
  return {
    format: FORMAT,
    command: 'categories',
    session: { id: d.id, title: d.title },
    totals: { calls: a.totals.main.calls, total: round(a.totals.main.total) },
    parallelCalls: a.parallelCalls,
    categories: a.categories.map(c => ({ name: c.name, uses: c.uses, tokens: round(c.tokens), share: round4(c.share) })),
    warnings: d.warnings,
  }
}

export function categoriesText(d) {
  const a = d.analysis
  const out = [
    `Token use by category - session ${shortId(d.id)} "${clip(d.title, 60)}"`,
    `${a.totals.main.calls} calls, ${tok(a.totals.main.total)} tokens; ${a.parallelCalls} calls issued >1 tool use`,
    '',
  ]
  out.push(...table([['category', 'l'], ['uses', 'r'], ['tokens', 'r'], ['share', 'r']],
    a.categories.map(c => [c.name, c.uses, tok(c.tokens), pct(c.share)])))
  return out.join('\n')
}
