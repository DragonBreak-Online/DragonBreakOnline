// The saw mill (Nat, 25 Oct: "make the saw mill work as intended for wood cutters"): a Woodcutter who activates a
// ResourceObjectSawmill gets firewood by tier (woodcutter millFirewoodByTier), then that mill rests for them for
// millCooldownMinutes; no mini-game (skills.json minigames.lumberMill). Before, nothing handled it and the player was only
// seated. Loads the real labour.js with a mock gamemode api. Run it from this folder's parent with
//
//   node tests/labour-mill-harness.js
'use strict';
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const LABOUR = path.join(SERVER, 'labour.js');
const SKILLS = require(path.join(SERVER, 'skills.json'));
const WOODCUTTER = SKILLS.skills.find((k) => k.id === 'woodcutter');

globalThis.performance = { now: () => 0 };
let wallClock = 1790000000000;
const realNow = Date.now;
Date.now = () => wallClock;

const ACTOR = 0x14, NPC = 0xff000099;
const MILL = 0x5565c, MILL2 = 0x400083b8, BLOCK = 0x5678;
const props = new Map();
const records = new Map([
  [0x71c47, { record: { type: 'FURN', editorId: 'ResourceObjectSawmill' } }],   // Falkreath's and every vanilla mill's saw
  [0x7022e, { record: { type: 'FURN', editorId: 'WoodChoppingBlock' } }],
]);
for (const ref of [MILL, MILL2]) props.set(ref + '|baseDesc', '71c47:Skyrim.esm');
props.set(BLOCK + '|baseDesc', '7022e:Skyrim.esm');
props.set(ACTOR + '|profileId', 1);
props.set(NPC + '|profileId', -1);

const out = { items: [], audits: [], personals: [], events: [], widgets: [] };
let carry = true;
globalThis.__alduinakMasteryEvent = (kind, actorId, detail) => out.events.push({ kind, actorId, detail });
const api = {
  mp: {
    getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
    getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
    get: (id, prop) => props.get(id + '|' + prop),
    set: (id, prop, v) => props.set(id + '|' + prop, v),
    lookupEspmRecordById: (id) => records.get(id) || null,
  },
  log: () => {}, personal: (a, t) => out.personals.push(t), audit: (t) => out.audits.push(t),
  display: () => 'Tester #ABCD', who: () => 'Tester #ABCD (profile 1)',
  cfg: { labour: {} }, distanceMeters: () => 2,
  openWidget: (a, w) => { out.widgets.push(w); return true; }, closeWidget: () => true, onUi: () => {},
  giveItem: (a, id, n) => { if (!carry) return false; out.items.push([id, n]); return true; },
  skills: SKILLS, hasUiCap: () => false,
};
delete require.cache[require.resolve(LABOUR)];
require(LABOUR)(api);

