// Scripted test for gamemode.js's staffRolesSeen (2026-09-30): staff rights are read from the Discord roles written at
// login, so a demotion only took effect at the next login. The role sync hands a staff member's current roles to
// staffRolesSeen; a lower tier or none logs them out so the next login derives every right afresh. It cuts the tier
// code out of the gamemode and runs it with stubs. Run it from this folder's parent with
//
//   node tests/staff-demotion-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const a = src.indexOf('const tierFrom = ');
const b = src.indexOf('const TIER_LABEL', a);
if (a < 0 || b < 0) { console.log('FAIL the tier markers are gone from gamemode.js'); process.exit(1); }
const code = src.slice(a, b);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const ROLE = { senior: 's1', developer: 'd1', leadgm: 'l1', gm: 'g1', legacy: 'x1', player: 'p1' };
const actors = {
  0x10: { profile: 5, roles: [ROLE.senior], user: 1 },
  0x11: { profile: 6, roles: [ROLE.gm], user: 2 },
  0x12: { profile: 7, roles: [ROLE.leadgm], user: 3 },
  0x13: { profile: 1, roles: [], user: 4 },            // senior by profile (adminProfileIds)
  0x14: { profile: 8, roles: [ROLE.player], user: 5 },
};
const audits = [], told = [], kicked = [], logs = [];
const timers = [];
// The engine, over a table of characters: the roles stamped at login are private.discordRoles, the profile index lists every
// character of a profile (offline ones included)
const fakeMp = (table, kickTo) => ({
  kick: (u) => kickTo.push(u),
  get: (x, k) => { const o = table[x >>> 0]; if (!o) throw new Error(`no actor ${x}`); return k === 'private.discordRoles' ? o.roles : k === 'profileId' ? o.profile : undefined; },
  set: (x, k, v) => { const o = table[x >>> 0]; if (!o) throw new Error(`no actor ${x}`); if (k === 'private.discordRoles') o.roles = v; },
  getActorsByProfileId: (pid) => Object.keys(table).map(Number).filter((x) => table[x].profile === pid),
});
const T = new Function('ADMIN_PROFILES', 'TIERS', 'tierRoles', 'trialRoles', 'legacyAdminRoles', 'profileOf', 'rolesOf', 'idList', 'audit', 'who', 'personal', 'userOf', 'mp', 'log', 'setTimeout',
  code + '\nreturn { tierFrom, tierOf, staffRolesSeen, staffTierOf, accountRankOf: typeof accountRankOf === \'function\' ? accountRankOf : undefined };')(
  new Set([1]), ['senior', 'developer', 'leadgm', 'gm'], { senior: [ROLE.senior], developer: [ROLE.developer], leadgm: [ROLE.leadgm], gm: [ROLE.gm] }, ['t1'], [ROLE.legacy],
  (x) => actors[x].profile, (x) => actors[x].roles, (v) => (Array.isArray(v) ? v.map(String) : []),
  (t) => audits.push(t), (x) => `#${x.toString(16)}`, (x, t) => told.push([x, t]), (x) => actors[x].user,
  fakeMp(actors, kicked), (...a) => logs.push(a.join(' ')), (fn) => timers.push(fn));
const run = () => { while (timers.length) timers.shift()(); };

check('tierOf reads the login roles as before', T.tierOf(0x10) === 'senior' && T.tierOf(0x11) === 'gm' && T.tierOf(0x12) === 'leadgm' && T.tierOf(0x13) === 'senior' && T.tierOf(0x14) === null);

T.staffRolesSeen(0x10, [ROLE.gm]); run();
check('a Senior whose roles now give GM is logged out', kicked.includes(1) && /was senior/.test(audits[0] || '') && /now give gm/.test(audits[0] || ''), audits);
check('...and told why first', told.some(([x, t]) => x === 0x10 && /staff roles have changed/.test(t)));
T.staffRolesSeen(0x11, [ROLE.player]); run();
check('a GM whose staff role is gone is logged out', kicked.includes(2), kicked);
T.staffRolesSeen(0x12, []); run();
check('a Lead GM who left the guild is logged out', kicked.includes(3), kicked);

kicked.length = 0; audits.length = 0;
T.staffRolesSeen(0x11, [ROLE.gm, ROLE.player]); run();
check('the same tier: nothing happens', kicked.length === 0 && audits.length === 0);
T.staffRolesSeen(0x11, [ROLE.senior]); run();
check('a promotion is left for the next login (no logout)', kicked.length === 0, kicked);
T.staffRolesSeen(0x13, []); run();
check('a Senior by profile id is not affected by Discord roles', kicked.length === 0);
T.staffRolesSeen(0x14, []); run();
check('a player who is not staff is never logged out by this', kicked.length === 0);
T.staffRolesSeen(0x11, [ROLE.legacy]); run();
check('the legacy admin role still counts (as Senior)', kicked.length === 0);

