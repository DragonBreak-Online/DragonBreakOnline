// Probe: can a native panel load the realm map image at run time? For each path in the payload it tries
// MovieClipLoader.loadClip and records what the engine says (onLoadInit with the size, onLoadError with its code, or
// nothing within the wait), shows each answer and sends them all as dbo:mapProbe [results] once every path has answered.
// Payload: { paths: [string], waitMs? }

var DBO_SWF_VERSION = "mapprobe-1";
var STAGE_W = 1280;
var PANEL_W = 1180;
var PANEL_H = 660;
var PAD = 24;
var THUMB = 175;

var panel;
var results = [];
var started = 0;
var waitMs = 6000;
var sent = false;

function line(i)
{
   var r = results[i];
   var t = panel.list["r" + i];
   t.text = (i + 1) + ". " + r.path + "\n    " + (r.state == "init" ? "loaded " + r.w + " x " + r.h : r.state == "error" ? "error: " + r.code : r.state == "start" ? "started, no result yet" : "waiting");
   t.textColor = r.state == "init" ? 0x8BC58B : r.state == "error" ? 0xB23A3A : C_SECOND;
}

function finishIfDone()
{
   if (sent)
   {
      return;
   }
   for (var i = 0; i < results.length; i++)
   {
      if (results[i].state != "init" && results[i].state != "error" && getTimer() - started < waitMs)
      {
         return;
      }
   }
   sent = true;
   for (var j = 0; j < results.length; j++)
   {
      if (results[j].state != "init" && results[j].state != "error")
      {
         results[j].state = "timeout";
      }
      line(j);
   }
   dboLog("map probe: " + dboJson(results));
   dboSend("dbo:mapProbe", [results]);
}

function probe(i)
{
   var holder = panel.createEmptyMovieClip("img" + i, 100 + i);
   holder._x = PAD + i * (THUMB + 12);
   holder._y = 340;
   var target = holder.createEmptyMovieClip("pic", 1);
   var mcl = new MovieClipLoader();
   var l = {};
   l.idx = i;
   l.onLoadStart = function(t)
   {
      if (results[this.idx].state == "waiting")
      {
         results[this.idx].state = "start";
      }
      line(this.idx);
   };
   l.onLoadInit = function(t)
   {
      var r = results[this.idx];
      r.state = "init";
      r.w = t._width;
      r.h = t._height;
      // a thumbnail, so Nat sees the picture and not only the numbers
      if (t._width > 0)
      {
         var s = THUMB / Math.max(t._width, t._height);
         t._xscale = s * 100;
         t._yscale = s * 100;
      }
      line(this.idx);
      finishIfDone();
   };
   l.onLoadError = function(t, code)
   {
      results[this.idx].state = "error";
      results[this.idx].code = String(code);
      line(this.idx);
      finishIfDone();
   };
   mcl.addListener(l);
   mcl.loadClip(results[i].path, target);
}

function build(paths)
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboBox(bg, 0, 0, PANEL_W, PANEL_H, 0x000000, 85);
   var title = dboText(panel, "title", 2, PAD, 12, PANEL_W - PAD * 2, 36, dboFmt(F_PLAIN, 26, C_TEXT, 1.0), false);
   title.text = "Map image probe";
   var list = panel.createEmptyMovieClip("list", 3);
   for (var i = 0; i < paths.length && i < 6; i++)
   {
      results.push({path: String(paths[i]), state: "waiting"});
      dboText(list, "r" + i, i + 1, PAD, 56 + i * 44, PANEL_W - PAD * 2, 44, dboFmt(F_MEDIUM, 16, C_TEXT, 0.5), true);
      line(i);
   }
   button(panel, "close", 50, PANEL_W - PAD - 100, PANEL_H - 44, 100, "Close", F_MEDIUM, 18, A_BUTTON_REST, function()
   {
      finishIfDone();
      dboSend("close", []);
      dboClose();
   });
   started = getTimer();
   for (var j = 0; j < results.length; j++)
   {
      probe(j);
   }
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || !(p.paths instanceof Array) || panel != undefined)
   {
      dboLog("map probe: unreadable or repeated payload");
      return;
   }
   if (Number(p.waitMs) > 0)
   {
      waitMs = Number(p.waitMs);
   }
   build(p.paths);
};

_root.onEnterFrame = function()
{
   if (results.length && !sent)
   {
      finishIfDone();
   }
};

var keys = {};
keys.onKeyDown = function()
{
   if (Key.getCode() == 27)
   {
      finishIfDone();
      dboSend("close", []);
      dboClose();
   }
};
Key.addListener(keys);

_root.dboReady = true;
_root.dboVersion = DBO_SWF_VERSION;
dboBoot(function(frame)
{
   dboLog("panel built, version " + DBO_SWF_VERSION + ", skse appeared on frame " + frame);
   dboSend("ready", [frame], frame);
});
