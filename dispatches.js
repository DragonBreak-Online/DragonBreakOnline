// DragonBreak Online: word carried by runners to a faction and among a party (Nat, 31 Oct: "better reasons for people not
// to use Discord", "keep lore accuracy and RP in mind"; _work/in-game-over-discord-1031.md, A). Loaded by gamemode.js.
//
// /f <text> sends a sealed dispatch to every member of the speaker's faction who is in the land; /f <faction>: <text>
// picks one of several. /p <text> passes word among the speaker's party. Nothing in Tamriel crosses a province in an
// instant, so a runner carries it: it arrives after delays.hold seconds in the speaker's hold, delays.province in the
// same province, delays.far beyond it. A dispatch is signed with the sender's rank and own name (the faction's roster
// names its members already); party word names the speaker as each companion knows them, so a mask holds. Player guilds
// (bands) have runners too. No runner reaches a cell. The command tap logs the use; the text stays out of the player log, as chat does.
//
// gamemode-config.json "dispatches": { enabled, maxText: 300, gapSeconds: 4, delays: { hold: 5, province: 30, far: 90 } }
'use strict';

module.exports = (api) => {
  const { mp, log, personal, deliver, registerChatCommand, onlineActors, nameOf, zoneOfActor, cfg } = api;
  const C = Object.assign({ enabled: true, maxText: 300, gapSeconds: 4, delays: {}, colors: {} }, cfg.dispatches || {});
  const DELAYS = Object.assign({ hold: 5, province: 30, far: 90 }, C.delays || {});
  const COLORS = Object.assign({ faction: 'd8b45a', party: '9fd38a' }, C.colors || {});
  const ON = C.enabled !== false;
  const MAX_TEXT = Math.max(20, Math.min(1000, Number(C.maxText) || 300));
  const GAP_MS = Math.max(0, Number(C.gapSeconds) || 0) * 1000;
  const call = (name, ...args) => { try { const f = globalThis[name]; return typeof f === 'function' ? f(...args) : undefined; } catch (e) { return undefined; } };
  const get = (a, k) => { try { return mp.get(a, k); } catch (e) { return undefined; } };
  const factionsOf = (a) => { const l = call('__dboGuildsOf', a >>> 0, { bands: true }); return Array.isArray(l) ? l : []; };
  const ownName = (a) => { const m = call('__dboMaskOf', a >>> 0); return (m && m.real) || nameOf(a); };
  const knownAs = (viewer, a) => { const n = call('__dboNameFor', viewer, a); return n ? String(n) : nameOf(a); };
  const provinceOf = (a) => { const r = globalThis.__dboRegions; try { return r && typeof r.provinceAt === 'function' ? String((r.provinceAt(a) || {}).province || '') : ''; } catch (e) { return ''; } };
  const holdOf = (a) => { try { const z = typeof zoneOfActor === 'function' ? zoneOfActor(a) : null; return z ? String(z) : ''; } catch (e) { return ''; } };
  // How long the runner takes from one to the other, in ms. An unknown place counts as far
  const delayMs = (from, to) => {
    const h = holdOf(from);
    if (h && h === holdOf(to)) return Number(DELAYS.hold) * 1000;
    const p = provinceOf(from);
    return (p && p === provinceOf(to) ? Number(DELAYS.province) : Number(DELAYS.far)) * 1000;
  };
  const jailed = (a) => !!get(a, 'private.dboSentence');
  const sentAt = globalThis.__dboDispatchAt instanceof Map ? globalThis.__dboDispatchAt : (globalThis.__dboDispatchAt = new Map());
  const clean = (t) => String(t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/#\{/g, '#(').trim();
  const later = (ms, fn) => setTimeout(() => { try { fn(); } catch (e) { log('dispatch delivery failed', e.message); } }, Math.max(0, ms));

  // The refusal, or '' when the speaker may send now
  const refusal = (a, text) => {
    if (!ON) return 'No runners are carrying word just now.';
    if (!text) return '';
    if (jailed(a)) return 'No runner reaches a cell.';
    const now = Date.now();
    if (now - (sentAt.get(a >>> 0) || 0) < GAP_MS) return 'Your last runner has only just set out.';
    return null;
  };
  const stamp = (a) => { const now = Date.now(); sentAt.set(a >>> 0, now); if (sentAt.size > 2000) for (const [k, t] of sentAt) if (now - t > GAP_MS) sentAt.delete(k); };

  // /f [<faction>:] <text>
  const pickFaction = (a, raw) => {
    const mine = factionsOf(a);
    if (!mine.length) return { error: 'You serve no faction to send word to.' };
    const m = String(raw).match(/^([^:]{2,40}):\s*([\s\S]*)$/);
    if (m && mine.length > 1) {
      const key = m[1].trim().toLowerCase();
      const f = mine.find((g) => String(g.id).toLowerCase() === key || String(g.name || '').toLowerCase().split(/\s+/).some((w) => w.startsWith(key)) || String(g.name || '').toLowerCase().startsWith(key));
      if (f) return { faction: f, text: m[2], others: mine.length };
    }
    return { faction: mine[0], text: raw, others: mine.length };
  };
  const toFaction = (a, raw) => {
    const pick = pickFaction(a, clean(raw));
    if (pick.error) return personal(a, pick.error);
    const text = clean(pick.text).slice(0, MAX_TEXT);
    const no = refusal(a, text);
    if (no === '') return personal(a, `/f <text> sends word to ${pick.faction.name}${pick.others > 1 ? '; /f <faction>: <text> for another of yours' : ''}.`);
    if (no) return personal(a, no);
    stamp(a);
    const f = pick.faction;
    const line = `#{${COLORS.faction}}[${f.name}] ${(f.shown || f.title) ? `${f.shown || f.title} ` : ''}${ownName(a)}: ${text}`;
    const to = onlineActors().filter((t) => (t >>> 0) !== (a >>> 0) && factionsOf(t).some((g) => g.id === f.id));
    deliver(a, line);
    for (const t of to) later(delayMs(a, t), () => { if (onlineActors().includes(t) && factionsOf(t).some((g) => g.id === f.id)) deliver(t, line); });
    personal(a, to.length ? `A runner sets out with your word to ${to.length} of ${f.name} in the land.` : `None of ${f.name} is in the land to receive it.`);
    log(`dispatch: ${nameOf(a)} -> ${f.id} (${to.length}): ${text}`);
  };
  const toParty = (a, raw) => {
    const text = clean(raw).slice(0, MAX_TEXT);
    const leader = call('__dboPartyLeaderOf', a >>> 0);
    if (leader === null || leader === undefined) return personal(a, 'You travel with no party.');
    const no = refusal(a, text);
    if (no === '') return personal(a, '/p <text> passes word among your party.');
    if (no) return personal(a, no);
    stamp(a);
    const to = onlineActors().filter((t) => (t >>> 0) !== (a >>> 0) && call('__dboPartyLeaderOf', t >>> 0) === leader);
    deliver(a, `#{${COLORS.party}}[Party] ${ownName(a)}: ${text}`);
    for (const t of to) later(delayMs(a, t), () => { if (onlineActors().includes(t) && call('__dboPartyLeaderOf', t >>> 0) === leader) deliver(t, `#{${COLORS.party}}[Party] ${knownAs(t, a)}: ${text}`); });
    if (!to.length) personal(a, 'None of your party is in the land to hear it.');
    log(`dispatch: ${nameOf(a)} -> party of ${leader} (${to.length}): ${text}`);
  };

  registerChatCommand('f', (a, args) => toFaction(a, args), { help: '[<faction>:] <text>: send word by runner to your faction (it takes longer the farther they are)' });
  registerChatCommand('p', (a, args) => toParty(a, args), { help: '<text>: pass word among your party' });
  log(`dispatches: ${ON ? `on, runners ${DELAYS.hold}/${DELAYS.province}/${DELAYS.far} s (hold, province, beyond)` : 'off'}`);
  return { toFaction, toParty, delayMs };
};
