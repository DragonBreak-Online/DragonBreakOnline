// Runs the native property menu (swf/dbo_housing) on the stub stage with the widget housingService publishes.
//   node tests/native-housing-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const events = {
  claim: 'housing:claim', abandon: 'housing:abandon', revoke: 'housing:revoke', lock: 'housing:lock', unlock: 'housing:unlock',
  transfer: 'housing:transfer', rename: 'housing:rename', createKey: 'housing:createkey', revokeKeys: 'housing:revokekeys',
  grantContainer: 'housing:grantcontainer', assign: 'housing:assign', unassign: 'housing:unassign', share: 'housing:share',
  unshare: 'housing:unshare', cancel: 'housing:cancel',
};
const base = { type: 'housing', id: 70, targetLabel: 'Door', view: 'owner', owned: true, name: 'Rose Hall', locked: false, hasKeys: true,
  canGrantContainers: false, ownerName: 'Olaf', place: null, placeName: null, assignedToYou: false, keyRing: true, events };
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const P = (t) => t.root.dboPanel;
const labels = (t) => Object.keys(P(t).acts.kids).map((n) => P(t).acts[n].label.text);
const btn = (t, label) => Object.keys(P(t).acts.kids).map((n) => P(t).acts[n]).find((b) => b.label.text === label);
const closed = (t) => t.sent.some((m) => m.e === 'closeMenu');
const rooms = (t) => Object.keys(P(t).right.kids).filter((n) => /^r\d$/.test(n)).map((n) => P(t).right[n]);

{
  const t = S.boot('dbo_housing');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(base);
  check('the title is the name, the status says yours and unlocked', P(t).head.title.text === 'Rose Hall' && P(t).head.status.text === 'Yours - unlocked', P(t).head.status.text);
  check('an owner gets the browser menu\'s actions in its order', labels(t).join('|') === 'Lock|Cut a key|Void all keys|Transfer|Rename...|Give up|Key Ring|Rent and sale', labels(t).join('|'));
  check('Give up is red', btn(t, 'Give up').label.textColor === 0xB23A3A);
  btn(t, 'Lock').onRelease();
  check('Lock sends the lock event and keeps the menu open', msgs(t, 'housing:lock').length === 1 && !closed(t));
  btn(t, 'Rename...').onRelease();
  const h = msgs(t, 'native:handoff');
  check('Rename hands the name box to the browser', h.length === 1 && h[0].args.join('|') === 'housing|rename' && !closed(t), h);
  check('the hint is the Key Ring one', /Key Ring, where you can give it/.test(P(t).right.hint.text));
  t.push(Object.assign({}, base, { locked: true }));
  check('a re-publish redraws: Unlock, locked in red', labels(t)[0] === 'Unlock' && P(t).head.status.textColor === 0xB23A3A && P(t).head.status.text === 'Yours - locked');
  t.press(40); t.press(13);
  check('Down and Enter pick the first action', msgs(t, 'housing:unlock').length === 1);
  btn(t, 'Transfer').onRelease();
  check('Transfer sends its event and closes: the service waits for the recipient', msgs(t, 'housing:transfer').length === 1 && closed(t) && msgs(t, 'housing:cancel').length === 0);
}

{
  const t = S.boot('dbo_housing');
  t.push(Object.assign({}, base, { keyRing: true }));
  btn(t, 'Key Ring').onRelease();
  check('Key Ring opens the ring, cancels this menu, closes', msgs(t, 'dbo:keyRingOpen').length === 1 && msgs(t, 'housing:cancel').length === 1 && msgs(t, 'close').length === 1 && closed(t));
  const u = S.boot('dbo_housing');
  u.push(Object.assign({}, base, { view: 'manager', ownerName: 'Olaf', hasKeys: false, canGrantContainers: true, keyRing: false }));
  check('a manager: lock, transfer as grant, rename, revoke, grant container; no market at a container', labels(u).join('|') === 'Lock|Grant ownership|Rename...|Revoke ownership|Grant this container', labels(u).join('|'));
  check('and sees the owner', P(u).head.owner.text === 'Owner: Olaf');
  const k = S.boot('dbo_housing');
  k.push(Object.assign({}, base, { view: 'keyholder', keyRing: false }));
  check('a key holder only locks, and the market says buy or rent', labels(k).join('|') === 'Lock|Buy or rent' && P(k).head.status.text === 'Key holder - unlocked', labels(k).join('|'));
  btn(k, 'Buy or rent').onRelease();
  check('the market hand-over sends propertyMarket then the cancel', msgs(k, 'dbo:propertyMarket').length === 1 && msgs(k, 'housing:cancel').length === 1 && closed(k));
  const c = S.boot('dbo_housing');
  c.push(Object.assign({}, base, { view: 'claimable', owned: false, ownerName: null, keyRing: false }));
  check('claimable: Claim and the market, and says nobody has it', labels(c).join('|') === 'Claim|Buy or rent' && P(c).right.hint.text === 'Nobody has claimed this yet.' && P(c).head.status.text === 'Unclaimed', labels(c).join('|'));
  const d = S.boot('dbo_housing');
  d.push(Object.assign({}, base, { view: 'denied', ownerName: 'Olaf', assignedToYou: true, placeName: 'Rose Hall', keyRing: false }));
  check('denied but assigned: says so beside the owner', /Owner: Olaf {4}Assigned to you in Rose Hall\./.test(P(d).head.owner.text), P(d).head.owner.text);
}

