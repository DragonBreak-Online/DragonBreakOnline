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
// materials of the recipe that makes it (salvage.json); Worn and Damaged take materialShare of them.
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
    materialShare: [0, 0.25, 0.5, 1],
    reachMeters: 6.5, useWindowSeconds: 20,
    // Repairs at the wheel and bench are a smith's work (Nate, 19 Oct: "blacksmiths paramount ... adds economy"); a player
    // without the rank brings the piece to one. anyoneRepairs true would let anyone repair at unskilledFeeMult of the fee;
    // smithDiscountPerTier above 0 would let a smith above the piece's tier pay less (never under smithMinFeeMult)
    anyoneRepairs: false, unskilledFeeMult: 1.5, smithDiscountPerTier: 0, smithMinFeeMult: 0.5,
    // Field kits (xophor, otome, 19 Oct; Nate: the hammer, the sewing kit): an item used from the pack (eaten, as an ALCH)
    // that mends one Worn piece of its kind, never a Damaged or Broken one. kind: weapon (whetstone), light (sewing kit: light
    // armour and clothing), heavy (hammer: heavy armour), armor, any. { "<item desc>": { kind, maxTier: 1 } }, filled once the
    // PC has made the records. gearTier: the highest smithing family tier it works on (smithing.json: iron 1, steel 2 ..
    // steel plate 5, ebony 6, daedric 7), so a tier of hammers (dangerbush, 19 Oct): Iron-Steel 2, Steel-Plate 5, Plate+ 99
    fieldKits: {},
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
    return Math.max(0, Math.min(BROKEN, base + Math.floor(pts / perTier(kindOf(w.baseId)))));
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
      // The wear stays kept until the name holds it: the login's empty report "takes off" pieces still worn (19 Oct log)
      let marked = tier === tierOfName(w.name);
      if (!marked) {
        try { marked = renameOne(a, w.baseId, w.name, tier); if (!marked) log(`durability: ${who(a)} ${descOf(w.baseId)} not in the pack unworn yet; its ${NAMES[tier]} stays kept`); }
        catch (e) { log('durability: rename failed', e.message); }
      }
      if (marked) { delete l[key]; changed = true; }
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
  // A tier's share of the recipe's materials (materialShare by tier, Broken all of it), at least one of the main one
  const matsFor = (id, tier) => {
    const share = Number((C.materialShare || [])[tier]) || 0;
    const rec = share > 0 ? recipeOf(id) : null;
    if (!rec || !rec.length) return tier >= BROKEN ? rec : [];
    const out = rec.map(([d, n]) => [d, Math.floor(n * share)]);
    if (!out.some(([, n]) => n > 0)) { let m = 0; rec.forEach(([, n], i) => { if (n > rec[m][1]) m = i; }); out[m][1] = 1; }
    return out.filter(([, n]) => n > 0);
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
  // (the name's tier plus any wear still kept for it, as when its name could not be written yet)
  const damagedOf = (a, kind) => (get(a, 'inventory', { entries: [] }).entries || [])
    .filter((e) => e && !e.worn && !e.wornLeft && Number(e.count) > 0 && kindOf(Number(e.baseId) >>> 0) === kind)
    .map((e) => { const w = { baseId: Number(e.baseId) >>> 0, name: e.name ? String(e.name) : '', entry: e }; return Object.assign(w, { tier: tierOf(a, w) }); })
    .filter((w) => w.tier > 0);
  // Worn pieces of this kind that need a repair: listed, so the bench says to take them off
  const wornDamagedOf = (a, kind) => wornOf(a).filter((w) => kindOf(w.baseId) === kind).map((w) => Object.assign(w, { tier: tierOf(a, w) })).filter((w) => w.tier > 0);
  const smithTier = (a) => { try { return typeof globalThis.__dboSmithCraftTier === 'function' ? Number(globalThis.__dboSmithCraftTier(a >>> 0)) || 0 : 7; } catch (e) { return 0; } };
  const itemTier = (id) => { try { return typeof globalThis.__dboSmithItemTier === 'function' ? Number(globalThis.__dboSmithItemTier(id >>> 0)) || 1 : 1; } catch (e) { return 1; } };
  const nameOfMat = (d) => itemName(d);
  // What a repair costs this player: { fee, why, refused }
  const priceFor = (a, baseId, tier) => {
    const base = feeOf(baseId, tier);
    const need = itemTier(baseId), mine = smithTier(a);
    if (mine >= need) {
      const mult = Math.max(Number(C.smithMinFeeMult) || 0.5, 1 - (Number(C.smithDiscountPerTier) || 0) * (mine - need + 1));
      return { fee: Math.max(1, Math.round(base * mult)), why: mult < 1 ? `a Blacksmith of tier ${mine}: ${Math.round((1 - mult) * 100)}% off` : `Blacksmith craft tier ${need}` };
    }
    if (C.anyoneRepairs === false) return { fee: base, refused: `Repairing this takes a Blacksmith of craft tier ${need}; yours is ${mine || 'none'}.` };
    return { fee: Math.max(1, Math.round(base * (Number(C.unskilledFeeMult) || 1))), why: `a smith of tier ${need} or above would pay less` };
  };

  const openList = (a, target, kind, note) => {
    const list = damagedOf(a, kind).slice(0, 8);
    const actions = [{ id: 'use', label: `Work the ${LABEL[kind]} (use it again)` }];
    for (const it of list) actions.push({ id: `r:${it.baseId}:${encodeURIComponent(it.name)}`, label: nameAt(it.entry, it.tier) });
    for (const w of wornDamagedOf(a, kind).slice(0, 8)) actions.push({ id: `w:${w.baseId}`, label: `${nameAt(w.entry, w.tier)}: take it off to repair it` });
    S.pending.set(a >>> 0, { target: target >>> 0, kind });
    openWidget(a, { type: 'contextMenu', id: WIDGET_ID, mode: 'menu', targetName: note || `Repair at the ${LABEL[kind]}: choose a piece`,
      actions, events: { action: 'dbo:repairChoose', close: 'dbo:repairClose' } }, true);
    return list.length;
  };
  const openItem = (a, target, kind, baseId, name, note) => {
    const it = damagedOf(a, kind).find((x) => x.baseId === baseId && x.name === name);
    if (!it) return openList(a, target, kind, note);
    const price = priceFor(a, baseId, it.tier);
    const fee = price.fee;
    const mats = matsFor(baseId, it.tier);
    const lines = [`${nameAt(it.entry, it.tier)}: back to Intact for ${fee} gold`];
    if (mats && mats.length) lines.push(`and ${mats.map(([d, n]) => `${n} ${nameOfMat(d)}`).join(', ')}`);
    else if (it.tier >= BROKEN) lines.push('and its materials (none known: ask a GM)');
    lines.push(price.refused || `(${price.why})`);
    S.pending.set(a >>> 0, { target: target >>> 0, kind, item: { baseId, name } });
    openWidget(a, { type: 'contextMenu', id: WIDGET_ID, mode: 'menu', targetName: `${note ? `${note}. ` : ''}${lines.join(', ')}`,
      actions: [{ id: 'fix', label: `Repair it (${fee} gold${mats && mats.length ? ' and the materials' : ''})` }, { id: 'list', label: 'Back to the list' }],
      events: { action: 'dbo:repairChoose', close: 'dbo:repairClose' } }, true);
    return 1;
  };
  const repair = (a, p) => {
    const it = damagedOf(a, p.kind).find((x) => x.baseId === p.item.baseId && x.name === p.item.name);
    if (!it) return 'That piece is no longer in your pack.';
    const price = priceFor(a, it.baseId, it.tier);
    if (price.refused) return price.refused;
    const fee = price.fee;
    const mats = matsFor(it.baseId, it.tier);
    if (it.tier >= BROKEN && !(mats && mats.length)) return 'Nobody knows what this was made from. Ask a GM.';
    if ((Number(goldOf(a)) || 0) < fee) return `The repair costs ${fee} gold, and you do not have it.`;
    for (const [d, n] of mats || []) if (countOf(a, idOf(d)) < n) return `This repair needs ${n} ${nameOfMat(d)}.`;
    if ((mats || []).length && !takeMaterials(a, mats)) return 'The materials could not be taken. Nothing was charged.';
    if (!takeGold(a, fee)) return `The repair costs ${fee} gold, and you do not have it.`;
    if (!renameOne(a, it.baseId, it.name, 0)) { log(`durability: ${who(a)} paid for a repair that found no piece: ${descOf(it.baseId)}`); return 'The piece slipped from the bench. Ask a GM.'; }
    { const l = ledger(a); const k = keyOf(it); if (k in l) { delete l[k]; try { writeLedger(a, l); } catch (e) { /* the name is Intact already */ } } }
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
    if (!damagedOf(caster, kind).length && !wornDamagedOf(caster, kind).length) return false;
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
    if (/^w:\d+$/.test(id)) { openList(a, p.target, p.kind, 'Take the piece off first, then choose it here'); return; }
    const m = /^r:(\d+):(.*)$/.exec(id);
    if (m) { openItem(a, p.target, p.kind, Number(m[1]) >>> 0, decodeURIComponent(m[2])); return; }
    if (id === 'fix' && p.item) {
      const text = repair(a, p);
      if (!openList(a, p.target, p.kind, text)) { S.pending.delete(a >>> 0); closeWidget(a, WIDGET_ID); personal(a, text); }
    }
  });
  // ---- field kits ---------------------------------------------------------------------------------------------------
  const KITS = new Map();
  for (const [d, k] of Object.entries(C.fieldKits || {})) { const id = idOf(d); if (id && k) KITS.set(id, { kind: String(k.kind || 'any'), maxTier: Math.max(1, Number(k.maxTier) || 1), gearTier: Number(k.gearTier) > 0 ? Number(k.gearTier) : Infinity }); }
  // An armour's weight class from its BOD2 (armour type u32 at 4) or older BODT (at 8): 0 light, 1 heavy, 2 clothing
  const armorClass = (id) => {
    const r = recordOf(id >>> 0); if (!r || String(r.record.type) !== 'ARMO') return -1;
    const b2 = fieldsOf(r, 'BOD2')[0]; if (b2 && b2.data.byteLength >= 8) return new DataView(b2.data.buffer, b2.data.byteOffset, b2.data.byteLength).getUint32(4, true);
    const bt = fieldsOf(r, 'BODT')[0]; if (bt && bt.data.byteLength >= 12) return new DataView(bt.data.buffer, bt.data.byteOffset, bt.data.byteLength).getUint32(8, true);
    return -1;
  };
  const kindFits = (kind, id) => kind === 'any' || kindOf(id) === kind || (kind === 'light' && (armorClass(id) === 0 || armorClass(id) === 2)) || (kind === 'heavy' && armorClass(id) === 1);
  const kitFits = (k, id) => kindFits(k.kind, id) && itemTier(id) <= k.gearTier;
  // gamemode.js eat hook: true when baseId is a kit (used up by the game: a kit that mends nothing is handed back)
  globalThis.__dboDurabilityKit = (a, baseId) => {
    const k = C.enabled ? KITS.get(baseId >>> 0) : null;
    if (!k) return false;
    a >>>= 0;
    const fits = (w) => kitFits(k, w.baseId) && w.tier >= 1 && w.tier <= k.maxTier;
    const worn = wornOf(a).map((w) => Object.assign(w, { tier: tierOf(a, w) })).filter(fits);
    if (worn.length) {
      const w = worn[0];
      const l = ledger(a); l[keyOf(w)] = -tierOfName(w.name) * perTier(kindOf(w.baseId));
      try { writeLedger(a, l); } catch (e) { giveItem(a, baseId, 1); return true; }
      notice(a, `You mend your ${bareName(w.entry)} in the field. It is whole again.`);
      log(`durability: ${who(a)} field-mended worn ${descOf(w.baseId)} from ${NAMES[w.tier]} with ${descOf(baseId)}`);
      return true;
    }
    const packed = ['weapon', 'armor'].flatMap((kind) => damagedOf(a, kind)).filter(fits);
    if (packed.length && renameOne(a, packed[0].baseId, packed[0].name, 0)) {
      const l = ledger(a); const key = keyOf(packed[0]); if (key in l) { delete l[key]; try { writeLedger(a, l); } catch (e) { /* the name is Intact */ } }
      notice(a, `You mend your ${bareName(packed[0].entry)} in the field. It is whole again.`);
      log(`durability: ${who(a)} field-mended ${descOf(packed[0].baseId)} from ${NAMES[packed[0].tier]} with ${descOf(baseId)}`);
      return true;
    }
    giveItem(a, baseId, 1);
    notice(a, `Nothing you carry is only ${NAMES[1] || 'worn'}${k.kind === 'any' ? '' : ` (${({ weapon: 'a weapon', light: 'light armour or clothing', heavy: 'heavy armour', armor: 'armour' })[k.kind] || k.kind})`}${Number.isFinite(k.gearTier) ? ' and within this tool\'s grade' : ''}. It cannot mend worse than that; take it to a smith.`);
    return true;
  };
  onUi('repairClose', (a) => { S.pending.delete(a >>> 0); closeWidget(a, WIDGET_ID); });
  onUi('close', (a, args, widgetId) => { if (widgetId === WIDGET_ID) S.pending.delete(a >>> 0); });

  log(`durability: ${C.enabled ? 'on' : 'off'}, tiers ${NAMES.map((n) => n || 'Intact').join('/')}, effect ${C.effectMult.join('/')}, ${perTier('weapon')} weapon / ${perTier('armor')} armour points a tier, fee ${Math.round(C.feePerTier * 100)}% a tier (min ${C.feeMin}), destroyed`);
  return { tierOfName, nameAt, wornOf, tierOf, feeOf, recipeOf };
};
