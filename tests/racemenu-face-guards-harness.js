// Two guards on RaceMenu faces (5 Nov). G1: clients 0.3.111-0.3.116 ship a SkyrimPlatformImpl.dll without the preset calls,
// so racemenuPresetService.ts never asks for a face and never uploads one; racemenupresets.js tells such a client apart
// (no face ask 60 s after its extras ask, or the 'rmp cap err=natives' trace gamemode.js relays) and appearance.js then charges
// no gold or free change for a changed look (its cooldown still starts), and says why. G2: a face file names its race by
// load-order id, so after the DLE moved from 0x48 to 0x49 nine faces kept 48xxxxxx: their owners were answered none and
// /appearance refused them 'otherrace'. New faces keep raceDesc, resolved on read; an older one on a full plugin that names
// no RACE now is matched by the id's low 24 bits.
// Stub mp, the real modules and gamemode.js's own writeDiagLines.
//   node tests/racemenu-face-guards-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPEARANCE = path.join(ROOT, 'appearance.js');
const PRESETS = path.join(ROOT, 'racemenupresets.js');
let fails = 0;
const ok = (c, label, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${label}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 400)}`); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fsPending = 0;
for (const fn of ['readFile', 'writeFile', 'rename', 'unlink', 'open', 'close', 'fdatasync', 'mkdir']) {
  const orig = fs[fn];
  fs[fn] = (...args) => { const cb = args[args.length - 1]; if (typeof cb !== 'function') return orig(...args); fsPending++; return orig(...args.slice(0, -1), (...r) => { fsPending--; cb(...r); }); };
}
const settle = async () => { await wait(20); for (let i = 0; i < 1000 && fsPending > 0; i++) await wait(10); await wait(5); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-faceguards-'));
const DIR = path.join(TMP, 'racemenu-presets');
const DLE = 'DragonBreak Online Edits.esp';
// The DLE at 0x49 now; its ids at 0x48 are the load order before window-1021
const MAORMER = 0x49192ede, MAORMER_V = 0x49192edf, GOBLIN = 0x49000d62, NORD = 0x13746, BRETON = 0x13741;
// Another race plugin after the DLE whose race has the Goblin's local id
const OTHER = 0x4a000d62;
const OLD = (id) => ((0x48 << 24) | (id & 0xffffff)) >>> 0;
const DESCS = { [`192ede:${DLE}`]: MAORMER, [`192edf:${DLE}`]: MAORMER_V, [`d62:${DLE}`]: GOBLIN, 'd62:Other Races.esp': OTHER, '13746:Skyrim.esm': NORD, '283a:Dawnguard.esm': 0x0200283a, 'cdd84:Skyrim.esm': 0xcdd84 };
const IDS = Object.fromEntries(Object.entries(DESCS).map(([d, id]) => [id, d]));
const RECORDS = { [MAORMER]: 'RACE', [MAORMER_V]: 'RACE', [GOBLIN]: 'RACE', [OTHER]: 'RACE', [NORD]: 'RACE', [BRETON]: 'RACE' };

const A = 0xff000101, B = 0xff000202;
const users = { 1: A, 2: B };
const props = new Map();
const mp = {
  get: (a, k) => props.get(`${a >>> 0}|${k}`), set: (a, k, v) => props.set(`${a >>> 0}|${k}`, v), setRaceMenuOpen: () => {},
  getIdFromDesc: (d) => { if (!(d in DESCS)) throw new Error(`${d} not found in loaded files`); return DESCS[d]; },
  // An id with no plugin here comes back as plain hex, as the engine writes a created form's
  getDescFromId: (id) => IDS[id >>> 0] || (id >>> 0).toString(16),
  lookupEspmRecordById: (id) => (RECORDS[id >>> 0] ? { record: { type: RECORDS[id >>> 0], fields: [] } } : null),
};
const look = (race) => ({ raceId: race || NORD, isFemale: false, name: 'Brand Stoneborn', weight: 50, skinColor: 1, hairColor: 2, headpartIds: [1, 2], headTextureSetId: 3, options: [0], presets: [0], tints: [] });
const CFG = (app, rmp) => ({ appearance: Object.assign({ cost: 500, cooldownHours: 24, freeChanges: 0 }, app || {}),
  racemenuPresets: Object.assign({ dir: DIR, loadSettleMs: 0, liveRace: false }, rmp || {}), maormerRace: { race: `192ede:${DLE}`, vampire: `192edf:${DLE}` } });
const reset = (race, gold) => {
  props.clear();
  props.set(`${A}|inventory`, { entries: [{ baseId: 0xf, count: gold === undefined ? 800 : gold }] }); props.set(`${A}|appearance`, look(race)); props.set(`${A}|profileId`, 7);
  props.set(`${B}|inventory`, { entries: [] }); props.set(`${B}|appearance`, look()); props.set(`${B}|profileId`, 8);
};

let sys = [], pers = [], audits = [], alogs = [], cmds = new Map();
const loadAppearance = (app) => {
  sys = []; pers = []; audits = []; alogs = []; cmds = new Map();
  delete require.cache[APPEARANCE];
  delete globalThis.__dboRaceMenuSaveWindows; delete globalThis.__dboRaceMenuRefusedToldAt; delete globalThis.__dboAppearanceRefusedAt;
  globalThis.__dboCombatAt = new Map(); globalThis.__dboIsDowned = null; globalThis.__dboBeastOriginalRace = null; globalThis.__dboDungeonCells = new Set();
  globalThis.__dboTellsRetake = () => {}; globalThis.__dboFeralDue = new Map();
  return require(APPEARANCE)({ mp, log: (...x) => alogs.push(x.join(' ')), personal: (a, t) => pers.push(t), system: (a, t) => sys.push(t), audit: (t) => audits.push(t), who: () => 'Brand',
    registerChatCommand: (n, fn) => cmds.set(n, fn), cfg: CFG(app), userOf: () => 3, profileOf: (a) => Number(props.get(`${a >>> 0}|profileId`)), later: () => {} });
};
const sent = [], plogs = [], timers = {};
let online = [A, B];
const loadPresets = (rmp) => {
  delete require.cache[PRESETS]; delete globalThis.__dboPresetState;
  return require(PRESETS)({ mp, log: (...x) => plogs.push(x.join(' ')), cfg: CFG(null, rmp), sendPacket: (a, p) => { sent.push({ to: a >>> 0, p }); return true; },
    onlineActors: () => online.slice(), actorOf: (u) => users[u] || 0, profileOf: (a) => { const v = props.get(`${a >>> 0}|profileId`); return v === undefined ? -1 : Number(v); },
    every: (n, ms, fn) => { timers[n] = fn; } });
};
const P = require(PRESETS);
const packet = (userId, p) => globalThis.__dboPresetPacket(userId, p);
const pumpAll = () => { for (let i = 0; i < 50; i++) timers.racemenuPresetSend(); };
const take = () => sent.splice(0, sent.length);
const gold = () => props.get(`${A}|inventory`).entries.filter((e) => e.baseId === 0xf).reduce((s, e) => s + e.count, 0);
const lastAt = () => props.get(`${A}|private.dboAppearanceAt`);
const openEditor = () => cmds.get('appearance')(A, '');
const closeEditor = (app) => { props.set(`${A}|appearance`, JSON.parse(JSON.stringify(app))); return globalThis.__dboAppearanceEdit.finish(A, app); };
const gate = (what, first) => globalThis.__dboRaceMenuSaveGate(A, what, first);
const fc = (a) => globalThis.__dboFaceClient(a);
const face = (v) => ({ version: { signature: 1163086675, formatVersion: 3, skseVersion: 1, runtimeVersion: 2 }, modNames: ['Skyrim.esm'],
  custom: [{ name: 'RANs_ForeheadBackForward', value: v }], sculptDivisor: 10000, sculpt: [] });
const fileOf = (a) => path.join(DIR, `${(a >>> 0).toString(16)}.json`);
const store = (a, doc, v) => {
  const text = P.encodeFace(face(v));
  fs.mkdirSync(DIR, { recursive: true });
  const k = (a >>> 0).toString(16);
  fs.writeFileSync(fileOf(a), JSON.stringify(Object.assign({ v: 1, actor: k, profile: Number(props.get(`${a >>> 0}|profileId`)), hash: P.hashText(text), at: '2026-10-13T20:19:14.000Z', face: text }, doc)));
  const st = globalThis.__dboPresetState; if (st) st.cache.delete(k.padStart(8, '0'));
  return P.hashText(text);
};
const upload = (userId, v) => { const t = P.encodeFace(face(v)); packet(userId, { customPacketType: 'dboPresetPut', up: Math.floor(Math.random() * 1e6), i: 0, n: 1, hash: P.hashText(t), race: 1, data: t }); return P.hashText(t); };
const answerOf = (s, to, actor) => s.filter((x) => x.to === to && x.p.actor === actor && /^dboPreset(None|Meta)$/.test(x.p.customPacketType)).map((x) => x.p);

// gamemode.js's own diag relay, cut out of the file as tests/dbodiag-harness.js does
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('const DIAG_MAX_PER_PLAYER');
const diagLog = [];
const writeDiagLines = new Function('log', 'actorOf', 'profileOf', 'display', 'globalThis',
  `${src.slice(start, src.indexOf('\n\nglobalThis.__dboHandlers.customPacket', start))}\nreturn writeDiagLines;`)((...x) => diagLog.push(x.join(' ')), (u) => users[u] || 0, () => 7, () => 'Brand', globalThis);
const conn = globalThis.__dboConnectedAt = new Map();
const picked = globalThis.__dboAssignedAt = new Map();
globalThis.__dboRaceMenuOpenedAt = new Map();
// Each call is another connection, a few ms apart even within one millisecond
let seq = 0;
const loaded = (a, agoMs) => { const t = Date.now() - agoMs - (++seq); conn.set(a >>> 0, t); picked.set(a >>> 0, t); };
// The client's extras self ask, through appearanceextras.js as gamemode.js routes it, agoMs before now
process.chdir(TMP);
require(path.join(ROOT, 'appearanceextras.js'))({ log: () => {}, cfg: { appearanceExtras: { enabled: false } }, sendPacket: () => true, onlineActors: () => [], profileOf: () => 7, display: () => 'Brand' });
const spawned = (a, agoMs) => {
  globalThis.__dboAppearanceExtrasPacket(a, { customPacketType: 'dboAppearanceExtrasGet', self: true, index: true });
  const e = globalThis.__dboPresetState.spawnAsks.get(a >>> 0); if (e && agoMs) e.at = Date.now() - agoMs;
};

(async () => {
  // ---- G1: whether the owner's client can keep a face (racemenupresets.js) ----
  reset();
  let M = loadPresets();
  ok(fc(A).state === 'unknown' && /not connected/.test(fc(A).why), 'G1: no connection yet: unknown', fc(A));
  loaded(A, 120000);
  ok(fc(A).state === 'unknown' && /before the server watched/.test(fc(A).why), 'G1: a load from before this process watched (a hot reload deploy): unknown, it may have asked unseen', fc(A));
  M.state.faceClientsSince = Date.now() - 600000;
  loaded(A, 2000);
  ok(fc(A).state === 'unknown' && /no face ask yet, 2 s after it connected, and no extras ask/.test(fc(A).why), 'G1: 2 s after its connect with no ask: unknown', fc(A));
  // The connect stamp comes before the client's loading screen: a 75 s load is no sign of anything
  loaded(A, 75000);
  ok(fc(A).state === 'unknown', 'G1: 75 s after the connect stamp, still loading (no extras ask yet): unknown', fc(A));
  spawned(A, 5000);
  ok(fc(A).state === 'unknown' && /no face ask yet, 5 s after its character loaded/.test(fc(A).why), 'G1: ...its extras ask 5 s ago after that 75 s load starts the wait: unknown', fc(A));
  timers.racemenuFaceClients();
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' });
  ok(fc(A).state === 'capable' && !plogs.some((l) => /client sent no face ask|asked for faces after all/.test(l)), 'G1: ...then its face ask: capable, never counted as without the calls', [fc(A), plogs.slice(-2)]);
  await settle(); take();
  loaded(A, 120000);
  spawned(A, 75000);
  ok(fc(A).state === 'incapable' && /^no face ask in 75 s after its character loaded$/.test(fc(A).why), 'G1: no face ask 75 s after its extras ask: incapable', fc(A));
  spawned(A);
  ok(/in 75 s after/.test(fc(A).why), 'G1: ...a second extras ask in that load does not move the start', fc(A));
  timers.racemenuFaceClients();
  const noAsk = () => plogs.filter((l) => /^racemenu presets: ff000101 \(profile 7\) client sent no face ask in \d+ s after (its character loaded|it connected, and no extras ask): it has no preset calls/.test(l)).length;
  ok(noAsk() === 1, 'G1: the tick logs that load once, for staff to count', plogs.slice(-3));
  timers.racemenuFaceClients();
  ok(noAsk() === 1, 'G1: ...and not again for the same load');
  packet(1, { customPacketType: 'dboPresetGet', actor: B, have: '' });
  ok(fc(A).state === 'capable', 'G1: any face ask (here a copy\'s) marks the client capable', fc(A));
  ok(plogs.some((l) => /ff000101 \(profile 7\) client asked for faces after all, 120 s after its load/.test(l)), 'G1: a late ask after the no-ask line is logged too');
  picked.set(A, Date.now());
  ok(fc(A).state === 'capable', 'G1: the character picked again in that connection: still capable (one game process)');
  loaded(A, 290000);
  ok(fc(A).state === 'unknown', 'G1: a new connection: the last load\'s extras ask does not count, and 290 s with none is unknown', fc(A));
  loaded(A, 310000);
  ok(fc(A).state === 'incapable' && /^no face ask in 310 s after it connected, and no extras ask$/.test(fc(A).why), 'G1: 300 s with neither ask (no RaceMenu): incapable', fc(A));
  timers.racemenuFaceClients();
  ok(noAsk() === 2, 'G1: a new load is logged again');
  loaded(A, 90000);
  M.state.spawnAsks.set(A, { conn: conn.get(A), at: conn.get(A) - 1 });
  ok(fc(A).state === 'unknown', 'G1: an extras ask from before the load stamp (the character picked again) is not this load\'s', fc(A));
  loaded(A, 1000);
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' });
  ok(fc(A).state === 'capable', 'G1: the owner\'s own ask marks it capable at once', fc(A));
  loaded(A, 1000);
  upload(1, 0.3);
  ok(fc(A).state === 'capable', 'G1: so does an upload');
  await settle(); take();

  // The trace, through gamemode.js writeDiagLines, whatever the player's line allowance
  loaded(A, 1000);
  writeDiagLines(1, ['apr rmp cap err=natives']);
  ok(fc(A).state === 'incapable' && fc(A).why === 'rmp cap err=natives', 'G1: an \'apr rmp cap err=natives\' line marks the client incapable at once', fc(A));
  ok(plogs.some((l) => /^racemenu presets: ff000101 \(profile 7\) client has no preset calls \(rmp cap err=natives\)/.test(l)), 'G1: ...and is logged');
  loaded(A, 1000);
  globalThis.__dboDiagSeen.set(`${A}:apr`, 400);
  const lines = diagLog.length;
  writeDiagLines(1, ['apr rmp cap err=natives']);
  ok(fc(A).state === 'incapable' && diagLog.length === lines, 'G1: seen even past the player\'s apr allowance (the line itself is not logged)', fc(A));
  loaded(A, 1000);
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' });
  writeDiagLines(1, ['apr rmp cap err=natives']);
  ok(fc(A).state === 'capable' && fc(A).why === 'asked for a face', 'G1: an err=natives line after an ask in the same connection (a forged one) leaves it capable', fc(A));
  ok(plogs.some((l) => /^racemenu presets: ff000101 \(profile 7\) client traced rmp cap err=natives after it asked for faces in this connection: kept as having the preset calls$/.test(l)), 'G1: ...and the mismatch is logged');
  await settle(); take();
  loaded(A, 1000);
  writeDiagLines(1, ['apr rmp cap err=noplayer', 'apr rmp ask have=-']);
  ok(fc(A).state === 'unknown', 'G1: other rmp lines say nothing about the calls', fc(A));
  ok(timers.racemenuFaceClients && typeof globalThis.__dboFaceClientNoNatives === 'function', 'G1: the module installs the trace hook and the tick');

  // Faces not kept for this player: unknown, so appearance.js keeps its usual rules
  loaded(A, 120000);
  loadPresets({ enabled: false });
  globalThis.__dboPresetState.faceClientsSince = 1;
  ok(fc(A).state === 'unknown' && /faces not kept/.test(fc(A).why), 'G1: faces switched off: unknown', fc(A));
  loadPresets({ testProfiles: [8] });
  globalThis.__dboPresetState.faceClientsSince = 1;
  ok(fc(A).state === 'unknown', 'G1: a staff test without this player: unknown', fc(A));

  // ---- G1: appearance.js charges nothing for a look change that client cannot save the face of ----
  const NOTE = 'An upcoming client update will fix it.';
  const NO_FACE = `Your game client can't save face sliders right now, so nothing was charged. ${NOTE}`;
  const incapable = () => { M = loadPresets(); M.state.faceClientsSince = 1; loaded(A, 120000); spawned(A, 75000); };
  const freeUsed = () => props.get(`${A}|private.dboAppearanceFreeUsed`);
  reset(); incapable(); loadAppearance();
  openEditor();
  ok(pers.at(-1) === `The appearance editor is open. Your game client can't save face sliders right now, so a new look costs no gold (the daily wait still starts); changing only overlays or body sliders costs 500 gold. ${NOTE} Your race, sex and name stay as they are.`,
    'G1: the editor says so when it opens', pers.at(-1));
  ok(audits.at(-1) === 'APPEARANCE Brand opened the appearance editor (500 gold on a changed look)' && alogs.some((l) => /^appearance: Brand open: client incapable \(no face ask in 75 s after its character loaded\), a changed look costs no gold$/.test(l)),
    'G1: ...its audit line as before, and the verdict logged', [audits, alogs]);
  closeEditor(Object.assign(look(), { hairColor: 9 }));
  ok(gold() === 800 && lastAt() > 0 && sys.at(-1) === `Your new look is saved. ${NO_FACE}`, 'G1: a changed look: no gold, the cooldown starts, and the player is told why', [gold(), lastAt(), sys.at(-1)]);
  ok(props.get(`${A}|appearance`).hairColor === 9, 'G1: ...the look the engine saved stands');
  ok(!audits.some((t) => /changed their look/.test(t)), 'G1: ...with no new audit line (log only)', audits);
  const decided = () => alogs.filter((l) => /^appearance: Brand changed look: client incapable \(no face ask in \d+ s after its character loaded\), nothing charged, cooldown started$/.test(l)).length;
  ok(decided() === 1, 'G1: ...and the decision is logged', alogs);
  let v = gate('extras', false);
  ok(v.ok && !v.paid && gold() === 800, 'G1: ...the overlays and body sliders of that close are kept with it, as a paid close\'s', v);
  v = gate('face', true);
  ok(!v.ok && v.code === 'waived', 'G1: ...but a face from it (that client had the calls after all) is not taken free, first save or not', v);
  openEditor();
  ok(pers.at(-1) === 'You can change your appearance again in 24 hours.' && !globalThis.__dboAppearanceEdit.pending(A), 'G1: the daily wait holds the next one', pers.at(-1));
  props.set(`${A}|private.dboAppearanceAt`, 0);
  openEditor(); closeEditor(Object.assign(look(), { hairColor: 7 }));
  ok(gold() === 800 && decided() === 2, 'G1: every waived change is logged, not once per 10 min', alogs);

  // End to end: a face upload into that waived window is refused and the player told
  reset(); incapable(); fs.rmSync(DIR, { recursive: true, force: true }); take(); loadAppearance();
  openEditor(); closeEditor(Object.assign(look(), { hairColor: 9 }));
  upload(1, 0.3); await settle();
  ok(take().some((x) => x.p.customPacketType === 'dboPresetRefused' && x.p.reason === 'waived') && !fs.existsSync(fileOf(A)) && gold() === 800,
    'G1: a face uploaded after a waived change is refused \'waived\', nothing stored or charged', fs.existsSync(fileOf(A)));
  ok(sys.at(-1) === 'Your RaceMenu face changes weren\'t saved: your look change was free because your game client seemed unable to save face sliders. You were not charged for them. Ask a GM if this is wrong.', 'G1: ...and the player is told why', sys.at(-1));
  ok(fc(A).state === 'capable', 'G1: ...and that client counts as capable from then on', fc(A));

  // Under 500 gold: the editor opens, as the change it saves is free
  reset(undefined, 100); incapable(); loadAppearance();
  openEditor();
  ok(globalThis.__dboAppearanceEdit.pending(A) && /costs no gold/.test(pers.at(-1)), 'G1: 100 gold: the editor still opens', pers.at(-1));
  closeEditor(Object.assign(look(), { hairColor: 9 }));
  ok(gold() === 100 && props.get(`${A}|appearance`).hairColor === 9, 'G1: ...and the new look is kept free', gold());
  reset(undefined, 100); M = loadPresets(); M.state.faceClientsSince = 1; loaded(A, 5000); loadAppearance();
  openEditor();
  ok(pers.at(-1) === 'Changing your appearance costs 500 gold. You have 100.', 'G1: ...a client not known incapable needs the gold as before', pers.at(-1));

  // An unchanged close: overlays and body sliders save on that client, so they are priced as usual
  reset(); incapable(); loadAppearance();
  openEditor(); closeEditor(look());
  ok(sys.at(-1) === `Your standard look is unchanged. RaceMenu-only changes (extra sliders, sculpt, overlays) cost 500 gold and are charged when they are saved. Your game client can't save face sliders right now, so only overlays and body sliders can be kept from this editor. ${NOTE}`,
    'G1: an unchanged close says what is kept', sys.at(-1));
  ok(alogs.some((l) => /^appearance: Brand unchanged look: client incapable \(.*\), face sliders not kept, overlays and body sliders at the usual price$/.test(l)), 'G1: ...and is logged', alogs);
  v = gate('extras', false);
  ok(v.ok && v.paid === 500 && gold() === 300 && lastAt() > 0, 'G1: ...its window is priced: changed extras cost 500 gold and start the wait', [v, gold()]);
  reset(); incapable(); loadAppearance();
  openEditor(); closeEditor(look());
  v = gate('extras', true);
  ok(v.ok && v.free && gold() === 800, 'G1: ...a first extras save is free as before', v);

  // A free /appearance: the free change is kept, the daily wait starts and then holds even with it
  reset(); incapable(); loadAppearance({ freeChanges: 1 });
  openEditor();
  ok(pers.at(-1) === `The appearance editor is open. This change is free (your one free appearance change). Your game client can't save face sliders right now, so a new look costs no gold and keeps your free change (the daily wait still starts); changing only overlays or body sliders uses it. ${NOTE} Your race, sex and name stay as they are.`,
    'G1: a free editor says so when it opens', pers.at(-1));
  closeEditor(Object.assign(look(), { hairColor: 9 }));
  ok(!freeUsed() && gold() === 800 && lastAt() > 0 && sys.at(-1) === `Your new look is saved. ${NO_FACE} Your free appearance change is still yours.`,
    'G1: a free /appearance keeps its free change', [freeUsed(), lastAt(), sys.at(-1)]);
  ok(alogs.some((l) => /changed look: client incapable \(.*\), nothing charged, free change kept, cooldown started$/.test(l)), 'G1: ...logged', alogs);
  openEditor();
  ok(pers.at(-1) === `You can change your appearance again in 24 hours. Your game client can't save face sliders right now, so your free appearance change is kept for later. ${NOTE}`, 'G1: the next one waits for the daily wait, free change or not', pers.at(-1));
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); await settle(); take();
  openEditor(); closeEditor(Object.assign(look(), { hairColor: 6 }));
  ok(freeUsed() === 1 && gold() === 800 && /used your free appearance change/.test(sys.at(-1)), 'G1: once the client asks for its face, the free change skips the wait and is used as usual', [freeUsed(), sys.at(-1)]);
  // Opened free inside the daily wait while the verdict was unknown, known incapable at the close: the free change pays as usual
  reset(); M = loadPresets(); M.state.faceClientsSince = 1; loaded(A, 5000); loadAppearance({ freeChanges: 1 });
  props.set(`${A}|private.dboAppearanceAt`, Date.now() - 3600000);
  openEditor();
  ok(globalThis.__dboAppearanceEdit.pending(A) && / Saving a new look uses it;/.test(pers.at(-1)), 'G1: unknown at the open: a free editor skips the wait as before', pers.at(-1));
  writeDiagLines(1, ['apr rmp cap err=natives']);
  closeEditor(Object.assign(look(), { hairColor: 9 }));
  ok(freeUsed() === 1 && gold() === 800 && /used your free appearance change/.test(sys.at(-1)), 'G1: ...incapable at the close: its free change is used, so a relog cannot skip the wait each time', [freeUsed(), sys.at(-1)]);
  ok(alogs.some((l) => /changed look: client incapable \(rmp cap err=natives\), free change used \(opened inside the daily wait\)$/.test(l)), 'G1: ...logged', alogs);

  // Capable or unknown: as before
  reset(); incapable(); packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); await settle(); take(); loadAppearance();
  openEditor();
  ok(pers.at(-1) === 'The appearance editor is open. Saving a new look costs 500 gold; closing it unchanged costs nothing. Your race, sex and name stay as they are.', 'G1: a client that asked: the editor opens as before', pers.at(-1));
  closeEditor(Object.assign(look(), { hairColor: 9 }));
  ok(gold() === 300 && lastAt() > 0 && sys.at(-1) === 'Your new look is saved. 500 gold paid.', 'G1: ...and is paid as before', [gold(), sys.at(-1)]);
  ok(alogs.some((l) => /changed look: client capable \(asked for a face\), usual price/.test(l)), 'G1: ...and that decision is logged as well', alogs);
  reset(); M = loadPresets(); M.state.faceClientsSince = 1; loaded(A, 5000); loadAppearance();
  openEditor(); closeEditor(Object.assign(look(), { hairColor: 9 }));
  ok(gold() === 300 && lastAt() > 0, 'G1: unknown (5 s after its connect): paid as before', gold());
  reset(); incapable(); loadAppearance({ faceClientGuard: false });
  openEditor(); closeEditor(Object.assign(look(), { hairColor: 9 }));
  ok(gold() === 300, 'G1: appearance.faceClientGuard false: charged as before', gold());
  reset(); incapable(); loadAppearance({ faceClientGuardUntil: new Date(Date.now() - 60000).toISOString() });
  openEditor(); closeEditor(Object.assign(look(), { hairColor: 9 }));
  ok(gold() === 300 && /^Your new look is saved\. 500 gold paid\.$/.test(sys.at(-1)), 'G1: past appearance.faceClientGuardUntil: charged as before', [gold(), sys.at(-1)]);
  reset(); incapable(); loadAppearance({ faceClientGuardUntil: new Date(Date.now() + 86400000).toISOString(), faceClientNote: 'Update your client to fix it.' });
  openEditor(); closeEditor(Object.assign(look(), { hairColor: 9 }));
  ok(gold() === 800 && sys.at(-1) === 'Your new look is saved. Your game client can\'t save face sliders right now, so nothing was charged. Update your client to fix it.',
    'G1: before it: waived, with the note from appearance.faceClientNote', [gold(), sys.at(-1)]);
  reset(); incapable(); loadAppearance({ faceClientNote: '' });
  openEditor(); closeEditor(Object.assign(look(), { hairColor: 9 }));
  ok(sys.at(-1) === 'Your new look is saved. Your game client can\'t save face sliders right now, so nothing was charged.', 'G1: an empty faceClientNote: no note', sys.at(-1));
  reset(); incapable(); loadAppearance();
  const realFc = globalThis.__dboFaceClient; delete globalThis.__dboFaceClient;
  openEditor(); closeEditor(Object.assign(look(), { hairColor: 9 }));
  ok(gold() === 300 && alogs.some((l) => /client unknown \(racemenupresets\.js not loaded\), usual price/.test(l)), 'G1: racemenupresets.js not loaded: charged as before', [gold(), alogs]);
  globalThis.__dboFaceClient = realFc;

  // Found out only after an unchanged close (the trace): its extras are still priced, as they save
  reset(); M = loadPresets(); M.state.faceClientsSince = 1; loaded(A, 5000); loadAppearance();
  openEditor(); closeEditor(look());
  ok(/^Your standard look is unchanged\. RaceMenu-only changes .* cost 500 gold and are charged when they are saved\.$/.test(sys.at(-1)), 'G1: unknown at an unchanged close: priced window as before', sys.at(-1));
  writeDiagLines(1, ['apr rmp cap err=natives']);
  v = gate('extras', false);
  ok(v.ok && v.paid === 500 && gold() === 300, 'G1: the trace after it: its extras are charged as usual', [v, gold()]);

  // ---- G2: raceDesc beside the race (racemenupresets.js) ----
  online = [A, B];
  fs.rmSync(DIR, { recursive: true, force: true });
  reset(MAORMER); M = loadPresets(); loaded(A, 5000); loaded(B, 5000);
  globalThis.__dboRaceMenuSaveGate = () => ({ ok: true });
  upload(1, 0.4); await settle();
  let doc = JSON.parse(fs.readFileSync(fileOf(A), 'utf8'));
  ok(doc.race === MAORMER && doc.raceDesc === `192ede:${DLE}`, 'G2: a new face keeps raceDesc beside the race', [doc.race, doc.raceDesc]);
  props.set(`${A}|appearance`, look(BRETON));
  fs.unlinkSync(fileOf(A)); M.state.cache.delete('ff000101');
  upload(1, 0.5); await settle();
  doc = JSON.parse(fs.readFileSync(fileOf(A), 'utf8'));
  ok(doc.race === BRETON && !('raceDesc' in doc), 'G2: no raceDesc when the desc does not name the id back', doc.raceDesc);
  take();

  // On read: raceDesc gives this load order's id; a file without it keeps the id it has (the race is not in the family table)
  props.set(`${A}|appearance`, look(NORD));
  let h = store(A, { race: OLD(GOBLIN), raceDesc: `d62:${DLE}` }, 0.6);
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' }); await settle(); pumpAll();
  ok(answerOf(take(), B, A).some((p) => p.customPacketType === 'dboPresetMeta' && p.hash === h && p.race === GOBLIN), 'G2: a face with raceDesc is served on the race it names now (49000d62, not 48000d62)');
  h = store(A, { race: OLD(GOBLIN) }, 0.6);
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' }); await settle(); pumpAll();
  ok(answerOf(take(), B, A).some((p) => p.customPacketType === 'dboPresetMeta' && p.race === OLD(GOBLIN)), 'G2: one without it whose owner is on another race keeps its own id');
  store(A, { race: OLD(GOBLIN), raceDesc: 'd99:Gone.esp' }, 0.6);
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' }); await settle(); pumpAll();
  ok(answerOf(take(), B, A).some((p) => p.customPacketType === 'dboPresetMeta' && p.race === OLD(GOBLIN)), 'G2: a raceDesc this load order cannot name: the stored id stands');

  // A face saved before raceDesc, on the DLE's old index: the owner is answered it, not none
  props.set(`${A}|appearance`, look(GOBLIN));
  h = store(A, { race: OLD(GOBLIN) }, 0.7);
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); await settle(); pumpAll();
  let s = answerOf(take(), A, A);
  ok(s.length === 1 && s[0].customPacketType === 'dboPresetMeta' && s[0].self === true && s[0].race === GOBLIN, 'G2: an owner on 49000d62 with a face saved on 48000d62 gets it, on the race they have', s);
  props.set(`${A}|appearance`, look(MAORMER_V));
  h = store(A, { race: OLD(MAORMER) }, 0.7);
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); await settle(); pumpAll();
  s = answerOf(take(), A, A);
  ok(s.length === 1 && s[0].customPacketType === 'dboPresetMeta' && s[0].race === MAORMER_V, 'G2: a Maormer face saved on 48192ede goes on their vampire (the family table, through the low 24 bits)', s);
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' }); await settle(); pumpAll();
  s = answerOf(take(), B, A);
  ok(s.length === 1 && s[0].race === MAORMER_V, 'G2: ...and watchers are sent it on that race too', s);
  props.set(`${A}|appearance`, look(NORD));
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); await settle(); pumpAll();
  s = answerOf(take(), A, A);
  ok(s.length === 1 && s[0].customPacketType === 'dboPresetNone', 'G2: another family is still none to its owner', s);

  // Only full plugins' ids, only without raceDesc
  ok(M.docRace({ race: 0x48192ede }, 0x49192ede) === 0x49192ede && M.docRace({ race: 0x05000800 }, 0xfd000800) === 0xfd000800, 'G2: full plugins (05-FD): the same low 24 bits are the same record');
  ok(M.docRace({ race: 0x01013746 }, 0x02013746) === 0x01013746 && M.docRace({ race: 0x04000800 }, 0x05000800) === 0x04000800, 'G2: Skyrim.esm and its masters (00-04) never match that way');
  ok(M.docRace({ race: 0xfe000800 }, 0xfe100800) === 0xfe000800 && M.docRace({ race: 0xff000800 }, 0x49000800) === 0xff000800, 'G2: nor do a light plugin\'s (FE) or a created (FF) id');
  ok(M.docRace({ race: 0x48192ede, raceDesc: `192ede:${DLE}` }, 0x47192ede) === 0x48192ede, 'G2: nor a face that has raceDesc');
  ok(M.docRace({ race: 0x48192ede }, NORD) === MAORMER && M.docRace({ race: 0x48123456 }, NORD) === 0x48123456, 'G2: a family table id stands in when the live race is not the same record');
  ok(M.docRace({ race: OTHER }, GOBLIN) === OTHER && M.docRace({ race: MAORMER }, 0x4a192ede) === MAORMER, 'G2: an id that still names a RACE here (another plugin\'s, same low 24 bits) is never taken for a moved one');
  props.set(`${A}|appearance`, look(GOBLIN));
  store(A, { race: OTHER }, 0.8);
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); await settle(); pumpAll();
  s = answerOf(take(), A, A);
  ok(s.length === 1 && s[0].customPacketType === 'dboPresetNone', 'G2: ...so an owner on 49000d62 with a face saved on 4a000d62 is answered none, as before', s);

  // /appearance on such a face: priced as any change, no longer refused 'otherrace'
  reset(GOBLIN); M = loadPresets(); loaded(A, 5000); loadAppearance();
  store(A, { race: OLD(GOBLIN) }, 0.1);
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); await settle(); pumpAll(); take();
  await wait(5);
  openEditor(); closeEditor(look(GOBLIN));
  upload(1, 0.1); await settle();
  ok(plogs.some((l) => /ff000101 \(profile 7\) face unchanged/.test(l)) && gold() === 800, 'G2: the same face again on the moved race: unchanged, nothing charged', [gold(), plogs.slice(-2)]);
  upload(1, 0.2); await settle();
  const refusals = take().filter((x) => x.p.customPacketType === 'dboPresetRefused');
  doc = JSON.parse(fs.readFileSync(fileOf(A), 'utf8'));
  ok(!refusals.length && gold() === 300 && /RaceMenu changes are saved\. 500 gold paid/.test(sys.at(-1)), 'G2: a changed face is paid and saved, not refused otherrace', [refusals.map((x) => x.p.reason), gold(), sys.at(-1)]);
  ok(doc.race === GOBLIN && doc.raceDesc === `d62:${DLE}` && doc.hash === P.hashText(P.encodeFace(face(0.2))), 'G2: ...and stored on the race it has now, with raceDesc', [doc.race, doc.raceDesc]);
  reset(NORD); M = loadPresets(); loaded(A, 5000); loadAppearance();
  store(A, { race: OLD(GOBLIN) }, 0.1);
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); await settle(); pumpAll(); take();
  await wait(5);
  openEditor(); closeEditor(look(NORD));
  upload(1, 0.2); await settle();
  ok(take().some((x) => x.p.customPacketType === 'dboPresetRefused' && x.p.reason === 'otherrace') && gold() === 800, 'G2: a face of another race is still refused otherrace from /appearance');
  reset(GOBLIN); M = loadPresets(); loaded(A, 5000); loadAppearance();
  store(A, { race: OTHER }, 0.1);
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); await settle(); pumpAll(); take();
  await wait(5);
  openEditor(); closeEditor(look(GOBLIN));
  upload(1, 0.2); await settle();
  ok(take().some((x) => x.p.customPacketType === 'dboPresetRefused' && x.p.reason === 'otherrace') && gold() === 800, 'G2: ...and so is one saved on 4a000d62 for an owner on 49000d62 (another plugin\'s race, not a moved one)');

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* the scratch folder */ }
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  harness threw', e.stack); process.exit(1); });
