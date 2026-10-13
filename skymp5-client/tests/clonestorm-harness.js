// The 0.3.95 clone storm (13 Oct 06:19Z, "it's raining men"): formView's base getter runs on every update. SpawnProcess's
// applyTints aliases the copy's own fresh base to the player's base id, so a getter that rebuilds an aliased base built a
// new base on the very next frame, the copy's base no longer matched and the copy was respawned, every frame, for every
// player in view (faceSync lines: 5814 of 6658 copies destroyed within 100 ms of being built). This runs formView's real
// getAppearanceBasedBase against a fake game in which getFormEx of the old id still finds the aliased base (0.3.94 had no
// storm, which needs exactly that). Run from skymp5-client:
//
//   node tests/clonestorm-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP clonestorm (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const PLAYER_BASE = 7;
const fakeGame = () => {
  const forms = new Map();
  const player = { getBaseObject: () => forms.get(PLAYER_BASE) };
  forms.set(PLAYER_BASE, { id: PLAYER_BASE, getFormID() { return this.id; } });
  let next = 0xff000100;
  let built = 0;
  return {
    forms,
    built: () => built,
    Game: { getFormEx: (id) => forms.get(id >>> 0) || null, getPlayer: () => player },
    ActorBase: { from: (f) => f || null },
    Actor: { from: (f) => f || null },
    ObjectReference: { from: (f) => f || null },
    applyAppearance: () => { built++; const id = next++; const b = { id, getFormID() { return this.id; } }; forms.set(id, b); return b; },
    // applyTints: setFormIdUnsafe(base, playerBaseId); the old id still finds the form
    alias: (id) => { const b = forms.get(id); if (b) b.id = PLAYER_BASE; },
    // A placed copy whose base is the form it was placed from
    copyOn: (id) => { const b = forms.get(id); const refId = 0xff100000 + id % 0x1000; forms.set(refId, { id: refId, getFormID() { return this.id; }, getBaseObject: () => b }); return refId; },
  };
};

async function main() {
  const fv = fs.readFileSync(path.resolve(__dirname, '../src/view/formView.ts'), 'utf8');
  const getter = (fv.match(/private getAppearanceBasedBase\(\): number \{[\s\S]*?\n  \}/) || [''])[0];
  check('formView has the base getter', !!getter);
  const src = `class View { refrId = 0; appearanceBasedBaseId = 0; appearanceState: any = { appearance: { name: "x" } };\n${getter.replace('private ', '')}\n}\nreturn View;`;
  const js = (await esbuild.transform(src, { loader: 'ts' })).code;
  const make = (g) => new Function('Game', 'ActorBase', 'Actor', 'ObjectReference', 'applyAppearance', 'needsFreshBase', js)(
    g.Game, g.ActorBase, g.Actor, g.ObjectReference, g.applyAppearance,
    (baseFormId, playerBaseFormId) => !baseFormId || (baseFormId >>> 0) === (playerBaseFormId >>> 0));

  const g = fakeGame();
  const v = new (make(g))();
  const first = v.getAppearanceBasedBase();
  check('a copy with no base gets one built', g.built() === 1 && first >= 0xff000000, g.built());
  v.refrId = g.copyOn(first);
  g.alias(first); // SpawnProcess.enable -> applyTints on the new copy
  const ids = new Set();
  for (let frame = 0; frame < 60; frame++) ids.add(v.getAppearanceBasedBase());
  check('60 frames after applyTints aliased it: the same base, none rebuilt (no respawn every frame)', ids.size === 1 && ids.has(first) && g.built() === 1, { ids: [...ids].map((i) => i.toString(16)), built: g.built() });

  const g2 = fakeGame();
  const v2 = new (make(g2))();
  const b = v2.getAppearanceBasedBase();
  g2.forms.delete(b);
  check('a base that is gone is rebuilt', v2.getAppearanceBasedBase() !== b && g2.built() === 2, g2.built());
  v2.appearanceBasedBaseId = 0;
  v2.getAppearanceBasedBase();
  check('a reset id (appearance change, cell change) is rebuilt', g2.built() === 3, g2.built());

  // 7830cf9b's bug: a copy placed again from an aliased base wore the watcher's look (#gm-chat 12 Oct)
  const g3 = fakeGame();
  const v3 = new (make(g3))();
  const b3 = v3.getAppearanceBasedBase();
  v3.refrId = g3.copyOn(b3);
  g3.alias(b3);
  v3.getAppearanceBasedBase();
  v3.refrId = 0; // keepNoCopy (admin invisible) or another cell: destroy(), refrId 0, the base id kept
  const fresh = v3.getAppearanceBasedBase();
  check('a hidden copy shown again gets a fresh base, not the aliased one (the watcher\'s look)', fresh !== b3 && g3.built() === 2, g3.built());
  for (let frame = 0; frame < 60; frame++) v3.getAppearanceBasedBase();
  check('...and only one while that base waits for its copy (60 frames)', g3.built() === 2, g3.built());
  v3.refrId = g3.copyOn(fresh);
  g3.alias(fresh);
  g3.forms.delete(v3.refrId); // the copy is gone from the game, refrId kept
  v3.getAppearanceBasedBase();
  check('a copy gone from the game gets a fresh base too', g3.built() === 3, g3.built());

  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
