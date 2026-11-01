// Restoration's sun on vampire players (Nat, 1 Nov: "restoration should be hurting vampires, it does not"): Sun Fire,
// Vampire's Bane, Stendarr's Aura and Auriel's Bow burn a vampire player by stage as fire does, half for a pure-blood,
// x2 at stage 4 like the undead NPCs (gamemode.js elements.sun). The vampire's own sun penalty spells are no hit, mortals
// and werewolves take sun as anyone does, and gamemode.js's NPC rule never doubles a player's. Runs the real
// supernatural.js and gamemode.js's sun block on mock records; each mutant must fail.
//   node tests/vampire-sun-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-vampsun-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const GM = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
const SUPER = fs.readFileSync(path.join(SERVER, 'supernatural.js'), 'utf8');
const cfg = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));

const SUN_FIRE = 0x3f52, BANE = 0x38b6, AURA = 0x38b5, AURIEL = 0x71df, VAMP_SUN_PENALTY = 0xe8d0, FIREBOLT = 0x12fcd, STEEL = 0x13989;
const RECORDS = {};
for (const [id, ed] of [[SUN_FIRE, 'DLC1SunFire'], [BANE, 'DLC1VampiresBane'], [AURA, 'DLC1StendarrsAura'], [VAMP_SUN_PENALTY, 'VampireSunDamage01'], [FIREBOLT, 'Firebolt']]) RECORDS[id] = { type: 'SPEL', editorId: ed, fields: [] };
RECORDS[AURIEL] = { type: 'ENCH', editorId: 'DLCEnchAurielsBow', fields: [] };
RECORDS[STEEL] = { type: 'WEAP', editorId: 'SteelSword', fields: [] };
const lookup = (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0], toGlobalRecordId: (x) => x >>> 0 } : null);
const VAMP1 = 0x71, VAMP2 = 0x72, VAMP4 = 0x73, PURE = 0x74, LORD = 0x75, WOLF = 0x76, MORTAL = 0x77, PLAYER_ATK = 0x78, NPC_ATK = 0x1005;
const store = new Map();
const noop = () => {};
const mp = {
  get: (id, p) => (p === 'type' ? 'MpActor' : store.get(`${id}|${p}`)),
  set: (id, p, v) => store.set(`${id}|${p}`, v),
  getDescFromId: (id) => `${id.toString(16)}:x`,
  getIdFromDesc: (desc) => parseInt(String(desc).split(':')[0], 16) >>> 0,
  callPapyrusFunction: () => null,
  lookupEspmRecordById: lookup,
};
const setState = (id, s, beast) => { store.set(`${id}|private.supernatural`, s); if (beast) store.set(`${id}|private.beast`, { form: beast }); };
setState(VAMP1, { kind: 'vampire', stage: 1, lastFed: 0 });
setState(VAMP2, { kind: 'vampire', stage: 2, lastFed: 0 });
setState(VAMP4, { kind: 'vampire', stage: 4, lastFed: 0 });
setState(PURE, { kind: 'vampire', stage: 1, pure: true, lastFed: 0 });
setState(LORD, { kind: 'vampire', stage: 1, pure: true, lastFed: 0 }, 'vampirelord');
setState(WOLF, { kind: 'werewolf' }, 'werewolf');

// gamemode.js's sun block, lifted: it publishes __dboIsSunSource from elements.sun.sources
const a0 = GM.indexOf('const SUN = Object.assign('), b0 = GM.indexOf('const undeadCache = new Map();');
ok(a0 > 0 && b0 > a0 && GM.slice(a0, b0).includes('globalThis.__dboIsSunSource'), 'gamemode.js publishes the sun sources for supernatural.js');
const liftSun = () => new Function('mp', 'cfg', 'log', GM.slice(a0, b0))(mp, cfg, noop);
ok(/if \(agg === tgt \|\| !\(profileOf\(agg\) >= 0\) \|\| profileOf\(tgt\) >= 0\) return 1;/.test(GM), "gamemode.js's NPC sun rule still leaves a player target alone, so a vampire player's burn is never doubled");

