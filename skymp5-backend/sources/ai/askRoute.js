'use strict'
// Deterministic routing for /dragonbaron ask: entities by regex, then an ordered intent table (at most 2 intents, no model)

const { ruleRefsOf } = require('./retrieve')

const INTENTS = Object.freeze(['refuse', 'held', 'bug_id', 'punish_player', 'punish_active', 'player_reports', 'online', 'status',
  'gm_calls', 'tickets', 'changes', 'version', 'bug_search', 'handbook', 'rules'])

// Intents that exist for an Owner only (rule 11.7); for anyone else route() never returns them and nothing names them
const OWNERS_ONLY_INTENTS = new Set(['held'])

// Template intents read data and need no model; the rest are answered by the model from excerpts
const MODEL_INTENTS = new Set(['version', 'handbook', 'rules'])
// Intents read from the rules documents (the current Server Rules and Staff Handbook only)
const DOC_INTENTS = new Set(['handbook', 'rules'])

const REFUSE_WORDS = /\b(ip|ips|hwid|device|alts?|vote[sd]?|election|ballot|transcripts?|passwords?|tokens?|webhooks?|backend\.env)\b/i
// Secrets are refused whatever the question; the other protected topics only when the question asks for the data itself
const SECRET_WORDS = /\b(passwords?|tokens?|webhooks?|backend\.env)\b/i
// A question about what a rule says: it names a rule id, a rules document or a permission ("can staff vote", "is X allowed")
const RULE_TEXT = /\b(rules?|handbook|policy|policies|allowed|permitted|forbidden|against the rules)\b|\b(who|can|may|must|should)\s+(i|a|an|we|you|players?|staff|gms?|trial gms?|lead gms?|owners?|devs?|developers?)\b/i
// ...but not when it asks for votes, results, addresses or matches themselves, or for one person's
const DATA_VERBS = /\b(show|print|list|reveal|dump|give|send|post|share|look\s?up|find|check|tell me)\b/i
const DATA_NOUNS = /\b(counts?|counted|tally|totals?|results?|standings?|so far|going|leading|winning|won|who voted|voted for|whose|logs?|match(es|ed)?|linked)\b/i
// A question about what a rules text says: "what does 2.6 say about the vote count" asks for the rule, not the count
const SAYS = /\b(what|how)\s+(does|do|did)\b(?:[^.?!]|\.(?=\d)){0,50}?\b(say|state|cover|word)\b|\bwhat\s+(is|are)\s+the\s+rules?\s+(on|about|for)\b/i
// Words that name the rules documents themselves
const DOC_WORDS = /\b(handbook|rulebook|server rules|the rules)\b/i
const IMPERATIVE = /^(please\s+)?(run|kick|ban|unban|give|spawn|teleport|restart|announce|jail|unjail|warn|mute|unmute|timeout|untimeout|promote|demote|grant|revoke|set|reset|remove|delete|add)\b/i
// A command verb that asks for information, not an action: "give me a summary of rule 9", "run me through 10.2", "ban rules?"
const NOT_A_COMMAND = new RegExp([
  /^(please\s+)?run\s+((me|us)\s+)?(through|down)\b/.source,
  /^(please\s+)?give\s+(me|us)\s+((a|an|the|some)\s+)?((short|quick|brief|full|plain)\s+)?(summary|overview|rundown|list|breakdown|explanation|text|wording|answer|details|info\w*|rules?|gist)\b/.source,
  /^(please\s+)?(kick|ban|warn|mute|jail|timeout|restart|promote|demote)\s+(rules?|polic(y|ies)|schedule|times?|length|duration|ladder|limits?|reasons?|appeals?|process|steps)\b/.source,
].join('|'), 'i')

const REFUSALS = Object.freeze([
  [/\b(vote[sd]?|election|ballot)\b/i, 'Election counts are never shown, to staff included (Staff Handbook 2.6). Nothing was run.'],
  [/\b(ip|ips|hwid|device|alts?)\b/i, 'IP addresses, device matches and alt accounts are never shown here. Nothing was run.'],
  [/\btranscripts?\b/i, 'Ticket transcripts are never used here. Nothing was run.'],
  [/\b(passwords?|tokens?|webhooks?|backend\.env)\b/i, 'Passwords, tokens, webhooks and server settings are never shown. Nothing was run.'],
])
const IMPERATIVE_TEXT = "I can't run commands. Use /console or the panel."

