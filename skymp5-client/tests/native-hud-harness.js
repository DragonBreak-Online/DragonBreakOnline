// The native HUD (route H): nativeHud.ts's decisions against the browser HUD's own rules (the front's vitalsShown and
// cornerShown, read from skymp5-front features/hud and run side by side), the payload, the swf's loading and fallback, and
// swf/dbo_hud drawing that payload on the stub stage. Plus the wiring: the relay marks the hud widget native, the front
// leaves its corner and bars out then and forwards V.
//   node tests/native-hud-harness.js [<tmp>/nativeHud.js]   (with no argument it compiles nativeHud.ts itself)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const ROOT = path.resolve(__dirname, '..');

const built = () => {
  const out = path.join(os.tmpdir(), 'dbo-nativehud');
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), path.join(ROOT, 'src', 'services', 'services', 'nativeHud.ts'),
    '--outDir', out, '--module', 'commonjs', '--target', 'es2019'], { stdio: 'pipe' });
  return path.join(out, 'nativeHud.js');
};
const H = require(path.resolve(process.argv[2] || built()));

// ---- the settings, as the front reads them ----
check('no settings file yet: today\'s look (always, classic)', JSON.stringify(H.uiFromFile(null)) === JSON.stringify({ vitals: 'always', vitalsStyle: 'classic', vitalsFadeSeconds: 5 }));
check('a file with no ui block: the defaults (fade, quiet, 5 s)', JSON.stringify(H.uiFromFile({ fontSize: 16 })) === JSON.stringify({ vitals: 'fade', vitalsStyle: 'quiet', vitalsFadeSeconds: 5 }));
check('the player\'s choice wins', JSON.stringify(H.uiFromFile({ ui: { vitals: 'hidden', vitalsStyle: 'classic', vitalsFadeSeconds: 10 } })) === JSON.stringify({ vitals: 'hidden', vitalsStyle: 'classic', vitalsFadeSeconds: 10 }));
check('...junk values fall back to the defaults', JSON.stringify(H.uiFromFile({ ui: { vitals: 'sometimes', vitalsStyle: 3, vitalsFadeSeconds: 7 } })) === JSON.stringify({ vitals: 'fade', vitalsStyle: 'quiet', vitalsFadeSeconds: 5 }));

// ---- the fade rules are the front's, run side by side ----
const front = fs.readFileSync(path.join(ROOT, '..', 'skymp5-front', 'src', 'features', 'hud', 'index.tsx'), 'utf8').replace(/\r\n/g, '\n');
const frontFn = (name) => {
  const m = front.match(new RegExp(`export const ${name} = \\(([^)]*)\\): boolean =>\\s*([\\s\\S]*?);\\n`));
  if (!m) throw new Error('front ' + name + ' not found');
  return new Function(...m[1].split(',').map((p) => p.split(':')[0].trim()), `return (${m[2]});`);
};
const fVit = frontFn('vitalsShown'), fCorner = frontFn('cornerShown');
let same = 0, total = 0, firstDiff = null;
for (const vitals of ['always', 'fade', 'hidden']) for (const secs of [3, 5, 10]) for (const since of [0, 2999, 3000, 4999, 5000, 9999, 10000, 60000]) {
  const ui = { vitals, vitalsStyle: 'quiet', vitalsFadeSeconds: secs };
  for (const full of [true, false]) { total++; if (fVit(ui, full, since) === H.vitalsShown(ui, full, since)) same++; else firstDiff = firstDiff || ['vitals', ui, full, since]; }
  for (const talking of [true, false]) for (const stage of ['sated', 'peckish', 'hungry', 'starving', '']) { total++; if (fCorner(ui, talking, since, stage) === H.cornerShown(ui, talking, since, stage)) same++; else firstDiff = firstDiff || ['corner', ui, talking, since, stage]; }
}
check(`the native fade rules agree with the browser HUD's in every case (${total})`, same === total, firstDiff);

