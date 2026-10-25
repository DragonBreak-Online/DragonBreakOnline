// Scripted test for the player log's audit tap (playerlog-rules.js AUDIT_VERBS and AUDIT_SITES, DESIGN.md Appendix A, 6):
//   - a corpus of one line per audit( call site in the code, built from its real template: identity interpolations (who(),
//     display() and their kin) become characters of a fake world, every other interpolation the canary PLOGCANARY. Parsed and
//     excluded verbs never let the canary out, also when it is shaped like a party ("PLOGCANARY #ZZZZ (profile 99)").
//   - site pinning: every audit( call in every non-test *.js is in AUDIT_SITES with its template hash and class; a new,
//     changed, gone or reclassified site fails here, named, until a reviewer pins it. A clean site's template holds no quote.
//   - roles (SMITH, SUPERNATURAL, DISCIPLINE, COURIER robbed, WAR, ROBBERY), the IP of an adminLog line, and the verbs moved
//     out of clean (THEFT, WARBAND) with their record-named lists where they have them (ROBBERY, RAID, COURIER, POST, SUPPLY).
//   node tests/playerlog-audit-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const F = require('./lib/playerlog-fakes.js');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'playerlog.js');
const R = require(path.join(ROOT, 'playerlog-rules.js'));
const CANARY = 'PLOGCANARY';
let failures = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!c) failures++; };

// ---- the audit( call sites in the code (a literal first argument; template literals with nested ${...}) ----------------------
const readLiteral = (src, i) => {
  const q = src[i];
  if (q !== '`' && q !== "'" && q !== '"') return null;
  let j = i + 1, out = '';
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') { out += src.slice(j, j + 2); j += 2; continue; }
    if (ch === q) return [out, j + 1];
    if (q === '`' && ch === '$' && src[j + 1] === '{') {
      let depth = 1, k = j + 2;
      while (k < src.length && depth) {
        const c = src[k];
        if (c === '`' || c === "'" || c === '"') { const r = readLiteral(src, k); if (!r) return null; k = r[1]; continue; }
        if (c === '{') depth++; else if (c === '}') depth--;
        k++;
      }
      out += src.slice(j, k); j = k; continue;
    }
    out += ch; j++;
  }
  return null;
};
const sites = [];
const unreadable = [];
for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith('.js')).sort()) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const rx = /(^|[^.\w$])audit\(\s*/g; let m;
  while ((m = rx.exec(src))) {
    const at = m.index + m[0].length;
    // a mention in a comment is not a call
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    if (/\/\/|^\s*\*/.test(src.slice(lineStart, m.index + 1))) continue;
    const r = readLiteral(src, at);
    const line = src.slice(0, at).split('\n').length;
    if (!r) { if (!/^[a-zA-Z_]/.test(src[at]) || !/^(text|body)\b/.test(src.slice(at))) unreadable.push(`${f}:${line} ${src.slice(at, at + 40)}`); continue; }
    const t = r[0];
    const verb = t.startsWith('${') ? '<expr>' : t.split(/[\s:]/)[0];
    sites.push({ file: f, line, verb, t, hash: R.siteHash(t) });
  }
}
ok(unreadable.length === 0, 'every audit( call passes a literal (a variable has to be pinned by hand)', unreadable);
// pinning
const pinned = new Map(R.AUDIT_SITES.map((s) => [`${s.file} ${s.verb} ${s.hash}`, s]));
const scanned = new Map(sites.map((s) => [`${s.file} ${s.verb} ${s.hash}`, s]));
const fresh = [...scanned.keys()].filter((k) => !pinned.has(k));
const gone = [...pinned.keys()].filter((k) => !scanned.has(k));
ok(fresh.length === 0, 'no audit site is new or changed since it was reviewed (pin it in AUDIT_SITES with its class)', fresh.map((k) => `${k} at line ${scanned.get(k).line}: ${scanned.get(k).t.slice(0, 120)}`));
ok(gone.length === 0, 'no pinned site is gone (unpin it)', gone);
const clsOf = (s) => (s.verb === '<expr>' ? (/'GM' : 'OFFICIAL'/.test(s.t) ? 'parsed' : 'excluded') : (R.AUDIT_VERBS[s.verb] || {}).cls);
const mismatched = sites.filter((s) => { const p = pinned.get(`${s.file} ${s.verb} ${s.hash}`); return p && p.cls !== clsOf(s); });
ok(mismatched.length === 0, 'each pinned class is the registry\'s class for the verb', mismatched.map((s) => `${s.file}:${s.line} ${s.verb}`));
ok(sites.every((s) => clsOf(s)), 'every verb in the code is classified (clean, parsed or excluded)', sites.filter((s) => !clsOf(s)).map((s) => `${s.file}:${s.line} ${s.verb}`));
const quoted = sites.filter((s) => clsOf(s) === 'clean' && s.t.replace(/\$\{[^}]*\}/g, '').includes('"'));
ok(quoted.length === 0, 'no clean site quotes anything (quoted text is someone\'s words)', quoted.map((s) => `${s.file}:${s.line}`));

