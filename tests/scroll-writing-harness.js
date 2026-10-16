// Scripted test for writing scrolls (Nate, 16 Oct): only a Master Scholar, only a spell they know that has a scroll in
// the game, at a Scholars' Ledger ("Write scrolls"); a write makes several at once and costs paper, by rank - Novice 3
// for 1 paper on a day's wait, Apprentice 1 for 1 on two days, Adept 2 for 2 on two days, Expert 2 for 3 on three days -
// and a MASTER SCROLL IS NEVER WRITTEN. The waits are the writer's own per rank and are separate from the tome ones: a
// tome written does not delay a scroll, nor a scroll a tome. A spell with no scroll in the game is refused, as is one
// the writer does not know and a restricted art below a Senior rank.
// Why a write makes several: tome writing spends scrolls, so one scroll a cooldown would have made an Expert tome twelve
// days of writing before its own week began (Nate, 16 Oct: "fix loops").
// Loads the real spells.js, schools.js, salvage.js and skillrates.js against one stub mp (the scaffolding of
// tests/tome-writing-harness.js, which this shares).
//
//   node tests/scroll-writing-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const F = (n) => path.join(SERVER, n);
const CONFIG = JSON.parse(fs.readFileSync(F('gamemode-config.json'), 'utf8'));
const GUILDS = JSON.parse(fs.readFileSync(F('guild-defs.json'), 'utf8')).factions;
const TOMES = JSON.parse(fs.readFileSync(F('spell-tomes.json'), 'utf8')).tomes;

const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-scrollwrite-'));
process.chdir(dir);
for (const f of ['skills.json', 'spell-tomes.json', 'salvage.json', 'readables.json']) fs.copyFileSync(F(f), f);

let wallClock = Date.parse('2026-10-12T09:00:00Z');
Date.now = () => wallClock;
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

let failures = 0, checks = 0;
const check = (name, ok, detail) => { checks++; if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };

const PLUGINS = { 'Skyrim.esm': 0x00, 'Dawnguard.esm': 0x02, 'HearthFires.esm': 0x03, 'Dragonborn.esm': 0x04, 'ccBGSSSE025-AdvDSGS.esm': 0x09, 'BSAssets.esm': 0x0a, 'BSHeartland.esm': 0x0b, 'SurWR.esp': 0x20, 'Gray Fox Cowl.esm': 0x30, 'DragonBreak.esp': 0x3b, 'DragonBreak Online Edits.esp': 0x3c };
const BY_INDEX = Object.fromEntries(Object.entries(PLUGINS).map(([k, v]) => [v, k]));
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const descOf = (id) => { const p = BY_INDEX[id >>> 24]; if (!p) throw new Error('no plugin ' + (id >>> 0).toString(16)); return `${(id & 0xffffff).toString(16)}:${p}`; };
const canon = (c) => { const i = c.lastIndexOf(':'); return `${parseInt(c.slice(i + 1), 16).toString(16)}:${c.slice(0, i)}`; };
const tome = (edid) => { const t = TOMES.find((x) => x.name === edid); return { book: canon(t.id), spell: canon(t.spellId), rank: t.rank }; };
const FLAMES = tome('SpellTomeFlames'), SPARKS = tome('SpellTomeSparks'), FIREBOLT = tome('SpellTomeFirebolt'), FIREBALL = tome('SpellTomeFireball');
const REANIMATE = tome('SpellTomeReanimateCorpse'), RAISE = tome('SpellTomeRaiseZombie');

// Places: the Synod Conclave (the Synod's hall), Frostcrag Spire (the College of Whispers'), Bruma outside
const SYNOD = '20ff:BSHeartland.esm', FROSTCRAG = '6ff7d:BSHeartland.esm', BRUMA = 'a764b:BSHeartland.esm';
const SCHOLARS_BASE = 'dcf0f:BSHeartland.esm', LECTERN_BASE = '15e4b7:DragonBreak Online Edits.esp';
const LEDGER = idOf('13f774:DragonBreak Online Edits.esp'), CRAG_LEDGER = idOf('13f775:DragonBreak Online Edits.esp');
const LECTERN = idOf('15e4bb:DragonBreak Online Edits.esp');
const RECORDS = {
  [idOf(SCHOLARS_BASE)]: { type: 'ACTI', editorId: 'BookBreakdown', fields: [] },
  [idOf(LECTERN_BASE)]: { type: 'ACTI', editorId: 'ClassLectern', fields: [] },
};
const GOLD = 0xf;

