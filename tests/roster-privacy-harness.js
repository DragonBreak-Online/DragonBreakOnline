// Rosters name people by their own name, never a beast's (tracker 1559074270959640676, 12 Oct: the F3 Court tab listed a
// Jarl in werewolf form as "Werewolf", so anyone reading it learnt who the beast was), and no lookup or answer takes a mask
// off or gives a beast away (the verify of 12 Oct). Runs the real gamemode.js pieces (the name helpers, findByName,
// findAnyByName, /players, the name watch and the officials functions), playermenu.js, guilds.js, court.js, nobility.js,
// ledger.js, dungeons.js (/party) and charters.js against stubs in a temp folder, with a Jarl in werewolf form, a Steward
// behind a mask, a Thane who put a mask on and then changed, a beast whose own name is lost, a second mask and a plain
// viewer. Covers: the own name behind a mask, a beast, both, and a lost name (never the beast's); the staff name kept as it
// was; Inspect on a beast (no race, sex or office); the Court tab's holders online and offline, the offers and their
// notices, the household roll written while transformed; the Nobility tab's ruler and roll; the ledger of contacts;
// /players, which names a beast by its own name and keeps the mask (the client draws the #TAG under a mask); a name lookup
// that finds no one behind a mask or a beast by any name (the own name, its start, "Werewolf", "Masked Person"), only by
// the #TAG or the profile id; the answers to a lookup by #TAG, which keep the mask (/appoint, a court offer, a title, the
// household's invitations); X > Invite to Party and /charter invite, which answer without the #TAG the client hides over a
// beast; the switch gamemode-config.json rosterPrivacy.masks (shipped false, and a missing key is false: rosters keep the
// mask, and a title's decree to the whole server names a mask granted a title as the mask; the checks marked "masks on"
// run with it set true); the meet tick, which never notes a meeting with someone in disguise, so a stranger who stood near
// a mask or a beast gains no ledger or pigeon contact (re-verify P6, P7); and every other roster and record that keeps a
// name.
//
//   node tests/roster-privacy-harness.js   (from server/)
//   ROSTER_ROOT=<another copy of server/> runs the same checks against that copy (origin/server and 9899e6e0a fail some)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.env.ROSTER_ROOT ? path.resolve(process.env.ROSTER_ROOT) : path.resolve(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const GM = src('gamemode.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-privacy-'));
for (const f of ['guild-defs.json', 'nobility-fiefs.json', 'name-filter.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
process.chdir(dir);
process.on('exit', () => { try { process.chdir(os.tmpdir()); fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS will */ } });

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const slice = (from, to) => { const i = GM.indexOf(from); const j = i < 0 ? -1 : GM.indexOf(to, i + from.length); return i < 0 || j < 0 ? '' : GM.slice(i, j); };

// ---- the world ---------------------------------------------------------------------------------------------------------
// RAVEN, Jarl of Whiterun, is in werewolf form (beastform.js: the appearance keeps the race, named after the form, and the
// look before the change is in private.beast.original). QUILL, Steward, wears a mask (playermenu.js: "Masked Person", the
// real name in maskName). THANE put a mask on and then changed (the look kept at the change is the mask's). LOST is a beast
// whose kept look has no name. MIRA wears a mask and holds nothing. VIEW and GUARD are plain.
const ADMIN = 0x10, RAVEN = 0x21, QUILL = 0x22, VIEW = 0x23, GUARD = 0x24, THANE = 0x25, LOST = 0x26, MIRA = 0x27;
const NORD = 0x13746, BRETON = 0x13741;
const chars = new Map([
  [ADMIN, { pid: 1, name: 'Admin', tag: 'ADMN', online: true, race: NORD }],
  [RAVEN, { pid: 21, name: 'Raven Stormbrow', tag: 'RVN1', online: true, race: NORD, female: true }],
  [QUILL, { pid: 22, name: 'Quill Varro', tag: 'QVR1', online: true, race: BRETON }],
  [VIEW, { pid: 23, name: 'Vilja Ashford', tag: 'VIEW', online: true, race: NORD }],
  [GUARD, { pid: 24, name: 'Gerd', tag: 'GRD1', online: true, race: NORD }],
  [THANE, { pid: 25, name: 'Tova Hale', tag: 'TOV1', online: true, race: NORD }],
  [LOST, { pid: 26, name: 'Lio', tag: 'LIO1', online: true, race: NORD }],
  [MIRA, { pid: 27, name: 'Mira Quell', tag: 'MQL1', online: true, race: BRETON, female: true }],
]);
const props = new Map();
const P = (id, k, v) => props.set(`${id}|${k}`, v);
for (const [id, c] of chars) {
  P(id, 'appearance', { name: c.name, raceId: c.race, isFemale: !!c.female });
  // gamemode.js indexName, at login (unmasked, never a beast): the own name and the tag
  P(id, 'private.indexed.nameKey', c.name.toLowerCase()); P(id, 'private.indexed.tagKey', c.tag.toLowerCase());
}
const beast = (id, form, keptName) => {
  const app = props.get(`${id}|appearance`);
  P(id, 'private.beast', { form, original: Object.assign({}, app, { name: keptName === undefined ? app.name : keptName }), at: 1, until: 0 });
  P(id, 'appearance', Object.assign({}, app, { name: form === 'werewolf' ? 'Werewolf' : 'Vampire Lord' }));
};
const mask = (id) => { const app = props.get(`${id}|appearance`); P(id, 'maskName', app.name); P(id, 'appearance', Object.assign({}, app, { name: 'Masked Person' })); };
const mp = {
  get: (id, k) => {
    const c = chars.get(id);
    if (k === 'profileId') return c ? c.pid : -1;
    if (k === 'type') { if (!c) throw new Error('no such form'); return 'Actor'; }
    if (k === 'locationalData') return { cellOrWorldDesc: 'w', pos: [0, 0, 0] };
    if (k === 'equipment') return { inv: { entries: [] } };
    return props.get(`${id}|${k}`);
  },
  set: (id, k, v) => P(id, k, v),
  getActorsByProfileId: (pid) => [...chars.entries()].filter(([, c]) => c.pid === pid).map(([id]) => id),
  findFormsByPropertyValue: (k, v) => [...chars.keys()].filter((id) => props.get(`${id}|${k}`) === v),
  lookupEspmRecordById: (id) => ({ record: { editorId: id === NORD ? 'NordRace' : id === BRETON ? 'BretonRace' : 'ImperialRace' } }),
  getIdFromDesc: () => 0, getDescFromId: (id) => id.toString(16), callPapyrusFunction: () => {},
};
const online = () => [...chars.entries()].filter(([, c]) => c.online).map(([id]) => id);
// gamemode.js's own: the name shown, as every client reads it
const nameOf = (a) => { const app = props.get(`${a}|appearance`); return (app && app.name) || 'Stranger'; };
const tagOf = (a) => (chars.get(a) || { tag: '????' }).tag;
const profileOf = (a) => (chars.get(a) || { pid: -1 }).pid;
const display = (a) => `${nameOf(a)} #${tagOf(a)}`;
const who = (a) => `${display(a)} (profile ${profileOf(a)})`;
const isAdmin = (a) => a === ADMIN;
// beastform.js's question, as it answers it
globalThis.__dboBeastName = (a) => { const s = props.get(`${a}|private.beast`); return s && s.form && s.original ? (s.form === 'werewolf' ? 'Werewolf' : 'Vampire Lord') : ''; };
globalThis.__dboBeastOriginalRace = (a) => { const s = props.get(`${a}|private.beast`); return s && s.original ? s.original.raceId : 0; };

// ---- gamemode.js: the name helpers --------------------------------------------------------------------------------------
// From ROSTER_MASKS to displayFor; 9899e6e0a had ownNameOf and ownDisplay alone, origin/server none (the name shown then
// stands in for each). namesFor(cfg) evaluates them under that gamemode-config.json.
const helperSrc = slice(GM.includes('const ROSTER_MASKS = ') ? 'const ROSTER_MASKS = ' : 'const ownNameOf = ', '\n// A character made in a Trial GM');
ok('gamemode.js defines ownNameOf and ownDisplay', /const ownNameOf = /.test(helperSrc) && /const ownDisplay = /.test(helperSrc));
const namesFor = (cfg) => (helperSrc
  ? new Function('cfg', 'nameOf', 'tagOf', 'display', `${helperSrc}
    return { ownNameOf, ownDisplay,
      realNameOf: typeof realNameOf === 'function' ? realNameOf : ownNameOf,
      publicNameOf: typeof publicNameOf === 'function' ? publicNameOf : nameOf,
      publicDisplay: typeof publicDisplay === 'function' ? publicDisplay : display,
      disguisedOf: typeof disguisedOf === 'function' ? disguisedOf : () => false,
      displayFor: typeof displayFor === 'function' ? displayFor : (v, t) => display(t) };`)(cfg, nameOf, tagOf, display)
  : { ownNameOf: nameOf, ownDisplay: display, realNameOf: nameOf, publicNameOf: nameOf, publicDisplay: display, disguisedOf: () => false, displayFor: (v, t) => display(t) });
// The checks marked "masks on" run with the switch set true; the shipped value is checked under "the switch" below
const MASKS_ON = { rosterPrivacy: { masks: true } };
const { ownNameOf, ownDisplay, realNameOf, publicNameOf, publicDisplay, disguisedOf, displayFor } = namesFor(MASKS_ON);
// gamemode-config.json as shipped, and the names under it
const shippedCfg = JSON.parse(src('gamemode-config.json'));
const shipped = namesFor(shippedCfg);

// ---- playermenu.js ------------------------------------------------------------------------------------------------------
// X menu actions run chat commands (runCommand): /party lands in dungeons.js, loaded below
const packets = [], ui = new Map(), cmdMap = new Map();
require(path.join(ROOT, 'playermenu.js'))({
  mp, log: () => {}, personal: () => {}, system: () => {}, registerChatCommand: () => {}, onUi: (n, f) => ui.set(n, f), sendPacket: (a, p) => packets.push({ a, p }),
  display, nameOf, tagOf, profileOf, onlineActors: online, isAdmin, isLeadStaff: isAdmin, ranksOf: (pid) => ranksOf(pid), giveItem: () => true, makeProp: () => {},
  runCommand: (a, n, s) => { const f = cmdMap.get(n); if (f) f(a, s); }, zones: { rankTitles: { jarl: 'Jarl', steward: 'Steward' } }, zoneOfActor: () => null,
  cfg: { playerMenu: {} }, every: () => {},
});
ok('playermenu.js answers __dboOwnName', typeof globalThis.__dboOwnName === 'function');

beast(RAVEN, 'werewolf');
mask(QUILL);
mask(THANE); beast(THANE, 'vampirelord');   // the look kept at the change is the mask's
beast(LOST, 'werewolf', '');
mask(MIRA);
ok('a plain character: the name shown', ownNameOf(VIEW) === 'Vilja Ashford', ownNameOf(VIEW));
ok('in werewolf form: the own name, not "Werewolf"', ownNameOf(RAVEN) === 'Raven Stormbrow', ownNameOf(RAVEN));
ok('masks on: behind a mask, the own name, not "Masked Person"', ownNameOf(QUILL) === 'Quill Varro', ownNameOf(QUILL));
ok('masked, then a Vampire Lord: the name kept behind the mask', ownNameOf(THANE) === 'Tova Hale', ownNameOf(THANE));
ok('a beast whose own name is lost is "Stranger", never the beast', ownNameOf(LOST) === 'Stranger', ownNameOf(LOST));
ok('ownDisplay keeps the #TAG', ownDisplay(RAVEN) === 'Raven Stormbrow #RVN1', ownDisplay(RAVEN));
ok('the staff name is as it was (D15)', globalThis.__dboStaffName(QUILL) === 'Quill Varro (masked)' && globalThis.__dboStaffName(RAVEN) === 'Raven Stormbrow (Werewolf form)'
  && globalThis.__dboStaffName(THANE) === 'Tova Hale (masked, Vampire Lord form)' && globalThis.__dboStaffName(VIEW) === '',
[globalThis.__dboStaffName(QUILL), globalThis.__dboStaffName(RAVEN), globalThis.__dboStaffName(THANE)]);
ok('in the world a beast is still the beast and a mask the mask (nameFor)', globalThis.__dboNameFor(VIEW, RAVEN) === 'Werewolf' && globalThis.__dboNameFor(VIEW, QUILL) === 'Masked Person');
// The name that goes with the #TAG the world sees: the client hides it over a beast and draws it under a mask
const pubs = [RAVEN, QUILL, THANE, LOST, VIEW].map(publicNameOf);
ok('the public name: a beast by the own name, a mask as the mask, the two at once by the own name (the beast hides the tag)',
  JSON.stringify(pubs) === JSON.stringify(['Raven Stormbrow', 'Masked Person', 'Tova Hale', 'Stranger', 'Vilja Ashford']), pubs);
ok('in disguise: a beast, a mask, both; not someone plain', disguisedOf(RAVEN) && disguisedOf(QUILL) && disguisedOf(THANE) && disguisedOf(LOST) && !disguisedOf(VIEW) && !disguisedOf(GUARD));

// ---- the officials (gamemode.js) and the Court tab (court.js) -----------------------------------------------------------
const zones = [{ id: 'whiterun', name: 'Whiterun', capital: 'x', officials: ['jarl', 'steward', 'commander', 'courtmage', 'guardcaptain', 'guard'] }];
const TITLES = { jarl: 'Jarl', steward: 'Steward', commander: 'Hold Commander', courtmage: 'Court Mage', guardcaptain: 'Guard Captain', guard: 'Guard' };
let officials = {};
const ranksOf = (pid) => { const out = []; for (const z of zones) for (const r of Object.keys(officials[z.id] || {})) if ((officials[z.id][r] || []).map(Number).includes(pid)) out.push({ zone: z, rank: r }); return out; };
// gamemode.js's findByName (online) and findAnyByName (online first, then the name and tag index), cut out below
const findSrc = slice('const findByName = (query) => {', '\n};\n');
ok('gamemode.js findByName is found', !!findSrc);
const findByName = new Function('onlineActors', 'tagOf', 'profileOf', 'nameOf', 'ownNameOf', 'disguisedOf', `${findSrc}\n};\nreturn findByName;`)(online, tagOf, profileOf, nameOf, ownNameOf, disguisedOf);
const anySrc = slice('const findAnyByName = (query) => {', '\n};\n');
ok('gamemode.js findAnyByName is found', !!anySrc);
const findAnyByName = new Function('findByName', 'mp', 'log', 'onlineActors', 'disguisedOf', `${anySrc}\n};\nreturn findAnyByName;`)(findByName, mp, () => {}, online, disguisedOf);
const seen = new Map();
const told = [], audits = [], said = [];
const handlers = {};
const commands = new Map();
const base = {
  mp, log: () => {}, personal: (a, t) => said.push({ a, t }), system: (a, text) => told.push({ a, text }), audit: (t) => audits.push(t), cfg: {},
  isAdmin, isLeadStaff: isAdmin, tierOf: (a) => (a === ADMIN ? 'developer' : null), profileOf, nameOf, tagOf, display, who,
  ownNameOf, ownDisplay, realNameOf, publicNameOf, publicDisplay, disguisedOf, displayFor,
  findByName, findAnyByName, onUi: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
  onlineActors: online, userOf: (a) => (chars.has(a) && chars.get(a).online ? 1 : -1), seen,
  zoneList: () => zones, zoneById: (id) => zones.find((z) => z.id === String(id).toLowerCase()) || null, ranksOf, rankTitle: (r) => TITLES[r] || r,
  readOfficials: () => JSON.parse(JSON.stringify(officials)), writeOfficials: (o) => { officials = JSON.parse(JSON.stringify(o)); },
  registerChatCommand: (n, f) => { commands.set(n, f); }, openWidget: () => {}, closeWidget: () => {},
};
const officialsSrc = slice('const APPOINT_RULES = ', '// ---- Scholar');
ok('gamemode.js\'s officials functions are found', /const officialTarget = /.test(officialsSrc));
const officialsWith = (b) => new Function(...Object.keys(b), `${officialsSrc}\nreturn { APPOINT_RULES, appointCap, appointCheck, appointFrom, seatOfficial, unseatOfficial, officialTarget, officialName, accountActors };`)(...Object.values(b));
const O = officialsWith(base);
require(path.join(ROOT, 'guilds.js'))(base);
const answers = [];
globalThis.__dboJournalFresh = (a, n) => n === 'N';
globalThis.__dboJournalLimited = (a, fn) => { answers.push(Object.assign({ a }, fn())); return true; };
require(path.join(ROOT, 'court.js'))(Object.assign({}, base, O));
const sec = globalThis.__dboJournalSections.court;
const ev = (name, a, ...args) => { answers.length = 0; told.length = 0; for (const f of handlers[name] || []) f(a, args); return answers[answers.length - 1] || null; };
const holders = (a, rank) => ((sec.view(a).courts.find((c) => c.id === 'whiterun') || { offices: [] }).offices.find((o) => o.rank === rank) || { holders: [] }).holders;

let r = ev('courtAppoint', ADMIN, 'N', 'whiterun', '#RVN1', 'jarl');
ok('staff seat the Jarl while she is a werewolf', (officials.whiterun || {}).jarl && officials.whiterun.jarl.includes(21), [r, officials]);
ev('courtAppoint', ADMIN, 'N', 'whiterun', '#QVR1', 'steward');
ev('courtAppoint', ADMIN, 'N', 'whiterun', 'Gerd', 'guard');
ok('the Guard sees the Court tab', sec.visible(GUARD) === true);
let h = holders(GUARD, 'jarl');
ok('THE BUG: the Court roster names the Jarl in werewolf form by her own name, not "Werewolf"', h.length === 1 && h[0].name === 'Raven Stormbrow' && h[0].online === true, h);
h = holders(GUARD, 'steward');
ok('masks on: the Court roster names the masked Steward by his own name, not "Masked Person"', h.length === 1 && h[0].name === 'Quill Varro', h);
ok('masks on: no Court roster entry is a mask\'s or a beast\'s name', !/Werewolf|Vampire Lord|Masked Person/.test(JSON.stringify(sec.view(GUARD))), JSON.stringify(sec.view(GUARD)).match(/.{40}(Werewolf|Masked Person).{20}/));
const roll = (fid) => (globalThis.__dboGuildState.members[fid] || {});
ok('the household roll written while she was a werewolf names her, not "Werewolf" (guilds.js setMember)', (roll('hold-whiterun')[String(RAVEN)] || {}).name === 'Raven Stormbrow', roll('hold-whiterun')[String(RAVEN)]);
ok('masks on: the household roll written behind the mask names him (guilds.js setMember)', (roll('hold-whiterun')[String(QUILL)] || {}).name === 'Quill Varro', roll('hold-whiterun')[String(QUILL)]);

// The name watch (gamemode.js watchPlayers) keeps the name an offline official is listed by
const watchSrc = slice('const watchPlayers = () => {', "\nevery('watch'");
ok('gamemode.js watchPlayers is found', !!watchSrc);
const watchWith = (names) => new Function('seen', 'onlineActors', 'profileOf', 'nameOf', 'ownNameOf', 'realNameOf', 'tierOf', 'rolesOf', 'mp', 'ADMIN_PROP', 'audit', 'who', 'adminResyncing', `${watchSrc}\nreturn watchPlayers;`)(
  seen, online, profileOf, nameOf, names.ownNameOf, names.realNameOf, base.tierOf, () => [], mp, 'private.dboAdmin', base.audit, who, () => false);
const watchPlayers = watchWith({ ownNameOf, realNameOf });
P(QUILL, 'appearance', Object.assign({}, props.get(`${QUILL}|appearance`), { name: 'Quill Varro' })); P(QUILL, 'maskName', '');
watchPlayers();
mask(QUILL);
audits.length = 0;
watchPlayers();
ok('a mask put on is no rename (no NAME audit)', !audits.some((t) => /^NAME /.test(t)), audits);
chars.get(QUILL).online = false;   // logs out; the watch kept what it saw last
h = holders(GUARD, 'steward');
ok('offline, the Steward who left behind his mask is listed by his own name (officialName, seen)', h.length === 1 && h[0].name === 'Quill Varro' && h[0].online === false, h);
const officialsLine = () => { said.length = 0; commands.get('officials')(GUARD, 'whiterun'); return said.map((s) => s.t).join(' | '); };
ok('masks on: /officials whiterun names them by their own names', /Jarl: Raven Stormbrow/.test(officialsLine()) && /Steward: Quill Varro/.test(officialsLine()), officialsLine());
chars.get(QUILL).online = true;

// A ruler in a beast form offers a post: the offer and its notices carry her own name
r = ev('courtOffer', RAVEN, 'N', 'whiterun', '#TOV1', 'courtmage');
ok('the werewolf Jarl\'s offer is made', r && r.kind === 'ok', r);
ok('the target is told by the Jarl\'s own name and tag', told.some((t) => t.a === THANE && /^Raven Stormbrow #RVN1 offers you the post of Court Mage/.test(t.text)), told);
const vT = sec.view(THANE);
ok('the offer lists who made it by her own name', vT.offers.length === 1 && vT.offers[0].from === 'Raven Stormbrow #RVN1', vT.offers);
const vR = sec.view(RAVEN).courts.find((c) => c.id === 'whiterun');
ok('the Jarl\'s outgoing offer names the target by her own name', vR.outgoing.length === 1 && vR.outgoing[0].name === 'Tova Hale #TOV1', vR.outgoing);
r = ev('courtAnswer', THANE, 'N', vT.offers[0].id, 'accept');
ok('accepting tells the Jarl by the new Court Mage\'s own name', told.some((t) => t.a === RAVEN && /^Tova Hale #TOV1 accepted the post of Court Mage/.test(t.text)), told);
// ...and to a mask by the #TAG drawn under it: the answer and her outgoing offers keep the mask
r = ev('courtOffer', RAVEN, 'N', 'whiterun', '#MQL1', 'guard');
const vR2 = sec.view(RAVEN).courts.find((c) => c.id === 'whiterun');
const toMira = (vR2.outgoing || []).find((o) => /#MQL1$/.test(o.name)) || {};
ok('an offer to a mask by the #TAG under it answers with the mask, never her own name', r && r.kind === 'ok' && /Masked Person #MQL1/.test(r.text || '') && !/Mira Quell/.test(JSON.stringify(r)), r);
ok('the Jarl\'s outgoing offer to the mask names the mask', toMira.name === 'Masked Person #MQL1', vR2.outgoing);

// ---- no name finds anyone behind a mask or in a beast form (gamemode.js findByName, findAnyByName) ------------------------
chars.get(LOST).online = false;   // one werewolf about: the beast's name alone found her
ok('"Werewolf" finds no one', findByName('Werewolf') === 0, findByName('Werewolf'));
ok('"Masked Person" finds no one', findByName('Masked Person') === 0, findByName('Masked Person'));
ok('"Raven Stormbrow" (her own name) finds no one while she is a werewolf', findByName('Raven Stormbrow') === 0, findByName('Raven Stormbrow'));
ok('"Raven" (the start of her name) finds no one while she is a werewolf', findByName('Raven') === 0, findByName('Raven'));
ok('"Quill Varro" (his own name) finds no one behind the mask', findByName('Quill Varro') === 0, findByName('Quill Varro'));
ok('"Quill" (the start of his name) finds no one behind the mask', findByName('Quill') === 0, findByName('Quill'));
ok('the #TAG still finds a beast and a mask', findByName('#RVN1') === RAVEN && findByName('#QVR1') === QUILL);
ok('the profile id still finds a beast', findByName('21') === RAVEN);
ok('someone plain is found by the start of their name', findByName('Vilja') === VIEW);
ok('/appoint by "Werewolf" names no one', !!O.officialTarget('Werewolf').error, O.officialTarget('Werewolf'));
// The name index (private.indexed.nameKey) keeps the own name: it found her and answered "Werewolf #RVN1"
ok('/appoint by her own name names no one while she is a werewolf', !!O.officialTarget('Raven Stormbrow').error, O.officialTarget('Raven Stormbrow'));
ok('/appoint by his own name names no one while he is masked', !!O.officialTarget('Quill Varro').error, O.officialTarget('Quill Varro'));
chars.get(VIEW).online = false;
ok('the name index still finds someone offline by their name', findAnyByName('Vilja Ashford') === VIEW, findAnyByName('Vilja Ashford'));
chars.get(VIEW).online = true;
// What a lookup by #TAG answers: a beast by the own name (the client hides the tag over it), a mask as the mask
ok('/appoint by a beast\'s #TAG answers with her own name, never the beast', O.officialTarget('#RVN1').label === 'Raven Stormbrow #RVN1', O.officialTarget('#RVN1').label);
ok('/appoint by the #TAG drawn under a mask answers with the mask, never his own name', O.officialTarget('#QVR1').label === 'Masked Person #QVR1', O.officialTarget('#QVR1').label);
chars.get(LOST).online = true;

// ---- /players (gamemode.js) ---------------------------------------------------------------------------------------------
const playersLine = (GM.match(/^registerChatCommand\('players', .*$/m) || [''])[0];
ok('/players is found', !!playersLine);
const playersCmd = new Map();
new Function('registerChatCommand', 'onlineActors', 'display', 'ownDisplay', 'publicDisplay', 'personal', playersLine)((n, f) => playersCmd.set(n, f), online, display, ownDisplay, publicDisplay, (a, t) => said.push({ a, t }));
said.length = 0; playersCmd.get('players')(VIEW, '');
const pl = said.map((s) => s.t).join(' ');
ok('/players names a beast by the own name, never the beast', /Raven Stormbrow #RVN1/.test(pl) && /Tova Hale #TOV1/.test(pl) && !/Werewolf|Vampire Lord/.test(pl), pl);
ok('/players keeps the mask: never the own name beside the #TAG drawn under a mask', /Masked Person #QVR1/.test(pl) && /Masked Person #MQL1/.test(pl) && !/Quill Varro|Mira Quell/.test(pl), pl);

// ---- Inspect (playermenu.js) --------------------------------------------------------------------------------------------
P(VIEW, 'ff_knownIds', [RAVEN, QUILL]);
packets.length = 0; ui.get('playerAction')(VIEW, ['inspect', RAVEN]);
const lines = ((packets.find((x) => x.p.mode === 'inspect') || {}).p || {}).lines || [];
ok('Inspect on the werewolf shows the beast: no race, sex or office', lines[0] === 'Werewolf' && !lines.some((l) => /Woman|Man|Nord|Jarl/.test(l)), lines);
packets.length = 0; ui.get('playerAction')(VIEW, ['inspect', THANE]);
const tl = ((packets.find((x) => x.p.mode === 'inspect') || {}).p || {}).lines || [];
ok('Inspect on a Vampire Lord who was masked shows the beast only, no mask', tl[0] === 'Vampire Lord' && !tl.some((l) => /mask|Woman|Nord/i.test(l)), tl);
packets.length = 0; ui.get('playerAction')(VIEW, ['inspect', MIRA]);
const ml = ((packets.find((x) => x.p.mode === 'inspect') || {}).p || {}).lines || [];
ok('Inspect on a mask still shows the mask', ml.includes('Face hidden behind a mask'), ml);
packets.length = 0; ui.get('playerAction')(VIEW, ['inspect', GUARD]);
const gl = ((packets.find((x) => x.p.mode === 'inspect') || {}).p || {}).lines || [];
ok('Inspect on someone plain is as it was', /^Man, Nord$/.test(gl[0] || ''), gl);

// ---- the Nobility tab (nobility.js) -------------------------------------------------------------------------------------
globalThis.__dboCourtFaction = (zid) => (zid === 'whiterun' ? 'hold-whiterun' : null);
const decrees = [];
const NOBILITY_CFG = { nobility: { enabled: true, realms: { whiterun: 'skyrim' } } };
require(path.join(ROOT, 'nobility.js'))(Object.assign({}, base, O, { every: () => {}, announce: (t) => decrees.push(t), cfg: NOBILITY_CFG }));
const nsec = globalThis.__dboJournalSections.nobility;
r = ev('nobilityGrant', RAVEN, 'N', 'whiterun', '#QVR1', 'thane', '');
ok('the werewolf Jarl names the masked Steward a Thane', r && r.kind === 'ok', r);
ok('the answer to a grant by the #TAG under the mask names the mask, never his own name', r && /Masked Person/.test(r.text || '') && !/Quill Varro/.test(JSON.stringify(r)), r);
const hold = (nsec.view(VIEW).holds || []).find((x) => x.id === 'whiterun') || {};
ok('the Nobility tab names the ruler by her own name, not "Werewolf"', hold.ruler && hold.ruler.name === 'Raven Stormbrow', hold.ruler);
ok('masks on: the roll names the Thane by his own name, not "Masked Person"', (hold.roll || []).length === 1 && hold.roll[0].name === 'Quill Varro', hold.roll);
chars.get(QUILL).online = false;
const hold2 = (nsec.view(VIEW).holds || []).find((x) => x.id === 'whiterun') || {};
ok('offline, the roll keeps the own name written at the grant', (hold2.roll || [])[0] && hold2.roll[0].name === 'Quill Varro', hold2.roll);
chars.get(QUILL).online = true;
// As shipped (rosterPrivacy.masks false): the decree that announce() sends to every player names the mask granted a title
// by the #TAG drawn under it as the mask (re-verify P1: with true it read "Quill Varro is named Thane of Whiterun", and the
// Nobility tab, which every player sees, listed him by name beside #QVR1). The title is taken back first, then granted
// again through a nobility.js given the shipped names.
ev('nobilityRevoke', RAVEN, 'N', 'whiterun', QUILL.toString(16));
const handlers2 = {};
const ev2 = (name, a, ...args) => { answers.length = 0; told.length = 0; for (const f of handlers2[name] || []) f(a, args); return answers[answers.length - 1] || null; };
require(path.join(ROOT, 'nobility.js'))(Object.assign({}, base, shipped, officialsWith(Object.assign({}, base, shipped)), {
  onUi: (e, fn) => { (handlers2[e] = handlers2[e] || []).push(fn); }, every: () => {}, announce: (t) => decrees.push(t), cfg: NOBILITY_CFG,
}));
decrees.length = 0;
r = ev2('nobilityGrant', RAVEN, 'N', 'whiterun', '#QVR1', 'thane', '');
ok('as shipped: the decree after a grant to #QVR1 names the mask, never his own name', r && r.kind === 'ok' && decrees.length === 1
  && /Masked Person is named Thane/.test(decrees[0]) && !/Quill Varro/.test(decrees.join(' ')), { r, decrees });
const hold3 = (globalThis.__dboJournalSections.nobility.view(VIEW).holds || []).find((x) => x.id === 'whiterun') || {};
ok('as shipped: the Nobility roll names the masked Thane as the mask', (hold3.roll || []).length === 1 && hold3.roll[0].name === 'Masked Person', hold3.roll);

// ---- the household's invitations (guilds.js, the Court tab) -----------------------------------------------------------
r = globalThis.__dboGuildInvite(ADMIN, MIRA, 'hold-whiterun');
const pend = ((globalThis.__dboCourtHousehold(ADMIN, 'whiterun') || {}).pending || []).find((p) => p.actorId === MIRA) || {};
ok('a mask invited into the household by the #TAG under it is listed as the mask, never her own name', r && !r.error && pend.name === 'Masked Person', { r, pend });

// ---- the ledger of contacts (ledger.js) ---------------------------------------------------------------------------------
const lcmd = {};
const ledgerWith = (names, viewer = VIEW, metOf = (a) => (a === VIEW ? [RAVEN, QUILL, GUARD] : [])) => {
  require(path.join(ROOT, 'ledger.js'))({
    mp: Object.assign({}, mp, { get: (id, k) => (k === 'pos' ? [0, 0, 0] : k === 'worldOrCellDesc' ? 'tamriel' : mp.get(id, k)) }),
    log: () => {}, personal: (a, t) => said.push({ a, t }), audit: () => {}, who, nameOf, tagOf, profileOf, onlineActors: online, ownNameOf: names.ownNameOf,
    registerChatCommand: (n, f) => { lcmd[n] = f; }, isAdmin, isWorldspace: (w) => w === 'tamriel', metOf,
    forgetMet: () => {}, sendPigeon: () => ({ ok: true, text: '' }), boardZoneNear: () => 'whiterun', zoneOfActor: () => ({ id: 'whiterun' }), cfg: {},
  });
  said.length = 0; lcmd.ledger(viewer, '');
  return said.map((s) => s.t).join('\n');
};
globalThis.__dboGuildsOf = () => [];
const book = ledgerWith({ ownNameOf });
ok('masks on: the ledger lists contacts by their own names, not the beast\'s or the mask\'s', /Raven Stormbrow #RVN1/.test(book) && /Quill Varro #QVR1/.test(book) && !/Werewolf|Masked Person/.test(book), book);

// ---- /party (dungeons.js) and X > Invite to Party (playermenu.js) -------------------------------------------------------
require(path.join(ROOT, 'dungeons.js'))(Object.assign({}, base, {
  registerChatCommand: (n, f) => cmdMap.set(n, f), sendPacket: () => true, openWidget: () => true, closeWidget: () => true, giveItem: () => true, cfg: {}, every: () => {},
}));
const toldTo = (a) => said.filter((x) => x.a === a).map((x) => x.t).concat(told.filter((x) => x.a === a).map((x) => x.text)).join(' | ');
const party = (a, q) => { said.length = 0; told.length = 0; cmdMap.get('party')(a, `invite ${q}`); return toldTo(a); };
let pr = party(VIEW, 'Raven Stormbrow');
ok('"/party invite Raven Stormbrow" does not tell the asker she is the werewolf', !/Werewolf/.test(pr), pr);
pr = party(VIEW, 'Raven');
ok('"/party invite Raven" (the start of her name) does not tell the asker she is the werewolf', !/Werewolf/.test(pr), pr);
pr = party(VIEW, 'Quill');
ok('"/party invite Quill" does not tell the asker he is behind the mask', !/Masked Person/.test(pr), pr);
// X on the werewolf, Invite to Party: playermenu.js runs "/party invite #TAG"; the answer gave away the tag the client hides
said.length = 0; told.length = 0; ui.get('playerAction')(VIEW, ['party', RAVEN]);
pr = toldTo(VIEW);
ok('X > Invite to Party on the werewolf answers without her #TAG', /Invited Werewolf/.test(pr) && !/RVN1/.test(pr), pr);
// ...and so /players cannot pair that tag with her own name
const echoedTag = (pr.match(/#[A-Z0-9]{4}/) || [])[0] || '';
said.length = 0; playersCmd.get('players')(VIEW, '');
const linked = echoedTag ? ((said.map((s) => s.t).join(' ').match(new RegExp(`([^,:]+) ${echoedTag}`)) || [])[1] || '') : '';
ok('X > Invite to Party on the werewolf, then /players, does not name her', !/Raven Stormbrow/.test(linked), { echo: pr, players: linked });
pr = party(RAVEN, '#VIEW');
ok('the one a werewolf invites is told by the beast, with no #TAG', /^Werewolf invites you to their party/.test(toldTo(VIEW)) && !/RVN1|Raven/.test(toldTo(VIEW)), toldTo(VIEW));

// ---- /charter invite (charters.js) ----------------------------------------------------------------------------------------
const chartCmds = new Map();
require(path.join(ROOT, 'charters.js'))(Object.assign({}, base, {
  registerChatCommand: (n, f) => chartCmds.set(n, f), cfg: { charters: { enabled: true } }, takeGold: () => true, giveItem: () => true, every: () => {},
}));
said.length = 0; chartCmds.get('charter')(VIEW, 'found Lantern Wardens');
const founded = said.map((s) => s.t).join(' | ');
said.length = 0; chartCmds.get('charter')(VIEW, 'invite #RVN1 officer');
const ci = said.filter((s) => s.a === VIEW).map((s) => s.t).join(' | ');
ok('/charter invite by a werewolf\'s #TAG answers with the beast and no #TAG', /You asked Werewolf to co-found/.test(ci) && !/RVN1/.test(ci), { founded, ci });

// ---- the switch: gamemode-config.json rosterPrivacy.masks --------------------------------------------------------------
const off = namesFor({ rosterPrivacy: { masks: false } });
ok('the shipped gamemode-config.json sets rosterPrivacy.masks false (masks as on origin/server until Nate rules)', (shippedCfg.rosterPrivacy || {}).masks === false, shippedCfg.rosterPrivacy);
ok('as shipped: a roster names a mask as the mask', shipped.ownNameOf(QUILL) === 'Masked Person' && shipped.ownDisplay(QUILL) === 'Masked Person #QVR1', shipped.ownDisplay(QUILL));
ok('rosterPrivacy.masks is off unless set true: no key, or no section, keeps the mask in rosters',
  namesFor({ rosterPrivacy: {} }).ownNameOf(QUILL) === 'Masked Person' && namesFor({}).ownNameOf(QUILL) === 'Masked Person', [namesFor({ rosterPrivacy: {} }).ownNameOf(QUILL), namesFor({}).ownNameOf(QUILL)]);
ok('masks on: a roster names a mask by the own name', ownNameOf(QUILL) === 'Quill Varro', ownNameOf(QUILL));
ok('masks off: a roster names a mask as the mask', off.ownNameOf(QUILL) === 'Masked Person' && off.ownDisplay(QUILL) === 'Masked Person #QVR1', off.ownDisplay(QUILL));
ok('masks off: a roster still never names a beast by the beast', off.ownNameOf(RAVEN) === 'Raven Stormbrow' && off.ownNameOf(THANE) === 'Tova Hale' && off.ownNameOf(LOST) === 'Stranger',
  [RAVEN, THANE, LOST].map(off.ownNameOf));
const Ooff = officialsWith(Object.assign({}, base, off));
ok('masks off: /officials names the masked Steward online as the mask, the werewolf Jarl by her own name', Ooff.officialName(22) === 'Masked Person' && Ooff.officialName(21) === 'Raven Stormbrow',
  [Ooff.officialName(22), Ooff.officialName(21)]);
const offBook = ledgerWith(off);
ok('masks off: the ledger lists the mask as the mask, the werewolf by her own name', /Masked Person #QVR1/.test(offBook) && /Raven Stormbrow #RVN1/.test(offBook) && !/Werewolf/.test(offBook), offBook);
audits.length = 0;
const watchOff = watchWith(off);
P(QUILL, 'appearance', Object.assign({}, props.get(`${QUILL}|appearance`), { name: 'Quill Varro' })); P(QUILL, 'maskName', '');
watchOff(); mask(QUILL); watchOff();
ok('masks off: a mask put on is still no rename', !audits.some((t) => /^NAME /.test(t)), audits);
chars.get(QUILL).online = false;
ok('masks off: an official offline is named by the own name the watch kept (logging out unmasks)', Ooff.officialName(22) === 'Quill Varro', Ooff.officialName(22));
chars.get(QUILL).online = true;
ok('either way no name finds a mask, only the #TAG', findByName('Quill') === 0 && findByName('Masked Person') === 0 && findByName('#QVR1') === QUILL);

// ---- the meet tick (gamemode.js): nobody meets someone in disguise -------------------------------------------------------
// Every 5 s each pair within say range (20 m) was written into both private.metActors, with no introduction, and the
// ledger and the pigeon coop list those contacts by name and #TAG. A stranger who stood near masked Mira read "Mira Quell
// #MQL1" (re-verify P6, with masks on), the #TAG the client draws under her mask; one who stood near the werewolf gained
// "Raven Stormbrow #RVN1" (P7; "Werewolf #RVN1" on origin/server). The real tick runs here, everyone at one spot.
const meetSrc = slice("every('meet', MEET_TICK_MS, () => {", '\n});\n');
const noteSrc = slice('const noteMet = (a, b, changed) => {', '\n};\n');
const metLine = (GM.match(/^const metOf = .*$/m) || [''])[0];
ok('gamemode.js\'s meet tick is found', !!(meetSrc && noteSrc && metLine));
const metList = (a) => props.get(`${a}|private.metActors`) || [];
// A fresh tick (its own cache of met lists) over these characters, all online at one spot
const meetTick = (...who) => {
  for (const a of who) P(a, 'private.metActors', []);
  let tick = () => {};
  if (meetSrc && noteSrc && metLine) {
    const mpHere = Object.assign({}, mp, { get: (id, k) => (k === 'pos' ? [0, 0, 0] : k === 'worldOrCellDesc' ? 'tamriel' : mp.get(id, k)) });
    new Function('every', 'MEET_TICK_MS', 'cfg', 'UNITS_PER_METER', 'onlineActors', 'mp', 'disguisedOf',
      `const MAX_MET = 500;\n${metLine}\nconst metCache = new Map();\n${noteSrc}\n};\n${meetSrc}\n});`)(
      (n, ms, f) => { tick = f; }, 5000, {}, 70, () => who, mpHere, disguisedOf);
  }
  tick();
  return tick;
};
const metBook = (viewer) => ledgerWith({ ownNameOf }, viewer, metList);   // masks on: the ledger names a mask by the own name
let tickVM = meetTick(VIEW, MIRA);
let mb = metBook(VIEW);
ok('P6: a stranger who stood near masked Mira gains no contact: not in her met list, and the ledger has neither her name nor her #TAG',
  !metList(VIEW).includes(MIRA) && !/Mira Quell|MQL1|Masked Person/.test(mb), { met: metList(VIEW), ledger: mb });
ok('the masked one still meets the plain stranger she stood beside', metList(MIRA).includes(VIEW), metList(MIRA));
meetTick(GUARD, RAVEN);
mb = metBook(GUARD);
ok('P7: a stranger who stood near the werewolf gains no contact: not in his met list, no name, beast or #TAG in the ledger',
  !metList(GUARD).includes(RAVEN) && !/Raven|RVN1|Werewolf/.test(mb), { met: metList(GUARD), ledger: mb });
ok('the werewolf still meets the plain stranger', metList(RAVEN).includes(GUARD), metList(RAVEN));
meetTick(VIEW, GUARD);
ok('two plain characters still meet, both ways', metList(VIEW).includes(GUARD) && metList(GUARD).includes(VIEW), [metList(VIEW), metList(GUARD)]);
// Mira takes the mask off by Vilja: the next tick notes the meeting, and it stays when the mask goes back on
P(VIEW, 'private.metActors', []); tickVM = meetTick(VIEW, MIRA);
P(MIRA, 'appearance', Object.assign({}, props.get(`${MIRA}|appearance`), { name: 'Mira Quell' })); P(MIRA, 'maskName', '');
tickVM();
mask(MIRA);
ok('unmasked, she is met by the next tick, and stays met behind the mask again', metList(VIEW).includes(MIRA), metList(VIEW));

// ---- every other roster and record that keeps a name -------------------------------------------------------------------
// Each line names people as the rosters do (ownNameOf/ownDisplay) or, for someone looked up, as the asker asked for them
// (publicNameOf/publicDisplay); the module takes them from gamemode.js
const has = (f, re) => re.test(src(f));
const rows = [
  ['gamemode.js pigeon contacts', 'gamemode.js', /contacts\.push\(\{ id, name: ownNameOf\(id\)/],
  ['gamemode.js a letter is signed with the own name', 'gamemode.js', /let from = ownDisplay\(a\);/],
  ['gamemode.js modules get ownNameOf and ownDisplay (court)', 'gamemode.js', /require\(COURT_JS\)\(\{ mp, log, ownNameOf, ownDisplay,/],
  ['gamemode.js the U-panel picker leaves out anyone in disguise (their names find no one)', 'gamemode.js', /known !== 'Stranger' && !disguisedOf\(t\)/],
  ['guilds.js invitations and their notices', 'guilds.js', /from: ownDisplay\(i\.from\)/],
  ['guilds.js the household\'s pending invitations: the invitee as asked for, the inviter as the rosters name them', 'guilds.js', /name: publicNameOf\(Number\(t\) >>> 0\), from: ownNameOf\(i\.from\)/],
  ['dungeons.js the party panel', 'dungeons.js', /\{ id: x, name: ownNameOf\(x\), leader: m === p\.leader \}/],
  ['dungeons.js /party', 'dungeons.js', /\(x \? ownDisplay\(x\) : `#\$\{m\}`\) \+ \(m === p\.leader/],
  ['dungeons.js /party kick answers without a beast\'s #TAG', 'dungeons.js', /return personal\(a, `\$\{displayFor\(a, t\)\} removed\.`\)/],
  ['thalmor.js a dossier names its subject as the agent asked for them, its agents as the rosters do', 'thalmor.js', /name: String\(publicNameOf\(t\) \|\| ''\)[\s\S]*byName: sys \? 'Concordat record' : String\(ownNameOf\(by\)[\s\S]*doc\.name = String\(publicNameOf\(t\) \|\| doc\.name\)/],
  ['couriers.js jobs', 'couriers.js', /senderName: ownNameOf\(a\)[\s\S]*recipientName: ownNameOf\(to\)[\s\S]*courierName: ownNameOf\(a\)/],
  ['post.js supply orders', 'post.js', /posterName: ownNameOf\(a\)/],
  ['charters.js founders', 'charters.js', /founder: \{ actor: a >>> 0, profile: prof, name: ownNameOf\(a\) \}/],
  ['commissions.js parties', 'commissions.js', /name: ownDisplay\(a\) \}\);/],
  ['tenancy.js landlord and tenant', 'tenancy.js', /tag: tagOf\(a\), name: ownDisplay\(a\) \}\);/],
  ['business.js owner, renter, tax', 'business.js', /ownerName: ownDisplay\(a\)[\s\S]*setHoldTax\(zone, pct, ownDisplay\(a\)/],
  ['business.js staff taken on by a name or #TAG are named as the owner asked for them', 'business.js', /return t \? \{ profile: profileOf\(t\), name: publicDisplay\(t\), actor: t \} : null;/],
  ['economy.js who set the tax', 'economy.js', /__dboSetHoldTax'\)\(zone, Math\.round\(pct\), ownDisplay\(a\)/],
  ['gamemode-config.json carries the switch rosterPrivacy.masks', 'gamemode-config.json', /"rosterPrivacy": \{[\s\S]*?"masks": (true|false)/],
];
for (const [label, f, re] of rows) ok(label, has(f, re));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
