// Scripted test: what the client does with a server change to the player's pack while a container window is open (#bugs 15 Oct
// "Duplication with vampires": silver taken from a chest was mailed while the chest was open, and putting it back showed it in
// the chest and in the mailbox; ghost items from a take the server refused). The real remoteServer.ts (its update loop and
// SetInventory handler), ContainersService and sync/inventory.ts are bundled with esbuild against a fake game and a fake server
// with a round trip; every other import is an inert stub. Run from skymp5-client:
//
//   node tests/container-menu-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP container-menu (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const SRC = path.resolve(__dirname, '../src');
// Bundled as they are; every other import is a stub
const REAL = new Set(['services/services/remoteServer.ts', 'services/services/containersService.ts', 'services/services/lastInvService.ts',
  'sync/inventory.ts', 'sync/ghostItems.ts', 'sync/propertyKey.ts', 'sync/equipment.ts', 'sync/containerMenuWatch.ts', 'messages.ts']);
const STUBS = {
  skyrimPlatform: `const h = () => globalThis.__h; module.exports = {
    on: (n, f) => h().on(n, f), once: (n, f) => h().once(n, f), get storage() { return h().storage; },
    printConsole() {}, createEnchantment: undefined,
    Game: { getPlayer: () => h().player, getFormEx: (id) => h().form(id), getForm: (id) => h().form(id) },
    Ui: { isMenuOpen: (m) => h().menus.has(m) },
    Input: { tapKey: (k) => h().tapKey(k) },
    DxScanCode: { Tab: 15, Escape: 1 },
    Debug: { notification: (t) => h().notes.push(t) },
    Utility: { wait: () => Promise.resolve(), waitMenuMode: () => Promise.resolve() },
    TESModPlatform: { addItemEx: (...a) => h().addItemEx(...a), resetContainer() {}, pushWornState() {} },
    getExtraContainerChanges: (id) => h().changes(id), getContainer: () => [],
    FormType: { Ingredient: 30, Misc: 32, Weapon: 41, Ammo: 42, Potion: 46, Container: 28, Furniture: 40, Flora: 39, Tree: 38 },
    Actor: { from: (x) => x || null }, ObjectReference: Object.assign(function ObjectReference() {}, { from: (x) => x || null }), Ammo: { from: () => null },
    Weapon: { from: () => null }, Potion: { from: () => null }, Enchantment: { from: () => null }, Form: class {},
  };`,
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  appearance: 'module.exports = { baseIsPlayers: (r) => !!r && r.getFormID() === 0x14 };',
  worldViewMisc: 'module.exports = { localIdToRemoteId: (id) => id >>> 0, remoteIdToLocalId: (id) => id >>> 0, getObjectReference: () => null, getViewFromStorage: () => null, isHostedByMe: () => false };',
};
const STUB_OF = { skyrimPlatform: 'skyrimPlatform', './clientListener': 'clientListener', '../../sync/appearance': 'appearance',
  './appearance': 'appearance', '../../view/worldViewMisc': 'worldViewMisc' };

// A value that is every function, object and class at once, for imports the tested paths never use
const ANY = `const any = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' || k === '__esModule' ? undefined : k === 'prototype' ? {} : any),
  apply: () => any, construct: () => any });`;
const importedNames = (importer, spec) => {
  const src = fs.readFileSync(importer, 'utf8');
  const names = new Set();
  const esc = spec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  for (const m of src.matchAll(new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${esc}['"]`, 'g'))) {
    for (const part of m[1].split(',')) {
      const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
    }
  }
  return [...names];
};

async function build(outDir) {
  const out = path.join(outDir, 'bundle.js');
  await esbuild.build({
    stdin: {
      contents: `export * from './src/services/services/remoteServer';
        export { ContainersService } from './src/services/services/containersService';
        export { LastInvService } from './src/services/services/lastInvService';
        export { MsgType } from './src/messages';`,
      resolveDir: path.resolve(__dirname, '..'), loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => {
        if (STUB_OF[a.path]) return { path: STUB_OF[a.path], namespace: 'stub' };
        if (!a.importer || a.importer === '<stdin>' || !a.path.startsWith('.')) return undefined;
        const file = path.resolve(path.dirname(a.importer), a.path);
        const rel = path.relative(SRC, file).split(path.sep).join('/');
        for (const ext of ['.ts', '/index.ts']) if (REAL.has(rel + ext)) return { path: file + ext };
        return { path: `${a.importer}::${a.path}`, namespace: 'auto' };
      });
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'auto' }, (a) => {
        const [importer, spec] = a.path.split('::');
        const names = importedNames(importer, spec);
        return { contents: `${ANY}\nmodule.exports = { ${names.map((n) => `${n}: any`).join(', ')} };`, loader: 'js' };
      });
    } }],
  });
  return out;
}

