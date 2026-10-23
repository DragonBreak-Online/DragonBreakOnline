// The Guild tab of the F3 Faction panel (playerguilds.js __dboGuildTabView + its guildTab* panel events, 23 Oct): the
// payload's band view (rules, the guild, why one is refused, invitations), each button running the /guild command's own
// checks, the refusal text drawn in the panel, a stale nonce ignored, and a hot reload keeping invitations. Real
// guilds.js, charters.js, playerguilds.js and the live guild-defs.json and gamemode-config.json, stub api, in a temp folder.
//
//   node tests/guild-tab-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GUILDS = path.join(ROOT, 'guilds.js');
const PG = path.join(ROOT, 'playerguilds.js');
const CHARTERS = path.join(ROOT, 'charters.js');
if (!fs.existsSync(PG) || !/__dboGuildTabView/.test(fs.readFileSync(PG, 'utf8'))) {
  require('./expect')('guild-tab', 'there is no Guild tab in this line');
  console.log('ok   skipped: no Guild tab in this line'); process.exit(0);
}
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const DEFS = JSON.parse(fs.readFileSync(path.join(ROOT, 'guild-defs.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-guildtab-'));
fs.copyFileSync(path.join(ROOT, 'guild-defs.json'), path.join(dir, 'guild-defs.json'));
for (const f of ['zones.json', 'skills.json', 'journal-prose-filter.json']) {
  try { fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)); } catch (e) { /* optional */ }
}
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!cond) fails++; };

const MASTER = 0x14, FRIEND = 0x15, THIRD = 0x16, FACTIONED = 0x17, PRIEST = 0x18, MAGE = 0x19, GM = 0x10;
const NAMES = { [MASTER]: 'Master', [FRIEND]: 'Friend', [THIRD]: 'Third', [FACTIONED]: 'Factioned', [PRIEST]: 'Priest', [MAGE]: 'Mage', [GM]: 'Gm' };
const told = [], audits = [], notes = [], drawn = [];
const commands = {}, handlers = {};
const props = new Map();
const api = {
  mp: { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v) },
  log: () => {}, personal: (a, t) => told.push([a, t]), system: (a, t) => told.push([a, t]), audit: (t) => audits.push(t),
  staffNote: (a, w, d) => notes.push([a, w, d]),
  registerChatCommand: (n, f, o) => { commands[n] = { f, o }; }, onUi: (e, f) => { (handlers[e] = handlers[e] || []).push(f); },
  openWidget: (a, p2) => drawn.push({ a, p: p2 }), closeWidget: () => {},
  who: (a) => `${NAMES[a]} (profile ${a})`, display: (a) => NAMES[a] || 'x', nameOf: (a) => NAMES[a] || 'x', tagOf: (a) => `T${a}`,
  onlineActors: () => Object.keys(NAMES).map(Number), isAdmin: (a) => a === GM, isLeadStaff: (a) => a === GM,
  findByName: (q) => Object.entries(NAMES).find(([, n]) => n.toLowerCase() === String(q).toLowerCase())?.[0] * 1 || 0,
  findAnyByName: (q) => Object.entries(NAMES).find(([, n]) => n.toLowerCase() === String(q).toLowerCase())?.[0] * 1 || 0,
  profileOf: (a) => a, cfg: CFG,
};
// keep: a hot reload over the old globalThis state, as gamemode.js does
const load = (keep) => {
  for (const m of [GUILDS, PG, CHARTERS]) delete require.cache[m];
  for (const k of Object.keys(handlers)) delete handlers[k];
  if (!keep) { delete globalThis.__dboGuildState; delete globalThis.__dboPlayerGuildState; delete globalThis.__dboChartersState; }
  require(GUILDS)(api);
  // charters.js owns the name check /guild create reuses; without it no guild can be founded at all (by design)
  require(CHARTERS)(Object.assign({}, api, { ownNameOf: api.nameOf, ownDisplay: api.display, displayFor: api.display,
    takeGold: () => true, giveItem: () => true, every: () => {}, approvalForum: null }));
  require(PG)(api);
};
load();
const guild = (a, args) => { told.length = 0; commands.guild.f(a, args); return told.map(([, t]) => t).join(' | '); };
const bandOf = (a) => globalThis.__dboBandOf(a);
// The panel: the payload as guilds.js builds it, and a button press with its nonce; returns the redrawn panel's payload
const panel = (a) => globalThis.__dboFactionPayload(a, false);
const nonceOf = (a) => globalThis.__dboGuildState.nonces.get(a >>> 0);
const press = (a, event, ...args) => {
  told.length = 0; drawn.length = 0;
  const n = nonceOf(a) || panel(a).nonce;
  for (const f of handlers[event] || []) f(a, [n, ...args]);
  const last = drawn.filter((d) => d.a === a).pop();
  return last ? last.p : null;
};

