// DragonBreak Online: Dynamic Consequences, phase 1 (Nat, 31 Oct; design _work\dynamic-consequences-1031.md on the PC).
// The world answers what players do: per hold, a pressure for each force (the Blight, the Dragon Cult, the Hunt) rises
// with the players who feed it there and falls with those who oppose it. Phase 1 only measures: no spawn, boss, weather
// or notice changes. Staff read it with /consequences. Loaded by gamemode.js on every hot reload.
//
// Every sampleMinutes: each online account counts 1 point to each force it feeds or opposes in the hold it stands in
// (supernatural kind, factions); an owner online whose claimed home stands in a hold adds homePoints there. Kills of a
// force's creatures by a player (deathHook) oppose it, at most killCapPerDay a player a day. Then
//   P = P * decay + (feed - oppose) * gain, clamped to 0..100; stages at the thresholds, left `hysteresis` below them.
// consequences.json beside the world state: { at, holds: { zone: { force: { p, stage, feed, oppose } } }, kills }
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
};

module.exports = (api) => {
  const { mp, log, personal, registerChatCommand, onlineActors, every, profileOf, zoneOfActor, isAdmin, cfg } = api;
  const raw = (cfg || {}).consequences || {};
  const C = Object.assign({}, DEFAULTS, raw, { forces: Object.assign({}, DEFAULTS.forces, raw.forces || {}) });
  const FORCES = Object.keys(C.forces);
  const get = (ref, key, dflt) => { try { const v = mp.get(ref, key); return v === undefined || v === null ? dflt : v; } catch (e) { return dflt; } };
  const S = globalThis.__dboConsequences || (globalThis.__dboConsequences = { data: null, homes: null, homesAt: 0, edid: new Map(), deeds: new Map() });

  const zones = (() => { try { return JSON.parse(fs.readFileSync(path.resolve('zones.json'), 'utf8')); } catch (e) { return {}; } })();
  const places = new Map([].concat(zones.holds || [], zones.regions || []).map((z) => [z.id, z.name || z.id]));
  const zoneHere = (ref) => { try { const z = zoneOfActor(ref); return z && places.has(z) ? z : null; } catch (e) { return null; } };

  const stateDir = () => { try { return path.dirname(fs.realpathSync(path.resolve('world'))); } catch (e) { return path.resolve('.'); } };
  const FILE = path.join(stateDir(), 'consequences.json');
  const data = () => {
    if (S.data) return S.data;
    try { S.data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { S.data = null; }
    if (!S.data || typeof S.data !== 'object') S.data = {};
    S.data.holds = S.data.holds || {}; S.data.kills = S.data.kills || { day: '', by: {} };
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
    if (!C.enabled || !killer || !(profileOf(killer) >= 0) || profileOf(victim) >= 0) return;
    const edid = edidOf(victim);
    if (!edid) return;
    const zone = zoneHere(victim) || zoneHere(killer);
    if (!zone) return;
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
    personal(a, `Dynamic Consequences (phase 1: measured only, nothing in the world changes). Last sample ${data().at || 'not yet'}.`);
    if (!rows.length) return personal(a, words[0] ? `Nothing measured in ${words[0]}.` : 'Every hold is calm.');
    for (const { zone, f, c } of rows.slice(0, 15)) personal(a, `${places.get(zone) || zone}: ${C.forces[f].name} ${c.p} (${C.forces[f].stages[c.stage]}); last sample +${c.feed} / -${c.oppose}`);
  }, { admin: true, help: '[zone] Dynamic Consequences pressure by hold (staff); set|reset <zone> <force> [n]; sample' });

  log(`consequences on (phase 1, measure only): ${FORCES.length} forces, a sample every ${C.sampleMinutes} min, ${places.size} zones`);
  return { _test: { sample, data, sidesOf, stageOf, homes, C } };
};
