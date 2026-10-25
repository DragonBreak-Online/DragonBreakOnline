// DragonBreak Online: the thirteen birthsigns (Nat, 25 Oct 2026; design _work\birthsigns-design-1025.md, approved with
// "no Not yet"). Loaded by gamemode.js after racial.js on every hot reload.
//
// One sign per character, chosen once and kept for life; only staff change it (/birthsign set|clear, Lead GM and above,
// audited). private.dboBirthsign { id, at, by } on the character ('self' or the staff member's who()).
// The gifts are small and live where racial.js judges a race's: racial.js asks __dboBirthsignOf for the sign and multiplies
// its factors into attackMult (sneakDamage), targetMult (taken), regenFactor (regen, lowHealthRegen), skillRate (xp, xpAll)
// and goldBonus, and __dboRaceVitalBonus adds its vital (charlevel.js private.dboAvBonus). So race and sign together stay
// under racial's caps, and like a race's gift a sign gives nothing to a non-player, in a beast form or with racial off.
//
// The choice is not optional:
//   - a new character chooses in the Realm hub before the god (gamemode.js endCreation), and neither a gate nor leaveRealm
//     takes them on until they have (__dboBirthsignHold);
//   - an older character without one gets the menu loginDelaySeconds after login, and again reshowSeconds after each close.
// The forced menu never gets in anyone's way: it waits while the character is in creation or any editor (RaceMenu), being
// arrested or jailed, downed, or fighting, and it never moves anyone. If the menu cannot be sent, nothing holds the
// character; /birthsign <sign> chooses by text.
// Config "birthsigns": { enabled, requireAtCreation, loginDelaySeconds, reshowSeconds, creationReshowSeconds, fightSeconds,
// signs: { <id>: {...} } } (a sign's fields merge onto its default)
'use strict';

const WIDGET_ID = 163;
const PROP = 'private.dboBirthsign';
const ORDER = ['warrior', 'mage', 'thief', 'lady', 'lord', 'steed', 'apprentice', 'atronach', 'ritual', 'lover', 'shadow', 'serpent', 'tower'];
// xp: skill -> rate; xpAll: every skill; regen: stat -> factor (below 1 slows it); lowHealth/lowHealthRegen: a conditional
// health factor below that share of health; taken: fire/frost/shock/poison/magic -> share more (below 0: less);
// sneakDamage: a share more on a sneak attack; goldBonus: a share of loot and pay; vital: flat health/magicka/stamina
const SIGNS = {
  warrior: { name: 'The Warrior', xp: { blade: 1.1, blunt: 1.1, unarmed: 1.1, defense: 1.1 } },
  mage: { name: 'The Mage', xp: { arcane: 1.1, enchanter: 1.1 } },
  thief: { name: 'The Thief', xp: { archery: 1.1 }, goldBonus: 0.05 },
  lady: { name: 'The Lady', regen: { health: 1.1, stamina: 1.1 } },
  lord: { name: 'The Lord', regen: { health: 1.1 }, taken: { fire: 0.05 } },
  steed: { name: 'The Steed', regen: { stamina: 1.1 } },
  apprentice: { name: 'The Apprentice', regen: { magicka: 1.15 }, taken: { magic: 0.05 } },
  atronach: { name: 'The Atronach', vital: { magicka: 25 }, regen: { magicka: 0.9 }, taken: { magic: -0.05 } },
  ritual: { name: 'The Ritual', xp: { priest: 1.1 }, lowHealth: 0.3, lowHealthRegen: 1.15 },
  lover: { name: 'The Lover', xpAll: 1.05 },
  shadow: { name: 'The Shadow', sneakDamage: 0.15 },
  serpent: { name: 'The Serpent', xp: { alchemist: 1.1 }, taken: { poison: -0.15 } },
  tower: { name: 'The Tower', xp: { lockpicking: 1.15 } },
};
const DEFAULTS = { enabled: true, requireAtCreation: true, loginDelaySeconds: 20, reshowSeconds: 90, creationReshowSeconds: 15, fightSeconds: 30 };
const SKILL = { blade: 'Blade', blunt: 'Blunt', archery: 'Archery', defense: 'Defense', arcane: 'Arcane Arts', unarmed: 'Martial Arts',
  blacksmith: 'Blacksmith', alchemist: 'Alchemist', woodcutter: 'Woodcutter', miner: 'Miner', tailor: 'Tailor', skinner: 'Skinner',
  scholar: 'Scholar', enchanter: 'Enchanter', priest: 'Priest', cook: 'Cook', harvesting: 'Harvesting', lockpicking: 'Lockpicking' };
