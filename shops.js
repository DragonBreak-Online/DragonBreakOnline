// DragonBreak Online: player shops (Nate, 19 Oct: "players run shops that sell their own goods, taxed by the hold").
// Loaded by business.js (it passes its own helpers in), config "shops".
//
// A business (business.js) can have one SHOP CHEST. Its owner or staff choose "Make a shop chest" on the ledger's panel
// (or /business shop chest); for armSeconds the next container they open inside that same business becomes the shop
// chest. A container any business lists as storage for rent, or another business's shop chest, is refused. The shop
// chest opens only for the owner and the business's staff (faction staff too); business.js's activation hook guards it,
// and gamemode.js's businessFailClosed refuses it to everyone while business.js is down (fail closed).
//
// Owner and staff price what is in the chest, per item TYPE and per single item (/business shop price, the panel's Shop
// tab). An item type is its base form plus its extra data (enchantment, tempering, poison, soul, own name): an enchanted
// sword is priced apart from a plain one. Items with no price are not for sale. Artifacts (artifacts.json), keys, gold
// and anything the server cannot name are never listed. Prices live in the business record (businesses.json), so they
// survive restarts; unmarking the chest keeps them; closing the business drops them, and the stock stays in the chest.
//
// Anyone at the ledger buys from its public page (or /shop): the price must be the one they were shown; the gold comes
// from the pack (as the tome and schematic ledgers take it); the goods leave the chest as their own inventory entries,
// extra data and all, and join the buyer's pack. Each step is checked, and a failed step puts everything back as it was.
// The gold is paid out through ledgersale.js (__dboLedgerSale): the hold's tax at its rate into its treasury marked
// { income: 'sales' }, sinkShare out of the game, the rest to the owner's bank account, or the faction's treasury for a
// faction's business. Every sale is written in the business's ledger and audited. The owner need not be online.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GOLD_BASE = 0xf;
// Fields of an inventory entry that are not part of what the item IS
const NOT_EXTRA = new Set(['baseId', 'count', 'worn', 'wornLeft']);
const extrasOf = (e) => {
  const o = {};
  for (const k of Object.keys(e || {}).sort()) {
    if (NOT_EXTRA.has(k)) continue;
    const v = e[k];
    if (v === undefined || v === null || v === false) continue;
    o[k] = v;
  }
  return o;
};
// The price key of an entry: its base form in hex, plus a hash of its extra data when it has any
const keyOf = (e) => {
  const base = ((Number(e && e.baseId) >>> 0) || 0).toString(16);
  const x = extrasOf(e);
  if (!Object.keys(x).length) return base;
  return `${base}-${crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 10)}`;
};
const countKey = (entries, key) => (entries || []).reduce((n, e) => n + (keyOf(e) === key ? Math.max(0, Math.floor(Number(e.count) || 0)) : 0), 0);
const clone = (v) => JSON.parse(JSON.stringify(v));

