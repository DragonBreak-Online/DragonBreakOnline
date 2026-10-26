// The pick prayer as a native panel: a port of skymp5-front features/prayer PrayerPick, same messages and verdict.
// The server judges; this panel reports picks on its own clock, exactly as the CEF widget does.

var DBO_SWF_VERSION = "prayer-1";
var STAGE_W = 1280;
var PANEL_W = 680;
var PAD = 28;
var ROW_H = 34;
var PICK_LOCK_MS = 220;
var C_DAEDRIC = 0xC9A86A;
var C_FALTER = 0xB23A3A;
var C_HELD = 0x8FBF7F;

var panel;
var titleTf;
var sphereTf;
var statusTf;
var keysTf;
var data = null;
var nonce = "";
var verses = [];
var right = [];
var total = 120000;
var slips = 2;
var lockMs = PICK_LOCK_MS;
var openedAt = 0;
var readyAt = 0;
var picks = [];
var sent = false;
var spoken = 0;
var faltered = 0;
var last = null;
var own = "";
var idle = false;
var focus = -1;
var rowsOnScreen = 0;

function num(v, fallback)
{
   var n = Number(v);
   return isNaN(n) || !isFinite(n) ? fallback : n;
}

function now()
{
   return getTimer() - openedAt;
}

function done()
{
   return (data != null && data.result != undefined && data.result != "") || own != "";
}

function statusText()
{
   if (data.result != undefined && data.result != "")
   {
      return String(data.result);
   }
   if (own == "win")
   {
      return "You speak the three verses.";
   }
   if (own == "lose")
   {
      return idle ? "The moment passes. The verses slip away from you." : "The verses slip away from you.";
   }
   if (last != null && !last.landed)
   {
      var bearing = slips - faltered;
      return bearing > 0 ? "That line belongs to another god's prayer. The prayer will bear " + dboCountWord(bearing) + " more." : "That line belongs to another god's prayer. One more and the prayer slips away.";
   }
   if (spoken == 0)
   {
      return "Speak each verse that belongs to this prayer.";
   }
   var left = verses.length - spoken;
   return dboCapitalise(dboCountWord(left)) + " verse" + (left == 1 ? "" : "s") + " left to speak.";
}

function submit(at, win, hits, misses)
{
   if (sent)
   {
      return;
   }
   sent = true;
   dboSend("dbo:prayer", [nonce, dboJson(picks), at, dboJson({v: 2, mode: "pick", win: win, hits: hits, slips: misses, durMs: at, waitMs: 0})]);
   if (data.judge == "client")
   {
      own = win ? "win" : "lose";
   }
}

function choose(i)
{
   if (sent || done() || spoken >= verses.length)
   {
      return;
   }
   var t = Math.floor(now());
   var lines = verses[spoken].lines;
   if (i < 0 || i >= lines.length || t < readyAt || t > total)
   {
      return;
   }
   readyAt = t + lockMs;
   if (!picks.length)
   {
      dboSend("dbo:prayerStart", [nonce, 0]);
   }
   picks.push([i, t]);
   var landed = i == right[spoken];
   last = {id: picks.length, index: i, landed: landed};
   dboSound(landed ? "UIMenuOK" : "UIMenuCancel");
   if (landed)
   {
      spoken++;
      focus = -1;
      if (spoken >= verses.length)
      {
         submit(t, true, spoken, faltered);
      }
   }
   else
   {
      faltered++;
      if (faltered > slips)
      {
         submit(t, false, spoken, faltered);
      }
   }
   draw();
}

// Closes from the SWF too: the client may not be listening while the menu is open
function standUp()
{
   dboSound("UIMenuCancel");
   dboSend("dbo:prayerCancel", [nonce]);
   dboClose();
}

function setFocus(i)
{
   if (i == focus)
   {
      return;
   }
   focus = i;
   dboSound("UIMenuFocus");
   for (var k = 0; k < rowsOnScreen; k++)
   {
      var r = panel.rows["row" + k];
      r._alpha = k == focus ? A_FOCUS : A_ROW_REST;
      r.underline._visible = k == focus;
   }
}

