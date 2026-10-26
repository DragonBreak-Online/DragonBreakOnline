'use strict';
// No child is played (Nat, 26 Oct: "NOOO"). Loaded by gamemode.js; its appearance hook (a RaceMenu close the server opened:
// creation, a reroll, a GM's /chargen, a player's /appearance) asks globalThis.__dboChildRaceGuard.
//
// RaceMenu lists only Playable races, and no child race is playable in the live order: a scan of the 143 plugins on 26 Oct
// found the 15 playable races racial.js knows and every race with the Child flag (RACE DATA flags 0x4, the uint32 at 32)
// non-playable. But the engine applies whatever race a client's close hands back (ActionListener::OnUpdateAppearance applies
// it before the gamemode hears of it), so a modified client could still send one, and nothing else refused it. A look on a
// child race is set to an adult race once the close has settled, the way gamemode's goblinLook sets a goblin back.
// A child race: the Child flag, or an editor id that names a child (Summerset's LodgeChildRace and Arnima's
// BretonRaceChildArnima carry no flag). The adult race is the one the look's editor id names without "Child"
// (NordRaceChild -> NordRace, DunmerRaceChild -> DarkElfRace) when it is a playable race, else the Nord.
// Height cannot make a child either: appearanceextras.js holds the body's scale chain to 0.9-1.1.

const CHILD_FLAG = 0x4;
const PLAYABLE_FLAG = 0x1;
const SETTLE_MS = 2000;
const NORD = 0x00013746; // Skyrim.esm NordRace
// Adult races by the stem a child race's editor id leaves once "Child" (and what follows it) is cut
const ADULT_BY_STEM = { nordrace: 0x13746, bretonrace: 0x13741, imperialrace: 0x13744, redguardrace: 0x13748, dunmerrace: 0x13742, darkelfrace: 0x13742, highelfrace: 0x13743, woodelfrace: 0x13749, orcrace: 0x13747, khajiitrace: 0x13745, argonianrace: 0x13740 };

module.exports = ({ mp, log, personal, display, settleMs = SETTLE_MS }) => {
  const cache = new Map();
  const raceInfo = (raceId) => {
    const id = Number(raceId) >>> 0;
    if (!id) return null;
    if (cache.has(id)) return cache.get(id);
    let info = null;
    try {
      const r = mp.lookupEspmRecordById(id);
      const rec = r && r.record;
      if (rec && String(rec.type) === 'RACE') {
        const data = (rec.fields || []).find((f) => f && f.type === 'DATA' && f.data instanceof Uint8Array && f.data.byteLength >= 36);
        const flags = data ? new DataView(data.data.buffer, data.data.byteOffset, data.data.byteLength).getUint32(32, true) : 0;
        const edid = String(rec.editorId || '');
        info = { id, edid, flags, child: (flags & CHILD_FLAG) !== 0 || /child/i.test(edid), playable: (flags & PLAYABLE_FLAG) !== 0 };
      }
    } catch (e) { info = null; }
    cache.set(id, info);
    return info;
  };
  const isChildRace = (raceId) => { const i = raceInfo(raceId); return !!(i && i.child); };
  const adultFor = (raceId) => {
    const i = raceInfo(raceId);
    const stem = i ? i.edid.replace(/child.*$/i, '').toLowerCase() : '';
    const want = ADULT_BY_STEM[stem];
    const w = want ? raceInfo(want) : null;
    return w && w.playable && !w.child ? want : NORD;
  };

  // The appearance hook's call: a close that came back on a child race is put right once it has settled
  const guard = (actorId, appearance) => {
    const a = Number(actorId) >>> 0;
    if (!a || !appearance || !isChildRace(appearance.raceId)) return false;
    setTimeout(() => {
      try {
        const cur = mp.get(a, 'appearance');
        if (!cur || !isChildRace(cur.raceId)) return;
        const from = raceInfo(cur.raceId), to = adultFor(cur.raceId);
        mp.set(a, 'appearance', Object.assign({}, cur, { raceId: to }));
        personal(a, 'Children cannot be played. Your character is an adult of your people.');
        log(`childrace: ${display(a)} closed the race menu on the child race ${from ? from.edid : ''} (${(Number(cur.raceId) >>> 0).toString(16)}); set to the adult race ${to.toString(16)}`);
      } catch (e) { log('childrace: reset failed', e.message); }
    }, settleMs);
    return true;
  };
  globalThis.__dboChildRaceGuard = guard;
  return { guard, isChildRace, adultFor, raceInfo };
};
