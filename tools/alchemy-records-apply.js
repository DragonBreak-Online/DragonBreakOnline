#!/usr/bin/env node
// The alchemy rework's PC records, into alchemy-rework.json (Nate, 14 Oct; tooling/xedit-scripts/DBO_AlchemyRecords.pas).
// Reads the script's result file (Edit Scripts\DBO_AlchemyRecords_result.txt, a JSON object whose "records" maps each
// editor id to "localid:DragonBreak Online Edits.esp"), fills alchemy-rework.json `records` with every key it already
// lists, and moves `_combosPlanned` into `combos` once every record a combination names is mapped. Refuses a result that
// is not DONE, an id that is not "hex:DragonBreak Online Edits.esp", and a key the file has no place for in `records`
// unless it is one of the script's other records (FLOR); nothing is written then. Running it again changes nothing.
//   node tools/alchemy-records-apply.js <result file> [alchemy-rework.json] [--dry-run]
'use strict';
const fs = require('fs');
const path = require('path');

const PLUGIN = 'DragonBreak Online Edits.esp';
const ID = /^[0-9a-f]{1,6}:DragonBreak Online Edits\.esp$/i;
// Records the script makes that the server does not map (PC placement bases)
const NOT_SERVER = new Set(['DBO_HarvestJugOfMilk', 'DBO_HarvestFlourSack']);

// The layout alchemy-rework.json is kept in: indent 1, arrays of plain values on one line
const format = (obj) => JSON.stringify(obj, null, 1).replace(/\[\n\s+([^[\]{}]*?)\n\s+\]/g, (m, body) => `[${body.replace(/\s*\n\s*/g, ' ')}]`) + '\n';

const apply = (resultText, rework) => {
  let result;
  // The script writes UTF-8 or ANSI; a BOM is dropped
  try { result = JSON.parse(String(resultText).replace(/^﻿/, '')); } catch (e) { return { ok: false, error: `the result file is not JSON (${e.message})` }; }
  if (!result || typeof result.status !== 'string' || !/^DONE\b/.test(result.status)) return { ok: false, error: `the script did not finish: ${result && result.status}` };
  if (Number(result.errors) > 0) return { ok: false, error: `the script reports ${result.errors} error(s)` };
  const got = result.records && typeof result.records === 'object' ? result.records : null;
  if (!got) return { ok: false, error: 'the result has no records' };
  const out = JSON.parse(JSON.stringify(rework));
  const records = out.records && typeof out.records === 'object' ? out.records : null;
  if (!records) return { ok: false, error: 'alchemy-rework.json has no records' };
  const bad = Object.entries(got).filter(([, v]) => !ID.test(String(v).toLowerCase()));
  if (bad.length) return { ok: false, error: `not an id of ${PLUGIN}: ${bad.map(([k, v]) => `${k}=${v}`).join(', ')}` };
  const unknown = Object.keys(got).filter((k) => !(k in records) && !NOT_SERVER.has(k));
  if (unknown.length) return { ok: false, error: `alchemy-rework.json lists no record ${unknown.join(', ')}` };
  // Two editor ids on one record would hand out the wrong potion
  const seen = new Map();
  for (const [k, v] of Object.entries(got)) { const id = String(v).toLowerCase().replace(/^0+(?=[0-9a-f])/, ''); if (seen.has(id)) return { ok: false, error: `${k} and ${seen.get(id)} share ${v}` }; seen.set(id, k); }
  let filled = 0, changed = 0;
  for (const k of Object.keys(records)) {
    if (!(k in got)) continue;
    const v = String(got[k]).toLowerCase().replace(/:dragonbreak online edits\.esp$/, `:${PLUGIN}`);
    if (records[k] !== v) changed++;
    records[k] = v; filled++;
  }
  const missing = Object.keys(records).filter((k) => !records[k]);
  // The planned combinations go live only with all their records
  let moved = 0;
  if (Array.isArray(out._combosPlanned)) {
    const ready = out._combosPlanned.filter((c) => (c.byTier || []).every((x) => !x || records[x]));
    const waiting = out._combosPlanned.filter((c) => !ready.includes(c));
    if (ready.length) {
      out.combos = (Array.isArray(out.combos) ? out.combos : []).concat(ready.filter((c) => !(out.combos || []).some((x) => JSON.stringify(x) === JSON.stringify(c))));
      moved = ready.length; changed += ready.length;
    }
    if (waiting.length) out._combosPlanned = waiting; else delete out._combosPlanned;
  }
  return { ok: true, rework: out, filled, changed, moved, missing, extra: Object.keys(got).filter((k) => NOT_SERVER.has(k)) };
};

module.exports = { apply, format };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const [resultFile, reworkFile = path.join(__dirname, '..', 'alchemy-rework.json')] = args.filter((a) => a !== '--dry-run');
  if (!resultFile) { console.error('usage: node tools/alchemy-records-apply.js <DBO_AlchemyRecords_result.txt> [alchemy-rework.json] [--dry-run]'); process.exit(2); }
  const r = apply(fs.readFileSync(resultFile, 'utf8'), JSON.parse(fs.readFileSync(reworkFile, 'utf8')));
  if (!r.ok) { console.error(`refused, nothing written: ${r.error}`); process.exit(1); }
  console.log(`${r.filled} record(s) mapped (${r.changed} change(s)), ${r.moved} combination(s) moved into combos; ${r.missing.length} still unmapped${r.missing.length ? `: ${r.missing.join(', ')}` : ''}${r.extra.length ? `; placement bases (not for the server): ${r.extra.join(', ')}` : ''}`);
  if (dry) { console.log('dry run: alchemy-rework.json not written'); process.exit(0); }
  if (r.changed) fs.writeFileSync(reworkFile, format(r.rework)); else console.log('nothing to change');
}