// Words that start a sentence or name a rank, never a player's name
const NOT_NAMES = new Set(('A An And Are Can Could Did Do Does For From Has Have How I If In Is It Me My No Not Of On Or Our So The ' +
  'Their There They This To Was We What When Where Which Who Whom Whose Why Will With You Your Any Many Much Some GM GMs Trial Lead ' +
  'Owner Owners Dev Devs Developer Staff Discord Dragonbaron DragonBreak Skyrim Server Rules Rule Handbook Please Today Yesterday ' +
  'Week Strike Strikes Ban Bans Banned Warning Warnings Suspension Suspended Jail Jailed Kick Kicked Timeout Punishment Punishments ' +
  'Right Now Still Currently Active Running Open Last Recent Recently Ever PK PKs January February March April May June July August ' +
  'September October November December Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec Monday Tuesday Wednesday Thursday Friday ' +
  'Saturday Sunday').split(' '))

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
// A question about a cause: the change log may name one (the model reads it); status, online, GM calls and tickets never do
const CAUSE = /\b(why|how come|what caused|caused by|cause of|the cause)\b/i
const NO_CAUSE_INTENTS = new Set(['status', 'online', 'gm_calls', 'tickets'])
// A time span the change log cannot cover: it reads the last 24 h, today or the last 7 days, nothing older
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec'
const BEYOND = new RegExp([
  /\b(last|past|previous|this|a|one|the)\s+(month|year|quarter|fortnight)\b/.source,
  /\b(\d+|an?|one|two|three|four|five|six|several|few)\s+(months?|years?)\b/.source,
  /\b([2-9]|\d{2,}|two|three|four|five|six|several|few)\s+weeks\b/.source,
  /\b(months?|years?)\s+ago\b/.source,
  `\\b(in|during|since|before|until|prior to|throughout)\\s+(${MONTHS})\\b`,
  `\\b(before|until|prior to)\\s+(the\\s+)?\\d{1,2}(st|nd|rd|th)?\\s+(of\\s+)?(${MONTHS})\\b`,
  /\b(in|during|since|before|until|prior to)\s+(19|20)\d{2}\b/.source,
  /\b(last|past)\s+([89]|[1-9]\d+)\s+days\b/.source,
].join('|'), 'i')
// A question about a release still to come: "the next launcher version", "when will 0.3.120 be released"
const FUTURE = new RegExp([
  /\b(next|upcoming|future|coming|planned|unreleased)\s+(\w+\s+)?(versions?|releases?|updates?|patch(es)?|launchers?|clients?|builds?)\b/.source,
  /\bwhen\s+(will|would|shall)\b(?:[^.?!]|\.(?=\d)){0,40}\b(releas\w*|out|ship\w*|launch\w*|live|deploy\w*|land|arrive|come)\b/.source,
  /\bwill\b(?:[^.?!]|\.(?=\d)){0,40}\b(be released|be out|come out|ship|go live|launch|be deployed)\b/.source,
].join('|'), 'i')
// A question about an older version of the rules or handbook ("what did the handbook say before 2026"), which the reader never holds
const OLD_DOC = new RegExp([
  /\b(old|older|previous|former|outdated|superseded)\s+((server|discord)\s+)?(rules|rulebook|handbooks?|(staff|gm|trial gm)\s+handbooks?)\b/.source,
  /\bused to (say|read|allow|forbid|require|be)\b/.source,
].join('|'), 'i')
const SAID = /\b(did|was|were|had)\b(?:[^.?!]|\.(?=\d)){0,60}?\b(say|said|read|state[sd]?|word(ed|ing)?|allow(ed)?|forb(id|ade|idden)|cover(ed)?|requir(e|ed)|permit(ted)?)\b/i
const OLD_WORDING = /\b(old|older|previous|earlier|former|original|prior|past|first)\s+(versions?|editions?|wording|drafts?)\b|\bbefore\s+(the|its|their|it|they)\s+((last|latest|recent)\s+)?(was\s+|were\s+|got\s+)?(update|change|rewrite|revision|edit)\w*\b/i
const OBJECT_TIME = /\b(made|created|had|joined|registered|opened|used|bought|done|given|issued|received|happened|linked)\s+(before|until|prior to|in|during|since)\b/i

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
    : BEYOND.test(text) ? 'beyond'
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

