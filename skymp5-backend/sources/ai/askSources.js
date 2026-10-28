'use strict'
// The only data /dragonbaron ask can read: a fixed list of readers, each picking named fields and checking the asker's rank
// A timeout, an error or output that is not JSON gives the card "not available"; nothing here writes or runs a game command

const path = require('path')
const retrieve = require('./retrieve')
const { RULES_DIR } = require('../serverRules')

const DBD_COMS = '/opt/dragonbreak-tools/dbd-coms.py'
const LIVE_FILE = '/var/lib/dbo-monitor/live.json'
// The detector's Owners-only list of hits on staff authors (cross-part contract, 28 Oct): root 0600, one JSON object a line
const HELD_FILE = '/opt/dragonbreak-tools/state/infraction-watch-held.jsonl'
const BUG_TRACKER = '1551740319974821949'
const DATA_DIR = path.join(__dirname, '..', '..', 'data')
const SNOWFLAKE = /^\d{17,20}$/

const DEFAULT_TIMEOUT = Object.freeze({ dbd: 12000, file: 1000, discord: 6000, punish: 10000, local: 1000 })
const TIER_RANK = Object.freeze({ trialgm: 1, gm: 2, leadgm: 3, dev: 4, owner: 5 })
const atLeast = (tier, min) => (TIER_RANK[tier] || 0) >= TIER_RANK[min]

const READERS = Object.freeze({
  status: { minTier: 'trialgm', model: false },
  changes: { minTier: 'trialgm', model: 'summary' },
  version: { minTier: 'trialgm', model: true },
  bug_id: { minTier: 'trialgm', model: false },
  bug_search: { minTier: 'trialgm', model: false },
  player_reports: { minTier: 'gm', model: false },
  rules: { minTier: 'trialgm', model: true },
  gm_calls: { minTier: 'gm', model: false },
  online: { minTier: 'gm', model: false },
  tickets: { minTier: 'gm', model: false },
  punish_player: { minTier: 'trialgm', model: false },
  punish_active: { minTier: 'trialgm', model: false },
  // hidden: below its rank the reader answers nothing at all, not even "not shown to your rank"
  held: { minTier: 'owner', model: false, hidden: true },
})

const MAX_CHANGES = 15
const MAX_NEWS = 2
const NEWS_CHARS = 1500
const MAX_ROWS = 10

// The held list as shown: the newest 10 of the last 30 days, sized so they fit one embed
const HELD = Object.freeze({ rows: 10, days: 30, maxBytes: 4 * 1024 * 1024, budget: 3950, link: 100 })
const RULE_IDS = new Set('1 2 3 8 9 14 18 19 1.2 1.5 1.6 5.3 7.1 9.7 10.2 11.2 11.7 D1 D3 D4 D5 D6 D7 D9 D10'.split(' '))
const CATEGORY = Object.freeze({
  ooc_in_ic: 'OOC in IC', ooc_hostile: 'Hostile OOC', bleed: 'Character bleed', metagame: 'Metagaming', other_rule: 'Other rule',
})
const JUMP = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})$/
const idCmp = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0)

