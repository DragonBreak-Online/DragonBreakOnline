// Thievery (server thievery.js): thief factions and their Fence Chests, approving a faction, guard raid reports, the
// stolen ledger, hall permits, and who is at a lock or inside now. As the browser's tab: the state is a staffData widget
// watched while open; every button is dbo:staffThievery with the chat command's arguments, and the server checks the tier
// (Lead GM: factions and fences; GMs: raids, permits, sending back). Everything that cannot be undone asks first.
var thLocal = {reasons: {}, permitName: "", permitHours: "24", factionPage: 0, tickAt: 0};

function thNow()
{
   return Number(data.thievery.serverNow) + (getTimer() - dataAt);
}

function th(args)
{
   dboSound("UIMenuOK");
   dboSend("dbo:staffThievery", args);
}

function utcWhen(ms)
{
   var d = new Date(ms);
   return pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()) + " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + " UTC";
}

function drawFactions(c, x, y, w, D)
{
   var list = D.factions instanceof Array ? D.factions : [];
   var per = 6;
   var pages = Math.max(1, Math.ceil(list.length / per));
   thLocal.factionPage = Math.max(0, Math.min(pages - 1, thLocal.factionPage));
   if (!list.length)
   {
      empty(c, "none", 10, x, y, w, "No faction may burgle yet");
   }
   var rows = list.slice(thLocal.factionPage * per, thLocal.factionPage * per + per);
   for (var i = 0; i < rows.length; i++)
   {
      var f = rows[i];
      var ry = y + i * 44;
      label(c, "fn" + i, 20 + i * 6, x, ry + 2, 260, cut(f.name + (f.config == true ? " (config)" : ""), 26), 18, C_TEXT);
      hint(c, "ff" + i, 21 + i * 6, x + 270, ry + 4, 330, cut(f.fence != null ? "Fence Chest " + f.fence.chest + ", " + plural(f.fence.lots, "lot") + (f.fence.frozen ? ", frozen by raid #" + f.fence.frozen : "") : "No Fence Chest", 44));
      if (D.lead != true)
      {
         continue;
      }
      var mk = btn(c, "mark" + i, 22 + i * 6, x + 610, ry, 120, f.fence != null ? "Move fence" : "Mark fence", function()
      {
         th(["mark", this.fid]);
      });
      mk.fid = f.id;
      if (f.fence != null)
      {
         var um = confirmBtn(c, "unmark" + i, 23 + i * 6, x + 736, ry, 120, "Unmark", "unmark:" + f.id, function()
         {
            th(["unmark", this.fid]);
         }, f.fence.lots > 0 || f.fence.frozen > 0);
         um.fid = f.id;
      }
      var rv = confirmBtn(c, "revoke" + i, 24 + i * 6, x + 862, ry, w - 862, "Revoke", "revoke:" + f.id, function()
      {
         th(["revoke", this.fid]);
      }, f.config == true);
      rv.fid = f.id;
   }
   pageTurn = function(d)
   {
      var p = Math.max(0, Math.min(pages - 1, thLocal.factionPage + d));
      if (p != thLocal.factionPage)
      {
         dboSound("UIMenuPrevNext");
         thLocal.factionPage = p;
         draw();
      }
   };
   if (pages > 1)
   {
      hint(c, "fpage", 70, x, y + per * 44, 300, "Page " + (thLocal.factionPage + 1) + " of " + pages + "  (Left / Right)");
   }
   hint(c, "foot", 71, x, CB - 48, w, "Mark fence, then open an empty container in the faction's hall: it becomes the Fence Chest and never opens as a container again. A faction named in the config is revoked there.", 46);
}

function drawApprove(c, x, y, w, D)
{
   var list = D.candidates instanceof Array ? D.candidates : [];
   if (!list.length)
   {
      empty(c, "none", 10, x, y, w, "No faction is waiting to be approved");
   }
   for (var i = 0; i < list.length && i < 10; i++)
   {
      var ry = y + i * 44;
      label(c, "an" + i, 20 + i * 3, x, ry + 2, 360, cut(list[i].name, 34), 18, C_TEXT);
      hint(c, "ai" + i, 21 + i * 3, x + 370, ry + 4, 300, list[i].id);
      var ap = confirmBtn(c, "approve" + i, 22 + i * 3, x + 700, ry, 0, "Approve", "approve:" + list[i].id, function()
      {
         th(["approve", this.fid]);
      });
      ap.fid = list[i].id;
   }
}

