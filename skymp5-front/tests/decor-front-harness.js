// Renders the home decorating panel (features/decor, widget 171) from the payloads the server sends, captured by server
// tests/decor-panel-harness.js (DECOR_PAYLOADS=... node tests/decor-panel-harness.js; decor-panel-cef-1026), and checks
// what it draws. Its events and wiring (constructor case and bronze domain, the HUD's decorPanel cap) are checked in source.
//   node tests/decor-front-harness.js [front dir]
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'decor-front-'));
const P = JSON.parse(fs.readFileSync(path.join(__dirname, 'decor-payloads.json'), 'utf8'));

let fails = 0;
const ok = (cond, msg, got) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg + (got !== undefined ? '   ' + String(got).slice(0, 300) : '')); } };

fs.writeFileSync(path.join(TMP, 'entry.jsx'), `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Decor from ${JSON.stringify(path.join(FRONT, 'src/features/decor/index.tsx'))};
export const render = (data) => renderToStaticMarkup(React.createElement(Decor, { data }));
`);

(async () => {
  await esbuild.build({
    entryPoints: [path.join(TMP, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(TMP, 'out.js'),
    logLevel: 'error', nodePaths: [NM], jsx: 'transform',
    loader: { '.js': 'jsx', '.scss': 'empty', '.sass': 'empty', '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.ttf': 'empty', '.otf': 'empty' },
  });
  const { render } = require(path.join(TMP, 'out.js'));
  const unescape = (s) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const texts = (html) => html.replace(/<[^>]*>/g, '\n').split('\n').map((s) => unescape(s.trim())).filter(Boolean);
  const count = (html, cls) => (html.match(new RegExp(cls + '[ "]', 'g')) || []).length;

  // ---- the catalogue, as the server sends it ----
  ok(P.catalog.type === 'decor' && P.catalog.id === 171 && P.catalog.view === 'catalog', 'the captured payload is the server\'s decor panel: type, id 171, catalogue');
  let h = render(P.catalog), t = texts(h);
  ok(t.includes(P.catalog.home), 'the title is the home', P.catalog.home);
  ok(count(h, 'decor__meter') === P.catalog.budget.length && P.catalog.budget.every((m) => t.includes(`${m.used}/${m.of}`)), 'one meter per budget line, with used/of');
  ok(t.includes('Catalogue') && t.includes('Placed') && t.includes('Carpenters'), 'the owner has three tabs');
  ok(count(h, 'decor__chip') === P.catalog.groups.length && /decor__chip decor__chip--on/.test(h), 'one chip per group, the open one marked');
  ok(/placeholder="Search every group"/.test(h), 'a search box on the catalogue');
  ok(count(h, 'decor__row') === P.catalog.rows.length && P.catalog.rows.every((r) => t.includes(r.name)), 'one row per piece');
  const short = P.catalog.rows[0].cost.filter((c) => c.have < c.n);
  ok(short.length && count(h, 'decor__cost--short') >= short.length, 'a material you are short of is marked', short.length);
  ok(/disabled="" class="decor__button"|class="decor__button" disabled=""/.test(h), 'Place is off while short');

  // ---- a blocked row ----
  h = render(P.blocked); t = texts(h);
  ok(/decor__row--blocked/.test(h) && t.includes(P.blocked.rows[0].why), 'a row the home cannot take shows the server\'s reason', P.blocked.rows[0].why);

  // ---- search ----
  h = render(P.search); t = texts(h);
  ok(!/decor__chips/.test(h) && t.includes('Wardrobe'), 'searching hides the chips and lists the matches');
  ok(texts(render(Object.assign({}, P.search, { rows: [] }))).includes('Nothing matches.'), 'no match says so');

  // ---- placed ----
  h = render(P.placed); t = texts(h);
  ok(count(h, 'decor__row') === P.placed.rows.length && t.filter((x) => x === 'Move').length === P.placed.rows.length && t.filter((x) => x === 'Remove').length === P.placed.rows.length, 'every placed piece has Move and Remove');
  ok(t.some((x) => x.indexOf('taking it down gives back') === 0), 'the refund preview is shown');
  ok(t.some((x) => /^Undo \(\d+ s\)$/.test(x)), 'Undo with its seconds while one is open', P.placed.undo);
  ok(!texts(render(Object.assign({}, P.placed, { undo: 0 }))).some((x) => /^Undo/.test(x)), 'no Undo when none is open');
  ok(texts(render(Object.assign({}, P.placed, { rows: [] }))).includes('Nothing placed here yet.'), 'an empty home says so');

  // ---- people ----
  h = render(P.people); t = texts(h);
  ok(t.includes('Stray') && t.includes('Dismiss'), 'a hired carpenter with Dismiss');
  ok(P.people.nearby.length === 0 || (t.includes('Here now') && t.includes('Hire')), 'who is here, with Hire');
  const r0 = P.people.rows[0];
  ok(r0.tier && t.includes(`${r0.tier} woodworker, ${r0.refund}% back`), "each carpenter's woodworking rank and refund share", `${r0.tier} ${r0.refund}`);
  ok(P.people.own && t.some((x) => x.indexOf(`Your own: ${P.people.own.tier}, ${P.people.own.refund}% back.`) >= 0), "the owner's own share to compare with");
  ok(t.some((x) => /comes back to you, at their/.test(x)), "the line saying a carpenter's takedowns come back to the owner");
  ok(texts(render(Object.assign({}, P.people, { rows: [{ key: '9', name: 'Away', online: false, tier: '', refund: null }] }))).includes('offline'), 'an offline carpenter shows as offline, not a rank');
  ok(!texts(render(Object.assign({}, P.catalog, { owner: false }))).includes('Carpenters'), 'no Carpenters tab for someone who is not the owner');

  // ---- paging and robustness ----
  h = render(Object.assign({}, P.catalog, { page: 1, pages: 3 }));
  ok(texts(h).includes('Page 2 of 3') && texts(h).includes('Previous') && texts(h).includes('Next'), 'the pager on a middle page');
  ok(!/decor__pager/.test(render(Object.assign({}, P.catalog, { pages: 1 }))), 'one page: no pager');
  ok(render({ id: 171, nonce: 'x', view: 'catalog', home: 'H', owner: true, undo: 0, page: 0, pages: 1 }).includes('Nothing in this group.'), 'missing lists still draw (no throw)');

  // ---- the source: events and wiring ----
  const src = fs.readFileSync(path.join(FRONT, 'src/features/decor/index.tsx'), 'utf8');
  const ctor = fs.readFileSync(path.join(FRONT, 'src/constructor.js'), 'utf8');
  const hud = fs.readFileSync(path.join(FRONT, 'src/features/hud/index.tsx'), 'utf8');
  for (const ev of ['dbo:decorPlace', 'dbo:decorMove', 'dbo:decorRemove', 'dbo:decorUndo', 'dbo:decorGrant', 'dbo:decorRevoke', 'dbo:decorView', 'dbo:decorClose']) {
    ok(src.includes(`'${ev}'`), `the panel sends ${ev}`);
  }
  ok(/send\(event, data\.nonce, \.\.\.args\)/.test(src) && /send\('dbo:decorView', data\.nonce, v, group, page,/.test(src), 'every action carries the nonce first, decorView as view, group, page, search');
  ok(/case 'decor':\s*return <Decor data=\{rend\} \/>;/.test(ctor) && /decor: 'bronze'/.test(ctor), 'the constructor draws it, in bronze');
  ok(/'decorPanel'/.test(hud), "the HUD tells the server 'decorPanel' in dbo:uiCaps");

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL harness error ' + (e && e.stack || e)); process.exit(1); });
