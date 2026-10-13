// Is a player told why their work stopped counting, and for how long?
//
//   node tests\mastery-refusal-notice-harness.js <bundled skillPoints.js>
//   (bundle with: cd fork\skymp5-server && ./node_modules/.bin/esbuild ts/systems/skillPoints.ts \
//      --bundle --platform=node --format=cjs --outfile=<out>)
//
// Until 12 Oct only a "pool" refusal said anything. A "bucket" refusal (the hourly rate) and a "daily" refusal were
// silent: the work simply stopped counting with no message, which is how "how long is the cooldown for levelling the
// smithy" reached Discord instead of the game. applyGain now returns retryInMs with a bucket refusal, and
// masterySystem turns that into a sentence, throttled per reason so one message never swallows the other.
'use strict';
const fs = require('fs');
const path = require('path');

const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests\\mastery-refusal-notice-harness.js <bundled skillPoints.js>'); process.exit(2); }
const S = require(path.resolve(bundle));

let fails = 0, checks = 0;
const ok = (label, cond, got) => { checks++; if (!cond) { fails++; console.log(`  FAIL ${label}${got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); } };
const near = (label, got, want, tol) => ok(label, Math.abs(got - want) <= tol, got);

if (typeof S.msUntilOneToken !== 'function') {
  require('./expect')('mastery-refusal-notice', 'this skillPoints.ts has no msUntilOneToken (fork branch mastery-refusal-notice)');
  console.log('skipped: this server line has no msUntilOneToken (fork mastery-refusal-notice not merged)');
  process.exit(0);
}

// ── the wait the player is quoted ──────────────────────────────────────────────────────────────────
const HOUR = 3600000;
ok('a bucket that can already pay waits for nothing', S.msUntilOneToken({ tokens: 1, at: 0 }, 20) === 0);
ok('a bucket above one unit waits for nothing', S.msUntilOneToken({ tokens: 7.5, at: 0 }, 20) === 0);
// live rate is 20/hour, so one unit is three minutes
near('an empty bucket at 20/hour is three minutes', S.msUntilOneToken({ tokens: 0, at: 0 }, 20), 180000, 1000);
near('half a unit short is ninety seconds', S.msUntilOneToken({ tokens: 0.5, at: 0 }, 20), 90000, 1000);
ok('a stopped bucket never refills', S.msUntilOneToken({ tokens: 0, at: 0 }, 0) === Infinity);

// ── the refusals themselves, against the live numbers ──────────────────────────────────────────────
const cfg = {
  pool: 300, capPerSkill: 100, seatAbove: 90, seatCount: 1, expertAbove: 75, expertCount: 3,
  transferFloor: 25, firstTouchCost: 1, bucketBurst: 13, bucketPerHour: 20,
  dailyCaps: { low: 240, expert: 120, master: 40 }, characterDaily: 720,
};
const now = Date.UTC(2026, 9, 12, 9, 0, 0);

// Drain the bucket, then ask for more: the refusal must name the wait rather than leave the player guessing.
let rec = { skills: {} };
S.applyGain(rec, 'blacksmith', cfg.bucketBurst, cfg, now);
const dry = S.applyGain(rec, 'blacksmith', 5, cfg, now);
ok('a drained bucket refuses with "bucket"', dry.refused === 'bucket', dry.refused);
ok('the refusal carries a wait', typeof dry.retryInMs === 'number' && dry.retryInMs > 0, dry.retryInMs);
near('and the wait is one unit at the live rate', dry.retryInMs, 180000, 2000);

// The same bucket an hour later has refilled and pays again, so the quoted wait is not a lie.
const later = S.applyGain(rec, 'blacksmith', 5, cfg, now + HOUR);
ok('an hour later the work counts again', later.refused !== 'bucket', later.refused);

// A daily refusal reports no wait: it is a calendar rollover, which masterySystem works out itself.
//
// Reaching the cap takes care. The bucket holds 13 but refills at 20/hour, so draining it once an hour yields only
// ~13/hour and never reaches 240 in a day; spending little and often gives the full 20/hour. That is also the honest
// answer to "how long": about twelve hours of steady work to reach a low skill's daily cap. The whole run has to stay
// inside one UTC day, because the counters are keyed off the UTC date.
const dayStart = Date.UTC(2026, 9, 12, 0, 30, 0);
let dayRec = { skills: { blacksmith: { level: 0, xp: 0, lock: 'raise' } } };
let lastOut = null;
const STEP = 6 * 60000;                       // 2 units earned per step at 20/hour
for (let i = 0; i < 150; i++) lastOut = S.applyGain(dayRec, 'blacksmith', 2, cfg, dayStart + i * STEP);
const spent = dayRec.skills.blacksmith.spentToday || 0;
ok('fifteen hours of steady work is stopped by the day cap, not the bucket', spent === cfg.dailyCaps.low, spent);
ok('and the last attempt is refused as "daily"', lastOut.refused === 'daily', lastOut.refused);
ok('a daily refusal quotes no bucket wait', lastOut.retryInMs === undefined, lastOut.retryInMs);
// The next UTC day starts the counter again.
const tomorrow = S.applyGain(dayRec, 'blacksmith', 2, cfg, dayStart + 24 * HOUR);
ok('the next day counts again', tomorrow.refused !== 'daily', tomorrow.refused);

// ── the sentences, read from the system that sends them ────────────────────────────────────────────
const FORK = process.env.FORK_SERVER || process.env.FORK || path.resolve(__dirname, '..', '..', 'fork');
const msPath = path.join(FORK, 'skymp5-server', 'ts', 'systems', 'masterySystem.ts');
if (fs.existsSync(msPath)) {
  const src = fs.readFileSync(msPath, 'utf8');
  ok('a bucket refusal now sends a notice', /refused === "bucket"/.test(src));
  ok('a daily refusal now sends a notice', /refused === "daily"/.test(src));
  ok('the throttle is keyed per reason, so one message cannot swallow the other',
     /\$\{actorId\}:\$\{reason\}/.test(src));
  ok('the daily reset is worked out in UTC, matching dayKey', /getUTCDate\(\) \+ 1/.test(src));
} else {
  require('./expect')('mastery-refusal-notice', `masterySystem.ts is not at ${msPath}, so the sentences cannot be checked`);
  console.log(`  (masterySystem.ts not found at ${msPath}; sentence checks skipped)`);
}

console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
