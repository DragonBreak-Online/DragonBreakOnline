// What's new (whatsnew.js): the launcher's patch notes, a page of entries at a time. Newer and Older ask the server for
// another page (journalTab focus {page}); opening the tab marks the notes read
var NEWS_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function newsDate(iso)
{
   var s = String(iso);
   if (s.length != 10 || s.charAt(4) != "-" || s.charAt(7) != "-")
   {
      return s;
   }
   var m = Number(s.substr(5, 2));
   return Number(s.substr(8, 2)) + " " + (m >= 1 && m <= 12 ? NEWS_MONTHS[m - 1] : "") + " " + s.substr(0, 4);
}

JT.news = function(s, ctx)
{
   var entries = listOf(s.entries);
   var page = Number(s.page) || 0;
   var pages = Math.max(1, Number(s.pages) || 1);
   flowHeading("What's new");
   if (Number(s.unread) == 1)
   {
      flowHint("One note is new since you last looked.");
   }
   else if (Number(s.unread) > 1)
   {
      flowHint(s.unread + " notes are new since you last looked.");
   }
   if (!entries.length)
   {
      flowHint("No news yet.");
   }
   for (var i = 0; i < entries.length; i++)
   {
      var e = entries[i];
      flowText(String(e.title), 20, C_TEXT);
      flowHint(newsDate(e.date) + (e.tag != undefined && e.tag != "" ? "   ·   " + e.tag : ""));
      var parts = listOf(e.sections);
      for (var j = 0; j < parts.length; j++)
      {
         if (parts[j].heading != undefined && parts[j].heading != "")
         {
            flowText(String(parts[j].heading), 17, C_SECOND, 8);
         }
         var items = listOf(parts[j].items);
         for (var k = 0; k < items.length; k++)
         {
            flowText("-  " + items[k], 16, C_TEXT, 16);
         }
      }
      flowGap(10);
   }
   if (pages > 1)
   {
      flowHint("Page " + (page + 1) + " of " + pages + " of the notes");
      flowButtons([["Newer", function() { ctx.openTab("news", {page: page - 1}); }, undefined, ctx.busy || page <= 0],
         ["Older", function() { ctx.openTab("news", {page: page + 1}); }, undefined, ctx.busy || page >= pages - 1]]);
   }
};
