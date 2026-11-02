// The watch's duty day (guardduty.js) with the real guards.js and childrace.js, on SYNTHETIC data only (the real schedules
// and routes are derived from AI packages and stay private): a managed post is staffed by whoever's shift covers the world
// clock's hour, and a change rewrites its guard:<hold>:<n> zone in NPC-Spawns.json with the incoming guard; nobody on duty
// leaves no zone; a child, a Legion or Stormcloak cover, a quest-gated duty and a post from a mod whose author refuses AI
// work are never staffed; unmanaged posts are guards.js's as before; a patrol's timeline walks its legs and idles at its
// points, out and back when it does not close. Mutants of a copy of guardduty.js must fail.
//   node tests/guard-duty-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(SERVER, 'guardduty.js'), 'utf8').replace(/\r\n/g, '\n');
const base = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-guardduty-'));
process.on('exit', () => { process.chdir(os.tmpdir()); try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

// ---- synthetic data: a made-up plugin, guards and routes, nothing read out of a real package ----
const T = 'Test.esm';
const GUARDS = [
  { town: 'Bruma', npc: 'TestGuardDay', base: `${T}:000801`, spawn_as: `${T}:000801`, side: 'hold', live_zone: 'guard:bruma:8' },
  { town: 'Bruma', npc: 'TestGuardNight', base: `${T}:000802`, spawn_as: `${T}:000802`, side: 'hold', live_zone: null },
  { town: 'Bruma', npc: 'TestGuardChild', base: `${T}:000803`, spawn_as: `${T}:000803`, side: 'hold', live_zone: 'guard:bruma:9' },
  { town: 'Bruma', npc: 'TestLegionary', base: `${T}:000804`, spawn_as: `${T}:000804`, side: 'imperial', live_zone: null },
  { town: 'Bruma', npc: 'TestGuardGated', base: `${T}:000805`, spawn_as: `${T}:000805`, side: 'hold', live_zone: 'guard:bruma:10' },
  { town: 'Bruma', npc: 'TestGuardForbidden', base: `${T}:000806`, spawn_as: `${T}:000806`, side: 'hold', live_zone: 'guard:bruma:11' },
];
const cover = (guard, from, hours, extra) => Object.assign({ guard, side: 'hold', from, hours, days: 'any', quest_gated: false }, extra || {});
const POSTS = [
  { town: 'Bruma', key: `${T}:000A01`, kind: 'patrol', name: 'TestCourtyard', cover: [cover('TestGuardDay', 8, 12), cover('TestGuardNight', 20, 12), cover('TestLegionary', 0, 24, { side: 'imperial' })] },
  { town: 'Bruma', key: `${T}:000A02`, kind: 'post', name: 'TestChildPost', cover: [cover('TestGuardChild', 0, 24)] },
  { town: 'Bruma', key: `${T}:000A03`, kind: 'post', name: 'TestGatedPost', cover: [cover('TestGuardGated', 0, 24, { quest_gated: true })] },
  { town: 'Bruma', key: 'SummersetIsles.esp:000A04', kind: 'post', name: 'TestForbidden', cover: [cover('TestGuardForbidden', 0, 24)] },
];
const pt = (pos, idle) => ({ pos, idle_s: idle });
const ROUTES = {
  [`${T}:000A01`]: { closes_loop: true, cells_crossed: 1, points: [pt([0, 0, 0], 10), pt([800, 0, 0], 5), pt([800, 800, 0], 0)] },
  [`${T}:000A02`]: { closes_loop: false, cells_crossed: 1, points: [pt([0, 0, 0], 2), pt([100, 0, 0], 2), pt([200, 0, 0], 2)] },
};
// Test.esm sits at index 5; 0x900 is an adult race, 0x901 a child race (the Child flag in DATA, as childrace.js reads it)
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); const ix = { 'Test.esm': 5, 'Skyrim.esm': 0 }[plugin]; if (ix === undefined) throw new Error(`no plugin ${plugin}`); return ((ix << 24) | parseInt(hex, 16)) >>> 0; };
const u32 = (v, at, len) => { const b = new Uint8Array(len); new DataView(b.buffer).setUint32(at, v, true); return b; };
const npcRec = (race) => ({ record: { type: 'NPC_', editorId: 'x', fields: [{ type: 'RNAM', data: u32(race, 0, 4) }] }, toGlobalRecordId: (l) => ((5 << 24) | l) >>> 0 });
const RECORDS = {
  [idOf(`801:${T}`)]: npcRec(0x900), [idOf(`802:${T}`)]: npcRec(0x900), [idOf(`803:${T}`)]: npcRec(0x901),
  [idOf(`804:${T}`)]: npcRec(0x900), [idOf(`805:${T}`)]: npcRec(0x900), [idOf(`806:${T}`)]: npcRec(0x900),
  [((5 << 24) | 0x900) >>> 0]: { record: { type: 'RACE', editorId: 'TestRace', fields: [{ type: 'DATA', data: u32(0x1, 32, 40) }] } },
  [((5 << 24) | 0x901) >>> 0]: { record: { type: 'RACE', editorId: 'TestRaceYoung', fields: [{ type: 'DATA', data: u32(0x5, 32, 40) }] } },
};

