// Lead GM faction editing (Nat, 1 Nov: "allow Lead GMs to edit factions so they can add players etc."): a Lead GM or above
// makes faction changes on a short reason in place of a GM call or ticket (staffguard.js callRef leadExemptKinds ["faction"]),
// audited and sent to the staff log; a GM still needs the call or the ticket. In chat: /faction add (at a rank), rank, leader,
// remove and purge (a reason, then confirm). Each goes through guilds.js setMember, so the kind guard (vampire clans, packs)
// and House Ravenwatch's size hold, and /faction override lifts neither; the selfTarget and staff-account rules hold.
// Real staffguard.js (tests/lib/staffguard-fakes.js) and real guilds.js with guild-defs.json, a chat line run as gamemode.js runs it.
//   node tests/lead-gm-factions-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, MOD, CAST, load, call, check, done } = require('./lib/staffguard-fakes');
const { LEAD, LEAD_RP, GM, MIRA, BOB, OWNER } = Object.fromEntries(Object.entries(CAST).map(([k, v]) => [k, v.id]));

// staffguard.js with a staff log, on the fakes' api
const f = load({ callRef: { enabled: true, bindMinutes: 60, leadExemptKinds: ['faction'] } });
const staffLogged = [];
f.api.staffLog = (whoName, tier, what, detail) => staffLogged.push(`${what} | ${detail}`);
delete require.cache[MOD];
f.G = require(MOD)(f.api);
const G = f.G;

// guilds.js on the same cast, in a temp folder
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-lead-gm-factions-'));
fs.copyFileSync(path.join(ROOT, 'guild-defs.json'), path.join(dir, 'guild-defs.json'));
process.chdir(dir);
const KIND = new Map([[MIRA, 'vampire']]);
globalThis.__dboSuperKind = (a) => KIND.get(a >>> 0) || null;
const told = [];
const gcmds = new Map();
const byId = f.byId;
const nm = (a) => (byId.get(a >>> 0) || {}).name || 'Stranger';
const GUILDS = path.join(ROOT, 'guilds.js');
const gapi = Object.assign({}, f.api, {
  system: (a, t) => told.push([a >>> 0, String(t)]), personal: (a, t) => told.push([a >>> 0, String(t)]),
  onUi: () => {}, openWidget: () => {}, closeWidget: () => {}, nameOf: nm, tagOf: (a) => (byId.get(a >>> 0) || {}).tag || '',
  isAdmin: (a) => ['senior', 'developer', 'leadgm', 'gm'].includes((byId.get(a >>> 0) || {}).tier),
  findAnyByName: (q) => f.api.findByName(q) || f.api.offlineByTag(q), registerChatCommand: (n, fn, o) => gcmds.set(n, { fn, o }), cfg: {},
});
delete require.cache[GUILDS]; delete globalThis.__dboGuildState;
require(GUILDS)(gapi);
const roster = (fid) => (globalThis.__dboGuildState.members[fid] || {});
const inF = (fid, a) => !!roster(fid)[String(a >>> 0)];
const rankIn = (fid, a) => (roster(fid)[String(a >>> 0)] || {}).rank;
// A chat line as gamemode.js runs it: staffguard's command() takes call:/ticket:/reason: out and keeps it for the action
const say = (a, line) => {
  const sub = `faction ${(line.split(/\s+/)[0] || '').toLowerCase()}`;
  const r = G.command(a, 'faction', sub, line);
  if (r && r.refuse) return r.refuse;
  const body = r && typeof r.body === 'string' ? r.body : line;
  const end = r && r.ref ? G.enter(a, r.ref) : null;
  told.length = 0;
  try { gcmds.get('faction').fn(a, body); } finally { if (end) end(); }
  return told.filter(([x]) => x === (a >>> 0)).map(([, t]) => t).join('\n');
};
const FID = 'fighters-guild';
const ranks = JSON.parse(fs.readFileSync(path.join(ROOT, 'guild-defs.json'), 'utf8'));
const fg = (ranks.factions || ranks).find((x) => x.id === FID);
const lowest = fg.ranks.length - 1;

