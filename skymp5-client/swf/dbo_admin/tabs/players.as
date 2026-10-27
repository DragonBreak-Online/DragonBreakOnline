// Players: everything the browser's Players tab holds, in four views so it fits one screen. Roster (search, online only,
// the list, TP / Summon / Kick / Ban and Rename for the picked row), Punish (Kill, Delete character, IP ban, a temp ban,
// the ban list, Reset deity), Care (disease, curse, vampire stage, the schools, on the one acted on) and Mastery (hours
// and the craft). A Trial GM gets the roster with their own actions only, as the browser shows them.
var BAN_LENGTHS = [["1 hour", 1], ["6 hours", 6], ["1 day", 24], ["3 days", 72], ["1 week", 168], ["30 days", 720]];
var MAX_GRANT_HOURS = 1000;
var playersLocal = {rename: "", hours: "24", grant: "1", levels: {}};

function canDo(action)
{
   return has(caps().actions, action);
}

function masteryText(m)
{
   if (m == undefined || m == null)
   {
      return "unknown";
   }
   if (m.profession == undefined || m.profession == null || m.profession == "")
   {
      return "No craft chosen" + (m.hours ? " (" + m.hours + " h banked)" : "");
   }
   return m.label + " - " + m.rankName + " - " + plural(m.hours, "hour");
}

function isGrant(s)
{
   return isWhole(s) && Number(s) != 0 && Math.abs(Number(s)) <= MAX_GRANT_HOURS;
}

function playersSubs()
{
   var cp = caps();
   var list = [["roster", "Roster"]];
   if (cp.trial != true)
   {
      list.push(["punish", "Punish"]);
      if (cp.spawn != false)
      {
         list.push(["care", "Care"]);
      }
      if (cp.spawn != false && ev("masteryGrant") != "")
      {
         list.push(["mastery", "Mastery"]);
      }
   }
   return list;
}

function drawRoster(c, x, y, w, h, P)
{
   var cp = caps();
   field(c, "search", 20, x, y, 380, str(ui.q), "Search players", 60, function(text)
   {
      setUi("q", text);
   }, true);
   chip(c, "online", 21, x + 396, y, "Online only", ui.online == true, function()
   {
      dboSound("UIMenuPrevNext");
      setUi("online", ui.online != true);
   });
   hint(c, "count", 22, x + 540, y + 4, w - 540, P.total + " of " + P.all + " shown");
   var top = y + 40;
   var cols = [["Ping", 0, 60], ["Profile", 64, 70], ["Character", 138, 230], ["Form ID", 372, 110], ["Discord", 486, 150], ["Discord ID", 640, 170], ["IP", 814, 70], ["HWID", 888, 70]];
   for (var k = 0; k < cols.length; k++)
   {
      hint(c, "h" + k, 30 + k, x + 24 + cols[k][1], top, cols[k][2], cols[k][0]);
   }
   var rows = P.rows instanceof Array ? P.rows : [];
   if (!rows.length)
   {
      empty(c, "none", 40, x, top + 30, w, "No players found");
   }
   var ly = rowList(c, "r", 50, x, top + 24, w, rows, function(pl)
   {
      var col = pl.online == true ? C_TEXT : C_SECOND;
      return [[pl.online == true && pl.ping != null ? pl.ping + "ms" : "-", 0, 60, col], [pl.p, 64, 70, col], [cut(pl.n + (str(pl.t) != "" ? " #" + pl.t : ""), 22), 138, 230, col],
         [pl.a != "" ? "0x" + pl.a : "-", 372, 110, col], [cut(str(pl.dn) != "" ? pl.dn : "-", 15), 486, 150, col], [str(pl.d) != "" ? pl.d : "-", 640, 170, col],
         [cut(str(pl.ip) != "" ? pl.ip : "-", 8), 814, 70, col], [cut(str(pl.hwid) != "" ? pl.hwid : "-", 8), 888, 70, col]];
   }, function(pl)
   {
      // picking an online row makes it the one acted on everywhere, as the browser's
      ui.selected = pl.p;
      if (pl.online == true && pl.a != "")
      {
         ui.acting = pl.a;
      }
      setUi("selected", pl.p, true);
   }, function(pl)
   {
      return pl.p == ui.selected;
   });
   pager(c, "pg", 70, x, ly + 4, Number(P.page), Number(P.pages), Number(P.total), "player");
   var sel = P.selected;
   var live = sel != null && sel != undefined && sel.online == true && sel.a != "";
   var ay = CB - 84;
   dboRule(c, x, ay - 8, w);
   label(c, "selName", 80, x, ay, 300, sel != null && sel != undefined ? cut(sel.n, 28) + (sel.online == true ? "" : " (offline)") : "Pick a player", 18, sel != null && sel != undefined ? C_TEXT : C_SECOND);
   var bx = x + 310;
   if (canDo("teleportTo"))
   {
      btn(c, "tp", 81, bx, ay - 4, 96, "TP to", function()
      {
         dboSound("UIMenuOK");
         dboSend(ev("tp"), [data.players.selected.a]);
      }, !live);
      bx += 104;
   }
   if (canDo("summon"))
   {
      btn(c, "summon", 82, bx, ay - 4, 104, "Summon", function()
      {
         dboSound("UIMenuOK");
         dboSend(ev("summon"), [data.players.selected.a]);
      }, !live);
      bx += 112;
   }
   if (canDo("kick"))
   {
      btn(c, "kick", 83, bx, ay - 4, 80, "Kick", function()
      {
         dboSound("UIMenuOK");
         dboSend(ev("kick"), [data.players.selected.a]);
      }, !live);
      bx += 88;
   }
   if (cp.ban != false)
   {
      confirmBtn(c, "ban", 84, bx, ay - 4, 0, "Ban", "ban:" + (live ? sel.a : ""), function()
      {
         dboSound("UIMenuOK");
         dboSend(ev("ban"), [data.players.selected.a]);
      }, !live);
   }
   if (canDo("rename") && ev("action") != "")
   {
      var ry = ay + 38;
      field(c, "rename", 90, x, ry, 420, playersLocal.rename, live ? "New name for " + cut(sel.n, 24) : "Pick an online player to rename", 31, function(text)
      {
         playersLocal.rename = text;
      });
      btn(c, "renameGo", 91, x + 432, ry - 2, 110, "Rename", function()
      {
         act("rename", {target: data.players.selected.a, name: trimText(playersLocal.rename)});
         playersLocal.rename = "";
         draw();
      }, !live || trimText(playersLocal.rename) == "");
   }
}