// One world: a fresh folder, the real guards.js and childrace.js, this copy of guardduty.js, the clock at hour
let run = 0;
const world = (modFile, config, hour) => {
  const dir = path.join(base, String(run++));
  fs.mkdirSync(path.join(dir, 'private-data', 'guard-duty'), { recursive: true });
  process.chdir(dir);
  fs.writeFileSync('private-data/guard-duty/guards.json', JSON.stringify(GUARDS));
  fs.writeFileSync('private-data/guard-duty/posts.json', JSON.stringify(POSTS));
  fs.writeFileSync('private-data/guard-duty/routes.json', JSON.stringify(ROUTES));
  const post = (n, npc) => ({ hold: 'bruma', n, world: '3c:Skyrim.esm', pos: [n, n, n], heading: 0, npc });
  fs.writeFileSync('guard-posts.json', JSON.stringify({ posts: [post(1, `701:${T}`), post(8, `801:${T}`), post(9, `803:${T}`), post(10, `805:${T}`), post(11, `806:${T}`)], autoDone: ['bruma'] }));
  fs.writeFileSync('NPC-Spawns.json', JSON.stringify({ zones: [{ Name: 'wild:wolf:0', ID: '3c:Skyrim.esm', POS: [0, 0, 0], NPC: [] }] }));
  const logs = [], audits = [], cmds = {}, timers = {};
  const mp = { getIdFromDesc: idOf, get: () => undefined, set: () => {}, lookupEspmRecordById: (id) => RECORDS[id >>> 0] || null, onDeath: () => true };
  const clock = { h: hour };
  globalThis.__dboClock = { hour: () => clock.h };
  for (const k of ['__dboGuardDutyAt', '__dboGuardRouteAt', '__dboGuardsRewrite', '__dboGuardsSig', '__dboIsChildRace', '__dboGuardsDeathWrapped']) delete globalThis[k];
  const api = {
    mp, log: (...a) => logs.push(a.join(' ')), personal: (a, t) => logs.push(`said ${t}`), system: () => {}, audit: (t) => audits.push(t),
    display: (a) => String(a), who: (a) => String(a), cfg: { guards: { autoHolds: [] }, guardDuty: config },
    registerChatCommand: (n, f) => { cmds[n] = f; }, every: (name, ms, fn) => { timers[name] = fn; }, onUi: () => {}, onlineActors: () => [],
    zoneOfActor: () => ({ id: 'bruma' }), zoneById: () => ({ id: 'bruma' }), isAdmin: () => false,
  };
  require(path.join(SERVER, 'childrace.js'))(api);
  require(path.join(SERVER, 'guards.js'))(api);
  delete require.cache[modFile];
  require(modFile)(api);
  const zones = () => JSON.parse(fs.readFileSync('NPC-Spawns.json', 'utf8')).zones;
  const zone = (name) => zones().find((z) => z.Name === name);
  const at = (h) => { clock.h = h; if (timers.guardduty) timers.guardduty(); };
  return { logs, audits, cmds, zones, zone, at, npc: (name) => { const z = zone(name); return z ? z.NPC[0].id : null; } };
};

