'use strict'
// sources/punish/tracker.js: the active-punishments reconciler on hand-made snapshots (built by the real record parsers),
// against an in-memory Discord forum, in temp folders. Nothing here touches the network

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const R = require('../sources/punish/records')
const { createTracker, createRestWriter, start, finish, markerOf, tagNames } = require('../sources/punish/tracker')

const HOUR = 3600000
const DAY = 24 * HOUR
const T0 = Date.parse('2026-10-28T12:00:00Z')
const FORUM = '1564694518194774067'
const GUILD = '1500000000000000001'
const iso = t => new Date(t).toISOString()
const PEOPLE = {
  alice: { profileId: 57, discordId: '811111111111111111', name: 'alice_rp', char: 'Alia', tag: 'ALI1' },
  bob: { profileId: 58, discordId: '822222222222222222', name: 'bob_rp', char: 'Borin', tag: 'BOR1' },
  dialis: { profileId: 126, discordId: '833333333333333333', name: 'dialis', char: 'Dialis', tag: 'DIA1' },
  nolink: { profileId: 70, discordId: null, name: null, char: 'Nell', tag: 'NEL1' },
}
const ALL_IDS = Object.values(PEOPLE).map(p => p.discordId).filter(Boolean)
const TAGS = ['Active', 'Expired', 'Warning', 'Strike', 'Suspended', 'Banned', 'Discord timeout', 'Review'].map((name, i) => ({ id: `9000000000000000${10 + i}`, name }))
const tagId = name => TAGS.find(t => t.name === name).id

const dirs = []
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })
const tempDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-tracker-')); dirs.push(d); return d }

// A discipline entry as the game's discipline.js writes it
const entry = (n, kind, atMs, extra = {}) => ({ n, kind, reason: `reason ${n}`, by: 'Lena #LED1', at: iso(atMs), char: 'Alia #ALI1', ...extra })

// What trackerSnapshot() hands over, from record file contents, with fill()'s profile and Discord matching. links: a
// profile's Discord id put in (null takes it away); idStatus: identity.js's read status of profiles.json and players.json
function snap(d, now, status = {}, links = {}, idStatus = { profiles: 'ok', players: 'ok', store: 'ok' }) {
  const id = { profileOf: new Map(), discordOf: new Map(), names: new Map(), chars: new Map(), status: idStatus }
  for (const p of Object.values(PEOPLE)) {
    const discordId = links[p.profileId] !== undefined ? links[p.profileId] : p.discordId
    if (discordId) {
      id.profileOf.set(discordId, p.profileId)
      id.discordOf.set(p.profileId, discordId)
      id.names.set(discordId, { shown: p.name || 'nell_rp', all: [] })
    }
    id.chars.set(p.profileId, [{ name: p.char, tag: p.tag, status: 'alive' }])
  }
  const dsc = R.disciplineRows(R.parseDiscipline({ profiles: d.discipline || {} }), { now, strikeDays: 90 })
  const rows = [
    ...dsc.rows,
    ...R.adminBanRows(R.parseAdminBans({ bans: d.adminBans || [] }), { now }),
    ...R.banRows(R.parseBans(d.bans || [])),
    ...R.journalRows((d.journal || []).map(R.parseJournalLine).filter(Boolean), { now }),
  ]
  for (const r of rows) {
    const t = r.target
    if (t.profileId === null && r._discordId) t.profileId = id.profileOf.get(r._discordId) ?? null
    if (!r._discordId && t.profileId !== null) r._discordId = id.discordOf.get(t.profileId) || null
    t.discordName = t.discordName || (r._discordId && id.names.has(r._discordId) ? id.names.get(r._discordId).shown : null)
  }
  const ok = { status: 'ok', asOf: iso(now) }
  return {
    at: now, rows: R.oneRowPerBan(rows), strikes: dsc.strikes, cfg: { discipline: { strikeDays: 90, strikesForReview: 3 } }, id,
    sources: { discipline: ok, panelBans: ok, bans: ok, journal: ok, ...status },
  }
}

// The forum in memory: threads with their messages, the guild's active thread count and the members' usernames
function fakeDiscord({ tags = TAGS, active = 0, members = { [PEOPLE.alice.discordId]: 'alice_rp', [PEOPLE.bob.discordId]: 'bob_rp' } } = {}) {
  const calls = []
  const threads = new Map()
  let seq = 0
  const nextId = () => String(700000000000000000n + BigInt(++seq))
  const fail = (status, code) => Object.assign(new Error(`fake ${status} ${code}`), { status, code, body: JSON.stringify({ code }) })
  const fake = {
    // fail(method, path, body): an error to throw for this request instead of answering it, or nothing
    calls, threads, tags, active, members, refuseTags: false, loseNextCreate: false, fail: () => null,
    writes: () => calls.filter(c => c.method !== 'GET'),
    thread: () => [...threads.values()][0],
    async request(method, p, body) {
      calls.push({ method, path: p, body })
      const refused = fake.fail(method, p, body)
      if (refused) throw refused
      let m
      if (method === 'GET' && p === `/channels/${FORUM}`) return { id: FORUM, available_tags: fake.tags }
      if (method === 'GET' && p === `/guilds/${GUILD}/threads/active`) {
        const others = Array.from({ length: fake.active }, (_, i) => ({ id: String(600000000000000000n + BigInt(i)), parent_id: '1' }))
        return { threads: [...others, ...[...threads.values()].filter(t => !t.archived).map(t => ({ id: t.id, parent_id: FORUM, name: t.name }))] }
      }
      if (method === 'GET' && p.startsWith(`/channels/${FORUM}/threads/archived/public`)) {
        return { threads: [...threads.values()].filter(t => t.archived).map(t => ({ id: t.id, parent_id: FORUM, name: t.name, thread_metadata: { archived: true } })), has_more: false }
      }
      if (method === 'GET' && (m = /^\/guilds\/\d+\/members\/(\d+)$/.exec(p))) {
        const who = fake.members[m[1]]
        if (who) return typeof who === 'string' ? { user: { username: who, global_name: null }, nick: null } : { user: { username: who.username, global_name: who.global_name || null }, nick: who.nick || null }
        throw fail(404, 10007)
      }
      if (method === 'GET' && /^\/users\/\d+$/.test(p)) throw fail(404, 10013)
      if (method === 'GET' && (m = /^\/channels\/(\d+)\/messages\/\1$/.exec(p))) {
        if (!threads.has(m[1])) throw fail(404, 10003)
        return threads.get(m[1]).messages[0]
      }
      if (method === 'POST' && p === `/channels/${FORUM}/threads`) {
        if (body.applied_tags && fake.refuseTags) throw fail(400, 50035)
        const id = nextId()
        threads.set(id, { id, name: body.name, archived: false, tags: body.applied_tags || [], patches: [], messages: [{ id, ...body.message }] })
        if (fake.loseNextCreate) { fake.loseNextCreate = false; throw new Error('socket hang up') }
        return { id, message: { id } }
      }
      if (method === 'POST' && (m = /^\/channels\/(\d+)\/messages$/.exec(p))) {
        const t = threads.get(m[1])
        if (!t) throw fail(404, 10003)
        t.archived = false
        const id = nextId()
        t.messages.push({ id, ...body })
        return { id }
      }
      if (method === 'PATCH' && (m = /^\/channels\/(\d+)\/messages\/(\d+)$/.exec(p))) {
        const t = threads.get(m[1])
        if (!t) throw fail(404, 10003)
        if (t.archived) throw fail(400, 50083)
        Object.assign(t.messages[0], body)
        return t.messages[0]
      }
      if (method === 'PATCH' && (m = /^\/channels\/(\d+)$/.exec(p))) {
        const t = threads.get(m[1])
        if (!t) throw fail(404, 10003)
        if (t.archived && body.archived !== false) throw fail(400, 50083)
        t.patches.push(body)
        if ('archived' in body) t.archived = body.archived
        if (body.name) t.name = body.name
        if (body.applied_tags) t.tags = body.applied_tags
        return { id: t.id }
      }
      throw new Error(`unexpected ${method} ${p}`)
    },
  }
  return fake
}
fakeDiscord.error = (status, code) => Object.assign(new Error(`fake ${status} ${code}`), { status, code, body: JSON.stringify({ code }) })

// A tracker on a temp registry, its record data, clock and fake forum; tick() builds a new snapshot each time
function rig({ config = {}, discord = fakeDiscord(), staffStatusOf, data = {}, dir = tempDir(), maxRequests = 100 } = {}) {
  const r = { now: T0, data, status: {}, links: {}, idStatus: undefined, logs: [], audits: [], discord, dir, file: path.join(dir, 'punish-threads.json') }
  r.make = () => createTracker({
    snapshot: () => snap(r.data, r.now, r.status, r.links, r.idStatus),
    config: { punishTracker: 'on', punishTrackerFile: r.file, discordGuildId: GUILD, discordBotToken: 'test-token', ...config },
    now: () => r.now, discord, staffStatusOf, maxRequests, log: l => r.logs.push(l), audit: l => r.audits.push(l),
  })
  r.tracker = r.make()
  r.tick = () => r.tracker.tick()
  r.registry = () => JSON.parse(fs.readFileSync(r.file, 'utf8'))
  r.messages = () => (discord.thread() ? discord.thread().messages : [])
  r.named = name => [...discord.threads.values()].find(t => t.name === name)
  r.posts = () => [...discord.threads.values()].flatMap(t => t.messages.slice(1).map(m => m.content))
  return r
}

// A rig past its first run, so what is added next is new
async function started(opts) {
  const r = rig(opts)
  assert.equal(await r.tick(), true)
  return r
}

test('a new strike opens one thread, titled by the Discord username, with one reply', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'strike', T0 - HOUR)] }
  await r.tick()
  const d = r.discord
  assert.equal(d.threads.size, 1)
  const t = d.thread()
  assert.equal(t.name, 'alice_rp')
  assert.equal(markerOf(t.messages[0].content), PEOPLE.alice.discordId)
  assert.match(t.messages[0].content, /^<@811111111111111111> · alice_rp\n/)
  assert.match(t.messages[0].content, /Status: \*\*ACTIVE\*\*/)
  assert.match(t.messages[0].content, /Strikes counting: 1 of 3/)
  assert.equal(t.messages.length, 2)
  const reply = t.messages[1]
  assert.match(reply.content, /^\*\*STRIKE\*\* · dsc:57:1\nCharacter: Alia #ALI1 \(profile 57\)\nIssued by: Lena #LED1\nWhen: <t:\d+:f>/)
  assert.match(reply.content, /Duration: counts until <t:\d+:D>; 1 of 3 in 90 days/)
  assert.match(reply.content, /Reason: reason 1\nTicket: none named\nSource: game discipline/)
  assert.equal(reply.nonce.length, 25)
  assert.equal(reply.enforce_nonce, true)
  const create = d.calls.find(c => c.method === 'POST' && c.path === `/channels/${FORUM}/threads`)
  assert.equal(create.body.auto_archive_duration, 10080)
  const reg = r.registry()
  const acct = reg.accounts[PEOPLE.alice.discordId]
  assert.equal(acct.threadId, t.id)
  assert.equal(acct.state, 'open')
  assert.equal(acct.rows['dsc:57:1'].state, 'counting')
  assert.equal(acct.rows['dsc:57:1'].msgId, reply.id)
  assert.equal(fs.statSync(r.file).mode & 0o777, 0o600)
})

