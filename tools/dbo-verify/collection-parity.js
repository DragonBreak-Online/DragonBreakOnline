'use strict'
// MODULE 4 - collection-parity: can a player who completes the Nexus collection actually play?
//
// The server's install manifest and the Nexus collection are curated separately - the manifest is
// compiled from the reference MO2, the collection is built in Vortex - so they drift every time
// either changes, and nothing catches it until a player is stuck. On 2026-10-16 a player who had
// completed the collection was still missing 17 of the 155 required archives (4.56 GB), including
// Open Animation Replacer, powerofthree's Tweaks, True Directional Movement and SkyPatcher, which
// the game needs to run at all. Each one is a manual Nexus download, one page at a time.
//
// This compares the manifest against a real completed collection - a Vortex downloads folder - and
// reports exactly what the collection does not provide, with the Nexus mod/file ids needed to add it.
//
// Usage:
//   node tools/dbo-verify/collection-parity.js                      # uses this PC's Vortex folder
//   node tools/dbo-verify/collection-parity.js --vortex <dir>       # a reference profile elsewhere
//   node tools/dbo-verify/collection-parity.js --json
//
// Exit 1 when the collection is short, so it can gate a release.
const fs = require('fs')
const path = require('path')
const https = require('https')
const { Report } = require('./lib/report')

const API = process.env.DBO_API || 'https://dragonbreakonline.com'
const argOf = flag => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : null }
const VORTEX = argOf('--vortex') || path.join(process.env.APPDATA || '', 'Vortex', 'downloads')
const LAUNCHER_DOWNLOADS = 'C:\\DragonBreak\\downloads'

function getJson(url) {
  return new Promise(resolve => {
    https.get(url, res => {
      const chunks = []
      res.on('data', d => chunks.push(d))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve(null) }
      })
    }).on('error', () => resolve(null)).setTimeout(60000, function () { this.destroy(); resolve(null) })
  })
}

// Index by size: the collection and the manifest disagree on filenames often enough that names are
// useless here (Vortex names an in-progress download with a uuid, and at least one such name has
// already leaked into the published manifest), but sizes are exact.
function indexBySize(dir) {
  const bySize = new Map()
  const walk = d => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      let st
      try { st = fs.statSync(p) } catch { continue }
      if (!bySize.has(st.size)) bySize.set(st.size, [])
      bySize.get(st.size).push({ name: e.name, full: p })
    }
  }
  walk(dir)
  return bySize
}

const gb = n => (n / 1024 ** 3).toFixed(2)

async function main() {
  const r = new Report('collection-parity - can a player who finishes the collection play?')

  const manifest = await getJson(`${API}/api/install-manifest`)
  if (!manifest || !Array.isArray(manifest.archives)) {
    r.fail('install manifest', 'could not fetch or parse /api/install-manifest')
    r.print(); process.exit(r.exitCode)
  }
  const archives = manifest.archives
  const total = archives.reduce((n, a) => n + (a.size || 0), 0)
  r.pass('install manifest', `${archives.length} archives, ${gb(total)} GB, built ${manifest.builtAt}`)

  if (!fs.existsSync(VORTEX)) {
    r.skip('collection profile', `no Vortex downloads folder at ${VORTEX}`,
      'point --vortex at a machine that has completed the collection')
    r.print(); process.exit(r.exitCode)
  }

  const vortex = indexBySize(VORTEX)
  const launcher = indexBySize(LAUNCHER_DOWNLOADS)
  const vortexFiles = [...vortex.values()].reduce((n, v) => n + v.length, 0)
  r.pass('collection profile', `${vortexFiles} files in ${VORTEX}`)

  const provided = []
  const absent = []
  for (const a of archives) {
    if (vortex.has(a.size) || launcher.has(a.size)) provided.push(a)
    else absent.push(a)
  }

  if (!absent.length) {
    r.pass('collection covers the manifest', `all ${archives.length} archives present`)
  } else {
    const miss = absent.reduce((n, a) => n + (a.size || 0), 0)
    r.fail('collection covers the manifest',
      `${absent.length} of ${archives.length} archives missing (${gb(miss)} GB)`,
      'each one is a manual Nexus download for every player who installs the collection')
  }

  // A mod that is only ever a manual download is worse than a large one: these are the frameworks
  // the game will not start without, so a short collection is not a cosmetic problem.
  const CRITICAL = /open animation replacer|powerofthree|true directional movement|skypatcher|address library|bodyslide|fsmp|cbbe/i
  const criticalMissing = absent.filter(a => CRITICAL.test(a.name))
  if (criticalMissing.length) {
    r.fail('framework mods present', `${criticalMissing.length} load-bearing mod(s) missing`,
      criticalMissing.map(a => `  ${a.name.slice(0, 60)}`).join('\n'))
  } else if (absent.length) {
    r.pass('framework mods present', 'the gap is content, not frameworks')
  }

  if (absent.length) {
    console.log('\n--- add these to the collection (nexus mod/file ids)')
    for (const a of absent) {
      const s = a.source || {}
      console.log(`  modId=${String(s.modId || '-').padEnd(7)} fileId=${String(s.fileId || '-').padEnd(7)} ${String(a.size).padStart(11)} B  ${a.name}`)
    }
  }

  r.print()
  if (process.argv.includes('--json')) {
    const out = path.join(__dirname, 'out', 'collection-parity.json')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify({
      builtAt: manifest.builtAt, required: archives.length, provided: provided.length,
      missing: absent.map(a => ({ name: a.name, size: a.size, source: a.source })),
    }, null, 2))
    console.log(`\njson: ${out}`)
  }
  process.exit(r.exitCode)
}

main()
