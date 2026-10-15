// Scripted test for racemenupresets.js's live race (15 Oct): a player on a plugin race (the DLE's MaormerRace 3c192ede) is
// sent their appearance race as a beast revert (dboBeast beast false) once per connection, at their client's first ask for
// its own face, and their own face only liveRaceHoldMs after it; never in a beast form, dead, down, in a fight, bound,
// carried, paralysed, in the creator or an editor, or in an editor's save window. A vanilla race, a watcher's ask, a mask
// and a second ask in the same connection send no race. Before the fix SkyrimPlatform's login save left such a player on
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
  racemenuPresets: Object.assign({ dir: DIR, loadSettleMs: 0, liveRaceHoldMs: HOLD }, extra || {}) });
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
const settle = () => wait(40);

// The stored faces, written as the module writes them
const face = (v) => ({ version: { signature: 1163086675, formatVersion: 3, skseVersion: 1, runtimeVersion: 2 }, modNames: ['Skyrim.esm'],
  custom: [{ name: 'RANs_ForeheadBackForward', value: v }], sculptDivisor: 10000, sculpt: [] });
const store = (a, race, v) => {
  const text = P.encodeFace(face(v));
  fs.mkdirSync(DIR, { recursive: true });
  const k = (a >>> 0).toString(16);
  fs.writeFileSync(path.join(DIR, `${k}.json`), JSON.stringify({ v: 1, actor: k, profile: props[a].profileId, race, hash: P.hashText(text), at: '2026-10-13T20:19:14Z', face: text }));
  return P.hashText(text);
};

// The gameplay's own state the race waits on (gamemode.js, appearance.js, downed.js, beastform.js, supernatural.js)
globalThis.__dboConnectedAt = new Map();
globalThis.__dboRaceMenuOpenedAt = new Map();
globalThis.__dboRaceMenuSaveWindows = new Map();
globalThis.__dboCombatAt = new Map();
globalThis.__dboParalysedUntil = new Map();
globalThis.__dboFeralDue = new Map();
let downed = new Set();
let beastOf = new Map();
globalThis.__dboIsDowned = (a) => downed.has(a >>> 0);
globalThis.__dboBeastOriginalRace = (a) => beastOf.get(a >>> 0) || 0;
let connSeq = 1000;
// A fresh login: a new connection stamp (gamemode.js onCharacterReady), and the owner's client asks again with nothing known
const login = (a) => { globalThis.__dboConnectedAt.set(a >>> 0, ++connSeq); const st = globalThis.__dboPresetState; if (st) { st.fullSends.clear(); st.rates.clear(); } };
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
  check('a GM\'s /chargen to High Elf while it waited: no race goes, the held face is answered (with its own race)', races(s).length === 0 && presets(s, M).length === 2 && presets(s, M)[0].p.race === MAORMER
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