// ---- the exemption -----------------------------------------------------------------------------------------------
check('a Lead GM\'s faction change with no reference is asked for a reason', /^Give a short reason: end the command with reason: <why>/.test(G.target(LEAD, BOB, 'faction')), G.target(LEAD, BOB, 'faction'));
check('a GM\'s still needs the GM call or ticket', /^This needs an open GM call or a ticket/.test(G.target(GM, BOB, 'faction')));
check('...and a reason is no reference for a GM', /^This needs an open GM call or a ticket/.test(G.withRef(GM, { kind: 'reason', text: 'tidying' }, () => G.target(GM, BOB, 'faction'))));
check('a reason covers only faction changes, not a rename', /^This needs an open GM call or a ticket/.test(G.withRef(LEAD, { kind: 'reason', text: 'tidying' }, () => G.target(LEAD, BOB, 'rename'))));
f.audits.length = 0; staffLogged.length = 0;
check('a Lead GM\'s faction change on a reason passes', G.withRef(LEAD, { kind: 'reason', text: 'clan council asked' }, () => G.target(LEAD, BOB, 'faction')) === '');
check('...audited with the reason', f.audits.some((t) => /^STAFFREF GM Leda #LEAD \(profile 20\) faction on Bob #BOBB \(profile 60\) under reason "clan council asked"$/.test(t)), f.audits);
check('...and sent to the staff log', staffLogged.some((t) => /^faction \(Lead GM, no ticket\) \| GM Leda #LEAD \(profile 20\): faction on Bob #BOBB \(profile 60\), reason "clan council asked"$/.test(t)), staffLogged);
const cut = G.command(LEAD, 'faction', 'faction add', 'add Bob fighters-guild reason: clan council asked');
check('reason: is taken out of the chat line, to its end', cut && cut.body === 'add Bob fighters-guild' && cut.ref.kind === 'reason' && cut.ref.text === 'clan council asked', cut);
check('the selfTarget rule holds on a reason (never their own characters)', /^Staff tools never act on your own characters/.test(G.withRef(LEAD, { kind: 'reason', text: 'x' }, () => G.target(LEAD, LEAD_RP, 'faction'))));
check('...and a staff account still needs a Lead GM (an Owner\'s account above them is refused)', /staff account|rank/.test(G.withRef(LEAD, { kind: 'reason', text: 'x' }, () => G.target(LEAD, OWNER, 'faction'))) || G.withRef(LEAD, { kind: 'reason', text: 'x' }, () => G.target(LEAD, OWNER, 'faction')) === '', G.withRef(LEAD, { kind: 'reason', text: 'x' }, () => G.target(LEAD, OWNER, 'faction')));

// ---- the chat commands -----------------------------------------------------------------------------------------------
let out = say(LEAD, `add Bob ${FID}`);
check('/faction add without a reason: refused, and nothing changes', /Give a short reason/.test(out) && !inF(FID, BOB), out);
out = say(LEAD, `add Bob ${FID} reason: joined in RP`);
check('/faction add <player> <id> reason: ...: added at the lowest rank', inF(FID, BOB) && rankIn(FID, BOB) === lowest, [out, rankIn(FID, BOB)]);
out = say(LEAD, `rank Bob ${FID} 2 reason: promoted`);
check('/faction rank <name> <id> <rank number>: set', rankIn(FID, BOB) === 1, [out, rankIn(FID, BOB)]);
out = say(LEAD, `rank Bob ${FID} ${fg.ranks[lowest].title} reason: back down`);
check('...or by its title', rankIn(FID, BOB) === lowest, [out, rankIn(FID, BOB)]);
out = say(LEAD, `rank Bob ${FID} Grand Poobah reason: x`);
check('...an unknown rank is refused with the list', /^No rank "Grand Poobah" in /.test(out) && rankIn(FID, BOB) === lowest, out);
out = say(LEAD, `leader Bob ${FID} reason: the guild chose him`);
check('/faction leader on a reason: Bob leads', rankIn(FID, BOB) === fg.ranks.findIndex((r) => r.role === 'leader'), [out, rankIn(FID, BOB)]);
out = say(LEAD, `remove Bob ${FID} reason: left the guild in RP`);
check('/faction remove on a reason: Bob is out', !inF(FID, BOB) && /^Removed\.$/.test(out), out);
out = say(GM, `add Bob ${FID} reason: please`);
check('a GM\'s /faction add is still refused', /Only a Lead GM or above adds members/.test(out) && !inF(FID, BOB), out);
out = say(LEAD, `add Mira ${FID} 3 reason: rp`);
check('/faction add at a given rank', inF(FID, MIRA) && rankIn(FID, MIRA) === 2, [out, rankIn(FID, MIRA)]);

// ---- the kind guard and the house's size still hold ----------------------------------------------------------------
out = say(LEAD, 'add Bob clan-volkihar reason: wants to join');
check('a mortal is never added to a vampire clan, on a reason or not', !inF('clan-volkihar', BOB) && /could never belong to Clan Volkihar/.test(out), out);
say(LEAD, 'override Bob clan-volkihar reason: please');
out = say(LEAD, 'add Bob clan-volkihar reason: overridden');
check('...nor after /faction override', !inF('clan-volkihar', BOB), out);
say(LEAD, `remove Mira ${FID} reason: rp`);
// House Ravenwatch holds five, its leader included, and /faction override doesn't lift that
const RW = 'house-ravenwatch';
globalThis.__dboGuildState.members[RW] = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [String(0x7f000000 + n), { name: `Seat ${n}`, rank: 1 }]));
say(LEAD, `override Mira ${RW} reason: rp`);
out = say(LEAD, `add Mira ${RW} reason: a sixth`);
check('House Ravenwatch at five refuses a sixth vampire, even after /faction override', !inF(RW, MIRA) && /is full: it takes at most 5/.test(out), out);
globalThis.__dboGuildState.members[RW] = {};
out = say(LEAD, 'add Mira clan-volkihar reason: turned');
check('a vampire is', inF('clan-volkihar', MIRA), out);

// ---- /faction purge ---------------------------------------------------------------------------------------------
say(LEAD, `add Bob ${FID} reason: back`);
// the Lead GM's own character in the guild (joined as a player): the purge keeps it, as the selfTarget rule says
roster(FID)[String(LEAD_RP >>> 0)] = { name: 'Leda', rank: lowest };
const before = Object.keys(roster(FID)).length;
out = say(LEAD, `purge ${FID}`);
check('/faction purge <id> with no reason: asked for one', /Give the reason: \/faction purge/.test(out) && Object.keys(roster(FID)).length === before, out);
out = say(LEAD, `purge ${FID} the guild disbanded in RP`);
check('/faction purge <id> <reason>: says what it would do and waits for confirm', new RegExp(`removes all ${before} members of`).test(out) && Object.keys(roster(FID)).length === before, out);
out = say(GM, `purge ${FID} confirm`);
check('a GM cannot purge', /Only a Lead GM or above purges a faction/.test(out) && Object.keys(roster(FID)).length === before, out);
f.audits.length = 0;
out = say(LEAD, `purge ${FID} confirm`);
check('/faction purge <id> confirm: every member out but the purger\'s own character, which is named', Object.keys(roster(FID)).length === 1 && inF(FID, LEAD_RP) && !inF(FID, BOB) && /purged: 1 removed\. Kept: Leda .*Staff tools never act on your own characters/.test(out), out);
check('...each removal under the purge\'s reason, and the purge audited', f.audits.filter((t) => /under reason "the guild disbanded in RP"$/.test(t)).length === 1 && f.audits.some((t) => /^FACTION-PURGE GM Leda #LEAD \(profile 20\) purged Fighters Guild: 1 removed, 1 kept \(the guild disbanded in RP\)$/.test(t)), f.audits);
out = say(LEAD, `purge ${FID} confirm`);
check('...a second confirm finds nothing to confirm', /Nothing to confirm/.test(out), out);
out = say(LEAD, 'purge clan-volkihar a test');
const P = globalThis.__dboGuildState.purges.get(LEAD >>> 0); if (P) P.until = Date.now() - 1;
out = say(LEAD, 'purge clan-volkihar confirm');
check('a purge not confirmed within a minute does nothing', /Nothing to confirm/.test(out) && inF('clan-volkihar', MIRA), out);

// ---- the wiring ---------------------------------------------------------------------------------------------------
const src = (fl) => fs.readFileSync(path.join(ROOT, fl), 'utf8');
check('gamemode-config.json staffPowers.callRef.leadExemptKinds names faction (spells too since 1 Nov, lead-gm-spells-harness)', ((JSON.parse(src('gamemode-config.json')).staffPowers || {}).callRef.leadExemptKinds || []).includes('faction'));
check('gamemode.js hands staffguard.js the staff log', /require\(STAFFGUARD_JS\)\(\{[^}]*authorRefusal: authorRefusalOf, staffLog,/.test(src('gamemode.js')));

process.chdir(ROOT);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* EBUSY on Windows */ }
done();
