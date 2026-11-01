// The wire between the native panels and the client service, tested from both sides at once: every mod event the SWFs
// send is parsed by the service's own parseUiEvent, and every dbo: key must have a handler in the server's source.
//   ./node_modules/typescript/bin/tsc src/services/services/scaleformMenu.ts --outDir <tmp> --module commonjs --target es2019
//   node tests/native-wire-harness.js <tmp>/scaleformMenu.js [server dir]
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./native-swf-stub');
const M = require(path.resolve(process.argv[2]));
const SERVER = process.argv[3] ? path.resolve(process.argv[3]) : null;
const T = S.checker();
const check = T.check;
const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const LIB = read('swf/lib/dbo.as');
const SVC = read('src/services/services/scaleformMenuService.ts');

check('the event name is the same on both sides', LIB.includes(`var DBO_UI_EVENT = "${M.DBO_UI_EVENT}";`), M.DBO_UI_EVENT);
check('the separator is the same on both sides', M.UI_SEP === String.fromCharCode(1) && LIB.includes('var DBO_SEP = String.fromCharCode(1);'));
check('the menu name is the same on both sides', LIB.includes(`var DBO_MENU = "${M.MENU_NAME}";`));
check('the service pushes to the function the panels define', SVC.includes('"_root.dboData"'));

// Every module that handles a panel's keys: Worker 2's (dungeons, supernatural) and Worker 6's (labour,
// struggle, post, couriers) together. Dropping either half stops checking that those panels' keys have a
// handler at all, which is the one thing this file is for.
const server = SERVER ? ['decor.js', 'prayer.js', 'gamemode.js', 'citizenship.js', 'keyring.js', 'tenancy.js',
  'dungeons.js', 'supernatural.js', 'labour.js', 'struggle.js', 'post.js', 'couriers.js', 'lockpick.js', 'contracts.js'].map((f) => fs.readFileSync(path.join(SERVER, f), 'utf8')).join('\n') : '';
// post.js and couriers.js register through their own act() wrappers around onUi
const handled = (ev) => new RegExp(`(onUi|panelAct|act)\\('${ev}'`).test(server);

