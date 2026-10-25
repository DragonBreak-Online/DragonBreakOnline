// A regeneration blessing must never slow the bar it speeds up (Marcus, #ooc-general 24 Oct: "Akatosh's blessing is still
// makin my magicka not regen"). The server's bar is the client's last report (at most one a second) and a write replaces the
// client's bar, so the 1 s blessing tick wrote a report most of a second old plus Akatosh's 0.003 and took back the client's
// own regen since that report: magicka refilled at about a fifth of its speed. prayer.js now pays as racial.js does (10 Oct):
// a bar only on a fresh report, at least payoutSeconds (3) of the bar's own regen at once, on a 1 s tick.
//
// A simulated client regenerates its own bar at the Nord's 3% a second, reports once a second, and takes every server write
// as its bar; the real prayer.js runs with a mock gamemode api. Run it from this folder's parent with
//
//   node tests/blessing-regen-fresh-harness.js [prayer.js to test]
'use strict';
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const PRAYER = path.resolve(process.argv[2] || path.join(SERVER, 'prayer.js'));
const SKILLS = JSON.parse(JSON.stringify(require(path.join(SERVER, 'skills.json'))));

globalThis.performance = { now: () => 0 };
let wallClock = 1790000000000;
const realNow = Date.now;
Date.now = () => wallClock;
const H = 3600000;

const ACTOR = 0x14;
const NORD = 0x13746;
const idOf = (d) => parseInt(String(d).split(':')[0], 16) >>> 0;
const choiceOf = (id) => SKILLS.deities.choices.find((c) => c.id === id);

const field = (type, bytes) => ({ type, data: Uint8Array.from(bytes) });
const u32le = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const f32le = (x) => { const b = Buffer.alloc(4); b.writeFloatLE(x); return [...b]; };
// MGEF DATA (libespm MGEF.h): flags u32 at 0, archetype u32 at 64, primary actor value i32 at 68
const mgef = (flags, archetype, av) => {
  const d = new Array(152).fill(0);
  u32le(flags).forEach((b, i) => { d[i] = b; });
  u32le(archetype).forEach((b, i) => { d[64 + i] = b; });
  u32le(av >>> 0).forEach((b, i) => { d[68 + i] = b; });
  return { record: { type: 'MGEF', fields: [field('DATA', d)] } };
};
const spel = (effects) => ({ record: { type: 'SPEL', fields: [
  field('SPIT', [...u32le(0), ...u32le(0), ...u32le(0), ...u32le(0), ...u32le(1), ...u32le(0), ...u32le(0), ...u32le(0), ...u32le(0)]),
  ...effects.flatMap(([id, mag, secs]) => [field('EFID', u32le(id)), field('EFIT', [...f32le(mag), ...u32le(0), ...u32le(secs)])]),
] } });
const race = (h, m, s) => { const d = new Array(128).fill(0); f32le(h).forEach((b, i) => { d[84 + i] = b; }); f32le(m).forEach((b, i) => { d[88 + i] = b; }); f32le(s).forEach((b, i) => { d[92 + i] = b; }); return { record: { type: 'RACE', fields: [field('DATA', d)] } }; };

// The server's records (2026-10-01): Akatosh's FortifyMagickaRateFFSelf is MagickaRateMult +10, Hircine's StaminaRate +10
const records = new Map([
  [0xfb989, mgef(0x200902, 34, 156)],
  [0xfb98b, mgef(0x200902, 34, 29)],
  [idOf(choiceOf('akatosh').blessing), spel([[0xfb989, 10, 28800]])],
  [idOf(choiceOf('hircine').blessing), spel([[0xfb98b, 10, 28800]])],
  [NORD, race(0.7, 3, 5)],
  [0x13748, race(0.7, 1, 5)],   // a race with a third of the Nord's magicka rate, so a long run never fills the bar
]);

const OWN = { health: 0.007, magicka: 0.03, stamina: 0.05 }; // the race's own regen a second, as the client runs it
const props = new Map();
const client = { health: 1, magicka: 1, stamina: 1 };
let writes = 0;
const timers = new Map();
const api = {
  mp: {
    getIdFromDesc: (d) => idOf(d),
    getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
    get: (id, prop) => props.get(id + '|' + prop),
    // A write replaces the client's bar
    set: (id, prop, v) => { props.set(id + '|' + prop, v); if (prop === 'percentages') { writes++; Object.assign(client, v); } },
    lookupEspmRecordById: (id) => records.get(id >>> 0) || null,
    callPapyrusFunction: () => true,
    getServerSettings: () => ({}),
  },
  log: () => {}, personal: () => {}, audit: () => {}, display: () => 'Tester', who: () => 'Tester (profile 1)',
  // BLESSING_REGEN_CFG='{"tickSeconds":1}' tries other prayer.blessingRegen settings
  cfg: { prayer: { blessingRegen: JSON.parse(process.env.BLESSING_REGEN_CFG || '{}') } }, openWidget: () => true, closeWidget: () => true, onUi: () => {}, registerChatCommand: () => {},
  onlineActors: () => [ACTOR], every: (name, ms, fn) => timers.set(name, { ms, fn }),
  skills: SKILLS, takeGold: () => true, treasuryHere: (a, n) => n, sendPacket: () => {},
};

