// DragonBreak Online: heralds cry what is to come (Nat, 31 Oct, in-game-over-discord C: "events posted by faction leaders
// and hosts, or anyone for a fee", "keep lore accuracy and RP in mind"). Loaded by gamemode.js.
//
// At a notice board, /herald <when> <what> pays a herald to cry a gathering: a faction's leader or an event host for
// nothing, anyone else for heralds.fee gold to that town's treasury. The herald cries it at once to everyone in the
// province, again reminderMinutes before it begins and when it begins, and tells those who said they would come wherever
// they are. /events lists what is cried (with a number); /events attend <n> says you will come, again to take it back;
// /herald cancel <n> takes your own down (staff any). When: +30m, +2h, +1d, or HH:MM UTC; every time
// is shown as how long from now, never as a clock time, since players sit in many time zones. A leader's or host's
// cry also goes to Discord (stafftools.js, the /event post), so word flows from the game out and not the other way.
// The login line and /status (the journal's Status) name what is cried near you. Kept in heralds.json.
//
// gamemode-config.json "heralds": { enabled, fee: 50, maxText: 200, minAheadMinutes: 10, maxAheadDays: 7,
//   maxActivePerPoster: 2, reminderMinutes: 30, keepHours: 6 }
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, system, registerChatCommand, onlineActors, profileOf, nameOf, zoneById, takeGold, depositToTreasury, every, audit, isAdmin, cfg } = api;
  const C = Object.assign({ enabled: true, fee: 50, maxText: 200, minAheadMinutes: 10, maxAheadDays: 7, maxActivePerPoster: 2, reminderMinutes: 30, keepHours: 6 }, cfg.heralds || {});
  const ON = C.enabled !== false;
  const FILE = path.resolve('heralds.json');
  const S = (() => { try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { seq: Number(j.seq) || 0, events: Array.isArray(j.events) ? j.events : [] }; } catch (e) { return { seq: 0, events: [] }; } })();
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(S)); } catch (e) { log('heralds: save failed', e.message); } };
  const call = (name, ...args) => { try { const f = globalThis[name]; return typeof f === 'function' ? f(...args) : undefined; } catch (e) { return undefined; } };
  const ownName = (a) => { const m = call('__dboMaskOf', a >>> 0); return (m && m.real) || nameOf(a); };
  const provinceOf = (a) => { const r = globalThis.__dboRegions; try { return r && typeof r.provinceAt === 'function' ? String((r.provinceAt(a) || {}).province || '') : ''; } catch (e) { return ''; } };
  const boardZone = (a) => call('__alduinakBoardNear', a) || null;
  const factionsOf = (a) => { const l = call('__dboGuildsOf', a >>> 0); return Array.isArray(l) ? l : []; };
  const leaderOf = (a) => factionsOf(a).find((g) => g.role === 'leader') || null;
  const isHost = (a) => call('__dboIsEventHost', a) === true;
  const clean = (t) => String(t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/#\{/g, '#(').replace(/\s+/g, ' ').trim();
  const fromNow = (ms) => {
    const m = Math.round(ms / 60000);
    if (m <= 0) return 'now';
    if (m < 60) return `in ${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 48) return `in ${h} h${r ? ` ${r} min` : ''}`;
    return `in ${Math.round(h / 24)} days`;
  };
  // "+30m", "+2h", "+1d", or "HH:MM" UTC (the next time it comes round); 0 when unreadable
  const parseWhen = (w, now) => {
    const rel = String(w).match(/^\+(\d{1,4})\s*(m|min|h|d)$/i);
    if (rel) return now + Number(rel[1]) * ({ m: 60000, min: 60000, h: 3600000, d: 86400000 })[rel[2].toLowerCase()];
    const clock = String(w).match(/^(\d{1,2}):(\d{2})$/);
    if (clock && Number(clock[1]) < 24 && Number(clock[2]) < 60) {
      const d = new Date(now); d.setUTCHours(Number(clock[1]), Number(clock[2]), 0, 0);
      return d.getTime() <= now ? d.getTime() + 86400000 : d.getTime();
    }
    return 0;
  };
  const live = (now) => S.events.filter((e) => !e.cancelled && now < e.at + C.keepHours * 3600000);
  const describe = (e, now, viewer) => {
    const going = (e.rsvps || []).length;
    const mine = viewer !== undefined && (e.rsvps || []).includes(profileOf(viewer));
    return `#${e.id} ${e.title}, at ${e.place}, ${e.at > now ? fromNow(e.at - now) : 'under way'}. Cried for ${e.by}${e.faction ? ` (${e.faction})` : ''}.${going ? ` ${going} will come${mine ? ', you among them' : ''}.` : ''}`;
  };
  const inProvince = (province) => onlineActors().filter((t) => !province || provinceOf(t) === province);
  const cry = (e, words) => { for (const t of inProvince(e.province)) system(t, `A herald cries: ${words}`); };
  const tellComing = (e, words) => { const on = new Set(inProvince(e.province)); for (const t of onlineActors()) if (!on.has(t) && (e.rsvps || []).includes(profileOf(t))) personal(t, `Word reaches you of ${e.title}: ${words}`); };

  const post = (a, raw) => {
    if (!ON) return personal(a, 'No heralds are crying news just now.');
    const parts = clean(raw).split(' ');
    const now = Date.now();
    const at = parseWhen(parts[0] || '', now);
    const title = parts.slice(1).join(' ').slice(0, Math.max(20, Number(C.maxText) || 200));
    if (!at || !title) return personal(a, '/herald <when> <what>: when is +30m, +2h, +1d, or HH:MM UTC. Cried from a notice board.');
    const zoneId = boardZone(a);
    if (!zoneId) return personal(a, 'Heralds take their news at a notice board.');
    if (at - now < C.minAheadMinutes * 60000) return personal(a, `Give the herald at least ${C.minAheadMinutes} minutes to spread the word.`);
    if (at - now > C.maxAheadDays * 86400000) return personal(a, `Heralds cry nothing more than ${C.maxAheadDays} days ahead.`);
    const p = profileOf(a);
    if (live(now).filter((e) => e.byProfile === p && e.at > now).length >= C.maxActivePerPoster && !isAdmin(a)) return personal(a, `You already have ${C.maxActivePerPoster} gatherings cried. Take one down with /herald cancel <n>.`);
    const leader = leaderOf(a);
    const free = !!leader || isHost(a);
    const fee = free ? 0 : Math.max(0, Math.floor(Number(C.fee) || 0));
    if (fee && !takeGold(a, fee)) return personal(a, `A herald asks ${fee} gold to cry your news, and you do not have it.`);
    if (fee) depositToTreasury(zoneId, fee, { income: 'heralds' });
    const zone = zoneById(zoneId);
    const e = { id: ++S.seq, title, at, place: zone ? zone.name : String(zoneId), zoneId, province: provinceOf(a), by: ownName(a), byProfile: p,
      faction: leader ? leader.name : '', rsvps: [p], posted: now, reminded: false, begun: false };
    S.events.push(e);
    S.events = S.events.filter((x) => !x.cancelled && now < x.at + C.keepHours * 3600000);
    save();
    cry(e, `${title}, at ${e.place}, ${fromNow(at - now)}. So says ${e.by}${e.faction ? ` of ${e.faction}` : ''}.`);
    personal(a, `The herald will cry it${fee ? ` (${fee} gold to the ${e.place} treasury)` : ''}: ${describe(e, now, a)} /events lists what is cried.`);
    if (free) call('__dboEventPostDiscord', `${title}, at ${e.place}, <t:${Math.floor(at / 1000)}:F> (<t:${Math.floor(at / 1000)}:R>)`, e.by);
    audit(`HERALD ${nameOf(a)} cried #${e.id} "${title}" at ${e.place} for ${new Date(at).toISOString()}${fee ? ` (${fee} gold)` : ''}`);
  };
  const cancel = (a, n) => {
    const e = S.events.find((x) => x.id === Number(n) && !x.cancelled);
    if (!e) return personal(a, 'The heralds cry no such gathering.');
    if (e.byProfile !== profileOf(a) && !isAdmin(a)) return personal(a, 'Only the one who had it cried can take it down.');
    e.cancelled = true; save();
    cry(e, `${e.title}, at ${e.place}, will not take place.`);
    tellComing(e, 'it will not take place.');
    audit(`HERALD ${nameOf(a)} took down #${e.id} "${e.title}"`);
  };
  registerChatCommand('herald', (a, args) => {
    const raw = String(args || '').trim();
    const m = raw.match(/^cancel\s+#?(\d+)$/i);
    return m ? cancel(a, m[1]) : post(a, raw);
  }, { help: '<when> <what> | cancel <n>: have a herald cry a gathering (at a notice board; free for faction leaders and hosts)' });
  registerChatCommand('events', (a, args) => {
    const now = Date.now();
    const m = String(args || '').trim().match(/^attend\s+#?(\d+)$/i);
    if (m) {
      const e = live(now).find((x) => x.id === Number(m[1]));
      if (!e) return personal(a, 'The heralds cry no such gathering.');
      const p = profileOf(a); e.rsvps = e.rsvps || [];
      const i = e.rsvps.indexOf(p);
      if (i >= 0) e.rsvps.splice(i, 1); else e.rsvps.push(p);
      save();
      return personal(a, i >= 0 ? `You will not come to ${e.title} after all.` : `You will come to ${e.title}. Word of it will reach you before it begins.`);
    }
    const list = live(now).sort((x, y) => x.at - y.at);
    if (!list.length) return personal(a, 'The heralds have nothing to cry. Have one cry yours at a notice board: /herald <when> <what>.');
    personal(a, `The heralds cry: ${list.slice(0, 8).map((e) => describe(e, now, a)).join(' ')} /events attend <n> to say you will come.`);
  }, { help: '[attend <n>]: what the heralds cry, and say you will come' });

  // Reminders and the start, once a minute
  every('heralds', 60000, () => {
    if (!ON) return;
    const now = Date.now();
    let changed = false;
    for (const e of live(now)) {
      if (!e.reminded && e.at - now <= C.reminderMinutes * 60000 && e.at > now) { e.reminded = true; changed = true; const w = `${e.title}, at ${e.place}, ${fromNow(e.at - now)}.`; cry(e, w); tellComing(e, `it begins ${fromNow(e.at - now)} at ${e.place}.`); }
      if (!e.begun && now >= e.at) { e.begun = true; changed = true; cry(e, `${e.title} begins now, at ${e.place}.`); tellComing(e, `it begins now, at ${e.place}.`); }
    }
    const before = S.events.length;
    S.events = S.events.filter((x) => !x.cancelled && now < x.at + C.keepHours * 3600000);
    if (changed || S.events.length !== before) save();
  });
  // The next ones near this player (their province), and any they will come to
  const near = (a, now) => { const prov = provinceOf(a); const p = profileOf(a); return live(now).filter((e) => e.at > now && (e.province === prov || (e.rsvps || []).includes(p))).sort((x, y) => x.at - y.at); };
  globalThis.__dboHeraldLogin = (a) => {
    if (!ON) return;
    const now = Date.now(); const list = near(a, now).slice(0, 2);
    if (list.length) personal(a, `The heralds cry: ${list.map((e) => `${e.title} at ${e.place}, ${fromNow(e.at - now)}`).join('; ')}. /events for more.`);
  };
  call('__dboRegisterStatus', 'events', 37, (a) => {
    if (!ON) return null;
    const now = Date.now(); const list = near(a, now).slice(0, 3);
    return list.length ? `Heralds cry ${list.map((e) => `${e.title} (${e.place}, ${fromNow(e.at - now)})`).join(', ')}` : null;
  });
  log(`heralds: ${ON ? `on, ${live(Date.now()).length} cried, fee ${C.fee}` : 'off'}`);
  return { post, cancel, parseWhen, fromNow, state: S };
};
