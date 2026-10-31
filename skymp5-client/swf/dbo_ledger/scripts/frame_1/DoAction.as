// A business's ledger as a native panel (server business.js, widget 64: the same object skymp5-front features/businessLedger
// gets). The owner and staff get every page as a tab; anyone else the public page, with the shop's Buy list. Actions go
// out as dbo:bizLedger with the window's nonce, the action and its arguments, and the server answers by sending the panel
// again with a result line. A typed value (the rent, a note, a name, a price) is typed in a box on its own row
// (dboInput); the shop's quantities are steppers.

var DBO_SWF_VERSION = "ledger-1";
var PANEL_W = 1100;
var PANEL_H = 640;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
var BODY_TOP = 168;
BODY_H = PANEL_H - 118 - BODY_TOP;
var NO_DATA_CLOSE_MS = 8000;
var BUSY_TIMEOUT_MS = 8000;
var C_RED = 0xB23A3A;
var C_GREEN = 0x7FBF7F;
var STATE_TEXT = {free: "For rent", rented: "Rented", grace: "Rent ran out: held for its renter", lapsed: "Lapsed: open it to clear it"};
var STEPS = [[2, "Fine"], [5, "Normal"], [20, "Large"]];

var panel;
var data = null;
var tab = "overview";
var page = 0;
var busyAt = 0;
// vals: what was typed for each field, by its key (rent, note, hire, chest, rename, price:<goods>)
var vals = {};
// qty: how many to buy of each kind of goods, by its key
var qty = {};
// box: the field whose typing box is open; boxField its text field
var box = "";
var boxField = null;
var step = 5;
var confirmClose = false;
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

