// A character stuck as "Masked Person" (#7DJT, 10-11 Oct): mask() kept nameOf(a) as the real name without asking
// whether the name shown was already the mask's, so once the kept name was lost (a crash) the next H stored "Masked
// Person" as the real name and every unmask put it back. Now the mask's own name is never stored as a real name, a
// stored one counts as none (unmask leaves the name alone and clears it), and nobody is renamed by the code.
//   node tests/mask-name-harness.js   (from server/)
'use strict';
const path = require('path');
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) { pass++; console.log('ok  ', what); } else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };

const DEFAULT_MASK = 0xfe00b808, P = 0xff000021, Q = 0xff000022;
const DESCS = { '808:Armors of the Velothi Pt2.esp': DEFAULT_MASK };
const inv = new Map(), props = new Map();
const pm = {
  get: (a, k) => (k === 'inventory' ? inv.get(a) : props.get(`${a}|${k}`)),
  set: (a, k, v) => { if (k === 'inventory') inv.set(a, v); else props.set(`${a}|${k}`, v); },
  getIdFromDesc: (d) => DESCS[d] || 0, getDescFromId: (id) => id.toString(16),
  callPapyrusFunction: (kind, cls, method, self, args) => {
    const a = parseInt(self.desc, 16) >>> 0, b = parseInt(args[0].desc, 16) >>> 0;
    const e = ((inv.get(a) || { entries: [] }).entries).find((q) => (q.baseId >>> 0) === b);
    if (e) e.worn = method === 'EquipItem';
  },
  lookupEspmRecordById: () => ({ record: { editorId: 'NordRace' } }),
};
const said = [], logs = [], ui = new Map(), timers = [];
const savedTimeout = global.setTimeout; global.setTimeout = (fn) => { timers.push(fn); return 0; };
const runTimers = () => { while (timers.length) timers.shift()(); };
const give = (a, b, n) => { const x = inv.get(a) || { entries: [] }; const es = x.entries.map((q) => Object.assign({}, q)); const h = es.find((q) => q.baseId === b && !q.worn); if (h) h.count += n; else es.push({ baseId: b, count: n }); inv.set(a, { entries: es }); return true; };
const nameShown = (a) => (props.get(`${a}|appearance`) || {}).name;
require(path.resolve(__dirname, '..', process.env.PLAYERMENU || 'playermenu.js'))({
  mp: pm, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push(t), system: () => {}, onUi: (n, fn) => ui.set(n, fn), sendPacket: () => {},
  display: (a) => `P${a.toString(16)}`, nameOf: (a) => nameShown(a) || 'Stranger', tagOf: () => 'AB12', profileOf: () => 1, onlineActors: () => [P, Q], isAdmin: () => false,
  ranksOf: () => [], giveItem: give, makeProp: () => {}, runCommand: () => {}, every: () => {}, registerChatCommand: () => {},
  cfg: { playerMenu: {} },
});
let fakeNow = 1_900_000_000_000;
const savedNow = Date.now; Date.now = () => fakeNow;
const press = (a) => { said.length = 0; fakeNow += 2500; ui.get('maskToggle')(a); runTimers(); return said.join(' '); };

// The ordinary round trip still works
props.set(`${P}|appearance`, { name: 'Purr', raceId: 1 }); inv.set(P, { entries: [] });
press(P);
ok(nameShown(P) === 'Masked Person' && props.get(`${P}|maskName`) === 'Purr', 'H masks: the name shown is Masked Person, the real one kept', [nameShown(P), props.get(`${P}|maskName`)]);
press(P);
ok(nameShown(P) === 'Purr' && !props.get(`${P}|maskName`), 'H again: the real name is back', nameShown(P));

// #7DJT: masked, then the kept name is lost (a crash); the name shown is still the mask's
press(P);
props.set(`${P}|maskName`, '');
let t = press(P);
ok(props.get(`${P}|maskName`) !== 'Masked Person', 'H with the mask name showing and no real name kept: the mask name is never stored as the real name', props.get(`${P}|maskName`));
ok(/lost behind a mask/.test(t) && /\/bug/.test(t), '...the player is told to send a /bug for staff', t);
ok(logs.some((l) => /P ?ff000021 shows the mask name/i.test(l) || /Pff000021 shows the mask name/.test(l)), '...and the log names them for staff', logs);
ok(nameShown(P) === 'Masked Person', '...nobody is renamed by the code', nameShown(P));

// A character already locked by the old code: maskName holds "Masked Person"
props.set(`${Q}|appearance`, { name: 'Masked Person', raceId: 1 }); props.set(`${Q}|maskName`, 'Masked Person'); inv.set(Q, { entries: [{ baseId: DEFAULT_MASK, count: 1, worn: true }] });
props.set(`${Q}|private.maskItemId`, DEFAULT_MASK);
t = press(Q);
ok(!props.get(`${Q}|maskName`), 'a stored mask name is not treated as real: H clears it', props.get(`${Q}|maskName`));
ok(nameShown(Q) === 'Masked Person', '...the name is left as it is (no rename), for staff to restore', nameShown(Q));
ok(/lost behind the mask/.test(t), '...and the player is told what happened', t);
ok(!((inv.get(Q) || { entries: [] }).entries.some((e) => e.baseId === DEFAULT_MASK && e.count > 0)), '...the lent mask still goes back', inv.get(Q));
t = press(Q);
ok(!props.get(`${Q}|maskName`) && /lost behind a mask/.test(t), 'H again: refused, never storing the mask name', [props.get(`${Q}|maskName`), t]);
// The login path (quiet unmask) clears a locked one too
props.set(`${Q}|maskName`, 'masked person ');
said.length = 0; globalThis.__dboPlayerMenuLeave(Q); runTimers();
ok(!props.get(`${Q}|maskName`) && nameShown(Q) === 'Masked Person' && !said.length, 'logout or login: a stored mask name (any case) is cleared quietly, no rename', [props.get(`${Q}|maskName`), said]);

// Staff restore the name (/rename): the next mask round trip keeps it
props.set(`${Q}|appearance`, { name: 'Purr', raceId: 1 }); inv.set(Q, { entries: [] }); props.set(`${Q}|private.maskLost`, 0);
press(Q); press(Q);
ok(nameShown(Q) === 'Purr', 'after a staff rename, masking works again and the name comes back', nameShown(Q));

Date.now = savedNow;
global.setTimeout = savedTimeout;
console.log(`${pass}/${pass + fail} passed`);
process.exitCode = fail ? 1 : 0;
