// mapRealmService (the realm on Skyrim's M map) bundled with its imports stubbed and driven against a fake MapMenu: the
// markers revealed with addToMap a few a frame, the browser shown for the map, the labels read and matched to the realm,
// a digit hiding a kind by shrinking its clips (and only those), R hiding the legend, and the four armed map tests.
//   node tests/map-realm-harness.js      (env ESBUILD_DIR, else the fork's skymp5-server esbuild)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = path.resolve(__dirname, '..');
const ESB = [process.env.ESBUILD_DIR, path.join(HERE, '../skymp5-server/node_modules/esbuild'), path.join(HERE, '../../../fork/skymp5-server/node_modules/esbuild')].find((d) => d && fs.existsSync(path.join(d, 'package.json')));
if (!ESB) { console.log('SKIP needs ESBUILD_DIR'); process.exit(0); }
const esbuild = require(ESB);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'map-realm-'));

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

fs.writeFileSync(path.join(TMP, 'stub.js'), `
const R = () => globalThis.__mapStub;
class ClientListener {}
const sendCustomPacket = (c, p) => R().packets.push(p);
const parseCustomPacket = (e) => e;
const refreshFormMenu = (sp, setter, args) => R().widgets.push(JSON.parse(JSON.stringify(args.widget)));
const closeWidget = (sp, id) => R().widgets.push({ closed: id });
const logError = (...a) => R().errors.push(a.join(' '));
const logTrace = () => {};
const Menu = { Map: 'MapMenu' };
const InputDeviceType = { Keyboard: 0, Mouse: 1 };
// a key setting: what the settings file would give (R().settings), else the service's fallback; every name read is kept
const readMenuKeyCode = (sp, name, fallback) => { R().keysRead.push([name, fallback]); const v = (R().settings || {})[name]; return typeof v === 'number' ? v : fallback; };
// A name this stub lacks throws, naming it, instead of reading as undefined (W4, 2 Nov: a constructor's call to a missing
// readMenuKeyCode showed only as 'is not a function')
const stub = { ClientListener, sendCustomPacket, parseCustomPacket, refreshFormMenu, closeWidget, logError, logTrace, Menu, InputDeviceType, readMenuKeyCode };
module.exports = new Proxy(stub, { get: (t, k) => { if (k in t || typeof k === 'symbol' || k === '__esModule' || k === 'default' || k === 'then') return t[k]; throw new Error('the map-realm harness stub has no ' + String(k) + ': add it to the stub in tests/map-realm-harness.js'); } });
`);
const STUBBED = /\/(clientListener|customPacketUtil|widgetMenuUtil|logging)$|^skyrimPlatform$|connectionMessage$|customPacketMessage$/;

