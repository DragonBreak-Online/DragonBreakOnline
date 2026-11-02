// The kick screen as a native panel (kickService; the browser's form widget 28): why the server let the player go, the
// seconds until the game closes, and Quit game. Quit sends kick:quit to the service, which closes the game. The service
// closes it on its own clock; the panel counts down from the seconds it is given. Once shown, Escape does nothing: the
// game closes either way.

var DBO_SWF_VERSION = "kick-2";
var PANEL_W = 760;
var PANEL_H = 360;
var PAD = 32;
BODY_W = PANEL_W - PAD * 2;
var BODY_TOP = 104;
BODY_H = PANEL_H - 40 - BODY_TOP;
var NO_DATA_CLOSE_MS = 8000;

var panel;
var data = null;
var startedAt = 0;
var shownLeft = -1;
var quitSent = false;
var builtAt = getTimer();

function left()
{
   var s = Math.floor(Number(data.seconds));
   return Math.max(0, (isNaN(s) ? 10 : s) - Math.floor((getTimer() - startedAt) / 1000));
}

function closingText()
{
   var t = data.strings != undefined && data.strings.closing != undefined ? String(data.strings.closing) : "The game will close in {s} s. Restart it to play again.";
   var at = t.indexOf("{s}");
   return at < 0 ? t : t.substring(0, at) + left() + t.substring(at + 3);
}

function quit()
{
   if (quitSent)
   {
      return;
   }
   quitSent = true;
   dboSound("UIMenuOK");
   dboSend("kick:quit", []);
}

function draw()
{
   actions = [];
   focus = -1;
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 30, PANEL_W - PAD * 2, data.strings != undefined && data.strings.disconnected != undefined ? String(data.strings.disconnected) : "Disconnected");
   dboDivider(h, PAD, 84, PANEL_W - PAD * 2);
   flowStart(panel, 50, PAD, BODY_TOP);
   if (data.reason != undefined && String(data.reason) != "")
   {
      flowText(String(data.reason), 20, C_TEXT);
   }
   panel.closingField = flowText(closingText(), 18, C_SECOND);
   flowGap(10);
   flowButtons([[data.strings != undefined && data.strings.quit != undefined ? String(data.strings.quit) : "Quit game", function() { quit(); }]]);
   flowShow(0);
   shownLeft = left();
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.type != "kick")
   {
      dboLog("kick: unreadable payload");
      return;
   }
   if (data == null)
   {
      startedAt = getTimer();
   }
   data = p;
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   // before the first payload nothing is shown, so Escape closes as on every panel (native-escape-harness)
   if (data == null)
   {
      if (code == 27)
      {
         dboClose();
      }
      return;
   }
   if (code == 38 && actions.length)
   {
      setFocus(focus <= 0 ? actions.length - 1 : focus - 1);
   }
   else if (code == 40 && actions.length)
   {
      setFocus(focus < 0 || focus >= actions.length - 1 ? 0 : focus + 1);
   }
   else if (code == 13 && focus >= 0 && actions[focus].disabled != true)
   {
      actions[focus].onPick();
   }
};
dboKeys(keys);

_root.onEnterFrame = function()
{
   if (data == null)
   {
      if (getTimer() - builtAt >= NO_DATA_CLOSE_MS)
      {
         dboLog("kick: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   if (left() != shownLeft)
   {
      shownLeft = left();
      if (panel.closingField != null)
      {
         panel.closingField.text = closingText();
      }
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
