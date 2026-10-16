// Scripted test: a beast form wears nothing but its own outfit (Purr #7DJT, 15 Oct 23:13: "when i was werewolf form it
// showed the arrows on my back i had equipped"). She took Beast Form 11 s after joining; the client's unequipAll reported
// nothing worn, the server took that for the naked login report and re-dressed her, and the practice arrows went back on
// the werewolf (equipment at 23:07:31.708). The real BeastFormService is bundled with esbuild and driven by a fake engine:
// equips that land on the werewolf (the re-dress, inventory.ts's ammo re-equip) come off on the next update, the Vampire
// Lord's robe from the server's wear list stays, and after the revert the re-dress is left alone. A form whose race goes
// while the player is up is traced with the last hit (the spell-hit report of 16 Oct, not reproduced). Run from skymp5-client:
//
//   node tests/beast-gear-harness.js [path to esbuild's package dir]
// BEAST_SERVICE=<a .ts path> bundles another copy of the service instead (the harness's own check against the old code).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP beast-gear (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const WEREWOLF = 0x000cdd84, VL = 0x0200283a, KHAJIIT = 0x00013745;
const ARMOR = 26, LIGHT = 31, WEAPON = 41, AMMO = 42, SPELL_T = 22, POTION = 46;
// Her outfit, the practice arrows (dunArcherPracticeArrow), a pickaxe, a torch and the Vampire Lord's robe (beastform.js WEAR)
const SPARKS = 0x0002dd2a;
const CUIRASS = 0x1001, BOOTS = 0x1002, ARROWS = 0x1003, PICKAXE = 0x1004, TORCH = 0x1005, ROBE = 0x02011a85, POTION_ID = 0x1006;
const TYPES = { [CUIRASS]: ARMOR, [BOOTS]: ARMOR, [ARROWS]: AMMO, [PICKAXE]: WEAPON, [TORCH]: LIGHT, [ROBE]: ARMOR, [POTION_ID]: POTION };

