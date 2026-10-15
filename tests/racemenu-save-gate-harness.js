// The RaceMenu save window (appearance.js __dboRaceMenuSaveGate, 9 Oct): what skee keeps (face sliders and sculpt,
// racemenupresets.js; overlays, scales and morphs, appearanceextras.js) arrives a few seconds after the editor closes and is
// stored only if that editor was one the server opened and its look was not put back; an /appearance closed with the
// vanilla look unchanged pays for a RaceMenu-only change when it arrives (a first save of each kind is free); the console's
// showracemenu saves nothing; a staff test list limits who saves. Stub mp, the real modules.
// 10 Oct review probes (each failed at 4f6f30bd): S1 a plain "none" (never "off"); R1 an editor open from before this
// session; S2/R2 a vampire's face and a face stored on another race; R3 'changed' on the face content; R4 an extras clear
// through the gate; R5 no face clear from /appearance; S3 dboPresetRefused; S5 the player told.
// 10 Oct review 2 (each failed at 8817d217): item 1 probe 5a, a kept scale sent back after an unchanged close is no change
// and costs nothing; (a) probe 10a, a face write that fails gives the gold back; item 3 an unreadable extras store refuses
// at 0 gold; (b) a GM /chargen clear keeps the face as a .cleared copy.
// 10 Oct review 2-e2e: E4 a console edit of a stored face is refused noeditor, not notloaded; E5 a face made on a head the
// guard swapped back (finish()) is refused headswap, uncharged. 12 Oct re-review, server-data 4: only one with a sculpt on a
// head the stored face has no sculpt on; a slider-only face, or one sculpted only where the stored face is, saves and pays.
// The paid rules run with free changes off (freeChanges 0, 15 Oct): the free change is tests/appearance-free-harness.js.
//   node tests/racemenu-save-gate-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPEARANCE = path.join(ROOT, 'appearance.js');
const PRESETS = path.join(ROOT, 'racemenupresets.js');
const EXTRAS = path.join(ROOT, 'appearanceextras.js');
let fails = 0;
const ok = (c, label, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${label}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => { for (let t = 0; t < ms && !fn(); t += 10) await wait(10); return fn(); };
// File reads under way, counted as racemenu-presets-harness.js counts them: racemenupresets.js answers (and checks) a face
// only once its file is read, and on a loaded disk (the live server's, with the run under ionice idle) a read or a write
// outlasted the fixed waits here, so about one run in two failed a check at random (12 Oct: R1, R1 (b), item 3)
let pendingReads = 0;
{
  const realRead = fs.readFile;
  fs.readFile = (...x) => {
    const cb = x[x.length - 1];
    if (typeof cb !== 'function') return realRead(...x);
    pendingReads++; x[x.length - 1] = (...r) => { pendingReads--; cb(...r); };
    return realRead(...x);
  };
}
// appearanceextras.js has no change waiting for its write and none being written (or writes are refused)
const extrasIdle = () => { const s = globalThis.__dboAppearanceExtras; return !s || !!s.noWrite || !(s.dirty || s.timer || s.writing); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-rmgate-'));

const A = 0xff000101, B = 0xff000202;
let props, sys, audits, cmds;
const look = () => ({ raceId: 0x13746, isFemale: false, name: 'Brand Stoneborn', weight: 50, skinColor: 1, hairColor: 2, headpartIds: [1, 2], headTextureSetId: 3, options: [0], presets: [0], tints: [] });
const loadAppearance = (gold, extra, top) => {
  props = new Map([[`${A}|inventory`, { entries: [{ baseId: 0xf, count: gold }] }], [`${A}|appearance`, look()], [`${A}|profileId`, 7],
    [`${B}|inventory`, { entries: [] }], [`${B}|appearance`, look()], [`${B}|profileId`, 8]]);
  sys = []; audits = []; cmds = new Map();
  delete require.cache[APPEARANCE];
  delete globalThis.__dboRaceMenuSaveWindows; delete globalThis.__dboRaceMenuRefusedToldAt; delete globalThis.__dboAppearanceRefusedAt;
  globalThis.__dboCombatAt = new Map(); globalThis.__dboIsDowned = null; globalThis.__dboBeastOriginalRace = null; globalThis.__dboDungeonCells = new Set();
  globalThis.__dboTellsRetake = () => {}; globalThis.__dboFeralDue = new Map();
  return require(APPEARANCE)({
    mp: { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v), setRaceMenuOpen: () => {}, lookupEspmRecordById: () => { throw new Error('no record'); } },
    log: () => {}, personal: () => {}, system: (a, t) => sys.push(t), audit: (t) => audits.push(t), who: () => 'Brand',
    registerChatCommand: (n, fn) => cmds.set(n, fn), cfg: Object.assign({ appearance: Object.assign({ cost: 500, cooldownHours: 24, freeChanges: 0 }, extra || {}) }, top || {}),
    userOf: () => 3, profileOf: (a) => Number(props.get(`${a >>> 0}|profileId`)), later: () => {},
  });
};
const gold = () => props.get(`${A}|inventory`).entries.filter((e) => e.baseId === 0xf).reduce((s, e) => s + e.count, 0);
const openEditor = () => cmds.get('appearance')(A, '');
const closeEditor = (app) => { props.set(`${A}|appearance`, JSON.parse(JSON.stringify(app))); return globalThis.__dboAppearanceEdit.finish(A, app); };
const gate = (what, first) => globalThis.__dboRaceMenuSaveGate(A, what, first);

// ---- appearance.js: the window and its price ----
loadAppearance(800);
ok(typeof globalThis.__dboRaceMenuSaveGate === 'function', 'appearance.js installs the gate');
ok(gate('face', false).ok === false, 'no editor closed through the server: refused');

openEditor(); closeEditor(Object.assign(look(), { hairColor: 9 }));
ok(gold() === 300, 'a changed look is paid at the close as before', gold());
let v = gate('face', false);
ok(v.ok && !v.paid && gold() === 300, 'after a paid close the face is saved with no second charge', v);
ok(gate('extras', false).ok && gold() === 300, '...and so are the extras of that close');

loadAppearance(800); openEditor(); closeEditor(look());
ok(gold() === 800 && sys.at(-1) === 'Your standard look is unchanged. RaceMenu-only changes (extra sliders, sculpt, overlays) cost 500 gold and are charged when they are saved.', 'an unchanged vanilla look still costs nothing at the close, and the player is told RaceMenu-only changes are charged when saved', sys.at(-1));
v = gate('face', true);
ok(v.ok && v.free && gold() === 800 && !props.get(`${A}|private.dboAppearanceAt`), 'a first face save after an unchanged close is free and starts no cooldown', v);
v = gate('face', false);
ok(v.ok && v.paid === 500 && gold() === 300 && Number(props.get(`${A}|private.dboAppearanceAt`)) > 0 && /RaceMenu changes are saved. 500 gold paid/.test(sys.at(-1)),
  'a RaceMenu-only change (not the first) is paid when it arrives, and the cooldown starts', [v, gold(), sys.at(-1)]);
v = gate('extras', false);
ok(v.ok && !v.paid && gold() === 300, 'one charge covers the extras of the same close', v);

loadAppearance(100); props.set(`${A}|inventory`, { entries: [{ baseId: 0xf, count: 800 }] }); openEditor();
props.set(`${A}|inventory`, { entries: [{ baseId: 0xf, count: 100 }] }); closeEditor(look());
v = gate('face', false);
ok(!v.ok && v.reason === 'gold' && gold() === 100 && /weren't saved/.test(sys.at(-1)), 'a RaceMenu-only change without the gold is not saved, and the player is told', [v, sys.at(-1)]);

loadAppearance(800, { raceMenuFirstSaveFree: false }); openEditor(); closeEditor(look());
v = gate('face', true);
ok(v.ok && v.paid === 500 && gold() === 300, 'raceMenuFirstSaveFree false: a first save is paid too', v);

loadAppearance(800); openEditor(); closeEditor(Object.assign(look(), { raceId: 0x13745 }));
ok(gate('face', true).ok === false && gold() === 800, 'a race change put back: nothing of that close is saved, even a first');
loadAppearance(800); openEditor(); props.set(`${A}|inventory`, { entries: [{ baseId: 0xf, count: 20 }] }); closeEditor(Object.assign(look(), { hairColor: 9 }));
ok(gate('face', true).ok === false, 'gold spent while editing (look put back): nothing saved');

loadAppearance(0);
globalThis.__dboAppearanceEdit.raceMenuClosed(A, true, 'creation');
v = gate('face', false);
ok(v.ok && !v.paid && v.kind === 'creation', 'creation (or a reroll, a GM\'s /chargen) closed: saved, free', v);
globalThis.__dboAppearanceEdit.raceMenuClosed(A, false, '');
ok(gate('face', true).ok === false, 'the console\'s showracemenu closed after it: nothing saved');

loadAppearance(0, { raceMenuSaveWindowSeconds: 10 });
globalThis.__dboAppearanceEdit.raceMenuClosed(A, true, 'creation');
const realNow = Date.now;
Date.now = () => realNow() + 11000;
ok(gate('face', true).ok === false, 'an upload after the window (10 s here) is not saved');
Date.now = realNow;

// A hot reload keeps an open window
loadAppearance(0); globalThis.__dboAppearanceEdit.raceMenuClosed(A, true, 'chargen');
delete require.cache[APPEARANCE];
require(APPEARANCE)({ mp: { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, val) => props.set(`${id}|${k}`, val) }, log: () => {}, personal: () => {}, system: () => {}, audit: () => {},
  who: () => 'Brand', registerChatCommand: () => {}, cfg: {}, userOf: () => 3, profileOf: () => 7, later: () => {} });
ok(gate('face', false).ok === true, 'a hot reload of appearance.js keeps an open window');

// Both modules switched off (the shipped config, 10 Oct): no price is named for a save that never comes, and a close says
// RaceMenu-only details are not kept
const OFF = { racemenuPresets: { enabled: false, testProfiles: [] }, appearanceExtras: { enabled: false, testProfiles: [] } };
const NOT_KEPT = 'RaceMenu-only details (extra sliders, sculpt, overlays) are not saved yet and are gone when you log out.';
loadAppearance(800, null, OFF); openEditor(); closeEditor(look());
ok(gold() === 800 && sys.at(-1) === `Your look is unchanged, so nothing was charged. ${NOT_KEPT}` && !props.get(`${A}|private.dboAppearanceAt`),
  'switched off: an unchanged close costs nothing and says RaceMenu-only details are not kept', sys.at(-1));
ok(gate('face', true).ok === false && gate('extras', false).ok === false && gold() === 800, 'switched off: no priced window is left open');
loadAppearance(800, null, OFF); openEditor(); closeEditor(Object.assign(look(), { hairColor: 9 }));
ok(gold() === 300 && sys.at(-1) === `Your new look is saved. 500 gold paid. ${NOT_KEPT}`, 'switched off: a paid change is saved and says RaceMenu-only details are not kept', sys.at(-1));
// One module on is enough; a staff test list counts only its own profiles (A is profile 7)
loadAppearance(800, null, { racemenuPresets: { enabled: false }, appearanceExtras: { enabled: true, testProfiles: [] } }); openEditor(); closeEditor(look());
ok(/^Your standard look is unchanged\. RaceMenu-only changes/.test(sys.at(-1)), 'one module on: the price is named as before', sys.at(-1));
loadAppearance(800, null, { racemenuPresets: { enabled: true, testProfiles: [8] }, appearanceExtras: { enabled: false } }); openEditor(); closeEditor(look());
ok(sys.at(-1).endsWith(NOT_KEPT) && gate('face', true).ok === false, 'on for a staff test list without this player: not kept, no window', sys.at(-1));
loadAppearance(800, null, { racemenuPresets: { enabled: true, testProfiles: [7] }, appearanceExtras: { enabled: false } }); openEditor(); closeEditor(look());
ok(/^Your standard look is unchanged\. RaceMenu-only changes/.test(sys.at(-1)) && gate('face', true).ok === true, 'on for a staff test list with this player: priced window as before', sys.at(-1));

// ---- gamemode.js wiring ----
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const hook = src.slice(src.indexOf('const appearanceHook ='), src.indexOf('appearanceHook.__dbo = true'));
ok(/raceMenuClosed\(a, !!isAllowed, kind\)/.test(hook) && hook.indexOf('raceMenuClosed') > hook.indexOf('__dboAppearanceEdit.finish'),
  'gamemode.js tells appearance.js of every close finish() does not take, allowed or not');
ok(/appearance\.js failed to load[^\n]*__dboRaceMenuSaveGate = null/.test(src), 'appearance.js failing to load leaves no gate behind (uploads refused)');

(async () => {
  // ---- racemenupresets.js behind the gate ----
  const users = { 1: A, 2: B };
  const sent = []; const logs = []; const timers = {};
  const P = require(PRESETS);
  // The race racemenupresets.js reads off each player's appearance (0x13746 NordRace, 0x88794 its vampire, 0x13741 BretonRace)
  const raceNow = new Map();
  const presetsApi = (extra) => ({
    mp: { get: (a, k) => (k === 'appearance' ? { raceId: raceNow.get(a >>> 0) || 0x13746 } : props.get(`${a >>> 0}|${k}`)) }, log: (...x) => logs.push(x.join(' ')),
    cfg: { racemenuPresets: Object.assign({ dir: path.join(TMP, 'racemenu-presets') }, extra || {}) },
    sendPacket: (a, p) => { sent.push({ to: a >>> 0, p }); return true; }, onlineActors: () => [A, B], actorOf: (u) => users[u] || 0,
    profileOf: (a) => { const x = props.get(`${a >>> 0}|profileId`); return x === undefined ? -1 : Number(x); }, every: (n, ms, fn) => { timers[n] = fn; },
  });
  const loadPresets = (extra) => { delete require.cache[PRESETS]; delete globalThis.__dboPresetState; return require(PRESETS)(presetsApi(extra)); };
  // Until every face write and file read under way is done (up to 30 s: a loaded disk takes longer than any fixed wait)
  const settle = async () => { for (let i = 0; i < 3000; i++) { await wait(10); const st = globalThis.__dboPresetState; if ((!st || !st.writing.size) && pendingReads === 0) break; } await wait(30); };
  const face = { version: { signature: 1163086675, formatVersion: 3, skseVersion: 1, runtimeVersion: 2 }, modNames: ['Skyrim.esm'], custom: [{ name: 'NoseBridge', value: 0.4 }], sculptDivisor: 10000, sculpt: [] };
  const face2 = Object.assign({}, face, { custom: [{ name: 'NoseBridge', value: -0.2 }] });
  const put = (userId, f, up) => { const t = P.encodeFace(f); globalThis.__dboPresetPacket(userId, { customPacketType: 'dboPresetPut', up, i: 0, n: 1, hash: P.hashText(t), race: 1, data: t }); };
  const fileOf = (a) => path.join(TMP, 'racemenu-presets', `${(a >>> 0).toString(16)}.json`);
  const drain = () => { for (let i = 0; i < 50; i++) if (timers.racemenuPresetSend) timers.racemenuPresetSend(); };
  // The owner's client asks for its own face at login and is sent it (the face is put back on the player); later, the
  // editor opens. skew moves the clock past racemenuPresets.loadSettleMs (10 s)
  const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
  // A login: a new connection, then the client's own face asked for and sent back
  globalThis.__dboConnectedAt = new Map([[A, Date.now()], [B, Date.now()]]);
  const faceSent = async (userId) => {
    globalThis.__dboConnectedAt.set(users[userId], Date.now());
    globalThis.__dboPresetPacket(userId, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); await settle(); drain(); skew += 11000;
  };

  loadAppearance(800); loadPresets();
  put(1, face, 1); await settle();
  ok(!fs.existsSync(fileOf(A)) && logs.some((l) => /face change not saved: no editor the server opened/.test(l)), 'a face uploaded with no server-opened editor is not saved (the console\'s showracemenu)', logs.slice(-2));
  openEditor(); closeEditor(look());
  put(1, face, 2); await settle();
  ok(fs.existsSync(fileOf(A)) && gold() === 800, 'after an unchanged /appearance close the first face is saved, free (none stored, so nothing to wait for)', gold());
  await faceSent(1);
  openEditor(); closeEditor(look());
  put(1, face, 3); await settle();
  ok(gold() === 800, 'the same face again is no change: nothing is charged', gold());
  put(1, face2, 4); await settle();
  ok(gold() === 300 && JSON.parse(fs.readFileSync(fileOf(A), 'utf8')).hash === P.hashText(P.encodeFace(face2)), 'a changed face in the same window is paid for and saved', gold());

  delete globalThis.__dboRaceMenuSaveGate;
  // (an editor opened after the face went back, as gamemode.js openCreator notes it)
  loadPresets(); await faceSent(1); globalThis.__dboRaceMenuOpenedAt.set(A, Date.now()); globalThis.__dboAppearanceEdit.raceMenuClosed(A, true, 'creation');
  put(1, face, 5); await settle();
  ok(JSON.parse(fs.readFileSync(fileOf(A), 'utf8')).hash === P.hashText(P.encodeFace(face2)) && logs.some((l) => /appearance\.js not loaded/.test(l)), 'no gate loaded: nothing is saved');
  loadPresets({ requireEditor: false }); await faceSent(1);
  put(1, face, 6); await settle();
  ok(JSON.parse(fs.readFileSync(fileOf(A), 'utf8')).hash === P.hashText(P.encodeFace(face)), 'requireEditor false: every upload is saved (the 7 Oct rule)');

  // The staff test list
  loadAppearance(0); globalThis.__dboAppearanceEdit.raceMenuClosed(B, true, 'creation');
  loadPresets({ testProfiles: [7] }); sent.length = 0;
  globalThis.__dboPresetPacket(2, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); drain();
  ok(sent.some((s) => s.to === B && s.p.customPacketType === 'dboPresetNone' && s.p.self === true) && !sent.some((s) => s.p.off !== undefined),
    'S1: testProfiles: a player not listed is answered a plain none, never off (a 0.3.90 client keeps off until Skyrim restarts)', sent);
  put(2, face, 7); await settle();
  ok(!fs.existsSync(fileOf(B)), '...and their upload is not saved');
  sent.length = 0;
  globalThis.__dboPresetPacket(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); drain(); await settle(); drain();
  ok(sent.some((s) => s.to === A && (s.p.customPacketType === 'dboPresetMeta' || s.p.customPacketType === 'dboPresetChunk')), 'a listed tester gets their own face back', sent.map((s) => s.p.customPacketType));

  // ---- 9 Oct review: a saved face is changed only once it was put back this session, and a clear is never paid for ----
  const hashOn = () => JSON.parse(fs.readFileSync(fileOf(A), 'utf8')).hash;
  const empty = Object.assign({}, face, { custom: [] });
  loadAppearance(800); loadPresets(); logs.length = 0;
  const before = hashOn();
  skew += 1000; globalThis.__dboConnectedAt.set(A, Date.now());   // a new session: nothing sent yet
  openEditor(); closeEditor(Object.assign(look(), { hairColor: 9 }));
  put(1, face2, 8); await settle();
  ok(hashOn() === before && gold() === 300 && logs.some((l) => /face change not saved: saved face not loaded yet \(never sent this session\)/.test(l)),
    'an upload before the owner was sent their saved face is refused, and charges nothing beyond the look', [gold(), logs.slice(-1)]);
  loadAppearance(800); loadPresets(); logs.length = 0;
  skew += 1000; globalThis.__dboConnectedAt.set(A, Date.now());
  globalThis.__dboPresetPacket(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); await settle(); drain();
  openEditor(); closeEditor(look());   // opened 0 s after the face went back
  put(1, face2, 9); await settle();
  ok(hashOn() === before && gold() === 800 && logs.some((l) => /saved face not loaded yet \(the editor opened before it was put back\)/.test(l)),
    'an editor opened within 10 s of the face being put back saves nothing and charges nothing', [gold(), logs.slice(-1)]);
  loadAppearance(800); loadPresets(); logs.length = 0; await faceSent(1);
  openEditor(); closeEditor(look());   // an unchanged /appearance: a priced window
  put(1, empty, 10); await settle();
  ok(fs.existsSync(fileOf(A)) && hashOn() === before && gold() === 800 && logs.some((l) => /face change not saved: a clear is never paid for/.test(l)),
    'the skeptic\'s case: an empty upload after an unchanged close is not charged and keeps the saved face', [gold(), logs.slice(-1)]);
  loadAppearance(800); loadPresets(); logs.length = 0; await faceSent(1);
  openEditor(); closeEditor(Object.assign(look(), { hairColor: 9 }));   // a paid close: a free window
  sent.length = 0;
  put(1, empty, 11); await settle();
  ok(fs.existsSync(fileOf(A)) && hashOn() === before && gold() === 300 && logs.some((l) => /face change not saved: a RaceMenu face is cleared only by staff or a reroll/.test(l)),
    'R5: an empty upload after a paid /appearance close no longer clears the saved face (and charges nothing more)', [gold(), logs.slice(-1)]);
  ok(sent.some((s) => s.to === A && s.p.customPacketType === 'dboPresetRefused' && s.p.hash === P.hashText(P.encodeFace(empty)) && s.p.reason === 'clear' && s.p.self === true && s.p.actor === A),
    'S3: the owner\'s client is told that clear was refused (dboPresetRefused with the empty upload\'s hash, reason clear)', sent.map((s) => s.p));
  ok(sys.some((t) => /Your saved RaceMenu face was kept/.test(t)), 'S5: the player is told the saved face was kept', sys.slice(-2));
  loadAppearance(800); loadPresets(); logs.length = 0; await faceSent(1);
  globalThis.__dboAppearanceEdit.chargenOpened(A); globalThis.__dboAppearanceEdit.raceMenuClosed(A, true, 'chargen');
  const beforeGmClear = fs.readFileSync(fileOf(A), 'utf8');
  put(1, empty, 12); await settle();
  ok(!fs.existsSync(fileOf(A)) && logs.some((l) => /face cleared/.test(l)), 'R5: a GM\'s /chargen (or a reroll, creation) may still clear it', logs.slice(-1));
  const clearedCopies = fs.readdirSync(path.dirname(fileOf(A))).filter((f) => /^ff000101\.json\.cleared-/.test(f));
  ok(clearedCopies.length === 1 && fs.readFileSync(path.join(path.dirname(fileOf(A)), clearedCopies[0]), 'utf8') === beforeGmClear,
    '(b): ...and the face it cleared is kept beside it as <key>.json.cleared-<time>-<pid>-<n>, as it was', clearedCopies);

  // ---- 10 Oct review probes ----
  const hashOf = (f) => P.hashText(P.encodeFace(f));
  const storeFace = (f, race) => {
    const t = P.encodeFace(f);
    fs.mkdirSync(path.dirname(fileOf(A)), { recursive: true });
    fs.writeFileSync(fileOf(A), JSON.stringify({ v: 1, actor: (A >>> 0).toString(16), profile: 7, race: race || 0x13746, hash: P.hashText(t), at: new Date().toISOString(), face: t }));
    if (globalThis.__dboPresetState) globalThis.__dboPresetState.cache.clear();
  };
  const raceOnFile = () => JSON.parse(fs.readFileSync(fileOf(A), 'utf8')).race;
  const refusals = () => sent.filter((s) => s.to === A && s.p.customPacketType === 'dboPresetRefused').map((s) => s.p);
  const changed = () => Object.assign(look(), { hairColor: 9 });

  // R1 (a): /appearance opened in session 1 is still open after a relog (the engine keeps RaceMenu open in the changeform
  // and the client reopens it at spawn); it closes with a changed look without any new opening in this session
  loadAppearance(800); loadPresets(); storeFace(face); logs.length = 0;
  openEditor();
  skew += 1000; await faceSent(1);
  closeEditor(changed()); sent.length = 0;
  put(1, face2, 20); await settle();
  ok(hashOn() === hashOf(face) && gold() === 300 && logs.some((l) => /saved face not loaded yet \(the editor was open from before this session\)/.test(l)),
    'R1 (a): an editor open from before this session (reopened at spawn) changes no saved face; only the look is paid', [gold(), logs.slice(-1)]);
  ok(refusals().length === 1 && refusals()[0].hash === hashOf(face2) && refusals()[0].reason === 'notloaded',
    'S3: dboPresetRefused names the refused upload\'s hash and the reason (notloaded)', refusals());
  ok(sys.some((t) => t === 'Your RaceMenu face changes weren\'t saved because your saved face was still loading. You were not charged for them. Wait a moment, then reopen /appearance and redo them.'),
    'S5: the player is told the face changes were not saved, not charged, and to redo them', sys.slice(-2));
  put(1, Object.assign({}, face2, { custom: [{ name: 'NoseBridge', value: -0.3 }] }), 21); await settle();
  ok(refusals().length === 2 && sys.filter((t) => /still loading/.test(t)).length === 1, 'S5: told once a minute per reason, the client is told every time', [refusals().length, sys]);
  // R1 (b): the same after a restart (the openings are in memory only)
  loadAppearance(800); loadPresets(); storeFace(face); logs.length = 0;
  openEditor(); globalThis.__dboRaceMenuOpenedAt.clear();
  skew += 1000; await faceSent(1);
  closeEditor(changed());
  put(1, face2, 22); await settle();
  ok(hashOn() === hashOf(face) && gold() === 300 && logs.some((l) => /the editor was open from before this session/.test(l)),
    'R1 (b): after a restart (no opening on record) the carried-over editor changes no saved face', [gold(), logs.slice(-1)]);
  // R1 (c): the carried-over editor closed with the look unchanged (a priced window): nothing is charged
  loadAppearance(800); loadPresets(); storeFace(face); logs.length = 0;
  openEditor();
  skew += 1000; await faceSent(1);
  closeEditor(look());
  put(1, face2, 23); await settle();
  ok(hashOn() === hashOf(face) && gold() === 800 && !props.get(`${A}|private.dboAppearanceAt`), 'R1 (c): an unchanged carried-over close with a new face: kept, 0 gold, no cooldown', gold());
  // ...and an editor opened in this session, after the face went back, still saves (the rule is not a blanket refusal)
  openEditor(); closeEditor(changed());
  put(1, face2, 24); await settle();
  ok(hashOn() === hashOf(face2) && gold() === 300, 'R1: an editor opened in this session after the face went back saves as before', gold());

  // S2: a face saved on NordRace, the player now a Nord vampire: sent with the vampire race, to the owner and to watchers
  loadAppearance(800); loadPresets(); storeFace(face, 0x13746); raceNow.set(A, 0x88794); sent.length = 0;
  globalThis.__dboConnectedAt.set(A, Date.now());
  globalThis.__dboPresetPacket(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' }); await settle(); drain();
  globalThis.__dboPresetPacket(2, { customPacketType: 'dboPresetGet', actor: A, have: '' }); await settle(); drain();
  const facePackets = (to) => sent.filter((s) => s.to === to && /^dboPreset(Meta|Chunk)$/.test(s.p.customPacketType)).map((s) => s.p);
  ok(facePackets(A).length === 2 && facePackets(A).every((p) => p.race === 0x88794) && facePackets(B).length === 2 && facePackets(B).every((p) => p.race === 0x88794),
    'S2: a face saved before a vampire turn is sent with the vampire race, to the owner and to a watcher', [facePackets(A), facePackets(B)].map((x) => x.map((p) => p.race)));
  raceNow.set(A, 0x13741); sent.length = 0;
  globalThis.__dboPresetPacket(2, { customPacketType: 'dboPresetGet', actor: A, have: '' }); await settle(); drain();
  ok(facePackets(B).length === 2 && facePackets(B).every((p) => p.race === 0x13746), 'S2: another race (not its vampire) keeps the stored race', facePackets(B).map((p) => p.race));
  // R2: the vampire changes the face in a paid /appearance: it was on them, so it is saved, with the race they have now
  raceNow.set(A, 0x88794); skew += 1000; await faceSent(1);
  openEditor(); closeEditor(changed());
  put(1, face2, 30); await settle();
  ok(hashOn() === hashOf(face2) && raceOnFile() === 0x88794 && gold() === 300, 'R2: a vampire\'s change to a face saved before the turn is saved (its vampire race on file)', [raceOnFile(), gold()]);
  // ...and a cure sends it back with the mortal race
  raceNow.set(A, 0x13746); sent.length = 0;
  globalThis.__dboPresetPacket(2, { customPacketType: 'dboPresetGet', actor: A, have: '' }); await settle(); drain();
  ok(facePackets(B).length === 2 && facePackets(B).every((p) => p.race === 0x13746), 'S2: after a cure the face saved as a vampire is sent with the mortal race', facePackets(B).map((p) => p.race));
  // R2: a face stored on NordRace, the player a Breton (a GM changed the race): /appearance does not replace it
  loadAppearance(800); loadPresets(); storeFace(face, 0x13746); raceNow.set(A, 0x13741); logs.length = 0;
  skew += 1000; await faceSent(1);
  openEditor(); closeEditor(changed()); sent.length = 0;
  put(1, face2, 31); await settle();
  ok(hashOn() === hashOf(face) && raceOnFile() === 0x13746 && gold() === 300 && logs.some((l) => /saved face is for race 13746, not changed/.test(l)),
    'R2: a paid /appearance does not replace a face stored on another race (only the look is paid)', [gold(), logs.slice(-1)]);
  ok(refusals().some((p) => p.reason === 'otherrace' && p.hash === hashOf(face2)) && sys.some((t) => /made for another race/.test(t)), 'R2: refused with reason otherrace, and the player is told', [refusals(), sys.slice(-1)]);
  loadAppearance(800); loadPresets(); logs.length = 0;
  skew += 1000; await faceSent(1);
  openEditor(); closeEditor(look());
  put(1, face2, 32); await settle();
  ok(hashOn() === hashOf(face) && gold() === 800, 'R2: an unchanged /appearance close with a face for another race: kept, 0 gold', gold());
  // A GM's /chargen may change the race: the same face handed back on the new race is stored again with it (it would
  // otherwise never go on there), and a changed one replaces it, free
  loadAppearance(800); loadPresets(); storeFace(face, 0x13746); logs.length = 0;
  skew += 1000; await faceSent(1);
  globalThis.__dboAppearanceEdit.chargenOpened(A); globalThis.__dboAppearanceEdit.raceMenuClosed(A, true, 'chargen');
  put(1, face, 33); await settle();
  ok(hashOn() === hashOf(face) && raceOnFile() === 0x13741 && gold() === 800, 'R2/R3: the same face handed back by a GM\'s /chargen on a new race is stored with that race, free', [raceOnFile(), gold()]);
  raceNow.delete(A);

  // R3: 'changed' is the face content: the same sliders and sculpt with another plugin list, skse version and map order
  // after an unchanged /appearance close are not a new face (nothing written, nothing charged)
  const HEAD = 'Actors\\Character\\Character Assets\\MaleHead.tri';
  const faceAB = { version: face.version, modNames: ['Skyrim.esm'], sculptDivisor: 10000,
    custom: [{ name: 'NoseBridge', value: 0.4 }, { name: 'ChinWidth', value: -0.3 }],
    sculpt: [{ host: HEAD, vertices: 100, data: [[1, 5, 5, 5], [7, -3, 2, 1]] }, { host: 'Actors\\Character\\Character Assets\\Mouth.tri', vertices: 50, data: [[2, 1, 1, 1]] }] };
  const faceBA = { version: Object.assign({}, face.version, { skseVersion: 99 }), modNames: ['Skyrim.esm', 'Dawnguard.esm'], sculptDivisor: 10000,
    custom: faceAB.custom.slice().reverse(),
    sculpt: [{ host: 'Actors\\Character\\Character Assets\\Mouth.tri', vertices: 50, data: [[2, 1, 1, 1]] }, { host: HEAD.toLowerCase(), vertices: 100, data: [[7, -3, 2, 1], [1, 5, 5, 5]] }] };
  ok(hashOf(faceAB) !== hashOf(faceBA) && typeof P.contentOf === 'function' && P.contentOf(P.faceFrom(JSON.parse(P.encodeFace(faceAB)))) === P.contentOf(P.faceFrom(JSON.parse(P.encodeFace(faceBA)))),
    'R3: the two texts differ, their content key does not');
  loadAppearance(800); loadPresets(); storeFace(faceAB); logs.length = 0;
  skew += 1000; await faceSent(1);
  openEditor(); closeEditor(look());
  const mtimeAB = fs.statSync(fileOf(A)).mtimeMs; sent.length = 0;
  put(1, faceBA, 40); await settle();
  ok(gold() === 800 && hashOn() === hashOf(faceAB) && fs.statSync(fileOf(A)).mtimeMs === mtimeAB && !refusals().length && !logs.some((l) => /face saved/.test(l)),
    'R3: an unchanged close re-sending the same face (other plugins, version, order): 0 gold, nothing written, nothing refused', [gold(), logs.slice(-1)]);
  put(1, Object.assign({}, faceBA, { custom: [{ name: 'NoseBridge', value: 0.5 }, { name: 'ChinWidth', value: -0.3 }] }), 41); await settle();
  ok(gold() === 300 && hashOn() !== hashOf(faceAB), 'R3: a real slider change in that window is still paid for and saved', gold());

  // S3: a short-of-gold refusal is sent to the client too (the gate itself tells the player)
  loadAppearance(800); loadPresets(); storeFace(face); skew += 1000; await faceSent(1);
  openEditor(); props.set(`${A}|inventory`, { entries: [{ baseId: 0xf, count: 800 }] }); closeEditor(look());
  props.set(`${A}|inventory`, { entries: [{ baseId: 0xf, count: 10 }] }); sent.length = 0;
  put(1, face2, 42); await settle();
  ok(hashOn() === hashOf(face) && refusals().length === 1 && refusals()[0].reason === 'gold' && sys.filter((t) => /weren't saved/.test(t)).length === 1,
    'S3: short of gold: dboPresetRefused reason gold, and one message (the gate\'s)', [refusals(), sys]);

  // (a) probe 10a: the face write fails (ENOSPC on the .tmp) after a priced window took the gold. The gold comes back, the
  // cooldown is as it was, the old face stays on disk and is what is served, the player is told it was not saved and not
  // charged (never that it was saved), the client gets dboPresetRefused (write), and nobody else hears of a new face
  loadAppearance(800); loadPresets(); storeFace(face); logs.length = 0;
  skew += 1000; await faceSent(1);
  openEditor(); closeEditor(look());   // unchanged: a priced window
  sys.length = 0; sent.length = 0;
  {
    const realWF = fs.writeFile;
    fs.writeFile = (f, d, cb) => (String(f).endsWith('.tmp') ? setImmediate(() => cb(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }))) : realWF(f, d, cb));
    try { put(1, face2, 60); await settle(); } finally { fs.writeFile = realWF; }
  }
  ok(gold() === 800 && hashOn() === hashOf(face) && !props.get(`${A}|private.dboAppearanceAt`),
    '(a) probe 10a: a face write that fails after the charge gives the 500 gold back, starts no cooldown, keeps the old face on disk', [gold(), props.get(`${A}|private.dboAppearanceAt`), logs.slice(-2)]);
  ok(sys.length === 1 && /face changes weren't saved: the server couldn't store them\. You were not charged/.test(sys[0]) && !sys.some((t) => /saved\. 500 gold paid/.test(t)),
    '(a): the player is told it was not saved and not charged, and never that it was saved', sys);
  ok(refusals().some((r) => r.reason === 'write' && r.hash === hashOf(face2)) && !sent.some((x) => x.to === B && x.p.customPacketType === 'dboPresetRev')
    && audits.some((t) => /could not be written: 500 gold given back/.test(t)), '(a): the client is told (write), nobody else hears of it, staff see the refund in the audit', [refusals(), audits.slice(-1)]);
  sent.length = 0;
  globalThis.__dboPresetPacket(2, { customPacketType: 'dboPresetGet', actor: A, have: '' }); await settle(); drain();
  ok(facePackets(B).length === 2 && facePackets(B)[0].hash === hashOf(face), '(a): the face served is the one on disk', facePackets(B).map((p) => p.hash));
  // The window's price is back: the same change again (the disk has room now) is charged once, then told saved and paid
  sys.length = 0;
  put(1, face2, 61); await settle();
  ok(gold() === 300 && hashOn() === hashOf(face2) && Number(props.get(`${A}|private.dboAppearanceAt`)) > 0 && sys.length === 1 && /RaceMenu changes are saved\. 500 gold paid/.test(sys[0]),
    '(a): the price is back on the window: the change sent again is saved and charged once, and told once it is on disk', [gold(), sys]);

  // E4 (10 Oct review 2-e2e, its S8 NOTE): with a face stored, a console showracemenu edit (no save window from the server)
  // was refused as notloaded, checked before the gate, and the player told their saved face "was still loading... reopen
  // /appearance and redo them". It is the gate's own noeditor now; the notloaded check runs only inside a save window
  loadAppearance(800); loadPresets(); storeFace(face); logs.length = 0;
  skew += 1000; await faceSent(1);
  globalThis.__dboAppearanceEdit.raceMenuClosed(A, false, '');   // the console's showracemenu closed (isAllowed false)
  sys.length = 0; sent.length = 0;
  put(1, face2, 70); await settle();
  ok(hashOn() === hashOf(face) && gold() === 800 && refusals().length === 1 && refusals()[0].reason === 'noeditor' && refusals()[0].hash === hashOf(face2)
    && logs.some((l) => /face change not saved: no editor the server opened/.test(l)) && !logs.some((l) => /not loaded yet/.test(l)),
  'E4: a console edit of a stored face is refused noeditor (not notloaded), the face kept, 0 gold', [refusals(), logs.slice(-1)]);
  ok(sys.length === 1 && /only \/appearance \(or a GM\) can change your saved look/.test(sys[0]) && !sys.some((t) => /still loading/.test(t)),
    'E4: ...and the player is told only /appearance or a GM saves it, not that it was still loading', sys);
  // ...inside a window the notloaded rule still holds (an editor the server opened before the face went back)
  loadAppearance(800); loadPresets(); storeFace(face); logs.length = 0;
  skew += 1000; globalThis.__dboConnectedAt.set(A, Date.now());   // a new session, the face not sent yet
  openEditor(); closeEditor(look()); sent.length = 0;
  put(1, face2, 71); await settle();
  ok(hashOn() === hashOf(face) && gold() === 800 && refusals().length === 1 && refusals()[0].reason === 'notloaded',
    'E4: inside a save window a face not yet put back is still refused notloaded', refusals());

  // E5 (10 Oct review 2-e2e G8, its S14b): a Breton man whose /appearance editor swapped in the Nord male head. The head
  // guard puts his own head back (finish()), so a sculpt made in that editor was made on the Nord head's .tri and would
  // not show on his own: charged 500 and hidden after a relog. The window is marked, and a face upload in it that carries
  // a sculpt on a head the stored face has none on is refused 'headswap', uncharged; the extras of that close are not
  // (they do not hang on the head). Narrowed (12 Oct re-review, server-data 4): a slider-only face, or one sculpted only on
  // heads the stored face is sculpted on, was not made on the swapped-in head, and saves and pays as from any close
  const BRETON_M = 0x51633, NORD_M = 0x5162f;
  const NORD_TRI = 'Actors\\Character\\Character Assets\\MaleHeadChargen.tri';
  const BRETON_TRI = 'Actors\\Character\\Character Assets\\MaleHeadBretonChargen.tri';
  const breton = () => Object.assign(look(), { raceId: 0x13741, headpartIds: [BRETON_M, 2] });
  const swapped = (extra) => Object.assign(breton(), { headpartIds: [2, NORD_M] }, extra || {});
  // face2 (a slider change) with a sculpt made on the swapped-in Nord head
  const onNord = Object.assign({}, face2, { sculptDivisor: 10000, sculpt: [{ host: NORD_TRI, vertices: 100, data: [[3, 40, -20, 10]] }] });
  // (a) the look unchanged once the head is back: a priced window
  loadAppearance(800); props.set(`${A}|appearance`, breton()); loadPresets(); storeFace(face, 0x13741); raceNow.set(A, 0x13741); logs.length = 0;
  skew += 1000; await faceSent(1);
  openEditor(); closeEditor(swapped());
  ok(JSON.stringify(props.get(`${A}|appearance`).headpartIds) === JSON.stringify([BRETON_M, 2]) && gold() === 800 && globalThis.__dboRaceMenuSaveWindows.get(A >>> 0).headswap === true,
    'E5: the guard put his own head back, nothing charged at the close, and the save window is marked headswap', [props.get(`${A}|appearance`).headpartIds, globalThis.__dboRaceMenuSaveWindows.get(A >>> 0)]);
  sys.length = 0; sent.length = 0;
  put(1, onNord, 80); await settle();
  ok(hashOn() === hashOf(face) && gold() === 800 && !props.get(`${A}|private.dboAppearanceAt`) && refusals().length === 1 && refusals()[0].reason === 'headswap' && refusals()[0].hash === hashOf(onNord)
    && logs.some((l) => /face change not saved: made on another race's head the editor swapped in \(own head kept\)/.test(l)),
  'E5: a face sculpted on the swapped-in head (a head the stored face has no sculpt on) is refused headswap: 0 gold, no cooldown, the saved face kept', [gold(), refusals(), logs.slice(-1)]);
  ok(sys.length === 1 && /another race's head, and sculpting done on it wouldn't show on your own head, which was kept\. You were not charged for them\. Slider changes without sculpting save as usual\./.test(sys[0]),
    'E5: ...and the player is told why, that nothing was charged, and that slider changes save', sys);
  // (e) the same priced headswap window: a slider-only change was not made on the head, and is saved and paid
  sys.length = 0; sent.length = 0;
  put(1, face2, 84); await settle();
  ok(hashOn() === hashOf(face2) && gold() === 300 && Number(props.get(`${A}|private.dboAppearanceAt`)) > 0 && !refusals().length && sys.length === 1 && /RaceMenu changes are saved\. 500 gold paid/.test(sys[0]),
    'E5 narrowed (e): in that window a slider-only face change is saved and charged 500 once, not refused', [gold(), refusals(), sys]);
  // (b) a first face (none stored) sculpted in that window is refused too: free or not, it would not show
  loadAppearance(800); props.set(`${A}|appearance`, breton()); loadPresets(); fs.rmSync(fileOf(A), { force: true }); logs.length = 0;
  skew += 1000; await faceSent(1);
  openEditor(); closeEditor(swapped()); sent.length = 0;
  put(1, onNord, 81); await settle();
  ok(!fs.existsSync(fileOf(A)) && gold() === 800 && refusals().length === 1 && refusals()[0].reason === 'headswap', 'E5: a first face sculpted on the swapped-in head is not kept either', refusals());
  // ...and a first face with sliders only, in the same window, is kept (free: the first save)
  sent.length = 0;
  put(1, face2, 85); await settle();
  ok(fs.existsSync(fileOf(A)) && hashOn() === hashOf(face2) && gold() === 800 && !refusals().length, 'E5 narrowed (e): a first slider-only face in that window is kept, free as a first save', [gold(), refusals()]);
  // (c) a paid look change with the swap: the look is paid once; the sculpted face is refused, the extras of that close are kept
  loadAppearance(800); props.set(`${A}|appearance`, breton()); loadPresets(); storeFace(face, 0x13741); logs.length = 0;
  skew += 1000; await faceSent(1);
  openEditor(); closeEditor(swapped({ hairColor: 9 })); sent.length = 0;
  put(1, onNord, 82); await settle();
  ok(hashOn() === hashOf(face) && gold() === 300 && refusals().length === 1 && refusals()[0].reason === 'headswap', 'E5: a paid close with the swap: only the look is paid, the sculpted face refused headswap', [gold(), refusals()]);
  v = gate('extras', false);
  ok(v.ok && !v.paid && gold() === 300, 'E5: ...and that close\'s extras are still kept, with no second charge', v);
  // (d) the same Breton without a swap saves his face as before
  loadAppearance(800); props.set(`${A}|appearance`, breton()); loadPresets(); storeFace(face, 0x13741); logs.length = 0;
  skew += 1000; await faceSent(1);
  openEditor(); closeEditor(breton()); sent.length = 0;
  put(1, face2, 83); await settle();
  ok(hashOn() === hashOf(face2) && gold() === 300 && !refusals().length, 'E5: with no swap the face change in a priced window is saved and paid as before', [gold(), refusals()]);
  // (f) a stored face sculpted on his own Breton head: in a headswap window, a face that adds a sculpt on the Nord head is
  // refused; one that keeps only the stored sculpt (its host in another case) with a slider change is saved and paid
  const ownSculpt = Object.assign({}, face, { sculptDivisor: 10000, sculpt: [{ host: BRETON_TRI, vertices: 100, data: [[5, 10, 10, 10]] }] });
  const ownPlusNord = Object.assign({}, ownSculpt, { custom: face2.custom, sculpt: ownSculpt.sculpt.concat(onNord.sculpt) });
  const ownSliders = Object.assign({}, ownSculpt, { custom: face2.custom, sculpt: [{ host: BRETON_TRI.toLowerCase(), vertices: 100, data: [[5, 10, 10, 10]] }] });
  loadAppearance(800); props.set(`${A}|appearance`, breton()); loadPresets(); storeFace(ownSculpt, 0x13741); logs.length = 0;
  skew += 1000; await faceSent(1);
  openEditor(); closeEditor(swapped()); sent.length = 0;
  put(1, ownPlusNord, 86); await settle();
  ok(hashOn() === hashOf(ownSculpt) && gold() === 800 && refusals().length === 1 && refusals()[0].reason === 'headswap' && refusals()[0].hash === hashOf(ownPlusNord),
    'E5 narrowed (f): with a sculpt stored on his own head, a face adding a sculpt on the swapped-in head is refused headswap, 0 gold', [gold(), refusals()]);
  sent.length = 0;
  put(1, ownSliders, 87); await settle();
  ok(hashOn() === hashOf(ownSliders) && gold() === 300 && !refusals().length,
    'E5 narrowed (f): ...and one keeping only the stored sculpt (any case) with a slider change is saved and charged 500 once', [gold(), refusals()]);
  raceNow.delete(A);

  // ---- appearanceextras.js behind the gate ----
  const xdir = fs.mkdtempSync(path.join(TMP, 'rmx-'));
  const cwd = process.cwd(); process.chdir(xdir);
  const xsent = []; const xlogs = [];
  // A fresh load (as at a restart) replaces the module before it only once that one has no write pending or in flight: its
  // timer would otherwise write its own, older store over the file later, under a check that had read it (12 Oct: item 3
  // found the R4 clear's write, orphaned by the next load, landing after it read the store)
  const loadExtrasNow = (extra) => { delete require.cache[EXTRAS]; delete globalThis.__dboAppearanceExtras; require(EXTRAS)({ mp: {}, log: (...x) => xlogs.push(x.join(' ')),
    cfg: { appearanceExtras: Object.assign({ writeDelayMs: 30, setMinSeconds: 0 }, extra || {}) }, sendPacket: (a, p) => { xsent.push([a >>> 0, p]); return true; },
    onlineActors: () => [A, B], profileOf: (a) => { const x = props.get(`${a >>> 0}|profileId`); return x === undefined ? -1 : Number(x); }, display: (a) => (a >>> 0).toString(16) }); };
  const loadExtras = async (extra) => { await until(extrasIdle, 30000); loadExtrasNow(extra); };
  const TEX = 'textures\\actors\\character\\overlays\\tattoo.dds';
  const xset = { customPacketType: 'dboAppearanceExtras', f: 0, ov: [['Body [Ovl0]', 9, 0, TEX]], tr: [], mo: [] };
  loadAppearance(800); await loadExtras();
  globalThis.__dboAppearanceExtrasPacket(A, xset);
  const kept = () => globalThis.__dboAppearanceExtras.store.chars[A.toString(16)];
  ok(!kept() && xlogs.some((l) => /not saved: no editor the server opened/.test(l)), 'extras with no server-opened editor are not saved', xlogs.slice(-1));
  ok(xsent.some(([to, p]) => to === A && p.customPacketType === 'dboAppearanceExtras' && p.self && p.rev === 0), '...and the stored (none) go back to the player');
  openEditor(); closeEditor(Object.assign(look(), { hairColor: 9 }));
  globalThis.__dboAppearanceExtrasPacket(A, xset);
  ok(kept() && kept().rev === 1 && gold() === 300, 'after a paid /appearance close the extras are saved with no second charge', gold());
  // R4: emptying the kept extras in an unchanged /appearance close (priced) is refused, not charged
  const xempty = { customPacketType: 'dboAppearanceExtras', f: 0, ov: [], tr: [], mo: [] };
  loadAppearance(800); openEditor(); closeEditor(look());
  globalThis.__dboAppearanceExtrasPacket(A, xempty);
  ok(kept() && kept().rev === 1 && kept().ov.length === 1 && gold() === 800 && xlogs.some((l) => /not saved: a clear is never paid for/.test(l)),
    'R4: an extras clear after an unchanged close is refused and costs nothing (rev 1 kept)', [kept(), gold(), xlogs.slice(-1)]);
  ok(sys.some((t) => /overlays and body sliders were kept/.test(t)), 'S5: the player is told their extras were kept', sys.slice(-2));
  // ...and after a paid look change it may be cleared (faces may not, R5)
  loadAppearance(800); openEditor(); closeEditor(Object.assign(look(), { hairColor: 9 }));
  globalThis.__dboAppearanceExtrasPacket(A, xempty);
  ok(kept() && kept().rev === 2 && !kept().ov.length && gold() === 300, 'R4: an extras clear after a paid close is kept, with no second charge', [kept(), gold()]);
  await loadExtras({ testProfiles: [8] }); xsent.length = 0;
  globalThis.__dboAppearanceExtrasPacket(A, { customPacketType: 'dboAppearanceExtrasGet', self: true });
  ok(!xsent.length, 'testProfiles: a player not listed is not answered');

  // Item 1 (probe 5a): a node scale of 1.13 saved after a paid close. The 0.3.90 client puts the kept value on through skee
  // (float32) and, after an UNCHANGED /appearance close a day later, reads it back, rounds it half-up to 4 decimals and
  // sends it (it differs from what the client last sent only by rounding). That is no change: no gold, no new revision
  loadAppearance(1300); await loadExtras();
  openEditor(); closeEditor(changed());
  globalThis.__dboAppearanceExtrasPacket(A, { customPacketType: 'dboAppearanceExtras', f: 0, ov: [], tr: [['NPC Belly', 'RSMPlugin', 1.13, 0]], mo: [] });
  const kept5a = kept().tr[0][2]; const rev5a = kept().rev;
  const readBack5a = Math.round(Math.fround(kept5a) * 10000) / 10000;
  skew += 25 * 3600 * 1000;   // past the cooldown
  openEditor(); closeEditor(changed());   // the look as it is now: an UNCHANGED close, a priced window
  const g5a = gold(); sys.length = 0;
  globalThis.__dboAppearanceExtrasPacket(A, { customPacketType: 'dboAppearanceExtras', f: 0, ov: [], tr: [['NPC Belly', 'RSMPlugin', readBack5a, 0]], mo: [] });
  ok(kept5a === 1.13 && readBack5a === 1.13 && g5a === 800 && gold() === g5a && kept().rev === rev5a && kept().tr[0][2] === 1.13 && !sys.some((t) => /gold paid/.test(t)),
    `item 1 (probe 5a): 1.13 is kept as ${kept5a} and read back as ${readBack5a} after an unchanged close: no charge, no new revision`, { kept5a, readBack5a, goldBefore: g5a, goldAfter: gold(), rev: [rev5a, kept().rev], sys });
  // ...and a later real change in that window is still paid for
  globalThis.__dboAppearanceExtrasPacket(A, { customPacketType: 'dboAppearanceExtras', f: 0, ov: [], tr: [['NPC Belly', 'RSMPlugin', 1.2, 0]], mo: [] });
  ok(gold() === g5a - 500 && kept().rev === rev5a + 1, 'item 1: a real scale change in that window is still paid for', [gold(), kept().rev]);

  // Item 3: the store is there but cannot be read at load (EIO): a change after an unchanged close is refused at 0 gold and
  // the player told; the file is kept byte for byte, nothing is written over it, and a reload reads it back. The write of
  // the change above lands first (it is what the store must hold)
  await until(extrasIdle, 30000);
  const XSTORE = path.join(xdir, 'appearance-extras.json');
  const xText = fs.readFileSync(XSTORE, 'utf8');
  loadAppearance(800);
  {
    const realReadSync = fs.readFileSync;
    fs.readFileSync = (f, ...r) => { if (path.resolve(String(f)) === XSTORE) { const e = new Error('EIO: i/o error, read'); e.code = 'EIO'; throw e; } return realReadSync(f, ...r); };
    try { loadExtrasNow(); } finally { fs.readFileSync = realReadSync; }   // idle: waited for above
  }
  skew += 25 * 3600 * 1000;
  openEditor(); closeEditor(look());   // a priced window
  sys.length = 0; xsent.length = 0;
  globalThis.__dboAppearanceExtrasPacket(A, { customPacketType: 'dboAppearanceExtras', f: 0, ov: [['Body [Ovl3]', 9, 0, TEX]], tr: [], mo: [] });
  await wait(80);
  ok(gold() === 800 && fs.readFileSync(XSTORE, 'utf8') === xText && !fs.readdirSync(xdir).some((f) => /\.bad-/.test(f)) && !xsent.length
    && xlogs.some((l) => /not saved: the kept extras could not be read/.test(l)) && sys.some((t) => /couldn't be read\. You were not charged/.test(t)),
    'item 3: an extras store unreadable at load (EIO): a change is refused at 0 gold and told, the file kept byte for byte, nothing sent back', [gold(), sys, xsent.length]);
  delete require.cache[EXTRAS];
  require(EXTRAS)({ mp: {}, log: (...x) => xlogs.push(x.join(' ')), cfg: { appearanceExtras: { writeDelayMs: 30, setMinSeconds: 0 } }, sendPacket: (a, p) => { xsent.push([a >>> 0, p]); return true; },
    onlineActors: () => [A, B], profileOf: (a) => { const x = props.get(`${a >>> 0}|profileId`); return x === undefined ? -1 : Number(x); }, display: (a) => (a >>> 0).toString(16) });
  ok(!globalThis.__dboAppearanceExtras.loadFailed && kept() && JSON.stringify(kept()) === JSON.stringify(JSON.parse(xText).chars[A.toString(16)]), 'item 3: a reload reads the store back as it was', kept());
  await wait(80);
  process.chdir(cwd);

  Date.now = realNow;
  console.log(fails ? `${fails} failure(s)` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
