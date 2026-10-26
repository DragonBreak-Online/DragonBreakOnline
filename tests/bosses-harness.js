// Bosses worth grinding (Nat, 25 Oct; bosses.js, bosses.json from tools/bosses/bosses_build.py). Loads the real bosses.js
// in a scratch folder with a mock gamemode api and walks a fight: the zones it writes (and keeps the others'), a boss
// rising (named, glowing, announced to its hold), toughness while its guardian lives and after, waves at their shares,
// enrage, its damage on players, the reward per fighter (10% share, the top damager's shards, the schematic or the known
// bonus, Briarhearts left out, a companion's damage for its owner), the 20 h account lockout, a roaming boss's next spot,
// and the boss-only schematic hook in manuals.js.
//   node tests/bosses-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!c) fails++; };
const REAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'bosses.json'), 'utf8'));
const def = (id) => REAL.bosses.find((b) => b.id === id);

// ---- the shipped data ----
ok(REAL.bosses.map((b) => b.id).join() === 'icecap,briarheartking,centurion,palewarlord,falmerwarmonger,movarth,duskthorn,valkynaz,karstaag,risenlegate,minotaurlord,minotaurtest1,minotaurtest2,werewolfbehemoth',
  'eight bosses: the Ice Cap Wraith, the Briarheart King, the Centurion Master, the Warlord of the Pale Pass, the Falmer Warmonger, the Master of Movarth\'s Lair, the Warchief of Dusk Thorn, the Valkynaz');
ok(def('movarth').night === true && !def('valkynaz').event && def('valkynaz').respawnSeconds === 10800 && def('falmerwarmonger').guardian.options.length && def('duskthorn').guardian.options.length,
  'Movarth\'s master walks at night, the Valkynaz stands on its own (Nat 26 Oct: it was a GM event), the Warmonger and the Warchief have their shamans');
ok(def('valkynaz').guardian.options[0][2] === 'mihailhighclannfear_NPC' && def('valkynaz').adds[0].options.some((o) => o[2] === 'DDRClannfear') && def('valkynaz').adds[1].options.every((o) => /Scamp/.test(o[2])),
  '...with a High Clannfear guardian, Clannfear and scamps (Nat 26 Oct: "nor Clennifar or the scamp minions with it")');
ok(def('falmerwarmonger').spots.length === 1 && def('falmerwarmonger').spots[0].id === 'BE' && def('falmerwarmonger').spots[0].pos[2] > 1040,
  'the Warmonger stands on the dry shore east of the city (BE, above the lakes at 1000), not by the wild Falmer anchors where the arrival froze a client');
ok(!JSON.stringify(def('valkynaz').drops).includes('IngotEbony') && def('valkynaz').drops.always.some((x) => x[2] === 'DaedraHeart'), 'the Valkynaz drops a daedra heart and no Ebony (never loot)');
ok(def('palewarlord').devOnly === true && def('palewarlord').spots.map((s) => s.id).join() === 'SE,ST' && def('palewarlord').roam === true,
  'the Warlord of the Pale Pass: dev only, at SE (under the Sentinel) roaming to ST (Serpent’s Trail), SR dropped (Nat, 25 Oct)');
