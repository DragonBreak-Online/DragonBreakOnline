// Buying and renting a property as a native panel (server tenancy.js, widget 82: the same object skymp5-front
// features/propertyMarket gets), opened from the door's property menu for the door the player stands at. Actions go out as
// dbo:propertyMarketAct with the window's nonce, the action and its arguments as text, and the server answers by sending the
// panel again with a result line. Buying, moving in, leaving and evicting ask once more first. A price, a deposit or a
// weekly rent is typed in a box on its own row (dboInput); the weeks of rent to pay are a stepper.

var DBO_SWF_VERSION = "market-1";
var PANEL_W = 1000;
var PANEL_H = 640;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
var BODY_TOP = 112;
BODY_H = PANEL_H - 118 - BODY_TOP;
var NO_DATA_CLOSE_MS = 8000;
var BUSY_TIMEOUT_MS = 8000;
var MAX_WEEKS = 8;
var C_RED = 0xB23A3A;

var panel;
var data = null;
var page = 0;
var busyAt = 0;
// vals: what was typed for each field (price, deposit, weekly)
var vals = {};
var weeks = 1;
// confirm: the question waiting for Yes (buy, buyresale, accept, leave, evict)
var confirm = "";
// box: the field whose typing box is open; boxField its text field
var box = "";
var boxField = null;
var builtAt = getTimer();

function gold(n)
{
   var s = String(Math.floor(Math.abs(Number(n) || 0)));
   var out = "";
   while (s.length > 3)
   {
      out = "," + s.substr(s.length - 3) + out;
      s = s.substr(0, s.length - 3);
   }
   return (Number(n) < 0 ? "-" : "") + s + out;
}

function val(key)
{
   return vals[key] != undefined ? String(vals[key]) : "";
}

function num(key)
{
   return Number(val(key)) || 0;
}

function busy()
{
   return busyAt > 0 && getTimer() - busyAt < BUSY_TIMEOUT_MS;
}

// One action in flight at a time, as the browser's; every argument goes as text, as the browser's does
function act(name, args)
{
   if (busy())
   {
      return;
   }
   busyAt = getTimer();
   confirm = "";
   endTyping();
   dboSound("UIMenuOK");
   var out = [String(data.nonce), name];
   for (var i = 0; args != undefined && i < args.length; i++)
   {
      out.push(String(args[i]));
   }
   dboSend("dbo:propertyMarketAct", out);
   draw();
}

function closeMenu()
{
   endTyping();
   dboSound("UIMenuCancel");
   dboSend("dbo:propertyMarketClose", []);
   dboClose();
}

function statusText()
{
   if (data.state == "sale")
   {
      return "For sale";
   }
   if (data.state == "resale")
   {
      return data.yourSale == true ? "For sale by you" : "For sale by " + (data.sellerName != undefined && data.sellerName != "" ? data.sellerName : "its owner");
   }
   if (data.state == "rent")
   {
      return "For rent";
   }
   if (data.state == "let")
   {
      return data.youRent == true ? "Rented by you" : "Let";
   }
   if (data.yours == true)
   {
      return "Yours";
   }
   return data.owned == true ? "Owned by " + data.ownerName : "Empty";
}

// ---- typed fields ----

function openBox(key)
{
   endTyping();
   box = key;
   dboSound("UIMenuOK");
   draw();
}

function takeTyped()
{
   vals[box] = boxField != null ? String(boxField.text).split(",").join("") : "";
   endTyping();
   dboSound("UIMenuOK");
   draw();
}

function endTyping()
{
   if (box != "")
   {
      dboInputEnd();
   }
   box = "";
   boxField = null;
}

