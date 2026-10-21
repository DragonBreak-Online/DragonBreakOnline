'use strict'
// The Punishments panel's actions (routes/site-punish-actions.js): a game ban and unban on the backend's own ban list
// (data/bans.json), Discord timeouts and bans through the bot, and a punish-only path into the remote console for
// /discipline and /kick. Each runs the console's checks (switch, fresh sign-in, pin, roles asked of Discord now, one run
// per request id, limits, audit before acting) and the panel's own (own account, staff of the same or a higher rank).
// No answer, audit line or job view carries the target's Discord id, an address or a hwid.

const nodeFs = require('fs')
const path = require('path')
const rules = require('../console/allowlist')
const { SIGN_IN_URL, withDeadline } = require('../console/staffConsole')
const { replaceFile } = require('../storeFile')
const { cleanReason, REASON_MIN, REASON_MAX } = require('./reason')

const ALL = Object.freeze(['owner', 'dev', 'leadgm'])
const SENIOR = Object.freeze(['owner', 'dev'])
// area: the switch key; tiers: who may; keys: the body's own fields; family: the site-wide hourly limit it counts against
const ACTIONS = Object.freeze({
  send: { area: 'send', tiers: ALL, keys: ['command'], confirm: 'SEND' },
  ban: { area: 'bans', tiers: SENIOR, keys: ['reason'], confirm: 'BAN', family: 'bans' },
  unban: { area: 'bans', tiers: SENIOR, keys: ['reason'], confirm: 'UNBAN', family: 'bans' },
  'discord-timeout': { area: 'discord', tiers: ALL, keys: ['minutes', 'reason'], confirm: 'TIMEOUT', family: 'timeouts', perm: 'moderateMembers', permission: 'ModerateMembers' },
  'discord-timeout-end': { area: 'discord', tiers: ALL, keys: ['reason'], confirm: 'END TIMEOUT', family: 'timeouts', perm: 'moderateMembers', permission: 'ModerateMembers' },
  'discord-ban': { area: 'discord', tiers: SENIOR, keys: ['reason'], confirm: 'DISCORD BAN', family: 'discordBans', perm: 'banMembers', permission: 'BanMembers' },
  'discord-unban': { area: 'discord', tiers: SENIOR, keys: ['reason'], confirm: 'DISCORD UNBAN', family: 'discordBans', perm: 'banMembers', permission: 'BanMembers' },
})
const TIER_LABEL = Object.freeze({ owner: 'Owner', dev: 'Dragon Break Dev', leadgm: 'Lead GM', gm: 'GM' })
const PUNISH_COMMANDS = Object.freeze(['discipline', 'kick'])
// The console's #TAG (allowlist.js TAG_RE), the first word after /discipline and /kick
const TAG_RE = /^#[A-Za-z0-9]{4}$/
// Discord's longest timeout, 28 days; an end past it from Discord's own clock is refused, so the longest ends a minute short
const MAX_MINUTES = 40320
const CAP_MARGIN_MS = 60 * 1000
const PRESETS = Object.freeze([10, 60, 360, 1440, 4320, 10080, 40320])
const LIMITS = Object.freeze({ triesPer10Min: 20, perMinute: 5, perHour: 30, sitePerHour: Object.freeze({ bans: 10, discordBans: 10, timeouts: 30 }) })
const JOBS_KEPT = 200
const MINUTE = 60 * 1000
const DISCORD_DEADLINE_MS = 10 * 1000
const MEMBER_DEADLINE_MS = 8000
const AREAS = Object.freeze(['bans', 'discord', 'send'])
const SWITCH_OPEN = nodeFs.constants.O_RDONLY | (nodeFs.constants.O_NOFOLLOW || 0) | (nodeFs.constants.O_NONBLOCK || 0)
const SWITCH_MAX_BYTES = 64
const STATES = new Set(['running', 'done', 'dry-run', 'failed', 'unknown', 'notRun'])
// Discord's error codes: [status, error, detail]
const DISCORD_ERRORS = Object.freeze({
  50013: [502, 'discordRefused', 'missingPermission'], 10007: [409, 'notInGuild'], 10013: [404, 'notFound'],
  10026: [409, 'notBanned'], 50035: [400, 'badMinutes'],
})
const specOf = action => (Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null)
const isDiscordCopy = e => !!e && e.reason === 'discord ban' && e.bannedBy === 'discord'
const iso = t => (Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null)
const utc = t => `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`
const duration = m => (m % 1440 === 0 ? `${m / 1440} d` : m % 60 === 0 ? `${m / 60} h` : `${m} min`)
const narrower = (a, b) => rules.SETTINGS[Math.min(rules.SETTINGS.indexOf(a), rules.SETTINGS.indexOf(b))]
// A timeout's end in whole seconds: at least the minutes asked for, never past the cap less the margin
const endOf = (at, minutes) => Math.min(Math.ceil((at + minutes * MINUTE) / 1000) * 1000, Math.floor((at + MAX_MINUTES * MINUTE - CAP_MARGIN_MS) / 1000) * 1000)