function clearClip(name, depth)
{
   if (panel[name] != undefined)
   {
      panel[name].removeMovieClip();
   }
   return panel.createEmptyMovieClip(name, depth);
}

function draw()
{
   var daedric = data.kind == "daedra";
   titleTf.text = data.shrine != undefined && data.shrine != "" ? String(data.shrine) : "Shrine of " + data.deity;
   titleTf.textColor = daedric ? C_DAEDRIC : C_TEXT;
   var sphereAll = data.sphere == undefined ? "" : String(data.sphere);
   var cut = sphereAll.indexOf(". ");
   sphereTf.text = sphereAll.length ? data.deity + ": " + (cut > 0 ? sphereAll.substr(0, cut + 1) : sphereAll) : "";
   statusTf.text = statusText();
   var kind = data.resultKind != undefined && data.resultKind != "" ? String(data.resultKind) : own;
   statusTf.textColor = last != null && !last.landed && !done() ? C_FALTER : (done() ? (kind == "win" ? C_HELD : C_SECOND) : C_TEXT);

   var y = 150;
   var past = clearClip("past", 20);
   for (var k = 0; k < spoken && k < verses.length; k++)
   {
      var tf = dboText(past, "v" + k, k, PAD, y, PANEL_W - PAD * 2, 30, dboFmt(F_PLAIN, 22, C_TEXT, 1.0), false);
      tf.text = String(verses[k].lines[right[k]]);
      tf._alpha = 60;
      y += 30;
   }

   var rows = clearClip("rows", 30);
   rowsOnScreen = 0;
   if (!done() && spoken < verses.length)
   {
      y += 10;
      dboRule(rows, PAD, y, PANEL_W - PAD * 2);
      y += 8;
      var lines = verses[spoken].lines;
      for (var j = 0; j < lines.length && j < 9; j++)
      {
         var r = rows.createEmptyMovieClip("row" + j, j);
         r._y = y;
         dboBox(r, PAD, 0, PANEL_W - PAD * 2, ROW_H - 4, 0x000000, 1);
         var kt = dboText(r, "key", 1, PAD + 4, 3, 26, ROW_H - 6, dboFmt(F_BOLD, 20, C_SECOND, 0), false);
         kt.text = String(j + 1);
         var lt = dboText(r, "label", 2, PAD + 34, 2, PANEL_W - PAD * 2 - 44, ROW_H - 4, dboFmt(F_MEDIUM, 22, C_TEXT, 0.8), false);
         lt.text = String(lines[j]);
         if (last != null && !last.landed && last.index == j && picks.length == last.id)
         {
            lt.textColor = C_FALTER;
         }
         var u = r.createEmptyMovieClip("underline", 3);
         dboRule(u, PAD + 34, ROW_H - 5, PANEL_W - PAD * 2 - 44);
         u._visible = j == focus;
         r._alpha = j == focus ? A_FOCUS : A_ROW_REST;
         r.idx = j;
         r.onRollOver = function()
         {
            setFocus(this.idx);
         };
         r.onRelease = function()
         {
            choose(this.idx);
         };
         y += ROW_H;
         rowsOnScreen++;
      }
   }

   y += 14;
   var beads = clearClip("beads", 40);
   var bx = PAD;
   for (var b = 0; b < verses.length; b++)
   {
      dboBox(beads, bx, y, 12, 12, b < spoken ? C_TEXT : C_SECOND, b < spoken ? 100 : 40);
      bx += 20;
   }
   bx += 16;
   for (var s = 0; s < slips; s++)
   {
      dboBox(beads, bx, y, 12, 12, C_FALTER, s < faltered ? 25 : 90);
      bx += 20;
   }
   y += 32;

   var act = clearClip("act", 50);
   act._y = y;
   var label = done() ? "Rise" : "Stand up";
   dboBox(act, PAD, 0, 150, 30, 0x000000, 1);
   var at = dboText(act, "label", 1, PAD, 2, 150, 28, dboFmt(F_MEDIUM, 22, C_TEXT, 0.8, "left"), false);
   at.text = label;
   act._alpha = A_BUTTON_REST;
   act.onRollOver = function()
   {
      this._alpha = A_FOCUS;
      dboSound("UIMenuFocus");
   };
   act.onRollOut = function()
   {
      this._alpha = A_BUTTON_REST;
   };
   act.onRelease = function()
   {
      standUp();
   };
   var n = !done() && spoken < verses.length ? verses[spoken].lines.length : 3;
   keysTf._y = y + 6;
   keysTf.text = done() ? "" : "Click a line or press 1-" + n + ". Escape to stand up.";

   var h = y + 30 + PAD;
   panel.bg.clear();
   dboBox(panel.bg, 0, 0, PANEL_W, h, 0x000000, 80);
   dboRule(panel.bg, PAD, 100, PANEL_W - PAD * 2);
}

