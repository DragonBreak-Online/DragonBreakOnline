// A rite of turning as a native panel: a port of skymp5-front features/rite (TimedRite and RitePick), same messages.
// The server (supernatural.js) runs the rounds and replays every press; with judge 'client' this panel judges the press
// at the frame on screen, shows it at once and reports it with its own times, exactly as the browser widget does.
// Yielding forfeits the rite, which for a deadly one can end the character, so Yield and Escape ask first.

var DBO_SWF_VERSION = "rite-1";
var STAGE_W = 1280;
var PANEL_W = 680;
var PAD = 28;
var BAR_W = PANEL_W - PAD * 2;
var BAR_H = 26;
var STRIP_H = 200;
var SPOT_W = 64;
var PICK_LOCK_MS = 220;
var NO_DATA_CLOSE_MS = 8000;
var C_RED = 0xB23A3A;
var C_HELD = 0x8FBF7F;

var panel;
var data = null;
var roundKey = "";
var builtAt = getTimer();
var pick = false;
var local = false;
var period = 1500;
var center = 0.5;
var width = 0.2;
var graceMs = 100;
var limitMs = 7000;
var lockMs = PICK_LOCK_MS;
var receivedAt = 0;
var startAt = 0;
var sample = -1;
var shown = 0;
var struck = false;
var own = "";
var ownIndex = -1;
var asking = false;
var barY = 0;

function num(v, fallback)
{
   var n = Number(v);
   return isNaN(n) || !isFinite(n) ? fallback : n;
}

// Mirrors riteMarkerAt in skymp5-front utils/minigameJudge: a triangle sweep, 0 to 1 and back once a period
function markerAt(p, t)
{
   var ph = (((t % p) + p) % p) / p;
   return ph < 0.5 ? ph * 2 : 2 - ph * 2;
}

function inZone(t)
{
   return Math.abs(markerAt(period, t) - center) <= width / 2;
}

// Mirrors riteHit: in the zone at any whole millisecond within graceMs of the press
function hitAt(pressMs)
{
   if (inZone(pressMs))
   {
      return true;
   }
   for (var d = 1; d <= graceMs; d++)
   {
      if (inZone(pressMs - d) || inZone(pressMs + d))
      {
         return true;
      }
   }
   return false;
}

// Mirrors pickRight: the clearest mark is the true one
function rightSpot()
{
   var best = 0;
   for (var i = 1; i < data.spots.length; i++)
   {
      if (Number(data.spots[i][2]) > Number(data.spots[best][2]))
      {
         best = i;
      }
   }
   return best;
}

function atMs()
{
   return Math.floor(getTimer() - receivedAt);
}

function strike()
{
   if (pick || struck || asking)
   {
      return;
   }
   var t = sample;
   // The lead-in: the marker has not moved yet, so a press here is not a strike and does not use up the round
   if (t < 0)
   {
      return;
   }
   struck = true;
   if (!local)
   {
      dboSound("UIMenuOK");
      dboSend("dbo:riteStrike", [data.nonce]);
      draw();
      return;
   }
   var hit = hitAt(t);
   own = hit ? "hit" : "miss";
   dboSound(hit ? "UIMenuOK" : "UIMenuCancel");
   dboSend("dbo:riteStrike", [data.nonce, data.round, data.rnonce, own, t, atMs(), Math.round(shown * 10000) / 10000]);
   draw();
}

function timeout()
{
   if (struck)
   {
      return;
   }
   struck = true;
   own = "late";
   dboSound("UIMenuCancel");
   dboSend("dbo:riteTimeout", [data.nonce, data.round, data.rnonce, atMs()]);
   draw();
}

function choose(i)
{
   var at = atMs();
   if (!pick || struck || asking || i < 0 || i >= data.spots.length || at < lockMs)
   {
      return;
   }
   struck = true;
   ownIndex = i;
   own = i == rightSpot() ? "hit" : "miss";
   dboSound(own == "hit" ? "UIMenuOK" : "UIMenuCancel");
   dboSend("dbo:riteStrike", [data.nonce, data.round, data.rnonce, "pick", i, at]);
   draw();
}

