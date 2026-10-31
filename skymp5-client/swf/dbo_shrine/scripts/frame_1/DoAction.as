// A shrine that keeps a rite as a native panel (server supernatural.js, shrinePanel widget 74: the same object
// skymp5-front features/shrinePanel gets). Pray, or Perform the Rite behind its warning, and an offering to the shrine's god
// for its follower; what cannot be done says why in a quiet line instead of a button. Every word comes from the server.
// Keys: dbo:shrinePray, dbo:shrineRite, dbo:shrineConfirm, dbo:shrineCancel, dbo:shrineLeave [nonce] and dbo:shrineOffer
// [nonce, gold]. Escape closes the panel and the router tells the server (its close), as the relay does for the browser.

var DBO_SWF_VERSION = "shrine-1";
var PANEL_W = 820;
var PANEL_H = 560;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
var BODY_TOP = 96;
BODY_H = PANEL_H - 150 - BODY_TOP;
var NO_DATA_CLOSE_MS = 8000;
// Longer than the server's guard after the choice (supernatural.js CHOOSE_GUARD_MS, 1000) plus the way there and back, so a
// Kneel let through is never one the server ignores; the warning comes up held this long (the browser's CONFIRM_HOLD_MS)
var CONFIRM_HOLD_MS = 1200;
// A press nobody answers lets go after this, rather than leaving the panel dead (the browser's PRESS_RELEASE_MS)
var PRESS_RELEASE_MS = 3000;
var STEPS = [[-100, "-100"], [-10, "-10"], [10, "+10"], [100, "+100"]];
var C_RED = 0xB23A3A;
var C_GREEN = 0x7FBF7F;

var panel;
var data = null;
// heldUntil: no press counts before this (the confirm hold, or a press in flight)
var heldUntil = 0;
var gold = 0;
var typing = false;
var boxField = null;
var builtAt = getTimer();

function held()
{
   return getTimer() < heldUntil;
}

// One press per answer
function press(key, args)
{
   if (held())
   {
      return;
   }
   heldUntil = getTimer() + PRESS_RELEASE_MS;
   endTyping();
   dboSound("UIMenuOK");
   dboSend(key, [String(data.nonce)].concat(args != undefined ? args : []));
   draw();
}

function offer()
{
   return data.offer != undefined && data.offer != null ? data.offer : null;
}

function clampGold(n)
{
   var o = offer();
   return o == null ? 0 : Math.max(0, Math.min(Number(o.max) || 0, Math.floor(n)));
}

function takeTyped()
{
   var n = boxField != null ? Number(String(boxField.text).split(",").join("")) : 0;
   gold = n > 0 && !isNaN(n) ? clampGold(n) : 0;
   endTyping();
   dboSound("UIMenuOK");
   draw();
}

function endTyping()
{
   if (typing)
   {
      dboInputEnd();
   }
   typing = false;
   boxField = null;
}

// ---- drawing ----

// A choice: its button when it can be done, else its label and why not in a quiet line
function choice(c, key)
{
   if (c == undefined || c == null)
   {
      return;
   }
   if (c.available == true)
   {
      var row = flowButtons([[String(c.label), function() { press(this.key); }, undefined, held()]]);
      row.btn0.key = key;
      if (c.title != undefined && c.title != "")
      {
         flowHint(String(c.title));
      }
      return;
   }
   flowText(String(c.label), 17, C_SECOND);
   flowHint(String(c.reason));
}

