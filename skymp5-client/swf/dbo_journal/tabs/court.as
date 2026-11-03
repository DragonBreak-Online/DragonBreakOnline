// Court (court.js): the courts you serve, are offered a post in, or (staff) every zone, with four views: Court (offers to you,
// the treasury and tax, Step down, beasts seen, offers waiting), Offices (holders with Move and Dismiss), Household (members
// with their rank and Remove) and Hunting (the contract terms and the work posted by hand). Every number, name and search
// is typed in a form in place of the tab (ctx.form): the tax, wages, Appoint and Offer, Invite, renaming an office or a
// rank, the contract terms, posting a hunt and commissioning goods, as the browser court's controls.
// Actions are dbo:court* with the nonce first
var courtZone = "";
// The court a paged payload was last asked about: one shown without its page is asked for once
var courtAsked = "";
var courtView = "court";
var courtSelected = "";
var courtMoving = "";
var courtRanking = "";
var courtOf = "";
var courtLast = null;

function courtHours(until)
{
   var h = Math.max(0, Math.round((until - new Date().getTime()) / 3600000));
   return h <= 1 ? "less than an hour left" : h + " hours left";
}

function courtUntil(t)
{
   var ms = Math.max(0, t - new Date().getTime());
   var d = Math.floor(ms / 86400000);
   var h = Math.floor((ms % 86400000) / 3600000);
   var m = Math.ceil((ms % 3600000) / 60000);
   return d ? d + "d " + h + "h" : h ? h + "h " + m + "m" : m + "m";
}

// A whole number set with its own form, as the browser's NumberSet: refused when empty, out of bounds or unchanged
function courtNumber(ctx, title, hint, label, current, min, max, onSet)
{
   ctx.form(function(v)
   {
      var n = ctx.number(v, "n");
      return {title: title, hint: hint, fields: [{key: "n", label: label, kind: "number", max: String(max).length, hint: "now " + current + ", " + min + " to " + max}],
         buttons: [["Set", function(vals) { onSet(ctx.number(vals, "n")); }, n >= min && n <= max && n != current]]};
   });
}

// A Lead GM's rename of an office or a rank: courtRename [court, kind, id, name]; Default (an empty name) is its own button
function courtRename(ctx, c, kind, id, title)
{
   ctx.form(function(v)
   {
      var name = v.name != undefined ? String(v.name) : "";
      return {title: "Rename " + title, fields: [{key: "name", label: "New name", kind: "text", max: 40, hint: title}],
         buttons: [["Save", function(vals) { ctx.act("dbo:courtRename", [c.id, kind, id, String(vals.name)]); }, name != "" && name != title]]};
   });
}

// Appointing or offering a post by name; Appoint outright only where the payload allows it (court.js outright)
function courtAppoint(ctx, c, of, outright)
{
   ctx.form(function(v)
   {
      var name = v.name != undefined ? String(v.name) : "";
      var b = [["Offer the post", function(vals) { ctx.act("dbo:courtOffer", [c.id, String(vals.name), of.rank]); }, name != ""]];
      if (outright)
      {
         b.push(["Appoint", function(vals) { ctx.act("dbo:courtAppoint", [c.id, String(vals.name), of.rank]); }, name != ""]);
      }
      return {title: of.title + " of " + c.name, hint: outright ? "Appoint fills the post at once; an offer waits for their answer." : "They answer the offer in their journal.",
         fields: [{key: "name", label: "Who", kind: "text", max: 40, hint: "Name or #TAG"}], buttons: b};
   });
}

