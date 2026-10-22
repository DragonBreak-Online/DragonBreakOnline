// Risings against a hold's ruler (rebellion.js; Nate, 22 Oct 2026). Real rebellion.js, realm.js, raids.js, guilds.js,
// leadership.js, citizenship.js and outlaws.js with the live guild-defs.json, territories.json and gamemode-config.json,
// a stub gamemode api, in a temp folder:
//   the flag off (the default): nothing happens; the secret petition (the code, one name per account, the court cannot
//   sign, nobody but its starter and leader and staff sees who signed); the thresholds (minSignatures and minShare, both or
//   either); the leader's one leadership seat and the claimant's race; the declaration (a rebel faction of kind
//   'rebellion' against the hold's faction for its capital, a war that runs with war.enabled off); raids both ways during
//   the rising and not after; victory (the court deposed, the claimant seated by the rebellion, the rebel faction
//   dissolved, the capital back with the hold); defeat (outlaws: citizenship taken and barred, a bounty, a cooldown); a war
//   to the death only when accepted; a hot reload over the old state; staff's view.
//
//   node tests/rebellion-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const M = (f) => path.join(ROOT, f);
if (!fs.existsSync(M('rebellion.js'))) { require('./expect')('rebellion', 'there is no rebellion.js in this line'); console.log('ok    skipped: no rebellion.js in this line'); process.exit(0); }
const CFG = JSON.parse(fs.readFileSync(M('gamemode-config.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-rebellion-'));
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
const told = [], sys = [], audits = [], notes = [];
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
  registerChatCommand: (n, f, o) => { commands[n] = { f, o }; }, onUi: (e, f) => { handlers[e] = f; }, openWidget: () => true, closeWidget: () => true,
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
let out = cmd(C[0], 'petition whiterun');
ok('flag off (the default): no petition can be begun', /not in force/.test(out) && !Object.keys(reb.data().petitions).length, out);
ok('flag off: the status says so', /not in force/.test(cmd(C[0], 'status')));
ok('flag off: realm\'s tick runs no rising, raids see no sides', globalThis.__dboRebellionOpen() === false && globalThis.__dboRebellionRaidSides('x', 'hold-whiterun', 'whiterun') === null);
ok('flag off: the rebel faction kind is known to nobody yet', !globalThis.__dboGuildInfo('rising-whiterun-1'));

// ---- the petition --------------------------------------------------------------------------------------------------------
setCfg({ enabled: true });
load();
ok('a reload with rebellion.enabled on opens risings', globalThis.__dboRebellionOpen() === true);
out = cmd(OUTSIDER, 'petition whiterun');
ok('a non-citizen cannot begin one', /Only a citizen of Whiterun Hold/.test(out), out);
out = cmd(JARL, 'petition whiterun');
ok('the ruler cannot rise against their own hold', /serve the court/.test(out) || /Only a citizen/.test(out), out);
out = cmd(HOUSECARL, 'petition whiterun');
ok('nor anyone of the household above its Citizen rank (the Housecarl)', /serve the court/.test(out), out);
out = cmd(C[0], 'petition whiterun');
const P = () => reb.data().petitions.whiterun;
ok('a citizen begins a secret petition and is given its word', !!P() && new RegExp(P().code).test(out) && P().signers.length === 1, out);
ok('the petition is audited and sent to the staff log', audits.some((t) => /REBELLION petition #\d+ begun in secret/.test(t)) && notes.some(([, w]) => w === 'rebellion petition'));
out = cmd(C[1], 'petition whiterun');
ok('one petition per hold at a time', /already passes from hand to hand/.test(out) && Object.keys(reb.data().petitions).length === 1, out);
const CODE = P().code;
ok('a wrong word signs nothing', /No petition goes by that word/.test(cmd(C[1], 'sign ZZZZZZ')));
for (const a of C.slice(1, 9)) cmd(a, `sign ${CODE}`);
ok('citizens sign with the word', P().signers.length === 9, P().signers.length);
out = cmd(ALT, `sign ${CODE}`);
ok('one name per account: an alt of a signer is refused', /Another of your characters/.test(out) || /Only a citizen/.test(out), out);
ok('the Steward (seated in an office) cannot sign', /serve the court/.test(cmd(STEWARD, `sign ${CODE}`)) || /Only a citizen/.test(cmd(STEWARD, `sign ${CODE}`)));
// The Steward made a citizen to be sure it is the court rule that refuses them
citizen.join(STEWARD, 'whiterun');
ok('...even as a citizen of the hold', /serve the court/.test(cmd(STEWARD, `sign ${CODE}`)));
ok('...nor a Guard of the hold', (citizen.join(GUARD, 'whiterun'), /serve the court/.test(cmd(GUARD, `sign ${CODE}`))));
ok('the household\'s Citizen rank is no court: C5 signed', P().signers.some((s) => s.actor === C[5]));
// Secrecy: the court hears nothing, a signer sees a count, the starter the names
const signerNames = P().signers.map((s) => s.name);
const courtHeard = told.concat(sys).filter(([a]) => [JARL, STEWARD, HOUSECARL, GUARD].includes(a)).map(([, t]) => t).join(' ');
ok('secrecy: no word of the petition or its signers reaches the court', !signerNames.some((n) => courtHeard.includes(n)) && !/petition/i.test(courtHeard.replace(/serve the court[^|]*/g, '')), courtHeard.slice(0, 300));
out = cmd(JARL, 'status');
ok('secrecy: the ruler\'s status shows no petition', !/Your name is on|signed|Its word/i.test(out) && !out.includes(CODE) && !signerNames.some((n) => out.includes(n)), out);
out = cmd(C[2], 'status');
ok('secrecy: a signer sees the count, not the names', /9 of/.test(out) && !signerNames.filter((n) => n !== 'Citizen2').some((n) => out.includes(n)), out);
out = cmd(C[0], 'status');
ok('the starter sees who signed, and the word', signerNames.every((n) => out.includes(n)) && out.includes(CODE), out);
ok('secrecy: the staff list and show are for staff only', /Staff only/.test(cmd(JARL, 'show whiterun')) && /Staff only/.test(cmd(C[0], 'list')));
out = cmd(STAFF, 'show whiterun');
ok('staff see every signer', signerNames.every((n) => out.includes(n)), out);

// ---- thresholds ------------------------------------------------------------------------------------------------------------
let t = reb.thresholdMet(P());
ok('threshold: 9 accounts of 10 is not enough (minSignatures 10)', t.n === 9 && !t.met && t.need.min === 10, t);
ok('a declaration short of names is refused', /needs more names/.test(cmd(C[0], 'declare')));
cmd(C[9], `sign ${CODE}`);
t = reb.thresholdMet(P());
ok('threshold: 10 accounts and 25% of 17 citizen accounts (5) is enough', t.n === 10 && t.met && t.need.share === 5, t);
setCfg({ enabled: true, minSignatures: 3, minShare: 0.75 });
load();
t = reb.thresholdMet(P());
ok('threshold, both (the default): 10 of 3 but not 75% of 17 (13) is not enough', !t.met && t.need.share === 13, t);
setCfg({ enabled: true, minSignatures: 3, minShare: 0.75, thresholdMode: 'any' });
load();
ok('threshold, any: either one will do', reb.thresholdMet(P()).met);
ok('a reload over the old state keeps the petition and its word', P() && P().code === CODE && P().signers.length === 10);
setCfg({ enabled: true });
load();

// ---- the leader, the claimant, the name -----------------------------------------------------------------------------------
ok('only the starter hands on the leadership', /Only the one who began/.test(cmd(C[1], 'leader Citizen3')));
cmd(C[0], 'leader Citizen3');
ok('the starter hands it to a signer', P().leader.actor === C[3]);
out = cmd(C[3], 'declare');
ok('one leadership seat: the Fighters Guild\'s leader cannot lead a rising too', /already holds/.test(out) && !reb.data().risings.length, out);
cmd(C[0], 'leader Citizen1');
ok('a signer who is no signer is not named', /has not signed/.test(cmd(C[1], 'claimant Wanderer')));
cmd(ELF, `sign ${CODE}`);
out = cmd(C[1], 'claimant Elwen');
ok('the claimant must be fit to sit as Jarl (Skyrim\'s law)', /only a Breton, a Nord or an Imperial/.test(out) && !P().claimant, out);
cmd(C[1], 'claimant Citizen2');
ok('the leader names a signer to take the throne', P().claimant && P().claimant.actor === C[2]);
ok('the name goes through the charter name check', /hold or a region/.test(cmd(C[1], 'name Whiterun')) && /will be The Whitemane Rising/.test(cmd(C[1], 'name The Whitemane Rising')));
// C[3] leads the Fighters Guild: as a member (not leader) of the rising, nothing collides
// ---- the declaration ---------------------------------------------------------------------------------------------------------
ok('only the petition\'s leader declares', /Only the petition's leader/.test(cmd(C[0], 'declare')));
out = cmd(C[1], 'declare death');
const RS = () => reb.data().risings.find((r) => r.zone === 'whiterun');
const rs = RS();
ok('the leader declares the rising', !!rs && rs.status === 'notice' && /has risen/.test(out), out);
const fid = rs && rs.faction;
const info = globalThis.__dboGuildInfo(fid) || {};
ok('the rebels become a faction of kind rebellion, named as the leader chose', info.kind === 'rebellion' && info.name === 'The Whitemane Rising', info);
ok('the leader holds its leader rank (a leadership seat)', globalThis.__dboLeadershipOf(C[1]).some((s) => s.kind === 'faction' && s.id === fid));
ok('every signer standing is a rebel, the Fighters Guild leader among them (as no leader of it)', globalThis.__dboGuildMembers(fid).length === 11 && globalThis.__dboGuildMembers(fid).includes(C[3]), globalThis.__dboGuildMembers(fid));
ok('declaring makes the rebels public: anyone reads who rose', /Citizen4/.test(cmd(JARL, 'status')) && /The Whitemane Rising/.test(cmd(OUTSIDER, 'status')));
ok('the petition is gone', !P());
const w = war(rs.warId);
ok('a war of kind rebellion: the rebels against the hold\'s faction, for its capital', w && w.kind === 'rebellion' && w.attacker === fid && w.defender === 'hold-whiterun' && w.goal.join() === 'whiterun', w);
ok('with a rising\'s notice (3 days) and three windows', w.startsAt >= now + 3 * DAY && w.startsAt < now + 4 * DAY && w.windows.length === 3, new Date(w.startsAt).toISOString());
ok('announced to everyone, audited and in the staff log', sys.filter(([, t2]) => /is in revolt/.test(t2)).length === online.length && audits.some((t2) => /REBELLION #\d+ declared/.test(t2)) && notes.some(([, n]) => n === 'rebellion declared'));
ok('a second rising in the hold is refused', /already in revolt/.test(cmd(C[10], 'petition whiterun')));
// A citizen joins after the declaration; the court cannot
out = cmd(C[10], 'join whiterun');
ok('a citizen joins the declared rising', globalThis.__dboGuildMembers(fid).includes(C[10]), out);
ok('the court cannot join it', /serve the court/.test(cmd(GUARD, 'join whiterun')));
ok('the to-the-death proposal is the ruler\'s to answer', /Only the ruler/.test(cmd(C[0], 'death accept')) && /accept a war to the death/.test(cmd(JARL, 'death accept')) && w.death === 'accepted');

// ---- raids, both ways, during the rising --------------------------------------------------------------------------------------
ok('raids are off in config', cfg.raids.enabled === false);
ok('only the rising\'s leader or the ruler sends a raid', /Only a rising's leader/.test(cmd(C[4], 'raid whiterun')));
ok('a raid names land of the hold', /Name a territory of Whiterun Hold/.test(cmd(C[1], 'raid ivarstead')));
out = cmd(C[1], 'raid whiterun');
ok('the rebel leader raids the hold\'s land with raids.enabled off', /Raid under way/.test(out), out);
told.length = 0;
ok('a rebel breaks into a loyalist\'s (the Steward\'s) home', globalThis.__dboRaidActivate(STEWARD_HOME, C[4]) === true && /You break in and take 150 gold/.test(said(C[4])), said(C[4]));
ok('but not into a fellow rebel\'s home', globalThis.__dboRaidActivate(REBEL_HOME, C[4]) === false);
ok('nor does a loyalist break in on the rebels\' raid', globalThis.__dboRaidActivate(REBEL_HOME, GUARD) === false);
out = cmd(JARL, 'raid riverwood');
ok('the ruler raids the declared rebels on the hold\'s own land', /Raid under way/.test(out), out);
resetBoxes(); told.length = 0;
// Riverwood is not where the homes stand; the ruler's raid on Whiterun's own land waits for the rebels' to end
ok('one raid at a time per side', /already raiding/.test(cmd(JARL, 'raid whiterun')));
now += 31 * 60000; timers.raids();
out = cmd(JARL, 'raid whiterun');
ok('once both raids are over, the ruler raids Whiterun for the rebels', /Raid under way/.test(out), out);
told.length = 0;
ok('a loyalist (a Guard) breaks into a declared rebel\'s home', globalThis.__dboRaidActivate(REBEL_HOME, GUARD) === true && /You break in/.test(said(GUARD)), said(GUARD));
ok('but not into a loyalist\'s home', globalThis.__dboRaidActivate(STEWARD_HOME, HOUSECARL) === false);
ok('a rebel with the household\'s Citizen rank (C5) is no loyalist on the ruler\'s raid', globalThis.__dboRaidActivate(STEWARD_HOME, C[5]) === false);

// ---- a hot reload over the old state, mid-rising ------------------------------------------------------------------------------
load();
ok('after a reload the rising, its faction, its war and the raid stand', RS().status === 'notice' && globalThis.__dboGuildInfo(fid).kind === 'rebellion' && globalThis.__dboGuildMembers(fid).length === 12 && war(rs.warId).status === 'notice' && globalThis.__dboRaidView().raids.length === 1);

// ---- victory --------------------------------------------------------------------------------------------------------------
const rebels = globalThis.__dboGuildMembers(fid);
now = w.windows[0].start + 1000; tickAll();
ok('the first window opens the war, with war.enabled off', war(rs.warId).status === 'active');
tickAll();
ok('the rising follows its war', RS().status === 'active');
standAt(rebels, 'whiterun'); standAt([JARL, STEWARD, HOUSECARL, GUARD], 'riverwood');
// C5 keeps the household's Citizen rank: a rebel all the same, and no defender at the standard
tickFor(302);
ok('rebels alone at the capital for 300 s take it', RS().status === 'won', RS().status);
ok('the court is deposed: the Steward and the Guard lose their seats', !(officials.whiterun.steward || []).length && !(officials.whiterun.guard || []).length, officials.whiterun);
ok('the claimant is seated as Jarl by the rebellion', JSON.stringify(officials.whiterun.jarl) === JSON.stringify([102]) && audits.some((t2) => /OFFICIAL seated Citizen2/.test(t2)), officials.whiterun);
ok('the claimant leads the hold\'s household; the old Jarl does not', globalThis.__dboGuildsOf(C[2]).some((g) => g.id === 'hold-whiterun' && g.role === 'leader') && !globalThis.__dboGuildsOf(JARL).some((g) => g.id === 'hold-whiterun' && g.role === 'leader'));
ok('the rebel faction is dissolved', !globalThis.__dboGuildInfo(fid) && !globalThis.__dboGuildsOf(C[1]).some((g) => g.id === fid));
ok('the leader\'s seat went with it: the rebel leader holds no seat now', globalThis.__dboLeadershipOf(C[1]).length === 0);
ok('the capital is the hold\'s own again: nobody is a conqueror', globalThis.__dboRealmOwnerOf('whiterun') === 'hold-whiterun' && !globalThis.__dboConquerorLeads(C[1], 'whiterun'));
ok('the war is over, won', war(rs.warId).status === 'ended' && war(rs.warId).how === 'won');
ok('raids end with the rising', globalThis.__dboRaidView().raids.length === 0 && globalThis.__dboRebellionRaidSides('hold-whiterun', fid, 'whiterun') === null);
ok('after it, no raid is allowed (raids.enabled off)', /closed/.test(cmd(JARL, 'raid whiterun')) || /No rising|Only a rising/.test(cmd(JARL, 'raid whiterun')));
const bounties = () => { try { return JSON.parse(fs.readFileSync('outlaws.json', 'utf8')).zones || {}; } catch (e) { return {}; } };
ok('the winners keep their citizenship and no bounty', globalThis.__dboCitizenHolds(C[4]).includes('whiterun') && !Object.keys(bounties().whiterun || {}).length);
ok('a hold cooldown: no new petition in Whiterun', /rose not long ago/.test(cmd(C[11], 'petition whiterun')));
ok('a character cooldown on everyone who rose', /You rose not long ago/.test(cmd(C[4], 'petition whiterun')));
ok('nobody died: the war to the death was in force but no blow fell', permaKilled.length === 0);

// ---- defeat in the Rift, a war to the death ------------------------------------------------------------------------------
setCfg({ enabled: true, minSignatures: 4, minShare: 0.25 });
load();
out = cmd(R[0], 'petition riften');
if (!reb.data().petitions.riften) console.log('riften petition:', out, JSON.stringify(globalThis.__dboCitizenHolds(R[0])));
const RCODE = reb.data().petitions.riften.code;
for (const a of R.slice(1, 5)) cmd(a, `sign ${RCODE}`);
out = cmd(R[0], 'declare death');
const RR = () => reb.data().risings.find((r) => r.zone === 'riften');
ok('a second hold rises', RR() && RR().status === 'notice', out);
const rw = war(RR().warId);
const rfid = RR().faction;
cmd(RJARL, 'death refuse');
ok('a war to the death only if the ruler accepts: refused', rw.death === 'refused');
now = rw.windows[0].start + 1000; tickAll(); tickAll();
standAt(R.slice(0, 5), 'riften'); standAt([RJARL], 'riften');
tickFor(302);
ok('a defender at the standard holds it', RR().status === 'active' && globalThis.__dboRealmOwnerOf('riften') === 'hold-riften');
ok('no permadeath in a war that was not accepted to the death', globalThis.__dboWarFinish(R[1], RJARL) === false && permaKilled.length === 0);
// During the rising, the ruler raids the rebels; after defeat, nothing
ok('the ruler of the Rift may raid the rebels while it lasts', globalThis.__dboRebellionRaidSides('hold-riften', rfid, 'ivarstead') !== null);
now = Math.max(...rw.windows.map((x) => x.end)) + 1000; told.length = 0; tickAll();
const toldR3 = said(R[3]);
ok('the last window closes: the rising has failed', RR().status === 'lost' && war(RR().warId).how === 'lost', RR().status);
ok('defeat: the rebel faction is dissolved', !globalThis.__dboGuildInfo(rfid));
ok('defeat: the rebels lose their citizenship of the Rift', R.slice(0, 5).every((a) => !globalThis.__dboCitizenHolds(a).includes('riften')) && globalThis.__dboCitizenHolds(R[5]).includes('riften'));
const back = citizen.join(R[1], 'riften');
ok('defeat: and are barred from asking for it again', back.error && /outlaw of the Rift/i.test(back.error), back);
const wanted = bounties().riften || {};
ok('defeat: each rebel is wanted in the Rift (the hold\'s guards jail them, outlaws.js)', R.slice(0, 5).every((a) => wanted[String(chars.get(a).pid)] && wanted[String(chars.get(a).pid)].amount === 1000) && !wanted['505'], wanted);
ok('defeat: a cooldown before they rise again', /rose not long ago|Only a citizen/.test(cmd(R[2], 'petition riften')) && reb.data().charCooldowns[R[2].toString(16)] > now + 29 * DAY);
ok('defeat: nobody was killed for good', permaKilled.length === 0);
ok('after the rising, no raid between the two sides', globalThis.__dboRebellionRaidSides('hold-riften', rfid, 'ivarstead') === null);
ok('the defeat is told to each rebel and audited', toldR3.includes('outlaw of The Rift') && audits.some((t2) => /REBELLION #\d+ LOST/.test(t2)));

// ---- a war to the death, accepted; a withdrawal is a defeat -----------------------------------------------------------------
now += 31 * DAY;
for (const a of R.slice(0, 5)) { globalThis.__dboCitizenOutlaw(a, 'riften', 0, 'test reset'); citizen.join(a, 'riften'); }
for (const a of R.slice(0, 5)) delete reb.data().charCooldowns[a.toString(16)];
reb.data().holdCooldowns.riften = 0;
cmd(R[0], 'petition riften');
const RCODE2 = reb.data().petitions.riften.code;
for (const a of R.slice(1, 5)) cmd(a, `sign ${RCODE2}`);
cmd(R[0], 'declare death');
const RR2 = reb.data().risings.filter((r) => r.zone === 'riften').pop();
const rw2 = war(RR2.warId);
cmd(RJARL, 'death accept');
ok('accepted to the death', rw2.death === 'accepted');
now = rw2.windows[0].start + 1000; tickAll();
standAt([R[1], RJARL], 'riften');
ok('a loyalist\'s killing blow on a rebel at the capital in a window ends the character', globalThis.__dboWarFinish(R[1], RJARL) === true && permaKilled.includes(R[1]));
out = cmd(R[0], 'withdraw');
ok('the leader withdraws: a defeat, outlaws again', RR2.status === 'lost' && !globalThis.__dboCitizenHolds(R[2]).includes('riften'), out);

// ---- staff: a petition cancelled, a rising ended ----------------------------------------------------------------------------
now += 40 * DAY;
for (const k of Object.keys(reb.data().charCooldowns)) delete reb.data().charCooldowns[k];
reb.data().holdCooldowns.whiterun = 0;
// Whiterun now has Jarl Citizen2; the old Jarl's people petition
cmd(C[0], 'petition whiterun');
ok('staff cancel a petition', /cancelled/.test(cmd(STAFF, 'cancel whiterun')) && !reb.data().petitions.whiterun && said(C[0]).length >= 0);
ok('staff list shows the flag and the risings', /in force/.test(cmd(STAFF, 'list')) && /No petitions/.test(cmd(STAFF, 'list')) && /Whitemane/.test(cmd(STAFF, `show ${rs.id}`)));

// ---- the flag switched off again ------------------------------------------------------------------------------------------
setCfg({});
load();
ok('switched off: petitions are refused, nothing runs', /not in force/.test(cmd(C[0], 'petition whiterun')) && globalThis.__dboRebellionOpen() === false);
ok('rebellion.json and rebel-factions.json are gitignored (runtime)', /\/rebellion\.json/.test(fs.readFileSync(M('.gitignore'), 'utf8')) && /\/rebel-factions\.json/.test(fs.readFileSync(M('.gitignore'), 'utf8')));
const gm = fs.readFileSync(M('gamemode.js'), 'utf8');
ok('gamemode.js loads rebellion.js after raids.js, with seatOfficial, unseatOfficialBy and rulerFit', gm.indexOf("path.resolve('rebellion.js')") > gm.indexOf("path.resolve('raids.js')") && /rulerFit: \(actor, z, office\)/.test(gm));

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
