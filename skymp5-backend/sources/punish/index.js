'use strict'
// The Punishments panel's data (routes/site-punish.js): every record source read on demand and read only, merged into one
// list of rows, filtered for the viewer's rank on the server, and paged by an opaque cursor. A row leaves only through
// serve(), which copies named fields: no Discord id, hwid or address is ever in a response.

const fs = require('fs')
const path = require('path')
const { jsonFile, jsonlTail } = require('./files')
const R = require('./records')
const { createIdentity, discordNameOf } = require('./identity')
const { createPlayerLog } = require('./playerLog')

const LABELS = { owner: 'Owner', dev: 'Dragon Break Dev', leadgm: 'Lead GM', gm: 'GM' }
// A GM sees discipline, kicks and jail, and bans and timeouts only while they run (Jake decides whether GMs see it at all)
const GM_ALWAYS = new Set(['warn', 'strike', 'suspend', 'lift', 'overturn', 'kick', 'jail'])
const GM_WHILE_ACTIVE = new Set(['tempban', 'ban', 'ipban', 'discord_ban', 'discord_timeout'])
const GM_KINDS = R.KINDS.filter(k => GM_ALWAYS.has(k) || GM_WHILE_ACTIVE.has(k))
const SOURCES = ['discipline', 'panelBans', 'bans', 'jail', 'restitution', 'journal', 'playerLog']
const PERMANENT = Number.MAX_SAFE_INTEGER
const SEARCH_MAX = 20
const COLLECT_MS = 2000
const LOOKUPS_AT_ONCE = 5
// One GM request waits on Discord this long at most, however many accounts it covers; what is not answered is hidden
const LOOKUPS_MS = 10000

const ROW_FIELDS = ['id', 'kind', 'source', 'by', 'state', 'active', 'reason', 'ref', 'ticket', 'told', 'outside', 'undid', 'lifts',
  'hours', 'count', 'how', 'leftMs', 'totalMs', 'concordat', 'alsoHolds']
const iso = t => (Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null)

class BadRequest extends Error {
  constructor(code) { super(code); this.code = code }
}

// ---- cursor: base64url of [sort key, row id], checked when read ----
const ID_RE = /^(?:dsc|abn|ban|plog|mod|jail|rst):[A-Za-z0-9:_.#-]{1,80}$/
const encodeCursor = (key, id) => Buffer.from(JSON.stringify([key, id])).toString('base64url')
function decodeCursor(text) {
  if (text === undefined || text === '') return null
  if (typeof text !== 'string' || text.length > 200 || !/^[A-Za-z0-9_-]+$/.test(text)) throw new BadRequest('badCursor')
  let v
  try { v = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) } catch { throw new BadRequest('badCursor') }
  if (!Array.isArray(v) || v.length !== 2 || !Number.isSafeInteger(v[0]) || typeof v[1] !== 'string' || !ID_RE.test(v[1])) throw new BadRequest('badCursor')
  return { key: v[0], id: v[1] }
}

// Rows sorted by key (dir -1: newest first) then id, from just after the cursor
function paginate(rows, keyOf, dir, cursor, limit) {
  const cmp = (ka, ia, kb, ib) => dir * (ka - kb) || (ia < ib ? -1 : ia > ib ? 1 : 0)
  const sorted = rows.map(r => ({ r, k: keyOf(r) })).sort((a, b) => cmp(a.k, a.r.id, b.k, b.r.id))
  const start = cursor ? sorted.findIndex(x => cmp(x.k, x.r.id, cursor.key, cursor.id) > 0) : 0
  const page = start < 0 ? [] : sorted.slice(start, start + limit)
  const last = page[page.length - 1]
  const more = start >= 0 && sorted.length > start + limit
  return { rows: page.map(x => x.r), next: more && last ? encodeCursor(last.k, last.r.id) : null }
}
const atKey = r => r.atMs || 0
const endsKey = r => (r.endsAtMs ? r.endsAtMs : PERMANENT)

