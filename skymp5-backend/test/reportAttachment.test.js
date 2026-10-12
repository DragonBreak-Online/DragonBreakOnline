'use strict'
// POST /api/files/report-attachment: launcher 2.1.46 follows a report filed after a crash at login with the spawn save the
// game was loading (TESMODPLATFORM-<guid>.ess, the VCRUNTIME140+1C12A family). Papapike's report of 11 Oct 22:35Z said
// "sent separately" and nothing arrived: the backend had no such route, and server.js's global 100 kB JSON parser refused
// the body before routing. The app here is mounted the way server.js mounts it, global parser included.

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs     = require('fs')
const http   = require('http')
const path   = require('path')
const zlib   = require('zlib')

// Never read a real .env; keep master-api, the ban and player stores and Discord out of these tests
require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
function stub(rel, exports) {
  const file = require.resolve(rel)
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
const sessions = new Map()
stub('../routes/master-api', { lookupSession: token => sessions.get(token) || null })
stub('../sources/bans', { isBanned: () => null })
stub('../sources/players', { load: () => ({}) })
stub('../sources/discord/audit', { log: () => {} })
let threads = 0
const posts = []
let failNextPost = false
stub('../sources/discord/errorReport', {
  postReport: async () => `1559000000000000${String(++threads).padStart(3, '0')}`,
  postBugLogs: async () => `1559000000000000${String(++threads).padStart(3, '0')}`,
  postToThread: async args => {
    if (failNextPost) { failNextPost = false; throw new Error('discord POST failed (500)') }
    posts.push(args)
    return 'M1'
  },
  tagIds: () => [],
})

const express = require('express')
const config  = require('../config')
const files   = require('../routes/files')
const { parserExcept, bodyErrors } = require('../sources/problemReport')

let server, base
before(async () => {
  config.discordErrorForumChannelId = '1'
  const app = express()
  // As server.js does: one JSON parser (express's default 100 kB) on every path but those whose route parses its own body
  app.use(parserExcept(files.OWN_PARSER_PATHS || [], express.json()))
  app.use('/api/files', files)
  app.use(bodyErrors)
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

let nextProfile = 500
function login() {
  const token = crypto.randomBytes(16).toString('hex')
  const profileId = nextProfile++
  sessions.set(token, { profileId, discordId: `55500000000${profileId}`, username: `Tester${profileId}`, expiresAt: Date.now() + 86400000 })
  return token
}

function post(route, body, token) {
  const data = typeof body === 'string' ? body : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/files/${route}`, {
      method: 'POST',
      agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...(token ? { 'x-session': token } : {}) },
    }, res => {
      let text = ''
      res.on('data', c => { text += c })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(text) } catch { /* an HTML page: Express's own 404 */ }
        resolve({ status: res.statusCode, json, text })
      })
    })
    req.on('error', reject)
    req.end(data)
  })
}

// What the crash prompt files first (launcher main.js submitReport)
async function fileReport(token, reportId = crypto.randomUUID()) {
  const res = await post('report', { reportId, launcherLog: '[crashWatch] game crash (exit 0x1, crash log)',
    note: 'Crash report offered by the launcher after the game closed unexpectedly.', launcherVersion: '2.1.46' }, token)
  assert.equal(res.status, 200, res.text)
  return { reportId, thread: res.json.thread }
}

const SAVE_NAME = 'TESMODPLATFORM-0DBC1537-8B6F-48A5-B0F4-A052CCE031DB.ess'
// Shaped like Papapike's: 4.6 MB raw, about 1.3 MB packed, so the JSON body is about 1.75 MB
function makeSave({ random = 1_300_000, zeros = 3_300_000 } = {}) {
  return Buffer.concat([Buffer.from('TESV_SAVEGAME', 'latin1'), crypto.randomBytes(random), Buffer.alloc(zeros)])
}
// The launcher's platformSaveFor() result (skymp5-launcher/src/report.js), with the brotli quality turned down for speed
function attachment(raw, extra = {}) {
  const packed = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
  return {
    kind: 'platformSave', name: SAVE_NAME, encoding: 'br', size: raw.length,
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    writtenMinutesAgo: 0, reason: 'the game crashed 31 s after it started',
    data: packed.toString('base64'), ...extra,
  }
}

test("a filed report's spawn save, at the size the launcher sends, is posted into that report's thread", async () => {
  const token = login()
  const { reportId, thread } = await fileReport(token)
  const raw = makeSave()
  const body = { reportId, ...attachment(raw) }
  assert.ok(JSON.stringify(body).length > 1_500_000, 'well past the global parser 100 kB')
  posts.length = 0
  const res = await post('report-attachment', body, token)
  assert.equal(res.status, 200, res.text)
  assert.equal(res.json.ok, true)
  assert.equal(res.json.thread, thread)
  assert.equal(posts.length, 1)
  assert.equal(posts[0].thread, thread)
  assert.equal(posts[0].files.length, 1)
  assert.equal(posts[0].files[0].name, SAVE_NAME)
  assert.ok(posts[0].files[0].data.equals(raw), 'the save itself, unpacked')
  assert.match(posts[0].content, /Tester\d+/)
  assert.match(posts[0].content, new RegExp(`${raw.length} bytes`))
  assert.match(posts[0].content, new RegExp(body.sha256.slice(0, 16)))
  assert.match(posts[0].content, /the game crashed 31 s after it started/)
})

test('server.js keeps the router\'s own-parser paths out of its global JSON parser', () => {
  assert.ok(Array.isArray(files.OWN_PARSER_PATHS), 'routes/files.js lists the paths that parse their own body')
  assert.ok(files.OWN_PARSER_PATHS.includes('/api/files/report-attachment'))
  assert.ok(files.OWN_PARSER_PATHS.includes('/api/files/report'))
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')
  assert.match(server, /OWN_PARSER_PATHS = \[\.\.\.filesRoute\.OWN_PARSER_PATHS[,\]]/)
})

test('a body at the launcher\'s largest packed save reaches the route rather than a 413', async () => {
  const token = login()
  const { reportId } = await fileReport(token)
  // 1400 KiB packed (launcher SAVE_SEND_MAX) as base64; not brotli, so the route refuses it, but as a 400 of its own
  const data = Buffer.alloc(1400 * 1024, 7).toString('base64')
  const res = await post('report-attachment', { reportId, ...attachment(makeSave({ random: 10, zeros: 10 })), data }, token)
  assert.equal(res.status, 400, res.text)
})

test('without a signed-in session the route answers 401 before reading the body', async () => {
  const token = login()
  const { reportId } = await fileReport(token)
  posts.length = 0
  const res = await post('report-attachment', { reportId, ...attachment(makeSave({ random: 1000, zeros: 1000 })) }, null)
  assert.equal(res.status, 401, res.text)
  const stranger = await post('report-attachment', { reportId, ...attachment(makeSave({ random: 1000, zeros: 1000 })) }, 'not-a-session')
  assert.equal(stranger.status, 401, stranger.text)
  assert.equal(posts.length, 0)
})

test("only the sender's own filed report takes an attachment", async () => {
  const owner = login()
  const other = login()
  const { reportId } = await fileReport(owner)
  posts.length = 0
  const save = attachment(makeSave({ random: 1000, zeros: 1000 }))
  assert.equal((await post('report-attachment', { reportId, ...save }, other)).status, 410)
  assert.equal((await post('report-attachment', { reportId: crypto.randomUUID(), ...save }, owner)).status, 410)
  assert.equal((await post('report-attachment', { reportId: '../../etc', ...save }, owner)).status, 400)
  assert.equal(posts.length, 0)
})

test('a report takes one attachment', async () => {
  const token = login()
  const { reportId } = await fileReport(token)
  const save = attachment(makeSave({ random: 1000, zeros: 1000 }))
  assert.equal((await post('report-attachment', { reportId, ...save }, token)).status, 200)
  assert.equal((await post('report-attachment', { reportId, ...save }, token)).status, 409)
})

test('a save that does not match its own description is refused and nothing is posted', async () => {
  const token = login()
  const { reportId } = await fileReport(token)
  const raw = makeSave({ random: 1000, zeros: 1000 })
  const good = attachment(raw)
  const bad = {
    sha256: { sha256: 'a'.repeat(64) },
    size: { size: raw.length + 1 },
    magic: attachment(Buffer.concat([Buffer.from('MZ'), raw.subarray(2)])),
    name: { name: '..\\..\\Windows\\win.ini' },
    encoding: { encoding: 'gzip' },
    kind: { kind: 'screenshot' },
    base64: { data: `${good.data.slice(0, 40)}!!!!` },
    truncated: { data: good.data.slice(0, 200) },
    oversize: { size: 17 * 1024 * 1024 },
  }
  posts.length = 0
  for (const [why, change] of Object.entries(bad)) {
    const res = await post('report-attachment', { reportId, ...good, ...change }, token)
    assert.equal(res.status, 400, `${why}: ${res.text}`)
  }
  assert.equal(posts.length, 0)
  // None of those used up the report's one attachment
  assert.equal((await post('report-attachment', { reportId, ...good }, token)).status, 200)
})

test('a brotli bomb stops at the size it claims', async () => {
  const token = login()
  const { reportId } = await fileReport(token)
  const bomb = Buffer.concat([Buffer.from('TESV_SAVEGAME', 'latin1'), Buffer.alloc(64 * 1024 * 1024)])
  const body = { reportId, ...attachment(bomb), size: 4_600_544 }
  assert.ok(body.data.length < 100_000)
  const res = await post('report-attachment', body, token)
  assert.equal(res.status, 400, res.text)
})

test('a save too big for one Discord message goes up still packed', async () => {
  const token = login()
  const { reportId } = await fileReport(token)
  const raw = makeSave({ random: 1000, zeros: 9 * 1024 * 1024 })
  const body = attachment(raw)
  posts.length = 0
  assert.equal((await post('report-attachment', { reportId, ...body }, token)).status, 200)
  assert.equal(posts[0].files[0].name, `${SAVE_NAME}.br`)
  assert.ok(zlib.brotliDecompressSync(posts[0].files[0].data).equals(raw))
  assert.match(posts[0].content, /brotli/)
})

test('a failed Discord post answers 502 and leaves the attachment open for a retry', async () => {
  const token = login()
  const { reportId } = await fileReport(token)
  const save = attachment(makeSave({ random: 1000, zeros: 1000 }))
  failNextPost = true
  assert.equal((await post('report-attachment', { reportId, ...save }, token)).status, 502)
  assert.equal((await post('report-attachment', { reportId, ...save }, token)).status, 200)
})
