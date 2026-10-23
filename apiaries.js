// DragonBreak Online: apiaries and beehives give honey on a timer (Nate, 23 Oct: "can you make apiaries work and give honey
// by a timer"). Loaded by gamemode.js; config "apiaries".
//
// An apiary (Hearthfire's BYOHBYOHApiary, Beyond Skyrim's BSKApiaryBeehive) and a wild beehive (BeeHive) are containers
// filled from leveled lists, and the server never refills a container, so once emptied each stayed empty for good. Here
// a known hive is handled instead of opened: when its time has come round it gives its honey to whoever tends it, and
// tells anyone earlier how long the bees still need. Each hive keeps its own timer (apiaries.json beside the server, so a
// restart keeps it).
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, cfg, giveItem } = api;
  const C = Object.assign({
    enabled: true,
    // base desc -> kind
    hives: { '12a54:HearthFires.esm': 'apiary', '602b45:BSAssets.esm': 'apiary', 'a918c:Skyrim.esm': 'wild' },
    // per kind: minutes between harvests, honeycombs [min, max], and a chance each of a bee and a beehive husk
    kinds: {
      apiary: { minutes: 60, honeycomb: [2, 4], bee: 0.5, husk: 0.25 },
      wild: { minutes: 120, honeycomb: [1, 2], bee: 0.25, husk: 0.4 },
    },
  }, cfg.apiaries || {});
  const HONEYCOMB = 'b08c5:Skyrim.esm', BEE = 'a9195:Skyrim.esm', HUSK = 'a9191:Skyrim.esm';
  const FILE = path.resolve('apiaries.json');
  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };
  const kindById = new Map();
  for (const [desc, kind] of Object.entries(C.hives || {})) { const id = idOf(desc); if (id) kindById.set(id, kind); }

  const S = globalThis.__dboApiaries || (globalThis.__dboApiaries = { last: null });
  if (!S.last) { try { S.last = JSON.parse(fs.readFileSync(FILE, 'utf8')).last || {}; } catch (e) { S.last = {}; } }
  const save = () => { try { fs.writeFileSync(FILE + '.tmp', JSON.stringify({ last: S.last })); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { log('apiaries: save failed', e.message); } };
  const roll = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

  // The activate chain: true when the hive is ours (its container is never opened)
  globalThis.__dboApiaryActivate = (target, caster) => {
    if (!C.enabled) return false;
    let base = 0; try { base = idOf(mp.get(target >>> 0, 'baseDesc')); } catch (e) { return false; }
    const kind = kindById.get(base); if (!kind) return false;
    const K = (C.kinds || {})[kind]; if (!K) return false;
    const key = (target >>> 0).toString(16), now = Date.now();
    const ready = (Number(S.last[key]) || 0) + Number(K.minutes) * 60000;
    if (now < ready) {
      const mins = Math.ceil((ready - now) / 60000);
      personal(caster, `The bees are still at work. Come back in ${mins} minute${mins === 1 ? '' : 's'}.`);
      return true;
    }
    const combs = roll(Number(K.honeycomb[0]) || 1, Number(K.honeycomb[1]) || 1);
    const got = [];
    if (giveItem(caster, idOf(HONEYCOMB), combs)) got.push(`${combs} Honeycomb`);
    if (Math.random() < Number(K.bee) && giveItem(caster, idOf(BEE), 1)) got.push('a Bee');
    if (Math.random() < Number(K.husk) && giveItem(caster, idOf(HUSK), 1)) got.push('a Beehive Husk');
    if (!got.length) { personal(caster, 'The hive gives nothing just now.'); return true; }
    S.last[key] = now; save();
    personal(caster, `You gather ${got.join(', ')} from the ${kind === 'apiary' ? 'apiary' : 'beehive'}.`);
    audit(`APIARY ${who(caster)} harvested ${kind} ${key}: ${got.join(', ')}`);
    return true;
  };

  log(`apiaries ${C.enabled ? 'on' : 'off'}: ${kindById.size} hive kinds, ${Object.keys(S.last).length} hives tended`);
};
