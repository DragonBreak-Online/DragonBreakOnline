// Renders the admin panel's Thievery tab (adminPanel/thieveryTab.tsx) to HTML from a staffData widget 162 and checks what a
// Lead GM and a GM are shown: Approve, Mark fence and Revoke only for a Lead GM; raids, permits and Send back for both; a raid
// ruled before its notice is out disabled for a GM; the ledger filters; and the F7 rail lists Thievery for GM+ only (index.tsx).
//   node tests/admin-thievery-tab-harness.js [front dir]
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
if (!fs.existsSync(path.join(FRONT, 'src/features/adminPanel/thieveryTab.tsx'))) { console.log('ok   skipped: this front has no Thievery tab'); process.exit(0); }
const esbuild = require(ESB);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-thievery-tab-'));

let fails = 0;
const ok = (cond, msg, got) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg + (got !== undefined ? '   ' + String(got).slice(0, 400) : '')); } };

fs.writeFileSync(path.join(TMP, 'entry.jsx'), `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThieveryTab } from ${JSON.stringify(path.join(FRONT, 'src/features/adminPanel/thieveryTab.tsx'))};
export const render = (props) => renderToStaticMarkup(React.createElement(ThieveryTab, props));
`);

const NOW = Date.UTC(2026, 9, 21, 12, 0);
const sample = (lead) => ({
  type: 'staffData', id: 162, kind: 'thievery', now: NOW, enabled: true, lead, gm: true, armed: null,
  factions: [{ id: 'thieves-guild', name: 'Thieves Guild', config: false, fence: { chest: '700', by: 'Nat', at: NOW, frozen: 2, lots: 3 } }],
  candidates: [{ id: 'dark-brotherhood', name: 'Dark Brotherhood' }],
  raids: [
    { n: 3, fid: 'thieves-guild', faction: 'Thieves Guild', state: 'pending', by: 'Guard Hrolf', evidence: 'The silver candlesticks went down the Ratway.', at: NOW - 600000, raidAt: 0, decidedBy: '', reason: '' },
    { n: 2, fid: 'thieves-guild', faction: 'Thieves Guild', state: 'approved', by: 'Guard Ulf', evidence: 'Seen at the Flagon with Lydia\'s sword.', at: NOW - 7200000, raidAt: NOW + 3600000, decidedBy: 'Nat', reason: '' },
  ],
  stolen: [
    { n: 7, at: NOW - 60000, item: 'Iron Sword', owner: 'Lydia', thief: 'Brynjolf', home: 'Lydia\'s house', state: 'fenced', canSendBack: true },
    { n: 6, at: NOW - 120000, item: 'Bread x4', owner: 'Bera', thief: 'Vex', home: 'Bera\'s cottage', state: 'carried', canSendBack: false },
    { n: 5, at: NOW - 180000, item: 'Book', owner: 'Lydia', thief: 'Vex', home: 'Lydia\'s house', state: 'recovered', canSendBack: false },
  ],
  stolenTotal: 3,
  permits: [{ home: '500', homeName: 'Castle Bruma', thief: 'Vex', until: NOW + 7200000, by: 'Nat' }],
  breaches: [{ thief: 'Brynjolf', home: 'Lydia\'s house', faction: 'Thieves Guild', until: NOW + 300000, at: NOW - 300000 }],
  working: [{ thief: 'Vex', home: 'Bera\'s cottage', kind: 'door', until: NOW + 20000 }],
  result: { ok: false, text: 'Lead GMs and above approve thief factions.', at: NOW },
});

