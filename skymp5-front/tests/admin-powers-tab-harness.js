// Renders the admin panel's Powers tab (extraTabs.tsx PowersTab) to HTML and checks that Give all spells and Give all shouts
// are gone (Jake, 17 Oct: a character given all spells froze the server), while the werewolf and Vampire Lord buttons stay.
//   node tests/admin-powers-tab-harness.js [front dir]
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-powers-tab-'));

let fails = 0;
const ok = (cond, msg, got) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg + (got !== undefined ? '   ' + String(got).slice(0, 300) : '')); } };

fs.writeFileSync(path.join(TMP, 'entry.jsx'), `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PowersTab } from ${JSON.stringify(path.join(FRONT, 'src/features/adminPanel/extraTabs.tsx'))};
export const render = (props) => renderToStaticMarkup(React.createElement(PowersTab, props));
`);

(async () => {
  await esbuild.build({
    entryPoints: [path.join(TMP, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(TMP, 'out.js'),
    logLevel: 'error', nodePaths: [NM], jsx: 'transform',
    loader: { '.js': 'jsx', '.scss': 'empty', '.sass': 'empty', '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.ttf': 'empty', '.otf': 'empty', '.mp3': 'empty', '.wav': 'empty' },
  });
  const source = fs.readFileSync(path.join(FRONT, 'src/features/adminPanel/extraTabs.tsx'), 'utf8');
  ok(!/giveSpells|giveShouts/.test(source), 'extraTabs.tsx sends neither giveSpells nor giveShouts');
  const { render } = require(path.join(TMP, 'out.js'));
  const beast = { werewolf: false, vampirelord: false, form: '' };
  // Each text node of the markup, so a button label is counted apart from the hint that names it
  const texts = (html) => html.replace(/<[^>]*>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
  const count = (html, label) => texts(html).filter((t) => t === label).length;
  const lead = render({ events: {}, who: '', beast, canSpawn: true });
  ok(!/Give all/i.test(lead), 'Lead GM and above: no Give all button on the Powers tab', texts(lead).join(' | '));
  ok(count(lead, 'Grant power') === 2 && count(lead, 'Werewolf') === 1 && count(lead, 'Vampire Lord') === 1, '...the werewolf and Vampire Lord grants are still there', texts(lead).join(' | '));
  ok(count(lead, 'Transform now') === 2 && count(lead, 'Revert') === 2 && count(lead, 'Revoke') === 2, '...with Transform now, Revert and Revoke for each', texts(lead).join(' | '));
  const gm = render({ events: {}, who: '', beast, canSpawn: false });
  ok(!/Give all/i.test(gm) && count(gm, 'Grant power') === 0 && /Powers are for a Lead GM and above/.test(gm), 'GM: no Give all and no grant buttons, only the note', texts(gm).join(' | '));
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw', e); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
