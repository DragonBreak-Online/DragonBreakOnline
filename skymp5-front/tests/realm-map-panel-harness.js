// Renders the faction panel's Realm tab (panel 37 and the journal's Faction tab) in headless Chrome and checks it fits the screen.
// Cases: Bruma only (war.mapWorlds Cyrodiil), an older server (no mapWorld), the Skyrim war map (Cyrodiil + Tamriel, 39 places).
//   LD_LIBRARY_PATH=$(cat ~/claude-c-layout/ldpath) node tests/realm-map-panel-harness.js [front dir] [out dir]
// Env: PUPPETEER_DIR (and PUPPETEER_CACHE_DIR or PUPPETEER_EXECUTABLE_PATH), ESBUILD_DIR, FRONT_NM, RES=1280x720,...
// Writes <out>/<context>-<case>-<map>-<w>x<h>.png and <out>/layout.json; prints ok/FAIL lines and exits 1 on a FAIL.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const FRONT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const OUTDIR = path.resolve(process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'realm-map-panel-')));
const HOME = process.env.HOME || '';
// The first directory that holds the given file
const firstWith = (file, ...dirs) => dirs.find((d) => d && fs.existsSync(path.join(d, file)));
const NM = firstWith('sass', process.env.FRONT_NM, path.join(FRONT, 'node_modules'), path.join(HOME, 'dragonbreak/fork/skymp5-front/node_modules'));
const ESB = firstWith('package.json', process.env.ESBUILD_DIR, path.join(FRONT, '../skymp5-server/node_modules/esbuild'), path.join(HOME, 'dragonbreak/fork/skymp5-server/node_modules/esbuild'));
const PUP = firstWith('package.json', process.env.PUPPETEER_DIR, path.join(HOME, 'claude-c-layout/node_modules/puppeteer'));
if (!NM || !ESB || !PUP) { console.log(`SKIP needs FRONT_NM (${NM}), ESBUILD_DIR (${ESB}) and PUPPETEER_DIR (${PUP})`); process.exit(0); }
const sass = require(path.join(NM, 'sass'));
const esbuild = require(ESB);
const puppeteer = require(PUP);
fs.mkdirSync(OUTDIR, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-map-panel-build-'));

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg); } };

// ---- the page: each .scss compiled with the front's sass and injected where it is imported (webpack's style-loader) ----
const inlineFonts = (css, dir) => css.replace(/url\(["']?([^"')]+\.(?:ttf|otf))["']?\)/g, (m, rel) => {
  const f = path.resolve(dir, rel);
  return fs.existsSync(f) ? `url(data:font/ttf;base64,${fs.readFileSync(f).toString('base64')})` : m;
});
const scssPlugin = {
  name: 'scss',
  setup(build) {
    build.onResolve({ filter: /\.s[ac]ss$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path), namespace: 'scss' }));
    build.onLoad({ filter: /.*/, namespace: 'scss' }, (a) => {
      const css = inlineFonts(sass.compile(a.path, { loadPaths: [path.dirname(a.path), path.join(FRONT, 'src'), NM], quietDeps: true,
        silenceDeprecations: ['import', 'global-builtin', 'slash-div', 'color-functions'] }).css, path.dirname(a.path));
      return { contents: `const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s);`, loader: 'js' };
    });
  },
};
// The map marker icons (realm.tsx reads them with webpack's require.context): the same files, as data URLs
const ICON_DIR = path.join(FRONT, 'src/img/mapicons');
const icons = {};
for (const f of (fs.existsSync(ICON_DIR) ? fs.readdirSync(ICON_DIR) : []).filter((x) => x.endsWith('.png'))) icons['./' + f] = 'data:image/png;base64,' + fs.readFileSync(path.join(ICON_DIR, f)).toString('base64');
fs.writeFileSync(path.join(TMP, 'entry.jsx'), `
import React from 'react';
import ReactDOM from 'react-dom';
import ${JSON.stringify(path.join(FRONT, 'src/main.scss'))};
import ${JSON.stringify(path.join(FRONT, 'src/constructor.scss'))};
import ${JSON.stringify(path.join(FRONT, 'src/utils/UiScale.js'))};
import Faction from ${JSON.stringify(path.join(FRONT, 'src/features/faction/index.tsx'))};
import Journal from ${JSON.stringify(path.join(FRONT, 'src/features/journal/index.tsx'))};
window.__sent = [];
window.skyrimPlatform = { sendMessage(...a) { window.__sent.push(a); } };
const root = () => document.getElementById('root');
window.show = (ctx, data) => {
  ReactDOM.unmountComponentAtNode(root());
  ReactDOM.render(ctx === 'panel'
    ? <div className="dbo-domain" data-domain="bronze"><Faction data={data} /></div>
    : <div className="dbo-domain" data-domain="dragonbreak"><Journal data={{ id: 24, nonce: 'j1', tab: 'faction', profile: { name: 'Hrolfdir', title: 'Jarl of Whiterun', race: 'Nord' }, faction: data }} /></div>, root());
};
`);
esbuild.build({
  entryPoints: [path.join(TMP, 'entry.jsx')], bundle: true, format: 'iife', outfile: path.join(TMP, 'bundle.js'), jsx: 'transform',
  loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.ttf': 'empty', '.otf': 'empty', '.woff': 'empty', '.woff2': 'empty', '.mp3': 'empty', '.wav': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [NM], plugins: [scssPlugin], logLevel: 'error',
}).then(() => run()).catch((e) => { console.error(e); cleanup(); process.exit(1); });
const cleanup = () => fs.rmSync(TMP, { recursive: true, force: true });

