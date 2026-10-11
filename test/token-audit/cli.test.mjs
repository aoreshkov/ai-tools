// Tests for token-audit's CLI: locating transcripts, exit codes, the output budget and the
// --json shapes. Synthetic fixtures only; no model calls.
//
// Run with: node --test
// Refresh the JSON snapshots after an intended shape change: UPDATE_SNAPSHOTS=1 node --test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { run } from '../../token-audit/skills/token-audit/scripts/audit.mjs'
import { projectFolderName } from '../../token-audit/skills/token-audit/scripts/lib/locate.mjs'
import { TESTED_MAX_VERSION } from '../../token-audit/skills/token-audit/scripts/lib/transcript.mjs'

const AUDIT = fileURLToPath(new URL('../../token-audit/skills/token-audit/scripts/audit.mjs', import.meta.url))
const CONFIG = fileURLToPath(new URL('../fixtures/token-audit/', import.meta.url))
const EXPECTED = fileURLToPath(new URL('../fixtures/token-audit/expected/', import.meta.url))
const FIXTURE_PROJECT = path.join(CONFIG, 'projects', 'fixture-project')
const ODD_PROJECT = path.join(CONFIG, 'projects', 'odd-project')
const env = { CLAUDE_CONFIG_DIR: CONFIG }
const audit = (args, opts = {}) => run(args, { env, cwd: os.tmpdir(), ...opts })

const MAX_LINES = 60
const MAX_BYTES = 4096

function tempConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-audit-'))
  return { dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------------------------------
// Locating transcripts

test('rank --session finds the session under any project and marks it', () => {
  const r = audit(['rank', '--session', 'compacted', '--json'])
  assert.equal(r.code, 0, r.stderr)
  const j = JSON.parse(r.stdout)
  assert.equal(j.project, 'fixture-project')
  assert.deepEqual(j.current, { id: 'compacted', rank: 3 })
  assert.deepEqual(j.sessions.map(s => [s.id, s.total, s.current]), [
    ['basic', 7195, false],
    ['with-subagents', 2050, false],
    ['compacted', 1340, true],
    ['parallel', 500, false],
  ])
})

test('rank --session falls back to the working directory when the session is missing', () => {
  const t = tempConfig()
  try {
    const cwd = path.join(t.dir, 'my project')
    const proj = path.join(t.dir, 'config', 'projects', projectFolderName(cwd))
    fs.mkdirSync(proj, { recursive: true })
    fs.copyFileSync(path.join(FIXTURE_PROJECT, 'basic.jsonl'), path.join(proj, 'basic.jsonl'))
    const r = run(['rank', '--session', 'not-written-yet'], { env: { CLAUDE_CONFIG_DIR: path.join(t.dir, 'config') }, cwd })
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /1 sessions/)
    assert.match(r.stderr, /no transcript for session not-written-yet yet; ranking the working directory's project/)
  } finally {
    t.done()
  }
})

test('rank derives the project folder from the working directory', () => {
  const t = tempConfig()
  try {
    const cwd = path.join(t.dir, 'work', 'demo.app')
    const name = projectFolderName(cwd)
    assert.doesNotMatch(name, /[^a-zA-Z0-9-]/)
    const proj = path.join(t.dir, 'projects', name)
    fs.mkdirSync(proj, { recursive: true })
    fs.copyFileSync(path.join(FIXTURE_PROJECT, 'parallel.jsonl'), path.join(proj, 'parallel.jsonl'))
    const r = run(['rank', '--config-dir', t.dir, '--json'], { env: {}, cwd })
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(JSON.parse(r.stdout).sessions.map(s => s.id), ['parallel'])
  } finally {
    t.done()
  }
})

test('rank in a directory without transcripts warns and exits 2', () => {
  const t = tempConfig()
  try {
    const r = run(['rank', '--config-dir', t.dir], { env: {}, cwd: t.dir })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /no session transcripts in/)
  } finally {
    t.done()
  }
})

