// DragonBreak Online: the watch's duty day, server-hosted guards phase 1 (_work server-npc-movement-1102.md, W4's plan;
// W7's guard data, 2 Nov). Loaded by gamemode.js after guards.js; config "guardDuty". Guards only (Nat, 2 Nov: "I just
// want guard NPCs mainly"): townspeople and wildlife are parked.
//
// Shifts: a managed post (one of guards.js's guard:<hold>:<n> zones) is staffed by whichever guard's shift covers the
// world clock's hour (__dboClock). At a change guards.js rewrites the post's zone with the incoming guard, so
// npcSpawnSystem despawns the outgoing one (its signature changed) and spawns the new one at the post; with nobody on
// duty the post has no zone. Off-shift sleep and meals are indoors and come later: until then going off duty is a despawn.
// Routes: the patrol a post's guard walks, as a timeline of straight legs and pauses (routeAt), for W4's server mover to
// ask through globalThis.__dboGuardRouteAt. A route that does not close is walked out and back. No navmesh: the legs are
// straight lines between the patrol markers, which is why phase 1 manages only a one-cell route (Bruma's courtyard).
//
// The data (who covers which post at which hours, the routes' waypoints) is read out of vanilla and mod AI packages, so
// it is derived and stays private (the Leader, 2 Nov): guards.json, posts.json and routes.json in dataDir, which is
// gitignored and never committed; tests/guard-duty-harness.js runs on synthetic fixtures. This code is open.
// Never: a child (Nat: "no children, ever"; any NPC whose base's race is a child race is refused, wherever it came from),
// a Legion or Stormcloak guard (Nat, 2 Nov: Skyrim is independent; only a cover whose side is the hold's own), a duty
// flagged quest_gated, or anything from the four mods whose authors refuse AI work (Druadach, Summerset, Murkmire,
// Journey to Baan Malur).
'use strict';
const fs = require('fs');
const path = require('path');

// ---- the rules, pure (tests/guard-duty-harness.js runs these) ----
const AI_FORBIDDEN = /druadach|summerset|murkmire|baan\s*malur/i;
const SIDES = ['hold'];

// Whether the hour falls in a shift that starts at from and lasts hours (around midnight too); 24 or more is all day
const inShift = (hour, from, hours) => Number(hours) >= 24 || (((Number(hour) - Number(from)) % 24) + 24) % 24 < Number(hours);
// How long the shift has run at that hour, in game hours (the incoming guard of an overlap has run least)
const shiftAge = (hour, from) => (((Number(hour) - Number(from)) % 24) + 24) % 24;

// "Plugin.esm:0790D2" (W7's form) or "790d2:Plugin.esm" (guards.js's) -> guards.js's form; '' when it is neither
const descOf = (d) => {
  const s = String(d || '');
  let m = /^(.+\.es[mpl]):([0-9a-f]{1,8})$/i.exec(s);
  if (m) return `${parseInt(m[2], 16).toString(16)}:${m[1]}`;
  m = /^([0-9a-f]{1,8}):(.+\.es[mpl])$/i.exec(s);
  return m ? `${parseInt(m[1], 16).toString(16)}:${m[2]}` : '';
};
const forbidden = (...descs) => descs.some((d) => AI_FORBIDDEN.test(String(d || '')));

// The cover on duty at a post at that hour, or null: the hold's own side, not quest-gated, any day (the world clock's
// weekday is not trusted yet: W7's gap 1), and the most recently started where two overlap (Whiterun's staggered change)
const onDuty = (post, hour) => {
  let best = null;
  for (const c of Array.isArray(post && post.cover) ? post.cover : []) {
    if (!c || c.quest_gated === true || !SIDES.includes(String(c.side)) || String(c.days || 'any') !== 'any') continue;
    const from = Number(c.from && typeof c.from === 'object' ? c.from.hour : c.from);
    const hours = Number(c.hours && typeof c.hours === 'object' ? c.hours.hours : c.hours);
    if (!Number.isFinite(from) || !Number.isFinite(hours) || !inShift(hour, from, hours)) continue;
    if (!best || shiftAge(hour, from) < best.age) best = { cover: c, age: shiftAge(hour, from), from };
  }
  return best;
};

