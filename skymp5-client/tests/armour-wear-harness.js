// The armour debuff on the player's own game (Nat, 31 Oct; gameplay gamemode.js armorWear debuff mode): dboArmourWear
// { speedMult, staminaCostMult } sets a SpeedMult that adds to the other slows, and scales the power attack and sprint
// stamina settings from their own base. Runs armourWearPlan.ts (transpiled with the client's TypeScript) against a fake
// SpeedMult that a timed slow also moves, checks the service's wiring in its source, and kills mutants of the plan.
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
  // A fake game: SpeedMult moved by deltas (the service's and a howl's), and two settings
  const game = { speed: 100, gmst: { fPowerAttackStaminaPenalty: 2, fSprintStaminaDrainMult: 7 } };
  const held = { speed: 0 }, bases = {};
  const apply = (packet) => {
    const o = plan.readArmourWearOrder(packet); if (!o) return null;
    for (const s of plan.ARMOUR_WEAR_SETTINGS) if (!(bases[s] > 0)) bases[s] = game.gmst[s];
    const st = plan.armourWearSteps(held, o, bases);
    game.speed += st.speedDelta; held.speed = o.speed;
    for (const x of st.settings) game.gmst[x.setting] = x.value;
    return o;
  };
  t('a foreign packet is not an order', plan.readArmourWearOrder({ customPacketType: 'dboStatus', speedMult: -50 }) === null);
  apply({ customPacketType: 'dboArmourWear', speedMult: -20, staminaCostMult: 1.3 });
  t('-20 and x1.3: SpeedMult 80, power attack 2.6, sprint drain 9.1', game.speed === 80 && game.gmst.fPowerAttackStaminaPenalty === 2.6 && Math.abs(game.gmst.fSprintStaminaDrainMult - 9.1) < 1e-9, game);
  game.speed -= 50;   // a howl's timed slow on top
  apply({ customPacketType: 'dboArmourWear', speedMult: -10, staminaCostMult: 1.15 });
  t('a lighter order while a howl holds: only the armour share moves (SpeedMult 40 = 100 - 10 armour - 50 howl)', game.speed === 40, game.speed);
  t('...and the settings scale from the first base, never compounding', game.gmst.fPowerAttackStaminaPenalty === 2.3 && Math.abs(game.gmst.fSprintStaminaDrainMult - 8.05) < 1e-9, game.gmst);
  game.speed += 50;   // the howl ends
  apply({ customPacketType: 'dboArmourWear', speedMult: 0, staminaCostMult: 1 });
  t('the order lifted: SpeedMult back to 100 and the settings back to 2 and 7', game.speed === 100 && game.gmst.fPowerAttackStaminaPenalty === 2 && game.gmst.fSprintStaminaDrainMult === 7, game);
  const wild = plan.readArmourWearOrder({ customPacketType: 'dboArmourWear', speedMult: 40, staminaCostMult: 99 });
  t('a speed-up or a huge cost is clamped (0 and x3)', wild.speed === 0 && wild.cost === 3, wild);
  const junk = plan.readArmourWearOrder({ customPacketType: 'dboArmourWear', speedMult: 'x', staminaCostMult: null });
  t('a malformed order is no debuff', junk.speed === 0 && junk.cost === 1, junk);
  return bad;
};
scenarios(load(PLAN_SRC), true);

// The service: registered, on a frame, cleared on connect and disconnect, with the nudge; the capability is advertised
const service = fs.readFileSync(path.join(svc, 'armourWearService.ts'), 'utf8');
const index = fs.readFileSync(path.join(client, 'src', 'index.ts'), 'utf8');
const caps = fs.readFileSync(path.join(client, 'src', 'lib', 'clientUiCaps.ts'), 'utf8');
check('index.ts creates ArmourWearService', /new ArmourWearService\(sp, controller\)/.test(index));
check('the client advertises the armourWear capability (the server tells only what applies)', /CLIENT_UI_CAPS[^;]*"armourWear"/.test(caps));
check('the service applies on a frame, and clears on connect and disconnect', /controller\.on\("update"/.test(service) && /"connectionAccepted", \(\) => this\.order\(\{ speed: 0, cost: 1 \}\)/.test(service) && /"connectionDisconnect", \(\) => this\.order\(\{ speed: 0, cost: 1 \}\)/.test(service));
check('...with the carry weight nudge after the SpeedMult', /modActorValue\("SpeedMult", steps\.speedDelta\);\s*player\.modActorValue\("CarryWeight", 0\.1\);\s*player\.modActorValue\("CarryWeight", -0\.1\);/.test(service));

const MUTANTS = [
  ['speed replaces instead of adding', 'speedDelta: order.speed - held.speed,', 'speedDelta: order.speed,'],
  ['settings compound', 'value: bases[s] * order.cost', 'value: bases[s] * order.cost * order.cost'],
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
