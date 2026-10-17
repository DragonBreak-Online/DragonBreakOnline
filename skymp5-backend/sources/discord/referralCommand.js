'use strict'
// /referral: the caller's own referral link, code, counted friends and boosts, private, read only from the gameplay's referrals.json
// The gameplay (server branch referrals.js) makes a code the first time an account is in the world; nothing here logs a link or code

const fs = require('fs')
const path = require('path')
const { ChatInputCommandInteraction, MessageFlags } = require('discord.js')

const PRIVATE = MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds
const LIMIT = Object.freeze({ uses: 5, windowMs: 60 * 1000 })
const CONFIG_TTL_MS = 5 * 60 * 1000
const CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$/
const DEFAULTS = Object.freeze({ enabled: false, linkBase: 'https://dragonbreakonline.com/api/users/login-discord/join/', qualifyHours: 5, qualifyDays: 2 })

const TEXT = Object.freeze({
  wrongGuild: '/referral only works in the DragonBreak Online server.',
  bot: 'Bots have no referral link.',
  off: 'Referrals are not open yet.',
  paused: 'Referrals are paused for a moment. Try /referral again in a few minutes.',
  noAccount: 'This Discord account has not signed in to DragonBreak Online yet. Sign in through the launcher and enter the world once, then use /referral here again.',
  noCode: 'You have no referral code yet. Enter the world in game once (your code is made within a couple of minutes), then use /referral here again.',
  tooMany: 'You have used /referral a lot in the last minute. Wait a moment.',
  failed: 'Your referral link could not be read right now. Try again in a few minutes.',
  badInteraction: '/referral refused that request.',
})

const hm = ms => { const m = Math.max(0, Math.floor(Number(ms) / 60000) || 0); return `${Math.floor(m / 60)} h ${m % 60} m` }
const pct = m => `+${Math.round((Number(m) - 1) * 100)}%`
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// The reply for one account's record; store is referrals.json, rules the gamemode-config referrals block
function describe(pid, store, rules) {
  const r = store.profiles[String(pid)]
  const code = r && r.code
  if (!code || !CODE_RE.test(code) || store.codes?.[code] !== pid) return { refused: 'noCode' }
  const link = `${rules.linkBase}${code}`
  const friends = Object.values(store.profiles).filter(f => f && f.ref && f.ref.by === pid)
  const counted = friends.filter(f => f.ref.status === 'qualified').length
  const playing = friends.filter(f => f.ref.status === 'pending').length
  const checking = friends.filter(f => f.ref.status === 'checking' || f.ref.status === 'held').length
  const lines = [
    '**Your DragonBreak Online referral link**',
    link,
    `Code: \`${code}\``,
    '',
    `A friend who joins with your link (or types \`/referral ${code}\` in game in their first hours) counts once they have played ${rules.qualifyHours} hours on ${rules.qualifyDays} different days.`,
  ]
  if (!friends.length) lines.push('No friends have joined with your link yet.')
  else {
    const more = [playing && `${playing} still playing toward it`, checking && `${checking} being checked by staff`].filter(Boolean)
    lines.push(`Friends counted: **${counted}** of ${plural(friends.length, 'friend', 'friends')} who joined${more.length ? ` (${more.join(', ')})` : ''}.`)
  }
  const queue = Array.isArray(r.queue) ? r.queue : []
  if (queue.length) lines.push(`Boosts: ${queue.map(b => `${pct(b.mult)} skill progress${b.kind === 'welcome' ? ' (welcome)' : ''}, ${hm(b.leftMs)} of play left`).join('; ')}. They run one at a time while you play.`)
  lines.push('', 'The next message holds only the link, so you can copy it in one go.')
  return { text: lines.join('\n'), link }
}

