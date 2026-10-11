// Nate, 10 Oct: the reading's tome pick (gamemode.js scholarTomePick): ranks by tier, no known or carried tome,
// the reader's own schools weighted; and (11 Oct) the college rank's cap (spells.js __dboSpellsReadRankCap) and the
// restricted arts (__dboSpellsReadRestricted). Lifts the function out of gamemode.js with stubs.
//   node tests/scholar-tome-pick-harness.js   (from server/)
'use strict';
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const start = src.indexOf('const scholarTomePick = '); const end = src.indexOf('const masteryOf = ', start);
let fails = 0; const ok = (l, c, g) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${l}${!c && g !== undefined ? `: got ${JSON.stringify(g)}` : ''}`); if (!c) fails++; };
ok('scholarTomePick is in gamemode.js', start > 0 && end > start);
const TOMES = [
  { id: 'Skyrim.esm:0000A1', school: 'Illusion', rank: 0 }, { id: 'Skyrim.esm:0000A2', school: 'Restoration', rank: 0 },
  { id: 'Skyrim.esm:0000A3', school: 'Destruction', rank: 1 }, { id: 'Skyrim.esm:0000A4', school: 'Alteration', rank: 2 },
];
const SPELL = { 0xa1: 0x1a1, 0xa2: 0x1a2, 0xa3: 0x1a3, 0xa4: 0x1a4 };
let inv = [], known = [], order = ['priest'];
const mp = { get: (a, k) => (k === 'inventory' ? { entries: inv } : null), getIdFromDesc: (d) => parseInt(d.split(':')[0], 16) };
globalThis.__dboSpellsKnown = () => known.map((id) => ({ id }));
globalThis.__dboSpellsTomeSpell = (b) => SPELL[b] || 0;
// The college rank's cap: 4 (a gate off) for the Scholar-tier checks, then the gate's own cases below
let collegeCap = 4, restrictedBooks = new Set();
globalThis.__dboSpellsReadRankCap = () => collegeCap;
globalThis.__dboSpellsReadRestricted = (a, id) => restrictedBooks.has(id);
const SKILLS_DEF = { skills: [{ id: 'arcane', vanillaSkills: ['Destruction', 'Conjuration', 'Illusion'] }, { id: 'priest', vanillaSkills: ['Restoration', 'Alteration'] }] };
const make = (READ) => new Function('mp', 'READABLES', 'READ', 'SKILLS_DEF', 'masteryOf', `${src.slice(start, end)}; return scholarTomePick;`)(mp, { tomes: TOMES }, READ, SKILLS_DEF, () => ({ order }));
const pick = make({ tomeSchoolWeight: 3 });
const draw = (tier, n = 4000) => { const c = {}; for (let i = 0; i < n; i++) { const t = pick(1, tier); const k = t ? t.id.slice(-2) : 'none'; c[k] = (c[k] || 0) + 1; } return c; };
let c = draw(1); ok('Apprentice: Novice tomes only', !c.A3 && !c.A4 && c.A1 > 0 && c.A2 > 0, c);
c = draw(2); ok('Adept: Apprentice tomes too, no Adept', c.A3 > 0 && !c.A4, c);
c = draw(4); ok('Master: up to Adept', c.A4 > 0, c);
c = draw(1); ok('a Priest draws Restoration about 3x as often as Illusion', c.A2 > 2 * c.A1, c);
known = [0x1a2]; c = draw(1); ok('a known spell is never handed out', !c.A2 && c.A1 > 0, c);
known = []; inv = [{ baseId: 0xa1, count: 1 }]; c = draw(1); ok('a carried tome is never handed out', !c.A1 && c.A2 > 0, c);
known = [0x1a2]; inv = [{ baseId: 0xa1, count: 1 }]; ok('nothing left: null (the day is not spent)', pick(1, 1) === null);
// ---- the college rank gate (Nate, 11 Oct) ----
known = []; inv = [];
collegeCap = 1; c = draw(4); ok('gate: a Master Scholar with no college rank (cap Apprentice) never draws the Adept tome', !c.A4 && c.A3 > 0 && c.A1 > 0, c);
let none = 0; for (let i = 0; i < 2000; i++) if (!pick(1, 4)) none++;
ok('gate: ...and always gets one of the allowed tomes instead (the find is not lost)', none === 0, none);
collegeCap = 3; c = draw(4); ok('gate: a Senior (cap Expert) at Master Scholar draws the Adept tome again', c.A4 > 0, c);
collegeCap = 3; c = draw(1); ok('gate: the Scholar tier still caps under a high college rank (Apprentice Scholar: Novice only)', !c.A3 && !c.A4, c);
collegeCap = 0; c = draw(4); ok('gate: a cap of Novice keeps to Novice', !c.A3 && !c.A4 && c.A1 > 0, c);
collegeCap = 1; delete globalThis.__dboSpellsReadRankCap; c = draw(4); ok('gate: without spells.js the cap is Apprentice', !c.A4 && c.A3 > 0, c);
globalThis.__dboSpellsReadRankCap = () => collegeCap;
collegeCap = 4; restrictedBooks = new Set([0xa2]); c = draw(1); ok('gate: a restricted art (for one below Senior) is passed over', !c.A2 && c.A1 > 0, c);
restrictedBooks = new Set([0xa1, 0xa2]); ok('gate: nothing allowed left: null (the day is not spent)', pick(1, 1) === null);
restrictedBooks = new Set();
console.log(fails ? `${fails} FAILED` : 'all checks passed'); process.exit(fails ? 1 : 0);
