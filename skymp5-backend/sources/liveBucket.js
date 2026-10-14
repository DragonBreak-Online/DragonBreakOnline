'use strict'
// The check every script that writes a client package runs first: never the live client files, unless DBO_MERGE_LIVE_BUCKET=1 is given for that one command.
// 6 Oct: merge-files.js run in the live checkout without CLIENT_FILES_DIR zipped a stale copy onto the live zip and manifest, and players hung at the logo.

const fs     = require('fs')
const path   = require('path')
const config = require('../config')

const BACKEND = path.join(__dirname, '..')
// The live checkout on CT 115; config.releaseRepo (DBO_RELEASE_REPO) can add another, never remove this one
const LIVE_REPO = '/opt/alduinak'
// The same default as config.clientFilesDir: the bucket the backend of this checkout serves
const DEFAULT_CLIENT_FILES_DIR = path.join(BACKEND, '..', 'build', 'client-files')
// Where merge-files.js writes files-version.json, the launcher's update signal when this checkout is live
const MANIFEST = path.join(BACKEND, 'data', 'files-version.json')
const OPT_IN = 'DBO_MERGE_LIVE_BUCKET'

// Windows compares paths without case
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

// Where a write to p lands: its real path, else its nearest existing parent's real path plus the rest; a link to nowhere yet is followed too
function realPath(p, depth = 0) {
  const rest = []
  let dir = path.resolve(p)
  for (;;) {
    try { return path.join(fs.realpathSync(dir), ...rest) } catch { /* not there yet, or a link to nowhere */ }
    let link = null
    try { if (depth < 40 && fs.lstatSync(dir).isSymbolicLink()) link = fs.readlinkSync(dir) } catch { /* not there */ }
    if (link !== null) return path.join(realPath(path.resolve(realPath(path.dirname(dir), depth + 1), link), depth + 1), ...rest)
    const up = path.dirname(dir)
    if (up === dir) return path.resolve(p)
    rest.unshift(path.basename(dir))
    dir = up
  }
}

function isInside(child, parent) {
  const rel = path.relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

// The same file on disk under two names (a hard link): false when either is missing
function sameInode(a, b) {
  try {
    const x = fs.statSync(a, { bigint: true })
    const y = fs.statSync(b, { bigint: true })
    return x.ino !== 0n && x.dev === y.dev && x.ino === y.ino
  } catch { return false }
}

// A folder's device and inode after links, or null when p is no folder
function dirId(p) {
  try {
    const s = fs.statSync(p, { bigint: true })
    return s.isDirectory() && s.ino !== 0n ? `${s.dev}:${s.ino}` : null
  } catch { return null }
}

// The folder a write to p lands in: p when it is a folder, else its nearest existing parent
function landingDirId(p) {
  for (let dir = path.resolve(p); ;) {
    const id = dirId(dir)
    if (id) return id
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

const liveRepos = () => [...new Set([LIVE_REPO, config.releaseRepo].filter(Boolean).map(repo => realPath(repo)))]

// Each live checkout's bucket and manifest after links, and every folder of those buckets and their data folders by device and inode, which a bind mount keeps and realpath cannot see
function liveState() {
  const repos = liveRepos().map(repo => ({
    bucket:   realPath(path.join(repo, 'build', 'client-files')),
    manifest: realPath(path.join(repo, 'skymp5-backend', 'data', 'files-version.json')),
  }))
  const dirs = new Map()
  const walk = dir => {
    const id = dirId(dir)
    if (!id || dirs.has(id)) return
    dirs.set(id, dir)
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) if (e.isDirectory()) walk(path.join(dir, e.name))
  }
  for (const { bucket, manifest } of repos) {
    walk(bucket)
    const data = dirId(path.dirname(manifest))
    if (data && !dirs.has(data)) dirs.set(data, path.dirname(manifest))
  }
  return { repos, own: realPath(DEFAULT_CLIENT_FILES_DIR), dirs }
}

// Why writing p would write the live client files, or null; checkoutOnly leaves out this checkout's default bucket
function livePath(p, { checkoutOnly = false, state = liveState() } = {}) {
  const real = realPath(p)
  for (const { bucket, manifest } of state.repos) {
    if (isInside(real, bucket)) return `${p} is in the live client files bucket (${bucket})`
    if (samePath(real, manifest)) return `${p} is the live manifest ${manifest}`
    for (const file of [manifest, path.join(bucket, config.clientZipName)]) {
      if (sameInode(p, file)) return `${p} is a hard link to the live ${path.basename(file)} (${file}): delete it first`
    }
  }
  const same = state.dirs.get(landingDirId(p))
  if (same) return `${p} lands in the live folder ${same} under another name (a bind mount): unmount it first`
  if (!checkoutOnly && isInside(real, state.own)) return `${p} is in the default bucket, the one the backend of this checkout serves (${state.own})`
  return null
}

// Why writing into this bucket, manifest and the paths in writes would write the live client files, or null
function liveTarget({ bucket, manifest = null, writes = [], checkoutOnly = false }, state = liveState()) {
  const dir = realPath(bucket)
  for (const { bucket: liveBucket, manifest: liveManifest } of state.repos) {
    if (isInside(dir, liveBucket)) return `${bucket} is the live client files bucket (${liveBucket})`
    if (manifest && samePath(realPath(manifest), liveManifest)) return `this is the live checkout: it would rewrite the live manifest ${liveManifest}`
  }
  if (!checkoutOnly && samePath(dir, state.own)) return `${bucket} is the default bucket, the one the backend of this checkout serves (CLIENT_FILES_DIR is unset or names it)`
  for (const p of [bucket, ...(manifest ? [manifest] : []), ...writes]) {
    const why = livePath(p, { checkoutOnly, state })
    if (why) return why
  }
  return null
}

// Every link under dir (not followed): a write through one lands wherever it points
function linksUnder(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isSymbolicLink()) out.push(p)
    else if (e.isDirectory()) linksUnder(p, out)
  }
  return out
}

