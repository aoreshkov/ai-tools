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
import { projectFolderName, readLines } from '../../token-audit/skills/token-audit/scripts/lib/locate.mjs'
import { TESTED_MAX_VERSION } from '../../token-audit/skills/token-audit/scripts/lib/transcript.mjs'
import { costEq } from '../../token-audit/skills/token-audit/scripts/lib/attribute.mjs'
import { clip, COMMAND_WIDTH, PROMPT_WIDTH } from '../../token-audit/skills/token-audit/scripts/lib/format.mjs'

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
    'skipped 1 session(s) [1 assist',
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
// Files that cannot be read, and option values

// Stands for a file deleted, or locked, between listing and reading. The default reader
// stays locate's, so only locate.mjs touches disk.
const failing = (name, code) => file => {
  if (path.basename(file) === name) throw Object.assign(new Error(`${code}: ${file}`), code ? { code } : {})
  return readLines(file)
}

test('rank skips a transcript it cannot read, names it and goes on', () => {
  const r = audit(['rank', '--project', FIXTURE_PROJECT, '--json'], { read: failing('parallel.jsonl', 'ENOENT') })
  assert.equal(r.code, 0, r.stderr)
  const j = JSON.parse(r.stdout)
  assert.deepEqual(j.skipped, [{ id: 'parallel', reason: 'ENOENT' }])
  assert.deepEqual(j.sessions.map(s => s.id), ['basic', 'with-subagents', 'compacted'])
  assert.match(r.stderr, /skipped 1 session\(s\) \[1 ENOENT\]: parallel/)
  const text = audit(['rank', '--project', FIXTURE_PROJECT, '--exit-zero'], { read: failing('parallel.jsonl', 'EACCES') })
  assert.equal(text.code, 0)
  assert.doesNotMatch(text.stdout, /internal error|\n\s+at /)
  assert.match(text.stdout, /skipped 1 unreadable session\(s\): parallel/)
})

test('session and categories report a transcript they cannot read as nothing found', () => {
  for (const cmd of ['session', 'categories']) {
    const r = audit([cmd, 'parallel'], { read: failing('parallel.jsonl', 'EBUSY') })
    assert.equal(r.code, 2, cmd)
    assert.match(r.stderr, /^token-audit: cannot read .*parallel\.jsonl: EBUSY$/)
  }
})

test('a read failure without an error code is still an internal error', () => {
  const r = audit(['session', 'parallel'], { read: failing('parallel.jsonl', undefined) })
  assert.equal(r.code, 1)
  assert.match(r.stderr, /internal error/)
})

test('--weights rejects empty parts and accepts spaces around numbers', () => {
  for (const w of ['1,,0.1,5', ',,,', '1,1.25,0.1,', '1,1.25,0.1,5,']) {
    const r = audit(['rank', '--project', FIXTURE_PROJECT, '--weights', w])
    assert.equal(r.code, 1, w)
    assert.match(r.stderr, /--weights takes four non-negative numbers/, w)
  }
  const ok = audit(['rank', '--project', FIXTURE_PROJECT, '--weights', ' 1, 1.25 ,0.1,5', '--json'])
  assert.equal(ok.code, 0, ok.stderr)
  assert.deepEqual(JSON.parse(ok.stdout).weights, { in: 1, cw: 1.25, cr: 0.1, out: 5 })
})

test('session text prints the output share of the main session\'s cost-eq, with the weights in use', () => {
  for (const weights of [null, '1,1,1,2']) {
    const extra = weights ? ['--weights', weights] : []
    const j = JSON.parse(audit(['session', 'with-subagents', '--json', ...extra]).stdout)
    const main = { in: j.totals.input, cw: j.totals.cacheWrite, cr: j.totals.cacheRead, out: j.totals.output }
    const expected = 100 * j.weights.out * main.out / costEq(main, j.weights)
    const text = audit(['session', 'with-subagents', ...extra]).stdout
    const m = /output share of cost-eq \(main session\) ([\d.]+)%/.exec(text)
    assert.ok(m, text)
    assert.ok(Math.abs(Number(m[1]) - expected) < 0.6, `${weights}: printed ${m[1]}%, expected ${expected}`)
  }
})

