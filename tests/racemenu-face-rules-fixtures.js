// The RaceMenu face rules, one table for both sides (12 Oct, appearance-refusal): the client's facePresetFixed
// (skymp5-client/src/sync/racemenuPresetPlan.ts) and the server's faceFixed (racemenupresets.js) must give exactly these
// faces and fixes. The same file, byte for byte, is skymp5-client/tests/racemenu-face-rules-fixtures.js on the client
// branch and tests/racemenu-face-rules-fixtures.js on the server branch; racemenu-face-rules-harness.js (client) and
// racemenu-preset-plan-harness.js (server) run it.
//
// Each case: input() gives a .jslot shaped as skee's SaveJsonPreset writes it (PresetInterface.cpp:312-701); out() the face
// the rules give without tri counts (the server, and the client decoding a face it was sent); fixes the 'code:n' list.
// tri (host -> this game's vertex count) is the owner's capture: captureOut() and captureFixes are what the client gives
// with natives.getTriVertexCount answering from tri (-1 for a host not in it). null out: the whole input is refused.
'use strict';

const V = { signature: 1163086675, formatVersion: 3, skseVersion: 34078848, runtimeVersion: 17104896 };
const SKEE_V = { signature: 1163086675, formatVersion: 3, skseVersion: 0, runtimeVersion: 0 };
const MODS = ['Skyrim.esm', 'AlternateHighPolyHead_SE.esp', "KS Hairdo's.esp"];
const HEAD = 'DonCalzone\\High Poly Head\\femaleheadchargen.tri';
const HAIR = 'Actors\\Character\\Character Assets\\Hair\\FemaleRedGuardHair04.tri';
const KS = "KS Hairdo's\\Adela.tri";
const UNCACHED = 4294967295;

const jslot = (custom, sculpt, o = {}) => ({
  actor: { headTexture: 'Skyrim.esm|0A3B3D', weight: 50 },
  bodyMorphs: [{ keys: [{ key: 'RSMPlugin', value: 0.5 }], name: 'Breasts' }],
  faceTextures: [{ index: 0, texture: 'actors\\character\\female\\femalehead.dds' }],
  headParts: [{ formId: 0x1a2b3, formIdentifier: 'Skyrim.esm|01A2B3', type: 1 }],
  modNames: MODS.slice(),
  mods: [{ index: 0, name: 'Skyrim.esm' }],
  morphs: Object.assign({
    custom: custom === undefined ? [] : custom,
    default: { morphs: [0.1, -0.2], presets: [0, 3, 255, 7] },
    sculpt: sculpt === undefined ? [] : sculpt,
    sculptDivisor: 10000,
  }, o.morphs || {}),
  overrides: [{ node: 'Body [Ovl0]', values: [{ data: 0.5, index: -1, key: 8, type: 3 }] }],
  tintInfo: [{ color: 4291611852, index: 0, texture: 'Actors\\Character\\Character Assets\\TintMasks\\SkinTone.dds' }],
  transforms: [{ firstPerson: false, keys: [{ name: 'RSMPlugin', values: [{ data: 1.1, index: 0, key: 20, type: 3 }] }], node: 'NPC Head [Head]' }],
  version: o.version === undefined ? Object.assign({}, V) : o.version,
});
const face = (custom, sculpt, o = {}) => ({
  version: o.version || V, modNames: MODS.slice(), custom: custom || [], sculptDivisor: o.divisor || 10000, sculpt: sculpt || [],
});
const S = (name, value) => ({ name, value });
const H = (host, vertices, data) => ({ host, vertices, data });
const sliders = (n, from = 0, value = (i) => Math.round((((i * 53) % 191) / 95 - 1) * 95) / 100) =>
  Array.from({ length: n }, (_, k) => S(`Slider${from + k}`, value(from + k))).filter((m) => m.value !== 0);
