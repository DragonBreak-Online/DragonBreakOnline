// DragonBreak Online: dungeon traps, run by the server (Nate, 20 Oct: "start phase 2 of the traps"). Loaded by gamemode.js.
//
// Why here: a SkyMP client runs no Papyrus events (BlockPapyrusEventsService), and the server's own run of the vanilla
// trap scripts stalls on natives it lacks (ProcessTrapHit, CalculateEncounterLevel, WaitForAnimationEvent). Only 51 of
// Skyrim.esm's 570 trigger volumes have a primitive the server can see; pressure plates and tripwires have none. So this
// module watches players' positions against the plates, tripwires and trigger boxes of traps.json (tools/traps_scan.py:
// the traps each one fires through activate parents, relays included), plays the traps' animations through the server
// (ObjectReference.PlayAnimation reaches every client in the cell, as ruinbuttons.js does) and deals the damage itself.
//
// Kinds: spear, blade, wall (swinging wall), ram (battering ram). Darts and flame jets fire weapons and spells the server
// cannot make, so they are left alone (a hit nobody can see). Damage is the script's LvlDamage1..6 picked by the player's
// character level against LvlThreshold1..5, as the vanilla CalculateEncounterLevel picks by encounter level; it goes in as
// Actor.DamageActorValue('Health'), so a trap can down a player (downed.js) but the server's max health decides the share.
// Rotation: clockwise angles composed Rz Ry Rx (the CK wiki's "ZYX" for SetAngle), so local -> world is Rz(-z) Ry(-y) Rx(-x):
// X tilts first and the heading turns last. The scan bears it out: 100 of the wall spears share X = 90 or 270 degrees and
// differ only in Z, which could not aim them down different corridors if Z were applied first.
// config "traps": { enabled, only: 'staff' | 'all' (staff only until tested in game), damage, tickMs, cooldownSeconds,
//   hitWindowMs, resetSeconds, kinds }
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, cfg, every, onlineActors, profileOf, display, audit, personal, registerChatCommand } = api;
  const C = Object.assign({ enabled: true, only: 'staff', damage: true, tickMs: 250, cooldownSeconds: 6, hitWindowMs: 1000, resetSeconds: 4,
    kinds: ['spear', 'blade', 'wall', 'ram'], log: true }, cfg.traps || {});
  const KINDS = new Set(C.kinds || []);
  // What each kind plays, how long after its trigger the blow lands, and how wide around its bounds it reaches (units)
  const ANIM = {
    spear: { fire: () => 'Trigger01', reset: () => 'Open', lead: 50, pad: [40, 40, 30] },
    blade: { fire: () => 'Single', reset: () => '', lead: 100, pad: [40, 130, 30] },
    ram: { fire: () => 'Trigger', reset: () => 'reset', lead: 250, pad: [40, 40, 30] },
    wall: { fire: (t) => ['90For', '180For', '270For'][Number(t.rotation) || 0] || '90For', reset: (t) => ['90Back', '180Back', '270Back'][Number(t.rotation) || 0] || '90Back', lead: 150, pad: [30, 30, 30] },
  };
  const S = globalThis.__dboTraps || (globalThis.__dboTraps = { inside: new Map(), cool: new Map(), busy: new Map(), timers: new Set() });

  // ---- geometry -----------------------------------------------------------------------------------------------------
  const rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
  const ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
  const rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
  const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
  // local -> world for a ref's angles; its transpose takes world back to local
  const toWorld = (rot) => mul(rz(-rot[2]), mul(ry(-rot[1]), rx(-rot[0])));
  const toLocal = (M, d) => [0, 1, 2].map((i) => M[0][i] * d[0] + M[1][i] * d[1] + M[2][i] * d[2]);
  const zOnly = (rot, d) => { const c = Math.cos(rot[2]), s = Math.sin(rot[2]); return [d[0] * c - d[1] * s, d[0] * s + d[1] * c, d[2]]; };
  const inBox = (p, lo, hi) => p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1] && p[2] >= lo[2] && p[2] <= hi[2];

  // A desc as one string whatever its padding or case ("0001A2B3:Skyrim.esm" and "1a2b3:skyrim.esm" alike), as dungeons.js
  const normDesc = (d) => { const s = String(d || ''); const i = s.indexOf(':'); if (i < 0) return s.toLowerCase(); const n = parseInt(s.slice(0, i), 16); return (Number.isFinite(n) ? n.toString(16) : s.slice(0, i).toLowerCase()) + ':' + s.slice(i + 1).toLowerCase(); };
  // ---- the map --------------------------------------------------------------------------------------------------------
  let CELLS = new Map();
  const load = () => {
    let raw = {}; try { raw = JSON.parse(fs.readFileSync(path.resolve('traps.json'), 'utf8')).cells || {}; } catch (e) { log('traps: traps.json unreadable', e.message); }
    const out = new Map(); let n = 0, m = 0;
    for (const [cell, list] of Object.entries(raw)) {
      const trig = [];
      for (const t of list || []) {
        const traps = (t.traps || []).filter((x) => KINDS.has(x.kind) && x.obnd && x.dmg && ANIM[x.kind]).map((x) => Object.assign({}, x, { M: toWorld(x.rot || [0, 0, 0]) }));
        if (!traps.length || !Array.isArray(t.pos)) continue;
        trig.push(Object.assign({}, t, { traps })); n++; m += traps.length;
      }
      if (trig.length) out.set(normDesc(cell), trig);
    }
    CELLS = out;
    log(`traps ${C.enabled ? 'on' : 'off'} (${C.only === 'all' ? 'everyone' : 'staff only'}${C.damage ? '' : ', no damage'}): ${n} triggers firing ${m} traps in ${out.size} cells (${[...KINDS].join(', ')})`);
  };
  load();

  // Whether a player stands on this trigger: a plate's bounds (Z rotation only), a tripwire's rope, a trigger box's extent
  const onTrigger = (t, p) => {
    const d = zOnly(t.rot || [0, 0, 0], [p[0] - t.pos[0], p[1] - t.pos[1], p[2] - t.pos[2]]);
    const s = Number(t.scale) || 1;
    if (t.trigger === 'tripwire') return Math.abs(d[0]) <= 117 * s && Math.abs(d[1]) <= 28 * s + 15 && d[2] >= -30 && d[2] <= 90;
    if (Array.isArray(t.half)) return Math.abs(d[0]) <= t.half[0] && Math.abs(d[1]) <= t.half[1] && Math.abs(d[2]) <= t.half[2];
    const o = t.obnd || [-48, -48, 0, 48, 48, 10];
    return d[0] >= o[0] * s - 10 && d[0] <= o[3] * s + 10 && d[1] >= o[1] * s - 10 && d[1] <= o[4] * s + 10 && d[2] >= -20 && d[2] <= 60;
  };
  // Whether a player's body (feet + 60 units) is in a trap's swing: its bounds in its own frame, padded by the kind's reach
  const inSwing = (x, p) => {
    const s = Number(x.scale) || 1; const pad = ANIM[x.kind].pad;
    const l = toLocal(x.M, [p[0] - x.pos[0], p[1] - x.pos[1], p[2] + 60 - x.pos[2]]);
    return inBox(l, [x.obnd[0] * s - pad[0], x.obnd[1] * s - pad[1], x.obnd[2] * s - pad[2]], [x.obnd[3] * s + pad[0], x.obnd[4] * s + pad[1], x.obnd[5] * s + pad[2]]);
  };

  // ---- firing ---------------------------------------------------------------------------------------------------------
  const anim = (ref, name) => {
    if (!name) return;
    try { mp.callPapyrusFunction('method', 'ObjectReference', 'PlayAnimation', { type: 'form', desc: ref }, [name]); }
    catch (e) { log(`traps: PlayAnimation(${name}) on ${ref} failed: ${e.message}`); }
  };
  const later = (ms, fn) => { const h = setTimeout(() => { S.timers.delete(h); try { fn(); } catch (e) { log('traps: timer failed', e.message); } }, ms); S.timers.add(h); };
  const levelOf = (a) => { try { return typeof globalThis.__dboCharLevel === 'function' ? Number(globalThis.__dboCharLevel(a)) || 1 : 1; } catch (e) { return 1; } };
  const damageFor = (x, a) => { const lvl = levelOf(a); const thr = Array.isArray(x.thr) ? x.thr : []; let i = 0; while (i < thr.length && lvl >= Number(thr[i])) i++; return Number(x.dmg[Math.min(i, x.dmg.length - 1)]) || 0; };
  const isDead = (a) => { try { return mp.get(a, 'isDead') === true; } catch (e) { return true; } };
  const cellOf = (a) => { try { return normDesc(mp.get(a, 'worldOrCellDesc')); } catch (e) { return ''; } };
  const posOf = (a) => { try { const p = mp.get(a, 'pos'); return Array.isArray(p) ? p : null; } catch (e) { return null; } };
  const staff = (a) => { try { return typeof globalThis.__dboIsStaff === 'function' && !!globalThis.__dboIsStaff(a); } catch (e) { return false; } };
  const exempt = (a) => { try { return typeof globalThis.__dboInEditor === 'function' && globalThis.__dboInEditor(a); } catch (e) { return false; } };
  const swing = (cell, x, by) => {
    const hit = new Set();
    const until = Date.now() + C.hitWindowMs;
    const check = () => {
      for (const a of onlineActors()) {
        if (hit.has(a) || cellOf(a) !== cell || isDead(a) || exempt(a)) continue;
        const p = posOf(a); if (!p || !inSwing(x, p)) continue;
        hit.add(a);
        const dmg = damageFor(x, a);
        if (C.damage && dmg > 0) {
          try { mp.callPapyrusFunction('method', 'Actor', 'DamageActorValue', { type: 'form', desc: mp.getDescFromId(a) }, ['Health', dmg]); }
          catch (e) { log(`traps: damage on ${display(a)} failed: ${e.message}`); }
        }
        if (C.log) log(`traps: ${x.kind} ${x.ref} hit ${display(a)} for ${dmg}${C.damage ? '' : ' (damage off)'} (set off by ${display(by)})`);
      }
      if (Date.now() < until) later(Math.max(50, C.tickMs / 2), check);
    };
    check();
  };
  const fire = (cell, t, by) => {
    S.cool.set(t.ref, Date.now() + C.cooldownSeconds * 1000);
    if (t.trigger === 'pressureplate') { anim(t.ref, 'Down'); later(C.resetSeconds * 1000, () => anim(t.ref, 'Up')); }
    else if (t.trigger === 'tripwire') anim(t.ref, 'Trigger');
    for (const x of t.traps) {
      if ((S.busy.get(x.ref) || 0) > Date.now()) continue;
      S.busy.set(x.ref, Date.now() + C.resetSeconds * 1000);
      const A = ANIM[x.kind];
      later(Math.max(0, Number(x.delay) || 0) * 1000, () => {
        anim(x.ref, A.fire(x));
        later(A.lead, () => swing(cell, x, by));
        const r = A.reset(x); if (r) later(C.resetSeconds * 1000, () => anim(x.ref, r));
      });
    }
    if (C.log) log(`traps: ${display(by)} set off ${t.trigger} ${t.ref} (${t.traps.map((x) => x.kind).join(', ')})`);
  };

  // ---- the watch ------------------------------------------------------------------------------------------------------
  const tick = () => {
    if (!C.enabled || !CELLS.size) return;
    const now = Date.now();
    for (const a of onlineActors()) {
      if (!(Number(profileOf(a)) > 0) || isDead(a) || exempt(a)) continue;
      const list = CELLS.get(cellOf(a)); if (!list) { S.inside.delete(a); continue; }
      const p = posOf(a); if (!p) continue;
      let was = S.inside.get(a); if (!was) { was = new Set(); S.inside.set(a, was); }
      for (const t of list) {
        const on = onTrigger(t, p);
        if (on && !was.has(t.ref)) {
          was.add(t.ref);
          if (C.only !== 'all' && !staff(a)) continue;
          if ((S.cool.get(t.ref) || 0) > now) continue;
          fire(cellOf(a), t, a);
        } else if (!on) was.delete(t.ref);
      }
    }
  };
  every('traps', Math.max(100, Number(C.tickMs) || 250), tick);

  // The server's own run of a trigger box's vanilla script would start the same traps and stall on ProcessTrapHit: the
  // boxes this module handles are kept from it (the wrapper is set once; a reload swaps what it asks)
  const handled = () => { const s = new Set(); for (const list of CELLS.values()) for (const t of list) s.add(normDesc(t.ref)); return s; };
  let HANDLED = handled();
  globalThis.__dboTrapsHandles = (emitterId) => { try { return C.enabled && HANDLED.has(normDesc(mp.getDescFromId(Number(emitterId) >>> 0))); } catch (e) { return false; } };
  if (!globalThis.__dboTrapsWrapped) {
    globalThis.__dboTrapsWrapped = true;
    const inner = mp['onPapyrusEvent:OnTriggerEnter'];
    mp['onPapyrusEvent:OnTriggerEnter'] = function (emitterId, ...rest) {
      try { if (typeof globalThis.__dboTrapsHandles === 'function' && globalThis.__dboTrapsHandles(emitterId)) return false; } catch (e) { /* the vanilla script runs */ }
      return typeof inner === 'function' ? inner.call(this, emitterId, ...rest) : undefined;
    };
  }
  globalThis.__dboTrapsReload = () => { load(); HANDLED = handled(); };
  globalThis.__dboTrapsFire = (a, ref) => { for (const [cell, list] of CELLS) { const t = list.find((x) => normDesc(x.ref) === normDesc(ref)); if (t) { fire(cell, t, a); return true; } } return false; };
  // Staff: /traps (the triggers in this cell, nearest first), /traps fire <ref>, /traps reload
  if (typeof registerChatCommand === 'function') registerChatCommand('traps', (a, args) => {
    const [sub, ref] = String(args || '').trim().split(/\s+/);
    if (sub === 'reload') { globalThis.__dboTrapsReload(); return personal(a, 'traps.json read again.'); }
    if (sub === 'fire' && ref) { const ok = globalThis.__dboTrapsFire(a, ref); if (ok) audit(`TRAPS ${display(a)} fired ${ref} by hand`); return personal(a, ok ? `Fired ${ref}.` : `No trigger ${ref} in traps.json.`); }
    const list = CELLS.get(cellOf(a)) || []; const p = posOf(a);
    if (!list.length || !p) return personal(a, `No traps here. ${C.enabled ? '' : 'Traps are off. '}${C.only === 'all' ? '' : 'Only staff set them off for now.'}`);
    const near = list.map((t) => ({ t, d: Math.round(Math.hypot(t.pos[0] - p[0], t.pos[1] - p[1], t.pos[2] - p[2])) })).sort((x, y) => x.d - y.d).slice(0, 8);
    personal(a, `Traps here (${list.length}): ${near.map(({ t, d }) => `${t.trigger} ${t.ref} at ${d} u -> ${t.traps.map((x) => x.kind).join('+')}`).join('; ')}`);
  }, { admin: true, help: 'the trap triggers here; fire <ref>; reload' });
  globalThis.__dboTrapsTest = { onTrigger, inSwing, damageFor, toWorld, cells: () => CELLS };
};
