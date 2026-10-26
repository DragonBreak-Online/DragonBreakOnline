// The emote wheel (features/emoteWheel, widget 24): the pointer rules of the hold-and-flick wheel (wheelGeometry.ts) and
// what the wheel draws for emoteService's groups. Run it from skymp5-front: node tests/emote-wheel-front-harness.js
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

  // ---- the pointer ----
  ok(G.angleOf(0, -10) === 0 && G.angleOf(10, 0) === 90 && G.angleOf(0, 10) === 180 && G.angleOf(-10, 0) === 270, 'angles run clockwise from straight up');
  ok(G.indexAt(0, 6) === 0 && G.indexAt(29.9, 6) === 0 && G.indexAt(30, 6) === 1 && G.indexAt(330, 6) === 0 && G.indexAt(329.9, 6) === 5, 'segment 0 is centred on the top; boundaries at half a step');
  ok(G.pickAt(0, -50, 6, 8).ring === 'hub', 'inside the hub the pointer picks nothing');
  const gp = G.pickAt(100, 0, 6, 8);
  ok(gp.ring === 'group' && gp.index === 2, 'on the group ring at 90 degrees: the third of six groups', gp);
  const ep = G.pickAt(0, 200, 6, 8);
  ok(ep.ring === 'emote' && ep.index === 4, 'on the emote ring at 180 degrees: the fifth of eight emotes', ep);
  const far = G.pickAt(0, 2000, 6, 8);
  ok(far.ring === 'emote' && far.index === 4, 'a flick that overshoots the wheel still reads the emote in its direction', far);
  // the dwell: a group takes over only after resting on it
  let d = { candidate: -1, since: 0 };
  let s = G.dwellStep(d, 3, 1000, 0);
  ok(s.group === 0 && s.dwell.candidate === 3, 'touching a group does not switch to it at once');
  s = G.dwellStep(s.dwell, 3, 1000 + G.GROUP_DWELL_MS - 1, 0);
  ok(s.group === 0, '...nor just before the dwell');
  s = G.dwellStep(s.dwell, 3, 1000 + G.GROUP_DWELL_MS, 0);
  ok(s.group === 3, `...resting ${G.GROUP_DWELL_MS} ms does`);
  s = G.dwellStep({ candidate: 3, since: 1000 }, 4, 1100, 0);
  ok(s.group === 0 && s.dwell.candidate === 4 && s.dwell.since === 1100, 'a flick across a second group restarts the dwell');
  ok(G.dwellStep({ candidate: 3, since: 1 }, -1, 9999, 2).group === 2 && G.dwellStep({ candidate: 3, since: 1 }, -1, 9999, 2).dwell.candidate === -1, 'leaving the group ring forgets the candidate');
  // the release
  ok(JSON.stringify(G.releaseAction({ ring: 'emote', index: 2 }, 8)) === '{"play":2}', 'released on an emote: play it');
  ok(JSON.stringify(G.releaseAction({ ring: 'hub', index: -1 }, 8)) === '{"close":true}' && JSON.stringify(G.releaseAction({ ring: 'group', index: 1 }, 8)) === '{"close":true}', 'released on the hub or a group: close');
  ok(JSON.stringify(G.releaseAction({ ring: 'emote', index: 9 }, 8)) === '{"close":true}', 'an index past the group\'s emotes closes');
  const p = G.arcPath(G.EMOTE_INNER, G.EMOTE_OUTER, 10, 50);
  ok(/^M [\d.]+ [\d.]+ A 300 300 0 0 1 [\d.]+ [\d.]+ L [\d.]+ [\d.]+ A 166 166 0 0 0 [\d.]+ [\d.]+ Z$/.test(p), 'a segment is an annular arc', p);

  // ---- what it draws ----
  const html = render(data);
  const count = (cls) => (html.match(new RegExp(`class="${cls}[ "]`, 'g')) || []).length;
  ok(count('emote-wheel__group') === GROUPS.length && GROUPS.length === 6, `the six groups on the inner ring (${GROUPS.map((g) => g.id).join(', ')})`);
  ok(count('emote-wheel__emote') === GROUPS[0].emotes.length, 'the first group\'s emotes on the outer ring', count('emote-wheel__emote'));
  ok(GROUPS.every((g) => html.includes(`>${g.label}<`)), 'every group is labelled');
  ok(html.includes('>Wave<') && html.includes('>Knock Door<'), 'the emotes keep the catalog\'s labels');
  ok((html.match(/class="emote-wheel__key"/g) || []).length === Math.min(9, GROUPS[0].emotes.length), 'each of the first nine emotes shows its number key');
  ok(count('emote-wheel__group is-active') === 1, 'one group is lit');
  ok(!/<img|\.gif|data:image\/gif/.test(html), 'no GIF and no image: the art is our own glyphs');
  ok((html.match(/class="emote-wheel__glyph"/g) || []).length === GROUPS.length && html.includes('emote-wheel__hub-glyph'), 'a glyph per group, and the active one in the hub');
  ok(html.includes('>Stop emote<'), 'the stop button is there');
  ok(/textLength="64" lengthAdjust="spacingAndGlyphs"[^>]*>Entertain</.test(html) || /lengthAdjust="spacingAndGlyphs" textLength="64"[^>]*>Entertain</.test(html) || /textLength="64"[^>]*lengthAdjust="spacingAndGlyphs"[^>]*>Entertain</.test(html), 'a long group label (Entertain) is fitted to its wedge, not cut');
  ok(!/textLength="64"[^>]*>Dialog</.test(html), '...a short one is left at its own width');
  ok(GROUPS.find((g) => g.id === 'activities').emotes.some((e) => e.anim === 'pipesmokingcrossleggedenter' && e.label === 'Smoke Pipe'), 'Smoke Pipe is on the wheel under Activities');
  ok(fs.readdirSync(path.join(FRONT, 'src/features/emoteWheel')).every((f) => !/\.(gif|png|webp)$/.test(f)) && !fs.existsSync(path.join(FRONT, 'src/features/emoteWheel/assets')), 'the ported GIF art is gone from the feature');
  const many = render({ groups: [{ id: 'x', label: 'X', emotes: Array.from({ length: 12 }, (_, i) => ({ anim: 'A' + i, label: 'Emote ' + i })) }], events: data.events });
  ok((many.match(/class="emote-wheel__key"/g) || []).length === 9 && (many.match(/class="emote-wheel__emote[ "]/g) || []).length === 12, 'a group of twelve draws twelve segments, nine with keys');
  ok(/class="emote-wheel__glyph"[^>]*d="M12 4l6 8-6 8-6-8z"/.test(many), 'an unknown group gets the default glyph');
  ok(render({ groups: [], events: data.events }) === '', 'no groups: nothing drawn');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw: ' + (e && e.stack || e)); process.exit(1); });
