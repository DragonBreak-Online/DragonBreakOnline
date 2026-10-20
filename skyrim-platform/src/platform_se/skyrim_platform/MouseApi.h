#pragma once

#include "NapiHelper.h"

// Lets the mouse leave the game window while the browser has focus (chat and the DragonBreak panels), so a player on
// two monitors does not have to alt-tab. Measured in SkyrimSE 1.6.1170 (E:\DragonBreak RE, 19 Oct 2026):
// - BSWin32MouseDevice::Initialize (vtable slot 1) sets the mouse's DirectInput cooperative level from the INI setting
//   bBackgroundMouse:Controls: exclusive + foreground when false, which hides the cursor and keeps it in the window;
//   nonexclusive + foreground when true.
// - Reinitialize (slot 9) takes the device's lock, stores its bool argument at +0x70 (CommonLib backgroundMouse) and
//   runs Shutdown then Initialize.
// So setMouseFree sets the setting and reinitializes the mouse, and the game switches mode with its own code. While
// free, the game's menu cursor is placed under the Windows cursor each frame (main.cpp) and the device's movement is
// kept from the game (DInputHook), so there is one cursor and clicks land where it points.
namespace MouseApi {
Napi::Value SetMouseFree(const Napi::CallbackInfo& info);
Napi::Value IsMouseFree(const Napi::CallbackInfo& info);

inline void Register(Napi::Env env, Napi::Object& exports)
{
  exports.Set("setMouseFree",
              Napi::Function::New(env, NapiHelper::WrapCppExceptions(SetMouseFree)));
  exports.Set("isMouseFree",
              Napi::Function::New(env, NapiHelper::WrapCppExceptions(IsMouseFree)));
}
}
