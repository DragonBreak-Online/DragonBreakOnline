'use strict'
const fs = require('fs')
const path = require('path')
const ini = require('./ini')

const FPS_LIMITS = ['60', '90', '120', '144']

const FPS_MAX_TIME = {
  '60':  '0.01666667',
  '90':  '0.01111111',
  '120': '0.00833333',
  '144': '0.00694444',
}

function sseDisplayTweaksCustomPath(gameDir) {
  return gameDir ? path.join(gameDir, 'Data', 'SKSE', 'Plugins', 'SSEDisplayTweaks_Custom.ini') : ''
}

function readFpsLimitFromIni(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = ini.read(filePath)
      const lim = String(((data['Render'] || {})['FramerateLimit'] || '')).trim().replace(/\.0+$/, '')
      if (FPS_LIMITS.includes(lim)) return lim
    }
  } catch {}
  return null
}

function normalizeFps(fps) {
  const s = String(fps || '').trim().replace(/\.0+$/, '')
  return FPS_LIMITS.includes(s) ? s : '60'
}

function buildIniContent(fps) {
  const norm = normalizeFps(fps)
  const fMaxTime = FPS_MAX_TIME[norm]
  return [
    '[Render]',
    `FramerateLimit=${norm}.0`,
    '',
    '[Havok]',
    'bHavokFix=true',
    `fMaxTime=${fMaxTime}`,
    'bAdjustAudioSpeed=false',
    '',
    '[FramerateLimiter]',
    'LimitLoadingScreens=60.0',
    'LimitMenu=60.0',
    '',
  ].join('\r\n')
}

function writeSseDisplayTweaksCustom(gameDir, fps) {
  const p = sseDisplayTweaksCustomPath(gameDir)
  if (!p) return false
  const content = buildIniContent(fps)
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content, 'utf8')
    return true
  } catch {
    return false
  }
}

module.exports = {
  FPS_LIMITS,
  FPS_MAX_TIME,
  normalizeFps,
  buildIniContent,
  sseDisplayTweaksCustomPath,
  readFpsLimitFromIni,
  writeSseDisplayTweaksCustom,
}