// A check of one journal tab asks only that tab (17 Oct). The X menu asks whether the journal's Settings shows
// (playermenu.js journalSettings -> __dboJournalHasTab -> tabOk) on every press while voice is on; tabOk found it in the
// whole tab list, so every press built every tab, the Magic one included, and the Magic one read the viewer's whole
// learned spell list (seconds for a character with hundreds of spells). Real journal.js and playermenu.js with a mock
// gamemode api, and sections that count every visible() asked of them. Checks:
//   Settings' check, and the X menu, ask no other tab;
//   any one tab's check asks that tab and the sections it hosts, nothing else;
//   every check gives the same answer as the drawn tab list, in each state the tab list knows (hidden, a badge, a hosted
//   section showing its tab, a staff member reading another's journal, which never shows their Settings);
//   the tab list a draw sends is unchanged.
//
//   node tests/journal-tab-check-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
process.chdir(root);
let failures = 0, checks = 0;
const check = (name, ok, got) => { checks++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!ok) failures++; };

let now = 1_900_000_000_000;
Date.now = () => now;
global.setTimeout = () => 0;

const HUB = 0xff000040, OLD = 0xff000041, STAFF = 0xff000042;
const props = new Map();
for (const [a, name] of [[HUB, 'Aela'], [OLD, 'Farkas'], [STAFF, 'Kodlak']]) {
  props.set(`${a}|appearance`, { name, raceId: 0x13746 });
  props.set(`${a}|locationalData`, { pos: [0, 0, 0], cellOrWorldDesc: 'tamriel', rot: [0, 0, 0] });
}
const TABS = ['journal', 'journalHub', 'journalTab:settings', 'journalTab:magic', 'journalTab:court', 'journalTab:skills', 'journalTab:deity', 'journalTab:extra'];
const caps = new Map([[HUB, new Set(TABS)], [STAFF, new Set(TABS)], [OLD, new Set(['journal', 'playerMenu'])]]);
const widgets = [], packets = [];
const ui = new Map();
const onUi = (ev, fn) => { const l = ui.get(ev) || []; l.push(fn); ui.set(ev, l); };
const fire = (ev, a, args) => { for (const fn of ui.get(ev) || []) fn(a, args, 0); };
const last = (a) => (widgets.filter((x) => x.a === a).pop() || {}).w;
const online = [HUB, OLD, STAFF];
const mp = { get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v), getIdFromDesc: () => 0, getDescFromId: (id) => String(id),
  lookupEspmRecordById: (id) => (id === 0x13746 ? { record: { editorId: 'NordRace' } } : null) };
globalThis.__dboJournalDoc = { of: () => ({}), touch: () => {} };
globalThis.__dboClock = { summary: () => ({ hour: 12, day: 1, month: 'Morning Star', year: 211, phaseName: '' }) };
delete globalThis.__dboJournal;
delete globalThis.__dboJournalSections;
globalThis.__dboMagicOpen = undefined;

// Every visible() asked, by tab. The Magic tab's view stands for its spell list read (schools.js magicTabOf)
const asked = [];
const state = { magic: true, court: false, skills: { badge: 2 }, deity: true, extra: true, factionStaff: false, faction: null };
let magicViews = 0;
globalThis.__dboMagicView = (a) => { magicViews++; asked.push('magic(view)'); return { open: !!state.magic }; };
globalThis.__dboFactionTabInfo = (a) => { asked.push('faction'); return state.faction; };
globalThis.__dboSuperProgress = (a) => { asked.push('supernatural'); return null; };
const nameOf = (a) => (props.get(`${a}|appearance`) || {}).name || '';
const staffSet = new Set([STAFF]);
require(path.resolve('journal.js'))({ mp, log: () => {}, personal: () => {}, display: (a) => `#${(a >>> 0).toString(16)}`, nameOf,
  openWidget: (a, w, focus) => widgets.push({ a, w, focus }), closeWidget: () => {}, onUi, sendPacket: () => {}, every: () => {}, onlineActors: () => online,
  cfg: {}, skills: JSON.parse(fs.readFileSync('skills.json', 'utf8')).skills, isAdmin: (a) => staffSet.has(a), hasCap: (a, c) => !!(caps.get(a) && caps.get(a).has(c)) });
require(path.resolve('playermenu.js'))({ mp, log: () => {}, personal: () => {}, system: () => {}, onUi, sendPacket: (a, p) => packets.push([a, p]),
  display: (a) => `#${(a >>> 0).toString(16)}`, nameOf, tagOf: (a) => (a >>> 0).toString(16).slice(-4).toUpperCase(), profileOf: (a) => a, onlineActors: () => online,
  isAdmin: (a) => staffSet.has(a), ranksOf: () => [], giveItem: () => {}, makeProp: () => {}, runCommand: () => {}, cfg: {}, every: () => {}, registerChatCommand: () => {} });
// The other modules' tabs, as they register them (court.js, journalskills.js, prayer.js), one unknown to ORDER, and a
// section hosted inside Faction (guilds.js factionStaff)
const S = globalThis.__dboJournalSections;
const spy = (id) => (a) => { asked.push(id); return state[id]; };
S.court = { visible: spy('court'), view: () => ({}) };
S.skills = { visible: spy('skills'), view: () => ({}) };
S.deity = { visible: spy('deity'), view: () => ({}), label: () => 'Deity' };
S.extra = { visible: spy('extra'), view: () => ({}) };
S.factionStaff = { tab: 'faction', visible: spy('factionStaff'), view: () => ({}) };

