// The tumbler lock as a native panel (Nat, 1 Nov; _work/lockpick-native-1031.md). The lock belongs to the server
// (lockpick.js): this panel draws the pins, judges each try on its own clock so the player sees it at once, and reports
// WHEN each push and set fell. The server replays them and its verdict stands, whatever this panel thought.
//   The whole lock: dbo:lockpickResult [nonce, "win"|"fail"|"cancel", [[pin, pushMs, setMs, landed], ...] json, 0, endMs]
//   An auto attempt: dbo:lockpickAuto [nonce, triesJson, 0, endMs]

var DBO_SWF_VERSION = "lockpick-1";
var PANEL_W = 900;
var PANEL_H = 470;
var PAD = 28;
var LOCK_X = 150;
var LOCK_Y = 124;
var LOCK_W = 600;
var LOCK_H = 200;
var PIN_W = 46;
var TRAVEL = 70;
var C_MISS = 0xB23A3A;
var C_HIT = 0x8FBF7F;
var C_BRASS = 0x9C8250;
var C_BRASS_DARK = 0x4A3C22;
var NO_DATA_CLOSE_MS = 8000;

var panel;
var lineTf;
var tallyTf;
var keysTf;
var data = null;
var nonce = "";
var rises = [];
var holds = [];
var fallMs = 650;
var graceMs = 70;
var softMs = 80;
var maxTries = 200;
var picksAtStart = 1;
var pins = [];
var tries = [];
var pushAt = -1;
var snapped = 0;
var startedAt = 0;
var sent = false;
var waiting = false;
var word = null;
var builtAt = getTimer();

function num(v, fallback)
{
   var n = Number(v);
   return isNaN(n) || !isFinite(n) ? fallback : n;
}

function now()
{
   return Math.floor(getTimer() - startedAt);
}

function loose()
{
   for (var i = 0; i < pins.length; i++)
   {
      if (!pins[i])
      {
         return i;
      }
   }
   return -1;
}

function setCount()
{
   var n = 0;
   for (var i = 0; i < pins.length; i++)
   {
      if (pins[i])
      {
         n++;
      }
   }
   return n;
}

function dropAll()
{
   for (var i = 0; i < pins.length; i++)
   {
      pins[i] = false;
   }
}

// Must stay identical to replayTumbler() in server lockpick.js: "set", "soft" or "hard"
function judge(i, held)
{
   var lo = rises[i] - graceMs;
   var hi = rises[i] + holds[i] + graceMs;
   if (held >= lo && held <= hi)
   {
      return "set";
   }
   return held >= lo - softMs && held <= hi + softMs ? "soft" : "hard";
}

// How far up pin i stands, 0 to 1, el ms after its push; -1 once it has fallen back
function riseOf(i, el)
{
   if (el < rises[i])
   {
      return el / rises[i];
   }
   if (el <= rises[i] + holds[i])
   {
      return 1;
   }
   var down = el - rises[i] - holds[i];
   return down < fallMs ? 1 - down / fallMs : -1;
}

function done()
{
   return data != null && data.done == true;
}

function over()
{
   return done() || sent || waiting;
}

function submit(outcome)
{
   if (sent)
   {
      return;
   }
   sent = true;
   dboSend("dbo:lockpickResult", [nonce, outcome, dboJson(tries), 0, now()]);
}

function pushPin()
{
   if (over() || loose() < 0 || pushAt >= 0)
   {
      return;
   }
   pushAt = now();
   dboSound("UIMenuFocus");
   draw();
}