test('a second punishment is one more reply in the same thread', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'strike', T0 - HOUR)] }
  await r.tick()
  r.now += 5 * 60000
  r.data.discipline[57].push(entry(2, 'warn', r.now - 60000, { reason: 'Spam (mod-1234)' }))
  await r.tick()
  assert.equal(r.discord.threads.size, 1)
  assert.equal(r.discord.calls.filter(c => c.method === 'POST' && c.path.endsWith('/threads')).length, 1)
  const msgs = r.messages()
  assert.equal(msgs.length, 3)
  assert.match(msgs[2].content, /^\*\*WARNING\*\* · dsc:57:2/)
  assert.match(msgs[2].content, /Ticket: mod-1234/)
  assert.match(msgs[0].content, /Warnings in the last 90 days: 1/, 'the starter is re-rendered')
})

test('a suspension that runs out posts ENDED, re-renders the starter and archives the thread with Expired', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'suspend', T0 - HOUR, { until: T0 + HOUR })] }
  await r.tick()
  const t = r.discord.thread()
  assert.match(t.messages[1].content, /^\*\*SUSPENSION\*\* · dsc:57:1/)
  assert.match(t.messages[1].content, /Duration: until <t:\d+:f> \(<t:\d+:R>\)/)
  assert.deepEqual(t.tags, [tagId('Active'), tagId('Suspended')])
  assert.equal(t.archived, false)
  r.now += 2 * HOUR
  await r.tick()
  assert.match(t.messages[2].content, /^\*\*ENDED\*\* · suspension dsc:57:1 ran out <t:\d+:f>$/)
  assert.match(t.messages[0].content, /Status: \*\*CLEAR\*\*/)
  assert.doesNotMatch(t.messages[0].content, /In force now/)
  assert.equal(t.archived, true)
  assert.deepEqual(t.tags, [tagId('Expired'), tagId('Suspended')])
  const acct = r.registry().accounts[PEOPLE.alice.discordId]
  assert.equal(acct.state, 'archived')
  assert.equal(acct.status, 'expired')
  assert.ok(!r.discord.calls.some(c => c.body && ('locked' in c.body)), 'never locked')
  assert.ok(!r.discord.calls.some(c => c.method === 'DELETE'), 'never deleted')
  // A new punishment reopens the same thread
  r.now += HOUR
  r.data.discipline[57].push(entry(2, 'strike', r.now - 60000))
  await r.tick()
  assert.equal(r.discord.threads.size, 1)
  assert.equal(t.archived, false)
  assert.match(t.messages[3].content, /^\*\*STRIKE\*\* · dsc:57:2/)
  assert.ok(t.tags.includes(tagId('Active')))
  assert.equal(r.registry().accounts[PEOPLE.alice.discordId].state, 'open')
})

test('a lift is folded into a LIFTED update; an unmatched lift is posted on its own', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'suspend', T0 - HOUR, { until: T0 + DAY })] }
  await r.tick()
  r.now += 60000
  r.data.discipline[57][0].lifted = true
  r.data.discipline[57].push(entry(2, 'lift', r.now, { by: 'Jake #JAKE', reason: 'Apologised', lifts: 1, liftsKind: 'suspend' }))
  await r.tick()
  const msgs = r.messages()
  assert.equal(msgs.length, 3)
  assert.equal(msgs[2].content, '**LIFTED** · suspension dsc:57:1 — by Jake #JAKE: Apologised')
  assert.ok(!msgs.some(m => /dsc:57:2/.test(m.content)), 'the lift is no punishment of its own')
  assert.equal(r.discord.thread().archived, true)
  assert.equal(r.registry().accounts[PEOPLE.alice.discordId].rows['dsc:57:2'].state, 'folded')
  r.now += 60000
  r.data.discipline[58] = [entry(1, 'lift', r.now, { char: 'Borin #BOR1', lifts: 9, liftsKind: 'suspend' })]
  await r.tick()
  const bob = [...r.discord.threads.values()].find(t => t.name === 'bob_rp')
  assert.match(bob.messages[1].content, /^\*\*LIFT\/OVERTURN \(unmatched\)\*\* · dsc:58:1 — lift by Lena #LED1/)
})

test('a row gone from the ban list posts UNBANNED, with the journal\'s unban when there is one', async () => {
  const r = await started()
  r.data.bans = [
    { ref: 'B-AAAAAA', discordId: PEOPLE.bob.discordId, reason: 'cheating', bannedAt: iso(T0 - HOUR), bannedBy: 'lena (dashboard)' },
    { ref: 'B-BBBBBB', discordId: PEOPLE.alice.discordId, reason: 'botting', bannedAt: iso(T0 - HOUR), bannedBy: 'lena (dashboard)' },
  ]
  await r.tick()
  const thread = name => [...r.discord.threads.values()].find(t => t.name === name)
  assert.match(thread('bob_rp').messages[1].content, /^\*\*GAME BAN LIST\*\* · ban:B-AAAAAA/)
  assert.match(thread('bob_rp').messages[0].content, /On the game ban list \(ban:B-AAAAAA\)/)
  r.now += 60000
  r.data.bans = []
  r.data.journal = [{ v: 1, id: 'M-UNBAN01', kind: 'unban', at: iso(r.now), discordId: PEOPLE.alice.discordId, ref: 'B-BBBBBB', reason: 'appeal accepted', by: { name: 'Jake' } }]
  await r.tick()
  assert.equal(thread('bob_rp').messages[2].content, '**UNBANNED** · ban:B-AAAAAA removed from the game ban list')
  assert.equal(thread('alice_rp').messages[2].content, '**UNBANNED** · game ban list entry ban:B-BBBBBB — by Jake: appeal accepted')
  assert.equal(thread('bob_rp').archived, true)
})

test('a source that cannot be read is frozen: no ENDED and no UNBANNED from it, posted once it reads again', async () => {
  const r = await started()
  r.data.bans = [{ ref: 'B-AAAAAA', discordId: PEOPLE.bob.discordId, reason: 'cheating', bannedAt: iso(T0 - HOUR), bannedBy: 'lena (dashboard)' }]
  r.data.discipline = { 57: [entry(1, 'suspend', T0 - HOUR, { until: T0 + HOUR })] }
  await r.tick()
  const before = r.discord.writes().length
  r.now += 2 * HOUR
  // The ban list read failed (its rows gone with it) and discipline kept its last good copy
  r.data.bans = []
  r.status = { bans: { status: 'unreadable' }, discipline: { status: 'unreadable' } }
  await r.tick()
  r.status = { bans: { status: 'missing' }, discipline: { status: 'ok' } }
  r.data.discipline = {}
  await r.tick()
  assert.equal(r.discord.writes().length, before, 'nothing posted from a failed or missing read')
  const reg = r.registry()
  assert.equal(reg.accounts[PEOPLE.bob.discordId].rows['ban:B-AAAAAA'].state, 'running')
  r.status = {}
  r.data.discipline = { 57: [entry(1, 'suspend', T0 - HOUR, { until: T0 + HOUR })] }
  await r.tick()
  const all = [...r.discord.threads.values()].flatMap(t => t.messages.map(m => m.content))
  assert.ok(all.includes('**UNBANNED** · ban:B-AAAAAA removed from the game ban list'))
  assert.ok(all.some(c => c.startsWith('**ENDED** · suspension dsc:57:1')))
})

test('a frozen source keeps its held rows in force: no CLEAR, Expired or archive, and the thread is synced once it reads again', async () => {
  const r = await started()
  r.data.bans = [{ ref: 'B-AAAAAA', discordId: PEOPLE.alice.discordId, reason: 'cheating', bannedAt: iso(T0 - HOUR), bannedBy: 'lena (dashboard)' }]
  r.data.discipline = { 57: [entry(1, 'strike', T0 - HOUR)] }
  await r.tick()
  const t = r.named('alice_rp')
  assert.match(t.messages[0].content, /Status: \*\*ACTIVE\*\*/)
  // The ban list goes missing while the strike is overturned: the ban is still held, so the thread stays as it is
  r.now += HOUR
  r.data.bans = []
  r.status = { bans: { status: 'missing' } }
  r.data.discipline[57][0].overturned = { by: 'Jake #JAKE', at: iso(r.now), reason: 'wrong player' }
  await r.tick()
  assert.ok(t.messages.some(m => m.content.startsWith('**OVERTURNED** · strike dsc:57:1')))
  assert.match(t.messages[0].content, /Status: \*\*ACTIVE\*\*/)
  assert.equal(t.archived, false)
  assert.ok(!t.tags.includes(tagId('Expired')))
  assert.equal(r.registry().accounts[PEOPLE.alice.discordId].rows['ban:B-AAAAAA'].state, 'running')
  // Back with the ban still there: the first tick brings the starter up to date, still in force
  r.now += 60000
  r.status = {}
  r.data.bans = [{ ref: 'B-AAAAAA', discordId: PEOPLE.alice.discordId, reason: 'cheating', bannedAt: iso(T0 - HOUR), bannedBy: 'lena (dashboard)' }]
  await r.tick()
  assert.match(t.messages[0].content, /Status: \*\*ACTIVE\*\*/)
  assert.match(t.messages[0].content, /On the game ban list \(ban:B-AAAAAA\)/)
  assert.match(t.messages[0].content, /overturned 1/)
  assert.equal(t.archived, false)
  assert.ok(t.tags.includes(tagId('Active')) && t.tags.includes(tagId('Banned')))
  assert.equal(r.registry().accounts[PEOPLE.alice.discordId].sync, false)
})

test('a new tracker on the same registry posts nothing twice; a thread whose creation lost its answer is found, not made again', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'strike', T0 - HOUR)] }
  await r.tick()
  const writes = r.discord.writes().length
  r.tracker = r.make()
  await r.tick()
  r.now += 60000
  r.tracker = r.make()
  await r.tick()
  assert.equal(r.discord.writes().length, writes)

  // Discord made the thread but the answer was lost: the registry keeps 'creating' and the next tick finds it by its marker
  r.discord.loseNextCreate = true
  r.data.discipline[58] = [entry(1, 'warn', r.now, { char: 'Borin #BOR1' })]
  await r.tick()
  assert.equal(r.registry().accounts[PEOPLE.bob.discordId].state, 'creating')
  r.tracker = r.make()
  await r.tick()
  const bobs = [...r.discord.threads.values()].filter(t => t.name === 'bob_rp')
  assert.equal(bobs.length, 1, 'one thread per person')
  assert.match(bobs[0].messages[1].content, /^\*\*WARNING\*\* · dsc:58:1/)
  const acct = r.registry().accounts[PEOPLE.bob.discordId]
  assert.equal(acct.threadId, bobs[0].id)
  assert.equal(acct.state, 'open')
})

test('profile 126 is skip-listed by default and never posted', async () => {
  const r = await started()
  r.data.discipline = { 126: [entry(1, 'warn', T0, { char: 'Dialis #DIA1' }), entry(2, 'suspend', T0, { char: 'Dialis #DIA1', until: T0 + DAY })] }
  r.data.journal = [{ v: 1, id: 'M-DIALIS1', kind: 'discord_timeout', at: iso(T0), until: iso(T0 + HOUR), discordId: PEOPLE.dialis.discordId, reason: 'test', by: { name: 'Dialis' } }]
  await r.tick()
  assert.equal(r.discord.threads.size, 0)
  assert.equal(r.registry().accounts[PEOPLE.dialis.discordId], undefined)
  assert.deepEqual(r.registry().skip, { profiles: [126] })
})