const ON = { enabled: true, posts: [`${T}:000A01`, `${T}:000A02`, `${T}:000A03`, 'SummersetIsles.esp:000A04'], walkSpeed: 100, checkSeconds: 20 };
const checks = (modFile, check) => {
  let w = world(modFile, {}, 10);
  check('off by default: every post is guards.js\'s as before', w.npc('guard:bruma:8') === `801:${T}` && w.npc('guard:bruma:9') === `803:${T}` && w.logs.some((l) => /guardduty off: 0 post/.test(l)), w.zones());

  w = world(modFile, ON, 10);
  check('on, 10:00: the courtyard is the day guard\'s', w.npc('guard:bruma:8') === `801:${T}`, w.zone('guard:bruma:8'));
  check('...the Legion cover of the same post is never chosen, even when it is the only one on', !w.zones().some((z) => z.NPC.some((n) => n.id === `804:${T}`)));
  check('...a child post has no zone, and says so', !w.zone('guard:bruma:9') && w.logs.some((l) => /guard:bruma:9: TestGuardChild is a child; never spawned/.test(l)), w.logs);
  check('...a quest-gated duty is never staffed', !w.zone('guard:bruma:10'));
  check('...a post from a mod whose author refuses AI work is not managed', w.npc('guard:bruma:11') === `806:${T}` && w.logs.some((l) => /SummersetIsles\.esp:000A04 is from a mod whose author refuses AI work/.test(l)));
  check('...an unmanaged post keeps its own guard', w.npc('guard:bruma:1') === `701:${T}`);
  check('...the other writers\' zones are kept', !!w.zone('wild:wolf:0'));
  w.at(19.99);
  check('19:59: still the day guard', w.npc('guard:bruma:8') === `801:${T}`);
  w.at(20);
  check('20:00: the shift changes to the night guard, and the change is logged', w.npc('guard:bruma:8') === `802:${T}` && w.logs.some((l) => /shift change at guard:bruma:8: 801:Test\.esm -> 802:Test\.esm/.test(l)), w.zone('guard:bruma:8'));
  w.at(3);
  check('03:00: the night guard still (the shift runs past midnight)', w.npc('guard:bruma:8') === `802:${T}`);
  w.at(8);
  check('08:00: back to the day guard', w.npc('guard:bruma:8') === `801:${T}`);
  check('/guardduty says who is on and where on the route', /guard:bruma:8 \(TestCourtyard\): TestGuardDay, on since 8:00, at point 1/.test((w.cmds.guardduty(1), w.logs.filter((l) => l.startsWith('said')).pop() || '')), w.logs.slice(-2));

  // Whiterun's staggered change: in the hour two shifts overlap, the one that started last has the post
  const { onDuty, planRoute, routeAt } = require(modFile).core;
  const post = { cover: [cover('A', 7, 12), cover('B', 8, 12), cover('C', 19, 12)] };
  check('an overlap goes to the incoming guard', onDuty(post, 8.5).cover.guard === 'B' && onDuty(post, 7.5).cover.guard === 'A' && onDuty(post, 19.5).cover.guard === 'C');
  check('a duty on some days only is not trusted yet (no weekday): never on', onDuty({ cover: [cover('D', 0, 24, { days: 'loredas' })] }, 9) === null);

  // the timeline: 10 s idle at A, 8 s to B (800 units at 100), 5 s idle, 8 s to C, 0 idle, 11.31 s back to A
  const plan = planRoute(ROUTES[`${T}:000A01`], 100, 10);
  check('a loop\'s period is its idles plus its legs at the walking speed', Math.abs(plan.period - (10 + 8 + 5 + 8 + Math.hypot(800, 800) / 100)) < 1e-9, plan.period);
  let r = routeAt(plan, 5);
  check('...at 5 s it stands at the first point, speed 0, 5 s to go', !r.moving && r.speed === 0 && r.point === 0 && r.pos.join() === '0,0,0' && Math.abs(r.nextAt - 5000) < 1e-6, r);
  r = routeAt(plan, 14);
  check('...at 14 s it is halfway to the second, heading east (90), at the walking speed, 4 s from arriving', r.moving && r.speed === 100 && r.point === 1 && Math.abs(r.pos[0] - 400) < 1e-9 && Math.abs(r.heading - 90) < 1e-9 && Math.abs(r.nextAt - 4000) < 1e-6, r);
  r = routeAt(plan, 27);
  check('...at 27 s it walks north (0) to the third', r.moving && r.point === 2 && Math.abs(r.heading) < 1e-9, r);
  r = routeAt(plan, plan.period + 5);
  check('...and it loops', !r.moving && r.point === 0);
  const back = planRoute(ROUTES[`${T}:000A02`], 100, 10);
  const order = back.segs.filter((s) => s.kind === 'walk').map((s) => s.point);
  check('a route that does not close is walked out and back', JSON.stringify(order) === '[1,2,1,0]', order);
  const wr = world(modFile, ON, 10);
  check('the mover\'s question: where the guard of a managed zone is now', (() => { const a = globalThis.__dboGuardRouteAt('guard:bruma:8', Date.now()); return a && a.zone === 'guard:bruma:8' && a.route === `${T}:000A01` && a.pos.length === 3; })() && globalThis.__dboGuardRouteAt('guard:bruma:1') === null);
  void wr;
};

