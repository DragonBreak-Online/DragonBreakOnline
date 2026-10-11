'use strict'
// A crash at login (VCRUNTIME140+1C12A in BGSLoadGameBuffer, crashes-1010 §2) leaves SkyrimPlatform's spawn save on disk:
// a report sends the newest TESMODPLATFORM-*.ess when the game crashed within 2 minutes of its start, compressed and
// capped. The newest CEF debug log rides in clientLog without its page console lines. The launcher logs its step aside.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const crypto = require('crypto')
const { collect, newestPlatformSave, saveReason, platformSaveFor, platformSaveDir, SAVE_SEND_MAX } = require('../src/report')

const GUID = 'A1B2C3D4-0001-0002-0304-05060708090A'
const now = Date.parse('2026-10-11T03:00:00Z')

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'platformsave-test-'))
  const docs = path.join(root, 'Documents')
  const saves = platformSaveDir(docs)
  const skse = path.join(docs, 'My Games', 'Skyrim Special Edition', 'SKSE')
  fs.mkdirSync(saves, { recursive: true })
  fs.mkdirSync(skse, { recursive: true })
  return { root, docs, saves, skse }
}

function write(file, data, msAgo) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
  const t = new Date(now - msAgo)
  fs.utimesSync(file, t, t)
}

// Save-shaped bytes: the magic, then a body that compresses like a real save (repeated records, some noise)
function saveBytes(size = 512 * 1024, seed = 1) {
  const buf = Buffer.alloc(size)
  buf.write('TESV_SAVEGAME', 0, 'latin1')
  let x = seed
  for (let i = 13; i < size; i++) { x = (x * 1103515245 + 12345) >>> 0; buf[i] = (i % 64 < 48) ? (i % 251) : (x >>> 24) }
  return buf
}

test('the newest spawn save of the last day is found; other saves and old ones are not', () => {
  const s = setup()
  write(path.join(s.saves, `TESMODPLATFORM-${GUID}.ess`), saveBytes(1024), 60_000)
  write(path.join(s.saves, 'TESMODPLATFORM-B1B2C3D4-0001-0002-0304-05060708090A.ess'), saveBytes(1024), 10_000)
  write(path.join(s.saves, 'Save1_Player.ess'), saveBytes(1024), 1000)
  write(path.join(s.saves, 'TESMODPLATFORM-C1B2C3D4-0001-0002-0304-05060708090A.ess'), saveBytes(1024), 25 * 3600_000)
  write(path.join(s.saves, 'TESMODPLATFORM-notaguid.ess'), saveBytes(1024), 500)
  const found = newestPlatformSave(s.saves, now)
  assert.strictEqual(found.name, 'TESMODPLATFORM-B1B2C3D4-0001-0002-0304-05060708090A.ess')
  assert.strictEqual(newestPlatformSave(path.join(s.root, 'nowhere'), now), null)
})

test('a save goes with a crash within 2 minutes of the start, or with a crash log written within 2 minutes after it', () => {
  const save = { mtimeMs: now - 100_000 }
  const crashEarly = { outcome: 'crash', startedAt: now - 110_000, endedAt: now - 75_000 }
  assert.match(saveReason(save, { gameEnd: crashEarly }), /crashed 35 s after it started/)
  assert.strictEqual(saveReason(save, { gameEnd: { ...crashEarly, endedAt: now - 110_000 + 121_000 } }), null, 'a crash after 2 min')
  assert.strictEqual(saveReason(save, { gameEnd: { ...crashEarly, outcome: 'closed' } }), null, 'a normal close')
  assert.strictEqual(saveReason({ mtimeMs: now - 3600_000 }, { gameEnd: crashEarly }), null, 'a save from an older session')
  assert.match(saveReason(save, { crash: { mtimeMs: now - 98_000 } }), /crash log was written 2 s after the save/)
  // A second load late in the process (Meddik, 9 Oct, Switch Character): the crash log 3 s after its save counts
  assert.match(saveReason(save, { gameEnd: { outcome: 'crash', startedAt: now - 400_000, endedAt: now - 97_000 }, crash: { mtimeMs: now - 97_000 } }), /3 s after the save/)
  assert.strictEqual(saveReason(save, { crash: { mtimeMs: now - 100_000 + 121_000 } }), null, 'a crash long after the save')
  assert.strictEqual(saveReason(save, {}), null)
  assert.strictEqual(saveReason(null, { gameEnd: crashEarly }), null)
})

test('the save is sent brotli-compressed with its size and sha256, and unpacks to the same bytes', async () => {
  const s = setup()
  const raw = saveBytes(600 * 1024)
  write(path.join(s.saves, `TESMODPLATFORM-${GUID}.ess`), raw, 30_000)
  const lines = []
  const att = await platformSaveFor({ documentsDir: s.docs, crashDirs: [s.skse], now, log: l => lines.push(l),
    gameEnd: { outcome: 'crash', startedAt: now - 40_000, endedAt: now - 28_000 } })
  assert.strictEqual(att.kind, 'platformSave')
  assert.strictEqual(att.name, `TESMODPLATFORM-${GUID}.ess`)
  assert.strictEqual(att.encoding, 'br')
  assert.strictEqual(att.size, raw.length)
  assert.strictEqual(att.sha256, crypto.createHash('sha256').update(raw).digest('hex'))
  assert.ok(zlib.brotliDecompressSync(Buffer.from(att.data, 'base64')).equals(raw))
  assert.ok(att.data.length < 1.9e6, 'its base64 fits a 2 MB request')
  assert.match(lines[0], /compressed in \d+ ms \(the game crashed 12 s after it started\)/)
})

