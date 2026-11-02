// The native creator's rules (charCreator/creatorModel.ts) against the browser creator's: the steps gate as index.js
// does, locked and disabled races and the child age are refused, the stat pool holds, names follow StoryScreen's rules,
// Finish sends the browser's payload once and waits, a refusal offers Finish again, and the page view() describes for
// the panel has only actions act() accepts. The model and the front's data modules are transpiled as they are; mutants
// of a copy of the model are compiled and must fail.
//   node tests/char-creator-model-harness.js   (from skymp5-client)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const ts = require(path.resolve(__dirname, '../node_modules/typescript'));

const ROOT = path.resolve(__dirname, '..');
const MODEL = path.join(ROOT, 'src/services/services/charCreator/creatorModel.ts');
const SRC = fs.readFileSync(MODEL, 'utf8').replace(/\r\n/g, '\n');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-ccmodel-'));

// .ts and the front's ES-module .js transpile to CommonJS on require
const transpile = (src) => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
const realTs = require.extensions['.ts'];
require.extensions['.ts'] = (m, f) => m._compile(transpile(fs.readFileSync(f, 'utf8')), f);
const realJs = require.extensions['.js'];
require.extensions['.js'] = (m, f) => {
  const src = fs.readFileSync(f, 'utf8');
  m._compile(f.includes(`${path.sep}skymp5-front${path.sep}`) ? transpile(src) : src, f);
};
let n = 0;
const compile = (src) => {
  const f = path.join(path.dirname(MODEL), `.harness-model-${process.pid}-${n++}.ts`);
  fs.writeFileSync(f, src);
  try { return require(f); } finally { fs.unlinkSync(f); }
};

