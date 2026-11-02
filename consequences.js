// DragonBreak Online: Dynamic Consequences, phase 1 (Nat, 31 Oct; design _work\dynamic-consequences-1031.md on the PC).
// The world answers what players do: per hold, a pressure for each force (the Blight, the Dragon Cult, the Hunt) rises
// with the players who feed it there and falls with those who oppose it. Phase 1 only measures: no spawn, boss, weather
// or notice changes. Staff read it with /consequences. Loaded by gamemode.js on every hot reload.
//
// Every sampleMinutes: each online account counts 1 point to each force it feeds or opposes in the hold it stands in
// (supernatural kind, factions); an owner online whose claimed home stands in a hold adds homePoints there. Kills of a
// force's creatures by a player (deathHook) oppose it, at most killCapPerDay a player a day. Then
//   P = P * decay + (feed - oppose) * gain, clamped to 0..100; stages at the thresholds, left `hysteresis` below them.
// consequences.json beside the world state: { at, holds: { zone: { force: { p, stage, feed, oppose } } }, kills, p2 }
//
// Phase 2 (Nat's GO, 31 Oct: "a Jarl openly accepts every supernatural and does nothing"): a hold that harbours the
// supernatural forces (phase2.harbour, the Blight and the Hunt; its harbouring is the higher of their pressures) is
// answered by the world, never by naming anyone. Each part has its own switch and thresholds (config consequences.phase2),
// and every decision is taken on the sample above, never per tick:
//   writs     at writs.at a force's hunters (the Vigil of Stendarr, the Dawnguard, the Silver Hand) hold an open writ in the
//             hold: told on their factions' word, read at the hold's notice boards (gamemode.js __dboBoardOpened), and a
//             member's kill of a vampire or werewolf there is paid writs.bounty gold (new gold, writs.capPerDay a day each)
//   unrest    the hold's stability is 100 less its harbouring; from unrest.at it cuts a rising's petition thresholds
//             (rebellion.js needed(), through __dboHoldUnrest) by up to unrest.maxCut at unrest.full. It never moves a capital:
//             ownership stays with the court and citizenship, and a rising is still the citizens' own petition and war
//   pressure  from pressure.at the other courts censure the hold: its court is told, the boards say so, and the weekly
//             reckoning withholds pressure.censure of its tax income (economy.js, through __dboHoldCensureShare; a sink)
//   idleRuler a hold whose court has done no business for idleRuler.days (appointments, tax, wages, contracts, citizenship
//             decisions, heralds' cries, each stamped through __dboCourtBusiness where it succeeds) has its ruler warned
//             warnDays before, then calls a vote of no confidence: a new election through citizenship.js
//             (__dboCitizenNoConfidence), in a hold that holds elections and has the citizens to start one
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  enabled: true,
  sampleMinutes: 10,
  decay: 0.98,                 // about 6 hours' half-life with nobody feeding
  gain: 0.5,
  homePoints: 2,
  killPoints: 1,
  killCapPerDay: 30,
  thresholds: [25, 50, 75],
  hysteresis: 10,
  forces: {
    blight: {
      name: 'the Blight', stages: ['Calm', 'Stirring', 'Incursion', 'Cursed'],
      kinds: ['vampire'],
      feeders: ['cult-molag-bal', 'clan-volkihar', 'cyrodiil-vampyrum-order', 'crimson-scars', 'house-ravenwatch', 'bloodmist-clan'],
      opposers: ['dawnguard', 'vigil-of-stendarr'],
      creatures: 'vampire|deathhound|gargoyle|skeleton|zombie|ghoul|bonewalker|thrall',
    },
    cult: {
      name: 'the Dragon Cult', stages: ['Calm', 'Stirring', 'Incursion', 'Ascendant'],
      kinds: [],
      feeders: ['cult-dragon'],
      opposers: ['blades', 'greybeards'],
      creatures: 'draugr|dragonpriest|dragon_priest',
    },
    hunt: {
      name: 'the Hunt', stages: ['Calm', 'Stirring', 'Incursion', 'The Hunt is On'],
      kinds: ['werewolf'],
      feeders: ['cult-hircine'],
      opposers: ['vigil-of-stendarr'],
      creatures: 'werewolf|werebear|wolf|spriggan',
    },
  },
  phase2: {
    harbour: ['blight', 'hunt'],
    writs: {
      enabled: true, at: 50,
      factions: ['vigil-of-stendarr', 'dawnguard', 'silver-hand'],
      // gold per kill and what a kill is, per force: the vampires and the werewolves themselves, not their thralls or wolves
      bounty: { blight: 15, hunt: 20 },
      creatures: { blight: 'vampire(?!.*thrall)', hunt: 'werewolf|werebear' },
      capPerDay: 20,
      // a player of the force slain by a hunter in a writ's hold; off, since it pays for PvP
      players: false, playerBounty: 100,
    },
    unrest: { enabled: true, at: 40, full: 90, maxCut: 0.4 },
    pressure: { enabled: true, at: 75, censure: 0.2 },
    idleRuler: { enabled: true, days: 7, warnDays: 2 },
  },
};

