// DragonBreak Online: the hold's watch, NPC guards at posts the staff place (Jake and Nate, 23 Oct: "enabling NPC guards
// ... limited to only guards, no legion NPCs, and guards are not lootable and give no xp"; Nate: "no benefits to fighting
// guards. They can send you to jail too", "Jail by an NPC guard will be 30 minutes", then "10 minutes not 30", "use the prisons as overflow for each
// respective hold"). Loaded by gamemode.js after downed.js and jail.js; config "guards".
//
// Posts: guard-posts.json beside the server (runtime data), written by /guardpost add at the staff member's own spot, in the
// hold they stand in. Each post is a guard:<hold>:<n> zone in NPC-Spawns.json (the wildlife.js way), so npcSpawnSystem places
// the hold's guard there and its spawn tag (private.npcSpawner) marks it as the watch's.
// No benefit in fighting them:
//   loot    a dead guard of the watch cannot be searched (the activate chain refuses it)
//   skill   no Wheel work for hitting or killing one, nor for being hit by one (skillrates.js asks __dboWatchNoSkill)
// Jail: a player one of them brings down is raised in a cell of that hold's jail, its prison when the jail is full
// (hold-jails.json; jail.js __dboJailByWatch), for jailMinutes, instead of bleeding out. A hold with no cell to hand, or a
// full one, leaves the down as it is. Guards set on a known beast or an outlaw stay exposure.js's (ff_huntedIn).
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, cfg, registerChatCommand, zoneOfActor } = api;
  const C = Object.assign({
    enabled: true, jailMinutes: 10, radius: 4000, despawnSeconds: 300, respawnSeconds: 900,
    // The hold's own guard (never a Legion NPC); a post may name another with /guardpost add <npc desc>
    npcByHold: { bruma: '6daba:BSHeartland.esm' },
    jailDelayMs: 2500,
  }, cfg.guards || {});
  const PREFIX = 'guard:';
  const SPAWNS_FILE = path.resolve('NPC-Spawns.json');
  const POSTS_FILE = path.resolve('guard-posts.json');
  const id = (a) => Number(a) >>> 0;
  // The hold a player stands in, over all of its land (Nate, 23 Oct: "a hold should encompass all of its land, i tried to
  // place guards in the prison"): a jail or prison cell of hold-jails.json is its hold's; otherwise the realm.js territory
  // of the place, or for an interior of the last place outside (as exposure.js reads it); else the hold zone around them
  const JAIL_HOLD = (() => {
    const m = new Map();
    try { const h = JSON.parse(fs.readFileSync(path.resolve('hold-jails.json'), 'utf8')).holds || {}; for (const [hold, cells] of Object.entries(h)) for (const c of cells) m.set(String(c.cell).toLowerCase(), hold); } catch (e) { /* no jail data */ }
    return m;
  })();
  const normDesc = (d) => { const s = String(d || ''); const i = s.indexOf(':'); if (i < 0) return s.toLowerCase(); const n = parseInt(s.slice(0, i), 16); return `${Number.isFinite(n) ? n.toString(16) : s.slice(0, i)}:${s.slice(i + 1)}`.toLowerCase(); };
  const territoryHold = (world, pos) => {
    try { const t = typeof globalThis.__dboRealmTerritoryAt === 'function' ? globalThis.__dboRealmTerritoryAt(world, pos) : null; return t && t.zone && (!api.zoneById || api.zoneById(t.zone)) ? String(t.zone) : ''; } catch (e) { return ''; }
  };
  const holdHere = (a) => {
    let world = '', pos = null; try { world = String(mp.get(id(a), 'worldOrCellDesc') || ''); pos = mp.get(id(a), 'pos'); } catch (e) { /* gone */ }
    const jail = JAIL_HOLD.get(normDesc(world)); if (jail) return jail;
    let hold = territoryHold(world, pos);
    if (!hold) { try { const last = mp.get(id(a), 'private.lastOutside'); if (last && last.world) hold = territoryHold(String(last.world), last.pos); } catch (e) { /* none kept */ } }
    if (!hold) { try { const z = zoneOfActor(a); hold = (z && z.id) || ''; } catch (e) { hold = ''; } }
    return hold;
  };
  // gamemode.js wakes the dead and sends /unstuck to this hold's temple (templeZoneOf)
  globalThis.__dboHoldHere = holdHere;

  const readPosts = () => { try { const v = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8')); return Array.isArray(v.posts) ? v.posts : []; } catch (e) { return []; } };
  const savePosts = (posts) => { try { let autoDone = []; try { const v = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8')); autoDone = Array.isArray(v.autoDone) ? v.autoDone : []; } catch (e) { /* none yet */ } fs.writeFileSync(POSTS_FILE + '.tmp', JSON.stringify({ posts, autoDone }, null, 1)); fs.renameSync(POSTS_FILE + '.tmp', POSTS_FILE); return true; } catch (e) { log('guards: guard-posts.json write failed', e.message); return false; } };

  // The watch's zones in NPC-Spawns.json, rewritten like wildlife.js's wild:* (other writers' zones are kept)
  const writeZones = () => {
    let root = null, list = [], key = 'zones';
    try {
      const parsed = JSON.parse(fs.readFileSync(SPAWNS_FILE, 'utf8'));
      if (Array.isArray(parsed)) list = parsed; else if (parsed && typeof parsed === 'object') { root = parsed; key = Object.keys(parsed).find((k) => k.toLowerCase() === 'zones') || 'zones'; list = Array.isArray(parsed[key]) ? parsed[key] : []; }
    } catch (e) { /* no file yet */ }
    // A post saved with something that is no NPC desc ("/guardpost add 3", 23 Oct) gets its hold's guard
    const npcOrDefault = (p) => (/^[0-9a-f]+:.+\.es[mpl]$/i.test(String(p.npc || '')) ? p.npc : C.npcByHold[p.hold]);
    // Patrols (Nate, 23 Oct: "yes patrols would be good"): a hold's first posts take its patrolsByHold guards in order, whose
    // own AI walks the base game's patrol routes; the server cannot move an NPC itself
    const patrolOf = new Map();
    for (const [hold, list] of Object.entries(C.patrolsByHold || {})) {
      const posts = readPosts().filter((p) => p.hold === hold).sort((x, y) => Number(x.n) - Number(y.n));
      (Array.isArray(list) ? list : []).forEach((npc, i) => { if (posts[i]) patrolOf.set(`${hold}:${posts[i].n}`, npc); });
    }
    const npcOf = (p) => patrolOf.get(`${p.hold}:${p.n}`) || npcOrDefault(p);
    // onlyHolds: when set, only those holds' posts spawn; the rest stay saved (23 Oct: Skyrim's guards crashed a client
    // fighting a Stormcloak NPC; Bruma's Cyrodiil guards stay on)
    const active = (p) => !Array.isArray(C.onlyHolds) || C.onlyHolds.includes(p.hold);
    const mine = C.enabled ? readPosts().filter((p) => active(p) && npcOf(p)).map((p) => ({ Name: `${PREFIX}${p.hold}:${p.n}`, ID: p.world, POS: p.pos, Size: C.radius, Heading: Number(p.heading) || 0,
      NPC: [{ id: npcOf(p), count: 1 }], Despawn: C.despawnSeconds, Respawn: C.respawnSeconds, Hostile: false })) : [];
    const kept = list.filter((z) => !String((z && (z.Name || z.name)) || '').startsWith(PREFIX));
    const sig = JSON.stringify(mine);
    if (globalThis.__dboGuardsSig === sig && list.length - kept.length === mine.length) return mine.length;
    globalThis.__dboGuardsSig = sig;
    const payload = root ? Object.assign({}, root, { [key]: kept.concat(mine) }) : { zones: kept.concat(mine) };
    try { fs.writeFileSync(SPAWNS_FILE + '.guards.tmp', JSON.stringify(payload, null, 1)); fs.renameSync(SPAWNS_FILE + '.guards.tmp', SPAWNS_FILE); }
    catch (e) { log('NPC-Spawns.json write failed (guards)', e.message); }
    return mine.length;
  };

  // The hold whose watch a spawned NPC belongs to ('' when it is no guard of the watch)
  const watchHoldOf = (a) => {
    let tag = ''; try { tag = String(mp.get(id(a), 'private.npcSpawner') || ''); } catch (e) { return ''; }
    return tag.startsWith(PREFIX) ? (tag.split(':')[1] || '') : '';
  };
  globalThis.__dboIsWatchGuard = (a) => !!watchHoldOf(a);

  // skillrates.js: no Wheel work from a hit on a guard, a guard killed, or a guard's blow taken
  globalThis.__dboWatchNoSkill = (kind, detail) => {
    if (!C.enabled || !detail) return false;
    if (kind === 'hit') return !!watchHoldOf(detail.targetId);
    if (kind === 'kill') return !!watchHoldOf(detail.victimId);
    if (kind === 'hurt') return !!watchHoldOf(detail.aggressorId);
    return false;
  };

  // The activate chain: a dead guard of the watch is never searched
  globalThis.__dboWatchActivate = (target, caster) => {
    if (!C.enabled || !watchHoldOf(target)) return false;
    let dead = false; try { dead = !!mp.get(id(target), 'isDead'); } catch (e) { return false; }
    if (!dead) return false;
    personal(caster, 'The watch carries off its own. There is nothing to take.');
    return true;
  };

  // A player a guard of the watch brought down goes to that hold's jail (downed.js has opened the down by now)
  const jailFromDown = (t, guard) => {
    const hold = watchHoldOf(guard);
    if (!hold || typeof globalThis.__dboJailByWatch !== 'function' || typeof globalThis.__dboDownedWakeIn !== 'function') return;
    setTimeout(() => {
      try {
        if (!(globalThis.__dboIsDowned && globalThis.__dboIsDowned(t))) return;
        const z = typeof api.zoneById === 'function' ? api.zoneById(hold) : null; const holdName = (z && z.name) || hold;
        const r = globalThis.__dboJailByWatch(t, hold, C.jailMinutes, `the watch of ${holdName}`);
        if (!r) { log(`guards: no free cell in ${hold} for ${display(t)}; the down stands`); return; }
        globalThis.__dboDownedWakeIn(t, { cellOrWorldDesc: r.cellDesc, pos: r.pos, rot: [0, 0, 0] },
          `The watch of ${holdName} dragged you to ${r.name}: ${C.jailMinutes} minutes behind bars.`);
        audit(`GUARDS ${who(t)} brought down by the watch of ${hold} and jailed in ${r.name} (${r.kind})`);
      } catch (e) { log('guards: jailing failed', e.message); }
    }, C.jailDelayMs);
  };
  if (!globalThis.__dboGuardsDeathWrapped) {
    const inner = mp.onDeath;
    if (typeof inner === 'function') {
      globalThis.__dboGuardsDeathWrapped = true;
      mp.onDeath = function (actorId, killerId, ...rest) {
        const out = inner.call(this, actorId, killerId, ...rest);
        try { if (typeof globalThis.__dboGuardsOnDeath === 'function') globalThis.__dboGuardsOnDeath(id(actorId), id(killerId)); } catch (e) { log('guards: death hook failed', e.message); }
        return out;
      };
    }
  }
  globalThis.__dboGuardsOnDeath = (a, killer) => {
    if (!C.enabled || !killer || !watchHoldOf(killer)) return;
    let player = false; try { player = Number(mp.get(a, 'profileId')) >= 0; } catch (e) { player = false; }
    if (player) jailFromDown(a, killer);
  };

  if (typeof registerChatCommand === 'function') registerChatCommand('guardpost', (a, args) => {
    const [what, ...rest] = String(args || '').trim().split(/\s+/);
    const posts = readPosts();
    if (what === 'list') {
      if (!posts.length) return personal(a, 'No guard posts yet. Stand where a guard should be and type /guardpost add.');
      return personal(a, `Guard posts (${posts.length}): ${posts.map((p) => `${p.hold} #${p.n}`).join(', ')}`);
    }
    if (what === 'add') {
      const hold = holdHere(a); if (!hold) return personal(a, 'No hold claims this place. Stand on a hold\'s land, or inside one of its buildings.');
      if (rest[0] && !/^[0-9a-f]+:.+\.es[mpl]$/i.test(rest[0])) return personal(a, 'Usage: /guardpost add places one guard where you stand (an optional NPC id like abe18:Skyrim.esm picks another guard). Nothing was placed.');
      const npc = rest[0] || C.npcByHold[hold];
      if (!npc) return personal(a, `There is no guard set for ${hold}: /guardpost add <npc desc>, or add it to guards.npcByHold.`);
      let world = '', pos = null, rot = null;
      try { world = String(mp.get(a, 'worldOrCellDesc')); pos = mp.get(a, 'pos'); rot = mp.get(a, 'angle'); } catch (e) { return personal(a, 'Your position could not be read.'); }
      const n = posts.reduce((m, p) => (p.hold === hold ? Math.max(m, Number(p.n) || 0) : m), 0) + 1;
      posts.push({ hold, n, world, pos: pos.map((x) => Math.round(x)), heading: Math.round(Number(rot && rot[2]) || 0), npc, by: who(a), at: Date.now() });
      if (!savePosts(posts)) return personal(a, 'The post could not be saved.');
      writeZones();
      audit(`GUARDS ${who(a)} placed guard post ${hold} #${n}`);
      return personal(a, `Guard post ${hold} #${n} placed here. Its guard arrives within a minute.`);
    }
    if (what === 'remove') {
      const m = /^([a-z]+)#?(\d+)$/i.exec(rest.join('').replace(/\s+/g, ''));
      const left = m ? posts.filter((p) => !(p.hold === m[1].toLowerCase() && Number(p.n) === Number(m[2]))) : posts;
      if (!m || left.length === posts.length) return personal(a, 'Usage: /guardpost remove <hold> <n> (see /guardpost list)');
      if (!savePosts(left)) return personal(a, 'The posts could not be saved.');
      writeZones();
      audit(`GUARDS ${who(a)} removed guard post ${m[1].toLowerCase()} #${m[2]}`);
      return personal(a, `Guard post ${m[1].toLowerCase()} #${m[2]} removed.`);
    }
    if (what === 'auto') {
      const hold = String(rest[0] || '').toLowerCase();
      if (!SPOTS[hold]) return personal(a, `Usage: /guardpost auto <hold> (${Object.keys(SPOTS).join(', ')})`);
      const k = globalThis.__dboGuardsPlaceSpots(hold, who(a));
      if (!k) return personal(a, `No guard is set for ${hold} (guards.npcByHold).`);
      writeZones();
      audit(`GUARDS ${who(a)} pre-placed ${k} guard posts in ${hold}`);
      return personal(a, `${k} guard posts placed in ${hold}, where its guards stood in the old days. /guardpost list shows them; remove any you don't want.`);
    }
    if (what === 'jailtest') {
      // Staff: be sent to this hold's jail by the watch for one minute, to check where its cells put a prisoner
      const hold = holdHere(a);
      if (!hold || typeof globalThis.__dboJailByWatch !== 'function') return personal(a, 'No hold claims this place.');
      const r = globalThis.__dboJailByWatch(a, hold, 1, `a jail test (${display(a)})`);
      if (!r) return personal(a, `${hold} has no free cell for the watch.`);
      try { mp.set(id(a), 'locationalData', { cellOrWorldDesc: r.cellDesc, pos: r.pos, rot: [0, 0, 0] }); } catch (e) { return personal(a, 'The move failed.'); }
      audit(`GUARDS ${who(a)} ran a jail test in ${r.name}`);
      return personal(a, `Sent to ${r.name} (${r.kind}) for one minute.`);
    }
    return personal(a, 'Usage: /guardpost add [npc desc] | auto <hold> | list | remove <hold> <n> | jailtest');
  }, { admin: true, help: 'add [npc] | auto <hold> | list | remove <hold> <n> | jailtest: the hold watch\'s NPC guard posts' });

  // Pre-placed posts (Nate, 23 Oct: "can you pre place guards? by hand is annoying"): guard-post-spots.json, where the base
  // game's guards stood in each city. Each hold in autoHolds is placed once (autoDone in guard-posts.json), so a post staff
  // remove afterwards stays removed; /guardpost auto <hold> places a hold's spots on demand
  const SPOTS_FILE = (() => { try { return JSON.parse(fs.readFileSync(path.resolve('guard-post-spots.json'), 'utf8')); } catch (e) { return {}; } })();
  const SPOTS = SPOTS_FILE.holds || {};
  // A new spots version replaces a hold's earlier pre-placed (auto) posts once; hand-placed ones stay
  const doneKey = (hold) => (Number(SPOTS_FILE.version) > 1 ? `${hold}@${Number(SPOTS_FILE.version)}` : hold);
  const readDone = () => { try { const v = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8')); return Array.isArray(v.autoDone) ? v.autoDone : []; } catch (e) { return []; } };
  const placeSpots = (hold, by) => {
    const npc = C.npcByHold[hold]; const spots = SPOTS[hold] || [];
    if (!spots.length || (!npc && spots.some((sp) => !sp.npc))) return 0;
    const posts = readPosts().filter((p) => !(p.hold === hold && p.auto)); let n = posts.reduce((m, p) => (p.hold === hold ? Math.max(m, Number(p.n) || 0) : m), 0);
    // A spot may name its own guard (Bruma's: each original guard, so its own vanilla AI package runs)
    for (const sp of spots) posts.push({ hold, n: ++n, world: sp.world, pos: sp.pos, heading: sp.heading, npc: sp.npc || npc, by, at: Date.now(), auto: true });
    const done = [...new Set(readDone().concat(doneKey(hold)))];
    try { fs.writeFileSync(POSTS_FILE + '.tmp', JSON.stringify({ posts, autoDone: done }, null, 1)); fs.renameSync(POSTS_FILE + '.tmp', POSTS_FILE); } catch (e) { log('guards: guard-posts.json write failed', e.message); return 0; }
    return spots.length;
  };
  globalThis.__dboGuardsPlaceSpots = placeSpots;
  if (C.enabled) {
    const done = new Set(readDone());
    for (const hold of C.autoHolds || []) {
      if (done.has(doneKey(hold))) continue;
      const k = placeSpots(hold, 'auto');
      if (k) { log(`guards: ${k} post(s) pre-placed in ${hold}`); audit(`GUARDS server pre-placed ${k} guard posts in ${hold}`); }
    }
  }
  const n = writeZones();
  log(`guards ${C.enabled ? 'on' : 'off'}: ${n} guard post(s), jail ${C.jailMinutes} min`);
};
