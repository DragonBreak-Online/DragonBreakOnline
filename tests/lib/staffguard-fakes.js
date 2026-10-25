// Shared fakes for the staff-rule harnesses (staffguard.js): a cast of staff and players, a fake mp and the api gamemode.js
// gives the module, and the GM call state gmcall.js keeps on globalThis.
'use strict';
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MOD = path.join(ROOT, 'staffguard.js');

// tier: the admin tier (tierOf); trial: a Trial GM (staffTierOf 'trialgm'); staff: private.dboStaffChar
const CAST = {
  OWNER: { id: 0x10, name: 'Jake', tag: 'JAKE', profile: 1, tier: 'senior' },
  OWNER_RP: { id: 0x11, name: 'Jarl Jake', tag: 'JRP1', profile: 1, tier: 'senior' },
  LEAD: { id: 0x20, name: 'GM Leda', tag: 'LEAD', profile: 20, tier: 'leadgm', staff: true },
  LEAD_RP: { id: 0x21, name: 'Leda the Bold', tag: 'LDRP', profile: 20, tier: 'leadgm' },
  LEAD2: { id: 0x22, name: 'GM Lars', tag: 'LAR2', profile: 22, tier: 'leadgm', staff: true },
  GM: { id: 0x30, name: 'GM Gemma', tag: 'GEMM', profile: 30, tier: 'gm', staff: true },
  GM_RP: { id: 0x31, name: 'Katell', tag: 'KATE', profile: 30, tier: 'gm' },
  GM2: { id: 0x32, name: 'GM Gus', tag: 'GUS2', profile: 32, tier: 'gm', staff: true },
  TRIAL: { id: 0x40, name: 'Helps', tag: '38XK', profile: 40, trial: true, staff: true },
  TRIAL_RP: { id: 0x41, name: 'Neravos', tag: '7CUR', profile: 40, trial: true },
  MIRA: { id: 0x50, name: 'Mira', tag: 'MIRA', profile: 50 },
  MIRA_ALT: { id: 0x51, name: 'Mirabel', tag: 'MIR2', profile: 50, online: false },
  BOB: { id: 0x60, name: 'Bob', tag: 'BOBB', profile: 60 },
};

const make = (cfg) => {
  const byId = new Map(Object.values(CAST).map((c) => [c.id, Object.assign({ online: true }, c)]));
  const props = new Map();
  for (const c of byId.values()) if (c.staff) props.set(`${c.id}|private.dboStaffChar`, true);
  const said = [], audits = [], logs = [];
  const commands = new Map();
  const mp = {
    get: (id, k) => { if (!byId.has(id >>> 0)) throw new Error('no such form'); return props.get(`${id >>> 0}|${k}`); },
    set: (id, k, v) => { if (!byId.has(id >>> 0)) throw new Error('no such form'); props.set(`${id >>> 0}|${k}`, v); },
  };
  const c = (a) => byId.get(a >>> 0) || {};
  const RANK = { senior: 4, developer: 3, leadgm: 2, gm: 1, trialgm: 0.5 };
  const api = {
    mp, cfg: { staffPowers: cfg || {} },
    log: (...x) => logs.push(x.join(' ')),
    audit: (t) => audits.push(String(t)),
    who: (a) => `${c(a).name} #${c(a).tag} (profile ${c(a).profile})`,
    display: (a) => `${c(a).name} #${c(a).tag}`,
    personal: (a, t) => said.push({ a: a >>> 0, t: String(t) }),
    profileOf: (a) => (byId.has(a >>> 0) ? c(a).profile : -1),
    tierOf: (a) => c(a).tier || null,
    staffTierOf: (a) => c(a).tier || (c(a).trial ? 'trialgm' : null),
    isLeadStaff: (a) => ['senior', 'developer', 'leadgm'].includes(c(a).tier),
    staffCharOf: (a) => props.get(`${a >>> 0}|private.dboStaffChar`) === true,
    accountRankOf: (pid) => { let best = 0; for (const x of byId.values()) if (x.profile === pid) best = Math.max(best, RANK[x.tier || (x.trial ? 'trialgm' : '')] || 0); return best; },
    findByName: (q) => { const s = String(q || '').trim().toLowerCase().replace(/^#/, ''); if (!s) return 0; for (const x of byId.values()) if (x.online && (x.tag.toLowerCase() === s || x.name.toLowerCase() === s)) return x.id; return 0; },
    offlineByTag: (q) => { const m = String(q || '').match(/#([A-Za-z0-9]{4})$/); if (!m) return 0; for (const x of byId.values()) if (!x.online && x.tag.toLowerCase() === m[1].toLowerCase()) return x.id; return 0; },
    // gamemode.js rankRefusalOf over this cast (tests/staff-rank-harness.js runs the real one): the panel's ban rule (25 Oct)
    rankRefusal: (a, t) => {
      if (!byId.has(t >>> 0)) return 'unknown';
      const pt = c(t).profile; if (pt === c(a).profile) return 'own';
      return api.accountRankOf(pt) >= (RANK[c(a).tier || (c(a).trial ? 'trialgm' : '')] || 0) ? 'rank' : null;
    },
    registerChatCommand: (n, fn, opts) => commands.set(n, { fn, opts: opts || {} }),
    onlineActors: () => [...byId.values()].filter((x) => x.online).map((x) => x.id),
  };
  return { api, props, said, audits, logs, commands, byId };
};

// Loads staffguard.js afresh (a hot reload) with this config; globalThis state survives as on the server unless reset
const load = (cfg, opts) => {
  if (!opts || opts.reset !== false) { delete globalThis.__dboStaffGuardState; delete globalThis.__dboGmCalls; }
  const f = make(cfg);
  delete require.cache[MOD];
  f.G = require(MOD)(f.api);
  f.run = (a, line) => { const i = line.indexOf(' '); const name = i < 0 ? line : line.slice(0, i); f.said.length = 0; f.commands.get(name).fn(a, i < 0 ? '' : line.slice(i + 1)); return f.said.map((x) => x.t).join('\n'); };
  return f;
};
// An open GM call from a player's account, taken (or not) by a staff account
const call = (n, profile, takenByProfile) => {
  const S = globalThis.__dboGmCalls || (globalThis.__dboGmCalls = { counter: 0, open: [], closed: [], quiet: [] });
  const c = { n, profile, name: `caller ${profile}`, takenBy: takenByProfile ? { name: `staff ${takenByProfile}`, profile: takenByProfile, at: 0 } : null };
  S.open.push(c);
  return c;
};

let failures = 0, checks = 0;
const check = (name, ok, got) => { checks++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };
const done = () => { console.log(failures ? `\n${failures} of ${checks} FAILED` : `\nall ${checks} passed`); process.exit(failures ? 1 : 0); };

module.exports = { ROOT, MOD, CAST, load, call, check, done };
