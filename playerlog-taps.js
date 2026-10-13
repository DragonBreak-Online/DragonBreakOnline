// DragonBreak Online: the player log's taps (playerlog.js loads this after deleting its require.cache entry). What the game
// does reaches emit() from here: the one-line hooks (globalThis.__dboPlogHook), the engine slot wrappers (outermost, the
// inner verdict always returned unchanged), the polls (named every() timers, their cost in the ticks line), and the
// aggregators (5 s damage windows, fights, container sessions, per-minute folds).
//
// Rules held here (DESIGN.md 2-3): a wrapper calls the inner handler first and returns its verdict, re-throwing exactly what
// the inner handler threw; its own code runs inside try/catch and never returns false. An engine event with no player and
// no player-owned NPC returns after Set lookups only. A refused hit attempt costs one Map lookup and a counter, no get and
// no new object. No hook reads chat, and no text a player wrote is ever kept: commands keep their name, a sub-verb from
// a fixed list, targets resolved to characters before the run, numbers at fixed places, the route and the outcome.
'use strict';

module.exports = (K) => {
  const { api, mp, log, C, R, S, G, now, err, guard, put, add, emit, idOf, refreshId, isPlayer, profileOf, partyOf, playerParty,
    npcParty, placeOf, recordName, recordType, itemOf, descOf, cellName, hex, get } = K;
  const u32 = (x) => Number(x) >>> 0;
  const online = (a) => S.online.has(u32(a));
  let slots = 0;

  // ---- small helpers ------------------------------------------------------------------------------------------------------
  const GOLD = 0xf;
  const entriesOf = (holder) => { const inv = get(u32(holder), 'inventory'); return inv && Array.isArray(inv.entries) ? inv.entries : []; };
  const countIn = (entries, baseId) => { const id = u32(baseId); let n = 0; for (const e of entries) if (e && u32(e.baseId) === id) n += Number(e.count) || 0; return n; };
  const goldOf = (a) => countIn(entriesOf(a), GOLD);
  const bankOf = (a) => { const v = Number(get(u32(a), 'private.bankGold')); return Number.isFinite(v) ? Math.floor(v) : undefined; };
  const baseOfRef = (ref) => { const d = get(u32(ref), 'baseDesc'); if (!d) return 0; try { return mp.getIdFromDesc(String(d)) >>> 0; } catch (e) { return 0; } };
  const actorOf = (userId) => { if (typeof api.actorOf === 'function') return u32(api.actorOf(userId)); try { return u32(mp.getUserActor(userId)); } catch (e) { return 0; } };
  const isAdmin = (a) => { try { return typeof api.isAdmin === 'function' && api.isAdmin(a) === true; } catch (e) { return false; } };
  const fnOf = (name) => { const f = globalThis[name]; return typeof f === 'function' ? f : null; };
  const housing = () => { const H = globalThis.__dboHousing; return H && typeof H === 'object' ? H : null; };
  const pairKey = (x, y) => `${u32(x)}|${u32(y)}`;
  const itemsList = (list) => (Array.isArray(list) ? list.slice(0, 60).map((x) => (x && typeof x === 'object' ? itemOf(x.baseId, x.count, x.extras || x) : null)).filter(Boolean) : undefined);
  const lastPacket = (a) => { const m = api.lastPacketAt; return m instanceof Map ? Number(m.get(u32(a))) || 0 : 0; };
  // a client's form id: a number, or a string as the fork's toFormId reads it (decimal), or hex where the sender writes hex
  const formIdOf = (v, hexStr) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v >>> 0;
    if (typeof v !== 'string' || !v.trim()) return 0;
    const t = v.trim();
    if (hexStr) return /^(?:0x)?[0-9a-f]{1,8}$/i.test(t) ? parseInt(t.replace(/^0x/i, ''), 16) >>> 0 : 0;
    const n = Number(t);
    return Number.isFinite(n) ? n >>> 0 : 0;
  };
  // The closing loops of the polls stop after closeBudgetMs and leave the rest to the next tick (safety review R3); each
  // record keeps its own times, so what is written does not change
  const closeDeadline = () => K.perf() + (Number(C.closeBudgetMs) > 0 ? Number(C.closeBudgetMs) : 3);

  // =============================================================================================================================
  // Sessions (DESIGN.md 2.2.7)
  // =============================================================================================================================
  const accountSnapshot = (a) => {
    const p = profileOf(a);
    if (p < 0) return;
    let actors = [];
    try { actors = (mp.getActorsByProfileId(p) || []).map(u32).filter(Boolean).slice(0, 12); } catch (e) { actors = [u32(a)]; }
    const chars = [];
    const slotsOf = new Map();
    for (const x of actors) {
      const own = S.ids.get(x);
      const shown = (get(x, 'appearance') || {}).name;
      const n = own && online(x) ? own.n : String(shown || 'Stranger');
      const c = (() => { const t = get(x, 'private.charTag'); return typeof t === 'string' && t.length === 4 ? t : ''; })();
      const slot = Number(get(x, 'private.charSlot'));
      // private.rp holds backstory text too: only its number is read out
      const rp = get(x, 'private.rp');
      const created = rp && typeof rp === 'object' && Number.isFinite(Number(rp.createdAt)) ? Number(rp.createdAt) : undefined;
      const j = get(x, 'private.dboJournalId');
      chars.push({ a: hex(x), c: c || undefined, n, slot: Number.isFinite(slot) ? slot : undefined, dead: get(x, 'isDead') === true, perma: get(x, 'private.permaDead') === true,
        staff: get(x, 'private.dboStaffChar') === true || undefined, created, j: typeof j === 'string' ? j : undefined });
      if (Number.isFinite(slot)) slotsOf.set(slot, { c, n });
    }
    put('slotMap', p, { t: now(), slots: slotsOf });
    emit('account.snapshot', a, { chars }, { src: 'hook:login' });
  };
  const TIER_OK = new Set(['senior', 'developer', 'leadgm', 'gm', 'trialgm']);
  const login = (userId, a, reselect) => {
    a = u32(a);
    if (!a) return;
    add('online', a);
    const r = refreshId(a, true);
    const t = now();
    put('sessions', a, { t, userId, gold0: goldOf(a), bank0: bankOf(a) });
    put('connectByUser', userId, { t, a, p: r.p });
    S.menuLeft.delete(userId);
    const cv = S.clientByUser.get(userId);
    const slot = Number(get(a, 'private.charSlot'));
    emit('session.login', a, { slot: Number.isFinite(slot) ? slot : undefined, tier: TIER_OK.has(r.staff) ? r.staff : undefined, staffChar: get(a, 'private.dboStaffChar') === true || undefined,
      gold: S.sessions.get(a).gold0, bank: S.sessions.get(a).bank0, userId, client: cv ? cv.v : undefined, sp: cv ? cv.sp : undefined, reselect: reselect || undefined }, { src: reselect ? 'packet:reselect' : 'hook:login' });
    const w = S.worn.get(a); if (w) w.t = t; else put('worn', a, { t, set: null });
    setTimeout(guard('login.snapshot', () => { if (S.on) accountSnapshot(a); }), 0);
  };
  G.hooks.login = (userId, a) => login(userId, a, false);
  const LEAVE_REASON = { kick: 'kicked', kicked: 'kicked', command: 'kicked', panel: 'kicked', demotion: 'kicked', suspension: 'suspended', suspended: 'suspended',
    sleep: 'slept', slept: 'slept', permadeath: 'permadeath', afk: 'kicked', discord_ban: 'kicked', ban_enforce: 'kicked', server_stop: 'server_stop' };
  const KICK_KIND = new Set(['command', 'panel', 'demotion', 'suspension', 'sleep', 'permadeath', 'afk', 'discord_ban', 'ban_enforce']);
  // The end of a character's session: logout reason, gold and bank, open aggregates flushed, the inventory snapshot
  const leave = (a, forced, src) => {
    a = u32(a);
    if (!a) return;
    const t = now();
    const sess = S.sessions.get(a);
    let reason = forced || null, q;
    const pend = S.pendingLeave.get(a);
    if (!reason && pend && t - pend.t < 60000) reason = LEAVE_REASON[pend.reason] || 'kicked';
    let journalOpen = false;
    try { const J = globalThis.__dboJournalOpen; journalOpen = J instanceof Map && J.get(a) === true; } catch (e) { journalOpen = false; }
    const lp = lastPacket(a);
    const silent = lp ? Math.round((t - lp) / 1000) : undefined;
    const afk = S.afk.get(a);
    if (!reason && journalOpen) reason = 'menu_quit';
    if (!reason && silent !== undefined && silent >= 45) { reason = 'crash_likely'; q = 'inferred'; }
    if (!reason && afk && afk.away && t - afk.since >= 20 * 60000) { reason = 'afk_likely'; q = 'inferred'; }
    if (!reason) reason = 'unknown';
    closeAllFor(a, 'logout');
    if (sess) {
      emit('session.logout', a, { reason, sec: Math.round((t - sess.t) / 1000), gold0: sess.gold0, gold1: goldOf(a), bank0: sess.bank0, bank1: bankOf(a), silentSec: silent, journalOpen: journalOpen || undefined },
        { src: src || 'hook:logout', q });
    }
    if (C.snapshots.logout && sess) setTimeout(guard('logout.snapshot', () => snapshot(a, 'logout')), 0);
    forget(a);
  };
  // What the state holds for a character in the world, dropped when it leaves it
  const forget = (a) => {
    S.sessions.delete(a); S.pendingLeave.delete(a); S.afk.delete(a); S.vitals.delete(a); S.restrained.delete(a); S.worn.delete(a); S.mastery.delete(a); S.companions.delete(a);
    S.propSnap.delete(a);
    S.online.delete(a);
  };
  G.hooks.logout = (userId, a) => leave(a, null, 'hook:logout');
  G.hooks.switch = (userId, oldA, newA) => {
    const o = u32(oldA), n = u32(newA);
    if (!o || o === n) return;
    const to = (() => { const x = u32(newA); const own = S.ids.get(x); const t = get(x, 'private.charTag'); return { a: hex(x), c: typeof t === 'string' && t.length === 4 ? t : undefined, n: own ? own.n : String((get(x, 'appearance') || {}).name || '') || undefined }; })();
    const sess = S.sessions.get(o);
    emit('session.switch', o, { to }, { src: 'hook:switch' });
    // the character left behind: its session ends here (the menu already ended it when it came that way)
    if (sess) leave(o, 'menu_quit', 'hook:switch');
  };
  G.hooks.client = (userId, a, text) => {
    const cv = R.parseClientVersion(text);
    if (!cv) return;
    put('clientByUser', userId, { v: cv.v, sp: cv.sp, t: now() });
    if (!S.connectByUser.has(userId)) put('connectByUser', userId, { t: now(), a: 0, p: -1 });
    const x = u32(a);
    if (x && online(x)) emit('session.client', x, { v: cv.v, sp: cv.sp }, { src: 'hook:client' });
  };
  // A kick, ban, suspension, sleep or permadeath site names the reason before the player is let go (A2)
  G.hooks.leave_reason = (a, reason, by) => {
    const x = u32(a);
    if (!x) return;
    put('pendingLeave', x, { reason: String(reason), t: now(), by: u32(by) || 0 });
    if (KICK_KIND.has(reason)) emit('session.kick', x, { kind: reason }, { o: by ? [partyOf(by, 'by')] : undefined, src: 'hook:leave' });
  };
  G.hooks.travel = (a, reason, by) => { const x = u32(a); if (x) put('travel', x, { reason: String(reason), by: u32(by) || 0, t: now() }); };

  // The whole pack with its extras, gold and bank (disk only): at a logout and at each down (DESIGN.md 2.2.11)
  const snapshot = (a, at) => {
    const entries = entriesOf(a);
    const items = [];
    for (const e of entries) { if (!e || u32(e.baseId) === GOLD) continue; items.push(itemOf(e.baseId, e.count, e)); if (items.length >= 250) break; }
    emit('item.snapshot', a, { at, items, gold: countIn(entries, GOLD), bank: bankOf(a) }, { src: `snapshot:${at}` });
  };

  // =============================================================================================================================
  // Commands (DESIGN.md 2.2.3): CMD-WRAP. fn runs exactly once, capture on or off, and its result or error goes back as it was.
  // =============================================================================================================================
  const WORLD_NAMES = new Set((Array.isArray(api.WORLD_GROUPS) ? api.WORLD_GROUPS : []).map((g) => String(Array.isArray(g) ? g[0] : g).toLowerCase()));
  const NUM_RX = /^-?\d{1,9}(\.\d{1,3})?$/;
  const formGone = (id) => { try { const f = globalThis.__dboFormGone; return typeof f === 'function' && !!f(id); } catch (e) { return false; } };
  const disguised = (a) => { try { const f = globalThis.__dboDisguised; return typeof f === 'function' && f(a) === true; } catch (e) { return false; } };
  const indexFind = (key, value) => { try { const r = mp.findFormsByPropertyValue(key, value); return Array.isArray(r) ? r.map(u32).filter((id) => id && !formGone(id)) : []; } catch (e) { return []; } };
  // A target query -> one character, through the indexes (never a scan of every online actor); a miss or an ambiguity
  // gives nothing, and the query text is never kept
  const resolveTarget = (q, lookup) => {
    const s = String(q || '').trim();
    if (!s || s.length > 64) return 0;
    const pickOnline = (ids) => { const on = ids.filter(online); if (lookup === 'online') return on.length === 1 ? on[0] : 0; if (on.length === 1) return on[0]; return ids.length === 1 ? ids[0] : 0; };
    const tagM = s.match(/^(.*?)\s*#([A-Za-z0-9]{4})$/);
    if (tagM) {
      let ids = indexFind('private.indexed.tagKey', tagM[2].toLowerCase());
      if (ids.length > 1 && tagM[1]) { const nk = tagM[1].trim().toLowerCase(); ids = ids.filter((id) => get(id, 'private.indexed.nameKey') === nk); }
      return pickOnline(ids);
    }
    if (/^\d{1,7}$/.test(s)) {
      let ids = []; try { ids = (mp.getActorsByProfileId(Number(s)) || []).map(u32).filter(Boolean); } catch (e) { ids = []; }
      return pickOnline(ids);
    }
    if (/^(?:0x)?[0-9a-f]{6,8}$/i.test(s) && /[a-f]/i.test(s)) { const id = parseInt(s.replace(/^0x/i, ''), 16) >>> 0; return isPlayer(id) ? id : 0; }
    // A plain name: the own-name index, which never finds a character behind a mask or a beast by the name shown
    const ids = indexFind('private.indexed.nameKey', s.toLowerCase()).filter((id) => !(online(id) && disguised(id)));
    return pickOnline(ids);
  };
  const targetsOf = (rest, spec) => {
    if (!spec || !rest.length) return undefined;
    const from = Math.max(0, Number(spec.from) || 0);
    let words = rest.slice(from, spec.to === undefined ? undefined : Number(spec.to));
    // "Name Part #TAG" may run past a one-word slot: the words up to the tag are the query
    const tagAt = rest.findIndex((w, i) => i >= from && /^#[A-Za-z0-9]{4}$|.#[A-Za-z0-9]{4}$/.test(w));
    if (tagAt >= from && tagAt - from < 6) words = rest.slice(from, tagAt + 1);
    const id = resolveTarget(words.join(' '), spec.lookup || 'online');
    if (!id) return undefined;
    const party = partyOf(id, 'target');
    return party ? [party] : undefined;
  };
  const numsOf = (rest, positions) => {
    const out = [];
    for (const p of positions || []) { const w = p < 0 ? rest[rest.length + p] : rest[p]; if (w !== undefined && NUM_RX.test(w)) out.push(Number(w)); if (out.length >= 3) break; }
    return out.length ? out : undefined;
  };
  const cmdBegin = (name, a, args, userId) => {
    const nm = String(name || '').toLowerCase();
    const actor = u32(a);
    if (!nm || !actor || R.CHAT_VERBS.has(nm)) return null;
    const top = S.cmdStack[S.cmdStack.length - 1];
    const nested = !!(top && top.a === actor);
    const schema = Object.prototype.hasOwnProperty.call(R.COMMAND_SCHEMA, nm) ? R.COMMAND_SCHEMA[nm] : {};
    const cap = globalThis.__dboTellCapture;
    const route = globalThis.__dboPlogRoute || (cap && cap.a === actor ? (cap.quiet ? 'quiet' : 'journal') : userId === undefined ? 'xmenu' : 'chat');
    const words = String(args === undefined || args === null ? '' : args).slice(0, 400).trim().split(/\s+/).filter(Boolean);
    let sub, rest = words;
    if (schema.subs && words.length && schema.subs.includes(words[0].toLowerCase())) { sub = words[0].toLowerCase(); rest = words.slice(1); }
    const ctx = { name: nm, a: actor, route, sub, rest: null, targets: null, nums: null, tells: 0, refused: false, t: now(), nested, schema,
      skip: route === 'quiet' && WORLD_NAMES.has(nm), outcome: null, inner: false };
    // Targets before the run: /kick removes, /rename renames and /wipechars destroys what a later lookup would read
    try { ctx.targets = targetsOf(rest, schema.target); } catch (e) { err('cmd.targets', e); }
    ctx.nums = numsOf(rest, schema.nums);
    if (nested) top.inner = true;
    S.cmdStack.push(ctx);
    if (S.cmdStack.length > 8) S.cmdStack.splice(0, S.cmdStack.length - 8);
    if (nm === 'kick' && ctx.targets && ctx.targets[0] && ctx.targets[0].a) put('pendingLeave', parseInt(ctx.targets[0].a, 16) >>> 0, { reason: 'command', t: now(), by: actor });
    return ctx;
  };
  const cmdEnd = (ctx, result) => {
    const i = S.cmdStack.lastIndexOf(ctx);
    if (i >= 0) S.cmdStack.splice(i, 1);
    // An alias or a command that ran another records nothing itself: the inner run did, with via
    if (ctx.skip || ctx.inner) return;
    const schema = ctx.schema;
    const outcome = ctx.outcome || (result && typeof result.then === 'function' ? 'async' : ctx.refused ? 'refused' : 'ok');
    const o = ctx.targets || undefined;
    if (schema.info && !(schema.staffView && o)) {
      const k = `${ctx.a}|${ctx.name}`;
      const f = S.cmdInfoFold.get(k);
      if (f) f.n++; else put('cmdInfoFold', k, { a: ctx.a, name: ctx.name, n: 1, t: ctx.t });
      return;
    }
    if (schema.staffView && o) { emit('staff.view', ctx.a, { what: schema.staffView }, { o, src: 'cmd' }); return; }
    if (schema.world) { emit('staff.world', ctx.a, { action: schema.world, n: ctx.nums ? Math.round(ctx.nums[0]) : undefined }, { src: 'cmd' }); return; }
    emit('cmd.run', ctx.a, { name: ctx.name, sub: ctx.sub, nums: ctx.nums, route: ctx.route, outcome, via: ctx.nested ? 'alias' : undefined, mirror: schema.mirror && o ? true : undefined },
      { o, src: 'cmd' });
  };
  G.runCommand = (name, fn, self, a, args, userId) => {
    let ctx = null;
    try { if (S.on) ctx = cmdBegin(name, a, args, userId); } catch (e) { err('cmd.begin', e); ctx = null; }
    let result;
    try {
      result = fn.call(self, a, args, userId);
      return result;
    } catch (e) {
      if (ctx) ctx.outcome = 'error';
      throw e;
    } finally {
      if (ctx) { try { cmdEnd(ctx, result); } catch (e) { err('cmd.end', e); const i = S.cmdStack.lastIndexOf(ctx); if (i >= 0) S.cmdStack.splice(i, 1); } }
    }
  };
  // What a command told the player: its outcome class only (REFUSAL_RX); the text is never kept
  G.hooks.tell = (actorId, text) => {
    const top = S.cmdStack[S.cmdStack.length - 1];
    if (!top || top.a !== u32(actorId)) return;
    top.tells++;
    if (!top.refused && R.REFUSAL_RX.test(String(text).slice(0, 300))) top.refused = true;
  };
  // handleChat's gate refusals: the command's name only when it is a registered command (a long chat line records nothing)
  const GATE = new Set(['too_long', 'unknown', 'not_staff', 'lead_only']);
  G.hooks.gate = (a, reason, cmd) => {
    if (!GATE.has(reason)) return;
    const nm = String(cmd || '').toLowerCase();
    const known = nm && !R.CHAT_VERBS.has(nm) && typeof api.commandsHas === 'function' && api.commandsHas(nm);
    if (reason === 'too_long' && !known) return;
    emit('cmd.refused', a, { reason, name: known ? nm : undefined }, { src: 'gate' });
  };

  // =============================================================================================================================
  // Client packets (DESIGN.md 2.2.5): an allow-list; no field outside each type's list is ever read
  // =============================================================================================================================
  const panelParams = (c) => {
    const out = {};
    for (const k of ['hours', 'count', 'level']) if (c[k] !== undefined && Number.isFinite(Number(c[k]))) out[k] = Number(c[k]);
    if (c.amount !== undefined && Number.isFinite(Number(c.amount))) out.amount = Number(c.amount);
    for (const k of ['mode', 'skill', 'tier', 'kind', 'school']) if (typeof c[k] === 'string' && /^[A-Za-z0-9_:.-]{1,40}$/.test(c[k])) out[k] = c[k];
    if (typeof c.item === 'string' && /^[0-9a-f]{1,8}:[A-Za-z0-9 _.'()+-]{1,64}\.es[mpl]$/i.test(c.item)) { try { out.item = recordName(mp.getIdFromDesc(c.item)); } catch (e) { /* unknown */ } }
    return Object.keys(out).length ? out : undefined;
  };
  const PACKET = {
    characterSelectMenuRequest: (userId) => {
      const a = actorOf(userId);
      if (!a) return;
      emit('session.char_menu', a, {}, { src: 'packet' });
      // the body stays for the logout grace; the session of that character ends here
      if (S.sessions.has(a)) leave(a, 'menu_quit', 'packet:menu');
      put('menuLeft', userId, { a, t: now(), armed: false, logins: 0 });
    },
    characterSelectResult: (userId, c) => {
      const action = String(c.action || '');
      const slot = Number(c.slot);
      const left = S.menuLeft.get(userId);
      const conn = S.connectByUser.get(userId);
      const who = (left && left.a) || (conn && conn.a) || 0;
      if (action === 'play') { if (left) { left.armed = true; left.t = now(); } return; }
      if (!who) return;
      if (action === 'create') emit('session.char_create', who, { slot: Number.isFinite(slot) ? slot : undefined }, { src: 'packet' });
      else if (action === 'delete') {
        const p = profileOf(who);
        const m = S.slotMap.get(p);
        const was = m && m.slots instanceof Map ? m.slots.get(slot) : null;
        emit('session.char_delete', who, { slot: Number.isFinite(slot) ? slot : undefined, c: was ? was.c || undefined : undefined, n: was ? was.n : undefined }, { src: 'packet' });
      }
    },
    // The housing menu (review C-R5): housingSystem.ts handles a packet before the gamemode's listener (index.ts registers the
    // systems first), so the record read at propertyRequest is already the after-state. Its state when the menu opened
    // (propertyInfoRequest) is kept as a signature only, and each request compares against it; nothing of it is written.
    propertyInfoRequest: (userId, c) => {
      const a = actorOf(userId), target = formIdOf(c.target);
      if (!a || !target || !online(a)) return;
      put('propSnap', a, { target, sig: propertySig(target), t: now() });
    },
    propertyRequest: (userId, c) => {
      const a = actorOf(userId);
      const target = formIdOf(c.target);
      if (!a || !target) return;
      const action = String(c.action || '');
      if (!R.PROPERTY_ACTIONS.has(action)) return;
      const op = R.PROPERTY_ACTIONS.get(action);
      const recipient = formIdOf(c.recipient);
      const snap = S.propSnap.get(a);
      const after = propertySig(target);
      const ok = snap && snap.target === target && snap.sig && after ? snap.sig !== after : undefined;
      // the next request in the same menu compares against this one's result
      put('propSnap', a, { target, sig: after, t: now() });
      emit('social.housing', a, { op: R.EVENT_TYPES['social.housing'].f.op.e.has(op) ? op : 'other', property: hex(target), ok },
        { o: recipient && isPlayer(recipient) ? [partyOf(recipient, 'target')] : undefined, q: 'inferred', src: 'packet' });
    },
    // the client's own orders (companionService.ts {action, targetId|companionId}): an attack order follows every hit, so they
    // are folded per minute, by action only
    companionCommand: (userId, c) => {
      const a = actorOf(userId);
      if (!a) return;
      const cmd = String(c.action || '');
      if (!R.COMPANION_COMMANDS.has(cmd)) return;
      foldAdd('companionCmd', a, cmd);
    },
    captureRequest: (userId, c) => {
      const a = actorOf(userId), t = u32(c.target);
      if (a && t && isPlayer(t)) put('recentPair', pairKey(a, t), { kind: 'capture', by: a, t: now() });
    },
    // A body opens at once, with no consent (searchSystem.ts): no request line and no timeout for one; its items are the
    // container session and the loot hook
    searchRequest: (userId, c) => {
      const a = actorOf(userId), t = u32(c.target);
      if (!a || !t || !isPlayer(t)) return;
      put('recentPair', pairKey(a, t), { kind: 'search', by: a, t: now() });
      if (get(t, 'isDead') === true) return;
      put('searches', a, { target: t, t: now(), accepted: false, answered: false });
      emit('law.search', a, { op: 'requested' }, { o: [partyOf(t, 'searched')], src: 'packet' });
    },
    // The answer is {requestId, accepted} from the searched player (searchSystem.ts:20, :304), with no target: it answers the
    // latest unanswered request aimed at them (review C-R2)
    searchConsentResult: (userId, c) => {
      const a = actorOf(userId);
      if (!a) return;
      let searcher = 0, req = null;
      for (const [s0, r] of S.searches) if (u32(r.target) === a && !r.answered && (!req || r.t >= req.t)) { searcher = s0; req = r; }
      if (!req) return;
      const accepted = c.accepted === true;
      req.answered = true; req.accepted = accepted; req.t = now();
      emit('law.search', searcher, { op: accepted ? 'accepted' : 'refused' }, { o: [partyOf(a, 'searched')], src: 'packet' });
    },
    adminAction: (userId, c) => {
      const a = actorOf(userId);
      if (!a || !isAdmin(a)) return;
      const action = R.ADMIN_ACTIONS.has(String(c.action)) ? String(c.action) : 'other';
      // the F7 panel sends an online player's actor id as a hex string (adminMenuService.ts; adminSystem.ts parseInt(.., 16))
      const target = R.ADMIN_ACTOR_TARGET.has(action) ? formIdOf(c.target, true) : 0;
      const t = target && isPlayer(target) ? target : 0;
      // emitted with the server's outcome when its adminLog line comes (the audit tap), else after 10 s as sent
      const list = S.panelPending.get(a) || [];
      list.push({ action, target: t, params: panelParams(c), t: now() });
      if (list.length > 8) list.shift();
      put('panelPending', a, Object.assign(list, { t: now() }));
      if (t && (action === 'kick' || action === 'ban' || action === 'tempBan' || action === 'ipBan')) put('pendingLeave', t, { reason: 'panel', t: now(), by: a });
      if (t && action === 'summon') put('travel', t, { reason: 'summon', by: a, t: now() });
      if (t && action === 'teleportTo') put('travel', a, { reason: 'panel_tp', by: a, t: now() });
      if (t && action === 'kill') put('deaths', t, { cause: 'staff_kill', by: a, t: now() });
    },
  };
  // A housing record's signature: what a menu action changes (owner, lock, keys, rooms, name), hashed, never kept as text.
  // With the place rules on, recordOf answers the place's ROOT for any of its doors and chests, while lock, unlock and a
  // non-entrance's own keys (housingSystem.ts PLACE_WIDE, OWN_KEY_ACTIONS) change the MEMBER's own record (review C-R5,
  // re-verify): that record, read where housingSystem.ts keeps it (ownRefOf), is hashed next to the root's
  const recFields = (r) => (r && typeof r === 'object' && !Number(r.primary)
    ? [r.owner, r.ownerChar || 0, r.locked, r.serial || 0, r.name || '', r.assigned || null, r.shared || null, r.containers || null,
      Array.isArray(r.issued) ? r.issued.length : 0, r.holders || null, Number(r.memberOf) || 0, Array.isArray(r.keyAliases) ? r.keyAliases.length : 0]
    : null);
  const propertySig = (target) => {
    const H = housing();
    if (!H || typeof H.recordOf !== 'function') return '';
    try {
      const r = H.recordOf(target);
      if (!r) return 'none';
      return R.siteHash(JSON.stringify([recFields(r), recFields(get(ownRefOf(u32(target)), 'private.housing'))]));
    } catch (e) { return ''; }
  };
  G.hooks.packet = (userId, content) => {
    if (!content || typeof content !== 'object' || content.type === 'cef::chat:send') return;
    const type = content.customPacketType;
    if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(R.PACKET_TYPES, type)) return;
    // only the listed fields are copied out of the packet
    const c = {};
    for (const k of R.PACKET_TYPES[type]) if (content[k] !== undefined) c[k] = content[k];
    PACKET[type](userId, c);
  };
  // Panel actions the server never logged a line for: written after 10 s with the outcome "sent"
  const flushPanelPending = (t, all) => {
    for (const [a, list] of S.panelPending) {
      const keep = [];
      for (const e of list) {
        if (!all && t - e.t < 10000) { keep.push(e); continue; }
        emit('staff.action', a, { action: e.action, via: 'panel', params: e.params, outcome: 'sent' }, { o: e.target ? [partyOf(e.target, 'target')] : undefined, src: 'packet:adminAction' });
      }
      if (keep.length) { list.length = 0; list.push(...keep); } else S.panelPending.delete(a);
    }
  };

  // =============================================================================================================================
  // The audit tap (DESIGN.md 2.2.1 G1, Appendix A): raw lines queued on the hot path, parsed in the flush tick's time box
  // =============================================================================================================================
  G.hooks.audit = (body) => {
    if (S.auditQ.length >= C.caps.audit) { const k = 'cap|audit'; S.dropCounts.set(k, (S.dropCounts.get(k) || 0) + 1); return; }
    S.auditQ.push([now(), String(body)]);
  };
  // An audit party -> the character, read from the game (never the name in the line). recent: with no #TAG and no character
  // of the profile online, the character of that profile this module saw last (review C-R8: a kick or ban line is parsed
  // after its target has left); never for a lookup that needs someone in the world
  const byProfileTag = (profile, tag, recent) => {
    let ids = [];
    try { ids = (mp.getActorsByProfileId(profile) || []).map(u32).filter(Boolean); } catch (e) { ids = []; }
    if (tag) { const hit = ids.find((id) => get(id, 'private.charTag') === tag); return hit || 0; }
    const on = ids.filter(online);
    if (on.length === 1) return on[0];
    if (!recent || on.length > 1) return 0;
    return lastSeenOf(Number(profile));
  };
  // The latest identity this module holds for a profile: the identity cache (kept after a logout) and the connections
  const lastSeenOf = (profile) => {
    if (!Number.isFinite(profile) || profile < 0) return 0;
    let best = 0, bt = -1;
    for (const [a, r] of S.ids) if (r && r.p === profile && Number(r.t) > bt) { bt = Number(r.t); best = a; }
    for (const c of S.connectByUser.values()) if (c && c.p === profile && c.a && Number(c.t) > bt && S.ids.has(u32(c.a))) { bt = Number(c.t); best = u32(c.a); }
    return best;
  };
  const resolveAuditParty = (P, x, role) => {
    if (x === -1 || x === null || x === undefined) return null;
    const raw = typeof x === 'number' ? P[x] : x;
    if (!raw) return null;
    let id = 0, amb = false;
    if (Number.isFinite(raw.profile) && raw.profile !== null) id = byProfileTag(raw.profile, raw.tag || '', true);
    else if (raw.tag) {
      // Name #TAG with no profile: by name and tag, never by the tag alone (DESIGN.md 1.2)
      const all = indexFind('private.indexed.tagKey', raw.tag.toLowerCase());
      const said = String(raw.name || '').toLowerCase();
      let hits = all.filter((c) => { const nk = get(c, 'private.indexed.nameKey'); return typeof nk === 'string' && nk && (said === nk || said.endsWith(` ${nk}`)); });
      if (hits.length > 1) { const on = hits.filter(online); if (on.length === 1) hits = on; }
      if (hits.length === 1) id = hits[0]; else amb = true;
    }
    if (id) {
      const party = partyOf(id, role);
      if (party) return { id, party };
    }
    const party = { r: role };
    if (Number.isFinite(raw.profile) && raw.profile !== null) party.p = raw.profile;
    if (raw.tag) party.c = raw.tag;
    if (amb) party.amb = 1;
    return { id: 0, party };
  };
  const homeOwnerParty = (refHex) => {
    const H = housing();
    if (!H || typeof H.recordOf !== 'function') return null;
    try {
      const rec = H.recordOf(parseInt(refHex, 16) >>> 0);
      if (!rec || !(Number(rec.owner) > 0)) return null;
      const ch = u32(rec.ownerChar);
      if (ch && isPlayer(ch)) return partyOf(ch, 'owner');
      const on = byProfileTag(Number(rec.owner), '', true);
      return on ? partyOf(on, 'owner') : { r: 'owner', p: Number(rec.owner) };
    } catch (e) { return null; }
  };
  const auditEvent = (parsed, e, t) => {
    const P = parsed.parties || [];
    const actor = resolveAuditParty(P, e.actor, 'actor');
    if (!actor) return;
    const o = [];
    for (const [x, role] of e.others || []) { const r = resolveAuditParty(P, x, role); if (r && r.party && (r.party.p !== undefined || r.party.c || r.party.npc)) o.push(r.party); }
    if (e.homeOwner) { const ow = homeOwnerParty(e.homeOwner); if (ow) o.push(ow); }
    const f = Object.assign({}, e.f);
    // a theft the module's own hook already wrote (A2: pickpocket, robbery, courier), with the items by base id: the audit's
    // copy is dropped
    if (e.ev === 'item.theft' && actor.id && f.outcome !== 'demanded') { const seen = S.recentPair.get(`${actor.id}|theft:${f.kind}:${f.outcome}`); if (seen && Math.abs(t - seen.t) < 10000) return; }
    if (e.link && actor.id) { const v = o.find((x) => x.r === 'victim' && x.a); if (v) put('recentPair', pairKey(actor.id, parseInt(v.a, 16)), { kind: e.link, by: actor.id, t }); }
    if (e.travel) {
      const who = e.travel.party === 0 || e.travel.party === undefined ? actor : resolveAuditParty(P, e.travel.party, 'x');
      if (who && who.id) put('travel', who.id, { reason: e.travel.reason, by: actor.id || 0, t });
    }
    // a panel action from the packet tap: its fields join the server's own line, which says whether it went through; its
    // target (read before the target could leave) names a party the line left unresolved (review C-R7)
    if (e.ev === 'staff.action' && f.via === 'panel' && actor.id) {
      const list = S.panelPending.get(actor.id);
      if (list && list.length) {
        const pend = list.shift();
        if (pend && pend.params && !f.params) f.params = pend.params;
        if (pend && pend.target) {
          const i = o.findIndex((x) => x.r === 'target');
          if (i < 0 || !o[i].a) { const tp = partyOf(pend.target, 'target'); if (tp) { if (i < 0) o.push(tp); else o[i] = tp; } }
        }
        if (!list.length) S.panelPending.delete(actor.id);
      }
    }
    if (e.ev === 'session.ban' && actor.id && (f.kind === 'suspend')) put('pendingLeave', actor.id, { reason: 'suspended', t, by: 0 });
    // a beast change, Death's Chill and a revive move health without a hit: no unexplained loss for 5 s, for whom it happened to
    if (/^act\.(BEAST|CHILL|REVIVE|BLOODCROWN|FEED|RITE)$/.test(e.ev)) {
      if (actor.id) suppress(actor.id, t);
      for (const x of o) if (x.r === 'target' && x.a) suppress(parseInt(x.a, 16) >>> 0, t);
    }
    // a beast form changes the name shown: the identity is read again now, not at the next slow poll
    if (e.ev === 'act.BEAST' && actor.id) { try { refreshId(actor.id, false); } catch (x) { /* the next poll */ } }
    // a lock the verdict hook already wrote (social.lock{picked}) is not written again as act.LOCK
    if (e.ev === 'act.LOCK' && actor.id) { const seen = S.recentPair.get(`${actor.id}|lock`); if (seen && Math.abs(t - seen.t) < 10000) return; }
    // act.<VERB> text (review C-R4): the forwarder prints the actor and the verb before it, so the actor's own "Name #TAG"
    // at the start of the text goes; matched against the names the game holds (own and shown), never guessed from the line
    if (e.ev.startsWith('act.') && actor.id && typeof f.text === 'string') {
      const r = idOf(actor.id);
      if (r && r.c) for (const nm of [r.sn, r.n]) { const lead = nm ? `${nm} #${r.c}` : ''; if (lead && (f.text === lead || f.text.startsWith(`${lead} `))) { f.text = f.text.slice(lead.length).trim(); break; } }
    }
    emit(e.ev, actor.id || 0, f, { o: o.length ? o : undefined, t, src: `audit:${parsed.verb}`, ids: actor.id ? undefined : actor.party.p !== undefined ? { p: actor.party.p, c: actor.party.c } : undefined });
  };
  G.parseAudits = (deadline) => {
    while (S.auditQ.length && K.perf() < deadline) {
      const [t, body] = S.auditQ.shift();
      let parsed;
      try { parsed = R.parseAudit(body); } catch (e) { err('audit.parse', e); continue; }
      if (!parsed.verb) { const k = parsed.unknown || '_other'; if (S.auditUnknown.has(k) || S.auditUnknown.size < 200) S.auditUnknown.set(k, (S.auditUnknown.get(k) || 0) + 1); continue; }
      for (const e of parsed.events) { try { auditEvent(parsed, e, t); } catch (x) { err(`audit.${parsed.verb}`.slice(0, 40), x); } }
    }
  };

  // =============================================================================================================================
  // Ownership and access (DESIGN.md 2.2.9): resolved once per container session or door use, never per item
  // =============================================================================================================================
  let treasuryAt = 0, treasuryIds = new Set();
  const treasuries = () => {
    const t = now();
    if (t - treasuryAt < 60000) return treasuryIds;
    treasuryAt = t; treasuryIds = new Set();
    try { for (const z of (typeof api.zoneList === 'function' ? api.zoneList() : []) || []) { if (!z || !z.treasury) continue; try { const id = mp.getIdFromDesc(String(z.treasury)) >>> 0; if (id) treasuryIds.add(id); } catch (e) { /* not loaded */ } } } catch (e) { /* none */ }
    return treasuryIds;
  };
  const ownerPartyOf = (profile, ch, role) => {
    const c = u32(ch);
    if (c && isPlayer(c)) return partyOf(c, role);
    const on = Number(profile) > 0 ? byProfileTag(Number(profile), '', true) : 0;
    return on ? partyOf(on, role) : Number(profile) > 0 ? { r: role, p: Number(profile) } : null;
  };
  // A door's teleport partner, from its record's XTEL (the lower id of a pair is where housing keeps a pair's record)
  const doorPartner = (id) => {
    try {
      const r = typeof api.recordOf === 'function' ? api.recordOf(id) : mp.lookupEspmRecordById(id);
      for (const f of ((r && r.record && r.record.fields) || [])) {
        if (f.type !== 'XTEL' || !(f.data instanceof Uint8Array) || f.data.byteLength < 4) continue;
        const local = new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(0, true);
        return local && typeof r.toGlobalRecordId === 'function' ? r.toGlobalRecordId(local) >>> 0 : local >>> 0;
      }
    } catch (e) { /* not a placed record */ }
    return 0;
  };
  // -> { rec, root, primary, own, rootId } or null. With the place rules on (housingSystem.ts exposeTenancy primary()), recordOf
  // and primaryOf answer with the place's ROOT for any of its doors and chests, while the place's assigned and shared lists are
  // keyed by each member's OWN primary (roomsOf, doRoom): own is that, read from the ref's own record (a pointer's primary, a
  // record's own id), else the ref (a chest), else the lower id of a door's pair, as housingSystem.ts primaryOf (review C-R1)
  const ownRefOf = (id) => {
    const raw = get(id, 'private.housing');
    let own = raw && typeof raw === 'object' ? (Number(raw.primary) ? u32(raw.primary) : id) : id;
    if (!(raw && typeof raw === 'object') && recordType(baseOfRef(id)) === 'DOOR') { const far = doorPartner(id); if (far && far < own) own = far; }
    return own;
  };
  const housingRecord = (ref) => {
    const H = housing();
    if (!H || typeof H.recordOf !== 'function') return null;
    const id = u32(ref);
    const hit = S.housingCache.get(id);
    if (hit && now() - hit.t < 60000) return hit.v;
    let v = null;
    try {
      const rec = H.recordOf(id);
      if (rec) {
        const primary = typeof H.primaryOf === 'function' ? u32(H.primaryOf(id)) : id;
        const own = ownRefOf(id);
        const rootId = rec.memberOf && u32(rec.memberOf) !== primary ? u32(rec.memberOf) : primary;
        const root = rootId !== primary ? H.recordOf(rootId) : null;
        v = { rec, root, primary, own, rootId };
        // a place's cells, for a cell change into it (review C-R10)
        const place = (root || rec).place;
        if (place && Array.isArray(place.cells)) for (const c of place.cells.slice(0, 8)) put('placeCells', String(c), { root: rootId, t: now() });
      }
    } catch (e) { v = null; }
    put('housingCache', id, { t: now(), v });
    return v;
  };
  // Is the actor this place member's assignee (housingSystem.ts isAssignee: by character when property is per character)
  const isAssigneeOf = (asg, a) => {
    const H = housing();
    let perChar = false; try { perChar = !!(H && typeof H.perCharacter === 'function' && H.perCharacter() === true); } catch (e) { perChar = false; }
    if (perChar && u32(asg.char)) return u32(asg.char) === u32(a);
    return Number(asg.profile) > 0 && profileOf(a) === Number(asg.profile);
  };
  // The owner side of a housing record for an actor -> { own, o, rec } or null (not property)
  const placeOwnership = (h, a) => {
    if (!h || !h.rec) return null;
    const H = housing();
    const root = h.root || h.rec;
    const hexP = h.own.toString(16);
    const asg = root.assigned && root.assigned[hexP];
    const owns = (rec) => { try { return !!(H && typeof H.ownsRecord === 'function' && H.ownsRecord(rec, a)); } catch (e) { return false; } };
    if (asg && Number(asg.profile) > 0) {
      // the assignee's own room or chest is theirs: no urgent line (review C-R1)
      if (isAssigneeOf(asg, a)) return { own: 'self', o: [] };
      return { own: 'assignee', o: [ownerPartyOf(asg.profile, asg.char, 'assignee'), Number(root.owner) > 0 ? ownerPartyOf(root.owner, root.ownerChar, 'owner') : null].filter(Boolean), rec: root };
    }
    if (Array.isArray(root.shared) && root.shared.includes(hexP) && Number(root.owner) > 0) {
      if (owns(root)) return { own: 'self', o: [] };
      return { own: 'household', o: [ownerPartyOf(root.owner, root.ownerChar, 'owner')].filter(Boolean), rec: root };
    }
    const rec = Number(h.rec.owner) > 0 ? h.rec : Number(root.owner) > 0 ? root : null;
    if (!rec) return null;
    if (owns(rec)) return { own: 'self', o: [] };
    return { own: 'owner', o: [ownerPartyOf(rec.owner, rec.ownerChar, 'owner')].filter(Boolean), rec };
  };
  // -> { own, o: [owner party], access, ownerIsActor }
  const ownershipOf = (ref, actor) => {
    const id = u32(ref), a = u32(actor);
    // searched: the container is a player (a consented search or a body)
    if (id !== a && isPlayer(id)) return { own: 'searched', o: [partyOf(id, 'searched')] };
    // faction storage
    try {
      const at = fnOf('__dboGuildStorageAt');
      const fs = at ? at(id) : null;
      if (fs && fs.fid) return { own: 'faction', o: Number(fs.leaderProfile) > 0 ? [ownerPartyOf(fs.leaderProfile, 0, 'faction_leader')] : [] };
    } catch (e) { /* the reverse map below */ }
    if (S.factionStore.has(id)) return { own: 'faction', o: [] };
    // a rented business chest
    try {
      const bc = fnOf('__dboBusinessChestOf');
      const b = bc ? bc(id) : businessChestFallback(id);
      if (b && Number(b.renterProfile) > 0) {
        const o = [ownerPartyOf(b.renterProfile, b.renterChar, 'renter')];
        if (Number(b.ownerProfile) > 0) o.push(ownerPartyOf(b.ownerProfile, 0, 'owner'));
        const mine = profileOf(a) === Number(b.renterProfile);
        return { own: mine ? 'self' : 'renter', o: mine ? [] : o.filter(Boolean) };
      }
    } catch (e) { /* not a business chest */ }
    const po = placeOwnership(housingRecord(id), a);
    if (po) return po;
    if (treasuries().has(id)) return { own: 'treasury', o: [] };
    const l = S.loc.get(a);
    try { const cells = globalThis.__dboDungeonCells; if (l && cells instanceof Set && (cells.has(l.w) || (typeof api.normPlace === 'function' && cells.has(api.normPlace(l.w))))) return { own: 'dungeon', o: [] }; } catch (e) { /* none */ }
    return { own: 'public', o: [] };
  };
  // gamemode-held business records, read only (business.js: chests[ref hex] = { price, renter (profile), ... })
  const businessChestFallback = (id) => {
    const B = globalThis.__dboBusiness;
    const data = B && B.data && B.data.businesses;
    if (!data) return null;
    const k = id.toString(16);
    for (const rec of Object.values(data)) { const c = rec && rec.chests && rec.chests[k]; if (c && c.renter) return { ownerProfile: rec.owner, renterProfile: c.renter }; }
    return null;
  };
  // How they got in (q: inferred), only when the owner is not the actor
  const accessOf = (ref, actor, ow) => {
    const id = u32(ref), a = u32(actor);
    const H = housing();
    const call = (name, ...args) => { try { return !!(H && typeof H[name] === 'function' && H[name](...args)); } catch (e) { return false; } };
    if (ow.own === 'assignee' && ow.o[0] && ow.o[0].p === profileOf(a)) return 'assignee';
    if (ow.own === 'assignee' && ow.rec) { try { if (H && typeof H.ownsRecord === 'function' && H.ownsRecord(ow.rec, a)) return 'owner'; } catch (e) { /* below */ } }
    if (call('keyOpens', id, a)) return 'key';
    if (call('isManager', a, id)) return 'manager';
    if (isAdmin(a)) return 'staff';
    const pick = S.lockPicks.get(`${a}|${id}`) || (ow.rec ? S.lockPicks.get(`${a}|${housingRecord(id) ? housingRecord(id).primary : id}`) : null);
    if (pick && now() - pick.t < 600000) return 'lockpick';
    if (ow.own === 'household') return 'shared';
    const h = housingRecord(id);
    if (h && h.rec && h.rec.locked === false) return 'unlocked';
    return 'unknown';
  };

  // =============================================================================================================================
  // Container sessions (DESIGN.md 3.6): one summary per open and close; every move to disk
  // =============================================================================================================================
  const itemKey = (it) => `${it.b || it.i}|${it.named ? 1 : 0}|${it.tmp || ''}|${it.ench || ''}|${it.chg || ''}|${it.soul || ''}|${it.poi || ''}`;
  const openContainer = (a, ref, t) => {
    const cur = S.containers.get(a);
    if (cur && cur.ref === ref) { cur.t = t; return cur; }
    if (cur) closeContainer(a, 'next');
    const base = baseOfRef(ref);
    const ow = ownershipOf(ref, a);
    const s = { a, ref, base: base ? recordName(base) : '', own: ow.own, o: ow.o, access: undefined, took: new Map(), put: new Map(), t0: t, t, refused: 0, w: (S.loc.get(a) || {}).w };
    if (ow.own !== 'self' && ow.own !== 'public' && ow.own !== 'treasury' && ow.own !== 'dungeon') s.access = accessOf(ref, a, ow);
    // the household at its shared chest: P1, not an urgent line, unless nothing shows how they got in
    s.pri = ow.own === 'household' && s.access !== 'lockpick' && s.access !== 'unknown' ? 1 : undefined;
    put('containers', a, s);
    return s;
  };
  const closeContainer = (a, why) => {
    const s = S.containers.get(u32(a));
    if (!s) return;
    S.containers.delete(u32(a));
    // someone else's container: a line even when nothing moved (the access itself is the record); a public or a dungeon
    // chest only when something did
    const others = s.own !== 'self' && s.own !== 'public' && s.own !== 'dungeon';
    if (!s.took.size && !s.put.size && !s.refused && !others) return;
    const list = (m) => (m.size ? [...m.values()].filter((x) => x.k > 0).slice(0, 60) : undefined);
    emit('item.container', s.a, { ref: hex(s.ref), base: s.base, own: s.own, access: s.access, took: list(s.took), put: list(s.put), dur: Math.round((s.t - s.t0) / 1000), refused: s.refused || undefined },
      { o: s.o && s.o.length ? s.o : undefined, src: `container:${why}`, p: s.pri !== undefined ? s.pri : others && s.own !== 'treasury' && s.own !== 'dungeon' ? 0 : 1, nr: others ? undefined : false, q: s.access ? 'inferred' : undefined });
  };
  // The itemguards seam (DESIGN.md 2.2.2): counts before and after, already read there; extras from its collectors
  const extrasDiff = (before, after) => {
    // the multiset difference after - before, by extras signature
    const key = (e) => JSON.stringify([e.health, e.enchantmentId, e.enchantmentEffects ? e.enchantmentEffects.length : 0, e.chargePercent, e.soul, e.poisonId, e.named ? 1 : 0]);
    const left = new Map();
    for (const e of before || []) left.set(key(e), (left.get(key(e)) || 0) + (Number(e.count) || 1));
    const out = [];
    for (const e of after || []) { const k = key(e); const n = left.get(k) || 0; if (n > 0) { left.set(k, n - 1); continue; } out.push(e); }
    return out;
  };
  G.hooks.move = (kind, a, c, id, count, before, after, exBefore, exAfter) => {
    const actor = u32(a), ref = u32(c), base = u32(id);
    if (!online(actor)) return;
    // itemguards reads before at once and after a tick later, so when two moves of one item land in one batch, the first
    // one's after already holds the second's count: the pack delta, capped by the move's own count, is what this move moved
    // (13 Oct, gold review: 'took 5 gold' for 3 + 1)
    const d = kind === 'put' ? (before[0] - after[0]) : (after[0] - before[0]);
    const n = Number(count);
    const moved = Number.isFinite(n) && n > 0 ? Math.max(0, Math.min(d, n)) : d;
    const t = now();
    const extra = extrasDiff(exBefore, exAfter)[0];
    const item = itemOf(base, Math.abs(moved), extra ? Object.assign({ name: extra.named ? 'x' : undefined }, extra) : null);
    emit('item.move', actor, { kind, ref: hex(ref), base: recordName(baseOfRef(ref)), item, packBefore: before[0], packAfter: after[0], contBefore: before[1], contAfter: after[1] }, { src: 'seam:itemguards' });
    if (!moved) return;
    const s = openContainer(actor, ref, t);
    s.t = t;
    const m = kind === 'put' ? s.put : s.took;
    const k = itemKey(item);
    const cur = m.get(k);
    // the container's running total is a copy: emit keeps item by reference until the flush writes it (the item.move above)
    if (cur) cur.k += Math.abs(moved); else if (m.size < 60) m.set(k, Object.assign({}, item));
  };

  // =============================================================================================================================
  // Combat (DESIGN.md 2.2.8, 3.6): pending hits, 5 s windows, fights, refused counters, downs, kills
  // =============================================================================================================================
  const REFUSAL_OK = new Set(R.REFUSAL_REASONS);
  const healthOf = (a) => { const p = get(a, 'percentages'); return p && Number.isFinite(Number(p.health)) ? Number(p.health) : undefined; };
  const srcName = (src) => (src ? recordName(src) : 'unarmed');
  const flagsOf = (fl) => (fl && typeof fl === 'object' ? { blk: !!fl.blocked, pow: !!fl.power, bash: !!fl.bash, snk: !!fl.sneak, spell: !!fl.spell } : { blk: false, pow: false, bash: false, snk: false, spell: false });
  // A fight: per player (the first to swing) and counterpart
  const fightKey = (x, y) => (u32(x) < u32(y) ? `${u32(x)}|${u32(y)}` : `${u32(y)}|${u32(x)}`);
  const linkOf = (x, y, t0) => {
    for (const k of [pairKey(x, y), pairKey(y, x)]) {
      const r = S.recentPair.get(k);
      if (r && t0 - r.t <= C.fightLinkMs && t0 >= r.t) return { kind: r.kind === 'robbery' || r.kind === 'robbery_demand' || r.kind === 'capture' || r.kind === 'search' ? r.kind : 'robbery', by: u32(r.by) === u32(x) ? 'me' : 'them', t: r.t };
    }
    return undefined;
  };
  const partyLeader = (a) => { try { const f = globalThis.__dboPartyLeaderOf; return typeof f === 'function' ? f(a) : null; } catch (e) { return null; } };
  // A target downed or killed in the last 2 s: its killing blow's onHitDamage comes after onDeath (MpActor.cpp:812-817
  // kills inside NetSetPercentages, before ActionListener.cpp:3031 fires onHitDamage), so it opens no new fight (review C-R3)
  const justDied = (x, t) => { const d = S.deathSeen.get(u32(x)) || S.recentKills.get(u32(x)); return !!(d && t - d.t < 2000); };
  const fightOf = (agg, tgt, t, create) => {
    const k = fightKey(agg, tgt);
    let f = S.fights.get(k);
    if (f || !create || justDied(tgt, t)) return f;
    // the actor's side is a player: the one who swung, or the player being hit by an NPC; an owned NPC's fight with an NPC
    // has no player side and is no fight here (its kills are credited to the owner by onDeath)
    if (!online(agg) && !online(tgt)) return undefined;
    const me = online(agg) ? agg : tgt;
    const them = me === agg ? tgt : agg;
    const pvp = online(me) && online(them);
    // hp0 from the fast poll's last sample (at most 2 s old): an allowed attempt costs one get, the target's health
    const vm = S.vitals.get(u32(me));
    f = { k, me, them, pvp, t, from: t, to: t, dealt: { hits: 0, dmg: 0, by: new Set() }, taken: { hits: 0, dmg: 0, by: new Set() }, hp0: vm ? vm.health : undefined, hp1: undefined,
      att1me: undefined, att1them: undefined, t1me: undefined, t1them: undefined, refused: {}, kills: 0, outcome: 'ended', at: placeOf(me, false) };
    // the refused attempts counted before the first allowed hit join the fight
    for (const [kk, from] of [[pairKey(me, them), 'me'], [pairKey(them, me), 'them']]) {
      const r = S.refusedPair.get(kk);
      if (!r) continue;
      if (from === 'me') f.att1me = r.first; else f.att1them = r.first;
      for (const [why, n] of Object.entries(r.n)) f.refused[why] = (f.refused[why] || 0) + n;
      S.refusedPair.delete(kk);
    }
    if (pvp) {
      const la = partyLeader(me), lb = partyLeader(them);
      f.party = la !== null && la !== undefined && la === lb;
      f.link = linkOf(me, them, t);
    }
    put('fights', k, f);
    return f;
  };
  const closeFight = (f, outcome) => {
    S.fights.delete(f.k);
    if (outcome) f.outcome = outcome;
    // the refused attempts still counted for the pair
    for (const [kk] of [[pairKey(f.me, f.them)], [pairKey(f.them, f.me)]]) {
      const r = S.refusedPair.get(kk);
      if (!r) continue;
      for (const [why, n] of Object.entries(r.n)) f.refused[why] = (f.refused[why] || 0) + n;
      S.refusedPair.delete(kk);
    }
    const first = f.att1me !== undefined || f.att1them !== undefined
      ? ((f.att1me === undefined ? Infinity : f.att1me) <= (f.att1them === undefined ? Infinity : f.att1them) ? 'me' : 'them')
      : ((f.t1me === undefined ? Infinity : f.t1me) <= (f.t1them === undefined ? Infinity : f.t1them) ? 'me' : 'them');
    const side = (s) => ({ hits: s.hits, dmg: Math.round(s.dmg * 10) / 10, by: s.by.size ? [...s.by].slice(0, 8) : undefined });
    const other = partyOf(f.them, 'opponent');
    const vme = f.hp1 === undefined ? S.vitals.get(u32(f.me)) : null;
    emit('combat.fight', f.me, { dealt: side(f.dealt), taken: side(f.taken), hp0: f.hp0, hp1: f.hp1 !== undefined ? f.hp1 : vme ? vme.health : undefined, from: f.from, to: f.to, outcome: f.outcome,
      first, t1me: f.t1me, t1them: f.t1them, att1me: f.att1me, att1them: f.att1them, refused: Object.keys(f.refused).length ? f.refused : undefined,
      party: f.pvp ? !!f.party : undefined, pvp: f.pvp || undefined, kills: f.kills || undefined, link: f.link },
    { o: other ? [other] : undefined, at: f.at, p: f.pvp ? 0 : 1, nr: f.pvp ? undefined : false, t: f.to, src: 'hook:combat' });
  };
  const closeWindow = (k, w) => {
    S.windows.delete(k);
    emit('combat.damage', w.player, { dir: w.dir, src: w.src, hits: w.hits, dmg: Math.round(w.dmg * 10) / 10, eng: Math.round(w.eng * 10) / 10, blk: w.blk || undefined, pow: w.pow || undefined,
      bash: w.bash || undefined, snk: w.snk || undefined, hp0: w.hp0, hp1: w.hp1, maxHp: w.maxHp, from: w.from, to: w.to }, { o: [partyOf(w.counter, 'counterpart')], t: w.to, src: 'hook:combat' });
  };
  const addToWindow = (player, counter, src, dir, pts, eng, fl, hp0, hp1, maxHp, t) => {
    const k = `${player}|${counter}|${src}|${dir}`;
    let w = S.windows.get(k);
    if (!w) w = put('windows', k, { player, counter, src: srcName(src), dir, hits: 0, dmg: 0, eng: 0, blk: 0, pow: 0, bash: 0, snk: 0, hp0, hp1, maxHp, from: t, to: t });
    w.hits++; w.dmg += pts; w.eng += eng; w.to = t; w.hp1 = hp1;
    if (maxHp) w.maxHp = Math.round(maxHp);
    if (fl.blk) w.blk++; if (fl.pow) w.pow++; if (fl.bash) w.bash++; if (fl.snk) w.snk++;
    if (C.types && C.types['combat.hit'] === true) emit('combat.hit', player, { dir, src: w.src, dmg: pts, eng, hp0, hp1, flags: Object.keys(fl).filter((x) => fl[x]) }, { o: [partyOf(counter, 'counterpart')], t, src: 'hook:combat' });
  };
  const learnMax = (tgt, maxHp) => { if (maxHp > 0) { const v = S.vitals.get(tgt); if (v) v.maxHp = maxHp; } };
  const maxOf = (tgt, fl, eng, drop) => {
    const m = fl && Number(fl.targetMaxHealth);
    if (m > 0) { learnMax(tgt, m); return m; }
    const v = S.vitals.get(tgt);
    if (v && v.maxHp > 0) return v.maxHp;
    // damage / fraction, as downed.js:196-198 learns it
    if (drop > 0.0005 && eng > 0) return eng / drop;
    return 0;
  };
  // onHitDamageAttempt (outermost). Refused: a counter, nothing else. Allowed: the pending hit with hp0.
  const onAttempt = (agg, tgt, src, dmg, flags, verdict) => {
    const A = u32(agg), T = u32(tgt);
    if (A === T) return;
    const ap = S.online.has(A) || S.ownedNpcs.has(A), tp = S.online.has(T) || S.ownedNpcs.has(T);
    if (!ap && !tp) return;
    if (verdict === false) {
      const k = `${A}|${T}`;
      let r = S.refusedPair.get(k);
      if (!r) r = put('refusedPair', k, { t: now(), first: now(), n: {} });
      const why0 = globalThis.__dboHitRefusal;
      const why = typeof why0 === 'string' && REFUSAL_OK.has(why0) ? why0 : 'unknown';
      r.n[why] = (r.n[why] || 0) + 1;
      r.t = now();
      return;
    }
    const d = Number(dmg) || 0;
    if (d <= 0 && !(flags && typeof flags === 'object' && (flags.blocked || flags.power || flags.bash || flags.sneak))) return;
    const t = now();
    // an allowed attempt, blocked or not, explains what health the target loses next (a blocked hit never reaches onHitDamage)
    const vt = S.vitals.get(T); if (vt) vt.lastHit = t;
    put('pendingHits', `${A}|${T}`, { t, agg: A, tgt: T, src: u32(src), eng: d, flags: flagsOf(flags), max: flags && Number(flags.targetMaxHealth) > 0 ? Number(flags.targetMaxHealth) : 0, hp0: healthOf(T) });
    // the first attempt of each side opens the fight's clock
    const f = fightOf(A, T, t, true);
    if (f) { if (u32(f.me) === A) { if (f.att1me === undefined) f.att1me = t; } else if (f.att1them === undefined) f.att1them = t; }
  };
  // onHitDamage (outermost, after the inner chain): the points the target lost, into the window and the fight
  const onHit = (agg, tgt, src, dmg) => {
    const A = u32(agg), T = u32(tgt);
    const pend = S.pendingHits.get(`${A}|${T}`);
    if (!pend) return;
    S.pendingHits.delete(`${A}|${T}`);
    const t = now();
    const hp1 = healthOf(T);
    const drop = pend.hp0 !== undefined && hp1 !== undefined ? Math.max(0, pend.hp0 - hp1) : 0;
    const maxHp = maxOf(T, { targetMaxHealth: pend.max }, pend.eng, drop);
    const pts = maxHp > 0 ? drop * maxHp : (Number(dmg) || pend.eng);
    const v = S.vitals.get(T); if (v) { v.lastHit = t; v.health = hp1; }
    const f = fightOf(A, T, t, true);
    if (f) {
      f.to = t;
      const mine = u32(f.me) === A;
      const s = mine ? f.dealt : f.taken;
      s.hits++; s.dmg += pts; if (s.by.size < 8) s.by.add(srcName(pend.src));
      if (mine) { if (f.t1me === undefined) f.t1me = t; } else if (f.t1them === undefined) f.t1them = t;
      if (u32(f.me) === T) f.hp1 = hp1;
    }
    if (online(A)) addToWindow(A, T, pend.src, 'dealt', pts, pend.eng, pend.flags, pend.hp0, hp1, maxHp, t);
    if (online(T)) {
      addToWindow(T, A, pend.src, 'taken', pts, pend.eng, pend.flags, pend.hp0, hp1, maxHp, t);
      let lh = S.lastHits.get(T);
      if (!lh) lh = put('lastHits', T, { t, list: [] });
      lh.t = t;
      lh.list.push({ src: srcName(pend.src), dmg: Math.round(pts * 10) / 10, t, by: A });
      if (lh.list.length > 3) lh.list.shift();
    }
  };
  // The pending killing blow into the fight it ends, before the fight is closed (review C-R3): it took what health was left
  const countBlow = (f, pend, t) => {
    if (!f || !pend || pend.inFight) return;
    const T = u32(pend.tgt);
    const mine = u32(f.me) === u32(pend.agg);
    const s = mine ? f.dealt : f.taken;
    const left = pend.hp0 !== undefined ? Math.max(0, pend.hp0) : 0;
    const maxHp = maxOf(T, { targetMaxHealth: pend.max }, pend.eng, left);
    s.hits++; s.dmg += maxHp > 0 && left > 0 ? left * maxHp : pend.eng;
    if (s.by.size < 8) s.by.add(srcName(pend.src));
    if (mine) { if (f.t1me === undefined) f.t1me = t; } else if (f.t1them === undefined) f.t1them = t;
    f.to = t;
    if (u32(f.me) === T) f.hp1 = 0;
    pend.inFight = true;
  };
  const closeAllFor = (a, outcome) => {
    const x = u32(a);
    for (const f of [...S.fights.values()]) if (u32(f.me) === x || u32(f.them) === x) closeFight(f, outcome === 'logout' ? 'logout' : outcome);
    for (const [k, w] of [...S.windows]) if (u32(w.player) === x) closeWindow(k, w);
    closeContainer(x, outcome || 'logout');
    flushFoldsFor(x);
  };
  // onDeath (outermost, after the inner chain): a player's down, or a kill of an NPC by a player or what a player commands
  const onDeathTap = (victim, killer) => {
    const V = u32(victim), Kr = u32(killer);
    const t = now();
    if (online(V)) {
      const seen = S.deathSeen.get(V); if (seen && t - seen.t < 2000) return;
      put('deathSeen', V, { t });
      const pend = Kr ? S.pendingHits.get(`${Kr}|${V}`) : null;
      const lh = S.lastHits.get(V);
      const staff = S.deaths.get(V);
      let cause = Kr ? 'hit' : 'no_attacker';
      if (staff && t - staff.t < 15000) cause = staff.cause || cause;
      const at = placeOf(V, true);
      const l = S.loc.get(V);
      let dist;
      if (Kr) { const kl = S.loc.get(Kr); if (kl && l && kl.w === l.w && Array.isArray(kl.pos) && Array.isArray(l.pos)) dist = Math.round(Math.hypot(kl.pos[0] - l.pos[0], kl.pos[1] - l.pos[1], kl.pos[2] - l.pos[2])); }
      const lastHits = lh ? lh.list.slice(-3).map((h) => { const pp = isPlayer(h.by) ? idOf(h.by) : null; return { src: h.src, dmg: h.dmg, t: h.t, p: pp ? pp.p : undefined, c: pp ? pp.c || undefined : undefined, npc: pp ? undefined : (npcParty(h.by, 'x') || {}).npc }; }) : undefined;
      emit('combat.down', V, { cause, src: pend ? srcName(pend.src) : undefined, dmg: pend ? pend.eng : undefined, dist, lastHits }, { o: Kr ? [partyOf(Kr, 'by')] : staff && staff.by ? [partyOf(staff.by, 'by')] : undefined, at, src: 'hook:onDeath' });
      if (pend) countBlow(S.fights.get(fightKey(Kr, V)), pend, t);
      for (const f of [...S.fights.values()]) if (u32(f.me) === V || u32(f.them) === V) { if (u32(f.me) === V) f.hp1 = 0; closeFight(f, 'downed'); }
      suppress(V, t);
      if (C.snapshots.down) setTimeout(guard('down.snapshot', () => snapshot(V, 'down')), 0);
      S.lastHits.delete(V);
      return;
    }
    // an NPC: credited to the player who killed it, or to the player whose companion, summon or warband NPC did
    let killerPlayer = online(Kr) ? Kr : 0, byCompanion = false;
    // NPC against NPC: Set lookups only
    if (!killerPlayer && !S.ownedNpcs.has(Kr) && !S.ownedNpcs.has(V)) return;
    if (!killerPlayer && Kr && S.ownedNpcs.has(Kr)) { const own = npcParty(Kr, 'x').owner; if (own && own.p !== undefined) { const on = byProfileTag(own.p, own.c || ''); if (on) { killerPlayer = on; byCompanion = true; } } }
    const victimInfo = npcParty(V, 'victim');
    if (!killerPlayer && !(victimInfo && victimInfo.owner)) return;
    put('recentKills', V, { t });
    const pend = Kr ? S.pendingHits.get(`${Kr}|${V}`) : null;
    const f = killerPlayer ? S.fights.get(fightKey(killerPlayer, byCompanion ? Kr : V)) || S.fights.get(fightKey(killerPlayer, V)) : null;
    if (f) { if (pend && !byCompanion) countBlow(f, pend, t); f.kills++; closeFight(f, 'killed'); }
    const champion = (() => { const n = S.npcInfo.get(V); return n ? n.champion : false; })();
    const actor = killerPlayer || 0;
    const vic = { npc: victimInfo.npc, base: victimInfo.base, kind: victimInfo.kind, owner: victimInfo.owner };
    const o = [];
    if (victimInfo.owner && victimInfo.owner.p !== undefined) o.push(Object.assign({ r: 'owner' }, victimInfo.owner, { why: undefined }));
    if (actor) emit('combat.kill', actor, { victim: vic, champion: champion || undefined, src: pend ? srcName(pend.src) : undefined, byCompanion: byCompanion || undefined }, { o: o.length ? o : undefined, src: 'hook:onDeath' });
    else if (victimInfo.owner) {
      // a player's companion killed by someone who is not a player: on the owner's post
      const on = byProfileTag(victimInfo.owner.p, victimInfo.owner.c || '');
      if (on) emit('combat.kill', on, { victim: vic, src: pend ? srcName(pend.src) : undefined }, { o: Kr ? [partyOf(Kr, 'by')] : undefined, src: 'hook:onDeath' });
    }
  };

  // =============================================================================================================================
  // Folds (casts, equipment, harvest, food, companion commands, player menu): one record per actor per window
  // =============================================================================================================================
  const FOLDS = { castFold: 60000, harvestFold: 60000, foodFold: 60000, equipFold: C.equipFoldMs };
  const foldAdd = (kind, a, key, n, extra) => {
    const map = kind === 'companionCmd' || kind === 'pmenu' ? 'castFold' : kind;
    const x = u32(a);
    const fk = `${kind}|${x}`;
    let f = S[map].get(fk);
    if (!f) f = put(map, fk, { kind, a: x, t: now(), m: new Map(), extra: extra || null });
    const cur = f.m.get(key);
    if (cur) cur.n += n || 1; else if (f.m.size < 30) f.m.set(key, { n: n || 1, extra });
    return f;
  };
  const flushFold = (map, fk, f) => {
    S[map].delete(fk);
    const t = now();
    if (f.kind === 'castFold') emit('combat.cast', f.a, { spells: [...f.m].map(([s, v]) => ({ s, n: v.n })).slice(0, 20), windowSec: Math.round((t - f.t) / 1000) }, { src: 'hook:onSpellCast' });
    else if (f.kind === 'harvestFold') for (const [k, v] of f.m) emit('item.harvest', f.a, { item: v.extra ? v.extra.item : { i: k }, k: v.n }, { src: 'hook:onActivate' });
    else if (f.kind === 'foodFold') for (const [k, v] of f.m) emit('item.consume', f.a, { item: v.extra.item, kind: v.extra.kind }, { src: 'hook:onEatItem', p: 2 });
    else if (f.kind === 'companionCmd') emit('social.companion', f.a, { op: 'command', kind: [...f.m.keys()].join('+').slice(0, 40) }, { src: 'packet' });
    else if (f.kind === 'pmenu') for (const [k, v] of f.m) emit('social.player_menu', f.a, { action: k }, { o: v.extra && v.extra.t ? [partyOf(v.extra.t, 'target')] : undefined, src: 'hook:pmenu' });
    else if (f.kind === 'equipFold') {
      const on = [...f.m].filter(([, v]) => v.extra === 'on').map(([k]) => itemOf(parseInt(k.slice(3), 16), 1));
      const off = [...f.m].filter(([, v]) => v.extra === 'off').map(([k]) => itemOf(parseInt(k.slice(4), 16), 1));
      if (on.length || off.length) emit('item.equip', f.a, { on: on.length ? on : undefined, off: off.length ? off : undefined }, { src: 'hook:equip' });
    }
  };
  const flushFoldsFor = (x) => {
    for (const map of Object.keys(FOLDS)) for (const [fk, f] of [...S[map]]) if (f.a === x) flushFold(map, fk, f);
    for (const [k, f] of [...S.cmdInfoFold]) if (f.a === x) { S.cmdInfoFold.delete(k); emit('cmd.info', f.a, { name: f.name, n: f.n }, { src: 'cmd' }); }
  };
  const foldTick = (t, deadline) => {
    const over = overAt(deadline || closeDeadline());
    for (const map of Object.keys(FOLDS)) {
      for (const [fk, f] of S[map]) {
        if (over()) return;
        const span = f.kind === 'equipFold' ? C.equipFoldMs : (f.kind === 'companionCmd' || f.kind === 'pmenu') ? 60000 : FOLDS[map];
        if (t - f.t >= span) flushFold(map, fk, f);
      }
    }
  };
  const suppress = (a, t) => put('suppress', u32(a), { t: t || now(), until: (t || now()) + C.healthLoss.suppressMs });

  // =============================================================================================================================
  // Engine slots (DESIGN.md 2.2.4): outermost wrappers, the inner verdict unchanged
  // =============================================================================================================================
  // wrap(slot, after): after(args, verdict) runs inside the guard; an inner that throws is re-thrown as it was
  const wrap = (holder, key, after, before) => {
    K.wrapSlot(holder, key, (inner) => function plogWrapper(...args) {
      let pre;
      // capture off (the STOP file, the breaker): no pre-read either, so off means no work (safety review R1)
      if (before && S.on) { try { pre = before(args); } catch (e) { err(`slot:${key}:pre`.slice(0, 40), e); } }
      const verdict = inner ? inner.apply(this, args) : undefined;
      if (S.on) { try { after(args, verdict, pre); } catch (e) { err(`slot:${key}`.slice(0, 40), e); } }
      return verdict;
    });
    slots++;
  };
  const ITEM_TYPES = new Set(['WEAP', 'ARMO', 'MISC', 'INGR', 'ALCH', 'BOOK', 'AMMO', 'KEYM', 'SLGM', 'SCRL', 'LIGH']);
  // onTakeItem / onPutItem: the verdict and the container session context; the moved counts come from the seam
  const containerVerdict = (container, actor, verdict) => {
    const a = u32(actor), c = u32(container);
    if (!online(a)) return;
    const s = openContainer(a, c, now());
    if (verdict === false) s.refused++;
  };
  wrap('mp', 'onTakeItem', ([container, actor], verdict) => containerVerdict(container, actor, verdict));
  // itemguards' mode off: no seam, so the put and take diffs are read here (before and after the move)
  const seamOff = !(mp.onPutItem && mp.onPutItem.__dboGuard) && !(mp.onPutItem && mp.onPutItem.__dboPlogInner && mp.onPutItem.__dboPlogInner.__dboGuard);
  const ownDiff = (kind) => (args) => { const [container, actor, baseId] = args; if (!online(actor)) return null; return [countIn(entriesOf(actor), baseId), countIn(entriesOf(container), baseId)]; };
  const ownDiffAfter = (kind) => (args, verdict, before) => {
    const [container, actor, baseId, count] = args;
    containerVerdict(container, actor, verdict);
    if (!seamOff || !before || verdict === false) return;
    setTimeout(guard('seam.own', () => {
      const after = [countIn(entriesOf(actor), baseId), countIn(entriesOf(container), baseId)];
      G.hooks.move(kind, actor, container, baseId, count, before, after, null, null);
    }), 0);
  };
  wrap('mp', 'onPutItem', ownDiffAfter('put'), seamOff ? ownDiff('put') : null);
  if (seamOff) {
    // the take side as well, in a wrapper of its own over gamemode's takeHook
    K.wrapSlot('mp', 'onTakeItem', (inner) => function plogTake(...args) {
      let before = null;
      if (S.on) { try { before = ownDiff('take')(args); } catch (e) { err('slot:onTakeItem:pre', e); } }
      const verdict = inner ? inner.apply(this, args) : undefined;
      if (S.on) { try { ownDiffAfter('take')(args, verdict, before); } catch (e) { err('slot:onTakeItem', e); } }
      return verdict;
    });
  }
  wrap('mp', 'onDropItem', ([actor, baseId, count], verdict, before) => {
    const a = u32(actor);
    if (!online(a) || verdict === false) return;
    setTimeout(guard('drop.diff', () => {
      const after = countIn(entriesOf(a), baseId);
      const n = before !== null && before !== undefined ? before - after : Number(count) || 0;
      if (n <= 0) return;
      const l = S.loc.get(a);
      put('drops', `${u32(baseId)}|${l ? l.w : ''}`, { by: a, t: now() });
      emit('item.drop', a, { item: itemOf(baseId, n) }, { src: 'hook:onDropItem' });
    }), 0);
  }, ([actor, baseId]) => (online(actor) ? countIn(entriesOf(actor), baseId) : null));
  // onActivate: container sessions, refused access on owned property, doors into claimed property, pickups and harvests
  // One line per (actor, ref) per accessDedupeMs, with the number of attempts, written when the window ends
  const accessLine = (k, d) => { S.accessDedupe.delete(k); emit('item.access_refused', d.a, { ref: hex(d.ref), kind: d.kind, own: d.own, why: d.why, n: d.n }, { o: d.o, at: d.at, t: d.t, src: 'hook:onActivate', q: 'inferred' }); };
  const accessDedupe = (a, ref, kind, own, why, o) => {
    const k = `${a}|${ref}`;
    const t = now();
    const d = S.accessDedupe.get(k);
    if (d && t - d.t0 < C.accessDedupeMs) { d.n++; d.t = t; return; }
    if (d) accessLine(k, d);
    put('accessDedupe', k, { a, ref, t0: t, t, n: 1, kind, own, why, o, at: placeOf(a, false) });
  };
  const refusalWhy = (ref, ow) => {
    if (ow.own === 'treasury') return 'treasury';
    if (ow.own === 'renter') return 'rented';
    const h = housingRecord(ref);
    if (h && h.rec && h.rec.locked) return 'locked';
    if (ow.own === 'owner' || ow.own === 'assignee' || ow.own === 'household') return 'not_yours';
    return 'unknown';
  };
  wrap('mp', 'onActivate', ([target, caster], verdict, pre) => {
    const t = u32(target), a = u32(caster);
    if (!online(a) || !pre) return;
    const type = pre.type;
    if (type === 'CONT') {
      if (verdict === false) {
        const ow = ownershipOf(t, a);
        if (ow.own !== 'self' && ow.own !== 'public') accessDedupe(a, t, 'container', ow.own, refusalWhy(t, ow), ow.o);
        return;
      }
      const cur = S.containers.get(a);
      // a second activation of the open container closes it (the engine toggles)
      if (cur && cur.ref === t && now() - cur.t0 > 500) { closeContainer(a, 'toggle'); return; }
      openContainer(a, t, now());
      return;
    }
    if (type === 'DOOR') {
      const ow = placeOwnership(housingRecord(t), a);
      if (!ow || ow.own === 'self') return;
      if (verdict === false) { accessDedupe(a, t, 'door', ow.own, refusalWhy(t, ow), ow.o); return; }
      const k = `${a}|${t}`;
      const last = S.doorDedupe.get(k);
      if (last && now() - last.t < 60000) return;
      put('doorDedupe', k, { t: now() });
      const access = accessOf(t, a, ow);
      emit('move.door', a, { door: hex(t), allowed: true, own: ow.own, access }, { o: ow.o, p: ow.own === 'household' && access !== 'lockpick' && access !== 'unknown' ? 1 : 0, src: 'hook:onActivate', q: 'inferred' });
      return;
    }
    if (verdict === false) return;
    // a pickup of a world item, or a harvest: confirmed by a pack diff a tick later (which also gives the extras)
    if (ITEM_TYPES.has(type) || type === 'FLOR' || type === 'TREE') {
      const base = pre.base;
      setTimeout(guard('pickup.diff', () => {
        const entries = entriesOf(a);
        // a harvest gives its produce, not the flora: whatever grew in the pack
        if (type === 'FLOR' || type === 'TREE') {
          const now1 = new Map();
          for (const e of entries) if (e) now1.set(u32(e.baseId), (now1.get(u32(e.baseId)) || 0) + (Number(e.count) || 0));
          for (const [b, n1] of now1) { const n = n1 - (pre.counts.get(b) || 0); if (n > 0 && b !== GOLD) foldAdd('harvestFold', a, recordName(b), n, { item: itemOf(b, 1) }); }
          return;
        }
        const n = countIn(entries, base) - pre.count;
        if (n <= 0) return;
        const l = S.loc.get(a);
        const drop = S.drops.get(`${base}|${l ? l.w : ''}`);
        const e = entries.find((x) => x && u32(x.baseId) === base && Object.keys(x).some((k) => k !== 'baseId' && k !== 'count'));
        const o = drop && drop.by !== a && now() - drop.t < 120000 ? [partyOf(drop.by, 'dropper')] : undefined;
        emit('item.pickup', a, { item: itemOf(base, n, e), ref: hex(t) }, { o, src: 'hook:onActivate' });
      }), 0);
    }
  }, ([target, caster]) => {
    // before the chain: the target's record type, and for an item the count already held
    const a = u32(caster);
    if (!online(a)) return null;
    const base = baseOfRef(target);
    if (!base) return null;
    const type = recordType(base);
    if (!type) return null;
    if (type === 'CONT' || type === 'DOOR') return { type, base };
    if (type === 'FLOR' || type === 'TREE') {
      const counts = new Map();
      for (const e of entriesOf(a)) if (e) counts.set(u32(e.baseId), (counts.get(u32(e.baseId)) || 0) + (Number(e.count) || 0));
      return { type, base: 0, counts };
    }
    if (ITEM_TYPES.has(type)) return { type, base, count: countIn(entriesOf(a), base) };
    return null;
  });
  // onEatItem: the item is gone whatever the verdict (MpActor.cpp:618-620)
  const CONSUME_KIND = (base) => {
    const type = recordType(base);
    if (type === 'INGR') return 'ingredient';
    if (type === 'SCRL') return 'scroll';
    if (type !== 'ALCH') return 'other';
    const n = recordName(base).toLowerCase();
    if (/poison/.test(n)) return 'poison';
    if (/potion|draught|elixir|philter|tincture/.test(n)) return 'potion';
    if (/mead|ale|wine|milk|water|tea|brandy|rum|juice|beer/.test(n)) return 'drink';
    return 'food';
  };
  wrap('mp', 'onEatItem', ([actor, baseId]) => {
    const a = u32(actor);
    if (!online(a)) return;
    const kind = CONSUME_KIND(baseId);
    suppress(a);
    if (kind === 'potion' || kind === 'poison') { emit('item.consume', a, { item: itemOf(baseId, 1), kind }, { src: 'hook:onEatItem', p: 1 }); return; }
    foldAdd('foodFold', a, `${u32(baseId)}`, 1, { item: itemOf(baseId, 1), kind });
  });
  // onCraft: the product from the args, the inputs from the recipe (COBJ), the fuel from a pack diff a tick later
  const cobjInputs = (recipeId) => {
    const out = [];
    try {
      const r = mp.lookupEspmRecordById(u32(recipeId));
      for (const f of ((r && r.record && r.record.fields) || [])) {
        if (f.type !== 'CNTO' || !(f.data instanceof Uint8Array) || f.data.byteLength < 8) continue;
        const dv = new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength);
        let id = dv.getUint32(0, true); const n = dv.getInt32(4, true);
        try { if (typeof r.toGlobalRecordId === 'function') id = r.toGlobalRecordId(id) >>> 0; } catch (e) { /* local id */ }
        out.push(itemOf(id, n));
        if (out.length >= 20) break;
      }
    } catch (e) { /* no record */ }
    return out.length ? out : undefined;
  };
  wrap('mp', 'onCraft', ([actor, itemId, count, recipeId], verdict) => {
    const a = u32(actor);
    if (!online(a) || verdict === false) return;
    emit('item.craft', a, { product: itemOf(itemId, Number(count) || 1), k: Number(count) || 1, inputs: cobjInputs(recipeId) }, { src: 'hook:onCraft' });
  });
  // onUpdateEquipmentAttempt: the worn set in the args, diffed with the last one (no get), folded 3 s; the login burst and a
  // beast form are skipped
  const wornSet = (equipment) => { const entries = equipment && equipment.inv && Array.isArray(equipment.inv.entries) ? equipment.inv.entries : []; const s = new Set(); for (const e of entries) if (e && (e.worn || e.wornLeft)) s.add(u32(e.baseId).toString(16)); return s; };
  wrap('mp', 'onUpdateEquipmentAttempt', ([actor, equipment, isAllowed], verdict) => {
    const a = u32(actor);
    if (!online(a) || verdict === false || isAllowed === false) return;
    const set = wornSet(equipment);
    const t = now();
    const w = S.worn.get(a);
    const sess = S.sessions.get(a);
    if (!w || !w.set || (sess && t - sess.t < C.loginEquipSkipMs) || beastOf(a)) { put('worn', a, { t, set }); return; }
    suppress(a, t);
    for (const b of set) if (!w.set.has(b)) foldAdd('equipFold', a, `on:${b}`, 1, 'on');
    for (const b of w.set) if (!set.has(b)) foldAdd('equipFold', a, `off:${b}`, 1, 'off');
    w.set = set; w.t = t;
  });
  const beastOf = (a) => { const b = get(u32(a), 'private.beast'); return !!(b && b.form); };
  // onSpellCast: per-minute counts, a scroll read, the heal channel
  wrap('mp', 'onSpellCast', ([caster, spellId], verdict) => {
    const a = u32(caster);
    if (!online(a) || verdict === false) return;
    foldAdd('castFold', a, recordName(spellId), 1);
    put('healChannels', a, { t: now(), spell: u32(spellId) });
  });
  // onSpellHit: heals on others (health re-read a tick later) and zero-damage effects
  wrap('mp', 'onSpellHit', ([aggressor, target, spellId], verdict) => {
    const A = u32(aggressor), T = u32(target);
    if (verdict === false || A === T || !online(T)) return;
    const ch = S.healChannels.get(A);
    if (!ch || now() - ch.t > 10000) return;
    const h0 = healthOf(T);
    setTimeout(guard('heal.diff', () => {
      const h1 = healthOf(T);
      if (h0 === undefined || h1 === undefined || h1 <= h0) return;
      suppress(T);
      emit('combat.heal', T, { src: recordName(spellId), hpGain: Math.round((h1 - h0) * 1000) / 10, windowSec: 0 }, { o: online(A) ? [partyOf(A, 'by')] : undefined, src: 'hook:onSpellHit', q: 'inferred' });
    }), 0);
  });
  // onHitDamageAttempt: the refusal reason is set by the gameplay just before each "return false" (A2)
  wrap('mp', 'onHitDamageAttempt', ([agg, tgt, src, dmg, flags], verdict) => { onAttempt(agg, tgt, src, dmg, flags, verdict); globalThis.__dboHitRefusal = null; },
    () => { globalThis.__dboHitRefusal = null; return null; });
  wrap('mp', 'onHitDamage', ([agg, tgt, src, dmg]) => onHit(agg, tgt, src, dmg));
  wrap('mp', 'onDeath', ([victim, killer]) => onDeathTap(victim, killer));
  // onConsoleCommand: the console audit line has the verb; this keeps a staff AddItem on a player for the grant
  wrap('mp', 'onConsoleCommand', ([actor, command, ...args], verdict) => {
    const a = u32(actor);
    if (!online(a) || verdict === false) return;
    if (String(command || '').toLowerCase() !== 'additem') return;
    const ref = u32(args[0]);
    if (ref && ref !== a && isPlayer(ref)) put('pickupWatch', `grant|${ref}|${u32(args[1])}`, { t: now(), by: a, k: Number(args[2]) || 1 });
  });
  // The fork's trade summary (journalstats.js chains it): both offer lists by count and base id, never the names in quotes
  K.wrapSlot('g', '__alduinakTradeLog', (inner) => function plogTrade(summary, ...rest) {
    const out = inner ? inner.call(this, summary, ...rest) : undefined;
    if (S.on) {
      try {
        const tr = R.parseTradeSummary(summary);
        if (tr && tr.a.actor !== tr.b.actor) {
          const items = (list) => list.map((x) => itemOf(x.base, x.k, x.extras)).slice(0, 60);
          emit('item.trade', tr.a.actor, { gave: items(tr.gave), got: items(tr.got) }, { o: [partyOf(tr.b.actor, 'other')], src: 'hook:trade' });
        }
      } catch (e) { err('slot:trade', e); }
    }
    return out;
  });
  slots++;
  // alchemy.js soul capture: the soul size into a gem
  K.wrapSlot('g', '__dboSoulCaptured', (inner) => function plogSoul(caster, target, size, ...rest) {
    const out = inner ? inner.call(this, caster, target, size, ...rest) : undefined;
    if (S.on) { try { const a = u32(caster); if (online(a)) emit('item.extras', a, { kind: 'soul', soul: Number(size) || undefined }, { o: isPlayer(target) ? [partyOf(target, 'target')] : undefined, src: 'hook:soul' }); } catch (e) { err('slot:soul', e); } }
    return out;
  });
  slots++;
  // Slots nobody resets (the marker rule keeps one original; uninstall puts it back)
  wrap('mp', 'onRespawn', ([actor], verdict) => {
    const a = u32(actor);
    if (!online(a) || verdict === false) return;
    suppress(a);
    const said = S.recentPair.get(`${a}|wake`);
    if (said && now() - said.t < 10000) return;
    emit('combat.wake', a, { how: 'bled_out' }, { src: 'hook:onRespawn', q: 'inferred' });
  });
  // OnItemAdded: the first thing it does is return unless the actor is online; it never returns false
  K.wrapSlot('mp', 'onPapyrusEvent:OnItemAdded', (inner) => function plogItemAdded(...args) {
    try {
      const a = u32(args[0]);
      if (S.on && S.online.has(a)) {
        const b = args[1] && typeof args[1] === 'object' && typeof args[1].desc === 'string' ? (() => { try { return mp.getIdFromDesc(args[1].desc) >>> 0; } catch (e) { return 0; } })() : 0;
        const g = b ? S.pickupWatch.get(`grant|${a}|${b}`) : null;
        if (g && now() - g.t < 5000) { S.pickupWatch.delete(`grant|${a}|${b}`); emit('item.grant', a, { items: [itemOf(b, Number(args[2]) || g.k)], via: 'console' }, { o: [partyOf(g.by, 'staff')], src: 'hook:OnItemAdded' }); }
      }
    } catch (e) { err('slot:OnItemAdded', e); }
    return inner ? inner.apply(this, args) : undefined;
  });
  slots++;
  // SkympOnActivateClose: closes a container session only when the ref matches one; labour.js's synthetic closes (one
  // argument, a chopping block) match none and pass through untouched
  K.wrapSlot('mp', 'onPapyrusEvent:SkympOnActivateClose', (inner) => function plogClose(...args) {
    try {
      if (S.on) {
        const ref = u32(args[0]);
        const who = args[1] && typeof args[1] === 'object' && typeof args[1].desc === 'string' ? (() => { try { return mp.getIdFromDesc(args[1].desc) >>> 0; } catch (e) { return 0; } })() : 0;
        for (const [a, s] of [...S.containers]) if (s.ref === ref && (!who || who === a)) closeContainer(a, 'close');
      }
    } catch (e) { err('slot:ActivateClose', e); }
    return inner ? inner.apply(this, args) : undefined;
  });
  slots++;

  // =============================================================================================================================
  // Polls (DESIGN.md 2.2.6)
  // =============================================================================================================================
  // Fast (2 s): close windows and idle fights; vitals -> unexplained health loss; restraint diff -> captures; the reselect
  // check; container idle; search timeouts; panel actions with no server line
  const RESTRAINT_OP = (r) => (r.carried ? 'carried' : r.rope ? 'roped' : r.boundHands ? 'cuffed' : 'restrained');
  const healthLoss = (a, before, after, t) => {
    const pct = Math.round((before - after) * 1000) / 10;
    if (pct < C.healthLoss.minPct) return;
    const v = S.vitals.get(a);
    if (v && v.lastHit && t - v.lastHit < C.healthLoss.noHitMs) return;
    const sup = S.suppress.get(a);
    if (sup && t < sup.until) return;
    if (S.deaths.has(a) || S.deathSeen.has(a)) return;
    // vampires outdoors by day are skipped until the A2 sun hook says when the sun burns (sunPerStage 1.2%/10 s at stage 2)
    if (!G.sunLive) { const sp = get(a, 'private.supernatural'); const l = S.loc.get(a); if (sp && sp.kind === 'vampire' && l && typeof api.isWorldspace === 'function' && api.isWorldspace(l.w)) return; }
    let m = S.hpLossMerge.get(a);
    if (!m) {
      // the fall classifier: one pos read on a qualifying drop, against the location poll's last sample
      const p = get(a, 'pos'); const l = S.loc.get(a);
      const dz = Array.isArray(p) && l && Array.isArray(l.pos) ? Math.round(l.pos[2] - p[2]) : 0;
      m = put('hpLossMerge', a, { t, pct: 0, merged: 0, dz, cause: dz > C.polls.fallDz ? 'fall_likely' : 'dot_or_environment' });
    }
    m.pct += pct; m.merged++;
  };
  // the first fast poll after a resync records health and restraints without reading them as a loss or a capture
  let seedQuiet = false;
  // The closing loops (safety review R3). They share one deadline a tick and stop at it; what is left is still due at the next
  // tick (a Map keeps its order, so the oldest go first, and deleting the entry in hand while iterating is safe). The loop that
  // goes first turns over each tick, so none waits behind a busy one. Refused attempts that never became a fight close here,
  // not once a minute: at the minute's pace a time box could not keep up with a beam on many targets, and a map at its cap
  // drops its oldest entry unwritten.
  const CLOSERS = [
    // windows are made in time order and never moved, so the first one not yet due ends the loop
    (t, over) => { for (const [k, w] of S.windows) { if (t - w.from < C.windowMs || over()) return; closeWindow(k, w); } },
    (t, over) => { for (const f of S.fights.values()) { if (over()) return; if (t - f.to >= C.fightIdleMs) closeFight(f, f.outcome === 'ended' ? 'ended' : f.outcome); } },
    (t, over) => { for (const [a, s] of S.containers) { if (over()) return; if (t - s.t >= C.containerIdleMs) closeContainer(a, 'idle'); } },
    (t, over) => { for (const [a, m] of S.hpLossMerge) { if (over()) return; if (t - m.t >= C.healthLoss.mergeMs) { S.hpLossMerge.delete(a); emit('combat.health_loss', a, { pct: Math.round(m.pct * 10) / 10, cause: m.cause, dz: m.dz, merged: m.merged }, { src: 'poll:vitals', q: 'inferred' }); } } },
    (t, over) => { for (const [a, r] of S.searches) { if (over()) return; if (!r.answered && t - r.t >= 60000) { S.searches.delete(a); emit('law.search', a, { op: 'timeout' }, { o: [partyOf(r.target, 'searched')], src: 'poll' }); } } },
    // refused attempts that never became a fight (a god-moded target, a body that cannot be harmed): a disk record
    (t, over) => {
      for (const [k, r] of S.refusedPair) {
        if (over()) return;
        if (t - r.t < 60000) continue;
        S.refusedPair.delete(k);
        const [A, T] = k.split('|').map(Number);
        const who = online(A) ? A : online(T) ? T : 0;
        if (!who) continue;
        for (const [reason, cnt] of Object.entries(r.n)) emit('combat.refused', who, { reason, n: cnt, windowSec: Math.round((r.t - r.first) / 1000) }, { o: [partyOf(who === A ? T : A, who === A ? 'target' : 'attacker')], t: r.t, src: 'hook:combat' });
      }
    },
  ];
  let closerTurn = 0;
  const overAt = (end) => { let n = 0; return () => ((++n & 7) === 0 && K.perf() > end); };
  // The per-player reads first, then the closing loops with what is left of the tick's budget, so a tick with everything
  // due still ends near closeBudgetMs and not past it
  const fastTick = (deadline) => {
    if (!S.on) return;
    const end = deadline || closeDeadline();
    const t = now();
    for (const [userId, m] of [...S.menuLeft]) {
      if (!m.armed) continue;
      const a = actorOf(userId);
      if (a && a === m.a && !online(a)) { S.menuLeft.delete(userId); login(userId, a, true); }
      else if (t - m.t > 30000) S.menuLeft.delete(userId);
    }
    flushPanelPending(t, false);
    const quiet = seedQuiet;
    seedQuiet = false;
    for (const a of S.online) {
      const p = get(a, 'percentages');
      const h = p && Number.isFinite(Number(p.health)) ? Number(p.health) : undefined;
      let v = S.vitals.get(a);
      if (!v) v = put('vitals', a, { t, health: h, maxHp: 0, lastHit: 0 });
      else { if (h !== undefined && v.health !== undefined && h < v.health) healthLoss(a, v.health, h, t); v.health = h; v.t = t; }
      const r = get(a, 'private.restrained');
      const on = !!(r && (r.boundHands || r.carried));
      const was = S.restrained.get(a);
      if (quiet) { if (on) put('restrained', a, { t, op: RESTRAINT_OP(r), by: u32(r.captorActorId) }); continue; }
      if (on && (!was || was.op !== RESTRAINT_OP(r))) {
        const by = u32(r.captorActorId);
        put('restrained', a, { t, op: RESTRAINT_OP(r), by });
        if (by) put('recentPair', pairKey(by, a), { kind: 'capture', by, t });
        emit('combat.capture', a, { op: RESTRAINT_OP(r) }, { o: by && isPlayer(by) ? [partyOf(by, 'captor')] : undefined, src: 'poll:restraint' });
      } else if (!on && was) {
        S.restrained.delete(a);
        emit('combat.capture', a, { op: 'released' }, { o: was.by && isPlayer(was.by) ? [partyOf(was.by, 'captor')] : undefined, src: 'poll:restraint', q: 'inferred' });
      }
    }
    const over = overAt(end);
    for (let i = 0; i < CLOSERS.length; i++) CLOSERS[(closerTurn + i) % CLOSERS.length](t, over);
    closerTurn = (closerTurn + 1) % CLOSERS.length;
  };
  // Location (5 s): two gets per player, nothing else; the zone from those two reads, recomputed only on a cell change or
  // a move of zoneMoveUnits
  const zoneFrom = (w, pos, last) => {
    let z = null;
    try {
      if (typeof api.isWorldspace === 'function' && api.isWorldspace(w)) z = typeof api.zoneAtPlace === 'function' ? api.zoneAtPlace(w, pos) : null;
      else z = typeof api.zoneOfCell === 'function' ? api.zoneOfCell(w) : null;
      if (!z && api.REGION_PLUGINS && typeof api.normPlace === 'function') z = api.REGION_PLUGINS[String(api.normPlace(w)).split(':')[1]] || null;
      if (!z && last && last.outW && typeof api.zoneAtPlace === 'function') z = api.zoneAtPlace(last.outW, last.outPos);
    } catch (e) { z = null; }
    return z || undefined;
  };
  // A cell of a place someone owns, from the cell -> root map that door and chest uses fill (review C-R10: recordOf(actor)
  // answers null, housingSystem.ts isClaimable takes doors and containers only). A place nobody has touched since this load
  // is not known yet (B4's placeOfCell is exact); the root is read again here, so a map entry never outlives the place.
  const claimedInterior = (a, w) => {
    const H = housing();
    if (!H || typeof H.recordOf !== 'function') return null;
    const pc = S.placeCells.get(String(w));
    if (!pc) return null;
    try {
      const rec = H.recordOf(pc.root);
      if (!rec || !(Number(rec.owner) > 0) || !rec.place || !Array.isArray(rec.place.cells) || !rec.place.cells.includes(String(w))) { S.placeCells.delete(String(w)); return null; }
      if (typeof H.ownsRecord === 'function' && H.ownsRecord(rec, a)) return null;
      return { rec, root: pc.root };
    } catch (e) { return null; }
  };
  const locationTick = () => {
    if (!S.on) return;
    const t = now();
    for (const a of S.online) {
      const w0 = get(a, 'worldOrCellDesc'); const pos = get(a, 'pos');
      if (!w0 || !Array.isArray(pos)) continue;
      const w = String(w0);
      const l = S.loc.get(a);
      if (!l) { put('loc', a, { w, pos, t, zone: zoneFrom(w, pos, null), zpos: pos, outW: null, outPos: null }); continue; }
      const outdoors = typeof api.isWorldspace === 'function' && api.isWorldspace(w);
      const jump = l.w === w ? Math.hypot(pos[0] - l.pos[0], pos[1] - l.pos[1], pos[2] - l.pos[2]) : Infinity;
      const tr = S.travel.get(a);
      // a run, a mount or a beast covers ground between samples: a jump with no reason counts only past what 1,500 u/s
      // (over the fastest sustained peaks the movement validator logs) covers in the time since the last sample
      const reach = Math.max(Number(C.polls.teleportUnits) || 3000, (Number(C.polls.teleportSpeed) || 1500) * Math.max(0, t - (Number(l.t) || t)) / 1000);
      if (tr && t - tr.t <= 10000 && (l.w !== w || jump > C.polls.teleportUnits)) {
        S.travel.delete(a);
        emit('move.teleport', a, { reason: R.EVENT_TYPES['move.teleport'].f.reason.e.has(tr.reason) ? tr.reason : 'unknown', dist: Number.isFinite(jump) ? Math.round(jump) : undefined },
          { o: tr.by && tr.by !== a && isPlayer(tr.by) ? [partyOf(tr.by, 'by')] : undefined, src: 'poll:location' });
      } else if (l.w === w && jump > reach) {
        emit('move.teleport', a, { reason: 'unknown', dist: Math.round(jump) }, { src: 'poll:location', q: 'inferred' });
      }
      if (l.w !== w) {
        const from = { w: l.w, cell: cellName(l.w), zone: l.zone };
        const prevLoc = Object.assign({}, l);
        l.w = w; l.pos = pos; l.t = t;
        l.zone = zoneFrom(w, pos, prevLoc); l.zpos = pos;
        const to = { w, cell: cellName(w), zone: l.zone };
        const ci = !outdoors ? claimedInterior(a, w) : null;
        if (ci) {
          const ow = { own: 'owner', o: [ownerPartyOf(ci.rec.owner, ci.rec.ownerChar, 'owner')].filter(Boolean), rec: ci.rec };
          emit('move.cell', a, { from, to, own: 'owner', access: accessOf(ci.root, a, ow) }, { o: ow.o, p: 0, src: 'poll:location', q: 'inferred' });
        } else emit('move.cell', a, { from, to }, { src: 'poll:location' });
        // a container session ends when its user leaves the cell
        const s = S.containers.get(a); if (s && s.w && s.w !== w) closeContainer(a, 'left');
        if (prevLoc.zone !== l.zone && l.zone && prevLoc.zone) emit('move.zone', a, { from: prevLoc.zone, to: l.zone }, { src: 'poll:location' });
      } else {
        l.pos = pos; l.t = t;
        if (!l.zpos || Math.hypot(pos[0] - l.zpos[0], pos[1] - l.zpos[1]) > C.polls.zoneMoveUnits) {
          const z = zoneFrom(w, pos, l);
          l.zpos = pos;
          if (z && l.zone && z !== l.zone) emit('move.zone', a, { from: l.zone, to: z }, { src: 'poll:location' });
          if (z) l.zone = z;
        }
      }
      if (outdoors) { l.outW = w; l.outPos = pos; }
    }
  };
  // Slow (5 s, a twelfth of the online players a tick): mastery and companion diffs, the identity refresh
  const masteryDiff = (a) => {
    const m = get(a, 'private.mastery');
    if (!m || typeof m !== 'object' || !m.skills) return;
    const prev = S.mastery.get(a);
    const cur = { t: now(), order: new Set(Array.isArray(m.order) ? m.order.map(String) : []), skills: new Map() };
    for (const [id, s] of Object.entries(m.skills)) if (s && typeof s === 'object') cur.skills.set(id, { level: Math.floor(Number(s.level) || 0), rank: Number(s.rank) || 0, lock: typeof s.lock === 'string' ? s.lock : '' });
    put('mastery', a, cur);
    if (!prev) return;
    for (const id of cur.order) if (!prev.order.has(id)) emit('char.mastery', a, { skill: id, op: 'take_up' }, { src: 'poll:mastery' });
    for (const id of prev.order) if (!cur.order.has(id)) emit('char.mastery', a, { skill: id, op: 'set_aside' }, { src: 'poll:mastery' });
    for (const [id, s] of cur.skills) {
      const p = prev.skills.get(id);
      if (!p) continue;
      if (s.level !== p.level) emit('char.mastery', a, { skill: id, op: 'level', from: p.level, to: s.level }, { src: 'poll:mastery' });
      if (s.rank !== p.rank) emit('char.mastery', a, { skill: id, op: 'rank', from: p.rank, to: s.rank }, { src: 'poll:mastery' });
      if (s.lock !== p.lock) emit('char.mastery', a, { skill: id, op: 'lock' }, { src: 'poll:mastery' });
    }
  };
  const companionDiff = (a) => {
    const Cm = globalThis.__dboCompanions;
    if (!Cm || typeof Cm.list !== 'function') return;
    let list = [];
    try { list = Cm.list(a) || []; } catch (e) { return; }
    const prev = S.companions.get(a);
    const cur = new Map();
    for (const c of list.slice(0, 20)) { const id = u32(c.id); if (!id) continue; cur.set(id, { kind: String(c.kind || ''), base: u32(c.baseId) }); add('ownedNpcs', id); }
    put('companions', a, { t: now(), cur });
    if (!prev) return;
    for (const [id, c] of cur) if (!prev.cur.has(id)) emit('social.companion', a, { op: 'spawned', kind: c.kind, base: recordName(c.base) }, { src: 'poll:companions' });
    for (const [id, c] of prev.cur) if (!cur.has(id)) emit('social.companion', a, { op: 'ended', kind: c.kind, base: recordName(c.base) }, { src: 'poll:companions' });
  };
  const slowTick = () => {
    if (!S.on) return;
    const list = [...S.online];
    if (!list.length) return;
    const per = Math.max(1, Math.ceil(list.length / Math.max(1, Number(C.polls.slowSlices) || 12)));
    for (let i = 0; i < per; i++) {
      const a = list[(S.slowCursor + i) % list.length];
      try { refreshId(a, false); } catch (e) { err('poll:slow.id', e); }
      try { masteryDiff(a); } catch (e) { err('poll:slow.mastery', e); }
      try { companionDiff(a); } catch (e) { err('poll:slow.companions', e); }
    }
    S.slowCursor = (S.slowCursor + per) % Math.max(1, list.length);
  };
  // AFK (30 s): the rounded position from the location poll's cache, no get
  const afkTick = () => {
    if (!S.on) return;
    const t = now();
    for (const a of S.online) {
      const l = S.loc.get(a);
      if (!l || !Array.isArray(l.pos)) continue;
      const key = `${l.w}|${Math.round(l.pos[0] / 64)}|${Math.round(l.pos[1] / 64)}`;
      let s = S.afk.get(a);
      if (!s) { put('afk', a, { key, since: t, away: false, t }); continue; }
      if (s.key !== key) {
        if (s.away) emit('session.afk', a, { op: 'back', min: Math.round((t - s.since) / 60000) }, { src: 'poll:afk' });
        s.key = key; s.since = t; s.away = false; s.t = t;
      } else if (!s.away && t - s.since >= C.polls.afkMinutes * 60000) {
        s.away = true;
        emit('session.afk', a, { op: 'away', min: Math.round((t - s.since) / 60000) }, { src: 'poll:afk' });
      }
    }
  };
  // The minute (called from playerlog.js's minute tick): command info folds (5 min), owned NPCs, the faction storage map
  G.onMinute = (t) => {
    if (!S.on) return;
    const over = overAt(closeDeadline());
    // both made in time order and never moved: the first one not yet due ends its loop
    for (const [k, f] of S.cmdInfoFold) { if (t - f.t < 300000 || over()) break; S.cmdInfoFold.delete(k); emit('cmd.info', f.a, { name: f.name, n: f.n }, { src: 'cmd' }); }
    for (const [k, d] of S.accessDedupe) { if (t - d.t0 < C.accessDedupeMs || over()) break; accessLine(k, d); }
    try {
      const wb = globalThis.__dboWarband && globalThis.__dboWarband.owners;
      if (wb instanceof Map) for (const id of wb.keys()) add('ownedNpcs', u32(id));
    } catch (e) { /* none */ }
    try {
      const gs = fnOf('__dboGuildStorage'), go = fnOf('__dboGuildsOf');
      if (gs && go) {
        S.factionStore.clear();
        for (const a of S.online) for (const g of (go(a) || []).slice(0, 8)) { const st = gs(g.id); const ref = st && st.ref ? (typeof st.ref === 'number' ? u32(st.ref) : (() => { try { return mp.getIdFromDesc(String(st.ref)) >>> 0; } catch (e) { return parseInt(String(st.ref), 16) >>> 0; } })()) : 0; if (ref) put('factionStore', ref, String(g.id)); }
      }
    } catch (e) { err('minute.faction', e); }
  };

  // =============================================================================================================================
  // A2 hooks (DESIGN.md 2.3): one-line globalThis calls from the modules, with structured values they already hold
  // =============================================================================================================================
  const H2 = G.hooks;
  const LOOT_SOURCES = new Set(R.EVENT_TYPES['item.loot'].f.source.e);
  // h('loot', source, actor, target, taken[{baseId, count, ...entry}], gold, shares[{actor, gold}])
  H2.loot = (source, actor, target, taken, gold, shares) => {
    const a = u32(actor);
    if (!online(a)) return;
    const items = itemsList(taken);
    if (source === 'player_body') {
      const t = u32(target);
      emit('item.theft', a, { kind: 'body_search', outcome: items || gold ? 'took' : 'nothing', gold: Number(gold) || undefined, items }, { o: t && isPlayer(t) ? [partyOf(t, 'victim')] : undefined, src: 'hook:loot' });
      return;
    }
    if (!LOOT_SOURCES.has(source)) return;
    const sh = Array.isArray(shares) ? shares.slice(0, 12).map((s) => { const r = idOf(s.actor); return r ? { p: r.p, c: r.c || undefined, gold: Number(s.gold) || 0 } : null; }).filter(Boolean) : undefined;
    emit('item.loot', a, { source, items, gold: Number(gold) || undefined, shares: sh && sh.length ? sh : undefined }, { src: 'hook:loot' });
  };
  // h('letter', a, to, { gold, items, signed }): never the text or the signature
  H2.letter = (a, to, info) => {
    const i = info || {};
    emit('social.letter', a, { signed: i.signed, gold: Number(i.gold) || undefined, items: itemsList(i.items) }, { o: to && isPlayer(to) ? [partyOf(to, 'recipient')] : undefined, src: 'hook:letter' });
  };
  // h('appearance', a, appearance, isAllowed): every RaceMenu close. Only the race and the sex are read from the new look and
  // the stored one (the engine has not stored the new look yet); never the name
  H2.appearance = (a, appearance, isAllowed) => {
    const x = u32(a);
    const app = appearance && typeof appearance === 'object' ? appearance : {};
    const was = get(x, 'appearance') || {};
    let kind = 'edit';
    try {
      const cp = typeof api.creationPending === 'function' && api.creationPending(x);
      const ed = globalThis.__dboAppearanceEdit;
      kind = cp ? 'creation' : get(x, 'private.rerollPending') === true ? 'reroll' : ed && typeof ed.pending === 'function' && ed.pending(x) ? 'edit' : 'chargen';
    } catch (e) { kind = 'edit'; }
    const race = (id) => (u32(id) ? recordName(id) : undefined);
    const raceTo = u32(app.raceId), raceFrom = u32(was.raceId);
    if (kind === 'creation' && isAllowed) emit('session.char_created', x, { race: race(raceTo), sex: app.isFemale ? 'female' : 'male' }, { src: 'hook:appearance' });
    emit('char.appearance', x, { kind: isAllowed ? kind : 'refused', raceFrom: raceFrom !== raceTo ? race(raceFrom) : undefined, raceTo: raceFrom !== raceTo ? race(raceTo) : undefined,
      sexChanged: !!was.isFemale !== !!app.isFemale || undefined }, { src: 'hook:appearance' });
    suppress(x);
  };
  H2.grant = (a, via, given, by) => emit('item.grant', a, { items: itemsList(given), via }, { o: by ? [partyOf(by, 'staff')] : undefined, src: 'hook:grant' });
  H2.staffview = (staff, target, what) => emit('staff.view', staff, { what }, { o: target ? [partyOf(target, 'target')] : undefined, src: 'hook:staffview' });
  H2.relog = (a, grew) => {
    const list = Array.isArray(grew) ? grew.slice(0, 12).map((g) => ({ b: String(g.base || ''), i: recordName(parseInt(g.base, 16)), pack: g.pack, cont: g.containers })) : [];
    if (!list.length) return;
    emit('item.relog', a, { grew: list }, { src: 'hook:relog' });
    // a security signal only when the pack itself grew: containers others can fill grow on their own (review C, recommended:
    // all 13 relog lines of 9 h grew in containers only)
    const packGrew = list.filter((g) => Array.isArray(g.pack) && Number(g.pack[1]) > Number(g.pack[0])).length;
    if (packGrew) emit('sec.signal', a, { kind: 'relog_grew', n: packGrew }, { src: 'hook:relog' });
  };
  // h('dungeon', op, members[], dungeonName, difficulty, why): to every member
  H2.dungeon = (op, members, name, difficulty, why) => {
    const list = (Array.isArray(members) ? members : [members]).map(u32).filter(Boolean).slice(0, 12);
    const parties = list.map((m) => partyOf(m, 'member')).filter(Boolean);
    for (const m of list) if (online(m)) emit('move.dungeon', m, { op, dungeon: String(name || ''), difficulty: difficulty ? String(difficulty) : undefined, members: parties, why: why ? String(why).replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 40) : undefined }, { src: 'hook:dungeon' });
  };
  // the actor may be 0 (dungeons.js leavePartyNow looks the character up inside the hook's own call, so nothing is looked up
  // with the player log off: safety review, LOW)
  H2.party = (op, a, other, size) => { if (!u32(a)) return; emit('social.party', a, { op, size: Number(size) || undefined }, { o: other && isPlayer(other) ? [partyOf(other, 'other')] : undefined, src: 'hook:party' }); };
  H2.wake = (a, how, by, downMs) => { const x = u32(a); suppress(x); put('recentPair', `${x}|wake`, { t: now(), kind: 'wake', by: 0 }); emit('combat.wake', x, { how, downSec: downMs ? Math.round(downMs / 1000) : undefined }, { o: by && isPlayer(by) ? [partyOf(by, 'by')] : undefined, src: 'hook:wake' }); };
  H2.mask = (a, on) => { const x = u32(a); try { refreshId(x, false); } catch (e) { /* next refresh */ } emit('char.mask', x, { on: !!on }, { src: 'hook:mask' }); };
  H2.pmenu = (a, id, t) => { const action = String(id || ''); if (!action || action.startsWith('voice')) return; foldAdd('pmenu', a, action.replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 40), 1, { t: u32(t) }); };
  // business.js runAction: the ledger action's name (staffAdd -> staff_add, place -> ledger; a nudge of the book is nothing)
  const BIZ_OP = { staffAdd: 'staff_add', staffRemove: 'staff_remove', place: 'ledger', rent: 'rent', note: 'note', chest: 'chest', collect: 'collect', rename: 'rename', close: 'close', open: 'open' };
  H2.business = (a, op, claim, gold) => { const o = BIZ_OP[op]; if (o) emit('social.business', a, { op: o, claim: claim ? hex(claim) : undefined, gold: Number(gold) || undefined }, { src: 'hook:business' }); };
  H2.contract = (op, a, kind, k, zone, gold) => emit('social.contract', a, { op, kind: kind ? String(kind) : undefined, k: Number(k) || undefined, zone: zone ? String(zone) : undefined, gold: Number(gold) || undefined }, { src: 'hook:contract' });
  // never the faction's id: a chartered faction's id is a slug of its player-chosen name (charters.js)
  H2.faction = (op, a, other) => emit('social.faction', a, { op }, { o: other && isPlayer(other) ? [partyOf(other, 'target')] : undefined, src: 'hook:faction' });
  H2.staffworld = (action, a, n) => emit('staff.world', a, { action, n: Number(n) || undefined }, { src: 'hook:staffworld' });
  // offline characters too (a wage or a tax written to someone not in the world)
  H2.bankwrite = (actor, reason, from, to) => { const a = u32(actor); if (!a) return; emit('item.bank_write', a, { reason, from: Number(from), to: Number(to) }, { src: 'hook:bankwrite' }); };
  H2.income = (source, a, gold, items) => emit('item.income', a, { source, gold: Number(gold) || undefined, items: itemsList(items) }, { src: 'hook:income' });
  H2.level = (a, attr, n, level) => { suppress(a); emit('char.level', a, { level: Number(level) || undefined, spent: attr ? { attr, n: Number(n) || 1 } : undefined }, { src: 'hook:level' }); };
  H2.salvage = (a, item, station, rank, out) => emit('item.salvage', a, { item: item ? itemOf(item.baseId, item.count || 1, item) : undefined, station: station ? String(station) : undefined, rank: Number(rank) || undefined, out: itemsList(out) }, { src: 'hook:salvage' });
  H2.brew = (a, potion, tier, inputs) => emit('item.brew', a, { potion: potion ? itemOf(potion, 1) : undefined, tier: Number(tier) || undefined, inputs: itemsList(inputs) }, { src: 'hook:brew' });
  H2.extras = (a, kind, baseId, soul) => emit('item.extras', a, { kind, item: baseId ? itemOf(baseId, 1) : undefined, soul: Number(soul) || undefined }, { src: 'hook:extras' });
  H2.misc = (a, kind, label, value) => emit('char.misc', a, { kind, label: label ? String(label) : undefined, value: Number.isFinite(Number(value)) ? Number(value) : undefined }, { src: 'hook:misc' });
  // mapprogress.js: the map markers discovered (descs); named by their record (the marker's editor id in words, else its id)
  H2.map = (a, markers) => {
    const list = (Array.isArray(markers) ? markers : []).map((x) => String(x || '')).filter(Boolean);
    if (!list.length) return;
    const names = list.slice(0, 5).map((d) => { try { return recordName(mp.getIdFromDesc(d) >>> 0); } catch (e) { return ''; } }).filter(Boolean);
    emit('move.map', a, { n: list.length, names }, { src: 'hook:map' });
  };
  // the dossier: on the subject's post, never the note
  H2.dossier = (op, author, subject) => { const s = u32(subject); if (!s || !isPlayer(s)) return; emit('social.dossier', s, { op }, { o: author && isPlayer(author) ? [partyOf(author, 'by')] : undefined, src: 'hook:dossier' }); };
  H2.report = (kind, a, ref) => emit('social.report', a, { kind, ref: ref ? String(ref).replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 40) : undefined, op: 'filed' }, { src: 'hook:report' });
  const EFFECTS = R.EVENT_TYPES['combat.effect'].f.kind.e;
  H2.effect = (a, kind, pct) => {
    const x = u32(a);
    if (kind === 'sun') G.sunLive = true;
    // an NPC staggered by combat.js is nobody's line (review C, recommended)
    if (!online(x)) return;
    suppress(x);
    if (!EFFECTS.has(kind)) return;
    if (kind === 'sun') return;   // a suppression only: the sun is a vampire's daily cost, not an event worth a line
    emit('combat.effect', x, { kind, pct: Number.isFinite(Number(pct)) ? Number(pct) : undefined }, { src: 'hook:effect' });
  };
  // h('theft', kind, thief, victim, outcome, items[{baseId, count, ...}], gold, extra { home, container, keyTaken, ownerProfile })
  H2.theft = (kind, thief, victim, outcome, items, gold, extra) => {
    const a = u32(thief), v = u32(victim);
    const x = extra || {};
    const o = [];
    if (v && isPlayer(v)) o.push(partyOf(v, 'victim'));
    if (kind === 'raid' && Number(x.ownerProfile) > 0) { const ow = ownerPartyOf(x.ownerProfile, x.ownerChar, 'owner'); if (ow) o.push(ow); }
    put('recentPair', `${a}|theft:${kind}:${outcome}`, { t: now(), kind: 'theft', by: a });
    if (kind === 'robbery' && v) put('recentPair', pairKey(a, v), { kind: 'robbery', by: a, t: now() });
    emit('item.theft', a, { kind, outcome, gold: Number(gold) || undefined, items: itemsList(items), home: x.home ? hex(x.home) : undefined, container: x.container ? hex(x.container) : undefined, keyTaken: x.keyTaken ? true : undefined },
      { o: o.length ? o : undefined, src: 'hook:theft' });
  };
  // lockpick.js verdictLine: every verdict; a refusal is also a security signal; a pick opens the access basis for 10 min
  const LOCK_WHY = R.EVENT_TYPES['social.lock'].f.why.e;
  H2.lock = (a, verdict, level, target, snaps) => {
    const x = u32(a), ref = u32(target);
    const v = String(verdict || '');
    const m = v.match(/^refused\(([a-z_]{1,20})\)/);
    // 'expired': a client lock that never reported (lockpick.js busy())
    const op = v === 'win' ? 'picked' : v === 'fail' ? 'failed' : v === 'cancel' || v === 'expired' ? 'cancel' : m ? 'refused' : null;
    if (!op) return;
    const why = m ? (LOCK_WHY.has(m[1]) ? m[1] : 'other') : v === 'expired' ? 'expired' : undefined;
    if (op === 'picked') put('recentPair', `${x}|lock`, { t: now(), kind: 'lock', by: x });
    let own, o;
    if (ref) { const ow = ownershipOf(ref, x); own = ow.own; o = ow.o && ow.o.length ? ow.o : undefined; }
    if (op === 'picked' && ref) { put('lockPicks', `${x}|${ref}`, { t: now() }); const h = housingRecord(ref); if (h && h.primary) put('lockPicks', `${x}|${h.primary}`, { t: now() }); }
    emit('social.lock', x, { op, why, snaps: Number(snaps) || undefined, level: Number.isFinite(Number(level)) ? Number(level) : undefined, target: ref ? hex(ref) : undefined, own },
      { o, p: own && own !== 'self' && own !== 'public' ? 0 : 1, src: 'hook:lock' });
    if (op === 'refused') emit('sec.signal', x, { kind: 'lockpick_refused', game: 'lockpick', why }, { o, src: 'hook:lock' });
  };
  const SIGNAL_WHY = R.EVENT_TYPES['sec.signal'].f.why.e;
  H2.signal = (a, game, why) => emit('sec.signal', a, { kind: 'minigame_refused', game: String(game || '').replace(/[^a-z_]/g, '').slice(0, 24) || 'other', why: SIGNAL_WHY.has(why) ? why : 'other' }, { src: 'hook:signal' });
  H2.itemflow = (a, kind, baseId, delta) => emit('item.flow', a, { kind, item: baseId ? itemOf(baseId, Math.abs(Number(delta) || 1)) : undefined, k: Number(delta) || undefined }, { src: 'hook:itemflow' });

  // ---- the online set against the world: at load, and when capture comes back on (safety review R1) ------------------------
  // Players who came on while this file was not loaded or capture was off get a session from now; those who left meanwhile
  // are dropped (their logout was not seen, so none is written). After a time off, the polls' caches are stale: positions,
  // health, restraints and idle spots are dropped and the first polls record them again without reading them as a move, a
  // loss or a capture.
  G.resync = (why) => {
    let on = null;
    try { on = new Set(((typeof api.onlineActors === 'function' ? api.onlineActors() : []) || []).map(u32).filter(Boolean)); } catch (e) { err('load.online', e); return; }
    for (const x of on) if (!S.online.has(x)) { add('online', x); if (!S.sessions.has(x)) put('sessions', x, { t: now(), userId: undefined, gold0: undefined, bank0: undefined }); }
    for (const a of [...S.online]) if (!on.has(a)) { S.containers.delete(a); forget(a); }
    if (why === 'load' && !K.wasOff) return;
    S.loc.clear(); S.vitals.clear(); S.restrained.clear(); S.afk.clear(); S.hpLossMerge.clear();
    seedQuiet = true;
  };
  G.resync('load');

  // ---- the optional inventory diff (DESIGN.md 2.4 option B; playerLog.inventoryDiff, off by default) -------------------
  // One twelfth of the online players every slowMs, one inventory get each. A base whose count changed with no item event
  // of that player since the last look is item.unexplained (arrows used, a code-made change no hook covers). Gold is left
  // out: fees, wages and shares move it from everywhere.
  const ITEM_FIELDS = ['item', 'items', 'took', 'put', 'gave', 'got', 'product', 'inputs', 'fuel', 'out', 'removed', 'refunds', 'potion'];
  if (C.inventoryDiff === true) {
    G.touch = (a, f) => {
      if (!f) return;
      let set = null;
      for (const k of ITEM_FIELDS) {
        const v = f[k];
        if (!v) continue;
        for (const it of Array.isArray(v) ? v : [v]) if (it && it.b) { if (!set) { set = S.invTouched.get(u32(a)); if (!set) set = put('invTouched', u32(a), new Set()); } if (set.size < 200) set.add(it.b); }
      }
    };
    const invTick = () => {
      if (!S.on) return;
      const list = [...S.online];
      if (!list.length) return;
      const per = Math.max(1, Math.ceil(list.length / Math.max(1, Number(C.polls.slowSlices) || 12)));
      for (let i = 0; i < per; i++) {
        const a = list[(S.invCursor + i) % list.length];
        const counts = new Map();
        for (const e of entriesOf(a)) { const id = e ? u32(e.baseId) : 0; if (id && id !== GOLD) counts.set(id, (counts.get(id) || 0) + (Number(e.count) || 0)); }
        const prev = S.invSnap.get(a);
        const touched = S.invTouched.get(a);
        S.invTouched.delete(a);
        put('invSnap', a, { t: now(), counts });
        if (!prev) continue;
        const bases = new Set([...counts.keys(), ...prev.counts.keys()]);
        let n = 0;
        for (const b of bases) {
          const was = prev.counts.get(b) || 0, is = counts.get(b) || 0;
          if (was === is || (touched && touched.has(descOf(b)))) continue;
          emit('item.unexplained', a, { item: itemOf(b, Math.abs(is - was)), before: was, after: is }, { src: 'poll:inventory', q: 'inferred' });
          if (++n >= 10) break;
        }
      }
      S.invCursor = (S.invCursor + per) % Math.max(1, list.length);
    };
    K.every('playerlogInvDiff', C.polls.slowMs, invTick);
  }
  // one closing deadline for the fast poll's loops and the folds
  K.every('playerlogFast', C.polls.fastMs, () => { if (!S.on) return; const end = closeDeadline(); fastTick(end); foldTick(now(), end); });
  K.every('playerlogLocation', C.polls.locationMs, locationTick);
  K.every('playerlogSlow', C.polls.slowMs, slowTick);
  K.every('playerlogAfk', C.polls.afkMs, afkTick);
  // for the harnesses
  G.taps = { fastTick, locationTick, slowTick, afkTick, closeAllFor, closeContainer, openContainer, ownershipOf, accessOf, resolveTarget, flushPanelPending, foldTick };
  return slots;
};
