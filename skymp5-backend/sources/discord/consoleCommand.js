'use strict'
// The remote staff console's Discord front end: the guild slash command /console command:<text>, answered privately (DESIGN 5)

const { MessageFlags } = require('discord.js')

const SEEN_MS = 15 * 60 * 1000
const MAX_REPLY = 1900
// A modifier letter grave accent: looks like a backtick, cannot end the code block
const TICK = String.fromCharCode(0x02cb)
const seen = new Map()

const ERRORS = Object.freeze({
  consoleOff: 'The console is switched off.',
  unavailable: 'The console is not set up on the server right now.',
  notAllowed: 'The console is for the pinned Owners, Dragon Break Dev and Lead GMs only.',
  noProfile: 'Join the game once with this Discord account first.',
  badCommand: 'Type one command as in game, e.g. /wwremote clear #8KWH',
  tooMany: 'Too many console commands. Wait a few minutes.',
  conflict: 'That request belongs to someone else.',
  badRequest: 'That request could not be read.',
  badCaller: 'The console refused that request (a server bug).',
  badInteraction: 'The console refused that request.',
  wrongGuild: 'The console only works in the Dragon Break server.',
  wrongChannel: 'Use the console in the staff channel.',
  bot: 'Bots cannot use the console.',
})

const fold = text => String(text ?? '').replace(/`/g, TICK)

// The answer as one private message: the header, who it ran as, then the captured lines in a code block, cut to fit
function format(result) {
  const body = result?.body || {}
  if (body.help) return body.help.slice(0, 2000)
  if (!body.job) {
    const base = ERRORS[body.error] || 'The console could not run that.'
    return body.error === 'notRemote' && body.reason ? `${fold(body.reason)}\nNothing was run.` : base
  }
  const j = body.job
  const head = [fold(j.summary), j.as ? fold(j.as) : ''].filter(Boolean).join('\n')
  const lines = (j.lines || []).map(l => `${l.to.padEnd(5)} ${fold(l.text)}`)
  if (!lines.length) return head.slice(0, MAX_REPLY)
  let block = lines.join('\n')
  const room = MAX_REPLY - head.length - 30
  let cut = false
  if (block.length > room) { block = block.slice(0, Math.max(0, room)); cut = true }
  return `${head}\n\`\`\`\n${block}\n\`\`\`${cut ? '\n(cut to fit Discord)' : ''}`.slice(0, 2000)
}

function remembered(id) {
  const t = Date.now()
  for (const [k, at] of seen) { if (t - at <= SEEN_MS && seen.size <= 5000) break; seen.delete(k) }
  if (seen.has(id)) return true
  seen.set(id, t)
  return false
}

// false for anything that is not /console, so another handler can follow; the command runs only once the defer is acknowledged
async function handleInteraction(interaction, given) {
  if (!interaction || typeof interaction.isChatInputCommand !== 'function' || !interaction.isChatInputCommand() || interaction.commandName !== 'console') return false
  const api = given || require('../console').consoleApi()
  const caller = api.discordCaller(interaction)
  if (caller.refused) {
    await interaction.reply({ content: ERRORS[caller.refused] || ERRORS.badInteraction, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
      .catch(err => console.error('[console] refusal reply failed:', err.message))
    return true
  }
  // A replayed INTERACTION_CREATE (a gateway resume) is answered once
  if (remembered(interaction.id)) return true
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  } catch (err) {
    // Past the 3 s window, or another client acknowledged it first: nothing runs, so a retry cannot run it twice
    console.error('[console] defer failed, nothing was run:', err.message)
    return true
  }
  let result
  try {
    result = await api.runStaffCommand(caller, { text: interaction.options.getString('command', true) })
  } catch (err) {
    console.error('[console] run failed:', err.message)
    result = { status: 503, body: { error: 'unavailable' } }
  }
  await interaction.editReply({ content: format(result), allowedMentions: { parse: [] } })
    .catch(err => console.error('[console] reply failed:', err.message))
  return true
}

module.exports = { handleInteraction, format, fold, ERRORS }
