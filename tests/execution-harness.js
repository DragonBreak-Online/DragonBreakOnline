// Execution at the chopping block (execution.js; Nate, 12 Oct). Real module, stub world. Run from server\:
//   node tests/execution-harness.js
'use strict';
const path = require('path');
const fs = require('fs');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, name, got) => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); };
(async () => {
  const BLOCK = 0x080fe549, OTHER = 0x0801234;
  const V = 0xff000201, X = 0xff000202, GM = 0xff000203, TRIAL = 0xff000204, FAR_GM = 0xff000205;
  const pos = new Map([[BLOCK, 0], [V, 1], [X, 1.5], [GM, 8], [TRIAL, 5], [FAR_GM, 300]]);
  const onlineSet = new Set([V, X, GM, TRIAL, FAR_GM]);
  const admins = new Set([GM, FAR_GM]);
  const said = [], audits = [], packets = [], widgets = [], closed = [], killed = [], staff = [];
  let timers = [];
  const ui = new Map();
  // Positions are metres along one axis (70 units each); locationalData and the block's pos give the same in units, and a
  // move (the server standing a player up) lands back in the map
  const UNITS = 70, moved = [], deadSet = new Set(), templed = [];
  const mp = { getIdFromDesc: (d) => ({ '1ac980:dragonbreak online edits.esp': 0x3c1ac980, 'fe549:skyrim.esm': 0xfe549, '2e8eb:skyrim.esm': 0x2e8eb, '74ec5:skyrim.esm': 0x74ec5 }[String(d).toLowerCase()] || 0),
    get: (id, k) => {
      if (k === 'baseDesc') return id === BLOCK ? 'fe549:Skyrim.esm' : '1:Skyrim.esm';
      if (k === 'pos') return [(pos.get(id) ?? 9999) * UNITS, 0, 0];
      if (k === 'locationalData') return { cellOrWorldDesc: 'a764b:BSHeartland.esm', pos: [(pos.get(id) ?? 9999) * UNITS, 0, 100], rot: [0, 0, 45] };
      if (k === 'isDead') return deadSet.has(id);
      return undefined;
    },
    set: (id, k, v) => { if (k === 'locationalData') { moved.push([id, v]); pos.set(id, Math.hypot(v.pos[0], v.pos[1]) / UNITS); } } };
  globalThis.__dboPermaKill = (a, why) => killed.push([a, why]);
  const load = (cfg) => {
    delete globalThis.__dboExecState;
    // Most checks press E twice in a row on purpose; the repeat guard has its own check below
    cfg = cfg || {}; if (cfg.execution && cfg.execution.repeatMs === undefined) cfg.execution.repeatMs = 0;
    // A stood-up player is set down 4 m out; every check starts with both back at the block
    pos.set(V, 1); pos.set(X, 1.5);
    delete require.cache[path.join(SERVER, 'execution.js')];
    ui.clear(); timers = [];
    require(path.join(SERVER, 'execution.js'))({ mp, log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => `#${a.toString(16)}`,
      display: (a) => ({ [V]: 'Victim', [X]: 'Headsman', [GM]: 'Gm', [TRIAL]: 'Trial' }[a] || '?'), cfg: cfg || {},
      isAdmin: (a) => admins.has(a), isPlayer: (a) => a >= 0xff000000, sendPacket: (a, p) => packets.push([a, p]),
      openWidget: (a, w) => widgets.push([a, w]), closeWidget: (a, id) => closed.push([a, id]), onUi: (e, fn) => ui.set(e, fn),
      onlineActors: () => [...onlineSet], distanceMeters: (a, b) => Math.abs((pos.get(a) ?? 9999) - (pos.get(b) ?? 9999)),
      every: (n, ms, fn) => timers.push(fn), staffLog: (...x) => staff.push(x), toTemple: (a) => { templed.push(a); pos.set(a, 5000); return true; } });
  };
  const act = (t, c) => globalThis.__dboExecutionActivate(t, c);
  const last = (a) => { const l = said.filter((x) => x[0] === a); return l.length ? l[l.length - 1][1] : ''; };
  const lastPanel = (a) => { const l = widgets.filter((x) => x[0] === a); return l.length ? l[l.length - 1][1] : null; };
  const choose = (a, id) => ui.get('executionChoose')(a, [id]);
  const tick = () => timers.forEach((f) => f());

  load({ execution: { chopMs: 0 } });
  ok(act(OTHER, V) === undefined && !globalThis.__dboExecutionState().length, 'another activator is none of its business');
  ok(act(BLOCK, V) === undefined && /lay your head on the block/.test(last(V)), 'the victim kneels (the engine seats them)');
  // No GM near: the headsman is refused
  onlineSet.delete(GM);
  ok(act(BLOCK, X) === false && /needs a GM \(not a Trial GM\)/.test(last(X)), 'with only a Trial GM near, the headsman is refused', last(X));
  ok(!widgets.some(([a]) => a === TRIAL), '...and the Trial GM is never asked');
  onlineSet.add(GM);
  ok(act(BLOCK, X) === undefined, 'with a GM near, the headsman takes the axe');
  const gp = lastPanel(GM);
  ok(gp && gp.type === 'contextMenu' && gp.id === 83 && /Headsman would behead Victim/.test(gp.targetName) && gp.actions.length === 2, 'the GM in range gets the approval panel', gp);
  ok(!widgets.some(([a]) => a === FAR_GM), 'a GM out of range is not asked');
  ok(!packets.length && !killed.length, 'nothing happens before the approval');
  // Someone other than the GM cannot approve
  choose(X, gp.actions[0].id);
  ok(globalThis.__dboExecutionState()[0].phase === 'awaitGm' && /Only a GM at the block/.test(last(X)), 'the headsman cannot approve it himself');
  choose(GM, gp.actions[0].id);
  const hp = lastPanel(X);
  ok(globalThis.__dboExecutionState()[0].phase === 'awaitHeadsman' && hp && /Behead Victim\? This ends their character for good/.test(hp.targetName), 'approved: the headsman confirms in his own panel', hp);
  ok(audits.some((t) => /EXECUTION approved by #ff000203/.test(t)), '...audited');
  choose(X, hp.actions[0].id);
  ok(packets.filter(([, p]) => p.customPacketType === 'dboExecute').map(([a]) => a).sort().join() === [V, X, GM, TRIAL].sort().join(), 'dboExecute goes to everyone watching, both included', packets.map(([a]) => a.toString(16)));
  ok(packets[0][1].victim === V && packets[0][1].executioner === X && packets[0][1].idle === '74ec5:Skyrim.esm' && packets[0][1].victimIdle === '70c09:Skyrim.esm', '...naming the victim, the headsman, IdleHeadChop and IdleExecutioneeChop');
  await new Promise((r) => setTimeout(r, 5));
  ok(killed.length === 1 && killed[0][0] === V && /executed at the chopping block by Headsman, approved by GM Gm/.test(killed[0][1]), 'chopMs later the victim\'s character ends for good', killed);
  ok(!globalThis.__dboExecutionState().length && staff.length === 1, 'the block is free again; the staff log has it');

  // A refusal
  load({ execution: { chopMs: 0 } }); killed.length = 0; packets.length = 0; widgets.length = 0;
  act(BLOCK, V); act(BLOCK, X);
  choose(GM, lastPanel(GM).actions[1].id);
  ok(!globalThis.__dboExecutionState().length && /GM Gm refused/.test(last(V)) && /GM Gm refused/.test(last(X)) && !killed.length, 'a GM refusal ends it, both told');
  // The victim standing up ends it
  act(BLOCK, V); act(BLOCK, X); pos.set(V, 10); tick();
  ok(!globalThis.__dboExecutionState().length && /stood up or left/.test(last(X)), 'the victim stepping away ends it'); pos.set(V, 1);
  // The headsman lowering the axe
  act(BLOCK, V); act(BLOCK, X); choose(GM, lastPanel(GM).actions[0].id); choose(X, lastPanel(X).actions[1].id);
  ok(!globalThis.__dboExecutionState().length && /lowers the axe/.test(last(V)) && !killed.length, 'the headsman can lower the axe');
  // The victim getting up from the block frees it
  pos.set(V, 1); pos.set(X, 1.5);
  act(BLOCK, V);
  ok(act(BLOCK, V) === false && !globalThis.__dboExecutionState().length, 'the victim using the block again (standing up) frees it, and the engine does not seat them again');
  pos.set(V, 1); pos.set(X, 1.5);
  // Timeout
  load({ execution: { chopMs: 0, approvalSeconds: 0 } });
  act(BLOCK, V); act(BLOCK, X); await new Promise((r) => setTimeout(r, 5)); tick();
  ok(!globalThis.__dboExecutionState().length && /Nobody decided in time/.test(last(V)), 'approvalSeconds passing ends it');
  // 13 Oct (claude-jake's check): once the headsman confirms, the blow lands. Walking away during the clip saved the victim
  load({ execution: { chopMs: 20 } }); killed.length = 0;
  act(BLOCK, V); act(BLOCK, X); choose(GM, lastPanel(GM).actions[0].id); choose(X, lastPanel(X).actions[0].id); pos.set(V, 50); tick();
  ok(globalThis.__dboExecutionState().length === 1 && globalThis.__dboExecutionState()[0].phase === 'chopping', 'walking off during the chop does not end it (the 2 s watch)');
  await new Promise((r) => setTimeout(r, 40));
  ok(killed.length === 1 && killed[0][0] === V, 'a victim who walked 50 m during the clip is still executed at chopMs', killed); pos.set(V, 1);
  // Standing up (using the block again) during the chop: refused, and the execution completes
  load({ execution: { chopMs: 20 } }); killed.length = 0;
  act(BLOCK, V); act(BLOCK, X); choose(GM, lastPanel(GM).actions[0].id); choose(X, lastPanel(X).actions[0].id);
  ok(act(BLOCK, V) === false && /already falling/.test(last(V)), 'the victim cannot stand up from the block during the chop', last(V));
  ok(act(BLOCK, TRIAL) === false && /under way/.test(last(TRIAL)), '...and nobody else can use the block then');
  ok(killed.length === 0, '...the death still waits for chopMs');
  await new Promise((r) => setTimeout(r, 40));
  ok(killed.length === 1 && killed[0][0] === V, 'the execution completes after the victim tried to stand', killed);
  // The victim logging out during the chop does not escape it either
  load({ execution: { chopMs: 20 } }); killed.length = 0;
  act(BLOCK, V); act(BLOCK, X); choose(GM, lastPanel(GM).actions[0].id); choose(X, lastPanel(X).actions[0].id); onlineSet.delete(V); tick();
  await new Promise((r) => setTimeout(r, 40));
  ok(killed.length === 1 && killed[0][0] === V, 'logging out during the chop does not escape it', killed); onlineSet.add(V);

  // 13 Oct: the approving GM must stay at the block until the headsman confirms
  load({ execution: { chopMs: 0 } }); killed.length = 0; packets.length = 0;
  act(BLOCK, V); act(BLOCK, X); choose(GM, lastPanel(GM).actions[0].id); pos.set(GM, 100); tick();
  ok(!globalThis.__dboExecutionState().length && /who allowed the execution, left the block/.test(last(X)) && /left the block/.test(last(V)), 'the approving GM walking off before the confirm ends it (the watch), all told', last(X));
  pos.set(GM, 8);
  load({ execution: { chopMs: 0 } }); killed.length = 0; packets.length = 0;
  act(BLOCK, V); act(BLOCK, X); choose(GM, lastPanel(GM).actions[0].id); const hp2 = lastPanel(X); pos.set(GM, 100);
  choose(X, hp2.actions[0].id);
  ok(!packets.some(([, p]) => p.customPacketType === 'dboExecute') && !killed.length && /is no longer at the block/.test(last(X)), 'the headsman confirming after the GM left (between watches): no execution', last(X));
  pos.set(GM, 8);
  load({ execution: { chopMs: 20 } }); killed.length = 0;
  act(BLOCK, V); act(BLOCK, X); choose(GM, lastPanel(GM).actions[0].id); choose(X, lastPanel(X).actions[0].id); pos.set(GM, 100); tick();
  await new Promise((r) => setTimeout(r, 40));
  ok(killed.length === 1, 'after the confirm the GM may leave: it proceeds', killed); pos.set(GM, 8);

  // 13 Oct: a GM who is the headsman (or the victim) cannot approve their own execution
  admins.add(X); onlineSet.delete(GM);
  load({ execution: { chopMs: 0 } }); killed.length = 0; widgets.length = 0;
  act(BLOCK, V);
  ok(act(BLOCK, X) === false && /cannot be the headsman or the one at the block/.test(last(X)), 'a GM headsman with no other GM near is refused', last(X));
  ok(!widgets.some(([a]) => a === X), '...and is never shown the approval panel');
  onlineSet.add(GM);
  ok(act(BLOCK, X) === undefined && !widgets.some(([a]) => a === X) && lastPanel(GM), 'with another GM near only that GM is asked');
  choose(X, lastPanel(GM).actions[0].id);
  ok(globalThis.__dboExecutionState()[0].phase === 'awaitGm' && /cannot decide an execution you take part in/.test(last(X)), 'the GM headsman cannot approve with the panel id either', last(X));
  admins.delete(X);
  admins.add(V);
  load({ execution: { chopMs: 0 } }); widgets.length = 0;
  act(BLOCK, V); act(BLOCK, X);
  ok(!widgets.some(([a]) => a === V), 'a GM at the block is not asked to approve their own beheading');
  choose(V, lastPanel(GM).actions[0].id);
  ok(globalThis.__dboExecutionState()[0].phase === 'awaitGm' && /cannot decide an execution you take part in/.test(last(V)), '...nor can they approve it', last(V));
  admins.delete(V);
  // 13 Oct 20:30Z: after the execution the headsman stayed seated; every E press was seated again by the fork
  // ("already occupies it, seating again"). Every end now stands whoever this module seated, and their E press is refused
  const UNSEAT = 256 / UNITS; // the fork's furniture reach: past it the seat is stale
  const movedTo = (a) => moved.filter(([x]) => x === a).map(([, v]) => v);
  load({ execution: { chopMs: 20 } }); killed.length = 0; moved.length = 0;
  act(BLOCK, V); act(BLOCK, X); choose(GM, lastPanel(GM).actions[0].id); choose(X, lastPanel(X).actions[0].id);
  ok(!moved.length, 'nobody is moved during the chop');
  deadSet.add(V);
  await new Promise((r) => setTimeout(r, 40));
  ok(killed.length === 1 && movedTo(X).length === 1, 'the execution done, the headsman is stood up', moved);
  const mx = movedTo(X)[0];
  ok(mx && Math.hypot(mx.pos[0], mx.pos[1]) >= 256 && mx.cellOrWorldDesc === 'a764b:BSHeartland.esm' && mx.rot[2] === 45 && mx.pos[2] === 108,
    '...set down past the fork\'s 256-unit furniture reach, in the same world, facing as he was', mx);
  ok(!movedTo(V).length, '...and the dead victim is not moved');
  ok(pos.get(X) > UNSEAT, 'the headsman is off the block');
  // The live bug: the headsman's next E press was a new kneel, which let the engine seat him again
  pos.set(X, 1.5);
  load({ execution: { chopMs: 20 } }); killed.length = 0; moved.length = 0;
  // As the live server stood at 20:30:50: the attempt over, the headsman still seated (the module's own record of it)
  if (globalThis.__dboExecState.seated instanceof Map) globalThis.__dboExecState.seated.set(BLOCK >>> 0, new Set([X]));
  ok(act(BLOCK, X) === false && movedTo(X).length === 1 && !globalThis.__dboExecutionState().length && /rise from the block/.test(last(X)),
    'a player this module seated pressing E is stood up and refused (never seated again)', last(X));
  deadSet.delete(V); pos.set(V, 1); pos.set(X, 1.5);
  // Refusal, cancel and timeout stand both
  for (const [label, run] of [
    ['a GM refusal', () => choose(GM, lastPanel(GM).actions[1].id)],
    ['the headsman lowering the axe', () => { choose(GM, lastPanel(GM).actions[0].id); choose(X, lastPanel(X).actions[1].id); }],
  ]) {
    load({ execution: { chopMs: 0 } }); moved.length = 0;
    act(BLOCK, V); act(BLOCK, X); run();
    ok(!globalThis.__dboExecutionState().length && movedTo(V).length === 1 && movedTo(X).length === 1, `${label} stands both`, moved.map(([a]) => a.toString(16)));
    pos.set(V, 1); pos.set(X, 1.5);
  }
  load({ execution: { chopMs: 0, approvalSeconds: 0 } }); moved.length = 0;
  act(BLOCK, V); act(BLOCK, X); await new Promise((r) => setTimeout(r, 5)); tick();
  ok(/Nobody decided in time/.test(last(V)) && movedTo(V).length === 1 && movedTo(X).length === 1, 'a timeout stands both');
  pos.set(V, 1); pos.set(X, 1.5);
  // The victim who walked off is not pulled back; the headsman still at the block is stood up
  load({ execution: { chopMs: 0 } }); moved.length = 0;
  act(BLOCK, V); act(BLOCK, X); pos.set(V, 10); tick();
  ok(/stood up or left/.test(last(X)) && !movedTo(V).length && movedTo(X).length === 1, 'the victim who left is not moved; the headsman is stood up', moved);
  pos.set(V, 1); pos.set(X, 1.5);
  // The headsman pressing E before the confirm steps away: the attempt ends, both stood up
  load({ execution: { chopMs: 0 } }); moved.length = 0;
  act(BLOCK, V); act(BLOCK, X); choose(GM, lastPanel(GM).actions[0].id);
  ok(act(BLOCK, X) === false && !globalThis.__dboExecutionState().length && /stepped away from the block/.test(last(V)) && movedTo(X).length === 1 && movedTo(V).length === 1,
    'the headsman pressing E before the confirm ends it and stands both', last(V));
  pos.set(V, 1); pos.set(X, 1.5);
  // The victim pressing E while the GM decides ends it too
  load({ execution: { chopMs: 0 } }); moved.length = 0;
  act(BLOCK, V); act(BLOCK, X);
  ok(act(BLOCK, V) === false && !globalThis.__dboExecutionState().length && /rose from the block/.test(last(X)) && movedTo(V).length === 1, 'the victim pressing E while the GM decides ends it', last(X));
  pos.set(V, 1); pos.set(X, 1.5);
  // One press arriving twice within a millisecond (20:27:35.880): the repeat does nothing
  load({ execution: { chopMs: 0, repeatMs: 1500 } }); moved.length = 0;
  ok(act(BLOCK, V) === undefined && act(BLOCK, V) === false && globalThis.__dboExecutionState().length === 1 && !moved.length, 'a repeat of the kneel within repeatMs is ignored (she stays kneeling)');
  // Someone who left the block another way (/unstuck) kneels again as a kneel, not a getting up
  load({ execution: { chopMs: 0 } }); moved.length = 0;
  act(BLOCK, V); pos.set(V, 100); tick(); pos.set(V, 1);
  ok(act(BLOCK, V) === undefined && globalThis.__dboExecutionState().length === 1 && !moved.length, 'a player who left by /unstuck kneels again normally');
  // 13 Oct 21:31:58: the 280-unit move did not take GM Nate off the block; his client put him back on it 5 s later. Each
  // stand-up also asks the client to stand them (dboExecuteStand), and standCheckMs later one still sitting goes to the temple
  const standsTo = (a) => packets.filter(([x, p]) => x === a && p.customPacketType === 'dboExecuteStand').map(([, p]) => p);
  load({ execution: { chopMs: 20, standCheckMs: 0 } }); killed.length = 0; moved.length = 0; packets.length = 0; templed.length = 0;
  act(BLOCK, V); act(BLOCK, X); choose(GM, lastPanel(GM).actions[0].id); choose(X, lastPanel(X).actions[0].id);
  deadSet.add(V);
  await new Promise((r) => setTimeout(r, 40));
  const sx = standsTo(X)[0], mvx = movedTo(X)[0];
  ok(standsTo(X).length === 1 && sx && mvx && JSON.stringify(sx.pos) === JSON.stringify(mvx.pos) && JSON.stringify(sx.rot) === JSON.stringify(mvx.rot),
    'the headsman is sent dboExecuteStand with the same spot and facing as the server\'s move', [sx, mvx]);
  ok(!standsTo(V).length, '...the dead victim is not');
  ok(packets.find(([, p]) => p.customPacketType === 'dboExecute')[1].event === 'IdleExecutionerChop' && packets.find(([, p]) => p.customPacketType === 'dboExecute')[1].victimEvent === 'IdleExecutioneeChop',
    'dboExecute names the two graph events for the client\'s fallback');
  // His client put him back where he sat (1.5 m out): the next watch sends him to the temple
  pos.set(X, 1.5); tick();
  ok(templed.join() === String(X) && /would not let you rise\. You find your way back to the temple/.test(last(X)), 'still sitting where he sat after standCheckMs: sent to the respawn temple, told why', last(X));
  tick();
  ok(templed.length === 1, '...once');
  deadSet.delete(V);
  // Stood up by the client: left alone
  load({ execution: { chopMs: 0, standCheckMs: 0 } }); templed.length = 0; packets.length = 0;
  act(BLOCK, V); act(BLOCK, X); choose(GM, lastPanel(GM).actions[1].id);
  pos.set(V, 4); pos.set(X, 6); tick();
  ok(!templed.length && standsTo(V).length === 1 && standsTo(X).length === 1, 'both stood up and off their seats: nobody is sent to the temple', templed);
  // Waits standCheckMs, and leaves a player who logged off alone
  load({ execution: { chopMs: 0, standCheckMs: 60000 } }); templed.length = 0;
  act(BLOCK, V); act(BLOCK, X); choose(GM, lastPanel(GM).actions[1].id);
  pos.set(V, 1); pos.set(X, 1.5); tick();
  ok(!templed.length, 'nobody is sent before standCheckMs');
  load({ execution: { chopMs: 0, standCheckMs: 0 } }); templed.length = 0;
  act(BLOCK, V); act(BLOCK, X); choose(GM, lastPanel(GM).actions[1].id);
  pos.set(V, 1); pos.set(X, 1.5); onlineSet.delete(V); tick(); onlineSet.add(V);
  ok(templed.join() === String(X), 'a player who logged off meanwhile is left alone, the one online still seated is sent', templed);
  ok(/toTemple: \(a\) => \{ const t = templeFor\(templeZoneOf\(a\) \|\| 'bruma'\) \|\| templeFor\('bruma'\);[^\n]*mp\.set\(a, 'locationalData', \{ cellOrWorldDesc: t\.world, pos: t\.pos/.test(fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8')),
    'gamemode.js gives it toTemple: the /unstuck move to the area\'s respawn temple');
  load({ execution: { enabled: false } });
  ok(act(BLOCK, V) === undefined && !globalThis.__dboExecutionState().length, 'enabled false: the block is plain furniture');
  const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
  ok(/__dboExecutionActivate\(targetId >>> 0, casterId >>> 0\) === false\) return false;/.test(gm) && /require\(EXECUTION_JS\)/.test(gm), 'gamemode.js loads it and asks it in the activate chain');
  // The live defaults: the Bruma block counts, and the death waits for the clip's KillActor
  const src = fs.readFileSync(path.join(SERVER, 'execution.js'), 'utf8');
  ok(/blockBases: \['1ac980:DragonBreak Online Edits\.esp'/.test(src) && /chopMs: 16700/.test(src) && /victimIdle: '70c09:Skyrim\.esm'/.test(src), 'defaults: the DLE block, IdleExecutioneeChop on the victim, the death at 16.7 s');
  ok(/standUnits: 280, repeatMs: 1500/.test(src), 'defaults: stood up 280 units out (past the 256-unit seat reach), repeats within 1.5 s ignored');
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
