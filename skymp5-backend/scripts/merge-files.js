'use strict'

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

/**
 * Merge pipeline: copies the client source into the bucket the launcher downloads and builds the zip.
 *   build/dist/client (via `npm run populate`) -> build/client-files/root/ -> build/client-files/<zip> + data/files-version.json
 * SKSE is NOT included; the user manages it via the Vortex collection.
 * Run standalone from a scratch backend export: CLIENT_FILES_DIR=<work folder> node scripts/merge-files.js.
 * Refuses the live bucket and the live manifest (sources/liveBucket.js) unless DBO_MERGE_LIVE_BUCKET=1 is given for this one
 * command (never from a .env). Called by scripts/setup-client.js and routes/webhook.js.
 */

const path               = require('path')
const fs                 = require('fs')
const crypto             = require('crypto')
const { execFileSync }   = require('child_process')
const archiver           = require('archiver')
const config             = require('../config')
const { findSymbolFiles } = require('./archive-symbols')
const liveBucket         = require('../sources/liveBucket')

const ROOT = path.join(__dirname, '..')

const CLIENT_SRC   = path.join(ROOT, 'sources', 'client')
const BUCKET       = config.clientFilesDir
const OUTPUT_DIR   = path.join(BUCKET, 'root')
const ZIP_PATH     = path.join(BUCKET, config.clientZipName)
const VERSION_FILE = path.join(ROOT, 'data', 'files-version.json')

// skymp5-client-settings.txt is the launcher's per-player file (server ip, hotkey rebinds): never copied and never listed in the manifest, since the launcher rewrites it on every launch
const SKIP_ALWAYS = new Set(['.git', '.gitignore', '.gitattributes', 'skymp5-client-settings.txt'])

// Version helpers

function routeClientVersion() {
  return require('../routes/version').readConst('CLIENT_VERSION', '').trim()
}

