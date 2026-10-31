// Armour debuffs instead of the hard block (Nat, 31 Oct; gamemode.js armorWear mode "debuff"): anyone wears anything, a
// piece above the wearer's Defense costs move speed, stamina recovery and power attack and sprint stamina, weighted by
// slot, growing with the gap to the piece's Defense (full at 45 short; Marcus, #ooc-general); medium armour half the heavy
// slowdown; /armor shows each piece; heavy armour slows less as Defense rises, none from 75; cosmetic pieces cost nothing; the
// stamina recovery reaches racial.js's regen tick; the player is told once when it worsens. The section is lifted from
// gamemode.js and run against stubs; each mutant must fail at least one scenario.
//   node tests/armor-debuff-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const GM = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
const RACIAL = fs.readFileSync(path.join(ROOT, 'racial.js'), 'utf8').replace(/\r\n/g, '\n');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!c) fails++; };

const i = GM.indexOf('const ARMOR_WEAR = '), j = GM.indexOf('const equipHook = ', i);
const BODY = i > 0 && j > i ? GM.slice(i, j) + '\nreturn { wearCheck, wearDebuffOf, wearDebuffUpdate };' : '';
ok(!!BODY, 'gamemode.js has the armour wear section before equipHook');
ok(CFG.armorWear.mode === 'debuff' && CFG.skillRates.rates.defense === 1.25, 'live config: debuff mode, Defense levels 25% faster');

// Pieces: [slot mask, rating, heavy (1) / light (0) / clothing (2), tier, editor id, name]
const P = {
  STEEL_BODY: [0x4, 31, 1, 2, 'ArmorSteelCuirassA', 'Steel Armor'],
  MEDIUM_BODY: [0x4, 31, 1, 2, 'ArmorOrcishCuirassTest', 'Orcish Armor'],
  T6_BODY_L: [0x4, 39, 0, 6, 'ArmorEbonyLightTest', 'Ebony Light Armor'],
  T7_BODY_H: [0x4, 49, 1, 7, 'ArmorDaedricCuirass', 'Daedric Armor'],
  T7_HEAD_H: [0x1002, 23, 1, 7, 'ArmorDaedricHelmet', 'Daedric Helmet'],
  T7_HANDS_H: [0x8, 18, 1, 7, 'ArmorDaedricGauntlets', 'Daedric Gauntlets'],
  T7_FEET_H: [0x80, 18, 1, 7, 'ArmorDaedricBoots', 'Daedric Boots'],
  MASK_L: [0x1002, 9, 0, 7, 'DBO_TestMask', 'Konahrik Mask'],
  HOOD_STRONG_L: [0x1002, 16, 0, 7, 'DBO_TestHoodStrong', 'Armored Hood'],
  RING: [0x40, 0, 2, 6, 'ClothingRingEbony', 'Ebony Ring'],
  UNDER_HANDS: [0x8, 2, 1, 7, 'DBO_SunderedGauntlets', 'Sundered Daedric Gauntlets'],
  ALLOWED: [0x4, 45, 1, 7, 'DBO_StaffCostume', 'Festival Plate'],
  FACTION: [0x4, 30, 1, 0, 'ArmorImperialCuirass', 'Imperial Armor'],
};
const ID = {}; let n = 0x2000; for (const k of Object.keys(P)) ID[k] = ++n;
const byId = (id) => P[Object.keys(ID).find((k) => ID[k] === id)];
const u32 = (...v) => { const b = new Uint8Array(4 * v.length); v.forEach((x, k) => new DataView(b.buffer).setUint32(4 * k, x, true)); return b; };
const recordOf = (id) => { const p = byId(id); return p ? { record: { type: 'ARMO', editorId: p[4], fields: [{ type: 'BOD2', data: u32(p[0], p[2]) }] } } : null; };
const fieldsOf = (r, t) => ((r && r.record.fields) || []).filter((f) => f.type === t);
const u32At = (f, off) => new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(off, true);
const slotOfMask = (mask) => (mask & 0x4 ? 'body' : mask & 0x200 ? 'shield' : mask & 0x8 ? 'hands' : mask & 0x80 ? 'feet' : mask & 0x1003 ? 'head' : '');
const armorPieceOf = (id) => { const p = byId(id); return p ? { rating: p[1], counted: p[1], heavy: p[2] === 1, clothing: p[2] === 2, chest: !!(p[0] & 4) } : null; };

