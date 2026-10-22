// DragonBreak Online: Nordic lever puzzles, run by the server (Nate, 21 Oct: "highgate ruins puzzle door is blocking
// players from reaching the dragon priest, we need to make sure either puzzle scripts work or disable that door").
// Loaded by gamemode.js; config "leverPuzzles".
//
// High Gate Ruins: four levers, each under a carved sign, drop the floor trapdoor to the lower halls and Vokun. Vanilla
// runs this as highGateRuinsLeverPuzzle on each lever (Skyrim - Misc.bsa), and the server's VM runs it too, but it can
// never be solved there: the four flames it checks (43b1b..43b1e) are not in the server's world, so every pull is
// "wrong", and the trapdoor it opens (02fa13) was deleted by DragonBreak Online Edits, which placed a copy (1d201d) that
// nothing drives. Players pulled Eagle, Whale, Fox, Snake (the right order) again and again on 21 Oct.
//
// So a known lever is handled here instead of by the engine, with the script's own rules (disassembled 21 Oct): a sign is
// lit by a right pull, and a wrong pull springs the lever back up and changes nothing. The last sign opens the trapdoor
// (isOpen, which every client in the cell applies and a newcomer receives with the door). When the dungeon's lease ends
// (dungeons.js endLease) the levers come back up and the trapdoor shuts for the next party.
'use strict';

const PUZZLES = [
  {
    id: 'HighGateRuins', lease: 'HighGateRuinsLocation', name: 'High Gate Ruins',
    door: '1d201d:DragonBreak Online Edits.esp',
    say: 'With a grinding of stone, the floor gives way to the halls below.',
    // needs: signs that must be lit first; forbids: signs that must not be lit yet (highGateRuinsLeverPuzzle onActivate)
    levers: [
      { ref: '50f7b:Skyrim.esm', sign: 'eagle', forbids: ['eagle', 'fox', 'whale', 'snake'] },
      { ref: '50f72:Skyrim.esm', sign: 'fox', forbids: ['snake', 'fox'] },
      { ref: '41c97:Skyrim.esm', sign: 'whale', needs: ['eagle'] },
      { ref: '41c95:Skyrim.esm', sign: 'snake', needs: ['fox'], opens: true },
    ],
  },
];

module.exports = (api) => {
  const { mp, log, cfg, personal, audit, who, registerChatCommand } = api;
  const C = Object.assign({ enabled: true, springBackMs: 1000 }, cfg.leverPuzzles || {});
  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };
  const play = (desc, anim) => {
    try { mp.callPapyrusFunction('method', 'ObjectReference', 'PlayAnimation', { type: 'form', desc }, [anim]); return true; } catch (e) { log(`leverpuzzles: ${anim} on ${desc} failed: ${e.message}`); return false; }
  };
  const setDoor = (p, open) => {
    const id = idOf(p.door);
    if (!id) { log(`leverpuzzles: ${p.name} door ${p.door} not found`); return false; }
    try { mp.set(id, 'isOpen', open); return true; } catch (e) { log(`leverpuzzles: ${p.name} door ${open ? 'open' : 'close'} failed: ${e.message}`); return false; }
  };

  // lever refId -> { puzzle, lever }
  const byLever = new Map();
  for (const p of PUZZLES) for (const l of p.levers) { const id = idOf(l.ref); if (id) byLever.set(id, { p, l }); else log(`leverpuzzles: ${l.ref} in ${p.name} not found`); }
  // Lit signs per puzzle (survive hot reloads): puzzle id -> Set of signs
  const S = globalThis.__dboLeverPuzzles || (globalThis.__dboLeverPuzzles = { lit: new Map() });
  const litOf = (p) => { let s = S.lit.get(p.id); if (!s) { s = new Set(); S.lit.set(p.id, s); } return s; };

  // true: ours, and the engine's activation (the vanilla script, which can only fail here) is blocked
  globalThis.__dboLeverPuzzle = (targetId, casterId) => {
    if (!C.enabled) return false;
    const hit = byLever.get(targetId >>> 0);
    if (!hit) return false;
    const { p, l } = hit; const lit = litOf(p);
    if (lit.has(l.sign)) { personal(casterId, 'The lever is locked down.'); return true; }
    play(l.ref, 'FullPush');
    const right = (l.needs || []).every((s) => lit.has(s)) && !(l.forbids || []).some((s) => lit.has(s));
    if (!right) {
      setTimeout(() => play(l.ref, 'FullPull'), C.springBackMs);
      personal(casterId, 'The lever springs back up. Nothing else stirs.');
      return true;
    }
    lit.add(l.sign);
    if (l.opens) {
      const ok = setDoor(p, true);
      audit(`LEVERPUZZLE ${who(casterId)} solved ${p.name}${ok ? '' : ' (the door did not open)'}`);
      personal(casterId, p.say);
    } else personal(casterId, 'The lever locks down with a heavy click.');
    return true;
  };

  const reset = (p) => {
    const lit = litOf(p);
    for (const l of p.levers) if (lit.has(l.sign)) play(l.ref, 'FullPull');
    lit.clear();
    setDoor(p, false);
  };
  // dungeons.js endLease: levers up, trapdoor shut, ready for the next party
  globalThis.__dboLeverPuzzleLeaseEnded = (leaseId) => {
    for (const p of PUZZLES) if (p.lease === leaseId) { reset(p); log(`leverpuzzles: ${p.name} lease over, levers reset and the door shut`); }
  };

  // Staff: /leverpuzzle open|reset <puzzle id> (a fallback should a door not move for someone)
  if (typeof registerChatCommand === 'function') registerChatCommand('leverpuzzle', (a, args) => {
    if (!(globalThis.__dboIsStaff && globalThis.__dboIsStaff(a))) return personal(a, 'Staff only.');
    const [what, id] = String(args || '').trim().split(/\s+/);
    const p = PUZZLES.find((x) => x.id.toLowerCase() === String(id || '').toLowerCase());
    if (!p || !['open', 'reset'].includes(what)) return personal(a, `Usage: /leverpuzzle open|reset <${PUZZLES.map((x) => x.id).join('|')}>`);
    if (what === 'open') { for (const l of p.levers) litOf(p).add(l.sign); const ok = setDoor(p, true); audit(`LEVERPUZZLE GM ${who(a)} opened ${p.name}`); return personal(a, ok ? `${p.name}: the door is open.` : `${p.name}: the door could not be opened (see the log).`); }
    reset(p); audit(`LEVERPUZZLE GM ${who(a)} reset ${p.name}`); return personal(a, `${p.name}: levers up, door shut.`);
  }, { admin: true, hidden: true, help: 'open|reset <puzzle id>: open a lever puzzle\'s door, or reset it, should it not move' });

  log(`leverpuzzles ${C.enabled ? 'on' : 'off'}: ${byLever.size} levers in ${PUZZLES.length} puzzles`);
};
