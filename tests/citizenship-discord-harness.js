// Citizen roles on Discord (citizenship.js + discordroles.js, Nate 14 Oct): each hold a character is a citizen of gives the
// role whose id config citizenship.discordRoles names (made by hand; never created by code); losing the citizenship takes it
// off; a configured id the guild does not have is ignored; other roles are untouched. Real discordroles.js, a fake guild
// (the one tests/discordroles-harness.js uses), the citizenship hooks stubbed.
//
//   node tests/citizenship-discord-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');

const MODULE = path.resolve(__dirname, '..', 'discordroles.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-citizenroles-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

// ---- a fake guild --------------------------------------------------------------------------------
let nextId = 900;
const roles = [ // position order like the real one, highest first
  ['Owners', 35], ['Citizen of Bruma', 30], ['Citizen of Whiterun', 29], ['------', 21], ['---SKILLS---', 20], ['Two-Handed', 19], ['Archery', 18], ['One-Handed', 17], ['Blacksmith', 14], ['Miner', 11], ['Harvesting', 3], ['@everyone', 0],
].map(([name, position]) => ({ id: String(nextId++), name, position }))
  .sort((x, y) => x.position - y.position).map((r, i) => Object.assign(r, { position: i }));
const members = { '111111111111111111': { roles: [roles.find((r) => r.name === 'Owners').id, roles.find((r) => r.name === 'Harvesting').id] } };
const calls = [];
const byName = (n) => roles.find((r) => r.name === n);
let forceMember = null;   // { status, body } answers GET /members/<id> instead of the guild
https.request = (opts, cb) => {
  const req = new EventEmitter();
  req.setTimeout = () => req;
  req.end = (data) => {
    const body = data ? JSON.parse(data) : null;
    const route = opts.path.replace('/api/v10/guilds/G', '');
    calls.push(`${opts.method} ${route}`);
    let status = 200, out = null, m;
    if (opts.method === 'GET' && route === '/roles') out = roles;
    else if (opts.method === 'POST' && route === '/roles') { const r = { id: String(nextId++), name: body.name, position: 1 }; roles.forEach((x) => { if (x.position >= 1 && x.name !== '@everyone') x.position++; }); roles.push(r); out = r; }
    else if (opts.method === 'PATCH' && route === '/roles') {
      // Discord's reorder: the role takes the position given and the rest close up around it
      for (const { id, position } of body) {
        const r = roles.find((x) => x.id === id);
        const order = roles.filter((x) => x !== r).sort((x, y) => x.position - y.position);
        order.splice(position, 0, r);
        order.forEach((x, i) => { x.position = i; });
      }
      out = roles;
    }
    else if (opts.method === 'PATCH' && (m = route.match(/^\/roles\/(\d+)$/))) { roles.find((x) => x.id === m[1]).name = body.name; out = {}; }
    else if (opts.method === 'GET' && (m = route.match(/^\/members\/(\d+)$/)) && forceMember) { status = forceMember.status; out = forceMember.body; }
    else if (opts.method === 'GET' && (m = route.match(/^\/members\/(\d+)$/))) { if (members[m[1]]) out = members[m[1]]; else { status = 404; out = { message: 'Unknown Member', code: 10007 }; } }
    else if ((m = route.match(/^\/members\/(\d+)\/roles\/(\d+)$/))) {
      const mem = members[m[1]]; status = 204;
      if (opts.method === 'PUT' && !mem.roles.includes(m[2])) mem.roles.push(m[2]);
      if (opts.method === 'DELETE') mem.roles = mem.roles.filter((x) => x !== m[2]);
    } else status = 400;
    const res = new EventEmitter(); res.statusCode = status;
    setImmediate(() => { cb(res); if (out !== null) res.emit('data', JSON.stringify(out)); res.emit('end'); });
  };
  return req;
};


fs.writeFileSync('housing.json', '[]');
const PLAYER = 1;
const BRUMA = byName('Citizen of Bruma').id, WHITERUN = byName('Citizen of Whiterun').id;
let holds = ['bruma'];
const ids = { bruma: BRUMA, whiterun: WHITERUN, riften: '1999999999999999999' };
globalThis.__dboCitizenRoleIds = () => holds.map((h) => ids[h]);
globalThis.__dboCitizenManagedRoleIds = () => Object.values(ids);
const mod = require(MODULE)({
  mp: { get: () => undefined }, log: () => {}, audit: () => {}, who: (a) => `#${a}`, onlineActors: () => [PLAYER], every: () => {},
  discordOf: () => '111111111111111111', profileOf: () => 10, zoneById: () => null, cfg: {}, skills: [], token: 'T', guildId: 'G',
});
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const has = (id) => members['111111111111111111'].roles.includes(id);
(async () => {
  await mod.setup();
  const made = calls.filter((c) => c === 'POST /roles').length;
  await mod.sync(PLAYER);
  ok(has(BRUMA) && !has(WHITERUN), 'a Bruma citizen gets the Citizen of Bruma role');
  ok(calls.filter((c) => c === 'POST /roles').length === made, 'no role is created for citizens');
  holds = ['bruma', 'whiterun'];
  await mod.sync(PLAYER);
  ok(has(BRUMA) && has(WHITERUN), 'Primary and Secondary both give their role');
  holds = ['whiterun'];
  await mod.sync(PLAYER);
  ok(!has(BRUMA) && has(WHITERUN), 'a renounced citizenship takes its role off');
  holds = ['riften'];
  await mod.sync(PLAYER);
  ok(!has(WHITERUN) && !calls.some((c) => c.includes('1999999999999999999')), 'an id the guild does not have is never sent', calls.slice(-4));
  ok(has(byName('Owners').id) && has(byName('Harvesting').id), 'roles outside the managed groups are untouched');
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