function courtOverview(c, s, ctx, off)
{
   var hh = c.household;
   if (c.mine == true && hh != null && hh != undefined && hh.myRank >= 0 && (hh.ranks[hh.myRank] == undefined || hh.ranks[hh.myRank].role != "leader"))
   {
      flowButtons([["Step down", function()
      {
         ctx.ask("Leave the court of " + c.name + ", your post and the household? Only its ruler can take you back.", "Step down", function() { ctx.act("dbo:courtResign", [c.id]); }, true);
      }, C_RED, off]]);
   }
   if (c.treasury != null && c.treasury != undefined)
   {
      flowText("The treasury holds " + c.treasury + " gold.", 17, C_TEXT);
   }
   if (c.tax != null && c.tax != undefined)
   {
      var tx = flowEntry("Tax: " + c.tax.pct + "% of every rent and, each week, of every property's value", c.tax.canSet == true ? [["Set...", function()
      {
         var t = this._parent.tax;
         courtNumber(ctx, "The tax of " + c.name, "Taken from every rent and, each week, from every property's value.", "Percent", t.pct, 0, t.max, function(n) { ctx.act("dbo:courtTax", [c.id, n]); });
      }, undefined, off]] : []);
      tx.tax = c.tax;
   }
   if (c.keepsBooks == true)
   {
      flowHint("Wages are paid every Sunday from the treasury into each holder's bank account; the ruler is never paid, and nobody sets their own.");
   }
   var ex = listOf(c.exposed);
   if (ex.length)
   {
      flowHeading("Seen as beasts");
   }
   for (var i = 0; i < ex.length; i++)
   {
      var x = ex[i];
      var until = new Date(Number(x.until));
      flowEntry((x.name != "" ? x.name + ": " + x.what : x.what.charAt(0).toUpperCase() + x.what.substr(1)) + ", seen near " + x.place, [],
         (x.wanted == true ? "wanted for " + x.bounty + " gold" : "bounty settled") + (x.hurt == true ? ", hurt people" : "") + ", known until " + until.getUTCFullYear() + "-" + (until.getUTCMonth() < 9 ? "0" : "") + (until.getUTCMonth() + 1) + "-" + (until.getUTCDate() < 10 ? "0" : "") + until.getUTCDate()
         + (x.seen ? "; " + x.seen + " witnesses" : "") + (listOf(x.hunters).length ? "; hunters: " + x.hunters.join(", ") : ""));
   }
   var out = listOf(c.outgoing);
   if (out.length)
   {
      flowHeading("Offers waiting");
   }
   for (var o = 0; o < out.length; o++)
   {
      var e = flowEntry(out[o].name + ": " + out[o].title, [["Withdraw", function() { ctx.act("dbo:courtWithdraw", [this._parent.offerId]); }, undefined, off]], "by " + out[o].from + ", " + courtHours(out[o].expiresAt));
      e.offerId = out[o].id;
   }
}

function courtOffices(c, s, ctx, off)
{
   var offices = listOf(c.offices);
   var appointable = listOf(c.appointable);
   for (var i = 0; i < offices.length; i++)
   {
      var of = offices[i];
      var holders = listOf(of.holders);
      flowText(of.title + (of.named == true && of["default"] != undefined ? " (" + of["default"] + ")" : "") + "   " + (of.seats != null && of.seats != undefined ? holders.length + " / " + of.seats : holders.length ? holders.length : ""), 20, C_TEXT);
      if (of.wage != undefined)
      {
         flowHint(of.wage ? of.wage + " gold a week" : "Unpaid");
      }
      var tools = [];
      if (of.canAppoint == true && !(of.seats != null && of.seats != undefined && holders.length >= of.seats))
      {
         tools.push(["Appoint...", function() { courtAppoint(ctx, c, this.office, s.outright == true); }, undefined, off]);
      }
      if (of.wage != undefined && c.keepsBooks == true)
      {
         tools.push(["Wage...", function()
         {
            var o = this.office;
            courtNumber(ctx, "The wage of " + o.title, "Paid every Sunday from the treasury into the holder's bank account.", "Gold a week", Number(o.wage) || 0, 0, 100000, function(n) { ctx.act("dbo:courtWage", [c.id, o.rank, n]); });
         }, undefined, off]);
      }
      if (c.canName == true)
      {
         tools.push(["Rename...", function() { courtRename(ctx, c, "office", this.office.rank, this.office.title); }, undefined, off]);
         if (of.named == true && of["default"] != undefined)
         {
            tools.push(["Default", function() { ctx.act("dbo:courtRename", [c.id, "office", this.office.rank, ""]); }, undefined, off]);
         }
      }
      if (tools.length)
      {
         var tb = flowButtons(tools);
         for (var tq = 0; tq < tools.length; tq++)
         {
            tb["btn" + tq].office = of;
         }
      }
      if (!holders.length)
      {
         flowHint("    Vacant.");
      }
      for (var h = 0; h < holders.length; h++)
      {
         var hd = holders[h];
         var key = of.rank + ":" + hd.pid;
         var btns = [];
         if (of.canAppoint == true)
         {
            var moves = 0;
            for (var m = 0; m < appointable.length; m++)
            {
               if (appointable[m].rank != of.rank)
               {
                  moves++;
               }
            }
            if (moves)
            {
               btns.push(["Move to...", function() { courtMoving = courtMoving == this._parent.key ? "" : this._parent.key; draw(); }, undefined, off]);
            }
            btns.push(["Dismiss", function()
            {
               var row = this._parent;
               ctx.ask("Dismiss " + row.who + " from the court of " + c.name + "?", "Dismiss", function() { ctx.act("dbo:courtDismiss", [c.id, row.pid]); }, true);
            }, C_RED, off]);
         }
         var e = flowEntry("    " + hd.name + (hd.tag != undefined && hd.tag != "" ? " #" + hd.tag : "") + (hd.online == true ? "" : " (offline)"), btns);
         e.key = key;
         e.pid = hd.pid;
         e.who = hd.name;
         if (courtMoving == key)
         {
            var row = [];
            var ranks = [];
            for (var a = 0; a < appointable.length; a++)
            {
               if (appointable[a].rank != of.rank)
               {
                  row.push([appointable[a].title, function() { courtMoving = ""; ctx.act("dbo:courtMove", [c.id, this.pid, this.rank]); }, undefined, off]);
                  ranks.push(appointable[a].rank);
               }
            }
            row.push(["Cancel", function() { courtMoving = ""; draw(); }]);
            var bar = flowButtons(row);
            for (var b = 0; b < ranks.length; b++)
            {
               bar["btn" + b].rank = ranks[b];
               bar["btn" + b].pid = hd.pid;
            }
         }
      }
   }
}

