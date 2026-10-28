'use strict'
// Deterministic routing for /dragonbaron ask: entities by regex, then an ordered intent table (at most 2 intents, no model)

const { ruleRefsOf } = require('./retrieve')

const INTENTS = Object.freeze(['refuse', 'held', 'bug_id', 'punish_player', 'punish_active', 'player_reports', 'online', 'status',
  'gm_calls', 'tickets', 'changes', 'version', 'bug_search', 'handbook', 'rules'])

// Intents that exist for an Owner only (rule 11.7); for anyone else route() never returns them and nothing names them
const OWNERS_ONLY_INTENTS = new Set(['held'])

// Template intents read data and need no model; the rest are answered by the model from excerpts
const MODEL_INTENTS = new Set(['version', 'handbook', 'rules'])

const REFUSE_WORDS = /\b(ip|ips|hwid|device|alts?|vote[sd]?|election|ballot|transcripts?|password|token|webhook|backend\.env)\b/i
const IMPERATIVE = /^(please\s+)?(run|kick|ban|unban|give|spawn|teleport|restart|announce|jail|warn)\b/i

const REFUSALS = Object.freeze([
  [/\b(vote[sd]?|election|ballot)\b/i, 'Election counts are never shown, to staff included (Staff Handbook 2.6). Nothing was run.'],
  [/\b(ip|ips|hwid|device|alts?)\b/i, 'IP addresses, device matches and alt accounts are never shown here. Nothing was run.'],
  [/\btranscripts?\b/i, 'Ticket transcripts are never used here. Nothing was run.'],
  [/\b(password|token|webhook|backend\.env)\b/i, 'Passwords, tokens, webhooks and server settings are never shown. Nothing was run.'],
])
const IMPERATIVE_TEXT = "I can't run commands. Use /console or the panel."

// Words that start a sentence or name a rank, never a player's name
const NOT_NAMES = new Set(('A An And Are Can Could Did Do Does For From Has Have How I If In Is It Me My No Not Of On Or Our So The ' +
  'Their There They This To Was We What When Where Which Who Whom Whose Why Will With You Your Any Many Much Some GM GMs Trial Lead ' +
  'Owner Owners Dev Devs Developer Staff Discord Dragonbaron DragonBreak Skyrim Server Rules Rule Handbook Please Today Yesterday ' +
  'Week Strike Strikes Ban Bans Banned Warning Warnings Suspension Suspended Jail Jailed Kick Kicked Timeout Punishment Punishments ' +
  'Right Now Still Currently Active Running Open Last Recent Recently Ever PK PKs').split(' '))

