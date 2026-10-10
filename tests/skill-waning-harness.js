// A skill marked Waning does not rise (SKILLS_DESIGN.md 3.6: "down: gains discarded"). Bug report 2026-10-01: a player
// with Skinner set to Waning still got "Your Skinner rises to ..." from skinning, because applyGain never read the
// gaining skill's own lock. Every credit path runs through applyGain, so this drives two of them against the real
// masterySystem: a won skinning round ("skin" activity, the path the report is about) and the gameplay award
// (manuals.js, alchemy.js). A Waxing control gains under the same conditions, the waning work is not charged to the
// bucket, and Waning keeps its other job: it is still the first to give way when another skill overflows the pool.
//
//   node tests/skill-waning-harness.js <bundled masterySystem.js>
//   (bundle with: cd fork/skymp5-server && ./node_modules/.bin/esbuild ts/systems/masterySystem.ts \
//      --bundle --platform=node --format=cjs --outfile=<out>)
'use strict';
const path = require('path');

const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests/skill-waning-harness.js <bundled masterySystem.js>'); process.exit(2); }
const { MasterySystem } = require(path.resolve(bundle));

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

// one user per actor, so a notice lands on the right player
const WANING = 0xff000021, WAXING = 0xff000022, SPENDER = 0xff000023;
const USERS = { [WANING]: 1, [WAXING]: 2, [SPENDER]: 3 };
const ACTORS = { 1: WANING, 2: WAXING, 3: SPENDER };
const props = new Map();
const notices = { 1: [], 2: [], 3: [] };
const mp = {
  get: (id, key) => {
    if (key === 'profileId') return USERS[id >>> 0] ? 2 : -1;
    const v = props.get(`${id >>> 0}:${key}`);
    return v === undefined ? undefined : JSON.parse(v);
  },
  set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
  getUserByActor: (a) => USERS[a >>> 0] || -1,
  getUserActor: (u) => ACTORS[u] || 0,
  sendCustomPacket: (u, s) => { const p = JSON.parse(s); if (p.customPacketType === 'masteryNotice') notices[u].push(p.text); },
};
const ctx = { svr: mp };
const sys = new MasterySystem(() => { });
sys.points = { pool: 300, capPerSkill: 100, seatAbove: 90, seatCount: 1, expertAbove: 75, expertCount: 3, transferFloor: 25, firstTouchCost: 1,
  bucketBurst: 20, bucketPerHour: 30, dailyCaps: { low: 360, expert: 180, master: 60 }, characterDaily: 1080 };
const LABELS = { skinner: 'Skinner', blade: 'Blade', blacksmith: 'Blacksmith', cook: 'Cook', alchemist: 'Alchemist' };
sys.skills = Object.keys(LABELS).map((id) => ({ id, category: 'profession', label: LABELS[id], title: '', description: '', tiers: [], vanillaSkills: [], counts: {}, gates: {} }));
// skinner is gated at the tanning rack, as in skills.json; a won round is its "skin" act
sys.rules = { skinner: { gateStations: new Set(['CraftingTanningRack']), gatePrefixes: [] } };
sys.candidates = new Map([['skin', ['skinner']]]);

const skill = (a, id) => mp.get(a, 'private.mastery').skills[id];
const worth = (a, id) => { const s = skill(a, id); return s.level * 1000 + s.xp; };
const skin = (a, corpse) => sys.creditActivity(ctx, { kind: 'skin', actorId: a, detail: { refrId: corpse, value: 40 } });
const rises = (u, label) => notices[u].filter((t) => new RegExp(`Your ${label} rises to`).test(t)).length;

// Novice Skinners at level 10, ten units a level: a few rounds are enough to see a level move
mp.set(WANING, 'private.mastery', { v: 2, skills: { skinner: { level: 10, xp: 0, lock: 'lower' } } });
mp.set(WAXING, 'private.mastery', { v: 2, skills: { skinner: { level: 10, xp: 0, lock: 'raise' } } });

// the clock stands still, so the bucket only refills when the harness says so
const realNow = Date.now, frozenAt = realNow(); Date.now = () => frozenAt;

// 1. a won skinning round: the Waxing Skinner gains, the Waning one does not
for (let i = 0; i < 8; i++) { skin(WAXING, 0x5000 + i); skin(WANING, 0x5000 + i); }
ok('a Waxing Skinner rises from skinning (the control)', skill(WAXING, 'skinner').level > 10 && rises(2, 'Skinner') > 0, skill(WAXING, 'skinner'));
ok('a Waning Skinner does not rise from skinning', skill(WANING, 'skinner').level === 10 && skill(WANING, 'skinner').xp === 0, skill(WANING, 'skinner'));
ok('...and is not told it rose', rises(1, 'Skinner') === 0, notices[1]);
ok('...and is not told its hands are full either: the pool has room', !notices[1].some((t) => /hands are full/.test(t)), notices[1]);

// 2. the gameplay award (manuals.js, alchemy.js) is held to the same rule
ok('an award to a Waning skill credits nothing', sys.award(ctx, WANING, 'skinner', 3, 0x6001) === 0 && worth(WANING, 'skinner') === 10000, skill(WANING, 'skinner'));
const xp0 = worth(WAXING, 'skinner');
const tookAward = sys.award(ctx, WAXING, 'skinner', 1, 0x6002);
ok('an award to a Waxing skill still credits (the control)', tookAward > 0 && worth(WAXING, 'skinner') > xp0, [tookAward, xp0, worth(WAXING, 'skinner')]);

