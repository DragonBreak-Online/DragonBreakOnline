// The Faction tab's other views (guilds.js payload: realm, economy, band, rebellion, and the staff view), drawn natively in
// place of the browser journal's: Realm (the land by owner, capitals and the leaders' control of theirs; a list, since the
// browser's painted map needs its terrain art; On the map closes the journal and opens the M map with a line saying where the
// place lies: native:showMap [place, owner, x, y]), War (each war with its answers, peace and surrender, treaties, declaring and
// raiding), Treasury (tax, wages, the last reckoning), Guild, Rebellion and, for staff, every faction with its members and
// ranks. Typed and chosen input is a form in place of the tab (ctx.form). Every action carries the faction menu's own
// nonce, through facSend, as the browser faction panel's act does.
var REALM_KIND = {capital: "City", town: "Town", village: "Village", fort: "Fort"};
var facStaffKind = "";
var facStaffPicked = "";

function facWhen(ms)
{
   return whenText(Number(ms));
}

function facGold(n)
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

// A whole number set with its own form, refused when empty, past its most or unchanged
function facNumber(ctx, title, hint, label, current, max, onSet)
{
   ctx.form(function(v)
   {
      var n = ctx.number(v, "n");
      return {title: title, hint: hint, fields: [{key: "n", label: label, kind: "number", max: String(max).length, hint: "now " + current + ", up to " + max}],
         buttons: [["Set", function(vals) { onSet(ctx.number(vals, "n")); }, n >= 0 && n <= max && n != current]]};
   });
}

// A one-line text form: its title, the field and one button, sent with the typed text (trimmed)
function facText(ctx, title, hint, label, max, buttonLabel, onSend)
{
   ctx.form(function(v)
   {
      var t = v.t != undefined ? String(v.t) : "";
      return {title: title, hint: hint, fields: [{key: "t", label: label, kind: "text", max: max}], buttons: [[buttonLabel, function(vals) { onSend(String(vals.t)); }, t != ""]]};
   });
}

function facLeads(realm)
{
   return realm != undefined && realm != null ? listOf(realm.leads) : [];
}

function facOwners(realm)
{
   var out = [];
   var seen = {};
   var ts = listOf(realm.territories);
   for (var i = 0; i < ts.length; i++)
   {
      if (seen[ts[i].owner] != true)
      {
         seen[ts[i].owner] = true;
         out.push([ts[i].owner, ts[i].ownerName]);
      }
   }
   return out;
}

// ---- Realm ----

function facRealm(s, ctx, off)
{
   var realm = s.realm;
   var ts = realm != undefined && realm != null ? listOf(realm.territories) : [];
   if (!ts.length)
   {
      flowHint("No land has been charted yet.");
      return;
   }
   var owners = facOwners(realm);
   for (var o = 0; o < owners.length; o++)
   {
      flowHeading(owners[o][1]);
      for (var i = 0; i < ts.length; i++)
      {
         if (ts[i].owner == owners[o][0])
         {
            var e = flowEntry(String(ts[i].name), [["On the map", function() { facShowMap(this._parent.place); }]], REALM_KIND[ts[i].kind] != undefined ? REALM_KIND[ts[i].kind] : String(ts[i].kind));
            e.place = ts[i];
         }
      }
   }
   var caps = listOf(realm.capitals);
   if (caps.length)
   {
      flowHeading("Capitals");
      for (var c = 0; c < caps.length; c++)
      {
         flowRow(String(caps[c].factionName), (caps[c].territory != null && caps[c].territory != undefined ? "Territory" : "Seat") + ": " + caps[c].name);
      }
   }
   var leads = facLeads(realm);
   for (var l = 0; l < leads.length; l++)
   {
      facCapital(s, ctx, off, realm, leads[l]);
   }
   var secret = listOf(realm.secret);
   if (secret.length)
   {
      flowHeading("Known only to your circle");
      for (var k = 0; k < secret.length; k++)
      {
         flowRow(String(secret[k].name), secret[k].kind + "  ·  " + listOf(secret[k].layer).join(", "));
      }
   }
   var wars = listOf(realm.wars);
   if (wars.length)
   {
      flowHint(wars.length + " war" + (wars.length > 1 ? "s" : "") + " under way: see War.");
   }
}

// The journal goes and the M map opens; the client says where the place lies from the player (scaleformMenuService showMap)
function facShowMap(t)
{
   dboSound("UIMenuOK");
   send("native:showMap", [String(t.name), String(t.ownerName), Number(t.x), Number(t.y)]);
   closeJournal();
}

// A leader moves the capital: one of the faction's territories, or (not for a hold) where they stand
function facCapital(s, ctx, off, realm, lead)
{
   flowText(lead.name + ": capital " + (lead.seat != undefined && lead.seat != "" ? lead.seat : "not chosen yet"), 18, C_TEXT);
   var waiting = Number(lead.capitalChangeAt) > new Date().getTime();
   if (lead.atWar == true || waiting)
   {
      flowHint(lead.atWar == true ? "Not while at war." : "It can move again " + facWhen(lead.capitalChangeAt) + ".");
   }
   else
   {
      var choices = listOf(lead.capitalChoices);
      var b = [];
      if (choices.length)
      {
         b.push(["Move the capital...", function()
         {
            var ld = this.lead;
            var opts = [];
            var cs = listOf(ld.capitalChoices);
            for (var i = 0; i < cs.length; i++)
            {
               opts.push([cs[i].id, cs[i].name + (cs[i].id == ld.capital ? " (now)" : "")]);
            }
            ctx.form(function(v)
            {
               return {title: "The capital of " + ld.name, fields: [{key: "pick", label: "Make it the capital", kind: "choice", options: opts}],
                  buttons: [["Make it the capital", function(vals) { facSend(s, ctx, "dbo:realmCapital", [ld.id, String(vals.pick)]); }, v.pick != undefined && v.pick != "" && v.pick != ld.capital]]};
            });
         }, undefined, off]);
      }
      if (lead.canSetHere == true)
      {
         b.push(["Make where I stand our seat", function()
         {
            var ld = this.lead;
            ctx.ask("Make where you stand the seat of " + ld.name + "?", "Make it our seat", function() { facSend(s, ctx, "dbo:realmCapital", [ld.id, "here"]); });
         }, undefined, off]);
      }
      if (b.length)
      {
         var row = flowButtons(b);
         for (var q = 0; q < b.length; q++)
         {
            row["btn" + q].lead = lead;
         }
      }
      else
      {
         flowHint("Your hold holds no territory to make its capital.");
      }
   }
   var days = realm.rules != undefined && realm.rules.capitalChangeDays != undefined ? realm.rules.capitalChangeDays : 0;
   flowHint("Members gather here to declare war" + (days ? "; it moves once every " + days + " days" : "") + ". Taking a hold's capital takes the hold.");
}

