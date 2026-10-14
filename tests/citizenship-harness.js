// Scripted test for server\citizenship.js (Nate, 13/14 Oct 2026: citizenship of the holds and the first Jarl vote; design
// ~/claude-nate-release/specs/citizenship-1014.md with Nate's election rules). Loads the real module in a scratch folder
// against a mock world: Bruma (a Count, a treasury), Whiterun (no Jarl yet), Riften, an Orc stronghold, factions, races,
// officials, the journal hooks and a notice board. Time is a harness clock, so the 24-hour phases run in a moment.
//
//   node tests/citizenship-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'citizenship.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-citizen-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
let now = Date.UTC(2026, 9, 14, 12, 0);
Date.now = () => now;
const HOUR = 3600000, DAY = 24 * HOUR;

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

// ---- the world ---------------------------------------------------------------------------------------------------------
const ZONES = [
  { id: 'bruma', name: 'Bruma', treasury: 'x', officials: ['count', 'steward', 'captain', 'courtmage', 'guard'] },
  { id: 'whiterun', name: 'Whiterun', treasury: 'y', officials: ['jarl', 'steward', 'commander', 'courtmage', 'guardcaptain', 'guard'] },
  { id: 'riften', name: 'The Rift', treasury: 'z', officials: ['jarl', 'steward', 'commander', 'courtmage', 'guardcaptain', 'guard'] },
  { id: 'gol-kharzum', name: 'Gol-Kharzum', officials: ['chieftain', 'bane'] },
];
const officials = { bruma: { count: [1], steward: [2] } };
// actors: id -> { pid, name, race, gold }; the race is a RACE editor id
const chars = new Map();
const RACE_IDS = { NordRace: 0x13746, BretonRace: 0x13741, ImperialRace: 0x13744, HighElfRace: 0x13745, NordRaceVampire: 0x88794, OrcRace: 0x13747 };
const RACE_OF = new Map(Object.entries(RACE_IDS).map(([k, v]) => [v, k]));
const add = (id, pid, name, race, gold) => { chars.set(id, { pid, name, race: race || 'NordRace', gold: gold === undefined ? 1000 : gold }); return id; };
const COUNT = add(0x10, 1, 'Count Carvain', 'ImperialRace');
const STEWARD = add(0x11, 2, 'Steward Mira');
const ANNA = add(0x20, 20, 'Anna', 'BretonRace', 50);
const BJORN = add(0x21, 21, 'Bjorn');
const BJORN_ALT = add(0x22, 21, 'Bjorn the Second');
const ELF = add(0x23, 23, 'Elwen', 'HighElfRace');
const GUILDIE = add(0x24, 24, 'Gunnar the Guildsman');
const STAFF = add(0x30, 30, 'Staff Lead');
const GM = add(0x31, 31, 'Plain GM');
let online = [...chars.keys()];
// guild memberships per actor (guilds.js __dboGuildsOf shape)
const guilds = new Map([[GUILDIE, [{ id: 'fighters-guild', name: 'Fighters Guild', title: 'Associate', role: 'member', kind: 'guild', zone: '', hall: { zone: 'bruma' } }]]]);
const FACTIONS = { 'fighters-guild': { id: 'fighters-guild', kind: 'guild', zone: '', hall: { zone: 'bruma' } }, 'county-bruma': { id: 'county-bruma', kind: 'hold', zone: 'bruma' }, 'hold-whiterun': { id: 'hold-whiterun', kind: 'hold', zone: 'whiterun' } };
globalThis.__dboGuildsOf = (a) => guilds.get(a >>> 0) || [];
globalThis.__dboCourtFaction = (z) => ({ bruma: 'county-bruma', whiterun: 'hold-whiterun' })[z] || null;
globalThis.__dboGuildHolders = () => [];
globalThis.__dboFactionList = () => Object.keys(FACTIONS);
globalThis.__dboGuildInfo = (id) => FACTIONS[id] || null;
globalThis.__dboGuildMembers = (id) => [...guilds.entries()].filter(([, gs]) => gs.some((g) => g.id === id)).map(([a]) => a);
const courtSyncs = [];
globalThis.__dboCourtSync = (zone, actor, titles, seated) => { courtSyncs.push({ zone, actor, titles, seated }); return `${actor} ${titles.join('/')}`; };
// The journal shell: every nonce is fresh, every answer is kept
const journalAnswers = [];
globalThis.__dboJournalFresh = () => true;
globalThis.__dboJournalLimited = (a, fn) => journalAnswers.push(fn());

