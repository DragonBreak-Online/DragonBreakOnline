// NPCs: the spawn zones (TP, Reset, Delete) and the Add form, as the browser's NPCs tab. The zone list is searched and
// paged by the service; a zone is picked, then acted on. The form's fields are NPC-Spawns.json's; NPC entries are one
// per line in the browser, separated here by ";" (or ",") because a panel field is one line.
var ZONE_FIELDS = [["name", "Name", "Kagrenzel Falmer"], ["id", "ID", "Kagrenzel01, Tamriel or 0x0001A26F"], ["x", "X", "191763"], ["y", "Y", "-29429"], ["z", "Z", "8280"],
   ["size", "Size", "2000"], ["despawn", "Despawn (s)", "120"], ["respawn", "Respawn (s)", "1800"]];
var zoneForm = {name: "", id: "", x: "", y: "", z: "", size: "2000", npc: "", despawn: "120", respawn: "1800"};

function blankOrNum(s)
{
   return trimText(s) == "" || isNum(s);
}

function optionalNumber(s)
{
   return trimText(s) == "" ? undefined : Number(trimText(s));
}

function npcEntries(s)
{
   var parts = str(s).split("\n").join(";").split(",").join(";").split(";");
   var out = [];
   for (var i = 0; i < parts.length; i++)
   {
      var t = trimText(parts[i]);
      if (t != "")
      {
         out.push(t);
      }
   }
   return out;
}

function canAddZone()
{
   var f = zoneForm;
   return trimText(f.name) != "" && trimText(f.id) != "" && npcEntries(f.npc).length > 0 && isNum(f.x) && isNum(f.y) && isNum(f.z)
      && blankOrNum(f.size) && blankOrNum(f.despawn) && blankOrNum(f.respawn);
}

function addZone()
{
   if (!canAddZone())
   {
      return;
   }
   var f = zoneForm;
   var zone = {Name: trimText(f.name), ID: trimText(f.id), POS: {x: Number(f.x), y: Number(f.y), z: Number(f.z)}, NPC: npcEntries(f.npc)};
   if (optionalNumber(f.size) != undefined)
   {
      zone.Size = optionalNumber(f.size);
   }
   if (optionalNumber(f.despawn) != undefined)
   {
      zone.Despawn = optionalNumber(f.despawn);
   }
   if (optionalNumber(f.respawn) != undefined)
   {
      zone.Respawn = optionalNumber(f.respawn);
   }
   dboSound("UIMenuOK");
   dboSend(ev("npcAdd"), [dboJson(zone)]);
   // the server's toast says whether it was taken; the list comes back with npcZones
   zoneForm = {name: "", id: "", x: "", y: "", z: "", size: "2000", npc: "", despawn: "120", respawn: "1800"};
   setUi("sub", "list");
   draw();
}

TABS.npcs = {
   open: function()
   {
      dboSend(ev("npcList"), []);
   },
   draw: function(c, x, y, w, h)
   {
      var n = data.npcs != undefined ? data.npcs : {sub: "list", rows: [], page: 0, pages: 1, total: 0, all: 0};
      var spawn = caps().spawn != false;
      var sub = str(ui.sub) == "add" ? "add" : "list";
      chip(c, "subList", 1, x, y, "Zones", sub == "list", function()
      {
         dboSound("UIMenuPrevNext");
         setUi("sub", "list");
         draw();
      });
      chip(c, "subAdd", 2, x + 100, y, "Add", sub == "add", function()
      {
         dboSound("UIMenuPrevNext");
         setUi("sub", "add");
         draw();
      });
      var top = y + 40;
      if (sub == "add")
      {
         for (var i = 0; i < ZONE_FIELDS.length; i++)
         {
            var fx = x + (i % 2) * (w / 2);
            var fy = top + Math.floor(i / 2) * 58;
            hint(c, "fl" + i, 10 + i * 2, fx, fy, w / 2 - 20, ZONE_FIELDS[i][1]);
            field(c, "zf_" + ZONE_FIELDS[i][0], 11 + i * 2, fx, fy + 20, w / 2 - 24, zoneForm[ZONE_FIELDS[i][0]], ZONE_FIELDS[i][2], 80, makeZoneCommit(ZONE_FIELDS[i][0]));
         }
         var ny = top + 4 * 58;
         hint(c, "npcL", 40, x, ny, w, "NPC entries: base id and count, separated by ;  (00023A99 4; 23a99:Skyrim.esm 2)");
         field(c, "zf_npc", 41, x, ny + 20, w - 4, zoneForm.npc, "00023A99 4; 23a99:Skyrim.esm 2", 600, makeZoneCommit("npc"));
         btn(c, "add", 42, x, ny + 64, 104, "Add", function()
         {
            addZone();
         }, !canAddZone() || !spawn);
         if (!spawn)
         {
            hint(c, "addHint", 43, x + 120, ny + 68, w - 120, "Adding zones is for a Lead GM and above");
         }
         return;
      }
      hint(c, "searchL", 10, x + 200, y + 4, 70, "Search");
      field(c, "zoneSearch", 11, x + 270, y, 360, str(ui.q), "Search zones", 60, function(text)
      {
         setUi("q", text);
      }, true);
      var list = n.rows instanceof Array ? n.rows : [];
      if (!list.length)
      {
         empty(c, "none", 12, x, top + 10, w, Number(n.all) > 0 ? "No zone matches" : "No zones configured");
      }
      var ly = rowList(c, "z", 20, x, top, w, list, function(z)
      {
         return [[z.name, 0, 420], [z.status, 440, w - 470, z.active == true ? C_GREEN : C_SECOND]];
      }, function(z)
      {
         setUi("zone", z.name, true);
         draw();
      }, function(z)
      {
         return z.name == ui.zone;
      });
      pager(c, "pg", 60, x, ly + 6, Number(n.page), Number(n.pages), Number(n.total), "zone");
      var zone = str(ui.zone);
      var ay = CB - 40;
      label(c, "picked", 70, x, ay + 4, 330, zone != "" ? cut(zone, 36) : "Pick a zone", 18, zone != "" ? C_TEXT : C_SECOND);
      btn(c, "tp", 71, x + 340, ay, 72, "TP", function()
      {
         dboSound("UIMenuOK");
         dboSend(ev("npcTp"), [ui.zone]);
      }, zone == "");
      if (spawn)
      {
         btn(c, "reset", 72, x + 420, ay, 90, "Reset", function()
         {
            dboSound("UIMenuOK");
            dboSend(ev("npcReset"), [ui.zone]);
         }, zone == "");
         confirmBtn(c, "delete", 73, x + 518, ay, 0, "Delete", "zoneDelete:" + zone, function()
         {
            dboSound("UIMenuOK");
            dboSend(ev("npcDelete"), [ui.zone]);
            setUi("zone", "", true);
         }, zone == "");
      }
   }
};

function makeZoneCommit(key)
{
   return function(text)
   {
      zoneForm[key] = text;
   };
}
