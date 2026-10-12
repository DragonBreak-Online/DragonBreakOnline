// Scripted test for fork skymp5-client/src/sync/racemenuPresetPlan.ts: the face part of a RaceMenu .jslot (custom
// sliders, expressions, sculpt), its rules, the sculpt bound against this game's meshes, the .jslot handed to skee,
// chunks and their reassembly, the apply gate, and that racemenupresets.js (this repo) hashes and encodes the same.
// Bundle it first, then run from this folder's parent:
//
//   ../fork/skymp5-server/node_modules/.bin/esbuild ../fork/skymp5-client/src/sync/racemenuPresetPlan.ts --bundle --platform=node --format=cjs --outfile=<out>
//   node tests/racemenu-preset-plan-harness.js <out>
'use strict';
// deploy-batch.sh runs every harness a batch changes as a plain `node tests/<x>.js`: with no bundle there is nothing to
// test here, and a TypeError would stop the ship (12 Oct re-review, server-data 1)
if (!process.argv[2]) { console.log('ok   skipped: no client bundle given (tests/run-all.sh passes one)'); process.exit(0); }
const path = require('path');
const P = require(path.resolve(process.argv[2]));
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!ok) failures++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

// A .jslot as skee's SaveJsonPreset writes it (PresetInterface.cpp), trimmed
const HEAD = 'Actors\\Character\\Character Assets\\FemaleHeadChargen.tri';
const EYES = 'Actors\\Character\\Character Assets\\FemaleEyesChargen.tri';
const jslot = {
  actor: { headTexture: 'Skyrim.esm|0A0C62', weight: 40 },
  bodyMorphs: [{ keys: [{ key: 'RSMPlugin', value: 0.5 }], name: 'Breasts' }],
  faceTextures: [{ index: 0, texture: 'actors\\character\\female\\femalehead.dds' }],
  headParts: [{ formId: 0x0001a2b3, formIdentifier: 'Skyrim.esm|01A2B3', type: 1 }],
  modNames: ['Skyrim.esm', 'Dawnguard.esm'],
  mods: [{ index: 0, name: 'Skyrim.esm' }],
  morphs: {
    custom: [{ name: 'NoseBridge', value: 0.4 }, { name: 'Unused', value: 0 }, { name: 'ExpSmile', value: -0.5 }],
    default: { morphs: [0.1, 0.2], presets: [1, 2, 255] },
    sculpt: [{ data: [[0, 120, -30, 5], [17, 0, 0, 10000]], host: HEAD, vertices: 9001 }, { data: [[3, 1, 1, 1]], host: EYES, vertices: 48 }],
    sculptDivisor: 10000,
  },
  overrides: [{ node: 'Body [Ovl0]', values: [{ data: 'textures\\x.dds', index: -1, key: 9, type: 6 }] }],
  skinOverrides: [],
  tintInfo: [{ color: 4278190080, index: 0, texture: 'Actors\\Character\\Character Assets\\TintMasks\\SkinTone.dds' }],
  transforms: [{ firstPerson: false, keys: [{ name: 'internal', values: [] }], node: 'NPC Head [Head]' }],
  version: { formatVersion: 3, runtimeVersion: 17104896, signature: 1163086675, skseVersion: 34078848 },
};

// ---- the face part ----
const face = P.facePresetFrom(clone(jslot));
check('a full .jslot gives a face', !!face, face);
check('custom sliders kept, zero ones dropped', face.custom.length === 2 && face.custom[0].name === 'NoseBridge' && face.custom[1].value === -0.5, face.custom);
check('sculpt kept per host with its vertex count', face.sculpt.length === 2 && face.sculpt[0].host === HEAD && face.sculpt[0].vertices === 9001 && face.sculpt[0].data.length === 2, face.sculpt);
check('version copied', face.version.signature === 1163086675 && face.version.formatVersion === 3);
check('mod names kept (skee refuses a preset without any)', face.modNames.join() === 'Skyrim.esm,Dawnguard.esm');
const enc = P.encodeFace(face);
for (const k of ['tintInfo', 'overrides', 'transforms', 'bodyMorphs', 'skinOverrides', 'faceTextures', 'headParts', 'headTexture', 'presets'])
  check(`the face text carries no ${k}`, enc.indexOf(`"${k}"`) === -1);
check('no mod names at all becomes Skyrim.esm', P.facePresetFrom({ version: jslot.version }).modNames.join() === 'Skyrim.esm');
const fromMods = clone(jslot); delete fromMods.modNames;
check('legacy mods list gives the names when modNames is missing', P.facePresetFrom(fromMods).modNames.join() === 'Skyrim.esm');
const bare = P.facePresetFrom({ version: jslot.version, mods: [] });
check('a preset with no custom sliders and no sculpt is empty', bare && P.isEmptyFace(bare) && !P.isEmptyFace(face));

