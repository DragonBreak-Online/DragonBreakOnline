// The werewolf frenzy (frenzy.js; Nate, 23 Oct). Real module, stub world. Run from server\:
//   node tests/frenzy-harness.js
'use strict';
const path = require('path');
const fs = require('fs');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, name, got) => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); };

const W = 0xff000101, P1 = 0xff000102, STAFF = 0xff000103, MATE = 0xff000104, FAR = 0xff000105, NEWB = 0xff000106, DUEL = 0xff000107, SAFE = 0xff000108;
const N1 = 0xff100001, N2 = 0xff100002, PET = 0xff100003, NFAR = 0xff100004;
const UNITS = 70;
// Positions in metres along one axis
const pos = new Map();
const reset = () => {
  pos.clear();
  for (const [id, m] of [[W, 0], [P1, 8], [STAFF, 2], [MATE, 3], [FAR, 200], [NEWB, 4], [DUEL, 5], [SAFE, 6], [N1, 12], [N2, 20], [PET, 1], [NFAR, 300]]) pos.set(id, m);
};
const players = new Set([W, P1, STAFF, MATE, FAR, NEWB, DUEL, SAFE]);
const onlineSet = new Set(players);
const deadSet = new Set(), downedSet = new Set();
const props = new Map();
const setProp = (id, k, v) => props.set(`${id}:${k}`, v);
const mp = {
  get: (id, k) => {
    if (k === 'pos') return [(pos.get(id) ?? 99999) * UNITS, 0, 0];
    if (k === 'worldOrCellDesc') return 'a764b:BSHeartland.esm';
    if (k === 'isDead') return deadSet.has(id) || downedSet.has(id);
    if (k === 'actorNeighbors') return [N1, N2, PET, NFAR, P1, STAFF];
    return props.get(`${id}:${k}`);
  },
  set: () => {},
  onHitDamageAttempt: null, onDeath: null,
};
const said = [], audits = [], packets = [], timers = [], cmds = new Map(), refreshed = [];
let hitsSeen = 0, deathsSeen = 0;
globalThis.__dboIsDowned = (a) => downedSet.has(a);
globalThis.__dboPartyLeaderOf = (a) => (a === W || a === MATE ? W : null);
globalThis.__dboInDuel = (a) => a === DUEL;
globalThis.__dboNeedsRefresh = (a) => refreshed.push(a);
const outlawCalls = [];
globalThis.__dboOutlaws = { data: { zones: { bruma: { [String(1)]: { amount: 50 } } } } };
globalThis.__dboOutlawDeclare = (...a) => { outlawCalls.push(a); return true; };
const load = (cfg) => {
  delete globalThis.__dboFrenzy;
  timers.length = 0; packets.length = 0;
  mp.onHitDamageAttempt = function () { hitsSeen++; return true; };
  mp.onDeath = function () { deathsSeen++; };
  delete require.cache[path.join(SERVER, 'frenzy.js')];
  require(path.join(SERVER, 'frenzy.js'))({ mp, log: () => {}, personal: (a, t) => { said.push([a, t]); }, sendPacket: (a, p) => packets.push([a, p]),
    audit: (t) => audits.push(t), who: (a) => `#${a.toString(16)}`, display: (a) => `A${a.toString(16)}`,
    profileOf: (a) => (players.has(a) ? (a === W ? 1 : a & 0xff) : -1), onlineActors: () => [...onlineSet],
    every: (n, ms, fn) => timers.push(fn), registerChatCommand: (n, fn) => cmds.set(n, fn), cfg: { werewolfFrenzy: Object.assign({ safeZones: [{ world: 'a764b:BSHeartland.esm', pos: [6 * UNITS, 0, 0], radius: 0.5 * UNITS }] }, cfg || {}) },
    isAdmin: (a) => a === STAFF, isLeadStaff: (a) => a === STAFF, findByName: (n) => (n === 'wolf' ? W : null), zoneOfActor: () => 'bruma', ownNameOf: () => 'Wolfie',
    inEditor: () => false, creationPending: (a) => a === NEWB, inLoginGrace: () => false });
};
const tick = () => timers.forEach((f) => f());
const lastFrenzy = () => { const l = packets.filter(([a, p]) => a === W && p.customPacketType === 'dboFrenzy'); return l.length ? l[l.length - 1][1] : null; };
const wolf = () => setProp(W, 'private.beast', { form: 'werewolf', original: {} });

