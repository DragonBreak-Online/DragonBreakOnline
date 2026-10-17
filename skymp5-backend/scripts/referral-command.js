#!/usr/bin/env node
'use strict'
// The /referral guild command for every member: show | register --yes | remove --yes, one POST or DELETE through console-command.js's main

const { main } = require('./console-command')

const COMMAND = Object.freeze({
  name: 'referral',
  type: 1,
  description: 'Your DragonBreak Online referral link and code to copy (only you see the reply)',
  contexts: [0],
  integration_types: [0],
})

if (require.main === module) main(process.argv.slice(2), { command: COMMAND }).then(code => process.exit(code), err => { console.error(err.message); process.exit(1) })

module.exports = { COMMAND }
