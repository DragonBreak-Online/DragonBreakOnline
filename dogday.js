// The Dog Day event (Nate, 13 Oct 2026: "add the ability to cook dog meat, but only launch it on March 5th 2027, an event
// where all enemies drop dog meat"). Loaded by gamemode.js; dormant until `startsAt`, it switches itself on and off by the
// clock, so nothing is deployed on the day.
//   - While it runs, every enemy a player kills (a server-spawned NPC: dungeon, expedition, wildlife; never a player or a
//     companion) hands the killer `perKill` raw Dog Meat (FoodDogMeat, 0xedb2e:Skyrim.esm). Corpse inventories are not
//     what players loot (dungeons.js trims them and creature bodies are never opened), so the meat goes to the killer.
//   - Cooked Dog Meat is a cookpot recipe made on the PC (DragonBreak Online Edits: an ALCH with editor id `cookedEdid`
//     and its COBJ at CraftingCookpot). regions.js asks __dboDogDayCraft, which refuses it outside the event; a refused
//     craft gives the materials back when the menu closes, so the recipe may ship before the day.
// Config "dogDay": { enabled, startsAt, endsAt (ISO, UTC), meat, perKill: [min, max], cookedEdid }
'use strict';

module.exports = (api) => {
  const { mp, cfg, log, personal, giveItem, profileOf } = api;
  const C = Object.assign({ enabled: true, startsAt: '2027-03-05T00:00:00Z', endsAt: '2027-03-06T00:00:00Z', meat: 'edb2e:Skyrim.esm',
    perKill: [1, 2], cookedEdid: 'DBO_FoodDogMeatCooked' }, cfg.dogDay || {});
  const START = Date.parse(C.startsAt), END = Date.parse(C.endsAt);
  const on = (now) => C.enabled && Number.isFinite(START) && Number.isFinite(END) && now >= START && now < END;
  let MEAT = 0;
  try { MEAT = mp.getIdFromDesc(C.meat) >>> 0; } catch (e) { log('dogday: no meat form', C.meat, e.message); }
  const [lo, hi] = Array.isArray(C.perKill) ? C.perKill.map((n) => Math.max(0, Math.floor(Number(n) || 0))) : [1, 1];
  const roll = () => lo + Math.floor(Math.random() * (Math.max(lo, hi) - lo + 1));
  const prop = (a, k) => { try { return mp.get(a, k); } catch (e) { return undefined; } };
  const edidOf = (id) => { try { const r = mp.lookupEspmRecordById(id >>> 0); return r && r.record ? String(r.record.editorId || '') : ''; } catch (e) { return ''; } };

  globalThis.__dboDogDayOn = (now) => on(Number.isFinite(now) ? now : Date.now());

  // regions.js craftHook: the refusal's text for Cooked Dog Meat outside the event, else ''
  globalThis.__dboDogDayCraft = (a, itemId, now) => {
    if (!C.cookedEdid || edidOf(itemId) !== C.cookedEdid) return '';
    if (on(Number.isFinite(now) ? now : Date.now())) return '';
    return 'Dog meat is only cooked on Dog Day. Your materials come back when you close the menu.';
  };

  // gamemode.js deathHook
  globalThis.__dboDogDayDeath = (victim, killer, now) => {
    if (!on(Number.isFinite(now) ? now : Date.now()) || !MEAT || !killer || victim === killer) return;
    if (!prop(victim, 'private.npcSpawner') || prop(victim, 'private.dboCompanion')) return;
    if (!(profileOf(killer) >= 0) || prop(killer, 'private.npcSpawner')) return;
    const n = roll();
    if (n <= 0 || !giveItem(killer, MEAT, n)) return;
    personal(killer, n === 1 ? 'Dog Day: you take a piece of dog meat from the body.' : `Dog Day: you take ${n} pieces of dog meat from the body.`);
  };

  log(`dogday: ${C.enabled ? `${on(Date.now()) ? 'RUNNING' : 'waiting'} ${C.startsAt} to ${C.endsAt}, ${lo}-${Math.max(lo, hi)} meat a kill, cooks ${C.cookedEdid}` : 'off'}`);
};
