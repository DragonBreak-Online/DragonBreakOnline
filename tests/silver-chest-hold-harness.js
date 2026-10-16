// Silver taken from a chest is not mailed while its bearer is still moving items there (SkaldsChosen, #bugs 15 Oct
// "Duplication with vampires": the silver was mailed within 2 s with the chest still open, and putting it back showed it in
// the chest and the mailbox at once). itemguards.js stamps every put and take; supernatural.js waits silverHoldAfterMoveMs.
// Loads the real supernatural.js and itemguards.js in a scratch folder against a stub post API.
//   node tests/silver-chest-hold-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SUPER = path.resolve(__dirname, '..', 'supernatural.js');
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-silverhold-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

const WOLF = 0xff000601, VAMP = 0xff000602, HUMAN = 0xff000603;
const INGOT = 0x5ace3, RING = 0x3b97c, SWORD = 0x10aa19, IRON = 0x5ace4, QUEST_SILVER = 0x77777;
// 13 Oct: editor ids that say silver but are not (claude-jake's check: Quicksilver was mailed away), and real silver ore
const QS_INGOT = 0x5ade0, QS_ORE = 0x5ade1, BLOOD_RING = 0x9fe01, BLOOD_KEY = 0x9fe02, HAND_CUIRASS = 0x9fe03, PLOW_KEY = 0x9fe04,
  SCHEMATIC = 0x9fe05, PERCH = 0x9fe06, SILVER_ORE = 0x5acdb;
