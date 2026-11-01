// DragonBreak Online: binding wounds (Nat, 31 Oct: "linen wraps to make bandages? quick heal item?"; then "no cooldown;
// you must stand still for 7 s to apply it"). Healing that needs no Restoration, for the warrior who carries a roll of
// cloth. Loaded by gamemode.js.
//
// /bandage starts binding the wounds with the best item carried (bandages.items, in order: a Bandage,
// ccBGSSSE001-Fish.esm 900816, else a Linen Wrap, Skyrim.esm 34cd6). The binder must keep still for `seconds`; a banner
// counts it down. Moving more than `moveTolerance` units from where they began (the server's own position, read each
// second), casting (gamemode.js castHook calls __dboBandageCast), or a blow landed, given or taken (__dboCombatAt), ends it
// with the item kept. A swing that misses never reaches the server, so it does not count. On completion one item is spent
// and its share of max health comes back at once, written by the server (so the regeneration ceiling never takes it back).
// In a fight with a player (__dboPvpAt within pvpSeconds of the start) the share is pvpMult as much. Never while down or
// dead, nor at full health.
//
// gamemode-config.json "bandages": { enabled, seconds: 7, moveTolerance: 48, pvpSeconds: 30, pvpMult: 0.5,
//   items: [{ desc, share, name }] }
'use strict';

