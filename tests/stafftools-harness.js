// /event and /chars (stafftools.js), against a fake mp: who may announce, what every player sees, the cooldowns, the audit
// line, the Discord post (captured, never sent) and its switch; the gamemode.js loader and config block.
//   node tests/stafftools-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MOD = path.join(ROOT, 'stafftools.js');
let failures = 0, checks = 0;
const check = (name, ok, got) => { checks++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };

const HOST_ROLE = '1550000000000000001';
const store = new Map();
const actor = (id, o) => { store.set(id, Object.assign({ online: true, roles: [], tier: null }, o)); return id; };
const A = {
  gm: actor(1, { name: 'Gemma', tag: 'GMGM', profile: 1, tier: 'gm' }),
  trial: actor(2, { name: 'Trina', tag: 'TRIA', profile: 2, tier: 'trialgm' }),
  host: actor(3, { name: 'Hosta', tag: 'HOST', profile: 3, roles: [HOST_ROLE] }),
  bob: actor(4, { name: 'Bob', tag: '8KWH', profile: 4 }),
  bobAlt: actor(5, { name: 'Bobette', tag: 'BOB2', profile: 4, online: false }),
  lead: actor(6, { name: 'Leda', tag: 'LEAD', profile: 5, tier: 'leadgm' }),
};
const said = []; const audits = []; const logs = []; const posts = [];
let clock = 1000000;
const commands = new Map();
const mp = { getActorsByProfileId: (pid) => [...store].filter(([, o]) => o.profile === pid).map(([id]) => id) };
const load = (cfg, extra) => {
  commands.clear(); delete require.cache[MOD];
  return require(MOD)(Object.assign({
    mp, cfg,
    log: (...a) => logs.push(a.join(' ')),
    personal: (a, t) => said.push({ a, kind: 'chat', t }),
    system: (a, t) => said.push({ a, kind: 'screen', t }),
    audit: (t) => audits.push(t),
    who: (a) => `${store.get(a).name} (profile ${store.get(a).profile})`,
    tagOf: (a) => store.get(a).tag, profileOf: (a) => store.get(a).profile,
    onlineActors: () => [...store].filter(([, o]) => o.online).map(([id]) => id),
    registerChatCommand: (n, fn, opts) => commands.set(n, { fn, opts: opts || {} }),
    isAdmin: (a) => ['gm', 'leadgm', 'developer', 'senior'].includes(store.get(a).tier),
    staffTier: (a) => store.get(a).tier, rolesOf: (a) => store.get(a).roles,
    realNameOf: (a) => store.get(a).name, userOf: (a) => (store.get(a).online ? a : -1),
    findByName: (q) => { const m = /^#(\w{4})$/.exec(q); const hit = [...store].find(([, o]) => o.online && m && o.tag.toLowerCase() === m[1].toLowerCase()); return hit ? hit[0] : 0; },
    offlineByTag: (q) => { const hit = [...store].filter(([, o]) => !o.online && o.tag.toLowerCase() === q.slice(1).toLowerCase()); return hit.length === 1 ? hit[0][0] : 0; },
    sendJson: (method, url, body, headers) => { posts.push({ method, url, body, headers }); return Promise.resolve('{}'); },
    token: 'test-token', now: () => clock,
  }, extra || {}));
};
const reset = () => { said.length = 0; audits.length = 0; posts.length = 0; logs.length = 0; globalThis.__dboEventsRun = undefined; };
const run = (a, args) => commands.get('event').fn(a, args);
const toMe = (a) => said.filter((x) => x.a === a).map((x) => x.t);

// ---- registration -------------------------------------------------------------------------------------------------------
load({});
check('registers /event, not admin-flagged (role hosts pass the chat gate) and hidden from player /help', commands.has('event') && !commands.get('event').opts.admin && commands.get('event').opts.hidden);
check('registers /chars, admin-flagged', commands.has('chars') && commands.get('chars').opts.admin === true);

// ---- who may announce ----------------------------------------------------------------------------------------------------
reset(); load({ events: { hostRoleIds: [HOST_ROLE] } });
run(A.bob, 'Free mead at the Jerall View!');
check('a player without staff or the host role is refused, and nobody is told anything', toMe(A.bob).length === 1 && /Only staff and event hosts/.test(toMe(A.bob)[0]) && said.length === 1 && !audits.length);
run(A.trial, 'A tournament at Bruma Castle, at dusk');
const line = 'Event: A tournament at Bruma Castle, at dusk (hosted by Trina)';
const online = [...store].filter(([, o]) => o.online).map(([id]) => id);
// One [[S]] line a player is both the on-screen overlay and the chat line: the client reads only the last line of a tick
check('a Trial GM announces: every online player gets it on screen (and so in chat) as one line, nothing after it', online.every((o) => said.filter((x) => x.a === o && x.t === line).length === 1 && said.some((x) => x.a === o && x.kind === 'screen' && x.t === line)), said);
check('...an offline character is not written to', !said.some((x) => x.a === A.bobAlt));
check('...with one audit line naming the host', audits.length === 1 && /^EVENT Trina \(profile 2\) to 5 online: A tournament at Bruma Castle, at dusk$/.test(audits[0]), audits);
check('...and no Discord post while discord is off', posts.length === 0);
reset(); load({ events: { hostRoleIds: [HOST_ROLE] } });
run(A.host, 'Hunt the Bruma wolves at the north gate');
check('a holder of a hostRoleIds role announces, marked as such in the audit', said.some((x) => x.a === A.bob && /Hunt the Bruma wolves/.test(x.t)) && /\(event host role\)/.test(audits[0] || ''), audits);
reset(); load({});
run(A.host, 'Hunt the Bruma wolves at the north gate');
check('...and without hostRoleIds configured that role is refused', /Only staff and event hosts/.test(toMe(A.host)[0] || '') && !audits.length);
reset(); load({ events: { hostRoleIds: ['not-an-id', 12] } });
run(A.host, 'Hunt the Bruma wolves at the north gate');
check('malformed hostRoleIds grant nothing', /Only staff and event hosts/.test(toMe(A.host)[0] || ''));

// ---- text ----------------------------------------------------------------------------------------------------------------
reset(); load({});
run(A.gm, '');
check('no text: the usage, nothing sent', toMe(A.gm).length === 1 && /Usage: \/event/.test(toMe(A.gm)[0]) && !audits.length);
run(A.gm, 'hi');
check('too short is refused', /at least 5/.test(toMe(A.gm).pop()) && !audits.length);
run(A.gm, 'x'.repeat(301));
check('too long is refused', /At most 300/.test(toMe(A.gm).pop()) && !audits.length);
reset();
run(A.gm, 'Duel  at\nthe [[S]]gate #{ff0000}now\u2028please');
const sent = said.find((x) => x.a === A.bob && x.kind === 'screen');
check('control characters, line breaks, chat markup and colour codes are broken up', sent && !/[\n\u2028]/.test(sent.t) && !sent.t.includes('[[S]]') && !sent.t.includes('#{') && /Duel at the/.test(sent.t), sent);
check('...and the audit line is one line', audits.length === 1 && !/\n/.test(audits[0]));

// ---- cooldowns -----------------------------------------------------------------------------------------------------------
reset(); load({});
run(A.gm, 'The first event of the night');
const n = said.length;
run(A.gm, 'A second one at once');
check('the same host again at once is refused with the wait in seconds', said.length === n + 1 && /You announced an event a moment ago\. Try again in 300 s/.test(toMe(A.gm).pop()) && audits.length === 1);
run(A.lead, 'Another host at once');
check('another host within globalCooldownSeconds is refused', /An event was announced a moment ago\. Try again in 60 s/.test(toMe(A.lead).pop()) && audits.length === 1);
clock += 61000;
run(A.lead, 'Another host a minute later');
check('...and passes once it has run out', audits.length === 2);
clock += 240000;
run(A.gm, 'The first host five minutes later');
check('the first host passes after cooldownSeconds', audits.length === 3);
load({});
run(A.gm, 'Right after a hot reload');
check('the cooldown survives a hot reload (globalThis)', audits.length === 3 && /Try again/.test(toMe(A.gm).pop()));
reset(); load({ events: { cooldownSeconds: 0, globalCooldownSeconds: 0 } });
run(A.gm, 'One event'); run(A.gm, 'Two events');
check('cooldowns of 0 let it through', audits.length === 2);

// ---- the switch -----------------------------------------------------------------------------------------------------------
reset(); load({ events: { enabled: false } });
run(A.gm, 'An event while switched off');
check('enabled false: refused, nothing sent', /off right now/.test(toMe(A.gm)[0]) && said.length === 1 && !audits.length);

// ---- Discord -------------------------------------------------------------------------------------------------------------
reset(); load({ events: { discord: true, discordChannelId: '1549181668516954174' } });
run(A.gm, 'Archery at the *Jerall* gate <@&123> @everyone');
check('discord on: one POST to the channel with the bot token', posts.length === 1 && posts[0].method === 'POST' && posts[0].url === 'https://discord.com/api/v10/channels/1549181668516954174/messages' && posts[0].headers.Authorization === 'Bot test-token', posts);
const body = posts[0] && posts[0].body;
check('...mentions off, markdown and mentions shown as typed', body && JSON.stringify(body.allowed_mentions) === JSON.stringify({ parse: [], roles: [] }) && body.content.includes('\\*Jerall\\*') && body.content.includes('\\<\\@&123>'), body);
check('...naming the host, and the audit says Discord too', body && /^\*\*Event\*\* hosted by Gemma\n/.test(body.content) && /and Discord:/.test(audits[0]), { body, audits });
reset(); load({ events: { discord: true, discordChannelId: '1549181668516954174', discordPingRoleId: '1550000000000000099', showHost: false } });
run(A.gm, 'A ping for the event role');
check('a ping role is pinged and allowed, showHost false names nobody', posts[0].body.content.startsWith('<@&1550000000000000099> **Event**\n') && JSON.stringify(posts[0].body.allowed_mentions.roles) === '["1550000000000000099"]'
  && said.some((x) => x.a === A.bob && x.t === 'Event: A ping for the event role'), posts[0].body);
for (const [label, cfg, extra] of [['no channel id', { discord: true }, {}], ['a malformed channel id', { discord: true, discordChannelId: '../x' }, {}], ['no token', { discord: true, discordChannelId: '1549181668516954174' }, { token: '' }]]) {
  reset(); load({ events: cfg }, extra);
  run(A.gm, 'An event with Discord half set up');
  check(`discord with ${label}: no post, the game announcement still goes`, posts.length === 0 && audits.length === 1 && said.some((x) => x.a === A.bob));
}
reset(); load({ events: { discord: true, discordChannelId: '1549181668516954174' } }, { sendJson: () => Promise.reject(new Error('HTTP 403')) });
run(A.gm, 'A post that Discord refuses');
setImmediate(() => {
  check('a refused post is logged, the announcement already went', logs.some((l) => /events: Discord post failed HTTP 403/.test(l)) && said.some((x) => x.a === A.bob));

  // ---- /chars ------------------------------------------------------------------------------------------------------------
  reset(); load({});
  const chars = (a, q) => { said.length = 0; commands.get('chars').fn(a, q); return toMe(a); };
  let out = chars(A.gm, '#8kwh');
  check('/chars #TAG of an online character lists the account, online first, each with its tag', out[0] === '2 characters on that account:' && out[1] === 'Bob #8KWH (online)' && out[2] === 'Bobette #BOB2' && /\/rename #TAG/.test(out[3]), out);
  out = chars(A.gm, '#BOB2');
  check('/chars #TAG of an offline character finds the same account', out[0] === '2 characters on that account:' && out.includes('Bobette #BOB2'), out);
  check('/chars without a #TAG gives the usage', /Usage: \/chars #TAG/.test(chars(A.gm, 'Bob')[0]) && /Usage/.test(chars(A.gm, '')[0]));
  check('/chars #ZZZZ: nobody carries it', /No character carries #ZZZZ/.test(chars(A.gm, '#zzzz')[0]));
  globalThis.__dboFormGone = (id) => id === A.bobAlt;
  check('a deleted character is left out', chars(A.gm, '#8KWH')[0] === '1 character on that account:');
  globalThis.__dboFormGone = undefined;

  // ---- gamemode.js wiring and the config block -----------------------------------------------------------------------------
  const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  const loader = src.slice(src.indexOf("const STAFFTOOLS_JS = path.resolve('stafftools.js');") - 10, src.indexOf("stafftools.js failed to load:") + 60);
  const announce = src.slice(src.indexOf("const ANNOUNCE_PATH = path.resolve('announce.json');"), src.indexOf("registerChatCommand('announce'") + 400);
  check('/announce and announce.json send each player one [[S]] line and no personal() after it (the on-screen overlay)', /system\(o, text\)/.test(announce) && !/personal\(o, text\)/.test(announce), announce.slice(0, 120));
  check('gamemode.js loads stafftools.js by path.resolve with the cache cleared, in a try/catch', /delete require\.cache\[STAFFTOOLS_JS\]/.test(loader) && /catch \(e\) \{ log\('stafftools\.js failed to load:'/.test(loader));
  check('...after gmcall.js, before console.js (which publishes /chars on the allowlist)', src.indexOf("path.resolve('gmcall.js')") < src.indexOf("path.resolve('stafftools.js')") && src.indexOf("path.resolve('stafftools.js')") < src.indexOf("path.resolve('console.js')"));
  check('...passing the token the gm-call mirror uses, never printing it', /token: \(cfg\.discord \|\| \{\}\)\.botToken \|\| \(serverSettings\.discordAuth \|\| \{\}\)\.botToken/.test(loader) && !/log\([^)]*token/.test(fs.readFileSync(MOD, 'utf8')));
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
  const ev = cfg.events || {};
  check('gamemode-config.json has an events block with a comment, on, Discord off by default', typeof ev._comment === 'string' && ev.enabled === true && ev.discord === false && Array.isArray(ev.hostRoleIds), ev);
  const m = fs.readFileSync(MOD, 'utf8');
  check('stafftools.js registers no mp.on listener and no timer (nothing stacks on a hot reload)', !/mp\.on\(|setInterval|every\(/.test(m));
  check('stafftools.js is pure ASCII', !/[^\x00-\x7f]/.test(m));

  console.log('');
  console.log(failures ? `${failures} FAILED of ${checks}` : `all ${checks} checks passed`);
  process.exit(failures ? 1 : 0);
});
