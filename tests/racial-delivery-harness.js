// How much of the racial regeneration gift actually reaches the bar, against a simulated client and the C++ server path: the Altmer's and the
// Redguard's regeneration gift pulled the bar back (stale writes, confirmed 8 Oct). The server's percentages are the client's
// last report (PercentagesBinding::Get reads the stored values; the client sends its bars on a change, at most once a
// second, and not while it casts or for 500 ms after: sendInputsService), and a write is adopted by the client as is
// (remoteServer onChangeValuesMessage). So a write made from a stale report throws away the client's own regeneration
// since that report. The model follows the 9 Oct review's sim (sweep-1009 review-highborn/sim/regen-sim.js):
//   - float32 storage (PercentagesBinding::Set ExtractFloat); a write sends only the bars it moved by 1/1024 or more
//   - OnChangeValues: a report within 1/1024 of the stored value is ignored, one above old + rate * dt is cropped and the
//     cropped value is sent back (ActionListener, CropRegeneration with the server's own rates)
//   - server-side blows lower health on the server and send it to the client (the C++ hit path)
//   - the client spends stamina (power attacks) and goes silent while it holds a spell
// Run from this folder's parent:
//   node tests/racial-regen-stale-harness.js
'use strict';
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const RACIAL = path.join(SERVER, 'racial.js');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const fr = Math.fround;
const EPS = 1 / 1024;
const STATS = ['health', 'magicka', 'stamina'];
const RATE = { health: 0.007, magicka: 0.03, stamina: 0.05 }; // RACE DATA 0.7 / 3 / 5 percent a second
const COMBAT = { health: 0, magicka: 0.33, stamina: 0.35 }; // fCombat*RegenRateMult
const f32le = (x) => { const b = Buffer.alloc(4); b.writeFloatLE(x); return [...b]; };
const RACE = () => { const d = new Array(128).fill(0); [[84, 0.7], [88, 3], [92, 5], [96, 4]].forEach(([at, v]) => f32le(v).forEach((b, i) => { d[at + i] = b; })); return { record: { type: 'RACE', fields: [{ type: 'DATA', data: Uint8Array.from(d) }] } }; };
const { RACE_IDS } = require(RACIAL);
const records = { 0x3c: { record: { type: 'WRLD', fields: [] } } };
for (const ids of Object.values(RACE_IDS)) for (const id of ids) records[id] = RACE();
const recordOf = (id) => records[id >>> 0] || null;

