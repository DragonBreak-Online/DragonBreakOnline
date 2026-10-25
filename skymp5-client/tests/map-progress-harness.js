// The client half of server-kept map markers (Nate, 12 Oct: "make sure map data ... stays synced"; server mapprogress.js).
// Source checks on characterProgressService.ts; run from skymp5-client:  node tests/map-progress-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'services', 'characterProgressService.ts'), 'utf8').replace(/\r\n/g, '\n');
let failures = 0;
const check = (name, ok) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };
const fn = (name) => { const i = src.indexOf(`private ${name}(`); return i < 0 ? '' : src.slice(i, src.indexOf('\n  }\n', i)); };
check('listens for the server\'s dboMapMarkers', /emitter\.on\("customPacketMessage", \(e\) => this\.onServerMarkers\(e\)\)/.test(src));
const begin = fn('beginRestore');
check('a restore reports every marker the file holds and asks for the whole list back', /s\.want = true;/.test(begin) && /s\.report = Object\.keys\(s\.markers\)\.filter\(\(desc\) => !s\.visited\[desc\]\);/.test(begin) && /s\.reportVisited = Object\.keys\(s\.visited\);/.test(begin));
const merge = fn('onServerMarkers');
check('the server\'s list adds and restores what this PC never saw, and saves it locally', /content\["customPacketType"\] !== "dboMapMarkers"/.test(merge) && /s\.queue\.push\(\{ desc \}\)/.test(merge) && /s\.restored = false;/.test(merge) && /this\.markDirty\(\)/.test(merge));
check('...only for the character being restored (key set)', /if \(!s\.key \|\| !Array\.isArray\(content\["markers"\]\)\) return;/.test(merge));
const send = fn('sendReport');
check('reports go in batches, the last one asking for the list (want)', /report\.splice\(0, REPORT_BATCH - visitedBatch\.length\)/.test(send) && /const want = !!s\.want && !report\.length && !visited\.length;/.test(send) && /customPacketType: "dboMapSync"/.test(send));
check('a report that fails to send is kept for the next try', /report\.unshift\(\.\.\.batch\)/.test(send) && /visited\.unshift\(\.\.\.visitedBatch\)/.test(send));
check('a new discovery is queued for the server (an entered one as visited)', /\(s\.reportVisited = s\.reportVisited \|\| \[\]\)\.push\(desc\);/.test(fn('scanMarkers')) && /\(s\.report = s\.report \|\| \[\]\)\.push\(desc\);/.test(fn('scanMarkers')));
check('reports go out every REPORT_MS, and at once on flush (disconnect, main menu)', /this\.sendReport\(Date\.now\(\), false\);/.test(fn('onUpdate')) && /this\.sendReport\(Date\.now\(\), true\)/.test(fn('flush')));
check('a character switch never sends the last character\'s report as the new one\'s', /this\.dropReport\(\);\n\s+this\.flush\(\);/.test(fn('onMySpawn')) && /this\.dropReport\(\);\n\s+this\.flush\(\);/.test(fn('onMyDespawn')));
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
