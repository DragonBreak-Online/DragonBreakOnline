// Renders the admin panel's Powers tab (extraTabs.tsx PowersTab) for a staff member in a polymorph animal shape (server
// beastform.js, /polymorph): the state line names the animal instead of "werewolf", the animal gets its own Revert (sent as
// beastForm revert with its key), and no animal can be given from the panel. The real extraTabs.tsx runs on React with the
// Button recorded and every other import stubbed. Run from skymp5-front:
//   node tests/polymorph-powers-tab-harness.js [front node_modules dir]
// Env: FRONT_NM. Prints ok/FAIL lines and exits 1 on a FAIL.
'use strict';
const fs = require('fs');
const path = require('path');

const FRONT = path.resolve(__dirname, '..');
const NM = [process.argv[2], process.env.FRONT_NM, path.join(FRONT, 'node_modules')]
  .find((d) => d && fs.existsSync(path.join(d, 'react-dom', 'server.js')) && fs.existsSync(path.join(d, 'typescript')));
if (!NM) { console.log('SKIP polymorph-powers-tab (needs a front node_modules with react-dom and typescript)'); process.exit(0); }
const ts = require(path.join(NM, 'typescript'));
const React = require(path.join(NM, 'react'));
const { renderToStaticMarkup } = require(path.join(NM, 'react-dom', 'server'));

let fails = 0;
const ok = (cond, msg, got) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg + (got !== undefined ? '   ' + String(got).slice(0, 300) : '')); } };

// Every Button drawn is recorded with its props, so a row's Revert can be pressed
let buttons = [];
const Button = (props) => { buttons.push(props); return React.createElement('button', { disabled: !!props.disabled }, props.text); };
const stub = () => new Proxy({}, { get: (_, k) => (k === '__esModule' ? true : function Stub() { return null; }) });
const file = path.join(FRONT, 'src', 'features', 'adminPanel', 'extraTabs.tsx');
const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const mod = { exports: {} };
const req = (spec) => (spec === 'react' ? React : spec === '../../constructorComponents/button' ? { __esModule: true, default: Button } : stub());
new Function('require', 'module', 'exports', out)(req, mod, mod.exports);
const tab = mod.exports;

const sent = [];
globalThis.window = { skyrimPlatform: { sendMessage: (...a) => sent.push(a) } };
const events = { action: 'admin::action' };
const texts = (html) => html.replace(/<[^>]*>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
const count = (html, label) => texts(html).filter((t) => t === label).length;
const render = (form, canSpawn = true, who = '') => {
  buttons = [];
  return renderToStaticMarkup(React.createElement(tab.PowersTab, { events, who, beast: { werewolf: true, vampirelord: false, form }, canSpawn }));
};
const stateLine = (html) => texts(html)[0];

ok(typeof tab.PowersTab === 'function', 'extraTabs.tsx exports PowersTab');
let html = render(null);
ok(stateLine(html) === 'In their own shape' && count(html, 'Revert') === 2 && count(html, 'Transform now') === 2, 'own shape: as before, two beasts with their buttons', texts(html).join(' | '));
ok(stateLine(render('werewolf')) === 'Currently a werewolf' && stateLine(render('vampirelord')) === 'Currently a Vampire Lord', 'a werewolf and a Vampire Lord read as before');

html = render('chicken');
ok(stateLine(html) === 'Currently a chicken', 'a polymorphed chicken reads "Currently a chicken", not "Currently a werewolf"', stateLine(html));
ok(count(html, 'Chicken') === 1 && texts(html).includes('transformed now'), '...with its own row, transformed now', texts(html).join(' | '));
const reverts = buttons.filter((b) => b.text === 'Revert');
const own = reverts.filter((b) => !b.disabled);
ok(reverts.length === 3 && own.length === 1, '...one Revert of its own that can be pressed; the werewolf and Vampire Lord ones are off', reverts.map((b) => !!b.disabled).join(','));
sent.length = 0;
if (own[0]) own[0].onClick();
ok(sent.length === 1 && sent[0][0] === 'admin::action' && sent[0][1] === 'beastForm' && sent[0][2] === JSON.stringify({ form: 'chicken', op: 'revert' }),
  '...which sends beastForm revert with the chicken key', JSON.stringify(sent));
buttons = [];
render('fox', true, 'ff0000a1');
sent.length = 0;
const foxRevert = buttons.find((b) => b.text === 'Revert' && !b.disabled);
if (foxRevert) foxRevert.onClick();
ok(sent.length === 1 && sent[0][2] === JSON.stringify({ target: 'ff0000a1', form: 'fox', op: 'revert' }), 'on another staff member it names them as the target', JSON.stringify(sent));
ok(count(html, 'Transform now') === 2 && count(html, 'Grant power') === 2 && count(html, 'Revoke') === 2, 'no animal can be given, granted or revoked from the panel (staff use /polymorph on themselves)', texts(html).join(' | '));

const names = { chicken: 'chicken', rabbit: 'rabbit', hare: 'hare', goat: 'goat', fox: 'fox', dog: 'dog', skeever: 'skeever', mudcrab: 'mudcrab', deer: 'deer' };
const wrong = Object.entries(names).filter(([k, n]) => stateLine(render(k)) !== 'Currently a ' + n);
ok(wrong.length === 0, 'every wave-1 animal is named', wrong.map(([k]) => `${k}: ${stateLine(render(k))}`).join(' | '));
ok(stateLine(render('elk')) === 'Currently an elk', 'a later animal the panel does not know yet is still named, with its article', stateLine(render('elk')));

html = render('chicken', false);
ok(count(html, 'Chicken') === 1 && count(html, 'Revert') === 0 && /Powers are for a Lead GM and above/.test(html), 'a GM sees the chicken but no buttons', texts(html).join(' | '));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
