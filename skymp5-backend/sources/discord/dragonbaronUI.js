'use strict'

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  RoleSelectMenuBuilder
} = require('discord.js')

const perms = require('./dragonbaronPermissions')
const spells = require('./spellCatalog')

const GOLD_COLOR = 0xD4AF37
const BLUE_COLOR = 0x2B547E
const RED_COLOR = 0x990000
const GREEN_COLOR = 0x228B22

// -------------------------------------------------------------------------------------------------
// 1. Staff Admin Dashboard UI
// -------------------------------------------------------------------------------------------------

function buildDashboard(caller, memberRoles, lastOutput = null) {
  const allowed = []
  if (perms.hasPermission(memberRoles, 'tickets')) allowed.push('🎫 Tickets')
  if (perms.hasPermission(memberRoles, 'factions')) allowed.push('🛡️ Factions')
  if (perms.hasPermission(memberRoles, 'charters')) allowed.push('📜 Charters')
  if (perms.hasPermission(memberRoles, 'citizenship')) allowed.push('🏛️ Citizenship')
  if (perms.hasPermission(memberRoles, 'items_spells')) allowed.push('🎁 Items & Spells')
  if (perms.hasPermission(memberRoles, 'moderation')) allowed.push('👢 Moderation')
  if (perms.hasPermission(memberRoles, 'bans')) allowed.push('🚫 Bans')
  if (perms.hasPermission(memberRoles, 'announcements')) allowed.push('📢 Announce')
  if (perms.hasPermission(memberRoles, 'world_time')) allowed.push('🕒 Clock')
  if (perms.hasPermission(memberRoles, 'audit_stats')) allowed.push('📊 Audit')
  if (perms.canConfigure(memberRoles)) allowed.push('⚙️ Permissions')

  const embed = new EmbedBuilder()
    .setTitle('🛡️ Dragonbaron Staff Control Panel')
    .setColor(GOLD_COLOR)
    .setDescription(
      `**Operator:** <@${caller.discordId || '0'}> (\`${caller.displayName || 'Staff'}\`)\n` +
      `**Role Authority:** ${allowed.length ? allowed.join(' • ') : '*No modules assigned*'}\n\n` +
      `*Click an action button below to run an administrative task or open an input form.*`
    )
    .setTimestamp()

  if (lastOutput) {
    const text = String(lastOutput).trim()
    const truncated = text.length > 1000 ? text.slice(0, 997) + '...' : text
    embed.addFields({
      name: '📋 Latest Console Execution Output',
      value: `\`\`\`\n${truncated}\n\`\`\``
    })
  }

  const rows = []

  // Row 1: Support Tickets & Factions (if authorized)
  const row1 = new ActionRowBuilder()
  if (perms.hasPermission(memberRoles, 'tickets')) {
    row1.addComponents(
      new ButtonBuilder().setCustomId('db:tickets:list').setLabel('🎫 Open Tickets').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('db:tickets:close_modal').setLabel('✅ Close Ticket').setStyle(ButtonStyle.Secondary)
    )
  }
  if (perms.hasPermission(memberRoles, 'factions')) {
    row1.addComponents(
      new ButtonBuilder().setCustomId('db:factions:list').setLabel('🛡️ Factions').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('db:factions:leader_modal').setLabel('👑 Set Leader').setStyle(ButtonStyle.Secondary)
    )
  }
  if (perms.hasPermission(memberRoles, 'charters')) {
    row1.addComponents(
      new ButtonBuilder().setCustomId('db:charters:list').setLabel('📜 Charters').setStyle(ButtonStyle.Secondary)
    )
  }
  if (row1.components.length > 0) {
    if (row1.components.length > 5) row1.components = row1.components.slice(0, 5)
    rows.push(row1)
  }

  // Row 2: Discipline & Moderation (if authorized)
  const row2 = new ActionRowBuilder()
  if (perms.hasPermission(memberRoles, 'moderation')) {
    row2.addComponents(
      new ButtonBuilder().setCustomId('db:mod:kick_modal').setLabel('👢 Kick').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('db:mod:discipline_modal').setLabel('⚠️ Discipline').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('db:mod:suspend_modal').setLabel('⏱️ Suspend').setStyle(ButtonStyle.Secondary)
    )
  }
  if (perms.hasPermission(memberRoles, 'bans')) {
    row2.addComponents(
      new ButtonBuilder().setCustomId('db:mod:ban_modal').setLabel('🚫 Ban').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('db:mod:bans_list').setLabel('📋 Active Bans').setStyle(ButtonStyle.Secondary)
    )
  }
  if (row2.components.length > 0) {
    if (row2.components.length > 5) row2.components = row2.components.slice(0, 5)
    rows.push(row2)
  }

  // Row 3: Announcements, World Time & Audit
  const row3 = new ActionRowBuilder()
  if (perms.hasPermission(memberRoles, 'announcements')) {
    row3.addComponents(
      new ButtonBuilder().setCustomId('db:world:announce_modal').setLabel('📢 Announce').setStyle(ButtonStyle.Primary)
    )
  }
  if (perms.hasPermission(memberRoles, 'citizenship')) {
    row3.addComponents(
      new ButtonBuilder().setCustomId('db:citizen:modal').setLabel('🏛️ Citizenship').setStyle(ButtonStyle.Secondary)
    )
  }
  if (perms.hasPermission(memberRoles, 'world_time')) {
    row3.addComponents(
      new ButtonBuilder().setCustomId('db:world:time').setLabel('🕒 Tamriel Time').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('db:world:settime_modal').setLabel('⏩ Set Hour').setStyle(ButtonStyle.Secondary)
    )
  }
  if (perms.hasPermission(memberRoles, 'audit_stats')) {
    row3.addComponents(
      new ButtonBuilder().setCustomId('db:audit:stats').setLabel('📊 7d Audit').setStyle(ButtonStyle.Secondary)
    )
  }
  if (row3.components.length > 0) {
    if (row3.components.length > 5) row3.components = row3.components.slice(0, 5)
    rows.push(row3)
  }

  // Row 4: Secondary tools & Settings
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('db:panel:refresh').setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary)
  )
  if (perms.hasPermission(memberRoles, 'audit_stats')) {
    row4.addComponents(
      new ButtonBuilder().setCustomId('db:audit:players').setLabel('👥 Players').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('db:audit:whoami').setLabel('👤 Whoami').setStyle(ButtonStyle.Secondary)
    )
  }
  if (perms.canConfigure(memberRoles)) {
    row4.addComponents(
      new ButtonBuilder().setCustomId('db:config:open').setLabel('⚙️ Permissions').setStyle(ButtonStyle.Success)
    )
  }
  if (row4.components.length > 5) row4.components = row4.components.slice(0, 5)
  rows.push(row4)

  // Row 5: Items, Spells & Player Assistance (Unstuck)
  const row5 = new ActionRowBuilder()
  if (perms.hasPermission(memberRoles, 'items_spells')) {
    row5.addComponents(
      new ButtonBuilder().setCustomId('db:items:give_modal').setLabel('🎁 Give Item').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('db:items:take_modal').setLabel('📦 Take Item').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('db:spells:give_modal').setLabel('✨ Give Spell').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('db:spells:remove_modal').setLabel('🪄 Remove Spell').setStyle(ButtonStyle.Secondary)
    )
  }
  if (perms.hasPermission(memberRoles, 'items_spells') || perms.hasPermission(memberRoles, 'tickets') || perms.hasPermission(memberRoles, 'moderation')) {
    row5.addComponents(
      new ButtonBuilder().setCustomId('db:player:unstuck_modal').setLabel('📍 Unstuck').setStyle(ButtonStyle.Primary)
    )
  }
  if (row5.components.length > 0) {
    if (row5.components.length > 5) row5.components = row5.components.slice(0, 5)
    rows.push(row5)
  }

  return { embeds: [embed], components: rows }
}

