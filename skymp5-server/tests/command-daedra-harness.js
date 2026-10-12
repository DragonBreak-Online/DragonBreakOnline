// Scripted test for Command Daedra (conjurationSystem.ts + companionSystem.ts): another player's summoned daedra within the
// effect's level, hit by a player's Command Daedra, serves the caster (owner, ff_companionOf, host, state packets) and goes
// back to its owner when the command ends; a non-daedra, one over the level, one's own summon and another player's summon
// outside the PvP rules are refused; commanded summons keep the caster within the command limit, the newest replacing the
// oldest; "commandDaedraEnabled": false switches it off. It bundles both systems with esbuild
// (settings, placement and the plugin reader stubbed) on a fake mp. Run it from skymp5-server with node_modules present:
//
//   node tests/command-daedra-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-command-daedra-'));
const bundle = path.join(out, 'conjuration.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const A = 0xff000101, B = 0xff000102;
const PLAYER_BASE = 0x7, DREMORA = 0x10dded, WOLF_SUMMON = 0x640b5;
const COMMAND = 0x6f953, TIMED_COMMAND = 0x6f999;

const STUBS = {
  '../settings': 'module.exports = { Settings: { get: async () => ({ allSettings: globalThis.__cmdSettings || {} }) } };',
  './npcPlacement': 'module.exports = { HOSTILE_PROP: "ff_hostile", placeNpc: (...x) => globalThis.__cmdPlace(...x), placeAtMe: () => 0 };',
  '../scampNative': 'module.exports = {};',
  './espmMagic': `
    exports.MgefArchetype = { CommandSummoned: 10, SummonCreature: 18, Reanimate: 22, Banish: 42 };
    exports.spellEffects = (mp, id) => id === ${COMMAND} ? [{ archetype: 10, mgefId: 0x6f954, magnitude: 20, durationSec: 0 }]
      : id === ${TIMED_COMMAND} ? [{ archetype: 10, mgefId: 0x6f954, magnitude: 20, durationSec: 30 }] : [];
    exports.npcLevel = (mp, id) => mp.get(id, 'level');
    exports.keywordConditionsPass = (mp, mgef, id) => mp.get(id, 'daedra') === true;
    exports.turnsToAsh = () => false;
    exports.pickSummon = () => null;
    exports.explosionPlacedNpc = () => 0;`,
};

(async () => {
  await esbuild.build({
    stdin: { contents: 'export { ConjurationSystem } from "./conjurationSystem"; export { CompanionSystem } from "./companionSystem";', resolveDir: path.join(root, 'ts', 'systems'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /^\.\.\/settings$|^\.\/npcPlacement$|^\.\.\/scampNative$|^\.\/espmMagic$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      },
    }],
  });
  const { ConjurationSystem, CompanionSystem } = require(bundle);

  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  const props = new Map();
  const get = (id, k) => props.get(`${id >>> 0}|${k}`);
  const set = (id, k, v) => props.set(`${id >>> 0}|${k}`, v);
  const users = new Map([[A, 1], [B, 2]]);
  const online = new Set([1, 2]);
  const sent = [];
  const hosters = [];
  const logs = [];
  const descOf = (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`;
  const mp = {
    get: (id, k) => { const v = get(id, k); if (v === undefined && k === 'profileId') return -1; if (v === undefined) throw new Error(`no ${k} on ${id.toString(16)}`); return v; },
    set,
    getUserByActor: (id) => (users.has(id >>> 0) ? users.get(id >>> 0) : -1),
    isConnected: (u) => online.has(u),
    getUserActor: (u) => [...users].find(([, x]) => x === u)?.[0] ?? 0,
    getActorCellOrWorld: () => 0x3c,
    getActorPos: (id) => get(id, 'pos') || [0, 0, 0],
    getDescFromId: descOf,
    getIdFromDesc: (d) => parseInt(String(d), 16) >>> 0,
    lookupEspmRecordById: () => ({ record: { type: 'NPC_' } }),
    makeProperty: () => {},
    destroyActor: (id) => set(id, 'gone', true),
    sendCustomPacket: (u, p) => sent.push([u, JSON.parse(p)]),
    setHoster: (id, h) => hosters.push([id >>> 0, h >>> 0]),
  };
  const actor = (id, base, profile, pos) => {
    set(id, 'baseDesc', descOf(base)); set(id, 'isDead', false); set(id, 'pos', pos);
    set(id, 'worldOrCellDesc', '3c:Skyrim.esm'); set(id, 'angle', [0, 0, 0]);
    if (profile >= 0) set(id, 'profileId', profile);
  };
  actor(A, PLAYER_BASE, 11, [0, 0, 0]); actor(B, PLAYER_BASE, 12, [300, 0, 0]);
  let nextId = 0xff000500;
  globalThis.__cmdPlace = (_mp, ownerId, baseDesc, loc) => { const id = nextId++; actor(id, parseInt(baseDesc, 16), -1, loc.pos); return id; };
  const ctx = { svr: mp, gm: { on() {}, once() {}, emit() {} } };
  const realTimeout = global.setTimeout;
  const tick = async (sys) => { global.setTimeout = (fn) => { fn(); return 0; }; try { await sys.updateAsync(); } finally { global.setTimeout = realTimeout; } };
  const lastState = (user) => { for (let i = sent.length - 1; i >= 0; i--) if (sent[i][0] === user && sent[i][1].customPacketType === 'companionState') return sent[i][1]; return null; };
  const ids = (user) => (lastState(user)?.companions || []).map((c) => c.id);

  const boot = async (settings) => {
    globalThis.__cmdSettings = settings || {};
    delete mp.onHitDamageAttempt; delete mp.onHostAttempt; delete mp.onSpellHit; delete mp.onSpellCast;
    process.chdir(out);
    const companions = new CompanionSystem((...x) => logs.push(x.join(' ')));
    await companions.initAsync(ctx);
    const conj = new ConjurationSystem((...x) => logs.push(x.join(' ')), companions);
    await conj.initAsync(ctx);
    // B's dremora (a level 15 daedra) and wolf (not a daedra)
    const T = companions.spawn(B, DREMORA, { kind: 'summon', durationSec: 60 });
    set(T, 'daedra', true); set(T, 'level', 15);
    sent.length = 0; hosters.length = 0;
    return { companions, conj, T };
  };
  const cast = (conj, caster, target, spell = COMMAND) => conj.onSpellHit(caster, target, spell);

  // ---- PvP protected: no rule, no fight ----
  delete globalThis.__dboCompanionMayFight;
  let { companions, conj, T } = await boot();
  cast(conj, A, T);
  check('another player\'s summon outside the PvP rules is refused', companions.info(T).ownerId === B, companions.info(T));
  check('...and the refusal is logged', logs.some((x) => /cannot command .*PvP not allowed/.test(x)), logs.slice(-2));

  // ---- PvP allowed: the two fought, the rule agrees ----
  globalThis.__dboCompanionMayFight = () => true;
  ({ companions, conj, T } = await boot());
  mp.onHitDamageAttempt(B, A, 0x12eb7, 10, {});
  cast(conj, A, T);
  check('Command Daedra hands the summon to the caster', companions.info(T).ownerId === A, companions.info(T));
  check('...ff_companionOf names the caster', get(T, 'ff_companionOf') === A, get(T, 'ff_companionOf'));
  check('...the caster hosts it', hosters.some(([id, h]) => id === T && h === A), hosters);
  check('...the old owner\'s list drops it and the caster\'s holds it', !ids(2).includes(T) && ids(1).includes(T), [ids(1), ids(2)]);
  check('...the caster\'s client hosts it, the old owner\'s cannot', mp.onHostAttempt(A, T) === true && mp.onHostAttempt(B, T) === false);
  check('...it keeps its own timer', companions.info(T).expiresAt === 1_000_000 + 60_000, companions.info(T).expiresAt);
  check('...a duration-0 command lasts the summon\'s life: it expires as normal', (now += 61_000, await tick(companions), companions.info(T) === undefined && get(T, 'gone') === true));

  // ---- a timed command goes back ----
  ({ companions, conj, T } = await boot());
  mp.onHitDamageAttempt(B, A, 0x12eb7, 10, {});
  cast(conj, A, T, TIMED_COMMAND);
  check('timed: taken over', companions.info(T).ownerId === A);
  now += 29_000; await tick(companions);
  check('timed: still the caster\'s before the 30 s end', companions.info(T).ownerId === A);
  now += 2_000; await tick(companions);
  check('timed: back to its owner after 30 s', companions.info(T)?.ownerId === B, companions.info(T));
  check('timed: ...hosted by the owner again', hosters.some(([id, h]) => id === T && h === B), hosters);
  check('timed: ...and in the owner\'s list again', ids(2).includes(T) && !ids(1).includes(T), [ids(1), ids(2)]);

  ({ companions, conj, T } = await boot());
  mp.onHitDamageAttempt(B, A, 0x12eb7, 10, {});
  cast(conj, A, T, TIMED_COMMAND);
  online.delete(2);
  now += 31_000; await tick(companions);
  check('timed: an owner gone offline gets nothing back, it ends', companions.info(T) === undefined, companions.info(T));
  online.add(2);

  ({ companions, conj, T } = await boot());
  mp.onHitDamageAttempt(B, A, 0x12eb7, 10, {});
  cast(conj, A, T, TIMED_COMMAND);
  const N = companions.spawn(B, DREMORA, { kind: 'summon', durationSec: 600 });
  now += 31_000; await tick(companions);
  check('timed: an owner who summoned again meanwhile keeps the new one, the old one ends', companions.info(T) === undefined && companions.info(N)?.ownerId === B);

  // ---- refusals ----
  ({ companions, conj, T } = await boot());
  mp.onHitDamageAttempt(B, A, 0x12eb7, 10, {});
  const W = companions.spawn(B, WOLF_SUMMON, { kind: 'summon', durationSec: 60 });
  set(W, 'daedra', false); set(W, 'level', 5);
  cast(conj, A, W);
  check('not a daedra: refused', companions.info(W)?.ownerId === B, companions.info(W));
  set(T, 'level', 25);
  ({ companions, conj, T } = await boot());
  set(T, 'level', 25);
  mp.onHitDamageAttempt(B, A, 0x12eb7, 10, {});
  cast(conj, A, T);
  check('over the magnitude\'s level: refused', companions.info(T).ownerId === B);
  set(T, 'level', 15);
  cast(conj, B, T);
  check('the owner\'s own summon: nothing changes', companions.info(T).ownerId === B && hosters.length === 0);

  ({ companions, conj, T } = await boot({ commandDaedraEnabled: false }));
  mp.onHitDamageAttempt(B, A, 0x12eb7, 10, {});
  cast(conj, A, T);
  check('commandDaedraEnabled false: off', companions.info(T).ownerId === B);

  // ---- the command limit holds: commanded summons replace the caster's oldest, as summoning does ----
  const C = 0xff000103;
  users.set(C, 3); online.add(3); actor(C, PLAYER_BASE, 13, [0, 300, 0]);
  globalThis.__dboCompanionMayFight = () => true;
  ({ companions, conj, T } = await boot());
  const own = companions.spawn(A, DREMORA, { kind: 'summon', durationSec: 600 });
  const TC = companions.spawn(C, DREMORA, { kind: 'summon', durationSec: 600 });
  set(TC, 'daedra', true); set(TC, 'level', 15);
  mp.onHitDamageAttempt(A, B, 0x12eb7, 1, {});
  mp.onHitDamageAttempt(A, C, 0x12eb7, 1, {});
  cast(conj, A, T);
  cast(conj, A, TC);
  const held = companions.list(A).map((c) => c.id);
  check('two players\' summons commanded in turn: the caster holds one (the limit), the newest', held.length === 1 && held[0] === TC, held.map((x) => x.toString(16)));
  check('...the caster\'s own summon and the first commanded one end as replaced', companions.info(own) === undefined && companions.info(T) === undefined
    && logs.some((x) => x.includes(`${own.toString(16)}`) && /ended \(replaced\)/.test(x)) && logs.some((x) => x.includes(`${T.toString(16)}`) && /ended \(replaced\)/.test(x)), logs.slice(-6));

  Date.now = realNow;
  process.chdir(root);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); fs.rmSync(out, { recursive: true, force: true }); process.exit(1); });
