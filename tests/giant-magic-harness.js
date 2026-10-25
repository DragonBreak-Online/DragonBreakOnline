// Giants shrug off magic (Nat, 25 Oct: "buff giants against magic"; npctoughness.js magicTaken, config
// npcToughness.kinds.giant): the magic that lands on a giant, from anyone, is scaled by magicTaken (0.5) while weapon blows,
// fists and shouts land as before. Runs the module on stub records; checks the shipped config against the races found on
// the giant behaviour graph (143-plugin order, 25 Oct) and gamemode.js's wiring, the lethal-spell guard included.
//   node tests/giant-magic-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };

// ---- stub records -------------------------------------------------------------------------------------------------------
const GIANT_RACE = 0x000131f9, MAMMOTH_RACE = 0x000131ff, DRAUGR_RACE = 0x00000d53;
const ids = { '131f9:Skyrim.esm': GIANT_RACE, 'd53:Skyrim.esm': DRAUGR_RACE };
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const rec = (type, edid, fields) => ({ record: { type, editorId: edid, fields: fields || [] }, toGlobalRecordId: (x) => x });
const npc = (edid, race) => rec('NPC_', edid, [{ type: 'ACBS', data: new Uint8Array(24) }, { type: 'RNAM', data: u32(race) }]);
const spit = (type) => { const b = new Uint8Array(36); new DataView(b.buffer).setUint32(8, type, true); return b; };
const RECORDS = {
  0x100: npc('EncGiant01', GIANT_RACE),
  0x101: npc('EncMammoth', MAMMOTH_RACE),
  0x102: npc('EncDraugr01', DRAUGR_RACE),
  0x200: rec('SPEL', 'Firebolt', [{ type: 'SPIT', data: spit(0) }]),
  0x201: rec('SPEL', 'VoiceUnrelentingForce3', [{ type: 'SPIT', data: spit(11) }]),
  0x202: rec('ENCH', 'StaffEnchFireball'),
  0x203: rec('SCRL', 'ScrollFireball'),
  0x204: rec('WEAP', 'GreatswordIron'),
  0x205: rec('EXPL', 'SomeExplosion'),
};
const FIREBOLT = 0x200, SHOUT = 0x201, STAFF = 0x202, SCROLL = 0x203, SWORD = 0x204, EXPL = 0x205, FIST = 0x1f4;
const PLAYER = 0xff000014, GIANT = 0xff000100, MAMMOTH = 0xff000101, DRAUGR = 0xff000102, MAGE = 0xff000103;
const props = new Map(); const put = (id, k, v) => props.set(id + '|' + k, v);
put(GIANT, 'baseDesc', '100:Test.esp'); put(MAMMOTH, 'baseDesc', '101:Test.esp'); put(DRAUGR, 'baseDesc', '102:Test.esp'); put(MAGE, 'baseDesc', '102:Test.esp');   // verify-formids: ignore (stub bases in a made-up Test.esp)
const mp = {
  get: (id, k) => props.get(id + '|' + k),
  getIdFromDesc: (d) => { if (d in ids) return ids[d]; const [h, p] = String(d).split(':'); if (p === 'Test.esp') return parseInt(h, 16); throw new Error('no desc ' + d); },
};
const profileOf = (a) => (a === PLAYER ? 7 : -1);
const recordOf = (id) => RECORDS[id] || null;
const load = (c) => {
  delete require.cache[path.join(SERVER, 'npctoughness.js')];
  delete globalThis.__dboToughnessCache; delete globalThis.__dboToughnessSource;
  return require(path.join(SERVER, 'npctoughness.js'))({ mp, cfg: c, log: () => {}, profileOf, recordOf });
};
const GIANT_KIND = { races: ['131f9:Skyrim.esm'], magicTaken: 0.5 };
const DRAUGR_KIND = { races: ['d53:Skyrim.esm'], knee: 200, slope: 0.4, dealt: 0.75 };
const T = load({ npcToughness: { enabled: true, kinds: { draugr: DRAUGR_KIND, giant: GIANT_KIND } } });
const SPELL = { spell: true, targetMaxHealth: 1200 }, BLOW = { targetMaxHealth: 1200 };

