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
new Function('registerChatCommand', 'staffCan', 'mp', 'globalThis', 'pvpAt', 'combatAt', 'UNSTUCK', 'findByName', 'display', 'personal', 'zoneOfActor', 'templeZoneOf', 'templeFor', 'log', 'audit', 'who', 'creationPending', 'GATE_CREATION_LINE', 'staffTargetOf', 'userOf', 'remoteLine', 'remoteBy', 'findAnyByName', cmdSrc)(
  (name, fn) => { if (name === 'unstuck') handler = fn; }, () => false, mp, {}, pvpAt, combatAt, UNSTUCK, () => 0, () => 'Masked Person',
  (a, t) => told.push(t), () => 'bruma', () => 'bruma', () => ({ world: 'a764b:BSHeartland.esm', pos: [59151, 201645, 7559], rotZ: 0 }), () => {}, (t) => audits.push(t), () => 'Masked Person #EWLC (profile 60)',
  () => false, 'unfinished', () => 0, () => 1, null, () => '', () => 0); // a finished character, online, typed in game (tests/unstuck-creation-harness.js covers one in creation)
ok(typeof handler === 'function', '/unstuck registers');
ok(UNSTUCK.cooldownMinutes === 35 && UNSTUCK.combatSeconds === 60 && UNSTUCK.pvpSeconds === 120, 'the defaults are 35 minutes, a minute after a fight and 2 minutes after a PvP blow (Nat, 31 Oct)', UNSTUCK);
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
props['private.unstuckAt'] = Date.now() - 34 * 60000;
handler(A, '');
ok(audits.length === 0 && told.some((t) => /ready again in 1 minute\./.test(t)), 'the 35-minute cooldown still holds at 34 minutes', { audits, told });
props['private.unstuckAt'] = Date.now() - 36 * 60000;
handler(A, '');
ok(audits.length === 1, 'and lets it through at 36', audits);

// A PvP blow keeps it shut for 2 minutes (the combat logout timer): no way out of a pursuit (Nat, 31 Oct)
props['private.unstuckAt'] = 0; props.worldOrCellDesc = MINE; told.length = 0; audits.length = 0;
pvpAt.set(A, Date.now() - 90000);
handler(A, '');
ok(audits.length === 0 && props.worldOrCellDesc === MINE && told.some((t) => /so soon after a fight with another player\. Try again in 30 seconds/.test(t)), 'a PvP blow 90 s ago refuses it, with the 30 s left', told);
pvpAt.set(A, Date.now() - 121000); told.length = 0;
handler(A, '');
ok(audits.length === 1, 'and 2 minutes after it, it works', audits);

// A player's own goes to the nearest town (gamemode.js __dboUnstuckTown); its line and audit name the town
{
  const p2 = { worldOrCellDesc: MINE, pos: [0, 0, 0], isDead: false, 'private.restrained': null, 'private.unstuckAt': 0 };
  const mp2 = { get: (a, k) => p2[k], set: (a, k, v) => { if (k === 'locationalData') { p2.worldOrCellDesc = v.cellOrWorldDesc; p2.pos = v.pos; } else p2[k] = v; } };
  const told2 = [], audits2 = []; let h2 = null;
  const G = { __dboUnstuckTown: () => ({ name: 'Riverwood', world: '3c:Skyrim.esm', pos: [1, 2, 3], rotZ: 0 }) };
  new Function('registerChatCommand', 'staffCan', 'mp', 'globalThis', 'pvpAt', 'combatAt', 'UNSTUCK', 'findByName', 'display', 'personal', 'zoneOfActor', 'templeZoneOf', 'templeFor', 'log', 'audit', 'who', 'creationPending', 'GATE_CREATION_LINE', 'staffTargetOf', 'userOf', 'remoteLine', 'remoteBy', 'findAnyByName', cmdSrc)(
    (name, fn) => { if (name === 'unstuck') h2 = fn; }, () => false, mp2, G, new Map(), new Map(), UNSTUCK, () => 0, () => 'Olaf',
    (a, t) => told2.push(t), () => 'bruma', () => 'bruma', () => ({ world: 'a764b:BSHeartland.esm', pos: [59151, 201645, 7559], rotZ: 0 }), () => {}, (t) => audits2.push(t), () => 'Olaf #AAAA (profile 1)',
    () => false, 'unfinished', () => 0, () => 1, null, () => '', () => 0);
  h2(A, '');
  ok(p2.worldOrCellDesc === '3c:Skyrim.esm' && String(p2.pos) === '1,2,3', 'a player\'s own /unstuck goes to the nearest town, not the temple', p2);
  ok(told2.some((t) => /You find your way to Riverwood\./.test(t)) && audits2.some((t) => /to Riverwood/.test(t)), '...and says and audits which town', { told2, audits2 });
}

