// The kind guard (Nat, 1 Nov: "only vampires can join vampire clans and werewolves can only join packs"): every path that
// seats a member checks the TARGET's kind - an invite and its accept, a Lead GM's add (online or offline), /faction leader,
// /faction override (it lifts the limits, never the kind), a module's call (the invite global), a faction merge into a clan -
// and a staff character stays exempt. A cure or a change of kind lets go every clan or pack no longer fitting, with a line to
// them and to the leader. Clan Volkihar requires a vampire now, as the other four clans do. Real guilds.js and guild-defs.json,
// stub api, in a temp folder; supernatural.js's wiring read in its source.
//   node tests/kind-guard-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GUILDS = path.join(ROOT, 'guilds.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-kind-guard-'));
fs.copyFileSync(path.join(ROOT, 'guild-defs.json'), path.join(dir, 'guild-defs.json'));
process.chdir(dir);

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

// A Lead GM; a vampire clan's leader; a mortal; a vampire; a pure-blood; a werewolf; a blessed werewolf; an offline mortal
const LEAD = 0x10, ELDER = 0x11, MORTAL = 0x12, VAMP = 0x13, PURE = 0x14, WOLF = 0x15, BLESSED = 0x16, AWAY = 0xff000300;
const chars = new Map([[LEAD, 'Lead'], [ELDER, 'Elder'], [MORTAL, 'Mortal'], [VAMP, 'Vamp'], [PURE, 'Pure'], [WOLF, 'Wolf'], [BLESSED, 'Blessed'], [AWAY, 'Away']]);
const KIND = new Map([[ELDER, 'vampire'], [VAMP, 'vampire'], [PURE, 'vampire'], [WOLF, 'werewolf'], [BLESSED, 'werewolf']]);
globalThis.__dboSuperKind = (a) => KIND.get(a >>> 0) || null;
const onlineSet = new Set([LEAD, ELDER, MORTAL, VAMP, PURE, WOLF, BLESSED]);
const told = [], audits = [], cmds = new Map();
const handlers = {};
const props = new Map();
let cfg = {};
const api = () => ({
  mp: { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v) },
  log: () => {}, personal: (a, t) => told.push({ a, t }), system: (a, t) => told.push({ a, t }), audit: (t) => audits.push(t),
  registerChatCommand: (n, f) => cmds.set(n, f), onUi: (e, f) => { (handlers[e] = handlers[e] || []).push(f); },
  openWidget: () => {}, closeWidget: () => {},
  display: (a) => `${chars.get(a)} #T${a.toString(16)}`, nameOf: (a) => chars.get(a) || 'Stranger', tagOf: (a) => `T${a.toString(16)}`,
  onlineActors: () => [...onlineSet], isAdmin: (a) => a === LEAD, isLeadStaff: (a) => a === LEAD,
  findByName: (q) => [...chars.entries()].find(([id, n]) => onlineSet.has(id) && n.toLowerCase() === String(q).toLowerCase())?.[0] || 0,
  findAnyByName: (q) => [...chars.entries()].find(([, n]) => n.toLowerCase() === String(q).toLowerCase().replace(/^#/, ''))?.[0] || 0,
  who: (a) => `${chars.get(a)} (profile ${a})`, cfg, profileOf: (a) => a,
});
const load = () => { delete require.cache[GUILDS]; delete globalThis.__dboGuildState; require(GUILDS)(api()); };
load();
const ST = () => globalThis.__dboGuildState.members;
const inF = (fid, a) => !!(ST()[fid] || {})[String(a)];
const last = (a) => { for (let i = told.length - 1; i >= 0; i--) if (told[i].a === a) return told[i].t; return ''; };
const faction = (a, line) => { cmds.get('faction')(a, line); return last(a); };
const ui = (ev, a, ...args) => { for (const f of handlers[ev] || []) f(a, [globalThis.__dboGuildState.nonces.get(a >>> 0)].concat(args)); };
const add = (fid, who) => { globalThis.__dboFactionPayload(LEAD, false); told.length = 0; ui('factionAdd', LEAD, fid, who); };

// ---- the clans and packs -------------------------------------------------------------------------------------------
const defs = JSON.parse(fs.readFileSync(path.join(ROOT, 'guild-defs.json'), 'utf8'));
const req = Object.fromEntries((defs.factions || defs).filter((f) => f.requires).map((f) => [f.id, f.requires]));
ok('Clan Volkihar requires a vampire now; so do the other four clans; both packs a werewolf', req['clan-volkihar'] === 'vampire' && ['cyrodiil-vampyrum-order', 'crimson-scars', 'house-ravenwatch', 'bloodmist-clan'].every((c) => req[c] === 'vampire') && req['pack-of-the-jerall'] === 'werewolf' && req['pack-of-falkreath'] === 'werewolf', req);

// ---- a Lead GM's add (the F3/F7 staff add), online and offline -------------------------------------------------------
add('clan-volkihar', 'Mortal');
ok('staff add: a mortal is refused for Clan Volkihar', !inF('clan-volkihar', MORTAL));
add('clan-volkihar', 'Away');
ok('staff add: an offline mortal is refused too', !inF('clan-volkihar', AWAY));
add('clan-volkihar', 'Wolf');
ok('staff add: a werewolf is no vampire', !inF('clan-volkihar', WOLF));
add('clan-volkihar', 'Elder');
ok('staff add: a vampire joins', inF('clan-volkihar', ELDER));
add('pack-of-falkreath', 'Vamp');
ok('staff add: a vampire is refused for a pack', !inF('pack-of-falkreath', VAMP));
add('pack-of-falkreath', 'Blessed');
ok('a Hircine-blessed werewolf counts as a werewolf for a pack', inF('pack-of-falkreath', BLESSED));
add('crimson-scars', 'Pure');
ok('a pure-blood counts as a vampire for a clan', inF('crimson-scars', PURE));
add('clan-volkihar', 'Lead');
ok('a staff character itself stays exempt', inF('clan-volkihar', LEAD));
// ---- /faction leader -----------------------------------------------------------------------------------------------
let line = faction(LEAD, 'leader Mortal bloodmist-clan');
ok('/faction leader: a mortal is never seated, even as leader', !inF('bloodmist-clan', MORTAL), line);
faction(LEAD, 'leader Vamp bloodmist-clan');
ok('/faction leader: a vampire is', inF('bloodmist-clan', VAMP));
// ---- /faction override lifts the limits, never the kind ------------------------------------------------------------
faction(LEAD, 'override Mortal house-ravenwatch');
add('house-ravenwatch', 'Mortal');
ok('/faction override then an add: the mortal is still refused', !inF('house-ravenwatch', MORTAL));
// ---- an invite and its accept --------------------------------------------------------------------------------------
const inv = globalThis.__dboGuildInvite(VAMP, MORTAL, 'bloodmist-clan');
ok('an invite (the module global) to a mortal is refused', !!inv.error && /could never belong/.test(inv.error), inv);
const inv2 = globalThis.__dboGuildInvite(VAMP, WOLF, 'bloodmist-clan');
ok('...and to a werewolf', !!inv2.error);
// a mortal invited as a vampire who is cured before accepting
KIND.set(MORTAL, 'vampire');
const inv3 = globalThis.__dboGuildInvite(VAMP, MORTAL, 'bloodmist-clan');
KIND.delete(MORTAL);
line = faction(MORTAL, 'accept bloodmist-clan');
ok('cured between the invite and the accept: the accept is refused', !!inv3.text && !inBF(), line);
function inBF() { return inF('bloodmist-clan', MORTAL); }
// ---- any module's setMember: the Ravenwatch hook's path stays, and the guard runs first --------------------------------
ok('the guard sits in setMember, the one write every join goes through, before every other join rule', (() => { const s = fs.readFileSync(GUILDS, 'utf8'); const i = s.indexOf('const setMember = '); const g = s.indexOf("if (f && f.requires && !entryOf(fid, a) && !fits(a, f)) return", i); return g > i && g < s.indexOf("if (f && f.kind === 'pack' && !entryOf(fid, a) && packFull(fid))", i); })());

// ---- a faction merge into a clan ------------------------------------------------------------------------------------
fs.writeFileSync(path.join(dir, 'guilds.json'), JSON.stringify({ 'old-coven': { [String(MORTAL)]: { rank: 0, name: 'Mortal', tag: 'T12', since: 1 }, [String(VAMP)]: { rank: 0, name: 'Vamp', tag: 'T13', since: 1 } } }));
cfg.factions = { merged: { 'old-coven': { into: 'house-ravenwatch' } } };
audits.length = 0; load();
ok('a merge into a clan moves its vampires only; the mortal is left out, audited', inF('house-ravenwatch', VAMP) && !inF('house-ravenwatch', MORTAL) && audits.some((t) => /not a vampire, so not moved into House Ravenwatch/.test(t)), audits);
cfg.factions = {}; fs.unlinkSync(path.join(dir, 'guilds.json')); load();

// ---- a cure or a change of kind ------------------------------------------------------------------------------------
// (the merge's reload began the rolls afresh)
add('clan-volkihar', 'Elder'); faction(LEAD, 'leader Elder clan-volkihar');
add('clan-volkihar', 'Vamp');
add('pack-of-falkreath', 'Wolf'); add('clan-volkihar', 'Lead');
ok('setup: Vamp in Volkihar (one vampire clan at a time), Elder its leader; Wolf in a pack; the staff character in Volkihar', inF('clan-volkihar', VAMP) && inF('pack-of-falkreath', WOLF) && inF('clan-volkihar', LEAD));
told.length = 0; audits.length = 0;
KIND.delete(VAMP);
const left = globalThis.__dboGuildKindSweep(VAMP, 'cured');
ok('cured: the vampire leaves the clan', !inF('clan-volkihar', VAMP) && left.join() === 'Clan Volkihar', left);
ok('...told so', told.some((t) => t.a === VAMP && /You are no longer a vampire, and Clan Volkihar is no longer yours\./.test(t.t)), told);
ok('...and the leader is told', told.some((t) => t.a === ELDER && /Vamp is no longer a vampire, and has left Clan Volkihar\./.test(t.t)), told);
ok('...audited: the leave (FACTION) and why (KINDGUARD)', audits.some((t) => /^FACTION Vamp \(profile 19\) left Clan Volkihar$/.test(t)) && audits.some((t) => /^KINDGUARD Vamp \(profile 19\) no longer a vampire, so out of Clan Volkihar \(cured\)$/.test(t)), audits);
KIND.set(WOLF, 'vampire');
globalThis.__dboGuildKindSweep(WOLF, 'became a vampire');
ok('a werewolf turned vampire leaves the pack', !inF('pack-of-falkreath', WOLF));
const elderBefore = inF('clan-volkihar', ELDER);
globalThis.__dboGuildKindSweep(ELDER, 'became a vampire');
ok('a vampire still a vampire (a pure-blood\'s Embrace) keeps the clan', elderBefore && inF('clan-volkihar', ELDER));
ok('a staff character is never swept', globalThis.__dboGuildKindSweep(LEAD, 'cured').length === 0 && inF('clan-volkihar', LEAD));

// ---- House Ravenwatch takes at most five (guild-defs maxMembers; Nat, 1 Nov) ----------------------------------------------
ok(((defs.factions || defs).find((f) => f.id === 'house-ravenwatch') || {}).maxMembers === 5, 'guild-defs.json: House Ravenwatch maxMembers 5');
const RW = [0x30, 0x31, 0x32, 0x33, 0x34, 0x35];
RW.forEach((id, i) => { chars.set(id, `Raven${i}`); KIND.set(id, 'vampire'); onlineSet.add(id); });
load();
faction(LEAD, 'leader Raven0 house-ravenwatch');
for (let i = 1; i < 5; i++) add('house-ravenwatch', `Raven${i}`);
ok(RW.slice(0, 5).every((id) => inF('house-ravenwatch', id)), 'five vampires join, its leader among them');
add('house-ravenwatch', 'Raven5');
ok(!inF('house-ravenwatch', 0x35), 'a sixth is refused: the house is full');
const full = globalThis.__dboGuildInvite(0x30, 0x35, 'house-ravenwatch');
told.length = 0; faction(0x35, 'accept house-ravenwatch');
ok(!inF('house-ravenwatch', 0x35) && (/is full: it takes at most 5, its leader included\./.test(last(0x35)) || !!full.error), 'an invite and its accept are refused too', [full, last(0x35)]);
faction(LEAD, 'override Raven5 house-ravenwatch'); add('house-ravenwatch', 'Raven5');
ok(!inF('house-ravenwatch', 0x35), '/faction override lifts the limits, never the size');
globalThis.__dboGuildLeave(0x34, 'house-ravenwatch');
add('house-ravenwatch', 'Raven5');
ok(inF('house-ravenwatch', 0x35), 'one leaves: a place opens');
add('clan-volkihar', 'Raven4');
ok(inF('clan-volkihar', 0x34), 'the other clans keep no such limit');

// ---- supernatural.js: when the sweep runs -------------------------------------------------------------------------------
const sn = fs.readFileSync(path.join(ROOT, 'supernatural.js'), 'utf8');
const end = sn.slice(sn.indexOf('const endCurse = '), sn.indexOf('const FEVER_TURNED'));
ok('supernatural.js: a cure sweeps, never the pass through no kind inside a turning', /if \(!\/\^became a \/\.test\(String\(why\)\)\) kindSweep\(a, why\);/.test(end));
const bv = sn.slice(sn.indexOf('const becomeVampire = '), sn.indexOf('const becomeWerewolf = '));
const bw = sn.slice(sn.indexOf('const becomeWerewolf = '), sn.indexOf('const becomeWerewolf = ') + 2000);
ok('...a turning sweeps once its new kind is saved', bv.indexOf("kindSweep(a, 'became a vampire');") > bv.indexOf('saveState(a, s);') && bw.indexOf("kindSweep(a, 'became a werewolf');") > bw.indexOf('saveState(a, s);'));
ok('...a pure-blood and a blessed werewolf keep their kind (vampire, werewolf)', /Object\.assign\(s, \{ kind: 'vampire', disease: null, stage: 1, lastFed: gameDays\(\), pure: !!pure/.test(sn) && /Object\.assign\(s, \{ kind: 'werewolf', disease: null, stage: 0, blessed: !!blessed/.test(sn));
ok('no new mp.on in guilds.js or supernatural.js', !/mp\.on\(/.test(fs.readFileSync(GUILDS, 'utf8')) && !/\bmp\.on\(/.test(sn));

console.log(fails ? `\n${fails} failed` : '\nall passed');
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* EBUSY on Windows */ }
process.exit(fails ? 1 : 0);
