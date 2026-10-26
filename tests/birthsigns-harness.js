// Scripted test for the birthsigns (birthsigns.js, Nat 25 Oct; design _work\birthsigns-design-1025.md): each sign's
// gifts through racial.js's real hooks with a race on top, under racial's caps; nothing in a beast form, for an NPC or with
// racial off; the forced choice (creation step, confirm, close and come back, the guards that keep it away, a menu that
// cannot be sent never holds anyone); /birthsign and the staff set/clear with its audit; the gamemode.js, charlevel.js and
// skillrates.js wiring; the patch note. The mock records and readers are racial-overhaul-harness.js's.
//   node tests/birthsigns-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
const near = (x, y) => Math.abs(x - y) < 1e-9;

// ---- records ----
const u32le = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const f32le = (x) => { const b = Buffer.alloc(4); b.writeFloatLE(x); return [...b]; };
const WEAP = (anim) => ({ record: { type: 'WEAP', fields: [{ type: 'DNAM', data: Uint8Array.from([anim, 0, 0, 0]) }] } });
const MGEF = (resist) => { const d = new Array(152).fill(0); u32le(resist >>> 0).forEach((b, i) => { d[16 + i] = b; }); return { record: { type: 'MGEF', fields: [{ type: 'DATA', data: Uint8Array.from(d) }] } }; };
const withEffects = (type, ...mgefs) => ({ record: { type, fields: mgefs.flatMap((m) => [{ type: 'EFID', data: Uint8Array.from(u32le(m)) }, { type: 'EFIT', data: Uint8Array.from(new Array(12).fill(0)) }]) } });
const RACE = (unarmed) => { const d = new Array(128).fill(0); [[84, 0.7], [88, 3], [92, 5], [96, unarmed]].forEach(([at, v]) => f32le(v).forEach((b, i) => { d[at + i] = b; })); return { record: { type: 'RACE', fields: [{ type: 'DATA', data: Uint8Array.from(d) }] } }; };
const { RACE_IDS } = require(path.join(SERVER, 'racial.js'));
const records = {
  0x100: WEAP(1), 0x101: WEAP(5), 0x102: WEAP(7),
  0x301: MGEF(41), 0x302: MGEF(43), 0x303: MGEF(42), 0x304: MGEF(40),
  0x210: withEffects('SPEL', 0x301), 0x211: withEffects('SPEL', 0x302), 0x212: withEffects('SPEL', 0x303), 0x213: withEffects('SPEL', 0x304),
  0x3c: { record: { type: 'WRLD', fields: [] } },
};
for (const [race, ids] of Object.entries(RACE_IDS)) for (const id of ids) records[id] = RACE(race === 'khajiit' || race === 'argonian' ? 10 : 4);
const SWORD = 0x100, BOW = 0x102, FIST = 0x1f4, FLAMES = 0x210, SPARKS = 0x212, POISON = 0x213;
const recordOf = (id) => records[id >>> 0] || null;

const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
const a0 = gm.indexOf('const BLESS_COMBAT'), b0 = gm.indexOf('// The server\'s hit formula counts only');
const state = {};
const mp = {
  get: (id, k) => {
    const s = state[id] || {};
    if (k === 'appearance') return s.race ? { raceId: s.race } : (s.noLook ? null : { raceId: 0 });
    if (k === 'private.beast') return s.beast || null;
    if (k === 'percentages') return s.pc;
    if (k === 'worldOrCellDesc') return s.desc || '3c:Skyrim.esm';
    if (k === 'pos') return [0, 0, 0];
    return (s.props || {})[k];
  },
  set: (id, k, v) => { state[id] = state[id] || {}; if (k === 'percentages') state[id].pc = v; else { state[id].props = state[id].props || {}; state[id].props[k] = v; } },
  getIdFromDesc: (d) => ({ '3c:Skyrim.esm': 0x3c })[d] || 0,
  getServerSettings: () => ({}),
  findFormsByPropertyValue: (k, v) => Object.keys(state).map(Number).filter((a) => k === 'private.indexed.tagKey' && ((state[a].props || {})[k] === v)),
};
const G = new Function('mp', 'recordOf', 'cfg', gm.slice(a0, b0) + '\nreturn { sourceResistsOf, weaponHandsOf };')(mp, recordOf, {});

// ---- the modules ----
const given = [], told = [], audits = [], widgets = [], closed = [];
const ui = new Map();
let staffLead = new Set(), guardNo = '', widgetOk = true;
// 'actor:cap' pairs the client's UI named (gamemode.js hasUiCap); capThrows: a cap read that fails
const caps = new Set(); let capThrows = false;
const make = (racialCfg) => require(path.join(SERVER, 'racial.js'))({
  mp, log: () => {}, personal: (a, t) => told.push([a, t]), display: (a) => String(a), recordOf,
  giveItem: (a, base, n) => { given.push([a, base, n]); return true; }, profileOf: (a) => (a < 1000 ? a : -1),
  every: () => {}, onlineActors: () => Object.keys(state).map(Number).filter((a) => a < 1000 && (state[a].props || {}).isOnline !== false),
  weaponHandsOf: G.weaponHandsOf, sourceResistsOf: G.sourceResistsOf, cfg: { racial: racialCfg },
});
const commands = new Map();
const BS_JS = path.join(SERVER, 'birthsigns.js');
let tickers = new Map();
const loadSigns = (bsCfg) => { delete require.cache[BS_JS]; globalThis.__dboBirthsignState = undefined; return require(BS_JS)({
  mp, log: () => {}, personal: (a, t) => told.push([a, t]), audit: (t) => audits.push(t), who: (a) => `P${a} #T${a} (profile ${a})`, display: (a) => `P${a} #T${a}`,
  cfg: { birthsigns: bsCfg }, openWidget: (a, w, f) => { if (!widgetOk) return false; widgets.push([a, w, f]); return true; }, closeWidget: (a, id) => closed.push([a, id]),
  onUi: (ev, fn) => ui.set(ev, fn), registerChatCommand: (n, fn) => commands.set(n, fn), onlineActors: () => Object.keys(state).map(Number).filter((a) => a < 1000 && (state[a].props || {}).isOnline !== false),
  every: (name, ms, fn) => tickers.set(name, fn), isLeadStaff: (a) => staffLead.has(a), findByName: (q) => { const n = Number(String(q).replace(/^p/i, '')); return state[n] && (state[n].props || {}).isOnline !== false ? n : 0; },
  profileOf: (a) => (a < 1000 ? a : -1), hasUiCap: (a, cap) => { if (capThrows) throw new Error('caps'); return caps.has(`${a}:${cap}`); },
}); };
globalThis.__dboStaffGuard = { target: () => guardNo };