(async () => {
  await esbuild.build({
    entryPoints: [path.join(TMP, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(TMP, 'out.js'),
    logLevel: 'error', nodePaths: [NM], jsx: 'transform',
    loader: { '.js': 'jsx', '.scss': 'empty', '.sass': 'empty', '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.ttf': 'empty', '.otf': 'empty', '.mp3': 'empty', '.wav': 'empty' },
  });
  const realNow = Date.now; Date.now = () => NOW;
  let current = null;
  global.window = { skyrimPlatform: { sendMessage() {}, widgets: { get: () => (current ? [current] : []), addListener() {}, removeListener() {} } } };
  const { render } = require(path.join(TMP, 'out.js'));
  const texts = (html) => html.replace(/<[^>]*>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
  const has = (html, label) => texts(html).includes(label);
  // Confirm renders a SkyrimButton: a <button> whose inline opacity is 0.6 when disabled (SkyrimButton.tsx)
  const buttonDisabled = (html, label) => { const i = html.indexOf('>' + label + '<'); if (i < 0) return null; const open = html.lastIndexOf('<button', i); if (open < 0) return null; const tag = html.slice(open, html.indexOf('>', open) + 1); return /opacity:0\.6/.test(tag); };

  current = null;
  ok(/Loading thievery/.test(render({})), 'no data yet: a loading line');

  current = sample(true);
  const leadF = render({ initialView: 'factions' });
  ok(has(leadF, 'Thieves Guild') && /Fence Chest 700, 3 lots, frozen by raid #2/.test(leadF), 'Lead GM: the faction and its fence, frozen', texts(leadF).join(' | '));
  ok(has(leadF, 'Move fence') && has(leadF, 'Revoke') && has(leadF, 'Unmark') && has(leadF, 'Approve') && has(leadF, 'Dark Brotherhood'), 'Lead GM: Move fence, Unmark, Revoke and Approve a candidate', texts(leadF).join(' | '));
  ok(buttonDisabled(leadF, 'Unmark') === true, 'Unmark is disabled while the fence holds lots or is frozen', leadF.slice(0, 0));
  ok(/Lead GMs and above approve thief factions\./.test(leadF), 'the last answer from the server is shown');
  ok(/Factions &amp; fences \(1\)/.test(leadF) && /Raids \(2\)/.test(leadF) && /Stolen ledger \(3\)/.test(leadF) && /Permits &amp; breaches \(3\)/.test(leadF), 'the four views with their counts', texts(leadF).join(' | '));

  current = sample(false);
  const gmF = render({ initialView: 'factions' });
  ok(!has(gmF, 'Move fence') && !has(gmF, 'Mark fence') && !has(gmF, 'Revoke') && !has(gmF, 'Approve') && !has(gmF, 'Dark Brotherhood'), 'GM: factions and fences are read-only', texts(gmF).join(' | '));
  ok(/factions and fences are for a Lead GM/.test(gmF), 'GM: the tier is said');

  const gmR = render({ initialView: 'raids' });
  ok(has(gmR, 'Approve') && has(gmR, 'Deny') && buttonDisabled(gmR, 'Deny') === true, 'GM: a pending raid has Approve, and Deny waits for a reason', texts(gmR).join(' | '));
  ok(has(gmR, 'Won: lots go home') && buttonDisabled(gmR, 'Won: lots go home') === true && buttonDisabled(gmR, 'Lost: unfreeze') === true, 'GM: Won and Lost are disabled before the notice is out');
  ok(/Silver candlesticks|silver candlesticks/.test(gmR) && /Waiting for a GM/.test(gmR), 'the evidence and the state are shown');
  current = sample(true);
  const leadR = render({ initialView: 'raids' });
  ok(buttonDisabled(leadR, 'Won: lots go home') === false && /ruling now is a Lead GM/.test(leadR), 'Lead GM: Won is open early, with the warning');

  current = sample(false);
  const gmL = render({ initialView: 'ledger' });
  ok(has(gmL, '#7 Iron Sword') && has(gmL, '#6 Bread x4') && has(gmL, '#5 Book'), 'the ledger lists every entry', texts(gmL).join(' | '));
  ok(texts(gmL).filter((t) => t === 'Send back').length === 1, 'GM: Send back only where the server allows it (the fenced lot)', texts(gmL).join(' | '));
  ok(/Lydia&#x27;s house \(Lydia\)|Lydia's house \(Lydia\)/.test(gmL) && /fenced/.test(gmL), 'each entry shows its home, owner and state');

  const gmP = render({ initialView: 'permits' });
  ok(has(gmP, 'Grant, then use the door') && has(gmP, 'Revoke') && has(gmP, 'Castle Bruma'), 'GM: permits can be granted and revoked', texts(gmP).join(' | '));
  ok(/at its door/.test(gmP) && /Lydia&#x27;s house \(Thieves Guild\)|Lydia's house \(Thieves Guild\)/.test(gmP), 'the lock being forced and the live breach are shown', texts(gmP).join(' | '));

  // The rail: Thievery is a normal tab (hidden by a Trial GM's tab list), not a gameplay tab shown to everyone
  const idx = fs.readFileSync(path.join(FRONT, 'src/features/adminPanel/index.tsx'), 'utf8');
  const gameplayTabs = (/const GAMEPLAY_TABS: Tab\[\] = \[([^\]]*)\]/.exec(idx) || [])[1] || '';
  ok(/\{ id: 'thievery', label: 'Thievery' \}/.test(idx) && /tab === 'thievery' \? <ThieveryTab/.test(idx), 'index.tsx lists and draws the Thievery tab');
  ok(gameplayTabs && !/thievery/.test(gameplayTabs), 'Thievery is not in GAMEPLAY_TABS, so a Trial GM never sees it', gameplayTabs);

  Date.now = realNow;
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw', e); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
