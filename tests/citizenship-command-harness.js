// Scripted test for citizenship.js's /citizenship (Jake, 4 Nov 2026: the Dragon Baron panel's Citizenship button, "Build it"):
// /citizenship <name|#TAG> view | grant <hold> | revoke <hold> | cooldown clear|<length>. Loads the real module in a scratch
// folder against a mock world; the staff rules (staffguard.js) are stood in for by a target() that wants a call or ticket,
// taken out of the line as gamemode.js handleLine does.
//
//   node tests/citizenship-command-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'citizenship.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-citizen-command-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
let now = Date.UTC(2026, 10, 4, 20, 0);
Date.now = () => now;
const HOUR = 3600000, DAY = 24 * HOUR;

let fails = 0, checks = 0;
const ok = (c, what, got) => { checks++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

// ---- the world ---------------------------------------------------------------------------------------------------------
const ZONES = [
  { id: 'bruma', name: 'Bruma', treasury: 'x', officials: ['count', 'steward', 'captain', 'guard'] },
  { id: 'whiterun', name: 'Whiterun', treasury: 'y', officials: ['jarl', 'steward', 'commander', 'guard'] },
  { id: 'riften', name: 'The Rift', treasury: 'z', officials: ['jarl', 'steward', 'commander', 'guard'] },
];
const officials = { bruma: { count: [1] }, riften: { jarl: [2] } };
const chars = new Map();
const add = (id, pid, name, tag) => { chars.set(id >>> 0, { pid, name, tag }); return id >>> 0; };
const COUNT = add(0x10, 1, 'Count Carvain', 'CNT1');
const LEAD = add(0x30, 30, 'Leda Lead', 'LEAD');
const GM = add(0x31, 31, 'Gemma Gm', 'GMGM');
const AELA = add(0xff0010a1, 55, 'Aela Testborn', 'AELA');
const BRAND = add(0xff0010a2, 56, 'Brand Asker', 'BRND');
const CATO = add(0xff0010a3, 57, 'Cato Guildsman', 'CATO');
const DAGNY = add(0xff0010a4, 58, 'Dagny Newcomer', 'DGNY');
let online = [COUNT, LEAD, GM, AELA, CATO];
const guilds = new Map([[CATO, [{ id: 'fighters-guild', name: 'Fighters Guild', title: 'Guardian', role: 'member', kind: 'guild', zone: '', hall: { zone: 'bruma' } }]]]);
globalThis.__dboGuildsOf = (a) => guilds.get(a >>> 0) || [];
globalThis.__dboCourtFaction = (z) => ({ bruma: 'county-bruma', whiterun: 'hold-whiterun' })[z] || null;
globalThis.__dboGuildHolders = () => [];
globalThis.__dboJournalFresh = () => true;
globalThis.__dboJournalLimited = () => {};
// staffguard.js target(): a Lead GM acting as staff needs a call or ticket for kind citizenship (callRef), from the line
let ref = '';
const targets = [];
globalThis.__dboStaffGuard = { target: (by, t, kind) => { targets.push([by >>> 0, t >>> 0, kind]); return ref ? '' : 'This needs an open GM call or a ticket: add call:<n> or ticket:<id> to the command.'; } };

const mp = { get: (id, p) => { const c = chars.get(id >>> 0); if (!c) throw new Error('no such form'); if (p === 'type') return 'MpActor'; if (p === 'profileId') return c.pid; return undefined; } };
const said = [], audits = [], logs = [];
const cmds = new Map();
// gamemode.js officialTarget: a #TAG (online or offline) or an exact name, else the error
const officialTarget = (q) => {
  const s = String(q || '').trim().toLowerCase();
  const hit = [...chars.entries()].find(([, c]) => (s.startsWith('#') ? `#${c.tag}`.toLowerCase() === s : c.name.toLowerCase() === s));
  if (!hit) return { error: `No character called ${q}. Use their name, #TAG or profile id.` };
  return { pid: hit[1].pid, actor: hit[0], online: online.includes(hit[0]) ? hit[0] : 0, label: `${hit[1].name} #${hit[1].tag}`, who: hit[1].name };
};
let citizenCfg = {};
const api = () => ({
  mp, log: (...x) => logs.push(x.join(' ')), audit: (t) => audits.push(t),
  who: (a) => `${(chars.get(a >>> 0) || {}).name || `actor ${a}`} (profile ${(chars.get(a >>> 0) || {}).pid}, <@111111111111111111>)`,
  personal: (a, t) => said.push([a >>> 0, t]), nameOf: (a) => chars.get(a >>> 0).name, ownNameOf: (a) => chars.get(a >>> 0).name, tagOf: (a) => (chars.get(a >>> 0) || {}).tag || '',
  onUi: () => {}, onlineActors: () => online.slice(), isAdmin: (a) => a === LEAD || a === GM, isLeadStaff: (a) => a === LEAD,
  profileOf: (a) => { const c = chars.get(a >>> 0); return c ? c.pid : -1; },
  cfg: { citizenship: JSON.parse(JSON.stringify(citizenCfg)) }, every: () => {},
  zoneList: () => ZONES, zoneById: (id) => ZONES.find((z) => z.id === String(id)) || null, readOfficials: () => officials,
  rankTitle: (r) => ({ count: 'Count', jarl: 'Jarl', steward: 'Steward', commander: 'Lord Commander' })[r] || r,
  officialTarget, accountActors: (pid) => [...chars.entries()].filter(([, c]) => c.pid === pid).map(([id]) => id),
  seatOfficial: () => ({ text: 'seated' }), unseatOfficialBy: () => ({ text: 'unseated' }),
  takeGold: () => true, depositToTreasury: (z, n) => n, openWidget: () => true, closeWidget: () => true, boardZoneNear: () => null, raceEdidOf: () => 'NordRace',
  registerChatCommand: (name, fn, o) => cmds.set(name, { fn, o: o || {} }),
});
let M = null;
const load = () => { delete require.cache[MODULE]; delete globalThis.__dboCitizen; cmds.clear(); M = require(MODULE)(api()); return M; };
const hx = (a) => (a >>> 0).toString(16);
// As typed: handleLine's staff rules take a call or ticket word out of the line and hold it while the command runs
const run = (by, line) => {
  const words = line.split(' ');
  const r = words.find((w) => /^(call|ticket):/i.test(w));
  ref = r || '';
  const from = said.length;
  try { cmds.get('citizenship').fn(by, words.filter((w) => w !== r).join(' ')); } finally { ref = ''; }
  return said.slice(from).filter(([a]) => a === (by >>> 0)).map(([, t]) => t);
};
const told = (a) => said.filter(([x]) => x === (a >>> 0)).map(([, t]) => t);

// ---- the rolls ---------------------------------------------------------------------------------------------------------
const GRANT_HOW = 'granted by Count Testwell #TST1 (profile 90, <@222222222222222222>)';
fs.writeFileSync(path.join(dir, 'citizenship.json'), JSON.stringify({
  chars: {
    [hx(AELA)]: { pid: 55, name: 'Aela Testborn', holds: [{ zone: 'bruma', since: now - 3 * DAY, how: GRANT_HOW }, { zone: 'whiterun', since: now - DAY, how: 'free (no ruler)' }],
      cooldownUntil: now + 2 * DAY, renounced: [{ zone: 'riften', at: now - 5 * DAY }] },
  },
  requests: [{ zone: 'riften', actor: BRAND, pid: 56, name: 'Brand Asker', at: now - HOUR }],
  policies: { riften: { policy: 'manual', fee: 0, by: 'x', at: now - DAY } },
  elections: {},
}));
load();

// ---- the command --------------------------------------------------------------------------------------------------------
ok(cmds.has('citizenship') && cmds.get('citizenship').o.admin === true && /view \| grant <hold> \| revoke <hold> \| cooldown/.test(cmds.get('citizenship').o.help),
  'registered as /citizenship, a staff command, with the forms in its help', cmds.get('citizenship') && cmds.get('citizenship').o);

// view
let out = run(LEAD, '#AELA view');
ok(out.length === 2 && out[0].startsWith('Aela Testborn #AELA: a citizen of Bruma (Primary, since 2026-11-01 20:00 UTC, granted by Count Testwell #TST1 (profile 90, )); Whiterun (Secondary, since 2026-11-03 20:00 UTC, free (no ruler)).')
  && out[1] === 'No new citizenship until 2026-11-06 20:00 UTC (renounced lately).', 'view: the holds, Primary first, how each was had, and the cooldown', out);
ok(!out.join(' ').match(/<@|\d{15,}/), 'view: no Discord mention or id goes back in the answer', out);
out = run(LEAD, 'Cato Guildsman view');
ok(out.length === 1 && out[0] === 'Cato Guildsman #CATO: a citizen of Bruma (through Fighters Guild).', 'view: by exact name too, and a citizenship through a faction based there', out);
out = run(LEAD, '#BRND view');
ok(out[0] === 'Brand Asker #BRND: a citizen of no hold.' && out[1] === 'Asked for the citizenship of the Rift.', 'view: an offline character by #TAG, with the request waiting', out);
ok(!targets.length, 'view: a look needs no call or ticket (no staff rule asked)', targets);
out = run(GM, '#AELA view');
ok(out.length === 1 && out[0] === 'Only a Lead GM or above looks up a citizenship.', 'view: a GM is refused, as the F3 lookup', out);

// grant: the character's pending request, as the hold's court grants it
out = run(LEAD, '#DGNY grant riften ticket:481');
ok(out[0] === 'That character has not asked for citizenship here.' && !M.citizenOf(DAGNY, 'riften'), 'grant: only a pending request is granted (nobody is made a citizen unasked)', out);
out = run(GM, '#BRND grant riften ticket:481');
ok(/^Only the Jarl or the Steward of the Rift grants its citizenship\.$/.test(out[0]) && !M.citizenOf(BRAND, 'riften'), 'grant: a GM is refused (the court and Lead GMs grant)', out);
out = run(LEAD, '#BRND grant riften');
ok(/^This needs an open GM call or a ticket/.test(out[0]) && !M.citizenOf(BRAND, 'riften'), 'grant: a Lead GM without a call or ticket is refused by the staff rules, nothing granted', out);
out = run(LEAD, '#BRND grant atlantis ticket:481');
ok(out[0] === 'No hold called atlantis grants a citizenship: bruma, whiterun, riften.', 'grant: an unknown hold lists the holds', out);
audits.length = 0;
out = run(LEAD, '#BRND grant the-rift ticket:481');
ok(out[0] === 'Brand Asker is now a citizen of the Rift.' && M.citizenOf(BRAND, 'riften') && audits.some((l) => /^CITIZEN .*Leda Lead.* granted Brand Asker \(character ff0010a2\) the citizenship of The Rift$/.test(l)),
  'grant: with the ticket a Lead GM grants it, by the hold\'s name, audited', { out, audits });
ok(targets.some(([by, t, kind]) => by === LEAD && t === BRAND && kind === 'citizenship'), 'grant: under the staff rules for kind citizenship', targets);

// revoke
out = run(LEAD, '#AELA revoke whiterun');
ok(/^This needs an open GM call or a ticket/.test(out[0]) && M.citizenOf(AELA, 'whiterun'), 'revoke: without a call or ticket refused, the citizenship kept', out);
out = run(GM, '#AELA revoke whiterun ticket:481');
ok(out[0] === 'Only a Lead GM or above revokes a citizenship.' && M.citizenOf(AELA, 'whiterun'), 'revoke: a GM is refused', out);
audits.length = 0;
out = run(LEAD, '#AELA revoke Whiterun ticket:481');
ok(out[0] === 'Aela Testborn is no longer a citizen of Whiterun.' && !M.citizenOf(AELA, 'whiterun') && M.citizenOf(AELA, 'bruma') && audits.some((l) => /^CITIZEN STAFF .* revoked the citizenship of Whiterun from Aela Testborn/.test(l))
  && told(AELA).includes('Your citizenship of Whiterun was revoked by the staff.'), 'revoke: with the ticket, any case of the hold, the other citizenship kept, she is told', { out, audits });
out = run(LEAD, '#CATO revoke bruma ticket:481');
ok(/^Cato Guildsman is a citizen of Bruma through Fighters Guild\. It ends when they leave it\.$/.test(out[0]) && M.citizenOf(CATO, 'bruma'), 'revoke: a citizenship through a faction is refused with why', out);

// cooldown
const coolOf = (a) => Number((M.data().chars[hx(a)] || {}).cooldownUntil) || 0;
out = run(LEAD, '#AELA cooldown clear');
ok(/^This needs an open GM call or a ticket/.test(out[0]) && coolOf(AELA) === now + 2 * DAY, 'cooldown clear: without a call or ticket refused, the cooldown kept', out);
out = run(GM, '#AELA cooldown clear ticket:481');
ok(out[0] === 'Only a Lead GM or above changes a citizenship cooldown.' && coolOf(AELA) === now + 2 * DAY, 'cooldown: a GM is refused', out);
audits.length = 0;
out = run(LEAD, '#AELA cooldown clear ticket:481');
ok(out[0] === 'Aela Testborn may take a citizenship now.' && coolOf(AELA) === 0 && audits.some((l) => /^CITIZEN STAFF .* cleared the citizenship cooldown of Aela Testborn \(character ff0010a1\)$/.test(l))
  && told(AELA).includes('The staff lifted your citizenship cooldown: you may take a citizenship now.'), 'cooldown clear: with the ticket, audited, she is told', { out, audits });
out = run(LEAD, '#AELA cooldown clear ticket:481');
ok(out[0] === 'Aela Testborn has no citizenship cooldown running.', 'cooldown clear: none running says so', out);
out = run(LEAD, '#DGNY cooldown 3d ticket:481');
ok(out[0] === 'Dagny Newcomer may take no new citizenship until 2026-11-07 20:00 UTC.' && coolOf(DAGNY) === now + 3 * DAY, 'cooldown <length>: sets one, on a character not yet on the rolls', out);
const bad = ['8d', '200h', 'soon', '1.5d', ''].map((w) => [w, run(LEAD, `#DGNY cooldown ${w} ticket:481`.replace('  ', ' '))]);
ok(bad.every(([, o]) => o[0] === 'Use cooldown clear, or a length of at most 7 days, like 12h or 3d.') && coolOf(DAGNY) === now + 3 * DAY, 'cooldown: past cooldownDays or not a length is refused, nothing changed', bad);

// usage
const usage = ['', '#AELA', '#AELA status', '#AELA grant'].map((l) => [l, run(LEAD, l)]);
ok(usage.slice(0, 3).every(([, o]) => /^Use \/citizenship <name\|#TAG> view \| grant <hold>/.test(o[0])) && usage[3][1][0] === 'No hold called (none) grants a citizenship: bruma, whiterun, riften.', 'a missing or unknown action shows the usage; a grant without a hold lists the holds', usage);
out = run(LEAD, '55 view');
ok(out[0] === 'Name the character by their name or #TAG.', 'a profile id is not a character', out);
out = run(LEAD, '#ZZZZ view');
ok(/^No character called #ZZZZ/.test(out[0]), 'an unknown #TAG is said', out);
citizenCfg = { enabled: false };
load();
out = run(LEAD, '#AELA view');
ok(out[0] === 'Citizenship is switched off.', 'with citizenship off in config it says so', out);

console.log('');
console.log(fails ? `${fails} FAILED of ${checks}` : `all ${checks} checks passed`);
process.exit(fails ? 1 : 0);
