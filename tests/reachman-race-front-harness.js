// Scripted test for the creator's Reachman data (front charCreator, Skyrim release 15 Oct): races.js reachfolk with raceEditorId
// DBOReachmanRace and fallbackEditorId BretonRace; headparts.json and tints.json generated from the DLE's DBOReachmanRace
// (tools creator_races.py). A Reachfolk picks from the Breton's head parts, the race's own skin tones, and its war paints,
// the four Forsworn tattoos per sex among them; a Reachfolk child is a Breton child. run-all bundles from $FORK:
//   node tests/reachman-race-front-harness.js <bundle of skymp5-front/src/features/charCreator/appearanceBuilder.js>
'use strict';
const fs = require('fs');
const bundle = process.argv[2];
if (!bundle) { console.log('usage: node tests/reachman-race-front-harness.js <bundle>'); process.exit(2); }
if (!/DBOReachmanRace/.test(fs.readFileSync(bundle, 'utf8'))) {
  require('./expect')('reachman-race-front', 'this front has no Reachman data');
  console.log('ok   skipped: this front predates the Reachman data');
  process.exit(0);
}
const B = require(bundle);
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!c) fails++; };
const reach = { id: 'reachfolk', raceId: 0x13741, raceEditorId: 'DBOReachmanRace', fallbackEditorId: 'BretonRace', childRaceId: 0x2c65c };
const breton = { id: 'breton', raceId: 0x13741, raceEditorId: 'BretonRace', childRaceId: 0x2c65c };
ok(B.editorIdFor(reach, 'adult') === 'DBOReachmanRace', 'an adult Reachfolk reads DBOReachmanRace\'s own data', B.editorIdFor(reach, 'adult'));
ok(B.editorIdFor(reach, 'child') === 'BretonRaceChild', 'a Reachfolk child reads the Breton child\'s (the server makes it a Breton child)', B.editorIdFor(reach, 'child'));
ok(B.editorIdFor(breton, 'child') === 'BretonRaceChild' && B.editorIdFor(breton, 'adult') === 'BretonRace', 'the Breton is as before');
const WARPAINT = 7, SKIN = 6;
for (const sex of ['male', 'female']) {
  const ids = (r, kind) => B.partsFor(kind, r, 'adult', sex).map((p) => p.id).sort().join(',');
  for (const kind of ['hair', 'eyes', 'brows']) ok(ids(reach, kind).length > 0 && ids(reach, kind) === ids(breton, kind), `${sex}: the Breton's ${kind} to choose from`);
  const paints = B.tintsFor(reach, 'adult', sex, WARPAINT).map((t) => t.file.split('\\').pop());
  const forsworn = paints.filter((f) => /ForswornTattoo_0[1-4]\.dds$/.test(f));
  ok(forsworn.length === 4, `${sex}: the four Forsworn tattoos are war paints`, paints);
  ok(paints.some((f) => /BretonWarPaint/.test(f)), `${sex}: ...beside the Breton war paints`, paints);
  ok(B.tintsFor(reach, 'adult', sex, SKIN).length === 1 && B.tintsFor(reach, 'adult', sex, SKIN)[0].presets.length >= 5, `${sex}: skin tone presets from the race`);
  const d = B.defaultParts(reach, 'adult', sex);
  ok(d.hair !== null && d.eyes !== null && d.brows !== null, `${sex}: the race's own default hair, eyes and brows`, d);
}
// The Breton keeps its data: its Forsworn tattoos stay without a layer type, as in the vanilla record
ok(B.tintsFor(breton, 'adult', 'male', WARPAINT).every((t) => !/Forsworn/.test(t.file)), 'a Breton is not offered the Forsworn tattoos (vanilla: no layer type)');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
