// The pigeon coop as a native panel (gamemode.js openPigeonCoop, widget 34, the same object the browser coop gets): a port
// of skymp5-front features/pigeon and its Courier tab, same tabs, words and messages. A native panel has no text box, so
// writing a letter, posting a supply order and posting a courier job hand their composer to the browser coop:
// dbo:pigeonCompose [nonce, mode, to] ('send', 'supply', 'courier'); the server brings the native coop back when it is done.
//   Letters:  dbo:pigeonRead | pigeonDelete | pigeonCollect | pigeonBlockLetter [nonce, letterId]
//   Send:     dbo:pigeonSign [nonce, 'clear' | 'unsigned']
//   Supply:   dbo:supplyDeliver [nonce, orderId, count] | supplyCancel [nonce, orderId]
//   Couriers: dbo:courierTake | courierDeliver | courierOpen | courierCancel [nonce, jobId]
//   Close:    dbo:pigeonClose [nonce]

var DBO_SWF_VERSION = "pigeon-1";
var STAGE_W = 1280;
var PANEL_W = 1040;
var PANEL_H = 620;
var PAD = 28;
var LIST_W = 400;
var RIGHT_X = 460;
var RIGHT_W = 552;
var TOP = 150;
var ROW_H = 44;
var PER_PAGE = 8;
var C_RED = 0xB23A3A;
var C_GREEN = 0x8FBF7F;
var NO_DATA_CLOSE_MS = 8000;
var BUSY_MS = 8000;

var panel;
var data = null;
var nonce = "";
var view = "send";
var page = 0;
var letterId = null;
var selectedId = null;
var orderId = null;
var jobId = null;
var handCount = -1;
var asked = "";
var busy = false;
var busyAt = 0;
var pageCount = 1;
var builtAt = getTimer();

function num(v, fallback)
{
   var n = Number(v);
   return isNaN(n) || !isFinite(n) ? fallback : n;
}

function letters()
{
   return listOf(data.letters);
}

function contacts()
{
   return listOf(data.contacts);
}

function supply()
{
   return data.supply != undefined && data.supply != null && data.supply.enabled == true ? data.supply : null;
}

function courier()
{
   return data.courier != undefined && data.courier != null ? data.courier : null;
}

function waitingCount()
{
   var n = 0;
   var ls = letters();
   for (var i = 0; i < ls.length; i++)
   {
      if (ls[i].read != true || (ls[i].parcel != undefined && ls[i].parcel != null))
      {
         n++;
      }
   }
   return n;
}

// A view asked for that this board does not have falls back to the letters, as the browser's does
function shown()
{
   if ((view == "supply" && supply() == null) || (view == "courier" && courier() == null))
   {
      return "letters";
   }
   return view;
}

function parcelText(p)
{
   var parts = [];
   if (num(p.gold, 0) > 0)
   {
      parts.push(p.gold + " gold");
   }
   var items = listOf(p.items);
   for (var i = 0; i < items.length; i++)
   {
      parts.push(items[i].count + " " + items[i].name);
   }
   return parts.join(", ");
}

// ---- the messages ----

function act(key, args)
{
   if (busy)
   {
      return;
   }
   busy = true;
   busyAt = getTimer();
   asked = "";
   dboSound("UIMenuOK");
   dboSend(key, [nonce].concat(args));
   // greyed until the answer, so a click that would do nothing looks it
   draw();
}

function compose(mode, to)
{
   if (busy)
   {
      return;
   }
   busy = true;
   busyAt = getTimer();
   dboSound("UIMenuOK");
   dboSend("dbo:pigeonCompose", [nonce, mode, to]);
   draw();
}

function closeCoop()
{
   dboSound("UIMenuCancel");
   dboSend("dbo:pigeonClose", [nonce]);
   dboClose();
}

// A destructive action asks first: the first press names what it will do, the second does it
function askFirst(key, args, what)
{
   var k = key + ":" + args.join(",");
   if (asked != k)
   {
      asked = k;
      dboSound("UIMenuFocus");
      draw();
      return;
   }
   act(key, args);
}

function confirmLabel(key, args, label, ask)
{
   return asked == key + ":" + args.join(",") ? ask : label;
}