// ---- War ----

function facWar(s, ctx, off)
{
   var realm = s.realm;
   if (realm == undefined || realm == null)
   {
      flowHint("War is not open yet.");
      return;
   }
   var rules = realm.rules != undefined ? realm.rules : {};
   var open = rules.enabled != false;
   var raidsOpen = realm.raids != undefined && realm.raids != null && realm.raids.rules.enabled != false;
   if (!open)
   {
      flowText("War is closed during the alpha, until the holds and factions are set up. The map, the treasury and peace treaties work meanwhile.", 16, C_RED);
   }
   var wars = listOf(realm.wars);
   for (var i = 0; i < wars.length; i++)
   {
      facWarCard(s, ctx, off, realm, wars[i]);
   }
   if (open && !wars.length)
   {
      flowHint("No wars concern your factions.");
   }
   var raids = raidsOpen || (realm.raids != undefined && realm.raids != null) ? listOf(realm.raids.raids) : [];
   for (var r = 0; r < raids.length; r++)
   {
      flowEntry(raids[r].raiderName + " is raiding " + raids[r].territoryName, [], "until " + facWhen(raids[r].until) + "; " + raids[r].breakIns + " home" + (raids[r].breakIns == 1 ? "" : "s") + " broken into so far");
   }
   facTreaties(s, ctx, off, realm);
   var leads = facLeads(realm);
   var more = [];
   if (open && leads.length)
   {
      more.push(["Declare war...", function() { facDeclare(s, ctx, realm); }, C_RED, off]);
   }
   if (raidsOpen && leads.length)
   {
      more.push(["Raid...", function() { facRaid(s, ctx, realm); }, C_RED, off]);
   }
   if (more.length)
   {
      flowGap(6);
      flowButtons(more);
   }
}

function facWarCard(s, ctx, off, realm, w)
{
   var mine = facLeads(realm);
   var leadAtt = false;
   var leadDef = false;
   for (var i = 0; i < mine.length; i++)
   {
      leadAtt = leadAtt || mine[i].id == w.attacker;
      leadDef = leadDef || mine[i].id == w.defender;
   }
   flowHeading(w.attackerName + " against " + w.defenderName + "  (" + (w.status == "notice" ? "declared" : w.status == "active" ? "at war" : "over") + ")");
   var goals = [];
   var gl = listOf(w.goal);
   for (var g = 0; g < gl.length; g++)
   {
      goals.push(gl[g].name + " (held by " + gl[g].owner + ")");
   }
   flowText("For " + goals.join(", "), 16, C_TEXT);
   var wins = [];
   var wl = listOf(w.windows);
   for (var k = 0; k < wl.length; k++)
   {
      wins.push(facWhen(wl[k].start));
   }
   flowHint("Battles: " + wins.join("  ·  ") + " (" + w.captures + " taken so far)");
   if (w.death != null && w.death != undefined)
   {
      flowText(w.death == "accepted" ? "Fought to the death: a killing blow on contested land during a battle ends a life for good." : w.death == "proposed" ? "A war to the death is proposed; the defender has not answered." : "The defender refused a war to the death.", 16, w.death == "refused" ? C_SECOND : C_RED);
   }
   if (leadDef && w.death == "proposed" && new Date().getTime() < w.startsAt)
   {
      var d = flowButtons([["Accept: to the death", function() { var wid = this.war; ctx.ask("Fight it to the death? The fallen may die for good.", "Accept", function() { facSend(s, ctx, "dbo:warDeath", [wid, true]); }, true); }, C_RED, off],
         ["Refuse", function() { facSend(s, ctx, "dbo:warDeath", [this.war, false]); }, undefined, off]]);
      d.btn0.war = w.id;
      d.btn1.war = w.id;
   }
   var p = w.peace;
   if (p != null && p != undefined && ((leadAtt && p.by == w.defender) || (leadDef && p.by == w.attacker)))
   {
      var pe = flowEntry("Peace is offered" + (p.tribute ? ": " + facGold(p.tribute) + " gold paid by " + (p.from == w.attacker ? w.attackerName : w.defenderName) : "") + ".",
         [["Accept peace", function() { var r = this._parent; facSend(s, ctx, "dbo:warPeaceAnswer", [r.war, true, r.peaceId, r.tribute]); }, undefined, off],
          ["Refuse", function() { facSend(s, ctx, "dbo:warPeaceAnswer", [this._parent.war, false]); }, undefined, off]]);
      pe.war = w.id;
      pe.peaceId = p.id != undefined ? p.id : 0;
      pe.tribute = p.tribute != undefined ? p.tribute : 0;
   }
   if ((leadAtt || leadDef) && w.status != "ended")
   {
      var a = flowButtons([["Offer peace...", function()
      {
         var wid = this.war;
         ctx.form(function(v)
         {
            var n = ctx.number(v, "tribute");
            return {title: "Offer peace", hint: "A tribute is gold paid from one treasury to the other when peace is sworn; none is fine.",
               fields: [{key: "tribute", label: "Tribute (gold)", kind: "number", max: 7}, {key: "payer", label: "Who pays", kind: "choice", options: [["me", "we pay"], ["them", "they pay"]]}],
               buttons: [["Offer peace", function(vals) { facSend(s, ctx, "dbo:warPeace", [wid, Math.max(0, ctx.number(vals, "tribute")), String(vals.payer)]); }, true]]};
         }, {payer: "me"});
      }, undefined, off], [leadDef ? "Surrender" : "Withdraw", function()
      {
         var wid = this.war;
         var label = this.label.text;
         ctx.ask(label + " from this war? The other side wins it.", label, function() { facSend(s, ctx, "dbo:warSurrender", [wid]); }, true);
      }, C_RED, off]]);
      a.btn0.war = w.id;
      a.btn1.war = w.id;
   }
}

