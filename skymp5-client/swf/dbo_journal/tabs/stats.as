// Stats: groups of label and value rows (journal.js statsView)
JT.stats = function(s, ctx)
{
   var groups = listOf(s.groups);
   if (!groups.length)
   {
      flowText("Nothing has been recorded yet.", 18, C_SECOND);
      return;
   }
   for (var i = 0; i < groups.length; i++)
   {
      flowHeading(groups[i].name);
      var rows = listOf(groups[i].rows);
      for (var j = 0; j < rows.length; j++)
      {
         flowRow(rows[j].label, rows[j].value, rows[j].hint);
      }
      flowGap(8);
   }
};
