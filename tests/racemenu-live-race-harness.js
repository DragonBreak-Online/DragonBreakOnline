// Scripted test for racemenupresets.js's live race (15 Oct): a player on a plugin race (the DLE's MaormerRace 3c192ede) is
// sent their appearance race as a beast revert (dboBeast beast false) once per load (a connection, or the same character
// picked again at character select), at their client's first ask for its own face, and their own face only liveRaceHoldMs
// after it; never in a beast form, dead, down, in a fight, bound, carried, paralysed, in the creator or an editor, or in an
// editor's save window. A vanilla race, a watcher's ask, a mask and a second ask in the same load send no race. Before the fix SkyrimPlatform's login save left such a player on
// the template's race and their face waited for it forever ('rmp apply wait=race'). Runs against a fake mp in a scratch
// folder:
//
//   node tests/racemenu-live-race-harness.js
'use strict';
globalThis.__dboRaceMenuSaveGate = () => ({ ok: true });
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MOD = path.join(ROOT, 'racemenupresets.js');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-liverace-'));
const DIR = path.join(TMP, 'racemenu-presets');
const HOLD = 300;
const SETTLE = 120;
const MAORMER = 0x3c192ede, MAORMER_VAMPIRE = 0x3c192edf, VAMPIRE_LORD = 0x0200283a, HIGH_ELF = 0x13743, HIGH_ELF_VAMPIRE = 0x88840, NORD = 0x13746;
const NOT_A_RACE = 0x05001234;
// Choom (Maormer with a face), Kalaman (High Elf with a face), Kinro (Maormer, no face), Vex (Maormer vampire), a watcher
const M = 0xff000a6d, H = 0xff00448a, K = 0xff000b01, V = 0xff000c02, W = 0xff000d03;
const users = { 1: M, 2: H, 3: K, 4: V, 5: W };
const props = {
  [M]: { profileId: 51, appearance: { raceId: MAORMER, name: 'Choom' } },
  [H]: { profileId: 208, appearance: { raceId: HIGH_ELF, name: 'Kalaman' } },
  [K]: { profileId: 146, appearance: { raceId: MAORMER, name: 'Kinro' } },
  [V]: { profileId: 192, appearance: { raceId: MAORMER_VAMPIRE, name: 'Vex' } },
  [W]: { profileId: 7, appearance: { raceId: NORD, name: 'Watcher' } },
};
let online = [M, H, K, V, W];
const sent = [];
const logs = [];
const timers = {};
const RECORDS = { [MAORMER]: 'RACE', [MAORMER_VAMPIRE]: 'RACE', [VAMPIRE_LORD]: 'RACE', [HIGH_ELF]: 'RACE', [HIGH_ELF_VAMPIRE]: 'RACE', [NORD]: 'RACE', [NOT_A_RACE]: 'NPC_' };
const DESCS = { '192ede:DragonBreak Online Edits.esp': MAORMER, '192edf:DragonBreak Online Edits.esp': MAORMER_VAMPIRE, '283a:Dawnguard.esm': VAMPIRE_LORD, 'cdd84:Skyrim.esm': 0xcdd84 };
const mp = {
  get: (a, k) => (props[a >>> 0] || {})[k],
  getIdFromDesc: (d) => DESCS[d] || 0,
  lookupEspmRecordById: (id) => (RECORDS[id >>> 0] ? { record: { type: RECORDS[id >>> 0] } } : null),
};
const cfg = (extra) => ({ maormerRace: { race: '192ede:DragonBreak Online Edits.esp', vampire: '192edf:DragonBreak Online Edits.esp' },
  racemenuPresets: Object.assign({ dir: DIR, loadSettleMs: 0, liveRaceHoldMs: HOLD, liveRacePickSettleMs: SETTLE }, extra || {}) });