test('a prompt longer than the snippet is marked as cut', () => {
  const t = tempConfig()
  try {
    const proj = path.join(t.dir, 'projects', 'p')
    fs.mkdirSync(proj, { recursive: true })
    const lines = [
      { type: 'user', message: { content: `start ${'x'.repeat(200)}` }, timestamp: '2026-09-01T10:00:00Z' },
      { type: 'assistant', message: { id: 'm1', content: [], usage: { input_tokens: 5, output_tokens: 5 } } },
      { type: 'user', message: { content: 'y'.repeat(PROMPT_WIDTH) }, timestamp: '2026-09-01T10:01:00Z' },
      { type: 'assistant', message: { id: 'm2', content: [], usage: { input_tokens: 1, output_tokens: 1 } } },
    ]
    fs.writeFileSync(path.join(proj, 's.jsonl'), lines.map(l => JSON.stringify(l)).join('\n'))
    const j = JSON.parse(run(['session', 's', '--project', proj, '--json'], { env: {}, cwd: t.dir }).stdout)
    assert.deepEqual(j.prompts.map(p => [p.text.length, p.text.endsWith('...')]), [[PROMPT_WIDTH, true], [PROMPT_WIDTH, false]])
    const text = run(['session', 's', '--project', proj], { env: {}, cwd: t.dir }).stdout
    assert.match(text, /start x+\.\.\.$/m)
  } finally {
    t.done()
  }
})

// A cut that whitespace or a stripped control character shortens back within the width
// still shows: the marker comes from the parser's cut flag, not from the length.
test('a cut prompt is marked even when what is left fits the width', () => {
  const t = tempConfig()
  try {
    const proj = path.join(t.dir, 'projects', 'p')
    fs.mkdirSync(proj, { recursive: true })
    const prompts = [`${'y'.repeat(PROMPT_WIDTH)} tail`, `\u001b[1m${'z'.repeat(PROMPT_WIDTH)}`]
    const lines = prompts.flatMap((content, i) => [
      { type: 'user', message: { content }, timestamp: `2026-09-01T10:0${i}:00Z` },
      { type: 'assistant', message: { id: `m${i}`, content: [], usage: { input_tokens: 9 - i, output_tokens: 1 } } },
    ])
    fs.writeFileSync(path.join(proj, 's.jsonl'), lines.map(l => JSON.stringify(l)).join('\n'))
    const j = JSON.parse(run(['session', 's', '--project', proj, '--json'], { env: {}, cwd: t.dir }).stdout)
    assert.deepEqual(j.prompts.map(p => p.text.endsWith('...')), [true, true], JSON.stringify(j.prompts))
    const text = run(['session', 's', '--project', proj], { env: {}, cwd: t.dir }).stdout
    assert.match(text, /y+\.\.\.$/m)
    assert.match(text, /z+\.\.\.$/m)
  } finally {
    t.done()
  }
})

// Terminal escapes (CSI, OSC 8 links), BEL, the C1 CSI and bidi overrides would recolour,
// rewrite or reorder what a person running the CLI in a terminal sees.
const CONTROLS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/u
const HOSTILE = 'a \u001b[31mred\u001b[0m \u001b]8;;https://example.com/\u0007link\u001b]8;;\u0007 bell\u0007 c1\u009b2J ‮evil'

test('control, escape and bidi characters from transcripts never reach the output', () => {
  const t = tempConfig()
  try {
    const proj = path.join(t.dir, 'projects', 'p')
    fs.mkdirSync(proj, { recursive: true })
    const lines = [
      { type: 'ai-title', aiTitle: `title ${HOSTILE}` },
      { type: 'user', message: { content: `prompt ${HOSTILE}` }, timestamp: '2026-09-01T10:00:00Z' },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `echo ${HOSTILE}` } }], usage: { input_tokens: 5, output_tokens: 5 } } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r'.repeat(500) }] } },
      { type: 'assistant', message: { id: 'm2', content: [], usage: { input_tokens: 1, output_tokens: 1 } } },
    ]
    fs.writeFileSync(path.join(proj, 's.jsonl'), lines.map(l => JSON.stringify(l)).join('\n'))
    for (const cmd of ['rank', 'session', 'categories']) {
      const args = cmd === 'rank' ? [cmd, '--project', proj] : [cmd, 's', '--project', proj]
      const out = run(args, { env: {}, cwd: t.dir }).stdout
      assert.doesNotMatch(out, CONTROLS, `${cmd}: ${JSON.stringify(out)}`)
      for (const leftover of ['[31m', '8;;', '[0m']) assert.ok(!out.includes(leftover), `${cmd}: ${leftover} left in ${JSON.stringify(out)}`)
    }
    const j = JSON.parse(run(['session', 's', '--project', proj, '--json'], { env: {}, cwd: t.dir }).stdout)
    for (const s of [...j.prompts.map(p => p.text), ...j.results.map(r => r.what)]) {
      assert.doesNotMatch(s, CONTROLS, JSON.stringify(s))
    }
    assert.match(j.prompts[0].text, /^prompt a red link bell c1 evil$/)
  } finally {
    t.done()
  }
})

