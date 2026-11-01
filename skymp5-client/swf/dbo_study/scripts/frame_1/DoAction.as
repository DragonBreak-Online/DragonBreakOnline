// Study Magic as a native panel (server schools.js, studyMagic widget: the same object skymp5-front features/studyMagic
// gets), opened at a study shelf, and reused by the server for Priest Studies, a school's next spell and Take an Apprentice.
// Three modes, all the server's: choose (the choices, each after a question; `lead` above them), studying (the meter, what
// this sitting earned, the time left running down on screen) and idle (why not, or Study).
// Keys are the widget's own events: choose [nonce, name, "primary"], start and stop [nonce], close (no arguments).

var DBO_SWF_VERSION = "study-1";
var PANEL_W = 900;
var PANEL_H = 600;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
var NO_DATA_CLOSE_MS = 8000;
var BUSY_TIMEOUT_MS = 8000;
var METER_H = 14;
var C_RED = 0xB23A3A;
var C_GREEN = 0x7FBF7F;

var panel;
var data = null;
var page = 0;
var busy = false;
var busyAt = 0;
// asking: the choice whose question is open, in place of the list
var asking = null;
var nonce = "";
// the time left, as the server last said it, and when
var leftAt = 0;
var shownLeft = -1;
var builtAt = getTimer();

function ev(name)
{
   var fallback = {choose: "dbo:schoolChoose", start: "dbo:studyStart", stop: "dbo:studyStop", close: "dbo:studyClose"};
   return data != null && data.events != undefined && data.events[name] != undefined ? String(data.events[name]) : fallback[name];
}

function isBusy()
{
   return busy && getTimer() - busyAt < BUSY_TIMEOUT_MS;
}

function act(name, args)
{
   if (isBusy())
   {
      return;
   }
   busy = true;
   busyAt = getTimer();
   dboSound("UIMenuOK");
   dboSend(ev(name), [String(data.nonce)].concat(args));
   draw();
}

function closeMenu()
{
   dboSound("UIMenuCancel");
   dboSend(ev("close"), []);
   dboClose();
}

function clock(seconds)
{
   var s = Math.max(0, Math.floor(seconds));
   var m = s % 60;
   return Math.floor(s / 60) + ":" + (m < 10 ? "0" : "") + m;
}

// The time left runs down on screen while studying; the server keeps the real count
function leftNow()
{
   var total = Number(data.leftSeconds) || 0;
   return data.mode == "studying" ? Math.max(0, total - (getTimer() - leftAt) / 1000) : total;
}

// ---- drawing ----

function drawChoose()
{
   if (asking != null)
   {
      flowHeading(String(asking.name));
      flowText(String(asking.confirm), 18, C_TEXT);
      flowButtons([["Choose", function() { act("choose", [String(asking.name), "primary"]); }, undefined, isBusy()], ["Not yet", function() { dboSound("UIMenuCancel"); asking = null; draw(); }]]);
      return;
   }
   flowText(data.lead != undefined && data.lead != "" ? String(data.lead) : "Before the books can teach you, choose the school you will give yourself to.", 18, C_SECOND);
   var choices = listOf(data.choices);
   for (var i = 0; i < choices.length; i++)
   {
      var e = flowEntry(String(choices[i].name), [["Choose...", function() { dboSound("UIMenuOK"); asking = this._parent.choice; draw(); }, undefined, isBusy()]], String(choices[i].blurb));
      e.choice = choices[i];
   }
}

