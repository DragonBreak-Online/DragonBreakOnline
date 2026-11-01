// Vampire eyes on the client (vampire-eyes 1 Nov; Nat: "the eyes are constantly the unfed ones despite being fed"; pk-0573):
// a vampire race's own head parts (vampire eyes, fangs) won on the live head, on the owner's screen and on watchers' copies,
// while the server's look held the character's own. Checked here:
//   - sync/vampireHead.ts: when a remote copy on a vampire race gets its look's face and eyes (once its 3D settles, again
//     after each face rebuild, never on a beast copy or another race, again on the next load), and what it puts on;
//   - appearance.ts putHeadPartsOn on a stub game: the look's face and eyes, by type, extras left alone;
//   - the owner (appearance.ts applyAppearanceToPlayer, ownLook.ts tickLiveHeadParts) and formView's wiring, in the source.
//   node tests/vampire-eyes-client-harness.js      (env ESBUILD_DIR, else the fork's skymp5-server esbuild)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = path.resolve(__dirname, '..');
const ESB = [process.env.ESBUILD_DIR, path.join(HERE, '../skymp5-server/node_modules/esbuild'), path.join(HERE, '../../../fork/skymp5-server/node_modules/esbuild'), 'E:/DragonBreak Online Dev files/fork/skymp5-server/node_modules/esbuild'].find((d) => d && fs.existsSync(path.join(d, 'package.json')));
if (!ESB) { console.log('SKIP needs ESBUILD_DIR'); process.exit(0); }
const esbuild = require(ESB);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vampeyes-'));

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const src = (f) => fs.readFileSync(path.join(HERE, f), 'utf8').replace(/\r\n/g, '\n');
const APP = src('src/sync/appearance.ts');
const VAMP_RACES = (APP.match(/VAMPIRE_RACE_IDS = new Set<number>\(\[([^\]]+)\]\)/) || [])[1].split(',').map((x) => Number(x.trim()));
const NORD_VAMPIRE = 0x88794, NORD = 0x13746;

// A stub game: head parts by id (type 1 face, 2 eyes; 0x99 an extra eyes part), and an actor that records changeHeadPart
const PARTS = { 0x51633: { type: 1 }, 0x24245: { type: 2 }, 0x99: { type: 2, extra: true }, 0x5140e: { type: 3 } };
fs.writeFileSync(path.join(TMP, 'sp.js'), `
const PARTS = ${JSON.stringify(PARTS)};
const part = (id) => (PARTS[id] ? { getFormID: () => Number(id), getType: () => PARTS[id].type, isExtraPart: () => !!PARTS[id].extra } : null);
const deep = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : deep()), apply: () => deep(), construct: () => deep() });
module.exports = new Proxy({
  Game: { getFormEx: (id) => (PARTS[id] ? { id } : null), getPlayer: () => null },
  HeadPart: { from: (f) => (f ? part(f.id) : null) },
  writeLogs: (n, line) => { globalThis.__logs.push(line); },
}, { get: (t, k) => (k in t ? t[k] : deep()) });
`);
fs.writeFileSync(path.join(TMP, 'diag.js'), 'module.exports = { trace: (l) => globalThis.__traces.push(l) };');
fs.writeFileSync(path.join(TMP, 'empty.js'), 'const deep = () => new Proxy(function () {}, { get: (t, k) => (k === "then" ? undefined : deep()), apply: () => deep() }); module.exports = new Proxy({}, { get: () => deep() });');

