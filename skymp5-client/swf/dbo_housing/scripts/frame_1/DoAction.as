// The property menu as a native panel (client housingService's widget, the same object the browser menu gets).
// Events go out as the widget's own keys (events.*), which the client router replays as the browser would. The name box is
// typed input, so "Rename..." hands off to the browser (native:handoff [housing, rename]).

var DBO_SWF_VERSION = "housing-1";
var STAGE_W = 1280;
var PANEL_W = 920;
var PANEL_H = 600;
var PAD = 28;
var COL_W = 300;
var RIGHT_X = 360;
var ACT_TOP = 112;
var ACT_STEP = 40;
var ROOM_TOP = 176;
var ROOM_H = 54;
var MAX_ROOMS = 6;
var NO_DATA_CLOSE_MS = 8000;
var C_RED = 0xB23A3A;
var NAME_HINT = "Letters, numbers, spaces, apostrophes and dashes only.";

var panel;
var data = null;
var page = 0;
var builtAt = getTimer();

function ev(k)
{
   return data.events != undefined && data.events[k] != undefined ? String(data.events[k]) : "housing:" + k;
}

function closeMenu()
{
   dboSound("UIMenuCancel");
   dboSend(ev("cancel"), []);
   dboSend("close", []);
   dboClose();
}

// The service closes its menu behind these (a player to aim at next, or another panel); the native one goes with it
function sendAndClose(key, args)
{
   dboSound("UIMenuOK");
   dboSend(key, args);
   dboSend("close", []);
   dboClose();
}

// Another panel (Key Ring, property market) opens for the door here; this menu closes behind it, as the browser's does
function handOver(key)
{
   dboSend(key, []);
   sendAndClose(ev("cancel"), []);
}

function act(key, args)
{
   dboSound("UIMenuOK");
   dboSend(key, args);
}

function roomState(r)
{
   if (r.other != null && r.other != "")
   {
      return r.other + "'s own";
   }
   if (r.assigned != null && r.assigned != "")
   {
      return "Assigned to " + r.assigned;
   }
   if (r.shared == true)
   {
      return "Shared with key holders";
   }
   return r.kind == "chest" ? "Yours alone" : "Open to all inside";
}

function role()
{
   var v = data.view != undefined ? String(data.view) : "denied";
   return {view: v, owner: v == "owner", manager: v == "manager", manages: v == "owner" || v == "manager", canLock: v == "owner" || v == "manager" || v == "keyholder"};
}

// The actions the browser menu offers this view, in its order
function actionList(r)
{
   var out = [];
   if (r.view == "claimable" || (r.manager && data.owned != true))
   {
      out.push(["Claim", function() { act(ev("claim"), []); }]);
   }
   if (r.canLock && data.owned == true)
   {
      out.push([data.locked == true ? "Unlock" : "Lock", function() { act(data.locked == true ? ev("unlock") : ev("lock"), []); }]);
   }
   if (r.owner)
   {
      out.push(["Cut a key", function() { act(ev("createKey"), []); }]);
   }
   if (r.manages && data.hasKeys == true)
   {
      out.push(["Void all keys", function() { act(ev("revokeKeys"), []); }]);
   }
   if (r.manages)
   {
      out.push([r.owner ? "Transfer" : "Grant ownership", function() { sendAndClose(ev("transfer"), []); }]);
      out.push(["Rename...", function()
      {
         dboSound("UIMenuOK");
         dboSend("native:handoff", ["housing", "rename"]);
      }]);
   }
   if (r.owner)
   {
      out.push(["Give up", function() { act(ev("abandon"), []); }, C_RED]);
   }
   if (r.manager && data.owned == true)
   {
      out.push(["Revoke ownership", function() { act(ev("revoke"), []); }, C_RED]);
   }
   if (r.manages && data.canGrantContainers == true)
   {
      out.push(["Grant this container", function() { sendAndClose(ev("grantContainer"), []); }]);
   }
   if (data.keyRing == true && r.canLock)
   {
      out.push(["Key Ring", function() { handOver("dbo:keyRingOpen"); }]);
   }
   if (data.canGrantContainers != true)
   {
      out.push([r.manager ? "Sell or rent out" : r.owner ? "Rent and sale" : "Buy or rent", function() { handOver("dbo:propertyMarket"); }]);
   }
   return out;
}

