// Scripted test for citizenship.js's staff releases (Jake, 16 Oct 2026): config citizenship.staffReleases =
// [{ id, pid, actors?, zones?, by, why }] is a staff revoke written in config, applied once at load (and so at a hot reload
// of the config) and never again. Loads the real module in a scratch folder against a mock world, the rolls seeded in
// citizenship.json the way the live file holds them: one profile with three characters (one granted in Bruma with a
// cooldown running, two free in Whiterun, one of them in a faction based in Bruma), a fourth character of it with a
// pending request, and other players who must not be touched.
//
//   node tests/citizenship-staff-release-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'citizenship.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-citizen-release-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
let now = Date.UTC(2026, 9, 16, 22, 0);
Date.now = () => now;
const HOUR = 3600000, DAY = 24 * HOUR;

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

// ---- the world ---------------------------------------------------------------------------------------------------------
const ZONES = [
  { id: 'bruma', name: 'Bruma', treasury: 'x', officials: ['count', 'steward', 'captain', 'guard'] },
  { id: 'whiterun', name: 'Whiterun', treasury: 'y', officials: ['jarl', 'steward', 'commander', 'guard'] },
  { id: 'riften', name: 'The Rift', treasury: 'z', officials: ['jarl', 'steward', 'commander', 'guard'] },
  { id: 'gol-kharzum', name: 'Gol-Kharzum', officials: ['chieftain', 'bane'] },
];
const officials = { bruma: { count: [1] }, riften: { jarl: [2] } };
const chars = new Map();
const add = (id, pid, name) => { chars.set(id >>> 0, { pid, name }); return id >>> 0; };
const COUNT = add(0x10, 1, 'Count Carvain');
// The profile released: three characters on the rolls and a fourth with a pending request only
const P = 55; // the profile of today's config entry; every name, tag and form id below is made up
const FIRST = add(0xff0010a1, P, 'Aela Testborn');
const SECOND = add(0xff0010a2, P, 'Brand Testborn');
const THIRD = add(0xff0010a3, P, 'Cato Testborn');
const ASKER = add(0xff0010a4, P, 'Dagny Asker');
// Other players, never touched by profile 55's release
const OTHER = add(0xff003000, 56, 'Other Player');
const OTHER2 = add(0xff003001, 56, 'Other Asker');
const P57A = add(0xff004000, 57, 'Seventh A');
const P57B = add(0xff004001, 57, 'Seventh B');
const EMPTY = add(0xff005000, 58, 'Never Joined');
const STAFF = add(0x30, 30, 'Staff Lead');
let online = [COUNT, FIRST, THIRD, ASKER, OTHER, OTHER2, P57A, STAFF];
// The third is in the Fighters Guild, whose hall is in Bruma: a citizen of Bruma through it (auto)
const guilds = new Map([[THIRD, [{ id: 'fighters-guild', name: 'Fighters Guild', title: 'Guardian', role: 'member', kind: 'guild', zone: '', hall: { zone: 'bruma' } }]]]);
globalThis.__dboGuildsOf = (a) => guilds.get(a >>> 0) || [];
globalThis.__dboCourtFaction = (z) => ({ bruma: 'county-bruma', whiterun: 'hold-whiterun' })[z] || null;
globalThis.__dboGuildHolders = () => [];
globalThis.__dboFactionList = () => ['fighters-guild'];
globalThis.__dboGuildInfo = () => null;
globalThis.__dboGuildMembers = () => [];
globalThis.__dboJournalFresh = () => true;
globalThis.__dboJournalLimited = () => {};

