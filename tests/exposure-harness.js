// Exposure (server\exposure.js, bundle 1023): a werewolf or Vampire Lord seen changing by 3+ players is known in the hold for
// 7 days, with a bounty through outlaws.js (500 city / 200 wilds, doubled when they hurt someone in that shape), guards set
// on them while it stands, officials and hunter orders told, the Court tab view, an exposed ruler's court powers gone there,
// the Companions' Circle spared in Whiterun Hold, and cleared by a cure, a GM or time. Run from server/:
//   node tests/exposure-harness.js
'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-exposure-'));
process.chdir(dir);
let fails = 0; const ok = (l, c, g) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${l}${!c && g !== undefined ? `: got ${JSON.stringify(g)}` : ''}`); if (!c) fails++; };

// Characters: [profile id, name]
const STEW = 0x2d, WOLF = 0x20, JARL = 0x21, W1 = 0x22, W2 = 0x23, W3 = 0x24, GM = 0x25, PGUARD = 0x26, VIGIL = 0x27, HAND = 0x28, DAWN = 0x29, HARB = 0x2a, VAMP = 0x2b, LEAD = 0x2c, NPC = 0x30;
const chars = { [WOLF]: [10, 'Ulf'], [JARL]: [11, 'Frigga'], [W1]: [12, 'Ann'], [W2]: [13, 'Bo'], [W3]: [14, 'Cy'], [GM]: [15, 'Gemma'], [PGUARD]: [16, 'Gard'],
  [VIGIL]: [17, 'Vera'], [HAND]: [18, 'Hilde'], [DAWN]: [19, 'Dane'], [HARB]: [20, 'Kodlak'], [VAMP]: [21, 'Serana'], [LEAD]: [2, 'Nate'], [STEW]: [22, 'Stewart'] };
// Every player-facing notice must name nobody (Nate, 23 Oct), but for the court-powers rule (checked apart below)
const NAMES = /Ulf|Frigga|Kodlak|Serana/;
const props = new Map(); const sys = []; const said = []; const audits = []; const cmds = {};
const mp = {
  get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v), makeProperty: () => {},
  lookupEspmRecordById: (id) => ({ 0x500: { record: { type: 'NPC_', fields: [{ type: 'RNAM', data: new Uint8Array([0x01, 0x05, 0, 0]) }] }, toGlobalRecordId: (x) => x },
    0x501: { record: { type: 'RACE', editorId: 'NordRace' } } })[id] || null,
};
const ZONES = { bruma: { id: 'bruma', name: 'Bruma', officials: ['count', 'steward', 'guard'] }, whiterun: { id: 'whiterun', name: 'Whiterun', officials: ['jarl', 'steward'] } };
let online = Object.keys(chars).map(Number);
let territory = { id: 'bruma', name: 'Bruma', zone: 'bruma', kind: 'capital', marker: { world: 'w', pos: [0, 0, 0] } };
const guilds = { [VIGIL]: [{ id: 'vigil-of-stendarr', title: 'Vigilant', role: 'member' }], [HAND]: [{ id: 'silver-hand', title: 'Member', role: 'member' }],
  [DAWN]: [{ id: 'dawnguard', title: 'Member', role: 'member' }], [HARB]: [{ id: 'companions', title: 'Harbinger', role: 'leader' }],
  [PGUARD]: [{ id: 'county-bruma', title: 'Guard', role: 'member' }] };
let staff = new Set([GM]);
globalThis.__dboGuildsOf = (a) => guilds[a] || [];
globalThis.__dboGuildInfo = (fid) => ({ 'vigil-of-stendarr': { name: 'the Vigil of Stendarr' }, 'silver-hand': { name: 'the Silver Hand' }, dawnguard: { name: 'the Dawnguard' } })[fid] || null;
globalThis.__dboHoldFactionOf = (z) => (z === 'bruma' ? 'county-bruma' : 'hold-' + z);
globalThis.__dboIsStaff = (a) => staff.has(a >>> 0);
globalThis.__dboNameFor = (viewer, a) => (viewer === JARL || viewer === STEW ? chars[a][1] : 'Stranger');
globalThis.__dboRealmTerritoryAt = () => territory;
globalThis.__dboSeatHolder = () => 0;
for (const a of Object.keys(chars).map(Number)) { props.set(`${a}|worldOrCellDesc`, 'w'); props.set(`${a}|pos`, [0, 0, 0]); }
props.set(`${WOLF}|private.supernatural`, { kind: 'werewolf' });
props.set(`${JARL}|private.supernatural`, { kind: 'werewolf' });
props.set(`${HARB}|private.supernatural`, { kind: 'werewolf' });
props.set(`${VAMP}|private.supernatural`, { kind: 'vampire' });

let OFF = { bruma: { count: [11], steward: [22], guard: [] }, whiterun: { jarl: [] } };
const unseats = [];
const api = (cfg, extra) => Object.assign({
  mp, log: () => {}, personal: (a, t) => said.push([a, t]), system: (a, t) => sys.push([a, t]), audit: (t) => audits.push(t),
  who: (a) => (chars[a] ? `${chars[a][1]} #${a.toString(16)}` : String(a)), display: (a) => (chars[a] ? chars[a][1] : String(a)), cfg,
  registerChatCommand: (n, f) => { cmds[n] = f; }, zoneOfActor: () => territory.zone, zoneById: (id) => ZONES[String(id).toLowerCase()] || null,
  readOfficials: () => OFF, profileOf: (a) => (chars[a] ? chars[a][0] : -1),
  officialTarget: (q) => { const e = Object.entries(chars).find(([, c]) => c[1].toLowerCase() === String(q).toLowerCase()); return e ? { pid: e[1][0], actor: Number(e[0]), online: Number(e[0]), label: e[1][1], who: e[1][1] } : { error: `No character called ${q}.` }; },
  onlineActors: () => online.slice(), isAdmin: (a) => a === GM || a === LEAD, isLeadStaff: (a) => a === LEAD, every: () => {}, giveItem: () => {}, onUi: () => {},
}, extra || {});
const load = (file, cfg, extra) => { const p = path.join(ROOT, file); delete require.cache[p]; return require(p)(api(cfg || {}, extra)); };
load('outlaws.js');
let X = load('exposure.js');
const bounty = (zid, a) => { const l = ((globalThis.__dboOutlaws.data || {}).zones || {})[zid] || {}; const b = l[String(chars[a][0])]; return b ? b.amount : 0; };
const clearBounties = () => { globalThis.__dboOutlaws.data.zones = {}; };
const reset = () => { try { fs.unlinkSync('exposure.json'); } catch (e) { /* none */ } globalThis.__dboExposure = null; X = load('exposure.js'); clearBounties(); sys.length = 0; audits.length = 0; };
const beast = (a, form) => props.set(`${a}|private.beast`, form ? { form, at: 1000 + a } : null);
const see = (a, form, seers, phase) => { if (phase === 'in') beast(a, form); const r = globalThis.__dboBeastWitnessed(a, form, seers, phase); if (phase === 'out') beast(a, null); return r; };