const run = (src, wear, caps, keepState) => {
  for (const k of ['__dboWearState', '__dboWearRegenMult', '__dboWearConnect']) if (!keepState || k !== '__dboWearState') delete globalThis[k];
  globalThis.__dboWearTier = (id) => { const p = byId(id); return p ? p[3] : 0; };
  const props = new Map(), told = [], packets = [], off = [], timers = new Map(), cmds = new Map();
  const mp = { get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v), getDescFromId: (id) => `${(id >>> 0).toString(16)}:Test.esp`,
    callPapyrusFunction: (kind, cls, fn, self, args) => { if (fn === 'UnequipItem') off.push(parseInt(String(args[0].desc), 16)); } };
  const online = [];
  const w = new Function('cfg', 'mp', 'armorPieceOf', 'masteryOf', 'wornOf', 'personal', 'sendPacket', 'log', 'display', 'adminItemName', 'setTimeout',
    'recordOf', 'fieldsOf', 'u32At', 'slotOfMask', 'hasUiCap', 'every', 'onlineActors', 'wornWithHealth', 'registerChatCommand', src)(
    { armorWear: wear }, mp, armorPieceOf, (a) => mp.get(a, 'private.mastery') || null,
    (eq) => eq.inv.entries.filter((e) => e.worn).map((e) => ({ baseId: e.baseId >>> 0, left: false })),
    (a, t) => told.push(t), (a, p) => { packets.push(p); return true; }, () => {}, (a) => `#${a}`,
    (d) => { const p = byId(parseInt(d, 16)); return p ? p[5] : ''; }, (fn) => fn(), recordOf, fieldsOf, u32At, slotOfMask,
    (a, cap) => !!caps && cap === 'armourWear', (name, ms, fn) => timers.set(name, fn), () => online.slice(),
    (a) => (mp.get(a, 'test.worn') || []).map((id) => ({ baseId: id, health: 1, cond: 1 })), (name, fn) => cmds.set(name, fn));
  const actor = (k, defense) => { const a = 0xff000100 + k; mp.set(a, 'private.mastery', { order: ['defense'], skills: { defense: { level: defense } } }); online.push(a); return a; };
  const equip = (a, ids, settling) => { mp.set(a, 'test.worn', ids); off.length = 0; packets.length = 0; told.length = 0; w.wearCheck(a, { inv: { entries: ids.map((id) => ({ baseId: id, count: 1, worn: true })) } }, !!settling); return { off: off.slice(), packets: packets.slice(), told: told.slice() }; };
  return { w, mp, actor, equip, timers, told, packets, cmds };
};
const DEBUFF = Object.assign({}, CFG.armorWear, { mode: 'debuff', debuff: { allow: ['DBO_StaffCostume'] } });
const half = (x) => Math.round(x);   // the section's own rounding (half up)
const expect = (pieces, defense) => {
  // tier opened by Defense: 0/15/30/45/60/75/90
  const NEED = [0, 15, 30, 45, 60, 75, 90];
  const W = { body: 0.5, head: 0.15, hands: 0.15, feet: 0.15 };
  let s = 0, r = 0, c = 0, hw = 0;
  for (const [slot, tier, heavy] of pieces) { if (heavy) hw += W[slot] * (heavy === 0.5 ? 0.5 : 1); const f = Math.max(0, Math.min(1, (NEED[tier - 1] - defense) / 45)); s += W[slot] * -30 * f; r += W[slot] * -50 * f; c += W[slot] * 50 * f; }
  const heavy = -15 * Math.min(1, hw) * Math.max(0, 1 - defense / 75);
  return { speed: Math.max(-45, half(s + heavy)), regen: Math.round((1 + r / 100) * 100) / 100, cost: Math.round((1 + c / 100) * 100) / 100 };
};
const same = (d, e) => d.speed === e.speed && d.regen === e.regen && d.cost === e.cost;

