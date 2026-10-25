// Renders the admin panel's Player tab punish row (extraTabs.tsx PlayerPunish) and checks that "Delete character" follows
// its own capability, apart from ban (692a77bf): a Lead GM may ban but never delete (server TIER_CAPS.del), so the panel
// must not offer a delete the server refuses. IP ban stays on ban. index.tsx derives canDelete from caps.del and falls back
// to caps.ban for a server older than the split; that expression is checked against each kind of server.
//   node tests/admin-delete-cap-front-harness.js [front dir]
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-delete-cap-'));

let fails = 0;
const ok = (cond, msg, got) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg + (got !== undefined ? '   ' + String(got).slice(0, 300) : '')); } };

fs.writeFileSync(path.join(TMP, 'entry.jsx'), `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerPunish } from ${JSON.stringify(path.join(FRONT, 'src/features/adminPanel/extraTabs.tsx'))};
export const render = (props) => renderToStaticMarkup(React.createElement(PlayerPunish, props));
`);

(async () => {
  await esbuild.build({
    entryPoints: [path.join(TMP, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(TMP, 'out.js'),
    logLevel: 'error', nodePaths: [NM], jsx: 'transform',
    loader: { '.js': 'jsx', '.scss': 'empty', '.sass': 'empty', '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.ttf': 'empty', '.otf': 'empty', '.mp3': 'empty', '.wav': 'empty' },
  });
  const { render } = require(path.join(TMP, 'out.js'));
  const texts = (html) => html.replace(/<[^>]*>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
  const has = (html, label) => texts(html).includes(label);
  const row = (canBan, canDelete) => render({ events: {}, target: 'ff000abc', name: 'Someone', canBan, canDelete, canSpawn: true, bans: [] });

  // The rendered row, by capability
  const leadGm = row(true, false);
  ok(!has(leadGm, 'Delete character'), 'a Lead GM (ban, no delete) is not offered Delete character', texts(leadGm).join(' | '));
  ok(has(leadGm, 'IP ban'), '...but keeps IP ban, which stays on ban', texts(leadGm).join(' | '));
  const senior = row(true, true);
  ok(has(senior, 'Delete character') && has(senior, 'IP ban'), 'a Senior (ban and delete) is offered both', texts(senior).join(' | '));
  const gm = row(false, false);
  ok(!has(gm, 'Delete character') && !has(gm, 'IP ban'), 'a GM (neither) is offered neither', texts(gm).join(' | '));
  const delOnly = row(false, true);
  ok(has(delOnly, 'Delete character') && !has(delOnly, 'IP ban'), 'delete and ban are independent: delete alone shows only Delete character', texts(delOnly).join(' | '));

  // index.tsx's derivation, evaluated for each kind of server
  const index = fs.readFileSync(path.join(FRONT, 'src/features/adminPanel/index.tsx'), 'utf8');
  const m = /const canDelete = ([^;]+);/.exec(index);
  ok(!!m, 'index.tsx derives canDelete');
  ok(/canDelete=\{canDelete\}/.test(index), '...and hands it to the punish row');
  if (m) {
    const canDelete = new Function('data', `return ${m[1]};`);
    ok(canDelete({}) === true, 'a server sending no caps at all: delete offered, as before');
    ok(canDelete({ caps: { ban: true } }) === true, 'an older server (no del): delete follows ban, as before the split');
    ok(canDelete({ caps: { ban: false } }) === false, '...and a rank without ban there gets no delete, as before');
    ok(canDelete({ caps: { ban: true, del: false } }) === false, 'a new server, a Lead GM (ban, del false): no delete');
    ok(canDelete({ caps: { ban: true, del: true } }) === true, 'a new server, a Senior (ban, del true): delete offered');
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