function drawPunish(c, x, y, w, h, P)
{
   var cp = caps();
   var sel = P.selected;
   var live = sel != null && sel != undefined && sel.online == true && sel.a != "";
   var target = live ? sel.a : "";
   label(c, "who", 20, x, y, w, sel != null && sel != undefined ? "Selected: " + sel.n + (live ? "" : " (offline: only Reset deity reaches them)") : "Pick a player on the Roster first", 18, sel != null && sel != undefined ? C_TEXT : C_SECOND);
   var by = y + 34;
   var bx = x;
   if (cp.spawn != false)
   {
      btn(c, "kill", 21, bx, by, 80, "Kill", function()
      {
         act("kill", {target: data.players.selected.a});
      }, !live);
      bx += 88;
   }
   if (cp.del != false)
   {
      confirmBtn(c, "delete", 22, bx, by, 0, "Delete character", "delete:" + target, function()
      {
         act("deleteCharacter", {target: data.players.selected.a});
      }, !live);
      bx += textW("Sure? Delete character", 18) + 8;
   }
   if (cp.ban != false)
   {
      confirmBtn(c, "ipban", 23, bx, by, 0, "IP ban", "ipban:" + target, function()
      {
         act("ipBan", {target: data.players.selected.a});
      }, !live);
   }
   var ty = by + 44;
   if (cp.ban != false)
   {
      section(c, "tempHead", 30, x, ty, 300, "Temp ban" + (sel != null && sel != undefined ? " " + cut(sel.n, 24) : ""));
      var list = [];
      for (var i = 0; i < BAN_LENGTHS.length; i++)
      {
         list.push([String(BAN_LENGTHS[i][1]), BAN_LENGTHS[i][0]]);
      }
      var cy = chips(c, "len", 31, x, ty + 30, x + w, list, String(Number(playersLocal.hours)), function()
      {
         dboSound("UIMenuPrevNext");
         playersLocal.hours = this.key;
         draw();
      });
      hint(c, "hoursL", 40, x, cy + 4, 60, "Hours");
      field(c, "hours", 41, x + 60, cy, 100, playersLocal.hours, "24", 5, function(text)
      {
         playersLocal.hours = text;
      });
      var hoursOk = Number(playersLocal.hours) > 0 && Number(playersLocal.hours) <= 8760;
      confirmBtn(c, "tempban", 42, x + 176, cy - 2, 0, "Temp ban", "tempban:" + target + ":" + playersLocal.hours, function()
      {
         act("tempBan", {target: data.players.selected.a, hours: Number(playersLocal.hours)});
      }, !live || !hoursOk);
      ty = cy + 44;
   }
   // Reset deity works on an offline row too: the server finds the character by name and profile
   if (cp.spawn != false)
   {
      confirmBtn(c, "deity", 45, x, ty, 0, "Reset deity", "deity:" + (sel != null && sel != undefined ? sel.p + ":" + sel.n : ""), function()
      {
         var s = data.players.selected;
         dboSound("UIMenuOK");
         dboSend("dbo:deityReset", [s.online == true ? s.a : "", s.n, s.p]);
      }, sel == null || sel == undefined);
      hint(c, "deityHint", 46, x + 200, ty + 4, w - 200, "Clears their god, blessing and conversion clock so they choose again");
      ty += 40;
   }
   var bans = P.bans instanceof Array ? P.bans : [];
   if (bans.length)
   {
      dboDivider(c, x, ty, w);
      section(c, "bansHead", 50, x, ty + 8, 200, "Bans");
      var shown = bans.slice(0, Math.max(1, Math.floor((CB - ty - 50) / ROW_H)));
      rowList(c, "b", 60, x, ty + 38, w - 130, shown, function(b)
      {
         return [[cut(b.name, 26), 0, 260], [b.ip != "" ? "IP " + b.ip : "profile", 270, 200, C_SECOND], [b.until ? "until " + new Date(b.until).toUTCString().substr(5, 17) : "permanent", 480, 230], [cut(b.by, 14), 720, 130, C_SECOND]];
      }, function(b)
      {
         ui.ban = b.id;
         draw();
      }, function(b)
      {
         return b.id == ui.ban;
      });
      if (cp.ban != false)
      {
         btn(c, "unban", 80, x + w - 120, ty + 38, 110, "Unban", function()
         {
            act("unban", {target: ui.ban});
            ui.ban = "";
         }, str(ui.ban) == "");
      }
   }
}

