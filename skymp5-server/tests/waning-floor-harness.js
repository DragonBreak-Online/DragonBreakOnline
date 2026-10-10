// The Wheel's floors (Nate, 8 Oct: "Allow waning to decrease from 25 now"): a skill set to Lower gives points down to
// waningFloor (1 is the lowest: a skill at 0 leaves the order and would cost its first touch again), raised and held
// skills keep transferFloor (25). A skill named 0 in waningFloorBySkill, one taken up again just by doing it, falls to 0
// and leaves the order with every point back in the pool (Rocco, 10 Oct: a skill waning at 1 kept a point it could not use).
// Bundles skillPoints.ts with esbuild and drives applyGain and firstTouch.
//   node tests/waning-floor-harness.js   (from skymp5-server, node_modules present)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-waning-'));
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'skillPoints.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'p.js'), logLevel: 'error' });
  const P = require(path.join(out, 'p.js'));
  fs.rmSync(out, { recursive: true, force: true });
  const cfg = (extra) => Object.assign({ pool: 300, capPerSkill: 100, seatAbove: 90, seatCount: 1, expertAbove: 75, expertCount: 3,
    transferFloor: 25, firstTouchCost: 1, bucketBurst: 1e9, bucketPerHour: 1e9, dailyCaps: { low: 1e9, expert: 1e9, master: 1e9 }, characterDaily: 1e9 }, extra);
  const at = (lv) => ({ level: lv, xp: 0 });

  ok(P.waningFloorOf(cfg({ waningFloor: 1 })) === 1 && P.waningFloorOf(cfg({})) === 25, 'waningFloor 1 when set, the transfer floor when absent (old behaviour)');
  ok(P.waningFloorOf(cfg({ waningFloor: 0 })) === 1 && P.waningFloorOf(cfg({ waningFloor: 40 })) === 25, '...never below 1, never above the transfer floor');

  // A full Wheel: 75 + 75 + 75 + 75 = 300. Smithing raises; Alchemy is set to Lower and sits at 26.
  const full = () => ({ skills: { smith: { ...at(75), lock: 'raise' }, alch: { ...at(26), lock: 'lower' }, hunt: { ...at(75), lock: 'raise' }, pray: { ...at(74), lock: 'hold' }, mine: { ...at(50), lock: 'raise' } } });
  const gain = (rec, units, c) => P.applyGain(rec, 'smith', units, c, Date.parse('2026-10-08T12:00:00Z'));
  let rec = full(); rec.skills.alch.level = 26; rec.skills.mine.level = 50;
  // Raise the pool to exactly full first
  const used = Object.values(rec.skills).reduce((n, s) => n + s.level, 0);
  rec.skills.mine.level += 300 - used;
  const units = P.unitsForLevel(85) - P.unitsForLevel(75);
  const r = gain(rec, units, cfg({ waningFloor: 1 }));
  ok(rec.skills.alch.level < 25 && rec.skills.alch.level >= 1, 'a skill set to Lower now gives points below 25', { alch: rec.skills.alch.level, r });
  ok(rec.skills.pray.level === 74, 'a held skill gives nothing');

  rec = full(); rec.skills.alch.level = 2;
  rec.skills.mine.level += 300 - Object.values(rec.skills).reduce((n, s) => n + s.level, 0);
  gain(rec, P.unitsForLevel(95) - P.unitsForLevel(75), cfg({ waningFloor: 1 }));
  ok(rec.skills.alch.level === 1, 'it stops at 1, never 0', rec.skills.alch.level);
  ok(rec.skills.mine.level >= 25 && rec.skills.hunt.level >= 25, 'raised skills still stop at 25', { mine: rec.skills.mine.level, hunt: rec.skills.hunt.level });
  ok(P.derivedOrder(rec).includes('alch'), 'a lowered skill at 1 stays taken up (in the order)');

  rec = full(); rec.skills.alch.level = 26;
  rec.skills.mine.level += 300 - Object.values(rec.skills).reduce((n, s) => n + s.level, 0);
  gain(rec, units, cfg({}));
  ok(rec.skills.alch.level >= 25, 'without waningFloor a lowered skill stops at 25, as before', rec.skills.alch.level);

  // First touch with a full Wheel takes its level from a lowered skill below 25 too
  rec = full(); rec.skills.alch.level = 10;
  rec.skills.mine.level += 300 - Object.values(rec.skills).reduce((n, s) => n + s.level, 0);
  ok(P.firstTouch(rec, 'tailor', cfg({ waningFloor: 1 })) === true && rec.skills.alch.level === 9 && rec.skills.tailor.level === 1, 'a first touch takes its level from a lowered skill below 25', { alch: rec.skills.alch.level });
  rec = full(); rec.skills.alch.level = 1;
  rec.skills.mine.level += 300 - Object.values(rec.skills).reduce((n, s) => n + s.level, 0);
  ok(P.firstTouch(rec, 'tailor', cfg({ waningFloor: 1 })) === false && rec.skills.alch.level === 1, '...but not below 1');

  // chooseDonors directly: per-lock floors
  const d = P.chooseDonors([{ id: 'a', level: 10, xp: 0, lock: 'lower' }, { id: 'b', level: 30, xp: 0, lock: 'raise' }, { id: 'c', level: 50, xp: 0, lock: 'hold' }], 'x', 1e9, 25, 1);
  const by = Object.fromEntries(d.from.map((f) => [f.id, f.units]));
  ok(Math.round(by.a) === P.unitsForLevel(10) - P.unitsForLevel(1) && Math.round(by.b) === P.unitsForLevel(30) - P.unitsForLevel(25) && !by.c, 'chooseDonors: a lowered skill gives down to 1, a raised one to 25, a held one nothing', by);

  // ── per-skill floors: a trade opened by doing it falls to 0, a tome-opened skill stops at 1 ──
  const BY = { waningFloor: 1, waningFloorBySkill: { alch: 0, mine: 0, pray: 1 } };
  ok(P.waningFloorOf(cfg(BY), 'alch') === 0 && P.waningFloorOf(cfg(BY), 'pray') === 1 && P.waningFloorOf(cfg(BY), 'arcane') === 1 && P.waningFloorOf(cfg(BY)) === 1,
    'waningFloorOf: 0 for a skill set to 0, the configured floor for one set to 1, one not listed, and without an id');
  ok(P.waningFloorOf(cfg({ waningFloor: 1, waningFloorBySkill: { alch: 7 } }), 'alch') === 1 && P.waningFloorOf(cfg({ waningFloor: 1, waningFloorBySkill: { alch: -3 } }), 'alch') === 1,
    '...a per-skill value other than 0 never moves the floor (0 or the configured one, nothing else)');
  ok(P.waningFloorOf(cfg({ waningFloorBySkill: { alch: 0 } }), 'alch') === 0, '...0 holds even with no waningFloor set');

  // The report: Alchemy waning at 2 on a full Wheel, Smithing still rising. It gives both levels, not one.
  rec = full(); rec.skills.alch.level = 2;
  rec.skills.mine.level += 300 - Object.values(rec.skills).reduce((n, s) => n + s.level, 0);
  let g = gain(rec, P.unitsForLevel(95) - P.unitsForLevel(75), cfg(BY));
  ok(rec.skills.alch.level === 0 && rec.skills.alch.xp === 0, 'a skill set to 0 falls all the way to 0, xp cleared', rec.skills.alch);
  ok(!P.derivedOrder(rec).includes('alch'), '...and leaves the order');
  ok(g.tookFrom.some((t) => t.id === 'alch' && t.levels === 2), '...giving both its levels to the rising skill', g.tookFrom);
  ok(P.poolUsed(Object.entries(rec.skills).map(([id, v]) => ({ id, ...v }))) <= 300, '...and the pool still adds up', P.poolUsed(Object.entries(rec.skills).map(([id, v]) => ({ id, ...v }))));
  ok(rec.skills.mine.level >= 25 && rec.skills.hunt.level >= 25 && rec.skills.pray.level === 74, 'raised skills still stop at 25, held ones give nothing');

  // A tome-opened skill waning beside it still stops at 1
  rec = { skills: { smith: { ...at(98), lock: 'raise' }, alch: { ...at(1), lock: 'lower' }, arcane: { ...at(3), lock: 'lower' }, hunt: { ...at(100), lock: 'hold' }, pray: { ...at(98), lock: 'hold' } } };
  gain(rec, P.unitsForLevel(100) - P.unitsForLevel(98), cfg(BY));
  ok(rec.skills.alch.level === 0 && rec.skills.arcane.level === 1 && rec.skills.smith.level === 100, 'one gain: the trade falls to 0, the tome skill to 1, the rising one takes all three',
    { alch: rec.skills.alch.level, arcane: rec.skills.arcane.level, smith: rec.skills.smith.level });

  // chooseDonors with a per-skill floor
  const d2 = P.chooseDonors([{ id: 'alch', level: 3, xp: 0, lock: 'lower' }, { id: 'arcane', level: 3, xp: 0, lock: 'lower' }], 'x', 1e9, 25, (id) => (id === 'alch' ? 0 : 1));
  const by2 = Object.fromEntries(d2.from.map((f) => [f.id, f.units]));
  ok(Math.abs(by2.alch - P.unitsForLevel(3)) < 1e-9 && Math.abs(by2.arcane - (P.unitsForLevel(3) - P.unitsForLevel(1))) < 1e-9, 'chooseDonors: a floor per skill id', by2);

  // First touch on a full Wheel may take the last level of a skill set to 0, never of one at 1 that is not
  rec = full(); rec.skills.alch.level = 1; rec.skills.alch.xp = 30;
  rec.skills.mine.level += 300 - Object.values(rec.skills).reduce((n, s) => n + s.level, 0);
  ok(P.firstTouch(rec, 'tailor', cfg(BY)) === true && rec.skills.alch.level === 0 && rec.skills.alch.xp === 0 && rec.skills.tailor.level === 1 && !P.derivedOrder(rec).includes('alch'),
    'a first touch takes the last level of a skill set to 0', rec.skills.alch);
  rec = full(); rec.skills.pray = { ...at(1), lock: 'lower' }; delete rec.skills.alch;
  rec.skills.mine.level += 300 - Object.values(rec.skills).reduce((n, s) => n + s.level, 0);
  ok(P.firstTouch(rec, 'tailor', cfg(BY)) === false && rec.skills.pray.level === 1, '...but not of a skill whose floor is 1');

  // Taken up again: the entry left at 0 is replaced whole, waxing, at level 1
  rec = { skills: { alch: { level: 0, xp: 0, lock: 'lower' }, smith: { ...at(50), lock: 'raise' } } };
  ok(P.firstTouch(rec, 'alch', cfg(BY)) === true && rec.skills.alch.level === 1 && rec.skills.alch.lock === 'raise' && P.derivedOrder(rec).includes('alch'),
    'a skill at 0 is taken up again by its first touch, set to rise', rec.skills.alch);
  ok(P.applyGain(rec, 'alch', 5, cfg(BY), Date.parse('2026-10-10T12:00:00Z')).refused === undefined, '...and gains again');
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