test('a version of an unknown shape is counted and never printed', () => {
  const t = tempConfig()
  try {
    const proj = path.join(t.dir, 'projects', 'p')
    fs.mkdirSync(proj, { recursive: true })
    const lines = [
      { type: 'user', version: 'v'.repeat(5000), message: { content: 'hi' }, timestamp: '2026-09-01T10:00:00Z' },
      { type: 'assistant', version: '2.1.290\n\u001b[2Jfake', message: { id: 'm1', content: [], usage: { input_tokens: 5, output_tokens: 5 } } },
    ]
    fs.writeFileSync(path.join(proj, 's.jsonl'), lines.map(l => JSON.stringify(l)).join('\n'))
    const r = run(['session', 's', '--project', proj], { env: {}, cwd: t.dir })
    assert.equal(r.code, 0, r.stderr)
    for (const out of [r.stdout, r.stderr]) {
      assert.ok(!out.includes('vvvv') && !out.includes('fake'), out)
      assert.doesNotMatch(out, CONTROLS)
    }
    assert.match(r.stderr, /2 record\(s\) with a version of unknown shape; their version was ignored/)
  } finally {
    t.done()
  }
})

test('--project also takes a working directory, and says which transcripts folder it used', () => {
  const t = tempConfig()
  try {
    const work = path.join(t.dir, 'work', 'my app')
    const proj = path.join(t.dir, 'projects', projectFolderName(work))
    fs.mkdirSync(proj, { recursive: true })
    fs.copyFileSync(path.join(FIXTURE_PROJECT, 'basic.jsonl'), path.join(proj, 'basic.jsonl'))
    const env = { CLAUDE_CONFIG_DIR: t.dir }
    for (const args of [['rank', '--project', work, '--json'], ['session', 'basic', '--project', work, '--json']]) {
      const r = run(args, { env, cwd: os.tmpdir() })
      assert.equal(r.code, 0, `${args[0]}: ${r.stderr}`)
      assert.ok(r.stderr.includes(`--project ${work} holds no transcripts; using its transcripts folder ${proj}`), r.stderr)
    }
    // The transcripts folder itself is used as it is, with no warning.
    const direct = run(['rank', '--project', proj], { env, cwd: os.tmpdir() })
    assert.equal(direct.code, 0, direct.stderr)
    assert.equal(direct.stderr, '')
  } finally {
    t.done()
  }
})

test('the usage text says --project is the transcripts folder or a working directory', () => {
  assert.match(proc('--help').stdout, /--project <transcripts-dir \| working-dir>/)
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
    // Every command is longer than COMMAND_WIDTH, so each is cut to exactly that width.
    const commands = s.split('\n').map(l => l.slice(l.indexOf('cd /w'))).filter(c => c.startsWith('cd /w'))
    assert.ok(commands.length > 0)
    for (const c of commands) {
      assert.equal(c.length, COMMAND_WIDTH, c)
      assert.ok(c.endsWith('...'), c)
    }
    const j = JSON.parse(run(['session', id, '--project', proj, '--json'], { env: {}, cwd: t.dir }).stdout)
    assert.ok(j.results.length > 0)
    for (const r of j.results) {
      assert.equal(r.what.length, COMMAND_WIDTH, r.what)
      assert.ok(r.what.endsWith('...'), r.what)
    }
    const wide = run(['rank', '--project', proj, '--top', '30'], { env: {}, cwd: t.dir }).stdout
    assert.ok(wide.split('\n').length > MAX_LINES - 30)
    assert.equal(wide.split('\n').filter(l => /^\s*\d+\*?\s+session-/.test(l)).length, 30)
  } finally {
    t.done()
  }
})

// CJK, emoji (surrogate pairs, a ZWJ family) and combining marks: three to four UTF-8
// bytes a character, so a cut by characters alone would triple the output's bytes.
const WIDE = '日本語のプロンプト👨‍👩‍👧‍👦é🎉'

