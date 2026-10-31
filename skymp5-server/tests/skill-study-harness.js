// A book studied (Leader, 31 Oct: skill books for every skill; gameplay skillbooks.js through masterySystem's
// __alduinakMasteryStudy): half a level of a held skill at its own band, outside the Wheel's hourly bucket and day's caps,
// never past Expert (75); the lock, the structural cap and the pool hold as for any gain. Bundles skillPoints.ts with
// esbuild and drives applyStudy, with applyGain beside it to show the bucket and the day still pace ordinary work.
//   node tests/skill-study-harness.js   (from skymp5-server, node_modules present)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-study-'));
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'skillPoints.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'p.js'), logLevel: 'error' });
  const P = require(path.join(out, 'p.js'));
  fs.rmSync(out, { recursive: true, force: true });
  ok(typeof P.applyStudy === 'function' && P.STUDY_CEILING === 75, 'skillPoints.ts has applyStudy, and books teach no further than 75');
  if (typeof P.applyStudy !== 'function') { console.log('1 FAILED'); process.exit(1); }
  // The live pacing, tight: a bucket of 1 and a day's cap of 1, which would stop any ordinary work
  const cfg = { pool: 300, capPerSkill: 100, seatAbove: 90, seatCount: 1, expertAbove: 75, expertCount: 3, transferFloor: 25, firstTouchCost: 1,
    bucketBurst: 1, bucketPerHour: 1, dailyCaps: { low: 1, expert: 1, master: 1 }, characterDaily: 1, waningFloor: 1 };
  const now = Date.parse('2026-10-31T20:00:00Z');
  const one = (level, xp = 0, lock = 'raise') => ({ skills: { defense: { level, xp, lock } } });
  const levelOf = (rec) => rec.skills.defense.level + rec.skills.defense.xp / 100;

  // Half a level at each band
  for (const [lv, units] of [[10, 5], [30, 10], [60, 20], [80, 40]]) {
    const rec = one(lv);
    const r = P.applyStudy(rec, 'defense', 0.5, cfg, now);
    if (lv < 75) ok(Math.abs(r.units - units) < 1e-9 && Math.abs(levelOf(rec) - (lv + 0.5)) < 1e-9, `at level ${lv} a book is ${units} units, half a level`, [r, rec.skills.defense]);
    else ok(r.refused === 'ceiling' && rec.skills.defense.level === lv, `at level ${lv} a book teaches nothing: past Expert is practice`, [r, rec.skills.defense]);
  }
  // Outside the Wheel's pacing: the same tight cfg stops ordinary work at once
  const work = one(10);
  P.applyGain(work, 'defense', 1, cfg, now); const second = P.applyGain(work, 'defense', 5, cfg, now);
  ok(second.refused === 'bucket' || second.refused === 'daily', 'ordinary work is still paced by the bucket and the day', second);
  const read = one(10);
  const twice = [P.applyStudy(read, 'defense', 0.5, cfg, now), P.applyStudy(read, 'defense', 0.5, cfg, now)];
  ok(twice.every((r) => r.units === 5 && !r.refused) && read.skills.defense.level === 11, '...a book is not: two books in a row each give their half level', [twice, read.skills.defense]);
  // The Expert ceiling stops the rise in the middle of a book
  const near = one(74, 80);
  const n = P.applyStudy(near, 'defense', 0.5, cfg, now);
  ok(near.skills.defense.level === 75 && near.skills.defense.xp === 0, 'a book read at 74.8 stops at 75', [n, near.skills.defense]);
  // A Scholar's quarter more, and never more than a level a book
  const sch = one(30);
  P.applyStudy(sch, 'defense', 0.625, cfg, now);
  ok(Math.abs(levelOf(sch) - 30.625) < 1e-9, 'a Scholar\'s 0.625 of a level', sch.skills.defense);
  const big = one(10);
  P.applyStudy(big, 'defense', 5, cfg, now);
  ok(levelOf(big) === 11, '...and asking for more than one level gives one', big.skills.defense);
  // The locks, and a skill not held
  ok(P.applyStudy(one(30, 0, 'hold'), 'defense', 0.5, cfg, now).refused === 'lock' && P.applyStudy(one(30, 0, 'lower'), 'defense', 0.5, cfg, now).refused === 'lock', 'a skill on Hold or Lower takes nothing from a book');
  ok(P.applyStudy(one(0), 'defense', 0.5, cfg, now).refused === 'lock' && P.applyStudy({ skills: {} }, 'defense', 0.5, cfg, now).refused === 'lock', 'nor a skill never taken up');
  // The pool: a full Wheel takes the book's gain from a skill set to Lower, never from a held or raised one below its floor
  const full = { skills: { defense: { level: 40, xp: 0, lock: 'raise' }, miner: { level: 100, xp: 0, lock: 'raise' }, cook: { level: 100, xp: 0, lock: 'raise' }, tailor: { level: 60, xp: 0, lock: 'lower' } } };
  const pr = P.applyStudy(full, 'defense', 0.5, cfg, now);
  ok(levelOf(full) === 40.5 && full.skills.tailor.level <= 60 && pr.tookFrom.length <= 1, 'on a full Wheel the half level comes from the skill set to Lower', [pr, full.skills]);
  // A raised skill gives way above its floor, as for ordinary work (applyGain's donors); with every other skill on Hold, nothing does
  const stuck = { skills: { defense: { level: 40, xp: 0, lock: 'raise' }, miner: { level: 100, xp: 0, lock: 'hold' }, cook: { level: 100, xp: 0, lock: 'hold' }, tailor: { level: 60, xp: 0, lock: 'hold' } } };
  const sr = P.applyStudy(stuck, 'defense', 1, cfg, now);
  ok(stuck.skills.defense.level === 40 && sr.refused === 'pool', 'with every other skill on Hold, a full Wheel takes nothing', [sr, stuck.skills]);
  // The structural cap: one skill over 90 (seatAbove) and three over 75 still hold, and a book never reaches them anyway
  ok(P.studyUnits(60, 0.5) === 20 && P.studyUnits(10, 2) === 10, 'studyUnits: half a level at 60 is 20 units, and at most one level');

  console.log(fails ? `${fails} FAILED` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.stack || e); process.exit(1); });