const mp = {
  get: (id, p) => {
    const c = chars.get(id >>> 0); if (!c) throw new Error('no such form');
    if (p === 'type') return 'MpActor';
    if (p === 'appearance') return { raceId: RACE_IDS[c.race] };
    if (p === 'profileId') return c.pid;
    return undefined;
  },
  lookupEspmRecordById: (id) => ({ record: { editorId: RACE_OF.get(id) || '' } }),
};
const said = [], audits = [], widgets = [], closed = [], seats = [], unseats = [], deposits = [];
const ui = {};
let timer = null;
let nearBoard = new Map();
const api = () => ({
  mp, log: () => {}, audit: (t) => audits.push(t), who: (a) => (chars.get(a >>> 0) || {}).name || `actor ${a}`,
  personal: (a, t) => said.push([a >>> 0, t]), nameOf: (a) => chars.get(a >>> 0).name, ownNameOf: (a) => chars.get(a >>> 0).name, tagOf: (a) => `T${(a >>> 0).toString(16)}`,
  onUi: (n, f) => { ui[n] = f; }, onlineActors: () => online.slice(), isAdmin: (a) => a === STAFF || a === GM, isLeadStaff: (a) => a === STAFF,
  profileOf: (a) => { const c = chars.get(a >>> 0); return c ? c.pid : -1; },
  cfg: { citizenship: { discordRoles: { bruma: '1500000000000000001', whiterun: 'not-an-id' } } },
  every: (n, ms, f) => { timer = f; },
  zoneList: () => ZONES, zoneById: (id) => ZONES.find((z) => z.id === String(id)) || null, readOfficials: () => officials,
  rankTitle: (r) => ({ count: 'Count', jarl: 'Jarl', steward: 'Steward', commander: 'Lord Commander' })[r] || r,
  officialTarget: (q) => {
    const s = String(q).replace(/^#/, '').toLowerCase();
    const hit = [...chars.entries()].filter(([id, c]) => c.name.toLowerCase() === s || `t${id.toString(16)}` === s);
    if (!hit.length) return { error: `No character called ${q}.` };
    const [actor, c] = hit[0];
    return { pid: c.pid, actor, online: online.includes(actor) ? actor : 0, label: c.name, who: c.name };
  },
  accountActors: (pid) => [...chars.entries()].filter(([, c]) => c.pid === pid).map(([id]) => id),
  seatOfficial: (z, rank, tg) => { seats.push({ zone: z.id, rank, pid: tg.pid }); officials[z.id] = officials[z.id] || {}; for (const r of Object.keys(officials[z.id])) officials[z.id][r] = officials[z.id][r].filter((x) => x !== tg.pid); officials[z.id][rank] = (officials[z.id][rank] || []).concat([tg.pid]); return { text: 'seated' }; },
  unseatOfficialBy: (z, tg) => { unseats.push({ zone: z.id, pid: tg.pid }); for (const r of Object.keys(officials[z.id] || {})) officials[z.id][r] = officials[z.id][r].filter((x) => x !== tg.pid); return { text: 'unseated' }; },
  takeGold: (a, n) => { const c = chars.get(a >>> 0); if (c.gold < n) return false; c.gold -= n; return true; },
  depositToTreasury: (z, n) => { deposits.push([z, n]); return n; },
  openWidget: (a, w) => { widgets.push([a >>> 0, w]); return true; }, closeWidget: (a, id) => closed.push([a, id]),
  boardZoneNear: (a) => nearBoard.get(a >>> 0) || null,
  raceEdidOf: (a) => chars.get(a >>> 0).race,
});
const load = () => { delete require.cache[MODULE]; return require(MODULE)(api()); };
let M = load();
const last = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === (a >>> 0)) return said[i][1]; return ''; };
const lastWidget = (a) => { for (let i = widgets.length - 1; i >= 0; i--) if (widgets[i][0] === (a >>> 0)) return widgets[i][1]; return null; };
const R = (r) => (r && (r.error || r.text)) || '';