function trim(s)
{
   var t = String(s);
   while (t.charAt(0) == " ")
   {
      t = t.substr(1);
   }
   while (t.charAt(t.length - 1) == " ")
   {
      t = t.substr(0, t.length - 1);
   }
   return t;
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

function isOwner()
{
   return data.role == "owner";
}

function isStaff()
{
   return data.role != "customer";
}

// One action in flight at a time, as the browser's: the server's answer (a new payload) ends it
function act(name, args)
{
   if (busy())
   {
      return;
   }
   busyAt = getTimer();
   endTyping();
   dboSound("UIMenuOK");
   dboSend("dbo:bizLedger", [String(data.nonce), name].concat(args != undefined ? args : []));
   draw();
}

function closeMenu()
{
   endTyping();
   dboSound("UIMenuCancel");
   dboSend("dbo:bizLedgerClose", []);
   dboClose();
}

function tabs()
{
   var list = [["overview", "Overview"], ["logbook", "Logbook"], ["log", "Ledger"], ["staff", "Staff"], ["storage", "Storage"]];
   if (data.shopStock != undefined)
   {
      list.push(["shop", "Shop"]);
   }
   if (isOwner())
   {
      list.push(["book", "The book"]);
   }
   return list;
}

// The tab shown: the chosen one while the payload still offers it
function shown()
{
   var list = tabs();
   for (var i = 0; i < list.length; i++)
   {
      if (list[i][0] == tab)
      {
         return tab;
      }
   }
   return "overview";
}

function setTab(t)
{
   endTyping();
   tab = t;
   page = 0;
   confirmClose = false;
   dboSound("UIMenuPrevNext");
   draw();
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
   var text = boxField != null ? String(boxField.text) : "";
   vals[box] = boxField != null && boxField.restrict == "0-9" ? text.split(",").join("") : text.split("\r").join(" ").split("\n").join(" ");
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

// A row with a typed value: its label, the value or a box to type it in, and the buttons that use it
// buttons: [[label, onPick, color?, disabled?], ...]
function fieldRow(key, label, hint, digits, max, buttons)
{
   var at = flowNeed(42);
   var c = at.clip.createEmptyMovieClip(at.name, fd());
   c._y = at.y;
   var l = dboText(c, "label", 1, 0, 8, 300, 26, dboFmt(F_MEDIUM, 17, C_SECOND, 0.5), false);
   l.text = label;
   var bx = BODY_W;
   for (var k = 0; k < buttons.length; k++)
   {
      bx -= Math.max(110, String(buttons[k][0]).length * 10 + 24) + 8;
   }
   if (box == key)
   {
      var f = dboInput(c, "box", 2, 310, 4, bx - 310 - 108, 32, dboFmt(F_PLAIN, 18, C_TEXT, 0.5), max, false);
      if (digits)
      {
         f.restrict = "0-9";
      }
      f.text = val(key);
      boxField = f;
      button(c, "done", 10, bx - 100, 6, 92, "Done", F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         takeTyped();
      });
   }
   else
   {
      var v = dboText(c, "value", 2, 310, 8, bx - 310 - 108, 26, dboFmt(F_MEDIUM, 18, val(key) != "" ? C_TEXT : C_SECOND, 0.5), false);
      v.text = val(key) != "" ? (digits ? gold(val(key)) : val(key)) : hint;
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
      if (buttons[i][2] != undefined)
      {
         b.label.textColor = buttons[i][2];
      }
      if (buttons[i][3] == true)
      {
         disable(b);
      }
      x += w + 8;
   }
   return c;
}

// The last block the flow drew, so a row's button can carry its own arguments
function flowLast()
{
   var p = flow.pages[flow.pages.length - 1];
   return p["b" + (flow.n - 1)];
}

function itemText(r)
{
   var tags = listOf(r.tags);
   return String(r.name) + (tags.length ? " (" + tags.join(", ") + ")" : "");
}

// ---- the public page, with the shop ----

function qtyOf(r)
{
   var max = Number(data.maxPerBuy) || 1000;
   var n = qty[r.key] != undefined ? Number(qty[r.key]) : 1;
   return Math.max(0, Math.min(n, Number(r.count), max));
}

function drawShopBuy()
{
   flowHeading("For sale");
   var items = listOf(data.shopItems);
   if (!items.length)
   {
      flowHint("Nothing for sale just now.");
      return;
   }
   for (var i = 0; i < items.length; i++)
   {
      var r = items[i];
      var n = qtyOf(r);
      var most = Math.min(Number(r.count), Number(data.maxPerBuy) || 1000);
      var row = flowEntry(itemText(r), [["-", function() { setQty(this.r, qtyOf(this.r) - 1); }, undefined, n <= 1],
         ["+", function() { setQty(this.r, qtyOf(this.r) + 1); }, undefined, n >= most],
         ["Buy" + (n > 1 ? " " + n : "") + ": " + gold(Number(r.price) * n), function() { act("buy", [String(this.r.key), qtyOf(this.r), Number(this.r.price)]); }, undefined, busy() || !(n > 0) || data.shopOpen != true]],
         r.count + " left  ·  " + gold(r.price) + " gold each");
      row.btn0.r = r;
      row.btn1.r = r;
      row.btn2.r = r;
   }
   flowHint("Paid from the gold in your pack. " + data.hold + " takes " + data.taxPct + "% of every sale.");
}

function setQty(r, n)
{
   qty[r.key] = Math.max(1, Math.min(n, Number(r.count), Number(data.maxPerBuy) || 1000));
   dboSound("UIMenuFocus");
   draw();
}

function drawPublic()
{
   if (data.shopOpen == true || listOf(data.shopItems).length > 0)
   {
      drawShopBuy();
      flowGap(8);
   }
   flowRow("A bed for the night", Number(data.rent) > 0 ? gold(data.rent) + " gold" : "The hold's standard rent");
   flowRow(data.hold + " takes", data.taxPct + "% of every rent");
   flowHeading("Storage");
   var free = [];
   var chests = listOf(data.chests);
   for (var i = 0; i < chests.length; i++)
   {
      if (chests[i].state == "free")
      {
         free.push(chests[i]);
      }
   }
   if (!free.length)
   {
      flowHint("No chests for rent just now.");
   }
   for (var j = 0; j < free.length; j++)
   {
      flowRow("A chest", gold(free[j].price) + " gold a day");
   }
   if (free.length)
   {
      flowHint("Open a chest for rent to take it.");
   }
}

// ---- the staff's tabs ----

function drawOverview()
{
   flowRow("Taken this week", gold(data.week) + " gold");
   flowRow("This month", gold(data.month) + " gold");
   if (isOwner())
   {
      flowRow("Held for you", gold(data.owed) + " gold");
      if (Number(data.owed) > 0)
      {
         flowButtons([["Collect the takings", function() { act("collect"); }, undefined, busy()]]);
      }
   }
   flowGap(6);
   flowText("A bed for the night: " + (Number(data.rent) > 0 ? gold(data.rent) + " gold" : "the hold's standard rent"), 17);
   fieldRow("rent", "New rent", data.minRent + " to " + data.maxRent + " gold", true, 4, [["Set the rent", function() { act("rent", [num("rent")]); }, undefined, busy() || !num("rent")]]);
   flowHint(data.hold + " takes " + data.taxPct + "% of every rent, set by its rulers.");
}

function drawLogbook()
{
   flowHint("Notes for the owner and staff only.");
   fieldRow("note", "A note", "Write a note", false, Number(data.maxNote) || 300, [["Write", function() { act("note", [val("note")]); }, undefined, busy() || trim(val("note")) == ""]]);
   var notes = listOf(data.notes);
   if (!notes.length)
   {
      flowHint("Nothing written yet.");
   }
   for (var i = 0; i < notes.length; i++)
   {
      flowRow(whenText(notes[i].at), (notes[i].by != undefined ? notes[i].by + ":  " : "") + notes[i].text);
   }
}

function drawLog()
{
   var log = listOf(data.log);
   if (!log.length)
   {
      flowHint("Nothing yet.");
   }
   for (var i = 0; i < log.length; i++)
   {
      flowRow(whenText(log[i].at), String(log[i].text));
   }
}

function drawStaff()
{
   flowRow(String(data.ownerName), "Owner");
   var staff = listOf(data.staff);
   for (var i = 0; i < staff.length; i++)
   {
      if (isOwner())
      {
         flowEntry(String(staff[i].name), [["Let go", function() { act("staffRemove", [this.profile]); }, undefined, busy()]]);
         flowLast().btn0.profile = Number(staff[i].profile);
      }
      else
      {
         flowRow(String(staff[i].name), "Staff");
      }
   }
   if (isOwner())
   {
      fieldRow("hire", "Take someone on", "Name or #TAG of someone online", false, 40, [["Take on", function() { act("staffAdd", [trim(val("hire"))]); }, undefined, busy() || trim(val("hire")) == "" || staff.length >= (Number(data.maxStaff) || 12)]]);
   }
   flowHint("Staff keep this ledger with you: they set the rent, write notes and put chests up for rent.");
}

function drawStorage()
{
   var chests = listOf(data.chests);
   if (!chests.length)
   {
      flowHint("No chests are up for rent.");
   }
   for (var i = 0; i < chests.length; i++)
   {
      var c = chests[i];
      var state = (STATE_TEXT[c.state] != undefined ? STATE_TEXT[c.state] : String(c.state)) + (c.renter != undefined && c.renter != "" ? ": " + c.renter : "")
         + (c.state == "rented" && Number(c.until) > 0 ? " until " + whenText(c.until) : "");
      flowRow(gold(c.price) + " gold a day", state);
   }
   fieldRow("chest", "A chest's price", "Gold a day, up to " + data.maxChestPrice, true, 4, [["Put a chest up", function() { act("chest", [num("chest")]); }, undefined, busy() || !num("chest")]]);
   flowButtons([["Take a chest off the list", function() { act("chest", ["off"]); }, undefined, busy()]]);
   flowHint("Then close the ledger and open the chest within " + (Number(data.armSeconds) || 60) + " seconds. A rented chest is its renter's alone.");
}

function drawShop()
{
   flowText(data.shopChest == true ? "The shop chest is chosen. Only you and the staff can open it." : "No shop chest yet.", 17);
   var b = [[data.shopChest == true ? "Choose another" : "Make a shop chest", function() { act("shopChest", [""]); }, undefined, busy() || data.shopEnabled == false]];
   if (data.shopChest == true)
   {
      b.push(["Make it a plain chest", function() { act("shopChest", ["off"]); }, undefined, busy()]);
   }
   flowButtons(b);
   flowHint("To choose it, press the button, close the ledger and open the chest within " + (Number(data.shopArmSeconds) || Number(data.armSeconds) || 60) + " seconds. A chest rented out as storage cannot be the shop chest.");
   if (data.shopChest != true)
   {
      return;
   }
   flowHeading("In the shop chest");
   flowHint("A price is gold for one item, " + (Number(data.minPrice) || 1) + " to " + gold(Number(data.maxPrice) || 100000) + ".");
   var stock = listOf(data.shopStock);
   if (data.shopUnreadable == true)
   {
      flowHint("The shop chest cannot be read just now. Try again shortly.");
   }
   else if (!stock.length)
   {
      flowHint("The shop chest is empty. Put goods in it, then price them here.");
   }
   for (var i = 0; i < stock.length; i++)
   {
      var r = stock[i];
      var sub = "x" + r.count + "  ·  " + (r.banned != undefined && r.banned != "" ? "Not for sale: " + r.banned : Number(r.price) > 0 ? gold(r.price) + " gold each" : "No price");
      if (r.banned != undefined && r.banned != "")
      {
         flowEntry(itemText(r), [], sub);
         continue;
      }
      var key = "price:" + r.key;
      var buttons = [["Set", function() { act("shopPrice", [String(this.goods), num("price:" + this.goods)]); }, undefined, busy() || !num(key)]];
      if (Number(r.price) > 0)
      {
         buttons.push(["Off sale", function() { act("shopPrice", [String(this.goods), "off"]); }, undefined, busy()]);
      }
      fieldRow(key, itemText(r), sub, true, 6, buttons);
      var row = flowLast();
      row.btn0.goods = r.key;
      if (row.btn1 != undefined)
      {
         row.btn1.goods = r.key;
      }
   }
   flowHint("Anything without a price is not for sale. Customers buy at this ledger; " + data.hold + " takes " + data.taxPct + "% of every sale and a tenth leaves the game, the rest goes to "
      + (String(data.ownerName).indexOf(", for ") >= 0 ? "the faction's treasury." : "the owner's bank account."));
}

function nudge(dir)
{
   act("nudge", [dir, step]);
}

function drawBook()
{
   var placed = data.ledgerPlaced == true;
   flowHint(placed ? (data.placeMode == true ? "Move it like the Place tool: a copy follows your aim; the arrows turn it and set how far, PgUp and PgDn raise it, Enter sets it down, Backspace stops. Or use the buttons below."
      : "Set the ledger on the counter. Closer, further and the sides follow where you are looking.") : "The ledger has not been placed. Stand where it should be and place it.");
   var top = [];
   if (placed && data.placeMode == true)
   {
      top.push(["Move it like the Place tool", function() { act("placeMode"); }, undefined, busy()]);
   }
   top.push([placed ? "Move it in front of me" : "Place the ledger here", function() { act("place"); }, undefined, busy()]);
   flowButtons(top);
   if (placed)
   {
      flowButtons([["Raise", function() { nudge("up"); }, undefined, busy()], ["Further", function() { nudge("away"); }, undefined, busy()], ["Lower", function() { nudge("down"); }, undefined, busy()]]);
      flowButtons([["Left", function() { nudge("left"); }, undefined, busy()], ["Closer", function() { nudge("closer"); }, undefined, busy()], ["Right", function() { nudge("right"); }, undefined, busy()]]);
      flowButtons([["Turn left", function() { nudge("turnLeft"); }, undefined, busy()], ["Turn right", function() { nudge("turnRight"); }, undefined, busy()]]);
      var chips = [];
      for (var i = 0; i < STEPS.length; i++)
      {
         chips.push(["Step: " + STEPS[i][1], function() { step = this.step; dboSound("UIMenuFocus"); draw(); }, undefined, false, step == STEPS[i][0]]);
      }
      var row = flowButtons(chips);
      for (var j = 0; j < STEPS.length; j++)
      {
         row["btn" + j].step = STEPS[j][0];
      }
   }
   fieldRow("rename", "Rename the business", String(data.name), false, 40, [["Rename", function() { act("rename", [trim(val("rename"))]); }, undefined, busy() || trim(val("rename")) == ""]]);
   if (!confirmClose)
   {
      flowButtons([["Close the business", function() { confirmClose = true; dboSound("UIMenuOK"); draw(); }, C_RED, busy()]]);
      return;
   }
   var e = flowEntry("Close " + data.name + " for good? The property becomes a plain home again.", [["Yes, close it", function() { confirmClose = false; act("close"); }, C_RED, busy()],
      ["Keep it open", function() { confirmClose = false; dboSound("UIMenuCancel"); draw(); }]]);
   e.label.textColor = C_RED;
}

// ---- the head, the tabs, the foot ----

function drawHead()
{
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 16, PANEL_W - PAD * 2, String(data.name));
   var s = dboText(h, "sub", 2, PAD, 58, PANEL_W - PAD * 2, 26, dboFmt(F_MEDIUM, 17, C_SECOND, 0.8), false);
   s.text = "Kept by " + data.ownerName + "  ·  " + data.hold;
   dboDivider(h, PAD, 88, PANEL_W - PAD * 2);
}

