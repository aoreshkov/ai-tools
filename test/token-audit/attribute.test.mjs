// Tests for token-audit's attribution: command keys, categories, per-action split, carry
// and session totals. Synthetic fixtures only; no model calls.
//
// Run with: node --test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { parseTranscript } from '../../token-audit/skills/token-audit/scripts/lib/transcript.mjs'
import { readLines } from '../../token-audit/skills/token-audit/scripts/lib/locate.mjs'
import {
  REPLY, actionKey, analyzeSession, categoryBreakdown, commandCategory, commandKey, costEq, describe, estimateTokens, sessionTotals,
} from '../../token-audit/skills/token-audit/scripts/lib/attribute.mjs'

const fixture = rel => fileURLToPath(new URL(`../fixtures/token-audit/projects/${rel}`, import.meta.url))
const parse = (rel, opts) => parseTranscript(readLines(fixture(rel)), opts)
const byKey = list => Object.fromEntries(list.map(a => [a.key, a]))

test('command keys strip cd, export and env prefixes', () => {
  const cases = [
    ['cd /work/demo && grep -n x a.kt', 'grep'],
    ['cd "C:/with space/dir"; sed -n 1,20p a.kt', 'sed'],
    ['export JAVA_HOME=/opt/jdk && ./gradlew test', 'gradlew test'],
    ['export JAVA_HOME=/opt/jdk PATH="$JAVA_HOME/bin:$PATH" && ./gradlew build', 'gradlew build'],
    ["$env:JAVA_HOME='C:\\jdk'; .\\gradlew.bat test", 'gradlew test'],
    ['$s = Get-Content -Raw a.txt', 'Get-Content'],
    ['f=src/Parser.kt && sed -i -e s/a/b/ $f', 'sed -i'],
    ['C=$(ls -d ~/.gradle); find "$C" -name x', 'find'],
    ['GRADLE_OPTS=-Xmx1g ./gradlew check', 'gradlew check'],
    ['# look first\ncat a.kt', 'cat'],
    ['f=x && \\\n  sed -i s/a/b/ $f', 'sed -i'],
    ['& "C:\\tools\\rg.exe" foo', 'rg'],
    ['for f in a b; do cat $f; done', 'cat'],
    ['/c/jdk/bin/java -jar app.jar', 'java'],
    ['', '(empty)'],
  ]
  for (const [cmd, key] of cases) assert.equal(commandKey(cmd), key, cmd)
})

test('command keys keep git subcommands and collapse gradle module paths', () => {
  assert.equal(commandKey('git -C /work/demo status --short'), 'git status')
  assert.equal(commandKey('git --no-pager log -5'), 'git log')
  assert.equal(commandKey('./gradlew :app:core:test --console=plain 2>&1 | tail -20'), 'gradlew :*:test')
  assert.equal(commandKey('./gradlew -q core:jvmTest :cli:installDist'), 'gradlew :*:jvmTest :*:installDist')
  assert.equal(commandKey('npm test -- --watch'), 'npm test')
  assert.equal(commandKey('perl -0777 -pi -e s/a/b/ x.kt'), 'perl -i')
})

test('categories come from the leading command', () => {
  const cases = [
    // The prototype's regex over the whole command got each of these wrong.
    ['git log --oneline | grep gradlew', 'git'],
    ['grep -n FAILED build/reports/tests/index.html', 'read/search'],
    ['tail -50 build/output.txt', 'read/search'],
    ['cd /work/demo && git status', 'git'],
    ['python -c "open(p,\'w\').write(s)"', 'other'],
    ['export JAVA_HOME=/opt/jdk && ./gradlew test', 'build/test/wait'],
    // Edits through the shell.
    ["cat > notes.md <<'EOF'\nhello\nEOF", 'edit'],
    ["cat <<'EOF' > notes.md\nhello\nEOF", 'edit'],
    ['tee notes.md <<EOF\nhello\nEOF', 'edit'],
    ['sed -i s/a/b/ x.kt', 'edit'],
    ['perl -pi -e s/a/b/ x.kt', 'edit'],
    ['rm build/tmp.txt', 'edit'],
    ['Set-Content -Path a.txt -Value x', 'edit'],
    // Reads.
    ['sed -n 200,630p engine/Engine.kt', 'read/search'],
    ['cat a.kt b.kt', 'read/search'],
    ["cat <<'EOF'\nnot a file\nEOF", 'read/search'],
    ['rg -n foo', 'read/search'],
    ['ls -la build', 'read/search'],
    ['Get-ChildItem -Recurse', 'read/search'],
    // Builds and waits.
    ['until grep -q done log.txt; do sleep 5; done', 'build/test/wait'],
    ['sleep 30', 'build/test/wait'],
    ['timeout 600 ./gradlew test', 'build/test/wait'],
    ['wsl -e bash -lc "make"', 'build/test/wait'],
    ['npm test', 'build/test/wait'],
    ['gh pr view 1', 'git'],
    ['node script.mjs', 'other'],
  ]
  for (const [cmd, cat] of cases) assert.equal(commandCategory(cmd), cat, cmd)
})

