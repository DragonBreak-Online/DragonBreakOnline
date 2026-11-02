// Druadach as territory (Nat via the Leader, 2 Nov: "do what you recommend"): its 17 towns, villages, forts and orc
// strongholds in territories.json, each at the Druadach map marker map-markers.json reveals; a druadach region by its
// worldspace in zones.json; each stronghold owned by a clan that exists, the rest unclaimed; no court for the new clans
// (a court is found by its zone, and six clans on one zone would make the first Druadach's law); a distinct map colour for
// each; and Druadach's dead waking at Markarth's temple, as they did before it had a zone. realm.js is then loaded with
// the real files to check the map packet and territoryAt. The mutants at the end run the same checks on altered copies of
// the data and must each fail.
//   node tests\druadach-territories-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(SERVER, f), 'utf8'));
const WORLD = '12c4:Druadach.esm';
let fails = 0;
const check = (what, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${ok || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!ok) fails++; };
const GM = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
const REALM = fs.readFileSync(path.join(SERVER, 'realm.js'), 'utf8');

const scenarios = (D, c) => {
  const dru = D.territories.territories.filter((t) => t.zone === 'druadach');
  const kinds = (k) => dru.filter((t) => t.kind === k).length;
  c('17 places in zone druadach: 2 towns, 3 villages, 6 forts, 6 strongholds', dru.length === 17 && kinds('town') === 2 && kinds('village') === 3 && kinds('fort') === 6 && kinds('stronghold') === 6, dru.map((t) => t.kind));
  c('each at a marker in Druadach\'s world, with a capture radius', dru.every((t) => t.marker && t.marker.world === WORLD && t.marker.radius > 0));
  // Druadach's author forbids AI work, so positions read from its plugin stay out of this public repo (Nat, 2 Nov)
  c('no Druadach position in the public file: they live in the private territory-positions.json', dru.every((t) => !('pos' in t.marker)));
  c('territory ids unique across the whole file', new Set(D.territories.territories.map((t) => t.id)).size === D.territories.territories.length);
  const clans = new Map(D.guilds.factions.map((f) => [f.id, f]));
  const strongholds = dru.filter((t) => t.kind === 'stronghold');
  c('each stronghold starts with a clan that exists, each its own', strongholds.every((t) => t.owner && clans.has(t.owner)) && new Set(strongholds.map((t) => t.owner)).size === 6, strongholds.map((t) => t.owner));
  c('Mor Khazgur\'s Druadach side is held by Clan Mor Khazgur, Skyrim\'s own', strongholds.some((t) => t.name === 'Mor Khazgur' && t.owner === 'clan-mor-khazgur'));
  c('towns, villages and forts start unclaimed', dru.filter((t) => t.kind !== 'stronghold').every((t) => !t.owner));
  const fresh = strongholds.map((t) => clans.get(t.owner)).filter((f) => f && f.id !== 'clan-mor-khazgur');
  c('the five new clans hold no court: not a hold or stronghold kind, so no zone\'s law is theirs', fresh.length === 5 && fresh.every((f) => f.kind !== 'hold' && f.kind !== 'stronghold'), fresh.map((f) => f.kind));
  c('...and no court faction anywhere names druadach as its zone', !D.guilds.factions.some((f) => (f.kind === 'hold' || f.kind === 'stronghold') && f.zone === 'druadach'));
  const region = (D.zones.regions || []).filter((r) => r.id === 'druadach');
  c('a druadach region, by Druadach\'s worldspace, guard only (as Solstheim)', region.length === 1 && JSON.stringify(region[0].worldspaces) === JSON.stringify([WORLD]) && JSON.stringify(region[0].officials) === '["guard"]', region);
  c('...the only zone on that worldspace', (D.zones.regions || []).filter((r) => (r.worldspaces || []).includes(WORLD)).length === 1);
  const byName = new Map(D.markers.markers.map((m) => [m.name, m]));
  c('each place is revealed on the map by its own Druadach marker, of its kind', dru.every((t) => { const m = byName.get(t.name); return m && /:Druadach\.esm$/.test(m.desc) && m.kind === t.kind; }), dru.filter((t) => !byName.get(t.name)).map((t) => t.name));
  c('map marker ids unique', new Set(D.markers.markers.map((m) => m.id)).size === D.markers.markers.length);
  // Druadach's dead wake at Markarth's temple (gamemode.js TEMPLE_DEFAULTS)
  c('Druadach shares Markarth\'s temple', /\n  druadach: 'markarth',\n/.test(D.gm));
  // the colours: each new clan its own, well apart from every other
  const tints = {};
  const m = D.realm.match(/const MAP_TINTS = \{([\s\S]*?)\n  \};/);
  if (m) for (const x of m[1].matchAll(/'([a-z-]+)': \[(\d+), (\d+), (\d+)\]/g)) tints[x[1]] = [Number(x[2]), Number(x[3]), Number(x[4])];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const gap = fresh.map((f) => (tints[f.id] ? Math.min(...Object.entries(tints).filter(([k]) => k !== f.id).map(([, v]) => dist(tints[f.id], v))) : 0));
  c('each new clan has a map colour at least 40 from every other', gap.length === 5 && gap.every((g) => g >= 40), gap.map(Math.round));
};

const DATA = { territories: read('territories.json'), zones: read('zones.json'), guilds: read('guild-defs.json'), markers: read('map-markers.json'), gm: GM, realm: REALM };
scenarios(DATA, check);

