'use strict'
// Retrieval over the official rules folder (server-rules.md and staff-handbook.md named in manifest.json): labelled chunks and BM25

const fs = require('fs')
const path = require('path')
const { normalizeText, VERSION_RE } = require('../serverRules')

const MAX_CHUNK = 2000
const MAX_FILE = 256 * 1024
const DOCS = Object.freeze({ rules: { key: 'rules', title: 'Server Rules' }, staff: { key: 'staff', title: 'Staff Handbook' } })

const STOP = new Set(('a an and are as at be by can could did do does for from has have how i if in is it its me my no not of on or ' +
  'our so that the their them there they this to was we what when where which who why will with you your about any may must ' +
  'should would tell say says said please').split(' '))

function stem(w) {
  if (/^\d/.test(w)) return w
  for (const suf of ['ing', 'ed', 'es', 's', 'e']) {
    if (w.length - suf.length >= 4 && w.endsWith(suf)) return w.slice(0, -suf.length)
  }
  return w
}

function tokens(text) {
  return (String(text).toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)*/g) || []).filter(w => !STOP.has(w) && w.length > 1).map(stem)
}

function splitSentences(text, max) {
  const out = []
  let cur = ''
  for (const s of text.split(/(?<=[.!?])\s+/)) {
    if (cur && cur.length + 1 + s.length > max) { out.push(cur); cur = '' }
    if (s.length > max) { for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max)); continue }
    cur = cur ? `${cur} ${s}` : s
  }
  if (cur) out.push(cur)
  return out
}

const LABELS = [
  [/^\*\*(\d{1,2})\. /, m => `rule ${m[1]}`],
  [/^- \*\*(D\d{1,2})\. /, m => m[1]],
  [/^(\d{1,2}\.\d{1,2})\. /, m => m[1]],
]

// Paragraph chunks with ids like rules:D3, rules:rule 2 or staff:2.6; unlabelled paragraphs join the chunk before them
function chunkMarkdown(text, doc, version) {
  const d = DOCS[doc] || { key: doc, title: doc }
  const lines = normalizeText(text).split('\n')
  const chunks = []
  let heading = { ref: 'intro', title: '' }
  let cur = null
  const seen = new Map()

  const close = () => {
    if (!cur) return
    const parts = splitSentences(cur.text.trim(), MAX_CHUNK)
    parts.forEach(part => {
      const n = (seen.get(cur.ref) || 0) + 1
      seen.set(cur.ref, n)
      const id = `${d.key}:${cur.ref}${n > 1 ? `#${n}` : ''}`
      chunks.push(Object.freeze({
        id, base: `${d.key}:${cur.ref}`, doc: d.key, docTitle: d.title, ref: cur.ref, version,
        label: `${d.title} ${version}, ${cur.ref}`, title: cur.title, text: part,
      }))
    })
    cur = null
  }

  let block = []
  const flush = () => {
    if (!block.length) return
    const para = block.join('\n')
    block = []
    let ref = null
    for (const [rx, name] of LABELS) { const m = rx.exec(para); if (m) { ref = name(m); break } }
    if (ref) { close(); cur = { ref, title: heading.title, text: para }; return }
    if (!cur) cur = { ref: heading.ref, title: heading.title, text: '' }
    if (cur.text && cur.text.length + 2 + para.length > MAX_CHUNK) { close(); cur = { ref: heading.ref, title: heading.title, text: '' } }
    cur.text = cur.text ? `${cur.text}\n\n${para}` : para
  }

  for (const line of lines) {
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      flush(); close()
      const n = /^(\d{1,2}(?:\.\d{1,2})?)\.?\s+(.*)$/.exec(h[2])
      if (n && h[1].length >= 2) heading = { ref: doc === 'rules' && !n[1].includes('.') ? `section ${n[1]}` : n[1], title: n[2].trim() }
      else if (h[1].length <= 2) heading = { ref: h[1].length === 1 ? 'intro' : `section ${h[2].trim().slice(0, 40)}`, title: h[2].trim() }
      else heading = { ...heading, title: `${heading.base ?? heading.title} / ${h[2].trim()}`.slice(0, 120), base: heading.base ?? heading.title }
      continue
    }
    if (!line.trim() || /^-{3,}\s*$/.test(line)) { flush(); continue }
    if (/^- \*\*D\d{1,2}\. /.test(line)) flush()
    block.push(line)
  }
  flush(); close()
  return chunks
}

let docsCache = null