function turnPage(d)
{
   var to = Math.max(0, Math.min(pageCount - 1, page + d));
   if (to == page)
   {
      return;
   }
   dboSound("UIMenuPrevNext");
   page = to;
   draw();
}

function setView(v)
{
   if (v == view)
   {
      return;
   }
   dboSound("UIMenuPrevNext");
   view = v;
   page = 0;
   asked = "";
   draw();
}

// ---- drawing helpers ----

function txt(parent, name, depth, x, y, w, h, size, color, text, multi, font)
{
   var t = dboText(parent, name, depth, x, y, w, h, dboFmt(font != undefined ? font : F_MEDIUM, size, color, 0.8), multi == true);
   t.text = String(text);
   return t;
}

function act2(parent, name, depth, x, y, w, label, onPick, color, off)
{
   var b = button(parent, name, depth, x, y, w, label, F_MEDIUM, 22, A_BUTTON_REST, onPick);
   if (color != undefined)
   {
      b.label.textColor = color;
   }
   if (off == true || busy)
   {
      disable(b);
   }
   return b;
}

// A list row: the label, a grey line under it, bright when chosen
function listRow(parent, i, label, sub, on, onPick, mark)
{
   var b = button(parent, "r" + i, 10 + i, PAD, TOP + i * ROW_H, LIST_W, (mark ? String.fromCharCode(8226) + " " : "") + label, F_MEDIUM, 22, on ? A_FOCUS : A_ROW_REST, onPick);
   b.washW = LIST_W;
   b.washH = ROW_H - 4;
   var s = dboText(b, "sub", 2, 0, 26, LIST_W, 20, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   s.text = String(sub);
   return b;
}

function sectionRow(parent, i, label)
{
   txt(parent, "h" + i, 40 + i, PAD, TOP + i * ROW_H + 14, LIST_W, 24, 16, C_SECOND, label);
}

// Pages of at most PER_PAGE rows; a section heading never ends a page, it goes over with its first row
function pagesOf(rows)
{
   var pages = [[]];
   for (var i = 0; i < rows.length; i++)
   {
      var cur = pages[pages.length - 1];
      var orphan = rows[i][0] == "h" && cur.length == PER_PAGE - 1 && i + 1 < rows.length;
      if (cur.length >= PER_PAGE || (orphan && cur.length > 0))
      {
         cur = [];
         pages.push(cur);
      }
      cur.push(rows[i]);
   }
   return pages;
}

// Rows of [kind, label, sub, on, onPick, mark, key] where kind "h" is a section heading
function drawList(rows, empty)
{
   var l = clear("list", 30);
   var pages = pagesOf(rows);
   if (page >= pages.length)
   {
      page = pages.length - 1;
   }
   if (!rows.length)
   {
      txt(l, "empty", 1, PAD, TOP + 10, LIST_W, 80, 16, C_SECOND, empty, true);
   }
   var shownRows = pages[page];
   for (var i = 0; i < shownRows.length; i++)
   {
      var r = shownRows[i];
      if (r[0] == "h")
      {
         sectionRow(l, i, r[1]);
      }
      else
      {
         var b = listRow(l, i, r[1], r[2], r[3], r[4], r[5]);
         b.key = r[6];
      }
   }
   pageCount = pages.length;
   if (pages.length > 1)
   {
      var y = TOP + PER_PAGE * ROW_H + 4;
      var pt = dboText(l, "more", 60, PAD + 130, y + 6, LIST_W - 260, 22, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8, "center"), false);
      pt.text = "Page " + (page + 1) + " of " + pages.length;
      var pv = button(l, "prev", 61, PAD, y, 120, "Previous", F_MEDIUM, 22, A_BUTTON_REST, function()
      {
         turnPage(-1);
      });
      var nx = button(l, "next", 62, PAD + LIST_W - 120, y, 120, "Next", F_MEDIUM, 22, A_BUTTON_REST, function()
      {
         turnPage(1);
      });
      if (page == 0)
      {
         disable(pv);
      }
      if (page >= pages.length - 1)
      {
         disable(nx);
      }
   }
}

// ---- the tabs ----

