// The Scholar's reading as a native panel: a port of skymp5-front features/reading, same messages, words and verdict. A
// sentence arrives shuffled; the reader puts the words back in order before the candle gutters. The server judges the
// words; a wrong reading comes back with the words already right locked in place. With judge 'client' the candle is
// this panel's own: it stops while a reading is judged, takes the penalty itself, and its clock goes with every report.
//   A reading:     dbo:reading [nonce, order json, {v: 2, elapsedMs, pausedMs, leftMs, attempts, guttered}]
//   A pick round:  dbo:reading [nonce, order json, {v: 3, mode: "pick", elapsedMs, attempts, guttered}]
//   A server judge without the clock: dbo:reading [nonce, order json]
//   Escape / Give up / Close: dbo:readingCancel [nonce]

var DBO_SWF_VERSION = "reading-1";
var PANEL_W = 900;
var PANEL_H = 520;
var PAD = 28;
var BODY_W = 844;
var LINE_Y = 140;
var POOL_Y = 270;
var TILE_H = 32;
var C_MISS = 0xB23A3A;
var C_HIT = 0x8FBF7F;
var C_WAX = 0xE8DCC0;
var C_FLAME = 0xF2B04A;
var NO_DATA_CLOSE_MS = 8000;

var panel;
var hintTf;
var keysTf;
var data = null;
var nonce = "";
var attemptSeen = -1;
var words = [];
var locked = [];
var placed = [];
var pick = false;
var own = false;
var stubs = 0;
var total = 30000;
var candle = 30000;
var penalty = 0;
var sent = false;
var burnt = 0;
var paused = 0;
var tick = 0;
var sentAt = 0;
var deadline = 0;
var left = 30000;
var shakeUntil = 0;
var builtAt = getTimer();

function num(v, fallback)
{
   var n = Number(v);
   return isNaN(n) || !isFinite(n) ? fallback : n;
}

function over()
{
   return data != null && data.result != undefined && data.result != "";
}

function indexIn(list, v)
{
   for (var i = 0; i < list.length; i++)
   {
      if (list[i] == v)
      {
         return i;
      }
   }
   return -1;
}

function ownLeft()
{
   return candle - burnt - num(data.attempt, 0) * penalty;
}

// The candle burns on the panel's own clock; the time a reading waits on its verdict is not burnt
function burn()
{
   var now = getTimer();
   burnt += now - tick;
   tick = now;
}

function submit(guttered)
{
   if (sent || over())
   {
      return;
   }
   sent = true;
   var order = placed.slice();
   if (!own)
   {
      dboSend("dbo:reading", [nonce, dboJson(order)]);
      draw();
      return;
   }
   burn();
   sentAt = getTimer();
   if (pick)
   {
      dboSend("dbo:reading", [nonce, dboJson(order), dboJson({v: 3, mode: "pick", elapsedMs: Math.floor(burnt + paused), attempts: num(data.attempt, 0), guttered: guttered == true})]);
   }
   else
   {
      var l = ownLeft();
      dboSend("dbo:reading", [nonce, dboJson(order), dboJson({v: 2, elapsedMs: Math.floor(burnt), pausedMs: Math.floor(paused), leftMs: Math.floor(l), attempts: num(data.attempt, 0), guttered: guttered == true || l <= 0})]);
   }
   draw();
}

function place(i)
{
   if (sent || over() || indexIn(placed, i) >= 0)
   {
      return;
   }
   placed.push(i);
   dboSound("UIMenuFocus");
   draw();
}

function unplace(i)
{
   if (sent || over() || indexIn(locked, i) >= 0)
   {
      return;
   }
   var k = indexIn(placed, i);
   if (k < 0)
   {
      return;
   }
   placed.splice(k, 1);
   dboSound("UIMenuCancel");
   draw();
}

function readOut()
{
   if (placed.length != words.length)
   {
      return;
   }
   dboSound("UIMenuOK");
   submit(false);
}