// One player and its client in 10 ms steps. o: race, stat (the bar the gift raises), start (bars), seconds, lat (one-way
// ms), target (stop the clock at this level), tickOffset, reportOffset, hitsEvery/hitDmg (server-side blows), spends
// ([{ at, stat, amount }] client-side), silent ([[from, to]] ms: the client holds a spell and reports nothing), casts
// ([{ at, amount }]: a fire-and-forget spell, magicka spent, 300 ms of casting, the SpellCast relayed: racial onCast), enabled
const simulate = (o) => {
  const A = 1;
  const lat = o.lat == null ? 100 : o.lat;
  const start = Object.assign({ health: 1, magicka: 1, stamina: 1 }, o.start || {});
  let stored = { health: fr(start.health), magicka: fr(start.magicka), stamina: fr(start.stamina) };
  const client = Object.assign({}, stored);
  const lastUpd = { health: -1e12, magicka: -1e12, stamina: -1e12 };
  const inFlight = [];
  const gets = {};
  let now = 1e6;
  const t0 = now;
  const out = { writes: 0, castRefunds: 0, lastWriteAt: -1, silentWrites: 0, crops: 0, writePulls: 0, writePull: 0, cropPulls: 0, refunds: 0, refund: 0, paid: 0, reachAt: null, ticks: 0 };
  let fightingUntil = -1;
  const casts = (o.casts || []).map((c) => Object.assign({}, c, { at: t0 + c.at }));
  // paused: a game-pausing menu or the regen delay: the client neither regenerates nor reports
  const pausedAt = (t) => (o.paused || []).some(([a, b]) => t >= t0 + a && t < t0 + b);
  const silentAt = (t) => pausedAt(t) || (o.silent || []).some(([a, b]) => t >= t0 + a && t < t0 + b) || casts.some((c) => t >= c.at && t < c.at + 300);
  const mp = {
    get: (id, k) => {
      gets[k] = (gets[k] || 0) + 1;
      if (k === 'appearance') return { raceId: RACE_IDS[o.race][0] };
      if (k === 'percentages') return Object.assign({}, stored);
      if (k === 'worldOrCellDesc') return '3c:Skyrim.esm';
      if (k === 'pos') return [0, 0, 0];
      return undefined;
    },
    set: (id, k, v) => {
      if (k !== 'percentages') return;
      const nv = {}; for (const s of STATS) nv[s] = fr(Math.max(0, Math.min(1, Number(v[s]))));
      const send = STATS.filter((s) => !(Math.abs(stored[s] - nv[s]) < EPS));
      const paid = {}; for (const s of STATS) paid[s] = nv[s] - stored[s];
      if (paid[o.stat] > 0) { out.paid += paid[o.stat]; out.maxPay = Math.max(out.maxPay || 0, paid[o.stat]); }
      stored = nv;
      for (const s of send) lastUpd[s] = now;
      const pc = {}; for (const s of send) pc[s] = nv[s];
      // castKnown: written after a SpellCast reached the server (the hold's job from then on)
      if (send.length) inFlight.push({ at: now + lat, to: 'client', pc, paid, kind: 'write', castKnown: casts.some((c) => c.relayed) });
      out.writes++; out.lastWriteAt = now - t0;
      if (silentAt(now)) out.silentWrites++;
    },
    getIdFromDesc: () => 0x3c,
    getServerSettings: () => ({}),
  };
  delete require.cache[require.resolve(RACIAL)];
  globalThis.__dboRacialState = undefined;
  globalThis.__dboRegions = { provinceAt: () => ({ province: 'skyrim' }) };
  globalThis.__dboCombatAt = new Map();
  let tickMs = 0;
  const R = require(RACIAL)({
    mp, log: () => {}, personal: () => {}, display: String, recordOf, giveItem: () => true, profileOf: () => 0,
    every: (name, ms) => { if (name === 'racialRegen') tickMs = ms; }, onlineActors: () => [A],
    weaponHandsOf: () => '', sourceResistsOf: () => new Set(),
    cfg: { racial: Object.assign({ enabled: o.enabled !== false }, o.racialCfg || {}) },
  });
  // reportOffset: the client's first report comes that many ms in, which sets its report clock against the server's tick
  let prevSent = null, prevTime = now + (o.reportOffset || 0) - 1000, prevCasting = -1e12;
  let nextTick = now + (o.tickOffset == null ? 137 : o.tickOffset);
  let nextHit = o.hitsEvery ? now + o.hitsEvery : Infinity;
  const spends = (o.spends || []).map((s) => Object.assign({}, s, { at: t0 + s.at }));
  const end = now + o.seconds * 1000;
  const target = o.target == null ? 1 : o.target;
  for (; now < end; now += 10) {
    const fighting = now < fightingUntil;
    if (!pausedAt(now)) for (const s of STATS) client[s] = Math.min(1, client[s] + RATE[s] * (fighting ? COMBAT[s] : 1) * 0.01);
    for (const sp of spends) if (!sp.done && now >= sp.at) { sp.done = true; client[sp.stat] = Math.max(0, client[sp.stat] - sp.amount); }
    for (const c of casts) {
      if (!c.done && now >= c.at) { c.done = true; client.magicka = Math.max(0, client.magicka - c.amount); }
      if (!c.relayed && now >= c.at + lat) { c.relayed = true; R.onCast(A, 0x12fcc0, now); }
    }
    for (let i = 0; i < inFlight.length; i++) {
      const m = inFlight[i];
      if (m.at > now) continue;
      inFlight.splice(i--, 1);
      if (m.to === 'server') {
        // ActionListener::OnChangeValues
        const back = {};
        for (const s of STATS) {
          const input = m.pc[s];
          if (Math.abs(stored[s] - input) < EPS) continue;
          const dt = Math.max(0, (now - lastUpd[s]) / 1000);
          const bound = Math.min(1, stored[s] + RATE[s] * (s === 'stamina' ? dt : Math.min(dt, 5)));
          const nv = Math.max(0, Math.min(input, bound));
          if (!(Math.abs(nv - input) < EPS)) back[s] = fr(nv);
          stored[s] = fr(nv);
          lastUpd[s] = now;
        }
        if (Object.keys(back).length) { out.crops++; inFlight.push({ at: now + lat, to: 'client', pc: back, kind: 'crop' }); }
      } else {
        for (const s of Object.keys(m.pc)) {
          const d = m.pc[s] - client[s];
          if (s === o.stat && m.kind === 'write') {
            if (d < -0.001) { out.writePulls++; out.writePull = Math.max(out.writePull, -d); }
            // more than the write meant to pay: it handed back what the client had spent or regenerated past
            const ex = d - (m.paid[s] > 0 ? m.paid[s] : 0);
            if (ex > 0.001) { out.refunds++; out.refund = Math.max(out.refund, ex); if (m.castKnown) out.castRefunds++; }
          }
          if (s === o.stat && m.kind === 'crop' && d < -0.001) out.cropPulls++;
          client[s] = m.pc[s];
        }
      }
    }
    if (o.hitsEvery && now >= nextHit) {
      nextHit += o.hitsEvery;
      const nh = fr(Math.max(0.05, stored.health - (o.hitDmg || 0.02)));
      stored.health = nh; lastUpd.health = now;
      inFlight.push({ at: now + lat, to: 'client', pc: { health: nh }, kind: 'hit' });
      globalThis.__dboCombatAt.set(A, now);
      fightingUntil = now + 10000;
    }
    // sendInputsService.sendActorValuePercentage
    if (silentAt(now)) prevCasting = now;
    const av = { health: fr(client.health), magicka: fr(client.magicka), stamina: fr(client.stamina) };
    const same = prevSent && STATS.every((k) => prevSent[k] === av[k]);
    if (!same && now - prevTime >= 1000 && now - prevCasting >= 500) {
      prevTime = now; prevSent = av;
      inFlight.push({ at: now + lat, to: 'server', pc: Object.assign({}, av) });
    }
    if (now >= nextTick) { const real = Date.now; Date.now = () => now; try { R.regenTick(now); } finally { Date.now = real; } nextTick += tickMs; out.ticks++; }
    if (out.reachAt === null && client[o.stat] >= target - 1e-9) out.reachAt = (now - t0) / 1000;
  }
  out.gained = client[o.stat] - start[o.stat];
  out.tickMs = tickMs;
  out.getsPerTick = Object.fromEntries(Object.entries(gets).map(([k, n]) => [k, +(n / Math.max(1, out.ticks)).toFixed(2)]));
  return out;
};
// The gift's speed-up against the same run without it: vanilla time to the target over the gifted time
const speedUp = (o) => {
  const g = simulate(o), v = simulate(Object.assign({}, o, { enabled: false }));
  return Object.assign(g, { ratio: g.reachAt && v.reachAt ? v.reachAt / g.reachAt : NaN });
};