// A row with a typed number: its label, the value or a box to type it in, and the buttons that use it
function fieldRow(key, label, hint, max, buttons)
{
   var at = flowNeed(42);
   var c = at.clip.createEmptyMovieClip(at.name, fd());
   c._y = at.y;
   var l = dboText(c, "label", 1, 0, 8, 260, 26, dboFmt(F_MEDIUM, 17, C_SECOND, 0.5), false);
   l.text = label;
   var bx = BODY_W;
   for (var k = 0; k < buttons.length; k++)
   {
      bx -= Math.max(110, String(buttons[k][0]).length * 10 + 24) + 8;
   }
   if (box == key)
   {
      var f = dboInput(c, "box", 2, 270, 4, bx - 270 - 108, 32, dboFmt(F_PLAIN, 18, C_TEXT, 0.5), max, false);
      f.restrict = "0-9";
      f.text = val(key);
      boxField = f;
      button(c, "done", 10, bx - 100, 6, 92, "Done", F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         takeTyped();
      });
   }
   else
   {
      var v = dboText(c, "value", 2, 270, 8, bx - 270 - 108, 26, dboFmt(F_MEDIUM, 18, val(key) != "" ? C_TEXT : C_SECOND, 0.5), false);
      v.text = val(key) != "" ? gold(val(key)) : hint;
      if (dboCanType())
      {
         var t = button(c, "type", 10, bx - 100, 6, 92, "Type...", F_MEDIUM, 17, A_ROW_REST, function()
         {
            openBox(this.key);
         });
         t.key = key;
      }
   }
   var x = bx;
   for (var i = 0; i < buttons.length; i++)
   {
      var w = Math.max(110, String(buttons[i][0]).length * 10 + 24);
      var b = button(c, "btn" + i, 20 + i, x + 8, 6, w, buttons[i][0], F_MEDIUM, 17, A_BUTTON_REST, buttons[i][1]);
      if (buttons[i][3] == true)
      {
         disable(b);
      }
      x += w + 8;
   }
   return c;
}

// A button that asks once more before it acts: the question with Yes and No in its place while it waits
function ask(id, label, question, onYes, danger)
{
   if (confirm != id)
   {
      flowButtons([[label, function() { confirm = this.id; dboSound("UIMenuOK"); draw(); }, danger ? C_RED : undefined, busy()]]).btn0.id = id;
      return;
   }
   var e = flowEntry(question, [["Yes", onYes, danger ? C_RED : undefined, busy()], ["No", function() { confirm = ""; dboSound("UIMenuCancel"); draw(); }]]);
   if (danger)
   {
      e.label.textColor = C_RED;
   }
}

// ---- the page ----

function drawFigures()
{
   if (data.state == "sale" || data.state == "resale")
   {
      flowRow("Price", gold(data.price) + " gold");
   }
   if (data.state == "rent")
   {
      flowRow("Deposit", gold(data.deposit) + " gold");
   }
   if (data.state == "rent" || data.state == "let")
   {
      flowRow("Rent", gold(data.weekly) + " gold a week");
   }
   if (data.state == "let" && data.paidUntil != undefined && data.paidUntil != "")
   {
      var r = flowRow("Paid until", String(data.paidUntil) + (data.overdue == true ? "  ·  overdue" : ""));
      if (data.overdue == true)
      {
         r.textColor = C_RED;
      }
   }
   flowRow("Property tax", data.weeklyTax != undefined && data.taxValue != undefined
      ? gold(data.weeklyTax) + " gold a week (" + data.taxPct + "% of " + gold(data.taxValue) + (data.listedValue == true ? ", its listed value" : "") + ")"
      : data.taxPct + "% of its value a week");
   flowGap(8);
}

function citizenOr(id, label, question)
{
   if (data.citizenNeeded != undefined && data.citizenNeeded != "")
   {
      flowText(String(data.citizenNeeded), 16, C_RED);
      return;
   }
   ask(id, label, question, function() { act("buy"); }, false);
}

