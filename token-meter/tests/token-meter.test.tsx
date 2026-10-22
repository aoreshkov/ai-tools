import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { alertText, bar, branchOf, clip, dirsUp, gitDirOf, level, modelName, place, toMeter, tokens, until } from '../hooks/format'

// 2026-10-11T12:00:00Z, the mock clock's start
const NOW = Date.parse('2026-10-11T12:00:00Z')

const CALM = {
  context: { tokens: 50_000, window: 200_000, percent: 25 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-11T14:10:00Z' }],
  cost: { usd: 1.234 },
}

const HOT = {
  context: { tokens: 184_000, window: 200_000, percent: 92 },
  rateLimits: [{ kind: 'seven_day', percentUsed: 95, resetsAt: '2026-10-13T12:00:00Z' }],
  cost: { usd: 9.5 },
}

const BAND = {
  plugin: 'token-meter',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 115, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

// What the person's Enter on /token-meter carries, less the args
const COMMAND = {
  command: 'token-meter',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const REPO = { root: 'C:\\work\\ai-tools', remote: null, internal: false, name: null }

// Answers the band's live reads of the session's folder, model and repository; `files`
// stands for the disk, a path not in it is missing, and `reads` lists each path asked for
const stubSession = (
  on: On,
  cwd = 'C:\\work\\ai-tools',
  root = 'C:\\work\\ai-tools',
  files: Record<string, string> = { 'C:/work/ai-tools/.git/HEAD': 'ref: refs/heads/main\n' },
  repo: typeof REPO | null = REPO,
) => {
  on('session.cwd', () => ({ value: cwd }))
  on('session.root', () => ({ value: root }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.repo', () => ({ value: repo }))
  const reads: string[] = []
  on('fs.read', ($, e) => {
    // The engine hands the hook the path resolved in the platform's own spelling: on
    // Windows with backslashes, elsewhere with `C:/…` taken as relative to the working
    // directory. A file matches on its whole path or the end of one.
    const path = e.path.replace(/\\/g, '/')
    reads.push(path)
    const key = Object.keys(files).find(k => path === k || path.endsWith(`/${k}`))
    const text = key === undefined ? undefined : files[key]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  return { files, reads }
}

// Stands for what Claude Code draws when the hook passes with next(e)
const ENGINE_BAND = () => ({ type: 'Text' as const, props: {}, children: ['drawn by Claude Code'] })

describe('format', () => {
  test('bar clamps to its width', async () => {
    expect(bar(25)).toBe('██░░░░░░░░')
    expect(bar(140)).toBe('██████████')
    expect(bar(-3)).toBe('░░░░░░░░░░')
  })

  test('level turns warning at 70% and error at 90%', async () => {
    expect(level(69)).toBe('success')
    expect(level(70)).toBe('warning')
    expect(level(89)).toBe('warning')
    expect(level(90)).toBe('error')
  })

  test('tokens rounds before it picks the unit, so 999.5k reads 1.0M', async () => {
    expect(tokens(50_000)).toBe('50k')
    expect(tokens(999_499)).toBe('999k')
    expect(tokens(999_500)).toBe('1.0M')
    expect(tokens(1_000_000)).toBe('1.0M')
  })

  test('until counts down to an ISO reset', async () => {
    expect(until('2026-10-11T14:10:00Z', NOW)).toBe('2h10m')
    expect(until('2026-10-13T15:00:00Z', NOW)).toBe('2d3h')
    expect(until('2026-10-11T11:00:00Z', NOW)).toBe('0m')
  })

  test('place names the folder, led by the root when below it', async () => {
    expect(place('C:\\work\\ai-tools', 'C:/work/ai-tools/')).toBe('ai-tools')
    expect(place('C:\\work\\ai-tools\\token-audit', 'C:\\work\\ai-tools')).toBe('ai-tools/…/token-audit')
    expect(place('/repo/ai-tools/token-audit/lib', '/repo/ai-tools')).toBe('ai-tools/…/lib')
    expect(place('/elsewhere/tmp', '/repo/ai-tools')).toBe('tmp')
  })

  test('modelName shortens a Claude model ID and leaves other IDs alone', async () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(modelName('claude-fable-5-1[1m]')).toBe('Fable 5.1 1M')
    expect(modelName('us.anthropic.claude-haiku-5-5')).toBe('us.anthropic.claude-haiku-5-5')
  })

  test('alertText names only what crossed 90%', async () => {
    expect(alertText(toMeter(CALM))).toBeUndefined()
    expect(alertText(toMeter(HOT))).toBe('context 92%, 7d limit 95%')
  })

  test('branchOf reads a branch, or a detached commit, from HEAD', async () => {
    expect(branchOf('ref: refs/heads/feat/token-meter\n')).toBe('feat/token-meter')
    expect(branchOf('a10af01c0ffee0123456789abcdef0123456789a\n')).toBe('a10af01')
    expect(branchOf('ref: refs/remotes/origin/main')).toBeNull()
    expect(branchOf('')).toBeNull()
  })

  test('gitDirOf follows a .git file to its directory', async () => {
    expect(gitDirOf('gitdir: C:/work/ai-tools/.git/worktrees/fix\n', 'C:/w/fix')).toBe('C:/work/ai-tools/.git/worktrees/fix')
    expect(gitDirOf('gitdir: /repo/.git/worktrees/fix', '/w/fix')).toBe('/repo/.git/worktrees/fix')
    expect(gitDirOf('gitdir: \\\\server\\repo\\.git', 'C:/w')).toBe('\\\\server\\repo\\.git')
    expect(gitDirOf('gitdir: ../.git/modules/lib', '/repo/lib')).toBe('/repo/lib/../.git/modules/lib')
    expect(gitDirOf('[core]', '/repo')).toBeNull()
  })

  test('dirsUp walks from the working directory up to the repository root', async () => {
    expect(dirsUp('C:\\work\\ai-tools\\token-meter\\hooks', 'C:\\Work\\ai-tools\\')).toEqual([
      'C:/work/ai-tools/token-meter/hooks', 'C:/work/ai-tools/token-meter', 'C:/work/ai-tools',
    ])
    expect(dirsUp('/repo/ai-tools', '/elsewhere')).toEqual(['/repo/ai-tools', '/repo'])
  })

  test('clip keeps both ends of a long name', async () => {
    expect(clip('main', 20)).toBe('main')
    expect(clip('feat/a-very-long-branch-name', 11)).toBe('feat/…-name')
  })
})

describe('hooks', () => {
  test('a measurement past 90% sets the alert line and a calm one clears it', async ($, on) => {
    const statuses: (string | undefined)[] = []
    on('ui.status', ($, e) => {
      statuses.push(e.text)
      return { value: undefined }
    })
    on('session.measure', ($, e) => ({ changed: e.changed }))

    // The hook observes: what the engine answers comes back unchanged
    expect(await $.session.measure({ ...HOT, changed: ['context', 'rateLimits', 'cost'] }))
      .toEqual({ changed: ['context', 'rateLimits', 'cost'] })
    expect(await $.session.measure({ ...CALM, changed: ['context'] })).toEqual({ changed: ['context'] })

    expect(statuses).toEqual(['context 92%, 7d limit 95%', undefined])
  })

  test('session.start registers /token-meter, refreshes once a minute and passes the result on', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const { files } = stubSession(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.usage', () => ({ value: { startedAt: 0, ...CALM } }))
    const registered: string[] = []
    on('command.register', ($, e) => {
      registered.push(e.name)
      return { value: { command: e.name } }
    })
    on('session.start', () => ({ cwd: 'from the engine' }))
    mock.store(on)

    expect(await $.session.start({ cwd: 'C:\\work\\ai-tools', surface: 'terminal', isInteractive: true }))
      .toEqual({ cwd: 'from the engine' })
    expect(registered).toEqual(['token-meter'])

    const bands = await Promise.all((['terminal', 'desktop'] as const).map(surface => $.ui.mount({ ...BAND, surface })))
    for (const ui of bands) {
      expect(await ui.find({ type: 'Text', text: /⎇ main$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ' ↻2h10m' })).toBeDefined()
    }

    // A checkout outside the session, then a minute idle with no response to measure
    files['C:/work/ai-tools/.git/HEAD'] = 'ref: refs/heads/next\n'
    await clock.advance(60_000)
    for (const ui of bands) {
      expect(await ui.find({ type: 'Text', text: /⎇ next$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ' ↻2h9m' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('session.start still resolves when /token-meter cannot be registered, and logs why', async ($, on) => {
    mock.clock(on, { now: NOW })
    stubSession(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.usage', () => ({ value: { startedAt: 0, ...CALM } }))
    on('command.register', () => { throw new Error('name taken') })
    const logs: { text: string; to: string }[] = []
    on('ui.log', ($, e) => {
      logs.push({ text: e.text, to: e.to })
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    mock.store(on)

    expect(await $.session.start({ cwd: 'C:\\work\\ai-tools', surface: 'desktop', isInteractive: true }))
      .toEqual({ cwd: 'C:\\work\\ai-tools' })
    expect(logs).toHaveLength(1)
    expect(logs[0]?.to).toBe('debug')
    expect(logs[0]?.text).toMatch(/^\/token-meter not registered: /)
  })

  test('a failed usage read still leaves /token-meter registered and the idle refresh running, and logs why', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const { reads } = stubSession(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.usage', () => { throw new Error('usage unavailable') })
    const registered: string[] = []
    on('command.register', ($, e) => {
      registered.push(e.name)
      return { value: { command: e.name } }
    })
    const logs: { text: string; to: string }[] = []
    on('ui.log', ($, e) => {
      logs.push({ text: e.text, to: e.to })
      return { value: undefined }
    })
    on('session.start', () => ({ cwd: 'from the engine' }))
    mock.store(on)

    expect(await $.session.start({ cwd: 'C:\\work\\ai-tools', surface: 'terminal', isInteractive: true }))
      .toEqual({ cwd: 'from the engine' })
    expect(registered).toEqual(['token-meter'])
    expect(logs.map(l => l.to)).toEqual(['debug'])
    expect(logs[0]?.text).toMatch(/^reload failed: /)

    // The branch is still read once at the start and again after a minute idle
    const heads = () => reads.filter(r => r.endsWith('/.git/HEAD')).length
    const before = heads()
    expect(before).toBeGreaterThan(0)
    await clock.advance(60_000)
    expect(heads()).toBeGreaterThan(before)
  })

  for (const source of ['clear', 'resume', 'fork'] as const) {
    test(`a failed usage read after ${source} passes the result on, still reads the branch, and logs why`, async ($, on) => {
      mock.clock(on, { now: NOW })
      const { reads } = stubSession(on)
      on('ui.status', () => ({ value: undefined }))
      on('session.usage', () => { throw new Error('usage unavailable') })
      on('classic.SessionStart', () => ({ additionalContext: ['from the engine'] }))
      const logs: string[] = []
      on('ui.log', ($, e) => {
        logs.push(e.text)
        return { value: undefined }
      })
      mock.store(on)

      expect(await $.classic.SessionStart({ source })).toEqual({ additionalContext: ['from the engine'] })
      expect(reads.some(r => r.endsWith('/.git/HEAD'))).toBe(true)
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatch(/^reload failed: /)
    })
  }

  test('the context figure takes its level\'s colour, and the band shows tokens over the window', async ($, on) => {
    mock.clock(on, { now: NOW })
    stubSession(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))

    await $.session.measure({ ...CALM, changed: ['context'] })
    const calm = await $.ui.mount({ ...BAND, surface: 'terminal' })
    // A string query also matches the Text around the one meant, so these are anchored
    expect((await calm.find({ type: 'Text', text: /^██░░░░░░░░ 25%$/ }))?.props.color).toBe('success')
    expect(await calm.find({ type: 'Text', text: /^ 50k\/200k$/ })).toBeDefined()
    await calm.unmount()

    await $.session.measure({ ...HOT, changed: ['context', 'rateLimits'] })
    const hot = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await hot.find({ type: 'Text', text: /^█████████░ 92%$/ }))?.props.color).toBe('error')
    expect((await hot.find({ type: 'Text', text: /^95%$/ }))?.props.color).toBe('error')
    expect(await hot.find({ type: 'Text', text: /^ 184k\/200k$/ })).toBeDefined()
  })

  test('the band draws the figures on terminal and desktop, and hides on press', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    stubSession(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('ui.render', ENGINE_BAND)

    await $.session.measure({ ...CALM, changed: ['context', 'rateLimits', 'cost'] })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: 'ai-tools' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '██░░░░░░░░ 25%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ' ↻2h10m' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '$1.23' })).toBeDefined()
      await ui.unmount()
    }

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'hide' })
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  })

  test('a narrow band drops the bar and the countdown', async ($, on) => {
    mock.clock(on, { now: NOW })
    stubSession(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))

    await $.session.measure({ ...CALM, changed: ['context'] })

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 60 } })
    expect(await ui.find({ type: 'Text', text: '25%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /█/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /↻/ })).toBeUndefined()
  })

  test('before the first response the band shows ctx -- with no bar and no $0.00', async ($, on) => {
    mock.clock(on, { now: NOW })
    stubSession(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))

    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], cost: { usd: 0 }, changed: ['context'] })

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: '--' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /░/ })).toBeUndefined()
    // An empty child would take a column gap of its own
    expect((await ui.find({ type: 'Box' }))?.children).not.toContain('')
    expect(await ui.find({ type: 'Text', text: /\$/ })).toBeUndefined()
  })

  test('the effort comes from the main thread\'s requests, not a subagent\'s', async ($, on) => {
    mock.clock(on, { now: NOW })
    stubSession(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
    })

    // Reads one model request to its end, as the engine does
    const step = async (input: { effort?: 'low' | 'high'; agentId?: string }) => {
      const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...input })
      let r = await stream.next()
      while (r.done !== true) r = await stream.next()
      return r.value
    }

    await $.session.measure({ ...CALM, changed: ['context'] })
    expect((await step({ effort: 'high' })).answer).toBe('ok')
    await step({ effort: 'low', agentId: 'agent-1' })

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: ' high' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' low' })).toBeUndefined()
  })

  test('the band names the branch, and follows a checkout at the next measurement', async ($, on) => {
    mock.clock(on, { now: NOW })
    const { files } = stubSession(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))

    await $.session.measure({ ...CALM, changed: ['context'] })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: ' ⎇' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⎇ main$/ })).toBeDefined()
    await ui.unmount()

    files['C:/work/ai-tools/.git/HEAD'] = 'ref: refs/heads/feat/token-meter\n'
    await $.session.measure({ ...CALM, changed: ['context'] })
    const moved = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await moved.find({ type: 'Text', text: /⎇ feat\/token-meter$/ })).toBeDefined()
  })

  test('in a worktree the branch comes from the HEAD its .git file names', async ($, on) => {
    mock.clock(on, { now: NOW })
    stubSession(on, 'C:\\work\\ai-tools\\.claude\\worktrees\\fix\\token-meter', 'C:\\work\\ai-tools\\.claude\\worktrees\\fix', {
      'C:/work/ai-tools/.claude/worktrees/fix/.git': 'gitdir: C:/work/ai-tools/.git/worktrees/fix\n',
      'C:/work/ai-tools/.git/worktrees/fix/HEAD': 'ref: refs/heads/fix/band\n',
      'C:/work/ai-tools/.git/HEAD': 'ref: refs/heads/main\n',
    })
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))

    await $.session.measure({ ...CALM, changed: ['context'] })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /⎇ fix\/band$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⎇ main$/ })).toBeUndefined()
  })

  test('outside a repository the band shows no branch and reads no file', async ($, on) => {
    mock.clock(on, { now: NOW })
    const { reads } = stubSession(on, 'C:\\tmp', 'C:\\tmp', {}, null)
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))

    await $.session.measure({ ...CALM, changed: ['context'] })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /⎇/ })).toBeUndefined()
    expect(reads).toEqual([])
  })

  test('the band yields to a survey', async ($, on) => {
    mock.clock(on, { now: NOW })
    stubSession(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('ui.render', ENGINE_BAND)

    await $.session.measure({ ...CALM, changed: ['context'] })

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  })

  // One test each, so every source starts from an empty $.state, as after the reset
  for (const source of ['clear', 'resume', 'fork'] as const) {
    test(`the figures come back after ${source}, and the hook passes the result on`, async ($, on) => {
      mock.clock(on, { now: NOW })
      stubSession(on)
      on('ui.status', () => ({ value: undefined }))
      on('session.usage', () => ({ value: { startedAt: 0, ...CALM } }))
      on('classic.SessionStart', () => ({ additionalContext: ['from the engine'] }))
      on('ui.render', ENGINE_BAND)
      mock.store(on)

      for (const surface of ['terminal', 'desktop'] as const) {
        const before = await $.ui.mount({ ...BAND, surface })
        expect(await before.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
        await before.unmount()
      }
      expect(await $.classic.SessionStart({ source })).toEqual({ additionalContext: ['from the engine'] })
      for (const surface of ['terminal', 'desktop'] as const) {
        const ui = await $.ui.mount({ ...BAND, surface })
        expect(await ui.find({ type: 'Text', text: '██░░░░░░░░ 25%' })).toBeDefined()
        await ui.unmount()
      }
    })
  }

  test('hiding and showing the band is kept in the store, past the session', async ($, on) => {
    mock.clock(on, { now: NOW })
    stubSession(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('ui.render', ENGINE_BAND)
    // The store beneath the plugin, kept here so the test can read what was written
    const kept = new Map<string, unknown>()
    on('store.get', ($, e) => ({ value: kept.get(e.key) }))
    on('store.set', ($, e) => {
      kept.set(e.key, e.value)
      return { value: undefined }
    })

    await $.session.measure({ ...CALM, changed: ['context'] })
    const shown = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await shown.press({ key: 'hide' })
    expect(kept.get('hidden')).toBe(true)
    await $.command.run({ ...COMMAND, args: 'show' })
    expect(kept.get('hidden')).toBe(false)
    await $.command.run({ ...COMMAND, args: 'hide' })
    expect(kept.get('hidden')).toBe(true)
  })

  // /clear, /resume and /branch reset $.state; a test's state starts out that way, so
  // the store alone says the band was hidden
  for (const source of ['clear', 'resume', 'fork'] as const) {
    test(`a band hidden before ${source} is still hidden after it`, async ($, on) => {
      mock.clock(on, { now: NOW })
      stubSession(on)
      on('ui.status', () => ({ value: undefined }))
      on('session.usage', () => ({ value: { startedAt: 0, ...CALM } }))
      on('classic.SessionStart', () => ({}))
      on('ui.render', ENGINE_BAND)
      mock.store(on, { hidden: true })

      await $.classic.SessionStart({ source })
      for (const surface of ['terminal', 'desktop'] as const) {
        const ui = await $.ui.mount({ ...BAND, surface })
        expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
        await ui.unmount()
      }
    })
  }

  test('a band hidden in an earlier session starts hidden', async ($, on) => {
    mock.clock(on, { now: NOW })
    stubSession(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.usage', () => ({ value: { startedAt: 0, ...CALM } }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('ui.render', ENGINE_BAND)
    mock.store(on, { hidden: true })

    await $.session.start({ cwd: 'C:\\work\\ai-tools', surface: 'terminal', isInteractive: true })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('/token-meter hide and show toggle the band', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    stubSession(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('ui.render', ENGINE_BAND)

    await $.session.measure({ ...CALM, changed: ['context'] })
    const hidden = await $.command.run({ ...COMMAND, args: 'hide' })
    expect(hidden.text).toBe('band hidden')

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
    await ui.unmount()

    await $.command.run({ ...COMMAND, args: 'show' })
    const shown = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await shown.find({ type: 'Text', text: '$1.23' })).toBeDefined()

    const unknown = await $.command.run({ ...COMMAND, args: 'status-probe' })
    expect(unknown.text).toBe('Usage: /token-meter [show | hide]')
  })
})
