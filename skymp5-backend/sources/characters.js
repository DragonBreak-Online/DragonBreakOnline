'use strict'
// Reads characters from the game server's changeForms store; shared by the website routes and the server manager

const fs   = require('fs')
const path = require('path')

// Build a character record from a changeform (file JSON or mongo doc); null if not a character.
function charFromCf(cf) {
  if (!cf || cf.recType !== 1) return null            // 1 = ACHR (a character)
  const profileId = Number(cf.profileId)
  if (!Number.isFinite(profileId) || profileId < 0) return null
  // The store embeds appearanceDump as an object; very old file saves held a JSON string.
  let appearance = null
  if (cf.appearanceDump && typeof cf.appearanceDump === 'object') appearance = cf.appearanceDump
  else if (typeof cf.appearanceDump === 'string') { try { appearance = JSON.parse(cf.appearanceDump) } catch {} }
  const name = cf.displayName || (appearance && appearance.name) || cf.formDesc || '(unnamed)'
  return {
    profileId,
    formDesc: cf.formDesc,
    name,
    disabled: !!cf.isDisabled,
    dead: !!cf.isDead,
    deleted: !!cf.isDeleted,
    worldOrCell: cf.worldOrCellDesc,
    position: Array.isArray(cf.position) ? cf.position : null,
    health: cf.healthPercentage,
    magicka: cf.magickaPercentage,
    stamina: cf.staminaPercentage,
    inventory: (cf.inv && Array.isArray(cf.inv.entries)) ? cf.inv.entries : [],
    spellCount: Array.isArray(cf.learnedSpells) ? cf.learnedSpells.length : 0,
    spawnDelay: cf.spawnDelay,
    appearance,
  }
}

// File driver: yields [file, changeForm] for every parseable json in dir whose name matches.
function* fileChangeForms(dir, match = /\.json$/) {
  for (const entry of (fs.existsSync(dir) ? fs.readdirSync(dir) : [])) {
    if (!match.test(entry)) continue
    const file = path.join(dir, entry)
    let cf
    try { cf = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { continue }
    yield [file, cf]
  }
}

// A full scan's [{ cf, char, mtime }] in directory order, re-reading only files whose mtime, size or inode changed; throws when the folder is unreadable
function createCharacterIndex(match = /\.json$/) {
  // file name -> { mtimeMs, size, ino, form }; form null when not a character or not JSON when read
  let known = new Map()
  let knownDir = null
  return function scan(dir) {
    fs.accessSync(dir, fs.constants.R_OK)
    if (dir !== knownDir) { known = new Map(); knownDir = dir }
    const next = new Map()
    const forms = []
    for (const entry of fs.readdirSync(dir)) {
      if (!match.test(entry)) continue
      const file = path.join(dir, entry)
      let st
      try { st = fs.statSync(file) } catch { continue }
      let hit = known.get(entry)
      if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size || hit.ino !== st.ino) {
        let form = null
        try {
          const cf = JSON.parse(fs.readFileSync(file, 'utf8'))
          const char = charFromCf(cf)
          if (char) form = { cf, char, mtime: st.mtime }
        } catch { /* gone or half-written: read again once the file changes */ }
        hit = { mtimeMs: st.mtimeMs, size: st.size, ino: st.ino, form }
      }
      next.set(entry, hit)
      if (hit.form) forms.push(hit.form)
    }
    known = next
    return forms
  }
}

module.exports = { charFromCf, fileChangeForms, createCharacterIndex }
