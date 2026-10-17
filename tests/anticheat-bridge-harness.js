// Scripted test for anticheat.js's fork bridge (ac-fork-bridge, ANTI-CHEAT DESIGN 17 Oct). With no fork natives: no error,
// nothing pushed. With fake natives: gamemode-config anticheat.fork pushed once per load (only the keys present), /anticheat
// off fork|all pushing enabled false, movement classes pushed on a change only, mp.onAnticheat flags coming out as one
// ANTICHEAT line with the name and #TAG (nothing else of what the fork sent), the handler chain over two reloads with no
// double handling, and /acstate printing no id beyond the profile number.
//   node tests/anticheat-bridge-harness.js   (from server/)
'use strict';
const F = require('./lib/anticheat-fakes.js');
const { ok } = F;

const A = 0xff000014, LEAD = 0xff000018, GM = 0xff000016;
const setup = (anticheat, natives) => {
  const W = F.makeWorld();
  W.record(0xa764b, 'WRLD', 'BSHeartland', []);
  const N = { config: [], classes: [], state: null, getConfig: null };
  if (natives) {
    W.mp.setAnticheatConfig = (json) => { N.config.push(json); };
    W.mp.getAnticheatConfig = () => N.getConfig || JSON.stringify({ enabled: true, vitals: { shadow: true, enforceCasts: false } });
    W.mp.setMovementClass = (a, cls, slow) => { N.classes.push([a >>> 0, cls, slow]); };
    W.mp.getAnticheatState = (a) => N.state || { x: -0.6 };
  }
  const H = F.makeApi(W, { anticheat });
  F.baseSlots(W.mp);
  H.addPlayer(A, { name: 'Rowan', tag: 'PGDB', profile: 1 });
  H.addPlayer(LEAD, { name: 'Jarl', tag: 'L3AD', profile: 6, tier: 'leadgm' });
  H.addPlayer(GM, { name: 'Dar', tag: 'U6T6', profile: 4, tier: 'gm' });
  return { W, H, N };
};
const acLines = (H) => H.logs.filter((l) => l.startsWith('ANTICHEAT '));

// ---- no natives ---------------------------------------------------------------------------------------------------------------
{
  const { W, H } = setup({ fork: { vitals: { shadow: true } } }, false);
  let threw = null;
  try { F.load(H.api, true); H.tick(0); for (let i = 0; i < 10; i++) H.tick(1000); } catch (e) { threw = e; }
  ok(!threw && typeof W.mp.onAnticheat === 'function', 'no fork natives: loads and ticks with no error, the flag slot ready for the fork', threw && threw.message);
  ok(H.logs.some((l) => /^anticheat: on .*fork config absent/.test(l)), '...and says the fork config was not pushed', H.logs.filter((l) => /^anticheat:/.test(l)));
  H.cmd(GM, '/acstate #PGDB');
  ok(H.told.some(([, l]) => /^Fork: natives absent/.test(l)), '/acstate says the natives are absent');
}

// ---- the config push ------------------------------------------------------------------------------------------------------------
{
  const { H, N } = setup({ fork: { _comment: 'not pushed', vitals: { shadow: true, enforceCasts: false }, movement: { shadow850: true } } }, true);
  F.load(H.api, true);
  ok(N.config.length === 1 && N.config[0] === JSON.stringify({ vitals: { shadow: true, enforceCasts: false }, movement: { shadow850: true } }), 'a load pushes anticheat.fork once, only the keys present (no comment)', N.config);
  for (let i = 0; i < 30; i++) H.tick(1000);
  ok(N.config.length === 1, '...the ticks push nothing more');
  F.load(H.api, false);
  ok(N.config.length === 2 && N.config[1] === N.config[0], '...a reload pushes it once again');
  H.cmd(LEAD, '/anticheat off fork');
  ok(N.config.length === 3 && JSON.parse(N.config[2]).enabled === false && JSON.parse(N.config[2]).vitals.shadow === true, '/anticheat off fork pushes the same with enabled false', N.config[2]);
  ok(H.told.some(([x, l]) => x === LEAD && /fork config pushed/.test(l)), '...and says so');
  F.load(H.api, false);
  ok(JSON.parse(N.config[3]).enabled === false, '...it stays off over a reload');
  H.cmd(LEAD, '/anticheat on fork');
  ok(N.config.length === 5 && !('enabled' in JSON.parse(N.config[4])), '/anticheat on fork pushes the config back', N.config[4]);
  H.cmd(LEAD, '/anticheat off all');
  ok(JSON.parse(N.config[5]).enabled === false, '/anticheat off all turns the fork off too');
  H.cmd(LEAD, '/anticheat on all');
  H.cmd(LEAD, '/anticheat status');
  ok(H.told.some(([, l]) => /^fork: enabled=true, vitals\.shadow=true, vitals\.enforceCasts=false$/.test(l)), '/anticheat status shows the fork\'s own values', H.told.filter(([x]) => x === LEAD).map(([, l]) => l));
  const { H: H0, N: N0 } = setup({}, true);
  F.load(H0.api, true);
  ok(N0.config.length === 1 && N0.config[0] === '{}', 'with no anticheat.fork the push is an empty object (relaxes nothing, enforces nothing)', N0.config);
}