// ---- policies ------------------------------------------------------------------------------------------------------------
let r = M.join(ANNA, 'bruma');
ok(!r.error && M.citizenOf(ANNA, 'bruma'), 'free (the default): Anna becomes a citizen of Bruma at once', r);
ok(M.holdsOf(ANNA)[0].zone === 'bruma', "Bruma is Anna's Primary");
r = M.setPolicy(ANNA, 'bruma', 'paid', 100);
ok(r.error && /Count or the Steward/.test(r.error), 'a citizen cannot set the policy', r);
r = M.setPolicy(STEWARD, 'bruma', 'paid', 100);
ok(!r.error && /100 gold/.test(r.text), 'the Steward sets a paid citizenship of 100 gold', r);
r = M.join(BJORN, 'bruma');
ok(!r.error && chars.get(BJORN).gold === 900 && deposits.some(([z, n]) => z === 'bruma' && n === 100), 'paid: Bjorn pays 100 gold into the Bruma treasury and is a citizen', [r, chars.get(BJORN).gold, deposits]);
const poor = add(0x40, 40, 'Poor Pell', 'NordRace', 10); online.push(poor);
r = M.join(poor, 'bruma');
ok(r.error && /costs 100 gold/.test(r.error) && !M.citizenOf(poor, 'bruma'), 'paid: without the fee nothing happens', r);
r = M.setPolicy(COUNT, 'bruma', 'manual');
ok(!r.error, 'the Count sets manual approval', r);
r = M.join(poor, 'bruma');
ok(!r.error && /asked/.test(r.text) && !M.citizenOf(poor, 'bruma'), 'manual: Pell asks, and is not yet a citizen', r);
ok(/asks to become a citizen of Bruma/.test(last(COUNT)) && /asks/.test(last(STEWARD)), 'the Count and Steward online are told');
const entries = globalThis.__dboCitizenMenuEntries(STEWARD, poor);
ok(entries.some((e) => e.id === 'citizen:grant:bruma') && entries.some((e) => e.id === 'citizen:decline:bruma'), "the Steward's X menu on Pell offers Grant and Decline", entries);
ok(globalThis.__dboCitizenMenuEntries(BJORN, poor).length === 0, 'a plain citizen gets no such entry');
ok(globalThis.__dboCitizenMenuAction(STEWARD, 'citizen:grant:bruma', poor) === true && M.citizenOf(poor, 'bruma'), 'the Steward grants it face to face from the X menu', last(STEWARD));
const manualB = add(0x41, 41, 'Dagny'); online.push(manualB);
M.join(manualB, 'bruma');
r = M.decline(COUNT, 'bruma', manualB);
ok(!r.error && !M.citizenOf(manualB, 'bruma') && /declined/.test(last(manualB)), 'the Count declines a request and the asker is told', r);
r = M.grant(BJORN, 'bruma', manualB);
ok(r.error, 'a plain citizen cannot grant', r);

// ---- first citizen with no Jarl is free ----------------------------------------------------------------------------------
r = M.setPolicy(STAFF, 'whiterun', 'paid', 500);
ok(!r.error, 'staff may set a policy for Whiterun', r);
const goldBefore = chars.get(ANNA).gold;
r = M.join(ANNA, 'whiterun');
ok(!r.error && M.citizenOf(ANNA, 'whiterun') && chars.get(ANNA).gold === goldBefore, 'Whiterun has no Jarl: Anna joins free though the policy says paid', [r, chars.get(ANNA).gold]);
ok(M.holdsOf(ANNA).map((h) => h.zone).join() === 'bruma,whiterun', 'Bruma Primary, Whiterun Secondary');

// ---- at most two; Primary and Secondary ----------------------------------------------------------------------------------
r = M.join(ANNA, 'riften');
ok(r.error && /2 holds already/.test(r.error), 'a third hold is refused', r);
r = M.makePrimary(ANNA, 'whiterun');
ok(!r.error && M.holdsOf(ANNA)[0].zone === 'whiterun', 'Anna makes Whiterun her Primary', r);
r = M.join(ANNA, 'gol-kharzum');
ok(r.error && /no citizenship/.test(r.error), 'an Orc stronghold grants no citizenship', r);

// ---- the 7-day cooldown ----------------------------------------------------------------------------------------------------
r = M.renounce(ANNA, 'whiterun');
ok(!r.error && !M.citizenOf(ANNA, 'whiterun') && M.holdsOf(ANNA)[0].zone === 'bruma', 'Anna renounces Whiterun; Bruma is her Primary again', r);
r = M.join(ANNA, 'riften');
ok(r.error && /renounced/.test(r.error), 'switching: she cannot take Riften within 7 days', r);
now += 7 * DAY - HOUR;
ok(M.join(ANNA, 'riften').error, '... nor an hour before the 7 days are up');
now += 2 * HOUR;
r = M.join(ANNA, 'riften');
ok(!r.error && M.citizenOf(ANNA, 'riften'), 'after 7 days she takes Riften', r);
M.renounce(ANNA, 'riften'); now += 8 * DAY;

