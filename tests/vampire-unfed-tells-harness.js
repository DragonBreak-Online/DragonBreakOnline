// A newly turned vampire shows the tells until their first blood (Nate, 14 Oct: "everyone can see my vampiric eyes even
// when well fed"). By design (ticket #0064) the eyes and the pallor stay until the first meal, GM-made vampires included,
// but nothing said so: the needs line read Sated, and the vampire tab said "Stage 1 of 4, you last fed moments ago",
// because lastFed is stamped at the turning. This checks the tab says Not fed yet with a Your look row, the player is told
// why when the tells show unfed, and the first real feed on a fresh body puts their own eyes and colour back.
// Loads the real greathunt.js, bloodranks.js and supernatural.js in a scratch folder against an mp stub.
// node tests/vampire-unfed-tells-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vamp-unfed-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

const u32 = (...xs) => { const b = new Uint8Array(xs.length * 4); const v = new DataView(b.buffer); xs.forEach((x, i) => v.setUint32(i * 4, x >>> 0, true)); return b; };
const HDPT = (type) => ({ fields: [{ type: 'PNAM', data: u32(type) }] });
const NORD = 0x13746, HEAD = 0x5162f, HAIR = 0x51507, VAMP_EYES = 0xe7aeb, OWN_EYES = 0x5153b;
const RECORDS = new Map([[VAMP_EYES, HDPT(2)], [OWN_EYES, HDPT(2)], [HEAD, HDPT(1)], [HAIR, HDPT(3)]]);

const store = new Map();
const timers = {};
const cmds = {};
const told = [];
const noop = () => {};
let now = Date.UTC(2026, 9, 14, 12, 0);
Date.now = () => now;
let day = 20.5;
globalThis.__dboClock = { gameDays: () => day, summary: () => ({ timeScale: 6 }), isNight: () => false, isFullMoon: () => false };
globalThis.__dboSuperState = { crown: { holder: 999, name: 'K', since: now }, revoke: [] }; // no Crown claimed, no file written
const mp = {
  get: (id, p) => (p === 'type' ? 'MpActor' : store.get(`${id}|${p}`)),
  set: (id, p, v) => { store.set(`${id}|${p}`, v); },
  getDescFromId: (id) => `${id.toString(16)}:x`,
  getIdFromDesc: (d) => { const [hex, plugin] = String(d).split(':'); return plugin === 'Skyrim.esm' ? parseInt(hex, 16) : 0x1234; },
  callPapyrusFunction: () => null,
  lookupEspmRecordById: (id) => (RECORDS.has(id >>> 0) ? { record: RECORDS.get(id >>> 0), toGlobalRecordId: (l) => l } : null),
};
const V = 0x2f6, BODY = 0x40;
let online = [V];
const api = {
  mp, log: noop, audit: noop, personal: (a, t) => told.push({ a, t }), system: noop, registerChatCommand: (n, f) => { cmds[n] = f; },
  onUi: noop, openWidget: noop, closeWidget: noop, sendPacket: noop, display: String, who: String, isAdmin: () => true,
  findByName: () => V, onlineActors: () => online, every: (k, ms, f) => { timers[k] = f; }, profileOf: (a) => a,
  nameOf: String, isWorldspace: () => true, needsFeed: noop, hungerOf: () => 0, zoneOfActor: () => null, zoneById: () => null, cfg: {},
  hasUiCap: () => true,
};
for (const f of ['greathunt.js', 'bloodranks.js', 'supernatural.js']) require(path.resolve(ROOT, f))(api);

