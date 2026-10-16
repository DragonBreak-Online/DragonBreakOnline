// Discovered map locations kept per character (mapprogress.js; Nate, 12 Oct). Real module, stub mp.
// Run from server\:  node tests/mapprogress-harness.js
'use strict';
const path = require('path');
const fs = require('fs');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, name, got) => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); };
const u32 = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, x, true); return b; };
const PLUG = { 'skyrim.esm': 0, 'bsheartland.esm': 8 };
const recs = new Map([
  [0x0000a001, { type: 'REFR', fields: [{ type: 'NAME', data: u32(0x10) }] }],      // a map marker
  [0x08001234, { type: 'REFR', fields: [{ type: 'NAME', data: u32(0x10) }] }],      // a BSHeartland map marker
  [0x0000a002, { type: 'REFR', fields: [{ type: 'NAME', data: u32(0x12eb7) }] }],   // a sword on a table
]);
const props = new Map(), sent = [];
const mp = {
  getIdFromDesc: (d) => { const [h, p] = d.split(':'); const i = PLUG[p.toLowerCase()]; if (i === undefined) throw new Error('no plugin'); return ((i << 24) | parseInt(h, 16)) >>> 0; },
  lookupEspmRecordById: (id) => (recs.has(id >>> 0) ? { record: recs.get(id >>> 0), toGlobalRecordId: (x) => x >>> 0 } : { record: null }),
  get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, JSON.parse(JSON.stringify(v))),
};
const load = (cfg) => {
  delete globalThis.__dboMapMarkerChecked;
  delete require.cache[path.join(SERVER, 'mapprogress.js')];
  require(path.join(SERVER, 'mapprogress.js'))({ mp, log: () => {}, sendPacket: (a, p) => sent.push([a, p]), cfg: cfg || {} });
};
load();
const A = 0xff000101, B = 0xff000102;
ok(globalThis.__dboMapSync(A, { markers: ['a001:Skyrim.esm', '1234:BSHeartland.esm'] }) === 2, 'two map markers kept');
ok(JSON.stringify(props.get(`${A}|private.mapMarkers`)) === '["a001:Skyrim.esm","1234:BSHeartland.esm"]', '...on the character');
ok(globalThis.__dboMapSync(A, { markers: ['A001:Skyrim.esm', 'a001:skyrim.esm'] }) === 0, 'the same marker again (any case) is not added twice');
ok(globalThis.__dboMapSync(A, { markers: ['a002:Skyrim.esm'] }) === 0, 'a reference that is no map marker is refused');
ok(globalThis.__dboMapSync(A, { markers: ['zz:Skyrim.esm', '../x:Skyrim.esm', 'a003:Skyrim', 42, null, ''] }) === 0, 'malformed names are refused');
ok(globalThis.__dboMapSync(A, { markers: ['5:SomeLight.esl'] }) === 1, 'a well-formed marker the server cannot read (a light plugin) is kept on its form');
sent.length = 0;
globalThis.__dboMapSync(A, { markers: [], want: true });
ok(sent.length === 1 && sent[0][1].customPacketType === 'dboMapMarkers' && sent[0][1].markers.length === 3, 'want: the whole list goes back', sent);
ok(globalThis.__dboMapSync(B, { markers: [] }) === 0 && !props.has(`${B}|private.mapMarkers`), 'another character starts empty; nothing written for nothing new');
load({ mapProgress: { maxMarkers: 1 } });
globalThis.__dboMapSync(B, { markers: ['a001:Skyrim.esm', '1234:BSHeartland.esm'] });
ok(props.get(`${B}|private.mapMarkers`).length === 1, 'maxMarkers caps the list');
load({ mapProgress: { enabled: false } });
ok(globalThis.__dboMapSync(B, { markers: ['1234:BSHeartland.esm'], want: true }) === undefined && props.get(`${B}|private.mapMarkers`).length === 1, 'enabled false: nothing kept or sent');
// Discovered is not visited (Purr #7DJT, 16 Oct: "every cave is shown as entered on the map"): the visited ones are kept
// apart, and come back apart, so the client can restore a marker it only saw with addToMap(false)
const C2 = 0xff000103;
load();
sent.length = 0;
ok(globalThis.__dboMapSync(C2, { markers: ['a001:Skyrim.esm'], visited: ['1234:BSHeartland.esm', 'a002:Skyrim.esm'] }) === 2, 'a visited marker is a discovered one too (and a non-marker is refused there as well)');
ok(JSON.stringify(props.get(`${C2}|private.mapVisited`)) === '["1234:BSHeartland.esm"]', '...and only the visited one is kept as visited', props.get(`${C2}|private.mapVisited`));
globalThis.__dboMapSync(C2, { markers: [], want: true });
const ans = sent.length && sent[sent.length - 1][1];
ok(ans && ans.markers.length === 2 && Array.isArray(ans.visited) && ans.visited.length === 1 && ans.visited[0] === '1234:BSHeartland.esm', 'want: the visited list goes back beside the markers', ans);
sent.length = 0;
globalThis.__dboMapSync(A, { markers: [], want: true });
ok(sent.length === 1 && Array.isArray(sent[0][1].visited) && sent[0][1].visited.length === 0, 'a character with no visited list (an old client) is answered with an empty one', sent);
const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
ok(/content\.customPacketType === 'dboMapSync'[\s\S]{0,200}globalThis\.__dboMapSync\(a, content\)/.test(gm) && /require\(MAPPROGRESS_JS\)\(\{ mp, log, sendPacket, cfg \}\)/.test(gm), 'gamemode.js loads it and routes dboMapSync');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
