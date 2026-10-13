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
//      or nothing happens. Every GM in range gets a panel: approve or refuse. The GM who decides is a third party: never
//      the headsman nor the one at the block (13 Oct: a GM could approve the beheading they were about to do).
//   3. Approved, the headsman confirms in a panel of their own. The approving GM must stay within gmRangeMeters until
//      then (a judge presides over the sentence; 13 Oct: the GM could approve and walk off), or there is no execution.
//   4. Every player within watchMeters is sent dboExecute (each plays the pair on its copies: the victim's clip takes the
//      head at 11.8 s); chopMs (16.7 s, the clip's KillActor) later the victim's character ends for good
//      (supernatural.js __dboPermaKill), audited and posted to the staff log. Once the headsman has confirmed the blow
//      falls: standing up, walking off or logging out during the clip no longer cancels it (13 Oct: the victim could
//      stand up or walk 5 m during the swing and escape). The death still waits for chopMs, the clip's KillActor.
// Anything before the headsman confirms that breaks it - the victim or headsman stepping away or leaving, a refusal, approvalSeconds passing - ends
// the attempt, and everyone in it is told.
//
// Getting up (13 Oct 20:30Z: the headsman stayed seated after the execution, and every player who ever knelt here before
// it was stuck too until /unstuck): this furniture never lets a player stand. Each E press while seated reaches the
// server as an activation, and the fork's TryOccupyFurniture answers an occupant's activation by seating them again
// ("already occupies it, seating again", 41 times at this block on 13 Oct, against a fresh "seated" each time at an
// ordinary chair). So the server stands them: whoever this module seated (the victim kneeling, the headsman with the axe)
// and is still at the block when the attempt ends - done, refused, cancelled, timed out, or by their own E press - is
// moved standUnits from the block's origin, the way /unstuck moves a player (locationalData). That takes them out of the
// furniture on their own screen (the client's teleport), their client's closing activation frees the seat, and past the
// fork's 256-unit furniture reach the seat is stale on the server anyway. Their own E press is refused (false) so the
// engine does not seat them again, and repeats within repeatMs of the one handled are ignored (one press can arrive twice
// in a millisecond, 20:27:35.880). Config "execution": { enabled, blockBases, idle, gmRangeMeters, reachMeters,
// watchMeters, chopMs, approvalSeconds, standUnits, repeatMs }. Hot reload.
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
    // Where a seated player is set down, from the block's origin: past the fork's 256-unit furniture reach (the seat goes
    // stale) and its 3 m reachMeters (210 units). The seats themselves are about 110 units out
    standUnits: 280, repeatMs: 1500,
  }, (cfg && cfg.execution) || {});
  const PANEL_ID = 83; // 81 is the couriers board (widget-ids-harness)
  const S = globalThis.__dboExecState || (globalThis.__dboExecState = { blocks: new Map(), baseOf: new Map() });
  // block -> Set of the players this module let the engine seat there; actor:block -> when their last activation was handled
  if (!(S.seated instanceof Map)) S.seated = new Map();
  if (!(S.lastUse instanceof Map)) S.lastUse = new Map();

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
  // The GMs who may decide: in range, and neither the victim nor the headsman
  const gmsNear = (block, st) => onlineActors().filter((g) => isAdmin(g) && near(g, block, Number(C.gmRangeMeters))
    && (!st || ((g >>> 0) !== (st.victim >>> 0) && (g >>> 0) !== (st.executioner >>> 0))));
  const nonce = () => Math.random().toString(36).slice(2, 10);

  const seatedAt = (block) => { let s = S.seated.get(block); if (!s) S.seated.set(block, (s = new Set())); return s; };
  const isSeated = (block, a) => !!(S.seated.get(block) && S.seated.get(block).has(a >>> 0));
  const dead = (a) => { try { return !!mp.get(a, 'isDead'); } catch (e) { return false; } };
  // Stands a player this module seated: set down standUnits from the block, away from it, facing as they were. Nobody
  // else is moved, nor anyone who already left the block, died there or logged out (their seat is stale on the server)
  const release = (block, a) => {
    a = a >>> 0;
    const seats = S.seated.get(block);
    if (!seats || !seats.delete(a)) return false;
    if (!seats.size) S.seated.delete(block);
    if (!near(a, block, Number(C.reachMeters)) || dead(a)) return false;
    try {
      const loc = mp.get(a, 'locationalData'), b = mp.get(block, 'pos');
      if (!loc || !Array.isArray(loc.pos) || !Array.isArray(b)) return false;
      let dx = loc.pos[0] - b[0], dy = loc.pos[1] - b[1];
      const len = Math.hypot(dx, dy);
      if (len < 1) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
      const out = Number(C.standUnits) || 280;
      mp.set(a, 'locationalData', { cellOrWorldDesc: loc.cellOrWorldDesc, pos: [b[0] + dx * out, b[1] + dy * out, loc.pos[2] + 8], rot: loc.rot || [0, 0, 0] });
      log(`execution: ${nameOf(a)} stood up from the block at ${block.toString(16)}`);
      return true;
    } catch (e) { log(`execution: standing ${a.toString(16)} up failed: ${e.message}`); return false; }
  };

  const end = (block, why, tellAll) => {
    const st = S.blocks.get(block);
    if (!st) return;
    S.blocks.delete(block);
    for (const a of [st.victim, st.executioner, ...(st.gms || [])].filter(Boolean)) {
      try { closeWidget(a, PANEL_ID); } catch (e) { /* offline */ }
      if (tellAll && why) { try { personal(a, why); } catch (e) { /* offline */ } }
    }
    // Every end stands both: the block never lets them up itself
    for (const a of [st.victim, st.executioner].filter(Boolean)) release(block, a);
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
    // One press can arrive twice within a millisecond: only the first is handled, and the repeat seats nobody
    const useKey = `${a}:${block}`, now = Date.now();
    if (now - (S.lastUse.get(useKey) || 0) < Number(C.repeatMs)) return false;
    S.lastUse.set(useKey, now);
    if (S.lastUse.size > 500) for (const [k, t] of S.lastUse) if (now - t > 60000) S.lastUse.delete(k);
    // Once the headsman has confirmed, nothing at the block changes it: the victim cannot stand up, nobody else can use it
    if (st && st.phase === 'chopping') {
      personal(a, a === st.victim ? 'The axe is already falling. You cannot rise now.' : 'An execution is under way here.');
      return false;
    }
    // A victim who is gone frees the block
    if (st && !near(st.victim, block, Number(C.reachMeters))) { end(block, 'The one at the block is gone.', true); st = null; }
    // Someone this module seated, pressing E again, wants up: refused, or the engine would seat them again
    if (!st && isSeated(block, a)) { release(block, a); personal(a, 'You rise from the block.'); return false; }
    if (!st) {
      S.blocks.set(block, { victim: a, phase: 'kneeling', at: Date.now() });
      seatedAt(block).add(a);
      personal(a, 'You kneel and lay your head on the block. Nothing more happens unless a GM allows an execution; use the block again to rise.');
      return undefined;
    }
    if (st.victim === a) {   // getting up
      if (st.phase !== 'kneeling') { end(block, `${nameOf(a)} rose from the block. There is no execution.`, true); return false; }
      end(block, '', false); personal(a, 'You rise from the block.'); return false;
    }
    if (st.executioner === a) { end(block, `${nameOf(a)} stepped away from the block. There is no execution.`, true); return false; }
    if (st.phase !== 'kneeling') { personal(a, 'An execution is already under way here.'); return false; }
    const gms = gmsNear(block, { victim: st.victim, executioner: a });
    if (!gms.length) {
      personal(a, `An execution needs a GM (not a Trial GM) here, within ${C.gmRangeMeters} m, to approve it, and that GM cannot be the headsman or the one at the block.`);
      return false;
    }
    Object.assign(st, { executioner: a, phase: 'awaitGm', at: Date.now(), nonce: nonce(), gms });
    seatedAt(block).add(a);
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
      // No distance check here: once confirmed the blow lands, wherever the victim went during the clip (logged out too)
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
      if ((a >>> 0) === (st.executioner >>> 0) || (a >>> 0) === (st.victim >>> 0)) return personal(a, 'You cannot decide an execution you take part in. Another GM must approve or refuse it.');
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
    // The approving GM presides until the blow: gone before the confirm, there is no execution
    if (!isAdmin(st.approvedBy) || !near(st.approvedBy, block, Number(C.gmRangeMeters))) return end(block, `GM ${nameOf(st.approvedBy)}, who allowed the execution, is no longer at the block. There is no execution.`, true);
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
      if (st.phase === 'awaitHeadsman' && !near(st.approvedBy, block, Number(C.gmRangeMeters))) { end(block, `GM ${nameOf(st.approvedBy)}, who allowed the execution, left the block. There is no execution.`, true); continue; }
      if (st.phase !== 'kneeling' && now - st.at > Number(C.approvalSeconds) * 1000) end(block, 'Nobody decided in time. There is no execution.', true);
    }
    // A seated player who left another way (/unstuck, a logout, a door) is no longer at the block: forget them, so the
    // next time they kneel is a kneel and not a getting up
    for (const [block, seats] of [...S.seated]) {
      const st = S.blocks.get(block);
      for (const a of [...seats]) {
        if (st && st.phase === 'chopping' && (a === st.victim || a === st.executioner)) continue;
        if (!near(a, block, Number(C.reachMeters) + 2)) seats.delete(a);
      }
      if (!seats.size) S.seated.delete(block);
    }
  });

  globalThis.__dboExecutionState = () => [...S.blocks].map(([b, st]) => Object.assign({ block: b }, st));
  log(`execution ${C.enabled === false ? 'off' : 'on'}: ${BASES.size} block base(s), GM within ${C.gmRangeMeters} m`);
};
