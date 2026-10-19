// DragonBreak Online: staff enchanting for events. Loaded by gamemode.js on every hot reload.
//
// aussiepie's ask (17 Oct): enchant an item straight away, picking from every enchantment, instead of hunting one down and
// using the enchanting table. Staff of config minTier and above pick an unworn weapon or apparel piece in their own or an
// online player's pack, an enchantment (any ENCH record of the load order, weapon ones for weapons and apparel ones for
// apparel) and the strength of its main effect. That one copy becomes enchanted; the rest of its stack stays as it was.
//
// The enchantment goes on as a player-made one (the inventory entry's enchantmentEffects, as the enchanting table makes
// and craftedExtrasSystem.ts stores): every client rebuilds it from the effects, it can be given any strength, and it can
// never be disenchanted, so an event item teaches nobody its enchantment. The record's other effects keep their share of
// the main one's strength, duration and area stay the record's, and each effect's cost is the Creation Kit formula
// (the estimate craftedExtrasSystem.ts holds a crafted one to). A weapon gets a full charge of weaponCharge.
// Refused, as the table refuses them: effects on the Alchemy and Enchanting skills (the Fortify loop), more than 8
// effects, a piece whose own record carries an enchantment (EITM), a worn piece (take it off first: the equipment would
// keep the plain copy), and more than maxScale times the record's own strength.
//
// The F7 admin panel's Enchant tab (front staffData widgets 141 and 142, dbo:staffEnchant) and, for any client, chat:
//   /enchant find <words>                         enchantments matching the words
//   /enchant items [player|#TAG]                  the pieces that can be enchanted, numbered (yours without a name)
//   /enchant apply <n> <enchantment> [strength] [name...]   enchant piece n of that list
// Every use is an audit line and a #staff-commands note; the owner of the piece is told.
//
// gamemode-config.json "staffEnchant": enabled, minTier (gm | leadgm | developer | senior), maxScale, weaponCharge.
'use strict';

// The admin panel's Enchant tab reads these data-only widgets (front staffData); neither is drawn on its own
const ENCHANT_CATALOG_WIDGET_ID = 141;
const ENCHANT_ITEMS_WIDGET_ID = 142;
// ENCH ENIT: cast type at 8, delivery at 16, enchant type at 20 (6 an enchantment, 12 a staff's); as craftedExtrasSystem.ts
const ENCH_TYPE_ENCHANTMENT = 6;
// MGEF DATA: base cost (float) at 4, primary actor value at 68; effects on Alchemy and Enchanting are refused on an item
const REFUSED_EFFECT_AVS = new Set([16, 23, 106, 113, 145]);
const MAX_EFFECTS = 8;
const TIER_RANK = { senior: 4, developer: 3, leadgm: 2, gm: 1, trialgm: 0.5 };
const isSet = (v) => v !== undefined && v !== null && v !== false && v !== 0 && v !== '' && !(Array.isArray(v) && v.length === 0);
const ENCHANT_KEYS = ['enchantmentId', 'enchantmentEffects', 'maxCharge', 'chargePercent', 'removeEnchantmentOnUnequip'];
const round = (n, step) => Math.round(n / step) * step;

// Creation Kit effect cost; area is ignored, as for every vanilla enchantment (craftedExtrasSystem.ts formulaCost)
const formulaCost = (baseCost, e) => baseCost * Math.pow(Math.max(e.magnitude, 1), 1.1) * Math.pow(Math.max(e.duration / 10, 1), 1.1);
// An editor id in words: EnchWeaponFireDamage04 -> Fire Damage 04
const words = (edid) => String(edid || '')
  .replace(/^(DLC0?[12]|CYR|BSK|BS|CC[A-Z]{3}SSE\d+_?)/, '')
  .replace(/^Ench(antment)?_?/, '').replace(/^(Weapon|Armor|Robes)(?=[A-Z])/, '').replace(/Enchant(ment)?$/, '')
  .replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2')
  .replace(/\s+/g, ' ').trim() || String(edid || '');

