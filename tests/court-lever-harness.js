// Castle Bruma's gate lever (gamemode.js court levers, Countess Frigga 17 Oct): only Bruma's court and staff pull it.
// Lifts the block out of gamemode.js with stubs.
//   node tests/court-lever-harness.js   (from server/)
'use strict';
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'gamemode.js'), 'utf8');
const start = src.indexOf("// A court's own levers"); const end = src.indexOf('// Any throw in the chain above is refused', start);
let fails = 0; const ok = (l, c, g) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${l}${!c && g !== undefined ? `: got ${JSON.stringify(g)}` : ''}`); if (!c) fails++; };
ok('the court lever block is in gamemode.js', start > 0 && end > start);
const LEVER = 0x481b5fc3, OTHER = 0x1234, COUNTESS = 0x10, GUARD = 0x11, HOUSE = 0x12, TOWNIE = 0x13, GM = 0x14, NPC = 0xff000099;
const pid = { [COUNTESS]: 70, [GUARD]: 191, [HOUSE]: 55, [TOWNIE]: 99, [GM]: 2 };
const said = [];
const mp = { onActivate: () => true, getIdFromDesc: (d) => (d === '1b5fc3:DragonBreak Online Edits.esp' ? LEVER : 0) };
globalThis.__dboHoldFactionOf = (z) => (z === 'bruma' ? 'county-bruma' : null);
globalThis.__dboGuildsOf = (a) => (a === HOUSE ? [{ id: 'county-bruma' }] : []);
new Function('mp', 'cfg', 'log', 'profileOf', 'readOfficials', 'userOf', 'isAdmin', 'personal', 'ZONES', src.slice(start, end))(
  mp, {}, () => {}, (a) => pid[a] ?? -1, () => ({ bruma: { count: [70], guard: [191] } }), (a) => (a === NPC ? -1 : 1),
  (a) => a === GM, (a, t) => said.push([a, t]), { regions: [{ id: 'bruma', name: 'Bruma' }] });
ok('the Countess pulls it', mp.onActivate(LEVER, COUNTESS) === true);
ok('a Bruma Guard pulls it', mp.onActivate(LEVER, GUARD) === true);
ok('a member of the County household pulls it', mp.onActivate(LEVER, HOUSE) === true);
ok('staff pull it', mp.onActivate(LEVER, GM) === true);
ok('anyone else is refused', mp.onActivate(LEVER, TOWNIE) === false && /Only the court of Bruma works this lever/.test((said.at(-1) || [])[1]), said.at(-1));
ok('an NPC is not stopped', mp.onActivate(LEVER, NPC) === true);
ok('every other activation goes on as before', mp.onActivate(OTHER, TOWNIE) === true);
console.log(fails ? `${fails} FAILED` : 'all checks passed'); process.exit(fails ? 1 : 0);
