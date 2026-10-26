// /pk and /unpk (gamemode.js, Nat 26 Oct: Jarl Uhtred was ruled "officially PKed" and no tool could end a character)
//   node tests/staff-pk-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const gm = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const block = gm.slice(gm.indexOf('const pkTargetOf = '), gm.indexOf('// Give all Shouts taught'));
let fails = 0;
const ok = (c, t, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${t}${c ? '' : '   ' + JSON.stringify(g)}`); if (!c) fails++; };

// Two accounts: the Lead GM (profile 1) and the player (profile 167) with two characters, Uhtred (offline, the Jarl of
// Whiterun, his seat bound to him) and Bera (online, a Steward of Riften, her seat bound to her); and Ana (profile 50),
// online, who holds an unbound seat
const GM = 0xff000001, UHT = 0xff000a01, BERA = 0xff000a02, ANA = 0xff000b01, OWNER = 0xff000009;
const CH = {
  [GM]: { name: 'Gerd', tag: 'GGGG', pid: 1, tier: 'leadgm', user: 1 },
  [OWNER]: { name: 'Nate', tag: 'OOOO', pid: 2, tier: 'senior', user: 2 },
  [UHT]: { name: 'Jarl Uhtred Farseer-Rosa', tag: 'NWVK', pid: 167, tier: null, user: -1 },
  [BERA]: { name: 'Bera', tag: 'BBBB', pid: 167, tier: null, user: 7 },
  [ANA]: { name: 'Ana Vel', tag: 'AAAA', pid: 50, tier: null, user: 8 },
};
const props = new Map();
const mp = {
  get: (a, k) => { if (!CH[a]) throw new Error(`Form with id ${a} doesn't exist`); return props.get(`${a}|${k}`); },
  set: (a, k, v) => { if (!CH[a]) throw new Error(`Form with id ${a} doesn't exist`); props.set(`${a}|${k}`, v); },
  kick: (u) => kicked.push(u),
};
const kicked = [], audits = [], told = [], packets = [], plog = [], synced = [];
let officials = { whiterun: { jarl: [167], steward: [50] }, riften: { steward: [167] } };
let seats = { whiterun: { jarl: { 167: UHT } }, riften: { steward: { 167: BERA } } };
const ZONES = [{ id: 'whiterun', name: 'Whiterun', officials: ['jarl', 'steward'] }, { id: 'riften', name: 'Riften', officials: ['jarl', 'steward'] }];
const timers = [];
const deps = {
  mp, findAnyByName: (q) => { q = q.toLowerCase(); const m = q.match(/#([a-z0-9]{4})$/); const hits = Object.keys(CH).map(Number).filter((id) => (m ? CH[id].tag.toLowerCase() === m[1] : CH[id].name.toLowerCase() === q)); return hits.length === 1 ? hits[0] : hits.length ? -hits.length : 0; },
  tagOf: (a) => CH[a].tag, ownNameOf: (a) => CH[a].name, nameOf: (a) => CH[a].name, display: (a) => `${CH[a].name} #${CH[a].tag}`,
  publicDisplay: (a) => `${CH[a].name} #${CH[a].tag}`, who: (a) => `${CH[a].name} #${CH[a].tag} (profile ${CH[a].pid})`,
  profileOf: (a) => CH[a].pid, userOf: (a) => CH[a].user, tierOf: (a) => CH[a].tier, isLeadStaff: (a) => !!CH[a].tier && CH[a].tier !== 'gm',
  rankRefusalOf: (a, t) => (CH[a].pid === CH[t].pid ? 'own' : CH[t].tier ? 'rank' : null),
  readOfficials: () => JSON.parse(JSON.stringify(officials)), writeOfficials: (o) => { officials = JSON.parse(JSON.stringify(o)); },
  readSeats: () => JSON.parse(JSON.stringify(seats)), writeSeats: (o) => { seats = JSON.parse(JSON.stringify(o)); },
  seatHolder: (zid, r, pid) => Number((((seats[zid] || {})[r] || {})[pid])) >>> 0,
  zoneList: () => ZONES, rankTitle: (r) => r[0].toUpperCase() + r.slice(1), courtOfficeSync: (z, tg, r, on) => synced.push([z.id, r, tg.pid, on]),
  audit: (t) => audits.push(t), log: () => {}, personal: (a, t) => told.push([a, t]), sendPacket: (a, p) => packets.push([a, p]),
  registerChatCommand: (n, fn, o) => { cmds[n] = { fn, o }; },
  setTimeout: (fn, ms) => timers.push([fn, ms]),
};
const cmds = {};
globalThis.__dboPlogHook = (kind, a, reason, by) => plog.push([kind, a, reason, by]);
new Function(...Object.keys(deps), block)(...Object.values(deps));
const last = (a) => (told.filter((x) => x[0] === a).slice(-1)[0] || [])[1] || '';
const run = (a, name, args) => cmds[name].fn(a, args);

ok(cmds.pk && cmds.unpk && cmds.pk.o.admin && cmds.unpk.o.admin, '/pk and /unpk are staff commands');
ok(/'pk', 'unpk',/.test(gm.slice(gm.indexOf('const LEAD_ONLY'), gm.indexOf('const LEAD_ONLY') + 2000)), 'both are Lead GM only in LEAD_ONLY (a GM cannot run them)');

// refusals
run(ANA, 'pk', '#NWVK test');
ok(/Lead GM/.test(last(ANA)) && props.get(`${UHT}|private.permaDead`) === undefined, 'a player (or a GM) cannot end anyone', last(ANA));
run(GM, 'pk', '#NWVK');
ok(/Usage/.test(last(GM)) && props.get(`${UHT}|private.permaDead`) === undefined, 'no reason: the usage line, nobody ended', last(GM));
run(GM, 'pk', 'Jarl Uhtred ruled');
ok(/Usage/.test(last(GM)), 'a partial name names nobody (no fuzzy match)', last(GM));
run(GM, 'pk', 'Gerd own');
ok(/own account/.test(last(GM)), 'not a character of one\'s own account', last(GM));
run(GM, 'pk', 'Nate #OOOO higher');
ok(/rank or higher/.test(last(GM)) && props.get(`${OWNER}|private.permaDead`) === undefined, 'not a staff account of the same rank or higher', last(GM));

// Uhtred, offline, by exact name with spaces
run(GM, 'pk', 'Jarl Uhtred Farseer-Rosa ruled PKed by Nat, ticket 1564');
ok(props.get(`${UHT}|private.permaDead`) === true && props.get(`${UHT}|isDead`) === true, 'Uhtred (offline, named in full) is permanently dead: private.permaDead and isDead', [props.get(`${UHT}|private.permaDead`), props.get(`${UHT}|isDead`)]);
ok((props.get(`${UHT}|private.pk`) || {}).reason === 'ruled PKed by Nat, ticket 1564' && props.get(`${UHT}|private.pk`).by === 1, 'who and why are kept on the character', props.get(`${UHT}|private.pk`));
ok(audits.some((t) => /^PK GM Gerd #GGGG \(profile 1\) permakilled Jarl Uhtred Farseer-Rosa #NWVK \(profile 167\) \(offline\): ruled PKed by Nat, ticket 1564$/.test(t)), 'the PK audit line, offline marked', audits);
ok(!officials.whiterun.jarl.includes(167) && officials.whiterun.steward.includes(50), 'the Jarl seat of Whiterun is vacant; Ana\'s seat is untouched', officials);
ok(officials.riften.steward.includes(167) && seats.riften.steward[167] === BERA, 'Bera\'s Riften seat (bound to her, same account) stays', [officials.riften, seats.riften]);
ok(!(seats.whiterun.jarl || {})[167], 'the seat binding goes with the seat', seats.whiterun);
ok(audits.some((t) => /unseated Jarl Uhtred Farseer-Rosa #NWVK \(profile 167\) as Jarl of Whiterun \(permadeath\)/.test(t)) && synced.some((s) => s[0] === 'whiterun' && s[1] === 'jarl' && s[3] === false), 'the unseating is audited and the court roster told (courtOfficeSync)', [audits, synced]);
ok(!kicked.length && !timers.length && !packets.length, 'offline: no kick, no packet');
ok(/permanently dead \(offline/.test(last(GM)) && /Seats vacated: Jarl of Whiterun\./.test(last(GM)) && /other characters stay playable/.test(last(GM)), 'the GM is told, seats listed', last(GM));
run(GM, 'pk', '#NWVK again');
ok(/already permanently dead/.test(last(GM)), 'a second /pk says so');
ok(props.get(`${BERA}|private.permaDead`) === undefined, 'the account\'s other character is untouched');

// Ana, online, by #TAG; her seat is unbound (no officials-seats.json entry), so it is hers
run(GM, 'pk', 'Ana Vel #AAAA killed in war, ruled');
ok(props.get(`${ANA}|private.permaDead`) === true && !officials.whiterun.steward.includes(50), 'online by name #TAG: dead, and her unbound seat goes vacant', officials.whiterun);
ok(packets.some(([a, p]) => a === ANA && p.customPacketType === 'dboBanner') && told.some(([a, t]) => a === ANA && /this life is over/.test(t)), 'she is told across the screen and in chat');
ok(plog.some(([k, a, r, by]) => k === 'leave_reason' && a === ANA && r === 'permadeath' && by === GM), 'the player log has the permadeath as the reason she leaves, and by whom', plog);
ok(timers.length === 1 && timers[0][1] === 8000, 'the kick waits 8 s');
timers[0][0]();
ok(kicked.includes(8), 'then she is sent to the menu', kicked);

// /unpk: Owners only; the seat stays vacant
run(GM, 'unpk', '#NWVK mistake');
ok(/Owners/.test(last(GM)) && props.get(`${UHT}|private.permaDead`) === true, 'a Lead GM cannot lift it');
run(OWNER, 'unpk', '#NWVK appeal granted');
ok(props.get(`${UHT}|private.permaDead`) === false && props.get(`${UHT}|isDead`) === false && props.get(`${UHT}|private.pk`) === null, 'an Owner lifts it: alive and playable again');
ok(audits.some((t) => /^PK GM Nate #OOOO \(profile 2\) lifted the permadeath of Jarl Uhtred Farseer-Rosa #NWVK \(profile 167\): appeal granted$/.test(t)), 'audited');
ok(!officials.whiterun.jarl.includes(167) && /stays vacant/.test(last(OWNER)), 'the seat stays vacant, and the Owner is told to /appoint', last(OWNER));
run(OWNER, 'unpk', '#NWVK twice');
ok(/not permanently dead/.test(last(OWNER)), 'a second /unpk says so');
// a later kick does nothing if the character was restored in the 8 s
props.set(`${ANA}|private.permaDead`, false); kicked.length = 0;
run(GM, 'pk', '#AAAA again'); // she is dead again (it was reset above) ...
props.set(`${ANA}|private.permaDead`, false); timers.slice(-1)[0][0]();
ok(!kicked.length, 'restored within the 8 s: no kick');

// the player log reads the PK audit lines (playerlog-rules.js): a staff action on the target, and the target's final death
const R = require(path.resolve(__dirname, '..', 'playerlog-rules.js'));
const pk = R.parseAudit(audits.find((t) => / permakilled Jarl Uhtred/.test(t)));
ok(pk.verb === 'PK' && pk.events.some((e) => e.ev === 'staff.action' && e.f.action === 'pk' && e.actor === 0) && pk.events.some((e) => e.ev === 'combat.death_final' && e.actor === 1 && e.f.kind === 'permadeath')
  && pk.parties[1].profile === 167, 'the player log: /pk is a staff action and the target\'s final death (by profile 167)', pk);
const un = R.parseAudit(audits.find((t) => / lifted the permadeath of /.test(t)));
ok(un.events.length === 1 && un.events[0].f.action === 'unpk' && un.parties[1].profile === 167, '...and /unpk a staff action on them', un);
ok(!JSON.stringify(pk.events).includes('ticket 1564'), 'the staff-written reason never reaches the player log');

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
