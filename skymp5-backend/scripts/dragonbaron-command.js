#!/usr/bin/env node
'use strict'

const { request } = require('./console-command')
const config = require('../config')

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

async function deploy() {
  const token = config.discordBotToken
  const guild = config.discordGuildId
  if (!token || !guild) {
    console.error('DISCORD_BOT_TOKEN and DISCORD_GUILD_ID must be set in environment.')
    process.exit(1)
  }

  const app = config.discordClientId || (await request({ method: 'GET', path: '/applications/@me', token })).id
  const base = `/applications/${app}/guilds/${guild}/commands`

  console.log(`Querying existing commands in guild ${guild}...`)
  const existing = await request({ method: 'GET', path: base, token })
  const existingMap = new Map((existing || []).map(c => [c.name, c.id]))

  for (const cmd of COMMANDS) {
    if (existingMap.has(cmd.name)) {
      console.log(`Updating existing /${cmd.name} (id ${existingMap.get(cmd.name)})...`)
      await request({
        method: 'POST',
        path: base,
        token,
        body: cmd
      })
      console.log(`Successfully updated /${cmd.name}`)
    } else {
      console.log(`Registering new /${cmd.name}...`)
      await request({
        method: 'POST',
        path: base,
        token,
        body: cmd
      })
      console.log(`Successfully registered /${cmd.name}`)
    }
  }

  console.log('Command deployment complete!')
}

if (require.main === module) {
  deploy().then(() => process.exit(0), err => {
    console.error('Deployment failed:', err.message)
    process.exit(1)
  })
}

module.exports = { deploy, COMMANDS }