// Peace treaties: two leaders not at war swear peace for some weeks
function facTreaties(s, ctx, off, realm)
{
   var leads = facLeads(realm);
   var treaties = listOf(realm.treaties);
   var offers = listOf(realm.offers);
   if (!leads.length && !treaties.length)
   {
      return;
   }
   flowHeading("Peace treaties");
   for (var i = 0; i < treaties.length; i++)
   {
      flowText(treaties[i].aName + " and " + treaties[i].bName + " are sworn to peace until " + facWhen(treaties[i].until) + ".", 16, C_TEXT);
   }
   for (var o = 0; o < offers.length; o++)
   {
      var of = offers[o];
      var text = of.fromName + " offers " + of.toName + " peace for " + of.weeks + " week" + (of.weeks > 1 ? "s" : "") + (of.mine == true ? "." : ": waiting for their answer.");
      var e = flowEntry(text, of.mine == true ? [["Swear peace", function() { facSend(s, ctx, "dbo:treatyAnswer", [this._parent.offerId, true]); }, undefined, off],
         ["Refuse", function() { facSend(s, ctx, "dbo:treatyAnswer", [this._parent.offerId, false]); }, undefined, off]] : []);
      e.offerId = of.id;
   }
   if (leads.length)
   {
      flowButtons([["Offer a treaty...", function()
      {
         var rules = realm.rules != undefined ? realm.rules : {};
         var min = rules.treatyMinWeeks != undefined ? rules.treatyMinWeeks : 1;
         var max = rules.treatyMaxWeeks != undefined ? rules.treatyMaxWeeks : 8;
         var lo = [];
         for (var i = 0; i < leads.length; i++)
         {
            lo.push([leads[i].id, leads[i].name]);
         }
         var wk = [];
         for (var n = min; n <= max; n++)
         {
            wk.push([n, n + " week" + (n > 1 ? "s" : "")]);
         }
         ctx.form(function(v)
         {
            var fo = [];
            var fs = listOf(realm.factions);
            for (var k = 0; k < fs.length; k++)
            {
               if (fs[k].id != v.from)
               {
                  fo.push([fs[k].id, fs[k].name]);
               }
            }
            var ok = false;
            for (var q = 0; q < fo.length; q++)
            {
               ok = ok || fo[q][0] == v.to;
            }
            return {title: "Offer a treaty", hint: "While a treaty holds, neither side may declare war on the other. At war, offer peace in the war itself.",
               fields: [{key: "from", label: "As", kind: "choice", options: lo}, {key: "to", label: "Offer", kind: "choice", options: fo, empty: "No other faction to offer it to."},
                  {key: "weeks", label: "Peace for", kind: "choice", options: wk}],
               buttons: [["Offer a treaty", function(vals) { facSend(s, ctx, "dbo:treatyOffer", [String(vals.from), String(vals.to), Number(vals.weeks)]); }, ok]]};
         }, {from: leads[0].id, weeks: Math.min(4, max)});
      }, undefined, off]]);
   }
   flowHint("While a treaty holds, neither side may declare war on the other.");
}

function facDeclare(s, ctx, realm)
{
   var leads = facLeads(realm);
   var rules = realm.rules != undefined ? realm.rules : {};
   var choices = listOf(realm.windowChoices);
   var lo = [];
   for (var i = 0; i < leads.length; i++)
   {
      lo.push([leads[i].id, leads[i].name]);
   }
   var wo = [];
   for (var c = 0; c < choices.length; c++)
   {
      wo.push([choices[c], facWhen(choices[c])]);
   }
   var per = Number(rules.windowsPerWar) || 0;
   ctx.form(function(v)
   {
      var owners = facOwners(realm);
      var dop = [];
      for (var o = 0; o < owners.length; o++)
      {
         if (owners[o][0] != "" && owners[o][0] != v.attacker)
         {
            dop.push(owners[o]);
         }
      }
      var known = false;
      for (var q = 0; q < dop.length; q++)
      {
         known = known || dop[q][0] == v.defender;
      }
      if (!known)
      {
         v.defender = dop.length ? dop[0][0] : "";
         v.goal = [];
      }
      var theirs = [];
      var ts = listOf(realm.territories);
      for (var k = 0; k < ts.length; k++)
      {
         if (ts[k].owner == v.defender)
         {
            theirs.push([ts[k].id, ts[k].name]);
         }
      }
      var me = null;
      for (var m = 0; m < leads.length; m++)
      {
         if (leads[m].id == v.attacker)
         {
            me = leads[m];
         }
      }
      var fields = [{key: "attacker", label: "As", kind: "choice", options: lo}, {key: "defender", label: "Against", kind: "choice", options: dop, empty: "Nobody else holds land."},
         {key: "goal", label: "The land you mean to take", kind: "multi", options: theirs, empty: "They hold no land."},
         {key: "picks", label: "Battle windows (" + per + " of " + rules.windowHours + " hours, after " + rules.noticeDays + " days' notice)", kind: "multi", options: wo, max: per}];
      if (rules.deathWar == true)
      {
         fields.push({key: "death", label: "To the death (only if their leader accepts)", kind: "choice", options: [["no", "No"], ["yes", "Propose it"]]});
      }
      fields.push({kind: "note", text: "Needs " + rules.minOnline + " of each side online (you have " + (me != null ? me.online : 0) + ") and " + facGold(rules.declareFee) + " gold from your treasury (it holds " + facGold(me != null ? me.treasury : 0) + ")."});
      fields.push({kind: "note", text: me != null && me.seat != undefined && me.seat != "" ? "Every member online must muster at " + me.seat + " to declare: " + (me.atSeat != undefined ? me.atSeat : 0) + " of " + me.online + " are there." : "Your faction has no seat to muster at yet; staff set one."});
      return {title: "Declare war", fields: fields,
         buttons: [["Declare war", function(vals) { facSend(s, ctx, "dbo:warDeclare", [String(vals.attacker), String(vals.defender), listOf(vals.goal), listOf(vals.picks), vals.death == "yes"]); },
            listOf(v.goal).length > 0 && listOf(v.picks).length == per, true]]};
   }, {attacker: leads.length ? leads[0].id : "", picks: choices.slice(0, per), death: "no"});
}