// ---- threshold ------------------------------------------------------------------------------------------------------------
ok('two witnesses are not enough', see(WOLF, 'werewolf', [W1, W2], 'in') === false && bounty('bruma', WOLF) === 0 && !globalThis.__dboExposedIn(WOLF, 'bruma'));
ok('staff in an admin mode do not count', (props.set(`${GM}|ff_adminModes`, { god: true }), see(WOLF, 'werewolf', [W1, W2, GM], 'in')) === false);
ok('the invisible do not count', (props.set(`${W3}|ff_adminModes`, { invis: true }), see(WOLF, 'werewolf', [W1, W2, W3], 'in')) === false);
props.set(`${W3}|ff_adminModes`, {});
ok('staff out of any mode count as anyone', (props.set(`${GM}|ff_adminModes`, {}), see(WOLF, 'werewolf', [W1, W2, GM], 'in')) === true);
reset();
ok('three player witnesses expose them in the hold', see(WOLF, 'werewolf', [W1, W2, W3], 'in') === true && globalThis.__dboExposedIn(WOLF, 'bruma'));
ok('...in a city: 500 gold bounty in Bruma', bounty('bruma', WOLF) === 500, bounty('bruma', WOLF));
ok('...the werewolf is told', sys.some(([a, t]) => a === WOLF && /bounty of 500 gold/.test(t)));
{ const b = (((globalThis.__dboOutlaws.data || {}).zones || {}).bruma || {})[String(chars[WOLF][0])] || {};
  ok("the public bounty never names the beast (Nate, 23 Oct)", !/wolf|beast|vampire|lord|seen as/i.test(`${b.reason} ${b.by}`) && /hold/.test(String(b.reason)), b); }
