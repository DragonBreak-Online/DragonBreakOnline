// DragonBreak Online: the Key Ring panel (Nate, 13 Oct: "revamp and improve the entire key system"). Loaded by gamemode.js.
//
// With server-settings housingKeyRing on, a house key is a record on the character (housingSystem.ts private.dboKeyRing), not an
// item: copies never stack, a holder walks through a locked door, an owner sees who holds each copy and takes one back. This
// file draws that ring as a panel (front features/keyRing, widget 91) and turns its buttons into __dboHousing calls. It opens
// with /keys and from "Give a key" on another player's X menu; an offer opens it for the player offered the key.

module.exports = (api) => {
  const { log, personal, audit, who, openWidget, closeWidget, onUi, registerChatCommand } = api;
  const WIDGET_ID = 91;
  const S = globalThis.__dboKeyRing || (globalThis.__dboKeyRing = { caps: new Map(), nonces: new Map() });
  const housing = () => globalThis.__dboHousing || null;
  const on = () => { const H = housing(); return !!H && typeof H.keyRingOn === 'function' && H.keyRingOn(); };
  const hasPanel = (a) => { const c = S.caps.get(a >>> 0); return !!c && c.has('keyRing'); };

  const chatRing = (a) => {
    const v = housing().ringView(a);
    if (!v.keys.length) return personal(a, 'Your key ring is empty.');
    for (const k of v.keys) personal(a, `${k.name}${k.place ? ` (${k.place})` : ''}${k.opens ? '' : ': opens nothing'}`);
  };
  const openPanel = (a, result, kind) => {
    const nonce = `${(a >>> 0).toString(16)}-${Date.now().toString(36)}`;
    S.nonces.set(a >>> 0, nonce);
    openWidget(a, Object.assign({ type: 'keyRing', id: WIDGET_ID, nonce, result: result || '', resultKind: kind || '' }, housing().ringView(a)), true);
  };
  const show = (a) => { if (hasPanel(a)) openPanel(a); else chatRing(a); };

  // Every action answers with the panel again and its result line, or in chat without the panel
  const fresh = (a, args) => on() && S.nonces.get(a >>> 0) === String((args || [])[0] || '');
  const answer = (a, why, done) => {
    if (hasPanel(a) && S.nonces.has(a >>> 0)) openPanel(a, why || done, why ? 'refused' : 'ok');
    else personal(a, why || done);
  };
  onUi('uiCaps', (a, args) => { S.caps.set(a >>> 0, new Set((args || []).map(String))); });
  onUi('keyRingGive', (a, args) => {
    if (!fresh(a, args)) return;
    const key = String(args[1] || ''); const to = Number(args[2]) >>> 0;
    const why = housing().ringGive(a, key, to);
    if (!why) { audit(`KEYRING ${who(a)} offered "${key}" to ${who(to)}`); show(to); }
    answer(a, why, `You offer ${key}. It stays on your ring until they accept.`);
  });
  onUi('keyRingAnswer', (a, args) => {
    if (!fresh(a, args)) return;
    const offer = housing().ringView(a).offer;
    const why = housing().ringAnswer(a, args[1] === true);
    if (!why && offer && args[1] === true) audit(`KEYRING ${who(a)} accepted "${offer.key}" from ${offer.from}`);
    answer(a, why, args[1] === true ? `${offer ? offer.key : 'The key'} is on your key ring.` : 'Declined.');
  });
  onUi('keyRingCut', (a, args) => {
    if (!fresh(a, args)) return;
    const to = Number(args[2]) >>> 0;
    answer(a, housing().ringCut(a, Number(args[1]) >>> 0, to || 0), to ? 'Cut, and on their key ring.' : 'Cut, and on your key ring.');
  });
  onUi('keyRingTake', (a, args) => {
    if (!fresh(a, args)) return;
    const name = String(args[2] || '');
    answer(a, housing().ringTakeBack(a, Number(args[1]) >>> 0, name), `${name} no longer opens anything.`);
  });
  onUi('keyRingClose', (a) => { S.nonces.delete(a >>> 0); closeWidget(a, WIDGET_ID); });

  // The X menu on another player: give them a key from your ring
  globalThis.__dboKeyRingEntries = (a) => (on() && housing().ringView(a).keys.length ? [{ id: 'keyring:give', label: 'Give a key' }] : []);
  globalThis.__dboKeyRingAction = (a, id) => {
    if (id !== 'keyring:give') return false;
    if (on()) show(a);
    return true;
  };
  globalThis.__dboKeyRingLeave = (a) => { S.caps.delete(a >>> 0); S.nonces.delete(a >>> 0); };

  registerChatCommand('keys', (a) => {
    if (!on()) return personal(a, 'Your keys are in your inventory.');
    show(a);
  }, { help: 'your key ring: the house keys you hold, giving one to a player beside you, and the copies of your own locks' });

  log(`keyring loaded (${on() ? 'on' : 'off: housingKeyRing is not set'})`);
};
