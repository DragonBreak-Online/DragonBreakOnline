// sprstrip.js (Nate, 11 Oct 2026): every Dawnguard War Axe SPR is removed from characters and listed containers, and
// its smith (actor ff000574, profile 78) gets 1 Iron Ingot, 2 Steel Ingots and 1 Leather Strips back per copy removed,
// up to maxRefunds, at once or at his next login. Loads the real sprstrip.js and gamemode-config.json against a fake mp.
//   node tests/sprstrip-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const CFG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
const MOD = path.join(SERVER, 'sprstrip.js');
const AXE = 0xfe014f0d, IRON = 0x5ace4, STEEL = 0x5ace5, LEATHER = 0x800e4, OTHER = 0x12eb7;
const SMITH = 0xff000574, P1 = 0xff000600, P2 = 0xff000601, BOX1 = 0x0800118c, BOX2 = 0x082d9e0;
const DESC = { "f0d:JK's Fort Dawnguard.esp": AXE, '5ace4:Skyrim.esm': IRON, '5ace5:Skyrim.esm': STEEL, '800e4:Skyrim.esm': LEATHER, '118c:BSHeartland.esm': BOX1, '2d9e0:BSHeartland.esm': BOX2 };

const tmp = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-sprstrip-'));
const world = () => {
  const props = new Map(); const papyrus = []; const audits = []; const said = [];
  const set = (id, k, v) => { if (!props.has(id)) props.set(id, {}); props.get(id)[k] = JSON.parse(JSON.stringify(v)); };
  const get = (id, k) => { const p = props.get(id); if (!p || !(k in p)) { if (k === 'inventory') throw new Error('not loaded'); return undefined; } return JSON.parse(JSON.stringify(p[k])); };
  return { props, papyrus, audits, said, set, get };
};
const load = (W, online, cfg) => {
  delete require.cache[MOD];
  let timer = null;
  const giveItem = (a, id, n) => { const inv = W.get(a, 'inventory') || { entries: [] }; const e = inv.entries.find((x) => x.baseId === id); if (e) e.count += n; else inv.entries.push({ baseId: id, count: n }); W.set(a, 'inventory', inv); return true; };
  require(MOD)({
    mp: { get: W.get, set: W.set, getIdFromDesc: (d) => { if (!(d in DESC)) throw new Error('no ' + d); return DESC[d]; }, getDescFromId: (id) => id.toString(16), callPapyrusFunction: (...a) => W.papyrus.push(a) },
    log: () => {}, personal: (a, t) => W.said.push([a, t]), audit: (t) => W.audits.push(t), who: (a) => a.toString(16),
    onlineActors: () => online.slice(), every: (n, ms, fn) => { timer = fn; }, stopTimer: () => { timer = null; }, giveItem,
    cfg: { sprStrip: Object.assign({}, CFG.sprStrip, { stateFile: path.join(tmp, 'state.json') }, cfg || {}) }
  });
  return () => timer && timer();
};
const count = (W, id, base) => ((W.get(id, 'inventory') || { entries: [] }).entries.filter((e) => e.baseId === base).reduce((n, e) => n + e.count, 0));

// config shipped
ok(CFG.sprStrip && CFG.sprStrip.enabled === true, 'gamemode-config sprStrip.enabled is true');
ok(CFG.sprStrip.maxRefunds === 13 && CFG.sprStrip.smith.actor === 'ff000574' && CFG.sprStrip.smith.profile === 78, 'smith ff000574 / profile 78, 13 refunds at most');
ok(JSON.stringify(CFG.sprStrip.refund.map((r) => [r[0], r[1]])) === JSON.stringify([['5ace4:Skyrim.esm', 1], ['5ace5:Skyrim.esm', 2], ['800e4:Skyrim.esm', 1]]), 'refund is the COBJ afe recipe');
const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
ok(/__dboGearSwapLogin\(a\);[^\n]*\n\s*try \{ if \(globalThis\.__dboSprStripLogin\) globalThis\.__dboSprStripLogin\(a\)/.test(gm), 'gamemode.js: login hook after the gear swap');
ok(/__dboGearSwapContainer\(targetId >>> 0\);\n\s*try \{ if \(globalThis\.__dboSprStripContainer\) globalThis\.__dboSprStripContainer\(targetId >>> 0\)/.test(gm), 'gamemode.js: container hook in the activate chain');
ok(/require\(SPRSTRIP_JS\)\(\{[^}]*giveItem[^}]*\}\)/.test(gm), 'gamemode.js loads sprstrip.js with giveItem');
ok(fs.readFileSync(path.join(SERVER, '.gitignore'), 'utf8').includes('sprstrip-state.json'), 'state file is gitignored');