const verts = (n, from = 0, units = 1) => Array.from({ length: n }, (_, i) => [from + i, Math.trunc(Math.sin(i) * units * 10000), Math.trunc(Math.cos(i) * units * 5000), Math.trunc(units * 2500)]);
const BASE = [S('Morph_a', -0.67), S('Morph_b', -0.02), S('PresetSlider', 3)];
const HEADSCULPT = H(HEAD, 5000, [[1, 100, -200, 300], [7, 0, 0, 10]]);

const cases = [
  // ---- inside the old limits: unchanged (every face 0.3.94 and 0.3.95 sent, and every stored face, stays as it was) ----
  { name: 'a new-character face (as the live stored faces): unchanged, a zero slider left out',
    input: () => jslot([...BASE, S('Zero', 0)], [HEADSCULPT]), out: () => face(BASE, [HEADSCULPT]), fixes: '' },
  { name: 'the old limits\' edges (-1, 1, preset 32, 0.999, 30 units): unchanged',
    input: () => jslot([S('Lips', 1), S('Brows', -1), S('NosePreset', 32), S('Fine', 0.999)], [H(HEAD, 5000, [[0, 300000, -300000, 0]])]),
    out: () => face([S('Lips', 1), S('Brows', -1), S('NosePreset', 32), S('Fine', 0.999)], [H(HEAD, 5000, [[0, 300000, -300000, 0]])]), fixes: '' },
  { name: 'a typical sculpted preset (45 sliders, 1,500 head vertices): unchanged',
    input: () => jslot(sliders(45), [H(HEAD, 5000, verts(1500))]), out: () => face(sliders(45), [H(HEAD, 5000, verts(1500))]), fixes: '' },

  // ---- the values that refused whole faces before (12 Oct): kept as they are ----
  { name: 'fSliderMultiplier 2: a slider at 1.37 is kept (was: the whole face refused)',
    input: () => jslot([...BASE, S('Morph_x', 1.3700000047683716)]), out: () => face([...BASE, S('Morph_x', 1.3700000047683716)]), fixes: '' },
  { name: 'fSliderMultiplier 2: a slider at -2.0 is kept',
    input: () => jslot([S('Morph_a', -2)]), out: () => face([S('Morph_a', -2)]), fixes: '' },
  { name: 'preset sliders at 33 and 255 (skee allows up to 255) are kept',
    input: () => jslot([S('PresetA', 33), S('PresetB', 255)]), out: () => face([S('PresetA', 33), S('PresetB', 255)]), fixes: '' },
  { name: 'the typical preset plus ONE slider at 1.05 is taken whole',
    input: () => jslot([...sliders(45), S('Morph_x', 1.05)], [H(HEAD, 5000, verts(1500))]),
    out: () => face([...sliders(45), S('Morph_x', 1.05)], [H(HEAD, 5000, verts(1500))]), fixes: '' },
  { name: 'a KS Hairdo\'s host (apostrophe) with a vertex count is kept',
    input: () => jslot(BASE, [HEADSCULPT, H(KS, 1200, [[4, 10, 10, 10]])]), out: () => face(BASE, [HEADSCULPT, H(KS, 1200, [[4, 10, 10, 10]])]), fixes: '' },
  { name: 'unknown fields at every level are ignored',
    input: () => { const j = jslot(BASE.map((m) => Object.assign({ extra: 1 }, m)), [Object.assign({ extra: 'x' }, HEADSCULPT)]); j.newTopLevel = { a: 1 }; j.morphs.newMorphs = [1]; j.version.extra = 7; return j; },
    out: () => face(BASE, [HEADSCULPT]), fixes: '' },
  { name: 'a .jslot with no morphs at all is an empty face',
    input: () => { const j = jslot(); delete j.morphs; return j; }, out: () => face([], []), fixes: '' },

  // ---- sliders: one bad entry is clamped or dropped on its own ----
  { name: 'sliders past 10 are clamped (12.5 -> 10, -37 -> -10, 256 -> 10, -1e9 -> -10)',
    input: () => jslot([S('A', 12.5), S('B', -37), S('C', 256), S('D', -1e9), S('E', 0.5)]),
    out: () => face([S('A', 10), S('B', -10), S('C', 10), S('D', -10), S('E', 0.5)]), fixes: 'custom-clamp:4' },
  { name: 'a value that is no finite number drops that slider only',
    input: () => jslot([S('A', '0.5'), S('B', null), { name: 'C' }, S('D', 0.25), S('E', true)]), out: () => face([S('D', 0.25)]), fixes: 'custom-value:4' },
  { name: 'a bad slider name drops that slider only (empty, 129 chars, control char, a number)',
    input: () => jslot([S('', 0.1), S('N'.repeat(129), 0.2), S('a\u0001b', 0.3), S(42, 0.4), 'x', S('Ok', 0.5), S('N'.repeat(128), 0.6)]),
    out: () => face([S('Ok', 0.5), S('N'.repeat(128), 0.6)]), fixes: 'custom-name:5' },
  { name: 'a name given twice (any case) is one slider at the first place with the last value; a last 0 removes it',
    input: () => jslot([S('Nose', 0.2), S('Lips', 0.3), S('nose', 0.5), S('Brow', 0.4), S('BROW', 0)]),
    out: () => face([S('Nose', 0.5), S('Lips', 0.3)]), fixes: 'custom-dup:2' },
  { name: '1,025 sliders: the first 1,024 kept',
    input: () => jslot(Array.from({ length: 1025 }, (_, i) => S(`S${i}`, 0.5))), out: () => face(Array.from({ length: 1024 }, (_, i) => S(`S${i}`, 0.5))), fixes: 'custom-count:1' },
  { name: 'the repeat budget (4096 whole units a face): a slider past it is left out, later small ones kept',
    input: () => jslot([...Array.from({ length: 20 }, (_, i) => S(`P${i}`, 255)), S('X', 10), S('Y', 0.5), S('Z', 7)]),
    out: () => face([...Array.from({ length: 16 }, (_, i) => S(`P${i}`, 255)), S('X', 10), S('Y', 0.5)]), fixes: 'custom-budget:5' },
  { name: 'custom not a list: no sliders, the sculpt kept',
    input: () => jslot({ Nose: 0.5 }, [HEADSCULPT]), out: () => face([], [HEADSCULPT]), fixes: 'custom-list:1' },
  { name: 'no readable version: skee\'s own header',
    input: () => jslot(BASE, [], { version: { signature: 'SKSE', formatVersion: 0 } }), out: () => face(BASE, [], { version: SKEE_V }), fixes: 'version:1' },

  // ---- sculpt: one bad host or vertex is dropped or clamped on its own ----
  { name: 'a hair sculpt skee wrote with vertices 4294967295: dropped here, recounted from the tri on the owner\'s capture',
    input: () => jslot(BASE, [HEADSCULPT, H(HAIR, UNCACHED, [[3, 5000, 5000, 0], [1199, 1, 2, 3]])]),
    out: () => face(BASE, [HEADSCULPT]), fixes: 'sculpt-vertices:1',
    tri: { [HAIR]: 1200 }, captureOut: () => face(BASE, [HEADSCULPT, H(HAIR, 1200, [[3, 5000, 5000, 0], [1199, 1, 2, 3]])]), captureFixes: 'sculpt-recount:1' },
  { name: 'a hair sculpt with no vertex count whose tri cannot be read (a KS Hairdo\'s path today): that host dropped',
    input: () => jslot(BASE, [HEADSCULPT, H(KS, UNCACHED, [[3, 5000, 5000, 0]])]),
    out: () => face(BASE, [HEADSCULPT]), fixes: 'sculpt-vertices:1', tri: {}, captureOut: () => face(BASE, [HEADSCULPT]), captureFixes: 'sculpt-vertices:1' },
  { name: 'a recount smaller than the sculpt drops the vertices past it only',
    input: () => jslot(BASE, [H(HAIR, UNCACHED, [[3, 1, 1, 1], [900, 2, 2, 2]])]),
    out: () => face(BASE, []), fixes: 'sculpt-vertices:1', tri: { [HAIR]: 800 }, captureOut: () => face(BASE, [H(HAIR, 800, [[3, 1, 1, 1]])]), captureFixes: 'sculpt-recount:1,sculpt-vertex:1' },
  { name: 'a vertex past the count, negative, fractional or not 4 numbers is dropped on its own',
    input: () => jslot(BASE, [H(HEAD, 5000, [[5000, 1, 1, 1], [-1, 1, 1, 1], [1.5, 1, 1, 1], [2, 1, 1], [3, 1, 1, 1, 1], [4, 1.5, 0, 0], 'x', [6, 6, 6, 6]])]),
    out: () => face(BASE, [H(HEAD, 5000, [[6, 6, 6, 6]])]), fixes: 'sculpt-vertex:7' },
  { name: 'an offset past 30 units is clamped (divisor 10000: 300000)',
    input: () => jslot(BASE, [H(HEAD, 5000, [[3, 310000, -400000, 5], [4, 1e300, 0, -1e300], [5, 1, 2, 3]])]),
    out: () => face(BASE, [H(HEAD, 5000, [[3, 300000, -300000, 5], [4, 300000, 0, -300000], [5, 1, 2, 3]])]), fixes: 'sculpt-offset:2' },
  { name: 'with divisor 1 the bound is 30',
    input: () => jslot(BASE, [H(HEAD, 5000, [[0, 31, 0, -30]])], { morphs: { sculptDivisor: 1 } }),
    out: () => face(BASE, [H(HEAD, 5000, [[0, 30, 0, -30]])], { divisor: 1 }), fixes: 'sculpt-offset:1' },
  { name: 'a vertex given twice: one, at the first place, with the last offsets',
    input: () => jslot(BASE, [H(HEAD, 5000, [[5, 1, 1, 1], [6, 2, 2, 2], [5, 9, 9, 9]])]),
    out: () => face(BASE, [H(HEAD, 5000, [[5, 9, 9, 9], [6, 2, 2, 2]])]), fixes: 'sculpt-dupvertex:1' },
  { name: 'a bad sculpt divisor drops every sculpt, the sliders stay',
    input: () => jslot(BASE, [HEADSCULPT], { morphs: { sculptDivisor: 0 } }), out: () => face(BASE, []), fixes: 'sculpt-divisor:1' },
  { name: 'a host path the rules refuse (.nif, .., rooted, drive, a list) drops that host only',
    input: () => jslot(BASE, [H('actors\\head.nif', 10, [[1, 1, 1, 1]]), H('..\\..\\SKSE\\x.tri', 10, [[1, 1, 1, 1]]), H('\\Windows\\x.tri', 10, [[1, 1, 1, 1]]),
      H('C:\\x.tri', 10, [[1, 1, 1, 1]]), [HEAD], HEADSCULPT]),
    out: () => face(BASE, [HEADSCULPT]), fixes: 'sculpt-host:5' },
  { name: 'a host whose data is not a list is dropped',
    input: () => jslot(BASE, [H(HAIR, 1200, { 1: [1, 1, 1] }), HEADSCULPT]), out: () => face(BASE, [HEADSCULPT]), fixes: 'sculpt-data:1' },
  { name: 'a second entry for the same host (any case) is left out, as before',
    input: () => jslot(BASE, [HEADSCULPT, H(HEAD.toUpperCase(), 5000, [[9, 9, 9, 9]])]), out: () => face(BASE, [HEADSCULPT]), fixes: '' },
  { name: '17 sculpted hosts: the first 16 kept',
    input: () => jslot(BASE, Array.from({ length: 17 }, (_, i) => H(`a${i}.tri`, 4, [[0, 1, 1, 1]]))),
    out: () => face(BASE, Array.from({ length: 16 }, (_, i) => H(`a${i}.tri`, 4, [[0, 1, 1, 1]]))), fixes: 'sculpt-count:1' },
  { name: 'sculpt not a list: no sculpt, the sliders kept',
    input: () => jslot(BASE, { host: HEAD }), out: () => face(BASE, []), fixes: 'sculpt-list:1' },
  { name: 'a face over 1,000,000 characters: the largest sculpted part goes, the rest stays',
    input: () => jslot(BASE, [H(HEAD, 5000, verts(500)), H(HAIR, 60000, Array.from({ length: 40000 }, (_, i) => [i, -123456, 123456, -123456]))]),
    out: () => face(BASE, [H(HEAD, 5000, verts(500))]), fixes: 'sculpt-size:1' },
  { name: 'a large sculpt that still fits 1,000,000 characters is kept whole',
    input: () => jslot(BASE, [H(HAIR, 30000, Array.from({ length: 26000 }, (_, i) => [i, 1, -1, 2]))]),
    out: () => face(BASE, [H(HAIR, 30000, Array.from({ length: 26000 }, (_, i) => [i, 1, -1, 2]))]), fixes: '' },
  { name: 'everything at once: each entry on its own, the rest of the face kept',
    input: () => jslot([S('Morph_a', 1.5), S('', 0.2), S('Morph_b', -2), S('PresetC', 40), S('Bad', NaN), S('morph_A', 2.5)],
      [H(HEAD, 5000, [[1, 400000, 0, 0], [5000, 1, 1, 1], [2, 2, 2, 2]]), H(HAIR, UNCACHED, [[1, 1, 1, 1]]), H(KS, UNCACHED, [[1, 1, 1, 1]])]),
    out: () => face([S('Morph_a', 2.5), S('Morph_b', -2), S('PresetC', 40)], [H(HEAD, 5000, [[1, 300000, 0, 0], [2, 2, 2, 2]])]),
    fixes: 'custom-name:1,custom-value:1,custom-dup:1,sculpt-vertex:1,sculpt-offset:1,sculpt-vertices:2',
    tri: { [HAIR]: 1200 },
    captureOut: () => face([S('Morph_a', 2.5), S('Morph_b', -2), S('PresetC', 40)], [H(HEAD, 5000, [[1, 300000, 0, 0], [2, 2, 2, 2]]), H(HAIR, 1200, [[1, 1, 1, 1]])]),
    captureFixes: 'custom-name:1,custom-value:1,custom-dup:1,sculpt-vertex:1,sculpt-offset:1,sculpt-recount:1,sculpt-vertices:1' },

  // ---- refused whole: only what is not an object ----
  { name: 'not an object is refused', input: () => 'x', out: () => null, fixes: '' },
  { name: 'a list is refused', input: () => [jslot(BASE)], out: () => null, fixes: '' },
];

// The face text both sides send and keep (encodeFace's key order)
const encode = (f) => JSON.stringify({
  version: { signature: f.version.signature, formatVersion: f.version.formatVersion, skseVersion: f.version.skseVersion, runtimeVersion: f.version.runtimeVersion },
  modNames: f.modNames,
  custom: f.custom.map((m) => ({ name: m.name, value: m.value })),
  sculptDivisor: f.sculptDivisor,
  sculpt: f.sculpt.map((h) => ({ host: h.host, vertices: h.vertices, data: h.data })),
});
// The server takes the face in the client's text form: the .jslot's face part with the morphs lifted to the top
const faceForm = (j) => {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return j;
  const m = j.morphs && typeof j.morphs === 'object' && !Array.isArray(j.morphs) ? j.morphs : {};
  return { version: j.version, modNames: j.modNames, custom: m.custom, sculptDivisor: m.sculptDivisor, sculpt: m.sculpt };
};
const fixesOf = (fixes) => (fixes || []).map((f) => `${f.code}:${f.n}`).join(',');

module.exports = { cases, encode, faceForm, fixesOf, jslot, face, HEAD, HAIR, KS, UNCACHED };
