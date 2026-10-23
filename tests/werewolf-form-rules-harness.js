// Werewolf form rules (Nate, 23 Oct: a Jarl changed in a crowd and was himself again 6 s later; "people cant leave form
// instantly ... leave them in form longer ... people cant auto transform"). Loads the real supernatural.js, greathunt.js and
// beastform.js with this branch's gamemode-config.json and checks:
//   1. no revert by choice (Revert Form, the power relay, /beast) before beastform.werewolf.minSeconds, the player told how
//      long is left; death, logout, login, staff and the time running out still end it at once; Vampire Lords are not held
//   2. the change lasts greatHunt.beastSeconds by rank (300 for a Fledgling, 600 for an Elder; 300 without the Hunt)
//   3. a cursed werewolf's own call of the beast is refused (supernatural.voluntaryWerewolf false); forced and staff changes,
//      a pack's Alpha, Hircine's blessed, a GM grant, an admin and a carried rest still change
//   node tests/werewolf-form-rules-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'tests', '.run-werewolf-form-rules');
fs.mkdirSync(RUN, { recursive: true });
process.chdir(RUN);
process.on('exit', () => { try { fs.rmSync(RUN, { recursive: true, force: true }); } catch (e) { /* left behind */ } });

let now = 1790000000000;
Date.now = () => now;
global.setTimeout = () => 0;
const WOLF = 0xff000001, ALPHA = 0xff000002, BLESSED = 0xff000003, GRANTED = 0xff000004, ADMIN = 0xff000005, LORD = 0xff000006, ELDER = 0xff000007;
const ALL = [WOLF, ALPHA, BLESSED, GRANTED, ADMIN, LORD, ELDER];
const props = new Map();
const ids = new Map();
const idFor = (d) => { d = String(d).toLowerCase(); if (!ids.has(d)) ids.set(d, 0x1000 + ids.size); return ids.get(d); };
const mp = {
  get: (id, k) => (k === 'type' ? 'MpActor' : props.get(`${id}|${k}`)),
  set: (id, k, v) => props.set(`${id}|${k}`, v),
  getIdFromDesc: idFor,
  getDescFromId: (id) => id.toString(16),
  callPapyrusFunction: () => true,
  lookupEspmRecordById: () => null,
};
const noop = () => {};
const said = [], packets = [], commands = new Map(), ticks = new Map();
let day = 30.1;
globalThis.__dboClock = { gameDays: () => day, summary: () => ({ timeScale: 6 }), isNight: () => false, isFullMoon: () => false };
globalThis.__dboGuildIsPackLeader = (a) => (a >>> 0) === ALPHA;
globalThis.__dboBeastPowers = undefined;
delete globalThis.__dboSuperState; delete globalThis.__dboGreatHunt;
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const api = (cfg) => ({
  mp, log: noop, audit: noop, personal: (a, t) => said.push({ a, t }), registerChatCommand: (n, f) => commands.set(n, f),
  onUi: noop, openWidget: noop, closeWidget: noop, sendPacket: (a, p) => packets.push({ a, p }), display: String, who: String,
  isAdmin: (a) => (a >>> 0) === ADMIN, findByName: (n) => (n === 'wolf' ? WOLF : null), onlineActors: () => ALL,
  every: (n, ms, f) => ticks.set(n, f), redress: noop, profileOf: (a) => a, nameOf: String, isWorldspace: () => true,
  needsFeed: noop, hungerOf: () => 0, zoneOfActor: () => null, zoneById: () => null, cfg,
});
const load = (cfg, files) => { for (const f of files) { const p = path.join(ROOT, f); delete require.cache[p]; require(p)(api(cfg)); } };
load(CONFIG, ['supernatural.js', 'greathunt.js', 'beastform.js']);

