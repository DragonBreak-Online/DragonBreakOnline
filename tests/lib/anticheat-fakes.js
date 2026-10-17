// Fakes for the anticheat harnesses (tests/anticheat-*-harness.js): an mp with Map-backed properties and counted record
// lookups, plugin records built from their fields (SPEL, MGEF, ENCH, ARMO, NPC_, RACE), the gamemode api anticheat.js is
// handed (names, tags, staff tiers, staffSay, personal, audit, commands), a manual clock and a manual every(). Nothing here
// touches the disk, the network or a real timer.
'use strict';
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MODULE = path.join(ROOT, 'anticheat.js');

const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const bytes = (size, writes) => {
  const b = new Uint8Array(size); const v = new DataView(b.buffer);
  for (const [off, kind, val] of writes) { if (kind === 'f') v.setFloat32(off, val, true); else v.setUint32(off, val >>> 0, true); }
  return b;
};

const makeWorld = () => {
  const props = new Map();
  const records = new Map();
  const S = { lookups: new Map(), lookupsTotal: 0, gets: 0, sets: [] };
  const mp = {
    get(id, k) {
      S.gets++;
      const m = props.get(id >>> 0);
      const v = m ? m.get(k) : undefined;
      if (typeof v === 'function') return v();
      return Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
    },
    set(id, k, v) { S.sets.push([id >>> 0, k, v]); let m = props.get(id >>> 0); if (!m) props.set(id >>> 0, m = new Map()); m.set(k, v); },
    lookupEspmRecordById(id) {
      S.lookupsTotal++; S.lookups.set(id >>> 0, (S.lookups.get(id >>> 0) || 0) + 1);
      const r = records.get(id >>> 0);
      return r ? { record: r, toGlobalRecordId: (x) => x >>> 0 } : null;
    },
    getIdFromDesc(d) { const s = String(d); const i = s.indexOf(':'); return parseInt(i < 0 ? s : s.slice(0, i), 16) >>> 0; },
    getDescFromId(id) { return `${(id >>> 0).toString(16)}:Skyrim.esm`; },
  };
  const record = (id, type, editorId, fields) => { records.set(id >>> 0, { type, editorId, fields: fields || [] }); return id >>> 0; };
  // a magic effect: school (18-22), archetype (0 value modifier), actor value, base cost
  const mgef = (id, editorId, o) => record(id, 'MGEF', editorId, [{ type: 'DATA', data: bytes(0x98, [[4, 'f', (o && o.baseCost) || 1], [0x0c, 'u', (o && o.school) === undefined ? -1 : o.school], [0x40, 'u', (o && o.archetype) || 0], [0x44, 'u', (o && o.av) === undefined ? 0xffffffff : o.av]]) }]);
  // a spell: SPIT cost, type, castType (2 concentration), one effect
  const spell = (id, editorId, o) => {
    const x = Object.assign({ cost: 50, type: 0, castType: 1, school: 20, effect: 0 }, o || {});
    const eff = x.effect || (id + 0x100000);
    if (!records.has(eff)) mgef(eff, `${editorId}Effect`, { school: x.school, baseCost: 1 });
    return record(id, 'SPEL', editorId, [{ type: 'SPIT', data: bytes(36, [[0, 'u', x.cost], [8, 'u', x.type], [12, 'f', 0.5], [16, 'u', x.castType]]) },
      { type: 'EFID', data: u32(eff) }, { type: 'EFIT', data: bytes(12, [[0, 'f', 10], [8, 'u', 0]]) }]);
  };
  const ench = (id, editorId, effects) => record(id, 'ENCH', editorId, effects.map((e) => ({ type: 'EFID', data: u32(e) })));
  const armo = (id, editorId, enchId) => record(id, 'ARMO', editorId, enchId ? [{ type: 'EITM', data: u32(enchId) }] : []);
  const npcBase = (id, editorId, raceId) => record(id, 'NPC_', editorId, [{ type: 'RNAM', data: u32(raceId) }]);
  const race = (id, editorId) => record(id, 'RACE', editorId, []);
  const set = (id, k, v) => { let m = props.get(id >>> 0); if (!m) props.set(id >>> 0, m = new Map()); m.set(k, v); };
  return { mp, props, records, S, record, mgef, spell, ench, armo, npcBase, race, set };
};

