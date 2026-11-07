// A courier's parcel changing hands as a native panel (server couriers.js, widget 81: the same object skymp5-front
// features/courierHandover gets), in two modes:
//   person  a courier offers the recipient a parcel: into the pack, or to the mailbox at the notice boards, against a
//           countdown; no answer (or Escape) sends it to the mailbox. dbo:courierAnswer [nonce, "take" | "mailbox"].
//   drop    the courier stands at a settlement's drop point with parcels for it: hand each in, or Not now.
//           dbo:courierDropIn [nonce, jobId] | dbo:courierDismiss [nonce].
// One answer per window. Escape closes the panel and the router tells the server (its close), as the relay does.

var DBO_SWF_VERSION = "courier-1";
var PANEL_W = 820;
var PANEL_H = 520;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
var BODY_TOP = 112;
BODY_H = PANEL_H - 90 - BODY_TOP;
var NO_DATA_CLOSE_MS = 8000;
var BAR_W = PANEL_W - PAD * 2;

var panel;
var data = null;
var page = 0;
var sent = false;
var startedAt = 0;
var shownLeft = -1;
var builtAt = getTimer();

function total()
{
   return Math.max(1, Number(data.seconds) || 30);
}

function left()
{
   return Math.max(0, total() - Math.floor((getTimer() - startedAt) / 1000));
}

function once(key, args)
{
   if (sent)
   {
      return;
   }
   sent = true;
   dboSound("UIMenuOK");
   dboSend(key, [String(data.nonce)].concat(args != undefined ? args : []));
   draw();
}

// ---- drawing ----

function drawClock()
{
   var c = clear("clock", 40);
   if (data.mode == "drop")
   {
      return;
   }
   dboBox(c, PAD, PANEL_H - 150, BAR_W, 8, C_STONE, 60);
   dboBox(c, PAD, PANEL_H - 150, Math.round(BAR_W * left() / total()), 8, C_ACCENT, 90);
   var h = dboText(c, "hint", 1, PAD, PANEL_H - 136, BAR_W, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   h.text = sent ? "Answered." : left() + " s. No answer sends it to your mailbox.";
   shownLeft = left();
}

function drawPerson()
{
   flowText("Sent by " + (data.sender != undefined && data.sender != "" ? data.sender : "someone") + ": " + (data.goods != undefined && data.goods != "" ? data.goods : "sealed goods")
      + ". Take it now, or have it left in your mailbox at the notice boards.", 18, C_TEXT);
   flowGap(10);
   flowButtons([["Take it", function() { once("dbo:courierAnswer", ["take"]); }, undefined, sent], ["To my mailbox", function() { once("dbo:courierAnswer", ["mailbox"]); }, undefined, sent]]);
}

function drawDrop()
{
   flowHint("Hand in the sealed parcel here. The goods go to the recipient's mailbox, and you are paid.");
   var jobs = listOf(data.jobs);
   for (var i = 0; i < jobs.length; i++)
   {
      var j = jobs[i];
      var e = flowEntry("For " + j.recipient + ", from " + j.sender + ": " + j.pay + " gold", [["Hand in", function() { once("dbo:courierDropIn", [this.job]); }, undefined, sent]]);
      e.btn0.job = Number(j.id);
   }
   flowGap(6);
   flowButtons([["Not now", function() { once("dbo:courierDismiss"); }, undefined, sent]]);
}

function draw()
{
   actions = [];
   focus = -1;
   var h = clear("head", 20);
   var k = dboText(h, "kicker", 2, PAD, 14, PANEL_W - PAD * 2, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.8), false);
   var drop = data.mode == "drop";
   k.text = drop ? "Courier's drop point" : "A courier's parcel";
   dboTitle(h, "title", 1, PAD, 38, PANEL_W - PAD * 2, drop ? (data.place != undefined && data.place != "" ? String(data.place) : "The drop point")
      : (data.from != undefined && data.from != "" ? data.from : "A courier") + " has a parcel for you");
   dboDivider(h, PAD, 92, PANEL_W - PAD * 2);
   flowStart(panel, 50, PAD, BODY_TOP);
   if (drop)
   {
      drawDrop();
   }
   else
   {
      drawPerson();
   }
   var pages = flowShow(page);
   if (page >= pages)
   {
      page = pages - 1;
      flowShow(page);
   }
   var f = clear("foot", 60);
   flowPager(f, 20, PAD, PANEL_H - 42, pages);
   var p = dboText(f, "pages", 1, PAD + (pages > 1 ? 176 : 0), PANEL_H - 40, 400, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   p.text = pages > 1 ? "Page " + (page + 1) + " of " + pages + " (Left / Right)" : "";
   drawClock();
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
   if (p == null || p.nonce == undefined || p.mode == undefined)
   {
      dboLog("courier: unreadable payload");
      return;
   }
   // a new window (a new nonce or mode) is a new answer and a new countdown
   if (data == null || String(p.nonce) != String(data.nonce) || p.mode != data.mode)
   {
      sent = false;
      startedAt = getTimer();
      page = 0;
   }
   data = p;
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
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
         dboLog("courier: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   // the countdown runs on its own; the server sends the parcel to the mailbox when it ends
   if (data.mode != "drop" && left() != shownLeft)
   {
      drawClock();
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