const PLAYER = 0x14, CHEST = 0x0010a2b4;
const GOLD = 0xf, SILVER_SWORD = 0x10aa19, IRON_SWORD = 0x12eb7, SALT = 0x34cdf, ARROW = 0x1397d, TORCH = 0x1d4ec, NOTE = 0x9fe07;
const ITEMS = { [GOLD]: [32, 'Gold'], [SILVER_SWORD]: [41, 'Silver Sword'], [IRON_SWORD]: [41, 'Iron Sword'], [SALT]: [30, 'Salt Pile'],
  [ARROW]: [42, 'Iron Arrow'], [TORCH]: [31, 'Torch'], [NOTE]: [32, 'A Note'] };

// One session: a fake game (the player's pack, the open menus, the frame loop) and a fake server one round trip away
function session(bundlePath, { pingMs = 100, serverPack = {}, refuse = () => false } = {}) {
  let now = 1792200000000;
  Date.now = () => now;
  const pack = new Map(Object.entries(serverPack).map(([k, v]) => [Number(k), v]));
  const chest = new Map();
  const server = { pack: new Map(pack), chest: new Map() };
  const menus = new Set();
  const updates = [];
  let onceQueue = [];
  const timeline = [];
  const at = (t, fn) => timeline.push({ t, fn });
  const forms = new Map();
  const form = (id) => {
    id >>>= 0;
    if (id === PLAYER) return player;
    if (id === CHEST) return chestRef;
    const it = ITEMS[id];
    if (!it) return null;
    if (!forms.has(id)) forms.set(id, { getFormID: () => id, getType: () => it[0], getName: () => it[1], isPlayable: () => true });
    return forms.get(id);
  };
  const writesInMenu = [];
  const ITEM_MENUS = ['ContainerMenu', 'BarterMenu', 'GiftMenu'];
  const write = (what) => { const m = ITEM_MENUS.find((x) => menus.has(x)); if (m) writesInMenu.push(`${m}: ${what}`); };
  const player = {
    getFormID: () => PLAYER, isEquipped: () => false, modActorValue() {}, equipItem() {},
    getItemCount: (f) => pack.get(f.getFormID()) || 0,
    removeItem: (f, n) => { write(`removeItem ${f.getFormID().toString(16)}`); pack.set(f.getFormID(), Math.max(0, (pack.get(f.getFormID()) || 0) - n)); },
    addItem: (f, n) => { write(`addItem ${f.getFormID().toString(16)}`); pack.set(f.getFormID(), (pack.get(f.getFormID()) || 0) + n); },
  };
  const chestRef = { getFormID: () => CHEST };
  const taps = [];
  const notes = [];
  const diag = [];
  globalThis.__dboDiagNote = (kind, text) => diag.push(`${kind}: ${text}`);
  globalThis.__h = {
    storage: {}, player, menus, notes, form,
    on: (n, f) => { if (n === 'update') updates.push(f); },
    once: (n, f) => { if (n === 'update') onceQueue.push(f); },
    tapKey: (k) => { taps.push({ k, t: now }); if (k === 15 && menus.has('ContainerMenu')) menus.delete('ContainerMenu'); },
    changes: (id) => (id === PLAYER ? [...pack].filter(([, n]) => n > 0).map(([baseId, countDelta]) => ({ baseId, countDelta, extendDataList: [] })) : []),
    addItemEx: (refr, f, count) => {
      if (refr.getFormID() !== PLAYER) return;
      write(`addItemEx ${f.getFormID().toString(16)} ${count}`);
      pack.set(f.getFormID(), Math.max(0, (pack.get(f.getFormID()) || 0) + count));
    },
  };

  delete require.cache[require.resolve(bundlePath)];
  const B = require(bundlePath);
  const emitterHandlers = {};
  const ctrlHandlers = {};
  const listeners = new Map();
  const sweet = { canDropOrPutItem: () => true };
  const controller = {
    emitter: {
      on: (n, f) => { (emitterHandlers[n] = emitterHandlers[n] || []).push(f); },
      emit: (n, e) => { if (n === 'sendMessage') toServer(e.message); (emitterHandlers[n] || []).forEach((f) => f(e)); },
    },
    on: (n, f) => { (ctrlHandlers[n] = ctrlHandlers[n] || []).push(f); },
    once: (n, f) => { if (n === 'update') onceQueue.push(f); },
    lookupListener: (ctor) => listeners.get(ctor) || sweet,
  };
  const sp = { Game: { getPlayer: () => player, getFormEx: form } };
  listeners.set(B.LastInvService, new B.LastInvService(sp, controller));
  listeners.set(B.ContainersService, new B.ContainersService(sp, controller));
  new B.RemoteServer(sp, controller);

  const sendPack = () => {
    const entries = [...server.pack].filter(([, n]) => n > 0).map(([baseId, count]) => ({ baseId, count }));
    (emitterHandlers.setInventoryMessage || []).forEach((f) => f({ message: { t: B.MsgType.SetInventory, inventory: { entries } } }));
  };
  const sent = [];
  // The server moves the item unless it refuses; either way it sends the pack back (itemguards.js resyncs a refused move)
  function toServer(m) {
    if (m.t !== B.MsgType.TakeItem && m.t !== B.MsgType.PutItem) return;
    sent.push({ t: m.t === B.MsgType.TakeItem ? 'take' : 'put', baseId: m.baseId, count: m.count });
    at(now + pingMs / 2, () => {
      const take = m.t === B.MsgType.TakeItem;
      const from = take ? server.chest : server.pack, to = take ? server.pack : server.chest;
      const ok = !refuse(m) && (from.get(m.baseId) || 0) >= m.count;
      if (ok) { from.set(m.baseId, from.get(m.baseId) - m.count); to.set(m.baseId, (to.get(m.baseId) || 0) + m.count); }
      at(now + pingMs / 2, sendPack);
    });
  }
  const frame = () => {
    const q = onceQueue; onceQueue = [];
    q.forEach((f) => f());
    updates.forEach((f) => f());
  };
  const run = (ms, step = 16) => {
    const end = now + ms;
    while (now < end) {
      now += step;
      timeline.sort((a, b) => a.t - b.t);
      while (timeline.length && timeline[0].t <= now) timeline.shift().fn();
      frame();
    }
  };
  // The engine moves the item at once and reports it a frame later
  const move = (baseId, n, playerGave) => {
    const fromMap = playerGave ? pack : chest, toMap = playerGave ? chest : pack;
    fromMap.set(baseId, (fromMap.get(baseId) || 0) - n);
    toMap.set(baseId, (toMap.get(baseId) || 0) + n);
    const e = { oldContainer: playerGave ? player : chestRef, newContainer: playerGave ? chestRef : player, baseObj: form(baseId), numItems: n, reference: null };
    onceQueue.push(() => (ctrlHandlers.containerChanged || []).forEach((f) => f(e)));
  };
  return {
    get now() { return now; }, pack, chest, server, menus, taps, notes, diag, writesInMenu, sent, run,
    sendPackNow: sendPack,
    serverAt: (ms, fn) => at(now + ms, fn),
    // The server writes the container's contents when it opens (MpObjectReference::ProcessActivate); the game shows them
    openChest: (contents) => {
      for (const [id, n] of Object.entries(contents)) { server.chest.set(Number(id), n); chest.set(Number(id), n); }
      menus.add('ContainerMenu');
    },
    take: (id, n = 1) => move(id, n, false),
    put: (id, n = 1) => move(id, n, true),
    closeByPlayer: () => menus.delete('ContainerMenu'),
    serverMail: (id) => { server.pack.delete(id); sendPack(); },
    count: (id) => pack.get(id) || 0,
    tabbed: () => taps.some((t) => t.k === 15),
  };
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'container-menu-'));
  process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
  const bundle = await build(tmp);

  // 1. SkaldsChosen (#bugs 15 Oct): a vampire takes a silver sword; 2 s later, chest still open, the server mails it away
  {
    const s = session(bundle, { serverPack: { [GOLD]: 100 } });
    s.sendPackNow(); s.run(200);
    s.openChest({ [SILVER_SWORD]: 1, [SALT]: 3 }); s.run(300);
    s.take(SILVER_SWORD); s.run(2000);
    check('the take reaches the server and its pack comes back with the sword', s.server.pack.get(SILVER_SWORD) === 1 && s.count(SILVER_SWORD) === 1, [...s.server.pack]);
    const mailedAt = s.now;
    s.serverMail(SILVER_SWORD);
    s.run(4000);
    const closedAt = (s.taps.find((t) => t.k === 15) || {}).t;
    check('within 4 s of the server mailing it, the client closes the chest window (the pack is not written under it)', !!closedAt && closedAt - mailedAt <= 4000 && !s.menus.has('ContainerMenu'),
      { tabbed: s.taps, open: s.menus.has('ContainerMenu') });
    check('...so the mailed sword is gone from the pack at once, not left there to be put back', s.count(SILVER_SWORD) === 0, s.count(SILVER_SWORD));
    check('the player is told why the window closed, once', s.notes.length === 1 && /pack changed/.test(s.notes[0] || ''), s.notes);
    check('a dboDiag containerResync line names the item', s.diag.some((d) => d.startsWith('containerResync') && d.includes(SILVER_SWORD.toString(16))), s.diag);
    if (s.menus.has('ContainerMenu')) {
      // The old client: the window stays open and the sword can be put back; the chest shows it and the server refuses the put
      s.put(SILVER_SWORD); s.run(1000);
      check('(old client) the put of the mailed sword is refused by the server', (s.server.chest.get(SILVER_SWORD) || 0) === 0);
      check('(old client) ...yet the chest window now shows it, while the mailbox holds the real one', s.chest.get(SILVER_SWORD) === 1, [...s.chest]);
      s.closeByPlayer(); s.run(6000);
    }
    check('the pack is never written while the chest window is open', s.writesInMenu.length === 0, s.writesInMenu);
    check('after the window closes the pack holds what the server holds', s.count(SILVER_SWORD) === 0 && s.count(GOLD) === 100, [...s.pack]);
  }

  // 2. A take the server refuses (the chest showed an item the server's chest does not hold): set right at once
  {
    const s = session(bundle, { serverPack: { [GOLD]: 50 }, refuse: (m) => m.baseId === ARROW });
    s.sendPackNow(); s.run(200);
    s.openChest({ [ARROW]: 0 }); s.chest.set(ARROW, 818); s.run(300);
    s.take(ARROW, 818); s.run(5000);
    check('a refused take: the window is closed within 5 s and the 818 ghost arrows leave the pack', s.tabbed() && s.count(ARROW) === 0, { tabbed: s.taps, arrows: s.count(ARROW) });
    if (s.menus.has('ContainerMenu')) { s.closeByPlayer(); s.run(6000); }
    check('...and the pack ends where the server has it', s.count(ARROW) === 0 && s.count(GOLD) === 50, [...s.pack]);
    check('...never written under the open window', s.writesInMenu.length === 0, s.writesInMenu);
  }

  // 3. Ordinary looting at 300 ms ping: takes, a put back and three moves in one frame never close the window
  {
    const s = session(bundle, { pingMs: 300, serverPack: { [GOLD]: 10, [TORCH]: 1 } });
    s.sendPackNow(); s.run(400);
    s.openChest({ [IRON_SWORD]: 2, [SALT]: 5, [GOLD]: 25, [ARROW]: 12 }); s.run(500);
    s.take(IRON_SWORD); s.run(400);
    s.take(SALT, 5); s.run(150);
    s.put(IRON_SWORD); s.run(250);
    s.put(TORCH); s.run(100);
    s.take(GOLD, 25); s.take(ARROW, 12); s.take(IRON_SWORD, 2); s.run(10000);
    check('ordinary looting with a 300 ms round trip never closes the window', !s.tabbed() && s.menus.has('ContainerMenu'), s.taps);
    check('...and the server agrees with the game on every item', [GOLD, IRON_SWORD, SALT, ARROW, TORCH].every((id) => (s.server.pack.get(id) || 0) === s.count(id)),
      [GOLD, IRON_SWORD, SALT, ARROW, TORCH].map((id) => [id.toString(16), s.server.pack.get(id) || 0, s.count(id)]));
    check('...no notification', s.notes.length === 0, s.notes);
  }

  // 4. A slow link (1.2 s each way): the server's late answer is waited for, not taken for a removal
  {
    const s = session(bundle, { pingMs: 2400, serverPack: { [GOLD]: 10 } });
    s.sendPackNow(); s.run(3000);
    s.openChest({ [IRON_SWORD]: 1 }); s.run(300);
    s.take(IRON_SWORD); s.run(12000);
    check('a 2.4 s round trip does not close the window', !s.tabbed() && s.count(IRON_SWORD) === 1, { taps: s.taps, sword: s.count(IRON_SWORD) });
  }

  // 5. An item a game script adds while the window is open (never taken here, the server never had it): left to the next apply
  {
    const s = session(bundle, { serverPack: { [GOLD]: 10 } });
    s.sendPackNow(); s.run(200);
    s.openChest({ [SALT]: 1 }); s.run(300);
    s.pack.set(NOTE, 1); s.take(SALT); s.run(8000);
    check('a local-only item that was never taken does not close the window', !s.tabbed(), s.taps);
  }

  // 6. The window opened while a pickup was still on its way to the server, and the server later took that item away
  {
    const s = session(bundle, { serverPack: { [GOLD]: 10 } });
    s.sendPackNow(); s.run(200);
    s.pack.set(SILVER_SWORD, 1); s.server.pack.set(SILVER_SWORD, 1);
    s.openChest({ [SALT]: 1 }); s.run(50);
    s.sendPackNow(); s.run(3000);
    s.serverMail(SILVER_SWORD); s.run(4000);
    check('a pickup still in flight at the opening does not hide a later removal of it', s.tabbed() && s.count(SILVER_SWORD) === 0, { taps: s.taps, sword: s.count(SILVER_SWORD) });
  }

  // 7. A copy the apply cannot remove was already there at the opening: no close for it, however often the server answers
  {
    const s = session(bundle, { serverPack: { [GOLD]: 10, [IRON_SWORD]: 1 } });
    s.sendPackNow(); s.run(200);
    s.pack.set(IRON_SWORD, 2);
    s.openChest({ [IRON_SWORD]: 1 }); s.run(300);
    s.take(IRON_SWORD); s.run(8000);
    check('an excess the game showed before the window opened does not close it', !s.tabbed(), s.taps);
  }

  // 8. The barter and gift windows list the pack too: the server's pack waits for them to close, as for the container window
  for (const menu of ['BarterMenu', 'GiftMenu']) {
    const s = session(bundle, { serverPack: { [GOLD]: 100, [IRON_SWORD]: 1 } });
    s.sendPackNow(); s.run(200);
    s.menus.add(menu); s.run(300);
    s.server.pack.set(GOLD, 40); s.server.pack.delete(IRON_SWORD); s.sendPackNow(); s.run(8000);
    check(`the pack is not written while ${menu} is open`, s.writesInMenu.length === 0, s.writesInMenu);
    s.menus.delete(menu); s.run(500);
    check(`...and the server's pack is applied once ${menu} closes`, s.count(GOLD) === 40 && s.count(IRON_SWORD) === 0, [...s.pack]);
  }

  // 9. A take the server accepts and then lowers (dungeons.js hands a party its share of a chest's gold 50 ms later): by design
  // the window closes, so the shares already handed on cannot be put back
  {
    const s = session(bundle, { serverPack: { [GOLD]: 10 } });
    s.sendPackNow(); s.run(200);
    s.openChest({ [GOLD]: 90, [SALT]: 2 }); s.run(300);
    s.take(GOLD, 90);
    s.serverAt(150, () => { s.server.pack.set(GOLD, 40); s.sendPackNow(); });
    s.run(6000);
    check('a taken item the server lowers right after (party gold share) closes the window once, and the pack ends at the server count',
      s.taps.length === 1 && s.count(GOLD) === 40 && s.writesInMenu.length === 0, { taps: s.taps.length, gold: s.count(GOLD), writes: s.writesInMenu });
  }

  // 10. A 2 s round trip with an unrelated pack landing between the take and its answer: no close
  {
    const s = session(bundle, { pingMs: 2000, serverPack: { [GOLD]: 10 } });
    s.sendPackNow(); s.run(2500);
    s.openChest({ [IRON_SWORD]: 1 }); s.run(300);
    s.take(IRON_SWORD); s.run(32);
    s.serverAt(200, () => s.sendPackNow());
    s.run(12000);
    check('a 2 s round trip with an unrelated pack in between does not close the window', !s.tabbed() && s.count(IRON_SWORD) === 1, { taps: s.taps, sword: s.count(IRON_SWORD) });
  }

  // 11. The game ignores the close (a slider or message box on top): tried twice at most, never once the window is shut
  {
    const s = session(bundle, { serverPack: { [GOLD]: 10 }, refuse: (m) => m.baseId === ARROW });
    globalThis.__h.tapKey = (k) => { s.taps.push({ k, t: s.now }); };
    s.sendPackNow(); s.run(200);
    s.openChest({ [ARROW]: 0 }); s.chest.set(ARROW, 5); s.run(300);
    s.take(ARROW, 5); s.run(15000);
    check('a close the game ignores is tried at most twice in one opening', s.taps.length === 2, s.taps);
    s.closeByPlayer(); s.run(6000);
    check('...no tap once the window is shut, and the ghost arrows then go', s.taps.length === 2 && s.count(ARROW) === 0, { taps: s.taps.length, arrows: s.count(ARROW) });
    s.openChest({ [SALT]: 1 }); s.run(8000);
    check('...and a reopen with nothing changed does not tap', s.taps.length === 2, s.taps.length);
  }

  // 12. Reopened straight after an auto close: no second close, no second notice
  {
    const s = session(bundle, { serverPack: { [GOLD]: 100 } });
    s.sendPackNow(); s.run(200);
    s.openChest({ [SILVER_SWORD]: 2 }); s.run(300);
    s.take(SILVER_SWORD, 2); s.run(3000);
    s.serverMail(SILVER_SWORD); s.run(4000);
    const first = s.taps.length;
    s.openChest({ [SALT]: 1 }); s.run(300);
    s.take(SALT); s.run(6000);
    check('a reopen after an auto close does not close again, and the notice shows once', first === 1 && s.taps.length === 1 && s.notes.length === 1,
      { first, taps: s.taps.length, notes: s.notes });
  }

  // 13. Moves sent from another window (BarterMenu) before the chest opens never close the chest
  {
    const s = session(bundle, { serverPack: { [GOLD]: 100 } });
    s.sendPackNow(); s.run(200);
    s.menus.add('BarterMenu'); s.take(IRON_SWORD); s.run(500); s.menus.delete('BarterMenu'); s.run(200);
    s.openChest({ [SALT]: 1 }); s.run(8000);
    check('a move made outside the chest window does not close a later chest window', !s.tabbed(), s.taps);
  }

  // 14. A player still moving items is not interrupted; the close waits until they stop
  {
    const s = session(bundle, { serverPack: { [GOLD]: 100 } });
    s.sendPackNow(); s.run(200);
    s.openChest({ [SILVER_SWORD]: 1, [SALT]: 20 }); s.run(300);
    s.take(SILVER_SWORD); s.run(500);
    s.serverMail(SILVER_SWORD);
    for (let i = 0; i < 5; i++) { s.take(SALT); s.run(1500); }
    const during = s.taps.length;
    s.run(4000);
    check('no close while the player keeps moving items, one close once they stop', during === 0 && s.taps.length === 1, { during, after: s.taps.length });
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.log('FAIL harness error', e && e.stack || e); process.exit(1); });
