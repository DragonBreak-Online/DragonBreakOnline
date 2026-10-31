// Party summons never fight each other (Nat, 31 Oct: "make sure party summons can't fight each other. For some reason
// summons fight each other and don't work well"). Checks:
//   1. gamemode.js partyCompanionSpares, the hit-chain gate 'party_companion': a companion of any kind never hurts its own
//      owner's side or a party member's (the member, or what fights for them); other players' sides, NPCs, duels and a
//      player's own blows are untouched; config companions.partySpare false turns it off; the gate sits in the hook;
//   2. warband.js's companionSpare sender: every owner is told their own companions, their party members and those
//      members' companions (a GM with a band, the staff too), again only when the list changes or a minute passes.
//   node tests/party-summons-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

// ---- the world: P1 and P2 in one party, P3 alone, P4 in another party; their companions ----
const P1 = 0x14, P2 = 0xff000101, P3 = 0xff000102, P4 = 0xff000103, GM = 0xff000104, STAFF = 0xff000105;
const S1 = 0xff200001, S1b = 0xff200002, S2 = 0xff200003, S3 = 0xff200004, S4 = 0xff200005, B1 = 0xff200006, NPC = 0xff300001, LOST = 0xff200009, LOST2 = 0xff20000a;
const PROFILE = { [P1]: 1, [P2]: 2, [P3]: 3, [P4]: 4, [GM]: 5, [STAFF]: 6 };
const OWNER = { [S1]: P1, [S1b]: P1, [S2]: P2, [S3]: P3, [S4]: P4, [B1]: GM, [LOST]: 0xff0009ff, [LOST2]: 0xff0009ff };
const PARTY = { 1: 1, 2: 1, 4: 4 };      // profile -> leader profile (P1 and P2 one party, P4 its own)
let duel = null;
const cfg = { companions: {} };
const mp = { get: (id, k) => { if (k === 'ff_companionOf') { if (!(id in OWNER) && id !== NPC && !(id in PROFILE)) throw new Error('gone'); return OWNER[id] || 0; } return undefined; } };
const profileOf = (a) => (PROFILE[a] !== undefined ? PROFILE[a] : -1);
globalThis.__dboPartyLeaderOf = (a) => { const p = PARTY[profileOf(a)]; return p === undefined ? null : p; };
globalThis.__dboDuelPair = (x, y) => !!duel && ((duel[0] === x && duel[1] === y) || (duel[0] === y && duel[1] === x));

// ---- 1. the gate, from gamemode.js ----
const GSRC = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const from = GSRC.indexOf('const playerSideOf = (a) => {'), to = GSRC.indexOf('globalThis.__dboPartyCompanionSpares = partyCompanionSpares;');
ok(from > 0 && to > from, 'gamemode.js has playerSideOf and partyCompanionSpares');
const spares = new Function('mp', 'profileOf', 'cfg', GSRC.slice(from, to) + '\nreturn partyCompanionSpares;')(mp, profileOf, cfg);
ok(spares(S1, S2) && spares(S2, S1), 'a summon never hurts a party member\'s summon, either way');
ok(spares(S1, P2), '...nor the party member');
ok(spares(S1, P1) && spares(S1, S1b), '...nor its own owner, nor the owner\'s other summon');
ok(!spares(S1, S3) && !spares(S3, S1) && !spares(S1, P3) && !spares(S1, S4) && !spares(S4, P2), 'another party\'s or no party\'s side is fair game (the fork\'s PvP rule decides)');
ok(!spares(S1, NPC) && !spares(NPC, S1) && !spares(NPC, P1), 'NPCs are untouched both ways');
ok(!spares(P1, S2) && !spares(P1, P2), 'a player\'s own blows are not this gate\'s (friendly fire is downed.js\'s)');
ok(!spares(LOST, P1) && !spares(S1, LOST) && !spares(LOST, LOST2), 'a companion whose owner is not an online player is no side');
ok(spares(B1, B1) === false && spares(B1, GM), 'a GM\'s band spares its GM too (any companion kind); a blow on itself is not a hit');
duel = [P1, P2];
ok(!spares(S1, S2) && !spares(S1, P2), 'two party members in a duel: their summons fight');
duel = null;
cfg.companions.partySpare = false;
ok(!spares(S1, S2) && !spares(S1, P1), 'companions.partySpare false turns the gate off (the rollback)');
cfg.companions.partySpare = true;
const hook = GSRC.slice(GSRC.indexOf('const hitDamageAttemptHook ='), GSRC.indexOf('hitDamageAttemptHook.__dbo = true'));
ok(/globalThis\.__dboHitRefusal = 'party_companion';\n\s*if \(dmg > 0 && partyCompanionSpares\(agg, tgt\)\) return false;\n\s*globalThis\.__dboHitRefusal = 'silver_test';/.test(hook.replace(/\r\n/g, '\n')), 'the hit hook refuses it before damage, as party_companion, before the fork\'s chain');
ok(/partyCompanionSpares\(agg, tgt\)\) why\.push\('one party or owner'\)/.test(GSRC), 'a refused companion hit line names it');