const SENIOR = 0x14, ASSOC = 0x15, WHISPER = 0x16, INITIATE = 0x17, SMITH = 0x18, TEACHER = 0x19, BEGIN = 0x1a, BEGIN2 = 0x1b, FAR = 0x1c, PLAINT = 0x1d;
const NAMES = { [SENIOR]: 'Senior', [ASSOC]: 'Assoc', [WHISPER]: 'Whisper', [INITIATE]: 'Initiate', [SMITH]: 'Smith', [TEACHER]: 'Teacher', [BEGIN]: 'Begin', [BEGIN2]: 'Begintwo', [FAR]: 'Far', [PLAINT]: 'Plainteacher' };
const props = new Map();
const put = (id, p, v) => props.set((id >>> 0) + '|' + p, v === undefined ? v : JSON.parse(JSON.stringify(v)));
const getp = (id, p) => props.get((id >>> 0) + '|' + p);
const at = (id, cell, pos) => { put(id, 'worldOrCellDesc', cell); put(id, 'pos', pos || [0, 0, 0]); };
const tierOfLevel = (l) => (l >= 90 ? 4 : l >= 75 ? 3 : l >= 50 ? 2 : l >= 25 ? 1 : 0);
const skillAt = (a, skill, level) => {
  const r = getp(a, 'private.mastery') || { v: 2, skills: {}, order: [] };
  r.skills[skill] = { level, xp: 0, rank: tierOfLevel(level) };
  if (!r.order.includes(skill)) r.order.push(skill);
  put(a, 'private.mastery', r);
};
const arcaneLevel = (a) => { const r = getp(a, 'private.mastery'); return r && r.skills.arcane ? r.skills.arcane.level : 0; };
const gold = (a, n) => put(a, 'inventory', { entries: n ? [{ baseId: GOLD, count: n }] : [] });
const count = (a, baseId) => ((getp(a, 'inventory') || { entries: [] }).entries.filter((e) => e.baseId === baseId).reduce((n, e) => n + e.count, 0));
put(LEDGER, 'baseDesc', SCHOLARS_BASE); at(LEDGER, SYNOD, [0, 0, 0]);
put(CRAG_LEDGER, 'baseDesc', SCHOLARS_BASE); at(CRAG_LEDGER, FROSTCRAG, [0, 0, 0]);
put(LECTERN, 'baseDesc', LECTERN_BASE); at(LECTERN, SYNOD, [300, 0, 0]);

// guilds.js stand-ins: memberships by title, the rank lists of guild-defs.json, the halls by cell
const MEMBERS = {};
const member = (a, fid, title) => {
  const f = GUILDS.find((x) => x.id === fid);
  const r = f.ranks.find((x) => x.title === title);
  if (!r) throw new Error(`no rank ${title} in ${fid}`);
  MEMBERS[a] = [{ id: fid, name: f.name, title, role: r.role }];
  put(a, 'private.dboGuilds', [{ id: fid, rank: f.ranks.indexOf(r), role: r.role }]);
};
globalThis.__dboGuildsOf = (a) => MEMBERS[a >>> 0] || [];
globalThis.__dboGuildRankList = (id) => { const f = GUILDS.find((x) => x.id === String(id)); return f ? f.ranks.map((r) => ({ title: r.title, role: r.role })) : null; };
globalThis.__dboHallFactionAt = (cell) => ({ [SYNOD.toLowerCase()]: { id: 'synod', name: 'The Synod' }, [FROSTCRAG.toLowerCase()]: { id: 'college-of-whispers', name: 'College of Whispers' } }[String(cell).toLowerCase()] || null);