// ---- rules (12 Oct): one entry past them is dropped or clamped on its own, never the whole face ----
const F = require('./racemenu-face-rules-fixtures');
let S = null;
try { S = require(path.resolve('racemenupresets.js')); } catch (e) { S = null; }
check('racemenupresets.js loads from the repo root', !!S && typeof S.faceFixed === 'function', S && Object.keys(S));
for (const c of F.cases) {
  const want = c.out() ? F.encode(c.out()) : null;
  const cl = P.facePresetFixed(c.input());
  const sv = S && typeof S.faceFixed === 'function' ? S.faceFixed(F.faceForm(c.input())) : undefined;
  check(`client: ${c.name}`, (cl ? F.encode(cl.face) : null) === want && F.fixesOf(cl && cl.fixes) === c.fixes, cl && F.fixesOf(cl.fixes));
  check(`server: ${c.name}`, sv !== undefined && (sv ? F.encode(sv.face) : null) === want && F.fixesOf(sv && sv.fixes) === c.fixes, sv && F.fixesOf(sv.fixes));
  // The owner's capture (tri counts from the game) is what goes up: the server keeps it as it is, with no fix
  const tri = c.tri || {};
  const cap = P.facePresetFixed(c.input(), (h) => (tri[h] === undefined ? -1 : tri[h]));
  if (cap && sv !== undefined) {
    const text = P.encodeFace(cap.face);
    const back = S.faceFixed(JSON.parse(text));
    check(`  ...the server keeps the client's upload as it is (same text, no fix)`, (!c.captureOut || text === F.encode(c.captureOut())) && !!back && S.encodeFace(back.face) === text && back.fixes.length === 0,
      back && F.fixesOf(back.fixes));
  }
}
check('refused: not an object', P.facePresetFrom('x') === null && P.facePresetFrom(null) === null && P.facePresetFrom([]) === null);
const ranged = clone(jslot); ranged.morphs.custom = [{ name: 'Lips', value: 1 }, { name: 'Brows', value: -1 }, { name: 'NosePreset', value: 32 }, { name: 'Fine', value: 0.37 }];
ranged.morphs.sculpt[0].data = [[0, 300000, -300000, 0]];
check('the edges of RaceMenu\'s ranges are kept (-1, 1, preset 32, 30 units)', !!P.facePresetFrom(ranged) && P.facePresetFrom(ranged).custom.length === 4, ranged.morphs.custom);
const dupHost = clone(jslot); dupHost.morphs.sculpt[1].host = HEAD.toLowerCase();
check('a second entry for the same host (any case) is dropped', P.facePresetFrom(dupHost).sculpt.length === 1);
const noDivNoSculpt = clone(jslot); delete noDivNoSculpt.morphs.sculptDivisor; noDivNoSculpt.morphs.sculpt = [];
check('no divisor is fine without sculpt', !!P.facePresetFrom(noDivNoSculpt));

// ---- text and hash ----
check('encode/decode round trip', P.encodeFace(P.decodeFace(enc)) === enc);
check('one face is one text', P.encodeFace(P.facePresetFrom(clone(jslot))) === enc);
check('the hash is 8 hex and stable', /^[0-9a-f]{8}$/.test(P.hashText(enc)) && P.hashText(enc) === P.hashText(P.encodeFace(face)));
check('a change changes the hash', P.hashText(enc) !== P.hashText(enc.replace('0.4', '0.5')));
check('FNV-1a of "" and "a" (reference values)', P.hashText('') === '811c9dc5' && P.hashText('a') === 'e40c292c', [P.hashText(''), P.hashText('a')]);
check('decode refuses junk, empty and oversize text', P.decodeFace('{') === null && P.decodeFace('') === null && P.decodeFace('x'.repeat(P.PRESET_MAX_CHARS + 1)) === null && P.decodeFace(42) === null);
const bad = JSON.parse(enc); bad.sculpt[0].data[0][0] = 99999;
const dbad = P.decodeFace(JSON.stringify(bad));
check('decode applies the same rules (the vertex past the count dropped, the rest kept)', !!dbad && JSON.stringify(dbad.sculpt[0].data) === '[[17,0,0,10000]]' && dbad.sculpt.length === 2 && dbad.custom.length === 2, dbad);