ok(def('icecap').enabled === false && def('briarheartking').enabled && def('centurion').enabled, 'the Wraith and the Warlord wait on Nat (spot, shard); the King and the Centurion are on');
ok(def('icecap').boss.options[0][2] === 'EncIceWraith' && def('icecap').spots.length === 1 && def('icecap').spots[0].id === 'SK' && def('icecap').drops.schematic.family === 'glacial_crystal', 'the Wraith: a vanilla ice wraith at Skytemple Ruins (Nat 26 Oct), the Glacial Crystal schematic');
ok(def('briarheartking').boss.options.slice(-1)[0][2] === 'EncForsworn06BossMagicBretonM03' && def('briarheartking').guardian.options[0][2] === 'EncHagraven', 'the King: the strongest Forsworn boss shaman, his Hagraven beside him');
ok(REAL.bosses.every((b) => b.spots.every((s) => s.ref && s.anchorDist < 5000)), 'every spot has an anchor within 5000 units (Sancre Tor\'s and Minotaur\'s Rest\'s are the ones Nate\'s own zones there use)');
ok(def('karstaag').enabled === false && /Solstheim/.test(def('karstaag').waitingOn) && def('karstaag').boss.options[0][2] === 'DLC2dunKarstaag', 'Karstaag is defined and off until Solstheim opens');
ok(['minotaurtest1', 'minotaurtest2'].every((id) => def(id).devOnly === true && /Minotaur's Rest/.test(def(id).spots[0].note)) && def('minotaurtest2').rearm === '6026df:BSAssets.esm',
  'the Minotaur Lord\'s two tests are dev-only, at Minotaur\'s Rest; test 2 re-arms BSKMinotaurLordAxe');
ok(def('minotaurlord').enabled === false && !def('minotaurlord').devOnly && def('minotaurlord').drops.always.some((x) => x[2] === 'CYRMinotaurHorn'), 'the live Minotaur Lord waits on the test, his drop the beast\'s own horn and hide');
ok(def('risenlegate').enabled === true && !def('risenlegate').devOnly && def('risenlegate').boss.options[0][2] === 'BSKEncZombie03' && def('risenlegate').adds.length === 5 && def('risenlegate').drops.schematic.family === 'adamantium',
  'Sancre Tor stays undead: the Risen Legate is a full boss with an undead legion of Sancre Tor\'s own pools, Adamantium 3%');
ok(def('centurion').drops.extra.some((x) => x[0] === '17749:Dragonborn.esm' && x[1] === 0.05 && x[3] === 'DLC2HeartStone'), 'the Centurion Master drops a Heart Stone at 5%');

// ---- a scratch folder and a test copy where every boss is on ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-bosses-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
const SHARD = '3ad5f:Skyrim.esm';   // a stand-in for the Glacial Crystal Shard until Worker 2's id exists
const copy = JSON.parse(JSON.stringify(REAL));
for (const b of copy.bosses) { b.enabled = true; if (b.id === 'palewarlord') delete b.devOnly; }   // the Warlord's roaming is tested off the dev flag
copy.bosses.find((b) => b.id === 'icecap').drops.shards.desc = SHARD;
fs.writeFileSync(path.join(dir, 'bosses.json'), JSON.stringify(copy));
fs.writeFileSync(path.join(dir, 'NPC-Spawns.json'), JSON.stringify({ zones: [{ Name: 'wild:wolf:1', NPC: [{ id: 'x', count: 1 }] }, { Name: 'dungeon:X:1', NPC: [] }] }));

let now = 1790000000000;
const realNow = Date.now; Date.now = () => now;
let rnd = 0.5; const realRandom = Math.random; Math.random = () => rnd;
const P1 = 0xff000101, P2 = 0xff000102, P3 = 0xff000103, BRIAR = 0xff000104, PET = 0xff000105, FAR = 0xff000106;
const PROFILE = { [P1]: 11, [P2]: 12, [P3]: 13, [BRIAR]: 14, [FAR]: 16 };
const props = new Map(), said = [], audits = [], given = [], names = [], glows = [];
const put = (id, k, v) => props.set(`${id}|${k}`, v);
const PLUGINS = { 'Skyrim.esm': 0, 'Dragonborn.esm': 2, 'BSHeartland.esm': 8, 'BSAssets.esm': 7 };
const logs = [];
const idOf = (d) => { const [h, p] = String(d).split(':'); if (!(p in PLUGINS)) throw new Error('no plugin ' + p); return ((PLUGINS[p] << 24) | parseInt(h, 16)) >>> 0; };
const mp = {
  get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v), getIdFromDesc: idOf, getDescFromId: (id) => (id >>> 0).toString(16),
  callPapyrusFunction: (kind, cls, fn, self, args) => { if (fn === 'SetDisplayName') names.push([self.desc, args[0]]); },
};
const HOLD = { [P1]: 'markarth', [P2]: 'markarth', [P3]: 'markarth', [BRIAR]: 'markarth', [FAR]: 'whiterun' };
for (const a of Object.keys(HOLD)) put(a, 'worldOrCellDesc', '3c:Skyrim.esm');
put(PET, 'private.dboCompanion', true); put(PET, 'ff_companionOf', P3);
globalThis.__dboSchematicBook = (fam) => ({ bookId: 0x7000, name: `Schematics: ${fam}` });
let known = new Set();
globalThis.__dboKnowsFamily = (a, fam) => known.has(`${a}:${fam}`);
globalThis.__dboIsBriarheart = (a) => a === BRIAR;
const timers = new Map();
const commands = new Map();
const LEAD = 0xff000107;
const cwd = process.cwd();
const load = (cfg) => {
  process.chdir(dir);
  try {
    delete require.cache[path.join(ROOT, 'bosses.js')];
    require(path.join(ROOT, 'bosses.js'))({ mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), display: (a) => `P${(a >>> 0).toString(16)}`, who: String,
      cfg: cfg || {}, giveItem: (a, id, n) => { given.push([a, id, n]); return true; }, registerChatCommand: (n, fn) => commands.set(n, fn), sendPacket: (a, p) => glows.push([a, p]), isLeadStaff: (a) => a === LEAD,
      onlineActors: () => [P1, P2, P3, BRIAR, FAR], every: (n, ms, fn) => timers.set(n, fn), stopTimer: () => {}, profileOf: (a) => (PROFILE[a] !== undefined ? PROFILE[a] : -1), zoneOfActor: (a) => HOLD[a] || null });
  } finally { process.chdir(cwd); }
};
const zones = () => JSON.parse(fs.readFileSync(path.join(dir, 'NPC-Spawns.json'), 'utf8')).zones;
const hasZone2 = (name) => zones().some((x) => x.Name === name);
const tick = (live) => { fs.writeFileSync(path.join(dir, 'zone-spawns.json'), JSON.stringify(live)); process.chdir(dir); try { timers.get('bosses')(); } finally { process.chdir(cwd); } };
const toldTo = (a) => said.filter((x) => x[0] === a).map((x) => x[1]).join(' | ');

