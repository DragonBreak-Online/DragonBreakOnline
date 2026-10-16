'use strict'
// Archives the player already has: found by hash in Vortex's downloads (or a chosen folder) and used where they are;
// the download wait says which files are in and counts a growing
// partial download as activity; one Nexus page at a time for the rest.
const test = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const mo2 = require('../src/mo2')
const { createGuide, nexusFilePage } = require('../src/nxm')

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-launcher-archives-'))
mo2.setRootProvider(() => root)
mo2.setLogger(() => {})
const downloads = mo2.getDownloadsDir()
const vortex = path.join(root, 'Vortex', 'downloads', 'skyrimse')
fs.mkdirSync(downloads, { recursive: true })
fs.mkdirSync(vortex, { recursive: true })
test.after(() => fs.rmSync(root, { recursive: true, force: true }))

const A = Buffer.from('archive A '.repeat(100)), B = Buffer.from('archive B '.repeat(120))
fs.writeFileSync(path.join(vortex, 'Mod A-123-1-0.7z'), A)
fs.writeFileSync(path.join(vortex, 'notes.txt'), 'not an archive')

test('an archive Vortex already downloaded is found by its hash, and only by it', async () => {
  assert.equal(await mo2.findArchiveByHash(sha(A), A.length), null, 'not without the other folder')
  assert.equal(await mo2.findArchiveByHash(sha(A), A.length, [vortex]), path.join(vortex, 'Mod A-123-1-0.7z'))
  assert.equal(await mo2.findArchiveByHash(sha(B), B.length, [vortex]), null)
  assert.equal(await mo2.findArchiveByHash(sha(A), A.length + 1, [vortex]), null, 'the size must match first')
  assert.equal(await mo2.findArchiveByHash(sha(A), A.length, [path.join(root, 'missing')]), null)
})

test('the wait says which files are in, and a growing partial download keeps it alive', async () => {
  const wanted = [{ name: 'Mod B', hash: sha(B), size: B.length }, { name: 'Mod A', hash: sha(A), size: A.length }]
  if (!fs.existsSync(path.join(downloads, 'Mod A-123-1-0.7z'))) fs.writeFileSync(path.join(downloads, 'Mod A-123-1-0.7z'), A)
  const seen = []
  const part = path.join(downloads, 'Mod B-9-1-0.7z.unfinished')
  fs.writeFileSync(part, B.subarray(0, 100))
  let step = 0
  const paths = await mo2.waitForDownloads(wanted, (done, total, message, found) => {
    seen.push(found.slice())
    step++
    if (step === 2) fs.appendFileSync(part, B.subarray(100, 200))
    if (step === 4) fs.renameSync(part, path.join(downloads, 'Mod B-9-1-0.7z')) // an nxm download finishing
    if (step === 4) fs.writeFileSync(part, Buffer.alloc(0))
    if (step === 5) { fs.rmSync(part); fs.writeFileSync(path.join(downloads, 'Mod B-9-1-0.7z'), B) }
  }, undefined, 20, 400)
  assert.deepEqual(seen[0], [false, false], 'a file counts once its size has held for a scan')
  assert.ok(seen.some(f => !f[0] && f[1]), 'Mod A (linked in) is in before Mod B arrives')
  assert.deepEqual(seen.at(-1), [true, true])
  assert.equal(paths[0], path.join(downloads, 'Mod B-9-1-0.7z'))
})

test('a Mod Manager Download page, the one Vortex opens for free accounts', () => {
  assert.equal(nexusFilePage(266, 4567), 'https://www.nexusmods.com/skyrimspecialedition/mods/266?tab=files&file_id=4567&nmm=1')
  assert.equal(nexusFilePage('266" onload', '1'), 'https://www.nexusmods.com/skyrimspecialedition/mods/NaN?tab=files&file_id=1&nmm=1')
})

test('one Nexus page at a time: the next opens only when another file arrives', () => {
  const items = ['A', 'B', 'C'].map((n, i) => ({ name: n, source: { modId: 10 + i, fileId: 100 + i } }))
  const opened = [], said = []
  const next = createGuide(items, { open: u => opened.push(u), say: m => said.push(m) })
  assert.equal(next([false, false, false]), 0)
  assert.equal(next([false, false, false]), null, 'nothing new arrived: no second page')
  assert.equal(next([false, false, false]), null)
  assert.equal(next([true, false, false]), 1)
  assert.equal(next([true, false, true]), null, 'C came some other way; B is already open')
  assert.deepEqual(opened, [nexusFilePage(10, 100), nexusFilePage(11, 101)])
  assert.match(said[1], /^Nexus page 2 of 3: B\. Click "Slow download"/)
})

