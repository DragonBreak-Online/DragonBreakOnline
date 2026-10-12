'use strict'
// Ticket panel and ticket channels. One button per ticket type, each type in its own
// category so the channel list stays readable. Category ids are resolved once at
// startup and cached in data/tickets.json so a restart does not make duplicates.

const {
  ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js')
const fs = require('fs')
const path = require('path')
const config = require('../../config')
const audit = require('./audit')
const transcript = require('./ticketTranscript')
const gmApplication = require('./gmApplication')

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'tickets.json')

// Order here is the button order in the panel
const TYPES = [
  { id: 'pk',   label: 'Player Kill Request', category: 'Player Kill Requests', emoji: '⚔️',
    blurb: 'Ask staff to approve a kill on another character.' },
  { id: 'mod',  label: 'Moderation Help',     category: 'Moderation Help',      emoji: '🛡️',
    blurb: 'You need a moderator, but nobody has broken a rule.' },
  { id: 'rep',  label: 'Report Player',       category: 'Player Reports',       emoji: '🚩',
    blurb: 'Report a player for breaking the rules. Bring evidence.' },
  // Only the Owners read it, so a GM never sees a report about themselves
  { id: 'gmr',  label: 'Report a GM',         category: 'GM Reports',           emoji: '⚖️',
    blurb: 'Report a Game Master who abuses their powers. Only the Owners can read it.', ownersOnly: true },
  { id: 'fac',  label: 'Faction Inquiry',     category: 'Faction Inquiries',    emoji: '🏰',
    blurb: 'Ask about joining, founding or running a faction.' },
  { id: 'map',  label: 'Map Creation',        category: 'Map Creation',         emoji: '🗺️',
    blurb: 'Talk to staff about building or creating part of the map.' },
  // The application's questions are posted into the ticket (intro), one message each
  { id: 'gm',   label: 'Trial GM Application', category: 'GM Applications',     emoji: '📜',
    blurb: 'Apply to join the Game Master team. The questions are posted in your ticket.',
    prompt: 'Anything to add before you start? (optional)', optional: true, intro: gmApplication },
]

const byId = new Map(TYPES.map(t => [t.id, t]))

function readState(file = STATE_FILE) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { counter: 0, categories: {}, panelMessageId: null }
  }
}

function writeState(state, file = STATE_FILE) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n')
  } catch (err) {
    console.error('[tickets] could not save state:', err.message)
  }
}

// By name, or by category so a renamed channel fails closed (its transcript stays out of the staff channel)
const isOwnersOnly = channel => byId.get(String(channel?.name || '').split('-')[0])?.ownersOnly === true ||
  (!!channel?.parentId && TYPES.some(t => t.ownersOnly && (readState().categories || {})[t.id] === channel.parentId))

const channelLink = (id, name) => (id ? `<#${id}>` : `#${name}`)

// Bugs and map changes have their own routes, all reaching the same staff, so tickets point there
function frontDoor() {
  const site = /^https:\/\//.test(config.websiteUrl || '')
    ? `the [report form](${config.websiteUrl.replace(/\/+$/, '')}/report.html) on the website` : 'the report form on the website'
  return [
    `- In game: \`/bug <what happened>\`. It saves where you are.`,
    `- On Discord: post in ${channelLink(config.discordBugsForumChannelId, 'bugs')}, one post per problem.`,
    '- Game will not start: Report a Problem in the launcher.',
    `- Or use ${site}.`,
    'Exploits and dupes: never in public. Use `/bug` or the website form.',
    `Ideas for changes to the world go in ${channelLink(config.discordSuggestionsChannelId, 'suggestions')}.`,
  ].join('\n')
}

function panelEmbed() {
  return new EmbedBuilder()
    .setTitle('DragonBreak Support')
    .setColor(0x8fd3d0)
    .setDescription([
      'Pick the button that matches what you need. A private channel opens for you and staff,',
      'and nobody else can read it.',
      '',
      'Say what happened, when, and who was involved. Screenshots and clips get you answered faster.',
      'One ticket per issue, and use **Close** when you are done.',
    ].join('\n'))
    .addFields(TYPES.map(t => ({ name: `${t.emoji} ${t.label}`, value: t.blurb, inline: false })))
    .addFields({ name: '🐛 Found a bug?', value: `Bugs are not taken as tickets. Any of these reaches the same staff:\n${frontDoor()}`, inline: false })
    .setFooter({ text: 'DragonBreak Online' })
}