const checks = (C, check) => {
  const cfg = C.configOf({ statPool: 20, disabledRaces: ['giant'], lockedRaces: ['akaviri'], allowChildren: false });
  let s = C.initialState();
  const run = (key, value) => { const r = C.act(s, cfg, key, value); s = r.state; return r; };
  const actions = (v) => v.sections.flatMap((x) => x.rows).filter((r) => r.key).map((r) => r.key);

  check('starts on Species with Next off', s.step === 1 && C.view(s, cfg).next === false && C.view(s, cfg).back === false);
  run('next');
  check('...Next does nothing without a species', s.step === 1);
  run('species', 'nope');
  check('...an unknown species is refused', s.species === null);
  run('species', 'human'); run('next');
  check('a species then Next reaches Race', s.step === 2 && s.species === 'human');
  check('...Next is off and does nothing without a race', C.view(s, cfg).next === false && C.act(s, cfg, 'next').state.step === 2);
  const raceRow = C.view(s, cfg).sections[0].rows[0];
  check('...the disabled race is not offered, the locked one is shown as locked', !raceRow.options.some((o) => o.v === 'giant') && raceRow.options.some((o) => o.v === 'akaviri' && o.off));
  run('race', 'akaviri');
  check('...a locked race is refused', s.race === null);
  run('race', 'giant');
  check('...a disabled race is refused', s.race === null);
  run('race', 'altmer');
  check('...a race of another species is refused', s.race === null);
  let r = run('race', 'nord');
  check('...a race sets its default look, no preview before Identity', s.race === 'nord' && s.look.parts.eyes !== null && r.preview === false);
  run('next');
  check('Identity next', s.step === 3);
  run('age', 'child');
  check('...the child age is refused unless allowChildren', s.age === 'adult' && !C.view(s, cfg).sections[0].rows[3].options.some((o) => o.v === 'child'));
  r = run('sex', 'female');
  check('...sex changes and previews', s.sex === 'female' && r.preview === true);
  run('stat:strength', 5); run('stat:strength', 5); run('stat:endurance', 5); run('stat:intelligence', 5); run('stat:agility', 5);
  check('...the stat pool of 20 holds', require(path.join(ROOT, '../skymp5-front/src/features/charCreator/data/stats.js')).pointsSpent(s.stats) === 20, s.stats);
  run('stat:strength', -100);
  check('...a stat never drops below the minimum', s.stats.strength === 10, s.stats);
  run('next');
  check('Appearance next; it offers head parts, face shape, colours and body', s.step === 4 && ['part:hair', 'preset:0', 'morph:0', 'skin', 'muscle'].every((k) => actions(C.view(s, cfg)).includes(k)), actions(C.view(s, cfg)));
  const hairBefore = s.look.parts.hair;
  r = run('part:hair', 1);
  check('...a part carousel moves and previews', s.look.parts.hair !== hairBefore && r.preview === true);
  run('morph:0', 100);
  check('...a morph stays within -1..1', s.look.morphs[0] === 1);
  run('next');
  check('Story next, Finish off with no name', s.step === 5 && C.view(s, cfg).finish.on === false);
  for (const [name, ok] of [['A', false], ['Bob1', false], ["'-", false], ['x'.repeat(31), false], ['  Ulfric Storm-Cloak  ', true], ["Ma'jhad", true]]) {
    check(`...name ${JSON.stringify(name.slice(0, 12))} ${ok ? 'accepted' : 'refused'}`, (C.nameError(name) === null) === ok);
  }
  run('name', 'x'.repeat(50));
  check('...a typed name is cut at 30', s.name.length === 30);
  run('name', 'Bob1');
  r = run('finish');
  check('...Finish with a bad name sends nothing', r.save === null && !s.waiting);
  run('name', '  Hjalti  '); run('backstory', 'b'.repeat(5000));
  r = run('finish');
  const keys = ['race', 'sex', 'age', 'stats', 'bodyExtras', 'appearance', 'name', 'backstory', 'description'];
  check('...Finish sends the browser payload with the trimmed name', !!r.save && JSON.stringify(Object.keys(r.save)) === JSON.stringify(keys) && r.save.name === 'Hjalti' && r.save.backstory.length === 4000 && r.save.appearance.name === 'Hjalti', r.save && Object.keys(r.save));
  check('...and waits: Finish off, Back off, no second save', s.waiting && C.view(s, cfg).finish.waiting && !C.view(s, cfg).back && C.act(s, cfg, 'finish').save === null);
  check('...while waiting nothing else changes', C.act(s, cfg, 'name', 'Other').state.name === s.name && C.act(s, cfg, 'back').state.step === 5);
  s = C.refused(s, 'Name taken.');
  check('a refusal shows the reason and offers Finish again', !s.waiting && C.view(s, cfg).finish.on && C.view(s, cfg).sections[0].rows.some((x) => x.tone === 'error' && x.text === 'Name taken.'));
  run('back');
  check('Back steps back', s.step === 4);
  // every key the panel can send is one act() takes
  const seen = new Set();
  let probe = C.initialState();
  for (const [k, v] of [['species', 'human'], ['next'], ['race', 'nord'], ['next'], ['next'], ['warpaint', 1], ['next']]) {
    probe = C.act(probe, cfg, k, v).state;
    actions(C.view(probe, cfg)).forEach((a) => seen.add(a));
  }
  check('the view names only actions the model knows', [...seen].every((k) => /^(species|race|sex|age|stat:\w+|part:\w+|preset:\d+|morph:\d+|skin|hair|lip|warpaint|paint|opacity|muscle|fat|name|backstory|description)$/.test(k)), [...seen]);
};

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!ok) failures++; };
checks(compile(SRC), check);

const MUTANTS = [
  ['the stat pool is ignored', ' || (n > 0 && M.pointsSpent(stats) >= c.statPool)', ''],
  ['a locked race can be chosen', 'if (r && !c.lockedRaces.includes(r.id))', 'if (r)'],
  ['children without allowChildren', '(c.allowChildren || value !== "child")', 'true'],
  ['Finish ignores the name rules', 'if (s.step !== 5 || nameError(s.name) || !race) break;', 'if (s.step !== 5 || !race) break;'],
  ['Finish can be sent twice', 'if (s.waiting) return', 'if (false) return'],
  ['the name is not trimmed', 'const name = s.name.trim();', 'const name = s.name;'],
  ['Race passes without a race', 'if (s.step === 2) return !!s.race && !c.lockedRaces.includes(s.race);', 'if (s.step === 2) return true;'],
];
for (const [name, from, to] of MUTANTS) {
  if (!SRC.includes(from)) { check(`mutant "${name}": its line is still in creatorModel.ts`, false, from); continue; }
  let bad = 0;
  try { checks(compile(SRC.replace(from, to)), (_n, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}

require.extensions['.ts'] = realTs;
require.extensions['.js'] = realJs;
void Module;
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* busy */ }
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