const mp = { get: (id, p) => { const c = chars.get(id >>> 0); if (!c) throw new Error('no such form'); if (p === 'type') return 'MpActor'; if (p === 'profileId') return c.pid; return undefined; } };
const said = [], audits = [], logs = [];
let writes = 0;
const realWrite = fs.writeFileSync;
fs.writeFileSync = (f, ...rest) => { if (/citizenship\.json\.tmp$/.test(String(f))) writes++; return realWrite.call(fs, f, ...rest); };
const ROLE = { bruma: '1500000000000000001', whiterun: '1500000000000000002' };
let citizenCfg = {};
const api = () => ({
  mp, log: (...x) => logs.push(x.join(' ')), audit: (t) => audits.push(t),
  // The gamemode's who() names a Discord account: a staff release must never put one in its audit
  who: (a) => `${(chars.get(a >>> 0) || {}).name || `actor ${a}`} (profile ${(chars.get(a >>> 0) || {}).pid}, <@111111111111111111>)`,
  personal: (a, t) => said.push([a >>> 0, t]), nameOf: (a) => chars.get(a >>> 0).name, ownNameOf: (a) => chars.get(a >>> 0).name, tagOf: () => 'TAG1',
  onUi: () => {}, onlineActors: () => online.slice(), isAdmin: (a) => a === STAFF, isLeadStaff: (a) => a === STAFF,
  profileOf: (a) => { const c = chars.get(a >>> 0); return c ? c.pid : -1; },
  cfg: { citizenship: Object.assign({ discordRoles: ROLE }, JSON.parse(JSON.stringify(citizenCfg))) },
  every: () => {},
  zoneList: () => ZONES, zoneById: (id) => ZONES.find((z) => z.id === String(id)) || null, readOfficials: () => officials,
  rankTitle: (r) => ({ count: 'Count', jarl: 'Jarl', steward: 'Steward', commander: 'Lord Commander' })[r] || r,
  officialTarget: () => ({ error: 'none' }),
  accountActors: (pid) => [...chars.entries()].filter(([, c]) => c.pid === pid).map(([id]) => id),
  seatOfficial: () => ({ text: 'seated' }), unseatOfficialBy: () => ({ text: 'unseated' }),
  takeGold: () => true, depositToTreasury: (z, n) => n, openWidget: () => true, closeWidget: () => true, boardZoneNear: () => null, raceEdidOf: () => 'NordRace',
});
let M = null;
let threw = null;
const load = () => { delete require.cache[MODULE]; threw = null; try { M = require(MODULE)(api()); } catch (e) { threw = e; } return M; };
const restart = () => { delete globalThis.__dboCitizen; return load(); };
const told = (a) => said.filter(([x]) => x === (a >>> 0)).map(([, t]) => t);
const onDisk = () => JSON.parse(fs.readFileSync(path.join(dir, 'citizenship.json'), 'utf8'));
const hx = (a) => (a >>> 0).toString(16);
const applied = () => (M && M.data().staffApplied) || [];

// ---- the rolls, as the live file holds them ---------------------------------------------------------------------------
const COOL = Date.UTC(2026, 9, 23, 5, 18, 22, 552);
const GRANT_HOW = 'granted by Count Testwell #TST1 (profile 90, <@222222222222222222>)';
const seed = {
  chars: {
    [hx(FIRST)]: { pid: P, name: 'Aela Testborn', holds: [{ zone: 'bruma', since: now - DAY, how: GRANT_HOW }], cooldownUntil: COOL, renounced: [{ zone: 'riften', at: now - 17 * HOUR }] },
    [hx(SECOND)]: { pid: P, name: 'Brand Testborn', holds: [{ zone: 'whiterun', since: now - 2 * HOUR, how: 'free (no ruler)' }], renounced: [] },
    [hx(THIRD)]: { pid: P, name: 'Cato Testborn', holds: [{ zone: 'whiterun', since: now - HOUR, how: 'free (no ruler)' }], renounced: [] },
    [hx(OTHER)]: { pid: 56, name: 'Other Player', holds: [{ zone: 'bruma', since: now - DAY, how: 'free' }, { zone: 'whiterun', since: now - DAY, how: 'free (no ruler)' }], renounced: [] },
    [hx(P57A)]: { pid: 57, name: 'Seventh A', holds: [{ zone: 'whiterun', since: now - DAY, how: 'free (no ruler)' }], renounced: [] },
    [hx(P57B)]: { pid: 57, name: 'Seventh B', holds: [{ zone: 'whiterun', since: now - DAY, how: 'free (no ruler)' }], renounced: [] },
  },
  requests: [
    { zone: 'bruma', actor: ASKER, pid: P, name: 'Dagny Asker', at: now - HOUR },
    { zone: 'riften', actor: OTHER2, pid: 56, name: 'Other Asker', at: now - HOUR },
  ],
  policies: { bruma: { policy: 'manual', fee: 0, by: 'x', at: now - DAY }, riften: { policy: 'manual', fee: 0, by: 'x', at: now - DAY } },
  elections: {},
};
fs.writeFileSync(path.join(dir, 'citizenship.json'), JSON.stringify(seed));
const otherBefore = JSON.stringify(seed.chars[hx(OTHER)]);

