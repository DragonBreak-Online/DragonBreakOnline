// DragonBreak Online: player guilds, the third tier under the lore factions and the chartered ones. Loaded by gamemode.js.
//
// Nate, 21 Oct: "Guilds: informal player groups with no dedicated RP or lore purpose. Guilds get NONE of the faction
// powers." Any player makes one on the spot, no GM approval, at most 10 members including the Guildmaster, one guild per
// character. A guild is a faction of kind 'band' in guilds.js (never the lore kind 'guild': the Fighters Guild is one of
// those), so the F3 Faction tab and the rosters show it with no client release, while __dboGuildsOf - which every power
// reads - leaves bands out.
//
// EXCLUSIVE WITH FACTIONS (Nate, later the same day: "so people can organize themselves loosely"): a member of any
// faction cannot make or join a guild, and a guild member cannot take a faction rank. A faith or a magic college may
// stand beside a guild (config playerGuilds.compatibleKinds / compatibleIds / collegesCompatible). guilds.js holds that
// rule inside setMember, which every join, promotion and charter seat goes through.
//
// Commands, in the /charter style. Players: /guild create <name> | invite <player> | accept | decline | leave |
//   kick <player> | promote <player> | demote <player> | rename <name> | disband | show | list
// Staff: /guild dissolve <id> <reason>, and /guild list shows every guild.
// Everything is audited, and each step goes to the staff Discord log as charters do.
'use strict';