// The opt-in counts for one command only: the backend's or the cwd's .env that sets it (dotenv loads both), or null; Windows env names ignore case
function optInFile() {
  const line = new RegExp(`^\\s*(?:export\\s+)?${OPT_IN}\\s*(?:=|:)`, process.platform === 'win32' ? 'mi' : 'm')
  for (const file of new Set([path.join(BACKEND, '.env'), path.resolve('.env')])) {
    try { if (line.test(fs.readFileSync(file, 'utf8'))) return file } catch { /* no .env there */ }
  }
  return null
}

const optedIn = (env = process.env) => env[OPT_IN] === '1' && !optInFile()

function refusalMessage(reason) {
  return `refusing to write into the live client files: ${reason}. ` +
    'Build a client release in a work folder instead (CLIENT_FILES_DIR=<work folder>, run from a scratch backend export), ' +
    'gate it, and ship it through the staged release path, which swaps the gated skymp-client.zip and files-version.json in. ' +
    `Only to rebuild the live files in place on purpose, run this one command with ${OPT_IN}=1.`
}

// The refusal for a reason to refuse, in a script that honours the opt-in, or null to go ahead
function refusalFor(reason, env = process.env) {
  if (!reason) return null
  const file = optInFile()
  if (file) {
    return `${refusalMessage(reason)} ${OPT_IN} is set in ${file}, which would turn this guard off for every run from there: ` +
      'it counts only on the command line, so remove it from that file.'
  }
  return optedIn(env) ? null : refusalMessage(reason)
}

const refusal = (targets, env = process.env) => refusalFor(liveTarget(targets), env)

// Checks each path a script is about to write after its first refusal(): throws the same refusal for a live one
function writeGuard(env = process.env) {
  const state = liveState()
  const allowed = optedIn(env)
  return p => {
    const why = livePath(p, { state })
    if (why && !allowed) throw new Error(refusalFor(why, env))
  }
}

// Any file but the skipped names, at any depth
function hasFiles(dir, skip = new Set()) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
  return entries.some(e => !skip.has(e.name) && (!e.isDirectory() || hasFiles(path.join(dir, e.name), skip)))
}