function drawRaids(c, x, y, w, D)
{
   var now = thNow();
   var list = D.raids instanceof Array ? D.raids : [];
   if (!list.length)
   {
      empty(c, "none", 10, x, y, w, "No raid reports. Guards file them with /fence report.");
   }
   var cy = y;
   for (var i = 0; i < list.length; i++)
   {
      var r = list[i];
      var d = 20 + i * 20;
      label(c, "rn" + i, d, x, cy, 300, cut("#" + r.n + " " + r.faction, 30), 18, C_TEXT);
      hint(c, "rby" + i, d + 1, x + 310, cy + 2, 300, cut("by " + r.by + ", " + span(r.at - now), 40));
      label(c, "rs" + i, d + 2, x + 620, cy, w - 620, cut(r.state == "pending" ? "Waiting for a GM" : r.state == "approved" ? "Frozen; may be ruled " + (r.raidAt > now ? span(r.raidAt - now) : "now") : r.state + (str(r.decidedBy) != "" ? " by " + r.decidedBy : ""), 34), 18, r.state == "pending" ? C_GOLD : C_SECOND);
      label(c, "re" + i, d + 3, x + 12, cy + 26, w - 12, r.evidence, 16, C_TEXT, true, 44);
      var ay = cy + 74;
      if (str(r.reason) != "")
      {
         hint(c, "rr" + i, d + 4, x + 12, ay, w - 12, cut("Reason: " + r.reason, 110));
         ay += 24;
      }
      if (r.state == "pending")
      {
         var ap = confirmBtn(c, "rapprove" + i, d + 5, x, ay, 0, "Approve", "raid:" + r.n + ":approve", function()
         {
            th(["raid", this.n, "approve"]);
         });
         ap.n = r.n;
         field(c, "reason" + r.n, d + 6, x + 170, ay + 2, 440, thLocal.reasons[r.n], "Reason to deny (the guard is told)", 300, makeReasonCommit(r.n));
         var dn = confirmBtn(c, "rdeny" + i, d + 7, x + 626, ay, 0, "Deny", "raid:" + r.n + ":deny", function()
         {
            th(["raid", this.n, "deny", trimText(thLocal.reasons[this.n])]);
         }, trimText(thLocal.reasons[r.n]) == "");
         dn.n = r.n;
         ay += 40;
      }
      else if (r.state == "approved")
      {
         var early = r.raidAt > now && D.lead != true;
         var won = confirmBtn(c, "rwon" + i, d + 5, x, ay, 0, "Won: lots go home", "raid:" + r.n + ":won", function()
         {
            th(["raid", this.n, "won"]);
         }, early);
         won.n = r.n;
         var lost = confirmBtn(c, "rlost" + i, d + 6, x + 270, ay, 0, "Lost: unfreeze", "raid:" + r.n + ":lost", function()
         {
            th(["raid", this.n, "lost"]);
         }, early);
         lost.n = r.n;
         if (r.raidAt > now)
         {
            hint(c, "rwhen" + i, d + 7, x + 510, ay + 4, w - 510, D.lead == true ? "The notice is not out yet: ruling now is a Lead GM's call." : "The thieves have until " + utcWhen(r.raidAt) + ".");
         }
         ay += 40;
      }
      cy = ay + 8;
      dboRule(c, x, cy - 6, w);
   }
   pager(c, "pg", 90, x, CB - 30, Number(D.page), Number(D.pages));
}

function makeReasonCommit(n)
{
   return function(text)
   {
      thLocal.reasons[n] = text;
   };
}

