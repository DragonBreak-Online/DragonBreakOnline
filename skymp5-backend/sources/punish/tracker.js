'use strict'
// The active-punishments tracker: one thread per punished account in the staff forum, kept in step with the punishment
// records every 30 s. It reads the Punishments panel's merged snapshot (index.js trackerSnapshot), compares each row with
// the registry (data/punish-threads.json) and posts each punishment, and each lift, expiry or unban of one, exactly once.
// The registry write is the commit point: a row is recorded only after Discord, or the dry-run file, has taken its post.
// PUNISH_TRACKER: off (default), dry or dry-run (posts go to a local jsonl, never to Discord), on.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { readStore, replaceFile, isPlainObject } = require('../storeFile')
const { scrub } = require('./scrub')
const { ticketOf, DAY_MS } = require('./records')
const { discordNameOf } = require('./identity')

const HOUR_MS = 3600000
const FORUM_ID = '1564694518194774067'
const DATA_DIR = path.join(__dirname, '..', '..', 'data')
const API = 'https://discord.com/api/v10'
const TICK_MS = 30000
const MAX_REQUESTS = 20
const GAP_MS = 1500
const MSG_MAX = 1900
const TITLE_MAX = 100
const CACHE_MS = 10 * 60000
const NAME_TTL_MS = 24 * HOUR_MS
const SAME_BAN_MS = 10 * 60000
const JOURNAL_WAIT_MS = 60000
const JOURNAL_LAG_MS = 10000
const NO_PINGS = Object.freeze({ parse: [] })
const TAG_NAMES = ['Active', 'Expired', 'Warning', 'Strike', 'Suspended', 'Banned', 'Discord timeout', 'Review']
const KIND_TAGS = ['Banned', 'Suspended', 'Discord timeout', 'Strike', 'Warning']

// Rows by id prefix: POSTED kinds are punishments, FOLD kinds only change the state of the punishment they name
const POSTED = {
  dsc: new Set(['warn', 'strike', 'suspend', 'ban']), ban: new Set(['ban', 'discord_ban']),
  mod: new Set(['discord_timeout', 'discord_ban']), abn: new Set(['tempban', 'ipban', 'ban']),
}
const FOLD = { dsc: new Set(['lift', 'overturn']), mod: new Set(['discord_timeout_end', 'discord_unban']) }
const SOURCE_OF = { dsc: 'discipline', ban: 'bans', mod: 'journal', abn: 'panelBans' }
// A ban list row that disappears was unbanned; a panel tempban that disappears was pruned once it ran out
const GONE_STATE = { ban: 'unbanned', abn: 'gone' }
const IN_FORCE = new Set(['active', 'running', 'scheduled', 'counting'])
// A change to a higher or equal rank is posted; a lower one (a row going backwards) only re-renders the starter
const RANK = { scheduled: 0, active: 1, running: 1, counting: 1, ended: 2, expired: 2, aged: 2, lifted: 2, unbanned: 2, gone: 2, overturned: 3 }

const OUT = new Error('the request budget for this tick is used')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const iso = t => new Date(t).toISOString()
const prefixOf = id => String(id).split(':')[0]
const isFold = r => !!(FOLD[prefixOf(r.id)] && FOLD[prefixOf(r.id)].has(r.kind))
const inScope = r => isFold(r) || !!(POSTED[prefixOf(r.id)] && POSTED[prefixOf(r.id)].has(r.kind))
const hasProfile = p => Number.isSafeInteger(p) && p >= 0
const keyOf = r => r._discordId || (hasProfile(r.target && r.target.profileId) ? `p:${r.target.profileId}` : null)
const ts = (ms, style) => (Number.isFinite(ms) && ms > 0 ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'an unknown time')
const sha1 = text => crypto.createHash('sha1').update(text).digest('hex')
const nonceOf = (key, rowId, state) => sha1(`${key}|${rowId}|${state}`).slice(0, 25)
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x))

function parseMode(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return v === 'on' ? 'on' : v === 'dry' || v === 'dry-run' ? 'dry' : 'off'
}

function settings(c = {}) {
  const mode = parseMode(c.punishTracker)
  const file = c.punishTrackerFile || path.join(DATA_DIR, 'punish-threads.json')
  const skip = Array.isArray(c.punishTrackerSkipProfiles) ? c.punishTrackerSkipProfiles
    : c.punishTrackerSkipProfiles !== undefined && c.punishTrackerSkipProfiles !== null ? String(c.punishTrackerSkipProfiles).split(',') : [126]
  return {
    mode,
    forumId: String(c.punishTrackerForumId || FORUM_ID),
    guildId: String(c.discordGuildId || ''),
    token: String(c.discordBotToken || ''),
    // Dry runs keep their own registry, so their made-up thread ids never reach the live one
    registryFile: mode === 'dry' ? (c.punishTrackerDryRegistryFile || file.replace(/(\.json)?$/, '.dry.json')) : file,
    dryFile: c.punishTrackerDryFile || path.join(DATA_DIR, 'punish-tracker-dry.jsonl'),
    skip: skip.map(Number).filter(hasProfile),
    warnDays: Number(c.punishTrackerWarnDays) > 0 ? Number(c.punishTrackerWarnDays) : 90,
    headroom: Number(c.punishTrackerHeadroom) > 0 ? Number(c.punishTrackerHeadroom) : 975,
    hideStaff: c.punishTrackerHideStaffTargets === true,
  }
}

// One message's text made safe to post: no bare Discord id outside a <@id>, no half token or half emoji, under 2000 characters
function finish(text) {
  let s = String(text).replace(/<@!?(\d{15,22})>|\d{15,}/g, (m, id) => (id ? `<@${id}>` : '[id]'))
  if (s.length > MSG_MAX) s = `${s.slice(0, MSG_MAX - 1).replace(/[\uD800-\uDBFF]$/, '').replace(/<[^>\n]*$/, '')}\u2026`
  return s.toWellFormed()
}

// The starter's first line names the account, so a lost registry can be rebuilt from the forum
function markerOf(text) {
  const line = String(text || '').split('\n')[0]
  const m = /^<@(\d{15,22})> · /.exec(line) || /^(p:\d{1,9}) · profile \d{1,9} \(no Discord link\)$/.exec(line)
  return m ? m[1] : null
}

// Discord refusing this request for good: a 400 with Discord's JSON error code (audit.js's rule), except a full guild
// (160006) or an archived thread (50083), which clear later
const NOT_FINAL = new Set([160006, 50083])
const refusedForGood = err => err.status === 400 && Number.isInteger(err.code) && err.code > 0 && !NOT_FINAL.has(err.code)
const threadGone = err => err.status === 404 && err.code === 10003

