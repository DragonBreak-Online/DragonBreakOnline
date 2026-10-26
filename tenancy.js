// DragonBreak Online: renting property out (suggestions forum, "Property Signs"). Loaded by gamemode.js.
//
// A hold's Jarl, Steward or other property manager lists an empty house for rent at its door: a deposit and a weekly
// rent. Players register interest there; the official offers it to one of them, who accepts at the door by paying the
// deposit and the first week, and the house is granted to them through housingSystem.ts (__dboHousing), keys and all.
// Rent is paid at the door into the hold's treasury. Once it falls due the tenant and the officials are told; an
// official may give a week's grace, send a reminder, or evict, which takes the house back and keeps the deposit. A
// tenant who leaves in good standing gets the deposit back. "At the door" is the nearest load door within reach.
//
// Or for sale (Nate, 12 Oct): the officials list an empty house at a price; the first player to pay it at the door
// (/property buy) owns it outright, the price goes to the hold's treasury, and it becomes the house's value for the weekly
// property tax (economy.js).
// Citizenship (citizenship.js, Nate 14 Oct): in a hold that grants it, only its citizens buy property, from the hold or from
// another player. An owner may put their own house up for sale at its door (resale); the first eligible citizen to pay the
// price owns it, the gold goes to the seller, and the house's tax value stays what it was (the hold's listed value: a
// resale never changes the tax). Owners from before keep their houses; citizenship is asked only of a new buyer.
//
// State in tenancy.json: { listings: { <primary hex>: { door, zone, deposit, weekly, listedBy, listedAt,
//   interest: [party], offer?: { party, until }, tenant?: party, deposit held in depositHeld, paidUntil, overdueSince? }
//   or, for sale, { door, zone, sale: true, price, listedBy, listedAt }
//   or, for sale by its owner, { door, zone, sale: true, resale: true, price, seller: party, listedBy, listedAt } },
//   owed: [{ tag, gold, why }] }, a party being { profile, char (its actor, from 10 Oct), tag, name }.

