'use strict'
// The forbidden list of /dragonbaron ask (SPEC A6), checked over sources/ai/*.js and sources/discord/dragonbaronAsk.js

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'sources')
const FILES = [
  ...fs.readdirSync(path.join(ROOT, 'ai')).filter(f => f.endsWith('.js')).map(f => path.join(ROOT, 'ai', f)),
  path.join(ROOT, 'discord', 'dragonbaronAsk.js'),
]

const FORBIDDEN = [
  [/require\(\s*['"]\.\.\/(?:\.\.\/sources\/)?console(?:\/[^'"]*)?['"]\s*\)/, 'the console module'],
  [/consoleApi|runStaffCommand|spool/i, 'the console API or its spool'],
  [/child_process['"]?\)?\s*\.\s*exec(?:Sync)?\b(?!File)|\bexecSync\b|(?<![.\w])exec\s*\(/, 'exec or execSync'],
  [/shell\s*:\s*true/, 'a shell'],
  [/players\.json|bans\.json|device-ids|citizenship|ticket-transcripts|staff-actions|backend\.env|console\.env/, 'a forbidden file'],
  [/\bspawn(?:Sync)?\s*\(|\bfork\s*\(/, 'another way to start a process'],
  [/\b(?:writeFile|appendFile|unlink|rm|rename|copyFile|mkdir)(?:Sync)?\s*\(/, 'a file write'],
]

test('the ask code has none of the forbidden calls, modules or files', () => {
  assert.ok(FILES.length >= 9, FILES.join(', '))
  for (const f of FILES) {
    const text = fs.readFileSync(f, 'utf8')
    for (const [rx, what] of FORBIDDEN) {
      // The usage record is the one file ask writes, so its writes are allowed in that file alone
      if (what === 'a file write' && path.basename(f) === 'askUsage.js') continue
      assert.ok(!rx.test(text), `${path.relative(ROOT, f)} has ${what}`)
    }
  }
})

test('no path is built from the question: every readFile, execFile and fetch target is a constant, the config or the rules folder', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ai', 'askSources.js'), 'utf8')
  const joins = [...src.matchAll(/path\.join\(([^)]*)\)/g)].map(m => m[1])
  for (const args of joins) assert.match(args, /^(?:__dirname|DATA_DIR|String\(config\.gameServerDir \|\| '')/, args)
  assert.match(src, /execFile\('python3', \['-I', DBD_COMS, cmd, \.\.\.args\]/)
  assert.ok(!/execFile\([^'"]/.test(src.replace(/execFile = require/, '')), 'execFile is called with a constant program')
  const files = [...src.matchAll(/readJsonFile\(([^)]*)\)/g)].map(m => m[1]).filter(a => a !== 'file')
  for (const a of files) assert.match(a, /^(?:LIVE_FILE|path\.join\()/, a)
  assert.match(src, /local\('\/api\/version'\)/)
  const raw = [...src.matchAll(/\b(?:readFile|statFile)\(([^,)]*)/g)].map(m => m[1].trim())
  assert.ok(raw.length >= 3, raw.join(', '))
  for (const a of raw) assert.match(a, /^(?:file|heldFile)$/, a)
  assert.match(src, /heldFile = HELD_FILE,/)
  assert.match(src, /const HELD_FILE = '\/opt\/dragonbreak-tools\/state\/infraction-watch-held\.jsonl'/)
})

test('the static checks catch what they are for (each pattern fires on a sample)', () => {
  const samples = ["require('../console')", 'consoleApi()', "require('child_process').exec('x')", 'execSync(x)', 'exec(cmd)', '{ shell: true }', "'players.json'", 'fs.writeFileSync(x)', 'spawn(x)']
  for (const s of samples) assert.ok(FORBIDDEN.some(([rx]) => rx.test(s)), s)
  assert.ok(!FORBIDDEN.some(([rx]) => rx.test("require('child_process').execFile")))
  assert.ok(!FORBIDDEN.some(([rx]) => rx.test('/x/.exec(text)')))
})