function facRaid(s, ctx, realm)
{
   var leads = facLeads(realm);
   var R = realm.raids;
   var lo = [];
   for (var i = 0; i < leads.length; i++)
   {
      lo.push([leads[i].id, leads[i].name]);
   }
   ctx.form(function(v)
   {
      var to = [];
      var ts = listOf(realm.territories);
      for (var k = 0; k < ts.length; k++)
      {
         if (ts[k].owner != v.raider)
         {
            to.push([ts[k].id, ts[k].name + " (" + ts[k].ownerName + ")"]);
         }
      }
      var ok = false;
      for (var q = 0; q < to.length; q++)
      {
         ok = ok || to[q][0] == v.target;
      }
      if (!ok)
      {
         v.target = to.length ? to[0][0] : "";
      }
      var last = v.target != "" && R.lastRaided != undefined && R.lastRaided[v.target] != undefined ? Number(R.lastRaided[v.target]) : 0;
      var rested = new Date().getTime() - last >= R.rules.cooldownDays * 86400000;
      return {title: "Raid", hint: "No land changes hands. For " + R.rules.raidMinutes + " minutes your people can break into homes there: each gives up 3 things and 15% of its gold. The defenders need "
            + R.rules.minDefendersOnline + " online, and land rests " + R.rules.cooldownDays + " days between raids.",
         fields: [{key: "raider", label: "As", kind: "choice", options: lo}, {key: "target", label: "Raid", kind: "choice", options: to, empty: "No land to raid."}].concat(rested || v.target == "" ? [] : [{kind: "note", text: "That land is resting."}]),
         buttons: [["Send the raid", function(vals) { facSend(s, ctx, "dbo:raidStart", [String(vals.raider), String(vals.target)]); }, v.target != "" && rested, true]]};
   }, {raider: leads.length ? leads[0].id : ""});
}

// ---- Treasury ----

function facTreasury(s, ctx, off)
{
   var ec = s.economy;
   var fs = ec != undefined && ec != null ? listOf(ec.factions) : [];
   if (!fs.length)
   {
      flowHint("Only a faction's leader, or a hold's ruler, keeps its treasury.");
      return;
   }
   for (var i = 0; i < fs.length; i++)
   {
      var f = fs[i];
      flowHeading(f.name);
      flowHint("Next reckoning " + facWhen(ec.nextReckoning) + ".");
      var rate = Math.round(Number(f.rate) * 100);
      var e = flowEntry("Property tax: " + rate + "%", [["Set...", function()
      {
         var row = this._parent;
         facNumber(ctx, "Property tax: " + row.fname, "Paid every week by every home on your land from its owner's bank account; for a hold, also its tax on every rent.", "Percent", row.rate, Math.round(Number(ec.maxTaxRate) * 100),
            function(n) { facSend(s, ctx, "dbo:econRate", [row.fid, n]); });
      }, undefined, off]], "paid every week by every home on your land");
      e.fid = f.id;
      e.fname = f.name;
      e.rate = rate;
      flowText("Weekly wages by rank, paid from the treasury into each member's bank account:", 16, C_SECOND);
      var ranks = listOf(f.ranks);
      for (var r = 0; r < ranks.length; r++)
      {
         var label = f.labels != undefined && f.labels[ranks[r]] != undefined ? f.labels[ranks[r]] : ranks[r];
         var wage = Number(f.wages[ranks[r]]) || 0;
         var we = flowEntry(label + ": " + facGold(wage) + " gold", [["Set...", function()
         {
            var row = this._parent;
            facNumber(ctx, "The wage of " + row.label, "Paid every week from the treasury.", "Gold a week", row.wage, 100000, function(n) { facSend(s, ctx, "dbo:econWage", [row.fid, row.rank, n]); });
         }, undefined, off]]);
         we.fid = f.id;
         we.rank = ranks[r];
         we.label = label;
         we.wage = wage;
      }
      var rp = f.report;
      if (rp != null && rp != undefined)
      {
         flowHint("Last reckoning (" + facWhen(rp.at) + "): " + facGold(rp.income) + " gold in taxes from " + rp.taxed + " homes"
            + (rp.tithesIn ? ", " + facGold(rp.tithesIn) + " in Imperial tithes" : "")
            + (rp.tithe || rp.titheOwed ? ", " + facGold(rp.tithe != undefined ? rp.tithe : 0) + " Imperial tithe to " + (rp.titheTo != undefined && rp.titheTo != "" ? rp.titheTo : "the Empire") + (rp.titheOwed ? " (" + facGold(rp.titheOwed) + " still owed)" : "") : "")
            + (rp.stipend ? ", a stipend of " + facGold(rp.stipend) + " from " + (rp.stipendFrom != undefined && rp.stipendFrom != "" ? rp.stipendFrom : "the Aldmeri Dominion") : "")
            + ", " + facGold(rp.wagesPaid) + " in wages" + (rp.owed ? ", " + facGold(rp.owed) + " owed" : "") + ". Treasury: " + facGold(rp.balance) + " gold.");
         var od = listOf(rp.overdue);
         if (od.length)
         {
            var parts = [];
            for (var q = 0; q < od.length; q++)
            {
               parts.push(od[q].owner + " in " + od[q].where + ", " + od[q].weeks + " week" + (od[q].weeks > 1 ? "s" : "") + " (" + facGold(od[q].gold) + " gold)");
            }
            flowText("Overdue: " + parts.join("; "), 15, C_RED);
         }
      }
      else
      {
         flowHint("No reckoning yet.");
      }
   }
}

