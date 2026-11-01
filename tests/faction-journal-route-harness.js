// Panel 37 (guilds.js openMenu) goes to the Character Journal's Faction tab on a client that has one (census item 2, 1 Nov):
// with the journal open its tab is redrawn; with it closed the journal is opened on that tab first and then drawn with the
// answer, the payload carrying the nonce the tab holds; a front without the tab still gets panel 37; and a war answer
// (__dboFactionRefresh) for a journal client whose journal has closed goes to the chat instead of opening it again. Real
// guilds.js and the live guild-defs.json, stub journal and api, in a temp folder.
//
//   node tests/faction-journal-route-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GUILDS = path.join(ROOT, 'guilds.js');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-factionroute-'));
fs.copyFileSync(path.join(ROOT, 'guild-defs.json'), path.join(dir, 'guild-defs.json'));
for (const f of ['zones.json', 'skills.json']) {
  try { fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)); } catch (e) { /* optional */ }
}
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!cond) fails++; };

const HUB = 0x14, OLD = 0x15;
const NAMES = { [HUB]: 'Hub', [OLD]: 'Old' };
const drawn = [], told = [], commands = {};
const props = new Map();
const api = {
  mp: { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v) },
  log: () => {}, personal: (a, t) => told.push([a, t]), system: (a, t) => told.push([a, t]), audit: () => {}, staffNote: () => {},
  registerChatCommand: (n, f, o) => { commands[n] = { f, o }; }, onUi: () => {},
  openWidget: (a, p) => drawn.push({ a, p }), closeWidget: () => {},
  who: (a) => `${NAMES[a]} (profile ${a})`, display: (a) => NAMES[a] || 'x', nameOf: (a) => NAMES[a] || 'x', tagOf: (a) => `T${a}`,
  onlineActors: () => Object.keys(NAMES).map(Number), isAdmin: () => false, isLeadStaff: () => false,
  findByName: () => 0, findAnyByName: () => 0, profileOf: (a) => a, cfg: CFG,
};

// The journal as guilds.js sees it: HUB's front has the Faction tab; opening it draws the tab with a fresh faction payload
const J = { open: new Set(), opened: [], redrawn: [] };
globalThis.__dboJournalHasTab = (a, tab) => (a >>> 0) === HUB && tab === 'faction';
globalThis.__dboJournalIsOpen = (a) => J.open.has(a >>> 0);
globalThis.__dboJournalOpenTab = (a, tab) => {
  if (!globalThis.__dboJournalHasTab(a, tab)) return false;
  J.open.add(a >>> 0); J.opened.push(tab);
  J.redrawn.push(globalThis.__dboFactionPayload(a, false));
  return true;
};
globalThis.__dboJournalFaction = (a, p) => { if (!J.open.has(a >>> 0)) return false; J.redrawn.push(p); return true; };

delete globalThis.__dboGuildState;
require(GUILDS)(api);

// a journal client, journal closed: the journal opens on Faction, then is drawn with the answer; panel 37 never opens
globalThis.__dboFactionMenu(HUB);
ok('closed journal: opened on the Faction tab', J.opened.length === 1 && J.opened[0] === 'faction', J.opened);
ok('...then drawn with the menu payload, no panel 37', J.redrawn.length === 2 && drawn.length === 0, { r: J.redrawn.length, d: drawn.length });
const shown = J.redrawn[J.redrawn.length - 1];
ok('...and the drawn payload\'s nonce is the one the tab holds', globalThis.__dboFactionNonceOk(HUB, shown.nonce), shown.nonce);

// journal open: redrawn in place, not opened again
globalThis.__dboFactionMenu(HUB);
ok('open journal: redrawn, not opened again', J.opened.length === 1 && J.redrawn.length === 3 && drawn.length === 0);
ok('a war answer while it is open redraws it', globalThis.__dboFactionRefresh(HUB, 'Done.', true) === true && J.redrawn.length === 4 && J.redrawn[3].result === 'Done.', J.redrawn[3] && J.redrawn[3].result);

// journal closed again: a war answer goes to the chat, the journal is not reopened for it
J.open.delete(HUB);
ok('closed journal: a war answer is left to the chat', globalThis.__dboFactionRefresh(HUB, 'Done.', true) === false && J.opened.length === 1 && drawn.length === 0);

// a front without the journal tab still gets panel 37, and its war answers redraw it
globalThis.__dboFactionMenu(OLD);
ok('no journal tab: panel 37', drawn.length === 1 && drawn[0].a === OLD && J.opened.length === 1);
ok('...and a war answer redraws panel 37', globalThis.__dboFactionRefresh(OLD, 'Refused.', false) === true && drawn.length === 2);

// /faction on a journal client opens the tab (as before)
J.open.delete(HUB);
commands.faction.f(HUB, '');
ok('/faction: the journal tab', J.opened.length === 2 && drawn.length === 2);

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