const fixtures = {
  dbo_prayer: { type: 'prayer', id: 35, nonce: 'n1', mode: 'pick', deity: 'Mara', kind: 'divine', shrine: 'Shrine of Mara', sphere: '', verses: [{ lines: ['a', 'b'] }, { lines: ['c', 'd'] }, { lines: ['e', 'f'] }], right: [0, 0, 0], slips: 2, totalMs: 120000, minPickMs: 300, judge: 'client' },
  dbo_board: { boardName: 'Bruma', costGold: 30, gold: 100, maxTextLen: 600, maxNotes: 40, expiryDays: 7, events: { post: 'bountyBoard:post', remove: 'bountyBoard:remove', close: 'bountyBoard:close' },
    tabs: [{ id: 'hold', label: 'Hold', cost: 0, canPost: false }, { id: 'shop', label: 'Shop', cost: 30, canPost: true }], notes: [{ id: 2, tab: 'hold', author: 'A', text: 't', ageHours: 1, canRemove: true }] },
  dbo_housing: { type: 'housing', id: 70, targetLabel: 'Door', view: 'owner', owned: true, name: 'H', locked: false, hasKeys: true, canGrantContainers: false, ownerName: 'A', keyRing: true,
    place: { root: 1, name: 'H', here: 0, more: 0, rooms: [{ ref: 11, label: 'Chest', kind: 'chest', assigned: null, shared: false, other: null }, { ref: 12, label: 'Box', kind: 'chest', assigned: 'B', shared: true, other: null }] },
    events: { claim: 'housing:claim', abandon: 'housing:abandon', revoke: 'housing:revoke', lock: 'housing:lock', unlock: 'housing:unlock', transfer: 'housing:transfer', rename: 'housing:rename', createKey: 'housing:createkey', revokeKeys: 'housing:revokekeys', grantContainer: 'housing:grantcontainer', assign: 'housing:assign', unassign: 'housing:unassign', share: 'housing:share', unshare: 'housing:unshare', cancel: 'housing:cancel' } },
  dbo_labour: { type: 'labour', id: 55, nonce: 'n1', kind: 'mining', title: 'Iron Seam', strikes: 1, band: 8, bands: [50], sweepMs: 1400, totalMs: 30000, hitMs: 250, missMs: 600, judge: 'client' },
  dbo_reading: { type: 'reading', id: 30, nonce: 'r1', title: 'The Lusty Argonian Maid', words: ['run', 'the', 'has', 'ink'], seconds: 30, endsInMs: 30000, locked: [], attempt: 0, judge: 'client', candleMs: 30000, penaltyMs: 8000 },
  dbo_skinning: { type: 'skinning', id: 33, nonce: 's1', name: 'Wolf', cuts: 2, misses: 1, seam: 0.2, seams: [0.5, 0.25], sweepMs: 1000, reachMs: 0, totalMs: 15000, judge: 'client' },
  'dbo_skinning#pick': { type: 'skinning', id: 33, nonce: 'p1', name: 'Fox', mode: 'pick', cuts: 2, misses: 1, totalMs: 60000, minPickMs: 150, judge: 'client', steps: [[[20, 50, 0.3], [60, 50, 0.9], [80, 50, 0.4]], [[30, 50, 0.95], [50, 50, 0.2]]] },
  dbo_lockpick: { type: 'lockpick', id: 46, nonce: 'k1', title: 'Chest (Adept lock)', level: 'Adept', fallMs: 650, holds: [380, 380], set: [false, false], picks: 2, notice: '', noticeKind: '', done: false, judge: 'client', graceMs: 70, maxTries: 200, mode: 'tumbler', rises: [440, 460], softMs: 80, auto: 0.08 },
  'dbo_lockpick#auto': null,
  'dbo_labour#struggle': { type: 'labour', id: 55, nonce: 'n2', kind: 'struggle', event: 'struggle', strikes: 1, band: 8, bands: [50], sweepMs: 1400, sweeps: [1400], failOnMiss: true, totalMs: 30000, hitMs: 0, missMs: 0, judge: 'client' },
  dbo_pigeon: { type: 'pigeon', id: 34, nonce: 'p1', boardName: 'Bruma', gold: 100, cooldownMinutes: 0, maxText: 240, view: 'letters',
    contacts: [{ id: 11, name: 'Bob', tag: 'BOBB', online: true, price: 5 }],
    letters: [{ id: 'l1', from: 'Ann', text: 't', at: 0, read: false }, { id: 'l2', from: 'Bob', text: 't', at: 0, read: true, parcel: { gold: 5, items: [] } }],
    supply: { enabled: true, zone: 'Bruma', feeShare: 0.1, minFee: 5, maxCount: 50, maxOpen: 3, openDays: 3, search: '', results: [],
      orders: [{ id: 7, name: 'Ore', count: 5, filled: 0, reward: 50, perUnit: 10, held: 50, poster: 'Ann', hoursLeft: 10, zone: 'Bruma', state: 'open', mine: false, have: 2 }],
      mine: [{ id: 9, name: 'Wheat', count: 5, filled: 0, reward: 10, perUnit: 2, held: 10, poster: 'You', hoursLeft: 10, zone: 'Bruma', state: 'open', mine: true, have: 0 }] },
    courier: { enabled: true, place: 'Bruma', placeId: 'bruma', destinations: [], goods: [], rules: { feeShare: 0.1, minFee: 5, premiumRate: 0.05, maxStacks: 3, minPay: 10, maxPay: 1000, limitGameDays: 3, openDays: 3, maxCarried: 2, maxOpen: 3, maxPayoutsPerWeek: 5 },
      open: [{ id: 3, goods: 'g', kinds: 1, pay: 40, dest: 'W', kind: 'board', origin: 'B', sender: 'A', recipient: 'A', insured: 0, state: 'open', hoursLeft: 2, gameHoursLeft: 0, mine: false }],
      carrying: [{ id: 4, goods: 'g', kinds: 1, pay: 40, dest: 'B', kind: 'board', origin: 'C', sender: 'D', recipient: 'D', insured: 0, state: 'carried', hoursLeft: 2, gameHoursLeft: 2, mine: false, here: true }],
      broken: [{ id: 5, goods: 'g', kinds: 1, pay: 10, dest: 'S', kind: 'board', origin: 'B', sender: 'E', recipient: 'E', insured: 0, state: 'robbed', hoursLeft: 0, gameHoursLeft: 0, mine: false }],
      mine: [{ id: 6, goods: 'g', kinds: 1, pay: 25, dest: 'X', kind: 'board', origin: 'B', sender: 'Y', recipient: 'Y', insured: 0, state: 'open', hoursLeft: 4, gameHoursLeft: 0, mine: true }] } },
  dbo_decor: { type: 'decor', id: 171, nonce: 'p1', view: 'catalog', home: 'h', owner: true, undo: 5, budget: [{ label: 'Pieces', used: 0, of: 3 }], groups: [{ id: 'beds', label: 'Beds' }], group: 'beds', page: 0, pages: 2, rows: [{ key: '9001:Skyrim.esm', name: 'Bed', cost: [], why: '' }], nearby: [] },
  dbo_deity: { type: 'deityPicker', id: 36, nonce: 'd1', current: 'mara', first: false, daysLeft: 0, cooldownDays: 7, canChoose: true, notice: '', noticeKind: '',
    choices: [{ id: 'mara', name: 'Mara', kind: 'divine', sphere: '', boon: '', reachable: true, lawful: true, aspectOf: '' }, { id: 'boethiah', name: 'Boethiah', kind: 'daedra', sphere: '', boon: '', reachable: true, lawful: false, aspectOf: '' }] },
  dbo_dungeon: { type: 'dungeonGate', id: 60, nonce: 'g1', name: 'Bleak Falls Barrow', kind: 'Nordic ruin', party: [], difficulties: [{ id: 'story', label: 'Novice', blurb: '' }, { id: 'normal', label: 'Adept', blurb: '' }], minutes: 60, cooldownMinutes: 120, canClaim: true },
  dbo_rite: { type: 'rite', id: 39, nonce: 'r1', title: 'Rite', flavor: '', deadly: true, round: 1, rounds: 3, need: 2, hits: 0, misses: 0, period: 1600, zone: [0.5, 0.2], startsIn: 0, result: '', judge: 'client', rnonce: 'a1', graceMs: 100, limitMs: 7000 },
  dbo_context: { type: 'contextMenu', id: 10, targetName: 'Lydia', mode: 'menu', lines: [], events: { action: 'pa:action', close: 'pa:close', trade: 'pa:trade' },
    actions: [{ id: 'trade', label: 'Trade' }, { id: 'party', label: 'Invite to party' }, { id: 'search', label: 'Search' }] },
};
// Drives every control the panel has, so every key it can send is on the wire
const drive = {
  dbo_prayer: (t) => { for (let k = 0; k < 3; k++) { t.st.time += 400; t.press(49); } t.press(27); },
  dbo_board: (t) => {
    const p = t.root.dboPanel;
    t.press(49); p.list.remove.onRelease(); p.head.tab1.onRelease(); p.foot.write.onRelease();
    p.head.ho0.onRelease(); p.head.ho1.onRelease(); p.foot.f0.onRelease(); t.press(27);
  },
  dbo_housing: (t) => {
    const a = t.root.dboPanel.acts, r = t.root.dboPanel.right;
    for (const n of Object.keys(a.kids)) if (!/Transfer|Key Ring|Rent/.test(a[n].label.text)) a[n].onRelease();
    r.r0.sh.onRelease(); r.r1.tb.onRelease(); r.r1.us.onRelease(); r.r0.as.onRelease();
    for (const n of Object.keys(a.kids)) if (/Transfer|Key Ring|Rent/.test(a[n].label.text)) a[n].onRelease();
    t.press(27);
  },
  // A panel that closes after a key is driven once per key: nothing is sent after dboClose (lib 0947624d)
  dbo_labour: (t) => {
    t.st.time += 2100; t.tick(); t.press(32); t.root.dboPanel.acts.stand.onRelease();
  },
  // a pull outside the band ends the struggle (failOnMiss), then Escape walks away
  'dbo_labour#struggle': (t) => { t.tick(); t.press(32); t.press(27); },
  // a pin set in its hang, then Escape reports the lock as a cancel; a second session asks for an auto attempt and leaves
  dbo_lockpick: (t) => { t.press(87); t.st.time += 630; t.press(32); t.press(27); },
  // a clean cut on the seam, then Escape stops; a pick round picks the clear point and leaves
  // the four words in order and read out, then Escape gives up
  dbo_reading: (t) => { for (const i of [1, 3, 2, 0]) t.root.dboPanel.pool['w' + i].onRelease(); t.press(13); t.press(27); },
  dbo_skinning: (t) => { t.st.time += 500; t.tick(); t.press(32); t.press(27); },
  'dbo_skinning#pick': (t) => { t.st.time += 400; t.tick(); t.press(50); t.press(27); },
  'dbo_lockpick#auto': (t) => { t.press(65); t.press(27); },
  // The coop waits for the server's answer (a new nonce) after each action, so the drive answers between them
  dbo_pigeon: (t) => {
    let n = 1;
    const again = (view) => t.push(Object.assign({}, fixtures.dbo_pigeon, { nonce: 'p' + (++n), view }));
    const P = () => t.root.dboPanel;
    const row = (label) => Object.keys(P().list.kids).map((k) => P().list[k]).find((r) => r.label && r.label.text.indexOf(label) >= 0);
    row('Ann').onRelease(); P().right.burn.onRelease(); P().right.burn.onRelease(); again('letters');
    row('Bob').onRelease(); P().right.collect.onRelease(); again('letters');
    row('Bob').onRelease(); P().right.ignore.onRelease(); again('send');
    // the letter is a form in the coop now (lib/dbo-form.as): typed, then sent
    const inForm = (label) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.label && k.onRelease && k.label.text === label) out.push(k); if (k.kids) walk(k); } }; walk(P().right); return out[0]; };
    P().right.write.onRelease(); inForm('Type...').onRelease();
    (() => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.type === 'input') f = k; if (k.kids) walk(k); } }; walk(P().right); f.text = 'Hello'; })();
    inForm('Done').onRelease(); inForm('Send the pigeon').onRelease(); again('send');
    P().right.signNone.onRelease(); again('supply');
    row('Ore').onRelease(); P().right.deliver.onRelease(); again('supply');
    row('Wheat').onRelease(); P().right.cancel.onRelease(); P().right.cancel.onRelease(); again('courier');
    row('40 gold \u00b7 W').onRelease(); P().right.take.onRelease(); again('courier');
    row('40 gold \u00b7 B').onRelease(); P().right.deliver.onRelease(); again('courier');
    row('10 gold').onRelease(); P().right.open.onRelease(); again('courier');
    t.press(34); row('25 gold').onRelease(); P().right.cancel.onRelease(); P().right.cancel.onRelease(); again('courier');
    P().foot.close.onRelease();
  },
  dbo_decor: (t) => {
    const l = t.root.dboPanel.list;
    l.r0.onRelease(); l.g0.onRelease(); t.press(39); t.press(82); t.root.dboPanel.head.undo.onRelease();
    t.push(Object.assign({}, fixtures.dbo_decor, { view: 'placed', rows: [{ key: 'ff01', name: 'Bed', group: 'beds', state: '', refund: '' }] }));
    t.root.dboPanel.list.r0.mv.onRelease(); t.root.dboPanel.list.r0.rm.onRelease();
    t.push(Object.assign({}, fixtures.dbo_decor, { view: 'people', rows: [{ key: '9', name: 'A' }], nearby: [{ key: '10', name: 'B' }] }));
    t.root.dboPanel.list.r0.rv.onRelease(); t.root.dboPanel.list.r1.gr.onRelease();
    t.press(27);
  },
  dbo_deity: (t) => {
    t.press(39); t.press(49); t.root.dboPanel.foot.take.onRelease(); t.root.dboPanel.foot.go.onRelease();
    t.push(Object.assign({}, fixtures.dbo_deity, { nonce: 'd2', current: '', first: true })); t.press(49); t.root.dboPanel.foot.take.onRelease(); t.press(27);
  },
  dbo_dungeon: (t) => {
    t.press(50);
  },
  // the gate closes on its first choice and sends nothing after, so its other key gets a run of its own
  'dbo_dungeon#back': (t) => {
    t.root.dboPanel.body.back.onRelease();
  },
  dbo_rite: (t) => {
    t.st.time += 400; t.tick(); t.press(32);
    t.push(Object.assign({}, fixtures.dbo_rite, { round: 2, rnonce: 'a2' })); t.st.time += 7100; t.tick();
    t.push(Object.assign({}, fixtures.dbo_rite, { round: 3, rnonce: 'a3', mode: 'pick', spots: [[20, 50, 0.2], [70, 50, 0.9]], minPickMs: 300 })); t.st.time += 400; t.press(50);
    t.press(27); t.root.dboPanel.body.yield.onRelease();
  },
  dbo_context: (t) => {
    t.press(49); t.push(fixtures.dbo_context); t.root.dboPanel.body.r2.onRelease(); t.push(fixtures.dbo_context); t.press(27);
  },
  // Worker 6's notice-board Citizenship and Voting: join, the Voting tab, then back to the board; a second session closes
  dbo_citizen: (t) => {
    const find = (label) => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.label && k.onRelease && k.label.text === label) f = f || k; if (k.kids) walk(k); } }; walk(t.root.dboPanel); return f; };
    find('Become a citizen').onRelease(); t.push(fixtures.dbo_citizen);
    t.root.dboPanel.head.t1.onRelease(); t.push(fixtures.dbo_citizen);
    t.root.dboPanel.foot.back.onRelease();
  },
  'dbo_citizen#close': (t) => { t.root.dboPanel.foot.close.onRelease(); },
  // Worker 6's Expeditions and Hunting Contracts: give up the held contract, take one, hand in a commission, gather a party,
  // then close; every key is the fixture's events.* value
  dbo_expedition: (t) => {
    const find = (label, row) => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.label && k.onRelease && k.label.text === label && (!row || (k._parent.label && k._parent.label.text.indexOf(row) === 0))) f = f || k; if (k.kids) walk(k); } }; walk(t.root.dboPanel); return f; };
    t.root.dboPanel.head.t1.onRelease();
    find('Give up').onRelease();
    find('Read', '3 wolves').onRelease(); find('Take the contract').onRelease();
    find('Read', 'Iron ore').onRelease(); find('Hand in 2 for 40 gold').onRelease();
    t.root.dboPanel.head.t0.onRelease();
    find('Read', 'Varsa').onRelease(); find('Gather your party').onRelease();
    t.root.dboPanel.foot.close.onRelease();
  },
};
fixtures.dbo_expedition = { type: 'expeditionBoard', id: 63, hall: 'the Synod Conclave', bossReturnMinutes: 10, leaseMinutes: 60, tab: 'expeditions',
  expeditions: [{ id: 'varsa', name: 'Varsa Ruins', county: '', kind: 'Ayleid ruin', status: 'open', state: 'open', masters: [] }],
  contracts: { enabled: true, zone: 'Bruma', treasury: 100, note: '', held: { id: 'w2', what: 'a troll', zone: 'Bruma', progress: 0, count: 1, reward: 300, hoursLeft: 2 }, maxActive: 3, canPost: false,
    list: [{ id: 'w1', what: '3 wolves', count: 3, reward: 90, danger: 1, hoursLeft: 5, state: 'open' }, { id: 'c1', what: 'Iron ore', count: 5, reward: 100, danger: 0, hoursLeft: 9, state: 'open', type: 'commission', item: 'iron ore', price: 20, have: 2 }] },
  events: { pick: 'dbo:expeditionPick', close: 'dbo:expeditionClose', contractTake: 'dbo:contractTake', contractAbandon: 'dbo:contractAbandon', contractDeliver: 'dbo:contractDeliver' } };
