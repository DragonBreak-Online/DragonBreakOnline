// Scripted test for racemenupresets.js: RaceMenu face presets per character, uploaded in chunks after RaceSexMenu,
// checked, written once per change to racemenu-presets/<actor>.json, served to watchers in paced chunks, a "have"
// answered with the header only, the owner's own face after a login, clears, rev notices, the profile check on read,
// tampered files, the off switch, rate limits and a hot reload. Runs against a fake mp in a scratch folder.
// 10 Oct review probes: S1 the off switch answers a plain none; S2 a vampire's face goes out with the race they have now;
// S3 a refused upload is named to the owner's client (dboPresetRefused); S4 the load line; R3 the content key; R6c a file
// that cannot be read is neither "none" nor written over.
// 10 Oct review 2: item 2 past the hourly limit a flood is told 3 times a minute at most; (a) a face counts only once its
// file is written, a failed write is refused, and the exit flush writes what is in the air; (b) a clear keeps the face as
// <key>.json.cleared-...; (c) a file that fails its checks is set aside as <key>.json.bad-... before it counts as none.
// 10 Oct review 2-e2e: E1 a load with the module off tells every client online to drop the faces it holds (the quick undo);
// E5 the 'face saved' line names the sculpt hosts and the look's head parts.
// 12 Oct re-review: server-data 3 a face download under way at the off switch stops there; R1 the drop notices go only at
// the load that turns faces off; R2 turned on again, each player online is told to ask for their own face again.
// Run it from this folder's parent:
//
//   node tests/racemenu-presets-harness.js
'use strict';
// The RaceMenu save window (appearance.js, 9 Oct) is open here: its own rules are tested in racemenu-save-gate-harness.js
globalThis.__dboRaceMenuSaveGate = () => ({ ok: true });
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MOD = path.join(ROOT, 'racemenupresets.js');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!ok) failures++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Until every file write and read under way is done (a loaded box takes longer than any fixed wait)
const settle = async () => {
  for (let i = 0; i < 300; i++) {
    await wait(10);
    const st = globalThis.__dboPresetState;
    if ((!st || !st.writing.size) && pendingReads === 0) break;
  }
  await wait(10);
};
let pendingReads = 0;
// failRead: an error code the next reads of A's file fail with (R6c)
let failRead = null;
{
  const realRead = fs.readFile;
  fs.readFile = (...x) => {
    pendingReads++; const cb = x[x.length - 1]; x[x.length - 1] = (...r) => { pendingReads--; cb(...r); };
    if (failRead && String(x[0]).endsWith(`${(0xff000a01).toString(16)}.json`)) { const e = new Error(`${failRead}: i/o error`); e.code = failRead; const done = x[x.length - 1]; setImmediate(() => done(e)); return undefined; }
    return realRead(...x);
  };
}
// Every editor the server opens is noted when it opens; a change to a saved face is taken only from one opened after the
// face went back to its owner this session (racemenu-save-gate-harness.js tests those rules; here the editor is open)
globalThis.__dboRaceMenuOpenedAt = new Map();
const editorOpen = () => { globalThis.__dboRaceMenuOpenedAt.set(0xff000a01, Date.now()); globalThis.__dboRaceMenuOpenedAt.set(0xff000b02, Date.now()); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-rmpresets-'));
const A = 0xff000a01, B = 0xff000b02, NPC = 0xff00c003;
const users = { 1: A, 2: B };
const props = { [A]: { profileId: 61, appearance: { raceId: 0x13746, headpartIds: [0x51623, 0x1a2b3, 0x07000d62] } }, [B]: { profileId: 7, appearance: { raceId: 0x13741 } }, [NPC]: { profileId: -1 } };
let online = [A, B];
const sent = [];
const logs = [];
const timers = {};
const mp = { get: (a, k) => (props[a >>> 0] || {})[k] };
const api = (extra) => ({
  mp, log: (...x) => logs.push(x.join(' ')), cfg: { racemenuPresets: Object.assign({ dir: path.join(TMP, 'racemenu-presets'), loadSettleMs: 0 }, extra || {}) },
  sendPacket: (a, p) => { sent.push({ to: a >>> 0, p }); return true; },
  onlineActors: () => online.slice(),
  actorOf: (u) => users[u] || 0,
  profileOf: (a) => { const v = (props[a >>> 0] || {}).profileId; return v === undefined ? -1 : v; },
  every: (name, ms, fn) => { timers[name] = fn; },
});
const load = (extra) => { delete require.cache[MOD]; return require(MOD)(api(extra)); };
const packet = (userId, p) => globalThis.__dboPresetPacket(userId, p);
const pumpAll = () => { for (let i = 0; i < 500; i++) timers.racemenuPresetSend(); };
const take = () => sent.splice(0, sent.length);
const fileOf = (a) => path.join(TMP, 'racemenu-presets', `${(a >>> 0).toString(16)}.json`);
// The copies kept beside A's file: <key>.json.<tag>-<time>-<pid>-<n>
const keptCopies = (tag) => fs.readdirSync(path.join(TMP, 'racemenu-presets'))
  .filter((f) => new RegExp(`^ff000a01\\.json\\.${tag}-\\d{4}-\\d\\d-\\d\\dT\\d\\d-\\d\\d-\\d\\d-\\d{3}Z-${process.pid}-\\d+$`).test(f)).sort()
  .map((f) => fs.readFileSync(path.join(TMP, 'racemenu-presets', f), 'utf8'));
// Until fn() holds, or ms pass
const until = async (fn, ms) => { for (let t = 0; t < ms && !fn(); t += 10) await wait(10); return fn(); };

const P = require(MOD);
const face = { version: { signature: 1163086675, formatVersion: 3, skseVersion: 1, runtimeVersion: 2 }, modNames: ['Skyrim.esm'], custom: [{ name: 'NoseBridge', value: 0.4 }], sculptDivisor: 10000,
  sculpt: [{ host: 'Actors\\Character\\Character Assets\\FemaleHeadChargen.tri', vertices: 9001, data: [[0, 120, -30, 5], [17, 0, 0, 10000]] }] };
const text = P.encodeFace(face);
const hash = P.hashText(text);
const upload = (userId, t, up, size) => {
  const parts = []; for (let i = 0; i < t.length; i += size || 12000) parts.push(t.slice(i, i + (size || 12000)));
  parts.forEach((data, i) => packet(userId, { customPacketType: 'dboPresetPut', up, i, n: parts.length, hash: P.hashText(t), race: 1, data }));
  return parts.length;
};

(async () => {
  let M = load();
  check('the packet handler is installed', typeof globalThis.__dboPresetPacket === 'function');
  check('S4: the load is logged with the switch, who it is for and the race families', logs.some((l) => /^racemenupresets on, every player, requireEditor on, \d+ race ids in vampire families$/.test(l)) && M.sameFamily(0x13746, 0x88794) && !M.sameFamily(0x13746, 0x13741),
    logs.filter((l) => /racemenupresets/.test(l)));

  // ---- an upload ----
  upload(1, text, 1);
  await settle();
  check('the face is written to racemenu-presets/<actor>.json', fs.existsSync(fileOf(A)));
  const doc = JSON.parse(fs.readFileSync(fileOf(A), 'utf8'));
  check('the file holds the face, its hash, the profile and the server-side race', doc.face === text && doc.hash === hash && doc.profile === 61 && doc.race === 0x13746 && doc.actor === 'ff000a01', doc);
  // E5 (10 Oct review 2-e2e G8): skee shows a sculpt only on a head whose .tri is its host, so the line names the hosts (with
  // the vertices each moves) and the look's head parts, for staff checking a sculpt that does not show (and its charge)
  check('E5: the \'face saved\' line names the sculpt hosts and the look\'s headpartIds',
    logs.includes(`racemenu presets: ff000a01 (profile 61) face saved, ${text.length} chars, ${hash}, sculpt hosts [Actors\\Character\\Character Assets\\FemaleHeadChargen.tri (2)], headpartIds [51623 1a2b3 7000d62]`),
    logs.filter((l) => /face saved/.test(l)));
  let s = take();
  check('everyone else online hears a rev notice, the owner does not', s.length === 1 && s[0].to === B && s[0].p.customPacketType === 'dboPresetRev' && s[0].p.hash === hash && s[0].p.actor === A, s);

  // ---- a watcher asks ----
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' });
  await settle();
  check('nothing is sent before the pump (paced)', take().length === 0);
  timers.racemenuPresetSend();
  s = take();
  check('one packet per pump per recipient, the header first', s.length === 1 && s[0].p.customPacketType === 'dboPresetMeta' && s[0].p.hash === hash && s[0].p.race === 0x13746, s);
  pumpAll();
  s = take();
  check('then the chunks, which join back to the face', s.length === 1 && s[0].p.customPacketType === 'dboPresetChunk' && s[0].p.n === 1 && s[0].p.data === text && s[0].p.race === 0x13746, s.length);
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: hash });
  await settle(); pumpAll();
  s = take();
  check('a client that has this hash gets the header only', s.length === 1 && s[0].p.customPacketType === 'dboPresetMeta', s);

  // ---- the owner after a login ----
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' });
  await settle(); pumpAll();
  s = take();
  check('actor 0 is the asker\'s own face, marked self', s.length === 2 && s.every((x) => x.to === A && x.p.self === true && x.p.actor === A) && s[1].p.data === text, s.map((x) => x.p.customPacketType));

  // ---- none ----
  packet(1, { customPacketType: 'dboPresetGet', actor: B, have: '' });
  await settle(); pumpAll();
  s = take();
  check('a character without a face: none', s.length === 1 && s[0].p.customPacketType === 'dboPresetNone' && s[0].p.actor === B, s);
  packet(1, { customPacketType: 'dboPresetGet', actor: NPC, have: '' });
  await settle(); pumpAll();
  s = take();
  check('a server NPC is never looked up: none', s.length === 1 && s[0].p.customPacketType === 'dboPresetNone' && !fs.existsSync(fileOf(NPC)), s);

  // ---- refusals ----
  packet(2, { customPacketType: 'dboPresetPut', up: 1, i: 0, n: 1, hash: '00000000', race: 1, data: text });
  await settle();
  check('an upload that does not match its hash is refused', !fs.existsSync(fileOf(B)) && logs.some((l) => /does not match its hash/.test(l)));
  const evil = JSON.parse(text); evil.sculpt[0].data[0][0] = 65000;
  upload(2, JSON.stringify(evil), 2);
  await settle();
  check('an upload whose sculpt index is past its vertex count is refused', !fs.existsSync(fileOf(B)) && logs.some((l) => /breaks the preset rules/.test(l)));
  s = take().filter((x) => x.p.customPacketType === 'dboPresetRefused');
  check('S3: both are named to the uploader (dboPresetRefused: actor, self, the upload\'s hash, reason hash / rules)',
    s.length === 2 && s.every((x) => x.to === B && x.p.actor === B && x.p.self === true) && s[0].p.hash === '00000000' && s[0].p.reason === 'hash'
    && s[1].p.hash === P.hashText(JSON.stringify(evil)) && s[1].p.reason === 'rules', s.map((x) => x.p));
  packet(2, { customPacketType: 'dboPresetPut', up: 3, i: 0, n: 999, hash, race: 1, data: 'x' });
  packet(2, { customPacketType: 'dboPresetPut', up: 3, i: 0, n: 1, hash, race: 1, data: 'x'.repeat(12001) });
  check('silly chunk counts and oversize chunks are ignored', !M.state.uploads.has(B));

  // ---- beast form and the race ----
  globalThis.__dboBeastOriginalRace = (a) => (a === A ? 0x13746 : 0);
  const beastMtime = fs.statSync(fileOf(A)).mtimeMs;
  upload(1, P.encodeFace({ ...face, custom: [{ name: 'NoseBridge', value: 0.9 }] }), 40);
  await settle();
  check('an upload in a beast form is refused (the appearance race is the beast\'s)', fs.statSync(fileOf(A)).mtimeMs === beastMtime && logs.some((l) => /beast form, refused/.test(l)));
  check('S3: ...and named to the owner (reason beast)', sent.some((x) => x.to === A && x.p.customPacketType === 'dboPresetRefused' && x.p.reason === 'beast'));
  delete globalThis.__dboBeastOriginalRace;
  const noRace = props[B].appearance; props[B].appearance = undefined;
  upload(2, text, 41);
  await settle();
  check('an upload from a character with no appearance race is refused', !fs.existsSync(fileOf(B)) && logs.some((l) => /no appearance race/.test(l)));
  props[B].appearance = noRace;
  take();

  // ---- multi-chunk, out of order ----
  const bigFace = JSON.parse(JSON.stringify(face)); bigFace.sculpt[0].data = new Array(5000).fill(0).map((_, i) => [i, 100, -100, i]);
  const bigText = P.encodeFace(bigFace);
  const parts = []; for (let i = 0; i < bigText.length; i += 12000) parts.push(bigText.slice(i, i + 12000));
  [...parts.keys()].reverse().forEach((i) => packet(2, { customPacketType: 'dboPresetPut', up: 4, i, n: parts.length, hash: P.hashText(bigText), race: 1, data: parts[i] }));
  await settle();
  check(`a ${parts.length}-chunk upload in any order is stored`, fs.existsSync(fileOf(B)) && JSON.parse(fs.readFileSync(fileOf(B), 'utf8')).face === bigText);
  take();
  packet(1, { customPacketType: 'dboPresetGet', actor: B, have: '' });
  await settle();
  let n = 0; for (let i = 0; i < 3; i++) { timers.racemenuPresetSend(); n += take().length; }
  check('a big face goes out one chunk per pump, not in a burst', n === 3);
  pumpAll(); take();

  // ---- unchanged and cleared ----
  const mtime = fs.statSync(fileOf(A)).mtimeMs;
  await settle();
  upload(1, text, 5);
  await settle();
  check('the same face again writes nothing and tells nobody', fs.statSync(fileOf(A)).mtimeMs === mtime && take().length === 0);
  // R3: the same face with one more plugin, another skse version and skee's maps in another order is the same face
  editorOpen();
  const twice = { ...face, custom: [{ name: 'NoseBridge', value: 0.4 }, { name: 'BrowUp', value: 0.2 }], sculpt: [{ ...face.sculpt[0], data: face.sculpt[0].data.slice() }] };
  upload(1, P.encodeFace(twice), 50); await settle(); take();
  const mtime2 = fs.statSync(fileOf(A)).mtimeMs;
  const shuffled = { ...twice, version: { ...twice.version, skseVersion: 7 }, modNames: ['Skyrim.esm', 'Update.esm'], custom: twice.custom.slice().reverse(),
    sculpt: [{ ...twice.sculpt[0], host: twice.sculpt[0].host.toUpperCase().replace(/\.TRI$/, '.tri'), data: twice.sculpt[0].data.slice().reverse() }] };
  upload(1, P.encodeFace(shuffled), 51); await settle();
  check('R3: the same face content in another text (plugins, version, order, host case) writes nothing and tells nobody',
    fs.statSync(fileOf(A)).mtimeMs === mtime2 && take().length === 0 && P.hashText(P.encodeFace(shuffled)) !== P.hashText(P.encodeFace(twice)));
  check('R3: a stored file\'s content key is worked out from its face (never taken from the file)', typeof P.contentOf === 'function' && M.state.cache.get('ff000a01').content === P.contentOf(P.faceFrom(twice)));
  upload(1, text, 52); await settle(); take();
  editorOpen();
  const beforeClear = fs.readFileSync(fileOf(A), 'utf8');
  packet(1, { customPacketType: 'dboPresetPut', up: 6, i: 0, n: 0, hash: '', race: 1, data: '' });
  await settle();
  s = take();
  check('a clear removes the file and sends an empty rev', !fs.existsSync(fileOf(A)) && s.length === 1 && s[0].p.customPacketType === 'dboPresetRev' && s[0].p.hash === '', s);
  check('(b): ...and keeps the face it removed, as <key>.json.cleared-<time>-<pid>-<n>, as it was (a mistaken GM /chargen or reroll clear can be undone)',
    JSON.stringify(keptCopies('cleared')) === JSON.stringify([beforeClear]) && logs.some((l) => /ff000a01 \(profile 61\) face cleared, kept as ff000a01\.json\.cleared-/.test(l)), [keptCopies('cleared').length, logs.slice(-1)]);
  const emptyFace = P.encodeFace({ ...face, custom: [], sculpt: [] });
  upload(1, text, 7); await settle(); take();
  editorOpen();
  const beforeClear2 = fs.readFileSync(fileOf(A), 'utf8');
  upload(1, emptyFace, 8); await settle();
  check('an upload of a face with nothing in it is a clear', !fs.existsSync(fileOf(A)));
  check('(b): a second clear keeps its own copy beside the first (never the same name)', keptCopies('cleared').length === 2 && keptCopies('cleared').includes(beforeClear2), keptCopies('cleared').length);
  take();

  // ---- what is read from disk ----
  upload(1, text, 9); await settle(); take();
  M.state.cache.clear();
  props[A].profileId = 99;
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' });
  await settle(); pumpAll();
  s = take();
  check('a file another profile wrote is none (a reused actor id)', s.length === 1 && s[0].p.customPacketType === 'dboPresetNone', s);
  props[A].profileId = 61;
  M.state.cache.clear();
  const tampered = JSON.parse(fs.readFileSync(fileOf(A), 'utf8')); tampered.face = tampered.face.replace('120', '121');
  fs.writeFileSync(fileOf(A), JSON.stringify(tampered));
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' });
  await settle(); pumpAll();
  s = take();
  check('a file edited by hand (hash no longer matches) is none', s.length === 1 && s[0].p.customPacketType === 'dboPresetNone' && logs.some((l) => /fails its checks/.test(l)), s);
  check('(c): ...once it is set aside, as <key>.json.bad-<time>-<pid>-<n> and as it was, so the next save cannot replace it unseen',
    !fs.existsSync(fileOf(A)) && JSON.stringify(keptCopies('bad')) === JSON.stringify([JSON.stringify(tampered)]) && logs.some((l) => /ff000a01\.json fails its checks, ignored, kept as ff000a01\.json\.bad-/.test(l)),
    [keptCopies('bad').length, logs.slice(-2)]);
  // One that does not even parse: set aside too, beside the first (another name)
  fs.writeFileSync(fileOf(A), '{oops'); M.state.cache.clear();
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' });
  await settle(); pumpAll();
  s = take();
  check('(c): a file that will not parse is set aside too (both copies kept), then none', s.length === 1 && s[0].p.customPacketType === 'dboPresetNone' && !fs.existsSync(fileOf(A))
    && keptCopies('bad').length === 2 && keptCopies('bad').includes('{oops'), [s, keptCopies('bad')]);
  // One that cannot be moved: not none (not answered), and an upload over it is refused, the file left as it is
  fs.writeFileSync(fileOf(A), '{oops again'); M.state.cache.clear(); logs.length = 0;
  {
    const realRename = fs.rename;
    fs.rename = (from, to, cb) => (String(from) === fileOf(A) && /\.bad-/.test(String(to)) ? setImmediate(() => cb(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))) : realRename(from, to, cb));
    try {
      packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' });
      await settle(); pumpAll();
      check('(c): a bad file that cannot be set aside is not none: not answered, not cached', take().length === 0 && !M.state.cache.has('ff000a01')
        && logs.some((l) => /ff000a01\.json unreadable, and could not be set aside \(EACCES\): not taken as none/.test(l)), logs.slice(-1));
      editorOpen();
      upload(1, text, 59); await settle();
      s = take();
      check('(c): ...an upload over it is refused (unreadable) and the file is left as it is', fs.readFileSync(fileOf(A), 'utf8') === '{oops again'
        && s.some((x) => x.to === A && x.p.customPacketType === 'dboPresetRefused' && x.p.reason === 'unreadable'), s.map((x) => x.p));
    } finally { fs.rename = realRename; }
  }
  fs.rmSync(fileOf(A)); M.state.cache.clear();

  // ---- rate limits ----
  M = load({ getsPerMinute: 5 });
  M.state.rates.clear();
  take();
  let reads = 0;
  const realRead = fs.readFile;
  M.state.cache.clear();
  fs.readFile = (...x) => { reads++; return realRead(...x); };
  for (let i = 0; i < 9; i++) { M.state.cache.clear(); packet(2, { customPacketType: 'dboPresetGet', actor: B, have: 'x' }); }
  await settle(); pumpAll();
  fs.readFile = realRead;
  check('gets past the per-minute limit are dropped', reads === 5 && M.state.rates.get(`get:${B}`).length === 5, reads);
  check('answers about one character replace each other in the queue', take().filter((x) => x.p.customPacketType === 'dboPresetMeta').length === 1);
  M = load({ uploadsPerHour: 2 });
  M.state.rates.clear();
  editorOpen();
  for (let up = 20; up < 25; up++) upload(1, P.encodeFace({ ...face, custom: [{ name: 'N', value: up / 100 }] }), up);
  await settle();
  const kept = JSON.parse(fs.readFileSync(fileOf(A), 'utf8'));
  check('uploads past the hourly limit are dropped', JSON.parse(kept.face).custom[0].value === 0.21, JSON.parse(kept.face).custom);
  s = take().filter((x) => x.p.customPacketType === 'dboPresetRefused');
  check('S3: each upload past the limit is named to its owner once (reason rate)', s.length === 3 && s.every((x) => x.to === A && x.p.reason === 'rate' && /^[0-9a-f]{8}$/.test(x.p.hash)), s.map((x) => x.p));
  // Item 2: one hostile client past the hourly limit, 400 upload starts (the flood guard lets 40 a second through): told
  // at most 3 times a minute, in the log and in packets
  M.state.rates.clear(); take(); logs.length = 0;
  for (let i = 0; i < 400; i++) packet(1, { customPacketType: 'dboPresetPut', up: 1000 + i, i: 0, n: 2, hash: 'deadbeef', race: 1, data: 'x' });
  await settle();
  s = take().filter((x) => x.p.customPacketType === 'dboPresetRefused');
  const rateLines = logs.filter((l) => /uploads an hour/.test(l)).length;
  check(`item 2: 400 junk upload starts past the limit: told at most 3 times a minute (${rateLines} log lines, ${s.length} packets)`,
    rateLines === 3 && s.length === 3 && s.every((x) => x.to === A && x.p.reason === 'rate'), [rateLines, s.length]);

  // ---- memory bounds ----
  M = load({ queuePerRecipient: 3 });
  take();
  M.state.queues.clear();
  packet(1, { customPacketType: 'dboPresetGet', actor: B, have: '' });
  await settle();
  check('an answer bigger than the per-recipient queue bound is not queued (the client asks again)', !M.state.queues.has(A) || M.state.queues.get(A).length <= 3, (M.state.queues.get(A) || []).length);
  M = load({ cacheChars: 10 });
  M.state.cache.clear();
  packet(1, { customPacketType: 'dboPresetGet', actor: A, have: '' });
  packet(1, { customPacketType: 'dboPresetGet', actor: B, have: '' });
  await settle();
  check('the read cache keeps under its character bound (one entry at least)', M.state.cache.size === 1, M.state.cache.size);
  pumpAll(); take();

  // ---- S2: a face saved before a vampire turn (or a cure) goes out with the race the character has now ----
  M = load(); M.state.cache.clear(); take();
  props[A].appearance = { raceId: 0x88794 };   // NordRace's vampire
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' });
  await settle(); pumpAll();
  s = take();
  check('S2: a watcher gets A\'s Nord face with A\'s vampire race (header and chunks)', s.length === 2 && s.every((x) => x.p.race === 0x88794) && JSON.parse(fs.readFileSync(fileOf(A), 'utf8')).race === 0x13746, s.map((x) => x.p.race));
  props[A].appearance = { raceId: 0xcdd84 };   // a werewolf: not the face's race, the stored one goes
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' });
  await settle(); pumpAll();
  s = take();
  check('S2: a race of another family (a beast form) keeps the stored race', s.length === 2 && s.every((x) => x.p.race === 0x13746), s.map((x) => x.p.race));
  props[A].appearance = { raceId: 0x13746 };

  // ---- R6c: a file that is there but cannot be read (EIO, EMFILE) is not "none": not cached, not answered, not written over ----
  M.state.cache.clear(); take(); logs.length = 0;
  const savedText = fs.readFileSync(fileOf(A), 'utf8');
  failRead = 'EIO';
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' });
  await settle(); pumpAll();
  check('R6c: a get for a face that cannot be read is not answered, and nothing is cached', take().length === 0 && !M.state.cache.has('ff000a01') && logs.some((l) => /could not be read \(EIO\)/.test(l)), logs.slice(-1));
  editorOpen();
  upload(1, P.encodeFace({ ...face, custom: [{ name: 'NoseBridge', value: -0.7 }] }), 60);
  await settle();
  s = take();
  check('R6c: an upload over it is refused (saved face unreadable, not changed) and named to the owner', fs.readFileSync(fileOf(A), 'utf8') === savedText
    && logs.some((l) => /face change not saved: saved face unreadable, not changed/.test(l)) && s.some((x) => x.to === A && x.p.customPacketType === 'dboPresetRefused' && x.p.reason === 'unreadable'), s.map((x) => x.p));
  failRead = null;
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' });
  await settle(); pumpAll();
  s = take();
  check('R6c: once it reads again the face is served', s.length === 2 && s[1].p.data === JSON.parse(savedText).face, s.map((x) => x.p.customPacketType));

  // ---- 10 Oct review 2, (a): a face counts only once its file is on disk ----
  M.state.cache.clear(); M.state.rates.clear(); take(); logs.length = 0;
  const diskBefore = fs.readFileSync(fileOf(A), 'utf8');
  {
    const realWF = fs.writeFile;
    fs.writeFile = (f, d, cb) => (String(f) === `${fileOf(A)}.tmp` ? setImmediate(() => cb(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }))) : realWF(f, d, cb));
    const failing = P.encodeFace({ ...face, custom: [{ name: 'NoseBridge', value: 0.55 }] });
    try { editorOpen(); upload(1, failing, 70); await settle(); } finally { fs.writeFile = realWF; }
    s = take();
    check('(a): a face whose write fails (ENOSPC) is not saved: the file is as it was, no tmp left, nobody else hears of it',
      fs.readFileSync(fileOf(A), 'utf8') === diskBefore && !fs.existsSync(`${fileOf(A)}.tmp`) && !s.some((x) => x.p.customPacketType === 'dboPresetRev')
      && logs.some((l) => /write ff000a01 failed \(ENOSPC\)/.test(l)) && !logs.some((l) => /face saved/.test(l)), [s.map((x) => x.p), logs]);
    check('(a): ...the owner\'s client is told (dboPresetRefused, reason write, the upload\'s hash), so it puts the server\'s face back',
      s.some((x) => x.to === A && x.p.customPacketType === 'dboPresetRefused' && x.p.reason === 'write' && x.p.hash === P.hashText(failing)), s.map((x) => x.p));
    packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' });
    await settle(); pumpAll();
    s = take();
    check('(a): ...and the face served is the one on disk, not the one that failed', s.length === 2 && s[0].p.hash === JSON.parse(diskBefore).hash, s.map((x) => x.p.hash));
  }
  // SIGTERM: a face in the air (being written, or waiting) is written at once through gamemode.js __dboFlushOnExit
  {
    let baseFlushes = 0;
    const baseFlush = () => { baseFlushes++; };
    globalThis.__dboFlushOnExit = baseFlush;
    M = load(); M = load();
    check('(a): the module chains its face writes onto gamemode\'s exit flush, once however often it loads', globalThis.__dboFlushOnExit !== baseFlush && globalThis.__dboFlushOnExit.__dboPresetFlush === true);
    check('(a): nothing in the air: the flush writes nothing', globalThis.__dboPresetFlush() === false);
    M.state.rates.clear(); take(); logs.length = 0;
    // Hold the next write of A's face in the air: its tmp is written, then its callback waits
    let held = null;
    const realWF = fs.writeFile;
    fs.writeFile = (f, d, cb) => (String(f) === `${fileOf(A)}.tmp` && !held ? realWF(f, d, (e) => { held = () => cb(e); }) : realWF(f, d, cb));
    const f1 = P.encodeFace({ ...face, custom: [{ name: 'NoseBridge', value: 0.61 }] });
    const f2 = P.encodeFace({ ...face, custom: [{ name: 'NoseBridge', value: 0.62 }] });
    try {
      editorOpen(); upload(1, f1, 80);
      await until(() => held, 3000);
      upload(1, f2, 81);
      await until(() => M.state.writing.get('ff000a01') && M.state.writing.get('ff000a01').next !== undefined, 3000);
      check('(a): (one face being written, a newer one waiting)', !!held && M.state.writing.get('ff000a01').next.hash === P.hashText(f2) && JSON.parse(fs.readFileSync(fileOf(A), 'utf8')).hash === JSON.parse(diskBefore).hash);
      globalThis.__dboFlushOnExit();
      s = take();
      check('(a): the exit flush runs gamemode\'s saves, then writes the newest face at once (tmp, flushed, renamed), and it is announced',
        baseFlushes === 1 && JSON.parse(fs.readFileSync(fileOf(A), 'utf8')).hash === P.hashText(f2) && !fs.existsSync(`${fileOf(A)}.exit.tmp`)
        && logs.some((l) => new RegExp(`face saved, \\d+ chars, ${P.hashText(f2)}`).test(l)) && s.some((x) => x.to === B && x.p.customPacketType === 'dboPresetRev' && x.p.hash === P.hashText(f2)), [logs, s.map((x) => x.p)]);
    } finally { fs.writeFile = realWF; }
    held();
    await settle();
    check('(a): if the process goes on, the write that was in the air leaves no older face behind', JSON.parse(fs.readFileSync(fileOf(A), 'utf8')).hash === P.hashText(f2) && !M.state.writing.size);
    // A clear waiting behind a write in the air: the flush clears (and keeps the copy)
    held = null; take();
    fs.writeFile = (f, d, cb) => (String(f) === `${fileOf(A)}.tmp` && !held ? realWF(f, d, (e) => { held = () => cb(e); }) : realWF(f, d, cb));
    const copiesBefore = keptCopies('cleared').length;
    try {
      editorOpen(); upload(1, f1, 82);
      await until(() => held, 3000);
      packet(1, { customPacketType: 'dboPresetPut', up: 83, i: 0, n: 0, hash: '', race: 1, data: '' });
      await until(() => M.state.writing.get('ff000a01') && M.state.writing.get('ff000a01').next === null, 3000);
      globalThis.__dboFlushOnExit();
      check('(a): a clear waiting at exit is done by the flush, the face kept as a .cleared copy', baseFlushes === 2 && !fs.existsSync(fileOf(A)) && keptCopies('cleared').length === copiesBefore + 1);
    } finally { fs.writeFile = realWF; }
    held();
    await settle();
    check('(a): ...and stays cleared once the write in the air lands', !fs.existsSync(fileOf(A)) && !M.state.writing.size, fs.existsSync(fileOf(A)));
    const baseFlush2 = () => {};
    globalThis.__dboFlushOnExit = baseFlush2;   // a gamemode reload puts its own flush back
    M = load();
    check('(a): after a gamemode reload it chains onto the new flush', globalThis.__dboFlushOnExit !== baseFlush2 && globalThis.__dboFlushOnExit.__dboPresetFlush === true);
    delete globalThis.__dboFlushOnExit;
    editorOpen(); upload(1, text, 84); await settle(); take();   // A has a face again for what follows
  }

  // ---- hot reload and the off switch ----
  const before = globalThis.__dboPresetState;
  M = load();
  check('a hot reload keeps the state (uploads, queues, cache)', globalThis.__dboPresetState === before);
  check('E1: a load with the module on sends no drop notices', !take().some((x) => x.p.customPacketType === 'dboPresetRev'));
  // 12 Oct re-review, server-data 3 (its probe e1-inflight): a download under way at the switch. A asks for B's big face;
  // its header and first chunk go and the rest waits in A's queue. B asks for A's face, and that file read is still under
  // way when the module is switched off
  const bigDoc = { v: 1, actor: 'ff000b02', profile: 7, race: 0x13741, hash: P.hashText(bigText), at: new Date().toISOString(), face: bigText };
  fs.writeFileSync(fileOf(B), JSON.stringify(bigDoc));
  M.state.cache.clear();
  packet(1, { customPacketType: 'dboPresetGet', actor: B, have: '' });
  await settle();
  timers.racemenuPresetSend(); timers.racemenuPresetSend();
  s = take();
  check('server-data 3 (setup): B\'s face goes to A one chunk per pump, and the rest of it is still queued',
    s.length === 2 && s[0].p.customPacketType === 'dboPresetMeta' && s[1].p.customPacketType === 'dboPresetChunk' && s[1].p.n > 2 && (M.state.queues.get(A) || []).length >= 2,
    [s.map((x) => x.p.customPacketType), (M.state.queues.get(A) || []).length]);
  M.state.cache.delete('ff000a01');
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' });
  const readUnderWay = pendingReads > 0;
  M = load({ enabled: false });
  const queuedAfter = (M.state.queues.get(A) || []).length;
  // E1 (10 Oct review 2-e2e G10): the quick undo. A 0.3.90 watcher keeps a fetched face 10 min and goes on loading it onto
  // new copies; switched off, each client online is told every other character online has no face now (hash ''), and so
  // drops what it holds and asks again (answered none). Never told about itself
  s = take();
  check('E1: switched off by a load: each player online is told every other player online has no face now (dboPresetRev, hash \'\')',
    s.length === 2 && s.some((x) => x.to === B && x.p.customPacketType === 'dboPresetRev' && x.p.actor === A && x.p.hash === '')
    && s.some((x) => x.to === A && x.p.customPacketType === 'dboPresetRev' && x.p.actor === B && x.p.hash === ''), s);
  check('E1: ...never about themselves, and logged', !s.some((x) => x.to === x.p.actor) && logs.some((l) => /^racemenu presets: off, so 2 player\(s\) online were told to drop the faces they hold \(2 notice\(s\)\)$/.test(l)), logs.slice(-3));
  check('E1: ...and nothing on disk changes', fs.existsSync(fileOf(A)));
  await settle(); pumpAll();
  s = take();
  check('server-data 3: no more of B\'s face reaches A after the switch (the queue was emptied), and nothing of A\'s face reaches B from the read under way then',
    readUnderWay && queuedAfter === 0 && !s.some((x) => x.p.customPacketType === 'dboPresetMeta' || x.p.customPacketType === 'dboPresetChunk') && M.state.queues.size === 0,
    [readUnderWay, queuedAfter, s.map((x) => [x.to.toString(16), x.p.customPacketType, (x.p.actor >>> 0).toString(16)])]);
  packet(2, { customPacketType: 'dboPresetGet', actor: A, have: '' });
  await settle(); pumpAll();
  s = take();
  check('S1: switched off: every get is answered a plain none, never off (a 0.3.90 client keeps off until Skyrim restarts)', s.length === 1 && s[0].p.customPacketType === 'dboPresetNone' && s[0].p.off === undefined, s);
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' });
  await settle(); pumpAll();
  s = take();
  check('S1: switched off: the owner\'s own get too (self, no off)', s.length === 1 && s[0].p.customPacketType === 'dboPresetNone' && s[0].p.self === true && s[0].p.off === undefined, s);
  const m2 = fs.statSync(fileOf(A)).mtimeMs;
  upload(1, text, 30); await settle();
  check('switched off: uploads are ignored, and nothing is sent back', fs.statSync(fileOf(A)).mtimeMs === m2 && take().length === 0);
  check('S4: the off switch is in the load line', logs.some((l) => /^racemenupresets off, requireEditor on/.test(l)));
  // R1 (12 Oct re-review): the drop notices go only at the load that turns faces off. A gameplay hot reload while off
  // sent all N*(N-1) of them again (1560 with 40 online)
  const offLines = () => logs.filter((l) => /^racemenu presets: off, so/.test(l)).length;
  const offLinesBefore = offLines();
  M = load({ enabled: false });
  s = take();
  check('R1: a hot reload while off sends no drop notices again, and logs none', !s.some((x) => x.p.customPacketType === 'dboPresetRev') && offLines() === offLinesBefore, s);
  // R2 (12 Oct re-review, its S13e): on again after an off load, each player online is told to ask for their own face again
  // (the 'none' each was answered while off is never asked again by the client, so the saved face stayed off and every
  // change was refused 'notloaded' until a relog)
  M = load({ testProfiles: [7] });
  s = take();
  check('R2: on again: each player online is told once to ask for their own face again (dboPresetRev about themselves, self, hash on), and it is logged',
    s.length === 2 && s.every((x) => x.p.customPacketType === 'dboPresetRev' && x.p.self === true && x.p.hash === 'on' && x.p.actor === x.to) && new Set(s.map((x) => x.to)).size === 2
    && logs.some((l) => /^racemenu presets: on again, so 2 player\(s\) online were told to ask for their own face again$/.test(l)), s);
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' });
  await settle(); pumpAll();
  s = take();
  check('S1: left out of a staff test: a plain none, never off', s.length === 1 && s[0].p.customPacketType === 'dboPresetNone' && s[0].p.self === true && s[0].p.off === undefined, s);
  packet(1, { customPacketType: 'dboPresetSomething' });
  check('an unknown dboPreset type is ignored quietly', true);
  M = load();
  s = take();
  check('R1/R2: a hot reload while on tells nobody anything', !s.some((x) => x.p.customPacketType === 'dboPresetRev'), s);
  // What the client does with R2's notice: it asks for its own face, which goes back on and counts as put back
  M.state.selfSent.delete(A);
  packet(1, { customPacketType: 'dboPresetGet', actor: 0, have: '' });
  await settle(); pumpAll();
  s = take();
  check('R2: ...and the owner\'s get that follows is answered with their saved face, counted as put back (no more notloaded)',
    s.some((x) => x.to === A && x.p.self === true && x.p.customPacketType === 'dboPresetChunk' && x.p.data === text) && M.state.selfSent.has(A), s.map((x) => x.p.customPacketType));
  online = [B];
  M = load();
  packet(2, { customPacketType: 'dboPresetGet', actor: B, have: '' });
  online = [];
  await settle(); pumpAll();
  check('a recipient who left gets nothing and the queue is dropped', take().length === 0 && M.state.queues.size === 0);

  // Upload gap (12 Oct, claude-jake): every finished upload leaves one log line. An empty face with none stored and an
  // unchanged face were dropped without one, so the live log could not tell a client that sent an empty face from one that
  // sent nothing (Elaava #Z63J 06:14:56, Foratus #553K 08:11:16: /appearance closes with no 'racemenu presets' line)
  const C3 = 0xff000c03;
  users[3] = C3; props[C3] = { profileId: 77, appearance: { raceId: 0x13742, headpartIds: [0x5161c] } };
  online = [A, B, C3];
  M = load();
  take();
  globalThis.__dboRaceMenuSaveWindows = new Map([[C3, { at: Date.now(), until: Date.now() + 90000, kind: 'appearance', charge: true, headswap: true }]]);
  const gapLines = () => logs.filter((l) => /^racemenu presets: ff000c03 /.test(l));
  packet(3, { customPacketType: 'dboPresetPut', up: 1, i: 0, n: 0, hash: '', race: 1, data: '' });
  await settle();
  check('upload gap: an empty face with none stored is logged, with the editor window it came from',
    gapLines().length === 1 && /^racemenu presets: ff000c03 \(profile 77\) empty face \(no RaceMenu slider or sculpt\), none stored: nothing to save \(appearance window, priced, head swapped\)$/.test(gapLines()[0]), gapLines());
  check('upload gap: ...and nothing is written, refused or sent for it', !fs.existsSync(fileOf(C3)) && take().length === 0);
  const c3face = Object.assign({}, face, { custom: [{ name: 'EFM_Ears', value: 0.5 }], sculpt: [], sculptDivisor: 10000 });
  const c3text = P.encodeFace(c3face);
  upload(3, c3text, 2);
  await settle();
  check('upload gap: a first face from that window is saved as before (one face saved line)', fs.existsSync(fileOf(C3)) && gapLines().length === 2 && /face saved/.test(gapLines()[1]), gapLines());
  M.state.selfSent.set(C3, { at: 0, conn: 0 });
  upload(3, c3text, 3);
  await settle();
  check('upload gap: the same face again is logged as unchanged, nothing written', gapLines().length === 3 && /^racemenu presets: ff000c03 \(profile 77\) face unchanged \([0-9a-f]{8}\), nothing written \(appearance window, priced, head swapped\)$/.test(gapLines()[2]), gapLines());
  for (let k = 0; k < 6; k++) packet(3, { customPacketType: 'dboPresetPut', up: 'x', i: 0, n: 1, hash: 'zz', data: 'a' });
  const dropped = gapLines().filter((l) => /upload chunk dropped: bad header \(up "x", n 1, 1 chars\)$/.test(l));
  check('upload gap: a malformed chunk is logged, at most 3 lines a minute per character', dropped.length === 3, gapLines().slice(3));
  globalThis.__dboRaceMenuSaveWindows = new Map();
  online = [B];

  // Upload gap review (12 Oct): the dropped-chunk log limiter is kept out of the rate counters. They are cleared whole past
  // 5000 keys, so a malformed chunk's 'dropTold' key could be the one that clears them and hand a character past the hourly
  // upload limit a fresh allowance. 4998 other keys held, D's 30 uploads an hour used up and the 'rateTold' key added
  // (5000 keys): one malformed chunk must leave the limit standing, D's next face refused 'rate' and nothing written
  const D = 0xff000d04;
  users[4] = D; props[D] = { profileId: 88, appearance: { raceId: 0x13743 } };
  online = [B, D];
  M = load();
  take();
  globalThis.__dboPresetState.rates.clear();
  for (let k = 0; k < 4998; k++) globalThis.__dboPresetState.rates.set(`get:${0xff100000 + k}`, [Date.now()]);
  for (let up = 1; up <= 30; up++) packet(4, { customPacketType: 'dboPresetPut', up, i: 0, n: 0, hash: '', race: 1, data: '' });
  packet(4, { customPacketType: 'dboPresetPut', up: 31, i: 0, n: 0, hash: '', race: 1, data: '' });   // refused rate: adds 'rateTold'
  await settle();
  const rateKeys = globalThis.__dboPresetState.rates.size;
  take(); logs.length = 0;
  packet(4, { customPacketType: 'dboPresetPut', up: 'x', i: 0, n: 1, hash: 'zz', race: 1, data: 'a' });
  const dFace = P.encodeFace({ ...face, custom: [{ name: 'NoseBridge', value: 0.33 }] });
  upload(4, dFace, 32);
  await settle();
  s = take().filter((x) => x.p.customPacketType === 'dboPresetRefused');
  check('upload gap review: a malformed chunk at 5000 rate keys (hourly limit used up, rateTold held) does not clear the limit: the next face is refused rate, nothing written',
    rateKeys === 5000 && globalThis.__dboPresetState.rates.has(`rateTold:${D}`) && logs.some((l) => /^racemenu presets: ff000d04 \(profile 88\) upload chunk dropped: bad header/.test(l))
    && !fs.existsSync(fileOf(D)) && s.length === 1 && s[0].to === D && s[0].p.reason === 'rate' && s[0].p.hash === P.hashText(dFace),
    [rateKeys, globalThis.__dboPresetState.rates.size, fs.existsSync(fileOf(D)), s.map((x) => x.p), logs]);
  online = [B];

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL  harness threw', e.stack); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
