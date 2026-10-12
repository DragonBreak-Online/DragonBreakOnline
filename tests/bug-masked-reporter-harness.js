// A /bug from behind a mask names the character for staff (D15, 11 Oct): debugsnap.js titled the report by the name shown,
// so three #bug-tracker threads read "Masked Person #VKRS", "#8KWH" and "#LLX8" and staff had to work out who sent them.
// The BUGREPORT line and the snapshot now carry the character's own name and why it is hidden ("Raven (masked) #VKRS"),
// in the shape dbo-monitor reads (its bugreport_re, taken from the monitor's own source); the player's reply never names
// them; the log lines saved with it are the reporter's, not every masked player's. Runs the real playermenu.js and
// debugsnap.js together.
//   node tests/bug-masked-reporter-harness.js   (from server/)
//   PLAYERMENU=... DEBUGSNAP=... point at other copies (the old ones fail the D15 checks); DBO_MONITOR_PY at another monitor
'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path');
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) { pass++; console.log('ok  ', what); } else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };

// dbo-monitor's own pattern for the line, read from its source so a change there shows up here
const monitorPy = process.env.DBO_MONITOR_PY || path.resolve(__dirname, '..', 'tooling', 'dbo-monitor', 'dbo_monitor.py');
const reSrc = (fs.readFileSync(monitorPy, 'utf8').match(/^bugreport_re = re\.compile\(r'(.*)'\)$/m) || [])[1];
ok(!!reSrc, 'dbo-monitor\'s bugreport_re is found in ' + path.basename(monitorPy), reSrc);
const bugreportRe = new RegExp(reSrc || '^$');
const monitorWho = (line) => { const m = bugreportRe.exec(line); return m ? { who: m[1], snap: m[2], text: m[3] } : null; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-masked-reporter-'));
const logFile = path.join(dir, 'server.log');
const stamp = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace('T', ' ').slice(0, 19);
fs.writeFileSync(logFile, [
  `[${stamp(40000)}.000] [info] [gamemode] told Raven The Shield #VKRS (x1): Your stall is open.`,
  `[${stamp(30000)}.000] [info] [gamemode] clientState Masked Person #VKRS journal open`,
  `[${stamp(20000)}.000] [info] [gamemode] told Masked Person #ZZZZ (x1): someone else behind a mask`,
  `[${stamp(10000)}.000] [info] [gamemode] clientState Werewolf #QQQQ journal closed`, ''].join('\n'));

const DEFAULT_MASK = 0xfe00b808, P = 0xff000021, Q = 0xff000022, R = 0xff000023;
const TAGS = { [P]: 'VKRS', [Q]: 'ZZZZ', [R]: 'LLX8' };
const DESCS = { '808:Armors of the Velothi Pt2.esp': DEFAULT_MASK };
const inv = new Map(), props = new Map();
const nameShown = (a) => (props.get(`${a}|appearance`) || {}).name;
const mp = {
  get: (a, k) => {
    if (k === 'inventory') return inv.get(a);
    if (k === 'pos') return [0, 0, 100];
    if (k === 'worldOrCellDesc') return 'w';
    if (k === 'actorNeighbors') return [];
    if (k === 'profileId') return { [P]: 38, [Q]: 39, [R]: 40 }[a];
    return props.get(`${a}|${k}`);
  },
  set: (a, k, v) => { if (k === 'inventory') inv.set(a, v); else props.set(`${a}|${k}`, v); },
  getIdFromDesc: (d) => DESCS[d] || 0, getDescFromId: (id) => id.toString(16),
  callPapyrusFunction: () => {}, lookupEspmRecordById: () => ({ record: { editorId: 'NordRace' } }), getHoster: () => 0,
};
const nameOf = (a) => nameShown(a) || 'Stranger';
const tagOf = (a) => TAGS[a] || '????';
const display = (a) => `${nameOf(a)} #${tagOf(a)}`;   // gamemode.js display()
const said = [], logs = [], ui = new Map(), timers = [], cmds = {};
const savedTimeout = global.setTimeout;
const give = (a, b, n) => { const x = inv.get(a) || { entries: [] }; const es = x.entries.map((q) => Object.assign({}, q)); const h = es.find((q) => q.baseId === b && !q.worn); if (h) h.count += n; else es.push({ baseId: b, count: n }); inv.set(a, { entries: es }); return true; };
const base = { mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push({ a, t: String(t) }), display, nameOf, tagOf, onlineActors: () => [P, Q, R], cfg: { playerMenu: {}, debugSnap: { dir, logFile } } };

global.setTimeout = (fn) => { timers.push(fn); return 0; };
require(path.resolve(__dirname, '..', process.env.PLAYERMENU || 'playermenu.js'))(Object.assign({}, base, {
  system: () => {}, onUi: (n, fn) => ui.set(n, fn), sendPacket: () => {}, profileOf: (a) => mp.get(a, 'profileId'), isAdmin: () => false,
  ranksOf: () => [], giveItem: give, makeProp: () => {}, runCommand: () => {}, every: () => {}, registerChatCommand: () => {},
}));
global.setTimeout = savedTimeout;
require(path.resolve(__dirname, '..', process.env.DEBUGSNAP || 'debugsnap.js'))(Object.assign({}, base, {
  every: () => {}, registerChatCommand: (n, f) => { cmds[n] = f; }, profileOf: (a) => mp.get(a, 'profileId'),
  isAdmin: () => true,   // staff skip the one-a-minute limit, so one reporter can send every case below
}));
const press = (a) => { globalThis.__dboMaskToggledAt.clear(); global.setTimeout = (fn) => { timers.push(fn); return 0; }; ui.get('maskToggle')(a); while (timers.length) timers.shift()(); global.setTimeout = savedTimeout; };
// One /bug: the BUGREPORT line, the snapshot it names, and what the player was told
const report = (a, text) => {
  logs.length = 0; said.length = 0;
  cmds.bug(a, text);
  const line = logs.find((l) => l.startsWith('BUGREPORT ')) || '';
  const m = monitorWho(line);
  const snap = m ? JSON.parse(fs.readFileSync(path.join(dir, 'bugs', m.snap), 'utf8')) : null;
  return { line, m, snap, told: said.map((s) => s.t).join(' ') };
};

props.set(`${P}|appearance`, { name: 'Raven The Shield', raceId: 1 }); inv.set(P, { entries: [] });
props.set(`${Q}|appearance`, { name: 'Masked Person', raceId: 1 }); props.set(`${Q}|maskName`, 'Quill');
props.set(`${R}|appearance`, { name: 'Masked Person', raceId: 1 });

// Unmasked: as before, the name shown is the character's own
let r = report(P, 'the wolf near me is floating');
ok(r.m && r.m.who === 'Raven The Shield #VKRS' && r.m.text === 'the wolf near me is floating', 'unmasked: the line is as it was, "Raven The Shield #VKRS"', r.line);
ok(r.snap && r.snap.by === 'Raven The Shield #VKRS' && !('shownAs' in r.snap) && r.snap.profileId === 38, '...and the snapshot names them the same, nothing added', r.snap && { by: r.snap.by, shownAs: r.snap.shownAs });

// Masked (H): players see a Masked Person; staff get the character
press(P);
ok(nameShown(P) === 'Masked Person' && props.get(`${P}|maskName`) === 'Raven The Shield', 'H masks: the name shown is Masked Person (playermenu.js unchanged)', nameShown(P));
r = report(P, 'my horse fell through the bridge');
ok(!!r.m, 'masked: dbo-monitor still reads the line (reporter, snapshot file, text)', r.line);
ok(r.m && r.m.who === 'Raven The Shield (masked) #VKRS', '...the reporter, and so the #bug-tracker thread title, is "Raven The Shield (masked) #VKRS", not "Masked Person #VKRS"', r.m && r.m.who);
ok(r.m && /-VKRS\.json$/.test(r.m.snap) && r.m.text === 'my horse fell through the bridge', '...with the snapshot file and the whole text', r.m);
ok(r.snap && r.snap.by === 'Raven The Shield (masked) #VKRS' && r.snap.shownAs === 'Masked Person #VKRS', '...the snapshot\'s by is the same, shownAs keeps what players saw', r.snap && { by: r.snap.by, shownAs: r.snap.shownAs });
ok(r.snap && r.snap.profileId === 38 && r.snap.view.name === 'Masked Person #VKRS', '...profileId is unchanged for the launcher match; the view keeps the shown name (its NPC hosts are named so too)', r.snap && [r.snap.profileId, r.snap.view.name]);
ok(/staff team has your report/.test(r.told) && !/Raven/.test(r.told), 'the player\'s own reply never names them', r.told);
ok(r.snap && r.snap.log.some((l) => l.includes('told Raven The Shield #VKRS')) && r.snap.log.some((l) => l.includes('clientState Masked Person #VKRS')),
  '...the saved log lines are theirs: by their own name from before the mask and by the mask name with their #TAG', r.snap && r.snap.log);
ok(r.snap && !r.snap.log.some((l) => l.includes('#ZZZZ')), '...and not another masked player\'s (the bare "Masked Person" picked those up)', r.snap && r.snap.log);

// Masked, then a beast: the appearance is the beast's, the real name still in maskName
globalThis.__dboBeastName = (a) => (a === P ? 'Werewolf' : '');
props.set(`${P}|private.beast`, { form: 'werewolf', original: { name: 'Masked Person', raceId: 1 } }); props.set(`${P}|appearance`, { name: 'Werewolf', raceId: 1 });
r = report(P, 'stuck as a wolf');
ok(r.m && r.m.who === 'Raven The Shield (masked, Werewolf form) #VKRS', 'masked and in a beast form: "Raven The Shield (masked, Werewolf form) #VKRS"', r.m ? r.m.who : r.line);
ok(r.snap && r.snap.shownAs === 'Werewolf #VKRS' && !r.snap.log.some((l) => l.includes('#QQQQ')), '...shownAs is the beast, and another beast\'s lines stay out', r.snap && r.snap.shownAs);

// A beast with no mask: the look kept at the change holds the name
props.set(`${P}|maskName`, ''); props.set(`${P}|private.beast`, { form: 'werewolf', original: { name: 'Raven The Shield', raceId: 1 } });
r = report(P, 'claws clip the door');
ok(r.m && r.m.who === 'Raven The Shield (Werewolf form) #VKRS', 'a beast form alone: "Raven The Shield (Werewolf form) #VKRS"', r.m ? r.m.who : r.line);
delete globalThis.__dboBeastName; props.delete(`${P}|private.beast`); props.set(`${P}|appearance`, { name: 'Raven The Shield', raceId: 1 });

// The real name already lost behind a mask (#LLX8, D1): nothing to give back, staff are told so
r = report(R, 'my name is Masked Person now');
ok(r.m && r.m.who === 'Masked Person (own name lost) #LLX8', 'name lost behind a mask: "Masked Person (own name lost) #LLX8", for a /rename', r.m ? r.m.who : r.line);
ok(r.snap && !r.snap.log.some((l) => l.includes('#ZZZZ') || l.includes('#VKRS')), '...and the bare mask name is no needle for its log lines either', r.snap && r.snap.log);

// Another masked player: their own kept name
r = report(Q, 'masked and the trader ignores me');
ok(r.m && r.m.who === 'Quill (masked) #ZZZZ' && r.snap.log.some((l) => l.includes('#ZZZZ')) && !r.snap.log.some((l) => l.includes('#VKRS')), 'a second masked reporter gets their own name and lines', r.m && [r.m.who, r.snap.log]);

// Without playermenu.js (it failed to load): the name shown, as before
const keep = globalThis.__dboStaffName; delete globalThis.__dboStaffName;
r = report(Q, 'no player menu this time');
ok(r.m && r.m.who === 'Masked Person #ZZZZ' && !('shownAs' in r.snap), 'no playermenu.js: falls back to the name shown', r.m && r.m.who);
// A name with '#' or a line break cannot break the line or the monitor's reading of it
globalThis.__dboStaffName = () => 'Odd #ABCD\nName (masked)';
r = report(Q, 'odd name test');
ok(r.m && r.m.who === 'Odd ABCD Name (masked) #ZZZZ' && !/\n/.test(r.line), 'a "#" or line break in the name is flattened before it reaches the line', r.m ? r.m.who : r.line);
globalThis.__dboStaffName = keep;

fs.rmSync(dir, { recursive: true, force: true });
delete globalThis.__dboDebugSnap; delete globalThis.__dboStaffName;
console.log(`${pass}/${pass + fail} passed`);
process.exitCode = fail ? 1 : 0;