// ---- zones ----
load({});
let z = zones();
ok(z.some((x) => x.Name === 'wild:wolf:1') && z.some((x) => x.Name === 'dungeon:X:1'), 'the other modules\' zones are kept');
const bz = z.filter((x) => x.Name.startsWith('boss:'));
const king = bz.find((x) => x.Name === 'boss:briarheartking:boss'), hag = bz.find((x) => x.Name === 'boss:briarheartking:guardian');
ok(king && hag && king.Hostile && hag.Hostile && king.Respawn === 7200 && king.NPC[0].id === 'ad7c1:Skyrim.esm', 'the King and his Hagraven: hostile boss zones, back 2 h after a kill, the strongest boss shaman', [king, hag]);
ok(bz.filter((x) => /^boss:icecap:open\d$/.test(x.Name)).length === 3 && bz.filter((x) => /^boss:palewarlord:open\d$/.test(x.Name)).length === 2, 'opening adds: the Wraith\'s three ice wraiths, the Warlord\'s two bandits');
load({ bosses: { only: ['centurion'] } });
ok(zones().filter((x) => x.Name.startsWith('boss:')).every((x) => x.Name.startsWith('boss:centurion:')), 'bosses.only keeps the rest\'s zones out');
load({ bosses: { enabled: false } });
ok(!zones().some((x) => x.Name.startsWith('boss:')), 'bosses.enabled false writes no boss zone (the rollback)');
load({});

