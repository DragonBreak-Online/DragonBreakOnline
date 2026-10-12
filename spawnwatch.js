// DragonBreak Online: the spawn watch. Loaded by gamemode.js.
//
// "Losing gear" (#bugs, hi josue, 11 Oct; tracker 1558656800041996288): "every so often you can spawn in the Riverwood inn and
// keep your gear but if you re log and get back it's all gone". The Sleeping Giant Inn is where Skyrim.esm keeps the player when
// the place in the spawn save cannot be found (HUB_SPAWN_BUG.md), so a game that cannot find the character's world wakes there.
// From then on the server and the game disagree: the server keeps the character where it was (Roland Ebonshield #CEWQ, 10 Oct
// 21:10-21:20, stayed at a764b:BSHeartland.esm 59359,202644,7486 the whole time, /unstuck included), refuses every move and
// every touch from Skyrim (eight "WorldSpace doesn't match" refusals, Riverwood and Dragonsreach), and the snap-back teleports
// never land. Nothing done there is kept, but the game's equipment reports still were: the outfit worn in Riverwood became the
// remembered one (Roland came back re-dressed in the Imperial set he put on there, his TH_Plate0Cuirass taken off), and a
// game that could not see the plugin items saved a shorter favourites list (Pax #ZUAY, 9 Oct 03:40, 3 of 5).
//
// The client already reports 'arrived' with the world it reached after every spawn and teleport (client 641d1a7c0, 16 Sep).
// A login that never reports it is held until it does:
//   - the outfit (private.lastWorn) and the favourites are not overwritten from that game, and the next login does not take
//     the outfit from the equipment that game left stored (private.spawnUnconfirmed survives the logout);
//   - checkSeconds after the game's first equipment report the position is sent again, the same repair fallBackToLanding
//     makes for new characters (Stranger #6HNU, 11 Oct 09:12: the spawn arrival never came, the landing teleport arrived 11 s
//     later);
//   - retrySeconds after that, still nothing: one SPAWN MISS line and a word to the player.
// A game that has sent no equipment report has not finished loading and cannot have arrived yet (Barush Highhammer #C9TM,
// 11 Oct 18:56: 171 s from the login to a live game), so it is never moved or told; the fallbackSeconds timer after the
// login only checks a game that has reported. Until it arrives it is still held.
// Config "spawnWatch": { enabled, checkSeconds, retrySeconds, fallbackSeconds }. enabled:false is the undo (on a reload).
'use strict';

const UNCONFIRMED = 'private.spawnUnconfirmed';

const MESSAGE = 'Your game has not shown your character arriving where they are in the world. If you woke up somewhere in ' +
  'Skyrim, such as the Sleeping Giant Inn in Riverwood, that is not the shared world: nothing you pick up, wear or do there is ' +
  'saved, and your outfit and favourites are kept as they were. Close the game and start it again from the DragonBreak ' +
  'launcher. If it happens again, run Repair Modlist in the launcher.';