// Short git hash for the client files version: tries the legacy sources/client checkout, then the skyrp monorepo; changes only on new commits, 'nogit' if neither is a repo
function clientGitHash() {
  for (const dir of [CLIENT_SRC, path.join(ROOT, '..')]) {
    try {
      return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], {
        encoding: 'utf8',
        stdio:    ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch { /* try next */ }
  }
  return 'nogit'
}

// File writes: always a new file, never a write through a link or through another name of the same file. A work root copied with
// cp -al shares its files with where it came from, and a zip or manifest hard-linked to the live one would rewrite it in place

// A file at p is unlinked (a link itself, not where it points); a folder stays
function removeFile(p) {
  try {
    if (!fs.lstatSync(p).isDirectory()) fs.unlinkSync(p)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

// The new file is written next to target, then renamed over it, so the backend never serves a half-written zip or manifest
function tempFor(target) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`)
  removeFile(tmp)
  return tmp
}

function swapIn(tmp, target) {
  try { fs.chmodSync(tmp, fs.statSync(target).mode & 0o777) } catch { /* no file there yet */ }
  try {
    fs.renameSync(tmp, target)
  } catch (err) {
    // Windows refuses to rename over a file another program holds open: write it in place there, as before (no live checkout on a PC)
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) {
      fs.rmSync(tmp, { force: true })
      throw err
    }
    fs.copyFileSync(tmp, target)
    fs.rmSync(tmp, { force: true })
  }
}

function writeNew(target, data) {
  const tmp = tempFor(target)
  try {
    fs.writeFileSync(tmp, data, { flag: 'wx' })
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
  swapIn(tmp, target)
}

// File copy

function copyDir(srcDir, destDir, skipNames = new Set()) {
  if (!fs.existsSync(srcDir)) {
    console.warn(`[merge] source not found, skipping: ${srcDir}`)
    return 0
  }
  let count = 0
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (skipNames.has(entry.name)) continue
    const src  = path.join(srcDir, entry.name)
    const dest = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true })
      count += copyDir(src, dest, skipNames)
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      removeFile(dest)
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL)
      count++
    }
  }
  return count
}

// Per-file manifest of the output dir (launcher-owned files excluded), so the launcher's Check Files can verify every client file by size + sha256.

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(p)
      .on('data', d => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

async function listFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_ALWAYS.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { await listFiles(full, base, out); continue }
    out.push({
      path:   path.relative(base, full).split(path.sep).join('/'),
      size:   fs.statSync(full).size,
      sha256: await sha256File(full),
    })
  }
  return out
}

// Zip builder

function buildZip(srcDir, zipPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(zipPath), { recursive: true })
    const tmp     = tempFor(zipPath)
    const output  = fs.createWriteStream(tmp, { flags: 'wx' })
    const archive = archiver('zip', { zlib: { level: 6 } })
    let failed = false
    const fail = err => {
      if (failed) return
      failed = true
      output.destroy()
      fs.rmSync(tmp, { force: true })
      reject(err)
    }

    output.on('close', () => {
      // After a failure the stream may still have created the file once its open finished
      if (failed) return fs.rmSync(tmp, { force: true })
      try { swapIn(tmp, zipPath) } catch (err) { return fail(err) }
      resolve(archive.pointer())
    })
    output.on('error', fail)
    archive.on('error', fail)

    archive.pipe(output)
    // false = no root folder prefix in zip; the SKIP_ALWAYS names stay out of it as they stay out of the copy and the manifest
    archive.directory(srcDir, false, entry => (entry.name.split(/[\\/]/).some(part => SKIP_ALWAYS.has(part)) ? false : entry))
    archive.finalize()
  })
}

// Full paths, so the message names the file to delete; at most 10, then how many more
function named(files) {
  return files.slice(0, 10).join(', ') + (files.length > 10 ? ` and ${files.length - 10} more` : '')
}

// Refuses only with AUTO_REPORT_SYMBOL_GUARD=true; unset it warns once per file (warned), so a bundle with an inline map still ships
function refuseSymbols(dir, warned = new Set()) {
  const symbols = findSymbolFiles(dir).map(rel => path.resolve(dir, rel))
  if (symbols.length === 0) return
  if (config.autoReportSymbolGuard) {
    throw new Error('refusing to package source maps or PDBs. Delete these files (a bundle with an inline map: rebuild it without one) ' +
      `and run the merge again: ${named(symbols)}`)
  }
  const fresh = symbols.filter(file => !warned.has(file))
  fresh.forEach(file => warned.add(file))
  if (fresh.length) console.warn(`[merge] packaging source maps or PDBs, AUTO_REPORT_SYMBOL_GUARD is off: ${named(fresh)}`)
}

// Main export

async function mergeSourcesIntoRoot() {
  const startMs = Date.now()

  console.log('[merge] Starting merge…')
  console.log(`[merge]   client  : ${CLIENT_SRC}`)
  console.log(`[merge]   output  : ${OUTPUT_DIR}`)

  // Every path it writes, after links: the bucket, its root and zip, the manifest, and any link in the root a copy would write through
  const targets = { bucket: BUCKET, manifest: VERSION_FILE, writes: [OUTPUT_DIR, ZIP_PATH, ...liveBucket.linksUnder(OUTPUT_DIR)] }
  const refused = liveBucket.refusal(targets)
  if (refused) throw new Error(refused)
  const live = liveBucket.liveTarget(targets)
  if (live) console.warn(`[merge] ${liveBucket.OPT_IN}=1: writing into the live client files as asked (${live})`)

  // An empty source would zip whatever the output already holds; with no source, only a work folder's root is packaged as it is
  if (fs.existsSync(CLIENT_SRC) && !liveBucket.hasFiles(CLIENT_SRC, SKIP_ALWAYS)) {
    throw new Error(`refusing to merge: the client source ${CLIENT_SRC} is empty, so the zip would be whatever ${OUTPUT_DIR} already holds`)
  }
  // A live checkout's root is never re-zipped as it is, even with the opt-in; a PC's own default bucket that populate-files just filled is
  if (!fs.existsSync(CLIENT_SRC)) {
    if (liveBucket.liveTarget({ ...targets, checkoutOnly: true })) throw new Error(`refusing to merge: there is no client source ${CLIENT_SRC}, so the zip would be whatever the live root ${OUTPUT_DIR} already holds`)
    if (!liveBucket.hasFiles(OUTPUT_DIR, SKIP_ALWAYS)) throw new Error(`refusing to merge: there is no client source ${CLIENT_SRC} and no file in ${OUTPUT_DIR} to package`)
    console.log(`[merge] no client source: packaging the work folder's root ${OUTPUT_DIR} as it is`)
  }

  // The source and what an earlier run or populate left in the output, before anything is copied: OUTPUT_DIR is served
  // at /files/root as soon as a file lands in it, and the copy never removes a stale file
  const warned = new Set()
  refuseSymbols(CLIENT_SRC, warned)
  refuseSymbols(OUTPUT_DIR, warned)
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const clientFiles = copyDir(CLIENT_SRC, OUTPUT_DIR, SKIP_ALWAYS)
  console.log(`[merge] Files merged: ${clientFiles} total in ${Date.now() - startMs}ms`)

  refuseSymbols(OUTPUT_DIR, warned)

  console.log('[merge] Building zip…')
  const zipStart = Date.now()
  const zipSize  = await buildZip(OUTPUT_DIR, ZIP_PATH)
  console.log(`[merge] Zip built: ${(zipSize / 1024 / 1024).toFixed(1)} MB in ${Date.now() - zipStart}ms`)

  const files = await listFiles(OUTPUT_DIR)
  console.log(`[merge] Hashed ${files.length} files for the version manifest`)

  // CLIENT_VERSION in routes/version.js overrides the update-signal version
  const version = routeClientVersion() || clientGitHash()
  fs.mkdirSync(path.dirname(VERSION_FILE), { recursive: true })
  writeNew(VERSION_FILE, JSON.stringify({
    version,
    builtAt:   new Date().toISOString(),
    fileCount: clientFiles,
    zipSize,
    files,
  }, null, 2) + '\n')
  console.log(`[merge] Version: ${version}`)

  return { clientFiles, total: clientFiles, zipSize }
}

// CLI entry

if (require.main === module) {
  mergeSourcesIntoRoot().catch(err => {
    console.error('[merge] Fatal:', err.message)
    process.exit(1)
  })
}

module.exports = { mergeSourcesIntoRoot }