function setPin()
{
   if (over() || pushAt < 0)
   {
      return;
   }
   var i = loose();
   var t = now();
   var held = t - pushAt;
   var how = judge(i, held);
   tries.push([i, pushAt, t, how == "set" ? 1 : 0]);
   pushAt = -1;
   if (how == "set")
   {
      pins[i] = true;
      dboSound("UIMenuOK");
      word = {text: setCount() < pins.length ? "The pin catches." : "The last pin catches.", good: true, until: getTimer() + 1100};
      if (loose() < 0)
      {
         submit("win");
      }
   }
   else if (how == "soft")
   {
      dropAll();
      dboSound("UIMenuCancel");
      word = {text: held < rises[i] ? "Too soon. The pins fall back." : "Too late. The pins fall back.", good: false, until: getTimer() + 1400};
   }
   else
   {
      dropAll();
      snapped++;
      dboSound("UIMenuCancel");
      word = {text: snapped >= picksAtStart ? "The pick snaps, and it was your last." : "The pick snaps. The pins fall back.", good: false, until: getTimer() + 1600};
      if (snapped >= picksAtStart)
      {
         submit("fail");
      }
   }
   if (!sent && tries.length >= maxTries)
   {
      submit("fail");
   }
   draw();
}

function tryAuto()
{
   if (over() || num(data.auto, 0) <= 0)
   {
      return;
   }
   waiting = true;
   pushAt = -1;
   dboSound("UIMenuOK");
   dboSend("dbo:lockpickAuto", [nonce, dboJson(tries), 0, now()]);
   draw();
}

// Leaving reports the tries so far, so a pick broken on the way out is still the server's to take
function leave()
{
   dboSound("UIMenuCancel");
   if (!sent && !done() && !waiting)
   {
      submit("cancel");
   }
   else if (!done())
   {
      dboSend("dbo:lockpickCancel", [nonce]);
   }
   dboClose();
}

function clearClip(name, depth)
{
   if (panel[name] != undefined)
   {
      panel[name].removeMovieClip();
   }
   return panel.createEmptyMovieClip(name, depth);
}

function actButton(parent, name, depth, x, w, label, onPick)
{
   var b = parent.createEmptyMovieClip(name, depth);
   b._x = x;
   dboBox(b, 0, 0, w, 32, 0x000000, 1);
   var t = dboText(b, "label", 1, 0, 2, w, 30, dboFmt(F_MEDIUM, 20, C_TEXT, 0.8, "center"), false);
   t.text = label;
   b._alpha = A_BUTTON_REST;
   b.washW = w;
   b.washH = 32;
   b.onPick = onPick;
   b.onRollOver = function()
   {
      if (this.disabled == true)
      {
         return;
      }
      this._alpha = A_FOCUS;
      dboWash(this, true);
      dboSound("UIMenuFocus");
   };
   b.onRollOut = function()
   {
      dboWash(this, false);
      if (this.disabled != true)
      {
         this._alpha = A_BUTTON_REST;
      }
   };
   b.onRelease = function()
   {
      if (this.disabled != true)
      {
         this.onPick();
      }
   };
   return b;
}

function disable(b, off)
{
   b.disabled = off;
   b._alpha = off ? 35 : A_BUTTON_REST;
}

