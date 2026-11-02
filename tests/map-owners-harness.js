// realm.js's map owners packet (dboMapOwners; client mapOwners.ts draws it over the M map): each world's territories with
// their owners and markers, the walled cities' worlds folded into Tamriel's, the owners' colours (war.mapTints, else the
// palette, else a steady colour from the id), the realm markers' true positions read from their records, and one packet
// to everyone online after a burst of owner changes. The mutants at the end run the same checks on altered copies of
// realm.js and must each fail. Run it from this folder's parent:
//
//   node tests\map-owners-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const REALM_SRC = fs.readFileSync(path.join(SERVER, 'realm.js'), 'utf8');
const TERRITORIES = JSON.parse(fs.readFileSync(path.join(SERVER, 'territories.json'), 'utf8'));
// one territory inside a walled city's own worldspace, which the map draws in Tamriel's
TERRITORIES.territories.push({ id: 'harness-city', name: 'Harness Keep', zone: 'whiterun', kind: 'town', marker: { world: Object.keys(TERRITORIES.worldAliases)[0], pos: [20000, -7000, 0], radius: 500 } });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'map-owners-harness-'));
fs.writeFileSync(path.join(tmp, 'territories.json'), JSON.stringify(TERRITORIES));
fs.writeFileSync(path.join(tmp, 'map-markers.json'), JSON.stringify({ markers: [
  { id: 'bruma', kind: 'capital', name: 'Castle Bruma', desc: '757ff:BSHeartland.esm' },
  { id: 'whiterun', kind: 'capital', name: 'Dragonsreach', desc: '162ce:Skyrim.esm' },
  { id: 'nowhere', kind: 'town', name: 'No Record', desc: '1c390:Skyrim.esm' },
] }));
process.chdir(tmp);

let failures = 0;
const check = (what, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${ok || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!ok) failures++; };

// a REFR record whose DATA is position then rotation, six floats
const refr = (x, y, z) => { const d = new Uint8Array(24); const v = new DataView(d.buffer); [x, y, z, 0, 0, 0].forEach((f, i) => v.setFloat32(i * 4, f, true)); return { record: { type: 'REFR', fields: [{ type: 'NAME', data: new Uint8Array(4) }, { type: 'DATA', data: d }] } }; };
const RECORDS = new Map([[0x757ff + 0x2000000, refr(-1000.5, 2000.25, 300)], [0x162ce, refr(19855, -7423, -3583)]]);

