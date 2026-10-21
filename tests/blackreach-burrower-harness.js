// Blackreach crashes (#bugs 1562349200203841596, 21 Oct: "a mob that is spawning in blackreach is causing crashes ... can't
// even log in without crashing"). 19 of the 27 times since 18 Oct that a player quit inside Blackreach and came straight
// back in fell while a Dwemer Burrower (DrV_DwemerBurrower, Druadach.esm a0f31, the spot wild:brdwemer:b1d1f69) was
// spitting, with whole groups out at once (19 Oct 03:12, 20 Oct 14:02-14:04, 21 Oct 06:05-06:30). The real
// gamemode-config.json now names it in crashyCreatures.bases, so crashycreatures.js refuses it and wildlife.js never
// spawns it; every other Blackreach creature still spawns. Mock records; no server. The real wildlife.js then runs on
// the real config: NPC-Spawns.json loses only that zone, every other zone is written as before.
//   node tests/blackreach-burrower-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 400)}`); if (!c) fails++; };
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const BR = JSON.parse(fs.readFileSync(path.join(ROOT, 'blackreach.json'), 'utf8'));

const ids = new Map(); let next = 0x100;
const idOf = (d) => { const k = String(d).toLowerCase(); if (!ids.has(k)) ids.set(k, next++); return ids.get(k); };
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
// Every Blackreach base is an NPC_ of a race of its own (no dragon race), so only crashyCreatures.bases can refuse one
const REC = new Map();
const bases = [...new Set((BR.spots || []).map((s) => String(s.base || '')).filter(Boolean))];
for (const b of bases) REC.set(idOf(b), { type: 'NPC_', fields: [{ type: 'ACBS', data: new Uint8Array(24) }, { type: 'RNAM', data: u32(idOf(`race-of-${b}`)) }] });
const MODULE = path.join(ROOT, 'crashycreatures.js');
delete require.cache[MODULE]; delete globalThis.__dboCrashyCache;
const C = require(MODULE)({ getIdFromDesc: idOf, lookupEspmRecordById: (id) => (REC.has(id) ? { record: REC.get(id), toGlobalRecordId: (x) => x } : null), makeProperty: () => {} }, cfg, () => {});

const burrowerSpot = (BR.spots || []).find((s) => s.zone === 'wild:brdwemer:b1d1f69-dragonbreakonlineedits');
ok(!!burrowerSpot && /^a0f31:Druadach\.esm$/i.test(burrowerSpot.base) && burrowerSpot.edid === 'DrV_DwemerBurrower', 'blackreach.json still has the Burrower spot (a0f31:Druadach.esm)', burrowerSpot);
ok(C.on && !!C.check('a0f31:Druadach.esm'), 'crashyCreatures refuses the Dwemer Burrower, so wildlife.js never spawns it');
ok(C.filterOptions([[1, 'a0f31:Druadach.esm']]).length === 0, 'its single option is filtered out');
const refused = bases.filter((b) => !/^a0f31:druadach\.esm$/i.test(b) && C.check(b));
ok(!refused.length, `every other Blackreach base (${bases.length - 1}) still spawns`, refused);
ok(!C.check('a0f30:Druadach.esm'), 'the Dwemer Sentry beside it (a0f30, spawns with it but casts nothing) still spawns');
ok(Array.isArray(cfg.crashyCreatures.races) && cfg.crashyCreatures.races.length === 6, 'the six dragon races stay as they were');

// The real wildlife.js with the real config (crashycreatures.js beside it, as on the server): NPC-Spawns.json loses the
// Burrower's zone, and every other zone is written exactly as with an empty bases list
const os = require('os');
const BZ = 'wild:brdwemer:b1d1f69-dragonbreakonlineedits';
const zonesWith = (conf) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackreach-burrower-'));
  for (const f of ['wildlife.json', 'owned-spawns.json', 'stronghold-spawns.json', 'loot.json', 'artifacts.json', 'blackreach.json', 'dragon-materials.json', 'crashycreatures.js'])
    if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  const cwd = process.cwd(), si = global.setInterval;
  process.chdir(dir);
  global.setInterval = () => ({ unref() {} });
  try {
    delete require.cache[path.join(ROOT, 'wildlife.js')]; delete globalThis.__dboCrashyCache; globalThis.__dboWildSig = undefined;
    globalThis.__dboWildFactionAudit = ' (skipped in the harness)';
    const props = new Map(), logs = [];
    require(path.join(ROOT, 'wildlife.js'))({ mp: { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v), getIdFromDesc: idOf,
      lookupEspmRecordById: (id) => (REC.has(id) ? { record: REC.get(id), toGlobalRecordId: (x) => x } : null), makeProperty: () => {} },
    log: (...a) => logs.push(a.join(' ')), personal: () => {}, system: () => {}, registerChatCommand: () => {}, giveItem: () => true, profileOf: () => 1,
    display: String, who: String, audit: () => {}, isAdmin: () => false, cfg: conf, onlineActors: () => [], sendPacket: () => {} });
    return { zones: JSON.parse(fs.readFileSync(path.join(dir, 'NPC-Spawns.json'), 'utf8')).zones, guardLoaded: !logs.some((l) => /crashycreatures\.js failed/.test(l)) };
  } finally { global.setInterval = si; process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }); }
};
const live = zonesWith(cfg);
const none = zonesWith(Object.assign({}, cfg, { crashyCreatures: Object.assign({}, cfg.crashyCreatures, { bases: [] }) }));
const brOf = (r) => r.zones.filter((z) => /^wild:br/.test(z.Name)).map((z) => z.Name);
ok(live.guardLoaded && none.guardLoaded, 'wildlife.js loads the crash guard');
ok(brOf(none).includes(BZ) && !brOf(live).includes(BZ), 'wildlife.js leaves the Burrower zone out of NPC-Spawns.json (with bases [] it is written)', brOf(live).filter((n) => /b1d1f6/.test(n)));
ok(brOf(live).length === brOf(none).length - 1 && ['wild:brdwemer:b1d1f68-dragonbreakonlineedits', 'wild:brdwemer:b1d1f6b-dragonbreakonlineedits'].every((n) => brOf(live).includes(n)),
  `the other ${brOf(live).length} Blackreach zones stay, the Sentry and the Dwarven Sphere beside it too`);
const rest = (r) => JSON.stringify(r.zones.filter((z) => z.Name !== BZ));
ok(rest(live) === rest(none), `every other zone (${live.zones.length}) is written as before: none renamed, moved or re-picked`);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
