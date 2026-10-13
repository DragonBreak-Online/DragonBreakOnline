// DragonBreak Online: the Key Ring panel (Nate, 13 Oct: "revamp and improve the entire key system"). Loaded by gamemode.js.
//
// With server-settings housingKeyRing on, a house key is a record on the character (housingSystem.ts private.dboKeyRing), not an
// item: copies never stack, a holder walks through a locked door, an owner sees who holds each copy and takes one back. This
// file draws that ring as a panel (front features/keyRing, widget 91) and turns its buttons into __dboHousing calls. It opens
// from the property menu's "Key Ring" button (dbo:keyRingOpen), from "Give a key" on another player's X menu, and with /keys
// (kept, never needed); an offer opens it for the player offered the key. The F3 journal's Keys tab (journal.js section
// 'keys', front journalTab:keys) shows the same rows: its buttons send the same events with the journal's nonce, and the
// answer goes through the journal (__dboJournalLimited), its result in the journal's footer.
//
// A client without the panel (no uiCaps 'keyRing': 0.3.95 and older) gets the same actions as server-driven contextMenu
// widgets (MENU_ID): the ring with an open offer, your keys and the copies of your own locks from /keys; the keys to hand over
// from "Give a key". Each menu's rows are kept here by id, so a row id the server never sent does nothing.

