// Priest Studies pays Priest only through the Wheel's cast credit, so a Priest at a Wheel limit (the skill's daily cap,
// the character's, the hourly bucket, a skill marked to fall, the structural cap) sat for nothing: priestRefusal checked
// only the study window (scan 11 Oct). It now asks gamemode.js wheelRoom (lifted out of gamemode.js here, with the real
// skills.json), as Study Magic does since study-cap-check 8740de51: refused at the start with a clear line, and a sitting
// that reaches a limit ends at the next credit. Setup from tests/priest-study-units-harness.js; the hot-reload check loads
// the live schools.js (b998f5b4) first and the new one over its sitting. No server and no game:
//
//   node tests/priest-study-cap-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const SPELLS = path.join(SERVER, 'spells.js');
const SCHOOLS = path.join(SERVER, 'schools.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'priest-study-cap-'));
process.chdir(dir);
for (const f of ['skills.json', 'spell-tomes.json']) fs.copyFileSync(path.join(SERVER, f), f);
const CONFIG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));

let wallClock = Date.parse('2026-10-07T05:40:00Z');
Date.now = () => wallClock;
const MIN = 60000, HOUR = 3600000;
const advance = (ms) => { wallClock += ms; };

const PLUGINS = { 'Skyrim.esm': 0x00, 'BSAssets.esm': 0x0a, 'BSHeartland.esm': 0x0b, 'DragonBreak Online Edits.esp': 0x60 };
const BY_INDEX = Object.fromEntries(Object.entries(PLUGINS).map(([k, v]) => [v, k]));
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const descOf = (id) => { const p = BY_INDEX[id >>> 24]; if (!p) throw new Error('no plugin'); return `${(id & 0xffffff).toString(16)}:${p}`; };

// The Cathedral of St Martin and its PriestStudy activators (DLE v10), as tests/schools-harness.js has them
const CATHEDRAL = '12cb:BSHeartland.esm';
const PSTUDY_BASE = '16daf4:DragonBreak Online Edits.esp';
const PSTUDY = idOf('16db15:DragonBreak Online Edits.esp');
const HEAL = idOf('12fcc:Skyrim.esm');
const RECORDS = { [idOf(PSTUDY_BASE)]: { type: 'ACTI', editorId: 'PriestStudy', fields: [] } };

const props = new Map();
const put = (id, p, v) => props.set(id + '|' + p, v);
const at = (id, cell, pos) => { put(id, 'worldOrCellDesc', cell); put(id, 'pos', pos || [0, 0, 0]); };
put(PSTUDY, 'baseDesc', PSTUDY_BASE); at(PSTUDY, CATHEDRAL, [0, 0, 0]);

const NOVICE = 0x31, APPRENTICE = 0x32, UNTAKEN = 0x33, FULL = 0x34, OLDSIT = 0x35, CAPPED = 0x36, TIRED = 0x37, FALLING = 0x38, DAYDONE = 0x39, SEATED = 0x3a;
const NAMES = { [NOVICE]: 'Novice', [APPRENTICE]: 'Apprentice', [UNTAKEN]: 'Untaken', [FULL]: 'Full', [OLDSIT]: 'Oldsit' };
const priestAt = (a, level, xp) => {
  const r = props.get(a + '|private.mastery') || { v: 2, skills: {}, order: [] };
  r.skills.priest = { level, xp: xp || 0, rank: level >= 25 ? 1 : 0 };
  if (!r.order.includes('priest')) r.order.push('priest');
  put(a, 'private.mastery', r);
};
for (const a of [NOVICE, APPRENTICE, UNTAKEN, FULL, OLDSIT, CAPPED, TIRED, FALLING, DAYDONE, SEATED]) { at(a, CATHEDRAL, [0, 0, 0]); put(a, 'profileId', a); }
priestAt(NOVICE, 12, 0); priestAt(APPRENTICE, 30, 40); priestAt(FULL, 12, 0); priestAt(OLDSIT, 12, 0);