const race = (id, name, pc) => { state[id] = { race: name ? RACE_IDS[name][0] : 0, pc: pc || { health: 1, magicka: 1, stamina: 1 }, props: {} }; };
const sign = (id, s) => { state[id].props['private.dboBirthsign'] = s ? { id: s, at: 1, by: 'self' } : null; };
const NPC = 1001; state[NPC] = { pc: { health: 1, magicka: 1, stamina: 1 }, props: { 'private.dboBirthsign': { id: 'shadow', at: 1, by: 'self' } } };

const BS = loadSigns({});
// racial's globals (__dboRaceVitalBonus, __dboRaceSkillRate) are the last module's: the live one is made last
const ROFF = make({ enabled: false });
const R = make({ enabled: true, overhaul: true });

// ---- 1. the thirteen, as designed ----
const D = BS.describe;
const S = BS.config.signs;
check('thirteen signs, in the design\'s order', JSON.stringify(Object.keys(S)) === JSON.stringify(['warrior', 'mage', 'thief', 'lady', 'lord', 'steed', 'apprentice', 'atronach', 'ritual', 'lover', 'shadow', 'serpent', 'tower']));
const WANT = {
  warrior: 'Blade, Blunt, Martial Arts and Defense learn 10% faster',
  mage: 'Arcane Arts and Enchanter learn 10% faster',
  thief: 'Archery learns 10% faster; 5% more gold from loot and contract pay',
  lady: 'Health and stamina regenerate 7% faster',
  lord: 'Health regenerates 10% faster; fire hurts 5% more; weapons and fists hurt 5% less',
  steed: 'Stamina regenerates 10% faster; +50 carry weight',
  apprentice: 'Magicka regenerates 15% faster; spells hurt 5% more',
  atronach: '+25 maximum magicka; magicka regenerates 10% slower; spells hurt 5% less',
  ritual: 'Priest learns 10% faster; health regenerates 15% faster below 30% health',
  lover: 'Every skill learns 5% faster',
  shadow: 'Sneak attacks deal 15% more',
  serpent: 'Alchemist learns 10% faster; poison hurts 15% less',
  tower: 'Lockpicking learns 15% faster',
};
for (const [id, text] of Object.entries(WANT)) check(`${S[id].name}: the menu says "${text}"`, D(S[id]) === text, D(S[id]));

// ---- 2. each sign through racial's hooks, alone and with a race, under the caps ----
const P0 = 1, NORD = 2, ALTMER = 3, REDGUARD = 4, DUNMER = 5, BRETON = 6, ARGONIAN = 7, ORC = 8, IMPERIAL = 9, KHAJIIT = 10, BOSMER = 11;
race(P0, null); race(NORD, 'nord'); race(ALTMER, 'altmer'); race(REDGUARD, 'redguard'); race(DUNMER, 'dunmer'); race(BRETON, 'breton');
race(ARGONIAN, 'argonian'); race(ORC, 'orc'); race(IMPERIAL, 'imperial'); race(KHAJIIT, 'khajiit'); race(BOSMER, 'bosmer');
const all = [P0, NORD, ALTMER, REDGUARD, DUNMER, BRETON, ARGONIAN, ORC, IMPERIAL, KHAJIIT, BOSMER];
const signAll = (s) => all.forEach((a) => sign(a, s));
const XP = (a, sk) => R.skillRate(a, sk, 'hit');

signAll(null);
check('no sign: every hook as the race alone (a plain player x1, a Nord blade x1.15)', XP(P0, 'blade') === 1 && near(XP(NORD, 'blade'), 1.15) && R.regenFactor(P0, 'health') === 1 && R.attackMult(P0, NPC, SWORD, 10, { sneak: true }) === 1 && R.targetMult(NPC, P0, FLAMES) === 1);

signAll('warrior');
check('Warrior: Blade, Blunt, Martial Arts, Defense x1.10; Archery x1', ['blade', 'blunt', 'unarmed', 'defense'].every((k) => near(XP(P0, k), 1.1)) && XP(P0, 'archery') === 1);
check('Warrior Nord: blade x1.15 x1.10 (an XP rate has no cap: the mastery caps meter the work)', near(XP(NORD, 'blade'), 1.15 * 1.1));
check('...never for a staff award', R.skillRate(P0, 'blade', 'award') === 1 && R.skillRate(NORD, 'blade', 'award') === 1);

signAll('mage');
check('Mage: Arcane Arts and Enchanter x1.10; an Altmer\'s arcane x1.15 x1.10', near(XP(P0, 'arcane'), 1.1) && near(XP(P0, 'enchanter'), 1.1) && near(XP(ALTMER, 'arcane'), 1.265) && XP(P0, 'blade') === 1);

signAll('thief');
check('Thief: Archery x1.10, a Bosmer\'s x1.15 x1.10', near(XP(P0, 'archery'), 1.1) && near(XP(BOSMER, 'archery'), 1.265));
given.length = 0; told.length = 0;
const g1 = R.goldBonus(P0, 100, 'test'), g2 = R.goldBonus(IMPERIAL, 100, 'test');
check('Thief: 5 more gold on 100; a Thief Imperial 15 (the shares add)', g1 === 5 && g2 === 15 && given.length === 2 && given[1][2] === 15, [g1, g2]);
check('...told by name: "The Thief", and "Imperial Luck and The Thief"', told.some(([a, t]) => a === P0 && /^The Thief: 5 more gold\.$/.test(t)) && told.some(([a, t]) => a === IMPERIAL && /^Imperial Luck and The Thief: 15 more gold\.$/.test(t)), told);
signAll('lady'); given.length = 0;
check('no Thief: a plain player gets no gold, an Imperial his 10', R.goldBonus(P0, 100) === 0 && R.goldBonus(IMPERIAL, 100) === 10);

