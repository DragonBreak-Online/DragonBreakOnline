// Renders the browser property menu (features/housing) and checks the market button is hidden on loose storage (Nat, 7 Nov:
// Winterhold urns and barrels): a chest, barrel or urn is granted with Grant this container, never rented or sold, so with the
// server's container: true nobody is offered Buy or rent / Rent and sale there. A door keeps the button as before.
//   node tests/housing-container-market-front-harness.js [front dir]
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'housing-container-market-'));

let fails = 0;
const ok = (cond, msg, got) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg + (got !== undefined ? '   ' + String(got).slice(0, 300) : '')); } };

fs.writeFileSync(path.join(TMP, 'entry.jsx'), `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Housing from ${JSON.stringify(path.join(FRONT, 'src/features/housing/index.tsx'))};
export const render = (data) => renderToStaticMarkup(React.createElement(Housing, { data }));
`);

(async () => {
  await esbuild.build({
    entryPoints: [path.join(TMP, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(TMP, 'out.js'),
    logLevel: 'error', nodePaths: [NM], jsx: 'transform',
    loader: { '.js': 'jsx', '.scss': 'empty', '.sass': 'empty', '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.ttf': 'empty', '.otf': 'empty' },
  });
  const { render } = require(path.join(TMP, 'out.js'));
  const texts = (html) => html.replace(/<[^>]*>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
  const MARKET = ['Buy or rent', 'Rent and sale', 'Sell or rent out'];
  const market = (data) => texts(render(Object.assign({
    type: 'housing', id: 70, targetLabel: 'Urn', view: 'denied', owned: true, name: null, locked: true, hasKeys: true,
    canGrantContainers: false, ownerName: 'Harbard', place: null, placeName: null, assignedToYou: false, keyRing: false, events: {},
  }, data))).filter((t) => MARKET.includes(t));

  ok(market({ container: true }).length === 0, 'someone else\'s container: no market button', market({ container: true }));
  ok(market({ view: 'owner', container: true }).length === 0, 'the owner\'s own container: no market button', market({ view: 'owner', container: true }));
  ok(market({ view: 'claimable', owned: false, ownerName: null, container: true }).length === 0, 'an unclaimed container: no market button');
  ok(market({ targetLabel: 'Door' }).join() === 'Buy or rent', 'a door someone else owns still offers Buy or rent', market({ targetLabel: 'Door' }));
  ok(market({ targetLabel: 'Door', view: 'owner' }).join() === 'Rent and sale', 'an owner\'s door still offers Rent and sale');

  console.log(fails ? `${fails} FAILED` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed', e); process.exit(1); });
