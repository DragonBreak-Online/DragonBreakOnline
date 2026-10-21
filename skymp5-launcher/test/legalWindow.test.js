'use strict'
// The Terms and Privacy window (src/renderer/legal.js) in a small fake DOM: read both, tick, accept; decline; retry; re-prompt
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { parseMarkdown } = require('../src/legalMarkdown')

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'legal.js'), 'utf8')
const IDS = ['modal-legal', 'legal-body', 'legal-doc-terms', 'legal-doc-privacy', 'legal-read-terms', 'legal-read-privacy', 'legal-agree',
  'legal-accept', 'legal-retry', 'legal-hint', 'legal-source', 'legal-footer', 'legal-changes', 'legal-changes-list', 'legal-decline',
  'legal-close', 'btn-legal', 'legal-changes-title', 'legal-changes-toggle']

class El {
  constructor(tag) {
    Object.assign(this, { tagName: tag, children: [], listeners: {}, hidden: false, disabled: false, checked: false, dataset: {}, className: '', own: '' })
    Object.assign(this, { scrollTop: 0, clientHeight: 100, scrollHeight: 100 })
    const set = new Set()
    this.classList = { toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: c => set.has(c) }
  }
  appendChild(c) { this.children.push(c); return c }
  get textContent() { return this.own + this.children.map(c => c.textContent).join('') }
  set textContent(v) { this.own = String(v); this.children = [] }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn) }
  fire(type, extra = {}) { for (const fn of this.listeners[type] || []) fn({ target: this, key: extra.key, preventDefault() {} }) }
  focus() {}
  createTHead() { return this.appendChild(new El('thead')) }
  createTBody() { return this.appendChild(new El('tbody')) }
  find(pred) { return pred(this) ? this : this.children.map(c => (c.find ? c.find(pred) : null)).find(Boolean) || null }
}

const DOC = (version, extra = {}) => ({
  source: 'server', version, effective: '2026-10-01', changes: ['Voice chat is now recorded for moderation.'],
  terms: parseMarkdown('# Terms of Service\n\nSee [the rules](https://dragonbreakonline.com/guides/rules.html) or [mail us](mailto:a@b.co).\n\n<img src=x onerror=alert(1)>'),
  privacy: parseMarkdown('# Privacy Policy\n\n| A | B |\n|---|--:|\n| 1 | 2 |'),
  ...extra,
})

function load({ status, doc = DOC('v2'), accept = [{ ok: true }], innerHeight = 800 }) {
  const els = Object.fromEntries(IDS.map(id => [id, new El('div')]))
  els['modal-legal'].hidden = true
  els['legal-footer'].hidden = true
  const tabs = ['terms', 'privacy'].map(k => Object.assign(new El('button'), { dataset: { legalTab: k } }))
  const docListeners = {}
  const calls = { accept: [], external: [], status: 0, load: 0 }
  const answers = { status: [].concat(status), accept: [].concat(accept), doc: [].concat(doc) }
  const next = (list) => (list.length > 1 ? list.shift() : list[0])
  const window = {
    electronAPI: {
      legalStatus: async () => { calls.status++; return next(answers.status) },
      legalLoad: async () => { calls.load++; return next(answers.doc) },
      legalAccept: async (v) => { calls.accept.push(v); return next(answers.accept) },
      openExternal: url => calls.external.push(url),
    },
    addEventListener: () => {},
    innerHeight,
  }
  const document = {
    getElementById: id => els[id],
    querySelectorAll: sel => (sel === '[data-legal-tab]' ? tabs : []),
    createElement: tag => new El(tag),
    createTextNode: v => ({ textContent: String(v) }),
    addEventListener: (type, fn) => { docListeners[type] = fn },
  }
  vm.runInNewContext(SRC, { window, document })
  const changes = []
  window.dboLegal.init({ onChange: e => changes.push(e || null) })
  const body = els['legal-body']
  // A long document: the bottom is reached only by scrolling
  const scrollToEnd = () => { body.scrollHeight = 1000; body.scrollTop = 900; body.fire('scroll') }
  const settle = () => new Promise(r => setImmediate(r))
  return { legal: window.dboLegal, win: window, els, tabs, calls, changes, body, scrollToEnd, settle, escape: () => docListeners.keydown({ key: 'Escape' }) }
}

