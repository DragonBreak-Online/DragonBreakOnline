// Mining, woodcutting and the bound-hands struggle as a native panel: a port of skymp5-front features/labour, same
// messages, words and verdict. The round belongs to the server (labour.js, struggle.js); this panel draws it and reports
// WHEN each strike fell, never whether one landed, exactly as the CEF widget does.
//   A sweep round: dbo:<event> [nonce, strikesJson, atMs, {v: 1, win, hits}]
//   A pick round:  dbo:<event> [nonce, [[index, ms], ...] json, atMs, {v: 2, mode: "pick", win, hits, slips}]
//   Walk away:     dbo:<event>Cancel [nonce]

var DBO_SWF_VERSION = "labour-1";
var STAGE_W = 1280;
var PANEL_W = 900;
var PAD = 28;
var BAR_X = 28;
var BAR_Y = 128;
var BAR_W = 844;
var BAR_H = 120;
var PICK_LOCK_MS = 220;
var C_MISS = 0xB23A3A;
var C_HIT = 0x8FBF7F;
var NO_DATA_CLOSE_MS = 8000;

var panel;
var titleTf;
var lineTf;
var keysTf;
var data = null;
var nonce = "";
var kind = "mining";
var event = "labour";
var need = 1;
var total = 30000;
var sweepMs = 1400;
var sweeps = null;
var half = 8;
var hitMs = 250;
var missMs = 600;
var pick = false;
var steps = [];
var slipsAllowed = 3;
var pickLock = PICK_LOCK_MS;
var startedAt = 0;
var sample = 0;
var strikes = [];
var hitAt = [];
var picks = [];
var hits = 0;
var misses = 0;
var sent = false;
var own = "";
var readyAt = 0;
var word = null;
var marks = [];
var markId = 0;
var left = 30000;
var builtAt = getTimer();

function num(v, fallback)
{
   var n = Number(v);
   return isNaN(n) || !isFinite(n) ? fallback : n;
}

// Must stay identical to markerAt() in server labour.js, which scores the reported strike times with it
function markerAt(ms, sw)
{
   var phase = (ms % (sw * 2)) / sw;
   return phase <= 1 ? phase * 100 : (2 - phase) * 100;
}

// Must stay identical to markerOn() in server struggle.js: the sweep changes at every landed strike
function markerOn(ms, sws, at)
{
   var phase = 0;
   var from = 0;
   var i = 0;
   for (; i < at.length && at[i] <= ms; i++)
   {
      phase += (at[i] - from) / sws[Math.min(i, sws.length - 1)];
      from = at[i];
   }
   phase = (phase + (ms - from) / sws[Math.min(i, sws.length - 1)]) % 2;
   return phase <= 1 ? phase * 100 : (2 - phase) * 100;
}

function posAt(ms)
{
   return sweeps != null ? markerOn(ms, sweeps, hitAt) : markerAt(ms, sweepMs);
}