// ---- the payload ----
const server = { hunger: 30, stage: 'Peckish', hungerOn: true, vitalsOn: true, gold: 1240.4, goldOn: true };
const FADE = { vitals: 'fade', vitalsStyle: 'quiet', vitalsFadeSeconds: 5 };
let clock = H.newClock(0);
let p = H.payloadOf(server, { h: 50, m: 100, s: 100 }, 'shout', false, FADE, clock, 1000);
check('bars: the vitals, the style, shown while one is not full', p.bars.on && p.bars.shown && p.bars.quiet && p.bars.h === 50 && p.bars.m === 100, p.bars);
check('hunger: the stage\'s label and how fed', p.hunger.label === 'Peckish' && p.hunger.stage === 'peckish' && p.hunger.fed === 70, p.hunger);
check('gold rounded; voice range; no power', p.gold === 1240 && p.voice.mode === 'shout' && !p.voice.talking && p.power === null, [p.gold, p.voice, p.power]);
check('the corner shows on a change', p.corner.shown === true);
p = H.payloadOf(server, { h: 100, m: 100, s: 100 }, 'shout', false, FADE, clock, 2000);
check('full bars still show for the fade seconds after the last change', p.bars.shown === true);
p = H.payloadOf(server, { h: 100, m: 100, s: 100 }, 'shout', false, FADE, clock, 7001);
check('...then fade; the corner fades too, nothing having changed', p.bars.shown === false && p.corner.shown === false, [p.bars, p.corner]);
p = H.payloadOf(server, { h: 100, m: 100, s: 100 }, 'shout', true, FADE, clock, 7002);
check('talking brings the corner back', p.corner.shown === true);
p = H.payloadOf(Object.assign({}, server, { stage: 'Hungry' }), { h: 100, m: 100, s: 100 }, 'shout', false, FADE, clock, 30000);
check('hungry keeps the corner up; its label', p.corner.shown === true && p.hunger.label === 'Hungry', p);
H.payloadOf(server, { h: 100, m: 100, s: 100 }, 'talk', false, FADE, clock, 40000);
p = H.payloadOf(server, { h: 100, m: 100, s: 100 }, 'talk', false, FADE, clock, 50000);
check('peckish and still: the corner fades', p.corner.shown === false);
p = H.payloadOf(server, { h: 100, m: 100, s: 100 }, 'shout', false, FADE, clock, 50001);
check('a change of voice range alone shows it again', p.corner.shown === true);
H.payloadOf(server, { h: 80, m: 100, s: 100 }, 'shout', false, FADE, clock, 60000);
p = H.payloadOf(server, { h: 100, m: 100, s: 100 }, 'shout', false, FADE, clock, 61000);
check('bars back to full count their fade from the moment they filled', p.bars.shown === true);
p = H.payloadOf(Object.assign({}, server, { goldOn: false, hungerOn: false }), null, 'mumble', false, { vitals: 'hidden', vitalsStyle: 'classic', vitalsFadeSeconds: 5 }, H.newClock(0), 100);
check('hidden: no bars, the corner only while talking; no gold or hunger when off; an unknown range reads Normal; no vitals yet reads full', !p.bars.on && !p.corner.shown && p.gold === null && p.hunger === null && p.voice.mode === 'talk' && p.bars.h === 100 && !p.bars.quiet, p);
p = H.payloadOf(Object.assign({}, server, { gold: undefined }), { h: -5, m: 250, s: 33.6 }, 'talk', false, { vitals: 'always', vitalsStyle: 'quiet', vitalsFadeSeconds: 5 }, H.newClock(0), 100000);
check('always: everything shown, values clamped, no gold row without a count', p.bars.shown && p.corner.shown && p.bars.h === 0 && p.bars.m === 100 && p.bars.s === 34 && p.gold === null, p);
p = H.payloadOf(Object.assign({}, server, { racialPower: { name: 'Battle Cry', endsAt: 10500 } }), null, 'talk', false, FADE, H.newClock(0), 1000);
check('the racial power\'s seconds left, rounded up', p.power && p.power.name === 'Battle Cry' && p.power.left === 10, p.power);
check('...and none once it ends', H.payloadOf(Object.assign({}, server, { racialPower: { name: 'Battle Cry', endsAt: 10500 } }), null, 'talk', false, FADE, H.newClock(0), 10500).power === null);
check('nothing to draw before the server\'s hud arrives', H.payloadOf(null, null, 'talk', false, FADE, H.newClock(0), 0) === null);
const j = H.changedJson(p, '');
check('changedJson: the JSON when new, null when the same or nothing', j === JSON.stringify(p) && H.changedJson(p, j) === null && H.changedJson(null, '') === null);