// Trial GM (11 Oct): a fifth rank below GM, so losing the Trial role logs out and a promotion to GM does not
{
  const tActors = { 0x20: { profile: 30, roles: ['t1'], user: 7 }, 0x21: { profile: 31, roles: ['t1'], user: 8 }, 0x22: { profile: 32, roles: ['t1'], user: 9 } };
  const k2 = [], a2 = [], tm = [];
  const T2 = new Function('ADMIN_PROFILES', 'TIERS', 'tierRoles', 'trialRoles', 'legacyAdminRoles', 'profileOf', 'rolesOf', 'idList', 'audit', 'who', 'personal', 'userOf', 'mp', 'log', 'setTimeout',
    code + '\nreturn { staffRolesSeen, staffTierOf };')(
    new Set(), ['senior', 'developer', 'leadgm', 'gm'], { senior: [], developer: [], leadgm: [], gm: [ROLE.gm] }, ['t1'], [],
    (x) => tActors[x].profile, (x) => tActors[x].roles, (v) => (Array.isArray(v) ? v.map(String) : []),
    (t) => a2.push(t), (x) => `#${x.toString(16)}`, () => {}, (x) => tActors[x].user, { kick: (u) => k2.push(u) }, () => {}, (fn) => tm.push(fn));
  const run2 = () => { while (tm.length) tm.shift()(); };
  check('a Trial GM is seen as staff by the role sync (trialgm)', T2.staffTierOf(0x20) === 'trialgm', T2.staffTierOf(0x20));
  T2.staffRolesSeen(0x20, []); run2();
  check('a Trial GM whose Trial role is gone is logged out', k2.includes(7) && /was trialgm/.test(a2[0] || ''), a2);
  T2.staffRolesSeen(0x21, ['t1', ROLE.gm]); run2();
  check('...one promoted to GM is not', !k2.includes(8), k2);
  T2.staffRolesSeen(0x22, ['t1']); run2();
  check('...nor one whose roles are unchanged', !k2.includes(9), k2);
}