function lettersRows()
{
   var out = [];
   var ls = letters();
   for (var i = 0; i < ls.length; i++)
   {
      var l = ls[i];
      var hasParcel = l.parcel != undefined && l.parcel != null;
      var row = ["r", String(l.from), (hasParcel ? "Parcel " + String.fromCharCode(183) + " " : "") + whenText(l.at), l.id == letterId, function()
      {
         openLetter(this.key);
      }, l.read != true || hasParcel, l.id];
      out.push(row);
   }
   return out;
}

function openLetter(id)
{
   dboSound("UIMenuOK");
   letterId = id;
   asked = "";
   var ls = letters();
   for (var i = 0; i < ls.length; i++)
   {
      if (ls[i].id == id && ls[i].read != true)
      {
         dboSend("dbo:pigeonRead", [nonce, id]);
      }
   }
   draw();
}

function drawLetters(r)
{
   var ls = letters();
   drawList(lettersRows(), "No letters wait for you here.");
   var l = null;
   for (var i = 0; i < ls.length; i++)
   {
      if (ls[i].id == letterId)
      {
         l = ls[i];
      }
   }
   if (l == null)
   {
      txt(r, "empty", 1, RIGHT_X, TOP + 10, RIGHT_W, 60, 16, C_SECOND, ls.length ? "Choose a letter to read it." : "When a pigeon brings you a letter, you read it here.", true);
      return;
   }
   txt(r, "head", 1, RIGHT_X, TOP, RIGHT_W, 26, 16, C_SECOND, "From " + l.from + ", " + whenText(l.at));
   var body = txt(r, "body", 2, RIGHT_X, TOP + 30, RIGHT_W, 250, 22, C_TEXT, l.text, true);
   var y = TOP + 290;
   var hasParcel = l.parcel != undefined && l.parcel != null;
   if (hasParcel)
   {
      txt(r, "parcel", 3, RIGHT_X, y, RIGHT_W, 26, 16, C_TEXT, "With it: " + parcelText(l.parcel));
      y += 32;
   }
   if (hasParcel)
   {
      act2(r, "collect", 10, RIGHT_X, y, 260, "Collect the parcel", function()
      {
         act("dbo:pigeonCollect", [letterId]);
      });
   }
   else
   {
      act2(r, "burn", 10, RIGHT_X, y, 260, confirmLabel("dbo:pigeonDelete", [letterId], "Burn this letter", "Burn it for good?"), function()
      {
         askFirst("dbo:pigeonDelete", [letterId]);
      });
   }
   act2(r, "ignore", 11, RIGHT_X + 280, y, 260, "Ignore this sender", function()
   {
      act("dbo:pigeonBlockLetter", [letterId]);
   });
   txt(r, "ignoreHint", 12, RIGHT_X, y + 40, RIGHT_W, 40, 16, C_SECOND, "Pigeons from whoever wrote this letter are ignored; again lets them through.", true);
}

function chosenContact()
{
   var cs = contacts();
   for (var i = 0; i < cs.length; i++)
   {
      if (cs[i].id == selectedId)
      {
         return cs[i];
      }
   }
   return null;
}

function drawSend(r)
{
   var cs = contacts();
   var rows = [];
   for (var i = 0; i < cs.length; i++)
   {
      var c = cs[i];
      rows.push(["r", c.name + " #" + c.tag, (c.online == true ? "In the land" : "Away") + " " + String.fromCharCode(183) + " " + c.price + " gold", c.id == selectedId, function()
      {
         dboSound("UIMenuOK");
         selectedId = this.key;
         draw();
      }, false, c.id]);
   }
   drawList(rows, "Your pigeon only knows the way to people you have met. Stand and speak with someone first.");
   var chosen = chosenContact();
   var waiting = num(data.cooldownMinutes, 0) > 0;
   if (chosen != null)
   {
      txt(r, "who", 1, RIGHT_X, TOP, RIGHT_W, 30, 22, C_TEXT, "A letter for " + chosen.name);
   }
   txt(r, "how", 2, RIGHT_X, TOP + 36, RIGHT_W, 70, 16, C_SECOND, "A letter is written in the coop's window: what it says, how it is signed, and any gold or goods it carries.", true);
   var label = waiting ? "Pigeon is out" : chosen == null ? "Choose someone" : "Write to " + chosen.name + "...";
   act2(r, "write", 10, RIGHT_X, TOP + 110, RIGHT_W, label, function()
   {
      compose("send", selectedId);
   }, undefined, waiting || chosen == null);
   txt(r, "signLabel", 3, RIGHT_X, TOP + 168, 120, 26, 16, C_SECOND, "Sign as");
   act2(r, "signOwn", 11, RIGHT_X + 120, TOP + 162, 200, "Your name", function()
   {
      act("dbo:pigeonSign", ["clear"]);
   });
   act2(r, "signNone", 12, RIGHT_X + 340, TOP + 162, 200, "Unsigned", function()
   {
      act("dbo:pigeonSign", ["unsigned"]);
   });
   act2(r, "signOther", 13, RIGHT_X + 120, TOP + 204, 420, "Another name...", function()
   {
      compose("send", selectedId == null ? 0 : selectedId);
   });
   txt(r, "signHint", 4, RIGHT_X, TOP + 248, RIGHT_W, 40, 16, C_SECOND, "Another name is typed in the coop's window, even while your pigeon is out.", true);
}

