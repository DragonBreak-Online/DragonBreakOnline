'use strict'
// The website's character store (routes/site-auth.js readStore): the same characters as a full scan of the changeForms
// folder, but an unchanged file is never read or parsed again, so a panel refresh costs a listing and a stat per file

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const stub = (rel, exports) => {
  const file = require.resolve(path.join('..', rel))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
for (const [rel, exp] of [['sources/players.js', { load: () => ({}) }], ['sources/profiles.js', { load: () => ({ map: {} }) }], ['sources/serverAccess.js', {}],
  ['sources/bans.js', { isBanned: () => false }], ['sources/nameTable.js', { load: () => ({}) }], ['sources/officials.js', {}], ['sources/factionWhitelist.js', {}]]) stub(rel, exp)

const config = require('../config')
const { charFromCf, fileChangeForms } = require('../sources/characters')
const PLAYER_FORM_FILE = /^[0-9a-f]+\.json$/

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-character-store-'))
const DIR = path.join(ROOT, 'changeForms')
let readStore

before(() => {
  fs.mkdirSync(DIR)
  config.changeFormsDir = DIR
  readStore = require('../routes/site-auth').internals.readStore
})
after(() => fs.rmSync(ROOT, { recursive: true, force: true }))

const character = (desc, profileId, name, extra = {}) => ({ recType: 1, formDesc: desc, profileId, displayName: name,
  dynamicFields: { 'private.charTag': 'AB12' }, inv: { entries: [{ baseId: 15, count: 3 }] }, ...extra })
// As FileDatabase.cpp saves: a temporary file renamed over the old one
const save = (name, value) => {
  const tmp = path.join(DIR, `${name}.tmp`)
  fs.writeFileSync(tmp, typeof value === 'string' ? value : JSON.stringify(value))
  fs.renameSync(tmp, path.join(DIR, name))
}

// What readStore answered before it kept files between scans: read, parse and stat every matching file
function fullScan() {
  const forms = []
  for (const [file, cf] of fileChangeForms(DIR, PLAYER_FORM_FILE)) {
    const char = charFromCf(cf)
    if (!char) continue
    forms.push({ cf, char, mtime: fs.statSync(file).mtime })
  }
  return forms
}

// readStore past its 3 s cache, with the store files it read
function scan(t) {
  t.mock.timers.tick(3001)
  const real = fs.readFileSync
  const read = []
  fs.readFileSync = function (file, ...rest) {
    if (String(file).startsWith(DIR)) read.push(path.basename(String(file)))
    return real.call(this, file, ...rest)
  }
  try { return { forms: readStore(), read: read.sort() } } finally { fs.readFileSync = real }
}

test('readStore answers what a full scan does, and reads only the files that changed since the last scan', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  save('ff000001.json', character('ff000001', 1, 'Aela'))
  save('ff000002.json', character('ff000002', 2, 'Brynjolf', { isDeleted: true }))
  save('ff000003.json', { recType: 2, formDesc: 'ff000003', profileId: -1 })
  save('ff000004.json', '{ half written')
  save('ff000005.json', character('ff000005', 5, 'Cicero', { appearanceDump: JSON.stringify({ name: 'Cicero', isFemale: false }) }))
  save('00012e46_Skyrim.esm.json', character('00012e46', 7, 'Not a player form'))
  fs.writeFileSync(path.join(DIR, 'ff000006.json.tmp'), JSON.stringify(character('ff000006', 6, 'Mid save')))

  const first = scan(t)
  assert.deepEqual(first.forms, fullScan())
  assert.deepEqual(first.forms.map(f => f.char.name).sort(), ['Aela', 'Brynjolf', 'Cicero'])
  assert.deepEqual(first.read, ['ff000001.json', 'ff000002.json', 'ff000003.json', 'ff000004.json', 'ff000005.json'])

  const again = scan(t)
  assert.deepEqual(again.forms, fullScan())
  assert.deepEqual(again.read, [], 'an unchanged store is not read again')

  save('ff000001.json', character('ff000001', 1, 'Aela the Huntress'))
  save('ff000004.json', character('ff000004', 4, 'Delphine'))
  fs.unlinkSync(path.join(DIR, 'ff000002.json'))
  save('ff000007.json', character('ff000007', 7, 'Esbern'))
  const changed = scan(t)
  assert.deepEqual(changed.forms, fullScan())
  assert.deepEqual(changed.read, ['ff000001.json', 'ff000004.json', 'ff000007.json'], 'only the replaced and the new files are read')
  assert.ok(changed.forms.some(f => f.char.name === 'Aela the Huntress'))
  assert.ok(changed.forms.some(f => f.char.name === 'Delphine'), 'a file caught half-written is read once it is saved whole')
  assert.ok(!changed.forms.some(f => f.char.name === 'Brynjolf'), 'a removed file is gone')
})

test('readStore throws when the folder cannot be read, as before', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 60000 })
  const was = config.changeFormsDir
  config.changeFormsDir = path.join(ROOT, 'missing')
  try { assert.throws(() => scan(t)) } finally { config.changeFormsDir = was }
})

test('a file that could not be read is read again on the next scan, as a full scan would', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 120000 })
  save('ff000008.json', character('ff000008', 8, 'Farengar'))
  const real = fs.readFileSync
  fs.readFileSync = function (file, ...rest) {
    if (path.basename(String(file)) === 'ff000008.json') throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' })
    return real.call(this, file, ...rest)
  }
  let first
  try { first = scan(t) } finally { fs.readFileSync = real }
  assert.ok(!first.forms.some(f => f.char.name === 'Farengar'), 'left out while it cannot be read, as before')
  const next = scan(t)
  assert.deepEqual(next.read, ['ff000008.json'], 'only the file that failed is read again')
  assert.ok(next.forms.some(f => f.char.name === 'Farengar'), 'not left out until the game next saves it')
  assert.deepEqual(next.forms, fullScan())
})