function courtHousehold(c, s, ctx, off)
{
   var hh = c.household;
   if (hh == null || hh == undefined)
   {
      flowHint("This court keeps no household.");
      return;
   }
   flowHeading(hh.name);
   var members = listOf(hh.members);
   var ranks = listOf(hh.ranks);
   if (!members.length)
   {
      flowHint("Nobody belongs to the household yet.");
   }
   for (var i = 0; i < members.length; i++)
   {
      var m = members[i];
      var btns = [];
      if (hh.canSetRank == true && m.role != "leader")
      {
         btns.push(["Rank...", function() { courtRanking = courtRanking == this._parent.aid ? "" : this._parent.aid; draw(); }, undefined, off]);
      }
      if (hh.canKick == true && (hh.myRank < 0 || hh.myRank < m.rank))
      {
         btns.push(["Remove", function()
         {
            var row = this._parent;
            ctx.ask("Remove " + row.who + " from " + hh.name + "?", "Remove", function() { ctx.act("dbo:courtKick", [c.id, row.actorId]); }, true);
         }, C_RED, off]);
      }
      var e = flowEntry(m.name + " #" + m.tag + (m.online == true ? "" : " (offline)") + "   " + m.title, btns);
      e.aid = String(m.actorId);
      e.actorId = m.actorId;
      e.who = m.name;
      if (courtRanking == String(m.actorId))
      {
         var row = [];
         var ids = [];
         for (var r = 0; r < ranks.length; r++)
         {
            if (ranks[r].role != "leader")
            {
               row.push([ranks[r].title, function() { courtRanking = ""; ctx.act("dbo:courtRank", [c.id, this.actorId, this.rankIndex]); }, undefined, off, r == m.rank]);
               ids.push(r);
            }
         }
         row.push(["Cancel", function() { courtRanking = ""; draw(); }]);
         var bar = flowButtons(row);
         for (var b = 0; b < ids.length; b++)
         {
            bar["btn" + b].rankIndex = ids[b];
            bar["btn" + b].actorId = m.actorId;
         }
      }
   }
   var pend = listOf(hh.pending);
   if (pend.length)
   {
      var names = [];
      for (var p = 0; p < pend.length; p++)
      {
         names.push(pend[p].name);
      }
      flowHint("Invited: " + names.join(", "));
   }
   flowHint("An office sets its holder's rank here; giving up the office returns them to the lowest rank.");
   if (hh.canInvite == true)
   {
      flowButtons([["Invite someone...", function()
      {
         ctx.form(function(v)
         {
            var name = v.name != undefined ? String(v.name) : "";
            return {title: "Invite someone to " + hh.name, fields: [{key: "name", label: "Who", kind: "text", max: 40, hint: "someone online: name or #TAG"}],
               buttons: [["Invite", function(vals) { ctx.act("dbo:courtInvite", [c.id, String(vals.name)]); }, name != ""]]};
         });
      }, undefined, off]]);
   }
   if (c.canName == true)
   {
      flowHeading("Rank names");
      for (var n = 0; n < ranks.length; n++)
      {
         var rb = [["Rename...", function() { courtRename(ctx, c, "rank", this._parent.rankIndex, this._parent.rankTitle); }, undefined, off]];
         if (ranks[n].canon != undefined && ranks[n].canon != "")
         {
            rb.push(["Default", function() { ctx.act("dbo:courtRename", [c.id, "rank", this._parent.rankIndex, ""]); }, undefined, off]);
         }
         var re = flowEntry(ranks[n].title + (ranks[n].canon != undefined && ranks[n].canon != "" ? " (" + ranks[n].canon + ")" : ""), rb);
         re.rankIndex = n;
         re.rankTitle = ranks[n].title;
      }
   }
}

