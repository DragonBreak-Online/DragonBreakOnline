// The armour penalties shown in Magic > Active Effects (Nat, 2 Nov; _work/armour-effects-display-1102.md): gamemode.js's
// display-ability block, lifted and run against a stub mp and stub records, and enchanting.js's share that /armor names.
// Checks the steps each penalty shows at, that nothing is given while the descs are empty, that a change gives the new
// step's ability and takes back the old, that a login takes back every other step once, and that a record that is not an
// Ability is skipped. The mutants at the end run the same checks on altered copies of the block and must each fail.
//   node tests/armour-effects-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const check = (what, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${ok || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!ok) fails++; };

const GM = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
const a0 = GM.indexOf('// Active Effects (Nat, 2 Nov:'), a1 = GM.indexOf('const wearDebuffUpdate = (a, worn, settling, quiet) => {');
const BLOCK = a0 >= 0 && a1 > a0 ? GM.slice(a0, a1) : '';
check('gamemode.js has the display-ability block before wearDebuffUpdate', !!BLOCK);

// Stub records: SPEL 0x100+n for each step (a SPIT whose u32 at 8 is the type), 0x999 a spell that is not an Ability
const spel = (type) => { const d = new Uint8Array(36); new DataView(d.buffer).setUint32(8, type, true); return { record: { type: 'SPEL', fields: [{ type: 'SPIT', data: d }] } }; };
const RECORDS = new Map();
for (let n = 1; n <= 9; n++) RECORDS.set(0x100 + n * 5, spel(4));
for (let n = 1; n <= 5; n++) RECORDS.set(0x200 + n * 10, spel(4));
RECORDS.set(0x999, spel(0));
const descOf = (id) => `${id.toString(16)}:DBO Patch.esp`;
const FULL = { slow: Object.fromEntries([5, 10, 15, 20, 25, 30, 35, 40, 45].map((m) => [String(m), descOf(0x100 + m)])), wind: Object.fromEntries([10, 20, 30, 40, 50].map((m) => [String(m), descOf(0x200 + m)])) };

const load = (block, displayCfg) => {
  const calls = [], logs = [];
  const mp = {
    getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
    getDescFromId: (id) => descOf(id >>> 0),
    callPapyrusFunction: (kind, cls, fn, self, args) => calls.push([fn, self.desc, args[0].desc]),
  };
  delete globalThis.__dboWearShown; delete globalThis.__dboWearBuckets;
  const recordOf = (id) => RECORDS.get(id >>> 0) || null;
  const fieldsOf = (r, t) => ((r && r.record.fields) || []).filter((f) => f.type === t);
  const api = new Function('WEAR_DEBUFF', 'mp', 'recordOf', 'fieldsOf', 'log', 'display', `${block}\nreturn { wearShowSync, wearBuckets, wearShown };`)(
    { display: displayCfg }, mp, recordOf, fieldsOf, (...x) => logs.push(x.join(' ')), (a) => `P${a}`);
  return Object.assign(api, { calls, logs });
};

const scenarios = (block, c) => {
  let L;
  try { L = load(block, FULL); } catch (e) { c('the block runs', false, e.message); return; }
  const B = L.wearBuckets;
  c('speed shows in steps of 5: 2% nothing, 3% as 5, 12 as 10, 13 as 15, 45 the most', B({ speed: -2, regen: 1 }).slow === 0 && B({ speed: -3, regen: 1 }).slow === 5
    && B({ speed: -12, regen: 1 }).slow === 10 && B({ speed: -13, regen: 1 }).slow === 15 && B({ speed: -45, regen: 1 }).slow === 45 && B({ speed: 0, regen: 1 }).slow === 0, [B({ speed: -3, regen: 1 }), B({ speed: -13, regen: 1 })]);
  c('stamina recovery in steps of 10: 4% nothing, 14% as 10, 25% as 30, 50% the most', B({ speed: 0, regen: 0.96 }).wind === 0 && B({ speed: 0, regen: 0.86 }).wind === 10
    && B({ speed: 0, regen: 0.75 }).wind === 30 && B({ speed: 0, regen: 0.5 }).wind === 50);
  const P = 0xff000010;
  L.wearShowSync(P, { speed: -12, regen: 0.7 });
  const adds = (calls) => calls.filter((x) => x[0] === 'AddSpell').map((x) => x[2]), rems = (calls) => calls.filter((x) => x[0] === 'RemoveSpell').map((x) => x[2]);
  c('a first sync gives the two steps the penalties show at (slower 10, short of breath 30)', JSON.stringify(adds(L.calls)) === JSON.stringify([descOf(0x10a), descOf(0x21e)]), L.calls);
  c('...and, being the first since login, takes back every other step once (12 of the 14)', rems(L.calls).length === 12 && !rems(L.calls).includes(descOf(0x10a)) && !rems(L.calls).includes(descOf(0x21e)), rems(L.calls).length);
  c('...on the player, as birthsigns.js does', L.calls.every((x) => x[1] === descOf(P)));
  L.calls.length = 0;
  L.wearShowSync(P, { speed: -17, regen: 0.7 });
  c('a change of speed: the old step taken back, the new given, stamina untouched', JSON.stringify(L.calls) === JSON.stringify([['RemoveSpell', descOf(P), descOf(0x10a)], ['AddSpell', descOf(P), descOf(0x10f)]]), L.calls);
  L.calls.length = 0;
  L.wearShowSync(P, { speed: 0, regen: 1 });
  c('armour that costs nothing now: both taken back, nothing given', JSON.stringify(rems(L.calls).sort()) === JSON.stringify([descOf(0x10f), descOf(0x21e)].sort()) && !adds(L.calls).length, L.calls);
  L.calls.length = 0;
  L.wearShowSync(P, { speed: 0, regen: 1 });
  c('...and the same again calls nothing', !L.calls.length, L.calls);
  // inert: no descs
  const E = load(block, undefined);
  E.wearShowSync(P, { speed: -30, regen: 0.5 });
  c('with no descs in config it is inert: no Papyrus call at all', !E.calls.length, E.calls);
  // a desc that is not an Ability
  const bad = load(block, { slow: { 10: descOf(0x999) }, wind: {} });
  bad.wearShowSync(P, { speed: -10, regen: 1 });
  bad.wearShowSync(0xff000011, { speed: -10, regen: 1 });
  c('a record that is not an Ability is given to nobody, and logged once', !bad.calls.length && bad.logs.filter((l) => /is not an Ability/.test(l)).length === 1, [bad.calls, bad.logs]);
};

