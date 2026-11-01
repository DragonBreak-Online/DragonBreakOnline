// The notice board's Citizenship and Voting as a native panel (server citizenship.js, widget 84: the same object
// skymp5-front features/citizenBoard gets). Citizenship: the hold's policy, becoming a citizen or asking, renouncing; the
// ruler and Steward set the policy (a typed fee) and answer requests. Voting: the Jarl's election in its phase, with no
// count until the vote has ended; a candidate names a court (typed names) and its members accept. Actions go out as the
// browser's dbo:citizenAct [nonce, action, ...args] and the server answers by sending the panel again with a result line;
// dbo:citizenBack returns to the board, dbo:citizenClose closes. A game that cannot type is offered the browser panel
// (dbo:citizenAct [nonce, "browser"]), as the pigeon coop and the journal do.

var DBO_SWF_VERSION = "citizen-1";
var PANEL_W = 1000;
var PANEL_H = 640;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
var BODY_TOP = 128;
BODY_H = PANEL_H - 124 - BODY_TOP;
var NO_DATA_CLOSE_MS = 8000;
var BUSY_TIMEOUT_MS = 8000;
var C_RED = 0xB23A3A;
var C_GREEN = 0x7FBF7F;

var panel;
var data = null;
var page = 0;
var busyAt = 0;
// asking: one more question before an action that costs or ends something, {q, label, go, danger}
var asking = null;
var builtAt = getTimer();

formHost.busy = function() { return busy(); };
formHost.redraw = function() { draw(); };
formHost.fallback = function() { act("browser", []); };
formHost.fallbackText = "the browser board";
formHost.onOpen = function() { page = 0; asking = null; };

function busy()
{
   return busyAt > 0 && getTimer() - busyAt < BUSY_TIMEOUT_MS;
}

// One action in flight at a time, as the browser's: the server's answer (a new payload) ends it
function act(action, args)
{
   if (busy())
   {
      return;
   }
   busyAt = getTimer();
   asking = null;
   dboSound("UIMenuOK");
   var out = [String(data.nonce), String(action)];
   var list = args != undefined ? args : [];
   for (var i = 0; i < list.length; i++)
   {
      out.push(String(list[i]));
   }
   dboSend("dbo:citizenAct", out);
   draw();
}

function ask(q, label, go, danger)
{
   asking = {q: q, label: label, go: go, danger: danger == true};
   dboSound("UIMenuOK");
   page = 0;
   draw();
}

function closeMenu()
{
   dboSound("UIMenuCancel");
   dboInputEnd();
   dboSend("dbo:citizenClose", []);
   dboClose();
}

function backToBoard()
{
   dboSound("UIMenuCancel");
   dboInputEnd();
   dboSend("dbo:citizenBack", []);
   dboClose();
}

function ofPlace(n)
{
   n = String(n);
   return n.substr(0, 4) == "The " ? "the " + n.substr(4) : n;
}

function upperFirst(s)
{
   s = String(s);
   return s.charAt(0).toUpperCase() + s.substr(1);
}

// ---- citizenship ----

function policyText(c)
{
   if (c.hasRuler != true)
   {
      return c.name + " has no " + c.ruler + " in the seat, so its citizenship is free to all who ask.";
   }
   if (c.policy == "paid")
   {
      return "The citizenship of " + ofPlace(c.name) + " costs " + c.fee + " gold, paid into the hold's treasury.";
   }
   if (c.policy == "manual")
   {
      return "The citizenship of " + ofPlace(c.name) + " is granted by the " + c.ruler + " or the Steward, to those who ask in person.";
   }
   return "The citizenship of " + ofPlace(c.name) + " is free.";
}

function feeForm(m)
{
   form(function(vals)
   {
      var n = formNumber(vals, "fee");
      return {title: "The citizenship fee", hint: "Paid into the hold's treasury by each new citizen.",
         fields: [{key: "fee", label: "Fee in gold, 1 to " + m.maxFee, kind: "number", max: 7, hint: "Type the fee"}],
         buttons: [["Set the fee", function(v) { act("policy", ["paid", formNumber(v, "fee")]); }, n >= 1 && n <= Number(m.maxFee)]]};
   }, {fee: Number(m.fee) > 0 ? String(m.fee) : ""});
}