const REQUIRED = { state: 'required', version: 'v2', lastAcceptedVersion: null, required: false }

test('a first prompt opens by itself; Accept waits for both documents read to the end and the box ticked', async () => {
  const w = load({ status: REQUIRED })
  w.body.scrollHeight = 1000
  await w.legal.check()
  await w.settle()
  assert.strictEqual(w.els['modal-legal'].hidden, false)
  assert.strictEqual(w.els['legal-footer'].hidden, false)
  assert.strictEqual(w.els['legal-changes'].hidden, true, 'no "what changed" on a first prompt')
  assert.strictEqual(w.legal.blocking(), true)
  assert.strictEqual(w.els['legal-accept'].disabled, true)
  assert.match(w.els['legal-hint'].textContent, /Read the Terms of Service and the Privacy Policy to the end/)

  w.scrollToEnd()
  w.els['legal-agree'].checked = true
  w.els['legal-agree'].fire('change')
  assert.strictEqual(w.els['legal-accept'].disabled, true, 'the Privacy Policy is still unread')
  assert.match(w.els['legal-hint'].textContent, /Read the Privacy Policy/)
  assert.strictEqual(w.els['legal-read-terms'].textContent, ' ✓')

  w.tabs[1].fire('click')
  assert.strictEqual(w.els['legal-doc-privacy'].hidden, false)
  assert.strictEqual(w.els['legal-doc-terms'].hidden, true)
  assert.strictEqual(w.body.scrollTop, 0)
  w.scrollToEnd()
  assert.strictEqual(w.els['legal-accept'].disabled, false)

  w.els['legal-accept'].fire('click')
  await w.settle()
  assert.deepStrictEqual(w.calls.accept, ['v2'])
  assert.strictEqual(w.els['modal-legal'].hidden, true)
  assert.strictEqual(w.legal.blocking(), false)
})

test('ticking the box first is not enough, and unticking takes Accept away again', async () => {
  const w = load({ status: REQUIRED })
  w.body.scrollHeight = 1000
  await w.legal.check()
  await w.settle()
  w.els['legal-agree'].checked = true
  w.els['legal-agree'].fire('change')
  assert.strictEqual(w.els['legal-accept'].disabled, true)
  w.scrollToEnd(); w.tabs[1].fire('click'); w.scrollToEnd()
  assert.strictEqual(w.els['legal-accept'].disabled, false)
  w.els['legal-agree'].checked = false
  w.els['legal-agree'].fire('change')
  assert.strictEqual(w.els['legal-accept'].disabled, true)
  assert.match(w.els['legal-hint'].textContent, /Tick the box/)
})

test('Decline, the close button and Escape leave Play off with a line saying why; the footer link reopens it', async () => {
  for (const how of ['legal-decline', 'legal-close', 'escape']) {
    const w = load({ status: REQUIRED })
    await w.legal.check()
    await w.settle()
    if (how === 'escape') w.escape()
    else w.els[how].fire('click')
    assert.strictEqual(w.els['modal-legal'].hidden, true, how)
    assert.strictEqual(w.legal.blocking(), true)
    assert.match(w.legal.message(), /You declined .* Press Terms & Privacy below/)
    assert.ok(w.legal.messages().includes(w.legal.message()))
    // A later check does not push the window back up; the link does
    await w.legal.check()
    await w.settle()
    assert.strictEqual(w.els['modal-legal'].hidden, true)
    w.els['btn-legal'].fire('click')
    await w.settle()
    assert.strictEqual(w.els['modal-legal'].hidden, false)
    assert.strictEqual(w.els['legal-footer'].hidden, false)
  }
})