test('the title is the username only, capped at 100 characters; a profile with no Discord link keeps its thread when it gains one', async () => {
  const d = fakeDiscord()
  d.members[PEOPLE.alice.discordId] = 'a'.repeat(150)
  const r = await started({ discord: d })
  r.data.discipline = { 57: [entry(1, 'warn', T0)] }
  await r.tick()
  const t = d.thread()
  assert.equal([...t.name].length, 100)
  assert.ok(!/Alia|ALI1|·/.test(t.name), 'no character or #TAG in the title')

  r.data.discipline[70] = [entry(1, 'strike', T0, { char: 'Nell #NEL1' })]
  await r.tick()
  const nell = [...d.threads.values()].find(x => x.name === 'profile 70')
  assert.match(nell.messages[0].content, /^p:70 · profile 70 \(no Discord link\)\n/)
  assert.equal(markerOf(nell.messages[0].content), 'p:70')
  const id = '844444444444444444'
  r.links[70] = id
  d.members[id] = 'nell_rp'
  r.now += 60000
  await r.tick()
  const reg = r.registry()
  assert.equal(reg.accounts['p:70'], undefined)
  assert.equal(reg.accounts[id].threadId, nell.id)
  assert.equal(nell.name, 'nell_rp')
  assert.match(nell.messages[0].content, /^<@844444444444444444> · nell_rp\n/)
  assert.equal(nell.messages.length, 2, 'no post again')
})

test('posts carry no plain Discord id, no address, and allowed_mentions parse []; long text is cut under 2000', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'suspend', T0, { until: T0 + DAY, reason: `Threats to <@${PEOPLE.bob.discordId}> ${PEOPLE.bob.discordId} from 81.2.69.160 ${'x'.repeat(400)}` })] }
  r.data.journal = [{ v: 1, id: 'M-TIME0001', kind: 'discord_timeout', at: iso(T0), until: iso(T0 + HOUR), discordId: PEOPLE.bob.discordId, discordName: 'bob_rp', reason: 'spam', by: { name: 'Lena' } }]
  await r.tick()
  r.now += 2 * HOUR
  await r.tick()
  const sent = r.discord.writes().map(c => c.body).filter(b => b && (b.content || b.message))
  assert.ok(sent.length >= 5)
  for (const b of sent) {
    const m = b.message || b
    assert.deepEqual(m.allowed_mentions, { parse: [] })
    assert.ok(m.content.length < 2000)
    const bare = m.content.replace(/<@\d{15,22}>/g, '')
    assert.doesNotMatch(bare, /\d{15,}/)
    assert.doesNotMatch(m.content, /81\.2\.69/)
    for (const d of ALL_IDS) if (m.content.includes(d)) assert.ok(m.content.startsWith(`<@${d}> · `), 'an id only in the starter\'s marker')
  }
  const bob = [...r.discord.threads.values()].find(t => t.name === 'bob_rp')
  assert.match(bob.messages[2].content, /^\*\*TIMEOUT ENDED\*\* · mod:M-TIME0001 \(ran out <t:\d+:f>\)$/)
  const long = finish(`<@${PEOPLE.bob.discordId}> ${PEOPLE.alice.discordId} ${'y'.repeat(1890)}<t:1761652800:f>`)
  assert.ok(long.length <= 1900)
  assert.ok(long.startsWith(`<@${PEOPLE.bob.discordId}> [id] `))
  assert.ok(!/<t:[^>]*$/.test(long.slice(0, -1)), 'no half token at the cut')
})

test('tags: read by name, status + Review + the top 3 kinds, at most 5, a missing one left out; a refusal posts untagged', async () => {
  const d = fakeDiscord({ tags: TAGS.filter(t => t.name !== 'Suspended') })
  const r = await started({ discord: d })
  r.data.discipline = { 57: [
    entry(1, 'warn', T0 - 3 * DAY), entry(2, 'strike', T0 - 3 * DAY), entry(3, 'strike', T0 - 2 * DAY), entry(4, 'strike', T0 - DAY),
    entry(5, 'suspend', T0 - HOUR, { until: T0 + DAY }),
  ] }
  await r.tick()
  const t = d.thread()
  assert.deepEqual(t.tags, [tagId('Active'), tagId('Review'), tagId('Strike'), tagId('Warning')])
  assert.match(t.messages[0].content, /Lead GM review due/)
  assert.match(t.messages.find(m => /dsc:57:4/.test(m.content)).content, /3 of 3 in 90 days — Lead GM review due/)
  const x = { now: T0, warnDays: 90, strikes: 3, review: 3, ids: new Set(), all: [] }
  const rows = snap({ discipline: { 57: [entry(1, 'ban', T0), entry(2, 'suspend', T0, { until: T0 + DAY }), entry(3, 'strike', T0), entry(4, 'warn', T0)] },
    journal: [{ v: 1, id: 'M-TIME0002', kind: 'discord_timeout', at: iso(T0 - 1000), until: iso(T0 + HOUR), discordId: PEOPLE.alice.discordId }] }, T0).rows
  assert.deepEqual(tagNames(rows, x), ['Active', 'Review', 'Banned', 'Suspended', 'Discord timeout'])

  d.refuseTags = true
  r.data.discipline[58] = [entry(1, 'warn', T0, { char: 'Borin #BOR1' })]
  await r.tick()
  const bob = [...d.threads.values()].find(x => x.name === 'bob_rp')
  assert.deepEqual(bob.tags, [])
  assert.equal(bob.messages.length, 2)
  assert.ok(!d.calls.some(c => c.method === 'POST' && /\/tags/.test(c.path)), 'never creates tags')
})

test('first run: old rows are baselined, only accounts with something in force get a thread, with the history in its starter', async () => {
  const r = rig({ data: {
    discipline: {
      57: [entry(1, 'warn', T0 - 200 * DAY), entry(2, 'suspend', T0 - HOUR, { until: T0 + DAY })],
      58: [entry(1, 'suspend', T0 - 30 * DAY, { char: 'Borin #BOR1', until: T0 - 20 * DAY }), entry(2, 'strike', T0 - 120 * DAY, { char: 'Borin #BOR1' })],
    },
  } })
  await r.tick()
  assert.equal(r.discord.threads.size, 1)
  const t = r.discord.thread()
  assert.equal(t.name, 'alice_rp')
  assert.equal(t.messages.length, 2, 'one reply, for what is in force')
  assert.match(t.messages[1].content, /^\*\*SUSPENSION\*\* · dsc:57:2/)
  assert.match(t.messages[0].content, /History: 1 warnings, 0 strikes, 1 suspensions/)
  const reg = r.registry()
  assert.ok(reg.baselinedAt)
  assert.equal(reg.accounts[PEOPLE.alice.discordId].rows['dsc:57:1'].baseline, true)
  assert.deepEqual(Object.keys(reg.accounts[PEOPLE.bob.discordId].rows).sort(), ['dsc:58:1', 'dsc:58:2'])
  assert.equal(reg.accounts[PEOPLE.bob.discordId].threadId, null)
  r.now += 60000
  await r.tick()
  assert.equal(r.discord.threads.size, 1)
  assert.equal(t.messages.length, 2)
})

test('thread headroom: above 975 active threads creation is held and logged once an hour, the row kept unposted', async () => {
  const d = fakeDiscord({ active: 976 })
  const r = await started({ discord: d })
  r.data.discipline = { 57: [entry(1, 'strike', T0)] }
  await r.tick()
  r.now += 60000
  await r.tick()
  assert.equal(d.threads.size, 0)
  const held = r.registry().accounts[PEOPLE.alice.discordId]
  assert.deepEqual(held.rows, {}, 'the row is kept unposted')
  assert.equal(held.threadId, null)
  assert.equal(held.state, 'none')
  assert.equal(r.logs.filter(l => /waiting for thread headroom/.test(l)).length, 1)
  assert.deepEqual(r.audits, ['PUNISH-TRACKER waiting for thread headroom: new threads are held'], 'one audit.log line an hour')
  assert.equal(d.calls.filter(c => c.path.endsWith('/threads/active')).length, 1, 'the first run\'s scan, cached for 10 minutes')
  d.active = 900
  r.now += 11 * 60000
  await r.tick()
  assert.equal(d.threads.size, 1)
  assert.match(d.thread().messages[1].content, /^\*\*STRIKE\*\* · dsc:57:1/)
})

// Alice and Bob each with a suspension that ran out: both threads archived as Expired
async function twoArchived(d) {
  const r = await started({ discord: d })
  r.data.discipline = {
    57: [entry(1, 'suspend', T0 - HOUR, { until: T0 + HOUR })],
    58: [entry(1, 'suspend', T0 - HOUR, { until: T0 + HOUR })],
  }
  await r.tick()
  r.now += 2 * HOUR
  await r.tick()
  assert.ok([...d.threads.values()].every(t => t.archived))
  return r
}
const reopens = d => d.calls.filter(c => c.method === 'PATCH' && c.body && c.body.archived === false)

test('thread headroom: a new punishment reopens an archived thread only with room, and the reopen counts toward it', async () => {
  const d = fakeDiscord()
  const r = await twoArchived(d)
  d.active = 976
  r.now += 11 * 60000
  r.data.discipline[57].push(entry(2, 'strike', r.now - 60000))
  await r.tick()
  const alice = r.named('alice_rp')
  assert.equal(alice.archived, true, 'held above 975')
  assert.equal(reopens(d).length, 0)
  assert.equal(r.registry().accounts[PEOPLE.alice.discordId].rows['dsc:57:2'], undefined, 'the row is kept unposted')
  assert.deepEqual(r.audits, ['PUNISH-TRACKER waiting for thread headroom: reopened threads are held'])
  // At exactly 975 one reopen fits; it takes the slot, so the second one in the same 10 minutes waits
  d.active = 975
  r.now += 11 * 60000
  r.data.discipline[58].push(entry(2, 'strike', r.now - 60000))
  await r.tick()
  assert.equal(alice.archived, false)
  assert.match(alice.messages[3].content, /^\*\*STRIKE\*\* · dsc:57:2/)
  const bob = r.named('bob_rp')
  assert.equal(bob.archived, true, 'the reopen above counted toward headroom')
  assert.equal(r.registry().accounts[PEOPLE.bob.discordId].rows['dsc:58:2'], undefined)
  assert.equal(reopens(d).length, 1)
})

test('thread headroom: a thread Discord archived after 7 idle days is reopened only with room, and the reopen counts', async () => {
  const d = fakeDiscord()
  const r = await started({ discord: d })
  // Alice's suspension runs out (archived by the tracker); Bob's 30-day one stays in force, his thread open
  r.data.discipline = {
    57: [entry(1, 'suspend', T0 - HOUR, { until: T0 + HOUR })],
    58: [entry(1, 'suspend', T0 - HOUR, { until: T0 + 30 * DAY })],
  }
  await r.tick()
  r.now += 2 * HOUR
  await r.tick()
  const alice = r.named('alice_rp'), bob = r.named('bob_rp')
  assert.equal(alice.archived, true)
  assert.equal(bob.archived, false)
  assert.equal(r.registry().accounts[PEOPLE.bob.discordId].state, 'open')
  // A week with no message: Discord archives Bob's thread itself, the registry still says open
  r.now += 8 * DAY
  bob.archived = true
  d.active = 976
  r.data.discipline[57].push(entry(2, 'strike', r.now - 60000))
  r.data.discipline[58].push(entry(2, 'strike', r.now - 60000))
  await r.tick()
  assert.equal(bob.archived, true, 'held above 975')
  assert.equal(alice.archived, true, 'held above 975')
  assert.equal(reopens(d).length, 0)
  assert.equal(r.registry().accounts[PEOPLE.bob.discordId].rows['dsc:58:2'], undefined, 'the row is kept unposted')
  assert.equal(r.registry().accounts[PEOPLE.alice.discordId].rows['dsc:57:2'], undefined, 'the row is kept unposted')
  assert.deepEqual(r.audits, ['PUNISH-TRACKER waiting for thread headroom: reopened threads are held'])
  // At exactly 975 one reopen fits and takes the slot, so the other waits
  d.active = 975
  r.now += 11 * 60000
  await r.tick()
  assert.equal([alice, bob].filter(t => !t.archived).length, 1, 'one reopened, the other counted out')
  assert.equal(r.posts().filter(p => /^\*\*STRIKE\*\* · dsc:5[78]:2/.test(p)).length, 1)
  d.active = 0
  r.now += 11 * 60000
  await r.tick()
  assert.equal(r.posts().filter(p => /^\*\*STRIKE\*\* · dsc:5[78]:2/.test(p)).length, 2)
})