const TAKEN = { fire: 'fire', frost: 'frost', shock: 'shock', poison: 'poison', magic: 'spells' };

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const pct = (f) => Math.round(Math.abs(f) * 100);
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const merge = (cfg) => {
  const c = Object.assign({}, DEFAULTS, cfg || {});
  const own = (cfg && cfg.signs) || {};
  c.signs = {};
  for (const id of ORDER) c.signs[id] = Object.assign({ id }, SIGNS[id], own[id] || {}, { id });
  return c;
};
// The sign's gifts in words, from its numbers, so a config change keeps the menu honest
const describe = (s) => {
  const out = [];
  const xp = Object.entries(s.xp || {}).filter(([, r]) => num(r, 1) !== 1);
  const byRate = new Map();
  for (const [k, r] of xp) { const p = Math.round((num(r, 1) - 1) * 100); byRate.set(p, (byRate.get(p) || []).concat(SKILL[k] || k)); }
  for (const [p, names] of byRate) out.push(`${list(names)} learn${names.length === 1 ? 's' : ''} ${Math.abs(p)}% ${p > 0 ? 'faster' : 'slower'}`);
  if (num(s.xpAll, 1) !== 1) out.push(`every skill learns ${pct(num(s.xpAll, 1) - 1)}% ${num(s.xpAll, 1) > 1 ? 'faster' : 'slower'}`);
  if (num((s.vital || {}).health, 0)) out.push(`+${num(s.vital.health, 0)} maximum health`);
  if (num((s.vital || {}).magicka, 0)) out.push(`+${num(s.vital.magicka, 0)} maximum magicka`);
  if (num((s.vital || {}).stamina, 0)) out.push(`+${num(s.vital.stamina, 0)} maximum stamina`);
  const regen = Object.entries(s.regen || {}).filter(([, f]) => num(f, 1) !== 1);
  const up = regen.filter(([, f]) => num(f, 1) > 1), down = regen.filter(([, f]) => num(f, 1) < 1);
  const same = (xs) => xs.every(([, f]) => num(f, 1) === num(xs[0][1], 1));
  if (up.length && same(up)) out.push(`${list(up.map(([k]) => k))} regenerate${up.length === 1 ? 's' : ''} ${pct(num(up[0][1], 1) - 1)}% faster`);
  else for (const [k, f] of up) out.push(`${k} regenerates ${pct(num(f, 1) - 1)}% faster`);
  for (const [k, f] of down) out.push(`${k} regenerates ${pct(1 - num(f, 1))}% slower`);
  if (num(s.lowHealthRegen, 1) > 1) out.push(`health regenerates ${pct(num(s.lowHealthRegen, 1) - 1)}% faster below ${pct(num(s.lowHealth, 0))}% health`);
  for (const [k, sh] of Object.entries(s.taken || {})) if (num(sh, 0)) out.push(`${TAKEN[k] || k} hurt${k === 'magic' ? '' : 's'} ${pct(num(sh, 0))}% ${num(sh, 0) > 0 ? 'more' : 'less'}`);
  if (num(s.sneakDamage, 0) > 0) out.push(`sneak attacks deal ${pct(num(s.sneakDamage, 0))}% more`);
  if (num(s.goldBonus, 0) > 0) out.push(`${pct(num(s.goldBonus, 0))}% more gold from loot and contract pay`);
  const text = out.join('; ');
  return text ? text[0].toUpperCase() + text.slice(1) : 'No gift';
};

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, cfg, openWidget, closeWidget, onUi, registerChatCommand, onlineActors, every, isLeadStaff, findByName, profileOf } = api;
  const C = merge(cfg && cfg.birthsigns);
  const on = () => C.enabled === true;
  // open: actor -> { mode 'pick'|'confirm', sign?, at }; nextAt: actor -> when the menu may come back; step: in the creation step
  const S = globalThis.__dboBirthsignState || (globalThis.__dboBirthsignState = { open: new Map(), nextAt: new Map(), step: new Set(), failed: new Set() });

  const get = (a, k) => { try { return mp.get(a >>> 0, k); } catch (e) { return undefined; } };
  const isPlayer = (a) => { try { return profileOf(a >>> 0) >= 0; } catch (e) { return false; } };
  const recordOf = (a) => { const r = get(a, PROP); return r && typeof r === 'object' && C.signs[String(r.id)] ? r : null; };
  const signOf = (a) => { const r = recordOf(a); return r ? C.signs[String(r.id)] : null; };
  const find = (q) => {
    const k = String(q || '').trim().toLowerCase().replace(/^the\s+/, '');
    return C.signs[k] || null;
  };
  const row = (s) => ({ id: s.id, label: `${s.name}: ${describe(s)}` });

  // ---- what keeps the menu away ---------------------------------------------------------------------------------------
  const online = (a) => get(a, 'isOnline') !== false;
  const inEditor = (a) => { try { return typeof globalThis.__dboInEditor === 'function' && !!globalThis.__dboInEditor(a >>> 0); } catch (e) { return false; } };
  const creating = (a) => get(a, 'private.creationPending') === true || get(a, 'appearance') == null;
  const jailing = (a) => {
    const p = globalThis.__dboJailPending;
    if (p instanceof Map && p.has(a >>> 0)) return true;
    const s = get(a, 'private.dboSentence');
    return !!(s && num(s.totalMs, 0) > 0 && num(s.servedMs, 0) < num(s.totalMs, 0));
  };
  const downed = (a) => { try { return typeof globalThis.__dboIsDowned === 'function' && !!globalThis.__dboIsDowned(a >>> 0); } catch (e) { return false; } };
  const fighting = (a, now) => { const m = globalThis.__dboCombatAt; const t = m instanceof Map ? num(m.get(a >>> 0), 0) : 0; return t > 0 && now - t < num(C.fightSeconds, 30) * 1000; };
  // Why the menu waits now, or ''
  const waitReason = (a, now = Date.now()) => {
    if (!online(a)) return 'offline';
    if (creating(a)) return 'creation';
    if (inEditor(a)) return 'editor';
    if (jailing(a)) return 'jail';
    if (downed(a)) return 'downed';
    if (fighting(a, now)) return 'fighting';
    return '';
  };

  // ---- the menu ---------------------------------------------------------------------------------------------------------
  const send = (a, targetName, actions) => openWidget(a >>> 0, { type: 'contextMenu', id: WIDGET_ID, mode: 'menu', targetName, actions,
    events: { action: 'dbo:birthsignChoose', close: 'dbo:birthsignClose' } }, true);
  const openPick = (a) => {
    const ok = send(a, 'Choose your birthsign. It is yours for life.', ORDER.map((id) => row(C.signs[id])));
    if (ok) { S.open.set(a >>> 0, { mode: 'pick', at: Date.now() }); S.failed.delete(a >>> 0); } else S.failed.add(a >>> 0);
    return !!ok;
  };
  const openConfirm = (a, s) => {
    const ok = send(a, `${s.name}, for life: ${describe(s)}. Only staff can change it later.`, [{ id: 'confirm', label: 'Confirm' }, { id: 'back', label: 'Choose again' }]);
    if (ok) S.open.set(a >>> 0, { mode: 'confirm', sign: s.id, at: Date.now() });
    return !!ok;
  };
  const delayMs = (a) => num(S.step.has(a >>> 0) ? C.creationReshowSeconds : C.reshowSeconds, 90) * 1000;
  const syncVitals = (a) => { try { if (typeof globalThis.__dboCharLevelSyncBonus === 'function') globalThis.__dboCharLevelSyncBonus(a >>> 0); } catch (e) { log('birthsign vital sync failed', e.message); } };
  const write = (a, id, by) => {
    try { mp.set(a >>> 0, PROP, id ? { id, at: Date.now(), by } : null); return true; } catch (e) { log('birthsign write failed', e.message); return false; }
  };
  // The creation step goes on to the god once there is a sign
  const stepDone = (a) => {
    if (!S.step.delete(a >>> 0)) return;
    try { if (typeof globalThis.__dboBirthsignStepDone === 'function') globalThis.__dboBirthsignStepDone(a >>> 0); } catch (e) { log('birthsign step end failed', e.message); }
  };
  const choose = (a, s) => {
    if (recordOf(a)) return false;
    if (!write(a, s.id, 'self')) return false;
    S.open.delete(a >>> 0); S.nextAt.delete(a >>> 0); S.failed.delete(a >>> 0);
    try { closeWidget(a >>> 0, WIDGET_ID); } catch (e) { /* not open */ }
    audit(`BIRTHSIGN ${who(a)} was born under ${s.name}`);
    personal(a >>> 0, `You were born under ${s.name}: ${describe(s)}.`);
    syncVitals(a);
    stepDone(a);
    return true;
  };

  onUi('birthsignChoose', (a, args) => {
    const st = S.open.get(a >>> 0);
    if (!st || recordOf(a)) { try { closeWidget(a >>> 0, WIDGET_ID); } catch (e) { /* not open */ } S.open.delete(a >>> 0); return; }
    const choice = String((args && args[0]) || '');
    if (st.mode === 'pick') { const s = C.signs[choice]; if (s && ORDER.includes(choice)) openConfirm(a, s); return; }
    if (choice === 'back') { openPick(a); return; }
    if (choice === 'confirm' && C.signs[st.sign]) choose(a, C.signs[st.sign]);
  });
  onUi('birthsignClose', (a) => {
    if (!S.open.delete(a >>> 0)) return;
    try { closeWidget(a >>> 0, WIDGET_ID); } catch (e) { /* not open */ }
    if (recordOf(a)) return;
    S.nextAt.set(a >>> 0, Date.now() + delayMs(a));
    personal(a >>> 0, `Every character is born under a sign. The choice comes back in ${Math.round(delayMs(a) / 1000)} seconds, or type /birthsign to see the signs.`);
  });

  // The creation step (gamemode.js endCreation): true when the menu opened and the step is waiting for the choice
  globalThis.__dboBirthsignCreationOpen = (a) => {
    if (!on() || C.requireAtCreation === false || recordOf(a)) return false;
    // Already at this step, its menu up or coming back: leaveRealm asks again and is told so
    if (S.step.has(a >>> 0) && (S.open.has(a >>> 0) || S.nextAt.has(a >>> 0))) return true;
    S.step.add(a >>> 0);
    if (openPick(a)) { log(`${display(a)} is choosing a birthsign in the Realm`); return true; }
    S.step.delete(a >>> 0);
    log(`birthsign menu REFUSED for ${display(a)}; the creation step goes on without it`);
    return false;
  };
  // gamemode.js: a gate and leaveRealm take nobody on from the hub without a sign, unless the menu could not be sent
  globalThis.__dboBirthsignHold = (a) => on() && C.requireAtCreation !== false && isPlayer(a) && !recordOf(a) && !S.failed.has(a >>> 0);
  globalThis.__dboBirthsignGateLine = 'Choose your birthsign before you leave the Realm: the choice is on your screen, or type /birthsign to see the signs.';
  globalThis.__dboBirthsignLogin = (a) => {
    S.open.delete(a >>> 0);
    if (!on() || recordOf(a)) return;
    S.nextAt.set(a >>> 0, Date.now() + num(C.loginDelaySeconds, 20) * 1000);
  };
  globalThis.__dboBirthsignLeave = (a) => { S.open.delete(a >>> 0); S.nextAt.delete(a >>> 0); S.step.delete(a >>> 0); S.failed.delete(a >>> 0); };

  // Characters without a sign: the menu comes back when its time is due and nothing keeps it away. The creation step's own
  // menu comes back here too after a close
  const tick = (now = Date.now()) => {
    if (!on()) return;
    for (const a of onlineActors()) {
      const id = a >>> 0;
      if (S.open.has(id) || !S.nextAt.has(id) || now < S.nextAt.get(id)) continue;
      if (recordOf(a)) { S.nextAt.delete(id); continue; }
      if (waitReason(a, now)) continue;
      S.nextAt.delete(id);
      if (!openPick(a)) S.nextAt.set(id, now + delayMs(a));
    }
  };
  every('birthsignPrompt', 5000, () => { try { tick(); } catch (e) { log('birthsign prompt failed', e.message); } });

  // ---- /birthsign ---------------------------------------------------------------------------------------------------------
  // Online by name or tag, offline by #TAG (supernatural.js findCharacter's rule)
  const findCharacter = (q) => {
    const m = String(q || '').trim().toLowerCase().match(/#([a-z0-9]{4})$/);
    if (m) { try { const r = mp.findFormsByPropertyValue('private.indexed.tagKey', m[1]); if (Array.isArray(r) && r.length === 1) return Number(r[0]) >>> 0; } catch (e) { /* try who is online */ } }
    return findByName(q) || 0;
  };
  // A sign is a character's stats, so the staff rules for skills apply (staffguard.js kinds)
  const staffNo = (by, t) => { try { const g = globalThis.__dboStaffGuard; return g ? String(g.target(by, t, 'skills') || '') : ''; } catch (e) { return ''; } };
  const staffSet = (by, q, signQ, clear) => {
    if (!isLeadStaff(by)) return 'Only a Lead GM or above can change a birthsign.';
    const t = findCharacter(q);
    if (!t || !isPlayer(t)) return `No character found for "${String(q || '').trim()}". Use their name if they are online, or their #TAG.`;
    const no = staffNo(by, t); if (no) return no;
    const s = clear ? null : find(signQ);
    if (!clear && !s) return `No such sign. The signs: ${ORDER.map((id) => C.signs[id].name.replace(/^The /, '')).join(', ')}.`;
    const was = signOf(t);
    if (!write(t, s ? s.id : null, who(by))) return 'The birthsign could not be written.';
    audit(`BIRTHSIGN ${who(by)} set ${who(t)} from ${was ? was.name : 'none'} to ${s ? s.name : 'none'}`);
    S.open.delete(t); S.nextAt.delete(t);
    if (online(t)) {
      try { closeWidget(t, WIDGET_ID); } catch (e) { /* not open */ }
      if (s) personal(t, `Staff set your birthsign to ${s.name}: ${describe(s)}.`);
      else { personal(t, 'Staff cleared your birthsign. Choose again.'); S.nextAt.set(t, Date.now()); }
      syncVitals(t);
      if (s) stepDone(t);
    }
    return `${display(t)}: ${was ? was.name : 'no sign'} -> ${s ? s.name : 'no sign'}.`;
  };
  registerChatCommand('birthsign', (a, argStr) => {
    const args = String(argStr || '').trim().split(/\s+/).filter(Boolean);
    const sub = (args[0] || '').toLowerCase();
    // set <player|#TAG> [the] <sign>: the sign is the last word
    if (sub === 'set') { const target = args.slice(1, -1); if (target.length > 1 && /^the$/i.test(target[target.length - 1])) target.pop(); return personal(a, staffSet(a, target.join(' '), args[args.length - 1], false)); }
    if (sub === 'clear') return personal(a, staffSet(a, args.slice(1).join(' '), '', true));
    const mine = signOf(a);
    if (mine) return personal(a, `You were born under ${mine.name}: ${describe(mine)}.${args.length ? ' Only staff can change it.' : ''}`);
    if (!on()) return personal(a, 'Birthsigns are not in use yet.');
    // Typing the sign is the choice, for anyone the menu cannot reach
    if (args.length) { const s = find(args.join(' ')); if (s) return choose(a, s) ? undefined : personal(a, 'Your birthsign could not be written. Try again.'); }
    if (args.length) personal(a, `No such sign. The signs: ${ORDER.map((id) => C.signs[id].name.replace(/^The /, '')).join(', ')}.`);
    if (!openPick(a)) personal(a, `Choose by typing it: /birthsign ${ORDER.join(', ')}.`);
  }, { help: 'your birthsign; /birthsign <sign> chooses one if you have none; staff: /birthsign set <player|#TAG> <sign>, /birthsign clear <player|#TAG>' });

  const addStatus = (key, order, fn) => { try { if (typeof globalThis.__dboRegisterStatus === 'function') globalThis.__dboRegisterStatus(key, order, fn); } catch (e) { /* gamemode older than /status */ } };
  addStatus('birthsign', 55, (a) => { const s = signOf(a); return s ? `Birthsign: ${s.name} (${describe(s)})` : null; });

  // racial.js: the sign whose gifts apply to this character, or null
  globalThis.__dboBirthsignOf = (a) => (on() ? signOf(a) : null);
  log(`birthsigns ${on() ? 'on' : 'off'}: ${ORDER.length} signs, ${C.requireAtCreation === false ? 'optional' : 'required'} at creation`);
  return { config: C, signOf, describe, waitReason, tick, choose, staffSet, findCharacter, WIDGET_ID };
};
module.exports.SIGNS = SIGNS;
module.exports.ORDER = ORDER;
module.exports.describe = describe;
module.exports.merge = merge;
