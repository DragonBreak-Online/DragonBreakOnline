// The player-to-player trade window as a native panel (tradeService.ts, widget 14: the same object skymp5-front
// features/trade gets). Your goods, your offer and the partner's offer are three tabs; a stack asks how many before it
// moves; gold is set as one amount. Accept locks the offer first and accepts once the server has the lock, as the
// browser's does. The keys go out as the widget's own events (trade:add, trade:remove, ...), which tradeService
// handles exactly as it handles the browser's; every change comes back as a new payload from the server's tradeState.

var DBO_SWF_VERSION = "trade-2";
// work and trade wear bronze, as the web trade window does (dbo-theme.scss)
webLook("bronze");
var PANEL_W = 1100;
var PANEL_H = 640;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
var BODY_TOP = 212;
BODY_H = PANEL_H - 104 - BODY_TOP - 6;
var ROW_H = 40;
var PER_PAGE = Math.floor(BODY_H / ROW_H);
var NO_DATA_CLOSE_MS = 8000;
// Gold001, and the server's confirm delay (tradeConfirmDelayMs default), as the browser's
var GOLD_BASE_ID = 0xf;
var CONFIRM_SECONDS = 3;
var RESET_NOTE_MS = 5000;
var C_RED = 0xB23A3A;
var C_GREEN = 0x7FBF7F;
var CATEGORIES = [["weapons", "Weapons"], ["armour", "Armour"], ["clothing", "Clothing"], ["jewellery", "Jewellery"],
   ["potions", "Potions"], ["poisons", "Poisons"], ["ingredients", "Ingredients"], ["food", "Food"], ["books", "Books"], ["scrolls", "Scrolls"],
   ["soulgems", "Soul gems"], ["ingots", "Ingots & ore"], ["keys", "Keys"], ["misc", "Misc"]];
var SORTS = [["name", "Name"], ["value", "Value"], ["weight", "Weight"]];
var PROMPT_STEPS = [[-10, "-10"], [-1, "-1"], [1, "+1"], [10, "+10"]];
var GOLD_STEPS = [[-100, "-100"], [-10, "-10"], [10, "+10"], [100, "+100"]];

var panel;
var data = null;
var tab = "goods";
var page = 0;
var cat = "";
var sortBy = "name";
var search = "";
// prompt: the stack waiting for "how many", {dir: "add" or "remove", item, n}
var prompt = null;
// typing: "search" or "gold" while that box is open
var typing = "";
// goldWant: the gold amount being set, -1 while it shows what is offered
var goldWant = -1;
var acceptAfterLock = false;
var resetAt = 0;
var bothAt = 0;
var shownCount = -1;
// focusConfirm: a stack prompt just opened, so its Confirm takes the focus once
var focusConfirm = false;
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

function weightText(n)
{
   return String(Math.round((Number(n) || 0) * 10) / 10);
}

function ev(name)
{
   return data != null && data.events != undefined && data.events[name] != undefined ? String(data.events[name]) : "trade:" + name;
}

function send(name, args)
{
   dboSend(ev(name), args != undefined ? args : []);
}

function partner()
{
   return data.partnerName != undefined && data.partnerName != "" ? String(data.partnerName) : "Player";
}

function goldIn(items)
{
   for (var i = 0; i < items.length; i++)
   {
      if (Number(items[i].baseId) == GOLD_BASE_ID && listOf(items[i].tags).length == 0)
      {
         return items[i];
      }
   }
   return null;
}

function offerKey(items)
{
   var keys = [];
   for (var i = 0; i < items.length; i++)
   {
      keys.push(items[i].lineId + "x" + items[i].count);
   }
   keys.sort();
   return keys.join(",");
}

function bothAccepted()
{
   return data.iAccepted == true && data.theyAccepted == true;
}

function closeMenu()
{
   endTyping();
   dboSound("UIMenuCancel");
   send("cancel");
   dboClose();
}