function courtHunting(c, s, ctx, off)
{
   var t = c.contracts;
   flowHeading("Hunting contracts");
   if (t.enabled == false)
   {
      flowHint("Hunting contracts are closed everywhere for now.");
   }
   var tiers = listOf(t.tiers);
   for (var i = 0; i < tiers.length; i++)
   {
      var label = tiers[i].name.charAt(0).toUpperCase() + tiers[i].name.substr(1);
      if (t.canSet == true)
      {
         var pe = flowEntry(label + ": " + tiers[i].price + " gold a kill", [["Set...", function()
         {
            var tr = this._parent.tier;
            courtNumber(ctx, "Pay per kill: " + tr.name, "Contracts already taken keep their pay.", "Gold a kill", tr.price, t.bounds.min, t.bounds.max, function(n) { ctx.act("dbo:courtContractPrice", [c.id, tr.tier, n]); });
         }, undefined, off]], listOf(tiers[i].kinds).join(", "));
         pe.tier = tiers[i];
      }
      else
      {
         flowRow(label, tiers[i].price + " gold a kill", listOf(tiers[i].kinds).join(", "));
      }
   }
   if (t.canSet == true)
   {
      flowEntry("Weekly budget: " + t.budget + " gold", [["Set...", function()
      {
         courtNumber(ctx, "The weekly budget", "What standing contracts may pay out in a week.", "Gold a week", t.budget, 0, t.budgetMax, function(n) { ctx.act("dbo:courtContractBudget", [c.id, n]); });
      }, undefined, off]]);
   }
   else
   {
      flowRow("Weekly budget", t.budget + " gold");
   }
   flowEntry("Standing contracts: " + (t.standing == true ? "On" : "Stopped by its officials"), t.canSet == true ? [[t.standing == true ? "Stop them" : "Post them again", function() { ctx.act("dbo:courtContractStanding", [c.id, t.standing == true ? "off" : "on"]); }, undefined, off]] : []);
   flowHint("This week: " + t.spent + " gold spent, " + t.left + " left. It renews Monday 00:00 UTC, in " + courtUntil(t.resetsAt) + ".");
   flowHint((t.citizensOnly == true ? "Citizens of " + c.name + " only." : "Open to every hunter.") + " Work an official posts by hand is open to all.");
   if (t.postBudget != undefined)
   {
      if (t.canSet == true)
      {
         flowEntry("Posted work a week: " + t.postBudget + " gold", [["Set...", function()
         {
            courtNumber(ctx, "Posted work a week", "What officials may post by hand in a week.", "Gold a week", t.postBudget, 0, t.budgetMax, function(n) { ctx.act("dbo:courtContractPostBudget", [c.id, n]); });
         }, undefined, off]], t.postLeft + " left this week");
      }
      else
      {
         flowRow("Posted work a week", t.postBudget + " gold", t.postLeft + " left this week");
      }
   }
   if (t.canPost == true)
   {
      courtPostWork(c, t, ctx, off);
   }
   else if (t.fauna != undefined)
   {
      flowHint("Officials of " + c.name + " post hunting work and commissions here.");
   }
   var posted = listOf(t.posted);
   if (t.fauna != undefined)
   {
      flowText("Posted by hand", 19, C_TEXT);
      if (!posted.length)
      {
         flowHint("Nothing posted by hand right now.");
      }
   }
   for (var p = 0; p < posted.length; p++)
   {
      var w = posted[p];
      var e = flowEntry((w.type == "commission" ? "Commission: " : "") + w.what, w.canWithdraw == true ? [["Take down", function() { ctx.act("dbo:courtContractWithdraw", [c.id, this._parent.postId]); }, undefined, off]] : [],
         "by " + (w.by != undefined && w.by != "" ? w.by : "an official") + ", " + w.held + " gold held, " + w.hoursLeft + "h left");
      e.postId = w.id;
   }
}

