'use strict'
// The dev server option (devServer.js and its wiring in main.js): its own settings and install folder, never the live
// ones; dev's load order and mods; client settings that send the ticket; the ticket only ever goes to the dev files host
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const d = require('../src/devServer')

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')

test('dev mode is the --dev-server flag, and a switch adds or removes only that flag', () => {
  assert.equal(d.isDevMode(['electron', '.']), false)
  assert.equal(d.isDevMode(['electron', '.', '--dev-server']), true)
  assert.deepEqual(d.relaunchArgs(['.', '--dev'], true), ['.', '--dev', '--dev-server'])
  assert.deepEqual(d.relaunchArgs(['.', '--dev-server', '--dev'], false), ['.', '--dev'])
  assert.deepEqual(d.relaunchArgs(['.', '--dev-server'], true), ['.', '--dev-server'])
})

test('dev settings and the dev install sit beside the live ones, never inside them', () => {
  const live = 'C:\\Users\\p\\AppData\\Roaming\\DragonBreak Online Launcher'
  assert.equal(d.devUserDataDir(live), `${live} (Dev)`)
  assert.equal(d.devBaseDir('C:\\DragonBreak'), 'C:\\DragonBreak-Dev')
  assert.equal(d.devBaseDir('D:\\Games\\DBO\\'), 'D:\\Games\\DBO-Dev')
  assert.equal(d.overlaps(d.devBaseDir('C:\\DragonBreak'), 'C:\\DragonBreak'), false)
  assert.equal(d.overlaps('C:\\DragonBreak\\dev', 'C:\\DragonBreak'), true)
  assert.equal(d.overlaps('c:\\dragonbreak', 'C:\\DragonBreak\\'), true)
  assert.equal(d.overlaps('C:\\Steam\\Skyrim Special Edition', 'C:\\Steam\\Skyrim Special Edition\\Data'), true)
})

test('a handoff carries the login and Skyrim path, never the live install folder or its file versions', () => {
  const live = { skyrimPath: 'C:\\Steam\\SSE', gameSession: 's', discordUser: { username: 'Lead' }, gameProfileId: 42,
    nexusOauth: { accessToken: 'n' }, baseDirPath: 'C:\\DragonBreak', filesVersion: '0.3.119', extraFilesVersion: 'abc', activeServerIndex: 1 }
  const h = d.handoffFrom(k => live[k], 'C:\\DragonBreak')
  assert.deepEqual(Object.keys(h).sort(), ['discordUser', 'gameProfileId', 'gameSession', 'liveBaseDir', 'nexusOauth', 'skyrimPath'])
  const dev = {}
  d.applyHandoff((k, v) => { dev[k] = v }, k => dev[k], h, 'C:\\DragonBreak')
  assert.equal(dev.baseDirPath, 'C:\\DragonBreak-Dev')
  assert.equal(dev.liveBaseDir, 'C:\\DragonBreak')
  assert.equal(dev.isolatedGame, true)
  assert.equal(dev.filesVersion, undefined)
  assert.equal(dev.gameSession, 's')
})

test('a dev install folder already pointing at the live one is moved off it', () => {
  const dev = { baseDirPath: 'C:\\DragonBreak\\x' }
  d.applyHandoff((k, v) => { dev[k] = v }, k => dev[k], { liveBaseDir: 'C:\\DragonBreak' }, 'C:\\DragonBreak')
  assert.equal(dev.baseDirPath, 'C:\\DragonBreak-Dev')
  const kept = { baseDirPath: 'E:\\DBO-dev' }
  d.applyHandoff((k, v) => { kept[k] = v }, k => kept[k], { liveBaseDir: 'C:\\DragonBreak' }, 'C:\\DragonBreak')
  assert.equal(kept.baseDirPath, 'E:\\DBO-dev')
})

const sha = 'a'.repeat(64)
const manifest = (over = {}) => ({
  version: 'v1', loadOrder: ['Skyrim.esm', 'Update.esm', 'DragonBreak.esp', 'FreeClimb.esp'],
  files: [{ path: 'Data/DragonBreak.esp', size: 10, sha256: sha, url: 'https://dev-relay.example.net/files/Data/DragonBreak.esp' },
    { path: 'Data/DragonBreak.bsa', size: 20, sha256: sha }],
  ...over,
})