// ---- Discord writers: request(method, path, body) -> the parsed answer ----

// Plain REST with the bot token: one request at a time, gapMs apart; a 429 pauses the queue for retry_after (the global
// one too), a 5xx or network error backs off, and either gives up after `tries`. A request sent with { once: true } is
// never sent again after a 5xx or network error, as Discord may have done it
function createRestWriter({ token, fetch: doFetch = globalThis.fetch, gapMs = GAP_MS, tries = 5, timeoutMs = 15000, now = Date.now,
  sleep = wait, log = () => {} }) {
  let chain = Promise.resolve()
  let nextAt = 0
  const backoff = n => Math.min(30000, 1000 * 2 ** (n - 1))

  async function send(method, p, body, once) {
    let failures = 0, limited = 0
    for (;;) {
      const idle = nextAt - now()
      if (idle > 0) await sleep(idle)
      nextAt = now() + gapMs
      let res, text
      try {
        res = await doFetch(`${API}${p}`, {
          method,
          headers: { Authorization: `Bot ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        })
        text = await res.text()
      } catch (err) {
        if (once || ++failures >= tries) throw err
        await sleep(backoff(failures))
        continue
      }
      let data = null
      try { data = text ? JSON.parse(text) : null } catch { data = null }
      if (res.status < 300) return data
      if (res.status === 429 && ++limited < tries) {
        const header = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null
        const after = Number((data && data.retry_after) ?? header) || 1
        if (data && data.global) log(`global rate limit: the queue waits ${after} s`)
        nextAt = Math.max(nextAt, now() + Math.ceil(after * 1000) + 100)
        continue
      }
      if (res.status >= 500 && !once && ++failures < tries) { await sleep(backoff(failures)); continue }
      const err = new Error(`discord ${method} ${p} failed (${res.status}): ${String(text || '').slice(0, 200)}`)
      err.status = res.status
      err.body = text
      err.code = data && Number.isInteger(data.code) ? data.code : null
      throw err
    }
  }

  return {
    request(method, p, body, { once = false } = {}) {
      const run = chain.then(() => send(method, p, body, once))
      chain = run.catch(() => {})
      return run
    },
  }
}

// Dry run: every write is appended to a local jsonl with a made-up id in reply, reads answer empty; it has no network code
function createDryWriter({ file, now = Date.now }) {
  let n = 0
  const fakeId = () => `${now()}${String(++n).padStart(6, '0')}`
  const ACTIONS = [
    [/^POST \/channels\/\d+\/threads$/, 'create-thread'], [/^POST \/channels\/\d+\/messages$/, 'reply'],
    [/^PATCH \/channels\/(\d+)\/messages\/\1$/, 'edit-starter'], [/^PATCH \/channels\/\d+$/, 'edit-thread'],
  ]
  return {
    async request(method, p, body, opts) {
      if (method === 'GET') {
        if (/\/threads\/(active|archived\/public)/.test(p)) return { threads: [], has_more: false }
        if (/^\/channels\/\d+$/.test(p)) return { id: p.split('/')[2], available_tags: [] }
        return null
      }
      const action = (ACTIONS.find(([rx]) => rx.test(`${method} ${p}`)) || [null, 'other'])[1]
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const line = { at: iso(now()), action, method, path: p, body }
      // Dry reads answer empty, so the review shows which titles were never looked up
      if (action === 'create-thread' && opts && opts.localTitle) line.title = 'local fallback, not looked up'
      fs.appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 })
      const id = fakeId()
      return action === 'create-thread' ? { id, message: { id } } : { id }
    },
  }
}

// ---- the registry file ----
function fileStore(file) {
  const problemOf = v => (isPlainObject(v) && v.v === 1 && isPlainObject(v.accounts) ? null : 'is not a punishment tracker registry (v1)')
  return {
    load: () => readStore(file, problemOf, 'Fix it by hand, or move it away so the tracker rebuilds it from the forum'),
    save(reg) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      replaceFile(file, `${JSON.stringify(reg)}\n`, { mode: 0o600, durable: true })
    },
  }
}

// ---- what a row is now, and what is posted about it ----

// The tracker's state of a row: the records' own, a warning's window, a ban list row (running while there), a lift's match
function stateOf(r, g) {
  if (isFold(r)) {
    const n = r.kind === 'lift' ? r.lifts : r.kind === 'overturn' ? r.undid : null
    if (r.kind !== 'lift' && r.kind !== 'overturn') return 'folded'
    return n && g.ids.has(`dsc:${r.target.profileId}:${n}`) ? 'folded' : 'unmatched'
  }
  if (r.source === 'discipline' && r.kind === 'warn') {
    if (r.state === 'overturned') return 'overturned'
    return !r.atMs || r.atMs + g.warnDays * DAY_MS > g.now ? 'active' : 'aged'
  }
  if (r.source === 'bans') return 'running'
  if (r.source === 'journal' && r.kind === 'discord_ban') return discordUnbanOf(r._discordId, r.atMs, g) ? 'unbanned' : 'running'
  return r.state
}

const discordUnbanOf = (discordId, atMs, g) => (discordId
  ? g.all.find(u => u.source === 'journal' && u.kind === 'discord_unban' && u._discordId === discordId && u.atMs >= (atMs || 0)) || null : null)

function label(r) {
  if (r.source === 'discipline') return { warn: 'WARNING', strike: 'STRIKE', suspend: 'SUSPENSION', ban: 'BAN (game, permanent)' }[r.kind]
  if (r.source === 'bans') return r.kind === 'discord_ban' ? 'GAME BAN LIST (Discord ban)' : 'GAME BAN LIST'
  if (r.source === 'journal') return r.kind === 'discord_ban' ? 'DISCORD BAN' : 'DISCORD TIMEOUT'
  return { tempban: 'PANEL TEMPBAN', ipban: 'PANEL IP BAN', ban: 'PANEL BAN' }[r.kind] || 'PANEL BAN'
}

function nounOf(kind, id) {
  const p = prefixOf(id)
  if (p === 'ban') return 'game ban list entry'
  if (p === 'abn') return { tempban: 'panel tempban', ipban: 'panel IP ban' }[kind] || 'panel ban'
  return { warn: 'warning', strike: 'strike', suspend: 'suspension', ban: 'game ban', discord_ban: 'Discord ban', discord_timeout: 'Discord timeout' }[kind] || kind
}

function charOf(r) {
  const t = r.target || {}
  const profile = hasProfile(t.profileId) ? `profile ${t.profileId}` : null
  if (!t.name && !t.tag) return profile || '—'
  return `${t.name || '?'}${t.tag ? ` #${t.tag}` : ''}${profile ? ` (${profile})` : ''}`
}

function sourceOf(r) {
  if (r.source === 'discipline') return r.outside ? `config record ${r.outside}` : 'game discipline'
  if (r.source === 'bans') return 'game ban list'
  if (r.source === 'journal') return r.via === 'dashboard' ? 'dashboard' : r.via === 'bot' ? 'Discord bot' : 'Discord client'
  return 'F7 panel'
}

function duration(r, x) {
  if (r.kind === 'warn') return `no expiry; shown as active for ${x.warnDays} days`
  if (r.kind === 'strike') {
    const due = x.strikes >= x.review ? ' — Lead GM review due' : ''
    return `counts until ${ts(r.atMs + x.strikeDays * DAY_MS, 'D')}; ${x.strikes} of ${x.review} in ${x.strikeDays} days${due}`
  }
  if (r.fromMs && r.fromMs > x.now) return `scheduled from ${ts(r.fromMs, 'f')} until ${ts(r.untilMs, 'f')}`
  if (r.untilMs) return `until ${ts(r.untilMs, 'f')} (${ts(r.untilMs, 'R')})`
  return r.kind === 'suspend' ? 'no end recorded' : 'permanent'
}

function issuer(r) {
  if (r.outside) return `config ${r.outside} (by ${r.by || 'unknown'})`
  const by = r.by || 'unknown'
  return r.via === 'dashboard' && !/ \(dashboard\)$/.test(by) ? `${by} (dashboard)` : by
}

function replyText(r, st, x) {
  const lines = [
    `**${label(r)}** · ${r.id}`,
    `Character: ${charOf(r)}`,
    `Issued by: ${issuer(r)}`,
    `When: ${ts(r.atMs, 'f')}`,
    `Duration: ${duration(r, x)}`,
    `Reason: ${r.reason || 'none given'}`,
    `Ticket: ${r.ticket || ticketOf(r.outside, r.reason) || 'none named'}`,
    `Source: ${sourceOf(r)}`,
  ]
  if (!IN_FORCE.has(st)) lines.push(`Now: ${st}`)
  return lines.join('\n')
}

const unmatchedText = r => `**LIFT/OVERTURN (unmatched)** · ${r.id} — ${r.kind} by ${r.by || 'unknown'} ${ts(r.atMs, 'f')}: ${r.reason || 'no reason given'}`
const byWhom = o => `by ${(o && o.by) || 'unknown'}: ${(o && o.reason) || 'no reason given'}`
const liftOf = (r, x) => (r.kind === 'overturn' && r.undid ? x.all.find(u => u.id === `dsc:${r.target.profileId}:${r.undid}` && u.kind === 'lift') || null : null)

// An overturned lift reinstates nothing in the game, but the decision is posted
function overturnedLiftText(r, lift, x) {
  const hold = lift.lifts ? x.all.find(u => u.id === `dsc:${r.target.profileId}:${lift.lifts}`) : null
  return `**OVERTURNED** · lift ${lift.id}${hold ? ` of ${nounOf(hold.kind, hold.id)} ${hold.id}` : ''} — ${byWhom(r)}`
}

function timeoutEnd(r, x) {
  const same = u => u.source === 'journal' && u._discordId && u._discordId === r._discordId && u.atMs >= r.atMs && u.id !== r.id
    && (!r.untilMs || u.atMs < r.untilMs)
  const end = x.all.find(u => u.kind === 'discord_timeout_end' && same(u))
  if (end) return `early by ${end.by || 'unknown'}`
  if (x.all.some(u => u.kind === 'discord_timeout' && same(u))) return 'replaced by a newer timeout'
  return `ran out ${ts(r.untilMs, 'f')}`
}

// The one update reply for a change of state; null when the change posts nothing (scheduled -> running)
function updateText(id, rec, r, st, x) {
  const noun = nounOf(rec.kind || (r && r.kind), id)
  switch (st) {
    case 'lifted': return `**LIFTED** · ${noun} ${id} — ${byWhom(r.lifted)}`
    case 'overturned': return `**OVERTURNED** · ${noun} ${id} — ${byWhom(r.overturned)}`
    case 'unbanned': {
      const u = prefixOf(id) === 'ban'
        ? x.all.find(j => j.source === 'journal' && j.kind === 'unban' && rec.ref && j.ref === rec.ref) || discordUnbanOf(x.key, rec.at, x)
        : discordUnbanOf(r && r._discordId, rec.at, x)
      if (u) return `**UNBANNED** · ${noun} ${id} — ${byWhom(u)}`
      return `**UNBANNED** · ${id} removed from the game ban list`
    }
    case 'ended':
      if (r.kind === 'discord_timeout') return `**TIMEOUT ENDED** · ${id} (${timeoutEnd(r, x)})`
      return `**ENDED** · ${noun} ${id} ran out ${ts(r.untilMs, 'f')}`
    case 'gone': return `**ENDED** · ${noun} ${id} is no longer on the F7 panel ban list`
    case 'expired': return `**EXPIRED** · strike ${id} stopped counting ${ts(r.atMs + x.strikeDays * DAY_MS, 'D')}`
    case 'aged': return `**WARNING aged out** of the ${x.warnDays}-day window · ${id}`
    default: return null
  }
}

function inForceLines(live, x) {
  const out = []
  for (const r of live) {
    if (r.kind === 'warn' || r.kind === 'strike') continue
    if (r.source === 'discipline' && r.kind === 'suspend') {
      out.push(r.fromMs && r.fromMs > x.now ? `Suspension scheduled from ${ts(r.fromMs, 'f')} (${r.id})` : `Suspended until ${ts(r.untilMs, 'f')} (${r.id})`)
    } else if (r.source === 'discipline') out.push(`Banned (game) since ${ts(r.atMs, 'f')} (${r.id})`)
    else if (r.source === 'bans') out.push(`On the game ban list (${r.id})`)
    else if (r.kind === 'discord_timeout') out.push(`Discord timeout until ${ts(r.untilMs, 'f')} (${r.id})`)
    else if (r.source === 'journal') out.push(`Discord banned (${r.id})`)
    else out.push(`${nounOf(r.kind, r.id)} ${r.untilMs ? `until ${ts(r.untilMs, 'f')}` : 'with no end'} (${r.id})`)
  }
  const strikes = live.filter(r => r.kind === 'strike')
  if (strikes.length) {
    const next = Math.min(...strikes.map(r => r.atMs + x.strikeDays * DAY_MS))
    out.push(`Strikes counting: ${x.strikes || strikes.length} of ${x.review}, next drops off ${ts(next, 'D')}`)
    if ((x.strikes || strikes.length) >= x.review) out.push('Lead GM review due')
  }
  const warns = live.filter(r => r.kind === 'warn').length
  if (warns) out.push(`Warnings in the last ${x.warnDays} days: ${warns}`)
  return out.map(l => `- ${l}`)
}

function characters(profileIds, id) {
  const out = []
  for (const p of profileIds) {
    for (const c of (id.chars && id.chars.get(p)) || []) if (c.status !== 'deleted' && c.name) out.push(`${c.name}${c.tag ? ` #${c.tag}` : ''}`)
  }
  return out.slice(0, 12)
}

function otherIds(key, profileIds, id) {
  if (!id.profileOf) return []
  return [...id.profileOf].filter(([d, p]) => d !== key && profileIds.includes(p)).map(([d]) => d)
}

// The live status summary; hash leaves out the "Last updated" line so an unchanged summary is not edited again
function starterText(key, acct, rows, x) {
  const name = acct.username || 'unknown'
  const lines = [key.startsWith('p:') ? `${key} · profile ${key.slice(2)} (no Discord link)` : `<@${key}> · ${name}`]
  if (acct.display && acct.display !== name) lines.push(`Display name: ${acct.display}`)
  if (acct.nick && acct.nick !== name) lines.push(`Server nickname: ${acct.nick}`)
  const ps = acct.profileIds || []
  if (ps.length) lines.push(`Profile${ps.length > 1 ? 's' : ''}: ${ps.join(', ')}`)
  const chars = characters(ps, x.id)
  if (chars.length) lines.push(`Characters: ${chars.join(', ')}`)
  const others = otherIds(key, ps, x.id)
  if (others.length) lines.push(`Other linked Discord accounts: ${others.map(d => `<@${d}>`).join(' ')}`)
  const held = Math.max(0, ...rows.map(r => r.alsoHolds || 0))
  if (held) lines.push(`+${held} held-out Discord account${held > 1 ? 's' : ''}`)
  const own = rows.filter(r => !isFold(r))
  const live = own.filter(r => IN_FORCE.has(stateOf(r, x)))
  lines.push('', `Status: **${live.length ? 'ACTIVE' : 'CLEAR'}**`)
  if (live.length) lines.push('In force now:', ...inForceLines(live, x))
  const count = test => own.filter(test).length
  lines.push('', `History: ${count(r => r.kind === 'warn')} warnings, ${count(r => r.kind === 'strike')} strikes, `
    + `${count(r => r.kind === 'suspend' || r.kind === 'tempban')} suspensions, ${count(r => ['ban', 'discord_ban', 'ipban'].includes(r.kind))} bans, `
    + `${count(r => r.kind === 'discord_timeout')} timeouts; lifted ${count(r => stateOf(r, x) === 'lifted')}, overturned ${count(r => stateOf(r, x) === 'overturned')}`)
  const footer = '-# Maintained by the punishment tracker; staff replies are welcome and ignored by the bot.'
  const hash = sha1(finish([...lines, footer].join('\n')))
  return { content: finish([...lines, '', `Last updated ${ts(x.now, 'R')}`, footer].join('\n')), hash }
}

const tagKind = r => (r.kind === 'warn' ? 'Warning' : r.kind === 'strike' ? 'Strike' : r.kind === 'suspend' || r.kind === 'tempban' ? 'Suspended'
  : r.kind === 'discord_timeout' ? 'Discord timeout' : 'Banned')

// Status, Review at 3 strikes, then the top 3 kinds in force (or recent once clear); a tag the forum lacks is left out
function tagNames(rows, x) {
  const own = rows.filter(r => !isFold(r))
  const live = own.filter(r => IN_FORCE.has(stateOf(r, x)))
  const basis = live.length ? live : own.filter(r => r.atMs && x.now - r.atMs < x.warnDays * DAY_MS)
  const kinds = KIND_TAGS.filter(k => basis.some(r => tagKind(r) === k)).slice(0, 3)
  return [live.length ? 'Active' : 'Expired', ...(x.strikes >= x.review ? ['Review'] : []), ...kinds]
}

const titleOf = name => [...String(name || 'unknown')].slice(0, TITLE_MAX).join('')

// ---- the reconciler ----
function createTracker({ snapshot, config = {}, now = Date.now, store, discord, fetch: doFetch, log = line => console.log(`[punish-tracker] ${line}`),
  staffStatusOf = null, audit = null, maxRequests = MAX_REQUESTS, gapMs = GAP_MS, sleep = wait }) {
  const s = settings(config)
  // Dry mode never asks Discord: a staff check there takes only an answer already cached by the panel, else unknown (hidden)
  const staffLookup = !staffStatusOf ? null : s.mode !== 'dry' ? staffStatusOf
    : async d => (typeof staffStatusOf.known === 'function' && staffStatusOf.known(d)) || 'unknown'
  // The audit channel posts to Discord, so only a tracker that is on uses it
  const alert = s.mode === 'on' && audit ? audit : null
  // Dry mode always writes to the file: no Discord writer or fetch handed in is ever used
  const writer = s.mode === 'dry' ? createDryWriter({ file: s.dryFile, now })
    : discord || createRestWriter({ token: s.token, fetch: doFetch, gapMs, now, sleep, log })
  const registry = store || fileStore(s.registryFile)
  let reg = null, fresh = false, busy = false, dirty = false, budget = 0
  let headroom = null, tagsAt = 0
  const noted = new Map()

  const note = (key, line, everyMs = Infinity) => {
    const at = noted.get(key)
    if (at !== undefined && now() - at < everyMs) return false
    noted.set(key, now())
    log(line)
    return true
  }
  const waitNote = why => {
    const line = `PUNISH-TRACKER waiting for thread headroom: ${why}`
    if (!note('headroom', line, HOUR_MS) || !alert) return
    try { alert(line) } catch (err) { log(`audit failed: ${err.message}`) }
  }
  // Discord's guild thread cap (160006): no thread is made or reopened until the next headroom check
  const capped = err => {
    if (err.code !== 160006) return false
    headroom = { at: now(), count: Infinity }
    waitNote('Discord refused to open a thread (160006)')
    return true
  }
  const save = () => { registry.save(reg); dirty = false }
  const emptyRegistry = () => ({ v: 1, forumId: s.forumId, tagIds: {}, accounts: {}, skip: { profiles: s.skip } })
  const newAccount = () => ({ threadId: null, title: null, username: null, usernameAt: 0, display: null, nick: null, profileIds: [], state: 'none', status: 'active', tags: [], rows: {} })
  const recordOf = r => ({ state: null, postedAt: null, msgId: null, kind: r.kind, at: r.atMs || null, ref: r.ref || null })

  async function call(method, p, body, opts) {
    if (budget <= 0) throw OUT
    budget--
    return writer.request(method, p, body, opts)
  }

  // Reopening a thread takes an active-thread slot like a new one, so a full guild (160006) holds it too
  async function unarchive(acct) {
    if (headroom && headroom.count === Infinity && now() - headroom.at <= CACHE_MS) throw new Error('the guild is at its thread cap; reopening waits for the next headroom check')
    await call('PATCH', `/channels/${acct.threadId}`, { archived: false }).catch(err => { capped(err); throw err })
    if (headroom) headroom.count++
    acct.state = 'open'
  }

  // A call into a thread that Discord archived on its own (50083): unarchive it and try once more
  async function threadCall(acct, method, p, body) {
    try {
      return await call(method, p, body)
    } catch (err) {
      if (err.code !== 50083) throw err
      await unarchive(acct)
      return call(method, p, body)
    }
  }

  async function loadTags() {
    if (tagsAt && now() - tagsAt < CACHE_MS) return
    try {
      const forum = await call('GET', `/channels/${s.forumId}`)
      const ids = Object.fromEntries(((forum && forum.available_tags) || []).filter(t => t && TAG_NAMES.includes(t.name)).map(t => [t.name, String(t.id)]))
      const sorted = o => JSON.stringify(Object.entries(o || {}).sort())
      // Tags made or changed on the forum reach every thread, a quiet one too, over the next ticks
      if (sorted(ids) !== sorted(reg.tagIds)) {
        for (const acct of Object.values(reg.accounts)) if (acct.threadId) acct.sync = true
        dirty = true
      }
      reg.tagIds = ids
      tagsAt = now()
    } catch (err) {
      if (err === OUT) throw err
      note('tags', `could not read the forum's tags, posting untagged: ${err.message}`, HOUR_MS)
    }
  }
  const tagsFor = (rows, x) => tagNames(rows, x).map(n => reg.tagIds && reg.tagIds[n]).filter(Boolean).slice(0, 5)

  async function roomForThread() {
    if (!s.guildId) return true
    if (!headroom || now() - headroom.at > CACHE_MS) {
      const active = await call('GET', `/guilds/${s.guildId}/threads/active`)
      headroom = { at: now(), count: active && Array.isArray(active.threads) ? active.threads.length : 0 }
    }
    return headroom.count <= s.headroom
  }

  async function lookupUser(key) {
    if (!s.guildId) return null
    let member = null
    try {
      member = await call('GET', `/guilds/${s.guildId}/members/${key}`)
    } catch (err) {
      if (err === OUT) throw err
      if (err.status !== 404) return null
    }
    if (member && member.user) return { username: member.user.username, display: member.user.global_name || null, nick: member.nick || null }
    // A banned user is no longer a member
    try {
      const user = await call('GET', `/users/${key}`)
      return user && user.username ? { username: user.username, display: user.global_name || null, nick: null } : null
    } catch (err) {
      if (err === OUT) throw err
      return null
    }
  }

  function localName(key, rows, x) {
    if (key.startsWith('p:')) return `profile ${key.slice(2)}`
    const name = (x.id.names && discordNameOf(x.id, key)) || rows.map(r => r.target && r.target.discordName).find(Boolean)
    return scrub(name, 40) || (x.profileIds.length ? `profile ${x.profileIds[0]}` : 'unknown user')
  }

  async function refreshName(key, acct, rows, x) {
    let found = null
    if (!key.startsWith('p:')) { found = await lookupUser(key); acct.nameTriedAt = x.now }
    if (found) Object.assign(acct, { usernameAt: x.now, display: scrub(found.display, TITLE_MAX) || null, nick: scrub(found.nick, TITLE_MAX) || null })
    const looked = found && scrub(found.username, TITLE_MAX)
    // A Discord account's title not from a lookup is a local fallback, chosen again each time until one succeeds
    const kept = acct.nameLocal ? null : acct.username
    acct.nameLocal = !looked && !kept && !key.startsWith('p:')
    const username = looked || kept || localName(key, rows, x)
    if (username !== acct.username) { acct.username = username; acct.sync = true }
    const title = titleOf(username)
    if (title === acct.title) return
    if (acct.threadId) { await threadCall(acct, 'PATCH', `/channels/${acct.threadId}`, { name: title }); acct.sync = true }
    acct.title = title
  }

  // The forum's threads by the marker on their starter: active ones (the guild list) and archived ones, oldest first.
  // Exempt from the tick's request budget, as it runs only on a lost registry or a thread stuck in 'creating'
  async function scanForum() {
    const threads = []
    if (s.guildId) {
      const active = await writer.request('GET', `/guilds/${s.guildId}/threads/active`)
      const all = (active && active.threads) || []
      headroom = { at: now(), count: all.length }
      threads.push(...all.filter(t => t && t.parent_id === s.forumId))
    }
    let before = ''
    for (let page = 0; page < 20; page++) {
      const got = await writer.request('GET', `/channels/${s.forumId}/threads/archived/public?limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`)
      const list = (got && got.threads) || []
      threads.push(...list)
      const last = list[list.length - 1]
      before = last && last.thread_metadata && last.thread_metadata.archive_timestamp
      if (!got || !got.has_more || !before) break
    }
    const found = new Map()
    const byAge = (a, b) => a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    for (const t of threads.filter(t => t && /^\d+$/.test(String(t.id))).sort(byAge)) {
      let first = null
      try { first = await writer.request('GET', `/channels/${t.id}/messages/${t.id}`) } catch { continue }
      const key = markerOf(first && first.content)
      if (key && !found.has(key)) found.set(key, { id: t.id, name: t.name || null, archived: !!(t.thread_metadata && t.thread_metadata.archived) })
    }
    return found
  }

  // Adopts the forum's threads for accounts that have none; on a first run the adopted accounts' rows count as posted
  async function recover(groups, g) {
    const found = await scanForum()
    for (const [key, t] of found) {
      const acct = reg.accounts[key] || (reg.accounts[key] = newAccount())
      if (acct.threadId && acct.state !== 'creating') continue
      Object.assign(acct, { threadId: t.id, title: t.name, state: t.archived ? 'archived' : 'open', sync: true })
      if (fresh) for (const r of groups.get(key) || []) if (!acct.rows[r.id]) acct.rows[r.id] = { ...recordOf(r), state: stateOf(r, g), baseline: true }
      log(`adopted thread ${t.id} for ${key.startsWith('p:') ? key : 'a Discord account'}`)
    }
    for (const acct of Object.values(reg.accounts)) if (acct.state === 'creating') Object.assign(acct, { state: 'none', threadId: null })
    save()
  }

  // First run: every row is seen already, except what is in force now, which opens its account's thread
  function baseline(groups, g) {
    for (const [key, rows] of groups) {
      const acct = reg.accounts[key] || (reg.accounts[key] = newAccount())
      for (const r of rows) {
        if (acct.rows[r.id]) continue
        const st = stateOf(r, g)
        if (isFold(r) || !IN_FORCE.has(st)) acct.rows[r.id] = { ...recordOf(r), state: st, baseline: true }
      }
    }
  }

  // A profile that gains a Discord link keeps its thread under the new key. If that account has a thread already, the
  // profile's records move into it and the profile's thread is closed with a pointer (retire)
  function rekey(groups, g) {
    for (const [key, rows] of groups) {
      if (key.startsWith('p:')) continue
      for (const old of profilesOf(key, rows, g).map(p => `p:${p}`)) {
        const from = reg.accounts[old], to = reg.accounts[key]
        if (!from || from.movedTo || from.state === 'creating') continue
        dirty = true
        if (!to) {
          reg.accounts[key] = Object.assign(from, { username: null, usernameAt: 0, sync: true })
          delete reg.accounts[old]
          continue
        }
        Object.assign(to, { rows: { ...from.rows, ...to.rows }, sync: true })
        to.profileIds = [...new Set([...(to.profileIds || []), ...(from.profileIds || [])])].sort((a, b) => a - b)
        if (!to.threadId && from.threadId) {
          Object.assign(to, { threadId: from.threadId, title: from.title, state: from.state, starterHash: null, tags: from.tags || [], username: null, usernameAt: 0 })
          delete reg.accounts[old]
        } else if (from.threadId) Object.assign(from, { rows: {}, movedTo: key })
        else delete reg.accounts[old]
      }
    }
  }

  async function retire(key, acct) {
    if (acct.threadId) {
      const ch = `/channels/${acct.threadId}`
      if (acct.state === 'archived') await unarchive(acct)
      if (!acct.starterGone) {
        const content = finish(`Moved: profile ${key.slice(2)} is now linked to <@${acct.movedTo}>; its records continue in that account's thread.`)
        await threadCall(acct, 'PATCH', `${ch}/messages/${acct.threadId}`, { content, allowed_mentions: NO_PINGS })
      }
      await call('PATCH', ch, { archived: true })
    }
    delete reg.accounts[key]
    save()
  }

  // A row an account already holds is never posted again under another (a key that changed back, or a merge)
  const heldElsewhere = (key, id) => Object.entries(reg.accounts).some(([k, a]) => k !== key && a.rows && a.rows[id])

  function profilesOf(key, rows, g) {
    const ps = new Set(rows.map(r => r.target && r.target.profileId).filter(hasProfile))
    if (!key.startsWith('p:') && g.id.profileOf && g.id.profileOf.has(key)) ps.add(g.id.profileOf.get(key))
    if (key.startsWith('p:')) ps.add(Number(key.slice(2)))
    return [...ps].sort((a, b) => a - b)
  }

  // The bot writes the ban list before the journal: a Discord ban with no journal row yet waits for its who and why
  const awaitsJournal = (r, x) => r.source === 'bans' && r.kind === 'discord_ban' && !r._journalId && Number.isFinite(r.atMs)
    && x.now - r.atMs < JOURNAL_WAIT_MS && !(x.journalAt >= r.atMs + JOURNAL_LAG_MS)

  // A Discord ban seen in a second store (the journal's row once the ban list's merged copy is gone) is the same ban
  function aliasOf(acct, r) {
    if (!acct || r.kind !== 'discord_ban' || !r.atMs) return null
    // One to one: a row that is already an alias, or already has one, is another ban
    const hit = Object.entries(acct.rows).find(([id, rec]) => id !== r.id && rec.kind === 'discord_ban' && prefixOf(id) !== prefixOf(r.id)
      && rec.at && Math.abs(rec.at - r.atMs) <= SAME_BAN_MS && !rec.alias && !Object.values(acct.rows).some(o => o.alias === id))
    return hit ? hit[0] : null
  }

  async function createThread(key, acct, rows, x) {
    if (!(await roomForThread())) {
      waitNote('new threads are held')
      return false
    }
    await loadTags()
    const { content, hash } = starterText(key, acct, rows, x)
    const tags = tagsFor(rows, x)
    const payload = { name: titleOf(acct.username), message: { content, allowed_mentions: NO_PINGS }, auto_archive_duration: 10080 }
    if (tags.length) payload.applied_tags = tags
    acct.state = 'creating'
    save()
    // Sent once: a thread made whose answer was lost is found by the marker scan, never made twice
    const post = body => call('POST', `/channels/${s.forumId}/threads`, body, { once: true, localTitle: !!acct.nameLocal })
    let thread
    try {
      try {
        thread = await post(payload)
      } catch (err) {
        if (err === OUT || !payload.applied_tags || (err.status !== 400 && err.status !== 403) || err.code === 160006) throw err
        note(`tags-${err.status}`, `the forum refused the tags (${err.status}); posting untagged`, HOUR_MS)
        // The refused tags are kept as applied, so they are not tried again until they change
        const { applied_tags: _refused, ...rest } = payload
        thread = await post(rest)
      }
    } catch (err) {
      // A definite answer means no thread was made; a lost one stays 'creating' for the marker scan
      if (err === OUT || (err.status && err.status < 500)) acct.state = 'none'
      save()
      if (capped(err)) return false
      throw err
    }
    if (headroom) headroom.count++
    Object.assign(acct, { threadId: String(thread.id), title: payload.name, state: 'open', starterHash: hash, starterGone: false, tags, status: tagNames(rows, x)[0] === 'Active' ? 'active' : 'expired', recreate: false })
    save()
    return true
  }

  async function postRow(key, acct, w, x) {
    const id = w.r ? w.r.id : w.id
    const content = finish(w.text || replyText(w.r, w.st, x))
    let msg = null, dropped = false
    try {
      msg = await threadCall(acct, 'POST', `/channels/${acct.threadId}/messages`, { content, allowed_mentions: NO_PINGS, nonce: nonceOf(key, id, w.st), enforce_nonce: true })
    } catch (err) {
      capped(err)
      if (!refusedForGood(err)) throw err
      note(`drop-${id}-${w.st}`, `Discord refused the post for ${id} (${w.st}) for good, dropped: ${err.message}`)
      dropped = true
    }
    acct.rows[id] = { ...(w.rec || recordOf(w.r)), state: w.st, postedAt: iso(now()), msgId: msg && msg.id ? String(msg.id) : null, ...(dropped ? { dropped } : {}) }
    save()
  }

  async function syncThread(key, acct, rows, x) {
    const ch = `/channels/${acct.threadId}`
    const { content, hash } = starterText(key, acct, rows, x)
    if (hash !== acct.starterHash && !acct.starterGone) {
      if (acct.state === 'archived') await unarchive(acct)
      try {
        await threadCall(acct, 'PATCH', `${ch}/messages/${acct.threadId}`, { content, allowed_mentions: NO_PINGS })
      } catch (err) {
        if (err.status !== 404 || err.code !== 10008) throw err
        // Staff deleted the starter and kept the thread: it cannot be edited again, the replies and tags go on
        acct.starterGone = true
        log(`the starter of the thread of ${key.startsWith('p:') ? key : 'a Discord account'} was deleted; it is no longer edited`)
      }
      acct.starterHash = hash
      save()
    }
    await loadTags()
    const tags = tagsFor(rows, x)
    const patch = {}
    if (!sameSet(tags, acct.tags || [])) patch.applied_tags = tags
    // An archived thread takes an edit only together with its unarchive; a clear one is archived again below
    if (patch.applied_tags && acct.state === 'archived') patch.archived = false
    else if (!x.inForce && acct.state !== 'archived') patch.archived = true
    if (Object.keys(patch).length) {
      try {
        await threadCall(acct, 'PATCH', ch, patch)
        if ('archived' in patch) acct.state = patch.archived ? 'archived' : 'open'
      } catch (err) {
        // A full guild or a thread still archived is not a refusal of the tags: they are tried again later
        if (err === OUT || capped(err) || NOT_FINAL.has(err.code) || !patch.applied_tags || (err.status !== 400 && err.status !== 403)) throw err
        note(`tags-${err.status}`, `the forum refused the tags (${err.status}); left as they were`, HOUR_MS)
        if (patch.archived === true) { await call('PATCH', ch, { archived: true }); acct.state = 'archived' }
      }
      acct.tags = tags
    }
    if (!x.inForce && acct.state !== 'archived') { await call('PATCH', ch, { archived: true }); acct.state = 'archived' }
    Object.assign(acct, { status: x.inForce ? 'active' : 'expired', sync: false, recreate: false })
    save()
  }

  async function account(key, rows, g) {
    let acct = reg.accounts[key]
    if (acct && acct.movedTo && !rows.length) return retire(key, acct)
    const profileIds = profilesOf(key, rows, g)
    const strikes = profileIds.reduce((n, p) => n + ((g.strikes && g.strikes.get(p)) || 0), 0)
    const x = { ...g, key, profileIds, strikes, inForce: rows.some(r => !isFold(r) && IN_FORCE.has(stateOf(r, g))) }
    const frozen = id => g.frozen(SOURCE_OF[prefixOf(id)])
    // A frozen source's row held in force but not read as in force: the starter, tags and archive wait until it reads again
    const held = !!acct && Object.entries(acct.rows).some(([id, rec]) => frozen(id) && IN_FORCE.has(rec.state)
      && !rows.some(r => r.id === id && IN_FORCE.has(stateOf(r, x))))
    const work = [], quiet = [], unlinked = new Set()
    for (const r of rows) {
      if (frozen(r.id) || awaitsJournal(r, x)) continue
      const st = stateOf(r, x)
      const rec = acct && acct.rows[r.id]
      if (!rec) {
        if (heldElsewhere(key, r.id)) continue
        // A row older than the first run's baseline that is not in force (a source or account first seen later) is history
        const old = g.baseAt && (!r.atMs || r.atMs < g.baseAt) && !IN_FORCE.has(st)
        const alias = old || st === 'unmatched' || isFold(r) ? null : aliasOf(acct, r)
        const lift = old ? null : liftOf(r, x)
        if (old) quiet.push({ id: r.id, st, base: recordOf(r), extra: { baseline: true } })
        else if (st === 'unmatched') work.push({ r, st, text: unmatchedText(r), isNew: true })
        else if (lift) work.push({ r, st, text: overturnedLiftText(r, lift, x) })
        else if (isFold(r) || alias) quiet.push({ id: r.id, st, base: recordOf(r), extra: alias ? { alias } : {} })
        else work.push({ r, st, isNew: true })
      } else if (prefixOf(r.id) === 'ban' && (rec.kind !== r.kind || (r.atMs && rec.at && Math.abs(r.atMs - rec.at) > SAME_BAN_MS))) {
        // bans.js add() replaces a ban under the same ref: a new punishment
        work.push({ r, st, isNew: true })
        if (r.kind !== 'discord_ban') unlinked.add(r.id)
      } else if (rec.state !== st) {
        const text = !rec.alias && RANK[st] >= RANK[rec.state] ? updateText(r.id, rec, r, st, x) : null
        if (text) work.push({ r, rec, st, text })
        else quiet.push({ id: r.id, st, base: rec })
      }
    }
    if (acct) {
      for (const [id, rec] of Object.entries(acct.rows)) {
        const st = GONE_STATE[prefixOf(id)]
        if (!st || g.ids.has(id) || frozen(id) || !IN_FORCE.has(rec.state)) continue
        const text = rec.alias ? null : updateText(id, rec, null, st, x)
        if (text) work.push({ id, rec, st, text })
        else quiet.push({ id, st, base: rec })
      }
    }
    const isNew = work.some(w => w.isNew)
    // A failed lookup is tried again after CACHE_MS, not every tick
    const due = !!(acct && acct.threadId && !key.startsWith('p:') && s.guildId && x.now - (acct.usernameAt || 0) > NAME_TTL_MS && x.now - (acct.nameTriedAt || 0) > CACHE_MS)
    const recreate = !!(acct && acct.recreate && x.inForce)
    if (!work.length && !quiet.length && !(acct && acct.threadId && ((acct.sync && !held) || due)) && !recreate) return
    if (!acct) acct = reg.accounts[key] = newAccount()
    acct.profileIds = [...new Set([...(acct.profileIds || []), ...profileIds])].sort((a, b) => a - b)
    for (const q of quiet) acct.rows[q.id] = { ...q.base, ...q.extra, state: q.st }
    // A Discord ban that was the same ban as a replaced entry stands alone again, so its unban posts
    for (const rec of Object.values(acct.rows)) if (unlinked.has(rec.alias)) delete rec.alias
    dirty = true
    // Changes on an account with no thread are only recorded; a new punishment opens one
    if (!acct.threadId && !isNew && !recreate) {
      for (const w of work) acct.rows[w.r ? w.r.id : w.id] = { ...(w.rec || recordOf(w.r)), state: w.st }
      acct.sync = false
      return
    }
    if (work.length || quiet.length) acct.sync = true
    if (isNew || due || !acct.username) await refreshName(key, acct, rows, x)
    if (!acct.threadId) {
      if (!(await createThread(key, acct, rows, x))) return
    } else if (work.length && acct.state === 'archived') {
      if (!(await roomForThread())) {
        waitNote('reopened threads are held')
        return
      }
      await unarchive(acct)
    }
    const at = w => (w.r ? w.r.atMs : w.rec.at) || 0
    for (const w of work.sort((a, b) => Number(!a.isNew) - Number(!b.isNew) || at(a) - at(b))) await postRow(key, acct, w, x)
    if (acct.sync && !held) await syncThread(key, acct, rows, x)
  }

  async function groupRows(snap, g) {
    const groups = new Map(), hidden = new Set()
    for (const r of snap.rows) {
      if (!inScope(r) || (r.target && s.skip.includes(r.target.profileId))) continue
      const key = keyOf(r)
      if (!key) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(r)
    }
    for (const rows of groups.values()) rows.sort((a, b) => (a.atMs || 0) - (b.atMs || 0))
    // As the panel does for a GM: a staff member's records are left out, and so are those of an account with no Discord
    // link or that Discord gave no answer on
    if (s.hideStaff) {
      if (s.mode === 'dry') note('dry-staff', 'dry run: staff targets are checked against cached answers only, the rest are left out')
      for (const key of [...groups.keys()]) {
        const status = key.startsWith('p:') || !staffLookup ? 'unknown' : await staffLookup(key).catch(() => 'unknown')
        if (status !== 'player') { groups.delete(key); hidden.add(key) }
      }
    }
    return { groups, hidden, g }
  }

  async function run() {
    if (!reg) {
      let loaded
      try { loaded = registry.load() } catch (err) {
        note('load', `the registry cannot be read, nothing is posted: ${err.message}`, HOUR_MS)
        return
      }
      reg = loaded || emptyRegistry()
      fresh = !loaded
    }
    const snap = snapshot()
    // Without the profile links every record would key to its profile alone: a second thread and every post again
    const idStatus = (snap.id && snap.id.status) || {}
    const badId = ['profiles', 'players'].filter(k => idStatus[k] && idStatus[k] !== 'ok')
    if (badId.length) { note('identity', `nothing is posted while ${badId.join(' and ')} cannot be read`, HOUR_MS); return }
    const d = (snap.cfg && snap.cfg.discipline) || {}
    const sources = snap.sources || {}
    const g = {
      now: now(), warnDays: s.warnDays, strikeDays: d.strikeDays || 90, review: d.strikesForReview || 3, id: snap.id || {},
      all: snap.rows, ids: new Set(snap.rows.map(r => r.id)), strikes: snap.strikes || new Map(), baseAt: Date.parse(reg.baselinedAt) || 0,
      // A source not read cleanly this tick is frozen: no new post, no ended and no unbanned from it
      frozen: k => !sources[k] || sources[k].status !== 'ok',
      // How far the journal has been read: its newest row, or a ban list row that took one in
      journalAt: snap.rows.reduce((t, r) => (r.source === 'journal' || r._journalId) && r.atMs > t ? r.atMs : t, 0),
    }
    budget = maxRequests
    const { groups, hidden } = await groupRows(snap, g)
    try {
      if (fresh) {
        const bad = Object.values(SOURCE_OF).filter(k => sources[k] && sources[k].status === 'unreadable')
        if (bad.length) { note('fresh', `the first run waits until ${bad.join(', ')} can be read`, HOUR_MS); return }
        await recover(groups, g)
        baseline(groups, g)
        reg.baselinedAt = iso(g.now)
        g.baseAt = g.now
        fresh = false
        save()
      } else if (Object.values(reg.accounts).some(a => a.state === 'creating')) await recover(groups, g)
      reg.skip = { profiles: s.skip }
      rekey(groups, g)
      if (Object.values(reg.accounts).some(a => a.threadId)) await loadTags()
      for (const key of new Set([...groups.keys(), ...Object.keys(reg.accounts)])) {
        if (hidden.has(key)) continue
        try {
          await account(key, groups.get(key) || [], g)
        } catch (err) {
          if (err === OUT) break
          if (threadGone(err)) {
            // Deleted by staff: dropped, and opened again with the history in its starter while anything is in force
            Object.assign(reg.accounts[key], { threadId: null, state: 'none', starterHash: null, tags: [], recreate: true })
            dirty = true
            log(`the thread of ${key.startsWith('p:') ? key : 'a Discord account'} is gone; it is opened again while anything is in force`)
          } else note(`account-${key}`, `${key.startsWith('p:') ? key : 'a Discord account'}: ${err.message}`, HOUR_MS)
        }
      }
    } finally {
      if (dirty) save()
    }
  }

  async function tick() {
    if (s.mode === 'off' || busy) return false
    busy = true
    try {
      await run()
      return true
    } catch (err) {
      note(`tick-${err.message}`, `tick failed: ${err.message}`, HOUR_MS)
      return false
    } finally {
      busy = false
    }
  }

  return { tick, mode: s.mode, registry: () => reg }
}

// From server.js once the backend listens: the panel's own service, the real writer (or the dry file) and a 30 s tick
function start({ config = require('../../config'), punishments, staffStatusOf, audit, log } = {}) {
  const s = settings(config)
  if (s.mode === 'off') return null
  const say = log || (line => console.log(`[punish-tracker] ${line}`))
  if (s.mode === 'on' && (!s.token || !s.guildId)) { say('PUNISH_TRACKER=on needs DISCORD_BOT_TOKEN and DISCORD_GUILD_ID; not started'); return null }
  const service = punishments || (() => require('../../routes/site-punish').internals.punishments())
  const tracker = createTracker({
    snapshot: () => service().trackerSnapshot(), config, log: say,
    staffStatusOf: staffStatusOf || (s.hideStaff ? require('./tier').staffStatusOf : null),
    audit: s.mode !== 'on' ? null : audit || (line => require('../discord/audit').log(line)),
  })
  const timer = setInterval(() => { tracker.tick() }, TICK_MS)
  timer.unref()
  const first = setTimeout(() => { tracker.tick() }, 5000)
  first.unref()
  say(`started (${s.mode})`)
  return { ...tracker, stop: () => { clearInterval(timer); clearTimeout(first) } }
}

module.exports = { createTracker, start, createRestWriter, createDryWriter, fileStore, settings, parseMode, markerOf, finish, nonceOf, tagNames }
