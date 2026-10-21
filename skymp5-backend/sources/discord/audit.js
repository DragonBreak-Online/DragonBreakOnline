'use strict'
// Posts audit lines (role changes, permission edits, dashboard actions) to DISCORD_LOG_CHANNEL_ID, and the Punishments
// panel's actions to the game's #staff-commands (STAFF_COMMANDS_CHANNEL_ID), with the bot token. Each channel's lines are
// batched (1.5 s), retried after a rate limit, and sent one by one after a refusal.

const https = require('https')
const config = require('../../config')

const POST_MAX = 1900 // characters in one post, under Discord's 2000
const LINE_MAX = POST_MAX - 2 // so one line always fits an empty batch
const CUT = ' ... (cut, the whole line is in the backend log)'

function post(channelId, content) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ content, allowed_mentions: { parse: [] } })
    const req = https.request({
      hostname: 'discord.com',
      path: `/api/v10/channels/${channelId}/messages`,
      method: 'POST',
      headers: {
        Authorization: `Bot ${config.discordBotToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => {
        if (res.statusCode < 300) return resolve()
        const err = new Error(`discord audit post failed (${res.statusCode}): ${body.slice(0, 160)}`)
        err.status = res.statusCode
        err.body = body
        reject(err)
      })
    })
    req.on('error', reject)
    req.end(data)
  })
}

// Discord itself refusing this text: a 400 with Discord's JSON error code (50035 form body, 50006 empty, 200000 AutoMod...).
// Every other failure waits and keeps the batch whole: 401/403/404, 429, 5xx, network errors, other 4xx, and 400s without a code
function refusedForGood(err) {
  if (err.status !== 400) return false
  try { const { code } = JSON.parse(err.body || ''); return Number.isInteger(code) && code > 0 } catch { return false }
}

// One channel's queue; channelId is read when a line is posted
function createPoster(channelId) {
  const queue = []
  let busy = false
  let pauseUntil = 0
  let alone = 0 // lines at the front of the queue that go one per post, after Discord refused their batch for good

  async function flush() {
    if (busy || !queue.length || Date.now() < pauseUntil) return
    busy = true
    const lines = []
    let size = 0
    while (queue.length && size + queue[0].length + 1 < POST_MAX && !(alone && lines.length)) {
      const l = queue.shift()
      lines.push(l)
      size += l.length + 1
    }
    try {
      await post(channelId(), lines.join('\n'))
      if (alone) alone--
    } catch (err) {
      if (refusedForGood(err) && lines.length === 1) {
        if (alone) alone--
        console.error('[discord-audit] dropped:', lines[0], '|', err.message)
      } else if (refusedForGood(err)) {
        alone = lines.length
        queue.unshift(...lines)
        console.error('[discord-audit]', err.message, `| sending its ${lines.length} lines one at a time`)
      } else {
        let wait = 5000
        try { wait = Math.max(wait, Number(JSON.parse(err.body || '{}').retry_after || 0) * 1000) } catch { /* ignore */ }
        pauseUntil = Date.now() + wait
        queue.unshift(...lines)
        console.error('[discord-audit]', err.message)
      }
    }
    busy = false
  }

  function push(line) {
    if (!config.discordBotToken || !channelId()) return
    if (line.length > LINE_MAX) line = `${line.slice(0, LINE_MAX - CUT.length)}${CUT}`
    // Half an emoji, from this cut or the caller's, becomes the replacement mark
    queue.push(line.toWellFormed())
    if (queue.length > 500) queue.splice(0, queue.length - 500)
  }

  return { flush, push }
}

const auditChannel = createPoster(() => config.discordLogChannelId)
const staffChannel = createPoster(() => config.staffCommandsChannelId)

function log(text) {
  console.log('[discord-audit]', text)
  auditChannel.push(`[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ${text}`)
}

// A line as the game writes it in #staff-commands (the caller gives its [HH:MM:SS]); without the channel, the audit channel only
let warned = false
function staff(text) {
  console.log('[staff-commands]', text)
  if (!config.staffCommandsChannelId) {
    if (!warned) console.warn('[discord-audit] STAFF_COMMANDS_CHANNEL_ID is not set: dashboard punishments go to the audit channel only')
    warned = true
    return
  }
  staffChannel.push(text)
}

setInterval(() => { auditChannel.flush(); staffChannel.flush() }, 1500).unref()

module.exports = { log, staff }
