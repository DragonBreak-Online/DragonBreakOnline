// The death screen as a native panel (deathScreenService; the browser's constructorComponents/death): the countdown to the
// temple, what dying means, and three choices, each confirmed first. A confirmed choice sends death:choice [key] to the
// service, which tells the server (deathChoice); the server or the countdown's end takes the panel down. Once shown,
// Escape backs out of a confirm and never closes the screen: death has no way out but these.

var DBO_SWF_VERSION = "death-3";
var PANEL_W = 900;
var PANEL_H = 600;
var PAD = 32;
BODY_W = PANEL_W - PAD * 2;
var BODY_TOP = 112;
BODY_H = PANEL_H - 70 - BODY_TOP;
var NO_DATA_CLOSE_MS = 8000;
var C_RED = 0xB23A3A;
// deathScreenService FAILSAFE_GRACE_MS
var SELF_CLOSE_GRACE_S = 15;

// constructorComponents/death CHOICES, word for word
var CHOICES = [
   ["permadeath", "Permanent Death", "Warning: this will kill your character and make them unplayable. Everything will be lootable and your body will remain."],
   ["resurrect", "Resurrect Here", "This will release you at full health where you are standing. This is to be used in the event of a glitch - abuse will result in a ban. All uses are logged, and if you die again to the same player you will be force permanently killed."],
   ["temple", "Temple w/ Full Health", "This will send you to the nearest temple normally, except with full health, skipping the recovery system. This is an optional choice available to all players, with the catch that you cannot return to where you died for one hour."]];

var panel;
var data = null;
var pending = -1;
var sent = "";
var page = 0;
var startedAt = 0;
var shownLeft = -1;
var builtAt = getTimer();

function seconds()
{
   var s = Math.floor(Number(data.seconds));
   return isNaN(s) ? 60 : Math.max(0, s);
}

function left()
{
   return Math.max(0, seconds() - Math.floor((getTimer() - startedAt) / 1000));
}

function choose(i)
{
   dboSound("UIMenuOK");
   pending = i;
   page = 0;
   draw();
}

function confirm()
{
   if (pending < 0 || sent != "")
   {
      return;
   }
   sent = CHOICES[pending][0];
   dboSound("UIMenuOK");
   dboSend("death:choice", [sent]);
   draw();
}

function back()
{
   dboSound("UIMenuCancel");
   pending = -1;
   page = 0;
   draw();
}

// ---- drawing ----

function leadText()
{
   return "You will automatically respawn at the nearest temple in " + left() + " seconds.";
}

function drawTop()
{
   var lead = flowText(leadText(), 20, C_TEXT);
   panel.leadField = lead;
   flowText("If you do nothing, normal respawn rules apply. You were found near death and brought to a temple by a traveler. You only remember vague details about your death, not enough to identify your killer if there was one.", 18, C_SECOND);
   flowText("You will have 1 HP and naturally heal 1 point every 8 hours (even while logged off). A healer can accelerate this to 5 HP every 8 hours.", 18, C_SECOND);
   flowGap(6);
   flowHint("Optionally, you can choose one of the following:");
   var row = [];
   for (var i = 0; i < CHOICES.length; i++)
   {
      row.push([CHOICES[i][1], function() { choose(this.i); }, undefined, sent != ""]);
   }
   var b = flowButtons(row);
   for (var j = 0; j < CHOICES.length; j++)
   {
      b["btn" + j].i = j;
   }
}

function drawConfirm()
{
   flowHeading(CHOICES[pending][1]);
   flowText(CHOICES[pending][2], 18, C_TEXT);
   flowGap(10);
   if (sent != "")
   {
      flowHint("Sent. Waiting for the world to answer.");
      return;
   }
   flowButtons([["Confirm", function() { confirm(); }, C_RED], ["Cancel", function() { back(); }]]);
}

function draw()
{
   actions = [];
   focus = -1;
   panel.leadField = null;
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 30, PANEL_W - PAD * 2, "You have died!");
   dboDivider(h, PAD, 88, PANEL_W - PAD * 2);
   flowStart(panel, 50, PAD, BODY_TOP);
   if (pending >= 0)
   {
      drawConfirm();
   }
   else
   {
      drawTop();
   }
   var pages = flowShow(page);
   if (page >= pages)
   {
      page = pages - 1;
      flowShow(page);
   }
   var f = clear("foot", 60);
   flowPager(f, 20, PAD, PANEL_H - 46, pages);
   var p = dboText(f, "pages", 1, PAD + (pages > 1 ? 176 : 0), PANEL_H - 44, 500, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   p.text = pages > 1 ? "Page " + (page + 1) + " of " + pages + " (Left / Right)" : "";
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
   if (p == null || p.type != "death")
   {
      dboLog("death: unreadable payload");
      return;
   }
   // a new death (a new nonce) is a new countdown and a new choice
   if (data == null || String(p.nonce) != String(data.nonce))
   {
      startedAt = getTimer();
      pending = -1;
      sent = "";
      page = 0;
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
   if (code == 27)
   {
      if (pending >= 0 && sent == "")
      {
         back();
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
   else if ((code == 37 || code == 33) && page > 0)
   {
      dboSound("UIMenuPrevNext");
      page--;
      draw();
   }
   else if ((code == 39 || code == 34) && flow != null && page + 1 < flow.pages.length)
   {
      dboSound("UIMenuPrevNext");
      page++;
      draw();
   }
};
dboKeys(keys);

_root.onEnterFrame = function()
{
   if (data == null)
   {
      if (getTimer() - builtAt >= NO_DATA_CLOSE_MS)
      {
         dboLog("death: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   // the client's failsafe in the panel itself: a hide that cannot reach a paused game never leaves the player here
   if (getTimer() - startedAt >= (seconds() + SELF_CLOSE_GRACE_S) * 1000)
   {
      dboLog("death: " + SELF_CLOSE_GRACE_S + " s past the countdown with no hide, closing");
      delete _root.onEnterFrame;
      dboClose();
      return;
   }
   // the countdown runs on its own; the server respawns the player when it ends
   if (left() != shownLeft)
   {
      shownLeft = left();
      if (panel.leadField != null)
      {
         panel.leadField.text = leadText();
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
