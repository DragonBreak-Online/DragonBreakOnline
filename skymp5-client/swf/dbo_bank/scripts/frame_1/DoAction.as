// The bank as a native panel (server bank.js, widget 48: the same object skymp5-front features/bank and its vault tab get).
// Your account, the same in every town; any treasury you answer for, which takes deposits and gives nothing back; and the
// vault of this hold for your goods. Actions go out as the browser's dbo:bank* events with the window's nonce, and the
// server answers by sending the panel again with the new figures and a result line. An amount is set by the stepper
// buttons, or typed in a box (dboInput) on a game that can take typed input; an empty amount means "all" where the
// browser's does (the vault's store and take).

var DBO_SWF_VERSION = "bank-1";
var PANEL_W = 1000;
var PANEL_H = 640;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
BODY_H = 316;
var BODY_TOP = 196;
var NO_DATA_CLOSE_MS = 8000;
var BUSY_TIMEOUT_MS = 8000;
var AMOUNT_MAX = 999999999;
var C_RED = 0xB23A3A;
var C_GREEN = 0x7FBF7F;
var STEPS = [[-1000, "-1000"], [-100, "-100"], [100, "+100"], [1000, "+1000"]];
var KIND_LABEL = {deposit: "Deposited", withdraw: "Withdrew", treasury: "Paid into", vault: "Vault fee,"};

var panel;
var data = null;
var tab = "account";
var page = 0;
var amount = 0;
// confirm: the vault tier whose rent or change waits for a second press, with its price shown
var confirm = "";
// typing: the amount box is open in place of the stepper
var typing = false;
var busyAt = 0;
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
   return String(Math.round((Number(n) || 0) * 100) / 100);
}

function dayText(ms)
{
   var d = new Date(Number(ms) || 0);
   return MONTHS[d.getMonth()] + " " + d.getDate();
}

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
   dboSound("UIMenuOK");
   dboSend(key, [String(data.nonce)].concat(args));
}

function closeMenu()
{
   endTyping();
   dboSound("UIMenuCancel");
   dboSend("dbo:bankClose", []);
   dboClose();
}

function treasuries()
{
   return listOf(data.treasuries);
}

function treasury()
{
   var list = treasuries();
   for (var i = 0; i < list.length; i++)
   {
      if (String(list[i].key) == tab)
      {
         return list[i];
      }
   }
   return null;
}

// The tab shown: a treasury or the vault only while the payload still has it
function shown()
{
   if (tab == "vault" && data.vault != undefined && data.vault != null)
   {
      return "vault";
   }
   return treasury() != null ? tab : "account";
}

function setTab(t)
{
   endTyping();
   tab = t;
   page = 0;
   amount = 0;
   confirm = "";
   dboSound("UIMenuPrevNext");
   draw();
}

function amountArg()
{
   return amount > 0 ? String(amount) : "all";
}

// ---- the head and tabs ----

function drawHead()
{
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 18, PANEL_W - PAD * 2, data.where != undefined && data.where != "" ? "The Bank of " + data.where : "The Bank");
   var a = dboText(h, "account", 2, PAD, 62, 420, 28, dboFmt(F_MEDIUM, 20, C_TEXT, 0.8), false);
   a.text = "In your account:  " + gold(data.balance) + " gold";
   var c = dboText(h, "carried", 3, PANEL_W - PAD - 420, 62, 420, 28, dboFmt(F_MEDIUM, 20, C_TEXT, 0.8, "right"), false);
   c.text = "You carry:  " + gold(data.carried) + " gold";
   dboDivider(h, PAD, 98, PANEL_W - PAD * 2);
}

