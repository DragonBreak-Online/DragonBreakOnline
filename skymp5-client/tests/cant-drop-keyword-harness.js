// Scripted test for sweetTaffySweetCantDropService.ts through the real ContainersService and DropItemService: salt piles,
// Aversion poisons and Waterbreathing potions put in a chest or dropped reach the server (#bugs 1558102159587811428 and
// 1558208502584057916: they came back to the pack). The fake game answers HasKeyword the way the 11-12 Oct server trace
// shows the real one does: None matches an item's keywordless Peak Value Modifier effect (1099 moves of such items, 0
// puts; 2775 moves of the rest, 1511 puts). Run from skymp5-client:
//
//   node tests/cant-drop-keyword-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP cant-drop-keyword (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const STUBS = {
  skyrimPlatform: `module.exports = {
    printConsole() {}, once() {}, createEnchantment() {}, storage: {}, TESModPlatform: {},
    FormType: { Ingredient: 30, Potion: 46, Misc: 32 },
    getExtraContainerChanges: (id) => globalThis.__h.changes(id), getContainer: () => [],
    Game: { getFormEx: (id) => globalThis.__h.form(id) },
    Actor: { from: (x) => x }, ObjectReference: { from: (x) => x }, Ammo: { from: () => null }, Weapon: { from: () => null },
    Potion: { from: () => null }, Enchantment: { from: () => null },
  };`,
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  appearance: 'module.exports = { baseIsPlayers: () => true };',
  niNodeQueue: 'module.exports = { queueCopyNiNodeUpdate() {}, queuePlayerNiNodeUpdate() {} };',
  remoteServer: 'module.exports = { getPcInventory: () => globalThis.__h.pcInv };',
  worldViewMisc: 'module.exports = { localIdToRemoteId: (id) => id >>> 0 };',
  worldCleanerService: 'class WorldCleanerService { getWcProtection() { return 0; } } module.exports = { WorldCleanerService };',
  logging: 'module.exports = { logTrace() {}, logError() {} };',
  customPacketUtil: 'module.exports = { notifyNextUpdate() {} };',
};
const STUB_OF = {
  skyrimPlatform: 'skyrimPlatform', './clientListener': 'clientListener', './appearance': 'appearance',
  '../view/niNodeQueue': 'niNodeQueue', './remoteServer': 'remoteServer', '../../view/worldViewMisc': 'worldViewMisc',
  './worldCleanerService': 'worldCleanerService', '../../logging': 'logging', './customPacketUtil': 'customPacketUtil',
};
const ENTRY = `
export { ContainersService } from './src/services/services/containersService';
export { DropItemService } from './src/services/services/dropItemService';
export { SweetTaffySweetCantDropService } from './src/services/services/sweetTaffySweetCantDropService';
export { LastInvService } from './src/services/services/lastInvService';
export { WorldCleanerService } from './worldCleanerService';
`;

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cant-drop-keyword-'));
  const out = path.join(tmp, 'services.js');
  try {
    await esbuild.build({
      stdin: { contents: ENTRY, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' },
      bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      } }],
    });
    run(require(out));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// MGEF archetype 34; the effect's associated form is the keyword that keeps two of them from stacking
const PEAK_VALUE_MODIFIER = 0x22;
const VALUE_MODIFIER = 0;
const kw = (name) => ({ name });
const KW = { ingredient: kw('VendorItemIngredient'), foodRaw: kw('VendorItemFoodRaw'), salt: kw('0123VendorItemSALT'),
  poison: kw('VendorItemPoison'), potion: kw('VendorItemPotion'), resistFire: kw('MagicAlchResistFire'), cantDrop: kw('SweetCantDrop') };
const effect = (archetype, assoc = null) => ({ archetype, assoc });
const WEAKNESS_MAGIC = effect(PEAK_VALUE_MODIFIER);   // AlchWeaknessMagic 073f51: associated item 0
const WATERBREATHING = effect(PEAK_VALUE_MODIFIER);   // AlchWaterbreathing 03ac2d: associated item 0
const RESIST_FIRE = effect(PEAK_VALUE_MODIFIER, KW.resistFire);   // AlchResistFire 03eaea: associated item 65a37
const DAMAGE_STAMINA = effect(VALUE_MODIFIER);
const FORTIFY_RESTORATION = effect(PEAK_VALUE_MODIFIER, kw('MagicAlchFortifyRestoration'));