function supplyOrders()
{
   var s = supply();
   return s == null ? [] : listOf(s.orders).concat(listOf(s.mine));
}

function chosenOrder()
{
   var all = supplyOrders();
   for (var i = 0; i < all.length; i++)
   {
      if (all[i].id == orderId)
      {
         return all[i];
      }
   }
   return null;
}

function orderSub(o)
{
   var st = o.state == "open" ? o.perUnit + " gold each " + String.fromCharCode(183) + " " + o.hoursLeft + " h left" : o.state == "done" ? "Filled" : o.state == "expired" ? "Ran out" : "Taken down";
   return st + (o.mine == true ? "" : " " + String.fromCharCode(183) + " " + o.poster);
}

function drawSupply(r)
{
   var s = supply();
   var mine = listOf(s.mine);
   var others = [];
   var os = listOf(s.orders);
   for (var k = 0; k < os.length; k++)
   {
      if (os[k].mine != true)
      {
         others.push(os[k]);
      }
   }
   var openMine = 0;
   for (var m = 0; m < mine.length; m++)
   {
      if (mine[m].state == "open")
      {
         openMine++;
      }
   }
   var rows = [["h", "Your orders (" + openMine + " of " + s.maxOpen + ")"]];
   var pick = function()
   {
      dboSound("UIMenuOK");
      orderId = this.key;
      handCount = -1;
      asked = "";
      draw();
   };
   for (var i = 0; i < mine.length; i++)
   {
      rows.push(["r", (mine[i].count - mine[i].filled) + " " + mine[i].name, orderSub(mine[i]), mine[i].id == orderId, pick, false, mine[i].id]);
   }
   if (!mine.length)
   {
      rows.push(["h", "You have no orders up."]);
   }
   rows.push(["h", "On the " + (s.zone != undefined && s.zone != "" ? s.zone : data.boardName) + " boards"]);
   for (var j = 0; j < others.length; j++)
   {
      rows.push(["r", (others[j].count - others[j].filled) + " " + others[j].name, orderSub(others[j]), others[j].id == orderId, pick, false, others[j].id]);
   }
   if (!others.length)
   {
      rows.push(["h", "No one has posted an order here."]);
   }
   drawList(rows, "");
   var o = chosenOrder();
   if (o == null)
   {
      txt(r, "head", 1, RIGHT_X, TOP, RIGHT_W, 30, 22, C_TEXT, "Post a supply order");
      txt(r, "how", 2, RIGHT_X, TOP + 36, RIGHT_W, 70, 16, C_SECOND, "Post an order and the board holds your reward. You are sent the goods; whoever brings them is paid.", true);
      act2(r, "post", 10, RIGHT_X, TOP + 110, RIGHT_W, "Post an order...", function()
      {
         compose("supply", 0);
      });
      txt(r, "rules", 3, RIGHT_X, TOP + 156, RIGHT_W, 40, 16, C_SECOND, "Up to " + s.maxCount + "; open " + s.openDays + " days; " + Math.round(num(s.feeShare, 0) * 100) + "% to post, at least " + s.minFee + ".", true);
      return;
   }
   txt(r, "head", 1, RIGHT_X, TOP, RIGHT_W, 30, 22, C_TEXT, o.count + " " + o.name + ", " + o.filled + " brought");
   txt(r, "note", 2, RIGHT_X, TOP + 36, RIGHT_W, 70, 16, C_SECOND, o.reward + " gold for the lot, " + o.perUnit + " each. " + o.held + " gold still held. Posted by " + o.poster + " at " + o.zone + ".", true);
   if (o.mine == true)
   {
      if (o.state == "open")
      {
         act2(r, "cancel", 10, RIGHT_X, TOP + 110, 260, confirmLabel("dbo:supplyCancel", [o.id], "Take it down", "Take it down for good?"), function()
         {
            askFirst("dbo:supplyCancel", [orderId]);
         });
         txt(r, "cancelHint", 3, RIGHT_X, TOP + 150, RIGHT_W, 40, 16, C_SECOND, "The rest of the reward comes to your mailbox; the fee does not.", true);
      }
   }
   else
   {
      var left = o.count - o.filled;
      var have = num(o.have, 0);
      if (handCount < 0)
      {
         handCount = Math.min(have, left);
      }
      handCount = Math.max(0, Math.min(handCount, left, have));
      txt(r, "carry", 3, RIGHT_X, TOP + 116, 200, 26, 16, C_SECOND, "You carry " + have);
      act2(r, "less", 11, RIGHT_X + 200, TOP + 110, 60, "-", function()
      {
         dboSound("UIMenuFocus");
         handCount = Math.max(1, handCount - 1);
         draw();
      }, undefined, handCount <= 1);
      act2(r, "more", 12, RIGHT_X + 270, TOP + 110, 60, "+", function()
      {
         dboSound("UIMenuFocus");
         handCount++;
         draw();
      }, undefined, handCount >= Math.min(have, left));
      act2(r, "deliver", 13, RIGHT_X + 340, TOP + 110, RIGHT_W - 340, "Hand over " + handCount, function()
      {
         act("dbo:supplyDeliver", [orderId, handCount]);
      }, undefined, have < 1 || handCount < 1);
   }
   act2(r, "back", 14, RIGHT_X, TOP + 210, RIGHT_W, "Post an order instead", function()
   {
      dboSound("UIMenuOK");
      orderId = null;
      draw();
   });
}