let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!ok) fails++; };
checks(path.join(SERVER, 'guardduty.js'), check);

// The private data never reaches the repo
const IGNORE = fs.readFileSync(path.join(SERVER, '.gitignore'), 'utf8');
check('private-data/ is gitignored', /^private-data\/$/m.test(IGNORE));
check('guards.js asks guardduty for a managed post\'s guard and gives it its rewrite', /const npcOf = \(p\) => \{ const d = dutyOf\(p\); return d !== undefined \? d :/.test(fs.readFileSync(path.join(SERVER, 'guards.js'), 'utf8')) && /globalThis\.__dboGuardsRewrite = writeZones;/.test(fs.readFileSync(path.join(SERVER, 'guards.js'), 'utf8')));

// ---- mutants: altered copies of guardduty.js, each must fail these checks ----
const MUTANTS = [
  ['a child is spawned', "    if (isChildBase(desc)) { refuse(m.zone, `${on.cover.guard} is a child; never spawned`); return ''; }\n", ''],
  ['any side is the watch', "const SIDES = ['hold'];", "const SIDES = ['hold', 'imperial'];"],
  ['quest-gated duties are staffed', "c.quest_gated === true || ", ''],
  ['the AI-refusing mods are managed', "    if (forbidden(post.key)) {", '    if (false) {'],
  ['a shift never wraps midnight', "(((Number(hour) - Number(from)) % 24) + 24) % 24 < Number(hours)", '(Number(hour) - Number(from)) >= 0 && (Number(hour) - Number(from)) < Number(hours)'],
  ['a shift change never rewrites the zones', "    if (typeof globalThis.__dboGuardsRewrite === 'function') globalThis.__dboGuardsRewrite();\n  };", '  };'],
  ['the earlier guard keeps an overlap', 'shiftAge(hour, from) < best.age', 'shiftAge(hour, from) > best.age'],
  ['out and back is a loop', "  if (route.closes_loop !== true) for", '  if (false) for'],
  ['a standing guard reports the walking speed', "speed: seg.kind === 'walk' ? plan.speed : 0", 'speed: plan.speed'],
  ['nextAt counts from the segment start', '(seg.at + seg.s - at) * 1000', 'seg.s * 1000'],
  ['the heading is off by a quarter turn', 'Math.atan2(to[0] - from[0], to[1] - from[1])', 'Math.atan2(to[1] - from[1], to[0] - from[0])'],
];
for (const [name, from, to] of MUTANTS) {
  if (!SRC.includes(from)) { check(`mutant "${name}": its line is still in guardduty.js`, false, from); continue; }
  const f = path.join(base, `guardduty-mutant-${run}.js`);
  fs.writeFileSync(f, SRC.replace(from, to));
  let bad = 0;
  try { checks(f, (_n, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
