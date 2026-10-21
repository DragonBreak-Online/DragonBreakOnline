'use strict'
// Who a record is about: profile and Discord account matched on the server only, the account's Discord name, its
// characters with their #TAGs, and each character's jail sentence. From profiles.json, players.json and the changeForms
// store (site-auth's readStore, itself cached 3 s), all read only, cached briefly.

const { scrub } = require('./scrub')

const STATUS_ORDER = { alive: 0, dead: 1, permaDead: 2, deleted: 3 }

function createIdentity({ loadProfiles, loadPlayers, readStore, dynamicFields, characterName, ttlMs = 5000, now = Date.now }) {
  let cache = null

  function build() {
    const id = {
      discordOf: new Map(), profileOf: new Map(), names: new Map(), chars: new Map(), byTag: new Map(), sentences: [],
      status: { profiles: 'ok', players: 'ok', store: 'ok' },
    }
    try {
      for (const [d, p] of Object.entries(loadProfiles().map || {})) {
        if (Number.isSafeInteger(p) && p > 0) { id.profileOf.set(d, p); id.discordOf.set(p, d) }
      }
    } catch { id.status.profiles = 'unreadable' }
    try {
      for (const [d, r] of Object.entries(loadPlayers() || {})) {
        if (!r || typeof r !== 'object') continue
        const shown = scrub(r.displayName, 40), user = scrub(r.username, 40)
        if (shown || user) id.names.set(d, { shown: shown || user, all: [...new Set([shown, user].filter(Boolean).map(n => n.toLowerCase()))] })
        if (!id.profileOf.has(d) && Number.isSafeInteger(r.profileId) && r.profileId > 0) {
          id.profileOf.set(d, r.profileId)
          if (!id.discordOf.has(r.profileId)) id.discordOf.set(r.profileId, d)
        }
      }
    } catch { id.status.players = 'unreadable' }
    let forms = []
    try { forms = readStore() } catch { id.status.store = 'unreadable' }
    for (const { cf, char } of forms) {
      const p = char.profileId
      const df = dynamicFields(cf)
      // A character stamped with another Discord id than its profile's is not this account's (site-staff does the same)
      const stamped = df['private.indexed.discordId']
      const owner = id.discordOf.get(p)
      if (stamped !== undefined && stamped !== null && owner && stamped !== owner) continue
      const tagRaw = df['private.charTag']
      const tag = typeof tagRaw === 'string' && /^[A-Z0-9]{4}$/.test(tagRaw) ? tagRaw : null
      const status = char.deleted ? 'deleted' : df['private.permaDead'] === true ? 'permaDead' : char.dead ? 'dead' : 'alive'
      const c = { name: scrub(characterName(cf, char.appearance), 48), tag, status, key: String(char.formDesc || '') }
      if (!id.chars.has(p)) id.chars.set(p, [])
      id.chars.get(p).push(c)
      if (tag && (!id.byTag.has(tag) || status !== 'deleted')) id.byTag.set(tag, { profileId: p, name: c.name, tag })
      const s = df['private.dboSentence']
      if (s && typeof s === 'object' && !char.deleted) id.sentences.push({ key: c.key, profileId: p, name: c.name, tag, sentence: s })
    }
    for (const list of id.chars.values()) {
      list.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || parseInt(a.key, 16) - parseInt(b.key, 16))
    }
    return id
  }

  return {
    get() {
      if (!cache || now() - cache.at >= ttlMs) cache = { at: now(), id: build() }
      return cache.id
    },
  }
}

const discordNameOf = (id, discordId) => (discordId && id.names.has(discordId) ? id.names.get(discordId).shown : null)

module.exports = { createIdentity, discordNameOf }