// ---- the view before any guild ---------------------------------------------------------------------------------------
let p = panel(MASTER);
ok('the faction payload carries the Guild tab', !!p.band && p.band.enabled === true && p.band.mine === null && p.band.blocked === '', p.band);
ok('the rules: 10 with the Guildmaster, one per character, no faction but faiths and colleges, no wars or uniforms',
  p.band.maxMembers === 10 && /10 members, the Guildmaster included/.test(p.band.rules[0]) && /One guild per character/.test(p.band.rules[1])
  && /faith or a magic college/.test(p.band.rules[2]) && /No wars, no territory.*no uniform/.test(p.band.rules[3]), p.band.rules);
ok('a staff reader of the journal gets no Guild tab (readOnly)', globalThis.__dboFactionPayload(MASTER, false, true).band === null);
ok('every button is registered', ['guildTabCreate', 'guildTabRename', 'guildTabDisband', 'guildTabInvite', 'guildTabAccept', 'guildTabDecline', 'guildTabLeave'].every((e) => (handlers[e] || []).length === 1), Object.keys(handlers));

// ---- create, with the refusal text in the panel ------------------------------------------------------------------------
let d = press(MASTER, 'guildTabCreate', 'Bruma');
ok('a refused name: the charter check\'s own words, drawn red, nothing made', d && d.resultKind === 'refused' && /hold or a region/.test(d.result) && !bandOf(MASTER), d && [d.result, d.resultKind]);
ok('...and nothing went to chat', told.filter(([a]) => a === MASTER).length === 0, told);
d = press(MASTER, 'guildTabCreate', 'The Wayfarers');
ok('create founds it, drawn green, both lines of the command', d && d.resultKind === 'ok' && /The Wayfarers is founded/.test(d.result) && /group of players/.test(d.result) && bandOf(MASTER) && bandOf(MASTER).name === 'The Wayfarers', d && d.result);
ok('the redrawn tab shows the guild: Guildmaster, 1 of 10', d.band.mine && d.band.mine.master === true && d.band.mine.members === 1 && d.band.mine.title === 'Guildmaster', d.band.mine);
ok('it is audited and staff told, as /guild create', audits.some((t) => /GUILD .*founded the guild The Wayfarers/.test(t)) && notes.some(([, w]) => w === '/guild create'));
const GID = bandOf(MASTER).id;
d = press(MASTER, 'guildTabCreate', 'Second Lot');
ok('a second guild: refused with the one-guild rule', d.resultKind === 'refused' && /one guild at a time|already in The Wayfarers/.test(d.result), d.result);

// ---- a stale or missing nonce does nothing -----------------------------------------------------------------------------
drawn.length = 0;
for (const f of handlers.guildTabDisband) f(MASTER, ['not-the-nonce']);
ok('a stale nonce: nothing done, nothing drawn', !!bandOf(MASTER) && drawn.length === 0);

// ---- invite, by a name with a space; accept and decline ----------------------------------------------------------------
NAMES[0x40] = 'Long Name'; NAMES[0x41] = 'Other One';
d = press(MASTER, 'guildTabInvite', 'Long Name');
ok('invite by a two-word name (the whole text, not its first word)', d.resultKind === 'ok' && /You invited Long Name/.test(d.result), d.result);
d = press(MASTER, 'guildTabInvite', 'Nobody Here');
ok('invite of nobody online: the usage, drawn red', d.resultKind === 'refused' && /must be in the game/.test(d.result), d.result);
p = panel(0x40);
ok('the invitee\'s tab lists the invitation, its guild and who sent it', p.band.invites.length === 1 && p.band.invites[0].id === GID && p.band.invites[0].from === 'Master', p.band.invites);
d = press(0x40, 'guildTabAccept', GID);
ok('accept joins as a Member', d.resultKind === 'ok' && /Member of The Wayfarers/.test(d.result) && bandOf(0x40) && bandOf(0x40).id === GID, d.result);
ok('...and the Guildmaster\'s view counts 2', panel(MASTER).band.mine.members === 2);
press(MASTER, 'guildTabInvite', 'Other One');
d = press(0x41, 'guildTabDecline', GID);
ok('decline', d.resultKind === 'ok' && /declined The Wayfarers/.test(d.result) && !bandOf(0x41) && panel(0x41).band.invites.length === 0, d.result);
d = press(0x41, 'guildTabAccept', GID);
ok('accept with no invitation: refused', d.resultKind === 'refused' && /Nobody has invited you/.test(d.result), d.result);
d = press(0x40, 'guildTabInvite', 'Other One');
ok('a Member cannot invite', d.resultKind === 'refused' && /Guildmaster and its Officers invite/.test(d.result), d.result);

