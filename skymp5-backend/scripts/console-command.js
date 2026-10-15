#!/usr/bin/env node
'use strict'
// The /console guild command: show | register --yes | remove --yes (POST or DELETE of one command, never a bulk PUT; no --yes sends nothing)

const https = require('https')

const COMMAND = Object.freeze({
  name: 'console',
  type: 1,
  description: 'Run an in-game staff command (admins)',
  options: [{ type: 3, name: 'command', description: 'As typed in game, e.g. /wwremote clear #8KWH', required: true, max_length: 500 }],
  // Hidden from all but Administrator until Jake allows the staff roles in Server Settings > Integrations; the checks in code are the control
  default_member_permissions: '0',
  contexts: [0],
  integration_types: [0],
})

function request({ method, path, token, body }) {
  if (!['GET', 'POST', 'DELETE'].includes(method)) throw new Error(`refusing ${method}: only GET, POST and DELETE are used`)
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body)
    const req = https.request({
      hostname: 'discord.com', path: `/api/v10${path}`, method,
      headers: { Authorization: `Bot ${token}`, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, res => {
      let text = ''
      res.on('data', c => { text += c })
      res.on('end', () => {
        if (res.statusCode >= 300) return reject(new Error(`discord ${method} ${path} failed (${res.statusCode}): ${text.slice(0, 200)}`))
        try { resolve(text ? JSON.parse(text) : null) } catch { resolve(null) }
      })
    })
    req.setTimeout(20000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(data || undefined)
  })
}

// The requests each action sends, in order; the test holds this to POST and DELETE on the one guild command
function plan(action, { app, guild, existing, command = COMMAND }) {
  const base = `/applications/${app}/guilds/${guild}/commands`
  if (action === 'show') return [{ method: 'GET', path: base }]
  if (action === 'register') return [{ method: 'POST', path: base, body: command }]
  if (action === 'remove') return existing ? [{ method: 'DELETE', path: `${base}/${existing}` }] : []
  throw new Error(`unknown action ${action}`)
}

async function main(argv = process.argv.slice(2), { config = require('../config'), send = request, out = console.log, command = COMMAND } = {}) {
  const action = argv[0]
  const yes = argv.includes('--yes')
  if (!['show', 'register', 'remove'].includes(action)) { out(`usage: node scripts/${command.name}-command.js show | register --yes | remove --yes`); return 2 }
  const token = config.discordBotToken, guild = config.discordGuildId
  if (!token || !/^\d{17,20}$/.test(String(guild))) { out('DISCORD_BOT_TOKEN and DISCORD_GUILD_ID must be set'); return 2 }
  const app = /^\d{17,20}$/.test(String(config.discordClientId)) ? config.discordClientId : (await send({ method: 'GET', path: '/applications/@me', token })).id
  const listed = await send({ method: 'GET', path: `/applications/${app}/guilds/${guild}/commands`, token })
  const mine = (Array.isArray(listed) ? listed : []).find(c => c && c.name === command.name)
  if (action === 'show') { out(JSON.stringify((listed || []).map(c => ({ id: c.id, name: c.name, default_member_permissions: c.default_member_permissions })))); return 0 }
  const steps = plan(action, { app, guild, existing: mine && mine.id, command })
  if (!steps.length) { out(`no /${command.name} command is registered; nothing to remove`); return 0 }
  for (const s of steps) {
    if (!yes) { out(`would send ${s.method} ${s.path}${s.body ? ` ${JSON.stringify(s.body)}` : ''} (add --yes to send it)`); continue }
    const res = await send({ ...s, token })
    out(`${s.method} ${s.path}: ${res && res.id ? `command ${res.id}` : 'done'}`)
  }
  return 0
}

if (require.main === module) main().then(code => process.exit(code), err => { console.error(err.message); process.exit(1) })

module.exports = { COMMAND, plan, main, request }
