'use strict'
// Each punishment record source as pure functions. parse*() checks a file's shape and keeps only what the panel shows:
// never an address, a hwid or a Discord id, except _discordId, which stays on the server to match records to accounts.
// *Rows() turns that into the panel's rows at a given time.

const { scrub } = require('./scrub')

const DAY_MS = 86400000
const HOUR_MS = 3600000
const KINDS = ['warn', 'strike', 'suspend', 'lift', 'overturn', 'tempban', 'ban', 'ipban', 'unban', 'discord_ban', 'discord_unban',
  'discord_timeout', 'discord_timeout_end', 'kick', 'jail', 'restitution']
const DISCIPLINE_KINDS = new Set(['warn', 'strike', 'suspend', 'lift', 'overturn'])
// ban and unban: the game ban list's, from the dashboard's actions, so a lifted ban keeps its history
const JOURNAL_KINDS = new Set(['discord_timeout', 'discord_timeout_end', 'discord_ban', 'discord_unban', 'ban', 'unban'])
const KICK_KINDS = new Set(['command', 'panel', 'suspension', 'discord_ban', 'ban_enforce'])
// Kicks that enforce a ban or suspension at each login try: one row with a count
const ENFORCING_KICKS = new Set(['suspension', 'discord_ban', 'ban_enforce'])
const TAG_RE = /^[A-Z0-9?]{4}$/
const DISCORD_ID_RE = /^\d{15,22}$/
const BAN_REF_RE = /^B-[0-9A-HJKMNP-TV-Z]{6}$/

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const posInt = v => (Number.isSafeInteger(v) && v > 0 ? v : null)
const epoch = v => (Number.isSafeInteger(v) && v > 0 ? v : null)
const isoMs = v => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null }
const discordIdOf = v => (DISCORD_ID_RE.test(String(v ?? '').trim()) ? String(v).trim() : null)
const sumCounts = m => (isObj(m) ? Object.entries(m) : []).reduce((n, [, c]) => n + (Number.isSafeInteger(c) && c > 0 ? c : 0), 0)

// 'Name #TAG' -> { name, tag }; 'profile N' names no character
function nameTag(value) {
  const s = scrub(value, 80)
  if (!s) return { name: null, tag: null }
  const m = /^(.*\S) #([A-Z0-9?]{4})$/.exec(s)
  if (m) return { name: m[1], tag: m[2] }
  return { name: /^profile \d+$/.test(s) ? null : s, tag: null }
}

// The ticket a record names: rep-0305 in a config key or reason, or "ticket #0141"
function ticketOf(...texts) {
  for (const t of texts) {
    const s = String(t ?? '')
    const rep = /\b(rep-\d{3,5})\b/i.exec(s)
    if (rep) return rep[1].toLowerCase()
    const num = /\bticket #?(\d{3,5})\b/i.exec(s)
    if (num) return `#${num[1]}`
  }
  return null
}

function row(fields) {
  return {
    id: null, kind: null, source: null, target: { profileId: null, name: null, tag: null, discordName: null }, _discordId: null,
    by: null, atMs: null, untilMs: null, fromMs: null, endsAtMs: null, state: 'recorded', active: false, reason: null, ref: null,
    ticket: null, told: null, outside: null, lifted: null, overturned: null, undid: null, lifts: null, hours: null, count: null,
    how: null, leftMs: null, totalMs: null, concordat: null, alsoHolds: null, items: null,
    ...fields,
  }
}
const hoursBetween = (a, b) => (a && b && b > a ? Math.round((b - a) / HOUR_MS) : null)

