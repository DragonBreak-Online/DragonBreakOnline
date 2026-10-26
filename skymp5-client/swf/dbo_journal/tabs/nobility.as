// Nobility (nobility.js): two views, Holds (a hold's fiefs and roll of nobles, Revoke for its ruler or a Lead GM) and Your
// titles (with your fief's treasury and buildings). Granting a title is typed (a name, an estate), so the ruler's Grant opens
// this tab in the browser journal. Revoke is nobilityRevoke [nonce, hold, actor]
var nobView = "holds";
var nobHold = "";
var nobSelected = "";
var nobOf = "";

function nobDate(ms)
{
   if (ms == undefined || !ms)
   {
      return "";
   }
   var d = new Date(Number(ms));
   return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
}

function nobName(n)
{
   return n.name + (n.tag != undefined && n.tag != "" ? " #" + n.tag : "") + (n.online == true ? "  (online)" : "");
}

function nobHoldPane(h, ctx)
{
   flowHeading((h.realm == "cyrodiil" ? "County of " : "") + h.name);
   flowHint(h.ruler != undefined && h.ruler != null ? h.ruler.style + ": " + (h.ruler.name != "" ? h.ruler.name : "unknown") : "The seat stands empty.");
   var fiefs = listOf(h.fiefs);
   if (fiefs.length)
   {
      flowText("Fiefs", 19, C_TEXT);
   }
   for (var f = 0; f < fiefs.length; f++)
   {
      var fi = fiefs[f];
      var t = flowRow(fi.name, fi.holder != null && fi.holder != undefined ? fi.holder.label + ": " + nobName(fi.holder) : "Vacant", fi.treasury != null && fi.treasury != undefined ? fi.treasury + " gold" : "");
      if (fi.holder == null || fi.holder == undefined)
      {
         t.textColor = C_SECOND;
      }
   }
   flowText("Roll of nobles", 19, C_TEXT);
   var roll = listOf(h.roll);
   if (!roll.length)
   {
      flowHint("No title has been granted here.");
   }
   for (var r = 0; r < roll.length; r++)
   {
      var n = roll[r];
      var e = flowEntry(nobName(n) + "   " + n.label, h.isRuler == true || h.canRevoke == true ? [["Revoke", function()
      {
         var row = this._parent;
         ctx.ask("Revoke the title of " + row.who + "?", "Revoke", function() { ctx.act("dbo:nobilityRevoke", [row.hold, row.actor]); }, true);
      }, C_RED, ctx.busy || ctx.readOnly]] : [], "since " + nobDate(n.since));
      e.hold = h.id;
      e.actor = n.actor;
      e.who = n.name;
   }
   if (h.isRuler == true && listOf(h.titles).length)
   {
      flowHeading("Grant a title");
      flowHint("A title is proclaimed to all by your decree. Giving someone a new title here replaces the one they hold.");
      flowButtons([["Grant a title...", function() { ctx.browser(); }, undefined, ctx.busy || ctx.readOnly]]);
   }
}

function nobMine(mine, share)
{
   flowHeading("Your titles");
   if (!mine.length)
   {
      flowHint("You hold no title.");
   }
   for (var i = 0; i < mine.length; i++)
   {
      var m = mine[i];
      flowText(m.label, 21, C_TEXT);
      flowHint("since " + nobDate(m.since));
      if (m.fief == undefined || m.fief == null)
      {
         continue;
      }
      flowText("The treasury of " + m.fief.name + " holds " + (m.fief.treasury == null || m.fief.treasury == undefined ? "an unknown sum" : m.fief.treasury + " gold") + ". It takes " + share + "% of the weekly property tax here; nobody draws on it.", 17, C_SECOND);
      flowText("Buildings of " + m.fief.name, 19, C_TEXT);
      var props = listOf(m.fief.properties);
      if (!props.length)
      {
         flowHint("Nobody holds a building here yet.");
      }
      for (var p = 0; p < props.length; p++)
      {
         flowRow(props[p].name, props[p].owner);
      }
      flowHint("You manage the buildings of your fief as a steward does, at their doors. Your own here do not count against the one-house limit.");
   }
}

JT.nobility = function(s, ctx)
{
   var holds = listOf(s.holds);
   if (nobOf != cacheOf)
   {
      nobOf = cacheOf;
      nobView = "holds";
      nobHold = s.selected != undefined && s.selected != "" ? s.selected : holds.length ? holds[0].id : "";
   }
   if (s.selected != undefined && s.selected != "" && s.selected != nobSelected)
   {
      nobHold = s.selected;
   }
   nobSelected = s.selected != undefined ? s.selected : "";
   flowButtons([["Holds", function() { nobView = "holds"; pages[tab] = 0; draw(); }, undefined, false, nobView == "holds"],
      ["Your titles (" + listOf(s.mine).length + ")", function() { nobView = "mine"; pages[tab] = 0; draw(); }, undefined, false, nobView == "mine"]]);
   if (nobView == "mine")
   {
      nobMine(listOf(s.mine), s.fiefShare);
      return;
   }
   if (!holds.length)
   {
      flowHint("No hold keeps a roll of nobles yet.");
      return;
   }
   var shown = null;
   var row = [];
   for (var i = 0; i < holds.length; i++)
   {
      if (holds[i].id == nobHold)
      {
         shown = holds[i];
      }
      row.push([holds[i].name + (holds[i].isRuler == true ? "  (yours)" : ""), function() { nobHold = this.hold; pages[tab] = 0; draw(); }, undefined, false, holds[i].id == nobHold]);
   }
   if (shown == null)
   {
      shown = holds[0];
      row[0][4] = true;
   }
   var bar = flowButtons(row);
   for (var b = 0; b < holds.length; b++)
   {
      bar["btn" + b].hold = holds[b].id;
   }
   nobHoldPane(shown, ctx);
};
