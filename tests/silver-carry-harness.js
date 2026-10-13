// A werewolf or vampire cannot hold silver (Nate, 12 Oct): silver in the pack goes to their own mailbox at the notice boards
// (post.js), never a worn piece (the wear pass takes it off first), nothing the post cannot send; a human keeps theirs.
// Loads the real supernatural.js in a scratch folder against a stub post API.
//   node tests/silver-carry-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SUPER = path.resolve(__dirname, '..', 'supernatural.js');
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-silver-'));
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
require(SUPER)(api);

let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fail++; };
ok(typeof timers.superSilver === 'function', 'the silver check runs on its timer');
timers.superSilver();
const wolfLetter = letters.find((l) => l.to === WOLF);
ok(count(WOLF, INGOT) === 0 && count(WOLF, IRON) === 2, "a werewolf's silver ingots leave the pack; the iron stays", inv(WOLF));
ok(wolfLetter && wolfLetter.zone === 'Bruma' && wolfLetter.parcel.items.some((e) => e.baseId === INGOT && e.count === 3), '...mailed to their own mailbox from the Bruma board', letters);
ok(count(WOLF, RING) === 1, 'a worn silver ring is not mailed in the same pass (the wear pass takes it off first)');
ok(count(WOLF, QUEST_SILVER) === 1, 'silver the post cannot send stays');
ok(said.some(([a, t]) => a === WOLF && /The silver burns even through the pack/.test(t) && /mailbox/.test(t)), 'the werewolf is told where it went', said);
ok(count(VAMP, SWORD) === 0 && letters.some((l) => l.to === VAMP && l.parcel.items[0].baseId === SWORD), "a vampire's silver sword is mailed too");
ok(said.some(([a, t]) => a === VAMP && /sears you through the pack/.test(t)), '...with the vampire line');
ok(count(HUMAN, INGOT) === 5 && !letters.some((l) => l.to === HUMAN), 'a human keeps their silver');
ok(audits.some((t) => /^SILVER P/.test(t) && /mailed to their own mailbox/.test(t)), 'audited');
// The ring, taken off by the wear pass, is loose next time and goes too
store.set(`${WOLF}|inventory`, { entries: inv(WOLF).map((e) => (e.baseId === RING ? { baseId: RING, count: 1 } : e)) });
letters.length = 0; timers.superSilver();
ok(count(WOLF, RING) === 0 && letters.some((l) => l.to === WOLF && l.parcel.items.some((e) => e.baseId === RING)), 'the unequipped ring goes on the next pass');
letters.length = 0; timers.superSilver();
ok(!letters.length, 'nothing more to send: no empty letters');

// 13 Oct: quicksilver and the other names that only say silver stay in the pack and on the body; real silver ore goes
const FALSE_WORN = new Set([BLOOD_RING, HAND_CUIRASS]);
store.set(`${WOLF}|inventory`, { entries: [...FALSE_SILVER.map((id) => ({ baseId: id, count: 2, worn: FALSE_WORN.has(id) })), { baseId: SILVER_ORE, count: 4 }] });
letters.length = 0; papyrusCalls.length = 0; timers.superSilver();
ok(FALSE_SILVER.every((id) => count(WOLF, id) === 2), 'Quicksilver ore and ingots, Silver-Blood, Silver-Hand, Silver-Plow, the schematics and the Silverside Perch stay in the pack', inv(WOLF));
ok(!letters.some((l) => l.parcel.items.some((e) => FALSE_SILVER.includes(e.baseId))), '...none of them is mailed', letters);
ok(count(WOLF, SILVER_ORE) === 0 && letters.some((l) => l.to === WOLF && l.parcel.items.some((e) => e.baseId === SILVER_ORE && e.count === 4)), 'real silver ore still goes to the mailbox', letters);
ok(!papyrusCalls.some((c) => /UnequipItem/.test(JSON.stringify(c))), 'the wear rule leaves a worn Silver-Blood ring and Silver Hand cuirass on (the same test as the carry rule)', papyrusCalls);
store.set(`${VAMP}|inventory`, { entries: [{ baseId: QS_INGOT, count: 7 }, { baseId: QS_ORE, count: 3 }] });
letters.length = 0; timers.superSilver();
ok(count(VAMP, QS_INGOT) === 7 && count(VAMP, QS_ORE) === 3 && !letters.some((l) => l.to === VAMP), 'a vampire keeps quicksilver too');
// The real silver ring worn is still torn off
store.set(`${WOLF}|inventory`, { entries: [{ baseId: RING, count: 1, worn: true }] });
papyrusCalls.length = 0; timers.superSilver();
ok(papyrusCalls.some((c) => /UnequipItem/.test(JSON.stringify(c))), 'a worn real silver ring is still taken off', papyrusCalls);

console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