// ---- gamemode-config.json: only the discipline and restitution settings are kept ----
const DEFAULT_CONFIG = Object.freeze({
  discipline: { strikeDays: 90, strikesForReview: 3, file: '', discordFile: '' },
  restitution: { enabled: false, cases: [], casesFile: '', stateFile: '' },
})
function parseGameConfig(data) {
  if (!isObj(data)) throw new Error('not a gamemode config')
  const d = isObj(data.discipline) ? data.discipline : {}
  const r = isObj(data.restitution) ? data.restitution : {}
  const str = v => (typeof v === 'string' ? v : '')
  return {
    discipline: {
      strikeDays: posInt(d.strikeDays) || 90,
      strikesForReview: posInt(d.strikesForReview) || 3,
      file: str(d.file),
      discordFile: str(d.discordFile),
    },
    restitution: {
      enabled: r.enabled === true,
      cases: Array.isArray(r.cases) ? r.cases.map(String) : [],
      casesFile: str(r.casesFile),
      stateFile: str(r.stateFile),
    },
  }
}

// ---- discipline.json (gameplay discipline.js) ----
function parseDiscipline(data) {
  if (!isObj(data) || !isObj(data.profiles)) throw new Error('not a discipline record')
  const out = []
  for (const [key, list] of Object.entries(data.profiles)) {
    const p = Number(key)
    if (!Number.isSafeInteger(p) || p < 0 || !Array.isArray(list)) continue
    for (const e of list) {
      if (!isObj(e) || !DISCIPLINE_KINDS.has(e.kind) || !posInt(e.n)) continue
      const o = isObj(e.overturned) ? { by: scrub(e.overturned.by, 80), atMs: isoMs(e.overturned.at), reason: scrub(e.overturned.reason) } : null
      out.push({
        p, n: e.n, kind: e.kind, reason: scrub(e.reason), by: scrub(e.by, 80), atMs: isoMs(e.at), char: nameTag(e.char),
        seen: e.seen === true, untilMs: epoch(e.until), fromMs: epoch(e.from), lifted: e.lifted === true, overturned: o,
        undid: posInt(e.undid), lifts: posInt(e.lifts), key: scrub(e.key, 60),
      })
    }
  }
  return out
}

// discipline-discord.json { key: [Discord ids] }: only how many accounts each key holds out is kept
function parseHeld(data) {
  if (!isObj(data)) throw new Error('not { key: [ids] }')
  const out = new Map()
  for (const [key, ids] of Object.entries(data)) if (Array.isArray(ids)) out.set(key, ids.filter(d => discordIdOf(d)).length)
  return out
}

function disciplineRows(entries, { now, strikeDays = 90, held = new Map() }) {
  const byProfile = new Map()
  for (const e of entries) {
    if (!byProfile.has(e.p)) byProfile.set(e.p, [])
    byProfile.get(e.p).push(e)
  }
  const rows = []
  const strikes = new Map()
  for (const [p, list] of byProfile) {
    list.sort((a, b) => a.n - b.n)
    // A config lift names its suspension; an in-game lift ended the one running then, the latest marked lifted before it
    const liftOf = new Map()
    const ofLift = new Map()
    for (const l of list.filter(e => e.kind === 'lift')) {
      let s = l.lifts ? list.find(e => e.n === l.lifts && e.kind === 'suspend') : null
      if (!s) s = list.filter(e => e.kind === 'suspend' && e.lifted && e.n < l.n && !liftOf.has(e.n)).pop() || null
      if (s && !liftOf.has(s.n)) { liftOf.set(s.n, l); ofLift.set(l.n, s.n) }
    }
    let counting = 0
    for (const e of list) {
      const r = row({
        id: `dsc:${p}:${e.n}`, kind: e.kind, source: 'discipline', target: { profileId: p, name: e.char.name, tag: e.char.tag, discordName: null },
        by: e.by, atMs: e.atMs, reason: e.reason, ref: `#${e.n}`, ticket: ticketOf(e.key, e.reason), outside: e.key || null,
        told: e.kind === 'suspend' ? null : e.seen,
        overturned: e.overturned ? { ...e.overturned } : null,
      })
      if (e.kind === 'suspend') {
        const l = liftOf.get(e.n)
        Object.assign(r, {
          untilMs: e.untilMs, fromMs: e.fromMs, endsAtMs: e.untilMs, hours: hoursBetween(e.fromMs || e.atMs, e.untilMs),
          lifted: l ? { by: l.by, atMs: l.atMs, reason: l.reason } : e.lifted ? { by: null, atMs: null, reason: null } : null,
          alsoHolds: e.key && held.has(e.key) ? held.get(e.key) : null,
        })
        r.state = e.overturned ? 'overturned' : e.lifted ? 'lifted' : e.fromMs && e.fromMs > now ? 'scheduled'
          : e.untilMs && e.untilMs > now ? 'running' : 'ended'
        r.active = r.state === 'running' || r.state === 'scheduled'
      } else if (e.kind === 'strike') {
        const within = !e.overturned && e.atMs !== null && now - e.atMs < strikeDays * DAY_MS
        r.state = e.overturned ? 'overturned' : within ? 'counting' : 'expired'
        if (within) counting++
      } else if (e.kind === 'warn') {
        r.state = e.overturned ? 'overturned' : 'recorded'
      } else if (e.kind === 'lift') {
        r.lifts = ofLift.get(e.n) || e.lifts
      } else if (e.kind === 'overturn') {
        r.undid = e.undid
      }
      // A lift can be overturned too; the page shows who and why only on an overturned state
      if (e.overturned && r.state === 'recorded') r.state = 'overturned'
      rows.push(r)
    }
    if (counting) strikes.set(p, counting)
  }
  return { rows, strikes }
}

