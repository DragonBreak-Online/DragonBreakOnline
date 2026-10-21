// Vampire eyes kept as a character's own (Nate 21 Oct: "check and fix all vampire eyes issue"). Loads the real
// supernatural.js and appearance.js against one stub world: a Nord man turned vampire (NordRaceVampire 88794).
// Covers: a stuck vampire (Mike Morethi #5D8L: a GM's /chargen saved the vampire eyes while the tells were not due), the
// repair table, the mortal race's default eyes, a cured character still wearing them, a vampire whose tells are due (left
// alone), a pending clear, tells hiding vampire eyes (Olverom #KWK5), the editor guard, and /vampeyes.
//   node tests/vampire-eyes-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vampire-eyes-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let fails = 0;
const ok = (c, label, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${label}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const P = 0xff001207;
const store = new Map();
const said = [];
const audits = [];
const ticks = new Map();
const cmds = new Map();
const timers = [];
// The stub resolves "<hex>:<plugin>" to the hex alone, so vampire-eye-repairs.json's "cd45:Improved Eyes Skyrim.esp" is cd45
const OWN_EYE = 0x2700cd45, REPAIR_EYE = 0xcd45, TELL = 0xe7aeb, TELL_F = 0x7291e, DG_EYE = 0x6f90, DEFAULT_EYE = 0xe7aee, DEFAULT_EYE_F = 0x51548;
const EYES = new Set([OWN_EYE, REPAIR_EYE, TELL, TELL_F, DG_EYE, DEFAULT_EYE, DEFAULT_EYE_F, 0x6f88, 0x24245]);
const u32le = (n) => new Uint8Array(new Uint32Array([n]).buffer);
const f = (type, n) => ({ type, data: n === undefined ? new Uint8Array(0) : u32le(n) });
// NordRace (13746) head data as Skyrim.esm has it: body markers first, then NAM0 MNAM / NAM0 FNAM with INDX/HEAD pairs
const NORD = [f('MNAM'), f('FNAM'), f('NAM1'), f('MNAM'), f('FNAM'), f('NAM0'), f('MNAM'), f('INDX', 0), f('HEAD', 0x5140e), f('INDX', 1), f('HEAD', 0x5162f),
  f('INDX', 2), f('HEAD', 0x51631), f('INDX', 3), f('HEAD', DEFAULT_EYE), f('NAM0'), f('FNAM'), f('INDX', 0), f('HEAD', 0x51176), f('INDX', 1), f('HEAD', 0x51623),
  f('INDX', 2), f('HEAD', 0x5150f), f('INDX', 3), f('HEAD', DEFAULT_EYE_F)];
let raceRecord = NORD;
const mp = {
  get: (id, k) => store.get(`${id}|${k}`),
  set: (id, k, v) => { store.set(`${id}|${k}`, v); },
  getIdFromDesc: (desc) => parseInt(String(desc).split(':')[0], 16) >>> 0,
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
  callPapyrusFunction: () => null,
  lookupEspmRecordById: (id) => {
    id = id >>> 0;
    if (id === 0x13746) return { record: { type: 'RACE', fields: raceRecord }, toGlobalRecordId: (l) => l };
    return { record: { type: 'HDPT', fields: EYES.has(id) ? [f('PNAM', 2)] : [] }, toGlobalRecordId: (l) => l };
  },
  findFormsByPropertyValue: (k, v) => (v === '5d8l' ? [P] : []),
  setRaceMenuOpen: () => {},
  getUserByActor: () => 3,
};
let profile = 171;
const noop = () => {};
const api = {
  mp, log: noop, audit: (t) => audits.push(t), personal: (a, t) => said.push(t), system: (a, t) => said.push(t),
  registerChatCommand: (n, fn) => cmds.set(n, fn), onUi: noop, openWidget: noop, closeWidget: noop, sendPacket: noop,
  display: () => 'Mike', who: () => 'Mike', isAdmin: () => true, findByName: (q) => (/mike/i.test(q) ? P : 0), onlineActors: () => [P],
  every: (name, ms, fn) => ticks.set(name, fn), profileOf: () => profile, nameOf: () => 'GM', isWorldspace: () => false,
  needsFeed: noop, hungerOf: () => 0, hasUiCap: () => false, sourceResistsOf: () => new Set(),
  cfg: { appearance: { cost: 500, cooldownHours: 24 } }, userOf: () => 3, later: (fn, ms) => timers.push({ fn, ms }),
};
require(path.join(ROOT, 'supernatural.js'))(api);
require(path.join(ROOT, 'appearance.js'))(api);

const SP = 'private.supernatural';
const mortal = (eye = OWN_EYE, female = false) => ({ raceId: 0x88794, isFemale: female, name: 'Mike', weight: 100, skinColor: 6189428, hairColor: 2, headTextureSetId: 3,
  headpartIds: [0x5162f, 0x51631, eye, 0xe4e29], options: [0], presets: [0], tints: [] });
const look = () => store.get(`${P}|appearance`);
const state = () => store.get(`${P}|${SP}`);
const day = () => Date.now() / 86400000 * 6;
const vampire = (stage, extra) => store.set(`${P}|${SP}`, Object.assign({ kind: 'vampire', disease: null, stage, lastFed: stage >= 3 ? day() - 2.5 : day(), pure: true, blessed: false, beastDay: -1, unfed: null, sated: null, spells: [] }, extra || {}));
const tick = () => ticks.get('superSlow')();
const feed = () => { const s = state(); s.lastFed = day(); store.set(`${P}|${SP}`, s); tick(); };
const has = (id) => look().headpartIds.map((h) => h >>> 0).includes(id >>> 0);
// A new session: the once-a-session eye check runs again. The login stamp is dropped again, or the stage would wait for
// the client's spell sync (spellsSettling) and a feed would not lower it
const login = () => { globalThis.__dboSuperLogin(P); if (globalThis.__dboSuperLoginAt instanceof Map) globalThis.__dboSuperLoginAt.delete(P >>> 0); };
const fresh = (eye, opts = {}) => {
  store.clear(); timers.length = 0; said.length = 0; audits.length = 0; raceRecord = NORD;
  profile = opts.profile === undefined ? 171 : opts.profile;
  store.set(`${P}|private.charTag`, opts.tag || '5D8L');
  store.set(`${P}|appearance`, mortal(eye, !!opts.female));
};
const appearance = (edit) => {
  store.set(`${P}|inventory`, { entries: [{ baseId: 0xf, count: 800 }] });
  store.set(`${P}|private.dboAppearanceAt`, 0);
  cmds.get('appearance')(P, '');
  const after = edit(JSON.parse(JSON.stringify(look())));
  store.set(`${P}|appearance`, JSON.parse(JSON.stringify(after)));
  return globalThis.__dboAppearanceEdit.finish(P, after);
};

// 1. Stuck (Mike Morethi): a pure-blood at stage 1, no s.look, the vampire eyes in his own look: the repair table's eyes
fresh(TELL); vampire(1); tick();
ok(!has(TELL) && has(REPAIR_EYE), 'stuck: the vampire eyes go, the eyes from vampire-eye-repairs.json go in', look().headpartIds.map((h) => h.toString(16)));
ok(audits.some((t) => /vampire eyes e7aeb -> cd45/.test(t)), 'and it is audited', audits);
tick();
ok(has(REPAIR_EYE), 'a second tick leaves it so');

// 2. Stuck with no repair entry: the mortal race's default eyes from its RACE record (the male's, past the body markers)
fresh(TELL, { profile: 999, tag: 'ZZZZ' }); vampire(1); tick();
ok(!has(TELL) && has(DEFAULT_EYE), 'stuck, no repair: NordRace\'s male default eyes', look().headpartIds.map((h) => h.toString(16)));
// ...and a woman gets the female's
fresh(TELL_F, { profile: 999, tag: 'ZZZZ', female: true }); vampire(1); tick();
ok(!has(TELL_F) && has(DEFAULT_EYE_F), 'a woman: NordRace\'s female default eyes', look().headpartIds.map((h) => h.toString(16)));
// ...and nothing found at all: left as it is
fresh(TELL, { profile: 999, tag: 'ZZZZ' }); store.set(`${P}|appearance`, Object.assign(mortal(TELL), { raceId: 0x88844 })); vampire(1); tick();
ok(has(TELL), 'no own eyes anywhere: left as it is (logged once)');

// 3. Cured: no curse, still wearing the vampire eyes; checked once a session
fresh(TELL, { profile: 999, tag: 'ZZZZ' }); store.set(`${P}|${SP}`, { kind: null, stage: 0 });
login(); tick();
ok(!has(TELL) && has(DEFAULT_EYE), 'cured: the vampire eyes go at the first tick of the session');
// a cured character with the own eyes last given back on record gets those, not the race default
fresh(TELL, { profile: 999, tag: 'ZZZZ' }); store.set(`${P}|${SP}`, { kind: null, stage: 0, ownEye: OWN_EYE });
login(); tick();
ok(has(OWN_EYE), 'cured: the own eyes last given back (s.ownEye) come first');

// 4. Legit tells: stage 3 shows them over his own eyes and nothing undoes it
fresh(OWN_EYE); vampire(3); tick();
ok(has(TELL) && state().look && state().look.prevEye === OWN_EYE, 'stage 3: the tells show, his own eyes kept');
tick(); tick();
ok(has(TELL) && state().look.prevEye === OWN_EYE && !audits.length, 'and the eye check leaves legit tells alone');
feed();
ok(has(OWN_EYE) && !has(TELL) && state().ownEye === OWN_EYE, 'a feed gives his eyes back, and they are remembered');

// 5. Unfed (fever-turned) tells are legit too
fresh(OWN_EYE); vampire(1, { pure: false, unfed: { played: 0, wither: 0 } }); tick();
ok(has(TELL) && state().look.prevEye === OWN_EYE, 'unfed: the tells show and stay');

// 6. Tells laid (look kept) but no longer due: showTells gives the own eyes back, the check does not get in first
fresh(TELL); vampire(1, { look: { kind: 'vampire', eye: TELL, prevEye: OWN_EYE, prevExtras: [] } }); tick();
ok(has(OWN_EYE) && !state().look && !audits.length, 'pending clear: the feed path gives back the kept eyes');

// 7. Tells due, but the eyes they hide are vampire eyes (Olverom: Dawnguard's 6f88 since creation)
fresh(TELL, { profile: 999, tag: 'ZZZZ' }); vampire(4, { look: { kind: 'vampire', eye: TELL, prevEye: 0x6f88, prevExtras: [] } }); tick();
ok(has(TELL) && state().look.prevEye === DEFAULT_EYE, 'the hidden vampire eyes become the race default; the tells stay', state().look);
feed();
ok(has(DEFAULT_EYE) && !has(TELL) && !has(0x6f88), 'and a feed gives back mortal eyes');

// 8. The editor guard: an edit (a GM's /chargen, /appearance) saves vampire eyes while the tells are not due
fresh(OWN_EYE); vampire(1); tick();
appearance((x) => Object.assign(x, { hairColor: 7, headpartIds: x.headpartIds.map((h) => (h === OWN_EYE ? TELL : h)) }));
ok(has(OWN_EYE) && !has(TELL) && look().hairColor === 7, 'editor guard: the vampire eyes are refused, his own kept, the rest of the edit saved', look().headpartIds.map((h) => h.toString(16)));
ok(said.some((t) => /not yours to choose/.test(t)) && audits.some((t) => /editor saved vampire eyes/.test(t)), 'the player is told and staff audited');
// ...Dawnguard's vampire eyes (what an editor on a vampire race offers) the same
fresh(OWN_EYE); vampire(1); tick();
appearance((x) => Object.assign(x, { headpartIds: x.headpartIds.map((h) => (h === OWN_EYE ? DG_EYE : h)) }));
ok(has(OWN_EYE) && !has(DG_EYE), 'editor guard: Dawnguard\'s vampire eyes refused too');
// ...with the tells showing, another vampire eye picked: the tells stay, the eyes they hide stay his own
fresh(OWN_EYE); vampire(3); tick();
appearance((x) => Object.assign(x, { headpartIds: x.headpartIds.map((h) => (h === TELL ? DG_EYE : h)) }));
ok(has(TELL) && !has(DG_EYE) && state().look.prevEye === OWN_EYE, 'tells showing, other vampire eyes picked: the tells over his own eyes', state().look);
// ...a mortal eye picked is still taken (the old behaviour)
fresh(OWN_EYE); vampire(1); tick();
appearance((x) => Object.assign(x, { headpartIds: x.headpartIds.map((h) => (h === OWN_EYE ? DEFAULT_EYE : h)) }));
ok(has(DEFAULT_EYE) && !has(OWN_EYE), 'a mortal eye chosen in the editor is saved as made');

// 9. /vampeyes
fresh(TELL); vampire(1);
said.length = 0; cmds.get('vampeyes')(P, 'audit');
ok(/STUCK/.test(said.at(-1) || ''), '/vampeyes audit names the stuck character', said.at(-1));
cmds.get('vampeyes')(P, 'fix #5D8L');
ok(has(REPAIR_EYE) && /e7aeb -> cd45/.test(said.at(-1) || ''), '/vampeyes fix #TAG repairs them', said.at(-1));
cmds.get('vampeyes')(P, 'fix #5D8L');
ok(/nothing changed/.test(said.at(-1) || ''), 'a second fix changes nothing', said.at(-1));
cmds.get('vampeyes')(P, 'audit');
ok(/nobody online/.test(said.at(-1) || '') || !/STUCK/.test(said.at(-1) || ''), 'and the audit is clean after', said.at(-1));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exitCode = fails ? 1 : 0;