const api = (extra) => ({
  mp, log: (...x) => logs.push(x.join(' ')), cfg: cfg(extra),
  sendPacket: (a, p) => { sent.push({ to: a >>> 0, p }); return true; },
  onlineActors: () => online.slice(),
  actorOf: (u) => users[u] || 0,
  profileOf: (a) => { const v = (props[a >>> 0] || {}).profileId; return v === undefined ? -1 : v; },
  every: (name, ms, fn) => { timers[name] = fn; },
});
const load = (extra) => { delete require.cache[MOD]; return require(MOD)(api(extra)); };
const P = require(MOD);
const packet = (userId, p) => globalThis.__dboPresetPacket(userId, p);
const pumpAll = () => { for (let i = 0; i < 50; i++) timers.racemenuPresetSend(); };
const take = () => sent.splice(0, sent.length);
// The module's file calls under way, waited for by settle(): an idle-class ionice run (as deploy-batch.sh runs it) can hold a read past 40 ms
let fsPending = 0;
for (const fn of ['readFile', 'writeFile', 'rename', 'unlink', 'open', 'close', 'fdatasync', 'mkdir']) {
  const orig = fs[fn];
  fs[fn] = (...args) => { const cb = args[args.length - 1]; if (typeof cb !== 'function') return orig(...args); fsPending++; return orig(...args.slice(0, -1), (...r) => { fsPending--; cb(...r); }); };
}
const settle = async () => { await wait(40); for (let i = 0; i < 1000 && fsPending > 0; i++) await wait(10); await wait(5); };

// The stored faces, written as the module writes them
const face = (v) => ({ version: { signature: 1163086675, formatVersion: 3, skseVersion: 1, runtimeVersion: 2 }, modNames: ['Skyrim.esm'],
  custom: [{ name: 'RANs_ForeheadBackForward', value: v }], sculptDivisor: 10000, sculpt: [] });
const store = (a, race, v) => {
  const text = P.encodeFace(face(v));
  fs.mkdirSync(DIR, { recursive: true });
  const k = (a >>> 0).toString(16);
  fs.writeFileSync(path.join(DIR, `${k}.json`), JSON.stringify({ v: 1, actor: k, profile: props[a].profileId, race, hash: P.hashText(text), at: '2026-10-13T20:19:14Z', face: text }));
  // The module's read cache holds the file it read last
  const st = globalThis.__dboPresetState; if (st) st.cache.delete(k.padStart(8, '0'));
  return P.hashText(text);
};

// The gameplay's own state the race waits on (gamemode.js, appearance.js, downed.js, beastform.js, supernatural.js)
globalThis.__dboConnectedAt = new Map();
globalThis.__dboRaceMenuOpenedAt = new Map();
globalThis.__dboRaceMenuSaveWindows = new Map();
globalThis.__dboCombatAt = new Map();
globalThis.__dboParalysedUntil = new Map();
globalThis.__dboFeralDue = new Map();
globalThis.__dboAssignedAt = new Map();
let downed = new Set();
let beastOf = new Map();
globalThis.__dboIsDowned = (a) => downed.has(a >>> 0);
globalThis.__dboBeastOriginalRace = (a) => beastOf.get(a >>> 0) || 0;
let connSeq = 1000;
// A fresh login: a new connection stamp, in ms as gamemode.js onCharacterReady sets it, and the owner's client asks again with nothing known
const login = (a) => { connSeq = Math.max(Date.now(), connSeq + 1); globalThis.__dboConnectedAt.set(a >>> 0, connSeq); const st = globalThis.__dboPresetState; if (st) { st.fullSends.clear(); st.rates.clear(); } };
const askSelf = (userId, have) => packet(userId, { customPacketType: 'dboPresetGet', actor: 0, have: have || '' });
const races = (s, to) => s.filter((x) => x.p.customPacketType === 'dboBeast' && (to === undefined || x.to === to));
const presets = (s, to) => s.filter((x) => /^dboPreset/.test(x.p.customPacketType) && (to === undefined || x.to === to));
// Past the hold, with the race tick run
// The race tick (none before 15 Oct: the checks below then fail instead of throwing)
const tick = () => { if (typeof timers.racemenuLiveRace === 'function') timers.racemenuLiveRace(); };
const liveKept = (a) => { const st = globalThis.__dboPresetState; return !!(st && st.liveRace instanceof Map && st.liveRace.has(a >>> 0)); };
const liveSize = () => { const st = globalThis.__dboPresetState; return st && st.liveRace instanceof Map ? st.liveRace.size : 0; };
const afterHold = async () => { await wait(HOLD + 30); tick(); await settle(); };