function drawTabs()
{
   var t = clear("tabs", 30);
   if (!isStaff())
   {
      return;
   }
   var list = tabs();
   var now = shown();
   var x = PAD;
   for (var j = 0; j < list.length; j++)
   {
      var w = Math.max(120, list[j][1].length * 11 + 30);
      var b = button(t, "t" + j, 10 + j, x, 100, w, list[j][1], F_MEDIUM, 18, list[j][0] == now ? A_FOCUS : A_ROW_REST, function()
      {
         setTab(this.v);
      });
      b.v = list[j][0];
      if (list[j][0] == now)
      {
         dboTabMark(b, w - 30);
      }
      x += w + 8;
   }
}

function drawFoot(pages)
{
   var f = clear("foot", 60);
   var r = dboText(f, "result", 1, PAD, PANEL_H - 112, PANEL_W - PAD * 2, 44, dboFmt(F_MEDIUM, 18, data.resultKind == "refused" ? C_RED : C_GREEN, 0.5), true);
   r.text = data.result != undefined ? String(data.result) : "";
   dboDivider(f, PAD, PANEL_H - 62, PANEL_W - PAD * 2);
   var p = dboText(f, "pages", 2, PAD, PANEL_H - 46, 400, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
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
   drawTabs();
   flowStart(panel, 50, PAD, isStaff() ? BODY_TOP : BODY_TOP - 56);
   var now = shown();
   if (!isStaff())
   {
      drawPublic();
   }
   else if (now == "overview")
   {
      drawOverview();
   }
   else if (now == "logbook")
   {
      drawLogbook();
   }
   else if (now == "log")
   {
      drawLog();
   }
   else if (now == "staff")
   {
      drawStaff();
   }
   else if (now == "storage")
   {
      drawStorage();
   }
   else if (now == "shop")
   {
      drawShop();
   }
   else
   {
      drawBook();
   }
   if (typed != null && boxField != null)
   {
      boxField.text = typed;
   }
   // a box whose row is gone (its goods sold out, its tab gone) gives the keys back
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
   if (p == null || p.nonce == undefined || p.role == undefined)
   {
      dboLog("ledger: unreadable payload");
      return;
   }
   data = p;
   busyAt = 0;
   // a successful action clears what was typed for it, as the browser's does
   if (p.resultKind == "ok")
   {
      endTyping();
      vals = {};
      qty = {};
   }
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
      if (confirmClose)
      {
         confirmClose = false;
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
   else if (code == 9 && isStaff())
   {
      var list = tabs();
      var now = shown();
      for (var i = 0; i < list.length; i++)
      {
         if (list[i][0] == now)
         {
            setTab(list[(i + 1) % list.length][0]);
            break;
         }
      }
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
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("ledger: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
