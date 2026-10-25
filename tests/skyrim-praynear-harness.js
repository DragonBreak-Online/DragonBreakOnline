// The Skyrim lore statues prayed at with /pray (Nat, 25 Oct: more shrines in Skyrim for the other faiths; prayer.js
// prayNear): each of the eight gods has a well-formed spot in Skyrim, which prayer.js reads exactly as it reads Meridia's
// Bruma statue (ref, world, pos[3], meters, name), and Meridia keeps her Bruma statue beside the new one.
//   node tests/skyrim-praynear-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!c) fails++; };
const choices = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills.json'), 'utf8')).deities.choices;
const god = (id) => choices.find((c) => c.id === id) || {};
const SKYRIM = /^(3c|9aa4a|5b91b):skyrim\.esm$/i;
const wellFormed = (s) => s && typeof s.ref === 'string' && /^[0-9a-f]+:.+\.es[mpl]$/i.test(s.ref) && typeof s.world === 'string'
  && Array.isArray(s.pos) && s.pos.length === 3 && s.pos.every(Number.isFinite) && Number(s.meters) >= 1 && typeof s.name === 'string' && s.name;
const WANT = { azura: '33dcb:Skyrim.esm', mehrunes: 'c599a:Skyrim.esm', peryite: 'd63:man_DaedricShrines.esp', hermaeusmora: '867:man_DaedricShrines.esp',
  mephala: '87b:man_DaedricShrines.esp', vaermina: '8e8:man_DaedricShrines.esp', nocturnal: '5a97:man_DaedricShrines.esp', meridia: '4e4d6:Skyrim.esm' };
for (const [id, ref] of Object.entries(WANT)) {
  const spots = god(id).prayNear || [];
  const s = spots.find((x) => x.ref === ref);
  ok(!!s && wellFormed(s) && SKYRIM.test(s.world), `${god(id).name || id}: a Skyrim spot at ${ref}, well formed`, spots);
}
ok((god('meridia').prayNear || []).some((x) => x.world === 'a764b:BSHeartland.esm'), 'Meridia keeps her Bruma statue beside Kilkreath');
ok(choices.every((c) => (c.prayNear || []).every(wellFormed)), 'every prayNear spot in skills.json is well formed (none skipped by prayer.js)');
ok(new Set(choices.flatMap((c) => (c.prayNear || []).map((x) => x.ref.toLowerCase()))).size === choices.reduce((n, c) => n + (c.prayNear || []).length, 0), 'no statue is two gods’ spot');
console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