function yieldRite()
{
   dboSound("UIMenuCancel");
   dboSend("dbo:riteClose", [data.nonce]);
   dboClose();
}

function ask(on)
{
   dboSound(on ? "UIMenuBladeOpenSD" : "UIMenuBladeCloseSD");
   asking = on;
   draw();
}

function resultText()
{
   if (own == "hit")
   {
      return "True.";
   }
   if (own == "miss")
   {
      return pick ? "Missed (the wrong mark)." : "Missed (off the mark).";
   }
   if (own == "late")
   {
      return "Missed (too late).";
   }
   return data.result != undefined ? String(data.result) : "";
}

// A wrapped field's height for its text: about 58 characters a line at 18 px across the panel
function linesHeight(s)
{
   return Math.max(1, Math.ceil(s.length / 58)) * 24 + 6;
}

function hintText()
{
   var s = "";
   if (pick)
   {
      var read = data.cue == "trail" ? "Choose the freshest track of the prey." : "Choose the strongest beat of the slowing heart.";
      s += "Round " + data.round + " of " + data.rounds + ": " + dboCountWord(data.need) + " true marks. " + read + " Click a mark or press 1-" + (data.spots.length || 3) + ".";
   }
   else
   {
      s += "Round " + data.round + " of " + data.rounds + ": strike " + data.need + " true blows. Space or Enter.";
   }
   return s + (data.deadly == true ? " Failure here can be the end of this life." : "");
}

// A heartbeat or a track drawn from boxes inside a mark, at the mark's strength
function drawCue(c, cue, alpha)
{
   var g = c.createEmptyMovieClip("cue", 2);
   if (cue == "trail")
   {
      var prints = [[14, 30], [24, 18], [36, 34], [46, 22]];
      for (var i = 0; i < prints.length; i++)
      {
         dboBox(g, prints[i][0], prints[i][1], 8, 10, C_TEXT, 100);
      }
   }
   else
   {
      var beat = [[4, 30, 14, 2], [18, 22, 4, 10], [24, 12, 4, 30], [30, 26, 4, 10], [36, 30, 24, 2]];
      for (var k = 0; k < beat.length; k++)
      {
         dboBox(g, beat[k][0], beat[k][1], beat[k][2], beat[k][3], C_TEXT, 100);
      }
   }
   g._alpha = alpha;
}

function drawTimed(b, y)
{
   barY = y;
   var bar = b.createEmptyMovieClip("bar", 20);
   bar._x = PAD;
   bar._y = y;
   dboBox(bar, 0, 0, BAR_W, BAR_H, C_TEXT, 12);
   var zone = bar.createEmptyMovieClip("zone", 1);
   dboBox(zone, (center - width / 2) * BAR_W, 0, width * BAR_W, BAR_H, C_TEXT, 40);
   var m = bar.createEmptyMovieClip("marker", 2);
   dboBox(m, -2, -6, 4, BAR_H + 12, C_TEXT, 100);
   m._x = shown * BAR_W;
   m._alpha = struck ? 60 : 100;
   return y + BAR_H + 16;
}

