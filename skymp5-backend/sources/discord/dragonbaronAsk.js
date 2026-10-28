'use strict'
// /dragonbaron ask: a staff question answered privately from read-only server data by templates, excerpts or the local model
// It never runs a command: no game command, no write to Discord beyond its own private reply, no file write but its usage record

const { MessageFlags, ChatInputCommandInteraction, Routes } = require('discord.js')
const aiSettings = require('../ai/aiSettings')
const { scrubAnswer, defuseMentions, UNSAFE } = require('../ai/outputScrub')
const { OWNERS_ONLY_INTENTS } = require('../ai/askRoute')

const SEEN_MS = 15 * 60 * 1000
const MAX_REPLY = 2000
const MAX_EMBED = 4096
const DEADLINE_MS = 90000
const SNOWFLAKE = /^\d{17,20}$/
const DOT = ' \u00b7 '
const CUT_NOTE = '\n(cut to fit Discord)'
const seen = new Map()

const ERRORS = Object.freeze({
  badInteraction: 'Dragonbaron refused that request.',
  switchedOff: 'Ask is switched off right now.',
  notAllowed: 'Ask is for staff with the Ask permission. An Owner can grant it with /dragonbaron config.',
  badQuestion: 'Type a question of 3 to 500 characters.',
  limited: n => `You have asked a lot in a short time. Try again in ${n} minute${n === 1 ? '' : 's'}.`,
  failed: 'Dragonbaron could not answer that. Nothing was run.',
})

const FOOTER = Object.freeze({
  model: 'AI answer from server data; check before acting. Nothing was run.',
  data: 'From server data (no AI). Nothing was run.',
})

// A replayed INTERACTION_CREATE (a gateway resume) is answered once, as in consoleCommand.js
function remembered(id) {
  const t = Date.now()
  for (const [k, at] of seen) { if (t - at <= SEEN_MS && seen.size <= 5000) break; seen.delete(k) }
  if (seen.has(id)) return true
  seen.set(id, t)
  return false
}

function rolesOf(interaction) {
  const r = interaction.member?.roles
  const list = r?.cache && typeof r.cache.keys === 'function' ? [...r.cache.keys()] : Array.isArray(r) ? r : []
  return list.map(String)
}

