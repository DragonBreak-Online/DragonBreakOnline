// Scripted test for the player log's taps (playerlog-taps.js, DESIGN.md 2.2 and 8.1): each tap driven once, the event types
// it gives asserted. Items (the itemguards seam, container sessions closed by SkympOnActivateClose and by the idle limit,
// drops and pickups with the dropper, a console grant through OnItemAdded, eating, crafting), equipment (the login burst
// skipped), combat (casts, 5 s windows, fights, the killing blow's weapon, who struck first, refusals by reason, the lean
// refused path, the robbery link and the party flag), unexplained health loss and its suppressions, near lists, ownership
// and access (assignee, household, faction, renter, refused attempts, doors, a claimed interior), NPC owners, movement,
// sessions (snapshots, switch, logout reasons, the client version by connection, the reselect), the packet allow-list,
// item extras through the seam, Name #TAG audit parties, the trade summary, the wrapper invariants, and the coverage of the
// event types.
//   node tests/playerlog-taps-harness.js   (from server/)
'use strict';
const path = require('path');
const F = require('./lib/playerlog-fakes.js');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'playerlog.js');
const R = require(path.join(ROOT, 'playerlog-rules.js'));
let failures = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!c) failures++; };
const rejections = [];
process.on('unhandledRejection', (e) => rejections.push(e));
const seen = new Set();   // every event type emitted in this harness

const reset = () => { for (const k of ['__dboPlayerLog', '__dboPlogHook', '__dboPlogUninstall', '__dboFlushOnExit', '__alduinakTradeLog', '__dboSoulCaptured', '__dboPlogRoute', '__dboHitRefusal',
  '__dboHousing', '__dboWarband', '__dboCompanions', '__dboPartyLeaderOf', '__dboGuildStorageAt', '__dboBusinessChestOf', '__dboJournalOpen', '__dboDisguised', '__dboOwnName', '__dboTellCapture']) delete globalThis[k]; };

// Actors: Rowan #PGDB (profile 1), Selene #K2QX (2), Mike #5D8L (3, a house owner), Dar #U6T6 (4, staff), Wolf (an NPC)
const A = 0xff000014, B = 0xff000015, Cm = 0xff000016, D = 0xff000017, WOLF = 0xff0000a0, LYDIA = 0xff0000a1, BANDIT = 0xff0000a2;
const CHEST = 0x806ca1f, SHARED = 0x806ca20, GUILD = 0x806ca21, RENTED = 0x806ca22, DOOR = 0x806ca23, ITEM_REF = 0xff0001f0, HERB = 0x806ca30, OWNCHEST = 0x806ca31;
const SWORD = 0x12eb7, BREAD = 0x65c9f, POTION = 0x3eada, ROSE = 0x2f44c, ROSEFLOR = 0x2f44d, CHESTBASE = 0x20000, DOORBASE = 0x20001, ARROW = 0x1397d;
const world = (cfgOver) => {
  const M = F.makeMp(), FS = F.makeFs(), TM = F.makeTimers(), QU = F.makeQueue(), CL = F.makeClock();
  QU.install();
  M.player(A, { user: 3, inv: [{ baseId: 0xf, count: 100 }, { baseId: SWORD, count: 1, health: 1.3, enchantmentId: 0x4605a }] });
  M.player(B, { profile: 2, name: 'Selene', tag: 'K2QX', discord: '22', user: 4, pos: [500, 0, 0] });
  M.player(Cm, { profile: 3, name: 'Mike', tag: '5D8L', discord: '33', user: 5, pos: [1500, 0, 0] });
  M.player(D, { profile: 4, name: 'Dar', tag: 'U6T6', discord: '44', user: 6, pos: [9000, 0, 0] });
  M.mp.set(A, 'private.bankGold', 5000); M.mp.set(A, 'private.charSlot', 1);
  M.record(SWORD, 'WEAP', 'IronSword'); M.record(BREAD, 'ALCH', 'FoodBread'); M.record(POTION, 'ALCH', 'PotionRestoreHealth'); M.record(ROSE, 'INGR', 'MountainFlower');
  M.record(ROSEFLOR, 'FLOR', 'MountainFlowerPlant'); M.record(CHESTBASE, 'CONT', 'Barrel'); M.record(DOORBASE, 'DOOR', 'HouseDoor'); M.record(0x4605a, 'ENCH', 'EnchFireDamage');
  M.record(ARROW, 'AMMO', 'IronArrow');
  for (const r of [CHEST, SHARED, GUILD, RENTED, OWNCHEST]) { M.ref(r, CHESTBASE); M.mp.set(r, 'inventory', { entries: [] }); }
  M.ref(DOOR, DOORBASE); M.ref(ITEM_REF, SWORD); M.ref(HERB, ROSEFLOR);
  M.npc(WOLF, 'WolfGray'); M.npc(LYDIA, 'HousecarlWhiterun', { owner: A }); M.npc(BANDIT, 'BanditMelee');
  const logs = [];
  const api = { mp: M.mp, log: (...a) => logs.push(a.join(' ')), cfg: { playerLog: Object.assign({ dir: '/fake/events', stopFile: '/fake/STOP', flushMs: 1000 }, cfgOver || {}) },
    every: TM.every, stopTimer: TM.stopTimer, onlineActors: () => [A, B, Cm, D], actorOf: (u) => M.mp.getUserActor(u), fs: FS.fs, clock: CL,
    discordOf: (a) => String(M.mp.get(a, 'private.skympDiscordId') || ''), recordOf: (id) => M.mp.lookupEspmRecordById(id), adminItemName: () => '',
    commandsHas: (n) => ['kick', 'help'].includes(n), WORLD_GROUPS: [['players', 'Who']], lastPacketAt: new Map(), isWorldspace: (w) => !String(w).startsWith('1'),
    zoneAtPlace: (w, pos) => (Array.isArray(pos) && pos[0] > 150000 ? 'falkreath' : 'bruma'), zoneOfCell: (w) => (String(w).startsWith('1') ? 'bruma' : null), normPlace: (w) => String(w).toLowerCase(), REGION_PLUGINS: {},
    isAdmin: (a) => a === D, staffTierOf: (a) => (a === D ? 'gm' : null), zoneList: () => [] };
  const K = (() => { delete require.cache[MODULE]; return require(MODULE)(api); })();
  // the queue as raw records, by type
  const evs = (type) => K.S.q.filter((r) => r.ev === type);
  const last = (type) => { const l = evs(type); return l[l.length - 1]; };
  const h = (...a) => globalThis.__dboPlogHook(...a);
  const tick = (name, n) => TM.run(name, n);
  return { M, FS, TM, QU, CL, K, logs, api, evs, last, h, tick };
};
const mark = (W) => { for (const r of W.K.S.q) seen.add(r.ev); };
const inv = (W, id) => W.M.mp.get(id, 'inventory').entries;
const setInv = (W, id, entries) => W.M.mp.set(id, 'inventory', { entries });
const addItem = (W, id, baseId, n, extra) => { const e = inv(W, id); const x = e.find((y) => y.baseId === baseId && !extra); if (x) x.count += n; else e.push(Object.assign({ baseId, count: n }, extra || {})); setInv(W, id, e.filter((y) => y.count > 0)); };
// The housing system's accessors, as housingSystem.ts gives them (a place with an assigned and a shared chest)
const housing = (W) => {
  const recs = new Map([
    [DOOR, { owner: 3, ownerChar: Cm, ownerName: 'Mike', locked: true, serial: 1, place: { cells: ['1a2b:Skyrim.esm'] }, assigned: { [CHEST.toString(16)]: { profile: 3, name: 'Mike' } }, shared: [SHARED.toString(16)] }],
    [CHEST, { owner: 0, memberOf: DOOR, locked: false }],
    [SHARED, { owner: 0, memberOf: DOOR, locked: false }],
  ]);
  const keys = new Set();
  const inside = new Set();
  globalThis.__dboHousing = {
    recordOf: (ref) => (inside.has(ref >>> 0) ? recs.get(DOOR) : recs.get(ref >>> 0) || null),
    primaryOf: (ref) => ref >>> 0,
    ownsRecord: (rec, a) => !!rec && Number(rec.owner) > 0 && W.M.mp.get(a, 'profileId') === rec.owner,
    keyOpens: (ref, a) => keys.has(`${a >>> 0}`),
    isManager: () => false,
  };
  return { recs, keys, inside };
};