// An official posts a hunt for the hold's own beasts, or commissions goods (searched first), out of the week's posting
// budget: courtContractPost [court, kind, count, reward], courtCommissionSearch [court, query], courtCommissionPost [court,
// goods, count, gold each], with the browser's limits (a reward up to count x the beast's pay, a price up to the goods' most)
function courtPostWork(c, t, ctx, off)
{
   flowText("Post work", 19, C_TEXT);
   flowHint("Paid from the treasury, out of this week's posting budget (" + t.postLeft + " of " + t.postBudget + " gold left)"
      + (t.postsLeftToday != null && t.postsLeftToday != undefined ? "; you may post " + t.postsLeftToday + " more today" : "") + ".");
   var fauna = listOf(t.fauna);
   var row = [];
   if (fauna.length)
   {
      row.push(["Post a hunt...", function()
      {
         var opts = [];
         for (var i = 0; i < fauna.length; i++)
         {
            opts.push([fauna[i].kind, fauna[i].name + " (" + fauna[i].perKill + " a kill)"]);
         }
         ctx.form(function(v)
         {
            var beast = null;
            for (var k = 0; k < fauna.length; k++)
            {
               if (fauna[k].kind == v.kind)
               {
                  beast = fauna[k];
               }
            }
            var count = ctx.number(v, "count");
            var reward = ctx.number(v, "reward");
            var most = beast != null && count > 0 ? count * beast.perKill : 0;
            return {title: "Post a hunt in " + c.name, fields: [{key: "kind", label: "The beast", kind: "choice", options: opts},
               {key: "count", label: "How many", kind: "number", max: 5}, {key: "reward", label: most ? "Reward, up to " + most : "Reward", kind: "number", max: 6}],
               buttons: [["Post hunt", function(vals) { ctx.act("dbo:courtContractPost", [c.id, String(vals.kind), ctx.number(vals, "count"), ctx.number(vals, "reward")]); },
                  beast != null && count > 0 && reward > 0 && !(most > 0 && reward > most)]]};
         }, {kind: fauna[0].kind});
      }, undefined, off]);
   }
   else
   {
      flowHint("No dangerous beasts are known to roam " + c.name + ".");
   }
   row.push(["Commission goods...", function()
   {
      ctx.form(function(v)
      {
         var q = v.q != undefined ? String(v.q) : "";
         return {title: "Commission goods", hint: "Search what a hold buys: pelt, iron ingot, firewood...", fields: [{key: "q", label: "Search", kind: "text", max: 40}],
            buttons: [["Search", function(vals) { ctx.act("dbo:courtCommissionSearch", [c.id, String(vals.q)]); }, q != ""]]};
      });
   }, undefined, off]);
   var found = t.search != undefined && t.search != null ? listOf(t.search.items) : [];
   if (found.length)
   {
      row.push(["Commission " + (found.length == 1 ? "it" : "one of " + found.length) + "...", function()
      {
         var opts = [];
         for (var i = 0; i < found.length; i++)
         {
            opts.push([found[i].desc, found[i].name + " (worth " + found[i].value + ", up to " + found[i].maxPrice + " each)"]);
         }
         ctx.form(function(v)
         {
            var picked = null;
            for (var k = 0; k < found.length; k++)
            {
               if (found[k].desc == v.item)
               {
                  picked = found[k];
               }
            }
            var want = ctx.number(v, "want");
            var price = ctx.number(v, "price");
            return {title: "Commission goods", fields: [{key: "item", label: "The goods", kind: "choice", options: opts},
               {key: "want", label: t.commissionMaxCount != undefined ? "How many, up to " + t.commissionMaxCount : "How many", kind: "number", max: 5},
               {key: "price", label: picked != null ? "Gold each, up to " + picked.maxPrice : "Gold each", kind: "number", max: 6}],
               buttons: [["Commission", function(vals) { ctx.act("dbo:courtCommissionPost", [c.id, String(vals.item), ctx.number(vals, "want"), ctx.number(vals, "price")]); },
                  picked != null && want > 0 && price > 0 && price <= picked.maxPrice && (t.commissionMaxCount == undefined || want <= t.commissionMaxCount)]]};
         });
      }, undefined, off]);
   }
   flowButtons(row);
   if (t.search != undefined && t.search != null && !found.length)
   {
      flowHint("Nothing a hold buys matches \"" + t.search.query + "\".");
   }
}