module.exports = (api) => {
  const { log, personal, audit, who, openWidget, closeWidget, onUi, registerChatCommand } = api;
  const WIDGET_ID = 91;
  const MENU_ID = 92; // the contextMenu for a client without widget 91 (widget-ids-harness)
  const S = globalThis.__dboKeyRing || (globalThis.__dboKeyRing = { caps: new Map(), nonces: new Map() });
  S.menus = S.menus || new Map(); // actor -> { nonce, rows: Map(row id -> what it does) }, the open contextMenu (reload keeps it)
  const housing = () => globalThis.__dboHousing || null;
  const on = () => { const H = housing(); return !!H && typeof H.keyRingOn === 'function' && H.keyRingOn(); };
  const hasPanel = (a) => { const c = S.caps.get(a >>> 0); return !!c && c.has('keyRing'); };

  const openPanel = (a, result, kind) => {
    const nonce = `${(a >>> 0).toString(16)}-${Date.now().toString(36)}`;
    S.nonces.set(a >>> 0, nonce);
    openWidget(a, Object.assign({ type: 'keyRing', id: WIDGET_ID, nonce, result: result || '', resultKind: kind || '' }, housing().ringView(a)), true);
  };

  // ---- the contextMenu, for a client without the panel ------------------------------------------------------------------
  const openMenu = (a, title, rows) => {
    const nonce = Math.random().toString(36).slice(2, 10);
    const kept = new Map(), actions = [];
    rows.forEach((r, i) => { const id = `kr:${nonce}:${i}`; kept.set(id, r); actions.push({ id, label: r.label }); });
    S.menus.set(a >>> 0, { nonce, rows: kept });
    openWidget(a, {
      type: 'contextMenu', id: MENU_ID, mode: 'menu', targetName: title, actions,
      events: { action: 'dbo:keyRingMenu', close: 'dbo:keyRingMenuClose' },
    }, true);
  };
  const closeMenu = (a) => { S.menus.delete(a >>> 0); try { closeWidget(a, MENU_ID); } catch (e) { /* offline */ } };
  const keyLabel = (k) => `${k.name}${k.place ? ` (${k.place})` : ''}${k.opens ? '' : ': opens nothing'}`;
  // The ring: an open offer first, then your keys (each opens who to give it to), then the copies of every lock you own
  const ringMenu = (a) => {
    const v = housing().ringView(a);
    const rows = [];
    if (v.offer) {
      rows.push({ label: `Accept ${v.offer.key} from ${v.offer.from}`, do: 'answer', yes: true });
      rows.push({ label: `Decline ${v.offer.key}`, do: 'answer', yes: false });
    }
    for (const k of v.keys) rows.push({ label: `Give ${keyLabel(k)}`, do: 'pickTo', key: k.name });
    for (const o of v.owned || []) {
      rows.push({ label: `Cut a key to ${o.place}`, do: 'cut', ref: o.ref });
      for (const c of o.copies || []) rows.push({ label: `Take back ${c.name}${c.holder ? ` from ${c.holder}` : ''}`, do: 'take', ref: o.ref, key: c.name });
    }
    if (!rows.length) { closeMenu(a); return personal(a, 'Your key ring is empty, and you own no lock.'); }
    openMenu(a, 'Your key ring', rows);
  };
  // "Give a key" on a player's X menu: the giver's keys, each handed to that player
  const giveMenu = (a, to, toName) => {
    const keys = housing().ringView(a).keys;
    if (!keys.length) return personal(a, 'Your key ring is empty.');
    openMenu(a, `Give a key to ${toName || 'them'}`, keys.map((k) => ({ label: keyLabel(k), do: 'give', key: k.name, to: to >>> 0 })));
  };
  const give = (a, key, to) => {
    const why = housing().ringGive(a, key, to);
    if (!why) {
      audit(`KEYRING ${who(a)} offered "${key}" to ${who(to)}`);
      let inJournal = false;
      try { inJournal = typeof globalThis.__dboJournalRedraw === 'function' && globalThis.__dboJournalRedraw(to, 'keys'); } catch (e) { /* no journal */ }
      if (!inJournal) show(to);
    }
    return why;
  };

  const show = (a) => { if (hasPanel(a)) openPanel(a); else ringMenu(a); };

  // Where a button was pressed: 'panel' (widget 91's nonce), 'journal' (the open journal's nonce, its Keys tab), or null
  const fresh = (a, args) => {
    if (!on()) return null;
    const nonce = String((args || [])[0] || '');
    if (nonce && S.nonces.get(a >>> 0) === nonce) return 'panel';
    try { if (nonce && typeof globalThis.__dboJournalFresh === 'function' && globalThis.__dboJournalFresh(a, nonce)) return 'journal'; } catch (e) { /* no journal */ }
    return null;
  };
  // Every action answers with the panel again and its result line, or in chat without the panel
  const answer = (a, why, done) => {
    if (hasPanel(a) && S.nonces.has(a >>> 0)) openPanel(a, why || done, why ? 'refused' : 'ok');
    else personal(a, why || done);
  };
  // One action from either window. run() does it and returns [why, done]; from the journal it runs inside the journal's 3 s
  // rule and the journal redraws its Keys tab with the answer
  const act = (a, from, run) => {
    if (from === 'journal') {
      globalThis.__dboJournalLimited(a, () => { const [why, done] = run(); return { tab: 'keys', text: why || done, kind: why ? 'refused' : 'ok' }; });
      return;
    }
    const [why, done] = run();
    answer(a, why, done);
  };
  // The journal's Keys tab (journal.js registry): shown while the ring is on, with the panel's own rows
  const SECTIONS = globalThis.__dboJournalSections && typeof globalThis.__dboJournalSections === 'object'
    ? globalThis.__dboJournalSections : (globalThis.__dboJournalSections = {});
  SECTIONS.keys = {
    label: 'Keys',
    visible: () => on(),
    view: (a) => { if (!on()) return null; const v = housing().ringView(a) || {}; return { keys: v.keys || [], near: v.near || [], owned: v.owned || [], offer: v.offer || null }; },
  };
  onUi('uiCaps', (a, args) => { S.caps.set(a >>> 0, new Set((args || []).map(String))); });
  onUi('keyRingGive', (a, args) => {
    const from = fresh(a, args); if (!from) return;
    const key = String(args[1] || ''); const to = Number(args[2]) >>> 0;
    act(a, from, () => [give(a, key, to), `You offer ${key}. It stays on your ring until they accept.`]);
  });
  onUi('keyRingAnswer', (a, args) => {
    const from = fresh(a, args); if (!from) return;
    act(a, from, () => {
      const offer = housing().ringView(a).offer;
      const why = housing().ringAnswer(a, args[1] === true);
      if (!why && offer && args[1] === true) audit(`KEYRING ${who(a)} accepted "${offer.key}" from ${offer.from}`);
      return [why, args[1] === true ? `${offer ? offer.key : 'The key'} is on your key ring.` : 'Declined.'];
    });
  });
  onUi('keyRingCut', (a, args) => {
    const from = fresh(a, args); if (!from) return;
    const to = Number(args[2]) >>> 0;
    act(a, from, () => [housing().ringCut(a, Number(args[1]) >>> 0, to || 0), to ? 'Cut, and on their key ring.' : 'Cut, and on your key ring.']);
  });
  onUi('keyRingTake', (a, args) => {
    const from = fresh(a, args); if (!from) return;
    const name = String(args[2] || '');
    act(a, from, () => [housing().ringTakeBack(a, Number(args[1]) >>> 0, name), `${name} no longer opens anything.`]);
  });
  onUi('keyRingClose', (a) => { S.nonces.delete(a >>> 0); closeWidget(a, WIDGET_ID); });
  // The property menu's "Key Ring" button (front housing, shown only while the ring is on)
  onUi('keyRingOpen', (a) => {
    if (!on()) return personal(a, 'Your keys are in your inventory.');
    show(a);
  });

  // A row of the contextMenu: only an id this menu was sent does anything, and housing checks the ring and the lock again
  onUi('keyRingMenu', (a, args) => {
    const id = String((args || [])[0] || '');
    const m = S.menus.get(a >>> 0);
    const r = m && /^kr:([a-z0-9]+):\d+$/.test(id) && id.split(':')[1] === m.nonce ? m.rows.get(id) : null;
    if (!r) { closeMenu(a); if (on()) log(`keyring: ${who(a)} sent a menu row it was not offered (${id.slice(0, 40)})`); return; }
    if (!on()) { closeMenu(a); return personal(a, 'Your keys are in your inventory.'); }
    if (r.do === 'pickTo') {
      const near = housing().ringView(a).near || [];
      if (!near.length) { personal(a, `Nobody stands beside you to give ${r.key} to.`); return ringMenu(a); }
      return openMenu(a, `Give ${r.key} to`, near.map((p) => ({ label: p.name, do: 'give', key: r.key, to: Number(p.actor) >>> 0 })));
    }
    if (r.do === 'give') {
      closeMenu(a);
      const why = give(a, r.key, r.to);
      return personal(a, why || `You offer ${r.key}. It stays on your ring until they accept.`);
    }
    if (r.do === 'answer') {
      closeMenu(a);
      const offer = housing().ringView(a).offer;
      const why = housing().ringAnswer(a, r.yes === true);
      if (!why && offer && r.yes === true) audit(`KEYRING ${who(a)} accepted "${offer.key}" from ${offer.from}`);
      return personal(a, why || (r.yes === true ? `${offer ? offer.key : 'The key'} is on your key ring.` : 'Declined.'));
    }
    if (r.do === 'cut' || r.do === 'take') {
      const why = r.do === 'cut' ? housing().ringCut(a, r.ref, 0) : housing().ringTakeBack(a, r.ref, r.key);
      if (!why) audit(`KEYRING ${who(a)} ${r.do === 'cut' ? 'cut a key to' : `took back "${r.key}" from`} ${(r.ref >>> 0).toString(16)}`);
      personal(a, why || (r.do === 'cut' ? 'Cut, and on your key ring.' : `${r.key} no longer opens anything.`));
      return ringMenu(a);
    }
    closeMenu(a);
  });
  onUi('keyRingMenuClose', (a) => closeMenu(a));

  // The X menu on another player: give them a key from your ring
  globalThis.__dboKeyRingEntries = (a) => (on() && housing().ringView(a).keys.length ? [{ id: 'keyring:give', label: 'Give a key' }] : []);
  globalThis.__dboKeyRingAction = (a, id, t, nameFor) => {
    if (id !== 'keyring:give') return false;
    if (!on()) return true;
    if (hasPanel(a)) { show(a); return true; }
    let name = '';
    try { name = typeof nameFor === 'function' ? nameFor(a, t) : ''; } catch (e) { /* no name */ }
    giveMenu(a, Number(t) >>> 0, name);
    return true;
  };
  globalThis.__dboKeyRingLeave = (a) => { S.caps.delete(a >>> 0); S.nonces.delete(a >>> 0); S.menus.delete(a >>> 0); };

  registerChatCommand('keys', (a) => {
    if (!on()) return personal(a, 'Your keys are in your inventory.');
    show(a);
  }, { help: 'your key ring: the house keys you hold, giving one to a player beside you, and the copies of your own locks' });

  log(`keyring loaded (${on() ? 'on' : 'off: housingKeyRing is not set'})`);
};
