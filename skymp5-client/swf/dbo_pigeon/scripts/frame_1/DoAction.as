// The pigeon coop as a native panel (gamemode.js openPigeonCoop, widget 34, the same object the browser coop gets): a port
// of skymp5-front features/pigeon and its Courier tab, same tabs, words and messages. Writing a letter, posting a supply
// order and posting a courier job are forms in the panel (lib/dbo-form.as), typed in its own boxes:
//   Letter:   dbo:pigeonSend [nonce, recipient, text, gold, itemsJson]; signing dbo:pigeonSign [nonce, 'clear' | 'unsigned' | a name]
//   Supply:   dbo:supplySearch [nonce, query] | supplyPost [nonce, desc, count, reward]
//   Courier:  dbo:courierPost [nonce, destKey, recipient, pay, insured, itemsJson]
// A game that cannot type hands the composer to the browser coop instead: dbo:pigeonCompose [nonce, mode, to].
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
// composing: the composer open as a form ('send', 'supply', 'courier' or 'sign'), the letter's recipient, the form's page
var composing = "";
var composeTo = 0;
var formPage = 0;
var builtAt = getTimer();

formHost.busy = function() { return busy; };
formHost.redraw = function() { draw(); };
formHost.fallback = function() { compose(composing == "sign" ? "send" : composing, composeTo); };
formHost.fallbackText = "the browser coop";
formHost.onOpen = function() { formPage = 0; };

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
   endFormTyping();
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
   if (forming != null)
   {
      var fp = Math.max(0, Math.min(pageCount - 1, formPage + d));
      if (fp != formPage)
      {
         dboSound("UIMenuPrevNext");
         formPage = fp;
         draw();
      }
      return;
   }
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
   closeForm();
   composing = "";
   draw();
}

// ---- the composers (forms) ----

function openForm(mode, to, build, vals)
{
   composing = mode;
   composeTo = to;
   asked = "";
   form(build, vals);
}

// The goods a parcel or a courier carries: a multi-choice of what can go (at most maxStacks kinds) and, for each picked, how
// many (1 until typed), as the browser's packed list; listOf the goods and their [baseId, count] list come back in a parcel
function goodsFields(fields, v, goods, maxStacks, what)
{
   var opts = [];
   for (var i = 0; i < goods.length; i++)
   {
      opts.push([goods[i].baseId, goods[i].name + " x" + goods[i].count]);
   }
   fields.push({key: "goods", label: "The goods (up to " + maxStacks + " kinds)", kind: "multi", options: opts, max: maxStacks, empty: "You carry nothing a " + what + " can take."});
   var picked = listOf(v.goods);
   var list = [];
   var ok = true;
   for (var k = 0; k < picked.length; k++)
   {
      var g = null;
      for (var q = 0; q < goods.length; q++)
      {
         if (String(goods[q].baseId) == String(picked[k]))
         {
            g = goods[q];
         }
      }
      var key = "n:" + picked[k];
      var n = v[key] != undefined && String(v[key]) != "" ? Number(v[key]) : 1;
      fields.push({key: key, label: (g != null ? g.name : String(picked[k])) + ", of " + (g != null ? g.count : 0), kind: "number", max: 5, hint: "1"});
      if (g == null || !(n >= 1) || n > Number(g.count))
      {
         ok = false;
      }
      if (n > 0)
      {
         list.push([Number(picked[k]), n, g]);
      }
   }
   return {list: list, ok: ok};
}

function packedOf(list)
{
   var out = [];
   for (var i = 0; i < list.length; i++)
   {
      out.push([list[i][0], list[i][1]]);
   }
   return out;
}