test('thread headroom: an idle thread Discord archived that answers 50083 is held above 975; a recent post keeps it open', async () => {
  const d = fakeDiscord()
  const r = await started({ discord: d })
  r.data.discipline = { 57: [entry(1, 'suspend', T0 - HOUR, { until: T0 + 30 * DAY })] }
  await r.tick()
  const t = d.thread()
  d.fail = (method, p) => (method === 'POST' && p === `/channels/${t.id}/messages` && t.archived ? fakeDiscord.error(400, 50083) : null)
  // Six days on, a post: the thread is not idle, nothing is checked or reopened first
  r.now += 6 * DAY
  r.data.discipline[57].push(entry(2, 'warn', r.now - 60000))
  const before = d.calls.length
  await r.tick()
  assert.equal(d.calls.slice(before).filter(c => c.path.endsWith('/threads/active')).length, 0)
  assert.equal(reopens(d).length, 0)
  // Six more days: the post above kept it active. Then eight idle days and Discord archives it
  r.now += 6 * DAY
  await r.tick()
  assert.equal(r.registry().accounts[PEOPLE.alice.discordId].activeAt, T0 + 6 * DAY)
  r.now += 8 * DAY
  t.archived = true
  d.active = 990
  r.data.discipline[57].push(entry(3, 'strike', r.now - 60000))
  await r.tick()
  assert.equal(t.archived, true)
  assert.equal(reopens(d).length, 0)
  assert.equal(r.registry().accounts[PEOPLE.alice.discordId].rows['dsc:57:3'], undefined, 'the row is kept unposted')
  assert.deepEqual(r.audits, ['PUNISH-TRACKER waiting for thread headroom: reopened threads are held'])
  d.active = 900
  r.now += 11 * 60000
  await r.tick()
  assert.equal(reopens(d).length, 1)
  assert.match(t.messages.at(-1).content, /^\*\*STRIKE\*\* · dsc:57:3/)
})

test('thread headroom: after a 160006 no thread is reopened until the next headroom check', async () => {
  const d = fakeDiscord()
  const r = await started({ discord: d })
  r.data.discipline = { 57: [entry(1, 'strike', T0)] }
  await r.tick()
  const t = d.thread()
  t.archived = true
  let full = true
  d.fail = (method, p, body) => {
    if (method === 'POST' && p === `/channels/${t.id}/messages` && t.archived) return fakeDiscord.error(400, 50083)
    if (method === 'PATCH' && p === `/channels/${t.id}` && body.archived === false && full) return fakeDiscord.error(400, 160006)
    return null
  }
  r.now += 60000
  r.data.discipline[57].push(entry(2, 'strike', r.now))
  await r.tick()
  assert.equal(reopens(d).length, 1)
  full = false
  r.now += 60000
  await r.tick()
  assert.equal(reopens(d).length, 1, 'refused at once while the count is unknown')
  assert.equal(r.registry().accounts[PEOPLE.alice.discordId].rows['dsc:57:2'], undefined, 'kept unposted')
  r.now += 10 * 60000
  await r.tick()
  assert.equal(reopens(d).length, 2)
  assert.match(t.messages[2].content, /^\*\*STRIKE\*\* · dsc:57:2/)
})

test('thread headroom: at the thread cap a tag change on archived threads sends nothing until there is room', async () => {
  const d = fakeDiscord()
  const r = await twoArchived(d)
  d.active = 1000
  d.fail = (method, p, body) => (method === 'PATCH' && body && body.archived === false && d.active > 975 ? fakeDiscord.error(400, 160006) : null)
  // Renamed forum tags put every thread up for a tag change
  d.tags = TAGS.map(t => ({ ...t, id: t.id.replace(/^9/, '8') }))
  const calls = d.calls.length
  r.now += 10 * 60000
  for (let i = 0; i < 3; i++) {
    r.now += 60000
    await r.tick()
  }
  assert.equal(reopens(d).length, 0, 'no unarchive is tried while the guild is full')
  assert.deepEqual(d.calls.slice(calls).map(c => `${c.method} ${c.path}`), [`GET /channels/${FORUM}`, `GET /guilds/${GUILD}/threads/active`], 'one tag read and one headroom check, no writes')
  assert.deepEqual(r.audits, ['PUNISH-TRACKER waiting for thread headroom: reopened threads are held'])
  const bob = r.named('bob_rp')
  assert.deepEqual(bob.tags, [tagId('Expired'), tagId('Suspended')], 'left as they were')
  assert.equal(r.registry().accounts[PEOPLE.bob.discordId].sync, true, 'kept for a later tick')
  d.active = 0
  r.now += 11 * 60000
  await r.tick()
  assert.deepEqual(bob.tags, ['800000000000000011', '800000000000000014'])
  assert.equal(bob.archived, true)
  assert.equal(r.registry().accounts[PEOPLE.bob.discordId].sync, false)
})

test('the REST writer waits out a 429 (the global one too), backs off a 5xx, and spaces requests 1.5 s', async () => {
  let clock = 0
  const slept = []
  const answers = [
    { status: 429, body: { retry_after: 2.5, global: true, message: 'rate limited' } },
    { status: 502, body: {} },
    { status: 200, body: { id: '42' } },
    { status: 400, body: { code: 50035, message: 'Invalid Form Body' } },
  ]
  const seen = []
  const fetch = async (url, init) => {
    seen.push({ url, init, at: clock })
    const a = answers.shift()
    return { status: a.status, headers: { get: () => null }, text: async () => JSON.stringify(a.body) }
  }
  const logs = []
  const w = createRestWriter({ token: 'test-token', fetch, now: () => clock, sleep: async ms => { slept.push(ms); clock += ms }, log: l => logs.push(l) })
  const got = await w.request('POST', '/channels/1/messages', { content: 'hi' })
  assert.deepEqual(got, { id: '42' })
  assert.equal(seen.length, 3)
  assert.ok(seen[1].at - seen[0].at >= 2500, 'waited retry_after')
  assert.ok(seen[2].at - seen[1].at >= 1000, 'backed off')
  assert.equal(seen[0].url, 'https://discord.com/api/v10/channels/1/messages')
  assert.equal(seen[0].init.headers.Authorization, 'Bot test-token')
  assert.equal(seen[0].init.body, '{"content":"hi"}')
  assert.equal(logs.length, 1)
  const err = await w.request('GET', '/x').catch(e => e)
  assert.equal(err.status, 400)
  assert.equal(err.code, 50035)
  assert.ok(seen[3].at - seen[2].at >= 1500, 'one request per 1.5 s')
})

