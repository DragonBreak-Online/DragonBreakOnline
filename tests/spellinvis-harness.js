// Scripted test for server\spellinvis.js (Nate, 23 Oct: the invisibility exploit): the owner's client reports its own
// Invisibility state as dbo "spellInvis" [on], mirrored in the neighbour-visible ff_spellInvis { on, n } that watchers
// read (client spellInvisPolicy.ts). No server: a mock mp.
//   node tests/spellinvis-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!ok) failures++; };

const load = (cfg) => {
  delete globalThis.__dboSpellInvisLast;
  const props = new Map(); const made = []; const handlers = new Map(); const logs = [];
  const mp = {
    makeProperty: (name, o) => made.push([name, o]),
    get: (a, k) => props.get(`${a}:${k}`),
    set: (a, k, v) => props.set(`${a}:${k}`, v),
  };
  const onUi = (ev, fn) => handlers.set(ev, fn);
  const MOD = path.join(ROOT, 'spellinvis.js');
  delete require.cache[MOD];
  const api = require(MOD)({ mp, log: (...x) => logs.push(x.join(' ')), onUi, cfg });
  return { api, props, made, handlers, logs, send: (a, args) => handlers.get('spellInvis')(a, args), prop: (a) => props.get(`${a}:ff_spellInvis`) };
};

{
  const w = load({});
  const reg = w.made.find((m) => m[0] === 'ff_spellInvis');
  check('ff_spellInvis registered neighbour-visible', !!reg && reg[1].isVisibleByNeighbors === true && reg[1].updateNeighbor === '');
  check('handler registered on the dbo relay as spellInvis', w.handlers.has('spellInvis'));
  w.send(0x14, [true]);
  check('first report mirrored', JSON.stringify(w.prop(0x14)) === '{"on":true,"n":1}', w.prop(0x14));
  w.send(0x14, [false]);
  check('a change mirrored at once, n grows', JSON.stringify(w.prop(0x14)) === '{"on":false,"n":2}', w.prop(0x14));
  w.send(0x14, [false]);
  check('the same state within minRepeatMs is dropped', w.prop(0x14).n === 2, w.prop(0x14));
  check('only a literal true is on', (w.send(0x15, ['true']), w.prop(0x15).on === false) && (w.send(0x16, [1]), w.prop(0x16).on === false));
  check('no args is off', (w.send(0x17, undefined), w.prop(0x17).on === false));
  check('actor 0 ignored', w.api.report(0, [true]) === false);
}
{
  // The heartbeat: same state after minRepeatMs counts again, so watchers see n change
  const w = load({ spellInvis: { minRepeatMs: 0 } });
  w.send(0x20, [true]); w.send(0x20, [true]); w.send(0x20, [true]);
  check('heartbeats each move n', w.prop(0x20).n === 3 && w.prop(0x20).on === true, w.prop(0x20));
}
{
  const w = load({ spellInvis: { enabled: false } });
  check('off: no handler, property still registered', !w.handlers.has('spellInvis') && w.made.some((m) => m[0] === 'ff_spellInvis'));
}
{
  const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  const at = src.indexOf("require(SPELLINVIS_JS)({ mp, log, onUi, cfg })");
  check('gamemode loads it with onUi', at > 0);
  check('after onUi is defined', at > src.indexOf('const onUi = (event, fn) =>'));
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
