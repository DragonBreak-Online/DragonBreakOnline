// DragonBreak Online: the silver test (mestreugway's suggestion, 16 Oct; Nate 19 Oct). Loaded by gamemode.js.
//
// A member of the Dawnguard, the Silver Hand or the Vigil of Stendarr (config factions, guild-defs ids) who carries a silver
// weapon gets "Silver Test" in the X menu on another player (playermenu.js asks __dboSilverTestEntries and hands the choice
// to __dboSilverTestAction). The target gets a panel (contextMenu, widget 117): "You are being silver tested.", Accept or
// Fight or Flee. Closing it or no answer in answerSeconds counts as Fight or Flee.
//   Accept         the hunter has strikeSeconds to strike the target with a silver weapon (a swing or a bash, not a spell,
//                  not blocked). That strike is the test: it is refused by the hit hook (gamemode.js, harmless: true), so it
//                  costs no health, and the result goes to the hunter and the target only. A vampire or werewolf (any
//                  supernatural.js kind) also flashes with fire (flashShader, a dboGlow sent to those two only).
//   Fight or Flee  the hunter is told the subject broke free; the vampire-in-sunlight sound plays at the target (sound, a
//                  SOUN through Papyrus Sound.Play: everyone near hears it, as anyone near sees the struggle).
// Hitting someone who refused, or was never asked, reveals nothing. Waits: hunterSeconds between one hunter's tests, and
// pairMinutes before the same hunter may ask the same target again after any outcome. Every step goes to the audit log.
//
// Teaching (Nat, 2 Nov: "give hunting factions the ability to teach someone how to silver test"): a member of one of those
// orders whose rank's role is in teachRoles (leader, officer) gets "Teach the Silver Test" in the X menu on another player,
// who accepts in a panel (widget 118). The learner gets private.dboSilverTaught { byProfile, byName, faction, at } and may
// then silver test as a member does (a silver weapon, the same panel and strike), without joining. teachMinutes between one
// teacher's lessons. A vampire or werewolf learns nothing: the teacher is told the lesson was given (it never reveals their
// blood), the learner that it will not take; and a taught player who turns loses it at once. /silvertest shows what you know;
// /silvertest revoke <name|#TAG> takes it back (the leader of the teaching order, or staff). Every step is audited (SILVERTEACH).
// Lore (UESP, 2 Nov): no order is recorded teaching outsiders. The Vigil "lends aid to heroes who fit their ideals", the
// Fighters Guild took up the Dawnguard's silver crossbows, and Isran rebuilt the Dawnguard from outsiders, so an officer
// passing on a hunter's craft fits; the Silver Hand, cruel to the innocent, would teach only their own kind.
//
// gamemode-config.json "silverTest" (every key optional); enabled: false takes it off the menu and ends tests under way.
'use strict';