function writeLetter(to)
{
   openForm("send", to, function(v)
   {
      var chosen = null;
      var cs = contacts();
      for (var i = 0; i < cs.length; i++)
      {
         if (cs[i].id == composeTo)
         {
            chosen = cs[i];
         }
      }
      var max = num(data.maxText, 500);
      var waiting = num(data.cooldownMinutes, 0) > 0;
      var fields = [];
      if (chosen == null)
      {
         fields.push({kind: "note", text: "Choose who the letter is for."});
      }
      fields.push({key: "text", label: chosen != null ? "A letter for " + chosen.name : "The letter", kind: "text", max: max, lines: 6, count: true});
      fields.push({kind: "buttons", items: [["Sign with your name", function() { act("dbo:pigeonSign", ["clear"]); }, busy], ["Unsigned", function() { act("dbo:pigeonSign", ["unsigned"]); }, busy]]});
      var rules = data.parcel != undefined && data.parcel != null && data.parcel.enabled == true ? data.parcel : null;
      var goldSent = 0;
      var packed = {list: [], ok: true};
      if (rules != null)
      {
         fields.push({key: "gold", label: "Gold (" + Math.round(num(rules.taxRate, 0) * 100) + "% tax, " + rules.itemFee + " a kind of goods)", kind: "number", max: 7, hint: "0"});
         goldSent = Math.max(0, formNumber(v, "gold"));
         packed = goodsFields(fields, v, listOf(data.sendable), num(rules.maxStacks, 0), "pigeon");
      }
      var text = v.text != undefined ? String(v.text) : "";
      var price = chosen != null ? num(chosen.price, 0) : 0;
      var stacks = packed.list.length;
      var tax = rules != null ? Math.ceil(goldSent * num(rules.taxRate, 0)) + stacks * num(rules.itemFee, 0) : 0;
      var hasParcel = goldSent > 0 || stacks > 0;
      var total = price + (hasParcel ? goldSent + tax : 0);
      var canAfford = num(data.gold, 0) >= total;
      var label = waiting ? "Pigeon is out" : chosen == null ? "Choose someone" : !packed.ok ? "Not that many" : !canAfford ? "Not enough gold" : "Send the pigeon";
      fields.push({kind: "note", text: waiting ? "Your pigeon is still out. The next one can fly in " + data.cooldownMinutes + " min."
         : chosen != null ? (hasParcel ? "Flight " + price + ", parcel tax " + tax + (goldSent ? ", gold sent " + goldSent : "") + ": " + total + " gold. You carry " + data.gold + "." : "A pigeon to " + chosen.name + " costs " + price + " gold. You carry " + data.gold + " gold.")
         : "The farther the bird flies, the more it costs."});
      return {title: "A letter", fields: fields, buttons: [[label, function(vals)
      {
         act("dbo:pigeonSend", [chosen.id, text, goldSent, dboJson(packedOf(packed.list))]);
      }, chosen != null && (text != "" || hasParcel) && !waiting && canAfford && packed.ok]]};
   });
}

function openSign()
{
   openForm("sign", selectedId == null ? 0 : selectedId, function(v)
   {
      var name = v.name != undefined ? String(v.name) : "";
      return {title: "Sign as another name", hint: "Your letters are signed with it until you change it.", fields: [{key: "name", label: "The name", kind: "text", max: 40}],
         buttons: [["Use it", function(vals) { act("dbo:pigeonSign", [String(vals.name)]); }, name != ""]]};
   });
}

function openSupply()
{
   openForm("supply", 0, function(v)
   {
      var s = supply();
      if (s == null)
      {
         return {title: "Post a supply order", fields: [{kind: "note", text: "Supply orders are closed here."}], buttons: []};
      }
      var q = v.q != undefined ? String(v.q) : "";
      var results = listOf(s.results);
      var opts = [];
      for (var i = 0; i < results.length; i++)
      {
         opts.push([results[i].desc, results[i].name]);
      }
      var picked = false;
      for (var k = 0; k < opts.length; k++)
      {
         picked = picked || opts[k][0] == v.pick;
      }
      var count = formNumber(v, "count");
      var reward = formNumber(v, "reward");
      var fee = Math.max(num(s.minFee, 0), Math.ceil(Math.max(0, reward) * num(s.feeShare, 0)));
      var fields = [{key: "q", label: "Search for an item", kind: "text", max: 40},
         {kind: "buttons", items: [["Search", function(vals) { act("dbo:supplySearch", [String(vals.q)]); }, busy || q.length < 2]]},
         {key: "pick", label: "The item", kind: "choice", options: opts, empty: "Search for the item to order."},
         {key: "count", label: "How many, up to " + s.maxCount, kind: "number", max: 5}, {key: "reward", label: "The whole reward", kind: "number", max: 7},
         {kind: "note", text: reward > 0 ? "Reward " + reward + " and " + fee + " to post: " + (reward + fee) + " gold. You carry " + data.gold + "." : "Set how many and the whole reward."},
         {kind: "note", text: "Up to " + s.maxCount + "; open " + s.openDays + " days; " + Math.round(num(s.feeShare, 0) * 100) + "% to post, at least " + s.minFee + "."}];
      return {title: "Post a supply order", fields: fields, buttons: [["Post order", function(vals) { act("dbo:supplyPost", [String(vals.pick), formNumber(vals, "count"), formNumber(vals, "reward")]); },
         picked && count >= 1 && count <= num(s.maxCount, 0) && reward >= count && num(data.gold, 0) >= reward + fee]]};
   });
}

