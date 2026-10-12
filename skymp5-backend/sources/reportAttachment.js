'use strict'
// POST /api/files/report-attachment (routes/files.js). Launcher 2.1.46 follows a report filed after a crash at login with
// the spawn save SkyrimPlatform was loading (TESMODPLATFORM-<guid>.ess, the VCRUNTIME140+1C12A family), brotli-packed and
// base64 because it is too big for the report's own body (launcher report.js platformSaveFor, main.js sendReportAttachment).
// Only a signed-in sender, only into the thread of a report that same sender filed, once (problemReport.claimAttachment).
// The save is unpacked and checked against its own size, sha256 and magic before anything is posted.

const crypto = require('crypto')
const zlib   = require('zlib')
const { promisify } = require('util')
const { claimAttachment, cleanName, escapeMarkdown } = require('./problemReport')
const { scrub } = require('./scrubLog')
const { postToThread } = require('./discord/errorReport')
const audit = require('./discord/audit')

const brotliDecompress = promisify(zlib.brotliDecompress)

// The launcher's own limits (skymp5-launcher/src/report.js PLATFORM_SAVE, SAVE_MAGIC, SAVE_RAW_MAX, SAVE_SEND_MAX)
const SAVE_NAME = /^TESMODPLATFORM-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\.ess$/i
const SAVE_MAGIC = Buffer.from('TESV_SAVEGAME', 'latin1')
const RAW_MAX = 16 * 1024 * 1024
const PACKED_MAX = 1400 * 1024
const BASE64_MAX = Math.ceil(PACKED_MAX / 3) * 4
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
// Discord takes 10 MiB per message from a bot in an unboosted server; a bigger save goes up still packed
const POST_RAW_MAX = 8 * 1024 * 1024
const REASON_BYTES = 200

const refuse = error => ({ error })

// The save the body describes, unpacked and checked, or { error }
async function unpack(body) {
  if (body.kind !== 'platformSave') return refuse('Only a spawn save is taken.')
  if (typeof body.name !== 'string' || !SAVE_NAME.test(body.name)) return refuse('The file is not a spawn save.')
  if (body.encoding !== 'br') return refuse('The save must be brotli-packed.')
  const size = body.size
  if (!Number.isSafeInteger(size) || size <= SAVE_MAGIC.length || size > RAW_MAX) return refuse('The save size is not valid.')
  if (typeof body.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(body.sha256)) return refuse('The save hash is not valid.')
  const data = body.data
  if (typeof data !== 'string' || !data.length || data.length > BASE64_MAX || data.length % 4 || !BASE64.test(data)) {
    return refuse('The save data is not valid base64 of the allowed size.')
  }
  const packed = Buffer.from(data, 'base64')
  let raw
  try {
    // Never more than the size it claims, so a small body cannot unpack into a large one
    raw = await brotliDecompress(packed, { maxOutputLength: size })
  } catch {
    return refuse('The save does not unpack to its stated size.')
  }
  if (raw.length !== size) return refuse('The save does not unpack to its stated size.')
  if (!raw.subarray(0, SAVE_MAGIC.length).equals(SAVE_MAGIC)) return refuse('The file is not a save.')
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex')
  if (sha256 !== body.sha256.toLowerCase()) return refuse('The save does not match its hash.')
  return { name: body.name, raw, packed, size, sha256 }
}

// The launcher's own words about why it sent the save, as plain text
function reasonText(body) {
  const reason = typeof body.reason === 'string' ? scrub(body.reason.slice(0, REASON_BYTES), REASON_BYTES).text.trim() : ''
  return reason ? escapeMarkdown(reason.replace(/\s+/g, ' ')) : ''
}

// reporter: identifyReporter's (routes/files.js). Posts the save into the report's thread; returns the HTTP reply to send.
async function attach(reporter, body) {
  const claim = await claimAttachment(reporter, body.reportId)
  if (claim.status) return claim
  const who = `profile ${reporter.profileId}`
  let save
  try {
    save = await unpack(body)
  } catch (err) {
    save = refuse('The save could not be read.')
    console.error(`[report-attachment] ${body.reportId} from ${who}: ${err.message}`)
  }
  if (save.error) {
    claim.release()
    console.warn(`[report-attachment] ${body.reportId} from ${who} refused: ${save.error}`)
    return { status: 400, json: { error: save.error } }
  }

  const whole = save.size <= POST_RAW_MAX
  const file = whole
    ? { name: save.name, data: save.raw, type: 'application/octet-stream' }
    : { name: `${save.name}.br`, data: save.packed, type: 'application/octet-stream' }
  const minutes = Number.isSafeInteger(body.writtenMinutesAgo) && body.writtenMinutesAgo >= 0 && body.writtenMinutesAgo <= 1440
    ? `, written ${body.writtenMinutesAgo} min before the report` : ''
  const reason = reasonText(body)
  const content = [
    `Spawn save from **${escapeMarkdown(cleanName(reporter.name))}**'s launcher, the save the game was loading at login: `
      + `\`${save.name}\`, ${save.size} bytes, sha256 ${save.sha256.slice(0, 16)}${minutes}${reason ? ` (${reason})` : ''}.`,
    whole ? '' : `Too big for one message, so it is brotli-packed: unpack it with \`brotli -d\` before loading it.`,
  ].filter(Boolean).join('\n')

  try {
    await postToThread({ thread: claim.thread, content, files: [file] })
  } catch (err) {
    claim.release()
    console.error(`[report-attachment] ${body.reportId} from ${who} could not be posted: ${err.message}`)
    return { status: 502, json: { error: 'Could not attach the save just now.' } }
  }
  claim.done()
  console.log(`[report-attachment] ${body.reportId} from ${who}: ${file.name}, ${save.size} bytes -> thread ${claim.thread}`)
  audit.log(`REPORT attachment ${file.name} (${save.size} bytes) from ${cleanName(reporter.name)} (${who}) -> thread ${claim.thread}`)
  return { status: 200, json: { ok: true, reportId: body.reportId, thread: claim.thread, file: file.name } }
}

module.exports = { attach, unpack, SAVE_NAME, PACKED_MAX, POST_RAW_MAX }
