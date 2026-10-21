// Trial GM in the fork's adminRoles.ts (Nate, 11 Oct): server-settings adminRoles.trialgm gives no admin tier
// (adminTierOf stays null, so every isAdmin-style check in AdminSystem, HousingSystem and the bounty board stays closed),
// and isTrialGm / isTrialGmFrom say who it is. A GM role held beside it wins.
//   node tests/trial-gm-roles-harness.js <bundled adminRoles.js>
// A fork without the Trial GM tier has nothing to test, which is said and not failed unless a gate expects it.
'use strict';
const fs = require('fs');
const path = require('path');

const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests/trial-gm-roles-harness.js <bundled adminRoles.js>'); process.exit(2); }
if (!/isTrialGmFrom/.test(fs.readFileSync(bundle, 'utf8'))) { require('./expect')('trial-gm-roles', 'this fork has no Trial GM tier'); console.log('ok   skipped: this fork has no Trial GM tier'); process.exit(0); }
const R = require(path.resolve(bundle));

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

const settings = { adminRoles: { senior: ['s1'], developer: [], leadgm: ['l1'], gm: ['g1'], trialgm: ['1558248795932860507'] }, adminRoleIds: ['x1'], adminProfileIds: [1] };
const cfg = R.readAdminRoleConfig(settings);
ok('adminRoles.trialgm is read', cfg.trialRoles.length === 1 && cfg.trialRoles[0] === '1558248795932860507', cfg.trialRoles);
ok('...and is no admin tier', !Object.keys(cfg.tierRoles).includes('trialgm') && !('trialgm' in R.TIER_CAPS), Object.keys(cfg.tierRoles));
const actors = { 1: { profileId: 5, roles: ['1558248795932860507'] }, 2: { profileId: 6, roles: ['1558248795932860507', 'g1'] }, 3: { profileId: 7, roles: ['g1'] },
  4: { profileId: 8, roles: ['p1'] }, 5: { profileId: 1, roles: ['1558248795932860507'] }, 6: { profileId: 9, roles: ['1558248795932860507', 'x1'] } };
const mp = { get: (a, k) => (k === 'profileId' ? actors[a].profileId : k === 'private.discordRoles' ? actors[a].roles : undefined) };
ok('a Trial GM: no admin tier, isTrialGm', R.adminTierOf(mp, 1, cfg) === null && R.isTrialGm(mp, 1, cfg) === true);
ok('GM and Trial GM roles together give GM, not Trial GM', R.adminTierOf(mp, 2, cfg) === 'gm' && R.isTrialGm(mp, 2, cfg) === false);
ok('an admin profile or the legacy admin role with the Trial role is senior', R.adminTierOf(mp, 5, cfg) === 'senior' && !R.isTrialGm(mp, 5, cfg) && R.adminTierOf(mp, 6, cfg) === 'senior' && !R.isTrialGm(mp, 6, cfg));
ok('a GM and a player are unchanged', R.adminTierOf(mp, 3, cfg) === 'gm' && !R.isTrialGm(mp, 3, cfg) && R.adminTierOf(mp, 4, cfg) === null && !R.isTrialGm(mp, 4, cfg));
ok('isTrialGmFrom answers from a profile and roles (character select has no actor yet)', R.isTrialGmFrom(5, ['1558248795932860507'], cfg) && !R.isTrialGmFrom(6, ['1558248795932860507', 'g1'], cfg) && !R.isTrialGmFrom(8, ['p1'], cfg));
const none = R.readAdminRoleConfig({ adminRoles: { gm: ['g1'] } });
ok('without the key nobody is a Trial GM', none.trialRoles.length === 0 && !R.isTrialGm(mp, 1, none) && R.adminTierOf(mp, 1, none) === null);
ok('a null settings object still reads', R.readAdminRoleConfig(null).trialRoles.length === 0);
ok('the panel allowlist is TP to a player or a location (Nate 12 Oct) and Rename, the Invisible and Ghost modes (Nate 12 Oct), and the Debug, Players, Teleport and Modes tabs',
  [...R.TRIAL_GM_ACTIONS].sort().join() === 'rename,teleportLoc,teleportTo' && [...R.TRIAL_GM_MODES].join() === 'invis,ghost' && R.TRIAL_GM_TABS.join() === 'debug,players,gmcalls,teleport,modes',
  [[...R.TRIAL_GM_ACTIONS], [...R.TRIAL_GM_MODES], R.TRIAL_GM_TABS]);
ok('...and the one data request besides the menu is the Teleport tab\'s list of locations',
  R.TRIAL_GM_REQUESTS instanceof Set && [...R.TRIAL_GM_REQUESTS].join() === 'adminLocationsRequest', R.TRIAL_GM_REQUESTS && [...R.TRIAL_GM_REQUESTS]);

console.log('');
console.log(fails ? `${fails} FAILURES` : 'all checks passed');
process.exit(fails ? 1 : 0);