const scenarios = (src, live) => {
  let bad = 0;
  const check = (c, what, got) => { if (!c) bad++; if (live) ok(c, what, got); };
  const s = run(src, DEBUFF, true);
  const FULL7 = [ID.T7_BODY_H, ID.T7_HEAD_H, ID.T7_HANDS_H, ID.T7_FEET_H];
  const a = s.actor(1, 0);
  let r = s.equip(a, FULL7);
  const d = s.w.wearDebuffOf(FULL7, 0), e = expect([['body', 7, 1], ['head', 7, 1], ['hands', 7, 1], ['feet', 7, 1]], 0);
  check(r.off.length === 0, 'debuff mode: a full Daedric set at Defense 0 stays on (nothing comes off)', r.off);
  check(same(d, e) && d.speed === -43 && d.regen === 0.53 && d.cost === 1.48, 'full tier 7 heavy at Defense 0: speed -43 (30 over-tier + 13 heavy), stamina recovery x0.53, costs x1.48', [d, e]);
  const p = r.packets.find((x) => x.customPacketType === 'dboArmourWear');
  check(!!p && p.speedMult === -43 && p.staminaCostMult === 1.48 && p.staminaRegenMult === 0.53, '...sent to the client as dboArmourWear', p);
  check(r.told.length === 1 && /needs Defense 90, you have 0 \(and 3 more pieces above you\): you'll feel the weight/.test(r.told[0]) && /move 43% slower/.test(r.told[0]) && /stamina 47% slower/.test(r.told[0]) && !/more stamina/.test(r.told[0]) && /protects you fully/.test(r.told[0]), '...and the player is told once why, with the gap (not the stamina costs, which nothing applies yet)', r.told);
  check(globalThis.__dboWearRegenMult(a, 'stamina') === 0.53 && globalThis.__dboWearRegenMult(a, 'magicka') === 1, 'racial.js reads the stamina factor (magicka untouched)');
  r = s.equip(a, FULL7);
  check(r.told.length === 0 && r.packets.length === 0, 'the same outfit again: no repeat, no packet');
  // Weighted by slot: the body counts most
  const b = s.actor(2, 0);
  const body = s.w.wearDebuffOf([ID.T6_BODY_L], 0), boots = s.w.wearDebuffOf([ID.T7_FEET_H], 0);
  check(same(body, expect([['body', 6, 0]], 0)) && body.speed === -15 && body.regen === 0.75 && body.cost === 1.25, 'one light tier 6 body at Defense 0 (3+ over): speed -15, recovery x0.75, costs x1.25', body);
  check(same(boots, expect([['feet', 7, 1]], 0)) && boots.speed > body.speed, '...boots alone cost less than a body piece (weight 0.15 to 0.5)', boots);
  // By tiers over: 1, 2, 3+
  const t1 = s.w.wearDebuffOf([ID.T7_BODY_H], 75), t2 = s.w.wearDebuffOf([ID.T7_BODY_H], 60), t3 = s.w.wearDebuffOf([ID.T7_BODY_H], 45), t5 = s.w.wearDebuffOf([ID.T7_BODY_H], 15);
  check(t1.speed === -5 && [[t2, 60], [t3, 45], [t5, 15]].every(([d, def]) => same(d, expect([['body', 7, 1]], def))) && t3.regen === 0.75 && t5.regen === 0.75, 'a Daedric body (Defense 90): 15 short -5; 30 and 45 short by the curve (the heavy slowdown on top); full from 45 short, no more past it', [t1, t2, t3, t5]);
  const near = s.w.wearDebuffOf([ID.T7_BODY_H], 88);
  check(same(near, expect([['body', 7, 1]], 88)) && near.speed === -1 && near.regen === 0.99 && near.cost === 1.01, 'two levels short barely shows: -1 speed, x0.99 recovery, x1.01 costs', near);
  const med = s.w.wearDebuffOf([ID.MEDIUM_BODY], 15), hev = s.w.wearDebuffOf([ID.STEEL_BODY], 15);
  check(hev.speed === -6 && med.speed === -3 && same(med, expect([['body', 2, 0.5]], 15)), 'medium armour (an Orcish-pattern piece) slows half as much as heavy: -3 against -6 at Defense 15', [med, hev]);
  // Heavy armour: -15% at 0, less as Defense rises, none from 75
  const h0 = s.w.wearDebuffOf([ID.STEEL_BODY], 15), h37 = s.w.wearDebuffOf([ID.STEEL_BODY], 37.5), h75 = s.w.wearDebuffOf([ID.STEEL_BODY], 75);
  check(same(h0, expect([['body', 2, 1]], 15)) && h37.speed === -4 && h75.speed === 0 && h75.regen === 1 && h75.cost === 1, 'heavy steel within tier: slows by Defense only (-6 at 15, -4 at 37.5, 0 at 75)', [h0, h37, h75]);
  check(s.w.wearDebuffOf([ID.T6_BODY_L], 90).speed === 0, 'light armour within tier: nothing');
  // Cosmetic: clothing, jewellery, under the tier 1 band, a cosmetic head piece no stronger than tier 2, staff's allow list
  check(s.w.wearDebuffOf([ID.MASK_L], 0).speed === 0 && s.w.wearDebuffOf([ID.MASK_L], 0).regen === 1, 'a mask (light head 9, named Mask) costs nothing');
  check(s.w.wearDebuffOf([ID.HOOD_STRONG_L], 0).regen < 1, '...a hood stronger than tier 2\'s head band still counts');
  check(s.w.wearDebuffOf([ID.T7_HEAD_H], 0).regen < 1, '...and a Daedric helmet counts');
  check(s.w.wearDebuffOf([ID.RING, ID.UNDER_HANDS, ID.ALLOWED, ID.FACTION], 0).speed === 0 && s.w.wearDebuffOf([ID.RING, ID.UNDER_HANDS, ID.ALLOWED, ID.FACTION], 0).regen === 1, 'a ring, a piece under the tier 1 band, an allow-listed costume and faction gear cost nothing');
  // Told only when it worsens by a piece put on
  const c = s.actor(3, 0);
  r = s.equip(c, [ID.T6_BODY_L], true);
  check(r.packets.length === 1 && r.told.length === 0, 'a settling report (login, re-dress) sends the debuff but says nothing');
  r = s.equip(c, []);
  check(r.told.length === 0, 'taking it off says nothing');
  // Defense rising: the periodic re-check lightens it quietly
  const dd = s.actor(4, 0); s.equip(dd, [ID.T7_BODY_H]);
  s.mp.set(dd, 'private.mastery', { order: ['defense'], skills: { defense: { level: 90 } } });
  s.told.length = 0; s.packets.length = 0; s.timers.get('armourWear')();
  check(globalThis.__dboWearRegenMult(dd, 'stamina') === 1 && s.told.length === 0 && s.packets.some((x) => x.customPacketType === 'dboArmourWear' && x.speedMult === 0), 'Defense 90 later: the re-check lifts it, quietly');
  // A client without the capability is told only what the server applies
  const old = run(src, DEBUFF, false); const o = old.actor(5, 0); r = old.equip(o, [ID.T6_BODY_L]);
  check(r.told.length === 1 && !/you move|power attacks/.test(r.told[0]) && /recover stamina 25% slower/.test(r.told[0]), 'an older client is told only the stamina recovery the server applies', r.told);
  // /armor: each worn piece's class, tier, Defense and the gap, then what it costs
  const v = s.actor(8, 60); s.equip(v, [ID.T7_BODY_H, ID.MEDIUM_BODY, ID.MASK_L, ID.RING]); s.told.length = 0;
  s.cmds.get('armor')(v, '');
  const out = s.told.join(' | ');
  check(/Your Defense: 60\./.test(out) && /Daedric Armor: Heavy, Tier 7, Defense 90, you are 30 short\./.test(out) && /Orcish Armor: Medium, Tier 2, Defense 15, within your Defense\./.test(out)
    && /Konahrik Mask: Light, Tier 7, Defense 90, costs nothing \(cosmetic\)\./.test(out) && !/Ebony Ring/.test(out) && /Right now you move/.test(out), '/armor lists class, tier, Defense and gap for each piece, cosmetic marked, rings left out', out);
  // The rollback: block mode still takes a piece off
  const blk = run(src, Object.assign({}, DEBUFF, { mode: 'block' }), true); const k = blk.actor(6, 0); blk.mp.set(k, 'private.lastWorn', [[ID.STEEL_BODY, 0]]);
  r = blk.equip(k, [ID.STEEL_BODY, ID.T7_BODY_H]);
  check(r.off.includes(ID.T7_BODY_H), 'block mode (the rollback) still takes the piece off', r.off);
  check(globalThis.__dboWearRegenMult(k, 'stamina') === 1, '...and slows nothing');
  // A hot reload back to block mode while a debuff is held: the stamina factor stops at once
  const hot = run(src, DEBUFF, true); const h = hot.actor(7, 0); hot.equip(h, [ID.T7_BODY_H]);
  run(src, Object.assign({}, DEBUFF, { mode: 'block' }), true, true);
  check(globalThis.__dboWearRegenMult(h, 'stamina') === 1, '...including after a hot reload from debuff mode, with the old state still held');
  return bad;
};
if (BODY) scenarios(BODY, true);

// racial.js: the factor joins the regen tick, after every cap, and a player of no known race still gets it
ok(/const wear = Math\.min\(1, hook\('__dboWearRegenMult', a, stat\)\);/.test(RACIAL) && /\* briar \* wear;/.test(RACIAL) && /return (hag \* )?briar \* wear;/.test(RACIAL), 'racial.js regenFactor multiplies the armour factor in (both returns)');
ok(/if \(!raceOf\(a\) && !signOf\(a\) && !\(hook\('__dboWearRegenMult', a, 'stamina'\) < 1\)\)/.test(RACIAL), '...and its tick keeps a raceless wearer');

const MUTANTS = [
  ['no slot weights', "const weight = Number((WEAR_DEBUFF.slotWeights || {})[slot]) || 0;", 'const weight = 1;'],
  ['gap not capped', 'return Math.max(0, Math.min(1, (w.need - defense)', 'return Math.max(0, ((w.need - defense)'],
  ['steps instead of the gap', "if (WEAR_DEBUFF.scale === 'tiers') { const n", "if (true) { const n"],
  ['medium slows as heavy', "weightW += w.weight * (Number(WEAR_DEBUFF.mediumSlowShare) || 0);", 'weightW += w.weight;'],
  ['heavy slow ignores Defense', ' * Math.max(0, 1 - defense / until);', ';'],
  ['no cosmetic head rule', "&& headCosmeticRx.test(`${edid} ${wearNameOf(baseId)}`)) info.cosmetic = true;", "&& false) info.cosmetic = true;"],
  ['allow list ignored', 'if (wearAllow.has(edid.toLowerCase()) || rating <', 'if (rating <'],
  ['told while settling', 'if (worse && !settling && !quiet) {', 'if (worse) {'],
  ['regen hook ignores mode', "if (stat !== 'stamina' || ARMOR_WEAR.mode !== 'debuff') return 1;", "if (stat !== 'stamina') return 1;"],
  ['debuff mode still blocks', "if (ARMOR_WEAR.mode === 'debuff') return wearDebuffUpdate(", "if (false) return wearDebuffUpdate("],
];
for (const [name, from, to] of MUTANTS) {
  if (!BODY.includes(from)) { ok(false, `mutant "${name}": its line is in the section`); continue; }
  let bad = 0; try { bad = scenarios(BODY.replace(from, to), false); } catch (e) { bad = 1; }
  ok(bad > 0, `mutant "${name}" is caught (${bad} failing)`);
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
