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
// Which physical effects are switched on. All off = Worker 6's original model exactly.
const MODEL = { lat: 0, f32: false, crop: false };
const fr = Math.fround;
const EPS = 1 / 1024;
const STATS = ['health', 'magicka', 'stamina'];
// The server's own per-second rates, for the crop bound (RACE DATA 0.7 / 3 / 5 percent a second)
const SRV_RATE = { health: 0.007, magicka: 0.03, stamina: 0.05 };
const lastUpd = { health: -1e12, magicka: -1e12, stamina: -1e12 };
let inFlight = [];
const api = {
  mp: {
    getIdFromDesc: (d) => idOf(d),
    getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
    get: (id, prop) => props.get(id + '|' + prop),
    // A write replaces the client's bar. With MODEL.lat it does so after a flight, like the real one
    set: (id, prop, v) => {
      if (prop !== 'percentages') { props.set(id + '|' + prop, v); return; }
      writes++;
      const nv = {};
      for (const k of STATS) nv[k] = MODEL.f32 ? fr(Math.max(0, Math.min(1, Number(v[k])))) : Number(v[k]);
      props.set(id + '|percentages', nv);
      for (const k of STATS) lastUpd[k] = wallClock;
      if (MODEL.lat > 0) inFlight.push({ at: wallClock + MODEL.lat, to: 'client', pc: nv });
      else Object.assign(client, nv);
    },
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
  inFlight = [];
  for (const k of STATS) lastUpd[k] = wallClock - 1e6;
  const tick = timers.get('prayerBlessingRegen');
  for (let t = 10; t <= secs * 1000; t += 10) {
    wallClock += 10;
    client[stat] = Math.min(1, client[stat] + OWN[stat] / 100);
    // messages that have arrived
    for (let i = 0; i < inFlight.length; i++) {
      const m = inFlight[i];
      if (m.at > wallClock) continue;
      inFlight.splice(i--, 1);
      if (m.to === 'client') { Object.assign(client, m.pc); continue; }
      // to the server: ActionListener::OnChangeValues
      const stored = Object.assign({}, props.get(ACTOR + '|percentages'));
      const back = {};
      for (const k of STATS) {
        const input = m.pc[k];
        if (input === undefined) continue;
        if (MODEL.f32 && Math.abs(stored[k] - input) < EPS) continue;
        let nv = input;
        if (MODEL.crop) {
          const dt = Math.max(0, (wallClock - lastUpd[k]) / 1000);
          const bound = Math.min(1, stored[k] + OWN[k] * (k === 'stamina' ? dt : Math.min(dt, 5)));
          nv = Math.max(0, Math.min(input, bound));
          if (!(Math.abs(nv - input) < EPS)) back[k] = MODEL.f32 ? fr(nv) : nv;
        }
        stored[k] = MODEL.f32 ? fr(nv) : nv;
        lastUpd[k] = wallClock;
      }
      props.set(ACTOR + '|percentages', stored);
      if (Object.keys(back).length && MODEL.lat > 0) inFlight.push({ at: wallClock + MODEL.lat, to: 'client', pc: back });
      else if (Object.keys(back).length) Object.assign(client, back);
    }
    if (!silent && (t - phase) % reportMs === 0) {
      const pc = {};
      for (const k of STATS) pc[k] = MODEL.f32 ? fr(client[k]) : client[k];
      if (MODEL.lat > 0) inFlight.push({ at: wallClock + MODEL.lat, to: 'server', pc });
      else {
        // no latency and no crop: the original model, a straight copy into the store
        if (!MODEL.crop && !MODEL.f32) props.set(ACTOR + '|percentages', Object.assign({}, client));
        else inFlight.push({ at: wallClock, to: 'server', pc });
      }
    }
    if (t % tick.ms === 0) tick.fn();
  }
  return client[stat] - start;
};

props.set(ACTOR + '|appearance', { raceId: NORD });

// Worker 6's own measure, kept exactly: net bar gain over the window, averaged over where the report
// lands in the tick, against the same run with no blessing.
const share = (deity, stat, gift, secs) => {
  props.delete(ACTOR + '|private.dboBlessing');
  let tot = 0, n = 0, worst = Infinity, writesTot = 0;
  const bases = {};
  for (let phase = 10; phase < 1000; phase += 30) bases[phase] = play(stat, secs, { start: 0, phase });
  bless(deity);
  for (let phase = 10; phase < 1000; phase += 30) {
    const g = play(stat, secs, { start: 0, phase }) - bases[phase];
    tot += g; n++; worst = Math.min(worst, g); writesTot += writes;
  }
  return { share: tot / n / (gift * secs), worst, writes: writesTot / n };
};

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const row = (label, cfg, model) => {
  Object.assign(MODEL, { lat: 0, f32: false, crop: false }, model);
  process.env.BLESSING_REGEN_CFG = JSON.stringify(cfg);
  api.cfg.prayer.blessingRegen = cfg;
  load();
  // Akatosh on the slow race: a tenth of a 1%/s bar, which is the case Worker 6 reports
  props.set(ACTOR + '|appearance', { raceId: 0x13748 }); OWN.magicka = 0.01;
  const ak = share('akatosh', 'magicka', 0.001, 90);
  props.set(ACTOR + '|appearance', { raceId: NORD }); OWN.magicka = 0.03;
  const hi = share('hircine', 'stamina', 0.10, 6);
  console.log(`  ${label.padEnd(34)} ${pct(ak.share).padStart(7)}  ${(ak.worst >= 0 ? '+' : '') + ak.worst.toFixed(4)}  ${ak.writes.toFixed(1).padStart(5)}   ${pct(hi.share).padStart(7)}  ${(hi.worst >= 0 ? '+' : '') + hi.worst.toFixed(4)}`);
  return { ak, hi };
};

const SHIP = { tickSeconds: 1, payoutSeconds: 3 };
const OLD = { tickSeconds: 0.25, payoutSeconds: 1 };

console.log('BLESSING delivery, Worker 6 model then each missing effect added. 33 report phases a cell.');
console.log('');
console.log('                                     Akatosh                      Hircine');
console.log('  model                              share    worst   writes    share    worst');
const a0 = row('tick 1 / payout 3, their model', SHIP, {});
const a1 = row('  + latency 100 ms', SHIP, { lat: 100 });
const a2 = row('  + float32 and the 1/1024 gate', SHIP, { lat: 100, f32: true });
const a3 = row('  + OnChangeValues crop (full)', SHIP, { lat: 100, f32: true, crop: true });
console.log('');
const b0 = row('tick 0.25 / payout 1, their model', OLD, {});
const b3 = row('  full model', OLD, { lat: 100, f32: true, crop: true });
console.log('');

// Is the conclusion an artefact of choosing 100 ms? The racial harness sweeps 40/100/180, so sweep here too.
console.log('latency sensitivity, full model (float32 + 1/1024 gate + OnChangeValues crop):');
console.log('                                     Akatosh                      Hircine');
console.log('  model                              share    worst   writes    share    worst');
const sens = {};
for (const lat of [40, 100, 180]) {
  sens['ship' + lat] = row(`tick 1 / payout 3, lat ${lat} ms`, SHIP, { lat, f32: true, crop: true });
  sens['old' + lat] = row(`tick 0.25 / payout 1, lat ${lat} ms`, OLD, { lat, f32: true, crop: true });
}
console.log('');

// ---- what this settles --------------------------------------------------------------------------
check('their model reproduces their published 83% for Akatosh at tick 1 / payout 3',
      a0.ak.share >= 0.78 && a0.ak.share <= 0.90, pct(a0.ak.share));
// These two assert the FINDING, not a hope: the 1 s tick does not clear 75% and does pull a bar back.
// If a later change makes them fail, the 1 s tick has become usable and this recommendation is stale.
check('the 1 s tick does NOT clear 75% under the full model, whatever the zero-latency model says',
      a3.ak.share < 0.75 && a3.hi.share < 0.75, `Akatosh ${pct(a3.ak.share)}, Hircine ${pct(a3.hi.share)}`);
check('...and it pulls a bar BACK, which is the symptom the ticket was about',
      a3.ak.worst < -1e-9 || a3.hi.worst < -1e-9, `Akatosh ${a3.ak.worst.toFixed(4)}, Hircine ${a3.hi.worst.toFixed(4)}`);
check('the shipped 0.25 s tick clears 60% and never pulls a bar back',
      b3.ak.share >= 0.60 && b3.hi.share >= 0.60 && b3.ak.worst >= -1e-9 && b3.hi.worst >= -1e-9,
      `Akatosh ${pct(b3.ak.share)} worst ${b3.ak.worst.toFixed(4)}, Hircine ${pct(b3.hi.share)} worst ${b3.hi.worst.toFixed(4)}`);
check('latency alone accounts for most of the gap against the zero-latency model',
      a1.ak.share < a0.ak.share - 0.25 && Math.abs(a2.ak.share - a1.ak.share) < 0.02,
      `their model ${pct(a0.ak.share)} -> +latency ${pct(a1.ak.share)} -> +float32 ${pct(a2.ak.share)} (float32 changed nothing)`);
check('the shipped 0.25 / 1 beats 1 / 3 under the full model at every latency',
      [40, 100, 180].every((l) => sens['old' + l].ak.share > sens['ship' + l].ak.share && sens['old' + l].hi.share > sens['ship' + l].hi.share),
      [40, 100, 180].map((l) => `${l}ms: ${pct(sens['old' + l].ak.share)} vs ${pct(sens['ship' + l].ak.share)}`).join('  '));
check('1 / 3 slows a bar at every latency; 0.25 / 1 never does',
      [40, 100, 180].every((l) => Math.min(sens['ship' + l].ak.worst, sens['ship' + l].hi.worst) < -1e-9) &&
      [40, 100, 180].every((l) => Math.min(sens['old' + l].ak.worst, sens['old' + l].hi.worst) >= -1e-9),
      [40, 100, 180].map((l) => `${l}ms 1/3 worst ${Math.min(sens['ship' + l].ak.worst, sens['ship' + l].hi.worst).toFixed(4)} | 0.25/1 worst ${Math.min(sens['old' + l].ak.worst, sens['old' + l].hi.worst).toFixed(4)}`).join('   '));
console.log('');
console.log(failures ? `${failures} FAILURES` : 'all checks passed');
process.exit(failures ? 1 : 0);