module.exports = (api) => {
  const { mp, log } = api;
  const personal = typeof api.personal === 'function' ? api.personal : () => {};
  const display = typeof api.display === 'function' ? api.display : (a) => (a >>> 0).toString(16);
  const userOf = typeof api.userOf === 'function' ? api.userOf : () => 0;
  const creationPending = typeof api.creationPending === 'function' ? api.creationPending : () => false;
  const worldIdOf = typeof api.worldIdOf === 'function' ? api.worldIdOf : () => 0;
  const later = typeof api.setTimeout === 'function' ? api.setTimeout : setTimeout;
  const now = typeof api.now === 'function' ? api.now : () => Date.now();
  const C = Object.assign({ enabled: true, checkSeconds: 30, retrySeconds: 30, fallbackSeconds: 120 }, ((api.cfg || {}).spawnWatch) || {});

  // actorId -> { n, at, stage: 0 waiting | 1 sent again | 2 told, reported, confirmed }; kept across reloads
  const S = globalThis.__dboSpawnWatchState instanceof Map ? globalThis.__dboSpawnWatchState : (globalThis.__dboSpawnWatchState = new Map());
  let seq = Number(globalThis.__dboSpawnWatchSeq) || 0;
  // A check queued by an earlier copy reads this, so enabled:false on a reload also stops those
  globalThis.__dboSpawnWatchOn = C.enabled !== false;

  const placeOf = (a) => {
    let desc = '', pos = null;
    try { desc = String(mp.get(a, 'worldOrCellDesc') || ''); pos = mp.get(a, 'pos'); } catch (e) { /* gone */ }
    return { desc, where: `${desc} ${Array.isArray(pos) ? pos.map((v) => Math.round(Number(v))).join(',') : '?'}` };
  };

  const check = (a, n, stage) => {
    const s = S.get(a);
    if (!s || s.n !== n || s.confirmed || s.stage !== stage || globalThis.__dboSpawnWatchOn === false) return;
    if (userOf(a) < 0) { S.delete(a); return; }   // logged out first; the stored flag speaks for this session at the next login
    const { where } = placeOf(a);
    if (stage === 0) {
      s.stage = 1;
      log(`spawn watch: ${display(a)} has not shown arriving at ${where}; sending the position again`);
      try { mp.set(a, 'locationalData', mp.get(a, 'locationalData')); } catch (e) { log('spawn watch: sending the position failed', e.message); }
      later(() => check(a, n, 1), C.retrySeconds * 1000);
      return;
    }
    s.stage = 2;
    log(`SPAWN MISS ${display(a)}: the game never showed arriving at ${where} (${Math.round((now() - s.at) / 1000)} s after loading in); ` +
      'outfit and favourites from this session are not kept');
    personal(a, MESSAGE);
  };

  // A character loaded in (gamemode.js onCharacterReady). Returns whether the outfit may be taken from the stored equipment:
  // not when the last session's game never arrived, since that equipment is what it wore wherever it really was.
  const login = (a) => {
    a >>>= 0;
    if (C.enabled === false) return true;
    let prior = false;
    try { prior = mp.get(a, UNCONFIRMED) === true; } catch (e) { /* not an actor */ }
    if (prior) log(`spawn watch: ${display(a)}'s last session never showed arriving; its outfit is not taken from that session`);
    if (creationPending(a)) { S.delete(a); return !prior; }   // the creation flow has its own arrival steps
    seq += 1;
    globalThis.__dboSpawnWatchSeq = seq;
    const s = { n: seq, at: now(), stage: 0, reported: false, confirmed: false };
    S.set(a, s);
    try { mp.set(a, UNCONFIRMED, true); } catch (e) { log('spawn watch: flag failed', e.message); }
    // No equipment report yet means the game is still loading (Barush #C9TM took 171 s): a teleport or a "restart your
    // game" then is wrong, and report() arms its own check once the game has loaded
    later(() => { if (s.reported) check(a, s.n, 0); }, C.fallbackSeconds * 1000);
    return !prior;
  };

  // The game's first equipment report: it has loaded, so the arrival report is due within seconds
  const report = (a) => {
    const s = S.get(a >>> 0);
    if (!s || s.confirmed || s.reported) return;
    s.reported = true;
    later(() => check(a >>> 0, s.n, 0), C.checkSeconds * 1000);
  };

  // The client's 'arrived' report: the world or cell its body reached, as the form id the server sent it
  const arrived = (a, worldId) => {
    a >>>= 0;
    const s = S.get(a);
    if (!s || s.confirmed) return;
    const here = worldIdOf(placeOf(a).desc);
    if (here && (Number(worldId) >>> 0) !== here) return;   // an older move's report; the current place is still owed
    s.confirmed = true;
    try { mp.set(a, UNCONFIRMED, false); } catch (e) { log('spawn watch: flag failed', e.message); }
    if (s.stage) log(`spawn watch: ${display(a)} arrived ${s.stage === 1 ? 'once the position was sent again' : 'after the warning'} (${Math.round((now() - s.at) / 1000)} s after loading in)`);
  };

  // True while this session's game has not shown arriving: its outfit and favourites are not written down
  // (enabled:false on a reload lets go of anyone the earlier copy was holding)
  const holding = (a) => { if (C.enabled === false) return false; const s = S.get(a >>> 0); return !!s && !s.confirmed; };

  return { login, report, arrived, holding, MESSAGE };
};
