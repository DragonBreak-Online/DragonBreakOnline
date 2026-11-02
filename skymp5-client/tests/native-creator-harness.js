// The character creator as a native panel (swf/dbo_creator) driven by its real rules (charCreator/creatorModel.ts), end to
// end on the stub stage: every cc:act the panel sends goes through the model and its page comes back, as charCreatorService
// does. A character is made from Species to Finish by clicks and typing; Back, Escape, paging, the narrow dock and the wide
// Story step, a refusal, a game that cannot type, and a panel with no payload are checked; then the service's wiring.
//   node tests/native-creator-harness.js   (from skymp5-client)
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.resolve(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// The model and the front's ES modules, transpiled on require. The front is found where this harness first ran, so a
// mutant's copy of src and tests still reaches it (tests/lib/mutants.js copies only src, swf and tests)
if (!process.env.DBO_TS) process.env.DBO_TS = path.resolve(ROOT, 'node_modules/typescript');
const ts = require(process.env.DBO_TS);
if (!process.env.DBO_FRONT_SRC) process.env.DBO_FRONT_SRC = path.resolve(ROOT, '../skymp5-front/src');
const transpile = (src) => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
require.extensions['.ts'] = (m, f) => m._compile(transpile(fs.readFileSync(f, 'utf8')), f);
const realJs = require.extensions['.js'];
require.extensions['.js'] = (m, f) => (f.startsWith(process.env.DBO_FRONT_SRC) ? m._compile(transpile(fs.readFileSync(f, 'utf8')), f) : realJs(m, f));
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  const m = /skymp5-front\/src\/(.*)$/.exec(req);
  return realResolve.call(this, m ? path.join(process.env.DBO_FRONT_SRC, m[1]) : req, ...rest);
};
const C = require(path.resolve(ROOT, 'src/services/services/charCreator/creatorModel.ts'));

const P = (t) => t.root.dboPanel;
const textsOf = (c) => { const out = []; const walk = (x) => { for (const k of Object.values(x.kids || {})) { if (typeof k.text === 'string') out.push(k.text); if (k.kids) walk(k); } }; walk(c); return out.join('|'); };
// the buttons on the shown page (and outside the flow), as the player can reach them
const visible = (c) => { for (let x = c; x; x = x._parent) if (x._visible === false) return false; return true; };
const buttons = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids || {})) { if (x.kids && x.label && x.onPick) { if (visible(x)) out.push(x); } else if (x.kids) walk(x); } }; walk(P(t)); return out; };
const btn = (t, label) => buttons(t).find((b) => b.label.text === label);
const acts = (t) => t.msgs().filter((m) => m.key === 'cc:act');

// The service's loop: the panel's actions through the model, its page back to the panel
const session = (cfgRaw, extra) => {
  const t = S.boot('dbo_creator', false, extra);
  const cfg = C.configOf(cfgRaw);
  let s = C.initialState();
  let taken = 0;
  const saves = [];
  t.push(C.view(s, cfg));
  t.answer = () => {
    const a = acts(t).slice(taken);
    taken += a.length;
    for (const m of a) { const r = C.act(s, cfg, String(m.args[0]), m.args[1]); s = r.state; if (r.save) saves.push(r.save); t.push(C.view(s, cfg)); }
    return a.length;
  };
  t.click = (label) => { const b = btn(t, label); if (!b) return false; b.onRelease(); t.answer(); return true; };
  t.state = () => s;
  t.setState = (x) => { s = x; t.push(C.view(s, cfg)); };
  t.saves = saves;
  return t;
};
const CFG = { statPool: 20, disabledRaces: ['giant'], lockedRaces: ['akaviri'], allowChildren: false };

