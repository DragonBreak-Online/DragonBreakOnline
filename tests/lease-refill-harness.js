// A new claim finds its dungeon stocked (G64E, 4 Oct: back to back Adept claims of Telepe, "no loot from locked chests"
// and every coin purse "emptied not long ago"). Two parts:
//   1. The real dungeons.js, loot.json and expeditions.json: Telepe and Niryastare claimed many times at every
//      difficulty (Novice locks none) with every big chest locked (dungeons.lockedShare 1). A locked chest never opens
//      on nothing: one that rolled empty holds coin (before the fix 28-38% of them were empty).
//   2. __dboLeaseStartedAt: the claim's start for an actor inside a claimed dungeon, else 0; gamemode.js's coin purse
//      counts a rest set before that start as over.
//   node tests/lease-refill-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 600)}`); if (!c) fails++; };
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const DIFFS = ['story', 'normal', 'hard', 'nightmare'];
let rng = 0;
const reseed = (key) => { let h = 2166136261; for (const c of String(key)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); rng = h >>> 0; };
Math.random = () => { rng = (rng + 0x6d2b79f5) >>> 0; let t = Math.imul(rng ^ (rng >>> 15), rng | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const LOOT = read('loot.json').pools;
const ids = new Map(), descs = new Map(); let nextId = 0x100;
const idOf = (d) => { const k = String(d).toLowerCase(); if (!ids.has(k)) { ids.set(k, nextId); descs.set(nextId, k); nextId++; } return ids.get(k); };
const REC = new Map();
const recType = { weapons: 'WEAP', armor: 'ARMO', ench_weapons: 'WEAP', ench_armor: 'ARMO', arrows: 'AMMO', potions: 'ALCH', ingredients: 'INGR', gems: 'MISC', materials: 'MISC', soulgems: 'SLGM', lockpicks: 'MISC', lights: 'LIGH', recipes: 'BOOK' };
for (const [pool, list] of Object.entries(LOOT)) for (const it of list) REC.set(idOf(it.id), { type: recType[pool] || 'MISC', editorId: it.name, flags: 0, fields: /^ench_/.test(pool) ? [{ type: 'EITM' }] : [] });
const EXP = read('expeditions.json').expeditions.filter((d) => /Telepe|Niryastare/.test(d.id));
const A = 0x14;
const cfg = read('gamemode-config.json');
const LOCK_ALL = { story: 1, normal: 1, hard: 1, nightmare: 1 };

const tally = {};   // diff -> [locked chests, empty]
let leaseSeen = null, startedFor = { inside: -1, outside: -1 };
for (const d of EXP) for (const diff of DIFFS) {
  reseed(`${d.id}|${diff}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-refill-'));
  const here = process.cwd(); process.chdir(dir);
  for (const f of ['loot.json', 'ayleid-loot.json', 'dungeon-pools.json', 'artifacts.json', 'dragon-materials.json']) { try { fs.copyFileSync(path.join(ROOT, f), f); } catch (e) { /* optional */ } }
  fs.writeFileSync('expeditions.json', JSON.stringify({ expeditions: [d] }));
  fs.writeFileSync('dungeons.json', JSON.stringify({ dungeons: [] }));
  const props = new Map([[`${idOf('boardref')}|baseDesc`, '6:DragonBreak.esp']]);
  const setHome = () => { props.set(`${A}|worldOrCellDesc`, 'f8d:BSHeartland.esm'); props.set(`${A}|pos`, [0, -500, -221]); };
  setHome();
  const ui = new Map(), cmds = new Map();
  const savedTimeout = global.setTimeout; global.setTimeout = () => 0;
  globalThis.__dboDungeons = undefined; globalThis.__dboExpeditionPending = undefined;
  const modulePath = path.join(ROOT, 'dungeons.js');
  delete require.cache[modulePath];
  require(modulePath)({
    mp: { get: (id, p) => (p === 'profileId' ? (id === A ? 1 : -1) : props.get(`${id}|${p}`)), set: (id, p, v) => props.set(`${id}|${p}`, v), getIdFromDesc: idOf, getDescFromId: (id) => descs.get(id),
      lookupEspmRecordById: (id) => (id === idOf('6:DragonBreak.esp') ? { record: { editorId: 'ExpeditionBoard' } } : REC.has(id) ? { record: REC.get(id) } : { record: null }) },
    log: () => {}, personal: () => {}, system: () => {}, audit: () => {}, registerChatCommand: (n, fn) => cmds.set(n, fn), onUi: (n, fn) => { const l = ui.get(n) || []; l.push(fn); ui.set(n, l); },
    openWidget: () => true, closeWidget: () => true, sendPacket: () => true, findByName: () => 0, display: String, who: String, profileOf: (a) => (a === A ? 1 : -1), nameOf: () => 'P',
    onlineActors: () => [A], isAdmin: () => true, giveItem: () => true, cfg: { dungeons: Object.assign({}, cfg.dungeons || {}, { lockedShare: LOCK_ALL }) }, every: () => {},
  });
  const fire = (n, a, args) => (ui.get(n) || []).forEach((f) => f(a, args, 0));
  const named = new Set([].concat(d.bossChest || []).map((r) => String(r).toLowerCase()));
  for (let c = 0; c < 30; c++) {
    setHome(); props.delete(`${A}|private.dungeonCooldowns`); if (globalThis.__dboDungeonAccountRest) globalThis.__dboDungeonAccountRest.clear();
    globalThis.__dboDungeonActivate(idOf('boardref'), A); fire('expeditionPick', A, [d.id]);
    const pend = globalThis.__dboDungeons.pending.get(A); if (pend) fire('dungeonClaim', A, [pend.nonce, diff]);
    const lease = globalThis.__dboDungeons.leases.get(d.id); if (!lease) break;
    for (const ch of d.chests || []) {
      const id = idOf(ch.ref);
      if (!ch.big || /boss/i.test(ch.edid) || named.has(String(ch.ref).toLowerCase()) || !lease.locked.has(id)) continue;
      const t = tally[diff] = tally[diff] || [0, 0]; t[0]++;
      if (!((props.get(`${id}|inventory`) || { entries: [] }).entries || []).length) t[1]++;
    }
    if (!leaseSeen) {
      leaseSeen = lease;
      const started = () => (typeof globalThis.__dboLeaseStartedAt === 'function' ? globalThis.__dboLeaseStartedAt(A) : -1);
      startedFor.outside = started();
      const cell = (d.cells || [])[0];
      props.set(`${A}|worldOrCellDesc`, cell && cell.desc);
      startedFor.inside = started();
    }
    cmds.get('dungeon')(A, `end ${d.id.toLowerCase()}`);
  }
  global.setTimeout = savedTimeout; process.chdir(here); fs.rmSync(dir, { recursive: true, force: true });
}

// ---- 1 -------------------------------------------------------------------------------------------------------------
ok(!tally.story, 'Novice locks no chest (its blurb: no locked chests)', tally.story);
for (const diff of DIFFS.slice(1)) {
  const t = tally[diff] || [0, 0];
  ok(t[0] >= 50 && t[1] === 0, `${diff}: ${t[0]} locked chests over Telepe and Niryastare, none empty`, t);
}

// ---- 2 -------------------------------------------------------------------------------------------------------------
ok(typeof globalThis.__dboLeaseStartedAt === 'function', 'dungeons.js exposes __dboLeaseStartedAt');
ok(leaseSeen && startedFor.inside === leaseSeen.startedAt && startedFor.inside > 0, 'inside a claimed dungeon: the claim\'s start', startedFor);
ok(startedFor.outside === 0, 'outside it: 0', startedFor);
// ---- 3: the coin purse, run rather than read --------------------------------------------------------------------------
// gamemode.js's own __dboCoinPurse, evaluated with stubs for what it reaches for, so the checks follow its behaviour, not its
// layout (25 Oct: the hold's share moved Imperial Luck onto the kept gold, and a check of the old block shape failed for
// nothing). Each mutant below must break at least one check, so the checks still catch what they guard.
const GM = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const PURSE_SRC = GM.slice(GM.indexOf('globalThis.__dboCoinPurse = '), GM.indexOf('// ---- Beyond Skyrim activators'));
const NOW = Date.now(), REST_MIN = 60;
const openPurse = (src, o) => {
  const calls = [];
  const env = {
    PURSE: { enabled: true, restMinutes: REST_MIN, goldMin: 10, goldMax: 10, unskilledChance: 1, unskilledMult: 1, holdShare: o.holdShare || 0, refuseCells: [] },
    isGoldFlora: () => false, purseDeny: new Map(), personal: (a, t) => calls.push(['say', t]),
    isCoinPurse: () => true, isPurseBase: () => true, baseIdOf: () => 1, normPlace: (x) => String(x || ''),
    mp: { get: (id, k) => (k === 'worldOrCellDesc' ? 'w' : k === 'pos' ? [0, 0, 0] : undefined) },
    restUntil: () => o.until || 0, purseRest: new Map(), harvestingTier: () => -1, HARVESTING: {}, setRest: () => { },
    zoneAtPlace: () => (o.hold ? 'h' : null), zoneById: () => (o.hold ? { id: 'h', name: 'Hold', treasury: true } : null),
    giveItem: (a, base, n) => { calls.push(['give', n]); return o.giveOk !== false; },
    depositToTreasury: (id, n) => { calls.push(['deposit', n]); return n; },
    log: () => { }, who: () => 'P', audit: () => { },
  };
  const keep = { lease: globalThis.__dboLeaseStartedAt, race: globalThis.__dboRaceGold, purse: globalThis.__dboCoinPurse, rnd: Math.random };
  globalThis.__dboLeaseStartedAt = () => o.leaseAt || 0;
  globalThis.__dboRaceGold = (a, n) => calls.push(['race', n]);
  Math.random = () => 0;   // goldMin = goldMax: a purse holds 10, and the yield roll always pays
  try {
    new Function(...Object.keys(env), src)(...Object.values(env));
    globalThis.__dboCoinPurse(0x500, A);
  } finally {
    globalThis.__dboLeaseStartedAt = keep.lease; globalThis.__dboRaceGold = keep.race; globalThis.__dboCoinPurse = keep.purse; Math.random = keep.rnd;
  }
  return calls;
};
const at = (calls, kind) => calls.findIndex((c) => c[0] === kind);
const races = (calls) => calls.filter((c) => c[0] === 'race').map((c) => c[1]);
const PURSE_CHECKS = [
  ['a purse that paid pays Imperial Luck once on its gold, after handing it over', (src) => {
    const c = openPurse(src, {}); return races(c).join() === '10' && at(c, 'give') >= 0 && at(c, 'give') < at(c, 'race'); }],
  ['a purse whose gold could not be handed over pays no Imperial Luck', (src) => races(openPurse(src, { giveOk: false })).length === 0],
  ["with a hold's share, Imperial Luck is paid on what the opener keeps (10 - 2 to the treasury)", (src) => {
    const c = openPurse(src, { hold: true, holdShare: 0.25 }); return races(c).join() === '8' && c.some((x) => x[0] === 'deposit' && x[1] === 2); }],
  ['in a claimed dungeon, a purse emptied before the claim began is full again for the new party', (src) => {
    const c = openPurse(src, { until: NOW + 30 * 60000, leaseAt: NOW - 10 * 60000 }); return at(c, 'give') >= 0; }],
  ['...one emptied after the claim began stays empty', (src) => at(openPurse(src, { until: NOW + 30 * 60000, leaseAt: NOW - 50 * 60000 }), 'give') < 0],
  ['...and outside a claim a resting purse stays empty', (src) => at(openPurse(src, { until: NOW + 30 * 60000 }), 'give') < 0],
];
const purseResults = (src) => PURSE_CHECKS.map(([, f]) => { try { return !!f(src); } catch (e) { return false; } });
const real = purseResults(PURSE_SRC);
PURSE_CHECKS.forEach(([what], i) => ok(real[i], 'gamemode.js: ' + what));
const RACE_LINE = "try { if (typeof globalThis.__dboRaceGold === 'function') globalThis.__dboRaceGold(casterId, kept, 'a coin purse'); } catch (e) { log('racial gold failed', e.message); }";
const MUTANTS = [
  ['Imperial Luck paid before the hand-over', (s) => s.includes(RACE_LINE) && s.replace(RACE_LINE, '').replace('  if (giveItem(casterId, 0xf, mine)) {', "  globalThis.__dboRaceGold(casterId, gold, 'a coin purse');\n  if (giveItem(casterId, 0xf, mine)) {")],
  ['Imperial Luck on the whole purse, the treasury share included', (s) => s.includes('__dboRaceGold(casterId, kept,') && s.replace('__dboRaceGold(casterId, kept,', '__dboRaceGold(casterId, gold,')],
  ['the claim refill dropped', (s) => s.includes(' && !emptiedBeforeClaim') && s.replace(' && !emptiedBeforeClaim', '')],
];
for (const [what, mutate] of MUTANTS) {
  const m = mutate(PURSE_SRC);
  ok(typeof m === 'string' && purseResults(m).some((r) => !r), `mutant caught: ${what}`, typeof m === 'string' ? 'all checks still passed' : 'the mutation no longer applies (the purse code moved): update this mutant');
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