function drawLedger(c, x, y, w, D)
{
   var now = thNow();
   field(c, "owner", 10, x, y, 260, str(ui.owner), "Owner or home", 40, function(text)
   {
      setUi("owner", text);
   }, true);
   field(c, "thief", 11, x + 272, y, 220, str(ui.thief), "Thief", 40, function(text)
   {
      setUi("thief", text);
   }, true);
   hint(c, "count", 12, x + 510, y + 4, w - 510, D.shown + " of " + D.loaded + (D.total > D.loaded ? " (the newest " + D.loaded + " of " + D.total + ")" : ""));
   var rows = D.ledger instanceof Array ? D.ledger : [];
   if (!rows.length)
   {
      empty(c, "none", 13, x, y + 44, w, D.loaded ? "Nothing matches" : "Nothing has been stolen");
   }
   var ly = rowList(c, "r", 20, x, y + 40, w, rows, function(s)
   {
      return [[cut("#" + s.n + " " + s.item, 26), 0, 250], [cut(s.home + " (" + s.owner + ")", 28), 256, 270, C_SECOND], [cut(s.thief + ", " + span(s.at - now), 26), 532, 250, C_SECOND], [s.state, 790, w - 820, s.state == "sent back" ? C_GREEN : C_TEXT]];
   }, function(s)
   {
      ui.lot = s.n;
      draw();
   }, function(s)
   {
      return s.n == ui.lot;
   });
   pager(c, "pg", 40, x, ly + 4, Number(D.page), Number(D.pages), Number(D.shown), "lot");
   var pick = null;
   for (var i = 0; i < rows.length; i++)
   {
      if (rows[i].n == ui.lot)
      {
         pick = rows[i];
      }
   }
   var ay = CB - 74;
   label(c, "picked", 50, x, ay + 4, 420, pick != null ? cut("#" + pick.n + " " + pick.item, 40) : "Pick a lot", 18, pick != null ? C_TEXT : C_SECOND);
   confirmBtn(c, "sendback", 51, x + 430, ay, 0, "Send back", "sendback:" + (pick != null ? pick.n : ""), function()
   {
      th(["sendback", ui.lot]);
   }, pick == null || pick.canSendBack != true);
   hint(c, "foot", 52, x, ay + 40, w, "Send back returns a fenced lot, or a carried one from a thief who is online, to its owner (at their next login if they are away).");
}

function drawPermits(c, x, y, w, D)
{
   var now = thNow();
   section(c, "grantHead", 10, x, y, 200, "Hall permits");
   field(c, "permitName", 11, x, y + 30, 300, thLocal.permitName, "Thief (online, name or #TAG)", 40, function(text)
   {
      thLocal.permitName = text;
   });
   hint(c, "hoursL", 12, x + 316, y + 34, 50, "Hours");
   field(c, "permitHours", 13, x + 366, y + 30, 70, thLocal.permitHours, "24", 4, function(text)
   {
      thLocal.permitHours = text;
   });
   btn(c, "grant", 14, x + 452, y + 28, 0, "Grant, then use the door", function()
   {
      th(["permit", trimText(thLocal.permitName), Number(thLocal.permitHours) || 24]);
   }, trimText(thLocal.permitName) == "");
   var list = D.permits instanceof Array ? D.permits : [];
   if (!list.length)
   {
      empty(c, "none", 15, x, y + 74, w, "No permits");
   }
   var ly = rowList(c, "p", 20, x, y + 72, w, list.slice(0, 6), function(p)
   {
      return [[cut(p.thief, 22), 0, 220], [cut(p.homeName, 30), 226, 300, C_SECOND], [cut("ends " + span(p.until - now) + (str(p.by) != "" ? ", by " + p.by : ""), 40), 532, w - 560, C_SECOND]];
   }, function(p)
   {
      ui.permit = p.home;
      draw();
   }, function(p)
   {
      return p.home == ui.permit;
   });
   confirmBtn(c, "unpermit", 40, x, CB - 36, 0, "Revoke permit", "unpermit:" + str(ui.permit), function()
   {
      th(["unpermit", ui.permit]);
      ui.permit = "";
   }, str(ui.permit) == "");
}

