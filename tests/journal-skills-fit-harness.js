// The Skills tab's Blacksmithing page fitted to what a native journal takes (journalskills.js fitNative; live 3 Nov:
// [native-size] journal:skills sent 68-71k chars to the browser for about one open in eight after paging).
// The payload here is shaped like the real one: 18 skills with their rules, a craft tier 3 smith, 32 families of
// recipe names. With a client checkout it also draws the result in the native journal (swf/dbo_journal skills.as).
//   node tests/journal-skills-fit-harness.js      (env DBO_CLIENT_DIR: a skymp5-client checkout, for the drawing)
'use strict';
const fs = require('fs');
const path = require('path');
let fails = 0, oks = 0;
const ok = (c, what, d) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && d !== undefined ? '   ' + JSON.stringify(d).slice(0, 300) : ''}`); if (c) oks++; else fails++; };

const NATIVE = 0x14, BROWSER = 0x15;
const NATIVE_MAX = 60000; // gamemode.js NATIVE_MAX_CHARS, the whole widget
const LOGS = [];
globalThis.__dboJournalSections = undefined;
globalThis.__dboPanelState = { native: new Map([[NATIVE, new Set(['native:journal', 'native:journalTab:skills'])]]) };
const sk = (id, i) => ({ id, category: 'profession', label: 'Skill ' + i, title: 'the Skill ' + i, description: ('Rule of skill ' + i + '. ').repeat(40),
  tiers: ['t0', 't1', 't2', 't3', 't4'], lore: ('Lore ' + i + '. ').repeat(30), tierLore: ['a', 'b', 'c', 'd', 'e'] });
const IDS = ['blacksmith', 'fighter', 'arcane'].concat(Array.from({ length: 15 }, (_, i) => 'skill' + i));
globalThis.__alduinakMasteryMenu = () => ({ skills: IDS.map(sk), points: { enabled: true, held: [{ id: 'blacksmith', level: 60, xp: 10 }] } });
// 32 families over tiers 1-7, 40 recipe names each; tiers 1-3 reached, tier 1-2 families known, one tier 5 family known
const fams = Array.from({ length: 32 }, (_, i) => {
  const tier = 1 + (i % 7);
  return { id: 'fam' + i, name: 'Family ' + i, tier, known: tier <= 2 || i === 4, how: tier <= 2 ? 'book' : null, canMake: 0,
    learnHint: tier <= 2 ? '' : 'from a schematic', recipes: Array.from({ length: 40 }, (_, r) => `Family ${i} Recipe Number ${r}`) };
});
const SMITH = { tier: 3, tierName: 'Adept', tierNames: ['Novice', 'Journeyman', 'Adept', 'Expert', 'Master', 'Grandmaster', 'Legend'], points: 400, nextAt: 800,
  families: fams, apprentice: null, upgradeRule: 'An item improves up to two tier steps above its own.' };
globalThis.__dboSmithView = () => JSON.parse(JSON.stringify(SMITH));
globalThis.__dboSchoolsBrief = () => ({ schools: [] });
require(path.resolve(__dirname, '..', 'journalskills.js'))({ log: (...m) => LOGS.push(m.join(' ')), onUi: () => {} });
const view = (a, focus) => globalThis.__dboJournalSections.skills.view(a, focus ? { focus: { skill: focus } } : {});
// The widget the gamemode sends around the section (journal.js hub): the shell is a few hundred characters
const widget = (skills) => ({ type: 'journal', id: 50, nonce: 'n1234567', hub: 1, tabs: [{ id: 'profile', label: 'Profile' }, { id: 'skills', label: 'Skills' }], tab: 'skills', opened: 1,
  clock: { date: 'Morndas, 26th of Frostfall', time: '14:05', moons: 'Masser full' }, head: { name: 'Olaf', title: 'Wanderer', race: 'Nord' }, skills });
const size = (o) => JSON.stringify(o).length;

const browser = view(BROWSER);
ok(size(widget(browser)) > NATIVE_MAX, 'the fixture is the live case: the whole Blacksmithing page passes what a native panel takes', size(widget(browser)));
ok(browser.smith.families.every((f) => Array.isArray(f.recipes) && f.recipes.length === 40), 'the browser journal keeps every family\'s recipe names, as before');

const v = view(NATIVE);
ok(v.paged === true && !!v.smith, 'a native journal on Blacksmithing\'s page (the highest held skill) gets the smith view, paged', Object.keys(v));
ok(size(widget(v)) <= NATIVE_MAX, '...and the widget fits what a native panel takes', size(widget(v)));
const byId = new Map(v.smith.families.map((f) => [f.id, f]));
const kept = fams.filter((f) => f.known && f.tier <= 3);
ok(kept.every((f) => (byId.get(f.id).recipes || []).length === 40), 'a known family within the craft tier keeps every recipe name (Learned recipes stays whole)', kept.map((f) => f.id));
const gone = fams.filter((f) => !f.known && f.tier > 3);
ok(gone.every((f) => !('recipes' in byId.get(f.id))), 'unknown families past the craft tier lose their names first', gone.filter((f) => 'recipes' in byId.get(f.id)).map((f) => f.id));
ok(v.smith.families.every((f) => f.name && 'known' in f && 'learnHint' in f && 'tier' in f), '...every family keeps its name, tier, known and how it is learned');
ok(v.smith.families.length === fams.length && v.smith.tier === 3 && v.skills.length === IDS.length, 'nothing else is cut: every family, the tier, every skill');
ok(LOGS.some((l) => /Blacksmithing's page \d+ -> \d+ chars for a native journal, \d+ families without recipe names$/.test(l)), 'the trim is logged with both sizes', LOGS);

// A small smith page goes as it is
const small = Object.assign({}, SMITH, { families: fams.slice(0, 3) });
globalThis.__dboSmithView = () => JSON.parse(JSON.stringify(small));
const s = view(NATIVE);
ok(s.smith.families.every((f) => Array.isArray(f.recipes) && f.recipes.length === 40), 'a page that fits is sent untouched', s.smith.families.map((f) => (f.recipes || []).length));
globalThis.__dboSmithView = () => JSON.parse(JSON.stringify(SMITH));

// Drawn by the native journal as the client has it (skills.as since 26 Oct, in 0.3.115)
const clientDir = [process.env.DBO_CLIENT_DIR, path.resolve(__dirname, '../../slay-client/skymp5-client'), path.resolve(__dirname, '../../../fork/skymp5-client')]
  .find((d) => d && fs.existsSync(path.join(d, 'swf/dbo_journal/tabs/skills.as')) && fs.existsSync(path.join(d, 'tests/native-swf-stub.js')));
if (!clientDir) {
  console.log('SKIP  the native drawing (set DBO_CLIENT_DIR to a skymp5-client checkout with swf/dbo_journal)');
} else {
  const S = require(path.join(clientDir, 'tests/native-swf-stub.js'));
  const t = S.boot('dbo_journal');
  t.push(widget(Object.assign({}, v, { focus: 'blacksmith' })));
  const P = t.root.dboPanel;
  const pages = () => Object.values(P.body.flowClip.kids);
  const all = [];
  for (const p of pages()) { const walk = (c) => { for (const x of Object.values(c.kids)) { if (typeof x.text === 'string' && !x.kids) all.push(x.text); else if (x.kids) walk(x); } }; walk(p); }
  const tx = all.join('|');
  ok(/Craft tier 3/.test(tx) && /Learned recipes\|Family 0 Recipe Number 0, /.test(tx), 'the native journal draws the page: the craft tier and the learned recipe names', tx.slice(0, 300));
  ok(all.includes('Family 6') && !/Family 6 Recipe Number/.test(tx) && /Family 2: from a schematic  -  Family 2 Recipe Number 0/.test(tx),
    '...a family past the tier as one locked line without names; one within it still with its hint and names', all.filter((x) => /^Family [26]\b/.test(x)));
}

console.log(fails ? `\n${fails} failed` : `\nall passed (${oks})`);
process.exit(fails ? 1 : 0);
