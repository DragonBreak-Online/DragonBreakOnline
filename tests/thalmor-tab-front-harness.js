// The F3 journal's Thalmor tab (skymp5-front features/journal/tabs/ThalmorTab, server thalmor.js view; Nate 11 Oct):
// renders the real journal with React's static renderer for the section thalmor.js sends. The HUD announces the tab;
// reports draw without a name; the Concordat line; dossiers and their notes; Write and Strike only for writers; the
// Dominion stipend on the Treasury line (features/faction/realm.tsx) is checked in the source.
//
//   node tests/thalmor-tab-front-harness.js <bundle of skymp5-front/src/features/journal/index.tsx>
'use strict';
const fs = require('fs');
const path = require('path');

const bundle = process.argv[2];
if (!bundle) { console.log('usage: node tests/thalmor-tab-front-harness.js <bundle>'); process.exit(2); }
const SRC = fs.readFileSync(bundle, 'utf8');
if (!/jthal__/.test(SRC)) { require('./expect')('thalmor-tab-front', 'this front has no Thalmor tab'); console.log('ok   skipped: this front has no Thalmor tab'); process.exit(0); }
const J = require(bundle);
const { Widget: Journal, renderToStaticMarkup, createElement } = J;
let failures = 0;
const check = (label, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const hub = (section) => ({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tab: 'thalmor',
  tabs: [{ id: 'profile', label: 'Profile' }, { id: 'thalmor', label: 'Thalmor', badge: '2' }],
  head: { name: 'Ondolemar', title: 'Justiciar', race: 'High Elf' }, clock: { date: '11th of Frostfall, 4E 211', time: '9:00 in the evening' }, thalmor: section });
const section = (extra) => Object.assign({
  rank: 'Justiciar', canRead: true, canWrite: true, canArrest: true,
  concordat: { on: true, minutes: 30, where: 'Cyrodiil', here: true, arrestRanks: 'First Emissary, Justiciar and Inquisitor' },
  reports: [{ at: Date.UTC(2026, 9, 11, 19, 2), shrine: 'Shrine of Talos', place: 'Bruma', world: '9:14 in the evening, 11 Frostfall', god: 'Talos' }],
  dossiers: [{ key: '31', name: 'Pious', tag: 'AB12', updated: 2, notes: [{ at: 2, byName: 'Ondolemar', text: 'Seen near the chapel at dusk.' }] }],
  limits: { noteMax: 500, notesPer: 20 },
}, extra || {});

check('the HUD announces journalTab:thalmor', J.journalCaps().includes('journalTab:thalmor'), J.journalCaps());
let html = renderToStaticMarkup(createElement(Journal, { data: hub(section()) }));
let t = text(html);
check('the tab draws in the journal body', /jthal/.test(html) && /journal__body--thalmor/.test(html), html.slice(0, 300));
check('the heading names the rank', /The Thalmor: Justiciar/.test(t));
check('the Concordat line: who, where, how long', /First Emissary, Justiciar and Inquisitor may arrest a follower of Talos in Cyrodiil/.test(t) && /30 minutes/.test(t), t.slice(0, 400));
check('a report: shrine, place and hour, and no name', /Someone knelt at the Shrine of Talos, Bruma\./.test(t) && /9:14 in the evening/.test(t) && /2026-10-11 19:02 UTC/.test(t), t);
check('the two views are offered', /Informant reports \(1\)/.test(t) && /Dossiers \(1\)/.test(t));
html = renderToStaticMarkup(createElement(Journal, { data: hub(section({ canRead: false, dossiers: [] })) }));
check('without read rights there is no Dossiers button', !/Dossiers \(/.test(text(html)));
html = renderToStaticMarkup(createElement(Journal, { data: hub(section({ reports: [] })) }));
check('no reports: the line says so, and that informants never name', /never the name/.test(text(html)));
html = renderToStaticMarkup(createElement(Journal, { data: hub(section({ concordat: { on: true, minutes: 30, where: 'Cyrodiil', here: false, arrestRanks: 'First Emissary' } })) }));
check('outside the Empire the line says the Concordat gives no authority here', /gives no authority/.test(text(html)));
// The dossier view is a click away: render the tab component itself with a state that opens it is not possible in a
// static render, so the source is read for what the buttons send
const tab = fs.readFileSync(path.join(process.env.FORK || path.resolve(__dirname, '..', '..', 'fork'), 'skymp5-front/src/features/journal/tabs/ThalmorTab.tsx'), 'utf8');
check('Write sends thalmorNote [target, text]; Strike sends thalmorStrike [key, at]', /act\('thalmorNote', target, text\)/.test(tab) && /act\('thalmorStrike', shown\.key, n\.at\)/.test(tab));
check('Write and Strike only for writers', /s\.canWrite \? \(\s*<button[^]*?Strike/.test(tab) && /s\.canWrite && \(shown \|\| !open\)/.test(tab));
check('typing in the tab keeps keys from the game', (tab.match(/onKeyDown=\{keep\}/g) || []).length === 2);
check('no native <select> (SkyrimPlatform does not paint it)', !/<select/.test(tab));
const realm = fs.readFileSync(path.join(process.env.FORK || path.resolve(__dirname, '..', '..', 'fork'), 'skymp5-front/src/features/faction/realm.tsx'), 'utf8');
check('the Treasury line names the Dominion stipend', /a stipend of \$\{gold\(f\.report\.stipend\)\} from \$\{f\.report\.stipendFrom \|\| 'the Aldmeri Dominion'\}/.test(realm));
console.log(`${failures ? 'FAIL' : 'ok  '} thalmor-tab-front`);
process.exit(failures ? 1 : 0);