// ---- rename, leave, disband -------------------------------------------------------------------------------------------
d = press(0x40, 'guildTabRename', 'The Roamers');
ok('only the Guildmaster renames', d.resultKind === 'refused' && /Only The Wayfarers's Guildmaster renames it/.test(d.result), d.result);
d = press(MASTER, 'guildTabRename', 'Whiterun');
ok('rename runs the charter name check', d.resultKind === 'refused' && /hold or a region/.test(d.result) && bandOf(MASTER).name === 'The Wayfarers', d.result);
d = press(MASTER, 'guildTabRename', 'The Roamers');
ok('rename', d.resultKind === 'ok' && /The Wayfarers is called The Roamers now/.test(d.result) && bandOf(MASTER).name === 'The Roamers', d.result);
d = press(MASTER, 'guildTabLeave');
ok('a Guildmaster with members cannot just leave', d.resultKind === 'refused' && /hands The Roamers to someone else first/.test(d.result) && !!bandOf(MASTER), d.result);
d = press(0x40, 'guildTabLeave');
ok('a Member leaves', d.resultKind === 'ok' && /You left The Roamers/.test(d.result) && !bandOf(0x40), d.result);
press(MASTER, 'guildTabInvite', 'Long Name');
// a hot reload keeps the invitation (globalThis state)
load(true);
p = panel(0x40);
ok('a hot reload over the old state keeps the invitation and the handlers are registered once', p.band.invites.length === 1 && handlers.guildTabAccept.length === 1, [p.band.invites, (handlers.guildTabAccept || []).length]);
press(0x40, 'guildTabAccept', GID);
d = press(0x40, 'guildTabDisband');
ok('only the Guildmaster disbands', d.resultKind === 'refused' && /Only The Roamers's Guildmaster closes it/.test(d.result) && !!bandOf(MASTER), d.result);
d = press(MASTER, 'guildTabDisband');
ok('disband closes it; the tab shows no guild again', d.resultKind === 'ok' && /The Roamers is closed/.test(d.result) && !bandOf(MASTER) && !bandOf(0x40) && d.band.mine === null, d.result);
ok('the other member is told in chat', told.some(([a, t]) => a === 0x40 && /disbanded by its Guildmaster/.test(t)), told);

// ---- refused for a faction member; closed guilds -----------------------------------------------------------------------
globalThis.__dboFactionPayload(GM, false);
for (const f of handlers.factionAdd || []) f(GM, [nonceOf(GM), 'fighters-guild', 'Factioned']);
p = panel(FACTIONED);
ok('a faction member sees why they may have no guild', /You belong to .*Fighters Guild.*leave it first/.test(p.band.blocked), p.band.blocked);
d = press(FACTIONED, 'guildTabCreate', 'The Hangers On');
ok('...and create is refused with it', d.resultKind === 'refused' && /belong to/.test(d.result) && !bandOf(FACTIONED), d.result);
const saveCfg = api.cfg; api.cfg = JSON.parse(JSON.stringify(CFG)); api.cfg.playerGuilds = Object.assign({}, api.cfg.playerGuilds, { enabled: false });
load(true);
p = panel(THIRD);
ok('guilds closed: the tab says so (enabled false)', p.band.enabled === false, p.band);
d = press(THIRD, 'guildTabCreate', 'The Late Ones');
ok('...and a create is refused in the panel', d.resultKind === 'refused' && /closed/.test(d.result) && !bandOf(THIRD), d.result);
api.cfg = saveCfg;

// ---- the chat command is unchanged ---------------------------------------------------------------------------------------
load(true);
const out = guild(THIRD, 'create The Chat Lot');
ok('/guild still answers in chat', /The Chat Lot is founded/.test(out) && !!bandOf(THIRD), out);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