// git -C inside a plain folder (or one with a broken .git) of another checkout lands in that checkout: true only when the top level git printed is dir itself
function isOwnTopLevel(dir, printed) {
  try { return samePath(fs.realpathSync(String(printed).trim()), fs.realpathSync(dir)) } catch { return false }
}

// A .git file or link can borrow another checkout's git folder: true only when the one git printed is dir's own .git folder
function isOwnGitDir(dir, printed) {
  try {
    const own = path.join(fs.realpathSync(dir), '.git')
    return fs.lstatSync(own).isDirectory() && samePath(fs.realpathSync(String(printed).trim()), own)
  } catch { return false }
}

// Where a pull writes besides the common folder, each as git rev-parse --git-path prints it
const GIT_PATHS = ['refs', 'objects', 'packed-refs', 'index']
// What git -C <dir> must print for notOwnCheckout, one a line: its top level, its git folder, its common folder, then GIT_PATHS
const REV_PARSE = ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir', ...GIT_PATHS.flatMap(p => ['--git-path', p])]

// Why a .git folder shares another checkout's (a commondir file, or a link as git-new-workdir makes), or null
function sharedGitDir(gitDir) {
  if (fs.existsSync(path.join(gitDir, 'commondir'))) return `${gitDir} holds a commondir file, so git keeps its refs and objects in another checkout`
  const linked = dir => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (err) { return `${dir} cannot be read (${err.code})` }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isSymbolicLink()) return `${p} is a link to ${fs.readlinkSync(p)}, so git would write through it`
      const why = e.isDirectory() ? linked(p) : null
      if (why) return why
    }
    return null
  }
  return linked(gitDir)
}

// Why a clone or pull in dir would touch a live checkout (dir is one, sits in one or holds one), or null; no opt-in
function nearLiveCheckout(dir) {
  const real = realPath(dir)
  for (const repo of liveRepos()) {
    if (isInside(real, repo)) return `${dir} is in the live checkout ${repo}`
    if (isInside(repo, real)) return `${dir} holds the live checkout ${repo}`
  }
  return null
}

// Why a pull in dir would pull a checkout other than dir's own, or null. printed: what git -C dir REV_PARSE printed ('' when it failed)
function notOwnCheckout(dir, printed) {
  const [top = '', gitDir = '', ...paths] = String(printed || '').trim().split(/\r?\n/)
  if (!isOwnTopLevel(dir, top)) return `${dir} is not its own git checkout (git -C lands in ${top.trim() || 'no checkout'})`
  if (!isOwnGitDir(dir, gitDir)) return `${dir} has no git folder of its own: its .git is a file or a link, and git uses ${gitDir.trim()}`
  const own = path.join(fs.realpathSync(dir), '.git')
  const shared = sharedGitDir(own)
  if (shared) return `${dir} has no git folder of its own: ${shared}`
  const names = ['common folder', ...GIT_PATHS]
  if (paths.length !== names.length) return `${dir}: git did not say where it keeps its ${names.join(', ')}`
  for (const [i, printedPath] of paths.entries()) {
    const real = realPath(path.resolve(dir, printedPath.trim()))
    const near = nearLiveCheckout(real)
    if (near) return `${dir} has no git folder of its own: git keeps its ${names[i]} at ${real}, and ${near}`
    if (!isInside(real, own)) return `${dir} has no git folder of its own: git keeps its ${names[i]} at ${real}, outside ${own}`
  }
  return null
}

module.exports = {
  LIVE_REPO, DEFAULT_CLIENT_FILES_DIR, MANIFEST, OPT_IN,
  realPath, sameInode, dirId, liveState, livePath, liveTarget, linksUnder, optInFile, optedIn, refusalMessage, refusalFor, refusal, writeGuard, hasFiles,
  isOwnTopLevel, isOwnGitDir, REV_PARSE, GIT_PATHS, sharedGitDir, nearLiveCheckout, notOwnCheckout,
}