check('Lady: health and stamina x1.07, magicka x1 (Nat, 26 Oct: smaller, as she does both)', near(R.regenFactor(P0, 'health'), 1.07) && near(R.regenFactor(P0, 'stamina'), 1.07) && R.regenFactor(P0, 'magicka') === 1);
check('Lady Redguard: stamina 1.25 x 1.10 capped at alwaysRegenCap 1.25', near(R.regenFactor(REDGUARD, 'stamina'), 1.25), R.regenFactor(REDGUARD, 'stamina'));

signAll('lord');
check('Lord: health x1.10; fire hurts 5% more, frost not; a sword or a fist 5% less, a spell not (Nat, 26 Oct: his own niche)', near(R.regenFactor(P0, 'health'), 1.1) && near(R.targetMult(NPC, P0, FLAMES), 1.05) && R.targetMult(NPC, P0, 0x211) === 1
  && near(R.targetMult(NPC, P0, SWORD), 0.95) && near(R.targetMult(NPC, P0, FIST), 0.95) && R.targetMult(NPC, P0, SPARKS) === 1, [R.targetMult(NPC, P0, SWORD), R.targetMult(NPC, P0, FIST), R.targetMult(NPC, P0, SPARKS)]);
check('Lord against a player: a sword 2.5% less (the PvP half)', near(R.targetMult(NORD, P0, SWORD), 0.975), R.targetMult(NORD, P0, SWORD));
globalThis.__dboRacialState.pvpAt.clear(); // that player hit opened a PvP fight; the PvE checks below start outside one
check('Lord Dunmer: fire 0.5 x 1.05', near(R.targetMult(NPC, DUNMER, FLAMES), 0.525), R.targetMult(NPC, DUNMER, FLAMES));

signAll('steed');
check('Steed: stamina x1.10 only', near(R.regenFactor(P0, 'stamina'), 1.1) && R.regenFactor(P0, 'health') === 1 && R.regenFactor(P0, 'magicka') === 1);

signAll('apprentice');
check('Apprentice: magicka x1.15; a spell hurts 5% more, a sword not', near(R.regenFactor(P0, 'magicka'), 1.15) && near(R.targetMult(NPC, P0, SPARKS), 1.05) && R.targetMult(NPC, P0, SWORD) === 1);
check('Apprentice Altmer: magicka 1.25 x 1.15 capped at 1.25', near(R.regenFactor(ALTMER, 'magicka'), 1.25));

signAll('atronach');
check('Atronach: magicka x0.90 (slower), a spell hurts 5% less', near(R.regenFactor(P0, 'magicka'), 0.9) && near(R.targetMult(NPC, P0, SPARKS), 0.95));
check('Atronach Altmer: the cap first, then the slowing (1.25 x 0.90)', near(R.regenFactor(ALTMER, 'magicka'), 1.125), R.regenFactor(ALTMER, 'magicka'));
check('Atronach Breton: magic 25% off, then 5% more off (0.75 x 0.95)', near(R.targetMult(NPC, BRETON, SPARKS), 0.7125), R.targetMult(NPC, BRETON, SPARKS));
check('reductionCap still holds every reduction together: 0.1 x the Breton Atronach -> 0.25', near(R.capTargetSide(0.1 * R.targetMult(NPC, BRETON, SPARKS)), 0.25));
check('Atronach: +25 maximum magicka through the race\'s vital bonus; a Lady none', JSON.stringify(globalThis.__dboRaceVitalBonus(P0)) === '{"health":0,"magicka":25,"stamina":0}'
  && (() => { sign(P0, 'lady'); const v = globalThis.__dboRaceVitalBonus(P0); sign(P0, 'atronach'); return v.magicka === 0; })());
check('Atronach: the slower magicka is taken back (extraPerSecond is negative), a full bar is left alone', R.extraPerSecond(P0, 'magicka') < 0 && R.extraPerSecond(P0, 'magicka', 1) === 0);
// the regeneration tick takes the share off a fresh report instead of adding it
for (const a of all) if (a !== P0) state[a].props.isOnline = false;
globalThis.__dboRacialState.owed.delete(P0);
// the client reports a refilling bar four times a second; the server takes the slowed share off now and then
let taken = 0, reported = 0.5;
const tStart = Date.now();
for (let i = 0; i < 40; i++) {
  reported = Math.min(0.99, reported + 0.0075);
  state[P0].pc = { health: 1, magicka: reported, stamina: 1 };
  R.regenTick(tStart + i * 250);
  if (state[P0].pc.magicka < reported) { taken += reported - state[P0].pc.magicka; reported = state[P0].pc.magicka; }
}
check('...the tick takes about a tenth of the bar\'s own refill back over 10 s (own 0.03/s: 0.03 of it)', taken > 0.015 && taken < 0.04, taken);
state[P0].pc = { health: 1, magicka: 1, stamina: 1 };
R.regenTick(Date.now());
check('...and never below a full bar\'s report: a full bar is not touched', state[P0].pc.magicka === 1);
for (const a of all) delete state[a].props.isOnline;

signAll('ritual');
check('Ritual: Priest x1.10; health x1 at half health', near(XP(P0, 'priest'), 1.1) && (() => { state[P0].pc = { health: 0.5, magicka: 1, stamina: 1 }; return R.regenFactor(P0, 'health') === 1; })());
check('Ritual: health x1.15 below 30%', (() => { state[P0].pc = { health: 0.2, magicka: 1, stamina: 1 }; return near(R.regenFactor(P0, 'health'), 1.15); })());
check('Ritual Argonian below 30%: 1.5 x 1.15 capped at conditionalRegenCap 1.5', (() => { state[ARGONIAN].pc = { health: 0.2, magicka: 1, stamina: 1 }; return near(R.regenFactor(ARGONIAN, 'health'), 1.5); })());
state[P0].pc = state[ARGONIAN].pc = { health: 1, magicka: 1, stamina: 1 };

signAll('lover');
check('Lover: every skill x1.05; a Nord\'s blade x1.15 x1.05', ['blade', 'cook', 'lockpicking', 'arcane'].every((k) => near(XP(P0, k), 1.05)) && near(XP(NORD, 'blade'), 1.15 * 1.05));