function drawOffer()
{
   var o = offer();
   if (o == null)
   {
      return;
   }
   flowGap(6);
   flowText("An offering to " + o.god, 17, C_SECOND);
   var at = flowNeed(42);
   var c = at.clip.createEmptyMovieClip(at.name, fd());
   c._y = at.y;
   var x = 0;
   if (typing)
   {
      boxField = dboInput(c, "box", 2, 0, 4, 200, 32, dboFmt(F_PLAIN, 18, C_TEXT, 0.5), 6, false);
      boxField.restrict = "0-9";
      boxField.text = gold > 0 ? String(gold) : "";
      button(c, "done", 10, 208, 6, 92, "Done", F_MEDIUM, 17, A_BUTTON_REST, function() { takeTyped(); });
      return;
   }
   var v = dboText(c, "value", 1, 0, 8, 150, 26, dboFmt(F_BOLD, 18, gold > 0 ? C_TEXT : C_SECOND, 0.5), false);
   v.text = gold > 0 ? gold + " gold" : o.min + " to " + o.max + " gold";
   x = 156;
   for (var i = 0; i < STEPS.length; i++)
   {
      var b = button(c, "s" + i, 10 + i, x, 6, 70, STEPS[i][1], F_MEDIUM, 17, A_ROW_REST, function()
      {
         gold = clampGold(gold + this.step);
         dboSound("UIMenuFocus");
         draw();
      });
      b.step = STEPS[i][0];
      x += 76;
   }
   if (dboCanType())
   {
      button(c, "type", 20, x, 6, 90, "Type...", F_MEDIUM, 17, A_ROW_REST, function() { typing = true; dboSound("UIMenuOK"); draw(); });
      x += 98;
   }
   var give = button(c, "give", 21, x, 6, 100, "Offer", F_MEDIUM, 17, A_BUTTON_REST, function() { press("dbo:shrineOffer", [gold]); });
   if (held() || gold <= 0)
   {
      disable(give);
   }
   flowHint("Half goes to the town for the temple; for an hour your prayers are heard more closely.");
}

function drawFoot()
{
   var f = clear("foot", 60);
   var r = dboText(f, "result", 1, PAD, PANEL_H - 112, PANEL_W - PAD * 2, 44, dboFmt(F_MEDIUM, 17, data.resultKind == "refused" ? C_RED : C_GREEN, 0.5), true);
   r.text = data.result != undefined ? String(data.result) : "";
   dboDivider(f, PAD, PANEL_H - 62, PANEL_W - PAD * 2);
   if (data.confirm == undefined || data.confirm == null)
   {
      button(f, "leave", 10, PANEL_W - PAD - 200, PANEL_H - 48, 200, data.leave != undefined && data.leave != "" ? String(data.leave) : "Leave", F_MEDIUM, 20, A_BUTTON_REST, function()
      {
         dboSound("UIMenuCancel");
         endTyping();
         dboSend("dbo:shrineLeave", [String(data.nonce)]);
      });
   }
}

function draw()
{
   var typed = typing && boxField != null ? String(boxField.text) : null;
   boxField = null;
   actions = [];
   focus = -1;
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 16, PANEL_W - PAD * 2, String(data.title));
   dboDivider(h, PAD, 70, PANEL_W - PAD * 2);
   flowStart(panel, 50, PAD, BODY_TOP);
   var cf = data.confirm;
   if (cf != undefined && cf != null)
   {
      flowHeading(String(cf.title));
      flowText(String(cf.warning), 17, C_TEXT);
      flowGap(8);
      var row = flowButtons([[String(cf.confirm), function() { press("dbo:shrineConfirm"); }, C_RED, held()], [String(cf.cancel), function() { press("dbo:shrineCancel"); }, undefined, held()]]);
   }
   else
   {
      choice(data.pray, "dbo:shrinePray");
      choice(data.rite, "dbo:shrineRite");
      drawOffer();
   }
   if (typed != null && boxField != null)
   {
      boxField.text = typed;
   }
   flowShow(0);
   drawFoot();
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 50, 130, 240);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || p.title == undefined)
   {
      dboLog("shrine: unreadable payload");
      return;
   }
   data = p;
   // an answer frees the panel; the warning comes up held, so a double click's second press lands on nothing
   heldUntil = p.confirm != undefined && p.confirm != null ? getTimer() + CONFIRM_HOLD_MS : 0;
   if (offer() == null)
   {
      endTyping();
      gold = 0;
   }
   else
   {
      gold = clampGold(gold);
   }
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (typing)
   {
      if (code == 27)
      {
         dboSound("UIMenuCancel");
         endTyping();
         draw();
      }
      else if (code == 13)
      {
         takeTyped();
      }
      return;
   }
   if (code == 27)
   {
      dboSound("UIMenuCancel");
      dboClose();
      return;
   }
   if (data == null)
   {
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
Key.addListener(keys);

_root.onEnterFrame = function()
{
   if (data == null)
   {
      if (getTimer() - builtAt >= NO_DATA_CLOSE_MS)
      {
         dboLog("shrine: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   // the hold runs out on its own: redraw once so the buttons come back
   if (heldUntil > 0 && !held())
   {
      heldUntil = 0;
      draw();
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