// ---- Bruma's factions and courts are its citizens -------------------------------------------------------------------------
ok(M.citizenOf(GUILDIE, 'bruma') && M.holdsOf(GUILDIE)[0].auto, 'a Fighters Guild member (hall in Bruma) is a Bruma citizen without asking');
ok(M.citizenOf(COUNT, 'bruma') && M.citizenOf(STEWARD, 'bruma'), "Bruma's Count and Steward are its citizens (its court)");
r = M.renounce(GUILDIE, 'bruma');
ok(r.error && /faction or court/.test(r.error), 'an automatic citizenship cannot be renounced while the membership lasts', r);
ok(!M.citizenOf(GUILDIE, 'whiterun'), 'it gives no other hold');

// ---- Discord roles ------------------------------------------------------------------------------------------------------
ok(JSON.stringify(globalThis.__dboCitizenRoleIds(ANNA)) === '["1500000000000000001"]', "Anna's citizen role is Bruma's configured id", globalThis.__dboCitizenRoleIds(ANNA));
ok(JSON.stringify(globalThis.__dboCitizenManagedRoleIds()) === '["1500000000000000001"]', 'an id that is not a Discord id is ignored', globalThis.__dboCitizenManagedRoleIds());
ok(globalThis.__dboCitizenOf(ANNA, 'bruma') === true && globalThis.__dboCitizenOf(ELF, 'bruma') === false && globalThis.__dboCitizenGates('bruma') && !globalThis.__dboCitizenGates('gol-kharzum'), 'the property gate asks Bruma, not a stronghold');

// ---- Bruma holds no election ---------------------------------------------------------------------------------------------
const brumaMany = [];
for (let i = 0; i < 16; i++) { const id = add(0x100 + i, 100 + i, `Brumite ${i}`); online.push(id); brumaMany.push(id); M.setPolicy(COUNT, 'bruma', 'free'); M.join(id, 'bruma'); }
ok(M.citizenAccounts({ id: 'bruma', officials: ZONES[0].officials }) >= 15, 'Bruma has more than 15 citizen accounts');
timer();
ok(!M.data().elections.bruma, 'no election starts in Bruma');
const bv = M.votingView(ANNA, ZONES[0]);
ok(bv.electing === false && /county of the Empire/.test(bv.why) && /Count/.test(bv.why), "Bruma's Voting tab says why, in lore terms", bv.why);

// ---- Whiterun: the 15-citizen threshold --------------------------------------------------------------------------------
const WR = ZONES[1];
const voters = [];
for (let i = 0; i < 14; i++) { const id = add(0x200 + i, 200 + i, `Whiterunner ${i}`, i % 2 ? 'NordRace' : 'ImperialRace'); online.push(id); voters.push(id); M.join(id, 'whiterun'); }
const alt1 = add(0x2f0, 200, 'Whiterunner 0 alt'); online.push(alt1); M.join(alt1, 'whiterun');
timer();
ok(M.citizenAccounts(WR) === 14 && !M.data().elections.whiterun, '14 accounts (an alt counts once): no election yet', M.citizenAccounts(WR));
M.join(ELF, 'whiterun');
timer();
let E = M.data().elections.whiterun;
ok(E && E.phase === 'registration' && E.phaseEndsAt === now + 24 * HOUR, 'the 15th account starts registration for 24 hours by itself', E);
ok(said.some(([a, t]) => a === voters[0] && /choose its Jarl/.test(t)), 'citizens online are told');

