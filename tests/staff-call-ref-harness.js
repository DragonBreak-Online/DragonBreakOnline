// Staff changes to another player under a GM call or a ticket (staffguard.js callRef; the owner's staff-conduct review, 23 Oct
// 2026): faction and rank changes, offices, renames and citizenship changes done by staff on someone else need an open GM
// call or a ticket reference, which goes into the audit; refused without one. A reference comes from call:<n> or
// ticket:<id> in the command line, from /staffref <call n|ticket id> <player> (for the panels, for bindMinutes), or from
// the player's own open GM call taken by the staff member. Also checks the help line for renames (2e).
//   node tests/staff-call-ref-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, CAST, load, call, check, done } = require('./lib/staffguard-fakes');
const { OWNER, LEAD, GM, MIRA, MIRA_ALT, BOB } = Object.fromEntries(Object.entries(CAST).map(([k, v]) => [k, v.id]));

const NEED = /^This needs an open GM call or a ticket/;
let f = load({});
const G = f.G;

for (const kind of ['rename', 'faction', 'office', 'citizenship']) {
  check(`${kind} on a player without a reference is refused`, NEED.test(G.target(LEAD, MIRA, kind)), G.target(LEAD, MIRA, kind));
}
check('items, skills and appearance need no reference', ['items', 'skills', 'appearance', 'hall'].every((k) => G.target(LEAD, MIRA, k) === ''));
check('nothing is audited for a refusal', f.audits.length === 0, f.audits);