module.exports = (api) => {
  const { mp, log, personal, registerChatCommand, onlineActors, every, profileOf, zoneOfActor, isAdmin, cfg } = api;
  const audit = typeof api.audit === 'function' ? api.audit : log;
  const giveItem = typeof api.giveItem === 'function' ? api.giveItem : null;
  const readOfficials = typeof api.readOfficials === 'function' ? api.readOfficials : () => ({});
  const raw = (cfg || {}).consequences || {};
  const C = Object.assign({}, DEFAULTS, raw, { forces: Object.assign({}, DEFAULTS.forces, raw.forces || {}) });
  const raw2 = raw.phase2 || {};
  const P2 = Object.assign({}, DEFAULTS.phase2, raw2);
  for (const part of ['writs', 'unrest', 'pressure', 'idleRuler']) P2[part] = Object.assign({}, DEFAULTS.phase2[part], raw2[part] || {});
  const FORCES = Object.keys(C.forces);
  const get = (ref, key, dflt) => { try { const v = mp.get(ref, key); return v === undefined || v === null ? dflt : v; } catch (e) { return dflt; } };
  const S = globalThis.__dboConsequences || (globalThis.__dboConsequences = { data: null, homes: null, homesAt: 0, edid: new Map(), deeds: new Map() });

  const zones = (() => { try { return JSON.parse(fs.readFileSync(path.resolve('zones.json'), 'utf8')); } catch (e) { return {}; } })();
  const places = new Map([].concat(zones.holds || [], zones.regions || []).map((z) => [z.id, z.name || z.id]));
  // A hold's ruler is its first office (the Jarl, the Count)
  const rulerOffice = new Map([].concat(zones.holds || [], zones.regions || []).filter((z) => (z.officials || []).length > 1).map((z) => [z.id, z.officials[0]]));
  const zoneHere = (ref) => { try { const z = zoneOfActor(ref); return z && places.has(z) ? z : null; } catch (e) { return null; } };

  const stateDir = () => { try { return path.dirname(fs.realpathSync(path.resolve('world'))); } catch (e) { return path.resolve('.'); } };
  const FILE = path.join(stateDir(), 'consequences.json');
  // The state's shape is made good on every read, not only when the file is read: the state lives on globalThis across
  // hot reloads, so one an older version of this file read stays cached. Live, 1 Nov: phase 2 was hot-deployed into a
  // process whose state phase 1 had read (no p2), and every writ, censure and court stamp threw until a restart
  const data = () => {
    if (!S.data) {
      try { S.data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { S.data = null; }
      if (!S.data || typeof S.data !== 'object') S.data = {};
    }
    S.data.holds = S.data.holds || {}; S.data.kills = S.data.kills || { day: '', by: {} };
    const p2 = S.data.p2 = S.data.p2 && typeof S.data.p2 === 'object' ? S.data.p2 : {};
    for (const k of ['writs', 'censure', 'court', 'warned', 'called', 'blocked']) if (!p2[k] || typeof p2[k] !== 'object') p2[k] = {};
    p2.bounty = p2.bounty && typeof p2.bounty === 'object' ? p2.bounty : { day: '', by: {} };
    return S.data;
  };
  const save = () => { try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(data(), null, 1)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { log('consequences: saving failed', e.message); } };
  const cell = (zone, force) => { const h = data().holds[zone] = data().holds[zone] || {}; return h[force] = h[force] || { p: 0, stage: 0, feed: 0, oppose: 0 }; };

  // Which forces an actor feeds and opposes: its supernatural kind and its factions
  const sidesOf = (a) => {
    const kind = String((get(a, 'private.supernatural', {}) || {}).kind || '');
    let guilds = [];
    try { guilds = typeof globalThis.__dboGuildsOf === 'function' ? (globalThis.__dboGuildsOf(a) || []).map((g) => String(g.id)) : []; } catch (e) { guilds = []; }
    const feeds = [], opposes = [];
    for (const f of FORCES) {
      const F = C.forces[f];
      if ((F.kinds || []).includes(kind) || guilds.some((g) => (F.feeders || []).includes(g))) feeds.push(f);
      else if (guilds.some((g) => (F.opposers || []).includes(g))) opposes.push(f);
    }
    return { feeds, opposes };
  };
  const gmMode = (a) => { const m = get(a, 'ff_adminModes', null); return !!m && Object.values(typeof m === 'object' ? m : {}).some(Boolean); };

  // Claimed homes by their owner's character, with the hold each door stands in (re-read hourly: claims change slowly)
  const homes = () => {
    if (S.homes && Date.now() - S.homesAt < 3600000) return S.homes;
    S.homes = new Map(); S.homesAt = Date.now();
    let ids = [];
    try { const v = JSON.parse(fs.readFileSync(path.resolve('housing.json'), 'utf8')); if (Array.isArray(v)) ids = v.map((x) => Number(x) >>> 0); } catch (e) { /* none */ }
    for (const ref of new Set(ids)) {
      const rec = get(ref, 'private.housing', null);
      const char = rec && Number(rec.owner) > 0 ? Number(rec.ownerChar) >>> 0 : 0;
      const zone = char ? zoneHere(ref) : null;
      if (!zone) continue;
      if (!S.homes.has(char)) S.homes.set(char, new Set());
      S.homes.get(char).add(zone);
    }
    return S.homes;
  };

  const stageOf = (p, was) => {
    const th = C.thresholds;
    let s = 0;
    for (let i = 0; i < th.length; i++) if (p >= th[i]) s = i + 1;
    // hysteresis: a stage is only left once the pressure is `hysteresis` below where it starts
    if (s < was && p >= th[was - 1] - C.hysteresis) s = was;
    return s;
  };

  const sample = () => {
    if (!C.enabled) return;
    const feed = new Map(), oppose = new Map();   // `${zone}|${force}` -> points
    const add = (m, zone, f, n) => { const k = `${zone}|${f}`; m.set(k, (m.get(k) || 0) + n); };
    const seen = new Set();
    for (const a of onlineActors()) {
      const prof = profileOf(a);
      if (!(prof >= 0) || seen.has(prof) || gmMode(a)) continue;
      seen.add(prof);
      const zone = zoneHere(a);
      const { feeds, opposes } = sidesOf(a);
      if (zone) { for (const f of feeds) add(feed, zone, f, 1); for (const f of opposes) add(oppose, zone, f, 1); }
      for (const hz of homes().get(a >>> 0) || []) for (const f of feeds) add(feed, hz, f, C.homePoints);
    }
    for (const [k, n] of S.deeds) { const [zone, f, side] = k.split('|'); add(side === 'oppose' ? oppose : feed, zone, f, n); }
    S.deeds.clear();
    const keys = new Set([...feed.keys(), ...oppose.keys()]);
    for (const [zone, h] of Object.entries(data().holds)) for (const f of Object.keys(h)) keys.add(`${zone}|${f}`);
    for (const k of keys) {
      const [zone, f] = k.split('|');
      if (!C.forces[f]) continue;
      const c = cell(zone, f), fd = feed.get(k) || 0, op = oppose.get(k) || 0;
      c.p = Math.max(0, Math.min(100, Math.round((c.p * C.decay + (fd - op) * C.gain) * 100) / 100));
      c.feed = fd; c.oppose = op;
      const s = stageOf(c.p, c.stage);
      if (s !== c.stage) log(`consequences: ${C.forces[f].name} in ${places.get(zone) || zone} ${s > c.stage ? 'rises' : 'falls'} to ${C.forces[f].stages[s]} (pressure ${c.p})`);
      c.stage = s;
      if (c.p === 0 && !fd && !op) delete data().holds[zone][f];
    }
    try { phase2(Date.now()); } catch (e) { log('consequences: phase 2 failed this sample', e.stack || e.message); }
    data().at = new Date().toISOString();
    save();
  };
  if (typeof every === 'function') every('consequences', Math.max(1, Number(C.sampleMinutes) || 10) * 60000, () => { try { sample(); } catch (e) { log('consequences: sample failed', e.stack || e.message); } });

  // A player's kill of a force's creature opposes it in the hold where it fell (gamemode.js deathHook)
  const edidOf = (id) => {
    let desc = ''; try { desc = String(mp.get(id, 'baseDesc') || ''); } catch (e) { return ''; }
    if (S.edid.has(desc)) return S.edid.get(desc);
    let e = ''; try { const r = mp.lookupEspmRecordById(mp.getIdFromDesc(desc) >>> 0); e = String((r && r.record && r.record.editorId) || ''); } catch (err) { e = ''; }
    S.edid.set(desc, e); return e;
  };
  globalThis.__dboConsequenceDeath = (victim, killer) => {
    if (!C.enabled || !killer || !(profileOf(killer) >= 0)) return;
    if (profileOf(victim) >= 0) { writPlayerKill(victim, killer); return; }
    const edid = edidOf(victim);
    if (!edid) return;
    const zone = zoneHere(victim) || zoneHere(killer);
    if (!zone) return;
    writKill(zone, edid, killer);
    const day = new Date().toISOString().slice(0, 10), K = data().kills;
    if (K.day !== day) { K.day = day; K.by = {}; }
    const prof = String(profileOf(killer));
    for (const f of FORCES) {
      if (!new RegExp(C.forces[f].creatures, 'i').test(edid)) continue;
      if ((K.by[prof] || 0) >= C.killCapPerDay) return;
      K.by[prof] = (K.by[prof] || 0) + 1;
      const k = `${zone}|${f}|oppose`; S.deeds.set(k, (S.deeds.get(k) || 0) + C.killPoints);
      return;
    }
  };
  // Other modules report a deed (feeding, a prayer) the same way once phase 2 wires them
  globalThis.__dboConsequenceDeed = (zone, force, side, points) => {
    if (!C.enabled || !places.has(zone) || !C.forces[force]) return;
    const k = `${zone}|${force}|${side === 'oppose' ? 'oppose' : 'feed'}`; S.deeds.set(k, (S.deeds.get(k) || 0) + (Number(points) || 0));
  };

  // ---- phase 2: the world answers a hold that harbours the supernatural ----------------------------------------------
  const DAY = 86400000;
  const p2 = () => data().p2;
  const call = (name, ...args) => { try { const f = globalThis[name]; return typeof f === 'function' ? f(...args) : undefined; } catch (e) { log(`consequences: ${name} failed`, e.message); return undefined; } };
  const holdName = (zone) => places.get(zone) || zone;
  const pressureOf = (zone, f) => { const c = (data().holds[zone] || {})[f]; return c ? Number(c.p) || 0 : 0; };
  // A hold's harbouring: the higher of its supernatural forces' pressures
  const harbouring = (zone) => Math.max(0, ...(P2.harbour || []).filter((f) => C.forces[f]).map((f) => pressureOf(zone, f)));
  // Entered at `at`, left only `hysteresis` below it, as phase 1's stages
  const holds = (on, p, at) => (on ? p >= at - C.hysteresis : p >= at);
  const factionName = (fid) => { const g = call('__dboGuildInfo', fid); return (g && g.name) || fid; };
  const hunterOf = (a) => {
    const mine = new Set((call('__dboGuildsOf', a) || []).map((g) => String(g.id)));
    return (P2.writs.factions || []).find((fid) => mine.has(fid)) || '';
  };
  const hunters = () => onlineActors().filter((a) => !!hunterOf(a));
  const writHunters = () => (P2.writs.factions || []).map(factionName).join(', ').replace(/, ([^,]*)$/, ' and $1');
  const writText = (zone, f) => `${writHunters()} hold an open writ in ${holdName(zone)} against ${f === 'hunt' ? 'the werewolves' : 'the vampires'}: ${P2.writs.bounty[f] || 0} gold for each one slain there, paid to their members.`;
  const censureText = (zone) => `The other courts of the realm censure ${holdName(zone)} for harbouring the creatures of the night. Its trade is shunned, and ${Math.round((Number(P2.pressure.censure) || 0) * 100)}% of its tax income goes unpaid at each reckoning until the hold is cleansed.`;

  // Called after a court action has already succeeded (an appointment, a wage), so it never throws into the caller
  const stampCourt = (zone, kind) => {
    if (!places.has(zone)) return;
    try {
      p2().court[zone] = Date.now();
      save();
      log(`consequences: court business in ${holdName(zone)} (${kind || 'business'})`);
    } catch (e) { log('consequences: court stamp failed', e.message); }
  };
  // The court's business, stamped where it succeeds: by the hold, by the hold's faction, or by an official's seats
  globalThis.__dboCourtBusiness = (zone, kind) => { if (C.enabled) stampCourt(String(zone || ''), kind); };
  globalThis.__dboCourtBusinessFaction = (fid, kind) => {
    if (!C.enabled) return;
    for (const zone of places.keys()) if (call('__dboHoldFactionOf', zone) === String(fid)) stampCourt(zone, kind);
  };
  globalThis.__dboCourtBusinessBy = (a, kind) => {
    if (!C.enabled) return;
    const pid = Number(profileOf(a)); if (!(pid >= 0)) return;
    const o = readOfficials() || {};
    for (const zone of places.keys()) {
      const seated = Object.entries(o[zone] || {}).some(([office, list]) => {
        if (!(list || []).map(Number).includes(pid)) return false;
        // a seat bound to another character of the account is not this one's
        const held = Number(call('__dboSeatHolder', zone, office, pid)) >>> 0;
        return !held || held === (a >>> 0);
      });
      if (seated) stampCourt(zone, kind);
    }
  };

  // Unrest: what a rising's petition thresholds are cut by in this hold (rebellion.js), with its stability
  const unrestOf = (zone) => {
    const U = P2.unrest, h = harbouring(zone);
    const stability = Math.round(100 - h);
    if (!C.enabled || !U.enabled || h < U.at) return { stability, cut: 0 };
    const span = Math.max(1, Number(U.full) - Number(U.at));
    return { stability, cut: Math.round(Math.min(1, (h - U.at) / span) * (Number(U.maxCut) || 0) * 100) / 100 };
  };
  globalThis.__dboHoldUnrest = (zone) => unrestOf(String(zone || ''));
  // The share of a hold faction's weekly tax income the other courts withhold (economy.js)
  globalThis.__dboHoldCensureShare = (fid) => {
    if (!C.enabled || !P2.pressure.enabled) return 0;
    for (const zone of Object.keys(p2().censure)) if (call('__dboHoldFactionOf', zone) === String(fid)) return Math.max(0, Math.min(1, Number(P2.pressure.censure) || 0));
    return 0;
  };
  // What a notice board of the hold carries: each open writ and the censure
  globalThis.__dboConsequenceBoardLines = (zone) => {
    if (!C.enabled) return [];
    const out = [];
    if (P2.writs.enabled) for (const f of Object.keys(p2().writs[zone] || {})) out.push(writText(zone, f));
    if (P2.pressure.enabled && p2().censure[zone]) out.push(censureText(zone));
    return out;
  };

  const writs = (now) => {
    const W = P2.writs;
    for (const zone of places.keys()) {
      const open = p2().writs[zone] || {};
      for (const f of P2.harbour || []) {
        if (!C.forces[f]) continue;
        const want = !!W.enabled && holds(!!open[f], pressureOf(zone, f), Number(W.at));
        if (want === !!open[f]) continue;
        if (want) open[f] = now; else delete open[f];
        const text = want ? writText(zone, f) : `${writHunters()} close their writ against ${f === 'hunt' ? 'the werewolves' : 'the vampires'} in ${holdName(zone)}: the hold is quieter.`;
        for (const a of hunters()) personal(a, `Word from your order: ${text}`);
        if (want) call('__dboCitizenCourtNotice', zone, `${writHunters()} have come to ${holdName(zone)} with an open writ: the hold harbours ${f === 'hunt' ? 'werewolves' : 'vampires'}.`);
        log(`consequences: writ against ${C.forces[f].name} in ${holdName(zone)} ${want ? 'opened' : 'closed'} (pressure ${pressureOf(zone, f)})`);
      }
      if (Object.keys(open).length) p2().writs[zone] = open; else delete p2().writs[zone];
    }
  };
  const censure = (now) => {
    const Q = P2.pressure;
    for (const zone of places.keys()) {
      const on = !!p2().censure[zone];
      const want = !!Q.enabled && holds(on, harbouring(zone), Number(Q.at));
      if (want === on) continue;
      if (want) p2().censure[zone] = now; else delete p2().censure[zone];
      call('__dboCitizenCourtNotice', zone, want ? censureText(zone) : `The other courts lift their censure of ${holdName(zone)}: its trade and taxes are its own again.`);
      log(`consequences: censure of ${holdName(zone)} ${want ? 'begins' : 'lifted'} (harbouring ${harbouring(zone)})`);
    }
  };
  // A court that does no business: the ruler is warned, then the hold calls a vote of no confidence
  const idleRulers = (now) => {
    const R = P2.idleRuler, d = p2(), o = readOfficials() || {};
    for (const [zone, office] of rulerOffice) {
      const ruled = ((o[zone] || {})[office] || []).length > 0;
      if (!R.enabled || !ruled) { for (const k of ['court', 'warned', 'called', 'blocked']) delete d[k][zone]; continue; }
      // A ruler the clock has not seen yet starts with a full term from now
      if (!(Number(d.court[zone]) > 0)) d.court[zone] = now;
      const last = Number(d.court[zone]), idle = now - last, days = Math.max(1, Number(R.days) || 7);
      const warnAt = Math.max(0, days - (Number(R.warnDays) || 0)) * DAY;
      if (idle >= days * DAY) {
        const r = call('__dboCitizenNoConfidence', zone, `a vote of no confidence: the court did no business for ${days} days`) || { error: 'citizenship is not loaded' };
        if (r.error) {
          if (d.blocked[zone] !== r.error) log(`consequences: ${holdName(zone)} cannot call a vote of no confidence yet: ${r.error}`);
          d.blocked[zone] = r.error;
          continue;
        }
        // the vote is the hold's answer; its clock starts again from the call, so it is called once
        d.called[zone] = now; delete d.blocked[zone];
        d.court[zone] = now;
        call('__dboCitizenCourtNotice', zone, `The people of ${holdName(zone)} have called a vote of no confidence: the court has done no business for ${days} days. Registration for a new court is open.`);
        audit(`CONSEQUENCES ${holdName(zone)}: a vote of no confidence called after ${days} days without court business`);
      } else if (idle >= warnAt && idle < days * DAY && d.warned[zone] !== last) {
        if ((call('__dboCitizenNoConfidence', zone, '', true) || { error: 'no' }).error) continue;
        d.warned[zone] = last;
        const left = Math.max(1, Math.ceil((days * DAY - idle) / DAY));
        call('__dboCitizenCourtNotice', zone, `The people of ${holdName(zone)} grow restless: the court has done no business for ${Math.floor(idle / DAY)} days. In ${left} day${left === 1 ? '' : 's'} without it, they will call a vote of no confidence.`);
        log(`consequences: ${holdName(zone)}'s ruler warned after ${Math.floor(idle / DAY)} days without court business`);
      }
    }
  };
  const phase2 = (now) => {
    if (!C.enabled) return;
    writs(now);
    censure(now);
    idleRulers(now);
  };

  // A hunter's kill of a writ's quarry in its hold is paid, writs.capPerDay a hunter a day
  const payBounty = (killer, zone, f, gold, what) => {
    const W = P2.writs, B = p2().bounty, day = new Date().toISOString().slice(0, 10);
    if (B.day !== day) { B.day = day; B.by = {}; }
    const prof = String(profileOf(killer));
    if ((B.by[prof] || 0) >= W.capPerDay || !(gold > 0) || !giveItem) return false;
    B.by[prof] = (B.by[prof] || 0) + 1;
    giveItem(killer, 0x0000000f, gold);
    personal(killer, `The writ in ${holdName(zone)} pays ${gold} gold for ${what}.`);
    log(`consequences: writ bounty of ${gold} gold to ${prof} in ${holdName(zone)} (${C.forces[f].name})`);
    return true;
  };
  const writKill = (zone, edid, killer) => {
    const W = P2.writs;
    if (!W.enabled || !hunterOf(killer)) return;
    for (const f of Object.keys(p2().writs[zone] || {})) {
      if (!W.creatures[f] || !new RegExp(W.creatures[f], 'i').test(edid)) continue;
      payBounty(killer, zone, f, Number(W.bounty[f]) || 0, f === 'hunt' ? 'the werewolf' : 'the vampire');
      return;
    }
  };
  const writPlayerKill = (victim, killer) => {
    const W = P2.writs;
    if (!W.enabled || !W.players || !hunterOf(killer)) return;
    const zone = zoneHere(victim); if (!zone) return;
    const kind = String((get(victim, 'private.supernatural', {}) || {}).kind || '');
    for (const f of Object.keys(p2().writs[zone] || {})) {
      if (!(C.forces[f].kinds || []).includes(kind)) continue;
      payBounty(killer, zone, f, Number(W.playerBounty) || 0, `a ${kind} slain`);
      return;
    }
  };

  const partsOn = () => ['writs', 'unrest', 'pressure', 'idleRuler'].filter((k) => P2[k].enabled).join(', ');
  // Staff's view of phase 2 in each hold where something stands: writs, stability, censure, the court's idle days
  const phase2Lines = (zoneArg) => {
    const out = [], d = p2(), now = Date.now();
    for (const zone of places.keys()) {
      if (zoneArg && zone !== zoneArg && String(places.get(zone)).toLowerCase() !== zoneArg.toLowerCase()) continue;
      const bits = [];
      const w = Object.keys(d.writs[zone] || {}).map((f) => C.forces[f].name);
      if (w.length) bits.push(`writs against ${w.join(' and ')}`);
      const u = unrestOf(zone);
      if (harbouring(zone) >= Number(P2.unrest.at)) bits.push(`stability ${u.stability}${u.cut ? `, petitions need ${Math.round(u.cut * 100)}% fewer` : ''}`);
      if (d.censure[zone]) bits.push('censured by the courts');
      if (Number(d.court[zone]) > 0) bits.push(`court idle ${Math.floor((now - Number(d.court[zone])) / DAY)} of ${P2.idleRuler.days} days${d.blocked[zone] ? ` (no vote: ${d.blocked[zone]})` : ''}`);
      if (bits.length) out.push(`${holdName(zone)}: ${bits.join('; ')}`);
    }
    return out;
  };
  const readout = (zoneArg) => {
    const rows = [];
    for (const [zone, h] of Object.entries(data().holds)) {
      if (zoneArg && zone !== zoneArg && String(places.get(zone) || '').toLowerCase() !== zoneArg.toLowerCase()) continue;
      for (const [f, c] of Object.entries(h)) if (C.forces[f]) rows.push({ zone, f, c });
    }
    rows.sort((x, y) => y.c.p - x.c.p);
    return rows;
  };
  registerChatCommand('consequences', (a, args) => {
    const words = String(args || '').trim().split(/\s+/).filter(Boolean);
    const sub = (words[0] || '').toLowerCase();
    if (sub === 'set' || sub === 'reset') {
      const [zone, f, n] = [words[1], words[2], Number(words[3])];
      if (!places.has(zone) || !C.forces[f]) return personal(a, `Use /consequences ${sub} <zone id> <${FORCES.join('|')}>${sub === 'set' ? ' <0-100>' : ''}.`);
      const c = cell(zone, f);
      c.p = sub === 'reset' ? 0 : Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
      c.stage = stageOf(c.p, 0); save();
      log(`consequences: ${C.forces[f].name} in ${places.get(zone)} set to ${c.p} by staff`);
      return personal(a, `${C.forces[f].name} in ${places.get(zone)}: pressure ${c.p}, ${C.forces[f].stages[c.stage]}.`);
    }
    if (sub === 'sample') { sample(); return personal(a, 'Sampled now.'); }
    const rows = readout(words[0]);
    personal(a, `Dynamic Consequences. Last sample ${data().at || 'not yet'}. Phase 2: ${partsOn() || 'every part off'}.`);
    for (const line of phase2Lines(words[0])) personal(a, line);
    if (!rows.length) return personal(a, words[0] ? `Nothing measured in ${words[0]}.` : 'Every hold is calm.');
    for (const { zone, f, c } of rows.slice(0, 15)) personal(a, `${places.get(zone) || zone}: ${C.forces[f].name} ${c.p} (${C.forces[f].stages[c.stage]}); last sample +${c.feed} / -${c.oppose}`);
  }, { admin: true, help: '[zone] Dynamic Consequences pressure by hold (staff); set|reset <zone> <force> [n]; sample' });

  log(`consequences on: ${FORCES.length} forces, a sample every ${C.sampleMinutes} min, ${places.size} zones; phase 2: ${partsOn() || 'every part off'}`);
  return { _test: { sample, data, sidesOf, stageOf, homes, C, P2, harbouring, unrestOf, phase2 } };
};
