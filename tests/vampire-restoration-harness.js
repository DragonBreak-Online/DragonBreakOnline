// Vampires and Restoration's healing (Nate, 11 Oct; a house rule, not TES canon): a vampire, at any stage and as a Vampire
// Lord, cannot cast Restoration's healing spells, and healing magic cast by others does nothing for a vampire. A vampire
// cannot read, buy or be taught a healing tome; one already known stays in the spellbook. The anti-undead spells still harm.
//
// How the server does it (supernatural.js vampireRestoration): the fork's C++ applies a heal right after the gamemode's
// onSpellCast / onSpellHit and cannot be refused there, so the target's health is held at its value before the heal and
// whatever the heal added is taken back. This harness plays the C++'s part (the heal lands after the hook returns, and a
// concentration channel heals again each second) against the real supernatural.js and spells.js.
//   node tests/vampire-restoration-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const SUPER = path.join(SERVER, 'supernatural.js');
const SPELLS = path.join(SERVER, 'spells.js');
const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const dir = fs.mkdtempSync(path.join(base, 'claude-nate-vamprest-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
fs.copyFileSync(path.join(SERVER, 'skills.json'), 'skills.json');
fs.copyFileSync(path.join(SERVER, 'spell-tomes.json'), 'spell-tomes.json');

let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) pass++; else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;
// The hold's first revert is a setTimeout(0) after the hook, as the C++ heals before the event loop turns
const tick = () => new Promise((r) => setTimeout(r, 2));

// ---- 1. the list: restoration-healing.json -----------------------------------------------------------------------
const LIST = JSON.parse(fs.readFileSync(path.join(SERVER, 'restoration-healing.json'), 'utf8'));
const byName = new Map(LIST.spells.map((s) => [s.name, s]));
for (const n of ['Healing', 'HealingLeftHand', 'HealingRightHand', 'FastHealing', 'FastHealingLeftHand', 'HealOther', 'HealingHands',
  'CloseWounds', 'CloseWoundsLeftHand', 'GrandHealing', 'GrandHealingLeftHand']) ok(byName.has(n), `the list has ${n}`);
ok(byName.get('HealOther').id === 'Skyrim.esm:012FD2' && byName.get('HealOther').castType === 'fireAndForget' && byName.get('HealOther').delivery === 'targetActor', 'Heal Other: Skyrim 12fd2, fire and forget at a target', byName.get('HealOther'));
ok(byName.get('HealingHands').castType === 'concentration' && byName.get('Healing').castType === 'concentration' && byName.get('Healing').delivery === 'self', 'Healing and Healing Hands are channels', [byName.get('Healing'), byName.get('HealingHands')]);
ok(!LIST.spells.some((s) => /Ward/i.test(s.name)), 'no ward is healing', LIST.spells.filter((s) => /Ward/i.test(s.name)).map((s) => s.name));
ok(!LIST.spells.some((s) => /Undead/i.test(s.name) || /Undead/.test(s.effects.join())), 'Necromantic Healing and Heal Undead (they heal only the undead) are not in it');
const HARM = new Map(LIST.harmful.map((s) => [s.name, s]));
for (const n of ['TurnLesserUndead', 'TurnUndead', 'TurnGreaterUndead', 'RepelUndead', 'BaneoftheUndead', 'DLC1SunFire', 'DLC1VampiresBane',
  'DLC1StendarrsAura', 'DLC1SunCloakDmg']) ok(HARM.has(n), `the harmful list has ${n}`);
const healIds = new Set(LIST.spells.map((s) => s.id));
const overlap = LIST.harmful.filter((s) => healIds.has(s.id)).map((s) => s.name);
ok(overlap.join() === 'HazardGuardianCircleSpell', "no spell against the undead is healing, but the Guardian Circle's hazard (both)", overlap);

// ---- the stub server -------------------------------------------------------------------------------------------
// Exact plugin-name matching, like the server's FormDesc::ToFormId
const PLUGINS = { 'Skyrim.esm': 0x00, 'Update.esm': 0x01, 'Dawnguard.esm': 0x02, 'HearthFires.esm': 0x03, 'Dragonborn.esm': 0x04, 'BSAssets.esm': 0x0a, 'BSHeartland.esm': 0x0b,
  'Gray Fox Cowl.esm': 0x30, "OCW_Obscure's_CollegeofWinterhold.esp": 0x31, 'WindhelmSSE.esp': 0x32, 'DragonBreak Online Edits.esp': 0x3c };
const BY_INDEX = Object.fromEntries(Object.entries(PLUGINS).map(([k, v]) => [v, k]));
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const descOf = (id) => { const p = BY_INDEX[id >>> 24]; if (!p) throw new Error('no plugin'); return `${(id & 0xffffff).toString(16)}:${p}`; };
const canon = (c) => { const i = c.lastIndexOf(':'); return idOf(`${parseInt(c.slice(i + 1), 16).toString(16)}:${c.slice(0, i)}`); };
const SP = Object.fromEntries([...LIST.spells, ...LIST.harmful].map((s) => [s.name, canon(s.id)]));

let wallClock = 1780000000000;
Date.now = () => wallClock;
const props = new Map();
const put = (id, p, v) => props.set(`${id}|${p}`, v);
const learned = new Map();
const known = (a) => learned.get(a) || (learned.set(a, new Set()), learned.get(a));
const mp = {
  getIdFromDesc: idOf, getDescFromId: descOf,
  get: (id, p) => (p === 'type' ? 'MpActor' : props.get(`${id}|${p}`)),
  set: (id, p, v) => props.set(`${id}|${p}`, JSON.parse(JSON.stringify(v))),
  lookupEspmRecordById: () => null,
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    const a = idOf(self.desc); const s = known(a);
    if (fn === 'GetSpellCount') return s.size;
    if (fn === 'GetNthSpell') { const id = [...s][args[0]]; return id === undefined ? null : { type: 'espm', desc: descOf(id) }; }
    const spell = args && args[0] && args[0].desc ? idOf(args[0].desc) : 0;
    if (fn === 'AddSpell') { if (s.has(spell)) return false; s.add(spell); return true; }
    if (fn === 'RemoveSpell') return s.delete(spell);
    return null;
  },
};
const VAMP = 0x71, LORD = 0x72, MORTAL = 0x73, PRIEST = 0x74, NPC = 0xff000123, DEADVAMP = 0x75;
const ONLINE = [VAMP, LORD, MORTAL, PRIEST, DEADVAMP];
put(VAMP, 'private.supernatural', { kind: 'vampire', stage: 1, lastFed: 0 });
put(LORD, 'private.supernatural', { kind: 'vampire', stage: 4, pure: true, lastFed: 0 });
put(LORD, 'private.beast', { form: 'vampirelord' });
put(DEADVAMP, 'private.supernatural', { kind: 'vampire', stage: 2, lastFed: 0 });
const hp = (a) => (props.get(`${a}|percentages`) || {}).health;
const setHp = (a, h) => put(a, 'percentages', { health: h, magicka: 0.5, stamina: 0.6 });
const said = [];
const lines = (a) => said.filter((x) => x[0] === a).map((x) => x[1]);
const timers = new Map();
const handlers = new Map(), commands = new Map();
const baseApi = (extraCfg) => ({
  mp, log: () => {}, audit: () => {}, personal: (a, t) => said.push([a, t]), system: (a, t) => said.push([a, t]),
  registerChatCommand: (name, fn, opts) => commands.set(name, { fn, opts }),
  onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); },
  openWidget: (a, w) => { widgets.push({ a, w }); return true; }, closeWidget: () => true, sendPacket: () => {},
  display: (a) => ({ [VAMP]: 'Vamp', [LORD]: 'Lord', [MORTAL]: 'Mortal', [PRIEST]: 'Priest' }[a] || 'P'), who: String,
  isAdmin: () => false, findByName: () => null, onlineActors: () => ONLINE.slice(), every: (name, ms, fn) => timers.set(name, fn),
  profileOf: (a) => (a >= 0xff000000 ? -1 : a), nameOf: String, isWorldspace: () => true, needsFeed: () => {}, hungerOf: () => 0,
  cfg: extraCfg, hasUiCap: () => false, sourceResistsOf: () => new Set(),
  distanceMeters: () => 1,
  takeGold: (a, n) => { const g = goldOf(a); if (g < n) return false; put(a, 'inventory', { entries: [{ baseId: 0xf, count: g - n }] }); return true; },
  giveItem: () => true, depositToTreasury: (z, n) => n,
});
const widgets = [];
const goldOf = (a) => (((props.get(`${a}|inventory`) || { entries: [] }).entries.find((e) => e.baseId === 0xf)) || { count: 0 }).count;
const loadSuper = (vr) => {
  delete globalThis.__dboSuperState;
  mp.onHitDamageAttempt = () => true;
  delete require.cache[SUPER];
  require(SUPER)(baseApi({ supernatural: vr === undefined ? {} : { vampireRestoration: vr } }));
};
const hold = () => timers.get('vampHealHold')();

