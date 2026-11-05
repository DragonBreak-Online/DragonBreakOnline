// tools/loadorder-migrate.py --presets (5 Nov): the RaceMenu face files' race ids after a load-order change (window-1021: nine
// faces kept 48xxxxxx after the DLE moved to 49). Runs the tool with python3 (or py) on made-up settings and files in a
// scratch folder: a dry run changes nothing; --write maps each race by plugin name, takes a raceDesc's race from it, leaves
// a face saved after --presets-before as it is, leaves one whose plugin is gone, adds raceDesc, backs the folder up and keeps
// every face's hash; the change forms pass works as before, alone or with it.
//   node tests/loadorder-migrate-presets-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'loadorder-migrate.py');
const P = require(path.join(ROOT, 'racemenupresets.js'));
let fails = 0;
const ok = (c, label, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${label}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 400)}`); if (!c) fails++; };
const PY = ['python3', 'python', 'py'].find((p) => { const r = spawnSync(p, ['--version'], { encoding: 'utf8' }); return r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`); });
if (!PY) { console.log('ok    skipped: no python 3 on this box'); process.exit(0); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-lomigrate-'));
const DLE = 'DragonBreak Online Edits.esp';
const MASTERS = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'];
// The DLE at 6 before and 7 after (a new plugin before it), Gone.esp dropped, a light plugin in both
const OLD = MASTERS.concat(['A.esp', DLE, 'Y.esp', 'Gone.esp', 'L.esl']);
const NEW = MASTERS.concat(['A.esp', 'N.esp', DLE, 'Y.esp', 'L.esl']);
fs.writeFileSync(path.join(TMP, 'old.json'), JSON.stringify({ loadOrder: OLD.map((n) => `Data/${n}`) }));
fs.writeFileSync(path.join(TMP, 'new.json'), JSON.stringify({ loadOrder: NEW.map((n) => `Data/${n}`) }));
fs.mkdirSync(path.join(TMP, 'data'));
const DIR = path.join(TMP, 'racemenu-presets');
fs.mkdirSync(DIR);
const faceText = (name) => P.encodeFace({ version: { signature: 1163086675, formatVersion: 3, skseVersion: 1, runtimeVersion: 2 }, modNames: ['Skyrim.esm'],
  custom: [{ name, value: 0.5 }], sculptDivisor: 10000, sculpt: [] });
// As racemenupresets.js writes them: compact, the face text raw (here with a letter past ASCII)
const put = (k, doc, name) => { const face = faceText(name || `Slider_${k}`); fs.writeFileSync(path.join(DIR, `${k}.json`), JSON.stringify(Object.assign({ v: 1, actor: k, profile: 7, hash: P.hashText(face), at: '2026-10-13T20:19:14.000Z', face }, doc))); };
put('ff000a01', { race: 0x06192ede }, 'Nase_é_Höhe');
put('ff000a02', { race: 0x13746 });
put('ff000a03', { race: 0x07000d62, at: '2026-10-25T08:00:00.000Z' });
put('ff000a04', { race: 0x07000800, raceDesc: '800:Y.esp' });
put('ff000a05', { race: 0x08000123 });
put('ff000a06', { race: 0xfe000800 });
put('ff000a07', { race: 0x06000d62, raceDesc: 'd62:Nowhere.esp' });
fs.writeFileSync(path.join(DIR, 'ff000a01.json.bad-2026-10-20T00-00-00-000Z-1-1'), '{"race":100000000}');
const CF = path.join(TMP, 'changeForms');
fs.mkdirSync(CF);
fs.writeFileSync(path.join(CF, 'c1.json'), JSON.stringify({ formDesc: 'abc:Skyrim.esm', appearanceDump: JSON.stringify({ raceId: 0x06192ede, headpartIds: [0x07000001] }) }));
const snapshot = (d) => Object.fromEntries(fs.readdirSync(d).sort().map((f) => [f, fs.readFileSync(path.join(d, f), 'utf8')]));
const run = (...args) => {
  const r = spawnSync(PY, [TOOL, path.join(TMP, 'old.json'), path.join(TMP, 'new.json'), ...args], { encoding: 'utf8', env: Object.assign({}, process.env, { DBO_DATA: path.join(TMP, 'data') }) });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const read = (k) => JSON.parse(fs.readFileSync(path.join(DIR, `${k}.json`), 'utf8'));

const before = snapshot(DIR);
let r = run('--presets', DIR, '--presets-before', '2026-10-21T00:00:00Z');
ok(r.code === 0 && /dry run; add --write/.test(r.out) && JSON.stringify(snapshot(DIR)) === JSON.stringify(before), 'a dry run (the default) reports and changes nothing', r.out);
ok(/ff000a01\.json race 6192ede -> 7192ede \(race moved\)/.test(r.out) && /ff000a04\.json race 7000800 -> 8000800 \(race from raceDesc\)/.test(r.out), 'it lists each race that moves, and why', r.out);
ok(/ff000a05\.json race 8000123: its plugin is not in the new order/.test(r.out) && /ff000a07\.json raceDesc d62:Nowhere\.esp is not in the new order/.test(r.out), 'it names the faces it leaves alone', r.out);
ok(/face files to change: 5/.test(r.out) && !/^files to change/m.test(r.out), 'five face files would change, and no change forms pass ran', r.out);

r = run('--presets', DIR, '--presets-before', '2026-10-21T00:00:00Z', '--write');
ok(r.code === 0 && /face files written 5/.test(r.out), '--write writes them', r.out);
const bak = fs.readdirSync(TMP).find((f) => f.startsWith('racemenu-presets.bak-loadorder-'));
ok(!!bak && JSON.stringify(snapshot(path.join(TMP, bak))) === JSON.stringify(before), '...after a full backup of the folder', bak);
let d = read('ff000a01');
ok(d.race === 0x07192ede && d.raceDesc === `192ede:${DLE}`, 'a face saved in the old order: its race mapped by plugin name, with raceDesc', [d.race.toString(16), d.raceDesc]);
ok(P.hashText(d.face) === d.hash && d.face === faceText('Nase_é_Höhe'), '...its face text and hash as they were', d.face);
d = read('ff000a02');
ok(d.race === 0x13746 && d.raceDesc === '13746:Skyrim.esm', 'a vanilla race stays, and gets raceDesc', d);
d = read('ff000a03');
ok(d.race === 0x07000d62 && d.raceDesc === `d62:${DLE}`, 'a face saved after --presets-before is in the new order already: its race stays', [d.race.toString(16), d.raceDesc]);
d = read('ff000a04');
ok(d.race === 0x08000800 && d.raceDesc === '800:Y.esp', 'a face with raceDesc takes its race from it', [d.race.toString(16), d.raceDesc]);
ok(read('ff000a05').race === 0x08000123 && !('raceDesc' in read('ff000a05')) && read('ff000a07').race === 0x06000d62, 'faces of a plugin gone, or a raceDesc the new order cannot name, are left alone');
d = read('ff000a06');
ok(d.race === 0xfe000800 && d.raceDesc === '800:L.esl', 'a light plugin\'s race keeps its 0xFE id, named by its own plugin', [d.race.toString(16), d.raceDesc]);
ok(fs.readFileSync(path.join(DIR, 'ff000a01.json.bad-2026-10-20T00-00-00-000Z-1-1'), 'utf8') === '{"race":100000000}' && !fs.readdirSync(DIR).some((f) => /\.tmp$/.test(f)),
  'files that are no face (a set-aside copy) are not touched, and no temporary file is left');
r = run('--presets', DIR, '--presets-before', '2026-10-21T00:00:00Z');
ok(/face files to change: 0/.test(r.out), 'a second run finds nothing to change', r.out);

// Read back as racemenupresets.js reads them
const A = 0xff000a01;
const sent = [];
const timers = {};
const ID = { [`192ede:${DLE}`]: 0x07192ede };
globalThis.__dboRaceMenuSaveGate = () => ({ ok: true });
require(path.join(ROOT, 'racemenupresets.js'))({
  mp: { get: (a, k) => ({ profileId: 7, appearance: { raceId: 0x13746 } })[k], getIdFromDesc: (x) => ID[x] || 0, lookupEspmRecordById: (id) => (id === 0x07192ede ? { record: { type: 'RACE' } } : null) },
  log: () => {}, cfg: { racemenuPresets: { dir: DIR, liveRace: false } }, sendPacket: (a, p) => { sent.push(p); return true; }, onlineActors: () => [A, 0xff000b02],
  actorOf: (u) => (u === 2 ? 0xff000b02 : 0), profileOf: () => 7, every: (n, ms, fn) => { timers[n] = fn; },
});
globalThis.__dboPresetPacket(2, { customPacketType: 'dboPresetGet', actor: A, have: '' });
setTimeout(() => {
  for (let i = 0; i < 10; i++) timers.racemenuPresetSend();
  const meta = sent.find((p) => p.customPacketType === 'dboPresetMeta');
  ok(!!meta && meta.race === 0x07192ede && meta.hash === read('ff000a01').hash, 'racemenupresets.js serves the migrated face, on its race', sent.map((p) => p.customPacketType));

  // The change forms pass, alone and with the faces
  r = run(CF);
  ok(r.code === 0 && /files to change: 1/.test(r.out) && !/face files/.test(r.out), 'the change forms pass alone runs as before', r.out);
  r = run(CF, '--presets', DIR, '--write');
  const c = JSON.parse(JSON.parse(fs.readFileSync(path.join(CF, 'c1.json'), 'utf8')).appearanceDump);
  ok(r.code === 0 && c.raceId === 0x07192ede && c.headpartIds[0] === 0x08000001 && /written 1/.test(r.out), 'both passes in one run', [r.out.slice(-300), c]);
  r = run('--presets-before', '2026-10-21');
  ok(r.code !== 0 && /--presets with it/.test(r.out), '--presets-before without --presets is refused', r.out);
  r = run();
  ok(r.code !== 0, 'no folder given: the usage, and nothing done');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* the scratch folder */ }
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
}, 300);