var STATE = {open: "On the board", carried: "On the road", robbed: "Robbed", delivered: "Delivered", expired: "Ran out of time", lapsed: "No courier came",
   cancelled: "Taken down", returned: "Came back", recovered: "Found unopened", opened: "Robbed", lost: "Lost", cleared: "Cleared"};

function stateText(s)
{
   return STATE[s] != undefined ? STATE[s] : String(s);
}

function jobLeft(j)
{
   if (j.state == "carried")
   {
      var h = num(j.gameHoursLeft, 0);
      return (h >= 24 ? Math.floor(h / 24) + " d " + (h % 24) + " h" : h + " h") + " left";
   }
   return j.state == "open" ? j.hoursLeft + " h on the board" : "";
}

function jobSub(j)
{
   var dot = " " + String.fromCharCode(183) + " ";
   return (j.state == "open" || j.state == "carried" ? jobLeft(j) : stateText(j.state)) + (num(j.insured, 0) > 0 ? dot + "insured" : "") + (j.here == true ? dot + "deliver here" : "");
}

function courierJobs()
{
   var c = courier();
   return listOf(c.open).concat(listOf(c.carrying), listOf(c.broken), listOf(c.mine));
}

function chosenJob()
{
   var all = courierJobs();
   for (var i = 0; i < all.length; i++)
   {
      if (all[i].id == jobId)
      {
         return all[i];
      }
   }
   return null;
}

