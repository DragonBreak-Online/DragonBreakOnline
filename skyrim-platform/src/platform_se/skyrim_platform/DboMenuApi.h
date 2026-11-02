#pragma once

#include "NapiHelper.h"

// A Scaleform menu of our own, opened, driven and heard from JS without
// Papyrus, so it works where only "tick" runs (the main menu, before the world
// loads): character select and the login forms. SKSE's CustomMenu needs
// Papyrus for every step (UI.OpenCustomMenu, UI.Invoke*, skse.SendModEvent),
// and the main menu runs none.
//   dboMenuOpen(swf, flags, depth)  loads Data\Interface\<swf>.swf in the menu
//   "DboMenu" (one at a time) dboMenuClose()                  hides it
//   dboMenuIsOpen()                 whether the engine has it open
//   dboMenuInvoke(target, arg)      calls a function of the movie with one
//   string, on the UI thread dboMenuPoll()                   the strings the
//   movie passed to _global.dboNative(...) since the last poll, oldest first
// Every engine call is CommonLibSSE's (CharmedBaryon b93280e): UI::Register,
// UIMessageQueue::AddMessage kShow/kHide, BSScaleformManager::LoadMovie,
// GFxMovie::CreateFunction/GetVariable/Invoke, GFxValue::SetMember,
// TaskInterface::AddUITask.
namespace DboMenuApi {
Napi::Value Open(const Napi::CallbackInfo& info);
Napi::Value Close(const Napi::CallbackInfo& info);
Napi::Value IsOpen(const Napi::CallbackInfo& info);
Napi::Value Invoke(const Napi::CallbackInfo& info);
Napi::Value Poll(const Napi::CallbackInfo& info);

// SKSE kDataLoaded: the UI exists, so the menu's creator is registered
void HandleSkseMessage(SKSE::MessagingInterface::Message* a_msg);

inline void Register(Napi::Env env, Napi::Object& exports)
{
  exports.Set("dboMenuOpen",
              Napi::Function::New(env, NapiHelper::WrapCppExceptions(Open)));
  exports.Set("dboMenuClose",
              Napi::Function::New(env, NapiHelper::WrapCppExceptions(Close)));
  exports.Set("dboMenuIsOpen",
              Napi::Function::New(env, NapiHelper::WrapCppExceptions(IsOpen)));
  exports.Set("dboMenuInvoke",
              Napi::Function::New(env, NapiHelper::WrapCppExceptions(Invoke)));
  exports.Set("dboMenuPoll",
              Napi::Function::New(env, NapiHelper::WrapCppExceptions(Poll)));
}
}
