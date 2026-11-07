// The Key Ring as a native panel (server keyring.js, widget 91: the same object skymp5-front features/keyRing gets). A key
// offered to you, your keys by property, and your own properties with every copy out. A key is given to a player beside
// you, picked from a row of their names; an owner cuts keys and takes single copies back. Actions go out as the browser's
// dbo:keyRing* events with the window's nonce, and the server answers by sending the panel again.

var DBO_SWF_VERSION = "keyring-1";
var PANEL_W = 900;
var PANEL_H = 640;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
var BODY_TOP = 104;
BODY_H = PANEL_H - 118 - BODY_TOP;
var NO_DATA_CLOSE_MS = 8000;
var BUSY_TIMEOUT_MS = 8000;
var C_RED = 0xB23A3A;
var C_GREEN = 0x7FBF7F;

var panel;
var data = null;
var page = 0;
var busyAt = 0;
// picking: what waits for a player to be picked, "give:<key name>" or "cut:<lock ref>"
var picking = "";
var builtAt = getTimer();

function busy()
{
   return busyAt > 0 && getTimer() - busyAt < BUSY_TIMEOUT_MS;
}

// One action in flight at a time, as the browser's: the server's answer (a new payload) ends it
function act(key, args)
{
   if (busy())
   {
      return;
   }
   busyAt = getTimer();
   picking = "";
   dboSound("UIMenuOK");
   dboSend(key, [String(data.nonce)].concat(args != undefined ? args : []));
   draw();
}

function closeMenu()
{
   dboSound("UIMenuCancel");
   dboSend("dbo:keyRingClose", []);
   dboClose();
}

function pick(what)
{
   picking = picking == what ? "" : what;
   dboSound("UIMenuOK");
   draw();
}

// Your keys grouped by property, in the order they come
function groups()
{
   var out = [];
   var keys = listOf(data.keys);
   for (var i = 0; i < keys.length; i++)
   {
      var place = keys[i].place != undefined && keys[i].place != "" ? String(keys[i].place) : "Other keys";
      var g = null;
      for (var j = 0; j < out.length; j++)
      {
         if (out[j].place == place)
         {
            g = out[j];
         }
      }
      if (g == null)
      {
         g = {place: place, keys: []};
         out.push(g);
      }
      g.keys.push(keys[i]);
   }
   return out;
}

// The players beside you as buttons, and Cancel; onPick gets the actor as this.actor
function pickRow(onPick)
{
   var near = listOf(data.near);
   if (!near.length)
   {
      flowHint("Nobody stands beside you.");
   }
   var b = [];
   for (var i = 0; i < near.length; i++)
   {
      b.push([String(near[i].name), onPick, undefined, busy()]);
   }
   b.push(["Cancel", function() { picking = ""; dboSound("UIMenuCancel"); draw(); }]);
   var row = flowButtons(b);
   for (var j = 0; j < near.length; j++)
   {
      row["btn" + j].actor = Number(near[j].actor);
   }
}

// ---- the page ----

function drawOffer()
{
   var o = data.offer;
   if (o == undefined || o == null)
   {
      return;
   }
   flowEntry(o.from + " offers you " + o.key + ".", [["Accept", function() { act("dbo:keyRingAnswer", [true]); }, undefined, busy()],
      ["Decline", function() { act("dbo:keyRingAnswer", [false]); }, undefined, busy()]]);
   flowGap(6);
}

function drawKeys()
{
   flowHeading("Your keys");
   var keys = listOf(data.keys);
   if (!keys.length)
   {
      flowHint("No keys. The owner of a property can cut one for you.");
   }
   var gs = groups();
   for (var i = 0; i < gs.length; i++)
   {
      flowText(gs[i].place, 17, C_SECOND);
      for (var j = 0; j < gs[i].keys.length; j++)
      {
         var k = gs[i].keys[j];
         var e = flowEntry(String(k.name), [["Give", function() { pick("give:" + this.key); }, undefined, busy()]], k.opens == true ? "Opens" : "Opens nothing");
         e.btn0.key = String(k.name);
         if (k.opens != true)
         {
            e.sub.textColor = C_RED;
         }
         if (picking == "give:" + k.name)
         {
            pickRow(function() { act("dbo:keyRingGive", [this.keyName, this.actor]); });
            var row = flowLast();
            for (var q = 0; row["btn" + q] != undefined; q++)
            {
               row["btn" + q].keyName = String(k.name);
            }
         }
      }
   }
}

