// listable.js: who may be named in a list of the people near a player (fac-0553, 31 Oct: menus listed invisible GMs by name
// and #TAG). Its rule against a stub mp, and every module with such a list passing its people through it.
// node tests/listable-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };

const props = new Map();
const mp = { get: (id, k) => { if (props.get(`${id}|throw`)) throw new Error('gone'); return props.get(`${id}|${k}`); } };
const L = require(path.join(ROOT, 'listable.js'))(mp);
const PLAYER = 1, OTHER = 2, INVIS_GM = 3, GHOST_GM = 4, SPELL = 5, GM = 6, OFF = 7, GONE = 8;
props.set(`${INVIS_GM}|ff_adminModes`, { god: false, invis: true, ghost: false, rank: 2 });
props.set(`${GHOST_GM}|ff_adminModes`, { invis: false, ghost: true, rank: 2 });
props.set(`${SPELL}|ff_spellInvis`, { on: true, n: 7 });
props.set(`${GM}|ff_adminModes`, { invis: false, ghost: false, rank: 3 });
props.set(`${OFF}|ff_adminModes`, { invis: false, ghost: false, god: true, rank: 2 });
props.set(`${OFF}|ff_spellInvis`, { on: false, n: 9 });
props.set(`${GONE}|throw`, true);

ok(L(PLAYER, OTHER), 'a player is named to a player');
ok(!L(PLAYER, INVIS_GM), 'an invisible GM is not named to a player');
ok(!L(PLAYER, GHOST_GM), 'nor a GM in Ghost mode');
ok(!L(PLAYER, SPELL), 'nor a player under an Invisibility spell');
ok(L(PLAYER, OFF), 'a GM with only other modes on (god), and a spell that ended, are named');
ok(L(PLAYER, GM), 'a visible GM is named');
ok(L(GM, INVIS_GM) && L(GM, GHOST_GM) && L(GM, SPELL), 'staff are shown everyone, as their client draws them');
ok(L(INVIS_GM, OTHER) && L(INVIS_GM, SPELL), 'an invisible staff member viewing is staff too');
ok(L(PLAYER, GONE) && !L(GONE, INVIS_GM), 'an actor whose properties cannot be read is named, and is no staff viewer');
props.set(`${PLAYER}|ff_adminModes`, { invis: false, ghost: false });
ok(!L(PLAYER, INVIS_GM), 'a mirror without a rank is not staff');

// Every list of people nearby goes through it
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const LOADS = /require\(f\)\(mp\)/;
const uses = [
  ['decor.js', /out\.nearby = onlineActors\(\)\.filter\([^\n]*listable\(a, x\)/],
  ['jail.js', /const candidates = \(guard, door\) => onlineActors\(\)\s*\.filter\([^\n]*listable\(guard, p\)/],
  ['mines.js', /const nearby = \(a\) => onlineActors\(\)\.filter\([^\n]*listable\(a, t\)/],
  ['spells.js', /const students = onlineActors\(\)\.filter\([^\n]*listable\(a, p\)/],
  ['spells.js', /const studentsAt = [^\n]*listable\(a, b\)/],
  ['scribing.js', /const coWriters = [^\n]*listable\(a, b\)/],
];
for (const [f, re] of uses) ok(LOADS.test(src(f)) && /listable\.js/.test(src(f)) && re.test(src(f)), `${f} filters its list of people nearby through listable.js`);
// decor's people view shows public names, never who() (the profile number and the Discord mention)
ok(!/name: who\(x\)/.test(src('decor.js')) && /publicDisplay/.test(src('gamemode.js').match(/require\(DECOR_JS\)\([^\n]*/)[0]), 'decor gets publicDisplay from gamemode.js and lists no one by who()');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
