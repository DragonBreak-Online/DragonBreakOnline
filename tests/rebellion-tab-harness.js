// The Rebellion tab of the F3 Faction panel (rebellion.js __dboRebellionView + its rebellionTab* panel events, 23 Oct):
// hidden while rebellion.enabled is off; the petition's status (its word, the count against the threshold, signer names
// only for its starter, its leader and staff); start, sign, unsign, hand on the leadership, the claimant, the name,
// declare (to the death), join after the declaration, the war's timeline, and the ruler's answer to a death war. Each
// button runs the /rebellion command's own function and its refusal is drawn in the panel; a stale nonce does nothing.
// The world and the stub api are rebellion-harness.js's.
//
//   node tests/rebellion-tab-harness.js   (from server/)
'use strict';
//   node tests/rebellion-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const M = (f) => path.join(ROOT, f);
if (!fs.existsSync(M('rebellion.js')) || !/__dboRebellionView/.test(fs.readFileSync(M('rebellion.js'), 'utf8'))) { require('./expect')('rebellion-tab', 'there is no Rebellion tab in this line'); console.log('ok    skipped: no Rebellion tab in this line'); process.exit(0); }
const CFG = JSON.parse(fs.readFileSync(M('gamemode-config.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-rebeltab-'));
for (const f of ['guild-defs.json', 'territories.json', 'zones.json']) { try { fs.copyFileSync(M(f), path.join(dir, f)); } catch (e) { /* optional */ } }
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let now = Date.UTC(2026, 9, 21, 12, 0);   // Wednesday 21 October 2026, noon UTC
Date.now = () => now;
const DAY = 86400000;
let fails = 0;
const ok = (what, c, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

// ---- the world --------------------------------------------------------------------------------------------------------
const ZONES = [
  { id: 'whiterun', name: 'Whiterun Hold', treasury: 'w', officials: ['jarl', 'steward', 'commander', 'courtmage', 'guardcaptain', 'guard'] },
  { id: 'riften', name: 'The Rift', treasury: 'r', officials: ['jarl', 'steward', 'commander', 'courtmage', 'guardcaptain', 'guard'] },
];
const chars = new Map();
const RACE_IDS = { NordRace: 0x13746, BretonRace: 0x13741, ImperialRace: 0x13744, HighElfRace: 0x13745 };
const RACE_OF = new Map(Object.entries(RACE_IDS).map(([k, v]) => [v, k]));
const add = (id, pid, name, race) => { chars.set(id, { pid, name, race: race || 'NordRace' }); return id; };
const JARL = add(0x100, 1, 'Jarl Balgruuf'); const STEWARD = add(0x101, 2, 'Proventus'); const HOUSECARL = add(0x102, 3, 'Irileth');
const GUARD = add(0x103, 4, 'Guard Hrolf');
const LOYAL = add(0x104, 5, 'Loyal Olfina');   // a citizen in the household's Citizen rank who never signs
const C = []; for (let i = 0; i < 12; i++) C.push(add(0x200 + i, 100 + i, `Citizen${i}`));
const ALT = add(0x2f0, 100, 'Citizen0 Alt');                     // the same account as C[0]
const ELF = add(0x300, 300, 'Elwen', 'HighElfRace');
const OUTSIDER = add(0x301, 301, 'Wanderer');
const RJARL = add(0x400, 40, 'Jarl Laila');
const R = []; for (let i = 0; i < 6; i++) R.push(add(0x500 + i, 500 + i, `Riften${i}`));
const STAFF = add(0x900, 900, 'Lead GM');
let online = [...chars.keys()];
const officials = { whiterun: { jarl: [1], steward: [2], guard: [4] }, riften: { jarl: [40] } };
const pos = new Map(); const world = new Map();
const W = '3c:Skyrim.esm';
const T = JSON.parse(fs.readFileSync('territories.json', 'utf8')).territories;
const marker = (id) => T.find((t) => t.id === id).marker.pos;
const standAt = (list, id) => { for (const a of list) { pos.set(a, marker(id).slice()); world.set(a, W); } };
standAt([...chars.keys()], 'rorikstead');

// Rosters before guilds.js first loads: C[3] leads the Fighters Guild; Irileth is the household's Housecarl; C[5] holds
// the household's Citizen rank (a citizen, and no court)
const DEFS = JSON.parse(fs.readFileSync('guild-defs.json', 'utf8'));
const ranksOfDef = (fid) => { const f = DEFS.factions.find((x) => x.id === fid); return (f.ranks || DEFS.templates[f.template]).map((r) => r.title); };
const WR = ranksOfDef('hold-whiterun');
const entry = (a, fid, title) => ({ rank: ranksOfDef(fid).indexOf(title), title, name: chars.get(a).name, tag: `T${a.toString(16)}`, since: now - 30 * DAY });
fs.writeFileSync('guilds.json', JSON.stringify({ 'fighters-guild': { [C[3]]: entry(C[3], 'fighters-guild', ranksOfDef('fighters-guild')[0]) },
  'hold-whiterun': { [HOUSECARL]: entry(HOUSECARL, 'hold-whiterun', 'Housecarl'), [C[5]]: entry(C[5], 'hold-whiterun', 'Citizen'), [LOYAL]: entry(LOYAL, 'hold-whiterun', 'Citizen'), [JARL]: entry(JARL, 'hold-whiterun', 'Jarl') },
  'hold-riften': { [RJARL]: entry(RJARL, 'hold-riften', ranksOfDef('hold-riften')[0]) } }));

// Homes for the raids: the Steward's and C[1]'s in Whiterun's capital territory
const STEWARD_HOME = 0x7000, STEWARD_BOX = 0x7001, REBEL_HOME = 0x7100, REBEL_BOX = 0x7101;
fs.writeFileSync('housing.json', JSON.stringify([STEWARD_HOME, REBEL_HOME]));
const homes = { [STEWARD_HOME]: { owner: 2, ownerName: 'Proventus', name: 'Proventus\'s house', containers: [STEWARD_BOX] }, [REBEL_HOME]: { owner: 101, ownerName: 'Citizen1', name: 'Citizen1\'s house', containers: [REBEL_BOX] } };
globalThis.__dboHousing = { primaryOf: (r) => (homes[r] ? r : 0), recordOf: (r) => homes[r] || null, ownerActorsOf: (rec) => [...chars.entries()].filter(([, c]) => c.pid === rec.owner).map(([id]) => id) };
const props = new Map();
const resetBoxes = () => { props.set(`${STEWARD_BOX}|inventory`, { entries: [{ baseId: 0xf, count: 1000 }] }); props.set(`${REBEL_BOX}|inventory`, { entries: [{ baseId: 0xf, count: 1000 }] }); };
resetBoxes();
for (const h of [STEWARD_HOME, REBEL_HOME]) { props.set(`${h}|worldOrCellDesc`, W); props.set(`${h}|pos`, marker('whiterun').slice()); }

const permaKilled = [];
globalThis.__dboPermaKill = (a) => { permaKilled.push(a); props.set(`${a}|private.permaDead`, true); };
globalThis.__dboCharterNameCheck = (raw) => (/^(Bruma|Whiterun)$/i.test(String(raw).trim()) ? { error: 'That is a hold or a region, not a name for a faction.' } : { name: String(raw).trim() });
globalThis.__dboTreasury = { balance: () => 0, spend: () => true, deposit: () => true };
globalThis.__dboJournalFresh = () => true; globalThis.__dboJournalLimited = (a, f) => f();

const mp = {
  get: (id, p) => {
    if (props.has(`${id}|${p}`)) return props.get(`${id}|${p}`);
    const c = chars.get(id >>> 0);
    if (!c) { if (homes[id] || [STEWARD_BOX, REBEL_BOX].includes(id)) return undefined; throw new Error('no such form'); }
    if (p === 'type') return 'MpActor';
    if (p === 'pos') return pos.get(id);
    if (p === 'worldOrCellDesc') return world.get(id);
    if (p === 'isDead') return false;
    if (p === 'appearance') return { raceId: RACE_IDS[c.race] };
    if (p === 'inventory') return { entries: [] };
    return undefined;
  },
  set: (id, p, v) => props.set(`${id}|${p}`, v),
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16),
  getDescFromId: (id) => id.toString(16) + ':Skyrim.esm',
  getActorsByProfileId: (pid) => [...chars.entries()].filter(([, c]) => c.pid === pid).map(([id]) => id),
  lookupEspmRecordById: (id) => ({ record: { editorId: RACE_OF.get(id) || '', type: 'MISC' } }),
};
const told = [], sys = [], audits = [], notes = [], drawn = [];
const commands = {}; const handlers = {}; const timers = {};
const nameOf = (a) => (chars.get(a >>> 0) || {}).name || `actor ${a}`;
const profileOf = (a) => { const c = chars.get(a >>> 0); return c ? c.pid : -1; };
const ranksOf = (pid) => { const out = []; for (const z of ZONES) for (const [r, list] of Object.entries(officials[z.id] || {})) if ((list || []).map(Number).includes(Number(pid))) out.push({ zone: z, rank: r }); return out; };
const TITLE = { jarl: 'Jarl', steward: 'Steward', guard: 'Guard', guardcaptain: 'Guard Captain', courtmage: 'Court Wizard' };
const accountActors = (pid) => [...chars.entries()].filter(([, c]) => c.pid === pid).map(([id]) => id);
// gamemode.js's seatOfficial and unseatOfficialBy, as far as the court goes: the one-seat rule, officials, the household rank
const seatOfficial = (z, rank, tg) => {
  if (['jarl', 'count', 'chieftain'].includes(rank) && typeof globalThis.__dboLeadershipRefusal === 'function') { const no = globalThis.__dboLeadershipRefusal(tg.actor, { kind: 'hold', id: z.id }); if (no) return { error: no }; }
  officials[z.id] = officials[z.id] || {};
  for (const r of Object.keys(officials[z.id])) officials[z.id][r] = officials[z.id][r].filter((x) => x !== tg.pid);
  officials[z.id][rank] = (officials[z.id][rank] || []).concat([tg.pid]);
  audits.push(`OFFICIAL seated ${tg.who} ${rank} of ${z.name}`);
  if (TITLE[rank]) globalThis.__dboCourtSync(z.id, tg.actor, [TITLE[rank]], true);
  return { text: 'seated' };
};
const unseatOfficialBy = (z, tg, by) => {
  let had = null;
  for (const r of Object.keys(officials[z.id] || {})) { if (officials[z.id][r].includes(tg.pid)) had = r; officials[z.id][r] = officials[z.id][r].filter((x) => x !== tg.pid); }
  if (!had) return { error: 'holds nothing' };
  audits.push(`OFFICIAL ${by} unseated ${tg.who} as ${had}`);
  if (TITLE[had]) for (const a of accountActors(tg.pid)) globalThis.__dboCourtSync(z.id, a, [TITLE[had]], false);
  return { had, text: 'unseated' };
};
const officialTarget = (q) => {
  const s = String(q).replace(/^#/, '').toLowerCase();
  const hit = [...chars.entries()].find(([id, c]) => c.name.toLowerCase() === s || `t${id.toString(16)}` === s);
  if (!hit) return { error: `No character called ${q}.` };
  return { pid: hit[1].pid, actor: hit[0], online: online.includes(hit[0]) ? hit[0] : 0, label: hit[1].name, who: hit[1].name };
};
const JARL_RACE = /^(Breton|Nord|Imperial)Race(Vampire)?$/;
let cfg;
const setCfg = (reb) => {
  cfg = JSON.parse(JSON.stringify(CFG));
  cfg.rebellion = Object.assign({}, reb || {});
  cfg.citizenship = Object.assign({}, cfg.citizenship || {}, { staffReleases: [], discordRoles: {}, defaultPolicy: 'free' });
  cfg.citizenship.election = Object.assign({}, cfg.citizenship.election || {}, { voterRules: { enabled: false } });
  cfg.war = Object.assign({}, cfg.war || {}, { enabled: false });
  cfg.raids = Object.assign({}, cfg.raids || {}, { enabled: false });
};
const base = () => ({
  mp, log: () => {}, personal: (a, t) => told.push([a >>> 0, t]), system: (a, t) => sys.push([a >>> 0, t]), audit: (t) => audits.push(t), staffNote: (a, w, d) => notes.push([a, w, d]),
  who: (a) => `${nameOf(a)} (${profileOf(a)})`, display: nameOf, nameOf, ownNameOf: nameOf, ownDisplay: nameOf, publicNameOf: nameOf, tagOf: (a) => `T${(a >>> 0).toString(16)}`,
  registerChatCommand: (n, f, o) => { commands[n] = { f, o }; }, onUi: (e, f) => { handlers[e] = f; }, openWidget: (a, p2) => { drawn.push({ a: a >>> 0, p: p2 }); return true; }, closeWidget: () => true,
  onlineActors: () => online.slice(), isAdmin: (a) => a === STAFF, isLeadStaff: (a) => a === STAFF, rolesOf: () => [],
  findByName: () => 0, findAnyByName: () => 0, profileOf, cfg, every: (n, ms, f) => { timers[n] = f; }, sendPacket: () => true,
  zoneList: () => ZONES, zoneById: (id) => ZONES.find((z) => z.id === String(id)) || null, readOfficials: () => officials, writeOfficials: (o) => { const copy = JSON.parse(JSON.stringify(o)); for (const k of Object.keys(officials)) delete officials[k]; Object.assign(officials, copy); },
  ranksOf, rankTitle: (r) => TITLE[r] || r, officialTarget, accountActors, seatOfficial, unseatOfficialBy,
  rulerSeats: () => { const out = []; for (const z of ZONES) for (const pid of ((officials[z.id] || {}).jarl || [])) out.push({ actor: accountActors(pid)[0], pid, zone: z.id, zoneName: z.name, rank: 'jarl' }); return out; },
  takeGold: () => true, depositToTreasury: (z, n) => n, raceEdidOf: (a) => chars.get(a >>> 0).race, zoneOfActor: () => 'whiterun',
  recordOf: () => ({ record: { type: 'MISC', editorId: 'Thing' } }), adminItemName: () => '', giveItem: () => true,
  rulerFit: (actor, z, office) => (office === 'jarl' && !JARL_RACE.test(chars.get(actor >>> 0).race) ? `${nameOf(actor)} is no Nord, Breton or Imperial. By Skyrim's law only a Breton, a Nord or an Imperial may sit as Jarl.` : ''),
});
let reb, citizen;
const load = () => {
  const api = base();
  for (const f of ['guilds.js', 'leadership.js', 'realm.js', 'raids.js', 'citizenship.js', 'outlaws.js', 'rebellion.js']) delete require.cache[M(f)];
  require(M('guilds.js'))(api);
  require(M('leadership.js'))(api);
  require(M('realm.js'))(api);
  require(M('raids.js'))(api);
  citizen = require(M('citizenship.js'))(api);
  require(M('outlaws.js'))(api);
  reb = require(M('rebellion.js'))(api);
};
const cmd = (a, args) => { told.length = 0; commands.rebellion.f(a, args); return told.filter(([x]) => x === (a >>> 0)).map(([, t]) => t).join(' | '); };
const said = (a) => told.filter(([x]) => x === (a >>> 0)).map(([, t]) => t).join(' | ');
const tickAll = () => { for (const k of ['realm', 'raids', 'rebellion']) if (timers[k]) timers[k](); };
const tickFor = (seconds) => { for (let s = 0; s < seconds; s += 2) { now += 2000; timers.realm(); } };
const war = (id) => globalThis.__dboRealmWar(id);

// ---- the flag off (the default) ----------------------------------------------------------------------------------------
setCfg({});
load();
// The court and the citizens: the Jarl's household rank is in step with the office; every citizen joins free
for (const a of [...C, ELF, HOUSECARL, LOYAL]) { const r = citizen.join(a, 'whiterun'); if (r.error) console.log('setup:', nameOf(a), r.error); }
for (const a of R) citizen.join(a, 'riften');
ok('setup: 15 citizen accounts of Whiterun', globalThis.__dboCitizenAccountCount('whiterun') === 15, globalThis.__dboCitizenAccountCount('whiterun'));
const panel = (a) => globalThis.__dboFactionPayload(a, false);
const nonceOf = (a) => globalThis.__dboGuildState.nonces.get(a >>> 0);
const press = (a, event, ...args) => {
  drawn.length = 0; told.length = 0;
  const n = nonceOf(a) || panel(a).nonce;
  if (handlers[event]) handlers[event](a, [n, ...args]);
  const last = drawn.filter((d) => d.a === (a >>> 0)).pop();
  return last ? last.p : { result: said(a), resultKind: 'chat' };
};
const view = (a) => panel(a).rebellion;

// ---- the flag off ------------------------------------------------------------------------------------------------------
ok('flag off: the payload has no Rebellion tab (hidden entirely)', panel(C[0]).rebellion === null, panel(C[0]).rebellion);
let d = press(C[0], 'rebellionTabPetition', 'whiterun');
ok('flag off: a petition from the panel is refused, nothing begun', d.resultKind === 'refused' && /not in force/.test(d.result) && !Object.keys(reb.data().petitions).length, d);
ok('every button is registered', ['rebellionTabPetition', 'rebellionTabSign', 'rebellionTabUnsign', 'rebellionTabLeader', 'rebellionTabClaimant', 'rebellionTabName', 'rebellionTabAbandon', 'rebellionTabDeclare', 'rebellionTabJoin', 'rebellionTabDeath'].every((e) => typeof handlers[e] === 'function'));

// ---- the petition ------------------------------------------------------------------------------------------------------
setCfg({ enabled: true });
load();
let v = view(C[0]);
ok('flag on: a citizen sees the hold they may petition against', v && v.petition === null && v.holds.some((h) => h.id === 'whiterun' && h.open), v && v.holds);
ok('the rules are in the view (notice, windows, outlaws)', v.rules.noticeDays === 3 && v.rules.windowsPerWar === 3 && v.rules.deathWar === true && v.rules.outlawDays === 30);
d = press(OUTSIDER, 'rebellionTabPetition', 'whiterun');
ok('a non-citizen\'s petition: refused with the command\'s words', d.resultKind === 'refused' && /Only a citizen of Whiterun Hold/.test(d.result), d.result);
d = press(C[0], 'rebellionTabPetition', 'whiterun');
const P = () => reb.data().petitions.whiterun;
ok('a citizen begins one from the panel, drawn green with its word', d.resultKind === 'ok' && !!P() && d.result.includes(P().code), d.result);
const CODE = P().code;
v = d.rebellion;
ok('the starter\'s view: word, count 1 of 10, the signer names', v.petition && v.petition.code === CODE && v.petition.count === 1 && v.petition.needed === 10 && v.petition.starter && v.petition.signers.length === 1 && v.holds.length === 0, v.petition);
d = press(C[1], 'rebellionTabSign', 'zzzzzz');
ok('a wrong word: refused', d.resultKind === 'refused' && /No petition goes by that word/.test(d.result), d.result);
for (const a of C.slice(1, 10)) press(a, 'rebellionTabSign', CODE.toLowerCase());
ok('citizens sign with the word (any case)', P().signers.length === 10, P().signers.length);
v = view(C[2]);
const names = P().signers.map((s) => s.name);
ok('a signer sees the count and the threshold, met, but no names', v.petition.count === 10 && v.petition.met === true && v.petition.signers.length === 0 && v.petition.starterName === '' && v.petition.leaderName === ''
  && !names.filter((n) => n !== 'Citizen2').some((n) => JSON.stringify(v).includes(n)), v.petition);
v = view(JARL);
ok('the ruler sees no petition, no word, no names', v.petition === null && !JSON.stringify(v).includes(CODE) && !names.some((n) => JSON.stringify(v).includes(n)) && v.staffPetitions === null, v);
v = view(STAFF);
ok('a Lead GM sees every petition with its signers', v.staffPetitions.length === 1 && v.staffPetitions[0].signers.length === 10, v.staffPetitions);
d = press(C[9], 'rebellionTabUnsign');
ok('unsign takes a name back', d.resultKind === 'ok' && P().signers.length === 9, d.result);
d = press(C[0], 'rebellionTabUnsign');
ok('the starter cannot unsign (abandon instead)', d.resultKind === 'refused' && /abandon tears it up/.test(d.result), d.result);
press(C[9], 'rebellionTabSign', CODE);

// ---- leader, claimant, name -----------------------------------------------------------------------------------------------
d = press(C[1], 'rebellionTabLeader', C[2]);
ok('only the starter hands on the leadership', d.resultKind === 'refused' && /Only the one who began/.test(d.result), d.result);
d = press(C[0], 'rebellionTabLeader', OUTSIDER);
ok('a non-signer cannot be made leader', d.resultKind === 'refused' && /not signed/.test(d.result), d.result);
d = press(C[0], 'rebellionTabLeader', C[1]);
ok('the starter hands it to a signer picked from the list', d.resultKind === 'ok' && P().leader.actor === C[1], d.result);
v = view(C[1]);
ok('the new leader sees the names, and is the leader', v.petition.leader === true && v.petition.signers.length === 10 && v.petition.leaderName === 'Citizen1', v.petition);
press(ELF, 'rebellionTabSign', CODE);
d = press(C[1], 'rebellionTabClaimant', ELF);
ok('the claimant must be fit for the throne', d.resultKind === 'refused' && /only a Breton, a Nord or an Imperial/.test(d.result) && !P().claimant, d.result);
d = press(C[1], 'rebellionTabClaimant', C[2]);
ok('the leader names a claimant', d.resultKind === 'ok' && P().claimant.actor === C[2] && d.rebellion.petition.claimant.name === 'Citizen2', d.result);
d = press(C[1], 'rebellionTabName', 'Whiterun');
ok('the name goes through the charter check', d.resultKind === 'refused' && /hold or a region/.test(d.result), d.result);
d = press(C[1], 'rebellionTabName', 'The Whitemane Rising');
ok('the leader names the rising', d.resultKind === 'ok' && d.rebellion.petition.name === 'The Whitemane Rising' && d.rebellion.petition.named, d.result);

// ---- a stale nonce --------------------------------------------------------------------------------------------------------
drawn.length = 0;
handlers.rebellionTabDeclare(C[1], ['stale', 'death']);
ok('a stale nonce declares nothing and draws nothing', !reb.data().risings.length && drawn.length === 0);

// ---- declare --------------------------------------------------------------------------------------------------------------
d = press(C[0], 'rebellionTabDeclare', 'death');
ok('only the leader declares', d.resultKind === 'refused' && /Only the petition's leader/.test(d.result), d.result);
d = press(C[1], 'rebellionTabDeclare', 'death');
const rs = reb.data().risings.find((r) => r.zone === 'whiterun');
ok('the leader declares, to the death', d.resultKind === 'ok' && /has risen/.test(d.result) && !!rs && war(rs.warId).death === 'proposed', d.result);
v = d.rebellion;
const ri = v.risings[0];
ok('the tab shows the rising: name, hold, leader, claimant, rebels, the capital', v.petition === null && ri && ri.name === 'The Whitemane Rising' && ri.holdName === 'Whiterun Hold' && ri.leaderName === 'Citizen1' && ri.claimantName === 'Citizen2' && ri.rebels.length === 11 && ri.rebel && ri.leads, ri);
ok('the timeline: notice until the first battle, three windows, the death proposal, no captures', ri.status === 'notice' && ri.war && ri.war.windows.length === 3 && ri.war.startsAt === ri.war.windows[0].start && ri.war.death === 'proposed' && ri.war.captures.length === 0, ri.war);
v = view(OUTSIDER);
ok('a declared rising is public, its rebels named', v.risings.length === 1 && v.risings[0].rebels.includes('Citizen4') && !v.risings[0].canJoin, v.risings[0]);
v = view(JARL);
ok('the ruler may answer the death war', v.risings[0].rules === true && v.risings[0].canAnswerDeath === true && v.risings[0].canJoin === false, v.risings[0]);
ok('a rebel may not', view(C[1]).risings[0].canAnswerDeath === false);
v = view(C[10]);
ok('a citizen who did not sign may join', v.risings[0].canJoin === true && v.risings[0].rebel === false, v.risings[0]);
d = press(C[10], 'rebellionTabJoin', 'whiterun');
ok('...and joins', d.resultKind === 'ok' && /You rise with The Whitemane Rising/.test(d.result) && globalThis.__dboGuildMembers(rs.faction).includes(C[10]) && d.rebellion.risings[0].rebel, d.result);
d = press(GUARD, 'rebellionTabJoin', 'whiterun');
ok('the court cannot join', d.resultKind === 'refused' && /serve the court|Only a citizen/.test(d.result), d.result);
d = press(C[0], 'rebellionTabDeath', 'accept');
ok('only the ruler answers the death war', d.resultKind === 'refused' && /Only the ruler/.test(d.result), d.result);
d = press(JARL, 'rebellionTabDeath', 'refuse');
ok('the ruler refuses it', d.resultKind === 'ok' && /refuse a war to the death/.test(d.result) && war(rs.warId).death === 'refused' && d.rebellion.risings[0].canAnswerDeath === false, d.result);

// ---- a reload, then the war under way --------------------------------------------------------------------------------------
load();
ok('a hot reload over the old state: the rising and its view stay', view(C[1]).risings.length === 1 && view(C[1]).risings[0].war.death === 'refused');
now = war(rs.warId).startsAt + 60000; tickAll();
v = view(C[1]);
ok('once the first battle begins, the tab says active', v.risings[0].status === 'active' && v.risings[0].war.status === 'active', [v.risings[0].status, v.risings[0].war.status]);
setCfg({});
load();
ok('switched off again: the tab is hidden', panel(C[1]).rebellion === null);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