let failures = 0;
const check = (name, cond, detail) => { if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '   ' + detail : ''}`); };
const setTier = (rank) => props.set(ACTOR + '|private.mastery', { order: ['woodcutter'], skills: { woodcutter: { rank } } });
const use = (ref, actor = ACTOR) => { for (const k of Object.keys(out)) out[k].length = 0; return globalThis.__dboLabour(ref, actor); };
const FIREWOOD = 0x6f993;
const said = () => out.personals.join(' | ');
const T1 = WOODCUTTER.millFirewoodByTier[0];
// Hearthfire's Sawn Log (BYOHMaterialLog), sawn with the firewood (Nat, 25 Oct: "make the saw machine for sawn logs work")
const SAWNLOG = 0x300e;
// Sawn logs from Apprentice up (woodcutter sawnLogMinTier; Adept on 25 Oct, Apprentice since 26 Oct); a Novice gets the firewood alone
const LOG_TIER = WOODCUTTER.sawnLogMinTier;
const LOG_LINE = /Sawn logs for building come at an Apprentice Woodcutter\./;
check('skills.json: sawn logs from Apprentice (sawnLogMinTier 1)', LOG_TIER === 1, String(LOG_TIER));
const paid = (id) => out.items.filter(([i]) => i === id).reduce((n, [, c]) => n + c, 0);
check('skills.json saws logs too: 8 to 16 Sawn Logs by tier (Nat, 26 Oct: "more sawn logs from the mill")', JSON.stringify(WOODCUTTER.millSawnLogsByTier) === '[8,10,12,14,16]', JSON.stringify(WOODCUTTER.millSawnLogsByTier));

check('skills.json still holds the design: firewood for 5 tiers and a 30-minute rest',
  Array.isArray(WOODCUTTER.millFirewoodByTier) && WOODCUTTER.millFirewoodByTier.length === 5 && WOODCUTTER.millCooldownMinutes === 30, JSON.stringify(WOODCUTTER.millFirewoodByTier));
// The skill gate and the woodcutting credit read skills.json (masterySystem, at boot): LumberMill and FarmLumbermill are
// static models nobody can activate; the saw is ResourceObjectSawmill. Until skills.json names it (sawmill-1025's patch)
// the mill still pays, a non-Woodcutter is seated as before and the mill's chop event earns no skill credit
const gated = WOODCUTTER.gates.stations.includes('ResourceObjectSawmill') && WOODCUTTER.counts.activatePrefixes.includes('ResourceObjectSawmill');
console.log(`${gated ? 'PASS' : 'NOTE'}  the saw is the Woodcutter's gate and counts as woodcutting in skills.json${gated ? '' : ': not yet (the skills.json patch is pending)'}`);
// Nat, 25 Oct: "the middle, 20-60", in the same patch
if (gated) check('...and the mill pays Nat\'s 20 to 60 by tier', JSON.stringify(WOODCUTTER.millFirewoodByTier) === '[20,30,40,50,60]', JSON.stringify(WOODCUTTER.millFirewoodByTier));

setTier(0);
let r = use(MILL);
check('a Novice Woodcutter runs the mill: the activation is the server\'s (nobody is seated)', r === true);
check(`...and gets ${T1} Firewood and no Sawn Logs: those come at Apprentice`, out.items.length === 1 && paid(FIREWOOD) === T1 && paid(SAWNLOG) === 0, JSON.stringify(out.items));
check('...told so, with when to come back and that sawn logs come at Apprentice', new RegExp(`${T1} Firewood`).test(said()) && /30 minutes/.test(said()) && LOG_LINE.test(said()), said());
check('...audited as a MILL line naming the mill', out.audits.length === 1 && out.audits[0] === `MILL Tester #ABCD (profile 1) ran a saw mill at 5565c:Skyrim.esm (tier 1) -> ${T1} firewood`, out.audits[0]);
check('...and credited as woodcutting (a chop event on the mill)', out.events.length === 1 && out.events[0].kind === 'chop' && out.events[0].detail.refrId === MILL);

r = use(MILL);
check('the same mill again at once: refused, nothing paid', r === true && out.items.length === 0 && /Come back in 30 minutes/.test(said()), said());
wallClock += 20 * 60000;
r = use(MILL);
check('...20 minutes later still resting: 10 minutes to go', out.items.length === 0 && /Come back in 10 minutes/.test(said()), said());
r = use(MILL2);
check('another mill pays at once: the rest is per mill', paid(SAWNLOG) === 0 && paid(FIREWOOD) === T1);
wallClock += 11 * 60000;
r = use(MILL);
check('the first mill pays again once its 30 minutes are up', paid(SAWNLOG) === 0 && paid(FIREWOOD) === T1);

setTier(1);
wallClock += 31 * 60000;
r = use(MILL);
check(`an Apprentice now gets ${WOODCUTTER.millSawnLogsByTier[1]} Sawn Logs with the firewood, and no "come at" line`, paid(SAWNLOG) === WOODCUTTER.millSawnLogsByTier[1] && paid(FIREWOOD) === WOODCUTTER.millFirewoodByTier[1] && !LOG_LINE.test(said()), JSON.stringify(out.items) + ' ' + said());
setTier(2);
wallClock += 31 * 60000;
r = use(MILL);
check(`an Adept gets ${WOODCUTTER.millSawnLogsByTier[2]} Sawn Logs and ${WOODCUTTER.millFirewoodByTier[2]} Firewood`, paid(SAWNLOG) === WOODCUTTER.millSawnLogsByTier[2] && paid(FIREWOOD) === WOODCUTTER.millFirewoodByTier[2], JSON.stringify(out.items));
check('...told of both, and no "come at" line', new RegExp(`${WOODCUTTER.millSawnLogsByTier[2]} Sawn Logs and`).test(said()) && !LOG_LINE.test(said()), said());
check('...audited with both', /-> 12 sawn logs, 40 firewood$/.test(out.audits[0] || ''), out.audits[0]);

