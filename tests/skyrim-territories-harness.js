// Skyrim's territories in territories.json (Nate, 16 Oct, after Skyrim opened: the nine hold capitals, the main towns and
// forts, the orc strongholds), checked as data against tests/fixtures/skyrim-territory-markers.json (each map marker REFR
// read from the live load order), zones.json and guild-defs.json; then realm.js with a mock api: the nearest marker is per
// worldspace, the five walled cities count as Tamriel, and the Realm panel lists only the land of the map the client has.
//
//   node tests/skyrim-territories-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const TF = JSON.parse(fs.readFileSync(path.join(SERVER, 'territories.json'), 'utf8'));
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'skyrim-territory-markers.json'), 'utf8')).markers;
const ZONES = JSON.parse(fs.readFileSync(path.join(SERVER, 'zones.json'), 'utf8'));
const DEFS = JSON.parse(fs.readFileSync(path.join(SERVER, 'guild-defs.json'), 'utf8'));

let fail = 0, n = 0;
const ok = (c, what, extra) => { n++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || extra === undefined ? '' : ': ' + JSON.stringify(extra)}`); if (!c) fail++; };

const TAMRIEL = '3c:Skyrim.esm', CYRODIIL = 'a764b:BSHeartland.esm';
const T = TF.territories;
const SK = T.filter((t) => t.marker && t.marker.world === TAMRIEL);
const factions = new Map(DEFS.factions.map((f) => [f.id, f]));
const holds = new Map(ZONES.holds.map((z) => [z.id, z]));
const strongholds = new Map(ZONES.strongholds.map((z) => [z.id, z]));
const zoneIds = new Set([...holds.keys(), ...strongholds.keys(), ...ZONES.regions.map((z) => z.id)]);

// ---- 1. the set Nate approved ----
const CAPITALS = ['whiterun', 'riften', 'solitude', 'windhelm', 'markarth', 'falkreath', 'morthal', 'dawnstar', 'winterhold'];
const TOWNS = ['riverwood', 'rorikstead', 'ivarstead', 'shors-stone', 'dragon-bridge', 'karthwasten', 'kynesgrove', 'old-hroldan'];
const STRONGHOLDS = ['largashbur', 'narzulbur', 'dushnikh-yal', 'mor-khazgur', 'gol-kharzum', 'cracked-tusk-keep'];
const byId = new Map(T.map((t) => [t.id, t]));
ok(new Set(T.map((t) => t.id)).size === T.length, 'every territory id is unique');
for (const id of CAPITALS) ok(byId.get(id) && byId.get(id).kind === 'capital' && byId.get(id).zone === id, `${id} is its hold's capital`, byId.get(id));
for (const id of TOWNS) ok(byId.get(id) && ['town', 'village'].includes(byId.get(id).kind), `${id} is a town or village`, byId.get(id) && byId.get(id).kind);
for (const id of STRONGHOLDS) ok(byId.get(id) && byId.get(id).kind === 'stronghold', `${id} is a stronghold`);
const forts = SK.filter((t) => t.kind === 'fort');
ok(forts.length >= 9 && forts.length <= 18, 'one or two forts per hold', forts.length);
for (const z of holds.keys()) { const k = forts.filter((t) => t.zone === z).length; ok(k >= 1 && k <= 2, `${z} has one or two forts`, k); }
ok(!byId.get('helgen'), 'Helgen is left out (a ruin here: Helgen Reborn rebuilds it only through its quests)');

