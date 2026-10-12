// Scripted test for house-keys.json, the property key pool. Players keep getting "Werewolf Cage Key" (#QE84 6 Oct, #LLX8
// 8 Oct, #TAT5 11 Oct) and their house keys stack so the right one cannot be traded (#R4XE 9 Oct). Every property key was
// cut on the vanilla Werewolf Cage Key (Skyrim.esm 0xdb0e2, dunPOITundraWerewolfKey) with its credential in the name. The
// game holds the keys of one record as one stack under one name, so the client's 5 s inventory apply finds its keys never
// match the server's and takes every key off and gives the server's set back (inventory.ts withKeysRebuilt), on every
// apply, for good. The client's invKeys lines show it (12 Oct 05:01:26Z, #TAT5: "Key to the Foratus' Home (recut 2)" held
// 9 more times than the server has it, nine other keys of the server's not held). The fork's one-record-per-lock pool
// (houseKeys.ts, 1ea15944, live since 8 Oct) and its 1,024 KEYM records (DragonBreak Online Edits.esp DBO_HouseKey0001-
// 1024, since DLE 0d765a53 on 9 Oct) were in place but OFF: house-keys.json, the list that switches it on, was never written.
//
//   node tests/house-keys-pool-harness.js [--esp <DragonBreak Online Edits.esp>] [--fork <skymp5-server dir>]
//                                         [--client <skymp5-client dir>] [--esbuild <esbuild package dir>]
//   (or FORK=<fork with skymp5-client> FORK_SERVER=<fork with skymp5-server and node_modules>, as tests/run-all.sh sets)
//
// Part 1 reads house-keys.json against the plugin. Part 2 runs the fork's own housingSystem.ts and houseKeys.ts (bundled
// with esbuild on a fake mp) on the file: keys cut for different locks, and a login with keys on 0xdb0e2. Part 3 runs the
// client's own inventory.ts apply on what part 2 leaves in the pack, with a game that stacks one record's keys under one
// name (what the invKeys lines show), and counts the keys taken off and given back. Parts 2 and 3 are skipped without the
// trees they need.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const POOL_FILE = path.join(ROOT, 'house-keys.json');
const PLUGIN = 'DragonBreak Online Edits.esp';
const VANILLA_KEY = 0x000db0e2;
// Any load-order byte does: the fake mp resolves the plugin's records under it, and the client reads the same ids
const DLE = 0x67000000;

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const firstExisting = (...ps) => ps.find((p) => p && fs.existsSync(p));
const espPath = firstExisting(arg('--esp'), path.join('/opt/skyrim-data', PLUGIN));
// tests/run-all.sh exports FORK (the client line) and FORK_SERVER (fork main), as for the other fork harnesses
const env = (name, sub) => (process.env[name] ? path.join(process.env[name], sub) : undefined);
const forkDir = firstExisting(arg('--fork'), env('FORK_SERVER', 'skymp5-server'), env('FORK', 'skymp5-server'));
const clientDir = firstExisting(arg('--client'), env('FORK', 'skymp5-client'));
const esbuildDir = firstExisting(arg('--esbuild'), forkDir && path.join(forkDir, 'node_modules', 'esbuild'));

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined && !ok ? '   ' + JSON.stringify(detail) : ''}`);
  if (!ok) failures++;
};
const hex = (n) => (n >>> 0).toString(16);

// ---- the plugin: KEYM records by local id -------------------------------------------------------------------------------
const readKeyRecords = (file) => {
  const data = fs.readFileSync(file);
  const keys = new Map(); // local id -> { editorId, deleted }
  let masters = 0;
  const subrecords = (buf) => {
    const out = new Map();
    for (let i = 0; i + 6 <= buf.length;) {
      const t = buf.toString('latin1', i, i + 4), n = buf.readUInt16LE(i + 4);
      if (!out.has(t)) out.set(t, buf.subarray(i + 6, i + 6 + n));
      if (t === 'MAST') masters++;
      i += 6 + n;
    }
    return out;
  };
  const walk = (off, end) => {
    while (off < end) {
      const type = data.toString('latin1', off, off + 4), size = data.readUInt32LE(off + 4);
      if (type === 'GRUP') { walk(off + 24, off + size); off += size; continue; }
      const flags = data.readUInt32LE(off + 8), formId = data.readUInt32LE(off + 12);
      let body = data.subarray(off + 24, off + 24 + size);
      if (type === 'TES4') subrecords(body);
      if (type === 'KEYM') {
        if (flags & 0x40000) body = zlib.inflateSync(body.subarray(4));
        const edid = subrecords(body).get('EDID');
        // The plugin's own records carry its master count as their top byte
        if ((formId >>> 24) === masters) keys.set(formId & 0xffffff, { editorId: edid ? edid.toString('latin1').replace(/\0+$/, '') : '', deleted: !!(flags & 0x20) });
      }
      off += 24 + size;
    }
  };
  walk(0, data.length);
  return keys;
};

// ---- part 1: the file --------------------------------------------------------------------------------------------------
console.log('-- house-keys.json');
let pool = null;
try { pool = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8')).pool; } catch (e) { pool = null; }
check('house-keys.json is beside the gamemode and lists a pool (without it every key is cut on the Werewolf Cage Key)', Array.isArray(pool) && pool.length > 0, pool === null ? 'no file' : pool);
pool = Array.isArray(pool) ? pool : [];
const DESC = /^([0-9a-f]{1,6}):DragonBreak Online Edits\.esp$/;
check('every entry names a record of DragonBreak Online Edits.esp by its local id', pool.every((d) => typeof d === 'string' && DESC.test(d)), pool.filter((d) => !DESC.test(String(d))).slice(0, 5));
const locals = pool.map((d) => parseInt((DESC.exec(String(d)) || [])[1], 16));
check('no record is listed twice', new Set(locals).size === locals.length);

let keyRecords = null;
if (espPath) {
  keyRecords = readKeyRecords(espPath);
  const houseKeys = [...keyRecords].filter(([, r]) => !r.deleted && /^DBO_HouseKey\d+$/.test(r.editorId)).map(([id]) => id);
  console.log(`   (${path.basename(espPath)}: ${keyRecords.size} KEYM records of its own, ${houseKeys.length} DBO_HouseKey)`);
  const notKeys = locals.filter((id) => !keyRecords.has(id) || keyRecords.get(id).deleted);
  check('every listed record is a live KEYM record of the plugin', pool.length > 0 && notKeys.length === 0, notKeys.slice(0, 5).map(hex));
  check('every DBO_HouseKey record of the plugin is in the pool', pool.length > 0 && houseKeys.every((id) => locals.includes(id)), houseKeys.filter((id) => !locals.includes(id)).length);
} else {
  console.log('SKIP  the plugin checks (no --esp and no /opt/skyrim-data copy)');
}

// ---- part 2: the fork on the file --------------------------------------------------------------------------------------
const bundle = async (esbuild, entry, out, stubs = {}) => {
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    // A tree without node_modules of its own resolves its packages beside esbuild
    nodePaths: [path.dirname(esbuildDir)],
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (stubs[a.path] !== undefined ? { path: a.path, namespace: 'stub' } : undefined));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path], loader: 'js' }));
    } }],
  });
  return require(out);
};

const serverPart = async (esbuild, scratch) => {
  console.log('-- the fork (housingSystem.ts, houseKeys.ts) with this house-keys.json');
  const sys = path.join(forkDir, 'ts', 'systems');
  const { HousingSystem } = await bundle(esbuild, path.join(sys, 'housingSystem.ts'), path.join(scratch, 'housing.js'));
  const K = await bundle(esbuild, path.join(sys, 'houseKeys.ts'), path.join(scratch, 'keys.js'));
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(fs.readFileSync(path.join(scratch, 'housing.js'), 'utf8')) || [])[1];

  const props = new Map();
  const OWNER = 0xff000014, OWNER_USER = 3, HOLDER = 0xff000574;
  const mp = {
    get: (id, key) => { if (key === 'profileId') return id === OWNER ? 11 : id === HOLDER ? 78 : 0; const v = props.get(`${id >>> 0}:${key}`); return v === undefined ? undefined : JSON.parse(v); },
    set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
    getUserByActor: (id) => (id === OWNER ? OWNER_USER : -1),
    getUserActor: (u) => (u === OWNER_USER ? OWNER : 0),
    isConnected: (u) => u === OWNER_USER,
    sendCustomPacket: () => { },
    getIdFromDesc: (d) => { const m = DESC.exec(String(d)); return m ? (DLE | parseInt(m[1], 16)) >>> 0 : 0; },
    lookupEspmRecordById: (id) => {
      if ((id >>> 0) === VANILLA_KEY) return { record: { type: 'KEYM' } };
      if ((id >>> 24) !== (DLE >>> 24)) return null;
      const local = id & 0xffffff;
      // Without the plugin, the listed records are taken to be keys (part 1 says it was not read)
      if (!keyRecords) return locals.includes(local) ? { record: { type: 'KEYM' } } : null;
      const r = keyRecords.get(local);
      return r && !r.deleted ? { record: { type: 'KEYM' } } : null;
    },
  };
  const ctx = { svr: mp };
  const housing = new HousingSystem(() => { });
  housing.holdOf = () => null; housing.isAdmin = () => false; housing.holdRanks = () => []; housing.partnerOf = () => 0; housing.saveRegistry = () => { };
  // Six locks; the last four are the ones a castle steward hands out keys to, like #TAT5's
  const FORT = 0x100, HOUSE = 0x300, SHOP = 0x400, GATE = 0x500, CHEST = 0x600, TOWER = 0x700;
  housing.claimed = [FORT, HOUSE, SHOP, GATE, CHEST, TOWER];
  const record = (name, issued) => ({ owner: 11, ownerName: 'Nat', name, locked: true, serial: 1, partner: 0, containers: [], issued });
  for (const [id, n] of [[FORT, 'Fort'], [HOUSE, 'House'], [SHOP, 'Shop']]) mp.set(id, HP, record(n, []));
  for (const [id, n] of [[GATE, 'Castle Gate'], [CHEST, 'Castle Chest'], [TOWER, 'Castle Tower']]) mp.set(id, HP, record(n, [`Key to the ${n}`, `Key to the ${n} No. 2`]));
  const recOf = (id) => housing.read(ctx, id);
  const keysOf = (actor) => ((mp.get(actor, 'inventory') || {}).entries || []).filter((e) => K.isPropertyKeyBase(e.baseId));
  const cut = (id) => { housing.doCreateKey(ctx, OWNER_USER, OWNER, id, recOf(id), true); return recOf(id).issued.slice(-1)[0]; };

  const cwd = process.cwd();
  process.chdir(scratch);
  if (fs.existsSync(POOL_FILE)) fs.copyFileSync(POOL_FILE, path.join(scratch, 'house-keys.json'));
  try {
    const resolved = K.refreshKeyPool(mp);
    check(`the pool resolves to KEYM records (${resolved.length})`, resolved.length > 0 && resolved.length === pool.length, resolved.length);

    // The owner cuts keys: two for the House, one each for the Fort and the Shop
    const cutNames = [cut(FORT), cut(HOUSE), cut(HOUSE), cut(SHOP)];
    const baseOf = (actor, name) => (keysOf(actor).find((e) => e.name === name) || {}).baseId;
    const bases = cutNames.map((n) => baseOf(OWNER, n));
    check('a new key is not cut on the Werewolf Cage Key', bases.every((b) => b !== undefined && b !== VANILLA_KEY), bases.map((b) => b && hex(b)));
    check('keys to three locks are on three records of their own', new Set([bases[0], bases[1], bases[3]]).size === 3 && bases[1] === bases[2], bases.map((b) => b && hex(b)));

    // A holder logs in with castle keys cut before the pool (on 0xdb0e2), and one key no lock answers to any more
    const legacy = [];
    for (const id of [GATE, CHEST, TOWER]) for (const n of recOf(id).issued) legacy.push({ baseId: VANILLA_KEY, count: 1, name: n });
    legacy.push({ baseId: VANILLA_KEY, count: 1, name: 'Key to a burned house (DEAD)' });
    mp.set(HOLDER, 'inventory', { entries: legacy.map((e) => ({ ...e })) });
    housing.migrateKeys(ctx, HOLDER);
    const moved = keysOf(HOLDER).filter((e) => e.name !== 'Key to a burned house (DEAD)');
    const lockBase = (id) => recOf(id).keyBase;
    check('at login every key of a lock moves off the Werewolf Cage Key to that lock\'s record, names kept',
      moved.length === 6 && [GATE, CHEST, TOWER].every((id) => recOf(id).issued.every((n) => moved.some((e) => e.name === n && e.baseId === lockBase(id) && e.baseId !== VANILLA_KEY))),
      keysOf(HOLDER).map((e) => `${hex(e.baseId)} ${e.name}`));
    check('...the castle locks hold three different records', new Set([GATE, CHEST, TOWER].map(lockBase)).size === 3 && [GATE, CHEST, TOWER].every((id) => lockBase(id) && lockBase(id) !== VANILLA_KEY), [GATE, CHEST, TOWER].map((id) => lockBase(id) && hex(lockBase(id))));
    const access = housing.viewerAccess(ctx, HOLDER);
    check('...and every moved key still reads as a key for access', moved.every((e) => access.keys.has(e.name)), [...access.keys]);
    return { owner: { entries: keysOf(OWNER) }, holder: { entries: keysOf(HOLDER) } };
  } finally {
    process.chdir(cwd);
  }
};

// ---- part 3: the client's apply on what the server holds ---------------------------------------------------------------
const clientPart = async (esbuild, scratch, packs) => {
  console.log('-- the client (inventory.ts applyInventory) on a game that stacks one record\'s keys under one name');
  const FormType = { Armor: 26, Ingredient: 30, Misc: 32, Weapon: 41, Ammo: 42, Key: 45, Potion: 46 };
  class Form { }
  class ObjectReference { }
  const isKey = (id) => (id >>> 0) === VANILLA_KEY || (id >>> 24) === (DLE >>> 24);
  const form = (id) => Object.assign(new Form(), {
    getFormID: () => id >>> 0, getType: () => (isKey(id) ? FormType.Key : FormType.Misc), isPlayable: () => true,
    getName: () => ((id >>> 0) === VANILLA_KEY ? 'Werewolf Cage Key' : 'Key'),
  });
  // The game: a key joins the stack of its record that is already there, which keeps its name (the invKeys reading)
  const game = { stacks: [], ops: 0 };
  const add = (baseId, n, name) => {
    const s = game.stacks.find((x) => x.baseId === baseId && (isKey(baseId) || x.name === name));
    if (s) s.count += n; else game.stacks.push({ baseId, count: n, name });
  };
  const take = (baseId, n, name) => {
    for (const pass of [(x) => x.name === name, () => true]) {
      for (const s of game.stacks) { if (n > 0 && s.baseId === baseId && pass(s)) { const k = Math.min(n, s.count); s.count -= k; n -= k; } }
    }
    game.stacks = game.stacks.filter((s) => s.count > 0);
  };
  const player = Object.assign(new ObjectReference(), {
    getFormID: () => 0x14, getBaseObject: () => ({ getFormID: () => 7 }), isEquipped: () => false,
    getItemCount: (f) => game.stacks.filter((s) => s.baseId === f.getFormID()).reduce((n, s) => n + s.count, 0),
    removeItem: (f, n) => { if (isKey(f.getFormID())) game.ops++; take(f.getFormID(), n); },
    removeAllItems: () => { game.stacks = []; },
  });
  const notes = [];
  globalThis.__dboDiagNote = (kind, text) => notes.push(`${kind} ${text}`);
  globalThis.__cageKeysSp = {
    Game: { getFormEx: (id) => form(id), getPlayer: () => player },
    TESModPlatform: {
      addItemEx: (refr, f, count, health, ench, maxCharge, rmOnUnequip, charge, name) => {
        if (isKey(f.getFormID())) game.ops++;
        if (count > 0) add(f.getFormID(), count, name); else take(f.getFormID(), -count, name);
      },
      pushWornState: () => { }, resetContainer: () => { },
    },
    getExtraContainerChanges: () => {
      const byBase = new Map();
      for (const s of game.stacks) {
        const c = byBase.get(s.baseId) || { baseId: s.baseId, countDelta: 0, extendDataList: [] };
        c.countDelta += s.count;
        c.extendDataList.push([{ type: 'TextDisplayData', name: s.name }, { type: 'Count', count: s.count }]);
        byBase.set(s.baseId, c);
      }
      return [...byBase.values()];
    },
    getContainer: () => [], storage: {}, printConsole: () => { }, once: () => { }, createEnchantment: undefined,
    FormType, Form, ObjectReference,
    Actor: { from: (r) => r }, Ammo: { from: () => null }, Weapon: { from: () => null }, Enchantment: { from: () => null }, Potion: { from: () => null },
  };
  const names = Object.keys(globalThis.__cageKeysSp);
  const { applyInventory } = await bundle(esbuild, path.join(clientDir, 'src', 'sync', 'inventory.ts'), path.join(scratch, 'inventory.js'), {
    skyrimPlatform: `const sp = globalThis.__cageKeysSp;\n${names.map((n) => `export const ${n} = sp.${n};`).join('\n')}`,
    './appearance': 'export const baseIsPlayers = () => false;',
    '../view/niNodeQueue': 'export const queueCopyNiNodeUpdate = () => {}; export const queuePlayerNiNodeUpdate = () => {};',
  });

  // The first apply fills an empty pack; each later one is the 5 s apply with nothing changed on the server
  const churn = (inv) => {
    game.stacks = []; notes.length = 0;
    applyInventory(player, inv, false);
    game.ops = 0;
    for (let i = 0; i < 3; i++) applyInventory(player, inv, false);
    return game.ops;
  };
  const live = { entries: ['Key to the Foratus\' Home (recut 2)', 'Key to Bruma Castle, the second (recut 2)', 'Key to the Castle Bruma: Chest 11 (8079C0F)']
    .map((name) => ({ baseId: VANILLA_KEY, count: 1, name })) };
  const liveOps = churn(live);
  check('the live symptom: keys of three locks on the Werewolf Cage Key are taken off and given back on every 5 s apply', liveOps >= 3 * 3, liveOps);
  console.log(`   (the client's own note: ${notes[0] || 'none'})`);

  const ownerOps = churn(packs.owner), holderOps = churn(packs.holder);
  check('the key cutter\'s pack: after the first apply, the 5 s applies take off and give back no key', ownerOps === 0, { ops: ownerOps, keys: packs.owner.entries.map((e) => `${hex(e.baseId)} ${e.name}`) });
  check('the castle key holder\'s pack after the login move: the 5 s applies take off and give back no key', holderOps === 0, { ops: holderOps, keys: packs.holder.entries.map((e) => `${hex(e.baseId)} ${e.name}`), note: notes[0] });
};

(async () => {
  if (!forkDir || !esbuildDir) {
    console.log('SKIP  the fork and client parts (no --fork with node_modules/esbuild, or --esbuild)');
  } else {
    const esbuild = require(esbuildDir);
    const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cage-keys-'));
    try {
      const packs = await serverPart(esbuild, scratch);
      if (clientDir) await clientPart(esbuild, scratch, packs);
      else console.log('SKIP  the client part (no --client)');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
  console.log(failures ? `${failures} FAILED` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
