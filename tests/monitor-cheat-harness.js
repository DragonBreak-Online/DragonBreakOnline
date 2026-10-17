// /monitor cheat (design 17 Oct 2026, part monitor-anticheat-rule): the anti-cheat counts dbo-monitor writes to its
// state.json (cheat.<kind>, cheat_shadow.<kind>, cheat.held, cheat.other) and its cheat alerts, and nothing else;
// plain /monitor and /monitor npc read as before. Runs the real monitor.js on a made-up state file.
//   node tests/monitor-cheat-harness.js   (from server/; MONITOR=... points at another copy)
'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path');
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) { pass++; console.log('ok  ', what); } else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-cheat-'));
const file = path.join(dir, 'state.json');
const now = Math.floor(Date.now() / 1000);
fs.writeFileSync(file, JSON.stringify({
  updatedAt: now,
  windows: [{ start: now - 120, counts: { 'cheat.speed_sustained': 2, 'cheat_shadow.stamina_free': 5, 'cheat.held': 3,
    'npc.split': 4, 'server.script_error': 1, noise: 50, 'player.join': 2 }, worst: {}, players: {} }],
  recent: ['`10:00:01` Game server started', '`10:00:02` **Cheat flag** `speed_sustained`: Rhea \\#AB12 (profile 42): 10 s 1210 u/s \\(limit 850\\)',
    '`10:00:03` **Script error:** x', '`10:00:04` **Cheat flags held back:** 3 cheat flags held back during a server stall'],
  online: { Rhea: { hosted: 3, unloaded: 0 } },
}));

const cmds = {};
const said = [];
const api = { personal: (a, t) => said.push(t), registerChatCommand: (n, fn, o) => { cmds[n] = { fn, o }; }, isAdmin: () => true,
  cfg: { monitor: { stateFile: file } } };
require(process.env.MONITOR || path.resolve(__dirname, '..', 'monitor.js'))(api);
const run = (args) => { said.length = 0; cmds.monitor.fn(1, args); return said.slice(); };

const cheat = run('cheat');
ok(cheat.some((l) => l === '  cheat flags: speed sustained: 2'), '/monitor cheat counts live flags', cheat);
ok(cheat.some((l) => l === '  shadow cheat flags: stamina free: 5'), '  and shadow flags', cheat);
ok(cheat.some((l) => l === '  cheat flags held back in a server stall: 3'), '  and held ones', cheat);
ok(!cheat.some((l) => /npc|script|split|noise|join/i.test(l)), '  and nothing else', cheat);
ok(cheat.some((l) => l === '  10:00:02 Cheat flag speed_sustained: Rhea #AB12 (profile 42): 10 s 1210 u/s (limit 850)'),
  '  its latest alerts are the cheat ones, unescaped', cheat);
ok(cheat.some((l) => l.startsWith('  10:00:04 Cheat flags held back:')), '  with the held-back line', cheat);
ok(!cheat.some((l) => /Game server started|Script error|Hosting:/.test(l)), '  not the others, nor hosting', cheat);
const all = run('');
ok(all.some((l) => l === '  cheat flags: speed sustained: 2') && all.some((l) => l === '  npc.split: 4'.replace('npc.split', 'body and position parted')),
  'plain /monitor shows the cheat counts among the rest', all);
ok(all.some((l) => /Game server started/.test(l)) && all.some((l) => /Hosting: Rhea 3/.test(l)), '  and every alert and hosting, as before', all);
const npc = run('npc');
ok(npc.length >= 2 && npc.slice(1).filter((l) => !l.startsWith('Hosting:')).every((l) => /body and position parted/.test(l)),
  '/monitor npc is NPC kinds only (and hosting), as before', npc);
ok(/cheat/.test(cmds.monitor.o.help), 'the help names the cheat view', cmds.monitor.o.help);
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
