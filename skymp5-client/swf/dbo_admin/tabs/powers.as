// Powers: polymorph (your own shape only, from the server's list of open animals), who is an animal now with a Revert
// each, the acted-on character's shape, the werewolf and Vampire Lord powers (Grant, Transform now, Revert, Revoke) and
// Give all spells / shouts, as the browser's Powers tab. A Lead GM and above acts; a GM sees who holds what.
var BEASTS = [["werewolf", "Werewolf", "giveWerewolf"], ["vampirelord", "Vampire Lord", "giveVampireLord"]];

function an(name)
{
   return ("aeiou".indexOf(str(name).charAt(0).toLowerCase()) >= 0 ? "an " : "a ") + name;
}

function formName(form, forms)
{
   if (forms instanceof Array)
   {
      for (var i = 0; i < forms.length; i++)
      {
         if (forms[i].key == form && str(forms[i].name) != "")
         {
            return forms[i].name;
         }
      }
   }
   return form == "vampirelord" ? "Vampire Lord" : form == "werewolf" ? "werewolf" : str(form);
}

// An animal is a shape the server marked as a creature; an older server marks none, and then any non-beast shape is one
function isAnimal(b)
{
   if (b == undefined || b == null || str(b.form) == "")
   {
      return false;
   }
   if (b.creature == true)
   {
      return true;
   }
   return b.creature == undefined && b.form != "werewolf" && b.form != "vampirelord";
}

