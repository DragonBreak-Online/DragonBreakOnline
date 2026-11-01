// The admin panel's revamp (skymp5-front adminPanel, client-local widget 23; F3 design 3.10, piece H12): renders the real
// widget with React's static renderer. A left rail instead of top tabs, the "Acting on" strip on the tabs that act on
// somebody, the Players tab's character care (L1's diseases moved from Powers, the five school levels from the
// server's adminMastery detail), the one SearchBar, and a plain GM seeing none of the Lead GM buttons. Also the fuzzy
// matcher the searches use.
//
//   node tests/admin-panel-front-harness.js <bundle of skymp5-front/src/features/adminPanel/index.tsx>
//
// A front from before the revamp has nothing to test, which is said and not failed unless a gate expects it.
'use strict';
const fs = require('fs');

const bundle = process.argv[2];
if (!bundle) { console.log('usage: node tests/admin-panel-front-harness.js <bundle>'); process.exit(2); }
const SRC = fs.readFileSync(bundle, 'utf8');
if (!/admin-panel__rail/.test(SRC)) {
  require('./expect')('admin-panel-front', 'this front has no admin panel rail');
  console.log('ok   skipped: this front predates the admin panel revamp');
  process.exit(0);
}
const M = require(bundle);
const { Widget: AdminPanel, renderToStaticMarkup, createElement, PlayerCare, PowersTab, fuzzyScore, fuzzyFilter } = M;

let failures = 0;
const check = (label, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };
const render = (W, props) => renderToStaticMarkup(createElement(W, props));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const events = { close: 'admin::close', refresh: 'admin::refresh', action: 'admin::action', request: 'admin::request', tp: 'admin::tp', summon: 'admin::summon', kick: 'admin::kick', ban: 'admin::ban', masteryGrant: 'admin::masteryGrant', masteryReset: 'admin::masteryReset', npcList: 'admin::npcList' };
const players = [
  { a: 'ff000014', p: 12, n: 'Mira Valen', d: '1', dn: 'mira', ip: '10.0.x.x', hwid: 'h', online: true, ping: 40, b: { werewolf: false, vampirelord: false, form: null } },
  { p: 13, n: 'Offline Olaf', d: '2', dn: 'olaf', ip: '', hwid: '', online: false, ping: null },
];
const data = (extra) => Object.assign({ players, locations: [], modes: [], events, admin: true, tier: 'leadgm', caps: { ban: false, spawn: true }, me: { a: 'ff000010' },
  mastery: { profession: null, label: '', rank: 0, rankName: '', hours: 0 }, bans: [] }, extra || {});

