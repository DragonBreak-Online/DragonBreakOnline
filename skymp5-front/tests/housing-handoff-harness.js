// Renders the property menu (features/housing) as the browser shows it and as the native menu's name-box hand-off
// ('rename', set by the client router), and checks the hand-off draws only the name box.
//   node tests/housing-handoff-harness.js [front dir]
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'housing-front-'));
const SRC = path.join(FRONT, 'src/features/housing/index.tsx');

let fails = 0;
const ok = (cond, msg, got) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg + (got !== undefined ? '   ' + String(got).slice(0, 300) : '')); } };

const menu = {
  targetLabel: 'Door', view: 'owner', owned: true, name: 'Rose Hall', locked: false, hasKeys: true, canGrantContainers: false,
  ownerName: 'Olaf', place: null, placeName: null, assignedToYou: false, keyRing: true,
  events: { rename: 'housing:rename', cancel: 'housing:cancel', lock: 'housing:lock' },
};

fs.writeFileSync(path.join(TMP, 'entry.jsx'), `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Housing from ${JSON.stringify(SRC)};
export const render = (data) => renderToStaticMarkup(React.createElement(Housing, { data }));
`);

(async () => {
  await esbuild.build({
    entryPoints: [path.join(TMP, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(TMP, 'out.js'),
    logLevel: 'error', nodePaths: [NM], jsx: 'transform',
    loader: { '.js': 'jsx', '.scss': 'empty', '.sass': 'empty', '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.ttf': 'empty', '.otf': 'empty' },
  });
  const { render } = require(path.join(TMP, 'out.js'));
  const texts = (html) => html.replace(/<[^>]*>/g, '\n').split('\n').map((s) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').trim()).filter(Boolean);

  let h = render(menu), t = texts(h);
  ok(t.includes('Rose Hall') && t.includes('Lock') && t.includes('Cut a key') && /housing__rename/.test(h), 'without a hand-off the full menu draws, name box included');

  h = render(Object.assign({}, menu, { handoff: 'rename' })); t = texts(h);
  ok(t.includes('Rename Rose Hall') && /housing__input/.test(h) && t.includes('Save') && t.includes('Cancel'), 'a rename hand-off draws the name box, Save and Cancel', t.join('|'));
  ok(!t.includes('Lock') && !t.includes('Cut a key') && !t.includes('Close'), 'and none of the menu behind it', t.join('|'));
  ok(/value="Rose Hall"/.test(h), 'the box starts with the current name');

  h = render(Object.assign({}, menu, { view: 'keyholder', handoff: 'rename' }));
  ok(!/housing__rename/.test(h) && texts(h).includes('Lock'), 'a key holder cannot rename: a stray hand-off falls back to the menu');

  const src = fs.readFileSync(SRC, 'utf8');
  ok(/onClick=\{\(\) => send\(ev\.cancel\)\}>\s*Cancel/.test(src), 'Cancel sends the menu cancel, which ends the hand-off');
  ok(/onClick=\{\(\) => send\(ev\.rename, rename\.trim\(\)\)\}/.test(src), 'Save sends the rename with the trimmed name');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
