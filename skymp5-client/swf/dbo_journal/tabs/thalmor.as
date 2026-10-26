// Thalmor (thalmor.js): the Concordat, the informants' reports from the shrines of Talos and, for those who may read them,
// the dossiers with Strike on each note. A note is typed, so writing one opens this tab in the browser journal.
// Strike is thalmorStrike [nonce, key, note at]
var thalView = "reports";
var thalOpen = "";
var thalOf = "";

function thalStamp(ms)
{
   if (ms == undefined || !ms)
   {
      return "";
   }
   var d = new Date(Number(ms));
   var p = function(n) { return (n < 10 ? "0" : "") + n; };
   return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + " UTC";
}

JT.thalmor = function(s, ctx)
{
   if (thalOf != cacheOf)
   {
      thalOf = cacheOf;
      thalView = "reports";
      thalOpen = "";
   }
   var c = s.concordat;
   var law = c == undefined || c == null || c.on != true ? "The Concordat is not enforced on this server."
      : c.arrestRanks + " may arrest a follower of Talos in " + c.where + " under the White-Gold Concordat: X on them, Arrest under the Concordat. The Concordat's sentence is "
         + c.minutes + " minutes, passed at a cell door of the jail." + (c.here == true ? "" : " Where you stand now the Concordat gives no authority.");
   var reports = listOf(s.reports);
   var dossiers = listOf(s.dossiers);
   flowHeading("The Thalmor" + (s.rank != undefined && s.rank != "" ? ": " + s.rank : ""));
   flowHint(law);
   var sw = [["Informant reports (" + reports.length + ")", function() { thalView = "reports"; pages[tab] = 0; draw(); }, undefined, false, thalView == "reports"]];
   if (s.canRead == true)
   {
      sw.push(["Dossiers (" + dossiers.length + ")", function() { thalView = "dossiers"; pages[tab] = 0; draw(); }, undefined, false, thalView == "dossiers"]);
   }
   flowButtons(sw);
   if (thalView == "reports" || s.canRead != true)
   {
      if (!reports.length)
      {
         flowHint("No informant has reported anything yet. They watch the shrines of Talos and send word when someone kneels there, but never the name.");
      }
      for (var i = 0; i < reports.length; i++)
      {
         var r = reports[i];
         flowEntry("Someone knelt at the " + r.shrine + ", " + r.place + ".", [], (r.world != undefined && r.world != "" ? r.world + "  -  " : "") + thalStamp(r.at));
      }
      return;
   }
   var shown = null;
   var row = [];
   for (var d = 0; d < dossiers.length; d++)
   {
      if (dossiers[d].key == thalOpen)
      {
         shown = dossiers[d];
      }
      row.push([dossiers[d].name + (dossiers[d].tag != undefined && dossiers[d].tag != "" ? " #" + dossiers[d].tag : "") + " (" + listOf(dossiers[d].notes).length + ")", function()
      {
         thalOpen = thalOpen == this.key ? "" : this.key;
         draw();
      }, undefined, false, dossiers[d].key == thalOpen]);
   }
   if (!dossiers.length)
   {
      flowHint("No dossiers are kept yet.");
   }
   else
   {
      var bar = flowButtons(row);
      for (var b = 0; b < dossiers.length; b++)
      {
         bar["btn" + b].key = dossiers[b].key;
      }
   }
   if (shown == null)
   {
      if (s.canWrite == true)
      {
         flowButtons([["A new dossier...", function() { ctx.browser(); }, undefined, ctx.busy || ctx.readOnly]]);
      }
      else
      {
         flowHint("Choose a dossier to read it.");
      }
      return;
   }
   flowHeading(shown.name + (shown.tag != undefined && shown.tag != "" ? " #" + shown.tag : ""));
   var notes = listOf(shown.notes);
   for (var n = 0; n < notes.length; n++)
   {
      var e = flowEntry(notes[n].text, s.canWrite == true ? [["Strike", function() { ctx.act("thalmorStrike", [this._parent.key, this._parent.at]); }, C_RED, ctx.busy || ctx.readOnly]] : [],
         (notes[n].byName != undefined && notes[n].byName != "" ? notes[n].byName : "Unsigned") + ", " + thalStamp(notes[n].at));
      e.key = shown.key;
      e.at = notes[n].at;
   }
   if (s.canWrite == true)
   {
      flowButtons([["A note on " + shown.name + "...", function() { ctx.browser(); }, undefined, ctx.busy || ctx.readOnly]]);
   }
};
