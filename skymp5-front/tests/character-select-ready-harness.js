// Renders character select in headless Chrome and checks the ready gate: while the client's readiness says not ready,
// the cards show but Play is held (mouse, the gamepad pointer, keyboard and double-click all fail to send Play), the
// button reads "Please wait" / "Loading the world... N of M" with a progress bar, and the screen answers
// characterSelect:shown <gate> once drawn (again for a new gate). Ready (normally or by the client's cap) enables Play.
// An older client (no readiness) plays as before. Shots at each size, with the patron locked cards, in <out>.
//   LD_LIBRARY_PATH=$(cat ~/claude-c-layout/ldpath) node tests/character-select-ready-harness.js [front dir] [out dir]
// Env: PUPPETEER_DIR (and PUPPETEER_CACHE_DIR or PUPPETEER_EXECUTABLE_PATH), ESBUILD_DIR, FRONT_NM, RES=1280x720,1920x1080
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const FRONT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const OUTDIR = path.resolve(process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'character-select-ready-')));
const HOME = process.env.HOME || '';
const firstWith = (file, ...dirs) => dirs.find((d) => d && fs.existsSync(path.join(d, file)));
const NM = firstWith('sass', process.env.FRONT_NM, path.join(FRONT, 'node_modules'), path.join(HOME, 'dragonbreak/fork/skymp5-front/node_modules'));
const ESB = firstWith('package.json', process.env.ESBUILD_DIR, path.join(FRONT, '../skymp5-server/node_modules/esbuild'), path.join(HOME, 'dragonbreak/fork/skymp5-server/node_modules/esbuild'));
const PUP = firstWith('package.json', process.env.PUPPETEER_DIR, path.join(HOME, 'claude-c-layout/node_modules/puppeteer'));
if (!NM || !ESB || !PUP) { console.log(`SKIP needs FRONT_NM (${NM}), ESBUILD_DIR (${ESB}) and PUPPETEER_DIR (${PUP})`); process.exit(0); }
const sass = require(path.join(NM, 'sass'));
const esbuild = require(ESB);
const puppeteer = require(PUP);
fs.mkdirSync(OUTDIR, { recursive: true });
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'character-select-ready-build-'));

let fails = 0;
const ok = (cond, msg, got) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg + (got !== undefined ? '   ' + JSON.stringify(got) : '')); } };

// Each .scss compiled with the front's sass, its fonts and images inlined, and injected where it is imported
const MIME = { ttf: 'font/ttf', otf: 'font/otf', png: 'image/png', jpg: 'image/jpeg' };
const inlineAssets = (css, dir) => css.replace(/url\(["']?([^"')]+\.(ttf|otf|png|jpg))["']?\)/g, (m, rel, ext) => {
  const f = path.resolve(dir, rel);
  return fs.existsSync(f) ? `url(data:${MIME[ext]};base64,${fs.readFileSync(f).toString('base64')})` : m;
});
const scssPlugin = {
  name: 'scss',
  setup(build) {
    build.onResolve({ filter: /\.s[ac]ss$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path), namespace: 'scss' }));
    build.onLoad({ filter: /.*/, namespace: 'scss' }, (a) => {
      const css = inlineAssets(sass.compile(a.path, { loadPaths: [path.dirname(a.path), path.join(FRONT, 'src'), NM], quietDeps: true,
        silenceDeprecations: ['import', 'global-builtin', 'slash-div', 'color-functions'] }).css, path.dirname(a.path));
      return { contents: `const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s);`, loader: 'js' };
    });
  },
};
fs.writeFileSync(path.join(TMP, 'entry.jsx'), `
import React from 'react';
import ReactDOM from 'react-dom';
import ${JSON.stringify(path.join(FRONT, 'src/main.scss'))};
import ${JSON.stringify(path.join(FRONT, 'src/constructor.scss'))};
import ${JSON.stringify(path.join(FRONT, 'src/utils/UiScale.js'))};
import ${JSON.stringify(path.join(FRONT, 'src/utils/GamepadPointer.js'))};
import CharacterSelect from ${JSON.stringify(path.join(FRONT, 'src/features/characterSelect/index.tsx'))};
window.__sent = [];
window.skyrimPlatform = { sendMessage(...a) { if (a[0] !== 'diag:page') window.__sent.push(a); } };
const root = () => document.getElementById('root');
window.show = (data) => ReactDOM.render(<CharacterSelect data={data} />, root());
window.hide = () => ReactDOM.unmountComponentAtNode(root());
`);
const cleanup = () => fs.rmSync(TMP, { recursive: true, force: true });

