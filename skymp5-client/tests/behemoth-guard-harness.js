// Scripted test for the Werewolf Behemoth beast guard (client 0.3.100). DBO_WerewolfBehemothRace (1d1f9e in DragonBreak
// Online Edits.esp, 1.3x) runs the werewolf's behaviour graph on its own skeleton, so it is a beast race wherever the
// werewolf is: the watcher crash guard, the beast body list, the 3D update rule, the loadout and the howls. It is found by
// plugin name at runtime, so the DLE's move from load index 3c to 48 changes nothing, and a load order without it keeps
// working. Bundles the real beastRaceIds, beastRaces, beastBody, niNodeQueue and beastFormService against a fake game
// whose Game.getFormFromFile throws outside an update. Run from skymp5-client:
//
//   node tests/behemoth-guard-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP behemoth-guard (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};
const attempt = (fn) => { try { return fn(); } catch (e) { return `threw: ${e && e.message}`; } };

const DLE = 'DragonBreak Online Edits.esp';
const BEHEMOTH_LOCAL = 0x1d1f9e;
const WEREWOLF = 0x000cdd84, VAMPIRE_LORD = 0x0200283a, NORD = 0x00013746;
const BEH_48 = 0x481d1f9e, BEH_3C = 0x3c1d1f9e;
const TERROR = 0x000cf790, TOTEM = 0x000ce218;
const WB = 0xff000a01, WW = 0xff000a02;
const SRC = path.resolve(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

// The world: which plugins are loaded at which index, which records they hold, and whether natives may run now
const W = globalThis.__BH = { inUpdate: false, slots: {}, records: new Set(), missingThrows: false, attempts: 0, diag: [], traces: [], ons: [],
  playerRace: NORD, sent: 0, errors: [] };
globalThis.__dboTrace = (t) => W.traces.push(t);
const world = (dleSlot, withRecord, missingThrows = false) => {
  W.slots = { 'Skyrim.esm': 0x00, 'Update.esm': 0x01, 'Dawnguard.esm': 0x02 };
  if (dleSlot !== null) W.slots[DLE] = dleSlot;
  W.records = new Set(['Skyrim.esm|cdd84', 'Skyrim.esm|13746', 'Dawnguard.esm|283a']);
  if (withRecord) W.records.add(`${DLE}|${BEHEMOTH_LOCAL.toString(16)}`);
  W.missingThrows = missingThrows;
  W.inUpdate = false; W.attempts = 0; W.diag = []; W.traces = []; W.ons = []; W.playerRace = NORD; W.sent = 0; W.errors = [];
};

const STUBS = {
  skyrimPlatform: `
    const W = () => globalThis.__BH;
    const native = (name, fn) => (...a) => { W().attempts++; if (!W().inUpdate) throw new Error("'" + name + "' can't be called in this context"); return fn(...a); };
    const form = (id) => ({ getFormID: () => id >>> 0 });
    const player = { getFormID: () => 0x14, getRace: () => form(W().playerRace), queueNiNodeUpdate: () => { W().sent++; } };
    module.exports = {
      Game: {
        getFormFromFile: native('Game.getFormFromFile', (localId, file) => {
          const slot = W().slots[file];
          if (slot === undefined) { if (W().missingThrows) throw new Error('no such plugin ' + file); return null; }
          return W().records.has(file + '|' + (localId >>> 0).toString(16)) ? form(((slot << 24) | (localId & 0xffffff)) >>> 0) : null;
        }),
        getPlayer: () => player, getFormEx: () => null,
      },
      Actor: { from: (a) => a || null }, Race: { from: (f) => f || null }, Spell: { from: (f) => f || null }, Perk: { from: (f) => f || null },
      Shout: { from: (f) => f || null }, Armor: { from: () => null }, GlobalVariable: { from: () => null }, WordOfPower: { from: () => null },
      DxScanCode: { N1: 2, N9: 10, Z: 44, LeftControl: 29 }, InputDeviceType: { Keyboard: 0, Mouse: 1 },
      writeLogs: (_file, line) => W().diag.push(line), on: (_ev, fn) => W().ons.push(fn), printConsole() {},
    };`,
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  customPacketUtil: `module.exports = {
    parseCustomPacket: (e) => { try { return JSON.parse(e.message.contentJsonDump); } catch { return null; } },
    sendCustomPacket: () => {} };`,
  logging: 'module.exports = { logTrace() {}, logError: (...a) => globalThis.__BH.errors.push(a.join(" ")) };',
};
const STUB_OF = { skyrimPlatform: 'skyrimPlatform', './clientListener': 'clientListener', './customPacketUtil': 'customPacketUtil',
  '../../logging': 'logging' };
const ENTRY = `
  export * as ids from './sync/beastRaceIds';
  export * as races from './sync/beastRaces';
  export * as body from './sync/beastBody';
  export * as ni from './view/niNodeQueue';
  export { BeastFormService } from './services/services/beastFormService';`;

let bundle = '';
// A fresh client: every module's state starts over, as in a new game process
const fresh = () => { delete require.cache[require.resolve(bundle)]; return require(bundle); };
const actor = (race) => ({ getRace: () => ({ getFormID: () => race >>> 0 }) });
const snapshot = () => ({ booleans: new Uint8Array([1, 0, 1]), floats: new Uint8Array(76), integers: new Uint8Array(56) });
const isEmpty = (v) => !!v && v.booleans.length === 0 && v.floats.length === 0 && v.integers.length === 0;
const bodiesPacket = (list) => ({ customPacketType: 'dboBeastBody', bodies: list });
const inUpdate = (fn) => { W.inUpdate = true; try { return fn(); } finally { W.inUpdate = false; } };

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-jake-behemoth-'));
  try {
    bundle = path.join(tmp, 'behemoth.js');
    await esbuild.build({
      stdin: { contents: ENTRY, resolveDir: SRC, loader: 'ts', sourcefile: 'behemoth-entry.ts' }, bundle: true, platform: 'node',
      format: 'cjs', outfile: bundle, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      } }],
    });
    for (const section of [table, newLoadOrder, oldLoadOrder, missing, service, sources]) {
      try { section(); } catch (e) { check(`${section.name} threw ${e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e}`, false); }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
}

