// Focusable controls for the native panels: every button joins actions, Up/Down/Enter walk them, the mouse focuses too.
// A menu defines panel (its root clip) before drawing; clear() replaces one of panel's children.

var actions = [];
var focus = -1;

function button(parent, name, depth, x, y, w, label, font, size, rest, onPick)
{
   var c = parent.createEmptyMovieClip(name, depth);
   c._x = x;
   c._y = y;
   dboBox(c, 0, 0, w, size + 10, 0x000000, 1);
   var t = dboText(c, "label", 1, 0, 2, w, size + 8, dboFmt(font, size, C_TEXT, 0.8), false);
   t.text = label;
   c.rest = rest;
   c._alpha = rest;
   c.onPick = onPick;
   c.idx = actions.length;
   actions.push(c);
   c.onRollOver = function()
   {
      setFocus(this.idx);
   };
   c.onRollOut = function()
   {
      this._alpha = this.rest;
      dboWash(this, false);
      // so the mouse coming back focuses it again
      if (focus == this.idx)
      {
         focus = -1;
      }
   };
   c.onRelease = function()
   {
      if (this.disabled != true)
      {
         this.onPick();
      }
   };
   return c;
}

function disable(c, why)
{
   c.disabled = true;
   c.rest = 50;
   c._alpha = 50;
   c.label.textColor = C_DISABLED;
   if (why != undefined)
   {
      c.label.text = why;
   }
}

function setFocus(i)
{
   if (i == focus || i < 0 || i >= actions.length)
   {
      return;
   }
   if (focus >= 0 && focus < actions.length)
   {
      actions[focus]._alpha = actions[focus].rest;
      dboWash(actions[focus], false);
   }
   focus = i;
   actions[focus]._alpha = A_FOCUS;
   dboWash(actions[focus], true);
   dboSound("UIMenuFocus");
}

function clear(name, depth)
{
   if (panel[name] != undefined)
   {
      panel[name].removeMovieClip();
   }
   return panel.createEmptyMovieClip(name, depth);
}

