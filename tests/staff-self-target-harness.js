// Staff tools never act on the acting staff member's own account (staffguard.js selfTarget; the owner's staff-conduct review,
// 23 Oct 2026: free character-creation reopenings, self-renames, own staff character put in a hold faction): items, skills,
// mastery, faction ranks and membership, halls, offices, renames and appearance reopenings are refused on any character of
// one's own profile. Another staff member's account takes a Lead GM or above, and every such use is audited. The Owners pass.
// Checks the rule, the F7 panel's gate, a real /rename cut from gamemode.js, and that every tool asks it.
//   node tests/staff-self-target-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, CAST, load, call, check, done } = require('./lib/staffguard-fakes');
const { OWNER, OWNER_RP, LEAD, LEAD_RP, LEAD2, GM, GM_RP, GM2, MIRA, MIRA_ALT } = Object.fromEntries(Object.entries(CAST).map(([k, v]) => [k, v.id]));

const SELF = /^Staff tools never act on your own characters\./;
let f = load({});
let G = f.G;

for (const kind of ['items', 'skills', 'powers', 'faction', 'hall', 'office', 'rename', 'appearance', 'citizenship']) {
  check(`${kind}: refused on the staff member's own RP character`, SELF.test(G.target(LEAD, LEAD_RP, kind)), G.target(LEAD, LEAD_RP, kind));
}
check('...and on their own staff character (oneself)', SELF.test(G.target(GM, GM, 'items')) && SELF.test(G.target(LEAD, LEAD, 'appearance')));
check('...and on their account by profile (an office, a hall)', SELF.test(G.target(GM, { profile: 30 }, 'office')) && SELF.test(G.target(LEAD, { profile: 20 }, 'hall')));
check('a player\'s character passes (skills, items)', G.target(LEAD, MIRA, 'skills') === '' && G.target(GM, MIRA, 'items') === '' && G.target(LEAD, MIRA_ALT, 'appearance') === '');

