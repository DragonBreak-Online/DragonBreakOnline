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
const InputDeviceType = { Keyboard: 0 };
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
      getInt: (m, p) => S.props[p] | 0, getString: (m, p) => (S.props[p] === undefined ? '' : String(S.props[p])), getFloat: (m, p) => Number(S.props[p] === undefined ? 100 : S.props[p]),
      setFloat: (m, p, v) => { S.props[p] = v; }, invokeStringA: (m, p, a) => { S.invoked.push([p, a]); if (p === '_root.createEmptyMovieClip') S.props[`_root.${a[0]}._name`] = a[0]; },
      // the legend swf (dbo_maplegend): alive after its loadMovie only when S.legendWorks; its dboData is recorded
      invokeString: (m, p, arg) => {
        S.invoked.push([p, [arg]]);
        if (p === '_root.dboMapLegend.loadMovie' && S.legendWorks) S.props['_root.dboMapLegend.dboAlive'] = 'yes';
        if (p === '_root.dboMapLegend.dboData') S.legendData.push(JSON.parse(arg));
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

  // ---- a legend swf that never comes alive in the map: the browser draws the legend, as before ----
  h.menuOpen({ name: 'MapMenu' });
  frames(2);
  ok(S.invoked.some((x) => x[0] === '_root.createEmptyMovieClip' && x[1][0] === 'dboMapLegend') && S.invoked.some((x) => x[0] === '_root.dboMapLegend.loadMovie' && x[1][0] === 'dbo_maplegend.swf'),
    'opening the map loads dbo_maplegend into a clip of the map', S.invoked);
  ok(!S.widgets.length && !S.visible.length, 'while it loads, no browser legend and the browser left hidden', [S.widgets, S.visible]);
  frames(60);
  ok(S.visible.length >= 1 && S.visible.every((v) => v === true), 'one that never comes alive in a second: the browser is shown for the map', S.visible);
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
  h.menuClose({ name: 'MapMenu' });
  ok(S.widgets[S.widgets.length - 1].closed === 210, 'closing the map closes the legend');
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
  ok(S.packets.length === 1 && S.packets[0].args[0].end === 'the map closed', 'closing the map early still reports, and says why');
  ok(!S.legendData.length, 'a legend that failed this session is never sent to the map', S.legendData.length);
  ok(!S.errors.length, 'no frame failed', S.errors);

  // ---- a legend swf that comes alive: the map draws the legend, and the browser stays out of it ----
  const h2 = {};
  S.widgets.length = 0; S.visible.length = 0; S.invoked.length = 0; S.legendData.length = 0; S.legendWorks = true;
  delete S.props['_root.dboMapLegend.dboAlive'];
  LABELS.forEach((l, i) => { S.props[`_root.MarkerClips.Marker${i}._xscale`] = 100; });
  new MapRealmService(sp, { on: (ev, fn) => { h2[ev] = fn; }, emitter: { on: (ev, fn) => { h2['emit:' + ev] = fn; } } });
  h2['emit:customPacketMessage']({ customPacketType: 'dboMapRealm', markers });
  h2.menuOpen({ name: 'MapMenu' });
  for (let i = 0; i < 4; i++) h2.update();
  const last = () => S.legendData[S.legendData.length - 1];
  ok(S.legendData.length >= 1 && last().shown === true && last().rows.find((r) => r.id === 'fort').count === 2 && last().rows.map((r) => r.key).join('') === '1234560',
    'alive: the legend goes to the swf in the map, the same rows and counts', last());
  ok(!S.widgets.length && !S.visible.length, '...and no browser legend, the browser left hidden', [S.widgets, S.visible]);
  h2.buttonEvent({ isDown: true, device: 0, code: 5 });
  ok(last().rows.find((r) => r.id === 'fort').shown === false, 'a digit greys its kind in the map\'s legend');
  h2.buttonEvent({ isDown: true, device: 0, code: 19 });
  ok(last().shown === false, 'R hides the map\'s legend');
  h2.menuClose({ name: 'MapMenu' });
  delete S.props['_root.dboMapLegend.dboAlive'];
  S.invoked.length = 0;
  h2.menuOpen({ name: 'MapMenu' });
  for (let i = 0; i < 4; i++) h2.update();
  ok(S.invoked.filter((x) => x[0] === '_root.dboMapLegend.loadMovie').length === 1 && !S.widgets.length, 'the next opening loads it into the new map again');
  ok(!S.errors.length, 'no frame failed', S.errors);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e.stack || e.message)); process.exit(1); });
