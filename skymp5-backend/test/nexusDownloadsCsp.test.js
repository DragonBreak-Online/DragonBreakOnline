'use strict'
// V1 (website origin check, 22 Oct): /api/nexus-downloads runs only its own pinned style and script, and works as before

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const vm = require('vm')
const { loadWithDataIn } = require('./helpers/dataDir')

// The reviewed set: a change to the page's script or style changes these and needs a new review
const SCRIPT_HASH = "'sha256-0mAMeEhyms8Mf/P8ljcj968tos/2RqumqzwdnPjGEzg='"
const STYLE_HASH  = "'sha256-1/0Zo+I8/NYyxFo0BJBORDDtzeEo7eWNVOXnDlety/Q='"
const CSP = `default-src 'none'; script-src ${SCRIPT_HASH}; style-src ${STYLE_HASH}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-downloads-'))
const manifestFile = path.join(tmp, 'install-manifest.json')
const route = loadWithDataIn(tmp, ['install-manifest.json'], () => require('../routes/nexus-downloads'))
const writeManifest = archives => fs.writeFileSync(manifestFile, JSON.stringify({ archives }))
const MODS = [
  { name: 'Engine <b>&"\'', source: { type: 'nexus', modId: 1, fileId: 11 } },
  { name: 'Any file', source: { type: 'nexus', modId: 2 } },
  { name: 'Any file again', source: { type: 'nexus', modId: 2 } },
  { name: 'Not Nexus', source: { type: 'url' } },
  ...Array.from({ length: 7 }, (_, i) => ({ name: `Mod ${i}`, source: { type: 'nexus', modId: 100 + i, fileId: 200 + i } })),
]

let server, base
before(async () => {
  const express = require('express')
  const app = express()
  app.use('/api/nexus-downloads', route)
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(tmp, { recursive: true, force: true })
})

const get = url => new Promise((resolve, reject) => {
  http.get(`${base}${url}`, { agent: false }, res => {
    let text = ''
    res.setEncoding('utf8')
    res.on('data', c => { text += c })
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
  }).on('error', reject)
})
const sha = text => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`
const bodies = (html, tag) => [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1])

// Runs the page's script in a fake browser: the batch button, the links and window.open
function batchPage(html, { blockAfter = Infinity } = {}) {
  const [script] = bodies(html, 'script')
  const links = [...html.matchAll(/<li><a href="([^"]+)"/g)].map(m => ({ href: m[1].replace(/&amp;/g, '&') }))
  const button = { textContent: '', disabled: false, listeners: [], addEventListener(type, fn) { this.listeners.push([type, fn]) } }
  const opened = []
  const window = { open: (url, target) => { if (opened.length >= blockAfter) return null; const win = { opener: 'page', url, target }; opened.push(win); return win } }
  const document = { getElementById: id => (id === 'open-batch' && /id="open-batch"/.test(html) ? button : null), querySelectorAll: sel => (sel === 'ol a' ? links : []) }
  vm.runInNewContext(script, { window, document, Math })
  return { button, links, opened, click: () => button.listeners.filter(([t]) => t === 'click').forEach(([, fn]) => fn()) }
}

test('V1: the downloads page sends a hash-pinned CSP that matches the one script and the one style it serves', async () => {
  writeManifest(MODS)
  const page = await get('/api/nexus-downloads')
  assert.equal(page.status, 200)
  assert.match(page.headers['content-type'], /^text\/html/)
  assert.equal(page.headers['content-security-policy'], CSP)
  const scripts = bodies(page.text, 'script'), styles = bodies(page.text, 'style')
  assert.equal(scripts.length, 1, 'one inline script')
  assert.equal(styles.length, 1, 'one inline style')
  assert.equal(sha(scripts[0]), SCRIPT_HASH, 'the served script is the pinned one')
  assert.equal(sha(styles[0]), STYLE_HASH, 'the served style is the pinned one')
  assert.equal((page.text.match(/<script/g) || []).length, 1, 'no other script element')
  assert.doesNotMatch(page.text, /<script[^>]*\ssrc=|\son[a-z]+=|\sstyle=|javascript:|<link|<img|<iframe|<form/i, 'nothing the CSP would block')
})

test('V1: every answer of the downloads route carries the same CSP: a narrowed list, an empty one and a missing manifest', async () => {
  writeManifest(MODS)
  for (const url of ['/api/nexus-downloads?need=1-11,%202-any%20,999-1', '/api/nexus-downloads?need=999-1']) {
    const r = await get(url)
    assert.equal(r.status, 200)
    assert.equal(r.headers['content-security-policy'], CSP, url)
    assert.equal(sha(bodies(r.text, 'script')[0]), SCRIPT_HASH, url)
  }
  writeManifest([])
  assert.equal((await get('/api/nexus-downloads')).headers['content-security-policy'], CSP)
  fs.rmSync(manifestFile)
  const missing = await get('/api/nexus-downloads')
  assert.equal(missing.status, 404)
  assert.equal(missing.headers['content-security-policy'], CSP)
  assert.doesNotMatch(missing.text, /<script/)
  assert.equal(sha(bodies(missing.text, 'style')[0]), STYLE_HASH)
})

test('V1: the downloads page lists and opens the same links as before: one per Nexus file, escaped, five per click', async () => {
  writeManifest(MODS)
  const page = await get('/api/nexus-downloads')
  assert.match(page.text, /<li><a href="https:\/\/www\.nexusmods\.com\/skyrimspecialedition\/mods\/1\?tab=files&file_id=11&nmm=1" target="_blank" rel="noopener">Engine &lt;b&gt;&amp;&quot;&#39;<\/a><\/li>/)
  assert.match(page.text, /mods\/2\?tab=files&nmm=1"/)
  assert.equal((page.text.match(/<li>/g) || []).length, 9, 'duplicates and non-Nexus archives are left out')
  assert.match(page.text, /<button class="open-all" id="open-batch">Open the first 5 links<\/button>/)
  const p = batchPage(page.text)
  p.click()
  assert.equal(p.opened.length, 5)
  assert.ok(p.opened.every(w => w.opener === null && w.target === '_blank'), 'each tab loses its opener')
  assert.equal(p.opened[0].url, 'https://www.nexusmods.com/skyrimspecialedition/mods/1?tab=files&file_id=11&nmm=1')
  assert.equal(p.button.textContent, 'Open the next 4 links (5 of 9 opened)')
  p.click()
  assert.equal(p.opened.length, 9)
  assert.equal(p.button.disabled, true)
  assert.equal(p.button.textContent, 'All 9 links opened')
  const blocked = batchPage(page.text, { blockAfter: 2 })
  blocked.click()
  assert.equal(blocked.button.textContent, 'Pop-ups blocked - allow them for this site, then click again (2 of 9 opened)')

  const narrowed = await get('/api/nexus-downloads?need=1-11,%202-any%20,999-1')
  assert.equal((narrowed.text.match(/<li>/g) || []).length, 2)
  assert.match(narrowed.text, /<p>7 mods you already downloaded are hidden\.<\/p>/)
  const none = await get('/api/nexus-downloads?need=999-1')
  assert.match(none.text, /Every mod is already downloaded/)
  assert.doesNotMatch(none.text, /id="open-batch"/)
})