// The C++'s order: the gamemode hook first, then the heal it cannot refuse
const castHeal = async (caster, spell, add, onto) => {
  const refused = globalThis.__dboVampHealCast(caster, spell);
  if (add) setHp(onto || caster, Math.min(1, hp(onto || caster) + add));
  await tick();
  return refused;
};
const hitHeal = async (caster, target, spell, add) => {
  globalThis.__dboSuperSpellHit(caster, target, spell);
  if (add) setHp(target, Math.min(1, hp(target) + add));
  await tick();
};

(async () => {
  loadSuper();

  // ---- 2. a vampire's own healing --------------------------------------------------------------------------------
  setHp(VAMP, 0.4);
  ok((await castHeal(VAMP, SP.FastHealing, 0.3)) === true, "a vampire's Fast Healing is refused for the gameplay (no skill credit)");
  ok(near(hp(VAMP), 0.4), '...and the heal the C++ applied is taken back at once', hp(VAMP));
  ok(lines(VAMP).some((l) => /light of Arkay and Stendarr will not answer the undead/.test(l)), '...with the lore line', lines(VAMP));
  ok(near(props.get(`${VAMP}|percentages`).magicka, 0.5) && near(props.get(`${VAMP}|percentages`).stamina, 0.6), '...magicka and stamina untouched');
  const told = lines(VAMP).length;
  await castHeal(VAMP, SP.CloseWounds, 0.2);
  ok(near(hp(VAMP), 0.4) && lines(VAMP).length === told, 'a second try in the same breath: taken back, not told again', [hp(VAMP), lines(VAMP).length]);
  wallClock += 3000; hold();
  ok(!globalThis.__dboVampHealGuards.has(VAMP), 'the hold ends after holdMs');

  // A channel (Healing): the C++ heals the caster each second until the stop
  setHp(VAMP, 0.5);
  await castHeal(VAMP, SP.Healing, 0.03);
  ok(near(hp(VAMP), 0.5), "Healing's first tick taken back", hp(VAMP));
  for (let s = 1; s <= 6; s++) { wallClock += 1000; setHp(VAMP, hp(VAMP) + 0.03); hold(); }
  ok(near(hp(VAMP), 0.5), '...and six more seconds of the channel, each taken back', hp(VAMP));
  wallClock += 400; setHp(VAMP, 0.35); hold();
  ok(near(hp(VAMP), 0.35), 'a blow during the channel still lands', hp(VAMP));
  wallClock += 600; setHp(VAMP, 0.38); hold();
  ok(near(hp(VAMP), 0.35), '...and the next heal is held at the lower health', hp(VAMP));
  wallClock += 3000; hold(); wallClock += 3000; hold();
  ok(!globalThis.__dboVampHealGuards.has(VAMP), 'the channel hold ends once the heals stop');
  setHp(VAMP, 0.6); wallClock += 200; hold();
  ok(near(hp(VAMP), 0.6), 'after it, health rises freely again (a potion, regeneration)', hp(VAMP));

  // Vampire Lord
  setHp(LORD, 0.3);
  ok((await castHeal(LORD, SP.GrandHealing, 0.5)) === true && near(hp(LORD), 0.3), 'a Vampire Lord cannot heal either', hp(LORD));

  // ---- 3. healing on a vampire, and a vampire's healing on others ------------------------------------------------
  setHp(MORTAL, 0.5); setHp(VAMP, 0.5); wallClock += 60000; hold();
  ok((await castHeal(MORTAL, SP.HealOther, 0)) === false, "a mortal's Heal Other cast is not refused");
  await hitHeal(MORTAL, VAMP, SP.HealOther, 0.4);
  ok(near(hp(VAMP), 0.5), "Heal Other on a vampire mends nothing", hp(VAMP));
  ok(lines(MORTAL).filter((l) => l === 'Your healing finds nothing to mend in the undead.').length === 1, 'the caster is told', lines(MORTAL));
  await hitHeal(MORTAL, VAMP, SP.HealOther, 0.4);
  ok(near(hp(VAMP), 0.5) && lines(MORTAL).filter((l) => /nothing to mend/.test(l)).length === 1, '...once', lines(MORTAL));
  // Healing Hands (a beam): the channel's ticks after the beam found the vampire
  wallClock += 5000; hold();
  await hitHeal(PRIEST, VAMP, SP.HealingHands, 0.04);
  for (let s = 1; s <= 5; s++) { wallClock += 1000; setHp(VAMP, hp(VAMP) + 0.04); hold(); }
  ok(near(hp(VAMP), 0.5), "Healing Hands' channel on a vampire mends nothing", hp(VAMP));
  // Grand Healing's area share
  wallClock += 5000; hold(); wallClock += 5000; hold();
  setHp(LORD, 0.3);
  await hitHeal(PRIEST, LORD, SP.GrandHealing, 0.4);
  ok(near(hp(LORD), 0.3), "Grand Healing's area share does nothing for a Vampire Lord", hp(LORD));
  // A vampire's Heal Other on a mortal or an NPC
  setHp(MORTAL, 0.2); setHp(NPC, 0.2);
  ok((await castHeal(VAMP, SP.HealOther, 0)) === true, "a vampire's Heal Other is refused");
  ok(!globalThis.__dboVampHealGuards.has(VAMP) || near(hp(VAMP), 0.5), '...the caster is not held for a heal aimed at another');
  await hitHeal(VAMP, MORTAL, SP.HealOther, 0.5);
  await hitHeal(VAMP, NPC, SP.HealOther, 0.5);
  ok(near(hp(MORTAL), 0.2) && near(hp(NPC), 0.2), "...and it mends nobody", [hp(MORTAL), hp(NPC)]);
  // Mortals heal mortals as before
  wallClock += 60000; hold(); hold();
  setHp(MORTAL, 0.2); setHp(PRIEST, 0.3);
  ok((await castHeal(PRIEST, SP.FastHealing, 0.4)) === false && near(hp(PRIEST), 0.7), "a mortal's own heal is untouched", hp(PRIEST));
  await hitHeal(PRIEST, MORTAL, SP.HealOther, 0.4);
  wallClock += 200; hold();
  ok(near(hp(MORTAL), 0.6) && !globalThis.__dboVampHealGuards.size, "a mortal's Heal Other on a mortal heals", hp(MORTAL));
  // A fallen vampire (health 0) is never held
  setHp(DEADVAMP, 0);
  await hitHeal(PRIEST, DEADVAMP, SP.HealOther, 0);
  ok(!globalThis.__dboVampHealGuards.has(DEADVAMP), 'a fallen vampire is not held (the down state decides)');
  // downed.js: healing magic raises no fallen vampire, and a vampire's raises nobody; the Draught is not a spell
  ok(globalThis.__dboVampHealBlocks(PRIEST, DEADVAMP, SP.HealOther) === true, 'a Priest cannot raise a fallen vampire with Heal Other');
  ok(globalThis.__dboVampHealBlocks(VAMP, MORTAL, SP.GrandHealing) === true, "a vampire's Grand Healing raises no one");
  ok(globalThis.__dboVampHealBlocks(PRIEST, MORTAL, SP.HealOther) === false, 'a mortal priest still raises a mortal');

  // ---- 4. the spells against the undead still harm --------------------------------------------------------------
  wallClock += 60000; hold();
  const before = said.length;
  const damageMult = (src) => globalThis.__dboSuperDamageMult(PRIEST, VAMP, src);
  const harmNames = ['TurnUndead', 'BaneoftheUndead', 'DLC1SunFire', 'DLC1VampiresBane', 'DLC1StendarrsAura', 'DLC1SunCloakDmg', 'RepelUndead', 'TurnGreaterUndead'];
  const multsOn = Object.fromEntries(harmNames.map((n) => [n, damageMult(SP[n])]));
  for (const n of harmNames) {
    setHp(VAMP, 0.8);
    ok((await castHeal(PRIEST, SP[n], 0)) === false, `${n} cast by a priest is not refused`);
    ok((await castHeal(VAMP, SP[n], 0)) === false, `...nor by a vampire (it is not healing)`);
    await hitHeal(PRIEST, VAMP, SP[n], -0.3);   // the C++ applies the spell's harm
    wallClock += 200; hold();
    ok(near(hp(VAMP), 0.5), `${n} still harms a vampire, and the harm stays`, hp(VAMP));
    ok(!globalThis.__dboVampHealGuards.has(VAMP), `...and puts no hold on them`);
    ok(globalThis.__dboVampHealRefusal(VAMP, SP[n]) === null, `...and a vampire may still learn ${n}`);
  }
  ok(said.length === before, 'no healing line for any of them', said.slice(before));
  // The Guardian Circle's hazard heals the living and turns the undead: on a vampire the heal is held, the harm lands
  setHp(VAMP, 0.8);
  await hitHeal(PRIEST, VAMP, SP.HazardGuardianCircleSpell, 0.1);
  ok(near(hp(VAMP), 0.8), "the Guardian Circle's heal does nothing for a vampire", hp(VAMP));
  wallClock += 100; setHp(VAMP, 0.6); hold();
  ok(near(hp(VAMP), 0.6), '...and harm in the circle still lands', hp(VAMP));
  // The damage multipliers of the anti-undead spells are the same with the rule off
  loadSuper({ enabled: false });
  ok(harmNames.every((n) => damageMult(SP[n]) === multsOn[n]), 'their damage on a vampire is the same with the rule off', multsOn);

  // ---- 5. off: everything as before -----------------------------------------------------------------------------
  wallClock += 60000; hold();
  setHp(VAMP, 0.4);
  ok((await castHeal(VAMP, SP.FastHealing, 0.3)) === false && near(hp(VAMP), 0.7), 'enabled false: a vampire heals', hp(VAMP));
  await hitHeal(MORTAL, VAMP, SP.HealOther, 0.2);
  ok(near(hp(VAMP), 0.9), '...and is healed by others', hp(VAMP));
  ok(globalThis.__dboVampHealRefusal(VAMP, SP.Healing) === null && globalThis.__dboVampHealBlocks(PRIEST, DEADVAMP, SP.HealOther) === false, '...and may learn and be raised by healing');
  // The config as shipped turns it on
  const shipped = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8')).supernatural;
  ok(shipped.vampireRestoration && shipped.vampireRestoration.enabled === true, 'gamemode-config.json ships it on');
  loadSuper(shipped.vampireRestoration);

  // A hot reload keeps a running hold (the map lives on globalThis)
  setHp(VAMP, 0.4);
  await castHeal(VAMP, SP.Healing, 0.03);
  loadSuper(shipped.vampireRestoration);
  wallClock += 1000; setHp(VAMP, 0.43); hold();
  ok(near(hp(VAMP), 0.4), 'a hold survives a hot reload', hp(VAMP));
  wallClock += 60000; hold();

  // ---- 6. tomes, the shop and lessons (spells.js) ---------------------------------------------------------------
  const SYNOD = '20ff:BSHeartland.esm';
  const mastery = (a, skills) => put(a, 'private.mastery', { v: 2, skills: Object.fromEntries(Object.entries(skills).map(([k, rank]) => [k, { level: rank * 25, xp: 0, rank }])), order: Object.keys(skills) });
  for (const a of [VAMP, MORTAL, PRIEST]) { put(a, 'worldOrCellDesc', SYNOD); put(a, 'pos', [0, 0, 0]); put(a, 'private.dboGuilds', [{ id: 'synod', role: 'member' }]); put(a, 'inventory', { entries: [{ baseId: 0xf, count: 100000 }] }); }
  mastery(VAMP, { priest: 2 }); mastery(MORTAL, { priest: 2 }); mastery(PRIEST, { priest: 4 });
  mp.onReadBook = () => undefined;
  delete require.cache[SPELLS];
  require(SPELLS)(Object.assign(baseApi({ spells: { shopStock: 999 } }), { log: () => {} }));
  const tome = (n) => canon(JSON.parse(fs.readFileSync('spell-tomes.json', 'utf8')).tomes.find((t) => t.name === n).id);
  const n0 = lines(VAMP).length;
  ok(mp.onReadBook(VAMP, tome('SpellTomeFastHealing')) === false, 'a vampire cannot read a healing tome');
  ok(/The words will not settle: the light of Arkay and Stendarr will not pass into undead hands\. You keep the tome\./.test(lines(VAMP)[n0]), '...told why, and keeps the tome', lines(VAMP)[n0]);
  ok(mp.onReadBook(VAMP, tome('SpellTomeHealOther')) === false && !known(VAMP).has(SP.HealOther), '...Heal Other neither');
  const m0 = lines(MORTAL).length;
  mp.onReadBook(MORTAL, tome('SpellTomeFastHealing'));
  ok(!lines(MORTAL).slice(m0).some((l) => /undead/.test(l)), 'a mortal is not refused for being undead', lines(MORTAL).slice(m0));
  const v0 = lines(VAMP).length;
  mp.onReadBook(VAMP, tome('SpellTomeTurnLesserUndead'));
  ok(!lines(VAMP).slice(v0).some((l) => /undead hands/.test(l)), 'a vampire reading Turn Lesser Undead is judged as anyone (not the healing rule)', lines(VAMP).slice(v0));
  // The shop: a vampire's shelf holds no healing tome; a buy of one is refused
  const ui = (ev, a, args) => (handlers.get(ev) || []).forEach((fn) => fn(a, args || [], 44));
  const lastShop = (a) => { const w = widgets.filter((x) => x.a === a && x.w.type === 'tomeShop').pop(); return w ? w.w : null; };
  globalThis.__dboTomeShopOpen && globalThis.__dboTomeShopOpen(VAMP);
  if (!lastShop(VAMP) && commands.get('tomes')) commands.get('tomes').fn(VAMP, '');
  if (!lastShop(MORTAL) && commands.get('tomes')) commands.get('tomes').fn(MORTAL, '');
  const vshop = lastShop(VAMP), mshop = lastShop(MORTAL);
  const healTomes = new Set(JSON.parse(fs.readFileSync('spell-tomes.json', 'utf8')).tomes.filter((t) => healIds.has(t.spellId)).map((t) => descOf(canon(t.id))));
  ok(!!vshop && !!mshop, 'both open the tome shop', [!!vshop, !!mshop]);
  ok(mshop && mshop.tomes.some((t) => healTomes.has(t.id)), "a mortal priest's shelf has healing tomes", mshop && mshop.tomes.map((t) => t.spell));
  ok(vshop && vshop.tomes.length > 0 && !vshop.tomes.some((t) => healTomes.has(t.id)), "a vampire's shelf has none, and still has others", vshop && vshop.tomes.map((t) => t.spell));
  ui('tomeBuy', VAMP, [vshop.nonce, descOf(tome('SpellTomeFastHealing'))]);
  const after = lastShop(VAMP);
  ok(after.resultKind === 'refused' && /undead hands/.test(after.result) && goldOf(VAMP) === 100000, 'a buy of a healing tome is refused, gold kept', after.result);
  // A lesson: a Master priest cannot teach a vampire Heal Other (Adept), and can teach a mortal
  known(PRIEST).add(SP.HealOther);
  commands.get('teach').fn(PRIEST, '');
  ui('spellsChoose', PRIEST, [`student:${VAMP.toString(16)}`]);
  ui('spellsChoose', PRIEST, [`lesson:${VAMP.toString(16)}:${descOf(SP.HealOther)}`]);
  ok(/Heal Other will not take in Vamp: the light of Arkay and Stendarr will not pass into undead hands\./.test(lines(PRIEST).slice(-1)[0] || ''), 'a vampire cannot be taught Heal Other', lines(PRIEST).slice(-1));
  commands.get('teach').fn(PRIEST, '');
  ui('spellsChoose', PRIEST, [`student:${MORTAL.toString(16)}`]);
  ui('spellsChoose', PRIEST, [`lesson:${MORTAL.toString(16)}:${descOf(SP.HealOther)}`]);
  ok(widgets.some((x) => x.a === MORTAL && /offers to teach you/.test(x.w.targetName || '')), 'a mortal can', lines(PRIEST).slice(-1));
  // A vampire who already knows a healing spell keeps it (nothing removes it)
  known(VAMP).add(SP.Healing);
  globalThis.__dboVampHealCast(VAMP, SP.Healing);
  ok(known(VAMP).has(SP.Healing), 'a healing spell a vampire already knows is not taken away');

  // ---- the wiring: gamemode.js refuses the cast for the chain (no skill or school credit); downed.js asks before a raise
  const GM = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
  const castHook = GM.slice(GM.indexOf('const castHook = '), GM.indexOf('castHook.__dbo = true;'));
  ok(/__dboVampHealCast\(Number\(casterId\) >>> 0, Number\(spellId\) >>> 0\)\) return false;/.test(castHook)
    && castHook.indexOf('__dboVampHealCast') < castHook.indexOf('globalThis.__dboPrevCast'), "gamemode.js's cast hook refuses a vampire's heal before the chain (mastery, schools)");
  ok(/__dboSuperSpellHit\(/.test(GM.slice(GM.indexOf('const spellHitHook = '), GM.indexOf('spellHitHook.__dbo = true;'))), "gamemode.js's spell hit hook reaches supernatural.js");
  const DOWNED = fs.readFileSync(path.join(SERVER, 'downed.js'), 'utf8');
  ok((DOWNED.match(/!undeadHeal\(caster, t, spell\)\) revive\(|!undeadHeal\(caster, t, spell\)\) \{ log\(`downed: \$\{display\(caster\)\} healing reached/g) || []).length === 3, 'downed.js asks before each of its three healing raises');

  // ---- 7. the patch note ----------------------------------------------------------------------------------------
  const notes = JSON.parse(fs.readFileSync(path.join(SERVER, 'patch-notes.json'), 'utf8'));
  const note = notes.find((x) => JSON.stringify(x).includes("Vampires cannot use Restoration's healing spells"));
  ok(!!note && JSON.stringify(note).includes("Restoration's spells against the undead still burn them."), 'the patch note is there', note);

  console.log(`${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.stack); process.exit(1); });
