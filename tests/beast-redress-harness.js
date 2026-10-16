// No re-dress inside a beast form (Purr #7DJT, 15 Oct: "when i was werewolf form it showed the arrows on my back i had
// equipped"). She joined at 23:07:20 and took Beast Form at 23:07:31; the client's undressing for the form reported nothing
// worn inside the login window, gamemode.js took it for the naked login report and re-dressed her 250 ms later, and the
// next report had her outfit and her practice arrows on the werewolf. This lifts gamemode.js's real redress() and equipment
// hook and runs that sequence against a stub mp, with the controls: the same naked login without a form still re-dresses,
// and the revert's own re-dress (beastform.js, after private.beast is cleared) still dresses her.
//   node tests/beast-redress-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fail++; };
let now = 1792192040000;
Date.now = () => now;
const pending = [];
const runPending = () => { while (pending.length) pending.shift()(); };

const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const cut = (from, to) => { const i = src.indexOf(from); const j = src.indexOf(to, i); if (i < 0 || j < 0) throw new Error(`gamemode.js: ${from} not found`); return src.slice(i, j + to.length); };
const redressSrc = cut('const redress = (a) => {', '\n};\n');
const equipSrc = cut('const wornOf = (equipment) =>', '\nequipHook.__dbo = true;');
const props = new Map(), equips = [];
const mp = {
  get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v),
  getDescFromId: (id) => (id >>> 0).toString(16),
  callPapyrusFunction: (kind, cls, fn, self, args) => { if (fn === 'EquipItem') equips.push(parseInt(args[0].desc, 16)); },
};
const G = {};
const { equipHook, connectedAt, redress } = new Function('globalThis', 'mp', 'log', 'display', 'recordOf', 'cfg', 'armourSwap', 'creationPending', 'setTimeout',
  `${equipSrc.replace(/\nequipHook\.__dbo = true;$/, '')}\n${redressSrc}\nreturn { equipHook, connectedAt, redress };`)(
  G, mp, () => {}, String, () => null, {}, null, () => false, (fn) => pending.push(fn));

const PURR = 0xff000275;
// Her 23:07:22 outfit: backpack, cuirass, cape, gauntlets, boots, helmet and dunArcherPracticeArrow (ids are stand-ins)
const OUTFIT = [0x1001, 0x1002, 0x1003, 0x1004, 0x1005, 0x1006];
const ARROWS = 0x1007;
const ALL = [...OUTFIT, ARROWS];
const report = (worn) => ({ inv: { entries: ALL.map((baseId) => ({ baseId, count: baseId === ARROWS ? 30 : 1, worn: worn.includes(baseId) })) }, numChanges: 1 });
const setWorn = (worn) => props.set(`${PURR}|equipment`, report(worn));
const join = () => {
  props.set(`${PURR}|private.lastWorn`, ALL.map((id) => [id, 0]));
  props.set(`${PURR}|inventory`, { entries: ALL.map((baseId) => ({ baseId, count: 1 })) });
  props.set(`${PURR}|private.beast`, null);
  connectedAt.set(PURR, now);
};
const beast = () => props.set(`${PURR}|private.beast`, { form: 'werewolf', original: { raceId: 0x13745 }, at: now, until: now + 150000 });
const naked = () => { setWorn([]); equipHook(PURR, report([]), true); runPending(); };
const dressed = () => { setWorn(ALL); equipHook(PURR, report(ALL), true); runPending(); };

// ---- 15 Oct 23:07: the login dresses her, then she changes 11 s after joining ----
join();
now += 1800; naked();
ok(equips.length === ALL.length, 'the naked login report re-dresses her (control)', equips.length);
now += 400; dressed();
equips.length = 0;
now += 8300;                                   // 23:07:31.1 Beast Form, still inside the 15 s login window
beast();
naked();                                       // 23:07:31.27 the client's unequipAll for the form
ok(equips.length === 0, 'the form\'s undressing inside the login window does not re-dress the werewolf', equips.map((x) => x.toString(16)));
ok(!equips.includes(ARROWS), '...so no arrows go back on the werewolf\'s back');
ok(JSON.stringify(props.get(`${PURR}|private.lastWorn`)) === JSON.stringify(ALL.map((id) => [id, 0])), 'her saved outfit is kept for the revert');

// ---- the 12 s fallback (onCharacterReady) lands while she is a werewolf ----
equips.length = 0;
now += 1500;
redress(PURR);
ok(equips.length === 0, 'the login\'s 12 s fallback re-dress leaves a werewolf alone', equips.length);

// ---- the revert clears private.beast first, then beastform.js re-dresses after 1.5 s ----
equips.length = 0;
now += 140000;
props.set(`${PURR}|private.beast`, null);
setWorn([]);
redress(PURR);
ok(equips.length === ALL.length && equips.includes(ARROWS), 'after the revert her outfit goes back on', equips.length);

// ---- a Vampire Lord the same way ----
equips.length = 0;
now += 3600000; join(); now += 2000; naked(); now += 400; dressed(); equips.length = 0;
now += 3000;
props.set(`${PURR}|private.beast`, { form: 'vampirelord', original: { raceId: 0x13745 }, at: now, until: 0 });
naked();
ok(equips.length === 0, 'a Vampire Lord taken inside the login window is not re-dressed either', equips.length);

// ---- a stored beast record without a form is not a form ----
equips.length = 0;
props.set(`${PURR}|private.beast`, {});
setWorn([]);
redress(PURR);
ok(equips.length === ALL.length, 'an empty private.beast does not block the re-dress', equips.length);

console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