const scenarios = (src, c) => {
  const file = path.join(tmp, 'realm.mutant.js');
  fs.writeFileSync(file, src);
  delete require.cache[file];
  // a fresh owners file each run
  try { fs.unlinkSync(path.join(tmp, 'territory-owners.json')); } catch (e) { /* none */ }
  delete globalThis.__dboRealm;
  const sent = [], logs = [], handlers = new Map(), timers = [];
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  globalThis.__dboGuildInfo = (id) => ({ 'county-bruma': { name: 'County of Bruma', kind: 'hold' }, 'imperial-legion': { name: 'Imperial Legion' }, 'fighters-guild': { name: 'Fighters Guild' }, 'pack-red': { name: 'The Red Pack' } }[id] || null);
  globalThis.__dboHoldFactionOf = (z) => (z === 'bruma' ? 'county-bruma' : `hold-${z}`);
  globalThis.__dboGuildsOf = () => [];
  const online = [7, 8];
  const api = {
    mp: {
      get: () => undefined,
      getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) + (/BSHeartland/i.test(d) ? 0x2000000 : 0),
      lookupEspmRecordById: (id) => RECORDS.get(id) || null,
    },
    log: (...x) => logs.push(x.join(' ')), personal: () => {}, system: () => {}, audit: () => {}, who: (a) => `P${a}`, display: (a) => `P${a}`,
    cfg: { war: { mapTints: { 'fighters-guild': [1, 2, 3] } } }, onUi: (ev, fn) => handlers.set(ev, fn), registerChatCommand: () => {},
    isAdmin: () => false, onlineActors: () => online.slice(), every: () => {}, sendPacket: (a, p) => { sent.push([a, p]); return true; },
    ranksOf: () => [], profileOf: (a) => a, zoneById: () => null, readOfficials: () => ({}), writeOfficials: () => {},
  };
  let realm;
  try { realm = require(file)(api); } catch (e) { c('realm.js loads', false, e.message); global.setTimeout = realSetTimeout; return; }
  try {
    handlers.get('uiCaps')(7, []);
    const pk = sent.find((x) => x[1].customPacketType === 'dboMapOwners');
    c('a client announcing its caps gets the map owners too', !!pk && pk[0] === 7);
    if (!pk) return;
    const p = pk[1];
    const tam = p.worlds.find((w) => w.world === '3c:Skyrim.esm'), bru = p.worlds.find((w) => w.world === 'a764b:BSHeartland.esm');
    const withMarker = TERRITORIES.territories.filter((t) => t.marker && Array.isArray(t.marker.pos));
    c('Tamriel and Bruma, each territory once, at its marker', !!tam && !!bru && p.worlds.length === 2 && tam.territories.length + bru.territories.length === withMarker.length
      && withMarker.every((t) => p.worlds.some((w) => w.territories.some((x) => x.id === t.id && x.x === t.marker.pos[0] && x.y === t.marker.pos[1]))), p.worlds.map((w) => [w.world, w.territories.length]));
    c('the walled cities\' worlds are Tamriel\'s aliases, and a territory in one is drawn in Tamriel\'s', !!tam && tam.territories.some((t) => t.id === 'harness-city') &&JSON.stringify(tam.aliases.slice().sort()) === JSON.stringify(Object.keys(TERRITORIES.worldAliases).sort()) && bru.aliases.length === 0, tam && tam.aliases);
    const brumaT = bru && bru.territories.find((t) => t.id === 'bruma');
    c('each territory carries its owner: Bruma the county\'s at first', !!brumaT && brumaT.owner === 'county-bruma');
    c('the palette colours an owner, with its name', p.factions['county-bruma'] && JSON.stringify(p.factions['county-bruma'].rgb) === '[214,170,48]' && p.factions['county-bruma'].name === 'County of Bruma', p.factions['county-bruma']);
    c('the anchors are the markers\' own positions, read from their records; one with no record is left out', p.anchors.length === 2
      && p.anchors.some((a) => a.name === 'Castle Bruma' && a.x === -1000.5 && a.y === 2000.25 && a.z === 300) && p.anchors.some((a) => a.name === 'Dragonsreach' && a.x === 19855 && a.y === -7423), p.anchors);
    c('the reach and the fade, W6\'s C2 by default', p.reach === 30000 && p.fade === 45000);
    c('each territory carries its zone', !!brumaT && brumaT.zone === 'bruma' && tam.territories.every((t) => typeof t.zone === 'string' && t.zone));
    c('with no hold-cells table (holdsFromCells off), no cells and no strongholds', !tam.cells && !tam.strongholds);
    // the switch on: the fork's table, and zones.json's strongholds
    globalThis.__dboHoldCells = { version: 2, c0: -1, n: 2, holds: ['whiterun', 'falkreath'], rows: ['0.', '11'] };
    fs.writeFileSync(path.join(tmp, 'zones.json'), JSON.stringify({ strongholds: [{ id: 'gol-kharzum', center: [-76847, -45868, 2327], radius: 6000 }, { id: 'broken' }] }));
    sent.length = 0;
    handlers.get('uiCaps')(7, []);
    const pc = (sent.find((x) => x[1].customPacketType === 'dboMapOwners') || [])[1];
    const tc = pc && pc.worlds.find((w) => w.world === '3c:Skyrim.esm'), bc = pc && pc.worlds.find((w) => w.world === 'a764b:BSHeartland.esm');
    c('holdsFromCells on: Tamriel carries the fork\'s very table', !!tc && !!tc.cells && tc.cells.c0 === -1 && tc.cells.n === 2 && tc.cells.size === 4096 && JSON.stringify(tc.cells.rows) === '["0.","11"]' && tc.cells.holds.join() === 'whiterun,falkreath', tc && tc.cells);
    c('...and the strongholds that win over it, a broken one left out', !!tc && JSON.stringify(tc.strongholds) === JSON.stringify([{ zone: 'gol-kharzum', x: -76847, y: -45868, r: 6000 }]), tc && tc.strongholds);
    c('...Bruma keeps its own (one region, no cells)', !!bc && !bc.cells && !bc.strongholds);
    delete globalThis.__dboHoldCells;
    try { fs.unlinkSync(path.join(tmp, 'zones.json')); } catch (e) { /* none */ }
    // owner changes: one packet each online player, after the burst
    sent.length = 0;
    realm.setOwner('bruma', 'fighters-guild', 'test');
    realm.setOwner(bru.territories.find((t) => t.id !== 'bruma').id, 'pack-red', 'test');
    c('nothing is sent while the burst is under way', !sent.some((x) => x[1].customPacketType === 'dboMapOwners'));
    while (timers.length) timers.shift()();
    const after = sent.filter((x) => x[1].customPacketType === 'dboMapOwners');
    c('then one packet to each online player', after.length === 2 && after.map((x) => x[0]).sort().join() === '7,8', after.map((x) => x[0]));
    const q = after[0] && after[0][1];
    const qb = q && q.worlds.find((w) => w.world === 'a764b:BSHeartland.esm');
    c('...with the new owners', !!qb && qb.territories.find((t) => t.id === 'bruma').owner === 'fighters-guild' && qb.territories.some((t) => t.owner === 'pack-red'));
    c('war.mapTints colours an owner first', q && JSON.stringify(q.factions['fighters-guild'].rgb) === '[1,2,3]', q && q.factions['fighters-guild']);
    const red = q && q.factions['pack-red'];
    c('an owner with no colour gets a steady one from its id', !!red && red.rgb.length === 3 && red.rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) && red.name === 'The Red Pack', red);
    sent.length = 0;
    realm.setOwner('bruma', 'fighters-guild', 'again');
    while (timers.length) timers.shift()();
    c('the same owner again sends nothing', !sent.some((x) => x[1].customPacketType === 'dboMapOwners'));
    handlers.get('mapOwnersFit')(7, [{ world: '3c:Skyrim.esm', fit: { n: 5, rms: 2.1 } }]);
    handlers.get('mapSwf')(7, [{ opening: 2, frames: 900, legend: { last: 'clip', phase: 'off', tries: 3, menu: 4, inject: [4, 244, 484], clip: 5, loaded: -1, alive: -1, drawn: -1, fit: -1, url: 'Interface/map.swf' }, owners: null, world: 60, anchors: 3, fit: null }]);
    c('the mapSwf line names the last step, each step\'s frame, the tries and the url', logs.some((l) => /map swfs from P7: opening 2, 900 frames; legend clip \(off, tries 3; menu 4, inject \[4,244,484\], clip 5, loaded -1, alive -1.*url "Interface\/map\.swf"\); owners none/.test(l)), logs.slice(-1));
    c('the client\'s fit report is logged',logs.some((l) => /map owners fit from P7: .*"rms":2.1/.test(l)), logs.slice(-2));
  } finally {
    global.setTimeout = realSetTimeout;
  }
};

