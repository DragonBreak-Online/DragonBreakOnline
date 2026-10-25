// "Make it harder to become a werewolf and vampire" (Nat, 25 Oct). Loads the real supernatural.js with the real
// gamemode-config.json against a stub api, its clocks and timers under the harness's control, and checks:
//   - the bite chances come from the config (infectVampire 0.01, infectWerewolf 0.005);
//   - a peaked fever opens its rite (rite.feverTrial) for a client that judges its own strikes, with the config's
//     rounds and need; passing it turns the carrier; failing it, however it is lost, cures them through cureDisease
//     (the disease, Sanguinare, the fever's debuffs), tells them, is audited, kills nobody and is never offered again;
//   - a client that cannot judge its own strikes, or feverTrial false, turns with no trial (lag never decides it);
//   - a rite never touched is still abandoned (the fever stays and the rite comes again), and the shrine rites keep
//     their own need and their death.
//   node tests/supernatural-harder-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'supernatural.js');
const CONFIG = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'gamemode-config.json'), 'utf8'));
// supernatural.js keeps the Blood Crown in supernatural.json in the working directory: run in a temp dir
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'super-harder-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let clock = 1780000000000, mono = 5000000;
Date.now = () => clock;
globalThis.performance = { now: () => mono };
const advance = (ms) => { clock += ms; mono += ms; };
const pending = new Map(); let timerSeq = 0;
globalThis.setTimeout = (fn, ms) => { const id = ++timerSeq; pending.set(id, { fn, at: clock + ms }); return id; };
globalThis.clearTimeout = (id) => { pending.delete(id); };
const GAME_DAY_MS = 4 * 3600000; const clockStart = clock;
globalThis.__dboClock = { gameDays: () => (clock - clockStart) / GAME_DAY_MS, isNight: () => false, weatherFor: () => 0 };

const store = new Map();
const logs = [], audits = [], said = [], widgets = [], papyrus = [];
const cmds = {}, ui = {}, timers = {};
const caps = new Set();
const mp = {
  get: (id, p) => store.get(`${id}|${p}`),
  set: (id, p, v) => { store.set(`${id}|${p}`, v); },
  getDescFromId: (id) => `${id.toString(16)}:x`, getIdFromDesc: () => 0x1234,
  callPapyrusFunction: (kind, cls, method, self, args) => { papyrus.push({ method, args }); return null; },
  lookupEspmRecordById: () => null,
};
let cfg = CONFIG;
let online = [];
let feverEndedFor = [];
const load = () => {
  delete require.cache[MODULE];
  require(MODULE)({
    mp, log: (...x) => logs.push(x.join(' ')), audit: (t) => audits.push(t), personal: (a, t) => said.push(t), registerChatCommand: (n, f) => { cmds[n] = f; },
    onUi: (n, f) => { ui[n] = f; }, openWidget: (a, w) => { widgets.push(w); return true; }, closeWidget: () => true, sendPacket: () => {}, display: String, who: String,
    isAdmin: () => false, findByName: () => null, onlineActors: () => online, every: (n, ms, fn) => { timers[n] = fn; }, profileOf: (a) => a,
    nameOf: String, isWorldspace: () => true, needsFeed: () => {}, hungerOf: () => 0, cfg, hasUiCap: (a, c) => caps.has(c),
  });
  // Every fever effect comes off through feverEnded (the debuffs); count who it ran for
  const real = globalThis.__dboFeverEnded;
  globalThis.__dboFeverEnded = (a) => { feverEndedFor.push(a); return real(a); };
};
load();

