// Renders the birthsign picker (features/birthsignPicker, Nat 25 Oct: Worker 2's mock) with the thirteen signs the server
// sends and checks its shape: the three Guardians each head a column with their charges, the Serpent sits below, every
// card has its emblem, lore and gift, and nothing offers "Not yet". The confirm's events and the wiring (the constructor's
// case and aedric domain, the HUD's 'birthsignPicker' cap) are checked in the source.
//   node tests/birthsign-picker-front-harness.js [front dir]
// Env: ESBUILD_DIR, FRONT_NM. Prints ok/FAIL lines and exits 1 on a FAIL.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const FRONT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const HOME = process.env.HOME || '';
const firstWith = (file, ...dirs) => dirs.find((d) => d && fs.existsSync(path.join(d, file)));
const NM = firstWith('react-dom/server.js', process.env.FRONT_NM, path.join(FRONT, 'node_modules'), path.join(HOME, 'dragonbreak/fork/skymp5-front/node_modules'));
const ESB = firstWith('package.json', process.env.ESBUILD_DIR, path.join(FRONT, '../skymp5-server/node_modules/esbuild'), path.join(HOME, 'dragonbreak/fork/skymp5-server/node_modules/esbuild'));
if (!NM || !ESB) { console.log(`SKIP needs FRONT_NM (${NM}) and ESBUILD_DIR (${ESB})`); process.exit(0); }
const esbuild = require(ESB);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'birthsign-picker-'));

let fails = 0;
const ok = (cond, msg, got) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg + (got !== undefined ? '   ' + String(got).slice(0, 300) : '')); } };

// The payload as the server sends it: birthsign-picker-payload.json, captured from server birthsigns-1025 9bb1d4f61's own
// harness (the creation step's picker for a client with the cap). Re-capture it when the server's payload changes
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'birthsign-picker-payload.json'), 'utf8'));
// The same signs out of display order, with test lore and gifts, to prove the columns come from guardian, not position
const SIGNS = [
  ['warrior', 'The Warrior', ''], ['mage', 'The Mage', ''], ['thief', 'The Thief', ''], ['lady', 'The Lady', 'warrior'], ['lord', 'The Lord', 'warrior'],
  ['steed', 'The Steed', 'warrior'], ['apprentice', 'The Apprentice', 'mage'], ['atronach', 'The Atronach', 'mage'], ['ritual', 'The Ritual', 'mage'],
  ['lover', 'The Lover', 'thief'], ['shadow', 'The Shadow', 'thief'], ['serpent', 'The Serpent', 'none'], ['tower', 'The Tower', 'thief'],
].map(([id, name, guardian]) => ({ id, name, guardian, lore: `Lore of ${name}.`, effect: `Gift of ${name}`, emblem: REAL.signs.find((s) => s.id === id).emblem }));

fs.writeFileSync(path.join(TMP, 'entry.jsx'), `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BirthsignPicker, { layout, EMBLEMS, emblemOf } from ${JSON.stringify(path.join(FRONT, 'src/features/birthsignPicker/index.tsx'))};
export const render = (data) => renderToStaticMarkup(React.createElement(BirthsignPicker, { data }));
export { layout, EMBLEMS, emblemOf };
`);

