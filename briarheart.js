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
// The look (A5; Nat, 25 Oct: "vanilla wound, bare chest only"): config visual { enabled, armor, emptyArmor, women }.
//   A Briarheart's chest is always bare (Nat, 25 Oct: "Briarhearts can't use chest armour"): anything of theirs worn in the
//   BODY slot (32), cuirass or robe, is unequipped at once (UnequipItem; it stays in the pack) with "The briar in your
//   chest will not be covered.", at every equipment report and so at the grant and at login. The server gives and equips
//   the vanilla ArmorBriarHeart (Skyrim 05D008, the open chest with the briar) on that bare chest (gamemode.js equipHook
//   asks __dboBriarheartEquip). In a beast form the look is left alone: the race swap dresses the beast. Gauntlets,
//   boots, helmets, shields and the forearm and calf slots stay theirs. The moment the heart is torn out it becomes
//   ArmorBriarHeartEmpty (05D009), mostly for the corpse. Both are Non-Playable (record flag 0x4): itemguards.js refuses
//   their drop, put and take. Their ARMAs (05D00C, 05D00D) carry a MALE model only (MOD2 Armor\BriarHeart\BriarHeart_1.nif,
//   no MOD3), worn by DefaultRace (the Reachman race's armor race): a woman gets no briar body unless visual.women is set
//   (what the engine shows a woman then is to be seen in game). Every give, equip, removal and swap is logged
//   ("briarheart: look ..."). Equips are tried at most once per visual.retrySeconds and visual.maxTries times in a row.
//   Spamming a chest piece (Nat's dev test, 26 Oct) cannot wear it or strip the look: every report takes the piece off,
//   but the briar body goes back on only once no refusal has come for visual.settleMs, and a look the throttle holds
//   back is looked at again when it allows, report or not ("briarheart: look on ... (settled)").
//   Slots, read at the live load order (25 Oct): Skyrim.esm puts both in the body slot (32), but USSEP, which wins, moves
//   them and their ARMAs to slot 35 (mask 0x20, the amulet slot), so in game the briar chest draws over whatever is worn.
//   Bare chest only is Nat's rule, not the engine's. An amulet shares slot 35, and the briar chest wins (Nat, 25 Oct: "the
//   heart is their charm"): on a bare chest anything worn in the briar body's slots is unequipped (UnequipItem, the item
//   stays in the pack, never moved or deleted) and the player told, at most once per AMULET_TELL_MS.
// Briar skin (Nat, 25 Oct; config briarSkin { enabled, armor, armorFrom, staminaRegen, diseaseResist }), while the briar
//   chest shows (the briar body worn):
//   - armour: a faction cuirass's (Nat, 25 Oct: "the same armour as faction armour"): armor, the light faction cuirass's
//     rating (38, faction-gear.json's light tier), or failing that the counted rating of the cuirass armorFrom names,
//     through the hit's own armour path: gamemode.js takes it under the target's light multipliers (Defense tier, Fortify
//     Light Armor), less the briar pieces' own ratings the engine already counted, and scales the hit by
//     fArmorScalingFactor capped at fMaxArmorRating, as the Flesh spells do. Weapon and fist hits only (spell damage reads
//     no armour).
//   - staminaRegen: racial.js regenFactor multiplies stamina regeneration by it (__dboBriarRegenMult).
//   - diseaseResist: the server runs no mundane disease (its only diseases are the vampire and werewolf fevers, which a
//     Briarheart already refuses, supernatural.js). The value goes to the DiseaseResist actor value through the server's
//     Papyrus SetActorValue, which runs on the player's own client only (the server logs "executes locally ... will not
//     affect server calculations"): it sets the vanilla disease chance in that client's engine and nothing the server
//     counts. Sent at each skin on (a login turns it on afresh), back to 0 at skin off.
//   Logged on and off ("briarheart: skin on|off ...").
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
    visual: { enabled: false, armor: '5d008:Skyrim.esm', emptyArmor: '5d009:Skyrim.esm', body: '90d63:unofficial skyrim special edition patch.esp', women: false, retrySeconds: 10, maxTries: 5, settleMs: 1500 },
    // A full Hagraven (hagraven.js, stage 3) at the altar performs the rite and is named in the audit; true: the rite
    // waits for one
    hagravenRequired: false,
    briarSkin: { enabled: false, armor: 38, armorFrom: '', staminaRegen: 1.25, diseaseResist: 50 },
    // What a Briarheart is, in Magic > Active Effects (Nat, 25 Oct): a display ability (a DLE SPEL, type Ability, whose
    // one effect carries the text and changes nothing; prayer.js's blessing displays are the same records), learned with
    // the gifts and taken with them. A desc; empty until the record is in the load order
    display: '',
  }, (cfg && cfg.briarheart) || {});
  const PROP = 'private.dboBriarheart', FAILED = 'private.dboBriarheartFailedAt';
  const FILE = path.resolve('briarheart.json');
  const AV_POISON = 40, AV_FIRE = 41, AV_FROST = 43;   // MGEF DATA resist value (libespm ActorValue.h), as gamemode.js reads it
  const MIN = 60000, HOUR = 3600000;

  // ---- state, kept across hot reloads ----------------------------------------------------------------------------------
  const S = globalThis.__dboBriarheart || (globalThis.__dboBriarheart = { data: null, pending: new Map(), tears: new Map() });
  if (!(S.pending instanceof Map)) S.pending = new Map();
  if (!(S.tears instanceof Map)) S.tears = new Map();
  if (!(S.looks instanceof Map)) S.looks = new Map();   // actor -> { at, tries, womanTold }: the bare-chest equip's throttle
  if (!(S.skin instanceof Set)) S.skin = new Set();     // actors whose briar skin is on
  if (!(S.amuletTold instanceof Map)) S.amuletTold = new Map();   // actor -> when the amulet refusal was last told
  if (!(S.coverTold instanceof Map)) S.coverTold = new Map();     // actor -> when the covered-chest refusal was last told
  if (!(S.covered instanceof Map)) S.covered = new Map();     // actor -> when a chest piece or amulet was last refused
  if (!(S.settle instanceof Map)) S.settle = new Map();       // actor -> the pending settled look (a timer)
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
  // A base record (spell, faction, armour) goes to the server's Papyrus as 'espm': a 'form' argument is looked up among
  // world forms only, and every base record there failed with "Form with id ... doesn't exist" (dev, 25 Oct)
  const form = (desc) => ({ type: 'espm', desc: String(desc) });
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

  // ---- the look: the briar body on a bare chest -------------------------------------------------------------------------
  const V = () => Object.assign({ enabled: false, armor: '', emptyArmor: '', body: '', women: false, retrySeconds: 10, maxTries: 5, settleMs: 1500 }, C.visual || {});
  // The wound itself (dev, 25 Oct): ArmorBriarHeart is only the heart and its briars (slot 35). The open chest is USSEP's
  // USKPArmorBriarHeartBody (90D63, slot 32; its ARMA covers body, forearms and calves with the wound texture
  // SkinBodyMaleBriarHeart), worn by every vanilla Briarheart through the SkinBriarHeart outfit. Both go on a bare chest.
  // The ARMO's slot mask is the body alone (0x4), so it takes no slot from bracers (34) or greaves (38): they stay worn
  const mineOf = (v) => new Set([idOf(v.armor), idOf(v.emptyArmor), idOf(v.body)].filter(Boolean));
  const isFemale = (a) => { try { const app = mp.get(a >>> 0, 'appearance'); return !!(app && app.isFemale === true); } catch (e) { return false; } };
  // An ARMO's biped slots (BOD2's first u32, or BODT's; 0x4 = slot 32, the body), read once per base
  const BODY = 0x4;
  const LOGIN_SETTLE_MS = 15000;   // gamemode.js WORN_GRACE_MS: the login re-dress happens inside it
  const AMULET_TELL_MS = 60000;    // the refusal message and its log line, at most once a minute per character
  const maskCache = new Map();
  const maskOf = (id) => {
    id = Number(id) >>> 0; if (maskCache.has(id)) return maskCache.get(id);
    let mask = 0;
    try {
      const r = mp.lookupEspmRecordById(id); const rec = r && r.record;
      if (rec && String(rec.type) === 'ARMO') {
        const f = (rec.fields || []).find((x) => x && (x.type === 'BOD2' || x.type === 'BODT') && x.data && x.data.byteLength >= 4);
        if (f) mask = new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(0, true);
      }
    } catch (e) { mask = 0; }
    maskCache.set(id, mask); return mask;
  };
  const coversBody = (id) => (maskOf(id) & BODY) !== 0;
  const wornIds = (equipment) => {
    const entries = equipment && equipment.inv && Array.isArray(equipment.inv.entries) ? equipment.inv.entries : [];
    return entries.filter((e) => e && (e.worn || e.wornLeft)).map((e) => Number(e.baseId) >>> 0);
  };
  // One pending look per character, re-armed by each call; it runs the newest module's look (a hot reload keeps it)
  const settleLater = (a, ms) => {
    const old = S.settle.get(a); if (old) clearTimeout(old);
    const t = setTimeout(() => { S.settle.delete(a); const f = globalThis.__dboBriarheartSettled; if (typeof f === 'function') f(a); }, Math.max(50, ms));
    if (t && typeof t.unref === 'function') t.unref();
    S.settle.set(a, t);
  };
  const lookOn = (a) => { const v = V(); return !!(C.enabled && v.enabled && v.armor && isBriar(a) && (v.women || !isFemale(a))); };
  const takeAll = (a, id) => { let n = 0; while (id && takeOne(a, id) && n < 50) n++; return n; };
  // Every equipment report (and the rite and login): bare chest -> the briar body on; own body armour -> the briar body out
  // of the pack. Not a Briarheart (cured, revoked, never): no briar body or empty chest left anywhere but on a dead one
  const lookApply = (a, equipment, why) => {
    a = Number(a) >>> 0;
    const v = V(); const full = idOf(v.armor), empty = idOf(v.emptyArmor), body = idOf(v.body), mine = mineOf(v);
    if (!C.enabled || !v.enabled || !full) return;
    const eq = equipment || get(a, 'equipment', null);
    const worn = wornIds(eq);
    if (!isBriar(a)) {
      // The heart goes at once, and the wound body with it unless an empty chest is held (a torn-out heart: the body keeps
      // its wound; held, not worn, because the swap's equipment report can lag the end). At login everything briar goes:
      // the character is alive again
      const n = takeAll(a, full) + ((why === 'login' || !hasOne(a, empty)) ? takeAll(a, body) : 0)
        + (why === 'login' ? takeAll(a, empty) : 0);
      if (n) log(`briarheart: look cleared on ${display(a)} (${why}): ${n} briar piece${n === 1 ? '' : 's'} taken, not a Briarheart`);
      return;
    }
    if (!lookOn(a)) {
      const L = S.looks.get(a) || {};
      if (isFemale(a) && !L.womanTold) { L.womanTold = true; S.looks.set(a, L); log(`briarheart: look skipped on ${display(a)}: the vanilla briar body has no female model (visual.women false)`); }
      return;
    }
    // A beast form's race swap dresses the beast; the look waits for the revert's re-dress
    const beast = get(a, 'private.beast', null); if (beast && beast.form) return;
    // The chest is never covered: their own body-slot piece (cuirass or robe) comes off and stays in the pack, told at most
    // once a minute however often it is put back on
    const own = worn.filter((id) => !mine.has(id) && coversBody(id));
    if (own.length) {
      for (const id of own) papyrus(a, 'UnequipItem', [form(mp.getDescFromId(id)), false, true]);
      const told = Number(S.coverTold.get(a)) || 0;
      if (Date.now() - told >= AMULET_TELL_MS) {
        S.coverTold.set(a, Date.now());
        if (isOnline(a)) personal(a, 'The briar in your chest will not be covered.');
        log(`briarheart: chest cover refused on ${display(a)} (${why}): ${own.map((id) => id.toString(16)).join(', ')} unequipped, kept in the pack`);
      }
    }
    // The briar chest wins its slot (35 at the live order). Anything else worn there (an amulet) comes off and stays in the
    // pack; the player is told (and it is logged) at most once a minute, however often they put it back on
    const fullMask = maskOf(full);
    const clash = fullMask ? worn.filter((id) => !mine.has(id) && !own.includes(id) && (maskOf(id) & fullMask)) : [];
    if (clash.length) {
      for (const id of clash) papyrus(a, 'UnequipItem', [form(mp.getDescFromId(id)), false, true]);
      const told = Number(S.amuletTold.get(a)) || 0;
      if (Date.now() - told >= AMULET_TELL_MS) {
        S.amuletTold.set(a, Date.now());
        if (isOnline(a)) personal(a, 'Your briar heart leaves no room for an amulet. It stays in your pack.');
        log(`briarheart: amulet refused on ${display(a)} (${why}): ${clash.map((id) => id.toString(16)).join(', ')} unequipped, kept in the pack (bare chest, the briar chest wins its slot)`);
      }
    }
    // A refusal means the player swapped something in: a briar body missing now is their doing, not an equip that failed
    if (own.length || clash.length) { S.covered.set(a, Date.now()); S.looks.delete(a); }
    if (worn.includes(full) && (!body || worn.includes(body))) { S.looks.delete(a); return; }
    // The login's first reports are naked until gamemode.js redresses the character: no briar body then (the login hook
    // looks again once that has settled)
    const conn = globalThis.__dboConnectedAt instanceof Map ? Number(globalThis.__dboConnectedAt.get(a)) || 0 : 0;
    if (conn && Date.now() - conn < LOGIN_SETTLE_MS) return;
    // While refusals keep coming (equip spam) nothing goes on: the client's equips and ours would cross. The briar body
    // goes on once the last refusal is settleMs old
    const quietFor = Date.now() - (Number(S.covered.get(a)) || 0), settleMs = Math.max(0, Number(v.settleMs) || 0);
    if (quietFor < settleMs) { settleLater(a, settleMs - quietFor); return; }
    // Bare chest: give it if missing and put it on, at most once per retrySeconds and maxTries in a row; held back by
    // retrySeconds, it is looked at again then, so the look recovers without another equipment report
    const L = S.looks.get(a) || { at: 0, tries: 0 };
    const wait = v.retrySeconds * 1000 - (Date.now() - L.at);
    if (wait > 0) { if (!L.gaveUp) settleLater(a, wait); return; }
    if (L.tries >= v.maxTries) { if (!L.gaveUp) { L.gaveUp = true; S.looks.set(a, L); log(`briarheart: look gave up on ${display(a)}: ${L.tries} equips of the briar body did not show in the equipment`); } return; }
    L.at = Date.now(); L.tries += 1; S.looks.set(a, L);
    // The wound body first (slot 32), then the heart over it (slot 35); each result is logged as it came back
    const results = [];
    for (const [id, desc] of [[body, v.body], [full, v.armor]]) {
      if (!id || worn.includes(id)) continue;
      if (!hasOne(a, id) && giveItem) giveItem(a, id, 1);
      results.push([desc, papyrus(a, 'EquipItem', [form(desc), false, true])]);
    }
    const bad = results.filter(([, ok]) => !ok).map(([d]) => d);
    settleLater(a, v.retrySeconds * 1000);   // checked again if no report shows it (after the last try: given up)
    log(!bad.length ? `briarheart: look on ${display(a)} (${why}): bare chest, ${results.map(([d]) => d).join(' + ')} equipped (try ${L.tries})`
      : `briarheart: look FAILED on ${display(a)} (${why}): EquipItem of ${bad.join(', ')} refused by the server (try ${L.tries}; see the line above)`);
  };
  // ---- the briar skin: armour, stamina and DiseaseResist while the briar chest shows ---------------------------------------
  const K = () => Object.assign({ enabled: false, armor: 0, armorFrom: '', staminaRegen: 1, diseaseResist: 0 }, C.briarSkin || {});
  const skinRating = (k) => Math.max(0, Number(k.armor) || 0);
  const skinShown = (worn) => { const v = V(), full = idOf(v.armor), mine = mineOf(v); return !!(full && worn.includes(full) && !worn.some((id) => !mine.has(id) && coversBody(id))); };
  const skinCheck = (a, equipment, why) => {
    a = Number(a) >>> 0;
    const k = K();
    const on = !!(C.enabled && k.enabled && isBriar(a) && lookOn(a) && skinShown(wornIds(equipment || get(a, 'equipment', null))));
    if (on === S.skin.has(a)) return;
    if (on) S.skin.add(a); else S.skin.delete(a);
    const dr = Math.max(0, Number(k.diseaseResist) || 0);
    if (dr > 0 && isOnline(a)) papyrus(a, 'SetActorValue', ['DiseaseResist', on ? dr : 0]);
    if (!on) { log(`briarheart: skin off ${display(a)} (${why})${dr > 0 ? ', DiseaseResist 0' : ''}`); return; }
    const extra = Number(call('__dboBriarSkinRating', a)) || 0;
    log(`briarheart: skin on ${display(a)} (${why}): armour as ${skinRating(k) ? `a faction cuirass (${skinRating(k)})` : k.armorFrom} (+${extra.toFixed(1)} over the briar pieces), stamina regeneration x${Math.max(1, Number(k.staminaRegen) || 1)}, DiseaseResist ${dr}`);
  };
  const lookCheck = (a, equipment, why) => { lookApply(a, equipment, why); skinCheck(a, equipment, why); };
  // The heart torn out: the open chest becomes the empty one
  const lookEmpty = (a) => {
    a = Number(a) >>> 0; const v = V(); const full = idOf(v.armor), empty = idOf(v.emptyArmor);
    if (!C.enabled || !v.enabled || !full || !empty) return;
    const hadOn = wornIds(get(a, 'equipment', null)).includes(full);
    takeAll(a, full);
    if (!hadOn) return;   // under their own armour nothing shows; nothing to swap
    if (!hasOne(a, empty) && giveItem) giveItem(a, empty, 1);
    const ok = papyrus(a, 'EquipItem', [form(v.emptyArmor), false, true]);
    // The wound body stays on: the empty chest sits in the same open wound
    log(ok ? `briarheart: look swap on ${display(a)}: heart torn out, ${v.armor} -> ${v.emptyArmor}${v.body ? `, the wound body ${v.body} kept` : ''}`
      : `briarheart: look swap FAILED on ${display(a)}: EquipItem of ${v.emptyArmor} refused by the server`);
  };

  // ---- the gifts on and off ---------------------------------------------------------------------------------------------
  // Spells, the faction and the look follow the record: applied at the rite and at each login, taken at the end
  const applyGifts = (a, why) => {
    if (!isOnline(a)) return;
    for (const d of C.spells || []) papyrus(a, 'AddSpell', [form(d), false]);
    if (C.display && idOf(C.display)) papyrus(a, 'AddSpell', [form(C.display), false]);
    if (C.forswornFriendly) faction(a, true, why || 'gifts');
    S.looks.delete(a >>> 0); lookCheck(a, null, why || 'gifts');
    call('__dboCharLevelSyncBonus', a >>> 0);
  };
  const removeGifts = (a, why) => {
    if (isOnline(a)) {
      for (const d of C.spells || []) papyrus(a, 'RemoveSpell', [form(d)]);
      if (C.display && idOf(C.display)) papyrus(a, 'RemoveSpell', [form(C.display)]);
      if (C.forswornFriendly) faction(a, false, why || 'end');
    }
    // The briar body goes (a torn-out heart has already left the empty chest on the body)
    S.looks.delete(a >>> 0); lookCheck(a, null, why || 'end');
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
    if (call('__dboHagravenStage', a >>> 0) > 0) return 'You have made the Hagravens\' pact yourself. The briar is for others.';
    if (!altarNear(a)) return 'The rite is made at a Hagraven altar in the Reach.';
    // A Hagraven (hagraven.js) at the altar presses the briar in; with hagravenRequired the rite waits for one
    if (C.hagravenRequired && !call('__dboHagravenRiteAt', altarNear(a), a >>> 0)) return 'No Hagraven tends this altar. The rite waits for one.';
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
    const hag = call('__dboHagravenRiteAt', altarNear(a), a >>> 0) || 0;
    become(a, 'rite', hag ? who(hag) : '');
    audit(`BRIARHEART ${who(a)} took the briar heart at a Hagraven altar${hag ? `, from the Hagraven ${who(hag)}` : ''}`);
    if (hag && isOnline(hag)) personal(hag >>> 0, `You press the briar into ${display(a)}'s chest. It takes root.`);
    return `${hag ? `${display(hag)} presses` : 'The Hagraven presses'} the briar into your chest. It takes root, as it did in Faolan, the Red Eagle, the first of you. Like Lorkh, you have given your heart. You feel the Reach in your blood, and nothing of the Divines.`;
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
    lookEmpty(t);
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
  // hagraven.js: the pact is made at the same altars (the altar the character stands at, or null)
  globalThis.__dboBriarheartAltarNear = (a) => altarNear(Number(a) >>> 0);
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
  globalThis.__dboBriarheartLogin = (a) => {
    if (!C.enabled) return;
    a = Number(a) >>> 0;
    S.skin.delete(a);   // a new client: the skin turns on afresh, DiseaseResist with it
    if (isBriar(a)) applyGifts(a, 'login'); else lookCheck(a, null, 'login');
    // Once the login re-dress has settled, a bare chest gets the briar body even if no new equipment report comes
    if (isBriar(a)) setTimeout(() => { try { if (isOnline(a)) lookCheck(a, null, 'login settled'); } catch (e) { log('briarheart: settled look failed', e.message); } }, LOGIN_SETTLE_MS + 5000);
  };
  // gamemode.js fleshDamageMult: the light cuirass the briar skin counts as, and the briar body it stands over
  globalThis.__dboBriarSkinArmor = (a) => {
    a = Number(a) >>> 0; const k = K();
    if (!C.enabled || !k.enabled || !S.skin.has(a) || !isBriar(a)) return null;
    const rating = skinRating(k), from = rating ? 0 : idOf(k.armorFrom);
    return rating || from ? Object.assign(rating ? { rating } : { from }, { shown: idOf(V().armor), body: idOf(V().body) }) : null;
  };
  // racial.js regenFactor: stamina regeneration while the briar skin is on
  globalThis.__dboBriarRegenMult = (a, stat) => {
    a = Number(a) >>> 0; const k = K();
    return stat === 'stamina' && C.enabled && k.enabled && S.skin.has(a) && isBriar(a) ? Math.max(1, Number(k.staminaRegen) || 1) : 1;
  };
  // gamemode.js equipHook: every equipment report
  globalThis.__dboBriarheartEquip = (a, equipment) => { if (C.enabled) lookCheck(a, equipment, 'equipment'); };
  // settleLater: the look once equip spam has settled or the retry throttle allows, from the equipment as it is then
  globalThis.__dboBriarheartSettled = (a) => {
    a = Number(a) >>> 0;
    try { if (C.enabled && isOnline(a)) lookCheck(a, null, 'settled'); } catch (e) { log('briarheart: settled look failed', e.message); }
  };
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
      return personal(a, r ? `A briar heart has beaten in your chest since ${new Date(r.since).toISOString().slice(0, 10)}, as one did in Faolan, the Red Eagle, the first of you.${C.tearPermadeath ? ' If it is torn out of you while you are down, this character dies for good.' : ''}` : 'Your heart is your own.');
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
