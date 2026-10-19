// DragonBreak Online: the X interaction menu, introductions, inspect, party invites and masks.
// Loaded by gamemode.js on every hot reload.
//
// X on another player: the client asks for the menu (dbo event "playerMenu" [targetId]) and this answers
// with the entries the viewer may use right now:
//   everyone:                 Trade, Introduce (until the target knows you), Inspect, Invite to Party
//   admins, zone officials, an allegiance's leaders/officers/sergeants (Legion, Stormcloaks, Thalmor, Blades, the Great
//   Houses) and hold guards (Guard, Guard Sergeant, Guard Captain):
//                             Search, Restrain / Uncuff (Untie for a rope captive), while their own hands are free
//   anyone else carrying a rope: Tie Up; their rope captive: Untie, Leave Tied Here / Lead; someone else's: Cut Free
//                             (rope.js; Tie Up and Untie go to captureSystem as Restrain and Uncuff do)
//   whoever carries the target: Put down
//   while sneaking:            Pickpocket (pickpocket.js)
//   when the target can answer: Rob (robbery.js; the target answers in a panel)
//   Challenge to a Duel, or Yield the duel on the opponent (duel.js; the target answers in a panel)
//   a Thalmor of an arresting rank in the Empire: Arrest under the Concordat (thalmor.js)
// Trade, Search, Restrain, Uncuff, Carry and Put down go from the client straight to the server systems,
// which check private.dboLawful themselves; Introduce, Inspect and Invite come back here as dbo events.
// Restrain is instant for an admin or anyone holding a lawful rank, wherever they stand
// (globalThis.__dboInstantRestraint, asked by captureSystem); an admin target is still asked first.
//
// Introductions: every character holds ff_knownIds (owner-visible), the actor ids that introduced
// themselves to it. Clients show "Stranger" for anyone not on their list.
//
// Masks (H key, dbo event "maskToggle"): lends a face covering (by race: maskItemByRace, else maskItem) and shows
// "Masked Person" instead of the name; the real name is kept in maskName. Pressing H again takes it off and back.
// Logging out or switching characters always unmasks, so the character list never shows the mask.
//
// Real names (/realnames, Jake 14 Oct): a staff mode (GM and above, and Trial GMs through staffCan 'realnames') that
// shows the staff member every player by their own name instead of "Stranger", and "Aldric (masked)" / "Aldric (Werewolf
// form)" behind a disguise, on their own screen only. It is off at every login. While it is on, the staff member's own
// ff_knownIds holds a marker, { reveal: 1, labels: { "<actor hex>": "Aldric (masked)" } }: the 0.3.97 client shows every
// name to a viewer whose list is not an array, and a later client can draw the labels. Their true introductions list
// waits in private.dboKnownStash (never sent to any client) and comes back when the mode ends, at logout, at the next
// login after a crash or a restart, and at a reload with the kill switch off. Nothing anyone else receives changes.
//
// gamemode-config.json "playerMenu": { maskItem: "808:Armors of the Velothi Pt2.esp", maskName: "Masked Person",
//   realNames: { enabled: true, labels: true, chat: true, sweepMs: 2000 (500 to 60000) } }
'use strict';