// One line of the held list, or null when it breaks the contract; display fields are cut, ids are checked
function heldEntry(line) {
  let o
  try { o = JSON.parse(line) } catch { return null }
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return null
  const at = typeof o.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(o.at) ? Date.parse(o.at) : NaN
  if (!Number.isFinite(at) || !SNOWFLAKE.test(String(o.guild_id)) || !SNOWFLAKE.test(String(o.message_id))) return null
  const categories = (Array.isArray(o.categories) ? o.categories : []).filter(c => typeof c === 'string' && CATEGORY[c])
  if (!categories.length) return null
  const j = JUMP.exec(typeof o.jump === 'string' ? o.jump : '')
  const jump = j && j[1] === String(o.guild_id) && j[3] === String(o.message_id) ? { guild: j[1], channel: j[2], message: j[3] } : null
  return {
    at, message: String(o.message_id), jump,
    guild: plain(o.guild, 30), channel: plain(o.channel, 30).replace(/^#+/, ''), author: plain(o.author, 32), role: plain(o.staff_role, 20),
    categories: [...new Set(categories)].slice(0, 2),
    rules: [...new Set((Array.isArray(o.rule_ids) ? o.rule_ids : []).map(String).filter(r => RULE_IDS.has(r)))].slice(0, 3),
    confidence: typeof o.confidence === 'number' && o.confidence >= 0 && o.confidence <= 1 ? o.confidence : null,
    reason: plain(o.reason, 200), excerpt: plain(o.excerpt, 200),
  }
}

class Unavailable extends Error {}

function withTimeout(promise, ms) {
  let timer
  const t = new Promise((_, reject) => { timer = setTimeout(() => reject(new Unavailable('timeout')), ms) })
  return Promise.race([Promise.resolve().then(() => promise), t]).finally(() => clearTimeout(timer))
}

// One line of plain text from a value we were handed, cut to max characters
const plain = (v, max = 120) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : '')
const minute = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? `${v.slice(0, 10)} ${v.slice(11, 16)}Z` : plain(v, 20))
const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : plain(v, 20))
const msOf = v => (typeof v === 'number' && Number.isFinite(v) ? (v < 1e12 ? v * 1000 : v) : typeof v === 'string' ? Date.parse(v) : NaN)
const ago = (ms, t) => {
  if (!Number.isFinite(ms)) return 'unknown age'
  const m = Math.max(0, Math.round((t - ms) / 60000))
  return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.floor(m / 60)} h ${m % 60} min ago` : `${Math.floor(m / 1440)} days ago`
}
const snowDay = id => (SNOWFLAKE.test(String(id)) ? new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString().slice(0, 10) : '')

// Words of the question that are safe to hand to dbd-coms as separate arguments
const STOPWORDS = new Set('the and for any has have with what whats when where which who why how does did this that bug bugs fixed fix broken issue issues glitch still status there about from report reports reported'.split(' '))
function safeWords(text, { max = 6, minLen = 3, lower = true } = {}) {
  const t = String(text || '')
  return (lower ? t.toLowerCase() : t).split(/[^\p{L}\p{N}#'-]+/u)
    .map(w => w.replace(/^[-']+|[-']+$/g, ''))
    .filter(w => w.length >= minLen && w.length <= 32 && !STOPWORDS.has(w.toLowerCase()))
    .slice(0, max)
}

const card = (o) => Object.assign({ stale: null, model: false, rows: null, links: [] }, o)
const unavailable = (key, label, minTier, why = 'unavailable') => card({ key, source: key.split(':')[0], label, asOf: null, stale: why, text: 'not available', minTier })

function createSources({
  config = {}, execFile = require('child_process').execFile, readFile = require('fs').promises.readFile, fetchLocal, punishments,
  profileIdOf = () => null, ticketTypes = () => require('../discord/tickets').TYPES, rulesDir = RULES_DIR, now = Date.now, timeouts = {},
  heldFile = HELD_FILE, statFile = file => require('fs').promises.stat(file),
} = {}) {
  const TIMEOUT = { ...DEFAULT_TIMEOUT, ...timeouts }
  const local = fetchLocal || defaultFetchLocal(config)
  let threadCache = null

  // dbd-coms through execFile: fixed command names, the user's words as separate argv, no shell, a 12 s cap
  function dbd(cmd, args = []) {
    const run = new Promise((resolve, reject) => {
      execFile('python3', ['-I', DBD_COMS, cmd, ...args], {
        timeout: DEFAULT_TIMEOUT.dbd, maxBuffer: 262144, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
      }, (err, stdout) => {
        if (err) return reject(new Unavailable('failed'))
        let out
        const text = String(stdout).trim()
        try { out = JSON.parse(text) } catch { try { out = JSON.parse(text.split('\n').pop()) } catch { return reject(new Unavailable('not json')) } }
        if (!out || typeof out !== 'object' || Array.isArray(out) || out.error) return reject(new Unavailable('error'))
        resolve(out)
      })
    })
    return withTimeout(run, TIMEOUT.dbd + 500)
  }

  async function readJsonFile(file) {
    const text = await withTimeout(readFile(file, 'utf8'), TIMEOUT.file)
    if (String(text).length > 4 * 1024 * 1024) throw new Unavailable('too large')
    return JSON.parse(text)
  }

  async function status() {
    const o = await dbd('server-status')
    const api = o.backend_api || {}, game = o.game_server || {}, svc = o.backend_service || {}, dun = o.open_dungeons || {}
    const names = Array.isArray(dun.names) ? dun.names.map(n => plain(n, 60)).filter(Boolean).slice(0, 20) : []
    const lines = [
      `Game server: ${plain(game.state, 20) || 'unknown'}${game.since ? ` since ${minute(game.since)}` : ''}${Number.isFinite(game.for_minutes) ? ` (${Math.floor(game.for_minutes / 60)} h ${game.for_minutes % 60} min)` : ''}.`,
      `Backend: ${plain(svc.state, 20) || 'unknown'}${svc.since ? ` since ${minute(svc.since)}` : ''}.`,
      `Players online: ${Number.isFinite(api.players_online) ? api.players_online : 'unknown'}. Launcher API: ${plain(api.status, 20) || 'unknown'}. Client version: ${plain(api.client_version, 20) || 'unknown'}.`,
      `Open dungeons (${Number.isFinite(dun.count) ? dun.count : names.length}): ${names.join(', ') || 'none'}.`,
    ]
    return [card({ key: 'status', source: 'status', label: `Server status ${minute(o.checked_at)}`, asOf: plain(o.checked_at, 25), text: lines.join('\n'), minTier: 'trialgm' })]
  }

  async function changes(args) {
    const span = ['24', 'today', 'week'].includes(args.time) ? args.time : '24'
    const o = await dbd('changes', [span])
    const rows = (Array.isArray(o.changes) ? o.changes : []).slice(0, MAX_CHANGES)
      .map(r => `${minute(r.at)} ${plain(r.kind, 12)}: ${plain(r.headline, 220)}`)
    const what = span === '24' ? 'last 24 h' : span === 'today' ? 'today' : 'last 7 days'
    const more = Number.isFinite(o.count) && o.count > rows.length ? `\n(${o.count - rows.length} older rows not shown)` : ''
    return [card({
      key: `changes:${span}`, source: 'changes', label: `Change log, ${what}`, asOf: plain(o.until, 25),
      text: rows.length ? rows.join('\n') + more : 'No changes logged in that time.', minTier: 'trialgm', model: args.summary === true,
    })]
  }

  async function version(args) {
    const v = await withTimeout(local('/api/version'), TIMEOUT.local)
    if (!v || typeof v !== 'object') throw new Unavailable('bad reply')
    const out = [card({
      key: 'version', source: 'version', label: 'Launcher API /api/version', asOf: new Date(now()).toISOString().slice(0, 16) + 'Z', minTier: 'trialgm', model: true,
      text: `Launcher ${plain(v.version, 20) || 'unknown'}, client ${plain(v.clientVersion, 20) || 'unknown'}, server ${plain(v.serverVersion, 20) || 'unknown'}.`,
    })]
    const wanted = args.clientVer || plain(v.clientVersion, 20)
    let news = []
    for (const name of ['news.live.json', 'news.json']) {
      try { news = await readJsonFile(path.join(DATA_DIR, name)); break } catch { news = [] }
    }
    const hits = (Array.isArray(news) ? news : []).filter(n => n && plain(n.version, 30) === wanted).slice(0, MAX_NEWS)
    hits.forEach((n, i) => {
      const sections = (Array.isArray(n.sections) ? n.sections : []).map(s => `${plain(s?.heading, 80)}: ${(Array.isArray(s?.items) ? s.items : []).map(x => plain(x, 400)).join(' ')}`)
      const body = [plain(n.body, 600), ...sections].filter(Boolean).join('\n').slice(0, NEWS_CHARS)
      out.push(card({
        key: `news:${plain(n.version, 30)}:${i + 1}`, source: 'news', label: `Launcher news ${day(n.date)} "${plain(n.title, 80)}"`, asOf: day(n.date),
        text: `${plain(n.title, 120)} (${day(n.date)}, version ${plain(n.version, 30)})\n${body}`, minTier: 'trialgm', model: true,
      }))
    })
    return out
  }

  async function bugId(args) {
    const ids = (args.ids || []).filter(id => SNOWFLAKE.test(id)).slice(0, 2)
    return Promise.all(ids.map(async id => {
      try {
        const o = await dbd('bug', [id])
        const list = Array.isArray(o.threads) ? o.threads : [o]
        const t = list.find(x => x && String(x.thread_id) === id) || null
        if (!t) return card({ key: `bug:${id}`, source: 'bug_id', label: 'Bug thread', asOf: null, text: 'No bug thread with that id was found.', minTier: 'trialgm' })
        const res = plain(t.resolution, 300)
        const text = `${plain(t.title, 150)}; status ${plain(t.status, 30) || 'unknown'}; created ${day(t.created)}${res ? `; resolution: ${res}${t.resolution_at ? ` (${day(t.resolution_at)})` : ''}` : ''}`
        return card({ key: `bug:${id}`, source: 'bug_id', label: 'Bug thread', asOf: plain(o.corpus_built, 25) || null, text, minTier: 'trialgm', rows: [{ thread: id, text }], links: [id] })
      } catch {
        return unavailable(`bug:${id}`, 'Bug thread', 'trialgm')
      }
    }))
  }

  // The live active threads of #bug-tracker, cached 60 s; Exploit-tagged threads never leave here
  async function trackerThreads(discord) {
    const t = now()
    if (threadCache && t - threadCache.at < 60000 && t >= threadCache.at) return threadCache.value
    const forum = SNOWFLAKE.test(String(config.discordErrorForumChannelId || '')) ? String(config.discordErrorForumChannelId) : BUG_TRACKER
    if (!discord || typeof discord.activeThreads !== 'function') throw new Unavailable('no discord')
    const tags = await withTimeout(Promise.resolve(discord.forumTags(forum)), TIMEOUT.discord)
    const exploit = (Array.isArray(tags) ? tags : []).filter(x => /^exploit$/i.test(String(x?.name || '').trim())).map(x => String(x.id))
    if (!exploit.length) throw new Unavailable('the bug forum has no Exploit tag')
    const names = new Map((tags || []).map(x => [String(x.id), plain(x.name, 30)]))
    const res = await withTimeout(Promise.resolve(discord.activeThreads()), TIMEOUT.discord)
    const list = (Array.isArray(res?.threads) ? res.threads : Array.isArray(res) ? res : [])
      .filter(th => th && String(th.parent_id ?? th.parentId) === forum && SNOWFLAKE.test(String(th.id)))
      .map(th => ({ id: String(th.id), title: plain(th.name, 150), tags: (th.applied_tags ?? th.appliedTags ?? []).map(String) }))
      .filter(th => !th.tags.some(id => exploit.includes(id)))
      .map(th => ({ ...th, tagNames: th.tags.map(id => names.get(id)).filter(Boolean), created: snowDay(th.id) }))
    threadCache = { at: t, value: list }
    return list
  }

  async function bugSearch(args, viewer, ctx) {
    const words = safeWords(args.q)
    const out = []
    try {
      const threads = await trackerThreads(ctx.discord)
      const want = retrieve.tokens(words.join(' '))
      const hits = threads.map(th => {
        const have = new Set(retrieve.tokens(th.title))
        return { th, score: want.filter(w => have.has(w)).length }
      }).filter(h => h.score > 0).sort((a, b) => b.score - a.score || b.th.id.localeCompare(a.th.id)).slice(0, 5)
      const rows = hits.map(({ th }) => ({ thread: th.id, text: `${th.title}${th.tagNames.length ? ` [${th.tagNames.join(', ')}]` : ''}, opened ${th.created}` }))
      out.push(card({
        key: 'bugs:live', source: 'bug_search', label: '#bug-tracker active threads', asOf: new Date(now()).toISOString().slice(0, 16) + 'Z', minTier: 'trialgm',
        text: rows.length ? rows.map(r => r.text).join('\n') : 'No active #bug-tracker thread title matches those words.', rows, links: rows.map(r => r.thread),
      }))
    } catch (err) {
      out.push(unavailable('bugs:live', '#bug-tracker active threads', 'trialgm', err instanceof Unavailable && /Exploit/.test(err.message) ? 'refused: the forum has no Exploit tag' : 'unavailable'))
    }
    if (words.length) {
      try {
        const o = await dbd('bug', words)
        const corpus = minute(o.corpus_built) || 'unknown'
        const rows = (Array.isArray(o.threads) ? o.threads : []).slice(0, 5).filter(t => SNOWFLAKE.test(String(t?.thread_id)))
          .map(t => ({ thread: String(t.thread_id), text: `${plain(t.title, 150)}; ${plain(t.status, 30) || 'status unknown'}; created ${day(t.created)}` }))
        out.push(card({
          key: 'bugs:older', source: 'bug_search', label: 'Bug list', asOf: plain(o.corpus_built, 25), stale: `older list, up to ${corpus}`, minTier: 'trialgm',
          text: rows.length ? rows.map(r => r.text).join('\n') : 'No match in the older list.', rows, links: rows.map(r => r.thread),
        }))
      } catch {
        out.push(unavailable('bugs:older', 'Bug list', 'trialgm'))
      }
    }
    return out
  }

  async function playerReports(args, viewer, ctx) {
    const query = safeWords(args.query, { minLen: 2, max: 4, lower: false })
    const tag = (/#[A-Za-z0-9]{4}/.exec(String(args.query || '')) || [null])[0]
    const out = []
    if (query.length) {
      try {
        const o = await dbd('player-reports', query)
        const corpus = minute(o.corpus_built) || 'unknown'
        const rows = (Array.isArray(o.reports) ? o.reports : []).slice(0, MAX_ROWS).filter(r => SNOWFLAKE.test(String(r?.thread_id)))
          .map(r => ({ thread: String(r.thread_id), text: `${plain(r.title, 150)}; ${day(r.date)}; ${plain(r.status, 30) || 'status unknown'}` }))
        out.push(card({
          key: 'reports:older', source: 'player_reports', label: 'Player reports', asOf: plain(o.corpus_built, 25), stale: `older list, up to ${corpus}`,
          minTier: 'gm', text: rows.length ? rows.map(r => r.text).join('\n') : 'No reports in the older list.', rows, links: rows.map(r => r.thread),
        }))
      } catch {
        out.push(unavailable('reports:older', 'Player reports', 'gm'))
      }
    }
    if (tag) {
      try {
        const threads = await trackerThreads(ctx.discord)
        const rx = new RegExp(`^.{1,40} ${tag}:`, 'i')
        const rows = threads.filter(th => rx.test(th.title)).slice(0, MAX_ROWS).map(th => ({ thread: th.id, text: `${th.title}, opened ${th.created}` }))
        out.push(card({
          key: 'reports:live', source: 'player_reports', label: '#bug-tracker active threads', asOf: new Date(now()).toISOString().slice(0, 16) + 'Z', minTier: 'gm',
          text: rows.length ? rows.map(r => r.text).join('\n') : `No active #bug-tracker thread from ${tag.toUpperCase()}.`, rows, links: rows.map(r => r.thread),
        }))
      } catch {
        out.push(unavailable('reports:live', '#bug-tracker active threads', 'gm'))
      }
    }
    return out
  }

  async function rules(args, viewer) {
    const q = String(args.q || '')
    const chunks = retrieve.loadDocs(rulesDir)
    let docs = args.docs || retrieve.docsFor(q)
    const staffHidden = docs.includes('staff') && !atLeast(viewer.tier, 'gm')
    if (staffHidden) docs = docs.filter(d => d !== 'staff')
    const pool = chunks.filter(c => docs.includes(c.doc))
    const pinned = retrieve.exactRefs(q, pool)
    const ranked = retrieve.bm25(q, pool, 8).filter(h => !pinned.includes(h.chunk))
    const picked = [...pinned.map(c => ({ chunk: c, score: Infinity })), ...ranked].slice(0, 4)
    const out = picked.map(({ chunk, score }) => card({
      key: chunk.id, source: chunk.doc, label: chunk.label, asOf: chunk.version, minTier: chunk.doc === 'staff' ? 'gm' : 'trialgm', model: true,
      text: chunk.text, doc: `${chunk.docTitle} ${chunk.version}`, ref: chunk.ref, score, exact: score === Infinity,
    }))
    out.best = ranked.length ? ranked[0].score : pinned.length ? Infinity : 0
    if (staffHidden && !out.length) out.push(card({ key: 'staff:hidden', source: 'staff', label: 'Staff Handbook', asOf: null, stale: 'rank', text: 'The Staff Handbook is not shown to your rank here.', minTier: 'trialgm' }))
    return out
  }

  async function gmCalls() {
    const o = await readJsonFile(path.join(String(config.gameServerDir || ''), 'gm-calls.json'))
    const t = now()
    const open = (Array.isArray(o?.open) ? o.open : []).slice(0, 25)
    const rows = open.map(c => {
      const where = [plain(c?.place?.zone, 40), plain(c?.place?.desc, 80)].filter(Boolean).join(', ')
      return `Call ${Number.isFinite(c?.n) ? c.n : '?'}: ${plain(c?.name, 40) || 'unknown'}, ${where || 'place unknown'}, ${ago(msOf(c?.at), t)}, ${c?.takenBy ? 'taken' : 'free'}`
    })
    return [card({
      key: 'gm_calls', source: 'gm_calls', label: 'In-game GM calls', asOf: new Date(t).toISOString().slice(0, 16) + 'Z', minTier: 'gm',
      text: rows.length ? `${rows.length} open:\n${rows.join('\n')}` : 'No GM calls are open.',
    })]
  }

  async function online() {
    const o = await readJsonFile(LIVE_FILE)
    const names = (Array.isArray(o?.players) ? o.players : []).map(p => plain(p?.name, 40)).filter(Boolean)
    const at = msOf(o?.at)
    const stale = Number.isFinite(at) && now() - at > 5 * 60000 ? `as of ${new Date(at).toISOString().slice(0, 16)}Z` : null
    const shown = names.slice(0, 60)
    return [card({
      key: 'online', source: 'online', label: 'Players online (monitor)', asOf: Number.isFinite(at) ? new Date(at).toISOString().slice(0, 16) + 'Z' : null, stale, minTier: 'gm',
      text: `${names.length} online${shown.length ? `: ${shown.join(', ')}${names.length > shown.length ? ` and ${names.length - shown.length} more` : ''}` : ''}.`,
    })]
  }

  async function tickets(args, viewer, ctx) {
    const state = await readJsonFile(path.join(DATA_DIR, 'tickets.json'))
    const cats = state && typeof state.categories === 'object' && state.categories ? state.categories : {}
    if (!ctx.discord || typeof ctx.discord.channels !== 'function') throw new Unavailable('no discord')
    const channels = await withTimeout(Promise.resolve(ctx.discord.channels()), TIMEOUT.discord)
    const rows = []
    for (const type of ticketTypes()) {
      if (type.ownersOnly && viewer.tier !== 'owner') continue
      const cat = String(cats[type.id] || '')
      if (!SNOWFLAKE.test(cat)) continue
      const n = (channels || []).filter(c => c && String(c.parentId) === cat && (c.type === 0 || c.type === undefined)).length
      rows.push(`${plain(type.category || type.label, 40)}: ${n}`)
    }
    return [card({ key: 'tickets', source: 'tickets', label: 'Open tickets by type', asOf: new Date(now()).toISOString().slice(0, 16) + 'Z', minTier: 'gm', text: rows.join('\n') || 'No ticket categories are set up.' })]
  }

  // The held list for an Owner: a missing file means nothing is held; a file others could write is not trusted
  async function held() {
    const label = 'Held staff reports (Owners only)'
    const t = now()
    const asOf = new Date(t).toISOString().slice(0, 16) + 'Z'
    let st
    try { st = await withTimeout(Promise.resolve(statFile(heldFile)), TIMEOUT.file) } catch (err) {
      if (err && err.code === 'ENOENT') return [card({ key: 'held', source: 'held', label, asOf, minTier: 'owner', text: 'Nothing is held for the Owners.', embed: true })]
      throw err
    }
    const me = typeof process.getuid === 'function' ? process.getuid() : 0
    if (!st.isFile() || (st.uid !== 0 && st.uid !== me) || (st.mode & 0o022) || st.size > HELD.maxBytes) throw new Unavailable('not trusted')
    const text = String(await withTimeout(readFile(heldFile, 'utf8'), TIMEOUT.file))
    const lines = text.split('\n').filter(l => l.trim())
    const entries = lines.map(heldEntry)
    const bad = entries.filter(e => !e).length
    const cutoff = t - HELD.days * 86400000
    const recent = entries.filter(e => e && e.at >= cutoff && e.at <= t + 5 * 60000)
      .sort((a, b) => (b.at - a.at) || idCmp(b.message, a.message))
    const shown = recent.slice(0, HELD.rows)
    const intro = recent.length
      ? `${recent.length} held in the last ${HELD.days} days${recent.length > shown.length ? `; the newest ${shown.length} are shown` : ''}. Read the message before acting.`
      : `Nothing is held for the Owners in the last ${HELD.days} days.`
    const rows = [{ text: intro }]
    if (bad) rows.push({ text: `${bad} line${bad === 1 ? '' : 's'} of the list could not be read.` })
    const each = Math.floor((HELD.budget - rows.reduce((a, r) => a + r.text.length + 1, 0)) / Math.max(1, shown.length))
    shown.forEach((e, i) => {
      const head = [
        `${i + 1}. ${new Date(e.at).toISOString().slice(5, 16).replace('T', ' ')}Z`,
        [e.guild, e.channel ? `#${e.channel}` : ''].filter(Boolean).join(' ') || 'unknown place',
        `${e.author || 'unknown'}${e.role ? ` (${e.role})` : ''}`,
        e.categories.map(c => CATEGORY[c]).join(', '),
        e.rules.length ? e.rules.join(', ') : '',
        e.confidence === null ? '' : `confidence ${e.confidence.toFixed(2)}`,
      ].filter(Boolean).join(' \u00b7 ')
      rows.push({ text: head, jump: e.jump })
      const left = each - head.length - HELD.link - 2
      const ex = Math.min(200, Math.floor(left * 0.65) - 12)
      const why = Math.min(200, left - Math.max(0, ex) - 18)
      if (e.excerpt && ex >= 20) rows.push({ text: `Excerpt: "${e.excerpt.length > ex ? `${e.excerpt.slice(0, ex - 1)}\u2026` : e.excerpt}"` })
      if (e.reason && why >= 20) rows.push({ text: `Why: ${e.reason.length > why ? `${e.reason.slice(0, why - 1)}\u2026` : e.reason}` })
    })
    return [card({ key: 'held', source: 'held', label, asOf, minTier: 'owner', text: rows.map(r => r.text).join('\n'), rows, embed: true })]
  }

  const punishRow = r => [
    plain(r.kind, 20), [plain(r.target?.name, 40), plain(r.target?.tag, 6)].filter(Boolean).join(' '), plain(r.state, 20),
    r.reason ? `"${plain(r.reason, 160)}"` : '', r.until ? `until ${minute(r.until)}` : r.endsInMs ? `ends in ${Math.ceil(r.endsInMs / 3600000)} h` : '',
    r.by ? `by ${plain(r.by, 40)}` : '', r.at ? `at ${minute(r.at)}` : '',
  ].filter(Boolean).join(' \u00b7 ')

  async function punish(intent, args, viewer) {
    const label = 'Punishment records'
    if (!viewer.punishTier) return [card({ key: 'punish', source: 'punish', label, asOf: null, stale: 'rank', text: 'Punishment records are not visible to your rank here.', minTier: 'trialgm' })]
    const service = punishments()
    const pv = { tier: viewer.punishTier, discordId: viewer.discordId, profileId: profileIdOf(viewer.discordId) }
    const at = new Date(now()).toISOString().slice(0, 16) + 'Z'
    if (intent === 'punish_player') {
      const q = plain(args.query, 40)
      const found = q.length >= 1 ? await withTimeout(service.search(pv, q), TIMEOUT.punish) : { accounts: [] }
      const accounts = Array.isArray(found?.accounts) ? found.accounts : []
      if (accounts.length === 1) {
        const { status, body } = await withTimeout(service.player(pv, accounts[0].profileId, {}), TIMEOUT.punish)
        if (status !== 200) return [card({ key: 'punish', source: 'punish', label, asOf: at, text: 'That account is not shown to you.', minTier: 'trialgm' })]
        const chars = (body.characters || body.player?.characters || []).map(c => [plain(c?.name, 40), plain(c?.tag, 6)].filter(Boolean).join(' ')).filter(Boolean).slice(0, 5)
        const running = (body.active || []).slice(0, MAX_ROWS).map(punishRow)
        const history = (body.history || []).slice(0, MAX_ROWS).map(punishRow)
        const s = body.strikes || {}
        const text = [
          `Account: ${chars.join(', ') || 'no characters'}${body.player?.discordName ? ` (Discord ${plain(body.player.discordName, 40)})` : ''}`,
          `Strikes: ${Number.isFinite(s.count) ? s.count : 0}${Number.isFinite(s.review) ? ` (review at ${s.review}` : ''}${Number.isFinite(s.days) ? `, each counts ${s.days} days)` : Number.isFinite(s.review) ? ')' : ''}`,
          running.length ? `Running now:\n${running.join('\n')}` : 'Nothing running now.',
          history.length ? `History (newest first):\n${history.join('\n')}` : 'No history.',
        ].join('\n')
        return [card({ key: `punish:${accounts[0].profileId}`, source: 'punish', label, asOf: at, text, minTier: 'trialgm' })]
      }
      if (!accounts.length) return [card({ key: 'punish', source: 'punish', label, asOf: at, text: `No account matches ${q}.`, minTier: 'trialgm' })]
    }
    const res = await withTimeout(service.active(pv, {}), TIMEOUT.punish)
    const rows = (Array.isArray(res?.rows) ? res.rows : []).slice(0, MAX_ROWS).map(punishRow)
    const more = Array.isArray(res?.rows) && res.rows.length > MAX_ROWS ? `\n(${res.rows.length - MAX_ROWS} more not shown)` : ''
    return [card({ key: 'punish:active', source: 'punish', label: 'Punishments running now', asOf: at, minTier: 'trialgm', text: rows.length ? rows.join('\n') + more : 'Nothing is running now.' })]
  }

  const RUN = {
    status, changes, version, bug_id: bugId, bug_search: bugSearch, player_reports: playerReports, rules, gm_calls: gmCalls, online, tickets,
    punish_player: (a, v) => punish('punish_player', a, v), punish_active: (a, v) => punish('punish_active', a, v), held,
  }

  const LABEL = { status: 'Server status', changes: 'Change log', version: 'Launcher API /api/version', gm_calls: 'In-game GM calls', online: 'Players online', tickets: 'Open tickets by type', rules: 'Server Rules', punish_player: 'Punishment records', punish_active: 'Punishment records', bug_id: 'Bug thread', bug_search: '#bug-tracker', player_reports: 'Player reports', held: 'Held staff reports (Owners only)' }

  // The cards for one intent, checked against the asker's rank; never throws
  async function read(intent, args = {}, viewer = {}, ctx = {}) {
    const reader = READERS[intent]
    if (!reader || !RUN[intent]) return []
    if (reader.hidden && !atLeast(viewer.tier, reader.minTier)) return []
    if (!atLeast(viewer.tier, reader.minTier)) {
      return [card({ key: `${intent}:rank`, source: intent, label: LABEL[intent], asOf: null, stale: 'rank', text: `${LABEL[intent]} is not shown to your rank here.`, minTier: reader.minTier })]
    }
    try {
      const cards = await RUN[intent](args, viewer, ctx)
      const kept = cards.filter(c => atLeast(viewer.tier, c.minTier))
      if ('best' in cards) kept.best = cards.best
      return kept
    } catch {
      return [unavailable(intent, LABEL[intent], reader.minTier)]
    }
  }

  return { read }
}

// GET a backend route on loopback with a 1 s cap; only paths from this file are asked for
function defaultFetchLocal(config, ms = DEFAULT_TIMEOUT.local) {
  return route => new Promise((resolve, reject) => {
    const http = require('http')
    const req = http.get({ host: '127.0.0.1', port: Number(config.port || process.env.PORT || 4000), path: route, timeout: ms }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', c => { text += c; if (text.length > 65536) req.destroy(new Error('too large')) })
      res.on('end', () => { if (res.statusCode !== 200) return reject(new Error(`http ${res.statusCode}`)); try { resolve(JSON.parse(text)) } catch (e) { reject(e) } })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

module.exports = { createSources, READERS, TIER_RANK, safeWords, heldEntry, DBD_COMS, HELD_FILE, HELD }
