// DragonBreak Online: bosses worth grinding (Nat, 25 Oct: "other than the dragon priest we should develop other bosses people
// could grind for special drops/schematics"; design _work/boss-roster-design-1025.md on the PC). Loaded by gamemode.js after
// champions.js.
//
// bosses.json (tools/bosses/bosses_build.py from tools/bosses/boss-defs.json) defines each boss: its spot (the first of its
// candidates, or the next one after each kill when it roams), its base and adds resolved to NPC_ options, an optional guardian,
// its waves, toughness, damage and enrage, its respawn and its drops. A boss with enabled false waits on Nat.
//
// The fight, all server side:
//   spawn      permanent boss:<id>:<role> zones in NPC-Spawns.json (the wildlife.js and dungeons.js way), every one hostile; the
//              boss takes the strongest of its line. The server's SetScale is a stub (champions.js), so a boss is named
//              (SetDisplayName) and marked with the champions' rim glow instead of being made bigger
//   toughness  a share of each hit is given back to the boss (champions.js's give-back), more while its guardian lives
//   waves      at each share of the boss's health, add zones are written beside it; they go when the fight ends
//   enrage     enrageSeconds after the first blow the give-back falls and the boss's hits grow (enrage.toughness, damageMult)
//   damage     the boss's hits on a player x damageMult (gamemode.js asks __dboBossDamageMult in the attempt chain)
// The reward: every player with creditShare (10%) or more of the damage dealt to the boss and its guardian (a summon's or a
// companion's counted for its owner) rolls their own loot: drops.always, shards (the top damager drops.shards.top), the
// schematic of drops.schematic.family at its chance (a smith who knows it gets knownBonus more shards instead), and
// drops.extraSchematic. One reward per account per boss every lockoutHours (20); a kill inside it pays nothing. A boss that
// excludes Briarhearts pays none to one (briarheart.js __dboIsBriarheart). The hold hears when the boss rises and falls.
// When:  a boss with night true stands only at night (worldclock.js __dboClock.isNight), its fight running on past dawn; a
//         boss with event { minutes, waveEverySeconds, waveSize } stands only while an event a Lead GM starts lasts
//         (/bossevent <id>), and a wave of waveSize adds comes every waveEverySeconds until it ends, felled or not. A boss
//         with fullMoon true (or its config block's fullMoon) stands only on a full-moon night (__dboClock.isFullMoon), its
//         fight running on past dawn as a night boss's does (the Werewolf Behemoth, 25 Oct).
// Rare extras: drops.extra [[desc, chance, count]] rolled for each rewarded fighter (the Centurion's Heart Stone).
// Tests: a boss with devOnly true runs only where bosses.devOnly is true (the dev server); rearm names a weapon put back in
// a spawned boss's inventory when it lacks it (dungeons.js's arming: the server's EquipBestWeapon wears it at the next host
// grant), and traceEquipment logs every change of the boss's equipment (the Minotaur Lord's axe test, 25 Oct).
// State in bosses-state.json: { lockouts: { <boss>: { <profile>: until } }, spot: { <boss>: index }, kills: { <boss>: at } }.
// gamemode-config.json "bosses": { enabled, creditShare, lockoutHours, pollSeconds, only: [ids], off: [ids], <boss id>: { enabled, spot } }:
// each boss goes live on its own (its block's enabled over bosses.json's), and spot names the candidate it stands at (Nat's pick)
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, display, who, cfg, giveItem, registerChatCommand, sendPacket, onlineActors, every, stopTimer, profileOf, zoneOfActor } = api;
  // Starting an event boss is a spawn: Lead GM and above (TIER_CAPS.spawn), as /spawn is
  const isLeadStaff = typeof api.isLeadStaff === 'function' ? api.isLeadStaff : () => false;
  const C = Object.assign({ enabled: true, creditShare: 0.1, lockoutHours: 20, pollSeconds: 2, only: null, off: [] }, cfg.bosses || {});
  const PREFIX = 'boss:';
  const SPAWNS_FILE = path.resolve('NPC-Spawns.json');
  const LIVE_FILE = path.resolve('zone-spawns.json');
  const STATE_FILE = path.resolve('bosses-state.json');
  const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } };
  const DEFS = (readJson(path.resolve('bosses.json'), { bosses: [] }).bosses || []).filter((b) => b && b.id && b.boss && Array.isArray(b.spots) && b.spots.length);
  const own = (b) => (C[b.id] && typeof C[b.id] === 'object' ? C[b.id] : {});
  const on = (b) => C.enabled && (!b.devOnly || C.devOnly === true) && (own(b).enabled !== undefined ? own(b).enabled === true : b.enabled !== false) && (!Array.isArray(C.only) || C.only.includes(b.id)) && !(C.off || []).includes(b.id);
  const BOSSES = DEFS.filter(on);
  const byId = new Map(BOSSES.map((b) => [b.id, b]));
  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };
  const get = (id, k) => { try { return mp.get(id, k); } catch (e) { return undefined; } };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isPlayer = (a) => { try { return Number(profileOf(a >>> 0)) >= 0; } catch (e) { return false; } };
  // "the Briarheart King" at the start of a sentence
  const titled = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

  // Kept across hot reloads: a reload mid-fight keeps the damage, the waves spent and the enrage
  const G = globalThis.__dboBosses || (globalThis.__dboBosses = { fights: new Map(), byActor: new Map(), state: null });
  if (!(G.fights instanceof Map)) G.fights = new Map();
  if (!(G.events instanceof Map)) G.events = new Map(); // boss id -> { until, nextWave, waves: [zone], by }
  if (!(G.byActor instanceof Map)) G.byActor = new Map();
  const state = () => {
    if (G.state) return G.state;
    G.state = readJson(STATE_FILE, {});
    for (const k of ['lockouts', 'spot', 'kills']) if (!G.state[k] || typeof G.state[k] !== 'object') G.state[k] = {};
    return G.state;
  };
  const saveState = () => { try { fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state(), null, 1)); fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); } catch (e) { log('bosses: state save failed', e.message); } };

  // ---- zones --------------------------------------------------------------------------------------------------------
  const pickHigh = (options) => { const s = (options || []).slice().sort((x, y) => x[0] - y[0]); return s.length ? s[s.length - 1][1] : null; };
  const pickMid = (options) => { const s = (options || []).slice().sort((x, y) => x[0] - y[0]); return s.length ? s[Math.floor(s.length / 2)][1] : null; };
  // A config spot (an id or an index) fixes where a boss stands; a roaming boss otherwise moves on after each kill
  const spotOf = (b) => {
    const pin = own(b).spot;
    if (pin !== undefined && pin !== null) { const byName = b.spots.find((sp) => sp.id === String(pin)); if (byName) return byName; if (b.spots[Number(pin)]) return b.spots[Number(pin)]; }
    return b.spots[(Number(state().spot[b.id]) || 0) % b.spots.length];
  };
  const ring = (pos, i, n, r) => { const t = (2 * Math.PI * i) / Math.max(1, n); return [pos[0] + Math.cos(t) * r, pos[1] + Math.sin(t) * r, pos[2]]; };
  const zone = (b, role, pos, npc, respawn, heading) => ({ Name: `${PREFIX}${b.id}:${role}`, ID: b.world, POS: pos.map((v) => Math.round(v * 100) / 100), Size: Number(b.radius) || 6000,
    Anchor: spotOf(b).ref, Heading: Number(heading) || 0, NPC: [{ id: npc, count: 1 }], Despawn: 240, Respawn: respawn, Hostile: true });
  const addOf = (b, n) => { const a = (b.adds || [])[n % Math.max(1, (b.adds || []).length)]; return a ? pickMid(a.options) : null; };
  const zonesOf = (b) => {
    const sp = spotOf(b);
    const out = [zone(b, 'boss', sp.pos, pickHigh(b.boss.options), Number(b.respawnSeconds) || 10800, sp.heading)];
    if (b.guardian && b.guardian.options) {
      const off = Array.isArray(b.guardian.offset) ? b.guardian.offset : [200, 0, 0];
      out.push(zone(b, 'guardian', [sp.pos[0] + off[0], sp.pos[1] + off[1], sp.pos[2] + (off[2] || 0)], pickHigh(b.guardian.options), Number(b.respawnSeconds) || 10800, sp.heading));
    }
    for (let i = 0; i < (Number(b.openingAdds) || 0); i++) { const id = addOf(b, i); if (id) out.push(zone(b, `open${i}`, ring(sp.pos, i, b.openingAdds, 350), id, Number(b.respawnSeconds) || 10800, sp.heading)); }
    const f = G.fights.get(b.id);
    for (const w of (f && f.waveZones) || []) out.push(w);
    const ev = G.events.get(b.id);
    for (const w of (ev && ev.waves) || []) out.push(w);
    return out;
  };
  // Whether a boss stands now: an event boss while its event lasts, a night boss at night or while its fight goes on
  const isNight = () => { try { return !!(globalThis.__dboClock && typeof globalThis.__dboClock.isNight === 'function' && globalThis.__dboClock.isNight()); } catch (e) { return false; } };
  const isFullMoon = () => { try { return !!(globalThis.__dboClock && typeof globalThis.__dboClock.isFullMoon === 'function' && globalThis.__dboClock.isFullMoon()); } catch (e) { return false; } };
  function standing(b) {
    if (b.event) { const ev = G.events.get(b.id); return !!ev && ev.until > Date.now(); }
    const moon = own(b).fullMoon !== undefined ? own(b).fullMoon === true : b.fullMoon === true;
    if (moon) { const f = G.fights.get(b.id); return (isNight() && isFullMoon()) || !!(f && f.boss && f.startedAt); }
    if (b.night) { const f = G.fights.get(b.id); return isNight() || !!(f && f.boss && f.startedAt); }
    return true;
  }
  const standingSig = () => BOSSES.map((b) => (standing(b) ? '1' : '0')).join('');
  const writeZones = () => {
    let root = null, list = [], key = 'zones';
    try {
      const parsed = JSON.parse(fs.readFileSync(SPAWNS_FILE, 'utf8'));
      if (Array.isArray(parsed)) list = parsed; else if (parsed && typeof parsed === 'object') { root = parsed; key = Object.keys(parsed).find((k) => k.toLowerCase() === 'zones') || 'zones'; list = Array.isArray(parsed[key]) ? parsed[key] : []; }
    } catch (e) { /* no file yet */ }
    const kept = list.filter((z) => !String((z && (z.Name || z.name)) || '').startsWith(PREFIX));
    const mine = [].concat(...BOSSES.filter(standing).map(zonesOf)).filter((z) => z.NPC[0].id);
    const sig = JSON.stringify(mine);
    if (G.zoneSig === sig && list.length - kept.length === mine.length) return mine.length;
    G.zoneSig = sig;
    const payload = root ? Object.assign({}, root, { [key]: kept.concat(mine) }) : { zones: kept.concat(mine) };
    try { fs.writeFileSync(SPAWNS_FILE + '.tmp', JSON.stringify(payload, null, 1)); fs.renameSync(SPAWNS_FILE + '.tmp', SPAWNS_FILE); }
    catch (e) { log('bosses: NPC-Spawns.json write failed', e.message); }
    return mine.length;
  };

  // ---- the fight ----------------------------------------------------------------------------------------------------
  const roleOf = (tag) => { const m = /^boss:([a-z0-9]+):([a-z0-9-]+)$/.exec(String(tag || '')); return m && byId.has(m[1]) ? { boss: byId.get(m[1]), role: m[2] } : null; };
  const name = (id, text) => { try { mp.callPapyrusFunction('method', 'ObjectReference', 'SetDisplayName', { type: 'form', desc: mp.getDescFromId(id >>> 0) }, [text, true]); } catch (e) { log('bosses: naming failed', e.message); } };
  const glow = (ids, on, world) => { for (const a of onlineActors()) { if (world && String(get(a, 'worldOrCellDesc') || '') !== world) continue; try { sendPacket(a, { customPacketType: 'dboGlow', refs: ids, on, kind: 'champion' }); } catch (e) { /* offline */ } } };
  const healthOf = (id) => { const p = get(id, 'percentages'); return p && typeof p.health === 'number' ? p.health : null; };
  const setHealth = (id, h) => { const p = get(id, 'percentages'); if (!p) return; try { mp.set(id, 'percentages', { health: clamp(h, 0, 1), magicka: p.magicka, stamina: p.stamina }); } catch (e) { log('bosses: heal failed', e.message); } };
  const hearers = (b) => onlineActors().filter((a) => {
    if (b.hold) { let z = ''; try { const v = zoneOfActor(a); z = v ? String(v.id || v) : ''; } catch (e) { z = ''; } return z === b.hold; }
    return String(get(a, 'worldOrCellDesc') || '').toLowerCase() === String(b.world).toLowerCase();
  });
  const tell = (b, text) => { if (text) for (const a of hearers(b)) personal(a, text); };
  const fightOf = (b) => { let f = G.fights.get(b.id); if (!f) { f = { boss: 0, guardian: 0, health: 1, damage: new Map(), startedAt: 0, enraged: false, waves: 0, waveZones: [] }; G.fights.set(b.id, f); } return f; };
  const toughnessOf = (b, f) => {
    if (f.enraged && b.enrage) return Number(b.enrage.toughness) || 0;
    if (b.guardian && f.guardian) return Number(b.guardian.bossToughnessWhileAlive) || Number(b.toughness) || 0;
    return Number(b.toughness) || 0;
  };
  const endFight = (b, why) => {
    const f = G.fights.get(b.id);
    if (!f) return;
    if (f.boss) { G.byActor.delete(f.boss); glow([f.boss], false, b.world); }
    if (f.guardian) G.byActor.delete(f.guardian);
    G.fights.delete(b.id);
    if (f.waveZones.length) writeZones();
    log(`bosses: ${b.id} fight over (${why})`);
  };

  // New live ids are the spawner's work: a boss, its guardian, or an add
  const sweep = () => {
    const ids = readJson(LIVE_FILE, null);
    if (!Array.isArray(ids)) return;
    const live = new Set(ids.map((x) => Number(x) >>> 0));
    for (const b of BOSSES) {
      const f = G.fights.get(b.id);
      if (f && f.boss && !live.has(f.boss)) endFight(b, 'despawned');
      else if (f && f.guardian && !live.has(f.guardian)) { G.byActor.delete(f.guardian); f.guardian = 0; }
    }
    for (const id of live) {
      if (G.byActor.has(id)) continue;
      // A felled boss lies in the live list until its body despawns; its fight is over, so it would be taken for a new one
      // rising (dev, 25 Oct: the Centurion "rose" 0.6 s after his kill, announced and glowing, until the body went)
      if (get(id, 'isDead') === true) continue;
      const r = roleOf(get(id, 'private.npcSpawner'));
      if (!r) continue;
      const f = fightOf(r.boss);
      if (r.role === 'boss' && !f.boss) {
        f.boss = id; f.health = healthOf(id) ?? 1;
        G.byActor.set(id, { boss: r.boss.id, role: 'boss' });
        name(id, titled(r.boss.name));
        glow([id], true, r.boss.world);
        tell(r.boss, (r.boss.announce || {}).spawn);
        audit(`BOSS ${r.boss.id} rose at ${spotOf(r.boss).id}`);
        if (r.boss.rearm) rearm(r.boss, id);
      } else if (r.role !== 'boss' && r.role !== 'guardian' && r.boss.rearmAdds) {
        // An add of a kind whose weapon would not stay in hand (the Minotaur Lord's minotaurs) gets it back once
        if (!G.armedAdds) G.armedAdds = new Set();
        if (!G.armedAdds.has(id)) { G.armedAdds.add(id); rearm(r.boss, id, r.boss.rearmAdds); if (G.armedAdds.size > 2000) G.armedAdds.clear(); }
      } else if (r.role === 'guardian' && !f.guardian) {
        f.guardian = id;
        G.byActor.set(id, { boss: r.boss.id, role: 'guardian' });
        if (r.boss.guardian && r.boss.guardian.name) name(id, titled(r.boss.guardian.name));
      }
    }
    const now = Date.now();
    // Events: a wave every waveEverySeconds, and the end
    for (const b of BOSSES) {
      const ev = G.events.get(b.id);
      if (!ev || !b.event) continue;
      if (ev.until <= now) {
        G.events.delete(b.id);
        endFight(b, 'event over');
        tell(b, `The ${b.name.replace(/^the /, '')} withdraws. The gate falls quiet.`);
        audit(`BOSS ${b.id} event ended`);
        continue;
      }
      if (now >= ev.nextWave) {
        const sp = spotOf(b);
        const n = Math.max(1, Number(b.event.waveSize) || 3);
        for (let i = 0; i < n; i++) { const id = addOf(b, ev.count + i); if (id) ev.waves.push(zone(b, `e${ev.count}-${i}`, ring(sp.pos, i, n, 600), id, 1e9, sp.heading)); }
        ev.count += n;
        ev.nextWave = now + Math.max(30, Number(b.event.waveEverySeconds) || 300) * 1000;
        G.zoneSig = '';
      }
    }
    // A night boss rises at dusk and goes at dawn; an event's zones come and go with it
    const sig = standingSig();
    if (sig !== G.standingSig || G.zoneSig === '') { G.standingSig = sig; writeZones(); }
    // The equipment trace of a test boss: a line whenever what it wears changes
    for (const b of BOSSES) {
      const f = G.fights.get(b.id);
      if (!f || !f.boss || !b.traceEquipment) continue;
      const eq = worn(f.boss);
      if (eq !== f.lastWorn) { log(`bosses: ${b.id} ${f.boss.toString(16)} equipment ${f.lastWorn === undefined ? 'at spawn' : 'changed'}: ${eq}`); f.lastWorn = eq; }
    }
    // Enrage
    for (const b of BOSSES) {
      const f = G.fights.get(b.id);
      if (!f || !f.boss || !f.startedAt || f.enraged || !(Number(b.enrageSeconds) > 0)) continue;
      if (now - f.startedAt >= Number(b.enrageSeconds) * 1000) {
        f.enraged = true;
        for (const p of f.damage.keys()) personal(p, `${titled(b.name)} grows furious.`);
        log(`bosses: ${b.id} enraged`);
      }
    }
  };

  // What a boss wears, for the trace: its equipment's worn entries, else the raw value
  const worn = (id) => {
    const eq = get(id, 'equipment');
    const entries = eq && eq.inv && Array.isArray(eq.inv.entries) ? eq.inv.entries : null;
    if (entries) return JSON.stringify(entries.filter((e) => e && e.worn).map((e) => (Number(e.baseId) >>> 0).toString(16)));
    return JSON.stringify(eq === undefined ? null : eq).slice(0, 300);
  };
  // The weapon a test boss should hold, back in its inventory when the copy came without it (dungeons.js armLease)
  const rearm = (b, id, weapon = b.rearm) => {
    const wid = idOf(weapon);
    if (!wid) return;
    let entries = []; try { const inv = mp.get(id, 'inventory'); entries = inv && Array.isArray(inv.entries) ? inv.entries.slice() : []; } catch (e) { return; }
    const had = entries.some((e) => (Number(e.baseId) >>> 0) === wid);
    if (!had) { entries.push({ baseId: wid, count: 1 }); try { mp.set(id, 'inventory', { entries }); } catch (e) { log('bosses: rearm failed', e.message); return; } }
    log(`bosses: ${b.id} ${id.toString(16)} ${had ? 'already carries' : 'rearmed with'} ${weapon} (worn on the next host grant)`);
  };

  // A summon's, a raised corpse's or a companion's blow counts for its owner (contracts.js creditedTo)
  const creditedTo = (a) => {
    try { if (mp.get(a, 'private.dboCompanion')) { const o = Number(mp.get(a, 'ff_companionOf')) >>> 0; if (o) return o; } } catch (e) { /* not one */ }
    return a;
  };
  globalThis.__dboBossHit = (agg, tgt, dealt) => {
    const who2 = G.byActor.get(tgt >>> 0);
    if (!who2) return;
    const b = byId.get(who2.boss); const f = b && G.fights.get(b.id);
    if (!b || !f) return;
    const p = creditedTo(agg >>> 0);
    if (isPlayer(p)) { f.damage.set(p, (f.damage.get(p) || 0) + Math.max(0, Number(dealt) || 0)); if (!f.startedAt) f.startedAt = Date.now(); }
    if (who2.role !== 'boss') return;
    const now = healthOf(tgt);
    if (now === null || now <= 0) { f.health = 0; return; }
    const lost = f.health - now;
    let h = now;
    if (lost > 0) { h = clamp(now + lost * clamp(toughnessOf(b, f), 0, 0.95), 0, 1); setHealth(tgt, h); }
    f.health = h;
    // Waves: each share of health crossed writes its adds beside the boss
    const waves = Array.isArray(b.waves) ? b.waves : [];
    let wrote = false;
    while (f.waves < waves.length && h <= Number(waves[f.waves][0])) {
      const [, n] = waves[f.waves];
      const sp = spotOf(b);
      let pos = sp.pos; try { const q = mp.get(tgt, 'pos'); if (Array.isArray(q)) pos = q; } catch (e) { /* the spot */ }
      for (let i = 0; i < Number(n); i++) { const id = addOf(b, f.waves + i); if (id) f.waveZones.push(zone(b, `w${f.waves}-${i}`, ring(pos, i, Number(n), 450), id, 1e9, sp.heading)); }
      for (const pl of f.damage.keys()) personal(pl, `${titled(b.name)} calls for help.`);
      f.waves++; wrote = true;
    }
    if (wrote) writeZones();
  };
  globalThis.__dboBossDamageMult = (agg, tgt) => {
    const w = G.byActor.get(agg >>> 0);
    if (!w || w.role !== 'boss' || !isPlayer(tgt >>> 0)) return 1;
    const b = byId.get(w.boss); const f = b && G.fights.get(b.id);
    if (!b) return 1;
    const m = f && f.enraged && b.enrage ? Number(b.enrage.damageMult) : Number(b.damageMult);
    return m > 0 ? m : 1;
  };

  // ---- the reward ---------------------------------------------------------------------------------------------------
  const lockoutOf = (b, pid) => Number(((state().lockouts[b.id] || {})[pid])) || 0;
  const giveDesc = (a, desc, n) => { const id = idOf(desc); return id && n > 0 ? giveItem(a, id, n) !== false : false; };
  const schematic = (a, fam) => {
    try {
      const book = typeof globalThis.__dboSchematicBook === 'function' ? globalThis.__dboSchematicBook(fam) : null;
      if (!book) return { given: false, known: false };
      if (typeof globalThis.__dboKnowsFamily === 'function' && globalThis.__dboKnowsFamily(a, fam)) return { given: false, known: true, name: book.name };
      return { given: giveItem(a, book.bookId, 1) !== false, known: false, name: book.name };
    } catch (e) { log('bosses: schematic failed', e.message); return { given: false, known: false }; }
  };
  const reward = (b, f, killer) => {
    let total = 0; for (const d of f.damage.values()) total += d;
    const share = clamp(Number(C.creditShare) || 0.1, 0, 1);
    let fighters = [...f.damage.entries()].filter(([, d]) => total <= 0 || d / total >= share).map(([p]) => p).filter(isPlayer);
    if (killer && isPlayer(killer) && !fighters.includes(killer)) fighters.push(killer);
    if (b.excludeBriarhearts && typeof globalThis.__dboIsBriarheart === 'function') {
      for (const p of fighters.filter((x) => { try { return globalThis.__dboIsBriarheart(x); } catch (e) { return false; } })) personal(p, `${titled(b.name)} was of your own blood. The Hagravens give you nothing for it.`);
      fighters = fighters.filter((x) => { try { return !globalThis.__dboIsBriarheart(x); } catch (e) { return true; } });
    }
    const top = fighters.slice().sort((x, y) => (f.damage.get(y) || 0) - (f.damage.get(x) || 0))[0];
    const now = Date.now(), lock = Math.max(0, Number(C.lockoutHours) || 20) * 3600000;
    const dr = b.drops || {};
    const names = [];
    for (const p of fighters) {
      const pid = String(profileOf(p));
      const until = lockoutOf(b, pid);
      if (until > now) { personal(p, `${titled(b.name)} falls, but you have had your reward from it lately. ${Math.ceil((until - now) / 3600000)} hours to go.`); names.push(`${display(p)} (locked out)`); continue; }
      const got = [];
      for (const [desc, n] of dr.always || []) if (giveDesc(p, desc, Number(n))) got.push(`${n}x ${desc}`);
      let shards = 0;
      if (dr.shards && dr.shards.desc) shards = Number(p === top ? dr.shards.top : dr.shards.count) || 0;
      if (dr.schematic && Math.random() < (Number(dr.schematic.chance) || 0)) {
        const s = schematic(p, dr.schematic.family);
        if (s.given) { got.push(s.name); personal(p, `Among the remains you find ${s.name}.`); }
        else if (s.known && dr.shards && dr.shards.desc) shards += Number(dr.schematic.knownBonus) || 0;
      }
      if (dr.extraSchematic && Math.random() < (Number(dr.extraSchematic.chance) || 0)) {
        const s = schematic(p, dr.extraSchematic.family);
        if (s.given) { got.push(s.name); personal(p, `Among the remains you find ${s.name}.`); }
      }
      for (const [desc, chance, n] of dr.extra || []) if (Math.random() < (Number(chance) || 0) && giveDesc(p, desc, Number(n) || 1)) got.push(`${Number(n) || 1}x ${desc} (rare)`);
      if (shards > 0 && giveDesc(p, dr.shards.desc, shards)) got.push(`${shards}x ${dr.shards.desc}`);
      (state().lockouts[b.id] = state().lockouts[b.id] || {})[pid] = now + lock;
      personal(p, `${titled(b.name)} falls.${got.length ? ' Your share is in your pack.' : ''}`);
      names.push(`${display(p)} [${got.join(', ') || 'nothing'}]`);
    }
    for (const k of Object.keys(state().lockouts[b.id] || {})) if (Number(state().lockouts[b.id][k]) < now) delete state().lockouts[b.id][k];
    return names;
  };
  globalThis.__dboBossDeath = (actorId, killerId) => {
    const w = G.byActor.get(actorId >>> 0);
    if (!w) return;
    const b = byId.get(w.boss); const f = b && G.fights.get(b.id);
    if (!b || !f) return;
    if (w.role === 'guardian') {
      G.byActor.delete(actorId >>> 0); f.guardian = 0;
      for (const p of f.damage.keys()) personal(p, `${titled(b.guardian.name || 'the guardian')} falls: ${b.name} is laid open.`);
      return;
    }
    if (w.role !== 'boss') return;
    const names = reward(b, f, creditedTo(killerId >>> 0));
    tell(b, (b.announce || {}).death);
    audit(`BOSS ${b.id} killed at ${spotOf(b).id}${f.enraged ? ' (enraged)' : ''} by ${names.join('; ') || 'nobody'}`);
    state().kills[b.id] = Date.now();
    if (b.roam && b.spots.length > 1) state().spot[b.id] = ((Number(state().spot[b.id]) || 0) + 1) % b.spots.length;
    saveState();
    endFight(b, 'killed');
    writeZones();
  };

  registerChatCommand('bossevent', (a, args) => {
    if (!isLeadStaff(a)) return personal(a, 'Only a Lead GM or above starts a boss event.');
    const id = String((Array.isArray(args) ? args[0] : String(args || '').split(/\s+/)[0]) || '').toLowerCase();
    const b = byId.get(id);
    const events = BOSSES.filter((x) => x.event).map((x) => x.id);
    if (!b || !b.event) return personal(a, `Usage: /bossevent <${events.join('|') || 'no event boss is on'}>`);
    if (G.events.has(b.id)) return personal(a, `${titled(b.name)} is already abroad.`);
    const now = Date.now();
    G.events.set(b.id, { until: now + Math.max(1, Number(b.event.minutes) || 30) * 60000, nextWave: now + Math.max(30, Number(b.event.waveEverySeconds) || 300) * 1000, waves: [], count: 0, by: who(a) });
    G.standingSig = ''; G.zoneSig = '';
    writeZones();
    audit(`BOSS ${b.id} event started by ${who(a)} for ${b.event.minutes} min`);
    personal(a, `${titled(b.name)} is coming, for ${b.event.minutes} minutes.`);
  }, { admin: true, help: '<boss> start an event boss (Lead GM): the Valkynaz of the Great Gate' });

  registerChatCommand('bosses', (a) => {
    if (!BOSSES.length) return personal(a, 'No bosses walk the world right now.');
    const now = Date.now();
    const pid = String(profileOf(a));
    personal(a, BOSSES.map((b) => {
      const f = G.fights.get(b.id);
      const until = lockoutOf(b, pid);
      return `${titled(b.name)}: ${f && f.boss ? 'abroad' : 'resting'}${until > now ? `, your reward in ${Math.ceil((until - now) / 3600000)} h` : ''}`;
    }).join('. ') + '.');
  }, { help: 'the bosses, and when each can reward you again' });

  const zonesWritten = writeZones();
  if (BOSSES.length) every('bosses', Math.max(1, Number(C.pollSeconds) || 2) * 1000, () => { try { sweep(); } catch (e) { log('bosses: sweep failed', e.message); } });
  else if (typeof stopTimer === 'function') stopTimer('bosses');
  log(`bosses ${C.enabled ? 'on' : 'off'}: ${BOSSES.length} of ${DEFS.length} (${BOSSES.map((b) => b.id).join(', ') || 'none'}), ${zonesWritten} zones, lockout ${C.lockoutHours} h${DEFS.filter((b) => b.enabled === false).map((b) => `; ${b.id} waits on ${b.waitingOn || 'Nat'}`).join('')}`);
};