signAll('shadow');
check('Shadow: a sneak attack +15%, a plain hit and a sneaking spell not', near(R.attackMult(P0, NPC, SWORD, 10, { sneak: true }), 1.15) && R.attackMult(P0, NPC, SWORD, 10, {}) === 1 && R.attackMult(P0, NPC, SWORD, 10) === 1 && R.attackMult(P0, NPC, FLAMES, 10, { sneak: true, spell: true }) === 1);
check('Shadow Orc below 30%: melee 1.2 x the sneak 1.15', (() => { state[ORC].pc = { health: 0.2, magicka: 1, stamina: 1 }; const m = R.attackMult(ORC, NPC, SWORD, 10, { sneak: true }); state[ORC].pc = { health: 1, magicka: 1, stamina: 1 }; return near(m, 1.2 * 1.15); })());
check('Shadow: no damage, no gift (dmg 0); never on one\'s self', R.attackMult(P0, NPC, SWORD, 0, { sneak: true }) === 1 && R.attackMult(P0, P0, SWORD, 10, { sneak: true }) === 1);

signAll('serpent');
check('Serpent: poison hurts 15% less, Alchemist x1.10', near(R.targetMult(NPC, P0, POISON), 0.85) && near(XP(P0, 'alchemist'), 1.1) && R.targetMult(NPC, P0, FLAMES) === 1);
check('Serpent Argonian: poison 0.5 x 0.85', near(R.targetMult(NPC, ARGONIAN, POISON), 0.425));

// ---- 2b. against players (Nat, 26 Oct: "Rebalance the birthsigns for PvP"; config birthsigns.pvp, defaults below) ----
// sneakDamage 0: the Shadow's sneak bonus is PvE's alone; takenShare 0.5: half a sign's damage-taken modifier when the attacker
// is a player; regenShare 0.5: half a sign's regen bonus (never its slowing) for 10 s after a hit between players
{
  const PV = globalThis.__dboBirthsignPvp();
  check('the PvP defaults: no sneak share, half the taken and regen shares, a 10 s fight', PV.sneakDamage === 0 && PV.takenShare === 0.5 && PV.regenShare === 0.5 && PV.fightSeconds === 10, PV);
  signAll('shadow');
  check('Shadow on a player: no sneak bonus; on an NPC still +15%', R.attackMult(P0, NORD, SWORD, 10, { sneak: true }) === 1 && near(R.attackMult(P0, NPC, SWORD, 10, { sneak: true }), 1.15), [R.attackMult(P0, NORD, SWORD, 10, { sneak: true }), R.attackMult(P0, NPC, SWORD, 10, { sneak: true })]);
  signAll('atronach');
  check('Atronach: a player\'s spell 2.5% less, an NPC\'s 5% less', near(R.targetMult(NORD, P0, SPARKS), 0.975) && near(R.targetMult(NPC, P0, SPARKS), 0.95), [R.targetMult(NORD, P0, SPARKS), R.targetMult(NPC, P0, SPARKS)]);
  signAll('serpent');
  check('Serpent: a player\'s poison 7.5% less, an NPC\'s 15% less', near(R.targetMult(NORD, P0, POISON), 0.925) && near(R.targetMult(NPC, P0, POISON), 0.85));
  signAll('lord');
  check('Lord: a player\'s fire 2.5% more (the weakness halves too), an NPC\'s 5% more', near(R.targetMult(NORD, P0, FLAMES), 1.025) && near(R.targetMult(NPC, P0, FLAMES), 1.05));
  signAll('lady');
  const L = 41; race(L); sign(L, 'lady');
  check('Lady out of a fight: health x1.07', near(R.regenFactor(L, 'health'), 1.07));
  R.attackMult(NPC, L, SWORD, 10, {});
  check('...a hit from an NPC is no PvP fight: still x1.07', near(R.regenFactor(L, 'health'), 1.07));
  R.attackMult(NORD, L, SWORD, 10, {});
  check('...hit by a player: x1.035 for the fight', near(R.regenFactor(L, 'health'), 1.035), R.regenFactor(L, 'health'));
  const A = 42; race(A); sign(A, 'atronach'); R.attackMult(NORD, A, SWORD, 10, {});
  check('...the Atronach\'s slower magicka is never eased in a fight: x0.90', near(R.regenFactor(A, 'magicka'), 0.9));
  globalThis.__dboRacialState.pvpAt.set(L, Date.now() - 11000);
  check('...and back to x1.07 once 10 s pass without a player hit', near(R.regenFactor(L, 'health'), 1.07));
}
signAll('tower');
check('Tower: Lockpicking x1.15 only', near(XP(P0, 'lockpicking'), 1.15) && XP(P0, 'blade') === 1);

// ---- 3. who a sign never reaches ----
signAll('lady');
state[P0].beast = { form: 'werewolf' };
check('beast form: no sign (regen, XP, hits taken and given, gold, vitals)', R.signOf(P0) === null && R.regenFactor(P0, 'health') === 1 && R.skillRate(P0, 'blade', 'hit') === 1
  && (() => { sign(P0, 'shadow'); const a = R.attackMult(P0, NPC, SWORD, 10, { sneak: true }); sign(P0, 'serpent'); const t = R.targetMult(NPC, P0, POISON); sign(P0, 'thief'); const g = R.goldBonus(P0, 100); sign(P0, 'atronach'); const v = globalThis.__dboRaceVitalBonus(P0).magicka; return a === 1 && t === 1 && g === 0 && v === 0; })());
delete state[P0].beast;
check('...and back again after it', R.signOf(P0) && R.signOf(P0).id === 'atronach');
check('an NPC carrying the property gets nothing', R.signOf(NPC) === null && R.attackMult(NPC, P0, SWORD, 10, { sneak: true }) === 1);
check('racial off: no sign either', ROFF.signOf(P0) === null && ROFF.regenFactor(P0, 'magicka') === 1);
const BSOFF = loadSigns({ enabled: false });
check('birthsigns off: racial sees none', R.signOf(P0) === null && R.regenFactor(P0, 'magicka') === 1);
loadSigns({});
check('an unknown sign id on a character is no sign', (() => { state[P0].props['private.dboBirthsign'] = { id: 'dragon' }; return R.signOf(P0) === null; })());

// skillrates.js multiplies its own rate by racial's
delete require.cache[path.join(SERVER, 'skillrates.js')];
require(path.join(SERVER, 'skillrates.js'))({ log: () => {}, cfg: { skillRates: { rates: { blade: 2 } } }, recordOf, fieldsOf: () => [], inBeastForm: () => false });
sign(NORD, 'warrior');
check('skillrates.js: a Warrior Nord swinging a blade at rate 2 earns x2.53', near(globalThis.__dboSkillRate(NORD, 'blade', 'hit'), 2 * 1.15 * 1.1), globalThis.__dboSkillRate(NORD, 'blade', 'hit'));