let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 400)}`); if (!c) fail++; };
const parts = () => store.get(`${V}|appearance`).headpartIds.map((h) => h >>> 0);
const sup = () => store.get(`${V}|private.supernatural`);
const row = (label) => { const v = globalThis.__dboSuperProgress(V); return (v && v.rows.filter((r) => r.label === label)[0]) || null; };
const SKIN = 0x806050;
store.set(`${V}|appearance`, { raceId: NORD, isFemale: false, headpartIds: [HEAD, HAIR, OWN_EYES], skinColor: SKIN, tints: [] });
store.set(`${V}|private.supernatural`, { kind: null, disease: null });
for (const id of [V, BODY]) { store.set(`${id}|worldOrCellDesc`, 'tamriel'); store.set(`${id}|pos`, [0, 0, 0]); }

// Made a vampire by a GM, as Nate's Valorn #95DB was (12 Oct 16:44): unfed, so the tells show
cmds.curse(V, 'me vampire');
ok(!!sup().unfed && parts().includes(VAMP_EYES) && !parts().includes(OWN_EYES), 'a GM-made vampire is unfed and shows the vampire eyes', [sup(), parts()]);
ok(told.some((x) => x.a === V && /Until your first taste of blood, your eyes and your colour give you away\. Food will not hide them/.test(x.t)),
  'they are told the eyes show until their first blood, and that food does not hide them', told.map((x) => x.t));
let thirst = row('Thirst');
ok(thirst && thirst.value === 'Not fed yet', 'the tab says Not fed yet, not Stage 1 of 4', thirst);
ok(thirst && !/last fed/.test(thirst.hint) && /not fed since you were turned/.test(thirst.hint) && /Food does not count/.test(thirst.hint), '...and never "you last fed moments ago"', thirst);
let lookRow = row('Your look');
ok(lookRow && lookRow.value === 'Gives you away' && /until your first taste of blood/.test(lookRow.hint), 'Your look: gives you away until the first blood', lookRow);
const before = told.length;
timers.superSlow(); timers.superSlow();
ok(parts().includes(VAMP_EYES) && told.length === before, 'the slow tick keeps the tells and says nothing more', told.slice(before));

// The first blood, through the real feeding on a fresh body
store.set(`${BODY}|isDead`, true); globalThis.__dboSuperDeath(BODY, 999);
ok(globalThis.__dboSuperActivate(BODY, V) === true, 'the vampire starts to drink from a fresh body');
for (let i = 0; i < 40; i++) { now += 500; if (timers.superFeed) timers.superFeed(); }
ok(!sup().unfed && sup().stage === 1, 'the first meal: fed, stage 1', sup());
timers.superSlow();
ok(parts().includes(OWN_EYES) && !parts().includes(VAMP_EYES) && store.get(`${V}|appearance`).skinColor === SKIN && !sup().look,
  'the next slow tick gives them their own eyes and colour back', [parts(), store.get(`${V}|appearance`).skinColor]);
ok(told.some((x) => /Fed, you pass for mortal/.test(x.t)), '...and tells them so', told.map((x) => x.t));
thirst = row('Thirst');
ok(thirst && thirst.value === 'Stage 1 of 4' && /You last fed/.test(thirst.hint), 'the tab now counts the thirst from that meal', thirst);
lookRow = row('Your look');
ok(lookRow && lookRow.value === 'Passes for mortal' && /From stage 3 of thirst/.test(lookRow.hint), 'Your look: passes for mortal, from stage 3 they show', lookRow);

// Thirsty again: stage 3 shows them, with the thirst line (not the unfed one)
told.length = 0;
day += 2.5; timers.superSlow();
ok(sup().stage >= 3 && parts().includes(VAMP_EYES), 'stage 3: the eyes show again', [sup().stage, parts()]);
ok(told.some((x) => /Your thirst shows/.test(x.t)) && !told.some((x) => /first taste of blood/.test(x.t)), '...with the thirst line, not the first-blood one', told.map((x) => x.t));
lookRow = row('Your look');
ok(lookRow && lookRow.value === 'Gives you away' && /feed, and you pass for mortal again/.test(lookRow.hint), 'Your look: gives you away until they feed', lookRow);

console.log(fail ? `${fail} failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
