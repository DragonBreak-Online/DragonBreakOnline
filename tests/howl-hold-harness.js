// Scripted test for the werewolf howl broadcast in server\greathunt.js (__dboHuntHowled): a howl is heard only in the
// howler's hold (Nate 16 Oct, after Skyrim opened: players in other holds read "A howl echoes through Whiterun").
// zoneOfActor is mocked the way gamemode.js answers it: Bruma's worldspace is its own zone, Tamriel goes to the
// nearest hold capital, an interior to its hold by zone-cells.json. Run it from this folder's parent with
//
//   node tests/howl-hold-harness.js
'use strict';
const path = require('path');
const HUNT = path.resolve(__dirname, '..', 'greathunt.js');

let now = Date.UTC(2026, 9, 16, 12, 0);
Date.now = () => now;
const BRUMA_W = 'a764b:BSHeartland.esm', TAMRIEL = '3c:Skyrim.esm';
const WR_INN = '1605e:Skyrim.esm', FALK_CELL = '9d4c:Skyrim.esm';
const WOLF = 0xff000010, WR_OUT = 0xff000011, WR_IN = 0xff000012, FALK = 0xff000013, BRUMA = 0xff000014, NOWHERE = 0xff000015;
const props = new Map();
const get = (id, p) => props.get(id + '|' + p);
const set = (id, p, v) => props.set(id + '|' + p, v);
const place = (id, world, pos) => { set(id, 'worldOrCellDesc', world); set(id, 'pos', pos); };
const ZONE = { [WR_INN]: 'whiterun', [FALK_CELL]: 'falkreath' };
const zoneOfActor = (a) => {
  const w = get(a, 'worldOrCellDesc'), p = get(a, 'pos');
  if (w === BRUMA_W) return 'bruma';
  if (w === TAMRIEL) return p[1] > 0 ? { id: 'whiterun' } : 'falkreath';   // object form: some callers see { id }
  return ZONE[w] || null;
};
const names = { bruma: 'the County of Bruma', whiterun: 'Whiterun', falkreath: 'Falkreath' };
const said = [];
const api = {
  mp: { get, set, getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) },
  log: () => {}, personal: (a, t) => said.push({ a, t }), audit: () => {}, who: (a) => `P${a.toString(16)}`,
  sendPacket: () => {}, onlineActors: () => [WOLF, WR_OUT, WR_IN, FALK, BRUMA, NOWHERE],
  profileOf: (a) => a & 0xff, registerChatCommand: () => {},
  zoneOfActor, zoneById: (z) => (names[z] ? { id: z, name: names[z] } : null),
  isWorldspace: (w) => w === BRUMA_W || w === TAMRIEL, cfg: {},
};
globalThis.__dboSuperKind = (a) => (a === WOLF ? 'werewolf' : null);
globalThis.__dboRegisterStatus = () => {};
delete globalThis.__dboGreatHunt;
delete require.cache[HUNT];
require(HUNT)(api);

let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? '   ' + detail : ''}`); if (!ok) failures++; };
const heard = () => said.filter((s) => /^A howl echoes/.test(s.t)).map((s) => s.a);
const howl = () => { said.length = 0; now += 61000; globalThis.__dboHuntHowled(WOLF, 'Howl of Terror'); return heard(); };

place(WR_OUT, TAMRIEL, [20000, 5000, 0]);
place(WR_IN, WR_INN, [0, 0, 0]);
place(FALK, TAMRIEL, [-20000, -60000, 0]);
place(BRUMA, BRUMA_W, [57592, 203505, 0]);
place(NOWHERE, '999:Unknown.esp', [0, 0, 0]);

// A werewolf in Whiterun hold
place(WOLF, TAMRIEL, [25000, 9000, 0]);
let h = howl();
check('same hold, outdoors: heard', h.includes(WR_OUT), h.map((x) => x.toString(16)).join());
check('same hold, in an interior of the hold: heard', h.includes(WR_IN));
check('another Skyrim hold (Falkreath): not heard', !h.includes(FALK));
check('Bruma, from Skyrim: not heard', !h.includes(BRUMA));
check('a player in no known hold: not heard', !h.includes(NOWHERE));
check('the howler does not read their own howl', !h.includes(WOLF));
check('the text names the hold', said.some((s) => s.t === 'A howl echoes through Whiterun.'));

// A werewolf in Bruma
place(WOLF, BRUMA_W, [60000, 200000, 0]);
h = howl();
check('Bruma howl: Bruma hears', h.includes(BRUMA));
check('Bruma howl: Skyrim does not', !h.includes(WR_OUT) && !h.includes(WR_IN) && !h.includes(FALK));

// A werewolf inside a Whiterun interior
place(WOLF, WR_INN, [0, 0, 0]);
h = howl();
check('interior howl: its hold hears, outdoors and in', h.includes(WR_OUT) && h.includes(WR_IN));
check('interior howl: other holds do not', !h.includes(FALK) && !h.includes(BRUMA));

// Still once a minute per howler
said.length = 0; now += 1000; globalThis.__dboHuntHowled(WOLF, 'Howl of Terror');
check('once a minute per howler', heard().length === 0);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
