// faction-gear.json against the rest of the data (Nat via the Leader, 26 Oct: "fix any discrepancies like the Malacath
// hood"). Data only, no server. Fails when:
//   - an entry names a faction guild-defs.json does not have;
//   - its role is not its recipes' bench work (tailor: a loom or tanning rack; blacksmith: a forge), where regions.json
//     knows the bench (the Imperial Knight Cape, a loom recipe, was a smith's until 26 Oct);
//   - a recipe is sold (regions.json, regions-overrides.json recipes) in no province where its factions live (a hold's,
//     a stronghold's or a hall's zone): House Telvanni's guard gear was Solstheim's only while the house sits at Golden Glow;
//   - a refusal would name the makers wrongly (factiongear.js makers(): the strongholds' robes once said the vampire clans').
// KNOWN lists what waits on a decision, with the reason; anything else fails.
//   node tests/faction-gear-audit-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const J = (f) => JSON.parse(fs.readFileSync(path.join(SERVER, f), 'utf8'));
let fails = 0;
const ok = (what, c, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 600)}`); if (!c) fails++; };

const gear = J('faction-gear.json').items;
const defs = J('guild-defs.json').factions;
const F = new Map(defs.map((f) => [f.id, f]));
const R = J('regions.json');
const O = J('regions-overrides.json');
const norm = (d) => { const i = d.indexOf(':'); return `${parseInt(d.slice(0, i), 16).toString(16)}:${d.slice(i + 1).toLowerCase()}`; };
const recipes = {}; for (const [k, v] of Object.entries(R.recipes || {})) recipes[norm(k)] = v;
const OR = {}; for (const [k, v] of Object.entries(O.recipes || {})) if (k[0] !== '_') OR[k.includes(':') ? norm(k) : k.toLowerCase()] = v;
const LIVE = ['cyrodiil', 'skyrim', 'solstheim'];
const resolve = (t, d = 0) => {
  if (d > 5 || t == null) return null;
  if (Array.isArray(t)) { const o = t.map((x) => resolve(x, d + 1)); return o.some((x) => x === null) ? null : LIVE.filter((p) => o.some((x) => x.includes(p))); }
  t = String(t).toLowerCase();
  if (t === 'common') return LIVE.slice(); if (t === 'none') return []; if (LIVE.includes(t)) return [t];
  if (O.families && O.families[t] !== undefined) return resolve(O.families[t], d + 1);
  if (O.aliases && O.aliases[t] !== undefined) return resolve(O.aliases[t], d + 1);
  return null;
};
const SKYRIM_ZONES = /whiterun|riften|solitude|windhelm|markarth|falkreath|morthal|dawnstar|winterhold/;
const homeOf = (fid) => {
  const f = F.get(fid); if (!f) return '';
  if (f.kind === 'stronghold') return 'skyrim';
  const z = String(f.zone || (f.hall && f.hall.zone) || '').toLowerCase();
  if (SKYRIM_ZONES.test(z)) return 'skyrim';
  if (/bruma/.test(z)) return 'cyrodiil';
  return '';
};
// What waits on a decision (none now: Nat, 26 Oct, sold the Akaviri set in Skyrim too, where the Blades sit)
const KNOWN = {};

const unknown = [], roleBad = [], regionBad = [];
for (const [id, v] of Object.entries(gear)) {
  for (const f of v.factions || []) if (!F.has(f)) unknown.push(`${v.name} -> ${f}`);
  const benches = [...new Set((v.recipes || []).map((r) => (recipes[norm(r)] || {}).bench).filter(Boolean))];
  const role = v.role || 'blacksmith';
  if (benches.length && role === 'tailor' && benches.every((b) => /forge|smith/i.test(b) && !/loom|tanning/i.test(b))) roleBad.push(`${v.name} tailor at ${benches}`);
  if (benches.length && role === 'blacksmith' && benches.every((b) => /loom|tanning/i.test(b))) roleBad.push(`${v.name} blacksmith at ${benches}`);
  const homes = [...new Set((v.factions || []).map(homeOf))].filter(Boolean);
  for (const r of v.recipes || []) {
    const rr = recipes[norm(r)];
    const o = OR[norm(r)] !== undefined ? OR[norm(r)] : OR[String((rr || {}).edid || '').toLowerCase()];
    const where = o !== undefined ? resolve(o) : rr ? resolve(rr.p) : null;
    if (where && homes.length && !homes.some((h) => where.includes(h)) && !KNOWN[norm(r)]) regionBad.push(`${v.name} (${r}) sold ${where} but ${v.factions.join(',')} live in ${homes}`);
  }
}
ok('every faction gear entry names a faction guild-defs.json has', !unknown.length, unknown);
ok('every role matches its recipes\' bench (tailor: loom or tanning rack; blacksmith: forge)', !roleBad.length, roleBad);
ok('every recipe is sold where its factions live (or waits on a listed decision)', !regionBad.length, regionBad);
ok('the Blades\' Akaviri Samurai set is made in Skyrim, where they sit at Sky Haven, and still in Cyrodiil (Nat, 26 Oct)', ['4f25', '4f26', '4f27', '4f28'].every((h) => JSON.stringify(resolve(OR[`${h}:hothtrooper44_armorcompilation.esp`])) === JSON.stringify(['cyrodiil', 'skyrim'])));
ok('House Telvanni\'s guard gear is made in Skyrim, where the house sits, and still in Solstheim', ['849', '84a', '84b', '84c', '84d', '84e'].every((h) => JSON.stringify(resolve(OR[`${h}:dragonbreak nexus patches.esp`])) === JSON.stringify(['skyrim', 'solstheim'])));
const mala = Object.values(gear).filter((v) => v.set === 'Robes of Malacath');
ok('the Robes of Malacath belong to the six strongholds, none of them a vampire clan', mala.length === 2 && mala.every((v) => v.factions.length === 6 && v.factions.every((f) => (F.get(f) || {}).kind === 'stronghold')), mala.map((v) => v.factions));
const fgSrc = fs.readFileSync(path.join(SERVER, 'factiongear.js'), 'utf8');
ok('factiongear.js names makers by kind and set, never by count alone', /every\(\(f\) => factionKind\(f\) === 'stronghold'\)/.test(fgSrc) && /e\.set === 'Vampire clans'/.test(fgSrc) && !/names\.length > 3\) return "the vampire clans'"/.test(fgSrc));
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