function drawCare(c, x, y, w, h)
{
   var who = data.acting != undefined ? str(data.acting.label) : "You";
   var fields = function(extra)
   {
      return targetFields(extra);
   };
   section(c, "disHead", 20, x, y, 260, "Disease");
   hint(c, "disHint", 21, x + 120, y + 2, w - 120, "for " + who + ": the fever runs its days, then they turn");
   confirmBtn(c, "disV", 22, x, y + 28, 0, "Sanguinare Vampiris", "dis:v:" + ui.acting, function()
   {
      act("giveDisease", targetFields({kind: "vampire"}));
   });
   confirmBtn(c, "disW", 23, x + 270, y + 28, 0, "Sanies Lupinus", "dis:w:" + ui.acting, function()
   {
      act("giveDisease", targetFields({kind: "werewolf"}));
   });
   var cy = y + 76;
   section(c, "curseHead", 30, x, cy, 260, "Curse");
   hint(c, "curseHint", 31, x + 120, cy + 2, w - 120, "for " + who + ": the whole curse at once, no fever; Cure makes them mortal");
   var curses = [["vampire", "Vampire"], ["purevampire", "Pure-blood"], ["werewolf", "Werewolf"], ["blessedwerewolf", "Blessed werewolf"], ["cure", "Cure"]];
   var bx = x;
   for (var i = 0; i < curses.length; i++)
   {
      var b = confirmBtn(c, "curse" + i, 32 + i, bx, cy + 28, 0, curses[i][1], "curse:" + curses[i][0] + ":" + ui.acting, function()
      {
         act("giveCurse", targetFields({kind: this.kind}));
      });
      b.kind = curses[i][0];
      bx += textW("Sure? " + curses[i][1], 18) + 6;
   }
   var sy = cy + 76;
   section(c, "stageHead", 40, x, sy, 260, "Vampire stage");
   hint(c, "stageHint", 41, x + 160, sy + 2, w - 160, "their thirst, 1 (fed) to 4 (starving); only on a vampire");
   for (var n = 1; n <= 4; n++)
   {
      var sb = confirmBtn(c, "stage" + n, 42 + n, x + (n - 1) * 140, sy + 28, 132, "Stage " + n, "stage:" + n + ":" + ui.acting, function()
      {
         act("giveCurse", targetFields({kind: "stage", stage: this.stage}));
      });
      sb.stage = n;
   }
   var ky = sy + 76;
   section(c, "schoolHead", 50, x, ky, 260, "Schools of magic");
   hint(c, "schoolHint", 51, x + 200, ky + 2, w - 200, "0 to 100; a closed school set above 0 rests at that level");
   var care = data.care;
   var schools = care != undefined && care != null && care.detail != null && care.detail.schools instanceof Array ? care.detail.schools : [];
   if (!schools.length)
   {
      hint(c, "schoolNone", 52, x, ky + 30, w, care == undefined || care == null ? "Loading their schools" : care.detail != null && care.detail.schools instanceof Array ? "Not a mage yet: no school of magic has opened to them." : "Magic data unavailable.");
      return;
   }
   for (var k = 0; k < schools.length; k++)
   {
      var sc = schools[k];
      var ry = ky + 30 + k * 36;
      var priest = sc.name == "Restoration";
      label(c, "sn" + k, 60 + k * 5, x, ry + 2, 150, sc.name, 18, C_TEXT);
      hint(c, "sr" + k, 61 + k * 5, x + 150, ry + 4, 200, sc.roleLabel != "" ? sc.roleLabel : sc.role);
      var text = playersLocal.levels[sc.name] != undefined ? playersLocal.levels[sc.name] : String(sc.level);
      if (priest)
      {
         label(c, "sv" + k, 62 + k * 5, x + 360, ry + 2, 80, String(sc.level), 18, C_SECOND);
         hint(c, "sp" + k, 63 + k * 5, x + 450, ry + 4, 400, "follows Priest: set it on the Skills tab");
         continue;
      }
      var f = field(c, "school_" + sc.name, 62 + k * 5, x + 360, ry, 80, text, String(sc.level), 3, makeLevelCommit(sc.name));
      var nv = Number(text);
      var valid = isWhole(text) && nv >= 0 && nv <= 100 && nv != sc.level;
      var setB = btn(c, "set" + k, 63 + k * 5, x + 452, ry - 2, 72, "Set", function()
      {
         act("setSchool", targetFields({school: this.school, level: Number(playersLocal.levels[this.school])}));
      }, !valid);
      setB.school = sc.name;
   }
}

