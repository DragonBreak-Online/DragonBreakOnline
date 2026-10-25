// /hunt setrank and /hunt reset (Nat, 25 Oct: to test the Behemoth, the Elder's form, on the dev server) against the real
// greathunt.js with a mock gamemode api: lead staff only, an online werewolf only, a rank by name, prefix or number,
// renown set to its threshold through the module's own save, __dboHuntRank (what beastform.js asks for the Behemoth)
// follows, every use audited with its reason; reset through __dboHuntReset; a player's own /hunt unchanged.
//   node tests/greathunt-setrank-harness.js   (from server/)
'use strict';
const path = require('path');
const HUNT = path.resolve(__dirname, '..', 'greathunt.js');
const WOLF = 0xff000010, LEAD = 0xff000020, GM = 0xff000021, HUMAN = 0xff000014;
const props = new Map();
const get = (id, p) => props.get(id + '|' + p);
const set = (id, p, v) => props.set(id + '|' + p, v);
const kinds = { [WOLF]: 'werewolf', [LEAD]: 'werewolf' };
globalThis.__dboSuperKind = (a) => kinds[a] || null;
const names = { nat: LEAD, wolfy: WOLF, plain: HUMAN, gm: GM };
const said = [], audits = [], commands = new Map();
const api = {
  mp: { get, set, getIdFromDesc: () => 0 }, log: () => {}, personal: (a, t) => said.push({ a, t }), audit: (t) => audits.push(t),
  who: (a) => `P${a.toString(16)}`, sendPacket: () => {}, onlineActors: () => [WOLF, LEAD, GM, HUMAN], profileOf: () => 1,
  registerChatCommand: (n, fn) => commands.set(n, fn), zoneOfActor: () => 'bruma', zoneById: () => null, isWorldspace: () => true, cfg: {},
  isLeadStaff: (a) => a === LEAD, findByName: (q) => names[String(q).toLowerCase()] || 0,
};
delete globalThis.__dboGreatHunt;
delete require.cache[HUNT];
globalThis.__dboRegisterStatus = () => {};
require(HUNT)(api);

let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!ok) failures++; };
const hunt = (a, line) => { said.length = 0; commands.get('hunt')(a, line); return said.map((x) => x.t).join(' | '); };
const renown = (a) => (get(a, 'private.greatHunt') || {}).renown || 0;
const rank = (a) => globalThis.__dboHuntRank(a).name;

let out = hunt(GM, 'setrank wolfy Elder testing');
check('a GM below lead staff is refused, and nothing changes', /Only lead staff/.test(out) && renown(WOLF) === 0 && audits.length === 0, out);
out = hunt(WOLF, 'setrank me Elder testing');
check('so is a player, even on themselves', /Only lead staff/.test(out) && renown(WOLF) === 0, out);
out = hunt(LEAD, 'setrank plain Elder testing');
check('a non-werewolf is refused: no rank for them', /no werewolf/.test(out) && !get(HUMAN, 'private.greatHunt') && audits.length === 0, out);
out = hunt(LEAD, 'setrank nobody Elder testing');
check('someone not online: told, with the usage', /No one online is called nobody/.test(out), out);
out = hunt(LEAD, 'setrank wolfy Elder');
check('no reason: the usage, nothing changes', /Usage: \/hunt setrank/.test(out) && renown(WOLF) === 0, out);
out = hunt(LEAD, 'setrank wolfy Chieftain testing');
check('a rank that does not exist: the usage lists the five', /0 Fledgling, 1 Prowler, 2 Hunter, 3 Blood-Howler, 4 Elder/.test(out) && renown(WOLF) === 0, out);