// ---- Guild ----

function facGuild(s, ctx, off)
{
   var band = s.band;
   if (band == undefined || band == null)
   {
      flowHint("Player guilds are not open.");
      return;
   }
   var g = band.mine;
   flowHeading("Player guilds");
   var rules = listOf(band.rules);
   for (var r = 0; r < rules.length; r++)
   {
      flowHint(String(rules[r]));
   }
   if (band.enabled != true)
   {
      flowText("Guilds are closed right now.", 16, C_RED);
   }
   var inv = listOf(band.invites);
   for (var i = 0; i < inv.length; i++)
   {
      var e = flowEntry(inv[i].from + " invites you into the guild " + inv[i].name, [["Join", function() { facSend(s, ctx, "dbo:guildTabAccept", [this._parent.gid]); }, undefined, off || band.enabled != true || (g != null && g != undefined)],
         ["Decline", function() { facSend(s, ctx, "dbo:guildTabDecline", [this._parent.gid]); }, undefined, off]]);
      e.gid = inv[i].id;
   }
   if (g != null && g != undefined)
   {
      flowHeading(g.name + "  (" + g.members + " of " + band.maxMembers + " members)");
      flowText("You are its " + g.title + "." + (g.master == true ? "" : g.guildmaster != undefined && g.guildmaster != "" ? " Its Guildmaster is " + g.guildmaster + "." : ""), 16, C_TEXT);
      var b = [];
      if (g.officer == true && band.enabled == true)
      {
         b.push(["Invite...", function() { facText(ctx, "Invite into " + g.name, "", "Who", 60, "Invite", function(v) { facSend(s, ctx, "dbo:guildTabInvite", [v]); }); }, undefined, off || g.members >= band.maxMembers]);
      }
      if (g.master == true && band.enabled == true)
      {
         b.push(["Rename...", function() { facText(ctx, "Rename " + g.name, "", "New name", 60, "Rename", function(v) { facSend(s, ctx, "dbo:guildTabRename", [v]); }); }, undefined, off]);
      }
      if (!(g.master == true && g.members > 1))
      {
         b.push(["Leave the guild", function() { ctx.ask(g.master == true ? "You are its last member: leaving closes " + g.name + "." : "Leave " + g.name + "?", "Leave", function() { facSend(s, ctx, "dbo:guildTabLeave", []); }); }, undefined, off]);
      }
      if (g.master == true)
      {
         b.push(["Disband", function() { ctx.ask("Close " + g.name + " for every member?", "Disband", function() { facSend(s, ctx, "dbo:guildTabDisband", []); }, true); }, C_RED, off]);
      }
      flowButtons(b);
      if (g.officer == true && g.members >= band.maxMembers)
      {
         flowHint("The guild is full.");
      }
      if (g.master == true && g.members > 1)
      {
         flowHint("To leave, make another member Guildmaster first, or disband the guild.");
      }
      flowHint("The roster, ranks and removals are on the members' view.");
      return;
   }
   flowHeading("Found a guild");
   if (band.blocked != undefined && band.blocked != "")
   {
      flowText(String(band.blocked), 16, C_RED);
   }
   else if (band.enabled == true)
   {
      flowHint("No approval is needed: you become its Guildmaster at once. The name is checked as a faction's would be.");
      flowButtons([["Found a guild...", function() { facText(ctx, "Found a guild", "", "The guild's name", 60, "Found", function(v) { facSend(s, ctx, "dbo:guildTabCreate", [v]); }); }, undefined, off]]);
   }
}

// ---- Rebellion ----

function facRising(s, ctx, off, r)
{
   flowHeading(r.name + "  (" + (r.status == "notice" ? "notice given" : r.status == "active" ? "under way" : r.status) + ")");
   flowText("Against the ruler of " + r.holdName + ", for " + r.capital + ". Led by " + r.leaderName + (r.claimantName != undefined && r.claimantName != "" && r.claimantName != r.leaderName ? "; " + r.claimantName + " would take the throne" : "") + ".", 16, C_TEXT);
   var rebels = listOf(r.rebels);
   flowHint(rebels.length + " rebel" + (rebels.length == 1 ? "" : "s") + ": " + rebels.join(", "));
   if (r.rebel == true)
   {
      flowText("You rose with it." + (r.leads == true ? " You lead it." : ""), 16, C_TEXT);
   }
   if (r.rules == true)
   {
      flowText("This rising stands against you.", 16, C_RED);
   }
   var w = r.war;
   if (w != null && w != undefined)
   {
      var now = new Date().getTime();
      flowHint("Declared " + facWhen(r.declaredAt) + "; notice until " + facWhen(w.startsAt) + ".");
      var ws = listOf(w.windows);
      for (var i = 0; i < ws.length; i++)
      {
         flowHint("Battle " + (i + 1) + ": " + facWhen(ws[i].start) + (now >= ws[i].end ? " (fought)" : now >= ws[i].start ? " (now)" : ""));
      }
      var cs = listOf(w.captures);
      for (var c = 0; c < cs.length; c++)
      {
         flowHint(cs[c].territory + " taken by the " + (cs[c].byRebels == true ? "rebels" : "loyalists") + ", " + facWhen(cs[c].at));
      }
      if (w.death != null && w.death != undefined)
      {
         flowText(w.death == "proposed" ? "The rebels ask for a war to the death; the ruler has not answered." : w.death == "accepted" ? "A war to the death: accepted by the ruler." : "The ruler refused a war to the death: no permadeath in it.", 16, w.death == "refused" ? C_SECOND : C_RED);
      }
   }
   var b = [];
   if (r.canJoin == true)
   {
      b.push(["Join the rising", function() { var z = this.zone; ctx.ask("Rise with " + r.name + "? If it fails you become an outlaw of " + r.holdName + ".", "Rise", function() { facSend(s, ctx, "dbo:rebellionTabJoin", [z]); }, true); }, C_RED, off]);
   }
   if (r.canAnswerDeath == true)
   {
      b.push(["Accept a war to the death", function() { ctx.ask("Fight it to the death? The fallen may die for good.", "Accept", function() { facSend(s, ctx, "dbo:rebellionTabDeath", ["accept"]); }, true); }, C_RED, off]);
      b.push(["Refuse", function() { facSend(s, ctx, "dbo:rebellionTabDeath", ["refuse"]); }, undefined, off]);
   }
   if (b.length)
   {
      var row = flowButtons(b);
      if (r.canJoin == true)
      {
         row.btn0.zone = r.zone;
      }
   }
}

