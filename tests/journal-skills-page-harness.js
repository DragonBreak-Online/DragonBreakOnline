// The Skills tab paged for a native journal (journalskills.js; live, 3 Nov: the whole tab passed the 60,000 characters a
// native panel takes and went to the browser): Blacksmithing's recipes and Arcane Arts' schools only with their page in
// view, everything as before for the browser journal.
//   node tests/journal-skills-page-harness.js   (from server/)
'use strict';
const path = require('path');
let fails = 0, oks = 0;
const ok = (c, what, d) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && d !== undefined ? '   ' + JSON.stringify(d).slice(0, 300) : ''}`); if (c) oks++; else fails++; };

const NATIVE = 0x14, BROWSER = 0x15;
const BIG = 'x'.repeat(70000);
globalThis.__dboJournalSections = undefined;
globalThis.__dboPanelState = { native: new Map([[NATIVE, new Set(['native:journal', 'native:journalTab:skills'])]]) };
let held = [{ id: 'fighter', level: 40, xp: 25 }];
globalThis.__alduinakMasteryMenu = () => ({ skills: [{ id: 'fighter' }, { id: 'blacksmith' }, { id: 'arcane' }], points: { enabled: true, held } });
globalThis.__dboSmithView = () => ({ recipes: BIG });
globalThis.__dboSchoolsBrief = () => ({ schools: 'arcane schools' });
require(path.resolve(__dirname, '..', 'journalskills.js'))({ log: () => {}, onUi: () => {} });
const view = (a, focus) => globalThis.__dboJournalSections.skills.view(a, focus ? { focus: { skill: focus } } : {});

let v = view(NATIVE);
ok(v.paged === true && !v.smith && !v.magicSchools, 'a native journal on its first page (the highest held skill): neither page\'s extra, paged', Object.keys(v));
ok(JSON.stringify(v).length < 60000, '...and small enough to go native', JSON.stringify(v).length);
v = view(NATIVE, 'blacksmith');
ok(v.smith && !v.magicSchools, 'Blacksmithing\'s page asked for: its recipes, not the schools', Object.keys(v));
v = view(NATIVE, 'arcane');
ok(!v.smith && v.magicSchools, 'Arcane Arts\' page asked for: its schools, not the recipes', Object.keys(v));
held = [{ id: 'blacksmith', level: 50, xp: 10 }];
v = view(NATIVE);
ok(v.smith && !v.magicSchools, 'with Blacksmithing the highest held skill, its page is the first and comes with its recipes', Object.keys(v));
v = view(BROWSER);
ok(!v.paged && v.smith && v.magicSchools, 'the browser journal gets everything, as before', Object.keys(v));
ok(v.points && v.points.held[0].xp === 10, 'each held skill keeps its progress to the next level (xp)', v.points);

console.log(fails ? `\n${fails} failed` : `\nall passed (${oks})`);
process.exit(fails ? 1 : 0);