// The lock face: a brass plate, a pin column per tumbler with its spring, the shear line, and the pick under the loose pin
function drawLock()
{
   var lk = clearClip("lock", 20);
   lk._x = LOCK_X;
   lk._y = LOCK_Y;
   dboGradientBox(lk, 0, 0, LOCK_W, LOCK_H, [C_BRASS, C_BRASS_DARK], [55, 70], [0, 255], Math.PI / 2);
   dboRule(lk, 0, 0, LOCK_W);
   dboRule(lk, 0, LOCK_H - 1, LOCK_W);
   var n = Math.max(1, pins.length);
   var gap = LOCK_W / n;
   var shear = 40;
   dboBox(lk, 12, shear - 1, LOCK_W - 24, 2, C_ACCENT, 60);
   var li = loose();
   for (var i = 0; i < pins.length; i++)
   {
      var c = lk.createEmptyMovieClip("pin" + i, 10 + i);
      c._x = gap * i + gap / 2;
      dboBox(c, -PIN_W / 2 - 4, 8, PIN_W + 8, LOCK_H - 16, 0x000000, 45);
      // the spring: short rungs from the slot's top to the pin, packed tighter as the pin rises
      c.createEmptyMovieClip("spring", 1);
      var pin = c.createEmptyMovieClip("body", 2);
      dboBox(pin, -PIN_W / 2, 0, PIN_W, 74, pins[i] ? C_SILVER : i == li ? C_TEXT : C_STONE_LIGHT, pins[i] ? 95 : i == li ? 85 : 55);
      dboBox(pin, -PIN_W / 2, 0, PIN_W, 3, pins[i] ? C_ACCENT : C_GROUND, 90);
      c.body = pin;
      placePin(i, pins[i] ? 1 : 0);
   }
   if (li >= 0 && !over())
   {
      var pick = lk.createEmptyMovieClip("pick", 40);
      dboBox(pick, 0, 0, gap * li + gap / 2 + 8, 5, C_STONE_LIGHT, 95);
      dboPoly(pick, [[gap * li + gap / 2 + 8, -4], [gap * li + gap / 2 + 18, 2], [gap * li + gap / 2 + 8, 5]], C_STONE_LIGHT, 95);
      pick._y = LOCK_H - 30;
      lk.pick = pick;
   }
   lk.onRelease = function()
   {
      if (pushAt < 0)
      {
         pushPin();
      }
      else
      {
         setPin();
      }
   };
}

// Pin i at height f (0 down, 1 at the shear line), with its spring drawn to it
function placePin(i, f)
{
   var c = panel.lock["pin" + i];
   if (c == undefined)
   {
      return;
   }
   var y = 40 + TRAVEL * (1 - f);
   c.body._y = y;
   var s = c.spring;
   s.clear();
   var rungs = 6;
   for (var k = 0; k < rungs; k++)
   {
      dboBox(s, -PIN_W / 4, 10 + (y - 12) * k / rungs, PIN_W / 2, 2, C_STONE_LIGHT, 70);
   }
}

function lineText()
{
   if (data.notice != undefined && data.notice != "")
   {
      return String(data.notice);
   }
   if (waiting)
   {
      return "You trust your hands and work the pick blind...";
   }
   if (word != null)
   {
      return word.text;
   }
   if (pins.length == 1)
   {
      return "Push the pin up, and set it while it hangs at the top.";
   }
   return "Push the loose pin up and set it while it hangs at the top. A miss lets the set pins fall; a bad one snaps the pick.";
}

function lineColor()
{
   if (data.notice != undefined && data.notice != "")
   {
      return data.noticeKind == "win" ? C_HIT : data.noticeKind == "fail" || data.noticeKind == "snap" ? C_MISS : C_TEXT;
   }
   return word != null && !waiting ? (word.good ? C_HIT : C_MISS) : C_TEXT;
}

function picksLeft()
{
   return Math.max(0, num(data.picks, picksAtStart) - (done() ? 0 : snapped));
}

function draw()
{
   dboTitle(panel, "titleTf", 2, PAD, 18, PANEL_W - PAD * 2, data.title != undefined ? String(data.title) : "A lock");
   lineTf.text = lineText();
   lineTf.textColor = lineColor();
   var pl = picksLeft();
   var chance = Math.round(num(data.auto, 0) * 100);
   tallyTf.text = "Pins set " + setCount() + " of " + pins.length + "     Lockpicks " + pl + (chance > 0 ? "     Auto attempt " + chance + "%" : "");
   drawLock();
   var acts = clearClip("acts", 30);
   acts._x = PAD;
   acts._y = PANEL_H - 56;
   if (done())
   {
      actButton(acts, "close", 1, PANEL_W - PAD * 2 - 170, 170, "Close", leave);
      keysTf.text = "E or Enter  Close";
      return;
   }
   var bp = actButton(acts, "push", 1, 0, 150, "Push", pushPin);
   var bs = actButton(acts, "set", 2, 160, 150, "Set", setPin);
   var ba = actButton(acts, "auto", 3, 320, 190, "Auto attempt", tryAuto);
   actButton(acts, "leave", 4, PANEL_W - PAD * 2 - 150, 150, "Leave it", leave);
   disable(bp, over() || pushAt >= 0);
   disable(bs, over() || pushAt < 0);
   disable(ba, over() || chance <= 0);
   keysTf.text = "W  Push     Space  Set     A  Auto attempt     Esc  Leave";
}