function hintText(r)
{
   if (!r.canLock)
   {
      if (r.view == "claimable")
      {
         return "Nobody has claimed this yet.";
      }
      return data.owned != true ? "Unowned. Property here is granted by its ruler (Jarl, Baron or Count) or their Steward." : "This isn't yours.";
   }
   if (!r.owner)
   {
      return r.manages ? "Rename names the property for everyone. " + NAME_HINT : "";
   }
   if (data.keyRing == true)
   {
      return "A locked door keeps out everyone without a key; you and your key holders walk straight in. Cut a key puts it on your Key Ring, where you can give it, cut one for a player beside you, or take a copy back. Void all keys cancels every copy.";
   }
   return "A locked door stops everyone, you included, until it is unlocked here. A key lets its holder lock and unlock it too: trade it or leave it in a chest. Void all keys cancels every copy.";
}

function drawHead(r)
{
   var h = clear("head", 20);
   var title = dboText(h, "title", 1, PAD, 18, PANEL_W - PAD * 2 - 240, 40, dboFmt(F_PLAIN, 30, C_TEXT, 1.0), false);
   title.text = data.name != null && data.name != "" ? String(data.name) : data.targetLabel != null && data.targetLabel != "" ? String(data.targetLabel) : "Property";
   var st = dboText(h, "status", 2, PANEL_W - PAD - 240, 28, 240, 26, dboFmt(F_MEDIUM, 18, data.locked == true ? C_RED : C_SECOND, 0.8, "right"), false);
   st.text = r.canLock ? (r.owner ? "Yours" : r.manager ? "Managed" : "Key holder") + (data.locked == true ? " - locked" : " - unlocked") : (data.owned == true ? "Owned by another" : "Unclaimed");
   var line = "";
   if (data.ownerName != null && data.ownerName != "" && !r.owner)
   {
      line = "Owner: " + data.ownerName;
   }
   if (data.assignedToYou == true)
   {
      line += (line != "" ? "    " : "") + "Assigned to you" + (data.placeName != null && data.placeName != "" ? " in " + data.placeName : "") + ".";
   }
   var o = dboText(h, "owner", 3, PAD, 62, PANEL_W - PAD * 2, 24, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8), false);
   o.text = line;
   dboRule(h, PAD, 96, PANEL_W - PAD * 2);
}

function drawActions(r)
{
   var a = clear("acts", 40);
   var list = actionList(r);
   for (var i = 0; i < list.length; i++)
   {
      var b = button(a, "a" + i, 10 + i, PAD, ACT_TOP + i * ACT_STEP, COL_W, list[i][0], F_MEDIUM, 22, A_BUTTON_REST, list[i][1]);
      if (list[i][2] != undefined)
      {
         b.label.textColor = list[i][2];
      }
   }
}

function roomButton(c, name, x, label, key, ref)
{
   var b = button(c, name, 20 + x, 300 + x * 112, 8, 106, label, F_MEDIUM, 16, A_BUTTON_REST, function()
   {
      if (this.key == ev("assign"))
      {
         sendAndClose(this.key, [this.ref]);
      }
      else
      {
         act(this.key, [this.ref]);
      }
   });
   b.key = key;
   b.ref = ref;
}