function panelRows() {
  const rows = []
  for (let i = 0; i < TYPES.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      TYPES.slice(i, i + 5).map(t => new ButtonBuilder()
        .setCustomId(`ticket:open:${t.id}`)
        .setLabel(t.label)
        .setEmoji(t.emoji)
        .setStyle(ButtonStyle.Secondary)),
    ))
  }
  return rows
}

// Finds the category for a type, creating it the first time. Cached by id so a rename
// by staff does not orphan it.
async function categoryFor(guild, type, state) {
  const cached = state.categories[type.id]
  if (cached) {
    const existing = guild.channels.cache.get(cached) || await guild.channels.fetch(cached).catch(() => null)
    if (existing) return existing
  }
  const found = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === type.category.toLowerCase())
  const category = found || await guild.channels.create({ name: type.category, type: ChannelType.GuildCategory })
  state.categories[type.id] = category.id
  writeState(state)
  return category
}

async function openTicket(interaction, typeId, summary) {
  const type = byId.get(typeId)
  if (!type) return

  const state = readState()
  const guild = interaction.guild
  const category = await categoryFor(guild, type, state)
  // One open GM report per user, since each one pings the Owners
  if (type.ownersOnly) {
    const open = guild.channels.cache.find(c => c.parentId === category.id && c.permissionOverwrites?.cache?.has(interaction.user.id))
    if (open) return { channel: open, number: null, type }
  }

  state.counter += 1
  writeState(state)
  const number = String(state.counter).padStart(4, '0')

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
  ]
  const readers = type.ownersOnly ? config.siteOwnerRoleIds : config.discordStaffRoleIds
  for (const roleId of readers || []) {
    overwrites.push({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
    })
  }

  const channel = await guild.channels.create({
    name: (type.ownersOnly ? `${type.id}-${number}` : `${type.id}-${number}-${interaction.user.username}`).slice(0, 90),
    type: ChannelType.GuildText,
    parent: category.id,
    // Discord's Audit Log keeps the topic, so an owners-only ticket's names no reporter (the embed below does)
    topic: type.ownersOnly ? type.label : `${type.label} | opened by ${interaction.user.tag} (${interaction.user.id})`,
    permissionOverwrites: overwrites,
  })

  const embed = new EmbedBuilder()
    .setTitle(`${type.emoji} ${type.label} #${number}`)
    .setColor(0xe8d6a0)
    .setDescription(summary || '_No summary given._')
    .addFields({ name: 'Opened by', value: `<@${interaction.user.id}>`, inline: true })
    .setTimestamp(new Date())

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger))

  // Every staff role can read the ticket, but only the ping role is alerted, so the
  // owner does not get a notification for every map bug
  const pingRole = type.ownersOnly ? (config.siteOwnerRoleIds || [])[0] : config.discordTicketPingRoleId
  const ping = pingRole ? `<@&${pingRole}>` : ''
  await channel.send({ content: `<@${interaction.user.id}> ${ping}`.trim(), embeds: [embed], components: [closeRow] })
  for (const content of type.intro || []) await channel.send({ content, allowedMentions: { parse: [] } })

  // The audit channel is read by GMs, so an owners-only ticket logs no reporter
  audit.log(type.ownersOnly ? `TICKET opened #${channel.name} (Owners only)`
    : `TICKET opened ${type.label} #${number} by ${interaction.user.tag} (${interaction.user.id}) in #${channel.name}`)
  return { channel, number, type }
}

const closing = new Set()
// A ticket refused for attachments too large to keep, and when: a second Close within LARGE_CONFIRM_MS keeps what fits
const largeRefused = new Map()
const LARGE_CONFIRM_MS = 2 * 60 * 1000