// -------------------------------------------------------------------------------------------------
// 2. Interactive Spell Picker View (Dropdown Menus)
// -------------------------------------------------------------------------------------------------

function buildSpellPickerView({ target, mode = 'give', category = 'popular', ticket = '', lastOutput = null, lastSpell = null }) {
  const catLabel = spells.getCategoryLabel(category)
  const spellOptions = spells.getSpellsForCategory(category)
  const isGive = mode === 'give'
  const safeTicket = (ticket || '').replace(/[^a-zA-Z0-9:_-]/g, '') || 'none'
  const safeTarget = (target || '').replace(/[^a-zA-Z0-9#_ -]/g, '').trim()

  const embed = new EmbedBuilder()
    .setTitle(isGive ? `✨ Grant Spell to Player: ${safeTarget}` : `🪄 Remove Spell from Player: ${safeTarget}`)
    .setColor(isGive ? GOLD_COLOR : RED_COLOR)
    .setDescription(
      `**Target Player:** \`${safeTarget}\`${ticket && ticket !== 'none' ? ` • **Ticket:** \`${ticket}\`` : ''}\n` +
      `**Action Mode:** ${isGive ? 'Grant spell to player spells list' : 'Remove spell from player spells list'}\n` +
      `**Selected Category:** ${catLabel} (${spellOptions.length} spells listed)\n\n` +
      `*1. Choose a magic school or tier from the first dropdown to switch categories.*\n` +
      `*2. Click a spell in the second dropdown to instantly execute ${isGive ? '/givespell' : '/removespell'}.*`
    )
    .setTimestamp()

  if (lastOutput) {
    const text = String(lastOutput).trim()
    const truncated = text.length > 1000 ? text.slice(0, 997) + '...' : text
    embed.addFields({
      name: isGive ? '📋 Spell Grant Execution Output' : '📋 Spell Removal Execution Output',
      value: `\`\`\`\n${truncated}\n\`\`\``
    })
  }

  const rows = []

  // Component Row 1: Magic School & Tier Selector
  const catSelect = new StringSelectMenuBuilder()
    .setCustomId(`db:spcat:${mode}:${safeTarget}:${safeTicket}`)
    .setPlaceholder('Switch Magic School / Tier...')

  for (const c of spells.getCategories()) {
    catSelect.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(c.label.slice(0, 100))
        .setValue(c.id)
        .setDescription(c.desc.slice(0, 100))
        .setDefault(c.id === category)
    )
  }
  rows.push(new ActionRowBuilder().addComponents(catSelect))

  // Component Row 2: Spell Dropdown
  const spellSelect = new StringSelectMenuBuilder()
    .setCustomId(`db:sppick:${mode}:${category}:${safeTarget}:${safeTicket}`)
    .setPlaceholder(`Select spell to ${isGive ? 'grant' : 'remove'}...`)

  for (const s of spellOptions) {
    spellSelect.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(s.displayName.slice(0, 100))
        .setValue(s.name.slice(0, 100))
        .setDescription(`[${s.rank}] ${s.tomeName}`.slice(0, 100))
    )
  }
  rows.push(new ActionRowBuilder().addComponents(spellSelect))

  // Component Row 3: Quick Action Buttons
  const row3 = new ActionRowBuilder()
  if (isGive && lastSpell) {
    const safeSpellName = lastSpell.replace(/[:]/g, '').slice(0, 32)
    row3.addComponents(
      new ButtonBuilder()
        .setCustomId(`db:sptome:${safeTarget}:${safeSpellName}:${safeTicket}`)
        .setLabel(`🎁 Give Tome: ${lastSpell.slice(0, 25)}`)
        .setStyle(ButtonStyle.Success)
    )
  }
  row3.addComponents(
    new ButtonBuilder().setCustomId(`db:spmode:${isGive ? 'remove' : 'give'}:${safeTarget}:${safeTicket}`).setLabel(`🔄 Switch to ${isGive ? 'Remove' : 'Give'}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`db:spretarget:${mode}:${safeTicket}`).setLabel('🎯 Change Target').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('db:panel:back_to_dash').setLabel('⬅️ Back to Dashboard').setStyle(ButtonStyle.Secondary)
  )
  if (row3.components.length > 5) row3.components = row3.components.slice(0, 5)
  rows.push(row3)

  return { embeds: [embed], components: rows }
}

// -------------------------------------------------------------------------------------------------
// 3. Permission Configuration Menu UI
// -------------------------------------------------------------------------------------------------

function buildConfigOverview() {
  const current = perms.loadPermissions()
  const embed = new EmbedBuilder()
    .setTitle('⚙️ Dragonbaron Permission & Role Configuration')
    .setColor(BLUE_COLOR)
    .setDescription(
      'Assign Discord roles to control access for each administrative action module.\n' +
      '*Select a category from the dropdown below to view or edit its allowed roles.*'
    )
    .setTimestamp()

  for (const [key, node] of Object.entries(current)) {
    const rolesText = (node.allowedRoles && node.allowedRoles.length > 0)
      ? node.allowedRoles.map(r => `<@&${r}>`).join(', ')
      : '*No roles assigned*'
    embed.addFields({
      name: `${node.label} (\`${key}\`)`,
      value: `${node.description}\n**Allowed Roles:** ${rolesText}`
    })
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('db:config:select_node')
    .setPlaceholder('Select a permission category to edit...')

  const labels = {
    tickets: '🎫 GM Tickets & Support',
    factions: '🛡️ Faction Roster & Leadership',
    charters: '📜 Faction Charters Review',
    citizenship: '🏛️ Citizenship & Immigration',
    items_spells: '🎁 Items & Spells Management',
    moderation: '👢 Player Discipline & Suspensions',
    bans: '🚫 Account Bans & Active Ban List',
    announcements: '📢 Server Announcements',
    world_time: '🕒 World Clock & Date Control',
    audit_stats: '📊 Staff Audit & Diagnostics',
    config: '⚙️ Permission & Role Configuration'
  }

  for (const [key, node] of Object.entries(current)) {
    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(labels[key] || node.label)
        .setValue(key)
        .setDescription(node.description.slice(0, 100))
    )
  }

  const row1 = new ActionRowBuilder().addComponents(selectMenu)
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('db:panel:back_to_dash').setLabel('⬅️ Back to Control Panel').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('db:config:reset_all').setLabel('⚠️ Reset ALL to Defaults').setStyle(ButtonStyle.Danger)
  )

  return { embeds: [embed], components: [row1, row2] }
}