// ---- the payloads (server realm.js realmView), from tests/realm-sample.json -------------------------------------------
const S = JSON.parse(fs.readFileSync(path.join(__dirname, 'realm-sample.json'), 'utf8'));
const CYRODIIL = 'a764b:BSHeartland.esm', TAMRIEL = '3c:Skyrim.esm';
const worldKey = (w) => (S.worldAliases[w] || w).toLowerCase();
const COLOURS = ['#b5432f', '#3f6fb0', '#4f8a3a', '#c9a227', '#7b4fa0', '#2f8f8a', '#a0522d', '#5a6b7d', '#9c2f5e', '#6b8e23', '#d2691e', '#4682b4', '#8b5a2b', '#556b2f', '#8b0000', '#2e5e4e', '#c0c0c0/#b5432f'];
const owners = Array.from(new Set(S.territories.map((t) => t.owner)));
const colours = Object.fromEntries(owners.map((o, i) => [o, COLOURS[i % COLOURS.length]]));
const realmView = ({ mapWorlds, mapWorld = true, lead = false }) => {
  const onMap = (w) => !mapWorlds.length || mapWorlds.some((m) => worldKey(m) === worldKey(w));
  const mapWorldOf = (w) => mapWorlds.find((m) => worldKey(m) === worldKey(w)) || w;
  const ts = S.territories.filter((t) => onMap(t.world));
  const territories = ts.map((t) => Object.assign({ id: t.id, name: t.name, kind: t.kind, owner: t.owner, ownerName: S.names[t.owner], world: t.world },
    mapWorld ? { mapWorld: mapWorldOf(t.world) } : {}, { x: t.x, y: t.y, icon: t.icon }));
  // A hold's capital is its zone's capital territory, a clan's its stronghold; the Legion's seat is indoors (no x, y)
  const capitals = owners.filter((o) => ts.some((t) => t.owner === o) || Object.values(S.holds).includes(o)).map((o) => {
    const zone = Object.keys(S.holds).find((z) => S.holds[z] === o);
    const seat = ts.find((t) => (zone ? t.zone === zone && t.kind === 'capital' : t.owner === o && t.kind === 'stronghold'));
    return seat ? { faction: o, factionName: S.names[o], name: seat.name, territory: seat.id, x: null, y: null, world: null }
      : { faction: o, factionName: S.names[o], name: o === 'imperial-legion' ? 'Castle Dour' : S.names[o], territory: null, x: null, y: null, world: null };
  }).filter((c) => c.territory || c.faction === 'imperial-legion');
  const secret = S.secret.filter((t) => onMap(t.world)).map((t) => Object.assign({ id: t.id, name: t.name, kind: t.kind, layer: ['The Cult of Namira'], x: t.x, y: t.y }, mapWorld ? { world: mapWorldOf(t.world) } : {}));
  const leads = lead ? [{ id: 'hold-whiterun', name: S.names['hold-whiterun'], treasury: 18250, online: 4, seat: 'Whiterun', atSeat: 1, capital: 'whiterun',
    capitalChoices: ts.filter((t) => t.owner === 'hold-whiterun').map((t) => ({ id: t.id, name: t.name })), canSetHere: false, capitalChangeAt: 0, atWar: false }] : [];
  return { territories, capitals, secret, colours, wars: [], leads,
    rules: { capitalChangeDays: 7, enabled: false, minOnline: 10, declareFee: 10000, noticeDays: 7, windowsPerWar: 3, windowHours: 2, deathWar: true, treatyMinWeeks: 1, treatyMaxWeeks: 8 },
    treaties: [], offers: [], factions: lead ? owners.map((o) => ({ id: o, name: S.names[o] })) : [], windowChoices: [], raids: null };
};
const member = (i, rank, title) => ({ actorId: 100 + i, name: ['Hrolfdir', 'Brenuin', 'Olfina Gray-Mane', 'Avulstein', 'Irileth', 'Proventus Avenicci'][i % 6], tag: 'T' + (100 + i), rank, title, role: rank ? 'member' : 'leader', online: i % 2 === 0 });
const factionData = (realm, extra) => Object.assign({
  id: 37, nonce: 'n1', admin: false, self: 100, invites: [], selected: 'hold-whiterun', realm, economy: null,
  factions: [{ id: 'hold-whiterun', name: S.names['hold-whiterun'], kind: 'hold', secret: false, prince: '', myRank: 0, myTitle: 'Jarl', canInvite: true, canKick: true, canSetRank: true,
    ranks: [{ title: 'Jarl', role: 'leader' }, { title: 'Steward', role: 'officer' }, { title: 'Housecarl', role: 'member' }], members: [0, 1, 2, 3, 4, 5].map((i) => member(i, i ? 1 + (i % 2) : 0, i ? 'Housecarl' : 'Jarl')), court: true }],
}, extra || {});
// Charters are on live (guilds.js): every panel has Found a faction and, without another result, the charter hint
const CHARTERS = { charters: true, result: 'To found a faction or a cult of your own, use Found a faction (or /charter found <name>). Your co-founders confirm it, then a GM approves it.', resultKind: 'info' };
const CASES = {
  'bruma-today': { data: factionData(realmView({ mapWorlds: [CYRODIIL] }), CHARTERS), maps: ['Cyrodiil'], places: { Cyrodiil: 6 } },
  'older-server': { data: factionData(realmView({ mapWorlds: [CYRODIIL], mapWorld: false })), maps: ['Cyrodiil'], places: { Cyrodiil: 6 } },
  'skyrim-member': { data: factionData(realmView({ mapWorlds: [CYRODIIL, TAMRIEL] }), CHARTERS), maps: ['Cyrodiil', 'Skyrim'], places: { Cyrodiil: 6, Skyrim: 33 } },
  'skyrim-lead': { data: factionData(realmView({ mapWorlds: [CYRODIIL, TAMRIEL], lead: true }), Object.assign({}, CHARTERS, { result: 'Whiterun is now the capital of Whiterun Hold.', resultKind: 'ok' })),
    maps: ['Cyrodiil', 'Skyrim'], places: { Cyrodiil: 6, Skyrim: 33 } },
};
const SIZES = (process.env.RES || '1280x720,1366x768,1600x900,1920x1080,2560x1440').split(',').map((r) => r.split('x').map(Number));