// realm.js with the real files: the map packet and territoryAt in Druadach
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'druadach-harness-'));
for (const f of ['territories.json', 'map-markers.json', 'zones.json']) fs.copyFileSync(path.join(SERVER, f), path.join(tmp, f));
const DRU_IDS = DATA.territories.territories.filter((t) => t.zone === 'druadach').map((t) => t.id);
// the private file, when this server has it: one position for each Druadach territory, and nothing else
if (fs.existsSync(path.join(SERVER, 'territory-positions.json'))) {
  const p = read('territory-positions.json').positions || {};
  check('this server\'s private territory-positions.json gives each Druadach territory a position, and only those', DRU_IDS.every((id) => Array.isArray(p[id]) && p[id].length === 3 && p[id].every(Number.isFinite)) && Object.keys(p).every((id) => DRU_IDS.includes(id)), Object.keys(p).length);
} else console.log('SKIP the private territory-positions.json is not here (it is gitignored; servers get it privately)');
process.chdir(tmp);
const clanIds = new Set(DATA.guilds.factions.map((f) => f.id));
globalThis.__dboGuildInfo = (id) => { const f = DATA.guilds.factions.find((x) => x.id === id); return f ? { name: f.name, kind: f.kind, zone: f.zone } : null; };
globalThis.__dboHoldFactionOf = (z) => { const f = DATA.guilds.factions.find((x) => x.kind === 'hold' && x.zone === z); return f ? f.id : null; };
globalThis.__dboGuildsOf = () => [];
const sent = [], handlers = new Map();
const realm = require(path.join(SERVER, 'realm.js'))({
  mp: { get: () => undefined, getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16), lookupEspmRecordById: () => null },
  log: () => {}, personal: () => {}, system: () => {}, audit: () => {}, who: (a) => `P${a}`, display: (a) => `P${a}`, cfg: {},
  onUi: (ev, fn) => handlers.set(ev, fn), registerChatCommand: () => {}, isAdmin: () => false, onlineActors: () => [], every: () => {},
  sendPacket: (a, p) => { sent.push(p); return true; }, ranksOf: () => [], profileOf: (a) => a, zoneById: () => null, readOfficials: () => ({}), writeOfficials: () => {},
});
handlers.get('uiCaps')(7, []);
const bare = sent.find((p) => p.customPacketType === 'dboMapOwners');
check('without the private positions Druadach is simply left out: no world, no territory', !!bare && !bare.worlds.some((w) => w.world === WORLD) && realm.territoryAt(WORLD, [0, 0, 0]) === null);
// synthetic positions (never Druadach's own): territory i at x = 20,000 i
fs.writeFileSync(path.join(tmp, 'territory-positions.json'), JSON.stringify({ positions: Object.fromEntries(DRU_IDS.map((id, i) => [id, [i * 20000, 0, 0]])) }));
sent.length = 0;
handlers.get('uiCaps')(7, []);
const pk = sent.find((p) => p.customPacketType === 'dboMapOwners');
const dw = pk && pk.worlds.find((w) => w.world === WORLD);
check('the map packet carries Druadach as a world of its own, 17 territories', !!dw && dw.territories.length === 17 && !dw.cells, dw && dw.territories.length);
const owned = dw ? dw.territories.filter((t) => t.owner !== 'unclaimed') : [];
check('...6 owned by clans, coloured; 11 unclaimed, uncoloured', owned.length === 6 && owned.every((t) => pk.factions[t.owner] && clanIds.has(t.owner)) && !pk.factions.unclaimed, owned.map((t) => t.owner));
const gi = DRU_IDS.indexOf('garshakur');
const at = gi >= 0 ? realm.territoryAt(WORLD, [gi * 20000 + 200, 0, 0]) : null;
check('a spot by Garshakur is Garshakur\'s; Druadach\'s land never reads as Tamriel\'s', !!at && at.id === 'garshakur' && realm.ownerOf('garshakur') === 'clan-garshakur');
check('a town starts with no owner', realm.ownerOf('orefell') === null || realm.ownerOf('orefell') === undefined, realm.ownerOf('orefell'));

const clone = (o) => JSON.parse(JSON.stringify(o));
const MUTANTS = [
  ['a new clan made a stronghold court of zone druadach', (d) => { const f = d.guilds.factions.find((x) => x.id === 'clan-garshakur'); f.kind = 'stronghold'; f.zone = 'druadach'; }],
  ['a town given an owner', (d) => { d.territories.territories.find((t) => t.id === 'orefell').owner = 'clan-garshakur'; }],
  ['the region left out', (d) => { d.zones.regions = d.zones.regions.filter((r) => r.id !== 'druadach'); }],
  ['a Druadach position back in the public file', (d) => { d.territories.territories.find((t) => t.id === 'ashlorn').marker.pos = [1, 2, 3]; }],
  ['a place on Tamriel\'s world', (d) => { d.territories.territories.find((t) => t.id === 'ashlorn').marker.world = '3c:Skyrim.esm'; }],
  ['Mor Khazgur given a new clan', (d) => { d.territories.territories.find((t) => t.name === 'Mor Khazgur' && t.zone === 'druadach').owner = 'clan-garshak'; }],
  ['a clan with no colour', (d) => { d.realm = d.realm.replace("'clan-malgorath': [20, 150, 140]", ''); }],
  ['no temple for Druadach', (d) => { d.gm = d.gm.replace("  druadach: 'markarth',\n", ''); }],
  ['a place not revealed on the map', (d) => { d.markers.markers = d.markers.markers.filter((m) => m.name !== 'Voshlakbur'); }],
];
for (const [name, mutate] of MUTANTS) {
  const d = { territories: clone(DATA.territories), zones: clone(DATA.zones), guilds: clone(DATA.guilds), markers: clone(DATA.markers), gm: GM, realm: REALM };
  let bad = 0;
  try { mutate(d); scenarios(d, (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