ok(T.kindOf(GIANT) === 'giant' && T.kindOf(MAMMOTH) === '', 'a GiantRace NPC is a giant, a mammoth is not');
ok(T.magicTakenMult(PLAYER, GIANT, 80, SPELL, FIREBOLT) === 0.5, "a player's Firebolt on a giant lands at half");
ok(T.magicTakenMult(PLAYER, GIANT, 80, SPELL, STAFF) === 0.5, "a staff's cast (an ENCH source) lands at half");
ok(T.magicTakenMult(PLAYER, GIANT, 80, SPELL, SCROLL) === 0.5, 'a scroll lands at half');
ok(T.magicTakenMult(PLAYER, GIANT, 80, BLOW, STAFF) === 0.5, 'an enchantment source counts without the spell flag (a weapon enchantment, should one reach the server)');
ok(T.magicTakenMult(PLAYER, GIANT, 80, SPELL, EXPL) === 0.5, 'any other source the engine flags as a spell counts');
ok(T.magicTakenMult(PLAYER, GIANT, 80, BLOW, EXPL) === 1, '...but not without the flag');
ok(T.magicTakenMult(PLAYER, GIANT, 80, BLOW, SWORD) === 1, 'a weapon blow is unchanged');
ok(T.magicTakenMult(PLAYER, GIANT, 80, { spell: true }, SWORD) === 1, '...even if a weapon source ever came flagged');
ok(T.magicTakenMult(PLAYER, GIANT, 80, BLOW, FIST) === 1, 'a fist is unchanged');
ok(T.magicTakenMult(PLAYER, GIANT, 80, SPELL, SHOUT) === 1, 'a shout is unchanged (magicShouts false)');
ok(T.magicTakenMult(MAGE, GIANT, 80, SPELL, FIREBOLT) === 0.5, "an NPC mage's spell on a giant lands at half too (from anyone)");
ok(T.magicTakenMult(GIANT, GIANT, 80, SPELL, FIREBOLT) === 1 && T.magicTakenMult(PLAYER, GIANT, 0, SPELL, FIREBOLT) === 1, 'itself, or a hit for nothing: untouched');
ok(T.magicTakenMult(PLAYER, MAMMOTH, 80, SPELL, FIREBOLT) === 1 && T.magicTakenMult(PLAYER, DRAUGR, 80, SPELL, FIREBOLT) === 1, 'a mammoth and a draugr take spells as before');
ok(T.magicTakenMult(GIANT, PLAYER, 80, SPELL, FIREBOLT) === 1, 'a player hit by a spell is untouched (giants resist; they are not a ward)');
ok(T.takenMult(PLAYER, GIANT, 80, SPELL, FIREBOLT) === 1 && T.dealtMult(GIANT, PLAYER, 80) === 1, 'giants keep their health and their hits (no knee, slope or dealt)');
const V = load({ npcToughness: { enabled: true, kinds: { giant: Object.assign({}, GIANT_KIND, { magicShouts: true }) } } });
ok(V.magicTakenMult(PLAYER, GIANT, 80, SPELL, SHOUT) === 0.5, 'magicShouts true takes shouts in');
const OFF = load({ npcToughness: { enabled: false, kinds: { giant: GIANT_KIND } } });
ok(OFF.magicTakenMult(PLAYER, GIANT, 80, SPELL, FIREBOLT) === 1, 'npcToughness.enabled false undoes it');

