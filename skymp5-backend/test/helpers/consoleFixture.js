'use strict'
// A scratch console: spool, key and switch under the temp folder, a fake Discord, session store and game, and a recorded audit

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const rules = require('../../sources/console/allowlist')
const { createSpool } = require('../../sources/console/spool')
const { createStaffConsole } = require('../../sources/console/staffConsole')

const GUILD = '1494109013300744312'
const ROLE = { owner: '1494126527489507369', dev: '1494491999305338981', lead: '1494126618065506425', gm: '1553844072878178384', trial: '1558248795932860507' }
const ID = { jake: '300000000000000001', nate: '300000000000000002', gm: '300000000000000003', stranger: '300000000000000004', unpinnedOwner: '300000000000000005',
  lead: '300000000000000006', trial: '300000000000000007', unpinnedLead: '300000000000000008' }
// The role set the deploy writes (host/console.env, Jake 14 Oct): Owners, Dragon Break Dev and Lead GM
const DEPLOY_ROLE_IDS = `${ROLE.owner},${ROLE.dev},${ROLE.lead}`
const ALLOW = [
  { name: 'wwremote', usage: '/wwremote [on|off|clear #TAG]', rule: 'switch', help: 'x' },
  { name: 'vlremote', usage: '/vlremote [on|off|clear #TAG]', rule: 'switch', help: 'x' },
  { name: 'kick', usage: '/kick #TAG', rule: 'tag', help: 'x' },
  { name: 'fixloc', usage: '/fixloc #TAG', rule: 'tag', help: 'x' },
  { name: 'rename', usage: '/rename #TAG <new name>', rule: 'tagName', help: 'x' },
  { name: 'chargen', usage: '/chargen #TAG', rule: 'tag', help: 'x' },
  { name: 'players', usage: '/players', rule: 'none', help: 'x' },
  { name: 'load', usage: '/load [reset]', rule: 'load', help: 'x' },
  { name: 'whoami', usage: '/whoami', rule: 'none', help: 'x' },
]