// __dboUnstuckTown itself: the nearest capital, town or village marker in the world they are in, or last were outside in
{
  const src2 = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
  const a0 = src2.indexOf('const UNSTUCK_TOWNS = '), a1 = src2.indexOf("const unstuckActor = (a, by, refs = '') => {", a0);
  ok(a0 > 0 && a1 > a0, 'gamemode.js has the town finder');
  const terr = { territories: [
    { name: 'Riverwood', kind: 'town', marker: { world: '3c:Skyrim.esm', pos: [100, 0, 5] } },
    { name: 'Whiterun', kind: 'capital', marker: { world: '3c:Skyrim.esm', pos: [5000, 0, 9] } },
    { name: 'Fort Greymoor', kind: 'fort', marker: { world: '3c:Skyrim.esm', pos: [0, 10, 1] } },
    { name: 'Bruma', kind: 'capital', marker: { world: 'a764b:BSHeartland.esm', pos: [0, 0, 0] } }] };
  const P3 = {};
  const fsStub = { readFileSync: () => JSON.stringify(terr) };
  const norm = (d) => String(d).toLowerCase();
  const G3 = {};
  // No temples here, so every town keeps its marker (tests/unstuck-city-world-harness.js covers the walled capitals)
  const FRAME = new Set(['3c:skyrim.esm', '1a26f:skyrim.esm', '1691d:skyrim.esm', '16bb4:skyrim.esm', '16d71:skyrim.esm', '37edf:skyrim.esm']);
  new Function('fs', 'path', 'log', 'mp', 'globalThis', 'isWorldspace', 'normPlace', 'TEMPLES', 'TAMRIEL_FRAME', src2.slice(a0, a1))(
    fsStub, path, () => {}, { get: (a, k) => P3[k] }, G3, (w) => /:skyrim\.esm$|:bsheartland\.esm$/i.test(w) && !/^177fb6/.test(w), norm, {}, FRAME);
  P3.worldOrCellDesc = '3c:Skyrim.esm'; P3.pos = [0, 0, 0];
  ok(G3.__dboUnstuckTown(A).name === 'Riverwood', 'outside, the nearest town by its marker; a fort is never one', G3.__dboUnstuckTown(A));
  P3.worldOrCellDesc = MINE; P3['private.lastOutside'] = { world: '3c:Skyrim.esm', pos: [4900, 0, 0] };
  ok(G3.__dboUnstuckTown(A).name === 'Whiterun', 'inside, the nearest to where they last were outside', G3.__dboUnstuckTown(A));
  P3['private.lastOutside'] = null;
  ok(G3.__dboUnstuckTown(A) === null, 'inside with no last place outside: none, so the temple as before');
  P3.worldOrCellDesc = '99:Skyrim.esm'; P3.pos = [0, 0, 0]; // verify-formids: ignore (a made-up world with no towns)
  ok(G3.__dboUnstuckTown(A) === null, 'a world with no towns: none, so the temple as before');
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