test('dry mode writes the would-be posts to its file and never calls fetch or the Discord writer handed in', async () => {
  const dir = tempDir()
  const dryFile = path.join(dir, 'dry.jsonl')
  const fetch = () => { throw new Error('dry mode reached the network') }
  const discord = fakeDiscord()
  let now = T0
  const data = { discipline: { 57: [entry(1, 'suspend', T0 - HOUR, { until: T0 + HOUR })] } }
  const make = () => createTracker({
    snapshot: () => snap(data, now), now: () => now, fetch, discord, log: () => {},
    config: { punishTracker: 'dry-run', punishTrackerFile: path.join(dir, 'punish-threads.json'), punishTrackerDryFile: dryFile, discordGuildId: GUILD, discordBotToken: 'test-token' },
  })
  const t = make()
  assert.equal(t.mode, 'dry')
  assert.equal(await t.tick(), true)
  now += 2 * HOUR
  await t.tick()
  await make().tick()
  assert.deepEqual(discord.calls, [])
  const lines = fs.readFileSync(dryFile, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  assert.deepEqual(lines.map(l => l.action), ['create-thread', 'reply', 'reply', 'edit-starter', 'edit-thread'])
  assert.equal(lines[0].body.name, 'alice_rp')
  assert.equal(lines[0].title, 'local fallback, not looked up', 'dry reads answer empty, so the create line says its title is local')
  assert.match(lines[2].body.content, /^\*\*ENDED\*\*/)
  assert.deepEqual(lines[4].body, { archived: true })
  for (const l of lines.slice(1)) assert.deepEqual(Object.keys(l), ['at', 'action', 'method', 'path', 'body'])
  assert.ok(fs.existsSync(path.join(dir, 'punish-threads.dry.json')), 'its own registry')
  assert.ok(!fs.existsSync(path.join(dir, 'punish-threads.json')), 'the live registry is untouched')
})

test('a warning counts as active for warnDays, then ages out', async () => {
  const r = await started({ config: { punishTrackerWarnDays: 30 } })
  r.data.discipline = { 57: [entry(1, 'warn', T0)] }
  await r.tick()
  const t = r.discord.thread()
  assert.match(t.messages[1].content, /Duration: no expiry; shown as active for 30 days/)
  assert.match(t.messages[0].content, /Warnings in the last 30 days: 1/)
  r.now += 29 * DAY
  await r.tick()
  assert.equal(t.messages.length, 2)
  r.now += 2 * DAY
  await r.tick()
  assert.equal(t.messages[2].content, '**WARNING aged out** of the 30-day window · dsc:57:1')
  assert.equal(t.archived, true)
})

test('PUNISH_TRACKER_HIDE_STAFF leaves out staff targets, accounts Discord gave no answer on and unlinked profiles; off posts them', async () => {
  const status = { [PEOPLE.alice.discordId]: 'player', [PEOPLE.bob.discordId]: 'staff' }
  const discipline = () => ({ 57: [entry(1, 'strike', T0)], 58: [entry(1, 'strike', T0, { char: 'Borin #BOR1' })], 70: [entry(1, 'warn', T0, { char: 'Nell #NEL1' })] })
  const r = await started({ config: { punishTrackerHideStaffTargets: true }, staffStatusOf: async d => status[d] || 'unknown' })
  r.data.discipline = discipline()
  await r.tick()
  assert.deepEqual([...r.discord.threads.values()].map(t => t.name), ['alice_rp'])
  assert.equal(r.registry().accounts[PEOPLE.bob.discordId], undefined)
  assert.equal(r.registry().accounts['p:70'], undefined, 'a profile with no Discord link cannot be checked, as on the panel')
  const off = await started({ staffStatusOf: async () => { throw new Error('not asked') } })
  off.data.discipline = discipline()
  await off.tick()
  assert.equal(off.discord.threads.size, 3)
})

test('at most maxRequests a tick, the rest on later ticks with nothing posted twice; ticks never overlap', async () => {
  const r = await started({ maxRequests: 4 })
  r.data.discipline = {
    57: [entry(1, 'strike', T0)], 58: [entry(1, 'strike', T0, { char: 'Borin #BOR1' })], 70: [entry(1, 'warn', T0, { char: 'Nell #NEL1' })],
  }
  const counts = []
  for (let i = 0; i < 8; i++) {
    const before = r.discord.calls.length
    r.now += 30000
    await r.tick()
    counts.push(r.discord.calls.length - before)
  }
  assert.ok(counts.every(n => n <= 4), counts.join(','))
  assert.equal(r.discord.threads.size, 3)
  for (const t of r.discord.threads.values()) assert.equal(t.messages.length, 2, t.name)
  const [a, b] = await Promise.all([r.tick(), r.tick()])
  assert.deepEqual([a, b], [true, false])
})

// ---- review fixes ----

test('dry mode with hide-staff on never asks Discord: only cached staff answers, every other account left out', async () => {
  const dir = tempDir()
  const dryFile = path.join(dir, 'dry.jsonl')
  const asked = []
  const staffStatusOf = async d => { asked.push(d); throw new Error('dry mode asked Discord') }
  staffStatusOf.known = d => (d === PEOPLE.alice.discordId ? 'player' : null)
  const data = { discipline: { 57: [entry(1, 'strike', T0)], 58: [entry(1, 'strike', T0, { char: 'Borin #BOR1' })] } }
  const logs = []
  const t = createTracker({
    snapshot: () => snap(data, T0), now: () => T0, staffStatusOf, log: l => logs.push(l),
    config: { punishTracker: 'dry', punishTrackerHideStaffTargets: true, punishTrackerFile: path.join(dir, 'punish-threads.json'), punishTrackerDryFile: dryFile, discordGuildId: GUILD },
  })
  assert.equal(await t.tick(), true)
  assert.deepEqual(asked, [])
  const lines = fs.readFileSync(dryFile, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  assert.deepEqual(lines.filter(l => l.action === 'create-thread').map(l => l.body.name), ['alice_rp'])
  assert.equal(logs.filter(l => /cached answers only/.test(l)).length, 1)
})

test('start(): on without a token or guild refuses; a dry start ticks on the panel\'s snapshot, never asks Discord, and stop() clears both timers', async t => {
  const lines = []
  assert.equal(start({ config: { punishTracker: 'on' }, punishments: () => { throw new Error('read') }, log: l => lines.push(l) }), null)
  assert.match(lines[0], /needs DISCORD_BOT_TOKEN and DISCORD_GUILD_ID; not started/)
  const dir = tempDir()
  const asked = [], audits = []
  let snaps = 0
  const staffStatusOf = async d => { asked.push(d); return 'player' }
  staffStatusOf.known = () => 'player'
  const make = () => start({
    config: { punishTracker: 'dry', punishTrackerHideStaffTargets: true, punishTrackerFile: path.join(dir, 'punish-threads.json'), punishTrackerDryFile: path.join(dir, 'dry.jsonl') },
    punishments: () => ({ trackerSnapshot: () => { snaps++; return snap({ discipline: { 57: [entry(1, 'strike', T0)] } }, T0) } }),
    staffStatusOf, audit: l => audits.push(l), log: l => lines.push(l),
  })
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  // Stopped before its first tick (5 s): it never ticks
  make().stop()
  t.mock.timers.tick(60000)
  assert.equal(snaps, 0)
  const tracker = make()
  assert.equal(tracker.mode, 'dry')
  t.mock.timers.reset()
  assert.equal(await tracker.tick(), true)
  tracker.stop()
  assert.equal(snaps, 1)
  assert.deepEqual(asked, [])
  assert.deepEqual(audits, [])
  assert.ok(fs.existsSync(path.join(dir, 'punish-threads.dry.json')))
  assert.ok(!fs.existsSync(path.join(dir, 'punish-threads.json')))
  assert.match(fs.readFileSync(path.join(dir, 'dry.jsonl'), 'utf8'), /"create-thread"/)
})

test('journal rows name their source: the dashboard (with "(dashboard)" after the handle) or the Discord client', async () => {
  const r = await started()
  r.data.journal = [
    { v: 1, id: 'M-DASH0001', kind: 'discord_timeout', at: iso(T0), until: iso(T0 + HOUR), discordId: PEOPLE.bob.discordId, reason: 'spam', by: { discordName: 'lena' }, via: 'dashboard' },
    { v: 1, id: 'M-DISC0001', kind: 'discord_timeout', at: iso(T0), until: iso(T0 + HOUR), discordId: PEOPLE.alice.discordId, reason: 'spam', by: { name: 'Lena' }, via: 'discord' },
  ]
  await r.tick()
  const bob = r.named('bob_rp').messages[1].content
  assert.match(bob, /Issued by: lena \(dashboard\)\n/)
  assert.match(bob, /Source: dashboard$/)
  const alice = r.named('alice_rp').messages[1].content
  assert.match(alice, /Issued by: Lena\n/)
  assert.match(alice, /Source: Discord client$/)
})

test('a source missing on the first run is not posted from history once it reads: only what is in force opens a thread', async () => {
  const r = rig()
  r.status = { discipline: { status: 'missing' } }
  await r.tick()
  assert.ok(r.registry().baselinedAt)
  r.status = {}
  r.data.discipline = { 57: [entry(1, 'warn', T0 - 200 * DAY), entry(2, 'strike', T0 - 120 * DAY)], 58: [entry(1, 'suspend', T0 - HOUR, { char: 'Borin #BOR1', until: T0 + DAY })] }
  r.now += 60000
  await r.tick()
  assert.deepEqual([...r.discord.threads.values()].map(t => t.name), ['bob_rp'])
  assert.equal(r.named('bob_rp').messages.length, 2)
  assert.equal(r.registry().accounts[PEOPLE.alice.discordId].rows['dsc:57:1'].baseline, true)
})

test('hide-staff: an account hidden on the first run (no answer from Discord) is not posted from history once it shows', async () => {
  let status = 'unknown'
  const r = rig({ config: { punishTrackerHideStaffTargets: true }, staffStatusOf: async () => status,
    data: { discipline: { 57: [entry(1, 'warn', T0 - 300 * DAY), entry(2, 'strike', T0 - 200 * DAY)] } } })
  await r.tick()
  status = 'player'
  r.now += 60000
  await r.tick()
  assert.equal(r.discord.threads.size, 0)
  r.data.discipline[57].push(entry(3, 'strike', r.now))
  await r.tick()
  assert.deepEqual(r.posts().map(c => c.split('\n')[0]), ['**STRIKE** · dsc:57:3'])
})

test('a lost thread-create answer, a timeout or a 5xx, is never sent again by the writer; a 429 still is', async () => {
  let clock = 0
  const seen = []
  const writer = answers => createRestWriter({
    token: 'test-token', now: () => clock, sleep: async ms => { clock += ms },
    fetch: async (url, init) => {
      seen.push(init.method)
      const a = answers.shift()
      if (a === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
      return { status: a.status, headers: { get: () => null }, text: async () => JSON.stringify(a.body || {}) }
    },
  })
  const lost = await writer(['timeout', { status: 201, body: { id: '2' } }]).request('POST', `/channels/${FORUM}/threads`, {}, { once: true }).catch(e => e)
  assert.match(lost.message, /timeout/)
  assert.equal(seen.length, 1)
  seen.length = 0
  const bad = await writer([{ status: 502 }, { status: 201, body: { id: '2' } }]).request('POST', `/channels/${FORUM}/threads`, {}, { once: true }).catch(e => e)
  assert.equal(bad.status, 502)
  assert.equal(seen.length, 1)
  seen.length = 0
  const ok = await writer([{ status: 429, body: { retry_after: 1 } }, { status: 201, body: { id: '3' } }]).request('POST', `/channels/${FORUM}/threads`, {}, { once: true })
  assert.deepEqual([ok, seen.length], [{ id: '3' }, 2])
  // The tracker sends its thread POST this way; replies keep their retries (they carry a nonce)
  const d = fakeDiscord()
  const once = []
  const real = d.request
  d.request = (method, p, body, opts) => { if (opts && opts.once) once.push(`${method} ${p}`); return real(method, p, body) }
  const r = await started({ discord: d })
  r.data.discipline = { 57: [entry(1, 'strike', T0)] }
  await r.tick()
  assert.deepEqual(once, [`POST /channels/${FORUM}/threads`])
})

test('a profile linked to a Discord account that has its own thread: its records move there, nothing is posted twice, its thread is closed', async () => {
  const d = fakeDiscord()
  const r = await started({ discord: d })
  const X = '844444444444444444'
  d.members[X] = 'nell_rp'
  r.data.discipline = { 70: [entry(1, 'strike', T0, { char: 'Nell #NEL1' })] }
  await r.tick()
  r.now += 60000
  r.data.journal = [{ v: 1, id: 'M-NELL0001', kind: 'discord_timeout', at: iso(r.now), until: iso(r.now + DAY), discordId: X, reason: 'spam', by: { name: 'Lena' } }]
  await r.tick()
  assert.equal(d.threads.size, 2)
  r.links[70] = X
  r.now += 60000
  await r.tick()
  await r.tick()
  assert.equal(r.posts().filter(c => c.startsWith('**STRIKE** · dsc:70:1')).length, 1)
  const reg = r.registry()
  assert.equal(reg.accounts['p:70'], undefined)
  assert.ok(reg.accounts[X].rows['dsc:70:1'])
  const old = r.named('profile 70')
  assert.equal(old.archived, true)
  assert.match(old.messages[0].content, /^Moved: profile 70 is now linked to <@844444444444444444>/)
  assert.equal(markerOf(old.messages[0].content), null, 'never adopted again by the marker scan')
  assert.match(r.named('nell_rp').messages[0].content, /Strikes counting: 1 of 3/)
})

test('profiles.json unreadable: nothing is posted; a record whose key changes back to its profile is never posted again', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'strike', T0)] }
  await r.tick()
  const writes = r.discord.writes().length
  // identity.js leaves the maps empty when it cannot read profiles.json
  r.links[57] = null
  r.idStatus = { profiles: 'unreadable', players: 'ok', store: 'ok' }
  r.now += 60000
  await r.tick()
  assert.equal(r.discord.writes().length, writes)
  assert.ok(r.logs.some(l => /nothing is posted while profiles cannot be read/.test(l)))
  // players.json backfilled only some links: the record keys to p:57, which must not post it again
  r.idStatus = undefined
  r.now += 60000
  await r.tick()
  assert.equal(r.discord.threads.size, 1)
  assert.equal(r.discord.writes().length, writes)
  assert.equal(r.registry().accounts['p:57'], undefined)
  delete r.links[57]
  r.now += 60000
  await r.tick()
  assert.equal(r.discord.threads.size, 1)
  assert.equal(r.posts().filter(c => c.startsWith('**STRIKE** · dsc:57:1')).length, 1)
})

