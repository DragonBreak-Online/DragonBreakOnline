// The Expeditions and Hunting Contracts board as a native panel (server dungeons.js openExpeditions, widget 63: the same
// object skymp5-front features/expeditionBoard gets). Expeditions: one paper per Ayleid ruin; reading it offers "Gather
// your party" (or "Rejoin your party"), which sends events.pick with the ruin's id and the server opens the party and
// difficulty panel. Contracts (only when the server sends them): the contracts you hold with Give up, and the hold's
// hunting work and commissions; a contract is taken or given up, a commission's goods handed in. Every key is the widget's
// own events.* value, sent verbatim; tabs, reading a paper and Back stay in the panel, as the browser's do. Escape backs
// out of a paper first, then closes with events.close.

var DBO_SWF_VERSION = "expedition-1";
var PANEL_W = 1000;
var PANEL_H = 640;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
var BODY_TOP = 128;
BODY_H = PANEL_H - 124 - BODY_TOP;
var NO_DATA_CLOSE_MS = 8000;
var C_RED = 0xB23A3A;
var C_GREEN = 0x7FBF7F;
var STAMP = {open: "Wanted", yours: "Your party", taken: "Taken", resting: "Resting"};
var CONTRACT_STAMP = {open: "Wanted", yours: "Yours", posted: "Your notice"};
var DANGER_WORD = ["", "A pest", "Dangerous", "Deadly"];

var panel;
var data = null;
var page = 0;
var tab = "expeditions";
// selected: the paper being read, {kind: "expedition" | "contract", id}
var selected = null;
var builtAt = getTimer();

function ev(name)
{
   var e = data.events != undefined && data.events != null ? data.events : {};
   if (e[name] != undefined && e[name] != "")
   {
      return String(e[name]);
   }
   return name == "pick" ? "dbo:expeditionPick" : name == "close" ? "dbo:expeditionClose" : "";
}

function send(name, args)
{
   var key = ev(name);
   if (key == "")
   {
      return;
   }
   dboSound("UIMenuOK");
   dboSend(key, args);
}

function closeMenu()
{
   dboSound("UIMenuCancel");
   dboSend(ev("close"), []);
   dboClose();
}

function contracts()
{
   return data.contracts != undefined && data.contracts != null ? data.contracts : null;
}

function heldAll()
{
   var c = contracts();
   if (c == null)
   {
      return [];
   }
   if (c.heldAll != undefined && c.heldAll != null)
   {
      return listOf(c.heldAll);
   }
   return c.held != undefined && c.held != null ? [c.held] : [];
}

function maxActive()
{
   var c = contracts();
   return c != null && Number(c.maxActive) > 0 ? Number(c.maxActive) : 1;
}

function zoneName()
{
   var c = contracts();
   return c != null && c.zone ? String(c.zone) : "Bruma";
}

function hoursLabel(h)
{
   return Number(h) <= 1 ? "fades within the hour" : "fades in " + h + " hours";
}

function isCommission(c)
{
   return c.type == "commission";
}

function stampOf(c)
{
   if (isCommission(c) && c.state != "posted")
   {
      return "Buying";
   }
   return CONTRACT_STAMP[c.state] != undefined ? CONTRACT_STAMP[c.state] : String(c.state);
}

function keepers(masters)
{
   var m = listOf(masters);
   if (!m.length)
   {
      return "";
   }
   var list = m.length == 1 ? String(m[0]) : m.slice(0, m.length - 1).join(", ") + " and " + m[m.length - 1];
   return "Word is it is kept by " + list + ".";
}

function find(list, id)
{
   for (var i = 0; i < list.length; i++)
   {
      if (String(list[i].id) == String(id))
      {
         return list[i];
      }
   }
   return null;
}

function read(kind, id)
{
   selected = {kind: kind, id: String(id)};
   dboSound("UIMenuOK");
   page = 0;
   draw();
}

function back()
{
   selected = null;
   dboSound("UIMenuCancel");
   draw();
}

function setTab(t)
{
   if (t == tab)
   {
      return;
   }
   dboSound("UIMenuPrevNext");
   tab = t;
   selected = null;
   page = 0;
   draw();
}

// ---- the papers ----

function drawExpeditions()
{
   flowText("Ayleid ruins far to the south, posted in " + (data.hall ? data.hall : "Bruma") + ". Gather your party and set out.", 19, C_TEXT);
   var list = listOf(data.expeditions);
   if (!list.length)
   {
      flowHint("No expeditions are being organised right now.");
   }
   for (var i = 0; i < list.length; i++)
   {
      var x = list[i];
      var stamp = STAMP[x.state] != undefined ? STAMP[x.state] : String(x.state);
      var e = flowEntry(String(x.name) + "  -  " + stamp, [["Read", function() { read("expedition", this._parent.paperId); }]],
         String(x.kind) + (x.county ? ", " + x.county : "") + "  -  " + x.status);
      e.paperId = String(x.id);
      if (x.state == "yours")
      {
         e.label.textColor = C_GREEN;
      }
   }
}

