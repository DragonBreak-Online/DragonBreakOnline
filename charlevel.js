'use strict';
// Character level 1-5 (config "charLevel"). Earned from the work done across every skill, paced so level 5
// lands about when a first skill reaches Master; each level buys +perLevel to Health, Magicka or Stamina.
// State: private.dboLevel { level, pending, spent: { health, magicka, stamina } } on the character.
// private.dboAvBonus holds the spent totals: the server adds them to the maximum it measures hits and
// restores against (MpActor::AddLevelBonus), and the next login's creation message carries them.

module.exports = (api) => {
  const { mp, log, personal, system, audit, display, cfg, openWidget, closeWidget, onUi, registerChatCommand,
    onlineActors, every, sendPacket, isAdmin, findByName } = api;

  const CFG = Object.assign({
    enabled: true,
    // Units of work one skill needs for Apprentice, Adept, Expert and Master (fork skillPoints.ts)
    thresholds: [0, 250, 750, 1750, 2950],
    // Nate 15 Oct: +25 a level (was +10). Characters who spent points at the old rate are topped up (rescale)
    perLevel: 25,
    checkSeconds: 30,
    // A reroll (patrons.js) hands every spent point back to spend again: a new race may want other vitals
    refundOnReroll: true,
  }, cfg.charLevel || {});
  const WIDGET_ID = 43;
  const MAX_LEVEL = CFG.thresholds.length;
  const VITALS = { health: 'Health', magicka: 'Magicka', stamina: 'Stamina' };

  // Mirror of skillPoints.ts xpPerUnitAt: [first level of band, xp per unit]; 100 xp make a level
  const BANDS = [[95, 0.25], [90, 0.5], [75, 1.25], [50, 2.5], [25, 5], [0, 10]];
  const xpPerUnitAt = (level) => BANDS.find((b) => level >= b[0])[1];
  const unitsOfSkill = (level, xp) => {
    let units = 0;
    for (let l = 0; l < Math.max(0, Math.min(level, 100)); l++) units += 100 / xpPerUnitAt(l);
    if (level < 100) units += Math.max(0, Number(xp) || 0) / xpPerUnitAt(level);
    return units;
  };

  const get = (a, prop, dflt) => { try { const v = mp.get(a, prop); return v === undefined || v === null ? dflt : v; } catch (e) { return dflt; } };
  const unitsOf = (a) => {
    const r = get(a, 'private.mastery', null);
    if (!r || r.v !== 2 || !r.skills) return 0;
    return Object.values(r.skills).reduce((sum, s) => sum + (s && s.level > 0 ? unitsOfSkill(Number(s.level) || 0, s.xp) : 0), 0);
  };
  const levelOfUnits = (units) => {
    let level = 1;
    for (let i = 1; i < CFG.thresholds.length; i++) if (units >= CFG.thresholds[i]) level = i + 1;
    return level;
  };
  const stateOf = (a) => {
    const s = get(a, 'private.dboLevel', null);
    const spent = (s && s.spent) || {};
    return {
      level: Math.max(1, Math.min(MAX_LEVEL, Number(s && s.level) || 1)),
      pending: Math.max(0, Number(s && s.pending) || 0),
      spent: { health: Number(spent.health) || 0, magicka: Number(spent.magicka) || 0, stamina: Number(spent.stamina) || 0 },
      // the rate the spent points were bought at; records from before it was kept were all +10
      per: Number(s && s.per) || 10,
    };
  };
  // The bonus the server adds to the maximum: the spent points plus the race's flat bonus (racial.js, the Half-Giant's +50 health)
  // and a Briarheart's (briarheart.js)
  const avBonus = (a, spent) => {
    let r = { health: 0 }; try { if (typeof globalThis.__dboRaceVitalBonus === 'function') r = globalThis.__dboRaceVitalBonus(a) || r; } catch (e) { /* none */ }
    let b = { health: 0 }; try { if (typeof globalThis.__dboBriarheartVitalBonus === 'function') b = globalThis.__dboBriarheartVitalBonus(a) || b; } catch (e) { /* none */ }
    return { health: (Number(spent.health) || 0) + (Number(r.health) || 0) + (Number(b.health) || 0), magicka: Number(spent.magicka) || 0, stamina: Number(spent.stamina) || 0 };
  };
  const save = (a, st) => {
    st.per = CFG.perLevel;
    mp.set(a, 'private.dboLevel', st);
    mp.set(a, 'private.dboAvBonus', avBonus(a, st.spent));
  };
  // A race's bonus follows the race (a new character, a race change), written when it differs. The client's bars were built
  // from the old bonus, so a gain is sent as a level spend's is (a Half-Giant's +50 waited for the next login, 21 Oct); a
  // loss shows at the next login, as a refund's does
  const syncBonus = (a, st) => {
    const want = avBonus(a, st.spent); const have = get(a, 'private.dboAvBonus', null) || {};
    if (!['health', 'magicka', 'stamina'].some((k) => (Number(have[k]) || 0) !== want[k])) return;
    mp.set(a, 'private.dboAvBonus', want);
    const gain = {};
    for (const k of Object.keys(VITALS)) { const d = want[k] - (Number(have[k]) || 0); if (d > 0) gain[k] = d; }
    if (Object.keys(gain).length) sendPacket(a, Object.assign({ customPacketType: 'dboAvGain' }, gain));
  };
  // Points bought at another rate are re-priced at today's, and the client is told the difference
  const rescale = (a, st) => {
    if (st.per === CFG.perLevel) return false;
    const gain = {};
    for (const av of Object.keys(VITALS)) {
      const now = Math.round((st.spent[av] / st.per) * CFG.perLevel);
      if (now !== st.spent[av]) gain[av] = now - st.spent[av];
      st.spent[av] = now;
    }
    const was = st.per;
    save(a, st);
    if (Object.keys(gain).length) {
      sendPacket(a, Object.assign({ customPacketType: 'dboAvGain' }, gain));
      personal(a, `Level bonuses are now +${CFG.perLevel} a level: yours were raised to match (${Object.entries(gain).map(([av, n]) => `${n > 0 ? '+' : ''}${n} ${VITALS[av]}`).join(', ')}).`);
      log(`level ${display(a)} rescaled from +${was} to +${CFG.perLevel} a level: ${JSON.stringify(st.spent)}`);
    }
    return true;
  };

  // Focus hands the keyboard to the CEF window, so only a panel the player just asked for may take it
  const openChoice = (a, focus) => {
    const st = stateOf(a);
    if (!st.pending) return;
    const actions = Object.keys(VITALS).map((av) => ({ id: av, label: `+${CFG.perLevel} ${VITALS[av]} (now +${st.spent[av]})` }));
    // A race swap (beast form) tears the panel down client-side while the id stays taken, and the re-open is then ignored
    closeWidget(a, WIDGET_ID);
    openWidget(a, { type: 'contextMenu', id: WIDGET_ID, mode: 'menu', targetName: `Level ${st.level}: ${st.pending} point${st.pending === 1 ? '' : 's'} to spend`,
      actions, events: { action: 'dbo:levelChoose', close: 'dbo:levelClose' } }, !!focus);
    log(`level ${display(a)} offered ${st.pending} point(s) at level ${st.level}${focus ? ' (focused)' : ''}`);
  };
  // n points at once (athny, suggestions, 2026-09-26: "/level health 3"); asking for more than is left spends what is left
  const spend = (a, av, n = 1) => {
    const st = stateOf(a);
    if (!VITALS[av]) { personal(a, `Spend a point on health, magicka or stamina: /level health, or several: /level health 3`); return false; }
    if (st.pending < 1) { personal(a, 'You have no points to spend.'); return false; }
    const count = Math.min(st.pending, Math.max(1, Math.floor(Number(n) || 1)));
    st.pending -= count;
    st.spent[av] += CFG.perLevel * count;
    save(a, st);
    sendPacket(a, { customPacketType: 'dboAvGain', [av]: CFG.perLevel * count });
    personal(a, `+${CFG.perLevel * count} ${VITALS[av]}.${st.pending ? ` ${st.pending} more to spend.` : ''}`);
    log(`level ${display(a)} spent ${count} point${count === 1 ? '' : 's'} on ${av}: ${JSON.stringify(st.spent)}`);
    try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('level', a, av, count, st.level); } catch (e) { /* the player log is optional */ }
    return true;
  };

  // Levels are never taken back: a skill giving way to the pool must not unlearn a character level
  const check = (a) => {
    if (!CFG.enabled) return false;
    const st = stateOf(a);
    // The race's bonus first: rescale and a level-up save it too, silently
    syncBonus(a, st);
    rescale(a, st);
    const earned = levelOfUnits(unitsOf(a));
    if (earned <= st.level) return false;
    const gained = earned - st.level;
    st.pending += gained;
    st.level = earned;
    save(a, st);
    audit(`LEVEL ${display(a)} reached character level ${earned}`);
    system(a, `You have reached level ${earned}. Choose where your strength grows: /level`);
    openChoice(a);
    return true;
  };

  // Every spent point back to spend again (Moderation Help #0240, 18 Oct: a reroll to a goblin left three Magicka points
  // the new race had no use for). The server's maximum drops at once (private.dboAvBonus); the client only ever adds a
  // gain (levelBonusService), so its bars follow at the next login, which builds them from the bonus
  const refund = (a, why) => {
    if (!CFG.enabled || (why === 'reroll' && CFG.refundOnReroll === false)) return 0;
    const st = stateOf(a);
    rescale(a, st);
    const back = Object.keys(VITALS).reduce((n, av) => n + Math.round(st.spent[av] / CFG.perLevel), 0);
    if (!back) return 0;
    const was = JSON.stringify(st.spent);
    st.pending += back;
    st.spent = { health: 0, magicka: 0, stamina: 0 };
    save(a, st);
    audit(`LEVEL ${display(a)} level points refunded (${why}): ${back} to spend again, was ${was}`);
    personal(a, `Your ${back} level point${back === 1 ? ' is' : 's are'} yours to spend again: /level. Your bars show the change after your next login.`);
    openChoice(a);
    return back;
  };
  globalThis.__dboCharLevelRefund = refund;

  onUi('levelChoose', (a, args) => {
    const av = String(args[0] || '');
    // Closing first lost both the click and the panel whenever the choice did not take
    if (!spend(a, av)) { openChoice(a, true); return; }
    closeWidget(a, WIDGET_ID);
    if (stateOf(a).pending) openChoice(a, true);
  });
  onUi('levelClose', (a) => closeWidget(a, WIDGET_ID));

  const addStatus = (key, order, fn) => { try { if (typeof globalThis.__dboRegisterStatus === 'function') globalThis.__dboRegisterStatus(key, order, fn); } catch (e) { /* gamemode older than /status */ } };
  addStatus('level', 50, (a) => {
    const st = stateOf(a);
    return st.pending ? `Level ${st.level}, ${st.pending} point${st.pending === 1 ? '' : 's'} to spend` : `Level ${st.level}`;
  });
  registerChatCommand('level', (a, args) => {
    // registerChatCommand hands the argument string, not an array: args[0] was the first letter
    const words = String(args || '').trim().split(/\s+/);
    const arg = words[0].toLowerCase();
    // The panel is not always reachable, so points can always be spent from chat: /level health, /level health 3
    // Staff: /level reset <player|#TAG> hands every spent point back
    if (arg === 'reset') {
      if (typeof isAdmin !== 'function' || !isAdmin(a)) return personal(a, 'Staff only.');
      const t = words[1] ? (typeof findByName === 'function' ? findByName(words.slice(1).join(' ')) : 0) : a;
      if (!t) return personal(a, 'Usage: /level reset <player|#TAG> (online)');
      const n = refund(t, `staff ${display(a)}`);
      return personal(a, n ? `${display(t)}: ${n} point${n === 1 ? '' : 's'} to spend again.` : `${display(t)} has no spent points.`);
    }
    if (arg) { spend(a, arg, words[1] === undefined ? 1 : words[1]); return; }
    const st = stateOf(a);
    const units = unitsOf(a);
    const next = st.level < MAX_LEVEL ? CFG.thresholds[st.level] : null;
    personal(a, `Level ${st.level} of ${MAX_LEVEL}. ${next ? `Progress to level ${st.level + 1}: ${Math.floor(Math.min(99, (units / next) * 100))}%.` : 'You have reached the highest level.'} Bonuses: Health +${st.spent.health}, Magicka +${st.spent.magicka}, Stamina +${st.spent.stamina}.`);
    if (st.pending) {
      personal(a, `${st.pending} unspent point${st.pending === 1 ? '' : 's'}. Choose in the panel, or type /level health, /level magicka or /level stamina, with a number to spend several (/level health 3).`);
      openChoice(a, true);
    }
  }, { help: 'your character level and progress; /level <health|magicka|stamina> [n] spends points; staff: /level reset <player>' });

  globalThis.__dboCharLevel = (a) => stateOf(a).level;
  // A bonus that changed outside a level spend (briarheart.js): written, and a gain sent to the client at once
  globalThis.__dboCharLevelSyncBonus = (a) => { try { syncBonus(Number(a) >>> 0, stateOf(Number(a) >>> 0)); } catch (e) { log('charlevel: bonus sync failed', e.message); } };
  globalThis.__dboCharLevelPending = (a) => Number(stateOf(a).pending) || 0;
  // Never focused at login: a focused panel held the keyboard and the player could not move until it was closed
  globalThis.__dboCharLevelLogin = (a) => {
    if (check(a)) return;
    const st = stateOf(a);
    if (!st.pending) return;
    personal(a, `You have ${st.pending} level point${st.pending === 1 ? '' : 's'} to spend. Type /level to choose, or /level health, /level magicka or /level stamina.`);
    openChoice(a);
  };
  every('charLevel', CFG.checkSeconds * 1000, () => onlineActors().forEach((a) => { try { check(a); } catch (e) { log('level check failed', e.message); } }));
  log(`character levels ${CFG.enabled ? 'on' : 'off'}: thresholds ${CFG.thresholds.join('/')} units, +${CFG.perLevel} a level`);
};
