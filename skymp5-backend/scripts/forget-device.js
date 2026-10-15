'use strict'

/**
 * Erases one player's entry from the report-only device check (data/device-ids.json), for a privacy request
 * (docs/ban_device_check.md). Safe while the backend runs: it reads the store through on every use.
 *   node scripts/forget-device.js --profile <profile number>
 * Prints only "removed", "nothing stored" or "kept: account is banned" (the Privacy Policy keeps what enforces a ban).
 * Run it twice to confirm: the second run says "nothing stored", or "kept: account is banned" again.
 * It finds the entry through profiles.json, so run it before the profile is deleted. An unknown profile prints
 * "no such profile: nothing was checked" and exits 3: an entry may still be kept, and expires under the 30-day rule.
 */

const profiles     = require('../sources/profiles')
const deviceChecks = require('../sources/deviceChecks')

const PROFILE = /^\d{1,16}$/
const SAID = { removed: 'removed', nothing: 'nothing stored', 'kept-banned': 'kept: account is banned' }
// Exit code for a profile number profiles.json does not hold: nothing was looked up, so nothing is known
const NO_PROFILE = 3

// Returns the exit code
function main(argv) {
  const at = argv.indexOf('--profile')
  const pid = at >= 0 ? String(argv[at + 1] || '') : ''
  if (!PROFILE.test(pid)) {
    console.error('usage: node scripts/forget-device.js --profile <profile number>')
    return 2
  }
  const discordId = profiles.getDiscordIdByProfileId(Number(pid))
  if (!discordId) {
    console.log('no such profile: nothing was checked')
    return NO_PROFILE
  }
  console.log(SAID[deviceChecks.forgetAccount(discordId)])
  return 0
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)) }
  catch (err) {
    console.error(`forget-device: ${err.message}`)
    process.exitCode = 1
  }
}

module.exports = { main }