// The channel is deleted only once its transcript is kept somewhere; otherwise it stays open
async function closeTicket(interaction, { wait = 5000, transcripts = transcript } = {}) {
  const channel = interaction.channel
  if (closing.has(channel.id)) return interaction.reply({ content: 'This ticket is already closing.', ephemeral: true })
  closing.add(channel.id)
  try {
    await interaction.reply({ content: 'Closing in 5 seconds.' })
    // GMs read the audit channel, and the reporter can press Close, so an owners-only ticket logs no closer
    audit.log(isOwnersOnly(channel) ? `TICKET closed #${channel.name} (Owners only)`
      : `TICKET closed #${channel.name} by ${interaction.user.tag} (${interaction.user.id})`)
    await new Promise(resolve => setTimeout(resolve, wait))
    const keepWhatFits = Date.now() - (largeRefused.get(channel.id) || 0) < LARGE_CONFIRM_MS
    try {
      const opts = { fileOnly: isOwnersOnly(channel) }
      if (keepWhatFits) opts.keepWhatFits = true
      audit.log(`TICKET transcript of #${channel.name} ${await transcripts.save(channel, interaction.user, opts)}`)
      largeRefused.delete(channel.id)
    } catch (err) {
      console.error(`[tickets] transcript of #${channel.name} failed, channel kept:`, err.message)
      if (err.code === 'TOO_LARGE') largeRefused.set(channel.id, Date.now())
      await channel.send(err.channelNote || 'The transcript could not be saved, so this channel stays open. Tell a staff member.').catch(() => {})
      return
    }
    await channel.delete('ticket closed').catch(err => console.error('[tickets] delete failed:', err.message))
  } finally {
    closing.delete(channel.id)
  }
}

// Posts the panel once. Safe to call on every boot: it edits its own message if it is still there.
async function ensurePanel(client, stateFile = STATE_FILE) {
  if (!config.discordTicketPanelChannelId) return
  const channel = await client.channels.fetch(config.discordTicketPanelChannelId).catch(() => null)
  if (!channel) {
    console.warn('[tickets] panel channel not found:', config.discordTicketPanelChannelId)
    return
  }
  const state = readState(stateFile)
  const payload = { embeds: [panelEmbed()], components: panelRows() }

  if (state.panelMessageId) {
    const existing = await channel.messages.fetch(state.panelMessageId).catch(() => null)
    if (existing) {
      await existing.edit(payload).catch(err => console.error('[tickets] panel edit failed:', err.message))
      return
    }
  }
  const sent = await channel.send(payload).catch(err => {
    console.error('[tickets] panel post failed:', err.message)
    return null
  })
  if (sent) {
    state.panelMessageId = sent.id
    writeState(state, stateFile)
  }
}

async function handleInteraction(interaction) {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return false
  const id = interaction.customId || ''
  if (!id.startsWith('ticket:')) return false

  try {
    if (interaction.isButton() && id.startsWith('ticket:open:')) {
      const typeId = id.slice('ticket:open:'.length)
      const type = byId.get(typeId)
      // A button left on an old panel, such as the removed Bug Report
      if (!type) {
        await interaction.reply({ content: `That ticket type is gone. To report a bug:\n${frontDoor()}`, ephemeral: true })
        return true
      }
      const modal = new ModalBuilder()
        .setCustomId(`ticket:submit:${typeId}`)
        .setTitle(type.label.slice(0, 45))
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('summary')
            .setLabel(type.prompt || 'What is this about?')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(!type.optional)))
      await interaction.showModal(modal)
      return true
    }

    if (interaction.isModalSubmit() && id.startsWith('ticket:submit:')) {
      const typeId = id.slice('ticket:submit:'.length)
      await interaction.deferReply({ ephemeral: true })
      const result = await openTicket(interaction, typeId, interaction.fields.getTextInputValue('summary'))
      await interaction.editReply(!result ? `That ticket type is gone. To report a bug:\n${frontDoor()}`
        : result.number === null ? `You already have a ${result.type.label} ticket open: <#${result.channel.id}>. Add anything new there.`
        : `Ticket opened: <#${result.channel.id}>`)
      return true
    }

    if (interaction.isButton() && id === 'ticket:close') {
      await closeTicket(interaction)
      return true
    }
  } catch (err) {
    console.error('[tickets] interaction failed:', err.message)
    const msg = { content: 'Something went wrong opening that ticket. Tell a moderator.', ephemeral: true }
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {})
    else await interaction.reply(msg).catch(() => {})
  }
  return true
}

module.exports = { TYPES, ensurePanel, handleInteraction, closeTicket }
