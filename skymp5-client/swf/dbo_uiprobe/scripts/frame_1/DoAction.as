// Probe: two things a branded native look depends on, settled in the game rather than assumed (Leader, 26 Oct).
// 1. Typing in a CustomMenu: an input field, the focus and skse.AllowTextInput, as SkyUI's search box does (lib dboInput).
//    Nat types and presses Send; what arrives is what the field held.
// 2. Filters: a glow and a drop shadow on boxes beside a plain one. Whether Scaleform kept them is read back here, and
//    whether they draw is Nat's eye.
// Every answer goes as dbo:uiProbe [results]; the server logs it.

var DBO_SWF_VERSION = "uiprobe-1";
var PANEL_W = 900;
var PANEL_H = 560;
var PAD = 28;

var panel;
var box;
var results = {};

function filterTest(clip, kind)
{
   var f = null;
   try
   {
      if (kind == "glow" && flash.filters.GlowFilter != undefined)
      {
         f = new flash.filters.GlowFilter(0x8FD3D0, 0.9, 16, 16, 3, 2);
      }
      else if (kind == "shadow" && flash.filters.DropShadowFilter != undefined)
      {
         f = new flash.filters.DropShadowFilter(6, 45, 0x000000, 0.9, 10, 10, 2, 2);
      }
   }
   catch (e)
   {
      f = null;
   }
   if (f == null)
   {
      return "no " + kind + " class";
   }
   clip.filters = [f];
   var back = clip.filters;
   return back != undefined && back.length == 1 ? "kept" : "set but not kept";
}

function swatch(name, depth, x, label, kind)
{
   var c = panel.createEmptyMovieClip(name, depth);
   c._x = x;
   c._y = 300;
   dboBox(c, 0, 0, 160, 90, 0x16383D, 100);
   var t = dboText(c, "label", 1, 0, 100, 160, 24, dboFmt(F_MEDIUM, 18, C_TEXT, 0.5, "center"), false);
   t.text = label;
   return kind == "" ? "plain" : filterTest(c, kind);
}

function send()
{
   results.typed = box.text;
   results.typedLength = box.text.length;
   dboSend("dbo:uiProbe", [results]);
   dboSound("UIMenuOK");
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboBox(bg, 0, 0, PANEL_W, PANEL_H, 0x000000, 85);
   var title = dboText(panel, "title", 2, PAD, 16, PANEL_W - PAD * 2, 36, dboFmt(F_PLAIN, 28, C_TEXT, 1.0), false);
   title.text = "UI probe: typing and filters";
   var how = dboText(panel, "how", 3, PAD, 60, PANEL_W - PAD * 2, 50, dboFmt(F_MEDIUM, 18, C_SECOND, 0.5), true);
   how.text = "Click the box and type a few words (letters, a space, a number), then press Send. Then say which of the three boxes below glow or cast a shadow.";
   results.canType = dboCanType();
   box = dboInput(panel, "box", 4, PAD, 120, PANEL_W - PAD * 2, 40, dboFmt(F_PLAIN, 24, C_TEXT, 0.5), 80, false);
   button(panel, "send", 5, PAD, 172, 140, "Send", F_MEDIUM, 22, A_BUTTON_REST, function()
   {
      send();
   });
   results.plain = swatch("s0", 20, PAD + 40, "Plain", "");
   results.glow = swatch("s1", 21, PAD + 340, "Glow", "glow");
   results.shadow = swatch("s2", 22, PAD + 640, "Drop shadow", "shadow");
   button(panel, "close", 30, PANEL_W - PAD - 110, PANEL_H - 50, 110, "Close", F_MEDIUM, 22, A_BUTTON_REST, function()
   {
      dboInputEnd();
      dboSend("close", []);
      dboClose();
   });
}

var keys = {};
keys.onKeyDown = function()
{
   if (Key.getCode() == 27)
   {
      dboInputEnd();
      dboSend("close", []);
      dboClose();
   }
};
Key.addListener(keys);

_root.dboData = function(json)
{
};

_root.dboReady = true;
_root.dboVersion = DBO_SWF_VERSION;
build();
dboBoot(function(frame)
{
   dboLog("panel built, version " + DBO_SWF_VERSION + ", skse appeared on frame " + frame);
   dboSend("ready", [frame], frame);
   // the filter answers are known at once; the typed text follows on Send
   results.canType = dboCanType();
   dboSend("dbo:uiProbe", [results]);
});