test('an overturned lift is posted as OVERTURNED in the thread', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'suspend', T0, { until: T0 + DAY })] }
  await r.tick()
  r.now += 60000
  r.data.discipline[57][0].lifted = true
  r.data.discipline[57].push(entry(2, 'lift', r.now, { by: 'Mia #MIA1', reason: 'served enough', lifts: 1, liftsKind: 'suspend' }))
  await r.tick()
  r.now += 60000
  r.data.discipline[57][1].overturned = { by: 'Jake #JAKE', at: iso(r.now), reason: 'the lift was wrong' }
  r.data.discipline[57].push(entry(3, 'overturn', r.now, { by: 'Jake #JAKE', reason: 'the lift was wrong', undid: 2 }))
  await r.tick()
  const msgs = r.messages()
  assert.equal(msgs.length, 4)
  assert.equal(msgs[3].content, '**OVERTURNED** · lift dsc:57:2 of suspension dsc:57:1 — by Jake #JAKE: the lift was wrong')
  await r.tick()
  assert.equal(r.messages().length, 4)
})

test('a thread Discord auto-archived at the guild\'s thread cap (160006) holds the post, never drops it', async () => {
  const d = fakeDiscord()
  const r = await started({ discord: d })
  r.data.discipline = { 57: [entry(1, 'strike', T0)] }
  await r.tick()
  const t = d.thread()
  t.archived = true
  let full = true
  d.fail = (method, p, body) => {
    if (method === 'POST' && p === `/channels/${t.id}/messages` && t.archived) return fakeDiscord.error(400, 50083)
    if (method === 'PATCH' && p === `/channels/${t.id}` && body.archived === false && full) return fakeDiscord.error(400, 160006)
    return null
  }
  r.now += 60000
  r.data.discipline[57].push(entry(2, 'strike', r.now))
  await r.tick()
  assert.equal(r.registry().accounts[PEOPLE.alice.discordId].rows['dsc:57:2'], undefined, 'kept unposted, not dropped')
  assert.deepEqual(r.audits, ['PUNISH-TRACKER waiting for thread headroom: Discord refused to open a thread (160006)'])
  full = false
  r.now += 11 * 60000
  await r.tick()
  assert.match(t.messages[2].content, /^\*\*STRIKE\*\* · dsc:57:2/)
  assert.equal(r.registry().accounts[PEOPLE.alice.discordId].rows['dsc:57:2'].dropped, undefined)
})

test('a starter deleted by staff (10008) is tried once, and the thread still gets its replies, tags and archive', async () => {
  const d = fakeDiscord()
  const r = await started({ discord: d })
  r.data.discipline = { 57: [entry(1, 'suspend', T0, { until: T0 + HOUR })] }
  await r.tick()
  const t = d.thread()
  const starter = `/channels/${t.id}/messages/${t.id}`
  d.fail = (method, p) => (method === 'PATCH' && p === starter ? fakeDiscord.error(404, 10008) : null)
  r.now += 2 * HOUR
  for (let i = 0; i < 4; i++) { await r.tick(); r.now += 60000 }
  assert.equal(d.calls.filter(c => c.method === 'PATCH' && c.path === starter).length, 1)
  assert.match(t.messages[2].content, /^\*\*ENDED\*\*/)
  assert.equal(t.archived, true)
  assert.deepEqual(t.tags, [tagId('Expired'), tagId('Suspended')])
  assert.equal(r.logs.filter(l => /starter .* was deleted/.test(l)).length, 1)
})

test('a tag change Discord answers with 160006 or 50083 is not taken as a refusal: the tags are tried again', async () => {
  for (const code of [160006, 50083]) {
    const d = fakeDiscord()
    const r = await started({ discord: d })
    r.data.discipline = { 57: [entry(1, 'strike', T0)] }
    await r.tick()
    const t = d.thread()
    assert.deepEqual(t.tags, [tagId('Active'), tagId('Strike')])
    let busy = true
    d.fail = (method, p, body) => (busy && method === 'PATCH' && p === `/channels/${t.id}` && body.applied_tags ? fakeDiscord.error(400, code) : null)
    r.now += 60000
    r.data.discipline[57].push(entry(2, 'warn', r.now))
    await r.tick()
    assert.deepEqual(t.tags, [tagId('Active'), tagId('Strike')], `${code}: not applied yet`)
    assert.deepEqual(r.registry().accounts[PEOPLE.alice.discordId].tags, [tagId('Active'), tagId('Strike')], `${code}: not recorded as applied`)
    assert.ok(!r.logs.some(l => /refused the tags/.test(l)), `${code}: not logged as a refusal`)
    busy = false
    r.now += 11 * 60000
    await r.tick()
    assert.deepEqual(t.tags, [tagId('Active'), tagId('Strike'), tagId('Warning')], `${code}: applied on a later tick`)
    assert.equal(t.messages.length, 3, `${code}: the warning posted once`)
  }
})

test('tags made on the forum later reach every thread, an archived clear one too, which stays archived', async () => {
  const d = fakeDiscord({ tags: [] })
  const r = await started({ discord: d })
  r.data.discipline = { 57: [entry(1, 'strike', T0)], 58: [entry(1, 'suspend', T0, { char: 'Borin #BOR1', until: T0 + HOUR })] }
  await r.tick()
  r.now += 2 * HOUR
  await r.tick()
  const bob = r.named('bob_rp'), alice = r.named('alice_rp')
  assert.equal(bob.archived, true)
  assert.deepEqual([alice.tags, bob.tags], [[], []])
  d.tags = TAGS
  r.now += 11 * 60000
  await r.tick()
  assert.deepEqual(alice.tags, [tagId('Active'), tagId('Strike')])
  assert.deepEqual(bob.tags, [tagId('Expired'), tagId('Suspended')])
  assert.equal(bob.archived, true)
  assert.equal(r.registry().accounts[PEOPLE.bob.discordId].state, 'archived')
  const writes = d.writes().length
  await r.tick()
  assert.equal(d.writes().length, writes, 'done once')
})

test('display name and server nickname both go in the starter, each when it differs from the username', async () => {
  const d = fakeDiscord()
  d.members[PEOPLE.alice.discordId] = { username: 'alice_rp', global_name: 'Alice A', nick: 'Ali (GM bait)' }
  const r = await started({ discord: d })
  r.data.discipline = { 57: [entry(1, 'warn', T0)] }
  await r.tick()
  assert.match(d.thread().messages[0].content, /^<@811111111111111111> · alice_rp\nDisplay name: Alice A\nServer nickname: Ali \(GM bait\)\n/)
})

// ---- regression cover for the design's transitions and recovery paths ----

test('a Discord ban seen in both the journal and the ban list is posted once, and its unban once (both orders)', async () => {
  const ban = at => ({ ref: 'B-CCCCCC', discordId: PEOPLE.bob.discordId, reason: 'discord ban', bannedAt: iso(at), bannedBy: 'discord' })
  const jban = at => ({ v: 1, id: 'M-BAN00001', kind: 'discord_ban', at: iso(at), discordId: PEOPLE.bob.discordId, reason: 'threats', by: { name: 'Lena' }, via: 'discord' })
  const unban = at => ({ v: 1, id: 'M-UNB00001', kind: 'discord_unban', at: iso(at), discordId: PEOPLE.bob.discordId, reason: 'appeal', by: { name: 'Jake' }, via: 'discord' })
  for (const journalFirst of [true, false]) {
    const r = await started()
    r.data.journal = [jban(T0)]
    if (!journalFirst) r.data.bans = [ban(T0 + 5000)]
    await r.tick()
    r.now += 60000
    r.data.bans = [ban(T0 + 5000)]
    await r.tick()
    r.now += HOUR
    r.data.bans = []
    r.data.journal.push(unban(r.now))
    await r.tick()
    await r.tick()
    const posts = r.posts()
    assert.equal(posts.filter(c => /^\*\*(DISCORD BAN|GAME BAN LIST)/.test(c)).length, 1, `journal first: ${journalFirst}`)
    assert.equal(posts.filter(c => c.startsWith('**UNBANNED**')).length, 1, posts.join('\n'))
    assert.match(posts.find(c => c.startsWith('**UNBANNED**')), /by Jake: appeal$/)
    assert.equal(r.named('bob_rp').archived, true)
  }
})