module.exports = (ctx) => {
  const { mp, log, personal, audit, who, display, cfg, takeGold, giveGold, data, save, note, earned, hex, get, cellOf, bizAt,
    isStaff, armSeconds, onlineActors, profileOf } = ctx;
  const C = Object.assign({
    enabled: true, minPrice: 1, maxPrice: 100000, maxPerBuy: 1000, listMax: 200, maxPrices: 200,
    // Never listed, by record type and by editor id (on top of artifacts.json)
    bannedTypes: ['KEYM'], bannedPattern: '',
    armSeconds: 0,
  }, cfg.shops || {});
  const ARM_S = Number(C.armSeconds) > 0 ? Number(C.armSeconds) : (Number(armSeconds) > 0 ? Number(armSeconds) : 60);
  const R = (ok, text) => ({ ok, text });
  const BANNED_TYPES = new Set((Array.isArray(C.bannedTypes) ? C.bannedTypes : []).map((t) => String(t).toUpperCase()));
  const BANNED_RX = (() => { try { return C.bannedPattern ? new RegExp(String(C.bannedPattern), 'i') : null; } catch (e) { log('shops: bannedPattern is not a valid pattern; nothing extra is banned', e.message); return null; } })();
  // Staff-granted artifacts (artifacts.json, by editor id) are never sold. Unreadable: nothing is listed (fail closed)
  const ARTIFACT_RX = (() => {
    try {
      const list = (JSON.parse(fs.readFileSync(path.join(__dirname, 'artifacts.json'), 'utf8')).patterns || []).filter((x) => typeof x === 'string' && x);
      return list.length ? new RegExp(list.map((p) => `(?:${p})`).join('|'), 'i') : /$^/;
    } catch (e) { log('shops: artifacts.json unreadable; no goods can be listed until it is', e.message); return null; }
  })();

  const recordOf = (id) => { try { const r = mp.lookupEspmRecordById(id >>> 0); return r && r.record ? r : null; } catch (e) { return null; } };
  const words = (edid) => String(edid || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
  const baseName = (baseId) => {
    try { if (typeof globalThis.__alduinakItemName === 'function') { const n = globalThis.__alduinakItemName(baseId >>> 0); if (n) return String(n); } } catch (e) { /* the editor id */ }
    const r = recordOf(baseId);
    return (r && words(r.record.editorId)) || `item ${hex(baseId)}`;
  };
  // What the extra data says about the item, shown beside its name (never the entry's own name: the trade summary's rule)
  const tagsOf = (e) => {
    const t = [];
    if (e.enchantmentId) t.push('enchanted');
    if (Number(e.health) > 1) t.push('improved');
    if (e.poisonId && Number(e.poisonCount) > 0) t.push('poisoned');
    if (Number(e.soul) > 0) t.push('filled');
    if (e.name) t.push('named');
    return t;
  };
  // Why an item may not be sold, or ''
  const bannedWhy = (baseId) => {
    if ((baseId >>> 0) === GOLD_BASE) return 'gold is not goods';
    const r = recordOf(baseId);
    if (!r) return 'the server does not know this item';
    if (BANNED_TYPES.has(String(r.record.type || '').toUpperCase())) return 'it cannot be sold';
    if (!ARTIFACT_RX) return 'the list of artifacts cannot be read just now';
    const ed = String(r.record.editorId || '');
    if (ed && ARTIFACT_RX.test(ed)) return 'artifacts are never sold';
    if (BANNED_RX && ed && BANNED_RX.test(ed)) return 'it cannot be sold here';
    return '';
  };

  // ---- the chest ----------------------------------------------------------------------------------------------------
  const chestOf = (b) => { const k = b && b.shop && b.shop.chest; const id = k ? parseInt(String(k), 16) >>> 0 : 0; return id || 0; };
  // Throws when the inventory cannot be read: a sale must not go ahead on a guess
  const entriesOf = (id) => { const v = mp.get(id >>> 0, 'inventory'); return v && Array.isArray(v.entries) ? v.entries : []; };
  // [{ key, baseId, name, tags, count, banned, price }], by name; null when the chest cannot be read
  const stockOf = (b) => {
    const chest = chestOf(b); if (!chest) return [];
    let entries; try { entries = entriesOf(chest); } catch (e) { log('shops: reading a shop chest failed', hex(chest), e.message); return null; }
    const rows = new Map();
    for (const e of entries) {
      const n = Math.floor(Number(e && e.count) || 0); if (n <= 0) continue;
      // Coin in the chest is the till, not goods
      if ((Number(e.baseId) >>> 0) === GOLD_BASE) continue;
      const key = keyOf(e);
      const row = rows.get(key);
      if (row) { row.count += n; continue; }
      const baseId = Number(e.baseId) >>> 0;
      rows.set(key, { key, baseId, name: baseName(baseId), tags: tagsOf(e), count: n, banned: bannedWhy(baseId), price: 0 });
    }
    const prices = (b.shop && b.shop.prices) || {};
    for (const row of rows.values()) row.price = !row.banned && prices[row.key] ? Math.round(Number(prices[row.key].price) || 0) : 0;
    return [...rows.values()].sort((x, y) => x.name.localeCompare(y.name) || x.key.localeCompare(y.key));
  };
  const forSale = (b) => (stockOf(b) || []).filter((r) => r.price > 0 && !r.banned && r.count > 0);
  const label = (r) => `${r.name}${r.tags.length ? ` (${r.tags.join(', ')})` : ''}`;
  const saleOpen = () => C.enabled && typeof globalThis.__dboLedgerSale === 'function';

  // Every business record that names this container its shop chest, valid or not ([[claimHex, record]])
  const shopRecordsOf = (ref) => {
    const k = hex(ref >>> 0), out = [];
    for (const [id, b] of Object.entries(data().businesses || {})) if (b && b.shop && b.shop.chest === k) out.push([id, b]);
    return out;
  };

  // ---- making and unmaking the shop chest ----------------------------------------------------------------------------
  const armChest = (a, claim, b) => {
    if (!C.enabled) return R(false, 'Shops are closed for now.');
    if (!isStaff(a, b)) return R(false, 'Only the owner and staff choose the shop chest.');
    ctx.armed.set(a >>> 0, { kind: 'shop', claim: claim.primary >>> 0, until: Date.now() + ARM_S * 1000 });
    return R(true, `Now open the container inside ${b.name} that is to be its shop chest, within ${ARM_S} seconds.`);
  };
  const unmarkChest = (a, claim, b) => {
    if (!isStaff(a, b)) return R(false, 'Only the owner and staff choose the shop chest.');
    const chest = chestOf(b);
    if (!chest) return R(false, `${b.name} has no shop chest.`);
    b.shop.chest = null;
    note(b, `${display(a)} made the shop chest a plain chest again; nothing is for sale until another is chosen`); save();
    audit(`SHOP ${who(a)} ${b.name}: chest ${hex(chest)} is no longer the shop chest (claim ${hex(claim.primary)})`);
    return R(true, 'It is a plain chest again; what is in it stays there. Nothing is for sale until you choose another shop chest.');
  };
  // From business.js's activation hook while armed: true (always: the arming activation never opens the container)
  const designate = (a, ref, arm) => {
    const { claim, biz } = bizAt(cellOf(ref));
    if (!C.enabled) { personal(a, 'Shops are closed for now.'); return true; }
    if (!biz || !claim || claim.primary !== (arm.claim >>> 0) || !isStaff(a, biz)) { personal(a, 'That container is not inside your business. Choose "Make a shop chest" again and open one inside it.'); return true; }
    const k = hex(ref);
    for (const [id, x] of Object.entries(data().businesses || {})) {
      if (x && x.chests && x.chests[k]) { personal(a, 'That container is listed as storage for rent. Take it off the list first, or choose another.'); return true; }
      if (x && x.shop && x.shop.chest === k && id !== hex(claim.primary)) { personal(a, 'That container is another business\'s shop chest.'); return true; }
    }
    if (biz.shop && biz.shop.chest === k) { personal(a, `That is already ${biz.name}'s shop chest.`); return true; }
    // A world container is emptied the first time anyone opens it: do that now, before goods go in
    try { if (typeof globalThis.__dboEmptyWorldContainer === 'function') globalThis.__dboEmptyWorldContainer(ref >>> 0); } catch (e) { /* not a world container */ }
    const was = chestOf(biz);
    biz.shop = Object.assign({ prices: {} }, biz.shop || {}, { chest: k, by: display(a), at: Date.now() });
    if (!biz.shop.prices) biz.shop.prices = {};
    note(biz, `${display(a)} chose ${was ? 'a new' : 'the'} shop chest`); save();
    audit(`SHOP ${who(a)} ${biz.name}: chest ${k} is the shop chest${was ? ` (was ${hex(was)})` : ''} (claim ${hex(claim.primary)})`);
    personal(a, `This is ${biz.name}'s shop chest now. Only you and the staff can open it. Put goods in it, then price them at the ledger (the Shop page, or /business shop price).${was ? ' The old shop chest is a plain chest again.' : ''}`);
    return true;
  };

  // ---- prices ---------------------------------------------------------------------------------------------------------
  // key: a stock row's key, or its number in /business shop stock; gold: a whole number, or 'off' / 0 to take it off sale
  const setPrice = (a, claim, b, key, gold) => {
    if (!C.enabled) return R(false, 'Shops are closed for now.');
    if (!isStaff(a, b)) return R(false, 'Only the owner and staff set the shop\'s prices.');
    if (!chestOf(b)) return R(false, `Choose a shop chest first.`);
    const stock = stockOf(b);
    if (!stock) return R(false, 'The shop chest cannot be read just now. Try again shortly.');
    const k = String(key || '').trim();
    const row = /^\d+$/.test(k) && Number(k) >= 1 && Number(k) <= stock.length && !stock.some((r) => r.key === k) ? stock[Number(k) - 1] : stock.find((r) => r.key === k);
    if (!row) return R(false, 'That is not in the shop chest.');
    if (row.banned) return R(false, `${label(row)} cannot be sold: ${row.banned}.`);
    b.shop.prices = b.shop.prices || {};
    const off = /^(off|none|0)$/i.test(String(gold).trim());
    if (off) {
      if (!b.shop.prices[row.key]) return R(false, `${label(row)} is not for sale.`);
      delete b.shop.prices[row.key];
      note(b, `${display(a)} took ${label(row)} off sale`); save();
      return R(true, `${label(row)} is no longer for sale.`);
    }
    const n = Number(String(gold).trim());
    if (!Number.isInteger(n) || n < C.minPrice || n > C.maxPrice) return R(false, `Price it from ${C.minPrice} to ${C.maxPrice} gold each.`);
    const was = b.shop.prices[row.key] ? Number(b.shop.prices[row.key].price) : 0;
    if (!was && Object.keys(b.shop.prices).length >= C.maxPrices) {
      // Make room from prices of goods no longer in the chest, oldest first
      const inStock = new Set(stock.map((r) => r.key));
      const gone = Object.entries(b.shop.prices).filter(([k2]) => !inStock.has(k2)).sort((x, y) => (Number(x[1].at) || 0) - (Number(y[1].at) || 0));
      if (!gone.length) return R(false, `A shop prices at most ${C.maxPrices} kinds of goods.`);
      delete b.shop.prices[gone[0][0]];
    }
    b.shop.prices[row.key] = { price: n, name: label(row), by: display(a), at: Date.now() };
    note(b, `${display(a)} priced ${label(row)} at ${n} gold each${was ? ` (was ${was})` : ''}`); save();
    return R(true, `${label(row)}: ${n} gold each.`);
  };

  // ---- buying ---------------------------------------------------------------------------------------------------------
  // Refunds that could not be handed back at once wait for the buyer's next login
  const owe = (a, n, why) => {
    const d = data(); d.shopRefunds = d.shopRefunds || {};
    const k = `c${hex(a)}`; d.shopRefunds[k] = (Number(d.shopRefunds[k]) || 0) + n; save();
    audit(`SHOP REFUND HELD ${who(a)} ${n} gold (${why}); paid at their next login`);
  };
  const login = (a) => {
    const d = data(); const k = `c${hex(a)}`; const n = Number((d.shopRefunds || {})[k]) || 0;
    if (!(n > 0)) return;
    if (giveGold(a, n)) { delete d.shopRefunds[k]; save(); audit(`SHOP ${who(a)} was paid ${n} gold of a held shop refund`); personal(a, `A shop sale that failed owed you ${n} gold; it is in your pack.`); }
  };
  // Moves n of `key` from the chest to the buyer for `total` gold, or changes nothing. { ok, text, moved }
  const move = (a, chest, key, n, total) => {
    let chestBefore;
    try { chestBefore = clone(entriesOf(chest)); } catch (e) { return R(false, 'The shop chest cannot be read just now. Try again shortly.'); }
    const after = chestBefore.map((e) => Object.assign({}, e));
    let left = n; const moved = [];
    for (const e of after) {
      if (left <= 0) break;
      if (keyOf(e) !== key) continue;
      const c = Math.max(0, Math.floor(Number(e.count) || 0)); if (!c) continue;
      const t = Math.min(c, left);
      // The entry itself goes across, extra data and all; only being worn stays behind
      const m = Object.assign({}, e, { count: t }); delete m.worn; delete m.wornLeft;
      moved.push(m); e.count = c - t; left -= t;
    }
    if (left > 0) return R(false, `Only ${n - left} left.`);
    const chestAfter = after.filter((e) => (Number(e.count) || 0) > 0);
    const had = countKey(chestBefore, key);
    if (!takeGold(a, total)) return R(false, `That costs ${total} gold, and you do not have it in your pack.`);
    let buyerMid = null;
    // Puts the chest and the pack back as they were before this sale and refunds the gold. A write that threw changed
    // nothing, so each side is read first and written back only when it differs from before.
    const undo = (stage, why) => {
      let chestClean = true, packClean = true;
      // The pack first: goods that cannot leave it again mean the sale stands, and the chest must not be refilled
      if (stage >= 3 && buyerMid) {
        const was = countKey(buyerMid, key);
        try { if (countKey(entriesOf(a), key) !== was) { mp.set(a, 'inventory', { entries: buyerMid }); packClean = countKey(entriesOf(a), key) === was; } } catch (e) { packClean = false; }
        // The goods are in the pack and will not come out: the sale stands as paid (putting the chest back and refunding
        // would duplicate the goods)
        if (!packClean) {
          log(`shops: a sale to ${who(a)} reported a failed pack write (${why}), but the goods could not be taken back; the sale stands`);
          audit(`SHOP STANDS ${who(a)} ${n}x [${key}] from chest ${hex(chest)} for ${total} gold: ${why}, and the pack could not be put back; the goods stay with the buyer, the gold is paid out`);
          return { ok: true, text: '', moved };
        }
      }
      if (stage >= 2) {
        try { if (countKey(entriesOf(chest), key) !== had) { mp.set(chest, 'inventory', { entries: chestBefore }); chestClean = countKey(entriesOf(chest), key) === had; } } catch (e) { chestClean = false; }
      }
      let refunded = false; try { refunded = giveGold(a, total) === true; } catch (e) { refunded = false; }
      if (!refunded) owe(a, total, why);
      const clean = chestClean && packClean;
      log(`shops: a sale to ${who(a)} failed at step ${stage} (${why}); ${clean ? 'put back' : 'PUT BACK INCOMPLETELY'}, ${refunded ? 'refunded' : 'refund held'}`);
      audit(`SHOP FAILED ${who(a)} ${n}x [${key}] from chest ${hex(chest)} for ${total} gold at step ${stage}: ${why}; ${clean ? 'everything put back' : `${chestClean ? '' : `THE CHEST COULD NOT BE PUT BACK (it held ${JSON.stringify(chestBefore)})`}${!chestClean && !packClean ? '; ' : ''}${packClean ? '' : `THE PACK STILL HOLDS THE GOODS (it held ${JSON.stringify(buyerMid)})`}`}; ${refunded ? 'gold refunded' : 'refund held for their next login'}`);
      return R(false, refunded ? 'The sale could not be finished. Your gold is returned and nothing changed hands.' : 'The sale could not be finished. Your gold will be returned at your next login.');
    };
    try { buyerMid = clone(entriesOf(a)); } catch (e) { return undo(1, 'the buyer\'s pack could not be read'); }
    const haveBefore = countKey(buyerMid, key);
    // 2. the goods leave the chest
    try { mp.set(chest, 'inventory', { entries: chestAfter }); } catch (e) { return undo(2, `the chest write threw: ${e.message}`); }
    try { if (countKey(entriesOf(chest), key) !== had - n) return undo(2, 'the chest did not change as written'); } catch (e) { return undo(2, `the chest could not be read back: ${e.message}`); }
    // 3. ...and join the buyer's pack: a plain item joins a plain stack, an item with extra data one exactly like it
    const buyerAfter = buyerMid.map((e) => Object.assign({}, e));
    for (const m of moved) {
      const hit = buyerAfter.find((e) => keyOf(e) === key && !e.worn && !e.wornLeft);
      if (hit) hit.count = (Number(hit.count) || 0) + m.count; else buyerAfter.push(m);
    }
    try { mp.set(a, 'inventory', { entries: buyerAfter }); } catch (e) { return undo(3, `the pack write threw: ${e.message}`); }
    try { if (countKey(entriesOf(a), key) !== haveBefore + n) return undo(3, 'the pack did not change as written'); } catch (e) { return undo(3, `the pack could not be read back: ${e.message}`); }
    return { ok: true, text: '', moved };
  };
  // A buy from the ledger's public page or /shop buy. shown: the unit price the buyer was shown
  const buy = (a, claim, b, key, count, shown) => {
    if (!C.enabled) return R(false, 'Shops are closed for now.');
    if (!saleOpen()) return R(false, 'This shop cannot take payment just now. Try again later.');
    const chest = chestOf(b);
    if (!chest) return R(false, `${b.name} sells nothing just now.`);
    if (isStaff(a, b)) return R(false, 'This is your own shop: take what you need from its chest.');
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) return R(false, 'Buy one or more.');
    if (n > C.maxPerBuy) return R(false, `At most ${C.maxPerBuy} at a time.`);
    const stock = stockOf(b);
    if (!stock) return R(false, 'The shop chest cannot be read just now. Try again shortly.');
    const row = stock.find((r) => r.key === String(key));
    if (!row || !(row.price > 0)) return R(false, 'That is not for sale any more.');
    if (row.banned) return R(false, `${label(row)} cannot be sold.`);
    if (!Number.isFinite(Number(shown)) || Number(shown) !== row.price) return R(false, `The price of ${label(row)} is now ${row.price} gold each. Look again before you buy.`);
    if (row.count < n) return R(false, `Only ${row.count} ${label(row)} left.`);
    const total = row.price * n;
    if (!Number.isSafeInteger(total) || total <= 0) return R(false, 'That is too much to buy at once.');
    const res = move(a, chest, row.key, n, total);
    if (!res.ok) return res;
    const what = `${n > 1 ? `${n}x ` : ''}${label(row)}`;
    let sale = null;
    try { sale = globalThis.__dboLedgerSale({ buyer: a, place: chest, price: total, what: `${what} at ${b.name}` }); } catch (e) { log('shops: paying out a sale failed', e.message); sale = null; }
    let paid = '';
    if (sale && sale.owner) {
      paid = `${sale.tax} tax to the hold, ${sale.split ? sale.split.sink : 0} out of the game, ${sale.owner.paid} to ${sale.owner.kind === 'faction' ? `the treasury of ${sale.owner.name}` : sale.owner.kind === 'bank' ? `${sale.owner.name}'s bank` : 'the hold (no owner to pay)'}`;
      if (sale.owner.kind !== 'hold') earned(b, Number(sale.owner.paid) || 0);
    } else {
      // The payout failed after the goods changed hands: the owner's takings are held at the ledger, not lost
      b.owed = (Number(b.owed) || 0) + total; paid = `${total} held for the owner (the payout failed)`;
    }
    note(b, `${display(a)} bought ${what} at ${row.price} gold each: ${total} gold (${paid})`); save();
    audit(`SHOP ${who(a)} bought ${what} [${row.key}] from ${b.name} (claim ${hex(claim.primary)}, chest ${hex(chest)}) for ${total} gold: ${sale ? sale.text : paid}; entries ${JSON.stringify(res.moved)}`);
    try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('business', a, 'shopBuy', claim.primary, 0); } catch (e) { /* the player log is optional */ }
    return R(true, `You buy ${what} for ${total} gold.`);
  };

  // ---- the panel (business.js sendPanel) and chat -------------------------------------------------------------------
  const lists = ctx.lists instanceof Map ? ctx.lists : new Map(); // actor -> { claim, rows: [{ key, price }] } the last /shop list
  const panelFields = (a, b, staff) => {
    const stock = chestOf(b) ? stockOf(b) : [];
    const items = (stock || []).filter((r) => r.price > 0 && !r.banned).slice(0, C.listMax).map((r) => ({ key: r.key, name: r.name, tags: r.tags, price: r.price, count: r.count }));
    const out = { shopOpen: saleOpen() && !!chestOf(b), shopItems: items, maxPerBuy: C.maxPerBuy };
    if (staff) Object.assign(out, {
      shopChest: !!chestOf(b), shopEnabled: !!C.enabled, minPrice: C.minPrice, maxPrice: C.maxPrice, shopArmSeconds: ARM_S,
      shopStock: (stock || []).slice(0, C.listMax).map((r) => ({ key: r.key, name: r.name, tags: r.tags, count: r.count, price: r.price, banned: r.banned })),
      shopUnreadable: stock === null,
    });
    return out;
  };
  // /shop where you stand: the list, numbered; /shop buy <number> [count]
  const chatShop = (a, claim, b, args) => {
    const w = String(args || '').trim().split(/\s+/).filter(Boolean);
    const sub = (w[0] || 'list').toLowerCase();
    if (sub === 'list' || !['buy'].includes(sub)) {
      if (!chestOf(b)) return personal(a, `${b.name} sells nothing just now.`);
      const rows = forSale(b);
      lists.set(a >>> 0, { claim: claim.primary, rows: rows.map((r) => ({ key: r.key, price: r.price })) });
      if (!rows.length) return personal(a, `${b.name} has nothing for sale just now.`);
      personal(a, `${b.name} sells (the hold takes its tax from each sale):`);
      rows.slice(0, C.listMax).forEach((r, i) => personal(a, `  ${i + 1}. ${label(r)}: ${r.price} gold each, ${r.count} in stock`));
      return personal(a, 'Buy with /shop buy <number> [how many].');
    }
    const l = lists.get(a >>> 0);
    const i = Number(w[1]), n = w[2] === undefined ? 1 : Number(w[2]);
    if (!l || l.claim !== claim.primary) return personal(a, 'Look at the list first: /shop');
    if (!Number.isInteger(i) || i < 1 || i > l.rows.length) return personal(a, `Choose a number from 1 to ${l.rows.length}: /shop buy <number> [how many]`);
    const r = buy(a, claim, b, l.rows[i - 1].key, n, l.rows[i - 1].price);
    personal(a, r.text);
  };
  // /business shop [chest [off] | stock | price <number> <gold|off>] for the owner and staff
  const chatBusinessShop = (a, claim, b, rest) => {
    const w = String(rest || '').trim().split(/\s+/).filter(Boolean);
    const sub = (w.shift() || 'stock').toLowerCase();
    if (sub === 'chest') return personal(a, ((w[0] || '').toLowerCase() === 'off' ? unmarkChest(a, claim, b) : armChest(a, claim, b)).text);
    if (sub === 'price') { if (w.length < 2) return personal(a, 'Price an item from the stock list: /business shop price <number> <gold each> (or off)'); return personal(a, setPrice(a, claim, b, w[0], w[1]).text); }
    if (!chestOf(b)) return personal(a, `${b.name} has no shop chest. /business shop chest, then open the container that is to be it.`);
    const stock = stockOf(b);
    if (!stock) return personal(a, 'The shop chest cannot be read just now. Try again shortly.');
    if (!stock.length) return personal(a, 'The shop chest is empty. Put goods in it, then price them here.');
    personal(a, `${b.name}'s shop chest (price with /business shop price <number> <gold each>, or off):`);
    stock.slice(0, C.listMax).forEach((r, i) => personal(a, `  ${i + 1}. ${label(r)} x${r.count}: ${r.banned ? `not for sale (${r.banned})` : r.price ? `${r.price} gold each` : 'no price, not for sale'}`));
  };
  // The line a customer reads in chat (a client without the panel, or with an older one)
  const publicShopLine = (b) => {
    if (!chestOf(b) || !saleOpen()) return '';
    const n = forSale(b).length;
    return n ? `${b.name} has ${n} kind${n > 1 ? 's' : ''} of goods for sale: /shop lists them.` : '';
  };

  log(`shops ${C.enabled ? 'on' : 'off'}: prices ${C.minPrice}..${C.maxPrice}, ${ARM_S} s to choose a shop chest, artifacts ${ARTIFACT_RX ? 'read' : 'UNREADABLE (nothing listed)'}`);
  return { C, keyOf, chestOf, stockOf, forSale, shopRecordsOf, armChest, unmarkChest, designate, setPrice, buy, panelFields, chatShop, chatBusinessShop, publicShopLine, login, saleOpen };
};
module.exports.keyOf = keyOf;
module.exports.extrasOf = extrasOf;