test('session accepts a full id, a unique prefix, or a path', () => {
  for (const target of ['with-subagents', 'with-', path.join(FIXTURE_PROJECT, 'with-subagents.jsonl')]) {
    const r = audit(['session', target, '--json'])
    assert.equal(r.code, 0, `${target}: ${r.stderr}`)
    const j = JSON.parse(r.stdout)
    assert.equal(j.session.id, 'with-subagents')
    assert.deepEqual(j.subagents, { transcripts: 1, calls: 3, total: 1050 })
  }
})

test('session --include-subagents false leaves subagent transcripts out', () => {
  const j = JSON.parse(audit(['session', 'with-subagents', '--json', '--include-subagents', 'false']).stdout)
  assert.deepEqual(j.subagents, { transcripts: 0, calls: 1, total: 50 })
})

test('an ambiguous prefix is a usage error', () => {
  const t = tempConfig()
  try {
    const proj = path.join(t.dir, 'projects', 'p')
    fs.mkdirSync(proj, { recursive: true })
    for (const id of ['abc1', 'abc2']) fs.copyFileSync(path.join(FIXTURE_PROJECT, 'basic.jsonl'), path.join(proj, `${id}.jsonl`))
    const r = run(['session', 'abc', '--config-dir', t.dir], { env: {}, cwd: t.dir })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /ambiguous: abc1, abc2/)
  } finally {
    t.done()
  }
})

// ---------------------------------------------------------------------------------------
// Exit codes and warnings, through a real process

const proc = (...args) => spawnSync(process.execPath, [AUDIT, ...args], { env: { ...process.env, CLAUDE_CONFIG_DIR: CONFIG }, encoding: 'utf8' })

test('exit codes: 0 ok, 1 usage error, 2 nothing found', () => {
  assert.equal(proc('session', 'basic').status, 0)
  assert.equal(proc('--help').status, 0)
  assert.equal(proc().status, 1)
  assert.equal(proc('bogus').status, 1)
  assert.equal(proc('session').status, 1)
  assert.equal(proc('rank', 'extra').status, 1)
  assert.equal(proc('rank', '--top', '0').status, 1)
  assert.equal(proc('rank', '--weights', '1,2,3').status, 1)
  assert.equal(proc('rank', '--include-subagents', 'maybe').status, 1)
  assert.equal(proc('rank', '--project', 'x', '--session', 'y').status, 1)
  assert.equal(proc('session', 'no-such-session').status, 2)
  assert.equal(proc('session', 'unreadable').status, 2)
  assert.equal(proc('rank', '--project', path.join(CONFIG, 'nowhere')).status, 2)
})

test('--exit-zero reports an error on stdout and exits 0', () => {
  const r = proc('rank', '--project', path.join(CONFIG, 'nowhere'), '--exit-zero')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^token-audit: no session transcripts in/)
  assert.equal(r.stderr, '')
  const u = proc('rank', '--top', 'x', '--exit-zero')
  assert.equal(u.status, 0)
  assert.match(u.stdout, /--top must be/)
})

test('results go to stdout, warnings to stderr', () => {
  const r = proc('rank', '--project', ODD_PROJECT)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /2 sessions/)
  assert.match(r.stdout, /skipped 1 unreadable session/)
  assert.doesNotMatch(r.stdout, /warning/)
  const warnings = r.stderr.trim().split('\n')
  assert.deepEqual(warnings.map(w => w.replace(/^token-audit: warning: /, '').slice(0, 30)), [
    'session unreadable: 2 assistan',
    'transcripts from Claude Code 9',
    '3 unparsable transcript line(s',
    '3 assistant record(s) without ',
  ])
  assert.ok(r.stderr.includes(`newer than the tested ${TESTED_MAX_VERSION}; figures may be wrong`), r.stderr)
})

test('no version warning for transcripts at or below the tested version', () => {
  assert.equal(proc('session', 'basic').stderr, '')
})

// ---------------------------------------------------------------------------------------
// Output budget

