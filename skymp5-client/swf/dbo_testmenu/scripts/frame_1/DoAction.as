// DBO test panel - the hello-world for real Skyrim Scaleform menus (Worker 4, 25 Oct).
//
// It answers three things that could not be settled by reading source, in one dev session:
//   1. does Ui.openCustomMenu work from our client at all (nothing has ever called it);
//   2. does a $-named font from the player's own gfxfontlib.swf bind inside a CUSTOM menu's movie;
//   3. does AS2 -> skse.SendModEvent arrive in our client as on('modEvent').
//
// Everything is built at runtime, so the SWF carries no shapes, no text assets and no fonts. Every AS2 call
// used here was verified present in Skyrim's own or an installed menu SWF before it was written:
//   createEmptyMovieClip, createTextField, TextFormat, setNewTextFormat, onRollOver/onRollOut/onRelease,
//   beginFill/moveTo/lineTo/endFill. (embedFonts is used by NO installed SWF, so the font is set through
//   TextFormat.font alone, which is the vanilla pattern.)
//
// Built headlessly: ../../build-swf.js -> ffdec -xml2swf then -importScript. Source lives in git; the SWF is
// ours, not Bethesda-derived, so it may be tracked.

var DBO_EVENT = "dboUi";
var DBO_SEP = "";
var DBO_RS = "";
var DBO_US = "";
var DBO_SWF_VERSION = "testmenu-1";
var MENU_NAME = "CustomMenu";

// A $-prefixed name is resolved from the player's own gfxfontlib.swf. Nothing is shipped with this file.
var FONT = "$EverywhereFont";

var STAGE_W = 1280;
var PANEL_W = 600;
var PANEL_H = 440;
var PAD = 18;
var ROW_H = 34;
var ROW_TOP = 74;
var MAX_ROWS = 9;

var panel;
var titleTf;
var statusTf;
var rowCount = 0;

// skse is installed into every movie by SKSE's InstallHooks, but never assume it: a missing bridge must
// degrade to a visible message rather than a frozen, modal, game-pausing menu with no way out.
function haveSkse()
{
   return _global.skse != undefined;
}

function log(msg)
{
   if (haveSkse() && _global.skse.Log != undefined)
   {
      _global.skse.Log("[dbo] " + msg);
   }
}

// TWO CHANNELS, because only one of them is proven. skse.Log reaches skse64.log from this movie, so the
// bridge exists, but SendModEvent has never been seen to arrive in the client and nothing else in that
// client subscribes to modEvent. So every message is ALSO appended to _root.dboOut, which the client reads
// with Ui.getString - the same native family that already drives the vanilla HUD. The sequence number lets
// the client handle a message once when both channels deliver it, and the session tells us which works.
//
// The client only ever reads and never writes, so appending can never lose a message to a race.
_root.dboOut = "";
var dboSeq = 0;

function send(key, args, num)
{
   dboSeq++;
   var json = args == undefined ? "" : args;
   // record = seq US key US json RS. The separator goes last, so a half-written record is never read.
   _root.dboOut += dboSeq + DBO_US + key + DBO_US + json + DBO_RS;
   if (haveSkse() && _global.skse.SendModEvent != undefined)
   {
      var s = args == undefined ? key : key + DBO_SEP + args;
      _global.skse.SendModEvent(DBO_EVENT, s, num);
      return true;
   }
   return false;
}

function fmt(size, color, bold)
{
   var f = new TextFormat();
   f.font = FONT;
   f.size = size;
   f.color = color;
   f.bold = bold;
   return f;
}

function makeText(parent, name, depth, x, y, w, h, format)
{
   parent.createTextField(name, depth, x, y, w, h);
   var tf = parent[name];
   tf.selectable = false;
   tf.multiline = true;
   tf.wordWrap = true;
   tf.setNewTextFormat(format);
   return tf;
}

function box(clip, w, h, color, alpha)
{
   clip.beginFill(color, alpha);
   clip.moveTo(0, 0);
   clip.lineTo(w, 0);
   clip.lineTo(w, h);
   clip.lineTo(0, h);
   clip.lineTo(0, 0);
   clip.endFill();
}

function clearRows()
{
   for (var i = 0; i < rowCount; i++)
   {
      panel["row" + i].removeMovieClip();
   }
   rowCount = 0;
}

function addRow(i, label)
{
   var c = panel.createEmptyMovieClip("row" + i, 100 + i);
   c._x = PAD;
   c._y = ROW_TOP + i * ROW_H;
   // A filled rect is what makes a MovieClip hit-testable, so the row is both visible and clickable.
   box(c, PANEL_W - PAD * 2, ROW_H - 4, 0x2E2E2E, 60);
   var tf = makeText(c, "label", 1, 10, 4, PANEL_W - PAD * 2 - 20, ROW_H - 6, fmt(18, 0xE8E0CC, false));
   tf.text = label;
   c.idx = i;
   c._alpha = 75;
   c.onRollOver = function()
   {
      this._alpha = 100;
   };
   c.onRollOut = function()
   {
      this._alpha = 75;
   };
   c.onRelease = function()
   {
      // The index goes in BOTH the string and the number, so the session shows which of the two survives
      // the trip - strArg and numArg are separate fields all the way to on('modEvent').
      if (send("dbo:testRow", "[" + this.idx + "]", this.idx))
      {
         statusTf.text = "sent row " + this.idx;
      }
      else
      {
         statusTf.text = "skse bridge missing - nothing sent";
      }
   };
   rowCount++;
}