function createConsoleFixture(label = 'dbo-console-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label))
  const dir = path.join(root, 'spool')
  for (const d of [dir, path.join(dir, 'in'), path.join(dir, 'work'), path.join(dir, 'out')]) { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.chmodSync(d, 0o700) }
  const keyHex = crypto.randomBytes(32).toString('hex')
  const keyFile = path.join(root, 'console.key')
  fs.writeFileSync(keyFile, `${keyHex}\n`, { mode: 0o600 })
  const switchFile = path.join(root, 'console')
  fs.writeFileSync(switchFile, 'on\n')
  fs.writeFileSync(path.join(dir, 'allow.json'), JSON.stringify(ALLOW), { mode: 0o600 })
  const F = { root, dir, keyFile, switchFile, keyHex, key: Buffer.from(keyHex, 'hex'), audits: [], logs: [], clock: { offset: 0 } }

  // Discord as the backend's bot answers getMemberFresh; members by id, a throw or a hang on request
  F.members = new Map([
    [ID.jake, { roles: [GUILD, ROLE.owner], handle: 'jake' }],
    [ID.nate, { roles: [GUILD, ROLE.dev], handle: 'nate.pierce' }],
    [ID.gm, { roles: [GUILD, ROLE.gm], handle: 'gemma' }],
    [ID.stranger, { roles: [GUILD], handle: 'stranger' }],
    [ID.unpinnedOwner, { roles: [GUILD, ROLE.owner], handle: 'otherowner' }],
    [ID.lead, { roles: [GUILD, ROLE.lead], handle: 'icedsky' }],
    [ID.trial, { roles: [GUILD, ROLE.trial], handle: 'trina' }],
    [ID.unpinnedLead, { roles: [GUILD, ROLE.lead], handle: 'otherlead' }],
  ])
  F.lookups = 0
  F.client = { name: 'our client' }
  F.discordBot = {
    getMemberFresh: async id => {
      F.lookups++
      const m = F.members.get(id)
      if (m === 'throw') throw new Error('Discord answered 500')
      if (m === 'hang') return new Promise(() => {})
      return m ? { ...m } : null
    },
    isOwnClient: c => c === F.client,
  }
  F.sessions = new Map()
  F.siteSessions = { validate: token => F.sessions.get(token) || null }
  F.session = (discordId, signedInAgoMs = 60 * 1000, extra = {}) => {
    const token = crypto.randomBytes(32).toString('hex')
    F.sessions.set(token, { discordId, username: 'Display Name', ...(signedInAgoMs === null ? {} : { signedInAt: F.now() - signedInAgoMs }), ...extra })
    return token
  }
  F.profiles = new Map([[ID.jake, 1], [ID.nate, 2], [ID.gm, 3], [ID.stranger, 4], [ID.unpinnedOwner, 5], [ID.lead, 6], [ID.trial, 7], [ID.unpinnedLead, 8]])
  F.now = () => Date.now() + F.clock.offset
  F.config = {
    consoleDiscordIds: `${ID.jake},${ID.nate},${ID.gm},${ID.stranger},${ID.lead},${ID.trial}`, consoleRoleIds: DEPLOY_ROLE_IDS, discordGuildId: GUILD,
    consoleFreshSigninHours: 4, consoleDiscordChannelIds: '', siteOwnerRoleIds: [ROLE.owner], siteStaffRoleIds: [ROLE.owner, ROLE.dev],
  }
  F.audit = { log: line => F.audits.push(line) }
  F.make = (configOverride = {}, extra = {}) => {
    F.spool = createSpool({ dir, keyFile, now: F.now })
    F.api = createStaffConsole({
      config: { ...F.config, ...configOverride }, discordBot: F.discordBot, siteSessions: F.siteSessions,
      profileIdOf: id => (F.profiles.has(id) ? F.profiles.get(id) : null), spool: F.spool, audit: F.audit,
      discordIdsOfProfile: pid => [...F.profiles].filter(([, p]) => p === pid).map(([d]) => d),
      jobsFile: path.join(root, 'data', 'console-jobs.json'), switchFile, now: F.now, log: (...a) => F.logs.push(a.join(' ')),
      waitMs: 1500, lateWaitMs: 1500, ...extra,
    })
    return F.api
  }

  // A fake game: claims what waits, checks it as the game does, and answers with a signed reply
  F.requests = []
  F.answer = null
  F.claimOnly = false
  F.gameTick = () => {
    const IN = path.join(dir, 'in'), WORK = path.join(dir, 'work'), OUT = path.join(dir, 'out')
    for (const name of fs.readdirSync(IN).filter(n => n.endsWith('.json') && !n.startsWith('.'))) {
      try { fs.renameSync(path.join(IN, name), path.join(WORK, name)) } catch { continue }
      const r = JSON.parse(fs.readFileSync(path.join(WORK, name), 'utf8'))
      const sigOk = crypto.createHmac('sha256', F.key).update(rules.reqPayload(r)).digest('hex') === r.sig
      F.requests.push({ ...r, sigOk, fileMode: (fs.statSync(path.join(WORK, name)).mode & 0o777).toString(8) })
      fs.rmSync(path.join(WORK, name), { force: true })
      if (F.claimOnly) continue
      const rep = { v: 1, id: r.id, state: 'ran', gate: 'ran', ranAs: 'Jake #ABCD', online: false, tier: 'senior', target: '', lines: [{ to: 'you', text: 'Pong!' }], why: '', at: F.now(), ...(F.answer ? F.answer(r) : {}) }
      rep.sig = crypto.createHmac('sha256', F.key).update(rules.repPayload(rep)).digest('hex')
      fs.writeFileSync(path.join(OUT, `.${r.id}.tmp`), JSON.stringify(rep), { mode: 0o600 })
      fs.renameSync(path.join(OUT, `.${r.id}.tmp`), path.join(OUT, `${r.id}.json`))
    }
  }
  F.game = null
  F.startGame = (ms = 50) => { F.stopGame(); F.game = setInterval(F.gameTick, ms) }
  F.stopGame = () => { if (F.game) clearInterval(F.game); F.game = null }
  F.cleanup = () => { F.stopGame(); fs.rmSync(root, { recursive: true, force: true }) }
  F.inFiles = () => fs.readdirSync(path.join(dir, 'in'))
  return F
}

let seq = 0
const uuid = () => `7a1c2a3b-4d5e-4f60-8a7b-${String(++seq).padStart(12, '0')}`

module.exports = { createConsoleFixture, uuid, GUILD, ROLE, ID, ALLOW, DEPLOY_ROLE_IDS }
