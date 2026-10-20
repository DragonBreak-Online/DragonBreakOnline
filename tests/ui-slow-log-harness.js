// A player's UI events are timed like timers (17 Oct). An X press ran 14 s and 13 queued presses held the main loop
// 3 minutes, and nothing in the log said which event or who: only timers were timed (slow tick lines). gamemode.js now
// times each onUi handler and F3's journal open, and one slower than SLOW_UI_MS (250 ms, cfg.debug.slowUiMs) logs
//   slow ui <event> <name #tag> (<actor hex>): <ms> ms
// The relay's dispatch, F3's branch and the helper are cut out of gamemode.js as they are written there and run against
// a mock clock (performance.now).
//
//   node tests/ui-slow-log-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
let failures = 0, checks = 0;
const check = (name, ok, got) => { checks++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!ok) failures++; };
const cut = (from, to, label, optional) => {
  const a = src.indexOf(from); const b = a < 0 ? -1 : src.indexOf(to, a + from.length);
  if (a < 0 || b < 0) { if (optional) return null; console.log(`FAIL the ${label} markers are gone`); process.exit(1); }
  return src.slice(a, b);
};
const dispatch = cut("    if (content.customPacketType === 'dbo') {", '    // The client saw a beast power cast', 'relay dispatch');
const f3 = cut("    if (content.customPacketType === 'factionMenuRequest') {", '    // Mirror admin panel actions (F7)', 'F3 request');
// A build without the timing has no helper: its handlers run untimed, and the checks below say so
const helper = cut('const SLOW_UI_MS', 'const stopTimer', 'ui timing helper', true) || 'const uiTimed = (event, a, fn) => fn();';

const A = 0xff000040;
const logs = [], capped = [];
let mono = 0;
const clock = { now: () => mono };
const make = () => new Function('content', 'userId', 'actorOf', 'logCapped', 'log', 'display', 'cfg', 'performance',
  `${helper}\n${dispatch}\n${f3}`).bind(null);
const run = (content, cfg) => make()(content, 7, () => A, (...a) => capped.push(a.join(' ')), (...a) => logs.push(a.join(' ')), (a) => `Aela #AB12`, cfg || {}, clock);

globalThis.__dboUiEvents = new Map();
const on = (ev, fn) => { const l = globalThis.__dboUiEvents.get(ev) || []; l.push(fn); globalThis.__dboUiEvents.set(ev, l); };
const slowLines = () => logs.filter((l) => /^slow ui /.test(l));

// ---- onUi handlers ----
on('playerMenu', () => { mono += 13712.4; });
on('quick', () => { mono += 12; });
on('throws', () => { mono += 400; throw new Error('kaboom'); });
on('two', () => { mono += 3; });
on('two', () => { mono += 300; });

run({ customPacketType: 'dbo', event: 'playerMenu', args: [1] });
check('a slow handler logs its event, the player and how long it took', slowLines().length === 1 && slowLines()[0] === 'slow ui playerMenu Aela #AB12 (ff000040): 13712.4 ms', logs);
logs.length = 0;
run({ customPacketType: 'dbo', event: 'quick', args: [] });
check('a quick one logs nothing', slowLines().length === 0, logs);
logs.length = 0; capped.length = 0;
run({ customPacketType: 'dbo', event: 'throws', args: [] });
check('a slow handler that throws is still timed', slowLines().length === 1 && /^slow ui throws Aela #AB12 \(ff000040\): 400\.0 ms$/.test(slowLines()[0]), logs);
check('...and its failure still goes to the capped "ui event failed" line, as before', capped.some((l) => /ui event failed throws kaboom/.test(l)), capped);
logs.length = 0;
run({ customPacketType: 'dbo', event: 'two', args: [] });
check('each handler of an event is timed on its own: only the slow one is logged', slowLines().length === 1 && /: 300\.0 ms$/.test(slowLines()[0]), logs);
logs.length = 0;
run({ customPacketType: 'dbo', event: 'quick', args: [] }, { debug: { slowUiMs: 5 } });
check('the threshold is cfg.debug.slowUiMs', slowLines().length === 1 && /^slow ui quick .*: 12\.0 ms$/.test(slowLines()[0]), logs);

// ---- F3 ----
let opened = 0, factionPanel = 0;
globalThis.__dboFactionMenu = () => { factionPanel++; };
globalThis.__dboJournalRequest = () => { opened++; mono += 27000; return true; };
logs.length = 0;
run({ customPacketType: 'factionMenuRequest' });
check('F3 opening the journal slowly is logged as F3', opened === 1 && factionPanel === 0 && slowLines().length === 1 && /^slow ui F3 Aela #AB12 \(ff000040\): 27000\.0 ms$/.test(slowLines()[0]), logs);
globalThis.__dboJournalRequest = () => { opened++; mono += 4; return false; };
logs.length = 0;
run({ customPacketType: 'factionMenuRequest' });
check('...a quick F3 logs nothing, and a client without the journal still gets the faction panel', slowLines().length === 0 && factionPanel === 1, { logs, factionPanel });

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