module.exports = (api) => {
  const { mp, log, personal, registerChatCommand, sendPacket, every, cfg } = api;
  const C = Object.assign({ enabled: true, seconds: 7, moveTolerance: 48, pvpSeconds: 30, pvpMult: 0.5,
    items: [{ desc: '900816:ccBGSSSE001-Fish.esm', share: 0.3, name: 'a bandage' }, { desc: '34cd6:Skyrim.esm', share: 0.2, name: 'a linen wrap' }] }, cfg.bandages || {});
  const ON = C.enabled !== false;
  const SECONDS = Math.max(1, Math.round(Number(C.seconds) || 7));
  const TOL = Math.max(0, Number(C.moveTolerance) || 0);
  const idOf = (d) => { try { return mp.getIdFromDesc(String(d)) >>> 0; } catch (e) { return 0; } };
  const ITEMS = (Array.isArray(C.items) ? C.items : []).map((x) => ({ id: idOf(x.desc), share: Math.max(0, Math.min(1, Number(x.share) || 0)), name: String(x.name || 'a bandage') })).filter((x) => x.id && x.share > 0);
  const get = (a, k) => { try { return mp.get(a, k); } catch (e) { return undefined; } };
  const call = (name, ...args) => { try { const f = globalThis[name]; return typeof f === 'function' ? f(...args) : undefined; } catch (e) { return undefined; } };
  const S = globalThis.__dboBandages || (globalThis.__dboBandages = { binding: new Map() }); // actor -> { item, pvp, left, at, pos, world }
  const pct = (a) => { const p = get(a, 'percentages'); return p && typeof p.health === 'number' ? p : null; };
  const mapAt = (name, a) => { const m = globalThis[name]; return m instanceof Map ? Number(m.get(a >>> 0)) || 0 : 0; };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const banner = (a, text, seconds) => { try { sendPacket(a, { customPacketType: 'dboBanner', text, seconds }); } catch (e) { /* the chat line still comes */ } };
  const entriesOf = (a) => { const inv = get(a, 'inventory'); return (inv && Array.isArray(inv.entries) ? inv.entries : []).map((e) => Object.assign({}, e)); };
  const packEntry = (entries, id) => entries.find((e) => (Number(e.baseId) >>> 0) === id && (Number(e.count) || 0) > 0 && !e.worn && !e.wornLeft);
  // Takes one of the item from the pack (not a worn one); false when there is none
  const takeOne = (a, id) => {
    const entries = entriesOf(a);
    const hit = packEntry(entries, id);
    if (!hit) return false;
    hit.count = (Number(hit.count) || 0) - 1;
    try { mp.set(a, 'inventory', { entries: entries.filter((e) => (Number(e.count) || 0) > 0) }); return true; } catch (e) { log('bandages: take failed', e.message); return false; }
  };
  const posOf = (a) => { const p = get(a, 'pos'); return Array.isArray(p) && p.length >= 3 ? p.map(Number) : null; };
  const moved = (b, a) => {
    const p = posOf(a);
    if (!p || !b.pos || get(a, 'worldOrCellDesc') !== b.world) return true;
    return Math.hypot(p[0] - b.pos[0], p[1] - b.pos[1], p[2] - b.pos[2]) > TOL;
  };
  const cancel = (a, why) => { S.binding.delete(a); personal(a, why); banner(a, why, 3); };

  const bind = (a) => {
    a = a >>> 0;
    if (!ON) return personal(a, 'There is no time to bind wounds just now.');
    if (!ITEMS.length) return personal(a, 'You carry nothing to bind wounds with.');
    const p = pct(a);
    if (!p || !(p.health > 0) || get(a, 'isDead') || call('__dboIsDowned', a) === true) return personal(a, 'You are past binding your own wounds.');
    if (p.health >= 0.999) return personal(a, 'You have no wounds worth binding.');
    if (S.binding.has(a)) return personal(a, 'You are already binding your wounds.');
    const entries = entriesOf(a);
    const item = ITEMS.find((x) => packEntry(entries, x.id));
    if (!item) return personal(a, 'You carry nothing to bind wounds with: a bandage or a linen wrap.');
    const now = Date.now();
    const pvp = now - mapAt('__dboPvpAt', a) < C.pvpSeconds * 1000;
    S.binding.set(a, { item, pvp, left: SECONDS, at: now, pos: posOf(a), world: get(a, 'worldOrCellDesc') });
    banner(a, `Binding your wounds… (${SECONDS} s)`, Math.min(SECONDS, 8));
    personal(a, `You start binding your wounds with ${item.name}${pvp ? ', in haste' : ''}. Keep still for ${SECONDS} s: moving, casting or a blow undoes it.`);
  };
  // gamemode.js castHook: any cast by the binder undoes the binding
  globalThis.__dboBandageCast = (casterId) => { const a = Number(casterId) >>> 0; const b = S.binding.get(a); if (b) cancel(a, `You leave off binding your wounds to cast. ${cap(b.item.name)} is kept.`); };
  // One second of every binding: still in place and unharmed, it counts down; at zero the item is spent and the heal lands
  const tick = () => {
    if (!S.binding.size) return;
    for (const [a, b] of S.binding) {
      const p = pct(a);
      if (!p || !(p.health > 0) || call('__dboIsDowned', a) === true) { S.binding.delete(a); continue; }
      if (mapAt('__dboCombatAt', a) > b.at) { cancel(a, `A blow breaks off your binding. ${cap(b.item.name)} is kept.`); continue; }
      if (moved(b, a)) { cancel(a, `You moved; the binding is left undone. ${cap(b.item.name)} is kept.`); continue; }
      if (--b.left > 0) { banner(a, `Binding your wounds… (${b.left} s)`, Math.min(b.left, 8)); continue; }
      S.binding.delete(a);
      if (!takeOne(a, b.item.id)) { personal(a, `You no longer have ${b.item.name}; the binding is left undone.`); continue; }
      const share = b.item.share * (b.pvp ? Math.max(0, Math.min(1, Number(C.pvpMult) || 0)) : 1);
      try { mp.set(a, 'percentages', { health: Math.min(1, p.health + share), magicka: p.magicka, stamina: p.stamina }); } catch (e) { log('bandages: heal failed', e.message); }
      const line = `Your wounds are bound${b.pvp ? ', in haste' : ''}.`;
      personal(a, line); banner(a, line, 3);
    }
  };
  every('bandages', 1000, tick);
  registerChatCommand('bandage', (a) => bind(a), { help: 'bind your wounds with a bandage or a linen wrap: keep still a few seconds for health back' });
  log(`bandages: ${ON ? `on, ${ITEMS.length} item(s), still for ${SECONDS} s` : 'off'}`);
  return { bind, tick, state: S };
};
