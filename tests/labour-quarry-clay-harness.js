// labour.js: Hearthfire's Stone Quarry and Clay Deposit activators (Nate, 25 Oct: "make quarry stone and clay deposits
// work"). The server skips their MineOreScript, and labour.js claimed only MineOre veins, so working one did nothing. Each
// kind of deposit must open a round for a Novice miner, name itself, pay Quarried Stone or Clay and then rest. Loads the
// real module with a mock api, like labour-skyrim-veins-harness.js. Run: node tests/labour-quarry-clay-harness.js
'use strict';
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const LABOUR = path.join(SERVER, 'labour.js');

let virtual = 0;
globalThis.performance = { now: () => virtual };
// deny() throttles repeats on the wall clock, so it follows the virtual one here
const WALL0 = Date.now();
Date.now = () => WALL0 + virtual;
globalThis.__alduinakMasteryEvent = () => {};

const ACTOR = 0x14;
const STONE = '306c:HearthFires.esm', CLAY = '3043:HearthFires.esm';
// Real base records from the live order: Hearthfire's own, King of the Murkmire's and Beyond Skyrim's copies
const VEINS = {
  quarry: { ref: 0x2001, base: '306b:HearthFires.esm', edid: 'BYOHMineStone01', ore: STONE, title: 'Stone Quarry', word: /You cut 4 Quarried Stone\./, rank: 2, pays: 4 },
  clay: { ref: 0x2002, base: 'a511:HearthFires.esm', edid: 'BYOHMineClay01Dirt01', ore: CLAY, title: 'Clay Deposit', word: /You dig out 3 Clay\./, rank: 0, pays: 3 },
  riverMud: { ref: 0x2003, base: 'a14:HearthFires.esm', edid: 'BYOHMineClay01RiverMud01', ore: CLAY, title: 'Clay Deposit', word: /Clay/, rank: 0, pays: 3 },
  murkmire: { ref: 0x2004, base: '560c5a:King of the Murkmire.esp', edid: 'BYOHMineClay01Mud', ore: CLAY, title: 'Clay Deposit', word: /Clay/, rank: 0, pays: 3 },
  bsQuarry: { ref: 0x2005, base: '602b14:BSAssets.esm', edid: 'BSKBYOHMineStone01_PROXY_HF', ore: STONE, title: 'Stone Quarry', word: /Quarried Stone/, rank: 2, pays: 4 },
  bsClay: { ref: 0x2006, base: '602b16:BSAssets.esm', edid: 'BSKBYOHMineClay01Dirt01_PROXY_HF', ore: CLAY, title: 'Clay Deposit', word: /Clay/, rank: 0, pays: 3 },
};
const props = new Map();
const records = new Map();
for (const v of Object.values(VEINS)) {
  props.set(v.ref + '|baseDesc', v.base);
  records.set(parseInt(v.base.split(':')[0], 16) >>> 0, { record: { type: 'ACTI', editorId: v.edid } });
}

const out = { widgets: [], personals: [], items: [], logs: [] };
const handlers = new Map();
const api = {
  mp: {
    getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
    get: (id, prop) => props.get(id + '|' + prop),
    set: (id, prop, v) => props.set(id + '|' + prop, v),
    lookupEspmRecordById: (id) => records.get(id) || null,
  },
  log: (...a) => out.logs.push(a.join(' ')),
  personal: (a, t) => out.personals.push(t),
  audit: () => {},
  display: () => 'Tester #ABCD',
  who: () => 'Tester #ABCD (profile 1)',
  cfg: { labour: { clientJudged: false, perPlayerNodes: false } },
  distanceMeters: () => 2,
  openWidget: (a, w) => { out.widgets.push(w); return true; },
  closeWidget: () => true,
  onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); },
  giveItem: (a, id, n) => { out.items.push([id, n]); return true; },
  skills: require(path.join(SERVER, 'skills.json')),
  hasUiCap: () => false,
};
delete require.cache[require.resolve(LABOUR)];
require(LABOUR)(api);
const fire = (ev, args) => (handlers.get(ev) || []).forEach((f) => f(ACTOR, args, 33));