// ---- 4. the forced choice ----
let B = loadSigns({});
const NEW = 50; race(NEW, 'nord');
const stepDone = [];
globalThis.__dboBirthsignStepDone = (a) => stepDone.push(a);
const fire = (ev, a, ...args) => ui.get(ev)(a, args);
const last = () => widgets[widgets.length - 1];
widgets.length = 0;
check('creation: the step opens the menu, focused, thirteen rows and no Not yet', globalThis.__dboBirthsignCreationOpen(NEW) === true && last()[0] === NEW && last()[2] === true
  && last()[1].type === 'contextMenu' && last()[1].id === 163 && last()[1].actions.length === 13 && !last()[1].actions.some((x) => /not yet/i.test(x.label)), last());
check('...the rows carry the gifts ("The Warrior: Blade, Blunt, ...")', last()[1].actions[0].label === 'The Warrior: Blade, Blunt, Martial Arts and Defense learn 10% faster' && last()[1].events.action === 'dbo:birthsignChoose');
check('...and the character is held in the hub', globalThis.__dboBirthsignHold(NEW) === true);
const n0 = widgets.length;
check('asked again while it is up (leaveRealm): no second menu, still at the step', globalThis.__dboBirthsignCreationOpen(NEW) === true && widgets.length === n0);
fire('birthsignChoose', NEW, 'lady');
check('a pick asks to confirm, for life', /^The Lady, for life: Health and stamina regenerate 7% faster\. Only staff can change it later\.$/.test(last()[1].targetName) && last()[1].actions.map((x) => x.id).join() === 'confirm,back', last()[1]);
fire('birthsignChoose', NEW, 'back');
check('Choose again: the thirteen again, nothing written', last()[1].actions.length === 13 && !state[NEW].props['private.dboBirthsign']);
fire('birthsignChoose', NEW, 'confirm');
check('a confirm with no pick open does nothing', !state[NEW].props['private.dboBirthsign']);
fire('birthsignChoose', NEW, 'nonsense');
check('an unknown row does nothing', !state[NEW].props['private.dboBirthsign'] && last()[1].actions.length === 13);
fire('birthsignChoose', NEW, 'lady'); audits.length = 0;
fire('birthsignChoose', NEW, 'confirm');
const rec = state[NEW].props['private.dboBirthsign'];
check('confirmed: { id, at, by: self } on the character', rec && rec.id === 'lady' && rec.by === 'self' && rec.at > 0, rec);
check('...audited, told, the menu closed', audits.includes('BIRTHSIGN P50 #T50 (profile 50) was born under The Lady') && told.some(([a, t]) => a === NEW && /^You were born under The Lady: /.test(t)) && closed.some(([a, id]) => a === NEW && id === 163), audits);
check('...the creation step goes on to the god, once', JSON.stringify(stepDone) === '[50]');
check('...and nothing holds them now', globalThis.__dboBirthsignHold(NEW) === false && globalThis.__dboBirthsignCreationOpen(NEW) === false);
check('fixed for life: a later row, or /birthsign warrior, changes nothing', (() => { fire('birthsignChoose', NEW, 'warrior'); commands.get('birthsign')(NEW, 'warrior'); return state[NEW].props['private.dboBirthsign'].id === 'lady'; })()
  && told.some(([a, t]) => a === NEW && /You were born under The Lady: .*Only staff can change it\./.test(t)));

// close: it comes back, and nothing keeps it away for good
const OLD = 60; race(OLD, 'breton');
B = loadSigns({ loginDelaySeconds: 20, reshowSeconds: 90 });
const tick = (t) => B.tick(t);
widgets.length = 0;
globalThis.__dboBirthsignLogin(OLD);
const t0 = Date.now();
tick(t0 + 5000);
check('an older character: nothing in the first seconds after login', widgets.length === 0);
tick(t0 + 21000);
check('...then the menu, focused', widgets.length === 1 && widgets[0][0] === OLD && widgets[0][2] === true);
told.length = 0;
fire('birthsignClose', OLD);
check('closed: told it comes back, nothing written', told.some(([a, t]) => a === OLD && /comes back in 90 seconds/.test(t)) && !state[OLD].props['private.dboBirthsign']);
tick(t0 + 60000);
check('...not before reshowSeconds', widgets.length === 1);
const GUARDS = [
  ['in creation', () => { state[OLD].props['private.creationPending'] = true; }, () => { delete state[OLD].props['private.creationPending']; }],
  ['in the race menu or another editor', () => { globalThis.__dboInEditor = () => true; }, () => { globalThis.__dboInEditor = () => false; }],
  ['being arrested', () => { globalThis.__dboJailPending = new Map([[OLD, {}]]); }, () => { globalThis.__dboJailPending = new Map(); }],
  ['serving a sentence', () => { state[OLD].props['private.dboSentence'] = { totalMs: 60000, servedMs: 1000 }; }, () => { delete state[OLD].props['private.dboSentence']; }],
  ['downed', () => { globalThis.__dboIsDowned = (a) => a === OLD; }, () => { globalThis.__dboIsDowned = () => false; }],
  ['fighting', () => { globalThis.__dboCombatAt = new Map([[OLD, t0 + 150000]]); }, () => { globalThis.__dboCombatAt = new Map(); }],
  // promptguard.js (Nat, 26 Oct: prompts in dungeons disrupt people)
  ['in a dungeon', () => { globalThis.__dboPromptBusy = (a) => (a === OLD ? 'in a dungeon' : ''); }, () => { globalThis.__dboPromptBusy = null; }],
];
for (const [what, on, off] of GUARDS) {
  on();
  const n = widgets.length;
  tick(t0 + 160000);
  check(`the menu waits while ${what}`, widgets.length === n && B.waitReason(OLD, t0 + 160000) !== '');
  off();
}
tick(t0 + 160000);
check('...and comes back once nothing keeps it away', widgets.length === 2 && widgets[1][0] === OLD);
check('a finished sentence does not keep it away', (() => { state[OLD].props['private.dboSentence'] = { totalMs: 60000, servedMs: 60000 }; const r = B.waitReason(OLD, t0); delete state[OLD].props['private.dboSentence']; return r === ''; })());
fire('birthsignChoose', OLD, 'atronach'); fire('birthsignChoose', OLD, 'confirm');
check('chosen outside creation: written, and no creation step to end', state[OLD].props['private.dboBirthsign'].id === 'atronach' && JSON.stringify(stepDone) === '[50]');
const n2 = widgets.length; tick(t0 + 999999);
check('never asked again', widgets.length === n2);
check('a logout forgets the session\'s menu; offline nobody is asked', (() => { const X = 61; race(X, 'nord'); globalThis.__dboBirthsignLogin(X); state[X].props.isOnline = false; const n = widgets.length; tick(Date.now() + 999999); globalThis.__dboBirthsignLeave(X); return widgets.length === n; })());

