// DragonBreak Online: levered gates (Countess Frigga Hux, 17 Oct: "the gate now goes down properly, though i can not lock
// the lever ... i tested it with a random person in town: they can use the lever, it doesnt visibly show the gate moving
// for them, yet it still closes for me"). Loaded by gamemode.js; config "gates".
//
// Two things were wrong with Castle Bruma's north gate, and they are not the same thing.
//
// THE SYNC. The server keeps a door's state as isOpen, and that reaches the other clients - which is why the gate closed
// on her screen. But a state is not an animation: nothing played the gate moving for the player standing at the lever.
// So the gate is played here, server-side, to everyone in the cell, the way ruinbuttons.js plays an expedition stair.
// Which call a mesh needs is not knowable from the record: PlayAnimation drives a behaviour graph, PlayGamebryoAnimation
// a NiControllerManager sequence, and Beyond Skyrim's retractable stair answered only to the second (Nate, 28 Sep, after
// PlayAnimation("Open") moved nothing in Telepe). Rather than guess, each direction here sends BOTH calls and the log
// says which went out; a name a mesh lacks plays nothing and costs nothing (the engine returns false).
//
// THE LOCK. A lever is an ACTI (DBO_BrumaGateLever), and the housing system claims DOORs and CONTs only, so a lever can
// never be owned or locked - a lock on the gate it drives was simply bypassed. A lever now answers to the gate's own
// lock instead: while the gate is locked and claimed, only someone its key opens may pull it. Nobody gains a new kind of
// property, and the Countess's lock on her gate finally governs her lever.
//
// Config "gates": { enabled, list: [{ lever, gate, open, close, name }] }, read per pull (hot reload).
//   open/close: the sequence names to try, each sent as both an animation and a gamebryo sequence.
// ROLLBACK: enabled false (hot reload). Nothing is kept on a character or a reference.
'use strict';

const DEFAULTS = {
  enabled: true,
  list: [{ name: "Castle Bruma's north gate", lever: '1b5fc3:DragonBreak Online Edits.esp', gate: '1b5fc4:DragonBreak Online Edits.esp',
    open: ['Open'], close: ['Close'] }],
};

module.exports = (api) => {
  const { mp, log, personal, display, who, audit, cfg } = api;
  const conf = () => Object.assign({}, DEFAULTS, (cfg && cfg.gates) || {});
  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };

  // lever id -> its entry, built once per load; a desc not in the load order is logged and left out
  let BY_LEVER = null;
  const levers = () => {
    if (BY_LEVER) return BY_LEVER;
    BY_LEVER = new Map();
    for (const g of (conf().list || [])) {
      const lever = idOf(g.lever), gate = idOf(g.gate);
      if (!lever || !gate) { log(`gates: ${g.name || g.lever} is not in the load order (lever ${lever}, gate ${gate})`); continue; }
      BY_LEVER.set(lever, Object.assign({}, g, { leverId: lever, gateId: gate }));
    }
    return BY_LEVER;
  };

  // Whether this actor may work the gate: free while it is unclaimed or unlocked, else only whom its key opens
  const mayWork = (a, g) => {
    const H = globalThis.__dboHousing;
    if (!H || typeof H.primaryOf !== 'function' || typeof H.recordOf !== 'function') return true;
    let rec = null;
    try { const root = Number(H.primaryOf(g.gateId)) >>> 0; rec = root ? H.recordOf(root) : null; } catch (e) { return true; }
    if (!rec || !Number(rec.owner) || rec.locked !== true) return true;
    try { return typeof H.keyOpens === 'function' ? H.keyOpens(g.gateId, a >>> 0) === true : true; } catch (e) { return true; }
  };

  // Every way the gate is played, both calls for every name: what went out
  const play = (g, dir) => {
    const names = Array.isArray(g[dir]) ? g[dir] : [];
    const sent = [];
    for (const name of names) {
      for (const fn of ['PlayAnimation', 'PlayGamebryoAnimation']) {
        try {
          mp.callPapyrusFunction('method', 'ObjectReference', fn, { type: 'form', desc: g.gate },
            fn === 'PlayGamebryoAnimation' ? [String(name), true, 0.0] : [String(name)]);
          sent.push(`${fn}(${name})`);
        } catch (e) { log(`gates: ${fn}(${name}) on ${g.gate} failed: ${e.message}`); }
      }
    }
    log(`gates: ${g.name || g.gate} ${dir} -> ${sent.join(', ') || 'nothing'}`);
    return sent.length > 0;
  };

  // The gate's state after the engine's own chain has run, so the animation matches what the door became
  const playAfter = (g) => {
    setTimeout(() => {
      let open = null;
      try { open = mp.get(g.gateId, 'isOpen'); } catch (e) { open = null; }
      if (open === null) return;
      play(g, open === true ? 'open' : 'close');
    }, 100);
  };

  // false: the pull is refused and the engine's chain never runs
  const onLever = (target, caster) => {
    const C = conf();
    if (C.enabled === false) return true;
    const g = levers().get(target >>> 0);
    if (!g) return true;
    if (!mayWork(caster, g)) {
      try { personal(caster, `${g.name || 'That gate'} is locked. Its lever answers to whoever holds the key.`); } catch (e) { /* offline */ }
      log(`gates: ${who ? who(caster) : caster} may not work ${g.name || g.gate}: it is locked`);
      return false;
    }
    playAfter(g);
    return true;
  };

  globalThis.__dboGateLever = (target, caster) => {
    try { return onLever(Number(target) >>> 0, Number(caster) >>> 0); } catch (e) { log('gates: lever failed', e.message); return true; }
  };
  globalThis.__dboGatesTest = { onLever, mayWork, play, levers };
  log(`gates: ${levers().size} levered gate(s)`);
  return { onLever, mayWork, play };
};
module.exports.DEFAULTS = DEFAULTS;