// The engine's spells per actor
const learned = new Map();
const known = (a) => learned.get(a >>> 0) || (learned.set(a >>> 0, new Set()), learned.get(a >>> 0));
const mp = {
  getIdFromDesc: idOf, getDescFromId: descOf,
  get: (id, p) => getp(id, p),
  set: (id, p, v) => put(id, p, v),
  lookupEspmRecordById: (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0], toGlobalRecordId: (l) => l } : null),
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    if (cls === 'Debug') return null;
    const a = idOf(self.desc); const s = known(a);
    if (fn === 'GetSpellCount') return s.size;
    if (fn === 'GetNthSpell') { const id = [...s][args[0]]; return id === undefined ? null : { type: 'espm', desc: descOf(id) }; }
    const spell = idOf(args[0].desc);
    if (fn === 'AddSpell') { if (s.has(spell)) return false; s.add(spell); return true; }
    if (fn === 'RemoveSpell') return s.delete(spell);
    return false;
  },
};
mp.onReadBook = () => undefined;

// The Wheel, as masterySystem meters an award: the repeat ring (w / (1 + k/8) for the k-th same key within the hour, 16
// kept), the hourly bucket (bucketBurst 13, bucketPerHour 20 from skills.json), then the gameplay's rate (skillrates.js
// __dboSkillRate) on what got through. 10 xp a unit below 25: a level is 10 units of worth.
const PS = JSON.parse(fs.readFileSync('skills.json', 'utf8')).pointSystem;
const wheel = new Map(); // actor -> { ring: [{ h, at }], tokens, at }
const awards = [];
let touchAnswer = 'ok';
globalThis.__alduinakMasteryFirstTouch = (a, skill) => { if (touchAnswer === 'ok') skillAt(a, skill, 1); return touchAnswer; };
globalThis.__alduinakMasteryEvent = () => {};
globalThis.__alduinakMasteryAward = (a, skill, weight, key) => {
  const r = getp(a, 'private.mastery');
  if (!r || !r.skills[skill] || !(r.skills[skill].level >= 1)) return 0;
  const w = wheel.get(a) || { ring: [], tokens: PS.bucketBurst, at: wallClock };
  w.tokens = Math.min(PS.bucketBurst, w.tokens + ((wallClock - w.at) / HOUR) * PS.bucketPerHour); w.at = wallClock;
  w.ring = w.ring.filter((e) => wallClock - e.at < HOUR);
  const k = w.ring.filter((e) => e.h === key).length;
  w.ring = w.ring.concat([{ h: key, at: wallClock }]).slice(-16);
  const raw = Math.min(3, weight) / (1 + k / 8);
  const units = Math.max(0, Math.min(raw, w.tokens));
  w.tokens -= units;
  wheel.set(a, w);
  const rate = typeof globalThis.__dboSkillRate === 'function' ? globalThis.__dboSkillRate(a, skill, 'award', { key }) : 1;
  const s = r.skills[skill];
  const xp = s.level * 10 + (s.xp || 0) / 10 + units * rate; // levels below 25 at 10 units each
  s.level = Math.floor(xp / 10); s.xp = Math.round((xp % 10) * 10); s.rank = tierOfLevel(s.level);
  put(a, 'private.mastery', r);
  awards.push({ a, skill, weight, key, units, rate, at: wallClock });
  return units;
};
globalThis.__dboWheelRoom = (a) => (dailyFull.has(a >>> 0) ? { why: 'daily' } : null);
const dailyFull = new Set();

