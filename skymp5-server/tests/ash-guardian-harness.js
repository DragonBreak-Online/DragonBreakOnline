// Scripted test for Conjure Ash Guardian (conjurationSystem.ts, espmMagic.ts explosionPlacedNpc): a spell whose projectile's
// explosion places an NPC_ (DLC2AshGuardianRune -> DLC2AshGuardianProjectile02 -> DLC2ExplosionAshGuardian ->
// DLC2SummonAshGuardian) places that NPC as the caster's summon through companions.spawn: where the explosion hit an actor,
// or in front of the caster when no hit arrives; one per cast, guarding its spot, until killed by default. A spell with no
// such explosion places nothing, and "explosionSummonEnabled": false switches
// it off. Real espmMagic on fake records, real companionSystem; settings and placement stubbed. Run it from skymp5-server
// with node_modules present:
//
//   node tests/ash-guardian-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-ash-guardian-'));
const bundle = path.join(out, 'conjuration.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const A = 0xff000101, WOLF = 0xff000200;
const PLAYER_BASE = 0x7;
const RUNE = 0x04017782, MGEF = 0x0401777e, PROJ = 0x04017783, EXPL = 0x04017781, GUARDIAN = 0x040177b6;
const FIRE = 0x12fcd, FIRE_MGEF = 0x12fce, FIRE_PROJ = 0x12fcf, FIRE_EXPL = 0x12fd0, FIRE_LIGHT = 0x12fd1;
// DLC2ExpSpiderFireCloakScroll: a scroll whose explosion places its spider (DLC2ExpSpiderFireCloakingFriend)
// conjurationSystem's SPIDER_SCROLL_SEC default
const SCROLL_SEC = 60;
// DLC2ExpSpiderOilScroll: its MGEF names the explosion outright at 0x4c, with no projectile in between
const OIL_SCROLL = 0x0402749d, OIL_MGEF = 0x0402749e, OIL_EXPL = 0x0402749f, OIL_SPIDER = 0x04027495;
const SCROLL = 0x0401952c, SP_MGEF = 0x0401952d, SP_PROJ = 0x04019530, SP_EXPL = 0x04019531, SPIDER = 0x04019529;
const ATRONACH = 0x204c0;

const STUBS = {
  '../settings': 'module.exports = { Settings: { get: async () => ({ allSettings: globalThis.__ashSettings || {} }) } };',
  './npcPlacement': 'module.exports = { HOSTILE_PROP: "ff_hostile", placeNpc: (...x) => globalThis.__ashPlace(...x), placeAtMe: () => 0 };',
  '../scampNative': 'module.exports = {};',
};

const u32 = (n, at, v) => { const b = Buffer.alloc(n); b.writeUInt32LE(v >>> 0, at); return new Uint8Array(b); };
const field = (type, data) => ({ type, data });
const spel = (mgef) => [field('EFID', u32(4, 0, mgef)), field('EFIT', (() => { const b = Buffer.alloc(12); b.writeFloatLE(0, 0); b.writeUInt32LE(2, 8); return new Uint8Array(b); })())];
// The real DLC2 spider scrolls name their explosion at MGEF 0x4c with no projectile, so the resolver takes that route too
const mgefDataDirect = (expl) => { const b = Buffer.from(u32(152, 0x4c, expl)); b.writeUInt32LE(1, 0x40); return new Uint8Array(b); };
const mgefData = (proj) => { const b = Buffer.from(u32(152, 0x48, proj)); b.writeUInt32LE(1, 0x40); return new Uint8Array(b); };
const RECORDS = {
  [RUNE]: ['SPEL', spel(MGEF)],
  [MGEF]: ['MGEF', [field('DATA', mgefData(PROJ))]],
  [PROJ]: ['PROJ', [field('DATA', u32(0x80, 0x24, EXPL))]],
  [EXPL]: ['EXPL', [field('DATA', u32(52, 0x10, GUARDIAN))]],
  [GUARDIAN]: ['NPC_', []],
  // A fireball: its explosion places a light, not an NPC
  [FIRE]: ['SPEL', spel(FIRE_MGEF)],
  [FIRE_MGEF]: ['MGEF', [field('DATA', mgefData(FIRE_PROJ))]],
  [FIRE_PROJ]: ['PROJ', [field('DATA', u32(0x80, 0x24, FIRE_EXPL))]],
  [FIRE_EXPL]: ['EXPL', [field('DATA', u32(52, 0x10, FIRE_LIGHT))]],
  [FIRE_LIGHT]: ['LIGH', []],
  [OIL_SCROLL]: ['SCRL', spel(OIL_MGEF)],
  [OIL_MGEF]: ['MGEF', [field('DATA', mgefDataDirect(OIL_EXPL))]],
  [OIL_EXPL]: ['EXPL', [field('DATA', u32(52, 0x10, OIL_SPIDER))]],
  [OIL_SPIDER]: ['NPC_', []],
  [SCROLL]: ['SCRL', spel(SP_MGEF)],
  [SP_MGEF]: ['MGEF', [field('DATA', mgefData(SP_PROJ))]],
  [SP_PROJ]: ['PROJ', [field('DATA', u32(0x80, 0x24, SP_EXPL))]],
  [SP_EXPL]: ['EXPL', [field('DATA', u32(52, 0x10, SPIDER))]],
  [SPIDER]: ['NPC_', []],
  [ATRONACH]: ['NPC_', []],
};

(async () => {
  await esbuild.build({
    stdin: { contents: 'export { ConjurationSystem } from "./conjurationSystem"; export { CompanionSystem } from "./companionSystem"; export { explosionPlacedNpc } from "./espmMagic";', resolveDir: path.join(root, 'ts', 'systems'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /^\.\.\/settings$|^\.\/npcPlacement$|^\.\.\/scampNative$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      },
    }],
  });
  const { ConjurationSystem, CompanionSystem, explosionPlacedNpc } = require(bundle);

  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  const timers = [];
  const realTimeout = global.setTimeout, realClear = global.clearTimeout;
  global.setTimeout = (fn, ms) => { const t = { fn, at: now + ms, done: false }; timers.push(t); return t; };
  global.clearTimeout = (t) => { if (t && typeof t === 'object' && 'done' in t) t.done = true; else realClear(t); };
  const advance = (ms) => { now += ms; for (const t of timers) if (!t.done && t.at <= now) { t.done = true; t.fn(); } };

  const props = new Map();
  const get = (id, k) => props.get(`${id >>> 0}|${k}`);
  const set = (id, k, v) => props.set(`${id >>> 0}|${k}`, v);
  const placed = [];
  let lastState = null;
  const logs = [];
  const descOf = (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`;
  const mp = {
    get: (id, k) => { const v = get(id, k); if (v === undefined && k === 'profileId') return -1; if (v === undefined) throw new Error(`no ${k} on ${id.toString(16)}`); return v; },
    set,
    getUserByActor: (id) => ((id >>> 0) === A ? 1 : -1),
    isConnected: (u) => u === 1,
    getUserActor: (u) => (u === 1 ? A : 0),
    getActorCellOrWorld: () => 0x3c,
    getActorPos: (id) => get(id, 'pos') || [0, 0, 0],
    getDescFromId: descOf,
    getIdFromDesc: (d) => parseInt(String(d), 16) >>> 0,
    lookupEspmRecordById: (id) => {
      const r = RECORDS[id >>> 0];
      return r ? { record: { id: id & 0xffffff, type: r[0], fields: r[1] }, toGlobalRecordId: (x) => x >>> 0 } : { record: null };
    },
    makeProperty: () => {},
    destroyActor: (id) => set(id, 'gone', true),
    sendCustomPacket: (u, p) => { const x = JSON.parse(p); if (x.customPacketType === 'companionState') lastState = x; },
    setHoster: () => {},
  };
  const actor = (id, base, profile, pos) => {
    set(id, 'baseDesc', descOf(base)); set(id, 'isDead', false); set(id, 'pos', pos);
    set(id, 'worldOrCellDesc', '3c:Skyrim.esm'); set(id, 'angle', [0, 0, 0]);
    if (profile >= 0) set(id, 'profileId', profile);
  };
  actor(A, PLAYER_BASE, 11, [0, 0, 0]);
  actor(WOLF, 0x23aba, -1, [0, 800, 0]);
  let nextId = 0xff000500;
  globalThis.__ashPlace = (_mp, ownerId, baseDesc, loc) => { const id = nextId++; actor(id, parseInt(baseDesc, 16), -1, loc.pos); placed.push({ id, base: parseInt(baseDesc, 16), pos: loc.pos }); return id; };
  const ctx = { svr: mp, gm: { on() {}, once() {}, emit() {} } };

  const boot = async (settings) => {
    globalThis.__ashSettings = settings || {};
    delete mp.onHitDamageAttempt; delete mp.onHostAttempt; delete mp.onSpellHit; delete mp.onSpellCast;
    process.chdir(out);
    const companions = new CompanionSystem((...x) => logs.push(x.join(' ')));
    await companions.initAsync(ctx);
    const conj = new ConjurationSystem((...x) => logs.push(x.join(' ')), companions);
    await conj.initAsync(ctx);
    placed.length = 0;
    return { companions, conj };
  };

  check('the rune\'s effect resolves to the NPC its explosion places', explosionPlacedNpc(mp, MGEF) === GUARDIAN, explosionPlacedNpc(mp, MGEF));
  check('a fireball\'s explosion places no NPC', explosionPlacedNpc(mp, FIRE_MGEF) === 0);

  let { companions, conj } = await boot();
  conj.onSpellCast(A, RUNE);
  check('a cast places nothing until the hit or the fallback', placed.length === 0);
  advance(1500);
  check('no hit: the guardian is placed in front of the caster', placed.length === 1 && placed[0].base === GUARDIAN && placed[0].pos[1] > 0, placed);
  const g = companions.info(placed[0].id);
  check('...as the caster\'s summon, until killed', g?.kind === 'summon' && g.ownerId === A && g.expiresAt === 0 && g.source === RUNE, g);
  check('...guarding its spot', lastState?.companions?.[0]?.staying === true, lastState);

  ({ companions, conj } = await boot());
  conj.onSpellCast(A, RUNE);
  advance(200);
  conj.onSpellHit(A, WOLF, RUNE);
  conj.onSpellHit(A, WOLF, RUNE);
  advance(2000);
  check('a hit on an actor places it there, once for the blast', placed.length === 1 && placed[0].pos[1] === 800, placed);

  ({ companions, conj } = await boot());
  now += 5000;
  conj.onSpellHit(A, WOLF, RUNE);
  conj.onSpellCast(A, RUNE);
  advance(2000);
  check('a hit that arrives before its cast: one guardian, at the hit', placed.length === 1 && placed[0].pos[1] === 800, placed);

  ({ companions, conj } = await boot({ explosionSummonSeconds: 120 }));
  now += 5000;
  conj.onSpellCast(A, RUNE);
  advance(1500);
  check('explosionSummonSeconds sets a lifetime', companions.info(placed[0]?.id)?.expiresAt === now + 120_000, companions.info(placed[0]?.id));

  ({ companions, conj } = await boot());
  now += 5000;
  conj.onSpellCast(A, FIRE);
  conj.onSpellHit(A, WOLF, FIRE);
  advance(2000);
  check('a fireball places nothing', placed.length === 0, placed);

  ({ companions, conj } = await boot({ explosionSummonEnabled: false }));
  now += 5000;
  conj.onSpellCast(A, RUNE);
  advance(2000);
  check('explosionSummonEnabled false: off', placed.length === 0, placed);

  // Only a spell's explosion becomes a summon: Dragonborn's spider scrolls place their spiders through the same chain
  ({ companions, conj } = await boot());
  now += 5000;
  let own = companions.spawn(A, ATRONACH, { kind: 'summon', durationSec: 600 });
  conj.onSpellCast(A, SCROLL);
  advance(2000);
  check('a spider scroll\'s cast places its spider', placed.some((x) => x.base === SPIDER), placed);
  check('...and the caster keeps their own summon', companions.info(own)?.ownerId === A, companions.info(own));
  const spider = placed.find((x) => x.base === SPIDER);
  check('...the spider is a "placed" companion, so it claims no slot', companions.info(spider?.id)?.kind === 'placed', companions.info(spider?.id));
  check('...and spiderScrollSeconds gives it a lifetime, so it is temporary', companions.info(spider?.id)?.expiresAt === now + SCROLL_SEC * 1000, companions.info(spider?.id));
  ({ companions, conj } = await boot());
  now += 5000;
  own = companions.spawn(A, ATRONACH, { kind: 'summon', durationSec: 600 });
  conj.onSpellHit(A, WOLF, SCROLL);
  advance(2000);
  check('a spider scroll\'s hit places its spider', placed.some((x) => x.base === SPIDER), placed);
  check('...and the caster keeps their own summon', companions.info(own)?.ownerId === A, companions.info(own));

  // The other route: an MGEF naming its explosion at 0x4c with no projectile. Without this the 0x4c path is untested
  // and a green run proves nothing (Worker 4, 25 Oct).
  ({ companions, conj } = await boot());
  now += 5000;
  own = companions.spawn(A, ATRONACH, { kind: 'summon', durationSec: 600 });
  conj.onSpellCast(A, OIL_SCROLL);
  advance(2000);
  check('a scroll whose MGEF names its explosion directly places its spider', placed.some((x) => x.base === OIL_SPIDER), placed);
  check('...and that caster keeps their own summon too', companions.info(own)?.ownerId === A, companions.info(own));

  // The rune is untouched: still a summon, still until killed
  ({ companions, conj } = await boot());
  now += 5000;
  conj.onSpellCast(A, RUNE);
  advance(2000);
  const guardian = placed.find((x) => x.base === GUARDIAN);
  check('the rune still places a "summon"', companions.info(guardian?.id)?.kind === 'summon', companions.info(guardian?.id));
  check('...and the rune\'s guardian is still until killed', companions.info(guardian?.id)?.expiresAt === 0, companions.info(guardian?.id));

  global.setTimeout = realTimeout; global.clearTimeout = realClear;
  Date.now = realNow;
  process.chdir(root);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); fs.rmSync(out, { recursive: true, force: true }); process.exit(1); });
