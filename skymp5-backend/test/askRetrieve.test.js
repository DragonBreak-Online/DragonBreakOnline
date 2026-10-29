'use strict'
// Retrieval for /dragonbaron ask (sources/ai/retrieve.js) on the real data/rules files

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const retrieve = require('../sources/ai/retrieve')

const DIR = path.join(__dirname, '..', 'data', 'rules')
const chunks = retrieve.loadDocs(DIR)
const ids = chunks.map(c => c.id)

test('the rule chunks staff ask about exist, with unique ids, a version and at most 2000 characters each', () => {
  for (const id of ['rules:D3', 'rules:D6', 'rules:D10', 'rules:rule 1', 'rules:rule 2', 'rules:5.3', 'rules:10.2', 'staff:2.6', 'staff:5.2']) assert.ok(ids.includes(id), id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(chunks.every(c => c.text.length <= 2000 && c.text.trim()))
  assert.ok(chunks.every(c => c.version === '2026-10-21'))
  const d3 = chunks.find(c => c.id === 'rules:D3')
  assert.match(d3.text, /^- \*\*D3\. Keep IC and OOC separate\.\*\*/)
  assert.equal(d3.label, 'Server Rules 2026-10-21, D3')
  assert.ok(!d3.text.includes('D4.'), 'each Discord rule is its own chunk')
  assert.match(chunks.find(c => c.id === 'rules:rule 2').text, /No Metagaming/)
  assert.match(chunks.find(c => c.id === 'staff:2.6').text, /election vote/)
})

test('exactRefs pins the chunks a question names; "handbook" selects the staff document', () => {
  assert.deepEqual(retrieve.exactRefs('what does D3 say', chunks).map(c => c.id), ['rules:D3'])
  assert.deepEqual(retrieve.exactRefs('rule 2 and 10.2?', chunks).map(c => c.id), ['rules:rule 2', 'rules:10.2'])
  assert.deepEqual(retrieve.exactRefs('what does the handbook say in 5.3', chunks).map(c => c.id), ['staff:5.3'])
  assert.deepEqual(retrieve.exactRefs('what is 5.3', chunks).map(c => c.id), ['rules:5.3', 'staff:5.3'])
  assert.deepEqual(retrieve.exactRefs('client 0.3.109', chunks), [])
})

test('BM25: metagaming discord puts rule 2 in the top 2; nonsense finds nothing', () => {
  const top = retrieve.bm25('metagaming discord', chunks, 4).map(h => h.chunk.id)
  assert.ok(top.slice(0, 2).includes('rules:rule 2'), top.join(', '))
  assert.equal(retrieve.bm25('who can restart the server', chunks, 1)[0].chunk.id, 'staff:2.8')
  assert.deepEqual(retrieve.bm25('qwzx plorb', chunks, 4), [])
})

test('chunkMarkdown labels rules, Discord rules, numbered paragraphs and handbook sections, and splits long text on sentences', () => {
  const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
  const md = `# Title\n\n## 2. Section\n\n2.1. First.\n\n**3. Rule three.** Text.\n\nMore of rule three.\n\n- **D1. One.** a\n- **D2. Two.** b\n\n### 4.5 Handbook part\n\n${long}`
  const c = retrieve.chunkMarkdown(md, 'rules', 'v1')
  assert.deepEqual(c.map(x => x.id), ['rules:2.1', 'rules:rule 3', 'rules:D1', 'rules:D2', 'rules:4.5', 'rules:4.5#2'])
  assert.match(c[1].text, /More of rule three/)
  assert.ok(c[4].text.endsWith('.') && c[4].text.length <= 2000)
})

test('"staff" alone does not hide the Server Rules; a D-rule or "rule N" comes from the Server Rules even in a handbook question; numbered sections never cross documents', () => {
  assert.deepEqual(retrieve.docsFor('what does D10 say about staff actions'), ['rules', 'staff'])
  assert.deepEqual(retrieve.docsFor('per the staff handbook, who may ban'), ['staff'])
  assert.deepEqual(retrieve.exactRefs('can staff vote under 11.4?', chunks).map(c => c.id), ['rules:11.4'])
  assert.deepEqual(retrieve.exactRefs('does the handbook repeat D10?', chunks).map(c => c.id), ['rules:D10'])
  assert.deepEqual(retrieve.exactRefs('what does the handbook say in 11.4', chunks), [])
  assert.deepEqual(retrieve.exactRefs('what does the handbook say in 5.3', chunks).map(c => c.id), ['staff:5.3'])
})

// Known gap (eval a20 and x10): section 3's many "ban evasion" mentions outrank the rank table, which is 5th of a 4-card cut
test('a "who can ban" handbook question retrieves the rank table or the ban sections', { todo: 'retrieval ranks staff:1 5th; the answer comes from section 3 instead' }, async () => {
  const { createSources } = require('../sources/ai/askSources')
  const sources = createSources({ config: {} })
  for (const q of ['Which staff rank can ban players, per the handbook?', 'Who is allowed to ban a player under the staff handbook?']) {
    const cards = await sources.read('rules', { q, docs: retrieve.docsFor(q) }, { tier: 'owner' }, {})
    assert.ok(cards.some(c => ['staff:1', 'staff:5.2', 'staff:4.4'].includes(c.key)), `${q}: ${cards.map(c => c.key)}`)
  }
})