function reset(p)
{
   data = p;
   nonce = String(p.nonce);
   verses = [];
   var vs = p.verses instanceof Array ? p.verses : [];
   for (var i = 0; i < vs.length; i++)
   {
      if (vs[i] != null && vs[i].lines instanceof Array && vs[i].lines.length)
      {
         verses.push(vs[i]);
      }
   }
   right = [];
   var rs = p.right instanceof Array ? p.right : [];
   for (var k = 0; k < rs.length; k++)
   {
      right.push(Math.floor(num(rs[k], 0)));
   }
   total = Math.max(10000, Math.floor(num(p.totalMs, 120000)));
   slips = Math.max(0, Math.floor(num(p.slips, 2)));
   lockMs = Math.max(PICK_LOCK_MS, Math.floor(num(p.minPickMs, 300)) + 1);
   openedAt = getTimer();
   readyAt = lockMs;
   picks = [];
   sent = false;
   spoken = 0;
   faltered = 0;
   last = null;
   own = "";
   idle = false;
   focus = -1;
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   panel._x = (STAGE_W - PANEL_W) / 2;
   panel._y = 110;
   panel.createEmptyMovieClip("bg", 1);
   titleTf = dboText(panel, "titleTf", 2, PAD, 22, PANEL_W - PAD * 2, 40, dboFmt(F_PLAIN, 30, C_TEXT, 1.0), false);
   sphereTf = dboText(panel, "sphereTf", 3, PAD, 64, PANEL_W - PAD * 2, 26, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8), false);
   statusTf = dboText(panel, "statusTf", 4, PAD, 110, PANEL_W - PAD * 2, 34, dboFmt(F_MEDIUM, 20, C_TEXT, 0.8), true);
   keysTf = dboText(panel, "keysTf", 5, PAD + 170, 0, PANEL_W - PAD * 2 - 170, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8, "right"), false);
   titleTf.text = "";
   dboBox(panel.bg, 0, 0, PANEL_W, 200, 0x000000, 80);
   dboFadeIn(panel);
}

// The client pushes the whole widget payload as JSON; the same nonce again is the server's verdict, kept in place
_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined)
   {
      dboLog("prayer: unreadable payload");
      return;
   }
   if (String(p.nonce) != nonce)
   {
      reset(p);
   }
   else
   {
      data.result = p.result;
      data.resultKind = p.resultKind;
   }
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   dboLog("prayer key " + code);
   if (code == 27)
   {
      standUp();
      return;
   }
   if (data == null)
   {
      return;
   }
   if (code >= 49 && code <= 57)
   {
      choose(code - 49);
   }
   else if ((code == 38 || code == 87) && rowsOnScreen)
   {
      setFocus(focus <= 0 ? rowsOnScreen - 1 : focus - 1);
   }
   else if ((code == 40 || code == 83) && rowsOnScreen)
   {
      setFocus(focus < 0 || focus >= rowsOnScreen - 1 ? 0 : focus + 1);
   }
   else if ((code == 13 || code == 69) && focus >= 0)
   {
      choose(focus);
   }
   else if ((code == 13 || code == 69) && done())
   {
      standUp();
   }
};
Key.addListener(keys);

// A prayer left unspoken ends at the round's limit
var NO_DATA_CLOSE_MS = 8000;
var builtAt = getTimer();

_root.onEnterFrame = function()
{
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("prayer: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
      delete _root.onEnterFrame;
      dboClose();
      return;
   }
   if (data != null && !sent && !done() && now() >= total)
   {
      idle = true;
      submit(total, false, spoken, faltered);
      draw();
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