{
  const place = { root: 1, name: 'Rose Hall', here: 12, more: 3, rooms: [
    { ref: 11, label: 'Bedroom', kind: 'door', assigned: null, shared: false, other: null },
    { ref: 12, label: 'Strongbox', kind: 'chest', assigned: null, shared: false, other: null },
    { ref: 13, label: 'Wardrobe', kind: 'chest', assigned: null, shared: true, other: null },
    { ref: 14, label: 'Guest room', kind: 'door', assigned: 'Gemma', shared: false, other: null },
    { ref: 15, label: 'Cellar', kind: 'door', assigned: null, shared: false, other: 'Bram' },
    { ref: 16, label: 'Attic', kind: 'door', assigned: null, shared: false, other: null },
    { ref: 17, label: 'Shed', kind: 'door', assigned: null, shared: false, other: null },
  ] };
  const t = S.boot('dbo_housing');
  t.push(Object.assign({}, base, { place }));
  const r = rooms(t);
  check('rooms draw six a page', r.length === 6, r.length);
  check('each says who may open it, the one here marked', r[0].sub.text === 'Open to all inside' && r[1].sub.text === 'Yours alone  (here)' && r[2].sub.text === 'Shared with key holders' && r[3].sub.text === 'Assigned to Gemma' && r[4].sub.text === "Bram's own", r.map((x) => x.sub.text));
  check('a chest of yours: Assign and Share; a shared one: Keep to myself; an assigned door: Reassign and Take back; another\'s: none',
    r[1].as && r[1].sh && !r[1].us && r[2].us && !r[2].sh && r[3].as.label.text === 'Reassign' && r[3].tb && !r[4].as);
  r[2].us.onRelease();
  check('Keep to myself sends unshare with the ref, menu open', msgs(t, 'housing:unshare').pop().args[0] === 13 && !closed(t));
  check('the footer pages and says how many are not listed', /Page 1 of 2.*And 3 more/.test(P(t).right.more.text), P(t).right.more.text);
  t.press(39);
  check('Right shows the seventh', rooms(t).length === 1 && rooms(t)[0].label.text === 'Shed');
  t.press(39);
  check('and no further', rooms(t)[0].label.text === 'Shed');
  t.press(37);
  rooms(t)[0].as.onRelease();
  check('Assign sends the ref and closes: the service waits for the person', msgs(t, 'housing:assign').pop().args[0] === 11 && closed(t));
  const n = S.boot('dbo_housing');
  n.push(Object.assign({}, base, { view: 'keyholder', place }));
  check('a key holder never sees the rooms', !rooms(n).length && P(n).right.hint);
}

{
  const t = S.boot('dbo_housing');
  t.push(base);
  t.press(27);
  check('Escape sends the cancel and closes', msgs(t, 'housing:cancel').length === 1 && msgs(t, 'close').length === 1 && closed(t));
  const l = S.boot('dbo_housing', true);
  l.tick(); l.st.time += 8000; l.tick();
  check('without skse nothing is sent', l.sent.length === 0);
  l.arrive(); l.tick();
  check('once skse appears: ready, then the self-close for the missing payload', l.msgs()[0].key === 'ready' && closed(l));
  const u = S.boot('dbo_housing');
  u.push({ name: 'x' });
  check('an unreadable payload is logged, not drawn', u.logs.some((x) => x.indexOf('unreadable payload') >= 0) && !P(u).acts);
}

T.done();