// ---- the table: by plugin name and local id, never by a load order slot -------------------------------------------------
function table() {
  world(0x48, true);
  const { ids } = fresh();
  const list = ids.PLUGIN_BEAST_RACES || [];
  const entry = list.find((e) => e[0] === DLE && e[1] === BEHEMOTH_LOCAL);
  check('the Werewolf Behemoth is a plugin beast race: DragonBreak Online Edits.esp, local id 1d1f9e', !!entry, list);
  check('...named DBO_WerewolfBehemothRace and played as the vanilla werewolf (0cdd84)', !!entry && entry[2] === 'DBO_WerewolfBehemothRace' && entry[3] === WEREWOLF, entry);
  check('...with a bare local id (no load order byte)', list.length > 0 && list.every((e) => typeof e[0] === 'string' && e[0].length > 0 && e[1] > 0 && e[1] <= 0xffffff), list);
  check('the vanilla pair is unchanged: exactly the werewolf and the Vampire Lord', ids.BEAST_RACE_IDS.size === 2 &&
    ids.BEAST_RACE_IDS.has(WEREWOLF) && ids.BEAST_RACE_IDS.has(VAMPIRE_LORD));

  // The pure lookup on its own, with no resolver registered behind it
  if (typeof ids.resolvePluginBeastRaces !== 'function' || typeof ids.setPluginBeastResolver !== 'function') {
    check('beastRaceIds.ts resolves plugin beast races through an injected lookup', false, Object.keys(ids));
    return;
  }
  ids.setPluginBeastResolver(null);
  const lines = ids.resolvePluginBeastRaces((file, local) => (file === DLE && local === BEHEMOTH_LOCAL ? BEH_48 : 0));
  check('a lookup that finds it at 48 makes 481d1f9e a beast race played as the werewolf', ids.isBeastRaceId(BEH_48) && ids.vanillaBeastRaceOf(BEH_48) === WEREWOLF);
  check('...a guarded race whose copy takes no caster variables', ids.isGuardedRaceId(BEH_48) && isEmpty(ids.casterVariablesFor(BEH_48, snapshot())));
  check('...a signed id is the same race', ids.isBeastRaceId(BEH_48 | 0));
  check('...and the lookup names what it found', JSON.stringify(lines) === JSON.stringify(['DBO_WerewolfBehemothRace 481d1f9e']), lines);
  check('the vanilla werewolf and Vampire Lord play themselves; a Nord and no race are no beast', ids.vanillaBeastRaceOf(WEREWOLF) === WEREWOLF &&
    ids.vanillaBeastRaceOf(VAMPIRE_LORD) === VAMPIRE_LORD && ids.vanillaBeastRaceOf(NORD) === 0 && ids.vanillaBeastRaceOf(0) === 0 && ids.vanillaBeastRaceOf(undefined) === 0);
  ids.resolvePluginBeastRaces(() => BEH_3C);
  check('a lookup at 3c replaces it: 3c1d1f9e is the beast, 481d1f9e no longer', ids.isBeastRaceId(BEH_3C) && !ids.isBeastRaceId(BEH_48));
  const missingLines = ids.resolvePluginBeastRaces(() => { throw new Error('no such plugin'); });
  check('a lookup that throws (plugin not loaded) adds nothing and says missing', !ids.isBeastRaceId(BEH_3C) && !ids.isBeastRaceId(BEH_48) &&
    JSON.stringify(missingLines) === JSON.stringify(['DBO_WerewolfBehemothRace missing']), missingLines);
  ids.resolvePluginBeastRaces(() => 0);
  check('a lookup that finds no record adds nothing; the vanilla two are still beasts', !ids.isBeastRaceId(BEH_48) && ids.isBeastRaceId(WEREWOLF) && ids.isBeastRaceId(VAMPIRE_LORD));
  ids.resolvePluginBeastRaces(() => WEREWOLF);
  check('a lookup that returns a vanilla beast id adds no plugin entry', ids.vanillaBeastRaceOf(WEREWOLF) === WEREWOLF && !ids.isBeastRaceId(BEH_48));
  let runs = 0;
  ids.setPluginBeastResolver(() => { runs++; });
  ids.isBeastRaceId(WEREWOLF); ids.isBeastRaceId(0);
  check('a registered resolver is not run for the vanilla two or for no race', runs === 0, runs);
  ids.isBeastRaceId(NORD);
  check('...and is run before any other race is judged', runs === 1, runs);
  ids.setPluginBeastResolver(null);
  ids.isBeastRaceId(NORD);
  check('...until it clears itself', runs === 1, runs);
}