// ---- another staff member's account ----
f.audits.length = 0;
check('a GM is refused on another staff member\'s account', /^Only a Lead GM or above uses staff tools on another staff member/.test(G.target(GM, GM2, 'items')) && /^Only a Lead GM/.test(G.target(GM, LEAD_RP, 'appearance')));
check('...with no audit line (nothing was done)', f.audits.length === 0, f.audits);
check('a Lead GM may act on another staff member\'s account', G.target(LEAD, GM_RP, 'skills') === '' && G.target(LEAD, LEAD2, 'items') === '');
check('...and each such use is audited, naming the kind and the account', f.audits.length === 2 && /^STAFFGUARD GM Leda #LEAD \(profile 20\) used a staff tool \(skills\) on the staff account of Katell #KATE \(profile 30\)$/.test(f.audits[0]), f.audits);
f.audits.length = 0;
G.target(LEAD, MIRA, 'skills');
check('a player\'s account is not a staff account: no staff audit line', f.audits.length === 0, f.audits);

// ---- the Owners ----
check('an Owner may act on their own characters', G.target(OWNER, OWNER_RP, 'appearance') === '' && G.target(OWNER_RP, OWNER, 'items') === '');
check('...and on any staff account', G.target(OWNER, GM, 'rename') === '');

// ---- an unreadable rank refuses ----
{
  const g = load({});
  g.api.accountRankOf = () => -1;
  delete require.cache[require('./lib/staffguard-fakes').MOD];
  const G2 = require(require('./lib/staffguard-fakes').MOD)(g.api);
  check('an account whose rank cannot be read is refused, never guessed', /rank cannot be read/.test(G2.target(LEAD, MIRA, 'items')));
}

// ---- the F7 panel (fork adminSystem asks __dboAdminGate with the target) ----
f = load({}); G = f.G;
const gate = globalThis.__dboAdminGate;
for (const action of ['giveItem', 'masterySetTier', 'masteryDrop', 'masteryGrant', 'masteryReset', 'setSchool', 'giveWerewolf', 'giveVampireLord', 'giveDisease', 'giveCurse', 'beastForm']) {
  check(`panel ${action} on oneself (no name) is refused`, SELF.test(gate(LEAD, action, { target: LEAD })), gate(LEAD, action, { target: LEAD }));
}
check('panel grants on a player pass', gate(LEAD, 'giveItem', { target: MIRA }) === '' && gate(LEAD, 'masterySetTier', { target: MIRA }) === '');
check('panel teleports and kicks are not target-limited by this rule', gate(LEAD, 'teleportTo', { target: GM2 }) === '' && gate(LEAD, 'kick', { target: GM2 }) === '');

// ---- switches ----
{
  const off = load({ selfTarget: { enabled: false }, callRef: { enabled: false } }).G;
  check('selfTarget.enabled false: own characters pass again', off.target(LEAD, LEAD_RP, 'items') === '' && off.target(GM, GM2, 'items') === '');
  const any = load({ selfTarget: { staffNeedsLead: false } }).G;
  check('staffNeedsLead false: a GM acts on another staff account, own still refused', any.target(GM, GM2, 'items') === '' && SELF.test(any.target(GM, GM_RP, 'items')));
}

// ---- a real /rename and the F7 Rename, cut from gamemode.js ----
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
{
  f = load({});
  const a = src.indexOf('const renameCharacter = '), b = src.indexOf("registerChatCommand('rename'", a);
  check('gamemode.js: renameCharacter is there', a > 0 && b > a);
  const names = new Map([[MIRA, 'Mira'], [LEAD_RP, 'Leda the Bold']]);
  const told = [];
  const mp = { get: (t, k) => (k === 'appearance' ? { name: names.get(t) } : undefined), set: (t, k, v) => { if (k === 'appearance') names.set(t, v.name); } };
  const { rename } = new Function('NAME_RE', 'mp', 'indexName', 'system', 'audit', 'who', 'tagOf', 'profileOf', 'staffCan',
    `${src.slice(a, b)}\nreturn { rename: renameCharacter };`)(/^[A-Za-z][A-Za-z' \-]{1,30}$/, mp, () => {}, (t, x) => told.push([t, x]), f.api.audit, f.api.who, (t) => CAST.MIRA.tag, f.api.profileOf, () => true);
  const self = rename(LEAD, LEAD_RP, 'Leda Reborn');
  check('/rename of one\'s own RP character is refused, and the name stays', !self.ok && SELF.test(self.text) && names.get(LEAD_RP) === 'Leda the Bold', self);
  call(7, 50, 20);
  const ok = rename(LEAD, MIRA, 'Mirabelle');
  check('/rename of a player with the call held goes through', ok.ok && names.get(MIRA) === 'Mirabelle', ok);
  check('gamemode.js: /chargen asks the rule (appearance) after the Trial GM line', /if \(trialOnly && \(t >>> 0\) !== \(a >>> 0\)\)[^\n]*\n\s*const no = \(\(\) => \{ try \{ const g = globalThis\.__dboStaffGuard; return g \? String\(g\.target\(a, t, 'appearance'\)/.test(src));
  check('gamemode.js: /appoint (Lead GM) and /dismiss (staff) ask it for the office', /if \(isLeadStaff\(a\)\) \{ const no = [^\n]*g\.target\(a, \{ profile: tg\.pid \}, 'office'\)/.test(src) && /if \(isAdmin\(a\)\) \{ const no = [^\n]*g\.target\(a, \{ profile: tg\.pid \}, 'office'\)/.test(src));
}

// ---- every tool asks the rule ----
const has = (file, re) => re.test(fs.readFileSync(path.join(ROOT, file), 'utf8'));
check('guilds.js: staff remove, rank, add, leader, override, remove-by-name and hall marks ask it',
  has('guilds.js', /const staffNo = \(a, t, kind\) => \{ if \(!leadStaff\(a\)\) return ''/)
  && (fs.readFileSync(path.join(ROOT, 'guilds.js'), 'utf8').match(/staffNo\(a, /g) || []).length === 7
  && has('guilds.js', /staffNo\(a, \{ profile: Number\(rec\.owner\) \}, 'hall'\)/));
check('citizenship.js: a staff grant, decline and revoke ask it (not a ruler\'s or Steward\'s own)', has('citizenship.js', /if \(!isLeadStaff\(by\) \|\| \(z && \(rules\(by, z\) \|\| isSteward\(by, z\)\)\)\) return '';/)
  && (fs.readFileSync(path.join(ROOT, 'citizenship.js'), 'utf8').match(/staffNo\(by, /g) || []).length === 3);
check('schools.js /schools set and the panel\'s school, manuals.js grant, smithing.js teach|forget, appearance.js /grantappearance, staffenchant.js apply',
  has('schools.js', /g\.target\(by, t, 'skills'\)/) && has('manuals.js', /g\.target\(a, t, 'items'\)/) && has('smithing.js', /g\.target\(a, t, 'skills'\)/)
  && has('appearance.js', /g\.target\(a, t, 'appearance'\)/) && has('staffenchant.js', /g\.target\(a, t, 'items'\)/));
void [GM_RP, MIRA_ALT];
done();