// A route as a timeline: legs at speed (units a second), the idle at each point after reaching it. Out and back when it
// does not close: 0..n-1 then back down to 1, so no point is idled at twice in a row
const planRoute = (route, speed, idleDefault) => {
  const pts = (Array.isArray(route && route.points) ? route.points : []).filter((p) => p && Array.isArray(p.pos) && p.pos.length === 3 && p.pos.every(Number.isFinite));
  if (pts.length < 2 || !(speed > 0)) return null;
  const order = pts.map((_, i) => i);
  if (route.closes_loop !== true) for (let i = pts.length - 2; i >= 1; i--) order.push(i);
  const segs = [];
  let t = 0;
  for (let k = 0; k < order.length; k++) {
    const a = pts[order[k]], b = pts[order[(k + 1) % order.length]];
    const idle = Number.isFinite(a.idle_s) && a.idle_s >= 0 ? a.idle_s : idleDefault;
    if (idle > 0) { segs.push({ kind: 'idle', at: t, s: idle, from: a.pos, to: a.pos, point: order[k] }); t += idle; }
    const d = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]);
    if (d > 0) { segs.push({ kind: 'walk', at: t, s: d / speed, from: a.pos, to: b.pos, point: order[(k + 1) % order.length] }); t += d / speed; }
  }
  return t > 0 ? { segs, period: t, points: pts.length } : null;
};

