// Scripted test for anticheat.js's flag path (ac-core, ANTI-CHEAT DESIGN 17 Oct): the per (player, kind) limiter (the first
// at once, then one a minute with the fold count), the staff line (GM and up only, once per 10 min, never the flagged player),
// shadow kinds (the log line only), the stall hold (a late timer, a same-kind burst), the anchored line against the
// monitor's regex and against the same text inside a chat or /bug line, no mention or address in anything written,
// /anticheat off|on (Lead GM only, audited, kept over a reload), and the player log accepting every new kind and number.
//   node tests/anticheat-core-harness.js   (from server/)
'use strict';
const path = require('path');
const F = require('./lib/anticheat-fakes.js');
const PF = require('./lib/playerlog-fakes.js');
const { ok } = F;

const AC = require(F.MODULE);
const M1 = new RegExp(AC.LOGGER_RX_SRC + AC.LINE_RX.source);
const A = 0xff000014, B = 0xff000015, GM = 0xff000016, TRIAL = 0xff000017, LEAD = 0xff000018, P2 = 0xff000019;
const setup = (anticheat) => {
  const W = F.makeWorld();
  const H = F.makeApi(W, { anticheat });
  F.baseSlots(W.mp);
  H.addPlayer(A, { name: 'Rowan', tag: 'PGDB', profile: 1 });
  H.addPlayer(B, { name: 'Selene', tag: 'K2QX', profile: 2 });
  H.addPlayer(GM, { name: 'Dar', tag: 'U6T6', profile: 4, tier: 'gm' });
  H.addPlayer(TRIAL, { name: 'Trial', tag: 'T3ST', profile: 5, tier: 'trialgm', staffChar: true });
  H.addPlayer(LEAD, { name: 'Jarl', tag: 'L3AD', profile: 6, tier: 'leadgm' });
  H.addPlayer(P2, { name: 'Mike', tag: '5D8L', profile: 7 });
  return { W, H };
};
const acLines = (H) => H.logs.filter((l) => l.startsWith('ANTICHEAT '));
// the 1 s timer up to a time, a tick a second as it runs (a jump would read as a server stall)
const until = (H, t) => { while (H.clock.t + 1000 <= t) H.tick(1000); H.clock.t = t; };
const plogCalls = [];
globalThis.__dboPlogHook = (name, ...args) => { plogCalls.push([name, ...args]); };

// ---- the limiter ------------------------------------------------------------------------------------------------------------
{
  const { H } = setup({});
  const G = F.load(H.api, true);
  H.tick(0);
  const t0 = H.clock.t;
  G.acFlag(A, 'magicka_free', { casts: 8, cost: 1300 }, 'first numbers', {});
  ok(acLines(H).length === 1, 'the first flag is logged at once', acLines(H));
  for (const dt of [10000, 20000, 30000]) { until(H, t0 + dt); G.acFlag(A, 'magicka_free', { casts: 9, cost: 1400 }, `numbers at ${dt / 1000} s`, {}); }
  ok(acLines(H).length === 1, '...the next three inside the minute are folded', acLines(H));
  until(H, t0 + 59000); H.run('acSpeedWatch');
  ok(acLines(H).length === 1, '...nothing more before the minute is up');
  until(H, t0 + 60000); H.run('acSpeedWatch');
  const L = acLines(H);
  ok(L.length === 2 && /numbers at 30 s \(3 more folded\)$/.test(L[1]), '...then one line with the latest numbers and "3 more folded"', L[1]);
  until(H, t0 + 70000); G.acFlag(A, 'magicka_free', {}, 'numbers at 70 s', {});
  until(H, t0 + 119000); H.run('acSpeedWatch');
  ok(acLines(H).length === 2, '...a flag 10 s after that line waits for its own minute');
  until(H, t0 + 121000); H.run('acSpeedWatch');
  ok(acLines(H).length === 3 && /\(1 more folded\)$/.test(acLines(H)[2]), '...and comes out with "1 more folded"', acLines(H)[2]);
  until(H, t0 + 125000);
  G.acFlag(B, 'magicka_free', {}, 'another player', {});
  ok(acLines(H).length === 4 && acLines(H)[3].includes('Selene #K2QX'), 'another player\'s first flag of the same kind is not folded into the first player\'s');
  until(H, t0 + 130000);
  const shadowFirst = acLines(H).length;
  G.acFlag(A, 'speed_sustained', { speed: 700 }, 'foot tier', { tier: 'foot' });
  G.acFlag(A, 'speed_sustained', { speed: 2000 }, 'alert tier', { tier: 'alert' });
  const two = acLines(H).slice(shadowFirst);
  ok(two.length === 2 && /^ANTICHEAT speed_sustained shadow Rowan/.test(two[0]) && /^ANTICHEAT speed_sustained Rowan/.test(two[1]),
    'a shadow tier line never folds the alert tier of the same kind (speed_sustained:foot in shadowKinds)', two);
}