function drawPick(b, y)
{
   var strip = b.createEmptyMovieClip("strip", 20);
   strip._x = PAD;
   strip._y = y;
   dboBox(strip, 0, 0, BAR_W, STRIP_H, C_TEXT, 8);
   var right = rightSpot();
   for (var i = 0; i < data.spots.length && i < 9; i++)
   {
      var sp = data.spots[i];
      var c = strip.createEmptyMovieClip("s" + i, 10 + i);
      c._x = num(sp[0], 50) / 100 * BAR_W - SPOT_W / 2;
      c._y = num(sp[1], 50) / 100 * STRIP_H - SPOT_W / 2;
      dboBox(c, 0, 0, SPOT_W, SPOT_W, 0x000000, 1);
      var strength = Math.max(0, Math.min(1, num(sp[2], 0)));
      drawCue(c, data.cue == "trail" ? "trail" : "pulse", Math.max(10, Math.round(Math.pow(strength, 1.5) * 100)));
      var kt = dboText(c, "key", 3, 0, SPOT_W - 4, SPOT_W, 22, dboFmt(F_BOLD, 16, C_SECOND, 0, "center"), false);
      kt.text = String(i + 1);
      if (ownIndex == i)
      {
         dboBox(c, 4, SPOT_W - 6, SPOT_W - 8, 2, C_TEXT, 100);
      }
      c.idx = i;
      c.onRelease = function()
      {
         choose(this.idx);
      };
      c.onRollOver = function()
      {
         dboSound("UIMenuFocus");
      };
   }
   return y + STRIP_H + 16;
}

function draw()
{
   actions = [];
   focus = -1;
   var b = clear("body", 20);
   var title = dboText(b, "title", 1, PAD, 20, PANEL_W - PAD * 2, 40, dboFmt(F_PLAIN, 30, C_TEXT, 1.0), false);
   title.text = String(data.title);
   var fl = dboText(b, "flavor", 2, PAD, 62, PANEL_W - PAD * 2, 52, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8), true);
   fl.text = data.flavor == undefined ? "" : String(data.flavor);
   var y = 120;
   var hits = num(data.hits, 0) + (own == "hit" ? 1 : 0);
   var misses = num(data.misses, 0) + (own == "miss" || own == "late" ? 1 : 0);
   var pips = b.createEmptyMovieClip("pips", 10);
   for (var i = 0; i < num(data.rounds, 0); i++)
   {
      var done = i < hits + misses;
      var pip = pips.createEmptyMovieClip("p" + i, i);
      pip._x = PAD + i * 22;
      pip._y = y;
      dboBox(pip, 0, 0, 14, 14, done ? (i < hits ? C_TEXT : C_DISABLED) : C_SECOND, done ? 100 : 40);
      pip.state = done ? (i < hits ? "hit" : "miss") : "";
   }
   y += 30;
   y = pick ? drawPick(b, y) : drawTimed(b, y);
   // The verdict is the one coloured line; the hint under it stays white
   var r = resultText();
   var res = dboText(b, "result", 29, PAD, y, PANEL_W - PAD * 2, 26, dboFmt(F_MEDIUM, 18, C_TEXT, 0.8), false);
   res.text = r;
   if (own == "hit" || own == "miss" || own == "late")
   {
      res.textColor = own == "hit" ? C_HELD : C_RED;
   }
   y += r != "" ? 28 : 0;
   var ht = hintText();
   var hint = dboText(b, "hint", 30, PAD, y, PANEL_W - PAD * 2, linesHeight(ht), dboFmt(F_MEDIUM, 18, C_TEXT, 0.8), true);
   hint.text = ht;
   y += linesHeight(ht) + 4;
   dboRule(b, PAD, y, PANEL_W - PAD * 2);
   y += 12;
   if (asking)
   {
      var qt = data.deadly == true ? "Yield the rite? It counts as lost, and failure here can be the end of this life." : "Yield the rite? It counts as lost.";
      var q = dboText(b, "ask", 40, PAD, y, PANEL_W - PAD * 2, linesHeight(qt), dboFmt(F_MEDIUM, 18, C_TEXT, 0.8), true);
      q.text = qt;
      y += linesHeight(qt) + 6;
      var go = button(b, "yield", 41, PAD, y, 150, "Yield", F_MEDIUM, 22, A_BUTTON_REST, function()
      {
         yieldRite();
      });
      go.label.textColor = C_RED;
      button(b, "goOn", 42, PAD + 160, y, 150, "Go on", F_MEDIUM, 22, A_BUTTON_REST, function()
      {
         ask(false);
      });
   }
   else
   {
      if (!pick)
      {
         var s = button(b, "strike", 41, PAD, y, 150, "Strike", F_MEDIUM, 22, A_BUTTON_REST, function()
         {
            strike();
         });
         if (struck)
         {
            disable(s);
         }
      }
      button(b, "yieldAsk", 42, pick ? PAD : PAD + 160, y, 150, "Yield", F_MEDIUM, 22, A_BUTTON_REST, function()
      {
         ask(true);
      });
   }
   var h = y + 32 + PAD;
   panel.bg.clear();
   dboBox(panel.bg, 0, 0, PANEL_W, h, 0x000000, data.deadly == true ? 88 : 80);
}