test('a Discord ban, unban, re-ban and unban within 10 minutes posts each ban and each unban once', async () => {
  const ban = (ref, at) => ({ ref, discordId: PEOPLE.bob.discordId, reason: 'discord ban', bannedAt: iso(at), bannedBy: 'discord' })
  const jrow = (id, kind, at, reason, name) => ({ v: 1, id, kind, at: iso(at), discordId: PEOPLE.bob.discordId, reason, by: { name }, via: 'discord' })
  const r = await started()
  const step = async f => { r.now += 2 * 60000; f(); await r.tick(); await r.tick() }
  await step(() => { r.data.journal = [jrow('M-BAN00011', 'discord_ban', r.now, 'threats', 'Lena')]; r.data.bans = [ban('B-EEEEE1', r.now + 2000)] })
  await step(() => { r.data.bans = []; r.data.journal.push(jrow('M-UNB00011', 'discord_unban', r.now, 'wrong reason', 'Lena')) })
  await step(() => { r.data.journal.push(jrow('M-BAN00012', 'discord_ban', r.now, 'threats in #general', 'Lena')); r.data.bans = [ban('B-EEEEE2', r.now + 2000)] })
  await step(() => { r.data.bans = []; r.data.journal.push(jrow('M-UNB00012', 'discord_unban', r.now, 'appeal', 'Jake')) })
  const posts = r.posts()
  const bans = posts.filter(c => /^\*\*(DISCORD BAN|GAME BAN LIST)/.test(c))
  assert.equal(bans.length, 2, posts.join('\n'))
  assert.match(bans[0], /Reason: threats\n/)
  assert.match(bans[1], /Reason: threats in #general\n/)
  const unbans = posts.filter(c => c.startsWith('**UNBANNED**'))
  assert.equal(unbans.length, 2, posts.join('\n'))
  assert.match(unbans[0], /by Lena: wrong reason$/)
  assert.match(unbans[1], /by Jake: appeal$/)
})

test('a Discord re-ban whose ban-list entry is read a tick before its journal row is posted with the new moderator and reason', async () => {
  const ban = (ref, at) => ({ ref, discordId: PEOPLE.bob.discordId, reason: 'discord ban', bannedAt: iso(at), bannedBy: 'discord' })
  const jrow = (id, kind, at, reason, name) => ({ v: 1, id, kind, at: iso(at), discordId: PEOPLE.bob.discordId, reason, by: { name }, via: 'discord' })
  const r = await started()
  const step = async f => { r.now += 2 * 60000; f(); await r.tick(); await r.tick() }
  await step(() => { r.data.journal = [jrow('M-BAN00011', 'discord_ban', r.now, 'threats', 'Lena')]; r.data.bans = [ban('B-EEEEE1', r.now + 2000)] })
  await step(() => { r.data.bans = []; r.data.journal.push(jrow('M-UNB00011', 'discord_unban', r.now, 'wrong reason', 'Lena')) })
  r.now += 2 * 60000
  const reAt = r.now
  r.data.bans = [ban('B-EEEEE2', reAt)]
  await r.tick()
  r.now += 5000
  r.data.journal.push(jrow('M-BAN00012', 'discord_ban', reAt + 3000, 'threats in #general', 'Jake'))
  await r.tick()
  await r.tick()
  const bans = banPosts(r)
  assert.equal(bans.length, 2, bans.join('\n---\n'))
  assert.match(bans[1], /Issued by: Jake\n[^]*Reason: threats in #general\n/, bans[1])
})

test('a Discord unban, re-ban and unban between two passes posts the re-ban, which no longer aliases the first ban', async () => {
  const ban = (ref, at) => ({ ref, discordId: PEOPLE.bob.discordId, reason: 'discord ban', bannedAt: iso(at), bannedBy: 'discord' })
  const jrow = (id, kind, at, reason, name) => ({ v: 1, id, kind, at: iso(at), discordId: PEOPLE.bob.discordId, reason, by: { name }, via: 'discord' })
  const r = await started()
  r.now += 2 * 60000
  r.data.journal = [jrow('M-BAN00011', 'discord_ban', r.now, 'threats', 'Lena')]
  r.data.bans = [ban('B-EEEEE1', r.now + 2000)]
  await r.tick()
  await r.tick()
  r.now += 2 * 60000
  const t = r.now
  r.data.bans = []
  r.data.journal.push(jrow('M-UNB00011', 'discord_unban', t - 25000, 'wrong reason', 'Lena'))
  r.data.journal.push(jrow('M-BAN00012', 'discord_ban', t - 20000, 'threats in #general', 'Lena'))
  r.data.journal.push(jrow('M-UNB00012', 'discord_unban', t - 5000, 'mistake', 'Jake'))
  await r.tick()
  await r.tick()
  const posts = r.posts()
  const bans = banPosts(r)
  assert.equal(bans.length, 2, posts.join('\n---\n'))
  // The re-ban is first seen already unbanned: its post says so, the first ban's unban is its own reply
  assert.match(bans[1], /^\*\*DISCORD BAN\*\* · mod:M-BAN00012\n[^]*Reason: threats in #general\n[^]*Now: unbanned$/)
  const unbans = posts.filter(c => c.startsWith('**UNBANNED**'))
  assert.deepEqual(unbans, ['**UNBANNED** · game ban list entry ban:B-EEEEE1 — by Lena: wrong reason'])
  const rows = r.registry().accounts[PEOPLE.bob.discordId].rows
  assert.deepEqual(Object.keys(rows).filter(id => rows[id].alias).map(id => [id, rows[id].alias]), [['mod:M-BAN00011', 'ban:B-EEEEE1']])
})

test('a late journal Discord ban near two posted ban-list bans is the same ban as the nearer one', async () => {
  const ban = (ref, at) => ({ ref, discordId: PEOPLE.bob.discordId, reason: 'discord ban', bannedAt: iso(at), bannedBy: 'discord' })
  const r = await started()
  r.status.journal = { status: 'stale' }
  const at1 = r.now += 60000
  r.data.bans = [ban('B-EEEEE1', at1)]
  r.now += 61000
  await r.tick()
  r.now += 60000
  r.data.bans = []
  await r.tick()
  const at2 = r.now += 60000
  r.data.bans = [ban('B-EEEEE2', at2)]
  r.now += 61000
  await r.tick()
  r.data.bans = []
  delete r.status.journal
  r.data.journal = [{ v: 1, id: 'M-BAN00021', kind: 'discord_ban', at: iso(at2 + 2000), discordId: PEOPLE.bob.discordId, reason: 'threats', by: { name: 'Lena' }, via: 'discord' }]
  r.now += 30000
  await r.tick()
  const rows = r.registry().accounts[PEOPLE.bob.discordId].rows
  assert.equal(rows['mod:M-BAN00021'].alias, 'ban:B-EEEEE2', JSON.stringify(rows))
  assert.equal(banPosts(r).length, 2, r.posts().join('\n---\n'))
})

// bans.js add() replaces an entry for the same Discord id and keeps its ref; the bot's keepOther guard keeps a game ban
const banOf = (at, f7) => ({ ref: 'B-DDDDDD', discordId: PEOPLE.bob.discordId, reason: f7 ? 'duping' : 'discord ban', bannedAt: iso(at), bannedBy: f7 ? 'lena (dashboard)' : 'discord' })
const jbanOf = at => ({ v: 1, id: 'M-BAN00002', kind: 'discord_ban', at: iso(at), discordId: PEOPLE.bob.discordId, reason: 'threats', by: { name: 'Lena' }, via: 'discord' })
const banPosts = r => r.posts().filter(c => /^\*\*(DISCORD BAN|GAME BAN LIST)/.test(c))

test('an F7 ban replacing a Discord copy under the same ref is posted once, and the Discord ban\'s unban still posts', async () => {
  const r = await started()
  r.data.journal = [jbanOf(T0)]
  r.data.bans = [banOf(T0 + 5000, false)]
  await r.tick()
  assert.equal(banPosts(r).length, 1)
  r.now += 2 * HOUR
  r.data.bans = [banOf(r.now, true)]
  await r.tick()
  await r.tick()
  const bans = banPosts(r)
  assert.equal(bans.length, 2, bans.join('\n'))
  assert.match(bans[1], /^\*\*GAME BAN LIST\*\* · ban:B-DDDDDD\n[^]*Issued by: lena \(dashboard\)\n[^]*Reason: duping/)
  assert.equal(r.registry().accounts[PEOPLE.bob.discordId].rows['ban:B-DDDDDD'].kind, 'ban')
  r.now += HOUR
  r.data.journal.push({ v: 1, id: 'M-UNB00002', kind: 'discord_unban', at: iso(r.now), discordId: PEOPLE.bob.discordId, reason: 'appeal', by: { name: 'Jake' }, via: 'discord' })
  await r.tick()
  await r.tick()
  assert.deepEqual(r.posts().filter(c => c.startsWith('**UNBANNED**')), ['**UNBANNED** · Discord ban mod:M-BAN00002 — by Jake: appeal'])
  assert.equal(banPosts(r).length, 2)
})

test('a Discord ban replacing an F7 ban (guard off) is posted once with the journal\'s moderator', async () => {
  const r = await started()
  r.data.bans = [banOf(T0, true)]
  await r.tick()
  r.now += 2 * HOUR
  r.data.bans = [banOf(r.now + 2000, false)]
  r.data.journal = [jbanOf(r.now)]
  await r.tick()
  await r.tick()
  const bans = banPosts(r)
  assert.equal(bans.length, 2, bans.join('\n'))
  assert.match(bans[1], /^\*\*GAME BAN LIST \(Discord ban\)\*\* · ban:B-DDDDDD\n[^]*Issued by: Lena\n[^]*Reason: threats/)
})

test('a Discord ban on the ban list waits for its journal row and is posted once with the journal\'s moderator', async () => {
  const r = await started()
  r.data.bans = [banOf(r.now, false)]
  await r.tick()
  assert.equal(banPosts(r).length, 0)
  r.now += 20000
  r.data.journal = [jbanOf(r.now - 15000)]
  await r.tick()
  await r.tick()
  const bans = banPosts(r)
  assert.equal(bans.length, 1, bans.join('\n'))
  assert.match(bans[0], /^\*\*GAME BAN LIST \(Discord ban\)\*\* · ban:B-DDDDDD\n[^]*Issued by: Lena\n[^]*Reason: threats/)
})

test('a Discord ban with no journal row is posted after 60 s, or once the journal is read past it', async () => {
  const r = await started()
  r.data.bans = [banOf(r.now, false)]
  await r.tick()
  r.now += 30000
  await r.tick()
  assert.equal(banPosts(r).length, 0)
  r.now += 30000
  await r.tick()
  assert.equal(banPosts(r).length, 1)
  assert.match(banPosts(r)[0], /Issued by: Discord\n/)
  const later = await started()
  later.data.bans = [banOf(later.now, false)]
  later.data.journal = [{ v: 1, id: 'M-TMO00001', kind: 'discord_timeout', at: iso(later.now + 15000), discordId: PEOPLE.alice.discordId, reason: 'spam', by: { name: 'Lena' }, via: 'discord', until: iso(later.now + HOUR) }]
  later.now += 15000
  await later.tick()
  assert.equal(banPosts(later).length, 1)
})

test('a Discord ban over an F7 ban the guard kept (control) is posted once as a Discord ban', async () => {
  const r = await started()
  r.data.bans = [banOf(T0, true)]
  await r.tick()
  r.now += 2 * HOUR
  r.data.journal = [jbanOf(r.now)]
  await r.tick()
  await r.tick()
  const bans = banPosts(r)
  assert.equal(bans.length, 2, bans.join('\n'))
  assert.match(bans[0], /^\*\*GAME BAN LIST\*\* · ban:B-DDDDDD/)
  assert.match(bans[1], /^\*\*DISCORD BAN\*\* · mod:M-BAN00002\n[^]*Issued by: Lena/)
})

test('a strike stops counting (EXPIRED), an overturned strike posts OVERTURNED', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'strike', T0), entry(2, 'strike', T0)] }
  await r.tick()
  r.now += 60000
  r.data.discipline[57][1].overturned = { by: 'Jake #JAKE', at: iso(r.now), reason: 'wrong player' }
  await r.tick()
  r.now += 91 * DAY
  await r.tick()
  const posts = r.posts()
  assert.ok(posts.includes('**OVERTURNED** · strike dsc:57:2 — by Jake #JAKE: wrong player'))
  assert.match(posts[posts.length - 1], /^\*\*EXPIRED\*\* · strike dsc:57:1 stopped counting <t:\d+:D>$/)
})

test('an overturn of an offline player (saved before its undid) posts OVERTURNED once, never an unmatched post', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'strike', T0), entry(2, 'strike', T0)] }
  await r.tick()
  r.now += 60000
  r.data.discipline[57][1].overturned = { by: 'Jake #JAKE', at: iso(r.now), reason: 'wrong player' }
  r.data.discipline[57].push(entry(3, 'overturn', r.now + 5, { by: 'Jake #JAKE', reason: 'wrong player' }))
  await r.tick()
  // The undid lands at the player's next login
  r.now += 60000
  r.data.discipline[57][2].undid = 2
  await r.tick()
  const posts = r.posts()
  assert.ok(!posts.some(c => /unmatched/.test(c)), posts.join('\n'))
  assert.equal(posts.filter(c => c === '**OVERTURNED** · strike dsc:57:2 — by Jake #JAKE: wrong player').length, 1)
  assert.equal(r.discord.threads.size, 1)
})

test('an overturned lift of an offline player (no undid yet) is posted as OVERTURNED in the thread', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'suspend', T0, { until: T0 + DAY })] }
  await r.tick()
  r.now += 60000
  r.data.discipline[57][0].lifted = true
  r.data.discipline[57].push(entry(2, 'lift', r.now, { by: 'Mia #MIA1', reason: 'served enough', lifts: 1, liftsKind: 'suspend' }))
  await r.tick()
  r.now += 60000
  r.data.discipline[57][1].overturned = { by: 'Jake #JAKE', at: iso(r.now), reason: 'the lift was wrong' }
  r.data.discipline[57].push(entry(3, 'overturn', r.now, { by: 'Jake #JAKE', reason: 'the lift was wrong' }))
  await r.tick()
  const msgs = r.messages()
  assert.equal(msgs.length, 4)
  assert.equal(msgs[3].content, '**OVERTURNED** · lift dsc:57:2 of suspension dsc:57:1 — by Jake #JAKE: the lift was wrong')
})