// ---- admin-bans.json (the fork's adminBans.ts): the ip field is never read past "is there one" ----
function parseAdminBans(data) {
  if (!isObj(data) || !Array.isArray(data.bans)) throw new Error('not an admin ban list')
  return data.bans.filter(isObj).map(b => ({
    id: /^[a-z0-9]{1,24}$/.test(String(b.id ?? '')) ? String(b.id) : null,
    profileId: posInt(b.profileId),
    name: scrub(b.name, 48),
    hasIp: typeof b.ip === 'string' && b.ip.trim() !== '',
    untilMs: epoch(b.until) || 0,
    reason: scrub(b.reason, 200),
    by: scrub(b.by, 40),
    atMs: epoch(b.at),
  })).filter(b => b.id)
}

function adminBanRows(list, { now }) {
  return list.map(b => {
    const running = !b.untilMs || b.untilMs > now
    return row({
      id: `abn:${b.id}`, kind: b.hasIp ? 'ipban' : b.untilMs ? 'tempban' : 'ban', source: 'panelBans',
      target: { profileId: b.profileId, name: b.name, tag: null, discordName: null },
      by: b.by, atMs: b.atMs, untilMs: b.untilMs || null, endsAtMs: b.untilMs || null, hours: hoursBetween(b.atMs, b.untilMs),
      reason: b.reason, ref: b.id, state: running ? 'running' : 'ended', active: running,
    })
  })
}

// ---- data/bans.json (the backend's game ban list): read here directly, never through sources/bans.js, whose lookups
// can save the file. hwid and ip are never read ----
// A ban the Punishments panel gave (bans.addNew, bannedBy '<handle> (dashboard)') shows its whole reason, up to 300; every
// other ban is cut at 200 as before. A Discord handle holds no space or bracket, so no older entry reads as one
const DASHBOARD_BY_RE = / \(dashboard\)$/
function parseBans(data) {
  if (!Array.isArray(data)) throw new Error('not a ban list')
  return data.map((b, i) => {
    if (!isObj(b)) return null
    const byRaw = String(b.bannedBy ?? '').trim()
    return {
      i, _discordId: discordIdOf(b.discordId), ref: BAN_REF_RE.test(String(b.ref ?? '')) ? b.ref : null,
      reason: scrub(b.reason, DASHBOARD_BY_RE.test(byRaw) ? 300 : 200), atMs: isoMs(b.bannedAt),
      by: discordIdOf(byRaw) ? null : scrub(byRaw, 80), _byDiscordId: discordIdOf(byRaw),
    }
  }).filter(Boolean)
}

