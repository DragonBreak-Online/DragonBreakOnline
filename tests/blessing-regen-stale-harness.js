// Scripted test for prayer.js's blessing regeneration tick against a simulated client and the C++ server path, as
// racial-regen-stale-harness.js does for racial.js. flasnex, 25 Oct: the blessing of Akatosh "destroying my magicka regen".
// The server's percentages are the client's last report (at most one a second); a write is adopted by the client as is, so
// a write made from a stale report threw away the client's own regeneration since that report. The tick from before the
// fix (origin/server's prayer.js, read from git) is run beside the fixed one, each against the same run with no blessing:
//   - float32 storage; a write sends only the bars it moved by 1/1024 or more
//   - OnChangeValues: a report within 1/1024 of the stored value is ignored, one above old + rate * dt is cropped and the
//     cropped value sent back (CropRegeneration with the server's own rate, which no blessing reaches)
//   - the client regenerates the race's 3% a second (a Nord's magicka) and reports a changed bar at most once a second
// The blessing is Akatosh's in effect, Magicka Rate Mult +10 (blessing-regen-harness.js reads it from the record): a tenth
// of 3% a second more, so a refill should take about a tenth less time.
//   node tests/blessing-regen-stale-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const SERVER = path.resolve(__dirname, '..');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const fr = Math.fround;
const EPS = 1 / 1024;
const STATS = ['health', 'magicka', 'stamina'];
const RATE = { health: 0.007, magicka: 0.03, stamina: 0.05 };
const A = 0x14, NORD = 0x13746;
const f32le = (x) => { const b = Buffer.alloc(4); b.writeFloatLE(x); return [...b]; };
const RACE = { record: { type: 'RACE', fields: [{ type: 'DATA', data: Uint8Array.from((() => { const d = new Array(128).fill(0); [[84, 0.7], [88, 3], [92, 5]].forEach(([at, v]) => f32le(v).forEach((b, i) => { d[at + i] = b; })); return d; })()) }] } };
const SKILLS = JSON.parse(fs.readFileSync(path.join(SERVER, 'skills.json'), 'utf8'));
// Akatosh's regeneration, named in the deity itself so the record readers are not this test's subject
SKILLS.deities.choices.push({ id: 'regentest', name: 'Regen Test', kind: 'faith', shrines: [], prayAnywhere: true, boon: 'x', sphere: 'x', blessingRegen: { MagickaRateMult: 10 } });

// The fix is judged against the tick it replaces: origin/server's prayer.js, beside this one so its requires resolve
const BEFORE = path.join(SERVER, '.prayer-before.harness.js');
let before = null;
try { before = execFileSync('git', ['show', 'origin/server:prayer.js'], { cwd: SERVER, encoding: 'utf8', maxBuffer: 1 << 26 }); } catch (e) { before = null; }

