// DragonBreak Online: binding wounds (Nat, 31 Oct: "linen wraps to make bandages? quick heal item?"). Healing that needs
// no Restoration, for the warrior who carries a roll of cloth. Loaded by gamemode.js.
//
// /bandage binds the wounds with the best item carried (bandages.items, in order: a Bandage, ccBGSSSE001-Fish.esm 900816,
// else a Linen Wrap, Skyrim.esm 34cd6), spending one. Over `seconds` the binder gets back the item's share of their health,
// written by the server a second at a time (so the regeneration ceiling never takes it back), and moves slowly the while
// (speedMult, the dboStatus packet the client already applies). A blow landed, given or taken (gamemode.js __dboCombatAt,
// stamped on a landed hit) loosens the binding: the rest is lost. In a fight with a player (__dboPvpAt within pvpSeconds) the share
// is halved, so a mage's healing and a potion keep their place. Once every cooldownSeconds; never while down or dead, nor
// at full health.
//
// gamemode-config.json "bandages": { enabled, seconds: 10, cooldownSeconds: 60, speedMult: -50, pvpSeconds: 30, pvpMult: 0.5,
//   items: [{ desc, share, name }] }
'use strict';

module.exports = (api) => {
  const { mp, log, personal, registerChatCommand, sendPacket, every, cfg } = api;
  const C = Object.assign({ enabled: true, seconds: 10, cooldownSeconds: 60, speedMult: -50, pvpSeconds: 30, pvpMult: 0.5,
    items: [{ desc: '900816:ccBGSSSE001-Fish.esm', share: 0.3, name: 'a bandage' }, { desc: '34cd6:Skyrim.esm', share: 0.2, name: 'a linen wrap' }] }, cfg.bandages || {});
  const ON = C.enabled !== false;
  const idOf = (d) => { try { return mp.getIdFromDesc(String(d)) >>> 0; } catch (e) { return 0; } };
  const ITEMS = (Array.isArray(C.items) ? C.items : []).map((x) => ({ id: idOf(x.desc), share: Math.max(0, Math.min(1, Number(x.share) || 0)), name: String(x.name || 'a bandage') })).filter((x) => x.id && x.share > 0);
  const get = (a, k) => { try { return mp.get(a, k); } catch (e) { return undefined; } };
  const call = (name, ...args) => { try { const f = globalThis[name]; return typeof f === 'function' ? f(...args) : undefined; } catch (e) { return undefined; } };
  const S = globalThis.__dboBandages || (globalThis.__dboBandages = { binding: new Map(), usedAt: new Map() }); // actor -> { per, left, at, name }
  const pct = (a) => { const p = get(a, 'percentages'); return p && typeof p.health === 'number' ? p : null; };
  const mapAt = (name, a) => { const m = globalThis[name]; return m instanceof Map ? Number(m.get(a >>> 0)) || 0 : 0; };
  // Takes one of the item from the pack (not a worn one); false when there is none
  const takeOne = (a, id) => {
    const inv = get(a, 'inventory');
    const entries = (inv && Array.isArray(inv.entries) ? inv.entries : []).map((e) => Object.assign({}, e));
    const hit = entries.find((e) => (Number(e.baseId) >>> 0) === id && (Number(e.count) || 0) > 0 && !e.worn && !e.wornLeft);
    if (!hit) return false;
    hit.count = (Number(hit.count) || 0) - 1;
    try { mp.set(a, 'inventory', { entries: entries.filter((e) => (Number(e.count) || 0) > 0) }); return true; } catch (e) { log('bandages: take failed', e.message); return false; }
  };
  const holds = (a, id) => { const inv = get(a, 'inventory'); return (inv && Array.isArray(inv.entries) ? inv.entries : []).some((e) => (Number(e.baseId) >>> 0) === id && (Number(e.count) || 0) > 0 && !e.worn && !e.wornLeft); };

  const bind = (a) => {
    a = a >>> 0;
    if (!ON) return personal(a, 'There is no time to bind wounds just now.');
    if (!ITEMS.length) return personal(a, 'You carry nothing to bind wounds with.');
    const p = pct(a);
    if (!p || !(p.health > 0) || get(a, 'isDead') || call('__dboIsDowned', a) === true) return personal(a, 'You are past binding your own wounds.');
    if (p.health >= 0.999) return personal(a, 'You have no wounds worth binding.');
    if (S.binding.has(a)) return personal(a, 'You are already binding your wounds.');
    const now = Date.now();
    const wait = C.cooldownSeconds * 1000 - (now - (S.usedAt.get(a) || 0));
    if (wait > 0) return personal(a, `Your last binding is still fresh. Again in ${Math.ceil(wait / 1000)} s.`);
    const item = ITEMS.find((x) => holds(a, x.id));
    if (!item) return personal(a, 'You carry nothing to bind wounds with: a bandage or a linen wrap.');
    if (!takeOne(a, item.id)) return personal(a, 'You fumble the cloth. Try again.');
    const pvp = now - mapAt('__dboPvpAt', a) < C.pvpSeconds * 1000;
    const share = item.share * (pvp ? Math.max(0, Math.min(1, Number(C.pvpMult) || 0)) : 1);
    const n = Math.max(1, Math.round(C.seconds));
    S.binding.set(a, { per: share / n, left: n, at: now, name: item.name });
    S.usedAt.set(a, now);
    if (S.usedAt.size > 2000) for (const [k, t] of S.usedAt) if (now - t > C.cooldownSeconds * 1000) S.usedAt.delete(k);
    try { if (C.speedMult) sendPacket(a, { customPacketType: 'dboStatus', kind: 'bandage', seconds: n, speedMult: Math.max(-90, Math.min(0, Number(C.speedMult) || 0)), text: '' }); } catch (e) { /* the heal still runs */ }
    personal(a, `You bind your wounds with ${item.name}${pvp ? ', in haste' : ''}. Keep out of harm a few moments.`);
  };
  // One second of every binding; a landed blow since it began ends it
  const tick = () => {
    if (!S.binding.size) return;
    for (const [a, b] of S.binding) {
      const p = pct(a);
      if (!p || !(p.health > 0) || call('__dboIsDowned', a) === true) { S.binding.delete(a); continue; }
      if (mapAt('__dboCombatAt', a) > b.at) { S.binding.delete(a); personal(a, `A blow loosens ${b.name}; the binding is lost.`); continue; }
      try { mp.set(a, 'percentages', { health: Math.min(1, p.health + b.per), magicka: p.magicka, stamina: p.stamina }); } catch (e) { S.binding.delete(a); continue; }
      if (--b.left <= 0) { S.binding.delete(a); personal(a, 'Your wounds are bound.'); }
    }
  };
  every('bandages', 1000, tick);
  registerChatCommand('bandage', (a) => bind(a), { help: 'bind your wounds with a bandage or a linen wrap: health back over a few seconds, once a minute' });
  log(`bandages: ${ON ? `on, ${ITEMS.length} item(s), ${C.seconds} s, every ${C.cooldownSeconds} s` : 'off'}`);
  return { bind, tick, state: S };
};