// ---- loading the swf, and the fallback ----
{
  const st = H.newLoad();
  check('nothing while the HUD Menu is closed', H.loadStep(st, false, false) === '' && st.phase === 'idle');
  check('the HUD up: inject', H.loadStep(st, true, false) === 'inject' && st.phase === 'loading' && st.tries === 1);
  check('...wait while it loads', H.loadStep(st, true, false) === '');
  check('...up once it says it is alive', H.loadStep(st, true, true) === 'up' && st.phase === 'up' && st.tries === 0);
  check('...nothing while it stays alive', H.loadStep(st, true, true) === '');
  check('the HUD closing (a loading screen) changes nothing', H.loadStep(st, false, false) === '' && st.phase === 'up');
  check('back with the clip gone: lost, then inject again', H.loadStep(st, true, false) === 'lost' && H.loadStep(st, true, false) === 'inject');
  const f = H.newLoad();
  const steps = [];
  for (let i = 0; i < H.ALIVE_FRAMES * H.MAX_TRIES + H.MAX_TRIES + 5; i++) steps.push(H.loadStep(f, true, false));
  check(`never alive: ${H.MAX_TRIES} tries of ${H.ALIVE_FRAMES} frames each, then fail, once`, steps.filter((s) => s === 'inject').length === H.MAX_TRIES && steps.filter((s) => s === 'fail').length === 1 && f.phase === 'failed', [steps.filter((s) => s === 'inject').length, steps.filter((s) => s === 'fail').length, f.phase]);
  check('...and failed stays failed: the browser HUD keeps it', H.loadStep(f, true, true) === '' && f.phase === 'failed');
}

// ---- swf/dbo_hud on the stub stage ----
const t = S.boot('dbo_hud', true);
const R = t.root;
check('the swf says it is alive, its version', R.dboAlive === 'yes' && R.dboVersion === 'hud-1');
check('it locks its root first (it runs inside the HUD Menu)', t.ctx._lockroot === true);
check('nothing shows before the first data', R.bars._alpha === 0 && R.corner._alpha === 0);
const wide = (c) => { const f = c.fills[c.fills.length - 1]; return f ? Math.max(...f.pts.map((q) => q[0])) - Math.min(...f.pts.map((q) => q[0])) : 0; };
const pay = (o) => Object.assign({ bars: { on: true, shown: true, quiet: false, h: 50, m: 100, s: 25 }, corner: { shown: true }, power: { name: 'Battle Cry', left: 9 }, gold: 1240,
  hunger: { label: 'Hungry', stage: 'hungry', fed: 40 }, voice: { mode: 'shout', talking: true } }, o || {});
t.push(pay());
check('the bars fill to the vitals', wide(R.bars.row0.fill) === 110 && wide(R.bars.row1.fill) === 220 && wide(R.bars.row2.fill) === 55, [wide(R.bars.row0.fill), wide(R.bars.row1.fill), wide(R.bars.row2.fill)]);
check('...each a little further right, as the browser\'s', R.bars.row1._x === 14 && R.bars.row2._x === 28);
check('the corner: the power\'s countdown, gold, hunger and its meter', R.corner.power.label.text === 'Battle Cry' && R.corner.power.value.text === '9s' && R.corner.gold.value.text === '1240'
  && R.corner.hunger.label.text === 'Hungry' && R.corner.hunger.value.text === '40%' && wide(R.corner.hunger.meter) === Math.round(210 * 0.4), [R.corner.hunger.value.text, wide(R.corner.hunger.meter)]);
