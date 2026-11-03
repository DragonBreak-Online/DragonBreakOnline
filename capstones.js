// DragonBreak Online: Grandmaster capstones, one reward at a skill's 100 (Nat, 2 Nov; _work/grandmaster-capstones.md).
// Loaded by gamemode.js after smithing.js; config "capstones": { enabled, <skill id>: { enabled } }. Hot reload.
//
// A Grandmaster holds the skill at the Wheel's per-skill cap (100). Only the Seat can pass 90, so a character holds one
// capstone at most, and loses it when the skill falls back. The core every capstone uses:
//   isGrandmaster(a, skill)     the Wheel's level is at the cap
//   usedToday(a, key)           a once-a-day capstone's use, per real UTC day (Nat, 2 Nov), kept on the character
//   markUsed(a, key, skill)     (private.dboCapstones { key: 'YYYY-MM-DD' }), so a relog or a restart never resets it
// /capstone tells a player what theirs is and whether today's use is spent.
//
// Blacksmith, Maker's Mark: a weapon or armour forged at a forge by the Blacksmith Grandmaster carries their own name,
// "Steel Sword, forged by Eorlund" (itemnames.js). regions.js's craft hook reports a craft the whole chain let on
// (__dboCapstoneCrafted) before the engine hands the item over, so the plain copies are counted then and the ones that
// appear after are named: copies with no tempering or enchantment first, so a piece already carried is never renamed.
'use strict';
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, cfg, registerChatCommand, realNameOf, itemName, recordOf } = api;
  const ITEMNAMES_JS = path.join(__dirname, 'itemnames.js');
  delete require.cache[ITEMNAMES_JS];
  const N = require(ITEMNAMES_JS);

  const raw = (cfg && cfg.capstones) || {};
  const C = Object.assign({ enabled: true, capLevel: 100, markRetries: 10, markRetryMs: 200 }, raw);
  const on = (skill) => C.enabled !== false && !!(C[skill] && C[skill].enabled !== false);
  const LABELS = { blacksmith: 'Maker\'s Mark: everything you forge carries your mark.' };
  const DAILY = new Set();   // keys of the once-a-day capstones, as each is built

  const get = (a, k, d) => { try { const v = mp.get(a >>> 0, k); return v === undefined || v === null ? d : v; } catch (e) { return d; } };
  const levelOf = (a, skill) => {
    const r = get(a, 'private.mastery', null);
    const p = r && r.skills && r.skills[skill];
    return p ? Number(p.level != null ? p.level : p.points) || 0 : 0;
  };
  const isGrandmaster = (a, skill) => levelOf(a, skill) >= Number(C.capLevel);
  const grandmasterOf = (a) => {
    const r = get(a, 'private.mastery', null);
    const ids = r && r.skills ? Object.keys(r.skills) : [];
    return ids.find((id) => isGrandmaster(a, id)) || null;
  };

  // ---- once a day ----------------------------------------------------------------------------------------------------
  const PROP = 'private.dboCapstones';
  const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
  const usedToday = (a, key, now = Date.now()) => { const s = get(a, PROP, {}); return !!s && s[key] === today(now); };
  const markUsed = (a, key, skill, now = Date.now()) => {
    const s = Object.assign({}, get(a, PROP, {}));
    s[key] = today(now);
    try { mp.set(a >>> 0, PROP, s); } catch (e) { log('capstones: could not keep a use', e.message); return false; }
    audit(`CAPSTONE ${who(a)} used ${skill} ${key} on ${s[key]}`);
    return true;
  };

  // ---- Blacksmith: Maker's Mark ------------------------------------------------------------------------------------
  const typeOf = (id) => { const r = recordOf(id >>> 0); return r ? String(r.record.type) : ''; };
  const descOf = (id) => { try { return String(mp.getDescFromId(id >>> 0)); } catch (e) { return ''; } };
  const plain = (e, id) => e && (Number(e.baseId) >>> 0) === id && !e.name && !e.worn && !e.wornLeft && Number(e.count) > 0;
  const EXTRAS = ['health', 'enchantmentId', 'enchantmentEffects', 'chargePercent', 'soul', 'poisonId', 'poisonCount'];
  const bare = (e) => EXTRAS.every((k) => e[k] === undefined || e[k] === null);
  const plainCount = (a, id) => (get(a, 'inventory', { entries: [] }).entries || []).filter((e) => plain(e, id)).reduce((n, e) => n + Number(e.count), 0);
  // `n` plain copies of id become one entry under `name`; bare copies first. The count actually named
  const nameCopies = (a, id, n, name) => {
    const entries = (get(a, 'inventory', { entries: [] }).entries || []).map((e) => Object.assign({}, e));
    let left = n;
    const taken = [];
    for (const pass of [true, false]) {
      for (const e of entries) {
        if (!left) break;
        if (!plain(e, id) || bare(e) !== pass) continue;
        const t = Math.min(left, Number(e.count));
        e.count = Number(e.count) - t; left -= t;
        taken.push(Object.assign({}, e, { count: t, name }));
      }
    }
    const done = n - left;
    if (!done) return 0;
    const out = entries.filter((e) => Number(e.count) > 0);
    for (const t of taken) {
      const same = out.find((e) => (Number(e.baseId) >>> 0) === id && e.name === name && !e.worn && !e.wornLeft && EXTRAS.every((k) => JSON.stringify(e[k]) === JSON.stringify(t[k])));
      if (same) same.count = Number(same.count) + t.count; else out.push(t);
    }
    try { mp.set(a >>> 0, 'inventory', { entries: out }); } catch (e) { log('capstones: could not write the mark', e.message); return 0; }
    return done;
  };
  // regions.js, once every check let a craft on and before the engine hands the item over
  globalThis.__dboCapstoneCrafted = (actorId, itemId, count, recipeId) => {
    const a = actorId >>> 0, id = itemId >>> 0;
    if (!on('blacksmith') || !isGrandmaster(a, 'blacksmith')) return false;
    if (typeof globalThis.__dboSmithIsForge !== 'function' || !globalThis.__dboSmithIsForge(recipeId >>> 0)) return false;
    const t = typeOf(id);
    if (t !== 'WEAP' && t !== 'ARMO') return false;
    const name = N.markName(itemName(descOf(id)), 'forged by', realNameOf(a));
    if (!name) return false;
    const before = plainCount(a, id);
    const want = Math.max(1, Math.floor(Number(count) || 1));
    let tries = 0;
    const step = () => {
      const made = Math.min(want, plainCount(a, id) - before);
      if (made > 0) {
        const n = nameCopies(a, id, made, name);
        if (n) log(`capstones: ${who(a)} forged ${n}x ${descOf(id)} as "${name}"`);
        return;
      }
      if (++tries < Number(C.markRetries)) setTimeout(step, Number(C.markRetryMs));
      else log(`capstones: ${who(a)}'s forged ${descOf(id)} never reached the pack; left unmarked`);
    };
    setTimeout(step, 0);
    return true;
  };

  // ---- /capstone ------------------------------------------------------------------------------------------------------
  registerChatCommand('capstone', (a) => {
    if (C.enabled === false) return personal(a, 'Grandmaster rewards are not open just now.');
    const skill = grandmasterOf(a);
    if (!skill) return personal(a, `A skill at ${C.capLevel} brings its Grandmaster reward. None of yours is there yet.`);
    if (!LABELS[skill] || !on(skill)) return personal(a, `Your ${skill} is at ${C.capLevel}. Its Grandmaster reward is still to come.`);
    const daily = DAILY.has(skill) ? (usedToday(a, skill) ? ' Today\'s use is spent; it returns at midnight UTC.' : ' Today\'s use is ready.') : '';
    return personal(a, `Grandmaster: ${LABELS[skill]}${daily}`);
  }, { help: 'your Grandmaster reward, if a skill of yours is at 100' });

  globalThis.__dboCapstones = { isGrandmaster, grandmasterOf, usedToday, markUsed, today, on };
  log(`capstones ${C.enabled === false ? 'off' : 'on'}: ${Object.keys(LABELS).filter(on).join(', ') || 'none'}`);
  return { isGrandmaster, grandmasterOf, usedToday, markUsed, nameCopies, plainCount };
};