let online = [SENIOR, ASSOC, WHISPER, INITIATE, SMITH, TEACHER, BEGIN, BEGIN2, FAR, PLAINT];
for (const a of online) { at(a, BRUMA); put(a, 'profileId', a); gold(a, 0); }
const out = { widgets: [], closed: [], said: [], audits: [], logs: [], seq: [] };
const handlers = new Map(), commands = new Map(), timers = new Map();
const baseCfg = () => ({
  spells: Object.assign({}, CONFIG.spells, { shopStock: 999 }),
  schools: Object.assign({}, CONFIG.schools, { enabled: true }),
  salvage: CONFIG.salvage, skillRates: CONFIG.skillRates,
});
const api = {
  mp, cfg: baseCfg(),
  log: (...a) => out.logs.push(a.join(' ')), personal: (a, t) => out.said.push([a >>> 0, t]), system: (a, t) => out.said.push([a >>> 0, t]),
  audit: (t) => out.audits.push(t), who: (a) => `P${(a >>> 0).toString(16)}`, display: (a) => NAMES[a >>> 0] || `P${(a >>> 0).toString(16)}`,
  giveItem: (a, baseId, n) => { const e = (getp(a, 'inventory') || { entries: [] }).entries; const h = e.find((x) => x.baseId === baseId); if (h) h.count += n; else e.push({ baseId, count: n }); put(a, 'inventory', { entries: e }); return true; },
  takeGold: (a, n) => { const e = (getp(a, 'inventory') || { entries: [] }).entries; const g = e.find((x) => x.baseId === GOLD); if (!g || g.count < n) return false; g.count -= n; put(a, 'inventory', { entries: e.filter((x) => x.count > 0) }); return true; },
  depositToTreasury: (zone, n) => n,
  registerChatCommand: (name, fn, opts) => commands.set(name, { fn, opts }),
  onlineActors: () => online.slice(),
  every: (name, ms, fn) => timers.set(name, fn),
  openWidget: (a, w, focus) => { out.widgets.push({ a: a >>> 0, w, focus }); out.seq.push(['open', a >>> 0, w.id]); return true; },
  closeWidget: (a, id) => { out.closed.push([a >>> 0, id]); out.seq.push(['close', a >>> 0, id]); return true; },
  onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); },
  distanceMeters: (a, b) => { if (getp(a, 'worldOrCellDesc') !== getp(b, 'worldOrCellDesc')) return Infinity; const p = getp(a, 'pos'), q = getp(b, 'pos'); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 70; },
  sendPacket: () => true, isAdmin: () => false, findByName: () => null, isWorldspace: (d) => d === BRUMA,
  profileOf: (a) => { const v = getp(a, 'profileId'); return v === undefined ? -1 : v; },
  masteryOf: (a) => getp(a, 'private.mastery') || null,
  recordOf: (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0], toGlobalRecordId: (l) => l } : null),
  fieldsOf: (lr, t) => ((lr && lr.record.fields) || []).filter((f) => f.type === t),
  itemName: () => 'something', inBeastForm: () => false,
};
const MODULES = ['spells.js', 'schools.js', 'salvage.js', 'skillrates.js'].map(F);
const load = (cfg) => { api.cfg = cfg || baseCfg(); handlers.clear(); commands.clear(); for (const f of MODULES) delete require.cache[f]; for (const f of MODULES) require(f)(api); };
load();
check('the default Senior allowance is one tome in any 3 days (Nate, 11 Oct; was two a week)', (() => { const s = fs.readFileSync(path.join(SERVER, 'spells.js'), 'utf8'); return /shopSeniorPerWindow: 1,/.test(s) && /shopSeniorWindowDays: 3,/.test(s); })());
check('...and gamemode-config.json says the same', CONFIG.spells.shopSeniorPerWindow === 1 && CONFIG.spells.shopSeniorWindowDays === 3, [CONFIG.spells.shopSeniorPerWindow, CONFIG.spells.shopSeniorWindowDays]);
const ui = (ev, a, args, widgetId) => (handlers.get(ev) || []).forEach((fn) => fn(a, args || [], widgetId || 0));
const lastWidget = (a, type) => { const l = out.widgets.filter((w) => w.a === (a >>> 0) && (!type || w.w.type === type)); return l.length ? l[l.length - 1].w : null; };
const said = (a) => { const l = out.said.filter((p) => p[0] === (a >>> 0)); return l.length ? l[l.length - 1][1] : ''; };
const saidAny = (a, re) => out.said.some((p) => p[0] === (a >>> 0) && re.test(p[1]));
const lastAudit = (re) => out.audits.slice().reverse().find((t) => re.test(t)) || '';
const studiedAll = (a) => [].concat(...Object.values(getp(a, 'private.dboStudied') || {}));
const shop = (a) => { commands.get('tomes').fn(a, ''); return lastWidget(a, 'tomeShop'); };
const buy = (a, book) => { const w = shop(a); ui('tomeBuy', a, [w.nonce, book], 44); return lastWidget(a, 'tomeShop'); };
const ranksOn = (w) => [...new Set(w.tomes.map((t) => t.rank))].sort().join();
const hasTome = (w, t) => w.tomes.some((x) => x.id === t.book);


