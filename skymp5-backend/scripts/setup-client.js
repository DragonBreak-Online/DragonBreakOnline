'use strict'

/**
 * Setup for the SkyMP-Client source directory.
 *   First run:  git clone https://github.com/skyrim-multiplayer/skymp.git sources/client/
 *   Later runs: git pull --ff-only (refuse dirty merges)
 * Then the merge pipeline runs so public/files/root/ is immediately up to date.
 * Refuses the live client files before cloning or pulling, as merge-files.js does, and never clones or pulls in, into or
 * around a live checkout or in a sources/client whose .git is not its own (sources/liveBucket.js).
 * Usage: CLIENT_FILES_DIR=<work folder> node scripts/setup-client.js  (npm run setup)
 */

const { execFileSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const config     = require('../config')
const liveBucket = require('../sources/liveBucket')

const CLIENT_REPO = 'https://github.com/skyrim-multiplayer/skymp.git'
const CLIENT_DIR  = path.join(__dirname, '..', 'sources', 'client')

const refused = liveBucket.refusal({ bucket: config.clientFilesDir, manifest: liveBucket.MANIFEST })
if (refused) {
  console.error(`[setup] ${refused}`)
  process.exit(1)
}

// Clone or pull: never in, into or around a live checkout, and a pull only in a checkout of its own

const near = liveBucket.nearLiveCheckout(CLIENT_DIR)
if (near) {
  console.error(`[setup] refusing to clone or pull: ${near}`)
  process.exit(1)
}

const isCloned = fs.existsSync(path.join(CLIENT_DIR, '.git'))

function revParse(dir) {
  try { return execFileSync('git', ['-C', dir, ...liveBucket.REV_PARSE], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return '' }
}

const notOwn = isCloned ? liveBucket.notOwnCheckout(CLIENT_DIR, revParse(CLIENT_DIR)) : null
if (notOwn) {
  console.error(`[setup] refusing to pull: ${notOwn}`)
  process.exit(1)
}

if (isCloned) {
  console.log('[setup] Client repo already present, pulling latest…')
  try {
    const out = execFileSync('git', ['-C', CLIENT_DIR, 'pull', '--ff-only'], {
      encoding: 'utf8',
    })
    console.log('[setup]', out.trim())
  } catch (err) {
    console.error('[setup] git pull failed:', err.stderr || err.message)
    process.exit(1)
  }
} else {
  console.log('[setup] Cloning SkyMP-Client repo…')
  console.log('[setup]   ->', CLIENT_DIR)
  try {
    execFileSync('git', ['clone', CLIENT_REPO, CLIENT_DIR], { stdio: 'inherit' })
  } catch (err) {
    console.error('[setup] git clone failed:', err.message)
    process.exit(1)
  }
  console.log('[setup] Clone complete.')
}

// Merge into root

console.log('[setup] Running merge pipeline…')
const { mergeSourcesIntoRoot } = require('./merge-files')
mergeSourcesIntoRoot()
  .then(() => console.log('[setup] Setup complete. public/files/root/ and zip are ready.'))
  .catch(err => { console.error('[setup] Merge failed:', err.message); process.exit(1) })