module.exports = (api) => {
  const { mp, log, personal, system, onUi, sendPacket, display, nameOf, tagOf, profileOf, onlineActors, isAdmin, ranksOf,
    giveItem, makeProp, runCommand, cfg, every } = api;
  // A GM observes; the powers below are for a Lead GM and above (claude-jake's review A3). Fails closed with an old gamemode.
  const isLeadStaff = typeof api.isLeadStaff === 'function' ? api.isLeadStaff : () => false;
  // Which zone (hold) a character stands in: a hold's officials and guards arrest only there (Nate, 19 Oct)
  const zoneOfActor = typeof api.zoneOfActor === 'function' ? api.zoneOfActor : null;
  // Staff rights by name (gamemode.js staffCan: every admin tier, and a Trial GM for the rights on its allowlist). An old
  // gamemode without it lets admins only, never wider
  const staffCan = typeof api.staffCan === 'function' ? api.staffCan : (a) => isAdmin(a);
  const C = Object.assign({ maskItem: '808:Armors of the Velothi Pt2.esp', maskName: 'Masked Person', maxDistance: 400 }, cfg.playerMenu || {});
  // The real-names mode (header). enabled false is the kill switch: the command refuses and every mode on ends at the reload
  const RN = Object.assign({ enabled: true, labels: true, chat: true, sweepMs: 2000 }, C.realNames && typeof C.realNames === 'object' ? C.realNames : {});
  const RN_ON = RN.enabled !== false;
  // How often the sweep runs: 500 ms at the fastest, 60 s at the slowest. Node runs a timer set above 2147483647 ms every
  // 1 ms instead (TimeoutOverflowWarning), so a sweepMs of 1e10 in the config would have run the sweep without pause
  // (claude-jake's reload review, 14 Oct)
  const RN_SWEEP_MS = Math.min(60000, Math.max(500, Number(RN.sweepMs) || 2000));
  const KNOWN_PROP = 'ff_knownIds';
  const STASH_PROP = 'private.dboKnownStash';
  const LAWFUL_PROP = 'private.dboLawful';
  const RESTRAINED_PROP = 'private.restrained';
  const MASK_PROP = 'maskName';
  makeProp(KNOWN_PROP, false);
  makeProp(MASK_PROP, false); // reading an unregistered custom property throws natively

  const idOf = (desc) => { try { return mp.getIdFromDesc(desc) >>> 0; } catch (e) { return 0; } };
  const get = (a, prop, fallback) => { try { const v = mp.get(a, prop); return v === undefined || v === null ? fallback : v; } catch (e) { return fallback; } };
  const isOnline = (a) => onlineActors().includes(a);
  // Who has real names on: actor id -> { since, via, key (the labels last sent) }. Kept over a hot reload; a restart
  // empties it, and that is off
  const realNamesOn = globalThis.__dboRealNames instanceof Map ? globalThis.__dboRealNames : (globalThis.__dboRealNames = new Map());
  // One Map lookup, and nothing when nobody has the mode on
  const revealing = (v) => RN_ON && realNamesOn.size > 0 && realNamesOn.has(Number(v) >>> 0);
  const isMarker = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && v.reveal === 1;
  const ids = (v) => (Array.isArray(v) ? v.map((x) => Number(x) >>> 0) : []);
  const union = (...ls) => [...new Set([].concat(...ls.map(ids)))];
  // The introductions a character holds. While real names are on (or when a crash, a restart or a rollback left the
  // marker or the stash behind) the true list is the stash
  const knownBy = (a) => {
    const v = get(a, KNOWN_PROP, []);
    if (Array.isArray(v) && !revealing(a)) return ids(v);
    const s = get(a, STASH_PROP, null);
    return Array.isArray(s) ? ids(s) : ids(v);
  };
  // The real name kept while masked. The mask's own name is never a real name: mask() once stored "Masked Person" as the
  // real name when the name shown already was the mask's (its maskName lost, e.g. a crash), and every unmask after
  // put the mask name back, locking it (#7DJT, 10-11 Oct). Such a stored name counts as no real name; the mask is still
  // on (isMasked), so H runs unmask, which clears it and takes the lent mask back
  const isMaskName = (n) => String(n || '').trim().toLowerCase() === String(C.maskName || '').trim().toLowerCase();
  const realName = (a) => { const v = String(get(a, MASK_PROP, '') || ''); return v && !isMaskName(v) ? v : ''; };
  const isMasked = (a) => !!String(get(a, MASK_PROP, '') || '');
  // Court Mages, Shamans and Wisewomen hold office without guard powers
  const UNLAWFUL_RANKS = new Set(['courtmage', 'shaman', 'wisewoman']);
  // Faction ranks that arrest too (Nate, 6 Oct; guilds.js __dboGuildsOf, the rank's own title and role): an allegiance's
  // leaders, officers and sergeants, and a hold's guards by title. A plain member or a Citizen is not lawful.
  // Cuffs are per hold (Nate, 19 Oct): a hold's officials and guards arrest only in their own hold. The Empire's factions and the
  // Thalmor arrest anywhere; the Stormcloaks only in Skyrim and the Great Houses only on Solstheim (config
  // playerMenu.lawfulFactionRegions). The Blades are not listed: no arrest powers.
  const LAWFUL_FACTIONS = new Set(C.lawfulFactions || ['imperial-legion', 'imperial-civil-commission', 'penitus-oculatus', 'thalmor', 'stormcloaks',
    'house-hlaalu', 'house-redoran', 'house-telvanni', 'house-indoril', 'house-dres', 'house-sadras']);
  const LAWFUL_ROLES = new Set(C.lawfulRoles || ['leader', 'officer', 'sergeant']);
  const GUARD_FACTIONS = new Set(C.guardFactions || ['hold-whiterun', 'hold-riften', 'hold-solitude', 'hold-windhelm', 'hold-markarth',
    'hold-falkreath', 'hold-morthal', 'hold-dawnstar', 'hold-winterhold', 'county-bruma']);
  const GUARD_TITLES = new Set((C.guardTitles || ['Guard', 'Guard Sergeant', 'Guard Captain']).map((t) => String(t).toLowerCase()));
  // A faction whose authority stops at a border (Nate, 11 Oct): the Thalmor arrest only in the Empire, by the White-Gold
  // Concordat, and have no arrest powers at all in Skyrim's independent Holds. { factionId: [province] } by regions.js;
  // an unknown place (no regions.js) counts as outside, so the power fails closed. The 15 s refresh below drops the
  // power within 15 s of crossing out.
  const FACTION_REGIONS = C.lawfulFactionRegions && typeof C.lawfulFactionRegions === 'object' ? C.lawfulFactionRegions : { thalmor: ['cyrodiil'] };
  const provinceHere = (a) => { const R = globalThis.__dboRegions; try { return R && typeof R.provinceAt === 'function' ? String((R.provinceAt(a) || {}).province || '') : ''; } catch (e) { return ''; } };
  const inFactionLand = (fid, a) => { const list = FACTION_REGIONS[fid]; return !Array.isArray(list) || list.includes(provinceHere(a)); };
  // The hold (zone) a character stands in, '' when unknown: a hold's officials and guards arrest only there
  const zoneHere = (a) => { try { const z = typeof zoneOfActor === 'function' ? zoneOfActor(a) : null; return z ? String(z) : ''; } catch (e) { return ''; } };
  // A hold guard faction's own zone: hold-whiterun -> whiterun, county-bruma -> bruma
  const guardZone = (fid) => String(fid).replace(/^(hold|county|stronghold)-/, '');
  const lawfulByFaction = (a, here = zoneHere(a)) => {
    if (typeof globalThis.__dboGuildsOf !== 'function') return false;
    return (globalThis.__dboGuildsOf(a) || []).some((g) => (LAWFUL_FACTIONS.has(g.id) && LAWFUL_ROLES.has(g.role) && inFactionLand(g.id, a))
      || (GUARD_FACTIONS.has(g.id) && GUARD_TITLES.has(String(g.title || '').toLowerCase()) && !!here && guardZone(g.id) === here));
  };
  const isLawful = (a) => {
    try {
      if (isLeadStaff(a)) return true;
      const here = zoneHere(a);
      return (!!here && ranksOf(profileOf(a), a).some((m) => !UNLAWFUL_RANKS.has(m.rank) && m.zone && String(m.zone.id || m.zone) === here)) || lawfulByFaction(a, here);
    } catch (e) { return false; }
  };
  // A player in a beast form is the beast to everyone (beastform.js __dboBeastName)
  const beastName = (a) => { try { return typeof globalThis.__dboBeastName === 'function' ? String(globalThis.__dboBeastName(a) || '') : ''; } catch (e) { return ''; } };
  // A staff member with real names on sees the own name, and "Aldric (masked)" behind a disguise (staffLabel below); the
  // text is for that viewer alone, as every caller builds it for the one who receives it
  const nameFor = (viewer, a) => (revealing(viewer) ? revealedName(a)
    : beastName(a) || (isMasked(a) ? C.maskName : knownBy(viewer).includes(a >>> 0) ? nameOf(a) : 'Stranger'));
  // Other modules name players the same way (downed.js: who raised you); a name must never skip the introductions
  globalThis.__dboNameFor = nameFor;
  // The character's own name behind a mask or a beast form, '' when it is lost. A beast keeps the look from before the
  // change in private.beast.original (beastform.js); a mask on at the change holds the name in maskName, as any mask does.
  const ownBehind = (a, beast) => {
    let own = realName(a);
    if (!own && beast) {
      const s = get(a, 'private.beast', null);
      const n = String((s && s.original && s.original.name) || '').trim();
      if (n && !isMaskName(n)) own = n;
    }
    return own;
  };
  // For staff eyes only (debugsnap.js: a /bug report's #bug-tracker thread and snapshot), never for a player: the name
  // shown is the mask's or the beast's, so a /bug from behind a mask reached staff as "Masked Person #TAG" and they had
  // to work out who sent it (D15: #VKRS, #8KWH and #LLX8, 11 Oct). '' when the name shown is the character's own; else
  // their own name and why it is hidden, "Raven (masked)". The real-names mode names a disguise the same way.
  // labelAndShown reads the name shown once, for both answers (the name is the appearance, a large read)
  function labelAndShown(a) {
    const masked = isMasked(a), beast = beastName(a), shown = nameOf(a);
    if (!masked && !beast && !isMaskName(shown)) return { label: '', shown };
    const own = ownBehind(a, beast);
    const why = [masked ? 'masked' : '', beast ? `${beast} form` : '', own ? '' : 'own name lost'].filter(Boolean);
    return { label: `${own || shown} (${why.join(', ')})`, shown };
  }
  function staffLabel(a) { return labelAndShown(a).label; }
  // What a staff member with real names on is shown: the label behind a disguise, else the name shown (the own name)
  function revealedName(a) { const x = labelAndShown(a); return x.label || x.shown; }
  globalThis.__dboStaffName = staffLabel;
  // The character's own name behind a mask and a beast form (gamemode.js realNameOf; rosters read it through ownNameOf,
  // which keeps a mask's name while gamemode-config.json rosterPrivacy.masks is off; tracker 1559074270959640676: the Court
  // tab listed a transformed Jarl as "Werewolf", so anyone who looked learnt who the beast was). What is said and done in
  // the world keeps the name shown (nameFor above). A beast whose own name is lost is "Stranger", never the beast's name.
  const ownName = (a) => {
    const beast = beastName(a), shown = nameOf(a);
    if (!isMasked(a) && !beast) return shown;
    return ownBehind(a, beast) || (beast ? 'Stranger' : shown);
  };
  globalThis.__dboOwnName = ownName;
  // The name that goes with the #TAG the world sees (gamemode.js publicNameOf; /players and every answer to a lookup). The
  // client hides the #TAG over a beast, so a beast is named by its own name; it draws the #TAG under "Masked Person", so a
  // mask stays the mask: the own name beside that #TAG would take the mask off (verify of 12 Oct)
  globalThis.__dboPublicName = (a) => (beastName(a) ? ownName(a) : nameOf(a));
  // Behind a mask or in a beast form, or showing the mask's name with no name kept: a name never finds them (gamemode.js
  // findByName), the #TAG does
  globalThis.__dboDisguised = (a) => !!beastName(a) || isMasked(a) || isMaskName(nameOf(a));
  const distance = (a, b) => {
    const la = get(a, 'locationalData', null), lb = get(b, 'locationalData', null);
    if (!la || !lb || la.cellOrWorldDesc !== lb.cellOrWorldDesc) return Infinity;
    return Math.hypot(la.pos[0] - lb.pos[0], la.pos[1] - lb.pos[1], la.pos[2] - lb.pos[2]);
  };
  const validTarget = (a, t) => t && t !== a && isOnline(t) && distance(a, t) <= C.maxDistance;

  // ---- who may restrain: admins, anyone holding a zone rank, and the lawful faction ranks above ---------------
  const refreshLawful = (a) => { const v = isLawful(a); if (get(a, LAWFUL_PROP, false) !== v) { try { mp.set(a, LAWFUL_PROP, v); } catch (e) { /* not ready */ } } };
  every('lawful', 15000, () => { for (const a of onlineActors()) refreshLawful(a); });

  // Asked by captureSystem: restrain without the target's consent; a staff target is always asked unless the captor is a
  // Lead GM or above. A GM restrains like anyone else: with a zone rank or a lawful faction rank, or with the target's
  // yes (review A3-7)
  globalThis.__dboInstantRestraint = (captor, target) => {
    try {
      if (isLeadStaff(captor)) return true;
      if (isAdmin(target)) return false;
      return ranksOf(profileOf(captor), captor).some((m) => !UNLAWFUL_RANKS.has(m.rank)) || lawfulByFaction(captor);
    } catch (e) { log('instant restraint check failed', e.message); return false; }
  };

  // ---- real names: the staff mode (header) ---------------------------------------------------------
  // The label of every online disguised player, [[actor hex, label], ...], read once for everyone with the mode on (a
  // sweep, a mask put on or taken off) rather than once per staff member. At most 201, so each staff member's own map
  // below still holds 200 once their own entry is left out
  const disguisedLabels = () => {
    const out = [];
    if (RN.labels === false) return out;
    for (const x of onlineActors()) {
      const l = staffLabel(x);
      if (l) { out.push([(x >>> 0).toString(16), l]); if (out.length > 200) break; }
    }
    return out;
  };
  // One staff member's labels, for their own client (a 0.3.98 nametag draws them; 0.3.97 ignores them): never their
  // own, never an unmasked player
  const labelsFor = (a, all) => {
    const own = (Number(a) >>> 0).toString(16), out = {};
    let n = 0;
    for (const [h, l] of all || disguisedLabels()) { if (h === own) continue; out[h] = l; if (++n >= 200) break; }
    return out;
  };
  // A list that other code put back while the mode was on joins the stash before the marker goes over it
  const keepInStash = (a, v) => {
    if (!Array.isArray(v) || !v.length) return true;
    const s = get(a, STASH_PROP, null);
    const have = new Set(ids(s));
    if (Array.isArray(s) && ids(v).every((x) => have.has(x))) return true;
    try { mp.set(a, STASH_PROP, union(s, v)); return true; } catch (e) { log(`realnames: introductions for ${display(a)} not kept`, e.message); return false; }
  };
  // The marker on the staff member's own ff_knownIds (owner-only: no neighbour receives it). Sent only when the labels
  // changed or the marker is not in place. all: disguisedLabels() when the caller already read it
  const writeMarker = (a, all) => {
    a = Number(a) >>> 0;
    const st = realNamesOn.get(a);
    const labels = labelsFor(a, all);
    const key = JSON.stringify(labels);
    const v = get(a, KNOWN_PROP, null);
    if (isMarker(v) && st && st.key === key) return true;
    if (!isMarker(v) && !keepInStash(a, v)) return false;
    try { mp.set(a, KNOWN_PROP, { reveal: 1, labels }); } catch (e) { log(`realnames: marker for ${display(a)} not written`, e.message); return false; }
    if (st) st.key = key;
    return true;
  };
  // The true list back: the stash and whatever the list holds now, merged; the stash is cleared only once that is written
  const restoreKnown = (a, leftover) => {
    const s = get(a, STASH_PROP, null), v = get(a, KNOWN_PROP, null);
    if (!Array.isArray(s) && Array.isArray(v)) return 0;
    const list = union(s, v);
    try { mp.set(a, KNOWN_PROP, list); } catch (e) { log(`realnames: introductions for ${display(a)} not restored, kept for the next login`, e.message); return -1; }
    if (s !== null) { try { mp.set(a, STASH_PROP, null); } catch (e) { /* merged again at the next login */ } }
    if (leftover) log(`realnames: restored ${list.length} introductions for ${display(a)} (leftover from a crash or restart)`);
    return list.length;
  };
  // A mask put on or taken off changes the labels of everyone with the mode on (nothing when nobody has it on)
  const refreshLabels = () => {
    if (!realNamesOn.size) return;
    let all;
    try { all = disguisedLabels(); } catch (e) { return; /* the sweep tries again */ }
    for (const v of [...realNamesOn.keys()]) { try { writeMarker(v, all); } catch (e) { /* the sweep tries again */ } }
  };
  const RN_TOLD = {
    on: 'Real names on: every player shows by their own name to you, and a disguise as "Name (masked)" or "Name (Werewolf form)" in the X menu, messages and chat. Only your screen changes (mind it on stream). A masked head still reads Masked Person on this client; press X on them. /realnames off to stop; it ends when you log out.',
    command: 'Real names off: people you have not met are Strangers to you again.',
    rights: 'Real names off: your staff rights no longer include them.',
    'switched off': 'Real names off: staff switched the mode off on this server.',
    reload: 'Real names off after a server update. /realnames on to turn them back on.',
  };
  // The only way in. 'on' | 'already' | 'off' (kill switch) | 'rights' | 'offline' | 'failed'
  const startReveal = (a, via) => {
    a = Number(a) >>> 0;
    if (!RN_ON) return 'off';
    if (!staffCan(a, 'realnames')) return 'rights';
    if (!isOnline(a)) return 'offline';
    if (revealing(a)) { writeMarker(a); return 'already'; }
    // The stash first: the old one (a crash may have left one) and today's list
    try { mp.set(a, STASH_PROP, union(get(a, STASH_PROP, null), get(a, KNOWN_PROP, null))); } catch (e) { log(`realnames: ${display(a)} on refused, the list could not be kept`, e.message); return 'failed'; }
    realNamesOn.set(a, { since: Date.now(), via: String(via || 'command'), key: null });
    if (!writeMarker(a)) { realNamesOn.delete(a); restoreKnown(a, false); return 'failed'; }
    log(`realnames: ${display(a)} on (${String(via || 'command')})`);
    return 'on';
  };
  const endReveal = (a, why, quiet) => {
    a = Number(a) >>> 0;
    const was = realNamesOn.delete(a);
    restoreKnown(a, false);
    if (!was) return false;
    log(`realnames: ${display(a)} off (${why})`);
    if (!quiet && RN_TOLD[why]) personal(a, RN_TOLD[why]);
    return true;
  };
  const routeNow = () => {
    if (globalThis.__dboPlogRoute === 'upanel') return 'upanel';
    const cap = globalThis.__dboTellCapture;
    return cap && cap.all ? 'console' : 'command';
  };
  // Chat (gamemode.js handleLine and sendNear), /players and the U panel's player list read these; each fails safe
  globalThis.__dboRealNamesOn = (viewer) => revealing(viewer);
  // Not tied to a viewer: the label is for the recipients for whom __dboRealNamesOn(recipient) is true and no one else
  // (gamemode.js handleLine and sendNear check it per recipient). A new caller must do the same
  globalThis.__dboRealNamesLabel = (speaker) => (RN_ON && realNamesOn.size > 0 && RN.chat !== false ? staffLabel(Number(speaker) >>> 0) : '');
  globalThis.__dboRealNamesDisplay = (viewer, t) => (revealing(viewer) ? `${revealedName(Number(t) >>> 0)} #${tagOf(t)}` : '');
  // For a panel button (fork AdminSystem, later) and the harness: checks the rights itself
  globalThis.__dboRealNamesSet = (a, on, via) => {
    try {
      if (!staffCan(Number(a) >>> 0, 'realnames')) return false;
      if (on) { const r = startReveal(a, via || 'panel'); if (r === 'on') personal(a, RN_TOLD.on); return r === 'on' || r === 'already'; }
      endReveal(a, 'command', false);
      return true;
    } catch (e) { log('realnames: set failed', e.message); return false; }
  };
  api.registerChatCommand('realnames', (a, args) => {
    const arg = String(args || '').trim().toLowerCase();
    if (!staffCan(a, 'realnames')) return personal(a, 'Admins only.');
    if (!RN_ON) return personal(a, 'Real names are switched off on this server just now.');
    const on = revealing(a);
    if (arg === 'status') {
      if (!on) return personal(a, 'Real names are off. /realnames on to see every player by their own name.');
      const min = Math.max(0, Math.round((Date.now() - (realNamesOn.get(a >>> 0).since || Date.now())) / 60000));
      return personal(a, `Real names are on (for ${min} min). /realnames off to stop.`);
    }
    const want = arg === 'on' ? true : arg === 'off' ? false : arg === '' ? !on : null;
    if (want === null) return personal(a, 'Usage: /realnames [on|off|status]');
    if (!want) { if (!on) return personal(a, 'Real names are already off.'); endReveal(a, 'command', false); return; }
    if (on) { writeMarker(a); return personal(a, 'Real names are already on. /realnames off to stop.'); }
    const r = startReveal(a, routeNow());
    if (r === 'on') return personal(a, RN_TOLD.on);
    if (r === 'offline') return personal(a, 'Real names work only while your character is in the world.');
    if (r === 'off') return personal(a, 'Real names are switched off on this server just now.');
    if (r === 'rights') return personal(a, 'Admins only.');
    personal(a, 'Real names could not be turned on just now, try again.');
  }, { admin: true, help: '[on|off|status] see every player by their own name instead of Stranger, and who is behind a mask or a beast form. Staff only, on your own screen only, off at every login' });
  // Rights and labels: a staff member who lost the right or left is taken out; the labels go out again only when they
  // changed (a mask, a beast form, a disguised player in or out). Nothing at all while nobody has the mode on. A timer
  // outlives a reload into code that does not register it (gamemode.js TIMERS), so it stops acting once another load
  // of this file (or an older one) has taken over __dboNameFor
  every('realnames', RN_SWEEP_MS, () => {
    if (realNamesOn.size === 0 || globalThis.__dboNameFor !== nameFor) return;
    const online = new Set(onlineActors().map((x) => x >>> 0));
    // The disguises are read once per sweep, for every staff member in the mode, and only when one is still in it
    let all = null;
    for (const a of [...realNamesOn.keys()]) {
      try {
        if (!RN_ON) endReveal(a, 'switched off', false);
        else if (!online.has(a)) endReveal(a, 'left', true);
        else if (!staffCan(a, 'realnames')) endReveal(a, 'rights', false);
        else writeMarker(a, all || (all = disguisedLabels()));
      } catch (e) { log('realnames sweep failed', e.message); }
    }
  });

  // ---- introductions ------------------------------------------------------------------------------
  // Turns the system on for a character (an absent list means "show every name"). With real names on it keeps the marker
  // (the old line wrote [] over it on every X press); a marker or a stash left by a crash, a restart or a rollback is
  // put back into the list (restoreLeftover, also run as the character appears: __dboRealNamesLogin)
  const restoreLeftover = (a, v) => {
    if (!isMarker(v) && !Array.isArray(get(a, STASH_PROP, null))) return false;
    restoreKnown(a, true);
    return true;
  };
  const ensureKnown = (a) => {
    const v = get(a, KNOWN_PROP, null);
    if (revealing(a)) { if (!isMarker(v)) writeMarker(a); return; }
    if (restoreLeftover(a, v)) return;
    if (!Array.isArray(v)) { try { mp.set(a, KNOWN_PROP, []); } catch (e) { /* not ready */ } }
  };
  const introduce = (a, t) => {
    if (isMasked(a)) return personal(a, 'Take your mask off (H) before you introduce yourself.');
    const list = knownBy(t);
    if (list.includes(a >>> 0)) return personal(a, `${nameFor(a, t)} already knows who you are.`);
    // To a staff member with real names on (or with the marker still in place) the introduction joins the true list, the stash
    try { mp.set(t, revealing(t) || isMarker(get(t, KNOWN_PROP, null)) ? STASH_PROP : KNOWN_PROP, list.concat([a >>> 0])); } catch (e) { return personal(a, 'That did not work, try again.'); }
    personal(a, `You introduced yourself to ${nameFor(a, t)}.`);
    system(t, `${nameOf(a)} introduces themself.`);
    // A salute goes with it (idles.js)
    try { if (typeof globalThis.__dboInteractionIdle === 'function') globalThis.__dboInteractionIdle(a, 'introduce'); } catch (e) { /* the introduction stands */ }
  };

  // ---- inspect --------------------------------------------------------------------------------------
  const inspectLines = (viewer, t) => {
    const lines = [];
    const app = get(t, 'appearance', {}) || {};
    // A beast keeps the mortal race and sex in its appearance (beastform.js), and is no one others know: it shows the
    // beast only, and no office, as a mask hides the offices (tracker 1559074270959640676)
    const beast = beastName(t);
    if (beast) lines.push(beast);
    else lines.push(`${app.isFemale ? 'Woman' : 'Man'}${app.raceId ? `, ${raceName(app.raceId)}` : ''}`);
    // A mask kept from before the change is not on the beast's face: it would tie the beast to the masked one
    if (isMasked(t) && !beast) lines.push('Face hidden behind a mask');
    if (!isMasked(t) && !beast && (revealing(viewer) || knownBy(viewer).includes(t >>> 0))) {
      const ranks = ranksOf(profileOf(t), t);
      for (const r of ranks.slice(0, 3)) lines.push(`${rankTitle(r)} of ${r.zone.name}`);
    }
    const r = get(t, RESTRAINED_PROP, null);
    if (r && r.carried) lines.push('Being carried');
    else if (r && r.boundHands) lines.push('Hands bound');
    const worn = wornNames(t);
    lines.push(worn.length ? `Wearing: ${worn.join(', ')}` : 'Wearing nothing of note');
    return lines;
  };
  const raceName = (raceId) => {
    try { const rec = mp.lookupEspmRecordById(Number(raceId) >>> 0); const edid = rec && rec.record && rec.record.editorId; if (edid) return String(edid).replace(/Race(Vampire)?$/, '').replace(/([a-z])([A-Z])/g, '$1 $2'); } catch (e) { /* unknown */ }
    return 'unknown folk';
  };
  // What staff named the office at that court (rolenames.js), else zones.json's title
  const rankTitle = (r) => {
    try { const f = globalThis.__dboOfficeTitle; const n = typeof f === 'function' && r.zone ? f(r.zone.id, r.rank) : ''; if (n) return String(n); } catch (e) { /* the default */ }
    try { return String(((api.zones || {}).rankTitles || {})[r.rank] || r.rank); } catch (e) { return String(r.rank); }
  };
  const wornNames = (t) => {
    const eq = get(t, 'equipment', null);
    const entries = eq && eq.inv && Array.isArray(eq.inv.entries) ? eq.inv.entries : [];
    const out = [];
    for (const e of entries) {
      if (!e.worn && !e.wornLeft) continue;
      let name = '';
      try { const rec = mp.lookupEspmRecordById(Number(e.baseId) >>> 0); name = rec && rec.record ? String(rec.record.editorId || '') : ''; } catch (err) { /* unknown */ }
      if (name) out.push(name.replace(/^(Armor|Clothes|Clothing)/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim());
      if (out.length >= 5) break;
    }
    return out;
  };

  // ---- the journal's Settings, Voice (F3 hub, H5): the players this one can hear ---------------------------------------
  // Names as this player knows them (Stranger otherwise, as the X menu says), the identity as the voice room knows them
  // (the actor hex, as the X menu's dboVoicePeer sends it), and how far, so two strangers can be told apart
  const VOICE_NEAR_UNITS = Number(C.voiceNearUnits) || 3200;
  const journalSettings = (a) => typeof globalThis.__dboJournalHasTab === 'function' && globalThis.__dboJournalHasTab(a, 'settings') === true;
  // Staff walking invisible (AdminSystem's ff_adminModes mirror) are listed only to other staff
  const invisible = (t) => { const m = get(t, 'ff_adminModes', null); return !!(m && m.invis); };
  const voiceNearby = (a) => onlineActors().filter((t) => (t >>> 0) !== (a >>> 0) && (isAdmin(a) || !invisible(t)))
    .map((t) => ({ t, d: distance(a, t) })).filter((x) => Number.isFinite(x.d) && x.d <= VOICE_NEAR_UNITS)
    .sort((x, y) => x.d - y.d).slice(0, 24)
    .map((x) => ({ identity: (x.t >>> 0).toString(16), name: nameFor(a, x.t), meters: Math.round(x.d / 70) }));
  globalThis.__dboJournalSettingsExtra = (a) => {
    const on = globalThis.__dboVoiceEnabled === true;
    return { voiceOn: on, nearby: on ? voiceNearby(a) : [] };
  };

  // ---- the menu -------------------------------------------------------------------------------------
  const menuFor = (a, t) => {
    const entries = [{ id: 'trade', label: 'Trade' }];
    if (!knownBy(t).includes(a >>> 0)) entries.push({ id: 'introduce', label: 'Introduce' });
    entries.push({ id: 'inspect', label: 'Inspect' });
    const leaderOf = typeof globalThis.__dboPartyLeaderOf === 'function' ? globalThis.__dboPartyLeaderOf : () => null;
    const myLeader = leaderOf(a);
    if (myLeader === null || myLeader !== leaderOf(t)) entries.push({ id: 'party', label: 'Invite to Party' });
    else if (myLeader === profileOf(a)) entries.push({ id: 'partykick', label: 'Remove from Party' });
    if (myLeader !== null) entries.push({ id: 'partyleave', label: 'Leave Party' });
    // Pickpocket, only while the viewer sneaks (pickpocket.js reads the server's sneak flag)
    try { if (typeof globalThis.__dboPickpocketEntries === 'function') entries.push(...globalThis.__dboPickpocketEntries(a, t)); } catch (e) { /* pickpocket not loaded */ }
    try { if (typeof globalThis.__dboRobEntries === 'function') entries.push(...globalThis.__dboRobEntries(a, t)); } catch (e) { /* robbery not loaded */ }
    try { if (typeof globalThis.__dboDuelEntries === 'function') entries.push(...globalThis.__dboDuelEntries(a, t)); } catch (e) { /* duel.js not loaded */ }
    try { if (typeof globalThis.__dboKeyRingEntries === 'function') entries.push(...globalThis.__dboKeyRingEntries(a, t)); } catch (e) { /* key ring not loaded */ }
    try { if (typeof globalThis.__dboCourierEntries === 'function') entries.push(...globalThis.__dboCourierEntries(a, t)); } catch (e) { /* couriers not loaded */ }
    try { if (typeof globalThis.__dboConcordatEntries === 'function') entries.push(...globalThis.__dboConcordatEntries(a, t)); } catch (e) { /* thalmor.js not loaded */ }
    try { if (typeof globalThis.__dboSuperMenuEntries === 'function') entries.push(...globalThis.__dboSuperMenuEntries(a, t)); } catch (e) { /* no curses */ }
    try { if (typeof globalThis.__dboFactionMenuEntries === 'function') entries.push(...globalThis.__dboFactionMenuEntries(a, t)); } catch (e) { /* factions not loaded */ }
    try { if (typeof globalThis.__dboSchoolsMenuEntries === 'function') entries.push(...globalThis.__dboSchoolsMenuEntries(a, t)); } catch (e) { /* schools not loaded */ }
    // A ruler or Steward answers a citizenship request face to face (citizenship.js)
    try { if (typeof globalThis.__dboCitizenMenuEntries === 'function') entries.push(...globalThis.__dboCitizenMenuEntries(a, t)); } catch (e) { /* citizenship not loaded */ }
    const r = get(t, RESTRAINED_PROP, null) || {};
    const own = get(a, RESTRAINED_PROP, null) || {};
    if (get(a, LAWFUL_PROP, false) === true && !own.boundHands && !own.carried) {
      entries.push({ id: 'search', label: 'Search' });
      entries.push(r.boundHands ? { id: 'release', label: r.rope === true ? 'Untie' : 'Uncuff' } : { id: 'capture', label: 'Restrain' });
    }
    // Rope only once captureSystem ties with rope (__dboRopeCapture, set at its init)
    try { if (globalThis.__dboRopeCapture === true && typeof globalThis.__dboRopeMenuEntries === 'function') entries.push(...globalThis.__dboRopeMenuEntries(a, t)); } catch (e) { /* rope not loaded */ }
    // Carry is off the menu (Nat, 2026-09-22); Put down stays so a carry already under way can end
    if (r.carried && Number(r.carrierActorId) >>> 0 === a >>> 0) entries.push({ id: 'putdown', label: 'Put down' });
    // Voice volume is a preference on the listener's own PC; offered only while voice chat is on (voiceSystem.ts). A front
    // with the journal's Settings gets one entry that opens it on this player (F3 hub, N19); any other the three steps
    if (globalThis.__dboVoiceEnabled === true) {
      if (journalSettings(a)) entries.push({ id: 'voice:settings', label: `Voice settings for ${nameFor(a, t)}…` });
      else entries.push({ id: 'voice:louder', label: 'Voice louder' }, { id: 'voice:quieter', label: 'Voice quieter' }, { id: 'voice:mute', label: 'Mute voice' });
    }
    return entries;
  };
  const openMenu = (a, t, mode, lines) => sendPacket(a, {
    customPacketType: 'dboPlayerMenu', target: t >>> 0, name: nameFor(a, t), mode: mode || 'menu',
    entries: mode === 'inspect' ? [] : menuFor(a, t), lines: lines || [],
  });

  // A press inside PRESS_GAP_MS of this player's last answer finishing is dropped when that answer was slow (PRESS_SLOW_MS
  // or more): 17 Oct, presses made while a slow menu was being built queued up and ran back to back, and 13 in a row held
  // the server 3 minutes. The usual answer takes a few ms and drops nothing. Timed on the monotonic clock.
  const PRESS_GAP_MS = 1000, PRESS_SLOW_MS = 100;
  const lastPress = new Map(); // actor -> { done, took } (performance.now() ms) of its last playerMenu answer
  onUi('playerMenu', (a, args) => {
    const t = Number(args[0]) >>> 0;
    const t0 = performance.now();
    const last = lastPress.get(a >>> 0);
    if (last && last.took >= PRESS_SLOW_MS && t0 - last.done < PRESS_GAP_MS) {
      log(`playerMenu ${display(a)} -> ${t.toString(16)}: dropped (${Math.round(t0 - last.done)} ms after an answer that took ${Math.round(last.took)} ms)`);
      return;
    }
    try {
      refreshLawful(a); ensureKnown(a);
      // One line per X press on a player: whether a menu went out, or why not (#bugs 'X not worky', 2026-09-26)
      if (!validTarget(a, t)) {
        log(`playerMenu ${display(a)} -> ${t.toString(16)}: refused (${!t || t === a ? 'no target' : !isOnline(t) ? 'target offline' : `${Math.round(distance(a, t))} units away`})`);
        // A player who logged out stays in the world through the logout grace (5 min): "get closer" sent three players
        // pressing X on one five and six times in a row (log, 27-29 Sep)
        if (t && t !== a && !isOnline(t)) return personal(a, 'They have stepped out of the world. Their body stays a short while before it fades.');
        return personal(a, 'Get closer to them first.');
      }
      const sent = openMenu(a, t, 'menu');
      log(`playerMenu ${display(a)} -> ${display(t)}: ${sent === false ? 'menu packet failed' : 'menu sent'}`);
    } finally {
      const done = performance.now();
      lastPress.set(a >>> 0, { done, took: done - t0 });
      if (lastPress.size > 256) for (const [k, p] of lastPress) if (done - p.done >= PRESS_GAP_MS) lastPress.delete(k);
    }
  });
  onUi('playerAction', (a, args) => {
    const id = String(args[0] || ''); const t = Number(args[1]) >>> 0;
    if (!validTarget(a, t)) return personal(a, 'They are too far away.');
    // the player log (playerlog.js): the action and its target, folded per minute; voice actions never
    if (!id.startsWith('voice')) { try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('pmenu', a, id, t); } catch (e) { /* the player log is optional */ } }
    if (id === 'introduce') return introduce(a, t);
    if (id === 'inspect') return openMenu(a, t, 'inspect', inspectLines(a, t));
    if (id === 'party') return runCommand(a, 'party', `invite #${tagOf(t)}`);
    if (id === 'partykick') return runCommand(a, 'party', `kick #${tagOf(t)}`);
    if (id === 'partyleave') return runCommand(a, 'leave', '');
    if (id === 'voice:settings') {
      if (journalSettings(a) && globalThis.__dboJournalOpenTab(a, 'settings', { section: 'voice', peer: (t >>> 0).toString(16) })) return;
      return personal(a, 'Your journal cannot be opened just now.');
    }
    if (id.startsWith('voice:')) return sendPacket(a, { customPacketType: 'dboVoicePeer', identity: (t >>> 0).toString(16), op: id.slice(6), name: nameFor(a, t) });
    if (typeof globalThis.__dboPickpocketAction === 'function' && globalThis.__dboPickpocketAction(a, id, t, nameFor)) return;
    if (typeof globalThis.__dboRobAction === 'function' && globalThis.__dboRobAction(a, id, t, nameFor)) return;
    if (typeof globalThis.__dboDuelAction === 'function' && globalThis.__dboDuelAction(a, id, t)) return;
    if (typeof globalThis.__dboKeyRingAction === 'function' && globalThis.__dboKeyRingAction(a, id, t, nameFor)) return;
    if (typeof globalThis.__dboCourierAction === 'function' && globalThis.__dboCourierAction(a, id, t, nameFor)) return;
    if (typeof globalThis.__dboConcordatAction === 'function' && globalThis.__dboConcordatAction(a, id, t, nameFor)) return;
    if (typeof globalThis.__dboSuperMenuAction === 'function' && globalThis.__dboSuperMenuAction(a, id, t, nameFor)) return;
    if (typeof globalThis.__dboFactionMenuAction === 'function' && globalThis.__dboFactionMenuAction(a, id, t)) return;
    if (typeof globalThis.__dboSchoolsMenuAction === 'function' && globalThis.__dboSchoolsMenuAction(a, id, t, nameFor)) return;
    if (typeof globalThis.__dboCitizenMenuAction === 'function' && globalThis.__dboCitizenMenuAction(a, id, t)) return;
    if (typeof globalThis.__dboRopeMenuAction === 'function' && globalThis.__dboRopeMenuAction(a, id, t)) return;
  });

  // ---- masks ----------------------------------------------------------------------------------------
  const setAppearanceName = (a, name) => {
    const app = get(a, 'appearance', null); if (!app) return false;
    try { mp.set(a, 'appearance', Object.assign({}, app, { name })); return true; } catch (e) { log('mask rename failed', e.message); return false; }
  };
  const papyrus = (method, a, baseId) => mp.callPapyrusFunction('method', 'Actor', method, { type: 'form', desc: mp.getDescFromId(a) }, [{ type: 'espm', desc: mp.getDescFromId(baseId) }, false, true]);
  const removeOne = (a, baseId) => {
    try {
      const inv = get(a, 'inventory', { entries: [] });
      const entries = (Array.isArray(inv.entries) ? inv.entries : []).map((e) => Object.assign({}, e));
      const hit = entries.find((e) => (Number(e.baseId) >>> 0) === baseId && !e.worn && !e.wornLeft);
      if (!hit) return false;
      hit.count = (Number(hit.count) || 0) - 1;
      mp.set(a, 'inventory', { entries: entries.filter((e) => (Number(e.count) || 0) > 0) });
      return true;
    } catch (e) { log('mask item removal failed', e.message); return false; }
  };
  const holds = (a, baseId) => { const inv = get(a, 'inventory', { entries: [] }); return (Array.isArray(inv.entries) ? inv.entries : []).some((e) => (Number(e.baseId) >>> 0) === baseId && (Number(e.count) || 0) > 0); };
  // Race editor id of a character ("OrcRace"), for per-race masks: tusks and snouts clip through some coverings
  const raceEdidOf = (a) => {
    const app = get(a, 'appearance', null);
    try { const rec = app && mp.lookupEspmRecordById(Number(app.raceId) >>> 0); return String((rec && rec.record && rec.record.editorId) || ''); } catch (e) { return ''; }
  };
  const maskItemFor = (a) => {
    const byRace = C.maskItemByRace || {};
    const race = raceEdidOf(a);
    return idOf(byRace[race] || byRace[race.replace(/Vampire$/, '')] || C.maskItem);
  };
  // A mask taken off comes back to the server; one that could not be taken back (dropped, stored or traded while worn)
  // is private.maskLost, and no new one is handed out until that one is held again: H handed out a fresh mask every
  // time (economy review, 2026-09-29)
  const mask = (a) => {
    const lost = Number(get(a, 'private.maskLost', 0)) >>> 0;
    if (lost && !holds(a, lost)) return personal(a, 'Your mask is not on you. Find it, or get it back, to wear it again.');
    const itemId = lost || maskItemFor(a);
    const real = nameOf(a);
    // The name shown is the mask's already: there is no real name to keep, so none is stored over it
    if (isMaskName(real)) {
      log(`playermenu: ${display(a)} shows the mask name with no real name kept; mask refused, staff can /rename`);
      return personal(a, 'Your own name was lost behind a mask. Please send a /bug so staff can give it back to you.');
    }
    if (!setAppearanceName(a, C.maskName)) return personal(a, 'Could not put the mask on.');
    try { mp.set(a, MASK_PROP, real); } catch (e) { /* kept in memory only */ }
    refreshLabels();
    try { mp.set(a, 'private.maskItemId', itemId); } catch (e) { /* unmask falls back to the race item */ }
    if (itemId) {
      if (lost) { try { mp.set(a, 'private.maskLost', 0); } catch (e) { /* asked again next time */ } } else giveItem(a, itemId, 1);
      setTimeout(() => { try { papyrus('EquipItem', a, itemId); } catch (e) { log('mask equip failed', e.message); } }, 300);
    }
    // The covering is lent, not given: a /bug (2026-10-01) read the race mask turning up in the inventory as a free item
    personal(a, itemId
      ? 'You pull up a borrowed mask. Others see a Masked Person. Press H to take it off and hand it back.'
      : 'You pull your mask up. Others see a Masked Person. Press H to take it off.');
    try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('mask', a, true); } catch (e) { /* the player log is optional */ }
  };
  const unmask = (a, quiet) => {
    const stored = String(get(a, MASK_PROP, '') || '');
    if (!stored) return;
    const real = realName(a);
    // A stored mask name is no real name: the name is left as it is (staff /rename), never set to the mask's again
    if (real) setAppearanceName(a, real);
    else log(`playermenu: ${display(a)} had the mask name kept as the real name; cleared, staff can /rename`);
    try { mp.set(a, MASK_PROP, ''); } catch (e) { /* ignore */ }
    refreshLabels();
    const itemId = (Number(get(a, 'private.maskItemId', 0)) >>> 0) || maskItemFor(a);
    if (itemId) {
      try { papyrus('UnequipItem', a, itemId); } catch (e) { /* not worn */ }
      setTimeout(() => { if (!removeOne(a, itemId)) { try { mp.set(a, 'private.maskLost', itemId); } catch (e) { log('mask loss not recorded', e.message); } } }, 1500);
    }
    if (!quiet) personal(a, itemId ? 'You take the borrowed mask off and hand it back.' : 'You take your mask off.');
    try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('mask', a, false); } catch (e) { /* the player log is optional */ }
    if (!real && !quiet) personal(a, 'Your own name was lost behind the mask. Please send a /bug so staff can give it back to you.');
  };
  // A mask taken off is removed 1.5 s later; toggling again inside that let a burst of H hand out a mask each time
  const MASK_TOGGLE_MS = 2000;
  const maskToggledAt = globalThis.__dboMaskToggledAt instanceof Map ? globalThis.__dboMaskToggledAt : (globalThis.__dboMaskToggledAt = new Map());
  onUi('maskToggle', (a) => {
    const now = Date.now();
    if (now - (maskToggledAt.get(a >>> 0) || 0) < MASK_TOGGLE_MS) return;
    maskToggledAt.set(a >>> 0, now);
    if (maskToggledAt.size > 2000) for (const [k, t] of maskToggledAt) if (now - t > MASK_TOGGLE_MS) maskToggledAt.delete(k);
    // The beast wears no mask, and a mask put on or off now would write a human name over the beast's
    if (beastName(a)) return personal(a, 'You cannot handle a mask in this form.');
    if (isMasked(a)) unmask(a, false); else mask(a);
  });

  // Admin fitting room: /masktest wears the next candidate covering, /masktest <n> a given one, /masktest off
  // takes the test piece away. Pick one per race into gamemode-config.json playerMenu.maskItemByRace.
  const MASK_CANDIDATES = [
    ['CamonnaMaskCloth', '808:Armors of the Velothi Pt2.esp'],
    ['CamonnaMask', '807:Armors of the Velothi Pt2.esp'],
    ['IAFurHoodPlainScarf', 'ba99a:Hothtrooper44_ArmorCompilation.esp'],
    ['IAFurHoodBlackScarf', '22fc:Hothtrooper44_ArmorCompilation.esp'],
    ['IAFurHoodWhiteScarf', '1d8e:Hothtrooper44_ArmorCompilation.esp'],
    ['NetchLeatherMask', '19d76:Journey to Baan Malur.esp'],
    ['AshlanderMask01', 'e5632:Journey to Baan Malur.esp'],
    ['ReaverMask01', 'e03ee:Journey to Baan Malur.esp'],
    ['CYRNecromancerMask', '80f85:BSHeartland.esm'],
    ['IABosmerMask', '238fb:Hothtrooper44_ArmorCompilation.esp'],
    ['TH_Bos1Mask', '849:Sentinel.esp'],
    ['ArmorOrcishClanMaskHelmet', '78388:DragonBreak Online Edits.esp'],
  ];
  const takeTestPiece = (a) => {
    const prev = Number(get(a, 'private.maskTestItem', 0)) >>> 0;
    if (!prev) return;
    try { papyrus('UnequipItem', a, prev); } catch (e) { /* not worn */ }
    setTimeout(() => removeOne(a, prev), 1500);
    try { mp.set(a, 'private.maskTestItem', 0); } catch (e) { /* ignore */ }
  };
  api.registerChatCommand('masktest', (a, args) => {
    const arg = String(args || '').trim().toLowerCase();
    if (arg === 'off') { takeTestPiece(a); return personal(a, 'Test mask removed.'); }
    const last = Number(get(a, 'private.maskTestIndex', -1));
    const n = arg ? Number(arg) - 1 : (Number.isFinite(last) ? last + 1 : 0) % MASK_CANDIDATES.length;
    if (!Number.isInteger(n) || n < 0 || n >= MASK_CANDIDATES.length) return personal(a, `/masktest 1-${MASK_CANDIDATES.length}, or /masktest off.`);
    const [edid, desc] = MASK_CANDIDATES[n];
    const id = idOf(desc);
    if (!id) return personal(a, `${n + 1}/${MASK_CANDIDATES.length} ${edid} is not in the load order, /masktest again for the next.`);
    takeTestPiece(a);
    try { mp.set(a, 'private.maskTestIndex', n); mp.set(a, 'private.maskTestItem', id); } catch (e) { /* ignore */ }
    giveItem(a, id, 1);
    setTimeout(() => { try { papyrus('EquipItem', a, id); } catch (e) { log('masktest equip failed', e.message); } }, 1800);
    personal(a, `Mask ${n + 1}/${MASK_CANDIDATES.length}: ${edid} (${desc}). Your race: ${raceEdidOf(a) || 'unknown'}. /masktest for the next, /masktest off to remove.`);
  }, { admin: true, help: 'try face coverings on yourself: /masktest [n|off]' });

  // Unmask on the way out and on arrival, so a stale mask never reaches the character list or a new session. Real names
  // end with the session: at logout or a character switch, and every login starts with them off (a marker or a stash a
  // crash or a restart left behind is put back into the list as the character appears: __dboRealNamesLogin)
  globalThis.__dboPlayerMenuLeave = (a) => {
    try { unmask(a, true); } catch (e) { log('unmask on leave failed', e.message); }
    try { endReveal(a, 'logout', true); } catch (e) { log('real names on leave failed', e.message); }
  };
  // appearance.js: the editor keeps the character's own name, never the mask's (#VKRS, 17 Oct)
  globalThis.__dboMaskOf = (a) => ({ masked: isMasked(Number(a) >>> 0), real: realName(Number(a) >>> 0), shown: String(C.maskName || ''), isMaskName });
  globalThis.__dboPlayerMenuReady = (a) => { try { unmask(a, true); realNamesOn.delete(Number(a) >>> 0); ensureKnown(a); refreshLawful(a); } catch (e) { log('player menu login failed', e.message); } };
  // At arrival (gamemode.js onUserAssignActor with assigned, then onCharacterReady), not 8 s later; assigned leaves a mode still on alone (the same character picked again)
  globalThis.__dboRealNamesLogin = (a, assigned) => { try { a = Number(a) >>> 0; if (assigned && revealing(a)) return; realNamesOn.delete(a); restoreLeftover(a, get(a, KNOWN_PROP, null)); } catch (e) { log('realnames: login check failed', e.message); } };
  // A reload keeps the mode only for a staff member still online, still holding the right and still carrying the marker;
  // any other is ended and their list put back (fail closed: a marker other code reset is never put back by itself)
  for (const a of [...realNamesOn.keys()]) {
    try {
      const here = isOnline(a);
      const why = !RN_ON ? 'switched off' : !here ? 'left' : !staffCan(a, 'realnames') ? 'rights' : !isMarker(get(a, KNOWN_PROP, null)) ? 'reload' : '';
      // Nothing is written into the chat of a character who is not in the world (it would show at their next login)
      if (why) endReveal(a, why, !here);
    } catch (e) { log('real names reload check failed', e.message); }
  }
  for (const a of onlineActors()) { ensureKnown(a); refreshLawful(a); }

  log(`player menu on: mask by race ${JSON.stringify(C.maskItemByRace || {})}, default mask item ${C.maskItem} (${idOf(C.maskItem) ? 'found' : 'NOT FOUND'}), introductions and lawful flags for ${onlineActors().length} online, real names ${RN_ON ? `on for ${realNamesOn.size} staff` : 'switched off'}`);
};
