// DragonBreak Online: a faction's roll and its standing orders (Nat, 31 Oct, in-game-over-discord F: "faction rosters show
// who's online, in-world framed, never exact positions, masks hold; leaders post standing orders"). Loaded by gamemode.js.
//
// /roster [<faction>] lists a faction's members by rank, as its members know it, with when and where each was last seen:
// "seen in Bruma within the hour", "seen on the road today", "last seen 3 days ago". Never "online now", never a
// position: once a minute each player in the land is noted with the hold they stand in (on the road outside any), and a
// player in disguise (a mask, a beast form: playermenu.js __dboDisguised) is noted as unseen, so a mask holds.
// /orders [<faction>:] <text> sets the faction's standing orders (its leaders and officers; /orders clear takes them down);
// every member reads them at login and in /status and the journal's Status. Player guilds (bands) have both.
// Kept in rosters.json.
//
// gamemode-config.json "rosters": { enabled, maxOrders: 300, maxShown: 40 }
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { log, personal, registerChatCommand, onlineActors, nameOf, zoneOfActor, zoneById, every, audit, cfg } = api;
  const C = Object.assign({ enabled: true, maxOrders: 300, maxShown: 40 }, cfg.rosters || {});
  const ON = C.enabled !== false;
  const FILE = path.resolve('rosters.json');
  const S = (() => { try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { orders: j.orders || {}, seen: j.seen || {} }; } catch (e) { return { orders: {}, seen: {} }; } })();
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(S)); } catch (e) { log('rosters: save failed', e.message); } };
  const call = (name, ...args) => { try { const f = globalThis[name]; return typeof f === 'function' ? f(...args) : undefined; } catch (e) { return undefined; } };
  const factionsOf = (a) => { const l = call('__dboGuildsOf', a >>> 0, { bands: true }); return Array.isArray(l) ? l : []; };
  const ownName = (a) => { const m = call('__dboMaskOf', a >>> 0); return (m && m.real) || nameOf(a); };
  const clean = (t) => String(t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/#\{/g, '#(').replace(/\s+/g, ' ').trim();
  const pick = (mine, raw) => {
    const m = String(raw).match(/^([^:]{2,40}):\s*([\s\S]*)$/);
    if (m && mine.length > 1) {
      const key = m[1].trim().toLowerCase();
      const f = mine.find((g) => String(g.id).toLowerCase() === key || String(g.name || '').toLowerCase().split(/\s+/).some((w) => w.startsWith(key)));
      if (f) return { f, text: m[2] };
    }
    return { f: mine[0], text: raw };
  };
  const placeOf = (a) => {
    if (call('__dboDisguised', a >>> 0) === true) return '';
    let z = null; try { z = typeof zoneOfActor === 'function' ? zoneOfActor(a) : null; } catch (e) { z = null; }
    const zone = z ? zoneById(z) : null;
    return zone ? zone.name : 'the road';
  };
  // Once a minute: when and where each player in the land was seen (a disguised one: when only)
  every('rosters', 60000, () => {
    if (!ON) return;
    const now = Date.now();
    for (const a of onlineActors()) { const where = placeOf(a); S.seen[String(a >>> 0)] = { at: now, where, hidden: !where }; }
    save();
  });
  const seenText = (id, now) => {
    const s = S.seen[String(id >>> 0)];
    if (!s || !Number(s.at)) return 'not seen of late';
    const ago = now - Number(s.at);
    const where = s.hidden || !s.where ? '' : s.where === 'the road' ? ' on the road' : ` in ${s.where}`;
    if (ago < 3600000) return `seen${where} within the hour`;
    if (ago < 86400000) return `seen${where} today`;
    const d = Math.round(ago / 86400000);
    return `last seen ${d === 1 ? 'yesterday' : `${d} days ago`}`;
  };

  const RANK_WEIGHT = { leader: 3, officer: 2, sergeant: 1 };
  registerChatCommand('roster', (a, args) => {
    if (!ON) return personal(a, 'The rolls are closed just now.');
    const mine = factionsOf(a);
    if (!mine.length) return personal(a, 'You serve no faction, so you keep no roll.');
    const q = clean(args).toLowerCase();
    const f = q ? mine.find((g) => String(g.id).toLowerCase() === q || String(g.name || '').toLowerCase().split(/\s+/).some((w) => w.startsWith(q))) : mine[0];
    if (!f) return personal(a, `/roster [faction]: one of ${mine.map((g) => g.name).join(', ')}.`);
    const now = Date.now();
    const ids = (call('__dboGuildMembers', f.id) || []).map((x) => Number(x) >>> 0);
    const rows = ids.map((id) => {
      const g = factionsOf(id).find((x) => x.id === f.id) || {};
      const at = Number((S.seen[String(id)] || {}).at) || 0;
      return { name: ownName(id), title: g.shown || g.title || '', role: g.role || '', at, text: seenText(id, now) };
    }).sort((x, y) => (RANK_WEIGHT[y.role] || 0) - (RANK_WEIGHT[x.role] || 0) || y.at - x.at);
    const shown = rows.slice(0, C.maxShown).map((r) => `${r.title ? `${r.title} ` : ''}${r.name}, ${r.text}`);
    personal(a, `The roll of ${f.name} (${rows.length}): ${shown.join('; ')}${rows.length > shown.length ? `; and ${rows.length - shown.length} more` : ''}.`);
    const o = S.orders[f.id];
    if (o) personal(a, `Standing orders: ${o.text} (${o.by})`);
  }, { help: '[faction]: your faction\'s roll, and when and where each was last seen' });

  registerChatCommand('orders', (a, args) => {
    if (!ON) return personal(a, 'Standing orders are not kept just now.');
    const mine = factionsOf(a);
    if (!mine.length) return personal(a, 'You serve no faction.');
    const raw = clean(args);
    if (!raw) {
      const list = mine.filter((g) => S.orders[g.id]).map((g) => `${g.name}: ${S.orders[g.id].text} (${S.orders[g.id].by})`);
      return personal(a, list.length ? `Standing orders. ${list.join(' | ')}` : 'No standing orders. A leader or officer sets them with /orders <text>.');
    }
    const lead = mine.filter((g) => g.role === 'leader' || g.role === 'officer');
    if (!lead.length) return personal(a, 'Only a faction\'s leaders and officers set its standing orders.');
    const clear = /^clear(\s+(.*))?$/i.exec(raw);
    const { f, text } = clear ? pick(lead, clear[2] ? `${clear[2]}: x` : raw) : pick(lead, raw);
    if (clear) {
      if (!S.orders[f.id]) return personal(a, `${f.name} has no standing orders.`);
      delete S.orders[f.id]; save();
      audit(`ORDERS ${nameOf(a)} took down the standing orders of ${f.name}`);
      return personal(a, `The standing orders of ${f.name} are taken down.`);
    }
    const body = clean(text).slice(0, Math.max(40, Number(C.maxOrders) || 300));
    if (!body) return personal(a, '/orders [<faction>:] <text> sets your faction\'s standing orders; /orders clear takes them down.');
    S.orders[f.id] = { text: body, by: `${f.shown || f.title ? `${f.shown || f.title} ` : ''}${ownName(a)}`, at: Date.now() };
    save();
    audit(`ORDERS ${nameOf(a)} set the standing orders of ${f.name}`);
    personal(a, `The standing orders of ${f.name} are set. Every member reads them when they come into the land.`);
    for (const t of onlineActors()) if ((t >>> 0) !== (a >>> 0) && factionsOf(t).some((g) => g.id === f.id)) personal(t, `New standing orders for ${f.name}: ${body} (${S.orders[f.id].by})`);
  }, { help: '[<faction>:] <text> | clear: your faction\'s standing orders (leaders and officers); /orders alone reads them' });

  const ordersFor = (a) => factionsOf(a).filter((g) => S.orders[g.id]).map((g) => ({ g, o: S.orders[g.id] }));
  globalThis.__dboRosterLogin = (a) => {
    if (!ON) return;
    for (const { g, o } of ordersFor(a)) personal(a, `Standing orders of ${g.name}: ${o.text} (${o.by})`);
  };
  call('__dboRegisterStatus', 'orders', 38, (a) => {
    if (!ON) return null;
    const list = ordersFor(a);
    return list.length ? `Orders ${list.map(({ g, o }) => `${g.name}: ${o.text}`).join('; ')}` : null;
  });
  log(`rosters: ${ON ? `on, ${Object.keys(S.orders).length} standing orders` : 'off'}`);
  return { seenText, state: S };
};