const markerAt = (ms, sweepMs) => { const ph = (ms % (sweepMs * 2)) / sweepMs; return ph <= 1 ? ph * 100 : (2 - ph) * 100; };
// A clean win: press at the first frame inside each band, honouring the stagger
const play = (w) => {
  const strikes = []; let hits = 0; let ready = 0; let at = 0;
  for (let el = 0; el <= w.totalMs && hits < w.strikes; el += 16) {
    at = el;
    if (el < ready) continue;
    if (Math.abs(markerAt(el, w.sweepMs) - w.bands[hits]) > w.band * 0.8) continue;
    strikes.push(el); ready = el + w.hitMs; hits++;
  }
  return { strikes, at };
};

let fails = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`); if (!c) fails++; };

for (const [name, v] of Object.entries(VEINS)) {
  // No Miner yet: not claimed, so the activate chain goes on to the skill system's first touch
  props.delete(ACTOR + '|private.mastery');
  out.widgets.length = 0;
  ok(globalThis.__dboLabour(v.ref, ACTOR) === false && !out.widgets.length, `${name}: someone with no Miner skill is passed on to first touch`);
  // Quarried stone takes an Adept miner (skills.json miner stoneMinTier, Nat 25 Oct): below it, refused and told why
  for (let r = 0; r < v.rank; r++) {
    out.widgets.length = 0; out.personals.length = 0;
    props.set(ACTOR + '|private.mastery', { order: ['miner'], skills: { miner: { rank: r } } });
    virtual += 600000;
    globalThis.__dboLabour(v.ref, ACTOR);
    ok(!out.widgets.length && out.personals.some((t) => /Cutting building stone takes an Adept miner/.test(t)), `${name}: a miner of rank ${r} is refused stone, told it takes an Adept`, out.personals.join(' | '));
  }
  // At the deposit's rank (clay: Novice): a round named for the deposit, and a win pays its material
  out.widgets.length = 0; out.personals.length = 0; out.items.length = 0;
  props.set(ACTOR + '|private.mastery', { order: ['miner'], skills: { miner: { rank: v.rank } } });
  props.delete(v.ref + '|private.dboWorkedUntil'); props.delete(ACTOR + '|private.minedVeins');
  virtual += 600000;
  const start = virtual;
  ok(globalThis.__dboLabour(v.ref, ACTOR) === true, `${name}: a rank ${v.rank} miner's activation is labour's`);
  const w = out.widgets[out.widgets.length - 1];
  ok(!!w && w.title === v.title, `${name}: the round is titled ${v.title}`, w ? w.title : out.personals.join(' | '));
  if (!w) continue;
  const p = play(w);
  virtual = start + p.at + 120;
  fire('labour', [w.nonce, JSON.stringify(p.strikes), p.at]);
  const paid = out.items.filter(([id]) => id === (parseInt(v.ore.split(':')[0], 16) >>> 0));
  ok(paid.length === 1 && paid[0][1] === v.pays, `${name}: the win pays ${v.pays} of ${v.ore}`, JSON.stringify(out.items));
  const told = out.widgets.concat(out.personals).map((x) => (typeof x === 'string' ? x : x.result || '')).join(' | ');
  ok(v.word.test(told), `${name}: the player is told what came out`, told);
  // Worked out: the next try waits out the rest
  out.widgets.length = 0; out.personals.length = 0;
  virtual += 1000;
  globalThis.__dboLabour(v.ref, ACTOR);
  ok(!out.widgets.length && out.personals.some((t) => /This deposit is worked out for now/.test(t)), `${name}: straight after, the deposit rests`, out.personals.join(' | '));
}
// Above the tier: a Master quarries more, 3 x the Master multiplier 2
{
  const v = VEINS.quarry;
  out.widgets.length = 0; out.personals.length = 0; out.items.length = 0;
  props.set(ACTOR + '|private.mastery', { order: ['miner'], skills: { miner: { rank: 4 } } });
  props.delete(v.ref + '|private.dboWorkedUntil'); props.delete(ACTOR + '|private.minedVeins');
  virtual += 600000;
  const start = virtual;
  globalThis.__dboLabour(v.ref, ACTOR);
  const w = out.widgets[out.widgets.length - 1];
  if (w) { const p = play(w); virtual = start + p.at + 120; fire('labour', [w.nonce, JSON.stringify(p.strikes), p.at]); }
  const paid = out.items.filter(([id]) => id === 0x306c);
  ok(!!w && paid.length === 1 && paid[0][1] === 6, 'quarry: a Master miner cuts 6 Quarried Stone', JSON.stringify(out.items));
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