// The gamemode's api for anticheat.js, over a world. players: actorId -> { name, tag, profile, tier ('senior'|'leadgm'|'gm'|
// 'trialgm'|null), staffChar }
const makeApi = (W, o) => {
  const opts = o || {};
  const clock = { t: opts.t0 || Date.UTC(2026, 9, 17, 12, 0, 0) };
  clock.now = () => clock.t;
  const players = new Map();
  const logs = [], staff = [], told = [], audits = [], commands = new Map(), timers = new Map();
  const ADMIN = new Set(['senior', 'developer', 'leadgm', 'gm']);
  const api = {
    mp: W.mp,
    cfg: { anticheat: opts.anticheat || {} },
    clock,
    log: (...a) => logs.push(a.map(String).join(' ')),
    every: (name, ms, fn) => timers.set(name, { ms, fn }),
    onlineActors: () => [...players.keys()].filter((a) => players.get(a).online !== false),
    display: (a) => { const p = players.get(a >>> 0); return p ? `${p.name} #${p.tag}` : 'Stranger #????'; },
    tagOf: (a) => { const p = players.get(a >>> 0); return p ? p.tag : '????'; },
    profileOf: (a) => { const p = players.get(a >>> 0); return p ? p.profile : -1; },
    tierOf: (a) => { const p = players.get(a >>> 0); return p && ADMIN.has(p.tier) ? p.tier : null; },
    staffTierOf: (a) => { const p = players.get(a >>> 0); return p && p.tier ? p.tier : null; },
    staffCharOf: (a) => { const p = players.get(a >>> 0); return !!(p && p.staffChar); },
    isLeadStaff: (a) => { const p = players.get(a >>> 0); return !!p && ['senior', 'developer', 'leadgm'].includes(p.tier); },
    staffSay: (a, text) => staff.push([a >>> 0, String(text)]),
    personal: (a, text) => told.push([a >>> 0, String(text)]),
    audit: (text) => audits.push(String(text)),
    registerChatCommand: (name, fn, ro) => commands.set(name, { fn, admin: !!(ro && ro.admin) }),
    findByName: (q) => { const m = String(q || '').trim().match(/#([A-Za-z0-9]{4})$/); if (!m) return 0; for (const [a, p] of players) if (p.tag.toLowerCase() === m[1].toLowerCase()) return a; return 0; },
    recordOf: (id) => { const r = W.mp.lookupEspmRecordById(id >>> 0); return r && r.record ? r : null; },
    TIER_RANK: { senior: 4, developer: 3, leadgm: 2, gm: 1, trialgm: 0.5 },
  };
  const addPlayer = (a, p) => {
    players.set(a >>> 0, Object.assign({ name: 'Rowan', tag: 'PGDB', profile: 1, tier: null, staffChar: false }, p || {}));
    W.set(a, 'profileId', players.get(a >>> 0).profile);
    if (!W.props.get(a >>> 0) || !W.props.get(a >>> 0).has('percentages')) W.set(a, 'percentages', { health: 1, magicka: 1, stamina: 1 });
    if (!W.props.get(a >>> 0).has('worldOrCellDesc')) W.set(a, 'worldOrCellDesc', 'a764b:BSHeartland.esm');
    if (!W.props.get(a >>> 0).has('pos')) W.set(a, 'pos', [0, 0, 0]);
    return a >>> 0;
  };
  const run = (name, n) => { for (let i = 0; i < (n || 1); i++) { const t = timers.get(name); if (t) t.fn(); } };
  // one tick of the 1 s timer after moving the clock on by ms (1000 by default)
  const tick = (ms) => { clock.t += ms === undefined ? 1000 : ms; run('acSpeedWatch'); };
  const cmd = (a, line) => { const [name, ...rest] = String(line).replace(/^\//, '').split(' '); const c = commands.get(name); if (!c) throw new Error(`no command ${name}`); return c.fn(a >>> 0, rest.join(' ')); };
  return { api, clock, players, logs, staff, told, audits, commands, timers, addPlayer, run, tick, cmd };
};

// a fresh load of anticheat.js (its require cache entry deleted, as gamemode.js does); fresh: forget the state kept on globalThis
const load = (api, fresh) => {
  if (fresh) { delete globalThis.__dboAnticheat; delete globalThis.__dboAnticheatOverride; delete globalThis.__dboPrevAnticheat; }
  delete require.cache[MODULE];
  return require(MODULE)(api);
};

// the gamemode's own handlers on the engine slots, which gamemode.js sets afresh before every load
const baseSlots = (mp, calls) => {
  const c = calls || { cast: 0, hit: 0, eat: 0, act: 0, attempt: 0 };
  mp.onSpellCast = () => { c.cast++; return undefined; };
  mp.onSpellHit = () => { c.hit++; return undefined; };
  mp.onEatItem = () => { c.eat++; return undefined; };
  mp.onActivate = () => { c.act++; return true; };
  mp.onHitDamageAttempt = () => { c.attempt++; return true; };
  return c;
};

const IP_RX = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/;
const LOGGER = '[2026-10-17 12:00:00.000] [console] [info] ';

let failures = 0, checks = 0;
const ok = (c, what, got) => { checks++; console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!c) failures++; };
const done = () => { console.log(failures ? `\n${failures} of ${checks} FAILED` : `\nall ${checks} passed`); process.exit(failures ? 1 : 0); };

module.exports = { ROOT, MODULE, makeWorld, makeApi, load, baseSlots, bytes, u32, IP_RX, LOGGER, ok, done };
