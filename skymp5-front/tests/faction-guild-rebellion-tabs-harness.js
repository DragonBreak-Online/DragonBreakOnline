// Renders the faction panel's Guild and Rebellion tabs (features/faction/guild.tsx, rebellion.tsx) to HTML from payloads
// shaped as the server's (playerguilds.js __dboGuildTabView, rebellion.js __dboRebellionView) and checks what each shows:
// the rules, found/invite/rename/disband by rank, a refused character's reason; the petition's count, its signer names
// only for its carrier, the leader's and starter's buttons, declare, join, the death-war answer and the war timeline; and
// that FactionContent hides the Rebellion tab when the payload has none.
//   node tests/faction-guild-rebellion-tabs-harness.js [front dir]
// Env: ESBUILD_DIR, FRONT_NM. Prints ok/FAIL lines and exits 1 on a FAIL.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const FRONT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const HOME = process.env.HOME || '';
const firstWith = (file, ...dirs) => dirs.find((d) => d && fs.existsSync(path.join(d, file)));
const NM = firstWith('react-dom/server.js', process.env.FRONT_NM, path.join(FRONT, 'node_modules'), path.join(HOME, 'dragonbreak/fork/skymp5-front/node_modules'));
const ESB = firstWith('package.json', process.env.ESBUILD_DIR, path.join(FRONT, '../skymp5-server/node_modules/esbuild'), path.join(HOME, 'dragonbreak/fork/skymp5-server/node_modules/esbuild'));
if (!NM || !ESB) { console.log(`SKIP needs FRONT_NM (${NM}) and ESBUILD_DIR (${ESB})`); process.exit(0); }
const esbuild = require(ESB);
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'faction-tabs-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let fails = 0;
const ok = (cond, msg, got) => { if (cond) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg + (got !== undefined ? '   ' + String(got).slice(0, 400) : '')); } };
const F = (f) => JSON.stringify(path.join(FRONT, 'src/features/faction', f));
fs.writeFileSync(path.join(TMP, 'entry.jsx'), `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuildTab } from ${F('guild.tsx')};
import { RebellionTab } from ${F('rebellion.tsx')};
import { FactionContent } from ${F('index.tsx')};
const act = () => {};
export const guild = (band) => renderToStaticMarkup(React.createElement(GuildTab, { band, act, busy: false, nonce: null }));
export const rebellion = (reb) => renderToStaticMarkup(React.createElement(RebellionTab, { reb, act, busy: false, okNonce: null }));
export const content = (data) => renderToStaticMarkup(React.createElement(FactionContent, { data }));
`);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