// The server's centre for strike i; a short list repeats its last band
function centreAt(i)
{
   var list = data.bands instanceof Array ? data.bands : [];
   return list.length ? num(list[Math.min(i, list.length - 1)], 50) : 50;
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

function oreKey(title)
{
   var t = String(title == undefined ? "" : title).toLowerCase();
   if (t.indexOf("salt") >= 0)
   {
      return "salt";
   }
   if (t.indexOf("geode") >= 0)
   {
      return "geode";
   }
   // The browser's t.replace(/\s*(seam|vein|ore)\s*$/, ''): one trailing word goes
   var words = t.split(" ");
   while (words.length && words[words.length - 1] == "")
   {
      words.pop();
   }
   var last = words[words.length - 1];
   if (last == "seam" || last == "vein" || last == "ore")
   {
      words.pop();
   }
   return words.join(" ");
}

function lead(ore)
{
   if (kind == "chopping")
   {
      return "Swing with the grain, where the wood wants to part.";
   }
   if (kind == "struggle")
   {
      return "Work the knot loose. Pull when the rope gives.";
   }
   if (ore == "salt")
   {
      return "Chip along the crust where the salt has dried thick.";
   }
   if (ore == "geode")
   {
      return "Tap along the line in the stone until the geode splits.";
   }
   return "Read the seam and strike along the grain, where the rock is weakest.";
}

function blowWords(landed, id)
{
   var hit;
   var miss;
   if (kind == "chopping")
   {
      hit = ["The axe bites deep.", "The wood splits along the grain.", "A long splinter peels away."];
      miss = "The blade skids off a knot.";
   }
   else if (kind == "struggle")
   {
      hit = ["The knot gives a little.", "The rope slackens.", "A strand of the rope frays."];
      miss = "The rope bites into your wrists.";
   }
   else
   {
      hit = ["The rock cracks along the grain.", "Stone chips fly from the seam.", "The vein shifts in the rock."];
      miss = "The pick glances off the stone.";
   }
   return landed ? hit[id % hit.length] : miss;
}

function remaining(n)
{
   var noun = kind == "chopping" ? "swing" : kind == "struggle" ? "pull" : "blow";
   return n == 1 ? "One more " + noun + "." : dboCapitalise(dboCountWord(n)) + " more " + noun + "s.";
}

function idleText()
{
   if (kind == "chopping")
   {
      return "You stand idle at the block too long and set the axe down.";
   }
   if (kind == "struggle")
   {
      return "Your grip slips. The rope holds.";
   }
   return "You stand idle at the seam too long and set the pick down.";
}

function ownText(ore)
{
   if (own == "win")
   {
      if (kind == "chopping")
      {
         return "Split clean.";
      }
      if (kind == "struggle")
      {
         return "Every pull lands. Now the knots decide.";
      }
      return ore == "salt" ? "The crust breaks and the salt comes free." : ore == "geode" ? "The geode splits open." : "The seam gives up its ore.";
   }
   if (own == "lose")
   {
      if (pick && misses <= slipsAllowed)
      {
         return idleText();
      }
      return kind == "chopping" ? "The log rolls off the block, still whole." : kind == "struggle" ? "Your grip slips. The rope holds." : "The seam holds. Your arms give out before the rock does.";
   }
   return "";
}

function done()
{
   return (data.result != undefined && data.result != "") || own != "";
}

function over()
{
   return done() || sent;
}

function submit(at)
{
   if (sent)
   {
      return;
   }
   sent = true;
   var win = hits >= need;
   if (pick)
   {
      dboSend("dbo:" + event, [nonce, dboJson(picks), at, dboJson({v: 2, mode: "pick", win: win, hits: hits, slips: misses})]);
   }
   else
   {
      dboSend("dbo:" + event, [nonce, dboJson(strikes), at, dboJson({v: 1, win: win, hits: hits})]);
   }
   if (data.judge == "client")
   {
      own = win ? "win" : "lose";
   }
}

function showBlow(x, landed, y)
{
   markId++;
   marks.push({id: markId, x: x, y: y, landed: landed});
   if (marks.length > 16)
   {
      marks.shift();
   }
   word = {id: markId, text: blowWords(landed, markId), landed: landed, until: getTimer() + 1100};
}

// The strike is timed at the frame on screen, not at the press: what the player saw is what the server scores
function strike()
{
   if (sent || done())
   {
      return;
   }
   var t = sample;
   if (t < readyAt)
   {
      return;
   }
   var landed = Math.abs(posAt(t) - centreAt(hits)) <= half;
   readyAt = t + (landed ? hitMs : missMs);
   strikes.push(t);
   dboSound(landed ? "UIMenuOK" : "UIMenuCancel");
   showBlow(posAt(t), landed);
   if (!landed)
   {
      if (data.failOnMiss == true)
      {
         submit(Math.floor(getTimer() - startedAt));
      }
      draw();
      return;
   }
   hitAt.push(t);
   hits++;
   if (hits >= need)
   {
      submit(Math.floor(getTimer() - startedAt));
   }
   draw();
}

// A pick: spot i of this blow on the round's own clock; the lock only lets the next spots show
function choose(i)
{
   if (!pick || sent || done())
   {
      return;
   }
   var t = Math.floor(getTimer() - startedAt);
   var k = picks.length;
   var spots = steps[k];
   if (spots == undefined || i < 0 || i >= spots.length || t < readyAt || t > total)
   {
      return;
   }
   readyAt = t + pickLock;
   var landed = i == pickRight(spots);
   picks.push([i, t]);
   dboSound(landed ? "UIMenuOK" : "UIMenuCancel");
   showBlow(num(spots[i][0], 50), landed, num(spots[i][1], 50));
   if (!landed)
   {
      misses++;
      if (misses > slipsAllowed)
      {
         submit(t);
      }
      draw();
      return;
   }
   hits++;
   if (hits >= need)
   {
      submit(t);
   }
   draw();
}

// Walked away: the clock running out behind the close must not report the round as well. Closes from the SWF too
function leave()
{
   sent = true;
   dboSound("UIMenuCancel");
   dboSend("dbo:" + event + "Cancel", [nonce]);
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

function lineText(ore)
{
   if (data.result != undefined && data.result != "")
   {
      return String(data.result);
   }
   var o = ownText(ore);
   if (o != "")
   {
      return o;
   }
   if (word != null)
   {
      return word.text;
   }
   if (hits == 0 && misses == 0)
   {
      if (data.hint != undefined && data.hint != "")
      {
         return String(data.hint);
      }
      if (pick)
      {
         return kind == "chopping" ? "Read the grain and pick where the wood will split." : "Read the stone and pick where it will break.";
      }
      return lead(ore);
   }
   return remaining(Math.max(0, need - hits));
}

function strikeLabel()
{
   return data.strikeLabel != undefined && data.strikeLabel != "" ? String(data.strikeLabel) : "Strike";
}

function leaveLabel()
{
   return data.leaveLabel != undefined && data.leaveLabel != "" ? String(data.leaveLabel) : "Walk away";
}

// A button that takes the whole width it is given: the Close row the style guide asks for is one of these
function actButton(parent, name, depth, x, label, onPick)
{
   var b = parent.createEmptyMovieClip(name, depth);
   b._x = x;
   dboBox(b, 0, 0, 170, 32, 0x000000, 1);
   var t = dboText(b, "label", 1, 0, 2, 170, 30, dboFmt(F_MEDIUM, 20, C_TEXT, 0.8, "center"), false);
   t.text = label;
   b._alpha = A_BUTTON_REST;
   b.onPick = onPick;
   b.onRollOver = function()
   {
      if (this.disabled == true)
      {
         return;
      }
      this._alpha = A_FOCUS;
      dboSound("UIMenuFocus");
   };
   b.onRollOut = function()
   {
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

// The face: the band and the marker on a sweep round, the spots on a pick round, a mark where each blow fell
function drawBar()
{
   var bar = clearClip("bar", 20);
   bar._x = BAR_X;
   bar._y = BAR_Y;
   dboBox(bar, 0, 0, BAR_W, BAR_H, 0xFFFFFF, 8);
   dboRule(bar, 0, 0, BAR_W);
   dboRule(bar, 0, BAR_H - 1, BAR_W);
   var ms = bar.createEmptyMovieClip("marks", 5);
   for (var m = 0; m < marks.length; m++)
   {
      var mk = marks[m];
      var mx = BAR_W * mk.x / 100;
      if (mk.y == undefined)
      {
         dboBox(ms, mx - 1, mk.landed ? 0 : BAR_H * 0.4, 2, mk.landed ? BAR_H : BAR_H * 0.2, mk.landed ? C_TEXT : C_SECOND, mk.landed ? 55 : 40);
      }
      else
      {
         var my = BAR_H * mk.y / 100;
         dboBox(ms, mx - 6, my - 1, 12, 2, mk.landed ? C_TEXT : C_SECOND, mk.landed ? 70 : 40);
      }
   }
   if (!pick && !over())
   {
      var c = centreAt(Math.min(hits, need - 1));
      var band = bar.createEmptyMovieClip("band", 6);
      dboBox(band, BAR_W * (c - half) / 100, 0, BAR_W * half * 2 / 100, BAR_H, 0xFFFFFF, 25);
      var mark = bar.createEmptyMovieClip("marker", 8);
      dboBox(mark, -2, -6, 4, BAR_H + 12, C_TEXT, 100);
      mark._x = BAR_W * posAt(sample) / 100;
   }
   if (!pick)
   {
      bar.onRelease = function()
      {
         strike();
      };
   }
   var spots = pick && !over() ? steps[Math.min(picks.length, steps.length - 1)] : null;
   for (var j = 0; spots != null && j < spots.length; j++)
   {
      var sp = spots[j];
      var cue = Math.max(0, Math.min(1, num(sp[2], 0)));
      var s = bar.createEmptyMovieClip("spot" + j, 20 + j);
      s._x = BAR_W * num(sp[0], 50) / 100;
      s._y = BAR_H * num(sp[1], 50) / 100;
      var size = 14 + 18 * cue;
      var g = s.createEmptyMovieClip("cue", 1);
      dboBox(g, -size, -2, size * 2, 4, C_TEXT, 100);
      // skymp5-front cueLook: faint cues fade faster than clear ones
      g._alpha = 100 * Math.max(0.1, Math.pow(cue, 1.5));
      var kt = dboText(s, "key", 2, -10, 6, 20, 24, dboFmt(F_BOLD, 20, C_SECOND, 0, "center"), false);
      kt.text = String(j + 1);
      dboBox(s, -size, -14, size * 2, 44, 0x000000, 1);
      s.idx = j;
      s._alpha = 80;
      s.onRollOver = function()
      {
         this._alpha = A_FOCUS;
         dboSound("UIMenuFocus");
      };
      s.onRollOut = function()
      {
         this._alpha = 80;
      };
      s.onRelease = function()
      {
         choose(this.idx);
      };
   }
}

function drawTally()
{
   var t = clearClip("tally", 30);
   t._y = BAR_Y + BAR_H + 18;
   var x = PAD;
   for (var i = 0; i < need; i++)
   {
      dboBox(t, x, 4, 18, 8, C_TEXT, i < hits ? 100 : 30);
      x += 24;
   }
   var lt = dboText(t, "strength", 1, PANEL_W - PAD - 360, -2, 100, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   lt.text = "Strength";
   var sx = PANEL_W - PAD - 250;
   if (pick)
   {
      for (var p = 0; p < slipsAllowed + 1; p++)
      {
         dboBox(t, sx + p * 20, 2, 12, 12, C_TEXT, p < misses ? 20 : 80);
      }
   }
   else
   {
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
   a._y = BAR_Y + BAR_H + 56;
   if (done())
   {
      keysTf.text = "";
      actButton(a, "stand", 1, PANEL_W - PAD - 170, data.doneLabel != undefined && data.doneLabel != "" ? String(data.doneLabel) : "Stand up", function()
      {
         leave();
      });
      return;
   }
   if (pick)
   {
      var spots = steps[Math.min(picks.length, steps.length - 1)];
      keysTf.text = "Click a spot or press 1-" + (spots != undefined ? spots.length : 4) + " to " + strikeLabel().toLowerCase() + ". Escape to " + leaveLabel().toLowerCase() + ".";
   }
   else
   {
      keysTf.text = "Space, Enter or click to " + strikeLabel().toLowerCase() + ". Escape to " + leaveLabel().toLowerCase() + ".";
      var s = actButton(a, "strike", 1, PANEL_W - PAD - 350, strikeLabel(), function()
      {
         strike();
      });
      if (sent)
      {
         s.disabled = true;
         s._alpha = 50;
         s.label.textColor = C_DISABLED;
      }
   }
   actButton(a, "leave", 2, PANEL_W - PAD - 170, leaveLabel(), function()
   {
      leave();
   });
}

function draw()
{
   var ore = kind == "mining" ? oreKey(data.title) : "";
   titleTf.text = data.title != undefined && data.title != "" ? String(data.title) : kind == "mining" ? "A seam" : "A block";
   lineTf.text = lineText(ore);
   var wordShown = word != null && (data.result == undefined || data.result == "") && ownText(ore) == "";
   lineTf.textColor = wordShown ? (word.landed ? C_HIT : C_MISS) : C_TEXT;
   drawBar();
   drawTally();
   drawActions();
}

// A new round (new nonce) resets everything; the server re-sending the same round with its verdict keeps the tally
function reset(p)
{
   data = p;
   nonce = String(p.nonce);
   kind = p.kind == "chopping" || p.kind == "struggle" ? String(p.kind) : "mining";
   event = p.event != undefined && p.event != "" ? String(p.event) : "labour";
   need = Math.max(1, Math.floor(num(p.strikes, 1)));
   total = Math.max(1000, Math.floor(num(p.totalMs, 30000)));
   sweepMs = Math.max(400, Math.floor(num(p.sweepMs, 1400)));
   sweeps = null;
   if (p.sweeps instanceof Array && p.sweeps.length)
   {
      sweeps = [];
      for (var i = 0; i < p.sweeps.length; i++)
      {
         sweeps.push(Math.max(200, Math.floor(num(p.sweeps[i], sweepMs))));
      }
   }
   half = Math.max(3, Math.min(30, num(p.band, 8)));
   hitMs = Math.max(0, Math.floor(num(p.hitMs, 250)));
   missMs = Math.max(0, Math.floor(num(p.missMs, 600)));
   pick = p.mode == "pick" && p.steps instanceof Array && p.steps.length > 0;
   steps = pick ? p.steps : [];
   slipsAllowed = Math.max(0, Math.floor(num(p.slips, 3)));
   pickLock = Math.max(PICK_LOCK_MS, Math.floor(num(p.minPickMs, 150)) + 1);
   strikes = [];
   hitAt = [];
   picks = [];
   hits = 0;
   misses = 0;
   sent = false;
   own = "";
   word = null;
   marks = [];
   readyAt = pick ? pickLock : 0;
   sample = 0;
   left = total;
   startedAt = getTimer();
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   panel._x = (STAGE_W - PANEL_W) / 2;
   panel._y = 140;
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboBox(bg, 0, 0, PANEL_W, 440, 0x000000, 80);
   titleTf = dboText(panel, "titleTf", 2, PAD, 18, PANEL_W - PAD * 2, 40, dboFmt(F_PLAIN, 30, C_TEXT, 1.0), false);
   lineTf = dboText(panel, "lineTf", 3, PAD, 66, PANEL_W - PAD * 2, 50, dboFmt(F_MEDIUM, 20, C_TEXT, 0.8), true);
   keysTf = dboText(panel, "keysTf", 4, PAD, BAR_Y + BAR_H + 62, PANEL_W - PAD * 2 - 370, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || p.type != "labour")
   {
      dboLog("labour: unreadable payload");
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
   else if (!pick && (code == 32 || code == 13))
   {
      strike();
   }
};
Key.addListener(keys);

// Each frame: the marker moves, the clock runs down, a blow's word fades, and the round ends when the time runs out
_root.onEnterFrame = function()
{
   if (data == null)
   {
      if (getTimer() - builtAt >= NO_DATA_CLOSE_MS)
      {
         dboLog("labour: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   if (word != null && getTimer() >= word.until)
   {
      word = null;
      draw();
   }
   if (sent || done())
   {
      return;
   }
   var el = Math.floor(getTimer() - startedAt);
   sample = el;
   if (el >= total)
   {
      left = 0;
      submit(el);
      draw();
      return;
   }
   left = total - el;
   if (!pick && panel.bar.marker != undefined)
   {
      panel.bar.marker._x = BAR_W * posAt(el) / 100;
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
