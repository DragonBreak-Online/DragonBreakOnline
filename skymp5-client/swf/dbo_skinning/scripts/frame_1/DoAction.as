// Skinning a kill as a native panel: a port of skymp5-front features/skinning, same messages, words and verdict. The round
// belongs to the server (gamemode.js skinning); this panel draws it and reports WHEN each cut fell, as the CEF widget does.
//   A blade round: dbo:skinning [nonce, cutMs json, atMs, {v: 2, win, hits, slips, frames, maxFrameMs}]
//   A pick round:  dbo:skinning [nonce, [[index, ms], ...] json, atMs, {v: 2, mode: "pick", win, hits, slips, frames, maxFrameMs}]
//   Escape / Stop: dbo:skinningCancel [nonce]

var DBO_SWF_VERSION = "skinning-1";
var PANEL_W = 900;
var PANEL_H = 400;
var PAD = 28;
var HIDE_X = 28;
var HIDE_Y = 128;
var HIDE_W = 844;
var HIDE_H = 150;
var PICK_LOCK_MS = 220;
var C_MISS = 0xB23A3A;
var C_HIT = 0x8FBF7F;
var C_PELT = 0x6B5233;
var NO_DATA_CLOSE_MS = 8000;

var panel;
var lineTf;
var keysTf;
var data = null;
var nonce = "";
var cuts = 3;
var allowed = 2;
var width = 0.15;
var sweepMs = 900;
var total = 15000;
var reachMs = 0;
var pick = false;
var steps = [];
var pickLock = PICK_LOCK_MS;
var startedAt = 0;
var sample = 0;
var times = [];
var picks = [];
var hits = 0;
var misses = 0;
var sent = false;
var own = "";
var readyAt = 0;
var marks = [];
var frames = 0;
var lastFrame = 0;
var worstFrame = 0;
var left = 15000;
var builtAt = getTimer();

function num(v, fallback)
{
   var n = Number(v);
   return isNaN(n) || !isFinite(n) ? fallback : n;
}

// Must stay identical to bladeAt() in server gamemode.js, which scores the reported cut times with it
function bladeAt(ms, sw)
{
   var phase = (ms % (sw * 2)) / sw;
   return phase <= 1 ? phase : 2 - phase;
}

// Must stay identical to bladeOff() in server gamemode.js: how near the blade came to the seam at t or reachMs before it
function bladeOff(t, sw, reach, seam)
{
   var d = Math.abs(bladeAt(t, sw) - seam);
   for (var s = Math.max(0, t - reach); s < t; s++)
   {
      d = Math.min(d, Math.abs(bladeAt(s, sw) - seam));
   }
   return d;
}

// The server sends one seam per cut; a short list repeats its last
function seamAt(i)
{
   var list = data.seams instanceof Array ? data.seams : [];
   return list.length ? num(list[Math.min(i, list.length - 1)], 0.5) : 0.5;
}

// skymp5-front utils/minigameJudge pickRight: the clearest cue
function pickRight(spots)
{
   var best = 0;
   for (var i = 1; i < spots.length; i++)
   {
      if (Number(spots[i][2]) > Number(spots[best][2]))
      {
         best = i;
      }
   }
   return best;
}

function cutsLeftText(n)
{
   return n == 1 ? "One more clean cut." : dboCapitalise(dboCountWord(n)) + " more clean cuts.";
}

function slipsLeftText(n)
{
   return n <= 0 ? "One more slip will tear it." : "The hide will bear " + dboCountWord(n) + " more slip" + (n == 1 ? "" : "s") + ".";
}

function startText()
{
   return dboCapitalise(dboCountWord(cuts)) + " clean cut" + (cuts == 1 ? "" : "s") + " free the pelt; "
      + (allowed <= 0 ? "the first slip tears it." : "the hide will bear " + dboCountWord(allowed) + " slip" + (allowed == 1 ? "" : "s") + ".");
}

function done()
{
   return (data.result != undefined && data.result != "") || own != "";
}

function over()
{
   return done() || sent;
}

function doneKind()
{
   return data.resultKind != undefined && data.resultKind != "" ? String(data.resultKind) : own;
}

