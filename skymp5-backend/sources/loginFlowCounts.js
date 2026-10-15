'use strict'
// Daily counts of launcher and in-game logins by flow (data/login-flows.json), read to decide when the legacy flow can be turned off; counts only, never who

const fs   = require('fs')
const path = require('path')

const FILE = process.env.LOGIN_FLOWS_FILE || path.join(__dirname, '..', 'data', 'login-flows.json')
const KEEP_DAYS = 90

function createFlowCounts({ file = FILE, now = Date.now, log = console } = {}) {
  let days = {}
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (d && typeof d === 'object' && !Array.isArray(d)) days = d
  } catch { /* first run */ }

  function save() {
    const tmp = `${file}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify(days, null, 1) + '\n')
      fs.renameSync(tmp, file)
    } catch (e) { log.error(`[login-flows] could not save the counts: ${e.message}`) }
  }

  // One more of kind today (UTC); days past KEEP_DAYS are dropped
  function bump(kind) {
    const day = new Date(now()).toISOString().slice(0, 10)
    const row = days[day] && typeof days[day] === 'object' ? days[day] : (days[day] = {})
    row[kind] = (Number(row[kind]) || 0) + 1
    const keys = Object.keys(days).sort()
    while (keys.length > KEEP_DAYS) delete days[keys.shift()]
    save()
  }

  return { bump, read: () => JSON.parse(JSON.stringify(days)), FILE: file }
}

const shared = createFlowCounts()
module.exports = { createFlowCounts, bump: shared.bump, read: shared.read, FILE }