// ---- registering a court -------------------------------------------------------------------------------------------------
const [J1, S1, C1, H1, J2, S2, C2, H2, V1, V2] = voters;
const nm = (a) => chars.get(a).name;
r = M.register(ELF, 'whiterun', [nm(S1), nm(C1), nm(H1)]);
ok(r.error && /Breton, Nord or Imperial/.test(r.error), 'a High Elf cannot stand for Jarl', r);
r = M.register(J1, 'whiterun', [nm(S1), nm(C1), nm(GUILDIE)]);
ok(r.error && /Housecarl/.test(r.error), 'every court member must be a citizen of the hold', r);
guilds.set(H2, [{ id: 'companions', title: 'Whelp', role: 'member', kind: 'guild', zone: '' }]);
r = M.register(J1, 'whiterun', [nm(S1), nm(C1), nm(H2)]);
ok(r.error && /faction/.test(r.error), 'a court member in a faction is refused', r);
guilds.delete(H2);
r = M.register(J1, 'whiterun', [nm(S1), nm(C1), 'Whiterunner 0 alt']);
ok(r.error && /different player/.test(r.error), 'the Jarl and the court are four different players', r);
r = M.register(J1, 'whiterun', [nm(S1), nm(C1), nm(H1)]);
ok(!r.error, 'a Breton/Nord/Imperial citizen enters a court', r);
ok(/names you Steward/.test(last(S1)), 'the named Steward is told');
r = M.register(J2, 'whiterun', [nm(S1), nm(C2), nm(H2)]);
ok(r.error && /another court/.test(r.error), 'a character is on one court only', r);
r = M.register(J2, 'whiterun', [nm(S2), nm(C2), nm(H2)]);
ok(!r.error, 'a second court is entered', r);
E = M.data().elections.whiterun;
const [K1, K2] = E.courts.map((c) => c.id);
for (const a of [S1, C1, H1, S2, C2]) M.answerInvite(a, 'whiterun', a === S1 || a === C1 || a === H1 ? K1 : K2, true);
// the F3 tab shows the outstanding invitation with a badge
const jv = M.journalView(H2);
ok(jv.invites.length === 1 && jv.invites[0].seat === 'Housecarl', "H2's journal shows the Housecarl invitation", jv.invites);
ok(globalThis.__dboJournalSections.citizen.visible(H2).badge === 1, 'with a badge on the Citizen tab');
ui.citizenJ(H2, ['n', 'accept', 'whiterun', K2]);
ok(journalAnswers.length && journalAnswers[journalAnswers.length - 1].kind === 'ok', 'H2 accepts from the journal', journalAnswers[journalAnswers.length - 1]);
let vv = M.votingView(J1, WR);
ok(vv.courts.length === 2 && vv.courts.every((c) => c.complete), 'both courts are complete', vv.courts);
const noCounts = (v) => !/"(votes|counts|tally)"/.test(JSON.stringify(v));
ok(noCounts(vv) && noCounts(M.votingView(STAFF, WR)), 'no count in the registration view, staff included');

// ---- a restart mid-phase keeps the clock ---------------------------------------------------------------------------------
now += 12 * HOUR;
delete globalThis.__dboCitizen; M = load();
timer();
E = M.data().elections.whiterun;
ok(E.phase === 'registration' && E.courts.length === 2, 'after a restart 12 hours in, registration still runs with both courts', E.phase);
now += 12 * HOUR; timer();
E = M.data().elections.whiterun;
ok(E.phase === 'voting' && E.ballot.length === 2 && E.phaseEndsAt === now + 24 * HOUR, 'at 24 hours the vote opens for 24 hours', [E.phase, E.ballot]);
r = M.register(V1, 'whiterun', [nm(V2), nm(S1), nm(C1)]);
ok(r.error && /registration/.test(r.error), 'no new court once the vote is open', r);

// ---- voting ------------------------------------------------------------------------------------------------------------
r = M.vote(GUILDIE, 'whiterun', K1);
ok(r.error && /citizens/.test(r.error), 'a non-citizen cannot vote', r);
guilds.set(V2, [{ id: 'companions', title: 'Whelp', role: 'member', kind: 'guild', zone: '' }]);
r = M.vote(V2, 'whiterun', K1);
ok(r.error && /faction/.test(r.error), 'a citizen in a faction cannot vote in the first election', r);
guilds.delete(V2);
ok(!M.vote(V1, 'whiterun', K1).error, 'a citizen votes');
r = M.vote(V1, 'whiterun', K2);
ok(r.error && /One vote/.test(r.error), 'no second vote');
ok(!M.vote(J1, 'whiterun', K1).error, 'a candidate who is a citizen in no faction votes too');
r = M.vote(alt1, 'whiterun', K2);
ok(r.error && /One vote per player/.test(r.error), "an alt of a voter's account cannot vote again", r);
ok(!audits.slice(-1)[0].includes(K1) && /voted/.test(audits.slice(-1)[0]), 'the audit records that a vote was cast, not for whom', audits.slice(-1)[0]);
M.vote(V2, 'whiterun', K2); M.vote(S2, 'whiterun', K2);
vv = M.votingView(V1, WR);
ok(vv.voted && noCounts(vv) && noCounts(M.votingView(STAFF, WR)) && noCounts(M.journalView(STAFF)), 'during the vote nobody sees a count, staff included');
ok(!JSON.stringify(M.boardPayload(STAFF, 'whiterun', 'n', 'voting')).includes('"votes"'), 'nor in the board panel');

