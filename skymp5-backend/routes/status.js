const router = require('express').Router()
const http   = require('http')
const { execFile } = require('child_process')
const { performance } = require('perf_hooks')
const config = require('../config')
const { getHeartbeat } = require('./servers')

function metricsAuthHeader() {
  const { metricsUser: user, metricsPassword: password } = config
  if (user && password) {
    return { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` }
  }
  return {}
}

// Probe the SkyMP HTTP UI port: any HTTP response (even an auth error) proves the process is up.
// Player count from Prometheus metrics when readable: online players = skymp_connects_total - skymp_disconnects_total.
// (The old UDP probe read dead servers as online: a UDP send "succeeds" once the OS accepts the packet.)
function probeGameServer(host, uiPort) {
  return new Promise(resolve => {
    const req = http.get(
      { hostname: host, port: uiPort, path: '/metrics', timeout: 3000, headers: metricsAuthHeader() },
      res => {
        let raw = ''
        res.on('data', c => { raw += c })
        res.on('end', () => {
          const val = name => {
            const m = raw.match(new RegExp(`^${name}\\s+(\\d+)`, 'm'))
            return m ? parseInt(m[1], 10) : null
          }
          const connects    = val('skymp_connects_total')
          const disconnects = val('skymp_disconnects_total')
          const players = (connects !== null && disconnects !== null)
            ? Math.max(0, connects - disconnects)
            : null
          resolve({ reachable: true, players })
        })
      }
    )
    req.on('error',   () => resolve({ reachable: false, players: null }))
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false, players: null }) })
  })
}

// The website and api-check read service and port_bound, which CT115's old status service (skymp-api.py) sent; since the move to the
// Linode (4 Nov 2026) the backend answers them itself from systemd and the UDP socket table, at most one check per 5 s however often it is polled
const UNIT_TTL_MS = 5000
let unitCache = { at: -Infinity, value: null, pending: null }
// stdout, or null when the command could not run, was killed, or (allowExit false) exited non-zero; always settles within 3.5 s
function runOut(cmd, args, allowExit) {
  return new Promise(resolve => {
    let done = false
    const finish = v => { if (!done) { done = true; clearTimeout(guard); resolve(v) } }
    const guard = setTimeout(() => finish(null), 3500)
    try {
      execFile(cmd, args, { timeout: 3000, killSignal: 'SIGKILL' }, (err, stdout) => {
        if (err && (typeof err.code !== 'number' || err.killed || err.signal || !allowExit)) return finish(null)
        finish(String(stdout || '').trim())
      })
    } catch { finish(null) }
  })
}
// systemctl is-active prints the state and exits 3 or 4 when not active, so its exit code is allowed; a failing ss is not
function unitState() {
  if (unitCache.value && performance.now() - unitCache.at < UNIT_TTL_MS) return Promise.resolve(unitCache.value)
  if (!unitCache.pending) {
    unitCache.pending = Promise.all([
      runOut('systemctl', ['is-active', 'skymp'], true),
      runOut('ss', ['-ulnH', `sport = :${config.skyrimServerPort}`], false),
    ]).then(([active, udp]) => ({ service: active || null, portBound: udp === null ? null : udp.length > 0 }),
            () => ({ service: null, portBound: null }))
      .then(value => { unitCache = { at: performance.now(), value, pending: null }; return value })
  }
  return unitCache.pending
}

// server heartbeats every ~5s; allow a few misses before calling it offline
const HEARTBEAT_TTL_MS = 20_000

router.get('/', async (_req, res) => {
  const unitP = unitState()   // runs beside the heartbeat probe
  const { skyrimServerHost: host, skympUiPort: uiPort } = config
  const hb = getHeartbeat()

  // a fresh heartbeat proves the process is up; probe the metrics port only when no heartbeat has been seen since backend start
  let online  = null
  let players = null
  if (hb && hb.lastSeen) {
    online = (Date.now() - new Date(hb.lastSeen).getTime()) < HEARTBEAT_TTL_MS
    if (online && typeof hb.online === 'number') players = hb.online
  }

  if (online === null || (online && players === null)) {
    const probe = await probeGameServer(host, uiPort)
    if (online === null) online = probe.reachable
    if (online && players === null) players = probe.players
  }

  // One verdict, as skymp-api.py gave: online needs a fresh heartbeat and, when the unit check could run, the service active and the port bound.
  // A check that could not run falls back to the heartbeat, so the fields are never missing
  const unit = await unitP
  const up = Boolean(online) && (unit.service === null || unit.service === 'active') && unit.portBound !== false
  res.json({
    status: up ? 'online' : 'offline',
    players,
    service: unit.service !== null ? unit.service : (online ? 'active' : 'unknown'),
    port_bound: unit.portBound !== null ? unit.portBound : Boolean(online),
  })
})

module.exports = router