// online strip: a worn copy and a carried one; other items untouched; the smith offline -> refund owed
let W = world();
W.set(P1, 'profileId', 101); W.set(P1, 'inventory', { entries: [{ baseId: AXE, count: 1, worn: true }, { baseId: OTHER, count: 3 }] });
W.set(P1, 'private.lastWorn', [AXE, OTHER]);
W.set(P2, 'profileId', 131); W.set(P2, 'inventory', { entries: [{ baseId: AXE, count: 2 }] });
W.set(SMITH, 'profileId', 78); W.set(SMITH, 'inventory', { entries: [{ baseId: AXE, count: 1, worn: true }] });
W.set(BOX1, 'inventory', { entries: [{ baseId: AXE, count: 1 }, { baseId: OTHER, count: 1 }] });
let sweep = load(W, [P1, P2]);
sweep();
ok(count(W, P1, AXE) === 0 && count(W, P2, AXE) === 0, 'online holders lose every axe');
ok(count(W, P1, OTHER) === 3, 'nothing else in the inventory is touched');
ok(W.papyrus.some((c) => c[2] === 'UnequipItem' && c[3].desc === P1.toString(16)), 'a worn axe is unequipped first');
ok(!W.papyrus.some((c) => c[3].desc === P2.toString(16)), 'a carried axe needs no unequip');
ok(JSON.stringify(W.get(P1, 'private.lastWorn')) === JSON.stringify([OTHER]), 'the remembered outfit drops the axe');
ok(count(W, BOX1, AXE) === 0 && count(W, BOX1, OTHER) === 1, 'listed container loses the axe only');
ok(W.said.filter(([a]) => a === P1 || a === P2).length === 2, 'each holder is told once');
let st = JSON.parse(fs.readFileSync(path.join(tmp, 'state.json'), 'utf8'));
ok(st.removed === 4 && st.owed === 4 && st.refunded === 0, 'state: 4 removed, 4 owed, none refunded (smith offline)', st);
ok(count(W, SMITH, IRON) === 0, 'an offline smith is not paid yet');

// reload: nothing counted twice
sweep = load(W, [P1, P2]); sweep();
st = JSON.parse(fs.readFileSync(path.join(tmp, 'state.json'), 'utf8'));
ok(st.removed === 4 && st.owed === 4, 'a reload and a second sweep count nothing twice', st);

// the smith logs in: his own (worn) axe goes, and he is paid for 5
globalThis.__dboSprStripLogin(SMITH);
ok(count(W, SMITH, AXE) === 0, "the smith's own axe goes too");
ok(count(W, SMITH, IRON) === 5 && count(W, SMITH, STEEL) === 10 && count(W, SMITH, LEATHER) === 5, 'refund: 5 Iron, 10 Steel, 5 Leather Strips for 5 copies', [count(W, SMITH, IRON), count(W, SMITH, STEEL), count(W, SMITH, LEATHER)]);
globalThis.__dboSprStripLogin(SMITH);
ok(count(W, SMITH, IRON) === 5, 'a second login pays nothing more');
ok(W.said.some(([a, t]) => a === SMITH && /materials back for 5/.test(t)), 'the smith is told what came back');

// a container opened later (not listed) is stripped as it opens; the smith online is paid on the next sweep
W.set(BOX2, 'inventory', { entries: [{ baseId: AXE, count: 2 }] });
globalThis.__dboSprStripContainer(BOX2);
ok(count(W, BOX2, AXE) === 0, 'an opened container is stripped');
sweep = load(W, [SMITH]); sweep();
ok(count(W, SMITH, IRON) === 7, 'the online smith is paid for the 2 new copies on the next sweep', count(W, SMITH, IRON));

// a profile-78 character that is not the smith's actor gets nothing; a wrong profile on the smith's id neither
const ALT = 0xff000700; W.set(ALT, 'profileId', 78); W.set(ALT, 'inventory', { entries: [] });
st = JSON.parse(fs.readFileSync(path.join(tmp, 'state.json'), 'utf8'));
globalThis.__dboSprStripLogin(ALT);
ok(count(W, ALT, IRON) === 0, "the smith's other character is not paid");

// cap: 20 more copies removed, refunds stop at 13 in all
W.set(P1, 'inventory', { entries: [{ baseId: AXE, count: 20 }] });
globalThis.__dboSprStripLogin(P1);
st = JSON.parse(fs.readFileSync(path.join(tmp, 'state.json'), 'utf8'));
ok(st.removed === 27 && st.owed === 13, 'refunds owed stop at maxRefunds (13)', st);
globalThis.__dboSprStripLogin(SMITH);
ok(count(W, SMITH, IRON) === 13 && count(W, SMITH, STEEL) === 26, 'the smith is paid 13 copies in all, never more', count(W, SMITH, IRON));

// a container not yet loaded is left for later; disabled = no hooks
W.props.delete(BOX1);
let threw = false; try { load(W, [])(); } catch (e) { threw = true; }
ok(!threw, 'an unloaded listed container is skipped quietly');
load(W, [], { enabled: false });
ok(globalThis.__dboSprStripLogin === null && globalThis.__dboSprStripContainer === null, 'enabled false removes the hooks');

// pure helper
const { without } = require(MOD);
const w = without([{ baseId: AXE, count: 2, wornLeft: true }, { baseId: OTHER, count: 1 }], AXE);
ok(w.removed === 2 && w.worn === true && w.entries.length === 1, 'without(): counts, finds a left-hand worn copy, keeps the rest');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
