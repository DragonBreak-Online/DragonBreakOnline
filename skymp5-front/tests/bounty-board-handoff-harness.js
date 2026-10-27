// Renders the notice board (features/bountyBoard) as the browser shows it and as the native board's composer hand-off
// ('compose:<tab>', set by the client router), and checks the hand-off draws only the composer for that tab.
//   node tests/bounty-board-handoff-harness.js [front dir]
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'board-front-'));
const SRC = path.join(FRONT, 'src/features/bountyBoard/index.tsx');

let fails = 0;
const ok = (cond, msg, got) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg + (got !== undefined ? '   ' + String(got).slice(0, 300) : '')); } };

const board = {
  boardName: 'Bruma', costGold: 30, gold: 120, maxTextLen: 600, maxNotes: 40, expiryDays: 7,
  events: { post: 'bountyBoard:post', remove: 'bountyBoard:remove', close: 'bountyBoard:close' },
  tabs: [{ id: 'hold', label: 'Hold Notices', cost: 0, canPost: false }, { id: 'shop', label: 'Shop Ads', cost: 30, canPost: true }, { id: 'citizen', label: 'Citizen Notices', cost: 30, canPost: true }],
  notes: [{ id: 2, tab: 'shop', author: 'Olaf', text: 'Iron ingots, cheap.', ageHours: 30, canRemove: true }],
};

fs.writeFileSync(path.join(TMP, 'entry.jsx'), `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Board from ${JSON.stringify(SRC)};
export const render = (data) => renderToStaticMarkup(React.createElement(Board, { data }));
`);

(async () => {
  await esbuild.build({
    entryPoints: [path.join(TMP, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(TMP, 'out.js'),
    logLevel: 'error', nodePaths: [NM], jsx: 'transform',
    loader: { '.js': 'jsx', '.scss': 'empty', '.sass': 'empty', '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.ttf': 'empty', '.otf': 'empty' },
  });
  const { render } = require(path.join(TMP, 'out.js'));
  const texts = (html) => html.replace(/<[^>]*>/g, '\n').split('\n').map((s) => s.replace(/&amp;/g, '&').trim()).filter(Boolean);

  let h = render(board), t = texts(h);
  ok(t.includes('Bruma Notice Board') && /bountyBoard__tabs/.test(h), 'without a hand-off the full board draws');
  ok(!/bountyBoard__compose"/.test(h), 'and no composer until Pin a notice');

  h = render(Object.assign({}, board, { handoff: 'compose:shop' })); t = texts(h);
  ok(/bountyBoard__compose"/.test(h) && /<textarea/.test(h), 'a compose hand-off draws the composer straight away');
  ok(t.some((s) => /Pin a notice · Shop Ads/.test(s)), 'for the tab the native board was on', t.join('|'));
  ok(t.includes('Post for 30 gold') && t.includes('Cancel'), 'with its Post and Cancel');
  ok(!t.includes('Bruma Notice Board') && !/bountyBoard__paper|bountyBoard__tabs/.test(h), 'and nothing of the board behind it');

  h = render(Object.assign({}, board, { handoff: 'compose:nope' }));
  ok(texts(h).some((s) => /Pin a notice · Hold Notices/.test(s)), 'an unknown tab falls back to the first');

  const src = fs.readFileSync(SRC, 'utf8');
  ok(/const cancelCompose = \(\) => \(composeOnly \? send\(ev\.close\) : setComposing\(false\)\)/.test(src), 'cancelling a hand-off sends the board close, which ends it');
  ok(/onClick=\{cancelCompose\}>Cancel/.test(src) && /if \(composing \|\| composeOnly\) cancelCompose\(\)/.test(src), 'Cancel and Escape both cancel through it');
  ok(/if \(!composeOnly\) setComposing\(false\)/.test(src), 'a posted hand-off keeps the composer up until the router takes the board back');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
