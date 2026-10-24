// Player guilds, kind 'band' (guilds.js + playerguilds.js; Nate, 21 Oct): an informal group any player founds on the
// spot, at most maxMembers including its Guildmaster, one per character, exclusive with the factions except a faith or a
// magic college, and with NONE of the faction powers. Real guilds.js, playerguilds.js, leadership.js and the live
// guild-defs.json and gamemode-config.json, stub api, in a temp folder.
//
//   node tests/player-guilds-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GUILDS = path.join(ROOT, 'guilds.js');
const PG = path.join(ROOT, 'playerguilds.js');
const CHARTERS = path.join(ROOT, 'charters.js');
if (!fs.existsSync(PG) || !/BAND_KIND/.test(fs.readFileSync(GUILDS, 'utf8'))) {
  require('./expect')('player-guilds', 'there are no player guilds in this line');
  console.log('ok   skipped: no player guilds in this line'); process.exit(0);
}
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const DEFS = JSON.parse(fs.readFileSync(path.join(ROOT, 'guild-defs.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-guilds-'));
fs.copyFileSync(path.join(ROOT, 'guild-defs.json'), path.join(dir, 'guild-defs.json'));
for (const f of ['zones.json', 'skills.json', 'journal-prose-filter.json']) {
  try { fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)); } catch (e) { /* optional */ }
}
process.chdir(dir);

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
const load = () => {
  for (const m of [GUILDS, PG, CHARTERS]) delete require.cache[m];
  delete globalThis.__dboGuildState; delete globalThis.__dboPlayerGuildState; delete globalThis.__dboChartersState;
  require(GUILDS)(api);
  // charters.js owns the name check /guild create reuses; without it no guild can be founded at all (by design)
  require(CHARTERS)(Object.assign({}, api, { ownNameOf: api.nameOf, ownDisplay: api.display, displayFor: api.display,
    takeGold: () => true, giveItem: () => true, every: () => {}, approvalForum: null }));
  require(PG)(api);
};
load();
const guild = (a, args) => { told.length = 0; commands.guild.f(a, args); return told.map(([, t]) => t).join(' | '); };
const bandOf = (a) => globalThis.__dboBandOf(a);
const bands = () => globalThis.__dboBands();
const members = (id) => (bands().find((b) => b.id === id) || {}).members || 0;

// ---- create ---------------------------------------------------------------------------------------------------------
let out = guild(MASTER, 'create The Wayfarers');
ok('any player founds one on the spot, no approval', !!bandOf(MASTER) && bandOf(MASTER).title === 'Guildmaster' && /is founded, and you are its Guildmaster/.test(out), [bandOf(MASTER), out]);
ok('it is kind band, never the lore kind guild', globalThis.__dboGuildInfo(bandOf(MASTER).id).kind === 'band', globalThis.__dboGuildInfo(bandOf(MASTER).id));
ok('it is written to player-guilds.json, not player-factions.json', JSON.parse(fs.readFileSync(path.join(dir, 'player-guilds.json'), 'utf8')).guilds.length === 1
  && !fs.existsSync(path.join(dir, 'player-factions.json')), fs.readdirSync(dir).filter((f) => f.endsWith('.json')));
ok('founding is audited and the staff log is told', audits.some((t) => /GUILD .*founded the guild The Wayfarers/.test(t)) && notes.some(([, w]) => w === '/guild create'), [audits, notes]);
const GID = bandOf(MASTER).id;
ok('a second guild is refused to the same character', (guild(MASTER, 'create Another Lot'), /already in The Wayfarers/.test(told.map(([, t]) => t).join(' ')) && bands().length === 1), bands());

// ---- the name check is the charter's -------------------------------------------------------------------------------
out = guild(FRIEND, 'create The Fighters Guild');
ok("a lore faction's name is refused, by the charter's own check", /already exists/.test(out) && bands().length === 1, out);
out = guild(FRIEND, 'create Bruma');
ok('a hold or a region is refused too', /hold or a region/.test(out), out);
out = guild(FRIEND, 'create AAAAAA');
ok('the prose rules hold (capitals, repeats)', /capitals|repeats/.test(out), out);

