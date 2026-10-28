'use strict'
// The ask readers (sources/ai/askSources.js) against fixtures: field whitelists, rank checks and fail-closed dbd-coms calls

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { createSources, DBD_COMS } = require('../sources/ai/askSources')

const FIX = path.join(__dirname, 'fixtures', 'ask')
const fixture = name => fs.readFileSync(path.join(FIX, name), 'utf8')
const snow = n => (10n ** 18n + BigInt(n)).toString()
const NOW = 1_800_000_000_000
const FORUM = snow(700)

const TICKET_TYPES = [
  { id: 'pk', category: 'Player Kill Requests' }, { id: 'mod', category: 'Moderation Help' }, { id: 'rep', category: 'Player Reports' },
  { id: 'gmr', category: 'GM Reports', ownersOnly: true }, { id: 'fac', category: 'Faction Inquiries' },
]

// execFile as child_process hands it over: what was run is recorded, and each command answers as the test says
function fakeExec(answers = {}) {
  const calls = []
  const fn = (file, args, opts, cb) => {
    calls.push({ file, args, opts })
    const a = answers[args[2]] ?? answers['*']
    if (a === 'hang') return
    if (a === 'exit') return cb(Object.assign(new Error('exit 1'), { code: 1 }), '', '')
    if (a === 'notjson') return cb(null, 'Traceback: oops\n', '')
    if (a === 'error') return cb(null, '{"error": "not available"}\n', '')
    cb(null, `${typeof a === 'string' ? a : JSON.stringify(a)}\n`, '')
  }
  return { fn, calls }
}

