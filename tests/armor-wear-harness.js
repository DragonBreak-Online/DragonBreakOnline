// Armour worn by Defense level (Nat, 31 Oct: "I just want it to matter for leveling defense"; gamemode.js wearCheck,
// smithing.js __dboWearTier) and the inventory's armour number read from the same count as the hit (armorCountOf).
// The tier comes from the real smithing.js and smithing.json (a small loot-materials.json and faction-gear.json in a
// scratch folder); wearCheck, defenseDamageMult and statItemsFor are lifted from gamemode.js and run against stubs.
// Each mutant of the wear rule must fail here; the agreement check fails on the code before 31 Oct.
//   node tests/armor-wear-harness.js [gamemode.js to test]   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const GM = fs.readFileSync(process.argv[2] ? path.resolve(process.argv[2]) : path.join(SERVER, 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!c) fails++; };

// ---- the tier: the real smithing.js --------------------------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-armorwear-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
fs.copyFileSync(path.join(SERVER, 'smithing.json'), path.join(dir, 'smithing.json'));
// Stand-in pieces, one per rule; the ring is an Ebony one, so only its clothing type exempts it
const P = { IRON: 0xa01, STEEL: 0xa02, DWARF: 0xa03, ORC: 0xa04, GLASS: 0xa05, EBONY: 0xa06, DAEDRIC: 0xa07, GUARD: 0xa08, LEGION: 0xa09, RING: 0xa0a, ODD: 0xa0b, IMPERIAL: 0xa0c }; // verify-formids: ignore (the test's own ids)
const FAM = { IRON: 'iron', STEEL: 'steel', DWARF: 'dwarven', ORC: 'orcish', GLASS: 'glass', EBONY: 'EBONY', DAEDRIC: 'DAEDRIC', GUARD: 'guard', LEGION: 'imperial', RING: 'EBONY', IMPERIAL: 'imperial' };
const descOf = (id) => `${(id >>> 0).toString(16)}:test.esp`;
fs.writeFileSync(path.join(dir, 'loot-materials.json'), JSON.stringify({ items: Object.fromEntries(Object.entries(FAM).map(([k, f]) => [descOf(P[k]), f])) }));
fs.writeFileSync(path.join(dir, 'faction-gear.json'), JSON.stringify({ items: { [descOf(P.LEGION)]: { name: 'Legion Helmet', set: 'Imperial Legion', factions: ['imperial-legion'] } } }));
const cwd = process.cwd();
process.chdir(dir);
for (const k of Object.keys(globalThis)) if (/^__dbo(Smith|WearTier|TemperCap)/.test(k)) delete globalThis[k];
const smp = { get: () => undefined, set: () => {}, getDescFromId: descOf, lookupEspmRecordById: () => null, getEspmRecordIdsByType: () => [] };
require(path.join(SERVER, 'smithing.js'))({ mp: smp, log: () => {}, personal: () => {}, audit: () => {}, who: () => '', cfg: { smithing: { enabled: true } }, registerChatCommand: () => {},
  onlineActors: () => [], findByName: () => 0, isAdmin: () => false, sendPacket: () => true, itemName: () => '', every: () => {} });
process.chdir(cwd);
const wearTier = globalThis.__dboWearTier;
ok(typeof wearTier === 'function', 'smithing.js gives __dboWearTier');
const tiers = Object.fromEntries(Object.keys(P).map((k) => [k, wearTier(P[k])]));
ok(tiers.IRON === 1 && tiers.STEEL === 2 && tiers.DWARF === 3 && tiers.ORC === 4 && tiers.GLASS === 5 && tiers.EBONY === 6 && tiers.DAEDRIC === 7,
  'tiers from smithing.json: Iron 1, Steel 2, Dwarven 3, Orcish 4, Glass 5, Ebony 6, Daedric 7', tiers);
ok(tiers.GUARD === 0 && tiers.LEGION === 0 && tiers.IMPERIAL === 0 && tiers.ODD === 0, 'guard, faction (Legion) and Imperial gear, and a piece of no family, have no tier', tiers);

