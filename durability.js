// DragonBreak Online: weapon and armour wear, and repair at the sharpening wheel and the armorer's bench (Nate, 19 Oct:
// "tiers of degradation, that require a blacksmith at a tier level of the armor/weapon to repair; a broken one is
// repaired with what you'd normally make it from, plus a fee to take money out of circulation"). Loaded by gamemode.js;
// config "durability".
//
// Tiers: Intact, Worn, Damaged, Broken (tierNames). A piece's tier is part of its name in the inventory ("Iron Sword
// (Worn)"), so every weapon and armour of all 105 plugins wears with no plugin record. Worn and Damaged cost
// effectMult of the piece's damage or armour rating (gamemode.js wornWithHealth -> __dboDurabilityMult); Broken cannot be
// worn: it comes off at once.
// Wear (wear points per tier: pointsPerTier.weapon / .armor): a weapon wears by hitPoints with each blow it lands; a hit
// taken wears one worn armour piece by hitPoints (in turn); a blocked hit wears the blocking shield or weapon by
// blockPoints; a death wears every worn piece one whole tier. While a piece is worn its wear is kept on the character
// (private.dboWear) and counts at once; the name changes when it comes off (a worn entry is never rewritten, as the
// poison ledger in alchemy.js avoids it: the client could drop or duplicate it).
// Repair: using a sharpening wheel (weapons) or an armorer's bench (armour) shows "Repair your gear" over the bench's own
// use. The smith's Blacksmith craft tier (smithing.js) must reach the piece's family tier. Each tier repaired costs
// feePerTier of the piece's base value (at least feeMin), and that gold is destroyed. A Broken piece also takes the
// materials of the recipe that makes it (salvage.json).
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, who, cfg, openWidget, closeWidget, onUi, recordOf, fieldsOf, giveItem, takeGold, goldOf, distanceMeters, itemName, sendPacket } = api;
  const C = Object.assign({
    enabled: true,
    tierNames: ['', 'Worn', 'Damaged', 'Broken'],
    effectMult: [1, 0.9, 0.75, 0.5],
    pointsPerTier: { weapon: 150, armor: 60 },
    hitPoints: 1, blockPoints: 2,
    feePerTier: 0.05, feeMin: 5,
    reachMeters: 6.5, useWindowSeconds: 20,
    wheelKeywords: ['CraftingSmithingSharpeningWheel'],
    benchKeywords: ['CraftingSmithingArmorTable'],
  }, cfg.durability || {});
  const NAMES = C.tierNames, BROKEN = NAMES.length - 1;
  const WIDGET_ID = 94;
  const WEAR = 'private.dboWear';
  const S = globalThis.__dboDurability || (globalThis.__dboDurability = { worn: new Map(), pending: new Map(), pass: new Map(), turn: new Map() });
  const get = (a, k, d) => { try { const v = mp.get(a, k); return v === undefined || v === null ? d : v; } catch (e) { return d; } };
  const descOf = (id) => { try { return String(mp.getDescFromId(id >>> 0)); } catch (e) { return ''; } };
  const idOf = (d) => { try { return mp.getIdFromDesc(d) >>> 0; } catch (e) { return 0; } };
  const typeOf = (id) => { const r = recordOf(id >>> 0); return r ? String(r.record.type) : ''; };
  const notice = (a, text) => { personal(a, text); try { sendPacket(a, { customPacketType: 'dboNotice', text }); } catch (e) { /* chat is enough */ } };

  // ---- a piece's tier and name --------------------------------------------------------------------------------------
  const SUFFIX = new RegExp(`\\s*\\((${NAMES.filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\)$`);
  const tierOfName = (name) => { const m = SUFFIX.exec(String(name || '')); return m ? Math.max(0, NAMES.indexOf(m[1])) : 0; };
  const bareName = (e) => (e && e.name ? String(e.name).replace(SUFFIX, '') : itemName(descOf(e.baseId)));
  const nameAt = (e, tier) => (tier > 0 ? `${bareName(e)} (${NAMES[tier]})` : bareName(e));
  const kindOf = (id) => { const t = typeOf(id); return t === 'WEAP' ? 'weapon' : t === 'ARMO' ? 'armor' : ''; };
  const perTier = (kind) => Math.max(1, Number((C.pointsPerTier || {})[kind]) || 100);

  // The worn copies: { baseId, left, name, entry }
  const wornOf = (a) => {
    const eq = get(a, 'equipment', null);
    const entries = eq && eq.inv && Array.isArray(eq.inv.entries) ? eq.inv.entries : [];
    return entries.filter((e) => e && (e.worn || e.wornLeft) && kindOf(Number(e.baseId) >>> 0))
      .map((e) => ({ baseId: Number(e.baseId) >>> 0, left: !!e.wornLeft, name: e.name ? String(e.name) : '', entry: e }));
  };
  // The wear kept for a worn piece: private.dboWear { "<baseId>|<name>": points }
  const keyOf = (w) => `${w.baseId}|${w.name || ''}`;
  // Read on every hit by the damage math: kept for a moment per player, dropped at each write
  if (!(S.ledgers instanceof Map)) S.ledgers = new Map();
  const ledger = (a) => {
    const c = S.ledgers.get(a >>> 0);
    if (c && Date.now() - c.at < 50) return Object.assign({}, c.l);
    const r = get(a, WEAR, null); const l = r && typeof r === 'object' ? r : {};
    S.ledgers.set(a >>> 0, { at: Date.now(), l });
    return Object.assign({}, l);
  };
  const writeLedger = (a, l) => { S.ledgers.delete(a >>> 0); mp.set(a, WEAR, l); };
  const tierOf = (a, w) => {
    const base = tierOfName(w.name);
    const pts = Number(ledger(a)[keyOf(w)]) || 0;
    return Math.min(BROKEN, base + Math.floor(pts / perTier(kindOf(w.baseId))));
  };

  // gamemode.js wornWithHealth: a worn piece's damage or armour multiplier
  globalThis.__dboDurabilityMult = (a, baseId, left, name) => {
    if (!C.enabled) return 1;
    const w = name !== undefined ? { baseId: baseId >>> 0, left: !!left, name: name ? String(name) : '' }
      : wornOf(a).find((x) => x.baseId === (baseId >>> 0) && (left === undefined || x.left === !!left));
    if (!w) return 1;
    const m = Number(C.effectMult[tierOf(a, w)]);
    return Number.isFinite(m) && m > 0 ? m : 1;
  };

  const unequip = (a, baseId) => {
    try { mp.callPapyrusFunction('method', 'Actor', 'UnequipItem', { type: 'form', desc: mp.getDescFromId(a) }, [{ type: 'espm', desc: mp.getDescFromId(baseId) }, false, true]); }
    catch (e) { log('durability: UnequipItem failed', e.message); }
  };

  const wear = (a, w, points) => {
    if (!(points > 0)) return;
    const before = tierOf(a, w);
    if (before >= BROKEN) return;
    const l = ledger(a);
    l[keyOf(w)] = (Number(l[keyOf(w)]) || 0) + points;
    try { writeLedger(a, l); } catch (e) { return; }
    const after = tierOf(a, w);
    if (after <= before) return;
    const name = bareName(w.entry);
    if (after >= BROKEN) {
      notice(a, `Your ${name} has broken. Take it to a smith to repair it with the materials it was made from.`);
      unequip(a, w.baseId);
    } else notice(a, `Your ${name} is now ${NAMES[after]}. A smith can repair it at a ${kindOf(w.baseId) === 'weapon' ? 'sharpening wheel' : "armorer's bench"}.`);
    log(`durability: ${who(a)} ${descOf(w.baseId)} is now ${NAMES[after] || 'Intact'}`);
  };

  const isPlayer = (a) => { try { return Number(mp.get(a, 'profileId')) >= 0; } catch (e) { return false; } };
  const isShield = (id) => { const r = recordOf(id >>> 0); if (!r || String(r.record.type) !== 'ARMO') return false; const b = (fieldsOf(r, 'BOD2')[0] || fieldsOf(r, 'BODT')[0]); return !!(b && b.data.byteLength >= 4 && (new DataView(b.data.buffer, b.data.byteOffset, b.data.byteLength).getUint32(0, true) & 0x200)); };

  // gamemode.js hit hook: a landed blow wears the weapon that struck it; a hit taken wears one armour piece in turn;
  // a blocked hit wears the shield, or the weapon held when there is none
  globalThis.__dboDurabilityHit = (agg, tgt, src, flags) => {
    if (!C.enabled || agg === tgt) return;
    const blocked = !!(flags && typeof flags === 'object' && flags.blocked);
    if (isPlayer(agg) && (flags == null || !flags.spell)) {
      const w = wornOf(agg).find((x) => x.baseId === (src >>> 0) && kindOf(x.baseId) === 'weapon');
      if (w) wear(agg, w, Number(C.hitPoints) || 1);
    }
    if (!isPlayer(tgt)) return;
    const worn = wornOf(tgt);
    if (blocked) {
      const shield = worn.find((x) => isShield(x.baseId)) || worn.find((x) => kindOf(x.baseId) === 'weapon');
      if (shield) wear(tgt, shield, Number(C.blockPoints) || 2);
      return;
    }
    if (flags && flags.spell) return;
    const armor = worn.filter((x) => kindOf(x.baseId) === 'armor' && !isShield(x.baseId));
    if (!armor.length) return;
    const n = (S.turn.get(tgt >>> 0) || 0) % armor.length;
    S.turn.set(tgt >>> 0, n + 1);
    wear(tgt, armor[n], Number(C.hitPoints) || 1);
  };

  // gamemode.js deathHook: every worn piece one whole tier
  globalThis.__dboDurabilityDeath = (a) => {
    if (!C.enabled || !isPlayer(a)) return;
    for (const w of wornOf(a)) wear(a, w, perTier(kindOf(w.baseId)));
  };

  // ---- the name follows when a piece comes off ----------------------------------------------------------------------
  // One copy of baseId named `name`, not worn, becomes `tier` (its own entry); the wear kept for it goes
  const renameOne = (a, baseId, name, tier) => {
    const inv = get(a, 'inventory', { entries: [] });
    const entries = (Array.isArray(inv.entries) ? inv.entries : []).map((e) => Object.assign({}, e));
    const i = entries.findIndex((e) => (Number(e.baseId) >>> 0) === baseId && !e.worn && !e.wornLeft && String(e.name || '') === String(name || ''));
    if (i < 0) return false;
    const src = entries[i];
    const copy = Object.assign({}, src, { count: 1, name: nameAt(src, tier) });
    // Intact again under the item's own name: no name at all, so it stacks with the plain ones (a custom name is kept)
    if (!tier && (!src.name || copy.name === itemName(descOf(baseId)))) delete copy.name;
    delete copy.worn; delete copy.wornLeft;
    src.count = Number(src.count) - 1;
    const out = entries.filter((e) => Number(e.count) > 0);
    const same = out.find((e) => (Number(e.baseId) >>> 0) === baseId && !e.worn && !e.wornLeft && String(e.name || '') === String(copy.name || '')
      && Object.keys(copy).every((k) => k === 'count' || JSON.stringify(e[k]) === JSON.stringify(copy[k])));
    if (same) same.count = Number(same.count) + 1; else out.push(copy);
    mp.set(a, 'inventory', { entries: out });
    return true;
  };
  const flush = (a, gone) => {
    const l = ledger(a);
    let changed = false;
    for (const w of gone) {
      const key = keyOf(w);
      if (!(key in l)) continue;
      const tier = tierOf(a, w);
      delete l[key]; changed = true;
      if (tier !== tierOfName(w.name)) {
        try { if (!renameOne(a, w.baseId, w.name, tier)) log(`durability: ${who(a)} ${descOf(w.baseId)} left the pack before its ${NAMES[tier]} could be marked`); }
        catch (e) { log('durability: rename failed', e.message); }
      }
    }
    if (changed) { try { writeLedger(a, l); } catch (e) { /* kept for the next look */ } }
  };
  // gamemode.js equipHook: what came off since the last report gets its name; a Broken piece put on comes off again
  globalThis.__dboDurabilityEquip = (a, equipment) => {
    if (!C.enabled) return;
    a >>>= 0;
    const now = (equipment && equipment.inv && Array.isArray(equipment.inv.entries) ? equipment.inv.entries : [])
      .filter((e) => e && (e.worn || e.wornLeft) && kindOf(Number(e.baseId) >>> 0))
      .map((e) => ({ baseId: Number(e.baseId) >>> 0, left: !!e.wornLeft, name: e.name ? String(e.name) : '', entry: e }));
    const before = S.worn.get(a) || [];
    S.worn.set(a, now);
    const gone = before.filter((w) => !now.some((x) => x.baseId === w.baseId && x.name === w.name));
    if (gone.length) setTimeout(() => { try { flush(a, gone); } catch (e) { log('durability: flush failed', e.message); } }, 400);
    for (const w of now) {
      if (tierOfName(w.name) >= BROKEN) {
        setTimeout(() => unequip(a, w.baseId), 200);
        notice(a, `Your ${bareName(w.entry)} is broken and cannot be used until a smith repairs it.`);
      }
    }
  };
  // gamemode.js disconnect: nothing of the worn list is kept; the wear stays on the character for the next unequip
  globalThis.__dboDurabilityLeave = (a) => { S.worn.delete(a >>> 0); S.turn.delete(a >>> 0); };

  // ---- repair at the wheel or the bench -----------------------------------------------------------------------------
  const kwCache = new Map();
  const stationOf = (ref) => {
    const base = idOf(get(ref, 'baseDesc', ''));
    if (!base) return '';
    if (kwCache.has(base)) return kwCache.get(base);
    let found = '';
    const r = recordOf(base);
    const kwda = r ? fieldsOf(r, 'KWDA')[0] : null;
    for (let off = 0; kwda && off + 4 <= kwda.data.byteLength && !found; off += 4) {
      let id = new DataView(kwda.data.buffer, kwda.data.byteOffset, kwda.data.byteLength).getUint32(off, true);
      try { if (typeof r.toGlobalRecordId === 'function') id = r.toGlobalRecordId(id) >>> 0; } catch (e) { /* unmapped */ }
      const k = recordOf(id); const ed = k ? String(k.record.editorId || '') : '';
      if ((C.wheelKeywords || []).includes(ed)) found = 'weapon';
      else if ((C.benchKeywords || []).includes(ed)) found = 'armor';
    }
    kwCache.set(base, found);
    return found;
  };
  const LABEL = { weapon: 'sharpening wheel', armor: "armorer's bench" };
  const valueOf = (id) => { try { return typeof globalThis.__dboBaseValue === 'function' ? Number(globalThis.__dboBaseValue(id >>> 0)) || 0 : 0; } catch (e) { return 0; } };
  const feeOf = (id, tiers) => Math.max(Number(C.feeMin) || 0, Math.round(valueOf(id) * (Number(C.feePerTier) || 0) * tiers));
  // The recipe's materials for a Broken piece: salvage.json [station, tier, [[desc, count]...]]
  let recipes = null, recipesAt = 0;
  const recipeOf = (id) => {
    const file = path.resolve('salvage.json');
    try { const m = fs.statSync(file).mtimeMs; if (!recipes || m !== recipesAt) { recipes = JSON.parse(fs.readFileSync(file, 'utf8')).items || {}; recipesAt = m; } } catch (e) { recipes = recipes || {}; }
    const d = descOf(id).toLowerCase(); const i = d.indexOf(':');
    const key = i < 0 ? d : (parseInt(d.slice(0, i), 16) || 0).toString(16) + d.slice(i);
    const hit = Object.entries(recipes).find(([k]) => { const kk = k.toLowerCase(); const j = kk.indexOf(':'); return ((parseInt(kk.slice(0, j), 16) || 0).toString(16) + kk.slice(j)) === key; });
    return hit && Array.isArray(hit[1][2]) ? hit[1][2].map(([dd, n]) => [dd, Math.max(1, Math.ceil(Number(n) || 1))]) : null;
  };
  const countOf = (a, id) => (get(a, 'inventory', { entries: [] }).entries || []).filter((e) => (Number(e.baseId) >>> 0) === (id >>> 0) && !e.worn && !e.wornLeft && !e.name).reduce((n, e) => n + (Number(e.count) || 0), 0);
  const takeMaterials = (a, mats) => {
    const inv = get(a, 'inventory', { entries: [] });
    const entries = (inv.entries || []).map((e) => Object.assign({}, e));
    for (const [d, n] of mats) {
      let left = n; const id = idOf(d);
      for (const e of entries) { if (left <= 0) break; if ((Number(e.baseId) >>> 0) !== id || e.worn || e.wornLeft || e.name) continue; const t = Math.min(left, Number(e.count)); e.count = Number(e.count) - t; left -= t; }
      if (left > 0) return false;
    }
    mp.set(a, 'inventory', { entries: entries.filter((e) => Number(e.count) > 0) });
    return true;
  };
  // Pieces of this kind in the pack that wear has marked: [{ baseId, name, tier, entry }]
  const damagedOf = (a, kind) => (get(a, 'inventory', { entries: [] }).entries || [])
    .filter((e) => e && !e.worn && !e.wornLeft && Number(e.count) > 0 && tierOfName(e.name) > 0 && kindOf(Number(e.baseId) >>> 0) === kind)
    .map((e) => ({ baseId: Number(e.baseId) >>> 0, name: String(e.name), tier: tierOfName(e.name), entry: e }));
  const smithTier = (a) => { try { return typeof globalThis.__dboSmithCraftTier === 'function' ? Number(globalThis.__dboSmithCraftTier(a >>> 0)) || 0 : 7; } catch (e) { return 0; } };
  const itemTier = (id) => { try { return typeof globalThis.__dboSmithItemTier === 'function' ? Number(globalThis.__dboSmithItemTier(id >>> 0)) || 1 : 1; } catch (e) { return 1; } };
  const nameOfMat = (d) => itemName(d);

  const openList = (a, target, kind, note) => {
    const list = damagedOf(a, kind).slice(0, 8);
    const actions = [{ id: 'use', label: `Work the ${LABEL[kind]} (use it again)` }];
    for (const it of list) actions.push({ id: `r:${it.baseId}:${encodeURIComponent(it.name)}`, label: it.name });
    S.pending.set(a >>> 0, { target: target >>> 0, kind });
    openWidget(a, { type: 'contextMenu', id: WIDGET_ID, mode: 'menu', targetName: note || `Repair at the ${LABEL[kind]}: choose a piece`,
      actions, events: { action: 'dbo:repairChoose', close: 'dbo:repairClose' } }, true);
    return list.length;
  };
  const openItem = (a, target, kind, baseId, name, note) => {
    const it = damagedOf(a, kind).find((x) => x.baseId === baseId && x.name === name);
    if (!it) return openList(a, target, kind, note);
    const fee = feeOf(baseId, it.tier);
    const mats = it.tier >= BROKEN ? recipeOf(baseId) : [];
    const need = itemTier(baseId);
    const lines = [`${it.name}: back to Intact for ${fee} gold`];
    if (it.tier >= BROKEN) lines.push(mats && mats.length ? `and ${mats.map(([d, n]) => `${n} ${nameOfMat(d)}`).join(', ')}` : 'and its materials (none known: ask a GM)');
    lines.push(`Needs Blacksmith craft tier ${need}`);
    S.pending.set(a >>> 0, { target: target >>> 0, kind, item: { baseId, name } });
    openWidget(a, { type: 'contextMenu', id: WIDGET_ID, mode: 'menu', targetName: `${note ? `${note}. ` : ''}${lines.join(', ')}`,
      actions: [{ id: 'fix', label: `Repair it (${fee} gold${it.tier >= BROKEN ? ' and the materials' : ''})` }, { id: 'list', label: 'Back to the list' }],
      events: { action: 'dbo:repairChoose', close: 'dbo:repairClose' } }, true);
    return 1;
  };
  const repair = (a, p) => {
    const it = damagedOf(a, p.kind).find((x) => x.baseId === p.item.baseId && x.name === p.item.name);
    if (!it) return 'That piece is no longer in your pack.';
    const need = itemTier(it.baseId);
    if (smithTier(a) < need) return `Repairing this takes a Blacksmith of craft tier ${need}; yours is ${smithTier(a) || 'none'}.`;
    const fee = feeOf(it.baseId, it.tier);
    const mats = it.tier >= BROKEN ? recipeOf(it.baseId) : [];
    if (it.tier >= BROKEN && !(mats && mats.length)) return 'Nobody knows what this was made from. Ask a GM.';
    if ((Number(goldOf(a)) || 0) < fee) return `The repair costs ${fee} gold, and you do not have it.`;
    for (const [d, n] of mats || []) if (countOf(a, idOf(d)) < n) return `A broken piece is remade from its materials: you need ${n} ${nameOfMat(d)}.`;
    if ((mats || []).length && !takeMaterials(a, mats)) return 'The materials could not be taken. Nothing was charged.';
    if (!takeGold(a, fee)) return `The repair costs ${fee} gold, and you do not have it.`;
    if (!renameOne(a, it.baseId, it.name, 0)) { log(`durability: ${who(a)} paid for a repair that found no piece: ${descOf(it.baseId)}`); return 'The piece slipped from the bench. Ask a GM.'; }
    log(`durability: ${who(a)} repaired ${descOf(it.baseId)} from ${NAMES[it.tier]} for ${fee} gold (destroyed)${(mats || []).length ? ` and ${mats.map(([d, n]) => `${n} ${d}`).join(', ')}` : ''}`);
    return `${bareName(it.entry)} repaired for ${fee} gold.`;
  };

  // gamemode.js activate chain, after salvage: true when the panel opened (the bench's own menu waits for "use it again")
  globalThis.__dboRepairActivate = (target, caster) => {
    if (!C.enabled) return false;
    const kind = stationOf(target);
    if (!kind) return false;
    const pass = S.pass.get(caster >>> 0);
    if (pass) { S.pass.delete(caster >>> 0); if (pass.target === (target >>> 0) && pass.until > Date.now()) return false; }
    if (!damagedOf(caster, kind).length) return false;
    openList(caster, target, kind);
    return true;
  };
  onUi('repairChoose', (a, args) => {
    const p = S.pending.get(a >>> 0);
    if (!p) return;
    const id = String(args[0] || '');
    if (id === 'use') { S.pass.set(a >>> 0, { target: p.target, until: Date.now() + C.useWindowSeconds * 1000 }); S.pending.delete(a >>> 0); closeWidget(a, WIDGET_ID); return; }
    try { if (distanceMeters(a, p.target) > C.reachMeters) { S.pending.delete(a >>> 0); closeWidget(a, WIDGET_ID); personal(a, `You walked away from the ${LABEL[p.kind]}.`); return; } } catch (e) { /* no position */ }
    if (id === 'list') { openList(a, p.target, p.kind); return; }
    const m = /^r:(\d+):(.*)$/.exec(id);
    if (m) { openItem(a, p.target, p.kind, Number(m[1]) >>> 0, decodeURIComponent(m[2])); return; }
    if (id === 'fix' && p.item) {
      const text = repair(a, p);
      if (!openList(a, p.target, p.kind, text)) { S.pending.delete(a >>> 0); closeWidget(a, WIDGET_ID); personal(a, text); }
    }
  });
  onUi('repairClose', (a) => { S.pending.delete(a >>> 0); closeWidget(a, WIDGET_ID); });
  onUi('close', (a, args, widgetId) => { if (widgetId === WIDGET_ID) S.pending.delete(a >>> 0); });

  log(`durability: ${C.enabled ? 'on' : 'off'}, tiers ${NAMES.map((n) => n || 'Intact').join('/')}, effect ${C.effectMult.join('/')}, ${perTier('weapon')} weapon / ${perTier('armor')} armour points a tier, fee ${Math.round(C.feePerTier * 100)}% a tier (min ${C.feeMin}), destroyed`);
  return { tierOfName, nameAt, wornOf, tierOf, feeOf, recipeOf };
};
