// DragonBreak Online: execution at the chopping block, a player kill (PK) that ends the character (Nate, 12 Oct: "a
// chopping block activator, so they can do the beheading animation and it perma kills someone, like the execution scenes
// from the beginning of Skyrim or in Solitude"; "GMs (not trial GMs) have to accept it and be present"). Loaded by
// gamemode.js; its activate chain asks __dboExecutionActivate before the engine seats anyone.
//
// The block is vanilla's: Skyrim.esm FURN WEExecutionerChoppingBlock2Seat (fe549) and ExecutionerChoppingBlock (2e8eb),
// both Furniture\HeadChoppingBlock.nif, or any base listed in config. Vanilla seats both actors in it and, from
// HeadChopBlock2ManHookupScript (disassembled 12 Oct), calls executionee.AddDependentAnimatedObjectReference(executioner)
// then executionee.PlayIdle(IdleHeadChop, Skyrim.esm 74ec5, event IdleExecutionerChop): one idle on the victim drives the
// headsman's swing with it. Here the server runs the steps and every client nearby plays them (dboExecute, the client's
// ExecutionService); the block's own script never decides anything.
//
//   1. The victim uses the block and kneels (the engine seats them). Using it is the victim's own act.
//   2. Another player uses it: the headsman. A GM (an admin tier; a Trial GM is not one) must be within gmRangeMeters,
//      or nothing happens. Every GM in range gets a panel: approve or refuse.
//   3. Approved, the headsman confirms in a panel of their own.
//   4. Every player within watchMeters is sent dboExecute (each plays the pair on its copies: the victim's clip takes the
//      head at 11.8 s); chopMs (16.7 s, the clip's KillActor) later the victim's character ends for good
//      (supernatural.js __dboPermaKill), audited and posted to the staff log.
// Anything that breaks it - the victim or headsman stepping away or leaving, a refusal, approvalSeconds passing - ends
// the attempt, and everyone in it is told. Config "execution": { enabled, blockBases, idle, gmRangeMeters, reachMeters,
// watchMeters, chopMs, approvalSeconds }. Hot reload.
'use strict';

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, cfg, isAdmin, isPlayer, sendPacket, openWidget, closeWidget, onUi, onlineActors,
    distanceMeters, every, staffLog } = api;
  const C = Object.assign({
    enabled: true,
    // The DLE's DBO_ExecutionBlock (fe549 without its script) placed in front of Castle Bruma, and vanilla's two
    blockBases: ['1ac980:DragonBreak Online Edits.esp', 'fe549:Skyrim.esm', '2e8eb:Skyrim.esm'],
    // Read from Skyrim - Animations.bsa on the PC (12 Oct): IdleHeadChop (74ec5) plays AOExecutionerChop.hkx on the
    // headsman (impact sound at 11.9 s); IdleExecutioneeChop (70c09) plays AOExecutioneeChop.hkx on the victim, whose
    // Decapitate trigger (11.839 s) takes the head and KillActor (16.606 s) drops the body. Both start on one frame
    victimIdle: '70c09:Skyrim.esm',
    idle: '74ec5:Skyrim.esm',
    gmRangeMeters: 20, reachMeters: 3, watchMeters: 120,
    // The server's death just after the clip's own KillActor (16.606 s), so the body falls as vanilla's does
    chopMs: 16700, approvalSeconds: 120,
  }, (cfg && cfg.execution) || {});
  const PANEL_ID = 83; // 81 is the couriers board (widget-ids-harness)
  const S = globalThis.__dboExecState || (globalThis.__dboExecState = { blocks: new Map(), baseOf: new Map() });

  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };
  const BASES = new Set((C.blockBases || []).map(idOf).filter(Boolean));
  const baseOf = (ref) => {
    const r = ref >>> 0;
    if (S.baseOf.has(r)) return S.baseOf.get(r);
    let b = 0; try { b = idOf(mp.get(r, 'baseDesc')); } catch (e) { b = 0; }
    if (S.baseOf.size > 5000) S.baseOf.clear();
    S.baseOf.set(r, b);
    return b;
  };
  const isBlock = (ref) => BASES.has(baseOf(ref));
  const online = (a) => onlineActors().some((x) => (x >>> 0) === (a >>> 0));
  const near = (a, ref, m) => { try { return online(a) && distanceMeters(a, ref) <= m; } catch (e) { return false; } };
  const nameOf = (a) => { try { return display(a); } catch (e) { return 'someone'; } };
  const gmsNear = (block) => onlineActors().filter((g) => isAdmin(g) && near(g, block, Number(C.gmRangeMeters)));
  const nonce = () => Math.random().toString(36).slice(2, 10);

  const end = (block, why, tellAll) => {
    const st = S.blocks.get(block);
    if (!st) return;
    S.blocks.delete(block);
    for (const a of [st.victim, st.executioner, ...(st.gms || [])].filter(Boolean)) {
      try { closeWidget(a, PANEL_ID); } catch (e) { /* offline */ }
      if (tellAll && why) { try { personal(a, why); } catch (e) { /* offline */ } }
    }
    if (st.phase !== 'kneeling') log(`execution at ${block.toString(16)} ended: ${why || 'done'}`);
  };

  const panel = (a, title, actions) => openWidget(a, {
    type: 'contextMenu', id: PANEL_ID, mode: 'menu', targetName: title, actions,
    events: { action: 'dbo:executionChoose', close: 'dbo:executionClose' },
  }, true);

  // The activate chain: false refuses the use (no seat), undefined lets the engine seat the player
  globalThis.__dboExecutionActivate = (targetId, casterId) => {
    if (C.enabled === false) return undefined;
    const block = targetId >>> 0, a = casterId >>> 0;
    if (!isBlock(block) || !isPlayer(a)) return undefined;
    let st = S.blocks.get(block);
    // A victim who is gone frees the block
    if (st && !near(st.victim, block, Number(C.reachMeters))) { end(block, 'The one at the block is gone.', true); st = null; }
    if (!st) {
      S.blocks.set(block, { victim: a, phase: 'kneeling', at: Date.now() });
      personal(a, 'You kneel and lay your head on the block. Nothing more happens unless a GM allows an execution; stand up to leave.');
      return undefined;
    }
    if (st.victim === a) { end(block, '', false); return undefined; }   // getting up
    if (st.phase !== 'kneeling') { personal(a, 'An execution is already under way here.'); return false; }
    const gms = gmsNear(block);
    if (!gms.length) {
      personal(a, `An execution needs a GM (not a Trial GM) here, within ${C.gmRangeMeters} m, to approve it.`);
      return false;
    }
    Object.assign(st, { executioner: a, phase: 'awaitGm', at: Date.now(), nonce: nonce(), gms });
    for (const g of gms) {
      panel(g, `Execution: ${nameOf(a)} would behead ${nameOf(st.victim)}. This ends ${nameOf(st.victim)}'s character for good (PK).`,
        [{ id: `approve:${block.toString(16)}:${st.nonce}`, label: 'Approve the execution' }, { id: `deny:${block.toString(16)}:${st.nonce}`, label: 'Refuse' }]);
    }
    personal(a, 'You take up the axe. A GM must approve the execution.');
    personal(st.victim, `${nameOf(a)} stands over you with the axe. A GM is asked to approve the execution.`);
    audit(`EXECUTION asked by ${who(a)} of ${who(st.victim)} at ${block.toString(16)}; GMs near: ${gms.map((g) => who(g)).join(', ')}`);
    return undefined;
  };

  const chop = (block, st) => {
    st.phase = 'chopping';
    const watchers = onlineActors().filter((p) => near(p, block, Number(C.watchMeters)) || p === st.victim || p === st.executioner);
    for (const p of watchers) { try { sendPacket(p, { customPacketType: 'dboExecute', victim: st.victim, executioner: st.executioner, idle: C.idle, victimIdle: C.victimIdle }); } catch (e) { /* offline */ } }
    audit(`EXECUTION started: ${who(st.executioner)} beheads ${who(st.victim)}, approved by ${who(st.approvedBy)}, ${watchers.length} watcher(s)`);
    setTimeout(() => {
      const now = S.blocks.get(block);
      if (now !== st || st.phase !== 'chopping') return;
      if (!near(st.victim, block, Number(C.reachMeters) + 2)) { end(block, 'The execution did not happen: the one at the block was gone.', true); return; }
      const why = `executed at the chopping block by ${nameOf(st.executioner)}, approved by GM ${nameOf(st.approvedBy)}`;
      try { if (typeof globalThis.__dboPermaKill === 'function') globalThis.__dboPermaKill(st.victim, why); else log('execution: no __dboPermaKill (supernatural.js); nobody was killed'); } catch (e) { log('execution: kill failed', e.message); }
      try { if (typeof staffLog === 'function') staffLog(nameOf(st.approvedBy), 'gm', 'execution', `${nameOf(st.executioner)} executed ${nameOf(st.victim)} (PK)`); } catch (e) { /* the audit line stands */ }
      audit(`EXECUTION done: ${who(st.victim)} ${why}`);
      end(block, '', false);
    }, Math.max(0, Number(C.chopMs) || 0));
  };

  onUi('executionChoose', (a, args) => {
    const m = /^(approve|deny|confirm|cancel):([0-9a-f]+):([a-z0-9]+)$/.exec(String((args || [])[0] || ''));
    if (!m) return;
    const block = parseInt(m[2], 16) >>> 0, st = S.blocks.get(block);
    try { closeWidget(a, PANEL_ID); } catch (e) { /* closed */ }
    if (!st || st.nonce !== m[3]) return personal(a, 'That execution is no longer waiting.');
    if (m[1] === 'approve' || m[1] === 'deny') {
      if (st.phase !== 'awaitGm' || !isAdmin(a) || !near(a, block, Number(C.gmRangeMeters))) return personal(a, 'Only a GM at the block can decide this.');
      for (const g of st.gms || []) if (g !== a) { try { closeWidget(g, PANEL_ID); } catch (e) { /* offline */ } }
      if (m[1] === 'deny') { audit(`EXECUTION refused by ${who(a)}: ${who(st.executioner)} of ${who(st.victim)}`); return end(block, `GM ${nameOf(a)} refused the execution.`, true); }
      Object.assign(st, { phase: 'awaitHeadsman', approvedBy: a, at: Date.now() });
      audit(`EXECUTION approved by ${who(a)}: ${who(st.executioner)} of ${who(st.victim)}`);
      personal(st.victim, `GM ${nameOf(a)} has allowed the execution.`);
      return panel(st.executioner, `Behead ${nameOf(st.victim)}? This ends their character for good (PK).`,
        [{ id: `confirm:${block.toString(16)}:${st.nonce}`, label: `Execute ${nameOf(st.victim)}` }, { id: `cancel:${block.toString(16)}:${st.nonce}`, label: 'Lower the axe' }]);
    }
    if (a !== st.executioner || st.phase !== 'awaitHeadsman') return;
    if (m[1] === 'cancel') return end(block, `${nameOf(a)} lowers the axe. There is no execution.`, true);
    chop(block, st);
  });
  onUi('executionClose', () => { /* a closed panel decides nothing; the attempt times out */ });

  // Who stepped away, logged out or waited too long ends the attempt
  every('execution.watch', 2000, () => {
    if (C.enabled === false) return;
    const now = Date.now();
    for (const [block, st] of [...S.blocks]) {
      if (st.phase === 'chopping') continue;
      if (!near(st.victim, block, Number(C.reachMeters))) { end(block, 'The one at the block stood up or left. There is no execution.', true); continue; }
      if (st.executioner && !near(st.executioner, block, Number(C.reachMeters) + 2)) { end(block, 'The headsman stepped away. There is no execution.', true); continue; }
      if (st.phase === 'awaitGm' && st.approvedBy === undefined && !(st.gms || []).some((g) => near(g, block, Number(C.gmRangeMeters)))) { end(block, 'No GM is at the block any more. There is no execution.', true); continue; }
      if (st.phase !== 'kneeling' && now - st.at > Number(C.approvalSeconds) * 1000) end(block, 'Nobody decided in time. There is no execution.', true);
    }
  });

  globalThis.__dboExecutionState = () => [...S.blocks].map(([b, st]) => Object.assign({ block: b }, st));
  log(`execution ${C.enabled === false ? 'off' : 'on'}: ${BASES.size} block base(s), GM within ${C.gmRangeMeters} m`);
};