function bigProject(dir, { sessions, calls }) {
  const proj = path.join(dir, 'projects', 'big')
  fs.mkdirSync(proj, { recursive: true })
  for (let s = 0; s < sessions; s++) {
    const lines = []
    for (let i = 0; i < calls; i++) {
      if (i % 4 === 0) lines.push({ type: 'user', message: { content: `prompt ${i} ${'words '.repeat(80)}` }, timestamp: '2026-09-01T10:00:00Z' })
      const cmd = `cd /w && tool${i} --flag ${'arg '.repeat(60)}`
      lines.push({ type: 'assistant', message: { id: `m${i}`, content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: cmd } }], usage: { input_tokens: 1, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 * i, output_tokens: 10 } } })
      lines.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'r'.repeat(1000 + i) }] } })
    }
    lines.push({ type: 'ai-title', aiTitle: `A very long session title that goes on and on ${'and on '.repeat(20)}` })
    fs.writeFileSync(path.join(proj, `session-${String(s).padStart(3, '0')}-${'f'.repeat(28)}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n'))
  }
  return proj
}

const withinBudget = (out, label) => {
  const lines = out.split('\n')
  assert.ok(lines.length <= MAX_LINES, `${label}: ${lines.length} lines`)
  assert.ok(Buffer.byteLength(out) <= MAX_BYTES, `${label}: ${Buffer.byteLength(out)} bytes`)
  for (const l of lines) assert.ok(l.length <= 240, `${label}: line of ${l.length} chars`)
}

test('default text output stays within 60 lines and 4 KB; --top raises the limit', () => {
  const t = tempConfig()
  try {
    const proj = bigProject(t.dir, { sessions: 40, calls: 120 })
    const rank = run(['rank', '--project', proj], { env: {}, cwd: t.dir })
    assert.equal(rank.code, 0, rank.stderr)
    withinBudget(rank.stdout, 'rank')
    const id = 'session-000'
    for (const cmd of ['session', 'categories']) {
      const r = run([cmd, id, '--project', proj], { env: {}, cwd: t.dir })
      assert.equal(r.code, 0, r.stderr)
      withinBudget(r.stdout, cmd)
    }
    const s = run(['session', id, '--project', proj], { env: {}, cwd: t.dir }).stdout
    assert.ok(s.split('\n').every(l => !l.includes('arg arg arg arg arg arg arg arg arg arg arg arg arg arg arg arg arg arg arg arg arg arg arg')), 'commands are clipped')
    const wide = run(['rank', '--project', proj, '--top', '30'], { env: {}, cwd: t.dir }).stdout
    assert.ok(wide.split('\n').length > MAX_LINES - 30)
    assert.equal(wide.split('\n').filter(l => /^\s*\d+\*?\s+session-/.test(l)).length, 30)
  } finally {
    t.done()
  }
})

// ---------------------------------------------------------------------------------------
// JSON shape snapshots

function snapshot(name, value) {
  const file = path.join(EXPECTED, `${name}.json`)
  const text = `${JSON.stringify(value, null, 2)}\n`
  if (process.env.UPDATE_SNAPSHOTS === '1' || !fs.existsSync(file)) {
    if (process.env.UPDATE_SNAPSHOTS !== '1') assert.fail(`missing snapshot ${file}; run with UPDATE_SNAPSHOTS=1`)
    fs.mkdirSync(EXPECTED, { recursive: true })
    fs.writeFileSync(file, text)
    return
  }
  assert.deepEqual(value, JSON.parse(fs.readFileSync(file, 'utf8')))
}

for (const [name, args] of [
  ['rank', ['rank', '--project', FIXTURE_PROJECT, '--json']],
  ['session-basic', ['session', 'basic', '--json']],
  ['session-compacted', ['session', 'compacted', '--json']],
  ['categories-parallel', ['categories', 'parallel', '--json']],
]) {
  test(`--json shape is stable: ${name}`, () => {
    const r = audit(args)
    assert.equal(r.code, 0, r.stderr)
    snapshot(name, JSON.parse(r.stdout))
  })
}