const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, tagOf, profileOf, onlineActors, every, registerChatCommand,
    takeGold, giveGold, depositToTreasury, zoneById, cfg } = api;
  // A lease names landlord and tenant by their own name, never a beast's, and a mask's only while rosterPrivacy.masks
  // is off (gamemode.js ownDisplay)
  const ownDisplay = typeof api.ownDisplay === 'function' ? api.ownDisplay : display;
  const openWidget = api.openWidget || (() => false), closeWidget = api.closeWidget || (() => false), onUi = api.onUi || (() => {});

  // gemPer: a building bought from the hold also costs a flawless gem of any kind per gemPer gold of its price, into the hold's
  // gem counter (bank.js __dboGemFee; Nat, 25 Oct: gems pay for big deeds). A house under gemPer needs none, nor a resale
  const C = Object.assign({ reach: 400, maxDeposit: 20000, maxWeekly: 5000, offerHours: 48, maxPrice: 1000000, gemPer: 5000 }, cfg.tenancy || {});
  const gemsFor = (price) => (Number(C.gemPer) > 0 ? Math.floor(price / Number(C.gemPer)) : 0);
  const FILE = path.resolve('tenancy.json');
  const WEEK = 7 * 86400000;
  const S = globalThis.__dboTenancy || (globalThis.__dboTenancy = { data: null, doors: null });

  const data = () => {
    if (S.data) return S.data;
    try { S.data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { S.data = null; }
    if (!S.data || typeof S.data.listings !== 'object') S.data = { listings: {}, owed: [] };
    if (!Array.isArray(S.data.owed)) S.data.owed = [];
    return S.data;
  };
  const save = () => {
    try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(data(), null, 1)); fs.renameSync(FILE + '.tmp', FILE); }
    catch (e) { log('tenancy: saving failed', e.message); }
  };
  const housing = () => globalThis.__dboHousing || null;

  // Load doors and their places from doors-pos.json (tools/door-positions.py), with no engine call: loading all 4049
  // refs through mp.get froze the main thread 3.5 min on the first tenancy action of every process (5-9 Oct).
  // claude-jake's design: the precomputed file first, and a door it lacks resolved a few at a time on timers.
  const SLICE = 2, SLICE_MS = 250;
  const doorList = () => {
    if (S.doors) return S.doors;
    let file = {}, listed = [];
    try { file = JSON.parse(fs.readFileSync(path.resolve('doors-pos.json'), 'utf8')); } catch (e) { log('tenancy: doors-pos.json unreadable', e.message); }
    try { listed = Object.keys(JSON.parse(fs.readFileSync(path.resolve('doors.json'), 'utf8')).doors || {}); } catch (e) { log('tenancy: doors.json unreadable', e.message); }
    const placed = file.doors || {};
    S.doors = [];
    for (const [desc, p] of Object.entries(placed)) {
      if (Array.isArray(p) && p.length >= 4 && p.slice(0, 3).every(Number.isFinite) && typeof p[3] === 'string') S.doors.push({ desc, pos: p.slice(0, 3), where: p[3].toLowerCase(), id: 0 });
    }
    const off = new Set(Array.isArray(file.off) ? file.off : []);
    const pending = listed.filter((d) => !placed[d] && !off.has(d));
    log(`tenancy: ${S.doors.length} load doors placed${pending.length ? `, ${pending.length} more to resolve in the background` : ''}`);
    if (pending.length) resolveLater(pending, S.doors);
    return S.doors;
  };
  // The old synchronous lookup, SLICE doors per timer; a reload that rebuilds the list ends the old run
  const resolveLater = (pending, list) => {
    let added = 0;
    const step = () => {
      if (S.doors !== list) return;
      for (const desc of pending.splice(0, SLICE)) {
        try {
          const id = mp.getIdFromDesc(desc) >>> 0;
          const pos = mp.get(id, 'pos');
          const where = String(mp.get(id, 'worldOrCellDesc') || '').toLowerCase();
          if (Array.isArray(pos) && where) { list.push({ desc, pos, where, id }); added++; }
        } catch (e) { /* not in this load order */ }
      }
      if (pending.length) setTimeout(step, SLICE_MS);
      else log(`tenancy: ${added} more load door(s) placed in the background`);
    };
    setTimeout(step, SLICE_MS);
  };
  // Only the door found is resolved to an id
  const idOf = (d) => {
    if (!d.id) { try { d.id = mp.getIdFromDesc(d.desc) >>> 0; } catch (e) { d.id = 0; } }
    return d.id;
  };
  const doorAt = (a) => {
    let me, here;
    try { me = mp.get(a, 'pos'); here = String(mp.get(a, 'worldOrCellDesc') || '').toLowerCase(); } catch (e) { return 0; }
    let best = null, dist = C.reach;
    for (const d of doorList()) {
      if (d.where !== here) continue;
      const k = Math.hypot(d.pos[0] - me[0], d.pos[1] - me[1], d.pos[2] - me[2]);
      if (k < dist) { dist = k; best = d; }
    }
    return best ? idOf(best) : 0;
  };

  const me = (a) => ({ profile: Number(profileOf(a)), char: a >>> 0, tag: tagOf(a), name: ownDisplay(a) });
  // A claim is one character's once property is per character (housingSystem.ts ownsRecord), else the account's
  // mines.js: a clan's mine or a lair is never listed, sold or bought ('' when it may be)
  const mineRefusal = (door) => { try { return typeof globalThis.__dboMineSaleRefusal === 'function' ? String(globalThis.__dboMineSaleRefusal(door) || '') : ''; } catch (e) { return ''; } };
  const owns = (a, rec) => { try { const H = housing(); if (H && typeof H.ownsRecord === 'function') return H.ownsRecord(rec, a) === true; } catch (e) { /* the account's */ } return Number(rec.owner) === Number(profileOf(a)); };
  const perChar = () => { try { const H = housing(); return !!H && typeof H.perCharacter === 'function' && H.perCharacter() === true; } catch (e) { return false; } };
  const actorOfTag = (tag) => onlineActors().find((x) => tagOf(x) === tag) || 0;
  const hex = (id) => (Number(id) >>> 0).toString(16);
  const pay = (party, gold, why) => {
    if (!(gold > 0)) return;
    const a = actorOfTag(party.tag);
    if (a && giveGold(a, gold)) { personal(a, `${gold} gold: ${why}.`); return; }
    data().owed.push({ tag: party.tag, gold, why });
  };
  const tell = (party, text) => { const a = actorOfTag(party.tag); if (a) personal(a, text); };
  // Who manages a door's renting: a hold's property managers, or the holder of the fief it stands in (nobility.js, Nate
  // 10 Oct), there only. A fief holder's use of it is audited; the rent and deposits still go to the hold's treasury
  const fiefHolderAt = (x, door) => { const H = housing(); try { return !!H && typeof H.isFiefHolder === 'function' && !!H.isFiefHolder(x, door); } catch (e) { return false; } };
  const manages = (x, door) => { try { if (housing().isManager(x, door)) return true; } catch (e) { return false; } return fiefHolderAt(x, door); };
  const managersOnline = (door) => onlineActors().filter((x) => manages(x, door));
  const due = (L) => new Date(L.paidUntil).toISOString().slice(0, 10);

  // The property at the door the actor stands at: { door, key, L (listing or undefined), rec (housing record) }
  const here = (a) => {
    const H = housing();
    if (!H) return { err: 'Property records are not ready yet. Try again in a moment.' };
    const d = doorAt(a);
    if (!d) return { err: 'Stand at the door of the property.' };
    const primary = H.primaryOf(d);
    if (!primary) return { err: 'That door is no property.' };
    // A faction's hall is not the hold's to rent or sell (guilds.js __dboForeignHall; Nate, 21 Oct, Castle Volkihar)
    let hallOf = ''; try { hallOf = typeof globalThis.__dboForeignHall === 'function' ? globalThis.__dboForeignHall([primary, d]) : ''; } catch (e) { hallOf = ''; }
    if (hallOf) return { err: `This is the hall of ${hallOf}. The hold does not rent or sell it.` };
    return { door: primary, key: hex(primary), L: data().listings[hex(primary)], rec: H.recordOf(primary) || { owner: 0 }, manager: (x) => {
      // An official seen as a beast in the hold they stand in (exposure.js) sells and lets nothing there until cleared
      try { if (typeof globalThis.__dboExposureBarred === 'function' && globalThis.__dboExposureBarred(x)) return false; } catch (e) { /* exposure not loaded */ }
      if (H.isManager(x, primary)) return true;
      if (!fiefHolderAt(x, primary)) return false;
      audit(`PROPERTY ${who(x)} acts as the fief holder at ${hex(primary)}`);
      return true;
    } };
  };

  const info = (a) => {
    const h = here(a); if (h.err) return h.err;
    const { L, rec } = h;
    if (!L) return rec.owner ? `This property belongs to ${rec.ownerName || 'someone'}. It is not for rent.` : 'This property stands empty and is not for rent.';
    if (L.resale) return sellerOwns(L, rec) ? `For sale by its owner, ${L.seller.name}: ${L.price} gold. Buy it from the property panel at this door.` : `This property belongs to ${rec.ownerName || 'someone'}.`;
    if (L.sale) return rec.owner ? `This property belongs to ${rec.ownerName || 'someone'}.` : `For sale: ${L.price} gold, paid to ${zoneName(L.zone)}. Say /property buy ${L.price} here to buy it at that price; the first to pay owns it.`;
    if (L.tenant) return `Let to ${L.tenant.name} for ${L.weekly} gold a week, paid until ${due(L)}${L.overdueSince ? ' (rent overdue)' : ''}.`;
    return `For rent: ${L.deposit} gold deposit and ${L.weekly} gold a week. ${L.interest.length} ${L.interest.length === 1 ? 'person has' : 'people have'} asked for it. Say /property interest to put your name down.`;
  };

  const list = (a, deposit, weekly) => {
    const h = here(a); if (h.err) return h.err;
    if (!h.manager(a)) return 'Only the officials who manage property here can rent it out.';
    { const why = mineRefusal(h.door); if (why) return why; }
    if (h.L && h.L.tenant) return `It is let to ${h.L.tenant.name}.`;
    if (h.rec.owner) return `${h.rec.ownerName || 'Someone'} owns it. Take it back from the property menu first.`;
    deposit = Math.floor(Number(deposit)); weekly = Math.floor(Number(weekly));
    if (!(deposit >= 0 && deposit <= C.maxDeposit) || !(weekly >= 1 && weekly <= C.maxWeekly)) return `Usage: /property list <deposit 0-${C.maxDeposit}> <weekly rent 1-${C.maxWeekly}>`;
    const zone = housing().holdOf(h.door) || '';
    const keep = h.L && !h.L.sale ? h.L : { interest: [] };
    data().listings[h.key] = Object.assign(keep, { door: h.door, zone, deposit, weekly, listedBy: me(a), listedAt: Date.now() });
    save();
    audit(`PROPERTY ${who(a)} listed ${h.key} in ${zone} for ${deposit} deposit and ${weekly} a week`);
    return `Listed for rent: ${deposit} gold deposit and ${weekly} gold a week.`;
  };

  const unlist = (a) => {
    const h = here(a); if (h.err) return h.err;
    if (!h.manager(a)) return 'Only the officials who manage property here can do that.';
    if (!h.L) return 'It is not for rent or for sale.';
    if (h.L.tenant) return `It is let to ${h.L.tenant.name}. Evict them first, or let them leave.`;
    delete data().listings[h.key];
    save();
    audit(`PROPERTY ${who(a)} took ${h.key} off the market`);
    return 'Taken off the market.';
  };

  const interest = (a) => {
    const h = here(a); if (h.err) return h.err;
    const L = h.L;
    if (L && L.sale) return `It is for sale, not for rent: /property buy ${L.price} pays the price.`;
    if (!L || L.tenant) return 'That property is not for rent.';
    const p = me(a);
    if (L.interest.some((x) => x.tag === p.tag)) return 'Your name is already down for it.';
    L.interest.push(Object.assign(p, { at: Date.now() }));
    save();
    for (const m of managersOnline(h.door)) personal(m, `${p.name} has asked to rent a property in ${zoneName(L.zone)}. Say /properties to see it.`);
    audit(`PROPERTY ${who(a)} asked to rent ${h.key}`);
    return `Your name is down. The officials will offer it to someone; if it is you, come back and say /property accept.`;
  };
  const zoneName = (id) => { const z = id ? zoneById(id) : null; return z ? z.name : (id || 'this hold'); };
  // A sale's price goes to the hold's treasury (gamemode.js depositToTreasury, bank.js): a hold with none (Dawnstar, the
  // strongholds, a place in no hold) would take the buyer's gold and keep nothing (claude-jake review, 12 Oct)
  const hasTreasury = (id) => { const z = id ? zoneById(id) : null; return !!(z && z.treasury); };
  // citizenship.js: whether a hold asks citizenship of a buyer, and whether this character has it ('' when they may buy)
  const citizenGate = (a, zone) => {
    try {
      if (typeof globalThis.__dboCitizenGates !== 'function' || !globalThis.__dboCitizenGates(zone)) return '';
      if (typeof globalThis.__dboCitizenOf === 'function' && globalThis.__dboCitizenOf(a, zone)) return '';
    } catch (e) { return ''; }
    return `Only the citizens of ${zoneName(zone).replace(/^The /, 'the ')} may buy property there. Become one at a notice board of the hold (Citizenship).`;
  };
  // The fork's housingSystem.ts asks before an owner hands a house over for nothing: the recipient must be able to buy it
  globalThis.__dboPropertyTransferCheck = (ref, recipient) => {
    try {
      const H = housing(); const zone = H ? H.holdOf(ref) || '' : '';
      // A chest or an inner door is no property (Nate, 5 Oct): handing one over asks nothing
      if (!zone || (typeof H.isBuilding === 'function' && H.isBuilding(ref) === false)) return '';
      return citizenGate(Number(recipient) >>> 0, zone).replace(/may buy property there/, 'may own property there');
    }
    catch (e) { return ''; }
  };
  // A resale whose seller no longer owns the house (handed over, taken back) stands no more
  const sellerOwns = (L, rec) => {
    if (!L || !L.resale || !L.seller || !rec || !rec.owner) return false;
    if (Number(rec.owner) !== Number(L.seller.profile)) return false;
    return !(perChar() && Number(rec.ownerChar) && Number(L.seller.char)) || (Number(rec.ownerChar) >>> 0) === (Number(L.seller.char) >>> 0);
  };

  const offer = (a, whom) => {
    const h = here(a); if (h.err) return h.err;
    if (!h.manager(a)) return 'Only the officials who manage property here can offer it.';
    const L = h.L;
    if (L && L.sale) return 'It is for sale: the first to pay the price buys it.';
    if (!L || L.tenant) return 'It is not for rent.';
    const q = String(whom || '').replace(/^#/, '').trim().toLowerCase();
    const p = L.interest.find((x) => x.tag.toLowerCase() === q || x.name.toLowerCase().startsWith(q));
    if (!q || !p) return `Offer it to someone who asked: ${L.interest.map((x) => `${x.name}`).join(', ') || 'nobody has yet'}.`;
    L.offer = { party: p, until: Date.now() + C.offerHours * 3600000 };
    save();
    tell(p, `You are offered a property in ${zoneName(L.zone)}: ${L.deposit} gold deposit and ${L.weekly} a week. Go to its door and say /property accept within ${C.offerHours} hours.`);
    audit(`PROPERTY ${who(a)} offered ${h.key} to ${p.name}`);
    return `Offered to ${p.name} for ${C.offerHours} hours.`;
  };

  const accept = (a) => {
    const h = here(a); if (h.err) return h.err;
    const L = h.L;
    const p = me(a);
    if (L && L.sale) return `It is for sale: /property buy ${L.price} pays the price.`;
    if (!L || !L.offer || L.offer.party.tag !== p.tag || Date.now() > L.offer.until) return 'Nobody has offered you this property.';
    // grant takes a house from whoever holds it, so a listing that outlived a change of owner would seize it
    if (h.rec && h.rec.owner && !owns(a, h.rec)) return 'This property has an owner now, so the offer no longer stands. Ask the officials here.';
    const cost = L.deposit + L.weekly;
    if (!takeGold(a, cost)) return `Moving in takes the ${L.deposit} gold deposit and the first week's ${L.weekly}. You do not have ${cost} gold.`;
    const err = housing().grant(h.door, a);
    if (err) { giveGold(a, cost); return err; }
    depositToTreasury(L.zone, L.weekly, { income: 'rent' });
    L.tenant = p;
    L.depositHeld = L.deposit;
    L.paidUntil = Date.now() + WEEK;
    delete L.overdueSince;
    delete L.offer;
    L.interest = [];
    save();
    tell(L.listedBy, `${p.name} has moved into the property you rented out in ${zoneName(L.zone)}.`);
    audit(`PROPERTY ${who(a)} rented ${h.key} (${L.deposit} deposit held, ${L.weekly} to ${L.zone})`);
    return `It is yours to live in. Rent is ${L.weekly} gold a week, paid at this door with /property pay; paid until ${due(L)}. Cut keys from the door's property menu.`;
  };

  const sell = (a, price) => {
    const h = here(a); if (h.err) return h.err;
    if (!h.manager(a)) return 'Only the officials who manage property here can sell it.';
    { const why = mineRefusal(h.door); if (why) return why; }
    if (h.L && h.L.tenant) return `It is let to ${h.L.tenant.name}.`;
    if (h.rec.owner) return `${h.rec.ownerName || 'Someone'} owns it. Only an empty house can be sold.`;
    price = Math.floor(Number(price));
    if (!(price >= 1 && price <= C.maxPrice)) return `Usage: /property sell <price 1-${C.maxPrice}>`;
    const zone = housing().holdOf(h.door) || '';
    if (!hasTreasury(zone)) return `${zoneName(zone)} keeps no treasury for the price, so its property cannot be sold.`;
    if (h.L && h.L.interest && h.L.interest.length) for (const p of h.L.interest) tell(p, `A property you asked to rent in ${zoneName(zone)} is now for sale instead, at ${price} gold.`);
    data().listings[h.key] = { door: h.door, zone, sale: true, price, listedBy: me(a), listedAt: Date.now() };
    save();
    audit(`PROPERTY ${who(a)} put ${h.key} in ${zone} up for sale at ${price} gold`);
    return `For sale at ${price} gold. The first to pay it at this door (/property buy ${price}) owns it; the gold goes to ${zoneName(zone)}.`;
  };

  // seen: the price the buyer was shown (the panel's last one) or named (/property buy <price>). An official may change the
  // price while a buyer's panel is open; the buyer then pays nothing and is shown the new one (claude-jake review, 12 Oct)
  const buy = (a, seen, viaChat) => {
    const h = here(a); if (h.err) return h.err;
    const L = h.L;
    if (!L || !L.sale) return 'This property is not for sale.';
    { const why = mineRefusal(h.door); if (why) return why; }
    if (L.resale) return buyFrom(a, h, seen, viaChat);
    // An owner since it was listed (a grant from the property menu): the sale no longer stands
    if (h.rec && h.rec.owner) { delete data().listings[h.key]; save(); return 'This property has an owner now, so it is no longer for sale.'; }
    const price = Math.floor(Number(L.price));
    const named = String(seen == null ? '' : seen).trim() === '' ? NaN : Math.floor(Number(seen));
    if (named !== price) {
      return viaChat ? `It costs ${price} gold. Say /property buy ${price} to buy it at that price.`
        : `The price is now ${price} gold. Nothing was paid: buy it again at this price if you still want it.`;
    }
    if (!hasTreasury(L.zone)) return `${zoneName(L.zone)} keeps no treasury for the price, so this property cannot be sold.`;
    const gate = citizenGate(a, L.zone); if (gate) return gate;
    // Without bank.js's gem fee (a load that failed) the sale costs no gems rather than being refused
    const gems = globalThis.__dboGemFee ? gemsFor(price) : 0;
    if (gems) {
      const need = globalThis.__dboGemFee.need(a, gems);
      if (need) return `A property at ${price} gold costs a flawless gem for every ${C.gemPer} gold. ${need}`;
    }
    if (!takeGold(a, price)) return `It costs ${price} gold, and you do not have it.`;
    const err = housing().grant(h.door, a);
    if (err) { giveGold(a, price); return err; }
    // Checked above in the same tick, so the gems are there; a failure is audited for staff and the sale stands
    if (gems && !globalThis.__dboGemFee.take(a, gems, L.zone, `buying ${h.key} from ${L.zone}`)) audit(`PROPERTY ${who(a)} bought ${h.key} but the ${gems} flawless gem(s) owed could not be taken`);
    const paidIn = depositToTreasury(L.zone, price, { income: 'house sales' });
    if (paidIn !== price) { log(`tenancy: the treasury of ${L.zone} took ${paidIn} of a ${price} gold sale (${h.key})`); audit(`PROPERTY the treasury of ${L.zone} took ${paidIn} of the ${price} gold paid for ${h.key}`); }
    const p = me(a);
    try { if (globalThis.__dboEconomySaleValue) globalThis.__dboEconomySaleValue(h.door, price, p.name); } catch (e) { log('tenancy: setting the sale value failed', e.message); }
    delete data().listings[h.key];
    save();
    tell(L.listedBy, `${p.name} has bought the property you put up for sale in ${zoneName(L.zone)}, for ${price} gold.`);
    for (const m of managersOnline(h.door)) if (tagOf(m) !== L.listedBy.tag) personal(m, `${p.name} has bought property ${h.key} in ${zoneName(L.zone)} for ${price} gold.`);
    audit(`PROPERTY ${who(a)} bought ${h.key} for ${price} gold, paid to ${L.zone}`);
    return `It is yours: bought for ${price} gold${gems ? ` and ${gems} flawless gem${gems === 1 ? '' : 's'}` : ''}, paid to ${zoneName(L.zone)}. It pays the hold's property tax each week on that value. Cut keys from the door's property menu.`;
  };

  // ---- resale: an owner sells their own house to another player (Nate, 14 Oct) ----------------------------------------------
  const resell = (a, price) => {
    const h = here(a); if (h.err) return h.err;
    if (!h.rec.owner || !owns(a, h.rec)) return 'Only its owner can put a property up for sale.';
    { const why = mineRefusal(h.door); if (why) return why; }
    if (h.L && h.L.tenant) return 'A rented property stays the hold\'s: it cannot be sold.';
    if (h.L && !h.L.resale) return 'This property is listed by the hold. Ask its officials.';
    price = Math.floor(Number(price));
    if (!(price >= 1 && price <= C.maxPrice)) return `A price is a whole number of gold from 1 to ${C.maxPrice}.`;
    const zone = housing().holdOf(h.door) || '';
    data().listings[h.key] = { door: h.door, zone, sale: true, resale: true, price, seller: me(a), listedBy: me(a), listedAt: Date.now() };
    save();
    audit(`PROPERTY ${who(a)} put their property ${h.key} in ${zone} up for sale at ${price} gold`);
    return `For sale at ${price} gold. The first who may buy property in ${zoneName(zone)} and pays it at this door owns it; the gold comes to you. Its property tax stays as it is.`;
  };
  const unresell = (a) => {
    const h = here(a); if (h.err) return h.err;
    const L = h.L;
    if (!L || !L.resale) return 'It is not for sale by its owner.';
    if (!(owns(a, h.rec) || h.manager(a))) return 'Only its owner can take it off the market.';
    delete data().listings[h.key]; save();
    audit(`PROPERTY ${who(a)} took the resale of ${h.key} off the market`);
    return 'Taken off the market.';
  };
  const buyFrom = (a, h, seen, viaChat) => {
    const L = h.L;
    if (!sellerOwns(L, h.rec)) { delete data().listings[h.key]; save(); return 'Its owner has changed, so it is no longer for sale.'; }
    if (owns(a, h.rec)) return 'It is yours already.';
    const price = Math.floor(Number(L.price));
    const named = String(seen == null ? '' : seen).trim() === '' ? NaN : Math.floor(Number(seen));
    if (named !== price) {
      return viaChat ? `It costs ${price} gold. Say /property buy ${price} to buy it at that price.`
        : `The price is now ${price} gold. Nothing was paid: buy it again at this price if you still want it.`;
    }
    const gate = citizenGate(a, L.zone); if (gate) return gate;
    if (!takeGold(a, price)) return `It costs ${price} gold, and you do not have it.`;
    const err = housing().grant(h.door, a);
    if (err) { giveGold(a, price); return err; }
    pay(L.seller, price, `the sale of your property in ${zoneName(L.zone)} to ${me(a).name}`);
    delete data().listings[h.key];
    save();
    audit(`PROPERTY ${who(a)} bought ${h.key} from ${L.seller.name} for ${price} gold (resale; tax value unchanged)`);
    return `It is yours: bought from ${L.seller.name} for ${price} gold. Its property tax is what it was, on the hold's listed value. Cut keys from the door's property menu.`;
  };

  const payRent = (a, weeks) => {
    const h = here(a); if (h.err) return h.err;
    const L = h.L;
    if (!L || !L.tenant || L.tenant.tag !== tagOf(a)) return 'You do not rent this property.';
    weeks = Math.max(1, Math.min(8, Math.floor(Number(weeks) || 1)));
    const cost = weeks * L.weekly;
    if (!takeGold(a, cost)) return `${weeks} week(s) of rent is ${cost} gold, and you do not have it.`;
    depositToTreasury(L.zone, cost, { income: 'rent' });
    L.paidUntil = Math.max(Date.now(), L.paidUntil) + weeks * WEEK;
    delete L.overdueSince;
    save();
    audit(`PROPERTY ${who(a)} paid ${cost} rent on ${h.key}, until ${due(L)}`);
    return `Paid ${cost} gold. Your rent is paid until ${due(L)}.`;
  };

  // Ends a tenancy: housing taken back; the deposit returned (leave) or kept by the hold (evict). Only from the tenant:
  // a tenant who handed the house on and then left took it back from the new owner, deposit and all (economy review,
  // 2026-09-29). A house that is no longer theirs stays with its owner, and the hold keeps the deposit.
  // fork housingSystem doTransfer asks before a house changes hands: a rented house stays the hold's until the tenancy
  // ends, or a tenant could sell it and keep the price (economy review, 2026-09-29)
  globalThis.__dboTenancyRented = (door) => { try { const L = data().listings[hex(door)]; return !!(L && L.tenant); } catch (e) { return false; } };
  const recOf = (L) => { try { return housing().recordOf(L.door) || {}; } catch (e) { return {}; } };
  const ownerOf = (L) => Number(recOf(L).owner) || 0;
  // The tenant still holds it: their account, and their character once property is per character (a tenancy older than
  // the character field goes by the account)
  const stillTenants = (L) => {
    const rec = recOf(L), owner = Number(rec.owner) || 0;
    if (!owner || !L.tenant || !(Number(L.tenant.profile) >= 0)) return true;
    if (owner !== Number(L.tenant.profile)) return false;
    return !(perChar() && Number(rec.ownerChar) && Number(L.tenant.char)) || (Number(rec.ownerChar) >>> 0) === (Number(L.tenant.char) >>> 0);
  };
  const end = (L, returnDeposit, why) => {
    const owner = ownerOf(L), theirs = stillTenants(L);
    if (theirs) housing().release(L.door);
    else { returnDeposit = false; audit(`PROPERTY ${L.tenant.name} no longer holds rented ${hex(L.door)} (owner profile ${owner}); left with its owner, deposit kept by ${L.zone}`); }
    const dep = L.depositHeld || 0;
    if (returnDeposit) pay(L.tenant, dep, `your deposit back (${why})`);
    else depositToTreasury(L.zone, dep, { income: 'rent' });
    const was = L.tenant;
    delete L.tenant; delete L.depositHeld; delete L.paidUntil; delete L.overdueSince;
    L.interest = [];
    save();
    return was;
  };

  const leave = (a) => {
    const h = here(a); if (h.err) return h.err;
    const L = h.L;
    if (!L || !L.tenant || L.tenant.tag !== tagOf(a)) return 'You do not rent this property.';
    if (L.overdueSince) return `Your rent is overdue. Pay it (/property pay) before you leave, or the hold keeps your deposit.`;
    if (!stillTenants(L)) {
      end(L, false, 'handed on');
      return 'The property is no longer yours to hand back: it went to someone else. The tenancy ends and the hold keeps your deposit.';
    }
    end(L, true, 'you left in good standing');
    audit(`PROPERTY ${who(a)} left ${h.key}; deposit returned`);
    return 'You hand back the keys. The property is for rent again.';
  };

  const evict = (a) => {
    const h = here(a); if (h.err) return h.err;
    if (!h.manager(a)) return 'Only the officials who manage property here can evict.';
    const L = h.L;
    if (!L || !L.tenant) return 'Nobody rents it.';
    if (!L.overdueSince) return `${L.tenant.name}'s rent is paid until ${due(L)}. Only a tenant behind on rent can be evicted.`;
    const was = end(L, false, 'evicted');
    tell(was, `You have been evicted from your rented property in ${zoneName(L.zone)} for unpaid rent. The hold keeps your deposit.`);
    audit(`PROPERTY ${who(a)} evicted ${was.name} from ${h.key}; deposit kept by ${L.zone}`);
    return `${was.name} is evicted and the deposit goes to the hold. The property is for rent again.`;
  };

  const grace = (a) => {
    const h = here(a); if (h.err) return h.err;
    if (!h.manager(a)) return 'Only the officials who manage property here can do that.';
    const L = h.L;
    if (!L || !L.tenant) return 'Nobody rents it.';
    L.paidUntil = Math.max(Date.now(), L.paidUntil) + WEEK;
    delete L.overdueSince;
    save();
    tell(L.tenant, `The officials of ${zoneName(L.zone)} have given you a week's grace on your rent. It is paid until ${due(L)}.`);
    audit(`PROPERTY ${who(a)} gave ${L.tenant.name} a week's grace on ${h.key}`);
    return `${L.tenant.name} has a week's grace, until ${due(L)}.`;
  };

  const remind = (a) => {
    const h = here(a); if (h.err) return h.err;
    if (!h.manager(a)) return 'Only the officials who manage property here can do that.';
    const L = h.L;
    if (!L || !L.tenant) return 'Nobody rents it.';
    const text = `A notice from the officials of ${zoneName(L.zone)}: your rent of ${L.weekly} gold a week ${L.overdueSince ? 'is overdue' : `is paid until ${due(L)}`}. Pay it at the door with /property pay.`;
    const t = actorOfTag(L.tenant.tag);
    if (t) personal(t, text); else L.notice = text;
    save();
    audit(`PROPERTY ${who(a)} reminded ${L.tenant.name} about the rent on ${h.key}`);
    return t ? `${L.tenant.name} is told.` : `${L.tenant.name} is away; they will be told when they return.`;
  };

  const overview = (a) => {
    const all = Object.entries(data().listings).filter(([, L]) => manages(a, L.door));
    if (!all.length) return ['No property you manage is listed for rent or for sale.'];
    return all.map(([k, L]) => L.sale ? `${k}: for sale at ${L.price} gold` : L.tenant
      ? `${k}: let to ${L.tenant.name}, ${L.weekly}/week, paid until ${due(L)}${L.overdueSince ? ', OVERDUE' : ''}`
      : `${k}: for rent (${L.deposit} + ${L.weekly}/week), ${L.interest.length} asked${L.interest.length ? ': ' + L.interest.map((x) => x.name).join(', ') : ''}${L.offer ? `; offered to ${L.offer.party.name}` : ''}`);
  };

  // ---- the property panel (front propertyMarket, widget 82; Nate 12 Oct: "i hate chat commands") ------------------------
  // Opened from the door's property menu (front housing: "For sale and rent"). It always shows the door the player stands
  // at, re-read on every action, so the panel can never act on another property. /property stays for older clients.
  const PANEL_ID = 82;
  const panels = S.panels instanceof Map ? S.panels : (S.panels = new Map()); // actor -> { key, nonce }
  const holdTaxPct = (zone) => { try { return Math.round(Number(globalThis.__dboHoldTax ? globalThis.__dboHoldTax(zone, 0) : 0) * 100); } catch (e) { return 0; } };
  const panelModel = (a, h) => {
    const { L, rec } = h; const p = me(a); const mgr = h.manager(a);
    const zone = (L && L.zone) || (housing().holdOf(h.door) || '');
    const m = {
      name: rec.name || 'This property', hold: zoneName(zone), taxPct: holdTaxPct(zone), owned: !!rec.owner, ownerName: rec.owner ? String(rec.ownerName || 'Someone') : '',
      yours: !!rec.owner && owns(a, rec), canResell: !!rec.owner && owns(a, rec) && !(L && (L.tenant || !L.resale)), manager: mgr, state: 'none', maxPrice: C.maxPrice, maxDeposit: C.maxDeposit, maxWeekly: C.maxWeekly,
    };
    const gate = zone ? citizenGate(a, zone) : '';
    if (gate) m.citizenNeeded = gate;
    try { if (typeof globalThis.__dboEconomyTaxOf === 'function') Object.assign(m, globalThis.__dboEconomyTaxOf(h.door) || {}); } catch (e) { /* no economy */ }
    if (L && L.resale) {
      if (sellerOwns(L, rec)) Object.assign(m, { state: 'resale', price: L.price, sellerName: L.seller.name, yourSale: owns(a, rec) });
    } else if (L && L.sale) Object.assign(m, { state: 'sale', price: L.price });
    else if (L && L.tenant) {
      Object.assign(m, { state: 'let', weekly: L.weekly, paidUntil: due(L), overdue: !!L.overdueSince, youRent: L.tenant.tag === p.tag });
      if (mgr) m.tenantName = L.tenant.name;
    } else if (L) {
      Object.assign(m, { state: 'rent', deposit: L.deposit, weekly: L.weekly, asked: L.interest.length, youAsked: L.interest.some((x) => x.tag === p.tag),
        offeredToYou: !!(L.offer && L.offer.party.tag === p.tag && Date.now() <= L.offer.until) });
      if (mgr) Object.assign(m, { interest: L.interest.map((x) => ({ tag: x.tag, name: x.name })), offeredTo: L.offer ? L.offer.party.name : '' });
    }
    return m;
  };
  const sendPanel = (a, h, text) => {
    let p = panels.get(a >>> 0);
    if (!p || p.key !== h.key) { p = { key: h.key, nonce: `${(a >>> 0).toString(36)}-${Date.now().toString(36)}` }; panels.set(a >>> 0, p); }
    const m = panelModel(a, h);
    // The price this panel shows is the only one its Buy button pays
    p.shown = m.state === 'sale' || m.state === 'resale' ? m.price : null;
    openWidget(a, Object.assign({ type: 'propertyMarket', id: PANEL_ID, nonce: p.nonce, result: text || '' }, m), true);
  };
  const closePanel = (a) => { panels.delete(a >>> 0); closeWidget(a, PANEL_ID); };
  onUi('propertyMarket', (a) => {
    const h = here(a);
    if (h.err) return personal(a, h.err);
    // A mine's door opens the mine's own panel first (mines.js), which comes back here for buying and selling
    try { if (typeof globalThis.__dboMineAtDoor === 'function' && globalThis.__dboMineAtDoor(a, h.door)) return; } catch (e) { log('tenancy: the mine panel failed', e.message); }
    sendPanel(a, h);
  });
  globalThis.__dboTenancyPanel = (a) => { const h = here(a); if (h.err) return personal(a, h.err); sendPanel(a, h); };
  const ACTIONS = {
    buy: (a) => buy(a, (panels.get(a >>> 0) || {}).shown), sell: (a, x) => sell(a, x), list: (a, d, w) => list(a, d, w), unlist: (a) => unlist(a),
    interest: (a) => interest(a), offer: (a, tag) => offer(a, tag), accept: (a) => accept(a), pay: (a, w) => payRent(a, w),
    leave: (a) => leave(a), evict: (a) => evict(a), grace: (a) => grace(a), remind: (a) => remind(a),
    resell: (a, x) => resell(a, x), unresell: (a) => unresell(a),
  };
  onUi('propertyMarketAct', (a, args) => {
    const p = panels.get(a >>> 0);
    if (!p || String((args || [])[0] || '') !== p.nonce) return;
    const h = here(a);
    if (h.err || h.key !== p.key) { closePanel(a); return personal(a, h.err || 'You have walked away from that property.'); }
    const name = String(args[1] || '');
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, name)) return;
    const r = ACTIONS[name](a, ...args.slice(2, 4).map((x) => String(x == null ? '' : x).slice(0, 64)));
    sendPanel(a, here(a), [].concat(r).join(' '));
  });
  onUi('propertyMarketClose', (a) => closePanel(a));
  onUi('close', (a, args, widgetId) => { if (Number(widgetId) === PANEL_ID) panels.delete(a >>> 0); });

  registerChatCommand('property', (a, argStr) => {
    const [verb, ...rest] = String(argStr || '').trim().split(/\s+/);
    let r;
    switch ((verb || '').toLowerCase()) {
      case '': r = info(a); break;
      // the typed half of the native property menu, which hands its name box to the browser
      case 'name': {
        const h = here(a);
        const H = housing();
        if (h.err) r = h.err;
        else if (!rest.length) r = 'Usage: /property name <new name>, at the door';
        else if (!H || typeof H.request !== 'function') r = 'Naming property from chat is not in service yet; use the property menu.';
        else { H.request(a, h.door, 'rename', { name: rest.join(' ') }); r = []; }
        break;
      }
      // "mine" rather than "list": /property list <deposit> <weekly> is the officials' listing action
      case 'mine': r = overview(a); break;
      case 'list': r = list(a, rest[0], rest[1]); break;
      case 'unlist': r = unlist(a); break;
      case 'interest': r = interest(a); break;
      case 'offer': r = offer(a, rest.join(' ')); break;
      case 'accept': r = accept(a); break;
      case 'buy': r = buy(a, rest[0], true); break;
      case 'sell': r = sell(a, rest[0]); break;
      case 'pay': r = payRent(a, rest[0]); break;
      case 'leave': r = leave(a); break;
      case 'evict': r = evict(a); break;
      case 'grace': r = grace(a); break;
      case 'remind': r = remind(a); break;
      default: r = 'Usage: /property [mine|name <new name>|buy <price>|interest|accept|pay [weeks]|leave]; officials: sell <price>|list <deposit> <weekly>|unlist|offer <name>|remind|grace|evict';
    }
    for (const t of [].concat(r)) personal(a, t);
  // kept in the player menu until every player has the property panel (front propertyMarket, widget 82, client 0.3.94+);
  // buy names the price the buyer agrees to pay (claude-jake review, 12 Oct)
  }, { help: 'at a door: buying and renting property (mine, name <new name>, buy <price>, interest, accept, pay, leave; officials sell <price>, list, offer, remind, grace, evict)' });
  registerChatCommand('properties', (a) => { for (const t of overview(a)) personal(a, t); }, { hidden: true, help: 'the property you manage; now /property mine' });

  // Rent falling due, offers running out, notices and money for people who come back online
  every('tenancy', 60000, () => {
    const now = Date.now();
    let dirty = false;
    for (const [k, L] of Object.entries(data().listings)) {
      if (L.offer && now > L.offer.until) { delete L.offer; dirty = true; }
      if (L.tenant && now > L.paidUntil && !L.overdueSince) {
        L.overdueSince = now;
        tell(L.tenant, `Your rent in ${zoneName(L.zone)} is overdue. Pay it at the door with /property pay, or the officials may evict you.`);
        for (const m of (housing() ? managersOnline(L.door) : [])) personal(m, `${L.tenant.name}'s rent on property ${k} in ${zoneName(L.zone)} is overdue. At its door: /property remind, grace or evict.`);
        audit(`PROPERTY ${L.tenant.name}'s rent on ${k} fell overdue`);
        dirty = true;
      }
      if (L.tenant && L.notice) { const t = actorOfTag(L.tenant.tag); if (t) { personal(t, L.notice); delete L.notice; dirty = true; } }
    }
    const owed = data().owed;
    for (let i = owed.length - 1; i >= 0; i--) {
      const a = actorOfTag(owed[i].tag);
      if (a && giveGold(a, owed[i].gold)) { personal(a, `${owed[i].gold} gold waiting for you: ${owed[i].why}.`); owed.splice(i, 1); dirty = true; }
    }
    if (dirty) save();
  });
};