check('a hungry label takes the hungry colour', R.corner.hunger.label.textColor === 0xE8D6A0);
check('the voice range lit, "On air" while V is held', R.corner.voice.m2.textColor === 0x8FD3D0 && R.corner.voice.m0.textColor !== 0x8FD3D0 && R.corner.voice.hint.text === 'On air');
check('the cards stack up from the voice box: hunger, gold, then the power', R.corner.voice._y > R.corner.hunger._y && R.corner.hunger._y > R.corner.gold._y && R.corner.gold._y > R.corner.power._y, [R.corner.voice._y, R.corner.hunger._y, R.corner.gold._y, R.corner.power._y]);
for (let i = 0; i < 20; i++) t.tick();
check('both fade in over some frames', R.bars._alpha === 100 && R.corner._alpha === 100);
t.push(pay({ bars: { on: true, shown: false, quiet: true, h: 100, m: 100, s: 100 }, corner: { shown: false }, power: null, gold: null, voice: { mode: 'whisper', talking: false } }));
t.tick();
check('fading out takes some frames', R.bars._alpha > 0 && R.bars._alpha < 100);
for (let i = 0; i < 20; i++) t.tick();
check('...then gone', R.bars._alpha === 0 && R.corner._alpha === 0);
check('no power, no gold: those cards hidden, hunger moves down', !R.corner.power._visible && !R.corner.gold._visible && R.corner.hunger._visible && R.corner.voice.hint.text === 'L-Alt' && R.corner.voice.m0.textColor === 0x8FD3D0);
check('the quiet bars are thinner', (() => { const f = R.bars.row0.fill.fills[R.bars.row0.fill.fills.length - 1]; return Math.max(...f.pts.map((q) => q[1])) === 6; })());
t.push(pay({ bars: { on: false, shown: true, quiet: false, h: 1, m: 1, s: 1 }, hunger: null }));
check('bars off (hidden, or the server\'s vitalsOn false): not drawn; no hunger card', R.bars._visible === false && !R.corner.hunger._visible);
check('...a hidden card takes no room: gold sits right above the voice box', R.corner.gold._y === R.corner.voice._y - 34, [R.corner.gold._y, R.corner.voice._y]);
const before = R.corner.gold.value.text;
let threw = false;
try { t.push({ bars: {} }); } catch (e) { threw = true; }
check('an unreadable payload changes nothing', !threw && R.corner.gold.value.text === before && R.corner.gold._visible === true && R.corner.voice.hint.text === 'On air');

// ---- the party list (Worker 1, 1 Nov: the browser's party panel into the HUD) ----
const SELF = 0x10, ANA = 0x11;
const crew = { self: SELF, rows: [{ id: SELF, name: 'Aela', leader: true, health: 80, far: false }, { id: ANA, name: 'Ana', health: 130, far: false, dead: true },
  { id: 0x12, name: 'Bo', far: true }, { id: 0xff0001, name: 'Wolf', summon: true, staying: true, leftSec: 65, health: 40, far: false }] };
const po = H.partyOf(crew);
check('partyOf: none for no party and no companions', H.partyOf(null) === null && H.partyOf({ self: 1, rows: [] }) === null);
check('partyOf: a party with players is titled Party; summons alone are Companions', po.title === 'Party' && H.partyOf({ self: 1, rows: [crew.rows[3]] }).title === 'Companions');
check('partyOf: the leader, yourself, the dead and the far are marked, health clamped to 100',
  po.rows[0].leader && po.rows[0].self && po.rows[0].pct === 80 && po.rows[1].dead && po.rows[1].pct === 100 && !po.rows[1].self && po.rows[2].far, po.rows);
check('partyOf: a summon shows "stay" and its time left as m:ss', po.rows[3].tag === 'stay' && po.rows[3].clock === '1:05' && !po.rows[3].self && po.rows[0].clock === '' && po.rows[0].tag === '', po.rows[3]);
const withParty = H.payloadOf({ hunger: 0, stage: 'sated', hungerOn: true, vitalsOn: true }, null, 'talk', false, H.UI_DEFAULTS, H.newClock(0), 0, crew);
check('the payload carries the party, and none when there is none', JSON.stringify(withParty.party) === JSON.stringify(po)
  && H.payloadOf({ hunger: 0, stage: 'sated', hungerOn: true, vitalsOn: true }, null, 'talk', false, H.UI_DEFAULTS, H.newClock(0), 0).party === null);
