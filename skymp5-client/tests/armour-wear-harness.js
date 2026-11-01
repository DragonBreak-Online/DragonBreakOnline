// The armour slow on the player's own game (Nat, 31 Oct; gameplay gamemode.js armorWear debuff mode): dboArmourWear
// { speedMult } sets a SpeedMult that adds to the other slows. No stamina GMST is touched: a game setting is global, so it
// would change every NPC this client hosts too (Leader, 31 Oct). Runs armourWearPlan.ts (transpiled with the client's
// TypeScript) against a fake SpeedMult that a timed slow also moves, checks the service's wiring in its source, and kills
// mutants of the plan.
//   node tests/armour-wear-harness.js   (from skymp5-client)
'use strict';
const fs = require('fs');
const path = require('path');
const client = path.resolve(__dirname, '..');
const svc = path.join(client, 'src', 'services', 'services');
const ts = require(path.join(client, 'node_modules', 'typescript'));
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
const PLAN_SRC = fs.readFileSync(path.join(svc, 'armourWearPlan.ts'), 'utf8');
const load = (src) => { const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText; const m = {}; new Function('exports', js)(m); return m; };

const scenarios = (plan, live) => {
  let bad = 0;
  const t = (name, ok, got) => { if (!ok) bad++; if (live) check(name, ok, got); };
  const game = { speed: 100 };
  const held = { speed: 0 };
  const apply = (packet) => { const o = plan.readArmourWearOrder(packet); if (!o) return null; game.speed += plan.armourWearSteps(held, o).speedDelta; held.speed = o.speed; return o; };
  t('a foreign packet is not an order', plan.readArmourWearOrder({ customPacketType: 'dboStatus', speedMult: -50 }) === null);
  apply({ customPacketType: 'dboArmourWear', speedMult: -20 });
  t('-20: SpeedMult 80', game.speed === 80, game);
  game.speed -= 50;   // a howl's timed slow on top
  apply({ customPacketType: 'dboArmourWear', speedMult: -10 });
  t('a lighter order while a howl holds: only the armour share moves (SpeedMult 40 = 100 - 10 armour - 50 howl)', game.speed === 40, game.speed);
  game.speed += 50;   // the howl ends
  apply({ customPacketType: 'dboArmourWear', speedMult: 0 });
  t('the order lifted: SpeedMult back to 100', game.speed === 100, game);
  t('a speed-up is clamped to 0, a slow past -90 to -90', plan.readArmourWearOrder({ customPacketType: 'dboArmourWear', speedMult: 40 }).speed === 0 && plan.readArmourWearOrder({ customPacketType: 'dboArmourWear', speedMult: -400 }).speed === -90);
  t('a malformed order is no slow', plan.readArmourWearOrder({ customPacketType: 'dboArmourWear', speedMult: 'x' }).speed === 0);
  return bad;
};
scenarios(load(PLAN_SRC), true);

const service = fs.readFileSync(path.join(svc, 'armourWearService.ts'), 'utf8');
const index = fs.readFileSync(path.join(client, 'src', 'index.ts'), 'utf8');
const caps = fs.readFileSync(path.join(client, 'src', 'lib', 'clientUiCaps.ts'), 'utf8');
check('index.ts creates ArmourWearService', /new ArmourWearService\(sp, controller\)/.test(index));
check('the client advertises the armourWear capability (the server tells only what applies)', /CLIENT_UI_CAPS[^;]*"armourWear"/.test(caps));
check('the service applies on a frame, and clears on connect and disconnect', /controller\.on\("update"/.test(service) && /"connectionAccepted", \(\) => this\.order\(\{ speed: 0 \}\)/.test(service) && /"connectionDisconnect", \(\) => this\.order\(\{ speed: 0 \}\)/.test(service));
check('...with the carry weight nudge after the SpeedMult', /modActorValue\("SpeedMult", steps\.speedDelta\);\s*player\.modActorValue\("CarryWeight", 0\.1\);\s*player\.modActorValue\("CarryWeight", -0\.1\);/.test(service));
check('no game setting is changed (global: it would reach the NPCs this client hosts)', !/setGameSetting/.test(service + PLAN_SRC));

const MUTANTS = [
  ['speed replaces instead of adding', 'speedDelta: order.speed - held.speed', 'speedDelta: order.speed'],
  ['no clamp on speed-ups', 'Math.max(ARMOUR_WEAR_LIMITS.minSpeed, Math.min(0, Math.round(speed)))', 'Math.round(speed)'],
  ['any packet is an order', 'content["customPacketType"] !== "dboArmourWear"', 'false'],
];
for (const [name, from, to] of MUTANTS) {
  if (!PLAN_SRC.includes(from)) { check(`mutant "${name}": its line is in the plan`, false); continue; }
  let bad = 0; try { bad = scenarios(load(PLAN_SRC.replace(from, to)), false); } catch (e) { bad = 1; }
  check(`mutant "${name}" is caught (${bad} failing)`, bad > 0);
}
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
