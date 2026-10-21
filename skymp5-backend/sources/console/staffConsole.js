'use strict'
// The remote staff console's one backend function behind the dashboard and Discord; only its two factories make a caller

const nodeFs = require('fs')
const path = require('path')
const { ChatInputCommandInteraction } = require('discord.js')
const rules = require('./allowlist')

const JOBS_KEPT = 200
const WAIT_MS = 12 * 1000
const LATE_WAIT_MS = 60 * 1000
const MEMBER_DEADLINE_MS = 8000
const MINUTE = 60 * 1000
const LIMITS = Object.freeze({ triesPer10Min: 20, perMinute: 6, perHour: 60, siteWidePerMinute: 30 })
const FINAL = new Set(['ran', 'refused', 'failed', 'expired', 'dry-run', 'off', 'busy', 'bad', 'notRun', 'unknown'])
const TIER_LABEL = Object.freeze({ senior: 'Senior', developer: 'Developer', leadgm: 'Lead GM', gm: 'GM', trialgm: 'Trial GM' })
const SIGN_IN_URL = '/api/site/login/fresh'
// The switch is read as the game reads it: no symlink followed, no wait on a FIFO, a regular file of at most 64 bytes
const SWITCH_OPEN = nodeFs.constants.O_RDONLY | (nodeFs.constants.O_NOFOLLOW || 0) | (nodeFs.constants.O_NONBLOCK || 0)
const SWITCH_MAX_BYTES = 64

const ids = value => String(value ?? '').split(',').map(s => s.trim()).filter(Boolean)
const snowflakes = (list, max) => list.length >= 1 && list.length <= max && list.every(x => rules.SNOWFLAKE.test(x))

// The rank rule, Lead GM and above (Owners, Dragon Break Dev, Lead GM in CONSOLE_ROLE_IDS), shared with /say; problem is '' when usable
function readRankRule(config) {
  const roles = ids(config.consoleRoleIds)
  const guild = String(config.discordGuildId || '')
  let problem = ''
  if (!snowflakes(roles, 10)) problem = 'CONSOLE_ROLE_IDS must be 1 to 10 role ids'
  else if (!rules.SNOWFLAKE.test(guild)) problem = 'DISCORD_GUILD_ID is not set'
  // The guild id is the @everyone role, which discord.js puts in every member's role cache
  else if (roles.includes(guild)) problem = 'CONSOLE_ROLE_IDS holds the guild id (@everyone)'
  return { roles: new Set(roles), guild, problem }
}

// The console's config, read once (env does not change without a restart); problem is '' when usable
function readConfig(config) {
  const pins = ids(config.consoleDiscordIds)
  const rank = readRankRule(config)
  const channels = ids(config.consoleDiscordChannelIds)
  const hours = Number(config.consoleFreshSigninHours)
  let problem = ''
  if (!snowflakes(pins, 10)) problem = 'CONSOLE_DISCORD_IDS must be 1 to 10 Discord ids (empty is off)'
  else if (rank.problem) problem = rank.problem
  else if (channels.length && !snowflakes(channels, 25)) problem = 'CONSOLE_DISCORD_CHANNEL_IDS must be channel ids'
  return { pins: new Set(pins), roles: rank.roles, guild: rank.guild, channels: new Set(channels), freshMs: (hours > 0 && hours <= 24 ? hours : 4) * 3600 * 1000, problem }
}

const withDeadline = (promise, ms) => {
  let timer
  const deadline = new Promise(resolve => { timer = setTimeout(resolve, ms, null) })
  return Promise.race([Promise.resolve(promise).catch(() => null), deadline]).finally(() => clearTimeout(timer))
}

