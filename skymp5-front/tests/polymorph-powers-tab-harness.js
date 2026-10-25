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

// ---- the polymorph panel (Nat's call, 25 Oct: self only, plus a panel) ----------------------------------------------
// Everything below is fed by the server: panelData.polymorph is beastform.js __dboPolymorphPanel through
// adminSystem.ts and adminMenuService. The props above are the older-server shape and must keep working, which
// the checks before this line prove.
const FORMS = [{ key: 'chicken', name: 'Chicken' }, { key: 'fox', name: 'Fox' }, { key: 'mudcrab', name: 'Mudcrab' }];
const renderP = (o) => {
  buttons = [];
  return renderToStaticMarkup(React.createElement(tab.PowersTab, Object.assign({
    events, who: '', beast: { werewolf: true, vampirelord: false, form: null }, canSpawn: true,
  }, o)));
};

// the header
html = renderP({ polymorph: { on: true, setBy: 'admin', forms: FORMS }, selfBeast: { werewolf: false, vampirelord: false, form: null } });
ok(/Polymorph/.test(html) && /\bon\b/.test(html) && /set by an Owner/.test(html) && /you are in your own shape/.test(html),
   'header: the switch, who set it, and that you are yourself', texts(html).join(' | '));
html = renderP({ polymorph: { on: false, setBy: 'admin', forms: FORMS }, selfBeast: { werewolf: false, vampirelord: false, form: null } });
ok(/Polymorph/.test(html) && /off/.test(html), 'header: an off switch says so before anyone tries', texts(html).join(' | '));
html = renderP({ polymorph: { on: true, setBy: '', forms: FORMS }, selfBeast: { werewolf: false, vampirelord: false, form: 'fox', creature: true, since: Date.now() - 180000 } });
ok(/you are a fox/.test(html), 'header: names the shape you are in yourself', texts(html).join(' | '));
ok(buttons.some((b) => b.text === 'Revert me'), '...and offers Revert me');

// the picker, server fed
html = renderP({ polymorph: { on: true, setBy: '', forms: FORMS }, selfBeast: { werewolf: false, vampirelord: false, form: null } });
const picks = buttons.filter((b) => FORMS.some((f) => f.name === b.text));
ok(picks.length === 3 && picks.every((b) => !b.disabled), 'picker: one button per form the server sent, all live', picks.map((b) => b.text).join(','));
ok(!/Skeever|Deer|Goat|Hare|Rabbit/.test(html), '...and nothing the server did not send, whatever this build knows', texts(html).join(' | '));
sent.length = 0;
picks.find((b) => b.text === 'Fox').onClick();
ok(sent.length === 1 && sent[0][0] === 'admin::action' && sent[0][1] === 'polymorphSelf' && JSON.parse(sent[0][2]).form === 'fox',
   '...a pick sends polymorphSelf with the form and NO target', JSON.stringify(sent[0]));
ok(!Object.prototype.hasOwnProperty.call(JSON.parse(sent[0][2]), 'target'), '...self only, structurally: the picker never sends a target');

// the picker is closed when it cannot be used
html = renderP({ polymorph: { on: false, setBy: '', forms: FORMS }, selfBeast: { werewolf: false, vampirelord: false, form: null } });
ok(buttons.filter((b) => FORMS.some((f) => f.name === b.text)).every((b) => b.disabled), 'picker: every form is off while the switch is off');
html = renderP({ polymorph: { on: true, setBy: '', forms: FORMS }, selfBeast: { werewolf: false, vampirelord: false, form: 'chicken', creature: true, since: Date.now() } });
ok(buttons.filter((b) => FORMS.some((f) => f.name === b.text)).every((b) => b.disabled), 'picker: and while you are already in a shape');
html = renderP({ polymorph: { on: true, setBy: '', forms: [] }, selfBeast: { werewolf: false, vampirelord: false, form: null } });
ok(/No animal is open for polymorph/.test(html), 'picker: an empty server list says so rather than showing nothing', texts(html).join(' | '));
html = renderP({ polymorph: { on: true, setBy: '', forms: FORMS }, selfBeast: undefined, canSpawn: false });
ok(buttons.filter((b) => FORMS.some((f) => f.name === b.text)).length === 0, 'picker: a GM is offered no form at all');

// who is an animal now, with a Revert each
const ROWS = [
  { id: '', label: 'You', form: 'fox', name: 'Fox', minutes: 3 },
  { id: 'ff000123', label: 'Vaermina Quill', form: 'mudcrab', name: 'Mudcrab', minutes: 0 },
];
html = renderP({ polymorph: { on: true, setBy: '', forms: FORMS }, polymorphed: ROWS, selfBeast: { werewolf: false, vampirelord: false, form: 'fox', creature: true, since: Date.now() - 180000 } });
ok(/In an animal shape now/.test(html) && /You: Fox for 3 min/.test(html) && /Vaermina Quill: Mudcrab for 0 min/.test(html),
   'list: who is an animal, which one, and for how long', texts(html).join(' | '));
sent.length = 0;
buttons.filter((b) => b.text === 'Revert' && b.height === 28).slice(-1)[0].onClick();
ok(sent.length === 1 && sent[0][1] === 'beastForm' && JSON.parse(sent[0][2]).op === 'revert' && JSON.parse(sent[0][2]).target === 'ff000123' && JSON.parse(sent[0][2]).form === 'mudcrab',
   '...Revert on another staff member sends beastForm revert with their id and form', JSON.stringify(sent[0]));
html = renderP({ polymorph: { on: true, setBy: '', forms: FORMS }, polymorphed: [], selfBeast: { werewolf: false, vampirelord: false, form: null } });
ok(!/In an animal shape now/.test(html), 'list: hidden when nobody is an animal', texts(html).join(' | '));
html = renderP({ polymorph: { on: true, setBy: '', forms: FORMS }, polymorphed: ROWS, canSpawn: false });
ok(!/In an animal shape now/.test(html), 'list: a GM is not offered anyone to revert');

// a form with no minutes (an older beastform.js that sends no 'since') must still list
html = renderP({ polymorph: { on: true, setBy: '', forms: FORMS }, polymorphed: [{ id: '', label: 'You', form: 'fox', name: 'Fox', minutes: null }], selfBeast: { werewolf: false, vampirelord: false, form: 'fox', creature: true } });
ok(/You: Fox/.test(html) && !/for .* min/.test(html), 'list: no since from the server means no "for N min", not a broken line', texts(html).join(' | '));

// the whole polymorph section is absent on a server that sends nothing, rather than guessed at
html = renderP({});
ok(!/set by an Owner/.test(html) && !/you are in your own shape/.test(html) && !/Take an animal shape/.test(html) && !/In an animal shape now/.test(html),
   'an older server with no polymorph field gets no panel section at all', texts(html).join(' | '));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
