// A list shown beside a game menu (alchemy.js's "You can brew"), drawn inside the Crafting Menu (swf/dbo_menulist, loaded by
// NativeMenuListService; Worker 1, 1 Nov): the swf on the stub stage, and the service bundled with its imports stubbed and
// driven against a fake menu: the list sent to the swf once it is alive, the browser when there is no crafting menu or the
// swf never comes alive, the server's close. The mutants at the end are bundled from altered copies of the service.
//   node tests/native-menulist-harness.js      (env ESBUILD_DIR, else the fork's skymp5-server esbuild)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const HERE = path.resolve(__dirname, '..');
const ESB = [process.env.ESBUILD_DIR, path.join(HERE, '../skymp5-server/node_modules/esbuild'), path.join(HERE, '../../../fork/skymp5-server/node_modules/esbuild')].find((d) => d && fs.existsSync(path.join(d, 'package.json')));
if (!ESB) { console.log('SKIP needs ESBUILD_DIR'); process.exit(0); }
const esbuild = require(ESB);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-menulist-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

// ---- the swf ----
const t = S.boot('dbo_menulist', true);
const R = t.root;
check('the swf says it is alive, its version, and locks its root (it runs inside a game menu)', R.dboAlive === 'yes' && R.dboVersion === 'menulist-1' && t.ctx._lockroot === true);
check('nothing shows before the first data', R.list._visible === false);
t.push({ title: 'You can brew (2), Novice: weak strength', lines: ['Potion of Healing: Blue Mountain Flower + Wheat', 'Potion of Stamina: Lavender + Salt Pile'] });
const B = R.list.body;
check('the title and a line each, at the right of the menu', R.list._visible === true && !!B && /You can brew \(2\)/.test(B.title.text) && /Blue Mountain Flower/.test(B.l0.text) && /Salt Pile/.test(B.l1.text) && R.list._x > 640,
  B && [B.title.text, B.l0 && B.l0.text]);
t.push({ title: 'Long', lines: Array.from({ length: 40 }, (_, i) => `Line ${i} with some words in it to wrap a little`) });
check('a long list stops before running off the menu', R.list.body.shown > 5 && R.list.body.shown < 40, R.list.body.shown);
t.push({ hide: true });
check('the server\'s close hides it', R.list._visible === false);
check('no character the game\'s font lacks', !/[^\x00-\x7f]/.test(fs.readFileSync(path.join(HERE, 'swf', 'dbo_menulist', 'scripts', 'frame_1', 'DoAction.as'), 'utf8')));

// ---- the service ----
fs.writeFileSync(path.join(TMP, 'stub.js'), `
class ClientListener {}
const Menu = { Crafting: 'Crafting Menu' };
module.exports = { ClientListener, Menu, logError: (...a) => globalThis.__ml.errors.push(a.join(' ')), logTrace: () => {} };
`);
const STUBBED = /\/(clientListener|logging)$|^skyrimPlatform$/;
const SRC = path.join(HERE, 'src/services/services/nativeMenuListService.ts');
const build = async (source, name) => {
  const out = path.join(TMP, name + '.js');
  await esbuild.build({
    entryPoints: [SRC], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (STUBBED.test(a.path) ? { path: path.join(TMP, 'stub.js') } : undefined));
      if (source) b.onLoad({ filter: /nativeMenuListService\.ts$/ }, () => ({ contents: source, loader: 'ts' }));
    } }],
  });
  return require(out).NativeMenuListService;
};