// ---- the 0.3.100 load order: the DLE at 48 holds the record ---------------------------------------------------------------
function newLoadOrder() {
  world(0x48, true);
  const { ids, races, body, ni } = fresh();
  const early = attempt(() => body.parseBeastBodies(bodiesPacket([{ id: WB, race: BEH_48 }, { id: WW, race: WEREWOLF }])));
  check('a body list read before any update (a packet handler, no natives) does not throw', Array.isArray(early), early);
  check('...keeps the werewolf, and drops the not yet known Behemoth so it shows in its mortal body (fails safe)',
    Array.isArray(early) && early.length === 1 && early[0].race === WEREWOLF, early);
  check('...after trying one native, not one per race', W.attempts === 1, W.attempts);
  check('...and writes nothing', W.diag.length === 0, W.diag);

  inUpdate(() => races.resolveBeastRaces && races.resolveBeastRaces());
  check('in an update the Behemoth resolves to 481d1f9e and is a beast race', ids.isBeastRaceId(BEH_48));
  check('...played as the werewolf', ids.vanillaBeastRaceOf(BEH_48) === WEREWOLF);
  check('...one diag line names it', W.diag.filter((l) => /^beast races: /.test(l)).length === 1 && W.diag.includes('beast races: DBO_WerewolfBehemothRace 481d1f9e'), W.diag);
  check('the old slot 3c1d1f9e is nothing now (no slot is assumed)', !ids.isBeastRaceId(BEH_3C) && !ids.isGuardedRaceId(BEH_3C));
  check('the watcher crash guard: a Behemoth copy is a guarded race and gets no caster variables',
    inUpdate(() => races.guardedRaceOf(actor(BEH_48))) === BEH_48 && isEmpty(ids.casterVariablesFor(BEH_48, snapshot())));
  check('...beastRaceOf names it, and skee writes are refused for it', inUpdate(() => races.beastRaceOf(actor(BEH_48))) === BEH_48 &&
    inUpdate(() => races.isGuardedActor(actor(BEH_48))) === true && inUpdate(() => races.isGuardedRace(BEH_48)) === true);
  check('...a Nord copy is still not guarded by this', inUpdate(() => races.beastRaceOf(actor(NORD))) === 0 && !ids.isBeastRaceId(NORD));

  const listed = attempt(() => body.parseBeastBodies(bodiesPacket([{ id: WB, race: BEH_48 }, { id: WW, race: WEREWOLF }, { id: 0xff000a03, race: NORD }])));
  check('once resolved, a body list read in a packet handler keeps the Behemoth (and still drops a Nord)',
    Array.isArray(listed) && listed.length === 2 && listed.some((e) => e.id === WB && e.race === BEH_48), listed);
  body.setBeastBodies(listed);
  check('...the listed Behemoth is shown in its body and guarded by its listing', body.beastBodyOf(WB) === BEH_48 &&
    inUpdate(() => races.guardedRaceOf(actor(NORD), WB)) === BEH_48);
  const before = W.attempts;
  for (let i = 0; i < 100; i++) { ids.isBeastRaceId(NORD); ids.isBeastRaceId(BEH_48); inUpdate(() => races.resolveBeastRaces()); }
  check('after it resolved, no check calls a native again', W.attempts === before, W.attempts - before);
  check('...and the diag line is still the only one', W.diag.length === 1, W.diag);

  // The player's own 3D update and a copy's, under the same rule as the werewolf
  const frame = () => inUpdate(() => W.ons.forEach((fn) => fn()));
  const sentAfter = (fn) => { W.sent = 0; fn(); frame(); frame(); return W.sent; };
  W.playerRace = NORD;
  check('a mortal player\'s NiNode update goes out', sentAfter(() => inUpdate(() => ni.queuePlayerNiNodeUpdate())) === 1, W.sent);
  W.playerRace = BEH_48;
  W.traces = [];
  check('a Behemoth player\'s does not, as for a werewolf', sentAfter(() => inUpdate(() => ni.queuePlayerNiNodeUpdate())) === 0, W.sent);
  check('...and says so in the trace', W.traces.includes('ni self skip=beast'), W.traces);
  W.playerRace = WEREWOLF;
  check('...the werewolf\'s still does not', sentAfter(() => inUpdate(() => ni.queuePlayerNiNodeUpdate())) === 0, W.sent);
}