fixtures.dbo_citizen = { type: 'citizenBoard', id: 84, nonce: 'c1', tab: 'citizenship', result: '', resultKind: '', hold: 'solitude', name: 'Haafingar', grants: true,
  citizenship: { hold: 'solitude', name: 'Haafingar', ruler: 'Jarl', hasRuler: true, policy: 'free', fee: 0, citizen: false, primary: false, auto: false, holds: [], maxHolds: 2, cooldownUntil: 0, requested: false, can: 'free', why: '' },
  voting: { hold: 'solitude', name: 'Haafingar', electing: true, threshold: 6, registrationHours: 48, votingHours: 24, seats: [{ id: 'jarl', label: 'Jarl' }], citizens: 1, phase: 'none' } };
fixtures['dbo_citizen#close'] = null;

fixtures['dbo_dungeon#back'] = fixtures.dbo_dungeon;

// '<swf>#<what>' is another session of <swf>; a null fixture reuses the panel's own
const swfOf = (menu) => menu.split('#')[0];
const fixtureOf = (menu) => fixtures[menu] || fixtures[swfOf(menu)];
// A session that ends in a closing key carries fewer events than a whole drive. dbo_dungeon's two come from
// Worker 2's side of this merge, which allowed it "> 1"; without them the union below would demand four of a
// panel that only ever sends two, and the check would fail for a panel that is working.
const MIN_EVENTS = {
  dbo_labour: 3, 'dbo_labour#struggle': 3,
  dbo_lockpick: 2, 'dbo_lockpick#auto': 3,
  dbo_skinning: 2, 'dbo_skinning#pick': 2,
  dbo_reading: 2,
  dbo_dungeon: 2, 'dbo_dungeon#back': 2,
  'dbo_citizen#close': 2,
};
const seen = {};
for (const menu of Object.keys(fixtures)) {
  for (const late of [false, true]) {
    const t = S.boot(swfOf(menu), late);
    if (late) { t.tick(); t.arrive(); t.tick(); }
    t.push(fixtureOf(menu));
    drive[menu](t);
    const events = t.sent.filter((m) => m.e === 'dboUi');
    const parsed = events.map((m) => M.parseUiEvent(m.e, m.s, m.n));
    check(`${menu}${late ? ' (skse late)' : ''}: the service parses every event the panel sends`, parsed.length >= (MIN_EVENTS[menu] || 4) && parsed.every(Boolean), events.filter((m, i) => !parsed[i]));
    check(`${menu}${late ? ' (skse late)' : ''}: ready leads and carries its frame where the service reads it`, parsed[0].key === 'ready' && parsed[0].frame === (late ? 2 : 1), parsed[0]);
    const box = M.parseOutbox(t.root.dboOut, 0);
    check(`${menu}${late ? ' (skse late)' : ''}: the outbox carries the same messages, in order, through parseOutbox`,
      box.messages.length === parsed.length && box.messages.every((m, i) => m.key === parsed[i].key && JSON.stringify(m.args) === JSON.stringify(parsed[i].args)), { box: box.messages.map((m) => m.key), ev: parsed.map((p) => p.key) });
    check(`${menu}${late ? ' (skse late)' : ''}: outbox sequences run 1, 2, 3... and the cursor reaches the end`,
      box.messages.every((m, i) => m.seq === i + 1) && box.consumed === String(t.root.dboOut).length, box.messages.map((m) => m.seq));
    const keys = [...new Set(parsed.map((p) => p.key))];
    if (!late) seen[swfOf(menu)] = (seen[swfOf(menu)] || []).concat(keys);
    // a client-service widget's own event keys go back through the router as browser messages, as does the composer hand-off
    const local = ['ready', 'close', 'native:handoff'].concat(Object.values(fixtureOf(menu).events || {}));
    const unknown = keys.filter((k) => !local.includes(k) && !M.serverEventName(k));
    check(`${menu}${late ? ' (skse late)' : ''}: every other key is a dbo: key the service forwards`, !unknown.length, unknown);
    if (SERVER && !late) {
      const missing = keys.filter((k) => M.serverEventName(k)).map((k) => M.serverEventName(k)).filter((ev) => !handled(ev));
      check(`${menu}: the server handles every event the panel sends`, !missing.length, missing);
    }
  }
}

