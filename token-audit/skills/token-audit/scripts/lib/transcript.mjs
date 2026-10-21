// Claude Code session transcript (JSONL) -> normalized calls, tool uses, results and
// user turns. Pure: takes lines, returns data. No filesystem.
//
// The transcript format is internal to Claude Code and changes between releases, so
// this reads as few fields as it can, tolerates missing ones, and counts what it skips.

// Newest Claude Code version whose transcripts this parser was checked against. Bump it
// after checking a newer release's transcripts.
export const TESTED_MAX_VERSION = '2.1.306'

// The formatter's prompt width. One character more is kept, so it can tell a prompt that
// was cut from one that fits and mark the cut.
const PROMPT_SNIPPET = 110

// Returns { calls, toolUses, turns, sidechain, stats }.
// - calls: one per API response (deduped by message.id), in order of first appearance.
// - toolUses: Map tool_use id -> { id, name, input, callIdx, result }.
// - turns: user prompts that started work.
// - sidechain: usage of sidechain records found in this file (older versions wrote
//   subagent records into the parent transcript). With { sidechain: true }, the file is a
//   subagent transcript and its sidechain records are ordinary calls instead.
export function parseTranscript(lines, { sidechain = false } = {}) {
  const calls = []
  const byId = new Map()
  const sideById = new Map()
  const toolUses = new Map()
  const turns = []
  const versions = new Set()
  const stats = {
    lines: 0, badLines: 0, assistantRecords: 0, noUsage: 0, compactions: 0,
    title: '', first: null, last: null, cwd: null, versions: [],
  }
  let segment = 0
  let turn = null

  for (const line of lines) {
    if (!line || !line.trim()) continue
    stats.lines++
    let o
    try {
      o = JSON.parse(line)
    } catch {
      stats.badLines++
      continue
    }
    if (!o || typeof o !== 'object') {
      stats.badLines++
      continue
    }
    if (typeof o.version === 'string') versions.add(o.version)
    if (typeof o.timestamp === 'string') {
      if (!stats.first) stats.first = o.timestamp
      stats.last = o.timestamp
    }
    if (!stats.cwd && typeof o.cwd === 'string') stats.cwd = o.cwd

    switch (o.type) {
      case 'ai-title':
        if (typeof o.aiTitle === 'string') stats.title = o.aiTitle
        break
      case 'summary':
        if (!stats.title && typeof o.summary === 'string') stats.title = o.summary
        break
      case 'system':
        if (/compact/.test(o.subtype || '')) {
          segment++
          stats.compactions++
        }
        break
      case 'user':
        if (o.isSidechain && !sidechain) break
        turn = readUser(o, { calls, toolUses, turns, segment, turn })
        break
      case 'assistant': {
        stats.assistantRecords++
        const msg = o.message
        if (!msg || typeof msg !== 'object') {
          stats.noUsage++
          break
        }
        const usage = readUsage(msg.usage)
        if (!usage) stats.noUsage++
        if (o.isSidechain && !sidechain) {
          if (usage && msg.id) sideById.set(msg.id, usage)
          break
        }
        const id = typeof msg.id === 'string' ? msg.id : `#${stats.lines}`
        let call = byId.get(id)
        if (!call) {
          call = { id, idx: calls.length, segment, turn: turn ? turns.length - 1 : null, usage: null, tools: [] }
          byId.set(id, call)
          calls.push(call)
        }
        if (usage) call.usage = usage
        for (const b of Array.isArray(msg.content) ? msg.content : []) {
          if (b?.type !== 'tool_use' || typeof b.id !== 'string' || toolUses.has(b.id)) continue
          const tu = { id: b.id, name: String(b.name || '?'), input: b.input && typeof b.input === 'object' ? b.input : {}, callIdx: call.idx, result: null }
          toolUses.set(b.id, tu)
          call.tools.push(tu)
        }
        break
      }
    }
  }

  stats.versions = [...versions].sort(compareVersions)
  return { calls, toolUses, turns, sidechain: [...sideById.values()], stats }
}

function readUser(o, { calls, toolUses, turns, segment, turn }) {
  const content = o.message?.content
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b?.type !== 'tool_result') continue
      const tu = toolUses.get(b.tool_use_id)
      if (!tu) continue
      const size = resultSize(b.content)
      // The result is first read by the next call, so it is carried from there on.
      tu.result = { ...size, callIdx: calls.length, segment }
    }
  }
  if (o.isMeta || o.isCompactSummary) return turn
  const text = promptText(content)
  if (text == null) return turn
  const next = { text: text.slice(0, PROMPT_SNIPPET + 1), ts: typeof o.timestamp === 'string' ? o.timestamp : null }
  turns.push(next)
  return next
}

// The user's own words, or null for tool results, reminders, command output and the like.
function promptText(content) {
  let text = null
  if (typeof content === 'string') text = content
  else if (Array.isArray(content) && content[0]?.type === 'text') {
    text = content.filter(b => b?.type === 'text').map(b => b.text || '').join(' ')
  }
  if (text == null) return null
  text = text.trim()
  if (text.startsWith('<')) {
    // A slash command is a prompt; show it as typed, without its expanded body.
    const name = /<command-name>([^<]*)<\/command-name>/.exec(text)
    if (!name) return null
    const args = /<command-args>([^<]*)<\/command-args>/.exec(text)
    text = `${name[1]} ${args ? args[1] : ''}`
  }
  text = text.replace(/\s+/g, ' ').trim()
  return text || null
}

function readUsage(u) {
  if (!u || typeof u !== 'object') return null
  const n = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    in: n(u.input_tokens),
    cw: n(u.cache_creation_input_tokens),
    cr: n(u.cache_read_input_tokens),
    out: n(u.output_tokens),
  }
}

// Characters of text and number of images in a tool result.
export function resultSize(content) {
  if (typeof content === 'string') return { chars: content.length, images: 0 }
  let chars = 0
  let images = 0
  for (const b of Array.isArray(content) ? content : []) {
    if (b?.type === 'image') images++
    else if (typeof b?.text === 'string') chars += b.text.length
  }
  return { chars, images }
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(x => parseInt(x, 10) || 0)
  const pb = String(b).split('.').map(x => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}