// 3. the waning work was not charged: set back to Waxing, the first round pays a full bucket's worth at once
const bucketOf = (a) => (skill(a, 'skinner').bucket || {}).tokens;
ok('the waning work did not empty the bucket', bucketOf(WANING) === undefined || bucketOf(WANING) >= 20 - 1e-9, skill(WANING, 'skinner').bucket);
sys.onLock(ctx, 1, { skill: 'skinner', lock: 'raise' });
ok('the lock is set back to Waxing', skill(WANING, 'skinner').lock === 'raise', skill(WANING, 'skinner').lock);
const before = worth(WANING, 'skinner');
skin(WANING, 0x7001);
ok('set back to Waxing, the next round credits at once', worth(WANING, 'skinner') > before, [before, worth(WANING, 'skinner')]);

// 4. Waning keeps its other job: with the Wheel full, a Waxing skill's gain takes from it first
// 90 + 75 + 65 + 60 + 10 = 300: Blade gains a level, and the level comes from the waning Skinner, not the held ones
mp.set(SPENDER, 'private.mastery', { v: 2, skills: {
  blacksmith: { level: 90, xp: 0, lock: 'hold' }, cook: { level: 75, xp: 0, lock: 'hold' }, alchemist: { level: 65, xp: 0, lock: 'hold' },
  skinner: { level: 60, xp: 0, lock: 'lower' }, blade: { level: 10, xp: 0, lock: 'raise' } } });
for (let i = 0; i < 5; i++) sys.award(ctx, SPENDER, 'blade', 3, 0x8000 + i);
const sp = mp.get(SPENDER, 'private.mastery').skills;
ok('a Waxing skill still rises on a full Wheel', sp.blade.level > 10, sp.blade);
ok('...taking the level from the Waning skill', sp.skinner.level < 60 && notices[3].some((t) => /Your Skinner slips to/.test(t)), [sp.skinner, notices[3]]);
ok('...and never from a Held one', sp.blacksmith.level === 90 && sp.cook.level === 75 && sp.alchemist.level === 65, [sp.blacksmith.level, sp.cook.level, sp.alchemist.level]);
ok('the Wheel stays within 300', Object.values(sp).reduce((n, s) => n + s.level, 0) <= 300, Object.values(sp).map((s) => s.level));

// 5. A skill taken up again by doing it falls to 0 (pointSystem.waningFloorBySkill; Rocco, 10 Oct: "Skills put on waning at
// one dont remove themselves to zero leaving wasted left over skill points"); one with a special opening stops at 1.
// A fork without the per-skill floor skips this part.
if (/waningFloorBySkill/.test(require('fs').readFileSync(path.resolve(bundle), 'utf8'))) {
  sys.points.waningFloor = 1;
  sys.points.waningFloorBySkill = { skinner: 0, blade: 0, blacksmith: 0, cook: 0 };   // alchemist left out: the configured 1
  notices[3].length = 0;
  // A Wheel of 30 to keep the numbers small: 20 + 2 + 1 + 7, full. Blade rises; Skinner (floor 0) and Alchemist (floor 1) give way
  const keep = { pool: sys.points.pool, bucketBurst: sys.points.bucketBurst };
  Object.assign(sys.points, { pool: 30, bucketBurst: 1e6 });
  mp.set(SPENDER, 'private.mastery', { v: 2, skills: {
    blacksmith: { level: 20, xp: 0, lock: 'hold' }, alchemist: { level: 2, xp: 0, lock: 'lower' },
    skinner: { level: 1, xp: 0, lock: 'lower' }, blade: { level: 7, xp: 0, lock: 'raise' } } });
  for (let i = 0; i < 60; i++) sys.award(ctx, SPENDER, 'blade', 3, 0x9000 + i);
  let r = mp.get(SPENDER, 'private.mastery');
  ok('a waning trade falls to 0 on a full Wheel', r.skills.skinner.level === 0 && r.skills.skinner.xp === 0, r.skills.skinner);
  ok('...leaves the order', !r.order.includes('skinner'), r.order);
  ok('...and the player is told it was let go', notices[3].some((t) => /You have let Skinner go/.test(t)), notices[3]);
  ok('a waning skill with a special opening stops at 1', r.skills.alchemist.level === 1 && r.order.includes('alchemist'), r.skills.alchemist);
  ok('the rising skill took every freed point', r.skills.blade.level === 9, r.skills.blade);
  ok('the Wheel stays within 30', Object.values(r.skills).reduce((n, s) => n + s.level, 0) <= 30, Object.values(r.skills).map((s) => s.level));
  const menu = sys.menuFor(ctx, SPENDER);
  ok('the menu no longer lists it as held', !menu.points.held.some((h) => h.id === 'skinner') && menu.points.held.find((h) => h.id === 'alchemist').waningFloor === 1, menu.points.held);
  // taken up again (the gameplay first touch runs the same P.firstTouch as the station's), with a point free for it
  r.skills.blade.level = 8; mp.set(SPENDER, 'private.mastery', r);
  ok('it is taken up again by its first touch', sys.firstTouchFromGameplay(ctx, SPENDER, 'skinner') === 'ok', mp.get(SPENDER, 'private.mastery').skills.skinner);
  r = mp.get(SPENDER, 'private.mastery');
  ok('...at 1, rising, back in the order', r.skills.skinner.level === 1 && r.skills.skinner.lock === 'raise' && r.order.includes('skinner'), r.skills.skinner);
  Object.assign(sys.points, keep);
} else console.log('SKIP  this fork has no per-skill waning floor (pointSystem.waningFloorBySkill)');

Date.now = realNow;
console.log(fails ? `${fails} failure(s)` : 'all checks passed');
process.exit(fails ? 1 : 0);
