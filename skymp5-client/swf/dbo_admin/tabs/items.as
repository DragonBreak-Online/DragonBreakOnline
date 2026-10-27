// Items: the item catalog searched (name, editor id, form) across every category, or a category's whole list, narrowed
// by mod; pick an item, give a count and Spawn it on the one acted on (giveItem), as the browser's Items tab. The service
// holds the catalog (adminItems) and sends a page.
var itemsLocal = {picked: "", pickedName: "", count: "1", modPicking: false, modPage: 0};

function countOk(s)
{
   return isWhole(s) && Number(s) >= 1 && Number(s) <= 100000;
}

function drawModPicker(c, x, y, w, I)
{
   var list = [{id: "", label: "Every mod"}].concat(I.plugins instanceof Array ? I.plugins : []);
   var per = MAX_ROWS;
   var pages = Math.max(1, Math.ceil(list.length / per));
   itemsLocal.modPage = Math.max(0, Math.min(pages - 1, itemsLocal.modPage));
   section(c, "modHead", 1, x, y, w, "Narrow to one mod");
   var rows = list.slice(itemsLocal.modPage * per, itemsLocal.modPage * per + per);
   var objs = [];
   for (var i = 0; i < rows.length; i++)
   {
      objs.push(rows[i]);
   }
   var ly = rowList(c, "mod", 10, x, y + 34, w, objs, function(o)
   {
      return [[o.label, 0, w - 40]];
   }, function(o)
   {
      itemsLocal.modPicking = false;
      setUi("mod", o.id);
      draw();
   }, function(o)
   {
      return o.id == str(ui.mod);
   });
   pageTurn = function(d)
   {
      var p = Math.max(0, Math.min(pages - 1, itemsLocal.modPage + d));
      if (p != itemsLocal.modPage)
      {
         dboSound("UIMenuPrevNext");
         itemsLocal.modPage = p;
         draw();
      }
   };
   if (pages > 1)
   {
      hint(c, "modWhere", 40, x, ly + 8, 400, "Page " + (itemsLocal.modPage + 1) + " of " + pages + "  (Left / Right)");
   }
   btn(c, "modCancel", 41, x, CB - 34, 110, "Cancel", function()
   {
      dboSound("UIMenuCancel");
      itemsLocal.modPicking = false;
      draw();
   });
}

TABS.items = {
   escape: function()
   {
      var was = itemsLocal.modPicking;
      itemsLocal.modPicking = false;
      return was;
   },
   open: function()
   {
      if (data.items == undefined || data.items.loading == true)
      {
         req("adminItemsRequest", {});
      }
   },
   leave: function()
   {
      itemsLocal.modPicking = false;
   },
   draw: function(c, x, y, w, h)
   {
      var I = data.items;
      if (I == undefined || I.loading == true)
      {
         empty(c, "loading", 1, x, y + 10, w, "Loading items");
         return;
      }
      if (itemsLocal.modPicking)
      {
         drawModPicker(c, x, y, w, I);
         return;
      }
      field(c, "search", 1, x, y, 420, str(ui.q), "Search items by name or editor id", 60, function(text)
      {
         setUi("q", text);
      }, true);
      btn(c, "mod", 2, x + 436, y - 2, 0, "Mod: " + (str(ui.mod) != "" ? cut(str(ui.mod).split(".esp").join("").split(".esm").join("").split(".esl").join(""), 24) : "every mod"), function()
      {
         dboSound("UIMenuOK");
         itemsLocal.modPicking = true;
         itemsLocal.modPage = 0;
         draw();
      });
      var cats = [];
      for (var i = 0; i < I.chips.length; i++)
      {
         cats.push([I.chips[i].id, I.chips[i].label + " " + I.chips[i].count]);
      }
      var cy = chips(c, "cat", 10, x, y + 38, x + w, cats, str(ui.cat), function()
      {
         dboSound("UIMenuPrevNext");
         setUi("cat", this.key);
      });
      var rows = I.rows instanceof Array ? I.rows : [];
      if (I.recent == true)
      {
         hint(c, "recentHead", 61, x, cy + 2, w, "Spawned lately (type to search, or pick a category)");
         cy += 26;
      }
      if (!rows.length)
      {
         empty(c, "none", 60, x, cy + 6, w, str(I.hint) != "" ? I.hint : "No items");
      }
      var showCat = str(ui.cat) == "";
      var ly = rowList(c, "r", 70, x, cy + 4, w, rows, function(r)
      {
         return showCat ? [[cut(r.name, 44), 0, 470], [cut(r.cat, 22), 480, 230, C_SECOND], [cut(r.plugin, 22), 720, w - 750, C_SECOND]] : [[cut(r.name, 50), 0, 560], [cut(r.plugin, 30), 580, w - 610, C_SECOND]];
      }, function(r)
      {
         // the second choice of the same item spawns it, as the browser's Enter twice
         if (itemsLocal.picked == r.desc && caps().spawn != false && countOk(itemsLocal.count))
         {
            act("giveItem", targetFields({item: r.desc, count: Number(itemsLocal.count)}));
            return;
         }
         itemsLocal.picked = r.desc;
         itemsLocal.pickedName = r.name;
         draw();
      }, function(r)
      {
         return r.desc == itemsLocal.picked;
      });
      pager(c, "pg", 90, x, ly + 4, Number(I.page), Number(I.pages), Number(I.total), "item");
      var ay = CB - 36;
      if (caps().spawn == false)
      {
         hint(c, "spawnHint", 95, x, ay + 4, w, "Spawning items is for a Lead GM and above.");
         return;
      }
      label(c, "picked", 95, x, ay + 4, 420, itemsLocal.picked != "" ? cut(itemsLocal.pickedName, 40) : "Pick an item (pick it twice to spawn)", 18, itemsLocal.picked != "" ? C_TEXT : C_SECOND);
      hint(c, "countL", 96, x + 430, ay + 6, 60, "Count");
      field(c, "count", 97, x + 490, ay + 2, 90, itemsLocal.count, "1", 6, function(text)
      {
         itemsLocal.count = text;
      });
      btn(c, "spawn", 98, x + 596, ay, 110, "Spawn", function()
      {
         act("giveItem", targetFields({item: itemsLocal.picked, count: Number(itemsLocal.count)}));
      }, itemsLocal.picked == "" || !countOk(itemsLocal.count));
   }
};
