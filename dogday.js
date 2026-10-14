// The Dog Day event (Nate, 13 Oct 2026: "only launch it on March 5th 2027, an event where all enemies drop dog meat").
// Loaded by gamemode.js; dormant until `startsAt`, it switches itself on and off by the clock, so nothing is deployed on
// the day. Cooking dog meat is open all year (Jake, 14 Oct: DragonBreak Online Edits' DBO_RecipeFoodDogMeatCooked, Salt
// Pile + Dog Meat at a cookpot, no conditions); the event only adds the drops.
//   - While it runs, every enemy a player kills (a server-spawned NPC: dungeon, expedition, wildlife; never a player or a
//     companion) hands the killer `perKill` raw Dog Meat (FoodDogMeat, 0xedb2e:Skyrim.esm). Corpse inventories are not
//     what players loot (dungeons.js trims them and creature bodies are never opened), so the meat goes to the killer.
// Config "dogDay": { enabled, startsAt, endsAt (ISO, UTC), meat, perKill: [min, max] }
'use strict';

module.exports = (api) => {
  const { mp, cfg, log, personal, giveItem, profileOf } = api;
  const C = Object.assign({ enabled: true, startsAt: '2027-03-05T00:00:00Z', endsAt: '2027-03-06T00:00:00Z', meat: 'edb2e:Skyrim.esm',
    perKill: [1, 2] }, cfg.dogDay || {});
  const START = Date.parse(C.startsAt), END = Date.parse(C.endsAt);
  const on = (now) => C.enabled && Number.isFinite(START) && Number.isFinite(END) && now >= START && now < END;
  let MEAT = 0;
  try { MEAT = mp.getIdFromDesc(C.meat) >>> 0; } catch (e) { log('dogday: no meat form', C.meat, e.message); }
  const [lo, hi] = Array.isArray(C.perKill) ? C.perKill.map((n) => Math.max(0, Math.floor(Number(n) || 0))) : [1, 1];
  const roll = () => lo + Math.floor(Math.random() * (Math.max(lo, hi) - lo + 1));
  const prop = (a, k) => { try { return mp.get(a, k); } catch (e) { return undefined; } };

  globalThis.__dboDogDayOn = (now) => on(Number.isFinite(now) ? now : Date.now());

  // gamemode.js deathHook
  globalThis.__dboDogDayDeath = (victim, killer, now) => {
    if (!on(Number.isFinite(now) ? now : Date.now()) || !MEAT || !killer || victim === killer) return;
    if (!prop(victim, 'private.npcSpawner') || prop(victim, 'private.dboCompanion')) return;
    if (!(profileOf(killer) >= 0) || prop(killer, 'private.npcSpawner')) return;
    const n = roll();
    if (n <= 0 || !giveItem(killer, MEAT, n)) return;
    personal(killer, n === 1 ? 'Dog Day: you take a piece of dog meat from the body.' : `Dog Day: you take ${n} pieces of dog meat from the body.`);
  };

  log(`dogday: ${C.enabled ? `${on(Date.now()) ? 'RUNNING' : 'waiting'} ${C.startsAt} to ${C.endsAt}, ${lo}-${Math.max(lo, hi)} meat a kill` : 'off'}`);
};
