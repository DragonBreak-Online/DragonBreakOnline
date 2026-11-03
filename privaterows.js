// DragonBreak Online: rows that stay off the public repo. Nat, 2 Nov: data read from the plugins of mods whose authors forbid
// AI work (Druadach, Summerset Isle, King of the Murkmire, Journey to Baan Malur, Morrowind Map Fix) is fine on the server
// but never in the public server branch. A tracked JSON keeps the public rows; a gitignored <name>.private.json beside it
// holds the private ones with the index each had in the whole list, so merging puts every row back exactly where it was.
// The sidecar is delivered by deploy-private. Without it the server runs on the public rows alone, with one log line.
//
// This is the first slice of W1's privaterows spec (_work\private-positions-1102.md): array rows whose desc (row[0],
// "<hex id>:<plugin>") names a private plugin, for admin-powers.json's spells and staffSpells (W6, 2 Nov). The catalogue
// and position rows of the spec join here.
//
// Sidecar: { _comment, lists: { <key>: [ { at, row } ] } }. A gameplay module requires this with its own cache bust:
//   const pr = path.resolve('privaterows.js'); delete require.cache[pr]; const privaterows = require(pr);
'use strict';
const fs = require('fs');
const path = require('path');

const PRIVATE_PLUGINS = ['druadach.esm', 'summersetisles.esp', 'summersetfixes.esp', 'king of the murkmire.esp',
  'murkmire official housing pack.esp', 'journey to baan malur.esp', 'journey to baan malur - dunmeth pass.esp',
  'morrowind map fix.esp'];
const isPrivatePlugin = (p) => PRIVATE_PLUGINS.includes(String(p || '').trim().toLowerCase());
const pluginOfDesc = (d) => { const s = String(d || ''); const i = s.indexOf(':'); return i < 0 ? '' : s.slice(i + 1); };
// The desc decides, never the shown name: a public spell may be named after a private mod's place
const isPrivateRow = (row) => Array.isArray(row) && isPrivatePlugin(pluginOfDesc(row[0]));

const sidecarOf = (file) => String(file).replace(/\.json$/i, '.private.json');

// The whole list -> the public rows and the private ones with their index in the whole list
function splitList(list) {
  const pub = [], rows = [];
  (list || []).forEach((row, at) => { if (isPrivateRow(row)) rows.push({ at, row }); else pub.push(row); });
  return { pub, rows };
}

// The public rows and the sidecar's -> the whole list, each private row back at its index
function mergeList(pub, rows) {
  const out = (pub || []).slice();
  for (const r of (rows || []).filter((x) => x && Array.isArray(x.row) && Number.isInteger(x.at)).sort((a, b) => a.at - b.at)) {
    out.splice(Math.min(r.at, out.length), 0, r.row);
  }
  return out;
}

// A whole JSON -> { pub: the object with only public rows in the given list keys, side: the sidecar object }
function splitKeys(j, keys, comment) {
  const pub = Object.assign({}, j), lists = {};
  for (const k of keys) {
    if (!Array.isArray(j[k])) continue;
    const s = splitList(j[k]);
    pub[k] = s.pub;
    if (s.rows.length) lists[k] = s.rows;
  }
  return { pub, side: { _comment: comment || 'Rows from the plugins of mods whose authors forbid AI work (privaterows.js). Never committed; delivered by deploy-private. at = the row\'s index in the whole list.', lists } };
}

// A tracked JSON with its sidecar merged into the given list keys. log: optional, told once when the sidecar is missing or
// broken. Returns { data, merged: <rows put back>, sidecar: true|false }
function readMerged(file, keys, log) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const side = sidecarOf(file);
  if (!fs.existsSync(side)) { if (log) log(`privaterows: ${path.basename(side)} is not here; ${path.basename(file)} runs on its public rows`); return { data, merged: 0, sidecar: false }; }
  let s;
  try { s = JSON.parse(fs.readFileSync(side, 'utf8')); } catch (e) { if (log) log(`privaterows: ${path.basename(side)} unreadable (${e.message}); public rows only`); return { data, merged: 0, sidecar: false }; }
  let merged = 0;
  for (const k of keys) {
    const rows = (s.lists && s.lists[k]) || [];
    if (!rows.length) continue;
    data[k] = mergeList(Array.isArray(data[k]) ? data[k] : [], rows);
    merged += rows.length;
  }
  return { data, merged, sidecar: true };
}

// admin-powers.json split for writing: the private rows out of spells and staffSpells, and spellSources counted from the
// public spells, so the tracked file names no private plugin at all
function splitPowers(j) {
  const { pub, side } = splitKeys(j, ['spells', 'staffSpells'], 'admin-powers.json rows from the plugins of mods whose authors forbid AI work (privaterows.js). Never committed; delivered by deploy-private. at = the row\'s index in the whole list.');
  if (pub.spellSources && Array.isArray(pub.spells)) {
    const n = {}; for (const r of pub.spells) { const p = pluginOfDesc(r[0]); n[p] = (n[p] || 0) + 1; }
    pub.spellSources = Object.fromEntries(Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  }
  return { pub, side };
}

module.exports = { PRIVATE_PLUGINS, isPrivatePlugin, isPrivateRow, pluginOfDesc, sidecarOf, splitList, mergeList, splitKeys, splitPowers, readMerged };
