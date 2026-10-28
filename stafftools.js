// DragonBreak Online: quick staff tools (#staff-suggestions, aussiepie 8-9 Oct; Nate picked them 19 Oct)
//
// /event <message>: staff (any rank, Trial GMs included) and holders of a Discord role in events.hostRoleIds announce an
// event to every online player, on screen and in chat as /announce does, and, when switched on, in a Discord channel.
// A cooldown per host and one across all hosts keep it from being spammed; every use goes into the audit.
// /chars #TAG: every character of the account that carries #TAG, online or not, with each one's own #TAG, so staff can
// pick which character to /rename (also from Discord /console, where /rename reaches offline characters by #TAG).
//
// gamemode-config.json "events" (all optional): enabled, cooldownSeconds (per host), globalCooldownSeconds (any host),
// minText, maxText, hostRoleIds (Discord role ids allowed besides staff), showHost (name the host's character),
// discord (also post to Discord), discordChannelId, discordPingRoleId (a role pinged by the post).
'use strict';

module.exports = (api) => {
  const { mp, log, personal, system, audit, who, tagOf, profileOf, onlineActors, registerChatCommand, isAdmin, cfg } = api;
  const fn = (f, dflt) => (typeof f === 'function' ? f : dflt);
  const rolesOf = fn(api.rolesOf, () => []);
  const staffTier = fn(api.staffTier, (a) => (isAdmin(a) ? 'gm' : null));
  const realNameOf = fn(api.realNameOf, fn(api.nameOf, () => 'Stranger'));
  const userOf = fn(api.userOf, () => -1);
  const findByName = fn(api.findByName, () => 0);
  const offlineByTag = fn(api.offlineByTag, () => 0);
  const sendJson = fn(api.sendJson, null);
  const now = fn(api.now, Date.now);
  const C = Object.assign({
    enabled: true, cooldownSeconds: 300, globalCooldownSeconds: 60, minText: 5, maxText: 300, hostRoleIds: [], showHost: true,
    discord: false, discordChannelId: '', discordPingRoleId: '',
  }, (cfg && cfg.events) || {});

  // ---- /event --------------------------------------------------------------------------------------------------------
  const hostRoles = (Array.isArray(C.hostRoleIds) ? C.hostRoleIds : []).map(String).filter((r) => /^\d{15,22}$/.test(r));
  const isStaff = (a) => { try { return !!isAdmin(a) || staffTier(a) !== null; } catch (e) { return false; } };
  const isHost = (a) => { try { return hostRoles.length > 0 && rolesOf(a).some((r) => hostRoles.includes(String(r))); } catch (e) { return false; } };
  // Per profile, the last announcement; the last one by anyone. Kept over a hot reload
  const R = globalThis.__dboEventsRun || (globalThis.__dboEventsRun = { last: new Map(), lastAny: 0 });
  // One line, no control characters, no chat colour codes or tab markup
  const clean = (t) => String(t || '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\[\[/g, '[ [').split('#{').join('# {').replace(/\s+/g, ' ').trim();
  // Discord markdown shown as typed (gmcall.js md), mentions included
  const md = (t) => String(t == null ? '' : t).replace(/[\\*_~`|[\]<@]/g, (ch) => `\\${ch}`).replace(/^\s*([#>+-])/, (m, ch) => m.slice(0, -1) + `\\${ch}`);
  const discordOn = () => !!C.discord && !!api.token && !!sendJson && /^\d{15,22}$/.test(String(C.discordChannelId || ''));
  const post = (text, host) => {
    if (!discordOn()) return;
    const ping = /^\d{15,22}$/.test(String(C.discordPingRoleId || '')) ? String(C.discordPingRoleId) : '';
    const body = {
      content: `${ping ? `<@&${ping}> ` : ''}**Event**${host ? ` hosted by ${md(host)}` : ''}\n${md(text)}`.slice(0, 1900),
      allowed_mentions: { parse: [], roles: ping ? [ping] : [] },
    };
    sendJson('POST', `https://discord.com/api/v10/channels/${C.discordChannelId}/messages`, body, { Authorization: `Bot ${api.token}` })
      .then(() => {}, (e) => log('events: Discord post failed', e.message));
  };
  const USAGE = 'Usage: /event <message>. Every online player sees it on screen and in chat. Say where, or give a clue.';
  const announce = (a, raw) => {
    if (!C.enabled) return personal(a, 'Event announcements are off right now.');
    if (!isStaff(a) && !isHost(a)) return personal(a, 'Only staff and event hosts can announce events.');
    const text = clean(raw);
    if (!text) return personal(a, USAGE);
    if (text.length < (Number(C.minText) || 0)) return personal(a, `Say a little more (at least ${C.minText} characters).`);
    if (text.length > (Number(C.maxText) || 300)) return personal(a, `At most ${C.maxText} characters, please.`);
    const t = now(); const key = Number(profileOf(a));
    const mineLeft = (R.last.get(key) || 0) + (Number(C.cooldownSeconds) || 0) * 1000 - t;
    const anyLeft = R.lastAny + (Number(C.globalCooldownSeconds) || 0) * 1000 - t;
    const left = Math.max(mineLeft, anyLeft);
    if (left > 0) return personal(a, `${mineLeft >= anyLeft ? 'You announced an event' : 'An event was announced'} a moment ago. Try again in ${Math.ceil(left / 1000)} s.`);
    R.last.set(key, t); R.lastAny = t;
    if (R.last.size > 500) for (const [k, at] of R.last) if (t - at > 3600000) R.last.delete(k);
    const host = C.showHost ? realNameOf(a) : '';
    const line = `Event: ${text}${host ? ` (hosted by ${host})` : ''}`;
    const all = onlineActors();
    // one line a player: the client reads only the last chat line of a tick, so a second would hide the [[S]] overlay
    for (const o of all) system(o, line);
    post(text, host);
    audit(`EVENT ${who(a)}${isStaff(a) ? '' : ' (event host role)'} to ${all.length} online${discordOn() ? ' and Discord' : ''}: ${text}`);
    log(`events: ${who(a)} announced to ${all.length} player(s)`);
  };
  // Not admin-flagged, so a role-only host passes the chat gate; announce checks the right itself. Hidden from player /help
  registerChatCommand('event', (a, args) => announce(a, args), { hidden: true, help: '<message> announce an event to every online player (staff, event hosts)' });

  // ---- /chars #TAG -----------------------------------------------------------------------------------------------------
  const live = (id) => !(typeof globalThis.__dboFormGone === 'function' && globalThis.__dboFormGone(id));
  const accountChars = (pid) => { try { return (mp.getActorsByProfileId(pid) || []).map((x) => Number(x) >>> 0).filter((x) => x && live(x)); } catch (e) { return []; } };
  const charsOf = (a, raw) => {
    const q = String(raw || '').trim();
    if (!/^#[A-Za-z0-9]{4}$/.test(q)) return personal(a, 'Usage: /chars #TAG (any one character of the account)');
    let t = findByName(q); if (t && String(tagOf(t)).toLowerCase() !== q.slice(1).toLowerCase()) t = 0;
    t = t || offlineByTag(q);
    if (!t) return personal(a, `No character carries ${q.toUpperCase()}.`);
    const pid = Number(profileOf(t));
    const list = pid >= 0 ? accountChars(pid) : [t];
    if (!list.includes(t >>> 0)) list.push(t >>> 0);
    list.sort((x, y) => Number(userOf(y) >= 0) - Number(userOf(x) >= 0) || x - y);
    personal(a, `${list.length} character${list.length === 1 ? '' : 's'} on that account:`);
    for (const c of list.slice(0, 20)) personal(a, `${realNameOf(c)} #${tagOf(c)}${userOf(c) >= 0 ? ' (online)' : ''}`);
    personal(a, 'Rename one with /rename #TAG <new name>.');
  };
  registerChatCommand('chars', (a, args) => charsOf(a, args), { admin: true, help: '#TAG every character of that account, with their #TAGs (pick one to /rename)' });

  return { announce, charsOf };
};
