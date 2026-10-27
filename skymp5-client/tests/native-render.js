// Layout pictures of the native panels without the game: each panel runs on the stub stage (tests/native-swf-stub.js), its
// clip tree (boxes, rules, text fields, positions, scale, alpha) is written as HTML at the stage's 1280 x 720, and the part
// a screen of the given shape shows is cut out, as Scaleform's no-border scaling does: 21:9 loses the top and bottom, 16:10
// the sides. Headless Edge makes the PNG. Fonts are the front's Futura; Skyrim's own differ a little in width, so this
// is for overlap, overflow and cropping, not for the exact look.
//   node tests/native-render.js <out dir> [edge.exe]
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./native-swf-stub');

const OUT = path.resolve(process.argv[2] || 'render-out');
const EDGE = process.argv[3] || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FONT = path.resolve(__dirname, '../../skymp5-front/src/img/skyrim/Fonts/Futura Condensed Light.ttf').replace(/\\/g, '/');
fs.mkdirSync(OUT, { recursive: true });

// The stage area a screen of this aspect shows under no-border scaling of 1280 x 720
const visibleFor = (aspect) => {
  if (aspect >= 16 / 9) { const h = 1280 / aspect; return { left: 0, top: (720 - h) / 2, right: 1280, bottom: (720 + h) / 2 }; }
  const w = 720 * aspect;
  return { left: (1280 - w) / 2, top: 0, right: (1280 + w) / 2, bottom: 720 };
};
const ASPECTS = [['16x9', 16 / 9, 1920, 1080], ['16x10', 16 / 10, 1728, 1080], ['21x9', 21 / 9, 2520, 1080]];

// a loaded DDS shown by its source art in the front (our hourglass); anything else by its path's name
const IMAGES = (p) => (/hourglass/.test(p) ? 'file:///' + path.resolve(__dirname, '../../skymp5-front/src/img/dbo-watermark.png').replace(/\\/g, '/') : '');
const hex = (c) => '#' + ('000000' + (Number(c) >>> 0).toString(16)).slice(-6);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONTS = { '$EverywhereFont': 300, '$EverywhereMediumFont': 400, '$EverywhereBoldFont': 600 };

