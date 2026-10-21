// The server's look for the player's own character (a /mask, a guardHead correction, a GM's /chargen, the tells, a beast
// change) arrives in tick context (NetworkingService.onTick), where every Papyrus native throws. This runs the real
// remoteServer onUpdateAppearanceMessage, BeastFormService onBeastMessage, sync/ownLook.ts and sync/appearance.ts against a
// fake game whose natives throw outside an update callback, with update callbacks run in arrival and in reverse order (once
// callbacks have no fixed order, EventManager.h), and checks what reaches the player's base and head and when; then the
// gamemode's switch (npcDriftConfig ownLook "apply" | "name" | "off", sync/driftConfig.ts) set mid-session. Run from
// skymp5-client:
//
//   node tests/own-appearance-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP own-appearance (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);
const SRC = path.resolve(__dirname, '../src');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const NORD = 0x13746, WEREWOLF = 0xcdd84;
const G = globalThis.__OA = { inUpdate: false, menuOpen: false, liveRace: NORD, loaded3D: true, baseName: '', events: [], traces: [],
  errors: [], tickErrors: [], updateErrors: [], natives: 0 };
let NOW = 5000000;
Date.now = () => NOW;
globalThis.__dboTrace = (t) => G.traces.push(t);

// Natives work only inside an update callback (CallNativeApi.cpp); Game.getPlayer has a fast path that works anywhere
const STUBS = {
  skyrimPlatform: `
    const G = globalThis.__OA;
    const native = (name, fn) => (...a) => { if (!G.inUpdate) throw new Error("'" + name + "' can't be called in this context"); G.natives++; return fn(...a); };
    const ev = (what) => G.events.push({ what, live: G.liveRace, t: Date.now() });
    const race = (id) => ({ getFormID: () => id >>> 0 });
    const base = { getFormID: () => 7, getName: () => G.baseName, getFaceMorph: () => 0,
      setName: native('ActorBase.setName', (n) => { G.baseName = n; ev('setName'); }),
      setWeight() {}, setNthHeadPart() {}, setFaceTextureSet() {}, setVoiceType() {}, setFacePreset() {}, setFaceMorph() {} };
    const player = { getFormID: () => 0x14, startDeferredKill() {}, equipItem() {},
      getBaseObject: native('Actor.getBaseObject', () => base),
      getRace: native('Actor.getRace', () => race(G.liveRace)),
      setRace: native('Actor.setRace', (r) => { G.liveRace = r.getFormID() >>> 0; ev('setRace'); }),
      is3DLoaded: native('ObjectReference.is3DLoaded', () => G.loaded3D),
      regenerateHead: native('Actor.regenerateHead', () => ev('regenerateHead')),
      changeHeadPart: native('Actor.changeHeadPart', (p) => { ev('changeHeadPart'); (G.headPuts = G.headPuts || []).push({ id: p.getFormID() >>> 0, live: G.liveRace, t: Date.now() }); }),
      unequipAll: native('Actor.unequipAll', () => {}) };
    module.exports = {
      Game: { getPlayer: () => player, getFormEx: native('Game.getFormEx', (id) => race(id)), getFormFromFile: native('Game.getFormFromFile', () => null),
        setBeastForm: native('Game.setBeastForm', () => {}), forceThirdPerson: native('Game.forceThirdPerson', () => {}) },
      Ui: { isMenuOpen: native('Ui.isMenuOpen', (m) => m === 'RaceSex Menu' && G.menuOpen) },
      ActorBase: { from: (b) => b }, Actor: { from: (a) => a }, ObjectReference: {},
      TESModPlatform: { setNpcSex() {}, setNpcRace: native('TESModPlatform.setNpcRace', () => ev('setNpcRace')), setNpcSkinColor() {},
        setNpcHairColor() {}, resizeHeadpartsArray() {}, clearTintMasks() {}, pushTintMask() {}, setFormIdUnsafe() {}, createNpc: () => null },
      Race: { from: (r) => r }, HeadPart: { from: (f) => { const t = f && G.headParts && G.headParts[f.getFormID() >>> 0]; return t === undefined ? null : { getFormID: () => f.getFormID(), getType: () => t, isExtraPart: () => false }; } }, TextureSet: { from: () => null }, VoiceType: { from: () => null },
      printConsole() {}, once() {}, on() {}, writeLogs() {}, Utility: { wait: () => ({ then() {} }) },
    };`,
  // The player's NiNode update: recorded with the live race it went out on
  niNodeQueue: `export const queuePlayerNiNodeUpdate = () => { const G = globalThis.__OA; G.events.push({ what: 'niNode', live: G.liveRace, t: Date.now() }); };
    export const queuePlayerNiNodeWork = () => {}; export const queueCopyNiNodeUpdate = () => {}; export const queueCopyNiNodeWork = () => {};`,
};