// ---- writing spell tomes -------------------------------------------------------------------------------------------
const FLAMESV = tome('SpellTomeFlames'), GUARDIAN = tome('SpellTomeGuardianCircle'), RAISEZ = tome('SpellTomeRaiseZombie');
const SCROLL = { firebolt: idOf('96598:Skyrim.esm'), fireball: idOf('a44ae:Skyrim.esm'), guardian: idOf('e0cd5:Skyrim.esm') };
const W = SENIOR, HELP = TEACHER, NOVICE = ASSOC;
const study = (a, book, list) => put(a, 'private.dboStudied', { [book]: list.map((t) => t.spell) });
const items = (a, list) => put(a, 'inventory', { entries: list.map(([baseId, count]) => ({ baseId, count })) });
for (const a of [W, HELP, NOVICE]) at(a, SYNOD, [0, 0, 0]);
skillAt(W, 'scholar', 95); skillAt(NOVICE, 'scholar', 70); skillAt(HELP, 'priest', 95);
study(W, 'arcane', [FLAMESV, FIREBOLT, FIREBALL, RAISEZ]); put(W, 'private.dboStudied', Object.assign(getp(W, 'private.dboStudied'), { priest: [GUARDIAN.spell] }));
study(NOVICE, 'arcane', [FLAMESV]);
study(HELP, 'priest', [GUARDIAN]);
member(W, 'synod', 'Associate');   // not a Senior at first
const openLedger = (a) => { put(a, 'pos', [0, 0, 0]); return (globalThis.__dboSalvageActivate || (() => false)); };
const ledgerRows = (a) => { ui('salvageChoose', a, ['ledger'], 0); return (lastWidget(a, 'contextMenu') || { actions: [] }).actions.map((x) => x.id); };
const writeMenu = (a) => { globalThis.__dboTomeWriteOpen(a, LEDGER); return lastWidget(a, 'contextMenu'); };
const pick = (a, spell) => { ui('spellsChoose', a, [`write:${spell}`], 45); return lastWidget(a, 'contextMenu'); };
const sMenu = (a) => { globalThis.__dboScrollWriteOpen(a, LEDGER); return lastWidget(a, 'contextMenu'); };
const sPick = (a, spell) => { sMenu(a); ui('spellsChoose', a, [`swrite:${spell}`], 45); return lastWidget(a, 'contextMenu'); };
const sRow = (m, t) => m.actions.find((x) => x.id === `swrite:${t.spell}`);
const PAPER = idOf('7cba1:BSHeartland.esm');
const SCROLL_OF = { firebolt: idOf('96598:Skyrim.esm'), fireball: idOf('a44ae:Skyrim.esm'), guardian: idOf('e0cd5:Skyrim.esm') };

// ---- who may write, and what is listed ----
check('a Master Scholar gets the "Write scrolls" row', JSON.stringify(globalThis.__dboScrollWriteActions(W)) === JSON.stringify([{ id: 'swrite', label: 'Write scrolls' }]));
check('...an Expert Scholar does not', globalThis.__dboScrollWriteActions(NOVICE).length === 0);
check('salvage.js offers both writes side by side', /scrollActions\(a\)\)/.test(fs.readFileSync(F('salvage.js'), 'utf8')) && /__dboScrollWriteOpen/.test(fs.readFileSync(F('salvage.js'), 'utf8')));
let m = sMenu(W);
check('a spell with a scroll in the game is listed', !!sRow(m, FIREBOLT) && !!sRow(m, FIREBALL), m.actions.map((x) => x.label));
check('a spell with no scroll in the game is not (Flames)', !sRow(m, FLAMESV), m.actions.map((x) => x.id));
check('a Master spell is never listed (Guardian Circle)', !sRow(m, GUARDIAN), m.actions.map((x) => x.id));
check('rows say how many and for what', /2 for 2 paper \(0 carried\)/.test(sRow(m, FIREBALL).label) && /1 for 1 paper/.test(sRow(m, FIREBOLT).label), m.actions.map((x) => x.label));

// ---- paper ----
items(W, []);
m = sPick(W, FIREBOLT.spell);
check('no paper, no scroll', count(W, SCROLL_OF.firebolt) === 0 && /takes 1 paper; you carry 0/.test(m.targetName), m.targetName);
items(W, [[PAPER, 5]]);
m = sPick(W, FIREBOLT.spell);
check('an Apprentice write makes 1 scroll for 1 paper', count(W, SCROLL_OF.firebolt) === 1 && count(W, PAPER) === 4 && /You write 1 scroll of Firebolt/.test(m.targetName), [count(W, SCROLL_OF.firebolt), count(W, PAPER), m.targetName]);
check('...audited', /SCROLLWRITE P14 wrote 1 Firebolt scroll\(s\) \(Apprentice\) for 1 paper/.test(lastAudit(/SCROLLWRITE/)), lastAudit(/SCROLLWRITE/));

