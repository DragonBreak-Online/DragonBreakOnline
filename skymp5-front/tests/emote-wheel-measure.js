// Renders skymp5-front's emoteWheel in headless Chrome (software raster, as no GPU is assumed) and measures what keeping it
// on screen costs while the ring is hovered: raster ms per second of hovering, and the time from a click to emote:play.
// CT 115 (puppeteer + Chrome's libraries unpacked in ~/claude-c-layout, memory note front-widgets-measure-in-headless-chrome):
//   LD_LIBRARY_PATH=$(cat ~/claude-c-layout/ldpath) node tests/emote-wheel-measure.js .
// Optional: RES=1920x1080,2560x1440  VARIANTS="as shipped,no stage drop-shadow,..."  EXTRA_CSS=<file of rules to add>
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const puppeteer = require(path.join(process.env.HOME, 'claude-c-layout/node_modules/puppeteer'));
const FRONT = path.resolve(process.argv[2]);
const NM = path.join(process.env.HOME, 'dragonbreak/fork/skymp5-front/node_modules');
const OUT = fs.mkdtempSync(path.join(require('os').tmpdir(), 'emote-wheel-measure-'));
const sass = require(path.join(NM, 'sass'));
const css = ['main.scss', 'features/emoteWheel/styles.scss'].map((f) => sass.compile(path.join(FRONT, 'src', f), { loadPaths: [path.join(FRONT, 'src'), NM], quietDeps: true, silenceDeprecations: ['import', 'global-builtin', 'slash-div', 'color-functions'] }).css).join('\n');
// The wheel's catalog, read from the client service so the page draws exactly what the game sends
const svc = fs.readFileSync(path.join(FRONT, '..', 'skymp5-client/src/services/services/emoteService.ts'), 'utf8');
const groups = eval(svc.match(/const GROUPS: EmoteGroup\[\] = (\[[\s\S]*?\n\]);/)[1]);
fs.writeFileSync(path.join(OUT, 'entry.jsx'), `
import React from 'react'; import ReactDOM from 'react-dom';
import '${path.join(FRONT, 'src/utils/UiScale.js')}';
import EmoteWheel from '${path.join(FRONT, 'src/features/emoteWheel/index.tsx')}';
window.sent = []; window.skyrimPlatform = { sendMessage(...a) { window.sent.push([performance.now(), ...a]); } };
window.renderWheel = (d) => ReactDOM.render(<div><EmoteWheel key="emoteWheel-24" data={d} /></div>, document.getElementById('root'));
`);
execFileSync(path.join(process.env.HOME, 'dragonbreak/fork/skymp5-server/node_modules/.bin/esbuild'), [path.join(OUT, 'entry.jsx'), '--bundle', '--format=iife',
  '--loader:.scss=empty', '--loader:.gif=dataurl', '--loader:.png=dataurl', '--loader:.svg=empty', '--loader:.ttf=empty', '--loader:.otf=empty', '--loader:.woff=empty', '--loader:.woff2=empty',
  '--define:process.env.NODE_ENV="production"', '--log-level=error', `--outfile=${path.join(OUT, 'bundle.js')}`], { stdio: 'inherit', env: { ...process.env, NODE_PATH: NM } });
const NOFX = `.emote-wheel *, .emote-wheel *::before, .emote-wheel *::after { filter: none !important; backdrop-filter: none !important; box-shadow: none !important; text-shadow: none !important; }`;
const page = (extra) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}${extra || ''}</style></head><body style="margin:0;background:#556"><div id="root"></div><script>${fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')}</script></body></html>`;
const data = { groups, events: { play: 'emote:play', close: 'emote:close', stop: 'emote:stop' } };

const sum = (evs, names) => evs.filter((e) => names.includes(e.name) && e.ph === 'X').reduce((n, e) => n + (e.dur || 0), 0) / 1000;
(async () => {
  const b = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing'] });
  const pg = await b.newPage();
  const rows = [];
  for (const [w, h] of (process.env.RES || '1920x1080,2560x1440,3840x2160').split(',').map((r) => r.split('x').map(Number))) {
    const V = { 'as shipped': '', 'no filters/shadows': NOFX,
      'no stage drop-shadow': '.emote-wheel__stage{filter:none!important}',
      'no backdrop blur': '.emote-wheel__fade{backdrop-filter:none!important}',
      'no svg/segment shadows': '.emote-wheel__svg,.emote-wheel__svg *{filter:none!important}',
      'no preview img filter': '.emote-wheel__preview-frame img,.emote-wheel__preview-glow{filter:none!important}' };
    const pick = (process.env.VARIANTS || 'as shipped,no filters/shadows').split(',');
    for (const [label, extra] of Object.entries(V).filter(([k]) => pick.includes(k)).concat((process.env.EXTRA_CSS ? [['candidate', fs.readFileSync(process.env.EXTRA_CSS, 'utf8')]] : []))) {
      await pg.setViewport({ width: w, height: h });
      await pg.setContent(page(extra), { waitUntil: 'load' });
      const t0 = Date.now();
      await pg.evaluate((d) => window.renderWheel(d), data);
      await pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const firstMs = Date.now() - t0;
      const tf = path.join(OUT, 'trace.json');
      await pg.tracing.start({ path: tf, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc', 'viz'] });
      // 4 s hovering across the emote ring (each hover swaps the preview gif), as a player browsing the wheel
      const t1 = Date.now();
      const cx = w / 2 - 0.12 * w, cy = h / 2;
      let i = 0;
      while (Date.now() - t1 < 4000) { const a = (i++ % 36) * 10 * Math.PI / 180; await pg.mouse.move(cx + Math.cos(a) * h * 0.38, cy + Math.sin(a) * h * 0.38); await new Promise((r) => setTimeout(r, 50)); }
      // one click on a segment and the time until the page sends emote:play
      await pg.evaluate(() => { window.sent = []; });
      const seg = await pg.$('.emote-wheel__emote-segment');
      const box = await seg.boundingBox();
      const tc = Date.now();
      await pg.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await pg.waitForFunction(() => window.sent.length > 0, { timeout: 60000 }).catch(() => null);
      const clickMs = Date.now() - tc;
      await pg.tracing.stop();
      const evs = JSON.parse(fs.readFileSync(tf, 'utf8')).traceEvents || [];
      const span = 4 + clickMs / 1000;
      rows.push({ res: `${w}x${h}`, label, firstMs, clickMs, paintMsPerS: (sum(evs, ['Paint', 'PaintImage']) / span).toFixed(0), rasterMsPerS: (sum(evs, ['RasterTask', 'TileManager::RunTask']) / span).toFixed(0), layoutStyleMsPerS: (sum(evs, ['Layout', 'UpdateLayoutTree', 'RecalculateStyles']) / span).toFixed(0), frames: evs.filter((e) => e.name === 'DrawFrame' || e.name === 'Graphics.Pipeline').length, hovers: i });
    }
  }
  await b.close();
  console.table(rows);
  fs.rmSync(OUT, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