function reset(p)
{
   pick = p.mode == "pick" && p.judge == "client" && p.spots instanceof Array && p.spots.length > 0;
   local = p.judge == "client" && p.rnonce != undefined && String(p.rnonce).length > 0;
   period = Math.max(200, num(p.period, 0) || 1500);
   var z = p.zone instanceof Array ? p.zone : [0.5, 0.2];
   center = num(z[0], 0.5);
   width = num(z[1], 0.2);
   graceMs = Math.max(0, Math.min(500, Math.floor(num(p.graceMs, 100))));
   limitMs = Math.max(1000, Math.floor(num(p.limitMs, 7000)));
   lockMs = Math.max(PICK_LOCK_MS, Math.floor(num(p.minPickMs, 300)) + 1);
   receivedAt = getTimer();
   startAt = receivedAt + Math.max(0, num(p.startsIn, 0));
   sample = -1;
   shown = 0;
   struck = false;
   own = "";
   ownIndex = -1;
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   panel._x = (STAGE_W - PANEL_W) / 2;
   panel._y = 140;
   panel.createEmptyMovieClip("bg", 1);
   dboBox(panel.bg, 0, 0, PANEL_W, 200, 0x000000, 80);
   dboFadeIn(panel);
}

// Each round comes as the same nonce with a new round and rnonce: the round restarts; the same round again redraws
_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || p.title == undefined)
   {
      dboLog("rite: unreadable payload");
      return;
   }
   var key = String(p.nonce) + "|" + p.round + "|" + p.rnonce + "|" + p.mode;
   data = p;
   if (key != roundKey)
   {
      roundKey = key;
      reset(p);
   }
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = Key.getCode();
   dboLog("rite key " + code);
   if (data == null)
   {
      if (code == 27 || code == 9)
      {
         dboClose();
      }
      return;
   }
   if (code == 27 || code == 9)
   {
      ask(!asking);
      return;
   }
   if (code == 32 && !asking)
   {
      strike();
   }
   else if (code >= 49 && code <= 57 && pick)
   {
      choose(code - 49);
   }
   else if ((code == 38 || code == 87) && actions.length)
   {
      setFocus(focus <= 0 ? actions.length - 1 : focus - 1);
   }
   else if ((code == 40 || code == 83) && actions.length)
   {
      setFocus(focus < 0 || focus >= actions.length - 1 ? 0 : focus + 1);
   }
   else if (code == 13 || code == 69)
   {
      if (focus >= 0 && actions[focus].disabled != true)
      {
         actions[focus].onPick();
      }
      else if (focus < 0)
      {
         strike();
      }
   }
};
Key.addListener(keys);

// The marker moves on this panel's own clock; the round's limit runs out here, not on the server's
_root.onEnterFrame = function()
{
   if (data == null)
   {
      if (getTimer() - builtAt >= NO_DATA_CLOSE_MS)
      {
         dboLog("rite: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   if (pick)
   {
      return;
   }
   var t = Math.floor(getTimer() - startAt);
   if (!struck)
   {
      sample = t;
      shown = t < 0 ? 0 : markerAt(period, t);
      var m = panel.body.bar.marker;
      if (m != undefined)
      {
         m._x = shown * BAR_W;
      }
   }
   if (local && !struck && t > limitMs)
   {
      timeout();
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
