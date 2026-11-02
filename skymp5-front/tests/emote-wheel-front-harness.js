// The emote wheel (features/emoteWheel, widget 24): the pointer rules of the hold-and-flick wheel (wheelGeometry.ts, one ring
// from the hub out) and what the wheel draws for emoteService's groups, as tabs with Recent first. Run it from skymp5-front: node tests/emote-wheel-front-harness.js
// Env: ESBUILD_DIR, FRONT_NM (as the other front harnesses). Prints ok/FAIL lines and exits 1 on a FAIL.
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'emote-wheel-front-'));

let fails = 0;
const ok = (cond, msg, got) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg + (got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : '')); } };

// The catalog as emoteService.ts sends it, read from the client's own source
const svc = fs.readFileSync(path.join(FRONT, '../skymp5-client/src/services/services/emoteService.ts'), 'utf8').replace(/\r\n/g, '\n');
const groupsSrc = svc.slice(svc.indexOf('const GROUPS: EmoteGroup[] = ') + 'const GROUPS: EmoteGroup[] = '.length, svc.indexOf('];\n', svc.indexOf('const GROUPS')) + 1);
const GROUPS = new Function(`return ${groupsSrc};`)();
const data = { groups: GROUPS, events: { play: 'emote:play', close: 'emote:close', stop: 'emote:stop' } };

fs.writeFileSync(path.join(TMP, 'entry.jsx'), `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EmoteWheel from ${JSON.stringify(path.join(FRONT, 'src/features/emoteWheel/index.tsx'))};
export * as G from ${JSON.stringify(path.join(FRONT, 'src/features/emoteWheel/wheelGeometry.ts'))};
export const render = (data) => renderToStaticMarkup(React.createElement(EmoteWheel, { data }));
`);

