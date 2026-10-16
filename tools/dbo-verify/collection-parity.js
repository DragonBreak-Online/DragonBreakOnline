'use strict'
// MODULE 4 - collection-parity: what does an install still need, and can the collection supply it?
//
// The server's install manifest and the Nexus collection are curated separately - the manifest is
// compiled from the reference MO2, the collection is built in Vortex - so they drift whenever either
// changes and nothing catches it until a player is stuck mid-install.
//
// IMPORTANT, and the reason this module was rewritten: an archive absent from disk does NOT mean a
// missing mod. The launcher consumes an archive when it installs the mod and the copy is tidied away
// afterwards, so a finished install legitimately has no archive for most of its mods. Comparing the
// manifest's archive list against the disk - which the first version of this module did - reports
// every completed mod as missing. On 2026-10-16 that produced a confident "17 archives, 4.56 GB
// missing from the collection" when the real gap was 7 archives and 0.91 GB; the rest belonged to
// mods that were already installed, including Beyond Skyrim Bruma at 2.66 GB.
//
// So: resolve each NOT-YET-INSTALLED mod to the archives its files reference, and only ask whether
// those are obtainable. Everything else is already done and its archive is irrelevant.
//
// Usage:
//   node tools/dbo-verify/collection-parity.js
//   node tools/dbo-verify/collection-parity.js --mods <dir> --vortex <dir> [--json]
//
// Exit 1 when something cannot be obtained from what is on disk.
const fs = require('fs')
const path = require('path')
const https = require('https')
const { Report } = require('./lib/report')

const API = process.env.DBO_API || 'https://dragonbreakonline.com'
const argOf = flag => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : null }
const MODS_DIR = argOf('--mods') || 'C:\\DragonBreak\\mods'
const DOWNLOAD_DIRS = [
  argOf('--downloads') || 'C:\\DragonBreak\\downloads',
  argOf('--vortex') || path.join(process.env.APPDATA || '', 'Vortex', 'downloads'),
].filter(Boolean)

function getJson(url) {
  return new Promise(resolve => {
    https.get(url, res => {
      const chunks = []
      res.on('data', d => chunks.push(d))
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve(null) } })
    }).on('error', () => resolve(null)).setTimeout(90000, function () { this.destroy(); resolve(null) })
  })
}

// Sizes of every file in the download folders. Matching is by size, never by name: Vortex names an
// in-progress download with a uuid and renames it on completion, and at least one such name has
// already leaked into the published manifest, so names cannot be trusted on either side.
function sizesIn(dirs) {
  const sizes = new Set()
  const walk = d => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      try { sizes.add(fs.statSync(p).size) } catch { /* vanished mid-scan */ }
    }
  }
  for (const d of dirs) walk(d)
  return sizes
}

const gb = n => (n / 1024 ** 3).toFixed(2)
const mb = n => (n / 1048576).toFixed(1)

async function main() {
  const r = new Report('collection-parity - what does this install still need?')

  const manifest = await getJson(`${API}/api/install-manifest`)
  if (!manifest || !Array.isArray(manifest.mods)) {
    r.fail('install manifest', 'could not fetch or parse /api/install-manifest')
    r.print(); process.exit(r.exitCode)
  }
  const archiveById = new Map((manifest.archives || []).map(a => [a.id, a]))
  r.pass('install manifest', `${manifest.mods.length} mods, ${(manifest.archives || []).length} archives, built ${manifest.builtAt}`)

  let installed
  try {
    installed = new Set(fs.readdirSync(MODS_DIR, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name))
  } catch {
    r.skip('installed mods', `cannot read ${MODS_DIR}`, 'pass --mods <dir> to check another install')
    r.print(); process.exit(r.exitCode)
  }
  // The manifest names a mod exactly as the launcher names its folder, so this is an exact match.
  const done = manifest.mods.filter(m => installed.has(m.name))
  const todo = manifest.mods.filter(m => !installed.has(m.name))
  r.pass('installed mods', `${done.length} of ${manifest.mods.length} already installed`)

  if (!todo.length) {
    r.pass('nothing outstanding', 'every mod in the manifest is installed')
    r.print(); process.exit(r.exitCode)
  }

  const haveSizes = sizesIn(DOWNLOAD_DIRS)

  // Resolve each outstanding mod to the archives its files actually reference.
  const ready = []
  const blocked = []
  for (const mod of todo) {
    const ids = [...new Set((mod.files || []).map(f => f.archive).filter(Boolean))]
    const arcs = ids.map(id => archiveById.get(id)).filter(Boolean)
    const absent = arcs.filter(a => !haveSizes.has(a.size))
    if (absent.length) blocked.push({ mod, absent })
    else ready.push({ mod, bytes: arcs.reduce((n, a) => n + (a.size || 0), 0) })
  }

  const readyBytes = ready.reduce((n, x) => n + x.bytes, 0)
  if (ready.length) {
    r.pass('ready to install from disk', `${ready.length} mod(s), ${gb(readyBytes)} GB of archives already here`,
      'these need no download - the launcher extracts them once it reaches that step')
  }

  // One archive can block several mods, so count archives rather than mods for the real gap.
  const missingArchives = [...new Map(blocked.flatMap(b => b.absent.map(a => [a.id, a]))).values()]
  const missingBytes = missingArchives.reduce((n, a) => n + (a.size || 0), 0)
  if (!missingArchives.length) {
    r.pass('everything obtainable', 'every outstanding mod has its archive on disk')
  } else {
    r.fail('everything obtainable',
      `${missingArchives.length} archive(s) missing (${gb(missingBytes)} GB), blocking ${blocked.length} mod(s)`,
      'each is a manual Nexus download unless the collection supplies it')
  }

  if (missingArchives.length) {
    console.log('\n--- not on disk: add to the collection, or download once')
    for (const a of missingArchives) {
      const s = a.source || {}
      console.log(`  ${mb(a.size).padStart(8)} MB  ${a.name}`)
      if (s.modId && s.fileId) {
        console.log(`             https://www.nexusmods.com/skyrimspecialedition/mods/${s.modId}?tab=files&file_id=${s.fileId}&nmm=1`)
      }
    }
  }

  r.print()
  if (process.argv.includes('--json')) {
    const out = path.join(__dirname, 'out', 'collection-parity.json')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify({
      builtAt: manifest.builtAt,
      mods: { total: manifest.mods.length, installed: done.length, readyToInstall: ready.length, blocked: blocked.length },
      missingArchives: missingArchives.map(a => ({ name: a.name, size: a.size, source: a.source })),
    }, null, 2))
    console.log(`\njson: ${out}`)
  }
  process.exit(r.exitCode)
}

main()