// ---- a tie goes to a revote between the tied courts ---------------------------------------------------------------------
now += 24 * HOUR; timer();
E = M.data().elections.whiterun;
ok(E.phase === 'voting' && E.round === 2 && E.revote && E.ballot.length === 2 && Object.keys(E.votes).length === 0, 'a 2-2 tie: a 24-hour revote between them, votes cleared', E);
vv = M.votingView(V1, WR);
ok(vv.revote && !vv.voted && noCounts(vv), 'the voter may vote again in the revote, still no count');
ok(!M.data().elections.whiterun.result, 'no result yet');

// ---- a court member loses eligibility during the vote: the seat starts empty -------------------------------------------
M.vote(V1, 'whiterun', K1);
M.vote(V2, 'whiterun', K1);
M.vote(S2, 'whiterun', K2);
guilds.set(C1, [{ id: 'companions', title: 'Whelp', role: 'member', kind: 'guild', zone: '' }]);
officials.whiterun = { jarl: [999] };
now += 24 * HOUR; timer();
E = M.data().elections.whiterun;
ok(E.phase === 'seated' && E.result.winner === K1, 'a 2-1 vote: the first court wins', E.phase);
ok(seats.some((s) => s.zone === 'whiterun' && s.rank === 'jarl' && s.pid === chars.get(J1).pid) && seats.some((s) => s.rank === 'steward' && s.pid === chars.get(S1).pid), 'its Jarl and Steward are seated', seats);
ok(!seats.some((s) => s.rank === 'commander'), 'the Lord Commander who joined a faction mid-vote is not seated');
ok(E.result.empty.includes('Lord Commander'), 'the seat is left empty for the new Jarl to appoint', E.result.empty);
ok(unseats.some((u) => u.zone === 'whiterun' && u.pid === 999), 'whoever held the Jarl seat before is unseated');
ok(courtSyncs.some((c) => c.zone === 'whiterun' && c.actor === H1 && c.titles[0] === 'Housecarl' && c.seated), 'the Housecarl takes the household rank Housecarl');
vv = M.votingView(V1, WR);
ok(vv.result && vv.result.winner && vv.result.winner.jarl === nm(J1) && vv.result.counts.some((c) => c.votes === 2) && vv.result.counts.some((c) => c.votes === 1), 'after the vote the result shows the winner and each court\'s count', vv.result);
// After the election a seat of the elected court goes only to a citizen (coordinator's decision, 14 Oct)
const seatNo = globalThis.__dboCitizenSeatCheck('whiterun', 'commander', '', GUILDIE, 'Gunnar');
ok(/no citizen of Whiterun/.test(seatNo), 'the empty Lord Commander seat is refused to a non-citizen', seatNo);
ok(globalThis.__dboCitizenSeatCheck('whiterun', 'commander', '', V1, 'V1') === '', 'a citizen may be appointed to it');
ok(/no citizen/.test(globalThis.__dboCitizenSeatCheck('whiterun', '', 'Housecarl', GUILDIE, 'Gunnar')), 'the Housecarl household rank too');
ok(globalThis.__dboCitizenSeatCheck('whiterun', 'guard', '', GUILDIE, 'Gunnar') === '', 'other offices are not seats of the ballot');
ok(globalThis.__dboCitizenSeatCheck('riften', 'commander', '', GUILDIE, 'Gunnar') === '', 'a hold that has not elected asks nothing');
ok(globalThis.__dboCitizenSeatCheck('whiterun', 'jarl', '', GUILDIE, 'Gunnar') !== '', 'nor the Jarl seat');
guilds.delete(C1);