function drawContracts()
{
   var c = contracts();
   flowText("The hold of " + zoneName() + " pays for dangerous beasts slain in its wilds.", 19, C_TEXT);
   var held = heldAll();
   for (var h = 0; h < held.length; h++)
   {
      var hc = held[h];
      var hb = ev("contractAbandon") != "" ? [["Give up", function() { send("contractAbandon", [this._parent.contractId]); }, C_RED]] : [];
      var he = flowEntry("You hold: " + hc.what + " in " + hc.zone, hb, hc.progress + " of " + hc.count + " slain  -  " + hc.reward + " gold  -  " + hoursLabel(hc.hoursLeft));
      he.contractId = String(hc.id);
      he.label.textColor = C_GREEN;
   }
   var work = listOf(c.list);
   if (!work.length)
   {
      flowHint(c.note != undefined && c.note != "" ? String(c.note) : "No hunting work is posted here right now.");
   }
   for (var i = 0; i < work.length; i++)
   {
      var w = work[i];
      var where = isCommission(w) ? (Number(w.have) > 0 ? "You carry " + w.have : "Goods wanted") : (DANGER_WORD[Number(w.danger)] != undefined && DANGER_WORD[Number(w.danger)] != "" ? DANGER_WORD[Number(w.danger)] : "Dangerous");
      var e = flowEntry(String(w.what) + "  -  " + stampOf(w), [["Read", function() { read("contract", this._parent.contractId); }]],
         where + "  -  " + w.reward + " gold  -  " + hoursLabel(w.hoursLeft));
      e.contractId = String(w.id);
      if (w.state == "yours")
      {
         e.label.textColor = C_GREEN;
      }
   }
}

// ---- a paper read ----

function drawExpeditionPaper(x)
{
   flowHeading(String(x.name));
   flowText(String(x.kind) + (x.county ? ", " + x.county : ""), 17, C_SECOND);
   var k = keepers(x.masters);
   flowText("Sellswords and scholars wanted for " + x.name + ", " + (x.county ? x.county : "far to the south") + "." + (k != "" ? " " + k : "") +
      " Bring back what you find; the ruin is yours for the hour.", 19, C_TEXT);
   flowText(String(x.status), 17, C_SECOND);
   flowGap(8);
   flowButtons([[x.state == "yours" ? "Rejoin your party" : "Gather your party", function()
   {
      var id = selected.id;
      selected = null;
      send("pick", [id]);
      draw();
   }], ["Back", function() { back(); }]]);
}

function drawCommissionPaper(c)
{
   var cs = contracts();
   flowHeading(String(c.what));
   flowText("A commission  -  " + hoursLabel(c.hoursLeft), 17, C_SECOND);
   flowText("The hold of " + zoneName() + " buys " + c.count + " " + c.item + " at " + c.price + " gold each, paid from its treasury the moment you hand them in." +
      " Only plain goods count: named, enchanted or tempered ones stay in your pack.", 19, C_TEXT);
   flowText((c.state == "posted" ? "You posted this commission; someone else must fill it." : "You carry " + (Number(c.have) > 0 ? c.have : 0) + ".") +
      (c.postedBy ? " Posted by " + c.postedBy + "." : ""), 17, C_SECOND);
   flowGap(8);
   var b = [];
   var n = Math.min(Number(c.have) > 0 ? Number(c.have) : 0, Number(c.count));
   if (c.state != "posted" && n > 0 && cs.enabled == true && ev("contractDeliver") != "")
   {
      b.push(["Hand in " + n + " for " + (n * Number(c.price)) + " gold", function()
      {
         var id = selected.id;
         var count = this.count;
         selected = null;
         send("contractDeliver", [id, count]);
         draw();
      }]);
   }
   b.push(["Back", function() { back(); }]);
   var row = flowButtons(b);
   if (b.length > 1)
   {
      row.btn0.count = n;
   }
}