let pass = 0, fail = 0;
const ok = (c, what, detail) => { if (c) { pass++; console.log('ok  ', what); } else { fail++; console.log('FAIL', what, detail !== undefined ? JSON.stringify(detail) : ''); } };
const reset = () => {
  for (const a of ALL) { props.set(`${a}|appearance`, { raceId: 0x13745, name: 'Uhtred' }); props.set(`${a}|private.beast`, null); props.set(`${a}|private.beastCarry`, null); }
  props.set(`${WOLF}|private.supernatural`, { kind: 'werewolf', stage: 0, blessed: false, beastDay: -1 });
  props.set(`${ELDER}|private.supernatural`, { kind: 'werewolf', stage: 0, blessed: false, beastDay: -1 });
  props.set(`${ELDER}|private.greatHunt`, { renown: 5000, fedOn: {} });
  props.set(`${ALPHA}|private.supernatural`, { kind: 'werewolf', stage: 0, blessed: false, beastDay: -1 });
  props.set(`${BLESSED}|private.supernatural`, { kind: 'werewolf', stage: 0, blessed: true, beastDay: -1 });
  props.set(`${ADMIN}|private.supernatural`, { kind: 'werewolf', stage: 0, blessed: false, beastDay: -1 });
  props.set(`${GRANTED}|private.werewolfGrant`, true);
  props.set(`${LORD}|private.vampireLordGrant`, true);
};
reset();
const POWER = idFor('92c48:Skyrim.esm'), LORD_POWER = idFor('283a:Dawnguard.esm') && idFor('283b:Dawnguard.esm'), REVERT = idFor('cd5c:Dawnguard.esm');
const beast = (a) => props.get(`${a}|private.beast`);
const told = (a, from) => said.slice(from).filter((x) => x.a === a).map((x) => x.t);
const banners = (a, from) => packets.slice(from).filter((x) => x.a === a && x.p.customPacketType === 'dboBanner').map((x) => x.p.text);
const length = (a) => Math.round((beast(a).until - beast(a).at) / 1000);
const W = (CONFIG.beastform || {}).werewolf || {};
ok(Number(W.minSeconds) === 240 && Number(W.seconds) === 300, 'config: beastform.werewolf minSeconds 240, seconds 300', W);
ok(JSON.stringify((CONFIG.greatHunt || {}).beastSeconds) === '[300,360,420,480,600]', 'config: greatHunt.beastSeconds about double the old 150..300', (CONFIG.greatHunt || {}).beastSeconds);
ok((CONFIG.supernatural || {}).voluntaryWerewolf === false && (CONFIG.supernatural || {}).voluntaryWhenSpared === true, 'config: voluntaryWerewolf false, voluntaryWhenSpared true');