(async () => {
  const hM = store(M, MAORMER, 1);
  const hH = store(H, HIGH_ELF, 0.01);
  const hV = store(V, MAORMER, 0.05);
  load();
  check('the load says the live race is on', logs.some((l) => /^racemenu presets: live race on for plugin races \(face 300 ms after it, 2 beast race ids never sent\)$/.test(l)), logs);
  check('the race tick is registered', typeof timers.racemenuLiveRace === 'function');

  // ---- a vanilla race: nothing changes ----
  login(H); take();
  askSelf(2);
  await settle(); pumpAll();
  let s = take();
  check('High Elf: no race is sent (a vanilla race loads right)', races(s).length === 0, s.map((x) => x.p.customPacketType));
  check('High Elf: the own face is answered at once, with its own race', presets(s, H).length === 2 && presets(s, H).every((x) => x.p.self === true && x.p.race === HIGH_ELF && x.p.hash === hH), s.map((x) => x.p));
  check('High Elf: nothing is kept for the live race', !liveKept(H));
  props[H].appearance.raceId = HIGH_ELF_VAMPIRE; login(H); take();
  askSelf(2); await settle(); pumpAll(); s = take();
  check('High Elf vampire (88840): no race sent, the face goes with 88840 at once', races(s).length === 0 && presets(s, H).length === 2 && presets(s, H)[0].p.race === HIGH_ELF_VAMPIRE, s.map((x) => x.p));
  props[H].appearance.raceId = HIGH_ELF;

  // ---- a Maormer with a stored face: the race first, the face after the hold ----
  login(M); take(); logs.length = 0;
  askSelf(1);
  s = take();
  check('Maormer: the first ask sends the appearance race as a revert, at once', races(s, M).length === 1 && JSON.stringify(races(s, M)[0].p) === JSON.stringify({ customPacketType: 'dboBeast', race: MAORMER, beast: false }), s.map((x) => x.p));
  await settle(); pumpAll(); s = take();
  check('Maormer: the own face is held while the race holds', presets(s, M).length === 0 && !globalThis.__dboPresetState.selfSent.has(M), s.map((x) => x.p));
  check('Maormer: the send is logged with the race', logs.some((l) => l === 'racemenu presets: ff000a6d (profile 51) live race 3c192ede sent to the owner\'s client'), logs);
  await afterHold(); pumpAll(); s = take();
  check('Maormer: the held answer is logged', logs.some((l) => /^racemenu presets: ff000a6d \(profile 51\) own face answered \d+ s after its live race$/.test(l)), logs);
  check('Maormer: after the hold the face goes out, marked self, with race 3c192ede', presets(s, M).length === 2 && presets(s, M).every((x) => x.p.self === true && x.p.race === MAORMER && x.p.hash === hM) && races(s).length === 0, s.map((x) => x.p));
  check('Maormer: ...and counts as the face put back this session', globalThis.__dboPresetState.selfSent.has(M) && globalThis.__dboPresetState.selfSent.get(M).conn === connSeq);
  tick(); s = take();
  check('Maormer: the tick sends nothing more once done', s.length === 0, s.map((x) => x.p));

  // ---- the same connection asks again (a refusal, the module on again): no second race ----
  askSelf(1, '');
  await settle(); pumpAll(); s = take();
  check('Maormer: a second ask in the same connection sends no race and is answered at once', races(s).length === 0 && presets(s, M).length === 2, s.map((x) => x.p));

  // ---- a mask: a name-only change sends no race and puts no face back ----
  props[M].appearance = Object.assign({}, props[M].appearance, { name: 'Masked Person' });
  tick(); await settle(); pumpAll(); s = take();
  check('mask: a name change alone sends nothing', s.length === 0, s.map((x) => x.p));
  askSelf(1, hM); await settle(); pumpAll(); s = take();
  check('mask: an ask behind the mask in the same connection sends no race (header only, the client has the face)', races(s).length === 0 && presets(s, M).length === 1 && presets(s, M)[0].p.customPacketType === 'dboPresetMeta', s.map((x) => x.p));
  props[M].appearance = Object.assign({}, props[M].appearance, { name: 'Choom' });

  // ---- a watcher's ask is as before ----
  packet(5, { customPacketType: 'dboPresetGet', actor: M, have: '' });
  await settle(); pumpAll(); s = take();
  check('watcher: Choom\'s face goes to a watcher at once with 3c192ede, and no race goes to anyone', races(s).length === 0 && presets(s, W).length === 2 && presets(s, W).every((x) => !x.p.self && x.p.race === MAORMER), s.map((x) => x.p));

  // ---- every login sends it again ----
  login(M); take();
  askSelf(1); s = take();
  check('Maormer: the next login sends the race again', races(s, M).length === 1 && races(s, M)[0].p.race === MAORMER, s.map((x) => x.p));
  await settle(); await afterHold(); pumpAll(); s = take();
  check('Maormer: ...and the face after it', presets(s, M).length === 2, s.map((x) => x.p));

  // ---- a Maormer with no stored face: the race, and "none" at once ----
  login(K); take();
  askSelf(3); await settle(); pumpAll(); s = take();
  check('Kinro (no face): the race is sent and "none" answered at once', races(s, K).length === 1 && races(s, K)[0].p.race === MAORMER && presets(s, K).length === 1 && presets(s, K)[0].p.customPacketType === 'dboPresetNone', s.map((x) => x.p));

  // ---- the Maormer vampire: the vampire race, and the face saved on Maormer goes with it ----
  login(V); take();
  askSelf(4); s = take();
  check('vampire: MaormerRaceVampire 3c192edf is sent, not the face\'s 3c192ede', races(s, V).length === 1 && races(s, V)[0].p.race === MAORMER_VAMPIRE, s.map((x) => x.p));
  await settle(); await afterHold(); pumpAll(); s = take();
  check('vampire: the Maormer face goes out with 3c192edf (one family, config maormerRace)', presets(s, V).length === 2 && presets(s, V).every((x) => x.p.race === MAORMER_VAMPIRE && x.p.hash === hV), s.map((x) => x.p));
  props[V].appearance.raceId = MAORMER; login(V); take();
  askSelf(4); s = take();
  await settle(); await afterHold(); pumpAll(); s = s.concat(take());
  check('vampire: after a cure and a relog, 3c192ede goes and the face with it', races(s, V).length === 1 && races(s, V)[0].p.race === MAORMER && presets(s, V).length === 2 && presets(s, V)[0].p.race === MAORMER, s.map((x) => x.p));

  // ---- a face stored on another family, a plugin race on one side (a GM's /chargen between High Elf and Maormer) ----
  // The client's family table has no plugin race, so a face it is sent for another family holds every capture: none to the owner
  store(M, HIGH_ELF, 0.2);
  login(M); take(); logs.length = 0;
  askSelf(1); await settle(); await afterHold(); pumpAll(); s = take();
  check('a High Elf face on a Maormer: the race goes, then the owner is answered none (no capture held behind it)', races(s, M).length === 1 && presets(s, M).length === 1 && presets(s, M)[0].p.customPacketType === 'dboPresetNone'
    && logs.some((l) => /^racemenu presets: ff000a6d \(profile 51\) own face [0-9a-f]{8} is for race 13743, another family than 3c192ede: the owner is answered none, watchers as before$/.test(l)), [s.map((x) => x.p), logs]);
  packet(5, { customPacketType: 'dboPresetGet', actor: M, have: '' }); await settle(); pumpAll(); s = take();
  check('...a watcher still gets it with its own race 13743, as before', presets(s, W).length === 2 && presets(s, W)[0].p.race === HIGH_ELF, s.map((x) => x.p));
  store(H, MAORMER, 0.3);
  login(H); take();
  askSelf(2); await settle(); pumpAll(); s = take();
  check('a Maormer face on a High Elf: none to the owner at once, no race', races(s).length === 0 && presets(s, H).length === 1 && presets(s, H)[0].p.customPacketType === 'dboPresetNone', s.map((x) => x.p));
  store(H, 0x13744, 0.3);
  login(H); take();
  askSelf(2); await settle(); pumpAll(); s = take();
  check('vanilla on vanilla (an Imperial face on a High Elf): sent with its own race 13744, as before', presets(s, H).length === 2 && presets(s, H)[0].p.race === 0x13744, s.map((x) => x.p));
  store(H, HIGH_ELF, 0.01); store(M, MAORMER, 1);
  props[M].appearance.raceId = VAMPIRE_LORD; beastOf.set(M, MAORMER);
  login(M); take();
  askSelf(1); await settle(); pumpAll(); s = take();
  check('in a Vampire Lord form the Maormer face goes as before (its own race, the client waits)', races(s).length === 0 && presets(s, M).length === 2 && presets(s, M)[0].p.race === MAORMER, s.map((x) => x.p));
  beastOf.delete(M); props[M].appearance.raceId = MAORMER;

  // ---- what the race waits for ----
  const now = () => Date.now();
  const blockers = [
    ['beast', 'beast', () => beastOf.set(M, MAORMER), () => beastOf.delete(M)],
    ['private.beast', 'beast', () => { props[M]['private.beast'] = { form: 'werewolf' }; }, () => { delete props[M]['private.beast']; }],
    ['a forced change on its way', 'beastcoming', () => globalThis.__dboFeralDue.set(M, now() + 5000), () => globalThis.__dboFeralDue.delete(M)],
    ['dead', 'dead', () => { props[M].isDead = true; }, () => { delete props[M].isDead; }],
    ['down', 'downed', () => downed.add(M), () => downed.delete(M)],
    ['a blow 10 s ago', 'combat', () => globalThis.__dboCombatAt.set(M, now() - 10000), () => globalThis.__dboCombatAt.set(M, now() - 31000)],
    ['bound hands', 'restrained', () => { props[M]['private.restrained'] = { boundHands: true }; }, () => { props[M]['private.restrained'] = null; }],
    ['carried', 'restrained', () => { props[M]['private.restrained'] = { carried: true }; }, () => { props[M]['private.restrained'] = null; }],
    ['a captor', 'restrained', () => { props[M]['private.restrained'] = { captorActorId: W }; }, () => { props[M]['private.restrained'] = null; }],
    ['paralysed', 'paralysed', () => globalThis.__dboParalysedUntil.set(M, now() + 5000), () => globalThis.__dboParalysedUntil.delete(M)],
    ['in the creator', 'creator', () => { props[M]['private.creationPending'] = true; }, () => { props[M]['private.creationPending'] = false; }],
    ['a reroll', 'creator', () => { props[M]['private.rerollPending'] = true; }, () => { props[M]['private.rerollPending'] = false; }],
    ['/appearance open', 'editor', () => { props[M]['private.dboAppearanceEdit'] = { at: now(), before: {} }; }, () => { props[M]['private.dboAppearanceEdit'] = null; }],
    ['a GM\'s /chargen open', 'editor', () => { props[M]['private.dboChargenEdit'] = { at: now(), before: {} }; }, () => { props[M]['private.dboChargenEdit'] = null; }],
    ['a save window open', 'savewindow', () => globalThis.__dboRaceMenuSaveWindows.set(M, { at: now(), until: now() + 60000, kind: 'appearance' }), () => globalThis.__dboRaceMenuSaveWindows.delete(M)],
  ];
  for (const [what, why, on, off] of blockers) {
    login(M); take(); logs.length = 0;
    on();
    askSelf(1); await settle(); tick(); tick(); pumpAll();
    s = take();
    const held = races(s).length === 0 && presets(s, M).length === 0;
    const told = logs.filter((l) => l === `racemenu presets: ff000a6d (profile 51) live race 3c192ede waits (${why})`).length === 1;
    off();
    tick(); s = take();
    const went = races(s, M).length === 1 && races(s, M)[0].p.race === MAORMER;
    await afterHold(); pumpAll(); s = take();
    check(`waits while ${what} (${why}): no race, no face, logged once; then the race, then the face`, held && told && went && presets(s, M).length === 2,
      [held, told, went, presets(s, M).length, logs]);
  }
  // A /chargen snapshot past appearance.js's 24 h, an expired save window, and an opening noted with no editor mark (its window
  // already dropped by the gate) do not hold the race
  login(M); take();
  props[M]['private.dboChargenEdit'] = { at: Date.now() - 25 * 3600000, before: {} };
  globalThis.__dboRaceMenuSaveWindows.set(M, { at: Date.now() - 100000, until: Date.now() - 10000, kind: 'appearance' });
  globalThis.__dboRaceMenuOpenedAt.set(M, Date.now() - 1000);
  askSelf(1); s = take();
  check('a 25 h /chargen snapshot, an expired save window and a bare opening stamp do not hold it', races(s, M).length === 1, [s.map((x) => x.p), logs.slice(-3)]);
  props[M]['private.dboChargenEdit'] = null; globalThis.__dboRaceMenuOpenedAt.delete(M); globalThis.__dboRaceMenuSaveWindows.delete(M);
  await settle(); await afterHold(); pumpAll(); take();

  // ---- the werewolf and the Vampire Lord ----
  login(M); take(); logs.length = 0;
  props[M].appearance.raceId = VAMPIRE_LORD; beastOf.set(M, MAORMER);
  askSelf(1); await settle(); tick(); pumpAll(); s = take();
  check('Vampire Lord (a Dawnguard plugin race): never sent, and no mortal race goes while the form lasts', races(s).length === 0 && !liveKept(M), s.map((x) => x.p));
  beastOf.delete(M); props[M].appearance.raceId = MAORMER;

  // ---- a race changed to a vanilla one while it waited ----
  login(M); take(); logs.length = 0;
  props[M].isDead = true;
  askSelf(1); await settle(); tick(); take();
  props[M].appearance.raceId = HIGH_ELF; delete props[M].isDead;
  tick(); await settle(); pumpAll(); s = take();
  // The held answer goes out; the face stored on Maormer is another family's now, so it is none to the owner (see above)
  check('a GM\'s /chargen to High Elf while it waited: no race goes, the held answer goes out (none: the face is Maormer\'s)', races(s).length === 0 && presets(s, M).length === 1 && presets(s, M)[0].p.customPacketType === 'dboPresetNone'
    && logs.some((l) => l === 'racemenu presets: ff000a6d (profile 51) live race not sent: 13743 is no plugin race now'), [s.map((x) => x.p), logs]);
  props[M].appearance.raceId = MAORMER;

  // ---- a plugin id that is no RACE record ----
  login(K); take();
  props[K].appearance.raceId = NOT_A_RACE;
  askSelf(3); await settle(); pumpAll(); s = take();
  check('a plugin id that is no RACE record: nothing sent', races(s).length === 0, s.map((x) => x.p));
  props[K].appearance.raceId = MAORMER;

  // ---- offline while it waits ----
  login(M); take();
  props[M].isDead = true;
  askSelf(1); await settle();
  online = online.filter((a) => a !== M);
  delete props[M].isDead;
  tick(); s = take();
  check('a player gone while it waits: nothing sent, nothing kept', races(s).length === 0 && !liveKept(M), s.map((x) => x.p));
  online.push(M);

  // ---- a hot reload in the middle ----
  login(M); take();
  askSelf(1); await settle(); s = take();
  load();
  await afterHold(); pumpAll(); s = s.concat(take());
  check('a hot reload during the hold keeps it: one race, then the face', races(s, M).length === 1 && presets(s, M).length === 2, s.map((x) => x.p));

  // ---- the same character picked again at character select, in the same connection (15 Oct end-to-end review) ----
  // spawn.ts keeps the connection, hands the user the same actor and calls gamemode.js assignHook (__dboAssignedAt); the
  // client loads its save again (the template race on the actor) and asks for its own face 6 s after that load
  const pick = (a) => globalThis.__dboAssignedAt.set(a >>> 0, Date.now());
  const pickSettle = () => wait(SETTLE + 30);
  const ownSent = (a) => { const x = globalThis.__dboPresetState.selfSent.get(a >>> 0); return !!x && x.conn === connSeq; };
  const PICKED_LINE = 'racemenu presets: ff000a6d (profile 51) live race 3c192ede sent to the owner\'s client (the character picked again)';

  // A pick at login comes just before the connect stamp (gamemode.js onCharacterReady): an ordinary first load
  pick(M); await wait(5); login(M); take(); logs.length = 0;
  await pickSettle();
  askSelf(1); s = take();
  check('a login (pick, then connect): the race goes, logged as a plain login', races(s, M).length === 1 && logs.includes('racemenu presets: ff000a6d (profile 51) live race 3c192ede sent to the owner\'s client'), [s.map((x) => x.p), logs]);
  await settle(); await afterHold(); pumpAll(); take();

  // 1. Picked again long after the face went on
  logs.length = 0;
  pick(M); await pickSettle(); pumpAll(); s = take();
  check('picked again after the face went on: nothing is sent before the new load asks', s.length === 0, s.map((x) => x.p));
  askSelf(1); s = take();
  check('picked again: the new load\'s first ask sends the race again', races(s, M).length === 1 && races(s, M)[0].p.race === MAORMER, s.map((x) => x.p));
  check('...logged as the character picked again', logs.includes(PICKED_LINE), logs);
  await settle(); pumpAll(); s = take();
  check('picked again: the face is held while the race holds', presets(s, M).length === 0, s.map((x) => x.p));
  await afterHold(); pumpAll(); s = take();
  check('picked again: then the face, marked self, with 3c192ede', presets(s, M).length === 2 && presets(s, M).every((x) => x.p.self === true && x.p.race === MAORMER && x.p.hash === hM), s.map((x) => x.p));
  askSelf(1); await settle(); pumpAll(); s = take();
  check('picked again: a later ask in that load sends no race and is answered at once', races(s).length === 0 && presets(s, M).length === 2, s.map((x) => x.p));
  pick(M); await pickSettle(); tick(); askSelf(1); s = take();
  check('picked a third time (the tick ran first): the race again', races(s, M).length === 1, s.map((x) => x.p));
  await settle(); await afterHold(); pumpAll(); s = take();
  check('...and the face after it', presets(s, M).length === 2, s.map((x) => x.p));

  // 2. Picked again while the face is held for the race (inside the hold): the old load's face would reach the new load before its race
  login(M); take(); logs.length = 0;
  askSelf(1); s = take();
  check('hold: the race went and the face is held', races(s, M).length === 1, s.map((x) => x.p));
  await wait(5); pick(M); await settle(); tick(); await wait(HOLD + 30); tick(); await settle(); pumpAll(); s = take();
  check('picked again during the hold: the held face is not sent to the old load, nothing kept', presets(s, M).length === 0 && races(s).length === 0 && !liveKept(M), [s.map((x) => x.p), logs]);
  askSelf(1); s = take();
  check('...the new load\'s ask sends the race again', races(s, M).length === 1 && logs.includes(PICKED_LINE), [s.map((x) => x.p), logs]);
  await settle(); pumpAll(); s = take();
  const heldAgain = presets(s, M).length === 0;
  await afterHold(); pumpAll(); s = take();
  check('...and the face only after its hold', heldAgain && presets(s, M).length === 2 && presets(s, M)[0].p.race === MAORMER, s.map((x) => x.p));

  // 3. Picked again while the race waits (bound): the race goes to the new load once freed
  login(M); take(); logs.length = 0;
  props[M]['private.restrained'] = { boundHands: true };
  askSelf(1); await settle(); tick(); pumpAll(); s = take();
  pick(M); await pickSettle(); tick(); pumpAll(); s = s.concat(take());
  askSelf(1); await settle(); tick(); pumpAll(); s = s.concat(take());
  check('picked again while bound: no race and no face yet', races(s).length === 0 && presets(s, M).length === 0, s.map((x) => x.p));
  props[M]['private.restrained'] = null;
  tick(); s = take();
  check('...freed: the race goes once', races(s, M).length === 1, s.map((x) => x.p));
  await afterHold(); pumpAll(); s = take();
  check('...then the face once', presets(s, M).length === 2, s.map((x) => x.p));

  // 4. An ask the old load sent as the character was picked (it reaches the server just after the pick)
  login(M); take();
  askSelf(1); await settle(); await afterHold(); pumpAll(); take();
  pick(M); askSelf(1); await settle(); tick(); pumpAll(); s = take();
  check('an ask from the old load right after the pick: no race and no answer (the new load asks for itself)', s.length === 0, s.map((x) => x.p));
  await pickSettle(); askSelf(1); s = take();
  await settle(); await afterHold(); pumpAll(); s = s.concat(take());
  check('...the new load\'s ask: the race, then the face', races(s, M).length === 1 && presets(s, M).length === 2, s.map((x) => x.p));

  // 5. The owner's answer still queued when they pick again would reach the new load unasked
  login(M); take();
  askSelf(1); take(); await settle(); await wait(HOLD + 30); tick(); await settle();
  pick(M); pumpAll(); s = take();
  check('an own answer still queued at the pick is not sent, nor counted as the face put back', presets(s, M).length === 0 && !ownSent(M), s.map((x) => x.p));
  await pickSettle(); askSelf(1); s = take();
  await settle(); await afterHold(); pumpAll(); s = s.concat(take());
  check('...the new load\'s ask: the race, then the face, counted as put back', races(s, M).length === 1 && presets(s, M).length === 2 && ownSent(M), s.map((x) => x.p));

  // 6. Picked again after a dboPresetRev: the owner's own face save (the rev goes to the others)
  login(M); take();
  askSelf(1); await settle(); await afterHold(); pumpAll(); take();
  const t2 = P.encodeFace(face(0.7)), h2 = P.hashText(t2);
  logs.length = 0;
  packet(1, { customPacketType: 'dboPresetPut', up: 77, i: 0, n: 1, hash: h2, race: 1, data: t2 });
  await settle(); await settle(); pumpAll(); s = take();
  check('the owner saves a new face: the others are sent dboPresetRev, no race goes', s.some((x) => x.to === W && x.p.customPacketType === 'dboPresetRev' && x.p.hash === h2) && !s.some((x) => x.to === M && x.p.customPacketType === 'dboPresetRev') && races(s).length === 0, [s.map((x) => x.p), logs]);
  pick(M); await pickSettle(); askSelf(1); s = take();
  check('picked again after that save: the race again', races(s, M).length === 1, s.map((x) => x.p));
  await settle(); await afterHold(); pumpAll(); s = take();
  check('...then the new face with 3c192ede', presets(s, M).length === 2 && presets(s, M).every((x) => x.p.hash === h2 && x.p.race === MAORMER), s.map((x) => x.p));
  store(M, MAORMER, 1);

  // 7. Picked again after a dboPresetRev to the owner: faces off and on again by a reload (the rev 'on' makes the client ask)
  login(M); take();
  askSelf(1); await settle(); await afterHold(); pumpAll(); take();
  load({ enabled: false }); take(); load(); s = take();
  check('faces on again: the owner is sent dboPresetRev self "on"', s.some((x) => x.to === M && x.p.customPacketType === 'dboPresetRev' && x.p.self === true && x.p.hash === 'on'), s.map((x) => x.p));
  askSelf(1); s = take();
  await settle(); await afterHold(); pumpAll(); s = s.concat(take());
  // The off load forgets the live race (as before this change), so this ask sends the same race once more, as a login does
  check('...its ask: one race (the same race), then the face with 3c192ede', races(s, M).length === 1 && races(s, M)[0].p.race === MAORMER && presets(s, M).length === 2 && presets(s, M)[0].p.race === MAORMER, s.map((x) => x.p));
  pick(M); await pickSettle(); askSelf(1); s = take();
  check('picked again after the rev: the race again', races(s, M).length === 1, s.map((x) => x.p));
  await settle(); await afterHold(); pumpAll(); s = take();
  check('...then the face', presets(s, M).length === 2, s.map((x) => x.p));

  // 8. Unchanged: a vanilla race picked again, and a watcher's ask about someone who just picked again
  login(H); take();
  askSelf(2); await settle(); pumpAll(); take();
  pick(H); askSelf(2); await settle(); pumpAll(); s = take();
  check('a High Elf picked again: no race, the face at once even right after the pick', races(s).length === 0 && presets(s, H).length === 2 && presets(s, H)[0].p.race === HIGH_ELF, s.map((x) => x.p));
  await pickSettle(); pick(H); await pickSettle(); askSelf(2); await settle(); pumpAll(); s = take();
  check('a High Elf picked a second time in that connection: the face in full again (each load starts with none)', races(s).length === 0 && presets(s, H).length === 2 && presets(s, H)[1].p.customPacketType === 'dboPresetChunk', s.map((x) => x.p));
  pick(M); packet(5, { customPacketType: 'dboPresetGet', actor: M, have: '' }); await settle(); pumpAll(); s = take();
  check('a watcher\'s ask about a Maormer who just picked again is answered as before', presets(s, W).length === 2 && races(s).length === 0, s.map((x) => x.p));
  await pickSettle();

  // ---- the quick undo: liveRace false ----
  login(M); take();
  props[M].isDead = true;
  askSelf(1); await settle(); take();
  logs.length = 0;
  load({ liveRace: false });
  await settle(); pumpAll(); s = take();
  check('liveRace false by a reload: a held face goes out at once', presets(s, M).length === 2 && races(s).length === 0 && !liveSize(), s.map((x) => x.p));
  check('...and the load says so', logs.includes('racemenu presets: live race off'), logs);
  delete props[M].isDead;
  login(M); take();
  askSelf(1); await settle(); pumpAll(); s = take();
  check('liveRace false: a Maormer is answered at once with no race, as before 15 Oct', races(s).length === 0 && presets(s, M).length === 2, s.map((x) => x.p));
  load({ enabled: false }); take();
  login(M); askSelf(1); await settle(); pumpAll(); s = take();
  check('faces off: "none", and no race', races(s).length === 0 && presets(s, M).length === 1 && presets(s, M)[0].p.customPacketType === 'dboPresetNone', s.map((x) => x.p));
  load(); take();

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL  harness threw', e.stack); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