// The client's widget (characterSelectService.ts browsersideWidgetSetter), with the patron branch's locked cards
const EVENTS = { select: 'characterSelect:select', play: 'characterSelect:play', edit: 'characterSelect:edit', delete: 'characterSelect:delete',
  confirmDelete: 'characterSelect:confirmDelete', cancelDelete: 'characterSelect:cancelDelete', quit: 'characterSelect:quit', shown: 'characterSelect:shown' };
const STRINGS = { selectCharacter: 'Choose your character', emptySlot: 'Empty slot', unnamed: 'Unnamed', play: 'Play', edit: 'Edit', del: 'Delete',
  confirmDelete: 'Delete this character forever?', confirm: 'Confirm', cancel: 'Cancel', quit: 'Quit', dead: 'Dead', slot: 'Slot', create: 'Create',
  selected: 'Selected', newCharacter: 'A new life', wait: 'Please wait', loadingWorld: 'Loading the world...', of: 'of' };
const widget = (over) => Object.assign({
  type: 'characterSelect', id: 7, maxCharacters: 3,
  characters: [{ name: 'Lydia', info: 'Nord . 6d 19h played', detail: 'No masteries yet . 11 items worn', race: 'Nord' }, null, { name: 'Faendal', info: 'Wood Elf . 2h played', dead: true }],
  lockedCharacters: [{ slot: 3, name: 'Brelyna', race: 'Dark Elf', reason: 'slots' }, { slot: 4, name: 'Ulfric', race: 'Nord', reason: 'staff' }],
  selectedSlot: 0, confirmDeleteSlot: null, strings: STRINGS, events: EVENTS,
  readiness: { gate: 1, ready: false, done: 3, total: 4 },
}, over || {});
const SIZES = (process.env.RES || '1280x720,1920x1080').split(',').map((r) => r.split('x').map(Number));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const b = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  try {
    const pg = await b.newPage();
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body { margin: 0; background: #04090b; }</style></head>
<body><div id="root"></div><script>${fs.readFileSync(path.join(TMP, 'bundle.js'), 'utf8')}</script></body></html>`;
    fs.writeFileSync(path.join(TMP, 'page.html'), html);
    const errors = [];
    pg.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const plays = () => pg.evaluate(() => window.__sent.filter((a) => a[0] === 'characterSelect:play').length);
    const shownSent = () => pg.evaluate(() => window.__sent.filter((a) => a[0] === 'characterSelect:shown').map((a) => a[1]));
    const clear = () => pg.evaluate(() => { window.__sent.length = 0; });
    const playBox = () => pg.evaluate(() => {
      const q = document.querySelector('.dboSelect__play');
      if (!q) return null;
      const r = q.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    });
    for (const [w, h] of SIZES) {
      const S = `${w}x${h}`;
      await pg.setViewport({ width: w, height: h });
      await pg.goto('file://' + path.join(TMP, 'page.html'), { waitUntil: 'load', timeout: 180000 });
      await pg.evaluate(() => document.fonts.ready);

      // Waiting: the cards show, Play is held and says why
      await pg.evaluate((d) => window.show(d), widget());
      await sleep(700);
      const v = await pg.evaluate(() => {
        const q = document.querySelector('.dboSelect__play');
        const bar = document.querySelector('.dboSelect__playBar');
        const name = document.querySelector('.dboSelect__playName');
        const cs = q && getComputedStyle(q);
        const R = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
        return {
          cards: document.querySelectorAll('.dboSelect__slot').length,
          locked: document.querySelectorAll('.dboSelect__slot--locked').length,
          disabled: !!(q && q.disabled), busy: q && q.getAttribute('aria-busy'),
          label: (document.querySelector('.dboSelect__playLabel') || {}).textContent, sub: name && name.textContent,
          cursor: cs && cs.cursor, opacity: cs && Number(cs.opacity), bar: bar && R(bar), button: q && R(q),
          subFits: !!name && name.scrollWidth <= name.clientWidth + 1 && R(name).r <= R(q).r + 1 && R(name).l >= R(q).l - 1,
          panel: R(document.querySelector('.dboSelect__panel')), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.body.textContent),
        };
      });
      ok(v.cards === 5 && v.locked === 2, `${S} waiting: the three slots and the two locked cards show`, v.cards);
      ok(v.disabled && v.busy === 'true', `${S} waiting: Play is disabled and aria-busy`, { disabled: v.disabled, busy: v.busy });
      ok(v.label === 'Please wait' && v.sub === 'Loading the world... 3 of 4', `${S} waiting: Play reads "Please wait" / "Loading the world... 3 of 4"`, { label: v.label, sub: v.sub });
      ok(v.cursor === 'progress' && v.opacity >= 0.8, `${S} waiting: a progress cursor, and the text stays readable (opacity ${v.opacity})`, { cursor: v.cursor, opacity: v.opacity });
      ok(!!v.bar && Math.abs(v.bar.w - 0.75 * v.button.w) <= 2 && v.bar.b <= v.button.b + 0.5 && v.bar.l >= v.button.l - 0.5, `${S} waiting: the progress bar is 75% of Play, inside it`, { bar: v.bar, button: v.button });
      ok(v.subFits, `${S} waiting: the progress text fits inside Play`);
      ok(v.button.b <= h && v.button.t >= 0 && v.panel.b <= h && v.panel.r <= w && v.sideways <= 0, `${S} waiting: Play and the panel are on screen, no sideways scroll`, { button: v.button, panel: v.panel, sideways: v.sideways });
      ok(!v.emoji, `${S} waiting: no emoji on the screen`);
      await pg.screenshot({ path: path.join(OUTDIR, `waiting-${S}.png`) });
      ok(JSON.stringify(await shownSent()) === '[1]', `${S} the screen answers characterSelect:shown 1 once drawn`, await shownSent());

      // Every input path fails to send Play while waiting
      await clear();
      const box = await playBox();
      await pg.mouse.click(box.x, box.y);
      ok(await plays() === 0, `${S} waiting: a mouse click on Play sends nothing`);
      await pg.mouse.click(box.x, box.y, { clickCount: 2 });
      await pg.evaluate((x, y) => { const el = document.elementFromPoint(x, y); el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y })); }, box.x, box.y);
      ok(await plays() === 0, `${S} waiting: a double-click on Play sends nothing`);
      const card = await pg.evaluate(() => { const r = document.querySelector('.dboSelect__slot').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await pg.mouse.click(card.x, card.y, { clickCount: 2 });
      ok(await plays() === 0, `${S} waiting: a double-click on a card sends nothing to play`);
      // The gamepad pointer (GamepadPointer.js): move onto Play, press A
      await pg.evaluate((x, y) => { const p = window.__dboPad; const at = p.position(); p.move(x - (at.x < 0 ? innerWidth / 2 : at.x), y - (at.y < 0 ? innerHeight / 2 : at.y)); p.click(); }, Math.round(box.x), Math.round(box.y));
      const padAt = await pg.evaluate(() => window.__dboPad.position());
      ok(Math.abs(padAt.x - box.x) <= 1 && Math.abs(padAt.y - box.y) <= 1 && await plays() === 0, `${S} waiting: the gamepad pointer's A on Play sends nothing`, padAt);
      await pg.evaluate(() => document.querySelectorAll('.dboSelect__play, .dboSelect__play span').forEach((el) => { el.click(); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }));
      ok(await plays() === 0, `${S} waiting: script clicks on Play and its labels send nothing`);
      await pg.evaluate(() => { const q = document.querySelector('.dboSelect__play'); q.focus(); });
      const focused = await pg.evaluate(() => document.activeElement && document.activeElement.className);
      await pg.keyboard.press('Enter');
      await pg.keyboard.press('Space');
      for (let i = 0; i < 12; i++) { await pg.keyboard.press('Tab'); await pg.keyboard.press('Enter'); }
      ok(await plays() === 0 && !/dboSelect__play/.test(focused || ''), `${S} waiting: Play takes no focus, and Enter, Space and Tab+Enter send nothing`, focused);
      await clear();
      // Tab can scroll the slot list, so the first card is found again
      const card2 = await pg.evaluate(() => { const el = document.querySelector('.dboSelect__slot'); el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await pg.mouse.click(card2.x, card2.y);
      ok(JSON.stringify(await pg.evaluate(() => window.__sent)) === '[["characterSelect:select",0]]', `${S} waiting: a card can still be picked`, await pg.evaluate(() => window.__sent));

      // The same screen again with the same gate (a re-draw) does not answer twice; a new gate (a reconnect) answers again
      await clear();
      await pg.evaluate((d) => window.show(d), widget({ readiness: { gate: 1, ready: false, done: 4, total: 4 } }));
      await sleep(400);
      ok(JSON.stringify(await shownSent()) === '[]', `${S} a re-draw for the same gate does not answer again`, await shownSent());
      await pg.evaluate((d) => window.show(d), widget({ readiness: { gate: 2, ready: false, done: 2, total: 4 } }));
      await sleep(400);
      ok(JSON.stringify(await shownSent()) === '[2]', `${S} a new gate on the mounted screen answers again (2)`, await shownSent());
      const sub2 = await pg.evaluate(() => document.querySelector('.dboSelect__playName').textContent);
      ok(sub2 === 'Loading the world... 2 of 4', `${S} the progress follows the client (2 of 4)`, sub2);

      // Ready (as the client sends it when every part is in, or at its 30 s cap): Play opens and plays
      await clear();
      await pg.evaluate((d) => window.show(d), widget({ readiness: { gate: 2, ready: true, done: 4, total: 4 } }));
      await sleep(300);
      const ready = await pg.evaluate(() => {
        const q = document.querySelector('.dboSelect__play');
        return { disabled: q.disabled, busy: q.getAttribute('aria-busy'), label: document.querySelector('.dboSelect__playLabel').textContent,
          sub: document.querySelector('.dboSelect__playName').textContent, bar: !!document.querySelector('.dboSelect__playBar'), cursor: getComputedStyle(q).cursor };
      });
      ok(!ready.disabled && ready.busy === 'false' && ready.label === 'Play' && ready.sub === 'Lydia' && !ready.bar && ready.cursor === 'pointer', `${S} ready: Play is enabled and reads Play / Lydia`, ready);
      await pg.screenshot({ path: path.join(OUTDIR, `ready-${S}.png`) });
      const box2 = await playBox();
      await pg.mouse.click(box2.x, box2.y);
      ok(await plays() === 1, `${S} ready: a mouse click on Play sends Play`);
      await clear();
      await pg.evaluate((x, y) => { const p = window.__dboPad; const at = p.position(); p.move(x - at.x, y - at.y); p.click(); }, Math.round(box2.x), Math.round(box2.y));
      ok(await plays() === 1, `${S} ready: the gamepad pointer's A on Play sends Play`);
      await clear();
      await pg.evaluate((d) => window.show(d), widget({ selectedSlot: 1, readiness: { gate: 2, ready: true, done: 3, total: 4 } }));
      await sleep(100);
      const capped = await pg.evaluate(() => ({ disabled: document.querySelector('.dboSelect__play').disabled, label: document.querySelector('.dboSelect__playLabel').textContent }));
      ok(!capped.disabled && capped.label === 'Create', `${S} ready by the cap (3 of 4 done): Play is enabled (Create on an empty slot)`, capped);
      await pg.evaluate(() => document.querySelector('.dboSelect__play').click());
      ok(await plays() === 1, `${S} ready by the cap: Play sends`);

      // An older client: no readiness, no shown event; Play works as before and nothing is answered
      await pg.evaluate(() => window.hide());
      await clear();
      const legacy = widget();
      delete legacy.readiness;
      legacy.events = Object.assign({}, EVENTS);
      delete legacy.events.shown;
      await pg.evaluate((d) => window.show(d), legacy);
      await sleep(600);
      const old = await pg.evaluate(() => ({ disabled: document.querySelector('.dboSelect__play').disabled, label: document.querySelector('.dboSelect__playLabel').textContent }));
      ok(!old.disabled && old.label === 'Play', `${S} an older client (no readiness): Play is enabled as before`, old);
      const box3 = await playBox();
      await pg.mouse.click(box3.x, box3.y);
      ok(await plays() === 1 && JSON.stringify(await shownSent()) === '[]', `${S} an older client: Play sends and no shown answer goes out`, await pg.evaluate(() => window.__sent));
      await pg.evaluate(() => window.hide());

      // Nothing selected while waiting: still "Please wait" (the wait shows from the first frame)
      await pg.evaluate((d) => window.show(d), widget({ selectedSlot: null, readiness: { gate: 3, ready: false, done: 1, total: 4 } }));
      await sleep(600);
      const none = await pg.evaluate(() => ({ disabled: document.querySelector('.dboSelect__play').disabled, label: document.querySelector('.dboSelect__playLabel').textContent,
        sub: document.querySelector('.dboSelect__playName').textContent }));
      ok(none.disabled && none.label === 'Please wait' && none.sub === 'Loading the world... 1 of 4', `${S} nothing selected yet: the wait still shows (1 of 4)`, none);
      await pg.screenshot({ path: path.join(OUTDIR, `waiting-noselection-${S}.png`) });
      await pg.evaluate(() => window.hide());
    }
    ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await b.close();
  }
}

esbuild.build({
  entryPoints: [path.join(TMP, 'entry.jsx')], bundle: true, format: 'iife', outfile: path.join(TMP, 'bundle.js'), jsx: 'transform',
  loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.ttf': 'empty', '.otf': 'empty', '.woff': 'empty', '.woff2': 'empty', '.mp3': 'empty', '.wav': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [NM], plugins: [scssPlugin], logLevel: 'error',
}).then(run).then(() => {
  cleanup();
  console.log(fails ? `FAILED ${fails}` : 'all ok');
  process.exit(fails ? 1 : 0);
}).catch((e) => { console.log('FAIL harness error ' + (e && e.stack || e)); cleanup(); process.exit(1); });