// ---- Riften: no complete court, reopening, cancel below 15 --------------------------------------------------------------
const RF = ZONES[2];
const rif = [];
for (let i = 0; i < 16; i++) { const id = add(0x300 + i, 300 + i, `Riftling ${i}`); online.push(id); rif.push(id); M.join(id, 'riften'); }
timer();
E = M.data().elections.riften;
ok(E && E.phase === 'registration', 'Riften reaches 15 (16 here, one will renounce): registration opens');
M.register(rif[0], 'riften', [nm(rif[1]), nm(rif[2]), nm(rif[3])]);
now += 24 * HOUR; timer();
E = M.data().elections.riften;
ok(E.phase === 'registration' && E.reopened === 1 && E.phaseEndsAt === now + 24 * HOUR, 'no court complete (nobody accepted): registration reopens for 24 hours', E);
// a member loses eligibility in registration: the candidate replaces them
M.answerInvite(rif[1], 'riften', E.courts[0].id, true); M.answerInvite(rif[2], 'riften', E.courts[0].id, true); M.answerInvite(rif[3], 'riften', E.courts[0].id, true);
M.renounce(rif[3], 'riften');
vv = M.votingView(rif[0], RF);
ok(!vv.courts[0].complete && /citizen/.test(vv.courts[0].members.find((m) => m.seat === 'housecarl').why), 'a Housecarl who renounced shows the court incomplete, with why', vv.courts[0]);
r = M.replace(rif[0], 'riften', 'housecarl', nm(rif[4]));
ok(!r.error, 'the candidate replaces the Housecarl', r);
M.answerInvite(rif[4], 'riften', E.courts[0].id, true);
ok(M.votingView(rif[0], RF).courts[0].complete, 'the court is complete again');
// a second court whose member lost eligibility and was not replaced is dropped at the close
M.register(rif[5], 'riften', [nm(rif[6]), nm(rif[7]), nm(rif[8])]);
const k2 = M.data().elections.riften.courts[1].id;
for (const a of [rif[6], rif[7], rif[8]]) M.answerInvite(a, 'riften', k2, true);
guilds.set(rif[8], [{ id: 'thieves-guild', title: 'Footpad', role: 'member', kind: 'guild', zone: '' }]);
now += 24 * HOUR; timer();
E = M.data().elections.riften;
ok(E.phase === 'voting' && E.ballot.length === 1 && E.courts.length === 1, 'the court whose Housecarl joined a faction is dropped at the close; one court goes to the vote', E.ballot);
// one court, no vote: registration again
now += 24 * HOUR; timer();
E = M.data().elections.riften;
ok(E.phase === 'registration' && E.courts.length === 0, 'the one court got no vote: registration starts again', E.phase);
// one court, one vote: it takes office
M.register(rif[0], 'riften', [nm(rif[1]), nm(rif[2]), nm(rif[4])]);
const k3 = M.data().elections.riften.courts[0].id;
for (const a of [rif[1], rif[2], rif[4]]) M.answerInvite(a, 'riften', k3, true);
now += 24 * HOUR; timer();
M.vote(rif[9], 'riften', k3);
now += 24 * HOUR; timer();
E = M.data().elections.riften;
ok(E.phase === 'seated' && E.result.winner === k3, 'a single court with one vote takes office', E.phase);

// ---- the Jarl candidate loses eligibility: struck off, votes void; and cancel below 15 ----------------------------------
const FK = { id: 'falkreath', name: 'Falkreath', treasury: 'f', officials: ['jarl', 'steward', 'commander'] };
ZONES.push(FK);
delete globalThis.__dboCitizen; M = load();
const fk = [];
for (let i = 0; i < 15; i++) { const id = add(0x400 + i, 400 + i, `Falk ${i}`); online.push(id); fk.push(id); M.join(id, 'falkreath'); }
timer();
M.register(fk[0], 'falkreath', [nm(fk[1]), nm(fk[2]), nm(fk[3])]);
M.register(fk[4], 'falkreath', [nm(fk[5]), nm(fk[6]), nm(fk[7])]);
E = M.data().elections.falkreath;
for (const [c, ms] of [[E.courts[0].id, [1, 2, 3]], [E.courts[1].id, [5, 6, 7]]]) for (const i of ms) M.answerInvite(fk[i], 'falkreath', c, true);
now += 24 * HOUR; timer();
const [F1, F2] = M.data().elections.falkreath.ballot;
M.vote(fk[8], 'falkreath', F1); M.vote(fk[9], 'falkreath', F1); M.vote(fk[10], 'falkreath', F2);
guilds.set(fk[0], [{ id: 'dark-brotherhood', title: 'Murderer', role: 'member', kind: 'guild', zone: '' }]);
now += 24 * HOUR; timer();
E = M.data().elections.falkreath;
ok(E.phase === 'seated' && E.result.winner === F2 && E.courts.find((c) => c.id === F1).struck, 'the leading Jarl candidate joined a faction: struck off, votes void, the other court wins', [E.phase, E.result]);
// cancel below 15
const MO = { id: 'morthal', name: 'Hjaalmarch', officials: ['jarl', 'steward', 'commander'] };
ZONES.push(MO); delete globalThis.__dboCitizen; M = load();
const mo = [];
for (let i = 0; i < 15; i++) { const id = add(0x500 + i, 500 + i, `Morthan ${i}`); online.push(id); mo.push(id); M.join(id, 'morthal'); }
timer();
ok(M.data().elections.morthal.phase === 'registration', 'Hjaalmarch reaches 15');
M.renounce(mo[0], 'morthal'); M.renounce(mo[1], 'morthal');
now += 24 * HOUR; timer();
ok(!M.data().elections.morthal, 'no court and only 13 citizens at the close: the election is cancelled', M.data().elections.morthal);
now += 8 * DAY; M.join(mo[0], 'morthal'); M.join(mo[1], 'morthal'); timer();
ok(M.data().elections.morthal && M.data().elections.morthal.phase === 'registration', 'back at 15 it starts again');

