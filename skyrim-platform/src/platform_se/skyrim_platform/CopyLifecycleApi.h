#pragma once

#include "NapiHelper.h"

// Retires an NPC copy in the order the engine needs: disable, wait until the queued disable has run, then tear it
// down, holding a reference throughout (LIFECYCLE_PLAN.md phase 1)
namespace CopyLifecycleApi {
Napi::Value RetireCopy(const Napi::CallbackInfo& info);
Napi::Value ProcessCopyRetires(const Napi::CallbackInfo& info);
Napi::Value IsCopyRetiring(const Napi::CallbackInfo& info);

// Called from the task 0x50 hook after a queued Disable has run, on a job thread
void OnQueuedDisableRan(RE::TESObjectREFR* ref);

inline void Register(Napi::Env env, Napi::Object& exports)
{
  exports.Set("retireCopy",
              Napi::Function::New(env, NapiHelper::WrapCppExceptions(RetireCopy)));
  exports.Set(
    "processCopyRetires",
    Napi::Function::New(env, NapiHelper::WrapCppExceptions(ProcessCopyRetires)));
  exports.Set(
    "isCopyRetiring",
    Napi::Function::New(env, NapiHelper::WrapCppExceptions(IsCopyRetiring)));
}
}