function drawOwned()
{
   var owned = listOf(data.owned);
   if (!owned.length)
   {
      return;
   }
   flowHeading("Your properties");
   for (var i = 0; i < owned.length; i++)
   {
      var o = owned[i];
      var e = flowEntry(String(o.place), [["Cut a key", function() { act("dbo:keyRingCut", [this.ref, 0]); }, undefined, busy()],
         ["Cut for...", function() { pick("cut:" + this.ref); }, undefined, busy()]]);
      e.btn0.ref = Number(o.ref);
      e.btn1.ref = Number(o.ref);
      if (picking == "cut:" + o.ref)
      {
         pickRow(function() { act("dbo:keyRingCut", [this.ref, this.actor]); });
         var row = flowLast();
         for (var q = 0; row["btn" + q] != undefined; q++)
         {
            row["btn" + q].ref = Number(o.ref);
         }
      }
      var copies = listOf(o.copies);
      if (!copies.length)
      {
         flowHint("No keys are out.");
      }
      for (var j = 0; j < copies.length; j++)
      {
         var c = flowEntry(String(copies[j].name), [["Take back", function() { act("dbo:keyRingTake", [this.ref, this.key]); }, undefined, busy()]],
            copies[j].holder != undefined && copies[j].holder != "" ? "Held by " + copies[j].holder : "Holder unknown");
         c.btn0.ref = Number(o.ref);
         c.btn0.key = String(copies[j].name);
      }
   }
}

// The last block the flow drew, so a row's buttons can carry their own arguments
function flowLast()
{
   var p = flow.pages[flow.pages.length - 1];
   return p["b" + (flow.n - 1)];
}

// ---- the head, the foot ----

function drawHead()
{
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 16, PANEL_W - PAD * 2, "Key Ring");
   dboDivider(h, PAD, 84, PANEL_W - PAD * 2);
}

function drawFoot(pages)
{
   var f = clear("foot", 60);
   var r = dboText(f, "result", 1, PAD, PANEL_H - 112, PANEL_W - PAD * 2, 44, dboFmt(F_MEDIUM, 18, data.resultKind == "refused" ? C_RED : C_GREEN, 0.5), true);
   r.text = data.result != undefined ? String(data.result) : "";
   dboDivider(f, PAD, PANEL_H - 62, PANEL_W - PAD * 2);
   flowPager(f, 20, PAD, PANEL_H - 48, pages);
   var p = dboText(f, "pages", 2, PAD + (pages > 1 ? 176 : 0), PANEL_H - 46, 400, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   p.text = pages > 1 ? "Page " + (page + 1) + " of " + pages + " (Left / Right)" : "";
   button(f, "close", 10, PANEL_W - PAD - 100, PANEL_H - 48, 100, "Close", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      closeMenu();
   });
}

// Where a control sits, so the focus can find it again after a redraw
function placeOf(c)
{
   return c._parent._name + "/" + c._name;
}

function draw()
{
   var was = focus >= 0 && focus < actions.length ? placeOf(actions[focus]) : "";
   actions = [];
   focus = -1;
   drawHead();
   flowStart(panel, 50, PAD, BODY_TOP);
   drawOffer();
   drawKeys();
   drawOwned();
   flowGap(6);
   flowHint("A key opens its door even when it is locked. Taking a key back stops it opening at once, wherever it is.");
   var pages = flowShow(page);
   if (page >= pages)
   {
      page = pages - 1;
      flowShow(page);
   }
   drawFoot(pages);
   for (var i = 0; was != "" && i < actions.length; i++)
   {
      if (placeOf(actions[i]) == was)
      {
         setFocus(i);
         break;
      }
   }
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
   if (p == null || p.nonce == undefined || p.keys == undefined)
   {
      dboLog("keyring: unreadable payload");
      return;
   }
   data = p;
   busyAt = 0;
   // a re-sent panel ends any pick, as the browser's does
   picking = "";
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (code == 27)
   {
      if (picking != "")
      {
         picking = "";
         dboSound("UIMenuCancel");
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
dboKeys(keys);

_root.onEnterFrame = function()
{
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("keyring: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