test('a slow download still being written keeps the wait alive past its timeout', async () => {
  const C = Buffer.from('archive C '.repeat(300))
  const part = path.join(downloads, 'Mod C-7-1-0.7z.unfinished')
  fs.writeFileSync(part, C.subarray(0, 10))
  let ticks = 0, grown = 10
  const started = Date.now()
  const paths = await mo2.waitForDownloads([{ name: 'Mod C', hash: sha(C), size: C.length }], () => {
    ticks++
    if (Date.now() - started < 250) { grown += 10; fs.appendFileSync(part, C.subarray(grown - 10, grown)) }
    else if (fs.existsSync(part)) { fs.rmSync(part); fs.writeFileSync(path.join(downloads, 'Mod C-7-1-0.7z'), C) }
  }, undefined, 10, 100)
  assert.ok(Date.now() - started > 250, 'it waited longer than the 100 ms timeout')
  assert.equal(paths[0], path.join(downloads, 'Mod C-7-1-0.7z'))
})

// The failure players hit when installing from a Nexus collection: Vortex owns the nxm:// handler,
// so the archive lands in Vortex's downloads and never in ours. Scanning only our own folder timed
// the install out after 15 minutes with the file sitting right there - "Vortex says it is
// downloaded, the launcher says it is not".
test('the download wait sees an archive that landed in Vortex\'s folder', async () => {
  const V = Buffer.alloc(4096, 7)
  fs.mkdirSync(vortex, { recursive: true })
  fs.writeFileSync(path.join(vortex, 'Collection Mod-77-1-0.7z'), V)

  const wanted = [{ name: 'Collection Mod', hash: sha(V), size: V.length }]
  const paths = await mo2.waitForDownloads(wanted, () => {}, undefined, 20, 400, [vortex])

  assert.equal(paths[0], path.join(vortex, 'Collection Mod-77-1-0.7z'),
    'the archive is used where it lies, so Vortex keeps ownership of its own downloads')
})

test('without the extra folder the same wait times out, which is the bug', async () => {
  const V = Buffer.alloc(2048, 9)
  fs.mkdirSync(vortex, { recursive: true })
  fs.writeFileSync(path.join(vortex, 'Only In Vortex-78-1-0.7z'), V)

  await assert.rejects(
    () => mo2.waitForDownloads([{ name: 'Only In Vortex', hash: sha(V), size: V.length }], () => {}, undefined, 20, 200),
    /Timed out waiting to download/,
    'the old behaviour: our folder only, so the file is invisible',
  )
})

// Vortex keeps the older version of a mod after an update, so its folder often holds a file with the right name and the
// wrong size. That is one of the player's own downloads, not a wrong file they handed us: the wait must never tell
// them "<file> is not the exact file the server expects" about it. Outside our folder only an exact sha256 match counts.
test('an older version in Vortex\'s folder is never shown to the player as a wrong file, and the right one still resolves', async () => {
  const NEW = Buffer.alloc(6001, 25)
  const older = path.join(vortex, 'SkyUI_5_1_SE-12604-5-1SE.7z')
  const sameSize = path.join(vortex, 'SkyUI_5_2_SE-12604-5-2SE-repack.7z')
  fs.writeFileSync(older, Buffer.alloc(5003, 25))      // an older version: the name matches, the size does not
  fs.writeFileSync(sameSize, Buffer.alloc(6001, 26))   // the right size and name, other bytes
  const messages = []
  let k = 0
  try {
    const paths = await mo2.waitForDownloads(
      [{ name: 'SkyUI', hash: sha(NEW), size: NEW.length, namePattern: /(?:^|[^0-9])12604(?:[^0-9]|$)|skyui/i }],
      (done, total, message) => {
        messages.push(message)
        if (++k === 4) fs.writeFileSync(path.join(downloads, 'SkyUI_5_2_SE-12604-5-2SE.7z'), NEW)
      }, undefined, 20, 2000, [vortex])
    assert.equal(paths[0], path.join(downloads, 'SkyUI_5_2_SE-12604-5-2SE.7z'), 'the right file in our folder resolves')
  } finally {
    fs.rmSync(older)
    fs.rmSync(sameSize)
  }
  assert.ok(messages.length >= 5, `the wait ran a few ticks first (${messages.length})`)
  assert.deepEqual(messages.filter(m => /SkyUI_5_1_SE|repack/.test(m)), [], 'no progress message names a file in Vortex\'s folder')
  assert.ok(messages.every(m => !m.includes('is not the exact file the server expects')), 'and none says "not the exact file"')
})