function setTab(t)
{
   endTyping();
   prompt = null;
   tab = t;
   page = 0;
   dboSound("UIMenuPrevNext");
   draw();
}

// ---- the goods list: category, search, sort ----

function presentCategories()
{
   var have = {};
   var inv = listOf(data.inventory);
   for (var i = 0; i < inv.length; i++)
   {
      have[String(inv[i].cat)] = true;
   }
   var out = [];
   for (var j = 0; j < CATEGORIES.length; j++)
   {
      if (have[CATEGORIES[j][0]] == true)
      {
         out.push(CATEGORIES[j]);
      }
   }
   return out;
}

// The chosen category while something is still in it, else all
function shownCat()
{
   var cats = presentCategories();
   for (var i = 0; i < cats.length; i++)
   {
      if (cats[i][0] == cat)
      {
         return cat;
      }
   }
   return "";
}

function matches(items)
{
   var f = search.toLowerCase();
   if (f == "")
   {
      return items;
   }
   var out = [];
   for (var i = 0; i < items.length; i++)
   {
      if (String(items[i].name).toLowerCase().indexOf(f) >= 0)
      {
         out.push(items[i]);
      }
   }
   return out;
}

// Each name is lowered once, not in every comparison: AS2 is slow at strings, and a full pack is hundreds of lines
function sorted(items)
{
   var list = [];
   for (var i = 0; i < items.length; i++)
   {
      list.push({k: String(items[i].name).toLowerCase(), v: Number(items[i].value) || 0, w: Number(items[i].weight) || 0, item: items[i]});
   }
   var byKey = function(a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : 0; };
   if (sortBy == "value")
   {
      list.sort(function(a, b) { return b.v - a.v || byKey(a, b); });
   }
   else if (sortBy == "weight")
   {
      list.sort(function(a, b) { return b.w - a.w || byKey(a, b); });
   }
   else
   {
      list.sort(byKey);
   }
   var out = [];
   for (var j = 0; j < list.length; j++)
   {
      out.push(list[j].item);
   }
   return out;
}

// The goods list is filtered and sorted once per payload, category, sort or search, not on every draw and page turn
var dataSeq = 0;
var goodsKey = "";
var goodsList = [];

function goods()
{
   var c = shownCat();
   var key = dataSeq + "|" + c + "|" + sortBy + "|" + search;
   if (key == goodsKey)
   {
      return goodsList;
   }
   var inv = listOf(data.inventory);
   var out = [];
   for (var i = 0; i < inv.length; i++)
   {
      if (c == "" || String(inv[i].cat) == c)
      {
         out.push(inv[i]);
      }
   }
   goodsKey = key;
   goodsList = sorted(matches(out));
   return goodsList;
}

function nextOf(list, now)
{
   for (var i = 0; i < list.length; i++)
   {
      if (list[i][0] == now)
      {
         return list[(i + 1) % list.length][0];
      }
   }
   return list[0][0];
}

function labelOf(list, now, none)
{
   for (var i = 0; i < list.length; i++)
   {
      if (list[i][0] == now)
      {
         return list[i][1];
      }
   }
   return none;
}

// ---- moving a stack ----

// A single item moves at once; a stack asks how many first
function pick(dir, item)
{
   if (Number(item.count) > (Number(data.stackPromptThreshold) || 1))
   {
      endTyping();
      prompt = {dir: dir, item: item, n: 1};
      focusConfirm = true;
      dboSound("UIMenuOK");
      draw();
      return;
   }
   dboSound("UIMenuOK");
   send(dir, [String(item.lineId), Number(item.count)]);
}

function promptSet(n)
{
   prompt.n = Math.max(1, Math.min(Number(prompt.item.count), Math.floor(n)));
   dboSound("UIMenuFocus");
   // only the count changes: it is rewritten in place, nothing is redrawn
   panel.tools.value.text = prompt.n + " of " + prompt.item.count;
}