// ---- movement classes, on a change only ------------------------------------------------------------------------------------------
{
  const { W, H, N } = setup({ bridge: { pushClasses: true } }, true);
  F.load(H.api, true);
  H.tick(0);
  for (let i = 0; i < 60; i++) H.tick(1000);
  const mine = () => N.classes.filter(([a]) => a === A);
  ok(mine().length === 1 && mine()[0][1] === 'foot' && mine()[0][2] === 1, `a foot player for a minute: one push (${mine().length})`, mine());
  W.set(A, 'private.beast', { form: 'werewolf', original: 1 });
  for (let i = 0; i < 20; i++) H.tick(1000);
  ok(mine().length === 2 && mine()[1][1] === 'beast', '...beast form: one more push', mine());
  globalThis.__dboAcStatus(A, { customPacketType: 'dboStatus', kind: 'terror', seconds: 30, speedMult: -50 });
  for (let i = 0; i < 20; i++) H.tick(1000);
  ok(mine().length === 3 && mine()[2][2] === 0.5, '...slowed: one more, with the factor', mine());
  const { H: H2, N: N2 } = setup({}, true);
  F.load(H2.api, true);
  for (let i = 0; i < 20; i++) H2.tick(1000);
  ok(N2.classes.length === 0, 'pushClasses false (the default until fork-movement-classes is live): no class push');
}

// ---- the fork's flags ------------------------------------------------------------------------------------------------------------
{
  const { W, H } = setup({}, true);
  let original = 0;
  W.mp.onAnticheat = () => { original++; return 'theirs'; };
  F.load(H.api, true); F.load(H.api, false); F.load(H.api, false);
  H.tick(0);
  const r = W.mp.onAnticheat(A, 'vitals_nonfinite', JSON.stringify({ debt: 0.6, cost: 120, ratio: 1.5, cls: 'foot', ip: '10.1.2.3', userId: 3, hwid: 'abc', actorId: A, note: 'x <@1> y' }));
  const L = acLines(H);
  ok(L.length === 1 && /^ANTICHEAT vitals_nonfinite Rowan #PGDB \(profile 1\): debt=0\.6, cost=120, ratio=1\.5, cls=foot; source: fork$/.test(L[0]), 'a fork flag is one ANTICHEAT line with the name and #TAG and the numbers', L);
  ok(!/10\.1\.2\.3|hwid|userId|actorId|<@|ff000014|4278190100/.test(L.join(' ') + H.staff.map(([, l]) => l).join(' ')), '...and none of the ids, the address or the text the fork sent');
  ok(original === 1 && r === 'theirs', 'over three loads the earlier handler runs once, its answer returned (no double handling)', original);
  W.mp.onAnticheat(A, 'magicka_debt', { debt: 0.7 });
  ok(acLines(H).length === 2 && / magicka_debt shadow Rowan #PGDB/.test(acLines(H)[1]), 'magicka_debt starts in shadowKinds: a shadow line', acLines(H)[1]);
  W.mp.onAnticheat(0x0001b0e2, 'magicka_debt', { debt: 0.7 });
  W.mp.onAnticheat(A, 'Bad Kind!', {});
  ok(acLines(H).length === 3 && / fork_other Rowan/.test(acLines(H)[2]), 'an NPC is ignored; a malformed kind becomes fork_other', acLines(H).slice(2));
}

// ---- /acstate ------------------------------------------------------------------------------------------------------------------
{
  const { H, N } = setup({}, true);
  F.load(H.api, true);
  H.tick(0); H.tick(1000);
  N.state = { magicka: { x: -0.62, debt: 0.62, banked: 0.1, charges60: [24, 41, 41] }, stamina: { x: 0.4 }, bucket: { allowance: 1200, ceiling: 1000 },
    cls: 'foot', actorId: A, refrId: A, userId: 3, ip: '10.0.0.7', hwid: 'deadbeef', discordId: '337337773973569537', token: 'abc', profile: 1 };
  H.cmd(GM, '/acstate #PGDB');
  const out = H.told.filter(([x]) => x === GM).map(([, l]) => l);
  ok(out.some((l) => /^Rowan #PGDB \(profile 1\): class foot/.test(l)) && out.some((l) => /^Fork: magicka\.x=-0\.62, magicka\.debt=0\.62, magicka\.banked=0\.1, magicka\.charges60=\[24 41 41\], stamina\.x=0\.4, bucket\.allowance=1200, bucket\.ceiling=1000, cls=foot, profile=1$/.test(l)),
    '/acstate prints the gameplay view and the fork\'s numbers', out);
  const all = out.join(' ');
  ok(!/ff000014|4278190100|10\.0\.0\.7|deadbeef|337337773973569537|userId|hwid|token|refrId|actorId/.test(all), '...and no id beyond the profile number', all);
  H.cmd(GM, '/acstate #NONE');
  ok(H.told.some(([, l]) => /^Usage: \/acstate/.test(l)), '...a tag nobody online carries: the usage');
}

F.done();