const FALSE_SILVER = [QS_INGOT, QS_ORE, BLOOD_RING, BLOOD_KEY, HAND_CUIRASS, PLOW_KEY, SCHEMATIC, PERCH];
const RECS = {
  [INGOT]: { type: 'MISC', editorId: 'IngotSilver' }, [RING]: { type: 'ARMO', editorId: 'SilverRing' },
  [SWORD]: { type: 'WEAP', editorId: 'SilverSword' }, [IRON]: { type: 'MISC', editorId: 'IngotIron' },
  [QUEST_SILVER]: { type: 'MISC', editorId: 'SilverQuestItem' },
  [QS_INGOT]: { type: 'MISC', editorId: 'IngotQuicksilver' }, [QS_ORE]: { type: 'MISC', editorId: 'OreQuicksilver' },
  [BLOOD_RING]: { type: 'ARMO', editorId: 'MS02SilverBloodRing' }, [BLOOD_KEY]: { type: 'KEYM', editorId: 'MarkarthSilverBloodInnKey' },
  [HAND_CUIRASS]: { type: 'ARMO', editorId: 'TH_SilverHand1Cuirass' }, [PLOW_KEY]: { type: 'KEYM', editorId: 'CYRBrumaSilverplowHouseKey' },
  [SCHEMATIC]: { type: 'BOOK', editorId: 'DBO_Schematics_silver' }, [PERCH]: { type: 'INGR', editorId: 'CYRSilversidePerch' } /* hypothetical: the fish is only named so */,
  [SILVER_ORE]: { type: 'MISC', editorId: 'OreSilver' },
};
const store = new Map(), said = [], audits = [], timers = {}, letters = [], papyrusCalls = [];
globalThis.__dboClock = { gameDays: () => 100, sendTo: () => {} };
global.setTimeout = () => 0;
const inv = (a) => (store.get(`${a}|inventory`) || { entries: [] }).entries;
const count = (a, id) => inv(a).filter((e) => e.baseId === id).reduce((n, e) => n + e.count, 0);
const mp = {
  get: (id, p) => {
    id >>>= 0;
    if (p === 'type') return 'MpActor';
    if (p === 'equipment') return { inv: { entries: inv(id) } };
    return store.get(`${id}|${p}`);
  },
  set: (id, p, v) => store.set(`${id >>> 0}|${p}`, v),
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:x`, getIdFromDesc: () => 0x1234,
  callPapyrusFunction: (...x) => { papyrusCalls.push(x); return null; },
  lookupEspmRecordById: (id) => (RECS[id >>> 0] ? { record: RECS[id >>> 0] } : null),
};
globalThis.__dboPostApi = {
  sendableBase: (id) => id !== QUEST_SILVER,
  itemsText: (items) => items.map((e) => `${e.count} ${RECS[e.baseId].editorId}`).join(', '),
  takeParcel: (a, prep) => {
    const out = [];
    for (const [id, n] of prep.items) {
      const left = inv(a).map((e) => Object.assign({}, e)); let need = n;
      for (const e of left) if (e.baseId === id && !e.worn && need > 0) { const k = Math.min(need, e.count); e.count -= k; need -= k; out.push({ baseId: id, count: k }); }
      store.set(`${a}|inventory`, { entries: left.filter((e) => e.count > 0) });
    }
    return out;
  },
  giveEntries: (a, items) => { const e = inv(a).slice(); for (const x of items) e.push(Object.assign({}, x)); store.set(`${a}|inventory`, { entries: e }); },
  boardLetter: (to, zone, text, parcel) => letters.push({ to, zone, text, parcel }),
};
const api = {
  mp, log: () => {}, audit: (t) => audits.push(t), personal: (a, t) => said.push([a, t]), registerChatCommand: () => {},
  onUi: () => {}, openWidget: () => {}, closeWidget: () => {}, sendPacket: () => {}, display: (a) => `P${a.toString(16)}`, who: (a) => `P${a.toString(16)}`, isAdmin: () => false,
  findByName: () => null, onlineActors: () => [WOLF, VAMP, HUMAN], every: (k, ms, f) => { timers[k] = f; },
  profileOf: () => 1, nameOf: String, isWorldspace: () => true, needsFeed: () => {}, hungerOf: () => 0, cfg: {},
};
fs.writeFileSync('supernatural.json', JSON.stringify({ crown: null, revoke: [] }));
store.set(`${WOLF}|private.supernatural`, { kind: 'werewolf', disease: null, spells: [] });
store.set(`${VAMP}|private.supernatural`, { kind: 'vampire', pure: false, stage: 2, lastFed: 99, spells: [], disease: null });
store.set(`${HUMAN}|private.supernatural`, { kind: null, disease: null });
store.set(`${WOLF}|inventory`, { entries: [{ baseId: INGOT, count: 3 }, { baseId: IRON, count: 2 }, { baseId: RING, count: 1, worn: true }, { baseId: QUEST_SILVER, count: 1 }] });
store.set(`${VAMP}|inventory`, { entries: [{ baseId: SWORD, count: 1 }] });
store.set(`${HUMAN}|inventory`, { entries: [{ baseId: INGOT, count: 5 }] });
delete globalThis.__dboSuperState;
let clock = 1e12; const realNow = Date.now; Date.now = () => clock;
let lastMove = {}; globalThis.__dboLastItemMoveAt = (a) => lastMove[a >>> 0] || 0;
require(SUPER)(api);

let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fail++; };
// The vampire took a silver sword from a chest a second ago: nothing is mailed yet
lastMove[VAMP] = clock - 1000; letters.length = 0; timers.superSilver();
ok(count(VAMP, SWORD) === 1 && !letters.some((l) => l.to === VAMP), 'silver just taken from a chest stays in the pack while they are still at it', letters);
// They put it back (the engine moves it, itemguards stamps the move): nothing to mail, no copy anywhere else
store.set(`${VAMP}|inventory`, { entries: [] }); lastMove[VAMP] = clock; clock += 25000; timers.superSilver();
ok(!letters.some((l) => l.to === VAMP), 'put back into the chest: nothing is mailed, so it is not in the mailbox too', letters);
// They took it and walked off: mailed once the hold has run out
store.set(`${VAMP}|inventory`, { entries: [{ baseId: SWORD, count: 1 }] }); lastMove[VAMP] = clock; clock += 5000; timers.superSilver();
ok(count(VAMP, SWORD) === 1 && !letters.some((l) => l.to === VAMP), 'still within 20 s of the last move: kept', letters);
clock += 16000; timers.superSilver();
ok(count(VAMP, SWORD) === 0 && letters.filter((l) => l.to === VAMP).length === 1, '21 s after the last move: mailed once', letters);
// The werewolf, who has touched no chest, is mailed at once as before
ok(count(WOLF, INGOT) === 0 && letters.some((l) => l.to === WOLF), 'a bearer who moved nothing is mailed straight away, as before', letters);
// itemguards.js stamps the move that the hold reads
const IG = path.resolve(__dirname, '..', 'itemguards.js');
const igInv = { [VAMP]: [{ baseId: INGOT, count: 2 }], 0x806da23: [] };
delete globalThis.__dboLastItemMoveAt; globalThis.__dboItemGuards = undefined;
const igMp = { get: (id, k) => (k === 'inventory' && igInv[id] ? { entries: igInv[id].map((e) => Object.assign({}, e)) } : undefined), set: () => {} };
require(IG)({ mp: igMp, log: () => {}, who: String, recordOf: (id) => (RECS[id] ? { record: RECS[id] } : null), cfg: {} });
ok(typeof globalThis.__dboLastItemMoveAt === 'function' && globalThis.__dboLastItemMoveAt(VAMP) === 0, 'itemguards exposes the last move, 0 before any');
igInv[0x806da23] = [{ baseId: INGOT, count: 1 }]; clock += 1; globalThis.__dboTakeGuard(0x806da23, VAMP, INGOT, 1);
ok(globalThis.__dboLastItemMoveAt(VAMP) === clock, 'a take at a chest stamps the time', globalThis.__dboLastItemMoveAt(VAMP));
clock += 1; ok(typeof igMp.onPutItem === 'function' && igMp.onPutItem(0x806da23, VAMP, INGOT, 1) !== false && globalThis.__dboLastItemMoveAt(VAMP) === clock, 'a put stamps it too', globalThis.__dboLastItemMoveAt(VAMP));
Date.now = realNow;
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