// ---- invite, accept, decline ----------------------------------------------------------------------------------------
out = guild(FRIEND, 'accept');
ok('nobody may accept an invitation they never had', /Nobody has invited you/.test(out), out);
guild(MASTER, 'invite Friend');
ok('the Guildmaster invites, and the player is told', told.some(([a, t]) => a === FRIEND && /invites you into the guild The Wayfarers/.test(t)), told);
out = guild(FRIEND, 'accept');
ok('accepting joins at the lowest rank', bandOf(FRIEND) && bandOf(FRIEND).id === GID && bandOf(FRIEND).title === 'Member' && members(GID) === 2, [bandOf(FRIEND), members(GID)]);
guild(MASTER, 'invite Third'); out = guild(THIRD, 'decline');
ok('declining leaves them out', /declined The Wayfarers/.test(out) && !bandOf(THIRD), out);
out = guild(FRIEND, 'invite Third');
ok('a plain Member cannot invite', /Guildmaster and its Officers invite/.test(out) && !bandOf(THIRD), out);

// ---- the cap --------------------------------------------------------------------------------------------------------
const CAP = globalThis.__dboBandMaxMembers();
ok('the cap is the configured 10', CAP === 10 && CFG.playerGuilds.maxMembers === 10, CAP);
for (let i = 0; i < CAP + 2; i++) { const id = 0x200 + i; NAMES[id] = `Filler${i}`; globalThis.__dboBandJoin(id, GID); }
ok('it holds the Guildmaster and nine others, and no more', members(GID) === CAP, members(GID));
const over = globalThis.__dboBandJoin(0x300, GID);
ok('...and says so plainly', !!over.error && /is full: a guild holds 10/.test(over.error), over);

// ---- exclusive with the factions, both ways -------------------------------------------------------------------------
const FIGHTERS = 'fighters-guild';
const CULT = (DEFS.factions.find((f) => f.kind === 'cult') || {}).id;
const COLLEGE = (DEFS.factions.find((f) => f.college === true) || {}).id;
ok('the defs have a cult and a college to test with', !!CULT && !!COLLEGE, [CULT, COLLEGE]);
// The panel's own path: a Lead GM adds them, then sets the rank. The add is where a guild member is refused, so its
// reply is returned when it refuses.
const seatIn = (fid, who2, rank) => {
  globalThis.__dboFactionPayload(GM, false);
  const n = globalThis.__dboGuildState.nonces.get(GM);
  drawn.length = 0;
  for (const f of handlers.factionAdd || []) f(GM, [n, fid, NAMES[who2]]);
  const last = drawn[drawn.length - 1];
  const said = last && last.p ? String(last.p.result || last.p.targetName || '') : '';
  if (!globalThis.__dboGuildMembers(fid).includes(who2 >>> 0)) return { error: said || 'not added' };
  return globalThis.__dboGuildSetRank(GM, fid, who2, rank, false);
};
seatIn(FIGHTERS, FACTIONED, 2);
out = guild(FACTIONED, 'create The Hangers On');
ok('a faction member cannot found a guild', /belongs? to Fighters Guild/.test(out) && !bandOf(FACTIONED), out);
// a guild with room in it, so the refusal below is the faction rule and not the cap
guild(THIRD, 'create The Open Door');
let r = globalThis.__dboBandJoin(FACTIONED, bandOf(THIRD).id);
ok('...nor join one', !!r.error && /belongs to/.test(r.error), r);
seatIn(CULT, PRIEST, 2);
out = guild(PRIEST, 'create The Faithful Few');
ok('a cultist MAY found one: a faith stands beside a guild', !!bandOf(PRIEST), [out, bandOf(PRIEST)]);
seatIn(COLLEGE, MAGE, 2);
out = guild(MAGE, 'create The Spell Circle');
ok('a college member MAY too', !!bandOf(MAGE), [out, bandOf(MAGE)]);
r = seatIn(FIGHTERS, FRIEND, 2);
ok('the reverse holds: a guild member is refused a faction rank', !!r.error && /Leave your guild first/.test(r.error), r);
ok('...and the refusal comes from the add, so the panel, the Court tab and a charter are all covered', /Leave your guild first/.test(String(r.error)), r);
r = seatIn(CULT, FRIEND, 2);
ok('...but not a faith', !r.error, r);
r = seatIn(COLLEGE, FRIEND, 2);
ok('...nor a college', !r.error, r);