function drawAnyone()
{
   if (data.state == "sale")
   {
      flowHint("The first to pay owns it outright. The gold goes to " + data.hold + ", and the house pays the hold's property tax each week on that price.");
      citizenOr("buy", "Buy it for " + gold(data.price) + " gold", "Pay " + gold(data.price) + " gold for " + data.name + "?");
   }
   if (data.state == "resale")
   {
      if (data.yourSale == true)
      {
         flowHint("You are selling it. The first who may buy property in " + data.hold + " and pays the price owns it; the gold comes to you, even while you are away.");
         flowButtons([["Take it off the market", function() { act("unresell"); }, undefined, busy()]]);
      }
      else
      {
         flowHint("Sold by its owner, " + data.sellerName + ": the gold goes to them. Its property tax stays what it is, on the hold's listed value.");
         citizenOr("buyresale", "Buy it for " + gold(data.price) + " gold", "Pay " + data.sellerName + " " + gold(data.price) + " gold for " + data.name + "?");
      }
   }
   if (data.canResell == true)
   {
      fieldRow("price", data.state == "resale" ? "Change your price" : "Sell it to another player", "Price, 1 to " + gold(data.maxPrice) + " gold", 7,
         [[data.state == "resale" ? "Change the price" : "Put up for sale", function() { act("resell", [num("price")]); }, undefined, busy() || !num("price")]]);
   }
   if (data.state == "rent")
   {
      var moveIn = (Number(data.deposit) || 0) + (Number(data.weekly) || 0);
      if (data.offeredToYou == true)
      {
         flowHint("It is offered to you. Moving in takes the deposit and the first week: " + gold(moveIn) + " gold.");
         ask("accept", "Move in for " + gold(moveIn) + " gold", "Pay " + gold(moveIn) + " gold and move in?", function() { act("accept"); }, false);
      }
      else if (data.youAsked == true)
      {
         flowHint("Your name is down. If the officials offer it to you, come back here to move in.");
      }
      else
      {
         var asked = Number(data.asked) || 0;
         flowHint((asked > 0 ? asked + (asked == 1 ? " person has" : " people have") + " asked for it. " : "") + "Put your name down; the officials offer it to one of those who asked.");
         flowButtons([["Ask to rent it", function() { act("interest"); }, undefined, busy()]]);
      }
   }
   if (data.state == "let" && data.youRent == true)
   {
      var at = flowNeed(42);
      var c = at.clip.createEmptyMovieClip(at.name, fd());
      c._y = at.y;
      var l = dboText(c, "label", 1, 0, 8, 260, 26, dboFmt(F_MEDIUM, 17, C_SECOND, 0.5), false);
      l.text = "Pay rent";
      var minus = button(c, "less", 10, 270, 6, 50, "-", F_MEDIUM, 17, A_ROW_REST, function() { setWeeks(weeks - 1); });
      var w = dboText(c, "weeks", 2, 328, 8, 110, 26, dboFmt(F_BOLD, 18, C_TEXT, 0.5), false);
      w.text = weeks == 1 ? "1 week" : weeks + " weeks";
      var plus = button(c, "more", 11, 446, 6, 50, "+", F_MEDIUM, 17, A_ROW_REST, function() { setWeeks(weeks + 1); });
      if (weeks <= 1)
      {
         disable(minus);
      }
      if (weeks >= MAX_WEEKS)
      {
         disable(plus);
      }
      var pay = button(c, "pay", 12, 510, 6, 200, "Pay " + gold(weeks * (Number(data.weekly) || 0)) + " gold", F_MEDIUM, 17, A_BUTTON_REST, function() { act("pay", [weeks]); });
      if (busy())
      {
         disable(pay);
      }
      ask("leave", "Hand back the keys", "Leave the house? A tenant in good standing gets the deposit back.", function() { act("leave"); }, true);
   }
   if (data.state == "none" && data.manager != true)
   {
      flowHint(data.yours == true ? "This property is yours." : data.owned == true ? "It belongs to " + data.ownerName + "." : "It is neither for sale nor for rent.");
   }
}

function setWeeks(n)
{
   weeks = Math.max(1, Math.min(MAX_WEEKS, n));
   dboSound("UIMenuFocus");
   draw();
}

