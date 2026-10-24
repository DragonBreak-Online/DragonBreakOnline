// Scripted test for soulTrapSystem.ts resyncGems: after a soul trap death the caster's game is told to take the server's
// copies of its soul gems (craftedExtrasRefused), whether a gem was filled or none held the soul, since the game's own
// Soul Trap fills a gem the server never records (24 Oct: gems that could not be stored or traded). It bundles
// soulTrapSystem.ts with esbuild and drives the OnHit hook and the death poll on a fake mp. Run it from skymp5-server:
//
//   node tests/soul-trap-resync-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-soultrap-'));
const bundle = path.join(out, 'soultrap.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const u32s = (...xs) => { const b = new Uint8Array(4 * xs.length); const v = new DataView(b.buffer); xs.forEach((x, i) => v.setUint32(4 * i, x >>> 0, true)); return b; };
const efit = (mag, area, dur) => { const b = new Uint8Array(12); const v = new DataView(b.buffer); v.setFloat32(0, mag, true); v.setUint32(4, area, true); v.setUint32(8, dur, true); return b; };
const acbs = (level) => { const b = new Uint8Array(20); new DataView(b.buffer).setUint16(8, level, true); return b; };
const records = new Map();
const rec = (id, type, fields) => records.set(id >>> 0, { record: { type, fields, flags: 0 }, toGlobalRecordId: (x) => x >>> 0 });

const SOUL_TRAP_CONTACT = 0x0005b452, FIRE_CONTACT = 0x0004605a;
const ENCH_SOUL_TRAP = 0x000d4b6e, ENCH_FIRE = 0x00045f9d;
const IRON_SWORD = 0x00012eb7, SWORD_OF_SOULS = 0x000d4b6f, STEEL_SWORD = 0x00013989;
const PETTY = 0x0002e4e2, PETTY_FILLED = 0x0002e4e3, WOLF_BASE = 0x00023aba;
rec(FIRE_CONTACT, 'MGEF', [{ type: 'DATA', data: new Uint8Array(152) }]);
rec(ENCH_SOUL_TRAP, 'ENCH', [{ type: 'EFID', data: u32s(SOUL_TRAP_CONTACT) }, { type: 'EFIT', data: efit(0, 0, 3) }]);
rec(ENCH_FIRE, 'ENCH', [{ type: 'EFID', data: u32s(FIRE_CONTACT) }, { type: 'EFIT', data: efit(10, 0, 0) }]);
rec(IRON_SWORD, 'WEAP', []);
rec(STEEL_SWORD, 'WEAP', []);
rec(SWORD_OF_SOULS, 'WEAP', [{ type: 'EITM', data: u32s(ENCH_SOUL_TRAP) }]);
rec(PETTY, 'SLGM', [{ type: 'SLCP', data: new Uint8Array([1]) }]);
rec(PETTY_FILLED, 'SLGM', [{ type: 'SLCP', data: new Uint8Array([1]) }, { type: 'SOUL', data: new Uint8Array([1]) }]);
rec(WOLF_BASE, 'NPC_', [{ type: 'ACBS', data: acbs(1) }]);

(async () => {
  await esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', 'soulTrapSystem.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
  });
  const { SoulTrapSystem } = require(bundle);

  const A = 0xff000014, T = 0xff000100;
  const props = new Map();
  const descs = new Map([['caster', A], ['target', T]]);
  const desc = (id) => { const d = `d${(id >>> 0).toString(16)}`; descs.set(d, id >>> 0); return { desc: d }; };
  const mp = {
    get: (id, k) => props.get(`${id >>> 0}|${k}`),
    set: (id, k, v) => props.set(`${id >>> 0}|${k}`, v),
    getIdFromDesc: (d) => { if (!descs.has(d)) throw new Error('no desc'); return descs.get(d); },
    lookupEspmRecordById: (id) => records.get(id >>> 0) || null,
    getUserByActor: (id) => ((id >>> 0) === 0xff000014 ? 7 : 65535),
    sendCustomPacket: (u, s) => sent.push({ u, p: JSON.parse(s) }),
  };
  const sent = [];
  const timers = [];
  const realTimeout = global.setTimeout;
  global.setTimeout = (f, ms) => { timers.push(ms); f(); return 0; };
  const ctx = { svr: mp, gm: { on() {}, emit() {} } };
  const logs = [];
  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;

  // One fight: the attacker holds `entries`, hits a level 1 wolf with `weapon`, and the wolf dies `afterMs` later
  const fight = async (weapon, entries, afterMs = 1000) => {
    const sys = new SoulTrapSystem((...x) => logs.push(x.join(' ')));
    await sys.initAsync(ctx);
    props.clear();
    props.set(`${A}|inventory`, { entries });
    props.set(`${A}|profileId`, 3);
    props.set(`${T}|type`, 'MpActor');
    props.set(`${T}|isDead`, false);
    props.set(`${T}|templateChain`, [WOLF_BASE]);
    mp['onPapyrusEvent:OnHit'](T, desc(A), desc(weapon), null, false, false, false, false);
    now += afterMs;
    await sys.updateAsync(ctx);
    now += 200;
    props.set(`${T}|isDead`, true);
    await sys.updateAsync(ctx);
    const inv = props.get(`${A}|inventory`).entries;
    return inv.some((e) => e.baseId === PETTY_FILLED);
  };
  const resyncs = () => sent.filter((x) => x.u === 7 && x.p.customPacketType === 'craftedExtrasRefused');
  const sword = { baseId: SWORD_OF_SOULS, count: 1, worn: true };

  sent.length = 0; timers.length = 0;
  check('a filled gem: the soul is the server\'s', await fight(SWORD_OF_SOULS, [sword, { baseId: PETTY, count: 1 }]));
  check('...and the game is told twice to take the server\'s soul gems', resyncs().length === 2 && timers.includes(1500) && timers.includes(6000), timers);
  check('...naming the empty and filled vanilla gems', resyncs().every((x) => x.p.baseIds.includes(PETTY) && x.p.baseIds.includes(PETTY_FILLED)), resyncs()[0] && resyncs()[0].p.baseIds.length);
  check('...and never the weapon', resyncs().every((x) => !x.p.baseIds.includes(SWORD_OF_SOULS)));

  sent.length = 0; timers.length = 0;
  check('no gem holds the soul: nothing is filled', !(await fight(SWORD_OF_SOULS, [sword])));
  check('...but the game is still told to take the server\'s gems (its own Soul Trap may have filled one)', resyncs().length === 2);

  sent.length = 0;
  check('a hit with no soul trap fills nothing', !(await fight(IRON_SWORD, [{ baseId: IRON_SWORD, count: 1, worn: true }, { baseId: PETTY, count: 1 }])));
  check('...and sends nothing', resyncs().length === 0);

  global.setTimeout = realTimeout;
  Date.now = realNow;
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); fs.rmSync(out, { recursive: true, force: true }); process.exit(1); });