module.exports = (api) => {
  const { mp, log, personal, audit, who, onlineActors, openWidget, closeWidget, onUi, sendPacket, every, cfg } = api;
  const fn = (f, dflt) => (typeof f === 'function' ? f : dflt);
  const registerChatCommand = fn(api.registerChatCommand, () => {});
  const isAdmin = fn(api.isAdmin, () => false);
  const findByName = fn(api.findByName, () => 0);
  const offlineByTag = fn(api.offlineByTag, () => 0);
  const display = fn(api.display, who);
  const C = Object.assign({
    enabled: true, factions: ['dawnguard', 'silver-hand', 'vigil-of-stendarr'], maxDistance: 300, leaveDistance: 1500,
    answerSeconds: 30, strikeSeconds: 60, hunterSeconds: 30, pairMinutes: 10, combatSeconds: 15, harmless: true,
    // MAGVampireSunlight (SOUN, Skyrim.esm ff9eb) and FireFXShader (EFSH, Skyrim.esm 1b212): ids read from the esm, 19 Oct
    sound: '0ff9eb:Skyrim.esm', flashShader: '01b212:Skyrim.esm', flashSeconds: 3,
    teach: true, teachRoles: ['leader', 'officer'], teachMinutes: 30,
  }, cfg.silverTest || {});
  const PROMPT_WIDGET_ID = 117;
  const TEACH_WIDGET_ID = 118;
  const MARK = 'private.dboSilverTaught';
  const TEACH_ROLES = new Set((Array.isArray(C.teachRoles) ? C.teachRoles : []).map(String));
  const FACTIONS = new Set((Array.isArray(C.factions) ? C.factions : []).map(String));
  const TEXT = {
    prompt: 'You are being silver tested.',
    accepted: 'The subject has consented to the silver test. Strike them with your silver weapon, bash or swing, to examine their blood\'s reaction.',
    normal: 'The blood reacts normally to the silver. No signs of supernatural corruption are detected.',
    burns: 'The blood ignites upon contact with the silver, bursting into unnatural flames. The subject is supernatural!',
    refused: 'The subject has broken free and refused the silver test.',
  };

  // Kept across hot reloads: prompts by target, accepted tests by target, waits, and fire flashes to take off
  const S = globalThis.__dboSilverTest || (globalThis.__dboSilverTest = { pending: new Map(), accepted: new Map(), hunterAt: new Map(), pairAt: new Map(), flashes: [] });
  if (!(S.lessons instanceof Map)) S.lessons = new Map(); // learner -> { teacher, faction, name, until }
  if (!(S.teacherAt instanceof Map)) S.teacherAt = new Map();

  const idOf = (desc) => { try { return desc ? mp.getIdFromDesc(String(desc)) >>> 0 : 0; } catch (e) { log(`silvertest: ${desc} not in the load order`); return 0; } };
  const SOUND = idOf(C.sound);
  const SHADER = idOf(C.flashShader);
  const get = (a, prop, fallback) => { try { const v = mp.get(a, prop); return v === undefined || v === null ? fallback : v; } catch (e) { return fallback; } };
  const online = (a) => onlineActors().includes(a >>> 0);
  const near = (a, b, reach) => {
    try {
      if (mp.get(a, 'worldOrCellDesc') !== mp.get(b, 'worldOrCellDesc')) return false;
      const p = mp.get(a, 'pos'), q = mp.get(b, 'pos');
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= reach;
    } catch (e) { return false; }
  };
  const inBeastForm = (a) => { const s = get(a, 'private.beast', null); return !!(s && s.form); };
  const handsTied = (a) => { const r = get(a, 'private.restrained', null) || {}; return !!(r.boundHands || r.carried); };
  const inFight = (a) => { const m = globalThis.__dboPvpAt; return m instanceof Map && Date.now() - (m.get(a >>> 0) || 0) < C.combatSeconds * 1000; };
  // supernatural.js: the silver weapon test (its keyword and silverWeapons list) and the curse a character carries
  const isSilverWeapon = (id) => { try { return typeof globalThis.__dboSuperIsSilverWeapon === 'function' && !!globalThis.__dboSuperIsSilverWeapon(Number(id) >>> 0); } catch (e) { return false; } };
  const superKind = (a) => { try { return typeof globalThis.__dboSuperKind === 'function' ? globalThis.__dboSuperKind(a >>> 0) || null : null; } catch (e) { return null; } };
  const isHunter = (a) => {
    try { return typeof globalThis.__dboGuildsOf === 'function' && (globalThis.__dboGuildsOf(a >>> 0) || []).some((g) => FACTIONS.has(String(g.id))); } catch (e) { return false; }
  };
  // The order whose rank lets this member teach (a role in teachRoles), or null
  const teachingOrder = (a) => {
    try { return (typeof globalThis.__dboGuildsOf === 'function' ? globalThis.__dboGuildsOf(a >>> 0) || [] : []).find((g) => FACTIONS.has(String(g.id)) && TEACH_ROLES.has(String(g.role))) || null; } catch (e) { return null; }
  };
  const leads = (a, fid) => { try { return (globalThis.__dboGuildsOf(a >>> 0) || []).some((g) => String(g.id) === String(fid) && String(g.role) === 'leader'); } catch (e) { return false; } };
  const markOf = (a) => { const m = get(a, MARK, null); return m && typeof m === 'object' && m.faction ? m : null; };
  // A taught player who has turned loses the test at once
  const knows = (a) => {
    const m = markOf(a);
    if (!m) return false;
    const kind = superKind(a);
    if (!kind) return true;
    try { mp.set(a >>> 0, MARK, null); } catch (e) { return false; }
    audit(`SILVERTEACH ${who(a)} lost the silver test taught by the ${m.faction}: now a ${kind}`);
    return false;
  };
  const carriesSilver = (a) => {
    const inv = get(a, 'inventory', null);
    return !!inv && Array.isArray(inv.entries) && inv.entries.some((e) => e && (Number(e.count) || 0) > 0 && isSilverWeapon(e.baseId));
  };
  const testOf = (a) => { for (const p of S.pending.values()) if (p.hunter === (a >>> 0)) return p; for (const [t, x] of S.accepted) if (x.hunter === (a >>> 0)) return Object.assign({ target: t }, x); return null; };
  const pairKey = (h, t) => `${h >>> 0}:${t >>> 0}`;
  const within = (at, ms) => Date.now() - (at || 0) < ms;

  // Why this hunter may not test this target now, or '' when they may
  const refusal = (a, t) => {
    if (C.enabled === false) return 'Silver tests are not allowed right now.';
    if (!t || t === a || !online(t)) return 'There is no one to test.';
    if (!isHunter(a) && !knows(a)) return 'Only the Dawnguard, the Silver Hand, the Vigil of Stendarr and those they taught test blood with silver.';
    if (!carriesSilver(a)) return 'You need a silver weapon to test anyone.';
    if (!near(a, t, C.maxDistance)) return 'Get closer to them first.';
    if (inBeastForm(a) || handsTied(a) || get(a, 'isDead', false) === true) return 'You cannot test anyone right now.';
    if (get(t, 'isDead', false) === true) return 'There is no blood left to test.';
    if (inFight(a) || inFight(t)) return 'Not in the middle of a fight.';
    if (testOf(a)) return 'You are already testing someone.';
    if (S.pending.has(t >>> 0) || S.accepted.has(t >>> 0)) return 'Someone is already testing them.';
    if (within(S.hunterAt.get(a >>> 0), C.hunterSeconds * 1000)) return 'You tested someone moments ago. Wait a little.';
    if (within(S.pairAt.get(pairKey(a, t)), C.pairMinutes * 60000)) return 'You tested them not long ago. Leave them be for now.';
    return '';
  };

  const playSound = (t) => {
    if (!SOUND) return;
    try { mp.callPapyrusFunction('method', 'Sound', 'Play', { type: 'espm', desc: mp.getDescFromId(SOUND) }, [{ type: 'form', desc: mp.getDescFromId(t >>> 0) }]); }
    catch (e) { log('silvertest: the refusal sound failed', e.message); }
  };
  const glow = (to, t, on) => { try { sendPacket(to >>> 0, { customPacketType: 'dboGlow', refs: [t >>> 0], on, kind: 'champion', shader: SHADER }); } catch (e) { /* offline */ } };
  const flash = (h, t) => {
    if (!SHADER || !(C.flashSeconds > 0)) return;
    const viewers = [h >>> 0, t >>> 0];
    for (const v of viewers) glow(v, t, true);
    S.flashes.push({ t: t >>> 0, viewers, until: Date.now() + C.flashSeconds * 1000 });
  };

  // ---- the prompt ----------------------------------------------------------------------------------------------------
  const finish = (p, choice, why) => {
    S.pending.delete(p.target);
    try { closeWidget(p.target, PROMPT_WIDGET_ID); } catch (e) { /* gone */ }
    S.hunterAt.set(p.hunter, Date.now());
    if (choice === 'left') {
      S.pairAt.set(pairKey(p.hunter, p.target), Date.now());
      if (online(p.target)) personal(p.target, 'The hunter is gone. The silver test is dropped.');
      if (online(p.hunter)) personal(p.hunter, 'You walked away. The silver test is dropped.');
      audit(`SILVER ${who(p.hunter)} -> ${who(p.target)}: dropped before an answer (${why})`);
      return;
    }
    if (choice === 'accept') {
      if (!online(p.hunter) || !near(p.hunter, p.target, C.leaveDistance)) {
        S.pairAt.set(pairKey(p.hunter, p.target), Date.now());
        personal(p.target, 'The hunter is gone before the silver touches you.');
        audit(`SILVER ${who(p.hunter)} -> ${who(p.target)}: accepted, but the hunter had left`);
        return;
      }
      S.accepted.set(p.target, { hunter: p.hunter, until: Date.now() + C.strikeSeconds * 1000 });
      personal(p.hunter, TEXT.accepted);
      personal(p.target, 'You hold still for the silver.');
      audit(`SILVER ${who(p.target)} accepted a silver test from ${who(p.hunter)}`);
      return;
    }
    S.pairAt.set(pairKey(p.hunter, p.target), Date.now());
    if (online(p.hunter)) personal(p.hunter, TEXT.refused);
    personal(p.target, why === 'timeout' ? 'You gave no answer, and break free of the silver test.' : 'You break free and refuse the silver test.');
    playSound(p.target);
    audit(`SILVER ${who(p.target)} refused a silver test from ${who(p.hunter)} (${why})`);
  };

  // ---- teaching ------------------------------------------------------------------------------------------------------
  // Why this member may not offer a lesson to this player now, or ''. Nothing here reads the learner's blood or order, so the
  // entry shows the same for everyone; whether they already know it is told only when the lesson is offered
  const teachRefusal = (a, t) => {
    if (C.enabled === false || C.teach === false) return 'Teaching the silver test is not allowed right now.';
    if (!t || t === a || !online(t)) return 'There is no one to teach.';
    if (!teachingOrder(a)) return 'Only an officer of the Dawnguard, the Silver Hand or the Vigil of Stendarr teaches the silver test.';
    if (!near(a, t, C.maxDistance)) return 'Get closer to them first.';
    if (inBeastForm(a) || handsTied(a) || get(a, 'isDead', false) === true || get(t, 'isDead', false) === true) return 'You cannot teach anyone right now.';
    if (inFight(a) || inFight(t)) return 'Not in the middle of a fight.';
    for (const l of S.lessons.values()) if (l.teacher === (a >>> 0)) return 'You are already teaching someone.';
    if (S.lessons.has(t >>> 0)) return 'Someone is already teaching them.';
    const left = (S.teacherAt.get(a >>> 0) || 0) + C.teachMinutes * 60000 - Date.now();
    if (left > 0) return `You taught the silver test not long ago. Wait ${Math.ceil(left / 60000)} more minute(s).`;
    return '';
  };
  const endLesson = (t, l, choice) => {
    S.lessons.delete(t);
    try { closeWidget(t, TEACH_WIDGET_ID); } catch (e) { /* gone */ }
    if (choice !== 'accept') {
      if (online(l.teacher)) personal(l.teacher, choice === 'left' ? 'The lesson is dropped.' : 'They turn the lesson down.');
      if (online(t) && choice !== 'left') personal(t, 'You turn the lesson down.');
      audit(`SILVERTEACH ${who(t)} turned down the silver test from ${who(l.teacher)} (${choice})`);
      return;
    }
    if (!online(l.teacher) || !near(l.teacher, t, C.leaveDistance)) {
      personal(t, 'The hunter is gone before the lesson begins.');
      audit(`SILVERTEACH ${who(t)} accepted the silver test from ${who(l.teacher)}, but the teacher had left`);
      return;
    }
    // The teacher hears the same either way: a lesson that cannot take never tells them why
    personal(l.teacher, `You show them the silver test: the silver weapon, the hold, the strike, and what burning blood looks like.`);
    const kind = superKind(t);
    if (kind) {
      personal(t, 'You follow the lesson, but you know the silver would only ever burn you. It will not take.');
      audit(`SILVERTEACH ${who(t)} could not learn the silver test from ${who(l.teacher)} (${l.faction}): a ${kind}`);
      return;
    }
    try { mp.set(t, MARK, { byProfile: Number(get(l.teacher, 'profileId', -1)), byName: display(l.teacher), faction: l.faction, factionName: l.name, at: Date.now() }); }
    catch (e) { log('silvertest: the lesson could not be saved', e.message); personal(t, 'The lesson could not be kept. Ask again later.'); return; }
    personal(t, `You learn the silver test from ${display(l.teacher)} of the ${l.name}. Carry a silver weapon, and "Silver Test" is in the X menu on others.`);
    audit(`SILVERTEACH ${who(l.teacher)} taught ${who(t)} the silver test (${l.faction})`);
  };
  const offerLesson = (a, t) => {
    const why = teachRefusal(a, t);
    if (why) { personal(a, why); return; }
    if (isHunter(t) || knows(t)) { personal(a, 'They already know the silver test.'); return; }
    const order = teachingOrder(a);
    S.teacherAt.set(a, Date.now());
    S.lessons.set(t, { teacher: a, faction: String(order.id), name: String(order.name || order.id), until: Date.now() + C.answerSeconds * 1000 });
    openWidget(t, { type: 'contextMenu', id: TEACH_WIDGET_ID, mode: 'menu', targetName: `${display(a)} offers to teach you the silver test.`,
      actions: [{ id: 'accept', label: 'Learn it' }, { id: 'refuse', label: 'Decline' }],
      events: { action: 'dbo:silverTeachAnswer', close: 'dbo:silverTeachClose' } }, true);
    personal(a, `You offer to teach them the silver test. They have ${C.answerSeconds} seconds to answer.`);
    audit(`SILVERTEACH ${who(a)} offers to teach ${who(t)} the silver test (${order.id})`);
  };
  onUi('silverTeachAnswer', (t, args) => { const l = S.lessons.get(t >>> 0); if (l) endLesson(t >>> 0, l, String((args || [])[0] || '') === 'accept' ? 'accept' : 'declined'); });
  onUi('silverTeachClose', (t) => { const l = S.lessons.get(t >>> 0); if (l) endLesson(t >>> 0, l, 'closed'); });

  registerChatCommand('silvertest', (a, args) => {
    const words = String(args || '').trim().split(/\s+/).filter(Boolean);
    if ((words[0] || '').toLowerCase() !== 'revoke') {
      const m = markOf(a);
      if (isHunter(a)) return personal(a, 'You test blood with silver as a member of your order.');
      if (m && knows(a)) return personal(a, `You know the silver test, taught by ${m.byName || 'a hunter'} of the ${m.factionName || m.faction}.`);
      return personal(a, 'You do not know the silver test. An officer of the Dawnguard, the Silver Hand or the Vigil of Stendarr can teach it.');
    }
    const q = words.slice(1).join(' ');
    if (!q) return personal(a, 'Use: /silvertest revoke <name|#TAG>');
    const t = (findByName(q) || offlineByTag(q) || offlineByTag(`#${q.replace(/^#/, '')}`) || 0) >>> 0;
    if (!t) return personal(a, `No character "${q}". Use their #TAG.`);
    const m = markOf(t);
    if (!m) return personal(a, `${display(t)} was not taught the silver test.`);
    if (!isAdmin(a) && !leads(a, m.faction)) return personal(a, 'Only the leader of the order that taught them, or staff, takes the silver test back.');
    try { mp.set(t, MARK, null); } catch (e) { return personal(a, 'That could not be changed right now. Try again.'); }
    audit(`SILVERTEACH ${who(a)} revoked the silver test of ${who(t)} (${m.faction})`);
    personal(a, `${display(t)} no longer knows the silver test.`);
    if (online(t)) personal(t, `The ${m.factionName || 'order'} that taught you the silver test has taken it back.`);
  }, { help: 'what you know of the silver test; revoke <name|#TAG>: take back a lesson your order gave (its leader, or staff)' });

  globalThis.__dboSilverTestEntries = (a, t) => {
    a >>>= 0; t >>>= 0;
    const out = refusal(a, t) === '' ? [{ id: 'silver:test', label: 'Silver Test' }] : [];
    if (teachRefusal(a, t) === '') out.push({ id: 'silver:teach', label: 'Teach the Silver Test' });
    return out;
  };
  globalThis.__dboSilverTestAction = (a, id, t) => {
    if (id === 'silver:teach') { offerLesson(a >>> 0, t >>> 0); return true; }
    if (id !== 'silver:test') return false;
    a >>>= 0; t >>>= 0;
    const why = refusal(a, t);
    if (why) { personal(a, why); return true; }
    const p = { hunter: a, target: t, until: Date.now() + C.answerSeconds * 1000 };
    S.pending.set(t, p);
    openWidget(t, { type: 'contextMenu', id: PROMPT_WIDGET_ID, mode: 'menu', targetName: TEXT.prompt,
      actions: [{ id: 'accept', label: 'Accept' }, { id: 'refuse', label: 'Fight or Flee' }],
      events: { action: 'dbo:silverAnswer', close: 'dbo:silverClose' } }, true);
    personal(a, `You raise your silver. They have ${C.answerSeconds} seconds to answer.`);
    audit(`SILVER ${who(a)} asks ${who(t)} to take a silver test`);
    return true;
  };
  onUi('silverAnswer', (t, args) => { const p = S.pending.get(t >>> 0); if (p) finish(p, String((args || [])[0] || '') === 'accept' ? 'accept' : 'refuse', 'answer'); });
  onUi('silverClose', (t) => { const p = S.pending.get(t >>> 0); if (p) finish(p, 'refuse', 'closed'); });

  // ---- the strike (gamemode.js hit hook, before any damage) ----------------------------------------------------------
  // True when this hit is an accepted test's strike: the result is given and the hook refuses the hit when harmless is on.
  // Any other hit, from anyone, on anyone, is left alone and tells nothing.
  globalThis.__dboSilverTestStrike = (agg, tgt, src, dmg, flags) => {
    if (!S.accepted.size) return false;
    agg >>>= 0; tgt >>>= 0;
    const x = S.accepted.get(tgt);
    if (!x || x.hunter !== agg || Date.now() >= x.until) return false;
    const f = flags && typeof flags === 'object' ? flags : {};
    if (f.spell || f.blocked || !isSilverWeapon(src)) return false;
    S.accepted.delete(tgt);
    S.pairAt.set(pairKey(agg, tgt), Date.now());
    const kind = superKind(tgt);
    const line = kind ? TEXT.burns : TEXT.normal;
    personal(agg, line);
    personal(tgt, line);
    if (kind) flash(agg, tgt);
    audit(`SILVER ${who(agg)} tested ${who(tgt)}: ${kind ? `${kind}, the blood burns` : 'no corruption'}${f.bash ? ' (bash)' : ''}`);
    return C.harmless !== false;
  };

  globalThis.__dboSilverTestLeave = (a) => {
    a >>>= 0;
    for (const p of [...S.pending.values()]) if (p.target === a || p.hunter === a) finish(p, 'left', 'logged out');
    for (const [t, x] of [...S.accepted]) if (t === a || x.hunter === a) S.accepted.delete(t);
    for (const [t, l] of [...S.lessons]) if (t === a || l.teacher === a) endLesson(t, l, 'left');
  };

  every('silverTest', 1000, () => {
    const now = Date.now();
    for (const p of [...S.pending.values()]) {
      if (C.enabled === false) { finish(p, 'left', 'switched off'); continue; }
      if (!online(p.target)) { S.pending.delete(p.target); continue; }
      if (!online(p.hunter) || !near(p.hunter, p.target, C.leaveDistance)) { finish(p, 'left', 'the hunter left'); continue; }
      if (now >= p.until) finish(p, 'refuse', 'timeout');
    }
    for (const [t, x] of [...S.accepted]) {
      if (C.enabled !== false && now < x.until && online(t) && online(x.hunter)) continue;
      S.accepted.delete(t);
      if (online(x.hunter)) personal(x.hunter, 'The moment for the silver test has passed.');
      if (online(t)) personal(t, 'The silver test is over; no blow was struck.');
      audit(`SILVER ${who(x.hunter)} -> ${who(t)}: accepted but never struck`);
    }
    for (const [t, l] of [...S.lessons]) {
      if (C.enabled === false || C.teach === false || !online(t) || !online(l.teacher) || !near(l.teacher, t, C.leaveDistance)) endLesson(t, l, 'left');
      else if (now >= l.until) endLesson(t, l, 'timeout');
    }
    // A taught player who turns loses the test (knows() drops it), checked every ten seconds while they are online
    S.turnTick = ((S.turnTick || 0) + 1) % 10;
    if (S.turnTick === 0) for (const a of onlineActors()) if (markOf(a)) knows(a);
    S.flashes = S.flashes.filter((fl) => { if (now < fl.until) return true; for (const v of fl.viewers) if (online(v)) glow(v, fl.t, false); return false; });
    for (const m of [S.hunterAt, S.pairAt]) if (m.size > 512) for (const [k, at] of m) if (now - at > C.pairMinutes * 60000) m.delete(k);
    if (S.teacherAt.size > 512) for (const [k, at] of S.teacherAt) if (now - at > C.teachMinutes * 60000) S.teacherAt.delete(k);
  });

  return { refusal, teachRefusal, TEXT };
};
