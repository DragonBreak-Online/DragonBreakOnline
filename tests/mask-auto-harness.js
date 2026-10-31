// A closed helmet or a mask masks its wearer without H (Nat, 31 Oct, sweep): playermenu.js __dboPlayerMenuEquip reads the
// worn ARMO's slots (BOD2) from each equipment report. The Head (30) or the face (44) masks, the body (32, the skins) never;
// taking it off shows the face, H cannot lift it, and the H loan works as before.
//   node tests/mask-auto-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) pass++; else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };

const slots = (...s) => s.reduce((m, x) => (m | (1 << (x - 30))) >>> 0, 0);
const bod2 = (m) => { const d = new Uint8Array(12); new DataView(d.buffer).setUint32(0, m, true); return { type: 'ARMO', fields: [{ type: 'BOD2', data: d }] }; };
const DAEDRIC = 0x1396d, IRON = 0x12e4d, CAMONNA = 0xfe00b807, SKIN = 0x601fcf, LENT = 0xfe00b808, HOOD = 0x10dd3a, ODD = 0x10dd3b;
const ARMO = new Map([[DAEDRIC, slots(30, 31, 42, 43)], [IRON, slots(31, 42)], [CAMONNA, slots(44)], [SKIN, slots(30, 32, 33, 37)],
  [LENT, slots(44)], [HOOD, slots(31, 42)], [ODD, slots(30, 31, 42, 43)]]);
const DESCS = { '808:Armors of the Velothi Pt2.esp': LENT, '10dd3a:Skyrim.esm': HOOD, '10dd3b:Skyrim.esm': ODD };
const P = 0xff000031;
const inv = new Map(), props = new Map();
const entries = () => (inv.get(P) || { entries: [] }).entries;
const count = (b) => entries().filter((q) => q.baseId === b).reduce((n, q) => n + q.count, 0);
const pm = {
  get: (a, k) => (k === 'inventory' ? inv.get(a) : props.get(`${a}|${k}`)),
  set: (a, k, v) => { if (k === 'inventory') inv.set(a, v); else props.set(`${a}|${k}`, v); },
  getIdFromDesc: (d) => DESCS[d] || 0, getDescFromId: (id) => id.toString(16),
  callPapyrusFunction: (kind, cls, method, self, args) => {
    const b = parseInt(args[0].desc, 16);
    const e = entries().find((q) => q.baseId === b);
    if (e) e.worn = method === 'EquipItem';
  },
  lookupEspmRecordById: (id) => (ARMO.has(id) ? { record: bod2(ARMO.get(id)) } : { record: { editorId: id === 0x13746 ? 'NordRace' : '' } }),
};
const said = [], ui = new Map(), timers = [], plog = [];
globalThis.__dboPlogHook = (k, a, on) => plog.push([k, on]);
let beast = '';
globalThis.__dboBeastName = () => beast;
const savedTimeout = global.setTimeout; global.setTimeout = (fn) => { timers.push(fn); return 0; };
const runTimers = () => { while (timers.length) timers.shift()(); };
const give = (a, b, n) => { const x = inv.get(a) || { entries: [] }; const es = x.entries.map((q) => Object.assign({}, q)); const h = es.find((q) => q.baseId === b && !q.worn); if (h) h.count += n; else es.push({ baseId: b, count: n }); inv.set(a, { entries: es }); return true; };
let fakeNow = 1_900_000_000_000;
const savedNow = Date.now; Date.now = () => fakeNow;
const load = (playerMenu) => require(path.resolve(ROOT, 'playermenu.js'))({
  mp: pm, log: () => {}, personal: (a, t) => said.push(t), system: () => {}, onUi: (n, fn) => ui.set(n, fn), sendPacket: () => {},
  display: String, nameOf: (a) => (props.get(`${a}|appearance`) || {}).name, tagOf: () => 'AB12', profileOf: () => 1, onlineActors: () => [P], isAdmin: () => false,
  ranksOf: () => [], giveItem: give, makeProp: () => {}, runCommand: () => {}, every: () => {}, registerChatCommand: () => {},
  cfg: { playerMenu },
});
load({});
const name = () => props.get(`${P}|appearance`).name;
const report = (...worn) => { said.length = 0; fakeNow += 1000; inv.set(P, { entries: worn.map((b) => ({ baseId: b, count: 1, worn: true })) }); globalThis.__dboPlayerMenuEquip(P, { inv: inv.get(P) }); return said.join(' '); };
const press = () => { said.length = 0; fakeNow += 2500; ui.get('maskToggle')(P); runTimers(); return said.join(' '); };
props.set(`${P}|appearance`, { name: 'Aldric', raceId: 0x13746 });