// ---- the sculpt bound: skee writes offsets with no bounds check ----
const counts = { [HEAD]: 9001, [EYES]: 48 };
let b = P.boundSculpt(face, (h) => counts[h] === undefined ? -1 : counts[h]);
check('matching meshes keep every host', b.face.sculpt.length === 2 && b.dropped.length === 0, b.dropped);
b = P.boundSculpt(face, (h) => (h === HEAD ? 7000 : 48));
check('a head mesh with another vertex count drops that host only', b.face.sculpt.length === 1 && b.face.sculpt[0].host === EYES && b.dropped.length === 1 && /7000/.test(b.dropped[0]), b.dropped);
b = P.boundSculpt(face, () => -1);
check('a mesh this game cannot read drops the host', b.face.sculpt.length === 0 && b.dropped.length === 2);
b = P.boundSculpt(face, () => { throw new Error('no native'); });
check('a throwing count drops the host', b.face.sculpt.length === 0);
check('the bound leaves the sliders and the original alone', b.face.custom.length === 2 && face.sculpt.length === 2);

// ---- the .jslot for skee ----
const out = JSON.parse(P.buildJslot(face, ['Skyrim.esm|01A2B3', 'Dawnguard.esm|00ABCD'], 40));
check('version, mod names, head parts by identifier, weight, the face', out.version.signature === 1163086675 && out.modNames.length === 2
  && out.headParts.length === 2 && out.headParts[0].formIdentifier === 'Skyrim.esm|01A2B3' && out.actor.weight === 40
  && out.morphs.custom.length === 2 && out.morphs.sculptDivisor === 10000 && out.morphs.sculpt.length === 2, out);
check('no tints, textures, vanilla sliders or part-1 data go to skee', !out.tintInfo && !out.faceTextures && !out.morphs.default && !out.overrides && !out.transforms && !out.bodyMorphs && !out.actor.headTexture && out.actor.hairColor === undefined);
check('weight is clamped, and a bad one is 50 (skee would set 0)', JSON.parse(P.buildJslot(face, [], 400)).actor.weight === 100 && JSON.parse(P.buildJslot(face, [], NaN)).actor.weight === 50);

// ---- form identifiers as skee's GetFormIdentifier ----
const mods = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm'];
const modName = (i) => mods[i] || '';
const light = (i) => (i === 0x012 ? 'Light.esl' : '');
check('a full plugin form', P.formIdentifierOf(0x0201a2b3, modName, light) === 'Dawnguard.esm|01A2B3');
check('a Skyrim.esm form is padded to 6', P.formIdentifierOf(0x00000abc, modName, light) === 'Skyrim.esm|000ABC');
check('a light plugin form uses the 12-bit index and local id', P.formIdentifierOf(0xfe012345, modName, light) === 'Light.esl|000345');
check('a created form (0xff) has none', P.formIdentifierOf(0xff000123, modName, light) === null);
check('an unknown plugin has none', P.formIdentifierOf(0x09000001, modName, light) === null && P.formIdentifierOf(0xfe999001, modName, light) === null);
check('a throwing lookup has none', P.formIdentifierOf(0x01000001, () => { throw new Error('x'); }, light) === null);

// ---- chunks ----
const big = P.encodeFace({ ...face, sculpt: [{ host: HEAD, vertices: 12000, data: new Array(12000).fill(0).map((_, i) => [i, -123456, 23456, -3456]) }] });
check('a whole sculpted 12k-vertex head fits the cap', big.length < P.PRESET_MAX_CHARS, big.length);
const parts = P.chunkText(big);
check('chunks are at most CHUNK_CHARS and join back', parts.every((c) => c.length <= P.CHUNK_CHARS) && parts.join('') === big && parts.length === Math.ceil(big.length / P.CHUNK_CHARS));
check('the cap fits MAX_CHUNKS chunks', P.MAX_CHUNKS * P.CHUNK_CHARS >= P.PRESET_MAX_CHARS);
const hash = P.hashText(big);
const pk = (i, extra) => P.readChunkPacket({ actor: 0xff000123, hash, i, n: parts.length, data: parts[i], ...(extra || {}) });
let asm = new P.ChunkAssembler();
let got = null;
const order = parts.map((_, i) => i).reverse();
for (const i of order) { const r = asm.push(pk(i), 1000); if (r !== null) got = r; }
check('chunks in any order reassemble to the text', got === big && asm.openCount === 0);
asm = new P.ChunkAssembler();
asm.push(pk(0), 0); asm.push(pk(0), 0);
check('a repeated chunk is counted once', asm.openCount === 1);
asm = new P.ChunkAssembler(60000);
for (let i = 0; i < parts.length - 1; i++) asm.push(pk(i), 0);
check('a transfer that stalls past the timeout is dropped', asm.push(pk(parts.length - 1), 70000) === null);
asm = new P.ChunkAssembler();
const wrong = P.readChunkPacket({ actor: 1, hash: '00000000', i: 0, n: 1, data: 'abc' });
check('a text that does not match its hash is refused', asm.push(wrong, 0) === null && asm.openCount === 0);
asm = new P.ChunkAssembler(60000, 2);
asm.push(P.readChunkPacket({ actor: 1, hash: 'aaaaaaaa', i: 0, n: 2, data: 'a' }), 0);
asm.push(P.readChunkPacket({ actor: 2, hash: 'aaaaaaaa', i: 0, n: 2, data: 'a' }), 0);
asm.push(P.readChunkPacket({ actor: 3, hash: 'aaaaaaaa', i: 0, n: 2, data: 'a' }), 0);
check('at most maxOpen transfers at once', asm.openCount === 2);
check('bad chunk packets are refused', P.readChunkPacket(null) === null && pk(0, { hash: 'zz' }) === null && pk(0, { i: parts.length }) === null
  && pk(0, { n: P.MAX_CHUNKS + 1 }) === null && pk(0, { actor: 0 }) === null && pk(0, { data: 'x'.repeat(P.CHUNK_CHARS + 1) }) === null && pk(0, { i: -1 }) === null);