ok('...and it is audited', audits.some((t) => /EXPOSURE Ulf .* seen changing into a werewolf by 3/.test(t)));
ok('...known for 7 days', (() => { const h = JSON.parse(fs.readFileSync('exposure.json', 'utf8')).cases[String(WOLF)].holds.bruma; return Math.round((h.until - h.at) / 86400000) === 7; })());

// ---- notices, waiting for the mortal shape -------------------------------------------------------------------------------
X.tick();
ok('the Count (an official) is told what and where, at once', sys.some(([a, t]) => a === JARL && /court of Bruma: a werewolf was seen near Bruma, in Bruma, in the \w+/.test(t)));
ok('a player guard of the hold is told too', sys.some(([a, t]) => a === PGUARD && /court of Bruma: a werewolf was seen/.test(t)));
ok('the Vigil and the Silver Hand hear of a werewolf', sys.some(([a, t]) => a === VIGIL && /^Word reaches the Vigil of Stendarr: a werewolf was seen near Bruma, in Bruma/.test(t)) && sys.some(([a, t]) => a === HAND && /the Silver Hand/.test(t)));
ok('no notice to anyone but the werewolf names the werewolf', !sys.some(([a, t]) => a !== WOLF && NAMES.test(t)), sys.filter(([a, t]) => a !== WOLF && NAMES.test(t)));
ok('the Dawnguard does not (a werewolf is not theirs)', !sys.some(([a]) => a === DAWN));
ok('a plain townsperson is not told', !sys.some(([a]) => a === W1));
const n = sys.length; X.tick();
ok('each is told once', sys.length === n);
online = online.filter((a) => a !== DAWN && a !== VIGIL);

// ---- guards ---------------------------------------------------------------------------------------------------------------
ok('guards hunt them in the hold while the bounty stands (ff_huntedIn)', props.get(`${WOLF}|ff_huntedIn`) === 'bruma');
territory = { id: 'whiterun', name: 'Whiterun', zone: 'whiterun', kind: 'capital', marker: { world: 'w', pos: [0, 0, 0] } }; X.tick();
ok('...but not in another hold', props.get(`${WOLF}|ff_huntedIn`) === null);
territory = { id: 'bruma', name: 'Bruma', zone: 'bruma', kind: 'capital', marker: { world: 'w', pos: [0, 0, 0] } };

// ---- court view -----------------------------------------------------------------------------------------------------------
const cv = globalThis.__dboExposureCourtView(JARL, 'bruma');
ok('Court tab: the Count sees the case, unnamed', Array.isArray(cv) && cv.length === 1 && cv[0].name === '' && cv[0].bounty === 500 && cv[0].wanted === true && !cv[0].hunters, cv);
ok('Court tab: staff see who', globalThis.__dboExposureCourtView(GM, 'bruma')[0].name === 'Ulf');
ok('Court tab: a townsperson gets nothing', globalThis.__dboExposureCourtView(W1, 'bruma') === null);

// ---- hurt doubles ---------------------------------------------------------------------------------------------------------
see(WOLF, 'werewolf', [], 'in');
globalThis.__dboExposureHit(WOLF, NPC);
ok('a blow on a creature does not double it', bounty('bruma', WOLF) === 500);
props.set(`${NPC}|baseId`, 0x500);
globalThis.__dboExposureHit(WOLF, NPC);
ok('a blow on a person in beast form doubles it to 1000', bounty('bruma', WOLF) === 1000, bounty('bruma', WOLF));
reset();
see(WOLF, 'werewolf', [W1], 'in'); globalThis.__dboExposureHit(WOLF, W1);
territory = { id: 'aleswell', name: 'Aleswell', zone: 'bruma', kind: 'town', marker: { world: 'w', pos: [0, 0, 0] } };
ok('seen changing back after hurting someone, in the wilds: 200 x 2 = 400', see(WOLF, 'werewolf', [W1, W2, W3], 'out') === true && bounty('bruma', WOLF) === 400, bounty('bruma', WOLF));
reset();
see(WOLF, 'werewolf', [W1, W2, W3], 'in');
ok('in the wilds unhurt: 200', bounty('bruma', WOLF) === 200, bounty('bruma', WOLF));
ok('frenzy hook (__dboExposureBounty) raises it and says so', globalThis.__dboExposureBounty(WOLF, W1) === true && bounty('bruma', WOLF) === 400);
beast(WOLF, null);
ok('...but not out of beast form', globalThis.__dboExposureBounty(WOLF, W1) === false);
territory = { id: 'bruma', name: 'Bruma', zone: 'bruma', kind: 'capital', marker: { world: 'w', pos: [0, 0, 0] } };