// The clip tree as absolutely placed HTML: boxes for fills, divs for text, in depth order (the order things were made)
const toHtml = (root) => {
  const out = [];
  let gid = 0;
  const walk = (c, x, y, sx, sy, a) => {
    if (c._visible === false) return;
    const nx = x + (c._x || 0) * sx, ny = y + (c._y || 0) * sy;
    const nsx = sx * ((c._xscale === undefined ? 100 : c._xscale) / 100), nsy = sy * ((c._yscale === undefined ? 100 : c._yscale) / 100);
    const na = a * ((c._alpha === undefined ? 100 : c._alpha) / 100);
    // each fill as its own small SVG, so fills and texts keep the order they were made in
    for (const f of c.fills || []) {
      const pts = f.pts.map((p) => [nx + p[0] * nsx, ny + p[1] * nsy]);
      if (pts.length < 3) continue;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const l = Math.min(...xs), t = Math.min(...ys), w = Math.max(...xs) - l, h = Math.max(...ys) - t;
      if (!(w > 0 && h > 0)) continue;
      let paint = hex(f.color), defs = '';
      if (f.gradient) {
        const id = 'g' + (gid++);
        const vertical = Math.abs(f.gradient.r - Math.PI / 2) < 0.01;
        defs = '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="' + (vertical ? 0 : 1) + '" y2="' + (vertical ? 1 : 0) + '">'
          + f.gradient.colors.map((col, i) => '<stop offset="' + (f.gradient.ratios[i] / 255) + '" stop-color="' + hex(col) + '" stop-opacity="' + (f.gradient.alphas[i] / 100) + '"/>').join('') + '</linearGradient></defs>';
        paint = 'url(#' + id + ')';
      }
      const poly = pts.map((p) => (p[0] - l).toFixed(2) + ',' + (p[1] - t).toFixed(2)).join(' ');
      out.push('<svg style="position:absolute;left:' + l + 'px;top:' + t + 'px;overflow:visible;opacity:' + ((f.gradient ? 1 : f.alpha / 100) * na) + '" width="' + w + '" height="' + Math.max(1, h) + '">' + defs + '<polygon points="' + poly + '" fill="' + paint + '"/></svg>');
    }
    if (c._image) {
      out.push('<img src="' + IMAGES(c._image) + '" style="position:absolute;left:' + nx + 'px;top:' + ny + 'px;width:' + (c._width || 420) * nsx + 'px;height:' + (c._height || 520) * nsy + 'px;opacity:' + na + '">');
    }
    for (const k of Object.keys(c.kids)) {
      const t = c.kids[k];
      if (t.kids) { walk(t, nx, ny, nsx, nsy, na); continue; }
      if (typeof t.text !== 'string' || t.text === '') continue;
      const fm = t.fmt || {};
      const size = (fm.size || 18) * nsy;
      const input = t.type === 'input';
      out.push(`<div style="position:absolute;left:${nx + (t._x || 0) * nsx}px;top:${ny + (t._y || 0) * nsy}px;width:${(t._width || 200) * nsx}px;height:${(t._height || 24) * nsy}px;`
        + `overflow:hidden;white-space:${t.wordWrap ? 'pre-wrap' : 'pre'};font:${FONTS[fm.font] || 400} ${size}px/1.2 'Futura Condensed';letter-spacing:${(fm.letterSpacing || 0) * nsx}px;`
        + `text-align:${fm.align || 'left'};color:${hex(t.textColor === undefined ? fm.color : t.textColor)};opacity:${na * ((t._alpha === undefined ? 100 : t._alpha) / 100)};`
        + `${input ? 'background:#101010;outline:1px solid #5a5a5a;' : ''}">${esc(t.text)}</div>`);
    }
  };
  walk(root, 0, 0, 1, 1, 1);
  return out.join('\n');
};