// ---- the measure ------------------------------------------------------------------------------------------------------
const measure = (ctx) => {
  const R = (el) => { if (!el) return null; const q = el.getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom, w: q.width, h: q.height }; };
  const vw = window.innerWidth, vh = window.innerHeight;
  const frame = document.querySelector(ctx === 'panel' ? '.faction__panel' : '.journal__frame');
  const body = document.querySelector('.faction__body--wide');
  const scroller = ctx === 'panel' ? body : document.querySelector('.journal__body');
  if (scroller) scroller.scrollTop = 0;
  const side = document.querySelector('.realm__side');
  if (side) side.scrollTop = 0;
  const btns = Array.from(document.querySelectorAll(ctx === 'panel' ? '.faction__footer button' : '.journal__footer button, .faction__footer button'));
  const close = ctx === 'panel' ? btns.find((b) => b.textContent.trim() === 'Close') : null;
  const map = document.querySelector('.realm-map');
  const tabs = Array.from(document.querySelectorAll('.faction__tab'));
  const mapBtns = Array.from(document.querySelectorAll('.realm__mapbtn'));
  const markers = Array.from(document.querySelectorAll('.realm-map__marker')).filter((m) => !/--secret|--guildseat/.test(m.className))
    .map((m) => { const q = map.getBoundingClientRect(); return { x: q.left + map.clientLeft + parseFloat(m.style.left), y: q.top + map.clientTop + parseFloat(m.style.top), name: (m.querySelector('.realm-map__label') || {}).textContent }; });
  const visible = (q, box) => q && box && q.t >= box.t - 1 && q.b <= box.b + 1 && q.l >= box.l - 1 && q.r <= box.r + 1;
  const screen = { l: 0, t: 0, r: vw, b: vh };
  const scrollBox = scroller ? R(scroller) : screen;
  const mapR = R(map);
  // The last row of the side list, scrolled into view by its own scroller (the side, or the body/journal)
  const rows = Array.from(document.querySelectorAll('.realm__side .realm__row'));
  const last = rows[rows.length - 1];
  let lastReach = null;
  if (last) {
    last.scrollIntoView({ block: 'nearest' });
    const lr = R(last);
    const holders = [side, scroller].filter(Boolean).map(R);
    lastReach = holders.every((h) => visible(lr, h)) && visible(lr, screen);
    if (scroller) scroller.scrollTop = 0;
    if (side) side.scrollTop = 0;
  }
  // A map too tall for the room under the page's top: the switch and the map still fit the page's view once it scrolls
  const col = document.querySelector('.realm__mapcol');
  const cs = scroller && getComputedStyle(scroller);
  const mapReach = !!(col && cs && col.getBoundingClientRect().height <= scroller.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) + 1);
  return {
    mapReach, colH: col ? col.getBoundingClientRect().height : null, realmH: (R(document.querySelector('.realm')) || { h: null }).h,
    scale: getComputedStyle(document.documentElement).getPropertyValue('--dbo-ui-scale').trim(),
    frame: R(frame), body: R(body), scroller: scrollBox, map: mapR, side: R(side), close: R(close),
    frameOnScreen: visible(R(frame), screen), closeOnScreen: ctx === 'panel' ? visible(R(close), screen) : null,
    tabsOnScreen: tabs.every((t) => visible(R(t), screen) && visible(R(t), ctx === 'panel' ? R(frame) : scrollBox)),
    switchOnScreen: mapBtns.every((b) => visible(R(b), screen) && visible(R(b), scrollBox)),
    mapOnScreen: visible(mapR, screen) && visible(mapR, scrollBox),
    sideways: body ? body.scrollWidth - body.clientWidth : null, realmRight: R(document.querySelector('.realm')), lastReach,
    bodyScrolls: scroller ? scroller.scrollHeight - scroller.clientHeight : null, sideScrolls: side ? side.scrollHeight - side.clientHeight : null,
    mapBtns: mapBtns.map((b) => ({ text: b.textContent.trim(), on: /--on/.test(b.className) })),
    markers, markersInside: mapR ? markers.filter((m) => !(m.x >= mapR.l && m.x <= mapR.r && m.y >= mapR.t && m.y <= mapR.b)).map((m) => m.name) : ['no map'],
  };
};

