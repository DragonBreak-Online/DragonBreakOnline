// DragonBreak Online: couriers (Nate, 11 Oct: "people want the ability to be couriers too and make money transporting
// goods ... the item they are transporting acts as a quest item, so they cant sell it, get rid of it, etc. however
// robberies have a chance to take the item in the rob menu which removes that protection. that way bandits can rob
// courier routes"; "There should be an optional insurance fee"). Loaded by gamemode.js after post.js; config "couriers".
//
// A sender posts a job at a notice board (the Courier tab of the pigeon coop window): up to maxStacks kinds of goods, a
// destination, a recipient and the courier's pay. The goods, the pay, a posting fee (feeShare of the pay, at least minFee)
// and, if they insure it, a premium (premiumRate of the value they declare, which is at most the goods' total base value)
// are taken at once. The board holds the goods and the pay; the fee and the premium go to the origin hold's treasury.
// Destinations, three kinds:
//   board   another place's notice boards: a hold's boards (zones with a treasury), or a named group of boards (places).
//           Under the region lock only places in lockZones count, and Bruma has one board, so none today.
//   drop    a settlement's drop point (dropPoints: a door everyone can find, within dropRadius); the courier is asked to
//           hand it in when they stand there, and the goods go to the recipient's mailbox.
//   person  the recipient in person: X on them (within handoverDistance, both in the world), and the recipient takes the
//           goods into their pack or has them sent to their mailbox (a small panel; no panel or no answer: the mailbox).
// A courier (never of the sender's account) takes an open job at its origin board and is given ONE parcel (parcelItem,
// a MISC; one copy per job). The goods stay here. While a courier carries jobs, that many copies of the parcel cannot be
// dropped, put in a container, traded, robbed by the item take or picked from their pockets (itemguards.js, gamemode.js
// __dboTradeItemVeto, robbery.js, pickpocket.js ask __dboCourierMove / __dboCourierSealed). Delivery pays the courier.
// limitGameDays game days (the world clock) after the take the job lapses: the parcel is taken back and the goods and the
// pay go back to the sender.
// A robbery (robbery.js rob, prompt or downed) takes one carried parcel at robChance. The robber then holds a broken
// parcel (brokenItem, the same base unless the PC adds one): unprotected, and opened at any notice board for the goods.
// The sender is told; an insured parcel pays the declared value from the origin hold's treasury (as much as it holds),
// unless the robber shares an account or Discord with the sender or the courier, or a party or a faction with either,
// and at most maxPayoutsPerWeek a week per sender account. A broken parcel unopened after brokenDays goes back to the
// sender (lost instead if the insurance paid). Death or the down state leaves the parcel with the courier.
//
// Moving gold or goods: the state is written before anything is handed over, as in post.js.
//   Browser -> server (the coop window's nonce first):
//     dbo:courierPost [nonce, destKey, recipientId, pay, insured, itemsJson]   destKey 'board:<id>' | 'drop:<id>' | 'person'
//     dbo:courierTake | courierDeliver | courierOpen | courierCancel [nonce, jobId]
//     dbo:courierDropIn [nonce, jobId]  dbo:courierDismiss [nonce]  dbo:courierAnswer [nonce, 'take' | 'mailbox']   (widget 81,
//     front features/courierHandover; shown only to a UI that says 'courierHandover' in dbo:uiCaps, else chat)
// State in couriers.json: { next, jobs: [job], payouts: { <account>: [at] } }.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, nameOf, tagOf, profileOf, discordOf, onlineActors, every, cfg, onUi, takeGold, giveItem,
    goldOf, GOLD_BASE, recordOf, depositToTreasury, zoneById, zoneList, boardZoneNear, metOf, isAdmin, registerChatCommand,
    openWidget, closeWidget } = api;
  const C = Object.assign({
    enabled: false,
    // Klimmek's Supplies (Skyrim.esm FFI04Sack, MiscPouch.nif, value 0, weight 0) until the PC adds a dedicated record
    parcelItem: 'dab04:Skyrim.esm', brokenItem: '',
    maxStacks: 6, minPay: 1, maxPay: 50000, feeShare: 0.1, minFee: 10,
    premiumRate: 0.1, maxPayoutsPerWeek: 2,
    // The parcel's names in the pack (an inventory name extra, as the housing keys carry), so the base can be anything
    parcelName: 'Sealed Courier\'s Parcel', brokenName: 'Broken Courier\'s Parcel',
    maxOpen: 3, maxCarried: 3, openDays: 7, brokenDays: 7, keepClosedDays: 7,
    // The time to deliver, in game days of the world clock (worldclock.js; timeScale 6 = a game day every 4 real hours).
    // Without the clock: fallbackHoursPerGameDay real hours a game day
    limitGameDays: 3, fallbackHoursPerGameDay: 4,
    robChance: 0.5,
    handoverDistance: 300, handoverSeconds: 30, dropRadius: 500, dropAskSeconds: 60, dropSnoozeSeconds: 600,
    // Board places: zones with a treasury, plus named board groups { id, name, zone, boards: [ref desc] }
    places: [], boardZones: null, lockZones: ['bruma'],
    dropPoints: [],
  }, cfg.couriers || {});
  const FILE = path.resolve('couriers.json');
  const SPOTS = path.resolve('notice-board-spots.json');
  const DAY = 86400000;
  const WIDGET_ID = 81;
  const S = globalThis.__dboCouriers || (globalThis.__dboCouriers = {});
  for (const k of ['hand', 'dropAsked', 'caps', 'nonces']) if (!(S[k] instanceof Map)) S[k] = new Map();
  S.data = null;
  S.broken = false;

  const int = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : NaN; };
  const P = () => globalThis.__dboPostApi || null;
  const get = (a, k, d) => { try { const v = mp.get(a, k); return v === undefined || v === null ? d : v; } catch (e) { return d; } };
  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };
  const gone = (id) => { try { return typeof globalThis.__dboFormGone === 'function' && !!globalThis.__dboFormGone(Number(id) >>> 0); } catch (e) { return false; } };
  const online = (a) => onlineActors().includes(a >>> 0);
  const discord = (a) => { try { return String((typeof discordOf === 'function' && discordOf(a)) || ''); } catch (e) { return ''; } };
  const accountKey = (j) => (j.senderAccount ? `d:${j.senderAccount}` : `p:${j.senderProfile}`);
  // Same person behind two characters: one character, one Discord, or one profile
  const sameAccount = (a, actor, disc, prof) => (a >>> 0) === (actor >>> 0) || (!!disc && disc === discord(a)) || (prof >= 0 && prof === profileOf(a));
  const sameParty = (a, b) => { try { const of = globalThis.__dboPartyLeaderOf; if (typeof of !== 'function') return false; const x = of(a); return x !== null && x !== undefined && x === of(b); } catch (e) { return false; } };
  const guildIds = (a) => { try { return typeof globalThis.__dboGuildsOf === 'function' ? (globalThis.__dboGuildsOf(a) || []).map((g) => String(g.id)) : []; } catch (e) { return []; } };
  const sameFaction = (a, b) => { const x = new Set(guildIds(a)); return guildIds(b).some((g) => x.has(g)); };
  const posOf = (a) => { try { return { where: String(mp.get(a, 'worldOrCellDesc') || '').toLowerCase(), pos: mp.get(a, 'pos') }; } catch (e) { return null; } };
  const distance = (p, where, pos) => (p && Array.isArray(p.pos) && p.where === String(where).toLowerCase() ? Math.hypot(p.pos[0] - pos[0], p.pos[1] - pos[1], p.pos[2] - pos[2]) : Infinity);
  const near = (a, b, reach) => { const p = posOf(a), q = posOf(b); return !!(p && q && q.pos) && distance(p, q.where, q.pos) <= reach; };
  const entriesOf = (a) => { const inv = get(a, 'inventory', null); return Array.isArray(inv && inv.entries) ? inv.entries.map((e) => Object.assign({}, e)) : []; };
  const owned = (a, id) => entriesOf(a).reduce((n, e) => n + ((Number(e.baseId) >>> 0) === (id >>> 0) ? Number(e.count) || 0 : 0), 0);
  // One copy of base id out of a's pack (one with that name first, then a plain stack); false if they hold none
  const takeOne = (a, id, name) => {
    const entries = entriesOf(a);
    const mine = entries.filter((e) => (Number(e.baseId) >>> 0) === (id >>> 0) && (Number(e.count) || 0) > 0);
    if (!mine.length) return false;
    const e = (name && mine.find((x) => x.name === name)) || mine.find((x) => Object.keys(x).every((k) => k === 'baseId' || k === 'count' || !x[k])) || mine[0];
    e.count = Number(e.count) - 1;
    mp.set(a, 'inventory', { entries: entries.filter((x) => (Number(x.count) || 0) > 0) });
    return true;
  };
  const itemsText = (list) => { try { return P().itemsText(list); } catch (e) { return `${(list || []).length} kinds of goods`; } };
  // The world clock's game days, or null without it (worldclock.js loads after this file; asked each time)
  const clockDays = () => { try { const c = globalThis.__dboClock; const d = c && typeof c.gameDays === 'function' ? Number(c.gameDays()) : NaN; return Number.isFinite(d) ? d : null; } catch (e) { return null; } };
  const clockScale = () => { try { const c = globalThis.__dboClock; const s = c && typeof c.summary === 'function' ? Number(c.summary().timeScale) : NaN; return s > 0 ? s : null; } catch (e) { return null; } };
  const limitDays = () => Math.max(0.01, Number(C.limitGameDays) || 3);
  const fallbackMs = () => limitDays() * Math.max(0.01, Number(C.fallbackHoursPerGameDay) || 4) * 3600000;
  // A carried job is due by the clock when the job was taken by it (dueDay), else by real time (dueAt)
  const isDue = (j) => { const d = clockDays(); return Number.isFinite(j.dueDay) && d !== null ? d >= j.dueDay : j.dueAt <= Date.now(); };
  // Real hours and game hours left on a carried job
  const dueLeft = (j) => {
    const d = clockDays();
    if (Number.isFinite(j.dueDay) && d !== null) { const g = Math.max(0, (j.dueDay - d) * 24); return { gameHours: Math.ceil(g), hours: Math.ceil(g / (clockScale() || 6)) }; }
    const h = Math.max(0, (j.dueAt - Date.now()) / 3600000);
    return { gameHours: Math.ceil(h * 24 / Math.max(0.01, Number(C.fallbackHoursPerGameDay) || 4)), hours: Math.ceil(h) };
  };
  const limitText = () => { const n = limitDays(); return `${n} ${n === 1 ? 'day' : 'days'}`; };

  // ---- the parcel ---------------------------------------------------------------------------------------------------
  const PARCEL = idOf(C.parcelItem);
  const BROKEN = idOf(C.brokenItem || C.parcelItem) || PARCEL;
  if (!PARCEL) log(`couriers: the parcel item ${C.parcelItem} is not in the load order; couriers are off`);
  const ready = () => !!C.enabled && !!PARCEL && !S.broken && !!P();
  const SEALED_NAME = String(C.parcelName || '').slice(0, 64);
  const BROKEN_NAME = String(C.brokenName || '').slice(0, 64);
  // One named copy into a's pack (its own entry, so the name stays); false when it could not be written
  const giveNamed = (a, id, name) => {
    try { if (name) P().giveEntries(a, [{ baseId: id, count: 1, name }]); else if (giveItem(a, id, 1) === false) return false; return true; }
    catch (e) { log(`couriers: a parcel for ${who(a)} failed: ${e.message}`); return false; }
  };

  // A base value in gold, as the record keeps it (item-value-layout.json, ck-mcp/itemvalues.py: DATA at 0 for most
  // types, AMMO DATA 12, BOOK DATA 8, ALCH ENIT 0). A type it does not know counts 0, which only lowers what can be insured.
  const VALUE_AT = { WEAP: ['DATA', 0], ARMO: ['DATA', 0], MISC: ['DATA', 0], INGR: ['DATA', 0], SLGM: ['DATA', 0], SCRL: ['DATA', 0], AMMO: ['DATA', 12], BOOK: ['DATA', 8], ALCH: ['ENIT', 0] };
  const valueCache = new Map();
  const baseValue = (id) => {
    id >>>= 0;
    if (valueCache.has(id)) return valueCache.get(id);
    let v = 0;
    try {
      const r = recordOf(id);
      const at = r && r.record && VALUE_AT[String(r.record.type)];
      const f = at && (r.record.fields || []).find((x) => x.type === at[0] && x.data instanceof Uint8Array && x.data.byteLength >= at[1] + 4);
      if (f) v = Math.max(0, new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getInt32(at[1], true));
    } catch (e) { v = 0; }
    valueCache.set(id, v);
    return v;
  };
  const goodsValue = (items) => (items || []).reduce((n, t) => n + baseValue(Number(t.baseId) >>> 0) * (Number(t.count) || 0), 0);

  // ---- state --------------------------------------------------------------------------------------------------------
  const data = () => {
    if (S.data) return S.data;
    try { S.data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {
      // Only a missing file starts empty; an unreadable one is never overwritten, or every job's goods would be lost
      if (e.code !== 'ENOENT') { S.broken = true; log(`couriers: couriers.json unreadable (${e.message}); couriers are off until it is fixed`); }
      S.data = null;
    }
    if (!S.data || typeof S.data !== 'object') S.data = {};
    if (!Array.isArray(S.data.jobs)) S.data.jobs = [];
    if (!S.data.payouts || typeof S.data.payouts !== 'object') S.data.payouts = {};
    if (!(int(S.data.next) >= 1)) S.data.next = 1 + S.data.jobs.reduce((m, j) => Math.max(m, int(j.id) || 0), 0);
    return S.data;
  };
  const save = () => { if (S.broken) throw new Error('couriers.json is unreadable'); fs.writeFileSync(FILE + '.tmp', JSON.stringify(data(), null, 1)); fs.renameSync(FILE + '.tmp', FILE); };
  // Change a job, write it, and put it back as it was if the write fails
  const commit = (j, change) => {
    const was = JSON.parse(JSON.stringify(j));
    Object.assign(j, change);
    try { save(); } catch (e) { for (const k of Object.keys(j)) delete j[k]; Object.assign(j, was); throw e; }
  };
  const byId = (id) => data().jobs.find((j) => j.id === int(String(id).replace(/^#/, '')));
  const carriedBy = (a) => data().jobs.filter((j) => j.state === 'carried' && j.courier === (a >>> 0));
  const sealedCount = (a) => carriedBy(a).length;

  // ---- places -------------------------------------------------------------------------------------------------------
  const locked = () => !!(cfg.playtest && cfg.playtest.enabled !== false);
  const allowedWorlds = () => new Set(((cfg.playtest && cfg.playtest.allowedWorlds) || []).map((w) => String(w).toLowerCase()));
  let spots = null;
  const spotList = () => {
    if (spots) return spots;
    try { spots = (JSON.parse(fs.readFileSync(SPOTS, 'utf8')).spots || []).map((s) => ({ ref: String(s.ref).toLowerCase(), where: String(s.where).toLowerCase(), pos: s.pos })); }
    catch (e) { spots = []; }
    return spots;
  };
  const named = (Array.isArray(C.places) ? C.places : []).filter((p) => p && p.id && Array.isArray(p.boards))
    .map((p) => ({ id: String(p.id), name: String(p.name || p.id), zone: String(p.zone || ''), boards: p.boards.map((b) => String(b).toLowerCase()) }));
  const boardPlaces = () => {
    const zones = Array.isArray(C.boardZones) ? C.boardZones.map(String) : (typeof zoneList === 'function' ? zoneList() : []).filter((z) => z && z.treasury).map((z) => z.id);
    const out = named.slice();
    for (const id of zones) {
      if (out.some((p) => p.id === id || p.zone === id)) continue;
      const z = zoneById(id); if (z) out.push({ id: z.id, name: z.name, zone: z.id, boards: null });
    }
    return out;
  };
  // The place of the board a is standing at, or null
  const placeOf = (a) => {
    const zid = boardZoneNear(a);
    if (!zid) return null;
    if (named.length) {
      const p = posOf(a);
      let best = null, bestD = Infinity;
      for (const s of spotList()) { const d = distance(p, s.where, s.pos); if (d < bestD) { bestD = d; best = s; } }
      const hit = best && named.find((n) => n.boards.includes(best.ref));
      if (hit) return { id: hit.id, name: hit.name, zone: hit.zone || zid };
    }
    const z = zoneById(zid);
    return { id: zid, name: z ? z.name : zid, zone: zid };
  };
  const drops = (Array.isArray(C.dropPoints) ? C.dropPoints : []).filter((d) => d && d.id && d.world && Array.isArray(d.pos) && d.pos.length >= 3)
    .map((d) => ({ id: String(d.id), name: String(d.name || d.id), hint: String(d.hint || ''), world: String(d.world).toLowerCase(), pos: d.pos.map(Number), zone: String(d.zone || ''), radius: Number(d.radius) || C.dropRadius }));
  const dropById = (id) => drops.find((d) => d.id === String(id)) || null;
  const reachable = (dest) => {
    if (!locked()) return true;
    if (dest.kind === 'person') return true;
    if (dest.kind === 'drop') return allowedWorlds().has(dest.drop.world);
    return (C.lockZones || []).includes(dest.place.zone || dest.place.id);
  };
  // Where a job from this place may go
  const destinations = (origin) => {
    const out = [];
    for (const p of boardPlaces()) if (!origin || p.id !== origin.id) out.push({ key: `board:${p.id}`, kind: 'board', name: `${p.name} notice boards`, place: p });
    for (const d of drops) out.push({ key: `drop:${d.id}`, kind: 'drop', name: d.name, hint: d.hint, drop: d });
    out.push({ key: 'person', kind: 'person', name: 'The recipient, in person' });
    return out.filter(reachable);
  };
  const destText = (j) => (j.kind === 'person' ? `${j.recipientName} in person` : j.kind === 'drop' ? j.destName : `the ${j.destName} notice boards`);

  // ---- letters ------------------------------------------------------------------------------------------------------
  const letter = (to, from, text, parcel) => {
    if (!to || gone(to)) { log(`couriers: no one to write to (${from}: ${text})`); return false; }
    try { P().boardLetter(to, from, text, parcel); return true; } catch (e) { log(`couriers: a letter to ${who(to)} failed: ${e.message}`); return false; }
  };
  // The goods and whatever is held of the pay back to the sender's mailbox
  const backToSender = (j, state, why) => {
    const items = j.items; const gold = Math.max(0, int(j.held) || 0);
    commit(j, { state, held: 0, closedAt: Date.now(), items: [] });
    if (!letter(j.sender, j.originName, `Your courier parcel for ${destText(j)} ${why}. The goods${gold ? ` and the ${gold} gold pay` : ''} come back to you.`, { gold, items }))
      audit(`COURIER #${j.id} of ${j.senderName} #${j.senderTag}: the sender is gone, ${itemsText(items)} and ${gold} gold are lost`);
    audit(`COURIER #${j.id} ${state}: ${itemsText(items)}${gold ? ` and ${gold} gold` : ''} back to ${j.senderName} #${j.senderTag} (${why})`);
  };
  const takeBackParcel = (j) => {
    if (!j.courier) return;
    let done = false;
    try { done = takeOne(j.courier, PARCEL, SEALED_NAME); } catch (e) { done = false; }
    if (!done) { j.copyOwed = true; log(`couriers: the parcel of #${j.id} could not be taken back from ${who(j.courier)} yet`); }
  };

  // ---- posting ------------------------------------------------------------------------------------------------------
  const feeFor = (pay) => Math.max(int(C.minFee) || 0, Math.ceil(pay * Math.max(0, Number(C.feeShare) || 0)));
  const premiumFor = (insured) => (insured > 0 ? Math.ceil(insured * Math.max(0, Number(C.premiumRate) || 0)) : 0);
  const parseItems = (raw) => {
    let list = raw;
    if (typeof list === 'string') { try { list = list ? JSON.parse(list) : []; } catch (e) { return null; } }
    if (!Array.isArray(list)) return null;
    const want = new Map();
    for (const p of list) {
      const id = Number(Array.isArray(p) ? p[0] : p && p.baseId) >>> 0; const n = int(Array.isArray(p) ? p[1] : p && p.count);
      if (!id || !(n > 0) || n > 100000) return null;
      want.set(id, (want.get(id) || 0) + n);
    }
    return want;
  };
  const openOf = (a) => data().jobs.filter((j) => (j.state === 'open' || j.state === 'carried') && sameAccount(a, j.sender, j.senderAccount, j.senderProfile));

  const post = (a, origin, destKey, recipientRaw, payRaw, insuredRaw, itemsRaw) => {
    if (!ready()) return { ok: false, text: 'No courier takes work here yet.' };
    const dest = destinations(origin).find((d) => d.key === String(destKey));
    if (!dest) return { ok: false, text: 'Choose where the parcel goes.' };
    let to = Number(recipientRaw) >>> 0;
    if (!to) to = a >>> 0;
    if (to !== (a >>> 0) && !isAdmin(a) && !metOf(a).includes(to)) return { ok: false, text: 'Send it to yourself or to someone you have met.' };
    if (gone(to)) return { ok: false, text: 'There is no one there to receive it.' };
    if (dest.kind === 'person' && to === (a >>> 0)) return { ok: false, text: 'A parcel in person goes to someone else. Choose who receives it.' };
    const want = parseItems(itemsRaw);
    if (!want || !want.size) return { ok: false, text: 'Choose the goods to send.' };
    if (want.size > C.maxStacks) return { ok: false, text: `A parcel holds at most ${C.maxStacks} kinds of goods.` };
    for (const [id, n] of want) {
      if (id === PARCEL || id === BROKEN || !P().sendableBase(id)) return { ok: false, text: `${P().nameOfItem(id)} cannot go by courier.` };
      if (P().looseCount(a, id) < n) return { ok: false, text: `You do not carry ${n} ${P().nameOfItem(id)} that you are not wearing.` };
    }
    const pay = int(payRaw);
    if (!(pay >= C.minPay && pay <= C.maxPay)) return { ok: false, text: `Offer the courier between ${C.minPay} and ${C.maxPay} gold.` };
    const value = [...want].reduce((s, [id, n]) => s + baseValue(id) * n, 0);
    const insured = insuredRaw === undefined || insuredRaw === null || insuredRaw === '' ? 0 : int(insuredRaw);
    if (!(insured >= 0)) return { ok: false, text: 'The insured value could not be read.' };
    if (insured > value) return { ok: false, text: `The goods are worth ${value} gold at most; insure them for no more than that.` };
    if (openOf(a).length >= C.maxOpen) return { ok: false, text: `You already have ${C.maxOpen} parcels on the road or on the board.` };
    const fee = feeFor(pay), premium = premiumFor(insured);
    if (!takeGold(a, pay + fee + premium)) return { ok: false, text: `The job needs ${pay} gold for the courier, ${fee} to post${premium ? ` and ${premium} for the insurance` : ''}: ${pay + fee + premium}. You carry ${goldOf(a)}.` };
    const items = P().takeParcel(a, { items: [...want] });
    if (!items) { giveItem(a, GOLD_BASE, pay + fee + premium); return { ok: false, text: 'The goods are no longer in your pack. Your gold is returned.' }; }
    const now = Date.now();
    const j = { id: data().next++, state: 'open', kind: dest.kind, origin: origin.id, originName: origin.name, originZone: origin.zone,
      dest: dest.kind === 'board' ? dest.place.id : dest.kind === 'drop' ? dest.drop.id : null, destName: dest.kind === 'board' ? dest.place.name : dest.kind === 'drop' ? dest.drop.name : '',
      sender: a >>> 0, senderName: nameOf(a), senderTag: tagOf(a), senderProfile: profileOf(a), senderAccount: discord(a),
      recipient: to, recipientName: nameOf(to), recipientTag: tagOf(to),
      items, value, pay, held: pay, fee, insured, premium, postedAt: now, expiresAt: now + C.openDays * DAY };
    data().jobs.push(j);
    try { save(); } catch (e) {
      data().jobs.pop(); data().next--;
      try { P().giveEntries(a, items); } catch (x) { log('couriers: goods could not be put back', x.message); }
      giveItem(a, GOLD_BASE, pay + fee + premium);
      return { ok: false, text: 'The board could not take the job just now. Your goods and gold are returned.' };
    }
    const paid = depositToTreasury(origin.zone, fee + premium);
    audit(`COURIER ${who(a)} posted #${j.id} at ${origin.name} for ${destText(j)}: ${itemsText(items)} (worth ${value}), pay ${pay}, fee ${fee}${insured ? `, insured for ${insured} (premium ${premium})` : ''}, ${paid ? 'to the treasury' : 'no treasury'}`);
    return { ok: true, text: `Posted: a courier is wanted to carry ${itemsText(items)} to ${destText(j)} for ${pay} gold. ${fee + premium} gold went to ${origin.name}${premium ? ' for the notice and the insurance' : ' for the notice'}.` };
  };

  const take = (a, origin, jobId) => {
    if (!ready()) return { ok: false, text: 'No courier takes work here yet.' };
    const j = byId(jobId);
    if (!j || j.state !== 'open' || j.expiresAt <= Date.now()) return { ok: false, text: 'That job is no longer on the board.' };
    if (j.origin !== origin.id) return { ok: false, text: `That parcel waits at ${j.originName}. Take it there.` };
    if (sameAccount(a, j.sender, j.senderAccount, j.senderProfile)) return { ok: false, text: 'You cannot carry your own parcel.' };
    if (carriedBy(a).length >= C.maxCarried) return { ok: false, text: `You already carry ${C.maxCarried} parcels. Deliver one first.` };
    if (gone(j.sender)) { backToSender(j, 'cancelled', 'was taken down'); return { ok: false, text: 'Whoever posted that job is gone. The notice comes down.' }; }
    const now = Date.now();
    const day = clockDays();
    try { commit(j, { state: 'carried', courier: a >>> 0, courierName: nameOf(a), courierTag: tagOf(a), courierProfile: profileOf(a), courierAccount: discord(a), takenAt: now,
      dueDay: day !== null ? day + limitDays() : null, dueAt: now + fallbackMs() }); }
    catch (e) { return { ok: false, text: 'The board could not hand it over just now.' }; }
    if (!giveNamed(a, PARCEL, SEALED_NAME)) {
      try { commit(j, { state: 'open', courier: 0, takenAt: 0, dueAt: 0, dueDay: null }); } catch (e) { log('couriers: a failed take could not be undone', e.message); }
      return { ok: false, text: 'The parcel could not be handed over just now.' };
    }
    audit(`COURIER ${who(a)} took #${j.id} of ${j.senderName} #${j.senderTag} at ${j.originName} for ${destText(j)} (pay ${j.pay}${j.insured ? `, insured ${j.insured}` : ''})`);
    return { ok: true, text: `You take a sealed parcel for ${destText(j)}. Deliver it within ${limitText()} for ${j.pay} gold. It stays with you until then.` };
  };

  // The parcel reaches the recipient: the courier gives up its copy, the goods go to the pack (inPack) or the mailbox
  // where: the board the letters come from (a place name: "The <where> notice board"); how: for the audit
  const complete = (j, inPack, where, how) => {
    const a = j.courier;
    if (owned(a, PARCEL) < 1) return { ok: false, text: 'You do not have the parcel with you.' };
    const items = j.items; const pay = Math.max(0, int(j.held) || 0);
    const to = gone(j.recipient) ? j.sender : j.recipient;
    try { commit(j, { state: 'delivered', held: 0, items: [], deliveredAt: Date.now(), closedAt: Date.now(), deliveredWhere: where, inPack: !!inPack }); }
    catch (e) { return { ok: false, text: 'The parcel could not be handed in just now.' }; }
    try { takeOne(a, PARCEL, SEALED_NAME); } catch (e) { log(`couriers: the delivered parcel of #${j.id} stayed with ${who(a)}: ${e.message}`); }
    let packed = false;
    if (inPack && to === j.recipient && online(to)) { try { P().giveEntries(to, items); packed = true; } catch (e) { log(`couriers: #${j.id} into the pack failed, to the mailbox: ${e.message}`); } }
    if (!packed) letter(to, where, `${j.courierName} delivered a parcel from ${j.senderName}${to === j.sender ? ' (it comes back to you: the recipient is gone)' : ''}.`, { gold: 0, items });
    if (pay > 0) giveItem(a, GOLD_BASE, pay);
    if (to !== j.sender) letter(j.sender, where, `Your parcel for ${j.recipientName} was delivered by ${j.courierName}.`, undefined);
    audit(`COURIER ${who(a)} delivered #${j.id} to ${j.recipientName} #${j.recipientTag} ${how || `at ${where}`} (${packed ? 'into the pack' : 'to the mailbox'}): ${itemsText(items)}, paid ${pay}`);
    return { ok: true, text: `You hand over the parcel and are paid ${pay} gold.` };
  };
  const deliver = (a, place, jobId) => {
    const j = byId(jobId);
    if (!j || j.state !== 'carried' || j.courier !== (a >>> 0)) return { ok: false, text: 'You carry no such parcel.' };
    if (j.kind === 'person') return { ok: false, text: `This parcel goes to ${j.recipientName} in person. Find them and offer it (X on them).` };
    if (j.kind === 'drop') return { ok: false, text: `This parcel is handed in at ${j.destName}.` };
    if (j.dest !== place.id) return { ok: false, text: `This parcel goes to the ${j.destName} notice boards.` };
    return complete(j, false, place.name, `at the ${place.name} notice boards`);
  };
  const dropIn = (a, jobId) => {
    const j = byId(jobId);
    if (!j || j.state !== 'carried' || j.courier !== (a >>> 0) || j.kind !== 'drop') return { ok: false, text: 'You carry no such parcel.' };
    const d = dropById(j.dest);
    if (!d) return { ok: false, text: 'That drop point is gone. The parcel goes back when its time runs out.' };
    if (distance(posOf(a), d.world, d.pos) > d.radius) return { ok: false, text: `Hand it in at ${d.name}${d.hint ? `, ${d.hint}` : ''}.` };
    const zone = d.zone ? zoneById(d.zone) : null;
    return complete(j, false, zone ? zone.name : j.originName, `at the ${d.name} drop point`);
  };
  // A broken parcel the robber holds, opened at a board: one copy of it for the goods
  const openBroken = (a, jobId) => {
    const j = byId(jobId);
    if (!j || j.state !== 'robbed' || j.holder !== (a >>> 0)) return { ok: false, text: 'You hold no such parcel.' };
    const spare = owned(a, BROKEN) - (BROKEN === PARCEL ? sealedCount(a) : 0);
    if (spare < 1) return { ok: false, text: 'You no longer have that parcel with you.' };
    const items = j.items;
    try { commit(j, { state: 'opened', items: [], openedAt: Date.now(), closedAt: Date.now() }); } catch (e) { return { ok: false, text: 'It will not open just now.' }; }
    try { takeOne(a, BROKEN, BROKEN_NAME); } catch (e) { log(`couriers: the broken parcel of #${j.id} stayed with ${who(a)}: ${e.message}`); }
    try { P().giveEntries(a, items); } catch (e) { log(`couriers: the goods of #${j.id} could not reach ${who(a)}: ${e.message}`); }
    audit(`COURIER ${who(a)} opened the robbed parcel #${j.id} of ${j.senderName} #${j.senderTag}: ${itemsText(items)}`);
    return { ok: true, text: `You break the seal: ${itemsText(items)}.` };
  };
  const cancel = (a, jobId) => {
    const j = byId(jobId);
    if (!j || j.state !== 'open') return { ok: false, text: 'That job is no longer on the board.' };
    if (j.sender !== (a >>> 0)) return { ok: false, text: 'Only whoever posted a job can take it down.' };
    try { backToSender(j, 'cancelled', 'was taken down'); } catch (e) { return { ok: false, text: 'The board could not take it down just now.' }; }
    return { ok: true, text: 'Job taken down. The goods and the pay wait in your mailbox; the fee and any insurance are not returned.' };
  };

  // ---- robbery ------------------------------------------------------------------------------------------------------
  // Why an insured parcel pays nothing, or '' when it pays
  const noPayout = (j, robber) => {
    if (!(j.insured > 0)) return 'not insured';
    if (sameAccount(robber, j.sender, j.senderAccount, j.senderProfile)) return 'the robber shares an account with the sender';
    if (sameAccount(robber, j.courier, j.courierAccount, j.courierProfile)) return 'the robber shares an account with the courier';
    if (sameParty(robber, j.courier) || sameParty(robber, j.sender)) return 'the robber is in a party with the courier or the sender';
    if (sameFaction(robber, j.courier) || sameFaction(robber, j.sender)) return 'the robber shares a faction with the courier or the sender';
    const week = (data().payouts[accountKey(j)] || []).filter((t) => Date.now() - t < 7 * DAY);
    if (week.length >= C.maxPayoutsPerWeek) return `the sender had ${week.length} payouts this week`;
    return '';
  };
  const payout = (j, robber) => {
    const why = noPayout(j, robber);
    if (why) { if (j.insured > 0) audit(`COURIER #${j.id} insurance (${j.insured}) not paid: ${why}`); return 0; }
    const T = globalThis.__dboTreasuryZone;
    const balance = T && typeof T.balance === 'function' ? Math.max(0, Math.floor(Number(T.balance(j.originZone)) || 0)) : 0;
    const amount = Math.min(j.insured, balance);
    if (amount <= 0 || !T || typeof T.spend !== 'function' || !T.spend(j.originZone, amount)) { audit(`COURIER #${j.id} insurance (${j.insured}) not paid: the ${j.originName} treasury holds ${balance}`); return 0; }
    const key = accountKey(j);
    data().payouts[key] = (data().payouts[key] || []).filter((t) => Date.now() - t < 7 * DAY).concat([Date.now()]);
    try { commit(j, { payout: amount }); } catch (e) { log('couriers: the payout record could not be written', e.message); }
    letter(j.sender, j.originName, `The ${j.originName} treasury pays ${amount} gold for your insured parcel, robbed on the road${amount < j.insured ? ` (all it held of the ${j.insured} insured)` : ''}.`, { gold: amount, items: [] });
    audit(`COURIER #${j.id} insurance paid ${amount} of ${j.insured} from the ${j.originName} treasury to ${j.senderName} #${j.senderTag}`);
    return amount;
  };
  // robbery.js after a robbery: maybe one parcel changes hands. A label for the messages, or null
  const robbed = (robber, victim) => {
    robber >>>= 0; victim >>>= 0;
    const mine = carriedBy(victim);
    if (!mine.length || !PARCEL || !(Math.random() < Number(C.robChance))) return null;
    const j = mine[Math.floor(Math.random() * mine.length)];
    if (owned(victim, PARCEL) < 1) { log(`couriers: ${who(victim)} carries #${j.id} but holds no parcel`); return null; }
    const pay = Math.max(0, int(j.held) || 0);
    try { commit(j, { state: 'robbed', holder: robber, robbedBy: robber, robberName: nameOf(robber), robbedAt: Date.now(), held: 0 }); } catch (e) { log('couriers: a robbery could not be written', e.message); return null; }
    try {
      if (!takeOne(victim, PARCEL, SEALED_NAME)) throw new Error('no parcel');
      if (!giveNamed(robber, BROKEN, BROKEN_NAME)) throw new Error('the robber could not take it');
    } catch (e) {
      log(`couriers: robbery of #${j.id} failed: ${e.message}`);
      try { commit(j, { state: 'carried', holder: 0, robbedBy: 0, robbedAt: 0, held: pay }); } catch (x) { /* logged above */ }
      return null;
    }
    // The sender hears of it, and the pay the board held comes back to them
    letter(j.sender, j.originName, `Your parcel for ${destText(j)} was robbed on the road from ${j.courierName}.${pay ? ` The ${pay} gold you put up for the courier comes back to you.` : ''}`, { gold: pay, items: [] });
    const paid = payout(j, robber);
    audit(`COURIER #${j.id} robbed from ${who(victim)} by ${who(robber)}: ${itemsText(j.items)}${j.insured ? `; insured ${j.insured}, paid ${paid}` : ''}`);
    return 'a sealed courier\'s parcel';
  };

  // ---- the expiry sweep ---------------------------------------------------------------------------------------------
  const sweep = () => {
    if (S.broken) return;
    const now = Date.now();
    for (const j of data().jobs.slice()) {
      try {
        if (j.state === 'open' && (j.expiresAt <= now || gone(j.sender))) backToSender(j, 'lapsed', 'found no courier');
        else if (j.state === 'carried' && (isDue(j) || gone(j.courier))) {
          const late = !gone(j.courier);
          if (late) takeBackParcel(j);
          backToSender(j, late ? 'expired' : 'returned', late ? `was not delivered in time by ${j.courierName}` : 'lost its courier');
          if (late && online(j.courier)) personal(j.courier, `Your time to deliver the parcel for ${destText(j)} has run out. It is taken back, unpaid.`);
        } else if (j.state === 'robbed' && now - (j.robbedAt || 0) >= C.brokenDays * DAY) {
          if (j.payout > 0) { commit(j, { state: 'lost', items: [], closedAt: now }); audit(`COURIER #${j.id}: the robbed parcel was never opened; the insurance paid, the goods are lost`); }
          else backToSender(j, 'recovered', 'was found unopened on the roadside');
        } else if (j.copyOwed && j.courier && online(j.courier)) {
          if (takeOne(j.courier, PARCEL, SEALED_NAME)) { j.copyOwed = false; save(); }
        }
      } catch (e) { log(`couriers: sweep of #${j.id} failed: ${e.message}`); }
    }
    const before = data().jobs.length;
    S.data.jobs = data().jobs.filter((j) => ['open', 'carried', 'robbed'].includes(j.state) || j.copyOwed || now - (j.closedAt || j.postedAt) < C.keepClosedDays * DAY);
    if (S.data.jobs.length !== before) { try { save(); } catch (e) { /* the next sweep */ } }
  };
  every('courierSweep', 60000, sweep);

  // ---- in person: X on the recipient --------------------------------------------------------------------------------
  const personJob = (a, t) => carriedBy(a).find((j) => j.kind === 'person' && j.recipient === (t >>> 0));
  globalThis.__dboCourierEntries = (a, t) => {
    const j = personJob(a >>> 0, t >>> 0);
    return j && online(t) && near(a, t, C.handoverDistance) ? [{ id: 'courierHand', label: 'Hand over the parcel' }] : [];
  };
  const finishHand = (h, choice) => {
    S.hand.delete(h.recipient);
    try { closeWidget(h.recipient, WIDGET_ID); } catch (e) { /* gone */ }
    const j = byId(h.job);
    if (!j || j.state !== 'carried' || j.courier !== h.courier) return;
    if (!online(h.courier) || !online(h.recipient) || !near(h.courier, h.recipient, C.handoverDistance * 2)) {
      if (online(h.courier)) personal(h.courier, 'You are too far apart. The parcel stays with you.');
      return;
    }
    const r = complete(j, choice === 'take', j.originName, 'in person');
    personal(h.courier, r.text);
    if (r.ok) personal(h.recipient, choice === 'take' ? `${h.courierName} hands you a parcel from ${j.senderName}.` : `${h.courierName} hands over a parcel from ${j.senderName}. It waits in your mailbox at the notice boards.`);
  };
  globalThis.__dboCourierAction = (a, id, t, nameFor) => {
    if (id !== 'courierHand') return false;
    a >>>= 0; t >>>= 0;
    const j = personJob(a, t);
    if (!j) { personal(a, 'You carry no parcel for them.'); return true; }
    if (!online(t) || !near(a, t, C.handoverDistance)) { personal(a, 'Get closer to them first.'); return true; }
    if (S.hand.has(t)) { personal(a, 'They are already being handed something.'); return true; }
    const h = { job: j.id, courier: a, recipient: t, nonce: `${a.toString(16)}-${t.toString(16)}-${Date.now().toString(36)}`, until: Date.now() + C.handoverSeconds * 1000,
      courierName: nameFor ? nameFor(t, a) : j.courierName };
    const caps = S.caps.get(t);
    if (!caps || !caps.has('courierHandover')) { finishHand(h, 'mailbox'); return true; }
    S.hand.set(t, h);
    openWidget(t, { type: 'courierHandover', id: WIDGET_ID, mode: 'person', nonce: h.nonce, from: h.courierName, sender: j.senderName, goods: itemsText(j.items), seconds: C.handoverSeconds }, true);
    personal(a, `You offer ${nameFor ? nameFor(a, t) : j.recipientName} the parcel.`);
    return true;
  };
  onUi('courierAnswer', (a, args) => {
    const h = S.hand.get(a >>> 0);
    if (!h || h.nonce !== String((args || [])[0] || '')) return;
    finishHand(h, String(args[1]) === 'take' ? 'take' : 'mailbox');
  });

  // ---- drop points: asked when the courier stands at one ------------------------------------------------------------
  const askDrop = (a, jobs, d) => {
    const nonce = `${(a >>> 0).toString(16)}-d-${Date.now().toString(36)}`;
    S.nonces.set(a >>> 0, nonce);
    openWidget(a, { type: 'courierHandover', id: WIDGET_ID, mode: 'drop', nonce, place: d.name,
      jobs: jobs.map((j) => ({ id: j.id, goods: itemsText(j.items), pay: j.held, recipient: j.recipientName, sender: j.senderName })) }, true);
  };
  every('courierDrops', 2000, () => {
    if (!drops.length || !data().jobs.length) return;
    const now = Date.now();
    for (const [a, h] of S.hand) if (now >= h.until) finishHand(h, 'mailbox');
    for (const a of onlineActors()) {
      const jobs = carriedBy(a).filter((j) => j.kind === 'drop');
      if (!jobs.length) continue;
      const p = posOf(a);
      for (const d of drops) {
        const here = jobs.filter((j) => j.dest === d.id);
        if (!here.length || distance(p, d.world, d.pos) > d.radius) continue;
        if (now - (S.dropAsked.get(`${a}:${d.id}`) || 0) < C.dropAskSeconds * 1000) continue;
        S.dropAsked.set(`${a}:${d.id}`, now);
        const caps = S.caps.get(a >>> 0);
        if (caps && caps.has('courierHandover')) askDrop(a, here, d);
        else personal(a, `You stand at ${d.name}. Type /courier deliver to hand in the parcel.`);
      }
    }
  });
  onUi('courierDropIn', (a, args) => {
    if (String((args || [])[0]) !== S.nonces.get(a >>> 0)) return;
    const r = dropIn(a, args[1]);
    personal(a, r.text);
    const left = carriedBy(a).filter((j) => j.kind === 'drop');
    const d = left.length ? drops.find((x) => left.some((j) => j.dest === x.id) && distance(posOf(a), x.world, x.pos) <= x.radius) : null;
    if (d) askDrop(a, left.filter((j) => j.dest === d.id), d); else { S.nonces.delete(a >>> 0); closeWidget(a, WIDGET_ID); }
  });
  // Not now at a drop point (or Escape): the panel closes and is not asked again for dropSnoozeSeconds there
  const snoozeDrops = (a) => {
    const until = Date.now() + Math.max(0, Number(C.dropSnoozeSeconds) || 600) * 1000 - C.dropAskSeconds * 1000;
    for (const d of drops) if (distance(posOf(a), d.world, d.pos) <= d.radius) S.dropAsked.set(`${a >>> 0}:${d.id}`, until);
  };
  onUi('courierDismiss', (a, args) => {
    if (String((args || [])[0]) !== S.nonces.get(a >>> 0)) return;
    S.nonces.delete(a >>> 0); snoozeDrops(a); closeWidget(a, WIDGET_ID);
  });
  onUi('uiCaps', (a, args) => { S.caps.set(a >>> 0, new Set((args || []).map(String))); });
  // Escape: in person it is an answer (the mailbox); at a drop point it is Not now
  onUi('close', (a, args, widgetId) => {
    if (widgetId !== WIDGET_ID) return;
    const h = S.hand.get(a >>> 0);
    if (h) finishHand(h, 'mailbox');
    else if (S.nonces.has(a >>> 0)) { S.nonces.delete(a >>> 0); snoozeDrops(a); closeWidget(a, WIDGET_ID); }
  });

  // ---- protections (itemguards.js, gamemode.js trade veto, robbery.js, pickpocket.js) -------------------------------
  // How many copies of baseId a may not give up
  globalThis.__dboCourierSealed = (a, baseId) => ((Number(baseId) >>> 0) === PARCEL && PARCEL ? sealedCount(Number(a) >>> 0) : 0);
  // A reason for the player when moving count of baseId would give up a sealed parcel, or null
  globalThis.__dboCourierMove = (a, baseId, count) => {
    const sealed = globalThis.__dboCourierSealed(a, baseId);
    if (!sealed || owned(Number(a) >>> 0, PARCEL) - (Number(count) || 0) >= sealed) return null;
    return 'A sealed courier\'s parcel stays with you until it is delivered.';
  };
  globalThis.__dboCourierRobbed = robbed;
  globalThis.__dboCourierParcelBase = () => PARCEL;

  // ---- the coop window's Courier tab --------------------------------------------------------------------------------
  const hoursTo = (t) => Math.max(0, Math.ceil((t - Date.now()) / 3600000));
  const row = (a, j) => ({ id: j.id, goods: itemsText(j.items), kinds: (j.items || []).length, pay: j.pay, dest: destText(j), kind: j.kind, origin: j.originName,
    sender: `${j.senderName} #${j.senderTag}`, recipient: `${j.recipientName} #${j.recipientTag}`, insured: j.insured || 0, state: j.state,
    hoursLeft: j.state === 'open' ? hoursTo(j.expiresAt) : j.state === 'carried' ? dueLeft(j).hours : 0,
    gameHoursLeft: j.state === 'carried' ? dueLeft(j).gameHours : 0, mine: j.sender === (a >>> 0) });
  const view = (a) => {
    a >>>= 0;
    if (!C.enabled || !PARCEL) return {};
    const place = placeOf(a);
    const goods = [];
    const counts = new Map();
    for (const e of entriesOf(a)) if (!e.worn && !e.wornLeft && (Number(e.count) || 0) > 0) counts.set(Number(e.baseId) >>> 0, (counts.get(Number(e.baseId) >>> 0) || 0) + Number(e.count));
    try { for (const [id, n] of counts) if (id !== PARCEL && id !== BROKEN && P().sendableBase(id)) goods.push({ baseId: id, name: P().nameOfItem(id), count: n, value: baseValue(id) }); } catch (e) { /* no post.js */ }
    goods.sort((x, y) => x.name.localeCompare(y.name));
    const here = place ? destinations(place) : [];
    return {
      courier: {
        enabled: ready(), place: place ? place.name : '', placeId: place ? place.id : '',
        destinations: here.map((d) => ({ key: d.key, kind: d.kind, name: d.name, hint: d.hint || '' })),
        goods: goods.slice(0, 200),
        rules: { feeShare: Number(C.feeShare) || 0, minFee: int(C.minFee) || 0, premiumRate: Number(C.premiumRate) || 0, maxStacks: C.maxStacks, minPay: C.minPay, maxPay: C.maxPay,
          limitGameDays: limitDays(), openDays: C.openDays, maxCarried: C.maxCarried, maxOpen: C.maxOpen, maxPayoutsPerWeek: C.maxPayoutsPerWeek },
        open: place ? data().jobs.filter((j) => j.state === 'open' && j.origin === place.id && j.expiresAt > Date.now()).map((j) => row(a, j)) : [],
        carrying: carriedBy(a).map((j) => Object.assign(row(a, j), { here: !!place && j.kind === 'board' && j.dest === place.id })),
        broken: data().jobs.filter((j) => j.state === 'robbed' && j.holder === a).map((j) => row(a, j)),
        mine: data().jobs.filter((j) => j.sender === a && (['open', 'carried', 'robbed'].includes(j.state) || Date.now() - (j.closedAt || 0) < DAY)).map((j) => row(a, j)),
      },
    };
  };

  const pigeonNonce = (a) => (globalThis.__dboPigeonNonces instanceof Map ? globalThis.__dboPigeonNonces.get(a) : undefined);
  const act = (event, fn) => onUi(event, (a, args) => {
    if (String((args || [])[0]) !== pigeonNonce(a)) return;
    const place = placeOf(a);
    if (!place) { personal(a, 'Walk up to a notice board and use it.'); return; }
    let r;
    try { r = fn(a, place, (args || []).slice(1)); } catch (e) { log(`couriers: ${event} failed for ${who(a)}: ${e.stack || e.message}`); r = { ok: false, text: 'That could not be done just now.' }; }
    if (typeof globalThis.__dboOpenPigeonCoop === 'function') globalThis.__dboOpenPigeonCoop(a, r.text, r.ok ? 'sent' : 'refused', 'courier');
    else personal(a, r.text);
  });
  act('courierPost', (a, place, [dest, to, pay, insured, items]) => post(a, place, dest, to, pay, insured, items));
  act('courierTake', (a, place, [id]) => take(a, place, id));
  act('courierDeliver', (a, place, [id]) => deliver(a, place, id));
  act('courierOpen', (a, place, [id]) => openBroken(a, id));
  act('courierCancel', (a, place, [id]) => cancel(a, id));

  // ---- chat: a fallback for a UI without the panel, and the staff's view -------------------------------------------
  if (typeof registerChatCommand === 'function') {
    registerChatCommand('courier', (a, args) => {
      const words = String(args || '').trim().split(/\s+/);
      const mine = carriedBy(a);
      if (words[0] === 'deliver') {
        const d = drops.find((x) => distance(posOf(a), x.world, x.pos) <= x.radius && mine.some((j) => j.kind === 'drop' && j.dest === x.id));
        if (!d) return personal(a, 'Stand at the drop point of a parcel you carry.');
        for (const j of mine.filter((x) => x.kind === 'drop' && x.dest === d.id)) personal(a, dropIn(a, j.id).text);
        return;
      }
      if (!mine.length) return personal(a, 'You carry no courier parcels. Take a job at a notice board.');
      for (const j of mine) { const l = dueLeft(j); personal(a, `#${j.id}: ${itemsText(j.items)} for ${destText(j)}, ${j.pay} gold, ${l.gameHours} game hours left (about ${l.hours} h).`); }
    }, { help: 'the courier parcels you carry; deliver at a drop point' });
    registerChatCommand('couriers', (a, args) => {
      const [sub, idRaw] = String(args || '').trim().split(/\s+/);
      if (sub === 'clear') {
        const j = byId(idRaw);
        if (!j || !['open', 'carried', 'robbed'].includes(j.state)) return personal(a, 'No open, carried or robbed job by that number.');
        if (j.state === 'carried') takeBackParcel(j);
        try { backToSender(j, 'cleared', 'was cleared by the staff'); } catch (e) { return personal(a, `Could not clear #${j.id}: ${e.message}`); }
        audit(`COURIER staff ${who(a)} cleared #${j.id}`);
        return personal(a, `#${j.id} cleared: the goods and what was held of the pay went back to ${j.senderName} #${j.senderTag}.`);
      }
      const live = data().jobs.filter((j) => ['open', 'carried', 'robbed'].includes(j.state) || j.copyOwed);
      if (!live.length) return personal(a, 'No courier jobs on the road.');
      for (const j of live.slice(0, 20)) personal(a, `#${j.id} ${j.state}${j.copyOwed ? ' (parcel owed back)' : ''}: ${j.senderName} #${j.senderTag} -> ${destText(j)}, ${itemsText(j.items)}, pay ${j.pay}${j.courier ? `, courier ${j.courierName} #${j.courierTag}` : ''}${j.holder ? `, held by ${j.robberName}` : ''}${j.insured ? `, insured ${j.insured}` : ''}`);
    }, { admin: true, help: '[clear <id>] the courier jobs on the road; clear sends one back to its sender' });
  }

  globalThis.__dboCourierApi = { view, post, take, deliver, dropIn, openBroken, cancel, robbed, sweep, destinations, placeOf, baseValue, enabled: ready };
  const lockRoutes = destinations(null).length;
  log(`couriers: ${C.enabled ? 'on' : 'off'}, parcel ${C.parcelItem}${PARCEL ? '' : ' (missing)'}, ${data().jobs.filter((j) => j.state === 'open' || j.state === 'carried').length} on the board or the road; `
    + `${boardPlaces().length} board places, ${drops.length} drop points, in person${locked() ? `; under the region lock ${lockRoutes} destination kind(s) reachable: ${destinations(null).map((d) => d.key).join(', ')}` : ''}`);
};
