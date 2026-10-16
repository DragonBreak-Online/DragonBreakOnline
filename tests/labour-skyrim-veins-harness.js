// labour.js: the DragonBreak Online Edits veins placed in Skyrim (MineOreZinc / MineOreMithril / MineOreAmber, 16 Oct)
// must open a round for a miner of the right tier and pay their own ore, never "You do not know what to do with this
// seam" (Rokvar Ironhand and Tiberius Blue-Blood, 16 Oct log). Loads the real module with a mock api, like
// labour-harness.js. Run: node tests/labour-skyrim-veins-harness.js
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
// Real records: the first vein activator of each ore in DragonBreak Online Edits.esp (local ids, as the server's own
// desc ids are; the harness's getIdFromDesc reads only the hex part)
const VEINS = {
  zinc: { ref: 0x2001, base: '1ac9f8:DragonBreak Online Edits.esp', edid: 'MineOreZinc03_CaveGWall', ore: '601c88:BSAssets.esm', tier: 1 },
  mithril: { ref: 0x2002, base: '1ac9d1:DragonBreak Online Edits.esp', edid: 'MineOreMithril03_LFallForestGrass', ore: '1ac98b:DragonBreak Online Edits.esp', tier: 3 },
  amber: { ref: 0x2003, base: '1ac999:DragonBreak Online Edits.esp', edid: 'MineOreAmber04_LDirt02', ore: 'bc6:ccBGSSSE025-AdvDSGS.esm', tier: 4 },
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

for (const [ore, v] of Object.entries(VEINS)) {
  // Below the ore's tier: refused by skill, naming the ore, never the "do not know" line
  if (v.tier > 0) {
    out.widgets.length = 0; out.personals.length = 0;
    props.set(ACTOR + '|private.mastery', { order: ['miner'], skills: { miner: { rank: v.tier - 1 } } });
    virtual += 600000;
    globalThis.__dboLabour(v.ref, ACTOR);
    const said = out.personals.join(' | ');
    ok(!out.widgets.length && /is beyond your skill/.test(said), `${ore}: a miner below tier ${v.tier} is told it is beyond their skill`, said);
  }
  // At the ore's tier: a round opens and a win pays this vein's own ore
  out.widgets.length = 0; out.personals.length = 0; out.items.length = 0;
  props.set(ACTOR + '|private.mastery', { order: ['miner'], skills: { miner: { rank: v.tier } } });
  props.delete(v.ref + '|private.dboWorkedUntil'); props.delete(ACTOR + '|private.minedVeins');
  virtual += 600000;
  const start = virtual;
  globalThis.__dboLabour(v.ref, ACTOR);
  const w = out.widgets[out.widgets.length - 1];
  ok(!!w && !out.personals.some((t) => /do not know what to do/.test(t)), `${ore}: a tier ${v.tier} miner gets a round`, out.personals.join(' | '));
  if (!w) continue;
  const p = play(w);
  virtual = start + p.at + 120;
  fire('labour', [w.nonce, JSON.stringify(p.strikes), p.at]);
  const paid = out.items.filter(([id]) => id === (parseInt(v.ore.split(':')[0], 16) >>> 0));
  ok(paid.length === 1 && paid[0][1] >= 1, `${ore}: the win pays ${v.ore}`, JSON.stringify(out.items));
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
