// K on a client with the F3 journal (masterySystem onInfoRequest, preferJournal; the native census, 1 Nov): when the
// gameplay's journal takes the request the answer is { journal: true } and widget 25 is never sent, even when the
// journal refuses to open (in a fight: it says why in the chat and stays shut). A client that does not ask, a journal
// with no Skills section and a journal that does not take the tab still get widget 25. It bundles the real
// masterySystem.ts (settings and the espm scan stubbed), fakes the native server and sends the K packet. Run it from
// skymp5-server with node_modules present:
//
//   node tests/mastery-journal-k-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-masteryk-'));
process.on('exit', () => { try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

const stubSources = {
  '../settings': 'module.exports = { Settings: { get: async () => ({ dataDir: ".", loadOrder: [], allSettings: {} }) } };',
  './espmEditorIds': 'module.exports = { isEditorId: (s) => !String(s).includes(":"), resolveEditorIds: async () => ({ resolved: new Map(), unresolved: [], scannedMs: 0 }) };',
};
const stubFilter = new RegExp('^(' + Object.keys(stubSources).map((k) => k.replace(/[./-]/g, '\\$&')).join('|') + ')$');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };

const USER = 3, ACTOR = 0xff000013;
const props = { [ACTOR]: { appearance: { name: 'Kay' }, profileId: 13 } };
let packets = [];
const copy = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
const mp = {
  isConnected: (u) => u === USER,
  getUserActor: (u) => (u === USER ? ACTOR : 0),
  getUserByActor: (a) => (a === ACTOR ? USER : 65535),
  get: (a, k) => copy((props[a] || {})[k]),
  set: (a, k, v) => { (props[a] = props[a] || {})[k] = copy(v); },
  sendCustomPacket: (u, s) => packets.push({ u, p: JSON.parse(s) }),
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Test.esp`,
  lookupEspmRecordById: () => ({ record: null }),
  callPapyrusFunction: () => {},
};

// The gameplay's journal as masterySystem sees it. busy: it refuses to open (a fight), having said why; it still took it
const J = { open: false, busy: false, takes: true, asked: [] };
const journal = () => {
  globalThis.__dboJournalSections = { skills: { visible: () => true, view: () => null } };
  globalThis.__dboJournalLimited = (a, fn) => fn();
  globalThis.__dboJournalOpenTab = (a, tab) => { J.asked.push(tab); if (!J.takes) return false; if (!J.busy) J.open = true; return true; };
  globalThis.__dboJournalIsOpen = () => J.open;
};

(async () => {
  fs.writeFileSync(path.join(out, 'skills.json'), JSON.stringify({ tierHours: [0, 10, 30, 70, 150], tierNames: ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'], maxChosen: 3,
    skills: [{ id: 'miner', label: 'Miner', counts: {}, gates: {}, vanillaSkills: [] }] }));
  fs.writeFileSync(path.join(out, 'entry.ts'), `export { MasterySystem } from ${JSON.stringify(path.join(root, 'ts', 'systems', 'masterySystem'))};`);
  await esbuild.build({
    entryPoints: [path.join(out, 'entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'mastery.js'), logLevel: 'error', external: ['*.node'],
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: stubFilter }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubSources[a.path], loader: 'js' }));
    } }],
  });
  process.chdir(out);
  const { MasterySystem } = require(path.join(out, 'mastery.js'));
  const ctx = { svr: mp, gm: new EventEmitter() };
  const mastery = new MasterySystem(() => {});
  await mastery.initAsync(ctx);
  const k = (prefer) => {
    packets = [];
    mastery.customPacket(USER, 'masteryInfoRequest', Object.assign({ customPacketType: 'masteryInfoRequest' }, prefer ? { preferJournal: true } : {}), ctx);
    return packets.filter((x) => x.u === USER && x.p.customPacketType === 'masteryMenu').map((x) => x.p);
  };
  const widget = (r) => r.length === 1 && r[0].journal !== true && Array.isArray(r[0].skills);
  const toJournal = (r) => r.length === 1 && r[0].journal === true && r[0].skills === undefined;

  let r = k(true);
  check('no journal loaded: K gets widget 25', widget(r), r);

  journal();
  r = k(true);
  check('the journal opens on Skills: { journal: true }, no widget', toJournal(r) && J.asked.join() === 'skills' && J.open, r);
  J.open = false; J.busy = true;
  r = k(true);
  check('the journal refuses (a fight): still { journal: true }, never widget 25 behind it', toJournal(r) && !J.open, r);
  J.busy = false; J.takes = false;
  r = k(true);
  check('a journal that does not take the tab: widget 25', widget(r), r);
  J.takes = true; J.open = false; J.asked = [];
  r = k(false);
  check('a client that does not ask with preferJournal: widget 25, the journal not asked', widget(r) && J.asked.length === 0, r);
  delete globalThis.__dboJournalSections;
  r = k(true);
  check('a journal with no Skills section: widget 25', widget(r) && J.asked.length === 0, r);

  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL harness crashed: ' + (e && e.stack || e)); process.exit(1); });