// A magic effect's editor id in words, without its casting words: EnchFortifyHealthConstantSelf -> Fortify Health
const effectWords = (edid) => words(String(edid || '').replace(/(FF|Constant|Conc)?(Contact|Self|Aimed|TargetActor|TargetLocation)$/, ''));

// The effect whose cost is highest is the one the strength is given for (the engine's costliest effect)
const mainIndex = (effects) => {
  let best = 0, at = 0;
  effects.forEach((e, i) => { const c = formulaCost(e.baseCost || 0, e); if (c > best) { best = c; at = i; } });
  return at;
};

// What an enchantment becomes on an item at a strength. Pure. -> { effects } or { refused }
const effectsFor = (ench, strength, maxScale) => {
  if (!ench || !Array.isArray(ench.effects) || !ench.effects.length) return { refused: 'That enchantment has no effects.' };
  if (ench.effects.length > MAX_EFFECTS) return { refused: `That enchantment has ${ench.effects.length} effects; an item holds at most ${MAX_EFFECTS}.` };
  if (ench.effects.some((e) => REFUSED_EFFECT_AVS.has(e.av))) return { refused: 'Enchantments on the Alchemy or Enchanting skills cannot go on an item.' };
  const main = ench.effects[ench.main || 0];
  let scale = 1;
  if (main.magnitude > 0 && strength !== undefined && strength !== null && strength !== '') {
    const want = Number(strength);
    if (!Number.isFinite(want) || want <= 0) return { refused: 'The strength must be a number above 0.' };
    const cap = main.magnitude * (Number(maxScale) > 0 ? Number(maxScale) : 1);
    if (want > cap + 1e-6) return { refused: `At most ${round(cap, 0.1)} for this one (${maxScale} times its own ${round(main.magnitude, 0.1)}).` };
    scale = want / main.magnitude;
  }
  const effects = ench.effects.map((e) => {
    const x = { effectId: e.effectId >>> 0, magnitude: e.magnitude > 0 ? round(e.magnitude * scale, 0.1) : 0, area: e.area >>> 0, duration: e.duration >>> 0, cost: 0 };
    x.cost = round(formulaCost(e.baseCost || 0, x), 0.01);
    return x;
  });
  return { effects };
};

// One entry's identity: its base and every extra but the count and the worn flags
const keyOf = (e) => {
  const o = {};
  for (const k of Object.keys(e).sort()) if (!['count', 'worn', 'wornLeft'].includes(k) && isSet(e[k])) o[k] = e[k];
  return JSON.stringify(o);
};