(async () => {
  // ---- switch off: a forced change never frenzies
  reset(); wolf(); load({ enabled: false, chance: 1 });
  ok(globalThis.__dboFrenzyForced(W) === false, 'switch off: a forced change never tips into a frenzy');
  ok(typeof mp.onHitDamageAttempt === 'function' && mp.onHitDamageAttempt.__dboFrenzy, 'the hit hook is wrapped (idle while no frenzy runs)');

  // ---- chance and start
  load({ enabled: true, chance: 0, startDelaySeconds: 0 });
  ok(globalThis.__dboFrenzyForced(W) === false, 'chance 0: no frenzy');
  load({ enabled: true, chance: 1, startDelaySeconds: 0, minSeconds: 20, maxSeconds: 30 });
  ok(globalThis.__dboFrenzyForced(W) === true, 'chance 1: the forced change tips into a frenzy');
  await new Promise((r) => setTimeout(r, 10));
  ok(globalThis.__dboFrenzyActive(W), 'the frenzy is running');
  let f = lastFrenzy();
  // PET belongs to nobody yet, so it is the nearest NPC (1 m)
  ok(f && f.on === true && f.target === PET && f.seconds >= 20 && f.seconds <= 30 && Array.isArray(f.disable), 'the client is told: on, the nearest target, 20-30 s, the control flags', f);
  ok(globalThis.__dboFrenzyForced(W) === false, 'cooldown: a second forced change does not frenzy again');
  globalThis.__dboFrenzyEnd(W, 'test');

  // ---- target choice and exclusions
  load({ enabled: true, chance: 1, startDelaySeconds: 0 });
  setProp(PET, 'ff_companionOf', W);
  cmds.get('frenzy')(STAFF, 'wolf start');
  f = lastFrenzy();
  // STAFF (2 m), MATE (3 m, party), NEWB (4 m, being made), DUEL (5 m), SAFE (6 m, in a safe zone) are all closer than P1 (8 m)
  ok(f && f.target === P1, 'the own companion, staff, the party, a character being made, a duellist and a safe zone are skipped: P1 at 8 m', f && f.target.toString(16));
  ok(audits.some((t) => /^FRENZY #ff000101 for \d+ s, first on #ff000102 \(GM/.test(t)), 'staff start is audited', audits.slice(-1));
  // the client answers
  globalThis.__dboFrenzyReport(W, { phase: 'on' });
  // P1 goes down: the next target is the nearest NPC (N1 at 12 m)
  downedSet.add(P1); tick();
  f = lastFrenzy();
  ok(f.target === N1, 'a downed target: the werewolf turns on the next one', f.target.toString(16));
  // the client cannot find N1: skipped, N2 next
  globalThis.__dboFrenzyReport(W, { phase: 'miss', target: N1 });
  ok(lastFrenzy().target === N2, 'a target the client cannot find is skipped');
  // out of range: N2 walks off, nothing else in reach -> the frenzy ends
  pos.set(N2, 100); pos.set(N1, 100); tick();
  ok(!globalThis.__dboFrenzyActive(W) && lastFrenzy().on === false, 'no target left in range: the frenzy ends and the client is released');
  ok(audits.some((t) => /FRENZY end #ff000101: no target left/.test(t)), 'the end is audited with its reason');
  // exhaustion: stamina recovery slowed, others untouched
  ok(globalThis.__dboFrenzyRateMult(W, 'StaminaRateMult') === 0.3 && globalThis.__dboFrenzyRateMult(W, 'HealRateMult') === 1 && globalThis.__dboFrenzyRateMult(P1, 'StaminaRateMult') === 1, 'afterwards: stamina recovery x0.3 for the werewolf only');
  ok(refreshed.includes(W), 'the needs system is asked to apply it at once');
  downedSet.clear(); reset();

  // ---- non-lethal: no finishing, excluded players spared, NPCs and valid players pass to the normal checks
  load({ enabled: true });
  setProp(PET, 'ff_companionOf', 0);
  cmds.get('frenzy')(STAFF, 'wolf start');
  globalThis.__dboFrenzyReport(W, { phase: 'on' });
  hitsSeen = 0;
  ok(mp.onHitDamageAttempt(W, N1, 0, 10) === true && hitsSeen === 1, 'a hit on an NPC goes through the normal checks');
  ok(mp.onHitDamageAttempt(W, P1, 0, 10) === true && hitsSeen === 2, 'a hit on a valid player goes through the normal checks');
  downedSet.add(P1);
  ok(mp.onHitDamageAttempt(W, P1, 0, 10) === false && globalThis.__dboHitRefusal === 'frenzy_downed' && hitsSeen === 2, 'a fallen player is never finished by the frenzied werewolf');
  downedSet.delete(P1);
  ok(mp.onHitDamageAttempt(W, STAFF, 0, 10) === false && globalThis.__dboHitRefusal === 'frenzy_spared', 'staff are never hit');
  ok(mp.onHitDamageAttempt(W, MATE, 0, 10) === false, 'a party member is spared (sparePartyMembers)');
  ok(mp.onHitDamageAttempt(P1, W, 0, 10) === true, 'others hitting the werewolf are untouched');

  // ---- bounty: a player downed by the frenzied werewolf; exposure.js decides when loaded
  outlawCalls.length = 0;
  mp.onDeath(P1, W);
  ok(outlawCalls.length === 1 && outlawCalls[0][0] === 'bruma' && outlawCalls[0][1] === 1 && outlawCalls[0][2] === 150 && outlawCalls[0][4] === 'Wolfie', 'no exposure.js: bounty 100 added to the 50 already set in the hold (outlaws.js)', outlawCalls);
  mp.onDeath(P1, W);
  ok(outlawCalls.length === 1, 'the same victim counts once per frenzy');
  const exp = [];
  globalThis.__dboExposureBounty = (w, v, why) => { exp.push([w, v, why]); return false; };
  mp.onDeath(MATE, W);
  ok(exp.length === 1 && exp[0][0] === W && exp[0][1] === MATE && outlawCalls.length === 1, 'exposure.js loaded: it decides, and a false is never overridden by the fallback');
  delete globalThis.__dboExposureBounty;
  mp.onDeath(N1, W);
  ok(outlawCalls.length === 1, 'an NPC kill sets no bounty');
  ok(deathsSeen >= 4, 'the inner death hook still runs');

  // ---- end conditions
  mp.onDeath(W, N2);
  ok(!globalThis.__dboFrenzyActive(W), 'the werewolf dies or falls: the frenzy ends');
  load({ enabled: true });
  cmds.get('frenzy')(STAFF, 'wolf start'); globalThis.__dboFrenzyReport(W, { phase: 'on' });
  setProp(W, 'private.beast', null); tick();
  ok(!globalThis.__dboFrenzyActive(W) && lastFrenzy().on === false, 'out of the beast (a staff revert): the frenzy ends');
  wolf();
  load({ enabled: true });
  cmds.get('frenzy')(STAFF, 'wolf start'); globalThis.__dboFrenzyReport(W, { phase: 'on' });
  globalThis.__dboFrenzy.active.get(W).until = Date.now() - 1; tick();
  ok(!globalThis.__dboFrenzyActive(W) && audits.some((t) => /FRENZY end #ff000101: time/.test(t)), 'the time runs out: the frenzy ends');
  load({ enabled: true });
  cmds.get('frenzy')(STAFF, 'wolf start');
  ok(cmds.get('frenzy')(STAFF, 'wolf end') === undefined && !globalThis.__dboFrenzyActive(W), 'staff /frenzy end ends it');
  load({ enabled: true });
  cmds.get('frenzy')(STAFF, 'wolf start'); globalThis.__dboFrenzyReport(W, { phase: 'on' });
  globalThis.__dboFrenzyLeave(W);
  ok(!globalThis.__dboFrenzyActive(W) && globalThis.__dboFrenzyRateMult(W, 'StaminaRateMult') === 1, 'logout ends it, with no exhaustion left behind');
  load({ enabled: true });
  cmds.get('frenzy')(STAFF, 'wolf start'); globalThis.__dboFrenzyReport(W, { phase: 'on' });
  globalThis.__dboFrenzyReport(W, { phase: 'off', why: 'failsafe' });
  ok(!globalThis.__dboFrenzyActive(W), 'the client giving control back (its failsafe) ends it on the server');
  load({ enabled: true, ackSeconds: 1 });
  cmds.get('frenzy')(STAFF, 'wolf start');
  globalThis.__dboFrenzy.active.get(W).at = Date.now() - 2000; tick();
  ok(!globalThis.__dboFrenzyActive(W) && globalThis.__dboFrenzyRateMult(W, 'StaminaRateMult') === 1, 'an older client that never answers: dropped, no exhaustion');
  // no frenzy outside the beast; nothing in reach
  load({ enabled: true });
  setProp(W, 'private.beast', null);
  cmds.get('frenzy')(STAFF, 'wolf start');
  ok(/not in beast form/.test(said[said.length - 1][1]), 'no frenzy outside the beast');
  wolf();
  const saved = new Map(pos); for (const k of pos.keys()) if (k !== W) pos.set(k, 1000);
  cmds.get('frenzy')(STAFF, 'wolf start');
  ok(/nothing in reach/.test(said[said.length - 1][1]), 'no frenzy with nothing in reach');
  for (const [k, v] of saved) pos.set(k, v);
  // hitsPlayers off: only NPCs, and player hits refused
  load({ enabled: true, hitsPlayers: false });
  cmds.get('frenzy')(STAFF, 'wolf start');
  ok(lastFrenzy().target === N1 || lastFrenzy().target === PET, 'hitsPlayers false: an NPC is chosen', lastFrenzy().target.toString(16));
  ok(mp.onHitDamageAttempt(W, P1, 0, 10) === false, 'hitsPlayers false: player hits are refused');
  // a GM who is not lead staff cannot use it
  ok(cmds.get('frenzy')(P1, 'wolf start') === undefined && /Only lead staff/.test(said[said.length - 1][1]), '/frenzy is lead staff only');

  // ---- wiring in supernatural.js and gamemode.js
  const sup = fs.readFileSync(path.join(SERVER, 'supernatural.js'), 'utf8');
  const fc = sup.slice(sup.indexOf('const forcedChange = '), sup.indexOf('let lastHour'));
  ok(/__dboBeastTransform\(a, 'werewolf', true\);[\s\S]*__dboFrenzyForced\(a\)/.test(fc), 'supernatural.js forcedChange asks for a frenzy after the change');
  const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
  ok(gm.indexOf("path.resolve('frenzy.js')") > gm.indexOf("path.resolve('duel.js')") && gm.indexOf("path.resolve('duel.js')") > 0, 'gamemode.js loads frenzy.js after duel.js (its hit and death hooks wrap the rest)');
  ok(/__dboFrenzyRateMult\(a, NEEDS_AV\[key\]\)/.test(gm) && /__dboFrenzyLeave\(a\)/.test(gm) && /'dboFrenzyReport'[\s\S]{0,200}__dboFrenzyReport\(a, content\)/.test(gm), 'gamemode.js: the needs rate, the logout and the client report reach frenzy.js');
  const conf = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
  ok(conf.werewolfFrenzy && conf.werewolfFrenzy.enabled === false, 'gamemode-config.json ships werewolfFrenzy switched off');

  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