TABS.powers = {
   draw: function(c, x, y, w, h)
   {
      var spawn = caps().spawn != false;
      var P = data.powers != undefined ? data.powers : {beast: null, selfBeast: null, polymorph: null, polymorphed: []};
      var beast = P.beast;
      var forms = P.polymorph != null ? P.polymorph.forms : null;
      hint(c, "state", 1, x, y, w, beast != null ? (str(beast.form) != "" ? "Currently " + an(formName(beast.form, forms).toLowerCase()) : "In their own shape") : "Refresh to read their state");
      var cy = y + 30;
      var myForm = P.selfBeast != null && str(P.selfBeast.form) != "" ? P.selfBeast.form : "";
      if (P.polymorph != null)
      {
         var pm = P.polymorph;
         label(c, "polyL", 10, x, cy, 140, "Polymorph", 18, C_TEXT);
         hint(c, "polyH", 11, x + 140, cy + 2, w - 280, (pm.on == true ? "on" : "off") + (str(pm.setBy) != "" ? " (" + (pm.setBy == "admin" ? "set by an Owner" : "from " + pm.setBy) + ")" : "") + (myForm != "" ? ", you are " + an(formName(myForm, forms).toLowerCase()) : ", you are in your own shape"));
         if (spawn && myForm != "" && isAnimal(P.selfBeast))
         {
            var rm = btn(c, "revertMe", 12, x + w - 130, cy - 4, 130, "Revert me", function()
            {
               act("beastForm", {form: this.form, op: "revert"});
            });
            rm.form = myForm;
         }
         cy += 34;
         if (spawn)
         {
            label(c, "takeL", 13, x, cy, 280, "Take an animal shape", 18, C_TEXT);
            hint(c, "takeH", 14, x + 210, cy + 2, 200, "yourself only");
            cy += 28;
            if (forms instanceof Array && forms.length)
            {
               var fx = x;
               for (var i = 0; i < forms.length && i < 16; i++)
               {
                  var fw = textW(forms[i].name, 18);
                  if (fx + fw > x + w)
                  {
                     fx = x;
                     cy += 36;
                  }
                  var fb = btn(c, "form" + i, 20 + i, fx, cy, fw, forms[i].name, function()
                  {
                     act("polymorphSelf", {form: this.form});
                  }, !(pm.on == true) || myForm != "");
                  fb.form = forms[i].key;
                  fx += fw + 6;
               }
               cy += 40;
            }
            else
            {
               hint(c, "noForms", 20, x, cy, w, "No animal is open for polymorph on this server.");
               cy += 30;
            }
         }
      }
      var poly = P.polymorphed instanceof Array ? P.polymorphed : [];
      if (spawn && poly.length)
      {
         label(c, "nowL", 40, x, cy, 300, "In an animal shape now", 18, C_TEXT);
         cy += 28;
         var px = x;
         for (var k = 0; k < poly.length && k < 6; k++)
         {
            var r = poly[k];
            var text = r.label + ": " + r.name + (r.minutes != null ? " for " + r.minutes + " min" : "");
            hint(c, "now" + k, 41 + k * 2, px, cy + 4, 280, cut(text, 34));
            var rb = btn(c, "nowRevert" + k, 42 + k * 2, px + 286, cy, 90, "Revert", function()
            {
               var f = {form: this.form, op: "revert"};
               if (this.who != "")
               {
                  f.target = this.who;
               }
               act("beastForm", f);
            });
            rb.form = r.form;
            rb.who = r.id;
            if (k % 2 == 1)
            {
               px = x;
               cy += 36;
            }
            else
            {
               px = x + w / 2;
            }
         }
         cy += poly.length % 2 == 1 ? 36 : 0;
      }
      if (beast != null && isAnimal(beast))
      {
         label(c, "animalL", 60, x, cy, 300, formName(beast.form, forms) + "  (transformed now)", 18, C_TEXT);
         if (spawn)
         {
            var ab = btn(c, "animalRevert", 61, x + 320, cy - 4, 90, "Revert", function()
            {
               act("beastForm", targetFields({form: this.form, op: "revert"}));
            });
            ab.form = beast.form;
         }
         cy += 36;
      }
      for (var b = 0; b < BEASTS.length; b++)
      {
         var key = BEASTS[b][0];
         var state = beast == null ? "state unknown" : beast.form == key ? "transformed now" : beast[key] == true ? "power held" : "not granted";
         label(c, "bL" + b, 70 + b * 10, x, cy, 160, BEASTS[b][1], 18, C_TEXT);
         hint(c, "bS" + b, 71 + b * 10, x + 160, cy + 2, 150, state);
         if (spawn)
         {
            var g = btn(c, "grant" + b, 72 + b * 10, x + 320, cy - 4, 130, "Grant power", function()
            {
               act(this.give, targetFields());
            });
            g.give = BEASTS[b][2];
            var tn = btn(c, "now" + key, 73 + b * 10, x + 458, cy - 4, 140, "Transform now", function()
            {
               act("beastForm", targetFields({form: this.form, op: "now"}));
            });
            tn.form = key;
            var rv = btn(c, "revert" + key, 74 + b * 10, x + 606, cy - 4, 90, "Revert", function()
            {
               act("beastForm", targetFields({form: this.form, op: "revert"}));
            }, beast != null && beast.form != key);
            rv.form = key;
            var rk = confirmBtn(c, "revoke" + key, 75 + b * 10, x + 704, cy - 4, 0, "Revoke", "revoke:" + key + ":" + ui.acting, function()
            {
               act("beastForm", targetFields({form: this.form, op: "revoke"}));
            });
            rk.form = key;
         }
         cy += 40;
      }
      if (spawn)
      {
         label(c, "allL", 90, x, cy, 140, "Everything", 18, C_TEXT);
         hint(c, "allH", 91, x + 140, cy + 2, 400, "every tome spell, every shout a player can learn");
         confirmBtn(c, "spells", 92, x + 560, cy - 4, 0, "Give all spells", "spells:" + ui.acting, function()
         {
            act("giveSpells", targetFields());
         });
         confirmBtn(c, "shouts", 93, x + 780, cy - 4, 0, "Give all shouts", "shouts:" + ui.acting, function()
         {
            act("giveShouts", targetFields());
         });
         cy += 40;
      }
      hint(c, "foot", 99, x, Math.max(cy + 4, CB - 52), w, spawn ? "To make a player a vampire or a werewolf in play, give the disease on the Players tab (Care). Grant gives the power to cast; Transform now changes shape from here; Revoke takes it back. Polymorph is your own shape only; you can revert anyone from the list." : "Powers are for a Lead GM and above. You can see who holds what.", 46);
   }
};
