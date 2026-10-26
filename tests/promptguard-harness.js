// Unasked prompts wait while a player is busy (promptguard.js; Nat, 26 Oct: "Notifications like prompts like that shouldn't
// appear in dungeons because it disrupts people"). The module against a stub, then each prompt that opens unasked asks it:
// the birthsign picker (birthsigns-harness drives it), the level-points menu, the apprenticeship, /teach, college-ledger
// and co-writing offers. The silver test and a class's spell stay as they are.
//   node tests/promptguard-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (what, c, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const cells = new Map([[1, '1a2b:Skyrim.esm'], [2, '0001A2B:skyrim.esm'], [3, '3c:Skyrim.esm'], [4, '3c:Skyrim.esm']]);   // verify-formids: ignore - made-up cells for the stub, on purpose
const mp = { get: (a, k) => (k === 'worldOrCellDesc' ? cells.get(a) : undefined) };
globalThis.__dboDungeonCells = new Set(['1a2b:skyrim.esm']);   // verify-formids: ignore - a made-up dungeon cell
globalThis.__dboCombatAt = new Map([[4, Date.now() - 5000]]);
globalThis.__dboIsDowned = (a) => a === 3;
const G = require(path.join(SERVER, 'promptguard.js'))({ mp, cfg: {} });
ok('a player standing in a dungeon cell is busy: "in a dungeon"', G.busy(1) === 'in a dungeon', G.busy(1));
ok('...whatever the cell desc\'s case and leading zeros', G.busy(2) === 'in a dungeon', G.busy(2));
ok('a downed player is busy: "downed"', G.busy(3) === 'downed');
ok('one who fought 5 s ago is busy: "fighting"', G.busy(4) === 'fighting');
globalThis.__dboCombatAt.set(4, Date.now() - 31000);
ok('...and is not 31 s later (fightSeconds 30)', G.busy(4) === '');
ok('one in an ordinary cell, standing, not fighting, is not busy', G.busy(5) === '' && G.busy(3) !== '');
ok('the refusal line names the reason', G.busyLine('Ana', 'in a dungeon') === 'Ana is in a dungeon. Ask again when they are clear of it.' && /is in a fight/.test(G.busyLine('Ana', 'fighting')) && /is down/.test(G.busyLine('Ana', 'downed')));
const OFF = require(path.join(SERVER, 'promptguard.js'))({ mp, cfg: { promptGuard: { enabled: false } } });
ok('promptGuard.enabled false: nobody is busy', OFF.busy(1) === '' && OFF.busy(3) === '');
require(path.join(SERVER, 'promptguard.js'))({ mp, cfg: {} });

// Every prompt that opens unasked asks the guard before it opens
const src = (f) => fs.readFileSync(path.join(SERVER, f), 'utf8');
const ASK = "globalThis.__dboPromptBusy(";
const around = (f, anchor, n = 900) => { const s = src(f); const i = s.indexOf(anchor); return i < 0 ? '' : s.slice(Math.max(0, i - n), i + 80); };
ok('gamemode.js loads promptguard.js', /require\(PROMPTGUARD_JS\)\(\{ mp, cfg \}\)/.test(src('gamemode.js')));
ok('birthsigns.js: the forced picker waits in a dungeon', /__dboPromptBusy\(a >>> 0\) : ''\) === 'in a dungeon'\) return 'dungeon';/.test(src('birthsigns.js')));
ok('charlevel.js: the level-points menu opens unasked only when the player is not busy', around('charlevel.js', "openWidget(a, { type: 'contextMenu', id: WIDGET_ID, mode: 'menu', targetName: `Level ").includes(`if (!focus && (typeof globalThis.__dboPromptBusy === 'function' ? ${ASK}a >>> 0)`));
ok('schools.js: an apprenticeship offer to a busy player is refused to the teacher', around('schools.js', "openWidget(t, { type: 'contextMenu', id: APPRENTICE_MENU_ID").includes(`${ASK}t >>> 0)`));
ok('spells.js: a /teach offer to a busy student is refused', around('spells.js', "offers.set(student >>> 0, { teacher: teacher >>> 0, spellId, at: Date.now() });", 400).includes(`${ASK}student >>> 0)`));
ok('spells.js: a college-ledger lesson to a busy student is refused', around('spells.js', "offers.set(student >>> 0, { teacher: a >>> 0, spellId: sp.id, at: Date.now(), college:", 600).includes(`${ASK}student >>> 0)`));
ok('scribing.js: a co-writing request to a busy helper is refused', around('scribing.js', 'S.offers.set(helper, { writer: a >>> 0', 600).includes(`${ASK}helper)`));
ok('the silver test and a class\'s spell are left as they were (no guard there)', !around('silvertest.js', "openWidget(t, { type: 'contextMenu', id: PROMPT_WIDGET_ID", 700).includes(ASK)
  && !around('spells.js', "offers.set(student >>> 0, { teacher: teacher >>> 0, spellId: sp.id, at: Date.now(), cls: true", 700).includes(ASK));
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
