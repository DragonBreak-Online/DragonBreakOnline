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

// For a path not created yet: the real path of its nearest existing parent, with the rest added
function realPath(p) {
  const rest = []
  let dir = path.resolve(p)
  for (;;) {
    try { return path.join(fs.realpathSync(dir), ...rest) } catch { /* not there yet: try the parent */ }
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

const liveRepos = () => [...new Set([LIVE_REPO, config.releaseRepo].filter(Boolean).map(realPath))]

// Why writing into this bucket (and this manifest, when given) would write the live client files, or null
function liveTarget({ bucket, manifest = null }) {
  const dir = realPath(bucket)
  for (const repo of liveRepos()) {
    const liveBucket = realPath(path.join(repo, 'build', 'client-files'))
    if (isInside(dir, liveBucket)) return `${bucket} is the live client files bucket (${liveBucket})`
    const liveManifest = realPath(path.join(repo, 'skymp5-backend', 'data', 'files-version.json'))
    if (manifest && realPath(manifest) === liveManifest) return `this is the live checkout: it would rewrite the live manifest ${liveManifest}`
  }
  if (dir === realPath(DEFAULT_CLIENT_FILES_DIR)) return `${bucket} is the default bucket, the one the backend of this checkout serves (CLIENT_FILES_DIR is unset or names it)`
  return null
}

const optedIn = (env = process.env) => env[OPT_IN] === '1'

function refusalMessage(reason) {
  return `refusing to write into the live client files: ${reason}. ` +
    'Build a client release in a work folder instead (CLIENT_FILES_DIR=<work folder>, run from a scratch backend export), ' +
    'gate it, and ship it through the staged release path, which swaps the gated skymp-client.zip and files-version.json in. ' +
    `Only to rebuild the live files in place on purpose, run this one command with ${OPT_IN}=1.`
}

// The refusal for a script that honours the opt-in, or null to go ahead
function refusal(targets, env = process.env) {
  const reason = liveTarget(targets)
  return reason && !optedIn(env) ? refusalMessage(reason) : null
}

// Any file but the skipped names, at any depth
function hasFiles(dir, skip = new Set()) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
  return entries.some(e => !skip.has(e.name) && (!e.isDirectory() || hasFiles(path.join(dir, e.name), skip)))
}

// git -C inside a plain folder (or one with a broken .git) of another checkout lands in that checkout: true only when the top level git printed is dir itself
function isOwnTopLevel(dir, printed) {
  try { return fs.realpathSync(String(printed).trim()) === fs.realpathSync(dir) } catch { return false }
}

module.exports = { LIVE_REPO, DEFAULT_CLIENT_FILES_DIR, MANIFEST, OPT_IN, realPath, liveTarget, optedIn, refusalMessage, refusal, hasFiles, isOwnTopLevel }