// ---- a fight: the Briarheart King ----
const K = 0xff200001, H = 0xff200002, ADD = 0xff200003;
put(K, 'private.npcSpawner', 'boss:briarheartking:boss'); put(H, 'private.npcSpawner', 'boss:briarheartking:guardian');
put(K, 'percentages', { health: 1, magicka: 1, stamina: 1 });
tick([K, H]);
ok(names.some(([d, n]) => d === K.toString(16) && n === 'The Briarheart King') && names.some(([d, n]) => d === H.toString(16) && n === "The King's Hagraven"), 'the King and his Hagraven are named', names);
ok(glows.some(([, p]) => p.kind === 'champion' && p.refs.includes(K) && p.on), 'the King glows as a champion does (SetScale is a stub)');
ok(/crowned a Briarheart King/.test(toldTo(P1)) && !/crowned/.test(toldTo(FAR)), 'Markarth\'s hold hears he has risen; Whiterun does not');
const hit = (agg, tgt, dmg, healthAfter) => { put(tgt, 'percentages', { health: healthAfter, magicka: 1, stamina: 1 }); globalThis.__dboBossHit(agg, tgt, dmg); return props.get(`${tgt}|percentages`).health; };
let h = hit(P1, K, 100, 0.9);
ok(Math.abs(h - (0.9 + 0.1 * 0.85)) < 1e-9, 'while the Hagraven lives, 85% of each blow is given back', h);
globalThis.__dboBossDeath(H, P2);
ok(/laid open/.test(toldTo(P1)), 'the Hagraven falls: the King is laid open');
h = hit(P2, K, 250, h - 0.1);
ok(Math.abs(h - (0.985 - 0.1 + 0.1 * 0.4)) < 1e-9, '...and then only 40% is given back', h);
ok(globalThis.__dboBossDamageMult(K, P1) === 1.5 && globalThis.__dboBossDamageMult(ADD, P1) === 1 && globalThis.__dboBossDamageMult(K, ADD) === 1, 'the King hits players x1.5; an add, or a hit on an NPC, is untouched');
h = hit(P3, K, 300, 0.45);
ok(zones().filter((x) => /^boss:briarheartking:w0-\d$/.test(x.Name)).length === 2 && zones().find((x) => x.Name === 'boss:briarheartking:w0-0').Respawn === 1e9, 'below 66%: the first wave, two Forsworn beside him, never respawning', zones().filter((x) => x.Name.includes(':w')).map((x) => x.Name));
h = hit(PET, K, 200, 0.1);
ok(zones().filter((x) => /^boss:briarheartking:w1-\d$/.test(x.Name)).length === 3, 'below 33%: the second wave of three');
now += 481000; tick([K]);
ok(globalThis.__dboBossDamageMult(K, P1) === 2.5 && /grows furious/.test(toldTo(P2)), 'eight minutes after the first blow he is enraged: x2.5');
hit(BRIAR, K, 400, 0.1);
hit(FAR, K, 20, 0.05);   // under 10% of the damage
given.length = 0; said.length = 0; rnd = 0.01;
globalThis.__dboBossDeath(K, P1);
const gotBy = (a) => given.filter((g) => g[0] === a);
ok(gotBy(P1).some((g) => g[1] === idOf('3ad61:Skyrim.esm')) && gotBy(P2).length && gotBy(P3).length, 'every fighter with a real share gets the Briar Heart (P3 for his companion\'s blows too)', given);
ok(gotBy(P1).some((g) => g[1] === 0x7000), '...and at a lucky roll the Silver schematic');
ok(!gotBy(FAR).length, 'a fighter under 10% of the damage gets nothing');
ok(!gotBy(BRIAR).length && /of your own blood/.test(toldTo(BRIAR)), 'a Briarheart gets nothing for the King');
ok(!zones().some((x) => x.Name.startsWith('boss:') && x.Name.includes(':w')) && /fallen/.test(toldTo(P1)), 'the waves go with the fight; the hold hears he has fallen', [zones().filter((x) => x.Name.includes(':w')).map((x) => x.Name), toldTo(P1)]);
ok(audits.some((t) => /^BOSS briarheartking killed at LV \(enraged\) by /.test(t)), 'audited, enraged', audits.slice(-1));
// His body lies in the live list until it despawns: it is not a new King rising (dev, 25 Oct: the Centurion "rose" again)
put(K, 'isDead', true); audits.length = 0; said.length = 0; glows.length = 0;
tick([K]); tick([K]);
ok(!audits.some((t) => /^BOSS briarheartking rose/.test(t)) && !said.some(([, t]) => /stirs|rises|wakes/.test(t)) && !glows.length, 'his body, still in the live list, is no new King: no rising, no announcement, no glow', audits);
put(K, 'isDead', false);
// The lockout: the next King inside 20 h pays nothing
put(K, 'percentages', { health: 1, magicka: 1, stamina: 1 });
now += 7200000; tick([K]);
hit(P1, K, 100, 0.5); given.length = 0; said.length = 0;
globalThis.__dboBossDeath(K, P1);
ok(!gotBy(P1).length && /reward from it lately\. 18 hours to go/.test(toldTo(P1)), 'a second King within 20 h pays that account nothing', toldTo(P1));