function promptConfirm()
{
   var p = prompt;
   prompt = null;
   dboSound("UIMenuOK");
   send(p.dir, [String(p.item.lineId), Math.max(1, Math.min(p.n, Number(p.item.count)))]);
   draw();
}

// A payload moved things: the waiting stack keeps its prompt only while it is still there to move
function promptStillThere()
{
   if (prompt == null)
   {
      return;
   }
   var list = listOf(prompt.dir == "add" ? data.inventory : data.myOffer);
   for (var i = 0; i < list.length; i++)
   {
      if (String(list[i].lineId) == String(prompt.item.lineId))
      {
         if (prompt.dir == "remove" && data.myLocked == true)
         {
            break;
         }
         prompt.item = list[i];
         prompt.n = Math.min(prompt.n, Number(list[i].count));
         return;
      }
   }
   prompt = null;
}

// ---- gold: one amount, sent as the difference to what is offered ----

function goldOffered()
{
   var g = goldIn(listOf(data.myOffer));
   return g != null ? Number(g.count) : 0;
}

function goldTotal()
{
   var g = goldIn(listOf(data.inventory));
   return goldOffered() + (g != null ? Number(g.count) : 0);
}

function goldShown()
{
   return goldWant >= 0 ? goldWant : goldOffered();
}

function setGold()
{
   var want = Math.max(0, Math.min(goldTotal(), goldShown()));
   var offered = goldOffered();
   var line = goldIn(listOf(data.myOffer));
   if (line == null)
   {
      line = goldIn(listOf(data.inventory));
   }
   goldWant = -1;
   if (line == null || want == offered)
   {
      draw();
      return;
   }
   dboSound("UIMenuOK");
   send(want > offered ? "add" : "remove", [String(line.lineId), Math.abs(want - offered)]);
   draw();
}

// ---- accepting ----

// One press accepts: lock first, then accept once the server confirms the lock
function accept()
{
   resetAt = 0;
   dboSound("UIMenuOK");
   if (data.myLocked == true)
   {
      send("accept");
   }
   else
   {
      acceptAfterLock = true;
      send("lock");
   }
   draw();
}

function statusText(who, accepted, locked)
{
   return accepted ? who + " accepted" : locked ? who + " locked, not accepted" : who + " still choosing";
}

function countdown()
{
   return Math.max(0, CONFIRM_SECONDS - Math.floor((getTimer() - bothAt) / 1000));
}

function bannerText()
{
   if (bothAccepted())
   {
      var n = countdown();
      return n > 0 ? "Both accepted. Trading in " + n + "..." : "Both accepted. Trading...";
   }
   if (data.iAccepted == true)
   {
      return "You accepted. Waiting for " + partner() + " to accept.";
   }
   if (data.theyAccepted == true)
   {
      return partner() + " accepted. Review their offer and accept to trade.";
   }
   if (resetShown())
   {
      return "An offer changed, so acceptance was reset. Review both offers again.";
   }
   return "Add items, review both offers, then press Accept.";
}

function resetShown()
{
   return resetAt > 0 && getTimer() - resetAt < RESET_NOTE_MS;
}

// ---- the head and tabs ----

function drawHead()
{
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 16, PANEL_W - PAD * 2, "Trade with " + partner());
   var color = bothAccepted() ? C_GREEN : resetShown() && data.iAccepted != true && data.theyAccepted != true ? C_RED : C_TEXT;
   // the web's banner: a faint box of the domain hue, edged in it
   var bw = PANEL_W - PAD * 2;
   dboBox(h, PAD, 56, bw, 30, C_ACCENT, 8);
   dboBox(h, PAD, 56, bw, 1, C_ACCENT, 25);
   dboBox(h, PAD, 85, bw, 1, C_ACCENT, 25);
   var b = dboText(h, "banner", 2, PAD + 10, 58, bw - 20, 28, dboFmt(F_MEDIUM, 18, color, 0.8), false);
   b.text = bannerText();
   var s = dboText(h, "status", 3, PAD, 88, PANEL_W - PAD * 2, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.8), false);
   s.text = statusText("You", data.iAccepted == true, data.myLocked == true) + "     " + statusText(partner(), data.theyAccepted == true, data.theirLocked == true);
   webDivider(h, PAD, 114, PANEL_W - PAD * 2);
   shownCount = bothAccepted() ? countdown() : -1;
}