function drawManage(c)
{
   var m = c.manage;
   flowHeading("For the " + c.ruler + " and the Steward");
   flowText("How citizenship is granted", 16, C_SECOND);
   var b = [["Manual approval", function() { act("policy", ["manual"]); }, undefined, busy(), m.policy == "manual"],
      ["Free", function() { act("policy", ["free"]); }, undefined, busy(), m.policy == "free"]];
   if (m.treasury == true)
   {
      b.push([m.policy == "paid" ? "Paid: " + m.fee + " gold" : "Paid...", function() { feeForm(data.citizenship.manage); }, undefined, busy(), m.policy == "paid"]);
   }
   flowButtons(b);
   if (m.treasury != true)
   {
      flowHint("No treasury here, so no fee.");
   }
   if (c.hasRuler != true)
   {
      flowHint("While nobody sits as " + c.ruler + ", citizenship is free whatever is set here.");
   }
   flowText("Asked to become citizens", 16, C_SECOND);
   var reqs = listOf(m.requests);
   if (!reqs.length)
   {
      flowHint("Nobody has asked.");
   }
   for (var i = 0; i < reqs.length; i++)
   {
      var r = reqs[i];
      var e = flowEntry(String(r.name) + (r.tag ? "  #" + r.tag : ""), [["Grant", function() { act("grant", [this._parent.actor]); }, undefined, busy()],
         ["Decline", function() { act("decline", [this._parent.actor]); }, undefined, busy()]], whenText(r.at));
      e.actor = String(r.actor);
   }
}

function drawCitizenship(c)
{
   flowText(policyText(c), 19, C_TEXT);
   flowHeading("Your citizenship (" + listOf(c.holds).length + " of " + c.maxHolds + ")");
   var holds = listOf(c.holds);
   if (!holds.length)
   {
      flowHint("You are a citizen of no hold.");
   }
   for (var i = 0; i < holds.length; i++)
   {
      var h = holds[i];
      var how = h.auto == true ? "through a faction or court based there" : i == 0 ? "Primary" : "Secondary";
      flowRow(String(h.name), how, h.since ? "since " + whenText(h.since) : "");
   }
   if (c.citizen == true)
   {
      if (c.auto == true)
      {
         flowText("You are a citizen of " + ofPlace(c.name) + " for as long as you serve a faction or court based here.", 18, C_SECOND);
      }
      else
      {
         flowButtons([["Renounce " + c.name, function()
         {
            ask("Renounce the citizenship of " + ofPlace(data.citizenship.name) + "? You cannot take another citizenship for 7 days, and you cannot buy property here.",
               "Renounce", function() { act("renounce", []); }, true);
         }, C_RED, busy()]]);
      }
   }
   else if (c.requested == true)
   {
      flowText("You have asked. Go before the " + c.ruler + " or the Steward: they grant it.", 18, C_TEXT);
      flowButtons([["Withdraw the request", function() { act("renounce", []); }, undefined, busy()]]);
   }
   else if (c.why != undefined && c.why != "")
   {
      flowText(String(c.why), 18, C_RED);
   }
   else if (c.can == "paid")
   {
      flowButtons([["Become a citizen for " + c.fee + " gold", function()
      {
         ask("Pay " + data.citizenship.fee + " gold into the treasury of " + ofPlace(data.citizenship.name) + "?", "Pay", function() { act("join", []); });
      }, undefined, busy()]]);
   }
   else if (c.can == "manual")
   {
      flowButtons([["Ask for citizenship", function() { act("join", []); }, undefined, busy()]]);
   }
   else if (c.can == "free")
   {
      flowButtons([["Become a citizen", function() { act("join", []); }, undefined, busy()]]);
   }
   if (c.cooldownUntil)
   {
      flowHint("You renounced a citizenship lately: you may take another from " + whenText(c.cooldownUntil) + ".");
   }
   flowHint("A citizen may buy property in the hold. Anyone may hold two citizenships at most, a Primary and a Secondary (F3, Citizen).");
   if (c.manage != undefined && c.manage != null)
   {
      drawManage(c);
   }
}

// ---- voting ----

