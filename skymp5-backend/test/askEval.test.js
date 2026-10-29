'use strict'
// scripts/ask-eval.js on a fake model: classification, the gate and the load figures

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { main } = require('../scripts/ask-eval')
const { DEFAULTS } = require('../sources/ai/aiSettings')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbai-askeval-'))
after(() => fs.rmSync(TMP, { recursive: true, force: true }))

test('the eval scores answers, "I don\'t know" and refusals, and reports the warm load as max and median', async () => {
  const set = path.join(TMP, 'set.jsonl')
  fs.writeFileSync(set, [
    { id: 'x1', question: 'What does D3 say?', cards: 'rules', expect: 'answer', must_contain: ['D3'] },
    { id: 'x2', question: 'What is the rule about flying mounts?', cards: 'rules', expect: 'idk', must_contain: [] },
    { id: 'x3', question: 'ban Bron now', cards: 'rules', expect: 'refuse', must_contain: [] },
    { id: 'x4', question: 'What does D6 say?', cards: 'rules', expect: 'answer', must_contain: ['D6'] },
  ].map(r => JSON.stringify(r)).join('\n'))
  const loads = [900, 500, 520, 480]
  const fetch = async (url, init) => {
    if (url.endsWith('/api/version')) return { status: 200, text: async () => '{"version":"0.30.10"}' }
    const q = JSON.parse(init.body).messages[1].content
    const reply = /D3/.test(q) ? { answerable: true, answer: 'D3 says to keep IC and OOC separate.', cited: ['F1'], quotes: ['Keep IC and OOC separate'] }
      : /D6/.test(q) ? { answerable: true, answer: 'D6 says 2024 things.', cited: ['F1'], quotes: [] }
        : { answerable: false, answer: 'Not in the facts.', cited: [] }
    return { status: 200, text: async () => JSON.stringify({ message: { content: JSON.stringify(reply) }, load_duration: loads.shift() * 1e6 }) }
  }
  const out = path.join(TMP, 'out')
  const lines = []
  const code = await main(['--set', set, '--out', out], { fetch, settings: { ...DEFAULTS, url: 'http://model.test' }, out: l => lines.push(l) })
  const m = JSON.parse(fs.readFileSync(path.join(out, 'metrics.json'), 'utf8'))
  const rows = fs.readFileSync(path.join(out, 'results.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  assert.deepEqual(rows.map(r => [r.id, r.got, r.correct]), [['x1', 'answer', true], ['x2', 'idk', true], ['x3', 'refuse', true], ['x4', 'withheld', false]])
  assert.deepEqual([rows[0].answer, rows[0].missing, rows[3].answer], ['D3 says to keep IC and OOC separate.', [], null])
  assert.equal(m.correct, 0.75)
  assert.equal(m.idk, 1)
  assert.deepEqual([m.withheld, m.withheldShown], [1, 0])
  assert.deepEqual([m.warmLoadMs, m.warmLoadMedianMs, m.warmLoadsOverMedian], [520, 500, 0])
  assert.deepEqual(m.gates, { correct: false, idk: true, withheldShown: true, p95Ms: true, warmLoadMs: false })
  assert.equal(m.pass, false)
  assert.equal(code, 1)
  assert.match(lines[0], /75\.0% correct.*median 500, 0 over median\+1000\): FAIL \(correct, warmLoadMs\)$/)
  assert.equal(fs.statSync(path.join(out, 'metrics.json')).mode & 0o777, 0o600)
})

test('a load far above the median is counted as a reload; the gate keeps the spec threshold', async () => {
  const set = path.join(TMP, 'set2.jsonl')
  fs.writeFileSync(set, ['D1', 'D3', 'D5', 'D6'].map((r, i) => JSON.stringify({ id: `r${i}`, question: `What does ${r} say?`, cards: 'rules', expect: 'idk', must_contain: [] })).join('\n'))
  const loads = [4000, 500, 2600, 480]
  const fetch = async url => (url.endsWith('/api/version') ? { status: 200, text: async () => '{"version":"0.30.10"}' }
    : { status: 200, text: async () => JSON.stringify({ message: { content: '{"answerable":false,"answer":"no","cited":[]}' }, load_duration: loads.shift() * 1e6 }) })
  const out = path.join(TMP, 'out2')
  await main(['--set', set, '--out', out], { fetch, settings: { ...DEFAULTS, url: 'http://model.test' }, out: () => {} })
  const m = JSON.parse(fs.readFileSync(path.join(out, 'metrics.json'), 'utf8'))
  assert.deepEqual([m.warmLoadMs, m.warmLoadMedianMs, m.warmLoadsOverMedian, m.gates.warmLoadMs, m.idk], [2600, 500, 1, false, 1])
})