function drawBreaches(c, x, y, w, D)
{
   var now = thNow();
   section(c, "workHead", 10, x, y, 300, "At a lock now");
   var work = D.working instanceof Array ? D.working : [];
   if (!work.length)
   {
      empty(c, "noWork", 11, x, y + 30, w, "Nobody is forcing a lock");
   }
   for (var i = 0; i < work.length; i++)
   {
      label(c, "wt" + i, 20 + i * 3, x, y + 30 + i * 28, 240, cut(work[i].thief, 24), 18, C_TEXT);
      hint(c, "wh" + i, 21 + i * 3, x + 250, y + 32 + i * 28, 360, cut(work[i].home + ", at its " + work[i].kind, 40));
      hint(c, "wu" + i, 22 + i * 3, x + 620, y + 32 + i * 28, w - 620, "to the lockpick " + span(work[i].until - now));
   }
   var by = y + 40 + Math.max(1, work.length) * 28 + 12;
   section(c, "breachHead", 50, x, by, 300, "Live breaches");
   var br = D.breaches instanceof Array ? D.breaches : [];
   if (!br.length)
   {
      empty(c, "noBreach", 51, x, by + 30, w, "No home is breached");
   }
   for (var k = 0; k < br.length; k++)
   {
      label(c, "bt" + k, 60 + k * 3, x, by + 30 + k * 28, 240, cut(br[k].thief, 24), 18, C_TEXT);
      hint(c, "bh" + k, 61 + k * 3, x + 250, by + 32 + k * 28, 360, cut(br[k].home + (str(br[k].faction) != "" ? " (" + br[k].faction + ")" : ""), 40));
      hint(c, "bu" + k, 62 + k * 3, x + 620, by + 32 + k * 28, w - 620, "broke in " + span(br[k].at - now) + ", ends " + span(br[k].until - now));
   }
}

TABS.thievery = {
   open: function()
   {
      dboSend("dbo:staffThievery", ["watch"]);
   },
   leave: function()
   {
      dboSend("dbo:staffThievery", ["unwatch"]);
   },
   tick: function()
   {
      if (editing == null && !picking && getTimer() - thLocal.tickAt >= 15000)
      {
         thLocal.tickAt = getTimer();
         draw();
      }
   },
   draw: function(c, x, y, w, h)
   {
      var D = data.thievery;
      if (D == undefined || D.loading == true)
      {
         empty(c, "loading", 1, x, y + 10, w, "Loading thievery");
         return;
      }
      var subs = [["factions", "Factions & fences (" + D.counts.factions + ")"]];
      if (D.lead == true)
      {
         subs.push(["approve", "Approve"]);
      }
      subs.push(["raids", "Raids (" + D.counts.raids + ")"]);
      subs.push(["ledger", "Stolen ledger (" + D.counts.ledger + ")"]);
      subs.push(["permits", "Permits (" + D.counts.permits + ")"]);
      subs.push(["breaches", "At locks & breaches"]);
      var sub = str(D.sub);
      var cy = chips(c, "sub", 2, x, y, x + w, subs, sub, function()
      {
         dboSound("UIMenuPrevNext");
         setUi("sub", this.key);
      });
      hint(c, "who", 9, x, cy, w, (D.enabled == true ? "Burglary is on." : "Burglary is off (thievery.enabled).") + " " + (D.lead == true ? "Lead GM: every control." : "GM: raids, permits and sending back; factions and fences are for a Lead GM."));
      cy += 26;
      if (D.result != null)
      {
         label(c, "result", 10, x, cy, w, cut(D.result.text, 110), 18, D.result.ok == true ? C_GREEN : C_RED);
         cy += 28;
      }
      if (D.armed != null)
      {
         var left = span(D.armed.until - thNow()).split("in ").join("");
         label(c, "armed", 11, x, cy + 2, w - 120, cut(D.armed.kind == "fence" ? "Open the container that is to be the Fence Chest" : "Use the door or chest of the home " + D.armed.name + " may break into", 80) + " (" + left + " left)", 18, C_GOLD);
         btn(c, "cancel", 12, x + w - 100, cy - 2, 100, "Cancel", function()
         {
            th(["cancel"]);
         });
         cy += 36;
      }
      if (sub == "approve")
      {
         drawApprove(c, x, cy + 4, w, D);
      }
      else if (sub == "raids")
      {
         drawRaids(c, x, cy + 4, w, D);
      }
      else if (sub == "ledger")
      {
         drawLedger(c, x, cy + 4, w, D);
      }
      else if (sub == "permits")
      {
         drawPermits(c, x, cy + 4, w, D);
      }
      else if (sub == "breaches")
      {
         drawBreaches(c, x, cy + 4, w, D);
      }
      else
      {
         drawFactions(c, x, cy + 4, w, D);
      }
   }
};