// the menu cannot be sent: nobody is stranded
const STUCK = 70; race(STUCK, 'nord');
widgetOk = false;
check('a menu that cannot be sent: the creation step goes on without it, and nothing holds them', globalThis.__dboBirthsignCreationOpen(STUCK) === false && globalThis.__dboBirthsignHold(STUCK) === false);
told.length = 0;
commands.get('birthsign')(STUCK, '');
check('.../birthsign tells them to type the sign', told.some(([a, t]) => a === STUCK && /^Choose by typing it: \/birthsign warrior, mage/.test(t)), told);
widgetOk = true;
commands.get('birthsign')(STUCK, 'the serpent');
check('...and /birthsign the serpent chooses it, at once', state[STUCK].props['private.dboBirthsign'].id === 'serpent');
check('/birthsign: your sign and its gift', (() => { told.length = 0; commands.get('birthsign')(STUCK, ''); return told.some(([a, t]) => /^You were born under The Serpent: Alchemist learns 10% faster; poison hurts 15% less\.$/.test(t)); })(), told);
check('an unknown sign typed: the list, and the menu', (() => { const Y = 71; race(Y, 'nord'); told.length = 0; const n = widgets.length; commands.get('birthsign')(Y, 'dragon'); return told.some(([, t]) => /^No such sign\. The signs: Warrior, Mage/.test(t)) && widgets.length === n + 1; })());
check('optional at creation when config says so (requireAtCreation false)', (() => { loadSigns({ requireAtCreation: false }); const Z = 72; race(Z, 'nord'); const r = globalThis.__dboBirthsignCreationOpen(Z) === false && globalThis.__dboBirthsignHold(Z) === false; B = loadSigns({}); return r; })());

