// DragonBreak Online: the staff rules from the owner's staff-conduct review (23 Oct 2026). Loaded by gamemode.js.
//
// A staff tier comes from Discord roles per profile, so every character of a staff member carried GM powers. This file
// decides, for gamemode.js, the gameplay modules and the fork's AdminSystem / HousingSystem (globalThis.__dboAdminGate):
//   staffCharOnly  staff powers only on a staff character (private.dboStaffChar): invisibility, ghost, noclip, freecam,
//                  teleports, /realnames, the housing and key-ring staff override, the admin panel's world-changing actions
//                  and the item, skill and power grants. GM calls, the admin chat and /bugs still work. The panel's modes are
//                  cleared when the profile comes in on another character, or on a character that is not a staff one.
//   selfTarget     staff tools never act on the acting staff member's own account; on another staff member's account only
//                  a Lead GM or above acts, and each such use is audited.
//                  ownAccount false lifts the first half only: staff may use the tools on their own characters.
//   callRef        faction and rank changes, offices, renames and citizenship changes done by staff on another player need an
//                  open GM call or a ticket: call:<n> or ticket:<id> in the command, /staffref <call n|ticket id> <player>
//                  for the panels, or the player's own open call taken by the staff member. The reference goes in the audit.
//   trialLimits    a Trial GM goes to no place, reopens no character creation, and goes to a player only while holding
//                  that player's open GM call.
// The Owners (exemptTiers, 'senior') and exemptProfiles pass every rule. /staffchar marks the staff characters (Lead GM and
// above, never on their own account; the Owners on any), and so does the F7 panel's staffChar action.
//
// gamemode-config.json "staffPowers": { enabled, exemptTiers, exemptProfiles, seedTags, seedMissing, staffCharOnly: { enabled,
// rights, commands, panelAllowed, kinds, clearModes }, selfTarget: { enabled, staffNeedsLead }, callRef: { enabled, commands, kinds,
// bindMinutes }, trialLimits: { enabled } }. Each switch off and a hot reload undoes its rule.
'use strict';