// ---- the 0.3.99 load order (DLE at 3c) resolves just the same --------------------------------------------------------------
function oldLoadOrder() {
  world(0x3c, true);
  const { ids } = fresh();
  inUpdate(() => ids.isBeastRaceId(NORD));
  check('with the DLE at 3c the first check in an update resolves it to 3c1d1f9e (no slot is assumed)', ids.isBeastRaceId(BEH_3C) && ids.vanillaBeastRaceOf(BEH_3C) === WEREWOLF);
  check('...and 481d1f9e is nothing there', !ids.isBeastRaceId(BEH_48));
  check('...the diag line names 3c1d1f9e', W.diag.includes('beast races: DBO_WerewolfBehemothRace 3c1d1f9e'), W.diag);
}

// ---- a load order without the Behemoth keeps working --------------------------------------------------------------------------
function missing() {
  for (const [label, slot, record, throws] of [
    ['the live DLE without the record', 0x3c, false, false],
    ['no DLE, getFormFromFile returning None', null, false, false],
    ['no DLE, getFormFromFile throwing', null, false, true],
  ]) {
    world(slot, record, throws);
    const { ids, races, body } = fresh();
    const r = attempt(() => inUpdate(() => races.resolveBeastRaces()));
    check(`${label}: resolving does not throw`, r === undefined, r);
    check(`${label}: no Behemoth entry, and the diag line says missing`, !ids.isBeastRaceId(BEH_48) && !ids.isBeastRaceId(BEH_3C) &&
      W.diag.includes('beast races: DBO_WerewolfBehemothRace missing'), W.diag);
    check(`${label}: the werewolf and the Vampire Lord are still guarded, a Nord is not`, inUpdate(() => races.guardedRaceOf(actor(WEREWOLF))) === WEREWOLF &&
      inUpdate(() => races.guardedRaceOf(actor(VAMPIRE_LORD))) === VAMPIRE_LORD && inUpdate(() => races.guardedRaceOf(actor(NORD))) === 0);
    const l = attempt(() => body.parseBeastBodies(bodiesPacket([{ id: WB, race: BEH_48 }, { id: WW, race: WEREWOLF }])));
    check(`${label}: a body list naming 481d1f9e drops it and keeps the werewolf`, Array.isArray(l) && l.length === 1 && l[0].race === WEREWOLF, l);
    const before = W.attempts;
    for (let i = 0; i < 50; i++) inUpdate(() => { ids.isBeastRaceId(NORD); races.resolveBeastRaces(); });
    check(`${label}: settled once, not looked up again`, W.attempts === before, W.attempts - before);
  }
}

