// Checks server\spell-lines.json (Arcane Mastery spell lines, Nate 14 Oct 2026, option B; read by schools.js): every spell
// id in it is a spell some tome teaches in spell-tomes.json (the load order's tome index, ck-mcp\readables.py), with the
// same editor id, school and rank written beside it; each line is one school and rises in rank; the names are the tome
// data's. The rank-pick cases (offered first, the old spell kept, skipped and known successors, several lines, Priest)
// are in tests/rank-picks-harness.js.
//
//   node tests/spell-lines-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const lines = JSON.parse(fs.readFileSync(path.join(SERVER, 'spell-lines.json'), 'utf8')).lines;
const tomes = JSON.parse(fs.readFileSync(path.join(SERVER, 'spell-tomes.json'), 'utf8')).tomes;
const RANKS = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'];
const SCHOOLS = ['Alteration', 'Conjuration', 'Destruction', 'Illusion', 'Restoration'];
// spell-tomes.json writes "Skyrim.esm:012FCD"; the server and spell-lines.json "12fcd:Skyrim.esm"
const asDesc = (id) => { const [plugin, hex] = String(id).split(':'); return `${parseInt(hex, 16).toString(16)}:${plugin}`; };
const bySpell = new Map();
for (const t of tomes) { const d = asDesc(t.spellId); if (!bySpell.has(d)) bySpell.set(d, t); }

let failures = 0, checks = 0;
const check = (name, ok, detail) => { checks++; if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };

check('spell-lines.json has lines for every school', Array.isArray(lines) && SCHOOLS.every((s) => lines.some((l) => l.school === s)), lines && lines.map((l) => l.school));
const bad = [], order = [], wrongSchool = [];
for (const l of lines) {
  if (!SCHOOLS.includes(l.school)) wrongSchool.push(l.name);
  let last = -1;
  for (const sp of l.spells) {
    const t = bySpell.get(String(sp.id));
    if (!t || t.spell !== sp.edid || t.school !== l.school || RANKS[t.rank] !== sp.rank || t.spellName !== sp.name) bad.push([l.name, sp, t ? { spell: t.spell, school: t.school, rank: t.rank, name: t.spellName } : 'no tome teaches it']);
    const r = RANKS.indexOf(sp.rank);
    if (r <= last) order.push([l.name, sp.name]);
    last = r;
  }
}
check('every id is a tome spell in spell-tomes.json, with its editor id, school, rank and name as written', !bad.length, bad);
check('each line is of one school', !wrongSchool.length, wrongSchool);
check('each line rises in rank, one spell a rank at most', !order.length, order);
check('every line has two spells or more', lines.every((l) => Array.isArray(l.spells) && l.spells.length >= 2));
check('ids are written as the server writes them (lower-case hex, no leading zeros)', lines.every((l) => l.spells.every((sp) => /^[1-9a-f][0-9a-f]*:[^:]+$/.test(sp.id))));
const spellsJs = fs.readFileSync(path.join(SERVER, 'spells.js'), 'utf8');
const removed = (spellsJs.match(/removedSpells: \[([^\]]*)\]/) || [, ''])[1].match(/'[^']+'/g) || [];
check('no line spell is a removed spell (spells.js removedSpells)', !lines.some((l) => l.spells.some((sp) => removed.includes(`'${sp.id}'`))), removed);
const schoolsJs = fs.readFileSync(path.join(SERVER, 'schools.js'), 'utf8');
check('schools.js reads spell-lines.json', /spell-lines\.json/.test(schoolsJs));

console.log(`${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
