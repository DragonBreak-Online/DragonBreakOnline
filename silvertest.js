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
// gamemode-config.json "silverTest" (every key optional); enabled: false takes it off the menu and ends tests under way.
'use strict';

module.exports = (api) => {
  const { mp, log, personal, audit, who, onlineActors, openWidget, closeWidget, onUi, sendPacket, every, cfg } = api;
  const C = Object.assign({
    enabled: true, factions: ['dawnguard', 'silver-hand', 'vigil-of-stendarr'], maxDistance: 300, leaveDistance: 1500,
    answerSeconds: 30, strikeSeconds: 60, hunterSeconds: 30, pairMinutes: 10, combatSeconds: 15, harmless: true,
    // MAGVampireSunlight (SOUN, Skyrim.esm ff9eb) and FireFXShader (EFSH, Skyrim.esm 1b212): ids read from the esm, 19 Oct
    sound: '0ff9eb:Skyrim.esm', flashShader: '01b212:Skyrim.esm', flashSeconds: 3,
  }, cfg.silverTest || {});
  const PROMPT_WIDGET_ID = 117;
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
    if (!isHunter(a)) return 'Only the Dawnguard, the Silver Hand and the Vigil of Stendarr test blood with silver.';
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

  globalThis.__dboSilverTestEntries = (a, t) => (refusal(a >>> 0, t >>> 0) === '' ? [{ id: 'silver:test', label: 'Silver Test' }] : []);
  globalThis.__dboSilverTestAction = (a, id, t) => {
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
    S.flashes = S.flashes.filter((fl) => { if (now < fl.until) return true; for (const v of fl.viewers) if (online(v)) glow(v, fl.t, false); return false; });
    for (const m of [S.hunterAt, S.pairAt]) if (m.size > 512) for (const [k, at] of m) if (now - at > C.pairMinutes * 60000) m.delete(k);
  });

  return { refusal, TEXT };
};