test('a crash log beside the save is enough when no crash note was kept', async () => {
  const s = setup()
  write(path.join(s.saves, `TESMODPLATFORM-${GUID}.ess`), saveBytes(4096), 50_000)
  write(path.join(s.skse, 'crash-2026-10-11-02-59-13.log'), 'Unhandled exception\n', 47_000)
  const att = await platformSaveFor({ documentsDir: s.docs, crashDirs: [s.skse], now })
  assert.match(att.reason, /crash log was written 3 s after the save/)
})

test('no crash, a file that is not a save, or one too large compressed is not sent, and says why', async () => {
  const s = setup()
  const file = path.join(s.saves, `TESMODPLATFORM-${GUID}.ess`)
  write(file, saveBytes(4096), 50_000)
  assert.match((await platformSaveFor({ documentsDir: s.docs, crashDirs: [s.skse], now })).skipped, /not written within 2 min before a crash/)
  const gameEnd = { outcome: 'crash', startedAt: now - 60_000, endedAt: now - 40_000 }
  write(file, Buffer.from('MZ not a save at all'), 50_000)
  assert.match((await platformSaveFor({ documentsDir: s.docs, gameEnd, now })).skipped, /is not a save file/)
  write(file, Buffer.concat([Buffer.from('TESV_SAVEGAME'), crypto.randomBytes(SAVE_SEND_MAX + 64 * 1024)]), 50_000)
  assert.match((await platformSaveFor({ documentsDir: s.docs, gameEnd, now })).skipped, /bytes compressed/)
  assert.strictEqual(await platformSaveFor({ documentsDir: path.join(s.root, 'none'), gameEnd, now }), null)
})

test('the newest CEF debug log goes into clientLog without page console lines, ahead of the install listing', () => {
  const s = setup()
  const userData = path.join(s.root, 'userData')
  fs.mkdirSync(userData)
  fs.writeFileSync(path.join(userData, 'install.log'), 'launcher line\n')
  const temp = path.join(s.root, 'Temp')
  const install = path.join(s.root, 'game')
  fs.mkdirSync(install)
  write(path.join(temp, 'Skyrim Platform', 'CEFTemp111', 'cef_debug.log'), '[1009/101010.000:ERROR:old.cc(1)] old run\n', 7200_000)
  write(path.join(temp, 'Skyrim Platform', 'CEFTemp222', 'cef_debug.log'), [
    '[1011/025910.100:ERROR:gpu_process_host.cc(951)] GPU process exited unexpectedly: exit_code=-1073741819',
    '[1011/025910.200:INFO:CONSOLE(1)] "whisper to Voci: meet at the gate", source: file:///C:/Users/Voci/ui/index.html (1)',
    '[1011/025911.000:FATAL:libcef.cc(12)] Check failed in C:\\Users\\Voci\\AppData\\Local\\Temp',
  ].join('\n'), 60_000)
  const out = collect({ userDataDir: userData, installDir: install, documentsDir: s.docs, tempDirs: [temp, temp], now })
  assert.match(out.clientLog, /== CEF debug log \(.*CEFTemp222.cef_debug\.log, written 1 min before this report, newest of 2\) ==/)
  assert.match(out.clientLog, /\[1 page console line\(s\) left out\]/)
  assert.match(out.clientLog, /GPU process exited unexpectedly/)
  assert.doesNotMatch(out.clientLog, /meet at the gate|old run|Users[\\/]Voci/)
  assert.match(out.clientLog, /FATAL:libcef[\s\S]*== install directory ==/)
})

test('the CEF log is capped from its end', () => {
  const s = setup()
  const userData = path.join(s.root, 'userData')
  fs.mkdirSync(userData)
  fs.writeFileSync(path.join(userData, 'install.log'), 'x\n')
  const temp = path.join(s.root, 'Temp')
  const lines = []
  for (let i = 0; i < 4000; i++) lines.push(`[1011/0259${String(i % 60).padStart(2, '0')}.000:WARNING:x.cc(${i})] line ${i}`)
  write(path.join(temp, 'Skyrim Platform', 'CEFTemp9', 'cef_debug.log'), lines.join('\n'), 1000)
  const out = collect({ userDataDir: userData, documentsDir: s.docs, tempDirs: [temp], now })
  assert.ok(Buffer.byteLength(out.clientLog) < 34 * 1024)
  assert.match(out.clientLog, /line 3999$/)
})

test('main.js logs the step aside, keeps the last crash note, and sends the save after the report', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  assert.match(main, /log\(`\[launch\] stepped aside at \$\{since\(\)\}/)
  assert.match(main, /store\.set\('lastGameEnd', \{ outcome: note\.outcome, startedAt: note\.startedAt, endedAt: note\.endedAt \}\)/)
  assert.match(main, /submitReport\(\{ note: 'Crash report offered[^']*', gameEnd: note \}\)/)
  assert.match(main, /if \(save && !save\.skipped\) await sendReportAttachment\(payload\.reportId, save, session\)/)
  assert.match(main, /\/api\/files\/report-attachment/)
})