// update callbacks: 'fifo' in arrival order, 'lifo' reversed; one frame is 16 ms
const pending = [];
let order = 'fifo';
const controller = { once: (ev, fn) => { if (ev === 'update') pending.push(fn); else throw new Error('unexpected once ' + ev); } };
const tick = (fn) => { G.inUpdate = false; try { fn(); } catch (e) { G.tickErrors.push(e.message); } };
const frame = () => {
  G.inUpdate = true;
  const fns = pending.splice(0);
  if (order === 'lifo') fns.reverse();
  for (const fn of fns) { try { fn(); } catch (e) { G.updateErrors.push(e.message); } }
  if (G.everyUpdate) { try { G.everyUpdate(); } catch (e) { G.updateErrors.push(e.message); } }
  G.inUpdate = false;
  NOW += 16;
};
const runFor = (ms) => { const end = NOW + ms; while (NOW < end) frame(); };

const look = (o = {}) => Object.assign({ isFemale: true, raceId: NORD, weight: 50, skinColor: 0x112233, hairColor: 0x443322,
  headpartIds: [0x1a2b3, 0x1a2b5], headTextureSetId: 0, options: [0.1, 0, -0.2], presets: [1, 2, 3, 4],
  tints: [{ texturePath: 'Actors\\Character\\Character Assets\\TintMasks\\SkinTone.dds', argb: 0x55ffffff, type: 6 }], name: 'Edda' }, o);