// ---- none of the faction powers -------------------------------------------------------------------------------------
ok('__dboGuildsOf leaves a guild out, so every power that reads it does too', !globalThis.__dboGuildsOf(MASTER).some((g) => g.id === GID), globalThis.__dboGuildsOf(MASTER));
ok('...and shows it when asked for bands', globalThis.__dboGuildsOf(MASTER, { bands: true }).some((g) => g.id === GID));
ok('a guild is no war target: __dboFactionList leaves it out', !globalThis.__dboFactionList().includes(GID));
ok('a guild has no hall, no college and no treasury key in its data', (() => { const f = globalThis.__dboGuildInfo(GID); return !f.hall && !f.college && !f.zone && !f.secret; })(), globalThis.__dboGuildInfo(GID));
ok('the Faction tab still shows it, so the roster needs no client release', globalThis.__dboFactionPayload(MASTER, false).factions.some((f) => f.id === GID), globalThis.__dboFactionPayload(MASTER, false).factions.map((f) => f.id));

// ---- leadership ignores guilds ---------------------------------------------------------------------------------------
const LEADERSHIP = path.join(ROOT, 'leadership.js');
delete require.cache[LEADERSHIP];
require(LEADERSHIP)(Object.assign({}, api, { ranksOf: () => [], rankTitle: (r) => String(r), rulerSeats: () => [], cfg: CFG }));
ok('a Guildmaster holds no leadership seat', globalThis.__dboLeadershipOf(MASTER).length === 0, globalThis.__dboLeadershipOf(MASTER));
ok('...and the doubles audit never names one', !globalThis.__dboLeadershipDoubles().some((d) => d.actor === MASTER), globalThis.__dboLeadershipDoubles());
ok('...and a Guildmaster is refused nothing by the leadership rule', globalThis.__dboLeadershipRefusal(MASTER) === '');