function buildConfigNodeEditor(nodeKey, selectedRoles = null) {
  const current = perms.loadPermissions()
  const node = current[nodeKey]
  if (!node) return buildConfigOverview()

  const activeRoles = selectedRoles !== null ? selectedRoles : node.allowedRoles

  const embed = new EmbedBuilder()
    .setTitle(`⚙️ Edit Permission: ${node.label}`)
    .setColor(BLUE_COLOR)
    .setDescription(
      `**Description:** ${node.description}\n\n` +
      `**Currently Assigned Roles:**\n` +
      (activeRoles.length ? activeRoles.map(r => `<@&${r}>`).join(', ') : '*None selected (access disabled for this module)*') +
      `\n\n*Use the role selector below to pick the roles that should have access to this action.*`
    )
    .setFooter({ text: `Module key: ${nodeKey}` })

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`db:config:roles:${nodeKey}`)
    .setPlaceholder('Pick Discord roles for this permission...')
    .setMinValues(0)
    .setMaxValues(10)

  const row1 = new ActionRowBuilder().addComponents(roleSelect)
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`db:config:reset_node:${nodeKey}`).setLabel('🔄 Reset Node Defaults').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('db:config:overview').setLabel('⬅️ Back to Permissions List').setStyle(ButtonStyle.Secondary)
  )

  return { embeds: [embed], components: [row1, row2] }
}

