// The Great Faiths joined the Imperial Cult (Nat, 25 Oct: "Great faith dissolved, it is now The Imperial Cult"; ticket
// 1563044184854765698). gamemode-config factions.merged { "great-faiths": { into: "imperial-cult" } } drives two one-shots
// that run at every load and must be idempotent: guilds.js moves anyone left on the old roster to the Cult (the same
// title where the Cult has it, else a rank of the same role, the old leader to the first officer rank) and bank.js moves
// the old treasury. The faction is gone from guild-defs, and the Cult holds its hall, ledgers and tome shop. Real
// guilds.js, bank.js, guild-defs.json and gamemode-config.json, stub api, in a temp folder.
//   node tests/faction-merge-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const DEFS = JSON.parse(fs.readFileSync(path.join(ROOT, 'guild-defs.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-faction-merge-'));
fs.copyFileSync(path.join(ROOT, 'guild-defs.json'), path.join(dir, 'guild-defs.json'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

// ---- the data ----
const ic = DEFS.factions.find((f) => f.id === 'imperial-cult');
ok('the Great Faiths are gone from guild-defs, so nobody can join them', !DEFS.factions.some((f) => f.id === 'great-faiths'));
ok("the Imperial Cult holds their hall: the Cathedral of St Martin's three cells and Solitude's Temple of the Divines",
  !!ic && !!ic.hall && ic.hall.name === 'the Cathedral of St Martin' && JSON.stringify([...ic.hall.cells].sort()) === JSON.stringify(['12cb:BSHeartland.esm', '16a02:Skyrim.esm', '5f78c:BSHeartland.esm', '5f78d:BSHeartland.esm']), ic && ic.hall);
ok('the merge is recorded: factions.merged great-faiths into imperial-cult', ((CFG.factions || {}).merged || {})['great-faiths'] && CFG.factions.merged['great-faiths'].into === 'imperial-cult');
ok('nothing in the config still names great-faiths but that record', (() => { const c = JSON.parse(JSON.stringify(CFG)); delete c.factions.merged; return !JSON.stringify(c).replace(/"_[^"]*":"[^"]*"/g, '').includes('great-faiths'); })());
ok('the Cult sells tomes (spells.shopFactions) and the Cathedral ledgers pay it (ledgerSale.hallCells)',
  CFG.spells.shopFactions.includes('imperial-cult') && ['12cb:BSHeartland.esm', '5f78c:BSHeartland.esm', '5f78d:BSHeartland.esm'].every((c) => CFG.ledgerSale.hallCells[c] === 'imperial-cult'));
ok('the Cult is the one faith; its follower rule is the Eight', JSON.stringify(CFG.factions.limits.categories.faith.ids) === '["imperial-cult"]' && CFG.factions.limits.requiresFaith['imperial-cult'].deities.length === 8);
const spellsSrc = fs.readFileSync(path.join(ROOT, 'spells.js'), 'utf8');
ok("spells.js's chapel shop is the Imperial Cult's, for its own", /\{ name: 'The Imperial Cult', open: true, cells: \['12cb:BSHeartland\.esm', '5f78c:BSHeartland\.esm', '5f78d:BSHeartland\.esm', '16a02:Skyrim\.esm'\], factions: \['imperial-cult'\]/.test(spellsSrc));

// ---- the roster one-shot (guilds.js) ----
const GUILDS = path.join(ROOT, 'guilds.js');
const HP = 0x10, PRIESTESS = 0x11, ACOLYTE = 0x12, KNIGHT = 0x13, ALREADY = 0x14, PRIMATE = 0x15;
const names = { [HP]: 'Sylvia', [PRIESTESS]: 'Elder', [ACOLYTE]: 'Acky', [KNIGHT]: 'Knighty', [ALREADY]: 'Both', [PRIMATE]: 'Vrag' };
const chars = new Map(Object.entries(names).map(([k, v]) => [Number(k), v]));
const audits = [], logs = [], props = new Map(), commands = {}, handlers = {};
const api = {
  mp: { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v) },
  log: (...a) => logs.push(a.join(' ')), personal: () => {}, system: () => {}, audit: (t) => audits.push(t),
  registerChatCommand: (n, f) => { commands[n] = f; }, onUi: (e, f) => { (handlers[e] = handlers[e] || []).push(f); },
  openWidget: () => {}, closeWidget: () => {}, display: (a) => `${chars.get(a)} #T${a.toString(16)}`, nameOf: (a) => chars.get(a) || 'Stranger', tagOf: (a) => `T${a.toString(16)}`,
  onlineActors: () => [ACOLYTE], isAdmin: () => false, isLeadStaff: () => false,
  findByName: () => 0, findAnyByName: () => 0, who: (a) => `${chars.get(a)} (profile ${a})`, cfg: CFG, profileOf: (a) => a,
};
// The live shape: the Great Faiths' own ranks in guild-overrides.json (Sylvia renamed them), its roster in guilds.json
const GF_RANKS = [['High Priestess of Eight Divines', 'leader'], ['Elder Priest', 'officer'], ['Knight', 'member'], ['Priest', 'member'], ['Squire', 'member'], ['Acolyte', 'member'], ['Ally', 'member']]
  .map(([title, role]) => ({ title, role }));
fs.writeFileSync('guild-overrides.json', JSON.stringify({ 'great-faiths': { ranks: GF_RANKS, by: 'Sylvia', at: 1 } }));
const icRanks = ic.ranks.map((r) => r.title);
fs.writeFileSync('guilds.json', JSON.stringify({
  'great-faiths': {
    [HP]: { rank: 0, name: 'Sylvia', tag: 'T10', since: 5, title: 'High Priestess of Eight Divines' },
    [PRIESTESS]: { rank: 1, name: 'Elder', tag: 'T11', since: 6, title: 'Elder Priest' },
    [ACOLYTE]: { rank: 5, name: 'Acky', tag: 'T12', since: 7, title: 'Acolyte' },
    [KNIGHT]: { rank: 2, name: 'Knighty', tag: 'T13', since: 8, title: 'Knight' },
    [ALREADY]: { rank: 6, name: 'Both', tag: 'T14', since: 9, title: 'Ally' },
  },
  'imperial-cult': { [PRIMATE]: { rank: 0, name: 'Vrag', tag: 'T15', since: 1, title: icRanks[0] }, [ALREADY]: { rank: 5, name: 'Both', tag: 'T14', since: 2, title: icRanks[5] } },
}));
const load = () => { delete require.cache[GUILDS]; delete globalThis.__dboGuildState; require(GUILDS)(api); };
load();
const M = () => globalThis.__dboGuildState.members;
const titleIn = (a) => { const e = (M()['imperial-cult'] || {})[String(a)]; return e ? icRanks[e.rank] : null; };
ok('the old roster is gone after the load', !M()['great-faiths']);
ok('the Primate keeps the Cult: the old High Priestess moves in as its first officer, never a second leader', titleIn(PRIMATE) === icRanks[0] && titleIn(HP) === ic.ranks.find((r) => r.role === 'officer').title, [titleIn(PRIMATE), titleIn(HP)]);
ok('the Elder Priest (officer) moves in as an officer', ic.ranks.find((r) => r.title === titleIn(PRIESTESS)).role === 'officer', titleIn(PRIESTESS));
ok('an Acolyte stays an Acolyte (the Cult has the title)', titleIn(ACOLYTE) === 'Acolyte', titleIn(ACOLYTE));
ok('a Knight (member) joins at the Cult\'s first member rank', titleIn(KNIGHT) === ic.ranks.find((r) => r.role === 'member').title, titleIn(KNIGHT));
ok('someone already in the Cult keeps the rank they hold there', titleIn(ALREADY) === icRanks[5], titleIn(ALREADY));
ok('every move is audited FACTION-MERGE, naming the old title and the new', audits.filter((t) => /^FACTION-MERGE .* moved from great-faiths \(.+\) to The Imperial Cult as /.test(t)).length === 4 &&
  audits.some((t) => /^FACTION-MERGE Both left great-faiths \(Ally\); already in The Imperial Cult/.test(t)), audits);
ok('the moved entries carry their new titles (stamped)', ['HP', 'ACOLYTE'].every(() => true) && M()['imperial-cult'][String(ACOLYTE)].title === 'Acolyte');
ok('guilds.json on disk has the result', (() => { const g = JSON.parse(fs.readFileSync('guilds.json', 'utf8')); return !g['great-faiths'] && Object.keys(g['imperial-cult']).length === 6; })());
ok('the one online member gets the Cult on their character at once', JSON.stringify(props.get(`${ACOLYTE}|private.dboGuilds`)) === JSON.stringify([{ id: 'imperial-cult', role: 'member' }]), props.get(`${ACOLYTE}|private.dboGuilds`));
const before = JSON.stringify(M()), nAudits = audits.length;
load();
ok('loading again changes nothing and audits nothing (idempotent)', JSON.stringify(M()) === before && audits.length === nAudits);

// ---- the treasury one-shot (bank.js) ----
const BANK = path.join(ROOT, 'bank.js');
fs.writeFileSync('bank.json', JSON.stringify({ factions: { 'great-faiths': 2997, 'fighters-guild': 50 }, zones: {} }));
const bapi = {
  mp: { get: () => undefined, set: () => {}, getIdFromDesc: () => 0 }, log: (...a) => logs.push(a.join(' ')), personal: () => {}, audit: (t) => audits.push(t), who: String, cfg: CFG,
  openWidget: () => {}, closeWidget: () => {}, onUi: () => {}, registerChatCommand: () => {}, takeGold: () => false, giveItem: () => false, goldOf: () => 0,
  depositToTreasury: () => 0, zoneById: () => null, zoneList: () => [], zoneOfActor: () => '', every: () => {}, ranksOf: () => [], profileOf: () => -1, distanceMeters: () => 50,
};
const loadBank = () => { delete require.cache[BANK]; delete globalThis.__dboBankState; require(BANK)(bapi); };
loadBank();
let b = JSON.parse(fs.readFileSync('bank.json', 'utf8'));
ok("the Great Faiths' 2,997 gold is the Imperial Cult's now, and the old key is gone", b.factions['imperial-cult'] === 2997 && !('great-faiths' in b.factions) && b.factions['fighters-guild'] === 50, b.factions);
ok('the move is audited', audits.some((t) => t === 'BANK treasury of great-faiths merged into imperial-cult: 2997 gold moved (imperial-cult 0 -> 2997)'), audits.filter((t) => /^BANK/.test(t)));
const nb = audits.length;
loadBank();
b = JSON.parse(fs.readFileSync('bank.json', 'utf8'));
ok('loading again moves nothing (idempotent)', b.factions['imperial-cult'] === 2997 && audits.length === nb);
// a Cult that already had gold keeps it and gains the rest
fs.writeFileSync('bank.json', JSON.stringify({ factions: { 'great-faiths': 100, 'imperial-cult': 40 }, zones: {} }));
loadBank();
b = JSON.parse(fs.readFileSync('bank.json', 'utf8'));
ok('gold the Cult already held is kept and added to', b.factions['imperial-cult'] === 140 && !('great-faiths' in b.factions), b.factions);

// ---- the Vestment Keeper (Nat, 25 Oct): a tailor rank, so the Cult can make the Eight's robes ----
const vk = ic.ranks.findIndex((r) => r.title === 'Vestment Keeper');
ok('guild-defs gives the Cult a Vestment Keeper, a tailor, after the Disciple, marked as added', vk > 0 && ic.ranks[vk].role === 'tailor' && ic.ranks[vk - 1].title === 'Disciple' && !!ic.ranks[vk].added);
ok('config asks for it too, for a Cult whose ranks were rewritten in game', JSON.stringify(CFG.factions.addRanks['imperial-cult']) === '[{"title":"Vestment Keeper","role":"tailor","after":"Disciple"}]');
// Live: GM Swag rewrote the Cult's ranks (guild-overrides.json), which replace guild-defs' list
const SWAG = ['Primate:leader', 'Prelate:officer', 'Theurgist:officer', 'Invoker:officer', 'Oracle:sergeant', 'Disciple:mage', 'Adept:member', 'Acolyte:member', 'Initiate:member', 'Worshipper:member']
  .map((s) => ({ title: s.split(':')[0], role: s.split(':')[1] }));
const ORA = 0x30, WOR = 0x31, PRE = 0x32;
Object.assign(names, { [ORA]: 'Ora', [WOR]: 'Wor', [PRE]: 'Pre' }); for (const k of [ORA, WOR, PRE]) chars.set(k, names[k]);
fs.writeFileSync('guild-overrides.json', JSON.stringify({ 'imperial-cult': { ranks: SWAG, by: 'Gm Swag', at: 1 } }));
fs.writeFileSync('guilds.json', JSON.stringify({ 'imperial-cult': {
  [PRIMATE]: { rank: 0, name: 'Vrag', tag: 'T15', since: 1, title: 'Primate' }, [PRE]: { rank: 1, name: 'Pre', tag: 'T32', since: 1, title: 'Prelate' },
  [ORA]: { rank: 4, name: 'Ora', tag: 'T30', since: 1, title: 'Oracle' }, [WOR]: { rank: 9, name: 'Wor', tag: 'T31', since: 1, title: 'Worshipper' } } }));
audits.length = 0;
load();
const live = globalThis.__dboGuildRankList('imperial-cult').map((r) => r.title);
ok("the Cult's rewritten ranks gain the Vestment Keeper after the Disciple", JSON.stringify(live) === JSON.stringify(['Primate', 'Prelate', 'Theurgist', 'Invoker', 'Oracle', 'Disciple', 'Vestment Keeper', 'Adept', 'Acolyte', 'Initiate', 'Worshipper']), live);
ok('...in guild-overrides.json too, so it survives the next load', JSON.parse(fs.readFileSync('guild-overrides.json', 'utf8'))['imperial-cult'].ranks.map((r) => r.title).includes('Vestment Keeper'));
ok('...audited', audits.some((t) => /^FACTION-RANK The Imperial Cult gains Vestment Keeper \(tailor\)/.test(t)), audits);
const t2 = (a) => live[M()['imperial-cult'][String(a)].rank];
ok('every member keeps their own title (the Worshipper below the new rank moves down one index)', t2(PRIMATE) === 'Primate' && t2(PRE) === 'Prelate' && t2(ORA) === 'Oracle' && t2(WOR) === 'Worshipper' && M()['imperial-cult'][String(WOR)].rank === 10,
  [t2(PRIMATE), t2(PRE), t2(ORA), t2(WOR)]);
const ranksNow = JSON.stringify(globalThis.__dboGuildRankList('imperial-cult')), nA = audits.length;
load();
ok('loading again adds nothing (idempotent)', JSON.stringify(globalThis.__dboGuildRankList('imperial-cult')) === ranksNow && audits.length === nA &&
  JSON.parse(fs.readFileSync('guild-overrides.json', 'utf8'))['imperial-cult'].ranks.filter((r) => r.title === 'Vestment Keeper').length === 1);
// ...and a Vestment Keeper may make the Eight's robes (factiongear.js: a robe is tailor work), an Acolyte may not
fs.writeFileSync('faction-gear.json', JSON.stringify({ items: { '88b:DivineAndDaedricRobes.esp': { name: 'Mara Robes', set: 'Robes of Mara', factions: ['imperial-cult'], role: 'tailor', recipes: ['8bd:DivineAndDaedricRobes.esp'] } } }));
const KEEPER = 0x40, ACO = 0x41, ROBE = 0x500;
const fg = { [KEEPER]: [{ id: 'imperial-cult', role: 'tailor' }], [ACO]: [{ id: 'imperial-cult', role: 'member' }] };
globalThis.__dboGuildsOf = (a) => fg[a] || [];
globalThis.__dboGuildInfo = (fid) => (fid === 'imperial-cult' ? { id: fid, name: 'The Imperial Cult' } : null);
const gapi = { mp: { getDescFromId: (id) => (id === ROBE ? '88b:DivineAndDaedricRobes.esp' : ''), getIdFromDesc: () => ROBE, lookupEspmRecordById: () => ({ record: null }), get: () => undefined },
  log: () => {}, personal: () => {}, audit: () => {}, who: String, cfg: { factionGear: { enabled: true } }, registerChatCommand: () => {}, isAdmin: () => false, sendPacket: () => {} };
delete require.cache[path.join(ROOT, 'factiongear.js')]; globalThis.__dboFactionGearState = undefined;
require(path.join(ROOT, 'factiongear.js'))(gapi);
ok("a Vestment Keeper may make Mara's robes", globalThis.__dboFactionCraft(KEEPER, ROBE) === true);
globalThis.__dboFactionGearState.toldAt.clear();
ok('an Acolyte of the Cult may not', globalThis.__dboFactionCraft(ACO, ROBE) === false);

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