const p2 = S.boot('dbo_hud', true);
p2.push(pay({ party: null }));
check('dbo_hud: no party, no list', p2.root.party._visible === false);
p2.push(pay({ party: po }));
const L = p2.root.party.list;
check('dbo_hud: the list at the left, titled PARTY with its count', !!L && p2.root.party._visible === true && L.title.text === 'PARTY' && L.count.text === '4' && p2.root.party._x < 640, L && [L.title.text, L.count.text]);
if (!L) T.done();
check('...a row a member: names, the summon\'s tag and time, "far" for one not loaded',
  L.r0.name.text === 'Aela' && L.r3.name.text === 'Wolf  stay' && L.r3.right.text === '1:05' && L.r2.right.text === 'far', [L.r0.name.text, L.r3.name.text, L.r3.right.text, L.r2.right.text]);
check('...yourself in the accent colour, the dead dimmed', L.r0.name.textColor === 0x8FD3D0 && L.r1.name.textColor !== 0x8FD3D0 && L.r1._alpha === 45 && L.r0._alpha === 100);
const barOf = (row) => { const f = row.fills[row.fills.length - 1]; return f ? Math.max(...f.pts.map((q) => q[0])) - Math.min(...f.pts.map((q) => q[0])) : -1; };
check('...health bars to scale; no bar for the far one', barOf(L.r0) === Math.round(220 * 0.8) && barOf(L.r3) === Math.round(220 * 0.4) && !L.r2.fills.length, [barOf(L.r0), barOf(L.r3), L.r2.fills.length]);
check('...the leader marked by a drawn diamond, not a character the game\'s font lacks', L.r0.fills.length > L.r3.fills.length && L.r0.name._x === 24 && L.r3.name._x === 10
  && !/[^\x00-\x7f]/.test(fs.readFileSync(path.join(ROOT, 'swf', 'dbo_hud', 'scripts', 'frame_1', 'DoAction.as'), 'utf8')));
p2.push(pay({ party: null }));
check('dbo_hud: the list goes when the party does', p2.root.party._visible === false);

// ---- the watermark: the browser's hourglass, top right ----
const srv = { hunger: 0, stage: 'sated', hungerOn: true, vitalsOn: true };
check('the payload carries the watermark unless the server switched it off', H.payloadOf(srv, null, 'talk', false, H.UI_DEFAULTS, H.newClock(0), 0).watermark === true
  && H.payloadOf(Object.assign({}, srv, { watermarkOn: false }), null, 'talk', false, H.UI_DEFAULTS, H.newClock(0), 0).watermark === false);
const w3 = S.boot('dbo_hud', true);
check('dbo_hud: no watermark before the first data', !!w3.root.dboMark && w3.root.dboMark._visible === false);
w3.push(pay({ watermark: true }));
const pic = w3.root.dboMark && w3.root.dboMark.pic;
check('dbo_hud: the hourglass top right at the browser\'s 62%, 2.4% down', w3.root.dboMark._visible === true && w3.root.dboMark._alpha === 62 && !!pic && /dbo-hourglass/.test(pic._image || '')
  && pic._x > 1000 && Math.abs(pic._y - 720 * 0.024) < 1, pic && [pic._image, pic._x, pic._y]);
w3.push(pay({ watermark: false }));
check('...and gone when the server switches it off', w3.root.dboMark._visible === false);

