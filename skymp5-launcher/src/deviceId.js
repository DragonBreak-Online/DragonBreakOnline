'use strict'
// Ban enforcement check (backend docs/ban_device_check.md): a one-way code made from the Windows MachineGuid, sent with
// launch-check. The machine id itself never leaves this PC and is never logged; the backend keeps only a keyed scramble.

const crypto = require('crypto')

const LABEL = 'DragonBreak device v1\n'

// readMachineGuid is called at most once per run; fields() is what goes into the launch-check body
function createDeviceId({ platform, readMachineGuid, log = () => {} }) {
  let code
  let saidUnavailable = false

  function read() {
    if (code !== undefined) return code
    code = null
    if (platform !== 'win32') return code
    let guid = null
    try { guid = readMachineGuid() } catch { guid = null }
    const clean = typeof guid === 'string' ? guid.trim().toLowerCase().replace(/[{}]/g, '') : ''
    if (/^[0-9a-f-]{10,64}$/.test(clean)) code = `v1.${crypto.createHash('sha256').update(LABEL + clean).digest('hex')}`
    return code
  }

  function fields() {
    const value = read()
    if (value) return { device: value }
    if (!saidUnavailable) {
      saidUnavailable = true
      log('[device] no device check: the Windows machine id could not be read')
    }
    return { deviceStatus: 'unavailable' }
  }

  return { fields }
}

module.exports = { createDeviceId }