function giveUp()
{
   dboSound("UIMenuCancel");
   dboSend("dbo:readingCancel", [nonce]);
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

function tileW(word)
{
   return Math.max(48, String(word).length * 11 + 24);
}

// A word as a tile; placed ones read brighter, locked ones carry the accent, used ones in the pool are dimmed
function tile(parent, name, depth, x, y, word, look, onPick)
{
   var w = tileW(word);
   var b = parent.createEmptyMovieClip(name, depth);
   b._x = x;
   b._y = y;
   dboBox(b, 0, 0, w, TILE_H, look == "locked" ? C_ACCENT : 0xFFFFFF, look == "locked" ? 22 : look == "used" ? 4 : 10);
   dboRule(b, 0, TILE_H - 1, w);
   var t = dboText(b, "label", 1, 0, 3, w, TILE_H - 4, dboFmt(F_MEDIUM, 20, look == "used" ? C_DISABLED : C_TEXT, 0.8, "center"), false);
   t.text = String(word);
   b._alpha = look == "used" ? 50 : A_BUTTON_REST;
   b.onPick = onPick;
   b.washW = w;
   b.washH = TILE_H;
   if (onPick != null)
   {
      b.onRollOver = function()
      {
         this._alpha = A_FOCUS;
         dboWash(this, true);
         dboSound("UIMenuFocus");
      };
      b.onRollOut = function()
      {
         dboWash(this, false);
         this._alpha = A_BUTTON_REST;
      };
      b.onRelease = function()
      {
         this.onPick();
      };
   }
   return w;
}

// Tiles wrapped into rows of the body's width, as flowButtons wraps its chips; returns the height used
function tiles(clip, list, lookOf, pickOf)
{
   var x = 0;
   var y = 0;
   for (var k = 0; k < list.length; k++)
   {
      var i = list[k];
      var w = tileW(words[i]);
      if (x > 0 && x + w > BODY_W)
      {
         x = 0;
         y += TILE_H + 8;
      }
      tile(clip, "w" + i, 10 + k, x, y, words[i], lookOf(i), pickOf(i));
      x += w + 8;
   }
   return y + TILE_H;
}

function drawLine()
{
   var c = clearClip("line", 20);
   c._x = PAD;
   c._y = LINE_Y;
   dboDivider(c, 0, -10, BODY_W);
   if (!placed.length)
   {
      var e = dboText(c, "empty", 1, 0, 3, 60, TILE_H, dboFmt(F_MEDIUM, 20, C_SECOND, 0.8), false);
      e.text = "...";
   }
   tiles(c, placed, function(i)
   {
      return indexIn(locked, i) >= 0 ? "locked" : "placed";
   }, function(i)
   {
      return indexIn(locked, i) >= 0 || sent || over() ? null : function()
      {
         unplace(i);
      };
   });
   if (getTimer() < shakeUntil)
   {
      c._x = PAD + 6;
   }
   if (over())
   {
      var kind = String(data.resultKind);
      c._alpha = 100;
      dboBox(c, -6, -4, BODY_W + 12, 2, kind == "win" ? C_HIT : C_MISS, 80);
   }
}

function drawPool()
{
   var c = clearClip("pool", 21);
   c._x = PAD;
   c._y = POOL_Y;
   if (over())
   {
      if (data.answer != undefined && data.answer != "")
      {
         var a = dboText(c, "answer", 1, 0, 0, BODY_W, 60, dboFmt(F_MEDIUM, 20, C_SECOND, 0.8), true);
         a.text = "It read: " + String(data.answer);
      }
      return;
   }
   var all = [];
   for (var i = 0; i < words.length; i++)
   {
      all.push(i);
   }
   tiles(c, all, function(i)
   {
      return indexIn(placed, i) >= 0 ? "used" : "free";
   }, function(i)
   {
      return indexIn(placed, i) >= 0 || sent ? null : function()
      {
         place(i);
      };
   });
}

function candleText()
{
   if (over())
   {
      return "";
   }
   if (pick)
   {
      var spare = Math.max(0, stubs - num(data.attempt, 0));
      return spare ? dboCapitalise(dboCountWord(spare)) + " stub" + (spare == 1 ? "" : "s") + " to spare" : "The last of the candle";
   }
   return Math.ceil(Math.max(0, left) / 1000) + "s";
}

function drawCandle()
{
   var c = clearClip("candle", 22);
   c._x = PAD;
   c._y = PANEL_H - 130;
   if (pick)
   {
      var burntStubs = num(data.attempt, 0);
      for (var s = 0; s <= stubs; s++)
      {
         dboBox(c, s * 26, 0, 18, 26, C_WAX, s < burntStubs ? 20 : 85);
         if (s == Math.min(burntStubs, stubs) && !over())
         {
            dboPoly(c, [[s * 26 + 9, -12], [s * 26 + 14, -2], [s * 26 + 4, -2]], C_FLAME, 95);
         }
      }
   }
   else
   {
      var pct = over() ? 0 : Math.max(0, Math.min(100, left / total * 100));
      dboBox(c, 0, 8, 600, 10, C_WAX, 15);
      var wax = c.createEmptyMovieClip("wax", 2);
      dboBox(wax, 0, 0, 600, 10, C_WAX, 80);
      wax._y = 8;
      wax._xscale = pct;
      if (!over())
      {
         var f = c.createEmptyMovieClip("flame", 3);
         dboPoly(f, [[0, -6], [5, 6], [-5, 6]], C_FLAME, 95);
         f._x = 600 * pct / 100;
         f._y = 2;
      }
   }
   var t = dboText(c, "time", 4, 620, 2, 220, 26, dboFmt(F_MEDIUM, 18, !over() && !pick && left <= 10000 ? C_MISS : C_SECOND, 0.8), false);
   t.text = candleText();
}

function actButton(parent, name, depth, x, w, label, onPick, off)
{
   var b = parent.createEmptyMovieClip(name, depth);
   b._x = x;
   dboBox(b, 0, 0, w, 32, 0x000000, 1);
   var t = dboText(b, "label", 1, 0, 2, w, 30, dboFmt(F_MEDIUM, 20, off ? C_DISABLED : C_TEXT, 0.8, "center"), false);
   t.text = label;
   b._alpha = off ? 50 : A_BUTTON_REST;
   b.disabled = off == true;
   b.washW = w;
   b.washH = 32;
   b.onPick = onPick;
   b.onRollOver = function()
   {
      if (this.disabled)
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
      if (!this.disabled)
      {
         this._alpha = A_BUTTON_REST;
      }
   };
   b.onRelease = function()
   {
      if (!this.disabled)
      {
         this.onPick();
      }
   };
   return b;
}

function drawActions()
{
   var a = clearClip("acts", 30);
   a._y = PANEL_H - 82;
   if (over())
   {
      keysTf.text = "";
      actButton(a, "close", 1, PANEL_W - PAD - 220, 220, "Close the book", giveUp, false);
      return;
   }
   keysTf.text = "Click a word to place it, click a placed word to take it back. Enter reads it out, Backspace takes back the last word.";
   actButton(a, "read", 1, PANEL_W - PAD - 400, 220, "Read it out", readOut, sent || placed.length != words.length);
   actButton(a, "giveup", 2, PANEL_W - PAD - 170, 170, "Give up", giveUp, false);
}

function hintText()
{
   if (over())
   {
      return String(data.result);
   }
   if (data.feedback != undefined && data.feedback != "")
   {
      return String(data.feedback);
   }
   return pick
      ? "The ink has run. Put the words back in order and read it out. A wrong reading burns a stub of the candle."
      : "The ink has run. Put the words back in order, then read it out before the candle gutters. A wrong reading burns the candle down.";
}

function draw()
{
   dboTitle(panel, "titleTf", 2, PAD, 18, PANEL_W - PAD * 2, data.title != undefined && data.title != "" ? String(data.title) : "A book");
   hintTf.text = hintText();
   hintTf.textColor = over() ? (data.resultKind == "win" ? C_HIT : C_MISS) : data.feedback != undefined && data.feedback != "" ? C_MISS : C_TEXT;
   drawLine();
   drawPool();
   drawCandle();
   drawActions();
}

// A new round starts the clock; a verdict on a wrong reading (a new attempt) keeps the locked words and, with judge
// 'client', runs the candle on from where it stopped less the penalty, the wait on the verdict not burnt
function take(p)
{
   var fresh = data == null || String(p.nonce) != nonce;
   var verdict = !fresh && num(p.attempt, 0) != attemptSeen;
   data = p;
   words = p.words instanceof Array ? p.words : [];
   locked = p.locked instanceof Array ? p.locked : [];
   pick = p.mode == "pick";
   own = p.judge == "client";
   stubs = Math.max(0, Math.floor(num(p.stubs, 0)));
   total = pick ? Math.max(60000, num(p.totalMs, 600000)) : Math.max(1, num(p.seconds, 30) * 1000);
   candle = num(p.candleMs, 0) > 0 ? num(p.candleMs, total) : total;
   penalty = num(p.penaltyMs, 0);
   if (!fresh && !verdict)
   {
      return;
   }
   placed = locked.slice();
   sent = false;
   var now = getTimer();
   if (fresh)
   {
      nonce = String(p.nonce);
      burnt = 0;
      paused = 0;
      sentAt = 0;
      tick = now;
   }
   else
   {
      if (sentAt > 0)
      {
         paused += now - sentAt;
      }
      sentAt = 0;
      tick = now;
   }
   deadline = now + (p.endsInMs != undefined ? num(p.endsInMs, total) : total);
   left = own ? (pick ? total : ownLeft()) : deadline - now;
   attemptSeen = num(p.attempt, 0);
   if (num(p.attempt, 0) > 0 && verdict)
   {
      shakeUntil = now + 450;
   }
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 50, 110, 320);
   dboTitle(panel, "titleTf", 2, PAD, 18, PANEL_W - PAD * 2, "");
   hintTf = dboText(panel, "hintTf", 3, PAD, 62, PANEL_W - PAD * 2, 56, dboFmt(F_MEDIUM, 20, C_TEXT, 0.8), true);
   keysTf = dboText(panel, "keysTf", 4, PAD, PANEL_H - 40, PANEL_W - PAD * 2, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.8), false);
   dboFadeIn(panel, FADE_KEY_MS);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || p.type != "reading")
   {
      dboLog("reading: unreadable payload");
      return;
   }
   take(p);
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
         giveUp();
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
   if (code == 13)
   {
      if (over())
      {
         giveUp();
      }
      else
      {
         readOut();
      }
   }
   else if (code == 8 && placed.length)
   {
      unplace(placed[placed.length - 1]);
   }
};
dboKeys(keys);

// Each frame the candle burns; when it gutters, whatever is placed goes to the server
_root.onEnterFrame = function()
{
   if (data == null)
   {
      if (getTimer() - builtAt >= NO_DATA_CLOSE_MS)
      {
         dboLog("reading: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   if (shakeUntil > 0 && getTimer() >= shakeUntil)
   {
      shakeUntil = 0;
      panel.line._x = PAD;
   }
   if (sent || over())
   {
      return;
   }
   var remaining;
   if (own && pick)
   {
      burn();
      remaining = total - burnt - paused;
   }
   else if (own)
   {
      burn();
      remaining = ownLeft();
   }
   else
   {
      remaining = deadline - getTimer();
   }
   var before = Math.ceil(left / 1000);
   left = Math.max(0, remaining);
   if (remaining <= 0)
   {
      submit(true);
      return;
   }
   if (Math.ceil(left / 1000) != before || !pick)
   {
      if (!pick && panel.candle.wax != undefined)
      {
         var pct = Math.max(0, Math.min(100, left / total * 100));
         panel.candle.wax._xscale = pct;
         panel.candle.flame._x = 600 * pct / 100;
      }
      panel.candle.time.text = candleText();
   }
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