function makeLevelCommit(name)
{
   return function(text)
   {
      playersLocal.levels[name] = text;
   };
}

function drawMastery(c, x, y, w, h, P)
{
   section(c, "head", 20, x, y, 300, "Mastery hours");
   field(c, "grant", 21, x + 200, y - 2, 90, playersLocal.grant, "1", 6, function(text)
   {
      playersLocal.grant = text;
   });
   hint(c, "grantHint", 22, x + 306, y + 2, w - 306, "Whole hours to grant; negative takes them back, rank and recipes follow");
   var rows = [];
   if (P.mastery != null && P.mastery != undefined && str(data.selfId) != "")
   {
      rows.push({who: "You", target: data.selfId, m: P.mastery});
   }
   var sel = P.selected;
   if (sel != null && sel != undefined && sel.online == true && sel.a != "")
   {
      rows.push({who: str(sel.n) != "" ? sel.n : "(no name)", target: sel.a, m: sel.m});
   }
   if (!rows.length)
   {
      hint(c, "none", 23, x, y + 40, w, "Pick an online player on the Roster to grant mastery hours");
      return;
   }
   for (var i = 0; i < rows.length; i++)
   {
      var r = rows[i];
      var ry = y + 40 + i * 44;
      label(c, "mw" + i, 30 + i * 4, x, ry + 2, 200, cut(r.who, 20), 18, C_TEXT);
      label(c, "mi" + i, 31 + i * 4, x + 210, ry + 2, 460, cut(masteryText(r.m), 48), 18, C_SECOND);
      var g = btn(c, "mg" + i, 32 + i * 4, x + 680, ry - 2, 90, "Grant", function()
      {
         dboSound("UIMenuOK");
         dboSend(ev("masteryGrant"), [this.target, Number(playersLocal.grant)]);
      }, !isGrant(playersLocal.grant));
      g.target = r.target;
      var rc = confirmBtn(c, "mr" + i, 33 + i * 4, x + 778, ry - 2, 0, "Reset craft", "craft:" + r.target, function()
      {
         dboSound("UIMenuOK");
         dboSend(ev("masteryReset"), [this.target]);
      }, !(r.m != null && r.m != undefined && r.m.profession != null && r.m.profession != undefined && r.m.profession != ""));
      rc.target = r.target;
   }
}

TABS.players = {
   open: function()
   {
      if (caps().spawn != false && caps().trial != true)
      {
         req("adminMasteryRequest", targetFields());
      }
   },
   acting: function()
   {
      if (caps().spawn != false && caps().trial != true)
      {
         req("adminMasteryRequest", targetFields());
      }
   },
   draw: function(c, x, y, w, h)
   {
      var P = data.players != undefined ? data.players : {rows: [], page: 0, pages: 1, total: 0, all: 0, selected: null, bans: [], mastery: null};
      var subs = playersSubs();
      var sub = str(ui.sub);
      var known = false;
      for (var i = 0; i < subs.length; i++)
      {
         if (subs[i][0] == sub)
         {
            known = true;
         }
      }
      if (!known)
      {
         sub = "roster";
      }
      if (subs.length > 1)
      {
         chips(c, "sub", 2, x, y, x + w, subs, sub, function()
         {
            dboSound("UIMenuPrevNext");
            setUi("sub", this.key, true);
            draw();
         });
         y += 36;
         h -= 36;
      }
      if (sub == "punish")
      {
         drawPunish(c, x, y, w, h, P);
      }
      else if (sub == "care")
      {
         drawCare(c, x, y, w, h);
      }
      else if (sub == "mastery")
      {
         drawMastery(c, x, y, w, h, P);
      }
      else
      {
         drawRoster(c, x, y, w, h, P);
      }
   }
};