// ---- 2. every Skyrim territory stands at a real map marker in Tamriel ----
for (const t of SK) {
  const f = FIX[t.id];
  ok(!!f, `${t.id} has its map marker in the fixture`);
  if (!f) continue;
  ok(Array.isArray(t.marker.pos) && t.marker.pos.length === 3 && t.marker.pos.join() === f.pos.join(), `${t.id} stands at its marker ${f.marker}`, [t.marker.pos, f.pos]);
  ok(f.world === 'Tamriel' || Object.keys(TF.worldAliases || {}).some((w) => TF.worldAliases[w] === TAMRIEL && { '1a26f': 'WhiterunWorld', '16bb4': 'RiftenWorld', '37edf': 'SolitudeWorld', '1691d': 'WindhelmWorld', '16d71': 'MarkarthWorld' }[w.split(':')[0]] === f.world),
    `${t.id}'s marker is in Tamriel or a walled city drawn in its coordinates`, f.world);
  ok(t.icon === f.tnam, `${t.id}'s icon is its marker's type`, [t.icon, f.tnam]);
  ok(t.marker.radius === 1500, `${t.id} has Bruma's capture radius`);
  ok(f.name === t.name, `${t.id} is named as its marker is`, [t.name, f.name]);
  ok(t.id === 'gol-kharzum' ? !t.location : typeof t.location === 'string' && /Location$/.test(t.location), `${t.id} names its location record`, t.location);
  // The marker is in Skyrim's bounds, not Cyrodiil's (a slip of worldspace would put it on the wrong map)
  ok(Math.abs(t.marker.pos[0]) < 250000 && Math.abs(t.marker.pos[1]) < 200000, `${t.id} lies inside Skyrim`);
}
ok(Object.keys(FIX).every((id) => byId.has(id)), 'the fixture lists only territories the file has', Object.keys(FIX).filter((id) => !byId.has(id)));

// ---- 3. zones, capitals, icons, owners ----
for (const t of T) {
  ok(zoneIds.has(t.zone), `${t.id}'s zone ${t.zone} is in zones.json`);
  ok(Number.isInteger(t.icon), `${t.id}'s icon is an integer`, t.icon);
}
const capsBy = new Map();
for (const t of T.filter((x) => x.kind === 'capital')) capsBy.set(t.zone, (capsBy.get(t.zone) || []).concat([t.id]));
ok([...capsBy.values()].every((v) => v.length === 1), 'no zone has two capitals', [...capsBy.entries()]);
ok([...holds.keys()].every((z) => capsBy.has(z)), 'every hold of Skyrim has its capital');
ok(SK.filter((t) => t.kind === 'capital').every((t) => holds.has(t.zone)), 'a capital is a hold\'s');
ok(!SK.some((t) => t.owner === 'imperial-legion'), 'the Legion holds nothing in Skyrim (it withdrew, 4E 211)');
for (const t of SK.filter((x) => x.kind !== 'stronghold')) ok(t.owner === undefined && holds.has(t.zone), `${t.id} starts with its hold (no owner set)`);
for (const t of SK.filter((x) => x.kind === 'stronghold')) {
  const clan = factions.get(t.owner);
  ok(!!clan && clan.kind === 'stronghold' && clan.zone === t.zone && strongholds.has(t.zone), `${t.id} starts with its clan`, t.owner);
}
// A capital's seat cells are its Jarl's hall (guild-defs.json), so the court musters in its palace
for (const t of SK.filter((x) => x.kind === 'capital')) {
  const hall = [...factions.values()].find((f) => f.kind === 'hold' && f.zone === t.zone).hall;
  ok(Array.isArray(t.seatCells) && t.seatCells.join() === hall.cells.join(), `${t.id}'s seat cells are ${hall.name}`);
}
// Lore holds where zones.json's nearest-capital rule disagrees (the comment names them)
for (const [id, zone] of [['rorikstead', 'whiterun'], ['ivarstead', 'riften'], ['fort-sungard', 'markarth'], ['fort-kastav', 'winterhold']]) {
  ok(byId.get(id).zone === zone && FIX[id].nearestCapital !== zone && TF._comment.includes(byId.get(id).name), `${id} is in ${zone} by lore, and the comment says so`);
}
for (const t of SK.filter((x) => x.kind !== 'stronghold' && !['rorikstead', 'ivarstead', 'fort-sungard', 'fort-kastav'].includes(x.id))) {
  ok(FIX[t.id].nearestCapital === t.zone, `${t.id}'s hold is also its nearest capital's`, [t.zone, FIX[t.id].nearestCapital]);
}