function facPetition(s, ctx, off, p, rules, staffView)
{
   var carries = !staffView && (p.starter == true || p.leader == true);
   flowHeading("Secret petition against the ruler of " + p.holdName);
   flowHint("Lapses " + facWhen(p.expiresAt) + ".");
   if (!staffView)
   {
      flowText(p.starter == true && p.leader == true ? "You began it and lead it." : p.leader == true ? "You lead it." : p.starter == true ? "You began it; " + p.leaderName + " leads it." : "Your name is on it.", 16, C_TEXT);
   }
   flowText("Its word: " + p.code + (carries ? " (hand it only to those you trust)" : ""), 16, C_TEXT);
   flowText(p.count + " of " + p.needed + " names" + (p.met == true ? ": enough to rise." : ".") + " It needs " + p.needMin + " accounts " + (p.mode == "any" ? "or" : "and") + " a share of the hold's " + p.citizens + " citizen accounts (" + p.needShare + ").", 16, p.met == true ? C_TEXT : C_SECOND);
   var claimant = p.claimant != null && p.claimant != undefined ? p.claimant.actor : 0;
   if (carries || staffView)
   {
      flowText("The rising: " + p.name + (p.named == true ? "" : " (its default name)") + ". To take the throne: " + (p.claimant != null && p.claimant != undefined ? p.claimant.name : p.leaderName) + "."
         + (staffView ? " Begun by " + p.starterName + ", led by " + p.leaderName + "." : ""), 16, C_TEXT);
      var sg = listOf(p.signers);
      flowText("Signed (" + sg.length + ")", 16, C_SECOND);
      for (var i = 0; i < sg.length; i++)
      {
         var b = [];
         if (!staffView && p.starter == true && sg[i].leader != true)
         {
            b.push(["Make leader", function() { facSend(s, ctx, "dbo:rebellionTabLeader", [this._parent.actor]); }, undefined, off]);
         }
         if (!staffView && p.leader == true && sg[i].actor != claimant)
         {
            b.push(["To the throne", function() { facSend(s, ctx, "dbo:rebellionTabClaimant", [this._parent.actor]); }, undefined, off]);
         }
         var marks = [];
         if (sg[i].starter == true)
         {
            marks.push("began it");
         }
         if (sg[i].leader == true)
         {
            marks.push("leads it");
         }
         if (sg[i].actor == claimant)
         {
            marks.push("to take the throne");
         }
         var e = flowEntry(String(sg[i].name), b, marks.join(", "));
         e.actor = sg[i].actor;
      }
   }
   if (staffView)
   {
      return;
   }
   var acts = [];
   if (p.leader == true)
   {
      acts.push(["Name the rising...", function() { facText(ctx, "Name the rising", "", "Its name", 60, "Name it", function(v) { facSend(s, ctx, "dbo:rebellionTabName", [v]); }); }, undefined, off]);
      if (p.met == true)
      {
         acts.push(["Declare the rising", function() { ctx.ask("Declare " + p.name + " in public? Every signer becomes a rebel.", "Declare", function() { facSend(s, ctx, "dbo:rebellionTabDeclare", [""]); }, true); }, C_RED, off]);
         if (rules.deathWar == true)
         {
            acts.push(["Declare, to the death", function() { ctx.ask("Ask for a war to the death? If the ruler accepts, the fallen may die for good.", "Declare to the death", function() { facSend(s, ctx, "dbo:rebellionTabDeclare", ["death"]); }, true); }, C_RED, off]);
         }
      }
   }
   if (carries)
   {
      acts.push(["Tear it up", function() { ctx.ask("Tear up the petition? Every name on it is lost.", "Tear it up", function() { facSend(s, ctx, "dbo:rebellionTabAbandon", []); }, true); }, C_RED, off]);
   }
   else
   {
      acts.push(["Take my name back", function() { ctx.ask("Take your name off the petition?", "Take it back", function() { facSend(s, ctx, "dbo:rebellionTabUnsign", []); }); }, undefined, off]);
   }
   flowButtons(acts);
   if (p.leader == true && p.met != true)
   {
      flowHint("It can be declared once it has enough names.");
   }
}

