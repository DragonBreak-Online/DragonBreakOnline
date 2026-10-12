// Rosters name people by their own name, never a mask's or a beast's (tracker 1559074270959640676, 12 Oct: the F3 Court tab
// listed a Jarl in werewolf form as "Werewolf", so anyone reading it learnt who the beast was). Runs the real gamemode.js
// pieces (ownNameOf, findByName, /players, the name watch and the officials functions), playermenu.js, guilds.js, court.js,
// nobility.js and ledger.js against stubs in a temp folder, with a Jarl in werewolf form, a Steward behind a mask, a Thane
// who was a beast and a mask at once, and a plain viewer. Covers: the own name behind a mask, a beast, both, and a lost
// name (never the beast's); the staff name kept as it was; Inspect on a beast (no race, sex or office); the Court tab's
// holders online and offline, the offers and their notices, the household roll written while transformed; the Nobility
// tab's ruler and roll; the ledger of contacts; /players; a name lookup that no longer finds anyone by "Werewolf" or
// "Masked Person" but still by the real name and the #TAG; and every other roster and record that keeps a name.
//
//   node tests/roster-privacy-harness.js   (from server/)
//   ROSTER_ROOT=<another copy of server/> runs the same checks against that copy (origin/server fails them)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.env.ROSTER_ROOT ? path.resolve(process.env.ROSTER_ROOT) : path.resolve(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const GM = src('gamemode.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-privacy-'));
for (const f of ['guild-defs.json', 'nobility-fiefs.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
process.chdir(dir);

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const slice = (from, to) => { const i = GM.indexOf(from); const j = i < 0 ? -1 : GM.indexOf(to, i + from.length); return i < 0 || j < 0 ? '' : GM.slice(i, j); };

// ---- the world ---------------------------------------------------------------------------------------------------------
// RAVEN, Jarl of Whiterun, is in werewolf form (beastform.js: the appearance keeps the race, named after the form, and the
// look before the change is in private.beast.original). QUILL, Steward, wears a mask (playermenu.js: "Masked Person", the
// real name in maskName). THANE put a mask on and then changed (the look kept at the change is the mask's). LOST is a beast
// whose kept look has no name. VIEW and GUARD are plain.
const ADMIN = 0x10, RAVEN = 0x21, QUILL = 0x22, VIEW = 0x23, GUARD = 0x24, THANE = 0x25, LOST = 0x26;
const NORD = 0x13746, BRETON = 0x13741;
const chars = new Map([
  [ADMIN, { pid: 1, name: 'Admin', tag: 'ADMN', online: true, race: NORD }],
  [RAVEN, { pid: 21, name: 'Raven Stormbrow', tag: 'RVN1', online: true, race: NORD, female: true }],
  [QUILL, { pid: 22, name: 'Quill Varro', tag: 'QVR1', online: true, race: BRETON }],
  [VIEW, { pid: 23, name: 'Vilja Ashford', tag: 'VIEW', online: true, race: NORD }],
  [GUARD, { pid: 24, name: 'Gerd', tag: 'GRD1', online: true, race: NORD }],
  [THANE, { pid: 25, name: 'Tova Hale', tag: 'TOV1', online: true, race: NORD }],
  [LOST, { pid: 26, name: 'Lio', tag: 'LIO1', online: true, race: NORD }],
]);
const props = new Map();
const P = (id, k, v) => props.set(`${id}|${k}`, v);
for (const [id, c] of chars) P(id, 'appearance', { name: c.name, raceId: c.race, isFemale: !!c.female });
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

// ---- gamemode.js: ownNameOf and ownDisplay --------------------------------------------------------------------------
const ownSrc = slice('const ownNameOf = ', '\n// ');
const ownLine = (GM.match(/^const ownDisplay = .*$/m) || [''])[0];
ok('gamemode.js defines ownNameOf and ownDisplay', !!ownSrc && !!ownLine);
const own = ownSrc && ownLine
  ? new Function('nameOf', 'tagOf', `${ownSrc.slice(0, ownSrc.indexOf('const ownDisplay'))}\n${ownLine}\nreturn { ownNameOf, ownDisplay };`)(nameOf, tagOf)
  : { ownNameOf: nameOf, ownDisplay: display };
const { ownNameOf, ownDisplay } = own;

// ---- playermenu.js ------------------------------------------------------------------------------------------------------
const packets = [], ui = new Map();
require(path.join(ROOT, 'playermenu.js'))({
  mp, log: () => {}, personal: () => {}, system: () => {}, registerChatCommand: () => {}, onUi: (n, f) => ui.set(n, f), sendPacket: (a, p) => packets.push({ a, p }),
  display, nameOf, tagOf, profileOf, onlineActors: online, isAdmin, isLeadStaff: isAdmin, ranksOf: (pid) => ranksOf(pid), giveItem: () => true, makeProp: () => {},
  runCommand: () => {}, zones: { rankTitles: { jarl: 'Jarl', steward: 'Steward' } }, zoneOfActor: () => null, cfg: { playerMenu: {} }, every: () => {},
});
ok('playermenu.js answers __dboOwnName', typeof globalThis.__dboOwnName === 'function');

beast(RAVEN, 'werewolf');
mask(QUILL);
mask(THANE); beast(THANE, 'vampirelord');   // the look kept at the change is the mask's
beast(LOST, 'werewolf', '');
ok('a plain character: the name shown', ownNameOf(VIEW) === 'Vilja Ashford', ownNameOf(VIEW));
ok('in werewolf form: the own name, not "Werewolf"', ownNameOf(RAVEN) === 'Raven Stormbrow', ownNameOf(RAVEN));
ok('behind a mask: the own name, not "Masked Person"', ownNameOf(QUILL) === 'Quill Varro', ownNameOf(QUILL));
ok('masked, then a Vampire Lord: the name kept behind the mask', ownNameOf(THANE) === 'Tova Hale', ownNameOf(THANE));
ok('a beast whose own name is lost is "Stranger", never the beast', ownNameOf(LOST) === 'Stranger', ownNameOf(LOST));
ok('ownDisplay keeps the #TAG', ownDisplay(RAVEN) === 'Raven Stormbrow #RVN1', ownDisplay(RAVEN));
ok('the staff name is as it was (D15)', globalThis.__dboStaffName(QUILL) === 'Quill Varro (masked)' && globalThis.__dboStaffName(RAVEN) === 'Raven Stormbrow (Werewolf form)'
  && globalThis.__dboStaffName(THANE) === 'Tova Hale (masked, Vampire Lord form)' && globalThis.__dboStaffName(VIEW) === '',
[globalThis.__dboStaffName(QUILL), globalThis.__dboStaffName(RAVEN), globalThis.__dboStaffName(THANE)]);
ok('in the world a beast is still the beast and a mask the mask (nameFor)', globalThis.__dboNameFor(VIEW, RAVEN) === 'Werewolf' && globalThis.__dboNameFor(VIEW, QUILL) === 'Masked Person');

// ---- the officials (gamemode.js) and the Court tab (court.js) -----------------------------------------------------------
const zones = [{ id: 'whiterun', name: 'Whiterun', capital: 'x', officials: ['jarl', 'steward', 'commander', 'courtmage', 'guardcaptain', 'guard'] }];
const TITLES = { jarl: 'Jarl', steward: 'Steward', commander: 'Hold Commander', courtmage: 'Court Mage', guardcaptain: 'Guard Captain', guard: 'Guard' };
let officials = {};
const ranksOf = (pid) => { const out = []; for (const z of zones) for (const r of Object.keys(officials[z.id] || {})) if ((officials[z.id][r] || []).map(Number).includes(pid)) out.push({ zone: z, rank: r }); return out; };
const findByTag = (q) => { const m = String(q).trim().match(/#([A-Za-z0-9]{4})$/); return m ? [...chars.entries()].find(([, c]) => c.tag.toLowerCase() === m[1].toLowerCase()) : null; };
// gamemode.js's findByName (online), cut out below; the offline index (private.indexed.nameKey) holds the real names
const findSrc = slice('const findByName = (query) => {', '\n};\n');
ok('gamemode.js findByName is found', !!findSrc);
const findByName = new Function('onlineActors', 'tagOf', 'profileOf', 'nameOf', 'ownNameOf', `${findSrc}\n};\nreturn findByName;`)(online, tagOf, profileOf, nameOf, ownNameOf);
const findAnyByName = (q) => { const t = findByName(q); if (t) return t; const h = findByTag(q); if (h) return h[0]; const r = [...chars.entries()].filter(([, c]) => c.name.toLowerCase() === String(q).trim().toLowerCase()); return r.length === 1 ? r[0][0] : r.length > 1 ? -r.length : 0; };
const seen = new Map();
const told = [], audits = [], said = [];
const handlers = {};
const commands = new Map();
const base = {
  mp, log: () => {}, personal: (a, t) => said.push({ a, t }), system: (a, text) => told.push({ a, text }), audit: (t) => audits.push(t), cfg: {},
  isAdmin, isLeadStaff: isAdmin, tierOf: (a) => (a === ADMIN ? 'developer' : null), profileOf, nameOf, tagOf, display, who, ownNameOf, ownDisplay,
  findByName, findAnyByName, onUi: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
  onlineActors: online, userOf: (a) => (chars.has(a) && chars.get(a).online ? 1 : -1), seen,
  zoneList: () => zones, zoneById: (id) => zones.find((z) => z.id === String(id).toLowerCase()) || null, ranksOf, rankTitle: (r) => TITLES[r] || r,
  readOfficials: () => JSON.parse(JSON.stringify(officials)), writeOfficials: (o) => { officials = JSON.parse(JSON.stringify(o)); },
  registerChatCommand: (n, f) => { commands.set(n, f); }, openWidget: () => {}, closeWidget: () => {},
};
const officialsSrc = slice('const APPOINT_RULES = ', '// ---- Scholar');
ok('gamemode.js\'s officials functions are found', /const officialTarget = /.test(officialsSrc));
const O = new Function(...Object.keys(base), `${officialsSrc}\nreturn { APPOINT_RULES, appointCap, appointCheck, appointFrom, seatOfficial, unseatOfficial, officialTarget, officialName, accountActors };`)(...Object.values(base));
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
ok('the Court roster names the masked Steward by his own name, not "Masked Person"', h.length === 1 && h[0].name === 'Quill Varro', h);
ok('no Court roster entry is a mask\'s or a beast\'s name', !/Werewolf|Vampire Lord|Masked Person/.test(JSON.stringify(sec.view(GUARD))), JSON.stringify(sec.view(GUARD)).match(/.{40}(Werewolf|Masked Person).{20}/));
const roll = (fid) => (globalThis.__dboGuildState.members[fid] || {});
ok('the household roll written while she was a werewolf names her, not "Werewolf" (guilds.js setMember)', (roll('hold-whiterun')[String(RAVEN)] || {}).name === 'Raven Stormbrow', roll('hold-whiterun')[String(RAVEN)]);
ok('the household roll written behind the mask names him (guilds.js setMember)', (roll('hold-whiterun')[String(QUILL)] || {}).name === 'Quill Varro', roll('hold-whiterun')[String(QUILL)]);

// The name watch (gamemode.js watchPlayers) keeps the name an offline official is listed by
const watchSrc = slice('const watchPlayers = () => {', "\nevery('watch'");
ok('gamemode.js watchPlayers is found', !!watchSrc);
const watchPlayers = new Function('seen', 'onlineActors', 'profileOf', 'nameOf', 'ownNameOf', 'tierOf', 'rolesOf', 'mp', 'ADMIN_PROP', 'audit', 'who', `${watchSrc}\nreturn watchPlayers;`)(
  seen, online, profileOf, nameOf, ownNameOf, base.tierOf, () => [], mp, 'private.dboAdmin', base.audit, who);
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
ok('/officials whiterun names them by their own names', /Jarl: Raven Stormbrow/.test(officialsLine()) && /Steward: Quill Varro/.test(officialsLine()), officialsLine());
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

// ---- a name finds a character by their own name (gamemode.js findByName) ------------------------------------------------
chars.get(LOST).online = false;   // one werewolf about: the beast's name alone found her
ok('"Werewolf" finds no one', findByName('Werewolf') === 0, findByName('Werewolf'));
ok('"Masked Person" finds no one', findByName('Masked Person') === 0, findByName('Masked Person'));
ok('"Raven Stormbrow" finds her in werewolf form', findByName('Raven Stormbrow') === RAVEN);
ok('"Quill" (the start of his name) finds him behind the mask', findByName('Quill') === QUILL);
ok('the #TAG still finds a beast', findByName('#RVN1') === RAVEN);
ok('/appoint by "Werewolf" names no one', !!O.officialTarget('Werewolf').error, O.officialTarget('Werewolf'));
chars.get(LOST).online = true;

// ---- /players (gamemode.js) ---------------------------------------------------------------------------------------------
const playersLine = (GM.match(/^registerChatCommand\('players', .*$/m) || [''])[0];
ok('/players is found', !!playersLine);
const playersCmd = new Map();
new Function('registerChatCommand', 'onlineActors', 'display', 'ownDisplay', 'personal', playersLine)((n, f) => playersCmd.set(n, f), online, display, ownDisplay, (a, t) => said.push({ a, t }));
said.length = 0; playersCmd.get('players')(VIEW, '');
const pl = said.map((s) => s.t).join(' ');
ok('/players lists the werewolf and the masks by their own names', /Raven Stormbrow #RVN1/.test(pl) && /Quill Varro #QVR1/.test(pl) && !/Werewolf|Vampire Lord|Masked Person/.test(pl), pl);

// ---- Inspect (playermenu.js) --------------------------------------------------------------------------------------------
P(VIEW, 'ff_knownIds', [RAVEN, QUILL]);
packets.length = 0; ui.get('playerAction')(VIEW, ['inspect', RAVEN]);
const lines = ((packets.find((x) => x.p.mode === 'inspect') || {}).p || {}).lines || [];
ok('Inspect on the werewolf shows the beast: no race, sex or office', lines[0] === 'Werewolf' && !lines.some((l) => /Woman|Man|Nord|Jarl/.test(l)), lines);
packets.length = 0; ui.get('playerAction')(VIEW, ['inspect', GUARD]);
const gl = ((packets.find((x) => x.p.mode === 'inspect') || {}).p || {}).lines || [];
ok('Inspect on someone plain is as it was', /^Man, Nord$/.test(gl[0] || ''), gl);

// ---- the Nobility tab (nobility.js) -------------------------------------------------------------------------------------
globalThis.__dboCourtFaction = (zid) => (zid === 'whiterun' ? 'hold-whiterun' : null);
require(path.join(ROOT, 'nobility.js'))(Object.assign({}, base, O, { every: () => {}, announce: () => {}, cfg: { nobility: { enabled: true, realms: { whiterun: 'skyrim' } } } }));
const nsec = globalThis.__dboJournalSections.nobility;
r = ev('nobilityGrant', RAVEN, 'N', 'whiterun', '#QVR1', 'thane', '');
ok('the werewolf Jarl names the masked Steward a Thane', r && r.kind === 'ok', r);
const hold = (nsec.view(VIEW).holds || []).find((x) => x.id === 'whiterun') || {};
ok('the Nobility tab names the ruler by her own name, not "Werewolf"', hold.ruler && hold.ruler.name === 'Raven Stormbrow', hold.ruler);
ok('the roll names the Thane by his own name, not "Masked Person"', (hold.roll || []).length === 1 && hold.roll[0].name === 'Quill Varro', hold.roll);
chars.get(QUILL).online = false;
const hold2 = (nsec.view(VIEW).holds || []).find((x) => x.id === 'whiterun') || {};
ok('offline, the roll keeps the own name written at the grant', (hold2.roll || [])[0] && hold2.roll[0].name === 'Quill Varro', hold2.roll);
chars.get(QUILL).online = true;

// ---- the ledger of contacts (ledger.js) ---------------------------------------------------------------------------------
const lcmd = {};
globalThis.__dboGuildsOf = () => [];
require(path.join(ROOT, 'ledger.js'))({
  mp: Object.assign({}, mp, { get: (id, k) => (k === 'pos' ? [0, 0, 0] : k === 'worldOrCellDesc' ? 'tamriel' : mp.get(id, k)) }),
  log: () => {}, personal: (a, t) => said.push({ a, t }), audit: () => {}, who, nameOf, tagOf, profileOf, onlineActors: online, ownNameOf,
  registerChatCommand: (n, f) => { lcmd[n] = f; }, isAdmin, isWorldspace: (w) => w === 'tamriel', metOf: (a) => (a === VIEW ? [RAVEN, QUILL, GUARD] : []),
  forgetMet: () => {}, sendPigeon: () => ({ ok: true, text: '' }), boardZoneNear: () => 'whiterun', zoneOfActor: () => ({ id: 'whiterun' }), cfg: {},
});
said.length = 0; lcmd.ledger(VIEW, '');
const book = said.map((s) => s.t).join('\n');
ok('the ledger lists contacts by their own names, not the beast\'s or the mask\'s', /Raven Stormbrow #RVN1/.test(book) && /Quill Varro #QVR1/.test(book) && !/Werewolf|Masked Person/.test(book), book);

// ---- every other roster and record that keeps a name -------------------------------------------------------------------
// Each line must name people by the own name; the module takes ownNameOf/ownDisplay from gamemode.js
const has = (f, re) => re.test(src(f));
const rows = [
  ['gamemode.js pigeon contacts', 'gamemode.js', /contacts\.push\(\{ id, name: ownNameOf\(id\)/],
  ['gamemode.js a letter is signed with the own name', 'gamemode.js', /let from = ownDisplay\(a\);/],
  ['gamemode.js modules get ownNameOf and ownDisplay (court)', 'gamemode.js', /require\(COURT_JS\)\(\{ mp, log, ownNameOf, ownDisplay,/],
  ['guilds.js invitations and their notices', 'guilds.js', /from: ownDisplay\(i\.from\)/],
  ['guilds.js the household\'s pending invitations', 'guilds.js', /name: ownNameOf\(Number\(t\) >>> 0\), from: ownNameOf\(i\.from\)/],
  ['dungeons.js the party panel', 'dungeons.js', /\{ id: x, name: ownNameOf\(x\), leader: m === p\.leader \}/],
  ['dungeons.js /party', 'dungeons.js', /\(x \? ownDisplay\(x\) : `#\$\{m\}`\) \+ \(m === p\.leader/],
  ['thalmor.js dossiers', 'thalmor.js', /name: String\(ownNameOf\(t\) \|\| ''\)/],
  ['couriers.js jobs', 'couriers.js', /senderName: ownNameOf\(a\)[\s\S]*recipientName: ownNameOf\(to\)[\s\S]*courierName: ownNameOf\(a\)/],
  ['post.js supply orders', 'post.js', /posterName: ownNameOf\(a\)/],
  ['charters.js founders', 'charters.js', /founder: \{ actor: a >>> 0, profile: prof, name: ownNameOf\(a\) \}/],
  ['commissions.js parties', 'commissions.js', /name: ownDisplay\(a\) \}\);/],
  ['tenancy.js landlord and tenant', 'tenancy.js', /tag: tagOf\(a\), name: ownDisplay\(a\) \}\);/],
  ['business.js owner, staff, renter, tax', 'business.js', /ownerName: ownDisplay\(a\)[\s\S]*setHoldTax\(zone, pct, ownDisplay\(a\)/],
  ['economy.js who set the tax', 'economy.js', /__dboSetHoldTax'\)\(zone, Math\.round\(pct\), ownDisplay\(a\)/],
];
for (const [label, f, re] of rows) ok(label, has(f, re));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