test('a failed accept keeps the window, says so and offers Retry, which then succeeds', async () => {
  const w = load({ status: REQUIRED, accept: [{ ok: false, error: 'Request timed out' }, { ok: true }] })
  await w.legal.check()
  await w.settle()
  w.els['legal-agree'].checked = true
  w.els['legal-agree'].fire('change')
  w.scrollToEnd(); w.tabs[1].fire('click'); w.scrollToEnd()
  w.els['legal-accept'].fire('click')
  await w.settle()
  assert.strictEqual(w.els['modal-legal'].hidden, false)
  assert.strictEqual(w.legal.blocking(), true)
  assert.match(w.els['legal-hint'].textContent, /could not be sent \(Request timed out\).*Retry/)
  assert.strictEqual(w.els['legal-accept'].textContent, 'Retry')
  assert.strictEqual(w.els['legal-accept'].disabled, false)
  w.els['legal-accept'].fire('click')
  await w.settle()
  assert.deepStrictEqual(w.calls.accept, ['v2', 'v2'])
  assert.strictEqual(w.els['modal-legal'].hidden, true)
})

test('a re-prompt shows what changed at the top', async () => {
  const w = load({ status: { ...REQUIRED, lastAcceptedVersion: 'v1' } })
  await w.legal.check()
  await w.settle()
  assert.strictEqual(w.els['legal-changes'].hidden, false)
  assert.strictEqual(w.els['legal-changes-list'].textContent, 'Voice chat is now recorded for moderation.')
})

test('the bundled copy of an older version can be read but not accepted; Retry loads the current one', async () => {
  const w = load({ status: REQUIRED, doc: [DOC('v1', { source: 'bundled', error: 'offline' }), DOC('v2')] })
  await w.legal.check()
  await w.settle()
  assert.strictEqual(w.els['legal-source'].hidden, false)
  assert.match(w.els['legal-source'].textContent, /copy that came with the launcher/)
  assert.strictEqual(w.els['legal-retry'].hidden, false)
  w.els['legal-agree'].checked = true
  w.els['legal-agree'].fire('change')
  w.scrollToEnd(); w.tabs[1].fire('click'); w.scrollToEnd()
  assert.strictEqual(w.els['legal-accept'].disabled, true)
  assert.match(w.els['legal-hint'].textContent, /current version could not be loaded/)
  w.els['legal-retry'].fire('click')
  await w.settle()
  assert.strictEqual(w.els['legal-retry'].hidden, true)
  assert.strictEqual(w.els['legal-source'].hidden, true)
})

test('accepted, signed out or unchecked: the link opens the texts to read, with no Accept, and a click outside closes them', async () => {
  for (const state of ['accepted', 'signedOut', 'notDeployed', 'error']) {
    const w = load({ status: { state, version: 'v2' } })
    await w.legal.check()
    await w.settle()
    assert.strictEqual(w.els['modal-legal'].hidden, true, state)
    assert.strictEqual(w.legal.blocking(), false, state)
    w.els['btn-legal'].fire('click')
    await w.settle()
    assert.strictEqual(w.els['modal-legal'].hidden, false)
    assert.strictEqual(w.els['legal-footer'].hidden, true)
    w.els['modal-legal'].fire('click')
    assert.strictEqual(w.els['modal-legal'].hidden, true)
  }
})

test('document text is built as text nodes, web links open in the browser and mail links stay text', async () => {
  const w = load({ status: { state: 'accepted', version: 'v2' } })
  w.els['btn-legal'].fire('click')
  await w.settle()
  const terms = w.els['legal-doc-terms']
  assert.match(terms.textContent, /<img src=x onerror=alert\(1\)>/)
  assert.strictEqual(terms.find(e => e.tagName === 'img'), null)
  const a = terms.find(e => e.tagName === 'a')
  assert.strictEqual(a.textContent, 'the rules')
  a.fire('click')
  assert.deepStrictEqual(w.calls.external, ['https://dragonbreakonline.com/guides/rules.html'])
  assert.strictEqual(terms.find(e => e.className === 'legal-plain-link').textContent, 'mail us')
  const cell = w.els['legal-doc-privacy'].find(e => e.tagName === 'th' && e.className === 'al-r')
  assert.strictEqual(cell.textContent, 'B')
})