test('multibyte prompts, titles and commands stay within 4 KB', () => {
  const t = tempConfig()
  try {
    const proj = path.join(t.dir, 'projects', 'wide')
    fs.mkdirSync(proj, { recursive: true })
    const lines = []
    for (let i = 0; i < 40; i++) {
      if (i % 4 === 0) lines.push({ type: 'user', message: { content: `${i} ${WIDE.repeat(30)}` }, timestamp: '2026-09-01T10:00:00Z' })
      lines.push({ type: 'assistant', message: { id: `m${i}`, content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: `echo ${i} ${WIDE.repeat(30)}` } }], usage: { input_tokens: 1, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 * i, output_tokens: 10 } } })
      lines.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'r'.repeat(1000 + i) }] } })
    }
    lines.push({ type: 'ai-title', aiTitle: WIDE.repeat(10) })
    fs.writeFileSync(path.join(proj, 'wide-session.jsonl'), lines.map(l => JSON.stringify(l)).join('\n'))
    for (const cmd of ['rank', 'session', 'categories']) {
      const args = cmd === 'rank' ? ['rank', '--project', proj] : [cmd, 'wide-session', '--project', proj]
      const r = run(args, { env: {}, cwd: t.dir })
      assert.equal(r.code, 0, r.stderr)
      withinBudget(r.stdout, cmd)
      assert.ok(r.stdout.isWellFormed(), `${cmd}: no lone surrogate`)
    }
  } finally {
    t.done()
  }
})

test('clip cuts at grapheme boundaries and within its width in UTF-8 bytes', () => {
  for (const n of [10, 40, 90, 110]) {
    for (const text of [WIDE.repeat(20), `a${WIDE.repeat(20)}`, 'x'.repeat(300)]) {
      const c = clip(text, n)
      assert.ok(Buffer.byteLength(c) <= n, `${n}: ${Buffer.byteLength(c)} bytes`)
      assert.ok(c.length <= n, `${n}: ${c.length} characters`)
      assert.ok(c.isWellFormed(), `${n}: lone surrogate in ${JSON.stringify(c)}`)
      assert.ok(c.endsWith('...'))
      // The cut falls between graphemes: no family emoji split, no accent without its letter.
      const ends = new Set([0])
      for (const { index, segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
        ends.add(index + segment.length)
      }
      assert.ok(ends.has(c.length - 3), `${n}: cut inside a grapheme: ${JSON.stringify(c)}`)
    }
  }
  assert.equal(clip('short', 10), 'short')
  assert.equal(clip('  spaced \n out  ', 20), 'spaced out')
  assert.equal(clip('日本', 6), '日本')
  // Stripping controls keeps the joiner that holds the family emoji together.
  assert.equal(clip(WIDE, 200), WIDE)
  assert.equal(clip('short', 10, true), 'short...')
})

// CLAUDE.md fixes these widths for the model's context budget. Changing one is deliberate
// and updates CLAUDE.md too.
test('the cut widths are 90 for commands and 110 for prompts', () => {
  assert.equal(COMMAND_WIDTH, 90)
  assert.equal(PROMPT_WIDTH, 110)
})

test('hundreds of skipped sessions keep rank within budget, with one warning', () => {
  const t = tempConfig()
  try {
    const proj = path.join(t.dir, 'projects', 'many')
    fs.mkdirSync(proj, { recursive: true })
    for (let i = 0; i < 300; i++) {
      fs.copyFileSync(path.join(ODD_PROJECT, 'unreadable.jsonl'), path.join(proj, `bad-${String(i).padStart(3, '0')}.jsonl`))
    }
    for (const id of ['good-1', 'good-2']) fs.copyFileSync(path.join(FIXTURE_PROJECT, 'basic.jsonl'), path.join(proj, `${id}.jsonl`))
    const r = run(['rank', '--project', proj], { env: {}, cwd: t.dir })
    assert.equal(r.code, 0, r.stderr)
    withinBudget(r.stdout, 'rank')
    assert.match(r.stdout, /skipped 300 unreadable session\(s\): bad-000, bad-001, bad-002, bad-003, bad-004 and 295 more/)
    const skips = r.stderr.split('\n').filter(l => /skipped \d+ session/.test(l))
    assert.equal(skips.length, 1, r.stderr)
    assert.ok(Buffer.byteLength(r.stderr) < 1024, `${Buffer.byteLength(r.stderr)} bytes of warnings`)
    const j = JSON.parse(run(['rank', '--project', proj, '--json'], { env: {}, cwd: t.dir }).stdout)
    assert.equal(j.skipped.length, 300, '--json keeps the full list')
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