// Vortex's folder holds the player's whole mod history (153 archives on Jake's PC). Each of them used to write a
// "[wait]" line for every wanted item (size still changing, then size mismatch): 20 items against 300 archives made
// about 12,000 install.log lines per wait. A file there that is not the size of a wanted item is passed over without
// a line, and a wanted archive among them is still found.
test('unrelated archives in Vortex\'s folder write no [wait] line, and a wanted one among them is still found', async () => {
  const many = path.join(root, 'VortexMany', 'downloads', 'skyrimse')
  fs.mkdirSync(many, { recursive: true })
  const N = 20, M = 300
  for (let j = 0; j < M; j++) {
    const f = path.join(many, `Other Mod ${j}-${1000 + j}-1-0.7z`)
    fs.writeFileSync(f, '')
    fs.truncateSync(f, 10000 + j)   // sparse: the wait only looks at the size of a file that cannot match
  }
  const HIT = Buffer.alloc(777, 27)
  fs.writeFileSync(path.join(many, 'Need0-2000-1-0.7z'), HIT)
  const wanted = [{ name: 'Need0', hash: sha(HIT), size: HIT.length },
    ...Array.from({ length: N - 1 }, (_, i) => ({ name: `Need${i + 1}`, hash: sha(Buffer.from(`n${i + 1}`)), size: 500 + i }))]
  const lines = []
  let sawHit = false
  mo2.setLogger((...a) => lines.push(a.join(' ')))
  try {
    await assert.rejects(
      mo2.waitForDownloads(wanted, (done, total, message, found) => { if (found[0]) sawHit = true }, undefined, 20, 150, [many]),
      /Timed out waiting to download: Need1, /)
  } finally {
    mo2.setLogger(() => {})
    fs.rmSync(path.join(root, 'VortexMany'), { recursive: true, force: true })
  }
  assert.ok(sawHit, 'the wanted archive in that folder was found')
  assert.ok(lines.some(l => l.includes('"Need0" found in')), 'and the log says where it was found')
  const noisy = lines.filter(l => l.includes('[wait]') && l.includes('Other Mod'))
  assert.equal(noisy.length, 0, `no [wait] line names an unrelated archive (got ${noisy.length}, e.g. ${noisy[0]})`)
})

// From the review of the Vortex fix (R1, R2, R4, R5): what the wait must still do with a second folder to watch.

test('a copy in our own folder wins over the same archive in Vortex\'s', async () => {
  const X = Buffer.alloc(3001, 21)
  fs.writeFileSync(path.join(vortex, 'X-1-1-0.7z'), X)
  fs.writeFileSync(path.join(downloads, 'X-1-1-0.7z'), X)
  const p = await mo2.waitForDownloads([{ name: 'X', hash: sha(X), size: X.length }], () => {}, undefined, 20, 400, [vortex])
  assert.equal(p[0], path.join(downloads, 'X-1-1-0.7z'))
})

// Vortex writes a download under a temporary name with no extension (__vortex_tmp_<n>) and renames it when it is done
test('a file Vortex is still downloading is not taken; the renamed file is, once its size has held', async () => {
  const Y = Buffer.alloc(5001, 22)
  const tmp = path.join(vortex, '__vortex_tmp_00000001')
  fs.writeFileSync(tmp, Y.subarray(0, 1000))
  const seen = []
  const p = await mo2.waitForDownloads([{ name: 'Y', hash: sha(Y), size: Y.length }], (d, t, m, found) => {
    seen.push(found[0])
    if (seen.length === 3) fs.writeFileSync(tmp, Y)   // all the bytes, still under the temporary name
    if (seen.length === 6) fs.renameSync(tmp, path.join(vortex, 'Y-2-1-0.7z'))
  }, undefined, 20, 2000, [vortex])
  assert.ok(seen.slice(0, 7).every(x => !x), `not taken before the renamed file has held its size: ${JSON.stringify(seen)}`)
  assert.equal(p[0], path.join(vortex, 'Y-2-1-0.7z'))
})

test('a file still growing in Vortex\'s folder is not hashed or taken while its size changes', async () => {
  const G = Buffer.alloc(4000, 23)
  const f = path.join(vortex, 'G-4-1-0.7z')
  fs.writeFileSync(f, G.subarray(0, 500))
  let n = 500
  const seen = []
  const p = await mo2.waitForDownloads([{ name: 'G', hash: sha(G), size: G.length }], (d, t, m, found) => {
    seen.push(found[0])
    if (n < G.length) { fs.appendFileSync(f, G.subarray(n, n + 500)); n += 500 }
  }, undefined, 20, 2000, [vortex])
  assert.ok(seen.indexOf(true) >= 7, `taken only after the copy finished: ${JSON.stringify(seen)}`)
  assert.equal(p[0], f)
})

// Any size change in Vortex's folder counts as activity and slides the deadline, so a player's other downloads there
// could keep a wait alive that can never finish: the hard cap of three timeout windows must still end it. It is
// counted in ticks, not milliseconds, so a slow disk cannot fail it: a stall only means fewer ticks.
test('churn in Vortex\'s folder slides the deadline, but the hard cap still ends the wait', async () => {
  const W = Buffer.alloc(1001, 24)
  const churn = path.join(vortex, 'Unrelated-9-1-0.7z')
  fs.writeFileSync(churn, Buffer.alloc(1))
  let ticks = 0
  const started = Date.now()
  try {
    await assert.rejects(mo2.waitForDownloads([{ name: 'Never', hash: sha(W), size: W.length }], () => {
      // the Vortex folder changes on every tick; without the hard cap the wait would go on, so the churn stops at 300
      if (++ticks < 300) fs.appendFileSync(churn, Buffer.alloc(1))
    }, undefined, 10, 150, [vortex]), /Timed out waiting to download: Never/)
  } finally { fs.rmSync(churn) }
  const took = Date.now() - started
  assert.ok(took >= 300, `it slid past the 150 ms deadline (took ${took} ms)`)
  assert.ok(ticks < 300, `the 450 ms hard cap ended it while the churn went on (${ticks} ticks in ${took} ms)`)
})