test('an expired login during the check or the accept is passed on, and signing out closes a pending window', async () => {
  const w = load({ status: [REQUIRED, { state: 'signedOut', sessionExpired: true }], accept: { ok: false, sessionExpired: true } })
  await w.legal.check()
  await w.settle()
  w.legal.reset()
  assert.strictEqual(w.els['modal-legal'].hidden, true)
  assert.strictEqual(w.legal.blocking(), false)
  await w.legal.check()
  // The object comes from the window's own realm, so its field is compared, not its prototype
  assert.strictEqual(w.changes[w.changes.length - 1].sessionExpired, true)
})

// ---- What changed: a folding list, so the documents keep the room ----
const REPROMPT = { ...REQUIRED, lastAcceptedVersion: 'v1' }
const NINE = Array.from({ length: 9 }, (_, i) => `Change ${i + 1}, at the length of a real one, so that it wraps onto a second line in a narrow window.`)

test('a re-prompt in a tall window lists what changed under a title with the version and count; the toggle folds and opens it', async () => {
  const w = load({ status: REPROMPT, doc: DOC('v2', { changes: NINE }), innerHeight: 800 })
  await w.legal.check()
  await w.settle()
  const list = w.els['legal-changes-list']
  const toggle = w.els['legal-changes-toggle']
  assert.strictEqual(w.els['legal-changes'].hidden, false)
  assert.strictEqual(w.els['legal-changes-title'].textContent, 'What changed in version v2 (9 changes)')
  assert.strictEqual(list.children.length, 9)
  assert.strictEqual(list.hidden, false)
  assert.strictEqual(toggle.textContent, 'Hide changes')
  assert.strictEqual(toggle.ariaExpanded, 'true')
  toggle.fire('click')
  assert.strictEqual(list.hidden, true)
  assert.strictEqual(list.children.length, 9, 'folding hides the list and keeps it')
  assert.strictEqual(toggle.textContent, 'Show all changes')
  assert.strictEqual(toggle.ariaExpanded, 'false')
  toggle.fire('click')
  assert.strictEqual(list.hidden, false)
  assert.strictEqual(toggle.textContent, 'Hide changes')
})

test('in a window under 700 px tall a re-prompt opens with the list folded, and every opening decides again', async () => {
  const w = load({ status: REPROMPT, innerHeight: 699 })
  await w.legal.check()
  await w.settle()
  const list = w.els['legal-changes-list']
  assert.strictEqual(w.els['legal-changes'].hidden, false, 'the title still says that something changed')
  assert.strictEqual(w.els['legal-changes-title'].textContent, 'What changed in version v2 (1 change)')
  assert.strictEqual(list.hidden, true)
  assert.strictEqual(w.els['legal-changes-toggle'].textContent, 'Show all changes')
  w.els['legal-decline'].fire('click')
  w.win.innerHeight = 700
  w.els['btn-legal'].fire('click')
  await w.settle()
  assert.strictEqual(list.hidden, false)
  assert.strictEqual(w.els['legal-changes-toggle'].textContent, 'Hide changes')
})

test('folding the list checks the reading again: a document whose end comes into view counts as read', async () => {
  const w = load({ status: REPROMPT })
  w.body.scrollHeight = 1000
  await w.legal.check()
  await w.settle()
  assert.strictEqual(w.els['legal-read-terms'].textContent, '')
  // The fake DOM has no layout: the room the folded list gives the document is set by hand
  w.body.clientHeight = 1000
  w.els['legal-changes-toggle'].fire('click')
  assert.strictEqual(w.els['legal-read-terms'].textContent, ' ✓')
  assert.strictEqual(w.els['legal-read-privacy'].textContent, '', 'only the document on screen')
})