const reset = () => { asked.length = 0; magicViews = 0; };
const hasTab = (a, id) => globalThis.__dboJournalHasTab(a, id);

// ---- Settings, and the X menu that asks for it ----
reset();
check('Settings shows to its own player', hasTab(HUB, 'settings') === true);
check('...and finding that out asks no other tab (no Magic view, so no spell list read)', asked.length === 0 && magicViews === 0, asked);
globalThis.__dboVoiceEnabled = true;
reset();
fire('playerMenu', HUB, [OLD]);
const menu = (packets.filter(([a, p]) => a === HUB && p.customPacketType === 'dboPlayerMenu').pop() || [])[1];
check('an X press with voice on offers "Voice settings for <name>…"', !!menu && menu.entries.some((e) => e.id === 'voice:settings'), menu && menu.entries);
check('...and asks no journal tab at all', asked.length === 0 && magicViews === 0, asked);

// ---- one tab asks only itself (and what it hosts) ----
for (const id of ['magic', 'court', 'skills', 'deity', 'extra', 'supernatural']) {
  reset();
  hasTab(HUB, id);
  const own = id === 'magic' ? ['magic(view)'] : [id];
  check(`the ${id} tab's check asks only the ${id} tab`, JSON.stringify(asked) === JSON.stringify(own), asked);
}
reset();
hasTab(HUB, 'faction');
check('the Faction tab\'s check asks Faction and the section it hosts, nothing else', asked.every((x) => x === 'faction' || x === 'factionStaff') && asked.includes('faction'), asked);

// ---- the same answers as the drawn tab list ----
const drawnTabs = (a, viewOf) => {
  if (viewOf) globalThis.__dboJournalOpenFor(a, viewOf, 'profile'); else globalThis.__dboJournalOpenTab(a, 'profile');
  const w = last(a);
  return w && Array.isArray(w.tabs) ? w.tabs.map((t) => t.id) : null;
};
const IDS = ['profile', 'faction', 'court', 'stats', 'skills', 'magic', 'deity', 'supernatural', 'extra', 'settings', 'factionStaff', 'nonsense', '__proto__', 'constructor'];
const states = [
  ['as registered', {}],
  ['Magic closed, Court open', { magic: false, court: true }],
  ['Faction empty but its hosted staff section showing', { faction: { member: 0, invites: 0, staff: false }, factionStaff: true }],
  ['Faction empty and nothing hosted', { faction: { member: 0, invites: 0, staff: false }, factionStaff: false }],
  ['every optional tab hidden', { magic: false, court: false, skills: false, deity: false, extra: false }],
];
for (const [label, change] of states) {
  Object.assign(state, change);
  const tabs = drawnTabs(HUB);
  const answers = IDS.map((id) => [id, hasTab(HUB, id) === true, !!tabs && tabs.includes(id)]);
  check(`${label}: each tab's check says what the drawn tab list shows`, !!tabs && answers.every(([, a, b]) => a === b), answers.filter(([, a, b]) => a !== b));
}
// A staff member reading another's journal: the viewer's front decides what can be drawn, the subject what shows, and
// another's Settings never shows (journalTab clicks inside it go through the same check)
Object.assign(state, { magic: true, court: true, faction: null });
const theirs = drawnTabs(STAFF, HUB);
const st = (globalThis.__dboJournal.open.get(STAFF) || {});
// (a second apart: the tab answers' flood gap is 120 ms)
const clicks = ['settings', 'magic', 'court', 'profile'].map((id) => { now += 1000; widgets.length = 0; fire('journalTab', STAFF, [st.nonce, id]); const w = last(STAFF); return [id, w ? w.tab : null]; });
check('reading another\'s journal: no Settings among its tabs', !!theirs && !theirs.includes('settings') && theirs.includes('magic'), theirs);
check('...and a Settings click in it is refused while the others open', clicks.find(([id]) => id === 'settings')[1] !== 'settings'
  && clicks.filter(([id]) => id !== 'settings').every(([id, tab]) => tab === id), clicks);

// ---- the drawn tab list is as it was: order, labels, badges, Settings pinned last ----
Object.assign(state, { magic: true, court: true, skills: { badge: 2 }, deity: true, extra: true, faction: null, factionStaff: false });
globalThis.__dboJournalOpenTab(HUB, 'profile');
const tabs = last(HUB).tabs;
check('the tab list a draw sends: every tab in order, the unknown one before Settings, Settings pinned last',
  tabs.map((t) => t.id).join() === 'profile,faction,court,stats,skills,magic,deity,extra,settings' && tabs[tabs.length - 1].pinned === true, tabs);
check('...with each label and badge', tabs.find((t) => t.id === 'skills').badge === '2' && tabs.find((t) => t.id === 'deity').label === 'Deity' && tabs.find((t) => t.id === 'magic').label === 'Magic', tabs);
check('an older front (no hub) is never told it has a Settings tab', hasTab(OLD, 'settings') === false);

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