let failures = 0;
const check = (name, cond, detail) => { if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '   ' + detail : ''}`); };
const load = () => { delete require.cache[require.resolve(PRAYER)]; timers.clear(); globalThis.__dboBlessingRegenOwed && globalThis.__dboBlessingRegenOwed.clear(); require(PRAYER)(api); };
const bless = (deity) => props.set(ACTOR + '|private.dboBlessing', { deity, spell: idOf(choiceOf(deity).blessing), until: wallClock + 8 * H, via: 'cast' });

// secs of play from `start` on one bar: the client regenerates every 10 ms and reports every reportMs, `phase` ms after
// the server's tick (a report that lands just after a tick is the worst case for a 1 s tick); returns the bar's gain
const play = (stat, secs, { start = 0.1, reportMs = 1000, phase = 100, silent = false } = {}) => {
  Object.assign(client, { health: 1, magicka: 1, stamina: 1 }, { [stat]: start });
  props.set(ACTOR + '|percentages', Object.assign({}, client));
  writes = 0; globalThis.__dboBlessingRegenOwed.delete(ACTOR);
  const tick = timers.get('prayerBlessingRegen');
  for (let t = 10; t <= secs * 1000; t += 10) {
    wallClock += 10;
    client[stat] = Math.min(1, client[stat] + OWN[stat] / 100);
    if (!silent && (t - phase) % reportMs === 0) props.set(ACTOR + '|percentages', Object.assign({}, client));
    if (t % tick.ms === 0) tick.fn();
  }
  return client[stat] - start;
};

props.set(ACTOR + '|appearance', { raceId: NORD });
load();
const tickMs = timers.get('prayerBlessingRegen').ms;
console.log(`tick every ${tickMs} ms (${path.relative(SERVER, PRAYER)})`);

props.delete(ACTOR + '|private.dboBlessing');
const plain = play('magicka', 20);
check('without a blessing a Nord\'s magicka refills 3% a second: +0.60 in 20 s', Math.abs(plain - 0.6) < 0.005, plain.toFixed(4));

// The gift delivered, averaged over where the report lands in the tick (33 runs), against the same play with no blessing
const share = (deity, stat, gift, secs) => {
  props.delete(ACTOR + '|private.dboBlessing');
  const base = play(stat, secs, { start: 0, phase: 100 });
  bless(deity);
  let tot = 0, n = 0, worst = Infinity;
  for (let phase = 10; phase < 1000; phase += 30) { const g = play(stat, secs, { start: 0, phase }) - base; tot += g; n++; worst = Math.min(worst, g); }
  return { share: tot / n / (gift * secs), worst };
};
props.set(ACTOR + '|appearance', { raceId: 0x13748 }); OWN.magicka = 0.01;
const ak = share('akatosh', 'magicka', 0.001, 90);
props.set(ACTOR + '|appearance', { raceId: NORD }); OWN.magicka = 0.03;
check(`Akatosh (a tenth of a 1%/s race's magicka rate) delivers at least 75% of its gift over 90 s`, ak.share >= 0.75, `${(ak.share * 100).toFixed(0)}%`);
check('...and never slows the bar, wherever the report lands', ak.worst >= -1e-9, ak.worst.toFixed(4));
const hi = share('hircine', 'stamina', 0.10, 6);
check(`Hircine (0.10 a second) delivers at least 75% of its gift to stamina over 6 s`, hi.share >= 0.75, `${(hi.share * 100).toFixed(0)}%`);
check('...and never slows the bar either', hi.worst >= -1e-9, hi.worst.toFixed(4));
bless('akatosh');
const silentGain = play('magicka', 10, { silent: true });
check('a silent client (a menu, a held spell) is never written to from its old report', writes === 0 && Math.abs(silentGain - 0.3) < 0.005, `${writes} writes, +${silentGain.toFixed(4)}`);
const slow = play('magicka', 20, { reportMs: 2000 });
check('reports two seconds apart still never slow it', slow >= 0.6 - 1e-9, slow.toFixed(4));
const fewer = (() => { play('magicka', 20); return writes; })();
check('a slow boon is paid in steps of payoutSeconds of the bar\'s own regen: Akatosh on a Nord at most once in 20 s', fewer <= 1, `${fewer} writes in 20 s`);

Date.now = realNow;
console.log('');
console.log(failures ? `${failures} FAILURES` : 'all checks passed');
process.exit(failures ? 1 : 0);