// ---- beastFormService: the Behemoth takes the werewolf's perks and howls -------------------------------------------------------
function service() {
  const run = (dleSlot, take) => {
    world(dleSlot, dleSlot !== null);
    const mod = fresh();
    const { BeastFormService, body } = mod;
    const known = new Set([NORD, WEREWOLF, VAMPIRE_LORD, TERROR, TOTEM, 0xcf791, 0xce217]);
    if (dleSlot !== null) known.add(BEH_48);
    const st = { race: NORD, perks: new Set(), shouts: new Set(), equipped: 0 };
    // The loadout's perks: Dawnguard's (index 02) and Skyrim's PlayerWerewolfFeed
    const formOf = (id) => (known.has(id >>> 0) || (id >>> 24) === 0x02 || (id >>> 0) === 0x0002ba1d ? { getFormID: () => id >>> 0 } : null);
    const player = {
      getFormID: () => 0x14, getRace: () => formOf(st.race), isDead: () => false, isBleedingOut: () => false,
      setRace: (r) => { st.race = r.getFormID(); }, unequipAll() {}, addPerk: (p) => { st.perks.add(p.getFormID()); }, removePerk: (p) => { st.perks.delete(p.getFormID()); },
      addSpell() {}, removeSpell() {}, addShout: (s) => { st.shouts.add(s.getFormID()); }, removeShout: (s) => st.shouts.delete(s.getFormID()),
      equipShout: (s) => { st.equipped = s.getFormID(); }, unequipShout: (s) => { if (st.equipped === s.getFormID()) st.equipped = 0; },
      getEquippedShout: () => (st.equipped ? formOf(st.equipped) : null), getEquippedSpell: () => null, equipSpell() {}, unequipSpell() {},
      equipItem() {}, getAnimationVariableFloat: () => 0, isRunning: () => false, isSprinting: () => false,
    };
    const once = [];
    const handlers = {};
    const emitter = {};
    const sp = {
      Game: { getPlayer: () => player, getFormEx: (id) => formOf(id), setBeastForm() {}, forceThirdPerson() {}, enablePlayerControls() {},
        showFirstPersonGeometry() {}, getCameraState: () => 9, teachWord() {}, unlockWord() {} },
      Input: { getMappedKey: () => 44 }, Debug: { notification() {}, sendAnimationEvent() {} },
    };
    const controller = {
      on: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); },
      once: (name, fn) => { if (name === 'update') once.push(fn); },
      emitter: { on: (name, fn) => { emitter[name] = fn; } },
    };
    new BeastFormService(sp, controller);
    let now = 2_000_000;
    const realNow = Date.now;
    Date.now = () => now;
    const tick = (ms = 600) => { now += ms; inUpdate(() => { once.splice(0).forEach((fn) => fn()); (handlers.update || []).forEach((fn) => fn()); }); };
    const packet = (content) => emitter.customPacketMessage({ message: { contentJsonDump: JSON.stringify(content) } });
    const howls = { right: [], left: [], voice: [{ id: 0xcf791, name: 'Howl of Terror', shout: TERROR, word: 0 }, { id: 0xce217, name: 'Totem', shout: TOTEM, word: 0 }], passive: [] };
    try {
      tick(10);
      const resolvedFirst = W.diag.slice();
      packet(bodiesPacket([{ id: WB, race: BEH_48 }]));
      const listedAfterFirstUpdate = body.beastBodyOf(WB);
      const r = attempt(() => { packet({ customPacketType: 'dboBeast', race: take, beast: true, abilities: howls }); tick(10); tick(); tick(1500); });
      const inForm = { perks: new Set(st.perks), shouts: new Set(st.shouts), race: st.race, threw: r };
      packet({ customPacketType: 'dboBeast', race: NORD, beast: false });
      tick(10); tick(); tick(1200);
      return { resolvedFirst, listedAfterFirstUpdate, inForm, after: { shouts: new Set(st.shouts), race: st.race }, errors: W.errors.slice() };
    } finally {
      Date.now = realNow;
    }
  };

  const wolf = run(0x48, WEREWOLF);
  check('a werewolf still takes its loadout (13 perks, PlayerWerewolfFeed among them) and both howls', wolf.inForm.perks.size === 13 &&
    wolf.inForm.perks.has(0x0002ba1d) && wolf.inForm.shouts.has(TERROR) && wolf.inForm.shouts.has(TOTEM), [...wolf.inForm.perks].map((x) => x.toString(16)));
  const beh = run(0x48, BEH_48);
  check('the service resolves the plugin races in its first update, before any body list', beh.resolvedFirst.includes('beast races: DBO_WerewolfBehemothRace 481d1f9e'), beh.resolvedFirst);
  check('...so a body list read in a packet handler right after keeps the Behemoth', beh.listedAfterFirstUpdate === BEH_48, beh.listedAfterFirstUpdate);
  check('a Behemoth form puts the player in the Behemoth race', beh.inForm.race === BEH_48 && beh.inForm.threw === undefined, beh.inForm);
  check('...with the werewolf\'s perks, all 13', beh.inForm.perks.size === 13 && [...wolf.inForm.perks].every((p) => beh.inForm.perks.has(p)),
    [...beh.inForm.perks].map((x) => x.toString(16)));
  check('...and both werewolf howls, held while in the form', beh.inForm.shouts.has(TERROR) && beh.inForm.shouts.has(TOTEM), [...beh.inForm.shouts]);
  check('the revert to the own race takes the howls away', beh.after.race === NORD && beh.after.shouts.size === 0, [...beh.after.shouts]);
  const gone = run(null, BEH_48);
  check('without the DLE a Behemoth packet does not throw and grants nothing', gone.inForm.threw === undefined && gone.inForm.perks.size === 0 &&
    gone.inForm.shouts.size === 0 && gone.inForm.race === NORD, gone.inForm);
  check('...it logs that the race is not in the load order', gone.errors.some((e) => /race not found 481d1f9e/.test(e)), gone.errors);
}

