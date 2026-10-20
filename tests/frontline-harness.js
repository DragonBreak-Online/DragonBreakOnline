// Staff-run frontline wars (frontline.js, 20 Oct): declaring, staff confirming, voluntary enlisting with its limits, the
// line moving a stage per recorded battle, the defender choosing the field, the Final Stand, yielding, surrender, the
// soldiers' record from downed.js and the panel's nonce. Loads the real frontline.js against stubs in a temp directory.
//
//   node tests/frontline-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'frontline-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let failures = 0;
const check = (label, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

// ---- the world: factions, leaders, members, land ----------------------------------------------------------------------
const FACTIONS = {
  'county-bruma': { id: 'county-bruma', name: 'County Bruma', kind: 'hold' },
  'hold-whiterun': { id: 'hold-whiterun', name: 'Whiterun Hold', kind: 'hold' },
  'imperial-legion': { id: 'imperial-legion', name: 'Imperial Legion', kind: 'guild' },
  'stormcloaks': { id: 'stormcloaks', name: 'Stormcloaks', kind: 'guild' },
  'synod': { id: 'synod', name: 'Synod', kind: 'guild' },
  'cult-namira': { id: 'cult-namira', name: 'Cult of Namira', kind: 'cult', secret: true },
};
const LEADS = { 1: ['county-bruma'], 2: ['hold-whiterun'], 7: ['imperial-legion'] };
const MEMBER = { 1: ['county-bruma'], 2: ['hold-whiterun'], 3: ['county-bruma'], 4: ['hold-whiterun'], 7: ['imperial-legion'] };
const PROFILE = { 1: 101, 2: 102, 3: 103, 4: 104, 5: 105, 6: 105, 7: 107, 9: 109 };
const ADMIN = new Set([9]);
const LAND = { 'county-bruma': ['bruma', 'pale-pass'], 'hold-whiterun': ['whiterun', 'riverwood'] };
globalThis.__dboGuildInfo = (id) => FACTIONS[id] || null;
globalThis.__dboRealmLeads = (a, fid) => (LEADS[a] || []).includes(fid);
globalThis.__dboRealmMemberOf = (a, fid) => (MEMBER[a] || []).includes(fid);
globalThis.__dboRealmFactionsLedBy = (a) => LEADS[a] || [];
globalThis.__dboRealmTerritoriesOf = (fid) => LAND[fid] || [];
globalThis.__dboRealmTerritoryName = (tid) => ({ bruma: 'Bruma', 'pale-pass': 'Pale Pass', whiterun: 'Whiterun', riverwood: 'Riverwood' })[tid] || tid;
globalThis.__dboRealmSeatOf = (fid) => ({ 'county-bruma': { name: 'Castle Bruma' }, 'hold-whiterun': { name: 'Dragonsreach' } })[fid] || null;
globalThis.__dboFactionList = () => Object.values(FACTIONS).filter((f) => !f.secret).map((f) => f.id);

// ---- the api ----------------------------------------------------------------------------------------------------------
const told = [], said = [], banners = [], widgets = [], audits = [], posts = [];
const ui = new Map(); const cmds = new Map();
let online = [1, 2, 3, 4, 5, 7, 9];
let clock = Date.UTC(2026, 9, 20, 12, 0);
const api = {
  mp: {}, log: () => {}, cfg: { frontline: { enabled: true, discord: true, discordChannelId: '123456789012345678' } },
  personal: (a, t) => told.push([a, t]), system: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => `char${a}`,
  display: (a) => `Char${a} #T${a}`, realNameOf: (a) => `Char${a}`, tagOf: (a) => `T${a}`, profileOf: (a) => PROFILE[a] ?? -1,
  onUi: (ev, f) => ui.set(ev, f), openWidget: (a, w) => widgets.push([a, w]), closeWidget: () => {},
  sendPacket: (a, p) => { if (p.customPacketType === 'dboBanner') banners.push([a, p.text]); },
  registerChatCommand: (n, f, o) => cmds.set(n, { f, o }), isAdmin: (a) => ADMIN.has(a), onlineActors: () => online,
  sendJson: (m, url, body) => { posts.push(body.content); return Promise.resolve(); }, token: 'x', now: () => clock,
};
const load = () => { const p = path.join(SERVER, 'frontline.js'); delete require.cache[p]; return require(p)(api); };
let F = load();
const lastTold = (a) => { for (let i = told.length - 1; i >= 0; i--) if (told[i][0] === a) return told[i][1]; return ''; };
const run = (a, line) => { cmds.get('front').f(a, line); return lastTold(a); };
const war = () => F.data().wars[F.data().wars.length - 1];

check('/front is a player command (not admin)', cmds.has('front') && !cmds.get('front').o.admin);
check('three stages by default', F.STAGES === 3);

// ---- declaring ----------------------------------------------------------------------------------------------------------
check('a member who does not lead cannot declare', /Only a faction's leader/.test(run(3, 'declare hold-whiterun')));
check('a secret faction cannot be declared on', /not a faction you can declare on/.test(run(1, 'declare cult-namira')));
check('a guild not on the list cannot be declared on', /not a faction you can declare on/.test(run(1, 'declare synod')));
check('the Count of Bruma declares on Whiterun', /staff will confirm/.test(run(1, 'declare hold-whiterun Border raids on Pale Pass')));
check('it waits for the staff', war().status === 'proposed' && war().a === 'county-bruma' && war().d === 'hold-whiterun' && war().reason === 'Border raids on Pale Pass', war());
check('staff and the defending leader are told', /declares war/.test(lastTold(9)) && /declared war/.test(lastTold(2)));
check('the same pair cannot declare twice', /already at war/.test(run(1, 'declare hold-whiterun')));
check('a faction already in a war is not declared on by a third', /already at war/.test(run(7, 'declare hold-whiterun')));
check('a player cannot confirm', /Only staff/.test(run(1, `confirm ${war().id}`)));
const W = war().id;

// ---- enlisting --------------------------------------------------------------------------------------------------------
check('a civilian may enlist before the war starts', /enlisted to fight for County Bruma/.test(run(5, `enlist ${W} county-bruma`)));
check('the same account cannot fight on the other side', /other side/.test(run(6, `enlist ${W} defender`)));
check('a Whiterun member cannot enlist against Whiterun', /cannot fight against it/.test(run(4, `enlist ${W} county-bruma`)));
check('a Whiterun member enlists for Whiterun', /fight for Whiterun Hold/.test(run(4, `enlist ${W} hold-whiterun`)));
check('a Bruma guard enlists for Bruma', /fight for County Bruma/.test(run(3, `enlist ${W} attacker`)));
check('nobody is enlisted twice', /already enlisted/.test(run(3, `enlist ${W} attacker`)));
check('the leader is told who enlisted', told.some(([a, t]) => a === 1 && /Char3 has enlisted/.test(t)));
check('leaving and enlisting again works', /no longer enlisted/.test(run(5, `leave ${W}`)) && /enlisted/.test(run(5, `enlist ${W} county-bruma`)));

// ---- confirming --------------------------------------------------------------------------------------------------------
banners.length = 0; posts.length = 0;
check('staff confirm at stage 0 from Pale Pass', /has begun/.test(run(9, `confirm ${W} 0 Pale Pass`)));
check('everyone online sees the war begin', banners.length === online.length && /War: County Bruma against Whiterun Hold/.test(banners[0][1]));
check('and it goes to Discord', posts.length === 1 && /\*\*War\*\*/.test(posts[0]));
check('the line starts at 0 from Pale Pass', war().status === 'active' && war().line === 0 && war().start === 'Pale Pass');

// ---- the field and the battle ---------------------------------------------------------------------------------------------
check('at stage 0 the attacker cannot choose the field', /Whiterun Hold chooses/.test(F.choosePlace(1, war(), 'bruma')));
check('the defender cannot pick land it does not hold', /not Whiterun Hold's/.test(F.choosePlace(2, war(), 'bruma')));
check('the defender picks Riverwood', /Riverwood/.test(F.choosePlace(2, war(), 'riverwood')) && war().next.place === 'Riverwood');
check('staff set the time', /2026-10-25 00:00 UTC/.test(run(9, `when ${W} 2026-10-25 00:00`)));
check('a bad time is refused', /YYYY-MM-DD/.test(run(9, `when ${W} tomorrow`)));
online = [1, 2, 3, 4, 7, 9];
check('staff open the battle', /battle is open/.test(run(9, `start ${W}`)) && !!war().battle);
check('nobody enlists during a battle', /being fought/.test(run(7, `enlist ${W} attacker`)));
check('nobody leaves during a battle', /Not while/.test(run(3, `leave ${W}`)));
check('the online soldiers fought in it, the offline one did not', war().stats.c3.battles === 1 && war().stats.c4.battles === 1 && !war().stats.c5);
globalThis.__dboFrontDown(4, 3); globalThis.__dboFrontFinish(4, 3);
globalThis.__dboFrontDown(3, 7);   // not enlisted: no count
globalThis.__dboFrontDown(3, 3);   // self: no count
check('a down and a final blow between enemies count', war().stats.c3.downs === 1 && war().stats.c3.finals === 1 && war().stats.c4.fell === 1, war().stats);
check('a blow from someone not enlisted counts for nobody', war().stats.c3.fell === 0);
check('a player cannot record a result', /Only staff/.test(run(1, `win ${W} attacker`)));
check('Bruma wins: one stage into Whiterun', /Recorded/.test(run(9, `win ${W} attacker hard fought`)) && war().line === 1 && !war().battle);
check('the field is chosen afresh', war().next.place === '' && war().next.when === 0);
check('with the line in Whiterun land, Whiterun picks again', /Whiterun/.test(F.choosePlace(2, war(), 'whiterun')));
globalThis.__dboFrontDown(4, 3);
check('outside a battle nothing counts', war().stats.c3.downs === 1);
run(9, `win ${W} defender`);
check('Whiterun wins: back to 0', war().line === 0);
run(9, `win ${W} defender`);
check('Whiterun wins again: one stage into Bruma land, Bruma picks the field', war().line === -1 && /Pale Pass/.test(F.choosePlace(1, war(), 'pale-pass')));
run(9, `win ${W} attacker`); run(9, `win ${W} attacker`); run(9, `win ${W} attacker`);
banners.length = 0;
const r = run(9, `win ${W} attacker`);
check('reaching stage 3 unlocks the Final Stand at Dragonsreach', /Final Stand is unlocked/.test(r) && war().status === 'final' && war().final.place === 'Dragonsreach' && war().line === 3, war());
check('everyone hears of it', /Final Stand/.test((banners[0] || [])[1]));

// ---- yielding and the Final Stand ----------------------------------------------------------------------------------------
check('a Bruma soldier cannot yield', /Only Whiterun Hold's people/.test(run(3, `yield ${W}`)));
check('a Whiterun soldier yields as a prisoner', /You yield to County Bruma/.test(run(4, `yield ${W}`)) && war().prisoners.c4 && !war().roster.c4);
check('a prisoner cannot enlist again', /yielded/.test(run(4, `enlist ${W} defender`)));
check('the Final Stand held pushes the line back one stage', /held/.test(run(9, `win ${W} defender`)) && war().status === 'active' && war().line === 2 && !war().final);
run(9, `win ${W} attacker`);
check('the Final Stand again', war().status === 'final');
online = [1, 2, 3, 4, 7, 9]; banners.length = 0;
check('Bruma wins the Final Stand and the war', /wins the war/.test(run(9, `win ${W} attacker`)) && war().status === 'ended' && war().outcome.winner === 'county-bruma' && war().outcome.how === 'final');
check('the end names the best soldier', /Most final blows: Char3/.test((banners[0] || [])[1]));
check('the prisoner is freed', told.some(([a, t]) => a === 4 && /you are free/.test(t)));

// ---- surrender, refusal, staff end -----------------------------------------------------------------------------------------
run(2, 'declare county-bruma Revenge');
const W2 = war().id;
check('staff can refuse a war', /refused/.test(run(9, `refuse ${W2} too soon`)) && war().status === 'ended' && war().outcome.how === 'refused');
run(2, 'declare county-bruma Revenge'); const W3 = war().id; run(9, `confirm ${W3} 1 Riverwood`);
check('staff may start the line off centre', war().line === 1 && war().start === 'Riverwood');
check('only a side\'s leader surrenders it', /Only a side's leader/.test(run(3, `surrender ${W3} county-bruma`)));
check('Bruma\'s Count surrenders: Whiterun wins', /surrendered/.test(run(1, `surrender ${W3} county-bruma`)) && war().outcome.winner === 'hold-whiterun' && war().outcome.how === 'surrender');
run(7, 'declare stormcloaks'); const W4 = war().id; run(9, `confirm ${W4}`);
check('the Legion may wage war on the Stormcloaks (listed by id)', war().status === 'active' && war().a === 'imperial-legion');
check('staff end it with no winner', /ended/.test(run(9, `end ${W4} none ceasefire`)) && war().outcome.winner === null);

// ---- the panel --------------------------------------------------------------------------------------------------------------
run(1, 'declare hold-whiterun Again'); const W5 = war().id; run(9, `confirm ${W5}`);
widgets.length = 0; run(5, '');
const w0 = widgets[widgets.length - 1][1];
check('the panel is contextMenu widget 157', w0.type === 'contextMenu' && w0.id === 157 && w0.events.action === 'dbo:frontChoose');
const row = w0.actions.find((x) => /against/.test(x.label));
check('it lists the war', !!row);
ui.get('frontChoose')(5, [row.id]);
const w1 = widgets[widgets.length - 1][1];
check('the war page offers enlisting for both sides', w1.actions.filter((x) => /^Enlist for/.test(x.label)).length === 2, w1.actions.map((x) => x.label));
ui.get('frontChoose')(5, ['bad-nonce|' + w1.actions[0].id.split('|')[1]]);
check('a stale nonce does nothing', !war().roster.c5);
ui.get('frontChoose')(5, [w1.actions.find((x) => x.label === 'Enlist for County Bruma').id]);
check('the button enlists', war().roster.c5 && war().roster.c5.side === 'county-bruma');
widgets.length = 0; run(9, ''); ui.get('frontChoose')(9, [widgets[widgets.length - 1][1].actions.find((x) => /against/.test(x.label)).id]);
const ws = widgets[widgets.length - 1][1];
check('staff see the battle controls', ['Staff: open the next battle', 'Staff: County Bruma won the battle', 'Staff: end the war'].every((l) => ws.actions.some((x) => x.label === l)), ws.actions.map((x) => x.label));
widgets.length = 0; run(2, ''); ui.get('frontChoose')(2, [widgets[widgets.length - 1][1].actions.find((x) => /against/.test(x.label)).id]);
const wl = widgets[widgets.length - 1][1];
check('the defending leader can choose the field and surrender', wl.actions.some((x) => x.label === 'Choose the next battlefield') && wl.actions.some((x) => /^Surrender Whiterun/.test(x.label)));
ui.get('frontChoose')(2, [wl.actions.find((x) => x.label === 'Choose the next battlefield').id]);
const wf = widgets[widgets.length - 1][1];
ui.get('frontChoose')(2, [wf.actions.find((x) => x.label === 'Riverwood').id]);
check('the field is chosen from the panel', war().next.place === 'Riverwood');
widgets.length = 0; run(3, ''); ui.get('frontChoose')(3, [widgets[widgets.length - 1][1].actions.find((x) => /against/.test(x.label)).id]);
check('an unenlisted bystander sees no roster', !widgets[widgets.length - 1][1].actions.some((x) => /roster/.test(x.label)));

// ---- persistence and switches --------------------------------------------------------------------------------------------
globalThis.__dboFrontline = undefined;
F = load();
check('the wars come back from frontline.json', F.data().wars.length === 5 && F.live().length === 1 && F.live()[0].roster.c5);
api.cfg.frontline.enabled = false; globalThis.__dboFrontline = undefined; F = load();
check('closed: nobody declares', /not open/.test(F.declare(7, 'imperial-legion', 'stormcloaks', '')));
api.cfg.frontline = { enabled: true, confirm: 'none', discord: false }; globalThis.__dboFrontline = undefined; fs.rmSync('frontline.json'); F = load();
posts.length = 0;
check('confirm none starts it at once', /is at war/.test(run(7, 'declare stormcloaks')) && war().status === 'active');
check('discord off: nothing posted', posts.length === 0);

console.log(failures ? `${failures} failure(s)` : 'all checks passed');
process.exit(failures ? 1 : 0);
