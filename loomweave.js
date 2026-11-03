// DragonBreak Online: loom recipes the plugins do not carry, woven by the server (Nat, 2 Nov: Druadach's orcish clothes
// "loom-craftable for Orc tailors at Common tier"). Druadach's author forbids AI work, so a plugin recipe is out (Nat's
// ruling, 1 Nov) and the server makes the garment itself. The recipes name the mod's items, so they live in a gitignored
// sidecar, loom-recipes.private.json, delivered with deploy-private and never committed. Loaded by gamemode.js after
// salvage.js, whose loom panel shows the rows (__dboLoomWeaveRows) and sends the choice back (__dboLoomWeave).
//
// loom-recipes.private.json: { recipes: [{ product: desc, name?: shown name, count?: 1, materials: [[desc, n]], races?:
// [RACE editor id prefixes, so the vampire race counts], people?: "Orcish", tier?: 1..5 }] }. The name is there because
// the item catalog keeps a private mod's names in its own sidecar; without one the catalog's name is used. A recipe's
// tier is its own, else tailoring.js's by item value (Common <= 15 gold). A row shows to a Tailor of the recipe's race
// (any race when it names none) who reaches its tier; staff skip the tier, never the race, so their looms still open as
// usual. A weave takes plain, unworn stacks only, gives the product and is Tailor work (masterySystem's award). A missing
// or broken file gives no rows and one log line; the file is re-read when it changes.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, who, isAdmin, masteryOf, giveItem, itemName, raceEdidOf } = api;
  const FILE = 'loom-recipes.private.json';
  const TIERS = ['Common clothes', 'Fine clothes', 'Noble clothes', 'Scaled armor', 'Masterwork garments'];
  const RANKS = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'];

  const idOf = (d) => { try { return mp.getIdFromDesc(String(d)) >>> 0; } catch (e) { return 0; } };
  const nameOf = (d) => itemName(d) || 'something';
  const clean = (r) => {
    const productId = r && r.product ? idOf(r.product) : 0;
    const materials = Array.isArray(r && r.materials) ? r.materials.map(([d, n]) => ({ desc: String(d), id: idOf(d), n: Math.floor(Number(n)) })) : [];
    if (!productId || !materials.length || materials.some((m) => !m.id || !(m.n > 0))) { log(`loomweave: recipe for ${r && r.product} skipped (an id is not in the load order)`); return null; }
    return {
      key: String(r.product).toLowerCase(), desc: String(r.product), name: String(r.name || ''), productId, count: Math.max(1, Math.floor(Number(r.count) || 1)), materials,
      races: Array.isArray(r.races) ? r.races.map(String).filter(Boolean) : [], people: String(r.people || ''),
      tier: Number.isInteger(r.tier) && r.tier >= 1 && r.tier <= 5 ? r.tier : 0,
    };
  };
  let recipes = [], mtime = null;
  const load = () => {
    const file = path.resolve(FILE);
    let m = -1; try { m = fs.statSync(file).mtimeMs; } catch (e) { m = -1; }
    if (m === mtime) return recipes;
    mtime = m;
    if (m < 0) { recipes = []; log(`loomweave: ${FILE} missing, so this server weaves no loom recipes of its own`); return recipes; }
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')).recipes;
      recipes = (Array.isArray(raw) ? raw : []).map(clean).filter(Boolean);
      log(`loomweave: ${recipes.length} loom recipe(s) from ${FILE}`);
    } catch (e) { recipes = []; log(`loomweave: ${FILE} unreadable (${e.message}), so no loom recipes of its own`); }
    return recipes;
  };

  const tierOf = (r) => { if (r.tier) return r.tier; try { const t = Number(globalThis.__dboTailorTierOf(r.productId)); return t >= 1 && t <= 5 ? t : 1; } catch (e) { return 1; } };
  // 0 without the Tailor skill, else 1..5
  const tailorTier = (a) => {
    const rec = masteryOf(a);
    if (!rec || !Array.isArray(rec.order) || !rec.order.includes('tailor')) return 0;
    return Math.max(0, Math.min(4, Number(((rec.skills || {}).tailor || {}).rank) || 0)) + 1;
  };
  const raceFits = (a, r) => { if (!r.races.length) return true; const race = raceEdidOf(a); return !!race && r.races.some((x) => race.startsWith(x)); };
  const staff = (a) => { try { return !!isAdmin(a); } catch (e) { return false; } };
  const mayWeave = (a, r) => tailorTier(a) > 0 && raceFits(a, r) && (staff(a) || tailorTier(a) >= tierOf(r));

  // The same plain stacks salvage.js takes: unworn, no extra data
  const EXTRA = ['enchantmentId', 'name', 'poisonId', 'soul', 'chargePercent', 'maxCharge', 'removeEnchantmentOnUnequip'];
  const plain = (e) => !!e && !e.worn && !e.wornLeft && Number(e.count) > 0
    && EXTRA.every((k) => e[k] === undefined || e[k] === null || e[k] === 0 || e[k] === '' || e[k] === false)
    && !(Number(e.poisonCount) > 0) && (e.health === undefined || e.health === null || Number(e.health) === 1)
    && !(Array.isArray(e.enchantmentEffects) && e.enchantmentEffects.length);
  const entriesOf = (a) => { try { const inv = mp.get(a, 'inventory'); return inv && Array.isArray(inv.entries) ? inv.entries : []; } catch (e) { return []; } };
  const have = (entries, id) => entries.filter((e) => plain(e) && (Number(e.baseId) >>> 0) === id).reduce((n, e) => n + Number(e.count), 0);
  const matsText = (r) => r.materials.map((m) => `${m.n} ${nameOf(m.desc)}`).join(', ');
  const missing = (a, r) => { const inv = entriesOf(a); return r.materials.filter((m) => have(inv, m.id) < m.n); };

  // Rows for salvage.js's loom panel: weave:<product desc>
  const rows = (a) => load().filter((r) => mayWeave(a, r)).map((r) => ({
    id: `weave:${r.key}`,
    label: `Weave ${r.count > 1 ? `${r.count} ` : ''}${r.name || nameOf(r.desc)}: ${matsText(r)}${missing(a, r).length ? ' (missing materials)' : ''}`,
  }));

  // { ok, text }: takes the materials and gives the product, or says why not
  const weave = (a, key) => {
    const r = load().find((x) => x.key === String(key || '').toLowerCase());
    if (!r) return { ok: false, text: 'That is not woven here just now.' };
    const name = r.name || nameOf(r.desc);
    if (!tailorTier(a)) return { ok: false, text: 'Only a Tailor weaves that.' };
    if (!raceFits(a, r)) { const people = r.people || 'its own people'; return { ok: false, text: `${name} is ${people} work: only ${people} tailors weave it.` }; }
    const need = tierOf(r), got = tailorTier(a);
    if (!staff(a) && got < need) return { ok: false, text: `${TIERS[need - 1]} are ${RANKS[need - 1]} Tailor's work; you are ${/^[AEIOU]/.test(RANKS[got - 1]) ? 'an' : 'a'} ${RANKS[got - 1]} Tailor.` };
    const lack = missing(a, r);
    if (lack.length) return { ok: false, text: `To weave ${name} you need ${matsText(r)}; you are short of ${lack.map((m) => nameOf(m.desc)).join(' and ')}.` };
    // Every material is there (checked above): take each from its plain stacks, then write the pack once
    const entries = entriesOf(a).map((e) => Object.assign({}, e));
    for (const m of r.materials) {
      let left = m.n;
      for (const e of entries) {
        if (!left) break;
        if (!plain(e) || (Number(e.baseId) >>> 0) !== m.id) continue;
        const take = Math.min(left, Number(e.count));
        e.count = Number(e.count) - take; left -= take;
      }
    }
    try { mp.set(a, 'inventory', { entries: entries.filter((e) => Number(e.count) > 0) }); } catch (e) { log('loomweave: take failed', e.message); return { ok: false, text: 'The loom jams; nothing was used.' }; }
    // A Grandmaster Tailor's mark (capstones.js), counted before the garment is handed over
    try { if (typeof globalThis.__dboCapstoneWoven === 'function') globalThis.__dboCapstoneWoven(a, r.productId, r.count); } catch (e) { log('loomweave: capstone failed', e.message); }
    giveItem(a, r.productId, r.count);
    let units = 0;
    try { if (typeof globalThis.__alduinakMasteryAward === 'function') units = Number(globalThis.__alduinakMasteryAward(a, 'tailor', 1, r.productId)) || 0; } catch (e) { log('loomweave: award failed', e.message); }
    log(`loomweave: ${who(a)} wove ${r.count > 1 ? `${r.count} ` : ''}${name} (${r.desc}) from ${matsText(r)}; Tailor +${units}`);
    return { ok: true, text: `You weave ${r.count > 1 ? `${r.count} ` : ''}${name}.` };
  };

  globalThis.__dboLoomWeaveRows = rows;
  globalThis.__dboLoomWeave = weave;
  load();
  return { rows, weave, load };
};