test('tool categories and action keys', () => {
  const tu = (name, input = {}) => ({ name, input })
  assert.equal(actionKey(tu('Agent', { subagent_type: 'Explore' })), 'Agent(Explore)')
  assert.equal(actionKey(tu('Agent')), 'Agent(general-purpose)')
  assert.equal(actionKey(tu('Skill', { skill: 'review-kit:review' })), 'Skill(review-kit:review)')
  assert.equal(actionKey(tu('PowerShell', { command: 'git status' })), 'PowerShell: git status')
  assert.equal(actionKey(tu('mcp__x__y')), 'mcp__x__y')
})

test('describe shows paths relative to the session cwd', () => {
  assert.equal(describe({ name: 'Read', input: { file_path: '/work/demo/src/A.kt' } }, '/work/demo'), 'src/A.kt')
  assert.equal(describe({ name: 'Read', input: { file_path: 'C:\\work\\demo\\A.kt' } }, 'C:\\work\\demo'), 'A.kt')
  assert.equal(describe({ name: 'Grep', input: { pattern: 'TODO', path: '/elsewhere' } }, '/work/demo'), 'TODO in /elsewhere')
  assert.equal(describe({ name: 'Agent', input: { description: 'Map  the\nmodules' } }), 'Map the modules')
})

test('result estimates: chars / 3.5, images a fixed 1,600', () => {
  assert.equal(estimateTokens({ chars: 350, images: 0 }), 100)
  assert.equal(estimateTokens({ chars: 700, images: 1 }), 1800)
  assert.equal(estimateTokens(null), 0)
})

test('per-session totals and per-action split', () => {
  const a = analyzeSession(parse('fixture-project/basic.jsonl'))
  assert.deepEqual(a.totals.main, { calls: 4, in: 25, cw: 3300, cr: 3500, out: 370, total: 7195 })
  const k = byKey(a.actions)
  assert.equal(k['Bash: grep'].tokens, 1060)
  assert.equal(k.Edit.tokens, 1305)
  assert.equal(k.Read.tokens, 1325)
  assert.equal(k[REPLY].tokens, 3505)
  assert.equal(a.actions[0].key, REPLY)
  assert.equal(a.grand, 7195)
  assert.deepEqual(a.context.profile, [1010, 1010, 1205, 1305, 3305])
  assert.equal(a.context.peak, 3305)
})

test('carry: result size times the later calls of its segment', () => {
  const k = byKey(analyzeSession(parse('fixture-project/basic.jsonl')).actions)
  assert.equal(k['Bash: grep'].carry, 300)
  assert.equal(k.Edit.carry, 20)
  assert.equal(k.Read.carry, 1800)
})

test('carry stops at a compact boundary', () => {
  const a = analyzeSession(parse('fixture-project/compacted.jsonl'))
  const k = byKey(a.actions)
  assert.equal(k.Read.carry, 100)
  assert.equal(k['Bash: gradlew :*:test'].carry, 0)
  assert.equal(a.context.compactions, 1)
  assert.deepEqual(a.turns.map(t => [t.text, t.calls, t.tokens]), [['go on', 2, 1020], ['run the tests', 2, 320]])
})

test('parallel tool uses split a call equally', () => {
  const a = analyzeSession(parse('fixture-project/parallel.jsonl'))
  const k = byKey(a.actions)
  assert.equal(k.Read.tokens, 100)
  assert.equal(k.Grep.tokens, 100)
  assert.equal(k.Glob.tokens, 100)
  assert.equal(a.parallelCalls, 1)
  assert.deepEqual(categoryBreakdown(parse('fixture-project/parallel.jsonl')).map(c => [c.name, c.uses, c.tokens]), [
    ['read/search', 3, 300],
    ['git', 1, 200],
  ])
})

test('subagent transcripts and sidechain records add to their session', () => {
  const parent = parse('fixture-project/with-subagents.jsonl')
  const sub = parse('fixture-project/with-subagents/subagents/agent-a1.jsonl', { sidechain: true })
  const t = sessionTotals(parent, [sub])
  assert.equal(t.main.total, 1000)
  assert.equal(t.sub.total, 1050)
  assert.equal(t.all.total, 2050)
  assert.equal(t.all.calls, 4)
  assert.equal(t.subagentTranscripts, 1)
  assert.equal(t.costEq, costEq(t.all))
  assert.equal(sessionTotals(parent).sub.total, 50)
})

test('cost-eq uses the given weights', () => {
  const t = { in: 1, cw: 2, cr: 10, out: 1 }
  assert.equal(costEq(t), 1 + 2.5 + 1 + 5)
  assert.equal(costEq(t, { in: 0, cw: 0, cr: 0, out: 1 }), 1)
})
