// /testmenu (scaleformtest.js) is the one staff command for the Scaleform test panels and the one-shot client probes.
// On 31 Oct gamemode.js registered a second /testmenu (itemcard, mapmenu, hud); scaleformtest.js loads later, so its
// command replaced the other and /testmenu itemcard or hud opened the plain test panel instead of arming a probe. This
// loads scaleformtest.js on a stub, checks each sub-command's packet and each probe's answer handler, and that nothing
// else registers the command.
//   node tests/testmenu-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!c) fails++; };

const cmds = new Map(), ui = new Map(), packets = [], told = [], logs = [];
require(path.join(ROOT, 'scaleformtest.js'))({
  log: (m) => logs.push(m), personal: (a, t) => told.push(t), sendPacket: (a, p) => { packets.push(p); return true; }, who: (a) => `#${a}`,
  isAdmin: () => true, registerChatCommand: (n, fn) => cmds.set(n, fn), onUi: (ev, fn) => ui.set(ev, (ui.get(ev) || []).concat([fn])),
});
const run = (sub) => { packets.length = 0; told.length = 0; cmds.get('testmenu')(1, sub); return packets[0] || {}; };
ok(cmds.has('testmenu'), 'scaleformtest.js registers /testmenu');
ok(run('itemcard').customPacketType === 'dboItemCardTest' && /highlight an armour piece/.test(told[0]), 'itemcard arms the item card probe');
ok(run('hud').customPacketType === 'dboHudTest' && /^HUD test armed/.test(told[0]), 'hud arms the HUD overlay probe');
ok(run('mapmenu').customPacketType === 'dboMapTest', 'mapmenu arms the M map tests');
const fps = run('fps');
ok(fps.customPacketType === 'dboScaleform' && fps.swf === 'dbo_fpsprobe' && fps.payload && fps.payload.frames > 0, 'fps opens the frame probe');
ok(run('ui').swf === 'dbo_uiprobe' && run('').swf === 'dbo_testmenu', 'ui and the plain panel are as before');
for (const ev of ['itemCardTest', 'hudTest', 'fpsProbe', 'mapTest', 'uiProbe']) {
  const h = ui.get(ev) || [];
  told.length = 0; logs.length = 0;
  if (h.length) h[0](1, [{ end: 'done', x: 1 }]);
  ok(h.length === 1 && logs.length === 1 && told.length === 1, `${ev}: one answer handler, logged and told`, h.length);
}
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(!/registerChatCommand\('testmenu'/.test(gm), 'gamemode.js does not register /testmenu (one command, one place)');
ok(!/onUi\('(itemCardTest|hudTest|mapTest)'/.test(gm), '...nor answer the probes a second time');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