(async () => {
  await esbuild.build({
    entryPoints: [path.join(TMP, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(TMP, 'out.js'),
    logLevel: 'error', nodePaths: [NM], jsx: 'transform',
    loader: { '.js': 'jsx', '.scss': 'empty', '.css': 'empty', '.png': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl' },
  });
  const { render, G } = require(path.join(TMP, 'out.js'));

  // ---- the pointer: one ring from the hub out (Nat's pick, 2 Nov, option A) ----
  ok(G.angleOf(0, -10) === 0 && G.angleOf(10, 0) === 90 && G.angleOf(0, 10) === 180 && G.angleOf(-10, 0) === 270, 'angles run clockwise from straight up');
  ok(G.indexAt(0, 6) === 0 && G.indexAt(29.9, 6) === 0 && G.indexAt(30, 6) === 1 && G.indexAt(330, 6) === 0 && G.indexAt(329.9, 6) === 5, 'segment 0 is centred on the top; boundaries at half a step');
  ok(G.pickAt(0, -50, 8).ring === 'hub', 'inside the hub the pointer picks nothing');
  const near = G.pickAt(G.HUB_R + 2, 0, 8);
  ok(near.ring === 'emote' && near.index === 2, 'just past the hub at 90 degrees: the third of eight emotes, no inner ring to cross', near);
  const ep = G.pickAt(0, 200, 8);
  ok(ep.ring === 'emote' && ep.index === 4, 'at 180 degrees: the fifth of eight emotes', ep);
  const far = G.pickAt(0, 2000, 8);
  ok(far.ring === 'emote' && far.index === 4, 'a flick that overshoots the wheel still reads the emote in its direction', far);
  ok(G.GROUP_INNER === undefined && G.dwellStep === undefined && G.GROUP_DWELL_MS === undefined, 'no group ring and no dwell left in the geometry');
  // the release
  ok(JSON.stringify(G.releaseAction({ ring: 'emote', index: 2 }, 8)) === '{"play":2}', 'released on an emote: play it');
  ok(JSON.stringify(G.releaseAction({ ring: 'hub', index: -1 }, 8)) === '{"close":true}', 'released on the hub: close');
  ok(JSON.stringify(G.releaseAction({ ring: 'emote', index: 9 }, 8)) === '{"close":true}', 'an index past the group\'s emotes closes');
  const p = G.arcPath(G.EMOTE_INNER, G.EMOTE_OUTER, 10, 50);
  ok(new RegExp(`^M [\\d.]+ [\\d.]+ A ${G.EMOTE_OUTER} ${G.EMOTE_OUTER} 0 0 1 [\\d.]+ [\\d.]+ L [\\d.]+ [\\d.]+ A ${G.EMOTE_INNER} ${G.EMOTE_INNER} 0 0 0 [\\d.]+ [\\d.]+ Z$`).test(p), 'a segment is an annular arc from the hub\'s edge to the rim', p);

  // ---- what it draws ----
  const html = render(data);
  const count = (cls) => (html.match(new RegExp(`class="${cls}[ "]`, 'g')) || []).length;
  ok(count('emote-wheel__tab') === GROUPS.length && GROUPS.length === 6, `the six groups as tabs (${GROUPS.map((g) => g.id).join(', ')})`);
  ok(!/emote-wheel__group[ "]/.test(html), 'no group ring');
  ok(/class="emote-wheel__tabs" role="tablist"/.test(html) && (html.match(/role="tab"/g) || []).length === GROUPS.length, 'the tabs are a tablist');
  ok(count('emote-wheel__tab is-active') === 1 && (html.match(/aria-selected="true"/g) || []).length === 1, 'one tab is lit, and selected');
  ok(count('emote-wheel__emote') === GROUPS[0].emotes.length, 'the first group\'s emotes on the ring', count('emote-wheel__emote'));
  ok(GROUPS.every((g) => html.includes(`>${g.label}<`)), 'every group is labelled');
  ok(html.includes('>Wave<') && html.includes('>Knock Door<'), 'the emotes keep the catalog\'s labels');
  ok((html.match(/class="emote-wheel__key"/g) || []).length === Math.min(9, GROUPS[0].emotes.length), 'each of the first nine emotes shows its number key');
  ok(!/<img|\.gif|data:image\/gif/.test(html), 'no GIF and no image: the art is our own glyphs');
  ok((html.match(/class="emote-wheel__tab-glyph"/g) || []).length === GROUPS.length && html.includes('emote-wheel__hub-glyph'), 'a glyph per tab, and the active one in the hub');
  ok(html.includes('>Stop emote<'), 'the stop button is there');
  ok(/mouse wheel or Left \/ Right: another group/.test(html) && /1-9 on the wedges/.test(html), 'the hint says how to change the group and that the numbers are on the wedges');
  ok(GROUPS.find((g) => g.id === 'activities').emotes.some((e) => e.anim === 'pipesmokingcrossleggedenter' && e.label === 'Smoke Pipe'), 'Smoke Pipe is on the wheel under Activities');
  ok(fs.readdirSync(path.join(FRONT, 'src/features/emoteWheel')).every((f) => !/\.(gif|png|webp)$/.test(f)) && !fs.existsSync(path.join(FRONT, 'src/features/emoteWheel/assets')), 'the ported GIF art is gone from the feature');
  const many = render({ groups: [{ id: 'x', label: 'X', emotes: Array.from({ length: 12 }, (_, i) => ({ anim: 'A' + i, label: 'Emote ' + i })) }], events: data.events });
  ok((many.match(/class="emote-wheel__key"/g) || []).length === 9 && (many.match(/class="emote-wheel__emote[ "]/g) || []).length === 12, 'a group of twelve draws twelve segments, nine with keys');
  ok(/class="emote-wheel__tab-glyph"[^>]*><path d="M12 4l6 8-6 8-6-8z"/.test(many), 'an unknown group gets the default glyph');
  ok(render({ groups: [], events: data.events }) === '', 'no groups: nothing drawn');
  // Recent, as the client sends it: first, opened on, with its own glyph
  const recent = { id: 'recent', label: 'Recent', emotes: [{ anim: 'IdleLaugh', label: 'Laugh' }, { anim: 'IdleWave', label: 'Wave' }] };
  const withRecent = render({ groups: [recent].concat(GROUPS), events: data.events });
  ok((withRecent.match(/class="emote-wheel__tab[ "]/g) || []).length === GROUPS.length + 1 && /class="emote-wheel__tab is-active"[^>]*><svg[^>]*><path d="[^"]*"><\/path><\/svg>Recent</.test(withRecent),
    'Recent first among the tabs, and the one it opens on');
  ok((withRecent.match(/class="emote-wheel__emote[ "]/g) || []).length === 2 && withRecent.includes('>Laugh<'), '...showing its emotes');
  ok(/<path d="M12 4a8 8 0 1 1-7.4 5/.test(withRecent), '...with its clock glyph, not the default');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw: ' + (e && e.stack || e)); process.exit(1); });
