'use strict';
// gamemode.js pruneGoneSeats (mod-0602, 2 Nov: a PK'd and deleted character still sat as Whiterun's Lord Commander): a seat
// bound to a character that no longer exists is vacated through unseatOfficialBy; a seat bound to a living character, or
// to no character, is left alone; the sweep runs on its own timer with the roster prune. Loads the real code with stubs.
// Run from the server folder: node tests/gone-seats-harness.js
const fs = require('fs'); const path = require('path');
const GM = fs.readFileSync(path.join(__dirname, '..', 'gamemode.js'), 'utf8');
let fail = 0; const ok = (c, n, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${!c && g !== undefined ? '   ' + JSON.stringify(g) : ''}`); if (!c) fail++; };
const from = GM.indexOf('const pruneGoneSeats = ');
const to = GM.indexOf('globalThis.__dboPruneGoneSeats = pruneGoneSeats;');
ok(from > 0 && to > from, 'gamemode.js defines pruneGoneSeats');
const code = GM.slice(from, to);
const TOLFDIR = 0xff002182, ZORIN = 0xff000aaa, MISTA = 0xff000746;
const seats = { whiterun: { jarl: { 55: MISTA }, commander: { 25: TOLFDIR }, steward: {} }, riften: { jarl: {} }, gone: { jarl: { 9: TOLFDIR } } };
const deleted = new Set([TOLFDIR]);
globalThis.__dboFormGone = (id) => deleted.has(Number(id) >>> 0);
const unseated = [], unbound = [], logs = [];
const zones = { whiterun: { id: 'whiterun', name: 'Whiterun' }, riften: { id: 'riften', name: 'Riften' } };
const run = new Function('readSeats', 'zoneById', 'unseatOfficialBy', 'bindSeat', 'log', `${code}; return pruneGoneSeats;`)(
  () => JSON.parse(JSON.stringify(seats)), (id) => zones[id] || null,
  (z, tg, by) => { unseated.push({ zone: z.id, pid: tg.pid, actor: tg.actor, by }); return tg.pid === 25 ? { had: 'commander' } : { error: 'holds no rank' }; },
  (zid, r, pid, actor) => unbound.push({ zid, r, pid, actor }), (t) => logs.push(t));
const n = run();
ok(unseated.some((u) => u.zone === 'whiterun' && u.pid === 25 && u.actor === 0 && /no longer exists/.test(u.by)), "the deleted Lord Commander's seat is vacated through unseatOfficialBy", unseated);
ok(!unseated.some((u) => u.pid === 55), "the living Jarl's seat is left alone", unseated);
ok(unbound.some((b) => b.zid === 'gone' && b.pid === 9 && b.r === null), 'a binding in a zone that no longer exists is only cleared', unbound);
ok(n === 2 && logs.length === 2 && logs.every((l) => /no longer exists/.test(l)), 'each vacated seat is logged and counted', { n, logs });
deleted.clear(); unseated.length = 0;
ok(run() === 0 && unseated.length === 0, 'with nobody deleted nothing is touched');
globalThis.__dboFormGone = () => { throw new Error('boom'); };
deleted.add(TOLFDIR);
ok(run() === 0, 'a check that throws counts as alive, never as gone');
ok(/every\('goneCharacters', 15 \* 60000,[\s\S]{0,80}\['__dboPruneGoneSeats', '__dboGuildPrune'\]/.test(GM), 'the sweep runs every 15 minutes with the guild roster prune');
console.log(fail ? `${fail} failed` : 'all checks passed'); process.exit(fail ? 1 : 0);