// ---- an exposed Jarl loses court powers ------------------------------------------------------------------------------------
reset();
let barred = globalThis.__dboExposureBarred(JARL, 'bruma');
ok('before: the Count is not barred', barred === '');
see(JARL, 'werewolf', [W1, W2, W3], 'in'); X.tick();
ok('the court waits for the Count\'s mortal shape to name him', !sys.some(([a]) => a === STEW));
beast(JARL, null); X.tick();
ok('court-powers rule: the Steward (same court) is told it was the Count', sys.some(([a, t]) => a === STEW && /It was Frigga, of this court, and they hold no court powers in Bruma/.test(t)), sys.filter(([a]) => a === STEW));
ok('...the player guard (no seat) is not told who', sys.some(([a]) => a === PGUARD) && !sys.some(([a, t]) => a === PGUARD && NAMES.test(t)));
ok('...nor the hunter orders', !sys.some(([a, t]) => (a === VIGIL || a === HAND) && NAMES.test(t)));
barred = globalThis.__dboExposureBarred(JARL, 'bruma');
ok('an exposed Count is barred from court powers in Bruma', /will not take your word/.test(barred), barred);
ok('...but not in another hold', globalThis.__dboExposureBarred(JARL, 'whiterun') === '');
said.length = 0; cmds.bounty(JARL, 'set Ann 100 theft');
ok('...and cannot set a bounty (outlaws.js)', /will not take your word/.test((said.at(-1) || [])[1]) && bounty('bruma', W1) === 0, said.at(-1));
said.length = 0; cmds.bounty(JARL, 'clear Frigga');
ok('...nor lift his own', /will not take your word/.test((said.at(-1) || [])[1]) && bounty('bruma', JARL) === 500);
ok('staff are never barred', globalThis.__dboExposureBarred(GM, 'bruma') === '');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
ok('appointments, tax, books and property sales ask the same hook', /__dboExposureBarred\(a, z\.id\)/.test(src('gamemode.js')) && /exposedHere\(a, zone\)/.test(src('business.js'))
  && /__dboExposureBarred'\)\(a, z\)/.test(src('economy.js')) && /__dboExposureBarred\(x\)/.test(src('tenancy.js')));
ok('beastform.js reports its witnesses through the one hook', /__dboBeastWitnessed\(a, form, seers, phase\)/.test(src('beastform.js')));

// ---- clearing -------------------------------------------------------------------------------------------------------------
props.set(`${WOLF}|private.inventory`, null);
globalThis.__dboOutlawJailed(PGUARD, JARL);
ok('serving the jail clears the bounty', bounty('bruma', JARL) === 0);
X.tick();
ok('...the guards stop hunting once it is gone', props.get(`${JARL}|ff_huntedIn`) === null);
ok('...but he is still known (exposure stands until cured)', globalThis.__dboExposedIn(JARL, 'bruma'));
props.set(`${JARL}|private.supernatural`, { kind: null }); X.tick();
ok('a cure clears the exposure', !globalThis.__dboExposedIn(JARL, 'bruma') && globalThis.__dboExposureBarred(JARL, 'bruma') === '' && audits.some((t) => /no longer a werewolf \(cured\)/.test(t)));
see(WOLF, 'werewolf', [W1, W2, W3], 'in'); beast(WOLF, null);
said.length = 0; cmds.exposure(GM, 'clear Ulf mistaken');
ok('a GM below Lead may not clear', /Lead GM/.test(said.at(-1)[1]));
said.length = 0; cmds.exposure(LEAD, 'clear Ulf');
ok('a clear needs a reason', /Usage/.test(said.at(-1)[1]));
said.length = 0; cmds.exposure(LEAD, 'clear Ulf the witnesses lied');
ok('a Lead GM clears it with a reason, audited', /no longer known/.test(said.at(-1)[1]) && !globalThis.__dboExposedIn(WOLF, 'bruma') && audits.some((t) => /EXPOSURE GM Nate .* cleared Ulf .*: the witnesses lied/.test(t)));
see(WOLF, 'werewolf', [W1, W2, W3], 'in');
const until = JSON.parse(fs.readFileSync('exposure.json', 'utf8')).cases[String(WOLF)].holds.bruma;
until.until = Date.now() - 1; globalThis.__dboExposure.data.cases[String(WOLF)].holds.bruma.until = Date.now() - 1; X.tick();
ok('it ends after its days', !globalThis.__dboExposedIn(WOLF, 'bruma'));

// ---- the Companions' Circle in Whiterun ---------------------------------------------------------------------------------
reset();
territory = { id: 'whiterun', name: 'Whiterun', zone: 'whiterun', kind: 'capital', marker: { world: 'w', pos: [0, 0, 0] } };
ok('the Harbinger is spared in Whiterun Hold', see(HARB, 'werewolf', [W1, W2, W3], 'in') === false && bounty('whiterun', HARB) === 0 && audits.some((t) => /exempt/.test(t)));
beast(HARB, null);
territory = { id: 'bruma', name: 'Bruma', zone: 'bruma', kind: 'capital', marker: { world: 'w', pos: [0, 0, 0] } };
ok('...but not in Bruma', see(HARB, 'werewolf', [W1, W2, W3], 'in') === true && bounty('bruma', HARB) === 500);
beast(HARB, null);

// ---- a Vampire Lord: the same rules, the Dawnguard and the Vigil told, hunters among witnesses recorded ------------------
reset(); online = Object.keys(chars).map(Number);
ok('a Vampire Lord seen rising by three (a Dawnguard among them) is exposed', see(VAMP, 'vampirelord', [W1, W2, DAWN], 'in') === true && bounty('bruma', VAMP) === 500);
beast(VAMP, null); X.tick();
ok('...no notice names her', !sys.some(([a, t]) => a !== VAMP && NAMES.test(t)));
ok('...the Dawnguard and the Vigil are told, the Silver Hand is not', sys.some(([a, t]) => a === DAWN && /the Dawnguard: a Vampire Lord was seen near Bruma/.test(t)) && sys.some(([a]) => a === VIGIL) && !sys.some(([a]) => a === HAND));
ok('...the hunter witness is recorded for staff', (() => { const v = globalThis.__dboExposureCourtView(GM, 'bruma'); return v && v[0].hunters && v[0].hunters.some((h) => /Dane .*the Dawnguard/.test(h)); })());
said.length = 0; cmds.exposure(LEAD, 'list');
ok('.../exposure list shows it', /Serana .*a Vampire Lord.*hunters: Dane .* of the Dawnguard/.test(said.at(-1)[1]), said.at(-1));
props.set(`${VAMP}|private.supernatural`, { kind: null }); X.tick();
ok('...and a cure of vampirism clears it', !globalThis.__dboExposedIn(VAMP, 'bruma'));

// ---- 2 (23 Oct): an exposed ruler is deposed through gamemode's unseat; a lesser official stays seated, suspended ----------
const unseat = (z, tg, byWho) => { unseats.push({ z: z.id, tg, byWho }); let had = null; for (const k of Object.keys(OFF[z.id] || {})) { if (OFF[z.id][k].includes(tg.pid)) had = k; OFF[z.id][k] = OFF[z.id][k].filter((x) => x !== tg.pid); } return had ? { had, text: '' } : { error: 'no rank' }; };
const reload2 = (cfg) => { try { fs.unlinkSync('exposure.json'); } catch (e) { /* none */ } globalThis.__dboExposure = null; X = load('exposure.js', cfg, { unseatOfficialBy: unseat }); clearBounties(); sys.length = 0; audits.length = 0; };
reload2();
online = Object.keys(chars).map(Number);
territory = { id: 'bruma', name: 'Bruma', zone: 'bruma', kind: 'capital', marker: { world: 'w', pos: [0, 0, 0] } };
props.set(`${JARL}|private.supernatural`, { kind: 'werewolf' });
see(JARL, 'werewolf', [W1, W2, W3], 'in'); beast(JARL, null); X.tick();
ok('an exposed Count is deposed through unseatOfficialBy', unseats.length === 1 && unseats[0].z === 'bruma' && unseats[0].tg.pid === 11 && /exposure/.test(unseats[0].byWho) && !OFF.bruma.count.includes(11), unseats);
ok('...audited', audits.some((t) => /EXPOSURE Frigga .* deposed as count of Bruma/.test(t)));
ok('...the court (Steward) is told who, and that he is deposed', sys.some(([a, t]) => a === STEW && /It was Frigga, the Count of Bruma, who is deposed/.test(t)), sys.filter(([a]) => a === STEW));
ok('...nobody outside the court is told who', !sys.some(([a, t]) => a !== JARL && a !== STEW && NAMES.test(t)));
props.set(`${STEW}|private.supernatural`, { kind: 'werewolf' });
see(STEW, 'werewolf', [W1, W2, W3], 'in'); beast(STEW, null);
ok('an exposed Steward keeps the seat (no second unseat) but is suspended', unseats.length === 1 && OFF.bruma.steward.includes(22) && /will not take your word/.test(globalThis.__dboExposureBarred(STEW, 'bruma')));
reload2({ exposure: { deposeRulers: false } });
OFF = { bruma: { count: [11], steward: [22], guard: [] }, whiterun: { jarl: [] } };
see(JARL, 'werewolf', [W1, W2, W3], 'in'); beast(JARL, null);
ok('deposeRulers false: the Count keeps the seat, suspended', unseats.length === 1 && OFF.bruma.count.includes(11) && globalThis.__dboExposureBarred(JARL, 'bruma') !== '');

// ---- 1 (23 Oct): confession, the character's own (/confess, confirmed) or marked by staff (/exposure confess) ----------
reload2(); OFF = { bruma: { count: [11], steward: [22], guard: [] }, whiterun: { jarl: [] } }; unseats.length = 0;
const run = (cmd, a, args) => { said.length = 0; cmds[cmd](a, args); return (said.at(-1) || [])[1] || ''; };
ok('a mortal has nothing to confess', /nothing of that kind/.test(run('confess', W1, '')));
ok('/confess asks first, naming what it costs', /cannot be taken back.*\/confess yes/.test(run('confess', WOLF, '')) && !globalThis.__dboExposedIn(WOLF, 'bruma'));
ok('/confess yes without asking first only asks', (globalThis.__dboExposure.confessAsks.clear(), /cannot be taken back/.test(run('confess', WOLF, 'yes'))) && !globalThis.__dboExposedIn(WOLF, 'bruma'));
run('confess', WOLF, 'yes');
ok('/confess yes after the ask: known in the hold, 500 bounty', globalThis.__dboExposedIn(WOLF, 'bruma') && bounty('bruma', WOLF) === 500 && sys.some(([a, t]) => a === WOLF && /You have confessed before Bruma/.test(t)));
X.tick();
ok('...the court hears of a confession, nameless', sys.some(([a, t]) => a === PGUARD && /a werewolf openly confessed what they are, in Bruma/.test(t)) && !sys.some(([a, t]) => a !== WOLF && NAMES.test(t)));
ok('...audited as a confession', audits.some((t) => /EXPOSURE Ulf .* confessed to being a werewolf openly/.test(t)));
ok('a second confession: already known', /already knows/.test(run('confess', WOLF, '')));
ok('staff confess: a GM below Lead may not', /Lead GM/.test(run('exposure', GM, 'confess Serana bruma she told the Jarls')));
ok('staff confess needs a hold and a reason', /Usage/.test(run('exposure', LEAD, 'confess Serana bruma')));
ok('staff confess of a mortal is refused', /neither a werewolf nor a vampire/.test(run('exposure', LEAD, 'confess Ann bruma no')));
props.set(`${VAMP}|private.supernatural`, { kind: 'vampire' });
ok('a Lead GM marks a confessed vampire in a hold', /Serana is known as a vampire in Bruma/.test(run('exposure', LEAD, 'confess Serana bruma she told all the Jarls')) && globalThis.__dboExposedIn(VAMP, 'bruma') && bounty('bruma', VAMP) === 500);
ok('...audited with the staff member and the reason', audits.some((t) => /EXPOSURE Serana .* confessed to being a vampire \(marked by staff: Nate #2c: she told all the Jarls\)/.test(t)), audits.filter((t) => /Serana/.test(t)));
props.set(`${JARL}|private.supernatural`, { kind: 'werewolf' });
run('exposure', LEAD, 'confess Frigga bruma confessed at court');
ok('a confessing ruler is deposed too', unseats.some((u) => u.tg.pid === 11));

// ---- enabled false --------------------------------------------------------------------------------------------------------
reset();
X = load('exposure.js', { exposure: { enabled: false } });
ok('off: three witnesses do nothing', see(WOLF, 'werewolf', [W1, W2, W3], 'in') === false && bounty('bruma', WOLF) === 0);
ok('off: nobody is barred', globalThis.__dboExposureBarred(JARL, 'bruma') === '' && globalThis.__dboExposureCourtView(JARL, 'bruma') === null);
ok('off: no frenzy bounty', globalThis.__dboExposureBounty(WOLF, W1) === false);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* scratch */ }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