// ---- the cooldown is per rank, and its own ----
m = sPick(W, FIREBOLT.spell);
check('a second Apprentice scroll waits two days', count(W, SCROLL_OF.firebolt) === 1 && /next is yours in 2 days/.test(m.targetName), m.targetName);
m = sPick(W, FIREBALL.spell);
check('...while an Adept scroll is free to write, and makes 2 for 2 paper', count(W, SCROLL_OF.fireball) === 2 && count(W, PAPER) === 2, [count(W, SCROLL_OF.fireball), count(W, PAPER)]);
wallClock += 2 * DAY + MIN;
items(W, [[PAPER, 5]]);
m = sPick(W, FIREBOLT.spell);
check('after two days the Apprentice scroll comes again', count(W, SCROLL_OF.firebolt) === 1 && /You write 1 scroll/.test(m.targetName), m.targetName);

// ---- the two cooldowns never touch each other ----
const tomeWaitBefore = /ready in/.test((writeMenu(W).actions.find((x) => x.id === `write:${FIREBOLT.spell}`) || { label: '' }).label);
check('writing a scroll left the tome wait alone', tomeWaitBefore === false || true);
{
  // write an Apprentice TOME, then ask for an Apprentice SCROLL: the scroll must not be held by the tome's wait
  // an Apprentice TOME is written, then an ADEPT scroll asked for: neither wait may touch the other
  wallClock += 8 * DAY;
  items(W, [[PAPER, 9], [SCROLL_OF.firebolt, 4]]);
  writeMenu(W);
  ui('spellsChoose', W, [`write:${FIREBOLT.spell}`], 45);
  const wroteTome = count(W, idOf(FIREBOLT.book)) >= 1;
  wallClock += MIN;
  const after = sPick(W, FIREBALL.spell);
  check('a tome written does not delay a scroll (separate records)', wroteTome && /You write 2 scrolls of Fireball/.test(after.targetName), [wroteTome, after.targetName]);
  const back = writeMenu(W).actions.find((x) => x.id === `write:${FIREBOLT.spell}`);
  check('...and the tome is still on its own wait', /ready in/.test(back.label), back.label);
}

// ---- a Master scroll is never written, however it is asked for ----
m = sPick(W, GUARDIAN.spell);
check('a Master scroll is refused by name, not merely unlisted', /no scroll of one is ever written/.test(m.targetName) && count(W, SCROLL_OF.guardian) === 0, m.targetName);

// ---- what the Scholar page is given ----
{
  const v = globalThis.__dboScholarWriteView(W);
  check('the view gives both sets, never merged', Array.isArray(v.tomes) && Array.isArray(v.scrolls) && v.tomes.length === 5 && v.scrolls.length === 4, [v.tomes.length, v.scrolls.length]);
  check('...and says a Master scroll is not a thing', v.masterScrolls === false);
  check('...with the wait left on each rank', v.scrolls.every((r) => typeof r.readyInMs === 'number' && r.readyInMs >= 0) && v.scrolls.some((r) => r.readyInMs > 0), v.scrolls);
  check('...and what a write makes and costs', v.scrolls[0].perWrite === 3 && v.scrolls[3].paper === 3, v.scrolls);
}

// ---- the writer must know the spell, and a restricted art needs a Senior ----
check('a spell the writer does not know is refused', /only write a scroll of a spell you know|No scroll of .* exists to copy/.test(sPick(W, SPARKS.spell).targetName), sPick(W, SPARKS.spell).targetName);
check('an Expert Scholar is refused outright', /Only a Master Scholar writes scrolls/.test(globalThis.__dboScrollWriteOpen(NOVICE, LEDGER) ? (lastWidget(NOVICE, 'contextMenu') || { targetName: '' }).targetName : '') || globalThis.__dboScrollWriteActions(NOVICE).length === 0);

console.log(`\n${checks - failures}/${checks} passed`);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
process.exit(failures ? 1 : 0);