const FILES = {
  'gm-calls.json': fixture('gm-calls.json'), 'live.json': fixture('live.json'), 'tickets.json': fixture('tickets.json'), 'news.live.json': fixture('news.json'),
}
const readFile = async file => { const b = path.basename(file); if (FILES[b] === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return FILES[b] }

function discord({ tags = JSON.parse(fixture('forum-tags.json')), threads = JSON.parse(fixture('active-threads.json')) } = {}) {
  const calls = []
  return {
    calls,
    activeThreads: async () => { calls.push('threads'); return threads },
    forumTags: id => { calls.push(`tags:${id}`); return tags },
    channels: () => [
      { id: snow(820), parentId: snow(802), type: 0 }, { id: snow(821), parentId: snow(802), type: 0 }, { id: snow(822), parentId: snow(803), type: 0 },
      { id: snow(823), parentId: snow(804), type: 0 }, { id: snow(802), parentId: null, type: 4 },
    ],
  }
}

function make(o = {}) {
  const exec = o.exec || fakeExec(o.answers || {})
  const sources = createSources({
    config: { gameServerDir: '/srv/game', discordErrorForumChannelId: FORUM, port: 4000 }, execFile: exec.fn, readFile: o.readFile || readFile,
    fetchLocal: o.fetchLocal || (async route => { assert.equal(route, '/api/version'); return JSON.parse(fixture('version.json')) }),
    punishments: o.punishments || (() => { throw new Error('no punishments in this test') }), profileIdOf: () => 7,
    ticketTypes: () => TICKET_TYPES, now: () => NOW, timeouts: { dbd: 30, file: 30, discord: 30, punish: 30, local: 30 },
  })
  return { sources, exec }
}
const GM = { tier: 'gm', punishTier: 'gm', discordId: snow(31) }
const OWNER = { tier: 'owner', punishTier: 'owner', discordId: snow(33) }
const TRIAL = { tier: 'trialgm', punishTier: null, discordId: snow(34) }

test('status: dbd-coms server-status with argv kept apart, no shell, the caps; ops_claims and unknown fields never reach the card', async () => {
  const { sources, exec } = make({ answers: { 'server-status': fixture('server-status.json') } })
  const [c] = await sources.read('status', {}, TRIAL)
  assert.equal(exec.calls.length, 1)
  const call = exec.calls[0]
  assert.equal(call.file, 'python3')
  assert.deepEqual(call.args, ['-I', DBD_COMS, 'server-status'])
  assert.equal(call.opts.shell, undefined)
  assert.equal(call.opts.timeout, 12000)
  assert.equal(call.opts.maxBuffer, 262144)
  assert.deepEqual(call.opts.env, { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' })
  assert.match(c.text, /Players online: 26/)
  assert.match(c.text, /Client version: 0\.3\.109/)
  assert.match(c.text, /Bruma Caverns, Gallows Rock/)
  assert.match(c.text, /since 2026-10-27 23:35Z/)
  for (const bad of ['claude', 'ops', 'claim', '192.168', 'debug']) assert.ok(!c.text.toLowerCase().includes(bad), bad)
  assert.equal(c.model, false)
})

test('dbd-coms timeout, a non-zero exit, output that is not JSON and {"error"} each give "not available"', async () => {
  for (const a of ['hang', 'exit', 'notjson', 'error']) {
    const { sources } = make({ answers: { 'server-status': a } })
    const [c] = await sources.read('status', {}, GM)
    assert.equal(c.text, 'not available', a)
    assert.equal(c.stale, 'unavailable', a)
  }
})

test('changes: the span is its own argument, at most 15 rows, and the card goes to the model only for a summary', async () => {
  const many = { ...JSON.parse(fixture('changes-24.json')), count: 30, changes: Array.from({ length: 30 }, (_, i) => ({ at: '2026-10-28T10:00Z', kind: 'LIVE', headline: `Change ${i}` })) }
  const { sources, exec } = make({ answers: { changes: many } })
  const [c] = await sources.read('changes', { time: 'today', summary: false }, TRIAL)
  assert.deepEqual(exec.calls[0].args, ['-I', DBD_COMS, 'changes', 'today'])
  assert.equal(c.text.split('\n').filter(l => /Change \d+/.test(l)).length, 15)
  assert.match(c.text, /15 older rows not shown/)
  assert.equal(c.model, false)
  const [s] = await sources.read('changes', { time: '$(id)', summary: true }, TRIAL)
  assert.deepEqual(exec.calls[1].args.slice(2), ['changes', '24'])
  assert.equal(s.model, true)
})

test('version: /api/version on loopback plus the news entries for that client version only', async () => {
  const { sources } = make()
  const cards = await sources.read('version', { clientVer: null }, TRIAL)
  assert.equal(cards.length, 2)
  assert.match(cards[0].text, /Launcher 2\.1\.53, client 0\.3\.109, server 0\.3\.1/)
  assert.ok(!cards[0].text.includes('http'), 'the download link is not a kept field')
  assert.match(cards[1].text, /home planters/i)
  assert.ok(cards.every(c => c.model === true))
  const none = await sources.read('version', { clientVer: '0.3.120' }, TRIAL)
  assert.equal(none.length, 1)
})

test('bug_id: dbd-coms bug <id> as two arguments; the card keeps the thread id for the link and the named fields', async () => {
  const id = snow(901)
  const { sources, exec } = make({ answers: { bug: fixture('bug-id.json') } })
  const [c] = await sources.read('bug_id', { ids: [id] }, TRIAL)
  assert.deepEqual(exec.calls[0].args.slice(2), ['bug', id])
  assert.deepEqual(c.links, [id])
  assert.equal(c.rows[0].thread, id)
  assert.match(c.text, /status Confirmed; created 2026-10-21; resolution: Fixed in the 27 Oct server update \(2026-10-27\)/)
  assert.equal(c.model, false)
})

test('bug_search: Exploit-tagged threads and other forums are dropped; the older list is marked with its date', async () => {
  const d = discord()
  const { sources, exec } = make({ answers: { bug: fixture('bug-words.json') } })
  const cards = await sources.read('bug_search', { q: 'is the horse vanishing bug fixed?' }, TRIAL, { discord: d })
  const live = cards.find(c => c.key === 'bugs:live')
  const older = cards.find(c => c.key === 'bugs:older')
  assert.deepEqual(live.links, [snow(901)])
  assert.ok(!JSON.stringify(live).includes(snow(904)), 'the Exploit thread is never shown')
  assert.ok(!JSON.stringify(live).includes(snow(906)), 'a thread of another forum is not a bug thread')
  assert.match(live.text, /\[Confirmed\]/)
  assert.equal(older.stale, 'older list, up to 2026-10-08 09:09Z')
  assert.deepEqual(exec.calls[0].args.slice(2), ['bug', 'horse', 'vanishing'])
  assert.ok(d.calls.includes(`tags:${FORUM}`))
})

test('bug_search refuses the live part when the forum has no Exploit tag (fail closed)', async () => {
  const d = discord({ tags: [{ id: snow(711), name: 'Confirmed' }] })
  const { sources } = make({ answers: { bug: fixture('bug-words.json') } })
  const cards = await sources.read('bug_search', { q: 'horse vanished' }, TRIAL, { discord: d })
  const live = cards.find(c => c.key === 'bugs:live')
  assert.equal(live.text, 'not available')
  assert.match(live.stale, /no Exploit tag/)
  assert.ok(!d.calls.includes('threads'), 'the threads are not even listed')
})

test('player_reports: Gm and above; the name and #TAG go as separate arguments; active tracker titles "Name #TAG:" are added', async () => {
  const { sources, exec } = make({ answers: { 'player-reports': fixture('player-reports.json') } })
  const refused = await sources.read('player_reports', { query: 'Kara #QX7P' }, TRIAL, { discord: discord() })
  assert.equal(refused[0].stale, 'rank')
  assert.equal(exec.calls.length, 0)
  const cards = await sources.read('player_reports', { query: 'Kara #QX7P' }, GM, { discord: discord() })
  assert.deepEqual(exec.calls[0].args.slice(2), ['player-reports', 'Kara', '#QX7P'])
  const older = cards.find(c => c.key === 'reports:older')
  const live = cards.find(c => c.key === 'reports:live')
  assert.match(older.stale, /older list, up to 2026-10-08/)
  assert.deepEqual(live.links, [snow(901)])
})

test('gm_calls keeps n, age, name, zone, description and taken/free; drops discord, actor, profile, pos, lines and ticket', async () => {
  const { sources } = make()
  const [c] = await sources.read('gm_calls', {}, GM)
  assert.match(c.text, /Call 13: Kara #QX7P, Whiterun, Dragonsreach, great hall, 14 min ago, free/)
  assert.match(c.text, /Call 14: Bron #ZK2M, Bruma, south gate, 3 min ago, taken/)
  for (const bad of ['ff00a1b2', snow(950), 'ticket:328', 'help I am stuck', 'WhiterunDragonsreach', '412', 'Gemma', 'Old Call']) assert.ok(!c.text.includes(bad), bad)
  const [t] = await sources.read('gm_calls', {}, TRIAL)
  assert.equal(t.stale, 'rank')
})

test('online keeps the count and names only', async () => {
  const { sources } = make()
  const [c] = await sources.read('online', {}, GM)
  assert.equal(c.text, '2 online: Kara, Bron.')
  for (const bad of ['Tamriel', '41', 'hosting', '0.5', 'npcs']) assert.ok(!c.text.includes(bad), bad)
})

test('tickets: counts per type with no channel names; GM Reports only for an Owner', async () => {
  const { sources } = make()
  const [gm] = await sources.read('tickets', {}, GM, { discord: discord() })
  assert.match(gm.text, /Moderation Help: 2/)
  assert.match(gm.text, /Player Reports: 1/)
  assert.ok(!gm.text.includes('GM Reports'))
  const [owner] = await sources.read('tickets', {}, OWNER, { discord: discord() })
  assert.match(owner.text, /GM Reports: 1/)
  assert.ok(!owner.text.includes(snow(823)))
})

test('punishments: no punish tier is refused before the service is touched; one match reads that account; none says so', async () => {
  const seen = []
  const service = {
    search: async (v, q) => { seen.push(['search', v, q]); return { accounts: q === '#QX7P' ? [{ profileId: 412 }] : [] } },
    player: async (v, pid) => { seen.push(['player', v, pid]); return { status: 200, body: { player: { profileId: pid, discordName: 'kara', characters: [{ name: 'Kara', tag: '#QX7P' }] }, strikes: { count: 2, review: 3, days: 90 }, active: [{ kind: 'strike', target: { name: 'Kara', tag: '#QX7P' }, state: 'active', reason: 'metagaming', at: '2026-10-20T10:00:00Z' }], history: [] } } },
    active: async v => { seen.push(['active', v]); return { rows: [] } },
  }
  const { sources } = make({ punishments: () => service })
  const [none] = await sources.read('punish_player', { query: '#QX7P' }, TRIAL)
  assert.equal(none.text, 'Punishment records are not visible to your rank here.')
  assert.equal(seen.length, 0)
  const [one] = await sources.read('punish_player', { query: '#QX7P' }, GM)
  assert.deepEqual(seen.map(s => s[0]), ['search', 'player'])
  assert.deepEqual(seen[0][1], { tier: 'gm', discordId: GM.discordId, profileId: 7 })
  assert.match(one.text, /Strikes: 2 \(review at 3, each counts 90 days\)/)
  assert.match(one.text, /strike \u00b7 Kara #QX7P \u00b7 active \u00b7 "metagaming"/)
  assert.equal(one.model, false)
  const [zero] = await sources.read('punish_player', { query: 'Nobody' }, GM)
  assert.equal(zero.text, 'No account matches Nobody.')
  const [act] = await sources.read('punish_active', {}, GM)
  assert.equal(act.text, 'Nothing is running now.')
})

test('rules: a Trial GM gets Server Rules chunks only; a GM may get the Staff Handbook', async () => {
  const { sources } = make()
  const trial = await sources.read('rules', { q: 'what does the handbook say about keeping it private 2.6', docs: ['rules', 'staff'] }, TRIAL)
  assert.ok(trial.every(c => c.source === 'rules'))
  const gm = await sources.read('rules', { q: 'handbook 2.6 keep it private', docs: ['staff'] }, GM)
  assert.equal(gm[0].key, 'staff:2.6')
  assert.equal(gm[0].exact, true)
  assert.ok(gm.length <= 4)
  assert.ok(gm.every(c => c.model === true))
})

test('an unknown intent reads nothing, and a reader that throws gives a card, never an exception', async () => {
  const { sources, exec } = make()
  assert.deepEqual(await sources.read('players_json', {}, OWNER), [])
  const [c] = await sources.read('punish_active', {}, GM)
  assert.equal(c.text, 'not available')
  assert.equal(exec.calls.length, 0)
})

// The held list (cross-part contract with the detector): Owners only, the newest 10 of 30 days, every field checked
const { heldEntry, HELD_FILE } = require('../sources/ai/askSources')
const { compose } = require('../sources/discord/dragonbaronAsk')
const G = snow(4)
const held = (i, o = {}) => JSON.stringify({
  v: 1, at: new Date(NOW - i * 60000).toISOString(), guild: 'G'.repeat(40), guild_id: G, channel: '#' + 'c'.repeat(40), message_id: snow(70000 + i),
  jump: `https://discord.com/channels/${G}/${snow(650)}/${snow(70000 + i)}`, author: 'A'.repeat(40), staff_role: 'R'.repeat(30),
  categories: ['bleed', 'ooc_hostile', 'metagame'], rule_ids: ['D3', '10.2', 'D1', '5.3'], reason: 'w'.repeat(300), confidence: 0.91, excerpt: 'x'.repeat(300), ...o,
})
function heldSources(text, st = {}) {
  const seen = []
  const sources = createSources({
    config: {}, now: () => NOW, timeouts: { file: 30 },
    heldFile: '/held.jsonl', readFile: async f => { seen.push(['read', f]); return text },
    statFile: async f => { seen.push(['stat', f]); return { isFile: () => true, uid: 0, mode: 0o100600, size: text.length, ...st } },
  })
  return { sources, seen }
}

test('held: the default file is the contract path, and every rank below Owner gets nothing at all, with the file never touched', async () => {
  assert.equal(HELD_FILE, '/opt/dragonbreak-tools/state/infraction-watch-held.jsonl')
  const { sources, seen } = heldSources(held(1))
  for (const tier of ['dev', 'leadgm', 'gm', 'trialgm', null, undefined, 'Owner']) assert.deepEqual(await sources.read('held', {}, { tier }), [], String(tier))
  assert.deepEqual(seen, [])
  const [c] = await sources.read('held', {}, OWNER)
  assert.equal(c.minTier, 'owner')
  assert.equal(c.model, false)
  assert.equal(c.embed, true)
  assert.deepEqual(seen.map(s => s[0]), ['stat', 'read'])
})

test('held: an entry keeps only contract fields; rule ids outside the shared list, unknown categories and a link to another message are dropped', () => {
  const e = heldEntry(held(1, { rule_ids: ['D3', '99', 'rm -rf', 'D10'], categories: ['bleed', 'none', 'evil'], jump: `https://discord.com/channels/${G}/${snow(650)}/${snow(1)}`, extra: 'x' }))
  assert.deepEqual(e.rules, ['D3', 'D10'])
  assert.deepEqual(e.categories, ['bleed'])
  assert.equal(e.jump, null)
  assert.equal(e.extra, undefined)
  assert.deepEqual(heldEntry(held(1)).jump, { guild: G, channel: snow(650), message: snow(70001) })
  for (const bad of [{ v: 2 }, { at: 'yesterday' }, { guild_id: 'abc' }, { message_id: '12' }, { categories: ['none'] }, { categories: 'bleed' }]) assert.equal(heldEntry(held(1, bad)), null, JSON.stringify(bad))
  assert.equal(heldEntry('[1]'), null)
  assert.equal(heldEntry(held(1, { confidence: '0.9' })).confidence, null)
  assert.equal(heldEntry(held(1, { confidence: 3 })).confidence, null)
})

test('held: the newest 10 of the last 30 days, newest first; older, future and unreadable lines are not shown', async () => {
  const lines = [held(31 * 24 * 60), held(-60), 'junk', ...Array.from({ length: 12 }, (_, i) => held(i + 1))]
  const { sources } = heldSources(lines.join('\n'))
  const [c] = await sources.read('held', {}, OWNER)
  assert.match(c.rows[0].text, /^12 held in the last 30 days; the newest 10 are shown\./)
  assert.equal(c.rows[1].text, '1 line of the list could not be read.')
  const heads = c.rows.filter(r => r.jump)
  assert.equal(heads.length, 10)
  assert.deepEqual(heads.map(r => r.jump.message), Array.from({ length: 10 }, (_, i) => snow(70001 + i)))
})

test('held: ten entries with every field at its longest fit one embed, with all ten heads and their links', async () => {
  const { sources } = heldSources(Array.from({ length: 10 }, (_, i) => held(i + 1)).join('\n'))
  const cards = await sources.read('held', {}, OWNER)
  const { renderTemplate } = require('../sources/ai/askAnswer')
  const { embeds, content } = compose({ outcome: 'answered', mode: 'template', blocks: renderTemplate(null, cards), sources: cards })
  const d = embeds[0].description
  assert.ok(d.length <= 4096, String(d.length))
  assert.ok(!d.includes('cut to fit'))
  assert.equal((d.match(/\[open\]\(https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+\)/g) || []).length, 10)
  assert.equal((d.match(/^Excerpt: "/gm) || []).length, 10)
  assert.equal((d.match(/^Why: /gm) || []).length, 10)
  assert.ok(content.length < 200)
})

test('held: a missing file is "nothing held"; a file another user owns, others can write, or that is too big is not available', async () => {
  const missing = createSources({ config: {}, now: () => NOW, heldFile: '/nope', statFile: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }, readFile: async () => { throw new Error('read') } })
  assert.equal((await missing.read('held', {}, OWNER))[0].text, 'Nothing is held for the Owners.')
  for (const st of [{ uid: 1000 }, { mode: 0o100602 }, { mode: 0o100620 }, { size: 5 * 1024 * 1024 }, { isFile: () => false }]) {
    const { sources, seen } = heldSources(held(1), st)
    const [c] = await sources.read('held', {}, OWNER)
    assert.equal(c.text, 'not available', JSON.stringify(st))
    assert.ok(!seen.some(s => s[0] === 'read'), 'the file is not read')
  }
})