(async () => {
  await esbuild.build({
    entryPoints: [path.join(TMP, 'entry.jsx')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(TMP, 'out.js'),
    logLevel: 'error', nodePaths: [NM], jsx: 'transform',
    loader: { '.js': 'jsx', '.scss': 'empty', '.sass': 'empty', '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.ttf': 'empty', '.otf': 'empty', '.mp3': 'empty', '.wav': 'empty' },
  });
  const R = require(path.join(TMP, 'out.js'));
  const RULES = ['Up to 10 members, the Guildmaster included.', 'One guild per character.', 'No other faction: a member of any faction cannot found or join a guild. A faith or a magic college may stand beside it.', 'No wars, no territory, no hall, no uniform, no treasury: a guild is a group of players, nothing more.'];
  const band = (o) => Object.assign({ enabled: true, maxMembers: 10, rules: RULES, blocked: '', mine: null, invites: [] }, o);

  // ---- Guild ----------------------------------------------------------------------------------------------------------
  let t = text(R.guild(band({})));
  ok(RULES.every((r) => t.includes(r)), 'Guild: the four rules are shown as plain text', t);
  ok(/Found a guild/.test(t) && /Found/.test(t) && !/Disband|Rename|Leave the guild/.test(t), 'Guild, in none: the found field, no member buttons', t);
  t = text(R.guild(band({ blocked: 'You belong to Fighters Guild. A guild is for players in no faction: leave it first.' })));
  ok(/You belong to Fighters Guild/.test(t) && !/The guild's name/.test(R.guild(band({ blocked: 'x' }))), 'Guild, refused: the server\'s reason instead of the field', t);
  t = text(R.guild(band({ invites: [{ id: 'guild-a', name: 'The Wayfarers', from: 'Master' }] })));
  ok(/Master invites you into the guild The Wayfarers/.test(t) && /Join/.test(t) && /Decline/.test(t), 'Guild: an invitation with Join and Decline', t);
  const mine = { id: 'guild-a', name: 'The Wayfarers', rank: 0, title: 'Guildmaster', master: true, officer: true, members: 3, guildmaster: 'Master' };
  t = text(R.guild(band({ mine })));
  ok(/3 of 10 members/.test(t) && /You are its Guildmaster/.test(t) && /Invite/.test(t) && /Rename/.test(t) && /Disband/.test(t), 'Guild, Guildmaster: invite, rename, disband', t);
  ok(/make another member Guildmaster/.test(t) && !/Leave the guild/.test(t), 'Guild, Guildmaster with members: leaving is explained, not offered', t);
  t = text(R.guild(band({ mine: Object.assign({}, mine, { members: 1 }) })));
  ok(/Leave the guild/.test(t), 'Guild, last member: may leave', t);
  t = text(R.guild(band({ mine: Object.assign({}, mine, { rank: 2, title: 'Member', master: false, officer: false }) })));
  ok(/You are its Member\. Its Guildmaster is Master/.test(t) && !/Invite|Rename|Disband/.test(t) && /Leave the guild/.test(t), 'Guild, Member: only leave', t);
  t = text(R.guild(band({ mine: Object.assign({}, mine, { rank: 1, title: 'Officer', master: false }) })));
  ok(/Invite/.test(t) && !/Rename|Disband/.test(t), 'Guild, Officer: invite but no rename or disband', t);
  t = text(R.guild(band({ enabled: false })));
  ok(/Guilds are closed right now/.test(t) && !/The guild's name/.test(R.guild(band({ enabled: false }))), 'Guild, closed: says so, no field', t);

  // ---- Rebellion ------------------------------------------------------------------------------------------------------
  const now = Date.now(); const H = 3600000;
  const rules = { noticeDays: 3, windowsPerWar: 3, windowHours: 2, deathWar: true, petitionDays: 14, outlawDays: 30, outlawBounty: 1000, joinAfterDeclare: true };
  const reb = (o) => Object.assign({ rules, petition: null, holds: [], cooldownUntil: 0, risings: [], staffPetitions: null }, o);
  t = text(R.rebellion(reb({ holds: [{ id: 'whiterun', name: 'Whiterun Hold', open: true }] })));
  ok(/Begin a petition in Whiterun Hold/.test(t) && /Sign a petition/.test(t) && /lapses after 14 days/.test(t) && /outlaw of the hold for 30 days, wanted for 1000 gold/.test(t), 'Rebellion, nothing yet: begin, sign by word, the rules', t);
  const pet = { id: 1, zone: 'whiterun', holdName: 'Whiterun Hold', code: 'A1B2C3', startedAt: now, expiresAt: now + 14 * 24 * H, count: 4, needMin: 10, needShare: 4, citizens: 15, mode: 'both', needed: 10, met: false, needText: '',
    starter: false, leader: false, starterName: '', leaderName: '', claimant: null, name: 'The Whiterun Rising', named: false, signers: [] };
  t = text(R.rebellion(reb({ petition: pet })));
  ok(/A1B2C3/.test(t) && /4 of 10 names\./.test(t) && /Your name is on it/.test(t) && /Take my name back/.test(t) && !/Signed \(/.test(t) && !/Declare/.test(t), 'Rebellion, a signer: the word and the count, no names, unsign', t);
  const signers = [{ actor: 1, name: 'Citizen0', starter: true, leader: false }, { actor: 2, name: 'Citizen1', starter: false, leader: true }, { actor: 3, name: 'Citizen2', starter: false, leader: false }];
  t = text(R.rebellion(reb({ petition: Object.assign({}, pet, { starter: true, starterName: 'Citizen0', leaderName: 'Citizen1', signers, claimant: { actor: 2, name: 'Citizen1' } }) })));
  ok(/Signed \(3\)/.test(t) && /Citizen2/.test(t) && /Make leader/.test(t) && !/To the throne/.test(t) && /Tear it up/.test(t) && !/Declare/.test(t), 'Rebellion, the starter: the names, Make leader, tear up; no declare', t);
  t = text(R.rebellion(reb({ petition: Object.assign({}, pet, { leader: true, met: true, count: 10, leaderName: 'Citizen1', signers, claimant: { actor: 2, name: 'Citizen1' } }) })));
  ok(/To the throne/.test(t) && /Name the rising/.test(t) && /Declare the rising/.test(t) && /Declare, to the death/.test(t) && /enough to rise/.test(t), 'Rebellion, the leader with enough names: claimant, name, declare (and to the death)', t);
  ok((R.rebellion(reb({ petition: Object.assign({}, pet, { leader: true, met: true, signers, claimant: { actor: 2, name: 'C' } }) })).match(/To the throne/g) || []).length === 2, 'Rebellion: no To the throne on the claimant already named');
  t = text(R.rebellion(reb({ rules: Object.assign({}, rules, { deathWar: false }), petition: Object.assign({}, pet, { leader: true, met: true, signers }) })));
  ok(/Declare the rising/.test(t) && !/to the death/.test(t), 'Rebellion: no death option when the config forbids it', t);
  const rising = { id: 1, name: 'The Whitemane Rising', zone: 'whiterun', holdName: 'Whiterun Hold', status: 'active', declaredAt: now - 4 * 24 * H, startsAt: now - H,
    leaderName: 'Citizen1', claimantName: 'Citizen2', capital: 'Whiterun', rebels: ['Citizen0', 'Citizen1', 'Citizen2'], rebel: false, leads: false, rules: false, canJoin: true, canAnswerDeath: false,
    war: { status: 'active', startsAt: now - H, windows: [{ start: now - H, end: now + H }, { start: now + 24 * H, end: now + 26 * H }], death: 'refused', captures: [{ territory: 'Rorikstead', at: now - 0.5 * H, byRebels: true }] } };
  t = text(R.rebellion(reb({ risings: [rising] })));
  ok(/The Whitemane Rising/.test(t) && /under way/.test(t) && /Citizen2 would take the throne/.test(t) && /3 rebels: Citizen0, Citizen1, Citizen2/.test(t), 'Rebellion: a declared rising, public', t);
  ok(/Declared/.test(t) && /Notice until/.test(t) && /Battle 1: .*\(now\)/.test(t) && /Battle 2:/.test(t) && /Rorikstead taken by the rebels/.test(t), 'Rebellion: the timeline, the window under way, a capture', t);
  ok(/Join the rising/.test(t) && /refused a war to the death/.test(t) && !/Accept a war to the death/.test(t), 'Rebellion: join for a citizen; the refused death war', t);
  t = text(R.rebellion(reb({ risings: [Object.assign({}, rising, { status: 'notice', canJoin: false, rules: true, canAnswerDeath: true, war: Object.assign({}, rising.war, { death: 'proposed', captures: [] }) })] })));
  ok(/This rising stands against you/.test(t) && /Accept a war to the death/.test(t) && /Refuse/.test(t) && !/Join the rising/.test(t), 'Rebellion, the ruler: accept or refuse the death war', t);
  t = text(R.rebellion(reb({ staffPetitions: [Object.assign({}, pet, { starterName: 'Citizen0', leaderName: 'Citizen1', signers })] })));
  ok(/Every petition \(staff\)/.test(t) && /Begun by Citizen0, led by Citizen1/.test(t) && /Citizen2/.test(t) && !/Make leader/.test(t), 'Rebellion, Lead GM: every petition, its signers, no buttons', t);

  // ---- FactionContent: the tabs ------------------------------------------------------------------------------------------
  const data = { id: 37, nonce: 'n', admin: false, self: 1, factions: [], invites: [], selected: '', result: '', resultKind: '' };
  t = text(R.content(Object.assign({}, data, { band: band({}), rebellion: null })));
  ok(/ Guild /.test(t) && !/Rebellion/.test(t), 'the panel: a Guild tab, and no Rebellion tab while risings are off', t);
  t = text(R.content(Object.assign({}, data, { band: band({ invites: [{ id: 'g', name: 'G', from: 'M' }] }), rebellion: reb({}) })));
  ok(/Guild \(1\)/.test(t) && /Rebellion/.test(t), 'the panel: the Rebellion tab when risings are on; the Guild tab counts invitations', t);
  t = text(R.content(data));
  ok(!/ Guild |Rebellion/.test(t), 'the panel from an older server (no band, no rebellion): neither tab', t);

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e.stack || e.message)); process.exit(1); });