// ---- the staff line --------------------------------------------------------------------------------------------------------
{
  const { H } = setup({});
  const G = F.load(H.api, true);
  H.tick(0);
  const t0 = H.clock.t;
  plogCalls.length = 0;
  G.acFlag(A, 'magicka_free', { casts: 8, cost: 1300 }, '8 casts', {});
  const to = H.staff.map(([x]) => x).sort();
  ok(JSON.stringify(to) === JSON.stringify([GM, LEAD].sort()), 'the staff line goes to the online GM and Lead GM only (not the Trial GM, not players)', to.map((x) => x.toString(16)));
  ok(H.staff.every(([, l]) => /^Anticheat magicka_free: Rowan #PGDB \(profile 1\): 8 casts\. \/tp #PGDB, \/acstate #PGDB, \/charstats #PGDB, the player log$/.test(l)), '...named by display(), with the pointers', H.staff[0]);
  ok(!H.told.some(([x]) => x === A) && !H.staff.some(([x]) => x === A), '...and nothing reaches the flagged player');
  ok(plogCalls.length === 1 && plogCalls[0][0] === 'anticheat' && plogCalls[0][2] === 'magicka_free' && plogCalls[0][3].nums.casts === 8 && plogCalls[0][3].n === 1, 'one sec.signal for the player log, with its numbers', plogCalls);
  until(H, t0 + 2 * 60000); G.acFlag(A, 'magicka_free', {}, 'again', {}); H.run('acSpeedWatch');
  ok(H.staff.length === 2, '...a second line two minutes later sends no second staff line', H.staff.length);
  until(H, t0 + 10 * 60000 + 1000); G.acFlag(A, 'magicka_free', {}, 'ten minutes on', {});
  ok(H.staff.length === 4, '...ten minutes later it does again', H.staff.length);
  // a flagged staff member is marked, and is not sent their own line
  H.staff.length = 0;
  until(H, H.clock.t + 3000);
  G.acFlag(GM, 'magicka_free', {}, 'staff test', {});
  ok(acLines(H).some((l) => /^ANTICHEAT magicka_free Dar #U6T6 \(profile 4, staff\): staff test$/.test(l)), 'a staff character is flagged and marked staff, never exempt');
  ok(H.staff.length === 1 && H.staff[0][0] === LEAD, '...and the line goes to the other staff only', H.staff.map(([x]) => x.toString(16)));
  until(H, H.clock.t + 3000);
  G.acFlag(TRIAL, 'magicka_free', {}, 'trial gm', {});
  ok(acLines(H).some((l) => /Trial #T3ST \(profile 5, staff\)/.test(l)), 'a Trial GM\'s staff character is marked staff too');
}

// ---- shadow kinds ------------------------------------------------------------------------------------------------------------
{
  const { H } = setup({});
  const G = F.load(H.api, true);
  H.tick(0);
  plogCalls.length = 0;
  G.acFlag(A, 'stamina_free', { window: 30 }, '25 s of sprint', {});
  ok(acLines(H).length === 1 && /^ANTICHEAT stamina_free shadow Rowan #PGDB \(profile 1\): 25 s of sprint$/.test(acLines(H)[0]), 'a shadow kind writes the log line, marked shadow', acLines(H));
  ok(plogCalls.length === 0 && H.staff.length === 0, '...and no sec.signal and no staff line', { plog: plogCalls.length, staff: H.staff.length });
  const { H: H2 } = setup({ shadowKinds: [] });
  const G2 = F.load(H2.api, true);
  G2.acFlag(A, 'stamina_free', {}, 'x', {});
  ok(H2.staff.length === 2 && !acLines(H2)[0].includes('shadow'), 'with an empty shadowKinds the same kind alerts (the switch is the config)');
}

// ---- the stall hold ----------------------------------------------------------------------------------------------------------
{
  const { H } = setup({});
  const G = F.load(H.api, true);
  H.tick(0); H.tick(1000);
  H.tick(3000); // the timer ran 2 s late: a server freeze
  const before = acLines(H).length;
  G.acFlag(A, 'speed_sustained', { speed: 2000 }, 'held 1', { tier: 'alert' });
  G.acFlag(B, 'speed_sustained', { speed: 2000 }, 'held 2', { tier: 'alert' });
  G.acFlag(P2, 'magicka_free', {}, 'held 3', {});
  ok(acLines(H).length === before && H.staff.length === 0, 'after a late timer every flag is held: no line, no staff line');
  for (let i = 0; i < 9; i++) H.tick(1000);
  ok(acLines(H).length === before, '...for the 10 s hold');
  H.tick(1000);
  const held = acLines(H).slice(before);
  ok(held.length === 2 && held.some((l) => /^ANTICHEAT stall-held speed_sustained 2 players \(2 flags held back: the server timer ran 2\.0 s late\)$/.test(l))
    && held.some((l) => /^ANTICHEAT stall-held magicka_free 1 players/.test(l)), '...then one stall-held line per kind instead', held);
  ok(held.every((l) => !M1.test(F.LOGGER + '[gamemode] ' + l)), '...which the monitor\'s flag regex does not read as a flag');
  // a burst: three players with the same kind within 2 s
  const b0 = acLines(H).length;
  G.acFlag(A, 'speed_blink', {}, 'p1', {}); H.clock.t += 500;
  G.acFlag(B, 'speed_blink', {}, 'p2', {}); H.clock.t += 500;
  G.acFlag(P2, 'speed_blink', {}, 'p3', {});
  G.acFlag(GM, 'speed_blink', {}, 'p4', {});
  ok(acLines(H).length === b0 + 2, 'a same-kind burst: the third player within 2 s and everyone after is held', acLines(H).slice(b0));
  G.acFlag(A, 'magicka_free', {}, 'other kind', {});
  ok(acLines(H).length === b0 + 3, '...other kinds are not held');
  for (let i = 0; i < 11; i++) H.tick(1000);
  ok(acLines(H).some((l) => /^ANTICHEAT stall-held speed_blink \(shadow\) 2 players \(2 flags held back: 3 or more players within 2 s\)$/.test(l)), '...then one stall-held line for the burst', acLines(H).slice(b0));
  // a burst of shadow lines (a group ride the mount check missed) never holds back the alerting tier of the same kind
  const s0 = acLines(H).length;
  G.acFlag(A, 'speed_sustained', {}, 'r1', { tier: 'foot' }); G.acFlag(B, 'speed_sustained', {}, 'r2', { tier: 'foot' }); G.acFlag(P2, 'speed_sustained', {}, 'r3', { tier: 'foot' });
  G.acFlag(GM, 'speed_sustained', {}, 'the real one', { tier: 'alert' });
  ok(acLines(H).slice(s0).some((l) => /^ANTICHEAT speed_sustained Dar #U6T6 \(profile 4, staff\): the real one$/.test(l)), '...a shadow-tier burst does not hold the alert tier of the same kind', acLines(H).slice(s0));
  // flags that go on (one incident each, folded) never make a burst
  for (let i = 0; i < 12; i++) H.tick(1000);
  const { H: H4 } = setup({});
  const G4 = F.load(H4.api, true);
  H4.tick(0);
  G4.acFlag(A, 'magicka_free', {}, 'a', {}); H4.tick(1000);
  G4.acFlag(B, 'magicka_free', {}, 'b', {}); H4.tick(1000);
  for (let i = 0; i < 5; i++) { G4.acFlag(A, 'magicka_free', {}, 'a again', {}); G4.acFlag(B, 'magicka_free', {}, 'b again', {}); H4.tick(500); }
  G4.acFlag(P2, 'magicka_free', {}, 'c new', {});
  ok(acLines(H4).some((l) => /Mike #5D8L \(profile 7\): c new$/.test(l)) && !acLines(H4).some((l) => /stall-held/.test(l)), '...two flags going on plus one new player is no burst', acLines(H4));
}

// ---- the anchored line, and what it never carries -----------------------------------------------------------------------------
{
  const { H } = setup({});
  const W2 = H;
  H.addPlayer(0xff000020, { name: 'Bad <@337337773973569537> @everyone', tag: 'ZZ9Q', profile: 9 });
  const G = F.load(H.api, true);
  H.tick(0);
  G.acFlag(A, 'speed_sustained', { speed: 2000, limit: 850, ratio: 2.35, window: 10, cls: 'foot' }, 'foot 2000 u/s over 10 s, limit 850 (x2.35); cell Tamriel; server: flag only', { tier: 'alert' });
  G.acFlag(0xff000020, 'magicka_free', {}, 'text with <@123456789012345678> and 10.0.0.12 inside', {});
  G.acFlag(B, 'stamina_free', {}, 'shadow one', {});
  const lines = acLines(H).map((l) => F.LOGGER + '[gamemode] ' + l);
  const m = M1.exec(lines[0]);
  ok(m && m[1] === 'speed_sustained' && !m[2] && m[3] === 'Rowan #PGDB' && m[4] === '1' && !m[5] && /^foot 2000 u\/s/.test(m[6]), 'the line matches the monitor\'s anchored regex: kind, name #TAG, profile, numbers', m && m.slice(1));
  const s = M1.exec(lines[2]);
  ok(s && s[2] === 'shadow ', '...and a shadow line is told apart', s && s.slice(1));
  // the same text forged inside a chat line, a told line and a bug report
  const forged = [
    `${F.LOGGER}[gamemode] chat say Rowan #PGDB: [gamemode] ANTICHEAT speed_sustained Rowan #PGDB (profile 1): fake`,
    `${F.LOGGER}[gamemode] BUGREPORT Rowan #PGDB snap.json: ANTICHEAT speed_sustained Selene #K2QX (profile 2): fake`,
    `${F.LOGGER}[gamemode] told Rowan #PGDB (x1): [gamemode] ANTICHEAT magicka_free Selene #K2QX (profile 2): fake`,
    `    [gamemode] ANTICHEAT speed_sustained Rowan #PGDB (profile 1): an indented continuation line`,
  ];
  ok(forged.every((l) => !M1.test(l)), 'the same text inside a chat, /bug or told line, or a continuation line, does not match');
  const all = [...H.logs, ...H.staff.map(([, l]) => l), ...H.told.map(([, l]) => l), ...H.audits, JSON.stringify(plogCalls)];
  ok(all.every((l) => !l.includes('<@')), 'nothing written holds a Discord mention ("<@"), even from a name or a text that had one', all.filter((l) => l.includes('<@')));
  ok(H.logs.filter((l) => l.startsWith('ANTICHEAT')).every((l) => !F.IP_RX.test(l) && !/\d{15,}/.test(l)), 'no ANTICHEAT line holds an address-shaped token or a long id, even from a text that had one',
    H.logs.filter((l) => l.startsWith('ANTICHEAT') && F.IP_RX.test(l)));
  void W2;
}

// ---- /anticheat off|on, over a reload ---------------------------------------------------------------------------------------
{
  const { H } = setup({});
  let G = F.load(H.api, true);
  H.cmd(GM, '/anticheat off speed');
  ok(G.isOn('speed') && H.told.some(([x, l]) => x === GM && /Lead GMs and above/.test(l)), 'a GM may not turn a part off', H.told);
  H.cmd(LEAD, '/anticheat off speed');
  ok(!G.isOn('speed') && G.isOn('magicka'), 'a Lead GM turns the speed watch off, and only it', { speed: G.isOn('speed'), magicka: G.isOn('magicka') });
  ok(H.audits.some((l) => /^ANTICHEAT Jarl #L3AD turned speed off \(runtime override until a restart\)$/.test(l)), '...audited, named by display()', H.audits);
  // a reload: a fresh require, the same globalThis
  G = F.load(H.api, false);
  ok(!G.isOn('speed'), '...and it stays off over a reload');
  H.cmd(LEAD, '/anticheat off bogus');
  ok(H.told.some(([, l]) => /^Usage: \/anticheat off </.test(l)), 'an unknown part is refused with the list');
  H.cmd(LEAD, '/anticheat on speed');
  ok(G.isOn('speed'), '/anticheat on takes the override back');
  const { H: H3 } = setup({ speed: { rubberBand: false } });
  const G3 = F.load(H3.api, true);
  H3.cmd(LEAD, '/anticheat on rubberband');
  ok(!G3.isOn('rubberband'), '...but never turns on what the config keeps off (rubberBand false)');
  H3.cmd(LEAD, '/anticheat off all');
  G3.acFlag(A, 'magicka_free', {}, 'x', {});
  ok(!acLines(H3).length, '/anticheat off all: no flag at all');
  H3.cmd(LEAD, '/anticheat on all');
  H3.cmd(LEAD, '/anticheat status');
  const st = H3.told.filter(([x]) => x === LEAD).map(([, l]) => l);
  ok(st.some((l) => /^Anticheat on: alerts on, speed on, rubberband off, vitals on, magicka on, stamina on, refusehits off, fork on\.$/.test(l)) && st.some((l) => /fork natives absent/.test(l)), '/anticheat status lists the switches and the fork', st);
  G3.acFlag(A, 'magicka_free', {}, 'recent one', {});
  H3.cmd(LEAD, '/anticheat recent #PGDB');
  ok(H3.told.some(([, l]) => /^\d\d:\d\d:\d\d magicka_free Rowan #PGDB: recent one$/.test(l)), '/anticheat recent #TAG lists that player\'s flags', H3.told.slice(-2));
  const off = F.load(H3.api, true);
  ok(off.isOn('all'), 'a restart (no state on globalThis) starts with no override');
}

// ---- the player log takes every new kind and number ------------------------------------------------------------------------
{
  const R = require(path.join(F.ROOT, 'playerlog-rules.js'));
  const sig = R.EVENT_TYPES['sec.signal'];
  const kinds = AC.KINDS.filter((k) => !sig.f.kind.e.has(k));
  ok(kinds.length === 0 && JSON.stringify(R.AC_SIGNAL_KINDS) === JSON.stringify(AC.KINDS), 'sec.signal lists every anticheat kind (the rules\' list is the module\'s)', kinds);
  const numKeys = ['limit', 'ratio', 'window', 'casts', 'cost', 'debt', 'cls'].filter((k) => !sig.f.nums.o[k]);
  ok(numKeys.length === 0, '...and every number key', numKeys);
  ok(R.REFUSAL_REASONS.includes('anticheat') && R.EVENT_TYPES['move.teleport'].f.reason.e.has('anticheat'), 'the hit refusal and the teleport reason are known');
  // through the real player log: its hook writes one sec.signal with the kind as it is
  delete globalThis.__dboPlogHook;
  const M = PF.makeMp(), FS = PF.makeFs(), TM = PF.makeTimers(), QU = PF.makeQueue(), CL = PF.makeClock();
  QU.install();
  M.player(A, { user: 3 });
  const api = { mp: M.mp, log: () => {}, cfg: { playerLog: { dir: '/fake/events', stopFile: '/fake/STOP' } }, every: TM.every, stopTimer: TM.stopTimer, onlineActors: () => [A],
    actorOf: () => A, fs: FS.fs, clock: CL, discordOf: () => '', recordOf: () => null, adminItemName: () => '', commandsHas: () => false, WORLD_GROUPS: [], lastPacketAt: new Map() };
  delete require.cache[path.join(F.ROOT, 'playerlog.js')];
  const K = require(path.join(F.ROOT, 'playerlog.js'))(api);
  QU.run();
  ok(typeof K.G.hooks.anticheat === 'function', 'the player log has an anticheat hook');
  const n0 = K.S.q.length;
  for (const k of AC.KINDS) globalThis.__dboPlogHook('anticheat', A, k, { n: 2, nums: { speed: 2000, limit: 850, ratio: 2.35, window: 10, casts: 8, cost: 1300, debt: 0.6, cls: 'foot', bogus: 1 } });
  globalThis.__dboPlogHook('anticheat', A, 'not_a_kind', { n: 1, nums: {} });
  globalThis.__dboPlogHook('anticheat', A, 'minigame_refused', { n: 1, nums: {} });
  globalThis.__dboPlogHook('anticheat', A, 'mismatch', { n: 1, nums: {} });
  const recs = K.S.q.slice(n0).filter((r) => r && r.ev === 'sec.signal');
  const dropped = new Map();
  const kept = recs.map((r) => R.validate(r, dropped, new Map()));
  ok(recs.length === AC.KINDS.length, `one sec.signal per kind, none for an unknown kind or minigame_refused (${recs.length})`, recs.map((r) => r.f && r.f.kind));
  const f0 = recs[0] && recs[0].f;
  ok(f0 && f0.kind === 'speed_sustained' && f0.game === 'anticheat' && f0.n === 2 && f0.nums.limit === 850 && f0.nums.cls === 'foot' && !('bogus' in f0.nums), '...the kind as it is, the fold count, the schema\'s numbers only', f0);
  const v0 = kept[0] && kept[0].f;
  ok(kept.every((v) => v && AC.KINDS.includes(v.f.kind)) && v0 && v0.nums.ratio === 2.35 && v0.nums.debt === 0.6 && v0.nums.casts === 8 && ![...dropped.keys()].some((k) => k.startsWith('sec.signal')),
    '...and the schema keeps every kind and number when the record is written (nothing dropped)', { v0, dropped: [...dropped.keys()] });
  QU.restore();
}

// ---- the wiring in gamemode.js ----------------------------------------------------------------------------------------------
{
  const fs = require('fs');
  const gm = fs.readFileSync(path.join(F.ROOT, 'gamemode.js'), 'utf8');
  const at = (name) => gm.indexOf(`require(${name})`);
  const after = ['ITEMGUARDS_JS', 'BEASTFORM_JS', 'SUPERNATURAL_JS', 'DOWNED_JS', 'SPELLS_JS', 'SCHOOLS_JS', 'ALCHEMY_JS', 'PLAYTEST_JS'];
  ok(at('ANTICHEAT_JS') > 0 && after.every((n) => at(n) > 0 && at(n) < at('ANTICHEAT_JS')) && at('ANTICHEAT_JS') < at('PLAYERLOG_JS'),
    'gamemode.js loads anticheat.js after every module that wraps an engine slot, and before playerlog.js (outermost)');
  const slotSets = [...gm.matchAll(/^mp\.(onSpellCast|onSpellHit|onEatItem|onActivate|onHitDamageAttempt) = /gm)].map((m) => m.index);
  ok(slotSets.length >= 5 && slotSets.every((i) => i < gm.indexOf('require(ANTICHEAT_JS)')), '...and the gamemode sets each slot afresh above it, so the wrappers never stack');
  const block = gm.slice(gm.indexOf('// ---- anticheat: speed, magicka and stamina flags'), gm.indexOf('// ---- TEMPORARY movement speed recorder'));
  ok(/stopTimer\('acSpeedWatch'\); globalThis\.__dboAcStatus = null; globalThis\.__dboAcFlag = null;/.test(block) && /mp\.onAnticheat = globalThis\.__dboPrevAnticheat \|\| undefined/.test(block),
    '...a load that fails stops the last load\'s timer and drops its hooks');
  // sendPacket, cut out of gamemode.js: a dboStatus packet reaches the speed watch, other packets do not
  const src = gm.slice(gm.indexOf('const sendPacket = (a, payload) => {'), gm.indexOf('const openWidget = (a, widget, focus) => {'));
  const seen = [];
  globalThis.__dboPacketCounts = { byType: {}, total: 0 };
  globalThis.__dboAcStatus = (a, p) => seen.push([a, p.customPacketType]);
  const send = new Function('userOf', 'INVALID_USER', 'glowShader', 'mp', 'log', `${src}\nreturn sendPacket;`)(() => 3, 65535, (p) => p, { sendCustomPacket: () => {} }, () => {});
  send(A, { customPacketType: 'dboStatus', kind: 'armour', seconds: 5, speedMult: -50 });
  send(A, { customPacketType: 'dboParalyse', seconds: 2 });
  globalThis.__dboAcStatus = () => { throw new Error('boom'); };
  const sent = send(A, { customPacketType: 'dboStatus', kind: 'terror', seconds: 5, speedMult: -50 });
  ok(seen.length === 1 && seen[0][1] === 'dboStatus' && sent === true, 'gamemode.js sendPacket hands dboStatus packets (and only them) to the speed watch; a throw there sends the packet all the same', seen);
  delete globalThis.__dboAcStatus;
}

F.done();