(async () => {
  await esbuild.build({
    entryPoints: [path.join(TMP, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(TMP, 'out.js'),
    logLevel: 'error', nodePaths: [NM], jsx: 'transform',
    loader: { '.js': 'jsx', '.scss': 'empty', '.sass': 'empty', '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.ttf': 'empty', '.otf': 'empty', '.mp3': 'empty', '.wav': 'empty' },
  });
  const { render, layout, EMBLEMS, emblemOf } = require(path.join(TMP, 'out.js'));
  const texts = (html) => html.replace(/<[^>]*>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
  const starsIn = (html) => (html.match(/birthsign__star/g) || []).length;

  // ---- the server's own payload (9bb1d4f61) ----
  const real = render(REAL);
  const rt = texts(real);
  ok(REAL.type === 'birthsignPicker' && REAL.id === 163 && REAL.signs.length === 13, 'the captured payload is the server\'s picker: type, id 163, thirteen signs');
  ok(rt.includes(REAL.title) && rt.includes(REAL.sub), 'the title and the line under it come from the payload', [REAL.title, REAL.sub]);
  ok(layout(REAL.signs).columns.map((c) => c.map((s) => s.id).join(',')).join(' | ') === 'warrior,lady,steed,lord | mage,apprentice,atronach,ritual | thief,lover,shadow,tower'
    && layout(REAL.signs).below.map((s) => s.id).join() === 'serpent', 'the server\'s order gives the mock\'s columns, the Serpent below');
  ok(REAL.signs.every((s) => rt.includes(s.lore) && rt.includes(s.effect)), 'every sign\'s lore and gift, as the server words them');
  ok(starsIn(real) === REAL.signs.reduce((n, s) => n + s.emblem.stars.length, 0), 'every emblem drawn from the payload, star for star', starsIn(real));
  ok(REAL.signs.every((s) => JSON.stringify(EMBLEMS[s.id] && EMBLEMS[s.id].s) === JSON.stringify(s.emblem.stars) && JSON.stringify(EMBLEMS[s.id].l) === JSON.stringify(s.emblem.lines)),
    'the front\'s fallback copy of the art is the server\'s, line for line');
  // The payload's emblem wins, null leaves the slot empty, a missing field falls back by id, a bad line is skipped
  const moved = REAL.signs.map((s) => (s.id === 'lord' ? Object.assign({}, s, { emblem: { stars: [[1, 1], [2, 2]], lines: [[0, 1], [0, 9]] } }) : s));
  const mv = render(Object.assign({}, REAL, { signs: moved }));
  ok(/cx="1" cy="1"/.test(mv) && (mv.match(/<line /g) || []).length === REAL.signs.reduce((n, s) => n + (s.id === 'lord' ? 1 : s.emblem.lines.length), 0), 'the payload\'s emblem is drawn; a line to a star that is not there is skipped');
  const none = render(Object.assign({}, REAL, { signs: REAL.signs.map((s) => (s.id === 'lord' ? Object.assign({}, s, { emblem: null }) : s)) }));
  ok((none.match(/<svg/g) || []).length === 12 && emblemOf({ id: 'lord', emblem: null }) === null, 'emblem null leaves the slot empty');
  ok(emblemOf({ id: 'lord' }).stars.length === 6 && emblemOf({ id: 'nobody' }) === null && emblemOf({ id: 'x', emblem: { stars: [] } }) === null, 'no field: the front\'s copy by id; an unknown sign or no stars: empty');

  // ---- the layout ----
  const L = layout(SIGNS);
  ok(L.columns.map((c) => c.map((s) => s.id).join(',')).join(' | ') === 'warrior,lady,lord,steed | mage,apprentice,atronach,ritual | thief,lover,shadow,tower',
    'three columns, each Guardian over its charges in the order sent', L.columns.map((c) => c.map((s) => s.id).join(',')).join(' | '));
  ok(L.below.map((s) => s.id).join(',') === 'serpent', 'the Serpent, under no Guardian, sits below', L.below.map((s) => s.id));
  const orphan = layout(SIGNS.concat([{ id: 'x', name: 'X', guardian: 'nobody', lore: '', effect: '' }]));
  ok(orphan.below.map((s) => s.id).join(',') === 'serpent,x' && orphan.columns.length === 3, 'a charge of a Guardian not sent goes below, never lost');
  ok(SIGNS.every((s) => EMBLEMS[s.id] && EMBLEMS[s.id].s.length >= 4 && EMBLEMS[s.id].l.every(([a, b]) => EMBLEMS[s.id].s[a] && EMBLEMS[s.id].s[b])), 'every sign has a constellation, each line between two of its stars');

  // ---- the render ----
  const html = render({ id: 163, nonce: 'n1', signs: SIGNS });
  const t = texts(html);
  ok(t.includes('Choose your birthsign') && t.some((x) => /Yours for life; only staff can change it later/.test(x)), 'the title and the line under it');
  ok((html.match(/class="birthsign__card[ "]/g) || []).length === 13, 'thirteen cards', (html.match(/birthsign__card[ "]/g) || []).length);
  ok((html.match(/birthsign__card--guardian/g) || []).length === 3 && t.filter((x) => x === 'Guardian').length === 3 && t.filter((x) => x === 'Wanders').length === 1, 'three Guardians marked, the Serpent marked as wandering');
  ok(SIGNS.every((s) => t.includes(`Lore of ${s.name}.`) && t.includes(`Gift of ${s.name}`)), 'every card shows its lore and its gift');
  ok((html.match(/<svg/g) || []).length === 13 && (html.match(/birthsign__star/g) || []).length === SIGNS.reduce((n, s) => n + EMBLEMS[s.id].s.length, 0), 'every card draws its emblem, star for star');
  ok(/birthsign__below/.test(html) && html.indexOf('The Serpent') > html.indexOf('The Tower'), 'the Serpent is drawn after the columns');
  ok(t.includes('Choose a sign') && /disabled=""/.test(html.slice(html.indexOf('birthsign__button--primary') - 200)), 'nothing chosen yet: the button reads Choose a sign and is off');
  ok(!t.some((x) => /not yet/i.test(x)) && !/birthsign__confirm-box/.test(html), 'no "Not yet", and no confirm until a sign is chosen');
  ok(render({ id: 163, signs: [] }).includes('Choose your birthsign') && render({ id: 163 }).includes('Choose your birthsign'), 'an empty or missing list still draws (no throw)');
  ok(texts(render({ id: 163, nonce: 'n2', signs: SIGNS, notice: 'That sign is not offered.' })).includes('That sign is not offered.'), 'a notice from the server is shown');

  // ---- the source: events and wiring ----
  const src = fs.readFileSync(path.join(FRONT, 'src/features/birthsignPicker/index.tsx'), 'utf8');
  const ctor = fs.readFileSync(path.join(FRONT, 'src/constructor.js'), 'utf8');
  const hud = fs.readFileSync(path.join(FRONT, 'src/features/hud/index.tsx'), 'utf8');
  ok(/onClick=\{\(\) => send\('dbo:birthsignPick', nonce, shown\.id\)\}>Confirm</.test(src), 'Confirm sends dbo:birthsignPick with the nonce and the sign');
  ok(/if \(confirming\) \{ setConfirming\(false\); return; \}\s*send\('dbo:birthsignClose', nonce\);/.test(src), 'Escape closes the confirm first, then sends dbo:birthsignClose');
  ok(/onDoubleClick=\{\(\) => \{ setSelected\(s\.id\); setConfirming\(true\); \}\}/.test(src), 'a double click goes straight to the confirm');
  ok(/case 'birthsignPicker':\s*return <BirthsignPicker data=\{rend\} \/>;/.test(ctor) && /birthsignPicker: 'aedric'/.test(ctor), 'the constructor draws it, in the aedric gold');
  ok(/^\s*'birthsignPicker',/m.test(hud), "the HUD tells the server 'birthsignPicker' in dbo:uiCaps");

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL harness error ' + (e && e.stack || e)); process.exit(1); });