// ---- 4. realm.js: worldspaces, the walled cities, the panel ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-territories-harness-'));
fs.copyFileSync(path.join(SERVER, 'territories.json'), path.join(tmp, 'territories.json'));
const cwd = process.cwd();
process.chdir(tmp);
const PLUGIN = { 'skyrim.esm': 0, 'bsheartland.esm': 0x0b000000 };
globalThis.__dboHoldFactionOf = (z) => (holds.has(z) ? `hold-${z}` : z === 'bruma' ? 'county-bruma' : null);
globalThis.__dboGuildInfo = (id) => (factions.has(id) ? { id, name: factions.get(id).name, kind: factions.get(id).kind, zone: factions.get(id).zone || '' } : id === 'county-bruma' ? { id, name: 'County of Bruma', kind: 'hold', zone: 'bruma' } : null);
globalThis.__dboGuildsOf = () => [];
const api = (cfg) => ({
  mp: { get: () => undefined, getIdFromDesc: (d) => { const [h, p] = String(d).split(':'); if (!(String(p).toLowerCase() in PLUGIN)) throw new Error(`${p} not found`); return (parseInt(h, 16) + PLUGIN[String(p).toLowerCase()]) >>> 0; } },
  log: () => {}, personal: () => {}, system: () => {}, audit: () => {}, who: (a) => `P${a}`, display: (a) => `P${a}`, cfg,
  onUi: () => {}, registerChatCommand: () => {}, isAdmin: () => false, onlineActors: () => [], every: () => {}, sendPacket: () => true,
  ranksOf: () => [], profileOf: (a) => a, zoneById: () => null, readOfficials: () => ({}), writeOfficials: () => {},
});
const REALM = path.join(SERVER, 'realm.js');
const load = (cfg) => { delete require.cache[REALM]; delete globalThis.__dboRealm; return require(REALM)(api(cfg)); };
let realm = load({});
const at = (w, p) => (realm.territoryAt(w, p) || { id: null }).id;
ok(at(TAMRIEL, [22000, -45500, 0]) === 'riverwood', 'a point by Riverwood is Riverwood\'s');
ok(at(TAMRIEL, [-145000, -22000, 0]) === 'dushnikh-yal', 'a point by Dushnikh Yal is the clan\'s');
ok(at('1a26f:Skyrim.esm', [19855, -7423, 0]) === 'whiterun', 'a point inside Whiterun\'s walls (WhiterunWorld) is Whiterun\'s');
ok(at('16d71:Skyrim.esm', [-174024, 5255, 0]) === 'markarth', 'and inside Markarth (MarkarthWorld) Markarth\'s');
ok(at(CYRODIIL, [36000, 210000, 0]) === 'applewatch', 'Cyrodiil keeps its own land: a point there is never Skyrim\'s');
ok(SK.every((t) => at(CYRODIIL, t.marker.pos) && !SK.some((x) => x.id === at(CYRODIIL, t.marker.pos))), 'no Skyrim marker owns a point in Cyrodiil');
ok(at('2d4e4:Skyrim.esm', [0, 0, 0]) === null, 'an interior cell is no territory');
ok(realm.ownerOf('fort-greymoor') === 'hold-whiterun' && realm.ownerOf('whiterun') === 'hold-whiterun' && realm.ownerOf('rorikstead') === 'hold-whiterun', 'Skyrim\'s land starts with its holds');
ok(realm.ownerOf('largashbur') === 'clan-largashbur' && realm.ownerOf('cracked-tusk-keep') === 'clan-cracked-tusk', 'a stronghold starts with its clan');
ok(realm.ownerOf('fort-caractacus') === 'imperial-legion', 'Cyrodiil\'s forts stay the Legion\'s');
ok(realm.holdCapital('whiterun').id === 'whiterun' && realm.holdCapital('winterhold').id === 'winterhold', 'each hold\'s capital is its city');
const ids = (v) => v.territories.map((t) => t.id).sort().join();
ok(ids(realm.realmView(1)) === T.filter((t) => t.marker.world === CYRODIIL).map((t) => t.id).sort().join(), 'the Realm panel lists only Bruma\'s land (the map the client has)');
realm = load({ war: { mapWorlds: [CYRODIIL, TAMRIEL] } });
ok(realm.realmView(1).territories.length === T.length, 'with Tamriel in war.mapWorlds the panel lists Skyrim too');
{
  const v = realm.realmView(1).territories;
  ok(v.every((t) => t.mapWorld === (t.world === CYRODIIL ? CYRODIIL : TAMRIEL)), 'every territory is sent with the mapWorld it is drawn on', v.filter((t) => !t.mapWorld).map((t) => t.id));
}
realm = load({ war: { mapWorlds: [] } });
ok(realm.realmView(1).territories.length === T.length, 'and an empty war.mapWorlds lists every worldspace');
process.chdir(cwd);
fs.rmSync(tmp, { recursive: true, force: true });

console.log(fail ? `${fail} of ${n} checks FAILED` : `all ${n} checks passed`);
process.exit(fail ? 1 : 0);
