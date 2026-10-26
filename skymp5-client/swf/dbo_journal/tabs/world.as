// World: what /players, /officials, /time and the like say, a group per command (gamemode.js worldView)
JT.world = function(s, ctx)
{
   flowHeading("The world");
   flowHint("Read when this page opened. Turn to another tab and back to read it again.");
   var groups = listOf(s.groups);
   if (!groups.length)
   {
      flowHint("Nothing to report.");
   }
   for (var i = 0; i < groups.length; i++)
   {
      flowGap(6);
      flowText(groups[i].name, 20, C_TEXT);
      var lines = listOf(groups[i].lines);
      for (var j = 0; j < lines.length; j++)
      {
         flowText(lines[j], 17, C_TEXT, 16);
      }
   }
};
