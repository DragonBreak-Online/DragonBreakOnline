'use strict'
// The install manifest from R2 when the backend redirects to install-manifest/<sha256>.json (checked), else from the backend as before.

const crypto = require('crypto')
const http   = require('http')
const https  = require('https')

const R2_MANIFEST = /^https:\/\/files\.dragonbreakonline\.com\/install-manifest\/([0-9a-f]{64})\.json$/
const REUSE_MS = 10 * 60 * 1000
const TIMEOUT_MS = 120 * 1000

// One GET, no redirect followed: { status, location, body }
function getRaw(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(url, { headers }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || '', body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timed out')))
    req.on('error', reject)
  })
}

function createInstallManifest({ apiUrl, fetchJSON, r2Url = R2_MANIFEST, now = Date.now, log = () => {} }) {
  let last = null

  async function viaR2() {
    const first = await getRaw(`${apiUrl}/api/install-manifest`, { 'X-DBO-Accept-Redirect': '1' })
    if (first.status >= 200 && first.status < 300) return JSON.parse(first.body.toString('utf8'))
    if (first.status !== 302 && first.status !== 301 && first.status !== 307) throw new Error(`HTTP ${first.status}`)
    const m = r2Url.exec(first.location)
    if (!m) throw new Error('a redirect to an unexpected place')
    const second = await getRaw(first.location)
    if (second.status !== 200) throw new Error(`HTTP ${second.status} from R2`)
    if (crypto.createHash('sha256').update(second.body).digest('hex') !== m[1]) throw new Error('the R2 copy does not match its sha256')
    return JSON.parse(second.body.toString('utf8'))
  }

  // reuse: an nxm link right after another one takes the manifest fetched less than 10 minutes ago
  async function get({ reuse = false } = {}) {
    if (reuse && last && now() - last.at < REUSE_MS) return last.manifest
    let manifest
    try { manifest = await viaR2() } catch (err) {
      log(`install manifest: ${err.message}; fetching it from the backend`)
      manifest = await fetchJSON(`${apiUrl}/api/install-manifest`)
    }
    last = { at: now(), manifest }
    return manifest
  }

  return { get }
}

module.exports = { createInstallManifest, R2_MANIFEST }
