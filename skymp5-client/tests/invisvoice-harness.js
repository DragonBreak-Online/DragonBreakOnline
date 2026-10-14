// Scripted test for voiceService.pushPeers with VoiceManager.js: a player hidden by ff_adminModes.invis (an Invisible admin,
// someone in character creation) who talks is heard by nobody and named on nobody's speaking HUD, staff included, the
// same as the body (adminCopyPolicy.ts). Everyone else is heard as before, and the Invisible admin still hears them.
//
// The real pushPeers, adminCopyPolicy, voicePeerKey, VoiceManager and voiceFalloff run; every other import is a stub. Run
// it from skymp5-client:
//
//   node tests/invisvoice-harness.js [path to typescript's package dir]
'use strict';
const fs = require('fs');
const path = require('path');

const tsDir = [process.argv[2], path.resolve(__dirname, '../node_modules/typescript')].find((p) => p && fs.existsSync(p));
if (!tsDir) { console.log('SKIP invisvoice (no typescript)'); process.exit(0); }
const ts = require(tsDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const repo = path.resolve(__dirname, '..', '..');
const client = (p) => path.join(repo, 'skymp5-client', 'src', p);
const front = (p) => path.join(repo, 'skymp5-front', 'src', p);

// Any export of a stubbed module is a do-nothing function: it can be called, constructed and extended
const stub = () => new Proxy({}, { get: (_, k) => (k === '__esModule' ? true : function Stub() {}) });
const load = (file, real) => {
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, allowJs: true, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const req = (spec) => {
    const base = spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : null;
    const hit = base && real.find((r) => r.replace(/\.(ts|js)$/, '') === base);
    return hit ? load(hit, real) : stub();
  };
  new Function('require', 'module', 'exports', out)(req, mod, mod.exports);
  return mod.exports;
};

// ---- the page: VoiceManager.js on a window with nothing behind it ------------------------------------------------
const events = [];
const toGame = [];
globalThis.window = {
  addEventListener() {}, dispatchEvent(e) { events.push(e); },
  localStorage: { getItem: () => null, setItem() {} }, skyrimPlatform: { sendMessage: (...a) => toGame.push(a) },
};
globalThis.document = { activeElement: null };
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = () => 0; // the page's own clocks; the harness drives it
load(front('utils/VoiceManager.js'), [front('utils/voiceFalloff.js')]);
globalThis.setInterval = realSetInterval;
const vm = globalThis.window.__alduinakVoice;
check('the page loads', !!vm && typeof vm.setPeers === 'function' && typeof vm.gainFor === 'function');

// ---- the game side: the real pushPeers on a world model ------------------------------------------------------------
const { VoiceService } = load(client('services/services/voiceService.ts'),
  [client('services/services/voicePeerKey.ts'), client('view/adminCopyPolicy.ts')]);
check('voiceService loads', typeof VoiceService === 'function' && typeof VoiceService.prototype.pushPeers === 'function');

const CELL = 0x3c;
const form = (refrId, name, x, modes) => {
  const f = { refrId, appearance: { name }, movement: { pos: [x, 0, 0], rot: [0, 0, 0], worldOrCell: CELL } };
  if (modes) f.ff_adminModes = modes;
  return f;
};
const ME = 0xff000100, ADMIN = 0xff000e62, PLAYER = 0xff000101, GHOST = 0xff000102, GOD = 0xff000103, NEWBIE = 0xff000104;
const IDS = { ff000100: 'p70', ff000e62: 'p1', ff000101: 'p151', ff000102: 'p3', ff000103: 'p51', ff000104: 'p200' };
const ALL_OFF = { god: false, smite: false, healhit: false, invis: false, ghost: false };
const world = (adminModes, meModes) => ({
  playerCharacterFormIdx: 0,
  forms: [
    form(ME, 'Frigga', 0, meModes),
    form(ADMIN, 'Dialis', 200, adminModes),                                         // AdminSystem's whole mirror
    form(PLAYER, 'Rokvar', 300),
    form(GHOST, 'Gm Swag', 250, Object.assign({}, ALL_OFF, { ghost: true })),        // Ghost mode, not Invisible
    form(GOD, 'Choom', 260, Object.assign({}, ALL_OFF, { god: true })),
    form(NEWBIE, 'Prisoner', 220, { invis: true }),                                  // the creator Realm's sweep
  ],
});

// One push, then the page as it stands after it: who it would play, how loud, and who the speaking HUD names
const push = (wm) => {
  const sent = [];
  const fake = {
    controller: { lookupListener: () => ({ getWorldModel: () => wm }) },
    modes: [{ key: 'whisper', units: 140 }, { key: 'talk', units: 840 }, { key: 'shout', units: 3150 }],
    identityMap: IDS, sp: { browser: { executeJavaScript: (s) => sent.push(s) } },
  };
  VoiceService.prototype.pushPeers.call(fake);
  const speakers = ['p1', 'p151', 'p3', 'p51', 'p200', 'p70'];
  const els = new Map(speakers.map((id) => [id, { volume: 1 }]));
  const pubs = new Map(speakers.map((id) => [id, { isSubscribed: true, setSubscribed(w) { this.isSubscribed = w; } }]));
  vm.audioEls = els;
  vm.peerRanges = Object.fromEntries(speakers.map((id) => [id, 840])); // everyone talking
  vm.room = {
    activeSpeakers: speakers.map((id) => ({ identity: id, isLocal: id === 'p70', audioLevel: 0.5 })),
    remoteParticipants: new Map(speakers.filter((id) => id !== 'p70').map((id) => [id, { identity: id, audioTrackPublications: new Map([['a', pubs.get(id)]]) }])),
  };
  for (const s of sent) new Function('window', s)(globalThis.window);
  events.length = 0; toGame.length = 0; vm.lastSpeaking = '';
  vm.emitSpeaking();
  const hud = events.filter((e) => e.type === 'dbo:voiceSpeakers').map((e) => e.detail)[0] || [];
  const lips = toGame.filter((a) => a[0] === 'voice::speaking').map((a) => JSON.parse(a[1]))[0] || [];
  return { sent, els, pubs, hud, lips, gain: (id) => vm.gainFor(id) };
};
const heard = (r, id) => r.gain(id) > 0 && r.els.get(id).volume > 0 && r.pubs.get(id).isSubscribed === true;
const silent = (r, id) => r.gain(id) === 0 && r.els.get(id).volume === 0 && r.pubs.get(id).isSubscribed === false;
const named = (r, id, name) => r.hud.some((x) => x.id === id || x.name === name);

// ---- an Invisible admin talking (Jake, 14 Oct: "when invisible as an admin, I should be undetectable") ----------
{
  const r = push(world(Object.assign({}, ALL_OFF, { invis: true, god: true })));
  check('pushPeers sends the page its two lists', r.sent.length === 2, r.sent);
  check('the Invisible admin is not among the peers or the vectors', !/\bp1\b|Dialis/.test(r.sent.join('\n')), r.sent);
  check('...so the page does not play him: gain 0, volume 0, his track unsubscribed', silent(r, 'p1'),
    { g: r.gain('p1'), v: r.els.get('p1').volume, sub: r.pubs.get('p1').isSubscribed });
  check('...the speaking HUD does not name him', !named(r, 'p1', 'Dialis'), r.hud);
  check('...and the lip sync feed leaves him out', !r.lips.some((x) => x.id === 'p1'), r.lips);
  check('someone in character creation is not heard either', silent(r, 'p200') && !named(r, 'p200', 'Prisoner'), r.hud);
  check('a player beside him is heard and named', heard(r, 'p151') && named(r, 'p151', 'Rokvar'), r.hud);
  check('a Ghost mode admin is heard and named (Ghost is not a stealth mode)', heard(r, 'p3') && named(r, 'p3', 'Gm Swag'));
  check('god, smite and the rest change nothing', heard(r, 'p51') && named(r, 'p51', 'Choom'));
  check('the listener\'s own voice stays on the feed', r.lips.some((x) => x.id === 'p70'), r.lips);
}

// ---- Invisible over Ghost, Invisible off again, a bad mirror -----------------------------------------------------
{
  const r = push(world(Object.assign({}, ALL_OFF, { invis: true, ghost: true })));
  check('Invisible wins over Ghost for the voice too', silent(r, 'p1') && !named(r, 'p1', 'Dialis'));
}
{
  const r = push(world(Object.assign({}, ALL_OFF)));
  check('Invisible off: he is heard and named at the next push', heard(r, 'p1') && named(r, 'p1', 'Dialis'), r.hud);
}
{
  const r = push(world('x'));
  check('a mirror that is not an object hides nobody', heard(r, 'p1'));
}

// ---- the Invisible admin listening ---------------------------------------------------------------------------
{
  const r = push(world(Object.assign({}, ALL_OFF), Object.assign({}, ALL_OFF, { invis: true })));
  check('an Invisible admin still hears the players around him', heard(r, 'p1') && heard(r, 'p151') && heard(r, 'p3'));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