// -------------------------------------------------------------------------------------------------
// 4. Modals Builder
// -------------------------------------------------------------------------------------------------

function buildModal(customId, title, fields) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45))
  for (const f of fields) {
    const input = new TextInputBuilder()
      .setCustomId(f.id)
      .setLabel(f.label.slice(0, 45))
      .setStyle(f.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setPlaceholder(f.placeholder ? f.placeholder.slice(0, 100) : '')
      .setRequired(f.required !== false)
    if (f.value) input.setValue(String(f.value))
    if (f.minLength) input.setMinLength(f.minLength)
    if (f.maxLength) input.setMaxLength(f.maxLength)
    modal.addComponents(new ActionRowBuilder().addComponents(input))
  }
  return modal
}

function buildUnstuckModal() {
  return buildModal('db:modal:unstuck', 'Unstuck Player to Safety', [
    { id: 'target', label: 'Player #TAG or Name (e.g. #TW2F or Jorik)', placeholder: '#TW2F' },
    { id: 'dest', label: 'Destination (hub | respawn, default: hub)', placeholder: 'hub', value: 'hub', required: false },
    { id: 'ticket', label: 'Ticket / Call Ref (e.g. ticket:481)', placeholder: 'ticket:481', required: false }
  ])
}

module.exports = {
  buildDashboard,
  buildSpellPickerView,
  buildConfigOverview,
  buildConfigNodeEditor,
  buildModal,
  buildUnstuckModal,
  GOLD_COLOR,
  BLUE_COLOR,
  RED_COLOR,
  GREEN_COLOR
}
