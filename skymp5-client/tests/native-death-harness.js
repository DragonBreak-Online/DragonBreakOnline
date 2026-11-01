// The death screen as a native panel (swf/dbo_death, deathScreenService), against the browser's constructorComponents/death:
// the words, the countdown, the three choices each confirmed first (Confirm sends death:choice [key] once), Escape backing
// out of a confirm and never closing the screen, a new death starting afresh; and the service opening it first, the
// browser screen when it fails, the panel closed when the server hides it.
//   node tests/native-death-harness.js   (from skymp5-client)
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

const P = (t) => t.root.dboPanel;
const shownPage = (t) => Object.values(P(t).flowClip.kids).find((p) => p._visible);
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out.join('|'); };
const buttons = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out; };
const all = (t) => { const out = []; for (let i = 0; i < 4; i++) { out.push(texts(t)); t.press(39); } for (let i = 0; i < 4; i++) t.press(37); return out.join('|'); };
const btn = (t, label) => { for (let i = 0; i < 4; i++) { const b = buttons(t).find((x) => x.label.text === label); if (b) return b; t.press(39); } return null; };
const choices = (t) => t.msgs().filter((m) => m.key === 'death:choice');
const headText = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids || {})) { if (typeof x.text === 'string') out.push(x.text); if (x.kids) walk(x); } }; walk(P(t).head); return out.join('|'); };

{
  const t = S.boot('dbo_death');
  t.push({ type: 'death', seconds: 60, nonce: 1 });
  const tx = all(t);
  check('the browser\'s words: the countdown, normal rules, the healing, the three choices', /You will automatically respawn at the nearest temple in 60 seconds\./.test(tx)
    && /You were found near death and brought to a temple by a traveler/.test(tx) && /You will have 1 HP and naturally heal 1 point every 8 hours/.test(tx)
    && /Optionally, you can choose one of the following:/.test(tx) && ['Permanent Death', 'Resurrect Here', 'Temple w/ Full Health'].every((l) => btn(t, l)), tx);
  check("...titled You have died! (in the title's capitals)", /^you have died!$/i.test(headText(t)), headText(t));
  t.st.time += 5000; t.tick();
  check('the countdown runs on its own', /in 55 seconds\./.test(all(t)), all(t));
  btn(t, 'Resurrect Here').onRelease();
  const c = all(t);
  check('a choice asks first, with its warning and Confirm / Cancel', /Resurrect Here/.test(c) && /abuse will result in a ban/.test(c) && btn(t, 'Confirm') && btn(t, 'Cancel') && !choices(t).length, c);
  check('...Confirm is drawn red', btn(t, 'Confirm').label.textColor === 0xB23A3A);
  t.press(27);
  check('Escape backs out of the confirm to the choices, nothing sent, the screen stays', /Optionally/.test(all(t)) && !choices(t).length && !t.closed());
  t.press(27);
  check('...and Escape on the choices does nothing: death has no way out but them', !t.closed() && /Optionally/.test(all(t)));
  btn(t, 'Permanent Death').onRelease();
  check('Permanent Death\'s warning', /unplayable\. Everything will be lootable and your body will remain\./.test(all(t)));
  btn(t, 'Cancel').onRelease();
  btn(t, 'Temple w/ Full Health').onRelease();
  const ok = btn(t, 'Confirm');
  ok.onRelease(); ok.onRelease();
  check('Confirm sends death:choice with the key, once, a double click too', choices(t).length === 1 && JSON.stringify(choices(t)[0].args) === '["temple"]', choices(t));
  check('...then waits, with nothing more to press', /Sent\. Waiting for the world to answer\./.test(all(t)) && !btn(t, 'Confirm'));
  t.press(27);
  check('...Escape after sending changes nothing', choices(t).length === 1 && /Sent\./.test(all(t)));
  t.push({ type: 'death', seconds: 60, nonce: 1 });
  check('the same death sent again keeps the answer and the clock', /Sent\./.test(all(t)));
  t.push({ type: 'death', seconds: 30, nonce: 2 });
  check('a new death starts afresh: its own countdown and the choices again', /in 30 seconds\./.test(all(t)) && btn(t, 'Resurrect Here') && btn(t, 'Resurrect Here').disabled !== true, all(t));
  t.st.time += 31000; t.tick();
  check('the countdown stops at 0', /in 0 seconds\./.test(all(t)) && !t.sent.some((m) => m.e === 'closeMenu'));
  t.st.time += 13000; t.tick();
  check('...the panel stays through the service\'s 15 s grace', !t.sent.some((m) => m.e === 'closeMenu'));
  t.st.time += 2000;
  check('...and closes itself after it, so a hide that cannot arrive never strands the player', t.closed() && t.logs.some((l) => /death: 15 s past the countdown with no hide, closing/.test(l)));
}
{
  const t = S.boot('dbo_death');
  t.push({ type: 'journal' });
  check('a payload that is not a death is refused', t.logs.some((l) => /death: unreadable payload/.test(l)));
  t.st.time += 8001; t.tick();
  check('...and with none in 8 s the panel closes itself', t.closed());
  const k = S.boot('dbo_death');
  k.push({ type: 'death', nonce: 3 });
  check('no seconds: 60, as the browser', /in 60 seconds\./.test(all(k)));
}

// ---- the service ----
const SVC = read('src/services/services/deathScreenService.ts');
const W = read('src/services/services/nativeWidgets.ts');
check('nativeWidgets: death is a client-service panel, dbo_death', /\n  death: "dbo_death",\n/.test(W));
check('show opens the native panel first, the browser screen only when it cannot', /this\.native = this\.openNative\(s\);\s*if \(!this\.native\) this\.showBrowser\(s\);/.test(SVC));
check('the panel\'s choice and the browser\'s go through the one check (permadeath, resurrect, temple)', /if \(key === "death:choice"\) \{ this\.choose\(String\(args\[0\] \?\? ""\)\); return; \}/.test(SVC)
  && /this\.choose\(String\(e\.arguments\[1\] \?\? ""\)\);/.test(SVC) && /if \(choice !== "permadeath" && choice !== "resurrect" && choice !== "temple"\)/.test(SVC));
check('a panel that failed falls to the browser with the time left', /if \(key === FAILED_KEY && this\.native && this\.failsafeTimer !== undefined\) \{\s*this\.native = false;\s*this\.showBrowser\(Math\.max\(0, Math\.round\(\(this\.endsAt - Date\.now\(\)\) \/ 1000\)\)\);/.test(SVC));
check('hide (the server, or the failsafe) takes the native panel down', /if \(this\.native\) \{\s*this\.native = false;\s*try \{ this\.controller\.lookupListener\(ScaleformMenuService\)\.closeNative\("death"\);/.test(SVC));
check('the hide-UI key never puts the browser over the native panel', /if \(!e\.hidden && this\.failsafeTimer !== undefined && !this\.native\) this\.sp\.browser\.setFocused\(true\);/.test(SVC));
check('the failsafe is armed either way', /this\.armFailsafe\(s\);/.test(SVC));

T.done();