JT.court = function(s, ctx)
{
   var off = ctx.busy || ctx.readOnly;
   var courts = listOf(s.courts);
   if (courtOf != cacheOf)
   {
      courtOf = cacheOf;
      courtView = "court";
      courtZone = s.selected != undefined && s.selected != "" ? s.selected : courts.length ? courts[0].id : "";
   }
   if (s.selected != undefined && s.selected != "" && s.selected != courtSelected)
   {
      courtZone = s.selected;
   }
   courtSelected = s.selected != undefined ? s.selected : "";
   if (s != courtLast)
   {
      courtLast = s;
      courtMoving = "";
      courtRanking = "";
   }
   var offers = listOf(s.offers);
   for (var o = 0; o < offers.length; o++)
   {
      var of = offers[o];
      var e = flowEntry("Offered: " + of.title + " of " + of.zoneName + ", by " + of.from, [["Accept", function() { ctx.act("dbo:courtAnswer", [this._parent.offerId, "accept"]); }, undefined, off], ["Decline", function() { ctx.act("dbo:courtAnswer", [this._parent.offerId, "decline"]); }, undefined, off]], courtHours(of.expiresAt));
      e.offerId = of.id;
   }
   if (!courts.length)
   {
      if (!offers.length)
      {
         flowHint("You serve no court yet.");
      }
      return;
   }
   var c = null;
   var row = [];
   for (var i = 0; i < courts.length; i++)
   {
      if (courts[i].id == courtZone)
      {
         c = courts[i];
      }
      row.push([courts[i].name + (courts[i].mine == true && s.staff == true ? " (yours)" : ""), function() { courtZone = this.zone; pages[tab] = 0; draw(); }, undefined, false, courts[i].id == courtZone]);
   }
   if (c == null)
   {
      c = courts[0];
      row[0][4] = true;
   }
   if (c != null && c.paged == true && courtAsked != c.id)
   {
      courtAsked = c.id;
      ctx.openTab("court", {court: c.id});
      return;
   }
   if (courts.length > 1)
   {
      var bar = flowButtons(row);
      for (var b = 0; b < courts.length; b++)
      {
         bar["btn" + b].zone = courts[b].id;
      }
   }
   flowHeading((c.kind == "region" ? "Court of " : "") + c.name);
   var views = [["Court", "court"], ["Offices", "offices"], ["Household", "household"]];
   if (c.contracts != undefined && c.contracts != null)
   {
      views.push(["Hunting", "hunting"]);
   }
   var vr = [];
   var shownView = courtView;
   if (shownView == "hunting" && (c.contracts == undefined || c.contracts == null))
   {
      shownView = "court";
   }
   for (var v = 0; v < views.length; v++)
   {
      vr.push([views[v][0], function() { courtView = this.view; pages[tab] = 0; draw(); }, undefined, false, views[v][1] == shownView]);
   }
   var vb = flowButtons(vr);
   for (var w = 0; w < views.length; w++)
   {
      vb["btn" + w].view = views[w][1];
   }
   if (shownView == "offices")
   {
      courtOffices(c, s, ctx, off);
   }
   else if (shownView == "household")
   {
      courtHousehold(c, s, ctx, off);
   }
   else if (shownView == "hunting")
   {
      courtHunting(c, s, ctx, off);
   }
   else
   {
      courtOverview(c, s, ctx, off);
   }
};
