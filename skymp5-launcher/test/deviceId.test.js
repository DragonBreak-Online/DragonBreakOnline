'use strict'
// The ban enforcement check's launcher half: a one-way code from the Windows MachineGuid, read once, never sent or logged raw
const test = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')

const { createDeviceId } = require('../src/deviceId')

// A made-up machine id in the registry's format
const GUID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
const expected = `v1.${crypto.createHash('sha256').update(`DragonBreak device v1\n${GUID}`).digest('hex')}`

function make(value, platform = 'win32') {
  const logs = []
  let reads = 0
  const id = createDeviceId({ platform, readMachineGuid: () => { reads++; if (value instanceof Error) throw value; return value }, log: l => logs.push(l) })
  return { id, logs, reads: () => reads }
}

test('the code is v1. and the sha256 of a fixed label and the machine id', () => {
  const { id } = make(GUID)
  assert.deepStrictEqual(id.fields(), { device: expected })
  assert.match(id.fields().device, /^v1\.[0-9a-f]{64}$/)
})

test('the same PC gives the same code, whatever case or braces the registry shows', () => {
  for (const shown of [GUID, GUID.toUpperCase(), `{${GUID}}`, ` {${GUID.toUpperCase()}} `]) {
    assert.deepStrictEqual(make(shown).id.fields(), { device: expected }, shown)
  }
  assert.notDeepStrictEqual(make('1f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0').id.fields(), { device: expected })
})

test('no readable machine id, or not Windows: "unavailable", said once in the log', () => {
  for (const [value, platform] of [[null, 'win32'], ['', 'win32'], ['not a guid', 'win32'], ['abc', 'win32'], [new Error('reg failed'), 'win32'], [GUID, 'linux']]) {
    const { id, logs } = make(value, platform)
    assert.deepStrictEqual(id.fields(), { deviceStatus: 'unavailable' })
    assert.deepStrictEqual(id.fields(), { deviceStatus: 'unavailable' })
    assert.deepStrictEqual(logs, ['[device] no device check: the Windows machine id could not be read'])
  }
  assert.strictEqual(make(GUID, 'linux').reads(), 0, 'the registry is not read off Windows')
})

test('the machine id is read once per run and never appears in what is sent or logged', () => {
  const { id, logs, reads } = make(`{${GUID.toUpperCase()}}`)
  for (let i = 0; i < 5; i++) id.fields()
  assert.strictEqual(reads(), 1)
  const out = JSON.stringify(id.fields()) + logs.join('\n')
  for (const piece of [GUID, GUID.toUpperCase(), GUID.replace(/-/g, ''), GUID.slice(0, 8)]) assert.ok(!out.toLowerCase().includes(piece.toLowerCase()), piece)
  const failed = make(new Error(`reg.exe printed ${GUID}`))
  failed.id.fields()
  assert.ok(!failed.logs.join('\n').includes(GUID))
  assert.strictEqual(failed.reads(), 1)
  failed.id.fields()
  assert.strictEqual(failed.reads(), 1, 'a failed read is not retried in the same run')
})

test('main.js sends the code with launch-check and no longer posts the raw machine id anywhere', () => {
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main.js'), 'utf8')
  assert.ok(!main.includes('/api/users/me/hwid'), 'the raw report is gone')
  assert.ok(!/\bgetHwid\b/.test(main))
  assert.match(main, /\nfunction reportHwid\(\) \{\}\n/)
  const reads = main.split('\n').filter(l => l.includes('MachineGuid') && !l.trim().startsWith('//'))
  assert.strictEqual(reads.length, 1, 'the machine id is read only through createDeviceId')
  assert.match(reads[0], /require\('\.\/deviceId'\)\.createDeviceId\(\{ platform: process\.platform, readMachineGuid: \(\) => regQueryValue\(/)
  const at = main.indexOf('/api/launch-check`, {')
  assert.ok(at > 0)
  const body = main.slice(at, main.indexOf("}, { 'x-session': session })", at))
  assert.match(body, /filesVersion:[\s\S]*plugins:[\s\S]*\.\.\.deviceId\.fields\(\),\s*$/)
})