// ---- the call sites -----------------------------------------------------------------------------------------------------------
function sources() {
  const bfs = read('services/services/beastFormService.ts');
  check('BEAST_LOADOUT is looked up by the vanilla race a race plays', /const loadout = BEAST_LOADOUT\[vanillaBeastRaceOf\(raceId\)\];/.test(bfs));
  check('the service resolves the plugin races in update', /this\.controller\.on\("update", \(\) => resolveBeastRaces\(\)\);/.test(bfs));
  const br = read('sync/beastRaces.ts');
  check('beastRaces.ts registers its resolver at load, for the modules that import beastRaceIds.ts alone', /^setPluginBeastResolver\(resolveBeastRaces\);$/m.test(br));
  check('...and resolves by Game.getFormFromFile(local id, plugin)', /resolvePluginBeastRaces\(\(file, localId\) => Game\.getFormFromFile\(localId, file\)/.test(br));
  // isBeastOrPolymorphRaceId is isBeastRaceId plus the staff polymorph animals, so it keeps the Behemoth rule
  for (const [f, re] of [['view/formView.ts', /isBeast(?:OrPolymorph)?RaceId\(model\.appearance\.raceId\)/], ['view/niNodeQueue.ts', /isBeast(?:OrPolymorph)?RaceId\(race\.getFormID\(\)\)/],
    ['sync/beastBody.ts', /isBeast(?:OrPolymorph)?RaceId\(race\)/], ['sync/ownLook.ts', /beastLook: isBeastRaceId\(raceId\)/]]) {
    check(`${f} judges beasts through isBeastRaceId`, re.test(read(f)));
  }
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : /\.(tsx?|jsx?)$/.test(e.name) ? [path.join(dir, e.name)] : []);
  const client = files(SRC), front = files(path.resolve(__dirname, '..', '..', 'skymp5-front', 'src'));
  const wolfSites = client.filter((f) => /\b0x0*cdd84\b/i.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(SRC, f)).sort();
  check('the werewolf race id is written only in beastRaceIds.ts, the generated race list and the loadout key',
    JSON.stringify(wolfSites) === JSON.stringify(['services/services/beastFormService.ts', 'sync/beastRaceIds.ts', 'sync/nonHumanoidRaceList.ts'].map((p) => path.join(...p.split('/'))).sort()), wolfSites);
  const slotSites = client.concat(front).filter((f) => /\b0x(3c|48)[0-9a-f]{6}\b/i.test(fs.readFileSync(f, 'utf8')));
  check('no client or front source writes a DragonBreak Online Edits.esp load order slot (3c or 48) into a form id', client.length > 100 && slotSites.length === 0,
    slotSites.map((f) => path.relative(path.resolve(SRC, '..', '..'), f)));
}

main().catch((e) => { console.error(e); process.exit(1); });