function drawOfficials()
{
   var empty = data.owned != true && data.state != "let";
   flowHeading("For the hold's officials");
   if (data.owned == true && data.state != "let")
   {
      flowHint(data.ownerName + " owns it. Only an empty house can be sold or rented out.");
   }
   if (empty && data.state != "rent")
   {
      fieldRow("price", data.state == "sale" ? "Change the price" : "Sell it", "Price, 1 to " + gold(data.maxPrice) + " gold", 7,
         [["Put up for sale", function() { act("sell", [num("price")]); }, undefined, busy() || !num("price")]]);
   }
   if (empty && data.state != "sale")
   {
      flowText(data.state == "rent" ? "Change the terms" : "Rent it out", 17, C_SECOND);
      fieldRow("deposit", "Deposit", "Up to " + gold(data.maxDeposit) + " gold", 5, []);
      fieldRow("weekly", "A week", "Up to " + gold(data.maxWeekly) + " gold", 4,
         [["Put up for rent", function() { act("list", [num("deposit"), num("weekly")]); }, undefined, busy() || !num("weekly") || val("deposit") == ""]]);
   }
   if (data.state == "rent")
   {
      flowText("Asked to rent it", 17, C_SECOND);
      var list = listOf(data.interest);
      if (!list.length)
      {
         flowHint("Nobody yet.");
      }
      for (var i = 0; i < list.length; i++)
      {
         if (data.offeredTo == list[i].name)
         {
            flowRow(String(list[i].name), "Offered");
         }
         else
         {
            var e = flowEntry(String(list[i].name), [["Offer it", function() { act("offer", [this.tag]); }, undefined, busy()]]);
            e.btn0.tag = String(list[i].tag);
         }
      }
   }
   if (data.state == "sale" || data.state == "rent")
   {
      flowButtons([["Take it off the market", function() { act("unlist"); }, undefined, busy()]]);
   }
   if (data.state == "let" && data.youRent != true)
   {
      flowHint("Let to " + data.tenantName + (data.overdue == true ? ", whose rent is overdue." : "."));
      flowButtons([["Send a reminder", function() { act("remind"); }, undefined, busy()], ["A week's grace", function() { act("grace"); }, undefined, busy()]]);
      if (data.overdue == true)
      {
         ask("evict", "Evict", "Evict " + data.tenantName + "? The hold keeps the deposit.", function() { act("evict"); }, true);
      }
   }
}

// ---- the head, the foot ----

function drawHead()
{
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 16, PANEL_W - PAD * 2, String(data.name));
   var s = dboText(h, "sub", 2, PAD, 58, PANEL_W - PAD * 2, 26, dboFmt(F_MEDIUM, 17, C_SECOND, 0.8), false);
   s.text = data.hold + "  ·  " + statusText();
   dboDivider(h, PAD, 92, PANEL_W - PAD * 2);
}

function drawFoot(pages)
{
   var f = clear("foot", 60);
   var r = dboText(f, "result", 1, PAD, PANEL_H - 112, PANEL_W - PAD * 2, 44, dboFmt(F_MEDIUM, 18, C_TEXT, 0.5), true);
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
   // a redraw rebuilds the open box: what was typed in it carries over
   var typed = box != "" && boxField != null ? String(boxField.text) : null;
   boxField = null;
   actions = [];
   focus = -1;
   drawHead();
   flowStart(panel, 50, PAD, BODY_TOP);
   drawFigures();
   drawAnyone();
   if (data.manager == true)
   {
      drawOfficials();
   }
   if (typed != null && boxField != null)
   {
      boxField.text = typed;
   }
   // a box whose row is gone (the house changed hands meanwhile) gives the keys back
   if (box != "" && boxField == null)
   {
      endTyping();
   }
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
   if (p == null || p.nonce == undefined || p.state == undefined)
   {
      dboLog("market: unreadable payload");
      return;
   }
   data = p;
   busyAt = 0;
   // a re-sent panel ends any question it asked, as the browser's does
   confirm = "";
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (box != "")
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
      // every other key is typing while the box is open
      return;
   }
   if (code == 27)
   {
      if (confirm != "")
      {
         confirm = "";
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
      dboLog("market: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