module.exports = (api) => {
  const { log, personal, system, audit, who, display, nameOf, cfg, registerChatCommand, findByName, onlineActors, isAdmin } = api;
  const staffNote = typeof api.staffNote === 'function' ? api.staffNote : () => {};
  const C = Object.assign({ enabled: true, maxMembers: 10, inviteMinutes: 10 }, (cfg && cfg.playerGuilds) || {});
  const fn = (n) => (typeof globalThis[n] === 'function' ? globalThis[n] : null);

  // Invitations live in globalThis so a hot reload keeps them (gamemode.js reloads this module on every write)
  const S = globalThis.__dboPlayerGuildState || (globalThis.__dboPlayerGuildState = { invites: new Map() });
  const INVITE_MS = () => Math.max(1, Number(C.inviteMinutes) || 10) * 60000;
  const invitesOf = (t) => (S.invites.get(t >>> 0) || []).filter((i) => Date.now() - i.at < INVITE_MS());

  const bandOf = (a) => (fn('__dboBandOf') ? fn('__dboBandOf')(a) : null);
  const bands = () => (fn('__dboBands') ? fn('__dboBands')() : []);
  const maxMembers = () => (fn('__dboBandMaxMembers') ? fn('__dboBandMaxMembers')() : Number(C.maxMembers) || 10);
  const isMaster = (a) => { const b = bandOf(a); return !!b && b.rank === 0; };
  const isOfficer = (a) => { const b = bandOf(a); return !!b && b.rank <= 1; };
  const note = (a, what, detail) => { try { staffNote(a, what, detail); } catch (e) { /* no staff channel */ } };

  const create = (a, name) => {
    if (!fn('__dboBandCreate')) return personal(a, 'Guilds are not available right now.');
    const blocked = fn('__dboBandBlocked') ? fn('__dboBandBlocked')(a) : '';
    if (blocked) return personal(a, blocked);
    const raw = String(name || '').trim();
    if (!raw) return personal(a, 'Usage: /guild create <name>');
    // The charter's own name check: blocked words, reserved names, the lore factions and places, the Princes and deities.
    // If charters.js is not loaded there is NO check, so no guild is made: an unchecked name is worse than none.
    if (!fn('__dboCharterNameCheck')) return personal(a, 'Guild names cannot be checked right now (the charter system is not loaded), so none can be founded. Tell staff.');
    const check = fn('__dboCharterNameCheck')(raw, 'company');
    if (check && check.error) return personal(a, check.error);
    const made = fn('__dboBandCreate')(a, (check && check.name) || raw);
    if (made.error) return personal(a, made.error);
    audit(`GUILD ${who(a)} founded the guild ${made.name} (${made.id})`);
    note(a, '/guild create', `founded the guild ${made.name} (${made.id})`);
    personal(a, `${made.name} is founded, and you are its Guildmaster. /guild invite <player> brings someone in; a guild holds ${maxMembers()}.`);
    return personal(a, 'It shows on your Faction tab. A guild has no hall, no uniform, no treasury and no lands: it is a group of players, nothing more.');
  };

  const invite = (a, q) => {
    const b = bandOf(a);
    if (!b) return personal(a, 'You are in no guild. /guild create <name> makes one.');
    if (!isOfficer(a)) return personal(a, `Only ${b.name}'s Guildmaster and its Officers invite.`);
    const t = findByName(String(q || ''));
    if (!t) return personal(a, 'Usage: /guild invite <player|#TAG>   (they must be in the game)');
    if (t === (a >>> 0)) return personal(a, 'You are already in it.');
    if (bandOf(t)) return personal(a, `${nameOf(t)} is already in a guild.`);
    const blocked = fn('__dboBandBlocked') ? fn('__dboBandBlocked')(t) : '';
    if (blocked) return personal(a, `${nameOf(t)} cannot join a guild: ${blocked.replace(/^You belong/, 'they belong').replace(/\byour\b/, 'their')}`);
    const members = (bands().find((x) => x.id === b.id) || {}).members || 0;
    if (members >= maxMembers()) return personal(a, `${b.name} is full: a guild holds ${maxMembers()}, its Guildmaster included.`);
    const list = invitesOf(t).filter((i) => i.fid !== b.id);
    list.push({ fid: b.id, name: b.name, by: nameOf(a), at: Date.now() });
    S.invites.set(t >>> 0, list);
    audit(`GUILD ${who(a)} invited ${who(t)} to ${b.name}`);
    system(t, `${nameOf(a)} invites you into the guild ${b.name}. /guild accept, or /guild decline.`);
    return personal(a, `You invited ${nameOf(t)} to ${b.name}.`);
  };

  const accept = (a) => {
    const i = invitesOf(a)[0];
    if (!i) return personal(a, 'Nobody has invited you to a guild.');
    S.invites.delete(a >>> 0);
    if (!fn('__dboGuildInvite')) return personal(a, 'Guilds are not available right now.');
    // guilds.js's own join, so the cap, the one-guild rule and the faction rule all hold
    const r = fn('__dboBandJoin') ? fn('__dboBandJoin')(a, i.fid) : { error: 'Guilds are not available right now.' };
    if (r.error) return personal(a, r.error);
    audit(`GUILD ${who(a)} joined ${i.name}`);
    return personal(a, `You are a Member of ${i.name}.`);
  };
  const decline = (a) => { const i = invitesOf(a)[0]; S.invites.delete(a >>> 0); return personal(a, i ? `You declined ${i.name}.` : 'Nobody has invited you to a guild.'); };

  const show = (a) => {
    const b = bandOf(a);
    if (!b) return personal(a, `You are in no guild. /guild create <name> makes one; a guild holds ${maxMembers()}.`);
    const g = bands().find((x) => x.id === b.id) || {};
    personal(a, `${b.name}: you are its ${b.title}. ${g.members || 1} of ${maxMembers()} members, Guildmaster ${g.master || '?'}.`);
    return personal(a, 'The roster, kicks and ranks are on your Faction tab. /guild leave steps out; a Guildmaster hands over first, or /guild disband closes it.');
  };

  const list = (a) => {
    const all = bands();
    if (!all.length) return personal(a, 'There are no guilds yet.');
    personal(a, `${all.length} guild${all.length === 1 ? '' : 's'}:`);
    for (const g of all.slice(0, isAdmin(a) ? 60 : 20)) personal(a, `  ${g.name}${isAdmin(a) ? ` (${g.id})` : ''}: ${g.members} of ${maxMembers()}, led by ${g.master || '?'}`);
    return undefined;
  };

  registerChatCommand('guild', (a, args) => {
    const [sub, ...rest] = String(args || '').trim().split(/\s+/);
    const s = (sub || '').toLowerCase();
    const body = rest.join(' ').trim();
    if (C.enabled === false && s !== 'list') return personal(a, 'Guilds are closed right now.');
    if (!s || s === 'show') return show(a);
    if (s === 'create') return create(a, body);
    if (s === 'invite') return invite(a, rest[0]);
    if (s === 'accept') return accept(a);
    if (s === 'decline') return decline(a);
    if (s === 'list') return list(a);
    if (s === 'dissolve') {
      if (!isAdmin(a)) return personal(a, 'Staff only.');
      const id = rest[0]; const why = rest.slice(1).join(' ').trim();
      if (!id || !why) return personal(a, 'Usage: /guild dissolve <guild id> <reason>   (/guild list shows the ids)');
      const r = fn('__dboBandDissolve') ? fn('__dboBandDissolve')(id) : { error: 'Guilds are not available right now.' };
      if (r.error) return personal(a, r.error);
      audit(`GUILD GM ${who(a)} dissolved ${r.name} (${id}): ${why}`);
      note(a, '/guild dissolve', `dissolved the guild ${r.name} (${id}): ${why}`);
      for (const m of r.members) if (onlineActors().includes(m)) system(m, `${r.name} has been dissolved by staff: ${why}`);
      return personal(a, `${r.name} is dissolved.`);
    }
    const b = bandOf(a);
    if (!b) return personal(a, 'You are in no guild. /guild create <name> makes one.');
    if (s === 'leave') {
      if (isMaster(a) && ((bands().find((x) => x.id === b.id) || {}).members || 1) > 1) {
        return personal(a, `A Guildmaster hands ${b.name} to someone else first (your Faction tab sets ranks), or /guild disband closes it.`);
      }
      const r = fn('__dboGuildLeave') ? fn('__dboGuildLeave')(a, b.id) : 'Guilds are not available right now.';
      audit(`GUILD ${who(a)} left ${b.name}`);
      // The last one out closes it, so an empty guild never holds its name
      if (((bands().find((x) => x.id === b.id) || {}).members || 0) === 0 && fn('__dboBandDissolve')) {
        fn('__dboBandDissolve')(b.id);
        audit(`GUILD ${b.name} closed: its last member left`);
        return personal(a, `You left ${b.name}, and with nobody in it the guild is closed.`);
      }
      return personal(a, typeof r === 'string' ? r : `You left ${b.name}.`);
    }
    if (s === 'kick' || s === 'promote' || s === 'demote') {
      const t = findByName(rest[0] || '');
      if (!t) return personal(a, `Usage: /guild ${s} <player|#TAG>   (they must be in the game; the Faction tab does it for anyone)`);
      const tb = bandOf(t);
      if (!tb || tb.id !== b.id) return personal(a, `${nameOf(t)} is not in ${b.name}.`);
      if (s === 'kick') {
        if (!isOfficer(a)) return personal(a, `Only ${b.name}'s Guildmaster and its Officers remove members.`);
        const r = fn('__dboGuildKick') ? fn('__dboGuildKick')(a, b.id, t) : { error: 'Guilds are not available right now.' };
        if (r.error) return personal(a, r.error);
        audit(`GUILD ${who(a)} removed ${who(t)} from ${b.name}`);
        return personal(a, r.text || `${nameOf(t)} is out of ${b.name}.`);
      }
      if (!isMaster(a)) return personal(a, `Only ${b.name}'s Guildmaster sets its ranks.`);
      const want = s === 'promote' ? Math.max(0, tb.rank - 1) : Math.min(2, tb.rank + 1);
      if (want === tb.rank) return personal(a, `${nameOf(t)} is already ${tb.title}.`);
      const r = fn('__dboGuildSetRank') ? fn('__dboGuildSetRank')(a, b.id, t, want, false) : { error: 'Guilds are not available right now.' };
      if (r.error) return personal(a, r.error);
      audit(`GUILD ${who(a)} made ${who(t)} rank ${want} of ${b.name}`);
      return personal(a, r.text || `${nameOf(t)} is set.`);
    }
    if (s === 'rename') {
      if (!isMaster(a)) return personal(a, `Only ${b.name}'s Guildmaster renames it.`);
      if (!body) return personal(a, 'Usage: /guild rename <name>');
      if (!fn('__dboCharterNameCheck')) return personal(a, 'Guild names cannot be checked right now, so none can be renamed. Tell staff.');
      const check = fn('__dboCharterNameCheck')(body, 'company');
      if (check && check.error) return personal(a, check.error);
      const r = fn('__dboBandRename')(b.id, (check && check.name) || body);
      if (r.error) return personal(a, r.error);
      audit(`GUILD ${who(a)} renamed ${r.was} to ${r.name}`);
      note(a, '/guild rename', `renamed the guild ${r.was} to ${r.name}`);
      return personal(a, `${r.was} is called ${r.name} now.`);
    }
    if (s === 'disband') {
      if (!isMaster(a)) return personal(a, `Only ${b.name}'s Guildmaster closes it.`);
      const r = fn('__dboBandDissolve')(b.id);
      if (r.error) return personal(a, r.error);
      audit(`GUILD ${who(a)} disbanded ${r.name}`);
      note(a, '/guild disband', `disbanded the guild ${r.name} (${b.id})`);
      for (const m of r.members) if (m !== (a >>> 0) && onlineActors().includes(m)) system(m, `${r.name} has been disbanded by its Guildmaster.`);
      return personal(a, `${r.name} is closed.`);
    }
    return personal(a, 'Guilds: /guild create <name> | invite <player> | accept | decline | show | list | leave | kick <player> | promote <player> | demote <player> | rename <name> | disband'
      + (isAdmin(a) ? ' | dissolve <id> <reason> (staff)' : ''));
  }, { help: '<create|invite|accept|show|list|leave|kick|promote|demote|rename|disband>: an informal player guild, up to ' + (Number(C.maxMembers) || 10) });

  log(`player guilds: ${C.enabled === false ? 'OFF' : `on, up to ${maxMembers()} members`}, ${bands().length} guild(s)`);
  return { create, invite, accept, show, list };
};
