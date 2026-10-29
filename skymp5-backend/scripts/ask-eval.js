#!/usr/bin/env node
'use strict'
// The model eval for /dragonbaron ask (SPEC A13), run once the AI box is reachable; it reads fixtures and the settings file only
// node scripts/ask-eval.js --set test/fixtures/ask/ask-eval.jsonl --out <dir> [--runs 1] [--model <tag>]

const fs = require('fs')
const path = require('path')

const { createAnswerer } = require('../sources/ai/askAnswer')
const { createSources } = require('../sources/ai/askSources')
const { createLocalModel, createSingleFlight } = require('../sources/ai/localModel')
const { readSettings } = require('../sources/ai/aiSettings')
const { compose } = require('../sources/discord/dragonbaronAsk')

const THRESHOLDS = Object.freeze({ correct: 0.8, idk: 0.9, withheldShown: 0, p95Ms: 15000, warmLoadMs: 500 })
const VIEWER = Object.freeze({ discordId: 'eval', tier: 'owner', punishTier: null, displayName: 'eval', username: 'eval' })

const RELOAD_OVER_MS = 1000
const median = list => (list.length ? [...list].sort((a, b) => a - b)[(list.length - 1) >> 1] : 0)
const p95 = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] : 0 }

function classify(r) {
  if (r.outcome === 'refused') return 'refuse'
  if (r.outcome === 'idk') return 'idk'
  if (r.outcome === 'answered' && r.mode === 'model') return 'answer'
  return r.outcome
}

// The cards one row sees: "rules" is live retrieval over the repo's rules folder, any other name an entry of eval-cards.json
function sourcesFor(row, cardsFile, rulesSources) {
  if (row.cards === 'rules') return { read: (intent, args, viewer, ctx) => (intent === 'rules' ? rulesSources.read(intent, args, viewer, ctx) : Promise.resolve([])) }
  const all = JSON.parse(fs.readFileSync(cardsFile, 'utf8'))
  if (!Array.isArray(all[row.cards])) throw new Error(`row ${row.id}: no card set named ${row.cards}`)
  let given = false
  return { read: async () => { if (given) return []; given = true; return all[row.cards].map(c => ({ ...c })) } }
}

async function main(argv = process.argv.slice(2), { fetch = globalThis.fetch, settings = null, out = console.log, now = Date.now } = {}) {
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def }
  const setFile = opt('--set', path.join(__dirname, '..', 'test', 'fixtures', 'ask', 'ask-eval.jsonl'))
  const outDir = opt('--out', null)
  const runs = Math.max(1, Math.min(5, Number(opt('--runs', '1')) || 1))
  const modelTag = opt('--model', null)
  if (!outDir) { out('usage: node scripts/ask-eval.js --set <jsonl> --out <dir> [--runs 1] [--model <tag>]'); return 2 }
  const base = settings || readSettings()
  const s = Object.freeze({ ...base, ...(modelTag ? { model: modelTag } : {}) })
  if (!s.url) { out('DRAGONBARON_AI_URL is not set in the settings file: nothing to evaluate'); return 2 }
  const rows = fs.readFileSync(setFile, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
  const cardsFile = path.join(path.dirname(setFile), 'eval-cards.json')
  const rulesSources = createSources({ config: {} })
  const model = createLocalModel({ settings: s, fetch })
  const flight = createSingleFlight({ maxWaiting: 2 })
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 })
  const results = []
  for (let run = 1; run <= runs; run++) {
    for (const row of rows) {
      const loads = []
      const counting = {
        probe: () => model.probe(),
        chat: async a => { const r = await model.chat(a); loads.push(r.loadMs ?? null); return r },
      }
      const answerer = createAnswerer({ sources: sourcesFor(row, cardsFile, rulesSources), model: counting, flight, readSwitch: () => ({ model: true }), settings: s, now })
      const t0 = now()
      const r = await answerer.answer({ question: row.question, viewer: VIEWER, deadlineMs: 90000 })
      const ms = now() - t0
      const got = classify(r)
      const reply = compose(r).content
      const answerText = (r.answer || '').toLowerCase()
      const missing = (row.must_contain || []).filter(w => !answerText.includes(String(w).toLowerCase()))
      const correct = got === row.expect && (got !== 'answer' || !missing.length)
      results.push({
        run, id: row.id, expect: row.expect, got, correct, outcome: r.outcome, mode: r.mode, check: r.check, repair: !!r.repair, ms, model_ms: r.modelMs || 0, load_ms: loads,
        withheld_shown: r.outcome === 'withheld' && !!r.answer && reply.includes(r.answer), answer: r.answer || null, missing,
      })
    }
  }
  const unanswerable = results.filter(r => r.expect === 'idk')
  const loadsAfterFirst = results.flatMap(r => r.load_ms).filter(v => v !== null).slice(1)
  const metrics = {
    rows: rows.length, runs, model: s.model, num_ctx: s.numCtx,
    correct: results.filter(r => r.correct).length / Math.max(1, results.length),
    idk: unanswerable.filter(r => r.got === 'idk').length / Math.max(1, unanswerable.length),
    withheld: results.filter(r => r.outcome === 'withheld').length,
    withheldShown: results.filter(r => r.withheld_shown).length,
    repairs: results.filter(r => r.repair).length,
    p95Ms: p95(results.map(r => r.ms)),
    warmLoadMs: loadsAfterFirst.length ? Math.max(...loadsAfterFirst) : 0,
    // Ollama 0.30.10 reports a constant ~500 ms load_duration on every call to a resident model; a reload stands far above it
    warmLoadMedianMs: median(loadsAfterFirst),
    warmLoadsOverMedian: loadsAfterFirst.filter(v => v > median(loadsAfterFirst) + RELOAD_OVER_MS).length,
    outcomes: results.reduce((a, r) => ({ ...a, [r.got]: (a[r.got] || 0) + 1 }), {}),
  }
  metrics.gates = {
    correct: metrics.correct >= THRESHOLDS.correct, idk: metrics.idk >= THRESHOLDS.idk, withheldShown: metrics.withheldShown <= THRESHOLDS.withheldShown,
    p95Ms: metrics.p95Ms <= THRESHOLDS.p95Ms, warmLoadMs: metrics.warmLoadMs <= THRESHOLDS.warmLoadMs,
  }
  const pass = Object.values(metrics.gates).every(Boolean)
  metrics.thresholds = THRESHOLDS
  metrics.pass = pass
  fs.writeFileSync(path.join(outDir, 'results.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 })
  fs.writeFileSync(path.join(outDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`, { mode: 0o600 })
  const failed = Object.keys(metrics.gates).filter(k => !metrics.gates[k])
  out(`ask eval: ${(metrics.correct * 100).toFixed(1)}% correct, idk ${(metrics.idk * 100).toFixed(1)}%, withheld ${metrics.withheld} (shown ${metrics.withheldShown}), p95 ${metrics.p95Ms} ms, ` +
    `warm load ${metrics.warmLoadMs} ms (median ${metrics.warmLoadMedianMs}, ${metrics.warmLoadsOverMedian} over median+${RELOAD_OVER_MS}): ${pass ? 'PASS' : `FAIL (${failed.join(', ')})`}`)
  return pass ? 0 : 1
}

if (require.main === module) main().then(code => process.exit(code), err => { console.error(err.message); process.exit(1) })

module.exports = { main, classify, THRESHOLDS }
