'use strict'
// The Punishments panel's actions on fakes: the console fixture (sessions, pins, spool and a fake game), the panel's
// record files (punishFixture), a private copy of bans.js on the fixture's own ban list, the real moderation journal on
// the fixture's journal, a fake bot and a recorded audit. Nothing here reaches Discord or the real data folder.

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const fs = require('fs')
const path = require('path')
const { createConsoleFixture, ROLE, GUILD, DEPLOY_ROLE_IDS, ALLOW, uuid } = require('./consoleFixture')
const { createPunishFixture, PEOPLE, SECRET_STRINGS } = require('./punishFixture')

const ROOT = path.join(__dirname, '..', '..')
const stub = (rel, exports) => {
  const file = require.resolve(path.join(ROOT, rel))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
const ORIGIN = 'https://site.example'
const BAN_ROLE = '1555000000000000999'
const HANDLES = { owner: 'jake', dev: 'nate.pierce', lead: 'lena_lead', gm: 'gus_gm', trial: 'tia', none: 'pat', actor: 'old_lead', rep: 'vex' }
// allow.json as the hardened game (punish-hardening-1021-review 45e90896c) writes it: /discipline's rule, and the page's
// account (targetProfile) checked on the #TAG commands, the rank check on /discipline and /kick. ALLOW is today's game
const DISCIPLINE = {
  name: 'discipline', usage: '/discipline #TAG warn|strike|lift <reason>; suspend <1-720h|1-30d> <reason>; overturn <n> <reason>', rule: 'tagKindReason',
  help: 'x', kinds: ['warn', 'strike', 'suspend', 'lift', 'overturn'], maxSuspendDays: 30, targetProfile: true, rank: true,
}
const TAGGED = new Set(['kick', 'fixloc', 'rename', 'chargen', 'chars'])
const HARDENED_ALLOW = [...ALLOW.map(a => (TAGGED.has(a.name) ? { ...a, targetProfile: true, ...(a.name === 'kick' ? { rank: true } : {}) } : a)), DISCIPLINE]

function createActionsFixture() {
  const PF = createPunishFixture()
  // The fixture's journal ends on a half line, as a crash would leave it; the next write starts a line of its own
  fs.appendFileSync(PF.journalFile, '\n')
  const F = createConsoleFixture('dbo-punish-actions-')
  const H = { PF, F, PEOPLE, audits: [], staff: [], logs: [], calls: [] }

  // Discord roles by account, as Discord answers now; a test changes them through H.roles
  H.roles = new Map([
    ['owner', [GUILD, ROLE.owner]], ['dev', [GUILD, ROLE.dev]], ['lead', [GUILD, ROLE.lead]], ['gm', [GUILD, ROLE.gm]], ['trial', [GUILD, ROLE.trial]],
    ['none', [GUILD]], ['bob', [GUILD]], ['gina', [GUILD, ROLE.gm]], ['rep', [GUILD]], ['ivan', [GUILD]], ['actor', [GUILD, ROLE.lead]],
  ].map(([k, r]) => [PEOPLE[k].discordId, r]))
  const keyOf = d => Object.keys(PEOPLE).find(k => PEOPLE[k].discordId === d)
  const rolesOf = d => H.roles.get(d) || null

  stub('sources/discordBot.js', {
    memberHasRole: async (d, role) => (rolesOf(d) || []).includes(role),
    getMemberRoles: async d => rolesOf(d) || [],
    isGuildMember: async d => rolesOf(d) !== null,
  })
  stub('sources/profiles.js', { load: () => PF.profiles })
  stub('sources/players.js', { load: () => PF.players })
  stub('sources/nameTable.js', { load: () => ({}) })
  stub('routes/servers.js', { getHeartbeat: () => null })
  stub('sources/console/index.js', { consoleApi: () => F.api })
  stub('routes/site-auth.js', {
    internals: {
      currentSession: req => F.siteSessions.validate(String(req.headers['x-test-session'] || '')),
      sessionToken: req => String(req.headers['x-test-session'] || ''),
      sameOrigin: req => req.get('origin') === ORIGIN,
      readStore: () => PF.forms, dynamicFields: cf => cf.dynamicFields || {}, characterName: cf => cf.displayName,
      profileIdOf: d => PF.profiles.map[d] ?? null, toSiteCharacter: () => ({}),
    },
  })

  const config = require('../../config')
  Object.assign(config, {
    gameServerDir: PF.game, punishBansFile: PF.bansFile, punishJournalFile: PF.journalFile, punishPlayerLogDir: '', punishPlayerLogDays: 90,
    siteOwnerRoleIds: [ROLE.owner], siteStaffRoleIds: [ROLE.owner, ROLE.dev], punishLeadGmRoleIds: [ROLE.lead], punishGmRoleIds: [ROLE.gm],
    discordStaffRoleIds: [ROLE.trial], consoleRoleIds: DEPLOY_ROLE_IDS, discordGuildId: GUILD, punishPanel: true,
  })
  H.config = config

  // The console: the panel's people pinned (not 'actor'), their roles as above
  F.members = new Map([...H.roles.keys()].map(d => [d, { roles: [...rolesOf(d)], handle: HANDLES[keyOf(d)] || keyOf(d) }]))
  F.discordBot.getMemberFresh = async d => { F.lookups++; const r = rolesOf(d); return r ? { roles: [...r], handle: HANDLES[keyOf(d)] || keyOf(d) } : null }
  F.profiles = new Map(Object.entries(PF.profiles.map))
  F.config.consoleDiscordIds = ['owner', 'dev', 'lead', 'gm', 'trial', 'none'].map(k => PEOPLE[k].discordId).join(',')
  F.make()
  // The game's allow.json; the hardened game's unless a test writes today's (H.allow(ALLOW))
  H.allow = list => fs.writeFileSync(path.join(F.dir, 'allow.json'), JSON.stringify(list), { mode: 0o600 })
  H.allow(HARDENED_ALLOW)

  // The ban list: bans.js copied beside the fixture's data folder, so its FILE is the fixture's bans.json
  fs.mkdirSync(path.join(PF.root, 'sources'), { recursive: true })
  for (const f of ['bans.js', 'storeFile.js']) fs.copyFileSync(path.join(ROOT, 'sources', f), path.join(PF.root, 'sources', f))
  process.env.BAN_LOG_DIR = path.join(PF.root, 'logs')
  H.bans = require(path.join(PF.root, 'sources', 'bans.js'))
  H.banList = () => JSON.parse(fs.readFileSync(PF.bansFile, 'utf8'))
  H.journal = () => fs.readFileSync(PF.journalFile, 'utf8').split('\n').filter(l => l.startsWith('{"v":1') && l.endsWith('}')).map(l => JSON.parse(l))

  // The bot: what it may do, members as Discord answers, Discord bans, and every write it is asked for
  H.bot = {
    moderation: { ready: true, banMembers: true, moderateMembers: true, viewAuditLog: true },
    member: new Map(), banned: new Set(), fail: null, hang: false, banStateAnswer: null,
  }
  const write = (name, ...args) => {
    H.calls.push([name, ...args])
    if (H.bot.hang) return H.bot.hang === true ? new Promise(() => {}) : H.bot.hang
    if (H.bot.fail) return Promise.reject(H.bot.fail)
    if (name === 'banUser') H.bot.banned.add(args[0])
    if (name === 'unbanUser') H.bot.banned.delete(args[0])
    return Promise.resolve()
  }
  H.fakeBot = {
    getMemberFresh: (...a) => F.discordBot.getMemberFresh(...a),
    botModeration: () => ({ ...H.bot.moderation }),
    memberState: async d => {
      if (H.bot.member.has(d)) return H.bot.member.get(d)
      const r = rolesOf(d)
      return r ? { state: 'member', roles: [...r], handle: HANDLES[keyOf(d)] || keyOf(d), bannable: true, moderatable: true, admin: false, timedOutUntil: 0 } : { state: 'absent' }
    },
    timeoutMember: (d, until, reason) => write('timeoutMember', d, until, reason),
    banUser: (d, reason) => write('banUser', d, reason),
    unbanUser: (d, reason) => write('unbanUser', d, reason),
    banState: async d => H.bot.banStateAnswer || (H.bot.banned.has(d) ? 'banned' : 'notBanned'),
  }

  const { createPunishments } = require('../../sources/punish')
  const tier = require('../../sources/punish/tier')
  const plog = { events: () => ({ version: 0, list: [] }), refresh() {}, view: () => ({ status: 'ok', asOf: null, from: null, days: 90 }), stop: async () => {} }
  H.panel = createPunishments({
    config, readStore: () => PF.forms, dynamicFields: cf => cf.dynamicFields || {}, characterName: cf => cf.displayName,
    loadProfiles: () => PF.profiles, loadPlayers: () => PF.players, staffStatusOf: async () => 'player', playerLog: plog, tailIntervalMs: 0, now: F.now,
  })
  H.viewer = key => ({ tier: { owner: 'owner', dev: 'dev', lead: 'leadgm', gm: 'gm' }[key], discordId: PEOPLE[key].discordId, profileId: PEOPLE[key].profileId })
  // The panel's rows for one account, read after its 2 s snapshot
  H.rows = async (profileId, key = 'owner') => {
    F.clock.offset += 2500
    const r = await H.panel.player(H.viewer(key), profileId, {})
    return r.body
  }

  const { createPunishActions } = require('../../sources/punish/actions')
  let n = 0
  H.switchFile = path.join(PF.root, 'punish-actions')
  H.make = (opts = {}) => {
    n++
    H.actions = createPunishActions({
      config: { punishActions: 'on', punishActionsSwitchFile: H.switchFile, ...(opts.config || {}) },
      consoleApi: () => F.api, bot: H.fakeBot, bans: H.bans, journal: require('../../sources/discord/moderationJournal'),
      audit: { log: l => H.audits.push(l), staff: l => H.staff.push(l) },
      targetOf: p => H.panel.targetOf(p), profileIdOf: d => PF.profiles.map[d] ?? null,
      tierFromRoles: tier.tierFromRoles, rankOfRoles: tier.rankOfRoles, bannedRoleId: () => BAN_ROLE,
      jobsFile: opts.jobsFile || path.join(PF.root, `jobs-${n}`, 'punish-actions.json'), auditFile: path.join(PF.root, 'punish-actions.jsonl'),
      now: F.now, log: (...a) => H.logs.push(a.join(' ')), discordDeadlineMs: 150, memberDeadlineMs: 150, ...(opts.extra || {}),
    })
    return H.actions
  }
  H.make()

  const CONFIRM = { send: 'SEND', ban: 'BAN', unban: 'UNBAN', 'discord-timeout': 'TIMEOUT', 'discord-timeout-end': 'END TIMEOUT', 'discord-ban': 'DISCORD BAN', 'discord-unban': 'DISCORD UNBAN' }
  H.body = (action, extra = {}) => ({
    requestId: uuid(), profileId: PEOPLE.bob.profileId, ...(action === 'send' ? { command: '/kick #BOB1' } : { reason: 'Griefing at the bank' }),
    ...(action === 'discord-timeout' ? { minutes: 60 } : {}), confirm: CONFIRM[action], ...extra,
  })
  // As the route runs it: the checks before the body, then the action; who is a PEOPLE key or a session token
  H.call = async (action, who, body, { ago = 60 * 1000 } = {}) => {
    const token = PEOPLE[who] ? F.session(PEOPLE[who].discordId, ago) : who
    const a = await H.actions.authorize(token, action)
    if (a.refused) return a.refused
    return H.actions.perform(a.ctx, action, body)
  }
  // No answer may carry a Discord id, an address, a hwid or a mention
  H.clean = value => {
    const text = JSON.stringify(value)
    for (const s of [...SECRET_STRINGS, BAN_ROLE, ...[...H.roles.keys()]]) if (text.includes(s)) throw new Error(`answer holds ${s}: ${text.slice(0, 300)}`)
    if (/\d{17,20}/.test(text)) throw new Error(`answer holds an id: ${text.slice(0, 300)}`)
    return true
  }
  H.reset = () => { H.audits.length = 0; H.staff.length = 0; H.logs.length = 0; H.calls.length = 0 }
  H.cleanup = () => { F.cleanup(); PF.cleanup() }
  return H
}

module.exports = { createActionsFixture, ORIGIN, BAN_ROLE, HANDLES, uuid, ROLE, GUILD, ALLOW, HARDENED_ALLOW }
