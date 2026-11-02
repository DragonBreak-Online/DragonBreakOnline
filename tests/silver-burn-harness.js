// Silver can be worn, and it hurts (Nat, 2026-11-02): health a tick while any silver is worn, rising the longer it is
// worn and with each extra piece, flames after igniteSeconds, and all of it stopping when the silver comes off.
// Loads the real supernatural.js in a scratch folder against a stub mp. Mutants at the end must each break a check.
//   node tests/silver-burn-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SUPER = path.resolve(__dirname, '..', 'supernatural.js');
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-silverburn-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let clock = Date.parse('2026-11-02T12:00:00Z');
Date.now = () => clock;
const SEC = 1000;

const WOLF = 0xff000601, VAMP = 0xff000602, HUMAN = 0xff000603;
const RING = 0x3b97c, SWORD = 0x10aa19, IRON = 0x5ace4, INGOT = 0x5ace3;
const RECS = {
  [RING]: { type: 'ARMO', editorId: 'SilverRing' }, [SWORD]: { type: 'WEAP', editorId: 'SilverSword' },
  [IRON]: { type: 'MISC', editorId: 'IngotIron' }, [INGOT]: { type: 'MISC', editorId: 'IngotSilver' },
};
const store = new Map(), said = [], audits = [], timers = {}, letters = [], papyrusCalls = [];
globalThis.__dboClock = { gameDays: () => 100, sendTo: () => {} };
global.setTimeout = () => 0;
const inv = (a) => (store.get(`${a}|inventory`) || { entries: [] }).entries;
const mp = {
  get: (id, p) => {
    id >>>= 0;
    if (p === 'type') return 'MpActor';
    if (p === 'equipment') return { inv: { entries: inv(id) } };
    return store.get(`${id}|${p}`);
  },
  set: (id, p, v) => store.set(`${id >>> 0}|${p}`, v),
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:x`, getIdFromDesc: () => 0x1234,
  callPapyrusFunction: (...x) => { papyrusCalls.push(x); return null; },
  lookupEspmRecordById: (id) => (RECS[id >>> 0] ? { record: RECS[id >>> 0] } : null),
};
globalThis.__dboPostApi = {
  sendableBase: () => true,
  itemsText: (items) => items.map((e) => `${e.count} ${RECS[e.baseId].editorId}`).join(', '),
  takeParcel: (a, prep) => {
    const out = [];
    for (const [id, n] of prep.items) {
      const left = inv(a).map((e) => Object.assign({}, e)); let need = n;
      for (const e of left) if (e.baseId === id && !e.worn && need > 0) { const k = Math.min(need, e.count); e.count -= k; need -= k; out.push({ baseId: id, count: k }); }
      store.set(`${a}|inventory`, { entries: left.filter((e) => e.count > 0) });
    }
    return out;
  },
  giveEntries: () => {},
  boardLetter: (to, zone, text, parcel) => letters.push({ to, zone, text, parcel }),
};
const baseApi = {
  mp, log: () => {}, audit: (t) => audits.push(t), personal: (a, t) => said.push([a, t]), registerChatCommand: () => {},
  onUi: () => {}, openWidget: () => {}, closeWidget: () => {}, sendPacket: () => {}, display: (a) => `P${a.toString(16)}`,
  who: (a) => `P${a.toString(16)}`, isAdmin: () => true,   // staff are NOT exempt: Nat, 2 Nov
  findByName: () => null, onlineActors: () => [WOLF, VAMP, HUMAN], every: (k, ms, f) => { timers[k] = f; },
  profileOf: () => 1, nameOf: String, isWorldspace: () => true, needsFeed: () => {}, hungerOf: () => 0,
};
fs.writeFileSync('supernatural.json', JSON.stringify({ crown: null, revoke: [] }));
store.set(`${WOLF}|private.supernatural`, { kind: 'werewolf', disease: null, spells: [] });
store.set(`${VAMP}|private.supernatural`, { kind: 'vampire', pure: false, stage: 2, lastFed: 99, spells: [], disease: null });

let fails = 0;
const ok = (cond, what, got) => {
  if (cond) { console.log(`ok    ${what}`); return; }
  fails++;
  console.log(`FAIL  ${what}${got === undefined ? '' : `   ${JSON.stringify(got)}`}`);
};
const load = (silverBurn, src) => {
  delete globalThis.__dboSilverBurnState;
  let file = SUPER;
  if (src) { file = path.join(dir, `s-${Math.random().toString(16).slice(2)}.js`); fs.writeFileSync(file, src); }
  delete require.cache[file];
  require(file)(Object.assign({}, baseApi, { cfg: { supernatural: silverBurn ? { silverBurn } : {} } }));
  return timers.superSilver;
};
const wear = (a, ...ids) => store.set(`${a}|inventory`, { entries: ids.map((baseId) => ({ baseId, count: 1, worn: true })) });
const carry = (a, ...ids) => store.set(`${a}|inventory`, { entries: ids.map((baseId) => ({ baseId, count: 1 })) });
const bare = (a) => store.set(`${a}|inventory`, { entries: [] });
const dmg = () => papyrusCalls.filter((c) => c[2] === 'DamageActorValue').map((c) => c[4][1]);
const shaders = (fn) => papyrusCalls.filter((c) => c[1] === 'EffectShader' && c[2] === fn);
const unequips = () => papyrusCalls.filter((c) => c[2] === 'UnequipItem');
const reset = () => { papyrusCalls.length = 0; said.length = 0; audits.length = 0; letters.length = 0; };

// ---- worn silver is allowed and hurts --------------------------------------------------------------------------------
let tick = load();
bare(VAMP); bare(HUMAN); wear(WOLF, RING);
reset(); tick();
ok(!unequips().length, 'a worn silver ring is no longer torn off', unequips());
ok(dmg().length === 1 && dmg()[0] > 0, '...it costs health instead', dmg());
const first = dmg()[0];
ok(said.some(([a, t]) => a === WOLF && /burns like fire/.test(t)), '...and the beast is told, in its own voice', said);
ok(!papyrusCalls.some((c) => JSON.stringify(c).includes(`${HUMAN.toString(16)}:x`)), 'a human wearing nothing is untouched');

// the pain climbs with the time worn
reset(); clock += 10 * SEC; tick();
const later = dmg()[0];
ok(later > first, 'the longer it is worn the more it takes', [first, later]);

// more pieces, more pain
reset(); wear(WOLF, RING, SWORD); clock += 2 * SEC; tick();
ok(dmg()[0] > later, 'two pieces take more than one', [later, dmg()[0]]);

// ---- the flames ------------------------------------------------------------------------------------------------------
tick = load(); wear(WOLF, RING);
reset(); tick();
ok(!shaders('Play').length, 'before igniteSeconds there are no flames');
clock += 21 * SEC;
reset(); tick();
ok(shaders('Play').length === 1, 'past igniteSeconds the fire shader is played on them', shaders('Play'));
const play = shaders('Play')[0];
ok(play[3].type === 'espm' && /2acd8/.test(play[3].desc), '...the shader is the configured EFSH form', play[3]);
ok(play[4][0].type === 'form' && play[4][0].desc === `${WOLF.toString(16)}:x` && play[4][1] > 0,
  '...played on the wearer, with a duration', play[4]);
ok(audits.some((t) => /^SILVERBURN .* burst into flames/.test(t)), '...and the burst is audited', audits);
ok(said.some(([a, t]) => a === WOLF && /burst into flame/.test(t)), '...and said in the beast’s voice', said);
ok(globalThis.__dboSilverBurning(WOLF) === true, '__dboSilverBurning reports them alight');
const alightDmg = dmg()[0];
reset(); clock += 2 * SEC; tick();
ok(shaders('Play').length === 1, 'the shader is re-played each tick, since Play takes a duration that lapses');
ok(dmg()[0] >= alightDmg, 'burning takes at least as much as searing did', [alightDmg, dmg()[0]]);

// ---- taking it off ---------------------------------------------------------------------------------------------------
reset(); bare(WOLF); tick();
ok(shaders('Stop').length === 1 && shaders('Stop')[0][4][0].desc === `${WOLF.toString(16)}:x`, 'the silver off, the flames are stopped', shaders('Stop'));
ok(!dmg().length, '...and nothing more is taken');
ok(audits.some((t) => /stopped burning/.test(t)), '...the relief is audited', audits);
ok(globalThis.__dboSilverBurning(WOLF) === false, '...and they are no longer alight');
reset(); wear(WOLF, RING); tick();
ok(dmg()[0] < alightDmg && !shaders('Play').length, 'wearing it again starts a fresh ramp, not where it left off', dmg());

// ---- death is a normal death -----------------------------------------------------------------------------------------
tick = load(); wear(VAMP, RING); bare(WOLF);
store.set(`${VAMP}|percentages`, { health: 0 });
reset(); tick();
ok(audits.some((t) => /^SILVERBURN .* died of the silver/.test(t)), 'a death by silver is audited', audits);
reset(); clock += 2 * SEC; tick();
ok(!audits.some((t) => /died of the silver/.test(t)), '...once, not every tick afterwards', audits);
store.set(`${VAMP}|percentages`, { health: 1 });

// ---- carrying ---------------------------------------------------------------------------------------------------------
tick = load(); bare(WOLF); bare(VAMP); carry(WOLF, INGOT, IRON);
reset(); tick();
ok(!letters.length, 'by default carried silver is NOT mailed any more', letters);
ok(!dmg().length, '...and carrying costs nothing (carrySting 0)', dmg());
ok(inv(WOLF).length === 2, '...the silver stays in the pack', inv(WOLF));

tick = load({ carrySting: 1 }); carry(WOLF, INGOT);
reset(); tick();
ok(dmg().length === 1 && dmg()[0] === 1, 'carrySting > 0: a light sting a tick', dmg());
ok(said.some(([a, t]) => a === WOLF && /pack/.test(t)), '...and they are told it is the pack', said);

tick = load({ carryMail: true }); carry(WOLF, INGOT);
reset(); tick();
ok(letters.length === 1 && letters[0].to === WOLF, 'carryMail true brings the old mailing back', letters);

// ---- the off switch ---------------------------------------------------------------------------------------------------
tick = load({ enabled: false }); wear(WOLF, RING); carry(VAMP, INGOT);
reset(); tick();
ok(unequips().length === 1, 'enabled false: worn silver is torn off exactly as before', unequips());
ok(!dmg().length, '...no damage', dmg());
ok(letters.some((l) => l.to === VAMP), '...and carried silver is mailed again', letters);
ok(globalThis.__dboCannotCarry(VAMP, INGOT) === true, '...and post.js is told they cannot keep silver');
tick = load();
ok(globalThis.__dboCannotCarry(VAMP, INGOT) === false, 'with the burn on, post.js hands silver back instead', globalThis.__dboCannotCarry(VAMP, INGOT));

// ---- the message rate limit -------------------------------------------------------------------------------------------
tick = load({ tellSeconds: 30 }); wear(WOLF, RING); bare(VAMP);
reset(); tick(); clock += 2 * SEC; tick(); clock += 2 * SEC; tick();
ok(said.filter(([a]) => a === WOLF).length === 1, 'the wearer is told once per tellSeconds, not every tick', said.length);

// ---- mutants ----------------------------------------------------------------------------------------------------------
const SRC = fs.readFileSync(SUPER, 'utf8');
const MUTANTS = [
  ['the ramp is ignored, so pain never climbs', (s) => s.replace('const mult = 1 + (Math.max(1, Number(SB.rampMult) || 1) - 1) * Math.min(1, heldMs / rampMs);', 'const mult = 1;')],
  ['they never catch fire', (s) => s.replace('if (!b.alight && heldMs >= igniteMs) {', 'if (false) {')],
  ['the flames are never shown', (s) => s.replace('      flamesOn(a);\n      sbTell(a, b, v.alight);\n      audit(', '      sbTell(a, b, v.alight);\n      audit(')],
  ['the flames are never stopped', (s) => s.replace('    flamesOff(a);\n    audit(`SILVERBURN', '    audit(`SILVERBURN')],
  ['extra pieces cost nothing', (s) => s.replace('Math.max(0, Number(SB.perPiece) || 0) * Math.max(0, pieces - 1)', '0')],
  ['burning takes no more than searing', (s) => s.replace('Number(b.alight ? SB.burnDamagePerTick : SB.damagePerTick)', 'Number(SB.damagePerTick)')],
  ['the burn state survives taking the silver off', (s) => s.replace('    burnState.delete(a);\n', '')],
  ['silver is mailed away by default again', (s) => s.replace('carryMail: false, carrySting: 0,', 'carryMail: true, carrySting: 0,')],
  ['a worn piece is still torn off', (s) => s.replace('      if (worn.length) silverTick(a, s, worn.length, now);', '      for (const e of worn) papyrus(a, \'UnequipItem\', [spell(Number(e.baseId) >>> 0), false, true]);\n      if (worn.length) silverTick(a, s, worn.length, now);')],
];
const battery = (t) => {
  const out = [];
  bare(VAMP); bare(HUMAN); wear(WOLF, RING);
  reset(); t();
  out.push(!unequips().length);                       // never torn off
  const d0 = dmg()[0];
  out.push(d0 > 0);                                   // it hurts
  out.push(!shaders('Play').length);                  // not alight yet
  reset(); clock += 12 * SEC; t();
  out.push(dmg()[0] > d0);                            // the ramp climbs
  reset(); wear(WOLF, RING, SWORD); t();
  out.push(dmg()[0] > d0);                            // pieces add
  reset(); clock += 30 * SEC; t();
  out.push(shaders('Play').length === 1);             // alight, and the flames show
  const dAlight = dmg()[0];
  reset(); wear(WOLF, RING); clock += 2 * SEC; t();
  out.push(dmg()[0] <= dAlight);                      // burning costs more than one searing ring
  reset(); bare(WOLF); t();
  out.push(shaders('Stop').length === 1);             // and they are put out
  reset(); wear(WOLF, RING); t();
  out.push(dmg()[0] < dAlight && !shaders('Play').length);  // a fresh ramp, not the old one
  reset(); bare(WOLF); carry(WOLF, INGOT); t();
  out.push(!letters.length);                          // no mailing by default
  return out;
};
console.log('');
for (const [what, mutate] of MUTANTS) {
  const src = mutate(SRC);
  if (src === SRC) { fails++; console.log(`FAIL  mutant no longer applies (the code moved): ${what}`); continue; }
  let caught = false;
  try { caught = battery(load(null, src)).some((r) => !r); } catch (e) { caught = true; }
  ok(caught, `mutant caught: ${what}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