function lockMark(accepted, locked)
{
   return accepted ? "  [accepted]" : locked ? "  [locked]" : "";
}

function drawTabs()
{
   var t = clear("tabs", 30);
   var list = [["goods", "Your goods (" + listOf(data.inventory).length + ")"],
      ["mine", "Your offer (" + listOf(data.myOffer).length + ")" + lockMark(data.iAccepted == true, data.myLocked == true)],
      ["theirs", partner() + "'s offer (" + listOf(data.theirOffer).length + ")" + lockMark(data.theyAccepted == true, data.theirLocked == true)]];
   var x = PAD;
   for (var j = 0; j < list.length; j++)
   {
      var w = Math.max(160, list[j][1].length * 10 + 30);
      var b = button(t, "t" + j, 10 + j, x, 124, w, list[j][1], F_MEDIUM, 18, list[j][0] == tab ? A_FOCUS : A_ROW_REST, function()
      {
         setTab(this.v);
      });
      b.v = list[j][0];
      if (list[j][0] == tab)
      {
         dboTabMark(b, w - 30);
      }
      x += w + 8;
   }
}

// ---- the tool row: the stack prompt, or the tab's own tools ----

function drawPrompt(a)
{
   var p = prompt;
   var q = dboText(a, "question", 1, PAD, 172, 380, 28, dboFmt(F_MEDIUM, 18, C_TEXT, 0.8), false);
   q.text = (p.dir == "add" ? "Offer how many " : "Take back how many ") + p.item.name + "?";
   var v = dboText(a, "value", 2, PAD + 384, 172, 110, 28, dboFmt(F_BOLD, 18, C_TEXT, 0.8), false);
   v.text = p.n + " of " + p.item.count;
   var x = PAD + 500;
   for (var i = 0; i < PROMPT_STEPS.length; i++)
   {
      var b = webChip(a, "s" + i, 10 + i, x, 170, 60, PROMPT_STEPS[i][1], F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         promptSet(prompt.n + this.step);
      });
      b.step = PROMPT_STEPS[i][0];
      x += 64;
   }
   webChip(a, "all", 20, x, 170, 60, "All", F_MEDIUM, 17, A_BUTTON_REST, function()
   {
      promptSet(Number(prompt.item.count));
   });
   x += 64;
   webButton(a, "confirm", 21, x, 170, 110, "Confirm", F_MEDIUM, 17, A_BUTTON_REST, function()
   {
      promptConfirm();
   });
   x += 114;
   webButton(a, "back", 22, x, 170, 80, "Back", F_MEDIUM, 17, A_BUTTON_REST, function()
   {
      prompt = null;
      dboSound("UIMenuCancel");
      draw();
   });
}

