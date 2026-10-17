#pragma once

#include "NapiHelper.h"

namespace CameraApi {
Napi::Value WorldPointToScreenPoint(const Napi::CallbackInfo& info);
Napi::Value GetCameraFov(const Napi::CallbackInfo& info);
Napi::Value SetCameraFov(const Napi::CallbackInfo& info);

inline void Register(Napi::Env env, Napi::Object& exports)
{
  exports.Set("worldPointToScreenPoint",
              Napi::Function::New(
                env, NapiHelper::WrapCppExceptions(WorldPointToScreenPoint)));
  exports.Set(
    "getCameraFov",
    Napi::Function::New(env, NapiHelper::WrapCppExceptions(GetCameraFov)));
  exports.Set(
    "setCameraFov",
    Napi::Function::New(env, NapiHelper::WrapCppExceptions(SetCameraFov)));
}
}