// A closed helmet (slot 30) masks, and says so
let t = report(DAEDRIC);
ok(name() === 'Masked Person' && props.get(`${P}|maskName`) === 'Aldric', 'a Daedric helmet (30, 31, 42, 43) masks: Masked Person, the real name kept', [name(), props.get(`${P}|maskName`)]);
ok(props.get(`${P}|private.maskAuto`) === DAEDRIC, '...and records the helmet as the cause');
ok(/hides your face/.test(t), '...and tells the wearer', t);
ok(plog.length === 1 && plog[0][1] === true, '...and the player log sees a mask on', plog);
ok(count(LENT) === 0, '...and nothing is lent');
report(DAEDRIC);
ok(plog.length === 1 && said.length === 0, 'a second report with the helmet still on changes nothing');
// H cannot lift it
t = press();
ok(name() === 'Masked Person' && /Take it off/.test(t) && count(LENT) === 0, 'H while the helmet masks: refused, still masked, nothing lent', [name(), t, entries()]);
// Off: the face shows again, nothing is taken
t = report(IRON);
ok(name() === 'Aldric' && !props.get(`${P}|maskName`) && !props.get(`${P}|private.maskAuto`), 'the helmet off for an open Iron helmet (31, 42): the face shows, the name is back', [name()]);
ok(/face shows again/.test(t), '...and says so', t);
ok(count(IRON) === 1, '...and the worn pieces are left alone', entries());
// The face slot alone, a mask
report(CAMONNA);
ok(name() === 'Masked Person', 'a mask on the face slot (44) masks');
report();
ok(name() === 'Aldric', '...taken off, unmasks');
// A skin takes 30 with the body: never a mask
report(SKIN);
ok(name() === 'Aldric', 'a skin (30 and 32) does not mask');

// The H loan is untouched: the lent mask (44) goes on while H's mask already is
inv.set(P, { entries: [] });
t = press();
ok(name() === 'Masked Person' && count(LENT) === 1 && !props.get(`${P}|private.maskAuto`), 'H lends the mask as before', [name(), entries()]);
globalThis.__dboPlayerMenuEquip(P, { inv: inv.get(P) });
ok(!props.get(`${P}|private.maskAuto`), '...its equip report does not turn it into a helmet mask');
t = press();
ok(name() === 'Aldric' && count(LENT) === 0 && /hand it back/.test(t), 'H again takes the lent mask back', [name(), entries(), t]);
// H's mask under a closed helmet: H takes it off, the helmet's report masks again
inv.set(P, { entries: [] });
press();
ok(name() === 'Masked Person' && count(LENT) === 1, 'H lent a mask');
report(DAEDRIC, LENT);
ok(!props.get(`${P}|private.maskAuto`), 'a helmet put on over H\'s mask leaves H\'s mask in charge');
press();
report(DAEDRIC);
ok(name() === 'Masked Person' && props.get(`${P}|private.maskAuto`) === DAEDRIC, 'H takes its mask off; the helmet still worn masks again at the next report', [name()]);
report();

// Login: quiet for the first 15 s, then it speaks
globalThis.__dboPlayerMenuReady(P);
t = report(DAEDRIC);
ok(name() === 'Masked Person' && t === '', 'just after the login the helmet masks without a word', t);
// Logout unmasks quietly and takes nothing
said.length = 0;
const before = JSON.stringify(entries());
globalThis.__dboPlayerMenuLeave(P);
runTimers();
ok(name() === 'Aldric' && !props.get(`${P}|private.maskAuto`) && said.length === 0, 'logout unmasks quietly', [name(), said]);
ok(JSON.stringify(entries()) === before, '...and takes nothing from the inventory', entries());
fakeNow += 20000;
// A beast form is left alone
beast = 'Werewolf';
report(DAEDRIC);
ok(name() === 'Aldric', 'a beast form is not masked by its outfit');
beast = '';
report();

// include and exclude settle a piece the slots get wrong
load({ autoMask: { include: ['10dd3a:Skyrim.esm'], exclude: ['10dd3b:Skyrim.esm'] } });
report(HOOD);
ok(name() === 'Masked Person', 'include: a hood (31, 42) listed masks');
report();
report(ODD);
ok(name() === 'Aldric', 'exclude: a 30 piece listed does not');
// The kill switch: a helmet's mask comes off at the reload
load({});
report(DAEDRIC);
ok(name() === 'Masked Person', 'masked again before the switch');
load({ autoMask: { enabled: false } });
ok(name() === 'Aldric' && !props.get(`${P}|private.maskAuto`), 'enabled false: the helmet\'s mask comes off at the reload');
report(DAEDRIC);
ok(name() === 'Aldric', '...and no report masks');

// Wiring and config
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const hook = gm.slice(gm.indexOf('const equipHook = '), gm.indexOf('const worn = wornOf(equipment);', gm.indexOf('const equipHook = ')));
ok(/isAllowed && typeof globalThis\.__dboPlayerMenuEquip === 'function'\) \{ try \{ globalThis\.__dboPlayerMenuEquip\(a, equipment\)/.test(hook), 'gamemode.js equipHook passes every allowed report to __dboPlayerMenuEquip');
const cfgFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const am = (cfgFile.playerMenu || {}).autoMask || {};
ok(am.enabled === true && JSON.stringify(am.slots) === '[30,44]', 'gamemode-config.json playerMenu.autoMask: on, slots 30 and 44', am);

Date.now = savedNow;
global.setTimeout = savedTimeout;
console.log(`${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
