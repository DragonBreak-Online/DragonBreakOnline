// Scripted test for the login-inside-an-interior door bug (16 Oct, Bruma's Great Hall 6c40f and other interiors): WorldView
// must start its FormViews on update events even when the Papyrus Utility.wait never returns, and a door the engine took
// itself is still sent to the server. Run from skymp5-client:
//
//   node tests/door-activation-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP door-activation (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

// FormType as the platform's const enum declares it
const dts = fs.readFileSync(path.resolve(__dirname, '../node_modules/@skyrim-platform/skyrim-platform/index.d.ts'), 'utf8');
const enumBody = /export const enum FormType \{([^}]*)\}/.exec(dts)[1];
const FORM_TYPE = {};
for (const m of enumBody.matchAll(/(\w+)\s*=\s*(\d+)/g)) FORM_TYPE[m[1]] = Number(m[2]);
const DOOR = FORM_TYPE.Door;

let now = 1e12;
Date.now = () => now;

const STUBS = {
  sp: `module.exports = { FormType: ${JSON.stringify(FORM_TYPE)}, MotionType: { Keyframed: 4 }, Flora: { from: () => null },
    ObjectReference: { from: (x) => x }, Actor: { from: (x) => x } };`,
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  logging: 'module.exports = { logTrace() {}, logError() {} };',
  empty: 'module.exports = {};',
  formViewArray: `class FormViewArray { resize() {} updateAll(model) { globalThis.__wvUpdates.push(model.forms.length); } syncFormView() {}
    getRemoteRefrId() { return 0; } getLocalRefrId() { return 0; } isPlayerCharacter() { return false; } }
    module.exports = { FormViewArray };`,
  pcHolder: 'class PlayerCharacterDataHolder { static updateData() {} } module.exports = { PlayerCharacterDataHolder };',
  singlePlayer: 'class SinglePlayerService {} module.exports = { SinglePlayerService };',
  remoteServer: 'class RemoteServer {} module.exports = { RemoteServer };',
  messages: 'module.exports = { MsgType: { Activate: 6 } };',
  inventory: 'module.exports = { getInventory: () => { if (globalThis.__invThrows) throw new TypeError("Cannot read properties of null (reading \'getFormID\')"); return { entries: [] }; } };',
  worldViewMisc: 'module.exports = { localIdToRemoteId: (id) => (id >= 0xff000000 ? (id + 0x100000) >>> 0 : id), getViewFromStorage: () => globalThis.__wv };',
  lastInv: 'class LastInvService {} module.exports = { LastInvService };',
  selfActivation: 'module.exports = { selfActivated() {} };',
  customPacketUtil: 'module.exports = { parseCustomPacket: () => null };',
};
const STUB_OF = {
  skyrimPlatform: 'sp', './clientListener': 'clientListener', '../services/services/clientListener': 'clientListener',
  '../logging': 'logging', '../../logging': 'logging', './model': 'empty', './formViewArray': 'formViewArray',
  './playerCharacterDataHolder': 'pcHolder', '../services/services/singlePlayerService': 'singlePlayer',
  '../services/services/remoteServer': 'remoteServer', '../../messages': 'messages', '../../sync/inventory': 'inventory',
  '../../view/worldViewMisc': 'worldViewMisc', './lastInvService': 'lastInv', '../../sync/selfActivation': 'selfActivation',
  './customPacketUtil': 'customPacketUtil', '../events/connectionMessage': 'empty', '../messages/createActorMessage': 'empty',
  '../messages/customPacketMessage': 'empty', '../sync/movement': 'empty',
};

const build = async (tmp, rel, name) => {
  const out = path.join(tmp, `${name}.js`);
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, '..', rel)], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
    } }],
  });
  return require(out);
};

