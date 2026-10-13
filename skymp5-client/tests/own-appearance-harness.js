// The server's appearance for the player's own character (a /mask name swap, a guardHead head correction, a GM /chargen
// result) never reached the player's own screen: remoteServer's onUpdateAppearanceMessage runs in tick context
// (NetworkingService.onTick), where every Papyrus native throws "can't be called in this context", and the RaceMenu
// settling check asked Ui.isMenuOpen there, before the apply was put off to the update (cerr 8d296c0a, 13 Oct). This runs
// the real handler and isRaceMenuSettling against a fake game whose natives throw outside an update callback, and checks
// the skips still hold: RaceMenu open, the 3 s after it closes, a beast form. Run from skymp5-client:
//
//   node tests/own-appearance-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP own-appearance (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

// The game: natives work only inside an update callback, as in Skyrim Platform (CallNativeApi.cpp, no VM outside OnUpdate)
const G = { inUpdate: false, menuOpen: false, applied: [], traces: [], errors: [], tickErrors: [], updateErrors: [] };
const native = (name, fn) => (...args) => {
  if (!G.inUpdate) throw new Error(`'${name}' can't be called in this context`);
  return fn(...args);
};
const Ui = { isMenuOpen: native('Ui.isMenuOpen', (menu) => menu === 'RaceSex Menu' && G.menuOpen) };
// applyAppearanceToPlayer starts with the player's getBaseObject() (Game.getPlayer itself has a fast path that works anywhere)
const applyAppearanceToPlayer = native('Actor.getBaseObject', (look, liveEyes, event) => G.applied.push({ look, liveEyes, event }));
const logTrace = (_l, ...a) => G.traces.push(a.join(' '));
const logError = (_l, ...a) => G.errors.push(a.join(' '));

const pending = [];
const controller = { once: (ev, fn) => { if (ev === 'update') pending.push(fn); else throw new Error('unexpected once ' + ev); } };
// NetworkingService.onTick: the message is handled in tick context
const tick = (fn) => { G.inUpdate = false; try { fn(); } catch (e) { G.tickErrors.push(e.message); } };
// SkyrimPlatform's "update": each callback in its own try (EventsApi.cpp SendEvent)
const update = () => {
  G.inUpdate = true;
  for (const fn of pending.splice(0)) { try { fn(); } catch (e) { G.updateErrors.push(e.message); } }
  G.inUpdate = false;
};

let NOW = 5000000;
Date.now = () => NOW;
const RACE = 0x13746, WEREWOLF = 0xcdd84;
const look = (name, raceId = RACE) => ({ name, raceId, options: [0.1], headpartIds: [0x1a2b3] });
const reset = () => {
  G.menuOpen = false; G.applied = []; G.traces = []; G.errors = []; G.tickErrors = []; G.updateErrors = []; pending.length = 0;
  delete globalThis.__dboRaceMenuClosedAt; delete globalThis.__dboBeastRaces;
};

