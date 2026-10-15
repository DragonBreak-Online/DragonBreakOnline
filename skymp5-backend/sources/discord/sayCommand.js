'use strict'
// /say text reply_to close: Lead GMs and above post their own text as Dragonbaron where they could post it themselves

const crypto = require('crypto')
const { ChatInputCommandInteraction, ModalSubmitInteraction, MessageFlags, PermissionFlagsBits, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require('discord.js')
const { readRankRule } = require('../console/staffConsole')
const rules = require('../console/allowlist')

const MAX_TEXT = 2000
const FORM_MS = 15 * 60 * 1000
const FORMS_KEPT = 200
const LIMIT = Object.freeze({ posts: 10, windowMs: 10 * 60 * 1000 })
const MODAL_PREFIX = 'say:'
const LINK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/
const NO_MENTIONS = Object.freeze({ parse: [], repliedUser: false })

const ERRORS = Object.freeze({
  dm: '/say only works inside the Dragon Break server.',
  wrongGuild: '/say only works in the Dragon Break server.',
  bot: 'Bots cannot use /say.',
  unavailable: '/say is not set up on the server right now.',
  notAllowed: '/say is for Lead GMs and above (Owners, Dragon Break Dev and Lead GMs).',
  noChannel: 'Dragonbaron cannot see this channel.',
  record: 'This channel holds only Dragonbaron\'s own records (audit log, ticket transcripts), so /say cannot post here.',
  cannotPost: 'You cannot post in this channel yourself, so Dragonbaron will not post here for you.',
  locked: 'This thread is locked. Only staff who can manage threads can post in it.',
  botCannot: 'Dragonbaron is not allowed to post here.',
  empty: 'There is nothing to post.',
  tooLong: `That is longer than Discord allows (${MAX_TEXT} characters).`,
  badTarget: 'reply_to must be a message link or a message id.',
  otherChannel: 'reply_to must be a message in this channel. Run /say where that message is.',
  noHistory: 'You cannot read the message history here, so you cannot reply to a message.',
  noTarget: 'That message is not in this channel, or it was deleted. Nothing was posted.',
  closeOff: 'Closing threads with /say is not set up on the server yet. Nothing was posted.',
  closeWhere: 'close only works inside a thread of the staff to-do forum. Nothing was posted.',
  botCannotClose: 'Dragonbaron is not allowed to lock this thread. Nothing was posted.',
  tooMany: `You have used /say ${LIMIT.posts} times in the last 10 minutes. Wait a few minutes.`,
  expired: 'That form expired. Use /say again.',
  postFailed: 'Dragonbaron could not post that. Nothing was posted.',
  badInteraction: '/say refused that request.',
})

const has = (perms, flag) => !!perms && typeof perms.has === 'function' && perms.has(flag)
const isThread = channel => typeof channel?.isThread === 'function' && channel.isThread()

// The member's role ids, from a cached GuildMember or the raw interaction member
function rolesOf(member) {
  const r = member?.roles
  const list = r?.cache && typeof r.cache.keys === 'function' ? [...r.cache.keys()] : Array.isArray(r) ? r : []
  return list.map(String)
}

// The name staff see in the audit line: the display name, folded to one short line
function nameOf(interaction) {
  const m = interaction.member
  return rules.foldText(m?.displayName || m?.nick || interaction.user?.globalName || interaction.user?.username || 'unknown', 48) || 'unknown'
}

// A message id from a link or a bare id; the link must point into this guild and channel
function parseTarget(value, guildId, channelId) {
  const v = String(value ?? '').trim().replace(/^<(.*)>$/, '$1')
  if (!v) return { id: null }
  if (rules.SNOWFLAKE.test(v)) return { id: v }
  const m = LINK_RE.exec(v)
  if (!m) return { bad: 'badTarget' }
  if (m[1] !== guildId || m[2] !== channelId) return { bad: 'otherChannel' }
  return { id: m[3] }
}

function createSayCommand({
  config, audit, now = Date.now, log = (...a) => console.log('[say]', ...a),
  isOwnClient = c => require('./bot').isOwnClient(c), nonce = () => crypto.randomBytes(12).toString('base64url'),
}) {
  const R = readRankRule(config)
  const todoForum = rules.SNOWFLAKE.test(String(config.discordTodoForumChannelId || '')) ? String(config.discordTodoForumChannelId) : ''
  const records = new Set([config.discordLogChannelId, config.discordTicketTranscriptChannelId].map(String).filter(id => rules.SNOWFLAKE.test(id)))
  if (R.problem) log(`off: ${R.problem}`)
  const windows = new Map()
  const forms = new Map()

  // Posts in the window for this user; take counts one when there is room
  function overLimit(userId, take) {
    const t = now()
    const list = (windows.get(userId) || []).filter(x => t - x < LIMIT.windowMs)
    if (windows.size > 5000) windows.clear()
    const over = list.length >= LIMIT.posts
    if (take && !over) list.push(t)
    windows.set(userId, list)
    return over
  }

  // Every check before anything is shown or posted; a refusal code, or what the post needs
  async function check(interaction, { text, replyTo, close }) {
    if (!interaction.guildId) return { refused: 'dm' }
    if (R.problem) return { refused: 'unavailable' }
    if (interaction.guildId !== R.guild) return { refused: 'wrongGuild' }
    if (!interaction.user || interaction.user.bot) return { refused: 'bot' }
    if (!rolesOf(interaction.member).some(r => R.roles.has(r))) return { refused: 'notAllowed' }
    let channel = interaction.channel
    if (!channel) channel = await Promise.resolve(interaction.client?.channels?.fetch?.(interaction.channelId)).catch(() => null)
    if (!channel || channel.id !== interaction.channelId || typeof channel.send !== 'function') return { refused: 'noChannel' }
    const thread = isThread(channel)
    // A post as the bot in its own record channels would read as a genuine audit or transcript line
    if (records.has(channel.id) || (thread && records.has(String(channel.parentId)))) return { refused: 'record' }
    const sendFlag = thread ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages
    const mine = interaction.memberPermissions
    if (!has(mine, PermissionFlagsBits.ViewChannel) || !has(mine, sendFlag)) return { refused: 'cannotPost' }
    if (thread && channel.locked && !has(mine, PermissionFlagsBits.ManageThreads)) return { refused: 'locked' }
    const app = interaction.appPermissions
    if (app && (!has(app, PermissionFlagsBits.ViewChannel) || !has(app, sendFlag))) return { refused: 'botCannot' }
    if (text !== null) {
      if (!String(text).trim()) return { refused: 'empty' }
      if (String(text).length > MAX_TEXT) return { refused: 'tooLong' }
    }
    const target = parseTarget(replyTo, interaction.guildId, interaction.channelId)
    if (target.bad) return { refused: target.bad }
    if (target.id && !has(mine, PermissionFlagsBits.ReadMessageHistory)) return { refused: 'noHistory' }
    if (target.id && app && !has(app, PermissionFlagsBits.ReadMessageHistory)) return { refused: 'botCannot' }
    if (close) {
      if (!todoForum) return { refused: 'closeOff' }
      if (!thread || channel.parentId !== todoForum) return { refused: 'closeWhere' }
      if (app && !has(app, PermissionFlagsBits.ManageThreads)) return { refused: 'botCannotClose' }
    }
    if (overLimit(interaction.user.id, false)) return { refused: 'tooMany' }
    return { channel, replyId: target.id, close: !!close, name: nameOf(interaction), handle: rules.cleanHandle(interaction.user.username) }
  }

  async function refuse(interaction, code) {
    log(`refused ${nameOf(interaction)} (@${rules.cleanHandle(interaction.user?.username)}) ${code}`)
    await interaction.reply({ content: ERRORS[code] || ERRORS.postFailed, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
      .catch(err => console.error('[say] refusal reply failed:', err.message))
    return true
  }

  // Deferred first, so nothing posts unless this process acknowledged the interaction
  async function post(interaction, ctx, text) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    } catch (err) {
      console.error('[say] defer failed, nothing was posted:', err.message)
      return true
    }
    const answer = content => interaction.editReply({ content, allowedMentions: { parse: [] } }).catch(err => console.error('[say] reply failed:', err.message))
    if (overLimit(interaction.user.id, true)) { await answer(ERRORS.tooMany); return true }
    const where = `<#${ctx.channel.id}>`
    let replyUrl = ''
    if (ctx.replyId) {
      const target = await Promise.resolve(ctx.channel.messages?.fetch?.(ctx.replyId)).catch(() => null)
      if (!target || target.channelId !== ctx.channel.id) { await answer(ERRORS.noTarget); return true }
      replyUrl = target.url || ''
    }
    let sent
    try {
      sent = await ctx.channel.send({
        content: text, allowedMentions: NO_MENTIONS,
        ...(ctx.replyId ? { reply: { messageReference: ctx.replyId, failIfNotExists: true } } : {}),
      })
    } catch (err) {
      log(`post by ${ctx.name} (@${ctx.handle}) in ${where} failed: ${err.message}`)
      await answer(ERRORS.postFailed)
      return true
    }
    const posted = `Posted as Dragonbaron: ${sent.url}`
    let closed = false
    if (ctx.close) {
      // Answered before the close, since an archived thread can refuse the edit of the private reply
      await answer(`${posted}\nLocking and archiving the thread now.`)
      try {
        await ctx.channel.edit({ locked: true, archived: true, reason: `/say close by ${ctx.handle}` })
        closed = true
      } catch (err) { log(`close of ${where} failed: ${err.message}`) }
    }
    const did = ctx.close ? (closed ? ', then locked and archived the thread' : ', but the thread could not be locked') : ''
    try {
      audit.log(`SAY "${ctx.name}" (@${ctx.handle}) posted as Dragonbaron in ${where}${replyUrl ? ` replying to ${replyUrl}` : ''}${did}: ${sent.url} "${rules.foldText(text, 100)}"`)
    } catch (err) { log('audit failed:', err.message) }
    if (!ctx.close) await answer(posted)
    else if (!closed) await answer(`${posted}\nThe thread could not be locked; close it by hand.`)
    return true
  }

  function rememberForm(entry) {
    const t = now()
    for (const [k, f] of forms) { if (t - f.at > FORM_MS || forms.size >= FORMS_KEPT) forms.delete(k) }
    const id = nonce()
    forms.set(id, { ...entry, at: t })
    return id
  }

  function modal(id, close) {
    return new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}${id}`)
      .setTitle(close ? 'Post as Dragonbaron, then close' : 'Post as Dragonbaron')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('text')
          .setLabel('Message (your name goes in the audit log)')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(MAX_TEXT)
          .setRequired(true)))
  }

  // false for anything that is not /say or its form, so another handler can follow
  async function handleInteraction(interaction) {
    if (!interaction || typeof interaction.isChatInputCommand !== 'function') return false
    const command = interaction.isChatInputCommand() && interaction.commandName === 'say'
    const form = !command && typeof interaction.isModalSubmit === 'function' && interaction.isModalSubmit() && String(interaction.customId || '').startsWith(MODAL_PREFIX)
    if (!command && !form) return false
    const real = command ? interaction instanceof ChatInputCommandInteraction : interaction instanceof ModalSubmitInteraction
    if (!real || !isOwnClient(interaction.client)) return refuse(interaction, 'badInteraction')

    if (command) {
      const text = interaction.options.getString('text')
      const opts = { text, replyTo: interaction.options.getString('reply_to'), close: interaction.options.getBoolean('close') === true }
      const ctx = await check(interaction, opts)
      if (ctx.refused) return refuse(interaction, ctx.refused)
      if (text !== null) return post(interaction, ctx, text)
      const id = rememberForm({ userId: interaction.user.id, channelId: interaction.channelId, replyTo: opts.replyTo, close: opts.close })
      await interaction.showModal(modal(id, opts.close)).catch(err => console.error('[say] form failed to open:', err.message))
      return true
    }

    const id = String(interaction.customId).slice(MODAL_PREFIX.length)
    const saved = forms.get(id)
    if (!saved || saved.userId !== interaction.user?.id) return refuse(interaction, 'expired')
    forms.delete(id)
    if (now() - saved.at > FORM_MS || saved.channelId !== interaction.channelId) return refuse(interaction, 'expired')
    let text = ''
    try { text = interaction.fields.getTextInputValue('text') } catch { text = '' }
    const ctx = await check(interaction, { text, replyTo: saved.replyTo, close: saved.close })
    if (ctx.refused) return refuse(interaction, ctx.refused)
    return post(interaction, ctx, text)
  }

  return { handleInteraction }
}

let instance = null
function handleInteraction(interaction) {
  if (!instance) instance = createSayCommand({ config: require('../../config'), audit: require('./audit') })
  return instance.handleInteraction(interaction)
}

module.exports = { handleInteraction, createSayCommand, parseTarget, ERRORS, LIMIT, MAX_TEXT }