// A demotion reaches every character of the account (review of 22 Oct, PROVEN in a fake world): the rank rule counts each
// character's stamp, so an old stamp on a character not played since kept the account out of everyone's reach
{
  // Olga (profile 40): an Owner demoted to a player while online on Olga, with two characters she has not played since
  actors[0x40] = { profile: 40, roles: [ROLE.senior, ROLE.player], user: 40 };
  actors[0x41] = { profile: 40, roles: [ROLE.senior, ROLE.player, 'patron'] };
  actors[0x42] = { profile: 40, roles: [ROLE.player] };
  // Dev (profile 50): a Developer demoted to GM while offline, who logs in on Dev (stamped GM at that login); Dev Old keeps
  // the Developer stamp and Dev Lead a Lead GM one
  actors[0x50] = { profile: 50, roles: [ROLE.gm, ROLE.player], user: 50 };
  actors[0x51] = { profile: 50, roles: [ROLE.developer, ROLE.gm] };
  actors[0x52] = { profile: 50, roles: [ROLE.leadgm] };
  // Theo (profile 60): a Trial GM whose role is gone, with an old character stamped Trial GM; Lou (61): a GM promoted to Owner
  actors[0x60] = { profile: 60, roles: ['t1'], user: 60 };
  actors[0x61] = { profile: 60, roles: ['t1', ROLE.player] };
  actors[0x70] = { profile: 61, roles: [ROLE.gm], user: 61 };
  actors[0x71] = { profile: 61, roles: ['t1'] };
  // Ada (profile 1, Senior by the admin profiles) has a character stamped Developer
  actors[0x13a] = { profile: 1, roles: [ROLE.developer] };
  const rank = (pid) => T.accountRankOf(pid, null, 0);
  kicked.length = 0; audits.length = 0; logs.length = 0;
  check('R0. before the role sync sees it, the old stamps count: Olga is an Owner\'s account, Dev a Developer\'s (raise-only)', rank(40) === 4 && rank(50) === 3, [rank(40), rank(50)]);
  T.staffRolesSeen(0x40, [ROLE.player]); run();
  check('R1. an Owner demoted while online is logged out as before', kicked.includes(40) && audits.some((l) => /now give no staff tier \(was senior\); logged out/.test(l)), audits);
  check("R1. ...and the staff role comes off every character of her account, the ones not played since too; their other roles stay",
    JSON.stringify(actors[0x41].roles) === JSON.stringify([ROLE.player, 'patron']) && JSON.stringify(actors[0x40].roles) === JSON.stringify([ROLE.player])
    && JSON.stringify(actors[0x42].roles) === JSON.stringify([ROLE.player]), [actors[0x40].roles, actors[0x41].roles, actors[0x42].roles]);
  check('R1. ...so her account is no staff account any more (the rank rule reads 0), and the audit names the characters', rank(40) === 0
    && audits.some((l) => /profile 40 now gives that too: 40, 41$/.test(l)), { rank: rank(40), audits });
  kicked.length = 0; audits.length = 0;
  T.staffRolesSeen(0x50, [ROLE.gm, ROLE.player]); run();
  check('R2. a Developer demoted to GM while offline, who logs in on another character: nobody is logged out (that character is a GM by its login stamp)', kicked.length === 0, kicked);
  check("R2. ...but the role sync still brings his other characters' stamps down to GM: Dev Old [GM], Dev Lead [GM], never below what Discord gives now",
    JSON.stringify(actors[0x51].roles) === JSON.stringify([ROLE.gm]) && JSON.stringify(actors[0x52].roles) === JSON.stringify([ROLE.gm]) && rank(50) === 1, { roles: [actors[0x51].roles, actors[0x52].roles], rank: rank(50) });
  kicked.length = 0; audits.length = 0;
  T.staffRolesSeen(0x60, []); run();
  check('R3. a Trial GM whose role is gone: logged out, and the old character\'s Trial GM stamp goes too', kicked.includes(60) && JSON.stringify(actors[0x61].roles) === JSON.stringify([ROLE.player]) && rank(60) === 0, actors[0x61].roles);
  kicked.length = 0; audits.length = 0;
  T.staffRolesSeen(0x70, [ROLE.senior]); run();
  check('R4. a promotion changes no stamp (the next login writes it; a lower stamp never decides the rank)', kicked.length === 0 && audits.length === 0 && JSON.stringify(actors[0x71].roles) === JSON.stringify(['t1']) && JSON.stringify(actors[0x70].roles) === JSON.stringify([ROLE.gm]));
  T.staffRolesSeen(0x50, [ROLE.gm]); run();
  check('R4. ...nor does the same tier again: nothing to change, no audit line', audits.length === 0 && JSON.stringify(actors[0x51].roles) === JSON.stringify([ROLE.gm]), audits);
  T.staffRolesSeen(0x13, []); run();
  check("R4. ...nor a Senior by profile id: Ada's character stamped Developer keeps it", audits.length === 0 && JSON.stringify(actors[0x13a].roles) === JSON.stringify([ROLE.developer]), actors[0x13a].roles);
}
{
  // The same, with the engine's profile index misbehaving: a stale entry from another profile, then an index that throws
  const tab = { 0x90: { profile: 80, roles: [ROLE.leadgm], user: 90 }, 0x91: { profile: 81, roles: [ROLE.leadgm] } };
  const k3 = [], a3 = [], l3 = [], tm3 = [];
  const mp3 = fakeMp(tab, k3);
  const index = mp3.getActorsByProfileId;
  mp3.getActorsByProfileId = (pid) => (pid === 80 ? [0x90, 0x91] : index(pid));
  const T3 = new Function('ADMIN_PROFILES', 'TIERS', 'tierRoles', 'trialRoles', 'legacyAdminRoles', 'profileOf', 'rolesOf', 'idList', 'audit', 'who', 'personal', 'userOf', 'mp', 'log', 'setTimeout',
    code + '\nreturn { staffRolesSeen };')(
    new Set(), ['senior', 'developer', 'leadgm', 'gm'], { senior: [ROLE.senior], developer: [ROLE.developer], leadgm: [ROLE.leadgm], gm: [ROLE.gm] }, [], [],
    (x) => tab[x].profile, (x) => tab[x].roles, (v) => (Array.isArray(v) ? v.map(String) : []), (t) => a3.push(t), (x) => `#${x.toString(16)}`, () => {}, (x) => tab[x].user,
    mp3, (...a) => l3.push(a.join(' ')), (fn) => tm3.push(fn));
  T3.staffRolesSeen(0x90, []); while (tm3.length) tm3.shift()();
  check("R5. a character of another profile in the index (a stale entry) keeps its stamp", JSON.stringify(tab[0x91].roles) === JSON.stringify([ROLE.leadgm]) && JSON.stringify(tab[0x90].roles) === JSON.stringify([]) && k3.includes(90), [tab[0x90].roles, tab[0x91].roles, k3]);
  tab[0x90].roles = [ROLE.leadgm]; k3.length = 0;
  mp3.getActorsByProfileId = () => { throw new Error('index gone'); };
  T3.staffRolesSeen(0x90, []); while (tm3.length) tm3.shift()();
  check('R5. an index that cannot be read: the demoted character is still logged out, and the log says why', k3.includes(90) && l3.some((l) => /characters of profile 80 unreadable: index gone/.test(l)), { k3, l3 });
}

check('discordroles.js is given isStaff and staffRolesSeen', /require\(DISCORDROLES_JS\)\(\{[\s\S]*?isStaff: \(a\) => staffTierOf\(a\) !== null[^\n]*, staffRolesSeen \}\)/.test(src));
check("R6. ...and isStaff holds while any character of the account carries a staff stamp, so the role sync reads a demoted account's roles from whichever character is played",
  /isStaff: \(a\) => staffTierOf\(a\) !== null \|\| accountRankOf\(profileOf\(a\), null, a\) !== 0, staffRolesSeen \}\)/.test(src));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