// ---- today's entry, among bad ones that must be skipped without a throw -------------------------------------------------
const TODAY = { id: 'jake-1016-release-p55', pid: 55, by: 'Jake (owner) via claude-jake', why: 'staff release requested 16 Oct' };
const BAD = [
  { pid: 55, by: 'x' },                                         // no id
  { id: 'no-pid', by: 'x' },                                    // no pid
  { id: 'neg-pid', pid: -1 },                                   // a pid below 0
  { id: 'unknown-zone', pid: 55, zones: ['atlantis'] },         // no such hold
  { id: 'stronghold', pid: 55, zones: ['gol-kharzum'] },        // a land that grants no citizenship
  { id: 'zones-not-list', pid: 55, zones: 'whiterun' },
  { id: 'not-theirs', pid: 55, actors: [hx(OTHER)] },           // a character of another profile
  { id: 'bad hex', pid: 55, actors: ['zz-top'] },               // a bad id (space) is caught before the actor
  'a string', null, 42,
];
citizenCfg = { staffReleases: [BAD[0], BAD[1], TODAY, ...BAD.slice(2)] };
writes = 0;
load();
ok(!threw && M && typeof M.staffReleases === 'function', 'the module loads with today\'s entry and every bad entry, and has a staff release', threw && threw.message);

// ---- profile 55 is released from every citizenship on the rolls -----------------------------------------------------------
const C = (a, z) => !!(M && M.citizenOf(a, z));
ok(!C(FIRST, 'bruma'), 'the granted Bruma citizenship is released');
ok(!C(SECOND, 'whiterun'), 'the free Whiterun citizenship of the second character is released');
ok(!C(THIRD, 'whiterun'), 'the free Whiterun citizenship of the third character is released');
ok(C(THIRD, 'bruma') && M.holdsOf(THIRD).length === 1 && M.holdsOf(THIRD)[0].auto, 'the faction citizenship of Bruma (Fighters Guild hall) is untouched: it is not on the rolls', M && M.holdsOf(THIRD));
const d = M ? M.data() : { chars: {}, requests: [], staffApplied: [] };
ok([FIRST, SECOND, THIRD].every((a) => d.chars[hx(a)] && Array.isArray(d.chars[hx(a)].holds) && d.chars[hx(a)].holds.length === 0), 'no explicit hold is left on any of the three', [FIRST, SECOND, THIRD].map((a) => d.chars[hx(a)] && d.chars[hx(a)].holds));
ok(d.chars[hx(FIRST)].cooldownUntil === COOL, 'the cooldown running on the first character is left exactly as it was', d.chars[hx(FIRST)].cooldownUntil);
ok(!('cooldownUntil' in d.chars[hx(SECOND)]) && !('cooldownUntil' in d.chars[hx(THIRD)]), 'no cooldown is added to the others');
ok(JSON.stringify(d.chars[hx(FIRST)].renounced) === JSON.stringify(seed.chars[hx(FIRST)].renounced), 'the renounced list is unchanged (a release is no renouncing)');
ok(!d.requests.some((r) => Number(r.pid) === P || (r.actor >>> 0) === ASKER), "the profile's pending request (a fourth character, not on the rolls) is withdrawn", d.requests);
ok(d.requests.some((r) => (r.actor >>> 0) === OTHER2 && r.zone === 'riften'), "another player's request stays");
ok(JSON.stringify(d.chars[hx(OTHER)]) === otherBefore && C(OTHER, 'bruma') && C(OTHER, 'whiterun'), 'another player\'s citizenships are untouched');
ok(C(P57A, 'whiterun') && C(P57B, 'whiterun'), 'a third profile is untouched');
ok(writes === 1, 'the rolls are saved once', writes);

// ---- what is kept and written ------------------------------------------------------------------------------------------
const rec = (d.staffApplied || []).find((x) => x.id === TODAY.id);
ok(rec && rec.pid === P && rec.removed.length === 3 && rec.requests.length === 1 && rec.kept.length === 1, 'the applied list records the id with the three holds removed, the request and the faction citizenship kept', rec);
ok(rec && rec.removed.find((x) => x.actor === hx(FIRST)).how === GRANT_HOW && rec.removed.find((x) => x.actor === hx(FIRST)).since === seed.chars[hx(FIRST)].holds[0].since, 'each removed hold is kept whole, so staff can put it back by hand');
ok((d.staffApplied || []).length === 1, 'no bad entry is recorded as applied', (d.staffApplied || []).map((x) => x.id));
const disk = onDisk();
ok(Array.isArray(disk.staffApplied) && disk.staffApplied.length === 1 && disk.staffApplied[0].id === TODAY.id, 'the applied list is saved in citizenship.json', disk.staffApplied && disk.staffApplied.map((x) => x.id));
ok(disk.chars[hx(FIRST)].holds.length === 0 && disk.chars[hx(FIRST)].cooldownUntil === COOL, 'the file holds the release and the old cooldown');