const scenarios = (Svc, c) => {
  const M = { errors: [], props: {}, invoked: [], open: false, works: true };
  globalThis.__ml = M;
  const sp = { Ui: {
    isMenuOpen: (m) => m === 'Crafting Menu' && M.open,
    getString: (m, p) => (M.props[p] === undefined ? '' : String(M.props[p])),
    invokeStringA: (m, p, a) => M.invoked.push([p, a]),
    invokeString: (m, p, arg) => { M.invoked.push([p, arg]); if (p === '_root.dboMenuList.loadMovie' && M.works) M.props['_root.dboMenuList.dboAlive'] = 'yes'; },
  } };
  const h = {};
  const svc = new Svc(sp, { on: (ev, fn) => { h[ev] = fn; } });
  const frames = (n) => { for (let i = 0; i < n; i++) h.update(); };
  const realNow = Date.now; let clock = 1000000; Date.now = () => clock;
  const list = (id, title, lines) => ({ type: 'contextMenu', id, mode: 'inspect', targetName: title, lines });
  const data = () => M.invoked.filter((x) => x[0] === '_root.dboMenuList.dboData').map((x) => JSON.parse(x[1]));
  try {
    let browser = 0;
    c('a choice menu or a focused list is not a side list', svc.offer({ type: 'contextMenu', id: 1, mode: 'menu', actions: [] }, 1, () => browser++) === false);
    // the lab opens its crafting menu right after the list arrives
    c('an inspect list is taken', svc.offer(list(71, 'You can brew (1)', ['Potion of Healing']), 71, () => browser++) === true);
    frames(2);
    c('no crafting menu yet: it waits, nothing drawn, no browser', !M.invoked.length && browser === 0);
    M.open = true;
    frames(3);
    const d = data();
    c('the crafting menu opens: dbo_menulist is loaded into it and, alive, gets the list once', M.invoked.some((x) => x[0] === '_root.createEmptyMovieClip' && x[1][0] === 'dboMenuList') && d.length === 1 && d[0].title === 'You can brew (1)' && d[0].lines[0] === 'Potion of Healing' && browser === 0);
    svc.offer(list(71, 'You can brew (2)', ['Potion of Healing', 'Potion of Stamina']), 71, () => browser++);
    frames(1);
    c('the server sends it again (a new ingredient): the menu\'s list follows', data().length === 2 && data()[1].lines.length === 2 && browser === 0);
    svc.close(71);
    c('the server\'s close hides it in the menu', data().length === 3 && data()[2].hide === true);
    // no crafting menu at all: the browser after WAIT_MS
    M.open = false; h.menuClose({ name: 'Crafting Menu' });
    svc.offer(list(72, 'Elsewhere', ['x']), 72, () => browser++);
    clock += 3001; frames(1);
    c('a list with no crafting menu to sit in for 3 s goes to the browser', browser === 1);
    // a swf that never comes alive: the browser, for the rest of the session
    M.open = true; M.works = false; delete M.props['_root.dboMenuList.dboAlive'];
    svc.offer(list(73, 'You can brew', ['y']), 73, () => browser++);
    frames(62);
    c('a swf that never comes alive in the menu: the browser draws the list', browser === 2);
    c('...and the session gives up on it: the next list is not taken', svc.offer(list(74, 'Again', ['z']), 74, () => browser++) === false);
    c('no frame failed', !M.errors.length);
  } finally { Date.now = realNow; }
};

(async () => {
  const Live = await build(null, 'live');
  let bad = 0;
  scenarios(Live, (what, ok) => { check(what, ok); if (!ok) bad++; });
  const source = fs.readFileSync(SRC, 'utf8');
  const MUTANTS = [
    ['the list is sent every frame', '      if (this.load.phase === "up" && !l.sent) {', '      if (this.load.phase === "up") {'],
    ['no wait for the crafting menu', 'if (this.load.phase !== "up" && Date.now() - l.at > WAIT_MS) this.toBrowser(l, "no crafting menu to sit in");', 'this.toBrowser(l, "no crafting menu to sit in");'],
    ['the close does not hide it', 'JSON.stringify({ hide: true })', 'JSON.stringify({ title: "" })'],
    ['a choice menu is taken', 'w["mode"] !== "inspect" || ', ''],
  ];
  for (let i = 0; i < MUTANTS.length; i++) {
    const [name, a, b] = MUTANTS[i];
    if (!source.includes(a)) { check(`mutant "${name}": its line is in the service`, false, a); continue; }
    let fails = 0;
    try { scenarios(await build(source.replace(a, b), `m${i}`), (w, ok) => { if (!ok) fails++; }); } catch (e) { fails++; }
    check(`mutant caught: ${name}`, fails > 0);
  }
  T.done();
})().catch((e) => { console.log('FAIL ' + (e.stack || e.message)); process.exit(1); });