const STUBS = {
  skyrimPlatform: `module.exports = {
    Spell: { from: () => null }, Shout: { from: () => null }, WordOfPower: { from: () => null },
    Armor: { from: (f) => (f && f.kind === 'ARMO' ? f : null) },
    Perk: { from: () => null }, GlobalVariable: { from: () => null },
    Race: { from: (f) => (f && f.kind === 'RACE' ? f : null) },
    DxScanCode: { Z: 44, LeftControl: 29, N1: 2, N9: 10 },
    InputDeviceType: { Keyboard: 0, Mouse: 1 },
  };`,
  './clientListener': 'module.exports = { ClientListener: class {} };',
  './customPacketUtil': `module.exports = {
    sendCustomPacket: () => {},
    parseCustomPacket: (e) => e.content,
  };`,
  '../../logging': 'module.exports = { logError: (...a) => globalThis.__errors.push(a.slice(1).join(" ")), logTrace: () => {} };',
};

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beast-gear-'));
  // run() ends the process, so the bundle is removed on exit
  process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
  const out = path.join(tmp, 'beastFormService.js');
  const entry = process.env.BEAST_SERVICE || path.resolve(__dirname, '../src/services/services/beastFormService.ts');
  try {
    await esbuild.build({
      entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
      plugins: [{
        name: 'stubs',
        setup(b) {
          const filter = new RegExp(`^(${Object.keys(STUBS).map((k) => k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
          b.onResolve({ filter }, (a) => ({ path: a.path, namespace: 'stub' }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
          // A copy of the service elsewhere (BEAST_SERVICE) still finds its helpers beside the real one
          const real = path.resolve(__dirname, '../src/services/services');
          b.onResolve({ filter: /^\.\/beast(Loadout|Howl|RaceCheck)$/ }, (a) => ({ path: path.join(real, a.path.slice(2) + '.ts') }));
          b.onResolve({ filter: /^\.\.\/\.\.\/sync\/beast(Body|Races)$/ }, (a) => ({ path: path.resolve(real, a.path + '.ts') }));
        },
      }],
    });
    run(require(out));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function run({ BeastFormService }) {
  let now = 1792192051000;
  Date.now = () => now;
  globalThis.__errors = [];
  const traces = [];
  globalThis.__dboTrace = (t) => traces.push(t);
  let race = KHAJIIT;
  const worn = new Set();
  const form = (id) => (TYPES[id] !== undefined ? { kind: TYPES[id] === ARMOR ? 'ARMO' : 'ITEM', getFormID: () => id, getType: () => TYPES[id] } : null);
  const player = {
    getFormID: () => 0x14,
    getRace: () => ({ getFormID: () => race }), isDead: () => false, isBleedingOut: () => false,
    getEquippedSpell: () => null, equipSpell: () => {}, unequipSpell: () => {}, getEquippedShout: () => null,
    addSpell: () => {}, removeSpell: () => {}, addPerk: () => {}, removePerk: () => {}, addShout: () => {}, removeShout: () => false,
    unequipAll: () => worn.clear(),
    setRace: (r) => { race = r.getFormID(); },
    isEquipped: (f) => !!f && worn.has(f.getFormID()),
    equipItem: (f) => { worn.add(f.getFormID()); },
    unequipItem: (f) => { worn.delete(f.getFormID()); },
    getAnimationVariableFloat: () => 0, isRunning: () => false, isSprinting: () => false,
  };
  const sp = {
    Game: {
      getPlayer: () => player,
      getFormEx: (id) => (id === WEREWOLF || id === VL || id === KHAJIIT ? { kind: 'RACE', getFormID: () => id } : form(id)),
      setBeastForm: () => {}, forceThirdPerson: () => {}, enablePlayerControls: () => {}, getCameraState: () => 1,
      showFirstPersonGeometry: () => {},
    },
    Debug: { sendAnimationEvent: () => {}, notification: () => {} },
    Input: { getMappedKey: () => 0 },
  };
  const handlers = { on: {}, once: {} };
  const controller = {
    on: (n, fn) => { (handlers.on[n] = handlers.on[n] || []).push(fn); },
    once: (n, fn) => { (handlers.once[n] = handlers.once[n] || []).push(fn); },
    emitter: { on: (n, fn) => { (handlers.on[n] = handlers.on[n] || []).push(fn); } },
  };
  const fire = (n, e) => {
    const once = handlers.once[n] || []; handlers.once[n] = [];
    for (const fn of once) fn(e);
    for (const fn of handlers.on[n] || []) fn(e);
  };
  const update = (ms = 16) => { now += ms; fire('update'); };
  // An engine equip: the item goes on, then the game's TESEquipEvent reaches the listeners
  const equip = (id) => { worn.add(id); fire('equip', { actor: player, baseObj: form(id), uniqueId: 0, originalRefr: null }); };
  const beast = (r, beastOn, wear) => { fire('customPacketMessage', { content: { customPacketType: 'dboBeast', race: r, beast: beastOn, wear: wear || [], abilities: { right: [], left: [], voice: [], passive: [] } } }); update(); };

  new BeastFormService(sp, controller);
  check('the gear guard listens to the game\'s equip events', (handlers.on.equip || []).length > 0, Object.keys(handlers.on));

  // Before any form: her own equips are hers
  equip(CUIRASS); equip(BOOTS); equip(ARROWS);
  update(); update();
  check('in her own shape nothing she equips is taken off', worn.has(CUIRASS) && worn.has(BOOTS) && worn.has(ARROWS), [...worn]);

  // 23:07:31.1 Beast Form: unequipAll and the werewolf race
  beast(WEREWOLF, true);
  check('the change strips her and makes her a werewolf', worn.size === 0 && race === WEREWOLF, [...worn]);

  // 23:07:31.52 the server's login re-dress: EquipItem for the outfit and the arrows
  equip(CUIRASS); equip(BOOTS); equip(ARROWS);
  update();
  check('the re-dressed arrows come off the werewolf on the next update (no quiver on its back)', !worn.has(ARROWS), [...worn]);
  check('...and so does the re-dressed armour', !worn.has(CUIRASS) && !worn.has(BOOTS), [...worn]);

  // inventory.ts's ammo re-equip, a weapon and a torch put on by anything else
  equip(ARROWS); equip(PICKAXE); equip(TORCH);
  update();
  check('ammo, a weapon and a light equipped while a werewolf all come off', worn.size === 0, [...worn]);

  // Not gear: a potion drunk in the form is not touched (the engine does not keep it worn anyway)
  equip(POTION_ID);
  update();
  check('a potion is not gear', worn.has(POTION_ID), [...worn]);
  worn.delete(POTION_ID);
  check('each take-off is in the client diagnostics', traces.includes('beast gear off 1003') && traces.includes('beast gear off 1004'), traces);

  // A spell hit, then the werewolf race gone while she is up (Purr, 16 Oct): traced once, naming the hit
  now += 4000;
  fire('hit', { target: player, aggressor: null, source: { getFormID: () => SPARKS } });
  race = KHAJIIT;
  update(600); update(600);
  const lost = traces.filter((t) => /^beast lost /.test(t));
  check('a form whose race went while she is up is traced once, with the last hit', lost.length === 1 && /^beast lost form=cdd84 race=13745 hit=2dd2a \d+ms$/.test(lost[0]), lost);
  race = WEREWOLF;

  // The revert (time up): her own race again, and beastform.js re-dresses her 1.5 s later
  beast(KHAJIIT, false);
  now += 1500;
  equip(CUIRASS); equip(BOOTS); equip(ARROWS);
  update(); update();
  check('after the revert the re-dress stays on, arrows included', worn.has(CUIRASS) && worn.has(BOOTS) && worn.has(ARROWS), [...worn]);

  // A Vampire Lord: the robe the server lists in wear stays, other gear goes
  beast(VL, true, [ROBE]);
  check('the Vampire Lord change strips the outfit and puts on the robe', !worn.has(CUIRASS) && worn.has(ROBE), [...worn]);
  fire('equip', { actor: player, baseObj: form(ROBE), uniqueId: 0, originalRefr: null });
  equip(BOOTS); equip(ARROWS);
  update();
  check('the Lord keeps the robe from the server\'s wear list', worn.has(ROBE), [...worn]);
  check('...and loses the boots and arrows put on after it', !worn.has(BOOTS) && !worn.has(ARROWS), [...worn]);

  // The revert's update runs before a queued take-off: the deferred check sees her own shape and leaves the item on
  fire('customPacketMessage', { content: { customPacketType: 'dboBeast', race: KHAJIIT, beast: false, wear: [] } });
  equip(ARROWS);
  update();
  check('a take-off that runs after the revert leaves the item on', worn.has(ARROWS) && race === KHAJIIT, [...worn]);
  check('no gear errors were logged', !globalThis.__errors.some((e) => /gear/.test(e)), globalThis.__errors.filter((e) => /gear/.test(e)));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