test('the dev file list is checked before anything is downloaded', () => {
  assert.equal(d.validateManifest(manifest()), null)
  assert.match(d.validateManifest(null), /empty/)
  assert.match(d.validateManifest(manifest({ loadOrder: [] })), /load order/)
  assert.match(d.validateManifest(manifest({ files: [{ path: '../evil.dll', size: 1, sha256: sha }] })), /malformed/)
  assert.match(d.validateManifest(manifest({ files: [{ path: 'C:/Windows/x', size: 1, sha256: sha }] })), /malformed/)
  assert.match(d.validateManifest(manifest({ files: [{ path: 'Data\\x.esp', size: 1, sha256: sha }] })), /malformed/)
  assert.match(d.validateManifest(manifest({ files: [{ path: 'Data/x.esp', size: 1, sha256: 'nope' }] })), /malformed/)
  assert.match(d.validateManifest(manifest({ files: [{ path: 'Data/x.esp', size: 1, sha256: sha, url: 'http://x/y' }] })), /https/)
  assert.match(d.validateManifest(manifest({ install: { mods: [] } })), /mod list/)
})

test('the dev serverinfo carries dev\'s load order and asks for a Discord login', () => {
  const info = d.serverInfoFrom(manifest(), { name: 'DragonBreak DEV', address: 'dev-relay.example.net', port: 7777 })
  assert.deepEqual(info.loadOrder, manifest().loadOrder)
  assert.equal(info.offlineMode, false)
  assert.equal(info.dev, true)
  assert.equal(info.host, 'dev-relay.example.net')
})

test('dev mods join live\'s install manifest; dev wins a clash; plugins follow dev\'s load order', () => {
  const live = { mods: [{ name: 'A' }, { name: 'B', v: 1 }], archives: [{ id: 'a1' }, { id: 'b1', v: 1 }], order: ['B', 'A'], root: [{ to: 'x' }] }
  const dev = { mods: [{ name: 'FreeClimb' }, { name: 'B', v: 2 }], archives: [{ id: 'fc1' }, { id: 'b1', v: 2 }] }
  const m = d.mergeInstallManifest(live, dev, manifest().loadOrder)
  assert.deepEqual(m.mods.map(x => x.name), ['A', 'FreeClimb', 'B'])
  assert.equal(m.mods.find(x => x.name === 'B').v, 2)
  assert.deepEqual(m.archives.map(x => x.id), ['a1', 'fc1', 'b1'])
  assert.deepEqual(m.order, ['A', 'FreeClimb', 'B'])
  assert.deepEqual(m.plugins, ['*DragonBreak.esp', '*FreeClimb.esp'])
  assert.deepEqual(m.root, live.root)
  assert.deepEqual(live.mods.map(x => x.name), ['A', 'B'], 'the live manifest object is left as it was')
  assert.deepEqual(d.mergeInstallManifest(live, { ...dev, order: ['FreeClimb', 'A', 'B'] }, ['X.esp']).order, ['FreeClimb', 'A', 'B'])
  assert.deepEqual(d.mergeInstallManifest(live, undefined, ['X.esp']).mods, live.mods)
})

test('the dev file list becomes the extras list, with its own version and the dev URLs kept', () => {
  const x = d.asExtraManifest(manifest())
  assert.equal(x.version, 'dev-v1')
  assert.equal(x.files[0].url, 'https://dev-relay.example.net/files/Data/DragonBreak.esp')
  assert.equal(x.files[1].url, undefined)
})