// ── 3. no transforming at will ────────────────────────────────────────────────────────────────────────────────────
let s = said.length, p = packets.length;
globalThis.__dboBeastCast(WOLF, POWER);
ok(!beast(WOLF), 'a cursed werewolf casting Beast Form stays mortal');
ok(told(WOLF, s).some((t) => /cannot be called/.test(t)) && banners(WOLF, p).some((t) => /cannot be called/.test(t)), 'and is told on screen and in chat that the beast comes when it will', told(WOLF, s));
ok(!packets.slice(p).some((x) => x.a === WOLF && x.p.customPacketType === 'dboBeast'), 'no dboBeast is sent, so the client clears its own half-change (beastFormService requestBeast)');
ok(!((props.get(`${WOLF}|private.supernatural`) || {}).beastDayUses), 'a refused call spends no daily change');
globalThis.__dboBeastRequest(WOLF, POWER);
ok(!beast(WOLF), 'the client relay (dboBeastRequest) is refused the same way');
commands.get('beast')(WOLF, '');
ok(!beast(WOLF), '/beast is refused the same way');
ok(globalThis.__dboBeastChangesLeft(WOLF) === null, 'no changes by choice to count (no "type /beast" line after a revert)');
ok(globalThis.__dboBeastTransform(WOLF, 'werewolf', true) === true && beast(WOLF), 'a forced change (feral, full moon) still turns them');
globalThis.__dboBeastRevert(WOLF, 'death');
ok(/took/.test(globalThis.__dboBeastAdmin(WOLF, 'werewolf', 'now')) && beast(WOLF), 'the admin panel still turns them');
globalThis.__dboBeastRevert(WOLF, 'death');
s = said.length; commands.get('beastform')(ADMIN, 'wolf werewolf now');
ok(beast(WOLF) && told(ADMIN, s).some((t) => /transformed/.test(t)), '/beastform <player> werewolf now still turns them');
globalThis.__dboBeastRevert(WOLF, 'death');
globalThis.__dboBeastCast(ALPHA, POWER);
ok(beast(ALPHA), "a pack's Alpha (never forced) still calls the beast");
globalThis.__dboBeastCast(BLESSED, POWER);
ok(beast(BLESSED), "Hircine's blessed (never forced) still calls the beast");
globalThis.__dboBeastCast(GRANTED, POWER);
ok(beast(GRANTED), "a mortal with a GM's grant still changes");
globalThis.__dboBeastCast(ADMIN, POWER);
ok(beast(ADMIN), 'an admin still changes');
props.set(`${WOLF}|private.beastCarry`, { form: 'werewolf', seconds: 100, at: now, day: Math.floor(day) });
globalThis.__dboBeastCast(WOLF, POWER);
ok(beast(WOLF) && length(WOLF) === 100, 'the rest of a change a crash or logout cut short may be taken back (100 s kept)', beast(WOLF) && length(WOLF));

// ── 1. no early revert by choice ──────────────────────────────────────────────────────────────────────────────────
ok(globalThis.__dboBeastRevertLockLeft(WOLF) === 100, 'the hold never runs past the end of a short (carried) change', globalThis.__dboBeastRevertLockLeft(WOLF));
globalThis.__dboBeastRevert(WOLF, 'death');
s = said.length;
globalThis.__dboBeastTransform(WOLF, 'werewolf', true);
ok(told(WOLF, s).some((t) => /for 300 seconds\. You cannot turn back for the first 240\./.test(t)), 'the change says how long it lasts and how long it holds', told(WOLF, s));
now += 6000;
s = said.length; p = packets.length;
globalThis.__dboBeastCast(WOLF, REVERT);
ok(beast(WOLF), 'Revert Form 6 s in is refused');
ok(told(WOLF, s).some((t) => /turn back in 234 seconds/.test(t)) && banners(WOLF, p).some((t) => /234 seconds/.test(t)), 'and the player is told 234 seconds are left', told(WOLF, s));
globalThis.__dboBeastPower(WOLF, REVERT);
ok(beast(WOLF), 'Revert Form on the Shout key (dboBeastPower) is refused');
s = said.length;
commands.get('beast')(WOLF, 'revert');
ok(beast(WOLF) && told(WOLF, s).some((t) => /turn back in/.test(t)), '/beast revert is refused');
commands.get('beast')(WOLF, '');
ok(beast(WOLF), '/beast with no word is refused too');
const b = beast(WOLF); b.until += 30000; props.set(`${WOLF}|private.beast`, b);
ok(globalThis.__dboBeastRevertLockLeft(WOLF) === 234, 'a feed lengthens the change but not the hold', globalThis.__dboBeastRevertLockLeft(WOLF));
s = said.length;
commands.get('beast')(ADMIN, 'revert');
ok(told(ADMIN, s).length === 1, 'nothing to revert for someone not in a form');
now += 234000;
globalThis.__dboBeastCast(WOLF, REVERT);
ok(!beast(WOLF), 'Revert Form after 240 s ends the form');
for (const [why, run] of [
  ['death', () => globalThis.__dboBeastRevert(WOLF, 'death')],
  ['logout', () => globalThis.__dboBeastRevert(WOLF, 'logout')],
  ['login', () => globalThis.__dboBeastRevert(WOLF, 'login')],
  ['the admin panel', () => globalThis.__dboBeastAdmin(WOLF, 'werewolf', 'revert')],
  ['/beastform <player> werewolf revert', () => commands.get('beastform')(ADMIN, 'wolf werewolf revert')],
  ['a staff hook (__dboBeastRevert from GM tools)', () => globalThis.__dboBeastRevert(WOLF, 'reverted by GM')],
  ['the power being taken back', () => globalThis.__dboBeastAdmin(WOLF, 'werewolf', 'revoke')],
]) {
  props.set(`${WOLF}|private.beastCarry`, null);
  globalThis.__dboBeastTransform(WOLF, 'werewolf', true);
  now += 2000;
  run();
  ok(!beast(WOLF), `${why} 2 s in still reverts at once`);
}
globalThis.__dboBeastTransform(WOLF, 'werewolf', true);
now += 300000;
ticks.get('beastForms')();
ok(!beast(WOLF), 'the time running out reverts');
globalThis.__dboBeastTransform(LORD, 'vampirelord');
now += 1000;
globalThis.__dboBeastCast(LORD, REVERT);
ok(!beast(LORD), 'a Vampire Lord is not held: Revert Form 1 s in works');
ok(globalThis.__dboBeastRevertLockLeft(LORD) === 0, 'and has no hold');