function submit(at)
{
   if (sent)
   {
      return;
   }
   sent = true;
   var win = hits >= cuts;
   var audit = {v: 2, win: win, hits: hits, slips: misses, frames: frames, maxFrameMs: Math.round(worstFrame)};
   if (pick)
   {
      audit = {v: 2, mode: "pick", win: win, hits: hits, slips: misses, frames: frames, maxFrameMs: Math.round(worstFrame)};
   }
   dboSend("dbo:skinning", [nonce, dboJson(pick ? picks : times), at, dboJson(audit)]);
   if (data.judge == "client")
   {
      own = win ? "win" : "lose";
   }
}

function landed(clean)
{
   if (clean)
   {
      hits++;
      dboSound("UIMenuOK");
      return hits >= cuts;
   }
   misses++;
   dboSound("UIMenuCancel");
   return misses > allowed;
}

// The cut is timed at the frame on screen, not at the press: what the player saw is what the server scores
function cut()
{
   if (pick || over())
   {
      return;
   }
   var t = sample;
   var clean = bladeOff(t, sweepMs, reachMs, seamAt(hits)) <= width / 2;
   times.push(t);
   var at = bladeAt(t, sweepMs) * 100;
   var s = seamAt(hits) * 100;
   marks.push({x: clean ? Math.max(s - width * 50, Math.min(s + width * 50, at)) : at, clean: clean});
   if (landed(clean))
   {
      submit(Math.floor(getTimer() - startedAt));
   }
   draw();
}

// A pick: point i of this cut on the round's own clock; the lock only lets the next points show
function choose(i)
{
   if (!pick || over())
   {
      return;
   }
   var t = Math.floor(getTimer() - startedAt);
   var spots = steps[picks.length];
   if (spots == undefined || i < 0 || i >= spots.length || t < readyAt || t > total)
   {
      return;
   }
   readyAt = t + pickLock;
   var clean = i == pickRight(spots);
   picks.push([i, t]);
   marks.push({x: num(spots[i][0], 50), y: num(spots[i][1], 50), clean: clean});
   if (landed(clean))
   {
      submit(t);
   }
   draw();
}

