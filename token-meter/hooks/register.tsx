// token-meter: a band above the prompt with the folder and git branch, model and effort,
// context use, rate limits and cost, plus a `$.ui.status` alert line only while context
// or a limit is at ALERT_AT or more. Figures are pushed by `session.measure`. The only
// file read is the repository's HEAD; no process, network or environment is touched.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { alertText, bar, branchOf, clip, dirsUp, gitDirOf, label, level, modelName, place, toMeter, tokens, until } from './format'
import type { Figures } from './format'

const meter = atom({ plugin: 'token-meter', key: 'meter' } as const, null)
const isHidden = atom({ plugin: 'token-meter', key: 'isHidden' } as const, false)
const effort = atom({ plugin: 'token-meter', key: 'effort' } as const, null)
const branch = atom({ plugin: 'token-meter', key: 'branch' } as const, null)

const USAGE = 'Usage: /token-meter [show | hide]'

// A failed read or write is logged instead of thrown. The engine would pass the event on
// anyway, but the hook would lose the rest of its work: in session.start, the command.
const guarded = async ($: EngineInterface, what: string, work: () => Promise<void>): Promise<void> => {
  try {
    await work()
  } catch (error) {
    $.ui.log(`${what} failed: ${String(error)}`, { to: 'debug' })
  }
}

const record = async ($: EngineInterface, figures: Figures): Promise<void> => {
  const m = toMeter(figures)
  await update($, meter, () => m)
  $.ui.status(alertText(m))
}

const readText = ($: EngineInterface, path: string): Promise<string | null> =>
  $.fs.read(path).catch(() => null)

// The checked-out branch, from HEAD in the nearest `.git` at or above the working
// directory; a worktree's `.git` file names its own HEAD. No git process runs.
const readBranch = async ($: EngineInterface): Promise<string | null> => {
  const repo = await $.session.repo()
  if (repo === null) return null
  for (const dir of dirsUp(await $.session.cwd(), repo.root)) {
    let head = await readText($, `${dir}/.git/HEAD`)
    if (head === null) {
      const dotGit = await readText($, `${dir}/.git`)
      const gitDir = dotGit === null ? null : gitDirOf(dotGit, dir)
      if (gitDir !== null) head = await readText($, `${gitDir}/HEAD`)
    }
    if (head !== null) return branchOf(head)
  }
  return null
}

// Never rejects, so the clock's `void refreshBranch($)` leaves nothing unhandled. A failed
// read is logged and keeps the branch last read.
const refreshBranch = ($: EngineInterface): Promise<void> =>
  guarded($, 'branch refresh', async () => {
    const name = await readBranch($)
    if ((await read($, branch)) !== name) await update($, branch, () => name)
  })

// Hiding is a preference, so it is kept in $.store as well: that outlives the session,
// and the $.state reset of /clear, /resume and /branch. /token-meter show undoes it.
const HIDDEN_KEY = 'hidden'

const setHidden = async ($: EngineInterface, hidden: boolean): Promise<void> => {
  await update($, isHidden, () => hidden)
  try {
    await $.store.set(HIDDEN_KEY, hidden)
  } catch (error) {
    $.ui.log(`band ${hidden ? 'hidden' : 'shown'} for this session only: ${String(error)}`, { to: 'debug' })
  }
}

// null when the store cannot be read: the band then stays as $.state has it, rather than
// coming back after the user hid it
const readHidden = async ($: EngineInterface): Promise<boolean | null> => {
  try {
    return (await $.store.get(HIDDEN_KEY)) === true
  } catch (error) {
    $.ui.log(`hidden setting not read, band left as it is: ${String(error)}`, { to: 'debug' })
    return null
  }
}

const reload = async ($: EngineInterface): Promise<void> => {
  await guarded($, 'reload', async () => {
    const hidden = await readHidden($)
    if (hidden !== null && (await read($, isHidden)) !== hidden) await update($, isHidden, () => hidden)
    await record($, await $.session.usage())
  })
  await refreshBranch($)
}

export const register: Register = on => {
  // The command and the clock come before the reload, so nothing it does can cost them
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'token-meter', description: 'Show or hide the token meter band', argumentHint: '[show|hide]', immediate: true })
    } catch (error) {
      $.ui.log(`/token-meter not registered: ${String(error)}`, { to: 'debug' })
    }
    // Keeps the reset countdowns current while the session is idle, and picks up a
    // checkout made outside the session
    $.clock.every(60_000, () => {
      void refreshBranch($)
      $.ui.invalidate('ui.render')
    })
    await reload($)
    return next(e)
  })

  // /clear, /resume and /branch reset $.state, and session.start does not fire again
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await reload($)
    return next(e)
  })

  // Fires after each response, so a checkout Claude ran shows by the turn's end
  on('session.measure', async ($, e, next) => {
    await guarded($, 'measurement', () => record($, e))
    await refreshBranch($)
    return next(e)
  })

  // The effort each main-thread request is sent with: no $.session method has it.
  // Observe only; the request goes on unchanged.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const level = e.effort === undefined ? null : String(e.effort)
      // Logged, not thrown: a failed write must not hold up the request
      await guarded($, 'effort', async () => {
        if ((await read($, effort)) !== level) await update($, effort, () => level)
      })
    }
    return yield* next(e)
  })

  on('command.run', { command: 'token-meter' }, async ($, e) => {
    const verb = e.args.trim()
    if (verb !== 'show' && verb !== 'hide') return { text: USAGE }
    await setHidden($, verb === 'hide')
    return { text: `band ${verb === 'hide' ? 'hidden' : 'shown'}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, meter)
    if (e.props.hasSurvey || m === null || (await read($, isHidden))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    // Read live, so /model, /cd and worktree moves show on the next redraw
    const [now, cwd, root, model, effortLevel, branchName] = await Promise.all([
      $.clock.now(), $.session.cwd(), $.session.root(), $.session.model(), read($, effort), read($, branch),
    ])
    const pct = m.percent ?? 0
    const isNarrow = e.props.bodyColumns < 70

    // An empty string is still a Box child and takes a column gap; an empty list does not
    return (
      <Box flexDirection="row" columnGap={2}>
        <Text>
          <Text color="claude">{place(cwd, root)}</Text>
          {branchName === null ? '' : <Text><Text dimColor> ⎇</Text> {clip(branchName, isNarrow ? 20 : 40)}</Text>}
        </Text>
        <Text>
          {modelName(model)}
          {effortLevel === null ? '' : <Text dimColor> {effortLevel}</Text>}
        </Text>
        <Text>
          <Text dimColor>ctx </Text>
          {m.percent === null
            ? <Text dimColor>--</Text>
            : <Text color={level(pct)}>{isNarrow ? '' : bar(pct) + ' '}{`${pct}%`}</Text>}
          {m.tokens === null || isNarrow ? '' : <Text dimColor> {tokens(m.tokens)}/{tokens(m.window)}</Text>}
        </Text>
        {m.limits.map(l => (
          <Text key={l.kind}>
            <Text dimColor>{label(l.kind)} </Text>
            <Text color={level(l.percentUsed)}>{Math.round(l.percentUsed)}%</Text>
            {l.resetsAt === null || isNarrow ? '' : <Text dimColor> ↻{until(l.resetsAt, now)}</Text>}
          </Text>
        ))}
        {m.usd === null || m.usd === 0 ? [] : [<Text key="usd" dimColor>${m.usd.toFixed(2)}</Text>]}
        <Button key="hide" label="hide" plain onPress={() => setHidden($, true)} />
      </Box>
    )
  })
}