// ---- staff overrides --------------------------------------------------------------------------------------------------
ok(M.staffAct(GM, 'morthal', 'cancel').error, 'a plain GM cannot cancel an election');
ok(!M.staffAct(STAFF, 'morthal', 'cancel').error && M.data().elections.morthal.phase === 'held', 'a Lead GM holds it');
timer();
ok(M.data().elections.morthal.phase === 'held', 'a held election does not restart by itself');
ok(!M.staffAct(STAFF, 'morthal', 'restart').error && M.data().elections.morthal.phase === 'registration', 'and restarts it on demand');
ok(M.staffAct(STAFF, 'bruma', 'restart').error, 'Bruma has no election to restart');

// ---- the notice board panel -------------------------------------------------------------------------------------------
ui.citizenOpen(ANNA, ['citizenship']);
ok(/notice board/.test(last(ANNA)), 'away from a board the panel does not open');
nearBoard.set(ANNA, 'bruma');
ui.citizenOpen(ANNA, ['voting']);
let w = lastWidget(ANNA);
ok(w && w.type === 'citizenBoard' && w.id === 84 && w.tab === 'voting' && w.voting.electing === false && w.citizenship.citizen, 'at a Bruma board it opens on Voting (Bruma: no election) and knows Anna is a citizen', w && w.tab);
ui.citizenAct(ANNA, ['wrong', 'renounce', 'bruma']);
ok(M.citizenOf(ANNA, 'bruma'), 'a stale nonce does nothing');
ui.citizenAct(ANNA, [w.nonce, 'tab', 'citizenship']);
w = lastWidget(ANNA);
ok(w.tab === 'citizenship', 'switching tab redraws');
nearBoard.set(STEWARD, 'bruma'); M.setPolicy(COUNT, 'bruma', 'manual');
const asker = add(0x600, 600, 'Asker'); online.push(asker); nearBoard.set(asker, 'bruma');
ui.citizenOpen(asker, ['citizenship']); w = lastWidget(asker);
ok(w.citizenship.can === 'manual' && w.citizenship.policy === 'manual', 'the asker sees a manual policy');
ui.citizenAct(asker, [w.nonce, 'join']);
w = lastWidget(asker);
ok(w.citizenship.requested && /asked/.test(w.result), 'asking from the panel', w.result);
ui.citizenOpen(STEWARD, ['citizenship']); w = lastWidget(STEWARD);
ok(w.citizenship.manage && w.citizenship.manage.requests.length === 1, "the Steward's panel lists the request", w.citizenship.manage);
ui.citizenAct(STEWARD, [w.nonce, 'grant', w.citizenship.manage.requests[0].actor]);
ok(M.citizenOf(asker, 'bruma') && /now a citizen/.test(lastWidget(STEWARD).result), 'and grants it there');
nearBoard.delete(STEWARD);
w = lastWidget(STEWARD);
ui.citizenAct(STEWARD, [w.nonce, 'policy', 'free']);
ok(closed.some(([a, id]) => a === STEWARD && id === 84) && M.data().policies.bruma.policy === 'manual', 'walking away from the board closes it and does nothing');
const nb = M.boardPayload(ANNA, 'gol-kharzum', 'n', 'citizenship');
ok(nb.grants === false && /no citizenship/.test(nb.why), 'a stronghold board says it grants none');

// ---- staff revoke ------------------------------------------------------------------------------------------------------
ok(M.revoke(COUNT, 'bruma', BJORN).error, 'a ruler cannot revoke a citizenship');
ok(!M.revoke(STAFF, 'bruma', BJORN).error && !M.citizenOf(BJORN, 'bruma'), 'a Lead GM can');

// ---- Lord Commander (coordinator's decision, 14 Oct): the commander office reads Lord Commander to players ---------------------
const ZJ = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'zones.json'), 'utf8'));
ok(ZJ.rankTitles.commander === 'Lord Commander', 'zones.json titles the commander office Lord Commander', ZJ.rankTitles.commander);
ok(M.votingView(V1, WR).seats.find((s) => s.id === 'commander').label === 'Lord Commander', 'and the ballot names it the same');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