// One picture: the stage cut to the screen's visible area, scaled up to the screen's pixels, over a dim game-like ground
const shoot = (name, setup, aspect) => {
  const [tag, ratio, W, H] = aspect;
  const v = visibleFor(ratio);
  const t = S.boot(setup.swf, false, { visible: v });
  setup.drive(t);
  t.st.time += 2000; t.tick();
  const scale = W / (v.right - v.left);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Futura Condensed'; src: url('file:///${FONT}'); }
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:radial-gradient(ellipse at 50% 40%,#5a5148,#1d1a17 75%)}
#stage{position:absolute;left:0;top:0;width:1280px;height:720px;transform-origin:0 0;transform:scale(${scale}) translate(${-v.left}px,${-v.top}px)}
.tag{position:absolute;right:12px;bottom:8px;font:14px sans-serif;color:#aaa}
</style></head><body><div id="stage">${toHtml(t.root)}</div><div class="tag">${name} at ${tag} (stub render: layout, not the exact look)</div></body></html>`;
  const file = path.join(OUT, `${name}-${tag}.html`);
  fs.writeFileSync(file, html);
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', `--window-size=${W},${H}`,
    `--screenshot=${path.join(OUT, `${name}-${tag}.png`)}`, 'file:///' + file.replace(/\\/g, '/')], { stdio: 'ignore' });
};

const ev = { post: 'bountyBoard:post', remove: 'bountyBoard:remove', close: 'bountyBoard:close' };
const board = {
  boardName: 'Bruma', costGold: 30, gold: 120, maxTextLen: 600, maxNotes: 40, expiryDays: 7, events: ev,
  tabs: [{ id: 'hold', label: 'Hold Notices', cost: 0, canPost: false }, { id: 'shop', label: 'Shop Ads', cost: 30, canPost: true }, { id: 'citizen', label: 'Citizen Notices', cost: 30, canPost: true }, { id: 'recruit', label: 'Recruitment', cost: 30, canPost: true }],
  notes: [{ id: 1, tab: 'hold', author: 'Bri #4SWL', text: 'By order of the Count: the south gate closes at dusk until the bandits on the pass are dealt with. Travellers arriving after dark will be turned away.', ageHours: 2, canRemove: true },
    { id: 2, tab: 'hold', author: 'Narri', text: 'Curfew at dusk.', ageHours: 30, canRemove: false }],
};
const housing = { type: 'housing', id: 8, targetLabel: 'Door', view: 'owner', owned: true, name: 'Rose Hall', locked: false, hasKeys: true, canGrantContainers: false, ownerName: 'Olaf', keyRing: true,
  place: { root: 1, name: 'Rose Hall', here: 12, more: 2, rooms: [{ ref: 11, label: 'Bedroom', kind: 'door', assigned: null, shared: false, other: null }, { ref: 12, label: 'Strongbox', kind: 'chest', assigned: null, shared: false, other: null }, { ref: 13, label: 'Guest room', kind: 'door', assigned: 'Gemma', shared: false, other: null }] },
  events: { claim: 'housing:claim', abandon: 'housing:abandon', revoke: 'housing:revoke', lock: 'housing:lock', unlock: 'housing:unlock', transfer: 'housing:transfer', rename: 'housing:rename', createKey: 'housing:createkey', revokeKeys: 'housing:revokekeys', grantContainer: 'housing:grantcontainer', assign: 'housing:assign', unassign: 'housing:unassign', share: 'housing:share', unshare: 'housing:unshare', cancel: 'housing:cancel' } };
const jtabs = ['profile', 'faction', 'court', 'stats', 'skills', 'magic', 'deity', 'supernatural', 'world', 'keys', 'citizen', 'referrals', 'wanted', 'notes', 'thalmor'].map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) })).concat([{ id: 'settings', label: 'Settings', pinned: true }]);
const journal = { type: 'journal', id: 50, nonce: 'n', hub: 1, tabs: jtabs, tab: 'stats', opened: 1, clock: { date: 'Morndas, 26th of Frostfall', time: '14:05' }, head: { name: 'Olaf', title: 'Wanderer', race: 'Nord' },
  stats: { groups: [{ name: 'Combat', rows: [{ label: 'Kills', value: '12' }, { label: 'Deaths', value: '3', hint: 'two to wolves' }] }, { name: 'Travel', rows: [{ label: 'Walked', value: '41 km' }, { label: 'Fast travel', value: '6' }] }] } };
const decor = { type: 'decor', id: 171, nonce: 'p1', view: 'catalog', home: "Olaf's home", owner: true, undo: 0, budget: [{ label: 'Pieces', used: 2, of: 3 }, { label: 'Lights', used: 1, of: 1 }],
  groups: [{ id: 'beds', label: 'Beds' }, { id: 'storage', label: 'Storage' }, { id: 'lights', label: 'Lights' }], group: 'beds', page: 0, pages: 2, nearby: [],
  rows: Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, name: `Bed ${i + 1}`, cost: [{ name: 'Firewood', n: 4, have: 6 }], why: '' })) };
const prayer = { type: 'prayer', id: 35, nonce: 'n1', mode: 'pick', deity: 'Mara', kind: 'divine', shrine: 'Shrine of Mara', sphere: 'Love and compassion', verses: [{ lines: ['Mother of all, hear me', 'Mother of storms, hear me', 'Mother of none, hear me'] }, { lines: ['a', 'b', 'c'] }], right: [0, 0], slips: 2, totalMs: 120000, minPickMs: 300, judge: 'client' };

const SETUPS = [
  ['board-list', { swf: 'dbo_board', drive: (t) => t.push(board) }],
  ['board-reader', { swf: 'dbo_board', drive: (t) => { t.push(board); t.press(49); } }],
  ['board-compose', { swf: 'dbo_board', drive: (t) => { t.push(board); t.root.dboPanel.head.tab1.onRelease(); t.root.dboPanel.foot.write.onRelease(); const b = t.root.dboPanel.list.box; b.text = 'Iron ingots, cheap, at the forge by the gate.'; b.onChanged(); } }],
  ['housing', { swf: 'dbo_housing', drive: (t) => t.push(housing) }],
  ['housing-rename', { swf: 'dbo_housing', drive: (t) => { t.push(housing); for (const k of Object.keys(t.root.dboPanel.acts.kids)) { const b = t.root.dboPanel.acts[k]; if (b.label && b.label.text === 'Rename...') b.onRelease(); } } }],
  ['journal', { swf: 'dbo_journal', drive: (t) => t.push(journal) }],
  ['decor', { swf: 'dbo_decor', drive: (t) => t.push(decor) }],
  ['prayer', { swf: 'dbo_prayer', drive: (t) => t.push(prayer) }],
];
// Where each visible text actually sits on the stage: its field's box narrowed to the estimated width of its words by its
// alignment (single lines), or the field's box (wrapped text), so two texts that touch can be found without a renderer
const textBoxes = (root) => {
  const out = [];
  const walk = (c, x, y, s, path) => {
    if (c._visible === false || (c._alpha !== undefined && c._alpha <= 0 && c !== root)) return;
    const nx = x + (c._x || 0) * s, ny = y + (c._y || 0) * s, ns = s * ((c._xscale === undefined ? 100 : c._xscale) / 100);
    for (const k of Object.keys(c.kids)) {
      const t = c.kids[k];
      if (t.kids) { walk(t, nx, ny, ns, path + '.' + k); continue; }
      if (typeof t.text !== 'string' || t.text.trim() === '' || t._alpha === 0) continue;
      const fm = t.fmt || {};
      const size = fm.size || 18;
      const w = t._width || 200;
      let tw = w;
      let left = t._x || 0;
      if (!t.wordWrap) {
        tw = Math.min(w, t.text.length * size * 0.42);
        if (fm.align === 'right') left += w - tw; else if (fm.align === 'center') left += (w - tw) / 2;
      }
      const lines = t.wordWrap ? Math.max(1, Math.ceil((t.text.length * size * 0.42) / w)) : 1;
      out.push({ name: path + '.' + k, text: t.text.slice(0, 30), l: nx + left * ns, t: ny + (t._y || 0) * ns, r: nx + (left + tw) * ns, b: ny + ((t._y || 0) + Math.min(t._height || size + 6, lines * (size + 6))) * ns });
    }
  };
  walk(root, 0, 0, 1, '_root');
  return out;
};
const overlaps = (boxes) => {
  const hits = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      // a few pixels of line leading between a title and its sub-line is not a clash
      if (ox > 3 && oy > 5) hits.push(`"${a.text}" and "${b.text}" (${Math.round(ox)} x ${Math.round(oy)})`);
    }
  }
  return hits;
};

const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
if (process.env.CHECK) {
  // node tests/native-render.js --check: no pictures, every scene's overlapping texts listed; exits 1 on any
  let n = 0;
  for (const [name, setup] of SETUPS) {
    if (only && !only.test(name)) continue;
    const t = S.boot(setup.swf, false, {});
    setup.drive(t);
    t.st.time += 2000; t.tick();
    const hits = overlaps(textBoxes(t.root));
    console.log(`${hits.length ? 'FAIL' : 'ok  '} ${name}: ${hits.length ? hits.join('; ') : 'no texts overlap'}`);
    n += hits.length;
  }
  process.exit(n ? 1 : 0);
}
for (const [name, setup] of SETUPS) {
  if (only && !only.test(name)) continue;
  for (const a of ASPECTS) shoot(name, setup, a);
  console.log('rendered', name);
}