function drawDesk()
{
   flowHeading(String(data.school));
   flowText(data.rank + "  ·  " + data.level, 18, C_TEXT);
   var at = flowNeed(METER_H + 18);
   var m = at.clip.createEmptyMovieClip("meter", fd());
   m._y = at.y + 4;
   var fill = Math.max(0, Math.min(1, Number(data.fill) || 0));
   dboBox(m, 0, 0, BODY_W, METER_H, 0xFFFFFF, 10);
   dboBox(m, 0, 0, Math.round(BODY_W * fill), METER_H, C_ACCENT, 70);
   m.fill = fill;
   if (data.mode == "studying")
   {
      flowText("You turn the pages. Stay at the books; walking away ends the sitting.", 17, C_TEXT);
      flowText("This sitting: " + Math.round((Number(data.gained) || 0) * 10) / 10 + " units of study", 17, C_TEXT);
      flowText("Time left for study: " + clock(leftNow()), 17, C_TEXT);
   }
   else if (data.whyNot != undefined && data.whyNot != "")
   {
      flowText(String(data.whyNot), 17, C_SECOND);
   }
   else
   {
      flowText("Time left for study: " + clock(leftNow()), 17, C_TEXT);
   }
}

function drawFoot(pages)
{
   var f = clear("foot", 60);
   var r = dboText(f, "result", 1, PAD, PANEL_H - 112, PANEL_W - PAD * 2, 44, dboFmt(F_MEDIUM, 17, data.resultKind == "refused" ? C_RED : data.resultKind == "ok" ? C_GREEN : C_SECOND, 0.5), true);
   r.text = data.result != undefined ? String(data.result) : "";
   dboDivider(f, PAD, PANEL_H - 62, PANEL_W - PAD * 2);
   var h = dboText(f, "hint", 2, PAD, PANEL_H - 46, 300, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   h.text = pages > 1 ? "Page " + (page + 1) + " of " + pages : "";
   var x = PANEL_W - PAD - 110;
   button(f, "leave", 10, x, PANEL_H - 48, 110, "Leave", F_MEDIUM, 20, A_BUTTON_REST, function() { closeMenu(); });
   if (data.mode == "studying")
   {
      var s = button(f, "stop", 11, x - 210, PANEL_H - 48, 200, "Close the books", F_MEDIUM, 20, A_BUTTON_REST, function() { act("stop", []); });
      if (isBusy())
      {
         disable(s);
      }
   }
   else if (data.mode == "idle" && (data.whyNot == undefined || data.whyNot == ""))
   {
      var b = button(f, "start", 11, x - 130, PANEL_H - 48, 120, "Study", F_MEDIUM, 20, A_BUTTON_REST, function() { act("start", []); });
      if (isBusy())
      {
         disable(b);
      }
   }
}

function draw()
{
   actions = [];
   focus = -1;
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 16, PANEL_W - PAD * 2, data.title != undefined && data.title != "" ? String(data.title) : "Study Magic");
   dboDivider(h, PAD, 70, PANEL_W - PAD * 2);
   BODY_H = PANEL_H - 118 - 84;
   flowStart(panel, 50, PAD, 84);
   if (data.mode == "choose")
   {
      drawChoose();
   }
   else
   {
      drawDesk();
   }
   var pages = flowShow(page);
   if (page >= pages)
   {
      page = pages - 1;
      flowShow(page);
   }
   drawFoot(pages);
   shownLeft = Math.floor(leftNow());
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 50, 150, 280);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || p.mode == undefined)
   {
      dboLog("study: unreadable payload");
      return;
   }
   // A redraw in place (the study tick) ends a change in flight; a new nonce (a fresh open, the answer to a click) also
   // closes an open question
   if (String(p.nonce) != nonce)
   {
      asking = null;
      page = 0;
   }
   nonce = String(p.nonce);
   data = p;
   busy = false;
   leftAt = getTimer();
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (code == 27)
   {
      if (asking != null)
      {
         dboSound("UIMenuCancel");
         asking = null;
         draw();
         return;
      }
      closeMenu();
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
Key.addListener(keys);

_root.onEnterFrame = function()
{
   if (data == null)
   {
      if (getTimer() - builtAt >= NO_DATA_CLOSE_MS)
      {
         dboLog("study: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   // a change that never came back frees the buttons; the clock is drawn again each second it turns
   if ((busy && !isBusy()) || (data.mode == "studying" && Math.floor(leftNow()) != shownLeft))
   {
      busy = isBusy();
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