// The Wheel's curve (skillPoints.ts) and a stand-in for masterySystem's credit of Priest Studies' cast events
const XP_BANDS = [[0, 10], [25, 5], [50, 2.5], [75, 1.25], [90, 0.5], [95, 0.25]];
const xpPerUnitAt = (level) => { let x = XP_BANDS[0][1]; for (const [from, per] of XP_BANDS) if (level >= from) x = per; return x; };
const PER_CREDIT = 0.33;
let poolFull = false;
const queue = [];
globalThis.__alduinakMasteryEvent = (kind, a, detail) => queue.push({ kind, a, detail });
const drain = () => {
  for (const ev of queue.splice(0, queue.length)) {
    if (ev.kind !== 'cast' || ev.detail.spellId !== HEAL || poolFull) continue;
    const r = props.get(ev.a + '|private.mastery') || { v: 2, skills: {}, order: [] };
    const p = r.skills.priest || (r.skills.priest = { level: 0, xp: 0 });
    if (!r.order.includes('priest') || !(p.level >= 1)) { p.shadow = (p.shadow || 0) + PER_CREDIT; put(ev.a, 'private.mastery', r); continue; }
    p.xp += PER_CREDIT * xpPerUnitAt(p.level);
    while (p.xp >= 100) { p.xp -= 100; p.level++; }
    put(ev.a, 'private.mastery', r);
  }
};
const unitsOf = (a) => {
  const r = props.get(a + '|private.mastery'); const p = r && r.skills && r.skills.priest;
  if (!p) return 0;
  if (!r.order.includes('priest') || !(p.level >= 1)) return p.shadow || 0;
  let u = 0; for (let l = 0; l < p.level; l++) u += 100 / xpPerUnitAt(l);
  return u + p.xp / xpPerUnitAt(p.level);
};

const known = new Map();
const mp = {
  getIdFromDesc: idOf,
  getDescFromId: descOf,
  get: (id, p) => props.get(id + '|' + p),
  set: (id, p, v) => props.set(id + '|' + p, JSON.parse(JSON.stringify(v))),
  lookupEspmRecordById: (id) => (RECORDS[id] ? { record: RECORDS[id], toGlobalRecordId: (local) => local } : null),
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    if (cls === 'Debug' && fn === 'SendAnimationEvent') return null;
    const a = idOf(self.desc); const s = known.get(a) || (known.set(a, new Set()), known.get(a));
    if (fn === 'GetSpellCount') return s.size;
    if (fn === 'GetNthSpell') { const id = [...s][args[0]]; return id === undefined ? null : { type: 'espm', desc: descOf(id) }; }
    const spell = idOf(args[0].desc);
    if (fn === 'AddSpell') { if (s.has(spell)) return false; s.add(spell); return true; }
    if (fn === 'RemoveSpell') return s.delete(spell);
    throw new Error('unexpected papyrus ' + fn);
  },
};
mp.onReadBook = () => undefined;
globalThis.__alduinakMasteryFirstTouch = () => 'ok';

let online = [NOVICE, APPRENTICE, UNTAKEN, FULL, OLDSIT, CAPPED, TIRED, FALLING, DAYDONE, SEATED];
const out = { widgets: [], closed: [], said: [], audits: [], logs: [] };
const handlers = new Map(), timers = new Map();
const mkApi = (cfg) => ({
  mp, cfg,
  log: (...a) => out.logs.push(a.join(' ')),
  personal: (a, t) => out.said.push([a, t]),
  system: (a, t) => out.said.push([a, t]),
  audit: (t) => out.audits.push(t),
  display: (a) => `${NAMES[a] || 'P'} #TAG${(a & 0xf).toString(16)}`,
  who: (a) => `P${a.toString(16)}`,
  openWidget: (a, w, focus) => { out.widgets.push({ a, w, focus }); return true; },
  closeWidget: (a, id) => { out.closed.push([a, id]); return true; },
  onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); },
  registerChatCommand: () => {},
  onlineActors: () => online.slice(),
  every: (name, ms, fn) => timers.set(name, fn),
  distanceMeters: (a, b) => {
    if (props.get(a + '|worldOrCellDesc') !== props.get(b + '|worldOrCellDesc')) return Infinity;
    const p = props.get(a + '|pos'), q = props.get(b + '|pos');
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 70;
  },
  sendPacket: () => true,
  isAdmin: () => false,
  findByName: () => null,
  isWorldspace: () => false,
  profileOf: (a) => { const v = props.get(a + '|profileId'); return v === undefined ? -1 : v; },
  takeGold: () => false, giveItem: () => true, depositToTreasury: (z, n) => n,
});
const load = (file = SCHOOLS) => {
  handlers.clear();
  const cfg = { spells: Object.assign({}, CONFIG.spells), schools: Object.assign({}, CONFIG.schools, { enabled: true }) };
  delete require.cache[SPELLS]; require(SPELLS)(mkApi(cfg));
  delete require.cache[file]; require(file)(mkApi(cfg));
};
load();

