// Modes: one button per staff mode, the active ones bright; a press toggles it (admin::mode <id>)
TABS.modes = {
   draw: function(c, x, y, w, h)
   {
      var modes = data.modes instanceof Array ? data.modes : [];
      if (!modes.length)
      {
         empty(c, "none", 1, x, y + 10, w, "No modes");
         return;
      }
      var bw = 220;
      var per = Math.max(1, Math.floor(w / (bw + 12)));
      for (var i = 0; i < modes.length; i++)
      {
         var m = modes[i];
         var b = button(c, "m" + i, 10 + i, x + (i % per) * (bw + 12), y + 10 + Math.floor(i / per) * 46, bw, m.label + (m.active == true ? "  (on)" : ""), F_MEDIUM, 20, m.active == true ? A_FOCUS : A_BUTTON_REST, function()
         {
            dboSound("UIMenuOK");
            dboSend(ev("mode"), [this.modeId]);
         });
         b.modeId = m.id;
         if (m.active == true)
         {
            dboTabMark(b, bw - 28);
            b.rest = A_FOCUS;
         }
      }
   }
};