test('a Discord timeout ended early names who ended it; one replaced by a newer timeout says so', async () => {
  const r = await started()
  const to = (id, at, extra = {}) => ({ v: 1, id, kind: 'discord_timeout', at: iso(at), until: iso(at + HOUR), discordId: PEOPLE.bob.discordId, reason: 'spam', by: { name: 'Lena' }, ...extra })
  r.data.journal = [to('M-TIME0001', T0)]
  await r.tick()
  r.now += 10 * 60000
  r.data.journal.push({ v: 1, id: 'M-TEND0001', kind: 'discord_timeout_end', at: iso(r.now), discordId: PEOPLE.bob.discordId, by: { name: 'Mia' } })
  await r.tick()
  r.now += 10 * 60000
  r.data.journal.push(to('M-TIME0002', r.now))
  await r.tick()
  r.now += 10 * 60000
  r.data.journal.push(to('M-TIME0003', r.now))
  await r.tick()
  const posts = r.posts()
  assert.ok(posts.includes('**TIMEOUT ENDED** · mod:M-TIME0001 (early by Mia)'))
  assert.ok(posts.includes('**TIMEOUT ENDED** · mod:M-TIME0002 (replaced by a newer timeout)'))
  assert.equal(posts.filter(c => c.startsWith('**DISCORD TIMEOUT**')).length, 3)
})

test('a thread deleted by staff (10003) is opened again with the history in its starter', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'strike', T0)] }
  await r.tick()
  r.discord.threads.clear()
  r.now += 60000
  r.data.discipline[57].push(entry(2, 'strike', r.now))
  await r.tick()
  await r.tick()
  assert.equal(r.discord.threads.size, 1)
  const t = r.discord.thread()
  assert.match(t.messages[0].content, /History: 0 warnings, 2 strikes/)
  assert.deepEqual(t.messages.slice(1).map(m => m.content.split('\n')[0]), ['**STRIKE** · dsc:57:2'])
})

test('a reply into a thread Discord archived on its own (50083) unarchives it and lands', async () => {
  const d = fakeDiscord()
  const r = await started({ discord: d })
  r.data.discipline = { 57: [entry(1, 'strike', T0)] }
  await r.tick()
  const t = d.thread()
  t.archived = true
  d.fail = (method, p) => (method === 'POST' && p === `/channels/${t.id}/messages` && t.archived ? fakeDiscord.error(400, 50083) : null)
  r.now += 60000
  r.data.discipline[57].push(entry(2, 'strike', r.now))
  await r.tick()
  assert.match(t.messages[2].content, /^\*\*STRIKE\*\* · dsc:57:2/)
  assert.ok(t.patches.some(p => p.archived === false))
})

test('the username is looked up again after 24 h and the thread renamed only when it changed', async () => {
  const d = fakeDiscord()
  const r = await started({ discord: d })
  r.data.discipline = { 57: [entry(1, 'strike', T0)] }
  await r.tick()
  const t = d.thread()
  r.now += 2 * HOUR
  d.members[PEOPLE.alice.discordId] = 'alice_new'
  await r.tick()
  assert.equal(t.name, 'alice_rp')
  r.now += 25 * HOUR
  await r.tick()
  assert.equal(t.name, 'alice_new')
  assert.match(t.messages[0].content, /^<@811111111111111111> · alice_new\n/)
  const renames = t.patches.filter(p => p.name).length
  r.now += 25 * HOUR
  await r.tick()
  assert.equal(t.patches.filter(p => p.name).length, renames)
})

test('a target known only by Discord is titled by the journal\'s name when the lookup fails, and looked up again after 10 min, not 24 h', async () => {
  const d = fakeDiscord()
  const r = await started({ discord: d })
  const ghost = '844444444444444444'
  r.data.bans = [{ discordId: ghost, ref: 'B-GHOST1', reason: 'discord ban', bannedBy: 'discord', bannedAt: iso(T0) }]
  r.data.journal = [{ v: 1, id: 'M-GGGGGG', at: iso(T0 + 5000), kind: 'discord_ban', discordId: ghost, discordName: 'ghosty', reason: 'threats', by: { discordName: 'Lena' }, via: 'discord' }]
  await r.tick()
  const t = d.thread()
  assert.equal(t.name, 'ghosty')
  assert.equal(r.registry().accounts[ghost].usernameAt, 0, 'a failed lookup is not a fresh name')
  d.members[ghost] = 'ghost_real'
  r.now += 5 * 60000
  await r.tick()
  assert.equal(t.name, 'ghosty', 'not every tick')
  r.now += 6 * 60000
  await r.tick()
  assert.equal(t.name, 'ghost_real')
  assert.equal(r.registry().accounts[ghost].usernameAt, r.now)
})

test('a lost registry adopts the forum\'s threads by marker with nothing posted again; a corrupt one posts nothing', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'strike', T0)], 58: [entry(1, 'suspend', T0, { char: 'Borin #BOR1', until: T0 + HOUR })] }
  await r.tick()
  r.now += 2 * HOUR
  await r.tick()
  const posts = () => r.discord.calls.filter(c => c.method === 'POST').length
  const before = posts()
  fs.rmSync(r.file)
  r.tracker = r.make()
  await r.tick()
  await r.tick()
  assert.equal(posts(), before)
  assert.equal(r.discord.threads.size, 2)
  const reg = r.registry()
  assert.equal(reg.accounts[PEOPLE.alice.discordId].threadId, r.named('alice_rp').id)
  assert.equal(reg.accounts[PEOPLE.bob.discordId].threadId, r.named('bob_rp').id)

  fs.writeFileSync(r.file, '{bad')
  r.tracker = r.make()
  const writes = r.discord.writes().length
  r.data.discipline[57].push(entry(2, 'strike', r.now))
  await r.tick()
  await r.tick()
  assert.equal(r.discord.writes().length, writes)
  assert.equal(r.logs.filter(l => /registry cannot be read/.test(l)).length, 1)
})

test('Discord refusing a new thread (160006) holds it and the row, the audit line once an hour', async () => {
  const d = fakeDiscord()
  const r = await started({ discord: d })
  d.fail = (method, p) => (method === 'POST' && p === `/channels/${FORUM}/threads` ? fakeDiscord.error(400, 160006) : null)
  r.data.discipline = { 57: [entry(1, 'strike', T0)] }
  await r.tick()
  r.now += 60000
  await r.tick()
  assert.equal(d.threads.size, 0)
  assert.deepEqual(r.registry().accounts[PEOPLE.alice.discordId].rows, {})
  assert.equal(r.audits.length, 1)
  d.fail = () => null
  r.now += 11 * 60000
  await r.tick()
  assert.equal(d.threads.size, 1)
})

test('the first run waits while a source cannot be read', async () => {
  const r = rig({ data: { discipline: { 57: [entry(1, 'warn', T0 - 200 * DAY)] } } })
  r.status = { journal: { status: 'unreadable' } }
  await r.tick()
  assert.ok(!fs.existsSync(r.file) || !r.registry().baselinedAt)
  assert.ok(r.logs.some(l => /first run waits until journal can be read/.test(l)))
  r.status = {}
  await r.tick()
  assert.ok(r.registry().baselinedAt)
  assert.equal(r.discord.threads.size, 0)
})

test('a panel tempban that disappears (pruned once it ran out) posts ENDED', async () => {
  const r = await started()
  r.data.adminBans = [{ id: 't1', profileId: 57, name: 'Alia', until: T0 + DAY, reason: 'griefing', by: 'profile 1', at: T0 }]
  await r.tick()
  assert.match(r.messages()[1].content, /^\*\*PANEL TEMPBAN\*\* · abn:t1/)
  r.now += 60000
  r.data.adminBans = []
  await r.tick()
  assert.equal(r.messages()[2].content, '**ENDED** · panel tempban abn:t1 is no longer on the F7 panel ban list')
})

test('a row going backwards (a suspension extended after it ended) only re-renders the starter', async () => {
  const r = await started()
  r.data.discipline = { 57: [entry(1, 'suspend', T0, { until: T0 + HOUR })] }
  await r.tick()
  r.now += 2 * HOUR
  await r.tick()
  assert.equal(r.messages().length, 3)
  r.data.discipline[57][0].until = r.now + DAY
  r.now += 60000
  await r.tick()
  const t = r.discord.thread()
  assert.equal(t.messages.length, 3)
  assert.match(t.messages[0].content, /Status: \*\*ACTIVE\*\*/)
  assert.equal(r.registry().accounts[PEOPLE.alice.discordId].rows['dsc:57:1'].state, 'running')
})

test('ban-list entries with no ref: removing one never moves another\'s id, and a ref given later posts nothing again', async () => {
  const r = await started()
  const f7 = p => ({ discordId: p.discordId, reason: 'duping', bannedAt: iso(T0), bannedBy: 'lena (dashboard)' })
  r.data.bans = [f7(PEOPLE.alice), f7(PEOPLE.bob)]
  await r.tick()
  await r.tick()
  const bob = () => r.named('bob_rp').messages.slice(1).map(m => m.content)
  const alice = () => r.named('alice_rp').messages.slice(1).map(m => m.content)
  assert.equal(banPosts(r).length, 2)
  r.now += HOUR
  r.data.bans = [f7(PEOPLE.bob)]
  await r.tick()
  await r.tick()
  assert.equal(bob().length, 1, bob().join('\n'))
  assert.equal(alice().filter(c => c.startsWith('**UNBANNED**')).length, 1, alice().join('\n'))
  r.now += HOUR
  r.data.bans = [{ ...f7(PEOPLE.bob), ref: 'B-DDDDDD' }]
  await r.tick()
  await r.tick()
  assert.equal(bob().length, 1, bob().join('\n'))
  assert.equal(r.registry().accounts[PEOPLE.bob.discordId].rows['ban:B-DDDDDD'].state, 'running')
  r.now += HOUR
  r.data.bans = []
  await r.tick()
  assert.deepEqual(bob().slice(1).map(c => c.split(' — ')[0].split('\n')[0]), ['**UNBANNED** · ban:B-DDDDDD removed from the game ban list'])
})

test('an F7 ban replacing a Discord copy minutes later carries its own nonce, so Discord does not swallow it', async () => {
  const r = await started()
  r.data.journal = [jbanOf(T0)]
  r.data.bans = [banOf(T0 + 5000, false)]
  await r.tick()
  r.now += 3 * 60000
  r.data.bans = [banOf(r.now, true)]
  await r.tick()
  await r.tick()
  const msgs = r.discord.thread().messages.slice(1).filter(m => /^\*\*(DISCORD BAN|GAME BAN LIST)/.test(m.content))
  assert.equal(msgs.length, 2, msgs.map(m => m.content).join('\n'))
  assert.ok(msgs[0].nonce && msgs[1].nonce)
  assert.notEqual(msgs[0].nonce, msgs[1].nonce)
})

test('a ref-less ban lifted, then a new ban with a ref minutes later, is posted as a new ban', async () => {
  const r = await started()
  const f7 = at => ({ discordId: PEOPLE.bob.discordId, reason: 'duping', bannedAt: iso(at), bannedBy: 'lena (dashboard)' })
  r.data.bans = [f7(T0)]
  await r.tick()
  await r.tick()
  const bob = () => r.named('bob_rp').messages.slice(1).map(m => m.content.split('\n')[0])
  assert.equal(bob().length, 1)
  r.now += 2 * 60000
  r.data.bans = []
  await r.tick()
  await r.tick()
  assert.equal(bob().length, 2, bob().join('\n'))
  r.now += 2 * 60000
  r.data.bans = [{ ...f7(r.now), ref: 'B-DDDDDD' }]
  await r.tick()
  await r.tick()
  assert.deepEqual(bob().slice(2), ['**GAME BAN LIST** · ban:B-DDDDDD'])
  const rows = r.registry().accounts[PEOPLE.bob.discordId].rows
  assert.equal(rows['ban:B-DDDDDD'].state, 'running')
  assert.equal(rows[R.reflessBanId(PEOPLE.bob.discordId)].state, 'unbanned')
})