// ---- the apply gate ----
const gate = (o) => P.applyBlockedBy({ raceNow: 0x13746, presetRace: 0x13746, isBeast: false, raceMenuSettling: false, loaded3D: true, inCombat: false, ...o });
check('a loaded, idle copy of its own race takes its face', gate({}) === null);
check('never while RaceMenu is open or settling', gate({ raceMenuSettling: true }) === 'racemenu');
check('never on a beast form', gate({ isBeast: true, raceNow: 0xcdd84 }) === 'beast');
check('never without 3D', gate({ loaded3D: false }) === '3d');
check('never in a fight', gate({ inCombat: true }) === 'combat');
check('never on another race than it was made on', gate({ raceNow: 0x13744 }) === 'race');
check('an unknown preset race does not block', gate({ presetRace: 0, raceNow: 0x13744 }) === null);
check('RaceMenu is checked before everything', gate({ raceMenuSettling: true, isBeast: true, loaded3D: false }) === 'racemenu');

// ---- the ledger ----
const led = new P.ApplyLedger();
led.markDone(0xff000a01, 'h1');
check('a copy is done once per hash', led.isDone(0xff000a01, 'h1') && !led.isDone(0xff000a01, 'h2') && !led.isDone(0xff000a02, 'h1'));
led.forget(0xff000a01);
check('forget hands it back', !led.isDone(0xff000a01, 'h1'));
led.markDone(0xff000a01, 'h1'); led.markDone(0xff000a02, 'h1');
led.keepOnly([0xff000a02]);
check('copies that are gone are dropped', !led.isDone(0xff000a01, 'h1') && led.isDone(0xff000a02, 'h1'));
check('file names follow the platform rule', P.presetFileName('self') === 'self' && P.presetFileName(0xff000abc) === 'cff000abc' && /^[A-Za-z0-9_-]{1,64}$/.test(P.presetFileName(0xffffffff)));
check('host rule matches the platform rule', P.isTriPath(HEAD) && P.isTriPath('a/b.TRI') && !P.isTriPath('a..b.tri') && !P.isTriPath(' a.tri') && !P.isTriPath('a.tri ') && !P.isTriPath('x'.repeat(197) + '.tri'));

// ---- the server applies the same rules and text (racemenupresets.js) ----
if (S) {
  check('server and client hash alike', S.hashText(big) === P.hashText(big) && S.hashText('') === P.hashText(''));
  check('server re-encodes a client face to the same text', S.encodeFace(S.faceFrom(JSON.parse(enc))) === enc);
  check('server and client drop the same broken vertex', S.encodeFace(S.faceFrom(bad)) === P.encodeFace(P.decodeFace(JSON.stringify(bad))));
  const huge = JSON.parse(enc); huge.custom[0].value = 1e9;
  check('server and client clamp a huge slider alike (to 10)', S.faceFrom(huge).custom[0].value === 10 && P.decodeFace(JSON.stringify(huge)).custom[0].value === 10);
  for (const v of [1.5, -2, 33, 0.999, 32, -1, 255, 256, -10.5, 12.25, 1e-7]) {
    const t = JSON.parse(enc); t.custom[0].value = v;
    check(`server and client agree on slider value ${v}`, S.encodeFace(S.faceFrom(t)) === P.encodeFace(P.decodeFace(JSON.stringify(t))));
  }
  const far = JSON.parse(enc); far.sculpt[0].data[0][1] = 300001;
  check('server and client clamp a sculpt past 30 units alike', S.faceFrom(far).sculpt[0].data[0][1] === 300000 && P.decodeFace(JSON.stringify(far)).sculpt[0].data[0][1] === 300000);
  check('server and client share the host rule (KS Hairdo\'s apostrophe taken)', [F.KS, HEAD, 'a..b.tri', ' a.tri', 'C:\\a.tri', 'a"b.tri', 'x'.repeat(197) + '.tri'].every((h) => S.isTriPath(h) === P.isTriPath(h)) && S.isTriPath(F.KS));
}

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
