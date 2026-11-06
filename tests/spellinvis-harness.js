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

const load = (cfg, records) => {
  delete globalThis.__dboSpellInvisLast; delete globalThis.__dboSpellInvisUntil;
  const props = new Map(); const made = []; const handlers = new Map(); const logs = [];
  const mp = {
    makeProperty: (name, o) => made.push([name, o]),
    get: (a, k) => props.get(`${a}:${k}`),
    set: (a, k, v) => props.set(`${a}:${k}`, v),
    lookupEspmRecordById: (id) => (records && records[id]) || null,
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
  // isInvisible (npcdirector.js): a source the server saw, still running, and the owner's own fresh report
  const u32 = (...v) => { const b = new Uint8Array(v.length * 4); const dv = new DataView(b.buffer); v.forEach((x, i) => dv.setUint32(i * 4, x, true)); return b; };
  const mgef = (archetype) => { const b = new Uint8Array(0x48); new DataView(b.buffer).setUint32(0x40, archetype, true); return b; };
  const rec = (type, fields) => ({ record: { type, fields: fields.map(([t, data]) => ({ type: t, data })) }, toGlobalRecordId: (l) => l });
  const RECS = {
    0x2: rec('MGEF', [['DATA', mgef(11)]]), 0x3: rec('MGEF', [['DATA', mgef(0)]]),
    0x27eb6: rec('SPEL', [['EFID', u32(0x3)], ['EFIT', u32(0, 0, 0)], ['EFID', u32(0x2)], ['EFIT', u32(0, 0, 30)]]),
    0x3eb3e: rec('ALCH', [['EFID', u32(0x2)], ['EFIT', u32(0, 0, 40)]]),
    0x12fd0: rec('SPEL', [['EFID', u32(0x3)], ['EFIT', u32(0, 0, 60)]]),
  };
  let t = 1790000000000; const realNow = Date.now; Date.now = () => t;
  const w2 = load({}, RECS);
  check('the spell: its Invisibility effect is 30 s, the other effect does not count', w2.api.invisSeconds(0x27eb6) === 30, w2.api.invisSeconds(0x27eb6));
  check('the potion: 40 s', w2.api.invisSeconds(0x3eb3e) === 40);
  check('a spell without an Invisibility effect: 0', w2.api.invisSeconds(0x12fd0) === 0 && w2.api.noteSource(0x14, 0x12fd0) === false);
  check('an id with no record: 0', w2.api.invisSeconds(0x999) === 0);
  w2.send(0x14, [true]);
  check('a report alone does not make anyone invisible', w2.api.isInvisible(0x14) === false);
  check('the cast is noted', w2.api.noteSource(0x14, 0x27eb6) === true);
  check('cast seen and report on: invisible', w2.api.isInvisible(0x14) === true);
  check('exported for npcdirector.js and gamemode.js', globalThis.__dboSpellInvisible === w2.api.isInvisible && globalThis.__dboSpellInvisSource === w2.api.noteSource);
  t += 9000;
  check('a report older than freshMs (8 s) no longer counts', w2.api.isInvisible(0x14) === false);
  w2.send(0x14, [true]);
  check('a fresh heartbeat counts again', w2.api.isInvisible(0x14) === true);
  w2.send(0x14, [false]);
  check('the owner reports off (an attack or an activation ended it): visible at once', w2.api.isInvisible(0x14) === false);
  t += 2000; w2.send(0x14, [true]);
  t += 30000 * 3 + 5000 - 11000 + 1; w2.send(0x14, [true]);
  check('past sourceMult x its duration + sourceGraceMs a report alone is not enough', w2.api.isInvisible(0x14) === false);
  w2.api.noteSource(0x15, 0x3eb3e); w2.send(0x15, [true]);
  check('a drink counts like a cast', w2.api.isInvisible(0x15) === true);
  check('another player is not made invisible by it', w2.api.isInvisible(0x16) === false);
  Date.now = realNow;
  const off = load({ spellInvis: { enabled: false } });
  check('off: nothing to ask', globalThis.__dboSpellInvisible === null && globalThis.__dboSpellInvisSource === null && off.api.enabled === false);
}
{
  const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  const cast = src.slice(src.indexOf('const castHook = '), src.indexOf('mp.onSpellCast = castHook;'));
  const eat = src.slice(src.indexOf('const eatHook = '), src.indexOf('mp.onEatItem = eatHook;'));
  check('castHook notes an allowed cast', /verdict !== false && typeof globalThis.__dboSpellInvisSource === 'function'\) \{ try \{ globalThis.__dboSpellInvisSource\(Number\(casterId\)/.test(cast));
  check('eatHook notes an allowed drink', /verdict !== false && typeof globalThis.__dboSpellInvisSource === 'function'\) \{ try \{ globalThis.__dboSpellInvisSource\(Number\(actorId\)/.test(eat));
  const at = src.indexOf("require(SPELLINVIS_JS)({ mp, log, onUi, cfg })");
  check('gamemode loads it with onUi', at > 0);
  check('after onUi is defined', at > src.indexOf('const onUi = (event, fn) =>'));
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
