// The silver loop end to end (karta.gina, 19 Oct: "a vampire's silver goes to the mailbox, taking it out repeats the loop,
// and the icon stays on 24/7"). The real supernatural.js mails the silver; the real post.js holds and collects the parcel;
// gamemode.js's parcelUnbearable and pigeonsWaiting, cut out of the file, decide the burn and the mail marker.
//   node tests/silver-loop-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-silverloop-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fail++; };

const VAMP = 0xff000602, HUMAN = 0xff000603;
const GOLD = 0xf, INGOT = 0x5ace3, NECKLACE = 0x9c84b, IRON = 0x5ace4;
const RECS = { [INGOT]: { type: 'MISC', editorId: 'IngotSilver' }, [NECKLACE]: { type: 'ARMO', editorId: 'SilverNecklace' }, [IRON]: { type: 'MISC', editorId: 'IngotIron' } };
const NAMES = { [INGOT]: 'Silver Ingot', [NECKLACE]: 'Silver Necklace', [IRON]: 'Iron Ingot' };

const store = new Map();
const get = (id, p) => { const v = store.get(`${id >>> 0}|${p}`); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
const set = (id, p, v) => store.set(`${id >>> 0}|${p}`, v === undefined ? v : JSON.parse(JSON.stringify(v)));
const inv = (a) => (get(a, 'inventory') || { entries: [] }).entries;
const count = (a, id) => inv(a).filter((e) => (e.baseId >>> 0) === id).reduce((n, e) => n + Number(e.count), 0);
const timers = {};
global.setTimeout = () => 0;
globalThis.__dboClock = { gameDays: () => 100, sendTo: () => {} };
const mp = {
  get: (id, p) => { if (p === 'type') return 'MpActor'; if (p === 'equipment') return { inv: { entries: inv(id) } }; return get(id, p); },
  set,
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`, getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
  callPapyrusFunction: () => null,
  lookupEspmRecordById: (id) => (RECS[id >>> 0] ? { record: RECS[id >>> 0] } : null),
};
const lettersOf = (a) => get(a, 'private.pigeons') || [];
const saveLetters = (a, list) => set(a, 'private.pigeons', list);
const told = [];
// post.js, real
require(path.join(SERVER, 'post.js'))({
  mp, log: () => {}, personal: (a, t) => told.push([a, t]), audit: () => {}, who: (a) => `P${(a >>> 0).toString(16)}`,
  nameOf: () => 'X', tagOf: () => 'TAG', profileOf: (a) => a & 0xfff, discordOf: (a) => `acct${a & 0xfff}`, onlineActors: () => [VAMP, HUMAN],
  every: () => {}, cfg: { post: { goldOnly: false } }, onUi: () => {}, takeGold: () => true,
  giveItem: (a, base, n) => { const e = inv(a); e.push({ baseId: base, count: n }); set(a, 'inventory', { entries: e }); return true; },
  goldOf: (a) => count(a, GOLD), GOLD_BASE: GOLD, recordOf: (id) => (RECS[id >>> 0] ? { record: RECS[id >>> 0] } : null),
  depositToTreasury: (z, n) => n, zoneById: () => ({ id: 'bruma', name: 'Bruma' }), boardZoneNear: () => 'bruma',
  lettersOf, saveLetters, sendMailState: () => {}, itemName: (d) => NAMES[parseInt(d, 16)] || '',
});
const P = globalThis.__dboPostApi;
ok(!!P && typeof P.collect === 'function', 'post.js loaded and its API is up');
// supernatural.js, real
fs.writeFileSync('supernatural.json', JSON.stringify({ crown: null, revoke: [] }));
delete globalThis.__dboSuperState;
require(path.join(SERVER, 'supernatural.js'))({
  mp, log: () => {}, audit: () => {}, personal: (a, t) => told.push([a, t]), registerChatCommand: () => {}, onUi: () => {}, openWidget: () => {},
  closeWidget: () => {}, sendPacket: () => {}, display: (a) => `P${a.toString(16)}`, who: (a) => `P${a.toString(16)}`, isAdmin: () => false,
  findByName: () => null, onlineActors: () => [VAMP, HUMAN], every: (k, ms, f) => { timers[k] = f; }, profileOf: (a) => a & 0xfff, nameOf: String,
  isWorldspace: () => true, needsFeed: () => {}, hungerOf: () => 0, cfg: {},
});
// gamemode.js's two rules, cut out of the file
const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
const line = (name) => { const i = gm.indexOf(`const ${name} = `); return gm.slice(i, gm.indexOf('\n', i)); };
const rules = new Function('lettersOf', `${line('parcelUnbearable')}\n${line('pigeonsWaiting')}\nreturn { parcelUnbearable, pigeonsWaiting };`)(lettersOf);
globalThis.__dboParcelUnbearable = rules.parcelUnbearable; // as gamemode.js publishes it for post.js
ok(/globalThis.__dboParcelUnbearable = parcelUnbearable;/.test(gm), 'gamemode.js publishes the rule for post.js');
ok(/burnsParcel = change === 'delete' && parcelUnbearable\(a, box\[i\]\)/.test(gm) && /if \(change === 'delete' && box\[i\]\.parcel && !burnsParcel\) return/.test(gm), 'gamemode.js: burning a letter is refused for a parcel only when it is not one its reader can never keep');

set(VAMP, 'private.supernatural', { kind: 'vampire', pure: false, stage: 2, lastFed: 99, spells: [], disease: null });
set(HUMAN, 'private.supernatural', { kind: null, disease: null });
set(VAMP, 'inventory', { entries: [{ baseId: INGOT, count: 2 }, { baseId: IRON, count: 1 }] });
set(HUMAN, 'inventory', { entries: [{ baseId: INGOT, count: 5 }] });

// 1. The silver leaves the vampire's pack for their own mailbox; the iron stays; a human keeps theirs
timers.superSilver();
let box = lettersOf(VAMP);
ok(count(VAMP, INGOT) === 0 && count(VAMP, IRON) === 1 && box.length === 1 && box[0].parcel && box[0].parcel.items.some((e) => e.baseId === INGOT),
  'the vampire\'s 2 Silver Ingots are mailed to their own mailbox; the iron stays', { inv: inv(VAMP), box });
ok(count(HUMAN, INGOT) === 5 && lettersOf(HUMAN).length === 0, 'a human keeps their silver');
// 2. The mail marker: lit while unread, out once read, though the parcel is still in the letter
ok(rules.pigeonsWaiting(VAMP) === 1, 'the unread letter lights the mail marker');
box[0].read = true; saveLetters(VAMP, box);
ok(rules.parcelUnbearable(VAMP, box[0]) && rules.pigeonsWaiting(VAMP) === 0, 'read, a parcel of silver the vampire cannot keep no longer holds the marker (it did 24/7 before)');
// 3. Collecting it is refused with the way out, and nothing comes back into the pack
const res = P.collect(VAMP, box[0].id);
ok(res && res.ok === false && /Burn the letter/.test(res.text) && count(VAMP, INGOT) === 0 && lettersOf(VAMP)[0].parcel, 'collecting it is refused ("burn the letter"), so the silver never returns to be mailed again', res);
timers.superSilver();
ok(lettersOf(VAMP).length === 1, '...and no second letter is written');
// 4. A human's silver parcel is theirs to collect as ever
saveLetters(HUMAN, [{ id: 'h1', from: 'Bruma', text: 'x', at: 1, read: true, parcel: { gold: 0, items: [{ baseId: INGOT, count: 1 }] } }]);
ok(!rules.parcelUnbearable(HUMAN, lettersOf(HUMAN)[0]) && P.collect(HUMAN, 'h1').ok === true && count(HUMAN, INGOT) === 6, 'a human collects a parcel of silver');
// 5. A mixed parcel (gold or other goods with the silver) is collected; the silver alone goes back to the mailbox, and that one is burnable
saveLetters(VAMP, [{ id: 'm1', from: 'Bruma', text: 'x', at: 1, read: true, parcel: { gold: 0, items: [{ baseId: NECKLACE, count: 1 }, { baseId: IRON, count: 3 }] } }]);
ok(!rules.parcelUnbearable(VAMP, lettersOf(VAMP)[0]) && P.collect(VAMP, 'm1').ok === true && count(VAMP, IRON) === 4, 'a parcel of silver and iron is collected: the iron is the vampire\'s');
timers.superSilver();
box = lettersOf(VAMP);
const back = box.find((m) => m.parcel);
ok(count(VAMP, NECKLACE) === 0 && back && back.parcel.items.every((e) => e.baseId === NECKLACE) && rules.parcelUnbearable(VAMP, back), 'the silver necklace alone goes back to the mailbox, and that letter can be burned');
// 6. Cured: the same letter is theirs to collect again
set(VAMP, 'private.supernatural', { kind: null, disease: null });
ok(!rules.parcelUnbearable(VAMP, back) && P.collect(VAMP, back.id).ok === true && count(VAMP, NECKLACE) === 1, 'cured of vampirism, they collect their silver again');

console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