let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + (typeof got === 'string' ? got : JSON.stringify(got)) : ''}`); if (!c) fail++; };
const A = 7, B = 8;
const S = CONFIG.supernatural, R = S.rite;
const rite = () => globalThis.__dboRites.get(A);
const st = (a = A) => store.get(`${a}|private.supernatural`) || {};
const lastW = () => widgets[widgets.length - 1];
const dead = () => store.get(`${A}|isDead`) === true;
const reset = (kind, played) => {
  store.clear(); globalThis.__dboRites.clear(); pending.clear();
  logs.length = 0; audits.length = 0; said.length = 0; widgets.length = 0; papyrus.length = 0; feverEndedFor = [];
  store.set(`${A}|isDead`, false);
  store.set(`${A}|private.supernatural`, { kind: null, disease: kind ? { kind, since: 0, played, by: '' } : null });
  globalThis.__dboConnectedAt = new Map([[A, clock - 3600000]]);
  online = [A];
};
// A fever's debuffs as feverTick leaves them (super-fever-debuffs-harness), so their coming off can be seen
const debuffed = () => globalThis.__dboFeverApplied.set(A, { key: 'vampire:3:d', magicka: 1, at: clock, shakeAt: clock });
const tick = () => { advance(15000); timers.superSlow(); };
// A pick rite's choice: [nonce, round, rnonce, 'pick', index, atMs]; 400 ms after the round went out on both clocks
const pick = (right) => {
  const r = rite(); const rd = r.current;
  advance(400);
  ui.riteStrike(A, [r.nonce, r.round + 1, rd.rnonce, 'pick', right ? rd.right : (rd.right + 1) % rd.spots.length, 400]);
};
const sanguinareRemoved = () => papyrus.some((p) => p.method === 'RemoveSpell');

// ---- the config's numbers --------------------------------------------------------------------------------------
ok(S.infectVampire === 0.01 && S.infectWerewolf === 0.005, 'the config holds a vampire\'s hit at 1% and a werewolf\'s bite at 0.5%', [S.infectVampire, S.infectWerewolf]);
ok(typeof S._infectVampire === 'string' && /25 Oct/.test(S._infectVampire) && /0\.03/.test(S._infectVampire), 'infectVampire\'s comment records Nat\'s 25 Oct decision and the 0.03 rollback');
ok(typeof S._infectWerewolf === 'string' && /25 Oct/.test(S._infectWerewolf) && /0\.01/.test(S._infectWerewolf), 'infectWerewolf\'s comment records Nat\'s 25 Oct decision and the 0.01 rollback');
ok(R.feverTrial === true && Number(R.rounds) > 5 && Number(R.needFever) > 3 && Number(R.needVoluntary) > 4, 'the rite block opens the fever trial with more rounds and higher needs', R);
ok(R.rounds - R.needFever === 2 && R.rounds - R.needVoluntary === 1, 'the misses allowed are today\'s (2 for a fever, 1 at a shrine): harder by rounds and need', [R.rounds, R.needFever, R.needVoluntary]);
ok(R.graceMs === 100 && R.lateWindowMs === 250 && R.earlyWindowMs === 160 && R.legacyExtraMs === 2500 && R.clientJudged === true, 'the lag windows are untouched');

// ---- the chances are read from the config ----------------------------------------------------------------------
{
  const realRandom = Math.random;
  const hit = (agg, roll) => { store.set(`${B}|private.supernatural`, { kind: null, disease: null }); Math.random = () => roll; try { globalThis.__dboSuperHit(agg, B); } finally { Math.random = realRandom; } return (st(B).disease || {}).kind || null; };
  reset(null);
  store.set(`${A}|private.supernatural`, { kind: 'vampire', stage: 1 });
  ok(hit(A, 0.0099) === 'vampire', 'a vampire\'s hit rolling 0.0099 infects (1%)');
  ok(hit(A, 0.0101) === null, 'a vampire\'s hit rolling 0.0101 does not (it did at 3%)');
  store.set(`${A}|private.supernatural`, { kind: 'werewolf' }); store.set(`${A}|private.beast`, { form: 'werewolf' });
  ok(hit(A, 0.0049) === 'werewolf', 'a werewolf\'s bite rolling 0.0049 infects (0.5%)');
  ok(hit(A, 0.0051) === null, 'a werewolf\'s bite rolling 0.0051 does not (it did at 1%)');
  store.delete(`${A}|private.beast`);
}

// ---- a failed fever rite cures, tells, is audited, kills nobody, and never comes back ---------------------------
caps.add('riteJudge'); caps.add('pickRound');
reset('vampire', 3); debuffed();
tick();
ok(rite() && rite().type === 'fever_vampire' && rite().pick, 'a peaked vampire fever opens the Blood Fever (a pick rite) instead of turning', st());
ok(lastW() && lastW().rounds === R.rounds && lastW().need === R.needFever, `the widget says ${R.rounds} rounds, ${R.needFever} needed`, lastW() && [lastW().rounds, lastW().need]);
for (let i = 0; i < 3 && rite(); i++) pick(false);
ok(!rite(), 'three wrong marks lose it (only two misses are allowed)');
ok(!st().disease && st().kind === null, 'the fever is gone and the carrier is mortal', st());
ok(Number(st().lastCure) > 0, 'it went through cureDisease (lastCure stamped, as a potion or a prayer)');
ok(feverEndedFor.includes(A) && !globalThis.__dboFeverApplied.has(A), 'every fever debuff came off (feverEnded ran)');
ok(sanguinareRemoved(), 'Sanguinare Vampiris was taken off');
ok(said.includes('The fever breaks. Whatever was in your blood is gone.'), 'the player is told: "The fever breaks. Whatever was in your blood is gone."', said);
ok(audits.some((t) => /^RITE 7 failed The Blood Fever at 0 of \d+ needed in \d+: the fever broke, cured, no death$/.test(t)), 'the failure is audited', audits);
ok(!dead(), 'the failure kills nobody (it used to)');
for (let i = 0; i < 4; i++) tick();
ok(!rite() && !st().kind, 'no second try: later ticks open nothing and turn nothing', st());

// ---- the other ways to lose cure the same way -------------------------------------------------------------------
reset('werewolf', 3); tick();
pick(false); ui.riteClose(A);
ok(!rite() && !st().disease && !st().kind && !dead() && said.includes('The fever breaks. Whatever was in your blood is gone.'), 'closing Hircine\'s Hunt after a round loses it: cured, alive', st());
reset('vampire', 3); tick();
pick(false); pick(false); pick(true);
globalThis.__dboSuperLeave(A);
ok(!rite() && !st().disease && !st().kind && !dead(), 'a disconnect while behind loses it: cured, no death', st());
ok(audits.some((t) => /behind: lost/.test(t)) && audits.some((t) => /failed The Blood Fever .*cured, no death/.test(t)), '...and both the disconnect and the cure are audited', audits);
reset('vampire', 3); tick();
pick(true); globalThis.__dboSuperLeave(A);
ok(!rite() && st().disease && st().disease.kind === 'vampire' && !dead(), 'a disconnect while even or ahead is cancelled (a crash is not a failure): the fever stays', st());

// ---- a passed fever rite still turns ------------------------------------------------------------------------------
reset('vampire', 3); debuffed(); tick();
for (let i = 0; i < R.needFever && rite(); i++) pick(true);
ok(!rite() && st().kind === 'vampire' && !st().disease && !dead(), `${R.needFever} true marks survive the Blood Fever: a vampire`, st());
ok(!globalThis.__dboFeverApplied.has(A), 'and the fever\'s debuffs came off with the turning');
ok(!audits.some((t) => /cured, no death/.test(t)), 'no cure is audited for a pass');
reset('werewolf', 3); tick();
pick(false); pick(true); pick(false);
for (let i = 0; i < R.needFever && rite(); i++) pick(true);
ok(!rite() && st().kind === 'werewolf' && !st().disease && !dead(), 'two misses still survive Hircine\'s Hunt: a werewolf', st());

// ---- untouched, it is abandoned and comes again (a client fault is not a failure) --------------------------------
reset('vampire', 3); tick();
ui.riteClose(A);
ok(!rite() && st().disease && st().disease.kind === 'vampire' && !st().kind, 'a rite closed before any round is abandoned: the fever stays', st());
tick();
ok(rite() && rite().type === 'fever_vampire', 'and opens again on a later tick');

// ---- lag never decides it: a client that cannot judge itself, or the switch off, turns with no trial ---------------
caps.clear();
reset('vampire', 3); tick();
ok(!rite() && st().kind === 'vampire' && !st().disease, 'a client without riteJudge turns at the peak, with no trial', st());
caps.add('riteJudge'); caps.add('pickRound');
cfg = JSON.parse(JSON.stringify(CONFIG)); cfg.supernatural.rite.feverTrial = false; load();
reset('werewolf', 3); tick();
ok(!rite() && st().kind === 'werewolf' && !st().disease, 'feverTrial false: the peak turns with no trial (the 18 Oct rule, the rollback)', st());
cfg = CONFIG; load();

// ---- the shrine rites keep their need and their death ---------------------------------------------------------------
reset(null);
globalThis.__dboPrayerLastShrine = new Map([[A, { deityId: 'molagbal', at: Date.now() }]]);
cmds.rite(A, ''); cmds.rite(A, 'confirm');
ok(rite() && rite().type === 'embrace' && lastW().need === R.needVoluntary && lastW().rounds === R.rounds, `Molag Bal's Embrace needs ${R.needVoluntary} of ${R.rounds}`, lastW() && [lastW().need, lastW().rounds]);
{
  const realRandom = Math.random; Math.random = () => 0.99;   // no permadeath roll
  try { pick(false); pick(false); } finally { Math.random = realRandom; }
}
ok(!rite() && dead() && !st().kind, 'two misses fail the Embrace, and it still kills', st());

// The potion, ingredient and prayer cures are super-cure-paths-harness's and super-fever-prayer-harness's; beast form's
// are the beast-*-harnesses'. They run with this change unchanged.

console.log(fail ? `${fail} FAILED` : 'all checks passed');
process.exit(fail ? 1 : 0);