// Heading in degrees as Skyrim reads an angle about z: 0 is north (+y), 90 east (+x)
const headingOf = (from, to) => ((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI + 360) % 360;

// Where a guard is t seconds into its plan: position, heading, walking or standing, and the point it walks to or stands at
const routeAt = (plan, t) => {
  if (!plan) return null;
  const at = ((t % plan.period) + plan.period) % plan.period;
  let seg = plan.segs[plan.segs.length - 1];
  for (const s of plan.segs) if (at >= s.at && at < s.at + s.s) { seg = s; break; }
  const f = seg.s > 0 ? Math.min(1, Math.max(0, (at - seg.at) / seg.s)) : 1;
  const pos = seg.from.map((v, i) => v + (seg.to[i] - v) * f);
  const walkSeg = seg.kind === 'walk' ? seg : plan.segs.find((s) => s.kind === 'walk' && s.at >= seg.at) || plan.segs.find((s) => s.kind === 'walk');
  return { pos, heading: walkSeg ? headingOf(walkSeg.from, walkSeg.to) : 0, moving: seg.kind === 'walk', point: seg.point };
};

// ---- the module ----
module.exports = (api) => {
  const { mp, log, personal, audit, who, cfg, registerChatCommand, every } = api;
  const C = Object.assign({
    enabled: false,
    // beside the server, gitignored (private-data/): W7's guards.json, posts.json and routes.json
    dataDir: 'private-data/guard-duty',
    // the posts this manages, by post key (W7's posts.json key); every other guard post is guards.js's as before
    posts: [],
    // walking speed for the timeline, units a second. ASSUMED, not measured: set it from the guard's walk on dev
    walkSpeed: 80,
    idleDefault: 10,
    checkSeconds: 20,
  }, cfg.guardDuty || {});
  const dir = path.resolve(C.dataDir);
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return null; } };
  const guards = C.enabled ? read('guards.json') : null;
  const posts = C.enabled ? read('posts.json') : null;
  const routes = C.enabled ? read('routes.json') : null;
  const ok = Array.isArray(guards) && Array.isArray(posts) && routes && typeof routes === 'object';
  if (C.enabled && !ok) log(`guardduty: no guard data in ${dir}; nothing managed`);

  const guardByNpc = new Map((ok ? guards : []).map((g) => [String(g.npc), g]));
  // A managed post, keyed by the guards.js zone its guards already stand in (guards.json live_zone)
  const managed = new Map();
  for (const key of ok ? (Array.isArray(C.posts) ? C.posts : []) : []) {
    const post = posts.find((p) => p && p.key === key);
    if (!post) { log(`guardduty: post ${key} is not in posts.json`); continue; }
    if (forbidden(post.key)) { log(`guardduty: post ${key} is from a mod whose author refuses AI work; left out`); continue; }
    const zone = (post.cover || []).map((c) => (guardByNpc.get(String(c.guard)) || {}).live_zone).find((z) => typeof z === 'string' && z.startsWith('guard:'));
    if (!zone) { log(`guardduty: post ${key} has no live guard zone to staff`); continue; }
    managed.set(zone.toLowerCase(), { post, zone, plan: routes[post.key] ? planRoute(routes[post.key], C.walkSpeed, C.idleDefault) : null, since: Date.now() });
  }

  // A child race is never spawned, whatever the data says (childrace.js's __dboIsChildRace, from the base's RNAM)
  const childCache = new Map();
  const isChildBase = (desc) => {
    if (childCache.has(desc)) return childCache.get(desc);
    let child = false;
    try {
      const rec = mp.lookupEspmRecordById(mp.getIdFromDesc(desc) >>> 0);
      const f = rec && (rec.record.fields || []).find((x) => x && x.type === 'RNAM' && x.data && x.data.byteLength >= 4);
      const race = f ? rec.toGlobalRecordId(new DataView(f.data.buffer, f.data.byteOffset, 4).getUint32(0, true)) >>> 0 : 0;
      child = !!race && typeof globalThis.__dboIsChildRace === 'function' && globalThis.__dboIsChildRace(race) === true;
    } catch (e) { child = false; }
    childCache.set(desc, child);
    return child;
  };

  const hourNow = () => { try { const c = globalThis.__dboClock; return c && typeof c.hour === 'function' ? Number(c.hour()) : NaN; } catch (e) { return NaN; } };
  const refused = new Set();
  const refuse = (zone, why) => { if (!refused.has(zone + why)) { refused.add(zone + why); log(`guardduty: ${zone}: ${why}`); } };

  // Who staffs a managed zone now: undefined for a zone this does not manage, '' for nobody, else the base desc
  const staffOf = (zone, hour) => {
    const m = managed.get(String(zone).toLowerCase());
    if (!m) return undefined;
    if (!Number.isFinite(hour)) return undefined;
    const on = onDuty(m.post, hour);
    if (!on) return '';
    const g = guardByNpc.get(String(on.cover.guard));
    const desc = descOf(g && (g.spawn_as || g.base));
    if (!desc) { refuse(m.zone, `${on.cover.guard} has no spawn record`); return ''; }
    if (forbidden(desc, g.placed_ref)) { refuse(m.zone, `${on.cover.guard} is from a mod whose author refuses AI work`); return ''; }
    if (isChildBase(desc)) { refuse(m.zone, `${on.cover.guard} is a child; never spawned`); return ''; }
    return desc;
  };
  globalThis.__dboGuardDutyAt = (hold, n) => staffOf(`guard:${hold}:${n}`, hourNow());

  // For the server mover: where the guard of a managed zone should be now
  globalThis.__dboGuardRouteAt = (zone, nowMs) => {
    const m = managed.get(String(zone).toLowerCase());
    if (!m || !m.plan) return null;
    const at = routeAt(m.plan, ((Number(nowMs) || Date.now()) - m.since) / 1000);
    return at && Object.assign(at, { zone: m.zone, route: m.post.key });
  };

  // A shift change: the staffing differs from the last look, so guards.js writes the zones again
  const sigNow = () => JSON.stringify([...managed.keys()].map((z) => [z, staffOf(z, hourNow())]));
  let lastSig = sigNow();
  const check = () => {
    const sig = sigNow();
    if (sig === lastSig) return;
    const before = new Map(JSON.parse(lastSig)), after = JSON.parse(sig);
    lastSig = sig;
    for (const [z, desc] of after) {
      if (before.get(z) === desc) continue;
      const m = managed.get(z);
      if (m) m.since = Date.now();
      log(`guardduty: shift change at ${z}: ${before.get(z) || 'nobody'} -> ${desc || 'nobody'} (hour ${hourNow().toFixed(2)})`);
    }
    if (typeof globalThis.__dboGuardsRewrite === 'function') globalThis.__dboGuardsRewrite();
  };
  if (C.enabled && managed.size && typeof every === 'function') every('guardduty', Math.max(5, Number(C.checkSeconds) || 20) * 1000, check);
  if (managed.size && typeof globalThis.__dboGuardsRewrite === 'function') globalThis.__dboGuardsRewrite();

  if (typeof registerChatCommand === 'function') registerChatCommand('guardduty', (a) => {
    if (!C.enabled) return personal(a, 'Guard duty is off (guardDuty.enabled).');
    const h = hourNow();
    const lines = [...managed.values()].map((m) => {
      const on = onDuty(m.post, h);
      const at = globalThis.__dboGuardRouteAt(m.zone);
      return `${m.zone} (${m.post.name}): ${on ? `${on.cover.guard}, on since ${on.from}:00` : 'nobody on duty'}${at ? `, ${at.moving ? 'walking to' : 'at'} point ${at.point + 1}` : ''}`;
    });
    audit(`GUARDDUTY ${who(a)} read the duty board`);
    return personal(a, lines.length ? lines.join('\n') : 'No guard post is managed (guardDuty.posts).');
  }, { admin: true, help: 'who is on duty at each managed guard post' });

  log(`guardduty ${C.enabled ? 'on' : 'off'}: ${managed.size} post(s) managed`);
};
module.exports.core = { inShift, onDuty, descOf, forbidden, planRoute, routeAt, headingOf };
