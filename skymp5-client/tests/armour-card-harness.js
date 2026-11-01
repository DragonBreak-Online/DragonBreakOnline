// The armour line on SkyUI's item card (Nat, 1 Nov): the server's dboArmourInfo read, the line and its colour, when to
// ask, and the service's use of the paths the in-game probe proved on 1 Nov. With a server checkout, the server's own
// answer (gamemode.js armourInfoFor) is fed through the client's reader.
//   ./node_modules/typescript/bin/tsc src/services/services/armourCardPlan.ts --outDir <tmp> --module commonjs --target es2019
//   node tests/armour-card-harness.js <tmp>/armourCardPlan.js [server dir]
'use strict';
const fs = require('fs');
const path = require('path');
const P = require(path.resolve(process.argv[2]));
const SERVER = process.argv[3] ? path.resolve(process.argv[3]) : null;
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const ans = (o) => P.readArmourAnswer(Object.assign({ customPacketType: 'dboArmourInfo' }, o));
const a = ans({ id: 0x13952, tier: 3, klass: 'medium', need: 30, cosmetic: false, defense: 27 });
ok(a && a.id === 0x13952 && a.info.tier === 3 && a.defense === 27, 'a counted piece is read', a);
ok(P.armourLabel(a.info) === 'Tier 3 · Medium · Defense 30', 'the line is the one the probe drew in game', P.armourLabel(a.info));
const n = ans({ id: 0x12eb7, none: true });
ok(n && n.info === null, 'none: the rule does not count it, and SkyUI\'s own line stays', n);
ok(ans({ id: 5, tier: 9, klass: 'medium', need: 1 }) === null && ans({ id: 5, tier: 2, klass: 'robe', need: 1 }) === null && ans({ id: -1, none: true }) === null && P.readArmourAnswer({ customPacketType: 'x' }) === null,
  'a bad tier, an unknown class, a bad id or another packet is ignored');
const c = ans({ id: 7, tier: 1, klass: 'light', need: 0, cosmetic: true, defense: 0 });
ok(P.armourLabel(c.info) === 'Tier 1 · Light · no Defense needed' && P.armourColor(c.info, 0) === P.CARD_COLORS.cosmetic, 'a cosmetic piece needs no Defense', P.armourLabel(c.info));
const col = (d) => P.armourColor(a.info, d);
ok(col(30) === P.CARD_COLORS.within && col(40) === P.CARD_COLORS.within, 'within the Defense: SkyUI\'s grey');
ok(col(29) === P.CARD_COLORS.near && col(15) === P.CARD_COLORS.near, '1-15 short: yellow');
ok(col(14) === P.CARD_COLORS.short && P.armourColor(Object.assign({}, a.info, { need: 90 }), 46) === P.CARD_COLORS.short, '16-44 short: orange');
ok(P.armourColor(Object.assign({}, a.info, { need: 90 }), 45) === P.CARD_COLORS.far, '45 or more short: red, the full weight');
ok(col(null) === P.CARD_COLORS.within, 'before the first answer with a Defense, no warning colour');
ok(P.shouldAsk(0x13952, undefined, undefined, 0) && !P.shouldAsk(0x13952, 0, undefined, 1000) && P.shouldAsk(0x13952, 0, undefined, P.ARMOUR_INFO_TTL_MS),
  'asked once, then again after the minute it is trusted');
ok(!P.shouldAsk(0x13952, undefined, 500, 900) && P.shouldAsk(0x13952, undefined, 500, 1600), 'an unanswered ask waits a second before the next');
ok(!P.shouldAsk(0xff000801, undefined, undefined, 0) && !P.shouldAsk(0, undefined, undefined, 0), 'a crafted copy (a dynamic form) or no selection is never asked about');

const SVC = fs.readFileSync(path.join(__dirname, '..', 'src/services/services/armourCardService.ts'), 'utf8');
ok(/import \{ CARD, ITEM_MENUS, SELECTED_FORM \} from ".\/itemCardProbeService"/.test(SVC), 'the service uses the probe\'s paths, the ones proved in game');
ok(/getString\(menu, `\$\{CARD\}\.SkillTextInstance\.text`\) === label\) return;/.test(SVC), 'it writes only when SkyUI has put its own line back (no write every frame)');
ok(/event: "armourInfo", args: \[id\]/.test(SVC), 'it asks with the event the server handles');
ok(/new ArmourCardService\(sp, controller\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src/index.ts'), 'utf8')), 'it is registered in index.ts');

if (SERVER) {
  const GM = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
  const i = GM.indexOf('const armourInfoFor = '), j = GM.indexOf('\n};\n', i);
  const f = new Function('ARMOR_WEAR', 'wearInfoOf', 'defenseLevelOf', GM.slice(i, j + 4) + '\nreturn armourInfoFor;')(
    { enabled: true }, (id) => (id === 0x13952 ? { tier: 4, klass: 'heavy', need: 45, cosmetic: false } : null), () => 50.4);
  globalThis.__dboWearTier = () => 1;
  const s1 = P.readArmourAnswer(f(0x14, 0x13952)), s2 = P.readArmourAnswer(f(0x14, 0x99));
  ok(s1 && s1.info.klass === 'heavy' && s1.info.need === 45 && s1.defense === 50 && s2 && s2.info === null, 'the server\'s own answers read through the client', [s1, s2]);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
