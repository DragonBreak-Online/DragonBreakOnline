// Scripted test for the chat's Admin tab flag (Nate, 12 Oct, 0.3.94: senior staff, the chat showed Local, System and
// Personal only). chatService.ts writes window.__alduinakAdmin into the CEF page from the owner property isAdmin and
// remembers what it wrote (lastAdmin); the front's tab row (skymp5-front chat/channels) shows the Admin tab from it.
// Checked here:
//   - a mount that finds the chat still on the page (a reconnect or character switch) still writes the flag; before
//     this it returned first, while lastAdmin recorded the value as written, so the page kept the old flag until
//     isAdmin changed again, which for a staff member never happens
//   - the flag is written again every ADMIN_RESYNC_MS, and only a change fires dbo:chatAdmin
//   - the tab row redraws on dbo:chatAdmin instead of waiting for the next chat line
// No game: the mount script is cut out of chatService.ts and run in a vm against a fake page. Run it from skymp5-client:
//
//   node tests/chat-admin-tab-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.resolve(__dirname, '..', 'src', 'services', 'services', 'chatService.ts');
const FRONT = path.resolve(__dirname, '..', '..', 'skymp5-front', 'src', 'constructorComponents', 'chat', 'channels', 'index.tsx');
const src = fs.readFileSync(SRC, 'utf8');
let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// The mount script and its helpers: from the first of them to the end of buildMountJs's template
let start = src.indexOf('const adminSyncJs');
if (start < 0) start = src.indexOf('const buildMountJs');
const end = src.indexOf('})();`;', src.indexOf('const buildMountJs')) + '})();`;'.length;
const ts = src.slice(start, end).split('(name: string, isAdmin: boolean, settingsJson: string, chatHidden: boolean)').join('(name, isAdmin, settingsJson, chatHidden)')
  .split('(isAdmin: boolean)').join('(isAdmin)');
const mod = new Function(`${ts}\nreturn { buildMountJs, adminSyncJs: typeof adminSyncJs === 'function' ? adminSyncJs : null, ADMIN_RESYNC_MS: typeof ADMIN_RESYNC_MS === 'number' ? ADMIN_RESYNC_MS : null };`)();

// A page with the chat already mounted, holding a false flag (the state the screenshot showed)
const page = () => {
  const events = [];
  const win = {
    __alduinakChatReady: true, __alduinakAdmin: false, chatMessages: [],
    skyrimPlatform: { widgets: { list: [{ type: 'chat', id: 'chat' }], get() { return this.list; }, set(l) { this.list = l; } } },
    dispatchEvent: (e) => events.push(e.type),
  };
  win.CustomEvent = function (type) { this.type = type; };
  const ctx = vm.createContext({ window: win, CustomEvent: win.CustomEvent, document: { getElementById: () => ({}), head: { appendChild() {} } } });
  return { win, events, run: (js) => vm.runInContext(js, ctx) };
};

const p = page();
p.run(mod.buildMountJs('GM Nate', true, '{}', false));
check('a mount that finds the chat still there writes the admin flag anyway', p.win.__alduinakAdmin === true, p.win.__alduinakAdmin);
check('...and tells the tab row (dbo:chatAdmin)', p.events.includes('dbo:chatAdmin'), p.events);
check('...and still does not mount a second chat', p.win.skyrimPlatform.widgets.list.length === 1);

check('there is a flag writer (adminSyncJs)', !!mod.adminSyncJs);
if (mod.adminSyncJs) {
  const q = page();
  q.run(mod.adminSyncJs(true)); q.run(mod.adminSyncJs(true));
  check('writing the same value again fires no second event', q.win.__alduinakAdmin === true && q.events.length === 1, q.events);
  q.run(mod.adminSyncJs(false));
  check('a change back to false is written and announced', q.win.__alduinakAdmin === false && q.events.length === 2, q.events);
}
check('the flag is rewritten on a timer, not only on a change', typeof mod.ADMIN_RESYNC_MS === 'number' && mod.ADMIN_RESYNC_MS > 0 && mod.ADMIN_RESYNC_MS <= 30000
  && /isAdminNow !== this\.lastAdmin \|\| nowMs - this\.lastAdminSyncAt >= ADMIN_RESYNC_MS/.test(src) && /executeJavaScript\(adminSyncJs\(isAdminNow\)\)/.test(src));

// The front: the tab row listens for the event
const front = fs.existsSync(FRONT) ? fs.readFileSync(FRONT, 'utf8') : '';
check('the tab row redraws on dbo:chatAdmin', /CHAT_ADMIN_EVENT = 'dbo:chatAdmin'/.test(front) && /addEventListener\(CHAT_ADMIN_EVENT/.test(front) && /removeEventListener\(CHAT_ADMIN_EVENT/.test(front));

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