module.exports = (api) => {
  const { mp, log, audit, who, display, personal, profileOf, tierOf, staffTierOf, isLeadStaff, staffCharOf,
    accountRankOf, findByName, offlineByTag, registerChatCommand, cfg } = api;
  const RAW = (cfg && cfg.staffPowers) || {};
  const part = (k, d) => Object.assign({}, d, RAW[k] && typeof RAW[k] === 'object' ? RAW[k] : {});
  const ON = RAW.enabled !== false;
  const CHAR = part('staffCharOnly', {
    enabled: true, clearModes: true,
    // staffCan rights (gamemode.js TRIAL_CAN) that need a staff character
    rights: ['tp', 'invis', 'realnames'],
    // chat commands, or "command verb", refused on any other character
    commands: ['tp', 'realnames', 'gm goto', 'grantproperty', 'grantappearance', 'manual grant', 'smithing teach', 'smithing forget',
      'schools set', 'enchant apply', 'makesuper', 'curse', 'beastform', 'polymorph'],
    // F7 panel actions that still work there (moderation; the menu itself always opens)
    panelAllowed: ['kick', 'ban', 'tempBan', 'ipBan', 'unban', 'deleteCharacter', 'staffChar'],
    // staff tool kinds (target below) that are grants, refused on any other character
    kinds: ['items', 'skills', 'powers'],
  });
  const SELF = part('selfTarget', { enabled: true, ownAccount: true, staffNeedsLead: true });
  const REF = part('callRef', {
    enabled: true, bindMinutes: 60,
    // commands whose call:<n> / ticket:<id> words are taken out and kept for the action they run
    commands: ['rename', 'faction', 'appoint', 'dismiss', 'citizenship', 'staffref'],
    // the kinds of staff action on another player that need one (the callers name the kind)
    kinds: ['rename', 'faction', 'office', 'citizenship'],
  });
  const TRIAL = part('trialLimits', { enabled: true });
  const EXEMPT_TIERS = new Set(Array.isArray(RAW.exemptTiers) ? RAW.exemptTiers.map(String) : ['senior']);
  const EXEMPT_PROFILES = new Set((Array.isArray(RAW.exemptProfiles) ? RAW.exemptProfiles : []).map(Number).filter(Number.isFinite));
  // The staff characters named by the review of 23 Oct; /staffchar seed marks them once
  const SEED_TAGS = Array.isArray(RAW.seedTags) ? RAW.seedTags.map(String) : ['D3EP', 'S4PZ', '38XK'];
  const SEED_MISSING = Array.isArray(RAW.seedMissing) ? RAW.seedMissing : [{ profile: 51, name: 'Choom' }, { profile: 97, name: 'Neem' }];
  const has = (list, cmd, sub) => Array.isArray(list) && (list.includes(cmd) || list.includes(sub));
  const S = globalThis.__dboStaffGuardState || (globalThis.__dboStaffGuardState = { binds: new Map(), ambient: null });

  const NOT_HERE = 'Staff powers work only on your staff character. GM calls, the admin chat and /bugs still reach you here.';
  const SELF_NO = 'Staff tools never act on your own characters. Ask another member of staff.';
  const REF_NO = 'This needs an open GM call or a ticket: add call:<n> or ticket:<id> to the command, take the player\'s GM call (/gm take <n>), or use /staffref first.';

  const pidOf = (a) => { const p = Number(profileOf(a)); return Number.isSafeInteger(p) ? p : -1; };
  const exempt = (a) => { try { return EXEMPT_PROFILES.has(pidOf(a)) || EXEMPT_TIERS.has(String(tierOf(a))); } catch (e) { return false; } };
  const isStaffChar = (a) => { try { return staffCharOf(a) === true; } catch (e) { return false; } };
  // Whether this character carries its owner's staff powers
  const powersOn = (a) => !ON || !CHAR.enabled || exempt(a) || isStaffChar(a);
  const isStaffAccount = (a) => { try { return !!staffTierOf(a); } catch (e) { return false; } };
  const trialOf = (a) => { try { return staffTierOf(a) === 'trialgm'; } catch (e) { return false; } };

  // ---- GM calls and ticket references ---------------------------------------------------------------------------------
  const calls = () => { const c = globalThis.__dboGmCalls; return c && Array.isArray(c.open) ? c.open : []; };
  const openCall = (n) => calls().find((c) => Number(c.n) === Number(n)) || null;
  // The open call from this player's account that the staff member holds
  const heldCallFor = (a, pt) => calls().find((c) => Number(c.profile) === pt && c.takenBy && Number(c.takenBy.profile) === pidOf(a)) || null;
  const parseRef = (word) => {
    const m = String(word || '').trim().match(/^(call|ticket):#?(\S{1,60})$/i);
    if (!m) return null;
    if (m[1].toLowerCase() === 'call') return /^\d+$/.test(m[2]) ? { kind: 'call', n: Number(m[2]) } : null;
    return /^[A-Za-z0-9_\-#./]+$/.test(m[2]) ? { kind: 'ticket', id: m[2] } : null;
  };
  const refText = (r) => (r.kind === 'call' ? `GM call #${r.n}` : `ticket ${r.id}`);
  // { text } for the reference this action runs under, { error } for a named call that is not open, null for none
  const refFor = (a, pt) => {
    const amb = S.ambient;
    if (amb && amb.a === (a >>> 0)) {
      if (amb.ref.kind === 'call' && !openCall(amb.ref.n)) return { error: `GM call #${amb.ref.n} is not open.` };
      return { text: refText(amb.ref) };
    }
    const b = S.binds.get(`${pidOf(a)}:${pt}`);
    if (b && b.until > Date.now()) {
      if (b.ref.kind === 'call' && !openCall(b.ref.n)) S.binds.delete(`${pidOf(a)}:${pt}`);
      else return { text: refText(b.ref) };
    }
    const held = heldCallFor(a, pt);
    return held ? { text: `GM call #${held.n} (held)` } : null;
  };

  // ---- the rules ----------------------------------------------------------------------------------------------------
  // '' when staff member a may use a staff tool of this kind on character t (an actor id, offline too), else the refusal
  const target = (a, t, kind) => {
    if (!ON) return '';
    a >>>= 0;
    if (exempt(a)) return '';
    if (CHAR.enabled && Array.isArray(CHAR.kinds) && CHAR.kinds.includes(kind) && !powersOn(a)) return NOT_HERE;
    const pa = pidOf(a);
    const pt = typeof t === 'object' && t ? Number(t.profile) : pidOf(Number(t) >>> 0);
    const tActor = typeof t === 'object' && t ? 0 : Number(t) >>> 0;
    if (!Number.isSafeInteger(pt) || pt < 0) return '';
    if (SELF.enabled && SELF.ownAccount !== false && pt === pa) return SELF_NO;
    let staffAccount = false;
    if (SELF.enabled && SELF.staffNeedsLead && pt !== pa && typeof accountRankOf === 'function') {
      const rank = accountRankOf(pt, null, tActor || undefined);
      if (rank < 0) return 'That account\'s rank cannot be read, so the staff tool is refused.';
      staffAccount = rank > 0;
      if (staffAccount && !isLeadStaff(a)) return 'Only a Lead GM or above uses staff tools on another staff member\'s characters.';
    }
    const label = tActor ? who(tActor) : `profile ${pt}`;
    if (REF.enabled && Array.isArray(REF.kinds) && REF.kinds.includes(kind)) {
      const r = refFor(a, pt);
      if (!r) return REF_NO;
      if (r.error) return r.error;
      audit(`STAFFREF ${who(a)} ${kind} on ${label} under ${r.text}`);
    }
    if (staffAccount) audit(`STAFFGUARD ${who(a)} used a staff tool (${kind}) on the staff account of ${label}`);
    return '';
  };
  // Trial GM: a player only while holding that player's open call
  const trialMayReach = (a, t) => !!heldCallFor(a, pidOf(Number(t) >>> 0));
  const rightOk = (a, what) => powersOn(a) || !has(CHAR.rights, what, what);

  // A chat command before it runs: { refuse } or { body, ref }. Never refuses for a missing reference (the action does)
  const command = (a, cmd, sub, body) => {
    if (!ON) return null;
    if (CHAR.enabled && has(CHAR.commands, cmd, sub) && isStaffAccount(a) && !powersOn(a)) return { refuse: NOT_HERE };
    if (TRIAL.enabled && trialOf(a) && !exempt(a)) {
      if (cmd === 'chargen') return { refuse: 'A Trial GM does not reopen character creation, their own included.' };
      if (cmd === 'tp') {
        const t = findByName(String(body || '').trim());
        if (t && !trialMayReach(a, t)) return { refuse: 'A Trial GM goes only to a player whose GM call they hold: /gm take <n>, then /gm goto <n>.' };
      }
    }
    if (!REF.enabled || !has(REF.commands, cmd, sub)) return null;
    let ref = null;
    const words = String(body || '').split(/\s+/).filter((w) => { const r = parseRef(w); if (r && !ref) { ref = r; return false; } return !r; });
    return ref ? { body: words.join(' '), ref } : null;
  };
  // The reference a command line carried, for the action it runs; the function returned puts the previous one back
  const enter = (a, ref) => { const prev = S.ambient; S.ambient = ref ? { a: a >>> 0, ref } : null; return () => { S.ambient = prev; }; };
  const withRef = (a, ref, fn) => { const end = enter(a, ref); try { return fn(); } finally { end(); } };
  // /gm goto <n> (gmcall.js), before it moves anyone
  const gotoRefusal = (a, c) => {
    if (!ON) return '';
    if (CHAR.enabled && !powersOn(a)) return NOT_HERE;
    if (TRIAL.enabled && trialOf(a) && !exempt(a) && c && c.takenBy && Number(c.takenBy.profile) !== pidOf(a)) return `GM call #${c.n} is held by ${c.takenBy.name}. A Trial GM goes only on a call they hold.`;
    return '';
  };

  // F7 panel actions and the housing override (fork AdminSystem / HousingSystem). '' lets it through
  const PANEL_KIND = {
    masteryGrant: 'skills', masteryReset: 'skills', masterySetTier: 'skills', masteryDrop: 'skills', setSchool: 'skills',
    giveItem: 'items', giveWerewolf: 'powers', giveVampireLord: 'powers', giveDisease: 'powers', giveCurse: 'powers', beastForm: 'powers',
  };
  // Panel bans (Nat, 25 Oct: Lead GMs ban from the F7 panel too). The rank rule /discipline and /kick use (gamemode.js
  // rankRefusalOf, passed as rankRefusal): never the caller's own account nor a staff account of the caller's rank or higher,
  // and refused when that cannot be read or the rule is missing (fails closed). A GM's panel temp ban is held to discipline.js
  // gmMaxSuspendDays (3 days), and a GM never bans for good. A punishment rule, not a staff power: it runs before every
  // staffPowers switch and for the Owners too, as /discipline does. The fork logs each refusal (adminLog); nothing is audited here
  const BAN_ACTIONS = new Set(['ban', 'tempBan', 'ipBan']);
  const disc = (cfg && typeof cfg.discipline === 'object' && cfg.discipline) || {};
  const GM_BAN_HOURS = 24 * Math.min(Number(disc.gmMaxSuspendDays) > 0 ? Number(disc.gmMaxSuspendDays) : 3,
    Number(disc.maxSuspendDays) > 0 ? Number(disc.maxSuspendDays) : 30);
  const banRefusal = (a, action, info) => {
    const t = Number(info.target) >>> 0;
    let no = 'unknown';
    try { no = t && typeof api.rankRefusal === 'function' ? api.rankRefusal(a, t) : 'unknown'; } catch (e) { log('staffguard: rank rule failed', e.message); no = 'unknown'; }
    if (no === 'own') return 'You cannot ban your own account.';
    if (no === 'rank') return `${display(t)} is on a staff account of your rank or higher, so you cannot ban it. Take it to someone above that rank, or to the Owners.`;
    if (no) return 'The staff rank of that account could not be read, so nothing was banned. Try again, or ask an Owner.';
    let tier = null; try { tier = tierOf(a); } catch (e) { tier = null; }
    if (tier === null) return 'Only staff ban players.';
    if (tier === 'gm') {
      if (action !== 'tempBan') return `Bans are for Lead GMs and above. A GM can temp ban for up to ${GM_BAN_HOURS} hours.`;
      const hours = Number(info.hours);
      if (!(Number.isFinite(hours) && hours > 0)) return 'The panel did not say how long the temp ban is, so it was not given. Use /tempban #TAG <12h|3d> <reason>.';
      if (hours > GM_BAN_HOURS) return `A GM can temp ban for at most ${GM_BAN_HOURS} hours (${GM_BAN_HOURS / 24} days). For longer, ask a Lead GM.`;
    }
    return '';
  };
  const adminGate = (a, action, info) => {
    a = Number(a) >>> 0; info = info || {};
    // The fork lets an action through when this throws, so the ban rule answers for itself
    if (BAN_ACTIONS.has(action)) { let no = ''; try { no = banRefusal(a, action, info); } catch (e) { no = 'The ban could not be checked, so it was not given.'; } if (no) return no; }
    if (!ON) return '';
    if (action === 'assign') return CHAR.enabled && CHAR.clearModes && !exempt(a) && (!isStaffChar(a) || info.changed === true) ? 'clear' : '';
    if (action === 'housing') return CHAR.enabled && !powersOn(a) ? NOT_HERE : '';
    if (CHAR.enabled && !powersOn(a) && !(Array.isArray(CHAR.panelAllowed) && CHAR.panelAllowed.includes(action))) return NOT_HERE;
    if (TRIAL.enabled && (info.trial === true || trialOf(a)) && !exempt(a)) {
      if (action === 'teleportLoc') return 'A Trial GM goes to players on their GM calls, not to places.';
      if (action === 'teleportTo' && !trialMayReach(a, info.target)) return 'A Trial GM goes only to a player whose GM call they hold: take the call first.';
    }
    const kind = PANEL_KIND[action];
    if (kind && info.target) return target(a, Number(info.target) >>> 0, kind);
    return '';
  };

  // ---- marking staff characters ----------------------------------------------------------------------------------------
  const findChar = (q) => { const s = String(q || '').trim(); if (!s) return 0; return (findByName(s) || offlineByTag(s) || offlineByTag(`#${s.replace(/^#/, '')}`) || 0) >>> 0; };
  const setStaffChar = (a, t, on) => {
    a >>>= 0; t >>>= 0;
    if (!exempt(a) && !isLeadStaff(a)) return { ok: false, text: 'Only a Lead GM or above marks staff characters.' };
    if (!exempt(a) && pidOf(t) === pidOf(a)) return { ok: false, text: 'Another Lead GM or an Owner marks your own staff character.' };
    if (isStaffChar(t) === !!on) return { ok: true, text: `${display(t)} is ${on ? 'already' : 'not'} a staff character.` };
    try { mp.set(t, 'private.dboStaffChar', !!on); } catch (e) { return { ok: false, text: `That did not work: ${e.message}` }; }
    audit(`STAFFCHAR ${who(a)} ${on ? 'marked' : 'unmarked'} ${who(t)} as a staff character`);
    try { personal(t, on ? 'This character is now your staff character: staff powers work here.' : 'This character is no longer a staff character: staff powers stop here (any mode ends at your next login).'); } catch (e) { /* offline */ }
    return { ok: true, text: `${display(t)} is ${on ? 'now' : 'no longer'} a staff character.` };
  };

  if (typeof registerChatCommand === 'function') {
    registerChatCommand('staffchar', (a, args) => {
      const words = String(args || '').trim().split(/\s+/).filter(Boolean);
      const verb = (words.shift() || '').toLowerCase();
      if (!verb) return personal(a, `${display(a)} is ${isStaffChar(a) ? '' : 'not '}a staff character. Staff powers here: ${powersOn(a) ? 'on' : 'off'}.${exempt(a) ? ' (Owner: every rule passes.)' : ''}`);
      if (verb === 'set' || verb === 'clear') {
        const t = findChar(words.join(' '));
        if (!t) return personal(a, 'No character by that name or #TAG (an offline one: its #TAG).');
        return personal(a, setStaffChar(a, t, verb === 'set').text);
      }
      if (verb === 'seed') {
        if (!exempt(a) && !isLeadStaff(a)) return personal(a, 'Only a Lead GM or above marks staff characters.');
        for (const tag of SEED_TAGS) {
          const t = findChar(`#${tag}`);
          if (!t) { personal(a, `#${tag}: not found.`); continue; }
          if (pidOf(t) === pidOf(a) && !exempt(a)) { personal(a, `#${tag}: your own account, for someone else to mark.`); continue; }
          personal(a, `#${tag}: ${setStaffChar(a, t, true).text}`);
        }
        for (const m of SEED_MISSING) personal(a, `Profile ${m.profile}${m.name ? ` (${m.name})` : ''} has no staff character yet: they need one before their staff powers work.`);
        return;
      }
      if (verb === 'list') {
        const online = (api.onlineActors ? api.onlineActors() : []).filter((x) => staffTierOf(x));
        personal(a, `Staff online: ${online.map((x) => `${display(x)} (${staffTierOf(x)}${isStaffChar(x) ? ', staff character' : exempt(x) ? ', Owner' : ', NOT a staff character'})`).join('; ') || 'none'}`);
        return personal(a, `Seed list: ${SEED_TAGS.map((t) => `#${t}`).join(', ')}. No staff character yet: ${SEED_MISSING.map((m) => `profile ${m.profile}${m.name ? ` ${m.name}` : ''}`).join(', ') || 'none'}.`);
      }
      personal(a, 'Use /staffchar [set|clear <name|#TAG>] | list | seed');
    }, { admin: true, help: '[set|clear <name|#TAG>] | list | seed: mark the staff characters, where staff powers work (Lead GM+)' });

    registerChatCommand('staffref', (a, args) => {
      const words = String(args || '').trim().split(/\s+/).filter(Boolean);
      const amb = S.ambient && S.ambient.a === (a >>> 0) ? S.ambient.ref : null;
      const ref = amb || (words.length ? parseRef(words[0]) || parseRef(/^\d{1,6}$/.test(words[0]) ? `call:${words[0]}` : `ticket:${words[0]}`) : null);
      if (!amb && ref) words.shift();
      if (!ref || !words.length) {
        const mine = [...S.binds].filter(([k, b]) => k.startsWith(`${pidOf(a)}:`) && b.until > Date.now());
        personal(a, 'Use /staffref <call number|ticket id> <player|#TAG>: the staff tools you use on that player for the next while run under it.');
        return mine.length ? personal(a, `Yours: ${mine.map(([k, b]) => `profile ${k.split(':')[1]} under ${refText(b.ref)}`).join('; ')}`) : undefined;
      }
      if (ref.kind === 'call' && !openCall(ref.n)) return personal(a, `GM call #${ref.n} is not open.`);
      const t = findChar(words.join(' '));
      if (!t) return personal(a, 'No character by that name or #TAG.');
      const mins = Math.max(1, Number(REF.bindMinutes) || 60);
      S.binds.set(`${pidOf(a)}:${pidOf(t)}`, { ref, until: Date.now() + mins * 60000 });
      audit(`STAFFREF ${who(a)} works on ${who(t)} under ${refText(ref)} for ${mins} minutes`);
      personal(a, `For ${mins} minutes your staff tools on ${display(t)}'s account run under ${refText(ref)}.`);
    }, { admin: true, help: '<call number|ticket id> <player|#TAG>: the GM call (a number of up to 6 digits) or ticket your staff changes to that player run under (faction, rank, office, rename, citizenship)' });
  }

  const G = { powersOn, rightOk, command, enter, withRef, target, gotoRefusal, adminGate, setStaffChar, isStaffChar, exempt, NOT_HERE };
  globalThis.__dboStaffGuard = G;
  globalThis.__dboAdminGate = adminGate;
  globalThis.__dboStaffCharSet = (a, t, on) => setStaffChar(Number(a) >>> 0, Number(t) >>> 0, on !== false);
  globalThis.__dboIsStaffCharacter = (a) => isStaffChar(Number(a) >>> 0);
  log(`staffguard: ${ON ? 'on' : 'off'} (staff characters ${CHAR.enabled ? 'on' : 'off'}, own account ${SELF.enabled ? 'on' : 'off'}, call or ticket ${REF.enabled ? 'on' : 'off'}, Trial GM limits ${TRIAL.enabled ? 'on' : 'off'})`);
  return G;
};