async function run() {
  const b = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const pg = await b.newPage();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body { background: linear-gradient(180deg, #7d8fa3 0%, #a9b4bd 38%, #5d6650 40%, #3b4434 100%); }</style>
<script>window.require = { context: () => { const I = ${JSON.stringify(icons)}; const f = (k) => { if (!(k in I)) throw new Error('no ' + k); return I[k]; }; f.keys = () => Object.keys(I); return f; } };</script>
</head><body><div id="root"></div><script>${fs.readFileSync(path.join(TMP, 'bundle.js'), 'utf8')}</script></body></html>`;
  fs.writeFileSync(path.join(TMP, 'page.html'), html);
  const layout = [];
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  for (const [w, h] of SIZES) {
    await pg.setViewport({ width: w, height: h });
    await pg.goto('file://' + path.join(TMP, 'page.html'), { waitUntil: 'load', timeout: 180000 });
    await pg.evaluate(() => document.fonts.ready);
    for (const ctx of ['panel', 'journal']) {
      for (const [name, c] of Object.entries(CASES)) {
        await pg.evaluate((x, d) => window.show(x, d), ctx, c.data);
        await pg.evaluate(() => { const t = Array.from(document.querySelectorAll('.faction__tab')).find((x) => x.textContent.trim() === 'Realm'); if (t) t.click(); });
        await new Promise((r) => setTimeout(r, 40));
        // The switch shows only with two maps; each of its buttons draws that map
        const shown = await pg.evaluate(() => Array.from(document.querySelectorAll('.realm__mapbtn')).map((x) => x.textContent.trim()));
        const label = `${ctx} ${name} ${w}x${h}`;
        ok(JSON.stringify(shown) === JSON.stringify(c.maps.length > 1 ? c.maps : []), `${label}: map switch ${JSON.stringify(shown)} (want ${c.maps.length > 1 ? JSON.stringify(c.maps) : 'none'})`);
        for (const mapName of c.maps) {
          await pg.evaluate((n) => { const x = Array.from(document.querySelectorAll('.realm__mapbtn')).find((y) => y.textContent.trim() === n); if (x) x.click(); }, mapName);
          await new Promise((r) => setTimeout(r, 40));
          const m = await pg.evaluate(measure, ctx);
          const L = `${label} ${mapName}`;
          await pg.screenshot({ path: path.join(OUTDIR, `${ctx}-${name}-${mapName}-${w}x${h}.png`) });
          layout.push({ ctx, case: name, map: mapName, size: `${w}x${h}`, scale: m.scale, frame: m.frame, body: m.body, map_: m.map, side: m.side, close: m.close, realmH: m.realmH, colH: m.colH,
            bodyScrolls: m.bodyScrolls, sideScrolls: m.sideScrolls, sideways: m.sideways, mapBtns: m.mapBtns, markers: m.markers.length });
          if (ctx === 'panel') {
            ok(m.frameOnScreen, `${L}: the panel is on screen (top ${Math.round(m.frame.t)}, bottom ${Math.round(m.frame.b)} of ${h}, height ${Math.round(m.frame.h)})`);
            ok(m.closeOnScreen, `${L}: Close is on screen (${m.close ? Math.round(m.close.t) + '-' + Math.round(m.close.b) : 'none'} of ${h})`);
          } else ok(m.frameOnScreen, `${L}: the journal is on screen (${Math.round(m.frame.t)}-${Math.round(m.frame.b)} of ${h})`);
          ok(m.tabsOnScreen, `${L}: the faction tabs are on screen`);
          ok(m.sideways !== null && m.sideways <= 1 && m.realmRight && m.body && m.realmRight.r <= m.body.r + 1, `${L}: nothing wider than the body (overflow ${m.sideways}px)`);
          ok(m.switchOnScreen, `${L}: the map switch is on screen`);
          const mapTxt = m.map ? `map ${Math.round(m.map.w)}x${Math.round(m.map.h)} at ${Math.round(m.map.t)}-${Math.round(m.map.b)}, visible ${Math.round(m.scroller.t)}-${Math.round(Math.min(m.scroller.b, h))}` : 'no map';
          if (ctx === 'panel') ok(m.mapOnScreen, `${L}: the whole map shows without scrolling (${mapTxt})`);
          else ok(m.mapOnScreen || m.mapReach, `${L}: the whole map shows without scrolling, or with its switch in one view once the page scrolls (${mapTxt})`);
          ok(m.realmH !== null && m.colH !== null && m.realmH <= m.colH + 1, `${L}: the place list scrolls beside the map (tab ${Math.round(m.realmH)}px, map column ${Math.round(m.colH)}px)`);
          ok(m.lastReach === true, `${L}: the side list's last row can be scrolled into view`);
          if (c.maps.length > 1) ok(m.mapBtns.filter((x) => x.on).map((x) => x.text).join() === mapName, `${L}: the ${mapName} button is the one lit`);
          // A leader's capital choice list opens inside the place list, and its last choice can be scrolled to
          if (c.data.realm.leads.length) {
            const pick = await pg.evaluate(() => {
              const btn = document.querySelector('.realm__side .realm__capital .dbo-picker__button');
              if (!btn) return { found: false };
              btn.scrollIntoView({ block: 'nearest' });
              btn.click();
              return { found: true };
            });
            await new Promise((r) => setTimeout(r, 40));
            const seen = await pg.evaluate(() => {
              const side = document.querySelector('.realm__side');
              const opts = Array.from(document.querySelectorAll('.realm__side .dbo-picker--open .dbo-picker__option'));
              const last = opts[opts.length - 1];
              if (!side || !last) return { opts: opts.length, ok: false };
              last.scrollIntoView({ block: 'nearest' });
              const a = last.getBoundingClientRect(), b = side.getBoundingClientRect();
              const res = { opts: opts.length, ok: a.top >= b.top - 1 && a.bottom <= b.bottom + 1 && a.bottom <= window.innerHeight };
              document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              const btn = document.querySelector('.realm__side .dbo-picker--open .dbo-picker__button');
              if (btn) btn.click();
              document.querySelectorAll('.journal__body, .faction__body--wide, .realm__side').forEach((x) => { x.scrollTop = 0; });
              return res;
            });
            ok(pick.found && seen.ok && seen.opts > 0, `${L}: the capital choice list opens in the place list with its last choice in reach (${seen.opts} choices)`);
          }
          ok(m.markers.length === c.places[mapName], `${L}: the map draws ${m.markers.length} places (want ${c.places[mapName]})`);
          // The fit settles: no further resize a moment later
          await new Promise((r) => setTimeout(r, 250));
          const again = await pg.evaluate(() => { const q = document.querySelector('.realm-map'); const r = q && q.getBoundingClientRect(); return r ? [Math.round(r.width), Math.round(r.height)] : null; });
          ok(!!m.map && !!again && Math.abs(again[0] - m.map.w) < 1 && Math.abs(again[1] - m.map.h) < 1, `${L}: the map keeps its size (${m.map ? Math.round(m.map.w) + 'x' + Math.round(m.map.h) : '-'} then ${again ? again.join('x') : '-'})`);
          ok(!m.markersInside.length, `${L}: every place sits inside the map${m.markersInside.length ? ' (outside: ' + m.markersInside.join(', ') + ')' : ''}`);
          // The pointer on the place farthest from any other names that place (the map's pixels and its hover agree at any width)
          const apart = (x) => Math.min(...m.markers.filter((y) => y !== x).map((y) => Math.hypot(x.x - y.x, x.y - y.y)).concat([1e9]));
          const probe = m.markers.filter((x) => x.y > m.map.t + 4 && x.y < Math.min(m.map.b, m.scroller.b, h) - 4).sort((a, z) => apart(z) - apart(a))[0];
          if (probe) {
            await pg.mouse.move(probe.x, probe.y);
            await new Promise((r) => setTimeout(r, 30));
            const tip = await pg.evaluate(() => (document.querySelector('.realm-map__tip') || {}).textContent || '');
            ok(tip.startsWith(probe.name + ':'), `${L}: hovering ${probe.name} names it (${JSON.stringify(tip)})`);
            await pg.mouse.move(1, 1);
          }
        }
      }
    }
  }
  ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  fs.writeFileSync(path.join(OUTDIR, 'layout.json'), JSON.stringify(layout, null, 1));
  await b.close();
  cleanup();
  console.log(`${fails ? 'FAIL' : 'ok  '} realm map panel: ${fails} failed; shots and layout.json in ${OUTDIR}`);
  process.exit(fails ? 1 : 0);
}