// ---- the Wraith: shards, the top damager, the known bonus ----
const W = 0xff300001;
put(W, 'private.npcSpawner', 'boss:icecap:boss'); put(W, 'percentages', { health: 1, magicka: 1, stamina: 1 });
HOLD[P1] = HOLD[P2] = 'winterhold';
tick([W]);
hit(P1, W, 600, 0.5); hit(P2, W, 400, 0.2);
known = new Set([`${P2}:glacial_crystal`]);
given.length = 0; rnd = 0.02;
globalThis.__dboBossDeath(W, P1);
const shards = (a) => given.filter((g) => g[0] === a && g[1] === idOf(SHARD)).reduce((n, g) => n + g[2], 0);
ok(shards(P1) === 7 + 2 && gotBy(P1).some((g) => g[1] === 0x7000 && g[2] === 1), 'the top damager: 7 shards + 2 Frost Salts, and at a 2% roll the Glacial schematic', gotBy(P1));
ok(shards(P2) === 5 + 2 + 2 && !gotBy(P2).some((g) => g[1] === 0x7000), 'a smith who knows Glacial Crystal: 5 shards, 2 more instead of the schematic (+2 Frost Salts)', gotBy(P2));

// ---- the roaming Warlord moves on after a kill ----
const B = 0xff400001;
put(B, 'private.npcSpawner', 'boss:palewarlord:boss'); put(B, 'percentages', { health: 1, magicka: 1, stamina: 1 });
tick([B]);
const before = zones().find((x) => x.Name === 'boss:palewarlord:boss').POS.join();
hit(P3, B, 100, 0.3);
globalThis.__dboBossDeath(B, P3);
const after = zones().find((x) => x.Name === 'boss:palewarlord:boss').POS.join();
ok(before !== after && after === copy.bosses.find((b) => b.id === 'palewarlord').spots[1].pos.join(), 'the Warlord of the Pale Pass rises at his next camp', [before, after]);
ok(JSON.parse(fs.readFileSync(path.join(dir, 'bosses-state.json'), 'utf8')).spot.palewarlord === 1, '...kept in bosses-state.json');

// ---- each boss's own config block (Nat, 25 Oct: they go live one by one) ----
fs.writeFileSync(path.join(dir, 'bosses.json'), JSON.stringify(REAL));
load({ bosses: { icecap: { enabled: true, spot: 'SK' }, briarheartking: { enabled: false } } });
const cz = zones().filter((x) => x.Name.startsWith('boss:'));
const wraith = cz.find((x) => x.Name === 'boss:icecap:boss');
ok(wraith && wraith.POS.join() === def('icecap').spots[0].pos.join(), 'bosses.icecap { enabled, spot: SK } turns the Wraith on at Skytemple Ruins, whatever bosses.json says', wraith);
ok(cz.some((x) => x.Name === 'boss:valkynaz:boss') && cz.some((x) => x.Name === 'boss:valkynaz:guardian'), 'the Valkynaz stands at the Great Gate with its High Clannfear, no event needed');
load({ bosses: { icecap: { enabled: true, spot: 'S3' } } });
ok((zones().find((x) => x.Name === 'boss:icecap:boss') || { POS: [] }).POS.join() === def('icecap').spots[0].pos.join(), '...and a pin to a retired spot (S3) falls back to Skytemple Ruins');
ok(!cz.some((x) => x.Name.startsWith('boss:briarheartking:')) && cz.some((x) => x.Name === 'boss:centurion:boss') && !cz.some((x) => x.Name.startsWith('boss:palewarlord:')),
  'bosses.briarheartking.enabled false takes the King off; the Centurion stays on and the Warlord off as the data says');
ok(def('icecap').drops.shards.desc === '1d2201:DragonBreak Online Edits.esp' && def('icecap').drops.shards.count === 5 && def('icecap').drops.shards.top === 7,
  'the Wraith drops the Glacial Crystal Shard (DLE 1D2201): 5 a fighter, 7 for the top damager (a 36-shard set in 5-7 days)');

