// npcLifetime.deletePlan: what safeDelete does with a copy. A non-actor with its 3D (a torch, a placed activator) is
// disabled first and deleted once its 3D is gone, never deleted at once (the 16 Oct trap crash, SkyrimSE 26034+0x1C1).
// Compiles the pure module with the client's own TypeScript; run from skymp5-client:
//
//   node tests/delete-plan-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require(path.join(__dirname, '..', 'node_modules', 'typescript'));
const file = path.join(__dirname, '..', 'src', 'view', 'npcLifetime.ts');
const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
const m = new Module(file); m._compile(js, file);
const { deletePlan } = m.exports;
let failures = 0;
const check = (name, ok) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };
const now = 1e6;
const calm = { is3DLoaded: true, dead: false, bleedingOut: false, unconscious: false, inKillMove: false, ragdolledAt: 0 };
const facts = (o) => Object.assign({ handedToDelete: false, queued: false, deleted: false, is3DLoaded: true, state: null, defer: false, loadingScreen: false }, o);

check('a non-actor with 3D is deferred', deletePlan(facts({}), now) === 'defer');
check('a non-actor with 3D is deferred when the caller asked to defer too', deletePlan(facts({ defer: true }), now) === 'defer');
check('a non-actor without 3D is deleted at once', deletePlan(facts({ is3DLoaded: false }), now) === 'delete');
check('a calm actor with 3D is still deleted at once', deletePlan(facts({ state: calm }), now) === 'delete');
check('a dead actor with 3D is still deferred', deletePlan(facts({ state: Object.assign({}, calm, { dead: true }) }), now) === 'defer');
check('anything already handed to delete is skipped', deletePlan(facts({ handedToDelete: true }), now) === 'skip');
check('a loading screen defers everything', deletePlan(facts({ is3DLoaded: false, loadingScreen: true }), now) === 'defer');
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