// ---- 5. staff set and clear ----
const STAFF = 80, PLAYER = 81, GONE = 82; race(STAFF, 'nord'); race(PLAYER, 'nord'); race(GONE, 'imperial');
state[GONE].props.isOnline = false; state[GONE].props['private.indexed.tagKey'] = 'gone';
sign(PLAYER, 'lady');
const say = (a, s) => { told.length = 0; commands.get('birthsign')(a, s); return (told.find(([x]) => x === a) || [])[1] || ''; };
check('a player (not Lead GM) cannot set one', /^Only a Lead GM or above/.test(say(STAFF, 'set P81 warrior')) && state[PLAYER].props['private.dboBirthsign'].id === 'lady');
staffLead = new Set([STAFF]); audits.length = 0;
check('Lead GM: /birthsign set P81 the warrior', /^P81 #T81: The Lady -> The Warrior\.$/.test(say(STAFF, 'set P81 the warrior')), told);
check('...written with who set it, audited, the player told', (() => { const r = state[PLAYER].props['private.dboBirthsign']; return r.id === 'warrior' && r.by === 'P80 #T80 (profile 80)'; })()
  && audits.includes('BIRTHSIGN P80 #T80 (profile 80) set P81 #T81 (profile 81) from The Lady to The Warrior') && told.some(([a, t]) => a === PLAYER && /^Staff set your birthsign to The Warrior/.test(t)), audits);
audits.length = 0;
check('an offline character by #TAG', /The Thief\.$/.test(say(STAFF, 'set #GONE thief')) && state[GONE].props['private.dboBirthsign'].id === 'thief' && audits.includes('BIRTHSIGN P80 #T80 (profile 80) set P82 #T82 (profile 82) from none to The Thief'), audits);
check('...told nothing while offline', !told.some(([a]) => a === GONE));
check('an unknown sign or character is refused, nothing written', /^No such sign/.test(say(STAFF, 'set P81 dragon')) && /^No character found/.test(say(STAFF, 'set Nobody warrior')) && state[PLAYER].props['private.dboBirthsign'].id === 'warrior');
guardNo = 'Staff tools refused here.';
check('staffguard\'s target rule is asked and obeyed', say(STAFF, 'set P81 lady') === 'Staff tools refused here.' && state[PLAYER].props['private.dboBirthsign'].id === 'warrior');
guardNo = ''; audits.length = 0; widgets.length = 0;
check('/birthsign clear: no sign, audited, and the choice comes back to them at once', /The Warrior -> no sign\.$/.test(say(STAFF, 'clear P81')) && state[PLAYER].props['private.dboBirthsign'] === null
  && audits.includes('BIRTHSIGN P80 #T80 (profile 80) set P81 #T81 (profile 81) from The Warrior to none') && (() => { B.tick(Date.now() + 1000); return widgets.some(([a]) => a === PLAYER); })(), audits);
check('a staff set during the creation step ends it, as a choice does', (() => {
  const C1 = 83; race(C1, 'nord'); stepDone.length = 0;
  globalThis.__dboBirthsignCreationOpen(C1); say(STAFF, `set P${C1} tower`);
  return state[C1].props['private.dboBirthsign'].id === 'tower' && JSON.stringify(stepDone) === `[${C1}]`;
})());
check('/birthsign status line', (() => { const st = commands; return typeof st.get('birthsign') === 'function'; })());

// ---- 5b. the front's picker (Nat 25 Oct: Worker 2's mock), for a client whose UI names birthsignPicker ----
B = loadSigns({});
const PK = 90; race(PK, 'nord'); caps.add(`${PK}:birthsignPicker`);
stepDone.length = 0; widgets.length = 0; audits.length = 0;
check('a client with the cap: the creation step opens the picker, focused, id 163', globalThis.__dboBirthsignCreationOpen(PK) === true && widgets.length === 1
  && last()[1].type === 'birthsignPicker' && last()[1].id === 163 && last()[2] === true && typeof last()[1].nonce === 'string' && last()[1].nonce.length > 0, last());
const pk = last()[1];
check('...thirteen cards, each Guardian then its charges, the Serpent last', pk.signs.map((x) => x.id).join() === 'warrior,lady,steed,lord,mage,apprentice,atronach,ritual,thief,lover,shadow,tower,serpent');
check('...the Guardians marked \'\', their charges by Guardian, the Serpent \'none\'', pk.signs.map((x) => x.guardian).join() === ',warrior,warrior,warrior,,mage,mage,mage,,thief,thief,thief,none');
const lord = pk.signs.find((x) => x.id === 'lord');
check('...a card: name, the mock\'s lore line, the effect from the numbers', lord.name === 'The Lord' && lord.lore === 'The blood of the North runs strong, and fire bites deeper.' && lord.effect === 'Health regenerates 10% faster; fire hurts 5% more; weapons and fists hurt 5% less', lord);
check('...the mock\'s title and line', pk.title === 'Choose your birthsign' && pk.sub === 'The stars you were born under. Yours for life; only staff can change it later.');
check('...every emblem is stars on the 40 x 40 grid and lines between real stars', pk.signs.every((x) => x.emblem && x.emblem.stars.length >= 4
  && x.emblem.stars.every(([px, py]) => px >= 0 && px <= 40 && py >= 0 && py <= 40)
  && x.emblem.lines.length > 0 && x.emblem.lines.every(([i, j]) => i !== j && x.emblem.stars[i] && x.emblem.stars[j])));
check('...every card has lore and an effect', pk.signs.every((x) => x.lore.length > 10 && x.effect.length > 10 && x.effect !== 'No gift'));
fire('birthsignChoose', PK, 'lord'); fire('birthsignChoose', PK, 'confirm');
check('the contextMenu\'s events do nothing to an open picker', !state[PK].props['private.dboBirthsign'] && widgets.length === 1);
fire('birthsignPick', PK, 'wrong', 'lord');
check('a pick with another nonce is dropped', !state[PK].props['private.dboBirthsign']);
fire('birthsignPick', PK, pk.nonce, 'dragon');
check('a pick of no such sign is dropped', !state[PK].props['private.dboBirthsign']);
fire('birthsignClose', PK, 'stale');
check('a close from another panel (stale nonce) is not this one\'s: still open, no wait set', B.waitReason(PK) === '' && (() => { const n = widgets.length; B.tick(Date.now() + 999999); return widgets.length === n; })());
told.length = 0;
fire('birthsignClose', PK, pk.nonce);
check('its own close: told, and the step\'s quicker come-back is set (15 s)', told.some(([a, t]) => a === PK && /comes back in 15 seconds/.test(t)));
B.tick(Date.now() + 16000);
const pk2 = last()[1];
check('...it comes back as the picker, with a new nonce', widgets.length === 2 && pk2.type === 'birthsignPicker' && pk2.nonce !== pk.nonce);
fire('birthsignPick', PK, pk.nonce, 'lord');
check('...the old panel\'s answer is refused', !state[PK].props['private.dboBirthsign']);
fire('birthsignPick', PK, pk2.nonce, 'lord');
check('the picker\'s confirmed pick: written, audited, the creation step goes on', state[PK].props['private.dboBirthsign'].id === 'lord' && state[PK].props['private.dboBirthsign'].by === 'self'
  && audits.includes('BIRTHSIGN P90 #T90 (profile 90) was born under The Lord') && JSON.stringify(stepDone) === '[90]' && closed.some(([a, id]) => a === PK && id === 163));
fire('birthsignPick', PK, pk2.nonce, 'tower');
check('...and a second pick changes nothing', state[PK].props['private.dboBirthsign'].id === 'lord');
const NOCAP = 91; race(NOCAP, 'nord'); widgets.length = 0;
globalThis.__dboBirthsignCreationOpen(NOCAP);
check('a client without the cap gets the contextMenu, as before', last()[1].type === 'contextMenu' && last()[1].actions.length === 13);
const THROWS = 92; race(THROWS, 'nord'); capThrows = true; widgets.length = 0;
globalThis.__dboBirthsignCreationOpen(THROWS); capThrows = false;
check('a cap read that fails falls back to the contextMenu', last()[1].type === 'contextMenu');
const PK3 = 93; race(PK3, 'nord'); caps.add(`${PK3}:birthsignPicker`); widgets.length = 0;
commands.get('birthsign')(PK3, '');
check('/birthsign opens the picker for a client with the cap', last()[1].type === 'birthsignPicker' && last()[0] === PK3);
commands.get('birthsign')(PK3, 'shadow');
check('...and /birthsign <sign> still chooses by text', state[PK3].props['private.dboBirthsign'].id === 'shadow');
check('a sign\'s lore and emblem come from config like its numbers', (() => {
  const Bx = loadSigns({ signs: { lord: { lore: 'Changed.' } } }); const c = Bx.card(Bx.config.signs.lord); B = loadSigns({}); return c.lore === 'Changed.' && c.emblem && c.emblem.stars.length === 6; })());

// ---- 6. the wiring ----
const hook = gm.slice(gm.indexOf('const hitDamageAttemptHook'), gm.indexOf('hitDamageAttemptHook.__dbo = true;'));
check('gamemode: the hit passes its flags to racial.attackMult (the Shadow)', /raceAtk = racial\.attackMult\(agg, tgt, src, dmg, flags\)/.test(hook));
check('gamemode: birthsigns.js is loaded after racial.js, its hooks cleared when it fails', gm.indexOf("path.resolve('birthsigns.js')") > gm.indexOf("path.resolve('racial.js')") && /for \(const k of \['__dboBirthsignOf', '__dboBirthsignHold', '__dboBirthsignCreationOpen', '__dboBirthsignLogin', '__dboBirthsignLeave'\]\) globalThis\[k\] = null;/.test(gm));
const endC = gm.slice(gm.indexOf('const endCreation = (a) => {'), gm.indexOf('// The original is stored once so a hot reload'));
check('gamemode: endCreation opens the birthsign first, then the god (chooseGod), and the choice comes back through __dboBirthsignStepDone',
  endC.indexOf('__dboBirthsignCreationOpen') >= 0 && endC.indexOf('__dboBirthsignCreationOpen') < endC.indexOf('__dboDeityCreationOpen') && /globalThis\.__dboBirthsignStepDone = \(a\) => chooseGod\(a\);/.test(endC));
check('gamemode: a gate refuses a hub character with no sign, with the way out', /if \(g && birthsignHeld\(casterId >>> 0\)\) \{ gateCreationTold\(casterId >>> 0, globalThis\.__dboBirthsignGateLine\); return false; \}/.test(gm));
check('gamemode: the gate check comes after the creation one and before the gate moves anyone', gm.indexOf('if (g && birthsignHeld(') > gm.indexOf('if (g && creationPending(casterId >>> 0))') && gm.indexOf('if (g && birthsignHeld(') < gm.indexOf('gateAnswersStart(casterId >>> 0);'));
const lr = gm.slice(gm.indexOf('const leaveRealm = (a) => {'), gm.indexOf('const startChoose = '));
check('gamemode: leaveRealm moves nobody without a sign, and puts the choice back up (not during creation)', /^const leaveRealm = \(a\) => \{\n  try \{\n    if \(birthsignHeld\(a\)\) \{ if \(!creationPending\(a\)\) endCreation\(a\); return; \}/.test(lr));
check('gamemode: the hold is the hub only, and the god waits for it', /const birthsignHeld = \(a\) => \{ try \{ return typeof globalThis\.__dboBirthsignHold === 'function' && inHub\(a\) && /.test(gm) && /globalThis\.__dboAtCreationEnd = \(a\) => inHub\(a\) && !creationPending\(a\) && !birthsignHeld\(a\);/.test(gm));
check('gamemode: birthsigns.js gets hasUiCap, for the picker\'s cap', /require\(BIRTHSIGNS_JS\)\(\{[^}]*\bhasUiCap \}\);/.test(gm));
check('gamemode: login and logout reach birthsigns.js', /globalThis\.__dboBirthsignLogin\(a\)/.test(gm) && /'__dboStartLeave', '__dboBirthsignLeave'\]/.test(gm));
const cl = fs.readFileSync(path.join(SERVER, 'charlevel.js'), 'utf8');
check('charlevel.js: the bonus adds the race\'s and sign\'s magicka and stamina, and syncs on demand', /magicka: \(Number\(spent\.magicka\) \|\| 0\) \+ \(Number\(r\.magicka\) \|\| 0\), stamina: \(Number\(spent\.stamina\) \|\| 0\) \+ \(Number\(r\.stamina\) \|\| 0\)/.test(cl) && /globalThis\.__dboCharLevelSyncBonus = \(a\) => \{ if \(!CFG\.enabled\) return; try \{ syncBonus\(Number\(a\) >>> 0, stateOf\(Number\(a\) >>> 0\)\);/.test(cl));
const bsSrc = fs.readFileSync(BS_JS, 'utf8');
check('birthsigns.js: one hot-reload-safe state, ui events registered through onUi, no mp.on', /globalThis\.__dboBirthsignState \|\| \(globalThis\.__dboBirthsignState = /.test(bsSrc) && !/mp\.on\(/.test(bsSrc));

// ---- 7. the patch note ----
const notes = JSON.parse(fs.readFileSync(path.join(SERVER, 'patch-notes.json'), 'utf8'));
const list = Array.isArray(notes) ? notes : notes.notes || notes.entries || [];
const note = list.find((n) => /birthsign/i.test(JSON.stringify(n)));
// Among the newest few rather than first: a release carries several new features' notes, and only one can be on top
check('patch-notes.json: a Birthsigns note, among the newest', !!note && list.indexOf(note) >= 0 && list.indexOf(note) < 10, note);

// ---- the Steed's carry weight: the DLE's DBO_ReferralCarry ability (+50, 1D1FA7), given by AddSpell like the Maormer's ----
{
  const calls = []; const realCall = mp.callPapyrusFunction; const realLookup = mp.lookupEspmRecordById;
  const CARRY = 0x481d1fa7;
  mp.callPapyrusFunction = (k, cls, fn, self, args) => { calls.push([fn, self.desc, args[0] && args[0].desc]); };
  mp.lookupEspmRecordById = (id) => ((id >>> 0) === CARRY ? { record: { type: 'SPEL', editorId: 'DBO_ReferralCarry', fields: [] } } : (realLookup ? realLookup(id) : null));
  const realDesc = mp.getIdFromDesc, realDescOf = mp.getDescFromId;
  mp.getIdFromDesc = (d) => (String(d).toLowerCase() === '1d1fa7:dragonbreak online edits.esp' ? CARRY : realDesc ? realDesc(d) : 0);
  mp.getDescFromId = (id) => ((id >>> 0) === CARRY ? '1d1fa7:DragonBreak Online Edits.esp' : realDescOf ? realDescOf(id) : String(id));
  const ST = 71; race(ST); sign(ST, 'steed'); const LA = 72; race(LA); sign(LA, 'lady');
  globalThis.__dboBirthsignAbilityTick(); globalThis.__dboBirthsignAbilityTick();
  check('the Steed is given the carry ability once a session; the Lady not', calls.filter((c) => c[0] === 'AddSpell' && c[2] === '1d1fa7:DragonBreak Online Edits.esp').length === 1 && !calls.some((c) => String(c[1]) === String(mp.getDescFromId(LA))) && state[ST].props['private.dboBirthsignAbility'] === '1d1fa7:DragonBreak Online Edits.esp', calls);
  calls.length = 0; sign(ST, 'lady'); globalThis.__dboBirthsignAbilityTick();
  check('...taken back when staff change the sign', calls.some((c) => c[0] === 'RemoveSpell') && !state[ST].props['private.dboBirthsignAbility'], calls);
  calls.length = 0; sign(ST, 'steed'); globalThis.__dboBirthsignAbilityTick(); state[ST].props['private.dboReferralCarry'] = '1d1fa7:DragonBreak Online Edits.esp'; sign(ST, 'lady'); globalThis.__dboBirthsignAbilityTick();
  check('...but never when the referral reward gave the same ability (it stays theirs)', !calls.some((c) => c[0] === 'RemoveSpell') && !state[ST].props['private.dboBirthsignAbility'], calls);
  mp.callPapyrusFunction = realCall; mp.lookupEspmRecordById = realLookup; mp.getIdFromDesc = realDesc; mp.getDescFromId = realDescOf;
}
console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