function drawTabs()
{
   var t = clear("tabs", 30);
   var list = [["account", "Your account"]];
   if (data.vault != undefined && data.vault != null)
   {
      list.push(["vault", "Vault"]);
   }
   var tr = treasuries();
   for (var i = 0; i < tr.length; i++)
   {
      list.push([String(tr[i].key), String(tr[i].name)]);
   }
   if (list.length < 2)
   {
      return;
   }
   var x = PAD;
   var now = shown();
   for (var j = 0; j < list.length; j++)
   {
      var w = Math.max(140, list[j][1].length * 11 + 30);
      var b = button(t, "t" + j, 10 + j, x, 110, w, list[j][1], F_MEDIUM, 20, list[j][0] == now ? A_FOCUS : A_ROW_REST, function()
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

// ---- the amount: a stepper, or a typed box ----

function drawAmount(label, hint)
{
   var a = clear("amount", 40);
   var l = dboText(a, "label", 1, PAD, 154, 220, 28, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8), false);
   l.text = label;
   if (typing)
   {
      var box = dboInput(a, "box", 2, PAD + 220, 150, 220, 32, dboFmt(F_PLAIN, 20, C_TEXT, 0.5), 9, false);
      box.restrict = "0-9";
      box.text = amount > 0 ? String(amount) : "";
      button(a, "done", 10, PAD + 452, 152, 100, "Done", F_MEDIUM, 18, A_BUTTON_REST, function()
      {
         takeTyped();
      });
      return;
   }
   var v = dboText(a, "value", 2, PAD + 220, 154, 200, 28, dboFmt(F_BOLD, 20, amount > 0 ? C_TEXT : C_SECOND, 0.8), false);
   v.text = amount > 0 ? gold(amount) : hint;
   var x = PAD + 420;
   for (var i = 0; i < STEPS.length; i++)
   {
      var b = button(a, "s" + i, 10 + i, x, 152, 76, STEPS[i][1], F_MEDIUM, 17, A_ROW_REST, function()
      {
         amount = Math.max(0, Math.min(AMOUNT_MAX, amount + this.step));
         dboSound("UIMenuFocus");
         draw();
      });
      b.step = STEPS[i][0];
      x += 82;
   }
   if (dboCanType())
   {
      button(a, "type", 20, x, 152, 90, "Type...", F_MEDIUM, 17, A_ROW_REST, function()
      {
         typing = true;
         dboSound("UIMenuOK");
         draw();
      });
   }
}

function takeTyped()
{
   var box = panel.amount.box;
   var n = box != undefined ? Number(String(box.text).split(",").join("")) : 0;
   amount = n > 0 && !isNaN(n) ? Math.min(AMOUNT_MAX, Math.floor(n)) : 0;
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
}

// ---- the tabs' pages ----

function drawAccount()
{
   flowHint("Your account is the same at every bank in the land. Gold kept here cannot be stolen, looted or raided.");
   flowButtons([["Deposit", function() { act("dbo:bankDeposit", [String(amount)]); }, undefined, busy() || amount <= 0 || amount > Number(data.carried)],
      ["Withdraw", function() { act("dbo:bankWithdraw", [String(amount)]); }, undefined, busy() || amount <= 0 || amount > Number(data.balance)],
      ["Deposit all you carry", function() { act("dbo:bankDeposit", ["all"]); }, undefined, busy() || !(Number(data.carried) > 0)],
      ["Withdraw everything", function() { act("dbo:bankWithdraw", ["all"]); }, undefined, busy() || !(Number(data.balance) > 0)]]);
   flowGap(8);
   flowHeading("Recent");
   var h = listOf(data.history);
   if (!h.length)
   {
      flowHint("Nothing yet.");
   }
   for (var i = 0; i < h.length; i++)
   {
      var e = h[i];
      var what = (KIND_LABEL[e.kind] != undefined ? KIND_LABEL[e.kind] : String(e.kind)) + (e.kind == "treasury" || e.kind == "vault" ? " " + e.where : "");
      flowRow(whenText(e.at), what, gold(e.amount) + " gold");
   }
}

function drawTreasury(t)
{
   flowRow(String(t.name), gold(t.balance) + " gold", String(t.why != undefined ? t.why : ""));
   flowHint("Anyone who answers for a treasury may pay into it. No one can take gold out: the realm spends it on wages, contracts and war.");
   flowButtons([["Pay in", function() { act("dbo:bankTreasury", [String(treasury().key), String(amount)]); }, undefined, busy() || amount <= 0 || amount > Number(data.carried)],
      ["Pay in all you carry", function() { act("dbo:bankTreasury", [String(treasury().key), "all"]); }, undefined, busy() || !(Number(data.carried) > 0)]]);
}

function tierName(v, id)
{
   var t = listOf(v.tiers);
   for (var i = 0; i < t.length; i++)
   {
      if (String(t[i].id) == String(id))
      {
         return String(t[i].name);
      }
   }
   return String(id);
}

function elsewhere(v)
{
   var o = listOf(v.elsewhere);
   for (var i = 0; i < o.length; i++)
   {
      flowHint("Stored in " + o[i].name + ": " + plural(Number(o[i].items), "kind", "kinds") + " of goods, " + weightText(o[i].used) + " weight"
         + (Number(o[i].owed) > 0 ? ", " + o[i].owed + " gold owed" : "") + ". Only a bank of that hold opens it.");
   }
}

function confirmRow(v, t, change)
{
   if (confirm != String(t.id))
   {
      return;
   }
   var text = change ? "Change to a " + t.name + ": up to " + t.weekly + " gold now for its first week. What is left of this week counts towards it; nothing is paid back."
      : "Rent a " + t.name + ": " + t.weekly + " gold now for its first week, then " + t.weekly + " a week. Nothing is paid back if you give it up early.";
   var tierId = String(t.id);
   flowEntry(text, [["Pay", function() { confirm = ""; act("dbo:bankRent", [tierId]); }, undefined, busy() || v.enabled != true],
      ["Cancel", function() { confirm = ""; dboSound("UIMenuCancel"); draw(); }]]);
}

function takeRows(v, owed)
{
   var items = listOf(v.items);
   for (var i = 0; i < items.length; i++)
   {
      var e = items[i];
      var row = e.row;
      var id = String(e.baseId);
      flowEntry(String(e.name) + (e.special == true ? " *" : ""), [["Take", function() { act("dbo:bankTake", [this.row, this.id, amountArg()]); }, undefined, busy() || owed > 0 || amount > Number(e.count)]],
         "x" + e.count + ", " + weightText(Number(e.weight) * Number(e.count)) + " weight");
      var last = flowLast();
      last.btn0.row = row;
      last.btn0.id = id;
   }
   return items.length;
}

// The last block flowEntry drew, so a row's button can carry its own arguments
function flowLast()
{
   var p = flow.pages[flow.pages.length - 1];
   return p["b" + (flow.n - 1)];
}

function seizeRule(v)
{
   return v.seizeCredit != "value"
      ? "If the fee goes unpaid for a month, enough of the goods to cover the debt are sold to the hold and the rest is sent back to you by letter."
      : "Goods left unpaid for a month are sold to the hold.";
}

function drawVault()
{
   var v = data.vault;
   var closed = v.enabled != true;
   if (v.zone == undefined || v.zone == "")
   {
      flowHint("This bank keeps no vaults: it answers to no hold.");
      elsewhere(v);
      return;
   }
   if (closed)
   {
      flowText("The vaults are closed for now. You can still pay what you owe and take your goods out; nothing is charged while they are closed.", 16, C_RED);
   }
   var tiers = listOf(v.tiers);
   if (v.rented != true)
   {
      if (v.held == true)
      {
         flowHint("The bank holds these goods of yours from a vault it sold to cover a debt. No fee is charged on them; take them out when you like.");
         takeRows(v, 0);
      }
      if (!closed)
      {
         flowHint("Rent a vault in " + v.zoneName + " for your goods. It opens only at a bank of this hold. The fee is taken each week from your account, or from the gold you carry, and goes to the hold's treasury. " + seizeRule(v));
         for (var i = 0; i < tiers.length; i++)
         {
            var t = tiers[i];
            var tid = String(t.id);
            flowEntry(String(t.name), [["Rent", function() { confirm = this.tid; dboSound("UIMenuOK"); draw(); }, undefined, busy() || Number(v.used) > Number(t.weight)]], t.weight + " weight, " + t.weekly + " gold a week");
            flowLast().btn0.tid = tid;
            confirmRow(v, t, false);
         }
      }
      elsewhere(v);
      return;
   }
   var cap = Number(v.cap) || 0;
   var used = Number(v.used) || 0;
   var owed = Number(v.owed) || 0;
   flowRow(tierName(v, v.tier) + " in " + v.zoneName, weightText(used) + " / " + cap + " weight", v.weekly + " gold a week, paid to " + dayText(v.paidUntil));
   if (owed > 0)
   {
      var why = owed + " gold owed. Nothing comes out until it is paid";
      if (v.seizeAt != undefined && Number(v.seizeAt) > 0 && !closed)
      {
         why += v.seizeCredit != "value" ? ". On " + dayText(v.seizeAt) + " enough of the goods to cover the debt are sold to the hold, and the rest is sent back to you by letter"
            : ", and on " + dayText(v.seizeAt) + " the goods are sold to the hold";
      }
      var o = flowEntry(why + ".", [["Pay", function() { act("dbo:bankVaultPay", []); }, undefined, busy()]]);
      o.label.textColor = C_RED;
   }
   flowHeading("In the vault");
   if (!takeRows(v, owed))
   {
      flowHint("Nothing yet.");
   }
   flowHeading("You carry");
   var carry = listOf(v.carry);
   if (!carry.length)
   {
      flowHint("Nothing the vault takes.");
   }
   for (var j = 0; j < carry.length; j++)
   {
      var e = carry[j];
      var need = Number(e.weight) * (amount > 0 ? amount : Number(e.count));
      flowEntry(String(e.name), [["Store", function() { act("dbo:bankStore", [this.id, amountArg()]); }, undefined, busy() || closed || amount > Number(e.count) || used + need > cap + 0.000001]],
         "x" + e.count + ", " + weightText(e.weight) + " weight each");
      flowLast().btn0.id = String(e.baseId);
   }
   flowHeading("Change the vault");
   var chips = [];
   for (var k = 0; k < tiers.length; k++)
   {
      if (String(tiers[k].id) == String(v.tier))
      {
         continue;
      }
      chips.push([tiers[k].name + " (" + tiers[k].weight + ", " + tiers[k].weekly + " gold)", function() { confirm = this.tid; dboSound("UIMenuOK"); draw(); }, undefined, busy() || closed || owed > 0 || used > Number(tiers[k].weight)]);
   }
   chips.push(["Give it up", function() { act("dbo:bankVaultEnd", []); }, C_RED, busy() || closed || owed > 0 || listOf(v.items).length > 0]);
   var row = flowButtons(chips);
   var n = 0;
   for (var q = 0; q < tiers.length; q++)
   {
      if (String(tiers[q].id) != String(v.tier))
      {
         row["btn" + n].tid = String(tiers[q].id);
         n++;
      }
   }
   for (var r = 0; r < tiers.length; r++)
   {
      if (String(tiers[r].id) != String(v.tier))
      {
         confirmRow(v, tiers[r], true);
      }
   }
   elsewhere(v);
}

// ---- the result line, the foot ----

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

function draw()
{
   actions = [];
   focus = -1;
   var now = shown();
   drawHead();
   drawTabs();
   if (now == "vault")
   {
      drawAmount("How many", "All");
   }
   else
   {
      drawAmount("Amount", "None");
   }
   flowStart(panel, 50, PAD, BODY_TOP);
   if (now == "vault")
   {
      drawVault();
   }
   else if (now == "account")
   {
      drawAccount();
   }
   else
   {
      drawTreasury(treasury());
   }
   var pages = flowShow(page);
   if (page >= pages)
   {
      page = pages - 1;
      flowShow(page);
   }
   drawFoot(pages);
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
   if (p == null || p.nonce == undefined || p.balance == undefined)
   {
      dboLog("bank: unreadable payload");
      return;
   }
   var first = data == null;
   data = p;
   busyAt = 0;
   // a successful action clears the amount, as the browser's does
   if (!first && p.resultKind == "ok")
   {
      amount = 0;
   }
   endTyping();
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
   else if (code == 37 && page > 0)
   {
      dboSound("UIMenuPrevNext");
      page--;
      draw();
   }
   else if (code == 39 && flow != null && page + 1 < flow.pages.length)
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
      dboLog("bank: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