function drawGoodsTools(a)
{
   var x = PAD;
   var cats = presentCategories();
   if (cats.length > 1)
   {
      var all = [["", "All"]].concat(cats);
      webChip(a, "cat", 10, x, 170, 220, "Show: " + labelOf(all, shownCat(), "All"), F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         cat = nextOf([["", "All"]].concat(presentCategories()), shownCat());
         page = 0;
         dboSound("UIMenuFocus");
         draw();
      });
      x += 228;
   }
   webChip(a, "sort", 11, x, 170, 170, "Sort: " + labelOf(SORTS, sortBy, "Name"), F_MEDIUM, 17, A_BUTTON_REST, function()
   {
      sortBy = nextOf(SORTS, sortBy);
      page = 0;
      dboSound("UIMenuFocus");
      draw();
   });
   x += 178;
   if (typing == "search")
   {
      var box = dboInput(a, "box", 2, x, 168, 260, 32, dboFmt(F_PLAIN, 18, C_TEXT, 0.5), 40, false);
      box.text = search;
      webButton(a, "done", 12, x + 268, 170, 90, "Done", F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         takeTyped();
      });
      return;
   }
   if (dboCanType())
   {
      webChip(a, "search", 12, x, 170, 140, "Search...", F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         typing = "search";
         dboSound("UIMenuOK");
         draw();
      });
      x += 148;
   }
   if (search != "")
   {
      var f = dboText(a, "filter", 3, x, 172, 260, 28, dboFmt(F_MEDIUM, 17, C_SECOND, 0.8), false);
      f.text = "\"" + search + "\"";
      webChip(a, "clear", 13, x + 268, 170, 90, "Clear", F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         search = "";
         page = 0;
         dboSound("UIMenuCancel");
         draw();
      });
   }
}

function drawGoldTools(a)
{
   var total = goldTotal();
   if (total <= 0)
   {
      return;
   }
   var locked = data.myLocked == true;
   var l = dboText(a, "label", 1, PAD, 172, 80, 28, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8), false);
   l.text = "Gold";
   if (typing == "gold")
   {
      var box = dboInput(a, "box", 2, PAD + 80, 168, 180, 32, dboFmt(F_PLAIN, 18, C_TEXT, 0.5), 9, false);
      box.restrict = "0-9";
      box.text = String(goldShown());
      webButton(a, "done", 10, PAD + 268, 170, 90, "Done", F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         takeTyped();
      });
      return;
   }
   var v = dboText(a, "value", 3, PAD + 80, 172, 200, 28, dboFmt(F_BOLD, 18, C_TEXT, 0.8), false);
   v.text = gold(goldShown()) + " of " + gold(total);
   if (locked)
   {
      return;
   }
   var x = PAD + 290;
   for (var i = 0; i < GOLD_STEPS.length; i++)
   {
      var b = webChip(a, "s" + i, 10 + i, x, 170, 70, GOLD_STEPS[i][1], F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         goldWant = Math.max(0, Math.min(goldTotal(), goldShown() + this.step));
         dboSound("UIMenuFocus");
         draw();
      });
      b.step = GOLD_STEPS[i][0];
      x += 76;
   }
   if (dboCanType())
   {
      webChip(a, "type", 20, x, 170, 90, "Type...", F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         typing = "gold";
         dboSound("UIMenuOK");
         draw();
      });
      x += 98;
   }
   var offer = webButton(a, "set", 21, x, 170, 130, "Offer gold", F_MEDIUM, 17, A_BUTTON_REST, function()
   {
      setGold();
   });
   if (goldShown() == goldOffered())
   {
      disable(offer);
   }
}

function drawTools()
{
   var a = clear("tools", 40);
   if (prompt != null)
   {
      drawPrompt(a);
   }
   else if (tab == "goods")
   {
      drawGoodsTools(a);
   }
   else if (tab == "mine")
   {
      drawGoldTools(a);
   }
   else
   {
      var g = goldIn(listOf(data.theirOffer));
      var t = dboText(a, "their", 1, PAD, 172, 400, 28, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8), false);
      t.text = g != null ? "Gold:  " + gold(g.count) : "";
   }
}

function takeTyped()
{
   var box = panel.tools.box;
   var text = box != undefined ? String(box.text) : "";
   if (typing == "search")
   {
      search = text.split("\r").join("").split("\n").join("");
      while (search.charAt(0) == " ")
      {
         search = search.substr(1);
      }
      while (search.charAt(search.length - 1) == " ")
      {
         search = search.substr(0, search.length - 1);
      }
      page = 0;
   }
   else if (typing == "gold")
   {
      var n = Number(text.split(",").join(""));
      goldWant = n > 0 && !isNaN(n) ? Math.min(goldTotal(), Math.floor(n)) : 0;
   }
   endTyping();
   dboSound("UIMenuOK");
   draw();
}