function drawCourier(r)
{
   var c = courier();
   var rows = [];
   var pick = function()
   {
      dboSound("UIMenuOK");
      jobId = this.key;
      asked = "";
      draw();
   };
   var add = function(list)
   {
      for (var i = 0; i < list.length; i++)
      {
         rows.push(["r", list[i].pay + " gold " + String.fromCharCode(183) + " " + list[i].dest, jobSub(list[i]), list[i].id == jobId, pick, false, list[i].id]);
      }
   };
   if (c.rank != undefined && c.rank != null)
   {
      rows.push(["h", c.rank.name + " courier " + String.fromCharCode(183) + " " + c.rank.delivered + " " + (c.rank.delivered == 1 ? "delivery" : "deliveries") + (c.rank.next != undefined && c.rank.next != null ? " " + String.fromCharCode(183) + " " + c.rank.next.name + " at " + c.rank.next.at : "")]);
      if (c.rank.line != undefined && c.rank.line != null && c.rank.line != "")
      {
         rows.push(["h", String(c.rank.line)]);
      }
   }
   var carrying = listOf(c.carrying);
   if (carrying.length)
   {
      rows.push(["h", "You carry (" + carrying.length + " of " + c.rules.maxCarried + ")"]);
      add(carrying);
   }
   var broken = listOf(c.broken);
   if (broken.length)
   {
      rows.push(["h", "Broken parcels"]);
      add(broken);
   }
   rows.push(["h", "Wanted at " + (c.place != undefined && c.place != "" ? c.place : "this board")]);
   var others = [];
   var open = listOf(c.open);
   for (var k = 0; k < open.length; k++)
   {
      if (open[k].mine != true)
      {
         others.push(open[k]);
      }
   }
   add(others);
   if (!others.length)
   {
      rows.push(["h", "No one wants a courier here just now."]);
   }
   rows.push(["h", "Your parcels"]);
   add(listOf(c.mine));
   if (!listOf(c.mine).length)
   {
      rows.push(["h", "You have sent nothing by courier."]);
   }
   drawList(rows, "");
   var j = chosenJob();
   if (j == null)
   {
      if (c.enabled != true)
      {
         txt(r, "off", 1, RIGHT_X, TOP + 10, RIGHT_W, 40, 16, C_SECOND, "No courier takes work here yet.", true);
         return;
      }
      txt(r, "head", 1, RIGHT_X, TOP, RIGHT_W, 30, 22, C_TEXT, "Send goods by courier");
      var days = num(c.rules.limitGameDays, 1);
      txt(r, "how", 2, RIGHT_X, TOP + 36, RIGHT_W, 70, 16, C_SECOND, Math.round(num(c.rules.feeShare, 0) * 100) + "% of the pay to post (at least " + c.rules.minFee + "); insurance " + Math.round(num(c.rules.premiumRate, 0) * 100) + "% of the value, paid by " + (c.place != undefined && c.place != "" ? c.place : "the hold") + " if it is robbed. Up to " + c.rules.maxStacks + " kinds; the courier has " + days + " " + (days == 1 ? "day" : "days") + ".", true);
      act2(r, "post", 10, RIGHT_X, TOP + 120, RIGHT_W, "Send a parcel by courier...", function()
      {
         compose("courier", 0);
      });
      return;
   }
   var days2 = num(c.rules.limitGameDays, 1);
   txt(r, "head", 1, RIGHT_X, TOP, RIGHT_W, 30, 22, C_TEXT, "For " + j.dest + ", " + j.pay + " gold");
   txt(r, "goods", 2, RIGHT_X, TOP + 36, RIGHT_W, 50, 22, C_TEXT, j.state == "robbed" && j.mine != true ? "A broken parcel. Open it to see what is inside." : j.goods, true);
   txt(r, "from", 3, RIGHT_X, TOP + 90, RIGHT_W, 60, 16, C_SECOND, "From " + j.sender + " to " + j.recipient + ", posted at " + j.origin + ". " + stateText(j.state) + (num(j.insured, 0) > 0 ? ", insured for " + j.insured + " gold" : "") + "." + (j.state == "carried" && j.mine != true ? " " + jobLeft(j) + " (" + Math.round(num(j.hoursLeft, 0)) + " real hours)." : ""), true);
   var y = TOP + 160;
   if (j.state == "open" && j.mine != true)
   {
      act2(r, "take", 10, RIGHT_X, y, 320, "Carry it (" + days2 + " " + (days2 == 1 ? "day" : "days") + ")", function()
      {
         act("dbo:courierTake", [jobId]);
      }, undefined, c.enabled != true);
   }
   if (j.state == "open" && j.mine == true)
   {
      act2(r, "cancel", 10, RIGHT_X, y, 320, confirmLabel("dbo:courierCancel", [j.id], "Take it down", "Take it down for good?"), function()
      {
         askFirst("dbo:courierCancel", [jobId]);
      });
      txt(r, "cancelHint", 4, RIGHT_X, y + 40, RIGHT_W, 40, 16, C_SECOND, "The goods and the pay come back to your mailbox; the fee and the insurance do not.", true);
   }
   if (j.state == "carried" && j.kind == "board" && j.here == true)
   {
      act2(r, "deliver", 10, RIGHT_X, y, 320, "Deliver it here", function()
      {
         act("dbo:courierDeliver", [jobId]);
      });
   }
   if (j.state == "robbed" && j.mine != true)
   {
      act2(r, "open", 10, RIGHT_X, y, 320, "Break it open", function()
      {
         act("dbo:courierOpen", [jobId]);
      });
   }
   if (j.state == "carried" && j.kind == "person" && j.mine != true)
   {
      txt(r, "person", 5, RIGHT_X, y + 40, RIGHT_W, 40, 16, C_SECOND, "Find " + j.recipient + " and offer it to them (X on them).", true);
   }
   if (j.state == "carried" && j.kind == "drop" && j.mine != true)
   {
      txt(r, "drop", 6, RIGHT_X, y + 40, RIGHT_W, 40, 16, C_SECOND, "Hand it in at " + j.dest + ".", true);
   }
   act2(r, "back", 14, RIGHT_X, TOP + 260, RIGHT_W, "Send a parcel instead", function()
   {
      dboSound("UIMenuOK");
      jobId = null;
      draw();
   });
}

