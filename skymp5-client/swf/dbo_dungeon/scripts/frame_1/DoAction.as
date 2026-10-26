// The dungeon gate as a native panel: a port of skymp5-front features/dungeonGate, same messages and words.
// The server (dungeons.js) decides who may claim and closes the gate after a claim or a turn back; this panel only asks.

var DBO_SWF_VERSION = "dungeon-1";
var STAGE_W = 1280;
var PANEL_W = 640;
var PAD = 28;
var ROW_H = 50;
var NO_DATA_CLOSE_MS = 8000;

var panel;
var data = null;
var nonce = "";
var builtAt = getTimer();

function claim(id)
{
   dboSound("UIMenuOK");
   dboSend("dbo:dungeonClaim", [nonce, id]);
   dboClose();
}

// Closes from the SWF too: the client may not be listening while the menu is open
function turnBack()
{
   dboSound("UIMenuCancel");
   dboSend("dbo:dungeonCancel", [nonce]);
   dboClose();
}

function hintText()
{
   if (data.canClaim == true)
   {
      return "Claim it for " + data.minutes + " minutes. Nobody else gets in while you are inside; afterwards it rests " + data.cooldownMinutes + " minutes for you.";
   }
   return data.reason != undefined && data.reason != "" ? String(data.reason) : "You cannot enter right now.";
}

function draw()
{
   actions = [];
   focus = -1;
   var b = clear("body", 20);
   var kind = dboText(b, "kind", 1, PAD, 20, PANEL_W - PAD * 2, 26, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8), false);
   kind.text = data.kind == undefined ? "" : String(data.kind);
   var title = dboText(b, "title", 2, PAD, 44, PANEL_W - PAD * 2, 40, dboFmt(F_PLAIN, 30, C_TEXT, 1.0), false);
   title.text = String(data.name);
   dboRule(b, PAD, 92, PANEL_W - PAD * 2);
   var hint = dboText(b, "hint", 3, PAD, 102, PANEL_W - PAD * 2, 56, dboFmt(F_MEDIUM, 20, C_TEXT, 0.8), true);
   hint.text = hintText();
   var party = data.party instanceof Array ? data.party : [];
   var pt = dboText(b, "party", 4, PAD, 162, PANEL_W - PAD * 2, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   pt.text = party.length ? "Entering with you: " + party.join(", ") : "You go in alone. Use /party invite to bring others.";

   var y = 196;
   var diffs = data.canClaim == true && data.difficulties instanceof Array ? data.difficulties : [];
   for (var i = 0; i < diffs.length && i < 9; i++)
   {
      var d = diffs[i];
      var c = b.createEmptyMovieClip("d" + i, 10 + i);
      c._x = PAD;
      c._y = y;
      dboBox(c, 0, 0, PANEL_W - PAD * 2, ROW_H - 4, 0x000000, 1);
      var kt = dboText(c, "key", 1, 0, 4, 26, 26, dboFmt(F_BOLD, 20, C_SECOND, 0), false);
      kt.text = String(i + 1);
      var lt = dboText(c, "label", 2, 30, 0, PANEL_W - PAD * 2 - 30, 28, dboFmt(F_MEDIUM, 22, C_TEXT, 0.8), false);
      lt.text = String(d.label);
      var st = dboText(c, "blurb", 3, 30, 26, PANEL_W - PAD * 2 - 30, 22, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
      st.text = d.blurb == undefined ? "" : String(d.blurb);
      c.rest = A_ROW_REST;
      c._alpha = A_ROW_REST;
      c.diffId = String(d.id);
      c.rowIndex = i;
      c.idx = actions.length;
      actions.push(c);
      c.onPick = function()
      {
         claim(this.diffId);
      };
      c.onRollOver = function()
      {
         setFocus(this.idx);
      };
      c.onRollOut = function()
      {
         this._alpha = this.rest;
      };
      c.onRelease = function()
      {
         this.onPick();
      };
      y += ROW_H;
   }
   y += 8;
   dboRule(b, PAD, y, PANEL_W - PAD * 2);
   y += 12;
   button(b, "back", 40, PAD, y, 160, "Turn back", F_MEDIUM, 22, A_BUTTON_REST, function()
   {
      turnBack();
   });
   var keysTf = dboText(b, "keys", 41, PAD + 170, y + 6, PANEL_W - PAD * 2 - 170, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8, "right"), false);
   keysTf.text = diffs.length ? "Click a difficulty or press 1-" + diffs.length + ". Escape to turn back." : "Escape to turn back.";
   var h = y + 32 + PAD;
   panel.bg.clear();
   dboBox(panel.bg, 0, 0, PANEL_W, h, 0x000000, 80);
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

// The same nonce again redraws in place; a new nonce is a new gate
_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || p.name == undefined)
   {
      dboLog("dungeon: unreadable payload");
      return;
   }
   data = p;
   nonce = String(p.nonce);
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   dboLog("dungeon key " + code);
   if (code == 27)
   {
      turnBack();
      return;
   }
   if (data == null)
   {
      return;
   }
   if (code >= 49 && code <= 57)
   {
      for (var i = 0; i < actions.length; i++)
      {
         if (actions[i].rowIndex == code - 49)
         {
            actions[i].onPick();
            return;
         }
      }
   }
   else if ((code == 38 || code == 87) && actions.length)
   {
      setFocus(focus <= 0 ? actions.length - 1 : focus - 1);
   }
   else if ((code == 40 || code == 83) && actions.length)
   {
      setFocus(focus < 0 || focus >= actions.length - 1 ? 0 : focus + 1);
   }
   else if ((code == 13 || code == 69) && focus >= 0)
   {
      actions[focus].onPick();
   }
};
Key.addListener(keys);

_root.onEnterFrame = function()
{
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("dungeon: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
