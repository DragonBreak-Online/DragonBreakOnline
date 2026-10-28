'use strict'

const { MessageFlags } = require('discord.js')
const perms = require('./dragonbaronPermissions')
const ui = require('./dragonbaronUI')
const spells = require('./spellCatalog')

// Extract caller role IDs
function rolesOf(interaction) {
  const r = interaction.member?.roles
  const list = r?.cache && typeof r.cache.keys === 'function' ? [...r.cache.keys()] : Array.isArray(r) ? r : []
  return list.map(String)
}

// Extract console caller from interaction
function getCaller(interaction, api) {
  return api.discordCaller(interaction)
}

// Format command result text cleanly
function formatOutput(res) {
  const body = res?.body || {}
  if (body.error) return `Refused: ${body.error} ${body.reason ? `(${body.reason})` : ''}`
  if (!body.job) return 'Action submitted.'
  const lines = (body.job.lines || []).map(l => l.text)
  if (lines.length) return lines.join('\n')
  return body.job.why ? `Result: ${body.job.why}` : 'Command completed.'
}

async function handleInteraction(interaction, givenApi) {
  if (!interaction) return false
  // /dragonbaron ask has its own handler, before the console and the generic defer: it reads server data and runs nothing
  if (interaction.isChatInputCommand?.() && interaction.commandName === 'dragonbaron' && interaction.options?.getSubcommand?.(false) === 'ask') return require('./dragonbaronAsk').handleInteraction(interaction)

  const api = givenApi || require('../console').consoleApi()
  const memberRoles = rolesOf(interaction)

  // -----------------------------------------------------------------------------------------------
  // 1. Slash Commands (/dragonbaron admin, /dragonbaron config, /admin)
  // -----------------------------------------------------------------------------------------------
  if (interaction.isChatInputCommand()) {
    const cmd = interaction.commandName
    if (cmd !== 'dragonbaron' && cmd !== 'admin') return false

    const sub = cmd === 'dragonbaron' ? interaction.options.getSubcommand(false) : 'admin'

    // Defer immediately to ensure Discord's 3-second acknowledgement window is met
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {})

    if (sub === 'config') {
      if (!perms.canConfigure(memberRoles)) {
        await interaction.editReply({
          content: '❌ You do not have permission to manage Dragonbaron role permissions.'
        }).catch(() => {})
        return true
      }
      const view = ui.buildConfigOverview()
      await interaction.editReply(view).catch(err => {
        console.error('[dragonbaron] config editReply failed:', err.message)
      })
      return true
    }

    // Default: 'admin' control panel
    if (!perms.canAccessPanel(memberRoles)) {
      await interaction.editReply({
        content: '❌ You do not have permission to access the Dragonbaron Staff Control Panel.'
      }).catch(() => {})
      return true
    }

    const caller = getCaller(interaction, api)
    const view = ui.buildDashboard(caller, memberRoles)
    await interaction.editReply(view).catch(err => {
      console.error('[dragonbaron] dashboard editReply failed:', err.message)
    })
    return true
  }

  // -----------------------------------------------------------------------------------------------
  // 2. Button Interactions (customId: db:...)
  // -----------------------------------------------------------------------------------------------
  if (interaction.isButton()) {
    const id = interaction.customId || ''
    if (!id.startsWith('db:')) return false

    const caller = getCaller(interaction, api)

    // Navigation & Config Buttons
    if (id === 'db:panel:refresh' || id === 'db:panel:back_to_dash') {
      const view = ui.buildDashboard(caller, memberRoles)
      await interaction.update(view).catch(() => {})
      return true
    }

    if (id === 'db:config:open' || id === 'db:config:overview') {
      if (!perms.canConfigure(memberRoles)) {
        await interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const view = ui.buildConfigOverview()
      await interaction.update(view).catch(() => {})
      return true
    }

    if (id === 'db:config:reset_all') {
      if (!perms.canConfigure(memberRoles)) return true
      perms.resetAll()
      const view = ui.buildConfigOverview()
      await interaction.update(view).catch(() => {})
      return true
    }

    if (id.startsWith('db:config:reset_node:')) {
      if (!perms.canConfigure(memberRoles)) return true
      const nodeKey = id.split(':')[3]
      perms.resetPermissionRoles(nodeKey)
      const view = ui.buildConfigNodeEditor(nodeKey)
      await interaction.update(view).catch(() => {})
      return true
    }

    // Modal Triggers: Items
    if (id === 'db:items:give_modal') {
      if (!perms.hasPermission(memberRoles, 'items_spells')) {
        await interaction.reply({ content: '❌ Missing permission: `items_spells`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildModal('db:modal:item_give', 'Give Item to Player', [
        { id: 'target', label: 'Player #TAG or Name', placeholder: '#NH4L or Katell' },
        { id: 'item', label: 'Item Name or ID (e.g. Lockpick, Gold)', placeholder: 'Spell Tome: Comforting Bosom' },
        { id: 'count', label: 'Quantity / Count (default 1)', placeholder: '1', value: '1', required: false },
        { id: 'ticket', label: 'Ticket / Call Ref (e.g. ticket:328)', placeholder: 'ticket:328', required: false }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    if (id === 'db:items:take_modal') {
      if (!perms.hasPermission(memberRoles, 'items_spells')) {
        await interaction.reply({ content: '❌ Missing permission: `items_spells`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildModal('db:modal:item_take', 'Take Item from Player', [
        { id: 'target', label: 'Player #TAG or Name', placeholder: '#NH4L or Katell' },
        { id: 'item', label: 'Item Name or ID', placeholder: 'Spell Tome: Divine Bolt' },
        { id: 'count', label: 'Quantity / Count (default 1)', placeholder: '1', value: '1', required: false },
        { id: 'ticket', label: 'Ticket / Call Ref (e.g. ticket:328)', placeholder: 'ticket:328', required: false }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    // Modal Triggers: Spells (Prompts for target, then opens the interactive Spell Selection View)
    if (id === 'db:spells:give_modal') {
      if (!perms.hasPermission(memberRoles, 'items_spells')) {
        await interaction.reply({ content: '❌ Missing permission: `items_spells`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildModal('db:modal:spell_target_give', 'Grant Spell: Target Player', [
        { id: 'target', label: 'Player #TAG or Character Name', placeholder: '#NH4L or Katell' },
        { id: 'ticket', label: 'Ticket / Call Ref (e.g. ticket:328)', placeholder: 'ticket:328', required: false }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    if (id === 'db:spells:remove_modal') {
      if (!perms.hasPermission(memberRoles, 'items_spells')) {
        await interaction.reply({ content: '❌ Missing permission: `items_spells`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildModal('db:modal:spell_target_remove', 'Remove Spell: Target Player', [
        { id: 'target', label: 'Player #TAG or Character Name', placeholder: '#NH4L or Katell' },
        { id: 'ticket', label: 'Ticket / Call Ref (e.g. ticket:328)', placeholder: 'ticket:328', required: false }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    // Modal Trigger: Unstuck Player
    if (id === 'db:player:unstuck_modal') {
      if (!perms.hasPermission(memberRoles, 'items_spells') && !perms.hasPermission(memberRoles, 'tickets') && !perms.hasPermission(memberRoles, 'moderation')) {
        await interaction.reply({ content: '❌ Missing permission to unstuck players.', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildUnstuckModal()
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    // Spell Picker Quick Actions
    if (id.startsWith('db:sptome:')) {
      if (!perms.hasPermission(memberRoles, 'items_spells')) {
        await interaction.reply({ content: '❌ Missing permission: `items_spells`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      await interaction.deferUpdate().catch(() => {})
      const parts = id.split(':')
      const target = parts[2]
      const spellName = parts[3]
      const ticket = parts[4] === 'none' ? '' : parts[4]
      const tomeName = spells.findTomeForSpell(spellName)
      const cmdText = `/giveitem ${target} "${tomeName}" 1${ticket ? ` ${ticket}` : ''}`

      let result
      try {
        result = await api.runStaffCommand(caller, { text: cmdText })
      } catch (err) {
        result = { status: 500, body: { error: err.message } }
      }
      const output = formatOutput(result)
      const view = ui.buildSpellPickerView({ target, mode: 'give', category: 'popular', ticket, lastOutput: output })
      await interaction.editReply(view).catch(() => {})
      return true
    }

    if (id.startsWith('db:spmode:')) {
      const parts = id.split(':')
      const newMode = parts[2]
      const target = parts[3]
      const ticket = parts[4] === 'none' ? '' : parts[4]
      const view = ui.buildSpellPickerView({ target, mode: newMode, category: 'popular', ticket })
      await interaction.update(view).catch(() => {})
      return true
    }

    if (id.startsWith('db:spretarget:')) {
      const parts = id.split(':')
      const mode = parts[2]
      const modal = ui.buildModal(mode === 'remove' ? 'db:modal:spell_target_remove' : 'db:modal:spell_target_give', 'Change Target Player', [
        { id: 'target', label: 'Player #TAG or Character Name', placeholder: '#NH4L or Katell' },
        { id: 'ticket', label: 'Ticket / Call Ref (e.g. ticket:328)', placeholder: 'ticket:328', required: false }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    // Other standard modals
    if (id === 'db:citizen:modal') {
      if (!perms.hasPermission(memberRoles, 'citizenship')) {
        await interaction.reply({ content: '❌ Missing permission: `citizenship`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildModal('db:modal:citizenship', 'Citizenship Management', [
        { id: 'target', label: 'Player #TAG or Name (e.g. #TW2F or Jorik)', placeholder: '#TW2F' },
        { id: 'action', label: 'Action (view | cooldown | grant | revoke)', placeholder: 'view', value: 'view' },
        { id: 'param', label: 'Parameter (e.g. 0 to clear, or hold name)', placeholder: '0 or winterhold', required: false },
        { id: 'ticket', label: 'Ticket / Call Ref (e.g. ticket:481)', placeholder: 'ticket:481', required: false }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    if (id === 'db:tickets:close_modal') {
      if (!perms.hasPermission(memberRoles, 'tickets')) {
        await interaction.reply({ content: '❌ Missing permission: `tickets`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildModal('db:modal:ticket_close', 'Close GM Ticket', [
        { id: 'num', label: 'Ticket # (e.g. 320)', placeholder: '320' },
        { id: 'note', label: 'Resolution Note', placeholder: 'Handled in game / resolved', required: false, paragraph: true }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    if (id === 'db:factions:leader_modal' || id === 'db:factions:leader') {
      if (!perms.hasPermission(memberRoles, 'factions')) {
        await interaction.reply({ content: '❌ Missing permission: `factions`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildModal('db:modal:faction_leader', 'Appoint Faction Leader', [
        { id: 'tag', label: 'New Leader Character #TAG (e.g. #35QE)', placeholder: '#35QE' },
        { id: 'faction', label: 'Faction ID (e.g. imperial-cult)', placeholder: 'imperial-cult' }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    if (id === 'db:mod:kick_modal') {
      if (!perms.hasPermission(memberRoles, 'moderation')) {
        await interaction.reply({ content: '❌ Missing permission: `moderation`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildModal('db:modal:kick', 'Kick Online Player', [
        { id: 'tag', label: 'Target Character #TAG', placeholder: '#TAG' }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    if (id === 'db:mod:discipline_modal') {
      if (!perms.hasPermission(memberRoles, 'moderation')) {
        await interaction.reply({ content: '❌ Missing permission: `moderation`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildModal('db:modal:discipline', 'Discipline Player Record', [
        { id: 'tag', label: 'Target Character #TAG', placeholder: '#TAG' },
        { id: 'kind', label: 'Action Kind (warn | strike)', placeholder: 'warn' },
        { id: 'reason', label: 'Reason for record', paragraph: true }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    if (id === 'db:mod:suspend_modal') {
      if (!perms.hasPermission(memberRoles, 'moderation')) {
        await interaction.reply({ content: '❌ Missing permission: `moderation`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildModal('db:modal:suspend', 'Suspend Account (Tempban)', [
        { id: 'tag', label: 'Target Character #TAG', placeholder: '#TAG' },
        { id: 'length', label: 'Length (e.g. 12h, 3d)', placeholder: '12h' },
        { id: 'reason', label: 'Reason for suspension', paragraph: true }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    if (id === 'db:mod:ban_modal') {
      if (!perms.hasPermission(memberRoles, 'bans')) {
        await interaction.reply({ content: '❌ Missing permission: `bans`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildModal('db:modal:ban', 'Permanent Account Ban', [
        { id: 'tag', label: 'Target Character #TAG', placeholder: '#TAG' },
        { id: 'reason', label: 'Reason for permanent ban', paragraph: true }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    if (id === 'db:world:announce_modal') {
      if (!perms.hasPermission(memberRoles, 'announcements')) {
        await interaction.reply({ content: '❌ Missing permission: `announcements`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildModal('db:modal:announce', 'Server-Wide Announcement', [
        { id: 'text', label: 'Announcement Message', paragraph: true, placeholder: 'Important server announcement text...' }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    if (id === 'db:world:settime_modal') {
      if (!perms.hasPermission(memberRoles, 'world_time')) {
        await interaction.reply({ content: '❌ Missing permission: `world_time`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      const modal = ui.buildModal('db:modal:settime', 'Set Tamriel Clock Hour', [
        { id: 'hour', label: 'Target Hour (0 to 23.99)', placeholder: '12' }
      ])
      await interaction.showModal(modal).catch(err => console.error('[dragonbaron] modal error:', err.message))
      return true
    }

    // Direct Action Execution Buttons
    await interaction.deferUpdate().catch(() => {})

    let cmdText = ''
    if (id === 'db:tickets:list' && perms.hasPermission(memberRoles, 'tickets')) cmdText = '/gm list all'
    else if (id === 'db:factions:list' && perms.hasPermission(memberRoles, 'factions')) cmdText = '/faction list'
    else if (id === 'db:charters:list' && perms.hasPermission(memberRoles, 'charters')) cmdText = '/charter list all'
    else if (id === 'db:mod:bans_list' && perms.hasPermission(memberRoles, 'bans')) cmdText = '/bans'
    else if (id === 'db:world:time' && perms.hasPermission(memberRoles, 'world_time')) cmdText = '/time'
    else if (id === 'db:audit:stats' && perms.hasPermission(memberRoles, 'audit_stats')) cmdText = '/staffstats'
    else if (id === 'db:audit:players' && perms.hasPermission(memberRoles, 'audit_stats')) cmdText = '/players'
    else if (id === 'db:audit:whoami' && perms.hasPermission(memberRoles, 'audit_stats')) cmdText = '/whoami'

    if (!cmdText) {
      const view = ui.buildDashboard(caller, memberRoles, 'Permission denied or unknown action.')
      await interaction.editReply(view).catch(() => {})
      return true
    }

    let result
    try {
      result = await api.runStaffCommand(caller, { text: cmdText })
    } catch (err) {
      result = { status: 500, body: { error: err.message } }
    }

    const output = formatOutput(result)
    const view = ui.buildDashboard(caller, memberRoles, output)
    await interaction.editReply(view).catch(() => {})
    return true
  }

  // -----------------------------------------------------------------------------------------------
  // 3. Select Menus (customId: db:config:..., db:spcat:..., db:sppick:...)
  // -----------------------------------------------------------------------------------------------
  if (interaction.isStringSelectMenu()) {
    const id = interaction.customId || ''

    if (id === 'db:config:select_node') {
      if (!perms.canConfigure(memberRoles)) return true
      const selectedNode = interaction.values[0]
      const view = ui.buildConfigNodeEditor(selectedNode)
      await interaction.update(view).catch(() => {})
      return true
    }

    // Spell Picker: Category Change
    if (id.startsWith('db:spcat:')) {
      const parts = id.split(':')
      const mode = parts[2]
      const target = parts[3]
      const ticket = parts[4] === 'none' ? '' : parts[4]
      const selectedCategory = interaction.values[0]
      const view = ui.buildSpellPickerView({ target, mode, category: selectedCategory, ticket })
      await interaction.update(view).catch(() => {})
      return true
    }

    // Spell Picker: Spell Selection (Executes /givespell or /removespell immediately)
    if (id.startsWith('db:sppick:')) {
      if (!perms.hasPermission(memberRoles, 'items_spells')) {
        await interaction.reply({ content: '❌ Missing permission: `items_spells`', flags: MessageFlags.Ephemeral }).catch(() => {})
        return true
      }
      await interaction.deferUpdate().catch(() => {})

      const parts = id.split(':')
      const mode = parts[2]
      const category = parts[3]
      const target = parts[4]
      const ticket = parts[5] === 'none' ? '' : parts[5]
      const selectedSpell = interaction.values[0]
      const caller = getCaller(interaction, api)

      const isGive = mode === 'give'
      const cmdText = `/${isGive ? 'givespell' : 'removespell'} ${target} "${selectedSpell}"${ticket ? ` ${ticket}` : ''}`

      let result
      try {
        result = await api.runStaffCommand(caller, { text: cmdText })
      } catch (err) {
        result = { status: 500, body: { error: err.message } }
      }

      const output = formatOutput(result)
      const view = ui.buildSpellPickerView({
        target,
        mode,
        category,
        ticket,
        lastOutput: output,
        lastSpell: selectedSpell
      })
      await interaction.editReply(view).catch(() => {})
      return true
    }
  }

  if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('db:config:roles:')) {
    if (!perms.canConfigure(memberRoles)) return true
    const nodeKey = interaction.customId.split(':')[3]
    const selectedRoles = interaction.values || []
    perms.setPermissionRoles(nodeKey, selectedRoles)
    const view = ui.buildConfigNodeEditor(nodeKey, selectedRoles)
    await interaction.update(view).catch(() => {})
    return true
  }

  // -----------------------------------------------------------------------------------------------
  // 4. Modal Submissions (customId: db:modal:...)
  // -----------------------------------------------------------------------------------------------
  if (interaction.isModalSubmit()) {
    const id = interaction.customId || ''
    if (!id.startsWith('db:modal:')) return false

    const caller = getCaller(interaction, api)

    // Spell Target Modals (Transition directly to interactive Spell Selection Menu)
    if (id === 'db:modal:spell_target_give' && perms.hasPermission(memberRoles, 'items_spells')) {
      const target = interaction.fields.getTextInputValue('target').trim()
      const ticket = (interaction.fields.getTextInputValue('ticket') || '').trim()
      const view = ui.buildSpellPickerView({ target, mode: 'give', category: 'popular', ticket })
      await interaction.reply({ ...view, flags: MessageFlags.Ephemeral }).catch(async () => {
        await interaction.update(view).catch(() => {})
      })
      return true
    }

    if (id === 'db:modal:spell_target_remove' && perms.hasPermission(memberRoles, 'items_spells')) {
      const target = interaction.fields.getTextInputValue('target').trim()
      const ticket = (interaction.fields.getTextInputValue('ticket') || '').trim()
      const view = ui.buildSpellPickerView({ target, mode: 'remove', category: 'popular', ticket })
      await interaction.reply({ ...view, flags: MessageFlags.Ephemeral }).catch(async () => {
        await interaction.update(view).catch(() => {})
      })
      return true
    }

    // Modal submit requiring console command execution
    await interaction.deferUpdate().catch(() => {})

    let cmdText = ''
    if (id === 'db:modal:unstuck' && (perms.hasPermission(memberRoles, 'items_spells') || perms.hasPermission(memberRoles, 'tickets') || perms.hasPermission(memberRoles, 'moderation'))) {
      const target = interaction.fields.getTextInputValue('target').trim()
      const dest = (interaction.fields.getTextInputValue('dest') || 'hub').trim().toLowerCase()
      const ticket = (interaction.fields.getTextInputValue('ticket') || '').trim()
      cmdText = `/unstuck ${target} ${dest || 'hub'}${ticket ? ` ${ticket}` : ''}`
    } else if (id === 'db:modal:item_give' && perms.hasPermission(memberRoles, 'items_spells')) {
      const target = interaction.fields.getTextInputValue('target').trim()
      const item = interaction.fields.getTextInputValue('item').trim()
      const count = (interaction.fields.getTextInputValue('count') || '1').trim()
      const ticket = (interaction.fields.getTextInputValue('ticket') || '').trim()
      cmdText = `/giveitem ${target} ${item} ${count}${ticket ? ` ${ticket}` : ''}`
    } else if (id === 'db:modal:item_take' && perms.hasPermission(memberRoles, 'items_spells')) {
      const target = interaction.fields.getTextInputValue('target').trim()
      const item = interaction.fields.getTextInputValue('item').trim()
      const count = (interaction.fields.getTextInputValue('count') || '1').trim()
      const ticket = (interaction.fields.getTextInputValue('ticket') || '').trim()
      cmdText = `/takeitem ${target} ${item} ${count}${ticket ? ` ${ticket}` : ''}`
    } else if (id === 'db:modal:citizenship' && perms.hasPermission(memberRoles, 'citizenship')) {
      const target = interaction.fields.getTextInputValue('target').trim()
      const action = interaction.fields.getTextInputValue('action').trim().toLowerCase()
      const param = (interaction.fields.getTextInputValue('param') || '').trim()
      const ticket = (interaction.fields.getTextInputValue('ticket') || '').trim()
      cmdText = `/citizenship ${target} ${action}${param ? ` ${param}` : ''}${ticket ? ` ${ticket}` : ''}`
    } else if (id === 'db:modal:ticket_close' && perms.hasPermission(memberRoles, 'tickets')) {
      const num = interaction.fields.getTextInputValue('num').trim()
      const note = (interaction.fields.getTextInputValue('note') || '').trim()
      cmdText = `/gm close ${num}${note ? ` ${note}` : ''}`
    } else if (id === 'db:modal:faction_leader' && perms.hasPermission(memberRoles, 'factions')) {
      const tag = interaction.fields.getTextInputValue('tag').trim()
      const faction = interaction.fields.getTextInputValue('faction').trim()
      cmdText = `/faction leader ${tag} ${faction}`
    } else if (id === 'db:modal:kick' && perms.hasPermission(memberRoles, 'moderation')) {
      const tag = interaction.fields.getTextInputValue('tag').trim()
      cmdText = `/kick ${tag}`
    } else if (id === 'db:modal:discipline' && perms.hasPermission(memberRoles, 'moderation')) {
      const tag = interaction.fields.getTextInputValue('tag').trim()
      const kind = interaction.fields.getTextInputValue('kind').trim().toLowerCase()
      const reason = interaction.fields.getTextInputValue('reason').trim()
      cmdText = `/discipline ${tag} ${kind} ${reason}`
    } else if (id === 'db:modal:suspend' && perms.hasPermission(memberRoles, 'moderation')) {
      const tag = interaction.fields.getTextInputValue('tag').trim()
      const length = interaction.fields.getTextInputValue('length').trim()
      const reason = interaction.fields.getTextInputValue('reason').trim()
      cmdText = `/tempban ${tag} ${length} ${reason}`
    } else if (id === 'db:modal:ban' && perms.hasPermission(memberRoles, 'bans')) {
      const tag = interaction.fields.getTextInputValue('tag').trim()
      const reason = interaction.fields.getTextInputValue('reason').trim()
      cmdText = `/ban ${tag} ${reason}`
    } else if (id === 'db:modal:announce' && perms.hasPermission(memberRoles, 'announcements')) {
      const text = interaction.fields.getTextInputValue('text').trim()
      cmdText = `/announce ${text}`
    } else if (id === 'db:modal:settime' && perms.hasPermission(memberRoles, 'world_time')) {
      const hour = interaction.fields.getTextInputValue('hour').trim()
      cmdText = `/settime ${hour}`
    }

    if (!cmdText) {
      const view = ui.buildDashboard(caller, memberRoles, 'Action canceled or permission denied.')
      await interaction.editReply(view).catch(() => {})
      return true
    }

    let result
    try {
      result = await api.runStaffCommand(caller, { text: cmdText })
    } catch (err) {
      result = { status: 500, body: { error: err.message } }
    }

    const output = formatOutput(result)
    const view = ui.buildDashboard(caller, memberRoles, output)
    await interaction.editReply(view).catch(() => {})
    return true
  }

  return false
}

module.exports = { handleInteraction }