// ---- the wear rule, lifted -------------------------------------------------------------------------------------------
const lift = (src) => {
  const i = src.indexOf('const ARMOR_WEAR = '), j = src.indexOf('const equipHook = ', i);
  if (i < 0 || j < 0) return null;
  return src.slice(i, j) + '\nreturn { wearCheck, wearNeedOf, ARMOR_WEAR };';
};
const BODY = lift(GM);
ok(!!BODY, 'gamemode.js has the wear rule before equipHook');
// The equip hook runs it, settling on the login, a beast form, the server's re-dress and spawn watch, before lastWorn moves
{
  const h = GM.slice(GM.indexOf('const equipHook = '), GM.indexOf('equipHook.__dbo') > 0 ? GM.indexOf('equipHook.__dbo') : GM.length);
  const call = h.indexOf('wearCheck(a, equipment, '), save = h.indexOf("mp.set(a, 'private.lastWorn'");
  ok(call > 0 && save > call && /wearCheck\(a, equipment, fresh \|\| !!\(beast && beast\.form\) \|\| creationPending\(a\) \|\| Date\.now\(\) - \(redressAt\.get\(a\) \|\| 0\) < 5000 \|\| !!\(spawnWatch && spawnWatch\.holding\(a\)\)\)/.test(h),
    'equipHook calls wearCheck (settling on login, beast form, creation, re-dress, spawn watch) before lastWorn is saved');
}
const RATED = { IRON: [25, 1], STEEL: [31, 1], DWARF: [34, 1], ORC: [40, 1], GLASS: [38, 0], EBONY: [43, 1], DAEDRIC: [49, 1], GUARD: [30, 1], LEGION: [20, 1], RING: [0, 2], ODD: [30, 1], IMPERIAL: [30, 1] };
const pieceOf = (id) => { const k = Object.keys(P).find((x) => P[x] === id); if (!k) return null; const [rating, type] = RATED[k]; return { rating, counted: rating, heavy: type === 1, clothing: type === 2, chest: true }; };
const run = (src, cfgWear, haveTier = true) => {
  const props = new Map(), told = [], off = [];
  const mp = { get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v), getDescFromId: descOf,
    callPapyrusFunction: (kind, cls, fn, self, args) => { if (fn === 'UnequipItem') off.push(parseInt(String(args[0].desc), 16)); } };
  const prevTier = globalThis.__dboWearTier;
  if (!haveTier) delete globalThis.__dboWearTier;
  let w = null;
  try {
    w = new Function('cfg', 'mp', 'armorPieceOf', 'masteryOf', 'wornOf', 'personal', 'sendPacket', 'log', 'display', 'adminItemName', 'setTimeout', src)(
      { armorWear: cfgWear }, mp, pieceOf, (a) => mp.get(a, 'private.mastery') || null,
      (eq) => eq.inv.entries.filter((e) => e.worn || e.wornLeft).map((e) => ({ baseId: e.baseId >>> 0, left: !!e.wornLeft })),
      (a, t) => told.push(t), () => true, () => {}, (a) => `#${a}`, (d) => ({ [descOf(P.DWARF)]: 'Dwarven Armor', [descOf(P.GLASS)]: 'Glass Armor' }[d] || ''), (fn) => fn());
  } finally { if (!haveTier) globalThis.__dboWearTier = prevTier; }
  const actor = (n, defense, lastWorn) => { const a = 0xff000100 + n; mp.set(a, 'private.mastery', { order: ['defense'], skills: { defense: { level: defense } } }); if (lastWorn) mp.set(a, 'private.lastWorn', lastWorn.map((id) => [id, 0])); return a; };
  const report = (a, ids, settling = false) => { off.length = 0; const r = () => w.wearCheck(a, { inv: { entries: ids.map((id) => ({ baseId: id, count: 1, worn: true })) } }, settling); if (haveTier) r(); else { const t = globalThis.__dboWearTier; delete globalThis.__dboWearTier; try { r(); } finally { globalThis.__dboWearTier = t; } } return off.slice(); };
  return { w, mp, told, actor, report };
};
const DEFAULT = { enabled: true, defenseLevels: [0, 15, 30, 45, 60, 75, 90] };
const scenarios = (src) => {
  let bad = 0;
  const check = (c, what, got) => { if (!c) { bad++; if (src === BODY) ok(false, what, got); } else if (src === BODY) ok(true, what); };
  const s = run(src, DEFAULT);
  // Defense 20: Steel (15) goes on, Dwarven (30) comes off with the level named
  const a = s.actor(1, 20, [P.IRON]);
  check(s.report(a, [P.IRON]).length === 0, 'Iron heavy (tier 1) is open at any Defense');
  check(s.report(a, [P.IRON, P.STEEL]).length === 0, 'Defense 20 wears Steel (tier 2, Defense 15)');
  const off = s.report(a, [P.IRON, P.STEEL, P.DWARF]);
  check(off.length === 1 && off[0] === P.DWARF, 'Defense 20 cannot put on Dwarven (tier 3, Defense 30): it comes off', off);
  check(s.told.some((t) => /Dwarven Armor needs Defense 30 to wear; yours is 20\./.test(t)), '...with a line naming the skill and the level', s.told);
  // Light and heavy alike: Glass is light, tier 5
  const b = s.actor(2, 59, [P.IRON]);
  check(s.report(b, [P.IRON, P.GLASS])[0] === P.GLASS, 'light Glass (tier 5) needs Defense 60: 59 is refused');
  const b2 = s.actor(3, 60, [P.IRON]);
  check(s.report(b2, [P.IRON, P.GLASS]).length === 0, '...60 wears it');
  // Ebony 75, Daedric 90
  const e = s.actor(4, 89, [P.IRON]);
  check(s.report(e, [P.IRON, P.EBONY]).length === 0 && s.report(e, [P.IRON, P.EBONY, P.DAEDRIC])[0] === P.DAEDRIC, 'Defense 89 wears Ebony (75) but not Daedric (90)');
  // Grandfathered: what was worn (lastWorn) before the rule saw them stays until it comes off
  const g = s.actor(5, 0, [P.EBONY, P.DAEDRIC]);
  check(s.report(g, [P.EBONY, P.DAEDRIC]).length === 0, 'Defense 0 keeps the Ebony and Daedric worn before the rule came in');
  check(JSON.stringify(s.mp.get(g, 'private.dboWearKept')) === JSON.stringify([P.EBONY, P.DAEDRIC]), '...noted in private.dboWearKept', s.mp.get(g, 'private.dboWearKept'));
  check(s.report(g, []).length === 0 && s.mp.get(g, 'private.dboWearKept').length === 2, 'a naked report (a death, a login) costs nothing kept');
  check(s.report(g, [P.EBONY, P.DAEDRIC], true).length === 0 && s.report(g, [P.IRON], true).length === 0 && s.mp.get(g, 'private.dboWearKept').length === 2, 'a settling report (login, re-dress) neither checks nor drops');
  check(s.report(g, [P.EBONY]).length === 0 && s.mp.get(g, 'private.dboWearKept').length === 1, 'taking the Daedric off drops it from what is kept');
  check(s.report(g, [P.EBONY, P.DAEDRIC])[0] === P.DAEDRIC, '...and putting it back on is refused');
  // A first sight keeps the previous outfit, not a piece just put on
  const f = s.actor(6, 0, [P.IRON]);
  check(s.report(f, [P.IRON, P.ORC])[0] === P.ORC, 'a piece put on at the first sight is not grandfathered (lastWorn is)');
  // Exempt: guard, faction, Imperial, clothing and jewellery, no family
  const x = s.actor(7, 0, [P.IRON]);
  check(s.report(x, [P.IRON, P.GUARD, P.LEGION, P.IMPERIAL, P.RING, P.ODD]).length === 0, 'guard, faction and Imperial gear, a ring and a piece of no family have no rule');
  // Config
  const lv = run(src, { enabled: true, defenseLevels: [0, 50, 50, 50, 50, 50, 50] }); const l = lv.actor(8, 20, [P.IRON]);
  check(lv.report(l, [P.IRON, P.STEEL])[0] === P.STEEL, 'config defenseLevels sets the levels (Steel at 50)');
  const offc = run(src, { enabled: false }); const o = offc.actor(9, 0, [P.IRON]);
  check(offc.report(o, [P.IRON, P.DAEDRIC]).length === 0 && offc.mp.get(o, 'private.dboWearKept') === undefined, 'enabled false changes nothing');
  const nt = run(src, DEFAULT, false); const n = nt.actor(10, 0, [P.IRON]);
  check(nt.report(n, [P.IRON, P.DAEDRIC]).length === 0 && nt.mp.get(n, 'private.dboWearKept') === undefined, 'without smithing.js nothing is checked or seeded');
  return bad;
};
if (BODY) scenarios(BODY);