function endTyping()
{
   if (typing != "")
   {
      dboInputEnd();
   }
   typing = "";
}

// ---- the lists ----

function details(item)
{
   var parts = [];
   if (Number(item.count) > 1)
   {
      parts.push("x" + item.count);
   }
   if (item.value != undefined)
   {
      parts.push(gold(item.value) + " gold" + (Number(item.count) > 1 ? " each" : ""));
   }
   if (item.weight != undefined && Number(item.weight) > 0)
   {
      parts.push("weighs " + weightText(item.weight));
   }
   var tags = listOf(item.tags);
   for (var i = 0; i < tags.length; i++)
   {
      parts.push(String(tags[i]));
   }
   if (item.equipped == true)
   {
      parts.push("equipped");
   }
   return parts.join("  ·  ");
}

// The list's rows are made once and refilled: a page turn or a payload rewrites their text instead of making some fifty
// clips and fields again (players found paging slow, 3 Nov)
function listClip()
{
   if (panel.list == undefined)
   {
      var l = panel.createEmptyMovieClip("list", 50);
      l._x = PAD;
      l._y = BODY_TOP;
      dboText(l, "hint", 1, 0, 4, BODY_W, 26, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   }
   return panel.list;
}

function poolRow(i)
{
   var l = listClip();
   if (l["r" + i] != undefined)
   {
      return l["r" + i];
   }
   var c = l.createEmptyMovieClip("r" + i, 10 + i);
   c._y = i * ROW_H;
   // the web list's hairline between rows
   dboBox(c, 0, ROW_H - 2, BODY_W, 1, C_ACCENT, 12);
   dboText(c, "label", 1, 0, 6, 440, 28, dboFmt(F_MEDIUM, 18, C_TEXT, 0.5), false);
   dboText(c, "sub", 2, 450, 8, BODY_W - 450, 26, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   var b = webChip(c, "btn0", 10, BODY_W - 128, 4, 124, "", F_MEDIUM, 16, A_BUTTON_REST, function() { pick(this.dir, this.item); });
   // drawList puts it in the focus order when its row is shown
   actions.pop();
   return c;
}

function fillRow(c, item, label, dir, off)
{
   c._visible = true;
   c.label.text = String(item.name);
   c.sub._width = label != "" ? BODY_W - 132 - 450 : BODY_W - 450;
   c.sub.text = details(item);
   var b = c.btn0;
   b._visible = label != "";
   if (label == "")
   {
      return;
   }
   b.item = item;
   b.dir = dir;
   b.label.text = label;
   if (off)
   {
      disable(b);
   }
   else
   {
      b.disabled = false;
      b.rest = A_BUTTON_REST;
      b._alpha = A_BUTTON_REST;
      b.label.textColor = C_TEXT;
   }
   b.idx = actions.length;
   actions.push(b);
}

// One page of a list into the pooled rows; the page count comes back
function drawList(items, label, dir, empty)
{
   var pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
   page = Math.max(0, Math.min(pages - 1, page));
   var l = listClip();
   l.hint.text = items.length ? "" : empty;
   var off = data.myLocked == true;
   for (var r = 0; r < PER_PAGE; r++)
   {
      var i = page * PER_PAGE + r;
      if (i < items.length)
      {
         fillRow(poolRow(r), items[i], label, dir, off);
      }
      else if (l["r" + r] != undefined)
      {
         l["r" + r]._visible = false;
      }
   }
   return pages;
}

function totalsText(items)
{
   var any = false;
   var value = 0;
   var weight = 0;
   for (var i = 0; i < items.length; i++)
   {
      if (items[i].value != undefined || items[i].weight != undefined)
      {
         any = true;
      }
      value += (Number(items[i].value) || 0) * Number(items[i].count);
      weight += (Number(items[i].weight) || 0) * Number(items[i].count);
   }
   return any ? "Base value " + gold(Math.round(value)) + " gold  ·  weighs " + weightText(weight) : "";
}

// ---- the foot ----

function drawFoot(pages)
{
   var f = clear("foot", 60);
   var t = dboText(f, "totals", 1, PAD, PANEL_H - 100, PANEL_W - PAD * 2, 26, dboFmt(F_MEDIUM, 15, C_SECOND, 0.8), false);
   t.text = tab == "mine" ? totalsText(listOf(data.myOffer)) : tab == "theirs" ? totalsText(listOf(data.theirOffer)) : "";
   webDivider(f, PAD, PANEL_H - 66, PANEL_W - PAD * 2);
   pageBar(f, 2, PAD, PANEL_H - 50, 340, page, pages, turnPage);
   var x = PANEL_W - PAD - 130;
   webButton(f, "cancel", 12, x, PANEL_H - 50, 130, "Cancel", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      closeMenu();
   });
   if (data.myLocked == true)
   {
      x -= 158;
      webButton(f, "unlock", 11, x, PANEL_H - 50, 150, data.iAccepted == true ? "Back out" : "Change offer", F_MEDIUM, 20, A_BUTTON_REST, function()
      {
         dboSound("UIMenuCancel");
         send("unlock");
      });
   }
   x -= 158;
   var a = webButton(f, "accept", 10, x, PANEL_H - 50, 150, data.iAccepted == true ? (bothAccepted() ? "Trading..." : "Accepted") : "Accept", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      accept();
   });
   if (data.iAccepted == true || acceptAfterLock)
   {
      disable(a);
   }
}