const controller = (listeners) => {
  const handlers = {};
  const c = {
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push({ fn, once: false }); },
    once: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push({ fn, once: true }); },
    fire: (ev, arg) => { const hs = handlers[ev] || []; handlers[ev] = hs.filter((h) => !h.once); for (const h of hs) h.fn(arg); },
    emitter: { on: () => {}, emit: (ev, m) => { if (ev === 'sendMessage') c.sent.push(m.message); } },
    lookupListener: (cls) => listeners[cls.name.replace(/\d+$/, '')] || {},
    sent: [],
  };
  return c;
};

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'door-activation-'));
  try {
    // A. WorldView's gate
    const { WorldView } = await build(tmp, 'src/view/worldView.ts', 'worldView');
    const model = { forms: [{ refrId: 0x806c473 }, { refrId: 0x806c4dd }, { refrId: 0xff001a30 }], playerCharacterFormIdx: 2, playerCharacterRefrId: 0xff001a30 };
    const view = (papyrusReturns) => {
      globalThis.__wvUpdates = [];
      globalThis.__raceMenu = false;
      globalThis.__loading = false;
      const pending = [];
      const sp = {
        storage: {}, settings: { 'skymp5-client': {} },
        Utility: { wait: () => new Promise((resolve) => { if (papyrusReturns) pending.push(resolve); }) },
        Game: { getPlayer: () => ({ getWorldSpace: () => null, getParentCell: () => ({ getFormID: () => 0x806c40f }) }) },
        Ui: { isMenuOpen: (n) => (n === 'RaceSex Menu' && globalThis.__raceMenu) || (n === 'Loading Menu' && globalThis.__loading) },
      };
      const c = controller({ SinglePlayerService: { isSinglePlayer: false }, RemoteServer: { getWorldModel: () => model } });
      const wv = new WorldView(sp, c);
      const run = (ms, step = 16) => { for (let t = 0; t < ms; t += step) { now += step; c.fire('update'); } };
      const shown = () => globalThis.__wvUpdates.length > 0 && globalThis.__wvUpdates[globalThis.__wvUpdates.length - 1] === model.forms.length;
      return { wv, c, run, shown, pending };
    };

    {
      const v = view(false);
      v.run(800);
      check('a login: the forms wait out the first second of play, as before', !v.shown(), globalThis.__wvUpdates.slice(-1));
      v.run(600);
      check('the Papyrus wait never returns (the 16 Oct interior logins): the forms still reach the FormViews after a second of updates', v.shown(), globalThis.__wvUpdates.slice(-1));
    }
    {
      const v = view(true);
      v.run(1400);
      v.pending.forEach((r) => r());
      await new Promise((r) => setImmediate(r));
      v.run(50);
      check('a Papyrus wait that does return changes nothing: the forms are applied', v.shown(), globalThis.__wvUpdates.slice(-1));
    }
    {
      const v = view(false);
      v.run(50);
      globalThis.__raceMenu = true;
      v.run(5000);
      check('time with the character creator open is not counted', !v.shown());
      globalThis.__raceMenu = false;
      v.run(1200);
      check('...and the count goes on once it closes', v.shown(), globalThis.__wvUpdates.slice(-1));
    }
    {
      const v = view(false);
      v.run(50);
      globalThis.__loading = true;
      v.run(5000);
      globalThis.__loading = false;
      v.run(500);
      check('updates while a load screen is up are not counted either', !v.shown());
    }
    {
      const v = view(false);
      v.run(50);
      now += 60000; v.c.fire('update');
      v.run(500);
      check('a long load screen between two updates counts as a moment of play, not a minute', !v.shown());
    }
    {
      const v = view(false);
      v.run(1400);
      v.wv.setFormViewUpdateAllowed(false);
      v.run(5000);
      const held = !v.shown();
      v.run(6000);
      check('a gate shut with no count of its own (the showracemenu snippet) still opens after ten seconds of play', held && v.shown());
    }

    // B. ActivationService
    const { ActivationService } = await build(tmp, 'src/services/services/activationService.ts', 'activationService');
    const player = { getFormID: () => 0x14 };
    const door = (o) => {
      const d = { blocks: [], getFormID: () => o.id || 0x806c473, getOpenState: () => o.state, isActivationBlocked: () => !!o.blocked,
        blockActivation: (b) => { d.blocks.push(b); o.blocked = b; },
        getBaseObject: () => ({ getType: () => DOOR, getFormID: () => o.base || 0x1601956 }),
        getWorldSpace: () => null, getParentCell: () => ({ getFormID: () => 0x806c40f }) };
      return d;
    };
    // WorldView holding a FormView for each local id in streamed; its id lookups throw for plugin ids, as FormViewArray's do
    const streamed = new Set();
    globalThis.__wv = {
      getLocalRefrId: (id) => { if (id < 0xff000000) throw new Error('This function is only for 0xff forms'); return 0; },
      getRemoteRefrId: (id) => { if (id < 0xff000000) throw new Error('This function is only for 0xff forms'); return 0; },
      getFormViews: () => { const ids = [...streamed]; return { getFormViewsArrayLength: () => ids.length, getNthFormView: (i) => ({ getLocalRefrId: () => ids[i], getRemoteRefrId: () => ids[i] }) }; },
    };
    const lastInv = {};
    const activate = (caster, target) => {
      const c = controller({ LastInvService: lastInv });
      new ActivationService({ Game: { getPlayer: () => player } }, c);
      c.fire('activate', { caster, target });
      return c.sent;
    };
    {
      streamed.add(0x806c473);
      const d = door({ state: 2, blocked: false });
      const sent = activate(player, d);
      check('the engine took an unblocked load door itself (state Opening): the server still hears it', sent.length === 1 && sent[0].data.target === 0x806c473 && sent[0].data.caster === 0x14, sent);
      check('...and, as WorldView holds its FormView, the door is activation-blocked again', d.blocks.includes(true), d.blocks);
    }
    check('a blocked door still animating from the server stays ignored, as before', activate(player, door({ state: 2, blocked: true })).length === 0);
    check('a blocked closed door is sent, as before', activate(player, door({ state: 3, blocked: true })).length === 1);
    check('the Bleak Falls secret door the client leaves unblocked keeps its old rule', activate(player, door({ state: 2, blocked: false, base: 0x6f703 })).length === 0);
    check('an NPC copy walking through an unblocked door keeps the old rule', activate({ getFormID: () => 0xff000123 }, door({ state: 4, blocked: false })).length === 0);
    check('...while its activation of a closed door is still sent', activate({ getFormID: () => 0xff000123 }, door({ state: 3, blocked: false })).length === 1);
    const reported = [];
    globalThis.__dboReportError = (w) => reported.push(w);
    globalThis.__invThrows = true;
    lastInv.lastInv = { entries: [{ baseId: 0xf, count: 1 }] };
    let thrown;
    try { thrown = activate(player, door({ state: 3, blocked: true })); } catch (e) { thrown = String(e); }
    globalThis.__invThrows = false;
    check('an inventory read that throws (a player whose base reads null) no longer drops the activation', Array.isArray(thrown) && thrown.length === 1, thrown);
    check('...and the stale snapshot is cleared, so ContainersService reads its own', lastInv.lastInv === undefined, lastInv.lastInv);
    check('...and the error still reaches the server log as a cerr line', reported.length === 1 && reported[0] === 'on:activate:inv', reported);
    delete globalThis.__dboReportError;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.log('FAIL', e && e.stack || e); process.exit(1); });