// ── 2. a longer form ──────────────────────────────────────────────────────────────────────────────────────────────
reset();
globalThis.__dboBeastTransform(WOLF, 'werewolf', true);
ok(length(WOLF) === 300, 'a Fledgling\'s change lasts 300 s (was 150)', length(WOLF));
globalThis.__dboBeastTransform(ELDER, 'werewolf', true);
ok(length(ELDER) === 600, "an Elder's lasts 600 s (was 300)", length(ELDER));
const v = globalThis.__dboSuperProgress(WOLF);
const row = (label) => v && v.rows.find((r) => r.label === label);
ok(row('Beast form') && row('Beast form').value === 'When it takes you', 'the K tab says the beast comes when it will', row('Beast form'));
ok(row('In the beast') && /cannot turn back for another 240 s/.test(row('In the beast').hint), 'and how long the hold has left', row('In the beast'));

// ── the rollbacks ─────────────────────────────────────────────────────────────────────────────────────────────────
reset();
const roll = JSON.parse(JSON.stringify(CONFIG));
roll.supernatural.voluntaryWerewolf = true; roll.beastform.werewolf.minSeconds = 0; delete roll.greatHunt.beastSeconds;
load(roll, ['supernatural.js', 'greathunt.js', 'beastform.js']);
globalThis.__dboBeastCast(WOLF, POWER);
ok(beast(WOLF) && length(WOLF) === 150, 'rollback: voluntaryWerewolf true lets them call it, and the Hunt defaults give back 150 s', beast(WOLF) && length(WOLF));
now += 1000;
globalThis.__dboBeastCast(WOLF, REVERT);
ok(!beast(WOLF), 'rollback: minSeconds 0 lets them revert at once');
const noSpare = JSON.parse(JSON.stringify(CONFIG));
noSpare.supernatural.voluntaryWhenSpared = false;
load(noSpare, ['supernatural.js']);
globalThis.__dboBeastCast(ALPHA, POWER);
ok(!beast(ALPHA), 'voluntaryWhenSpared false refuses the Alpha as well');
const noHunt = JSON.parse(JSON.stringify(CONFIG));
for (const k of Object.keys(globalThis)) if (/^__dboHunt/.test(k)) delete globalThis[k];
load(noHunt, ['supernatural.js', 'beastform.js']);
globalThis.__dboBeastTransform(ELDER, 'werewolf', true);
ok(length(ELDER) === 300, 'without greathunt.js a change lasts beastform.werewolf.seconds (300)', length(ELDER));

for (const f of ['beastform.js', 'supernatural.js']) ok(!/—/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `no em dash in ${f}`);
console.log(fail ? `\n${fail} FAILED` : `\nall ${pass} checks passed`);
process.exit(fail ? 1 : 0);
