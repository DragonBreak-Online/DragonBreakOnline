// A draggable scrollbar for any list panel (Nat, 31 Oct: "add a scroll bar to click and drag"): thumb drag, track click, wheel.
// A panel adds dbo-scroll.as to its lib.txt and calls scrollbar() beside its rows; the list keeps its own offset and redraws.

// ---- maths (pure; tests/scrollbar-harness.js runs this block in node) ----
// SCROLL-MATHS-BEGIN
var SCROLL_MIN_THUMB = 24;
var SCROLL_W = 6;

function scrollMax(total, visible)
{
   return Math.max(0, total - visible);
}

function scrollClamp(offset, total, visible)
{
   return Math.max(0, Math.min(scrollMax(total, visible), Math.round(offset)));
}

function scrollThumbH(trackH, total, visible)
{
   if (total <= visible || total <= 0)
   {
      return trackH;
   }
   return Math.max(SCROLL_MIN_THUMB, Math.round(trackH * visible / total));
}

function scrollThumbY(offset, trackH, total, visible)
{
   var max = scrollMax(total, visible);
   if (max <= 0)
   {
      return 0;
   }
   return Math.round((trackH - scrollThumbH(trackH, total, visible)) * scrollClamp(offset, total, visible) / max);
}

// The offset a thumb top at y (relative to the track) stands for
function scrollOffsetAt(y, trackH, total, visible)
{
   var room = trackH - scrollThumbH(trackH, total, visible);
   if (room <= 0)
   {
      return 0;
   }
   return scrollClamp(Math.max(0, Math.min(room, y)) / room * scrollMax(total, visible), total, visible);
}

// A track click above the thumb pages up, below it pages down
function scrollPage(offset, clickY, trackH, total, visible)
{
   var top = scrollThumbY(offset, trackH, total, visible);
   if (clickY < top)
   {
      return scrollClamp(offset - visible, total, visible);
   }
   if (clickY > top + scrollThumbH(trackH, total, visible))
   {
      return scrollClamp(offset + visible, total, visible);
   }
   return scrollClamp(offset, total, visible);
}

function scrollWheel(offset, delta, total, visible)
{
   return scrollClamp(offset + (delta > 0 ? -1 : 1), total, visible);
}
// SCROLL-MATHS-END

// ---- the control ----
// scrollbar(parent, name, depth, x, y, h, area): area is the list's hit clip, so the wheel scrolls only over it.
// Returns the bar; bar.set(total, visible, offset) redraws it, bar.onScroll(offset) is the panel's, called on a change.
function scrollbar(parent, name, depth, x, y, h, area)
{
   var bar = parent.createEmptyMovieClip(name, depth);
   bar._x = x;
   bar._y = y;
   bar.trackH = h;
   bar.total = 0;
   bar.visible = 0;
   bar.offset = 0;
   bar.area = area;
   var track = bar.createEmptyMovieClip("track", 1);
   dboBox(track, 0, 0, SCROLL_W, h, C_STONE, 60);
   var thumb = bar.createEmptyMovieClip("thumb", 2);
   bar.set = function(total, visible, offset)
   {
      this.total = total;
      this.visible = visible;
      this.offset = scrollClamp(offset, total, visible);
      this._visible = total > visible;
      var th = scrollThumbH(this.trackH, total, visible);
      this.thumb.clear();
      dboBox(this.thumb, 0, 0, SCROLL_W, th, C_ACCENT, this.dragging ? 100 : 70);
      this.thumb._y = scrollThumbY(this.offset, this.trackH, total, visible);
   };
   bar.move = function(offset)
   {
      var o = scrollClamp(offset, this.total, this.visible);
      if (o != this.offset)
      {
         this.offset = o;
         this.thumb._y = scrollThumbY(o, this.trackH, this.total, this.visible);
         if (this.onScroll != undefined)
         {
            this.onScroll(o);
         }
      }
   };
   thumb.onPress = function()
   {
      var b = this._parent;
      b.dragging = true;
      b.grab = b._ymouse - this._y;
      b.set(b.total, b.visible, b.offset);
      b.onMouseMove = function()
      {
         this.move(scrollOffsetAt(this._ymouse - this.grab, this.trackH, this.total, this.visible));
         this.thumb._y = Math.max(0, Math.min(this.trackH - scrollThumbH(this.trackH, this.total, this.visible), this._ymouse - this.grab));
      };
   };
   thumb.onRelease = thumb.onReleaseOutside = function()
   {
      var b = this._parent;
      b.dragging = false;
      delete b.onMouseMove;
      b.set(b.total, b.visible, b.offset);
   };
   track.onRelease = function()
   {
      var b = this._parent;
      b.move(scrollPage(b.offset, b._ymouse, b.trackH, b.total, b.visible));
      dboSound("UIMenuFocus");
   };
   var wheel = {};
   wheel.bar = bar;
   wheel.onMouseWheel = function(delta)
   {
      var b = this.bar;
      if (b._visible && (b.area == undefined || b.area.hitTest(_root._xmouse, _root._ymouse, false)))
      {
         b.move(scrollWheel(b.offset, delta, b.total, b.visible));
      }
   };
   Mouse.addListener(wheel);
   bar.wheel = wheel;
   bar.onUnload = function()
   {
      Mouse.removeListener(this.wheel);
   };
   return bar;
}