const oneLine = (v, max) => defuseMentions(String(v ?? '').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()).replace(/`/g, "'").slice(0, max)

// Zero-width, soft hyphen and bidi marks are taken out (so "ad\u200bmin" stays one word); other controls become spaces
const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

function normalizeQuestion(raw) {
  const q = String(raw ?? '').replace(INVISIBLE, '').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
  return q.length >= 3 && q.length <= 500 ? q : null
}

// "Server Rules 2026-10-21 (D3, rule 2) . Staff Handbook 2026-10-21 (2.6) . Server status 18:37Z"
function sourcesLine(cards) {
  const groups = new Map()
  for (const c of cards || []) {
    if (!c) continue
    const key = c.doc || c.label
    if (!groups.has(key)) groups.set(key, [])
    if (c.doc && c.ref && !groups.get(key).includes(c.ref)) groups.get(key).push(c.ref)
  }
  const parts = [...groups].map(([k, refs]) => (refs.length ? `${k} (${refs.join(', ')})` : k))
  return parts.length ? `Sources: ${parts.join(DOT)}` : ''
}

// A message link built by code from three validated ids, never from text
const jumpOf = j => (j && [j.guild, j.channel, j.message].every(id => SNOWFLAKE.test(String(id)))
  ? `https://discord.com/channels/${j.guild}/${j.channel}/${j.message}` : null)

// The reply: every line scrubbed, thread and message links added after the scrub from card ids only, the footer built by code
// A block marked embed (the Owners-only held list) goes into one embed of up to 4096 characters instead of the 2000 of the text
function compose(result) {
  let scrubbed = 0
  const clean = text => { const r = scrubAnswer(text, { max: 1900 }); scrubbed += r.hits; return r.text }
  const renderLines = (b, inEmbed) => {
    const lines = []
    for (const line of b.lines || []) {
      if (line && typeof line === 'object') {
        const t = clean(line.text)
        const thread = SNOWFLAKE.test(String(line.thread)) ? `<#${line.thread}> ` : ''
        const url = jumpOf(line.jump)
        const jump = url ? (inEmbed ? ` [open](${url})` : ` <${url}>`) : ''
        if (t || thread || jump) lines.push(`${thread}${t}${jump}`)
      } else {
        const t = clean(line)
        if (t) lines.push(t)
      }
    }
    return lines
  }
  const parts = []
  const embeds = []
  for (const line of result.lead || []) { const t = clean(line); if (t) parts.push(t) }
  if (result.answer) { const t = clean(result.answer); if (t) parts.push(t) }
  for (const b of result.blocks || []) {
    if (b.embed) {
      const title = b.title ? clean(b.title).replace(/\*/g, '').slice(0, 256) : undefined
      let description = renderLines(b, true).join('\n')
      if (description.length > MAX_EMBED) {
        const room = MAX_EMBED - CUT_NOTE.length
        let head = description.slice(0, room)
        const nl = head.lastIndexOf('\n')
        if (nl > room * 0.5) head = head.slice(0, nl)
        if (/[\ud800-\udbff]$/.test(head)) head = head.slice(0, -1)
        description = `${head.replace(/ ?\[open\]\([^)]*$/, '')}${CUT_NOTE}`
      }
      if (description) embeds.push({ ...(title ? { title } : {}), description })
      continue
    }
    const lines = []
    if (b.title) lines.push(`**${clean(b.title).replace(/\*/g, '')}**`)
    lines.push(...renderLines(b, false))
    if (lines.length) parts.push(lines.join('\n'))
  }
  for (const n of result.notes || []) { const t = clean(n); if (t) parts.push(t) }
  const body = parts.join('\n\n')
  const said = /Nothing was run\./.test(body)
  const footer = result.mode === 'model' ? FOOTER.model : result.outcome === 'refused' ? (said ? '' : 'Nothing was run.') : FOOTER.data
  const tail = [clean(sourcesLine(result.sources)), footer].filter(Boolean).join('\n')
  let content = [body, tail].filter(Boolean).join('\n\n')
  if (content.length > MAX_REPLY) {
    const room = MAX_REPLY - tail.length - CUT_NOTE.length - 2
    let head = body.slice(0, Math.max(0, room))
    const nl = head.lastIndexOf('\n')
    if (nl > room * 0.5) head = head.slice(0, nl)
    if (/[\ud800-\udbff]$/.test(head)) head = head.slice(0, -1)
    head = head.replace(/<#\d*$/, '').replace(/<https:\/\/discord\.com\/channels\/[\d/]*$/, '')
    content = `${head}${CUT_NOTE}${tail ? `\n\n${tail}` : ''}`.slice(0, MAX_REPLY)
  }
  return { content: content || ERRORS.failed, embeds, scrubbed }
}

const formatReply = result => compose(result).content

function createAsk({
  config, audit, perms, answerer, limiter, settings = () => aiSettings.readSettings(), readSwitch = () => aiSettings.readSwitch(),
  usageLog, now = Date.now, log = (...a) => console.log('[dragonbaron-ask]', ...a),
  isOwnClient = c => require('./bot').isOwnClient(c), punishTierOf = () => null,
}) {
  const s0 = settings()
  const sw0 = readSwitch()
  log(`model: ${sw0.model ? 'on' : 'off'}, url set: ${s0.url ? 'yes' : 'no'}, model ${s0.model}, num_ctx ${s0.numCtx}`)

  function whoOf(interaction, roles) {
    const m = interaction.member
    return {
      discordId: String(interaction.user.id),
      username: oneLine(interaction.user.username || 'unknown', 40),
      displayName: oneLine(m?.displayName || m?.nick || interaction.user.globalName || interaction.user.username || 'unknown', 48),
      tier: perms.askTier(roles),
      punishTier: punishTierOf(roles),
    }
  }

  // One audit line with no question and no answer text, and the local usage record (metadata only, Jake 28 Oct)
  // The audit channel is read by staff below Owner, so the Owners-only sources are never named in it (rule 11.7)
  function record(who, { qChars = 0, result = null, outcome, mode = 'template', ms = 0, scrubbed = 0 }) {
    const r = result || {}
    const intents = r.intents || []
    const shown = intents.filter(i => !OWNERS_ONLY_INTENTS.has(i))
    const secs = (ms / 1000).toFixed(1)
    try {
      audit.log(`ASK ${who.displayName} (@${who.username}) [${who.tier || 'none'}] ${qChars} chars -> ${outcome} via ${mode}${shown.length ? ` (${shown.join(', ')})` : ''} in ${secs}s`)
    } catch (err) { log('audit failed:', err.message) }
    if (!usageLog) return
    usageLog.write({
      at: new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z'), user: who.discordId, tier: who.tier || null, q_chars: qChars, intents,
      cards: (r.cards || []).slice(0, 12), mode, outcome, ms, model_ms: r.modelMs || 0, load_ms: r.loadMs ?? null, repair: !!r.repair, check: r.check || 'none', scrubbed,
    })
  }

  async function refuse(interaction, content) {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
      .catch(err => log('refusal reply failed:', err.message))
    return true
  }

  function discordOf(interaction, guildId) {
    const cacheOf = id => interaction.guild?.channels?.cache?.get?.(id) || interaction.client?.channels?.cache?.get?.(id)
    return {
      activeThreads: () => interaction.client.rest.get(Routes.guildActiveThreads(guildId)),
      forumTags: id => { const ch = cacheOf(id); return Array.isArray(ch?.availableTags) ? ch.availableTags.map(t => ({ id: String(t.id), name: String(t.name) })) : null },
      channels: () => [...(interaction.guild?.channels?.cache?.values?.() || [])].map(c => ({ id: String(c.id), parentId: c.parentId ? String(c.parentId) : null, type: c.type })),
    }
  }

  async function handleInteraction(interaction) {
    if (!interaction || typeof interaction.isChatInputCommand !== 'function' || !interaction.isChatInputCommand()) return false
    if (interaction.commandName !== 'dragonbaron' || interaction.options?.getSubcommand?.(false) !== 'ask') return false
    const guild = String(config.discordGuildId || '')
    if (!(interaction instanceof ChatInputCommandInteraction) || !isOwnClient(interaction.client) || !SNOWFLAKE.test(guild) ||
        interaction.guildId !== guild || !interaction.user || interaction.user.bot) {
      return refuse(interaction, ERRORS.badInteraction)
    }
    const started = now()
    const roles = rolesOf(interaction)
    const who = whoOf(interaction, roles)

    if (!readSwitch().ask) { record(who, { outcome: 'switched-off' }); return refuse(interaction, ERRORS.switchedOff) }
    // The ask node (/dragonbaron config) decides who may ask; a role with the node but no staff rank still reads nothing
    if (!perms.hasPermission(roles, 'ask') || !who.tier) {
      record(who, { outcome: 'refused' })
      return refuse(interaction, ERRORS.notAllowed)
    }
    let raw = null
    try { raw = interaction.options.getString('question') } catch { raw = null }
    const question = normalizeQuestion(raw)
    if (!question) return refuse(interaction, ERRORS.badQuestion)
    const limit = limiter.check(who.discordId)
    if (!limit.ok) { record(who, { qChars: question.length, outcome: 'limited' }); return refuse(interaction, ERRORS.limited(limit.retryMin)) }

    if (remembered(interaction.id)) return true
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    } catch (err) {
      log('defer failed, nothing was run:', err.message)
      return true
    }
    limiter.note(who.discordId)

    let result
    try {
      result = await answerer.answer({ question, viewer: who, deadlineMs: DEADLINE_MS, ctx: { discord: discordOf(interaction, guild) } })
    } catch (err) {
      log('answer failed:', err.message)
      result = { outcome: 'unreachable', mode: 'template', lead: [ERRORS.failed], intents: [], cards: [] }
    }
    const reply = compose(result)
    await interaction.editReply({ content: reply.content, ...(reply.embeds.length ? { embeds: reply.embeds } : {}), allowedMentions: { parse: [] } })
      .catch(err => log('reply failed:', err.message))
    record(who, { qChars: question.length, result, outcome: result.outcome, mode: result.mode, ms: now() - started, scrubbed: reply.scrubbed })
    return true
  }

  return { handleInteraction }
}

function createDefault() {
  const { createLimiter } = require('../ai/rateLimit')
  const { createLocalModel, createSingleFlight } = require('../ai/localModel')
  const { createSources } = require('../ai/askSources')
  const { createAnswerer } = require('../ai/askAnswer')
  const { createUsageLog } = require('../ai/askUsage')
  const config = require('../../config')
  const settings = () => aiSettings.readSettings()
  const readSwitch = () => aiSettings.readSwitch()
  const limiter = createLimiter({ perMin: () => settings().askPerMin, perHour: () => settings().askPerHour, sitePerHour: () => settings().askSitePerHour })
  const sources = createSources({
    config,
    punishments: () => require('../../routes/site-punish').internals.punishments(),
    profileIdOf: id => require('../../routes/site-auth').internals.profileIdOf(id),
  })
  const answerer = createAnswerer({ sources, model: createLocalModel({ settings }), flight: createSingleFlight({ maxWaiting: 2 }), limiter, readSwitch, settings })
  return createAsk({
    config, audit: require('./audit'), perms: require('./dragonbaronPermissions'), answerer, limiter, settings, readSwitch,
    usageLog: createUsageLog(), punishTierOf: roles => require('../punish/tier').tierFromRoles(roles),
  })
}

let instance = null
function handleInteraction(interaction) {
  if (!instance) instance = createDefault()
  return instance.handleInteraction(interaction)
}

module.exports = { createAsk, handleInteraction, formatReply, compose, normalizeQuestion, sourcesLine, ERRORS, FOOTER }