function createReferralCommand({
  config, now = Date.now, log = (...a) => console.log('[referral]', ...a),
  isOwnClient = c => require('./bot').isOwnClient(c),
  profileIdOf = discordId => require('../profiles').load().map[discordId],
  readFile = p => fs.promises.readFile(p, 'utf8'),
}) {
  const dir = String(config.gameServerDir || '')
  const storeFile = process.env.REFERRAL_STORE_FILE || path.join(dir, 'referrals.json')
  const configFile = process.env.REFERRAL_GAMEMODE_CONFIG || path.join(dir, 'gamemode-config.json')
  const guild = String(config.discordGuildId || '')
  const windows = new Map()
  let rules = null, rulesAt = 0

  function overLimit(userId) {
    const t = now()
    const list = (windows.get(userId) || []).filter(x => t - x < LIMIT.windowMs)
    if (windows.size > 5000) windows.clear()
    const over = list.length >= LIMIT.uses
    if (!over) list.push(t)
    windows.set(userId, list)
    return over
  }

  // The gamemode's referrals block (link base, the rules), read again every few minutes; defaults when unreadable
  async function readRules() {
    if (rules && now() - rulesAt < CONFIG_TTL_MS) return rules
    let raw = {}
    try { raw = JSON.parse(await readFile(configFile)).referrals || {} } catch (err) { log(`gamemode config unreadable: ${err.code || err.message}`) }
    const pos = (v, d) => (Number(v) > 0 ? Number(v) : d)
    rules = {
      enabled: raw.enabled === true,
      linkBase: typeof raw.linkBase === 'string' && /^https:\/\//.test(raw.linkBase) ? raw.linkBase : DEFAULTS.linkBase,
      qualifyHours: pos(raw.qualifyHours, DEFAULTS.qualifyHours),
      qualifyDays: Number.isInteger(raw.qualifyDays) && raw.qualifyDays >= 1 ? raw.qualifyDays : DEFAULTS.qualifyDays,
    }
    rulesAt = now()
    return rules
  }

  // { refused } or { text, link } for this Discord user
  async function lookup(discordId) {
    const ru = await readRules()
    if (!ru.enabled) return { refused: 'off' }
    const pid = Number(profileIdOf(String(discordId)))
    if (!Number.isInteger(pid) || pid < 0) return { refused: 'noAccount' }
    let text
    try { text = await readFile(storeFile) } catch (err) { return { refused: err.code === 'ENOENT' ? 'off' : 'failed' } }
    let store
    try { store = JSON.parse(text) } catch { return { refused: 'paused' } }
    if (!store || typeof store !== 'object' || !store.profiles || typeof store.profiles !== 'object') return { refused: 'paused' }
    return describe(pid, store, ru)
  }

  const send = (interaction, content) => interaction.reply({ content, flags: PRIVATE, allowedMentions: { parse: [] } })

  // false for anything that is not /referral, so another handler can follow
  async function handleInteraction(interaction) {
    if (!interaction || typeof interaction.isChatInputCommand !== 'function') return false
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'referral') return false
    if (!(interaction instanceof ChatInputCommandInteraction) || !isOwnClient(interaction.client)) { await send(interaction, TEXT.badInteraction).catch(() => {}); return true }
    if (!interaction.guildId || (guild && interaction.guildId !== guild)) { await send(interaction, TEXT.wrongGuild).catch(() => {}); return true }
    if (!interaction.user || interaction.user.bot) { await send(interaction, TEXT.bot).catch(() => {}); return true }
    if (overLimit(interaction.user.id)) { await send(interaction, TEXT.tooMany).catch(() => {}); return true }
    let res
    try { res = await lookup(interaction.user.id) } catch (err) { log(`lookup failed: ${err.message}`); res = { refused: 'failed' } }
    if (res.refused) { await send(interaction, TEXT[res.refused]).catch(err => log(`reply failed: ${err.message}`)); return true }
    try {
      await send(interaction, res.text)
      await interaction.followUp({ content: res.link, flags: PRIVATE, allowedMentions: { parse: [] } })
    } catch (err) { log(`reply failed: ${err.message}`) }
    return true
  }

  return { handleInteraction, lookup }
}

let instance = null
function handleInteraction(interaction) {
  if (!instance) instance = createReferralCommand({ config: require('../../config') })
  return instance.handleInteraction(interaction)
}

module.exports = { handleInteraction, createReferralCommand, describe, TEXT, LIMIT }