const SALT = 0x34cdf, AVERSION = 0x73f56, WATERBREATHING_POTION = 0x3ac2f, STAMINA_POISON = 0x73f41, RESIST_FIRE_POTION = 0x3eae9;
const SEALED = 0x80ab001, CHEST = 0x8071a34, PLAYER = 0x14;
const ITEMS = {
  [SALT]: { name: 'Salt Pile', keywords: [KW.ingredient, KW.foodRaw, KW.salt], effects: [WEAKNESS_MAGIC, FORTIFY_RESTORATION, DAMAGE_STAMINA] },
  [AVERSION]: { name: 'Aversion to Magic', keywords: [KW.poison], effects: [WEAKNESS_MAGIC] },
  [WATERBREATHING_POTION]: { name: 'Draught of Waterbreathing', keywords: [KW.potion], effects: [WATERBREATHING] },
  [STAMINA_POISON]: { name: 'Stamina Poison', keywords: [KW.poison], effects: [DAMAGE_STAMINA] },
  [RESIST_FIRE_POTION]: { name: 'Potion of Resist Fire', keywords: [KW.potion], effects: [RESIST_FIRE] },
  [SEALED]: { name: 'Sealed Parcel', keywords: [KW.cantDrop], effects: [] },
};

function run({ ContainersService, DropItemService, SweetTaffySweetCantDropService, LastInvService, WorldCleanerService }) {
  const make = ({ loadOrderHasCantDrop }) => {
    const sent = [];
    const handlers = {};
    const listeners = new Map();
    const pack = new Map();
    const refs = new Map();
    const form = (id) => {
      if (refs.has(id)) return refs.get(id);
      const it = ITEMS[id];
      if (!it) return id === PLAYER || id === CHEST ? { getFormID: () => id } : null;
      return {
        getFormID: () => id, getName: () => it.name, getType: () => 46,
        // HasKeyword: the item's own keywords, then each Peak Value Modifier effect's associated keyword (None matches none)
        hasKeyword: (k) => it.keywords.includes(k) || it.effects.some((e) => e.archetype === PEAK_VALUE_MODIFIER && e.assoc === (k || null)),
      };
    };
    globalThis.__h = {
      form,
      changes: (id) => (id === PLAYER ? [...pack].map(([baseId, countDelta]) => ({ baseId, countDelta, extendDataList: [] })) : []),
      pcInv: { entries: [] },
    };
    const player = { getFormID: () => PLAYER, getPositionX: () => 0, getPositionY: () => 0, getPositionZ: () => 0 };
    let found = [];
    const sp = {
      Game: { getPlayer: () => player, getFormEx: form, findRandomReferenceOfType: () => found.shift() || null },
      Keyword: { getKeyword: (name) => (loadOrderHasCantDrop && name === 'SweetCantDrop' ? KW.cantDrop : null) },
      ObjectReference: { from: (x) => x },
      Ui: { isMenuOpen: (name) => name === 'InventoryMenu' },
    };
    const controller = {
      on: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); },
      emitter: { emit: (name, m) => { if (name === 'sendMessage') sent.push(m.message); } },
      lookupListener: (ctor) => listeners.get(ctor),
    };
    for (const [ctor, inst] of [[SweetTaffySweetCantDropService, new SweetTaffySweetCantDropService(sp, controller)],
      [LastInvService, new LastInvService(sp, controller)], [WorldCleanerService, new WorldCleanerService()],
      [ContainersService, new ContainersService(sp, controller)], [DropItemService, new DropItemService(sp, controller)]]) {
      listeners.set(ctor, inst);
    }
    const fire = (e) => (handlers.containerChanged || []).forEach((fn) => fn(e));
    const hold = (baseId, n) => { pack.set(baseId, n); globalThis.__h.pcInv = { entries: [...pack].map(([b, c]) => ({ baseId: b, count: c })) }; };
    // The game has already moved the items when it reports the move
    const put = (baseId, n) => {
      pack.set(baseId, (pack.get(baseId) || 0) - n);
      fire({ oldContainer: form(PLAYER), newContainer: form(CHEST), baseObj: form(baseId), numItems: n, reference: null });
    };
    let nextRef = 0xff000a00;
    const drop = (baseId, n) => {
      pack.set(baseId, (pack.get(baseId) || 0) - n);
      let deleted = false;
      const id = nextRef++;
      const ref = { getFormID: () => id, isDeleted: () => deleted, delete: () => { deleted = true; }, getItemMaxCharge: () => 0 };
      refs.set(id, ref);
      found = [ref];
      fire({ oldContainer: form(PLAYER), newContainer: null, baseObj: form(baseId), numItems: n, reference: ref });
    };
    return { sent, hold, put, drop };
  };
  const puts = (t, baseId) => t.sent.filter((m) => m.t === 8 && m.baseId === baseId);
  const drops = (t, baseId) => t.sent.filter((m) => m.t === 19 && m.baseId === baseId);

  // ---- the live load order: no SweetCantDrop keyword ------------------------------------------------------------------
  {
    const t = make({ loadOrderHasCantDrop: false });
    t.hold(SALT, 52); t.put(SALT, 51);
    const p = puts(t, SALT);
    check('51 salt piles put in a chest reach the server (Roderic, 12 Oct 06:15)', p.length === 1 && p[0].count === 51 && p[0].target === CHEST, t.sent);
  }
  {
    const t = make({ loadOrderHasCantDrop: false });
    t.hold(AVERSION, 4); t.put(AVERSION, 1);
    check('an Aversion to Magic put in a chest reaches the server (Sylvia, 11 Oct 18:55)', puts(t, AVERSION).length === 1, t.sent);
  }
  {
    const t = make({ loadOrderHasCantDrop: false });
    t.hold(WATERBREATHING_POTION, 3); t.put(WATERBREATHING_POTION, 3);
    check('three Draughts of Waterbreathing put in a chest reach the server', puts(t, WATERBREATHING_POTION).length === 1 && puts(t, WATERBREATHING_POTION)[0].count === 3, t.sent);
  }
  {
    const t = make({ loadOrderHasCantDrop: false });
    t.hold(AVERSION, 17); t.drop(AVERSION, 1);
    check('an Aversion to Magic dropped from the inventory reaches the server (Ghostmantle, 9 Oct)', drops(t, AVERSION).length === 1, t.sent);
  }
  {
    const t = make({ loadOrderHasCantDrop: false });
    t.hold(SALT, 156); t.drop(SALT, 5);
    check('five salt piles dropped reach the server, all five', drops(t, SALT).length === 1 && drops(t, SALT)[0].count === 5, t.sent);
  }
  {
    const t = make({ loadOrderHasCantDrop: false });
    t.hold(STAMINA_POISON, 4); t.put(STAMINA_POISON, 1);
    t.hold(RESIST_FIRE_POTION, 2); t.put(RESIST_FIRE_POTION, 2);
    check('a Stamina Poison and a Resist Fire potion still go in as before', puts(t, STAMINA_POISON).length === 1 && puts(t, RESIST_FIRE_POTION).length === 1, t.sent);
  }
  // ---- a load order that has the keyword: the check still works ---------------------------------------------------------
  {
    const t = make({ loadOrderHasCantDrop: true });
    t.hold(SEALED, 1); t.put(SEALED, 1);
    t.hold(SALT, 10); t.put(SALT, 10);
    check('with SweetCantDrop in the load order an item carrying it is not sent', puts(t, SEALED).length === 0, t.sent);
    check('...and salt is still sent: its effect names no keyword, not that one', puts(t, SALT).length === 1, t.sent);
  }
  {
    const t = make({ loadOrderHasCantDrop: true });
    t.hold(SEALED, 1); t.drop(SEALED, 1);
    check('...nor dropped', drops(t, SEALED).length === 0, t.sent);
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
