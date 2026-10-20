// When spells.js or schools.js fails to load, gamemode.js nulls the globals the last good load left, so nothing keeps
// asking a dead generation (17 Oct). schools.js's __dboMagicOpen (journal.js asks it before building the Magic view) and
// spells.js's __dboSpellsLearned / __dboSpellsLearnedChanged (manuals.js reads through the first, manuals.js and
// schools.js tell the second of a change) are on those lists. The two loader blocks are cut out of gamemode.js as they
// are written there and run with a require that throws.
//
//   node tests/load-fallback-nulls-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
let failures = 0, checks = 0;
const check = (name, ok, got) => { checks++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!ok) failures++; };
const block = (from, label) => {
  const a = src.indexOf(from); const b = a < 0 ? -1 : src.indexOf('\n// ---- ', a + from.length);
  if (a < 0 || b < 0) { console.log(`FAIL the ${label} loader is gone`); process.exit(1); }
  return src.slice(a, b);
};
const loads = (text, file) => {
  const logs = [];
  const req = (f) => { throw new Error(`cannot load ${f}`); };
  req.cache = {};
  new Function('path', 'require', 'log', text)({ resolve: (f) => `/nowhere/${f}` }, req, (...a) => logs.push(a.join(' ')));
  return logs;
};
const stale = () => () => 'the last good load';

// ---- spells.js ----
const SPELLS = block('// ---- spell study, slots, teaching and the Synod tome shop', 'spells.js');
for (const k of ['__dboSpellsLearned', '__dboSpellsLearnedChanged', '__dboSpellsKnown', '__dboSpellsTab']) globalThis[k] = stale();
const spellsLog = loads(SPELLS);
check('spells.js failing to load is logged', spellsLog.some((l) => /spells\.js failed to load/.test(l)), spellsLog);
check('...and leaves no __dboSpellsLearned (manuals.js then reads the engine itself)', globalThis.__dboSpellsLearned === null, typeof globalThis.__dboSpellsLearned);
check('...nor __dboSpellsLearnedChanged', globalThis.__dboSpellsLearnedChanged === null, typeof globalThis.__dboSpellsLearnedChanged);
check('...as it already did __dboSpellsKnown and __dboSpellsTab', globalThis.__dboSpellsKnown === null && globalThis.__dboSpellsTab === null);

// ---- schools.js ----
const SCHOOLS = block('// ---- the schools of magic, Study Magic and the Class Lectern', 'schools.js');
for (const k of ['__dboMagicOpen', '__dboMagicView', '__dboMagicTab']) globalThis[k] = stale();
const schoolsLog = loads(SCHOOLS);
check('schools.js failing to load is logged', schoolsLog.some((l) => /schools\.js failed to load/.test(l)), schoolsLog);
check('...and leaves no __dboMagicOpen answering for the Magic tab', globalThis.__dboMagicOpen === null, typeof globalThis.__dboMagicOpen);
check('...as it already did __dboMagicView and __dboMagicTab', globalThis.__dboMagicView === null && globalThis.__dboMagicTab === null);

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