let failures = 0, checks = 0;
const check = (name, ok, detail) => { checks++; if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };
const ui = (ev, a, args, widgetId) => (handlers.get(ev) || []).forEach((fn) => fn(a, args || [], widgetId || 0));
const panel = (a) => { const l = out.widgets.filter((w) => w.a === a && w.w.id === 75); return l.length ? l[l.length - 1].w : null; };
const sitting = (a) => globalThis.__dboSchoolsState.priestStudying.has(a);
// The server's loop: the gameplay tick enqueues, masterySystem drains between ticks
const tick = () => { timers.get('schools.tick')(); drain(); };
const sit = (a, ms) => { for (let t = 0; t < ms; t += 2000) { advance(2000); tick(); } };
const r1 = (x) => Math.round(x * 10) / 10;

const { execFileSync } = require('child_process');
const GM = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
const gs = GM.indexOf('const scholarNoRoom = '), ge = GM.indexOf('globalThis.__dboScholarNoRoom = scholarNoRoom;');
const SKILLS_DEF = JSON.parse(fs.readFileSync(path.join(SERVER, 'skills.json'), 'utf8'));
const PSYS = SKILLS_DEF.pointSystem;
new Function('mp', 'SKILLS_DEF', GM.slice(gs, ge))(mp, SKILLS_DEF);
const TODAY = new Date(wallClock).toISOString().slice(0, 10);
const setPriest = (a, o, recExtra) => { const r = props.get(a + '|private.mastery'); Object.assign(r.skills.priest, o); Object.assign(r, recExtra || {}); put(a, 'private.mastery', r); };
const said = (a) => { const l = out.said.filter((p) => p[0] === a); return l.length ? l[l.length - 1][1] : ''; };
const refusedWith = (a, re) => { const w = panel(a); return !sitting(a) && !!w && re.test(w.whyNot || w.result || ''); };
priestAt(CAPPED, 12, 0); priestAt(TIRED, 12, 0); priestAt(FALLING, 12, 0); priestAt(DAYDONE, 12, 0); priestAt(SEATED, 80, 0);
// SEATED: three other skills above 75 hold the Expert places, so Priest at 75 can rise no further
const sr = props.get(SEATED + '|private.mastery');
for (const k of ['oneHanded', 'heavyArmor', 'block']) { sr.skills[k] = { level: 80, xp: 0 }; sr.order.push(k); }
sr.skills.priest.level = 75; put(SEATED, 'private.mastery', sr);

