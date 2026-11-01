// The inventory's item card (Nat, 1 Nov): dbo armourInfo [baseId] is answered with dboArmourInfo from wearInfoOf, as /armor
// is, or none for anything the rule does not count; a dynamic or bad id gets nothing, and a held arrow key at most 20
// answers a second. The block is lifted from gamemode.js and run against stubs; each mutant must fail.
//   node tests/armour-info-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const GM = fs.readFileSync(path.join(__dirname, '..', 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const i = GM.indexOf("// The inventory's item card (Nat, 1 Nov"), j = GM.indexOf('\n});\n', GM.indexOf("onUi('armourInfo'", i));
const BLOCK = i > 0 && j > i ? GM.slice(i, j + 5) : '';
ok(BLOCK.length > 300, 'gamemode.js has the armourInfo block');
ok(GM.indexOf("onUi('armourInfo'") > GM.indexOf('equipHook.__dbo = true;'), 'it sits outside the section the armour harnesses lift');

const PIECES = { 0x13952: { tier: 3, klass: 'medium', need: 30, cosmetic: false }, 0x13953: { tier: 1, klass: 'light', need: 0, cosmetic: true } };
const run = (src, live) => {
  let bad = 0;
  const t = (c, what, got) => { if (!c) bad++; if (live) ok(c, what, got); };
  try {
    let now = 1000;
    const RealDate = Date;
    const handlers = {}, sent = [];
    delete globalThis.__dboArmourInfoAsked;
    globalThis.__dboWearTier = () => 1;
    const env = { ARMOR_WEAR: { enabled: true }, wearInfoOf: (id) => PIECES[id] || null, defenseLevelOf: () => 27.6,
      onUi: (ev, fn) => { handlers[ev] = fn; }, sendPacket: (a, p) => sent.push(p), Date: { now: () => now } };
    new Function(...Object.keys(env), src)(...Object.values(env));
    const ask = (id) => { const n = sent.length; handlers.armourInfo(0x14, [id]); return sent.length > n ? sent[sent.length - 1] : null; };
    const m = ask(0x13952);
    t(m && m.id === 0x13952 && m.tier === 3 && m.klass === 'medium' && m.need === 30 && m.cosmetic === false && m.defense === 27, 'a counted piece: tier, class, the Defense it needs and the wearer\'s', m);
    const c = ask(0x13953);
    t(c && c.cosmetic === true && c.tier === 1, 'a cosmetic piece says so', c);
    const n = ask(0x12eb7);
    t(n && n.none === true && n.tier === undefined, 'anything the rule does not count answers none', n);
    t(ask(0xff000801) === null && ask('13952') === null && ask(0) === null && ask(1.5) === null, 'a dynamic form, text, 0 or a fraction gets nothing');
    now = 5000;
    let answered = 0; for (let k = 0; k < 30; k++) if (ask(0x13952)) answered++;
    t(answered === 20, 'a held arrow key: at most 20 answers in a second', answered);
    now = 6100;
    t(!!ask(0x13952), '...and answers again the next second');
    void RealDate;
  } catch (e) { bad++; if (live) ok(false, 'scenarios ran', e.stack); }
  return bad;
};
ok(run(BLOCK, true) === 0, 'all scenarios pass on the live code');
const MUTANTS = [
  ['no rate limit', '  if (n > 20) return;\n', ''],
  ['dynamic forms answered', ' || id >= 0xff000000) return;', ') return;'],
  ['the rule\'s none is not said', "if (!w) return { customPacketType: 'dboArmourInfo', id, none: true };", "if (!w) return { customPacketType: 'dboArmourInfo', id };"],
];
for (const [name, a, b] of MUTANTS) {
  if (!BLOCK.includes(a)) { ok(false, `mutant "${name}": its line is in the code`, a); continue; }
  ok(run(BLOCK.replace(a, b), false) > 0, `mutant caught: ${name}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
