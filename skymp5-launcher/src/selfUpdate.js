'use strict'
// What install.log says about the launcher updating itself (claude-jake, 11 Oct): the check, the download, the hand-off
// to the installer and, on the next start, whether the new version is the one running. The installer runs silently and
// the launcher quits before it finishes, so the result can only be read by the launcher that starts afterwards; a marker
// in the store carries the attempt across. Lines name versions and a host only, never a url (release links are signed).

const fs = require('fs')
const path = require('path')
const { hostOf, errorText } = require('./download')

// Each attempt downloads the installer to a file of its own. One fixed name failed a player on 2.1.45 (11 Oct, "Update
// failed: EPERM: operation not permitted, rename ...\Temp\..."): a copy an earlier attempt left there can still be held
// open by an antivirus scan or an installer that is still running, and Windows refuses to replace a file held open
// The partial download (<installer>.part, about 100 MB) goes too: with a new name per attempt, a cut or refused one
// is never resumed, and nothing else clears it from the temp folder
const INSTALLER_RE = /^DragonBreakLauncher-update(?:-[\w.-]+)?\.exe(?:\.part)?$/i
function installerPath(dir, version, now = Date.now()) {
  const v = String(version || 'next').replace(/[^\w.]/g, '_').slice(0, 32)
  return path.join(dir, `DragonBreakLauncher-update-${v}-${now}.exe`)
}
// Removes the installers earlier attempts left in dir, except keep; one still held open stays for the next start
function pruneInstallers(dir, keep = '', fsMod = fs) {
  let removed = 0
  let names = []
  try { names = fsMod.readdirSync(dir) } catch { return 0 }
  for (const name of names) {
    if (!INSTALLER_RE.test(name)) continue
    const full = path.join(dir, name)
    if (keep && path.resolve(full) === path.resolve(keep)) continue
    try { fsMod.unlinkSync(full); removed++ } catch { /* held open: next time */ }
  }
  return removed
}

const PENDING_KEY = 'pendingSelfUpdate'
// A marker older than this did not come from the run that just ended (the player declined a UAC prompt, the installer
// failed and nothing restarted the launcher); it is still reported once, as not applied
const STALE_MS = 24 * 60 * 60 * 1000

// The update check runs every 10 s; log the first answer and then only a change
function createCheckLogger(log) {
  let last = null
  return (result, err) => {
    const line = err
      ? `[self-update] check failed: ${errorText(err)}`
      : result.hasUpdate
        ? `[self-update] check: running ${result.current}, the server offers ${result.latest}: update available`
        : `[self-update] check: running ${result.current}, the server offers ${result.latest}: up to date`
    if (line === last) return false
    last = line
    log(line)
    return true
  }
}

function markPending(store, from, to, now = Date.now()) {
  try { store.set(PENDING_KEY, { from: String(from), to: String(to), at: now }) } catch { /* an unwritable store only loses the result line */ }
}

function clearPending(store) {
  try { store.delete(PENDING_KEY) } catch { /* nothing to clear */ }
}

// The line for the start after an update attempt, or null when none was pending. Clears the marker.
function startupResult(store, current, compareVersions, now = Date.now()) {
  let p = null
  try { p = store.get(PENDING_KEY) } catch { return null }
  if (!p || typeof p !== 'object') return null
  clearPending(store)
  const age = Number.isFinite(p.at) ? Math.max(0, Math.round((now - p.at) / 1000)) : null
  const since = age === null ? '' : ` (${age} s after the hand-off)`
  if (String(current) === String(p.to)) return `[self-update] result: applied, now running ${current} (was ${p.from})${since}`
  const newer = compareVersions(String(current), String(p.to)) > 0
  if (newer) return `[self-update] result: running ${current}, newer than the ${p.to} that was installing (was ${p.from})${since}`
  const stale = age !== null && age * 1000 > STALE_MS
  return `[self-update] result: NOT applied, still running ${current}; the installer for ${p.to} did not finish${stale ? ' (the attempt is over a day old)' : ''}${since}`
}

const describeSource = (url) => hostOf(url)

module.exports = { errorText, createCheckLogger, markPending, clearPending, startupResult, describeSource, installerPath, pruneInstallers, PENDING_KEY, STALE_MS }
