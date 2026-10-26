// Dev-only trigger for the real Skyrim Scaleform panel (Worker 4, 25 Oct). Nat asked for actual Skyrim
// menus instead of the browser overlay; this is the hello-world that proves the loop works in game.
//
// The whole route needs no C++: the client's ScaleformMenuService calls Ui.openCustomMenu, the SWF
// (Data\Interface\dbo_testmenu.swf) builds itself and answers with a mod event, and clicks come back as a
// dboScaleform packet. See _work\scaleform-ui-spike-1025.md.
//
// Staff only and hidden, because it needs the hagtest2 client. On any other client /testmenu sends a packet
// that nothing is listening for, which is a silent no-op rather than a break.

module.exports = (api) => {
  const { log, personal, registerChatCommand, sendPacket, who, isAdmin, onUi } = api;

  const ROWS = [
    'Gold: 1,240',
    'Faction: Fighters Guild, rank 2',
    'Bounty: 0',
    'Hunger: well fed',
    'A long row to see where the panel clips the text instead of wrapping it off the edge',
  ];

  // The shared panel packet: swf, the WHOLE payload, and the widget id. The client reads content.payload and
  // JSON-stringifies it for _root.dboData, so title and rows go INSIDE payload. Sending them at the top
  // level is what made the 26 Oct 05:02 session report payload=4ch: the client found no payload and sent
  // the string "null" to a panel that was otherwise working perfectly.
  const show = (a, title, rows) => sendPacket(a, { customPacketType: 'dboScaleform', swf: 'dbo_testmenu', payload: { title, rows }, widget: 0 });

  // Can a native panel load the realm map at run time (Leader, 26 Oct)? The same picture as a PNG and a DDS, by the paths
  // a CustomMenu might resolve: beside the swf in DataInterface, in the browser's DataPlatformUI, and through img://
  const MAP_PATHS = ['dbo-realm-bruma.png', '../Platform/UI/dbo-realm-bruma.png', 'dbo-realm-bruma.dds',
    'img://textures/interface/dbo/realm-bruma.dds', 'img://interface/dbo/realm-bruma.dds', '../textures/interface/dbo/realm-bruma.dds'];

  registerChatCommand('testmenu', (a, args) => {
    const sub = String(args || '').trim().toLowerCase();
    if (sub === 'close') { sendPacket(a, { customPacketType: 'dboScaleform', close: true }); return personal(a, 'Closing the test panel.'); }
    if (sub === 'map') {
      sendPacket(a, { customPacketType: 'dboScaleform', swf: 'dbo_mapprobe', payload: { paths: MAP_PATHS, waitMs: 6000 }, widget: 0 });
      return personal(a, 'Opening the map image probe: each line says whether that path loaded. Close it when every line has an answer.');
    }
    if (sub === 'wide') return show(a, 'Width test', [new Array(12).fill('wide').join(' ')]);
    if (sub === 'many') return show(a, 'Row cap test', new Array(30).fill(0).map((_, i) => `row ${i + 1} of 30`));
    show(a, 'DBO test panel', ROWS);
    personal(a, 'Opening the test panel. It pauses the game; click Close to come back. /testmenu many and /testmenu wide are the other two.');
    log(`scaleform test panel opened by ${who(a)}`);
  }, { admin: true, hidden: true, help: '[many|wide|map|close] open the Scaleform test panel (hagtest2 client only)' });

  // A row click. The panel sends "dbo:testRow" with [index] on the shared panel wire, so the client turns it
  // into the same { customPacketType: 'dbo', event, args, widget } packet a browser widget sends and it
  // arrives here through onUi, exactly like every other widget. 17 clicks reached the server on 26 Oct at
  // 17:13 and nothing answered them, because this handler did not exist yet.
  onUi('testRow', (a, args) => {
    const i = Number(Array.isArray(args) ? args[0] : args);
    if (!Number.isFinite(i)) { log(`scaleform row: a click with no index from ${who(a)}`); return; }
    log(`scaleform row ${i} from ${who(a)}`);
    if (!isAdmin(a)) return;
    personal(a, `You clicked row ${i + 1}: ${ROWS[i] !== undefined ? ROWS[i] : '(not one of the fixed rows)'}`);
  });

  // The probe's answers, one entry per path: init (with its size), error (with the engine's code) or timeout
  onUi('mapProbe', (a, args) => {
    const list = Array.isArray(args) && Array.isArray(args[0]) ? args[0] : [];
    const text = list.map((r) => `${r && r.path}: ${r && r.state}${r && r.state === 'init' ? ` ${r.w}x${r.h}` : r && r.code ? ` ${r.code}` : ''}`).join('; ');
    log(`scaleform map probe from ${who(a)}: ${text || 'no results'}`);
    if (isAdmin(a)) personal(a, `Map probe: ${text || 'no results'}`);
  });

  // The older reply shape, kept only for a client that predates the shared wire. The live client sends its
  // clicks through onUi above, so nothing reaches this on hagtest5 or later.
  // What the client reports back: "ready" once the SWF has built itself, then a row index per click.
  // Every line is logged, because an open that never reports ready is the result this test is looking for.
  globalThis.__dboScaleformPacket = (a, content) => {
    const kind = String(content.kind || '');
    const idx = Number(content.index);
    const loaded = String(content.loaded || '');
    log(`scaleform ${kind}${kind === 'row' ? ' ' + idx : ''} from ${who(a)} swf=${String(content.swf || '')} loaded=${loaded || 'unknown'}`);
    if (kind === 'ready') {
      // loaded comes from Ui.getString on the movie, so it is a second, pull-based proof the right SWF is up
      personal(a, `Panel is up${loaded ? ` (swf reports ${loaded})` : ', but it did not report its version'}.`);
      return;
    }
    if (kind === 'row') {
      if (!isAdmin(a)) return;
      personal(a, `You clicked row ${idx + 1}: ${ROWS[idx] !== undefined ? ROWS[idx] : '(not one of the fixed rows)'}`);
      return;
    }
    if (kind === 'close') personal(a, 'Panel closed.');
  };

  log('scaleformtest.js loaded');
};