// Where a control sits, so the focus can find it again after a redraw
function placeOf(c)
{
   return c._parent._name + "/" + c._name;
}

function focusedPlace()
{
   return focus >= 0 && focus < actions.length ? placeOf(actions[focus]) : "";
}

function focusBack(was)
{
   for (var i = 0; was != "" && i < actions.length; i++)
   {
      if (placeOf(actions[i]) == was)
      {
         setFocus(i);
         break;
      }
   }
}

// The pooled rows outlive a redraw, so the focused one is let go of first: its wash would stay
function unfocus()
{
   if (focus >= 0 && focus < actions.length)
   {
      actions[focus]._alpha = actions[focus].rest;
      dboWash(actions[focus], false);
   }
   focus = -1;
}

// The head, tabs and tools' controls come first in the focus order; drawBody replaces only what follows them
var toolsEnd = 0;

function draw()
{
   var was = focusedPlace();
   // a redraw rebuilds the open box: what was typed in it carries over
   var box = typing != "" && panel.tools != undefined ? panel.tools.box : undefined;
   var typed = box != undefined ? String(box.text) : null;
   unfocus();
   actions = [];
   focus = -1;
   drawHead();
   drawTabs();
   drawTools();
   if (typed != null && panel.tools.box != undefined)
   {
      panel.tools.box.text = typed;
   }
   toolsEnd = actions.length;
   drawBody();
   if (focusConfirm && prompt != null)
   {
      focusConfirm = false;
      setFocus(panel.tools.confirm.idx);
      return;
   }
   focusBack(was);
}

// A page turn: the list and the foot alone are drawn again (players found the whole window's redraw slow)
function turnPage(d)
{
   var next = page + d;
   if (data == null || next < 0 || next >= pageCount())
   {
      return;
   }
   dboSound("UIMenuPrevNext");
   page = next;
   var was = focusedPlace();
   drawBody();
   focusBack(was);
}