test('folding and opening the list never lets Accept through before both documents are read and the box is ticked', async () => {
  const w = load({ status: REPROMPT })
  w.body.scrollHeight = 1000
  await w.legal.check()
  await w.settle()
  const toggle = w.els['legal-changes-toggle']
  w.els['legal-agree'].checked = true
  w.els['legal-agree'].fire('change')
  for (let i = 0; i < 3; i++) { toggle.fire('click'); assert.strictEqual(w.els['legal-accept'].disabled, true) }
  w.scrollToEnd()
  w.tabs[1].fire('click')
  toggle.fire('click')
  assert.strictEqual(w.els['legal-accept'].disabled, true, 'the Privacy Policy is still unread')
  assert.match(w.els['legal-hint'].textContent, /Read the Privacy Policy/)
  w.scrollToEnd()
  assert.strictEqual(w.els['legal-accept'].disabled, false)
  w.els['legal-agree'].checked = false
  w.els['legal-agree'].fire('change')
  toggle.fire('click')
  assert.strictEqual(w.els['legal-accept'].disabled, true, 'unticked')
  w.els['legal-agree'].checked = true
  w.els['legal-agree'].fire('change')
  w.els['legal-accept'].fire('click')
  await w.settle()
  assert.deepStrictEqual(w.calls.accept, ['v2'])
})

// ---- The window's layout (styles.css, index.html) ----
const CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8')
const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8')
// A top-level rule's body; rules inside @media are indented and do not match
const rule = sel => {
  const m = CSS.match(new RegExp(`(?:^|\\n)${sel.replace(/[.[\]()-]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
  assert.ok(m, `styles.css has a top-level rule for ${sel}`)
  return m[1]
}
const capOf = body => {
  const m = body.match(/max-height:\s*clamp\((\d+)px,\s*(\d+)vh,\s*(\d+)px\)/)
  assert.ok(m, 'the change list height is a clamp of px, vh and px')
  return h => Math.max(Number(m[1]), Math.min(Number(m[3]), (Number(m[2]) * h) / 100))
}

test('the documents get the window: a capped change list with its own scroll, a growing document area, an accept row that stays', () => {
  assert.match(rule('.modal-box--legal'), /height:\s*min\(\d+px,\s*calc\(100vh - \d+px\)\)/, 'the box fills the window height, less a margin')
  assert.match(rule('.modal-box--legal'), /width:\s*min\(\d+px,\s*calc\(100vw - \d+px\)\)/)
  const list = rule('.legal-changes-list')
  assert.match(list, /overflow-y:\s*auto/, 'a long list scrolls inside its own block')
  assert.match(rule('.legal-body'), /flex:\s*1 1 auto/)
  assert.match(rule('.legal-body'), /min-height:\s*\d/)
  assert.match(rule('.legal-changes'), /flex-shrink:\s*0/)
  assert.match(rule('.legal-footer'), /flex-shrink:\s*0/, 'the 18+ box and Accept never scroll away')
  assert.match(rule('.legal-changes[hidden]'), /display:\s*none/)
  assert.match(rule('.legal-changes-list[hidden]'), /display:\s*none/)

  // The list never takes more than 30% of the window at the sizes Jake checks, the minimum included
  const tall = capOf(list)
  const short = capOf(CSS.match(/@media \(max-height: 640px\) \{\s*\.legal-changes-list \{([^}]*)\}/)[1])
  for (const h of [1080, 800, 720, 700, 640]) assert.ok(tall(h) <= 0.3 * h, `${h} px: ${tall(h)}`)
  for (const h of [639, 600, 540]) assert.ok(short(h) <= 0.3 * h, `${h} px: ${short(h)}`)
})

test('the window keeps its order (what changed, tabs, documents, accept row), the toggle, and the 18+ wording', () => {
  const box = HTML.slice(HTML.indexOf('id="modal-legal"'), HTML.indexOf('<script src="legal.js">'))
  const at = s => { const i = box.indexOf(s); assert.ok(i >= 0, s); return i }
  assert.ok(at('id="legal-changes"') < at('data-legal-tab="terms"'))
  assert.ok(at('data-legal-tab="privacy"') < at('id="legal-body"'))
  assert.ok(at('id="legal-body"') < at('id="legal-footer"'))
  assert.match(box, /<button type="button" class="legal-changes-toggle" id="legal-changes-toggle" aria-controls="legal-changes-list"/)
  assert.match(box, /<span>I am 18 or older, and I have read and accept the Terms of Service and the Privacy Policy<\/span>/)
  assert.match(box, /<button type="button" class="btn-save" id="legal-accept" disabled>Accept<\/button>/)
})