// ---- the wiring ----
const src = (p2) => fs.readFileSync(path.join(ROOT, p2), 'utf8').replace(/\r\n/g, '\n');
const relay = src('src/services/services/dboRelayService.ts');
check('the relay marks both hud widget builds native while the native HUD is up', (relay.match(/\.\.\.this\.hudNative\(\),/g) || []).length === 2 && /return hudShared\.nativeUp \? \{ native: true \} : \{\};/.test(relay));
check('...and leaves the native HUD the server\'s fields and the vitals', /hudShared\.server = this\.hudData \?/.test(relay) && /hudShared\.vitals = \{ h, m, s \};/.test(relay));
check('the voice service leaves the range', /hudShared\.voiceMode = key;/.test(src('src/services/services/voiceService.ts')));
check('the service is started', /new NativeHudService\(sp, controller\),/.test(src('src/index.ts')));
check('the front leaves out its corner, bars and watermark while native (dbo_hud draws them)', /\{data\.native \? null : <Corner/.test(front) && /\{data\.native \? null : <Vitals data=\{data\} ui=\{ui\} \/>\}/.test(front) && /<Watermark on=\{data\.watermarkOn !== false && !data\.native\} \/>/.test(front));
check('...and forwards V to the client', /sendMessage\('dbo:voicePtt', on\)/.test(front));

// ---- mutants of nativeHud.ts's party and watermark decisions: each altered copy must fail (Worker 4, 1 Nov: a mutant
// run by hand protects nothing later, so they live here) ----
const partyChecks = (M) => {
  let bad = 0;
  const c = (ok) => { if (!ok) bad++; };
  const q = M.partyOf(crew);
  c(M.partyOf(null) === null && M.partyOf({ self: 1, rows: [] }) === null);
  c(q && q.title === 'Party' && M.partyOf({ self: 1, rows: [crew.rows[3]] }).title === 'Companions');
  c(q && q.rows[0].leader && q.rows[0].self && q.rows[0].pct === 80 && q.rows[1].dead && q.rows[1].pct === 100 && !q.rows[1].self && q.rows[2].far);
  c(q && q.rows[3].tag === 'stay' && q.rows[3].clock === '1:05' && !q.rows[3].self);
  const s0 = { hunger: 0, stage: 'sated', hungerOn: true, vitalsOn: true };
  c(M.payloadOf(s0, null, 'talk', false, M.UI_DEFAULTS, M.newClock(0), 0).watermark === true && M.payloadOf(Object.assign({}, s0, { watermarkOn: false }), null, 'talk', false, M.UI_DEFAULTS, M.newClock(0), 0).watermark === false);
  return bad;
};
const HUD_SRC = fs.readFileSync(path.join(ROOT, 'src', 'services', 'services', 'nativeHud.ts'), 'utf8');
const PROMPT_SRC = fs.readFileSync(path.join(ROOT, 'src', 'services', 'services', 'nativePrompt.ts'), 'utf8');
const mutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-nativehud-mut-'));
const compiledFrom = (src, i) => {
  const d = path.join(mutDir, `m${i}`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'nativeHud.ts'), src);
  fs.writeFileSync(path.join(d, 'nativePrompt.ts'), PROMPT_SRC);
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), path.join(d, 'nativeHud.ts'), '--outDir', d, '--module', 'commonjs', '--target', 'es2019'], { stdio: 'pipe' });
  return require(path.join(d, 'nativeHud.js'));
};
check('the mutant checks pass on nativeHud.ts as it is', partyChecks(H) === 0);
[
  ['always titled Party', 'title: party.rows.some((r) => !r.summon) ? "Party" : "Companions",', 'title: "Party",'],
  ['yourself never marked', 'self: r.id === party.self && !r.summon,', 'self: false,'],
  ['no summon clock', 'clock: r.summon && r.leftSec ?', 'clock: false ?'],
  ['health not clamped', 'pct: Math.max(0, Math.min(100, Number(r.health) || 0)),', 'pct: Number(r.health) || 0,'],
  ['the watermark ignores the server', 'watermark: server.watermarkOn !== false,', 'watermark: true,'],
].forEach(([name, a, b], i) => {
  if (!HUD_SRC.includes(a)) { check(`mutant "${name}": its line is in nativeHud.ts`, false, a); return; }
  let bad = 0;
  try { bad = partyChecks(compiledFrom(HUD_SRC.replace(a, b), i)); } catch (e) { bad = 1; }
  check(`mutant caught: ${name}`, bad > 0);
});
try { fs.rmSync(mutDir, { recursive: true, force: true }); } catch (e) { /* the OS */ }

T.done();
