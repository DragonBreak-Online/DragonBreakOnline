#!/usr/bin/env node
// Ticket #0141: take the strike off Lady Dyer #MTK7 (profile 168). Storage locking did not exist until the 12 Oct
// 04:56 restart, so the barrel could not be locked and the server allowed every take: the strike was given for
// something the game permitted.
//
//   sudo node tools/restitution/0141-strike.js            what it would do, changing nothing
//   sudo node tools/restitution/0141-strike.js --apply    back up and remove it
//
// discipline.js has no way to overturn a record (warn, strike, suspend, lift; lift only ends a suspension), so this
// edits discipline.json. WHEN TO RUN IT MATTERS: discipline.js reads the file once at load and holds it in memory, and
// any later save() writes that copy back. Run this AFTER the server has restarted or hot-reloaded, never just before
// one, and check it afterwards with --check. A proper "overturn" action belongs in discipline.js; this is the stopgap.
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.env.DISCIPLINE_FILE || '/opt/skymp-state/discipline.json';
const PROFILE = '168';
const TAG = '#MTK7';
const AT = '2026-10-12T04:56:39.337Z';      // the one record to remove, pinned so a later strike is never touched

const apply = process.argv.includes('--apply');
const read = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));

let d;
try { d = read(); } catch (e) { console.error(`cannot read ${FILE}: ${e.message}`); process.exit(2); }
const list = (d.profiles || {})[PROFILE] || [];
const doomed = list.filter((e) => e.kind === 'strike' && e.at === AT);
const others = list.filter((e) => !(e.kind === 'strike' && e.at === AT));

console.log(`${FILE}: profile ${PROFILE} (${TAG}) holds ${list.length} record(s)`);
for (const e of list) console.log(`  ${e === doomed[0] ? '->' : '  '} ${e.kind} ${e.at} by ${e.by}: ${String(e.reason || '').slice(0, 70)}`);
if (!doomed.length) { console.log('nothing to remove: that strike is already gone'); process.exit(0); }
if (doomed.length > 1) { console.error(`refusing: ${doomed.length} records share that timestamp`); process.exit(2); }
if (!apply) { console.log(`\nwould remove 1 strike, leaving ${others.length}. Re-run with --apply`); process.exit(0); }

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, 'Z');
const backup = `${FILE}.bak-0141-${stamp}`;
fs.copyFileSync(FILE, backup);
if (others.length) d.profiles[PROFILE] = others; else delete d.profiles[PROFILE];
fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(d, null, 1));
fs.renameSync(`${FILE}.tmp`, FILE);
const after = ((read().profiles || {})[PROFILE] || []).filter((e) => e.kind === 'strike' && e.at === AT);
console.log(`\nbacked up to ${backup}`);
console.log(after.length ? 'FAILED: the strike is still there' : `removed. ${others.length} record(s) left for this profile`);
console.log('Check again after the next gamemode reload: an in-memory copy from before this edit can write it back.');
process.exit(after.length ? 1 : 0);
