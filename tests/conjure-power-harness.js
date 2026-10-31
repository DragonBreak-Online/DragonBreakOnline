// Does a Power's summon reach the server? A Power cast from the Shout key fires no onSpellCast (the client relays it as
// dboBeastPower to the gameplay layer), so ConjurationSystem exposes __dboConjurePower for the gameplay layer to call after
// its own checks (the Hagraven's Summon Spriggan, research note 26 Oct section 3). Records are built the way a plugin has
// them: a SPEL whose EFID names an MGEF of archetype 18 (SummonCreature) with the NPC in DATA's associated item.
//
//   node tests\conjure-power-harness.js <bundled conjurationSystem.js>
//   (bundle with: cd fork\skymp5-server && node node_modules/esbuild/bin/esbuild ts/systems/conjurationSystem.ts --bundle
//    --platform=node --format=cjs --outfile=<out.js>)
'use strict';
const path = require('path');
const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests\\conjure-power-harness.js <bundled conjurationSystem.js>'); process.exit(2); }
const { ConjurationSystem } = require(path.resolve(bundle));

const PLAYER = 0x14, NPC_CASTER = 0xff000123;
const POWER = 0x49000802, FIRE = 0x49000900;                  // a summon power; a plain fire power with no summon
const MGEF = { spriggan: 0x49000801, fire: 0x49000901 };
const SPRIGGAN = 0x00023ab5;
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const efit = (dur) => { const b = Buffer.alloc(12); b.writeFloatLE(0, 0); b.writeUInt32LE(0, 4); b.writeUInt32LE(dur, 8); return b; };
const mgefData = (assoc, archetype) => { const b = Buffer.alloc(0x44); b.writeUInt32LE(assoc, 0x08); b.writeUInt32LE(archetype, 0x40); return b; };
const field = (type, data) => ({ type, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) });
const rec = (type, fields) => ({ record: { type, fields }, toGlobalRecordId: (x) => x });
const records = new Map([
  [POWER, rec('SPEL', [field('EDID', Buffer.from('DBO_HagravenSummonSpriggan\0')), field('EFID', u32(MGEF.spriggan)), field('EFIT', efit(60))])],
  [FIRE, rec('SPEL', [field('EDID', Buffer.from('FirePower\0')), field('EFID', u32(MGEF.fire)), field('EFIT', efit(5))])],
  [MGEF.spriggan, rec('MGEF', [field('DATA', mgefData(SPRIGGAN, 18))])],
  [MGEF.fire, rec('MGEF', [field('DATA', mgefData(0, 0))])],
]);
const props = new Map([[`${PLAYER}|profileId`, 7], [`${NPC_CASTER}|profileId`, -1]]);
const mp = { lookupEspmRecordById: (id) => records.get(id >>> 0) || null, get: (id, k) => props.get(`${id >>> 0}|${k}`) };
const spawned = []; const logs = [];
let spawnThrows = false;
const companions = { spawn: (owner, base, opts) => { if (spawnThrows) throw new Error('spawn boom'); spawned.push({ owner, base, opts }); return 0xff000500; } };

let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined && !ok ? '   ' + JSON.stringify(detail) : ''}`); if (!ok) failures++; };

if (typeof ConjurationSystem.prototype.exposePowerHook !== 'function') {
  require('./expect')('conjure-power', 'this conjurationSystem has no power hook');
  console.log('ok   skipped: this conjurationSystem has no power hook'); process.exit(0);
}
delete globalThis.__dboConjurePower;
const sys = new ConjurationSystem((m) => logs.push(String(m)), companions);
sys.mp = mp;
check('no hook before the system exposes it', typeof globalThis.__dboConjurePower !== 'function');
check('initAsync exposes it at boot', /this\.exposePowerHook\(\)/.test(ConjurationSystem.prototype.initAsync.toString()));
sys.exposePowerHook();
const hook = globalThis.__dboConjurePower;
check('the system exposes __dboConjurePower', typeof hook === 'function');

check('a player\'s summon power conjures', hook(PLAYER, POWER) === true && spawned.length === 1, spawned);
const s = spawned[0] || {};
check('...the effect\'s creature, for that player, as a summon', s.owner === PLAYER && s.base === SPRIGGAN && s.opts && s.opts.kind === 'summon', s);
check('...lasting the effect\'s duration, from that power', s.opts && s.opts.durationSec === 60 && s.opts.source === POWER, s.opts);
spawned.length = 0;
check('a power with no summon effect conjures nothing', hook(PLAYER, FIRE) === false && spawned.length === 0);
check('an unknown spell conjures nothing', hook(PLAYER, 0x49000999) === false && spawned.length === 0);
check('an NPC caster conjures nothing (players only)', hook(NPC_CASTER, POWER) === false && spawned.length === 0);
check('ids arrive as any number-ish value', hook(String(PLAYER), String(POWER)) === true && spawned.length === 1);
spawned.length = 0;
spawnThrows = true; logs.length = 0;
check('a throw inside is caught, false, and logged', hook(PLAYER, POWER) === false && logs.some((l) => /__dboConjurePower failed: Error: spawn boom/.test(l)), logs);
spawnThrows = false;
// The ordinary cast path is unchanged: a cast spell's summon still goes through onSpellCast
sys.onSpellCast(PLAYER, POWER);
check('onSpellCast still conjures a cast spell\'s summon', spawned.length === 1 && spawned[0].base === SPRIGGAN, spawned);
spawned.length = 0;
sys.onSpellCast(NPC_CASTER, POWER);
check('...and still not for an NPC', spawned.length === 0);

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
