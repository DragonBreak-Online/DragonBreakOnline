// "Favorites and Magic not saving" (#bugs, 15 Oct): after a relog the favourites are gone and the prepared spells are not
// in the magic menu until they are put away and prepared again at a Scholars' Ledger. Drives the real FavoritesService
// (and sync/spell.ts, sync/loginClock.ts) against a fake game:
//   - a login whose Papyrus Utility.wait calls never come back (server log 11-16 Oct: about 1 fresh login in 8 never
//     restored and never snapshotted) still restores, on the login clock;
//   - a prepared spell the server's list holds but the game lacks at the restore is added again and favourited;
//   - one the game still lacks after that stays in the saved list and is favourited, hotkey and all, once the game has it;
//   - the login clock itself, and that remoteServer runs the spell passes and the arrival watch on it.
// Bundles with esbuild (skymp5-server's), skyrimPlatform replaced by the fake. Run from skymp5-client:
//
//   node tests/favorites-login-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP favorites-login (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

const SRC = path.resolve(__dirname, '../src');
const read = (rel) => { try { return fs.readFileSync(path.join(SRC, rel), 'utf8'); } catch (e) { return ''; } };
const HAS_CLOCK = fs.existsSync(path.join(SRC, 'sync/loginClock.ts'));

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

// ---- the fake game ----------------------------------------------------------------------------------------------------
const ITEM = 0x12eb7;      // an iron sword
const ITEM2 = 0x13982;     // a potion
const SPELL = 0x2b96b;     // Frostbite, a prepared spell
const SPELL2 = 0x12fcc;    // Healing
const PLAYER = 0x14;
const BEAST = 0x92c48;     // a beast power the client grants itself, not on the server's list
const SPELLS = new Set([SPELL, SPELL2, 0x12fcd, BEAST]);

const realNow = Date.now;
function makeWorld() {
  const w = {
    now: 1000000, waitMode: 'resolve', waits: [], gameMs: 0,
    forms: new Map(), known: new Set(), inv: new Map(), fav: new Map(), hotkeys: new Array(8).fill(0),
    addSpellOk: true, spHandlers: {}, ctlHandlers: {}, emitHandlers: {}, sent: [], logs: [],
  };
  w.form = (id) => {
    id = id >>> 0;
    if (!w.forms.has(id)) w.forms.set(id, { getFormID: () => id, __id: id });
    return w.forms.get(id);
  };
  const empty = { getSpellCount: () => 0, getNthSpell: () => null };
  w.player = {
    getFormID: () => PLAYER,
    getSpellCount: () => w.known.size,
    getNthSpell: (i) => w.form([...w.known][i]),
    getRace: () => empty,
    getLeveledActorBase: () => empty,
    isDead: () => false,
    is3DLoaded: () => true,
    hasSpell: (f) => !!f && w.known.has(f.__id),
    addSpell: (s) => { if (w.addSpellOk && s) w.known.add(s.__id); return w.addSpellOk; },
    removeSpell: (s) => { if (s) w.known.delete(s.__id); return true; },
  };
  const setFav = (form, hotkey) => {
    if (!form) return;
    const id = form.__id;
    for (let i = 0; i < 8; i++) if (w.hotkeys[i] === id) w.hotkeys[i] = 0;
    if (hotkey >= 0 && hotkey < 8) w.hotkeys[hotkey] = id;
    w.fav.set(id, hotkey);
  };
  const subscribe = (bag, persistent) => (name, cb) => { (bag[name] = bag[name] || []).push({ cb, once: !persistent }); };
  w.sp = {
    Game: {
      getPlayer: () => w.player,
      getFormEx: (id) => (id ? w.form(id) : null),
      isObjectFavorited: (f) => !!f && w.fav.has(f.__id),
      getHotkeyBoundObject: (slot) => (w.hotkeys[slot] ? w.form(w.hotkeys[slot]) : null),
    },
    TESModPlatform: { setItemFavorite: setFav, setSpellFavorite: setFav },
    Shout: { from: () => null },
    Spell: { from: (f) => (f && SPELLS.has(f.__id) ? f : null) },
    Menu: { Favorites: 'FavoritesMenu', Inventory: 'InventoryMenu', Magic: 'MagicMenu' },
    Utility: {
      wait: (s) => new Promise((resolve) => { if (w.waitMode !== 'drop') w.waits.push({ at: w.gameMs + s * 1000, resolve }); }),
    },
    on: subscribe(w.spHandlers, true),
    once: subscribe(w.spHandlers, false),
    printConsole: (...a) => w.logs.push(a.join(' ')),
    Actor: function Actor() { }, Form: function Form() { }, Race: function Race() { },
  };
  w.controller = {
    emitter: {
      on: (name, cb) => { (w.emitHandlers[name] = w.emitHandlers[name] || []).push(cb); },
      emit: (name, e) => {
        if (name === 'sendMessage') { try { w.sent.push(JSON.parse(e.message.contentJsonDump)); } catch (err) { w.sent.push(e); } }
        (w.emitHandlers[name] || []).forEach((cb) => cb(e));
      },
    },
    on: subscribe(w.ctlHandlers, true),
    once: subscribe(w.ctlHandlers, false),
    lookupListener: () => null,
  };
  return w;
}

