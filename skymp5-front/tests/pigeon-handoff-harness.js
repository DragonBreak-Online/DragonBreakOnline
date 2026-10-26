// Renders the pigeon coop (features/pigeon) as the browser shows it and as the native coop's typed-input hand-off
// (data.handoff 'send' | 'supply' | 'courier', set by gamemode.js pigeonCompose), and checks each draws only its composer.
//   node tests/pigeon-handoff-harness.js [front dir]
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pigeon-front-'));
const SRC = path.join(FRONT, 'src/features/pigeon/index.tsx');

let fails = 0;
const ok = (cond, msg, got) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg + (got !== undefined ? '   ' + String(got).slice(0, 400) : '')); } };

const coop = {
  id: 34, nonce: 'n1', boardName: 'Bruma', gold: 120, cooldownMinutes: 0, maxText: 240, view: 'send',
  contacts: [{ id: 11, name: 'Bob', tag: 'BOBB', online: true, price: 5 }, { id: 12, name: 'Eve', tag: 'EVEE', online: false, price: 5 }],
  letters: [{ id: 'l1', from: 'Ann', text: 'hi', at: 0, read: false }],
  sendable: [{ baseId: 1, name: 'Iron Ingot', count: 4 }],
  parcel: { enabled: true, taxRate: 0.1, itemFee: 2, maxStacks: 3, maxGold: 500 },
  supply: { enabled: true, zone: 'Bruma', feeShare: 0.1, minFee: 5, maxCount: 50, maxOpen: 3, openDays: 3, search: '', results: [{ desc: '5ace4:Skyrim.esm', name: 'Iron Ore' }],
    orders: [{ id: 7, name: 'Iron Ore', count: 5, filled: 0, reward: 50, perUnit: 10, held: 50, poster: 'Ann', hoursLeft: 10, zone: 'Bruma', state: 'open', mine: false, have: 2 }], mine: [] },
  courier: { enabled: true, place: 'Bruma', placeId: 'bruma', destinations: [{ key: 'board:whiterun', kind: 'board', name: 'Whiterun', hint: '' }], goods: [{ baseId: 1, name: 'Iron Ingot', count: 4, value: 7 }],
    rules: { feeShare: 0.1, minFee: 5, premiumRate: 0.05, maxStacks: 3, minPay: 10, maxPay: 1000, limitGameDays: 3, openDays: 3, maxCarried: 2, maxOpen: 3, maxPayoutsPerWeek: 5 },
    open: [{ id: 3, goods: '2 Iron Ingot', kinds: 1, pay: 40, dest: 'Whiterun', kind: 'board', origin: 'Bruma', sender: 'Ann', recipient: 'Ann', insured: 0, state: 'open', hoursLeft: 20, gameHoursLeft: 0, mine: false }],
    carrying: [], broken: [], mine: [] },
};

fs.writeFileSync(path.join(TMP, 'entry.jsx'), `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Pigeon from ${JSON.stringify(SRC)};
export const render = (data) => renderToStaticMarkup(React.createElement(Pigeon, { data }));
`);

(async () => {
  await esbuild.build({
    entryPoints: [path.join(TMP, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(TMP, 'out.js'),
    logLevel: 'error', nodePaths: [NM], jsx: 'transform',
    loader: { '.js': 'jsx', '.scss': 'empty', '.sass': 'empty', '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.ttf': 'empty', '.otf': 'empty' },
  });
  const { render } = require(path.join(TMP, 'out.js'));
  const texts = (html) => html.replace(/<[^>]*>/g, '\n').split('\n').map((s) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').trim()).filter(Boolean);

  let h = render(coop), t = texts(h);
  ok(t.includes('Bruma Pigeon Coop') && t.includes('Send a pigeon') && t.includes('Supply orders') && t.includes('Close') && t.includes('Eve'), 'without a hand-off the whole coop draws, tabs, contacts and Close');

  h = render(Object.assign({}, coop, { handoff: 'send', handoffTo: 12 })); t = texts(h);
  ok(t.includes('A letter for Eve') && /pigeon__text/.test(h) && t.includes('Sign as') && t.includes('Gold'), 'a send hand-off: the letter for the chosen contact, signing and the parcel', t.join('|'));
  ok(!t.includes('Send a pigeon') && !t.includes('Letters') && !t.includes('Supply orders') && !/pigeon__contacts/.test(h), 'and no tabs or contact list', t.join('|'));
  ok(t.includes('Cancel') && !t.includes('Close') && t.includes('Send the pigeon'), 'Cancel instead of Close, and the send button', t.join('|'));
  h = render(Object.assign({}, coop, { handoff: 'send', handoffTo: 99 }));
  ok(texts(h).includes('A letter for Bob'), 'a recipient no longer a contact falls back to the first');

  h = render(Object.assign({}, coop, { handoff: 'supply' })); t = texts(h);
  ok(t.includes('Bruma supply orders') && t.includes('Post a supply order') && t.includes('Search') && t.includes('Iron Ore'), 'a supply hand-off: the order form with its search', t.join('|'));
  ok(!/pigeon__contacts/.test(h) && !t.includes('Your orders (0 of 3)') && !t.includes('Hand over 2'), 'and none of the board\'s orders', t.join('|'));

  h = render(Object.assign({}, coop, { handoff: 'courier' })); t = texts(h);
  ok(t.includes('Bruma couriers') && t.includes('Send goods by courier') && t.includes('Where it goes') && t.includes('Choose the goods'), 'a courier hand-off: the job form', t.join('|'));
  ok(!/pigeon__contacts/.test(h) && !t.includes('Wanted at Bruma'), 'and none of the jobs', t.join('|'));

  h = render(Object.assign({}, coop, { handoff: 'nonsense' }));
  ok(texts(h).includes('Bruma Pigeon Coop'), 'an unknown hand-off draws the ordinary coop');

  const src = fs.readFileSync(SRC, 'utf8');
  ok(/onClick=\{\(\) => send\('dbo:pigeonCompose', data\.nonce, ''\)\}>Cancel/.test(src), 'Cancel sends dbo:pigeonCompose with no mode, which brings the native coop back');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
