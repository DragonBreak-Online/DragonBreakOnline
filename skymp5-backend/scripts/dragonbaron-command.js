#!/usr/bin/env node
'use strict'
// The /dragonbaron and /admin guild commands: show [--save <file>] | register [--yes] | register --from <file> [--yes]
// show and a register without --yes only GET; register --yes POSTs (an upsert by name) only the commands that changed

const fs = require('fs')
const { request } = require('./console-command')

const COMMANDS = [
  {
    name: 'dragonbaron',
    type: 1,
    description: 'Dragonbaron administrative tools and control panel',
    default_member_permissions: '0',
    contexts: [0],
    integration_types: [0],
    options: [
      {
        type: 1, // SUB_COMMAND
        name: 'admin',
        description: 'Open the Dragonbaron staff control panel'
      },
      {
        type: 1, // SUB_COMMAND
        name: 'config',
        description: 'Manage permissions and role assignments'
      },
      {
        type: 1, // SUB_COMMAND
        name: 'ask',
        description: 'Ask Dragonbaron about the server (staff only, private answer, runs nothing)',
        options: [
          { type: 3, name: 'question', description: 'Your question about the server, rules, reports or staff work', required: true, min_length: 3, max_length: 500 }
        ]
      }
    ]
  },
  {
    name: 'admin',
    type: 1,
    description: 'Open the Dragonbaron staff control panel',
    default_member_permissions: '0',
    contexts: [0],
    integration_types: [0]
  }
]

const NAMES = new Set(COMMANDS.map(c => c.name))
const SNOWFLAKE = /^\d{17,20}$/

// The fields we set, in a fixed order, so a registered command and ours compare equal when Discord adds its own fields
function shape(o) {
  if (!o || typeof o !== 'object') return null
  const out = {}
  for (const k of ['type', 'name', 'description', 'required', 'min_length', 'max_length', 'default_member_permissions', 'contexts', 'integration_types']) {
    if (o[k] === undefined || o[k] === null) continue
    if (k === 'required' && o[k] === false) continue
    out[k] = Array.isArray(o[k]) ? [...o[k]].sort() : k === 'default_member_permissions' ? String(o[k]) : o[k]
  }
  if (Array.isArray(o.options) && o.options.length) out.options = o.options.map(shape)
  return out
}
const same = (a, b) => JSON.stringify(shape(a)) === JSON.stringify(shape(b))

// What register would send: one POST per command that is new or differs from the registered copy
function plan(action, { app, guild, existing = [], commands = COMMANDS }) {
  const base = `/applications/${app}/guilds/${guild}/commands`
  if (action === 'show') return [{ method: 'GET', path: base }]
  if (action !== 'register') throw new Error(`unknown action ${action}`)
  const byName = new Map((existing || []).filter(c => c && c.name).map(c => [c.name, c]))
  return commands.filter(c => !same(c, byName.get(c.name))).map(c => ({ method: 'POST', path: base, body: c }))
}

// A saved copy (from show --save) as commands to POST again: our names only, with Discord's own fields taken off
function fromSaved(list) {
  if (!Array.isArray(list)) throw new Error('the saved file is not a JSON list of commands')
  return list.filter(c => c && NAMES.has(c.name)).map(shape)
}

function diffLines(registered, commands) {
  const byName = new Map((registered || []).map(c => [c.name, c]))
  return commands.map(c => {
    const r = byName.get(c.name)
    if (!r) return `/${c.name}: not registered (register would add it)`
    return same(c, r) ? `/${c.name}: registered copy matches (id ${r.id})` : `/${c.name}: differs from the registered copy (id ${r.id}); register would update it`
  })
}

const idOf = (list, name) => ((list || []).find(c => c && c.name === name) || {}).id || null

async function main(argv = process.argv.slice(2), { config = require('../config'), send = request, out = console.log, readFile = fs.readFileSync, writeFile = fs.writeFileSync } = {}) {
  const action = argv[0]
  const yes = argv.includes('--yes')
  const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const usage = 'usage: node scripts/dragonbaron-command.js show [--save <file>] | register [--yes] | register --from <file> [--yes]'
  if (!['show', 'register'].includes(action)) { out(usage); return 2 }
  const saveTo = opt('--save'), from = opt('--from')
  if ((argv.includes('--save') && !saveTo) || (argv.includes('--from') && !from)) { out(usage); return 2 }
  const token = config.discordBotToken, guild = config.discordGuildId
  if (!token || !SNOWFLAKE.test(String(guild))) { out('DISCORD_BOT_TOKEN and DISCORD_GUILD_ID must be set'); return 2 }
  const app = SNOWFLAKE.test(String(config.discordClientId)) ? config.discordClientId : (await send({ method: 'GET', path: '/applications/@me', token })).id
  const base = `/applications/${app}/guilds/${guild}/commands`
  const listed = await send({ method: 'GET', path: base, token })
  const ours = (Array.isArray(listed) ? listed : []).filter(c => c && NAMES.has(c.name))
  const before = idOf(ours, 'dragonbaron')
  out(`/dragonbaron command id now: ${before || 'not registered'}`)

  if (action === 'show') {
    out(JSON.stringify(ours, null, 2))
    for (const line of diffLines(ours, COMMANDS)) out(line)
    if (saveTo) { writeFile(saveTo, `${JSON.stringify(ours, null, 2)}\n`, { mode: 0o600 }); out(`saved ${ours.length} commands to ${saveTo}`) }
    return 0
  }

  const commands = from ? fromSaved(JSON.parse(readFile(from, 'utf8'))) : COMMANDS
  if (from && !commands.length) { out(`${from} holds none of ${[...NAMES].join(', ')}; nothing to send`); return 2 }
  const steps = plan('register', { app, guild, existing: ours, commands })
  if (!steps.length) { out('every command matches the registered copy; nothing to send'); return 0 }
  for (const s of steps) {
    if (!yes) { out(`would send ${s.method} ${s.path} ${JSON.stringify(s.body)} (add --yes to send it)`); continue }
    const res = await send({ ...s, token })
    out(`${s.method} ${s.path}: /${s.body.name} ${res && res.id ? `command ${res.id}` : 'done'}`)
  }
  if (!yes) return 0
  const after = idOf(await send({ method: 'GET', path: base, token }), 'dragonbaron')
  out(`/dragonbaron command id after: ${after || 'not registered'}`)
  if (before && after !== before) {
    out(`WARNING: the /dragonbaron command id CHANGED (${before} -> ${after}). Its Server Settings > Integrations overrides are reset: re-allow the staff roles there now.`)
    return 3
  }
  return 0
}

if (require.main === module) main().then(code => process.exit(code), err => { console.error(err.message); process.exit(1) })

module.exports = { COMMANDS, plan, main, shape, fromSaved }