const fire = (bag, name) => {
  const list = bag[name] || [];
  bag[name] = list.filter((h) => !h.once);
  for (const h of list) h.cb();
};
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

// One scenario: a fresh bundle (module state such as the server's spell list and the clock starts empty)
let BUNDLE = '';
function load(w) {
  globalThis.__fakeWorld = w;
  Date.now = () => w.now;
  delete require.cache[BUNDLE];
  const m = require(BUNDLE);
  const svc = new m.FavoritesService(w.sp, w.controller);
  const frames = async (seconds, live = true) => {
    const n = Math.round(seconds * 1000 / 16);
    for (let i = 0; i < n; i++) {
      w.now += 16;
      w.gameMs += 16;
      const due = w.waits.filter((x) => x.at <= w.gameMs);
      w.waits = w.waits.filter((x) => x.at > w.gameMs);
      due.forEach((x) => x.resolve());
      await flush();
      // remoteServer's feed, registered at load before any service's handler
      if (m.loginClock) m.loginClock.frame(w.now, live);
      fire(w.spHandlers, 'update');
      fire(w.ctlHandlers, 'update');
      await flush();
    }
  };
  const login = () => w.controller.emitter.emit('createActorMessage', { message: { isMe: true } });
  const packet = (items, spells) => w.controller.emitter.emit('customPacketMessage', {
    message: { contentJsonDump: JSON.stringify({ customPacketType: 'dboFavorites', items, spells }) },
  });
  const sent = (event) => w.sent.filter((p) => p.customPacketType === 'dbo' && p.event === event).map((p) => p.args[0]);
  return { m, svc, frames, login, packet, sent };
}

// As the server keeps it: the client's last snapshot, sorted by id
const SAVED = { items: [{ id: ITEM, hotkey: 0 }, { id: ITEM2, hotkey: -1 }], spells: [{ id: SPELL2, hotkey: -1 }, { id: SPELL, hotkey: 1 }] };
const freshPlayer = (w) => {
  w.inv.set(ITEM, 1); w.inv.set(ITEM2, 3);
  w.known.add(SPELL2);
};

