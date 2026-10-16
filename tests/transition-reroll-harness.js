'use strict';
// patrons.js: one free identity reroll per character listed in transition-rerolls.json, spent before any Patreon
// reroll, gone after "until". Run from the server folder: node tests/transition-reroll-harness.js
const fs = require('fs'); const os = require('os'); const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'transition-'));
fs.copyFileSync(path.resolve(__dirname, '..', 'patron-tiers.json'), path.join(tmp, 'patron-tiers.json'));
process.chdir(tmp);
const tiers = JSON.parse(fs.readFileSync('patron-tiers.json', 'utf8')).tiers;
const roleOf = (id) => tiers.find((t) => t.id === id).roleId;
const A = 0xff000064, B = 0xff000065, C = 0xff000066, G = 0xff000067;
const actors = { [A]: { profile: 1, roles: [] }, [B]: { profile: 2, roles: [] }, [C]: { profile: 3, roles: [roleOf('adventurer')] }, [G]: { profile: 4, roles: [roleOf('gm')] } };
let failures = 0;
const check = (what, got, want) => { const ok = got === want; if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}: got ${got}, want ${want}`); };
const load = (until) => {
  fs.writeFileSync('transition-rerolls.json', JSON.stringify({ until, chars: ['ff000064', 'ff000066', 'ff000067'] }));
  const props = new Map(); const commands = new Map();
  delete globalThis.__dboPatronStore; try { fs.unlinkSync('patron-tokens.json'); } catch (e) { /* first run */ }
  require(path.resolve(__dirname, '..', 'patrons.js'))({
    mp: { get: (a, k) => (props.get(a) || {})[k], set: (a, k, v) => { props.set(a, Object.assign(props.get(a) || {}, { [k]: v })); }, setRaceMenuOpen: () => {} },
    log: () => {}, personal: () => {}, system: () => {}, audit: () => {}, registerChatCommand: (n, fn) => commands.set(n, fn), who: String, display: String,
    profileOf: (a) => actors[a].profile, rolesOf: (a) => actors[a].roles, isAdmin: () => false, findByName: () => null,
  });
  return (a) => { commands.get('reroll')(a, 'confirm'); globalThis.__dboRerollDone(a); };
};
const left = (a) => globalThis.__dboRerollsLeft(a).left;
let reroll = load('2099-01-01T00:00:00Z');
check('listed character, no tier', left(A), 1);
check('character made after the snapshot', left(B), 0);
check('listed adventurer: free + patreon', left(C), 2);
reroll(A); check('free one spent', left(A), 0);
reroll(C); check('adventurer spends the free one first', left(C), 1);
check('the store marks it', !!JSON.parse(fs.readFileSync('patron-tokens.json', 'utf8')).transition.ff000066, true);
check('gm stays unlimited', left(G), Infinity);
load('2000-01-01T00:00:00Z');
check('after until, no free one', left(A), 0);
console.log(failures ? `${failures} failed` : 'all checks passed'); process.exit(failures ? 1 : 0);