// 'off | dry-run | on' then bans=, discord= and send= that only narrow it, in at most 64 bytes; anything else is off
function parseActionsSwitch(text) {
  const OFF = { bans: 'off', discord: 'off', send: 'off' }
  if (typeof text !== 'string' || Buffer.byteLength(text) > SWITCH_MAX_BYTES) return OFF
  const body = text.replace(/\r?\n$/, '')
  if (/[\r\n]/.test(body)) return OFF
  const words = body.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length || !rules.SETTINGS.includes(words[0])) return OFF
  const out = { bans: words[0], discord: words[0], send: words[0] }
  const keys = new Set()
  for (const w of words.slice(1)) {
    const m = /^(bans|discord|send)=(off|dry-run|on)$/.exec(w)
    if (!m || keys.has(m[1])) return OFF
    keys.add(m[1])
    out[m[1]] = narrower(out[m[1]], m[2])
  }
  return out
}

// The body's fields for one action, or { error, why? }
function parseBody(action, b) {
  const spec = specOf(action)
  if (!spec) return { error: 'notFound' }
  const want = ['requestId', 'profileId', ...spec.keys, 'confirm']
  const keys = b && typeof b === 'object' && !Array.isArray(b) ? Object.keys(b) : null
  if (!keys || keys.length !== want.length || !want.every(k => keys.includes(k))) return { error: 'badRequest' }
  if (typeof b.requestId !== 'string' || !rules.UUID_RE.test(b.requestId)) return { error: 'badRequest' }
  if (!Number.isSafeInteger(b.profileId) || b.profileId < 0) return { error: 'badProfile' }
  const out = { uuid: b.requestId.toLowerCase(), profileId: b.profileId, reason: null, minutes: null, command: null }
  if (spec.keys.includes('minutes')) {
    if (!Number.isSafeInteger(b.minutes) || b.minutes < 1 || b.minutes > MAX_MINUTES) return { error: 'badMinutes' }
    out.minutes = b.minutes
  }
  if (spec.keys.includes('reason')) {
    const r = cleanReason(b.reason)
    if (!r.reason) return { error: 'badReason', why: r.why }
    out.reason = r.reason
  }
  if (spec.keys.includes('command')) {
    if (typeof b.command !== 'string' || b.command.length > 600) return { error: 'badCommand' }
    out.command = b.command
  }
  if (b.confirm !== spec.confirm) return { error: 'badConfirm' }
  return out
}

// ---- the switch: PUNISH_ACTIONS, narrowed by the switch file when there is one --------------------------------
// The file's setting, or null when there is none
function fileSetting(config, fs) {
  const file = config.punishActionsSwitchFile
  if (!file) return null
  let text = null
  try {
    const fd = fs.openSync(file, SWITCH_OPEN)
    try {
      const st = fs.fstatSync(fd)
      text = st.isFile() && st.size <= SWITCH_MAX_BYTES ? fs.readFileSync(fd, 'utf8') : ''
    } finally { fs.closeSync(fd) }
  } catch (err) {
    if (err.code === 'ENOENT') return null
    text = ''
  }
  return parseActionsSwitch(text)
}
// Each area's setting now: { bans, discord, send }. Also read by the bot (discord/bot.js), whose guard of the game ban
// list is on only while the bans area is on
function actionsSettings(config, fs = nodeFs) {
  const env = parseActionsSwitch(config.punishActions)
  const file = fileSetting(config, fs)
  return Object.fromEntries(AREAS.map(a => [a, file ? narrower(env[a], file[a]) : env[a]]))
}

