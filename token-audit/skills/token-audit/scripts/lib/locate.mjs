// Finding transcripts on disk: config dir, project folder, session files, subagent files.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

// exitCode: 1 usage error, 2 nothing found.
export class AuditError extends Error {
  constructor(message, exitCode) {
    super(message)
    this.exitCode = exitCode
  }
}

export function configDir(explicit, env = process.env) {
  return path.resolve(explicit || env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'))
}

const projectsRoot = config => path.join(config, 'projects')

// Claude Code names a project folder after its working directory, with every character
// other than a letter or digit replaced by `-`. Names over 200 characters are truncated
// and get a hash suffix, which is not reproduced here.
export const projectFolderName = cwd => cwd.replace(/[^a-zA-Z0-9]/g, '-')
const MAX_FOLDER_NAME = 200

const isDir = p => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}
const isFile = p => {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}
const subdirs = p => {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(p, e.name))
  } catch {
    return []
  }
}

// The project folder for the working directory. Returns { dir, warning }.
export function projectForCwd(config, cwd) {
  const root = projectsRoot(config)
  const name = projectFolderName(cwd)
  const dir = path.join(root, name)
  if (isDir(dir)) return { dir }
  if (name.length > MAX_FOLDER_NAME) {
    const prefix = name.slice(0, MAX_FOLDER_NAME)
    const match = subdirs(root).filter(d => path.basename(d).startsWith(prefix))
    if (match.length === 1) return { dir: match[0] }
  }
  return { dir, warning: `no transcripts folder for ${cwd} (looked for ${dir}); pass --project or --session` }
}

export function listSessions(projectDir) {
  let entries
  try {
    entries = fs.readdirSync(projectDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.jsonl'))
    .map(e => ({ id: e.name.slice(0, -'.jsonl'.length), file: path.join(projectDir, e.name) }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

// A session by full id or unique prefix. Looks in `projectDir` first when given, then in
// every project. Returns { id, file, projectDir }.
export function findSession(config, idOrPrefix, projectDir) {
  const id = String(idOrPrefix || '').trim()
  if (!/^[\w.-]+$/.test(id)) throw new AuditError(`not a session id: ${JSON.stringify(id)}`, 1)
  const dirs = projectDir ? [projectDir, ...subdirs(projectsRoot(config)).filter(d => d !== projectDir)] : subdirs(projectsRoot(config))
  for (const dir of dirs) {
    const file = path.join(dir, `${id}.jsonl`)
    if (isFile(file)) return { id, file, projectDir: dir }
  }
  const matches = []
  for (const dir of dirs) {
    for (const s of listSessions(dir)) if (s.id.startsWith(id)) matches.push({ ...s, projectDir: dir })
    if (projectDir && dir === projectDir && matches.length) break
  }
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    throw new AuditError(`session prefix ${id} is ambiguous: ${matches.slice(0, 5).map(m => m.id).join(', ')}`, 1)
  }
  throw new AuditError(`no session ${id} under ${projectsRoot(config)}`, 2)
}

// A session given as a path to its .jsonl file.
export function sessionFromPath(file) {
  if (!isFile(file)) throw new AuditError(`no such transcript: ${file}`, 2)
  const abs = path.resolve(file)
  return { id: path.basename(abs, '.jsonl'), file: abs, projectDir: path.dirname(abs) }
}

// Subagent transcripts: every .jsonl under <project>/<session-id>/, recursively.
export function subagentFiles(projectDir, sessionId) {
  const out = []
  const walk = dir => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p)
    }
  }
  walk(path.join(projectDir, sessionId))
  return out.sort()
}

// Lines of a file, read in chunks so a large transcript never becomes one string.
export function* readLines(file) {
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(1 << 20)
  const decoder = new StringDecoder('utf8')
  let rest = ''
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) {
      const parts = (rest + decoder.write(buf.subarray(0, n))).split('\n')
      rest = parts.pop()
      yield* parts
    }
    rest += decoder.end()
    if (rest) yield rest
  } finally {
    fs.closeSync(fd)
  }
}