function memberState(m)
{
   if (m.why == "empty")
   {
      return "not named";
   }
   if (m.fit != true)
   {
      return m.why != undefined && m.why != "" ? String(m.why) : "no longer eligible";
   }
   return m.accepted == true ? "" : "has not accepted yet";
}

function replaceForm(seat, label)
{
   form(function(vals)
   {
      var n = vals.name != undefined ? String(vals.name) : "";
      return {title: "Replace the " + label, hint: "A citizen of " + ofPlace(data.voting.name) + " who serves no faction; they must accept.",
         fields: [{key: "name", label: "Name or #TAG", kind: "text", max: 40, hint: "Type a name"}],
         buttons: [["Name them", function(v) { act("replace", [seat, String(v.name)]); }, n != ""]]};
   }, {});
}

function registerForm()
{
   var v = data.voting;
   var seats = listOf(v.seats);
   var others = [];
   for (var i = 0; i < seats.length; i++)
   {
      if (seats[i].id != "jarl")
      {
         others.push(seats[i]);
      }
   }
   form(function(vals)
   {
      var f = [];
      var ready = true;
      for (var k = 0; k < others.length; k++)
      {
         f.push({key: "s" + k, label: String(others[k].label), kind: "text", max: 40, hint: "Name or #TAG"});
         if (vals["s" + k] == undefined || vals["s" + k] == "")
         {
            ready = false;
         }
      }
      return {title: "Stand for Jarl", hint: "Name your court. Every member must be a citizen of " + ofPlace(v.name) + " who serves no faction, and each must accept. You stand as Jarl.",
         fields: f, buttons: [["Enter this court", function(x)
         {
            var names = [];
            for (var q = 0; q < others.length; q++)
            {
               names.push(String(x["s" + q]));
            }
            act("register", names);
         }, ready]]};
   }, {});
}

// A court: its Jarl, its members and their state; on the ballot a vote button, for its own Jarl replace and withdraw
function drawCourt(court, ballot, canVote)
{
   var head = "The court of " + court.jarl + (court.struck ? "  (struck: " + court.struck + ")" : "");
   flowEntry(head, [], ballot ? "" : court.complete == true ? "Complete" : "Incomplete");
   var members = listOf(court.members);
   for (var i = 0; i < members.length; i++)
   {
      var m = members[i];
      var who = m.name != undefined && m.name != "" ? String(m.name) + (m.tag ? "  #" + m.tag : "") : "(empty)";
      var st = ballot ? "" : memberState(m);
      // a member who still has to act, or no longer can, shows it beside the name in red
      var r = flowRow(String(m.label), who + (st != "" ? "  -  " + st : ""), "");
      if (st != "")
      {
         r.textColor = C_RED;
      }
   }
   if (ballot && canVote)
   {
      var vb = flowButtons([["Vote for this court", function()
      {
         var id = this.court;
         var jarl = this.jarl;
         ask("Cast your one vote for the court of " + jarl + "? It cannot be changed.", "Vote", function() { act("vote", [id]); });
      }, undefined, busy()]]);
      vb.btn0.court = String(court.id);
      vb.btn0.jarl = String(court.jarl);
   }
   if (!ballot && court.mine == true)
   {
      var b = [];
      var open = [];
      for (var j = 0; j < members.length; j++)
      {
         if (members[j].seat != "jarl" && (members[j].why == "empty" || members[j].fit != true))
         {
            open.push(members[j]);
            b.push(["Replace the " + members[j].label, function() { replaceForm(this.seat, this.seatName); }, undefined, busy()]);
         }
      }
      b.push(["Withdraw your court", function() { ask("Withdraw your court from the election?", "Withdraw", function() { act("withdraw", []); }, true); }, C_RED, busy()]);
      var row = flowButtons(b);
      for (var o = 0; o < open.length; o++)
      {
         row["btn" + o].seat = String(open[o].seat);
         // seatName, not label: a button's label is its own text field
         row["btn" + o].seatName = String(open[o].label);
      }
   }
   flowGap(6);
}