function drawContractPaper(c)
{
   var cs = contracts();
   var danger = DANGER_WORD[Number(c.danger)] != undefined && DANGER_WORD[Number(c.danger)] != "" ? DANGER_WORD[Number(c.danger)] : "Dangerous";
   flowHeading(String(c.what));
   flowText(danger + "  -  " + hoursLabel(c.hoursLeft), 17, C_SECOND);
   flowText("The hold of " + zoneName() + " pays " + c.reward + " gold for " + c.what + " slain in its wilds." +
      " The reward is set aside from the treasury and paid the moment the last one falls.", 19, C_TEXT);
   var full = heldAll().length >= maxActive();
   var line = c.state == "yours" ? "You hold this contract." : c.state == "posted" ? "You posted this notice; someone else must do the hunting." :
      full ? (maxActive() == 1 ? "You already hold a contract." : "You already hold " + maxActive() + " contracts, the most at once.") : "Open to any hunter.";
   flowText(line + (c.postedBy ? " Posted by " + c.postedBy + "." : ""), 17, C_SECOND);
   flowGap(8);
   var b = [];
   if (c.state == "open" && !full && cs.enabled == true && ev("contractTake") != "")
   {
      b.push(["Take the contract", function() { var id = selected.id; selected = null; send("contractTake", [id]); draw(); }]);
   }
   if (c.state == "yours" && ev("contractAbandon") != "")
   {
      b.push(["Give it up", function() { var id = selected.id; selected = null; send("contractAbandon", [id]); draw(); }, C_RED]);
   }
   b.push(["Back", function() { back(); }]);
   flowButtons(b);
}

// ---- the panel ----

function drawHead()
{
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 16, PANEL_W - PAD * 2, tab == "contracts" ? "Hunting Contracts" : "Expeditions");
   if (contracts() != null)
   {
      var tabs = [["expeditions", "Expeditions (" + listOf(data.expeditions).length + ")"], ["contracts", "Contracts (" + listOf(contracts().list).length + ")"]];
      var x = PAD;
      for (var i = 0; i < tabs.length; i++)
      {
         var w = 200;
         var b = button(h, "t" + i, 10 + i, x, 66, w, tabs[i][1], F_MEDIUM, 22, tabs[i][0] == tab ? A_FOCUS : A_ROW_REST, function() { setTab(this.v); });
         b.v = tabs[i][0];
         if (tabs[i][0] == tab)
         {
            dboTabMark(b, w - 30);
         }
         x += w + 10;
      }
   }
   dboDivider(h, PAD, 114, PANEL_W - PAD * 2);
}

function drawFoot(pages)
{
   var f = clear("foot", 60);
   var hint = "";
   if (tab == "contracts")
   {
      var m = maxActive();
      hint = "You may hold " + (m == 1 ? "one contract" : "up to " + m + " contracts") + " at a time and are paid the moment each one's last beast falls. Kills count only in " +
         (contracts() != null && contracts().zone ? contracts().zone : "the hold") + "'s wilds. Commissions buy goods: hand them in here." +
         (contracts() != null && contracts().canPost == true ? " As an official you post work and commissions in the Court tab of your journal (F3), or with /contract post <creature> <count> <reward>." : "");
   }
   else
   {
      hint = "A claim lasts " + (data.leaseMinutes ? data.leaseMinutes : 60) + " minutes. Once the ruin's master falls, the party comes home " + (data.bossReturnMinutes ? data.bossReturnMinutes : 10) +
         " minutes later. Inside, return to the entrance or say /expedition leave to come home early.";
   }
   var r = dboText(f, "hint", 1, PAD, PANEL_H - 116, PANEL_W - PAD * 2, 52, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), true);
   r.text = hint;
   dboDivider(f, PAD, PANEL_H - 62, PANEL_W - PAD * 2);
   var p = dboText(f, "pages", 2, PAD, PANEL_H - 46, 400, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   p.text = pages > 1 ? "Page " + (page + 1) + " of " + pages + " (Left / Right)" : "";
   button(f, "close", 10, PANEL_W - PAD - 100, PANEL_H - 48, 100, "Close", F_MEDIUM, 20, A_BUTTON_REST, function() { closeMenu(); });
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
   var paper = null;
   if (selected != null)
   {
      paper = selected.kind == "expedition" ? find(listOf(data.expeditions), selected.id) : contracts() != null ? find(listOf(contracts().list), selected.id) : null;
      if (paper == null)
      {
         selected = null;
      }
   }
   if (paper != null && selected.kind == "expedition")
   {
      drawExpeditionPaper(paper);
   }
   else if (paper != null)
   {
      if (isCommission(paper))
      {
         drawCommissionPaper(paper);
      }
      else
      {
         drawContractPaper(paper);
      }
   }
   else if (tab == "contracts" && contracts() != null)
   {
      drawContracts();
   }
   else
   {
      drawExpeditions();
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
   if (p == null || p.expeditions == undefined)
   {
      dboLog("expedition: unreadable payload");
      return;
   }
   data = p;
   // the server redraws the board on the Contracts tab after a take or a give-up; a re-sent board ends any reading
   if (contracts() != null && data.tab == "contracts")
   {
      tab = "contracts";
   }
   else if (contracts() == null)
   {
      tab = "expeditions";
   }
   selected = null;
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (code == 27)
   {
      if (selected != null)
      {
         back();
         return;
      }
      if (data != null)
      {
         closeMenu();
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
      dboLog("expedition: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