// Takes one copy off the entry with this key and gives it the enchantment. Pure. -> { entries, made } or { refused }
const enchantOne = (entries, key, extras) => {
  const list = (entries || []).map((e) => Object.assign({}, e));
  const at = list.findIndex((e) => keyOf(e) === key && Number(e.count) > 0 && !e.worn && !e.wornLeft);
  if (at < 0) return { refused: list.some((e) => keyOf(e) === key && (e.worn || e.wornLeft)) ? 'Take that piece off first.' : 'That piece is no longer in the pack.' };
  const from = list[at];
  from.count = Number(from.count) - 1;
  const made = { baseId: Number(from.baseId) >>> 0, count: 1 };
  for (const k of Object.keys(from)) if (!['baseId', 'count', 'worn', 'wornLeft', ...ENCHANT_KEYS].includes(k) && isSet(from[k])) made[k] = from[k];
  Object.assign(made, extras);
  list.push(made);
  return { entries: list.filter((e) => Number(e.count) > 0), made };
};

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, onlineActors, registerChatCommand, cfg } = api;
  const fn = (f, dflt) => (typeof f === 'function' ? f : dflt);
  const staffNote = fn(api.staffNote, () => {});
  const staffTierOf = fn(api.staffTierOf, () => null);
  const findByName = fn(api.findByName, () => 0);
  const onUi = fn(api.onUi, null);
  const openWidget = fn(api.openWidget, null);
  const closeWidget = fn(api.closeWidget, () => {});
  const sendPacket = fn(api.sendPacket, () => false);
  const itemNameOf = fn(api.itemName, () => '');
  const C = Object.assign({ enabled: true, minTier: 'leadgm', maxScale: 3, weaponCharge: 3000 }, (cfg && cfg.staffEnchant) || {});
  const allowed = (a) => {
    if (!C.enabled) return false;
    let tier = null; try { tier = staffTierOf(a); } catch (e) { tier = null; }
    return !!tier && (TIER_RANK[tier] || 0) >= (TIER_RANK[C.minTier] || TIER_RANK.leadgm);
  };
  const recordOf = (id) => { try { const r = mp.lookupEspmRecordById(id >>> 0); return r && r.record ? r : null; } catch (e) { return null; } };
  const fieldOf = (r, type) => ((r && r.record && r.record.fields) || []).find((f) => f && f.type === type && f.data instanceof Uint8Array);
  const view = (d) => new DataView(d.buffer, d.byteOffset, d.byteLength);
  const descOf = (id) => { try { return String(mp.getDescFromId(id >>> 0) || ''); } catch (e) { return ''; } };

  // ---- every enchantment of the load order, read once per process (the load order changes only with a restart) -------
  const mgefOf = (id) => {
    const r = recordOf(id); const d = fieldOf(r, 'DATA');
    return { edid: r ? String(r.record.editorId || '') : '', baseCost: d && d.data.byteLength >= 8 ? view(d.data).getFloat32(4, true) : 0, av: d && d.data.byteLength >= 72 ? view(d.data).getInt32(68, true) : -1 };
  };
  const readCatalog = () => {
    let ids = [];
    try { ids = Array.from(mp.getEspmRecordIdsByType('ENCH') || [], (x) => Number(x) >>> 0); } catch (e) { log('staff enchant: the ENCH records could not be listed', e.message); return []; }
    const mgefs = new Map();
    const out = [];
    for (const id of ids) {
      const r = recordOf(id); if (!r) continue;
      const enit = fieldOf(r, 'ENIT'); if (!enit || enit.data.byteLength < 24) continue;
      const v = view(enit.data);
      if (v.getUint32(20, true) !== ENCH_TYPE_ENCHANTMENT) continue;
      const cast = v.getUint32(8, true), delivery = v.getUint32(16, true);
      const kind = cast === 1 && delivery === 1 ? 'w' : cast === 0 && delivery === 0 ? 'a' : '';
      if (!kind) continue;
      const effects = [];
      let cur = null;
      for (const f of r.record.fields || []) {
        if (!f || !(f.data instanceof Uint8Array)) continue;
        if (f.type === 'EFID' && f.data.byteLength >= 4) {
          let g = 0; try { g = r.toGlobalRecordId(view(f.data).getUint32(0, true)) >>> 0; } catch (e) { g = 0; }
          cur = g ? { effectId: g } : null;
        } else if (f.type === 'EFIT' && cur && f.data.byteLength >= 12) {
          const x = view(f.data);
          if (!mgefs.has(cur.effectId)) mgefs.set(cur.effectId, mgefOf(cur.effectId));
          const m = mgefs.get(cur.effectId);
          effects.push(Object.assign(cur, { magnitude: x.getFloat32(0, true), area: x.getUint32(4, true), duration: x.getUint32(8, true), baseCost: m.baseCost, av: m.av, edid: m.edid }));
          cur = null;
        }
      }
      if (!effects.length || effects.length > MAX_EFFECTS || effects.some((e) => REFUSED_EFFECT_AVS.has(e.av))) continue;
      const edid = String(r.record.editorId || '');
      const plugin = descOf(id).replace(/^[0-9a-f]+:/i, '');
      out.push({ id, edid, name: words(edid), plugin, kind, effects, main: mainIndex(effects) });
    }
    out.sort((x, y) => x.name.localeCompare(y.name) || x.id - y.id);
    log(`staff enchant: ${out.length} enchantments (${out.filter((x) => x.kind === 'w').length} for weapons) from ${ids.length} ENCH records`);
    return out;
  };
  const catalog = () => {
    const c = globalThis.__dboStaffEnchantCatalog;
    if (Array.isArray(c) && c.length) return c;
    return (globalThis.__dboStaffEnchantCatalog = readCatalog());
  };
  const byId = (id) => catalog().find((e) => e.id === (id >>> 0)) || null;
  // An enchantment named by its form id (hex, 0x optional) or editor id
  const findEnch = (s) => {
    const t = String(s || '').trim();
    if (/^(0x)?[0-9a-f]{1,8}$/i.test(t)) { const e = byId(parseInt(t.replace(/^0x/i, ''), 16)); if (e) return e; }
    return catalog().find((e) => e.edid.toLowerCase() === t.toLowerCase()) || null;
  };
  const effectText = (ench, effects) => (effects || ench.effects).map((e, i) => `${effectWords(ench.effects[i].edid) || (e.effectId >>> 0).toString(16)}${e.magnitude ? ' ' + round(e.magnitude, 0.1) : ''}${e.duration ? ` for ${e.duration}s` : ''}`).join(', ');

  // ---- the pieces that can take one ------------------------------------------------------------------------------------
  const typeOf = (id) => { const r = recordOf(id); return r ? String(r.record.type || '') : ''; };
  const ownEnchant = (id) => { const f = fieldOf(recordOf(id), 'EITM'); return !!(f && f.data.byteLength >= 4 && view(f.data).getUint32(0, true)); };
  const nameOfEntry = (e) => {
    if (typeof e.name === 'string' && e.name) return e.name;
    let n = ''; try { n = String(itemNameOf(Number(e.baseId) >>> 0) || ''); } catch (x) { n = ''; }
    if (n) return n;
    const r = recordOf(Number(e.baseId) >>> 0);
    return r ? words(r.record.editorId) : (Number(e.baseId) >>> 0).toString(16);
  };
  const currentText = (e) => {
    if (Array.isArray(e.enchantmentEffects) && e.enchantmentEffects.length) return `made: ${e.enchantmentEffects.map((x) => { const m = mgefOf(x.effectId); return `${effectWords(m.edid) || (x.effectId >>> 0).toString(16)} ${round(Number(x.magnitude) || 0, 0.1)}`; }).join(', ')}`;
    if (isSet(e.enchantmentId)) { const r = recordOf(Number(e.enchantmentId) >>> 0); return r ? words(r.record.editorId) : 'enchanted'; }
    return '';
  };
  const piecesOf = (t) => {
    let inv = null; try { inv = mp.get(t, 'inventory'); } catch (e) { inv = null; }
    const out = [];
    for (const e of (inv && inv.entries) || []) {
      if (!e || !(Number(e.count) > 0)) continue;
      const type = typeOf(Number(e.baseId) >>> 0);
      if (type !== 'WEAP' && type !== 'ARMO') continue;
      const why = ownEnchant(Number(e.baseId) >>> 0) ? 'its own record is enchanted' : (e.worn || e.wornLeft) ? 'worn: take it off first' : '';
      out.push({ key: keyOf(e), name: nameOfEntry(e), count: Number(e.count), kind: type === 'WEAP' ? 'w' : 'a', ok: !why, why, now: currentText(e) });
    }
    return out.sort((x, y) => Number(y.ok) - Number(x.ok) || x.name.localeCompare(y.name)).slice(0, 300);
  };

  // ---- doing it ------------------------------------------------------------------------------------------------------
  const cleanName = (t) => String(t || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').split('#{').join('# {').replace(/\s+/g, ' ').trim().slice(0, 64);
  // -> '' when done, else why not
  const apply = (a, t, key, enchId, strength, name) => {
    if (!allowed(a)) return 'Enchanting items is for staff of a higher rank.';
    if (!onlineActors().some((x) => (x >>> 0) === (t >>> 0))) return 'That player is not in the game.';
    const ench = byId(enchId);
    if (!ench) return 'No such enchantment.';
    const piece = piecesOf(t).find((p) => p.key === key);
    if (!piece) return 'That piece is no longer in the pack.';
    if (!piece.ok) return `That piece cannot take an enchantment: ${piece.why}.`;
    if (piece.kind !== ench.kind) return ench.kind === 'w' ? 'That is a weapon enchantment; pick a weapon.' : 'That is an apparel enchantment; pick armour, clothing or jewellery.';
    const built = effectsFor(ench, strength, C.maxScale);
    if (built.refused) return built.refused;
    const extras = { enchantmentEffects: built.effects };
    if (ench.kind === 'w') extras.maxCharge = Math.max(1, Number(C.weaponCharge) || 3000);
    const nm = cleanName(name);
    if (nm) extras.name = nm;
    let inv = null; try { inv = mp.get(t, 'inventory'); } catch (e) { inv = null; }
    const r = enchantOne((inv && inv.entries) || [], key, extras);
    if (r.refused) return r.refused;
    try { mp.set(t, 'inventory', Object.assign({}, inv, { entries: r.entries })); } catch (e) { log('staff enchant: inventory write failed', e.message); return 'The pack could not be changed. Nothing was done.'; }
    const what = `${piece.name}${nm && nm !== piece.name ? ` (named "${nm}")` : ''}: ${ench.name} [${ench.id.toString(16)} ${ench.edid}] ${effectText(ench, built.effects)}`;
    audit(`STAFF ENCHANT ${who(a)} enchanted ${(t >>> 0) === (a >>> 0) ? 'their own' : `${who(t)}'s`} ${what}`);
    staffNote(a, '/enchant', `/enchant ${(t >>> 0) === (a >>> 0) ? 'own' : display(t)}: ${what}`);
    if ((t >>> 0) !== (a >>> 0)) personal(t, `${display(a)} enchanted your ${piece.name}: ${ench.name}.`);
    return '';
  };

  // ---- the admin panel's Enchant tab ---------------------------------------------------------------------------------
  const sendCatalog = (a) => {
    if (!openWidget) return;
    const list = catalog().map((e) => ({ id: e.id.toString(16), n: e.name, e: e.edid, p: e.plugin, k: e.kind, m: e.main, fx: e.effects.map((x) => [effectWords(x.edid), round(x.magnitude, 0.1), x.duration, x.area]) }));
    openWidget(a, { type: 'staffData', id: ENCHANT_CATALOG_WIDGET_ID, kind: 'enchantCatalog', list, maxScale: Number(C.maxScale) || 1 }, false);
  };
  const sendPieces = (a, t) => {
    if (!openWidget) return;
    openWidget(a, { type: 'staffData', id: ENCHANT_ITEMS_WIDGET_ID, kind: 'enchantItems', target: (t >>> 0) === (a >>> 0) ? '' : (t >>> 0).toString(16), targetName: display(t), items: piecesOf(t), at: Date.now() }, false);
  };
  // '' is the staff member; else an online actor's id in hex
  const targetOf = (a, hex) => {
    const s = String(hex || '').trim();
    if (!s) return a;
    const id = parseInt(s, 16) >>> 0;
    return onlineActors().find((x) => (x >>> 0) === id) || 0;
  };
  const result = (a, ok, text) => { try { sendPacket(a, { customPacketType: 'adminActionResult', ok: !!ok, text }); } catch (e) { /* old client */ } personal(a, text); };
  if (onUi) onUi('staffEnchant', (a, args) => {
    const op = String(args[0] || '');
    if (op === 'close') { closeWidget(a, ENCHANT_CATALOG_WIDGET_ID); closeWidget(a, ENCHANT_ITEMS_WIDGET_ID); return; }
    if (!allowed(a)) return result(a, false, 'Enchanting items is for staff of a higher rank.');
    if (op === 'catalog') return sendCatalog(a);
    if (op === 'items') { const t = targetOf(a, args[1]); if (!t) return result(a, false, 'That player is not in the game.'); return sendPieces(a, t); }
    if (op !== 'apply') return;
    let f = {}; try { f = JSON.parse(String(args[1] || '{}')) || {}; } catch (e) { f = {}; }
    const t = targetOf(a, f.target);
    if (!t) return result(a, false, 'That player is not in the game.');
    const why = apply(a, t, String(f.key || ''), parseInt(String(f.ench || ''), 16) >>> 0, f.strength, f.name);
    result(a, !why, why || 'Enchanted.');
    sendPieces(a, t);
  });

  // ---- chat, for any client ------------------------------------------------------------------------------------------
  // The last /enchant items list per staff member: actor -> { target, keys }
  const lists = globalThis.__dboStaffEnchantLists instanceof Map ? globalThis.__dboStaffEnchantLists : (globalThis.__dboStaffEnchantLists = new Map());
  const USAGE = '/enchant find <words> | items [player|#TAG] | apply <n> <enchantment id or editor id> [strength] [name]. The F7 panel\'s Enchant tab does the same.';
  registerChatCommand('enchant', (a, args) => {
    if (!allowed(a)) return personal(a, C.enabled ? 'Enchanting items is for staff of a higher rank.' : 'Staff enchanting is off.');
    const text = String(args || '').trim();
    const [sub, ...rest] = text.split(/\s+/);
    if (sub === 'find') {
      const q = rest.join(' ').toLowerCase();
      if (!q) return personal(a, 'Say what to look for: /enchant find <words>, e.g. /enchant find fire damage');
      const hits = catalog().filter((e) => `${e.name} ${e.edid} ${e.plugin}`.toLowerCase().includes(q));
      if (!hits.length) return personal(a, `No enchantment matches "${q}".`);
      return personal(a, [`${hits.length} enchantment${hits.length === 1 ? '' : 's'} (${hits.length > 12 ? 'the first 12; ' : ''}w weapon, a apparel):`]
        .concat(hits.slice(0, 12).map((e) => `  ${e.id.toString(16)} ${e.name} (${e.kind}, ${e.plugin}): ${effectText(e)}`)).join('\n'));
    }
    if (sub === 'items') {
      const t = rest.length ? findByName(rest.join(' ')) : a;
      if (!t) return personal(a, 'No such player. Use their name or #TAG.');
      const pieces = piecesOf(t).filter((p) => p.ok);
      lists.set(a >>> 0, { target: t >>> 0, keys: pieces.map((p) => p.key) });
      if (!pieces.length) return personal(a, `${(t >>> 0) === (a >>> 0) ? 'You carry' : `${display(t)} carries`} nothing unworn that can take an enchantment.`);
      return personal(a, [`Pieces of ${display(t)} (then /enchant apply <n> <enchantment> [strength] [name]):`]
        .concat(pieces.slice(0, 20).map((p, i) => `  ${i + 1}. ${p.name}${p.count > 1 ? ` x${p.count}` : ''} (${p.kind === 'w' ? 'weapon' : 'apparel'})${p.now ? `, now ${p.now}` : ''}`)).join('\n'));
    }
    if (sub === 'apply') {
      const l = lists.get(a >>> 0);
      if (!l) return personal(a, 'First list the pieces: /enchant items [player].');
      const n = Number(rest[0]);
      const key = Number.isInteger(n) && n >= 1 ? l.keys[n - 1] : undefined;
      if (!key) return personal(a, `No piece ${rest[0] || ''} in your last list. /enchant items lists them again.`);
      const ench = findEnch(rest[1]);
      if (!ench) return personal(a, 'Name the enchantment by the id or editor id /enchant find shows.');
      const strength = rest[2] !== undefined && /^\d+(\.\d+)?$/.test(rest[2]) ? Number(rest[2]) : undefined;
      const name = rest.slice(strength === undefined ? 2 : 3).join(' ');
      const why = apply(a, l.target, key, ench.id, strength, name);
      if (why) return personal(a, why);
      lists.set(a >>> 0, { target: l.target, keys: piecesOf(l.target).filter((p) => p.ok).map((p) => p.key) });
      return personal(a, `Enchanted with ${ench.name}. /enchant items shows the pack again (the numbers change).`);
    }
    return personal(a, USAGE);
  }, { admin: true, help: 'find <words> | items [player] | apply <n> <enchantment> [strength] [name]: enchant one piece for an event' });

  return { effectsFor, enchantOne, keyOf, words, mainIndex, apply, catalog, piecesOf };
};
module.exports.effectsFor = effectsFor;
module.exports.enchantOne = enchantOne;
module.exports.keyOf = keyOf;
module.exports.words = words;
module.exports.effectWords = effectWords;