// ---- the corpus ----------------------------------------------------------------------------------------------------------------
const CHARS = [
  { a: 0xff000014, p: 1, n: 'Rowan', c: 'PGDB', d: '337337773973569537' },
  { a: 0xff000015, p: 2, n: 'Selene', c: 'K2QX', d: '22' },
  { a: 0xff000016, p: 3, n: 'Mike Morethi', c: '5D8L', d: '33' },
  { a: 0xff000017, p: 4, n: 'Dar', c: 'U6T6', d: '44' },
];
// Lists the design keeps (Appendix A): built from record names only (robbery.js and raids.js label(), post.js nameOfItem via
// itemsText), so the corpus fills them with record names, not the canary
const RECORD_NAMED = new Set(["r.items.join(', ')", "what || 'nothing'", 'itemsText(items)', 'itemsText(j.items)', 'itemsText(parcel.items)', 'P.itemsText(items)']);
// Names from the game's own config that the design keeps (Appendix A: DEITY's deity is a config name, prayer.js reads the
// pantheon from its config): file|expression
const CONFIG_NAMED = new Set(['prayer.js|d.name']);
// A number by its name (gold, count, price ...): filled with a number, as the code writes one
const NUMERIC = /^[\w$.]*\b(gold|n|count|price|pay|fee|paid|amount|cost|held|reward|value|balance|tribute|weeks|mins|hours|tier|level|insured|premium|delivered|owed|kept|refund|taxed|income|stipend|filled|made|done|added|removed|lucky|earned|prev|was|had|days|left|fromBank|paidIn|deposit|weekly|seconds|s|tax|cleared|copies|have|need|blood|renown)$/;
const isWho = (e) => /^(who|staffWho)\(/.test(e) || /(^|\.)(who|byWho|byName)$/.test(e) || /^ownWho|^tg\.who|^by\.who/.test(e);
const isDisplay = (e) => /^(display|ownDisplay|publicDisplay|displayFor)\(/.test(e);
// one corpus line: identity -> the fake world's characters (in turn), anything else -> fill
const build = (t, fill, file) => {
  let i = 0, out = '', k = 0;
  const next = () => CHARS[(k++) % CHARS.length];
  while (i < t.length) {
    if (t[i] === '$' && t[i + 1] === '{') {
      let depth = 1, j = i + 2;
      while (j < t.length && depth) { if (t[j] === '{') depth++; else if (t[j] === '}') depth--; j++; }
      const e = t.slice(i + 2, j - 1).trim();
      const after = t.slice(j, j + 3);
      if (isWho(e)) { const c = next(); out += `${c.n} #${c.c} (profile ${c.p}, <@${c.d}>)`; }
      else if (isDisplay(e)) { const c = next(); out += `${c.n} #${c.c}`; }
      else if (after === ' #$') { const c = CHARS[k % CHARS.length]; out += c.n; }
      else if (/Tag\)?$|\.tag$|tagOf\(/.test(e) && out.endsWith(' #')) { const c = next(); out += c.c; }
      else if (RECORD_NAMED.has(e)) out += /itemsText/.test(e) ? '2x Iron Ingot, 1x Bread' : 'Iron Sword, Bread';
      else if (CONFIG_NAMED.has(`${file}|${e}`)) out += 'Akatosh';
      else if (NUMERIC.test(e)) out += '12';
      else {
        // a conditional with a template or a string in it ("x ? ` and ${gold} gold` : ''"): its first branch, built the same way
        const bt = e.indexOf('`');
        const lit = bt >= 0 ? readLiteral(e, bt) : null;
        if (lit) out += build(lit[0], fill, file);
        else { const q = e.match(/\? '([^']*)'/); out += q ? q[1] : fill; }
      }
      i = j; continue;
    }
    if (t[i] === '\\') { out += t[i + 1]; i += 2; continue; }
    out += t[i]; i++;
  }
  return out;
};
// the fake world the resolver reads
const M = F.makeMp(), FS = F.makeFs(), TM = F.makeTimers(), QU = F.makeQueue(), CL = F.makeClock();
QU.install();
for (const c of CHARS) M.player(c.a, { profile: c.p, name: c.n, tag: c.c, discord: c.d });
M.record(0x12eb7, 'WEAP', 'IronSword');
const H = new Map([[0x806ca1f, { owner: 3, ownerChar: 0xff000016, ownerName: 'Mike Morethi' }]]);
globalThis.__dboHousing = { recordOf: (ref) => H.get(ref >>> 0) || null, primaryOf: (r) => r >>> 0, ownsRecord: () => false };
const api = { mp: M.mp, log: () => {}, cfg: { playerLog: { dir: '/fake/events', stopFile: '/fake/STOP' } }, every: TM.every, stopTimer: TM.stopTimer,
  onlineActors: () => CHARS.map((c) => c.a), actorOf: () => 0, fs: FS.fs, clock: CL, discordOf: (a) => String(M.mp.get(a, 'private.skympDiscordId') || ''),
  recordOf: (id) => M.mp.lookupEspmRecordById(id), adminItemName: () => '', commandsHas: () => true, WORLD_GROUPS: [], lastPacketAt: new Map() };
delete require.cache[MODULE];
const K = require(MODULE)(api);
QU.run();
const run = (line) => {
  const n0 = K.S.q.length;
  globalThis.__dboPlogHook('audit', line);
  K.G.parseAudits(Infinity);
  QU.run();
  return K.S.q.slice(n0);
};

const leaks = [], leaksParty = [], cleanReview = [];
let parsedN = 0, excludedN = 0, cleanN = 0, produced = 0;
for (const s of sites) {
  const cls = clsOf(s);
  const out1 = run(build(s.t, CANARY, s.file));
  const out2 = run(build(s.t, `${CANARY} #ZZZZ (profile 99, <@1>)`, s.file));
  produced += out1.length;
  if (cls === 'clean') {
    cleanN++;
    const free = (s.t.match(/\$\{[^}]*\}/g) || []).map((x) => x.slice(2, -1).trim()).filter((e) => !isWho(e) && !isDisplay(e));
    cleanReview.push(`${s.file}:${s.line} ${s.verb}: ${free.join(' | ')}`);
    continue;
  }
  if (cls === 'parsed') parsedN++; else excludedN++;
  if (JSON.stringify(out1).includes(CANARY)) leaks.push(`${s.file}:${s.line} ${s.verb} -> ${JSON.stringify(out1).slice(0, 200)}`);
  if (JSON.stringify(out2).includes(CANARY)) leaksParty.push(`${s.file}:${s.line} ${s.verb} -> ${JSON.stringify(out2).slice(0, 200)}`);
  if (cls === 'excluded' && out1.length) leaks.push(`${s.file}:${s.line} ${s.verb} (excluded) gave ${out1.map((r) => r.ev).join(',')}`);
}
ok(leaks.length === 0, `parsed (${parsedN}) and excluded (${excludedN}) sites: the canary never reaches an event`, leaks);
ok(leaksParty.length === 0, '...nor when the canary is shaped like a party', leaksParty);
ok(produced > 150, 'the corpus gives events (the parsers match the real templates)', produced);
console.log(`     ${cleanN} clean sites; their non-identity interpolations, for the reviewer:`);
for (const l of cleanReview) console.log(`       ${l}`);

// ---- clean: act text with the identity normalised ----------------------------------------------------------------------------
let out = run('CONTRACT Rowan #PGDB (profile 1, <@337337773973569537>) completed 7 wolves for Bruma (84 gold)');
ok(out.length === 1 && out[0].ev === 'act.CONTRACT' && out[0].f.text === 'completed 7 wolves for Bruma (84 gold)' && out[0].p === 1 && out[0].c === 'PGDB', 'a clean verb: act.<VERB>, the actor from the game; the verb and the actor\'s own "Name #TAG" leave the text, which the forwarder prints after them (review C-R4)', out);
out = run('LEVEL Rowan #PGDB reached character level 12');
ok(out.length === 1 && out[0].p === 1, 'a Name #TAG party with no profile: resolved by name and tag', out);
// staff-written text in a clean verb's line is cut: a gift's "by" and reason (schools.js grant, gifts.js mod-0311), a trim's by and why
out = run(`SCHOOLS ${CANARY} Staff granted Rowan #PGDB (profile 1, <@337337773973569537>) 5 Alteration levels: 10 to 15 (primary; held at 15 for the Adept spell, 2 not given); ${CANARY} for the event`);
ok(out.length === 1 && out[0].ev === 'act.SCHOOLS' && out[0].c === 'PGDB' && /granted Rowan #PGDB 5 Alteration levels: 10 to 15 \(primary; held at 15/.test(out[0].f.text) && !JSON.stringify(out).includes(CANARY), 'SCHOOLS grant: the giver and the reason (a gift\'s staff-written by and reason) are cut, the target and the levels stay', out);
out = run(`SPELL TRIM t1 Rowan #PGDB (profile 1, <@337337773973569537>) done: 3 spell(s) removed, 0 not learned, 1 kept as spellbook, prepared or on loan, shouts: grant kept (it cannot be kept in part); by ${CANARY}: ${CANARY} had 331 spells`);
ok(out.length === 1 && out[0].c === 'PGDB' && /3 spell\(s\) removed, .*shouts: grant kept \(it cannot be kept in part\)$/.test(out[0].f.text) && !JSON.stringify(out).includes(CANARY), 'SPELL TRIM: the staff-written by and why are cut, the counts stay', out);
// CONTRACT <official> set <hold> <term> <typed>: <the server's sentence> (contracts.js setTerms): /contract price|budget|standing
// passes every word typed after the term and reads only the first one or two, so the rest is an official's own words
// (review F2/PLA-2, 22 Oct). They go; the server's sentence, which says the tier, the gold or on/off, stays
const ROWAN = 'Rowan #PGDB (profile 1, <@337337773973569537>)';
const PAYS = (g, t, w) => `Bruma now pays ${g} gold a kill for pests (tier ${t}; was ${w}). Contracts already taken keep their pay.`;
const OFF = 'Bruma posts no standing contracts; those up now come down and their gold goes back to the treasury. Contracts already taken run on.';
const contractText = (line) => { const o = run(line); return o.length === 1 && o[0].ev === 'act.CONTRACT' && o[0].c === 'PGDB' && !(o[0].o || []).length && !JSON.stringify(o).includes(CANARY) ? o[0].f.text : JSON.stringify(o); };
let got = contractText(`CONTRACT ${ROWAN} set Bruma price 1 50 ${CANARY} typed words: ${PAYS(50, 1, 12)}`);
ok(got === `set Bruma price: ${PAYS(50, 1, 12)}`, 'CONTRACT set: the words typed after the term are cut, the hold, the term and the server\'s sentence stay', got);
got = contractText(`CONTRACT ${ROWAN} set Bruma price 3 70 ${CANARY}: with a colon: Bruma now pays 999 gold a kill for ${CANARY} fake: ${PAYS(70, 1, 60)}`);
ok(got === `set Bruma price: ${PAYS(70, 1, 60)}`, '...also when the typed words hold a colon and a fake sentence (the last one is the server\'s)', got);
got = contractText(`CONTRACT ${ROWAN} set Bruma price 1 57 Selene #K2QX (profile 2, <@22>) ${CANARY}: ${PAYS(57, 1, 56)}`);
ok(got === `set Bruma price: ${PAYS(57, 1, 56)}`, '...and when they name another character (never a party of the line)', got);
got = contractText(`CONTRACT ${ROWAN} set Bruma budget 400 ${CANARY}: Bruma's standing contracts may now commit ${CANARY}: Bruma's standing contracts may now commit 400 gold a week (was 500); 400 is left this week.`);
ok(got === 'set Bruma budget: Bruma\'s standing contracts may now commit 400 gold a week (was 500); 400 is left this week.', '...budget', got);
got = contractText(`CONTRACT ${ROWAN} set Bruma standing on ${CANARY} typed: Bruma posts standing contracts again.`);
ok(got === 'set Bruma standing: Bruma posts standing contracts again.', '...standing', got);
got = contractText(`CONTRACT ${ROWAN} set Bruma price 1 55 x: Bruma now pays ${CANARY} words "unmatched: ${PAYS(55, 1, 50)}`);
ok(got === 'set Bruma price', '...a quote typed takes the server\'s sentence with it: nothing after the term is kept, not a sentence the words fake', got);
got = contractText(`CONTRACT ${ROWAN} set Bruma price 1 56 x: ${PAYS(999, 1, 1)} "unmatched: ${PAYS(56, 1, 55)}`);
ok(got === 'set Bruma price', '...not even a word-for-word fake of the server\'s sentence (its numbers would be wrong)', got);
got = contractText(`CONTRACT ${ROWAN} set Bruma standing off: ${OFF}`);
ok(got === `set Bruma standing: ${OFF}`, '...a line with nothing typed after the value', got);
out = run(`CONTRACT A B C D E F G #PGDB (profile 1, <@337337773973569537>) set Bruma price 1 50 ${CANARY}: ${PAYS(50, 1, 12)}`);
ok(!JSON.stringify(out).includes(CANARY), '...a set line the cut cannot read (a name of seven words) keeps nothing', out);
// STAFF ENCHANT <staff> enchanted <their own|<owner>'s> <piece>[ (named "<new>")]: <ench> [<hex> <edid>] <effects>
// (staffenchant.js apply): <piece> is the entry's custom name first (nameOfEntry), written by a player or by an earlier
// /enchant, and not quoted, so it goes (review F3, 22 Oct); the enchantment's names and numbers at the end stay
const SELENE = 'Selene #K2QX (profile 2, <@22>)';
const FIRE = 'Fire Damage 02 [4605a EnchWeaponFireDamage02] Fire Damage 10';
const enchantOf = (line, n) => { const o = run(line); return o.length === 1 && o[0].ev === 'act.STAFF' && o[0].c === 'PGDB' && (o[0].o || []).length === n && !JSON.stringify(o).includes(CANARY) ? o[0].f.text : JSON.stringify(o); };
got = enchantOf(`STAFF ENCHANT ${ROWAN} enchanted ${SELENE}'s ${CANARY} My Named Blade: ${FIRE}`, 1);
ok(got === `ENCHANT Rowan #PGDB enchanted Selene #K2QX's piece: ${FIRE}`, 'STAFF ENCHANT: the piece\'s custom name (a player\'s or an earlier /enchant\'s, unquoted) is cut, who, whose and the enchantment stay', got);
got = enchantOf(`STAFF ENCHANT ${ROWAN} enchanted ${SELENE}'s ${CANARY} Blade (named "${CANARY} New"): ${FIRE}`, 1);
ok(got === `ENCHANT Rowan #PGDB enchanted Selene #K2QX's piece (named "…"): ${FIRE}`, '...with a new name given: that a name was given stays, neither name', got);
got = enchantOf(`STAFF ENCHANT ${ROWAN} enchanted their own ${CANARY} Mine: Fire Damage 02 [4605a EnchWeaponFireDamage02] Fire Damage 10.000000000000002 for 5s, Frost 2`, 0);
ok(got === "ENCHANT Rowan #PGDB enchanted their own piece: Fire Damage 02 [4605a EnchWeaponFireDamage02] Fire Damage 10.000000000000002 for 5s, Frost 2", '...their own piece, the effects with a duration and a second effect', got);
got = enchantOf(`STAFF ENCHANT ${ROWAN} enchanted ${SELENE}'s My ${CANARY}"q Blade (named "${CANARY} New"): ${FIRE}`, 1);
ok(got === "ENCHANT Rowan #PGDB enchanted Selene #K2QX's piece", '...a name with one quote (it pairs with the new name\'s and loses the end of the line): who and whose only', got);
got = enchantOf(`STAFF ENCHANT ${ROWAN} enchanted ${SELENE}'s x: ${CANARY} Words [1 Fake] More ${CANARY}": ${FIRE}`, 1);
ok(got === "ENCHANT Rowan #PGDB enchanted Selene #K2QX's piece", '...a name with a fake end and a quote: never kept as the enchantment', got);
got = enchantOf(`STAFF ENCHANT ${ROWAN} enchanted ${SELENE}'s ${CANARY}: ${FIRE}: ${FIRE}`, 1);
ok(got === `ENCHANT Rowan #PGDB enchanted Selene #K2QX's piece: ${FIRE}`, '...a name with a colon and a fake end, no quote: the real end is the last', got);
got = enchantOf(`STAFF ENCHANT ${ROWAN} enchanted ${SELENE}'s Dar #U6T6 (profile 4, <@44>) ${CANARY}: ${FIRE}`, 1);
ok(got === `ENCHANT Rowan #PGDB enchanted Selene #K2QX's piece: ${FIRE}`, '...a name shaped like a character is never a party', got);
got = enchantOf(`STAFF ENCHANT ${ROWAN} enchanted ${SELENE}'s ${CANARY} ${'x'.repeat(560)}: ${FIRE}`, 1);
ok(got === "ENCHANT Rowan #PGDB enchanted Selene #K2QX's piece", '...a line past the 600 cap: who and whose only', got);
out = run(`STAFF ENCHANT A B C D E F G #PGDB (profile 1, <@337337773973569537>) enchanted ${SELENE}'s ${CANARY}: ${FIRE}`);
ok(!JSON.stringify(out).includes(CANARY), '...a line the cut cannot read (a name of seven words) keeps nothing', out);
out = run(`STAFF ${ROWAN}: Discord roles now give gm (was helper); logged out so it takes effect`);
ok(out.length === 1 && out[0].f.text === 'Rowan #PGDB: Discord roles now give gm (was helper); logged out so it takes effect', '...other STAFF lines are not cut', out);
// CITIZEN STAFF <by> released|withdrew|could not release ... (... staff release <id>[: <why>]) and CITIZEN STAFF <by>: staff
// release <id>[: <why>] found no citizenship of profile N to release (citizenship.js releaseTell): the by, the id and the why
// are what staff wrote in a config entry (citizenship.staffReleases), not an identity from who(), so a by or a why shaped like
// a character made that character a party and carried both into their post (PRIV-2, 23 Oct). The by becomes "staff" and "a
// staff release" stands for the id and the why; the character, the hold, the character id and the profile stay. Once cut the
// line names no party, so the cut is also read directly
const citizenCut = (l) => { const d = R.AUDIT_VERBS.CITIZEN; return d && typeof d.cut === 'function' ? d.cut(R.unquote(l), l) : R.unquote(l); };
const DAR = 'Dar #U6T6 (profile 4)';
const REL = (by, end) => `CITIZEN STAFF ${by} released Selene from the citizenship of the Rift (character ff000015; ${end})`;
out = run(REL(`${DAR} ${CANARY}`, `staff release ${CANARY}-1: ${CANARY} why`));
ok(out.length === 0, 'CITIZEN STAFF release: a staff-written by shaped like a character is no party (the line reaches nobody\'s post)', out);
out = run(REL('Jake (owner) via claude-jake', `staff release ${CANARY}-1: same PC as ${DAR} ${CANARY}`));
ok(out.length === 0, '...nor is a why shaped like one', out);
got = citizenCut(REL(`${DAR} ${CANARY}`, `staff release ${CANARY}-1: ${CANARY} why`));
ok(got === REL('staff', 'a staff release'), '...the by becomes "staff", "a staff release" stands for the id and the why; the character, the hold and the character id stay', got);
got = citizenCut(`CITIZEN STAFF ${CANARY}: staff release ${CANARY}-2 found no citizenship of profile 58 to release`);
ok(got === 'CITIZEN STAFF staff: a staff release found no citizenship of profile 58 to release', '...an entry that found nothing, with no why: the profile stays', got);
// the four lines releaseTell writes, built from citizenship.js itself (its audit templates and its tag; the by, the id and the
// why filled with the canary and a character): each keeps its facts and nothing staff wrote, so a reworded line fails here
{
  const csrc = fs.readFileSync(path.join(ROOT, 'citizenship.js'), 'utf8');
  const rt = csrc.slice(csrc.indexOf('const releaseTell = '), csrc.indexOf('const staffReleases = '));
  const at = rt.indexOf('const tag = `');
  const tagT = at >= 0 ? (readLiteral(rt, at + 'const tag = '.length) || [''])[0] : '';
  const tag = tagT.replace('${rec.id}', `${CANARY}-7`).replace(/\$\{rec\.why \? `([^`]*)` : ''\}/, (m, w) => w.replace('${rec.why}', `${CANARY} same PC as ${DAR}`));
  const fill = (t) => t.split('${rec.by}').join(`${DAR} ${CANARY}`).split("${x.name || 'a character'}").join('Selene').split('${holdName(x.zone)}').join('the Rift')
    .split('${x.actor}').join('ff000015').split('${tag}').join(tag).split('${rec.pid}').join('55');
  const lines = sites.filter((s) => s.file === 'citizenship.js' && s.t.startsWith('CITIZEN STAFF ${rec.by}')).map((s) => fill(s.t));
  const want = [REL('staff', 'a staff release'),
    "CITIZEN STAFF staff withdrew Selene's request for the citizenship of the Rift (character ff000015; a staff release)",
    'CITIZEN STAFF staff could not release Selene from the citizenship of the Rift (character ff000015): it comes from a faction or court based there and lasts while that membership does (a staff release)',
    'CITIZEN STAFF staff: a staff release found no citizenship of profile 55 to release'];
  const cut4 = lines.map(citizenCut);
  ok(tag.startsWith(`staff release ${CANARY}-7: `) && lines.length === 4 && !lines.some((l) => l.includes('${')) && want.every((w, i) => cut4[i] === w) && lines.every((l) => !run(l).length),
    '...the four lines releaseTell writes (templates and tag read from citizenship.js): each keeps its facts, never the by, the id or the why, and reaches nobody\'s post', [lines, cut4]);
}
got = citizenCut(REL(`${CANARY} released Mike from the citizenship of Bruma (character ff000016; staff release x:`, `staff release ${CANARY}-1`));
ok(got === 'CITIZEN STAFF', '...a by that copies the line\'s own words (the line then reads two ways) keeps nothing', got);
got = citizenCut(REL('Jake', `staff release ${CANARY}-1: ${CANARY}) released Mike from the citizenship of Bruma (character ff000016; staff release x`));
ok(got === 'CITIZEN STAFF', '...and so does a why that copies them', got);
got = citizenCut(REL('Jake', `staff release ${CANARY}-1: ${CANARY}) and withdrew Mike's request for the citizenship of Bruma (character ff000016; staff release x`));
ok(got === 'CITIZEN STAFF', '...or copies another release line\'s words', got);
got = citizenCut(REL('Jake', `staff release ${CANARY}-1: ${CANARY} "unmatched ${DAR}`));
ok(got === 'CITIZEN STAFF', '...a why with a quote left unmatched (it takes the end of the line) keeps nothing', got);
out = run(`CITIZEN STAFF ${CANARY} " released Selene from the citizenship of the Rift (character ff000015; staff release r1: " Rowan #PGDB (profile 1) revoked the citizenship of Bruma from Selene (character ff000015)`);
ok(out.length === 0, '...a by and a why quoted together never pass as a Lead GM\'s revoke (a fake party)', out);
out = run(`CITIZEN STAFF ${ROWAN} revoked the citizenship of Bruma from Selene (character ff000015)`);
ok(out.length === 1 && out[0].ev === 'act.CITIZEN' && out[0].c === 'PGDB' && out[0].f.text === 'STAFF Rowan #PGDB revoked the citizenship of Bruma from Selene (character ff000015)', '...a Lead GM\'s revoke (who() names them, as on every staff line) is not cut: it stays in their post', out);
// the revoke as citizenship.js writes it (its template read from the file), so a reworded revoke the cut no longer reads
// fails here, not only at its pin
{
  const rv = sites.filter((s) => s.file === 'citizenship.js' && s.t.startsWith('CITIZEN STAFF ${who(by)} revoked'));
  const line = rv.length === 1 ? rv[0].t.split('${who(by)}').join(ROWAN).split('${z.name}').join('Bruma').split('${e.name}').join('Selene')
    .split('${hex(actor)}').join('ff000015') : '';
  out = run(line);
  ok(rv.length === 1 && !line.includes('${') && citizenCut(line) === R.unquote(line) && out.length === 1 && out[0].ev === 'act.CITIZEN' && out[0].c === 'PGDB',
    '...the revoke citizenship.js writes (template read from the file) is read as a Lead GM\'s revoke and not cut', [line, out]);
}
// audit() cuts a body at 500 characters and adds "..." (gamemode.js AUDIT_LINE_MAX): a release line that long keeps nothing
{
  const long = `CITIZEN STAFF ${DAR} ${'x'.repeat(150)} could not release Selene from the citizenship of the Rift (character ff000015): it comes from a faction or court based there and lasts while that membership does (staff release r1: ${CANARY} ${'y'.repeat(200)})`;
  const body = long.length > 500 ? `${long.slice(0, 500)}...` : long;
  got = citizenCut(body);
  out = run(body);
  ok(long.length > 500 && got === 'CITIZEN STAFF' && out.length === 0, '...a release line audit() cut at 500 characters keeps nothing and reaches nobody\'s post', [got, out]);
}
out = run(`CITIZEN ${ROWAN} granted Selene (character ff000015) the citizenship of Bruma`);
ok(out.length === 1 && out[0].c === 'PGDB' && out[0].f.text === 'granted Selene (character ff000015) the citizenship of Bruma', '...nor are the other CITIZEN lines', out);
// CITIZEN <name> (character <hex>) is an outlaw of <hold>[: citizenship taken], barred until <date> (<why>)[; still a citizen
// through a faction or court based there] (citizenship.js __dboCitizenOutlaw): the why its one caller gives is rebellion.js's
// "the failed rising <name>", a rising's name a player chose, so it goes as the ELECTION void line's faction names do; the
// character, the hold, the date and both flags stay. The line names no party today, so the cut is read directly
{
  const site = sites.find((s) => s.file === 'citizenship.js' && s.t.includes(' is an outlaw of '));
  const rsrc = fs.readFileSync(path.join(ROOT, 'rebellion.js'), 'utf8');
  const whyT = (rsrc.match(/__dboCitizenOutlaw', [^`\n]*`([^`]*)`/) || [])[1] || '';
  const line = (had, auto, why) => (site ? site.t : '').replace('${e.name || k}', 'Selene').replace('${k}', 'ff000015').replace('${z.name}', 'The Rift')
    .replace(/\$\{had \? '([^']*)' : ''\}/, (m, a) => (had ? a : '')).replace('${dateText(until)}', '2026-11-06 21:00 UTC')
    .replace("${why || 'a failed rising'}", why).replace(/\$\{auto \? '([^']*)' : ''\}/, (m, a) => (auto ? a : ''));
  const OUTLAW = 'CITIZEN Selene (character ff000015) is an outlaw of The Rift: citizenship taken, barred until 2026-11-06 21:00 UTC';
  const full = line(true, true, whyT.replace('${r.name}', `${CANARY} Rising`)), bare = line(false, false, 'a failed rising');
  ok(whyT.startsWith('the failed rising ') && site && !full.includes('${') && citizenCut(full) === `${OUTLAW} (a failed rising); still a citizen through a faction or court based there` && citizenCut(bare) === bare,
    'CITIZEN outlaw (the line and its why read from citizenship.js and rebellion.js): the rising\'s name (a player\'s words) is cut; the character, the hold, the date and both flags stay', [full, citizenCut(full), citizenCut(bare)]);
  got = citizenCut(line(true, false, `${CANARY} (x) ${CANARY}`));
  ok(got === OUTLAW, '...a why of any other shape keeps the head only', got);
}
// every sentence setTerms can write (read from contracts.js, numbers filled in) passes the cut whole: a reworded sentence
// fails here instead of quietly leaving the player log with "set <hold> <term>" only
{
  const csrc = fs.readFileSync(path.join(ROOT, 'contracts.js'), 'utf8');
  const st = csrc.slice(csrc.indexOf('const setTerms = '), csrc.indexOf('audit(`CONTRACT ${who(a)} set '));
  const said = [...st.matchAll(/`([^`]*)`/g)].map((m) => m[1]).filter((t) => t.startsWith('${zone.name}'))
    .map((t) => t.replace(/\$\{zone\.name\}/g, 'Bruma').replace(/\$\{TIER_WORD\[tier\]\}/g, 'pests').replace(/\$\{tier\}/g, '1').replace(/\$\{[^}]*\}/g, '12'));
  const bad = said.filter((s) => {
    const term = / now pays /.test(s) ? 'price 1 12' : /'s standing contracts may now commit /.test(s) ? 'budget 12' : /'s posted work and commissions may now commit /.test(s) ? 'postbudget 12' : / again\.$/.test(s) ? 'standing on' : 'standing off';
    return contractText(`CONTRACT ${ROWAN} set Bruma ${term} ${CANARY}: ${s}`) !== `set Bruma ${term.split(' ')[0]}: ${s}`;
  });
  ok(said.length === 5 && bad.length === 0, `...each of setTerms' ${said.length} sentences (of 5) is kept word for word`, bad);
}
out = run('LABOUR-MISMATCH Rowan #PGDB (profile 1) chop widget=win/3 replay=1/5 seed=ab');
ok(out.some((r) => r.ev === 'sec.signal' && r.f.kind === 'mismatch' && r.f.game === 'labour'), 'a *-MISMATCH line is also a security signal', out.map((r) => r.ev));
// ---- roles --------------------------------------------------------------------------------------------------------------------
const roleOf = (r, c) => { const x = (r.o || []).find((y) => y.c === c); return x ? x.r : null; };
out = run('REVIVE Selene #K2QX (profile 2, <@22>) by Rowan #PGDB (profile 1, <@337337773973569537>) (a Draught of Revival)');
ok(out.length === 1 && out[0].c === 'PGDB' && roleOf(out[0], 'K2QX') === 'target' && out[0].f.text === 'Selene #K2QX by Rowan #PGDB (a Draught of Revival)', 'REVIVE <revived> by <reviver>: the reviver acts, the revived player is the target; another party\'s name stays in the text', out);
out = run('REVIVE Selene #K2QX (profile 2, <@22>) by nobody (gave up)');
ok(out.length === 1 && out[0].c === 'K2QX' && out[0].f.text === 'by nobody (gave up)', '...by nobody: the revived player is the only party', out);
out = run('CHAMPION Ulfgar the Unbroken in bruma killed by Rowan #PGDB, Selene #K2QX');
ok(out.length === 1 && out[0].ev === 'act.CHAMPION' && out[0].c === 'PGDB' && roleOf(out[0], 'K2QX') === 'other', 'CHAMPION (display() parties): the killers resolve by name and tag', out);
out = run(`CONCORDAT ARREST Rowan #PGDB (profile 1, <@337337773973569537>) (${CANARY} Of Lies) arrested Selene #K2QX (profile 2, <@22>) for the worship of Talos in Cyrodiil at 3c:Skyrim.esm`);
ok(out.length === 1 && out[0].c === 'PGDB' && roleOf(out[0], 'K2QX') === 'target' && !JSON.stringify(out).includes(CANARY), 'CONCORDAT ARREST: the rank title (a name the faction\'s leader can write) is cut out (privacy review P-R5)', out);
out = run('SMITH Selene #K2QX (profile 2) learned Steel Smithing (T2) by staff from Dar #U6T6 (profile 4)');
ok(out[0].c === 'K2QX' && roleOf(out[0], 'U6T6') === 'staff', 'SMITH: the learner is the actor, the staff member a staff party', out[0]);
out = run('SUPERNATURAL Selene #K2QX (profile 2) given sanguinare by GM Dar #U6T6 (profile 4)');
ok(out[0].ev === 'char.supernatural' && out[0].c === 'K2QX', 'SUPERNATURAL "<target> given ... by GM <gm>": the target is the actor (their post)', out[0]);
out = run(`DISCIPLINE strike #4 on Selene #K2QX (profile 2) (profile 2) by Dar #U6T6 (profile 4): ${CANARY} griefing`);
ok(out[0].ev === 'session.ban' && out[0].c === 'K2QX' && out[0].f.kind === 'strike' && roleOf(out[0], 'U6T6') === 'staff' && !JSON.stringify(out).includes(CANARY), 'DISCIPLINE "<kind> #n on <target> ... by <staff>: <reason>": the target\'s post, the staff party, no reason', out[0]);
const byStaff = out.filter((r) => r.c === 'U6T6');
ok(byStaff.length === 0, '...the staff member is never the actor of it (--who on them finds only what they did)');
// a ban issued on Discord (gamemode.js __dboDiscordBan, security audit L4-2)
out = run(`BAN Discord ban (guild ban) on Selene #K2QX (profile 2), 1 more character by Dar #U6T6 (profile 4): ${CANARY} threats`);
ok(out.length === 1 && out[0].ev === 'session.ban' && out[0].c === 'K2QX' && out[0].f.kind === 'ban' && roleOf(out[0], 'U6T6') === 'staff' && !JSON.stringify(out).includes(CANARY), 'BAN "Discord <ban|unban> (<via>) on <target> ... by <moderator>: <reason>": the target\'s post, the staff party, no reason', out);
out = run(`BAN Discord unban (ban role) on Selene #K2QX (profile 2) by Discord user ${CANARY}`);
ok(out.length === 1 && out[0].f.kind === 'unban' && !(out[0].o || []).length && !JSON.stringify(out).includes(CANARY), '...an unban by a Discord user with no character: no staff party, the username never kept', out);
out = run('COURIER #12 robbed from Selene #K2QX (profile 2) by Rowan #PGDB (profile 1): 2x Iron Ingot, 1x Bread');
ok(out[0].ev === 'item.theft' && out[0].c === 'PGDB' && roleOf(out[0], 'K2QX') === 'victim' && out[0].f.items.length === 2 && out[0].f.items[0].i === 'Iron Ingot', 'COURIER robbed: the robber acts, the victim is the victim, the record-named list kept', out[0]);
out = run('WAR w3: Rowan #PGDB (profile 1) killed Selene #K2QX (profile 2) in a war to the death');
ok(out[0].f.op === 'war_kill' && out[0].c === 'PGDB' && roleOf(out[0], 'K2QX') === 'victim', 'WAR kill: killer and victim', out[0]);
// ---- the verbs and sites of 23 Oct (elections, leadership doubles, staffguard) ------------------------------------------------
// one act.<verb> in Rowan's post with n other parties (Selene the target when there is one), checked as the flush validates it;
// its text, or what went wrong
const actOf = (line, verb, n) => {
  const o = run(line);
  const v = o.length === 1 ? R.validate(o[0], new Map(), new Map()) : null;
  const fine = v && v.ev === `act.${verb}` && v.c === 'PGDB' && (o[0].o || []).length === n && (n === 0 || roleOf(o[0], 'K2QX') === 'target') && !JSON.stringify([o, v]).includes(CANARY);
  return fine ? v.f.text : JSON.stringify(o);
};
// ELECTION STAFF <staff> struck the vote of <voter> in <hold> (round N): <reason> (citizenship.js strikeVote): the reason is
// what the Lead GM typed after the voter in /strikevote, so it goes, and a character it names never becomes a party; who
// struck whose vote, where and in which round stay
got = actOf(`ELECTION STAFF ${ROWAN} struck the vote of Selene #K2QX in Whiterun (round 1): ${CANARY} same PC as Dar #U6T6 (profile 4, <@44>)`, 'ELECTION', 0);
ok(got === 'STAFF Rowan #PGDB struck the vote of Selene #K2QX in Whiterun (round 1)', 'ELECTION strike: the Lead GM\'s typed reason is cut (a character it names is no party); who struck whose vote, where and in which round stay', got);
got = actOf(`ELECTION STAFF ${ROWAN} struck the vote of profile 7 in The Rift (round 2): ${CANARY} in Riften (round 9): "${CANARY} quoted" ${CANARY}`, 'ELECTION', 0);
ok(got === 'STAFF Rowan #PGDB struck the vote of profile 7 in The Rift (round 2)', '...a voter known by profile only, a reason with a fake hold, round and a quote', got);
out = run(`ELECTION STAFF A B C D E F G #PGDB (profile 1, <@337337773973569537>) struck the vote of Selene #K2QX in Whiterun (round 1): ${CANARY}`);
ok(out.length === 0, '...a strike line the cut cannot read (a name of seven words) keeps nothing', out);
got = actOf(`ELECTION STAFF ${ROWAN} undid the struck vote of Selene #K2QX in Whiterun`, 'ELECTION', 0);
ok(got === 'STAFF Rowan #PGDB undid the struck vote of Selene #K2QX in Whiterun', '...the strike undone, and the other ELECTION lines, are not cut', got);
// ELECTION <hold>: the vote of <name> (profile N, round N) is void|was already counted; staff review it: left <faction> <t>
// before voting and joined <faction> <t> after (citizenship.js voidRejoin): a faction's name can be one a player chose (a
// charter's or a rising's), so both go and the two times stay. The line names no party today, so it gives no event; the cut
// is read directly, for the day the voter is named with who()
const electionCut = (l) => { const d = R.AUDIT_VERBS.ELECTION; return d && typeof d.cut === 'function' ? d.cut(R.unquote(l), l) : R.unquote(l); };
const VOID = (end) => `ELECTION Whiterun: the vote of Selene (profile 2, round 1) ${end}`;
got = electionCut(VOID(`is void: left ${CANARY} Order 0 h 1 m before voting and joined ${CANARY} Rising 0 h 2 m after`));
ok(got === VOID('is void: left a faction 0 h 1 m before voting and joined one 0 h 2 m after'), 'ELECTION vote void: both faction names (a charter\'s or a rising\'s can be a player\'s words) are cut, the times stay', got);
got = electionCut(VOID(`was already counted; staff review it: left ${CANARY} 1 h 5 m before voting and joined ${CANARY} 2 h 0 m after ${CANARY}`));
ok(got === VOID('was already counted; staff review it'), '...an end of any other shape keeps the head only', got);
got = electionCut(VOID(`is void: left ${CANARY}" 0 h 1 m before voting and joined ${CANARY} 0 h 2 m after`));
ok(got === VOID('is void'), '...and so does an end a quote took', got);
out = run(VOID(`is void: left ${CANARY} 0 h 1 m before voting and joined Dar #U6T6 (profile 4, <@44>) 0 h 2 m after`));
ok(out.length === 0, '...a faction name shaped like a character is never a party', out);
// the line voidRejoin writes, built from citizenship.js itself (its audit template and its `why`, names filled with the
// canary): the times are kept word for word and no name passes, so a reworded `why` fails here, not quietly in the log
{
  const csrc = fs.readFileSync(path.join(ROOT, 'citizenship.js'), 'utf8');
  const vr = csrc.slice(csrc.indexOf('const voidRejoin = '), csrc.indexOf('const courtNotice = '));
  const whyT = (vr.match(/const why = `([^`]*)`;/) || [])[1] || '';
  const why = whyT.replace('${w.leftName}', `${CANARY} Order`).replace('${joined}', `${CANARY} Rising`).replace(/\$\{hm\([^}]*\)\}/g, '3 h 4 m');
  const site = sites.find((s) => s.file === 'citizenship.js' && s.t.includes(': the vote of ${w.name} '));
  const line = (open) => (site ? site.t : '').replace('${z.name}', 'Whiterun').replace('${w.name}', 'Selene').replace('${pid}', '2').replace('${w.round}', '1')
    .replace(/\$\{open \? '([^']*)' : '([^']*)'\}/, (m, a, b) => (open ? a : b)).replace('${why}', why);
  const want = (end) => VOID(`${end}: left a faction 3 h 4 m before voting and joined one 3 h 4 m after`);
  const lines = [line(true), line(false)];
  ok(whyT && site && !lines.some((l) => l.includes('${')) && electionCut(lines[0]) === want('is void') && electionCut(lines[1]) === want('was already counted; staff review it'),
    '...the line voidRejoin writes (its template and `why` read from citizenship.js) keeps the times and no faction name', lines.map(electionCut));
}
// LEADERSHIP <double> (account N) still holds N leadership seats, N days after being told to step down: <seats> (leadership.js
// sweep): a notice to staff, not something the player did, and its seats are rank titles a faction's leader or a Lead GM
// renames, player-named charters and risings: staff only, never read
{
  const n0 = K.S.auditUnknown.get('LEADERSHIP') || 0;
  out = run(`LEADERSHIP Selene #K2QX (account 2) still holds 2 leadership seats, 7 days after being told to step down: ${CANARY} Captain of ${CANARY} Rising and Jarl of Whiterun. Nothing has been taken away; /leadership audit lists every double.`);
  ok((R.AUDIT_VERBS.LEADERSHIP || {}).cls === 'excluded' && out.length === 0 && (K.S.auditUnknown.get('LEADERSHIP') || 0) === n0, 'LEADERSHIP double: classed excluded (staff only), no event and no unknown-verb count', { cls: (R.AUDIT_VERBS.LEADERSHIP || {}).cls, out, unknown: K.S.auditUnknown.get('LEADERSHIP') });
}
// STAFFREF <staff> <kind> on <target|profile N> under <ref> and STAFFREF <staff> works on <target> under <ref> for N minutes
// (staffguard.js): a ticket's id is whatever the staff member typed (parseRef, never checked), so it goes and "a ticket"
// stands for it; a GM call's number (an open call), "(held)", the kind, the parties and the minutes stay. The staff member
// acts and the character worked on is the target
got = actOf(`STAFFREF ${ROWAN} rename on ${SELENE} under ticket ${CANARY}-griefer.alt/of#K2QX`, 'STAFFREF', 1);
ok(got === 'rename on Selene #K2QX under a ticket', 'STAFFREF: a ticket\'s typed id is cut ("a ticket" stands for it); who, the kind and whom stay, the target in their post', got);
got = actOf(`STAFFREF ${ROWAN} faction on ${SELENE} under GM call #5 (held)`, 'STAFFREF', 1);
ok(got === 'faction on Selene #K2QX under GM call #5 (held)', '...a GM call held is kept', got);
got = actOf(`STAFFREF ${ROWAN} office on profile 2 under ticket ##K2QX${CANARY}`, 'STAFFREF', 0);
ok(got === 'office on profile 2 under a ticket', '...a target named by profile only (no party), with a ticket shaped like a #TAG', got);
got = actOf(`STAFFREF ${ROWAN} works on ${SELENE} under ticket ${CANARY} for 60 minutes`, 'STAFFREF', 1);
ok(got === 'works on Selene #K2QX under a ticket for 60 minutes', '...a /staffref bind on a ticket: the minutes stay, the id never', got);
got = actOf(`STAFFREF ${ROWAN} works on ${SELENE} under GM call #12 for 60 minutes ${CANARY} Dar #U6T6 (profile 4, <@44>)`, 'STAFFREF', 1);
ok(got === 'works on Selene #K2QX', '...an end of any other shape keeps who worked on whom only (a character in it is no party)', got);
out = run(`STAFFREF A B C D E F G #PGDB (profile 1, <@337337773973569537>) rename on ${SELENE} under ticket ${CANARY}`);
ok(out.length === 0, '...a line the cut cannot read (a name of seven words) keeps nothing', out);
// every reference staffguard.js writes (refText and the held call, read from the file) passes the cut as it should: a call
// word for word, a ticket's id never, so a reworded reference fails here
{
  const ssrc = fs.readFileSync(path.join(ROOT, 'staffguard.js'), 'utf8');
  const rt = ssrc.match(/const refText = \(r\) => \(r\.kind === 'call' \? `([^`]*)` : `([^`]*)`\);/);
  const hd = ssrc.match(/return held \? \{ text: `([^`]*)` \} : null;/);
  const refs = rt && hd ? [[rt[1].replace('${r.n}', '12'), true], [hd[1].replace('${held.n}', '5'), true], [rt[2].replace('${r.id}', `${CANARY}-x`), false]] : [];
  const bad = refs.filter(([ref, keep]) => actOf(`STAFFREF ${ROWAN} works on ${SELENE} under ${ref} for 60 minutes`, 'STAFFREF', 1) !== `works on Selene #K2QX under ${keep ? ref : 'a ticket'} for 60 minutes`
    || actOf(`STAFFREF ${ROWAN} citizenship on ${SELENE} under ${ref}`, 'STAFFREF', 1) !== `citizenship on Selene #K2QX under ${keep ? ref : 'a ticket'}`);
  ok(refs.length === 3 && !refs.some(([r]) => r.includes('${')) && bad.length === 0, `...each reference staffguard.js writes (${refs.length} of 3) passes the cut: a call word for word, a ticket's id never`, bad);
}
// STAFFGUARD <staff> used a staff tool (<kind>) on the staff account of <target>, STAFFCHAR <staff> marked|unmarked <target> as
// a staff character (staffguard.js): identities and the code's own words; the staff member acts, the other is the target
got = actOf(`STAFFGUARD ${ROWAN} used a staff tool (skills) on the staff account of ${SELENE}`, 'STAFFGUARD', 1);
ok(got === 'used a staff tool (skills) on the staff account of Selene #K2QX', 'STAFFGUARD: who used which kind of tool on whose staff account, the target in their post', got);
got = actOf(`STAFFCHAR ${ROWAN} marked ${SELENE} as a staff character`, 'STAFFCHAR', 1);
ok(got === 'marked Selene #K2QX as a staff character', 'STAFFCHAR: who marked whom, the character marked in their post', got);
got = actOf(`STAFFCHAR ${ROWAN} unmarked ${SELENE} as a staff character`, 'STAFFCHAR', 1);
ok(got === 'unmarked Selene #K2QX as a staff character', '...and unmarked', got);
// ---- reclassified and list-keeping verbs --------------------------------------------------------------------------------------
out = run(`THEFT Rowan #PGDB (profile 1) picked ${CANARY} from Selene #K2QX (profile 2) (32%)`);
ok(out[0] && out[0].ev === 'item.theft' && out[0].f.kind === 'pickpocket' && !JSON.stringify(out).includes(CANARY), 'THEFT with a custom-named item: the parties and the outcome, never the label', out);
out = run(`ROBBERY Rowan #PGDB (profile 1) robbed Selene #K2QX (profile 2): 40 gold of 100; items [Iron Sword, Bread]; key ${CANARY} Manor`);
ok(out[0].f.items.map((x) => x.i).join(',') === 'Iron Sword,Bread' && out[0].f.keyTaken === true && !JSON.stringify(out).includes(CANARY), 'ROBBERY: the record-named list kept, the key\'s name never, keyTaken only', out[0]);
out = run(`RAID break-in by Rowan #PGDB (profile 1) (${CANARY} Clan) at container 806ca1f of home 806ca1f (Mike Morethi): 40 gold, Iron Sword and Bread`);
ok(out[0].f.kind === 'raid' && out[0].f.gold === 40 && out[0].f.items.length === 2 && out[0].o.some((x) => x.r === 'owner' && x.c === '5D8L') && !JSON.stringify(out).includes(CANARY), 'RAID: record names kept, routed to the home\'s owner from its ref, no faction name', out[0]);
out = run(`POST Rowan #PGDB (profile 1) collected 5 gold, 2x Bread from ${CANARY} the Forger`);
ok(out[0].f.op === 'parcel_collected' && out[0].f.items[0].i === 'Bread' && !JSON.stringify(out).includes(CANARY), 'POST: the list kept, "from <m.from>" never', out[0]);
out = run('SUPPLY Rowan #PGDB (profile 1) delivered 3x Iron Ingot to #12 of Selene #K2QX for 30 gold');
ok(out[0].ev === 'act.SUPPLY' && /3x Iron Ingot/.test(out[0].f.text), 'SUPPLY: clean, record names', out[0]);
out = run(`WARBAND Dar #U6T6 (profile 4) fights for ${CANARY}`);
ok(!JSON.stringify(out).includes(CANARY), 'WARBAND "fights for <side>": no side name', out);
out = run(`ECONOMY Rowan #PGDB (profile 1) set ${CANARY} Hold's tax rate to 12%`);
ok(out[0].f.op === 'tax_rate' && out[0].f.pct === 12 && !JSON.stringify(out).includes(CANARY), 'ECONOMY: the ruler\'s action, no faction name', out[0]);
out = run('ECONOMY Rowan #PGDB (profile 1) assessed property 806ca1f at 900 gold (was 800)');
ok(out[0].f.op === 'assessed' && out[0].o.some((x) => x.r === 'owner' && x.c === '5D8L'), '...an assessment also reaches the property owner', out[0]);
// ---- the server's adminLog lines: the IP is never read --------------------------------------------------------------------------
out = run('GM profile 4 (gm) lifted the ban on Bob / ip 10.20.30.40');
ok(!JSON.stringify(out).includes('10.20.30.40') && out[0].f.action === 'unban', 'GM profile N ... / ip <addr>: the IP stripped', out);
out = run('GM profile 4 (gm) kicked Selene (profile 2)');
ok(out.some((r) => r.ev === 'staff.action' && r.f.action === 'kick' && r.o[0].p === 2) && out.some((r) => r.ev === 'session.kick' && r.p === 2), 'GM profile N kicked <Name> (profile M): staff.action and the target\'s session.kick', out);
out = run(`GM Dar #U6T6 (profile 4) /system: ${CANARY}`);
ok(out[0].ev === 'staff.world' && out[0].f.action === 'broadcast' && !JSON.stringify(out).includes(CANARY), '/system: staff.world{broadcast}, never the text', out);
out = run(`NAME Rowan #PGDB (profile 1) reroll name "${CANARY}" refused (Names are 2-24 characters.); kept "Rowan"`);
ok(out.length === 0, 'a refused name (raw typed text) gives nothing', out);
out = run('NAME profile 1 renamed "Rowan" -> "Rowena"');
ok(out[0].ev === 'char.rename' && out[0].f.from === 'Rowan' && out[0].f.to === 'Rowena' && out[0].p === 1, 'NAME renamed: char.rename (names are identity)', out[0]);
out = run('DEITY Rowan #PGDB (profile 1, <@337337773973569537>) took Mara (Eight Divines)');
ok(out.length === 1 && out[0].ev === 'char.deity' && out[0].f.op === 'chose' && out[0].f.deity === 'Mara', 'DEITY took <god> (<faith>): the choice and the god, with the faith the line names since the faiths (19 Oct)', out);
out = run('DEITY Rowan #PGDB (profile 1, <@337337773973569537>) turned to Kynareth');
ok(out.length === 1 && out[0].f.op === 'turned' && out[0].f.deity === 'Kynareth', '...and a line with no faith', out);
out = run('POST Rowan #PGDB (profile 1, <@337337773973569537>) burned a letter with a parcel they cannot carry: [["12eb7",1]]');
ok(!out.some((r) => r.ev === 'item.mail'), 'POST burned a letter with its parcel: never read as a parcel collected', out);
out = run(`BOARD [profile 1] posted in bruma (Notices) for 10 gold: "${CANARY}"`);
ok(!JSON.stringify(out).includes(CANARY), 'BOARD: the note never', out);
out = run(`PIGEON Rowan #PGDB (profile 1) sent Selene a letter signed "${CANARY}"`);
ok(out.length === 0, 'PIGEON: excluded', out);
// ---- unknown verbs: counted by name when shaped like one, else '?' --------------------------------------------------------------
run('NEWVERB Rowan #PGDB (profile 1) did something');
run(`${CANARY} lowercase thing`);
run(`${CANARY.toLowerCase()} lowercase thing`);
ok(K.S.auditUnknown.get('NEWVERB') === 1 && !K.S.auditUnknown.has(CANARY.toLowerCase()) && K.S.auditUnknown.get('_other') >= 1, 'an unknown verb is counted by name only, nothing else of the line', [...K.S.auditUnknown]);
// the minute's sys.audit_unknown is valid as it stands, so no sys.schema follows it, then or in the minutes after (a '?' key
// was refused by COUNTS and made sys.schema write itself every minute). The flush's validation is done here by hand.
const vq = (from) => { for (const r of K.S.q.slice(from)) if (String(r.ev).startsWith('sys.')) R.validate(r, K.S.schemaDrops, K.S.unknownTypes); };
for (let i = 0; i < 3; i++) { const q0 = K.S.q.length; TM.run('playerlogMinute'); vq(q0); }
const sysAU = K.S.q.filter((r) => r.ev === 'sys.audit_unknown');
ok(sysAU.some((r) => r.f.verbs && r.f.verbs._other >= 1) && !K.S.q.some((r) => r.ev === 'sys.schema'), 'an unknown line\'s count is a key COUNTS keeps: no self-perpetuating sys.schema', K.S.q.filter((r) => String(r.ev).startsWith('sys.')).map((r) => [r.ev, r.f]));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