// ---- how much of the gift actually reaches the bar ------------------------------------------------
// Worker 6 found this in prayer.js on 24 Oct and it applies here: a write replaces the client's bar, so
// every payout throws away the client's own regeneration since its last report. Paying more often therefore
// delivers LESS of the gift, and a stale enough report makes a payout move the bar DOWN.
//
// Delivery is measured as time-to-target at live rates: if the gift arrived in full the bar would fill f
// times faster, so from the speed-up ratio the delivered share is (ratio - 1) / (f - 1). Two ways of
// measuring this are wrong and were both tried first:
//   - net bar gain over a fixed window truncates the last payout step, so a large payoutSeconds reads far
//     worse than it is (at payoutSeconds 3 over 12 s the step never accrued at all and delivery read 0%);
//   - scaling the bar's own rate down to afford a long run is NOT valid, because minStep (0.002) and the
//     1/1024 report epsilon are absolute: the same settings gave 47.9% at the live rate and 60.1% at a
//     tenth of it. Checked, not assumed.
// Several targets are swept because the instant the bar crosses one is quantised by the payout step.
const pctOf = (x) => `${(x * 100).toFixed(1)}%`;
const vanillaCache = new Map();

// The factor racial.js itself reports, rather than a number from a comment
const factorOf = (raceKey, stat) => {
  delete require.cache[require.resolve(RACIAL)];
  globalThis.__dboRacialState = undefined;
  globalThis.__dboRegions = { provinceAt: () => ({ province: 'skyrim' }) };
  globalThis.__dboCombatAt = new Map();
  const R = require(RACIAL)({
    mp: { get: (id, k) => (k === 'appearance' ? { raceId: RACE_IDS[raceKey][0] } : k === 'percentages' ? { health: 0.5, magicka: 0.5, stamina: 0.5 } : k === 'worldOrCellDesc' ? '3c:Skyrim.esm' : k === 'pos' ? [0, 0, 0] : undefined),
         set: () => {}, getIdFromDesc: () => 0x3c, getServerSettings: () => ({}) },
    log: () => {}, personal: () => {}, display: String, recordOf, giveItem: () => true, profileOf: () => 0,
    every: () => {}, onlineActors: () => [1], weaponHandsOf: () => '', sourceResistsOf: () => new Set(),
    cfg: { racial: { enabled: true } },
  });
  return R.regenFactor(1, stat);
};
const F = factorOf('altmer', 'magicka');