function openCourier()
{
   openForm("courier", 0, function(v)
   {
      var c = courier();
      if (c == null || c.enabled != true)
      {
         return {title: "Send goods by courier", fields: [{kind: "note", text: "No courier takes work here yet."}], buttons: []};
      }
      var dests = listOf(c.destinations);
      var dopts = [];
      var dest = null;
      for (var i = 0; i < dests.length; i++)
      {
         dopts.push([dests[i].key, dests[i].name]);
         if (dests[i].key == v.dest)
         {
            dest = dests[i];
         }
      }
      var inPerson = dest != null && dest.kind == "person";
      var ropts = inPerson ? [] : [[0, "Yourself"]];
      var cs = contacts();
      for (var k = 0; k < cs.length; k++)
      {
         ropts.push([cs[k].id, cs[k].name + " #" + cs[k].tag]);
      }
      if (inPerson && Number(v.to) == 0 && cs.length)
      {
         v.to = cs[0].id;
      }
      var recipient = inPerson && Number(v.to) == 0 ? null : Number(v.to);
      var fields = [{key: "dest", label: "Where it goes", kind: "choice", options: dopts}];
      if (dest != null && dest.hint != undefined && dest.hint != "")
      {
         fields.push({kind: "note", text: "The courier hands it in " + dest.hint + "; the goods wait in the mailbox."});
      }
      fields.push({key: "to", label: "Who receives it", kind: "choice", options: ropts, empty: "A parcel in person goes to someone you have met."});
      var packed = goodsFields(fields, v, listOf(c.goods), num(c.rules.maxStacks, 0), "courier");
      var value = 0;
      for (var g = 0; g < packed.list.length; g++)
      {
         value += packed.list[g][2] != null ? num(packed.list[g][2].value, 0) * packed.list[g][1] : 0;
      }
      fields.push({key: "pay", label: "The courier's pay (" + c.rules.minPay + " to " + c.rules.maxPay + ")", kind: "number", max: 7});
      fields.push({key: "insure", label: "Insure for (worth " + value + ")", kind: "number", max: 7, hint: "0"});
      var pay = Math.max(0, formNumber(v, "pay"));
      var insure = Math.min(Math.max(0, formNumber(v, "insure")), value);
      var fee = Math.max(num(c.rules.minFee, 0), Math.ceil(pay * num(c.rules.feeShare, 0)));
      var premium = insure > 0 ? Math.ceil(insure * num(c.rules.premiumRate, 0)) : 0;
      var total = pay + fee + premium;
      var days = num(c.rules.limitGameDays, 1);
      fields.push({kind: "note", text: (pay ? "Pay " + pay + ", " + fee + " to post" + (premium ? ", " + premium + " insurance" : "") + ": " + total + " gold. You carry " + data.gold + "."
         : Math.round(num(c.rules.feeShare, 0) * 100) + "% of the pay to post (at least " + c.rules.minFee + "); insurance " + Math.round(num(c.rules.premiumRate, 0) * 100) + "% of the value, paid by " + (c.place != undefined && c.place != "" ? c.place : "the hold") + " if it is robbed.")
         + " Up to " + c.rules.maxStacks + " kinds; the courier has " + days + " " + (days == 1 ? "day" : "days") + "."});
      var packedOk = packed.list.length > 0 && packed.ok;
      var label = !packedOk ? "Choose the goods" : recipient == null ? "Choose who receives it" : num(data.gold, 0) < total ? "Not enough gold" : "Post the job";
      return {title: "Send goods by courier", fields: fields, buttons: [[label, function(vals)
      {
         act("dbo:courierPost", [String(vals.dest), recipient, pay, insure, dboJson(packedOf(packed.list))]);
      }, dest != null && recipient != null && packedOk && pay >= num(c.rules.minPay, 0) && pay <= num(c.rules.maxPay, 0) && num(data.gold, 0) >= total]]};
   }, {to: 0});
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
   txt(r, "how", 2, RIGHT_X, TOP + 36, RIGHT_W, 70, 16, C_SECOND, "Write the letter here: what it says, how it is signed, and any gold or goods it carries.", true);
   var label = waiting ? "Pigeon is out" : chosen == null ? "Choose someone" : "Write to " + chosen.name + "...";
   act2(r, "write", 10, RIGHT_X, TOP + 110, RIGHT_W, label, function()
   {
      writeLetter(selectedId);
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
      openSign();
   });
   txt(r, "signHint", 4, RIGHT_X, TOP + 248, RIGHT_W, 40, 16, C_SECOND, "Another name can be set even while your pigeon is out.", true);
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
         openSupply();
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
         openCourier();
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
   // below the open tab's mark, so its diamond sits clear of the tabs (as the board's does)
   dboDivider(h, PAD, 114, PANEL_W - PAD * 2);
   if (data.result != undefined && data.result != null && data.result != "")
   {
      var res = txt(h, "result", 30, PAD, 120, PANEL_W - PAD * 2, 28, 16, data.resultKind == "refused" ? C_RED : C_GREEN, data.result, true);
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
   if (forming != null)
   {
      BODY_W = PANEL_W - PAD * 2;
      BODY_H = PANEL_H - TOP - 80;
      flowStart(r, 1, PAD, TOP);
      formBegin();
      drawForm();
      formEnd();
      pageCount = flowShow(formPage);
      formPage = flow.shown;
   }
   else if (s == "letters")
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
   if (formKey(code))
   {
      return;
   }
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