function banRows(list) {
  return list.map(b => {
    const viaDiscord = b.reason === 'discord ban' && b.by === 'discord'
    return row({
      id: b.ref ? `ban:${b.ref}` : `ban:i${b.i}`, kind: viaDiscord ? 'discord_ban' : 'ban', source: 'bans', _discordId: b._discordId,
      _byDiscordId: b._byDiscordId, by: viaDiscord ? 'Discord' : b.by, atMs: b.atMs, reason: b.reason, ref: b.ref, state: 'running', active: true,
    })
  })
}

// ---- jail sentences on the changeforms (gameplay jail.js): the Concordat's "by" carries a Discord mention, so only
// whether it is a Concordat sentence is kept ----
// Time counts only while the prisoner is in the jail, so the Active list orders a sentence by its earliest end (at + total), which stays put
function jailRows(sentences) {
  const out = []
  for (const { key, profileId, name, tag, sentence: s } of sentences) {
    if (!isObj(s) || !/^[0-9a-f]{1,8}$/i.test(key)) continue
    const total = Number(s.totalMs)
    if (!(Number.isFinite(total) && total > 0)) continue
    const left = Math.max(0, total - (Number(s.servedMs) || 0))
    if (!left) continue
    const atMs = epoch(s.at)
    out.push(row({
      id: `jail:${key.toLowerCase()}`, kind: 'jail', source: 'jail', target: { profileId, name, tag, discordName: null },
      by: scrub(s.by, 80), atMs, state: 'running', active: true, leftMs: Math.round(left), totalMs: Math.round(total),
      endsAtMs: atMs ? Math.round(atMs + total) : null, concordat: isObj(s.concordat),
    }))
  }
  return out
}

// ---- restitution (gameplay restitution.js): the case file, its state and the config's active list. The state log's
// "where" names the thief through who(), with a Discord mention, so it is never read ----
const GOLD = 'f'
function parseCases(data) {
  if (!isObj(data)) throw new Error('not a restitution case file')
  return Object.entries(data).filter(([id, c]) => /^[A-Za-z0-9_-]{1,32}$/.test(id) && isObj(c)).map(([id, c]) => {
    const items = isObj(c.items) ? c.items : {}
    return {
      id, tag: TAG_RE.test(String(c.tag ?? '')) ? c.tag : null, gold: sumCounts({ [GOLD]: items[GOLD] }),
      items: sumCounts(Object.fromEntries(Object.entries(items).filter(([h]) => h !== GOLD))),
      notice: scrub(c.notice), ticket: ticketOf(c._comment, c.notice),
    }
  })
}

function parseRestitutionState(data) {
  if (!isObj(data) || !isObj(data.cases)) throw new Error('not a restitution state')
  const out = new Map()
  for (const [id, cs] of Object.entries(data.cases)) {
    if (!isObj(cs)) continue
    const rec = isObj(cs.recovered) ? cs.recovered : {}
    const times = (Array.isArray(cs.log) ? cs.log : []).map(l => (isObj(l) ? isoMs(l.at) : null)).filter(Boolean).sort((a, b) => a - b)
    out.set(id, {
      gold: sumCounts({ [GOLD]: rec[GOLD] }), items: sumCounts(Object.fromEntries(Object.entries(rec).filter(([h]) => h !== GOLD))),
      firstMs: times[0] || null, takes: times.length,
    })
  }
  return out
}

function restitutionRows(cases, state, cfg) {
  return cases.map(c => {
    const st = state.get(c.id) || { gold: 0, items: 0, firstMs: null, takes: 0 }
    const owed = st.items < c.items || st.gold < c.gold
    const open = cfg.enabled === true && cfg.cases.includes(c.id) && owed
    return row({
      id: `rst:${c.id}`, kind: 'restitution', source: 'restitution', target: { profileId: null, name: null, tag: c.tag, discordName: null },
      by: 'staff (case file)', atMs: st.firstMs, reason: c.notice, ref: `case ${c.id}`, ticket: c.ticket, state: open ? 'open' : 'closed',
      active: open, outside: true, items: { items: c.items, itemsBack: Math.min(st.items, c.items), gold: c.gold, goldBack: Math.min(st.gold, c.gold) },
    })
  })
}