function drawStaff(v)
{
   if (v.staff != true)
   {
      return;
   }
   flowHeading("Staff");
   var b = [];
   if (v.phase == "held")
   {
      b.push(["Let it start by itself again", function() { act("staff", ["resume"]); }, undefined, busy()]);
   }
   else if (v.phase != undefined && v.phase != "none")
   {
      b.push(["Hold the election", function() { ask("Stop this election until staff restart it? Its courts and votes are kept but nothing moves.", "Hold", function() { act("staff", ["cancel"]); }, true); }, C_RED, busy()]);
   }
   b.push(["Restart now", function()
   {
      ask("Start a fresh election now: " + data.voting.registrationHours + " hours of registration? Courts and votes so far are dropped.", "Restart", function() { act("staff", ["restart"]); });
   }, undefined, busy()]);
   flowButtons(b);
}

function drawVoting(v)
{
   if (v.electing != true)
   {
      flowText(v.why != undefined ? String(v.why) : "", 19, C_TEXT);
      return;
   }
   var phase = v.phase != undefined ? String(v.phase) : "none";
   var seats = listOf(v.seats);
   if (phase == "none")
   {
      flowText(upperFirst(ofPlace(v.name)) + " will choose its Jarl once " + v.threshold + " of its people are citizens. Today: " + v.citizens + " of " + v.threshold + ".", 19, C_TEXT);
      flowHint("Then candidates have " + v.registrationHours + " hours to enter a full court, and the citizens " + v.votingHours + " hours to vote.");
   }
   else if (phase == "held")
   {
      flowText("The election is held by the staff for now.", 19, C_TEXT);
   }
   else if (phase == "registration")
   {
      var labels = [];
      for (var s = 0; s < seats.length; s++)
      {
         labels.push(String(seats[s].label));
      }
      flowText("Courts may be entered until " + whenText(v.endsAt) + ". Then the vote runs " + v.votingHours + " hours. A court stands on the ballot only when all four have accepted: " + labels.join(", ") + ".", 19, C_TEXT);
      var inv = listOf(v.invites);
      for (var i = 0; i < inv.length; i++)
      {
         var e = flowEntry(inv[i].jarl + " names you " + inv[i].seat + " of their court.", [["Accept", function() { act("accept", [this._parent.court]); }, undefined, busy()],
            ["Refuse", function() { act("refuse", [this._parent.court]); }, undefined, busy()]]);
         e.court = String(inv[i].court);
      }
      var courts = listOf(v.courts);
      flowHeading("Courts entered");
      if (!courts.length)
      {
         flowHint("No court has been entered yet.");
      }
      for (var c = 0; c < courts.length; c++)
      {
         drawCourt(courts[c], false, false);
      }
      if (v.inCourt != true)
      {
         if (v.standWhy != undefined && v.standWhy != "")
         {
            var w = String(v.standWhy);
            if (w.substr(0, 3) == "is ")
            {
               w = "are " + w.substr(3);
            }
            else if (w.substr(0, 6) == "serves")
            {
               w = "serve" + w.substr(6);
            }
            flowHint("You cannot stand for Jarl: you " + w + ".");
         }
         else
         {
            flowButtons([["Stand for Jarl...", function() { registerForm(); }, undefined, busy()]]);
         }
      }
   }
   else if (phase == "voting")
   {
      flowText((v.revote == true ? "The vote was tied. A new vote between the tied courts" : "The vote") + " runs until " + whenText(v.endsAt) + ". Nobody sees a count until it ends.", 19, C_TEXT);
      if (v.voted == true)
      {
         flowText("Your vote is cast.", 18, C_GREEN);
      }
      else if (v.voteWhy != undefined && v.voteWhy != "")
      {
         flowText(String(v.voteWhy), 18, C_RED);
      }
      else
      {
         flowText("One vote for each player. Choose a court.", 18, C_TEXT);
      }
      var ballot = listOf(v.ballot);
      for (var b = 0; b < ballot.length; b++)
      {
         drawCourt(ballot[b], true, v.voted != true && !(v.voteWhy != undefined && v.voteWhy != ""));
      }
   }
   else
   {
      var r = v.result;
      if (r != undefined && r != null && r.winner != undefined && r.winner != null)
      {
         flowText(upperFirst(ofPlace(v.name)) + " has chosen its Jarl: " + r.winner.jarl + ", on " + whenText(r.at) + ".", 19, C_TEXT);
         drawCourt(r.winner, true, false);
         var empty = listOf(r.empty);
         if (empty.length)
         {
            flowHint("The seat" + (empty.length > 1 ? "s" : "") + " of " + empty.join(", ") + " started empty; the Jarl appoints a citizen from the court panel.");
         }
         flowHeading("The count");
         var counts = listOf(r.counts);
         for (var k = 0; k < counts.length; k++)
         {
            flowRow("The court of " + counts[k].jarl, counts[k].votes + " vote" + (Number(counts[k].votes) == 1 ? "" : "s"), "");
         }
      }
      else
      {
         flowText("The election is over.", 19, C_TEXT);
      }
   }
   drawStaff(v);
}

