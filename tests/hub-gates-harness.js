// The Realm's nine hold gates (gamemode.js GATES): every gate has landing spots, the spots are spread like the creator
// spots, a config override replaces a gate's spots, and the two landings found bad against the Skyrim release's city mods
// (Morthal inside COTN_Morthal06's bounds 680 above the ground; Dawnstar 257 above the navmesh) are gone.
//   node tests/hub-gates-harness.js
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
let fails = 0; const ok = (c, w, x) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${w}${!c && x !== undefined ? '   ' + JSON.stringify(x) : ''}`); if (!c) fails++; };
const g0 = src.indexOf('const GATE_DEFAULTS = '), g1 = src.indexOf('const TAMRIEL = ');
ok(g0 > 0 && g1 > g0, 'GATE_DEFAULTS and the GATES table are there');
const gatesFor = (cfg) => new Function('cfg', src.slice(g0, g1) + '\nreturn GATES;')(cfg);
const G = gatesFor({});
const ids = ['a000', 'a001', 'a002', 'a003', 'a004', 'a005', 'a006', 'a007', 'a008'];
const names = ['Whiterun', 'Riften', 'Solitude', 'Windhelm', 'Markarth', 'Falkreath', 'Morthal', 'Dawnstar', 'Winterhold'];
ok(ids.every((id, i) => G[id] && G[id][0] === names[i]), 'the nine gates a000-a008 lead to the nine holds, in the plugin\'s order', Object.keys(G));
ok(ids.every((id) => G[id][1].length >= 2 && G[id][1].every((q) => q.length === 3 && q.every(Number.isFinite))), 'each gate has at least two landing spots of three numbers');
ok(ids.every((id) => G[id][1].every((q, i) => G[id][1].every((r, j) => i === j || Math.hypot(q[0] - r[0], q[1] - r[1]) >= 105))), 'a gate\'s spots stand at least 105 apart (the creator spots\' spacing)');
ok(ids.every((id) => G[id][1].every((q) => Math.hypot(q[0] - G[id][1][0][0], q[1] - G[id][1][0][1]) <= 600)), 'and within 600 of the gate\'s first spot');
const near = (id, p) => G[id][1].some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 100);
ok(!near('a006', [-38640, 66734]), 'Morthal no longer lands inside COTN_Morthal06 (old point -38640, 66734)');
ok(!G.a007[1].some((q) => Math.abs(q[0] - 30808) < 1 && Math.abs(q[2] - -13870) < 1), 'Dawnstar no longer lands 257 above the navmesh (old point 30808, 106138, -13870)');
const O = gatesFor({ hubGates: { a006: { spots: [[1, 2, 3], ['x', 2, 3]], rotZ: 45 }, a007: { spots: 'nonsense' } } });
ok(O.a006[1].length === 1 && O.a006[1][0].join() === '1,2,3' && O.a006[2] === 45 && O.a006[0] === 'Morthal', 'hubGates in the config replaces a gate\'s spots and facing (a bad spot is dropped)');
ok(O.a007[1] === G.a007[1] || O.a007[1].join() === G.a007[1].join(), 'a malformed override keeps the defaults');
// spread: two arrivals at the same gate get two spots, a third at a two-spot gate gets the least crowded
const s0 = src.indexOf('const spotPicker = '), s1 = src.indexOf('const creatorSpotHolds');
const pos = new Map();
const spotPicker = new Function('mp', 'onlineActors', src.slice(s0, s1) + '\nreturn spotPicker;')({ get: (a, k) => (k === 'pos' ? pos.get(a) : true) }, () => [...pos.keys()]);
const holds = new Map(); const P = spotPicker({ spots: G.a006[1], holds, spacing: 105, holdMs: 20000, here: () => true });
const first = P.pick(1), second = P.pick(2);
ok(first !== second, 'two arrivals at once are promised different spots', [first, second]);
const gate = src.slice(src.indexOf('const g = gateOf(targetId >>> 0);'), src.indexOf('const prev = globalThis.__dboPrevActivate;'));
ok(/gateSpotFor\(g, casterId >>> 0\)/.test(gate) && !/pos: g\[1\],/.test(gate), 'the gate hook lands on a picked spot, not a fixed point');
ok(!/gates there are scenery|whose gates teleport nobody/.test(src), 'no comment still calls the gates scenery');
// Nate 15 Oct ("yes move them"): Morthal, Dawnstar, Solitude and Markarth land at the points suggested in
// skyrim-check-3.md, set in the shipped config so each can be changed after the in-game check
const shipped = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'gamemode-config.json'), 'utf8')).hubGates || {};
const SUGGESTED = { a002: [-74313.4, 96373.3], a004: [-171223.0, 6919.6], a006: [-38293.3, 67050.7], a007: [30549.8, 106123.5] };
ok(Object.entries(SUGGESTED).every(([id, p]) => shipped[id] && Array.isArray(shipped[id].spots) && Math.hypot(shipped[id].spots[0][0] - p[0], shipped[id].spots[0][1] - p[1]) < 1), 'the four moved gates are in the shipped config, first spot at the suggested point');
const S = gatesFor(JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'gamemode-config.json'), 'utf8')));
ok(Object.keys(SUGGESTED).every((id) => S[id][1] === undefined || Math.hypot(S[id][1][0][0] - SUGGESTED[id][0], S[id][1][0][1] - SUGGESTED[id][1]) < 1), 'and the gates read them from there');
console.log(fails ? `${fails} failure(s)` : 'all checks passed'); process.exit(fails ? 1 : 0);
