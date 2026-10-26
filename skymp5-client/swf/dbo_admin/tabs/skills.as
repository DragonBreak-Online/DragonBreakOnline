// Skills: the acted-on character's skills, a tier chip per skill (masterySetTier) and Set aside (masteryDrop), as the
// browser's Skills tab. A Lead GM and above changes them; a GM sees them.
var skillsPage = 0;

function loadSkills()
{
   req("adminMasteryRequest", targetFields());
}

TABS.skills = {
   open: function()
   {
      loadSkills();
   },
   acting: function()
   {
      loadSkills();
   },
   draw: function(c, x, y, w, h)
   {
      var spawn = caps().spawn != false;
      var s = data.skills;
      btn(c, "reload", 1, x, y, 100, "Reload", function()
      {
         dboSound("UIMenuOK");
         loadSkills();
      });
      hint(c, "who", 2, x + 116, y + 4, w - 116, s != undefined && s != null ? (spawn ? "Editing " : "Viewing ") + (str(s.name) != "" ? s.name : "you") : "Loading");
      if (s == undefined || s == null || s.detail == null)
      {
         empty(c, "none", 3, x, y + 50, w, "No skill data yet");
         return;
      }
      var d = s.detail;
      var list = d.skills instanceof Array ? d.skills : [];
      var per = 8;
      var pages = Math.max(1, Math.ceil(list.length / per));
      skillsPage = Math.max(0, Math.min(pages - 1, skillsPage));
      var rows = list.slice(skillsPage * per, skillsPage * per + per);
      for (var i = 0; i < rows.length; i++)
      {
         var sk = rows[i];
         var ry = y + 44 + i * 44;
         label(c, "n" + i, 10 + i * 20, x, ry + 2, 200, cut(sk.label, 20), 18, sk.chosen == true ? C_TEXT : C_SECOND);
         hint(c, "st" + i, 11 + i * 20, x + 200, ry + 4, 170, sk.chosen == true ? (d.tierNames[sk.rank] != undefined ? d.tierNames[sk.rank] : "-") + " - " + sk.hours : "not followed");
         if (!spawn)
         {
            continue;
         }
         var cx = x + 380;
         for (var k = 0; k < d.tierNames.length && k < 8; k++)
         {
            var tn = d.tierNames[k];
            var ch = chip(c, "t" + i + "_" + k, 12 + i * 20 + k, cx, ry, tn, sk.chosen == true && sk.rank == k, function()
            {
               act("masterySetTier", {target: data.skills.target, skill: this.skill, tier: this.tier});
            });
            ch.skill = sk.id;
            ch.tier = k;
            cx += textW(tn, 16) + 4;
         }
         if (sk.chosen == true)
         {
            var sa = btn(c, "aside" + i, 19 + i * 20, x + w - 110, ry, 110, "Set aside", function()
            {
               act("masteryDrop", {target: data.skills.target, skill: this.skill});
            });
            sa.skill = sk.id;
         }
      }
      var py = y + 44 + per * 44 + 4;
      pageTurn = function(dd)
      {
         var p = Math.max(0, Math.min(pages - 1, skillsPage + dd));
         if (p != skillsPage)
         {
            dboSound("UIMenuPrevNext");
            skillsPage = p;
            draw();
         }
      };
      if (pages > 1)
      {
         hint(c, "page", 200, x, py, 300, "Page " + (skillsPage + 1) + " of " + pages + "  (Left / Right)");
      }
      hint(c, "foot", 201, x, CB - 26, w, spawn ? "A tier puts the character at its first point; skills past the " + d.maxChosen + "-skill limit are allowed. Set aside is a free respec." : "Changing skills is for a Lead GM and above.");
   }
};
