// Citizen (citizenship.js): your citizenships with Make Primary and Renounce, requests to withdraw, a court's invitation, the
// elections, a ruler's requests to answer, and for a Lead GM every election and a character's citizenships (the look-up is
// typed, so it opens this tab in the browser journal). Actions are dbo:citizenJ [nonce, action, zone, ...args]
var CITIZEN_PHASE = {none: "no election yet", registration: "courts are being entered", voting: "the vote is open", seated: "the Jarl is elected", held: "held by the staff"};
var CITIZEN_POLICY = {manual: "manual approval", paid: "paid", free: "free"};

// An entry with its grey line before the buttons, as this tab's rows read
function citizenRow(text, sub, btns)
{
   return flowEntry(text, btns, sub);
}

JT.citizen = function(s, ctx)
{
   var off = ctx.busy || ctx.readOnly;
   var J = function(action, zone, args) { ctx.act("dbo:citizenJ", [action, zone].concat(args == undefined ? [] : args)); };
   flowHeading("Citizenship");
   var holds = listOf(s.holds);
   if (!holds.length)
   {
      flowHint("You are a citizen of no hold.");
   }
   var own = 0;
   for (var i = 0; i < holds.length; i++)
   {
      var h = holds[i];
      var how = h.auto == true ? "through a faction or court based there" : i == 0 ? "Primary" : "Secondary";
      var btns = [];
      if (h.auto != true)
      {
         if (own > 0)
         {
            btns.push(["Make Primary", function() { J("primary", this._parent.zone, [this._parent.zone]); }, undefined, off]);
         }
         btns.push(["Renounce", function()
         {
            var row = this._parent;
            ctx.ask("Renounce the citizenship of " + row.holdName + "? You cannot take another for 7 days.", "Renounce", function() { J("renounce", row.zone, [row.zone]); }, true);
         }, C_RED, off]);
         own++;
      }
      var e = citizenRow(h.name, how + (h.since ? "  -  since " + whenText(h.since) : ""), btns);
      e.zone = h.zone;
      e.holdName = h.name;
   }
   if (s.cooldownUntil)
   {
      flowHint("You may take another citizenship from " + whenText(s.cooldownUntil) + ".");
   }
   flowHint("At most " + s.maxHolds + ": a Primary and a Secondary. Become a citizen at a notice board of the hold (Citizenship).");
   var reqs = listOf(s.requests);
   for (var r = 0; r < reqs.length; r++)
   {
      var q = citizenRow("Asked for the citizenship of " + reqs[r].name, whenText(reqs[r].at), [["Withdraw", function() { J("renounce", this._parent.zone, [this._parent.zone]); }, undefined, off]]);
      q.zone = reqs[r].zone;
   }
   var inv = listOf(s.invites);
   if (inv.length)
   {
      flowHeading("Named in a court");
   }
   for (var v = 0; v < inv.length; v++)
   {
      var iv = citizenRow(inv[v].jarl + " names you " + inv[v].seat + " in their court for Jarl of " + inv[v].name + ".", "", [["Accept", function() { J("accept", this._parent.zone, [this._parent.court]); }, undefined, off], ["Refuse", function() { J("refuse", this._parent.zone, [this._parent.court]); }, undefined, off]]);
      iv.zone = inv[v].zone;
      iv.court = inv[v].court;
   }
   var el = listOf(s.elections);
   if (el.length)
   {
      flowHeading("Elections");
   }
   for (var k = 0; k < el.length; k++)
   {
      var x = el[k];
      citizenRow(x.name + ": " + (x.revote == true ? "a revote between tied courts" : CITIZEN_PHASE[x.phase] != undefined ? CITIZEN_PHASE[x.phase] : x.phase) + (x.endsAt ? " until " + whenText(x.endsAt) : ""), x.voted == true ? "you have voted" : x.mine == true ? "you are in a court" : "vote at a notice board of the hold", []);
   }
   var man = listOf(s.manage);
   for (var m = 0; m < man.length; m++)
   {
      var mg = man[m];
      flowHeading(mg.name + ": citizenship is " + (CITIZEN_POLICY[mg.policy] != undefined ? CITIZEN_POLICY[mg.policy] : mg.policy) + (mg.policy == "paid" ? " (" + mg.fee + " gold)" : ""));
      flowHint("Set it at a notice board of the hold.");
      var mr = listOf(mg.requests);
      if (!mr.length)
      {
         flowHint("Nobody has asked.");
      }
      for (var n = 0; n < mr.length; n++)
      {
         var g = citizenRow(mr[n].name + (mr[n].tag != undefined && mr[n].tag != "" ? " #" + mr[n].tag : "") + " asks to become a citizen", "", [["Grant", function() { J("grant", this._parent.zone, [this._parent.actor]); }, undefined, off], ["Decline", function() { J("decline", this._parent.zone, [this._parent.actor]); }, undefined, off]]);
         g.zone = mg.zone;
         g.actor = mr[n].actor;
      }
   }
   if (s.staff == undefined || s.staff == null)
   {
      return;
   }
   flowHeading("Staff: a character's citizenships");
   var l = s.lookup;
   var look = [["Look up a character...", function() { ctx.browser(); }, undefined, off]];
   if (l != undefined && l != null)
   {
      look.push(["Clear", function() { J("lookup", "", [""]); }, undefined, off]);
   }
   flowButtons(look);
   if (l != undefined && l != null)
   {
      flowText(l.name + (l.tag != undefined && l.tag != "" ? " #" + l.tag : ""), 19, C_TEXT);
      var lh = listOf(l.holds);
      if (!lh.length)
      {
         flowHint("No citizenship.");
      }
      for (var z = 0; z < lh.length; z++)
      {
         var c = lh[z];
         var cr = citizenRow(c.name, (c.auto == true ? "through " + (c.via != undefined && c.via != "" ? c.via : "a faction or court") : c.how) + (c.since ? ", since " + whenText(c.since) : ""),
            c.auto == true ? [] : [["Revoke", function()
            {
               var row = this._parent;
               ctx.ask("Revoke " + row.who + "'s citizenship of " + row.holdName + "?", "Revoke", function() { J("revoke", row.zone, [row.actor]); }, true);
            }, C_RED, off]]);
         cr.zone = c.zone;
         cr.holdName = c.name;
         cr.who = l.name;
         cr.actor = l.actor;
         if (c.auto == true)
         {
            flowHint("    Ends when they leave it.");
         }
      }
   }
   flowHeading("Staff: elections");
   var st = listOf(s.staff);
   for (var y = 0; y < st.length; y++)
   {
      var se = st[y];
      var sb = [];
      if (se.phase == "held")
      {
         sb.push(["Resume", function() { J("staff", this._parent.zone, ["resume"]); }, undefined, off]);
      }
      else if (se.phase != "none")
      {
         sb.push(["Hold", function()
         {
            var row = this._parent;
            ctx.ask("Hold the election of " + row.holdName + "?", "Hold", function() { J("staff", row.zone, ["cancel"]); }, true);
         }, C_RED, off]);
      }
      sb.push(["Restart", function()
      {
         var row = this._parent;
         ctx.ask("Start a fresh election in " + row.holdName + " now?", "Restart", function() { J("staff", row.zone, ["restart"]); });
      }, undefined, off]);
      var sr = citizenRow(se.name + ": " + (CITIZEN_PHASE[se.phase] != undefined ? CITIZEN_PHASE[se.phase] : se.phase) + (se.endsAt ? " until " + whenText(se.endsAt) : ""), se.citizens + " of " + se.threshold + " citizens", sb);
      sr.zone = se.zone;
      sr.holdName = se.name;
   }
};