const REBUILD = /^(setNpcRace|regenerateHead|niNode|changeHeadPart)$/;
const rebuilds = () => G.events.filter((e) => REBUILD.test(e.what));
const writes = () => G.events.filter((e) => REBUILD.test(e.what) || e.what === 'setName');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-ownlook-'));
  let APP, OWN, DRIFT, sp;
  try {
    const own = path.join(SRC, 'sync/ownLook.ts');
    const entry = path.join(tmp, 'entry.ts');
    fs.writeFileSync(entry, [`export * as APP from ${JSON.stringify(path.join(SRC, 'sync/appearance.ts'))};`, "export * as SP from 'skyrimPlatform';",
      fs.existsSync(own) ? `export * as OWN from ${JSON.stringify(own)};` : 'export const OWN = null;',
      `export * as DRIFT from ${JSON.stringify(path.join(SRC, 'sync/driftConfig.ts'))};`].join('\n'));
    const out = path.join(tmp, 'all.js');
    await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /^skyrimPlatform$/ }, () => ({ path: 'skyrimPlatform', namespace: 'stub' }));
        b.onResolve({ filter: /niNodeQueue$/ }, () => ({ path: 'niNodeQueue', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: a.path === 'skyrimPlatform' ? 'js' : 'ts' }));
      } }] });
    ({ APP, OWN, DRIFT, SP: sp } = require(out));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // remoteServer's handler and BeastFormService's dboBeast handler, taken from the source
  const rs = fs.readFileSync(path.join(SRC, 'services/services/remoteServer.ts'), 'utf8');
  const bf = fs.readFileSync(path.join(SRC, 'services/services/beastFormService.ts'), 'utf8');
  const settleMs = (rs.match(/const RACE_MENU_SETTLE_MS = \d+;/) || [''])[0];
  const settling = (rs.match(/const isRaceMenuSettling = [\s\S]*?;\n/) || [''])[0];
  const handler = (rs.match(/private onUpdateAppearanceMessage\(event: ConnectionMessage<UpdateAppearanceMessage>\): void \{[\s\S]*?\n  \}/) || [''])[0];
  const onBeast = (bf.match(/private onBeastMessage\(event: ConnectionMessage<CustomPacketMessage>\): void \{[\s\S]*?\n  \}/) || [''])[0];
  check('remoteServer has onUpdateAppearanceMessage and BeastFormService has onBeastMessage', !!handler && !!onBeast);
  const logTrace = (_l, ...a) => G.traces.push(a.join(' '));
  const logError = (_l, ...a) => G.errors.push(a.join(' '));
  const rsJs = (await esbuild.transform(`${settleMs}\n${settling}\nclass Rs {\n${handler.replace('private ', '')}\n}\nreturn Rs;`, { loader: 'ts' })).code;
  const Rs = new Function('Ui', 'Game', 'applyAppearanceToPlayer', 'logTrace', 'logError', rsJs)(sp.Ui, sp.Game, APP.applyAppearanceToPlayer, logTrace, logError);
  const bfJs = (await esbuild.transform(`class Bfs {\n${onBeast.replace('private ', '')}\n}\nreturn Bfs;`, { loader: 'ts' })).code;
  const Bfs = new Function('parseCustomPacket', 'parseBeastBodies', 'setBeastBodies', 'Race', 'Armor', 'wantRace', 'parseAbilities', 'logTrace', 'logError',
    'dropLiveHeadParts', 'isVampireRaceId', 'requestLiveHeadParts', bfJs)(
    (e) => JSON.parse(e.message.contentJsonDump), () => null, () => {}, { from: (r) => r }, { from: () => null }, () => null, () => null, logTrace, logError,
    APP.dropLiveHeadParts || (() => {}), APP.isVampireRaceId || (() => false), APP.requestLiveHeadParts || (() => {}));

  // World model: idx 0 is this client's character, idx 1 another player
  const ME = 0, OTHER = 1;
  const forms = [{ refrId: 0x14 }, { refrId: 0xff000123 }];
  const rsi = Object.assign(new Rs(), { controller, worldModel: { forms }, getIdManager: () => ({ getId: (idx) => (idx < 2 ? idx : -1) }), getMyActorIndex: () => ME });
  if (OWN) rsi.ownLook = new OWN.OwnLookQueue((fn) => controller.once('update', fn), (...a) => logTrace(null, ...a));
  const bfs = Object.assign(new Bfs(), { controller, sp: { Game: sp.Game }, applyLoadout() {}, restoreFirstPerson() {}, restoreControls() {} });
  const deliver = (idx, data) => tick(() => rsi.onUpdateAppearanceMessage({ message: { idx, data } }));
  const dboBeast = (race, beast) => tick(() => bfs.onBeastMessage({ message: { contentJsonDump: JSON.stringify({ customPacketType: 'dboBeast', race, beast, form: 'werewolf', wear: [] }) } }));
  const traced = (re) => G.traces.some((t) => re.test(t));
  const clear = () => { G.events = []; G.traces = []; G.errors = []; G.tickErrors = []; G.updateErrors = []; G.natives = 0; };
  // remoteServer's create (isMe) and its load apply (onCreateActorMessage), then the 5 s after a spawn
  const created = () => tick(() => { if (rsi.ownLook) rsi.ownLook.created(); });
  const loadApply = (l) => { const at = NOW; controller.once('update', () => { if (rsi.ownLook) rsi.ownLook.putOn(); APP.applyAppearanceToPlayer(l, false, 'load'); }); frame(); return at; };
  const spawn = (l = look()) => {
    pending.length = 0; order = 'fifo';
    Object.assign(G, { menuOpen: false, liveRace: NORD, loaded3D: true });
    delete globalThis.__dboRaceMenuClosedAt; delete globalThis.__dboBeastRaces; delete globalThis.__dboRaceSwitches; delete globalThis.__dboRaceSwitchAt;
    created(); loadApply(l); runFor(6000); clear();
  };

  // Source: the handler only hands the look on in tick; the create and both applies at a spawn or load reach the queue
  check('remoteServer hands its own look to sync/ownLook.ts (no native in tick)', /this\.ownLook\.offer\(newAppearance\)/.test(handler)
    && !/Ui\.|applyAppearanceToPlayer|isRaceMenuSettling/.test(handler));
  check('...the create (isMe) and both the spawn and the load apply tell it', (rs.match(/this\.ownLook\.created\(\);/g) || []).length === 1
    && (rs.match(/this\.ownLook\.putOn\(\);\n\s*if \(msg\.appearance\) \{\n\s*applyAppearanceToPlayer\(msg\.appearance, false, "(spawn|load)"\)/g) || []).length === 2);
  check('BeastFormService counts a race change from its packet to its setRace, and stamps every setRace',
    /__dboRaceSwitches = \(Number\(g\.__dboRaceSwitches\) \|\| 0\) \+ 1/.test(onBeast) && /finally \{\s*g\.__dboRaceSwitches = Math\.max/.test(onBeast)
    && (bf.match(/__dboRaceSwitchAt = Date\.now\(\)/g) || []).length === 3);

  // 1. A changed look (the tells): in tick no throw, nothing on the player until the update, then one full apply
  spawn();
  const tells = look({ skinColor: 0x221111 });
  deliver(ME, tells);
  check('the server\'s look for this character is taken in tick context without a throw', G.tickErrors.length === 0, G.tickErrors);
  check('...the world model has it at once', forms[ME].appearance === tells && forms[ME].numAppearanceChanges >= 1, forms[ME]);
  runFor(400);
  check('...nothing goes on the player in the first 0.4 s (the race change it may come with is not known yet)', writes().length === 0, writes());
  runFor(400);
  check('...then it goes on once, live eyes, traced as "update"', rebuilds().filter((e) => e.what === 'setNpcRace').length === 1
    && traced(/^Applied appearance to the player$/) && traced(/^own update /), { w: writes(), t: G.traces });
  check('...with no error in tick or update', G.tickErrors.length === 0 && G.updateErrors.length === 0, [G.tickErrors, G.updateErrors]);

  // 1b. A /mask swap or a rename (review D, about 40 of 50 own looks on 13 Oct): only the name, no head rebuild
  spawn();
  deliver(ME, look({ name: 'Masked Person' }));
  runFor(1000);
  check('a look that differs only in its name sets only the name (no setNpcRace, regenerateHead, tints or NiNode update)',
    G.baseName === 'Masked Person' && rebuilds().length === 0 && writes().length === 1 && traced(/^own name /), { w: writes(), t: G.traces });
  clear();
  deliver(ME, look({ name: 'Masked Person' }));
  runFor(1000);
  check('...the same look again sets only the name', rebuilds().length === 0, writes());
  clear();
  deliver(ME, look({ name: 'Edda', skinColor: 0x998877 }));
  runFor(1000);
  check('...and a look that changes more than the name is a full apply', rebuilds().filter((e) => e.what === 'setNpcRace').length === 1, writes());

  // 2. RaceMenu open, and the 3 s after it closes: dropped (the echo; the server resends at 3.5 s)
  spawn();
  G.menuOpen = true;
  deliver(ME, look({ skinColor: 1 }));
  runFor(1000);
  check('while RaceMenu is open an own look is dropped', writes().length === 0 && traced(/own drop=settle/), { w: writes(), t: G.traces });
  spawn();
  globalThis.__dboRaceMenuClosedAt = NOW - 2400;
  deliver(ME, look({ skinColor: 2 }));
  runFor(4000);
  check('in the 3 s after RaceMenu closes an own look is dropped', writes().length === 0 && traced(/own drop=settle/), { w: writes(), t: G.traces });
  spawn();
  deliver(ME, look({ skinColor: 3 }));
  G.menuOpen = true;
  runFor(1000);
  check('RaceMenu opened between the message and the update: dropped (decided when it would go on)', writes().length === 0, writes());

  // 3. The guardHead case (review B): echo at RTT dropped; the server's resend 3.5 s after it heard the close is held past
  // skee's captures (extras +3.0 s, preset +3.5 s) to close + 5.5 s, then put on once
  spawn();
  globalThis.__dboRaceMenuClosedAt = NOW;
  const closeAt = NOW;
  runFor(120); deliver(ME, look({ skinColor: 4, name: 'Edited' }));
  runFor(3560); deliver(ME, look());
  runFor(1700);
  check('the echo is dropped and the resend at close + 3.68 s is not put on before close + 5.5 s', writes().every((e) => e.t >= closeAt + 5500), writes());
  runFor(1500);
  check('...and is put on once after it, in full though it equals the look from before the edit (RaceMenu wrote the base)',
    rebuilds().filter((e) => e.what === 'setNpcRace').length === 1 && rebuilds().every((e) => e.t >= closeAt + 5500), writes());

  // 4. A look of a beast race is dropped; the next normal look goes on
  spawn();
  deliver(ME, look({ raceId: WEREWOLF, name: 'Werebeast' }));
  runFor(1000);
  check('a look of a beast race is dropped', writes().length === 0 && traced(/own drop=beast/), { w: writes(), t: G.traces });
  deliver(ME, look({ skinColor: 5 }));
  runFor(1000);
  check('...and a normal look after it goes on', rebuilds().length > 0, writes());

  for (const o of ['fifo', 'lifo']) {
    // 5. A werewolf change (review A): beastform.js writes the MORTAL race named after the form, then sends dboBeast
    spawn();
    order = o;
    deliver(ME, look({ name: 'Werewolf' }));
    dboBeast(WEREWOLF, true);
    runFor(5000);
    const setRaceAt = (G.events.find((e) => e.what === 'setRace') || {}).t;
    check(`[${o}] transform: the race goes to the werewolf`, G.liveRace === WEREWOLF && !!setRaceAt, G.events);
    check(`[${o}] ...and the form's look puts nothing on the player (no head rebuild on the werewolf, none at the swap)`, writes().length === 0, writes());
    // 6. The revert: the look the form kept (beastform.js revert), then dboBeast back to the race
    clear();
    deliver(ME, look());
    dboBeast(NORD, false);
    runFor(5000);
    const back = G.events.find((e) => e.what === 'setRace');
    check(`[${o}] revert: the race comes back first`, !!back && G.liveRace === NORD, G.events);
    check(`[${o}] ...nothing goes on while the live race is the werewolf or within 3 s of the race change`,
      writes().every((e) => e.live === NORD && back && e.t >= back.t + 3000), writes());
    check(`[${o}] ...and the look's name is on the player after it`, G.baseName === 'Edda', G.baseName);
    check(`[${o}] ...with no head rebuild: the look is the one on the base`, rebuilds().length === 0, writes());
    // 7. The revert with a look the server changed meanwhile (the tells): put on, on the mortal body, 3 s after the swap
    deliver(ME, look({ name: 'Werewolf' }));
    dboBeast(WEREWOLF, true);
    runFor(5000);
    clear();
    deliver(ME, look({ skinColor: 0x331111 }));
    dboBeast(NORD, false);
    runFor(5000);
    const back2 = G.events.find((e) => e.what === 'setRace');
    check(`[${o}] revert with a changed look: one full apply, on the mortal body, 3 s after the race change`,
      rebuilds().filter((e) => e.what === 'setNpcRace').length === 1 && rebuilds().every((e) => e.live === NORD && back2 && e.t >= back2.t + 3000), G.events);
    // 8. The change while "update" does not fire (a pausing menu) for longer than the race window
    spawn();
    order = o;
    deliver(ME, look({ name: 'Werewolf' }));
    dboBeast(WEREWOLF, true);
    NOW += 4000;
    runFor(5000);
    check(`[${o}] transform queued through a 4 s pause: still nothing on the player`, writes().length === 0 && G.liveRace === WEREWOLF, writes());

    // 8b. A look already waiting when the race change comes during a pause longer than the race window
    spawn();
    order = o;
    deliver(ME, look({ name: 'Werewolf' }));
    runFor(100);
    dboBeast(WEREWOLF, true);
    NOW += 4000;
    runFor(5000);
    check(`[${o}] a look seen before a race change that came in a 4 s pause: nothing on the player`, writes().length === 0 && G.liveRace === WEREWOLF, writes());

    // 9. Four looks queued while "update" does not fire (review C): one check queued, one apply, of the newest
    spawn();
    order = o;
    for (const [i, n] of ['Masked Person', 'Real Name', 'Masked Person', 'Newest'].entries()) deliver(ME, look({ name: n, skinColor: 10 + i }));
    check(`[${o}] four looks in a row queue one check`, pending.length === 1, pending.length);
    runFor(1500);
    check(`[${o}] four looks queued while update was paused: one apply, of the newest`, rebuilds().filter((e) => e.what === 'setNpcRace').length === 1
      && G.baseName === 'Newest', { w: writes(), name: G.baseName });
    // ...and none when the character was created again after them (character select)
    spawn();
    order = o;
    for (const n of ['A', 'B', 'C', 'D']) deliver(ME, look({ name: n, skinColor: 20 }));
    created();
    deliver(ME, look({ name: 'E', skinColor: 21 }));
    frame();
    check(`[${o}] a check queued before a create is void: one check per frame after it`, pending.length === 1, pending.length);
    created();
    loadApply(look({ name: 'Loaded' }));
    clear();
    runFor(7000);
    check(`[${o}] ...and none when the character was created and loaded after them`, writes().length === 0 && G.baseName === 'Loaded', { w: writes(), name: G.baseName });

    // 10. Two looks in one tick (review: once order): the newer ends on the player
    spawn();
    order = o;
    deliver(ME, look({ name: 'Older', skinColor: 30 }));
    deliver(ME, look({ name: 'Newer', skinColor: 31 }));
    runFor(1500);
    check(`[${o}] two looks in one tick: the newer ends on the player, one apply`, G.baseName === 'Newer'
      && rebuilds().filter((e) => e.what === 'setNpcRace').length === 1, { w: writes(), name: G.baseName });

    // 11. A RaceMenu close noticed later in the same frame (review: close-frame order): not put on in that frame
    spawn();
    order = o;
    G.menuOpen = true;
    deliver(ME, look({ skinColor: 40 }));
    G.menuOpen = false;
    controller.once('update', () => { globalThis.__dboRaceMenuClosedAt = Date.now(); });
    const closeFrame = NOW;
    runFor(7000);
    check(`[${o}] a look waiting at the close frame does not go on in it (or in the settle window)`, writes().every((e) => e.t >= closeFrame + 3000), writes());
  }
  order = 'fifo';

  // 12. Spawn and 3D: nothing in the 5 s after a load, nothing while the 3D is not loaded
  spawn();
  created();
  const loadedAt = loadApply(look({ name: 'Loaded' }));
  clear();
  runFor(1000);
  deliver(ME, look({ skinColor: 50 }));
  runFor(3500);
  check('a look 1 s after a load waits for the 5 s after it', writes().length === 0 && traced(/own hold=spawn/), { w: writes(), t: G.traces });
  runFor(1500);
  check('...then goes on', rebuilds().length > 0 && rebuilds()[0].t >= loadedAt + 5000, writes());
  spawn();
  created();
  deliver(ME, look({ skinColor: 51, name: 'After create' }));
  const loaded2 = loadApply(look({ name: 'Loaded' }));
  clear();
  runFor(7000);
  check('a look sent between the create and the load apply goes on after it, 5 s later, not in the load\'s update',
    G.baseName === 'After create' && writes().every((e) => e.t >= loaded2 + 5000), { w: writes(), name: G.baseName });
  spawn();
  G.loaded3D = false;
  deliver(ME, look({ skinColor: 52 }));
  runFor(2000);
  check('while the player\'s 3D is not loaded a look waits', writes().length === 0 && traced(/own hold=3d/), { w: writes(), t: G.traces });
  G.loaded3D = true;
  runFor(500);
  check('...and goes on once it is', rebuilds().length > 0, writes());

  // 13. Another player's look only goes into the world model; a cleared look and an unknown idx put nothing on
  spawn();
  const theirs = look({ name: 'Another player' });
  deliver(OTHER, theirs);
  check('another player\'s look only goes into the world model: nothing queued', forms[OTHER].appearance === theirs && pending.length === 0
    && G.tickErrors.length === 0, G.tickErrors);
  deliver(ME, null);
  runFor(1000);
  check('a message clearing this character\'s look puts nothing on the player', forms[ME].appearance === undefined && writes().length === 0, writes());
  deliver(7, look({ name: 'Nobody' }));
  check('an idx not in the world model is logged, not thrown', G.tickErrors.length === 0 && G.errors.some((e) => /not found/.test(e)), G.errors);

  // 14. The gamemode's switch, the quick undo with no client build: npcDriftConfig ownLook (HostedDriftService hands every
  // npcDriftConfig to applyDriftConfig), read each time a look would go on, so a packet mid-session takes effect at once
  const hd = fs.readFileSync(path.join(SRC, 'services/services/hostedDriftService.ts'), 'utf8');
  check('every npcDriftConfig packet goes to applyDriftConfig (HostedDriftService)', /content\["customPacketType"\] !== "npcDriftConfig"\) return;[\s\S]{0,400}applyDriftConfig\(content\);/.test(hd));
  // The echo confirms an undo in the server log, so the handler's one echo comes straight after applyDriftConfig
  const onConfig = (hd.match(/private onCustomPacketMessage\([^)]*\): void \{[\s\S]*?\n  \}/) || [''])[0];
  check('...and its config echo is sent straight after, so it reports the switches just set', /applyDriftConfig\(content\);\s*this\.send\(\{ kind: "config"/.test(onConfig)
    && (onConfig.match(/kind: "config"/g) || []).length === 1, onConfig);
  const D = DRIFT.driftConfig;
  check('ownLook defaults to "apply": a server that sends no ownLook keeps the fix on', D.ownLook === 'apply', D.ownLook);
  DRIFT.applyDriftConfig({ customPacketType: 'npcDriftConfig', remote: true, rehostAfterMs: 2100 });
  check('...an npcDriftConfig without the key (a gamemode before it) leaves "apply"', D.ownLook === 'apply', D.ownLook);
  DRIFT.applyDriftConfig({ ownLook: 'never' });
  DRIFT.applyDriftConfig({ ownLook: true });
  check('...an unknown value is ignored', D.ownLook === 'apply', D.ownLook);
  const echo = DRIFT.driftConfigEcho();
  check('...and the config line echoes it as a live switch', echo.ownLook === 'apply' && !('ownLook' in echo.inert), echo);
  const setOwn = (v) => { DRIFT.applyDriftConfig({ customPacketType: 'npcDriftConfig', ownLook: v }); return D.ownLook === v; };
  const fullApplies = () => rebuilds().filter((e) => e.what === 'setNpcRace').length;

  // "off": the clients from 15 Sep to the fix put no own look on; now without the throw and without a native
  spawn();
  check('an npcDriftConfig with ownLook "off" sets it', setOwn('off'), D.ownLook);
  const offLook = look({ skinColor: 60 });
  deliver(ME, offLook);
  runFor(1500);
  check('ownLook "off": a changed look puts nothing on the player, calls no native, traced "own drop=off"', writes().length === 0
    && G.natives === 0 && traced(/^own drop=off$/) && G.tickErrors.length === 0 && G.updateErrors.length === 0,
  { w: writes(), natives: G.natives, t: G.traces, e: [G.tickErrors, G.updateErrors] });
  check('...the world model still takes the look', forms[ME].appearance === offLook);
  deliver(ME, look({ name: 'Masked Person' }));
  runFor(1500);
  check('...a name-only look (a /mask) puts nothing on either', writes().length === 0 && G.baseName === 'Edda' && G.natives === 0, { w: writes(), name: G.baseName });
  spawn();
  globalThis.__dboRaceMenuClosedAt = NOW;
  runFor(120); deliver(ME, look({ skinColor: 61, name: 'Edited' }));
  runFor(3560); deliver(ME, look());
  runFor(4000);
  check('...nor the guardHead resend after a RaceMenu close', writes().length === 0, writes());
  spawn();
  deliver(ME, look({ name: 'Werewolf' }));
  dboBeast(WEREWOLF, true);
  runFor(5000);
  clear();
  deliver(ME, look());
  dboBeast(NORD, false);
  runFor(5000);
  check('...nor a beast revert\'s look (the race change itself still runs)', writes().length === 0 && G.liveRace === NORD, G.events);

  // Switched mid-session: a look already waiting follows the switch the update sees
  spawn();
  setOwn('apply');
  deliver(ME, look({ skinColor: 62 }));
  runFor(200);
  setOwn('off');
  runFor(1500);
  check('a look waiting (held 0.5 s) when "off" arrives is not put on', writes().length === 0 && traced(/^own drop=off$/), { w: writes(), t: G.traces });
  check('"apply" again mid-session, no restart', setOwn('apply'));
  deliver(ME, look({ skinColor: 63 }));
  runFor(1500);
  check('...the next look goes on in full, once', fullApplies() === 1, writes());

  // "name": only a look that changes just the name goes on, so the head is never rebuilt
  spawn();
  check('an npcDriftConfig with ownLook "name" sets it', setOwn('name'), D.ownLook);
  deliver(ME, look({ name: 'Masked Person' }));
  runFor(1000);
  check('ownLook "name": a name-only look (a /mask) sets the name, no head rebuild', G.baseName === 'Masked Person' && rebuilds().length === 0
    && writes().length === 1 && traced(/^own name /), { w: writes(), name: G.baseName });
  clear();
  deliver(ME, look({ name: 'Edda', skinColor: 70 }));
  runFor(1500);
  check('...a look that changes more than the name is dropped: nothing on the player, traced "own drop=nameonly"', writes().length === 0
    && G.baseName === 'Masked Person' && traced(/^own drop=nameonly$/), { w: writes(), name: G.baseName, t: G.traces });
  spawn();
  setOwn('name');
  globalThis.__dboRaceMenuClosedAt = NOW;
  runFor(120); deliver(ME, look({ skinColor: 71, name: 'Edited' }));
  runFor(3560); deliver(ME, look());
  runFor(4000);
  check('...the guardHead resend after a RaceMenu close (in full under "apply") is dropped: no head rebuild', rebuilds().length === 0
    && traced(/^own drop=nameonly$/), { w: writes(), t: G.traces });
  for (const o of ['fifo', 'lifo']) {
    spawn();
    order = o;
    setOwn('name');
    deliver(ME, look({ name: 'Werewolf' }));
    dboBeast(WEREWOLF, true);
    runFor(5000);
    clear();
    deliver(ME, look());
    dboBeast(NORD, false);
    runFor(5000);
    check(`[${o}] "name": a beast revert to the look the form kept sets the name only`, writes().length === 1 && writes()[0].what === 'setName'
      && G.baseName === 'Edda' && G.liveRace === NORD && traced(/^own name /), { w: writes(), name: G.baseName });
    deliver(ME, look({ name: 'Werewolf' }));
    dboBeast(WEREWOLF, true);
    runFor(5000);
    clear();
    deliver(ME, look({ skinColor: 72 }));
    dboBeast(NORD, false);
    runFor(5000);
    check(`[${o}] ...a revert with a changed look is dropped, no head rebuild`, writes().length === 0 && G.liveRace === NORD
      && traced(/^own drop=nameonly$/), { w: writes(), t: G.traces });
  }
  order = 'fifo';
  spawn();
  setOwn('apply');
  deliver(ME, look({ skinColor: 73 }));
  runFor(200);
  setOwn('name');
  runFor(1500);
  check('a look waiting when "name" arrives is dropped unless only its name changed', rebuilds().length === 0 && traced(/^own drop=nameonly$/), writes());
  setOwn('apply');
  deliver(ME, look({ skinColor: 74 }));
  runFor(1500);
  check('..."apply" again: the next look goes on in full', fullApplies() === 1, writes());

  // 15. The vampire turn (vampire-eyes fix, 21 Oct): setLookRace writes the look on the vampire race, then dboBeast with
  // beast false. A vampire race puts its own fanged face and eyes on the live head, so the look's face and eyes go back on
  // with changeHeadPart, on the vampire body, after the race window; and once more after a load on a vampire race
  if (OWN && OWN.tickLiveHeadParts) {
    const NORD_V = 0x88794, FACE = 0x1a2b3, EYES = 0x1a2b5;
    G.headParts = { [FACE]: 1, [EYES]: 2 };
    G.everyUpdate = () => OWN.tickLiveHeadParts();
    for (const o of ['fifo', 'lifo']) {
      spawn(); order = o; G.headPuts = [];
      deliver(ME, look({ raceId: NORD_V }));
      dboBeast(NORD_V, false);
      runFor(8000);
      const turned = G.events.find((e) => e.what === 'setRace');
      const puts = G.headPuts.map((x) => x.id);
      check(`[${o}] vampire turn: the look's face and eyes go on the live head`, puts.includes(FACE) && puts.includes(EYES), G.headPuts);
      check(`[${o}] ...on the vampire body, 3 s after the race change, once`, !!turned && G.headPuts.every((x) => x.live === NORD_V && x.t >= turned.t + 3000) && G.headPuts.length === 2, G.headPuts);
      check(`[${o}] ...and no native ran in tick context`, G.tickErrors.length === 0 && G.updateErrors.length === 0, { t: G.tickErrors, u: G.updateErrors });
      // No new look after the turn (the look did not change): tickLiveHeadParts puts the look on the base on again
      spawn(); order = o; G.headPuts = [];
      G.liveRace = NORD_V; tick(() => {});
      loadApply(look({ raceId: NORD_V })); clear(); G.headPuts = [];
      runFor(8000);
      check(`[${o}] load on a vampire race, no look after it: face and eyes go on from the update, after the load`, G.headPuts.length === 2, G.headPuts);
      // A werewolf revert (a mortal race) asks for nothing
      spawn(); order = o; G.headPuts = [];
      deliver(ME, look({ name: 'Werewolf' })); dboBeast(WEREWOLF, true); runFor(5000);
      deliver(ME, look()); dboBeast(NORD, false); runFor(8000);
      check(`[${o}] a werewolf revert to a mortal race: no head part swap`, G.headPuts.length === 0, G.headPuts);
    }
    G.everyUpdate = null; G.headParts = null;
  }

  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
