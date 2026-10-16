// The Thalmor's lore advantages (Nate, 11 Oct): the race rule (guilds.js factions.raceRules), Concordat arrests (thalmor.js
// with the real jail.js), informant reports from prayer, dossiers and the journal's Thalmor tab, and the Dominion stipend
// (economy.js). Real modules, real guild-defs.json and gamemode-config.json, a stub api, in a temp folder.
//
//   node tests/thalmor-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
if (!fs.existsSync(path.join(ROOT, 'thalmor.js'))) { require('./expect')('thalmor', 'there is no thalmor.js'); console.log('ok   skipped: no thalmor.js'); process.exit(0); }
const CFG = JSON.parse(SRC('gamemode-config.json'));
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-thalmor-'));
for (const f of ['guild-defs.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS clears it */ } });

let now = Date.UTC(2026, 9, 11, 18, 0);
Date.now = () => now;
const MIN = 60000;
let fails = 0, checks = 0;
const ok = (label, cond, got) => { checks++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

// ---- the config ------------------------------------------------------------------------------------------------------
const T = CFG.thalmor || {};
ok('thalmor config is on, every part', T.enabled === true && T.concordat.enabled === true && T.informants.enabled === true && T.dossiers.enabled === true);
ok('the Concordat binds Cyrodiil only, for Talos, 30 minutes', JSON.stringify(T.concordat.provinces) === '["cyrodiil"]' && JSON.stringify(T.concordat.heresies) === '["talos"]' && T.concordat.sentenceMinutes === 30);
ok('arrest: First Emissary, Justiciar, Inquisitor (leader, officer, sergeant); dossiers written by leader and officer',
  JSON.stringify(T.concordat.arrestRoles) === '["leader","officer","sergeant"]' && JSON.stringify(T.dossiers.writeRoles) === '["leader","officer"]');
const RR = CFG.factions.raceRules;
ok('race rule on: High Elves, Wood Elves, Khajiit; no Maormer; Altmer-led', RR.enabled === true && JSON.stringify(RR.rules.thalmor.races) === '["HighElfRace","WoodElfRace","KhajiitRace"]'
  && RR.rules.thalmor.notRp.includes('maormer') && JSON.stringify(RR.rules.thalmor.leadRaces) === '["HighElfRace"]' && JSON.stringify(RR.rules.thalmor.leadRoles) === '["leader","officer"]');
ok('no stipend from nothing: the Dominion and Imperial stipends are 0 in the live config (Nate, 16 Oct: treasury gold comes only from tax)', CFG.economy.dominionStipend === 0 && CFG.economy.imperialStipend === 0);
const DEFS = JSON.parse(SRC('guild-defs.json'));
const TR = DEFS.factions.find((f) => f.id === 'thalmor').ranks;
ok('the Thalmor ranks are as the rule names them', TR.map((r) => `${r.title}/${r.role}`).join(',') === 'First Emissary/leader,Justiciar/officer,Inquisitor/sergeant,Thalmor Wizard/mage,Thalmor Smith/blacksmith,Robe-Maker/tailor,Thalmor Soldier/member,Agent/member', TR);
ok('thalmor-intel.json is gitignored', /^thalmor-intel\.json$/m.test(SRC('.gitignore')));
ok('gamemode.js loads thalmor.js', /require\(THALMOR_JS\)\(\{[^}]*findAnyByName, zoneOfActor/.test(SRC('gamemode.js')));
ok('playermenu.js limits the Thalmor\'s lawful rank to Cyrodiil (lawfulFactionRegions)', /lawfulFactionRegions/.test(SRC('playermenu.js')) && /inFactionLand\(g\.id, a\)/.test(SRC('playermenu.js')));
ok('playermenu.js offers and dispatches the Concordat entry', /__dboConcordatEntries\(a, t\)/.test(SRC('playermenu.js')) && /__dboConcordatAction\(a, id, t, nameFor\)/.test(SRC('playermenu.js')));
ok('prayer.js tells the informants on kneeling', /__dboThalmorInformant\(casterId, targetId, d, shrineNameOf\(baseId, d\)\)[\s\S]{0,120}return startRound/.test(SRC('prayer.js')));
ok('thalmor.js registers no mp.on listener', !/mp\.on\(|\bmp\.on[A-Z]\w*\s*=/.test(SRC('thalmor.js')));

// ---- the stub server -------------------------------------------------------------------------------------------------
const LEAD = 0x10;
const ALT = 0x20, ALT2 = 0x21, BOS = 0x22, KHA_V = 0x23, NORD = 0x24, MAOR = 0x25, OLDNORD = 0x26, HERETIC = 0x30, PIOUS = 0x31, GUARD = 0x32, SKY = 0x33;
const names = { [LEAD]: 'Lead', [ALT]: 'Elenwen', [ALT2]: 'Ondolemar', [BOS]: 'Faendal', [KHA_V]: 'Jzargo', [NORD]: 'Ulfgar', [MAOR]: 'Orgnum', [OLDNORD]: 'Hrolf',
  [HERETIC]: 'Heimskr', [PIOUS]: 'Pious', [GUARD]: 'Bruma Guard', [SKY]: 'Skyrimer' };
const RACES = { 0x13746: 'HighElfRace', 0x88840: 'HighElfRaceVampire', 0x13749: 'WoodElfRace', 0x13745: 'KhajiitRace', 0x88845: 'KhajiitRaceVampire', 0x13747: 'NordRace', 0x13741: 'BretonRace' };
const raceOf = { [LEAD]: 0x13741, [ALT]: 0x13746, [ALT2]: 0x88840, [BOS]: 0x13749, [KHA_V]: 0x88845, [NORD]: 0x13747, [MAOR]: 0x13746, [OLDNORD]: 0x13747, [HERETIC]: 0x13747, [PIOUS]: 0x13747, [GUARD]: 0x13747, [SKY]: 0x13746 };
const BRUMA = 'a764b:BSHeartland.esm', JAIL_CELL = '6c410:BSHeartland.esm', SKYRIM = '3c:Skyrim.esm';
const PLUGINS = { 'Skyrim.esm': 0x00, 'BSHeartland.esm': 0x08 };
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const DOOR_BASE = '6c43c:BSHeartland.esm';
const CELL_DOOR = 0x6c438;
const TYPES = { [idOf(DOOR_BASE)]: 'DOOR', [idOf(JAIL_CELL)]: 'CELL', [idOf(BRUMA)]: 'WRLD', [idOf(SKYRIM)]: 'WRLD' };
const EDIDS = { [idOf(JAIL_CELL)]: 'CYRBrumaCastleDungeon' };
const props = new Map();
const put = (id, k, v) => props.set(`${id >>> 0}|${k}`, v);
for (const [a, r] of Object.entries(raceOf)) put(Number(a), 'appearance', { raceId: r });
put(MAOR, 'private.rp', { race: 'maormer' });
const at = (id, cell, pos) => { put(id, 'worldOrCellDesc', cell); put(id, 'pos', pos || [0, 0, 0]); };
for (const a of Object.keys(names)) at(Number(a), BRUMA);
at(SKY, SKYRIM);
const told = [], audits = [], logs = [];
const handlers = {}, commands = {};
const mp = {
  get: (id, k) => props.get(`${id >>> 0}|${k}`), set: (id, k, v) => props.set(`${id >>> 0}|${k}`, v),
  getIdFromDesc: idOf, getDescFromId: (id) => (id >>> 0).toString(16),
  lookupEspmRecordById: (id) => (RACES[id] ? { record: { type: 'RACE', editorId: RACES[id] } } : TYPES[id] ? { record: { type: TYPES[id], editorId: EDIDS[id] || '' } } : null),
};
const nameOf = (a) => names[a] || 'Stranger';
const find = (q) => { const s = String(q).toLowerCase(); const e = Object.entries(names).find(([id, n]) => n.toLowerCase() === s || `#t${Number(id).toString(16)}` === s); return e ? Number(e[0]) : 0; };
let online = Object.keys(names).map(Number);
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => told.push({ a, t }), system: (a, t) => told.push({ a, t, sys: true }), audit: (t) => audits.push(t),
  registerChatCommand: (n, f, o) => { commands[n] = { f, o }; }, onUi: (e, f) => { (handlers[e] = handlers[e] || []).push(f); },
  openWidget: (a, w) => { told.push({ a, w }); return true; }, closeWidget: () => true,
  display: (a) => `${nameOf(a)} #T${(a >>> 0).toString(16)}`, nameOf, tagOf: (a) => `T${(a >>> 0).toString(16)}`,
  onlineActors: () => online.slice(), isAdmin: (a) => a === LEAD, isLeadStaff: (a) => a === LEAD,
  findByName: find, findAnyByName: find, who: (a) => `${nameOf(a)} (${(a >>> 0).toString(16)})`, cfg: CFG, profileOf: (a) => a, readOfficials: () => ({}),
  every: () => {}, zoneOfActor: () => ({ id: 'bruma', name: 'Bruma' }),
  distanceMeters: (a, b) => (props.get(`${a}|worldOrCellDesc`) === props.get(`${b}|worldOrCellDesc`) ? 1 : Infinity),
};
// regions.js's answer for a place: Bruma's world and its castle dungeon are Cyrodiil, Tamriel is Skyrim
globalThis.__dboRegions = {
  placeOf: (d) => ({ province: String(d) === SKYRIM ? 'skyrim' : [BRUMA, JAIL_CELL].includes(String(d)) ? 'cyrodiil' : 'none' }),
  provinceName: (p) => ({ cyrodiil: 'Cyrodiil', skyrim: 'Skyrim' }[p] || p),
};
globalThis.__dboProseProblem = (t) => (/\bslurword\b/i.test(t) ? 'slurword' : null);
let lastAnswer = null;
globalThis.__dboJournalFresh = () => true;
globalThis.__dboJournalLimited = (a, fn) => { lastAnswer = fn(); };

const GUILDS = path.join(ROOT, 'guilds.js');
// Hrolf, a Nord, joined the Thalmor as an Agent before the rule (grandfathered)
fs.writeFileSync('guilds.json', JSON.stringify({ thalmor: { [OLDNORD]: { rank: 7, name: 'Hrolf', tag: 'T26', since: 1 } } }));
const loadGuilds = (cfg) => { delete require.cache[GUILDS]; delete globalThis.__dboGuildState; api.cfg = cfg || CFG; require(GUILDS)(api); api.cfg = CFG; };
loadGuilds();
const M = () => globalThis.__dboGuildState.members;
const rankIn = (a) => { const e = (M().thalmor || {})[String(a)]; return e ? e.rank : -1; };
const said = (a) => told.filter((x) => x.a === a && x.t).map((x) => x.t);
const lastSaid = (a) => { const l = said(a); return l[l.length - 1] || ''; };
const chat = (a, line) => { commands.faction.f(a, line); return lastSaid(a); };
const R = (title) => TR.findIndex((r) => r.title === title);

// ---- 4. the race rule ------------------------------------------------------------------------------------------------
ok('Hrolf keeps his place at load', rankIn(OLDNORD) === 7);
ok('/faction leader names an Altmer First Emissary', /now leads Thalmor/.test(chat(LEAD, 'leader Elenwen thalmor')) && rankIn(ALT) === 0, lastSaid(LEAD));
const inv = (by, t) => globalThis.__dboGuildInvite(by, t, 'thalmor');
const r1 = inv(ALT, NORD);
ok('a Nord is refused at the invite, in a lore line', r1.error && /Ulfgar cannot join Thalmor\. The Thalmor take only the peoples of the Aldmeri Dominion: the Altmer, the Bosmer and the Khajiit\./.test(r1.error), r1);
ok('the Maormer on the High Elf record are refused', /cannot join/.test((inv(ALT, MAOR).error || '')), inv(ALT, MAOR));
ok('a Bosmer is invited and accepts', !inv(ALT, BOS).error && /You are now/.test(chat(BOS, 'accept thalmor')) && rankIn(BOS) === 7, lastSaid(BOS));
ok('a vampire Khajiit (KhajiitRaceVampire) is taken', !inv(ALT, KHA_V).error && /You are now/.test(chat(KHA_V, 'accept thalmor')) && rankIn(KHA_V) === 7);
ok('a vampire Altmer is taken', !inv(ALT, ALT2).error && /You are now/.test(chat(ALT2, 'accept thalmor')));
const setRank = (by, t, title) => globalThis.__dboGuildSetRank(by, 'thalmor', t, R(title));
const sb = setRank(ALT, BOS, 'Justiciar');
ok('a Bosmer may not be made Justiciar (Altmer-led)', sb.error && /The Thalmor are led by the Altmer\. Only a High Elf may hold that rank\./.test(sb.error) && rankIn(BOS) === 7, sb);
ok('a Bosmer may be made Inquisitor', !setRank(ALT, BOS, 'Inquisitor').error && rankIn(BOS) === R('Inquisitor'));
ok('a vampire Altmer may be made Justiciar', !setRank(ALT, ALT2, 'Justiciar').error && rankIn(ALT2) === R('Justiciar'));
ok('grandfathered Hrolf moves to Thalmor Soldier', !setRank(ALT, OLDNORD, 'Thalmor Soldier').error && rankIn(OLDNORD) === R('Thalmor Soldier'));
ok('grandfathered Hrolf may not be made Justiciar', /led by the Altmer/.test(setRank(ALT, OLDNORD, 'Justiciar').error || ''));
ok('a Nord is refused at accept even with an invite from before', (() => { globalThis.__dboGuildState.invites.set(NORD, [{ fid: 'thalmor', from: ALT, at: now }]); const t = chat(NORD, 'accept thalmor'); return rankIn(NORD) < 0 && /The Thalmor take only/.test(t); })(), lastSaid(NORD));
ok('a Lead GM override lifts it once (audited)', (() => { chat(LEAD, 'override Ulfgar thalmor'); inv(ALT, NORD); chat(NORD, 'accept thalmor'); return rankIn(NORD) === 7 && audits.some((x) => /FACTION-LIMIT OVERRIDE by .*Ulfgar.*Thalmor/.test(x)); })());
ok('the Lead GM is still bound by the race rule for /faction leader', /led by the Altmer|take only/.test(chat(LEAD, 'leader Faendal thalmor')) && rankIn(BOS) === R('Inquisitor'), lastSaid(LEAD));
const br = globalThis.__dboFactionLimitBreaches();
ok('the breaches list Hrolf and Ulfgar for race', br.filter((b) => b.factions[0] === 'thalmor' && /race/.test(b.why)).map((b) => b.actor).sort().join() === [NORD, OLDNORD].sort().join(), br);
ok('nobody is removed', rankIn(OLDNORD) >= 0 && rankIn(NORD) >= 0);
{
  const off = JSON.parse(JSON.stringify(CFG)); off.factions.raceRules.enabled = false;
  const keep = JSON.stringify(M()); loadGuilds(off);
  ok('raceRules.enabled false lets a Breton in', !inv(ALT, LEAD).error, inv(ALT, LEAD));
  globalThis.__dboGuildState.members = JSON.parse(keep); globalThis.__dboGuildState.invites.clear();
  loadGuilds();
  globalThis.__dboGuildState.members = JSON.parse(keep);
}

// ---- the jail and the Thalmor module ---------------------------------------------------------------------------------
fs.writeFileSync('doors.json', JSON.stringify({ doors: {} }));
const JAIL = path.join(ROOT, 'jail.js'), THAL = path.join(ROOT, 'thalmor.js'), ECON = path.join(ROOT, 'economy.js');
const loadJail = () => { delete require.cache[JAIL]; require(JAIL)(Object.assign({}, api, { cfg: { jail: { cells: [JAIL_CELL] } } })); };
// As gamemode.js does, a reload starts the event table afresh
const loadThalmor = (cfg) => { delete require.cache[THAL]; delete handlers.thalmorNote; delete handlers.thalmorStrike; require(THAL)(Object.assign({}, api, { cfg: cfg || CFG })); };
loadJail(); loadThalmor();
const entries = (a, t) => globalThis.__dboConcordatEntries(a, t);
const act = (a, t) => globalThis.__dboConcordatAction(a, 'concordat:arrest', t, (v, x) => nameOf(x));
put(HERETIC, 'private.dboDeity', { id: 'talos', name: 'Talos' });
put(PIOUS, 'private.dboDeity', { id: 'akatosh', name: 'Akatosh' });

ok('a Justiciar in Bruma is offered the arrest', entries(ALT2, HERETIC).some((e) => e.id === 'concordat:arrest' && e.label === 'Arrest under the Concordat'));
ok('an Inquisitor is offered it too', entries(BOS, HERETIC).length === 1);
ok('a Thalmor Soldier or Agent is not', entries(OLDNORD, HERETIC).length === 0 && entries(KHA_V, HERETIC).length === 0);
ok('the entry shows on anyone (it does not tell the faith by itself)', entries(ALT2, PIOUS).length === 1);
at(ALT, SKYRIM);
ok('in Skyrim the First Emissary is offered nothing', entries(ALT, HERETIC).length === 0);
told.length = 0;
ok('in Skyrim an arrest is refused: no authority', act(ALT, HERETIC) === true && /binds the Empire, and you stand in Skyrim\. Here the Thalmor have no authority/.test(lastSaid(ALT)) && !globalThis.__dboConcordatLawful(ALT, HERETIC), lastSaid(ALT));
at(ALT, BRUMA);
ok('an Agent is refused by rank', act(KHA_V, HERETIC) && /Only the Thalmor's First Emissary, Justiciar and Inquisitor arrest/.test(lastSaid(KHA_V)), lastSaid(KHA_V));
ok('no charge against a follower of Akatosh', act(ALT2, PIOUS) && /no charge against them under the Concordat/.test(lastSaid(ALT2)));
ok('asking again at once waits retrySeconds', act(ALT2, PIOUS) && /Try again in 10 minutes/.test(lastSaid(ALT2)), lastSaid(ALT2));
ok('staff are never arrested', act(ALT2, LEAD) && /Staff cannot be arrested/.test(lastSaid(ALT2)));
ok('refused attempts are audited', audits.filter((x) => /^CONCORDAT refused/.test(x)).length >= 5);
told.length = 0;
ok('a Justiciar arrests a Talos worshipper', act(ALT2, HERETIC) === true && globalThis.__dboConcordatLawful(ALT2, HERETIC) === true);
const heard = said(HERETIC).join(' | ');
ok('the arrested player is told plainly why', /arrests you under the White-Gold Concordat: the worship of Talos is outlawed in the Empire/.test(heard) && /lawful arrest/.test(heard) && /30 minutes/.test(heard), heard);
ok('the Justiciar is told what comes next', /under arrest under the Concordat for the next 60 minutes\. Restrain them/.test(lastSaid(ALT2)), lastSaid(ALT2));
ok('the arrest is audited', audits.some((x) => /^CONCORDAT ARREST Ondolemar .* arrested Heimskr .* for the worship of talos in cyrodiil/.test(x)), audits.slice(-1));
ok('no second entry while the arrest stands', entries(ALT, HERETIC).length === 0);
ok('a Bruma guard is not counted lawful for it', !globalThis.__dboConcordatLawful(GUARD, HERETIC));

// At the cell door: the jail offers the Concordat's sentence to a Thalmor of an arresting rank
const choose = (a, id) => (handlers.jailChoose || []).forEach((f) => f(a, [id]));
at(CELL_DOOR, JAIL_CELL); put(CELL_DOOR, 'baseDesc', DOOR_BASE);
for (const a of [ALT2, HERETIC, GUARD, BOS]) at(a, JAIL_CELL);
put(ALT2, 'private.dboLawful', true); put(GUARD, 'private.dboLawful', true); put(BOS, 'private.dboLawful', true);
const lastWidget = (a) => { const w = told.filter((x) => x.a === a && x.w); return w.length ? w[w.length - 1].w : null; };
online = [ALT2, HERETIC];
globalThis.__dboJailActivate(CELL_DOOR, ALT2);
choose(ALT2, `who:${HERETIC.toString(16)}`);
const menu = lastWidget(ALT2);
ok('the sentence menu offers the Concordat sentence first', menu && menu.actions[0].id === `concordat:${HERETIC.toString(16)}` && menu.actions[0].label === "The Concordat's sentence: 30 minutes", menu && menu.actions[0]);
online = [GUARD, HERETIC];
globalThis.__dboJailActivate(CELL_DOOR, GUARD);
choose(GUARD, `who:${HERETIC.toString(16)}`);
ok('a Bruma guard is offered only the usual lengths', !lastWidget(GUARD).actions.some((x) => /^concordat:/.test(x.id)));
choose(GUARD, `concordat:${HERETIC.toString(16)}`);
ok('and cannot pass it by sending the id', !mp.get(HERETIC, 'private.dboSentence') && /no Concordat arrest/.test(lastSaid(GUARD)), lastSaid(GUARD));
online = [ALT2, HERETIC, GUARD, BOS];
told.length = 0;
globalThis.__dboJailActivate(CELL_DOOR, ALT2);
choose(ALT2, `who:${HERETIC.toString(16)}`);
choose(ALT2, `concordat:${HERETIC.toString(16)}`);
const s = mp.get(HERETIC, 'private.dboSentence');
ok('the Concordat sentence is 30 minutes and marked lawful', s && s.totalMs === 30 * MIN && s.concordat && /Ondolemar/.test(s.concordat.by), s);
ok('the prisoner is told it is under the Concordat', said(HERETIC).some((t) => /30 minutes in Bruma Castle Dungeon under the White-Gold Concordat, for the worship of Talos in the Empire\. It is a lawful sentence/.test(t)), said(HERETIC));
ok('the jailing is audited, and the arrest spent', audits.some((x) => /^JAIL .* under the Concordat$/.test(x)) && audits.some((x) => /^CONCORDAT JAIL Ondolemar .* jailed Heimskr .* for 30 min in Bruma Castle Dungeon \(arrested by Ondolemar/.test(x)) && !globalThis.__dboConcordatLawful(ALT2, HERETIC));
ok('the jailing goes into the prisoner\'s dossier as the Concordat record', (() => { const d = JSON.parse(fs.readFileSync('thalmor-intel.json', 'utf8')).dossiers[HERETIC.toString(16)]; return d && d.notes[0].byName === 'Concordat record' && /Arrested under the Concordat/.test(d.notes[0].text); })());
told.length = 0;
globalThis.__dboJailActivate(CELL_DOOR, GUARD);
const gm = lastWidget(GUARD);
ok('a Bruma guard sees no Release or Add at a Concordat cell', gm && !gm.actions.some((x) => x.id === 'release' || x.id === 'extend') && /held under the Concordat/.test(gm.targetName), gm);
choose(GUARD, 'release');
ok('and a forged release is refused', !!mp.get(HERETIC, 'private.dboSentence') && /held under the White-Gold Concordat\. Only the Thalmor may release them early/.test(lastSaid(GUARD)), lastSaid(GUARD));
globalThis.__dboJailActivate(CELL_DOOR, BOS);
ok('an Inquisitor may release it', lastWidget(BOS).actions.some((x) => x.id === 'release'));
choose(BOS, 'release');
ok('and does', !mp.get(HERETIC, 'private.dboSentence'));

// ---- 2a. informants --------------------------------------------------------------------------------------------------
for (const a of Object.keys(names)) at(Number(a), BRUMA);
online = Object.keys(names).map(Number);
told.length = 0;
const TALOS = { id: 'talos', name: 'Talos' };
ok('a kneeling at a Talos shrine is reported', globalThis.__dboThalmorInformant(HERETIC, 0x1234, TALOS, 'Shrine of Talos') === true);
const rep = said(ALT2).find((t) => /informant reports/.test(t)) || '';
ok('to the arresting ranks online, with shrine, place and hour', /someone knelt at the Shrine of Talos \(Bruma\)/.test(rep) && /18:00 UTC/.test(rep) && said(BOS).some((t) => /informant/.test(t)) && said(ALT).some((t) => /informant/.test(t)), rep);
ok('never the name', !told.some((x) => x.t && /informant/.test(x.t) && /Heimskr/.test(x.t)));
ok('not to Agents, Soldiers or anyone else', ![KHA_V, OLDNORD, GUARD, PIOUS].some((a) => said(a).some((t) => /informant/.test(t))));
ok('not twice for the same kneeling within two minutes', globalThis.__dboThalmorInformant(HERETIC, 0x1234, TALOS, 'Shrine of Talos') === false);
ok('config: informants report from Cyrodiil only', JSON.stringify(T.informants.provinces) === '["cyrodiil"]');
at(HERETIC, SKYRIM);
ok('a kneeling at a Talos shrine in Skyrim is not reported', globalThis.__dboThalmorInformant(HERETIC, 0x1299, TALOS, 'Shrine of Talos') === false);
at(HERETIC, BRUMA);
ok('nothing for another god', globalThis.__dboThalmorInformant(PIOUS, 0x1235, { id: 'akatosh', name: 'Akatosh' }, 'Shrine of Akatosh') === false);
now += 3 * MIN;
for (let i = 0; i < 60; i++) { now += 1000; globalThis.__dboThalmorInformant(HERETIC, 0x2000 + i, TALOS, 'Shrine of Talos'); }
ok('the last 50 reports are kept', JSON.parse(fs.readFileSync('thalmor-intel.json', 'utf8')).reports.length === 50);
ok('the report is audited for staff with the name', audits.some((x) => /^THALMOR INFORMANT Heimskr .* knelt at Shrine of Talos \(Bruma\); reported, without the name, to 3 online/.test(x)), audits.filter((x) => /INFORMANT/.test(x)).slice(0, 1));

// ---- 2b/2c. dossiers and the Thalmor tab -----------------------------------------------------------------------------
const SEC = globalThis.__dboJournalSections.thalmor;
ok('the Thalmor tab is visible to the First Emissary, a Justiciar and an Inquisitor', [ALT, ALT2, BOS].every((a) => !!SEC.visible(a)));
ok('not to an Agent, a Soldier or anyone outside', [KHA_V, OLDNORD, GUARD, LEAD].every((a) => !SEC.visible(a)));
const v = SEC.view(BOS);
ok('an Inquisitor reads reports and dossiers but cannot write', v.reports.length === 50 && v.dossiers.length === 1 && v.canWrite === false && v.canArrest === true && v.canRead === true, { r: v.reports.length, d: v.dossiers.length, w: v.canWrite });
ok('the view carries the Concordat terms', v.concordat.minutes === 30 && v.concordat.where === 'Cyrodiil' && v.concordat.here === true && v.concordat.arrestRanks === 'First Emissary, Justiciar and Inquisitor', v.concordat);
ok('reports are newest first', v.reports[0].at > v.reports[1].at);
ok('an Agent gets no view', SEC.view(KHA_V) === null);
const note = (a, q, text) => { lastAnswer = null; handlers.thalmorNote.forEach((f) => f(a, ['n', q, text])); return lastAnswer || {}; };
ok('an Inquisitor is refused a note', /Only the Thalmor's First Emissary and Justiciar write/.test(note(BOS, 'Pious', 'Seen near the chapel').text));
const n1 = note(ALT2, 'Pious', 'Seen near the  chapel\u0007 at dusk.');
ok('a Justiciar writes on a named character', n1.kind === 'ok' && /Noted in the dossier on Pious/.test(n1.text), n1);
ok('the note is cleaned and attributed', (() => { const d = SEC.view(ALT).dossiers.find((x) => x.name === 'Pious'); return d && d.notes[0].text === 'Seen near the chapel at dusk.' && d.notes[0].byName === 'Ondolemar'; })());
ok('the write is audited', audits.some((x) => /^THALMOR DOSSIER Ondolemar .* wrote on Pious .*"Seen near the chapel at dusk\." \(29 chars\)/.test(x)));
ok('a note over 500 characters is refused', /at most 500 characters/.test(note(ALT2, 'Pious', 'x'.repeat(501)).text));
ok('the prose filter refuses a slur', /does not take the word "slurword"/.test(note(ALT2, 'Pious', 'a slurword here').text));
ok('an unknown name is refused', /No character by that name/.test(note(ALT2, 'Nobody', 'text').text));
for (let i = 1; i < 20; i++) note(ALT2, 'Pious', `note ${i}`);
ok('a dossier holds 20 notes', /full \(20 notes\)/.test(note(ALT2, 'Pious', 'one more').text));
const key = PIOUS.toString(16);
const first = SEC.view(ALT).dossiers.find((x) => x.key === key).notes[0].at;
const strike = (a, k, atMs) => { lastAnswer = null; handlers.thalmorStrike.forEach((f) => f(a, ['n', k, atMs])); return lastAnswer || {}; };
ok('an Inquisitor may not strike', /Only the Thalmor's First Emissary and Justiciar strike/.test(strike(BOS, key, first).text));
ok('the First Emissary strikes a note', strike(ALT, key, first).kind === 'ok' && SEC.view(ALT).dossiers.find((x) => x.key === key).notes.length === 19);
ok('the strike is audited', audits.some((x) => /^THALMOR DOSSIER Elenwen .* struck a note on Pious/.test(x)));
ok('the dossier file is on disk and parses', !!JSON.parse(fs.readFileSync('thalmor-intel.json', 'utf8')).dossiers[key]);
{
  const small = JSON.parse(JSON.stringify(CFG)); small.thalmor.dossiers.max = 2;
  loadThalmor(small);
  ok('the dossier cap refuses a third character', /at most 2 dossiers/.test(note(ALT2, 'Bruma Guard', 'watch him').text));
  loadThalmor();
}
ok('a hot reload keeps the reports and the dossiers', SEC !== globalThis.__dboJournalSections.thalmor && globalThis.__dboJournalSections.thalmor.view(ALT).reports.length === 50);
ok('/dossier is a staff command', commands.dossier && commands.dossier.o.admin === true && commands.concordat && commands.concordat.o.admin === true);
told.length = 0; commands.concordat.f(LEAD, 'races');
ok('/concordat races lists the grandfathered members', /Ulfgar #T24 \(not of the Dominion's peoples\)/.test(lastSaid(LEAD)) && /Hrolf #T26/.test(lastSaid(LEAD)), lastSaid(LEAD));
{
  const off = JSON.parse(JSON.stringify(CFG)); off.thalmor.concordat.enabled = false;
  loadThalmor(off);
  ok('concordat.enabled false offers no arrest', entries(ALT2, HERETIC).length === 0);
  loadThalmor();
}

// ---- 3. the Dominion stipend -----------------------------------------------------------------------------------------
const treasuries = { thalmor: 0 };
globalThis.__dboTreasury = {
  keyOf: (f) => `faction:${f}`, balance: (f) => treasuries[f] || 0,
  spend: (f, n) => { if ((treasuries[f] || 0) < n) return false; treasuries[f] -= n; return true; },
  deposit: (f, n) => { treasuries[f] = (treasuries[f] || 0) + n; return true; },
};
globalThis.__dboHousing = null;
globalThis.__dboRealmLeads = (a, f) => a === ALT && f === 'thalmor';
told.length = 0;
const loadEcon = (cfg) => { delete require.cache[ECON]; return require(ECON)(Object.assign({}, api, { cfg: cfg || CFG })); };
{
  const live = loadEcon(); live.reckon();
  ok('with the live config the reckoning pays no stipend to anyone', !treasuries.thalmor && !treasuries['imperial-legion'], treasuries);
}
// The mechanism, should staff ever turn a stipend back on
const ON = JSON.parse(JSON.stringify(CFG)); ON.economy.dominionStipend = 300; ON.economy.imperialStipend = 300;
let E = loadEcon(ON);
const rep1 = E.reckon();
ok('the reckoning pays the Thalmor 300 gold from the Dominion', treasuries.thalmor === 300 && rep1.thalmor && rep1.thalmor.stipend === 300 && rep1.thalmor.stipendFrom === 'the Aldmeri Dominion', rep1.thalmor);
ok('it is in the saved faction report', JSON.parse(fs.readFileSync('economy.json', 'utf8')).reports.thalmor.stipend === 300);
ok('the First Emissary is told in the reckoning line', /300 gold stipend from the Aldmeri Dominion/.test(lastSaid(ALT)), lastSaid(ALT));
ok('the stipend is audited as new gold', audits.some((x) => /^ECONOMY Thalmor: stipend of 300 gold from the Aldmeri Dominion \(new gold\)/.test(x)));
// The Empire pays its Legion the same way (Nate, 16 Oct: the Legion had no income beside Bruma's tithe)
ok('the reckoning pays the Imperial Legion 300 gold from the Imperial City', treasuries['imperial-legion'] === 300 && rep1['imperial-legion'] && rep1['imperial-legion'].stipend === 300 && rep1['imperial-legion'].stipendFrom === 'the Imperial City', rep1['imperial-legion']);
ok('...audited as new gold, and the Thalmor are still paid their own', audits.some((x) => /stipend of 300 gold from the Imperial City \(new gold\)/.test(x)) && treasuries.thalmor === 300);
{
  const off = JSON.parse(JSON.stringify(ON)); off.economy.dominionStipend = 0;
  E = loadEcon(off); E.reckon();
  ok('dominionStipend 0 pays nothing', treasuries.thalmor === 300);
  const off2 = JSON.parse(JSON.stringify(ON)); off2.economy.imperialStipend = 0; const before = treasuries['imperial-legion'];
  E = loadEcon(off2); E.reckon();
  ok('imperialStipend 0 pays the Legion nothing', treasuries['imperial-legion'] === before);
}

// ---- patch notes -----------------------------------------------------------------------------------------------------
const NOTES = JSON.parse(SRC('patch-notes.json'));
const note1 = NOTES.find((n) => /Thalmor/.test(n.title));
const text = note1 ? JSON.stringify(note1) : '';
ok('a patch note dated SHIP_DATE or a date', !!note1 && (note1.date === 'SHIP_DATE' || /^\d{4}-\d{2}-\d{2}$/.test(note1.date)), note1 && note1.date);
ok('it names the four changes with their numbers', /Talos/.test(text) && /30 minutes/.test(text) && /300 gold/.test(text) && /High Elves, Wood Elves and Khajiit/.test(text) && /but never who/.test(text), text.slice(0, 200));

console.log(`${fails ? 'FAIL' : 'ok  '} thalmor: ${checks - fails}/${checks}`);
process.exit(fails ? 1 : 0);