for (const a of online) ui('uiCaps', a, ['bank', 'spellbook', 'schools']);
(async () => {
  check('wheelRoom is in gamemode.js beside scholarNoRoom', gs > 0 && ge > gs && typeof globalThis.__dboWheelRoom === 'function');
  // ---- refused at the start ----
  setPriest(CAPPED, { day: TODAY, spentToday: PSYS.dailyCaps.low });
  globalThis.__dboSchoolsActivate(PSTUDY, CAPPED);
  check('Priest\'s daily cap spent: no sitting, the panel says when study pays again', refusedWith(CAPPED, /learned all you can of Priest today\. Study pays again after midnight \(UTC\)/), panel(CAPPED));
  ui('priestStudyStart', CAPPED, [panel(CAPPED).nonce]);
  check('...Study pressed anyway: refused with the same line', !sitting(CAPPED) && panel(CAPPED).resultKind === 'refused' && /of Priest today/.test(panel(CAPPED).result), panel(CAPPED));
  setPriest(CAPPED, { day: '2026-10-06' });
  globalThis.__dboSchoolsActivate(PSTUDY, CAPPED);
  check('...yesterday\'s spending does not count: the sitting starts', sitting(CAPPED));
  ui('priestStudyClose', CAPPED);

  setPriest(DAYDONE, {}, { day: TODAY, spentToday: PSYS.characterDaily });
  globalThis.__dboSchoolsActivate(PSTUDY, DAYDONE);
  check('the character\'s daily cap: refused', refusedWith(DAYDONE, /as much as one day allows/), panel(DAYDONE));

  setPriest(FALLING, { lock: 'lower' });
  globalThis.__dboSchoolsActivate(PSTUDY, FALLING);
  check('Priest marked to fall: refused', refusedWith(FALLING, /Priest is marked to fall on your Wheel/), panel(FALLING));

  globalThis.__dboSchoolsActivate(PSTUDY, SEATED);
  check('the Expert places held by other skills: refused, naming the cap', refusedWith(SEATED, /Your Priest can rise no further than 75/), panel(SEATED));

  setPriest(TIRED, { bucket: { tokens: 0, at: wallClock } });
  globalThis.__dboSchoolsActivate(PSTUDY, TIRED);
  check('the hourly bucket empty: refused, with the minutes to wait', refusedWith(TIRED, /study again in about \d+ minutes/), panel(TIRED));
  setPriest(TIRED, { bucket: { tokens: 0, at: wallClock - HOUR } });
  globalThis.__dboSchoolsActivate(PSTUDY, TIRED);
  check('...an hour later it has refilled: the sitting starts', sitting(TIRED));
  ui('priestStudyClose', TIRED);

  globalThis.__dboSchoolsActivate(PSTUDY, UNTAKEN);
  check('Priest not taken up (banked): never refused by the Wheel', sitting(UNTAKEN));
  ui('priestStudyClose', UNTAKEN);

  // ---- a limit reached during a sitting ----
  globalThis.__dboSchoolsActivate(PSTUDY, NOVICE);
  sit(NOVICE, 72000);
  check('room to earn: a sitting pays the first credit', sitting(NOVICE) && panel(NOVICE).gained > 0, panel(NOVICE));
  setPriest(NOVICE, { day: TODAY, spentToday: PSYS.dailyCaps.low }); poolFull = true;
  const n = out.audits.length;
  sit(NOVICE, 62000);
  check('the daily cap reached mid-sitting: the sitting ends at the next credit', !sitting(NOVICE) && out.audits.slice(n).some((t) => /stopped Priest Studies \(wheel\)/.test(t)), out.audits.slice(n));
  check('...told in chat and on the panel when it pays again', /after midnight \(UTC\)/.test(said(NOVICE)) && panel(NOVICE).resultKind === 'refused' && /of Priest today/.test(panel(NOVICE).result), [said(NOVICE), panel(NOVICE).result]);
  check('...the time sat is logged against the Priest window', ((props.get(NOVICE + '|private.dboSchools').priestStudy || {}).log || []).some(([f, t]) => t - f >= 120000));
  poolFull = false;

  // A low bucket that still paid at the last credit keeps the sitting going; one that paid nothing ends it
  globalThis.__dboSchoolsActivate(PSTUDY, APPRENTICE);
  sit(APPRENTICE, 62000);
  setPriest(APPRENTICE, { bucket: { tokens: 0, at: wallClock + 60000 } });
  sit(APPRENTICE, 60000);
  check('a low bucket after a credit that paid: the sitting goes on', sitting(APPRENTICE));
  poolFull = true; setPriest(APPRENTICE, { bucket: { tokens: 0, at: wallClock + 10 * MIN } });
  sit(APPRENTICE, 60000);
  sit(APPRENTICE, 60000);
  check('...a low bucket after a credit that paid nothing: it ends, with the minutes to wait', !sitting(APPRENTICE) && /study again in about \d+ minutes/.test(said(APPRENTICE)), said(APPRENTICE));
  poolFull = false;

  // ---- hot reload: a sitting begun under the live schools.js carries on under this one ----
  const old = path.join(dir, 'schools-live.js');
  fs.writeFileSync(old, execFileSync('git', ['-C', SERVER, 'show', 'b998f5b4:schools.js']));
  load(old);
  priestAt(OLDSIT, 12, 0);
  globalThis.__dboSchoolsActivate(PSTUDY, OLDSIT);
  sit(OLDSIT, 72000);
  load();
  sit(OLDSIT, 62000);
  check('hot reload: an older sitting (no wheel mark) keeps paying under the new code', sitting(OLDSIT) && panel(OLDSIT).gained > 0, panel(OLDSIT));
  setPriest(OLDSIT, { day: TODAY, spentToday: PSYS.dailyCaps.low }); poolFull = true;
  sit(OLDSIT, 62000);
  check('...and ends at the cap like a new one', !sitting(OLDSIT) && /of Priest today/.test(said(OLDSIT)), said(OLDSIT));
  poolFull = false;

  console.log(`\n${checks - failures}/${checks} passed`);
  process.chdir(os.tmpdir());
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL harness threw', e.stack); process.exit(1); });
