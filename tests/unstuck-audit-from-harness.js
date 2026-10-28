// /unstuck's audit line must say where the player was stuck. It read worldOrCellDesc after the move, so every line named
// the respawn's world: the Bleak-Frost Mine report ("Stuck in Iron Cave", Masked Person #EWLC, 4 Oct 09:16, cell 177fb6)
// ended in "UNSTUCK ... from a764b:BSHeartland.esm" at 09:41, like all 695 UNSTUCK lines in the live log. Runs the real
// /unstuck command cut from gamemode.js on stubs. Since 13 Oct (Nate): anyone, every 30 minutes, never within a minute of
// a fight, PvE included.
//   node tests/unstuck-audit-from-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const start = src.indexOf("const unstuckActor = (a, by, refs = '') => {");
const end = src.indexOf('\nconst setDeathTemple', start);
if (start < 0 || end < 0) { console.log('FAIL  the /unstuck markers are gone from gamemode.js'); process.exit(1); }
const cmdSrc = src.slice(start, end);

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const MINE = '177fb6:DragonBreak Online Edits.esp';
const A = 0xff0021dd;
const props = { worldOrCellDesc: MINE, pos: [-2165.4, 2440.2, -426.7], isDead: false, 'private.restrained': null, 'private.unstuckAt': 0 };
const mp = {
  get: (a, k) => props[k],
  set: (a, k, v) => { if (k === 'locationalData') { props.worldOrCellDesc = v.cellOrWorldDesc; props.pos = v.pos; } else props[k] = v; },
};
const audits = [], told = [];
let handler = null;
const UNSTUCK = eval('(' + /const UNSTUCK = Object\.assign\((\{[^}]*\})/.exec(src)[1] + ')');
const pvpAt = new Map(), combatAt = new Map();
new Function('registerChatCommand', 'staffCan', 'mp', 'globalThis', 'pvpAt', 'combatAt', 'UNSTUCK', 'findByName', 'display', 'personal', 'zoneOfActor', 'templeZoneOf', 'templeFor', 'log', 'audit', 'who', 'creationPending', 'GATE_CREATION_LINE', 'staffTargetOf', 'userOf', 'remoteLine', 'remoteBy', cmdSrc)(
  (name, fn) => { if (name === 'unstuck') handler = fn; }, () => false, mp, {}, pvpAt, combatAt, UNSTUCK, () => 0, () => 'Masked Person',
  (a, t) => told.push(t), () => 'bruma', () => 'bruma', () => ({ world: 'a764b:BSHeartland.esm', pos: [59151, 201645, 7559], rotZ: 0 }), () => {}, (t) => audits.push(t), () => 'Masked Person #EWLC (profile 60)',
  () => false, 'unfinished', () => 0, () => 1, null, () => ''); // a finished character, online, typed in game (tests/unstuck-creation-harness.js covers one in creation)
ok(typeof handler === 'function', '/unstuck registers');
ok(UNSTUCK.cooldownMinutes === 30 && UNSTUCK.combatSeconds === 60, 'the defaults are 30 minutes and a minute after a fight', UNSTUCK);
combatAt.set(A, Date.now() - 20000);
handler(A, '');
ok(props.worldOrCellDesc === MINE && told.some((t) => /cannot use \/unstuck in combat/.test(t)), 'a fight with a creature 20 s ago refuses it', told);
combatAt.set(A, Date.now() - 61000); told.length = 0;
handler(A, '');
ok(props.worldOrCellDesc === 'a764b:BSHeartland.esm', 'the player is moved to the Bruma respawn', props.worldOrCellDesc);
ok(audits.length === 1 && audits[0].includes(MINE), 'the audit names the cell they were stuck in (the mine), not the respawn', audits);
ok(audits.length === 1 && /-2165,2440,-427/.test(audits[0]), '...and where in it, rounded', audits);
ok(audits.length === 1 && /to the bruma respawn/.test(audits[0]), '...and still says where they went', audits);
told.length = 0; audits.length = 0;
props['private.unstuckAt'] = Date.now() - 29 * 60000;
handler(A, '');
ok(audits.length === 0 && told.some((t) => /ready again in 1 minute\./.test(t)), 'the 30-minute cooldown still holds at 29 minutes', { audits, told });
props['private.unstuckAt'] = Date.now() - 31 * 60000;
handler(A, '');
ok(audits.length === 1, 'and lets it through at 31', audits);

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