// ---- 26 Oct: one name per boss, Beyond Skyrim's Valkynaz, the Warmonger's opening adds after it rises ----
ok(new Set(REAL.bosses.map((b) => b.name.toLowerCase())).size === REAL.bosses.length, 'every boss has its own name (Nat 26 Oct: two "The Minotaur Lord" at once were the two axe tests)', REAL.bosses.map((b) => b.name));
ok(def('valkynaz').boss.options[0][1] === 'ddb29:BSHeartland.esm' && def('valkynaz').boss.edid === 'CYREncDremoraWarlock06', 'the Valkynaz is Beyond Skyrim\'s Dremora Valkynaz (ddb29), Nat\'s choice');
ok(def('falmerwarmonger').openingDelaySeconds === 4 && def('falmerwarmonger').openingStepSeconds === 3, 'the Warmonger\'s opening adds wait 4 s after it rises, then come 3 s apart');
load({ bosses: { only: ['falmerwarmonger', 'centurion'] } });
const openOf = (id) => zones().filter((x) => new RegExp(`^boss:${id}:open\\d$`).test(x.Name)).length;
ok(hasZone2('boss:falmerwarmonger:boss') && hasZone2('boss:falmerwarmonger:guardian') && openOf('falmerwarmonger') === 0, 'before it rises: the Warmonger and its shaman, no opening adds yet', zones().map((x) => x.Name));
ok(openOf('centurion') === def('centurion').openingAdds, '...a boss without the setting has its opening adds at once, as before', openOf('centurion'));
const WM = 0xff500077;
put(WM, 'private.npcSpawner', 'boss:falmerwarmonger:boss'); put(WM, 'percentages', { health: 1, magicka: 1, stamina: 1 });
tick([WM]);
ok(openOf('falmerwarmonger') === 0, 'it rises: still no adds on that tick');
now += 4100; tick([WM]);
ok(openOf('falmerwarmonger') === 1, '4 s later the first add comes', openOf('falmerwarmonger'));
now += 3000; tick([WM]);
ok(openOf('falmerwarmonger') === 2, '...and 3 s after that the second', openOf('falmerwarmonger'));
now += 60000; tick([WM]);
ok(openOf('falmerwarmonger') === def('falmerwarmonger').openingAdds, '...never more than its openingAdds', openOf('falmerwarmonger'));

// ---- the night boss and the event boss ----
// bosses.js still runs event bosses (/bossevent); since 26 Oct none ships as one, so the Valkynaz is made one for this part
const EV = JSON.parse(JSON.stringify(REAL));
EV.bosses.find((b) => b.id === 'valkynaz').event = { minutes: 30, waveEverySeconds: 300, waveSize: 3 };
fs.writeFileSync(path.join(dir, 'bosses.json'), JSON.stringify(EV));
let night = false;
globalThis.__dboClock = { isNight: () => night };
load({});
const hasZone = (name) => zones().some((x) => x.Name === name);
ok(!hasZone('boss:movarth:boss') && hasZone('boss:falmerwarmonger:boss') && hasZone('boss:duskthorn:guardian'), 'by day the Master of Movarth\'s Lair is nowhere; the Warmonger and the Warchief stand with their shamans');
night = true; tick([]);
ok(hasZone('boss:movarth:boss') && zones().filter((x) => /^boss:movarth:open\d$/.test(x.Name)).length === 2, 'at nightfall he rises at the mouth of his lair with two thralls');
night = false; tick([]);
ok(!hasZone('boss:movarth:boss'), '...and is gone at dawn when nobody is fighting him');
const M = 0xff500001;
night = true; tick([]);
put(M, 'private.npcSpawner', 'boss:movarth:boss'); put(M, 'percentages', { health: 1, magicka: 1, stamina: 1 });
tick([M]); hit(P1, M, 50, 0.8);
night = false; tick([M]);
ok(hasZone('boss:movarth:boss'), 'a fight in progress runs on past dawn');
ok(!hasZone('boss:valkynaz:boss'), 'the Valkynaz stands nowhere until an event');
// ---- the Werewolf Behemoth: dev only, at night; fullMoon keeps it to full-moon nights ----
const ww = def('werewolfbehemoth');
ok(ww && ww.devOnly === true && ww.night === true && ww.hold === 'falkreath' && ww.spots.length === 3 && ww.boss.options.length && ww.adds.length === 3,
  'the Behemoth of Hircine\'s Hunt: dev only, a night boss of Falkreath, three spots, a werewolf and two wolves for its pack');