async function main() {
  const rs = fs.readFileSync(path.resolve(__dirname, '../src/services/services/remoteServer.ts'), 'utf8');
  const settleMs = (rs.match(/const RACE_MENU_SETTLE_MS = \d+;/) || [''])[0];
  const settling = (rs.match(/const isRaceMenuSettling = [\s\S]*?;\n/) || [''])[0];
  const handler = (rs.match(/private onUpdateAppearanceMessage\(event: ConnectionMessage<UpdateAppearanceMessage>\): void \{[\s\S]*?\n  \}/) || [''])[0];
  check('remoteServer has the settle window, isRaceMenuSettling and onUpdateAppearanceMessage', !!settleMs && !!settling && !!handler);
  const src = `${settleMs}\n${settling}\nclass Rs {\n${handler.replace('private ', '')}\n}\nreturn Rs;`;
  const js = (await esbuild.transform(src, { loader: 'ts' })).code;
  const Rs = new Function('Ui', 'applyAppearanceToPlayer', 'logTrace', 'logError', js)(Ui, applyAppearanceToPlayer, logTrace, logError);

  // World model: idx 0 is this client's character, idx 1 another player
  const ME = 0, OTHER = 1;
  const forms = [{ refrId: 0x14 }, { refrId: 0xff000123 }];
  const rsi = Object.assign(new Rs(), {
    controller, worldModel: { forms }, getIdManager: () => ({ getId: (idx) => idx }), getMyActorIndex: () => ME,
  });
  const deliver = (idx, data) => tick(() => rsi.onUpdateAppearanceMessage({ message: { idx, data } }));
  const skipped = (re) => G.traces.some((t) => re.test(t));

  reset();
  const masked = look('Masked Person');
  deliver(ME, masked);
  check('the server\'s appearance for this character is taken in tick context without a throw', G.tickErrors.length === 0, G.tickErrors);
  check('...the world model has it at once', forms[ME].appearance === masked && forms[ME].numAppearanceChanges === 1, forms[ME]);
  check('...and nothing is put on the player before the update', G.applied.length === 0);
  update();
  check('...the next update puts it on the player (live eyes, traced as "update")', G.applied.length === 1 && G.applied[0].look === masked
    && G.applied[0].liveEyes === true && G.applied[0].event === 'update', G.applied);
  check('...with no error in the update', G.updateErrors.length === 0 && skipped(/^Applied appearance to the player$/), G.updateErrors);

  reset();
  G.menuOpen = true;
  deliver(ME, look('Edited'));
  update();
  check('while RaceMenu is open the echo is skipped', G.applied.length === 0 && skipped(/Skipped own appearance echo while RaceMenu settles/),
    { applied: G.applied.length, tickErrors: G.tickErrors, traces: G.traces });

  reset();
  globalThis.__dboRaceMenuClosedAt = NOW - 2900;
  deliver(ME, look('Edited'));
  update();
  check('in the 3 s after RaceMenu closes the echo is skipped', G.applied.length === 0 && skipped(/while RaceMenu settles/),
    { applied: G.applied.length, tickErrors: G.tickErrors, traces: G.traces });

  reset();
  globalThis.__dboRaceMenuClosedAt = NOW - 3100;
  deliver(ME, look('Corrected head'));
  update();
  check('after those 3 s the server\'s appearance is put on again', G.applied.length === 1 && G.tickErrors.length === 0, { applied: G.applied.length, tickErrors: G.tickErrors });

  reset();
  deliver(ME, look('Opened after'));
  G.menuOpen = true; // RaceMenu opened between the message and the update
  update();
  check('RaceMenu opened between the message and the update: skipped (decided when it would apply)', G.applied.length === 0
    && skipped(/while RaceMenu settles/), { applied: G.applied.length, tickErrors: G.tickErrors, traces: G.traces });

  reset();
  globalThis.__dboBeastRaces = new Set([WEREWOLF]);
  deliver(ME, look('Werebeast', WEREWOLF));
  update();
  check('a beast form\'s echo is skipped', G.applied.length === 0 && skipped(/Skipped own appearance echo for a beast form/),
    { applied: G.applied.length, tickErrors: G.tickErrors, traces: G.traces });
  deliver(ME, look('Back to normal'));
  update();
  check('...and the normal race after it is put on', G.applied.length === 1 && G.applied[0].look.name === 'Back to normal', G.applied);

  reset();
  const theirs = look('Another player');
  deliver(OTHER, theirs);
  update();
  check('another player\'s appearance only goes into the world model: no native, nothing put on the player',
    forms[OTHER].appearance === theirs && G.applied.length === 0 && G.tickErrors.length === 0 && pending.length === 0, G.tickErrors);

  reset();
  deliver(ME, null);
  update();
  check('a message clearing this character\'s appearance puts nothing on the player', forms[ME].appearance === undefined
    && G.applied.length === 0 && G.tickErrors.length === 0, G.tickErrors);

  reset();
  deliver(7, look('Nobody'));
  check('an idx not in the world model is logged, not thrown', G.tickErrors.length === 0 && G.errors.some((e) => /not found/.test(e)), G.errors);

  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