// ---- the frame ----

function drawTabs()
{
   var h = clear("tabs", 20);
   var tabs = [["letters", "Letters" + (waitingCount() ? " (" + waitingCount() + ")" : "")], ["send", "Send a pigeon"]];
   if (supply() != null)
   {
      tabs.push(["supply", "Supply orders"]);
   }
   if (courier() != null)
   {
      tabs.push(["courier", "Couriers" + (listOf(courier().carrying).length ? " (" + listOf(courier().carrying).length + ")" : "")]);
   }
   var x = PAD;
   for (var i = 0; i < tabs.length; i++)
   {
      var w = Math.max(150, tabs[i][1].length * 12 + 30);
      var b = button(h, "t" + i, 10 + i, x, 66, w, tabs[i][1], F_MEDIUM, 22, tabs[i][0] == shown() ? A_FOCUS : A_ROW_REST, function()
      {
         setView(this.v);
      });
      b.v = tabs[i][0];
      if (tabs[i][0] == shown())
      {
         dboTabMark(b, w - 30);
      }
      x += w + 10;
   }
   dboDivider(h, PAD, 104, PANEL_W - PAD * 2);
   if (data.result != undefined && data.result != null && data.result != "")
   {
      var res = txt(h, "result", 30, PAD, 112, PANEL_W - PAD * 2, 30, 16, data.resultKind == "refused" ? C_RED : C_GREEN, data.result, true);
   }
}

function hintText()
{
   var s = shown();
   if (s == "letters")
   {
      var w = waitingCount();
      return w ? w + " letter" + (w == 1 ? "" : "s") + " waiting." : "All letters read.";
   }
   if (s == "supply")
   {
      return "Post an order and the board holds your reward. You are sent the goods; whoever brings them is paid.";
   }
   if (s == "courier")
   {
      return courier().enabled == true ? "Couriers carry goods for pay. The board holds the goods and the pay until the parcel arrives." : "No courier takes work here yet.";
   }
   if (num(data.cooldownMinutes, 0) > 0)
   {
      return "Your pigeon is still out. The next one can fly in " + data.cooldownMinutes + " min.";
   }
   var c = chosenContact();
   return c != null ? "A pigeon to " + c.name + " costs " + c.price + " gold. You carry " + data.gold + " gold." : "The farther the bird flies, the more it costs.";
}

