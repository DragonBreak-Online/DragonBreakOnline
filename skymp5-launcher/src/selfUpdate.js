'use strict'
// What install.log says about the launcher updating itself (claude-jake, 11 Oct): the check, the download, the hand-off
// to the installer and, on the next start, whether the new version is the one running. The installer runs silently and
// the launcher quits before it finishes, so the result can only be read by the launcher that starts afterwards; a marker
// in the store carries the attempt across. Lines name versions and a host only, never a url (release links are signed).

const { hostOf, errorText } = require('./download')

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

module.exports = { errorText, createCheckLogger, markPending, clearPending, startupResult, describeSource, PENDING_KEY, STALE_MS }
