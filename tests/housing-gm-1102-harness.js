// GMs manage property (Nat, 2 Nov: "allow them to do everything", opening someone's property as its owner aside; fork
// HousingSystem isStaffOverride, housing-staff-harness.js). Here the gameplay side:
//   - staffguard.js 'housing': on a staff character only, and where the fork names the property's owner (ownerProfile), never
//     on the staff member's own account, and on another staff member's only for a Lead GM (selfTarget);
//   - gamemode.js /grantproperty: a GM grants too, a Trial GM does not, and nobody grants to their own account.
// Mutants of copies of both files must fail.
//   node tests/housing-gm-1102-harness.js [staffguard.js] [gamemode.js]   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MOD, CAST, load, check, done } = require('./lib/staffguard-fakes');

const SG = fs.readFileSync(path.resolve(process.argv[2] || MOD), 'utf8').replace(/\r\n/g, '\n');
const GMJS = fs.readFileSync(path.resolve(process.argv[3] || path.join(__dirname, '..', 'gamemode.js')), 'utf8').replace(/\r\n/g, '\n');
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-housinggm-'));
const home = process.cwd();
process.on('exit', () => { process.chdir(home); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS */ } });
process.chdir(dir);
let n = 0;

// /grantproperty out of gamemode.js, run with stubs: the staff tier, the online cast, the housing system's grant
const grantCommand = (src) => {
  const start = src.indexOf("registerChatCommand('grantproperty'");
  if (start < 0) return null;
  const end = src.indexOf('\nregisterChatCommand(', start + 10);
  const body = src.slice(start, end < 0 ? undefined : end);
  let fn = null;
  const env = { tier: {}, said: [], granted: [], profiles: {}, names: {} };
  const registerChatCommand = (name, f) => { if (name === 'grantproperty') fn = f; };
  const mp = { getIdFromDesc: () => 0x1234, get: () => undefined, set: () => {} };
  globalThis.__dboHousing = { grant: (id, t) => { env.granted.push([id, t]); return ''; }, primaryOf: (id) => id };
  new Function('registerChatCommand', 'staffTierOf', 'personal', 'findByName', 'mp', 'profileOf', 'who', 'display', 'log', 'audit', body)(
    registerChatCommand, (a) => env.tier[a] || null, (a, t) => env.said.push(t), (name) => env.names[name] || 0, mp,
    (a) => env.profiles[a], (a) => `P${a}`, (a) => `P${a}`, () => {}, () => {});
  return fn ? Object.assign(env, { run: (a, args) => { env.said.length = 0; env.granted.length = 0; fn(a, args); return env.said.join(' | '); } }) : null;
};

const run = (sgSrc, gmSrc, check) => {
  const copy = path.join(dir, `staffguard-${n++}.js`);
  fs.writeFileSync(copy, sgSrc);
  const f = load({});
  delete require.cache[copy];
  require(copy)(f.api);
  const gate = (a, info) => globalThis.__dboAdminGate(a, 'housing', info || {});
  check('housing gate: a GM on their staff character manages another player\'s property', gate(CAST.GM.id, { ownerProfile: CAST.BOB.profile }) === '');
  check('...never one of their own account\'s', /never act on your own characters/.test(gate(CAST.GM.id, { ownerProfile: CAST.GM.profile })));
  check('...nor another staff member\'s (Lead GM and above do)', /Only a Lead GM or above/.test(gate(CAST.GM.id, { ownerProfile: CAST.LEAD.profile })) && gate(CAST.LEAD.id, { ownerProfile: CAST.GM.profile }) === '');
  check('...with no owner named (opening, an unowned door): the staff-character rule alone', gate(CAST.GM.id, {}) === '');
  check('...and never on a character that is not their staff one', /only on your staff character/.test(gate(CAST.GM_RP.id, { ownerProfile: CAST.BOB.profile })) && /only on your staff character/.test(gate(CAST.GM_RP.id, {})));

  const g = grantCommand(gmSrc);
  check('/grantproperty is in gamemode.js', !!g);
  if (!g) return;
  const GM = 1, LEAD = 2, TRIAL = 3, PLAYER = 4;
  Object.assign(g.tier, { [GM]: 'gm', [LEAD]: 'leadgm' });
  Object.assign(g.profiles, { [GM]: 30, [LEAD]: 20, [TRIAL]: 40, [PLAYER]: 60 });
  Object.assign(g.names, { '#BOBB': PLAYER, '#GEMM': GM });
  let said = g.run(GM, '#BOBB d97a2:BSHeartland.esm');
  check('/grantproperty: a GM grants a property to a player', g.granted.length === 1 && g.granted[0][1] === PLAYER && /now owns/.test(said), said);
  said = g.run(LEAD, '#BOBB d97a2:BSHeartland.esm');
  check('...as a Lead GM does', g.granted.length === 1, said);
  said = g.run(TRIAL, '#BOBB d97a2:BSHeartland.esm');
  check('...a Trial GM does not', g.granted.length === 0 && /Only a GM or above/.test(said), said);
  said = g.run(GM, '#GEMM d97a2:BSHeartland.esm');
  check('...nor anyone to their own account', g.granted.length === 0 && /never hand a property to your own account/.test(said), said);
};

run(SG, GMJS, check);
const MUTANTS = [
  ['sg', 'the housing gate ignores the owner', "return Number.isSafeInteger(pt) && pt > 0 ? target(a, { profile: pt }, 'housing') : '';\n    }\n    // A GM fixing", "return '';\n    }\n    // A GM fixing"],
  ['sg', 'the housing gate drops the staff-character rule', "    if (action === 'housing') {\n      if (CHAR.enabled && !powersOn(a)) return NOT_HERE;", "    if (action === 'housing') {"],
  ['gm', 'a GM may not grant', "['senior', 'developer', 'leadgm', 'gm'].includes(tier)) return personal(a, 'Only a GM or above", "['senior', 'developer', 'leadgm'].includes(tier)) return personal(a, 'Only a GM or above"],
  ['gm', 'a grant to one\'s own account goes through', "  if (profileOf(t) === profileOf(a)) return personal(a, 'Staff tools never hand a property to your own account.');\n", ''],
];
for (const [which, name, from, to] of MUTANTS) {
  const src = which === 'sg' ? SG : GMJS;
  if (!src.includes(from)) { check(`mutant "${name}": its line is still there`, false, from); continue; }
  let bad = 0;
  try { run(which === 'sg' ? SG.replace(from, to) : SG, which === 'gm' ? GMJS.replace(from, to) : GMJS, (_n, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}
done();
