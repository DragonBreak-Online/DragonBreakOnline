#pragma once

#include "NapiHelper.h"

// A Scaleform menu drawn over other menus that takes no input, unlike SKSE's
// modal CustomMenu, so the menu under it keeps its keys and mouse wheel
namespace OverlayMenuApi {

inline constexpr std::string_view kMenuName = "DboOverlayMenu";

// Registers the menu with the game's UI; call once the UI exists
void RegisterMenu();

Napi::Value Open(const Napi::CallbackInfo& info);
Napi::Value Close(const Napi::CallbackInfo& info);
Napi::Value IsOpen(const Napi::CallbackInfo& info);

inline void Register(Napi::Env env, Napi::Object& exports)
{
  auto overlayMenu = Napi::Object::New(env);
  overlayMenu.Set(
    "open", Napi::Function::New(env, NapiHelper::WrapCppExceptions(Open)));
  overlayMenu.Set(
    "close", Napi::Function::New(env, NapiHelper::WrapCppExceptions(Close)));
  overlayMenu.Set(
    "isOpen", Napi::Function::New(env, NapiHelper::WrapCppExceptions(IsOpen)));
  overlayMenu.Set("menuName", Napi::String::New(env, std::string(kMenuName)));
  exports.Set("overlayMenu", overlayMenu);
}

}
