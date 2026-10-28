'use strict'

const fs = require('fs')
const path = require('path')

const TOMES_PATHS = [
  '/opt/alduinak/build/dist/server/spell-tomes.json',
  path.resolve(__dirname, '../../build/dist/server/spell-tomes.json'),
  path.resolve(__dirname, '../../../build/dist/server/spell-tomes.json'),
  path.resolve(__dirname, '../../data/spell-tomes.json')
]

let cachedTomes = null

function loadTomes() {
  if (cachedTomes) return cachedTomes
  for (const p of TOMES_PATHS) {
    try {
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
        if (Array.isArray(raw.tomes)) {
          cachedTomes = raw.tomes
          return cachedTomes
        }
      }
    } catch (e) {
      // try next
    }
  }
  cachedTomes = []
  return cachedTomes
}

const rankNames = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']

const CATEGORIES = [
  { id: 'popular', label: '⭐ Popular / Staff Staples', desc: 'Comforting Bloom, Fast Healing, Flames, Bound Bow...' },
  { id: 'rest_low', label: '🌿 Restoration: Novice & Apprentice', desc: 'Healing, Healing Hands, Comforting Bloom, Wards', school: 'Restoration', ranks: [0, 1] },
  { id: 'rest_adept', label: '🌿 Restoration: Adept', desc: 'Close Wounds, Greater Ward, Heal Other, Turn Undead', school: 'Restoration', ranks: [2] },
  { id: 'rest_high', label: '🌿 Restoration: Expert & Master', desc: 'Grand Healing, Bane of the Undead, Circle of Protection', school: 'Restoration', ranks: [3, 4] },
  { id: 'dest_novice', label: '⚡ Destruction: Novice', desc: 'Flames, Frostbite, Sparks, Concentration spells', school: 'Destruction', ranks: [0] },
  { id: 'dest_apprentice', label: '⚡ Destruction: Apprentice', desc: 'Firebolt, Ice Spike, Lightning Bolt, Runes', school: 'Destruction', ranks: [1] },
  { id: 'dest_adept', label: '⚡ Destruction: Adept', desc: 'Fireball, Ice Storm, Chain Lightning, Elemental Cloaks', school: 'Destruction', ranks: [2] },
  { id: 'dest_high', label: '⚡ Destruction: Expert & Master', desc: 'Incinerate, Icy Spear, Thunderbolt, Wall & Storm spells', school: 'Destruction', ranks: [3, 4] },
  { id: 'conj_novice', label: '💀 Conjuration: Novice', desc: 'Bound Sword, Bound Dagger, Conjure Familiar', school: 'Conjuration', ranks: [0] },
  { id: 'conj_apprentice', label: '💀 Conjuration: Apprentice', desc: 'Bound Battleaxe, Conjure Flame Atronach, Reanimate', school: 'Conjuration', ranks: [1] },
  { id: 'conj_adept', label: '💀 Conjuration: Adept', desc: 'Bound Bow, Conjure Frost Atronach, Soul Trap', school: 'Conjuration', ranks: [2] },
  { id: 'conj_high', label: '💀 Conjuration: Expert & Master', desc: 'Conjure Storm Atronach, Dremora Lord, Dead Thrall', school: 'Conjuration', ranks: [3, 4] },
  { id: 'alt_low', label: '🛡️ Alteration: Novice & Apprentice', desc: 'Oakflesh, Stoneflesh, Candlelight, Magelight', school: 'Alteration', ranks: [0, 1] },
  { id: 'alt_high', label: '🛡️ Alteration: Adept, Expert & Master', desc: 'Ironflesh, Telekinesis, Ebonyflesh, Paralyze, Dragonhide', school: 'Alteration', ranks: [2, 3, 4] },
  { id: 'ill_low', label: '👁️ Illusion: Novice & Apprentice', desc: 'Clairvoyance, Courage, Fury, Calm, Fear, Muffle', school: 'Illusion', ranks: [0, 1] },
  { id: 'ill_high', label: '👁️ Illusion: Adept, Expert & Master', desc: 'Frenzy, Rally, Invisibility, Pacify, Rout, Mayhem', school: 'Illusion', ranks: [2, 3, 4] }
]

const POPULAR_SPELLS = [
  'Comforting Bosom', 'Divine Bolt', 'Healing', 'Fast Healing', 'Healing Hands',
  'Close Wounds', 'Grand Healing', 'Flames', 'Firebolt', 'Fireball',
  'Frostbite', 'Ice Spike', 'Ice Storm', 'Sparks', 'Lightning Bolt',
  'Chain Lightning', 'Thunderbolt', 'Bound Sword', 'Bound Bow', 'Conjure Flame Atronach',
  'Conjure Frost Atronach', 'Oakflesh', 'Ironflesh', 'Candlelight', 'Invisibility'
]

function getCategories() {
  return CATEGORIES.map(c => ({
    id: c.id,
    label: c.label,
    desc: c.desc
  }))
}

function getCategoryLabel(catId) {
  const c = CATEGORIES.find(x => x.id === catId)
  return c ? c.label : '⭐ Popular / Staff Staples'
}

function getSpellsForCategory(catId) {
  const tomes = loadTomes()
  if (catId === 'popular') {
    const result = []
    for (const name of POPULAR_SPELLS) {
      const found = tomes.find(t => t.spellName && t.spellName.toLowerCase() === name.toLowerCase())
      if (found) {
        result.push({
          name: found.spellName,
          displayName: found.spellName === 'Comforting Bosom' ? 'Comforting Bloom' : found.spellName,
          tomeName: found.fullName || ('Spell Tome: ' + found.spellName),
          school: found.school,
          rank: rankNames[found.rank] || 'Novice',
          spellId: found.spellId
        })
      }
    }
    return result
  }

  const cat = CATEGORIES.find(c => c.id === catId) || CATEGORIES[0]
  const list = tomes.filter(t => t.school === cat.school && cat.ranks.includes(t.rank))
  const unique = []
  for (const t of list) {
    if (!t.spellName) continue
    const dName = t.spellName === 'Comforting Bosom' ? 'Comforting Bloom' : t.spellName
    if (!unique.some(x => x.name.toLowerCase() === t.spellName.toLowerCase())) {
      unique.push({
        name: t.spellName,
        displayName: dName,
        tomeName: t.fullName || ('Spell Tome: ' + t.spellName),
        school: t.school,
        rank: rankNames[t.rank] || 'Novice',
        spellId: t.spellId
      })
    }
  }
  unique.sort((a, b) => a.displayName.localeCompare(b.displayName))
  return unique.slice(0, 25)
}

function findTomeForSpell(spellName) {
  const tomes = loadTomes()
  const q = String(spellName || '').trim().toLowerCase()
  const found = tomes.find(t =>
    (t.spellName && t.spellName.toLowerCase() === q) ||
    (t.spellName === 'Comforting Bosom' && q === 'comforting bloom') ||
    (t.fullName && t.fullName.toLowerCase().includes(q))
  )
  if (found) return found.fullName || ('Spell Tome: ' + (found.spellName === 'Comforting Bosom' ? 'Comforting Bloom' : found.spellName))
  return `Spell Tome: ${spellName}`
}

module.exports = {
  getCategories,
  getCategoryLabel,
  getSpellsForCategory,
  findTomeForSpell
}