test('client settings point at the relay with no profileId, so the client sends the ticket as its session', () => {
  const s = d.devClientSettings({ chatFocusKeyCodes: [28], gameData: { profileId: 5 } }, { address: 'dev-relay.example.net', port: '7777' })
  assert.equal(s['server-ip'], 'dev-relay.example.net')
  assert.equal(s['server-port'], 7777)
  assert.equal(s.master, '')
  assert.equal(s['server-master-key'], null)
  assert.equal(s['server-info-ignore'], true)
  assert.deepEqual(s.chatFocusKeyCodes, [28])
  const auth = JSON.parse(d.devAuthData('dbodev1.p.s', { username: 'Lead' }, 42).slice(2))
  assert.equal(auth.session, 'dbodev1.p.s')
  assert.equal(auth.masterApiId, 42)
  assert.equal(auth.discordUsername, 'Lead')
})

test('main.js never writes a profileId for dev: the keys it keeps are hotkeys only', () => {
  const keep = MAIN.match(/const HOTKEY_KEYS = \[([\s\S]*?)\]/)[1]
  assert.doesNotMatch(keep, /gameData/)
})

test('the gate knock carries the ticket and its answers are read strictly', () => {
  assert.equal(d.knockPacket('dbodev1.p.s').toString(), 'DBOKNOCK1 dbodev1.p.s')
  assert.deepEqual(d.parseKnockReply(Buffer.from('DBOKNOCK1 ok 1762600000')), { ok: true, until: 1762600000000 })
  assert.deepEqual(d.parseKnockReply(Buffer.from('DBOKNOCK1 no expired')), { ok: false, reason: 'expired' })
  assert.equal(d.parseKnockReply(Buffer.from('\x00\x01raknet')), null, 'game traffic is not an answer')
  assert.equal(d.parseKnockReply(Buffer.from('DBOKNOCK1 ok <script>')), null)
})

test('main.js knocks at the gate after the ticket and before every dev launch', () => {
  assert.match(MAIN, /await ensureDevTicket\(true\); await knockDevGate\(\)/)
})

test('the ticket goes only to the dev files host', () => {
  const files = 'https://dev-relay.example.net'
  assert.deepEqual(d.authHeadersFor('https://dev-relay.example.net/files/Data/x.esp', files, 't'), { authorization: 'DevTicket t' })
  assert.deepEqual(d.authHeadersFor('https://files.dragonbreakonline.com/x', files, 't'), {})
  assert.deepEqual(d.authHeadersFor('https://dev-relay.example.net.evil.com/x', files, 't'), {})
  assert.deepEqual(d.authHeadersFor('http://dev-relay.example.net/x', files, 't'), {})
  assert.deepEqual(d.authHeadersFor('https://dev-relay.example.net/x', '', 't'), {})
  assert.deepEqual(d.authHeadersFor('https://dev-relay.example.net/x', files, null), {})
})

test('a ticket is renewed 30 minutes before it runs out', () => {
  const now = 1_000_000_000
  assert.equal(d.ticketFresh({ ticket: 't', expiresAt: now + 31 * 60 * 1000 }, now), true)
  assert.equal(d.ticketFresh({ ticket: 't', expiresAt: now + 29 * 60 * 1000 }, now), false)
  assert.equal(d.ticketFresh(null, now), false)
})

test('main.js reads serverinfo and the install manifest only through the dev-aware functions', () => {
  const direct = s => (MAIN.match(new RegExp(s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'g')) || []).length
  assert.equal(direct('fetchJSON(`${config.apiUrl}/api/serverinfo`)'), 1, 'only fetchServerInfo fetches it')
  assert.equal(direct('fetchJSON(`${config.apiUrl}/api/serverinfo`, headers)'), 1, 'api:serverinfo, for live only')
  assert.equal(direct('fetchJSON(`${config.apiUrl}/api/install-manifest`)'), 1, 'only fetchInstallManifest fetches it')
  assert.match(MAIN, /if \(DEV_MODE\) return devServer\.asExtraManifest\(await fetchDevManifest\(\)\)/)
  assert.match(MAIN, /function effectiveGamePath\(\) \{\s*\/\/[^\n]*\n\s*if \(DEV_MODE\) return isolatedGameDir\(\)/)
  assert.match(MAIN, /if \(!DEV_MODE && session && serverInfo && serverInfo\.offlineMode === false\)/, 'no production launch-check for dev')
})
