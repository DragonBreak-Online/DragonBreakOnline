// The name prompt as a native panel (server naming.js, widget 68: the same object skymp5-front features/namePrompt gets): a
// character that came out of creation without a name chooses one. One text box, typed in place (dboInput, SkyUI's way),
// and "Take this name"; Enter takes it too. The name goes as events.choose [nonce, name]; the server checks it and answers
// by sending the panel again with the reason (a new nonce) or by closing it. Escape closes (the plain close, as the
// browser's Escape: the server asks again a minute later). A game that cannot type is pointed at /name in the chat and
// offered the browser panel (dbo:nameBrowser [nonce]).

var DBO_SWF_VERSION = "naming-1";
var PANEL_W = 780;
var PANEL_H = 440;
var PAD = 32;
var NO_DATA_CLOSE_MS = 8000;
var C_RED = 0xB23A3A;

var panel;
var data = null;
var box = null;
var sentNonce = "";
var builtAt = getTimer();

function maxLength()
{
   return Math.max(2, Number(data.maxLength) > 0 ? Number(data.maxLength) : 30);
}

function maxWords()
{
   return Math.max(1, Number(data.maxWords) > 0 ? Number(data.maxWords) : 3);
}

// What is typed, its spaces folded as the browser's does
function typed()
{
   var raw = box != null ? String(box.text) : "";
   var parts = raw.split("\r").join(" ").split("\n").join(" ").split(" ");
   var words = [];
   for (var i = 0; i < parts.length; i++)
   {
      if (parts[i] != "")
      {
         words.push(parts[i]);
      }
   }
   return words.join(" ");
}

function sent()
{
   return data != null && sentNonce == String(data.nonce);
}

function submit()
{
   var name = typed();
   if (data == null || sent() || name.length < 2)
   {
      return;
   }
   sentNonce = String(data.nonce);
   dboSound("UIMenuOK");
   var key = data.events != undefined && data.events.choose != undefined && data.events.choose != "" ? String(data.events.choose) : "dbo:nameChoose";
   dboSend(key, [String(data.nonce), name]);
   drawState();
}

function closeMenu()
{
   dboSound("UIMenuCancel");
   dboInputEnd();
   dboSend("close", []);
   dboClose();
}

function toBrowser()
{
   dboSound("UIMenuOK");
   dboSend("dbo:nameBrowser", [String(data.nonce)]);
}

// The button, the error line and the hint follow what is typed and whether the name is out for checking
function drawState()
{
   var f = clear("state", 40);
   var err = dboText(f, "error", 1, PAD, 288, PANEL_W - PAD * 2, 26, dboFmt(F_MEDIUM, 18, C_RED, 0.5), false);
   err.text = data.error != undefined && data.error != "" && !sent() ? String(data.error) : "";
   if (!dboCanType())
   {
      button(f, "browser", 10, PAD, 330, 260, "In the browser...", F_MEDIUM, 20, A_BUTTON_REST, function() { toBrowser(); });
   }
   else
   {
      var b = button(f, "take", 10, PAD, 330, 280, sent() ? "Checking the name..." : "Take this name", F_MEDIUM, 20, A_BUTTON_REST, function() { submit(); });
      if (sent() || typed().length < 2)
      {
         disable(b);
      }
   }
   var h = dboText(f, "hint", 2, PAD, PANEL_H - 50, PANEL_W - PAD * 2, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   h.text = "Names are unique across the realm. You leave the Realm once named.";
}

function draw()
{
   actions = [];
   focus = -1;
   var t = clear("text", 20);
   var k = dboText(t, "kicker", 1, PAD, 22, PANEL_W - PAD * 2, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 2), false);
   k.text = "BEFORE YOU SET OUT";
   dboTitle(t, "title", 2, PAD, 48, PANEL_W - PAD * 2, "Name your character");
   dboDivider(t, PAD, 112, PANEL_W - PAD * 2);
   var p = dboText(t, "body", 3, PAD, 128, PANEL_W - PAD * 2, 90, dboFmt(F_MEDIUM, 19, C_TEXT, 0.5), true);
   p.text = "Your character came out of creation without a name. Choose the one they will carry in Tamriel: up to " + maxWords() +
      " words of letters, apostrophes and hyphens, with a capital only at the start of a word.";
   if (box == null)
   {
      if (dboCanType())
      {
         box = dboInput(panel, "box", 30, PAD, 230, PANEL_W - PAD * 2, 40, dboFmt(F_PLAIN, 22, C_TEXT, 0.5), maxLength(), false);
         box.onChanged = function() { drawState(); };
      }
      else
      {
         var n = dboText(panel, "notype", 30, PAD, 230, PANEL_W - PAD * 2, 52, dboFmt(F_MEDIUM, 18, C_SECOND, 0.5), true);
         n.text = "This game cannot take typed input in a panel: type /name and the name in the chat (for example /name Aela Brightwater), or open the browser panel.";
      }
   }
   else
   {
      box.maxChars = maxLength();
   }
   drawState();
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 40, 120, 220);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined)
   {
      dboLog("naming: unreadable payload");
      return;
   }
   // a refused name comes back with a new nonce: the box keeps what was typed so it can be mended
   data = p;
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (code == 27)
   {
      closeMenu();
      return;
   }
   if (data == null)
   {
      return;
   }
   if (code == 13)
   {
      if (dboCanType())
      {
         submit();
      }
      else if (focus >= 0 && actions[focus].disabled != true)
      {
         actions[focus].onPick();
      }
   }
};
dboKeys(keys);

_root.onEnterFrame = function()
{
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("naming: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
      delete _root.onEnterFrame;
      dboClose();
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