// ---- mutants: each must fail at least one scenario -------------------------------------------------------------------
const MUTANTS = [
  ['no grandfather', 'if (!(need > lvl) || kept.includes(id)) continue;', 'if (!(need > lvl)) continue;'],
  ['off by one level', 'if (!(need > lvl) ||', 'if (!(need >= lvl + 1 + 1) ||'],
  ['naked report drops kept', 'if (!settling && worn.length) {', 'if (!settling) {'],
  ['settling ignored', 'if (!settling && worn.length) {', 'if (worn.length) {'],
  ['seed from this report', "kept = (Array.isArray(last) && last.length ? last.map((x) => Number(Array.isArray(x) ? x[0] : x) >>> 0) : worn)", 'kept = worn'],
  ['taken off stays kept', 'if (still.length !== kept.length) { kept = still; changed = true; }', ''],
  ['clothing checked', 'if (!p || p.clothing || !(p.rating > 0)', 'if (!p'],
  ['tier off by one', "[t - 1]", '[t]'],
  ['flag ignored', "if (!ARMOR_WEAR.enabled || typeof globalThis.__dboWearTier !== 'function') return;", "if (typeof globalThis.__dboWearTier !== 'function') return;"],
];
for (const [name, from, to] of MUTANTS) {
  if (!BODY || !BODY.includes(from)) { ok(false, `mutant "${name}": its line is in the rule`); continue; }
  let bad = 0; try { bad = scenarios(BODY.replace(from, to)); } catch (e) { bad = 1; }
  ok(bad > 0, `mutant "${name}" is caught (${bad} scenario${bad === 1 ? '' : 's'} fail)`);
}
// smithing.js's exemptions, mutated in a copy
{
  const src = fs.readFileSync(path.join(SERVER, 'smithing.js'), 'utf8');
  const from = "return !fam || fam.factionExempt || fam.id === 'guard' ? 0 : fam.tier;";
  const tmp = path.join(dir, 'smithing-mutant.js');
  fs.writeFileSync(tmp, src.replace(from, 'return !fam ? 0 : fam.tier;'));
  process.chdir(dir); delete globalThis.__dboWearTier;
  require(tmp)({ mp: smp, log: () => {}, personal: () => {}, audit: () => {}, who: () => '', cfg: { smithing: { enabled: true } }, registerChatCommand: () => {}, onlineActors: () => [], findByName: () => 0, isAdmin: () => false, sendPacket: () => true, itemName: () => '', every: () => {} });
  process.chdir(cwd);
  ok(src.includes(from) && globalThis.__dboWearTier(P.GUARD) !== 0, 'mutant "guard gear tiered" is caught');
  globalThis.__dboWearTier = wearTier;
}

