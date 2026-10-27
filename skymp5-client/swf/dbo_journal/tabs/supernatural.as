// Supernatural (the curse's progress, masterySystem): its epithet and creed, its rows, its powers, where it stands on its
// ladder and the ranks of that ladder. Nothing here is an action
JT.supernatural = function(s, ctx)
{
   flowHeading(s.epithet);
   if (s.creed != undefined && s.creed != "")
   {
      flowText(s.creed, 17, C_SECOND);
   }
   var rows = listOf(s.rows);
   for (var i = 0; i < rows.length; i++)
   {
      flowRow(rows[i].label, rows[i].value, rows[i].hint);
   }
   var powers = listOf(s.powers);
   if (powers.length)
   {
      flowText("Powers", 19, C_TEXT);
   }
   for (var p = 0; p < powers.length; p++)
   {
      var t = flowRow(powers[p].name, powers[p].note);
      t.textColor = powers[p].have == true ? C_TEXT : C_SECOND;
   }
   var l = s.ladder;
   if (l == undefined || l == null)
   {
      return;
   }
   var ranks = listOf(l.ranks);
   var here = ranks[l.rank];
   var next = l.rank + 1 < ranks.length ? ranks[l.rank + 1] : null;
   flowGap(8);
   flowText(l.value + " " + l.unit + "   " + (here != undefined ? here.name : ""), 22, C_TEXT);
   flowHint((next != null ? Math.max(0, next.at - l.value) + " more " + l.unit + " to " + next.name + ". " : "No rank of " + l.name + " stands higher. ") + l.earn);
   flowHeading(l.name);
   for (var r = 0; r < ranks.length; r++)
   {
      var row = flowRow(ranks[r].name + (r == l.rank ? "  (yours)" : ""), ranks[r].perk, ranks[r].at ? ranks[r].at + " " + l.unit : "from the start");
      row.textColor = l.rank >= r ? C_TEXT : C_SECOND;
   }
};
