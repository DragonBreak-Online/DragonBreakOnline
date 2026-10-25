// DragonBreak Online: Briarhearts, Reachmen of the Old Gods whose heart a Hagraven has replaced with a briar heart (Nat, 25 Oct
// 2026; design _work\briarheart-peryite-design-1025.md on the PC, items A1-A4). Loaded by gamemode.js after supernatural.js,
// prayer.js and downed.js. Off until config briarheart.enabled is true (feature flags are switched on with Nat).
//
// Not a curse kind of supernatural.js: a Briarheart is no beast (gamemode.js, guilds.js and beastform.js read any
// __dboSuperKind as one), so its state is its own (private.dboBriarheart) and the two refuse each other:
// supernatural.js asks __dboIsBriarheart before a fever or its Molag Bal / Hircine rites; the rite here refuses a vampire
// or a werewolf (and a carrier of their fever).
//
// The rite (A1): /briarheart rite at a Hagraven altar (staff place them where they stand: /briarheart altar add) by a
//   character of config races (the DLE's DBOReachmanRace) whose faith (prayer.js) is in config faiths (The Reach Old Gods),
//   carrying a Briar Heart (heartItem), confirmed with /briarheart confirm within 5 minutes. The heart is spent. At
//   failChance the briar does not take: the character dies, for good with failPermadeath (Nat, 25 Oct: on), else an
//   ordinary death; either way the altar is cold to them for failCooldownHours. While either permadeath setting is on,
//   /briarheart rite says so plainly and the confirm must be /briarheart confirm forever (a plain confirm repeats the
//   warning); the warning and the acceptance are both audited. Staff make one without the rite:
//   /briarheart grant <name> <reason> (Lead GM and above), and take it away: /briarheart revoke <name> <reason>.
// The gifts (A2): healthBonus more health (charlevel.js adds __dboBriarheartVitalBonus to the maximum), resist of each
//   element's spell hits (poison and frost: the hit's source effects are resisted by that resistance, as racial.js reads
//   it), the Hagraven's spells (config spells, vanilla: Ironflesh and Lightning Cloak) given with AddSpell and taken back at
//   the end. forswornFriendly (Nat, 25 Oct: on): the character joins ForswornFaction (server Papyrus AddToFaction); whether
//   the Forsworn then spare them is the clients' AI, so each AddToFaction / RemoveFromFaction is logged with the
//   server's IsInFaction read back ("briarheart: faction ...") for the in-game check.
// The price (A3): fire spell hits harder (fireWeakness). No Divine's blessing (prayer.js asks __dboBriarheartRefusesDivine)
//   and no turning from the faith (prayer.js asks __dboBriarheartFaithLock). The heart can be torn out: another player stands
//   over a DOWNED Briarheart and chooses "Tear out the heart" in the player menu (X), and after tearSeconds still beside
//   them the Briarheart dies at once (downed.js __dboDownedKill; tearPermadeath, Nat 25 Oct: on, for good) and is a Briarheart no more; the
//   heart goes to the one who took it (a Briar Heart). Never a staff member, nor in a duel, and the taker must not be down.
// The cure: /briarheart cure at a shrine of Arkay or Stendarr touched in the last 10 minutes (prayer.js
//   __dboPrayerLastShrine), spending a filled black soul gem: the heart withers and the character lives on as a mortal.
// The look (A5): config visual { enabled, armor } puts an armour on the character at the rite and takes it at the end.
//   Off and empty until Worker 1's plugin delivers the overlay ARMO/ARMA with the heart-only mesh: the vanilla
//   ArmorBriarHeart (Skyrim 05D008) is a body-slot item and would take the place of the character's armour.
//
// Chat: /briarheart [status] | rite | confirm [forever] | cure; staff: grant <name> <reason> | revoke <name> <reason> | list |
//   altar add [radius] | altar list | altar remove <n>.
// State: private.dboBriarheart = { since, how: 'rite'|'staff', by } on the character; briarheart.json beside the server
//   (runtime, gitignored) = { altars: [{ world, pos: [x, y, z], radius, by, at }] }.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, cfg, registerChatCommand, onlineActors, isLeadStaff, findByName, every } = api;
  const sourceResistsOf = typeof api.sourceResistsOf === 'function' ? api.sourceResistsOf : () => new Set();
  const giveItem = typeof api.giveItem === 'function' ? api.giveItem : null;
  const C = Object.assign({
    enabled: false,
    races: ['DBOReachmanRace'], faiths: ['reach'],
    heartItem: '3ad61:Skyrim.esm',            // Briar Heart (INGR)
    altarRadius: 400, confirmMinutes: 5,
    failChance: 0.1, failPermadeath: false, failCooldownHours: 24,
    healthBonus: 50, resist: { poison: 0.15, frost: 0.15 }, fireWeakness: 0.25,
    spells: ['72317:Skyrim.esm', '400ad:Skyrim.esm'],   // IronfleshLeftHand, LightningCloakLeftHand (the Briarheart template's)
    forswornFriendly: false, forswornFaction: '43599:Skyrim.esm',
    tearSeconds: 10, tearRange: 250, tearPermadeath: false, tearGivesHeart: true,
    noDivineBlessings: true, faithLocked: true,
    cureDeities: ['arkay', 'stendarr'], cureItem: '2e504:Skyrim.esm',  // a filled black soul gem
    visual: { enabled: false, armor: '5d008:Skyrim.esm' },
  }, (cfg && cfg.briarheart) || {});
  const PROP = 'private.dboBriarheart', FAILED = 'private.dboBriarheartFailedAt';
  const FILE = path.resolve('briarheart.json');
  const AV_POISON = 40, AV_FIRE = 41, AV_FROST = 43;   // MGEF DATA resist value (libespm ActorValue.h), as gamemode.js reads it
  const MIN = 60000, HOUR = 3600000;

  // ---- state, kept across hot reloads ----------------------------------------------------------------------------------
  const S = globalThis.__dboBriarheart || (globalThis.__dboBriarheart = { data: null, pending: new Map(), tears: new Map() });
  if (!(S.pending instanceof Map)) S.pending = new Map();
  if (!(S.tears instanceof Map)) S.tears = new Map();
  const data = () => {
    if (S.data) return S.data;
    let d = null; try { d = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { d = null; }
    S.data = d && typeof d === 'object' ? d : {};
    if (!Array.isArray(S.data.altars)) S.data.altars = [];
    return S.data;
  };
  const save = () => {
    try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(data(), null, 1)); fs.renameSync(FILE + '.tmp', FILE); }
    catch (e) { log('briarheart: saving failed', e.message); }
  };

  // ---- helpers ----------------------------------------------------------------------------------------------------------
  const idOf = (desc) => { try { return Number(mp.getIdFromDesc(String(desc))) >>> 0; } catch (e) { return 0; } };
  const get = (a, p, d) => { try { const v = mp.get(a >>> 0, p); return v === undefined || v === null ? d : v; } catch (e) { return d; } };
  const set = (a, p, v) => { try { mp.set(a >>> 0, p, v); return true; } catch (e) { log(`briarheart: writing ${p} failed`, e.message); return false; } };
  const isOnline = (a) => onlineActors().includes(a >>> 0);
  const papyrus = (a, method, args) => { try { mp.callPapyrusFunction('method', 'Actor', method, { type: 'form', desc: mp.getDescFromId(a >>> 0) }, args); return true; } catch (e) { log(`briarheart: ${method} failed`, e.message); return false; } };
  const form = (desc) => ({ type: 'form', desc: String(desc) });
  // The server's Papyrus answer (IsInFaction), for the in-game check of forswornFriendly
  const papyrusValue = (a, method, args) => { try { return mp.callPapyrusFunction('method', 'Actor', method, { type: 'form', desc: mp.getDescFromId(a >>> 0) }, args); } catch (e) { return `error: ${e.message}`; } };
  const faction = (a, on, why) => {
    papyrus(a, on ? 'AddToFaction' : 'RemoveFromFaction', [form(C.forswornFaction)]);
    const inIt = papyrusValue(a, 'IsInFaction', [form(C.forswornFaction)]);
    log(`briarheart: faction ${on ? 'AddToFaction' : 'RemoveFromFaction'} ${C.forswornFaction} on ${display(a)} (${why}); IsInFaction now ${JSON.stringify(inIt === undefined ? null : inIt)}`);
  };
  const fn = (n) => (typeof globalThis[n] === 'function' ? globalThis[n] : null);
  const call = (n, ...args) => { const f = fn(n); if (!f) return undefined; try { return f(...args); } catch (e) { log(`briarheart: ${n} failed`, e.message); return undefined; } };
  const recOf = (a) => { const r = get(a, PROP, null); return r && typeof r === 'object' && r.since ? r : null; };
  const isBriar = (a) => !!recOf(a);
  const raceEdid = (a) => { try { const app = mp.get(a >>> 0, 'appearance'); const r = app && mp.lookupEspmRecordById(Number(app.raceId) >>> 0); return String((r && r.record && r.record.editorId) || ''); } catch (e) { return ''; } };
  const invOf = (a) => { try { return ((mp.get(a >>> 0, 'inventory') || {}).entries || []); } catch (e) { return []; } };
  const hasOne = (a, id) => invOf(a).some((e) => (Number(e.baseId) >>> 0) === id && Number(e.count) > 0);
  const takeOne = (a, id) => {
    const entries = invOf(a).map((e) => Object.assign({}, e));
    const hit = entries.find((e) => (Number(e.baseId) >>> 0) === id && Number(e.count) > 0);
    if (!hit) return false;
    hit.count -= 1; set(a, 'inventory', { entries: entries.filter((e) => Number(e.count) > 0) }); return true;
  };
  const posOf = (a) => { try { const l = mp.get(a >>> 0, 'locationalData'); return l && Array.isArray(l.pos) ? { world: String(l.cellOrWorldDesc || ''), pos: l.pos } : null; } catch (e) { return null; } };
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], (p[2] || 0) - (q[2] || 0));
  const altarNear = (a) => {
    const here = posOf(a); if (!here || !here.pos) return null;
    return data().altars.find((x) => String(x.world) === String(here.world) && dist(x.pos, here.pos) <= (Number(x.radius) || C.altarRadius)) || null;
  };
  const isStaff = (a) => !!call('__dboIsStaff', a >>> 0);
  const superKind = (a) => call('__dboSuperKind', a >>> 0) || null;
  const superState = (a) => get(a, 'private.supernatural', null) || {};
  const faithId = (a) => String(call('__dboFaithIdOf', a >>> 0) || '');
  const waitText = (ms) => { const h = Math.floor(ms / HOUR), m = Math.ceil((ms % HOUR) / MIN); return `${h ? `${h}h ` : ''}${m}m`; };

  // ---- the gifts on and off ---------------------------------------------------------------------------------------------
  // Spells, the faction and the look follow the record: applied at the rite and at each login, taken at the end
  const applyGifts = (a, why) => {
    if (!isOnline(a)) return;
    for (const d of C.spells || []) papyrus(a, 'AddSpell', [form(d), false]);
    if (C.forswornFriendly) faction(a, true, why || 'gifts');
    if (C.visual && C.visual.enabled && C.visual.armor) {
      const id = idOf(C.visual.armor);
      if (id && !hasOne(a, id) && giveItem) giveItem(a >>> 0, id, 1);
      if (id) papyrus(a, 'EquipItem', [form(C.visual.armor), false, true]);
    }
    call('__dboCharLevelSyncBonus', a >>> 0);
  };
  const removeGifts = (a, why) => {
    if (isOnline(a)) {
      for (const d of C.spells || []) papyrus(a, 'RemoveSpell', [form(d)]);
      if (C.forswornFriendly) faction(a, false, why || 'end');
    }
    if (C.visual && C.visual.enabled && C.visual.armor) { const id = idOf(C.visual.armor); if (id) takeOne(a, id); }
    call('__dboCharLevelSyncBonus', a >>> 0);
  };
  const become = (a, how, by) => {
    set(a, PROP, { since: Date.now(), how, by: String(by || '') });
    applyGifts(a, how);
  };
  const end = (a, why) => {
    if (!isBriar(a)) return false;
    set(a, PROP, null);
    removeGifts(a, why);
    audit(`BRIARHEART ${who(a)} is a Briarheart no more (${why})`);
    return true;
  };

  // ---- the rite ---------------------------------------------------------------------------------------------------------
  // Why a character cannot take the rite here, or ''
  const riteRefusal = (a) => {
    if (!C.enabled) return 'The Hagravens are not taking hearts.';
    if (isBriar(a)) return 'A briar heart already beats in your chest.';
    if (isStaff(a)) return 'Staff take no rite.';
    const k = superKind(a); if (k) return k === 'vampire' ? 'The dead have no heart to give. Be cured first.' : 'Hircine has marked you. The Hagravens will not take his beast. Be cured first.';
    if (superState(a).disease) return 'A fever holds you. The Hagravens want a heart that is your own: be cured first.';
    const race = raceEdid(a);
    if (!(C.races || []).some((r) => race === r)) return 'The Hagravens give the briar only to the Reachfolk.';
    if (!(C.faiths || []).includes(faithId(a))) return 'The briar is for those who keep the Old Gods of the Reach. Take them as your faith first.';
    const failed = Number(get(a, FAILED, 0)) || 0, wait = failed + C.failCooldownHours * HOUR - Date.now();
    if (wait > 0) return `The altar is cold to you since the briar would not take. Try again in ${waitText(wait)}.`;
    if (!altarNear(a)) return 'The rite is made at a Hagraven altar in the Reach.';
    if (!hasOne(a, idOf(C.heartItem))) return 'The rite needs a Briar Heart to set in your chest.';
    return '';
  };
  // The rite's permanent risks, said plainly (Nat, 25 Oct: both on)
  const forever = () => !!(C.failPermadeath || C.tearPermadeath);
  const risks = () => [
    C.failPermadeath ? `PERMANENT DEATH: ${Math.round(C.failChance * 100)} in 100 die under the knife, and this character is gone for good` : `${Math.round(C.failChance * 100)} in 100 die under the knife (an ordinary death)`,
    C.tearPermadeath ? 'PERMANENT DEATH: if anyone tears the briar out of you while you are down, this character is gone for good' : 'if anyone tears the briar out of you while you are down, you die and the briar is lost',
  ];
  const riskAudit = () => `rite death ${C.failPermadeath ? 'for good' : 'ordinary'}, heart torn out ${C.tearPermadeath ? 'for good' : 'ordinary'}`;
  const confirmWord = () => (forever() ? '/briarheart confirm forever' : '/briarheart confirm');
  const rite = (a) => {
    const no = riteRefusal(a); if (no) return no;
    S.pending.set(a >>> 0, Date.now());
    audit(`BRIARHEART ${who(a)} asked for the rite and was warned (${riskAudit()})`);
    return `A Hagraven will cut out your heart and set the briar in its place. It makes you hard to kill and binds you to the Old Gods: no Divine will bless you. ${risks().join('. ')}. Say ${confirmWord()} within ${C.confirmMinutes} minutes to kneel.`;
  };
  const confirm = (a, word) => {
    const at = S.pending.get(a >>> 0);
    if (!at || Date.now() - at > C.confirmMinutes * MIN) { S.pending.delete(a >>> 0); return 'There is nothing to confirm. Kneel at the altar and say /briarheart rite.'; }
    // A permanent rite is not taken with the plain word: the warning again, the rite still pending
    if (forever() && String(word || '').toLowerCase() !== 'forever') return `This rite can end this character for good. ${risks().join('. ')}. If you accept that, say /briarheart confirm forever.`;
    S.pending.delete(a >>> 0);
    const no = riteRefusal(a); if (no) return no;
    audit(`BRIARHEART ${who(a)} accepted the rite's risks (${riskAudit()})`);
    if (!takeOne(a, idOf(C.heartItem))) return 'The rite needs a Briar Heart to set in your chest.';
    if (Math.random() < C.failChance) {
      set(a, FAILED, Date.now());
      audit(`BRIARHEART ${who(a)} died in the rite${C.failPermadeath ? ' (for good)' : ''}`);
      if (C.failPermadeath && fn('__dboPermaKill')) { call('__dboPermaKill', a >>> 0, 'the briar heart did not take'); return 'The briar does not take. This life is over.'; }
      set(a, 'isDead', true);
      return 'The briar does not take, and your own heart is gone. You die on the altar, and wake again.';
    }
    become(a, 'rite', '');
    audit(`BRIARHEART ${who(a)} took the briar heart at a Hagraven altar`);
    return 'The Hagraven presses the briar into your chest. It takes root. You feel the Reach in your blood, and nothing of the Divines.';
  };

  // ---- the cure ---------------------------------------------------------------------------------------------------------
  const cure = (a) => {
    if (!isBriar(a)) return 'No briar grows in your chest.';
    const m = globalThis.__dboPrayerLastShrine; const v = m && m.get(a >>> 0);
    if (!v || Date.now() - v.at > 10 * MIN || !(C.cureDeities || []).includes(v.deityId)) return 'The briar is drawn out at a shrine of Arkay or Stendarr: touch one, then say /briarheart cure.';
    if (!takeOne(a, idOf(C.cureItem))) return 'The cure needs a filled black soul gem to take the briar\'s life into.';
    end(a, `cured at a shrine of ${v.deityId === 'arkay' ? 'Arkay' : 'Stendarr'}`);
    return 'The black soul gem drinks the briar\'s life. It withers in your chest, and your own blood takes its place. You are mortal again.';
  };

  // ---- tearing out the heart ----------------------------------------------------------------------------------------------
  const isDowned = (a) => !!call('__dboIsDowned', a >>> 0);
  const inDuel = (a, t) => !!call('__dboInDuel', a >>> 0) || !!call('__dboInDuel', t >>> 0);
  const near = (a, t, r) => { const p = posOf(a), q = posOf(t); return !!(p && q && p.pos && q.pos && String(p.world) === String(q.world) && dist(p.pos, q.pos) <= r); };
  // Why a may not tear t's heart, or ''
  const tearRefusal = (a, t) => {
    if (!C.enabled) return 'Not now.';
    if (!isBriar(t)) return 'There is no briar in that chest.';
    if ((a >>> 0) === (t >>> 0)) return 'Not your own.';
    if (!isDowned(t)) return 'Only a fallen Briarheart lies still enough to reach the briar.';
    if (isDowned(a)) return 'You are down yourself.';
    if (isStaff(a) || isStaff(t)) return 'Staff take no part in this.';
    if (inDuel(a, t)) return 'Not in a duel.';
    if (!near(a, t, C.tearRange)) return 'Stand over them.';
    return '';
  };
  const startTear = (a, t) => {
    const no = tearRefusal(a, t); if (no) return no;
    S.tears.set(a >>> 0, { t: t >>> 0, at: Date.now() });
    if (isOnline(t)) personal(t >>> 0, `${display(a)} kneels over you and reaches for the briar in your chest.${C.tearPermadeath ? ' If they tear it out, this character dies for good.' : ''}`);
    audit(`BRIARHEART ${who(a)} began to tear the briar heart out of ${who(t)}${C.tearPermadeath ? ' (permadeath if it finishes)' : ''}`);
    return `You reach into the briar. Stay over them for ${C.tearSeconds} seconds.${C.tearPermadeath ? ' Tearing it out ends them for good.' : ''}`;
  };
  const finishTear = (a, j) => {
    const t = j.t;
    const no = tearRefusal(a, t);
    if (no) { if (isOnline(a)) personal(a, `The briar slips from your hand: ${no.toLowerCase()}`); return; }
    end(t, `heart torn out by ${who(a)}`);
    if (C.tearGivesHeart && giveItem) giveItem(a >>> 0, idOf(C.heartItem), 1);
    audit(`BRIARHEART ${who(a)} tore the briar heart out of ${who(t)}${C.tearPermadeath ? ' (for good)' : ''}`);
    if (isOnline(a)) personal(a, 'You tear the briar out. It is still beating in your hand.');
    if (isOnline(t)) personal(t, 'The briar is torn out of your chest. Your body knows it has no heart.');
    if (C.tearPermadeath && fn('__dboPermaKill')) { call('__dboPermaKill', t, 'briar heart torn out'); return; }
    if (!call('__dboDownedKill', t, a >>> 0, 'briar heart torn out')) set(t, 'isDead', true);
  };
  // gamemode.js tick (every second): a tear that held finishes, one whose taker moved off or whose target rose is dropped
  const tick = () => {
    for (const [a, j] of [...S.tears]) {
      if (Date.now() - j.at < C.tearSeconds * 1000) { if (!near(a, j.t, C.tearRange) || !isDowned(j.t)) { S.tears.delete(a); if (isOnline(a)) personal(a, 'You let go of the briar.'); } continue; }
      S.tears.delete(a); finishTear(a, j);
    }
  };
  if (typeof every === 'function') every('briarheart', 1000, tick);

  // ---- hooks for the other modules ----------------------------------------------------------------------------------------
  globalThis.__dboIsBriarheart = (a) => C.enabled && isBriar(Number(a) >>> 0);
  // charlevel.js: added to the maximum, as the race's flat bonus is
  globalThis.__dboBriarheartVitalBonus = (a) => ({ health: C.enabled && isBriar(Number(a) >>> 0) ? Math.max(0, Number(C.healthBonus) || 0) : 0 });
  // gamemode.js onHitDamageAttempt, the target side: resist below 1 (capped with the race's under reductionCap), fire above 1
  globalThis.__dboBriarheartTargetMult = (agg, tgt, src) => {
    if (!C.enabled || !isBriar(Number(tgt) >>> 0) || (Number(agg) >>> 0) === (Number(tgt) >>> 0)) return 1;
    let rs; try { rs = sourceResistsOf(Number(src) >>> 0); } catch (e) { rs = null; }
    if (!rs || typeof rs.has !== 'function') return 1;
    let m = 1;
    const R = C.resist || {};
    if (rs.has(AV_POISON)) m *= 1 - Math.max(0, Math.min(1, Number(R.poison) || 0));
    if (rs.has(AV_FROST)) m *= 1 - Math.max(0, Math.min(1, Number(R.frost) || 0));
    if (rs.has(AV_FIRE)) m *= 1 + Math.max(0, Number(C.fireWeakness) || 0);
    return m;
  };
  // prayer.js: a Divine's blessing does not rest on a briar heart; a Briarheart keeps the Old Gods
  globalThis.__dboBriarheartRefusesDivine = (a) => (C.enabled && C.noDivineBlessings && isBriar(Number(a) >>> 0) ? 'The briar in your chest belongs to the Hagravens. No Divine\'s blessing reaches it.' : '');
  globalThis.__dboBriarheartFaithLock = (a) => (C.enabled && C.faithLocked && isBriar(Number(a) >>> 0) ? 'The briar binds you to the Old Gods of the Reach. While it beats, you turn to no other.' : '');
  // gamemode.js at login: the spells, faction and look come back with the character
  globalThis.__dboBriarheartLogin = (a) => { if (C.enabled && isBriar(Number(a) >>> 0)) applyGifts(Number(a) >>> 0, 'login'); };
  // playermenu.js (X): the entry over a fallen Briarheart
  globalThis.__dboBriarheartMenuEntries = (a, t) => (C.enabled && isBriar(t >>> 0) && isDowned(t >>> 0) && !isStaff(a) ? [{ id: 'briartear', label: 'Tear out the heart' }] : []);
  globalThis.__dboBriarheartMenuAction = (a, id, t) => { if (id !== 'briartear') return false; personal(a >>> 0, startTear(a >>> 0, t >>> 0)); return true; };

  // ---- chat ----------------------------------------------------------------------------------------------------------------
  const target = (q) => { const id = typeof findByName === 'function' ? findByName(String(q || '').trim()) : 0; return id > 0 ? id >>> 0 : 0; };
  registerChatCommand('briarheart', (a, args) => {
    const words = String(args || '').trim().split(/\s+/).filter(Boolean);
    const sub = (words.shift() || 'status').toLowerCase();
    if (sub === 'status') {
      const r = recOf(a);
      return personal(a, r ? `A briar heart has beaten in your chest since ${new Date(r.since).toISOString().slice(0, 10)}.${C.tearPermadeath ? ' If it is torn out of you while you are down, this character dies for good.' : ''}` : 'Your heart is your own.');
    }
    if (sub === 'rite') return personal(a, rite(a));
    if (sub === 'confirm') return personal(a, confirm(a, words[0]));
    if (sub === 'cure') return personal(a, cure(a));
    if (!isLeadStaff(a)) return personal(a, 'Usage: /briarheart [status] | rite | confirm | cure');
    if (sub === 'grant' || sub === 'revoke') {
      // The longest leading run of words that names an online character; the rest is the reason
      let t = 0, n = 0; for (let k = words.length; k >= 1 && !t; k--) { t = target(words.slice(0, k).join(' ')); if (t) n = k; }
      const why = words.slice(n).join(' ').trim();
      if (!t) return personal(a, `Usage: /briarheart ${sub} <name online> <reason>`);
      if (!why) return personal(a, 'Give a reason; it goes in the audit.');
      if (sub === 'grant') {
        if (isBriar(t)) return personal(a, `${display(t)} is a Briarheart already.`);
        if (superKind(t)) return personal(a, `${display(t)} is a ${superKind(t)}; be cured first.`);
        become(t, 'staff', who(a));
        audit(`BRIARHEART ${who(a)} made ${who(t)} a Briarheart: ${why}`);
        if (isOnline(t)) personal(t, 'A briar heart takes root in your chest.');
        return personal(a, `${display(t)} is a Briarheart.`);
      }
      if (!end(t, `revoked by ${who(a)}: ${why}`)) return personal(a, `${display(t)} is no Briarheart.`);
      if (isOnline(t)) personal(t, 'The briar withers in your chest. Your heart is your own again.');
      return personal(a, `${display(t)} is a Briarheart no more.`);
    }
    if (sub === 'list') {
      const on = onlineActors().filter((x) => isBriar(x));
      return personal(a, on.length ? `Briarhearts online: ${on.map((x) => display(x)).join(', ')}` : 'No Briarheart is online.');
    }
    if (sub === 'altar') {
      const what = (words.shift() || 'list').toLowerCase();
      const d = data();
      if (what === 'add') {
        const here = posOf(a); if (!here || !here.pos) return personal(a, 'Your position cannot be read.');
        const radius = Math.max(100, Math.min(2000, Number(words[0]) || C.altarRadius));
        d.altars.push({ world: here.world, pos: here.pos.map((v) => Math.round(v)), radius, by: who(a), at: Date.now() }); save();
        audit(`BRIARHEART ${who(a)} placed Hagraven altar ${d.altars.length} at ${here.world} ${here.pos.map(Math.round).join(',')} (${radius})`);
        return personal(a, `Hagraven altar ${d.altars.length} added here (radius ${radius}).`);
      }
      if (what === 'remove') {
        const n = Number(words[0]); if (!(n >= 1 && n <= d.altars.length)) return personal(a, 'Usage: /briarheart altar remove <n> (see /briarheart altar list)');
        const [x] = d.altars.splice(n - 1, 1); save();
        audit(`BRIARHEART ${who(a)} removed Hagraven altar ${n} (${x.world} ${x.pos.join(',')})`);
        return personal(a, `Hagraven altar ${n} removed.`);
      }
      return personal(a, d.altars.length ? d.altars.map((x, i) => `${i + 1}. ${x.world} ${x.pos.join(',')} r${x.radius}`).join(' | ') : 'No Hagraven altar is placed: stand at one and say /briarheart altar add.');
    }
    return personal(a, 'Usage: /briarheart [status] | rite | confirm | cure; staff: grant|revoke <name> <reason> | list | altar add [radius] | altar list | altar remove <n>');
  }, { help: 'Briarhearts: [status] | rite (at a Hagraven altar) | confirm | cure (at Arkay or Stendarr); staff: grant | revoke | list | altar' });

  log(`briarheart: ${C.enabled ? 'on' : 'off'}, ${data().altars.length} altar(s), races ${(C.races || []).join('/')}, faiths ${(C.faiths || []).join('/')}`);
  // For the harness
  return { riteRefusal, rite, confirm, cure, tearRefusal, startTear, tick, end, become, isBriar, C, data };
};