// ---- leaving, kicking, handing over, closing -------------------------------------------------------------------------
out = guild(MASTER, 'leave');
ok('a Guildmaster with members cannot simply walk out', /hands The Wayfarers to someone else first/.test(out) && !!bandOf(MASTER), out);
out = guild(MASTER, 'kick Friend');
ok('the Guildmaster removes a member', !bandOf(FRIEND) && /out of The Wayfarers|no longer in/.test(out), [out, bandOf(FRIEND)]);
out = guild(MASTER, 'promote Filler0');
ok('promote lifts a Member to Officer', /Officer/.test(out) && bandOf(0x200).title === 'Officer', [out, bandOf(0x200)]);
out = guild(MASTER, 'demote Filler0');
ok('demote puts them back', bandOf(0x200).title === 'Member', bandOf(0x200));
out = guild(MASTER, 'rename The Wanderers');
ok('the Guildmaster renames it, through the same name check', /is called The Wanderers now/.test(out) && globalThis.__dboGuildInfo(GID).name === 'The Wanderers', out);
out = guild(0x200, 'rename Something Else');
ok('a Member cannot rename it', /Only The Wanderers's Guildmaster renames it|Guildmaster renames/.test(out), out);
out = guild(MASTER, 'disband');
ok('the Guildmaster closes it, and the members are told', !bandOf(MASTER) && !bands().some((b) => b.id === GID)
  && audits.some((t) => /GUILD .*disbanded The Wanderers/.test(t)), [bands().map((b) => b.id), audits.slice(-2)]);

// ---- the last one out closes it ---------------------------------------------------------------------------------------
guild(THIRD, 'create The Two Of Us');
const TID = bandOf(THIRD).id;
guild(THIRD, 'invite Friend'); guild(FRIEND, 'accept');
guild(FRIEND, 'leave');
ok('a Member leaves and the guild stands', bands().some((b) => b.id === TID) && members(TID) === 1, members(TID));
out = guild(THIRD, 'leave');
ok('the last one out closes it, so no empty guild holds a name', !bands().some((b) => b.id === TID) && /the guild is closed/.test(out), out);

// ---- staff ------------------------------------------------------------------------------------------------------------
guild(MAGE, 'invite Priest');
const MID = bandOf(MAGE).id;
out = guild(FRIEND, `dissolve ${MID} because`);
ok('a player cannot dissolve a guild', /Staff only/.test(out) && bands().some((b) => b.id === MID), out);
out = guild(GM, `dissolve ${MID} testing`);
ok('staff dissolve it with a reason, audited and sent to the staff log', !bands().some((b) => b.id === MID)
  && audits.some((t) => /GUILD GM .*dissolved .*: testing/.test(t)) && notes.some(([, w]) => w === '/guild dissolve'), [audits.slice(-1), notes.slice(-1)]);
out = guild(GM, 'dissolve nothing-here why');
ok('dissolving a guild that is not there says so', /No such guild/.test(out), out);

// ---- the state survives a reload --------------------------------------------------------------------------------------
guild(MASTER, 'create The Long Road');
const LID = bandOf(MASTER).id;
load();
ok('a reload reads the guilds back, with their members', bands().some((b) => b.id === LID) && !!globalThis.__dboBandOf(MASTER), [bands().map((b) => b.id), globalThis.__dboBandOf(MASTER)]);
ok('player-guilds.json is gitignored (runtime)', fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').includes('player-guilds.json'));

// ---- werewolf packs hold at most packs.maxMembers (Nate, 23 Oct: 5) --------------------------------------------------
{
  const PACK = 'pack-of-the-jerall';
  const st = globalThis.__dboGuildState;
  globalThis.__dboSuperKind = () => 'werewolf';
  const add = (q) => { told.length = 0; st.nonces.set(GM, 'pk'); (handlers.factionAdd || []).forEach((f) => f(GM, ['pk', PACK, q])); return st.members[PACK] || {}; };
  st.members[PACK] = {};
  for (let i = 0; i < 4; i++) st.members[PACK][String(0x900 + i)] = { rank: 1, name: `Wolf${i}` };
  ok('a pack of four takes a fifth', !!add('Third')[String(THIRD)], Object.keys(st.members[PACK] || {}).length);
  ok('a pack of five refuses a sixth, and says so plainly', !add('Mage')[String(MAGE)] && /is full: a pack runs 5 strong/.test(JSON.stringify(drawn.slice(-1))), drawn.slice(-1));
  CFG.packs = { maxMembers: 6 }; load();
  globalThis.__dboGuildState.members[PACK] = Object.assign({}, st.members[PACK]);
  const st2 = globalThis.__dboGuildState; told.length = 0; st2.nonces.set(GM, 'pk2'); (handlers.factionAdd || []).forEach((f) => f(GM, ['pk2', PACK, 'Mage']));
  ok('packs.maxMembers sets the size', !!(st2.members[PACK] || {})[String(MAGE)], Object.keys(st2.members[PACK] || {}).length);
  // One pack per werewolf (pack control, Nate 23 Oct): Mage runs with the Jerall pack, so Falkreath's refuses them
  const FALK = 'pack-of-falkreath';
  st2.members[FALK] = {}; drawn.length = 0; told.length = 0; st2.nonces.set(GM, 'pk3'); (handlers.factionAdd || []).forEach((f) => f(GM, ['pk3', FALK, 'Mage']));
  ok('a werewolf already in a pack is refused a second one', !(st2.members[FALK] || {})[String(MAGE)] && /one pack at a time/.test(JSON.stringify(drawn.slice(-1).concat(told))), drawn.slice(-1).concat(told));
  delete globalThis.__dboSuperKind;
}

process.chdir(ROOT);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