ok(ww.drops.always.some((x) => x[2] === 'WerewolfPelt') && ww.drops.always.some((x) => x[2] === 'WolfPelt') && ww.drops.schematic.family === 'silver' && ww.drops.extraSchematic.family === 'glass',
  '...it drops a Werewolf Pelt and wolf pelts, Silver 5%, Glass 1%');
ok(ww.boss.options.length === 1 && ww.boss.options[0][1] === '1d2207:DragonBreak Online Edits.esp' && ww.boss.edid === 'DBO_EncWerewolfBehemothBoss' && ww.boss.options[0][0] === 42,
  '...the boss is its own NPC on the Behemoth race, DLE 1D2207 (the merge by Worker 3, 1.3x the pack), level 42 as its template');
let moonUp = false;
globalThis.__dboClock = { isNight: () => night, isFullMoon: () => moonUp };
night = true; load({ bosses: { devOnly: true } });
ok(hasZone('boss:werewolfbehemoth:boss') && zones().filter((x) => /^boss:werewolfbehemoth:open\d$/.test(x.Name)).length === 3, 'on the dev server at night it stands with its pack of three');
load({ bosses: { devOnly: true, werewolfbehemoth: { fullMoon: true } } });
ok(!hasZone('boss:werewolfbehemoth:boss'), 'fullMoon true: not on an ordinary night');
moonUp = true; tick([]);
ok(hasZone('boss:werewolfbehemoth:boss'), '...but on a full-moon night it rises');
moonUp = false; night = false; load({});
ok(!hasZone('boss:werewolfbehemoth:boss'), 'off the dev server it writes nothing');
said.length = 0;
commands.get('bossevent')(P1, ['valkynaz']);
ok(!hasZone('boss:valkynaz:boss') && /Only a Lead GM/.test(toldTo(P1)), 'a player cannot start the event');
commands.get('bossevent')(LEAD, ['valkynaz']);
ok(hasZone('boss:valkynaz:boss') && zones().filter((x) => /^boss:valkynaz:open\d$/.test(x.Name)).length === 3 && audits.some((t) => /^BOSS valkynaz event started by .* for 30 min$/.test(t)), 'a Lead GM opens the gate: the Valkynaz and three Dremora, audited');
now += 301000; tick([]);
ok(zones().filter((x) => /^boss:valkynaz:e0-\d$/.test(x.Name)).length === 3, 'five minutes in, a wave of three more comes through');
now += 30 * 60000; tick([]);
ok(!hasZone('boss:valkynaz:boss') && !zones().some((x) => x.Name.startsWith('boss:valkynaz:')) && audits.some((t) => /^BOSS valkynaz event ended$/.test(t)), 'after thirty minutes the gate closes and every zone of it goes, felled or not');

// ---- the dev-only tests: the Minotaur Lord's axe, the Risen Legate ----
load({});
ok(!zones().some((x) => /^boss:(minotaurtest1|minotaurtest2):/.test(x.Name)) && hasZone('boss:risenlegate:boss'), 'off the dev server the test bosses write nothing; the Legate stands');
load({ bosses: { devOnly: true } });
ok(hasZone('boss:minotaurtest1:boss') && hasZone('boss:minotaurtest2:boss') && !hasZone('boss:karstaag:boss') && !hasZone('boss:minotaurlord:boss'), 'bosses.devOnly true: both Minotaur Lord tests stand; Karstaag and the live Lord stay off');
const MT = 0xff600001, AXE = idOf('6026df:BSAssets.esm');
put(MT, 'private.npcSpawner', 'boss:minotaurtest2:boss'); put(MT, 'percentages', { health: 1, magicka: 1, stamina: 1 });
put(MT, 'inventory', { entries: [{ baseId: 0x123, count: 1 }] });
put(MT, 'equipment', { inv: { entries: [{ baseId: 0x123, count: 1, worn: true }] } });
logs.length = 0; tick([MT]);
ok(props.get(`${MT}|inventory`).entries.some((e) => e.baseId === AXE) && logs.some((l) => /minotaurtest2 ff600001 rearmed with 6026df:BSAssets\.esm/.test(l)), 'test 2: the axe goes back into the copy\'s inventory, logged', logs);
ok(logs.some((l) => /minotaurtest2 ff600001 equipment at spawn: \["123"\]/.test(l)), 'the trace logs what it wears at spawn', logs);
put(MT, 'equipment', { inv: { entries: [{ baseId: 0x123, count: 1, worn: true }, { baseId: AXE, count: 1, worn: true }] } });
logs.length = 0; tick([MT]);
ok(logs.some((l) => /equipment changed: \["123","[0-9a-f]*6026df"\]/.test(l)), '...and each change, so the dev log shows whether the axe stays in hand through a host change', logs);
logs.length = 0; tick([MT]);
ok(!logs.some((l) => /equipment/.test(l)), '...and nothing while it stays the same');
const CT = 0xff700001;
put(CT, 'private.npcSpawner', 'boss:centurion:boss'); put(CT, 'percentages', { health: 1, magicka: 1, stamina: 1 });
tick([CT]); hit(P3, CT, 100, 0.2);
given.length = 0; rnd = 0.01;
globalThis.__dboBossDeath(CT, P3);
ok(given.some((g) => g[0] === P3 && g[1] === idOf('17749:Dragonborn.esm') && g[2] === 1), 'the Centurion Master: a Heart Stone at a lucky roll', given);

