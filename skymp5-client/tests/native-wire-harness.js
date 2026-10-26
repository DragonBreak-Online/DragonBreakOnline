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

const server = SERVER ? ['decor.js', 'prayer.js', 'gamemode.js', 'citizenship.js', 'keyring.js', 'tenancy.js', 'labour.js', 'struggle.js'].map((f) => fs.readFileSync(path.join(SERVER, f), 'utf8')).join('\n') : '';
const handled = (ev) => new RegExp(`(onUi|panelAct)\\('${ev}'`).test(server);

const fixtures = {
  dbo_prayer: { type: 'prayer', id: 35, nonce: 'n1', mode: 'pick', deity: 'Mara', kind: 'divine', shrine: 'Shrine of Mara', sphere: '', verses: [{ lines: ['a', 'b'] }, { lines: ['c', 'd'] }, { lines: ['e', 'f'] }], right: [0, 0, 0], slips: 2, totalMs: 120000, minPickMs: 300, judge: 'client' },
  dbo_board: { boardName: 'Bruma', costGold: 30, gold: 100, maxTextLen: 600, maxNotes: 40, expiryDays: 7, events: { post: 'bountyBoard:post', remove: 'bountyBoard:remove', close: 'bountyBoard:close' },
    tabs: [{ id: 'hold', label: 'Hold', cost: 0, canPost: false }, { id: 'shop', label: 'Shop', cost: 30, canPost: true }], notes: [{ id: 2, tab: 'hold', author: 'A', text: 't', ageHours: 1, canRemove: true }] },
  dbo_housing: { type: 'housing', id: 70, targetLabel: 'Door', view: 'owner', owned: true, name: 'H', locked: false, hasKeys: true, canGrantContainers: false, ownerName: 'A', keyRing: true,
    place: { root: 1, name: 'H', here: 0, more: 0, rooms: [{ ref: 11, label: 'Chest', kind: 'chest', assigned: null, shared: false, other: null }, { ref: 12, label: 'Box', kind: 'chest', assigned: 'B', shared: true, other: null }] },
    events: { claim: 'housing:claim', abandon: 'housing:abandon', revoke: 'housing:revoke', lock: 'housing:lock', unlock: 'housing:unlock', transfer: 'housing:transfer', rename: 'housing:rename', createKey: 'housing:createkey', revokeKeys: 'housing:revokekeys', grantContainer: 'housing:grantcontainer', assign: 'housing:assign', unassign: 'housing:unassign', share: 'housing:share', unshare: 'housing:unshare', cancel: 'housing:cancel' } },
  dbo_labour: { type: 'labour', id: 55, nonce: 'n1', kind: 'mining', title: 'Iron Seam', strikes: 1, band: 8, bands: [50], sweepMs: 1400, totalMs: 30000, hitMs: 250, missMs: 600, judge: 'client' },
  'dbo_labour#struggle': { type: 'labour', id: 55, nonce: 'n2', kind: 'struggle', event: 'struggle', strikes: 1, band: 8, bands: [50], sweepMs: 1400, sweeps: [1400], failOnMiss: true, totalMs: 30000, hitMs: 0, missMs: 0, judge: 'client' },
  dbo_emotes: { type: 'emoteWheel', id: 24, events: { play: 'emote:play', close: 'emote:close', stop: 'emote:stop' }, groups: [{ id: 'a', label: 'A', emotes: [{ anim: 'IdleWave', label: 'Wave' }, { anim: 'IdleSalute', label: 'Salute' }] }, { id: 'b', label: 'B', emotes: [{ anim: 'IdleLaugh', label: 'Laugh' }] }] },
  'dbo_emotes#stop': null,
  'dbo_emotes#close': null,
  dbo_decor: { type: 'decor', id: 171, nonce: 'p1', view: 'catalog', home: 'h', owner: true, undo: 5, budget: [{ label: 'Pieces', used: 0, of: 3 }], groups: [{ id: 'beds', label: 'Beds' }], group: 'beds', page: 0, pages: 2, rows: [{ key: '9001:Skyrim.esm', name: 'Bed', cost: [], why: '' }], nearby: [] },
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
  dbo_emotes: (t) => { const p = t.root.dboPanel; p.groups.g1.onRelease(); p.rows.e0.onRelease(); },
  'dbo_emotes#stop': (t) => { t.root.dboPanel.foot.stop.onRelease(); },
  'dbo_emotes#close': (t) => { t.press(27); },
  dbo_decor: (t) => {
    const l = t.root.dboPanel.list;
    l.r0.onRelease(); l.g0.onRelease(); t.press(39); t.press(82); t.root.dboPanel.head.undo.onRelease();
    t.push(Object.assign({}, fixtures.dbo_decor, { view: 'placed', rows: [{ key: 'ff01', name: 'Bed', group: 'beds', state: '', refund: '' }] }));
    t.root.dboPanel.list.r0.mv.onRelease(); t.root.dboPanel.list.r0.rm.onRelease();
    t.push(Object.assign({}, fixtures.dbo_decor, { view: 'people', rows: [{ key: '9', name: 'A' }], nearby: [{ key: '10', name: 'B' }] }));
    t.root.dboPanel.list.r0.rv.onRelease(); t.root.dboPanel.list.r1.gr.onRelease();
    t.press(27);
  },
};

// '<swf>#<what>' is another session of <swf>; a null fixture reuses the panel's own
const swfOf = (menu) => menu.split('#')[0];
const fixtureOf = (menu) => fixtures[menu] || fixtures[swfOf(menu)];
// a session that ends in a closing key carries fewer events than a whole drive
const MIN_EVENTS = { dbo_labour: 3, 'dbo_labour#struggle': 3, dbo_emotes: 2, 'dbo_emotes#stop': 2, 'dbo_emotes#close': 2 };
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
check('dbo_emotes: its sessions send all three emote keys', ['emote:play', 'emote:stop', 'emote:close'].every((k) => (seen.dbo_emotes || []).includes(k)), seen.dbo_emotes);

if (SERVER) {
  const src = fs.readdirSync(path.resolve(__dirname, '..', 'swf/dbo_journal/tabs')).map((f) => read(`swf/dbo_journal/tabs/${f}`)).concat(read('swf/dbo_journal/scripts/frame_1/DoAction.as')).join('\n');
  const keys = [...new Set([...src.matchAll(/"dbo:([A-Za-z]+)"|act\("([A-Za-z]+)"/g)].map((m) => m[1] || m[2]))];
  const all = fs.readdirSync(SERVER).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(SERVER, f), 'utf8')).join('\n');
  const missing = keys.filter((k) => !new RegExp(`onUi\\('${k}'`).test(all));
  check(`dbo_journal: the server handles every event its ${keys.length} keys name`, keys.length > 20 && !missing.length, missing);
}

T.done();