const PUNISH = /\b(strikes?|warn(ing|ings|ed)?|bann?ed|bans|suspen\w+|jail\w*|punish\w*|kick(ed)?|timeouts?)\b/i
// A general question about the ladder (how long a strike lasts), not about one player's record
const PUNISH_GENERAL = /\bhow (long|many)\b|\bbefore (a )?review\b|\bexpire|\bladder\b|\bwhat happens\b|\bwho can\b/i
const RULEISH = /\b(who (can|may)|can (i|a|an|we|you|players?|staff|gms?|trial gms?|lead gms?)|allowed|may (i|a|an|we)|permitted|against the rules)\b/i
// "Is ERP banned?" asks about a rule; "Is Bron banned?" (a name or #TAG) asks about a record
const BANNED_Q = /\b(is|are)\s+[\w' -]{1,30}?\s+(allowed|banned|forbidden|prohibited|against the rules)\b/i
const LORE = /\b(lore|canon|uesp|daedr\w*|aedra|elder scrolls|vigilants?|thalmor|dragonborn)\b/i
// The detector's held list: hits on staff authors kept for the Owners (held reports, staff hits, flags about GMs)
const HELD = new RegExp([
  /\bheld\b[^.?!]{0,25}\b(list|reports?|hits?|items?|flags?|owners?)\b/,
  /\b(reports?|hits?|flags?|items?)\b[^.?!]{0,15}\bheld\b/,
  /\bstaff\b[^.?!]{0,25}\b(reports?|hits?|flags?|flagged|infractions?)\b/,
  /\b(reports?|hits?|flags?|flagged|infractions?)\b[^.?!]{0,25}\b(on|about|against|by|for|from|of)\b[^.?!]{0,12}\b(staff|gms?|lead gms?|trial gms?|devs?)\b/,
  /\binfraction[- ]?(detection|watch|check|reports?|hits?)\b/,
].map(r => r.source).join('|'), 'i')
const SUMMARY = /\b(summar\w*|overview|explain|what('s| is| was)? new|what changed|in short)\b/i

function extractEntities(q) {
  const text = String(q || '')
  const tags = [...new Set((text.match(/#[A-Za-z0-9]{4}(?![A-Za-z0-9-])/g) || []).map(t => t.toUpperCase()))]
  const threadIds = []
  for (const m of text.matchAll(/<#(\d{17,20})>|discord\.com\/channels\/\d+\/(\d{17,20})(?:\/\d{17,20})?|\b(\d{17,20})\b/g)) {
    const id = m[1] || m[2] || m[3]
    if (!threadIds.includes(id)) threadIds.push(id)
  }
  const clientVer = (/\b0\.3\.\d+\b/.exec(text) || [null])[0]
  const launcherVer = (/\b2\.1\.\d+\b/.exec(text) || [null])[0]
  const ruleRefs = ruleRefsOf(text)
  const time = /since (the )?(last )?restart/i.test(text) ? 'restart'
    : /\b(this week|last week|week|7 days)\b/i.test(text) ? 'week'
      : /\btoday\b/i.test(text) ? 'today'
        : /\b(24 ?h|24 hours|yesterday|last day)\b/i.test(text) ? '24' : null
  const quoted = [...text.matchAll(/["\u201c]([^"\u201d]{2,40})["\u201d]/g)].map(m => m[1].trim())
  const names = [...quoted]
  // Capitalised words after the first word, joined when they follow each other (Katell Stormblade)
  const words = text.replace(/["\u201c\u201d]/g, ' ').split(/\s+/)
  let run = []
  const push = () => { if (run.length) { const n = run.join(' '); if (!names.includes(n)) names.push(n) } run = [] }
  words.forEach((w, i) => {
    const clean = w.replace(/^[^\p{L}]+|[^\p{L}'-]+$/gu, '').replace(/'s$/, '')
    const word = !/^[#<@/\d]/.test(w) && /^\p{Lu}[\p{L}'-]{1,23}$/u.test(clean) && !/^\p{Lu}+$/u.test(clean)
    if (i > 0 && word && !NOT_NAMES.has(clean)) run.push(clean)
    else push()
    if (/[.?!,;:]$/.test(w)) push()
  })
  push()
  return { tags, threadIds, clientVer, launcherVer, ruleRefs, time, names: names.slice(0, 3) }
}

function refusalOf(q) {
  if (IMPERATIVE.test(q.trim())) return IMPERATIVE_TEXT
  if (!REFUSE_WORDS.test(q)) return null
  for (const [rx, text] of REFUSALS) if (rx.test(q)) return text
  return 'That is never shown here. Nothing was run.'
}

// [{intent, args}], at most 2; a refusal stands alone; [] means nothing matched (the caller searches rules and handbook)
// viewer.tier 'owner' adds the Owners-only intents; for any other viewer the result is exactly as if they did not exist
function route(q, entities = extractEntities(q), viewer = {}) {
  const text = String(q || '')
  const refusal = refusalOf(text)
  if (refusal) return [{ intent: 'refuse', args: { text: refusal } }]

  const out = []
  const suppressed = new Set()
  const add = (intent, args = {}, suppress = []) => {
    if (out.length >= 2 || suppressed.has(intent) || out.some(o => o.intent === intent)) return
    out.push({ intent, args })
    for (const s of suppress) suppressed.add(s)
  }
  if (viewer && viewer.tier === 'owner' && HELD.test(text)) {
    add('held', {}, ['handbook', 'player_reports', 'punish_active', 'bug_search', 'status', 'tickets', 'gm_calls'])
  }
  const ruleish = RULEISH.test(text) || (BANNED_Q.test(text) && !entities.tags.length && !entities.names.length)
  if (ruleish) for (const s of ['status', 'online', 'changes', 'tickets', 'gm_calls', 'bug_search']) suppressed.add(s)

  if (entities.threadIds.length) add('bug_id', { ids: entities.threadIds.slice(0, 2) }, ['status', 'bug_search', 'changes'])
  if (PUNISH.test(text) && !ruleish) {
    if (PUNISH_GENERAL.test(text) && !entities.tags.length) { add('handbook', { q: text }); add('rules', { q: text }) }
    else if (entities.tags.length || entities.names.length) add('punish_player', { query: entities.tags[0] || entities.names[0] }, ['status', 'bug_search', 'player_reports'])
    else add('punish_active', {}, ['status', 'bug_search'])
  }
  if (entities.tags.length && /\breport/i.test(text)) add('player_reports', { query: [entities.names[0], entities.tags[0]].filter(Boolean).join(' ') }, ['bug_search', 'status'])
  if (/how many (players|people|are (on|online|playing))|who('?s| is| are) (on|online|playing)|players? online/i.test(text)) add('online')
  if (/\b(up|down|status|running|crash\w*|restart\w*|online)\b/i.test(text)) add('status')
  if (/\bgm ?calls?\b|\/gm\b|waiting for a gm/i.test(text)) add('gm_calls', {}, ['handbook', 'tickets'])
  if (/\b(how many|open|which|list|count|waiting)\b[^.?!]*\btickets?\b|\btickets?\b[^.?!]*\b(open|waiting|are there)\b/i.test(text)) add('tickets', {}, ['handbook'])
  if (/\b(chang\w+|deploy\w*|releas\w+|went live|updat\w+|patch\w*)\b/i.test(text)) {
    add('changes', { time: entities.time === 'restart' ? 'today' : entities.time || '24', summary: SUMMARY.test(text) }, ['bug_search'])
  }
  if (entities.clientVer || entities.launcherVer || /\bversion|launcher\b/i.test(text)) add('version', { clientVer: entities.clientVer, launcherVer: entities.launcherVer })
  if (/\b(bugs?|broken|fix(ed)?|issues?|glitch\w*)\b/i.test(text)) add('bug_search', { q: text })
  if (/\b(trial gms?|lead gms?|gms?|staff|handbook|ranks?)\b/i.test(text)) add('handbook', { q: text })
  if (entities.ruleRefs.length || /\b(rules?|allowed|can (i|a|we|players?)|pk\w*|nlr|metagam\w*|ooc|ic|bleed)\b/i.test(text)) add('rules', { q: text })
  if (ruleish && !out.length) add('rules', { q: text })
  return out
}

const isLore = q => LORE.test(String(q || ''))

module.exports = { extractEntities, route, refusalOf, isLore, INTENTS, MODEL_INTENTS, OWNERS_ONLY_INTENTS, HELD }