scenarios(BLOCK, check);

// gamemode.js calls it where the state changes, and a login starts afresh
check('wearDebuffUpdate syncs the abilities when the state changes, and a connect forgets what was shown',
  /wearState\.set\(a, Object\.assign\(\{ key, worn: worn\.slice\(\) \}, d\)\);\n\s*try \{ wearShowSync\(a, d\);/.test(GM) && /__dboWearConnect = \(a\) => \{ wearState\.delete\(a >>> 0\); wearShown\.delete\(a >>> 0\); \}/.test(GM));

// /armor: enchanting.js's share for light, heavy and clothing, null with the rule off
const enchantShare = (enabled) => {
  delete globalThis.__dboEnchantShareOf;
  require(path.join(SERVER, 'enchanting.js'))({ mp: { getEspmRecordIdsByType: () => [], lookupEspmRecordById: () => null }, log: () => {}, cfg: { enchanting: { enabled } } });
  return globalThis.__dboEnchantShareOf;
};
let on = null, off = null;
try { on = enchantShare(true); delete require.cache[path.join(SERVER, 'enchanting.js')]; off = enchantShare(false); } catch (e) { check('enchanting.js loads with a stub', false, e.message); }
check('/armor names a piece\'s enchantment capacity as enchanting.js rules it: light 66%, heavy 33%, clothing all', !!on && on('light') === 0.66 && on('heavy') === 0.33 && on('clothing') === 1, on && [on('light'), on('heavy')]);
check('...and nothing with the enchanting rule off', !!off && off('heavy') === null);
check('...the report asks for it per piece, by the piece\'s own light or heavy', /__dboEnchantShareOf\(p\.heavy \? 'heavy' : 'light'\)/.test(GM) && /Holds \$\{Math\.round\(share \* 100\)\}% of an enchantment's power\./.test(GM));

// gamemode-config.json: when the descs are filled, every step the block can show has one, and nothing else
const CFG_DISPLAY = ((JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8')).armorWear || {}).debuff || {}).display;
if (CFG_DISPLAY) {
  const keys = (o) => Object.keys(o || {}).sort((a, b) => a - b).join(',');
  const descs = [...Object.values(CFG_DISPLAY.slow || {}), ...Object.values(CFG_DISPLAY.wind || {})];
  check('config: a desc for every speed step 5..45 and every recovery step 10..50, each a distinct id:plugin', keys(CFG_DISPLAY.slow) === '5,10,15,20,25,30,35,40,45'
    && keys(CFG_DISPLAY.wind) === '10,20,30,40,50' && new Set(descs).size === 14 && descs.every((d) => /^[0-9a-f]{1,6}:[^:]+\.es[pml]$/.test(d)), [keys(CFG_DISPLAY.slow), keys(CFG_DISPLAY.wind)]);
}

const MUTANTS = [
  ['speed rounded down, not to the nearest', 'Math.round(v / step) * step', 'Math.floor(v / step) * step'],
  ['the old step is not taken back', '    for (const k of [\'slow\', \'wind\']) if (prev[k] && prev[k] !== want[k]) remove.add(prev[k]);\n', '\n'],
  ['a login does not clear the other steps', 'if (id && !wanted.has(id)) remove.add(id);', 'if (false) remove.add(id);'],
  ['any spell counts as an Ability', 'if (type !== SPIT_ABILITY) {', 'if (false) {'],
  ['given again on every sync', 'if (want[k] && (!prev || prev[k] !== want[k])) wearSpell(a, true, want[k]);', 'if (want[k]) wearSpell(a, true, want[k]);'],
];
for (const [name, a, b] of MUTANTS) {
  if (!BLOCK.includes(a)) { check(`mutant "${name}": its line is in the block`, false, a); continue; }
  let bad = 0;
  try { scenarios(BLOCK.replace(a, b), (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
