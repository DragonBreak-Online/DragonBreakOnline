// Teleport: every location, searched across every region or browsed by region and world, as the browser's Teleport tab.
// The service holds the list (adminLocations) and sends a page; choosing a row teleports there (admin::tploc <name>).
TABS.teleport = {
   open: function()
   {
      if (data.teleport == undefined || data.teleport.loading == true)
      {
         req("adminLocationsRequest", {});
      }
   },
   draw: function(c, x, y, w, h)
   {
      var T = data.teleport;
      field(c, "search", 1, x, y, 420, str(ui.q), "Search every region", 60, function(text)
      {
         // typing searches every region, as the browser opens All when a search starts
         if (trimText(text) != "" && trimText(ui.q) == "")
         {
            ui.region = "";
            ui.world = "";
         }
         setUi("q", text);
      }, true);
      if (T == undefined || T.loading == true)
      {
         empty(c, "loading", 2, x, y + 50, w, "Loading locations");
         return;
      }
      var regions = [];
      for (var i = 0; i < T.chips.length; i++)
      {
         regions.push([T.chips[i].id, T.chips[i].label + " " + T.chips[i].count]);
      }
      var cy = chips(c, "region", 10, x, y + 38, x + w, regions, str(T.region), function()
      {
         dboSound("UIMenuPrevNext");
         ui.world = "";
         setUi("region", this.key);
      });
      if (T.worlds instanceof Array && T.worlds.length)
      {
         var worlds = [];
         for (var k = 0; k < T.worlds.length && k < 12; k++)
         {
            worlds.push([T.worlds[k].w, (T.worlds[k].w == "" ? "All" : T.worlds[k].w) + " " + T.worlds[k].n]);
         }
         cy = chips(c, "world", 40, x, cy, x + w, worlds, str(T.world), function()
         {
            dboSound("UIMenuPrevNext");
            setUi("world", this.key);
         });
      }
      var rows = T.rows instanceof Array ? T.rows : [];
      if (!rows.length)
      {
         empty(c, "none", 60, x, cy + 6, w, "No locations");
      }
      var ly = rowList(c, "r", 70, x, cy + 4, w, rows, function(l)
      {
         return [[cut(l.name, 44), 0, 480], [cut(l.where, 44), 500, w - 530, C_SECOND]];
      }, function(l)
      {
         dboSend(ev("tpLoc"), [l.name]);
      });
      pager(c, "pg", 90, x, ly + 4, Number(T.page), Number(T.pages), Number(T.total), "location");
      hint(c, "foot", 99, x, CB - 26, w, "Choose a location to teleport there: click it or press its number.");
   }
};