setTier(4);
wallClock += 31 * 60000;
r = use(MILL);
check(`a Master Woodcutter gets ${WOODCUTTER.millSawnLogsByTier[4]} Sawn Logs and ${WOODCUTTER.millFirewoodByTier[4]} Firewood`, paid(SAWNLOG) === WOODCUTTER.millSawnLogsByTier[4] && paid(FIREWOOD) === WOODCUTTER.millFirewoodByTier[4], JSON.stringify(out.items));

wallClock += 31 * 60000;
carry = false;
r = use(MILL);
check('a full pack: told, and the mill does not rest', r === true && out.items.length === 0 && /cannot carry/.test(said()) && out.audits.length === 0, said());
carry = true;
r = use(MILL);
check('...so emptying the pack and trying again pays', paid(SAWNLOG) > 0 && paid(FIREWOOD) > 0);

globalThis.__dboGreenPactRefusal = (a, what) => (what === 'chop' ? 'You swore the Green Pact.' : '');
wallClock += 31 * 60000;
r = use(MILL);
check('a wood elf sworn to the Green Pact cuts no wood at a mill either', r === true && out.items.length === 0 && /Green Pact/.test(said()), said());
delete globalThis.__dboGreenPactRefusal;

props.delete(ACTOR + '|private.mastery');
r = use(MILL);
check('not a Woodcutter: falls through to the skill gate (first touch or "Only a Woodcutter"), nothing paid', r === false && out.items.length === 0);
r = use(MILL, NPC);
check('an NPC working the mill is left to its own animation', r === false && out.items.length === 0);

setTier(0);
r = use(BLOCK);
check('a chopping block still runs its round', r === true && out.widgets.length === 1 && out.items.length === 0);

// A mill staff place from F7 (Crafting Stations, "Saw Mill (log pile)"; Nat via the Leader, 26 Oct: Bruma has none) is a
// dynamic id marked private.dboPlaced: it saws as any mill, and rests by where it stands (its id changes every restart)
const PLACED = 0xff000123, LOOSE = 0xff000124;
for (const ref of [PLACED, LOOSE]) { props.set(ref + '|baseDesc', '71c47:Skyrim.esm'); props.set(ref + '|pos', [60000, 250000, 1000]); }
props.set(PLACED + '|private.dboPlaced', { by: 'staff' });
globalThis.__dboLabourRounds.delete(ACTOR);   // the chopping block's round above would be re-shown instead
setTier(2);
wallClock += 31 * 60000;
r = use(PLACED);
check('a staff-placed saw mill saws as any mill: logs and firewood by tier', r === true && paid(SAWNLOG) === WOODCUTTER.millSawnLogsByTier[2] && paid(FIREWOOD) === WOODCUTTER.millFirewoodByTier[2], JSON.stringify(out.items));
r = use(PLACED);
check('...and rests per player like any mill', r === true && out.items.length === 0 && /Come back in 30 minutes/.test(said()), said());
const rested = Object.keys(props.get(ACTOR + '|private.milledLogs') || {});
check('...its rest kept by where it stands, so a restart does not reset it', rested.some((k) => /^p\d+_\d+$/.test(k)), rested);
r = use(LOOSE);
check('a dynamic mill nobody placed through F7 is not ours (nothing paid)', r === false && out.items.length === 0);
const PLACE = JSON.parse(require('fs').readFileSync(path.resolve(__dirname, '..', 'admin-placeables.json'), 'utf8'));
const stations = (PLACE.categories.find((c) => c.label === 'Crafting Stations') || { items: [] }).items;
check('F7 Place lists the saw mill under Crafting Stations', stations.some((row) => /^71c47:Skyrim\.esm$/i.test(row[0])), stations.length);

Date.now = realNow;
console.log('');
console.log(failures ? `${failures} FAILURES` : 'all checks passed');
process.exit(failures ? 1 : 0);