// ---- data/moderation.jsonl (the moderation journal, v1): one JSON per line ----
function parseJournalLine(o) {
  if (!isObj(o) || o.v !== 1 || !JOURNAL_KINDS.has(o.kind)) return null
  const atMs = isoMs(o.at)
  const id = /^M-[0-9A-Z]{6,12}$/.test(String(o.id ?? '')) ? o.id : null
  if (!atMs || !id) return null
  const by = isObj(o.by) ? o.by : {}
  const tags = Array.isArray(o.tags) ? o.tags.filter(t => TAG_RE.test(String(t))) : []
  return {
    id, kind: o.kind, atMs, _discordId: discordIdOf(o.discordId), profileId: posInt(o.profileId), tag: tags[0] || null,
    name: scrub(o.name, 48), discordName: scrub(o.discordName, 40), untilMs: isoMs(o.until), reason: scrub(o.reason),
    by: scrub(by.name, 48) || scrub(by.discordName, 40) || (posInt(by.profileId) ? `profile ${by.profileId}` : null),
    ticket: /^(?:rep-\d{3,5}|#\d{3,5})$/i.test(String(o.ticket ?? '')) ? String(o.ticket).toLowerCase() : ticketOf(o.reason),
    banRef: BAN_REF_RE.test(String(o.ref ?? '')) ? o.ref : null,
  }
}

// A timeout runs until its end, a later timeout of the same account or a timeout_end, whichever comes first. A game ban's
// row is history (the ban list's row is the running one) and an unban marks the one it lifted
function journalRows(entries, { now }) {
  const rows = []
  const lastTimeout = new Map()
  const bansOf = new Map()
  for (const e of [...entries].sort((a, b) => a.atMs - b.atMs || (a.id < b.id ? -1 : 1))) {
    const who = e._discordId || (e.profileId ? `p${e.profileId}` : null)
    const r = row({
      id: `mod:${e.id}`, kind: e.kind, source: 'journal', target: { profileId: e.profileId, name: e.name, tag: e.tag, discordName: e.discordName },
      _discordId: e._discordId, by: e.by, atMs: e.atMs, reason: e.reason, ref: e.id, ticket: e.ticket,
    })
    if (who && (e.kind === 'discord_timeout' || e.kind === 'discord_timeout_end')) {
      const prev = lastTimeout.get(who)
      if (prev && prev.state === 'running') { prev.state = 'ended'; prev.active = false }
      lastTimeout.delete(who)
    }
    if (e.kind === 'discord_timeout') {
      Object.assign(r, { untilMs: e.untilMs, endsAtMs: e.untilMs, hours: hoursBetween(e.atMs, e.untilMs) })
      r.state = e.untilMs && e.untilMs > now ? 'running' : 'ended'
      r.active = r.state === 'running'
      if (who) lastTimeout.set(who, r)
    }
    if (e.kind === 'ban' || e.kind === 'unban') r.ref = e.banRef || e.id
    if (who && e.kind === 'ban') bansOf.set(who, [...(bansOf.get(who) || []), r])
    if (who && e.kind === 'unban') {
      const list = bansOf.get(who) || []
      const b = e.banRef ? list.find(x => x.ref === e.banRef && x.state !== 'lifted') : list.filter(x => x.state !== 'lifted').pop()
      if (b) { b.state = 'lifted'; b.lifted = { by: e.by, atMs: e.atMs, reason: e.reason } }
    }
    rows.push(r)
  }
  return rows
}

// ---- the player log's kicks and bans (playerLog.js hands over only the fields picked in its worker) ----
function playerLogRows(events) {
  const rows = []
  const lastKick = new Map()
  const byText = b => {
    const n = b && scrub(b.n, 48)
    return !b ? null : n ? `${n}${b.c ? ` #${b.c}` : ''}` : Number.isSafeInteger(b.p) && b.p >= 0 ? `profile ${b.p}` : null
  }
  for (const e of [...events].sort((a, b) => a.t - b.t || a.s - b.s)) {
    const target = { profileId: Number.isSafeInteger(e.p) && e.p >= 0 ? e.p : null, name: scrub(e.n, 48), tag: e.c || null, discordName: null }
    const by = byText(e.by)
    const id = `plog:${e.g}:${e.s}`
    if (e.ev === 'session.kick') {
      if (!KICK_KINDS.has(e.kind)) continue
      const prev = lastKick.get(target.profileId ?? id)
      // The leave hook and the GM line write the same kick: one row
      if (prev && prev.how === e.kind && e.t - prev._lastMs < 15000) { prev.by = prev.by || by; prev._lastMs = e.t; continue }
      if (prev && prev.how === e.kind && ENFORCING_KICKS.has(e.kind) && e.t - prev._lastMs < HOUR_MS) { prev.count++; prev._lastMs = e.t; continue }
      const r = row({ id, kind: 'kick', source: 'playerLog', target, by, atMs: e.t, how: e.kind, count: 1, _lastMs: e.t })
      lastKick.set(target.profileId ?? id, r)
      rows.push(r)
    } else if (e.ev === 'session.ban') {
      const kind = e.src === 'audit:BAN' ? ({ ban: 'discord_ban', unban: 'discord_unban' })[e.kind]
        : ['ban', 'tempban', 'unban'].includes(e.kind) ? e.kind : null
      if (!kind) continue
      rows.push(row({ id, kind, source: 'playerLog', target, by, atMs: e.t, untilMs: epoch(e.until), hours: posInt(e.hours) }))
    }
  }
  return rows
}

// One row per ban (filled rows): the player log's copy goes when another source has it, and the ban list takes the journal's who and why
const SAME_BAN_MS = 10 * 60000
const PLOG_COPY_OF = { ban: ['tempban', 'ban'], discord_ban: ['discord_ban'], discord_unban: ['discord_unban'] }
function oneRowPerBan(rows) {
  const near = (a, b) => Number.isFinite(a.atMs) && Number.isFinite(b.atMs) && Math.abs(a.atMs - b.atMs) <= SAME_BAN_MS
  const others = rows.filter(r => r.source !== 'playerLog' && ['tempban', 'ban', 'discord_ban', 'discord_unban'].includes(r.kind))
  if (!others.length) return rows
  const drop = new Set()
  for (const b of others) {
    if (b.source !== 'bans' || !b._discordId) continue
    // A dashboard ban's journal row is the same ban by its ref; a Discord ban's is the one near it in time
    const same = x => (b.kind === 'ban' ? !!b.ref && x.ref === b.ref : near(x, b))
    const j = others.find(x => x.source === 'journal' && x.kind === b.kind && x.state !== 'lifted' && x._discordId === b._discordId && same(x) && !drop.has(x))
    if (j) { b.by = j.by || b.by; b.reason = j.reason || b.reason; b.ticket = b.ticket || j.ticket; drop.add(j) }
  }
  for (const r of rows) {
    const kinds = r.source === 'playerLog' ? PLOG_COPY_OF[r.kind] : null
    if (kinds && r.target.profileId !== null && others.some(o => kinds.includes(o.kind) && o.target.profileId === r.target.profileId && near(o, r))) drop.add(r)
  }
  return drop.size ? rows.filter(r => !drop.has(r)) : rows
}

module.exports = {
  KINDS, DEFAULT_CONFIG, DAY_MS, ticketOf, nameTag,
  parseGameConfig, parseDiscipline, parseHeld, disciplineRows, parseAdminBans, adminBanRows, parseBans, banRows, jailRows,
  parseCases, parseRestitutionState, restitutionRows, parseJournalLine, journalRows, playerLogRows, oneRowPerBan,
}