// ---- the shipped config ---------------------------------------------------------------------------------------------
const cfg = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
const nt = cfg.npcToughness || {}, g = (nt.kinds || {}).giant || {};
ok(nt.enabled === true && g.magicTaken === 0.5 && g.magicShouts === false, 'shipped: npcToughness on, giant.magicTaken 0.5, shouts out', { enabled: nt.enabled, magicTaken: g.magicTaken, magicShouts: g.magicShouts });
const WANT = ['131f9:Skyrim.esm', 'cae13:Skyrim.esm', '1cad8:Dragonborn.esm', '1f135:Druadach.esm', '9af523:summersetisles.esp', '2ecdaa:SurWR.esp', '8ac:YokuWeapons.esp'];
ok(JSON.stringify([...(g.races || [])].sort()) === JSON.stringify([...WANT].sort()), 'shipped: the seven races on the giant behaviour graph', g.races);
ok(!(g.races || []).some((r) => /^131ff:/i.test(r) || /^1d201[bc]:/i.test(r)), 'shipped: no MammothRace, no player Half-Giant race');
ok(!('knee' in g) && !('dealt' in g) && typeof g._comment === 'string' && /Nat, 25 Oct/.test(g._comment), 'shipped: no knee or dealt, a dated _comment');
ok(JSON.stringify((nt.kinds || {}).draugr.races) === JSON.stringify(['d53:Skyrim.esm', 'f71dc:Skyrim.esm', '2a6fd:Dragonborn.esm', '6d4e0:Druadach.esm', 'a0f55:Druadach.esm']) && !('magicTaken' in nt.kinds.draugr), 'the draugr kind is untouched');

// ---- gamemode.js wiring ----------------------------------------------------------------------------------------------
const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
const iTaken = gm.indexOf('magicTaken = toughness.magicTakenMult(agg, tgt, dmg, flags, src)');
const iGuard = gm.indexOf('summonSpellGuard(agg, tgt, dmg, mult, flags, magicTaken < 1)');
ok(iTaken > 0 && /mult \*= magicTaken;/.test(gm.slice(iTaken, iTaken + 300)), 'onHitDamageAttempt multiplies the hit by magicTakenMult');
ok(iGuard > iTaken, '...before the lethal-spell guard, which is told the target resisted');
ok(gm.indexOf('magicTaken = toughness.magicTakenMult') > gm.indexOf('mult *= summonTakenMult(agg, tgt, dmg);'), '...after the multipliers on the hit (it multiplies the whole chain, under no cap)');
// The guard itself, lifted out of gamemode.js and run on a stub mp
const m = gm.match(/const summonSpellGuard = \(agg, tgt, dmg, mult, flags, resisted\) => \{[\s\S]*?\n\};/);
ok(!!m, 'summonSpellGuard takes resisted');
if (m) {
  const timers = [];
  const health = new Map([[GIANT, 0.05]]); // 60 of 1200
  const stubMp = { get: (id) => ({ health: health.get(id), magicka: 1, stamina: 1 }), set: (id, k, v) => health.set(id, v.health) };
  const guard = new Function('mp', 'playerSummonOf', 'setTimeout', `${m[0]}; return summonSpellGuard;`)(stubMp, () => null, (fn) => timers.push(fn));
  ok(guard(PLAYER, GIANT, 80, 0.5, SPELL, true) === true, 'an 80-point spell on a giant with 60 health, 40 scaled: refused');
  timers.forEach((fn) => fn());
  ok(Math.abs(health.get(GIANT) * 1200 - 20) < 1e-6, '...and the 40 taken just after (60 -> 20)', health.get(GIANT) * 1200);
  health.set(GIANT, 0.05);
  ok(guard(PLAYER, GIANT, 40, 0.5, SPELL, true) === false, 'a spell that would not kill lands as usual (the give-back halves it)');
  ok(guard(PLAYER, GIANT, 100, 0.5, BLOW, true) === false, 'a weapon hit is never guarded');
  health.set(GIANT, 0.05);
  ok(guard(PLAYER, GIANT, 100, 0.5, SPELL, false) === false, 'without resisted (and not a summon) the guard stays out');
}

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
