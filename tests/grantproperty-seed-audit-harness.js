// /grantproperty's seed of an empty claim (gamemode.js, the one write to private.housing outside housingSystem.ts) logs a
// [housing] AUDIT line at the write, in the fork's own form, before the grant runs and whether or not it then succeeds.
//   node tests/grantproperty-seed-audit-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const start = src.indexOf("registerChatCommand('grantproperty'");
const body = start < 0 ? '' : src.slice(start, src.indexOf('registerChatCommand(', start + 10));
ok(!!body, '/grantproperty is there');
const writes = body.match(/mp\.set\([^;]*'private\.housing'/g) || [];
ok(writes.length === 1, 'it writes private.housing in one place', writes.length);
const seed = /mp\.set\(id, 'private\.housing', \{[^}]*\}\); seeded = true;\n\s*\/\/[^\n]*\n\s*log\(`\[housing\] AUDIT seed \$\{id\.toString\(16\)\} by \$\{who\(a\)\} \(profile \$\{profileOf\(a\)\}, \/grantproperty for \$\{who\(t\)\}\): record /.test(body);
ok(seed, 'the write is followed at once by its AUDIT seed line: the door, who, their profile, for whom');
ok(/no longer exists`\);/.test(body) && /record \$\{own \? JSON\.stringify\(own\) : 'none'\} ->/.test(body), '...with the record it replaced and the gone pair key');
ok(body.indexOf('AUDIT seed') < body.indexOf('H.grant(id, t)'), '...logged before the grant runs, so a refused grant still leaves it');
ok(/^const profileOf = /m.test(src), 'profileOf, which the line uses, is defined in gamemode.js');
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