(async () => {
  // ================================================================================================================ sessions
  reset();
  let W = world();
  W.QU.run(); await F.settle();
  W.h('client', 3, 0, 'apr client v=0.3.95 sp=2.9.0');
  W.h('client', 3, 0, 'apr client v=0.3.95 sp=2.9.0 extra PLOGCANARY');
  W.h('login', 3, A);
  W.QU.run();
  const login = W.last('session.login');
  ok(login && login.f.client === '0.3.95' && login.f.sp === '2.9.0' && login.f.bank === 5000 && login.f.gold === 100 && login.f.slot === 1 && login.f.userId === 3, 'login: client version kept by connection before the character existed, gold, bank, slot', login && login.f);
  ok(login.at && Number.isFinite(login.at.x), '...with the place and coordinates (a pos type)');
  const snap = W.last('account.snapshot');
  ok(snap && snap.f.chars.length === 1 && snap.f.chars[0].c === 'PGDB' && snap.f.chars[0].n === 'Rowan', 'the account snapshot lists the profile\'s characters', snap && snap.f);
  ok(!JSON.stringify(W.K.S.q).includes('PLOGCANARY'), 'a diagnostic line other than the exact version shape is never read');
  // logout reasons, in order: a pending reason, the journal, silence, idle, unknown
  W.h('login', 4, B); W.h('login', 5, Cm); W.h('login', 6, D);
  W.h('leave_reason', B, 'suspension');
  W.h('logout', 4, B); W.QU.run();
  ok(W.last('session.logout').f.reason === 'suspended' && W.last('session.kick').f.kind === 'suspension', 'logout reason: the hook\'s own reason first', W.last('session.logout').f);
  globalThis.__dboJournalOpen = new Map([[Cm, true]]);
  W.h('logout', 5, Cm); W.QU.run();
  ok(W.last('session.logout').f.reason === 'menu_quit' && W.last('session.logout').f.journalOpen === true, '...the journal open: quit from the menu');
  W.api.lastPacketAt.set(D, W.CL.t - 60000);
  W.h('logout', 6, D); W.QU.run();
  ok(W.last('session.logout').f.reason === 'crash_likely' && W.last('session.logout').q === 'inferred' && W.last('session.logout').f.silentSec === 60, '...silence of 45 s or more: crash_likely, inferred');
  ok(W.evs('item.snapshot').filter((r) => r.f.at === 'logout').length === 3, 'an inventory snapshot at each logout (disk only)', W.evs('item.snapshot').length);
  ok(R.EVENT_TYPES['item.snapshot'].disk === true, '...the snapshot type is disk only');
  // a switch and a reselect
  W.h('login', 4, B);
  W.h('switch', 4, B, Cm);
  ok(W.last('session.switch') && W.last('session.switch').f.to.c === '5D8L' && W.last('session.logout').f.reason === 'menu_quit', 'a character switch: session.switch, and the left character\'s session ends', W.last('session.switch'));
  W.h('login', 4, Cm);
  W.M.users.set(4, Cm);
  W.h('packet', 4, { customPacketType: 'characterSelectMenuRequest' });
  ok(W.last('session.char_menu') && !W.K.S.online.has(Cm), 'back to the character menu: session.char_menu, the session ends');
  W.h('packet', 4, { customPacketType: 'characterSelectResult', action: 'play', slot: 0, name: 'PLOGCANARY' });
  const logins = W.evs('session.login').length;
  W.tick('playerlogFast');
  ok(W.evs('session.login').length === logins + 1 && W.last('session.login').f.reselect === true, 'the same character chosen again: session.login{reselect}', W.last('session.login').f);
  W.h('packet', 4, { customPacketType: 'characterSelectResult', action: 'create', slot: 2 });
  W.h('packet', 4, { customPacketType: 'characterSelectResult', action: 'delete', slot: 0 });
  ok(W.last('session.char_create').f.slot === 2 && W.last('session.char_delete').f.slot === 0, 'character create and delete from the menu packets');
  ok(!JSON.stringify(W.K.S.q).includes('PLOGCANARY'), 'a packet field not on the allow-list is never read');
  mark(W);

  // ================================================================================================================ items
  reset();
  W = world();
  W.QU.run(); await F.settle();
  for (const [u, a] of [[3, A], [4, B], [5, Cm], [6, D]]) W.h('login', u, a);
  W.QU.run();
  W.tick('playerlogLocation');
  // the seam: a put into a chest with the extras the collectors read
  W.M.mp.onActivate = () => true;
  W.M.mp['onPapyrusEvent:SkympOnActivateClose'] = (...a) => 'closed';
  delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run(); await F.settle();
  W.M.mp.onActivate(OWNCHEST, A);
  const exB = [], exA = [{ health: 1.3, enchantmentId: 0x4605a, count: 1 }, { name: 'PLOGCANARY', named: true, count: 1 }];
  W.h('move', 'put', A, OWNCHEST, SWORD, 2, [3, 0], [1, 2], exB, exA);
  W.h('move', 'take', A, OWNCHEST, BREAD, 1, [0, 4], [1, 3], [], []);
  const mv = W.evs('item.move');
  ok(mv.length === 2 && mv[0].f.kind === 'put' && mv[0].f.packBefore === 3 && mv[0].f.contAfter === 2, 'the seam: each put and take on disk with both counts', mv.map((r) => r.f));
  ok(mv[0].f.item.ench === 'Ench Fire Damage' && mv[0].f.item.tmp === 1.3, 'an enchanted, tempered sword keeps ench and tmp', mv[0].f.item);
  ok(!JSON.stringify(W.K.S.q).includes('PLOGCANARY'), 'a custom name is never copied');
  const closeArgs = [];
  W.M.mp['onPapyrusEvent:SkympOnActivateClose'].__dboPlogInner = (...a) => { closeArgs.push(a); return 'closed'; };
  // labour.js's synthetic one-argument closes of a chopping block: no session closed, the inner untouched
  const r1 = W.M.mp['onPapyrusEvent:SkympOnActivateClose'](0x700001);
  ok(!W.evs('item.container').length && W.K.S.containers.has(A), 'labour\'s synthetic close of a chopping block closes no container session');
  ok(r1 === 'closed' || r1 === undefined, '...the inner handler still answers', r1);
  W.M.mp['onPapyrusEvent:SkympOnActivateClose'](OWNCHEST, { desc: `${A.toString(16)}:Skyrim.esm` });
  const sum = W.last('item.container');
  ok(sum && sum.f.put[0].k === 2 && sum.f.took[0].k === 1 && sum.f.own === 'public' && sum.f.ref === OWNCHEST.toString(16), 'SkympOnActivateClose: one summary per open and close', sum && sum.f);
  // the 60 s idle close
  W.M.mp.onActivate(OWNCHEST, A);
  W.h('move', 'take', A, OWNCHEST, BREAD, 1, [1, 3], [2, 2], [], []);
  W.CL.t += 61000; W.tick('playerlogFast');
  ok(W.evs('item.container').length === 2, '...and the 60 s idle closes one too');
  // a drop, then a pickup by someone else names the dropper
  const dropOrig = () => undefined;
  W.M.mp.onDropItem = dropOrig;
  delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run(); await F.settle();
  setInv(W, A, [{ baseId: SWORD, count: 2 }]);
  W.M.mp.onDropItem(A, SWORD, 1); addItem(W, A, SWORD, -1); W.QU.run();
  ok(W.last('item.drop') && W.last('item.drop').f.item.k === 1, 'a drop, confirmed by the pack diff');
  setInv(W, B, []);
  W.M.mp.onActivate(ITEM_REF, B); addItem(W, B, SWORD, 1); W.QU.run();
  const pick = W.last('item.pickup');
  ok(pick && pick.o && pick.o[0].c === 'PGDB' && pick.o[0].r === 'dropper', 'a pickup names who dropped it (the 120 s drop table)', pick);
  // a harvest: what grew in the pack, folded per minute
  setInv(W, A, []);
  W.M.mp.onActivate(HERB, A); addItem(W, A, ROSE, 2); W.QU.run();
  W.CL.t += 61000; W.tick('playerlogFast');
  ok(W.last('item.harvest') && W.last('item.harvest').f.k === 2 && W.last('item.harvest').f.item.i === 'Mountain Flower', 'a harvest: the produce, folded', W.last('item.harvest'));
  // eating: food folded, a potion its own line, the item gone whatever the verdict
  W.M.mp.onEatItem = () => false;
  delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run(); await F.settle();
  W.M.mp.onEatItem(A, BREAD); W.M.mp.onEatItem(A, BREAD); W.M.mp.onEatItem(A, POTION);
  ok(W.last('item.consume') && W.last('item.consume').f.kind === 'potion', 'a potion: its own line even when the verdict is false');
  W.CL.t += 61000; W.tick('playerlogFast');
  ok(W.evs('item.consume').some((r) => r.f.kind === 'food'), '...food folded per minute');
  // crafting: the product from the args, the inputs from the recipe
  const cobj = 0x30000;
  const cnto = new Uint8Array(8); new DataView(cnto.buffer).setUint32(0, BREAD, true); new DataView(cnto.buffer).setInt32(4, 2, true);
  W.M.record(cobj, 'COBJ', 'RecipeSword', { fields: [{ type: 'CNTO', data: cnto }] });
  W.M.mp.onCraft = () => undefined;
  delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run(); await F.settle();
  W.M.mp.onCraft(A, SWORD, 1, cobj);
  ok(W.last('item.craft') && W.last('item.craft').f.product.i === 'Iron Sword' && W.last('item.craft').f.inputs[0].k === 2, 'a craft: product and recipe inputs', W.last('item.craft') && W.last('item.craft').f);
  // a console AddItem on a player, confirmed by OnItemAdded
  W.M.mp.onConsoleCommand = () => undefined;
  delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run(); await F.settle();
  W.M.mp.onConsoleCommand(D, 'AddItem', B, SWORD, 3);
  const added = W.M.mp['onPapyrusEvent:OnItemAdded'](B, { desc: `${SWORD.toString(16)}:Skyrim.esm` }, 3);
  ok(added === undefined && W.last('item.grant') && W.last('item.grant').f.via === 'console' && W.last('item.grant').o[0].c === 'U6T6', 'OnItemAdded: a console grant on a player, never returning false', W.last('item.grant'));
  ok(W.M.mp['onPapyrusEvent:OnItemAdded'](WOLF, { desc: 'x' }, 1) === undefined, '...an NPC: nothing, and no verdict');
  // equipment: the login burst skipped, then a diff folded over 3 s
  W.M.mp.onUpdateEquipmentAttempt = () => undefined;
  delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run(); await F.settle();
  W.h('login', 3, A);
  W.M.mp.onUpdateEquipmentAttempt(A, { inv: { entries: [{ baseId: SWORD, count: 1, worn: true }] } }, true);
  W.CL.t += 21000;
  W.M.mp.onUpdateEquipmentAttempt(A, { inv: { entries: [{ baseId: SWORD, count: 1, worn: true }, { baseId: 0x13911, count: 1, worn: true }] } }, true);
  W.M.mp.onUpdateEquipmentAttempt(A, { inv: { entries: [{ baseId: 0x13911, count: 1, worn: true }] } }, true);
  W.CL.t += 4000; W.tick('playerlogFast');
  const eq = W.evs('item.equip');
  ok(eq.length === 1 && eq[0].f.on.length === 1 && eq[0].f.off.length === 1, 'equipment: the login burst skipped, then one folded diff', eq.map((r) => r.f));
  mark(W);

  // ================================================================================================================ ownership
  reset();
  W = world();
  W.QU.run(); await F.settle();
  const HS = housing(W);
  for (const [u, a] of [[3, A], [4, B], [5, Cm], [6, D]]) W.h('login', u, a);
  W.M.mp.onActivate = (t, c) => (t === RENTED || (t === CHEST && c === B && W.refuse) ? false : true);
  delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run(); await F.settle();
  W.tick('playerlogLocation');
  // a chest assigned to Mike in Mike's place, opened by Selene with a key
  HS.keys.add(`${B}`);
  W.M.mp.onActivate(CHEST, B);
  W.h('move', 'take', B, CHEST, SWORD, 1, [0, 1], [1, 0], [], []);
  W.M.mp['onPapyrusEvent:SkympOnActivateClose'](CHEST);
  const ac = W.last('item.container');
  ok(ac && ac.f.own === 'assignee' && ac.f.access === 'key' && ac.o.some((x) => x.r === 'assignee' && x.c === '5D8L'), 'an assigned chest: own assignee, the assignee in o, access key', ac && [ac.f, ac.o]);
  ok(ac && ac.nr && ac.nr.length && ac.nr.every((x) => x.dist !== undefined && x.x === undefined), '...near list with distances only', ac && ac.nr);
  W.K.flushTick(true);
  // the priority of someone else's chest is P0: it survives a queue at the soft cap
  ok(R.EVENT_TYPES['item.container'].p === 1, 'a container summary is P1 by type, raised to P0 when the owner is someone else (opts.p)');
  // a shared chest
  W.M.mp.onActivate(SHARED, B);
  W.h('move', 'take', B, SHARED, SWORD, 1, [1, 1], [2, 0], [], []);
  W.M.mp['onPapyrusEvent:SkympOnActivateClose'](SHARED);
  ok(W.last('item.container').f.own === 'household', 'a shared chest: household', W.last('item.container').f);
  // faction storage and a rented business chest
  globalThis.__dboGuildStorageAt = (ref) => (ref === GUILD ? { fid: 'g1', leaderProfile: 3 } : null);
  globalThis.__dboBusinessChestOf = (ref) => (ref === RENTED ? { claim: 1, ownerProfile: 3, renterProfile: 1, renterChar: A } : null);
  W.M.mp.onActivate(GUILD, B);
  W.h('move', 'put', B, GUILD, SWORD, 1, [2, 0], [1, 1], [], []);
  W.M.mp['onPapyrusEvent:SkympOnActivateClose'](GUILD);
  ok(W.last('item.container').f.own === 'faction' && W.last('item.container').o[0].r === 'faction_leader', 'a faction storage chest: faction, the leader in o', W.last('item.container'));
  // a refused activation on an owned chest, 4 times: one line with n 4
  for (let i = 0; i < 4; i++) W.M.mp.onActivate(RENTED, B);
  ok(!W.evs('item.access_refused').length, 'refused attempts wait for the end of their minute');
  W.CL.t += 61000; W.tick('playerlogMinute');
  const ar = W.evs('item.access_refused');
  ok(ar.length === 1 && ar[0].f.n === 4 && ar[0].f.own === 'renter' && ar[0].f.why === 'rented', 'one item.access_refused{n:4} for the rented chest', ar.map((r) => r.f));
  // a door into Mike's house used by Selene, and a cell change into it
  W.M.mp.onActivate(DOOR, B);
  const door = W.last('move.door');
  ok(door && door.f.own === 'owner' && door.f.access === 'key' && door.o[0].c === '5D8L', 'a door into someone\'s house: move.door with the owner and the access', door && [door.f, door.o]);
  HS.inside.add(B);
  W.M.mp.set(B, 'worldOrCellDesc', '1a2b:Skyrim.esm');
  W.tick('playerlogLocation');
  const cell = W.last('move.cell');
  ok(cell && cell.f.own === 'owner' && cell.o && cell.o[0].c === '5D8L', 'a cell change into a claimed interior: the owner in o', cell && [cell.f, cell.o]);
  mark(W);

  // ================================================================================================================ combat
  reset();
  W = world();
  W.QU.run(); await F.settle();
  for (const [u, a] of [[3, A], [4, B], [5, Cm], [6, D]]) W.h('login', u, a);
  W.M.mp.onHitDamageAttempt = (agg, tgt, src, dmg) => { if (W.godB && tgt === A && agg === B) { globalThis.__dboHitRefusal = 'god'; return false; } if (W.refuseAll) { globalThis.__dboHitRefusal = 'spell_rate'; return false; } return true; };
  W.M.mp.onHitDamage = (agg, tgt) => undefined;
  W.M.mp.onDeath = () => undefined;
  W.M.mp.onSpellCast = () => undefined;
  delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run(); await F.settle();
  W.tick('playerlogLocation');
  const hit = (agg, tgt, dmg, after, flags) => {
    const v = W.M.mp.onHitDamageAttempt(agg, tgt, SWORD, dmg, Object.assign({ targetMaxHealth: 100 }, flags || {}));
    if (v === false) return v;
    W.M.mp.set(tgt, 'percentages', { health: after });
    W.M.mp.onHitDamage(agg, tgt, SWORD, dmg);
    return v;
  };
  // who struck first: Selene's first swing refused (god mode), Rowan's first allowed hit 2 s later, Selene's 3 s after that
  globalThis.__dboPartyLeaderOf = () => 7;
  W.K.put('recentPair', `${B}|${A}`, { kind: 'robbery_demand', by: B, t: W.CL.t - 40000 });
  W.godB = true;
  W.M.mp.onHitDamageAttempt(B, A, SWORD, 10, {});
  W.CL.t += 2000; hit(A, B, 10, 0.9);
  W.godB = false;
  W.CL.t += 3000; hit(B, A, 20, 0.8, { power: true });
  W.CL.t += 1000; hit(A, B, 10, 0.8, { blocked: true });
  W.CL.t += 6000; W.tick('playerlogFast');
  ok(W.evs('combat.damage').length >= 3, '5 s windows close into combat.damage (disk)', W.evs('combat.damage').length);
  ok(W.evs('combat.damage').some((r) => r.f.blk === 1), '...a blocked hit counted in its window');
  W.CL.t += 16000; W.tick('playerlogFast');
  const fight = W.last('combat.fight');
  ok(fight && fight.f.first === 'them' && fight.f.att1them < fight.f.t1me && fight.f.t1them > fight.f.t1me, 'who struck first: them (Selene swung first, refused), with each side\'s times', fight && fight.f);
  ok(fight && fight.f.refused && fight.f.refused.god === 1, '...her refused swing counted by reason', fight && fight.f.refused);
  ok(fight && fight.f.party === true && fight.f.pvp === true && fight.f.link && fight.f.link.kind === 'robbery_demand' && fight.f.link.by === 'them', '...same party, and the robbery demand 40 s before linked', fight && [fight.f.party, fight.f.link]);
  ok(fight && fight.f.dealt.hits === 2 && fight.f.taken.hits === 1 && fight.o[0].c === 'K2QX', '...hits both ways, the opponent in o', fight && fight.f);
  // the refused path is lean: a concentration beam, 10 refused attempts a second for 10 s
  W.refuseAll = true;
  const gets0 = W.M.S.gets, pairs0 = W.K.S.refusedPair.size;
  for (let i = 0; i < 100; i++) W.M.mp.onHitDamageAttempt(B, A, SWORD, 5, {});
  ok(W.M.S.gets === gets0, '100 refused attempts: no mp.get', W.M.S.gets - gets0);
  ok(W.K.S.refusedPair.size === pairs0 + 1 && W.K.S.refusedPair.get(`${B}|${A}`).n.spell_rate === 100, '...one counter entry for the pair, counted by reason', [...W.K.S.refusedPair]);
  W.refuseAll = false;
  const gets1 = W.M.S.gets;
  for (let i = 0; i < 50; i++) { W.M.mp.onHitDamageAttempt(WOLF, BANDIT, SWORD, 5, {}); W.M.mp.onHitDamage(WOLF, BANDIT, SWORD, 5); W.M.mp.onDeath(BANDIT, WOLF); }
  ok(W.M.S.gets === gets1, 'NPC against NPC: no mp.get at all', W.M.S.gets - gets1);
  W.CL.t += 61000; W.tick('playerlogFast');
  ok(W.evs('combat.refused').some((r) => r.f.reason === 'spell_rate' && r.f.n === 100), 'refusals that never became a fight: combat.refused (disk), closed by the fast poll');
  // the killing blow: Attempt -> onDeath -> onHitDamage names the weapon
  W.M.mp.onHitDamageAttempt(WOLF, A, 0x12eb7, 40, { targetMaxHealth: 100 });
  W.M.mp.onDeath(A, WOLF);
  const down = W.last('combat.down');
  ok(down && down.f.cause === 'hit' && down.f.src === 'Iron Sword' && down.o[0].npc === 'WolfGray', 'a down: the killing blow\'s weapon from the pending attempt, the NPC in o', down && [down.f, down.o]);
  ok(down && down.at && Number.isFinite(down.at.x) && down.nr && down.nr.some((x) => x.c === 'K2QX') && !down.nr.some((x) => x.c === 'U6T6'), '...coordinates (a pos type) and the near list: Selene 500 away yes, Dar 9000 away no', down && down.nr);
  W.QU.run();
  ok(W.evs('item.snapshot').some((r) => r.f.at === 'down'), '...and an inventory snapshot at the down');
  // near costs no get
  const gets2 = W.M.S.gets;
  const nr = W.K.nearOf(A);
  ok(W.M.S.gets === gets2 && nr.length === 2 && nr.every((x) => x.x === undefined && x.dist > 0), 'near lists come from the location cache: no get, distances only', nr);
  // NPC owners: Selene kills Rowan's companion Lydia; a GM's warband NPC hits Rowan
  W.K.add('ownedNpcs', LYDIA);
  W.M.mp.onHitDamageAttempt(B, LYDIA, SWORD, 30, {});
  W.M.mp.onDeath(LYDIA, B);
  const kill = W.last('combat.kill');
  ok(kill && kill.p === 2 && kill.f.victim.owner && kill.f.victim.owner.c === 'PGDB' && kill.o && kill.o[0].c === 'PGDB', 'a companion killed: the kill names its owner, who is in o too', kill && [kill.f, kill.o]);
  globalThis.__dboWarband = { owners: new Map([[BANDIT, { gm: D, profile: 4 }]]) };
  W.K.add('ownedNpcs', BANDIT);
  W.K.S.npcInfo.delete(BANDIT);
  const party = W.K.partyOf(BANDIT, 'by');
  ok(party.owner && party.owner.c === 'U6T6' && party.owner.why === 'warband', 'a GM\'s warband NPC: the GM is its owner', party);
  // casts folded per minute
  W.M.mp.onSpellCast(A, 0x12eb7); W.M.mp.onSpellCast(A, 0x12eb7);
  W.CL.t += 61000; W.tick('playerlogFast');
  ok(W.last('combat.cast') && W.last('combat.cast').f.spells[0].n === 2, 'casts: counted per minute');
  // a capture from the restraint poll
  W.M.mp.set(B, 'private.restrained', { boundHands: true, captorActorId: A });
  W.tick('playerlogFast');
  W.M.mp.set(B, 'private.restrained', null);
  W.tick('playerlogFast');
  const caps = W.evs('combat.capture');
  ok(caps.length === 2 && caps[0].f.op === 'cuffed' && caps[0].o[0].c === 'PGDB' && caps[1].f.op === 'released', 'a capture and its release from the restraint poll', caps.map((r) => [r.f, r.o]));
  mark(W);

  // ================================================================================================================ health loss
  reset();
  W = world();
  W.QU.run(); await F.settle();
  for (const [u, a] of [[3, A], [4, B]]) W.h('login', u, a);
  W.tick('playerlogLocation');
  W.tick('playerlogFast');
  const drop = (pct) => { const p = W.M.mp.get(A, 'percentages'); W.M.mp.set(A, 'percentages', { health: Math.max(0, p.health - pct / 100) }); W.CL.t += 2000; W.tick('playerlogFast'); };
  drop(3);
  W.CL.t += 31000; W.tick('playerlogFast');
  ok(!W.evs('combat.health_loss').length, 'a drop under 5% is ignored');
  for (const why of ['equip', 'eat', 'wake', 'level', 'sun']) {
    if (why === 'equip') W.K.put('suppress', A, { t: W.CL.t, until: W.CL.t + 5000 });
    if (why === 'eat') { W.M.mp.onEatItem = () => undefined; delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run(); W.M.mp.onEatItem(A, BREAD); }
    if (why === 'wake') W.h('wake', A, 'gave_up', 0, 60000);
    if (why === 'level') W.h('level', A, 'health', 1, 5);
    if (why === 'sun') W.h('effect', A, 'sun', 1.2);
    drop(10);
    W.CL.t += 31000; W.tick('playerlogFast');
    ok(!W.evs('combat.health_loss').length, `a drop within 5 s after ${why}: nothing`);
    W.CL.t += 6000;
  }
  W.CL.t += 6000;
  W.M.mp.set(A, 'pos', [0, 0, -800]);
  drop(10); drop(10); drop(10);
  W.CL.t += 31000; W.tick('playerlogFast');
  const hl = W.evs('combat.health_loss');
  ok(hl.length === 1 && hl[0].f.merged === 3 && hl[0].f.cause === 'fall_likely' && hl[0].q === 'inferred', 'three drops in 30 s: one record; a z drop over 500: fall_likely', hl.map((r) => r.f));
  ok(R.EVENT_TYPES['combat.health_loss'].disk === true, '...disk only in phase A1');
  mark(W);
  // a vampire outdoors, with no sun hook seen this load
  reset();
  W = world();
  W.QU.run(); await F.settle();
  W.h('login', 3, A);
  W.tick('playerlogLocation'); W.tick('playerlogFast');
  W.M.mp.set(A, 'private.supernatural', { kind: 'vampire' });
  W.M.mp.set(A, 'percentages', { health: 0.5 }); W.CL.t += 2000; W.tick('playerlogFast');
  W.CL.t += 31000; W.tick('playerlogFast');
  ok(!W.evs('combat.health_loss').length, 'a vampire outdoors before the sun hook is live: skipped');
  mark(W);

  // ================================================================================================================ movement
  reset();
  W = world();
  W.QU.run(); await F.settle();
  W.h('login', 3, A);
  W.tick('playerlogLocation');
  const g0 = W.M.S.gets;
  W.M.mp.set(A, 'worldOrCellDesc', '1c3d:Skyrim.esm');
  W.tick('playerlogLocation');
  ok(W.M.S.gets - g0 === 2 * W.K.S.online.size, 'the location poll: two gets per player, the zone from those reads', [W.M.S.gets - g0, W.K.S.online.size]);
  const mc = W.last('move.cell');
  ok(mc && mc.f.from.w === 'a764b:BSHeartland.esm' && mc.f.to.w === '1c3d:Skyrim.esm' && mc.f.to.zone === 'bruma' && mc.at && mc.at.x === undefined, 'a cell change: move.cell with both places, no coordinates', mc && mc.f);
  W.h('travel', A, 'unstuck', A);
  W.M.mp.set(A, 'worldOrCellDesc', 'a764b:BSHeartland.esm'); W.M.mp.set(A, 'pos', [90000, 0, 0]);
  W.tick('playerlogLocation');
  const tp = W.last('move.teleport');
  ok(tp && tp.f.reason === 'unstuck', 'a teleport with its travel reason', tp && tp.f);
  W.M.mp.set(A, 'pos', [190000, 0, 0]); W.tick('playerlogLocation');
  ok(W.last('move.teleport').f.reason === 'unknown' && W.last('move.teleport').q === 'inferred', 'a jump with no reason: unknown, inferred');
  ok(W.last('move.zone') && W.last('move.zone').f.from === 'bruma' && W.last('move.zone').f.to === 'falkreath', 'a hold change outdoors: move.zone', W.last('move.zone'));
  // AFK: 10 minutes in one place
  for (let i = 0; i < 22; i++) { W.CL.t += 30000; W.tick('playerlogAfk'); }
  ok(W.last('session.afk') && W.last('session.afk').f.op === 'away', 'AFK after 10 minutes in place');
  W.M.mp.set(A, 'pos', [191000, 0, 0]); W.tick('playerlogLocation'); W.tick('playerlogAfk');
  ok(W.last('session.afk').f.op === 'back', '...and back');
  // mastery and companions from the slow poll
  W.M.mp.set(A, 'private.mastery', { skills: { smithing: { level: 3, rank: 0 } }, order: ['smithing'] });
  for (let i = 0; i < 4; i++) W.tick('playerlogSlow');
  W.M.mp.set(A, 'private.mastery', { skills: { smithing: { level: 4, rank: 0 }, mining: { level: 0, rank: 0 } }, order: ['smithing', 'mining'] });
  globalThis.__dboCompanions = { list: (o) => (o === A ? W.comps || [] : []) };
  for (let i = 0; i < 4; i++) W.tick('playerlogSlow');
  W.comps = [{ id: LYDIA, kind: 'follower', baseId: 0x10ab0 }];
  for (let i = 0; i < 4; i++) W.tick('playerlogSlow');
  ok(W.evs('char.mastery').some((r) => r.f.op === 'take_up' && r.f.skill === 'mining') && W.evs('char.mastery').some((r) => r.f.op === 'level' && r.f.to === 4), 'mastery: take-up and level from the slow poll', W.evs('char.mastery').map((r) => r.f));
  ok(W.last('social.companion') && W.last('social.companion').f.op === 'spawned' && W.K.S.ownedNpcs.has(LYDIA), 'a companion: spawned, and known as player-owned');
  mark(W);

  // ================================================================================================================ packets, audit, trade
  reset();
  W = world();
  W.QU.run(); await F.settle();
  for (const [u, a] of [[3, A], [4, B], [5, Cm], [6, D]]) W.h('login', u, a);
  globalThis.__alduinakTradeLog = () => undefined;
  delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run(); await F.settle();
  W.h('packet', 3, { customPacketType: 'searchRequest', target: B });
  W.h('packet', 4, { customPacketType: 'searchConsentResult', requestId: 1, accepted: false });
  ok(W.evs('law.search').map((r) => r.f.op).join(',') === 'requested,refused', 'a refused search consent: law.search{refused}', W.evs('law.search').map((r) => r.f));
  W.h('packet', 3, { customPacketType: 'searchRequest', target: Cm });
  W.CL.t += 61000; W.tick('playerlogFast');
  ok(W.last('law.search').f.op === 'timeout', '...an unanswered one: timeout');
  W.h('packet', 6, { customPacketType: 'adminAction', action: 'kick', target: B, targetName: 'PLOGCANARY', reason: 'PLOGCANARY', amount: 5 });
  W.h('audit', `GM profile 4 (gm) kicked Selene (profile 2)`);
  W.K.flushTick(true);
  const sa = W.last('staff.action');
  ok(sa && sa.f.action === 'kick' && sa.f.via === 'panel' && sa.f.outcome === 'ok' && sa.f.params && sa.f.params.amount === 5 && sa.o[0].c === 'K2QX', 'a panel action: the packet\'s fields with the server\'s outcome, the target in o', sa && [sa.f, sa.o]);
  ok(!JSON.stringify(W.K.S.q).includes('PLOGCANARY'), '...targetName and reason never read');
  W.h('packet', 3, { customPacketType: 'propertyRequest', action: 'lock', target: DOOR, name: 'PLOGCANARY' });
  W.QU.run();
  ok(W.last('social.housing') && W.last('social.housing').f.op === 'lock' && W.last('social.housing').q === 'inferred', 'a property request: social.housing, inferred');
  W.h('packet', 3, { customPacketType: 'dboChatSecret', text: 'PLOGCANARY' });
  W.h('packet', 3, { type: 'cef::chat:send', data: 'PLOGCANARY' });
  ok(!JSON.stringify(W.K.S.q).includes('PLOGCANARY'), 'a packet type off the list, and chat, are never read');
  // Name #TAG audit parties: a tag shared by two characters
  W.M.player(0xff000018, { profile: 9, name: 'Other', tag: 'K2QX', discord: '' });
  W.h('audit', 'STRUGGLE Selene #K2QX broke free of Rowan #PGDB (seed 1, err 0.10)');
  W.K.flushTick(true);
  const st = W.last('act.STRUGGLE');
  ok(st && st.p === 2 && st.c === 'K2QX', 'a tag shared by two characters: resolved by the name', st);
  W.M.player(0xff000019, { profile: 10, name: 'Selene', tag: 'K2QX', discord: '' });
  W.K.add('online', 0xff000019);
  W.h('audit', 'STRUGGLE Selene #K2QX broke free of Rowan #PGDB (seed 1, err 0.10)');
  W.K.flushTick(true);
  const amb = W.last('act.STRUGGLE');
  ok(amb && amb.p === -1 && W.K.S.q.slice(-3).some((r) => r.ev === 'act.STRUGGLE'), 'the same name and tag twice: ambiguous, routed to nobody (p -1)', amb);
  // the trade summary: names in quotes ignored
  globalThis.__alduinakTradeLog(`[trade] "Rowan" (profile 1, actor ${A.toString(16)}) gave [2x 0x12eb7 "PLOGCANARY ] (profile 9, actor ff0000ff)" {health=1.2}] to "Selene" (profile 2, actor ${B.toString(16)}) for [1x 0xf]`);
  const tr = W.last('item.trade');
  ok(tr && tr.f.gave[0].k === 2 && tr.f.gave[0].i === 'Iron Sword' && tr.f.gave[0].tmp === 1.2 && tr.o[0].c === 'K2QX' && !JSON.stringify(tr).includes('PLOGCANARY'), 'a trade: counts and record names, the custom names in quotes ignored', tr && [tr.f, tr.o]);
  // the A2 hooks, each once
  W.h('loot', 'player_body', A, B, [{ baseId: SWORD, count: 1, name: 'PLOGCANARY' }], 5);
  W.h('loot', 'dungeon_body', A, 0, [{ baseId: SWORD, count: 1 }], 10, [{ actor: B, gold: 5 }]);
  W.h('letter', A, B, { gold: 5, items: [{ baseId: BREAD, count: 1 }], signed: 'forged' });
  W.api.creationPending = (x) => x === A;
  W.h('appearance', A, { raceId: 0x13746, isFemale: true, name: 'PLOGCANARY' }, true);
  ok(W.last('session.char_created') && W.last('session.char_created').f.sex === 'female' && W.last('char.appearance').f.kind === 'creation', 'a creation RaceMenu close: char_created and char.appearance, never the name');
  W.h('grant', A, 'kit', [{ baseId: SWORD, count: 1 }]);
  W.h('staffview', D, A, 'charstats');
  W.h('relog', A, [{ base: '12eb7', pack: [1, 3], containers: [0, 0] }]);
  W.h('dungeon', 'claim', [A, B], 'Gutted Mine', 'Hard');
  W.h('party', 'invite', A, B, 2);
  W.h('mask', A, true);
  W.h('pmenu', A, 'inspect', B); W.h('pmenu', A, 'voice:mute', B);
  W.h('business', A, 'open', 0x1234, 0);
  W.h('contract', 'abandon', A, 'wolf', 7, 'bruma', 0);
  W.h('faction', 'kick', D, A, 'g1');
  W.h('staffworld', 'war', D);
  W.h('bankwrite', A, 'wage', 10, 20);
  W.h('income', 'champion', A, 100);
  W.h('salvage', A, { baseId: SWORD, count: 1 }, 'forge', 2, [{ baseId: 0x5ace4, count: 2 }]);
  W.h('brew', A, POTION, 2, [{ baseId: ROSE, count: 2 }]);
  W.h('extras', A, 'disenchant', SWORD);
  W.h('misc', A, 'title', 'Thane');
  W.M.record(0x1f00a, 'REFR', 'BrumaMapMarker');
  W.h('map', A, ['1f00a:Skyrim.esm', '1f00b:Skyrim.esm']);
  ok(W.last('move.map') && W.last('move.map').f.n === 2 && W.last('move.map').f.names[0] === 'Bruma Map Marker', 'places discovered: named by their record', W.last('move.map') && W.last('move.map').f);
  W.h('dossier', 'written', D, A);
  W.h('report', 'bug', A, 'bug-2026-10-13-1.json');
  W.h('effect', A, 'stagger');
  W.h('theft', 'pickpocket', A, B, 'took', [{ baseId: SWORD, count: 1 }], 0);
  W.h('theft', 'raid', A, 0, 'took', [], 40, { home: DOOR, ownerProfile: 3 });
  W.h('lock', A, 'win', 2, CHEST, 3);
  W.h('lock', A, 'refused(fast)', 2, CHEST, 1);
  W.h('signal', A, 'labour', 'replay');
  W.h('itemflow', A, 'pick_snapped', 0xa, -1);
  W.h('gate', A, 'too_long', 'say');
  W.h('gate', A, 'unknown', 'xyzzy');
  W.h('gate', A, 'not_staff', 'kick');
  W.CL.t += 61000; W.tick('playerlogFast');
  ok(W.last('item.theft') && W.evs('item.theft').some((r) => r.f.kind === 'body_search') && W.evs('item.theft').some((r) => r.f.kind === 'raid' && r.o.some((x) => x.r === 'owner' && x.p === 3)), 'thefts: a body search, a raid routed to the home\'s owner');
  ok(W.evs('social.lock').some((r) => r.f.op === 'refused' && r.f.why === 'fast') && W.evs('sec.signal').some((r) => r.f.kind === 'lockpick_refused'), 'a refused lockpick: social.lock and a security signal');
  ok(W.evs('move.dungeon').length === 2, 'a dungeon claim goes to every member');
  ok(W.evs('social.player_menu').length === 1 && W.last('social.player_menu').o[0].c === 'K2QX', 'the player menu: the target kept, voice never');
  ok(W.evs('cmd.refused').map((r) => r.f.reason).join(',') === 'unknown,not_staff' && W.evs('cmd.refused').every((r) => r.f.name !== 'xyzzy'), 'gate refusals: a long chat line records nothing, an unknown name is never kept', W.evs('cmd.refused').map((r) => r.f));
  ok(!JSON.stringify(W.K.S.q).includes('PLOGCANARY'), 'no custom name from any hook');
  mark(W);


  // ================================================================================================================ review fixes
  const NONE = { f: {}, o: [], p: undefined };
  // housingSystem.ts with the place rules applied (live: "place plan (apply" in the server log): recordOf and primaryOf answer
  // with the place ROOT for any of its doors and chests; assigned and shared are keyed by each member's OWN primary
  // (roomsOf/doRoom); a door pair keeps its record on the lower id and a pointer { primary } on the other half; an actor is
  // never a ref (isClaimable), so recordOf(actor) is null
  const DOOR2 = 0x806ca41, DOOR2LOW = 0x806ca40;
  const housingApply = (W) => {
    const rootRec = { owner: 3, ownerChar: Cm, ownerName: 'Mike', locked: true, serial: 1, place: { cells: ['1a2b:Skyrim.esm'] },
      assigned: { [CHEST.toString(16)]: { profile: 2, name: 'Selene', char: B }, [DOOR2LOW.toString(16)]: { profile: 2, name: 'Selene', char: B } }, shared: [SHARED.toString(16)] };
    const members = new Set([DOOR, CHEST, SHARED, DOOR2, DOOR2LOW]);
    const keys = new Set();
    W.M.mp.set(DOOR2, 'private.housing', { primary: DOOR2LOW });
    globalThis.__dboHousing = {
      primaryOf: (ref) => (members.has(ref >>> 0) ? DOOR : 0),
      recordOf: (ref) => (members.has(ref >>> 0) ? rootRec : null),
      ownsRecord: (rec, a) => !!rec && Number(rec.owner) > 0 && W.M.mp.get(a, 'profileId') === rec.owner,
      keyOpens: (ref, a) => keys.has(a >>> 0),
      isManager: () => false,
      perCharacter: () => false,
    };
    return { rootRec, keys };
  };
  reset();
  W = world({ caps: { soft: 5, mid: 10, hard: 2000, audit: 2000 } });
  W.QU.run(); await F.settle();
  let HA = housingApply(W);
  for (const [u, a] of [[3, A], [4, B], [5, Cm], [6, D]]) W.h('login', u, a);
  W.M.mp.onActivate = () => true;
  W.M.ref(DOOR2, DOORBASE); W.M.ref(DOOR2LOW, DOORBASE);
  delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run(); await F.settle();
  W.tick('playerlogLocation');
  W.K.S.q.length = 0;
  // C-R1: Selene's own assigned room chest is hers: no urgent line, even with the record of the root in hand
  W.M.mp.onActivate(CHEST, B);
  W.h('move', 'take', B, CHEST, SWORD, 1, [0, 1], [1, 0], [], []);
  W.M.mp['onPapyrusEvent:SkympOnActivateClose'](CHEST);
  let ct = W.last('item.container');
  ok(ct && ct.f.own === 'self' && !ct.o, 'C-R1: the assignee\'s own chest in a place is theirs (own self), with the place root\'s record', ct && [ct.f, ct.o]);
  // the place's owner at Selene's chest: her chest, the owner's access
  W.M.mp.onActivate(CHEST, Cm);
  W.M.mp['onPapyrusEvent:SkympOnActivateClose'](CHEST);
  ct = W.last('item.container');
  ok(ct && ct.f.own === 'assignee' && ct.f.access === 'owner' && ct.o.some((x) => x.r === 'assignee' && x.c === 'K2QX'), '...the owner at the assignee\'s chest: own assignee, access owner', ct && [ct.f, ct.o]);
  // the shared chest, by a housemate with the key: household, P1 (dropped at the mid cap here, where a P0 line is kept)
  HA.keys.add(A);
  for (let i = 0; i < 12; i++) W.K.emit('item.trade', D, {});
  const qn = W.K.S.q.length;
  W.M.mp.onActivate(SHARED, A);
  W.h('move', 'take', A, SHARED, BREAD, 1, [0, 1], [1, 0], [], []);
  W.M.mp['onPapyrusEvent:SkympOnActivateClose'](SHARED);
  ok(W.K.S.q.length === qn && W.K.S.dropCounts.get('cap|item.container') === 1, '...the shared chest by a key holder: household at P1, not an urgent P0 line (dropped at the mid cap)', [W.K.S.q.length - qn, [...W.K.S.dropCounts]]);
  // the same chest, picked open by someone with no key: still P0
  W.h('lock', B, 'win', 1, SHARED);
  W.M.mp.onActivate(SHARED, B);
  W.M.mp['onPapyrusEvent:SkympOnActivateClose'](SHARED);
  ct = W.last('item.container');
  ok(ct && ct.f.own === 'household' && ct.f.access === 'lockpick' && W.K.S.q.length > qn, '...picked open: household, access lockpick, kept as P0', ct && ct.f);
  W.K.S.q.length = 0; W.K.S.dropCounts.clear();
  // a door pair: the record on the lower half, a pointer on the other; Selene's assigned room door is hers
  W.M.mp.onActivate(DOOR2, B);
  ok(!W.evs('move.door').length, '...the assignee\'s own room door (its pointer\'s primary keys the assignment): no line', W.evs('move.door').map((r) => r.f));
  W.M.mp.onActivate(DOOR2, A);
  ok(W.last('move.door') && (W.last('move.door') || NONE).f.own === 'assignee' && (W.last('move.door') || NONE).o.some((x) => x.c === 'K2QX'), '...someone else at her door: own assignee', W.last('move.door') && (W.last('move.door') || NONE).f);
  // C-R10: a cell of the place, known from the door use, with recordOf(actor) null as in housingSystem.ts
  W.M.mp.set(A, 'worldOrCellDesc', '1a2b:Skyrim.esm'); W.M.mp.set(A, 'pos', [10, 10, 10]);
  W.tick('playerlogLocation');
  const mc2 = W.last('move.cell');
  ok(mc2 && mc2.f.own === 'owner' && mc2.f.access === 'key' && mc2.o && mc2.o[0].c === '5D8L', 'C-R10: a cell change into a claimed interior names the owner, from the place\'s cells (recordOf(actor) is null)', mc2 && [mc2.f, mc2.o]);
  W.M.mp.set(A, 'worldOrCellDesc', '9f9f:Skyrim.esm'); W.tick('playerlogLocation');
  ok(W.last('move.cell') && !(W.last('move.cell') || NONE).o, '...an interior no place holds: a plain move.cell');
  mark(W);

  // C-R2: the real consent packet {requestId, accepted}; a body opens with no consent
  reset();
  W = world();
  W.QU.run(); await F.settle();
  for (const [u, a] of [[3, A], [4, B], [5, Cm], [6, D]]) W.h('login', u, a);
  W.h('packet', 5, { customPacketType: 'searchRequest', target: B });
  W.h('packet', 4, { customPacketType: 'searchConsentResult', requestId: 7, accepted: true });
  W.CL.t += 61000; W.tick('playerlogFast');
  let ops = W.evs('law.search').map((r) => r.f.op).join(',');
  ok(ops === 'requested,accepted' && (W.last('law.search') || NONE).p === 3 && (W.last('law.search') || NONE).o[0].c === 'K2QX', 'C-R2: an accepted search with the real packet: accepted, and no false timeout', W.evs('law.search').map((r) => [r.p, r.f]));
  W.M.mp.set(Cm, 'isDead', true);
  W.h('packet', 3, { customPacketType: 'searchRequest', target: Cm });
  W.CL.t += 61000; W.tick('playerlogFast');
  ok(W.evs('law.search').length === 2, '...a body\'s search (no consent step): no request line and no timeout', W.evs('law.search').map((r) => r.f));
  mark(W);

  // C-R3: a killing blow, in the engine's order (Attempt, then onDeath inside NetSetPercentages, then onHitDamage)
  reset();
  W = world();
  W.QU.run(); await F.settle();
  for (const [u, a] of [[3, A], [4, B]]) W.h('login', u, a);
  W.M.mp.onHitDamageAttempt = () => true; W.M.mp.onHitDamage = () => undefined; W.M.mp.onDeath = () => undefined;
  delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run(); await F.settle();
  W.tick('playerlogLocation');
  W.M.mp.onHitDamageAttempt(B, A, SWORD, 120, { targetMaxHealth: 100 });
  W.M.mp.set(A, 'percentages', { health: 0 });
  W.M.mp.onDeath(A, B);
  W.M.mp.onHitDamage(B, A, SWORD, 120);
  W.CL.t += 20000; W.tick('playerlogFast');
  let fs1 = W.evs('combat.fight');
  ok(fs1.length === 1 && fs1[0].f.dealt.hits === 1 && fs1[0].f.dealt.dmg === 100 && fs1[0].f.outcome === 'downed' && fs1[0].p === 2, 'C-R3: a one-blow PvP down is one fight with the blow counted, not a second phantom fight', fs1.map((r) => [r.p, r.f.dealt, r.f.taken, r.f.outcome]));
  W.M.mp.set(A, 'percentages', { health: 1 });
  W.M.mp.onHitDamageAttempt(A, WOLF, SWORD, 50, { targetMaxHealth: 40 });
  W.M.mp.set(WOLF, 'percentages', { health: 0 });
  W.M.mp.onDeath(WOLF, A);
  W.M.mp.onHitDamage(A, WOLF, SWORD, 50);
  W.CL.t += 20000; W.tick('playerlogFast');
  fs1 = W.evs('combat.fight').slice(1);
  ok(fs1.length === 1 && fs1[0].f.kills === 1 && fs1[0].f.dealt.hits === 1 && fs1[0].f.outcome === 'killed', '...a one-blow PvE kill: one fight, the kill and its blow', fs1.map((r) => r.f));
  // an owned NPC against an NPC: no fight with no player in it (it was written with p -1)
  W.K.add('ownedNpcs', LYDIA);
  W.M.mp.onHitDamageAttempt(BANDIT, LYDIA, SWORD, 10, {});
  W.M.mp.onHitDamage(BANDIT, LYDIA, SWORD, 10);
  W.CL.t += 20000; W.tick('playerlogFast');
  ok(!W.K.S.q.some((r) => r.ev === 'combat.fight' && r.p === -1) && W.evs('combat.fight').length === 2, '...an owned NPC\'s fight with an NPC opens no player-less fight', W.evs('combat.fight').map((r) => r.p));
  mark(W);

  // C-R5, C-R7, C-R8: the housing menu against its own opening state; the F7 panel's hex target; a kick line after the target left
  reset();
  W = world();
  W.QU.run(); await F.settle();
  const HS2 = housing(W);
  for (const [u, a] of [[3, A], [4, B], [5, Cm], [6, D]]) W.h('login', u, a);
  W.h('packet', 5, { customPacketType: 'propertyInfoRequest', target: DOOR });
  HS2.recs.get(DOOR).locked = false;   // housingSystem.ts (a TS system) already handled the packet when the gamemode sees it
  W.h('packet', 5, { customPacketType: 'propertyRequest', action: 'unlock', target: DOOR });
  ok(W.last('social.housing') && (W.last('social.housing') || NONE).f.op === 'unlock' && (W.last('social.housing') || NONE).f.ok === true, 'C-R5: a property action that went through: ok true (against the state when the menu opened)', W.last('social.housing') && (W.last('social.housing') || NONE).f);
  W.h('packet', 5, { customPacketType: 'propertyRequest', action: 'unlock', target: DOOR });
  ok((W.last('social.housing') || NONE).f.ok === false, '...the same again, with nothing changed: ok false');
  W.h('packet', 5, { customPacketType: 'propertyRequest', action: 'createkey', target: DOOR, recipient: B });
  W.h('packet', 5, { customPacketType: 'propertyRequest', action: 'grantcontainer', target: DOOR, recipient: B });
  W.h('packet', 5, { customPacketType: 'propertyRequest', action: 'revokekeys', target: DOOR });
  ok(W.evs('social.housing').slice(-3).map((r) => r.f.op).join(',') === 'cut_key,grant_container,rekey' && W.evs('social.housing').slice(-3)[0].o[0].c === 'K2QX', '...the real action names: createkey, grantcontainer, revokekeys', W.evs('social.housing').map((r) => r.f.op));
  // C-R5 (re-verify, reverify/checks/cr5-member-lock.js): a lock on a place MEMBER, a room chest with its own record. recordOf
  // answers the place's ROOT for it (housingSystem.ts exposeTenancy primary()), while lock is not PLACE_WIDE and goes to the
  // chest's own record (private.housing on the chest); the root's record does not change
  {
    const hs = globalThis.__dboHousing, recordOf0 = hs.recordOf, primaryOf0 = hs.primaryOf;
    const rootRec = HS2.recs.get(DOOR);
    hs.recordOf = (ref) => ([DOOR, OWNCHEST].includes(ref >>> 0) ? rootRec : recordOf0(ref));
    hs.primaryOf = (ref) => ([DOOR, OWNCHEST].includes(ref >>> 0) ? DOOR : primaryOf0(ref));
    const memberRec = { owner: 3, ownerChar: Cm, memberOf: DOOR, locked: false };
    W.M.mp.set(OWNCHEST, 'private.housing', memberRec);
    const rootBefore = JSON.stringify(rootRec);
    W.h('packet', 5, { customPacketType: 'propertyInfoRequest', target: OWNCHEST });
    W.M.mp.set(OWNCHEST, 'private.housing', Object.assign({}, memberRec, { locked: true }));   // doLock on the member's own record
    W.h('packet', 5, { customPacketType: 'propertyRequest', action: 'lock', target: OWNCHEST });
    const ml = W.last('social.housing') || NONE;
    ok(ml.f.op === 'lock' && ml.f.ok === true && ml.f.property === OWNCHEST.toString(16) && JSON.stringify(rootRec) === rootBefore, 'C-R5: a lock on a room chest that went through (its own record, not the place root\'s): ok true, never ok false', ml.f);
    W.h('packet', 5, { customPacketType: 'propertyRequest', action: 'lock', target: OWNCHEST });
    ok((W.last('social.housing') || NONE).f.ok === false, '...the same lock again, with nothing changed: ok false', (W.last('social.housing') || NONE).f);
    // an unclaimed chest inside the place: the lock adopts it (housingSystem.ts adopted()), writing its first own record
    W.M.mp.set(OWNCHEST, 'private.housing', undefined);
    W.h('packet', 5, { customPacketType: 'propertyInfoRequest', target: OWNCHEST });
    W.M.mp.set(OWNCHEST, 'private.housing', Object.assign({}, memberRec, { locked: true, issued: [] }));
    W.h('packet', 5, { customPacketType: 'propertyRequest', action: 'lock', target: OWNCHEST });
    ok((W.last('social.housing') || NONE).f.ok === true, '...a lock that adopts an unclaimed room chest: ok true', (W.last('social.housing') || NONE).f);
    hs.recordOf = recordOf0; hs.primaryOf = primaryOf0;
  }
  W.h('packet', 6, { customPacketType: 'adminAction', action: 'kick', target: Cm.toString(16) });
  W.h('audit', 'GM profile 4 (gm) kicked Mike (profile 3)');
  W.h('logout', 5, Cm); W.QU.run();
  ok((W.last('session.logout') || NONE).p === 3 && (W.last('session.logout') || NONE).f.reason === 'kicked', 'C-R7: the F7 panel\'s hex target: the kicked player\'s logout reason is kicked', (W.last('session.logout') || NONE).f);
  W.K.flushTick(true);
  const sk = W.evs('session.kick').find((r) => r.p === 3);
  const sa2 = W.last('staff.action');
  ok(sk && sk.c === '5D8L' && sk.n === 'Mike', 'C-R8: a panel kick line parsed after the target left names the character, not "someone"', sk);
  ok(sa2 && sa2.f.action === 'kick' && sa2.o.some((x) => x.r === 'target' && x.c === '5D8L' && x.a), '...the staff action\'s target is the character the packet named', sa2 && sa2.o);
  // A panel kick the server refused (adminSystem.ts's rank rule, 22 Oct) removed nobody: the leave mark its packet set goes
  W.h('packet', 6, { customPacketType: 'adminAction', action: 'kick', target: B.toString(16) });
  const markSet = !!W.K.S.pendingLeave.get(B);
  W.h('audit', 'GM profile 4 (gm) was refused kick on Selene (profile 2) (staff rank)');
  W.QU.run(); W.K.flushTick(true);
  const sr = W.last('staff.action') || NONE;
  ok(markSet && !W.K.S.pendingLeave.has(B) && sr.f.outcome === 'refused' && sr.o.some((x) => x.r === 'target' && x.c === 'K2QX'), 'a refused panel kick: outcome refused, and its target carries no leave mark (a logout soon after is no kick)', { markSet, mark: W.K.S.pendingLeave.get(B), f: sr.f });
  W.h('packet', 6, { customPacketType: 'adminAction', action: 'tempBan', target: B.toString(16), hours: 2 });
  W.CL.t += 11000; W.tick('playerlogFast');
  ok((W.last('staff.action') || NONE).f.action === 'tempBan' && (W.last('staff.action') || NONE).f.params.hours === 2 && (W.last('staff.action') || NONE).o[0].c === 'K2QX', '...tempBan is named (adminSystem.ts\'s own action names), its target from the hex', W.last('staff.action'));
  W.h('packet', 6, { customPacketType: 'adminAction', action: 'kill', target: B.toString(16) });
  W.M.mp.onDeath(B, 0);
  const pk = W.last('combat.down');
  ok(pk && pk.p === 2 && pk.f.cause === 'staff_kill' && pk.o && pk.o[0].c === 'U6T6', '...a panel kill: the down\'s cause is staff_kill, by the staff member', pk && [pk.f, pk.o]);
  mark(W);

  // recommended fixes: the client's companion orders, a relog that grew in containers only, an NPC staggered, an expired lock,
  // a sprint between two samples
  reset();
  W = world();
  W.QU.run(); await F.settle();
  for (const [u, a] of [[3, A], [4, B]]) W.h('login', u, a);
  W.h('packet', 3, { customPacketType: 'companionCommand', action: 'follow', companionId: LYDIA });
  W.h('packet', 3, { customPacketType: 'companionCommand', action: 'attack', targetId: WOLF });
  W.CL.t += 61000; W.tick('playerlogFast');
  ok(W.last('social.companion') && (W.last('social.companion') || NONE).f.op === 'command' && /follow/.test((W.last('social.companion') || NONE).f.kind), 'the client\'s companion orders ({action}): folded per minute', W.last('social.companion'));
  W.h('relog', A, [{ base: '12eb7', pack: [1, 1], containers: [0, 4] }]);
  ok(W.last('item.relog') && !W.evs('sec.signal').length, 'a relog that grew in containers only: item.relog, no security signal');
  W.h('relog', A, [{ base: '12eb7', pack: [1, 3], containers: [0, 0] }]);
  ok(W.evs('sec.signal').length === 1, '...the pack itself grew: the signal');
  W.h('effect', BANDIT, 'stagger', 0);
  ok(!W.evs('combat.effect').length, 'combat.js staggering an NPC: no line');
  W.h('lock', A, 'expired', 1, 0);
  ok(W.last('social.lock') && (W.last('social.lock') || NONE).f.op === 'cancel' && (W.last('social.lock') || NONE).f.why === 'expired', 'an expired client lock is recorded (lockpick.js busy())', W.last('social.lock'));
  W.tick('playerlogLocation');
  W.CL.t += 5000; W.M.mp.set(A, 'pos', [6000, 0, 0]); W.tick('playerlogLocation');
  ok(!W.evs('move.teleport').length, 'a 6,000 u run in 5 s (under 1,500 u/s): no teleport line');
  W.CL.t += 5000; W.M.mp.set(A, 'pos', [26000, 0, 0]); W.tick('playerlogLocation');
  ok(W.evs('move.teleport').length === 1, '...20,000 u in 5 s: a teleport');
  mark(W);

  // ================================================================================================================ inventory diff
  // off by default; on: a count changed with no item event of the player's is item.unexplained, gold left out
  reset();
  W = world();
  ok(!W.TM.T.has('playerlogInvDiff'), 'the inventory diff is off by default (no timer)');
  reset();
  W = world({ inventoryDiff: true });
  W.QU.run(); await F.settle();
  for (const [u, a] of [[3, A], [4, B], [5, Cm], [6, D]]) W.h('login', u, a);
  for (let i = 0; i < 4; i++) W.tick('playerlogInvDiff');
  addItem(W, A, ARROW, -0); setInv(W, A, inv(W, A).concat([{ baseId: ARROW, count: 12 }]));
  addItem(W, A, 0xf, 500);
  for (let i = 0; i < 4; i++) W.tick('playerlogInvDiff');
  const un = W.evs('item.unexplained');
  ok(un.length === 1 && un[0].f.item.i === 'Iron Arrow' && un[0].f.after === 12 && un[0].q === 'inferred', 'arrows that came from nowhere: item.unexplained (gold left out)', un.map((r) => r.f));
  W.K.emit('item.pickup', A, { item: W.K.itemOf(ARROW, 3) });
  addItem(W, A, ARROW, 3);
  for (let i = 0; i < 4; i++) W.tick('playerlogInvDiff');
  ok(W.evs('item.unexplained').length === 1, '...a change an event explains is not');
  mark(W);

  // ================================================================================================================ refused panel actions
  // The leave mark a refused panel kick or ban clears is the one on the account the server's line names, not the oldest
  // pending packet's: a backend ban's line comes after the POST, so a kick refused meanwhile must not clear the ban's mark
  // (review of 22 Oct, probe-panel-fifo)
  reset();
  W = world();
  for (const [u, a] of [[3, A], [4, B], [5, Cm], [6, D]]) W.h('login', u, a);
  W.h('packet', 6, { customPacketType: 'adminAction', action: 'ban', target: B.toString(16) });
  W.h('packet', 6, { customPacketType: 'adminAction', action: 'kick', target: Cm.toString(16) });
  W.h('audit', 'GM profile 4 (developer) was refused kick on Mike (profile 3) (staff rank)');
  W.QU.run(); W.K.flushTick(true);
  const fr = W.last('staff.action') || NONE;
  ok(!W.K.S.pendingLeave.has(Cm) && (W.K.S.pendingLeave.get(B) || {}).reason === 'panel' && fr.f.outcome === 'refused' && fr.o.some((x) => x.r === 'target' && x.c === '5D8L'),
    'a panel kick refused while a ban is still at the backend: the refused target\'s mark goes, the banned one\'s stays', { B: W.K.S.pendingLeave.get(B), Cm: W.K.S.pendingLeave.get(Cm), f: fr.f });
  W.h('audit', 'GM profile 4 (developer) banned Selene (profile 2)');
  W.QU.run(); W.K.flushTick(true);
  W.h('logout', 4, B); W.h('logout', 5, Cm); W.QU.run();
  const lo = (p) => (W.evs('session.logout').filter((r) => r.p === p).pop() || NONE).f.reason;
  ok(lo(2) === 'kicked' && lo(3) !== 'kicked', '...so the banned player leaves as kicked, the one the server refused to kick does not', { selene: lo(2), mike: lo(3) });
  mark(W);

  // ================================================================================================================ wrapper invariants
  reset();
  W = world();
  const verdicts = [false, undefined, true];
  const results = [];
  for (const v of verdicts) {
    for (const slot of ['onActivate', 'onTakeItem', 'onPutItem', 'onDropItem', 'onEatItem', 'onCraft', 'onUpdateEquipmentAttempt', 'onSpellCast', 'onSpellHit', 'onHitDamageAttempt', 'onHitDamage', 'onDeath', 'onConsoleCommand', 'onRespawn']) W.M.mp[slot] = () => v;
    delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run();
    W.h('login', 3, A);
    for (const slot of ['onActivate', 'onTakeItem', 'onPutItem', 'onDropItem', 'onEatItem', 'onCraft', 'onUpdateEquipmentAttempt', 'onSpellCast', 'onSpellHit', 'onHitDamageAttempt', 'onHitDamage', 'onDeath', 'onConsoleCommand', 'onRespawn']) {
      results.push([slot, v, W.M.mp[slot](A, B, SWORD, 1, {})]);
    }
  }
  ok(results.every(([, v, got]) => got === v), 'every wrapper returns the inner verdict exactly: false, undefined and true', results.filter(([, v, got]) => got !== v));
  // and still when its own code throws
  W.K.S.online = { has: () => { throw new Error('broken'); }, delete() {}, add() {}, [Symbol.iterator]: function* () { /* none */ }, size: 0 };
  const broken = ['onActivate', 'onHitDamageAttempt', 'onDeath', 'onEatItem'].map((s) => { try { return W.M.mp[s](A, B, SWORD, 1, {}); } catch (e) { return 'threw'; } });
  ok(broken.every((x) => x === true), '...and when the player log\'s own code throws', broken);
  // an inner that throws is re-thrown exactly
  const boom = new Error('inner boom');
  W.M.mp.onDeath = () => { throw boom; };
  delete require.cache[MODULE]; require(MODULE)(W.api); W.QU.run();
  let caught = null; try { W.M.mp.onDeath(A, B); } catch (e) { caught = e; }
  ok(caught === boom, 'an inner handler that throws: the same error goes on to the engine');

  // ================================================================================================================ coverage
  const NOT_A = new Set(['item.ammo', 'session.guard', 'combat.hit', 'combat.offline_body', 'session.perm', 'law.execution', 'law.concordat',
    'law.jail', 'social.court', 'social.nobility', 'social.realm', 'social.property', 'social.rest', 'social.commission', 'social.charter', 'item.mail', 'item.courier',
    'item.bank', 'item.buy', 'item.fee', 'item.key', 'item.rack', 'item.sweep', 'combat.finish', 'combat.death_final', 'combat.kill_player', 'combat.wake', 'staff.view',
    'cmd.run', 'cmd.info', 'cmd.console', 'session.ban', 'char.rename', 'char.beast', 'char.supernatural', 'char.knowledge', 'char.deity', 'combat.effect', 'combat.heal',
    'item.extras', 'social.report', 'sys.stop', 'sys.error', 'sys.dropped', 'sys.schema', 'sys.audit_unknown', 'act.*', 'session.client']);
  // the types this harness does not reach are reached by the audit, commands and core harnesses (named above); the rest:
  const missing = Object.keys(R.EVENT_TYPES).filter((t) => !seen.has(t) && !NOT_A.has(t));
  ok(missing.length === 0, 'coverage: every event type with a phase A source is emitted at least once here or in a named harness', missing);
  ok(rejections.length === 0, 'no unhandled rejection', rejections.map((e) => String(e)));
  reset();
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL harness error', e && e.stack); process.exit(1); });