function createStaffConsole({
  config, discordBot, siteSessions, profileIdOf, spool, audit, jobsFile, switchFile, fs = nodeFs, now = Date.now, discordIdsOfProfile = () => [],
  log = (...a) => console.log('[console]', ...a), waitMs = WAIT_MS, lateWaitMs = LATE_WAIT_MS,
}) {
  const C = readConfig(config)
  // One line at start either way, counts only, so a deploy can see which config the backend runs with
  if (C.problem) log(`off: ${C.problem}`)
  else log(`config: ${C.pins.size} pinned ids, ${C.roles.size} role ids${C.channels.size ? `, ${C.channels.size} channels` : ''}`)
  const callers = new WeakSet()
  const jobs = new Map()
  const running = new Map()
  const windows = new Map()
  const folded = new Map()
  const seenAt = new Map()

  // ---- the two ways to make a caller -------------------------------------------------------------------------------
  const brand = c => { const f = Object.freeze(c); callers.add(f); return f }

  // The website session's own Discord id and sign-in time, from the session store; null for an unknown or expired token
  function webCaller(token) {
    const s = typeof token === 'string' && /^[0-9a-f]{64}$/.test(token) ? siteSessions.validate(token) : null
    if (!s || typeof s.discordId !== 'string' || !rules.SNOWFLAKE.test(s.discordId)) return null
    return brand({ source: 'web', discordId: s.discordId, signedInAt: Number.isSafeInteger(s.signedInAt) ? s.signedInAt : 0 })
  }

  // A discord.js slash command of our own client, named console, in our guild (and channel, when locked), not from a bot
  function discordCaller(interaction) {
    const refused = (code, discordId) => { refusal('discord', discordId, '-', '', code, ''); return { refused: code } }
    const userId = interaction?.user?.id
    if (!(interaction instanceof ChatInputCommandInteraction) || !discordBot.isOwnClient(interaction.client)) return refused('badInteraction', userId)
    if (interaction.commandName !== 'console') return refused('badInteraction', userId)
    if (C.problem) return refused('unavailable', userId)
    if (interaction.guildId !== C.guild) return refused('wrongGuild', userId)
    if (C.channels.size && !C.channels.has(interaction.channelId)) return refused('wrongChannel', userId)
    if (!userId || !rules.SNOWFLAKE.test(userId) || interaction.user.bot) return refused('bot', userId)
    if (typeof interaction.id !== 'string' || !rules.SNOWFLAKE.test(interaction.id)) return refused('badInteraction', userId)
    return brand({ source: 'discord', discordId: userId, interactionId: interaction.id })
  }

  // ---- the kill switch ---------------------------------------------------------------------------------------------
  function setting(source) {
    let text = null
    try {
      const fd = fs.openSync(switchFile, SWITCH_OPEN)
      try {
        const st = fs.fstatSync(fd)
        if (st.isFile() && st.size <= SWITCH_MAX_BYTES) text = fs.readFileSync(fd, 'utf8')
      } finally { fs.closeSync(fd) }
    } catch { /* missing is off */ }
    return rules.parseSwitch(text)[source] || 'off'
  }

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

  // One backend log line per refusal; the Discord copy at most once a minute per account, tooMany folded in the log too
  function refusal(source, discordId, handle, reqId, code, text) {
    const who = rules.SNOWFLAKE.test(String(discordId || '')) ? String(discordId) : '-'
    const line = `CONSOLE refused ${source} ${handle || '-'} (<@${who}>) req ${reqId ? rules.id8(reqId) : '-'} ${code}: ${rules.foldText(text, 120)}`
    const t = now()
    if (code === 'tooMany') {
      const f = folded.get(`t:${who}`) || { at: 0, n: 0 }
      if (t - f.at < MINUTE) { f.n++; folded.set(`t:${who}`, f); return }
      folded.set(`t:${who}`, { at: t, n: 0 })
      if (f.n) log(`${f.n} more tooMany refusals for <@${who}> were folded`)
    }
    const d = folded.get(`d:${who}`) || { at: 0, n: 0 }
    if (folded.size > 5000) folded.clear()
    if (t - d.at >= MINUTE) {
      folded.set(`d:${who}`, { at: t, n: 0 })
      try { audit.log(`${line}${d.n ? ` (${d.n} more refusals this minute, backend log only)` : ''}`) } catch (err) { log('audit failed:', err.message) }
    } else {
      d.n++
      folded.set(`d:${who}`, d)
      log(line)
    }
  }

  // Before the caller is known to be fresh: the backend log only, once a minute per account and code
  function quiet(source, discordId, code) {
    const key = `q:${code}:${discordId}`
    if (now() - (seenAt.get(key) || 0) < MINUTE) return
    if (seenAt.size > 5000) seenAt.clear()
    seenAt.set(key, now())
    log(`refused ${source} <@${discordId}> ${code}${code === 'unavailable' ? ` (${C.problem || spool.problem() || 'spool'})` : ''}`)
  }

  // ---- the job store ----------------------------------------------------------------------------------------------
  const view = j => ({
    id: j.id, state: j.state, command: j.text, setting: j.setting, ranAs: j.ranAs || '', online: !!j.online, tier: j.tier || '',
    tierLabel: TIER_LABEL[j.tier] || '', target: j.target || '', why: j.why || '', lines: j.lines || [], at: new Date(j.at).toISOString(),
    summary: summary(j), as: j.ranAs ? `as ${j.ranAs} (${TIER_LABEL[j.tier] || j.tier || 'no tier'}, ${j.online ? 'online' : 'offline'})` : '',
  })
  const STATE_TEXT = { notRun: 'not run', unknown: 'unknown', sent: 'sent', 'dry-run': 'dry run' }
  const NOT_RUN = 'The game did not take the command within 10 s, so it was not run.'
  const UNKNOWN = 'The game took the command but did not answer; check #staff-commands before you send it again.'
  // The header both front ends show: the console's own line, else the first line to the caller, else the first broadcast
  function said(j) {
    const first = (j.lines || []).find(l => l.to === 'console') || (j.lines || []).find(l => l.to === 'you') || (j.lines || []).find(l => l.to === 'all')
    return j.state === 'notRun' ? NOT_RUN : j.state === 'unknown' ? UNKNOWN
      : j.state === 'dry-run' ? (j.target ? `would act on ${j.target}` : 'every check passed; nothing ran') : first ? first.text : 'no reply'
  }
  const summary = j => `${j.text}: ${STATE_TEXT[j.state] || j.state} - ${said(j)}`

  function saveJobs() {
    const list = [...jobs.values()].slice(-JOBS_KEPT)
    const tmp = `${jobsFile}.tmp`
    try {
      fs.mkdirSync(path.dirname(jobsFile), { recursive: true })
      fs.writeFileSync(tmp, `${JSON.stringify({ v: 1, jobs: list })}\n`, { mode: 0o600 })
      fs.chmodSync(tmp, 0o600)
      fs.renameSync(tmp, jobsFile)
    } catch (err) { log('jobs not saved:', err.message) }
  }
  function loadJobs() {
    let saved = []
    try { saved = JSON.parse(fs.readFileSync(jobsFile, 'utf8')).jobs } catch { return }
    for (const j of Array.isArray(saved) ? saved.slice(-JOBS_KEPT) : []) {
      if (typeof j?.id !== 'string' || !rules.REQUEST_ID_RE.test(j.id) || typeof j.discordId !== 'string' || !rules.SNOWFLAKE.test(j.discordId)) continue
      if (!(FINAL.has(j.state) || j.state === 'sent')) continue
      jobs.set(j.id, {
        id: j.id, at: Number(j.at) || 0, source: j.source === 'discord' ? 'discord' : 'web', discordId: j.discordId, handle: rules.cleanHandle(j.handle),
        profileId: Number(j.profileId) || 0, text: rules.foldText(j.text, 500), setting: String(j.setting || ''), state: j.state,
        ranAs: rules.foldText(j.ranAs, 80), online: j.online === true, tier: rules.foldText(j.tier, 16), target: rules.foldText(j.target, 80),
        why: rules.foldText(j.why, 32), lines: Array.isArray(j.lines) ? j.lines.slice(0, 40).map(l => ({ to: rules.foldText(l?.to, 8), text: rules.foldText(l?.text, 600) })) : [],
      })
    }
  }
  loadJobs()
  const remember = j => {
    jobs.delete(j.id)
    jobs.set(j.id, j)
    for (const id of jobs.keys()) { if (jobs.size <= JOBS_KEPT) break; jobs.delete(id) }
    saveJobs()
  }

  function fill(j, rep) {
    if (!rep || rep.bad) { j.state = 'unknown'; j.why = rep?.bad ? `reply ${rep.bad}` : ''; return }
    Object.assign(j, { state: rep.state, ranAs: rep.ranAs, online: rep.online, tier: rep.tier, target: rep.target, why: rep.why, lines: rep.lines })
  }
  function sayResult(j) {
    try { audit.log(`CONSOLE req ${rules.id8(j.id)} -> ${j.state}${j.ranAs ? ` as ${j.ranAs} (${TIER_LABEL[j.tier] || j.tier || '-'})` : ''}: ${rules.foldText(said(j), 160)}`) }
    catch (err) { log('audit failed:', err.message) }
  }

  // The fresh roles of the profile's Discord accounts (at most 3); null when none is known or none answered
  async function targetRolesOf(pid) {
    let dids = []
    try { dids = (discordIdsOfProfile(pid) || []).map(String).filter(d => rules.SNOWFLAKE.test(d)).slice(0, 3) } catch (err) { log('profile store unreadable:', err.message); return null }
    if (!dids.length) return null
    const members = await Promise.all(dids.map(d => withDeadline(discordBot.getMemberFresh(d), MEMBER_DEADLINE_MS)))
    const found = members.filter(m => m && Array.isArray(m.roles))
    if (!found.length) return null
    return [...new Set(found.flatMap(m => m.roles.map(String)).filter(r => rules.SNOWFLAKE.test(r)))].slice(0, 100)
  }

  // ---- the one function -------------------------------------------------------------------------------------------
  const answer = (status, body) => ({ status, body })
  const error = (status, code, extra = {}) => answer(status, { v: 1, error: code, ...extra })

  async function runStaffCommand(caller, request = {}) {
    // 0. A caller from one of the two factories, or a code bug
    if (!callers.has(caller)) { log('refused a caller that no factory made (code bug)'); return error(500, 'badCaller') }
    const { source, discordId } = caller
    // 1. The kill switch, read on every call
    const mode = setting(source)
    if (mode !== 'on' && mode !== 'dry-run') { quiet(source, discordId, 'consoleOff'); return error(503, 'consoleOff') }
    // 2. The config, the spool and the key
    if (C.problem || spool.problem()) { quiet(source, discordId, 'unavailable'); return error(503, 'unavailable') }
    const text = typeof request.text === 'string' ? request.text : ''
    const reqId = source === 'web' ? (typeof request.uuid === 'string' && rules.UUID_RE.test(request.uuid) ? `w-${request.uuid.toLowerCase()}` : '') : `d-${caller.interactionId}`
    const refuse = (status, code, handle, extra) => { refusal(source, discordId, handle, reqId, code, text); return error(status, code, extra) }
    if (!reqId) return refuse(400, 'badRequest', '-')
    // The account the dashboard showed; the game refuses a #TAG that is not one of its characters
    const pagePid = source === 'web' && request.targetProfileId !== undefined ? request.targetProfileId : undefined
    if (pagePid !== undefined && !(Number.isSafeInteger(pagePid) && pagePid >= 0)) return refuse(400, 'badRequest', '-')
    // 3. A dashboard caller signed in on Discord's page within the last few hours
    if (source === 'web' && !(caller.signedInAt > 0 && now() - caller.signedInAt <= C.freshMs)) return refuse(401, 'signInAgain', '-', { signInUrl: SIGN_IN_URL })
    // 4. Every attempt counts before any Discord lookup
    if (over(`tries:${discordId}`, LIMITS.triesPer10Min, 10 * MINUTE)) return refuse(429, 'tooMany', '-')
    // 5. The permission check: the pin, then the member's roles asked of Discord now
    if (!C.pins.has(discordId)) return refuse(403, 'notAllowed', '-')
    const member = await withDeadline(discordBot.getMemberFresh(discordId), MEMBER_DEADLINE_MS)
    const roles = member && Array.isArray(member.roles) ? member.roles.map(String).filter(r => rules.SNOWFLAKE.test(r)).slice(0, 100) : []
    const handle = member ? rules.cleanHandle(member.handle) : '-'
    if (!roles.some(r => C.roles.has(r))) return refuse(403, 'notAllowed', handle)
    // 6. A game profile
    let profileId = null
    try { profileId = profileIdOf(discordId) } catch (err) { log('profile store unreadable:', err.message); return refuse(503, 'unavailable', handle) }
    if (!Number.isSafeInteger(profileId) || profileId < 0) return refuse(409, 'noProfile', handle)
    // 7. One clean line
    const line = rules.cleanCommand(text)
    if (!line) return refuse(400, 'badCommand', handle)
    // 8. The allowlist the game published; without it the game decides alone
    const allow = spool.allow()
    const pre = allow ? rules.precheck(line, allow, text) : null
    if (pre) {
      const usage = (allow.find(a => a.name === pre.cmd) || {}).usage
      return refuse(422, 'notRemote', handle, { why: pre.why, reason: rules.whyText(pre.why, pre.cmd, usage, pre.subject) })
    }
    // A page account goes only to a game that says it checks it for this command, else nothing is sent
    const cmd = (/^\/([a-z]{2,24})/.exec(line) || [])[1] || ''
    const entry = allow ? allow.find(a => a.name === cmd) : null
    if (pagePid !== undefined && !(entry && entry.targetProfile)) {
      return refuse(422, 'notRemote', handle, { why: 'noProfileCheck', reason: rules.whyText('noProfileCheck', cmd) })
    }
    // The page account's fresh roles for the rank check, asked before step 9 so nothing waits between it and the record
    const target = pagePid === undefined ? {} : { targetProfileId: pagePid }
    if (pagePid !== undefined && entry.rank && !jobs.has(reqId)) {
      const roles = await targetRolesOf(pagePid)
      if (roles) target.targetRoles = roles
    }
    // 9. One run per request id
    const known = jobs.get(reqId)
    if (known) {
      if (known.discordId !== discordId) return refuse(409, 'conflict', handle)
      if (running.has(reqId)) return answer(202, { v: 1, job: view(known) })
      return answer(200, { v: 1, job: view(known) })
    }
    // 10. Accepted commands: per account and site-wide
    if (over(`min:${discordId}`, LIMITS.perMinute, MINUTE) || over(`hour:${discordId}`, LIMITS.perHour, 60 * MINUTE) || over('site', LIMITS.siteWidePerMinute, MINUTE)) {
      return refuse(429, 'tooMany', handle)
    }
    // 11. The record and the audit line, before anything is sent
    const job = { id: reqId, at: now(), source, discordId, handle, profileId, text: line, setting: mode, state: 'sent', ranAs: '', online: false, tier: '', target: '', why: '', lines: [] }
    remember(job)
    try { audit.log(`CONSOLE ${handle} (<@${discordId}>) via ${source} req ${rules.id8(reqId)}${mode === 'dry-run' ? ' (dry run)' : ''}${pagePid !== undefined ? ` (page profile ${pagePid})` : ''}: ${line}`) } catch (err) { log('audit failed:', err.message) }
    // 12. and 13. Send, then wait for the game
    const work = (async () => {
      try { spool.send({ id: reqId, src: source, discordId, user: handle, profileId, roles, text: line, mode, ...target }) }
      catch (err) { log('send failed:', err.message); job.state = 'notRun'; remember(job); sayResult(job); return }
      const rep = await spool.waitReply(reqId, waitMs)
      if (rep) { fill(job, rep); remember(job); sayResult(job); return }
      if (spool.cancel(reqId)) { job.state = 'notRun'; remember(job); sayResult(job); return }
      job.state = 'unknown'
      remember(job)
      sayResult(job)
      // The game took it: a late reply still fills the record
      spool.waitReply(reqId, lateWaitMs).then(late => { if (late && !late.bad) { fill(job, late); remember(job); sayResult(job) } }).catch(() => {})
    })()
    running.set(reqId, work)
    try { await work } finally { running.delete(reqId) }
    // 14. The answer
    return answer(200, { v: 1, job: view(job) })
  }

  // ---- what the page reads ----------------------------------------------------------------------------------------
  function state(source) {
    const allow = spool.allow()
    // /discipline also carries the kinds the game takes now and its longest suspension, so the page offers only those
    // targetProfile: the page may send its account with the command; rank: the game refuses a target at the caller's rank or above
    const listed = a => ({ name: a.name, usage: a.usage, help: a.help, ...(a.kinds ? { kinds: [...a.kinds] } : {}), ...(a.maxSuspendDays ? { maxSuspendDays: a.maxSuspendDays } : {}),
      ...(a.targetProfile ? { targetProfile: true } : {}), ...(a.rank ? { rank: true } : {}) })
    return { setting: setting(source), ready: !C.problem && !spool.problem(), commands: (allow || []).map(listed) }
  }
  const isFresh = caller => callers.has(caller) && caller.source === 'web' && caller.signedInAt > 0 && now() - caller.signedInAt <= C.freshMs
  function job(id, caller) {
    if (!callers.has(caller) || typeof id !== 'string') return null
    const j = jobs.get(id.toLowerCase())
    return j && j.discordId === caller.discordId ? view(j) : null
  }

  // Once at backend start: jobs a restart cut short (DESIGN 3.4)
  function recover() {
    let n = 0
    for (const j of jobs.values()) {
      if (j.state !== 'sent') continue
      n++
      if (spool.replied(j.id)) fill(j, spool.readReply(j.id))
      else if (spool.waiting(j.id) && spool.cancel(j.id)) j.state = 'notRun'
      else j.state = 'unknown'
      sayResult(j)
    }
    if (n) saveJobs()
    spool.sweepOut()
    return n
  }

  return { webCaller, discordCaller, runStaffCommand, state, job, isFresh, recover, setting, config: C }
}

module.exports = { createStaffConsole, readConfig, readRankRule, LIMITS, SIGN_IN_URL, TIER_LABEL }