// 90 runs: 3 latencies x 10 report offsets x 3 targets
const measure = (racialCfg) => {
  const shares = []; let pulls = 0, maxPull = 0, writes = 0, slowed = 0;
  for (const lat of [40, 100, 180]) for (let i = 0; i < 10; i++) for (const target of [0.6, 0.75, 0.85]) {
    const o = { race: 'altmer', stat: 'magicka', start: { magicka: 0.05 }, target, seconds: 45, lat, reportOffset: i * 100 };
    const vk = `${lat}|${i}|${target}`;
    if (!vanillaCache.has(vk)) vanillaCache.set(vk, simulate(Object.assign({}, o, { enabled: false })));
    const v = vanillaCache.get(vk);
    const g = simulate(Object.assign({}, o, { racialCfg }));
    if (!g.reachAt || !v.reachAt) continue;
    const d = (v.reachAt / g.reachAt - 1) / (F - 1);
    shares.push(d); if (d < -1e-9) slowed++;
    writes += g.writes; pulls += g.writePulls; maxPull = Math.max(maxPull, g.writePull);
  }
  shares.sort((a, b) => a - b);
  return { mean: shares.reduce((a, b) => a + b, 0) / shares.length, p10: shares[Math.floor(shares.length * 0.1)],
           worst: shares[0], slowed, n: shares.length, writes: writes / shares.length, pulls, maxPull };
};

console.log(`altmer magicka, gift x${F} as racial.js reports it; delivery as time-to-target, 90 runs a setting`);
console.log('');
console.log('  tick   payout   delivered    p10      worst    slowed the bar   writes/run  pull-backs');
const table = {};
for (const tickSeconds of [0.25, 0.5, 1.0]) for (const payoutSeconds of [1, 2, 3, 4, 6]) {
  const r = measure({ tickSeconds, payoutSeconds });
  table[`${tickSeconds}|${payoutSeconds}`] = r;
  console.log(`  ${tickSeconds.toFixed(2)}s  ${String(payoutSeconds).padEnd(6)}   ${pctOf(r.mean).padStart(7)}  ${pctOf(r.p10).padStart(7)}  ${pctOf(r.worst).padStart(8)}   ${String(r.slowed + '/' + r.n).padStart(10)}       ${r.writes.toFixed(1).padStart(5)}    ${r.pulls ? `${r.pulls} to ${pctOf(r.maxPull)}` : 'none'}`);
}
console.log('');

// ---- the checks -----------------------------------------------------------------------------------
const shipped = table['0.25|1'];
check('at the shipped settings (tickSeconds 0.25, payoutSeconds 1) the gift never slows the bar',
      shipped.slowed === 0, `${shipped.slowed} of ${shipped.n} runs`);
check('...and delivers at least half of what the factor promises', shipped.mean >= 0.5, pctOf(shipped.mean));

// A regression guard with a reason: tickSeconds 1.0 was proposed on 24 Oct to cut regenTick's CPU (it was the
// hottest gamemode timer at 500 players). It cannot be used. A coarser tick does not reduce the number of
// writes - payoutSeconds does that - it only makes the report each write is built from staler, so each payout
// takes back more of the client's own regen. Measured: delivery falls from about 58% to about 29%, and a fifth
// of the runs end up SLOWER than no gift at all. The CPU win has to come from not rebuilding the race and
// appearance memo on every tick (racial.js regenTick), not from ticking less often.
const coarse = table['1|1'];
check('tickSeconds 1.0 is still unusable: it slows the bar in some runs', coarse.slowed > 0,
      `${coarse.slowed} of ${coarse.n} runs, delivery ${pctOf(coarse.mean)} against ${pctOf(shipped.mean)}`);
check('...and no payoutSeconds rescues it to 80%', [1, 2, 3, 4, 6].every((p) => table[`1|${p}`].mean < 0.8),
      [1, 2, 3, 4, 6].map((p) => `${p}:${pctOf(table[`1|${p}`].mean)}`).join(' '));

// payoutSeconds is the knob that costs nothing: at the shipped tick it cuts writes by about 3.5x without
// losing delivery. Beyond 4 the step grows larger than a whole refill and the gift stops arriving at all.
const p4 = table['0.25|4'];
check('payoutSeconds 4 at the shipped tick keeps delivery and cuts writes by at least 3x',
      p4.mean >= shipped.mean - 0.02 && p4.writes * 3 <= shipped.writes && p4.slowed === 0,
      `${pctOf(p4.mean)} on ${p4.writes.toFixed(1)} writes against ${pctOf(shipped.mean)} on ${shipped.writes.toFixed(1)}`);
check('payoutSeconds 6 is past the useful range: the step outlasts a refill',
      table['0.25|6'].mean < 0.25, pctOf(table['0.25|6'].mean));

console.log('');
console.log(failures ? `${failures} FAILURES` : 'all checks passed');
process.exit(failures ? 1 : 0);
