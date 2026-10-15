#!/usr/bin/env node
'use strict'
// The /say guild command: show | register --yes | remove --yes, one POST or DELETE of /say alone through console-command.js's main

const { main } = require('./console-command')
const { MAX_TEXT } = require('../sources/discord/sayCommand')

const COMMAND = Object.freeze({
  name: 'say',
  type: 1,
  description: 'Post your own text as Dragonbaron here (Lead GMs and above; every use is logged)',
  options: [
    { type: 3, name: 'text', description: 'What to post; leave it out for a box that takes several lines', required: false, max_length: MAX_TEXT },
    { type: 3, name: 'reply_to', description: 'A message link or id in this channel to reply to', required: false, max_length: 200 },
    { type: 5, name: 'close', description: 'In a staff to-do thread: lock and archive it after posting', required: false },
  ],
  // Hidden from all but Administrator until Jake allows the staff roles in Server Settings > Integrations; the checks in code are the control
  default_member_permissions: '0',
  contexts: [0],
  integration_types: [0],
})

if (require.main === module) main(process.argv.slice(2), { command: COMMAND }).then(code => process.exit(code), err => { console.error(err.message); process.exit(1) })

module.exports = { COMMAND }