(async () => {
  const out = path.join(TMP, 'svc.js');
  await esbuild.build({
    entryPoints: [path.join(HERE, 'src/services/services/mapRealmService.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /.*/ }, (a) => (STUBBED.test(a.path) ? { path: path.join(TMP, 'stub.js') } : undefined)); } }],
  });
  const { MapRealmService } = require(out);

  // A gap over 100 ms between updates is put down to what the update before it sent to Scaleform
  const costOut = path.join(TMP, 'cost.js');
  await esbuild.build({ entryPoints: [path.join(HERE, 'src/services/services/mapCost.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: costOut, logLevel: 'error' });
  const { MapCost } = require(costOut);
  const c = new MapCost(0);
  c.frame(0); c.act('scale'); c.frame(16); c.act('owners'); c.act('owners'); c.frame(200); c.frame(216); c.frame(400);
  const cr = c.report(400);
  ok(cr.frames === 5 && cr.slow === 2 && cr.worstMs === 184 && cr.slowAfter.owners === 1 && cr.slowAfter.none === 1 && !cr.slowAfter.scale && cr.acts.owners === 2,
    'a slow frame is put down to what the frame before sent (owners), or to nothing', cr);

  // A fake MapMenu: marker clips with labels and a property store the Ui calls read and write
  const LABELS = ['Bruma', 'Applewatch', 'Sancre Tor', 'Pale Pass', 'Fort Caractacus', "Wraith's Barrow", 'Greenwood'];
  const S = { packets: [], widgets: [], errors: [], revealed: [], visible: [], props: {}, invoked: [], keysRead: [], settings: {} };
  globalThis.__mapStub = S;
  LABELS.forEach((l, i) => { S.props[`_root.MarkerClips.Marker${i}.label`] = l; S.props[`_root.MarkerClips.Marker${i}._x`] = 100 + i; });
  S.props['_root.WorldMap._markerList.length'] = LABELS.length;
  const forms = { 'aa:BSHeartland.esm': 1, 'bb:BSHeartland.esm': 2, 'cc:BSHeartland.esm': 3, 'dd:BSHeartland.esm': 4, 'ee:DragonBreak Online Edits.esp': 5 }; // verify-formids: ignore
  const sp = {
    Game: { getFormFromFile: (id, file) => { const k = id.toString(16) + ':' + file; return forms[k] ? { k } : null; } },
    ObjectReference: { from: (f) => (f ? { addToMap: (ft) => S.revealed.push([f.k, ft]) } : null) },
    browser: { setVisible: (v) => S.visible.push(v) },
    Ui: {
      isMenuOpen: (m) => (m === 'CustomMenu' ? !!S.customOpen : S.menuOpen !== false),
      // our CustomMenu (the legend over the map): opened and closed are recorded; dbo_maplegend comes alive in it when S.legendWorks
      openCustomMenu: (swf, flags) => {
        S.custom = (S.custom || []).concat([['open', swf, flags]]); S.customOpen = true;
        if (swf === 'dbo_maplegend' && S.legendWorks) { S.props['_root._url'] = 'Interface/dbo%5Fmaplegend.swf'; S.props['_root.dboAlive'] = 'Yes'; } // as the game read them back (Nat, 05:05Z): escaped, capitalised
      },
      closeCustomMenu: () => { S.custom = (S.custom || []).concat([['close']]); S.customOpen = false; delete S.props['_root._url']; delete S.props['_root.dboAlive']; },
      setBool: (m, p, v) => { S.props[p] = v; }, setString: (m, p, v) => { S.props[p] = v; },
      getInt: (m, p) => S.props[p] | 0, getString: (m, p) => (S.props[p] === undefined ? '' : String(S.props[p])), getFloat: (m, p) => Number(S.props[p] === undefined ? 100 : S.props[p]),
      setFloat: (m, p, v) => { S.props[p] = v; }, invokeStringA: (m, p, a) => { S.invoked.push([p, a]); if (p === '_root.createEmptyMovieClip') S.props[`_root.${a[0]}._name`] = a[0]; },
      // the legend swf (dbo_maplegend): alive after its loadMovie only when S.legendWorks; its dboData is recorded
      invokeString: (m, p, arg) => {
        S.invoked.push([p, [arg]]);
        if (p === '_root.dboData') S.legendData.push(JSON.parse(arg));
      },
    },
  };
  S.legendData = [];
  S.legendWorks = false;
  const h = {};
  const controller = { on: (ev, fn) => { h[ev] = fn; }, emitter: { on: (ev, fn) => { h['emit:' + ev] = fn; } } };
  new MapRealmService(sp, controller);
  ok(S.keysRead.some(([n, d]) => n === 'mapColoursKeyCode' && d === 20), 'the map colours key is read as the other hotkeys are, T its fallback', S.keysRead);
  let named = '';
  try { void require(path.join(TMP, 'stub.js')).notInTheStub; } catch (e) { named = e.message; }
  ok(/notInTheStub/.test(named), 'the stub names a function it lacks rather than returning undefined', named);
  const frames = (n) => { for (let i = 0; i < n; i++) h.update(); };
  const key = (code) => h.buttonEvent({ isDown: true, device: 0, code });
  const scale = (i) => S.props[`_root.MarkerClips.Marker${i}._xscale`];

  const markers = [
    { desc: 'aa:BSHeartland.esm', kind: 'seat', name: 'Bruma' }, { desc: 'bb:BSHeartland.esm', kind: 'town', name: 'Applewatch' }, // verify-formids: ignore
    { desc: 'cc:BSHeartland.esm', kind: 'fort', name: 'Pale Pass' }, { desc: 'dd:BSHeartland.esm', kind: 'fort', name: 'Fort Caractacus' }, // verify-formids: ignore
    { desc: 'ee:DragonBreak Online Edits.esp', kind: 'boss', name: "Wraith's Barrow" }, { desc: 'ff:Missing.esp', kind: 'village', name: 'Greenwood' }, // verify-formids: ignore
    { desc: 'not a desc', kind: 'town', name: 'Bad' }, { desc: '1:Skyrim.esm', kind: 'tavern', name: 'Unknown kind' }, // verify-formids: ignore
  ];
  h['emit:customPacketMessage']({ customPacketType: 'dboMapRealm', markers });
  frames(1);
  ok(S.revealed.length === 5 && S.revealed.every((r) => r[1] === false), 'the realm markers are revealed with addToMap, fast travel off; a bad desc or kind is dropped, a missing form skipped', S.revealed);

  // ---- a legend menu that never comes alive: the browser draws the legend, as before ----
  // nothing is opened until the map itself is open (the HUD's rule), and nothing at all inside the map (the 2 Nov probe)
  S.menuOpen = false; S.custom = []; S.customOpen = false;
  h.menuOpen({ name: 'MapMenu' });
  frames(3);
  ok(!S.custom.length, 'the map\'s open event alone opens nothing: it waits for the map to be open', S.custom);
  S.menuOpen = true;
  frames(2);
  ok(!S.custom.length, '...nor while the map settles: our menu opened on frame 1 never came alive (04:32Z)', S.custom);
  frames(55);
  ok(JSON.stringify(S.custom) === JSON.stringify([['open', 'dbo_maplegend', 0]]), 'from frame 60, with the markers there, the map opens dbo_maplegend as our own CustomMenu over it', S.custom);
  ok(!S.invoked.some((x) => /createEmptyMovieClip|loadMovie/.test(x[0])), '...and makes nothing inside the map, neither the legend nor the owners overlay', S.invoked);
  ok(!S.widgets.length && !S.visible.length, 'while it loads, no browser legend and the browser left hidden', [S.widgets, S.visible]);
  frames(240);
  ok(S.custom.filter((x) => x[0] === 'open').length === 1, 'one try only: our CustomMenu is never opened twice', S.custom);
  ok(S.custom[S.custom.length - 1][0] === 'close' && !S.customOpen, '...one that never comes alive is closed again', S.custom);
  ok(S.visible.length >= 1 && S.visible.every((v) => v === true), '...and the browser is shown for the map', S.visible);
  const w = S.widgets[S.widgets.length - 1];
  const row = (id) => w.rows.find((r) => r.id === id);
  ok(w.type === 'mapRealm' && w.id === 210 && w.mapMode === true && w.shown === true, 'the legend widget is published in map mode', w);
  ok(row('seat').count === 1 && row('town').count === 1 && row('fort').count === 2 && row('boss').count === 1 && row('village').count === 1 && row('other').count === 1, 'it counts the markers this map shows by kind; one unknown label is everything else', w.rows);
  ok(w.rows.map((r) => r.key).join('') === '1234560', 'each row carries its digit, 0 for everything else');
  ok(LABELS.every((l, i) => scale(i) === 100), 'nothing is hidden yet: every clip at full scale');

  key(5);   // 4: forts
  frames(1);
  ok(scale(3) === 0 && scale(4) === 0 && S.props['_root.MarkerClips.Marker3._yscale'] === 0, 'a digit hides that kind: both forts shrink to nothing');
  ok(scale(0) === 100 && scale(2) === 100 && scale(5) === 100, 'and only that kind');
  // live, 3 Nov: SkyUI gave a clip another marker while the map was open, and the hide stayed on the clip, not the marker
  S.props['_root.MarkerClips.Marker3.label'] = 'Applewatch';
  frames(2);
  ok(scale(3) === 100, 'a clip that now shows a town (it showed a fort) is read again and shown', scale(3));
  S.props['_root.MarkerClips.Marker3.label'] = 'Pale Pass';
  frames(2);
  ok(scale(3) === 0, '...and hidden again when it is a fort once more', scale(3));
  ok(S.widgets[S.widgets.length - 1].rows.find((r) => r.id === 'fort').shown === false, 'the legend greys the hidden kind');
  key(11);  // 0: everything else
  frames(1);
  ok(scale(2) === 0, '0 hides everything that is not the realm (Sancre Tor)');
  key(5);
  frames(1);
  ok(scale(3) === 100 && scale(4) === 100 && scale(2) === 0, 'the digit again shows the forts, and leaves the other kind hidden');
  key(19);
  ok(S.widgets[S.widgets.length - 1].shown === false, 'R hides the legend');
  key(30);
  ok(S.widgets[S.widgets.length - 1].shown === false && S.widgets.length > 0, 'another key is not ours');
  S.packets.length = 0;
  h.menuClose({ name: 'MapMenu' });
  ok(S.widgets[S.widgets.length - 1].closed === 210, 'closing the map closes the legend');
  const rep = (S.packets.find((p) => p.event === 'mapSwf') || { args: [{}] }).args[0];
  ok(rep.legend && rep.legend.last === 'clip' && rep.legend.phase === 'off' && rep.legend.tries === 1 && rep.legend.menu === 60 && /\[frame [0-9]+\/[0-9]+, version "", alive ""\]$/.test(rep.legend.url) && rep.legend.inject.length === 1 && rep.legend.loaded === -1 && rep.owners === null,
    'closing sends one mapSwf line: opened at frame 60, our menu there, its swf never loaded, and what its movie was doing', rep);
  const before = S.props['_root.MarkerClips.Marker3._xscale'];
  key(5);
  ok(S.props['_root.MarkerClips.Marker3._xscale'] === before, 'with the map closed a digit does nothing');

  // ---- the armed tests ----
  S.packets.length = 0;
  h['emit:customPacketMessage']({ customPacketType: 'dboMapTest' });
  h.menuOpen({ name: 'MapMenu' });
  frames(20);
  h.browserMessage({ arguments: ['mapRealm:mounted'] });
  ok(S.invoked.some((x) => x[0] === '_root.createEmptyMovieClip' && x[1][0] === 'dboProbeClip'), 'T1 asks the map to create a clip');
  ok(S.props['_root.MarkerClips.Marker0._xscale'] === 0, 'T4 shrinks marker 0');
  let n = 0;
  for (let i = 0; i < 130; i++) { if (i > 70) S.props['_root.MarkerClips.Marker0._x'] = 200 + (n++ % 3); h.update(); }
  const r = S.packets.find((p) => p.event === 'mapTest');
  ok(r && r.customPacketType === 'dbo' && r.widget === 0, 'the results go to the server as the mapTest event', S.packets);
  const res = r ? r.args[0] : {};
  ok(res.t1 === 'dboProbeClip', 'T1 reads the created clip back', res);
  ok(res.t2 && res.t2.frames === 120 && res.t2.still === 0 && res.t2.panning > 0, 'T2: no marker moves while still, and some do while panning', res.t2);
  ok(res.t3 === 'the legend widget mounted' && res.t4 === 0 && res.end === 'done', 'T3 heard the widget mount, T4 read the scale back', res);
  h.menuClose({ name: 'MapMenu' });
  ok(S.packets.filter((p) => p.event === 'mapTest').length === 1, 'the results are sent once');
  S.packets.length = 0;
  h['emit:customPacketMessage']({ customPacketType: 'dboMapTest' });
  h.menuOpen({ name: 'MapMenu' });
  frames(3);
  h.menuClose({ name: 'MapMenu' });
  const tests = S.packets.filter((p) => p.event === 'mapTest');
  ok(tests.length === 1 && tests[0].args[0].end === 'the map closed', 'closing the map early still reports, and says why', S.packets);
  ok(!S.legendData.length, 'a legend menu that never came alive is never sent its data', S.legendData.length);
  ok(!S.errors.length, 'no frame failed', S.errors);

  // ---- a legend swf that comes alive: the map draws the legend, and the browser stays out of it ----
  const h2 = {};
  S.widgets.length = 0; S.visible.length = 0; S.invoked.length = 0; S.legendData.length = 0; S.legendWorks = true;
  S.custom = []; S.customOpen = false;
  LABELS.forEach((l, i) => { S.props[`_root.MarkerClips.Marker${i}._xscale`] = 100; });
  new MapRealmService(sp, { on: (ev, fn) => { h2[ev] = fn; }, emitter: { on: (ev, fn) => { h2['emit:' + ev] = fn; } } });
  h2['emit:customPacketMessage']({ customPacketType: 'dboMapRealm', markers });
  h2.menuOpen({ name: 'MapMenu' });
  for (let i = 0; i < 62; i++) h2.update();
  const last = () => S.legendData[S.legendData.length - 1];
  ok(S.legendData.length >= 1 && last().shown === true && last().rows.find((r) => r.id === 'fort').count === 2 && last().rows.map((r) => r.key).join('') === '1234560',
    'alive: the legend goes to our menu over the map, the same rows and counts', last());
  ok(!S.widgets.length && !S.visible.length, '...and no browser legend, the browser left hidden', [S.widgets, S.visible]);
  S.packets.length = 0;
  h2.buttonEvent({ isDown: true, device: 0, code: 5 });
  ok(last().rows.find((r) => r.id === 'fort').shown === false, 'a digit greys its kind in the map\'s legend');
  h2.buttonEvent({ isDown: true, device: 0, code: 19 });
  ok(S.custom[S.custom.length - 1][0] === 'close' && !S.customOpen, 'R closes our menu: if it ever held the map\'s input, R always takes it away', S.custom);
  h2.buttonEvent({ isDown: true, device: 0, code: 19 });
  for (let i = 0; i < 62; i++) h2.update();
  ok(S.custom.filter((x) => x[0] === 'open').length === 2 && S.customOpen, '...and R again opens it again', S.custom);
  h2.menuClose({ name: 'MapMenu' });
  const rep2 = (S.packets.find((p) => p.event === 'mapSwf') || { args: [{}] }).args[0];
  ok(rep2.legend && rep2.legend.last === 'alive' && rep2.legend.phase === 'up' && rep2.legend.loaded >= 1 && /dbo(_|%5F)maplegend\.swf$/i.test(rep2.legend.url), 'alive (read back as "Yes", the url escaped, as the game gives them): the line says loaded and alive, with the url it came from', rep2);
  ok(!S.customOpen, 'closing the map closes our menu with it');
  S.custom = [];
  h2.menuOpen({ name: 'MapMenu' });
  for (let i = 0; i < 62; i++) h2.update();
  ok(JSON.stringify(S.custom) === JSON.stringify([['open', 'dbo_maplegend', 0]]) && !S.widgets.length, 'the next opening opens it over the new map again', S.custom);
  h2.menuClose({ name: 'MapMenu' });
  // another CustomMenu already up (a server panel): ours waits rather than replace it
  S.custom = []; S.customOpen = true;
  h2.menuOpen({ name: 'MapMenu' });
  for (let i = 0; i < 62; i++) h2.update();
  ok(!S.custom.length, 'another CustomMenu already up: ours is not opened over it', S.custom);
  h2.menuClose({ name: 'MapMenu' });
  ok(!S.custom.length, '...nor closed: it is not ours', S.custom);
  S.customOpen = false;
  ok(!S.errors.length, 'no frame failed', S.errors);

  // ---- who owns what, drawn in our legend menu over the map and lined up with the markers ----
  const h6 = {};
  S.widgets.length = 0; S.custom = []; S.customOpen = false; S.legendWorks = true; S.invoked.length = 0;
  const game0 = sp.Game;
  sp.Game = Object.assign({}, game0, {
    getPlayer: () => ({ getWorldSpace: () => ({ getFormID: () => 0x3c }) }),
    getFormFromFile: (id, file) => (id === 0x3c && /skyrim\.esm/i.test(file) ? { getFormID: () => 0x3c } : game0.getFormFromFile(id, file)),
  });
  sp.Ui.getBool = (m, p) => S.props[p] !== false;
  // the map as Skyrim's: a tilted camera, so the north shows smaller (w grows with y); six realm markers at known places
  const K = 0.000004;
  const toScreen = (x, y) => { const w = 1 + K * y; return [640 + (0.002 * x) / w, 360 - (0.002 * y) / w]; };
  const toWorld = (u, v) => { const t = (360 - v) / 0.002; const y = t / (1 - K * t); const w = 1 + K * y; return [((u - 640) * w) / 0.002, y]; };
  const anchorsAt = [['Bruma', 0, 0], ['Applewatch', 50000, 0], ['Sancre Tor', 0, 50000], ['Pale Pass', -40000, -30000], ['Fort Caractacus', 30000, -40000], ["Wraith's Barrow", -20000, 30000]];
  const place = (dx) => anchorsAt.forEach(([name, x, y]) => { const i = LABELS.indexOf(name); const [u, v] = toScreen(x, y); S.props[`_root.MarkerClips.Marker${i}._x`] = u + dx; S.props[`_root.MarkerClips.Marker${i}._y`] = v; });
  place(0);
  S.props['_root.MarkerClips._x'] = 0; S.props['_root.MarkerClips._y'] = 0;
  S.props['_root.WorldMap._mapWidth'] = 1280; S.props['_root.WorldMap._mapHeight'] = 720;
  S.props['_root.dboStageL'] = 0; S.props['_root.dboStageT'] = 0; S.props['_root.dboStageW'] = 1280; S.props['_root.dboStageH'] = 720;
  new MapRealmService(sp, { on: (ev, fn) => { h6[ev] = fn; }, emitter: { on: (ev, fn) => { h6['emit:' + ev] = fn; } } });
  h6['emit:customPacketMessage']({ customPacketType: 'dboMapRealm', markers });
  h6['emit:customPacketMessage']({ customPacketType: 'dboMapOwners', worlds: [{ world: '3c:Skyrim.esm', aliases: [], territories: [{ id: 'a', owner: 'hold-a', x: 0, y: 0 }, { id: 'b', owner: 'hold-b', x: 50000, y: 0 }] }],
    factions: { 'hold-a': { name: 'A', rgb: [200, 0, 0] }, 'hold-b': { name: 'B', rgb: [0, 200, 0] } }, anchors: anchorsAt.map(([name, x, y]) => ({ name, x, y, z: 0 })), reach: 30000, fade: 45000 });
  h6.menuOpen({ name: 'MapMenu' });
  for (let i = 0; i < 64; i++) h6.update();
  h6.buttonEvent({ isDown: true, device: 0, code: 20 }); // the relief: off until T
  for (let i = 0; i < 6; i++) h6.update();
  const owners = () => S.invoked.filter((x) => x[0] === '_root.dboOwners').map((x) => JSON.parse(x[1][0]));
  // the marker sets for checking the fit in the game: one at the first fit, its points the anchors as the map showed them
  const fitLines = S.packets.filter((p) => p.event === 'mapOwnersFit').map((p) => p.args[0]);
  const fs0 = fitLines[0] || {};
  const bruma = (fs0.p || []).find((q) => q[0] === 0 && q[1] === 0);
  ok(fitLines.length === 1 && fs0.n === 6 && fs0.rms < 0.5 && fs0.h.length === 9 && fs0.p.length === 6 && bruma && Math.abs(bruma[2] - 640) < 0.1 && Math.abs(bruma[3] - 360) < 0.1 && JSON.stringify(fs0).length < 400,
    'one marker set sent at the first fit: the homography, its rms, the affine rms, world and screen xy, short enough for the log', fs0);
  const drawn = owners();
  ok(drawn.length === 1 && drawn[0].fills.length === 4, 'the owners are drawn once into our legend menu (two territories, two layers each)', drawn.length);
  ok(S.props['_root.owners.layer._visible'] === true, '...the layer shown once the markers fit', S.props['_root.owners.layer._visible']);
  ok(S.props['_root.owners.layer._x'] === 0 && S.props['_root.owners.layer._xscale'] === 100 && S.props['_root.owners.layer._rotation'] === 0, '...the layer flat: the points are already where the map shows them', [S.props['_root.owners.layer._x'], S.props['_root.owners.layer._xscale']]);
  // the border between the two holds runs along x = 25,000 on the ground; projected through the tilted camera, both its
  // ends must land back on that line (an affine fit could not put both there)
  const border = (d) => d.lines[0] ? [toWorld(d.lines[0].pts[0], d.lines[0].pts[1]), toWorld(d.lines[0].pts[2], d.lines[0].pts[3])] : [];
  const b0 = drawn[0] ? border(drawn[0]) : [];
  ok(b0.length === 2 && b0.every(([x]) => Math.abs(x - 25000) < 60) && Math.abs(b0[0][1] - b0[1][1]) > 10000, '...the border drawn where the tilted map shows it, at both ends', b0);
  // Nat, 2 Nov: the colours flashed, then shook. A still map sends nothing more and writes nothing to the layer
  const layerWrites = [];
  const setBool0 = sp.Ui.setBool, setFloat0 = sp.Ui.setFloat;
  sp.Ui.setBool = (m, p, v) => { if (p.startsWith('_root.owners.layer')) layerWrites.push([p, v]); setBool0(m, p, v); };
  sp.Ui.setFloat = (m, p, v) => { if (p.startsWith('_root.owners.layer')) layerWrites.push([p, v]); setFloat0(m, p, v); };
  for (let i = 0; i < 30; i++) h6.update();
  ok(!layerWrites.length && owners().length === 1, 'the map still: nothing redrawn or written, frame after frame (no flashing, no shaking)', [layerWrites.slice(0, 4), owners().length]);
  const pale = LABELS.indexOf('Pale Pass');
  const paleX = S.props[`_root.MarkerClips.Marker${pale}._x`];
  S.props[`_root.MarkerClips.Marker${pale}._x`] = paleX + 400;
  for (let i = 0; i < 10; i++) h6.update();
  ok(owners().length === 1 && !layerWrites.some(([p, v]) => /_visible$/.test(p) && v === false) && S.props['_root.owners.layer._visible'] === true, 'frames whose fit does not hold keep the colours shown where they were', [owners().length, layerWrites.slice(0, 4)]);
  S.props[`_root.MarkerClips.Marker${pale}._x`] = paleX;
  place(100);
  for (let i = 0; i < 5; i++) h6.update();
  const panned = owners();
  ok(panned.length >= 2 && Math.abs(panned[panned.length - 1].lines[0].pts[0] - drawn[0].lines[0].pts[0] - 100) < 1, 'a pan redraws the colours moved with the markers', [panned.length, panned.length ? panned[panned.length - 1].lines[0].pts.slice(0, 2) : null]);
  place(0);
  h6.update(); h6.update(); h6.update();
  sp.Ui.setBool = setBool0; sp.Ui.setFloat = setFloat0;
  const legendRows = S.legendData.length ? S.legendData[S.legendData.length - 1].rows : [];
  ok(legendRows.some((r) => r.id === 'territories' && r.key === 'T' && r.count === 2), 'the legend gets the colours\' row, T and two owners', legendRows);
  h6.buttonEvent({ isDown: true, device: 0, code: 20 });
  h6.update();
  ok(S.props['_root.owners.layer._visible'] === false, 'T hides the colours', S.props['_root.owners.layer._visible']);
  // Nat, 2 Nov: our menu took Tab, so the map stayed open until R closed ours. Tab (or Esc) closes ours and hands Tab on
  S.taps = []; sp.Input = { tapKey: (c) => S.taps.push(c) };
  h6.buttonEvent({ isDown: true, device: 0, code: 20 });
  S.custom = [];
  h6.buttonEvent({ isDown: true, device: 0, code: 0x0f });
  ok(JSON.stringify(S.custom) === JSON.stringify([['close']]), 'Tab with our menu up closes ours', S.custom);
  h6.update();
  ok(!S.taps.length, "...the map's Tab not yet (a frame for ours to go)", S.taps);
  h6.update(); h6.update(); h6.update();
  ok(JSON.stringify(S.taps) === JSON.stringify([0x0f]), '...then Tab once, for the map to close', S.taps);
  h6.buttonEvent({ isDown: true, device: 0, code: 0x0f });
  h6.update(); h6.update(); h6.update();
  ok(S.taps.length === 1, "with ours already down, Tab is the map's own and nothing is tapped", S.taps);
  S.packets.length = 0;
  h6.menuClose({ name: 'MapMenu' });
  const fl = ((S.packets.find((p) => p.event === 'mapSwf') || { args: [{}] }).args[0] || {}).flash || {};
  ok(fl.held > 0 && fl.failed + fl.noFit >= 10 && fl.shown === 2 && fl.hidden === 1 && fl.redraws === 2 && fl.closes.length === 1 && fl.moves >= 3 && fl.maxStep.px >= 99 && typeof fl.seconds === 'number',
    'the mapSwf line counts what could flash: fits held, failed or short of markers and their flips, the layer shown and hidden, moves and the largest step, redraws, our menu closed', fl);
  // The lag on the map (3 Nov): one mapCost line an opening, with each step's JS and what was sent to Scaleform
  const mc = ((S.packets.find((p) => p.event === 'npcDrift' && p.args[0] && p.args[0].kind === 'mapCost') || { args: [null] }).args[0]) || {};
  const st = mc.steps || {};
  ok(mc.frames > 100 && ['labels', 'filter', 'owners', 'legend'].every((k) => Array.isArray(st[k]) && st[k][2] > 0) && mc.acts.owners >= 2 && mc.world === 0x3c && typeof mc.slow === 'number' && JSON.stringify(mc).length < 900,
    'the map sends one mapCost line on closing: frames, each step timed, the owners drawing counted, short enough for the log', mc);
  // Esc, and the map closing before the tap: nothing tapped (a Tab with no map open would open the tween menu)
  S.taps = []; S.custom = []; S.customOpen = false;
  h6.menuOpen({ name: 'MapMenu' });
  for (let i = 0; i < 70; i++) h6.update();
  h6.buttonEvent({ isDown: true, device: 0, code: 0x01 });
  ok(S.custom.some((c) => c[0] === 'close'), 'Esc closes ours too', S.custom);
  h6.menuClose({ name: 'MapMenu' });
  for (let i = 0; i < 4; i++) h6.update();
  ok(!S.taps.length, '...and when the map closed by itself, nothing is tapped', S.taps);
  // ---- SkyrimPlatform's overlay menu, when this build has it: no input taken, so the map keeps WASD and the wheel ----
  {
    const h10 = {};
    const O = { calls: [], open: false };
    sp.overlayMenu = { menuName: 'DboOverlayMenu', open: (swf) => { O.calls.push(['open', swf]); O.open = true; S.props['_root.dboAlive'] = 'Yes'; S.props['_root._url'] = 'Interface/dbo%5Fmaplegend.swf'; S.props['_root.dboVersion'] = 'maplegend-4'; },
      close: () => { O.calls.push(['close']); O.open = false; }, isOpen: () => O.open };
    const isOpen0 = sp.Ui.isMenuOpen;
    sp.Ui.isMenuOpen = (m) => (m === 'DboOverlayMenu' ? O.open : isOpen0(m));
    S.custom = []; S.customOpen = true; S.menuOpen = true; S.taps = []; sp.Input = { tapKey: (c) => S.taps.push(c) };
    new MapRealmService(sp, { on: (ev, fn) => { h10[ev] = fn; }, emitter: { on: (ev, fn) => { h10['emit:' + ev] = fn; } } });
    h10['emit:customPacketMessage']({ customPacketType: 'dboMapRealm', markers });
    h10.menuOpen({ name: 'MapMenu' });
    for (let i = 0; i < 64; i++) h10.update();
    ok(JSON.stringify(O.calls) === JSON.stringify([['open', 'dbo_maplegend']]) && !S.custom.length, 'the legend opens in the overlay menu, not a CustomMenu, even with a server panel\'s CustomMenu up', [O.calls, S.custom]);
    const hidden0 = JSON.stringify(S.legendData.length ? S.legendData[S.legendData.length - 1] : null);
    h10.buttonEvent({ isDown: true, device: 0, code: 2 });
    h10.update();
    ok(JSON.stringify(S.legendData.length ? S.legendData[S.legendData.length - 1] : null) === hidden0, '...a server panel over the map keeps its own keys: a digit does nothing to the legend', S.legendData.length);
    S.customOpen = false;
    h10.buttonEvent({ isDown: true, device: 0, code: 0x0f });
    for (let i = 0; i < 4; i++) h10.update();
    ok(O.open && !S.taps.length, 'Tab with the overlay up is left to the map: ours stays, nothing is tapped', [O.open, S.taps]);
    h10.menuClose({ name: 'MapMenu' });
    ok(!O.open && O.calls.some((c) => c[0] === 'close'), 'the map closing closes the overlay menu', O.calls);
    // the net: the overlay open with no map is closed by its own close
    O.open = true; O.calls = []; S.menuOpen = false;
    h10.update(); h10.update();
    ok(!O.open && JSON.stringify(O.calls) === JSON.stringify([['close']]), 'the overlay open with no map is closed on the next ticks', O.calls);
    S.menuOpen = true; delete sp.overlayMenu; sp.Ui.isMenuOpen = isOpen0; S.customOpen = false; delete S.props['_root.dboVersion'];
  }

  // ---- the server says flat, but this player's map is the 3D relief (live, 3 Nov: paper maps not installed) ----
  {
    const h11 = {};
    S.custom = []; S.customOpen = false; S.invoked.length = 0; S.menuOpen = true; S.packets.length = 0; S.props['_root.owners.layer._visible'] = false;
    place(0); // the tilted camera's positions
    new MapRealmService(sp, { on: (ev, fn) => { h11[ev] = fn; }, emitter: { on: (ev, fn) => { h11['emit:' + ev] = fn; } } });
    h11['emit:customPacketMessage']({ customPacketType: 'dboMapRealm', markers });
    h11['emit:customPacketMessage']({ customPacketType: 'dboMapOwners', worlds: [{ world: '3c:Skyrim.esm', aliases: [], flat: true, territories: [{ id: 'a', owner: 'hold-a', x: 0, y: 0 }, { id: 'b', owner: 'hold-b', x: 50000, y: 0 }] }],
      factions: { 'hold-a': { name: 'A', rgb: [200, 0, 0] }, 'hold-b': { name: 'B', rgb: [0, 200, 0] } }, anchors: anchorsAt.map(([name, x, y]) => ({ name, x, y, z: 0 })), reach: 30000, fade: 45000 });
    h11.menuOpen({ name: 'MapMenu' });
    for (let i = 0; i < 80; i++) h11.update();
    ok(S.props['_root.owners.layer._visible'] !== true, 'a map the server calls flat that measures 3D: no colours drawn over it', S.props['_root.owners.layer._visible']);
    h11.menuClose({ name: 'MapMenu' });
    const rp = ((S.packets.find((p) => p.event === 'mapSwf') || { args: [{}] }).args[0]) || {};
    ok(rp.notFlat === true, '...and the map line says so (notFlat)', rp.notFlat);
    S.customOpen = false;
  }

  // ---- a flat paper map (Nat, 2 Nov: the redrawn colours lagged his pans and snapped back) ----
  {
    const h9 = {};
    S.custom = []; S.customOpen = false; S.invoked.length = 0; S.menuOpen = true; S.props['_root.owners.layer._visible'] = false;
    let zoom = 1, pan = 0;
    const flatScreen = (x, y) => [640 + pan + zoom * 0.002 * x, 360 - zoom * 0.002 * y];
    const put = () => anchorsAt.forEach(([name, x, y]) => { const i = LABELS.indexOf(name); const [u, v] = flatScreen(x, y); S.props[`_root.MarkerClips.Marker${i}._x`] = u; S.props[`_root.MarkerClips.Marker${i}._y`] = v; });
    put();
    new MapRealmService(sp, { on: (ev, fn) => { h9[ev] = fn; }, emitter: { on: (ev, fn) => { h9['emit:' + ev] = fn; } } });
    h9['emit:customPacketMessage']({ customPacketType: 'dboMapRealm', markers });
    h9['emit:customPacketMessage']({ customPacketType: 'dboMapOwners', worlds: [{ world: '3c:Skyrim.esm', aliases: [], flat: true, territories: [{ id: 'a', owner: 'hold-a', x: 0, y: 0 }, { id: 'b', owner: 'hold-b', x: 50000, y: 0 }] }],
      factions: { 'hold-a': { name: 'A', rgb: [200, 0, 0] }, 'hold-b': { name: 'B', rgb: [0, 200, 0] } }, anchors: anchorsAt.map(([name, x, y]) => ({ name, x, y, z: 0 })), reach: 30000, fade: 45000 });
    h9.menuOpen({ name: 'MapMenu' });
    for (let i = 0; i < 70; i++) h9.update();
    const sends = () => S.invoked.filter((x) => x[0] === '_root.dboOwners');
    const L = (p) => S.props[`_root.owners.layer${p}`];
    const first = sends()[0] ? JSON.parse(sends()[0][1][0]) : { fills: [] };
    ok(sends().length === 1 && first.fills.length === 4 && first.fills.every((x) => !x.quads) && first.lines[0] && Math.abs(first.lines[0].pts[0] - 25000 / 64) < 1, 'a flat map: the colours are sent once, in world units (the border at x 25,000)', [sends().length, first.lines[0]]);
    ok(L('._visible') === true && Math.abs(L('._x') - 640) < 0.01 && Math.abs(L('._y') - 360) < 0.01 && Math.abs(Math.abs(L('._xscale')) - 12.8) < 0.01 && Math.abs(Math.abs(L('._yscale')) - 12.8) < 0.01,
      '...and the layer placed and scaled where the map shows the world (64 units at 0.002 a unit)', [L('._x'), L('._y'), L('._xscale'), L('._yscale')]);
    const turn0 = L('._rotation') + L('.shapes._rotation');
    let lagged = 0;
    for (let k = 1; k <= 12; k++) { pan = 3 * k; put(); h9.update(); if (Math.abs(L('._x') - (640 + pan)) > 0.01) lagged++; }
    ok(lagged === 0, 'panning 3 px a frame: the layer is where the markers are in the same frame, every frame', lagged);
    for (let k = 1; k <= 10; k++) { zoom = 1 + 0.02 * k; put(); h9.update(); }
    ok(Math.abs(Math.abs(L('._xscale')) - 12.8 * 1.2) < 0.01 && Math.abs(L('._x') - (640 + pan)) < 0.01, '...zooming too: scaled with the map in the same frame', [L('._xscale'), L('._x')]);
    const writes = [];
    const setFloat0 = sp.Ui.setFloat;
    sp.Ui.setFloat = (m, p, v) => { if (p.startsWith('_root.owners.layer')) writes.push(p); setFloat0(m, p, v); };
    for (let i = 0; i < 20; i++) h9.update();
    sp.Ui.setFloat = setFloat0;
    ok(!writes.length, 'a still map: the layer is not written again', writes.slice(0, 4));
    ok(sends().length === 1 && Math.abs(L('._rotation') + L('.shapes._rotation') - turn0) < 0.01, '...and through it all the colours were sent once and the layer never turned', [sends().length, L('._rotation'), L('.shapes._rotation')]);
    h9.menuClose({ name: 'MapMenu' });
    S.customOpen = false; zoom = 1; pan = 0;
  }
  // ---- the lag on a paper map with 40 anchors (Nat, 3 Nov: "super laggy" with the colours on; ~120 marker reads a frame) ----
  {
    const h12 = {};
    const saved = Object.assign({}, S.props);
    S.custom = []; S.customOpen = false; S.invoked.length = 0; S.menuOpen = true; S.props['_root.owners.layer._visible'] = false;
    const many = [];
    for (let k = 0; k < 40; k++) many.push([`Anchor ${k}`, (k % 8) * 10000 - 35000, Math.floor(k / 8) * 10000 - 20000]);
    many.forEach(([name], i) => { S.props[`_root.MarkerClips.Marker${i}.label`] = name; });
    S.props['_root.WorldMap._markerList.length'] = many.length;
    let pan = 0, zoom = 1;
    const put = () => many.forEach(([, x, y], i) => { S.props[`_root.MarkerClips.Marker${i}._x`] = 640 + pan + zoom * 0.002 * x; S.props[`_root.MarkerClips.Marker${i}._y`] = 360 - zoom * 0.002 * y; });
    put();
    new MapRealmService(sp, { on: (ev, fn) => { h12[ev] = fn; }, emitter: { on: (ev, fn) => { h12['emit:' + ev] = fn; } } });
    h12['emit:customPacketMessage']({ customPacketType: 'dboMapRealm', markers });
    h12['emit:customPacketMessage']({ customPacketType: 'dboMapOwners', worlds: [{ world: '3c:Skyrim.esm', aliases: [], flat: true, territories: [{ id: 'a', owner: 'hold-a', x: 0, y: 0 }, { id: 'b', owner: 'hold-b', x: 50000, y: 0 }] }],
      factions: { 'hold-a': { name: 'A', rgb: [200, 0, 0] }, 'hold-b': { name: 'B', rgb: [0, 200, 0] } }, anchors: many.map(([name, x, y]) => ({ name, x, y, z: 0 })), reach: 30000, fade: 45000 });
    h12.menuOpen({ name: 'MapMenu' });
    for (let i = 0; i < 80; i++) h12.update();
    const L = (p) => S.props[`_root.owners.layer${p}`];
    let reads = 0;
    const gf0 = sp.Ui.getFloat, gb0 = sp.Ui.getBool;
    sp.Ui.getFloat = (m, p) => { if (p.startsWith('_root.MarkerClips')) reads++; return gf0(m, p); };
    sp.Ui.getBool = (m, p) => { if (p.startsWith('_root.MarkerClips')) reads++; return gb0(m, p); };
    let lagged = 0;
    for (let k = 1; k <= 30; k++) { pan = 3 * k; zoom = 1 + 0.01 * k; put(); h12.update(); if (Math.abs(L('._x') - (640 + pan)) > 0.01 || Math.abs(Math.abs(L('._xscale')) - 12.8 * zoom) > 0.01) lagged++; }
    const panReads = reads / 30;
    reads = 0;
    for (let i = 0; i < 30; i++) h12.update();
    const stillReads = reads / 30;
    // a marker of the few read goes off the map: all are read again and the layer still follows
    for (let i = 0; i < 40; i++) S.props[`_root.MarkerClips.Marker${i}._visible`] = i % 2 === 0;
    pan += 5; put(); h12.update(); h12.update();
    const afterHide = Math.abs(L('._x') - (640 + pan));
    sp.Ui.getFloat = gf0; sp.Ui.getBool = gb0;
    ok(L('._visible') === true && lagged === 0, 'a 40-anchor paper map: panning and zooming, the layer follows the markers in the same frame', lagged);
    ok(panReads <= 30, '...reading only a few markers a frame while it moves, not all 40 (~124 reads): ' + panReads.toFixed(1), panReads);
    ok(stillReads <= 8, '...and on a still map two markers and their box only: ' + stillReads.toFixed(1), stillReads);
    ok(afterHide < 0.01, '...and still follows when markers it read are hidden', afterHide);
    h12.update();
    const mc = ((S.packets.slice().reverse().find((p) => p.event === 'npcDrift' && p.args[0] && p.args[0].kind === 'mapCost') || { args: [null] }).args[0]) || {};
    h12.menuClose({ name: 'MapMenu' });
    const mc2 = ((S.packets.slice().reverse().find((p) => p.event === 'npcDrift' && p.args[0] && p.args[0].kind === 'mapCost') || { args: [null] }).args[0]) || {};
    ok(mc2 !== mc && mc2.counts && mc2.counts.still > 0 && mc2.counts.fullRead > 0, '...and its mapCost line counts the still frames skipped and the full reads', mc2.counts);
    for (const k of Object.keys(S.props)) delete S.props[k];
    Object.assign(S.props, saved);
    S.customOpen = false;
  }
  // a world whose map is not flat (the 3D relief): no colours until T, and then T's choice stays for that world
  {
    const h8 = {};
    S.custom = []; S.customOpen = false; S.invoked.length = 0; S.menuOpen = true; S.props['_root.owners.layer._visible'] = false; // a fresh movie starts with its layer hidden
    new MapRealmService(sp, { on: (ev, fn) => { h8[ev] = fn; }, emitter: { on: (ev, fn) => { h8['emit:' + ev] = fn; } } });
    h8['emit:customPacketMessage']({ customPacketType: 'dboMapRealm', markers });
    h8['emit:customPacketMessage']({ customPacketType: 'dboMapOwners', worlds: [{ world: '3c:Skyrim.esm', aliases: [], territories: [{ id: 'a', owner: 'hold-a', x: 0, y: 0 }, { id: 'b', owner: 'hold-b', x: 50000, y: 0 }] }],
      factions: { 'hold-a': { name: 'A', rgb: [200, 0, 0] }, 'hold-b': { name: 'B', rgb: [0, 200, 0] } }, anchors: anchorsAt.map(([name, x, y]) => ({ name, x, y, z: 0 })), reach: 30000, fade: 45000 });
    const drawnNow = () => S.invoked.filter((x) => x[0] === '_root.dboOwners').length;
    h8.menuOpen({ name: 'MapMenu' });
    for (let i = 0; i < 70; i++) h8.update();
    const rows8 = S.legendData.length ? S.legendData[S.legendData.length - 1].rows : [];
    ok(drawnNow() === 0 && S.props['_root.owners.layer._visible'] !== true && rows8.some((r) => r.id === 'territories' && r.shown === false), 'a map that is not flat: no colours, the legend row there to turn them on', [drawnNow(), rows8.find((r) => r.id === 'territories')]);
    h8.buttonEvent({ isDown: true, device: 0, code: 20 });
    for (let i = 0; i < 4; i++) h8.update();
    ok(drawnNow() === 1 && S.props['_root.owners.layer._visible'] === true, '...T shows them there too', drawnNow());
    h8.menuClose({ name: 'MapMenu' });
    S.customOpen = false; S.invoked.length = 0;
    h8.menuOpen({ name: 'MapMenu' });
    for (let i = 0; i < 70; i++) h8.update();
    ok(drawnNow() === 1, '...and the choice stays with that world for the next opening', drawnNow());
    h8.menuClose({ name: 'MapMenu' });
    S.customOpen = false;
  }
  sp.Game = game0;
  delete sp.Ui.getBool;
  anchorsAt.forEach(([name], k) => { const i = LABELS.indexOf(name); S.props[`_root.MarkerClips.Marker${i}._x`] = 100 + i; delete S.props[`_root.MarkerClips.Marker${i}._y`]; });
  ok(!S.errors.length, 'no frame failed', S.errors);

  // ---- the safety net: our legend never outlives the map (Leader, 2 Nov: Nat's keys all swallowed, game running) ----
  {
    const h7 = {};
    S.widgets.length = 0; S.custom = []; S.customOpen = false; S.legendWorks = true; S.menuOpen = true; S.packets.length = 0;
    new MapRealmService(sp, { on: (ev, fn) => { h7[ev] = fn; }, emitter: { on: (ev, fn) => { h7['emit:' + ev] = fn; } } });
    h7['emit:customPacketMessage']({ customPacketType: 'dboMapRealm', markers });
    h7.menuOpen({ name: 'MapMenu' });
    for (let i = 0; i < 70; i++) h7.update();
    S.props['_root.dboVersion'] = 'maplegend-3';
    ok(S.customOpen, 'set-up: our legend is up over the map');
    // the engine shuts the map (a fast travel, a load) and no close event comes
    S.custom = []; S.menuOpen = false;
    h7.update();
    ok(S.customOpen, 'one tick with the map shut: nothing yet (a tick of slack)', S.custom);
    h7.update();
    ok(!S.customOpen && S.custom.some((c) => c[0] === 'close') && S.packets.some((p) => p.event === 'mapSwf'), 'two ticks: the opening is closed as if the map had said so, our legend with it, its line sent', [S.custom, S.packets.map((p) => p.event)]);
    // our legend comes up after the map has gone (openCustomMenu runs a frame or more late)
    S.custom = []; S.customOpen = true; S.props['_root.dboVersion'] = 'maplegend-3';
    h7.update(); h7.update();
    ok(!S.customOpen && JSON.stringify(S.custom) === JSON.stringify([['close']]), 'our legend open with no map is closed on the next tick', S.custom);
    // a server panel's CustomMenu with no map: not ours, left alone
    S.custom = []; S.customOpen = true; delete S.props['_root.dboVersion'];
    for (let i = 0; i < 5; i++) h7.update();
    ok(S.customOpen && !S.custom.length, 'another CustomMenu (no maplegend version) is never closed by us', S.custom);
    S.customOpen = false;
    // the open event before the map shows: the opening waits, it is not swept away
    S.custom = []; S.packets.length = 0;
    h7.menuOpen({ name: 'MapMenu' });
    for (let i = 0; i < 5; i++) h7.update();
    ok(!S.packets.some((p) => p.event === 'mapSwf'), 'an opening whose map has not shown yet is not closed by the net', S.packets.map((p) => p.event));
    S.menuOpen = true;
    for (let i = 0; i < 70; i++) h7.update();
    ok(S.customOpen, '...and its legend still opens once the map shows', S.custom);
    h7.menuClose({ name: 'MapMenu' });
    S.customOpen = false; S.menuOpen = true; delete S.props['_root.dboVersion'];
    ok(!S.errors.length, 'no frame failed', S.errors);
  }

  // ---- a label SkyUI fills late is read again (Nat, 2 Nov: stored empties left 10 of 388 counted, none of the realm's) ----
  const h5 = {};
  S.widgets.length = 0; S.custom = []; S.customOpen = false; S.legendWorks = false;
  const applewatch = S.props['_root.MarkerClips.Marker1.label'];
  S.props['_root.MarkerClips.Marker1.label'] = '';
  S.props['_root.MarkerClips.Marker6.label'] = '';
  let reads6 = 0;
  const getString0 = sp.Ui.getString;
  sp.Ui.getString = (m, p) => { if (p === '_root.MarkerClips.Marker6.label') reads6++; return getString0(m, p); };
  new MapRealmService(sp, { on: (ev, fn) => { h5[ev] = fn; }, emitter: { on: (ev, fn) => { h5['emit:' + ev] = fn; } } });
  h5['emit:customPacketMessage']({ customPacketType: 'dboMapRealm', markers });
  h5.menuOpen({ name: 'MapMenu' });
  for (let i = 0; i < 3; i++) h5.update();
  S.props['_root.MarkerClips.Marker1.label'] = applewatch;
  for (let i = 0; i < 300; i++) h5.update();
  const w5 = S.widgets.filter((x) => x.rows).slice(-1)[0];
  ok(w5 && w5.rows.find((r) => r.id === 'town').count === 1, 'a label read empty at first and filled later is counted (Applewatch, a town)', w5 && w5.rows);
  ok(reads6 === 10, 'a clip that never gets a label is read ten times, then left alone', reads6);
  sp.Ui.getString = getString0;
  S.props['_root.MarkerClips.Marker6.label'] = LABELS[6];
  h5.menuClose({ name: 'MapMenu' });

  // ---- the map probe: once a session, on the first opening ----
  const h3 = {};
  S.packets.length = 0; S.custom = []; S.customOpen = false; S.legendWorks = true;
  [0, 1, 2, 3, 4, 5].forEach((i) => { S.props[`_root.MarkerClips.Marker${i}._x`] = 300 + i; S.props[`_root.MarkerClips.Marker${i}._y`] = 200 + i; });
  new MapRealmService(sp, { on: (ev, fn) => { h3[ev] = fn; }, emitter: { on: (ev, fn) => { h3['emit:' + ev] = fn; } } });
  h3['emit:customPacketMessage']({ customPacketType: 'dboMapRealm', markers });
  h3.menuOpen({ name: 'MapMenu' });
  for (let i = 1; i <= 1200; i++) {
    // Nat pans between frames 500 and 700, with our legend menu up: the markers move, and the mouse is heard
    if (i > 500 && i < 700) { S.props['_root.MarkerClips.Marker0._x'] = 300 + i; h3.mouseMove({ inputX: 1, inputY: 0 }); }
    if (i === 600) h3.buttonEvent({ isDown: true, device: 1, code: 256 });
    h3.update();
  }
  const probes = () => S.packets.filter((p) => p.event === 'mapTest');
  const pr = (probes()[0] || { args: [{}] }).args[0];
  ok(probes().length === 1 && pr.end === 'probe done at frame 1200', 'the first opening runs the probe for twenty seconds and reports it once, as the mapTest event', S.packets);
  ok(/^POSITIONS of Bruma, Applewatch, Sancre Tor, Pale Pass, Fort Caractacus, Wraith's Barrow: at 120 [-0-9.]+,[-0-9.]+ x[0-9.]+ \| 300,200 301,201 302,202/.test(pr.t1 || ''), 'T1: the first six markers\' labels and positions at frame 120, MarkerClips\' offset first', pr.t1);
  ok(pr.t2 && pr.t2.frames === 10 && pr.t2.panning === 2 && pr.t2.still === 7, 'T2: ten samples, the markers moved between two of them (the pan) and stood still between the rest', pr.t2);
  ok(/^legend menu up \(open true, frame [0-9]+\/[0-9]+, version "[^"]*", alive "Yes"\), map open true$/.test(pr.t3 || ''), 'T3: our legend menu up over the open map at frame 360, with what its movie was doing', pr.t3);
  ok(/: 199 mouse moves, 1 clicks$/.test(pr.t4 || ''), 'T4: the mouse moves and clicks the client still heard while our menu was up', pr.t4);
  h3.menuClose({ name: 'MapMenu' });
  S.packets.length = 0;
  h3.menuOpen({ name: 'MapMenu' });
  for (let i = 0; i < 1210; i++) h3.update();
  h3.menuClose({ name: 'MapMenu' });
  ok(!probes().length, 'a second opening runs no probe');
  // closed early: what it has
  const h4 = {};
  S.packets.length = 0; S.custom = []; S.customOpen = false;
  new MapRealmService(sp, { on: (ev, fn) => { h4[ev] = fn; }, emitter: { on: (ev, fn) => { h4['emit:' + ev] = fn; } } });
  h4['emit:customPacketMessage']({ customPacketType: 'dboMapRealm', markers });
  h4.menuOpen({ name: 'MapMenu' });
  for (let i = 0; i < 300; i++) h4.update();
  h4.menuClose({ name: 'MapMenu' });
  const early = (probes()[0] || { args: [{}] }).args[0];
  ok(probes().length === 1 && /^probe the map closed early at frame 300/.test(early.end || '') && early.t2 && early.t2.frames === 2 && !S.customOpen,
    'a map closed during the probe still reports what it has, and our menu goes down with the map', [early, S.custom]);
  ok(!S.errors.length, 'no frame failed', S.errors);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e.stack || e.message)); process.exit(1); });