const simulate = (module, o) => {
  const lat = o.lat == null ? 100 : o.lat;
  const start = Object.assign({ health: 1, magicka: 1, stamina: 1 }, o.start || {});
  let stored = { health: fr(start.health), magicka: fr(start.magicka), stamina: fr(start.stamina) };
  const client = Object.assign({}, stored);
  const lastUpd = { health: -1e12, magicka: -1e12, stamina: -1e12 };
  const inFlight = [];
  let now = 1e6;
  const t0 = now;
  const out = { writes: 0, pulls: 0, pull: 0, reachAt: null };
  const props = new Map([[A + '|appearance', { raceId: NORD }]]);
  if (o.blessed) props.set(A + '|private.dboBlessing', { deity: 'regentest', spell: 0, until: now + 8 * 3600000, via: 'cast' });
  const timers = new Map();
  const mp = {
    get: (id, k) => (k === 'percentages' ? Object.assign({}, stored) : props.get(id + '|' + k)),
    set: (id, k, v) => {
      if (k !== 'percentages') { props.set(id + '|' + k, v); return; }
      const nv = {}; for (const s of STATS) nv[s] = fr(Math.max(0, Math.min(1, Number(v[s]))));
      const send = STATS.filter((s) => !(Math.abs(stored[s] - nv[s]) < EPS));
      stored = nv;
      for (const s of send) lastUpd[s] = now;
      const pc = {}; for (const s of send) pc[s] = nv[s];
      if (send.length) inFlight.push({ at: now + lat, to: 'client', pc, kind: 'write' });
      out.writes++;
    },
    getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
    getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
    lookupEspmRecordById: (id) => ((id >>> 0) === NORD ? RACE : null),
    callPapyrusFunction: () => true,
    getServerSettings: () => ({}),
  };
  const api = {
    mp, log: () => {}, personal: () => {}, audit: () => {}, display: () => 'T', who: () => 'T', cfg: {}, openWidget: () => true, closeWidget: () => true,
    onUi: () => {}, registerChatCommand: () => {}, onlineActors: () => [A], every: (name, ms, fn) => timers.set(name, { ms, fn }),
    skills: SKILLS, takeGold: () => true, treasuryHere: (a, n) => n, sendPacket: () => true,
  };
  globalThis.__dboBlessingRegenOwed = undefined; globalThis.__dboCastHeld = undefined; globalThis.__dboIsDowned = undefined;
  globalThis.__dboChillRateMult = undefined; globalThis.__dboGearRegen = undefined;
  const real = Date.now; Date.now = () => now;
  try {
    delete require.cache[require.resolve(module)];
    require(module)(api);
    const tick = timers.get('prayerBlessingRegen');
    let prevSent = null, prevTime = now + (o.reportOffset || 0) - 1000;
    let nextTick = now + (o.tickOffset == null ? 137 : o.tickOffset);
    const end = now + o.seconds * 1000;
    for (; now < end; now += 10) {
      client.magicka = Math.min(1, client.magicka + RATE.magicka * 0.01);
      for (let i = 0; i < inFlight.length; i++) {
        const m = inFlight[i];
        if (m.at > now) continue;
        inFlight.splice(i--, 1);
        if (m.to === 'server') {
          const back = {};
          for (const s of STATS) {
            const input = m.pc[s];
            if (Math.abs(stored[s] - input) < EPS) continue;
            const dt = Math.max(0, (now - lastUpd[s]) / 1000);
            const bound = Math.min(1, stored[s] + RATE[s] * Math.min(dt, 5));
            const nv = Math.max(0, Math.min(input, bound));
            if (!(Math.abs(nv - input) < EPS)) back[s] = fr(nv);
            stored[s] = fr(nv); lastUpd[s] = now;
          }
          if (Object.keys(back).length) inFlight.push({ at: now + lat, to: 'client', pc: back, kind: 'crop' });
        } else {
          for (const s of Object.keys(m.pc)) {
            const d = m.pc[s] - client[s];
            if (s === 'magicka' && m.kind === 'write' && d < -0.001) { out.pulls++; out.pull = Math.max(out.pull, -d); }
            client[s] = m.pc[s];
          }
        }
      }
      const av = { health: fr(client.health), magicka: fr(client.magicka), stamina: fr(client.stamina) };
      const same = prevSent && STATS.every((k) => prevSent[k] === av[k]);
      if (!same && now - prevTime >= 1000) { prevTime = now; prevSent = av; inFlight.push({ at: now + lat, to: 'server', pc: Object.assign({}, av) }); }
      if (tick && now >= nextTick) { tick.fn(); nextTick += tick.ms; }
      if (out.reachAt === null && client.magicka >= (o.target || 0.85) - 1e-9) out.reachAt = (now - t0) / 1000;
    }
  } finally { Date.now = real; }
  return out;
};
const speedUp = (module, o) => {
  const b = simulate(module, Object.assign({ blessed: true }, o)), v = simulate(module, Object.assign({ blessed: false }, o));
  return Object.assign(b, { ratio: b.reachAt && v.reachAt ? v.reachAt / b.reachAt : NaN, plain: v.reachAt });
};

const CASES = [];
for (const lat of [40, 100, 180]) for (const reportOffset of [0, 90, 170]) for (const tickOffset of [137, 610]) CASES.push({ lat, reportOffset, tickOffset });
const run = (module) => CASES.map((c) => Object.assign({ c }, speedUp(module, Object.assign({ start: { magicka: 0.05 }, target: 0.85, seconds: 45 }, c))));
const fmt = (r) => ({ lat: r.c.lat, report: r.c.reportOffset, tick: r.c.tickOffset, x: +r.ratio.toFixed(3), pulls: r.pulls, pull: +(r.pull * 100).toFixed(2) });

if (before) {
  fs.writeFileSync(BEFORE, before);
  try {
    const old = run(BEFORE);
    const worst = old.reduce((w, r) => (r.ratio < w.ratio ? r : w), old[0]);
    check('BEFORE the fix: the blessing pulled the bar back in at least one timing (the report)', old.some((r) => r.pulls > 0), fmt(worst));
    check('...and the refill was no faster, or slower, than with no blessing at all in at least one timing', old.some((r) => r.ratio < 1.02), fmt(worst));
  } finally { try { fs.unlinkSync(BEFORE); } catch (e) { /* gone */ } }
} else console.log('SKIP  the before run: origin/server:prayer.js could not be read from git');

const now = run(path.join(SERVER, 'prayer.js'));
const slowest = now.reduce((w, r) => (r.ratio < w.ratio ? r : w), now[0]);
check(`AFTER: the blessing never pulls the bar back (${now.length} timings)`, now.every((r) => r.pulls === 0), fmt(now.find((r) => r.pulls > 0) || slowest));
// The boon is paid a second of the bar's own regeneration at a time (3% for a Nord's magicka, every ~10 s of a tenth), so a
// 27 s refill catches two or three payments: racial's harness asks x1.05 of a x1.25 gift, a fifth of it; this asks a third
const mean = now.reduce((n, r) => n + r.ratio, 0) / now.length;
check('...and the refill is faster than with no blessing in every timing (x1.03 or more), x1.05 or more on average', now.every((r) => r.ratio >= 1.03) && mean >= 1.05, Object.assign(fmt(slowest), { mean: +mean.toFixed(3) }));
check('...and never past the boon itself (at most x1.12)', now.every((r) => r.ratio <= 1.12), fmt(now.reduce((w, r) => (r.ratio > w.ratio ? r : w), now[0])));
console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