// The journal's tabs send many module events (dbo:court*, journalMagic...): each key in its source has a handler in some server module
check('dbo_labour: its sessions send all four labour keys', ['dbo:labour', 'dbo:labourCancel', 'dbo:struggle', 'dbo:struggleCancel'].every((k) => (seen.dbo_labour || []).includes(k)), seen.dbo_labour);
check('dbo_pigeon: the drive sends every key the coop has', ['dbo:pigeonRead', 'dbo:pigeonDelete', 'dbo:pigeonCollect', 'dbo:pigeonBlockLetter', 'dbo:pigeonSend', 'dbo:pigeonSign', 'dbo:supplyDeliver', 'dbo:supplyCancel', 'dbo:courierTake', 'dbo:courierDeliver', 'dbo:courierOpen', 'dbo:courierCancel', 'dbo:pigeonClose'].every((k) => (seen.dbo_pigeon || []).includes(k)), [...new Set(seen.dbo_pigeon || [])]);

if (SERVER) {
  const src = fs.readdirSync(path.resolve(__dirname, '..', 'swf/dbo_journal/tabs')).map((f) => read(`swf/dbo_journal/tabs/${f}`)).concat(read('swf/dbo_journal/scripts/frame_1/DoAction.as')).join('\n');
  const keys = [...new Set([...src.matchAll(/"dbo:([A-Za-z]+)"|act\("([A-Za-z]+)"/g)].map((m) => m[1] || m[2]))];
  const all = fs.readdirSync(SERVER).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(SERVER, f), 'utf8')).join('\n');
  // playerguilds.js and rebellion.js (the Faction tab's Guild and Rebellion views) register through their own tab() around onUi
  const missing = keys.filter((k) => !new RegExp(`(onUi|tab)\\('${k}'`).test(all));
  check(`dbo_journal: the server handles every event its ${keys.length} keys name`, keys.length > 20 && !missing.length, missing);
}

T.done();