// The rail's labels as drawn, top to bottom
const railOf = (h) => (h.match(/class="admin-panel__railitem[^"]*">([^<]+)</g) || []).map((x) => x.replace(/.*>/, '').replace('<', ''));
// The panel opens on Debug; staff with no tab list from the server see every tab the panel has, once each, Debug first
let html = render(AdminPanel, { data: data() });
const ALL = railOf(html);
check('the tabs are a left rail', /admin-panel__rail/.test(html) && !/admin-panel__tabs"/.test(html) && ALL.length > 1, ALL);
check('staff with no caps.tabs see every tab, once each, Debug first', ALL[0] === 'Debug' && new Set(ALL).size === ALL.length && ['Players', 'GM Calls', 'Modes'].every((l) => ALL.includes(l)), ALL);
check('Debug shows no Acting on strip', !/Acting on/.test(text(html)));
html = render(AdminPanel, { data: data({ admin: false }) });
check('a player sees only Debug', JSON.stringify(railOf(html)) === '["Debug"]', railOf(html));

// The Players tab's care: the PlayerCare part, rendered as the Players tab would
const detail = { skills: [], tierNames: [], tierHours: [], maxChosen: 3, schools: [
  { name: 'Restoration', level: 12, role: 'priest', roleLabel: 'Through Priest' }, { name: 'Destruction', level: 30, role: 'primary', roleLabel: 'Primary school' },
  { name: 'Alteration', level: 10, role: 'closed', roleLabel: 'Closed' }, { name: 'Conjuration', level: 0, role: 'closed', roleLabel: 'Closed' }, { name: 'Illusion', level: 0, role: 'closed', roleLabel: 'Closed' }] };
html = render(PlayerCare, { events, who: 'ff000014', selfId: 'ff000010', name: 'Mira Valen', masteryTarget: { name: 'Mira Valen', target: 'ff000014', detail }, canSpawn: true });
const t = text(html);
check('the diseases are on the Players tab now', /Sanguinare Vampiris/.test(t) && /Sanies Lupinus/.test(t) && /for Mira Valen/.test(t), t.slice(0, 300));
check('five schools in order, Alteration first and Restoration last', /Alteration.*Conjuration.*Destruction.*Illusion.*Restoration/.test(t) && (html.match(/admin-panel__school"/g) || []).length === 5, t);
check('each school shows its role and level, with a slider (no native select)', /Primary school/.test(t) && /value="30"/.test(html) && (html.match(/type="range"/g) || []).length === 5 && !/<select/.test(html), t.slice(0, 300));
check('Restoration follows Priest and cannot be set here', /follows Priest/.test(t) && (html.match(/disabled=""/g) || []).length >= 2);
check('four Set buttons for the four schools set here', (t.match(/\bSet\b/g) || []).length === 4, (t.match(/\bSet\b/g) || []).length);
html = render(PlayerCare, { events, who: 'ff000014', selfId: 'ff000010', name: 'Mira Valen', masteryTarget: { name: 'Someone', target: 'ff000099', detail }, canSpawn: true });
check('a late answer for another player is not shown as theirs', !/Primary school/.test(text(html)) && /Loading their schools/.test(text(html)));
html = render(PlayerCare, { events, who: '', selfId: 'ff000010', name: 'You', masteryTarget: { name: 'Lead', target: 'ff000010', detail }, canSpawn: true });
check('acting on yourself shows your own schools', /Primary school/.test(text(html)));
html = render(PlayerCare, { events, who: 'ff000014', selfId: 'ff000010', name: 'Mira Valen', masteryTarget: { name: 'Mira Valen', target: 'ff000014', detail: Object.assign({}, detail, { schools: undefined }) }, canSpawn: true });
check('without magic data (schools.js not loaded, or an older server) it says Magic data unavailable', /Magic data unavailable/.test(text(html)) && !/Not a mage yet/.test(text(html)));
html = render(PlayerCare, { events, who: 'ff000014', selfId: 'ff000010', name: 'Mira Valen', masteryTarget: { name: 'Mira Valen', target: 'ff000014', detail: Object.assign({}, detail, { schools: null }) }, canSpawn: true });
check('...the same for schools: null', /Magic data unavailable/.test(text(html)));
html = render(PlayerCare, { events, who: 'ff000014', selfId: 'ff000010', name: 'Mira Valen', masteryTarget: { name: 'Mira Valen', target: 'ff000014', detail: Object.assign({}, detail, { schools: [] }) }, canSpawn: true });
check('a character with no school opened reads Not a mage yet', /Not a mage yet/.test(text(html)) && !/Magic data unavailable/.test(text(html)));
check('a plain GM sees no character care at all', render(PlayerCare, { events, who: 'ff000014', selfId: '', name: 'Mira', masteryTarget: { name: 'Mira', target: 'ff000014', detail }, canSpawn: false }) === '');

// Powers: no disease row any more, and nothing to press for a plain GM
html = render(PowersTab, { events, who: 'ff000014', beast: { werewolf: true, vampirelord: false, form: null }, canSpawn: true });
check('Powers keeps grant, transform, revert, revoke and the spells for a Lead GM', /Grant power/.test(text(html)) && /Transform now/.test(text(html)) && /Give all spells/.test(text(html)) && !/Sanguinare/.test(text(html)));
html = render(PowersTab, { events, who: 'ff000014', beast: { werewolf: true, vampirelord: false, form: null }, canSpawn: false });
check('a plain GM sees the state but no power buttons (R-L1)', /power held/.test(text(html)) && !/Grant power|Transform now|Revert|Revoke|Give all spells|Give all shouts/.test(text(html)) && /Lead GM and above/.test(text(html)), text(html));

// The fuzzy matcher
check('fuzzy: a whole word at a word start beats one inside a word', fuzzyScore('iron', 'Iron Sword') > fuzzyScore('iron', 'Environs'));
check('fuzzy: letters in order match', fuzzyScore('dwrsw', 'Dwarven Sword') > 0 && fuzzyScore('xyz', 'Dwarven Sword') === 0);
check('fuzzy: every word must be found', fuzzyScore('steel dagger', 'Steel Dagger') > 0 && fuzzyScore('steel bow', 'Steel Dagger') === 0);
check('fuzzy: editor ids count (name + edid + form searched together)', fuzzyScore('armorsteel', 'Steel Armor ArmorSteelCuirassA 0x13952') > 0);
const list = ['Elven Bow', 'Bow of the Hunt', 'Bowl', 'Rainbow Trout'];
check('fuzzyFilter: best first, non-matches out', JSON.stringify(fuzzyFilter(list, 'bow', (x) => x)) === JSON.stringify(['Bow of the Hunt', 'Bowl', 'Elven Bow', 'Rainbow Trout']), fuzzyFilter(list, 'bow', (x) => x));
check('fuzzyFilter: empty text keeps the list as it is', fuzzyFilter(list, '  ', (x) => x) === list);

// A Trial GM (11 Oct): the server's caps.tabs and caps.actions decide what is drawn. A front from before it skips this part
if (/allowedActions/.test(SRC)) {
  const trialCaps = { ban: false, spawn: false, trial: true, tabs: ['debug', 'players', 'modes'], actions: ['teleportTo', 'rename'] };
  // The rule: Debug, the tabs the gamemode answers itself (GM Calls: gmcall.js checks each action's rights), and the tabs
  // the server's caps.tabs names, in the panel's own order; anything else is hidden
  const expect = (labels) => ALL.filter((l) => l === 'Debug' || (ALL.includes('GM Calls') && l === 'GM Calls') || labels.includes(l));
  html = render(AdminPanel, { data: data({ tier: 'trialgm', caps: trialCaps, mastery: null }) });
  check('a Trial GM sees Debug, GM Calls and the tabs caps.tabs names (Players, Modes), in the panel\'s order', JSON.stringify(railOf(html)) === JSON.stringify(expect(['Players', 'Modes'])), railOf(html));
  html = render(AdminPanel, { data: data({ tier: 'trialgm', caps: Object.assign({}, trialCaps, { tabs: [] }), mastery: null }) });
  check('...an empty caps.tabs leaves Debug and GM Calls only', JSON.stringify(railOf(html)) === JSON.stringify(expect([])), railOf(html));
  html = render(AdminPanel, { data: data({ tier: 'trialgm', caps: Object.assign({}, trialCaps, { tabs: ['debug', 'players', 'no-such-tab'] }), mastery: null }) });
  check('...a tab id the panel does not have is ignored', JSON.stringify(railOf(html)) === JSON.stringify(expect(['Players'])), railOf(html));
  html = render(AdminPanel, { data: data({ tier: 'leadgm' }) });
  check('...staff without caps.tabs still see every tab', JSON.stringify(railOf(html)) === JSON.stringify(ALL));
  html = render(AdminPanel, { data: data({ admin: false, caps: trialCaps }) });
  check('...and a player with a tab list still sees only Debug', JSON.stringify(railOf(html)) === '["Debug"]', railOf(html));
} else {
  console.log('note  no Trial GM part to test: this front predates it');
}

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