out = hunt(LEAD, 'setrank wolfy Elder Behemoth test on dev');
check('lead staff set an online werewolf to Elder: renown 1500, the threshold', renown(WOLF) === 1500 && rank(WOLF) === 'Elder' && globalThis.__dboHuntRank(WOLF).top === true, out);
check('...audited: HUNT <staff> set <who> to <rank>: <reason>', audits[audits.length - 1] === 'HUNT Pff000020 set Pff000010 to Elder: Behemoth test on dev', audits);
check('...both are told', said.some((x) => x.a === LEAD && /now an Elder of the Hunt \(1500 renown\)/.test(x.t)) && said.some((x) => x.a === WOLF && /You are now an Elder/.test(x.t)), said);
hunt(LEAD, 'setrank wolfy 2 back down');
check('a rank by number: 2 is Hunter, 300 renown', renown(WOLF) === 300 && rank(WOLF) === 'Hunter');
hunt(LEAD, 'setrank wolfy blood again');
check('a rank by an unambiguous prefix: blood is Blood-Howler, 700', renown(WOLF) === 700 && rank(WOLF) === 'Blood-Howler');
hunt(LEAD, 'SETRANK me elder self test');
check('lead staff on themselves with me, any case: Elder', renown(LEAD) === 1500 && rank(LEAD) === 'Elder' && /set Pff000020 to Elder: self test$/.test(audits[audits.length - 1]));
const fed = get(WOLF, 'private.greatHunt');
fed.fedOn = { 7: 123 }; set(WOLF, 'private.greatHunt', fed);
hunt(LEAD, 'setrank wolfy Elder keep the rest');
check('setrank keeps the rest of the hunt state (the feeding record)', get(WOLF, 'private.greatHunt').fedOn[7] === 123 && renown(WOLF) === 1500);

out = hunt(LEAD, 'reset wolfy');
check('reset with no reason: the usage, nothing changes', /Usage: \/hunt reset/.test(out) && renown(WOLF) === 1500, out);
out = hunt(GM, 'reset wolfy testing');
check('reset by a GM below lead staff: refused', /Only lead staff/.test(out) && renown(WOLF) === 1500);
out = hunt(LEAD, 'reset wolfy done testing');
check('reset: back to Fledgling with no renown (__dboHuntReset), audited with the reason', renown(WOLF) === 0 && rank(WOLF) === 'Fledgling' && audits[audits.length - 1] === 'HUNT Pff000020 reset Pff000010 to Fledgling: done testing', audits);

out = hunt(WOLF, '');
check('a werewolf\'s own /hunt is as before', /You are a Fledgling of the Hunt, with 0 renown/.test(out), out);
out = hunt(HUMAN, '');
check('...and a mortal\'s', /The Great Hunt is for those who carry the beast/.test(out), out);
hunt(LEAD, ['setrank', 'wolfy', 'Elder', 'array', 'args']);
check('the arguments as an array work as a line does', renown(WOLF) === 1500 && /: array args$/.test(audits[audits.length - 1]));

// The player log (playerlog-rules.js): the staff's reason is cut, the one set is the target
const R = require(path.resolve(__dirname, '..', 'playerlog-rules.js'));
const line = 'HUNT Nat Pierce #AB12 (profile 3, <@123456789>) set Wolfy Grey #CD34 (profile 7) to Elder: secret "staff" note about why';
const pa = R.parseAudit(line);
check('player log: HUNT setrank is clean, the reason gone, Nat the actor and Wolfy the target', pa.cls === 'clean' && pa.events.length === 1
  && pa.events[0].f.text === 'Nat Pierce #AB12 set Wolfy Grey #CD34 to Elder' && pa.roles.join() === 'actor,target', pa);
const pr = R.parseAudit('HUNT Nat Pierce #AB12 (profile 3) reset Wolfy Grey #CD34 (profile 7) to Fledgling: done testing');
check('...and reset the same', pr.events[0].f.text === 'Nat Pierce #AB12 reset Wolfy Grey #CD34 to Fledgling' && pr.roles.join() === 'actor,target', pr);
const old = R.parseAudit('HUNT Wolfy Grey #CD34 (profile 7) rose to Hunter (300 renown, feed: an animal)');
check('...a rank-up line is untouched by the cut', /rose to Hunter \(300 renown, feed: an animal\)/.test(old.events[0].f.text), old);

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