{
  const t = session(CFG);
  check('Step 1 of 5, Species; Back and Next greyed', /Step 1 of 5:  Species/.test(textsOf(P(t).head)) && btn(t, 'Next').disabled === true && btn(t, 'Back').disabled === true);
  check('...docked at the right, the character left in view', P(t)._x > 600, P(t)._x);
  t.press(27);
  check('...Escape on the first step does nothing', !acts(t).length && !t.closed());
  t.click('Human');
  check('a species chip sends cc:act ["species", "human"] and is shown chosen', JSON.stringify(acts(t)[0].args) === '["species","human"]' && btn(t, 'Human')._alpha === 100 && btn(t, 'Next').disabled !== true);
  t.click('Next');
  check('Next: Race, the locked race greyed, the disabled one absent', /Step 2 of 5:  Race/.test(textsOf(P(t).head)) && btn(t, 'Akaviri (locked)').disabled === true && !btn(t, 'Giant') && btn(t, 'Next').disabled === true);
  t.click('Nord');
  check('...a race shows its lore and opens Next', t.state().race === 'nord' && /Nord/.test(textsOf(P(t))) && btn(t, 'Next').disabled !== true);
  t.click('Next');
  check('Identity: sex, ages without Child, the attribute steppers', btn(t, 'Female') && btn(t, 'Adult') && !btn(t, 'Child') && /Attributes: 20 points left/.test(textsOf(P(t))));
  t.press(27);
  t.answer();
  check('...Escape goes back a step', t.state().step === 2);
  t.click('Next');
  t.click('Female');
  const plus5 = buttons(t).filter((b) => b.label.text === '+5');
  plus5[0].onRelease(); t.answer();
  check('a +5 stepper sends ["stat:strength", 5]', JSON.stringify(acts(t).slice(-1)[0].args) === '["stat:strength",5]' && t.state().stats.strength === 45);
  for (let i = 0; i < 4; i++) { const b = buttons(t).filter((x) => x.label.text === '+5')[1]; b.onRelease(); t.answer(); }
  check('...the pool spent, every + greyed', /Attributes: 0 points left/.test(textsOf(P(t))) && buttons(t).filter((b) => /^\+/.test(b.label.text)).every((b) => b.disabled === true));
  t.click('Next');
  check('Appearance: head parts first, in pages', /Head Parts/.test(textsOf(P(t))) && /Page 1 \//.test(textsOf(P(t).foot)));
  const hair = t.state().look.parts.hair;
  buttons(t).filter((b) => b.label.text === '>')[0].onRelease(); t.answer();
  check('...a carousel > moves the hair', t.state().look.parts.hair !== hair);
  let pages = 0;
  while (!buttons(t).some((b) => b._name === 'c1') && ++pages < 30) t.wheel(-1);
  const sw = buttons(t).find((b) => b._name === 'c1');
  if (sw) { sw.onRelease(); t.answer(); }
  check('...a colour swatch sends its index', !!sw && /^\["skin",1\]$|^\["hair",1\]$|^\["lip",1\]$|^\["paint",1\]$/.test(JSON.stringify(acts(t).slice(-1)[0].args)), acts(t).slice(-1)[0]);
  t.click('Next');
  check('Story: the panel widens and centres, Finish greyed with no name', /Step 5 of 5:  Story/.test(textsOf(P(t).head)) && P(t)._x < 300 && btn(t, 'Finish').disabled === true);
  const typeBtn = buttons(t).filter((b) => b.label.text === 'Type...')[0];
  typeBtn.onRelease();
  const box = t.ctx.Selection.focused;
  check('...Type... opens a box with the keys taken', !!box && t.sent.some((m) => m.e === 'allowTextInput' && m.on === true));
  box.text = 'Bob1';
  t.press(13); t.answer();
  check('...Enter sends ["name", typed] and the rule refuses it', JSON.stringify(acts(t).slice(-1)[0].args) === '["name","Bob1"]' && /Only letters/.test(textsOf(P(t))) && btn(t, 'Finish').disabled === true);
  buttons(t).filter((b) => b.label.text === 'Type...')[0].onRelease();
  t.ctx.Selection.focused.text = '  Hjalti  ';
  t.press(13); t.answer();
  check('...a good name opens Finish', t.state().name === 'Hjalti' && btn(t, 'Finish').disabled !== true, t.state().name);
  t.click('Finish');
  check('Finish sends one result and waits, Back greyed', t.saves.length === 1 && t.saves[0].name === 'Hjalti' && t.saves[0].sex === 'female' && btn(t, 'Forging...') && btn(t, 'Back').disabled === true);
  btn(t, 'Forging...').onRelease(); t.answer();
  t.press(27); t.answer();
  check('...no second result, Escape does nothing', t.saves.length === 1 && t.state().step === 5);
  t.setState(C.refused(t.state(), 'That name is taken.'));
  check('a refusal shows why and offers Finish again', /That name is taken\./.test(textsOf(P(t))) && btn(t, 'Finish').disabled !== true);
}
{
  const t = session(CFG, { noTyping: true });
  t.setState(Object.assign(C.initialState(), { step: 5, species: 'human', race: 'nord' }));
  check('a game that cannot type: no Type..., a Browser button sending ["browser", 1]', !btn(t, 'Type...') && btn(t, 'Browser') && (btn(t, 'Browser').onRelease(), JSON.stringify(acts(t).slice(-1)[0].args) === '["browser",1]'));
}
{
  const t = S.boot('dbo_creator');
  t.press(27);
  check('Escape before any payload closes the panel, saying so', t.closed() && t.msgs().some((m) => m.key === 'close'));
  const n = S.boot('dbo_creator');
  n.push({ type: 'kick' });
  n.st.time += 8001; n.tick();
  check('a payload that is not the creator is refused; with none in 8 s the panel closes', n.logs.some((l) => /creator: unreadable payload/.test(l)) && n.closed());
}
{
  const t = session(CFG);
  btn(t, 'Human').onRelease(); btn(t, 'Human').onRelease();
  check('a second click before the answer is dropped', acts(t).length === 1);
}

// ---- the service ----
const SVC = read('src/services/services/charCreatorService.ts');
check('nativeWidgets: charCreator is a client-service panel, dbo_creator', /\n  charCreator: "dbo_creator",\n/.test(read('src/services/services/nativeWidgets.ts')));
check('the native panel first, the browser creator when it says no', /if \(!this\.openNative\(\)\) this\.showBrowser\(\);/.test(SVC));
check('a failed panel, one that went, or a game that cannot type: the browser creator', /if \(key === FAILED_KEY \|\| key === CLOSE_KEY \|\| \(key === "cc:act" && args\[0\] === "browser"\)\) \{[\s\S]{0,300}this\.native = false;[\s\S]{0,60}this\.showBrowser\(\);/.test(SVC));
check('each action through the model, the result sent as the browser sends it, and always answered', /const r = Creator\.act\(this\.cc, this\.ccConfig, String\(args\[0\]\), args\[1\]\);/.test(SVC) && /sendCustomPacket\(this\.controller, \{ customPacketType: 'charCreatorResult', data: r\.save \}\);/.test(SVC) && /\/\/ every action is answered, so the panel never stays waiting\n    this\.refreshNative\(\);/.test(SVC));
check('a refusal goes to the panel when it is up', /if \(this\.native && this\.cc\) \{\s*this\.cc = Creator\.refused\(this\.cc, message\);\s*this\.refreshNative\(\);\s*return;/.test(SVC));
check('previews debounced 200 ms, as the browser does', /const PREVIEW_MS = 200;/.test(SVC) && /if \(r\.preview\) this\.previewAt = Date\.now\(\) \+ PREVIEW_MS;/.test(SVC));
check('the browser is never refocused over the panel', /if \(!this\.menuOpen \|\| this\.native\) return;/.test(SVC));
check('mod hair reaches the model as it reaches the browser creator', /setModHeadparts\(Array\.isArray\(config\.modParts\)/.test(SVC));

// ---- mutants: each altered copy must fail this harness (tests/lib/mutants.js) ----
const AS = 'swf/dbo_creator/scripts/frame_1/DoAction.as';
const SV = 'src/services/services/charCreatorService.ts';
const MUTANTS = [
  ['Escape closes the creator', AS, [['      else if (data.back == true)\n', '      else if (true)\n      {\n         dboClose();\n      }\n      else if (data.back == true)\n']]],
  ['the busy guard is gone', AS, [['   if (data == null || (busy && key != "back"))', '   if (data == null)']]],
  ['a typed box is never sent', AS, [['         act(k, typed[k]);', '']]],
  ['the Story step stays narrow', AS, [['   var w = data.step == 5 ? WIDE_W : NARROW_W;', '   var w = NARROW_W;']]],
  ['Next never greys', AS, [['      if (data.next != true)\n', '      if (false)\n']]],
  ['the browser opens over the panel too', SV, [['if (!this.openNative()) this.showBrowser();', 'this.openNative(); this.showBrowser();']]],
  ['a refusal goes only to the browser', SV, [['    if (this.native && this.cc) {', '    if (false) {']]],
];
require('./lib/mutants')(__filename, MUTANTS, check);

T.done();