scenarios(REALM_SRC, check);

const MUTANTS = [
  ['an owner change is not sent', '    if (prev !== fid) ownersChanged();\n', '\n'],
  ['a burst sends a packet per change', '    if (S.ownersTimer) return;\n', '\n'],
  ['the walled cities stay worlds of their own', 'return hit ? hit[1] : w; };', 'return w; };'],
  ['the config colours are ignored', 'const own = (C.mapTints && C.mapTints[fid]) || MAP_TINTS[fid];', 'const own = MAP_TINTS[fid];'],
  ['the cells sent with the switch off', "if (tam && cells && Array.isArray(cells.rows)", "if (tam && Array.isArray((cells || { rows: [] }).rows || [])"],
  ['the strongholds left out', '.map((z) => ({ zone: z.id, x: z.center[0], y: z.center[1], r: Number(z.radius) }));', '.map(() => null).filter(Boolean);'],
  ['the marker position read from the rotation', 'const v = new DataView(d.data.buffer, d.data.byteOffset, 12);', 'const v = new DataView(d.data.buffer, d.data.byteOffset + 12, 12);'],
];
for (const [name, a, b] of MUTANTS) {
  if (!REALM_SRC.includes(a)) { check(`mutant "${name}": its line is in realm.js`, false, a); continue; }
  let bad = 0;
  try { scenarios(REALM_SRC.replace(a, b), (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