async function mapLimit(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

function createPunishments({ config, readStore, dynamicFields, characterName, loadProfiles, loadPlayers, staffStatusOf,
  now = Date.now, playerLog, tailIntervalMs = 30000 }) {
  const gameDir = () => config.gameServerDir
  const stateDir = () => { try { return path.dirname(fs.realpathSync(path.join(gameDir(), 'world'))) } catch { return gameDir() } }
  const gameConfig = jsonFile(path.join(gameDir(), 'gamemode-config.json'), R.parseGameConfig)
  const files = {
    discipline: jsonFile('', R.parseDiscipline),
    held: jsonFile('', R.parseHeld),
    panelBans: jsonFile('', R.parseAdminBans),
    bans: jsonFile('', R.parseBans),
    cases: jsonFile('', R.parseCases),
    restitution: jsonFile('', R.parseRestitutionState),
  }
  const journal = jsonlTail(config.punishJournalFile, R.parseJournalLine, { minIntervalMs: tailIntervalMs, now })
  const plog = playerLog || createPlayerLog({ dir: config.punishPlayerLogDir, days: config.punishPlayerLogDays, now })
  const identity = createIdentity({ loadProfiles, loadPlayers, readStore, dynamicFields, characterName, now })
  let plogCache = { version: -1, rows: [] }
  let snapshot = null

  // The paths the game itself uses (discipline.js and restitution.js resolve them from the server's working directory)
  function paths(cfg) {
    const within = f => path.resolve(gameDir(), f)
    const discipline = cfg.discipline.file ? within(cfg.discipline.file) : path.join(stateDir(), 'discipline.json')
    return {
      discipline,
      held: cfg.discipline.discordFile ? within(cfg.discipline.discordFile) : path.join(path.dirname(discipline), 'discipline-discord.json'),
      panelBans: path.join(gameDir(), 'admin-bans.json'),
      bans: config.punishBansFile,
      cases: cfg.restitution.casesFile ? within(cfg.restitution.casesFile) : path.join(gameDir(), 'restitution-cases.json'),
      restitution: cfg.restitution.stateFile ? within(cfg.restitution.stateFile) : path.join(stateDir(), 'restitution-state.json'),
    }
  }

  function plogRows() {
    const { version, list } = plog.events()
    if (version !== plogCache.version) plogCache = { version, rows: R.playerLogRows(list) }
    return plogCache.rows
  }

  // The account a row is about, from whichever of profile, Discord account or #TAG the record has
  function fill(r, id) {
    const t = r.target
    if (t.profileId === null && t.tag && id.byTag.has(t.tag)) {
      const c = id.byTag.get(t.tag)
      t.profileId = c.profileId
      t.name = t.name || c.name
    }
    if (t.profileId === null && r._discordId && id.profileOf.has(r._discordId)) t.profileId = id.profileOf.get(r._discordId)
    if (!r._discordId && t.profileId !== null) r._discordId = id.discordOf.get(t.profileId) || null
    t.discordName = t.discordName || discordNameOf(id, r._discordId)
    if (!t.name && t.profileId !== null) {
      const first = (id.chars.get(t.profileId) || []).find(c => c.status !== 'deleted')
      if (first) { t.name = first.name; t.tag = t.tag || first.tag }
    }
    if (r._byDiscordId) { r.by = discordNameOf(id, r._byDiscordId) || 'a dashboard user'; r._byDiscordId = null }
    // The admin panel and the in-game ban name staff as "profile N" or "profile N (tier)"
    const staff = typeof r.by === 'string' && /^profile (\d{1,9})(?: \(([a-z]{1,12})\))?$/.exec(r.by)
    const staffName = staff && discordNameOf(id, id.discordOf.get(Number(staff[1])))
    if (staffName) r.by = `${staffName} (profile ${staff[1]}${staff[2] ? `, ${staff[2]}` : ''})`
  }

  function collect() {
    const t = now()
    if (snapshot && t - snapshot.at < COLLECT_MS) return snapshot
    const g = gameConfig.read(path.join(gameDir(), 'gamemode-config.json'))
    const cfg = g.value || R.DEFAULT_CONFIG
    const p = paths(cfg)
    const read = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, f.read(p[k])]))
    const j = journal.read()
    plog.refresh()
    const id = identity.get()
    const dsc = R.disciplineRows(read.discipline.value || [], { now: t, strikeDays: cfg.discipline.strikeDays, held: read.held.value || new Map() })
    const rows = [
      ...dsc.rows,
      ...R.adminBanRows(read.panelBans.value || [], { now: t }),
      ...R.banRows(read.bans.value || []),
      ...R.jailRows(id.sentences, { now: t }),
      ...R.restitutionRows(read.cases.value || [], read.restitution.value || new Map(), cfg.restitution),
      ...R.journalRows(j.rows, { now: t }),
      ...plogRows().map(r => ({ ...r, target: { ...r.target } })),
    ]
    for (const r of rows) fill(r, id)
    const flag = v => ({ status: v.status, asOf: v.asOf })
    const restStatus = read.cases.status === 'ok' && read.restitution.status === 'unreadable' ? read.restitution : read.cases
    snapshot = {
      at: t, rows: R.oneRowPerBan(rows), strikes: dsc.strikes, cfg, id,
      sources: {
        discipline: flag(read.discipline), panelBans: flag(read.panelBans), bans: flag(read.bans),
        jail: { status: id.status.store === 'ok' ? 'ok' : 'unreadable', asOf: iso(t) },
        restitution: flag(restStatus), journal: flag(j), playerLog: plog.view(),
      },
    }
    return snapshot
  }

  const isOwn = (r, viewer) => (r.target.profileId !== null && r.target.profileId === viewer.profileId) || (!!r._discordId && r._discordId === viewer.discordId)
  function allowed(tier, r, viewer) {
    if (tier !== 'owner' && isOwn(r, viewer)) return false
    if (tier !== 'gm') return true
    return GM_ALWAYS.has(r.kind) || (GM_WHILE_ACTIVE.has(r.kind) && r.active)
  }

  // For a GM, records on staff members are left out, and so is any whose account Discord could not be asked about
  async function staffFree(discordIds) {
    const list = [...new Set(discordIds.map(d => d || ''))]
    let timer
    const giveUp = new Promise(resolve => { timer = setTimeout(resolve, LOOKUPS_MS, 'unknown') })
    try {
      const status = await mapLimit(list, LOOKUPS_AT_ONCE, d => (d ? Promise.race([staffStatusOf(d), giveUp]) : 'unknown'))
      return new Set(list.filter((d, i) => status[i] === 'player'))
    } finally { clearTimeout(timer) }
  }

  async function visible(viewer, rows) {
    const out = rows.filter(r => allowed(viewer.tier, r, viewer))
    if (viewer.tier !== 'gm') return out
    const ok = await staffFree(out.map(r => r._discordId))
    return out.filter(r => ok.has(r._discordId || ''))
  }

  function serve(r, viewer, t) {
    const o = {}
    for (const k of ROW_FIELDS) o[k] = r[k] ?? null
    o.target = { profileId: r.target.profileId, name: r.target.name, tag: r.target.tag, discordName: r.target.discordName }
    o.at = iso(r.atMs)
    o.until = iso(r.untilMs)
    o.from = iso(r.fromMs)
    o.endsInMs = r.active && r.endsAtMs ? Math.max(0, r.endsAtMs - t) : null
    o.lifted = r.lifted ? { by: r.lifted.by, at: iso(r.lifted.atMs), reason: r.lifted.reason } : null
    o.overturned = r.overturned ? { by: r.overturned.by, at: iso(r.overturned.atMs), reason: r.overturned.reason } : null
    o.items = r.items ? { ...r.items } : null
    if (viewer.tier === 'gm' && GM_WHILE_ACTIVE.has(r.kind)) o.by = null
    return o
  }

  function kindsFor(tier) { return tier === 'gm' ? GM_KINDS : R.KINDS }

  // ?kind=a,b against the viewer's kinds; ?from= and ?to= as YYYY-MM-DD, to taking the whole day; ?limit= 1 to 100
  function listOptions(viewer, q, defaultFromMs) {
    const mine = kindsFor(viewer.tier)
    let kinds = null
    if (q.kind !== undefined && q.kind !== '') {
      if (typeof q.kind !== 'string' || q.kind.length > 400) throw new BadRequest('badKind')
      kinds = new Set(q.kind.split(','))
      if ([...kinds].some(k => !mine.includes(k))) throw new BadRequest('badKind')
    }
    const day = (v, end) => {
      if (v === undefined || v === '') return null
      const t = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00Z`) : NaN
      if (!Number.isFinite(t)) throw new BadRequest('badDate')
      return end ? t + R.DAY_MS - 1 : t
    }
    let limit = 50
    if (q.limit !== undefined && q.limit !== '') {
      if (typeof q.limit !== 'string' || !/^\d{1,3}$/.test(q.limit) || Number(q.limit) < 1 || Number(q.limit) > 100) throw new BadRequest('badLimit')
      limit = Number(q.limit)
    }
    const fromMs = day(q.from, false) ?? defaultFromMs
    const toMs = day(q.to, true)
    if (fromMs !== null && toMs !== null && fromMs > toMs) throw new BadRequest('badDate')
    return { kinds, fromMs, toMs, limit, cursor: decodeCursor(q.cursor) }
  }
  const matches = (o, r) => (!o.kinds || o.kinds.has(r.kind)) && (o.fromMs === null || (r.atMs || 0) >= o.fromMs) && (o.toMs === null || (r.atMs || 0) <= o.toMs)

  function strikesOf(rows, s) {
    const per = new Map()
    for (const r of rows) {
      if (r.kind !== 'strike' || r.state !== 'counting') continue
      const p = r.target.profileId
      if (!per.has(p)) per.set(p, { target: { ...r.target }, count: 0 })
      per.get(p).count++
    }
    return [...per.values()].map(x => ({ ...x, review: s.cfg.discipline.strikesForReview, days: s.cfg.discipline.strikeDays }))
      .sort((a, b) => b.count - a.count || (a.target.profileId ?? 0) - (b.target.profileId ?? 0))
  }

  function characters(id, p) {
    return (id.chars.get(p) || []).slice(0, 12).map(c => ({ name: c.name, tag: c.tag, status: c.status }))
  }

  return {
    LABELS,

    info(viewer) {
      const s = collect()
      return {
        v: 1, tier: viewer.tier, label: LABELS[viewer.tier], kinds: kindsFor(viewer.tier), sources: s.sources,
        strikeDays: s.cfg.discipline.strikeDays, strikesForReview: s.cfg.discipline.strikesForReview,
      }
    },

    async active(viewer, q) {
      const o = listOptions(viewer, q, null)
      const s = collect()
      const rows = await visible(viewer, s.rows)
      const page = paginate(rows.filter(r => r.active && matches(o, r)), endsKey, 1, o.cursor, o.limit)
      return { v: 1, rows: page.rows.map(r => serve(r, viewer, s.at)), next: page.next, strikes: o.cursor ? [] : strikesOf(rows, s) }
    },

    async recent(viewer, q) {
      // The last 30 days unless a date is picked; a "to" alone has no lower bound
      const o = listOptions(viewer, q, q.to !== undefined && q.to !== '' ? null : now() - 30 * R.DAY_MS)
      const s = collect()
      const rows = await visible(viewer, s.rows)
      const page = paginate(rows.filter(r => matches(o, r)), atKey, -1, o.cursor, o.limit)
      return { v: 1, rows: page.rows.map(r => serve(r, viewer, s.at)), next: page.next, from: iso(o.fromMs), to: iso(o.toMs) }
    },

    async player(viewer, profileId, q) {
      const o = listOptions(viewer, q, null)
      if (viewer.tier !== 'owner' && profileId === viewer.profileId) return { status: 403, body: { error: 'ownAccount' } }
      const s = collect()
      const id = s.id
      const discordId = id.discordOf.get(profileId) || null
      if (viewer.tier === 'gm' && (await staffStatusOf(discordId)) !== 'player') return { status: 404, body: { error: 'notFound' } }
      const rows = (await visible(viewer, s.rows)).filter(r => r.target.profileId === profileId)
      if (!rows.length && !id.chars.has(profileId) && !discordId) return { status: 404, body: { error: 'notFound' } }
      const page = paginate(rows.filter(r => matches(o, r)), atKey, -1, o.cursor, o.limit)
      const strikes = strikesOf(rows, s)[0]
      return {
        status: 200,
        body: {
          v: 1,
          player: { profileId, discordName: discordNameOf(id, discordId), characters: characters(id, profileId) },
          strikes: { count: strikes ? strikes.count : 0, review: s.cfg.discipline.strikesForReview, days: s.cfg.discipline.strikeDays },
          active: o.cursor ? [] : paginate(rows.filter(r => r.active), endsKey, 1, null, 100).rows.map(r => serve(r, viewer, s.at)),
          history: page.rows.map(r => serve(r, viewer, s.at)),
          next: page.next,
        },
      }
    },

    // A character name (part of it, 2 to 40 characters), #TAG or TAG, "profile N" or N, or a Discord name (whole or its start)
    async search(viewer, q) {
      const text = typeof q === 'string' ? q.trim() : ''
      if (text.length < 1 || text.length > 40) throw new BadRequest('badQuery')
      const s = collect()
      const id = s.id
      const hits = new Map()
      const hit = (p, rank) => { if (p !== null && p !== undefined && (!hits.has(p) || hits.get(p) > rank)) hits.set(p, rank) }
      const num = /^(?:profile\s*)?(\d{1,9})$/i.exec(text)
      if (num) { const p = Number(num[1]); if (id.chars.has(p) || id.discordOf.has(p)) hit(p, 0) }
      const tag = /^#?([A-Za-z0-9]{4})$/.exec(text)
      if (tag && id.byTag.has(tag[1].toUpperCase())) hit(id.byTag.get(tag[1].toUpperCase()).profileId, 0)
      if (!num && !text.startsWith('#')) {
        if (text.length < 2) throw new BadRequest('badQuery')
        const lc = text.toLowerCase()
        for (const [p, chars] of id.chars) if (chars.some(c => c.name && c.name.toLowerCase().includes(lc))) hit(p, 1)
        for (const [d, n] of id.names) {
          if (!id.profileOf.has(d)) continue
          if (n.all.includes(lc)) hit(id.profileOf.get(d), 0)
          else if (n.all.some(x => x.startsWith(lc))) hit(id.profileOf.get(d), 2)
        }
      }
      const rows = await visible(viewer, s.rows)
      const counts = new Map()
      for (const r of rows) {
        const p = r.target.profileId
        if (p === null || !hits.has(p)) continue
        const c = counts.get(p) || { records: 0, active: 0 }
        c.records++
        if (r.active) c.active++
        counts.set(p, c)
      }
      let found = [...hits.entries()].filter(([p]) => viewer.tier === 'owner' || p !== viewer.profileId)
        .map(([p, rank]) => ({ p, rank, ...(counts.get(p) || { records: 0, active: 0 }) }))
        .sort((a, b) => a.rank - b.rank || b.active - a.active || b.records - a.records || a.p - b.p)
        .slice(0, 50)
      if (viewer.tier === 'gm') {
        const ok = await staffFree(found.map(f => id.discordOf.get(f.p)))
        found = found.filter(f => ok.has(id.discordOf.get(f.p) || ''))
      }
      return {
        v: 1,
        accounts: found.slice(0, SEARCH_MAX).map(f => ({
          profileId: f.p, discordName: discordNameOf(id, id.discordOf.get(f.p)), characters: characters(id, f.p), records: f.records, active: f.active,
        })),
      }
    },

    stop: () => plog.stop(),
  }
}

module.exports = { createPunishments, BadRequest, decodeCursor, encodeCursor, paginate, SOURCES, LABELS }