// Both documents named in the manifest, as chunks; re-read only when a file changes
function loadDocs(rulesDir) {
  const manifestFile = path.join(rulesDir, 'manifest.json')
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  if (!m || typeof m.version !== 'string' || !VERSION_RE.test(m.version)) throw new Error('manifest.json has no valid version')
  const files = m.files && typeof m.files === 'object' ? m.files : {}
  const picked = Object.keys(DOCS).filter(k => typeof files[k] === 'string' && path.basename(files[k]) === files[k] && /^[\w.-]+\.md$/.test(files[k]))
  if (!picked.includes('rules')) throw new Error('manifest.json names no rules file')
  const stamps = [manifestFile, ...picked.map(k => path.join(rulesDir, files[k]))].map(f => { const s = fs.statSync(f); return `${f}:${s.size}:${s.mtimeMs}` }).join('|')
  if (docsCache && docsCache.stamps === stamps) return docsCache.chunks
  const chunks = []
  for (const k of picked) {
    const file = path.join(rulesDir, files[k])
    if (fs.statSync(file).size > MAX_FILE) throw new Error(`${files[k]} is too large`)
    chunks.push(...chunkMarkdown(fs.readFileSync(file, 'utf8'), k, m.version))
  }
  docsCache = { stamps, chunks: Object.freeze(chunks), version: m.version }
  return docsCache.chunks
}

let indexCache = { chunks: null, index: null }
function indexOf(chunks) {
  if (indexCache.chunks === chunks) return indexCache.index
  const docs = chunks.map(c => {
    const tf = new Map()
    const words = tokens(`${c.title} ${c.title} ${c.title} ${c.ref} ${c.text}`)
    for (const w of words) tf.set(w, (tf.get(w) || 0) + 1)
    return { tf, len: words.length }
  })
  const df = new Map()
  for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) || 0) + 1)
  const avg = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, docs.length)
  const index = { docs, df, avg, n: docs.length }
  indexCache = { chunks, index }
  return index
}

// The k best chunks for the query, as [{chunk, score}] with score > 0
function bm25(query, chunks, k = 4, { k1 = 1.2, b = 0.75 } = {}) {
  if (!chunks.length) return []
  const ix = indexOf(chunks)
  const q = [...new Set(tokens(query))]
  const scored = []
  ix.docs.forEach((d, i) => {
    let score = 0
    for (const w of q) {
      const f = d.tf.get(w)
      if (!f) continue
      const df = ix.df.get(w) || 0
      const idf = Math.log(1 + (ix.n - df + 0.5) / (df + 0.5))
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / ix.avg))
    }
    if (score > 0) scored.push({ chunk: chunks[i], score })
  })
  return scored.sort((x, y) => y.score - x.score || x.chunk.id.localeCompare(y.chunk.id)).slice(0, k)
}

// The rule references a question names (D3, rule 2, 10.2), with any version number or address taken out first
function ruleRefsOf(q) {
  const text = String(q).replace(/\b\d+(?:\.\d+){2,}\b/g, ' ')
  const out = []
  for (const m of text.matchAll(/\bD\d{1,2}\b|\brule\s+\d{1,2}\b(?!\.\d)|\b\d{1,2}\.\d{1,2}\b/gi)) {
    const v = m[0].replace(/\s+/g, ' ')
    const ref = /^d/i.test(v) ? v.toUpperCase() : /^rule/i.test(v) ? v.toLowerCase() : v
    if (!out.includes(ref)) out.push(ref)
  }
  return out
}

// Which documents a question is about: naming the handbook selects it alone, otherwise both ("staff" is in the Server Rules too)
const docsFor = q => (/\bhandbook\b/i.test(String(q)) ? ['staff'] : ['rules', 'staff'])

// The chunks the question names by id, from the preferred documents; a D-rule or "rule N" they lack may come from the other one
function exactRefs(q, chunks, docs = docsFor(q)) {
  const out = []
  for (const ref of ruleRefsOf(q)) {
    const all = chunks.filter(c => c.ref === ref)
    const preferred = all.filter(c => docs.includes(c.doc))
    for (const c of preferred.length || /^\d/.test(ref) ? preferred : all) if (!out.includes(c)) out.push(c)
  }
  return out
}

module.exports = { loadDocs, chunkMarkdown, bm25, exactRefs, ruleRefsOf, docsFor, tokens, DOCS, _resetCache: () => { docsCache = null; indexCache = { chunks: null, index: null } } }