// A new lock (new nonce) starts afresh; the server's verdict on the same lock keeps what was played
function reset(p)
{
   data = p;
   nonce = String(p.nonce);
   rises = [];
   holds = [];
   pins = [];
   var n = p.holds instanceof Array ? p.holds.length : 1;
   for (var i = 0; i < n; i++)
   {
      holds.push(Math.max(1, num(p.holds[i], 300)));
      rises.push(Math.max(1, num(p.rises instanceof Array ? p.rises[i] : undefined, 450)));
      pins.push(false);
   }
   fallMs = Math.max(1, num(p.fallMs, 650));
   graceMs = Math.max(0, num(p.graceMs, 70));
   softMs = Math.max(0, num(p.softMs, 80));
   maxTries = Math.max(1, Math.floor(num(p.maxTries, 200)));
   picksAtStart = Math.max(1, Math.floor(num(p.picks, 1)));
   tries = [];
   pushAt = -1;
   snapped = 0;
   sent = false;
   waiting = false;
   word = null;
   startedAt = getTimer();
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 50, 120, 300);
   dboTitle(panel, "titleTf", 2, PAD, 18, PANEL_W - PAD * 2, "");
   lineTf = dboText(panel, "lineTf", 3, PAD, 62, PANEL_W - PAD * 2, 54, dboFmt(F_MEDIUM, 20, C_TEXT, 0.8), true);
   tallyTf = dboText(panel, "tallyTf", 4, PAD, LOCK_Y + LOCK_H + 12, PANEL_W - PAD * 2, 26, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8, "center"), false);
   keysTf = dboText(panel, "keysTf", 6, PAD, PANEL_H - 22 - 70, PANEL_W - PAD * 2, 22, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || p.type != "lockpick" || p.mode != "tumbler")
   {
      dboLog("lockpick: unreadable payload");
      return;
   }
   if (data == null || String(p.nonce) != nonce)
   {
      reset(p);
   }
   else
   {
      data.notice = p.notice;
      data.noticeKind = p.noticeKind;
      data.done = p.done;
      data.picks = p.picks;
      waiting = false;
   }
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (code == 27)
   {
      if (data != null)
      {
         leave();
      }
      else
      {
         dboClose();
      }
      return;
   }
   if (data == null)
   {
      return;
   }
   if (done())
   {
      if (code == 13 || code == 69)
      {
         leave();
      }
      return;
   }
   if (code == 87 || code == 38 || code == 69)
   {
      pushPin();
   }
   else if (code == 32 || code == 13)
   {
      setPin();
   }
   else if (code == 65)
   {
      tryAuto();
   }
};
dboKeys(keys);

// Each frame: the loose pin rises, hangs and falls on the lock's own clock, and a word fades
_root.onEnterFrame = function()
{
   if (data == null)
   {
      if (getTimer() - builtAt >= NO_DATA_CLOSE_MS)
      {
         dboLog("lockpick: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   if (word != null && getTimer() >= word.until)
   {
      word = null;
      lineTf.text = lineText();
      lineTf.textColor = lineColor();
   }
   if (pushAt < 0 || over())
   {
      return;
   }
   var i = loose();
   var f = riseOf(i, now() - pushAt);
   if (f < 0)
   {
      pushAt = -1;
      placePin(i, 0);
      draw();
      return;
   }
   placePin(i, f);
};

_root.dboReady = false;
_root.dboVersion = DBO_SWF_VERSION;
build();
_root.dboReady = true;
dboBoot(function(frame)
{
   dboLog("panel built, version " + DBO_SWF_VERSION + ", skse appeared on frame " + frame);
   dboSend("ready", [frame], frame);
});