function draw()
{
   actions = [];
   focus = -1;
   var t = clear("title", 10);
   dboTitle(t, "text", 1, PAD, 16, PANEL_W - PAD * 2, data.boardName + " Pigeon Coop");
   drawTabs();
   var r = clear("right", 40);
   var s = shown();
   if (s == "letters")
   {
      drawLetters(r);
   }
   else if (s == "courier")
   {
      drawCourier(r);
   }
   else if (s == "supply")
   {
      drawSupply(r);
   }
   else
   {
      drawSend(r);
   }
   var f = clear("foot", 60);
   dboDivider(f, PAD, PANEL_H - 62, PANEL_W - PAD * 2);
   txt(f, "hint", 1, PAD, PANEL_H - 50, PANEL_W - PAD * 2 - 160, 40, 16, C_SECOND, hintText(), true);
   button(f, "close", 2, PANEL_W - PAD - 130, PANEL_H - 50, 130, "Close", F_MEDIUM, 22, A_BUTTON_REST, function()
   {
      closeCoop();
   });
}

// A fresh window from the server (a new nonce) ends the wait; choices that are gone are let go
function take(p)
{
   var fresh = data == null || String(p.nonce) != nonce;
   data = p;
   nonce = String(p.nonce);
   if (fresh)
   {
      busy = false;
      asked = "";
      if (p.view != undefined && p.view != null && p.view != "")
      {
         view = String(p.view);
      }
   }
   var cs = contacts();
   var keep = false;
   for (var i = 0; i < cs.length; i++)
   {
      if (cs[i].id == selectedId)
      {
         keep = true;
      }
   }
   if (!keep)
   {
      selectedId = cs.length ? cs[0].id : null;
   }
   var stillLetter = false;
   var ls = letters();
   for (var j = 0; j < ls.length; j++)
   {
      if (ls[j].id == letterId)
      {
         stillLetter = true;
      }
   }
   if (!stillLetter)
   {
      letterId = null;
   }
   if (chosenOrder() == null)
   {
      orderId = null;
   }
   if (courier() != null && chosenJob() == null)
   {
      jobId = null;
   }
   if (p.resultKind == "sent" && view == "supply")
   {
      handCount = -1;
   }
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   // scaled into what the player sees: 21:9 and 16:10 crop the 1280 x 720 stage
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 50, 160, 320);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || p.type != "pigeon" || !(p.contacts instanceof Array))
   {
      dboLog("pigeon: unreadable payload");
      return;
   }
   take(p);
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (code == 27)
   {
      if (data != null)
      {
         closeCoop();
      }
      else
      {
         dboClose();
      }
      return;
   }
   if (data == null)
   {
      return;
   }
   if (code == 38 || code == 87)
   {
      if (actions.length)
      {
         setFocus(focus <= 0 ? actions.length - 1 : focus - 1);
      }
   }
   else if (code == 40 || code == 83)
   {
      if (actions.length)
      {
         setFocus(focus < 0 || focus >= actions.length - 1 ? 0 : focus + 1);
      }
   }
   else if ((code == 13 || code == 69) && focus >= 0 && actions[focus].disabled != true)
   {
      actions[focus].onPick();
   }
   else if (code == 37 || code == 39)
   {
      var order = ["letters", "send"];
      if (supply() != null)
      {
         order.push("supply");
      }
      if (courier() != null)
      {
         order.push("courier");
      }
      var at = 0;
      for (var i = 0; i < order.length; i++)
      {
         if (order[i] == shown())
         {
            at = i;
         }
      }
      setView(order[(at + (code == 39 ? 1 : order.length - 1)) % order.length]);
   }
   else if (code == 33)
   {
      turnPage(-1);
   }
   else if (code == 34)
   {
      turnPage(1);
   }
};
Key.addListener(keys);

var wheel = {};
wheel.onMouseWheel = function(delta)
{
   if (data != null)
   {
      turnPage(delta > 0 ? -1 : 1);
   }
};
Mouse.addListener(wheel);

// Some answers are only a line in chat and no redraw (no board in reach, a letter already gone, a stale nonce): the
// wait lapses rather than leave every button grey
_root.onEnterFrame = function()
{
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("pigeon: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
      delete _root.onEnterFrame;
      dboClose();
      return;
   }
   if (busy && getTimer() - busyAt >= BUSY_MS)
   {
      busy = false;
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