function addCloseRow()
{
   var c = panel.createEmptyMovieClip("closeRow", 90);
   c._x = PAD;
   c._y = PANEL_H - 44;
   box(c, PANEL_W - PAD * 2, 30, 0x4A1F1F, 70);
   var tf = makeText(c, "label", 1, 10, 3, PANEL_W - PAD * 2 - 20, 26, fmt(17, 0xFFD9D9, true));
   tf.text = "Close";
   c._alpha = 80;
   c.onRollOver = function()
   {
      this._alpha = 100;
   };
   c.onRollOut = function()
   {
      this._alpha = 80;
   };
   c.onRelease = function()
   {
      send("close", undefined, 0);
      // Close from the SWF as well as telling the client. This menu is modal and PAUSES the game, so the
      // way out must not depend on the client listening, on the server answering, or on input reaching JS.
      if (haveSkse() && _global.skse.CloseMenu != undefined)
      {
         _global.skse.CloseMenu(MENU_NAME);
      }
   };
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   panel._x = (STAGE_W - PANEL_W) / 2;
   panel._y = 140;
   box(panel, PANEL_W, PANEL_H, 0x0B0B0B, 88);

   titleTf = makeText(panel, "titleTf", 1, PAD, 16, PANEL_W - PAD * 2, 34, fmt(26, 0xFFFFFF, true));
   titleTf.text = "DBO test panel";

   // Deliberately states the font being asked for: if this line renders in a different face from the rest
   // of Skyrim, the $-name did not bind in a custom movie and that is the answer to question 2.
   statusTf = makeText(panel, "statusTf", 2, PAD, 50, PANEL_W - PAD * 2, 22, fmt(15, 0x9AA0A6, false));
   statusTf.text = "waiting for the server (font: " + FONT + ")";

   addCloseRow();
}

// ---- the API the client drives through Ui.invoke* / Ui.get* -------------------------------------------------

// The shared wire: the client sends the WHOLE payload as one JSON string, exactly as the CEF widget would
// receive it. This test panel reads only title and rows out of it; a real panel reads its own fields.
// A tiny reader, because the payload here is flat and known; the real panels use swf/lib/dbo.as.
_root.dboData = function(json)
{
   var s = String(json);
   titleTf.text = pick(s, "title", "DBO test panel");
   clearRows();
   var n = 0;
   var at = s.indexOf("\"rows\"");
   if (at >= 0)
   {
      var seg = s.substring(s.indexOf("[", at) + 1, s.indexOf("]", at));
      var parts = seg.split("\",\"");
      for (var i = 0; i < parts.length && n < MAX_ROWS; i++)
      {
         var v = parts[i];
         while (v.charAt(0) == "\"" || v.charAt(0) == " ") { v = v.substring(1); }
         while (v.charAt(v.length - 1) == "\"") { v = v.substring(0, v.length - 1); }
         if (v.length) { addRow(n, v); n++; }
      }
   }
   statusTf.text = n + " row(s) from the server - click one";
   log("payload in: " + s.length + " chars, " + n + " rows");
};

function pick(s, key, dflt)
{
   var at = s.indexOf("\"" + key + "\"");
   if (at < 0) { return dflt; }
   var q = s.indexOf("\"", s.indexOf(":", at) + 1);
   if (q < 0) { return dflt; }
   var e = s.indexOf("\"", q + 1);
   return e < 0 ? dflt : s.substring(q + 1, e);
}

// Read back with Ui.getBool / Ui.getString: a second, pull-based way to tell whether this SWF is the one
// loaded, independent of whether any mod event got through.
_root.dboReady = false;
_root.dboVersion = DBO_SWF_VERSION;

build();
_root.dboReady = true;

// MEASURED 26 Oct: on frame 1 _global.skse DOES NOT EXIST YET. The panel drew itself, so this script ran,
// yet skse.Log produced no line in skse64.log and no mod event reached the client - both of which go through
// _global.skse. SKSE installs that object while the movie is being created (InstallHooks, trampolined into
// the movie-creation path) and our frame-1 actions run first, so calling it here is simply too early.
//
// So wait for it instead of assuming it. An empty clip's onEnterFrame polls until the object appears, then
// announces once and stops. The frame number goes in the log line, because "which frame does skse appear on"
// is the fact nobody has written down and the next menu will need it.
_root.createEmptyMovieClip("dboBoot", 1);
_root.dboBoot.frames = 0;
_root.dboBoot.onEnterFrame = function()
{
   this.frames++;
   if (haveSkse())
   {
      log("panel built, version " + DBO_SWF_VERSION + ", skse appeared on frame " + this.frames);
      send("ready", "[" + this.frames + "]", this.frames);
      delete this.onEnterFrame;
      return;
   }
   // Say so on screen rather than sitting on "waiting for the server" forever. The client closes the menu
   // on its own after READY_TIMEOUT_MS, which is verified to work, so this is a message and not a trap.
   if (this.frames == 120)
   {
      statusTf.text = "no skse bridge after 120 frames - the out path is unavailable";
   }
};