function drawRight(r)
{
   var l = clear("right", 50);
   var w = PANEL_W - RIGHT_X - PAD;
   var p = data.place;
   if (!r.manages || p == null || !(p.rooms instanceof Array))
   {
      var hint = dboText(l, "hint", 1, RIGHT_X, ACT_TOP, w, 300, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8), true);
      hint.text = hintText(r);
      return 1;
   }
   var sub = dboText(l, "sub", 1, RIGHT_X, ACT_TOP - 4, w, 30, dboFmt(F_BOLD, 22, C_TEXT, 0.8), false);
   sub.text = "Rooms and chests";
   var note = dboText(l, "note", 2, RIGHT_X, ACT_TOP + 26, w, 40, dboFmt(F_MEDIUM, 14, C_SECOND, 0.5), true);
   note.text = "Chests are yours alone until you share or assign one. Whatever you assign opens for that person, you and the hold's officials.";
   var rooms = p.rooms;
   var pages = Math.max(1, Math.ceil(rooms.length / MAX_ROOMS));
   if (page >= pages)
   {
      page = pages - 1;
   }
   if (!rooms.length)
   {
      var e = dboText(l, "empty", 3, RIGHT_X, ROOM_TOP, w, 26, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8), false);
      e.text = "No inner doors or chests here.";
   }
   for (var i = 0; i < MAX_ROOMS && page * MAX_ROOMS + i < rooms.length; i++)
   {
      var rm = rooms[page * MAX_ROOMS + i];
      var c = l.createEmptyMovieClip("r" + i, 10 + i);
      c._x = RIGHT_X;
      c._y = ROOM_TOP + i * ROOM_H;
      var here = rm.ref == p.here;
      var t = dboText(c, "label", 1, 0, 0, 290, 26, dboFmt(here ? F_BOLD : F_MEDIUM, 20, C_TEXT, 0.8), false);
      t.text = String(rm.label);
      var s = dboText(c, "sub", 2, 0, 24, 290, 22, dboFmt(F_MEDIUM, 15, C_SECOND, 0.8), false);
      s.text = roomState(rm) + (here ? "  (here)" : "");
      if (rm.other == null || rm.other == "")
      {
         var has = rm.assigned != null && rm.assigned != "";
         var n = 0;
         roomButton(c, "as", n++, has ? "Reassign" : "Assign", ev("assign"), rm.ref);
         if (has)
         {
            roomButton(c, "tb", n++, "Take back", ev("unassign"), rm.ref);
         }
         if (rm.kind == "chest" && rm.shared != true && !has)
         {
            roomButton(c, "sh", n++, "Share", ev("share"), rm.ref);
         }
         if (rm.kind == "chest" && rm.shared == true)
         {
            roomButton(c, "us", n++, "Keep to myself", ev("unshare"), rm.ref);
         }
      }
   }
   var more = dboText(l, "more", 30, RIGHT_X, ROOM_TOP + MAX_ROOMS * ROOM_H + 4, w, 22, dboFmt(F_MEDIUM, 14, C_SECOND, 0.5), false);
   more.text = (pages > 1 ? "Page " + (page + 1) + " of " + pages + " (Left / Right)    " : "") + (p.more > 0 ? "And " + p.more + " more: aim at one and open this menu." : "");
   return pages;
}

function drawFoot()
{
   var f = clear("foot", 60);
   dboRule(f, PAD, PANEL_H - 62, PANEL_W - PAD * 2);
   button(f, "close", 1, PANEL_W - PAD - 100, PANEL_H - 48, 100, "Close", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      closeMenu();
   });
}

function draw()
{
   actions = [];
   focus = -1;
   var r = role();
   drawHead(r);
   drawActions(r);
   drawRight(r);
   drawFoot();
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   panel._x = (STAGE_W - PANEL_W) / 2;
   panel._y = 60;
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboBox(bg, 0, 0, PANEL_W, PANEL_H, 0x000000, 80);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.view == undefined || p.events == undefined)
   {
      dboLog("housing: unreadable payload");
      return;
   }
   data = p;
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = Key.getCode();
   dboLog("housing key " + code);
   if (code == 27 || code == 9)
   {
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
   else if (code == 37 && page > 0)
   {
      dboSound("UIMenuPrevNext");
      page--;
      draw();
   }
   else if (code == 39 && data.place != null && data.place.rooms instanceof Array && (page + 1) * MAX_ROOMS < data.place.rooms.length)
   {
      dboSound("UIMenuPrevNext");
      page++;
      draw();
   }
};
Key.addListener(keys);

_root.onEnterFrame = function()
{
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("housing: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
