'use strict'
// The backend's one console instance, made on first use so bot.js and the routes can require it without a cycle

const path = require('path')
const config = require('../../config')
const { createStaffConsole } = require('./staffConsole')
const { createSpool } = require('./spool')

let instance = null

function consoleApi() {
  if (instance) return instance
  const profiles = require('../profiles')
  instance = createStaffConsole({
    config,
    discordBot: require('../discordBot'),
    siteSessions: require('../siteSessions'),
    profileIdOf: discordId => { const id = profiles.load().map[discordId]; return Number.isInteger(id) ? id : null },
    spool: createSpool({ dir: config.consoleSpoolDir, keyFile: config.consoleKeyFile }),
    audit: require('../discord/audit'),
    jobsFile: path.join(__dirname, '..', '..', 'data', 'console-jobs.json'),
    switchFile: config.consoleSwitchFile,
  })
  return instance
}

module.exports = { consoleApi }
