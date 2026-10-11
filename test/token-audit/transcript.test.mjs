// Tests for token-audit's transcript parser. Synthetic fixtures only; no model calls.
//
// Run with: node --test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { parseTranscript, resultSize, compareVersions } from '../../token-audit/skills/token-audit/scripts/lib/transcript.mjs'
import { readLines } from '../../token-audit/skills/token-audit/scripts/lib/locate.mjs'

const fixture = rel => fileURLToPath(new URL(`../fixtures/token-audit/projects/${rel}`, import.meta.url))
const parse = (rel, opts) => parseTranscript(readLines(fixture(rel)), opts)

test('dedupes assistant records by message.id and keeps the last usage', () => {
  const p = parse('fixture-project/basic.jsonl')
  assert.equal(p.calls.length, 4)
  assert.deepEqual(p.calls[0].usage, { in: 10, cw: 1000, cr: 0, out: 50 })
  assert.deepEqual(p.calls[0].tools.map(t => t.name), ['Bash'])
  assert.equal(p.stats.assistantRecords, 5)
})

test('links tool results to their tool use, with the call that first reads them', () => {
  const p = parse('fixture-project/basic.jsonl')
  assert.deepEqual(p.toolUses.get('tu_b1').result, { chars: 350, images: 0, callIdx: 1, segment: 0 })
  assert.deepEqual(p.toolUses.get('tu_b3').result, { chars: 700, images: 1, callIdx: 3, segment: 0 })
})

test('reads title, timestamps, cwd and versions', () => {
  const p = parse('fixture-project/basic.jsonl')
  assert.equal(p.stats.title, 'Fix the parser')
  assert.equal(p.stats.cwd, '/work/demo')
  assert.deepEqual(p.stats.versions, ['2.1.290'])
  assert.ok(p.stats.first < p.stats.last)
})

test('a compact boundary starts a new segment; the compact summary is not a prompt', () => {
  const p = parse('fixture-project/compacted.jsonl')
  assert.equal(p.stats.compactions, 1)
  assert.deepEqual(p.calls.map(c => c.segment), [0, 0, 1, 1])
  assert.deepEqual(p.turns.map(t => t.text), ['run the tests', 'go on'])
  assert.deepEqual(p.calls.map(c => c.turn), [0, 0, 1, 1])
})

test('slash commands count as prompts as typed; meta records do not', () => {
  const p = parse('fixture-project/parallel.jsonl')
  assert.deepEqual(p.turns.map(t => t.text), ['/review src'])
  assert.equal(p.calls[0].tools.length, 3)
})

test('sidechain records in a parent transcript are kept apart as subagent usage', () => {
  const p = parse('fixture-project/with-subagents.jsonl')
  assert.equal(p.calls.length, 1)
  assert.deepEqual(p.sidechain, [{ in: 0, cw: 40, cr: 0, out: 10 }])
  const sub = parse('fixture-project/with-subagents/subagents/agent-a1.jsonl', { sidechain: true })
  assert.equal(sub.calls.length, 2)
  assert.equal(sub.sidechain.length, 0)
})

test('broken lines and records without usage are counted, not fatal', () => {
  const p = parse('odd-project/garbage.jsonl')
  assert.equal(p.stats.badLines, 3)
  assert.equal(p.stats.noUsage, 1)
  assert.equal(p.calls.filter(c => c.usage).length, 1)
})

test('a transcript with assistant records but no usage yields no usable call', () => {
  const p = parse('odd-project/unreadable.jsonl')
  assert.equal(p.stats.assistantRecords, 2)
  assert.equal(p.calls.filter(c => c.usage).length, 0)
})

test('prompts are cut to 110 characters, whitespace collapsed', () => {
  const long = JSON.stringify({ type: 'user', message: { content: `a\n\n${'b'.repeat(300)}` } })
  const p = parseTranscript([long])
  assert.equal(p.turns[0].text.length, 110)
  assert.ok(p.turns[0].text.startsWith('a b'))
})

test('tolerates missing fields and unknown record types', () => {
  const p = parseTranscript([
    '{"type":"assistant"}',
    '{"type":"assistant","message":{"id":"m","usage":{"input_tokens":"x","output_tokens":3}}}',
    '{"type":"something-new","message":{"usage":{"input_tokens":9}}}',
    '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"unknown","content":"x"}]}}',
  ])
  assert.equal(p.calls.length, 1)
  assert.deepEqual(p.calls[0].usage, { in: 0, cw: 0, cr: 0, out: 3 })
  assert.equal(p.stats.noUsage, 1)
})

test('resultSize counts text characters and images', () => {
  assert.deepEqual(resultSize('abc'), { chars: 3, images: 0 })
  assert.deepEqual(resultSize([{ type: 'text', text: 'ab' }, { type: 'image' }, { type: 'tool_reference' }]), { chars: 2, images: 1 })
  assert.deepEqual(resultSize(undefined), { chars: 0, images: 0 })
})

test('compareVersions orders numerically', () => {
  assert.ok(compareVersions('2.1.296', '2.1.30') > 0)
  assert.ok(compareVersions('2.1.9', '2.1.10') < 0)
  assert.equal(compareVersions('2.1.0', '2.1'), 0)
})
