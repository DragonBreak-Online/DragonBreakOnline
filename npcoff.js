'use strict';
// DragonBreak Online: Skyrim's plugin-placed people and animals, kept disabled by the server (Nate, 16 Oct: "Server spawns
// only, like normal", "empty like Bruma"). Loaded by gamemode.js; data npc-off.json (NPC pass 2's exact list, 3,493 refs),
// config "npcOff".
//
// Bruma's own plugin actors are disabled in the DLE; Skyrim's pass 2 waits on an xEdit run on the PC. Until then the server
// sets isDisabled on each listed ref: the client disables any plugin ref (id below 0xff000000) whose isDisabled comes in,
// actors included (remoteServer.ts skipFormViewCreation -> ModelApplyUtils.applyModelIsDisabled), and the flag lives in the
// ref's change form, so it survives a restart. Once the pass 2 plugins ship the refs are disabled there too and this is a
// no-op.
//
// The refs are set in batches (perTick every tickMs) so a hot reload never stalls the main loop. "enabled": false enables
// every listed ref again on the next load (the undo). Nothing outside the list is touched.
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log } = api;
  const cfg = api.cfg || {};
  const C = Object.assign({ enabled: true, perTick: 50, tickMs: 250, startDelayMs: 5000 }, cfg.npcOff || {});
  let DATA = { refs: [] };
  try { DATA = JSON.parse(fs.readFileSync(path.resolve('npc-off.json'), 'utf8')); } catch (e) { log('npcoff: npc-off.json unreadable:', e.message); return; }
  const refs = (DATA.refs || []).map((r) => String(Array.isArray(r) ? r[0] : r)).filter(Boolean);
  const want = C.enabled !== false;

  // one pass per load; a reload stops the previous pass
  const S = globalThis.__dboNpcOff || (globalThis.__dboNpcOff = { timer: null, run: 0 });
  if (S.timer) { clearTimeout(S.timer); S.timer = null; }
  const run = ++S.run;

  const idOf = (desc) => { try { return mp.getIdFromDesc(desc) >>> 0; } catch (e) { return 0; } };
  const counts = { set: 0, already: 0, missing: 0, failed: 0 };
  const missing = [];
  let i = 0;
  const step = () => {
    S.timer = null;
    if (run !== S.run) return;
    const end = Math.min(refs.length, i + Math.max(1, Number(C.perTick) || 50));
    for (; i < end; i++) {
      const id = idOf(refs[i]);
      if (!id) { counts.missing++; if (missing.length < 10) missing.push(refs[i]); continue; }
      try {
        if ((mp.get(id, 'isDisabled') === true) === want) { counts.already++; continue; }
        mp.set(id, 'isDisabled', want);
        counts.set++;
      } catch (e) {
        counts.failed++;
        if (counts.failed <= 5) log(`npcoff: isDisabled ${want} on ${refs[i]} failed: ${e.message}`);
      }
    }
    if (i < refs.length) { S.timer = setTimeout(step, Math.max(10, Number(C.tickMs) || 250)); return; }
    log(`npcoff: ${want ? 'disabled' : 'enabled again'} ${counts.set} of ${refs.length} plugin actor(s); ${counts.already} already so, ${counts.missing} not found${missing.length ? ` (${missing.join(', ')})` : ''}, ${counts.failed} failed`);
  };
  S.timer = setTimeout(step, Math.max(0, Number(C.startDelayMs) || 0));
  globalThis.__dboNpcOffStatus = () => ({ want, total: refs.length, done: i, ...counts });
};