// ---- the inventory number is the one a blow meets --------------------------------------------------------------------
{
  const cut = (from, to) => { const i = GM.indexOf(from), j = GM.indexOf(to, i); return i >= 0 && j > i ? GM.slice(i, j) : ''; };
  const hit = cut('const defenseDamageMult = ', '\n};\n') + '\n};';
  const count = GM.includes('const armorCountOf = ') ? cut('const armorCountOf = ', '\n') : '';
  const stat = cut('const statItemsFor = ', '\nconst statSent');
  ok(!!hit && !!stat, 'gamemode.js has defenseDamageMult and statItemsFor');
  const W = [{ baseId: P.EBONY, health: 1.3, cond: 0.8 }, { baseId: P.GLASS, health: 1.0, cond: 1 }];
  const recs = { [P.EBONY]: { rating: 43, counted: 45, heavy: true, chest: true }, [P.GLASS]: { rating: 38, counted: 38, heavy: false, chest: false } };
  const deps = { defensePieceMult: () => ({ heavy: 1.5, light: 1.2 }), gearArmorMult: () => ({ heavy: 1.13, light: 1.05 }), potionBonus: (a, h) => (h === 'armor' ? 0.1 : 0),
    wornWithHealth: () => W, armorPieceOf: (id) => recs[id] || null, gmstFloat: (id, d) => (id === 0x37deb ? 1e9 : d), temperBonus: (h, chest) => { const q = Math.round((Number(h) - 1) * 10); return q > 0 ? (3.6 * q - 1.6) * (chest ? 1 : 0.5) : 0; },
    wearCondOf: (a, e) => (e && e.baseId === P.EBONY ? 0.8 : 1), mp: { get: () => ({ entries: W.map((w) => ({ baseId: w.baseId, count: 1, health: w.health, worn: true })) }) },
    STAT_DISPLAY: { maxItems: 250 }, recordDamageOf: () => 0, bandedDamageOf: () => 0, DISPLAY_SKILL: {}, weaponAnimOf: () => 0, masteryDamageMult: () => 1, materialDamageMult: () => 1 };
  const names = Object.keys(deps);
  let shown = 0, met = 0, err = '';
  try {
    const f = new Function(...names, `${count}\n${hit}\n${stat}\nreturn { defenseDamageMult, statItemsFor };`)(...names.map((k) => deps[k]));
    shown = f.statItemsFor(1).filter((x) => x.kind === 'armor').reduce((n, x) => n + x.value, 0);
    const m = f.defenseDamageMult(1), bare = 43 + 38;
    met = (1 - m * (1 - bare * 0.0012)) / 0.0012;   // the counted rating behind the hit's multiplier
  } catch (e) { err = e.message; }
  ok(!err && Math.abs(shown - met) < 0.05, `the inventory shows the armour a blow meets: ${shown.toFixed(2)} shown, ${met.toFixed(2)} counted (wear, worn Fortify Armor and a potion included)`, err || { shown, met });
}

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