// ---- 2. the spare list, from warband.js ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-partysum-'));
const home = process.cwd(); process.chdir(dir);
fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [] }));
const KIND = { [B1]: 'companion' };
globalThis.__dboCompanions = { list: (o) => Object.keys(OWNER).map(Number).filter((c) => OWNER[c] === o && c !== LOST && c !== LOST2).map((id) => ({ id, ownerId: o, kind: KIND[id] || 'summon' })) };
const packets = [], timers = new Map();
let online = [P1, P2, P3, P4, GM, STAFF];
let now = 1790000000000; const realNow = Date.now; Date.now = () => now;
require(path.join(ROOT, 'warband.js'))({
  mp: { get: () => undefined }, log: () => {}, personal: () => {}, audit: () => {}, who: String, isAdmin: (a) => a === GM || a === STAFF,
  registerChatCommand: () => {}, findByName: () => 0, cfg: {}, onUi: () => {}, profileOf, onlineActors: () => online,
  every: (n, ms, fn) => timers.set(n, fn), sendPacket: (a, p) => packets.push([a, p]),
});
const sent = (a) => packets.filter(([x, p]) => x === a && p.customPacketType === 'companionSpare').map(([, p]) => p.ids);
const sorted = (xs) => xs.map((x) => x >>> 0).sort((x, y) => x - y);
timers.get('warbandSpare')();
ok(JSON.stringify(sent(P1)[0]) === JSON.stringify(sorted([S1, S1b, P2, S2])), 'P1 is told its own summons, its party member P2 and P2\'s summon', sent(P1));
ok(JSON.stringify(sent(P2)[0]) === JSON.stringify(sorted([S2, P1, S1, S1b])), '...and P2 the same from its side', sent(P2));
ok(JSON.stringify(sent(P3)[0]) === JSON.stringify(sorted([S3])), 'P3, in no party, only its own summon', sent(P3));
ok(JSON.stringify(sent(GM)[0]) === JSON.stringify(sorted([B1, GM, STAFF])), 'a GM with a band: the band and the staff online', sent(GM));
ok(!sent(STAFF).length, 'someone with no companions is sent nothing');
packets.length = 0; now += 10000; timers.get('warbandSpare')();
ok(!packets.length, 'nothing again while the lists stay the same');
PARTY[3] = 1; packets.length = 0; now += 10000; timers.get('warbandSpare')();
ok(JSON.stringify(sent(P3)[0]) === JSON.stringify(sorted([S3, P1, S1, S1b, P2, S2])) && sent(P1).length === 1 && sent(P1)[0].includes(P3) && sent(P1)[0].includes(S3), 'P3 joins the party: every member is told again, P3 and its summon included', [sent(P3), sent(P1)]);
packets.length = 0; now += 61000; timers.get('warbandSpare')();
ok(sent(P1).length === 1, '...and once a minute anyway (a client that relogged)');
delete PARTY[3];

process.chdir(home);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows may hold it */ }
Date.now = realNow; delete globalThis.__dboCompanions; delete globalThis.__dboWarband;
console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exitCode = fails ? 1 : 0;
