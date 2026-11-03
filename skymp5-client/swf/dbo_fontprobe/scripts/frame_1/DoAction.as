// Probe: can a native panel draw a font embedded in its own swf (Leader, 3 Nov: no panel uses the web's OFL faces until
// this is settled in the game). Two DefineFont3 tags are built in from swf/fonts (fonts.txt): "DboBody" (Barlow Condensed
// Medium, a static TTF) and "DboTitle" (Big Shoulders Display, a variable TTF, to learn whether FFDec's import of one
// draws at all). Each line below names the font it asks for, beside Skyrim's own $EverywhereFont for reference.
// What the engine measured goes as dbo:fontProbe [results]; whether each line looks like its font is Nat's eye.

var DBO_SWF_VERSION = "fontprobe-1";
var PANEL_W = 1000;
var PANEL_H = 600;
var PAD = 28;
var SAMPLE = "Hold Notices  0123456789  Trade with Lydia";
// [label, font, embedFonts]
var LINES = [["Skyrim's $EverywhereFont (reference)", F_PLAIN, false], ["Skyrim's $EverywhereMediumFont (reference)", F_MEDIUM, false],
   ["DboBody, embedded (Barlow Condensed)", "DboBody", true], ["DboBody, not marked embedded", "DboBody", false],
   ["DboTitle, embedded (Big Shoulders, variable)", "DboTitle", true]];

var panel;
var results = {version: DBO_SWF_VERSION, lines: []};

function line(i, y)
{
   var l = LINES[i];
   var cap = dboText(panel, "cap" + i, 10 + i * 2, PAD, y, PANEL_W - PAD * 2, 22, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   cap.text = (i + 1) + ". " + l[0];
   var t = dboText(panel, "s" + i, 11 + i * 2, PAD, y + 22, PANEL_W - PAD * 2, 50, dboFmt(l[1], 34, C_TEXT, 0.5), false);
   t.embedFonts = l[2];
   t.text = SAMPLE;
   return t;
}

// The engine's own measure of each line: a font it could not find draws nothing, or draws in a fallback face
function measure()
{
   results.lines = [];
   for (var i = 0; i < LINES.length; i++)
   {
      var t = panel["s" + i];
      results.lines.push({font: LINES[i][1], embed: LINES[i][2], w: Math.round(t.textWidth), h: Math.round(t.textHeight)});
   }
   return results;
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboBox(bg, 0, 0, PANEL_W, PANEL_H, 0x000000, 88);
   var title = dboText(panel, "title", 2, PAD, 16, PANEL_W - PAD * 2, 36, dboFmt(F_PLAIN, 28, C_TEXT, 1.0), false);
   title.text = "Font probe: fonts built into the panel";
   var how = dboText(panel, "how", 3, PAD, 56, PANEL_W - PAD * 2, 26, dboFmt(F_MEDIUM, 17, C_SECOND, 0.5), false);
   how.text = "Say which numbered lines show text, and whether 3 and 5 look different from 1 and 2.";
   for (var i = 0; i < LINES.length; i++)
   {
      line(i, 96 + i * 82);
   }
   button(panel, "close", 30, PANEL_W - PAD - 110, PANEL_H - 50, 110, "Close", F_MEDIUM, 22, A_BUTTON_REST, function()
   {
      dboSend("close", []);
      dboClose();
   });
}

var keys = {};
keys.onKeyDown = function()
{
   if (dboKey() == 27)
   {
      dboSend("close", []);
      dboClose();
   }
};
dboKeys(keys);

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
   dboSend("dbo:fontProbe", [measure()]);
});