// Stopped: the clock running out behind the close must not report the round as well
function leave()
{
   if (!over())
   {
      sent = true;
      dboSend("dbo:skinningCancel", [nonce]);
   }
   dboSound("UIMenuCancel");
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

function lineText()
{
   if (data.result != undefined && data.result != "")
   {
      return String(data.result);
   }
   if (own == "win")
   {
      return "The hide comes away clean.";
   }
   if (own == "lose")
   {
      return misses > allowed ? "The knife slips and the hide tears." : pick ? "You leave the knife idle too long and set it down." : "You take too long and the cut goes ragged. The hide tears.";
   }
   if (marks.length)
   {
      var m = marks[marks.length - 1];
      return m.clean ? "A clean line. " + cutsLeftText(cuts - hits) : "The blade snags. " + slipsLeftText(allowed - misses);
   }
   return pick ? "Read the hide and cut where it lifts from the seam." : startText();
}

function lineColor()
{
   if (done())
   {
      return doneKind() == "win" ? C_HIT : doneKind() == "lose" ? C_MISS : C_TEXT;
   }
   return marks.length ? (marks[marks.length - 1].clean ? C_HIT : C_MISS) : C_TEXT;
}

function actButton(parent, name, depth, x, label, onPick)
{
   var b = parent.createEmptyMovieClip(name, depth);
   b._x = x;
   dboBox(b, 0, 0, 170, 32, 0x000000, 1);
   var t = dboText(b, "label", 1, 0, 2, 170, 30, dboFmt(F_MEDIUM, 20, C_TEXT, 0.8, "center"), false);
   t.text = label;
   b._alpha = A_BUTTON_REST;
   b.washW = 170;
   b.washH = 32;
   b.onPick = onPick;
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
   return b;
}

// The hide on its frame: the seam's loose stretch and the blade on a blade round, the points on a pick round, each cut
function drawHide()
{
   var h = clearClip("hide", 20);
   h._x = HIDE_X;
   h._y = HIDE_Y;
   dboBox(h, -8, -6, 6, HIDE_H + 12, C_STONE, 90);
   dboBox(h, HIDE_W + 2, -6, 6, HIDE_H + 12, C_STONE, 90);
   dboGradientBox(h, 0, 0, HIDE_W, HIDE_H, [C_PELT, 0x3E2F1D], [85, 90], [0, 255], Math.PI / 2);
   dboBox(h, 0, HIDE_H / 2 - 1, HIDE_W, 2, 0x2A1F13, 70);
   var ms = h.createEmptyMovieClip("marks", 5);
   for (var m = 0; m < marks.length; m++)
   {
      var mk = marks[m];
      var mx = HIDE_W * mk.x / 100;
      var my = mk.y == undefined ? HIDE_H / 2 : HIDE_H * mk.y / 100;
      if (mk.clean)
      {
         dboBox(ms, mx - 1, my - 18, 2, 36, C_TEXT, 80);
      }
      else
      {
         dboPoly(ms, [[mx - 9, my - 6], [mx - 2, my - 12], [mx + 3, my - 4], [mx + 10, my - 9], [mx + 7, my + 4], [mx + 1, my + 11], [mx - 5, my + 3]], C_MISS, 85);
      }
   }
   if (!pick && !over())
   {
      var s = seamAt(Math.min(hits, cuts - 1));
      var band = h.createEmptyMovieClip("seam", 6);
      dboBox(band, HIDE_W * (s - width / 2), 0, HIDE_W * width, HIDE_H, 0xFFFFFF, 22);
      var blade = h.createEmptyMovieClip("blade", 8);
      dboBox(blade, -1, -10, 2, HIDE_H + 20, C_TEXT, 100);
      dboPoly(blade, [[-4, -10], [4, -10], [0, -22]], C_SILVER, 100);
      blade._x = HIDE_W * bladeAt(sample, sweepMs);
      h.onRelease = function()
      {
         cut();
      };
   }
   var spots = pick && !over() ? steps[Math.min(picks.length, steps.length - 1)] : null;
   for (var j = 0; spots != null && j < spots.length; j++)
   {
      var sp = spots[j];
      var cue = Math.max(0, Math.min(1, num(sp[2], 0)));
      var sc = h.createEmptyMovieClip("spot" + j, 20 + j);
      sc._x = HIDE_W * num(sp[0], 50) / 100;
      sc._y = HIDE_H * num(sp[1], 50) / 100;
      var g = sc.createEmptyMovieClip("cue", 1);
      // skymp5-front liftLook: faint cues fade faster than clear ones
      dboPoly(g, [[-13, 1], [0, -7], [13, 1], [0, -3]], C_TEXT, 100);
      g._alpha = 100 * Math.max(0.1, Math.pow(cue, 1.5));
      var kt = dboText(sc, "key", 2, -10, 6, 20, 24, dboFmt(F_BOLD, 20, C_SECOND, 0, "center"), false);
      kt.text = String(j + 1);
      dboBox(sc, -18, -14, 36, 44, 0x000000, 1);
      sc.idx = j;
      sc._alpha = 80;
      sc.onRollOver = function()
      {
         this._alpha = A_FOCUS;
         dboSound("UIMenuFocus");
      };
      sc.onRollOut = function()
      {
         this._alpha = 80;
      };
      sc.onRelease = function()
      {
         choose(this.idx);
      };
   }
}

function drawTally()
{
   var t = clearClip("tally", 30);
   t._y = HIDE_Y + HIDE_H + 18;
   dboDivider(t, PAD, 30, PANEL_W - PAD * 2);
   var x = PAD;
   for (var i = 0; i < cuts; i++)
   {
      dboBox(t, x, 4, 18, 8, C_TEXT, i < hits ? 100 : 30);
      x += 24;
   }
   x += 16;
   for (var k = 0; k < allowed; k++)
   {
      dboBox(t, x, 2, 12, 12, C_MISS, k < misses ? 90 : 25);
      x += 20;
   }
   if (!pick)
   {
      var lt = dboText(t, "steady", 1, PANEL_W - PAD - 380, -2, 120, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
      lt.text = "Steady hand";
      var sx = PANEL_W - PAD - 250;
      dboBox(t, sx, 4, 250, 8, C_TEXT, 15);
      var fill = t.createEmptyMovieClip("fill", 2);
      dboBox(fill, 0, 0, 250, 8, C_TEXT, 70);
      fill._x = sx;
      fill._y = 4;
      fill._xscale = Math.max(0, Math.min(100, left / total * 100));
   }
}

function drawActions()
{
   var a = clearClip("acts", 40);
   a._y = HIDE_Y + HIDE_H + 56;
   if (done())
   {
      keysTf.text = "";
      actButton(a, "close", 1, PANEL_W - PAD - 170, "Close", leave);
      return;
   }
   if (pick)
   {
      var spots = steps[Math.min(picks.length, steps.length - 1)];
      keysTf.text = "Click a point or press 1-" + (spots != undefined ? spots.length : 4) + " to cut. Escape to stop.";
   }
   else
   {
      keysTf.text = "Space or click to cut. Escape to stop.";
      actButton(a, "cut", 1, PANEL_W - PAD - 350, "Cut", cut);
   }
   actButton(a, "stop", 2, PANEL_W - PAD - 170, "Stop", leave);
}

function draw()
{
   dboTitle(panel, "titleTf", 2, PAD, 18, PANEL_W - PAD * 2, "Skinning the " + (data.name != undefined && data.name != "" ? String(data.name) : "animal"));
   lineTf.text = lineText();
   lineTf.textColor = lineColor();
   drawHide();
   drawTally();
   drawActions();
}

// A new round (new nonce) starts afresh; the server re-sending the same round with its verdict keeps the tally
function reset(p)
{
   data = p;
   nonce = String(p.nonce);
   cuts = Math.max(1, Math.floor(num(p.cuts, 3)));
   allowed = Math.max(0, Math.floor(num(p.misses, 2)));
   width = Math.max(0.05, Math.min(0.5, num(p.seam, 0.15)));
   sweepMs = Math.max(400, Math.floor(num(p.sweepMs, 900)));
   total = Math.max(1000, Math.floor(num(p.totalMs, 15000)));
   reachMs = Math.max(0, Math.min(400, Math.round(num(p.reachMs, 0))));
   pick = p.mode == "pick" && p.steps instanceof Array && p.steps.length > 0;
   steps = pick ? p.steps : [];
   pickLock = Math.max(PICK_LOCK_MS, Math.floor(num(p.minPickMs, 150)) + 1);
   times = [];
   picks = [];
   hits = 0;
   misses = 0;
   sent = false;
   own = "";
   marks = [];
   frames = 0;
   lastFrame = 0;
   worstFrame = 0;
   readyAt = pick ? pickLock : 0;
   sample = 0;
   left = total;
   startedAt = getTimer();
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 50, 110, 300);
   dboTitle(panel, "titleTf", 2, PAD, 18, PANEL_W - PAD * 2, "");
   lineTf = dboText(panel, "lineTf", 3, PAD, 66, PANEL_W - PAD * 2, 50, dboFmt(F_MEDIUM, 20, C_TEXT, 0.8), true);
   keysTf = dboText(panel, "keysTf", 4, PAD, HIDE_Y + HIDE_H + 62, PANEL_W - PAD * 2 - 370, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   dboFadeIn(panel, FADE_KEY_MS);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || p.type != "skinning")
   {
      dboLog("skinning: unreadable payload");
      return;
   }
   if (data == null || String(p.nonce) != nonce)
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
   if ((code == 13 || code == 69) && done())
   {
      leave();
   }
   else if (pick && code >= 49 && code <= 57)
   {
      choose(code - 49);
   }
   else if (!pick && code == 32)
   {
      cut();
   }
};
dboKeys(keys);

// Each frame: the blade crosses the hide, the clock runs down, and the round ends when the time runs out
_root.onEnterFrame = function()
{
   if (data == null)
   {
      if (getTimer() - builtAt >= NO_DATA_CLOSE_MS)
      {
         dboLog("skinning: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   if (over())
   {
      return;
   }
   var now = getTimer();
   if (frames > 0)
   {
      worstFrame = Math.max(worstFrame, now - lastFrame);
   }
   frames++;
   lastFrame = now;
   var el = Math.floor(now - startedAt);
   sample = el;
   if (el >= total)
   {
      left = 0;
      submit(el);
      draw();
      return;
   }
   left = total - el;
   if (!pick && panel.hide.blade != undefined)
   {
      panel.hide.blade._x = HIDE_W * bladeAt(el, sweepMs);
   }
   if (panel.tally.fill != undefined)
   {
      panel.tally.fill._xscale = left / total * 100;
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