// ---- the audit -----------------------------------------------------------------------------------------------------------
const rel = audits.filter((t) => /^CITIZEN STAFF Jake \(owner\) via claude-jake released /.test(t));
ok(rel.length === 3, 'one audit line per citizenship released', audits);
ok(rel.some((t) => t.includes('released Aela Testborn from the citizenship of Bruma (character ff0010a1; staff release jake-1016-release-p55: staff release requested 16 Oct)')), "in revoke()'s style: who asked, the character's name, the hold, the character hex, the entry", rel);
ok(rel.some((t) => /Brand Testborn from the citizenship of Whiterun \(character ff0010a2/.test(t)) && rel.some((t) => /Cato Testborn from the citizenship of Whiterun \(character ff0010a3/.test(t)), 'the two Whiterun releases are each named');
ok(audits.some((t) => /^CITIZEN STAFF .* withdrew Dagny Asker's request for the citizenship of Bruma \(character ff0010a4/.test(t)), 'the withdrawn request is audited');
ok(audits.some((t) => /^CITIZEN STAFF .* could not release Cato Testborn from the citizenship of Bruma \(character ff0010a3\): it comes from a faction or court/.test(t)), 'the faction citizenship that cannot be released is reported in the audit');
ok(audits.every((t) => !/<@|\d{15,22}/.test(t)), 'no Discord mention or id in any audit line, though a removed hold\'s how names one', audits.filter((t) => /<@|\d{15,22}/.test(t)));
ok(audits.length === 5, 'nothing else is audited', audits.length);

// ---- the characters are told, if online -------------------------------------------------------------------------------------
ok(told(FIRST).some((t) => /The staff have released you from the citizenship of Bruma\./.test(t)), 'the first character, online, is told', told(FIRST));
ok(told(THIRD).some((t) => /released you from the citizenship of Whiterun\. You remain a citizen of Bruma through a faction or court based there\./.test(t)), 'the third is told, and that Bruma stays through the faction', told(THIRD));
ok(told(SECOND).length === 0, 'the second, offline, is not told');
ok(told(ASKER).some((t) => /request for the citizenship of Bruma was withdrawn by the staff/.test(t)), 'the asker is told the request is withdrawn', told(ASKER));
ok(told(OTHER).length === 0 && told(OTHER2).length === 0, 'nobody else is told');

// ---- Discord roles follow the rolls (discordroles.js reads __dboCitizenRoleIds at its next sync) ---------------------------
ok(JSON.stringify(globalThis.__dboCitizenRoleIds(FIRST)) === '[]' && JSON.stringify(globalThis.__dboCitizenRoleIds(SECOND)) === '[]', 'the released characters wear no citizen role at their next role sync');
ok(JSON.stringify(globalThis.__dboCitizenRoleIds(THIRD)) === JSON.stringify([ROLE.bruma]), 'the third keeps only the Bruma role, from the faction citizenship');
ok(globalThis.__dboCitizenOf(FIRST, 'bruma') === false && globalThis.__dboCitizenOf(SECOND, 'whiterun') === false, 'the property gate asks the new rolls');

// ---- bad entries: skipped with a log line, never applied -----------------------------------------------------------------
const skip = (re) => logs.some((l) => /citizenship: staff release .*skipped: /.test(l) && re.test(l));
ok(skip(/\(entry 1\) skipped: no id/), 'an entry with no id is skipped and logged', logs);
ok(skip(/no-pid .*no profile id/) && skip(/neg-pid .*no profile id/), 'an entry with no pid, or one below 0, is skipped and logged');
ok(skip(/unknown-zone .*unknown hold atlantis/), 'an unknown hold skips its entry');
ok(skip(/stronghold .*unknown hold gol-kharzum/), 'a land that grants no citizenship skips its entry');
ok(skip(/zones-not-list .*no list of holds/), 'zones that are no list skip the entry');
ok(skip(/not-theirs .*character ff003000 is not one of profile 55's/), 'a character of another profile skips the entry');
ok(skip(/\(entry 9\) skipped: a bad id/), 'an id with a space is refused');
ok(skip(/\(entry 10\) skipped: not an object/) && skip(/\(entry 11\) skipped: not an object/) && skip(/\(entry 12\) skipped: not an object/), 'a string, null or a number is skipped');
ok(logs.some((l) => /staff releases: 1 applied now \(jake-1016-release-p55: 3 released, 1 request\(s\) withdrawn, 1 faction or court citizenship\(s\) kept\), 0 applied before, 11 skipped/.test(l)), 'one summary line', logs.filter((l) => /staff releases:/.test(l)));

// ---- applied once only ------------------------------------------------------------------------------------------------------
const quiet = () => { const a = audits.length, s = said.length; writes = 0; return () => audits.length === a && said.length === s && writes === 0; };
let still = quiet();
load(); // a hot reload: the rolls stay in memory
ok(!threw && still() && applied().length === 1, 'a hot reload with the same config does nothing: no audit, no message, no save', [threw && threw.message, audits.slice(-3)]);
still = quiet();
restart(); // a restart: the rolls come from the file
ok(!threw && still() && applied().length === 1, 'a restart (the rolls read from citizenship.json) does nothing again', [threw && threw.message, audits.slice(-3)]);
// The player joins again later: the entry does not take it away again
let r = M.join(SECOND, 'whiterun');
ok(!r.error && C(SECOND, 'whiterun'), 'the second character may join Whiterun again (no cooldown was added)', r);
r = M.join(FIRST, 'whiterun');
ok(r.error && /renounced a citizenship lately/.test(r.error), 'the first character is still held by the cooldown it had', r);
still = quiet();
load(); restart();
ok(!threw && C(SECOND, 'whiterun') && still(), 'a re-join is NOT revoked again by a later reload or restart');

// ---- a new entry added later applies at the next config reload; zones and actors narrow it --------------------------------
citizenCfg = { staffReleases: [TODAY, { id: 'zones-only', pid: 56, zones: ['whiterun'], by: 'staff <@333333333333333333>', why: 'test 444444444444444444' },
  { id: 'one-char', pid: 57, actors: ['0x' + hx(P57A).toUpperCase()], by: 'staff' }, { id: 'nothing-there', pid: 58, by: 'staff' }] };
audits.length = 0; writes = 0;
load();
ok(!threw && !C(OTHER, 'whiterun') && C(OTHER, 'bruma'), 'zones: only the listed hold is released, the other stays', M.holdsOf(OTHER));
ok(C(OTHER2, 'riften') === false && M.data().requests.some((q) => (q.actor >>> 0) === OTHER2 && q.zone === 'riften'), 'zones: a request to another hold stays');
ok(!C(P57A, 'whiterun') && C(P57B, 'whiterun'), 'actors: only the listed character is released (hex in any case, with 0x)');
ok(audits.some((t) => /found no citizenship of profile 58 to release/.test(t)), 'an entry that finds nothing says so once', audits);
ok(applied().map((x) => x.id).join() === 'jake-1016-release-p55,zones-only,one-char,nothing-there', 'each new id is recorded; today\'s is not applied twice', applied().map((x) => x.id));
ok(audits.every((t) => !/<@|\d{15,22}/.test(t)) && audits.some((t) => /^CITIZEN STAFF staff released Other Player from the citizenship of Whiterun \(character ff003000; staff release zones-only: test\)$/.test(t)), 'a Discord mention or id in by or why is taken out of the audit', audits);
ok(writes === 1, 'saved once for the three new entries', writes);
ok(C(SECOND, 'whiterun'), "today's entry still leaves the re-joined character alone");

// ---- a broken list never throws; staff off applies nothing ------------------------------------------------------------------
citizenCfg = { staffReleases: 'everyone' };
logs.length = 0; load();
ok(!threw && logs.some((l) => /staffReleases is not a list/.test(l)), 'staffReleases that is no list is logged, and the module loads', threw && threw.message);
citizenCfg = { enabled: false, staffReleases: [{ id: 'while-off', pid: 57 }] };
load();
ok(!threw && !applied().some((x) => x.id === 'while-off') && M.data().chars[hx(P57B)].holds.length === 1, 'citizenship switched off: no release is applied');
citizenCfg = { staffReleases: [{ id: 'while-off', pid: 57 }] };
load();
ok(!threw && applied().some((x) => x.id === 'while-off') && !C(P57B, 'whiterun'), '...it applies once citizenship is on again');

// ---- the staff revoke still works as before ---------------------------------------------------------------------------------
r = M.revoke(STAFF, 'whiterun', SECOND);
ok(!r.error && !C(SECOND, 'whiterun'), "the in-game revoke is unchanged");

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
