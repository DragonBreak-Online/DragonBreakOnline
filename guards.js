// DragonBreak Online: the hold's watch, NPC guards at posts the staff place (Jake and Nate, 23 Oct: "enabling NPC guards
// ... limited to only guards, no legion NPCs, and guards are not lootable and give no xp"; Nate: "no benefits to fighting
// guards. They can send you to jail too", "Jail by an NPC guard will be 30 minutes", "use the prisons as overflow for each
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
    enabled: true, jailMinutes: 30, radius: 600, despawnSeconds: 300, respawnSeconds: 900,
    // The hold's own guard (never a Legion NPC); a post may name another with /guardpost add <npc desc>
    npcByHold: { bruma: '6daba:BSHeartland.esm' },
    jailDelayMs: 2500,
  }, cfg.guards || {});
  const PREFIX = 'guard:';
  const SPAWNS_FILE = path.resolve('NPC-Spawns.json');
  const POSTS_FILE = path.resolve('guard-posts.json');
  const id = (a) => Number(a) >>> 0;

  const readPosts = () => { try { const v = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8')); return Array.isArray(v.posts) ? v.posts : []; } catch (e) { return []; } };
  const savePosts = (posts) => { try { fs.writeFileSync(POSTS_FILE + '.tmp', JSON.stringify({ posts }, null, 1)); fs.renameSync(POSTS_FILE + '.tmp', POSTS_FILE); return true; } catch (e) { log('guards: guard-posts.json write failed', e.message); return false; } };

  // The watch's zones in NPC-Spawns.json, rewritten like wildlife.js's wild:* (other writers' zones are kept)
  const writeZones = () => {
    let root = null, list = [], key = 'zones';
    try {
      const parsed = JSON.parse(fs.readFileSync(SPAWNS_FILE, 'utf8'));
      if (Array.isArray(parsed)) list = parsed; else if (parsed && typeof parsed === 'object') { root = parsed; key = Object.keys(parsed).find((k) => k.toLowerCase() === 'zones') || 'zones'; list = Array.isArray(parsed[key]) ? parsed[key] : []; }
    } catch (e) { /* no file yet */ }
    const mine = C.enabled ? readPosts().map((p) => ({ Name: `${PREFIX}${p.hold}:${p.n}`, ID: p.world, POS: p.pos, Size: C.radius, Heading: Number(p.heading) || 0,
      NPC: [{ id: p.npc, count: 1 }], Despawn: C.despawnSeconds, Respawn: C.respawnSeconds, Hostile: false })) : [];
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
      let z = null; try { z = zoneOfActor(a); } catch (e) { z = null; }
      const hold = z && z.id; if (!hold) return personal(a, 'Stand inside a hold to place its guard.');
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
    if (what === 'jailtest') {
      // Staff: be sent to this hold's jail by the watch for one minute, to check where its cells put a prisoner
      let z = null; try { z = zoneOfActor(a); } catch (e) { z = null; }
      const hold = z && z.id;
      if (!hold || typeof globalThis.__dboJailByWatch !== 'function') return personal(a, 'Stand inside a hold.');
      const r = globalThis.__dboJailByWatch(a, hold, 1, `a jail test (${display(a)})`);
      if (!r) return personal(a, `${hold} has no free cell for the watch.`);
      try { mp.set(id(a), 'locationalData', { cellOrWorldDesc: r.cellDesc, pos: r.pos, rot: [0, 0, 0] }); } catch (e) { return personal(a, 'The move failed.'); }
      audit(`GUARDS ${who(a)} ran a jail test in ${r.name}`);
      return personal(a, `Sent to ${r.name} (${r.kind}) for one minute.`);
    }
    return personal(a, 'Usage: /guardpost add [npc desc] | list | remove <hold> <n> | jailtest');
  }, { admin: true, help: 'add [npc] | list | remove <hold> <n> | jailtest: the hold watch\'s NPC guard posts' });

  const n = writeZones();
  log(`guards ${C.enabled ? 'on' : 'off'}: ${n} guard post(s), jail ${C.jailMinutes} min`);
};