(async () => {
  const stub = { name: 'stub', setup(b) {
    b.onResolve({ filter: /^skyrimPlatform$/ }, () => ({ path: path.join(TMP, 'sp.js') }));
    b.onResolve({ filter: /clientDiag$/ }, () => ({ path: path.join(TMP, 'diag.js') }));
    b.onResolve({ filter: /^\.\.?\// }, (a) => (/\/(appearance|vampireHead)$/.test(a.path) ? undefined : (a.importer.endsWith('vampireHead.ts') || a.importer.endsWith('appearance.ts') ? { path: path.join(TMP, 'empty.js') } : undefined)));
  } };
  const out = path.join(TMP, 'vh.js');
  await esbuild.build({ entryPoints: [path.join(HERE, 'src/sync/vampireHead.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error', plugins: [stub] });
  globalThis.__logs = []; globalThis.__traces = [];
  const V = require(out);

  // ---- when a remote copy gets its face and eyes ----
  ok(VAMP_RACES.includes(NORD_VAMPIRE) && VAMP_RACES.length === 10, 'the vampire races are appearance.ts VAMPIRE_RACE_IDS (10, NordRaceVampire among them)');
  let s = V.newVampireHeadState(); let t = 1000;
  ok(!V.vampireHeadDue(s, t, false, NORD_VAMPIRE, false, 0), 'not before the copy\'s 3D is loaded');
  ok(!V.vampireHeadDue(s, t, true, NORD_VAMPIRE, false, 0) && s.loadedAt === t, '...nor the moment it loads (not mid-load)');
  t += V.VAMPIRE_HEAD_AFTER_MS;
  ok(V.vampireHeadDue(s, t, true, NORD_VAMPIRE, false, 0), `${V.VAMPIRE_HEAD_AFTER_MS} ms after it loads: due`);
  const actor = { calls: [], changeHeadPart(p) { this.calls.push(p.getFormID()); }, getFormID: () => 0xff0017fa };
  const look = { raceId: NORD_VAMPIRE, headpartIds: [0x51633, 0x99, 0x24245, 0x5140e] };
  ok(V.putVampireHead(s, actor, look, t) === 2 && actor.calls.join() === [0x51633, 0x24245].join(), 'it puts the look\'s face and eyes on the copy (not the extra eyes part, not the hair)', actor.calls);
  ok(globalThis.__logs.some((l) => /^live head of copy ff0017fa: 2 part\(s\) put on: face 51633, eyes 24245$/.test(l)), '...and says so in dbo-diag (what a watcher\'s log shows)', globalThis.__logs);
  t += 100;
  ok(!V.vampireHeadDue(s, t, true, NORD_VAMPIRE, false, 0), 'once per load: not again on the next frame');
  const rebuildAt = t + 50; t = rebuildAt + 200;
  ok(!V.vampireHeadDue(s, t, true, NORD_VAMPIRE, false, rebuildAt), 'a face rebuild: not at once (its NiNode update is queued)');
  t = rebuildAt + V.VAMPIRE_HEAD_AFTER_MS;
  ok(V.vampireHeadDue(s, t, true, NORD_VAMPIRE, false, rebuildAt), '...again a moment after the rebuild');
  V.putVampireHead(s, actor, look, t);
  ok(!V.vampireHeadDue(s, t + 5000, true, NORD_VAMPIRE, false, rebuildAt), '...and only once for it');
  ok(!V.vampireHeadDue(s, t + 6000, false, NORD_VAMPIRE, false, rebuildAt) && s.putAt === 0 && s.loadedAt === 0, 'the 3D unloads (out of range, a respawn for a new look): forgotten');
  V.vampireHeadDue(s, t + 7000, true, NORD_VAMPIRE, false, rebuildAt);
  ok(V.vampireHeadDue(s, t + 7000 + V.VAMPIRE_HEAD_AFTER_MS, true, NORD_VAMPIRE, false, rebuildAt), '...the next load gets them again');
  const n = V.newVampireHeadState();
  V.vampireHeadDue(n, 0, true, NORD, false, 0);
  ok(!V.vampireHeadDue(n, 9999, true, NORD, false, 0), 'a mortal race\'s copy is never touched');
  const b = V.newVampireHeadState();
  V.vampireHeadDue(b, 0, true, NORD_VAMPIRE, true, 0);
  ok(!V.vampireHeadDue(b, 9999, true, NORD_VAMPIRE, true, 0), 'nor a beast copy (a Vampire Lord, a werewolf)');
  const quiet = { changeHeadPart() { throw new Error('no native'); }, getFormID: () => 1 };
  ok(V.putVampireHead(V.newVampireHeadState(), quiet, look, 1) === 0, 'a platform without changeHeadPart: nothing, no throw');

  // ---- the owner and the wiring, in the source ----
  const fn = APP.slice(APP.indexOf('export const applyAppearanceToPlayer'), APP.indexOf('// The look last written to the player\'s base'));
  ok(/const vampireHead = liveEyes && isVampireRaceId\(appearance\.raceId\);/.test(fn), 'owner: every look in session on a vampire race is a vampire head');
  ok(fn.indexOf('regeneratePlayerHead(appearance);') < fn.indexOf('if (vampireHead) putLiveHeadParts(appearance, wanted ? wanted.why : event);') && fn.indexOf('if (vampireHead) putLiveHeadParts') > 0, 'owner: the face and eyes go on after the head is regenerated');
  ok(/if \(liveEyes && wanted && !vampireHead\)/.test(fn) && /else if \(liveEyes && !vampireHead && eyes && lastEyesId && eyesId !== lastEyesId\)/.test(fn), 'owner: on a vampire race neither the early put nor the eyes-only swap runs (no double swap)');
  const OL = src('src/sync/ownLook.ts');
  ok(/if \(now - wanted\.at > LIVE_HEAD_GIVE_UP_MS && !vampireLook\) \{ dropLiveHeadParts\(\);/.test(OL) && /const vampireLook = !!early && isVampireRaceId\(Number\(early\.look\.raceId\) >>> 0\);/.test(OL), 'owner: a vampire race\'s look never gives up after 60 s (other races still do)');
  const FV = src('src/view/formView.ts');
  ok(/if \(vampireHeadDue\(this\.vampireHead, now, loaded, Number\(model\.appearance\.raceId\) >>> 0, this\.isBeastCopy\(model\), this\.rebuild\.lastMs\)\) \{\n\s*noteActorCall\("vampireHead", this\.refrId\);\n\s*putVampireHead\(this\.vampireHead, actor, model\.appearance, now\);/.test(FV), 'watchers: formView asks each frame, with the copy\'s 3D state and its last face rebuild');
  ok(/private vampireHead: VampireHeadState = newVampireHeadState\(\);/.test(FV), '...one state per copy');

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.stack || e.message); process.exit(1); });