// ---- manuals.js: the boss-only schematic hook ----
const msrc = fs.readFileSync(path.join(ROOT, 'manuals.js'), 'utf8');
ok(/globalThis\.__dboSchematicBook = \(family\) =>/.test(msrc) && /!x\.staffOnly && !x\.withheld/.test(msrc) && /globalThis\.__dboKnowsFamily = /.test(msrc), 'manuals.js hands a family\'s schematic to a boss (never a staff-only or withheld one) and says whether a smith knows it');
const gsrc = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(/__dboBossDeath\(Number\(actorId\)/.test(gsrc) && /__dboBossHit\(agg, tgt, dealt\)/.test(gsrc) && /__dboBossDamageMult\(agg, tgt\)/.test(gsrc) && /require\(BOSSES_JS\)/.test(gsrc), 'gamemode.js loads bosses.js and calls its death, hit and damage hooks');

Date.now = realNow; Math.random = realRandom;
// ---- boss nameplates: the names go to the players near a boss, once, and are cleared at its death ----
{
  const labelsTo = (a) => glows.filter(([to, p]) => to === a && p.customPacketType === 'dboActorLabels').map(([, p]) => p.list);
  const LB = 0xff250001;
  put(LB, 'private.npcSpawner', 'boss:centurion:boss'); put(LB, 'percentages', { health: 1, magicka: 1, stamina: 1 });
  put(LB, 'worldOrCellDesc', '3c:Skyrim.esm'); put(LB, 'pos', [0, 0, 0]);
  put(P1, 'pos', [300, 0, 0]); put(FAR, 'pos', [90000, 0, 0]);
  glows.length = 0;
  tick([LB]);
  const p1 = labelsTo(P1), far = labelsTo(FAR);
  ok(p1.length === 1 && p1[0].length === 1 && p1[0][0].id === LB && p1[0][0].text === 'The Centurion Master' && Array.isArray(p1[0][0].color),
    'a player beside the risen boss is sent its name to draw over its head (dboActorLabels)', p1);
  ok(far.length === 0, 'a player outside its radius is sent nothing', far);
  tick([LB]);
  ok(labelsTo(P1).length === 1, 'the same list is not sent again on the next tick');
  put(FAR, 'pos', [200, 100, 0]); tick([LB]);
  ok(labelsTo(FAR).length === 1 && labelsTo(FAR)[0][0].id === LB, 'a player who walks into the radius is sent it then');
  put(LB, 'isDead', true); globalThis.__dboBossDeath(LB, P1);
  const after = labelsTo(P1);
  ok(after.length === 2 && after[1].length === 0, 'at its death the name is cleared (an empty list)', after);
  put(FAR, 'pos', [90000, 0, 0]); put(P1, 'pos', undefined); props.delete(`${P1}|pos`); props.delete(`${FAR}|pos`);
  const bsrc = fs.readFileSync(path.join(ROOT, 'bosses.js'), 'utf8');
  ok(/sweep\(\); \} catch[\s\S]{0,80}sendLabels\(\)/.test(bsrc), 'the boss timer sends the labels after each sweep');
}
console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