// ---- the panel ----

function drawAsk()
{
   flowHeading("Are you sure?");
   flowText(asking.q, 20, C_TEXT);
   flowGap(10);
   flowButtons([[asking.label, function() { var go = asking.go; asking = null; go(); }, asking.danger ? C_RED : undefined, busy()],
      ["Back", function() { asking = null; dboSound("UIMenuCancel"); draw(); }]]);
}

function setTab(t)
{
   if (data.tab == t)
   {
      return;
   }
   page = 0;
   closeForm();
   act("tab", [t]);
}

function drawHead()
{
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 16, PANEL_W - PAD * 2, String(data.name) + " Notice Board");
   var tabs = [["citizenship", "Citizenship"], ["voting", "Voting"]];
   var on = data.tab == "voting" ? "voting" : "citizenship";
   var x = PAD;
   for (var i = 0; i < tabs.length; i++)
   {
      var w = 170;
      var b = button(h, "t" + i, 10 + i, x, 66, w, tabs[i][1], F_MEDIUM, 22, tabs[i][0] == on ? A_FOCUS : A_ROW_REST, function() { setTab(this.v); });
      b.v = tabs[i][0];
      if (tabs[i][0] == on)
      {
         dboTabMark(b, w - 30);
      }
      x += w + 10;
   }
   dboDivider(h, PAD, 114, PANEL_W - PAD * 2);
}

function drawFoot(pages)
{
   var f = clear("foot", 60);
   var r = dboText(f, "result", 1, PAD, PANEL_H - 116, PANEL_W - PAD * 2, 48, dboFmt(F_MEDIUM, 18, data.resultKind == "refused" ? C_RED : C_GREEN, 0.5), true);
   r.text = data.result != undefined ? String(data.result) : "";
   dboDivider(f, PAD, PANEL_H - 62, PANEL_W - PAD * 2);
   var p = dboText(f, "pages", 2, PAD, PANEL_H - 46, 360, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   p.text = pages > 1 ? "Page " + (page + 1) + " of " + pages + " (Left / Right)" : "";
   button(f, "back", 10, PANEL_W - PAD - 330, PANEL_H - 48, 220, "Back to the board", F_MEDIUM, 20, A_BUTTON_REST, function() { backToBoard(); });
   button(f, "close", 11, PANEL_W - PAD - 100, PANEL_H - 48, 100, "Close", F_MEDIUM, 20, A_BUTTON_REST, function() { closeMenu(); });
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
   if (forming != null)
   {
      formBegin();
      drawForm();
      formEnd();
   }
   else if (asking != null)
   {
      drawAsk();
   }
   else if (data.grants != true)
   {
      flowText(data.why != undefined ? String(data.why) : "", 19, C_TEXT);
   }
   else if (data.tab == "voting" && data.voting != undefined && data.voting != null)
   {
      drawVoting(data.voting);
   }
   else if (data.citizenship != undefined && data.citizenship != null)
   {
      drawCitizenship(data.citizenship);
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
   if (p == null || p.nonce == undefined || p.tab == undefined)
   {
      dboLog("citizen: unreadable payload");
      return;
   }
   var tabChanged = data != null && data.tab != p.tab;
   data = p;
   busyAt = 0;
   // a re-sent panel ends a question, as the browser's does; a form stays open unless the tab changed under it
   asking = null;
   if (tabChanged)
   {
      closeForm();
      page = 0;
   }
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
      if (asking != null)
      {
         asking = null;
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
      dboLog("citizen: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
