// The Skills tab's Wheel rule (feature queue 12; Nat 7 Nov approved the wording): one sentence from the menu's own numbers,
// in the native tab's All skills list (swf/dbo_journal tabs/skills.as) and under the Wheel in the browser tab
// (skymp5-front features/journal/skillsTab.tsx, bundled here with esbuild when the fork has it). The mutants must each fail.
//   node tests/journal-wheel-rule-harness.js        (ESBUILD_MODULES=<node_modules with esbuild> when the fork's is not beside this client)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();

const TABS = [{ id: 'profile', label: 'Profile' }, { id: 'skills', label: 'Skills' }];
const hub = (skills) => ({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tabs: TABS, tab: 'skills', opened: 1, clock: { date: 'd', time: 't' }, head: { name: 'Olaf', title: 'J', race: 'Nord' }, skills });
const P = (t) => t.root.dboPanel;
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids || {})) { if (typeof x.text === 'string') out.push(x.text); if (x.kids) walk(x); } }; walk(P(t).body); return out.join('|'); };
const textIn = (c) => { let out = typeof c.text === 'string' ? c.text : ''; for (const x of Object.values(c.kids || {})) out += '|' + textIn(x); return out; };
const allSkills = (t) => { let hit = null; const walk = (c) => { for (const x of Object.values(c.kids || {})) { if (!hit && typeof x.onRelease === 'function' && /All skills/.test(textIn(x))) hit = x; if (x.kids) walk(x); } }; walk(P(t).body); if (hit) hit.onRelease(); return !!hit; };
const sk = (id, label) => ({ id, category: 'profession', label, title: 'the ' + label, description: label + ' rule.', tiers: ['t0', 't1', 't2', 't3', 't4'], lore: '', tierLore: [] });
const LIVE = { enabled: true, pool: 300, capPerSkill: 100, seatAbove: 90, seatCount: 1, expertAbove: 75, expertCount: 3, used: 40, offers: [], held: [{ id: 'fighter', level: 40, xp: 37, tier: 1, lock: 'raise' }] };
const OTHER = Object.assign({}, LIVE, { pool: 600, seatCount: 2, expertAbove: 50, expertCount: 4 });
const skills = (points) => ({ tierNames: ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'], skills: [sk('fighter', 'Fighting'), sk('blacksmith', 'Blacksmithing')], chosen: [], points });
const RULE = 'Your Wheel holds 300 points; each skill reaches 100. One skill may go above 90, three above 75. When the Wheel is full, a new gain takes from a skill marked Lower; Hold keeps a skill where it is; Raise lets it grow.';
const RULE2 = 'Your Wheel holds 600 points; each skill reaches 100. Two skills may go above 90, four above 50.';

const native = (boot, c) => {
  const t = boot();
  t.push(hub(skills(LIVE)));
  allSkills(t);
  c('native: All skills carries the Wheel rule, word for word', texts(t).includes(RULE), texts(t).slice(0, 400));
  const u = boot();
  u.push(hub(skills(OTHER)));
  allSkills(u);
  c('native: ...its numbers come from the menu', texts(u).includes(RULE2), texts(u).slice(0, 400));
  const v = boot();
  v.push(hub(skills(Object.assign({}, LIVE, { enabled: false }))));
  allSkills(v);
  c('native: no rule when the point system is off', !/Your Wheel holds/.test(texts(v)));
};
native(() => S.boot('dbo_journal'), T.check);

// The browser tab, when esbuild and the front are beside this client
const ROOT = path.resolve(__dirname, '..', '..');
// esbuild's own package (ESBUILD_MODULES: a node_modules holding it, when the fork's is not beside this client)
const ES = [process.env.ESBUILD_MODULES || '', path.join(ROOT, 'skymp5-server', 'node_modules'), path.join(ROOT, 'skymp5-front', 'node_modules')].filter(Boolean).find((d) => fs.existsSync(path.join(d, 'esbuild', 'package.json')));
const TAB = path.join(ROOT, 'skymp5-front', 'src', 'features', 'journal', 'skillsTab.tsx');
let FRONT = '';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-wheel-'));
if (ES && fs.existsSync(TAB)) {
  const entry = path.join(OUT, 'entry.tsx');
  fs.writeFileSync(entry, `export * from '${TAB.replace(/\\/g, '/')}';\nexport { renderToStaticMarkup } from 'react-dom/server';\nexport { createElement } from 'react';\n`);
  try {
    require(path.join(ES, 'esbuild')).buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', loader: { '.js': 'jsx', '.scss': 'empty', '.png': 'empty', '.svg': 'empty' },
      outfile: path.join(OUT, 'tab.js'), logLevel: 'error', nodePaths: [path.join(ROOT, 'skymp5-front', 'node_modules')] });
    FRONT = fs.readFileSync(path.join(OUT, 'tab.js'), 'utf8');
  } catch (e) { T.check('the front Skills tab bundles', false, String(e.stderr || e.message).slice(0, 300)); }
}
const front = (src, c) => {
  const f = path.join(OUT, `t-${Math.random().toString(36).slice(2)}.js`); fs.writeFileSync(f, src);
  const M = require(f);
  const html = (points) => M.renderToStaticMarkup(M.createElement(M.SkillsTab, { section: skills(points), sections: {}, nonce: 'n', busy: false, act: () => {}, openTab: () => {} }));
  const plain = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ');
  c('front: the rule sits under the Wheel, word for word', /journal-skills__wheel-rule/.test(html(LIVE)) && plain(html(LIVE)).includes(RULE), plain(html(LIVE)).slice(0, 300));
  c('front: ...its numbers come from the menu', plain(html(OTHER)).includes(RULE2));
  c('front: no rule when the point system is off', !/Your Wheel holds/.test(html(Object.assign({}, LIVE, { enabled: false }))));
};
if (FRONT) front(FRONT, T.check); else console.log('ok   front check skipped: no esbuild or front beside this client');

const read0 = fs.readFileSync;
const AS = path.resolve(__dirname, '..', 'swf', 'dbo_journal', 'tabs', 'skills.as');
const MUTANTS = [
  ['native', 'native: the rule left out', '   if (rule != "")\n   {\n      flowHint(rule);', '   if (false)\n   {\n      flowHint(rule);'],
  ['native', 'native: a fixed expert count', 'skillsWord(Number(p.expertCount)) + " above "', '"three above "'],
  ['front', 'front: the rule left out', 'wheelRule(points) ?', 'false ?'],
  ['front', 'front: a fixed seat count', 'n === 1 ? "One skill"', 'true ? "One skill"'],
];
for (const [side, name, a, b] of MUTANTS) {
  if (side === 'front' && !FRONT) continue;
  const src = side === 'native' ? read0(AS, 'utf8').replace(/\r\n/g, '\n') : FRONT;
  if (!src.includes(a)) { T.check(`mutant "${name}": its text is there`, false, a); continue; }
  let bad = 0;
  if (side === 'native') {
    fs.readFileSync = function (f, ...rest) { return /tabs[\\/]skills\.as$/.test(String(f)) ? src.split(a).join(b) : read0.call(fs, f, ...rest); };
    try { native(() => S.boot('dbo_journal'), (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
    fs.readFileSync = read0;
  } else {
    try { front(src.split(a).join(b), (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  }
  T.check(`mutant caught: ${name}`, bad > 0);
}
fs.rmSync(OUT, { recursive: true, force: true });
T.done();