function createPunishActions({
  config, consoleApi, bot, bans, journal, audit, targetOf, profileIdOf, tierFromRoles, rankOfRoles, bannedRoleId = () => '',
  jobsFile, auditFile, fs = nodeFs, now = Date.now, log = (...a) => console.log('[punish-actions]', ...a),
  discordDeadlineMs = DISCORD_DEADLINE_MS, memberDeadlineMs = MEMBER_DEADLINE_MS, limits = LIMITS,
}) {
  const jobs = new Map()
  const queued = new Map()
  const windows = new Map()
  const seenAt = new Map()

  const settings = () => actionsSettings(config, fs)

  // ---- limits and refusal lines ------------------------------------------------------------------------------------
  // A sliding window per key; true when this call is over the limit (it is not counted then)
  function over(key, limit, ms) {
    const t = now()
    const list = (windows.get(key) || []).filter(x => t - x < ms)
    if (windows.size > 5000) windows.clear()
    if (list.length >= limit) { windows.set(key, list); return true }
    list.push(t)
    windows.set(key, list)
    return false
  }
  const say = text => { try { audit.log(text) } catch (err) { log('audit failed:', err.message) } }
  // The audit channel at most once a minute per account; the backend log for the rest, and for callers not yet known to be fresh
  function refusal(discordId, handle, reqId, action, code, loud) {
    const line = `PUNISH refused ${handle || '-'} (<@${rules.SNOWFLAKE.test(String(discordId || '')) ? discordId : '-'}>) req ${reqId ? rules.id8(`w-${reqId}`) : '-'} ${action} ${code}`
    const key = `${loud ? 'd' : `q:${code}`}:${discordId}`
    if (seenAt.size > 5000) seenAt.clear()
    if (now() - (seenAt.get(key) || 0) < MINUTE) { log(line); return }
    seenAt.set(key, now())
    if (loud) say(line)
    else log(line)
  }

  const answer = (status, body) => ({ status, body })
  const error = (status, code, extra = {}) => answer(status, { v: 1, error: code, ...extra })

  // ---- the job store and the audit file ---------------------------------------------------------------------------
  const targetText = t => (t.name && t.tag ? `${t.name} #${t.tag} (profile ${t.profileId})` : `profile ${t.profileId}`)
  function what(j) {
    const t = targetText(j.target)
    switch (j.action) {
      case 'ban': return `game ban (permanent) on ${t}`
      case 'unban': return `game unban of ${t}`
      case 'discord-timeout': return `Discord timeout on ${t}, ${duration(j.minutes)} until ${utc(j.untilMs)}`
      case 'discord-timeout-end': return `end of the Discord timeout on ${t}`
      case 'discord-ban': return `Discord ban on ${t}`
      case 'discord-unban': return `Discord unban of ${t}`
      default: return `${j.action} on ${t}`
    }
  }
  const DONE_TEXT = {
    ban: j => `Banned from the game as ${j.ref}. They cannot log in again until unbanned; anyone online stays until they leave.`,
    unban: j => `Lifted ${j.ref} from the game ban list.${j.banRoleHeld ? ' They still hold the ban role: remove it in Discord.' : ''}`,
    'discord-timeout': j => `Timed out on Discord until ${utc(j.untilMs)}. No effect in game.`,
    'discord-timeout-end': () => 'The Discord timeout was taken off.',
    'discord-ban': () => 'Banned on Discord. The game ban list gets its copy from the bot.',
    'discord-unban': () => 'Unbanned on Discord.',
  }
  function summary(j) {
    if (j.state === 'done') return (DONE_TEXT[j.action] || (() => 'Done.'))(j)
    if (j.state === 'dry-run') return 'Dry run: every check passed; nothing was done.'
    if (j.state === 'unknown') return 'Discord did not answer; check Discord and #staff-commands before trying again.'
    if (j.state === 'notRun') return 'The backend restarted before this ran; it was not done.'
    if (j.state === 'failed') return `Not done: ${j.error || 'failed'}.`
    return 'Running.'
  }
  const view = j => ({
    id: j.uuid, action: j.action, state: j.state, error: j.error || '', target: { ...j.target }, ref: j.ref || null, reason: j.reason,
    minutes: j.minutes ?? null, until: iso(j.untilMs), banRoleHeld: j.banRoleHeld ?? null, by: j.handle, at: iso(j.at), summary: summary(j),
  })

  function saveJobs() {
    try {
      fs.mkdirSync(path.dirname(jobsFile), { recursive: true })
      replaceFile(jobsFile, `${JSON.stringify({ v: 1, jobs: [...jobs.values()].slice(-JOBS_KEPT) })}\n`, { mode: 0o600 })
    } catch (err) { log('jobs not saved:', err.message) }
  }
  function loadJobs() {
    let saved = []
    try { saved = JSON.parse(fs.readFileSync(jobsFile, 'utf8')).jobs } catch { return }
    const str = (v, max) => rules.foldText(v, max)
    for (const j of Array.isArray(saved) ? saved.slice(-JOBS_KEPT) : []) {
      if (typeof j?.uuid !== 'string' || !rules.UUID_RE.test(j.uuid) || !specOf(j.action) || j.action === 'send' || !STATES.has(j.state)) continue
      if (!rules.SNOWFLAKE.test(String(j.discordId)) || !rules.SNOWFLAKE.test(String(j.targetDiscordId))) continue
      const t = j.target || {}
      jobs.set(`p-${j.uuid}`, {
        uuid: j.uuid, action: j.action, state: j.state, error: str(j.error, 32), discordId: j.discordId, handle: rules.cleanHandle(j.handle),
        tier: TIER_LABEL[j.tier] ? j.tier : 'gm', targetDiscordId: j.targetDiscordId, profileId: Number(j.profileId) || 0,
        target: { profileId: Number(t.profileId) || 0, name: str(t.name, 48) || null, tag: str(t.tag, 4) || null, discordName: str(t.discordName, 40) || null },
        reason: str(j.reason, REASON_MAX), minutes: Number.isSafeInteger(j.minutes) ? j.minutes : null, untilMs: Number(j.untilMs) || null,
        ref: rules.foldText(j.ref, 8) || null, banRoleHeld: typeof j.banRoleHeld === 'boolean' ? j.banRoleHeld : null, at: Number(j.at) || 0, mode: str(j.mode, 8),
        status: Number.isInteger(j.status) && j.status >= 400 && j.status <= 599 ? j.status : null, detail: str(j.detail, 32) || null,
      })
    }
  }
  loadJobs()
  const remember = j => {
    const id = `p-${j.uuid}`
    jobs.delete(id)
    jobs.set(id, j)
    for (const k of jobs.keys()) { if (jobs.size <= JOBS_KEPT) break; jobs.delete(k) }
    saveJobs()
  }
  // One line per accepted action and per result; the staff member's id stays in this 0600 file on the server
  function record(j) {
    try {
      fs.mkdirSync(path.dirname(auditFile), { recursive: true })
      fs.appendFileSync(auditFile, `${JSON.stringify({
        at: new Date(now()).toISOString(), req: j.uuid, action: j.action, by: { handle: j.handle, discordId: j.discordId },
        target: { profileId: j.target.profileId, tag: j.target.tag }, reason: j.reason, minutes: j.minutes, until: iso(j.untilMs),
        state: j.state, error: j.error || null, ref: j.ref || null, mode: j.mode,
      })}\n`, { mode: 0o600 })
    } catch (err) { log('audit file not written:', err.message) }
  }
  function staffLine(j) {
    const t = new Date(now()).toISOString().slice(11, 19)
    try {
      audit.staff(`[${t}] ${j.handle} <@${j.discordId}> (${TIER_LABEL[j.tier] || j.tier}): ${what(j)}: ${j.reason}${j.state === 'unknown' ? ' (Discord did not answer)' : ''} [dashboard ${rules.id8(`w-${j.uuid}`)}]`)
    } catch (err) { log('staff line failed:', err.message) }
  }
  function finish(j) {
    remember(j)
    record(j)
    say(`PUNISH req ${rules.id8(`w-${j.uuid}`)} -> ${j.state}${j.error ? ` (${j.error})` : ''}${j.ref ? `: ref ${j.ref}` : ''}`)
    if (j.state === 'done' || j.state === 'unknown') staffLine(j)
  }
  // The answer's status is kept with the job, so the same request id again gets the same answer
  function failed(j, status, code, detail) {
    Object.assign(j, { state: 'failed', error: code, status, detail: detail || null })
    finish(j)
    return [status, code, detail]
  }
  const failedAnswer = j => answer(j.status, { v: 1, error: j.error, ...(j.detail ? { code: j.detail } : {}), job: view(j) })

  // ---- who is asking --------------------------------------------------------------------------------------------
  // Before the body is read: the switch, the console's config, the session, tries, a fresh sign-in, the pin, the roles now
  async function authorize(token, action) {
    const spec = specOf(action)
    if (!spec) return { refused: error(404, 'notFound') }
    const mode = settings()[spec.area]
    if (mode === 'off') return { refused: error(503, 'actionsOff') }
    const api = consoleApi()
    if (api.config.problem) return { refused: error(503, 'unavailable') }
    const caller = api.webCaller(token)
    if (!caller) return { refused: error(401, 'signedOut') }
    const { discordId } = caller
    const quiet = (status, code, extra) => { refusal(discordId, '-', '', action, code, false); return { refused: error(status, code, extra) } }
    if (over(`tries:${discordId}`, limits.triesPer10Min, 10 * MINUTE)) return quiet(429, 'tooMany')
    if (!api.isFresh(caller)) return quiet(401, 'signInAgain', { signInUrl: SIGN_IN_URL })
    const loud = (status, code, handle) => { refusal(discordId, handle, '', action, code, true); return { refused: error(status, code) } }
    if (!api.config.pins.has(discordId)) return loud(403, 'notAllowed', '-')
    const member = await withDeadline(bot.getMemberFresh(discordId), memberDeadlineMs)
    const roles = member && Array.isArray(member.roles) ? member.roles.map(String).filter(r => rules.SNOWFLAKE.test(r)).slice(0, 100) : []
    const handle = member ? rules.cleanHandle(member.handle) : '-'
    const tier = member ? tierFromRoles(roles) : null
    if (!tier || !spec.tiers.includes(tier)) return loud(403, 'notAllowed', handle)
    let profileId
    try { profileId = profileIdOf(discordId) } catch (err) { log('profile store unreadable:', err.message); return loud(503, 'unavailable', handle) }
    return { ctx: { caller, discordId, handle, tier, rank: rankOfRoles(roles), profileId: Number.isSafeInteger(profileId) ? profileId : null, mode } }
  }

  // The account, never the caller's own, and not staff of the caller's rank or higher; { t, member } or { refused }
  async function targetChecks(ctx, profileId, refuse) {
    let t
    try { t = targetOf(profileId) } catch (err) { log('identity unreadable:', err.message); return { refused: refuse(503, 'unavailable') } }
    if (!t) return { refused: refuse(404, 'notFound') }
    if ((ctx.profileId !== null && t.profileId === ctx.profileId) || t.discordId === ctx.discordId) return { refused: refuse(403, 'ownAccount') }
    if (!t.discordId) return { t, member: { state: 'absent' } }
    const member = (await withDeadline(bot.memberState(t.discordId), memberDeadlineMs)) || { state: 'unknown' }
    if (member.state === 'unknown') return { refused: refuse(503, 'discordUnavailable') }
    const rank = member.state === 'member' ? rankOfRoles(member.roles || []) : 0
    if (rank > 0 && rank >= ctx.rank) return { refused: refuse(403, 'staffTarget') }
    return { t, member }
  }

  // ---- the actions ------------------------------------------------------------------------------------------------
  async function perform(ctx, action, raw) {
    const b = parseBody(action, raw)
    const refuse = (status, code, extra) => { refusal(ctx.discordId, ctx.handle, b.uuid, action, code, true); return error(status, code, extra) }
    if (b.error) return refuse(400, b.error, b.why ? { why: b.why } : {})
    if (action === 'send') return send(ctx, b, refuse)
    // Requests with one id run one after another, so a second copy finds the first one's job
    const id = `p-${b.uuid}`
    const prior = queued.get(id) || Promise.resolve()
    const mine = prior.then(() => performOnce(ctx, action, b, id, refuse))
    const tail = mine.catch(() => {})
    queued.set(id, tail)
    tail.then(() => { if (queued.get(id) === tail) queued.delete(id) })
    return mine
  }

  async function performOnce(ctx, action, b, id, refuse) {
    const spec = specOf(action)
    // One run per request id, before anything about the account is asked again
    const known = jobs.get(id)
    if (known) {
      const same = known.discordId === ctx.discordId && known.action === action && known.profileId === b.profileId && known.reason === b.reason && known.minutes === b.minutes
      if (!same) return refuse(409, 'conflict')
      return known.state === 'failed' && known.status ? failedAnswer(known) : answer(200, { v: 1, job: view(known) })
    }

    const found = await targetChecks(ctx, b.profileId, refuse)
    if (found.refused) return found.refused
    const { t, member } = found
    if (!t.discordId) return refuse(404, 'noDiscordAccount')

    // The bot, from its cache only, before any Discord write
    if (spec.perm) {
      const m = bot.botModeration()
      if (!m.ready) return refuse(503, 'botNotReady')
      if (!m[spec.perm]) return refuse(503, 'botLacksPermission', { permission: spec.permission })
    }
    const pre = await precheck(action, t, member, refuse)
    if (pre) return pre

    // Accepted actions only: per account and site-wide per hour
    if (over(`min:${ctx.discordId}`, limits.perMinute, MINUTE) || over(`hour:${ctx.discordId}`, limits.perHour, 60 * MINUTE)
      || over(`site:${spec.family}`, limits.sitePerHour[spec.family], 60 * MINUTE)) return refuse(429, 'tooMany')

    // The record and the audit line, before anything is done
    const at = now()
    const job = {
      uuid: b.uuid, action, state: 'running', error: '', discordId: ctx.discordId, handle: ctx.handle, tier: ctx.tier, targetDiscordId: t.discordId,
      profileId: b.profileId, target: { profileId: t.profileId, name: t.name || null, tag: t.tag || null, discordName: t.discordName || null },
      reason: b.reason, minutes: b.minutes, untilMs: b.minutes ? endOf(at, b.minutes) : null,
      ref: null, banRoleHeld: null, at, mode: ctx.mode, wasUntil: member.timedOutUntil || 0, tags: t.tags || [],
    }
    remember(job)
    record(job)
    say(`PUNISH ${ctx.handle} (<@${ctx.discordId}>) via web req ${rules.id8(`w-${b.uuid}`)}: ${what(job)}${ctx.mode === 'dry-run' ? ' (dry run)' : ''}: ${b.reason}`)
    if (ctx.mode === 'dry-run') { job.state = 'dry-run'; finish(job); return answer(200, { v: 1, job: view(job) }) }

    await act(job, member)
    return job.state === 'failed' && job.status ? failedAnswer(job) : answer(200, { v: 1, job: view(job) })
  }

  // The account's state for each action: a refusal, or null to go ahead
  async function precheck(action, t, member, refuse) {
    const banOf = () => { try { return { entry: bans.findEntry(t.discordId) } } catch (err) { log('ban list unreadable:', err.message); return { broken: true } } }
    const discordBan = async () => (await withDeadline(bot.banState(t.discordId), memberDeadlineMs)) || 'unknown'
    switch (action) {
      case 'ban': {
        const { entry, broken } = banOf()
        if (broken) return refuse(503, 'storeUnreadable')
        if (entry) return refuse(409, 'alreadyBanned', { ref: entry.ref || null, kind: isDiscordCopy(entry) ? 'discord_ban' : 'ban' })
        return null
      }
      case 'unban': {
        const { entry, broken } = banOf()
        if (broken) return refuse(503, 'storeUnreadable')
        if (!entry) return refuse(409, 'notBanned')
        if (!isDiscordCopy(entry)) return null
        // A Discord ban's copy: lifted here only when Discord no longer bans them (an unban the bot missed)
        const state = await discordBan()
        if (state === 'banned') return refuse(409, 'discordBan')
        return state === 'notBanned' ? null : refuse(503, 'discordUnavailable')
      }
      case 'discord-timeout':
      case 'discord-timeout-end':
        if (member.state !== 'member') return refuse(409, 'notInGuild')
        if (member.admin) return refuse(409, 'targetIsAdmin')
        if (!member.moderatable) return refuse(409, 'botBelowTarget')
        if (action === 'discord-timeout-end' && !(member.timedOutUntil > now())) return refuse(409, 'notTimedOut')
        return null
      case 'discord-ban': {
        if (member.state === 'member' && !member.bannable) return refuse(409, 'botBelowTarget')
        const state = await discordBan()
        if (state === 'banned') return refuse(409, 'alreadyBanned', { kind: 'discord' })
        return state === 'notBanned' ? null : refuse(503, 'discordUnavailable')
      }
      case 'discord-unban': {
        const state = await discordBan()
        if (state === 'notBanned') return refuse(409, 'notBanned')
        return state === 'banned' ? null : refuse(503, 'discordUnavailable')
      }
      default: return refuse(404, 'notFound')
    }
  }

  const journalRow = (j, kind, extra = {}) => {
    try {
      return journal.dashboard(kind, {
        discordId: j.targetDiscordId, profileId: j.target.profileId, tags: j.tags, discordName: j.target.discordName, untilMs: j.untilMs, reason: j.reason,
        by: { handle: j.handle }, req: rules.id8(`w-${j.uuid}`), ...extra,
      })
    } catch (err) { log('journal not written:', err.message); return null }
  }
  const logBan = line => { try { bans.logBan(line) } catch { /* logBan never throws; a stub may */ } }

  // Runs the action; resolves to [status, code, detail] when it failed, else undefined
  async function act(j, member) {
    if (j.action === 'ban' || j.action === 'unban') {
      try {
        if (j.action === 'ban') {
          const r = bans.addNew({ discordId: j.targetDiscordId, reason: j.reason, bannedBy: `${j.handle} (dashboard)` })
          if (r.existing) { j.ref = r.existing.ref || null; return failed(j, 409, 'alreadyBanned') }
          j.ref = r.entry.ref
        } else {
          const r = bans.removeEntry(j.targetDiscordId)
          if (!r.removed) return failed(j, 409, 'notBanned')
          j.ref = r.removed.ref || null
        }
      } catch (err) {
        log('ban list not written:', err.message)
        return failed(j, 503, 'storeUnreadable')
      }
      // After the write, so nothing here can report a lifted ban as not done
      if (j.action === 'unban') {
        try {
          const role = bannedRoleId()
          j.banRoleHeld = !!role && member.state === 'member' && (member.roles || []).includes(String(role))
        } catch (err) { log('ban role not read:', err.message) }
      }
      j.state = 'done'
      journalRow(j, j.action, { ref: j.ref })
      logBan(`dashboard ${j.action}: profile ${j.target.profileId} ref ${j.ref || 'none'} by ${j.handle}`)
      finish(j)
      return undefined
    }

    // Discord: the journal's claim first, so the bot's own copy of the row is skipped; released when nothing happened
    const id = j.targetDiscordId
    const auditReason = `${j.reason} (${j.handle} via the dashboard, req ${rules.id8(`w-${j.uuid}`)})`.slice(0, 512)
    const KIND = { 'discord-timeout': 'discord_timeout', 'discord-timeout-end': 'discord_timeout_end', 'discord-ban': 'discord_ban', 'discord-unban': 'discord_unban' }
    const kind = KIND[j.action]
    const claim = j.action === 'discord-timeout' ? journal.claimTimeout(id, kind, 0, j.untilMs)
      : j.action === 'discord-timeout-end' ? journal.claimTimeout(id, kind, j.wasUntil, 0) : journal.claimBan(id, kind)
    const call = () => {
      switch (j.action) {
        case 'discord-timeout': return bot.timeoutMember(id, j.untilMs, auditReason)
        case 'discord-timeout-end': return bot.timeoutMember(id, null, auditReason)
        case 'discord-ban': return bot.banUser(id, auditReason)
        default: return bot.unbanUser(id, auditReason)
      }
    }
    const settled = Promise.resolve().then(call).then(() => ({ ok: true }), err => ({ err }))
    const apply = r => {
      if (r.ok) {
        j.state = 'done'
        j.error = ''
        journalRow(j, kind)
        finish(j)
        return undefined
      }
      if (claim) journal.release(claim)
      const [status, code, detail] = r.err && r.err.code === 'botNotReady' ? [503, 'botNotReady'] : DISCORD_ERRORS[r.err && r.err.code] || [502, 'discordRefused', r.err && Number.isInteger(r.err.code) ? String(r.err.code) : 'other']
      if (r.err && r.err.code === 50013) log(`Discord refused ${j.action}: the bot lacks a permission`)
      else log(`Discord refused ${j.action}:`, (r.err && (r.err.code || r.err.message)) || 'unknown')
      return failed(j, status, code, detail)
    }
    const first = await withDeadline(settled, discordDeadlineMs)
    if (first) return apply(first)
    // No answer in time: on record as unknown, and a late answer still fills it; nothing is retried
    j.state = 'unknown'
    j.error = 'noAnswer'
    finish(j)
    settled.then(late => { if (j.state === 'unknown') apply(late) }).catch(() => {})
    return undefined
  }

  // /discipline and /kick through the console's one function, under its own checks and this switch
  async function send(ctx, b, refuse) {
    const api = consoleApi()
    const line = rules.cleanCommand(b.command)
    if (!line) return refuse(400, 'badCommand')
    const words = line.split(' ')
    const word = words[0].slice(1)
    if (!PUNISH_COMMANDS.includes(word)) return refuse(422, 'notPunish')
    // A request id already run answers from the console's own record
    if (!api.job(`w-${b.uuid}`, ctx.caller)) {
      if (!TAG_RE.test(words[1] || '')) return refuse(422, 'notRemote', { why: 'needTag', reason: rules.whyText('needTag', word) })
      const found = await targetChecks(ctx, b.profileId, refuse)
      if (found.refused) return found.refused
      if (!(found.t.tags || []).includes(words[1].slice(1).toUpperCase())) return refuse(409, 'wrongTarget')
    }
    // The account the dialog showed goes with the line as targetProfileId, as the Console panel's /run sends it
    // (page_contract): the console sends it only to a game that checks it for this command (else 422 noProfileCheck,
    // nothing sent), with that account's fresh roles for the game's rank check
    const { status, body } = await api.runStaffCommand(ctx.caller, {
      uuid: b.uuid, text: b.command, targetProfileId: b.profileId, only: PUNISH_COMMANDS, cap: ctx.mode, via: 'punish',
    })
    return answer(status, body)
  }

  // ---- what the page reads ----------------------------------------------------------------------------------------
  function info(token, tier) {
    const api = consoleApi()
    const caller = api.webCaller(token)
    const sw = settings()
    const st = api.state('web')
    // Only a command the game checks against the page's account (targetProfile) can be sent; the rest stay Copy
    const sendable = PUNISH_COMMANDS.filter(n => (st.commands || []).some(c => c.name === n && c.targetProfile === true))
    const m = bot.botModeration()
    const pinned = !!caller && !api.config.problem && api.config.pins.has(caller.discordId)
    const may = a => ACTIONS[a].tiers.includes(tier) && pinned && sw[ACTIONS[a].area] !== 'off'
    return {
      v: 1, tier, fresh: api.isFresh(caller), signInUrl: SIGN_IN_URL, pinned, switch: sw,
      send: { setting: st.setting, ready: st.ready, commands: sendable },
      bot: { ready: m.ready, banMembers: m.banMembers, moderateMembers: m.moderateMembers, viewAuditLog: m.viewAuditLog },
      can: {
        send: may('send') && st.setting !== 'off' && st.ready && sendable.length > 0, ban: may('ban'), unban: may('unban'),
        discordTimeout: may('discord-timeout') && m.ready && m.moderateMembers, discordBan: may('discord-ban') && m.ready && m.banMembers,
      },
      reason: { min: REASON_MIN, max: REASON_MAX }, timeout: { maxMinutes: MAX_MINUTES, presets: [...PRESETS] },
    }
  }

  // Own jobs only: a send's from the console, the others from this store
  function job(token, uuid) {
    const api = consoleApi()
    const caller = api.webCaller(token)
    const u = String(uuid || '').toLowerCase()
    if (!caller || !rules.UUID_RE.test(u)) return null
    const sent = api.job(`w-${u}`, caller)
    if (sent) return sent
    const j = jobs.get(`p-${u}`)
    return j && j.discordId === caller.discordId ? view(j) : null
  }

  // Once at backend start: jobs a restart cut short. A ban list job is read back from the list, a Discord one is unknown
  function recover() {
    let n = 0
    for (const j of jobs.values()) {
      if (j.state !== 'running') continue
      n++
      if (j.action === 'ban' || j.action === 'unban') {
        let entry
        try { entry = bans.findEntry(j.targetDiscordId) } catch { entry = undefined }
        const made = j.action === 'ban' ? !!entry && entry.bannedBy === `${j.handle} (dashboard)` : entry === null
        j.state = entry === undefined ? 'unknown' : made ? 'done' : 'notRun'
        if (made && entry) j.ref = entry.ref || null
      } else {
        j.state = 'unknown'
        j.error = 'restart'
      }
      finish(j)
    }
    return n
  }

  return { authorize, perform, info, job, recover, settings }
}

module.exports = { createPunishActions, parseActionsSwitch, actionsSettings, parseBody, ACTIONS, PUNISH_COMMANDS, LIMITS, MAX_MINUTES }