const run = (src, live) => {
  let bad = 0;
  const t = (c, what, got) => { if (!c) bad++; if (live) ok(c, what, got); };
  const file = path.join(SERVER, `.supernatural-vampsun-${process.pid}.js`);
  fs.writeFileSync(file, src);
  try {
    delete globalThis.__dboIsSunSource;
    liftSun();
    const load = (superCfg) => {
      delete require.cache[require.resolve(file)];
      delete globalThis.__dboSuperState;
      mp.onHitDamageAttempt = () => true;
      require(file)({
        mp, log: noop, audit: noop, personal: noop, registerChatCommand: noop, onUi: noop, openWidget: noop, closeWidget: noop,
        sendPacket: noop, display: String, who: String, isAdmin: () => false, findByName: () => null, onlineActors: () => [], every: noop,
        profileOf: (a) => (a < 0x1000 ? a : -1), nameOf: String, isWorldspace: () => true, needsFeed: noop, hungerOf: () => 0,
        cfg: { supernatural: superCfg }, sourceResistsOf: () => new Set(),
      });
    };
    const base = cfg.supernatural || {};
    load(base);
    const m = (tgt, s, agg) => globalThis.__dboSuperDamageMult(agg || PLAYER_ATK, tgt, s);
    t(near(m(VAMP1, SUN_FIRE), 1.25) && near(m(VAMP2, SUN_FIRE), 1.5) && near(m(VAMP4, SUN_FIRE), 2), 'Sun Fire burns a vampire by stage: x1.25, x1.5 ... x2 at stage 4', [m(VAMP1, SUN_FIRE), m(VAMP2, SUN_FIRE), m(VAMP4, SUN_FIRE)]);
    t(near(m(VAMP2, BANE), 1.5) && near(m(VAMP2, AURA), 1.5) && near(m(VAMP2, AURIEL), 1.5), "Vampire's Bane, Stendarr's Aura and Auriel's Bow too", [m(VAMP2, BANE), m(VAMP2, AURA), m(VAMP2, AURIEL)]);
    t(near(m(PURE, SUN_FIRE), 1.125) && near(m(LORD, SUN_FIRE), 1.125), 'a pure-blood and a Vampire Lord take half', [m(PURE, SUN_FIRE), m(LORD, SUN_FIRE)]);
    t(near(m(VAMP2, SUN_FIRE, NPC_ATK), 1.5), "a Dawnguard NPC's Sun Fire burns a vampire player as a player's does", m(VAMP2, SUN_FIRE, NPC_ATK));
    t(m(MORTAL, SUN_FIRE) === 1 && m(WOLF, SUN_FIRE) === 1, 'a mortal and a werewolf take sun as anyone does', [m(MORTAL, SUN_FIRE), m(WOLF, SUN_FIRE)]);
    t(m(VAMP4, VAMP_SUN_PENALTY) === 1, "the vampire's own sun penalty is no sun hit (it is not a source)", m(VAMP4, VAMP_SUN_PENALTY));
    t(near(m(VAMP2, FIREBOLT), m(VAMP2, FIREBOLT)) && m(VAMP2, STEEL) === 1, 'steel does nothing extra; fire is untouched by this');
    load(Object.assign({}, base, { vampireSunWeaknessPerStage: 0 }));
    t(m(VAMP4, SUN_FIRE) === 1, 'vampireSunWeaknessPerStage 0 turns it off', m(VAMP4, SUN_FIRE));
  } catch (e) { bad++; if (live) ok(false, 'scenarios ran', e.stack); }
  finally { try { fs.unlinkSync(file); } catch (e) { /* gone */ } delete require.cache[file]; }
  return bad;
};
ok(run(SUPER, true) === 0, 'all scenarios pass on the live code');

const MUTANTS = [
  ['the stage is ignored', ' * penaltyStage(tgt, s) * (s.pure ? 0.5 : 1));\n      if (isFireSource(src))', ' * (s.pure ? 0.5 : 1));\n      if (isFireSource(src))'],
  ['a pure-blood burns in full', "isSunSource(src)) return beast * (1 + share(C.vampireSunWeaknessPerStage) * penaltyStage(tgt, s) * (s.pure ? 0.5 : 1));", "isSunSource(src)) return beast * (1 + share(C.vampireSunWeaknessPerStage) * penaltyStage(tgt, s));"],
  ['no source is sun', "!!globalThis.__dboIsSunSource(Number(id) >>> 0)", 'false'],
];
for (const [name, a, b] of MUTANTS) {
  if (!SUPER.includes(a)) { ok(false, `mutant "${name}": its line is in the code`, a); continue; }
  ok(run(SUPER.replace(a, b), false) > 0, `mutant caught: ${name}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