function drawBody()
{
   if (focus >= toolsEnd)
   {
      unfocus();
   }
   actions = actions.slice(0, toolsEnd);
   // a locked offer is framed in gold, as the web window's locked pane glows
   var g = clear("locked", 45);
   if (tab == "mine" && data.myLocked == true)
   {
      var gw = PANEL_W - PAD * 2 + 16;
      var gh = BODY_H + 12;
      dboBox(g, PAD - 8, BODY_TOP - 6, gw, gh, C_GOLD, 6);
      dboBox(g, PAD - 8, BODY_TOP - 6, gw, 1, C_GOLD, 70);
      dboBox(g, PAD - 8, BODY_TOP - 7 + gh, gw, 1, C_GOLD, 70);
      dboBox(g, PAD - 8, BODY_TOP - 6, 1, gh, C_GOLD, 70);
      dboBox(g, PAD - 9 + gw, BODY_TOP - 6, 1, gh, C_GOLD, 70);
   }
   var pages = 1;
   if (tab == "goods")
   {
      pages = drawList(goods(), "Offer", "add", listOf(data.inventory).length ? "No matches." : "Nothing to trade.");
   }
   else if (tab == "mine")
   {
      pages = drawList(sorted(listOf(data.myOffer)), "Take back", "remove", "Nothing offered yet.");
   }
   else
   {
      pages = drawList(sorted(listOf(data.theirOffer)), "", "", "Nothing offered yet.");
   }
   drawFoot(pages);
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   webGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 50, 150, 280);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.inventory == undefined || p.myOffer == undefined)
   {
      dboLog("trade: unreadable payload");
      return;
   }
   var prev = data;
   data = p;
   dataSeq++;
   if (acceptAfterLock)
   {
      acceptAfterLock = false;
      if (p.myLocked == true && p.iAccepted != true)
      {
         send("accept");
      }
   }
   if (prev != null)
   {
      var wasCommitted = prev.myLocked == true || prev.theirLocked == true || prev.iAccepted == true || prev.theyAccepted == true;
      var changed = offerKey(listOf(prev.myOffer)) != offerKey(listOf(p.myOffer)) || offerKey(listOf(prev.theirOffer)) != offerKey(listOf(p.theirOffer));
      if (wasCommitted && changed && p.myLocked != true && p.theirLocked != true)
      {
         resetAt = getTimer();
      }
      var had = goldIn(listOf(prev.myOffer));
      if ((had != null ? Number(had.count) : 0) != goldOffered())
      {
         goldWant = -1;
      }
      if (prev.partnerName != p.partnerName)
      {
         search = "";
         cat = "";
      }
   }
   if (bothAccepted())
   {
      if (bothAt == 0)
      {
         bothAt = getTimer();
      }
   }
   else
   {
      bothAt = 0;
   }
   promptStillThere();
   // a locked offer takes no gold amount
   if (typing == "gold" && p.myLocked == true)
   {
      endTyping();
   }
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (typing != "")
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
      if (prompt != null)
      {
         prompt = null;
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
   else if (code == 9)
   {
      setTab(tab == "goods" ? "mine" : tab == "mine" ? "theirs" : "goods");
   }
   else if (code == 37 || code == 33)
   {
      turnPage(-1);
   }
   else if (code == 39 || code == 34)
   {
      turnPage(1);
   }
};
dboKeys(keys);
wheelPaging(turnPage);

function pageCount()
{
   var n = tab == "goods" ? goods().length : tab == "mine" ? listOf(data.myOffer).length : listOf(data.theirOffer).length;
   return Math.max(1, Math.ceil(n / PER_PAGE));
}

_root.onEnterFrame = function()
{
   if (data == null)
   {
      if (getTimer() - builtAt >= NO_DATA_CLOSE_MS)
      {
         dboLog("trade: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   // the countdown and the reset note change with time alone: redraw the head when either does
   var now = bothAccepted() ? countdown() : -1;
   if (now != shownCount || (resetAt > 0 && !resetShown()))
   {
      if (resetAt > 0 && !resetShown())
      {
         resetAt = 0;
      }
      drawHead();
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