async function main() {
  const tmpRoot = process.env.TMPDIR && fs.existsSync(process.env.TMPDIR) ? process.env.TMPDIR : os.tmpdir();
  const tmp = fs.mkdtempSync(path.join(tmpRoot, 'favorites-login-'));
  BUNDLE = path.join(tmp, 'bundle.js');
  try {
    const stubs = {
      sp: 'module.exports = globalThis.__fakeWorld.sp;',
      inventory: 'exports.getInventory = () => ({ entries: [...globalThis.__fakeWorld.inv].map(([baseId, count]) => ({ baseId, count })) });',
      remoteServer: 'exports.SPELL_ENFORCE_PASSES = [1, 3, 6, 10, 15, 20];',
      notify: 'exports.showSystemNotification = () => {};',
    };
    const plugin = {
      name: 'fake-game',
      setup(b) {
        b.onResolve({ filter: /^(skyrimPlatform|@skyrim-platform\/skyrim-platform)$/ }, () => ({ path: 'sp', namespace: 'fake' }));
        b.onResolve({ filter: /\/remoteServer$/ }, () => ({ path: 'remoteServer', namespace: 'fake' }));
        b.onResolve({ filter: /\/sync\/inventory$/ }, () => ({ path: 'inventory', namespace: 'fake' }));
        b.onResolve({ filter: /\/systemNotification$/ }, () => ({ path: 'notify', namespace: 'fake' }));
        b.onLoad({ filter: /.*/, namespace: 'fake' }, (a) => ({ contents: stubs[a.path], loader: 'js' }));
      },
    };
    const entry = [
      "export { FavoritesService } from './services/services/favoritesService';",
      "export { rememberServerSpells, noteServerSpellSnippet, getServerSpells } from './sync/spell';",
      HAS_CLOCK ? "export { loginClock, LoginClock, FRAME_CAP_MS, NOT_LIVE_GIVE_UP_MS, SPELL_ENFORCE_PASSES } from './sync/loginClock';" : '',
    ].join('\n');
    await esbuild.build({ stdin: { contents: entry, resolveDir: SRC, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE, plugins: [plugin], logLevel: 'error' });

    // 1. Control: the Papyrus waits come back. Base and fix both restore.
    {
      const w = makeWorld(); freshPlayer(w); w.known.add(SPELL);
      const t = load(w);
      t.m.rememberServerSpells([SPELL, SPELL2]);
      t.login(); await t.frames(8); t.packet(SAVED.items, SAVED.spells); await t.frames(32);
      check('control (waits come back): every favourite is back with its hotkey', w.fav.get(ITEM) === 0 && w.fav.get(SPELL) === 1 && w.fav.has(ITEM2) && w.fav.has(SPELL2), [...w.fav]);
      const r = t.sent('favoritesRestored');
      check('control: the restore is reported, 4 of 4', r.length === 1 && r[0].wanted === 4 && r[0].confirmed === 4, r);
      check('control: an unchanged list is not sent back', t.sent('favorites').length === 0, t.sent('favorites'));
    }

    // 2. The login whose Papyrus waits never come back (the save load took them)
    {
      const w = makeWorld(); freshPlayer(w); w.known.add(SPELL); w.waitMode = 'drop';
      const t = load(w);
      t.m.rememberServerSpells([SPELL, SPELL2]);
      t.login(); await t.frames(8); t.packet(SAVED.items, SAVED.spells); await t.frames(13.5);
      check('waits dropped: nothing is applied before 22 s of play (after the last spell pass)', w.fav.size === 0, [...w.fav]);
      await t.frames(18.5);
      check('waits dropped: the favourites and hotkeys still come back', w.fav.get(ITEM) === 0 && w.fav.get(SPELL) === 1 && w.fav.has(ITEM2) && w.fav.has(SPELL2), [...w.fav]);
      const r = t.sent('favoritesRestored');
      check('waits dropped: the restore is reported to the server', r.length === 1 && r[0].confirmed === 4, r);
      TESModPlatformUnfavorite(w, ITEM2);
      await t.frames(31);
      const s = t.sent('favorites');
      check('waits dropped: snapshots run afterwards (a change reaches the server)', s.length === 1 && !s[0].items.some((e) => e.id === ITEM2), s);
    }

    // 3. A prepared spell the server's list holds, missing from the game at the restore
    {
      const w = makeWorld(); freshPlayer(w); w.known.add(BEAST);
      const t = load(w);
      t.m.rememberServerSpells([SPELL, SPELL2]);
      t.login(); await t.frames(8); t.packet(SAVED.items, SAVED.spells); await t.frames(32);
      check('missing prepared spell: added again from the server\'s list', w.known.has(SPELL), [...w.known]);
      check('missing prepared spell: a spell the client granted itself (a beast power) is not taken away', w.known.has(BEAST), [...w.known]);
      check('missing prepared spell: favourited again with its hotkey', w.fav.get(SPELL) === 1, [...w.fav]);
      const r = t.sent('favoritesRestored');
      check('missing prepared spell: the report says 4 of 4 and one spell added', r.length === 1 && r[0].confirmed === 4 && r[0].spellsAdded === 1, r);
      const s = t.sent('favorites');
      check('missing prepared spell: no snapshot drops it from the server\'s copy', s.every((x) => x.spells.some((e) => e.id === SPELL && e.hotkey === 1)), s);
    }

    // 4. The game cannot take the spell yet: carried, then favourited once it is there (prepared again at a ledger)
    {
      const w = makeWorld(); freshPlayer(w); w.addSpellOk = false;
      const t = load(w);
      t.m.rememberServerSpells([SPELL, SPELL2]);
      t.login(); await t.frames(8); t.packet(SAVED.items, SAVED.spells); await t.frames(32);
      TESModPlatformUnfavorite(w, ITEM2);
      await t.frames(31);
      let s = t.sent('favorites');
      check('still missing: the snapshot keeps the spell the server lists, hotkey and all', s.length >= 1 && s[s.length - 1].spells.some((e) => e.id === SPELL && e.hotkey === 1), s);
      // The ledger: RemoveSpell then AddSpell snippets for the player
      t.m.noteServerSpellSnippet({ class: 'Actor', function: 'RemoveSpell', selfId: PLAYER, arguments: [{ formId: SPELL }] });
      t.m.noteServerSpellSnippet({ class: 'Actor', function: 'AddSpell', selfId: PLAYER, arguments: [{ formId: SPELL }] });
      w.known.add(SPELL);
      await t.frames(3);
      check('prepared again: favourited with its old hotkey within a few seconds', w.fav.get(SPELL) === 1 && w.hotkeys[1] === SPELL, [...w.fav]);
      s = t.sent('favorites');
      check('prepared again: the server\'s copy has it with that hotkey all along', s.length >= 1 && s.every((x) => x.spells.some((e) => e.id === SPELL && e.hotkey === 1)), s);
    }

    // 5. A carried spell whose hotkey the player gave to something else meanwhile; and one the server puts away
    {
      const w = makeWorld(); freshPlayer(w); w.addSpellOk = false;
      const t = load(w);
      t.m.rememberServerSpells([SPELL, SPELL2, 0x12fcd]);
      const spells = [...SAVED.spells, { id: 0x12fcd, hotkey: 2 }].sort((a, b) => a.id - b.id);
      t.login(); await t.frames(8); t.packet(SAVED.items, spells); await t.frames(32);
      w.sp.TESModPlatform.setItemFavorite(w.form(ITEM2), 1);
      w.addSpellOk = true; w.known.add(SPELL);
      await t.frames(3);
      check('hotkey taken since: the spell comes back as a favourite without stealing slot 1', w.fav.get(SPELL) === -1 && w.hotkeys[1] === ITEM2, { fav: [...w.fav], hk: w.hotkeys });
      t.m.noteServerSpellSnippet({ class: 'Actor', function: 'RemoveSpell', selfId: PLAYER, arguments: [{ formId: 0x12fcd }] });
      await t.frames(3);
      const s = t.sent('favorites');
      check('put away by the server: no longer kept in the saved list', s.length >= 1 && !s[s.length - 1].spells.some((e) => e.id === 0x12fcd), s);
    }

    // 6. A second login before the first restore: one restore, for the second
    {
      const w = makeWorld(); freshPlayer(w); w.known.add(SPELL);
      const t = load(w);
      t.m.rememberServerSpells([SPELL, SPELL2]);
      t.login(); await t.frames(10); t.login(); t.packet(SAVED.items, SAVED.spells); await t.frames(30);
      check('a second login replaces the first: one report', t.sent('favoritesRestored').length === 1, t.sent('favoritesRestored'));
    }

    // 7. The login clock
    if (!HAS_CLOCK) {
      check('sync/loginClock.ts exists (the login steps have a clock a save load cannot drop)', false);
    } else {
      const { LoginClock, FRAME_CAP_MS, NOT_LIVE_GIVE_UP_MS } = require(BUNDLE);
      const c = new LoginClock();
      const fired = [];
      c.after(2, () => fired.push('b'));
      c.after(1, () => fired.push('a'));
      c.after(1, () => { throw new Error('boom'); });
      c.after(1, () => fired.push('a2'));
      let t0 = 0;
      for (let i = 0; i <= 62; i++) c.frame(t0 += 16, true);
      check('clock: nothing before its time', fired.length === 0, fired);
      for (let i = 0; i < 70; i++) c.frame(t0 += 16, true);
      check('clock: due timers in order, one that throws does not stop the rest', fired.join() === 'a,a2,b', fired);
      const before = c.now();
      c.frame(t0 += 10000, true);
      check('clock: a 10 s gap between frames (a load, a menu) counts at most the cap', c.now() - before === FRAME_CAP_MS, c.now() - before);
      const mid = c.now();
      for (let i = 0; i < 100; i++) c.frame(t0 += 16, false);
      check('clock: frames without the player loaded do not count', c.now() === mid, c.now() - mid);
      for (let i = 0; i < Math.ceil(NOT_LIVE_GIVE_UP_MS / 16) + 200; i++) c.frame(t0 += 16, false);
      check('clock: ...until NOT_LIVE_GIVE_UP_MS of them, then it moves on', c.now() > mid + 2000, c.now() - mid);
      const cancel = c.after(0.1, () => fired.push('cancelled'));
      cancel();
      for (let i = 0; i < 20; i++) c.frame(t0 += 16, true);
      check('clock: a cancelled timer never runs', !fired.includes('cancelled') && c.pending() === 0, fired);
    }

    // 8. The wiring
    const rs = read('services/services/remoteServer.ts');
    const block = (rs.match(/rememberServerSpells\(learnedSpells\);[\s\S]*?\n    \}\n/) || [''])[0].replace(/\/\/.*/g, '');
    check('remoteServer: the login spell passes run on the login clock, not Utility.wait', /SPELL_ENFORCE_PASSES\.forEach\(\(seconds\) => \{\s*loginClock\.after\(seconds,/.test(block) && !/Utility\.wait/.test(block), block.slice(0, 400));
    check('remoteServer: every update feeds the clock with whether the player\'s 3D is loaded', /on\('update', \(\) => \{\s*let live = false;[\s\S]{0,200}is3DLoaded\(\)[\s\S]{0,200}loginClock\.frame\(Date\.now\(\), live\)/.test(rs));
    const watch = (rs.match(/private watchArrival\([\s\S]*?\n  \}\n/) || [''])[0].replace(/\/\/.*/g, '');
    check('remoteServer: the arrival watch polls on the login clock (the server holds favourites saves until it reports)', /loginClock\.after\(ARRIVAL_POLL_SECONDS,/.test(watch) && !/Utility\.wait/.test(watch) && /i \+ 1 < ARRIVAL_POLLS/.test(watch), watch.slice(0, 300));
    const fs2 = read('services/services/favoritesService.ts');
    check('favoritesService: no Utility.wait left', fs2.length > 0 && !/Utility\.wait/.test(fs2.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')));
    check('favoritesService: the restore waits for the last spell pass plus 2 s, on the same clock', /RESTORE_AFTER_LOGIN_S = Math\.max\(\.\.\.SPELL_ENFORCE_PASSES\) \+ 2/.test(fs2) && /from "\.\.\/\.\.\/sync\/loginClock"/.test(fs2));
  } finally {
    Date.now = realNow;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}

// The player takes an item out of the favourites
function TESModPlatformUnfavorite(w, id) {
  w.fav.delete(id);
  for (let i = 0; i < 8; i++) if (w.hotkeys[i] === id) w.hotkeys[i] = 0;
}

main().catch((e) => { console.error(e); Date.now = realNow; process.exit(1); });