// ---- the player's own call, held by the staff member ----
call(5, 50, null);
check('an open call nobody has taken is no reference', NEED.test(G.target(LEAD, MIRA, 'rename')));
globalThis.__dboGmCalls.open[0].takenBy = { name: 'GM Gemma', profile: 30 };
check('...nor one another staff member holds', NEED.test(G.target(LEAD, MIRA, 'rename')));
globalThis.__dboGmCalls.open[0].takenBy = { name: 'GM Leda', profile: 20 };
f.audits.length = 0;
check('the player\'s call held by the staff member is the reference', G.target(LEAD, MIRA, 'faction') === '');
check('...for every character of that account (an offline alt too)', G.target(LEAD, MIRA_ALT, 'rename') === '');
check('...and goes into the audit', /^STAFFREF GM Leda #LEAD \(profile 20\) faction on Mira #MIRA \(profile 50\) under GM call #5 \(held\)$/.test(f.audits[0] || ''), f.audits);
check('...but not for another player', NEED.test(G.target(LEAD, BOB, 'faction')));

// ---- call:<n> / ticket:<id> in the command ----
f = load({});
call(9, 60, null);
const line = (a, cmd, body) => f.G.command(a, cmd, `${cmd} ${(body.split(/\s+/)[0] || '').toLowerCase()}`, body);
{
  const r = line(GM, 'rename', 'Mira Mirabel call:9');
  check('rename ... call:9 is taken out of the line', r && r.body === 'Mira Mirabel' && r.ref.kind === 'call' && r.ref.n === 9, r);
  const ran = f.G.withRef(GM, r.ref, () => f.G.target(GM, MIRA, 'rename'));
  check('...and stands as the reference while the command runs (any open call)', ran === '' && /under GM call #9$/.test(f.audits.slice(-1)[0] || ''), f.audits);
  check('...and only then', NEED.test(f.G.target(GM, MIRA, 'rename')));
  const bad = line(GM, 'rename', 'Mira Mirabel call:44');
  check('a call number that is not open is refused by name', f.G.withRef(GM, bad.ref, () => f.G.target(GM, MIRA, 'rename')) === 'GM call #44 is not open.');
  const t = line(GM, 'faction', 'remove Mira fightersguild ticket:1561234567');
  check('ticket:<id> is taken out too', t && t.body === 'remove Mira fightersguild' && t.ref.id === '1561234567', t);
  check('...and is the reference', f.G.withRef(GM, t.ref, () => f.G.target(GM, MIRA, 'faction')) === '' && /under ticket 1561234567$/.test(f.audits.slice(-1)[0] || ''));
  check('/appoint and /dismiss take the words', !!line(LEAD, 'appoint', 'Mira bruma steward call:9') && line(LEAD, 'dismiss', 'Mira bruma ticket:abc').body === 'Mira bruma');
  check('another staff member\'s reference does not carry over', f.G.withRef(GM, t.ref, () => f.G.target(LEAD, MIRA, 'faction')) !== '' );
}

// ---- /staffref for the panels ----
{
  f = load({});
  call(12, 50, null);
  const out = f.run(GM, 'staffref 12 Mira');
  check('/staffref 12 Mira binds call #12 to Mira\'s account', /For 60 minutes your staff tools on Mira #MIRA's account run under GM call #12/.test(out), out);
  check('...audited', f.audits.some((l) => /^STAFFREF GM Gemma #GEMM \(profile 30\) works on Mira #MIRA \(profile 50\) under GM call #12 for 60 minutes$/.test(l)), f.audits);
  check('...and the F3 faction panel\'s change is allowed under it', f.G.target(GM, MIRA, 'faction') === '' && /faction on Mira #MIRA \(profile 50\) under GM call #12$/.test(f.audits.slice(-1)[0]));
  check('...for that account only', NEED.test(f.G.target(GM, BOB, 'faction')));
  check('...and that staff member only', NEED.test(f.G.target(LEAD, MIRA, 'faction')));
  globalThis.__dboGmCalls.open.length = 0;
  check('once the call closes, the binding ends', NEED.test(f.G.target(GM, MIRA, 'faction')));
  const t = f.run(GM, 'staffref 1561234 Bob');
  check('/staffref <ticket id> <player> binds a ticket', /run under ticket 1561234/.test(t) && f.G.target(GM, BOB, 'rename') === '', t);
  check('/staffref with a closed call number says so', /GM call #77 is not open/.test(f.run(GM, 'staffref call:77 Bob')));
  check('/staffref alone lists what you hold', /Yours: profile 60 under ticket 1561234/.test(f.run(GM, 'staffref')));
  const short = load({ callRef: { bindMinutes: 1 } });
  call(3, 50, null);
  short.run(GM, 'staffref 3 Mira');
  const S = globalThis.__dboStaffGuardState;
  for (const b of S.binds.values()) b.until = Date.now() - 1;
  check('a binding runs out after bindMinutes', NEED.test(short.G.target(GM, MIRA, 'rename')));
}

// ---- the Owners, own account, switch ----
f = load({});
check('an Owner needs no reference', f.G.target(OWNER, MIRA, 'rename') === '');
check('the own-account rule comes first', /^Staff tools never act on your own characters/.test(f.G.target(GM, CAST.GM_RP.id, 'rename')));
{
  const off = load({ callRef: { enabled: false } });
  check('callRef.enabled false: no reference needed, and the words stay in the line', off.G.target(LEAD, MIRA, 'rename') === '' && off.G.command(GM, 'rename', 'rename mira', 'Mira Mirabel call:9') === null);
  const kinds = load({ callRef: { kinds: ['rename'] } });
  check('callRef.kinds narrows what needs one', NEED.test(kinds.G.target(LEAD, MIRA, 'rename')) && kinds.G.target(LEAD, MIRA, 'faction') === '');
}

// ---- 2e: renames are not new identities ----
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
check('the staff help\'s /rename line says a new identity is a new character, never a rename (Players topic and Trial GM list)',
  (src.match(/A new identity is a new character, never a rename/g) || []).length === 2 && /\['rename', '<player\|#TAG> <new name> \[call:<n>\|ticket:<id>\]: for a typo/.test(src));
check('the staff help lists /staffchar and /staffref', /'staffchar', 'staffref'/.test(src));
done();
