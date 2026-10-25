// DragonBreak Online: werewolf beast form and the Vampire Lord, driven by the server. Loaded by gamemode.js on every hot reload.
//
// The vanilla transforms are Papyrus scripts on the change spells' magic effects, and the client drops those script
// events, so casting Beast Form or Vampire Lord changes nothing by itself. Here the cast is caught (mp.onSpellCast via
// gamemode castHook): the real appearance is kept in private.beast, appearance.raceId becomes the beast race (other
// clients rebuild the actor from it), the player's own client swaps race on a dboBeast packet, gear comes off.
// Reverting restores the kept appearance and re-dresses. Death, logout and login always revert, so a beast race is
// never saved as the character's own. Who may transform: whoever holds the power (admin panel or /beastform grant); a cursed
// werewolf only when the beast takes them (supernatural.js voluntaryWerewolf), and none reverts by choice before
// beastform.werewolf.minSeconds.
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, registerChatCommand, sendPacket, display, who, audit, findByName, every, redress, cfg, isAdmin } = api;
  // Whose UI said it can (gamemode.js dbo:uiCaps); without it nobody is sent a beast body
  const hasUiCap = typeof api.hasUiCap === 'function' ? api.hasUiCap : () => false;
  // Config "beastform": vampireLordRemoteRace and werewolfRemoteRace switch each form's body for everyone (/vlremote,
  // /wwremote). On, the body goes only to clients that build it themselves ('beastBody', client 0.3.77; see the beast
  // bodies below): every relayed cast or stop of a beast wrote a humanoid animation-variable snapshot into the watcher's
  // beast-race copy (crashes 28-30 Sep). Off, or on an older client, watchers see a human playing the beast's animations.
  // An admin's off must survive a hot reload; a value merely seeded from config must not, or an old seed outlives the
  // config that set it.
  const CFG = Object.assign({ vampireLordRemoteRace: true, werewolfRemoteRace: true, breakerUnits: 6000, breakerSeconds: 120,
    breakerDrops: 2, breakerWindowSeconds: 600, breakerHoldMinutes: 10, vampireLordBreakerHoldMinutes: 0, breakerReconnectSeconds: 0 },
    (cfg && cfg.beastform) || {});
  // It must survive a restart too (2026-09-29: the 17:15 restart read the config again and undid an off). /vlremote and
  // /wwremote write beastform-state.json beside the gamemode; a fresh process reads it before the config.
  const STATE_PATH = path.resolve('beastform-state.json');
  const readState = () => { try { const v = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } };
  // One file holds both switches: each write keeps the other's keys
  const writeState = (patch) => {
    try { fs.writeFileSync(STATE_PATH + '.tmp', JSON.stringify(Object.assign({}, readState() || {}, patch), null, 1)); fs.renameSync(STATE_PATH + '.tmp', STATE_PATH); } catch (e) { log(`beastform-state.json write failed: ${e.message}`); }
  };
  const saveRemote = (on, by) => writeState({ vampireLordRemote: on === true, setBy: by, at: new Date().toISOString() });
  const saveWerewolfRemote = (on, by) => writeState({ werewolfRemote: on === true, werewolfSetBy: by, werewolfAt: new Date().toISOString() });
  if (globalThis.__dboVlRemoteSetBy === undefined) {
    const saved = readState();
    // The old blanket breaker (before 5 Oct) saved its trips here too; a trip is now per Lord, so only an admin's choice holds
    if (saved && typeof saved.vampireLordRemote === 'boolean' && saved.setBy !== 'breaker') {
      globalThis.__dboVampireLordRemote = saved.vampireLordRemote;
      globalThis.__dboVlRemoteSetBy = String(saved.setBy || 'file');
    } else globalThis.__dboVampireLordRemote = CFG.vampireLordRemoteRace === true;
  }
  if (globalThis.__dboWwRemoteSetBy === undefined) {
    const saved = readState();
    if (saved && typeof saved.werewolfRemote === 'boolean') {
      globalThis.__dboWerewolfRemote = saved.werewolfRemote;
      globalThis.__dboWwRemoteSetBy = String(saved.werewolfSetBy || 'file');
    } else globalThis.__dboWerewolfRemote = CFG.werewolfRemoteRace !== false;
  }
  // The name a viewer knows another player by: introduced, else Stranger, else Masked Person (playermenu.js).
  // Only players are named here, so there is no nameOf fallback to leak a real name if playermenu is missing.
  const nameTo = (viewer, x) => {
    try {
      if (typeof globalThis.__dboNameFor === 'function') return globalThis.__dboNameFor(Number(viewer) >>> 0, Number(x) >>> 0);
    } catch (e) { /* playermenu not loaded */ }
    return 'Someone';
  };

  // Config beastform.werewolf (Nate, 23 Oct: Jarl Uhtred changed in a crowd and was himself again 6 s later). seconds: the
  // change's length when greathunt.js is not loaded (its rank table greatHunt.beastSeconds rules otherwise; was 150).
  // minSeconds: no revert by choice (the Revert Form power, /beast) this long into a werewolf's change, never past its
  // end; a death, a logout, a login, a staff revert and the time running out still end it at once. 0 = no hold.
  const WW = Object.assign({ seconds: 300, minSeconds: 240 }, CFG.werewolf || {});
  const idOf = (desc) => { try { return mp.getIdFromDesc(desc) >>> 0; } catch (e) { log(`beastform: ${desc} not in the load order`); return 0; } };
  // Form ids verified against the load order (ck-mcp lookup, 2026-09-22)
  const FORMS = {
    werewolf: { name: 'Beast Form', race: idOf('cdd84:Skyrim.esm'), power: idOf('92c48:Skyrim.esm'), seconds: Math.max(0, Number(WW.seconds) || 0) || 150 },
    vampirelord: { name: 'Vampire Lord', race: idOf('283a:Dawnguard.esm'), power: idOf('283b:Dawnguard.esm'), seconds: 0 },
  };
  const REVERT_POWER = idOf('cd5c:Dawnguard.esm');
  // Staff polymorph (Jake, 22 Oct: "a way how I can polymorph into animals"): a Lead GM or above turns themselves, and only
  // themselves, into one of these animals with /polymorph (below). A table of its own, never merged into FORMS, so no creature
  // key reaches the beast powers: /beastform grant|remove, the admin panel's grant and revoke, holdsPower, byPower and the daily
  // limit all look in FORMS alone. Each race is its Skyrim.esm RACE record, read from /opt/skyrim-data/Skyrim.esm (22 Oct):
  // ChickenRace a919d, HareRace 6dc99, GoatDomesticsRace 6fc4a, FoxRace 109c7c, DogRace 131ee, SkeeverRace 13201, MudcrabRace
  // ba545, DeerRace cf89b, and ten more from 25 Oct listed below. None is timed. Entries are never taken out while
  // someone may be in one.
  // GIANT is deliberately NOT here (Nat asked for it): creature scale is not in the RACE record at all, so the clipping
  // and doorway risk cannot be ranked from the data and wants a dev test first. HORSE stays out because its copy can be
  // ridden. WOLF stays out too, but note its stated reason may be stale: it was excluded because today's clients make a
  // player wolf's copy hostile (formView ambushRaces), and formView.attacksEveryone now returns false on
  // model.appearance BEFORE the race test, so a player's copy in a polymorph body is already exempt. Left excluded
  // pending Nat's word rather than quietly re-enabled.
  const CREATURES = {
    chicken: { name: 'Chicken', race: idOf('a919d:Skyrim.esm') },
    hare: { name: 'Hare', race: idOf('6dc99:Skyrim.esm') },
    goat: { name: 'Goat', race: idOf('6fc4a:Skyrim.esm') },
    fox: { name: 'Fox', race: idOf('109c7c:Skyrim.esm') },
    dog: { name: 'Dog', race: idOf('131ee:Skyrim.esm') },
    skeever: { name: 'Skeever', race: idOf('13201:Skyrim.esm') },
    mudcrab: { name: 'Mudcrab', race: idOf('ba545:Skyrim.esm') },
    deer: { name: 'Deer', race: idOf('cf89b:Skyrim.esm') },
    // Added 25 Oct on Nat's ask for "draugr, giant etc". Each one was measured first
    // (_work/polymorph-more-forms-1025.md): a creature behaviour graph, already in the client's
    // NON_HUMANOID_RACES so no caster variables are relayed for it, and no castable race spell. Whether a
    // player can ATTACK in any of them is unknown and only answerable in game: the werewolf fights while
    // sharing NO attack event names with the humanoid set, so name overlap predicts nothing. Draugr and
    // Skeleton are the most promising (they share AttackStartH2HLeft/Right and bashStart) and are the first
    // to test. Until that test they are walk-around shapes, like the eight above.
    hagraven: { name: 'Hagraven', race: idOf('131fb:Skyrim.esm') },
    bear: { name: 'Bear', race: idOf('131e8:Skyrim.esm') },
    snowbear: { name: 'Snow Bear', race: idOf('131e9:Skyrim.esm') },
    sabrecat: { name: 'Sabre Cat', race: idOf('13200:Skyrim.esm') },
    snowsabrecat: { name: 'Snowy Sabre Cat', race: idOf('13202:Skyrim.esm') },
    troll: { name: 'Troll', race: idOf('13205:Skyrim.esm') },
    draugr: { name: 'Draugr', race: idOf('d53:Skyrim.esm') },
    skeleton: { name: 'Skeleton', race: idOf('b7998:Skyrim.esm') },
    spriggan: { name: 'Spriggan', race: idOf('13204:Skyrim.esm') },
    falmer: { name: 'Falmer', race: idOf('131f4:Skyrim.esm') },
  };
  const CREATURE_WORDS = { rabbit: 'hare' };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isCreature = (key) => own(CREATURES, String(key));
  // A form's name for any key, a creature's or one no longer in either table included: never throws
  const formName = (key) => (own(FORMS, String(key)) ? FORMS[key].name : isCreature(key) ? CREATURES[key].name : String(key || ''));
  // A creature shape is marked so at the change (private.beast.creature), or known by its key
  const isCreatureState = (s) => !!s && (s.creature === true || isCreature(s.form));
  // The Werewolf Behemoth (DLE DBO race 1d1f9e, a werewolf copy at 1.3x; Nat tested it on the PC's local server, 15 Oct) is the
  // form of an Elder of the Great Hunt only (Nate, 15 Oct); every other werewolf keeps the vanilla body. Config
  // beastform.behemoth { enabled, race, rank }: OFF until client 0.3.100 (its watcher guard for the bigger body) is out and a
  // live two-player test has passed. rank: the greathunt.js rank name that takes it ('Elder', the top rank).
  const BEHEMOTH = Object.assign({ enabled: false, race: '1d1f9e:DragonBreak Online Edits.esp', rank: 'Elder' }, CFG.behemoth || {});
  const behemothRace = () => {
    if (BEHEMOTH.enabled !== true) return 0;
    const id = idOf(String(BEHEMOTH.race || ''));
    let rec = null; try { rec = id ? mp.lookupEspmRecordById(id) : null; } catch (e) { rec = null; }
    return rec && rec.record && String(rec.record.type) === 'RACE' ? id : 0;
  };
  const isElder = (a) => {
    try { const r = typeof globalThis.__dboHuntRank === 'function' ? globalThis.__dboHuntRank(a) : null; return !!r && r.name === String(BEHEMOTH.rank || 'Elder'); } catch (e) { return false; }
  };
  // The race a change takes: the Behemoth for an Elder werewolf with the switch on, else the form's own
  const raceFor = (a, key) => {
    const f = FORMS[key];
    if (key !== 'werewolf') return f.race;
    const b = behemothRace();
    return b && isElder(a) ? b : f.race;
  };
  globalThis.__dboBeastRaceFor = raceFor;
  // What the Vampire Lord wears. Vanilla equips DLC1ClothesVampireLordArmor (DLC1PlayerVampireQuest's
  // DLC1VampireLordArmor property); Nat wanted him to look better, so he gets Harkon's royal robes. Harkon's cape
  // (15bc1) is left off: on the player it rendered very shiny and hung without physics. Taken back on the revert.
  const WEAR = {
    vampirelord: [idOf('11a85:Dawnguard.esm'), idOf('15bc1:Dawnguard.esm')].filter(Boolean).slice(0, 1),
    werewolf: [],
  };
  // Every spell a form uses, learned server-side for the length of the form: the server strips an unlearned spell from
  // the equipment the client reports and refuses its casts and hits, which is why no beast spell ever reached anyone.
  // right/left/voice are what the client equips and binds to keys 1-9 (beastFormService.ts); passive are abilities,
  // hidden are the spells those abilities cast (bat bites, talon poison, grip damage). Ids read out of the load order.
  const spell = (desc, name) => ({ id: idOf(desc), name });
  // A werewolf howl is a shout (SHOU + word of power) in vanilla; the voice slot will not cast the bare spell
  const howl = (spellDesc, shoutDesc, wordDesc, name) => ({ id: idOf(spellDesc), shout: idOf(shoutDesc), word: idOf(wordDesc), name });
  const ABILITIES = {
    vampirelord: {
      // Drain05Alt: 15 health/magicka/stamina absorbed + 50 damage a hit. 09Alt (vanilla's level 41+) dealt 175,
      // more than a whole player health bar here
      right: [spell('19324:Dawnguard.esm', 'Vampiric Drain')],
      left: [spell('13ecb:Dawnguard.esm', 'Raise Dead'), spell('8a6f:Dawnguard.esm', 'Corpse Curse'),
        spell('16909:Dawnguard.esm', 'Summon Gargoyle'), spell('38b7:Dawnguard.esm', "Vampire's Grip")],
      // Revert Form last, so the default power on the Shout key is never the one that ends the form
      voice: [spell('38b9:Dawnguard.esm', 'Bats'), spell('38ba:Dawnguard.esm', 'Mist Form'), spell('38bc:Dawnguard.esm', 'Supernatural Reflexes'),
        spell('38b8:Dawnguard.esm', 'Detect Life'), spell('cd5c:Dawnguard.esm', 'Revert Form')],
      passive: [spell('126b8:Dawnguard.esm', 'Night Cloak')],
      hidden: [spell('126b7:Dawnguard.esm', 'Night Cloak bite'), spell('59a1:Dawnguard.esm', 'Poison Talons'), spell('e7da:Dawnguard.esm', 'Grip damage')],
    },
    werewolf: {
      // Summon Wolves is left out: its wolves are placed by a Papyrus script that never runs here
      right: [], left: [],
      // HowlWerewolfFear (cf790, word cf78e, casts cf791) and HowlWerewolfDetectLife (ce218, word ce219, casts ce217).
      // Named as UESP names them (Skyrim:Lycanthropy): Howl of the Pack is the one that summons wolves (cf79d), left out
      // above, and the detect-life howl is the Totem of the Hunt's
      voice: [howl('cf791:Skyrim.esm', 'cf790:Skyrim.esm', 'cf78e:Skyrim.esm', 'Howl of Terror'),
        howl('ce217:Skyrim.esm', 'ce218:Skyrim.esm', 'ce219:Skyrim.esm', 'Totem of the Hunt (detect life)')],
      // What the body casts by itself: the power attack's knockback and the feeding victim's hold (both were refused)
      passive: [], hidden: [spell('f3f0a:Skyrim.esm', 'Knockback'), spell('106396:Skyrim.esm', 'Feeding hold')],
    },
  };
  const allSpells = (key) => { const x = ABILITIES[key]; return x ? [...x.right, ...x.left, ...x.voice, ...x.passive, ...x.hidden].filter((sp) => sp.id) : []; };
  const learn = (a, key, on) => { for (const sp of allSpells(key)) papyrus(a, on ? 'AddSpell' : 'RemoveSpell', on ? [spellArg(sp.id), false] : [spellArg(sp.id)]); };
  const packetAbilities = (key) => {
    const x = ABILITIES[key]; if (!x) return null;
    const ids = (list) => list.filter((sp) => sp.id).map((sp) => Object.assign({ id: sp.id, name: sp.name }, sp.shout ? { shout: sp.shout, word: sp.word } : {}));
    return { right: ids(x.right), left: ids(x.left), voice: ids(x.voice), passive: ids(x.passive) };
  };
  // Keys 1.. pick the left-hand spell, the keys after them the power on the voice key (Z by default)
  const legend = (key) => {
    const x = ABILITIES[key]; if (!x) return [];
    const lines = [];
    let n = 1;
    if (key === 'werewolf') lines.push('Attack with your claws (left and right click, hold for a power attack). Activate a fresh body to feed and stay in the form longer.');
    else lines.push('Sneak switches between flight (spells) and the ground (claws). In flight: right click drains, left click casts the chosen left-hand spell.');
    const l = x.left.filter((sp) => sp.id).map((sp) => `${n++} ${sp.name}`);
    if (l.length) lines.push(`Left hand: ${l.join(', ')}`);
    const v = x.voice.filter((sp) => sp.id).map((sp) => `${n++} ${sp.name}`);
    if (v.length) lines.push(`Power, used with your Shout key: ${v.join(', ')}`);
    lines.push('Type /forms to see this again.');
    return lines;
  };
  const setCount = (a, baseId, want) => {
    try {
      const inv = mp.get(a, 'inventory') || { entries: [] };
      const was = (inv.entries || []).reduce((n, e) => n + ((Number(e.baseId) >>> 0) === baseId ? Number(e.count) || 0 : 0), 0);
      const entries = (inv.entries || []).filter((e) => (Number(e.baseId) >>> 0) !== baseId);
      if (want > 0) entries.push({ baseId, count: want });
      mp.set(a, 'inventory', Object.assign({}, inv, { entries }));
      // the player log (playerlog.js): a beast form's own items, given and taken back
      if (want !== was) { try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('itemflow', a, 'beast_item', baseId, want - was); } catch (e) { /* the player log is optional */ } }
    } catch (e) { log(`beastform: inventory change failed on ${display(a)}: ${e.message}`); }
  };
  // While in a beast form a player goes by the beast's name, never their own (Nate, 5 Oct): the appearance name is what
  // chat, the X menu and other clients read, and the revert puts the kept appearance (and name) back. beastform.names
  const NAMES = Object.assign({ werewolf: 'Werewolf', vampirelord: 'Vampire Lord' }, CFG.names || {});
  // Any key a character may be in, a creature's or one gone from both tables (a rollback) included, gives a name
  globalThis.__dboBeastName = (a) => { const s = stateOf(Number(a) >>> 0); return s ? String((own(NAMES, String(s.form)) && NAMES[s.form]) || formName(s.form) || 'Beast') : ''; };
  const byPower = new Map(Object.entries(FORMS).filter(([, f]) => f.power && f.race).map(([k, f]) => [f.power, k]));

  const self = (a) => ({ type: 'form', desc: mp.getDescFromId(a) });
  const papyrus = (a, method, args) => { try { mp.callPapyrusFunction('method', 'Actor', method, self(a), args); return true; } catch (e) { log(`beastform: ${method} failed on ${display(a)}: ${e.message}`); return false; } };
  const spellArg = (id) => ({ type: 'espm', desc: mp.getDescFromId(id) });
  const stateOf = (a) => { try { const s = mp.get(a, 'private.beast'); return s && s.form && s.original ? s : null; } catch (e) { return null; } };
  // A beast cut short by the session ending keeps what was left of it (GroundedPasta #7DJT, 10 Oct: "crashed while in
  // wolf form and lost my whole beast form"; the crash took the day's one change). A login or logout revert of a timed
  // form writes private.beastCarry { form, seconds, at, day }, and the next change into that form the same in-game day
  // takes only those seconds and spends no daily change. It is bounded by itself, so no crash proof is needed: the day's
  // beast time never exceeds one change's length, however the session ended (a quit keeps the rest too).
  const CARRY_MIN_SECONDS = 10, CARRY_REAL_MS = 4 * 3600000;
  const gameDay = () => { try { const c = globalThis.__dboClock; const d = c && typeof c.gameDays === 'function' ? Number(c.gameDays()) : NaN; return Number.isFinite(d) ? Math.floor(d) : null; } catch (e) { return null; } };
  const carryOf = (a, key) => {
    let c = null; try { c = mp.get(a, 'private.beastCarry'); } catch (e) { return null; }
    if (!c || typeof c !== 'object') return null;
    const day = gameDay();
    const fresh = c.form === key && Number(c.seconds) >= CARRY_MIN_SECONDS &&
      (day !== null && Number.isFinite(Number(c.day)) ? Number(c.day) === day : Date.now() - Number(c.at) < CARRY_REAL_MS);
    if (!fresh) { if (c.form === key) { try { mp.set(a, 'private.beastCarry', null); } catch (e) { /* offline */ } } return null; }
    return c;
  };
  const keepCarry = (a, s, why) => {
    if ((why !== 'login' && why !== 'logout') || !s.until) return;
    const left = Math.ceil((Number(s.until) - Date.now()) / 1000);
    if (!(left >= CARRY_MIN_SECONDS)) return;
    try { mp.set(a, 'private.beastCarry', { form: s.form, seconds: left, at: Date.now(), day: gameDay() }); } catch (e) { return; }
    log(`beastform: ${display(a)} keeps ${left} s of ${FORMS[s.form] ? FORMS[s.form].name : s.form} for the next change today (${why})`);
  };

  // Returns '' when the change happened and a reason when it did not. Every exit says why: a transform that
  // fails in silence is indistinguishable from a cast that never reached the server.
  const tryTransform = (a, key, forced) => {
    const f = FORMS[key];
    if (!f) return `there is no form called '${key}'`;
    if (!f.race || !f.power) return `${key} is not in this load order (race ${f.race.toString(16)}, power ${f.power.toString(16)})`;
    const s = stateOf(a);
    if (s) return `already in ${formName(s.form)}; revert first`;
    try { if (mp.get(a, 'isDead')) return 'the dead do not change shape'; } catch (e) { return `no actor to change (${e.message})`; }
    // Read the look first: __dboBeastAllow spends one of the day's changes, and a transform that fails after it
    // for want of an appearance would spend it for nothing
    let original = null; try { original = mp.get(a, 'appearance'); } catch (e) { /* none */ }
    if (!original || !original.raceId) return 'this character has no appearance yet';
    // supernatural.js decides who may change: the daily limit, the Blood Crown
    // A carried rest (keepCarry) changes without spending the day's change, for the seconds it kept
    const carry = forced ? null : carryOf(a, key);
    const refusal = typeof globalThis.__dboBeastAllow === 'function' ? globalThis.__dboBeastAllow(a, key, !!forced, carry ? { carry: true } : undefined) : null;
    if (refusal) return refusal;
    // The Great Hunt (greathunt.js) lengthens a werewolf's change by rank
    const hunt = key === 'werewolf' && typeof globalThis.__dboHuntBeastSeconds === 'function' ? Number(globalThis.__dboHuntBeastSeconds(a)) : 0;
    const full = Number.isFinite(hunt) && hunt > 0 ? hunt : f.seconds;
    const seconds = carry && full ? Math.min(full, Math.ceil(Number(carry.seconds))) : full;
    if (carry) { try { mp.set(a, 'private.beastCarry', null); } catch (e) { /* written below anyway */ } log(`beastform: ${display(a)} takes back ${seconds} s kept from the last change`); }
    const race = raceFor(a, key);
    mp.set(a, 'private.beast', Object.assign({ form: key, original, at: Date.now(), until: seconds ? Date.now() + seconds * 1000 : 0 }, race !== f.race ? { race } : {}));
    // No server UnequipAll: it reached the client after the change and stripped the spells it had just equipped
    // (only the abPreventRemoval robes survived). The client unequips before it swaps race.
    const wear = WEAR[key] || [];
    for (const id of wear) setCount(a, id, 1);
    // The appearance keeps the mortal race for every client, named after the form: a client that can show the beast
    // body safely is sent it by dboBeastBody instead (sendBeastBodies), and an older one keeps this human fallback
    // (a stripped human playing the beast's animations, the naked skating of #bugs 1552425534028251227)
    mp.set(a, 'appearance', Object.assign({}, original, { name: String(NAMES[key] || f.name) }));
    learn(a, key, true);
    sendPacket(a, { customPacketType: 'dboBeast', race, beast: true, form: key, wear, abilities: packetAbilities(key) });
    if (race !== f.race) log(`beastform: ${display(a)} is an Elder and takes the Behemoth (${race.toString(16)})`);
    const hold = key === 'werewolf' ? revertLockLeft(a) : 0;
    personal(a, key === 'werewolf' ? `The beast takes you for ${seconds} seconds.${hold ? ` You cannot turn back for the first ${hold}.` : ''}` : 'You take the form of a Vampire Lord. Press 9, then your Shout key, to revert.');
    for (const line of legend(key)) personal(a, line);
    audit(`BEAST ${who(a)} took ${f.name}`);
    witness(a, key === 'werewolf' ? 'twist into a beast' : 'rise into a Vampire Lord', key, 'in');
    sendBeastBodies();
    try { if (globalThis.__dboBeastChanged) globalThis.__dboBeastChanged(a, key, true); } catch (e) { log('beast change hook failed', e.message); }
    return '';
  };
  const transform = (a, key, forced) => {
    const why = tryTransform(a, key, forced);
    if (!why) return true;
    personal(a, why.charAt(0).toUpperCase() + why.slice(1) + '.');
    log(`beastform: ${display(a)} could not take ${key}: ${why}`);
    return false;
  };
  // Anyone close enough sees the change
  const WITNESS_RADIUS = 3000;
  const witness = (a, what, form, phase) => {
    let here = null, pos = null;
    try { here = mp.get(a, 'worldOrCellDesc'); pos = mp.get(a, 'pos'); } catch (e) { log(`beastform: no place to witness ${what}: ${e.message}`); return; }
    let n = 0, near = 0; const seers = [];
    for (const o of api.onlineActors()) {
      if (o === a) continue;
      try {
        const p = mp.get(o, 'pos');
        if (mp.get(o, 'worldOrCellDesc') !== here || Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]) > WITNESS_RADIUS) continue;
        near++;
        personal(o, `You see ${nameTo(o, a)} ${what}.`);
        n++; seers.push(o);
      } catch (e) { log(`beastform: witness skipped ${o.toString(16)}: ${e.message}`); }
    }
    log(`beastform: ${display(a)} ${what}, ${n} of ${near} near saw it`);
    // exposure.js: enough witnesses make the beast known in the hold
    try { if (form && typeof globalThis.__dboBeastWitnessed === 'function') globalThis.__dboBeastWitnessed(a, form, seers, phase); } catch (e) { log('beastform: exposure hook failed', e.message); }
  };

  // Beast Form is a Greater Power (Skyrim.esm 92c48, SPIT type 2): the player's own game lets it be cast once a game day,
  // so a werewolf allowed more changes (Great Hunt ranks, a carried rest, a blessing) could change again only after a relog
  // (Purr #7DJT, 17 Oct). /beast is judged by the same daily limit, so a werewolf with changes left is told to use it.
  const tellChangeAgain = (a) => {
    let n = null;
    try { n = typeof globalThis.__dboBeastChangesLeft === 'function' ? globalThis.__dboBeastChangesLeft(a) : null; } catch (e) { n = null; }
    if (!(n > 0)) return;
    personal(a, `${n === Infinity ? 'The beast will come again whenever you call it.' : `The beast can take you ${n} more time${n === 1 ? '' : 's'} today.`} If your Beast Form power will not work yet, type /beast.`);
  };

  // Seconds before a werewolf may revert by choice (WW.minSeconds from the change, never past its end); 0 for every other form
  const revertLockLeft = (a, s = stateOf(a)) => {
    if (!s || s.form !== 'werewolf' || isCreatureState(s)) return 0;
    const min = Math.max(0, Number(WW.minSeconds) || 0);
    if (!min || !Number(s.at)) return 0;
    let end = Number(s.at) + min * 1000;
    if (Number(s.until) > 0) end = Math.min(end, Number(s.until));
    return Math.max(0, Math.ceil((end - Date.now()) / 1000));
  };
  globalThis.__dboBeastRevertLockLeft = (a) => revertLockLeft(Number(a) >>> 0);
  // A revert by choice (the Revert Form power, /beast) asked too early: true when refused, and the player is told how long is left
  const refuseEarlyRevert = (a) => {
    const left = revertLockLeft(a);
    if (!left) return false;
    const text = `The beast will not let you go yet. You can turn back in ${left} second${left === 1 ? '' : 's'}.`;
    sendPacket(a, { customPacketType: 'dboBanner', text, seconds: 3 });
    sendPacket(a, { customPacketType: 'dboStatus', kind: 'notice', seconds: 1, speedMult: 0, text });
    personal(a, isAdmin && isAdmin(a) ? `${text} Staff: /beastform me werewolf revert ends it now.` : text);
    log(`beastform: ${display(a)} asked to revert ${left} s too early: refused`);
    return true;
  };

  const revert = (a, why) => {
    // The form's spells may stay in the client's hands once more: take them back again after this revert
    if (globalThis.__dboBeastStaleTaken instanceof Map) globalThis.__dboBeastStaleTaken.delete(Number(a) >>> 0);
    const s = stateOf(a);
    if (!s) return false;
    keepCarry(a, s, why);
    try {
      mp.set(a, 'appearance', s.original);
      mp.set(a, 'private.beast', null);
    } catch (e) { log(`beastform: revert failed on ${display(a)}: ${e.message}`); return false; }
    sendPacket(a, { customPacketType: 'dboBeast', race: Number(s.original.raceId) >>> 0, beast: false, form: s.form, wear: [] });
    // A revert at a death or a down reaches the player's own game while it lies in bleed-out, and the race change does not
    // hold there: GroundedPasta (#7DJT, 10 Oct 21:24Z) woke at the temple still a wolf to himself, a mortal to everyone else.
    // Sent again once they are up (the beastForms tick)
    if (why === 'death') resendAfterDeath().set(a >>> 0, { race: Number(s.original.raceId) >>> 0, form: s.form, at: Date.now() });
    ST.ethereal.delete(a);
    for (const id of WEAR[s.form] || []) setCount(a, id, 0);
    learn(a, s.form, false);
    // Skipped if another form was taken in the meantime: a revert straight into werewolf dressed the wolf in armour
    setTimeout(() => { try { if (!stateOf(a)) redress(a); } catch (e) { log('beastform re-dress failed', e.message); } }, 1500);
    log(`${display(a)} left ${formName(s.form)} (${why})`);
    if (s.form === 'werewolf' && (why === 'asked to revert' || why === 'time up')) tellChangeAgain(a);
    // A staff polymorph ends in silence, whatever ended it (Jake, 22 Oct): no line to anyone near, only the staff audit
    if (isCreatureState(s)) polymorphEnded(a, s, why);
    else witness(a, s.form === 'werewolf' ? 'shed the beast and stand as a mortal again' : 'sink back into mortal form', s.form, 'out');
    sendBeastBodies();
    try { if (globalThis.__dboBeastChanged) globalThis.__dboBeastChanged(a, s.form, false); } catch (e) { log('beast change hook failed', e.message); }
    return true;
  };

  // gamemode castHook, deathHook, disconnect and onCharacterReady call these
  globalThis.__dboBeastCast = (casterId, spellId) => {
    const a = Number(casterId) >>> 0, id = Number(spellId) >>> 0;
    noteBeastCast(a, id);
    if (id === REVERT_POWER && stateOf(a)) { if (!refuseEarlyRevert(a)) revert(a, 'revert power'); return true; }
    const key = byPower.get(id);
    if (!key) return false;
    log(`beastform: ${display(a)} cast ${FORMS[key].name} (${id.toString(16)})`);
    const s = stateOf(a);
    if (s && s.form === key && key === 'vampirelord') { revert(a, 'cast again'); return true; }
    // The cast reaches here from the client (castHook, or the dboBeastRequest relay), so it is a request and not
    // proof of anything: check the power is held, exactly as /beast does. Without this any client could ask for a
    // form it was never granted.
    if (!holdsPower(a, key)) { personal(a, key === 'werewolf' ? 'The beast blood is not in you.' : 'Only a Vampire Lord can take that form.'); return true; }
    transform(a, key);
    return true;
  };
  // Powers run by the engine on the caster's client only, so nobody else ever felt them. The client reports the
  // Shout key with the equipped power (dboBeastPower) and the server gives the power its effect on other players.
  const TERROR_RADIUS = 1500, TERROR_SECONDS = 10;
  const DRAIN = idOf('19324:Dawnguard.esm');
  const DRAIN_HEAL = 15 / 450;   // Drain05Alt absorbs 15 health; a Vampire Lord has 450 (race 300 + Player 150)
  const ST = globalThis.__dboBeastPowers = globalThis.__dboBeastPowers || { cooldown: new Map(), ethereal: new Map() };
  const ethereal = (a, seconds) => { ST.ethereal.set(a, Date.now() + seconds * 1000); personal(a, `You cannot be touched for ${seconds} seconds.`); return true; };
  const terror = (a, spellId) => {
    let here = null, pos = null; try { here = mp.get(a, 'worldOrCellDesc'); pos = mp.get(a, 'pos'); } catch (e) { return false; }
    let n = 0, kin = 0;
    for (const t of api.onlineActors()) {
      if (t === a) continue;
      try {
        const p = mp.get(t, 'pos');
        if (mp.get(t, 'worldOrCellDesc') !== here || Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]) > TERROR_RADIUS || mp.get(t, 'isDead')) continue;
        // The beast does not frighten its own kind
        const ts = stateOf(t);
        if (ts && ts.form === 'werewolf') { kin++; continue; }
        // The hit chain decides who can be touched at all (god mode refuses)
        if (typeof mp.onHitDamageAttempt === 'function' && mp.onHitDamageAttempt(a, t, spellId, 0) === false) continue;
        const pc = mp.get(t, 'percentages');
        mp.set(t, 'percentages', { health: pc.health, magicka: pc.magicka, stamina: 0 });
        sendPacket(t, { customPacketType: 'dboStatus', kind: 'terror', seconds: TERROR_SECONDS, speedMult: -50, text: `A howl freezes your blood. You are terrified for ${TERROR_SECONDS} seconds.` });
        n++;
      } catch (e) { /* elsewhere */ }
    }
    const pack = kin ? ` ${kin} of your own kind ${kin === 1 ? 'stands' : 'stand'} unmoved.` : '';
    personal(a, (n ? `Your howl terrifies ${n} ${n === 1 ? 'soul' : 'souls'}.` : 'Your howl echoes, but no one is near enough to fear it.') + pack);
    log(`beastform: ${display(a)} Howl of Terror, ${n} terrified, ${kin} werewolf kin spared`);
    return true;
  };
  const POWERS = new Map([
    [idOf('cf791:Skyrim.esm'), { name: 'Howl of Terror', form: 'werewolf', cooldown: 30, run: (a, id) => terror(a, id) }],
    [idOf('38ba:Dawnguard.esm'), { name: 'Mist Form', form: 'vampirelord', cooldown: 20, run: (a) => ethereal(a, 15) }],
    // Bats had a 3 s cooldown on 3 s of ethereal, so pressing the key kept a Vampire Lord untouchable for good
    [idOf('38b9:Dawnguard.esm'), { name: 'Bats', form: 'vampirelord', cooldown: 12, run: (a) => ethereal(a, 3) }],
  ]);
  globalThis.__dboBeastPower = (a, spellId) => {
    a = Number(a) >>> 0; spellId = Number(spellId) >>> 0;
    // Revert Form chosen on the Shout key arrives here like any power; it ends the form (Exsenus, 2026-10-01: stuck)
    if (spellId === REVERT_POWER) { if (stateOf(a) && !refuseEarlyRevert(a)) revert(a, 'revert power'); return; }
    const pw = POWERS.get(spellId), s = stateOf(a);
    noteBeastCast(a, spellId);
    if (!pw || !s || s.form !== pw.form) return;
    const key = `${a}:${spellId}`, now = Date.now(), ready = ST.cooldown.get(key) || 0;
    if (now < ready) {
      const text = `${pw.name} is not ready for another ${Math.ceil((ready - now) / 1000)} seconds.`;
      sendPacket(a, { customPacketType: 'dboBanner', text, seconds: 3 });
      sendPacket(a, { customPacketType: 'dboStatus', kind: 'notice', seconds: 1, speedMult: 0, text });
      return personal(a, text);
    }
    ST.cooldown.set(key, now + pw.cooldown * 1000);
    pw.run(a, spellId);
    // A howl is heard across the land (greathunt.js)
    if (pw.form === 'werewolf' && /^Howl/.test(pw.name) && typeof globalThis.__dboHuntHowled === 'function') { try { globalThis.__dboHuntHowled(a, pw.name); } catch (e) { log('beastform: howl broadcast failed', e.message); } }
  };
  // gamemode's hit hook refuses every hit on a player in Mist Form or bats
  // Only while still a Vampire Lord: casting the form again to revert mid-Mist kept the player untouchable for the rest
  // of the 15 s in mortal form, weapons out (combat review, 2026-09-29)
  globalThis.__dboBeastEthereal = (t) => {
    t = Number(t) >>> 0;
    if ((ST.ethereal.get(t) || 0) <= Date.now()) return false;
    const s = stateOf(t);
    if (s && s.form === 'vampirelord') return true;
    ST.ethereal.delete(t);
    return false;
  };
  // gamemode's onSpellHit: Vampiric Drain gives back what it absorbs (the server applies only the damage)
  globalThis.__dboBeastSpellHit = (agg, tgt, spellId) => {
    if ((Number(spellId) >>> 0) !== DRAIN || agg === tgt) return;
    const s = stateOf(agg); if (!s || s.form !== 'vampirelord') return;
    try { const pc = mp.get(agg, 'percentages'); if (pc.health > 0) mp.set(agg, 'percentages', { health: Math.min(1, pc.health + DRAIN_HEAL), magicka: pc.magicka, stamina: pc.stamina }); } catch (e) { /* gone */ }
  };
  globalThis.__dboBeastRevert = (a, why) => revert(Number(a) >>> 0, why || 'forced');
  globalThis.__dboBeastTransform = (a, key, forced) => transform(Number(a) >>> 0, key, forced);
  globalThis.__dboBeastOriginalRace = (a) => { const s = stateOf(Number(a) >>> 0); return s ? Number(s.original.raceId) >>> 0 : 0; };

  // actor -> { race, form, at }: a revert at a death or a down, to send again once the player is up and alive
  const resendAfterDeath = () => { if (!(ST.deathResend instanceof Map)) ST.deathResend = new Map(); return ST.deathResend; };
  const RESEND_AFTER_MS = 2000, RESEND_GIVE_UP_MS = 15 * 60000;
  const resendTick = (online, now = Date.now()) => {
    const m = resendAfterDeath();
    for (const [a, r] of m) {
      if (!online.has(a) || now - r.at > RESEND_GIVE_UP_MS || stateOf(a)) { m.delete(a); continue; }   // gone, stale, or a beast again
      let down = false; try { down = !!mp.get(a, 'isDead'); } catch (e) { m.delete(a); continue; }
      if (down || now - r.at < RESEND_AFTER_MS) continue;
      m.delete(a);
      try { sendPacket(a, { customPacketType: 'dboBeast', race: r.race, beast: false, form: r.form, wear: [] }); } catch (e) { log('beastform: resend failed', e.message); continue; }
      setTimeout(() => { try { if (!stateOf(a)) redress(a); } catch (e) { log('beastform re-dress failed', e.message); } }, 1500);
      log(`beastform: ${display(a)} is up again after a death in ${FORMS[r.form] ? FORMS[r.form].name : r.form}: own race sent again`);
    }
  };
  globalThis.__dboBeastResendTick = resendTick;

  every('beastForms', 1000, () => {
    const online = new Set(api.onlineActors().map((x) => x >>> 0));
    try { polymorphTick(online); } catch (e) { log('beastform: polymorph tick failed', e.message); }
    for (const a of online) {
      const s = stateOf(a);
      if (s && s.until && Date.now() >= s.until) revert(a, 'time up');
    }
    try { resendTick(online); } catch (e) { log('beastform: resend tick failed', e.message); }
    watchBeasts();
    sendBeastBodies();
  });

  // ── beast bodies (5 Oct: both on, Nate) ─────────────────────────────────────────────────────────────────────
  // Every watcher crash beside a shown beast body followed a relayed cast or stop: humanoid caster variables written into
  // the copy's beast graph (a werewolf's howls on 30 Sep; the Vampire Lords' spells on 28/29 Sep, both watchers having
  // survived the rise and minutes of melee). Client 0.3.77 sends none from a beast and guards a listed copy
  // (skymp5-client sync/beastBody.ts), and says so with the 'beastBody' UI capability. Only those clients are sent the
  // list of beasts to show in their body; every other one keeps the human fallback named after the form.
  // vampireLordRemoteRace (/vlremote) and werewolfRemoteRace (/wwremote) are each form's switch for everyone.
  const BODY = {
    werewolf: { tag: 'wwwatch', audit: 'WWBREAKER', name: 'werewolf', flag: 'private.wwBodyOff', cmd: 'wwremote', changed: 'changed',
      on: () => globalThis.__dboWerewolfRemote !== false },
    vampirelord: { tag: 'vlwatch', audit: 'VLBREAKER', name: 'Vampire Lord', flag: 'private.vlBodyOff', cmd: 'vlremote', changed: 'rose',
      on: () => globalThis.__dboVampireLordRemote === true },
  };
  const WB = globalThis.__dboBeastBody = globalThis.__dboBeastBody || { sent: new Map(), sentAt: 0 };   // viewer -> last list sent
  const RESEND_MS = 30000;
  const formOf = (a) => { const s = stateOf(a); return s && BODY[s.form] ? s.form : ''; };
  // A werewolf's trip holds breakerHoldMinutes, a Vampire Lord's vampireLordBreakerHoldMinutes (0: until /wwremote or
  // /vlremote clear, as before 13 Oct). It was for good, and every werewolf it caught stayed a naked human to everyone for
  // days: #8KWH and #LLX8 tripped 12 Oct 08:01-08:03 by watchers who were back in 12-21 s, #7DJT 13 Oct 06:38 in the 0.3.95
  // clone-storm drop wave (claude-jake's investigation). The Lord's trips came from real crashes, so it keeps until-cleared.
  // An expired trip is cleared from the character, once, and logged.
  const minutes = (v, dflt) => { const n = Number(v); return (v === null || v === '' || !Number.isFinite(n)) ? dflt : Math.max(0, n); };
  const HOLD_MS = { werewolf: minutes(CFG.breakerHoldMinutes, 10) * 60000, vampirelord: minutes(CFG.vampireLordBreakerHoldMinutes, 0) * 60000 };
  const bodyTripped = (a, form) => {
    try {
      const t = mp.get(a, BODY[form].flag);
      if (!(t && t.at)) return false;
      const hold = HOLD_MS[form] || 0;
      if (!hold || t.by !== 'breaker' || Date.now() - Number(t.at) < hold) return true;
      mp.set(a, BODY[form].flag, null);
      log(`${BODY[form].tag}: ${display(a)}'s ${BODY[form].name} body shown again: the breaker's ${Math.round(hold / 60000)} min are up (tripped ${new Date(Number(t.at)).toISOString()})`);
      return false;
    } catch (e) { return false; }
  };
  const bodyShown = (a) => { const f = formOf(a); return !!f && BODY[f].on() && !bodyTripped(a, f); };
  // On a change only to a viewer whose list changed, and to every capable viewer every 30 s while it is not empty
  const sendBeastBodies = () => {
    const now = Date.now();
    const all = api.onlineActors();
    const bodies = all.filter(bodyShown).map((a) => { const s = stateOf(a); return { id: a >>> 0, race: (s && Number(s.race) >>> 0) || FORMS[formOf(a)].race }; });
    // Staff polymorph (phase 2): a creature goes only to a client that builds its copy safely ('creatureBody', a later client);
    // formOf never names one, so it is never in bodies above, and its race is never read through FORMS
    const creatures = polymorphOn() ? all.map(creatureBodyOf).filter(Boolean) : [];
    const resend = now - WB.sentAt >= RESEND_MS;
    if (resend) WB.sentAt = now;
    for (const o of all) {
      const beastCap = hasUiCap(o, 'beastBody'), creatureCap = hasUiCap(o, 'creatureBody');
      if (!beastCap && !creatureCap) { WB.sent.delete(o >>> 0); continue; }
      const mine = (beastCap ? bodies : []).concat(creatureCap ? creatures : []).filter((b) => b.id !== (o >>> 0));
      const key = JSON.stringify(mine);
      if (!(resend && mine.length) && WB.sent.get(o >>> 0) === key) continue;
      WB.sent.set(o >>> 0, key);
      sendPacket(o, { customPacketType: 'dboBeastBody', bodies: mine });
    }
  };
  globalThis.__dboBeastBodyShown = (a) => bodyShown(Number(a) >>> 0);

  // ── the per-beast breaker (wwwatch:, vlwatch:) ──
  // A drop is not proof: the old Vampire Lord breaker tripped on Onny, who crashed twice more that day with no Lord near,
  // and it hid every Lord from everyone. So every drop near a beast is logged with its distance and timing (the body off
  // included, as the control), and only breakerDrops drops by different watchers shown that beast's body, inside
  // breakerWindowSeconds, turn its body off, for that character alone (private.wwBodyOff / private.vlBodyOff, through
  // reloads and restarts) for its form's hold minutes, or until an admin says /wwremote or /vlremote clear.
  const UNITS = Number(CFG.breakerUnits) || 6000;
  const NEAR_MS = (Number(CFG.breakerSeconds) || 120) * 1000;
  const DROPS = Math.max(1, Number(CFG.breakerDrops) || 2);
  const WINDOW_MS = (Number(CFG.breakerWindowSeconds) || 600) * 1000;
  const WATCH_GAP_MS = 10000;
  const near = globalThis.__dboBeastNear = globalThis.__dboBeastNear || new Map();      // `${watcher}:${beast}` -> { beast, form, since, last, dist, pos, movedAt, shownSince }
  const casts = globalThis.__dboBeastCasts = globalThis.__dboBeastCasts || new Map();   // beast -> [{ id, at }]
  const counted = globalThis.__dboBeastDrops = globalThis.__dboBeastDrops || new Map(); // beast -> [{ at, who }] counted drops
  const dropLog = globalThis.__dboBeastDropLog = globalThis.__dboBeastDropLog || new Map(); // actor -> [{ at, near }], the last day
  const watchBeasts = () => {
    const now = Date.now();
    for (const b of api.onlineActors().filter((o) => !!formOf(o))) {
      let cell = null, pos = null;
      try { cell = mp.get(b, 'worldOrCellDesc'); pos = mp.get(b, 'pos'); } catch (e) { continue; }
      if (!pos) continue;
      for (const o of api.onlineActors()) {
        if (o === b) continue;
        try {
          if (mp.get(o, 'worldOrCellDesc') !== cell) continue;
          const p = mp.get(o, 'pos'); if (!p) continue;
          const dist = Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]);
          if (dist > UNITS) continue;
          const key = `${o >>> 0}:${b >>> 0}`;
          const shown = bodyShown(b) && hasUiCap(o, 'beastBody');
          const w = near.get(key);
          if (!w || now - w.last > WATCH_GAP_MS) { near.set(key, { beast: b, form: formOf(b), since: now, last: now, dist, pos: p.slice(), movedAt: now, shownSince: shown ? now : 0 }); continue; }
          if (Math.hypot(p[0] - w.pos[0], p[1] - w.pos[1], p[2] - w.pos[2]) > 1) { w.pos = p.slice(); w.movedAt = now; }
          if (shown && !w.shownSince) w.shownSince = now;
          if (!shown) w.shownSince = 0;
          w.last = now; w.dist = dist;
        } catch (e) { /* gone */ }
      }
    }
    for (const [k, w] of [...near]) if (now - w.last > NEAR_MS) near.delete(k);
  };
  const noteBeastCast = (a, id) => {
    if (!formOf(a)) return;
    const now = Date.now();
    casts.set(a, (casts.get(a) || []).filter((c) => now - c.at <= NEAR_MS).concat([{ id, at: now }]).slice(-12));
  };
  const spellName = (id) => { try { const x = mp.lookupEspmRecordById(id >>> 0); if (x && x.record && x.record.editorId) return x.record.editorId; } catch (e) { /* none */ } return (id >>> 0).toString(16); };
  const secs = (ms) => Math.round(ms / 1000);
  const signed = (ms) => (ms >= 0 ? `+${secs(ms)}` : `${secs(ms)}`);
  const tellStaff = (text) => { for (const o of api.onlineActors()) { try { if (typeof isAdmin === 'function' && isAdmin(o)) personal(o, text); } catch (e) { /* offline */ } } };
  const tripBody = (b, form, drops, cell) => {
    const B = BODY[form];
    try { mp.set(b, B.flag, { at: Date.now(), by: 'breaker', drops: drops.map((d) => d.who) }); } catch (e) { log(`${B.tag}: could not mark ${display(b)}: ${e.message}`); return false; }
    counted.delete(b >>> 0);
    sendBeastBodies();
    const names = drops.map((d) => d.who).join(', ');
    audit(`${B.audit} tripped: ${names} dropped near ${display(b)} at ${cell}`);
    const holdMin = Math.round((HOLD_MS[form] || 0) / 60000);
    log(`${B.tag}: tripped for ${display(b)} at ${cell} by ${drops.length} drops (${names}); its ${B.name} body OFF${holdMin ? ` for ${holdMin} min, or` : ''} until /${B.cmd} clear`);
    tellStaff(`The ${B.name} body of ${display(b)} turned itself off${holdMin ? ` for ${holdMin} minutes` : ''}: ${drops.length} ${drops.length === 1 ? 'player' : 'players'} dropped beside it. Ask them for their crash logs, then /${B.cmd} clear ${display(b)} to show it again${holdMin ? ' sooner' : ''}.`);
    return true;
  };
  const beastDrop = (a, journalOpen) => {
    const now = Date.now();
    WB.sent.delete(a);
    const mine = [...near].filter(([k, w]) => k.startsWith(`${a}:`) && w.beast !== a && now - w.last <= NEAR_MS).map(([, w]) => w);
    const before = (dropLog.get(a) || []).filter((d) => now - d.at <= 24 * 3600 * 1000);
    if (!journalOpen) dropLog.set(a, before.concat([{ at: now, near: mine.length > 0 }]));
    let tripped = false;
    for (const w of mine) {
      const b = w.beast, form = formOf(b) || w.form, B = BODY[form], s = stateOf(b);
      if (!B) continue;
      let cell = null; try { cell = mp.get(b, 'worldOrCellDesc'); } catch (e) { /* gone */ }
      const shown = w.shownSince > 0;
      const around = (casts.get(b) || []).filter((c) => c.at >= w.movedAt - 60000 && c.at <= w.movedAt + 10000);
      const why = !B.on() ? 'off' : bodyTripped(b, form) ? 'breaker off' : hasUiCap(a, 'beastBody') ? 'not yet' : 'old client';
      const parts = [`${Math.round(w.dist)} units away`, `near it ${secs(w.last - w.since)} s`, `last moved ${secs(now - w.movedAt)} s before the drop`,
        s && s.at ? `it ${B.changed} ${secs(w.movedAt - s.at)} s before that` : 'it has reverted',
        shown ? `shown its body ${secs(w.last - w.shownSince)} s` : `body not shown to them (${why})`,
        around.length ? `its casts around then (s from the last move): ${around.map((c) => `${spellName(c.id)} ${signed(c.at - w.movedAt)}`).join(', ')}` : 'no casts by it in the minute before',
        `their other drops in 24 h: ${before.length} (${before.filter((d) => !d.near).length} with no beast near)`];
      if (journalOpen) { log(`${B.tag}: ${display(a)} quit through the menu near ${display(b)}, not counted: ${parts.join('; ')}`); continue; }
      if (!shown || bodyTripped(b, form)) { log(`${B.tag}: ${display(a)} dropped near ${display(b)}, not counted: ${parts.join('; ')}`); continue; }
      const count = () => {
        const at = Date.now();
        // One watcher's drops count once, so a single crashing player cannot turn a beast's body off for everyone
        const same = (d) => d.id === (a >>> 0) || (d.id === undefined && d.who === display(a));
        const before = (counted.get(b >>> 0) || []).filter((d) => at - d.at <= WINDOW_MS);
        const again = before.some(same);
        const drops = before.filter((d) => !same(d)).concat([{ at, who: display(a), id: a >>> 0 }]);
        counted.set(b >>> 0, drops);
        log(`${B.tag}: ${display(a)} dropped near ${display(b)}, drop ${drops.length} of ${DROPS} in ${secs(WINDOW_MS)} s${again ? ' (the same watcher again, counted once)' : ''}: ${parts.join('; ')}`);
        return drops.length >= DROPS && tripBody(b, form, drops, String(cell));
      };
      // breakerReconnectSeconds (0: off): a watcher back within it reconnected rather than crashed and is not counted
      const back = minutes(CFG.breakerReconnectSeconds, 0) * 1000;
      if (!back) { if (count()) tripped = true; continue; }
      setTimeout(() => {
        try {
          if (api.onlineActors().some((o) => (o >>> 0) === (a >>> 0))) { log(`${B.tag}: ${display(a)} was back within ${secs(back)} s of dropping near ${display(b)}, not counted`); return; }
          count();
        } catch (e) { log(`${B.tag}: deferred drop failed: ${e.message}`); }
      }, back);
    }
    for (const k of [...near.keys()]) if (k.startsWith(`${a}:`)) near.delete(k);
    return tripped;
  };
  // gamemode's disconnect handler calls this for every leave, before the logout revert clears the form; true when it tripped
  globalThis.__dboVlBreakerDrop = (a, journalOpen) => beastDrop(Number(a) >>> 0, journalOpen === true);

  // /vlremote and /wwremote: on|off is that form's body for everyone, at once (the next list leaves every such beast
  // out and their watchers rebuild them human); clear <player> shows one the breaker turned off again; nothing says who is off
  const remoteCommand = (form, isOn, setOn) => (a, args) => {
    const B = BODY[form];
    const [v0, ...rest] = String(args || '').trim().split(/\s+/);
    const v = String(v0 || '').toLowerCase();
    if (v === 'on' || v === 'off') { setOn(v === 'on'); audit(`GM ${who(a)} set ${B.name} remote body ${v}`); sendBeastBodies(); }
    if (v === 'clear') {
      const t = rest.length ? findByName(rest.join(' ')) : 0;
      if (!t) return personal(a, `Usage: /${B.cmd} clear <player|#TAG>`);
      try { mp.set(t, B.flag, null); } catch (e) { return personal(a, `That failed: ${e.message}`); }
      counted.delete(t >>> 0);
      audit(`GM ${who(a)} cleared the ${B.name} body breaker for ${who(t)}`);
      log(`${B.tag}: ${display(t)}'s ${B.name} body cleared by ${display(a)}`);
      sendBeastBodies();
      return personal(a, `${display(t)}'s ${B.name} body may be shown again.`);
    }
    const off = api.onlineActors().filter((o) => bodyTripped(o, form)).map((o) => display(o));
    personal(a, `Other players ${isOn() ? `with client 0.3.77 or later see the ${B.name} body; older clients see the real appearance` : `see the real appearance of a ${B.name}`}.` +
      (off.length ? ` Turned off by the breaker (online): ${off.join(', ')}; /${B.cmd} clear <player> to show one again.` : ''));
  };
  registerChatCommand('vlremote', remoteCommand('vampirelord', () => globalThis.__dboVampireLordRemote === true,
    (on) => { globalThis.__dboVampireLordRemote = on; globalThis.__dboVlRemoteSetBy = 'admin'; saveRemote(on, 'admin'); }),
  { admin: true, help: '[on|off|clear <player>] whether other players see the Vampire Lord body (crash mitigation)' });
  registerChatCommand('wwremote', remoteCommand('werewolf', () => globalThis.__dboWerewolfRemote !== false,
    (on) => { globalThis.__dboWerewolfRemote = on; globalThis.__dboWwRemoteSetBy = 'admin'; saveWerewolfRemote(on, 'admin'); }),
  { admin: true, help: '[on|off|clear <player>] whether other players see the werewolf body (crash mitigation)' });

  registerChatCommand('forms', (a) => {
    const s = stateOf(a);
    if (!s) return personal(a, 'You are in your own shape. In a beast form this lists its abilities and keys.');
    if (isCreatureState(s)) return personal(a, `You are a ${formName(s.form)}. /polymorph revert turns you back.`);
    for (const line of legend(s.form)) personal(a, line);
  }, { help: 'the abilities and keys of the beast form you are in' });

  // ── staff polymorph (Jake, 22 Oct) ──────────────────────────────────────────────────────────────────────────────────────
  // /polymorph <animal> | revert | list: a Lead GM and above (gamemode.js LEAD_ONLY and isLeadStaff, the gate /beastform has)
  // turns themselves into an animal of CREATURES. There is no target argument, so nobody can polymorph another player. It is
  // the werewolf's race swap: the look kept in private.beast (with the animal's race and creature: true), the appearance
  // keeping the mortal race under the animal's name, the own client swapping race on dboBeast (no loadout, no spells). Death,
  // logout and login revert it as they do any form, so an animal race is never saved as the character's own. It can be hit
  // and killed (it is not ethereal); a death reverts it and the player is seen again. Silent: no witness line on the change
  // or on any revert, only the staff audit line (who, which animal, why it ended).
  // Other clients build the animal only from dboBeastBody, and only when their UI says 'creatureBody' (the next client
  // package); an older one would show a stripped human named Chicken. So the change is refused, and ended at the next tick,
  // while any other player the fork could stream the staff member to lacks that capability: one in the same cell or
  // worldspace within two grid squares (the fork streams the 3x3 block of 4096-unit squares; see unseeingNear) or within
  // guardUnits (6000), or any player the fork already lists as a neighbour (actorNeighbors).
  // Refused too when dead or down, bound or carried, jailed, in a duel or a fight, on a horse, seated or at a station, in
  // water (most cannot swim) or indoors (none can open a door); indoors and water also end it at the tick. The server sees no
  // seat, saddle or water directly: those three are read from the anticheat's horse and the client's last relayed animation.
  // /polymorph on|off (Owners): the kill switch, kept in beastform-state.json like /wwremote through reloads and restarts;
  // off ends every polymorph at once. Config beastform.polymorph { enabled (the default while no switch is saved: true),
  // guardUnits, combatSeconds, forms (a list narrowing which animals may be taken; a shape already taken still ends as usual) }
  const PCFG = Object.assign({ enabled: true, guardUnits: 6000, combatSeconds: 30, forms: null },
    CFG.polymorph && typeof CFG.polymorph === 'object' ? CFG.polymorph : {});
  if (globalThis.__dboPolymorphSetBy === undefined) {
    const saved = readState();
    if (saved && typeof saved.polymorphOn === 'boolean') {
      globalThis.__dboPolymorphOn = saved.polymorphOn;
      globalThis.__dboPolymorphSetBy = String(saved.polymorphSetBy || 'file');
    } else globalThis.__dboPolymorphOn = PCFG.enabled !== false;
  }
  const savePolymorph = (on, by) => writeState({ polymorphOn: on === true, polymorphSetBy: by, polymorphAt: new Date().toISOString() });
  // The rank helpers gamemode.js hands over: isLeadStaff (the Lead GM gate of LEAD_ONLY), tierOf 'senior' (an Owner). An older
  // gamemode.js without them: both closed
  const isLeadStaff = typeof api.isLeadStaff === 'function' ? api.isLeadStaff : () => false;
  const isOwner = (a) => { try { return typeof api.tierOf === 'function' && api.tierOf(a) === 'senior'; } catch (e) { return false; } };
  const GUARD_UNITS = Number(PCFG.guardUnits) > 0 ? Number(PCFG.guardUnits) : 6000;
  const getp = (a, k) => { try { return mp.get(a, k); } catch (e) { return undefined; } };
  const isOnline = (a) => api.onlineActors().some((o) => (o >>> 0) === (a >>> 0));
  // An interior is a CELL record; a worldspace (outdoors) is a WRLD (jail.js reads it the same way). A cache only
  const interiors = new Map();
  const isIndoors = (a) => {
    const desc = String(getp(a, 'worldOrCellDesc') || '');
    if (!desc) return false;
    if (!interiors.has(desc)) {
      let yes = false;
      try { const r = mp.lookupEspmRecordById(mp.getIdFromDesc(desc) >>> 0); yes = !!(r && r.record && String(r.record.type) === 'CELL'); } catch (e) { yes = false; }
      if (interiors.size > 4000) interiors.clear();
      interiors.set(desc, yes);
    }
    return interiors.get(desc);
  };
  // The animation the player's own client last relayed, which the fork keeps while they stand still (MpActor lastAnimEvent:
  // a movement update that is not 'Standing' clears it): the server's only sight of a seat, a saddle or water
  const animShape = (a) => {
    const e = String(getp(a, 'lastAnimEvent') || '').toLowerCase();
    if (!e || /exit|stop|forcedefault|dismount/.test(e)) return '';
    if (/swim/.test(e)) return 'water';
    if (/horse|mount/.test(e)) return 'mounted';
    if (/chair|stool|bench|throne|bedroll|furniture|sitting|kneel|enter(instant|start|tosit)?$/.test(e)) return 'seated';
    return '';
  };
  // A horse the player activated and still has under them (anticheat.js, its movement class), or a horse's relayed animation
  const onHorse = (a) => {
    try {
      const ac = globalThis.__dboAnticheat;
      const st = ac && ac.players instanceof Map ? ac.players.get(a >>> 0) : null;
      if (st && st.mounted === true && st.horse) return true;
    } catch (e) { /* no anticheat */ }
    return animShape(a) === 'mounted';
  };
  // Whom the fork streams an actor to (review R1, 22 Oct): every player in the 3x3 block of grid squares around it, a square
  // being int16(pos / 4096) on x and y (MpObjectReference GetGridPos: truncated toward zero, so square 0 is 8191 units wide;
  // height ignored; Grid.h MoveImpl i, j in -1..1), in the same cell or worldspace. That reaches a player 8191 units off on
  // one axis (11.6k on the diagonal; 12.3k on an axis, 17k on the diagonal across a worldspace's x = 0 and y = 0 lines) and
  // at any height above or below, far past a 6000-unit radius. So the guard counts the fork's own test with one square more (GUARD_SQUARES 2: a 5x5 block), so the
  // tick's revert lands before a player walking in becomes a listener; the guardUnits radius as well (it only matters when
  // raised past 8192); and every online player in actorNeighbors, the fork's own lists (ActorNeighborsBinding: the actors
  // this one is streamed to and those streamed to it), whatever their place. a itself is in that list and is skipped
  const GUARD_SQUARES = 2;
  const squareOf = (p) => [Math.trunc(Number(p[0]) / 4096), Math.trunc(Number(p[1]) / 4096)];
  // How many other players the staff member could be streamed to lack 'creatureBody' (their game would show a stripped human);
  // null when a's own place cannot be read. A place that is not a number counts as near (fails closed)
  const unseeingNear = (a) => {
    const here = getp(a, 'worldOrCellDesc'), pos = getp(a, 'pos');
    if (!here || !Array.isArray(pos)) return null;
    const sq = squareOf(pos);
    let listed = null;
    try { const l = mp.get(a, 'actorNeighbors'); if (Array.isArray(l)) listed = new Set(l.map((x) => Number(x) >>> 0)); } catch (e) { listed = null; }
    let n = 0;
    for (const o of api.onlineActors()) {
      if ((o >>> 0) === (a >>> 0)) continue;
      try {
        if (hasUiCap(o, 'creatureBody')) continue;
        if (!(listed && listed.has(o >>> 0))) {
          if (mp.get(o, 'worldOrCellDesc') !== here) continue;
          const p = mp.get(o, 'pos');
          if (!Array.isArray(p)) continue;
          const q = squareOf(p);
          const squaresOff = Math.abs(q[0] - sq[0]) > GUARD_SQUARES || Math.abs(q[1] - sq[1]) > GUARD_SQUARES;
          if (squaresOff && Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]) > GUARD_UNITS) continue;
        }
        n++;
      } catch (e) { /* gone */ }
    }
    return n;
  };
  const unseeingText = (n) => `${n} ${n === 1 ? 'player' : 'players'} nearby would see a stripped human instead of the animal: their game cannot show it yet. Polymorph with nobody else within about 250 m.`;
  // Why a cannot take an animal shape now, or ''
  const polymorphRefusal = (a) => {
    if (globalThis.__dboPolymorphOn !== true) return 'Polymorph is switched off for now.';
    if (!isOnline(a)) return 'You are not in the world.';
    let downed = false; try { downed = typeof globalThis.__dboIsDowned === 'function' && !!globalThis.__dboIsDowned(a); } catch (e) { downed = false; }
    if (downed) return 'Not while you are down.';
    if (getp(a, 'isDead') === true) return 'Not while you are dead.';
    const s = stateOf(a);
    if (s) return isCreatureState(s) ? `You are already a ${formName(s.form)}: /polymorph revert first.` : `Leave your ${formName(s.form)} shape first (/beast revert).`;
    const r = getp(a, 'private.restrained');
    if (r && (r.boundHands || r.carried || r.captorActorId)) return 'Not while you are bound, carried or held.';
    const jail = getp(a, 'private.dboSentence');
    if (jail && Number(jail.totalMs) > (Number(jail.servedMs) || 0)) return 'Not while you are in jail.';
    let duel = false; try { duel = typeof globalThis.__dboInDuel === 'function' && !!globalThis.__dboInDuel(a); } catch (e) { duel = false; }
    if (duel) return 'Not in a duel.';
    const fought = globalThis.__dboCombatAt instanceof Map ? Number(globalThis.__dboCombatAt.get(a >>> 0)) || 0 : 0;
    if (Date.now() - fought < (Number(PCFG.combatSeconds) || 0) * 1000) return 'Not in the middle of a fight.';
    if (onHorse(a)) return 'Not on a horse, or right beside the one you rode: get off and step away first.';
    const shape = animShape(a);
    if (shape === 'seated') return 'Not while you are sitting or using something: stand up first.';
    if (shape === 'water') return 'Not in water: most of these animals cannot swim.';
    if (getp(a, 'private.dboAppearanceEdit')) return 'Close the appearance editor first.';
    if (isIndoors(a)) return 'Not indoors: these animals cannot open doors. Go outside first.';
    const n = unseeingNear(a);
    if (n === null) return 'The server cannot read where you are.';
    if (n > 0) return unseeingText(n);
    return '';
  };
  // What ends a shape already taken, checked every tick: the switch, indoors, water, a player near who cannot see it
  const polymorphBreak = (a) => {
    if (globalThis.__dboPolymorphOn !== true) return 'polymorph off';
    if (isIndoors(a)) return 'polymorph indoors';
    if (animShape(a) === 'water') return 'polymorph water';
    if (unseeingNear(a) > 0) return 'polymorph guard';
    return '';
  };
  const polymorphTick = (online) => {
    for (const a of online) {
      const s = stateOf(a);
      if (!s || !isCreatureState(s)) continue;
      const why = polymorphBreak(a);
      if (why) revert(a, why);
    }
  };
  // The staff audit line (who, which animal, why it ended: a fixed word, never typed text) and the staff member's own line
  const POLY_END = { 'asked to revert': 'asked', death: 'died', logout: 'logged out', login: 'logged in', 'time up': 'time up',
    'polymorph off': 'switched off', 'polymorph guard': 'a player who cannot see it came near', 'polymorph indoors': 'went indoors',
    'polymorph water': 'went into water', 'reverted from the admin panel': 'staff panel', 'revert power': 'revert power' };
  const POLY_TELL = { 'polymorph off': 'polymorph was switched off', 'polymorph guard': 'a player came near whose game cannot show the animal yet',
    'polymorph indoors': 'these animals cannot open doors, so it ends indoors', 'polymorph water': 'most of these animals cannot swim, so it ends in water',
    death: 'the animal died', login: 'you were still an animal when you left' };
  const polymorphEnded = (a, s, why) => {
    const w = String(why || '');
    const end = own(POLY_END, w) ? POLY_END[w] : /^reverted by /.test(w) ? 'staff command' : 'other';
    const name = isCreature(s.form) ? CREATURES[s.form].name : 'animal';
    audit(`BEAST ${who(a)} left the ${name} shape (polymorph): ${end}`);
    if (own(POLY_TELL, w)) personal(a, `You are yourself again: ${POLY_TELL[w]}.`);
  };
  // A creature's body for a 'creatureBody' viewer: the race kept in private.beast at the change, else the creature table's
  const creatureBodyOf = (a) => {
    const s = stateOf(a);
    if (!s || !isCreatureState(s)) return null;
    const race = (Number(s.race) >>> 0) || (isCreature(s.form) ? CREATURES[s.form].race >>> 0 : 0);
    return race ? { id: a >>> 0, race } : null;
  };
  const polymorphOn = () => globalThis.__dboPolymorphOn === true;
  // Returns '' when the change happened, else the sentence that says why not
  const polymorphTo = (a, key) => {
    const c = isCreature(key) ? CREATURES[key] : null;
    if (!c) return 'There is no such animal.';
    if (!c.race) return `The ${c.name} is not in this load order.`;
    if (Array.isArray(PCFG.forms) && !PCFG.forms.map(String).includes(key)) return `The ${c.name} is not open for polymorph now.`;
    const why = polymorphRefusal(a);
    if (why) return why;
    let original = null; try { original = mp.get(a, 'appearance'); } catch (e) { /* none */ }
    if (!original || !original.raceId) return 'This character has no appearance yet.';
    const race = c.race >>> 0;
    try {
      mp.set(a, 'private.beast', { form: key, original, at: Date.now(), until: 0, race, creature: true });
      // The mortal race stays in the appearance for every client, as a beast's does; only the name changes
      mp.set(a, 'appearance', Object.assign({}, original, { name: String((own(NAMES, key) && NAMES[key]) || c.name) }));
    } catch (e) {
      log(`beastform: polymorph of ${display(a)} failed: ${e.message}`);
      try { mp.set(a, 'appearance', original); mp.set(a, 'private.beast', null); } catch (e2) { /* as it was */ }
      return 'That failed; see the server log.';
    }
    sendPacket(a, { customPacketType: 'dboBeast', race, beast: true, form: key, wear: [], abilities: null });
    audit(`BEAST ${who(a)} took the ${c.name} shape (polymorph, staff, own character)`);
    log(`beastform: ${display(a)} polymorphed into ${c.name} (race ${race.toString(16)})`);
    sendBeastBodies();
    try { if (globalThis.__dboBeastChanged) globalThis.__dboBeastChanged(a, key, true); } catch (e) { log('beast change hook failed', e.message); }
    return '';
  };
  const animals = () => Object.keys(CREATURES).filter((k) => CREATURES[k].race && !(Array.isArray(PCFG.forms) && !PCFG.forms.map(String).includes(k)));
  // The F7 panel's picker, called by the fork's adminSystem.ts 'polymorphSelf' action. It is the SAME path
  // /polymorph uses, so every refusal comes from polymorphTo and polymorphRefusal: the Owners' switch, the
  // form allow-list, dead, down, bound, jailed, duelling, in a fight, mounted, seated, in water, indoors,
  // and the creatureBody distance guard. '' means the shape was taken, anything else is the sentence to show.
  // The rank is re-checked here rather than trusted to the caller: adminSystem gates it to a Lead GM through
  // SPAWN_ACTIONS, and this makes the gameplay layer's own answer independent of that.
  // It takes an actor and a form and nothing else, so there is no target to aim at somebody - Nat's call,
  // 25 Oct: polymorph works on your own character alone.
  globalThis.__dboPolymorphSelf = (a, key) => {
    const me = Number(a) >>> 0;
    if (!isLeadStaff(me)) return 'That is for a Lead GM and above.';
    const w = String(key == null ? '' : key).trim().toLowerCase();
    const k = own(CREATURE_WORDS, w) ? CREATURE_WORDS[w] : w;
    if (!isCreature(k)) return 'There is no such animal.';
    return polymorphTo(me, k);
  };
  registerChatCommand('polymorph', (a, args) => {
    a = a >>> 0;
    if (!isLeadStaff(a)) return personal(a, 'That is for a Lead GM and above.');
    const words = String(args || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const w = words[0] || '';
    // The animals are no longer named here: there are eighteen, and /polymorph with no argument lists them
    const usage = `Usage: /polymorph <animal> | revert | list${isOwner(a) ? ' | on | off' : ''}. It works on yourself alone; /polymorph on its own names the animals.`;
    if (w === 'on' || w === 'off') {
      if (!isOwner(a)) return personal(a, 'Only an Owner switches polymorph on or off.');
      if (words.length > 1) return personal(a, usage);
      const on = w === 'on';
      globalThis.__dboPolymorphOn = on; globalThis.__dboPolymorphSetBy = 'admin'; savePolymorph(on, 'admin');
      let n = 0;
      if (!on) for (const o of api.onlineActors()) { if (isCreatureState(stateOf(o >>> 0)) && revert(o >>> 0, 'polymorph off')) n++; }
      audit(`BEAST ${who(a)} switched polymorph ${on ? 'on' : 'off'} for all staff (${n} turned back)`);
      sendBeastBodies();
      return personal(a, on ? 'Polymorph is on: a Lead GM and above may take an animal shape.' : `Polymorph is off${n ? ` and ${n} turned back` : ''}. It stays off through reloads and restarts until /polymorph on.`);
    }
    if (!w) {
      return personal(a, `Polymorph is ${polymorphOn() ? 'on' : 'off'}. /polymorph <animal> turns you, and only you, into one: ${animals().join(', ')}. ` +
        `/polymorph revert turns you back; /polymorph list shows who is one.${isOwner(a) ? ' /polymorph on|off switches it for everyone.' : ''}`);
    }
    if (w === 'list') {
      if (words.length > 1) return personal(a, usage);
      const now = Date.now();
      const list = api.onlineActors().map((o) => [o >>> 0, stateOf(o >>> 0)]).filter(([, s]) => isCreatureState(s))
        .map(([o, s]) => `${display(o)}: ${formName(s.form)} for ${Math.max(0, Math.round((now - (Number(s.at) || now)) / 60000))} min`);
      return personal(a, `Polymorph is ${polymorphOn() ? 'on' : 'off'}. ${list.length ? `In an animal shape now: ${list.join('; ')}.` : 'Nobody is in an animal shape.'}`);
    }
    // Only ever on oneself: any word after the first (a name, a #TAG) is refused, never looked up
    if (words.length > 1) return personal(a, `Polymorph works on yourself alone: /polymorph ${w}, with nothing after it.`);
    if (w === 'revert') {
      const s = stateOf(a);
      if (!isCreatureState(s)) return personal(a, s ? `You are in ${formName(s.form)}, not an animal shape: /beast revert.` : 'You are in your own shape.');
      return personal(a, revert(a, 'asked to revert') ? 'You are yourself again.' : 'That failed; see the server log.');
    }
    const key = own(CREATURE_WORDS, w) ? CREATURE_WORDS[w] : w;
    if (!isCreature(key)) return personal(a, usage);
    const why = polymorphTo(a, key);
    if (why) { log(`beastform: ${display(a)} could not polymorph into ${key}: ${why}`); return personal(a, why); }
    personal(a, `You are a ${CREATURES[key].name}. Nobody near you is told. /polymorph revert turns you back; so do a death, a logout, going indoors or into water, and a player coming near whose game cannot show the animal.`);
  }, { admin: true, help: '<animal>|revert|list|on|off: take an animal shape yourself (never anyone else) or end it; /polymorph on its own names the animals; on and off: the Owners\' switch for everyone' });

  // Admins: grant or take the power, or force a form for testing
  registerChatCommand('beastform', (a, args) => {
    const [who_, what, op] = String(args || '').trim().split(/\s+/);
    const t = who_ ? findByName(who_) : a;
    const key = String(what || '').toLowerCase().replace(/[^a-z]/g, '');
    const f = FORMS[key === 'vampire' ? 'vampirelord' : key];
    if (!t || !f) return personal(a, 'Usage: /beastform <player|#TAG|me> <werewolf|vampirelord> [grant|remove|now|revert]');
    const k = key === 'vampire' ? 'vampirelord' : key;
    const mode = String(op || 'grant').toLowerCase();
    if (mode === 'now') { const why = tryTransform(t, k, true); return personal(a, why ? `${display(t)} could not transform: ${why}.` : `${display(t)} transformed.`); }
    if (mode === 'revert') return personal(a, revert(t, `reverted by ${display(a)}`) ? `${display(t)} reverted.` : `${display(t)} is not transformed.`);
    const ok = papyrus(t, mode === 'remove' ? 'RemoveSpell' : 'AddSpell', mode === 'remove' ? [spellArg(f.power)] : [spellArg(f.power), false]);
    try { mp.set(t, k === 'vampirelord' ? 'private.vampireLordGrant' : 'private.werewolfGrant', mode !== 'remove'); } catch (e) { /* offline */ }
    audit(`BEAST GM ${who(a)} ${mode === 'remove' ? 'took' : 'gave'} ${f.name} ${mode === 'remove' ? 'from' : 'to'} ${who(t)}`);
    personal(a, ok ? `${display(t)} ${mode === 'remove' ? 'no longer has' : 'now has'} the ${f.name} power.` : 'That failed; see the server log.');
  }, { admin: true, help: '<player> <werewolf|vampirelord> [grant|remove|now|revert] beast form powers' });

  // The power's cast never reaches the server (the client relays hand casts only), so the form is also taken by
  // chat or by the client's own cast event (dboBeastRequest). The power itself must have been granted.
  const holdsPower = (a, key) => {
    try {
      if (mp.get(a, key === 'werewolf' ? 'private.werewolfGrant' : 'private.vampireLordGrant') === true) return true;
      const kind = typeof globalThis.__dboSuperKind === 'function' ? globalThis.__dboSuperKind(a) : null;
      if (key === 'werewolf' && kind === 'werewolf') return true;
      const crown = typeof globalThis.__dboSuperCrownHolder === 'function' ? globalThis.__dboSuperCrownHolder() : 0;
      if (key === 'vampirelord' && crown === (a >>> 0)) return true;
    } catch (e) { /* offline */ }
    return false;
  };
  const takeForm = (a, key) => {
    if (stateOf(a)) {
      if (refuseEarlyRevert(a)) return '';
      return revert(a, 'asked to revert') ? 'You return to your own shape.' : 'You are not transformed.';
    }
    if (!holdsPower(a, key)) return key === 'werewolf' ? 'The beast blood is not in you.' : 'Only a Vampire Lord can take that form.';
    transform(a, key);   // says why itself when it refuses
    return '';
  };
  globalThis.__dboBeastRequest = (a, spellId) => globalThis.__dboBeastCast(a, spellId);
  // A beast spell a client still holds after the form ended: the server strips it from every equipment update, so it is
  // learned and unlearned once, which carries the removal to the client (supernatural.js flushStageSpells does the same)
  const staleTaken = globalThis.__dboBeastStaleTaken instanceof Map ? globalThis.__dboBeastStaleTaken : (globalThis.__dboBeastStaleTaken = new Map()); // actor -> spells taken back
  globalThis.__dboBeastStaleSpells = (a, equipment) => {
    a = Number(a) >>> 0;
    if (!equipment || stateOf(a)) return 0;
    const beast = new Set([...allSpells('vampirelord'), ...allSpells('werewolf')].map((sp) => sp.id));
    const taken = staleTaken.get(a) || new Set();
    let n = 0;
    for (const k of ['leftSpell', 'rightSpell', 'voiceSpell', 'instantSpell']) {
      const id = Number(equipment[k]) >>> 0;
      if (!id || !beast.has(id) || taken.has(id)) continue;
      taken.add(id); n++;
      papyrus(a, 'AddSpell', [spellArg(id), false]);
      papyrus(a, 'RemoveSpell', [spellArg(id)]);
      log(`beastform: took ${id.toString(16)} back out of ${display(a)}'s hands: the form has ended`);
    }
    if (n) staleTaken.set(a, taken);
    return n;
  };
  // The admin panel and /beastform drive the change directly, so an admin never depends on the cast relay
  globalThis.__dboBeastAdmin = (a, key, op) => {
    const k = key === 'vampire' ? 'vampirelord' : String(key || 'werewolf').toLowerCase();
    // A creature key may only end the shape it names (the panel's revert); grant, revoke and a change stay FORMS' alone
    const creatureRevert = op === 'revert' && isCreature(k);
    if (!own(FORMS, k) && !creatureRevert) return `Unknown form '${key}'`;
    if (op === 'revert') return revert(a, 'reverted from the admin panel') ? `${display(a)} is back in their own shape.` : `${display(a)} is not transformed.`;
    if (op === 'revoke') {
      papyrus(a, 'RemoveSpell', [spellArg(FORMS[k].power)]);
      try { mp.set(a, k === 'vampirelord' ? 'private.vampireLordGrant' : 'private.werewolfGrant', false); } catch (e) { /* offline */ }
      revert(a, 'the power was taken back');
      return `${display(a)} no longer has ${FORMS[k].name}.`;
    }
    const why = tryTransform(a, k, true);
    return why ? `${display(a)} could not change: ${why}.` : `${display(a)} took ${FORMS[k].name}.`;
  };
  globalThis.__dboBeastHolds = (a) => {
    const s = stateOf(a) || {};
    return {
      werewolf: holdsPower(a, 'werewolf'), vampirelord: holdsPower(a, 'vampirelord'),
      form: s.form || null,
      // The admin panel tells an animal shape from a beast one by this, not by a list of its own, so a form the
      // panel's build never heard of is still shown and still revertible
      creature: isCreatureState(s),
      // When the shape was taken, for the panel's "for N min" (what /polymorph list prints); null in no shape
      since: s.form ? Number(s.at) || null : null,
    };
  };
  // Panel-wide polymorph state (fork adminSystem.ts -> adminMenuService panelData -> front): the Owners' switch
  // and the animals that may be taken RIGHT NOW, which is CREATURES narrowed by what resolves in this load order
  // and by config beastform.polymorph.forms. The front must not keep a list of its own: it would offer an animal
  // the server refuses. Flat and small, since it rides every panel refresh.
  globalThis.__dboPolymorphPanel = () => ({
    on: polymorphOn(),
    setBy: String(globalThis.__dboPolymorphSetBy || ''),
    forms: animals().map((k) => ({ key: k, name: CREATURES[k].name })),
  });
  registerChatCommand('beast', (a, args) => {
    const w = String(args || '').trim().toLowerCase();
    if (stateOf(a) || w === 'revert' || w === 'off') { const r = takeForm(a, stateOf(a) ? stateOf(a).form : 'werewolf'); if (r) personal(a, r); return; }
    const key = /vamp/.test(w) ? 'vampirelord' : /were|wolf|beast/.test(w) || !w ? 'werewolf' : '';
    if (!key) return personal(a, 'Usage: /beast [werewolf|vampirelord|revert]');
    const r = takeForm(a, key); if (r) personal(a, r);
  }, { help: '[werewolf|vampirelord|revert] take or leave your beast form (or cast the power)' });

  log(`beastform on: ${Object.entries(FORMS).map(([k, f]) => `${k} race ${f.race.toString(16)} power ${f.power.toString(16)}${f.seconds ? ` ${f.seconds}s` : ''}`).join(', ')}, revert ${REVERT_POWER.toString(16)} (not by choice in a werewolf's first ${Math.max(0, Number(WW.minSeconds) || 0)} s), Behemoth for the ${BEHEMOTH.rank} ${BEHEMOTH.enabled === true ? `ON (${behemothRace() ? behemothRace().toString(16) : 'race not in the load order'})` : 'off'}, Vampire Lord remote body ${globalThis.__dboVampireLordRemote === true ? 'ON' : 'off'}, werewolf remote body ${globalThis.__dboWerewolfRemote !== false ? 'ON' : 'off'}${globalThis.__dboWwRemoteSetBy ? ` (${globalThis.__dboWwRemoteSetBy})` : ''}`);
  log(`beastform polymorph ${polymorphOn() ? 'ON' : 'off'}${globalThis.__dboPolymorphSetBy ? ` (${globalThis.__dboPolymorphSetBy})` : ''}: ${Object.entries(CREATURES).map(([k, c]) => `${k} ${c.race ? c.race.toString(16) : 'not in the load order'}`).join(', ')}; refused near a player without creatureBody (within ${GUARD_SQUARES} grid squares, ${GUARD_UNITS} units or listed by the fork)`);
};
