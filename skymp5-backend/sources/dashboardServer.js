'use strict'

const express      = require('express')
const path         = require('path')
const config       = require('../config')
const dashSessions = require('./dashboardSessions')
const { isDirectLocal } = require('../middleware/heartbeatAuth')

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

// The automatic Owner session is only for someone already on the box (an ssh tunnel to 127.0.0.1:4002): a direct loopback peer with no proxy
// header, a Host naming loopback (so a DNS-rebound page reaching the tunnel is refused) and, from a browser, a same-origin or typed-in request
function onTheBox(req) {
  if (!LOOPBACK.has(String((req.socket && req.socket.remoteAddress) || '')) || !isDirectLocal(req)) return false
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '')
  if (!LOCAL_HOSTS.has(host)) return false
  const site = req.headers['sec-fetch-site']
  return site === undefined || site === 'same-origin' || site === 'none'
}

function start() {
  if (!config.dashboardPort) return

  const app = express()
  const publicDir = path.join(__dirname, '..', 'public', 'dashboard')

  app.use(express.json())

  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    next()
  })

  app.get('/dashboard-config.js', (_req, res) => {
    res.type('application/javascript').send(
      `window.DRAGONBREAK_DASHBOARD_CONFIG=${JSON.stringify({
        apiBaseUrl: '',
        dashboardUrl: '/',
        siteLoginUrl: '/api/site/manage/session',
      })};`
    )
  })

  // Since production moved to the internet-facing Linode (4 Nov 2026) nothing off the box gets this; staff elsewhere use the Discord login at /api/site/manage/
  app.get('/api/site/manage/session', (req, res) => {
    if (!onTheBox(req)) return res.status(403).json({ ok: false, error: 'The automatic session is only available on the server itself. Sign in at https://dragonbreakonline.com/api/site/manage/ instead.' })
    const ownerRole = (config.siteOwnerRoleIds && config.siteOwnerRoleIds[0]) || '1494126527489507369'
    const perms = ['admin.*']
    const token = dashSessions.create('262414676489535489', 'Owner (on the server)', null, [ownerRole], perms)
    res.json({
      ok: true,
      token,
      user: {
        discordId: '262414676489535489',
        username: 'Owner (on the server)',
        avatar: null,
        roleIds: [ownerRole],
        permissions: perms,
      },
    })
  })

  app.use('/auth/dashboard',        require('../routes/dashboard-auth'))
  app.use('/api/dragonbaron',       require('../routes/dragonbaron'))
  app.use('/api/players',           require('../routes/players'))
  app.use('/api/faction-whitelist', require('../routes/faction-whitelist'))
  app.use('/api/server-access',     require('../routes/server-access'))
  app.use('/api/role-permissions',  require('../routes/role-permissions'))
  app.use('/api/whitelist',         require('../routes/whitelist'))
  app.use('/api/whitelist-notes',   require('../routes/whitelist-notes'))
  app.use('/api/lore',              require('../routes/lore'))
  app.use('/api/rules',             require('../routes/rules'))

  app.use(express.static(publicDir))
  app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')))

  // Loopback by default, so neither the internet nor a tunnel peer reaches it; DASHBOARD_HOST can widen it on purpose
  const host = process.env.DASHBOARD_HOST || '127.0.0.1'
  app.listen(config.dashboardPort, host, () => {
    console.log(`DragonBreak dashboard running on ${config.dashboardPublicUrl} (listening on ${host}:${config.dashboardPort})`)
  })
}

module.exports = { start }
