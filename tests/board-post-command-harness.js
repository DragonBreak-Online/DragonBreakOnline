// /board post <tab> <text>, the typed fallback for the native notice board: runs gamemode.js's own /board block with stubs and
// checks the tab aliases, the usage line, and that plain /board still opens the board.
//   node tests/board-post-command-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
const a = src.indexOf('const BOARD_POST_TABS');
const b = src.indexOf("}, { help: 'open the notice board you are standing at", a);
ok(a > 0 && b > a, 'gamemode.js has the /board block');
const run = () => {
  const said = [], posts = [], opens = [];
  const commands = {};
  const g = { __alduinakBountyPost: (who, tab, text) => posts.push([who, tab, text]), __alduinakBountyOpen: (who) => opens.push(who) };
  const block = src.slice(a, b) + '});';
  new Function('registerChatCommand', 'personal', 'globalThis', block)(
    (name, fn) => { commands[name] = fn; }, (who, msg) => said.push(msg), g);
  return { cmd: commands.board, said, posts, opens };
};

let t = run();
t.cmd(7, 'post shop Iron ingots, cheap.\nAsk at the forge.');
ok(t.posts.length === 1 && t.posts[0][0] === 7 && t.posts[0][1] === 'shop' && t.posts[0][2] === 'Iron ingots, cheap.\nAsk at the forge.', 'post <tab> <text> reaches the board system with the whole text', t.posts);
t.cmd(7, 'POST ad  Mead for sale  ');
ok(t.posts[1][1] === 'shop' && t.posts[1][2] === 'Mead for sale', 'ad is shop, case and spacing do not matter', t.posts[1]);
t.cmd(7, 'post notice Lost: a cat');
ok(t.posts[2][1] === 'citizen', 'notice is citizen');
t.cmd(7, 'post market hi');
t.cmd(7, 'post shop');
t.cmd(7, 'post');
ok(t.posts.length === 3 && t.said.length === 3 && t.said.every((s) => /^Usage: \/board post/.test(s)), 'an unknown tab or no text gives the usage, posts nothing', t.said);
t.cmd(7, '');
t.cmd(7, 'postbox');
ok(t.opens.length === 2 && t.posts.length === 3, 'plain /board (and a word that only starts with post) opens the board', t.opens);

t = run();
const g2 = {};
new Function('registerChatCommand', 'personal', 'globalThis', src.slice(a, b) + '});')((n, fn) => { g2.cmd = fn; }, (w, m) => t.said.push(m), {});
g2.cmd(7, 'post shop x');
ok(t.said.pop() === 'The notice boards are not in service right now.', 'without the board system it says so');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