function facRebellion(s, ctx, off)
{
   var reb = s.rebellion;
   if (reb == undefined || reb == null)
   {
      flowHint("Risings are not open.");
      return;
   }
   var R = reb.rules;
   var rs = listOf(reb.risings);
   for (var i = 0; i < rs.length; i++)
   {
      facRising(s, ctx, off, rs[i]);
   }
   if (reb.petition != null && reb.petition != undefined)
   {
      facPetition(s, ctx, off, reb.petition, R, false);
   }
   else
   {
      flowHeading("Rise against a ruler");
      if (Number(reb.cooldownUntil) > new Date().getTime())
      {
         flowText("You rose not long ago. You may rise again from " + facWhen(reb.cooldownUntil) + ".", 16, C_RED);
      }
      flowHint("A citizen of a hold, outside its court, begins a secret petition; others sign it with its word. Only you and staff see who signed.");
      var holds = listOf(reb.holds);
      var shut = false;
      if (holds.length)
      {
         var hb = [];
         for (var h = 0; h < holds.length; h++)
         {
            hb.push(["Begin a petition in " + holds[h].name, function() { var hid = this.hold; var hn = this.holdName; ctx.ask("Begin a secret petition against the ruler of " + hn + "?", "Begin it", function() { facSend(s, ctx, "dbo:rebellionTabPetition", [hid]); }); }, undefined, off || holds[h].open != true]);
            shut = shut || holds[h].open != true;
         }
         var row = flowButtons(hb);
         for (var q = 0; q < holds.length; q++)
         {
            row["btn" + q].hold = holds[q].id;
            row["btn" + q].holdName = holds[q].name;
         }
      }
      else
      {
         flowHint("You are a citizen of no hold that could rise.");
      }
      if (shut)
      {
         flowHint("A greyed hold has a petition or a rising already, rose lately, or you serve its court.");
      }
      flowButtons([["Sign a petition...", function() { facText(ctx, "Sign a petition", "Those who began it give its word to those they trust.", "The petition's word", 12, "Sign", function(v) { facSend(s, ctx, "dbo:rebellionTabSign", [v]); }); }, undefined, off]]);
   }
   var sp = listOf(reb.staffPetitions);
   if (sp.length)
   {
      flowHeading("Every petition (staff)");
      for (var k = 0; k < sp.length; k++)
      {
         facPetition(s, ctx, off, sp[k], R, true);
      }
   }
   flowHint("A petition lapses after " + R.petitionDays + " days. A declared rising gives " + R.noticeDays + " days of notice, then " + R.windowsPerWar + " battle windows of " + R.windowHours + " hours for the hold's capital."
      + (R.joinAfterDeclare == true ? " Citizens may join it until it ends." : "") + " Taking the capital deposes the court and seats the rebels' claimant; failing makes every rebel an outlaw of the hold for "
      + R.outlawDays + " days, wanted for " + R.outlawBounty + " gold.");
}

// ---- Invite and the rank editor ----

function facInvite(s, ctx, f)
{
   facText(ctx, "Invite someone to " + f.name, "They answer the invitation in their journal.", "Who", 40, "Invite", function(v) { facSend(s, ctx, "dbo:factionInvite", [f.id, v]); });
}

// The rank editor (the browser's RankEditor): a draft of every rank's title and role, moved, removed and added in place,
// saved as one factionRanksEdit [faction, [{title, role, from}]]. A leader renames titles only; a Lead GM (canEditRanks)
// also sets roles, moves, removes (a rank somebody holds cannot go) and adds ranks
function facRanks(s, ctx, f)
{
   var full = f.canEditRanks == true;
   var ranks = listOf(f.ranks);
   var roles = [];
   var rl = listOf(s.roles);
   for (var r = 0; r < rl.length; r++)
   {
      if (rl[r] != "leader")
      {
         roles.push([rl[r], String(rl[r]).charAt(0).toUpperCase() + String(rl[r]).substr(1)]);
      }
   }
   var titleMax = s.rankTitleMax != undefined ? s.rankTitleMax : 40;
   var ranksMax = s.ranksMax != undefined ? s.ranksMax : 12;
   var held = function(from)
   {
      var n = 0;
      var ms = listOf(f.members);
      for (var i = 0; i < ms.length; i++)
      {
         if (from >= 0 && ms[i].rank == from)
         {
            n++;
         }
      }
      return n;
   };
   var init = {order: [], made: 0, newRole: roles.length ? roles[roles.length - 1][0] : "member"};
   for (var i = 0; i < ranks.length; i++)
   {
      init.order.push("o" + i);
      init["t:o" + i] = ranks[i].title;
      init["r:o" + i] = ranks[i].role;
      init["f:o" + i] = i;
   }
   var fresh = function(v)
   {
      var out = [];
      for (var k = 0; k < v.order.length; k++)
      {
         var id = v.order[k];
         out.push(String(v["t:" + id]) + "|" + v["r:" + id] + "|" + v["f:" + id]);
      }
      return out.join("/");
   };
   var saved = fresh(init);
   ctx.form(function(v)
   {
      var fields = [];
      var seen = {};
      var valid = true;
      for (var k = 0; k < v.order.length; k++)
      {
         var id = v.order[k];
         var from = Number(v["f:" + id]);
         var title = v["t:" + id] != undefined ? String(v["t:" + id]) : "";
         var h = held(from);
         fields.push({key: "t:" + id, label: "Rank " + (k + 1) + "  (" + v["r:" + id] + (h ? ", " + h + " hold it" : "") + ")", kind: "text", max: titleMax});
         if (title == "" || seen[title.toLowerCase()] == true)
         {
            valid = false;
         }
         seen[title.toLowerCase()] = true;
         var items = [];
         if (full && k > 0)
         {
            fields.push({key: "r:" + id, label: "Its role", kind: "choice", options: roles});
            items.push(["Up", facSwap(k, -1), k <= 1]);
            items.push(["Down", facSwap(k, 1), k >= v.order.length - 1]);
            items.push(["Remove", facDrop(k), h > 0, true]);
         }
         var canon = from >= 0 && ranks[from] != undefined ? ranks[from].canon : undefined;
         if (full && canon != undefined && canon != "")
         {
            items.push(["Default", facSet("t:" + id, canon), title == canon]);
         }
         if (items.length)
         {
            fields.push({kind: "buttons", items: items});
         }
      }
      if (full && v.order.length < ranksMax)
      {
         fields.push({key: "newTitle", label: "A new rank's title", kind: "text", max: titleMax});
         fields.push({key: "newRole", label: "Its role", kind: "choice", options: roles});
         fields.push({kind: "buttons", items: [["Add", function(vals)
         {
            var id = "n" + vals.made;
            vals.made++;
            vals.order.push(id);
            vals["t:" + id] = vals.newTitle;
            vals["r:" + id] = vals.newRole;
            vals["f:" + id] = -1;
            vals.newTitle = "";
         }, v.newTitle == undefined || v.newTitle == ""]]});
      }
      fields.push({kind: "note", text: full ? "Members keep their rank through a move. A rank somebody holds cannot be removed. A new title is a staff name: it shows for everyone at once and the rank keeps its own."
         : "As leader you may rename the ranks; a Lead GM adds, moves or removes them."});
      return {title: "Ranks of " + f.name, fields: fields, buttons: [["Save ranks", function(vals)
      {
         var rows = [];
         for (var q = 0; q < vals.order.length; q++)
         {
            var rid = vals.order[q];
            rows.push({title: String(vals["t:" + rid]), role: String(vals["r:" + rid]), from: Number(vals["f:" + rid])});
         }
         facSend(s, ctx, "dbo:factionRanksEdit", [f.id, rows]);
      }, valid && fresh(v) != saved]]};
   }, init);
}

