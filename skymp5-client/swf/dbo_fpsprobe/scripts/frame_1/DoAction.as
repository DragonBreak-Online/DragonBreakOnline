// Probe: does a CustomMenu keep a steady frame for timing minigames (lockpick, skinning, reading)? Opened by /testmenu fps.
// It times every onEnterFrame for payload.frames frames and every key press against the frame it lands on, then answers
// dbo:fpsProbe [results] and closes. The server logs the answer.

var DBO_SWF_VERSION = "fpsprobe-1";
var PANEL_W = 700;
var PANEL_H = 260;
var PAD = 28;

var panel;
var frames = 600;
var gaps = [];
var keyLag = [];
var last = 0;
var started = false;
var lastFrameAt = 0;
var counter;

// ---- statistics (pure; tests/native-fpsprobe-harness.js runs this block in node) ----
// FPS-STATS-BEGIN
function fpsStats(gaps, keyLag)
{
   var s = gaps.slice();
   s.sort(function(a, b) { return a - b; });
   var n = s.length;
   var sum = 0;
   var over33 = 0;
   var over50 = 0;
   for (var i = 0; i < n; i++)
   {
      sum += s[i];
      if (s[i] > 33)
      {
         over33++;
      }
      if (s[i] > 50)
      {
         over50++;
      }
   }
   var k = keyLag.slice();
   k.sort(function(a, b) { return a - b; });
   return {
      frames: n,
      meanMs: n ? Math.round(sum / n * 10) / 10 : 0,
      fps: n && sum > 0 ? Math.round(n * 1000 / sum * 10) / 10 : 0,
      p95Ms: n ? s[Math.min(n - 1, Math.floor(n * 0.95))] : 0,
      maxMs: n ? s[n - 1] : 0,
      over33: over33,
      over50: over50,
      keys: k.length,
      keyLagMaxMs: k.length ? k[k.length - 1] : 0
   };
}
// FPS-STATS-END

function finish(why)
{
   delete _root.onEnterFrame;
   var r = fpsStats(gaps, keyLag);
   r.end = why;
   dboSend("dbo:fpsProbe", [r]);
   dboClose();
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboTitle(panel, "title", 2, PAD, 18, PANEL_W - PAD * 2, "Frame probe");
   var sub = dboText(panel, "sub", 3, PAD, 62, PANEL_W - PAD * 2, 60, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8), true);
   sub.text = "Timing this menu's frames. Press a few keys; it closes itself and reports.";
   counter = dboText(panel, "counter", 4, PAD, 140, PANEL_W - PAD * 2, 40, dboFmt(F_MEDIUM, 22, C_TEXT, 0.8), false);
   counter.text = "Starting";
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p != null && Number(p.frames) > 0)
   {
      frames = Math.min(3600, Number(p.frames));
   }
   started = true;
   last = getTimer();
   lastFrameAt = last;
};

_root.onEnterFrame = function()
{
   if (!started)
   {
      return;
   }
   var now = getTimer();
   gaps.push(now - last);
   last = now;
   lastFrameAt = now;
   if (gaps.length % 30 == 0)
   {
      counter.text = gaps.length + " of " + frames + " frames";
   }
   if (gaps.length >= frames)
   {
      finish("done");
   }
};

// A key's lag is how long after the last frame its event arrived: the work a minigame's input waits behind
var keys = {};
keys.onKeyDown = function()
{
   if (dboKey() == 27)
   {
      finish("escape");
      return;
   }
   if (started)
   {
      keyLag.push(getTimer() - lastFrameAt);
   }
};
Key.addListener(keys);

_root.dboReady = false;
_root.dboVersion = DBO_SWF_VERSION;
build();
_root.dboReady = true;
dboBoot(function(frame)
{
   dboLog("panel built, version " + DBO_SWF_VERSION + ", skse appeared on frame " + frame);
   dboSend("ready", [frame], frame);
});