// Refused: a command, a secret, or votes, addresses, alts and transcripts asked for as data (not what a rule says about them)
function refusalOf(q, entities = extractEntities(q)) {
  if (IMPERATIVE.test(q.trim()) && !NOT_A_COMMAND.test(q.trim())) return IMPERATIVE_TEXT
  if (!REFUSE_WORDS.test(q)) return null
  const aboutRules = !SECRET_WORDS.test(q) && (entities.ruleRefs.length > 0 || RULE_TEXT.test(q)) && !DATA_VERBS.test(q) && (SAYS.test(q) || !DATA_NOUNS.test(q)) &&
    !entities.tags.length && !entities.names.length && !entities.threadIds.length
  if (aboutRules) return null
  for (const [rx, text] of REFUSALS) if (rx.test(q)) return text
  return 'That is never shown here. Nothing was run.'
}

// [{intent, args}], at most 2; a refusal stands alone; [] means nothing matched (the caller searches rules and handbook)
// viewer.tier 'owner' adds the Owners-only intents; for any other viewer the result is exactly as if they did not exist
function route(q, entities = extractEntities(q), viewer = {}) {
  const text = String(q || '')
  const refusal = refusalOf(text, entities)
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
    const aboutDocs = (DOC_WORDS.test(text) || SAYS.test(text)) && !entities.names.length
    if ((PUNISH_GENERAL.test(text) || aboutDocs) && !entities.tags.length) { add('handbook', { q: text }); add('rules', { q: text }) }
    else if (entities.tags.length || entities.names.length) add('punish_player', { query: entities.tags[0] || entities.names[0] }, ['status', 'bug_search', 'player_reports'])
    else add('punish_active', {}, ['status', 'bug_search'])
  }
  if (entities.tags.length && /\breport/i.test(text)) add('player_reports', { query: [entities.names[0], entities.tags[0]].filter(Boolean).join(' ') }, ['bug_search', 'status'])
  if (/how many (players|people|are (on|online|playing))|who('?s| is| are) (on|online|playing)|players? online/i.test(text)) add('online')
  if (/\b(up|down|status|running|crash\w*|restart\w*|online)\b/i.test(text)) add('status')
  if (/\bgm ?calls?\b|\/gm\b|waiting for a gm/i.test(text)) add('gm_calls', {}, ['handbook', 'tickets'])
  if (/\b(how many|open|which|list|count|waiting)\b[^.?!]*\btickets?\b|\btickets?\b[^.?!]*\b(open|waiting|are there)\b/i.test(text)) add('tickets', {}, ['handbook'])
  if (/\b(chang\w+|deploy\w*|releas\w+|went live|updat\w+|patch\w*)\b/i.test(text)) {
    add('changes', { time: entities.time === 'restart' ? 'today' : entities.time || '24', summary: SUMMARY.test(text) || CAUSE.test(text) }, ['bug_search'])
  }
  if (entities.clientVer || entities.launcherVer || /\bversion|launcher\b/i.test(text)) add('version', { clientVer: entities.clientVer, launcherVer: entities.launcherVer })
  if (/\b(bugs?|broken|fix(ed)?|issues?|glitch\w*)\b/i.test(text)) add('bug_search', { q: text })
  if (/\b(trial gms?|lead gms?|gms?|staff|handbook|ranks?)\b/i.test(text)) add('handbook', { q: text })
  if (entities.ruleRefs.length || /\b(rules?|allowed|can (i|a|we|players?)|pk\w*|nlr|metagam\w*|ooc|ic|bleed)\b/i.test(text)) add('rules', { q: text })
  if (ruleish && !out.length) add('rules', { q: text })
  return out
}

const isLore = q => LORE.test(String(q || ''))
const asksCause = q => CAUSE.test(String(q || ''))
const asksFuture = q => FUTURE.test(String(q || ''))
function asksOldVersion(q, entities = extractEntities(q)) {
  const text = String(q || '')
  if (OLD_DOC.test(text)) return true
  if (!SAID.test(text)) return false
  return OLD_WORDING.test(text) || (entities.time === 'beyond' && !OBJECT_TIME.test(text))
}

module.exports = { extractEntities, route, refusalOf, isLore, asksCause, asksFuture, asksOldVersion, INTENTS, MODEL_INTENTS, OWNERS_ONLY_INTENTS, NO_CAUSE_INTENTS, DOC_INTENTS, HELD }