// The rank editor's draft edits, each bound to its row
function facSwap(at, d)
{
   return function(vals)
   {
      var o = vals.order;
      var t = o[at];
      o[at] = o[at + d];
      o[at + d] = t;
   };
}

function facDrop(at)
{
   return function(vals)
   {
      vals.order.splice(at, 1);
   };
}

function facSet(key, value)
{
   return function(vals)
   {
      vals[key] = value;
   };
}

// ---- the staff view: every faction, its members and ranks ----

var FAC_KINDS = [["", "All"], ["guild", "Guilds"], ["cult", "Cults"], ["pack", "Packs"], ["hold", "Holds"], ["stronghold", "Strongholds"], ["charter", "Charters"]];

function facKindOf(f)
{
   return f.player == true ? "charter" : String(f.kind);
}

function facStaff(s, ctx, off)
{
   var all = listOf(s.factions);
   var chips = [];
   for (var k = 0; k < FAC_KINDS.length; k++)
   {
      chips.push([FAC_KINDS[k][1], function() { facStaffKind = this.kind; pages[tab] = 0; draw(); }, undefined, false, FAC_KINDS[k][0] == facStaffKind]);
   }
   var kr = flowButtons(chips);
   for (var q = 0; q < FAC_KINDS.length; q++)
   {
      kr["btn" + q].kind = FAC_KINDS[q][0];
   }
   var list = [];
   for (var i = 0; i < all.length; i++)
   {
      if (facStaffKind == "" || facKindOf(all[i]) == facStaffKind)
      {
         list.push(all[i]);
      }
   }
   if (!list.length)
   {
      flowHint("No faction matches.");
      return;
   }
   var f = null;
   for (var j = 0; j < list.length; j++)
   {
      if (list[j].id == facStaffPicked)
      {
         f = list[j];
      }
   }
   if (f == null)
   {
      f = list[0];
   }
   var fb = [];
   for (var n = 0; n < list.length; n++)
   {
      fb.push([list[n].name + (list[n].count != undefined ? " (" + list[n].count + ")" : ""), function() { facStaffPicked = this.fid; draw(); }, undefined, false, list[n].id == f.id]);
   }
   var fr = flowButtons(fb);
   for (var z = 0; z < list.length; z++)
   {
      fr["btn" + z].fid = list[z].id;
   }
   var lead = s.admin == true;
   var ranks = listOf(f.ranks);
   var leaderRank = 0;
   for (var r = 0; r < ranks.length; r++)
   {
      if (ranks[r].role == "leader")
      {
         leaderRank = r;
         break;
      }
   }
   flowHeading(f.name);
   flowHint((f.secret == true ? "Secret. " : "") + (f.court == true ? "Shown on the Court tab to its members. " : "") + (lead ? "" : "A GM observes: changes are for a Lead GM and above."));
   var ms = listOf(f.members);
   if (!ms.length)
   {
      flowHint("No members yet.");
   }
   for (var m = 0; m < ms.length; m++)
   {
      var mb = ms[m];
      var b = [];
      if (lead)
      {
         if (mb.rank - 1 > leaderRank)
         {
            b.push(["Promote", function() { var r0 = this._parent; facSend(s, ctx, "dbo:factionSetRank", [f.id, r0.actorId, r0.rank - 1]); }, undefined, off]);
         }
         if (mb.rank < ranks.length - 1)
         {
            b.push(["Demote", function() { var r0 = this._parent; facSend(s, ctx, "dbo:factionSetRank", [f.id, r0.actorId, r0.rank + 1]); }, undefined, off]);
         }
         if (mb.rank != leaderRank)
         {
            b.push(["Make leader", function() { var r0 = this._parent; ctx.ask("Make " + r0.who + " the leader of " + f.name + "? The leader now steps down a rank.", "Make leader", function() { facSend(s, ctx, "dbo:factionSetRank", [f.id, r0.actorId, leaderRank]); }); }, undefined, off]);
         }
         b.push(["Remove", function() { var r0 = this._parent; ctx.ask("Remove " + r0.who + " from " + f.name + "?", "Remove", function() { facSend(s, ctx, "dbo:factionKick", [f.id, r0.actorId]); }, true); }, C_RED, off]);
      }
      var e = flowEntry(mb.name + " #" + mb.tag + (mb.online == true ? "" : " (offline)") + "   " + mb.title, b, String(mb.role));
      e.actorId = mb.actorId;
      e.rank = mb.rank;
      e.who = mb.name;
   }
   var tools = [];
   if (lead && f.canAdd == true)
   {
      tools.push(["Add member...", function() { facText(ctx, "Add a member to " + f.name, "Online or not.", "Name or #TAG", 40, "Add member", function(v) { facSend(s, ctx, "dbo:factionAdd", [f.id, v]); }); }, undefined, off]);
   }
   if (f.canRename == true || f.canEditRanks == true)
   {
      tools.push(["Ranks...", function() { facRanks(s, ctx, f); }, undefined, off]);
   }
   if (tools.length)
   {
      flowButtons(tools);
   }
   else
   {
      var names = [];
      for (var t = 0; t < ranks.length; t++)
      {
         names.push(ranks[t].title + " (" + ranks[t].role + ")");
      }
      flowHint("Ranks: " + names.join(", "));
   }
}
