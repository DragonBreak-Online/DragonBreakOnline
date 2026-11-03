// DragonBreak Online: Grandmaster capstones, one reward at a skill's 100 (Nat, 2 Nov; _work/grandmaster-capstones.md).
// Loaded by gamemode.js after smithing.js; config "capstones": { enabled, <skill id>: { enabled } }. Hot reload.
//
// A Grandmaster holds the skill at the Wheel's per-skill cap (100). Only the Seat can pass 90, so a character holds one
// capstone at most, and loses it when the skill falls back. The core every capstone uses:
//   isGrandmaster(a, skill)     the Wheel's level is at the cap
//   usedToday(a, key)           a once-a-day capstone's use, per real UTC day (Nat, 2 Nov), kept on the character
//   markUsed(a, key, skill)     (private.dboCapstones { key: 'YYYY-MM-DD' }), so a relog or a restart never resets it
//   usedWithin(a, key, days)    the same for a weekly one
// /capstone tells a player what theirs is and whether its use is spent.
//
// Makers' marks (itemnames.js): what a Grandmaster makes carries their own name. The maker's module reports the work before
// the item is handed over, so the plain copies are counted then and the ones that appear after are named: copies with no
// tempering or enchantment first, so a piece already carried is never renamed.
//   Blacksmith, Maker's Mark     a weapon or armour forged at a forge: "Steel Sword, forged by Eorlund" (regions.js)
//   Tailor, Bespoke and Livery   a garment from a loom or woven by the server (regions.js, loomweave.js): "..., sewn by";
//                                /bespoke <name> names the next one for a buyer
//   Alchemist, Signature Draught once a UTC day, /signature and the next potion brewed: "..., brewed by" (alchemy.js)
//   Enchanter, Named Enchantment once a week, /enchantname <name> and the next item enchanted: "<name>, enchanted by"
//                                (enchanting.js reports the enchantment; the copy whose enchantment is new is named)
// Teaching:
//   Blade, Sword-Master's School /swordschool: two apprentices, whose Blade hits on their master in a duel between them
//                                are worth sparRate (skillrates.js asks __dboCapstoneSkillRate)
//   Arcane, Arch-Magister's Chair schools.js's apprenticeship: one more apprentice, half the study (asks __dboCapstones)
'use strict';
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, cfg, registerChatCommand, realNameOf, itemName, recordOf, findByName, distanceMeters, profileOf, discordOf } = api;
  const ITEMNAMES_JS = path.join(__dirname, 'itemnames.js');
  delete require.cache[ITEMNAMES_JS];
  const N = require(ITEMNAMES_JS);

  const raw = (cfg && cfg.capstones) || {};
  const C = Object.assign({ enabled: true, capLevel: 100, markRetries: 10, markRetryMs: 200, armMinutes: 10 }, raw);
  const on = (skill) => C.enabled !== false && !!(C[skill] && C[skill].enabled !== false);
  const LABELS = {
    blacksmith: 'Maker\'s Mark: everything you forge carries your mark.',
    tailor: 'Bespoke and Livery: your garments carry your mark.',
    alchemist: 'Signature Draught: once a day, a potion carrying your name.',
    enchanter: 'Named Enchantment: once a week, an enchanted item named by you.',
    blade: 'Sword-Master\'s School: up to two apprentices, who learn faster sparring with you.',
    arcane: 'Arch-Magister\'s Chair: one more apprentice, taught in half the time.',
  };

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
  const lastUse = (a, key) => { const s = get(a, PROP, {}); return (s && s[key]) || ''; };
  // Used within the last `days` UTC days (the day of use counts as the first)
  const usedWithin = (a, key, days, now = Date.now()) => {
    const d = lastUse(a, key);
    if (!d) return false;
    return (Date.parse(`${today(now)}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000 < days;
  };
  const markUsed = (a, key, skill, now = Date.now()) => {
    const s = Object.assign({}, get(a, PROP, {}));
    s[key] = today(now);
    try { mp.set(a >>> 0, PROP, s); } catch (e) { log('capstones: could not keep a use', e.message); return false; }
    audit(`CAPSTONE ${who(a)} used ${skill} ${key} on ${s[key]}`);
    return true;
  };

  // ---- makers' marks: what a Grandmaster makes arrives, then carries their name ------------------------------------
  const typeOf = (id) => { const r = recordOf(id >>> 0); return r ? String(r.record.type) : ''; };
  const descOf = (id) => { try { return String(mp.getDescFromId(id >>> 0)); } catch (e) { return ''; } };
  const plain = (e, id) => e && (Number(e.baseId) >>> 0) === id && !e.name && !e.worn && !e.wornLeft && Number(e.count) > 0;
  const EXTRAS = ['health', 'enchantmentId', 'enchantmentEffects', 'chargePercent', 'soul', 'poisonId', 'poisonCount'];
  const bare = (e) => EXTRAS.every((k) => e[k] === undefined || e[k] === null);
  const sameExtras = (x, y) => EXTRAS.every((k) => JSON.stringify(x[k]) === JSON.stringify(y[k]));
  const entriesOf = (a) => (get(a, 'inventory', { entries: [] }).entries || []).map((e) => Object.assign({}, e));
  const plainCount = (a, id) => entriesOf(a).filter((e) => plain(e, id)).reduce((n, e) => n + Number(e.count), 0);
  // Takes `n` copies from the entries `pick` chooses (in its order) and puts them back as one entry under `name`,
  // joined to a matching named entry. The count actually named
  const renameCopies = (a, n, name, pick) => {
    const entries = entriesOf(a);
    let left = n;
    const taken = [];
    for (const e of pick(entries)) {
      if (!left) break;
      const t = Math.min(left, Number(e.count));
      e.count = Number(e.count) - t; left -= t;
      taken.push(Object.assign({}, e, { count: t, name }));
    }
    const done = n - left;
    if (!done) return 0;
    const out = entries.filter((e) => Number(e.count) > 0);
    for (const t of taken) {
      const same = out.find((e) => (Number(e.baseId) >>> 0) === (Number(t.baseId) >>> 0) && e.name === name && !e.worn && !e.wornLeft && sameExtras(e, t));
      if (same) same.count = Number(same.count) + t.count; else out.push(t);
    }
    try { mp.set(a >>> 0, 'inventory', { entries: out }); } catch (e) { log('capstones: could not write the mark', e.message); return 0; }
    return done;
  };
  // `n` plain copies of id under `name`, bare copies first, so a tempered or enchanted copy already carried keeps its own
  const nameCopies = (a, id, n, name) => renameCopies(a, n, name, (entries) => [
    ...entries.filter((e) => plain(e, id) && bare(e)), ...entries.filter((e) => plain(e, id) && !bare(e))]);
  // Counts the plain copies of id now, before the item is handed over, and names up to `want` of those that arrive.
  // `then(n)` runs once they are named (n 0: none arrived within the retries)
  const markArriving = (a, id, want, name, what, then) => {
    const before = plainCount(a, id);
    let tries = 0;
    const step = () => {
      const made = Math.min(want, plainCount(a, id) - before);
      if (made > 0) {
        const n = nameCopies(a, id, made, name);
        if (n) log(`capstones: ${who(a)} ${what} ${n}x ${descOf(id)} as "${name}"`);
        if (then) then(n);
        return;
      }
      if (++tries < Number(C.markRetries)) setTimeout(step, Number(C.markRetryMs));
      else { log(`capstones: ${who(a)}'s ${what} ${descOf(id)} never reached the pack; left unmarked`); if (then) then(0); }
    };
    setTimeout(step, 0);
  };

  // A name a Grandmaster gives a piece (Tailor's bespoke work, a named enchantment): the prose filter, at most 40
  // characters, letters, digits, spaces and simple marks only (no commas or brackets, so it cannot fake a mark or a tier)
  const givenName = (text) => {
    const s = String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return { error: 'Give it a name.' };
    if (s.length > 40) return { error: 'A name of 40 characters at most.' };
    if (/[,()[\]{}<>#@\\/]/.test(s)) return { error: 'Letters, numbers, spaces and simple marks only.' };
    let bad = null; try { bad = typeof globalThis.__dboProseProblem === 'function' ? globalThis.__dboProseProblem(s) : null; } catch (e) { bad = null; }
    if (bad) return { error: `The word "${bad}" will not do on something others will see.` };
    return { name: s };
  };
  // Armed for the next piece: actorId -> { kind, name?, at }. Kept across a reload; lapses after armMinutes
  const ARMED = globalThis.__dboCapstoneArmed instanceof Map ? globalThis.__dboCapstoneArmed : (globalThis.__dboCapstoneArmed = new Map());
  const armedFor = (a, kind) => {
    const x = ARMED.get(a >>> 0);
    if (!x || x.kind !== kind) return null;
    if (Date.now() - x.at > Number(C.armMinutes) * 60000) { ARMED.delete(a >>> 0); return null; }
    return x;
  };

  // Blacksmith (forge) and Tailor (loom): regions.js, once every check let a craft on and before the engine hands it over
  const MAKERS = [
    { skill: 'blacksmith', verb: 'forged by', what: 'forged', recipe: '__dboSmithIsForge', types: ['WEAP', 'ARMO'] },
    { skill: 'tailor', verb: 'sewn by', what: 'sewed', recipe: '__dboTailorIsLoom', types: ['ARMO'] },
  ];
  globalThis.__dboCapstoneCrafted = (actorId, itemId, count, recipeId) => {
    const a = actorId >>> 0, id = itemId >>> 0;
    const m = MAKERS.find((x) => on(x.skill) && typeof globalThis[x.recipe] === 'function' && globalThis[x.recipe](recipeId >>> 0));
    if (!m || !isGrandmaster(a, m.skill) || !m.types.includes(typeOf(id))) return false;
    return markMade(a, m, id, count);
  };
  // loomweave.js: a garment the server weaves itself, reported before it is handed over
  globalThis.__dboCapstoneWoven = (actorId, itemId, count) => {
    const a = actorId >>> 0, m = MAKERS[1];
    if (!on(m.skill) || !isGrandmaster(a, m.skill) || !m.types.includes(typeOf(itemId >>> 0))) return false;
    return markMade(a, m, itemId >>> 0, count);
  };
  const markMade = (a, m, id, count) => {
    // A Tailor's bespoke name stands in for the garment's own, for the next one only
    const bespoke = m.skill === 'tailor' ? armedFor(a, 'bespoke') : null;
    const name = N.markName(bespoke ? bespoke.name : itemName(descOf(id)), m.verb, realNameOf(a));
    if (!name) return false;
    const want = bespoke ? 1 : Math.max(1, Math.floor(Number(count) || 1));
    markArriving(a, id, want, name, m.what, (n) => {
      if (bespoke && n) { ARMED.delete(a >>> 0); personal(a, `Your bespoke work is done: "${name}".`); }
    });
    return true;
  };
  registerChatCommand('bespoke', (a, args) => {
    if (!on('tailor') || !isGrandmaster(a, 'tailor')) return personal(a, 'Bespoke work is a Grandmaster Tailor\'s.');
    const t = String(args || '').trim();
    if (/^(off|cancel)$/i.test(t)) { ARMED.delete(a >>> 0); return personal(a, 'No bespoke name is waiting.'); }
    const g = givenName(t);
    if (g.error) return personal(a, `${g.error} Usage: /bespoke <the garment's name>, or /bespoke off.`);
    ARMED.set(a >>> 0, { kind: 'bespoke', name: g.name, at: Date.now() });
    return personal(a, `The next garment you make at a loom in the next ${C.armMinutes} minutes will be "${N.markName(g.name, 'sewn by', realNameOf(a))}".`);
  }, { help: 'Grandmaster Tailor: name the next garment you make, for a buyer' });

  // Alchemist, Signature Draught: once a UTC day, the next potion brewed carries the brewer's name. alchemy.js reports a
  // brew before it hands the potion over (__dboCapstoneBrewing)
  globalThis.__dboCapstoneBrewing = (actorId, potionId) => {
    const a = actorId >>> 0, id = potionId >>> 0;
    if (!on('alchemist') || !isGrandmaster(a, 'alchemist') || !armedFor(a, 'signature') || usedToday(a, 'signature')) return false;
    const name = N.markName(itemName(descOf(id)), 'brewed by', realNameOf(a));
    if (!name) return false;
    ARMED.delete(a >>> 0);
    markArriving(a, id, 1, name, 'brewed', (n) => {
      if (n) { markUsed(a, 'signature', 'alchemist'); personal(a, `Your signature draught: "${name}". The next one is yours after midnight UTC.`); }
    });
    return true;
  };
  registerChatCommand('signature', (a) => {
    if (!on('alchemist') || !isGrandmaster(a, 'alchemist')) return personal(a, 'A signature draught is a Grandmaster Alchemist\'s.');
    if (usedToday(a, 'signature')) return personal(a, 'You have brewed today\'s signature draught. The next one is yours after midnight UTC.');
    ARMED.set(a >>> 0, { kind: 'signature', at: Date.now() });
    return personal(a, `The next potion you brew at an alchemy lab in the next ${C.armMinutes} minutes will carry your name.`);
  }, { help: 'Grandmaster Alchemist: your next potion today carries your name' });

  // Enchanter, Named Enchantment: once a week, the next item enchanted carries a name of the enchanter's choosing and
  // their mark. enchanting.js reports an accepted enchantment before craftedExtrasSystem stores it (__dboCapstoneEnchanting);
  // the copy whose enchantment is new then is the one named
  const ENCHANTED = (e) => e && Number(e.count) > 0 && !e.worn && !e.wornLeft && ((Array.isArray(e.enchantmentEffects) && e.enchantmentEffects.length) || e.enchantmentId);
  const keyOfCopy = (e) => `${Number(e.baseId) >>> 0}|${e.name || ''}|${EXTRAS.map((k) => JSON.stringify(e[k] === undefined ? null : e[k])).join('|')}`;
  const enchantedCounts = (a) => { const m = new Map(); for (const e of entriesOf(a)) if (ENCHANTED(e)) m.set(keyOfCopy(e), (m.get(keyOfCopy(e)) || 0) + Number(e.count)); return m; };
  globalThis.__dboCapstoneEnchanting = (actorId) => {
    const a = actorId >>> 0;
    const armed = armedFor(a, 'enchantname');
    if (!on('enchanter') || !armed || !isGrandmaster(a, 'enchanter') || usedWithin(a, 'enchantname', 7)) return false;
    ARMED.delete(a >>> 0);
    const before = enchantedCounts(a);
    let tries = 0;
    const step = () => {
      const now = enchantedCounts(a);
      const key = [...now.keys()].find((k) => now.get(k) > (before.get(k) || 0) && !N.markOf(k.split('|')[1]));
      if (key) {
        const sample = entriesOf(a).find((e) => ENCHANTED(e) && keyOfCopy(e) === key);
        const name = sample && N.markName(armed.name, 'enchanted by', realNameOf(a));
        const n = name ? renameCopies(a, 1, name, (entries) => entries.filter((e) => ENCHANTED(e) && keyOfCopy(e) === key)) : 0;
        if (n) { markUsed(a, 'enchantname', 'enchanter'); log(`capstones: ${who(a)} named an enchanted ${descOf(sample.baseId)} "${name}"`); personal(a, `It is "${name}". Your next named enchantment is a week away.`); }
        return;
      }
      if (++tries < Number(C.markRetries)) setTimeout(step, Number(C.markRetryMs));
      else { log(`capstones: ${who(a)}'s named enchantment never reached the pack; nothing named`); personal(a, 'The enchantment did not take its name. Your named enchantment is still yours to use: /enchantname again.'); }
    };
    setTimeout(step, 0);
    return true;
  };
  registerChatCommand('enchantname', (a, args) => {
    if (!on('enchanter') || !isGrandmaster(a, 'enchanter')) return personal(a, 'A named enchantment is a Grandmaster Enchanter\'s.');
    if (usedWithin(a, 'enchantname', 7)) return personal(a, `You named an enchantment on ${lastUse(a, 'enchantname')}; the next is yours a week after.`);
    const g = givenName(args);
    if (g.error) return personal(a, `${g.error} Usage: /enchantname <the item's name>.`);
    ARMED.set(a >>> 0, { kind: 'enchantname', name: g.name, at: Date.now() });
    return personal(a, `The next item you enchant in the next ${C.armMinutes} minutes will be "${N.markName(g.name, 'enchanted by', realNameOf(a))}".`);
  }, { help: 'Grandmaster Enchanter: name the next item you enchant (once a week)' });

  // ---- Blade, Sword-Master's School ----------------------------------------------------------------------------------
  // A Blade Grandmaster takes up to `blade.apprentices` (2) apprentices: /swordschool take <name>, the student accepts with
  // /swordschool accept. In a duel between the two (duel.js: practice, friendly or wager), a Blade hit the apprentice lands
  // on their master is worth blade.sparRate (1.5) through skillrates.js (__dboCapstoneSkillRate). It multiplies only what
  // the Wheel's meter already let through, so the hourly and daily caps hold: faster practice, never more practice. A
  // master and apprentice may not be one person (one Discord, one profile), as couriers.js rules.
  const SCHOOL = 'private.dboSwordSchool';   // on the master: { apprentices: [{ actor, name, at }] }
  const MASTER = 'private.dboSwordMaster';   // on the apprentice: { actor, name, at }
  const B = Object.assign({ apprentices: 2, sparRate: 1.5, offerMinutes: 5, meters: 10 }, C.blade || {});
  const OFFERS = globalThis.__dboSwordOffers instanceof Map ? globalThis.__dboSwordOffers : (globalThis.__dboSwordOffers = new Map()); // student -> { master, at }
  const schoolOf = (a) => { const s = get(a, SCHOOL, null); return s && Array.isArray(s.apprentices) ? s.apprentices.slice() : []; };
  const masterOf = (a) => { const m = get(a, MASTER, null); return m && m.actor ? m : null; };
  const disc = (a) => { try { return String((typeof discordOf === 'function' && discordOf(a)) || ''); } catch (e) { return ''; } };
  const onePerson = (x, y) => (x >>> 0) === (y >>> 0) || (!!disc(x) && disc(x) === disc(y)) || (profileOf(x) >= 0 && profileOf(x) === profileOf(y));
  const setp = (a, k, v) => { try { mp.set(a >>> 0, k, v); return true; } catch (e) { log('capstones: could not save the school', e.message); return false; } };
  const takeRefusal = (a, t) => {
    if (!on('blade') || !isGrandmaster(a, 'blade')) return 'Taking sword apprentices is a Grandmaster of the Blade\'s.';
    if (!t) return 'Name someone here: /swordschool take <name>.';
    if (onePerson(a, t)) return 'You cannot be your own apprentice.';
    if (!(Number(distanceMeters(a, t)) <= Number(B.meters))) return 'Stand beside them to offer it.';
    if (masterOf(t)) return `${who(t)} already studies the sword under ${masterOf(t).name}.`;
    if (schoolOf(a).length >= Number(B.apprentices)) return `You already teach ${B.apprentices} apprentices. Release one first.`;
    return '';
  };
  registerChatCommand('swordschool', (a, args) => {
    const [verb, ...rest] = String(args || '').trim().split(/\s+/);
    const v = (verb || '').toLowerCase();
    if (v === 'take') {
      const t = findByName(rest.join(' '));
      const why = takeRefusal(a, t);
      if (why) return personal(a, why);
      OFFERS.set(t >>> 0, { master: a >>> 0, at: Date.now() });
      personal(t, `${who(a)}, a Grandmaster of the Blade, offers to take you as a sword apprentice. Type /swordschool accept within ${B.offerMinutes} minutes.`);
      return personal(a, `You offer ${who(t)} a place in your school.`);
    }
    if (v === 'accept') {
      const o = OFFERS.get(a >>> 0);
      OFFERS.delete(a >>> 0);
      if (!o || Date.now() - o.at > Number(B.offerMinutes) * 60000) return personal(a, 'No sword-master has offered you a place.');
      const why = takeRefusal(o.master, a);
      if (why) return personal(a, `The place is gone: ${why}`);
      const list = schoolOf(o.master).concat([{ actor: a >>> 0, name: who(a), at: Date.now() }]);
      if (!setp(o.master, SCHOOL, { apprentices: list }) || !setp(a, MASTER, { actor: o.master >>> 0, name: who(o.master), at: Date.now() })) return personal(a, 'The school could not be written. Try again.');
      audit(`CAPSTONE ${who(o.master)} took ${who(a)} as a blade apprentice`);
      personal(o.master, `${who(a)} is your sword apprentice now.`);
      return personal(a, `You study the sword under ${who(o.master)}. Practise with them in a duel and you learn faster.`);
    }
    if (v === 'release' || v === 'leave') {
      const m = masterOf(a);
      const t = v === 'leave' ? a : findByName(rest.join(' '));
      const master = v === 'leave' ? (m && m.actor) : a;
      const list = master ? schoolOf(master) : [];
      if (!t || !master || !list.some((x) => (x.actor >>> 0) === (t >>> 0))) return personal(a, v === 'leave' ? 'You have no sword-master.' : 'They are not your apprentice.');
      setp(master, SCHOOL, { apprentices: list.filter((x) => (x.actor >>> 0) !== (t >>> 0)) });
      setp(t, MASTER, null);
      audit(`CAPSTONE ${who(master)} released ${who(t)} from blade`);
      return personal(a, v === 'leave' ? 'You leave your sword-master\'s school.' : `${who(t)} is no longer your apprentice.`);
    }
    const mine = schoolOf(a), m = masterOf(a);
    if (mine.length) return personal(a, `Your sword apprentices: ${mine.map((x) => x.name).join(', ')}.`);
    if (m) return personal(a, `You study the sword under ${m.name}. /swordschool leave ends it.`);
    return personal(a, 'Usage: /swordschool take <name> | accept | release <name> | leave.');
  }, { help: 'Grandmaster of the Blade: take sword apprentices, who learn faster sparring with you' });
  // skillrates.js: Blade hits an apprentice lands on their own master in a duel between them
  globalThis.__dboCapstoneSkillRate = (actorId, skillId, kind, detail) => {
    if (skillId !== 'blade' || kind !== 'hit' || !on('blade') || !detail) return 1;
    const a = actorId >>> 0, t = Number(detail.targetId) >>> 0;
    const m = masterOf(a);
    if (!m || (m.actor >>> 0) !== t || !isGrandmaster(t, 'blade') || onePerson(a, t)) return 1;
    try { if (typeof globalThis.__dboDuelPair !== 'function' || !globalThis.__dboDuelPair(a, t)) return 1; } catch (e) { return 1; }
    return Math.max(1, Math.min(2, Number(B.sparRate) || 1));
  };

  // ---- /capstone ------------------------------------------------------------------------------------------------------
  const STATUS = {
    alchemist: (a) => (usedToday(a, 'signature') ? ' Today\'s signature draught is brewed; the next after midnight UTC.' : ' Today\'s is ready: /signature, then brew.'),
    enchanter: (a) => (usedWithin(a, 'enchantname', 7) ? ` Named last on ${lastUse(a, 'enchantname')}; the next a week after.` : ' Ready: /enchantname <name>, then enchant.'),
    tailor: () => ' /bespoke <name> names your next garment.',
    blade: (a) => { const n = schoolOf(a).length; return ` ${n} of ${B.apprentices} apprentices; /swordschool take <name>.`; },
  };
  registerChatCommand('capstone', (a) => {
    if (C.enabled === false) return personal(a, 'Grandmaster rewards are not open just now.');
    const skill = grandmasterOf(a);
    if (!skill) return personal(a, `A skill at ${C.capLevel} brings its Grandmaster reward. None of yours is there yet.`);
    if (!LABELS[skill] || !on(skill)) return personal(a, `Your ${skill} is at ${C.capLevel}. Its Grandmaster reward is still to come.`);
    return personal(a, `Grandmaster: ${LABELS[skill]}${STATUS[skill] ? STATUS[skill](a) : ''}`);
  }, { help: 'your Grandmaster reward, if a skill of yours is at 100' });

  globalThis.__dboCapstones = { isGrandmaster, grandmasterOf, usedToday, usedWithin, markUsed, today, on };
  log(`capstones ${C.enabled === false ? 'off' : 'on'}: ${Object.keys(LABELS).filter(on).join(', ') || 'none'}`);
  return { isGrandmaster, grandmasterOf, usedToday, usedWithin, markUsed, nameCopies, plainCount, givenName };
};
