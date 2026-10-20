#include "MouseApi.h"


namespace {
constexpr const char* kBackgroundMouse = "bBackgroundMouse:Controls";
// BSWin32MouseDevice's vtable: Reinitialize(bool backgroundMouse) is slot 9 (AE 68805)
constexpr std::size_t kReinitializeSlot = 9;

RE::Setting* FindBackgroundMouseSetting()
{
  // A player's own INI line was read from SkyrimCustom.ini and SkyrimPrefs.ini alike (19 Oct test), so both
  // collections are asked
  if (auto ini = RE::INISettingCollection::GetSingleton()) {
    if (auto setting = ini->GetSetting(kBackgroundMouse)) {
      return setting;
    }
  }
  if (auto prefs = RE::INIPrefSettingCollection::GetSingleton()) {
    if (auto setting = prefs->GetSetting(kBackgroundMouse)) {
      return setting;
    }
  }
  return nullptr;
}

bool ApplyMouseFree(bool free)
{
  auto setting = FindBackgroundMouseSetting();
  auto manager = RE::BSInputDeviceManager::GetSingleton();
  auto mouse = manager ? manager->GetMouse() : nullptr;
  if (!setting || setting->GetType() != RE::Setting::Type::kBool || !mouse) {
    static bool logged = false;
    if (!logged) {
      logged = true;
      spdlog::warn("MouseApi: cannot switch the mouse (setting {}, mouse {})",
                   static_cast<void*>(setting), static_cast<void*>(mouse));
    }
    return false;
  }
  setting->data.b = free;
  using Reinitialize = void (*)(RE::BSWin32MouseDevice*, bool);
  auto vtable = *reinterpret_cast<std::uintptr_t* const*>(mouse);
  reinterpret_cast<Reinitialize>(vtable[kReinitializeSlot])(mouse, free);
  CEFUtils::DInputHook::MouseFree() = free;
  spdlog::info("MouseApi: mouse {}", free ? "free to leave the window" : "held by the game");
  return true;
}
}

// setMouseFree(free): true when the mouse device was switched. Main thread (the JS thread) only
Napi::Value MouseApi::SetMouseFree(const Napi::CallbackInfo& info)
{
  const bool free = NapiHelper::ExtractBoolean(info[0], "free");
  return Napi::Boolean::New(info.Env(), ApplyMouseFree(free));
}

Napi::Value MouseApi::IsMouseFree(const Napi::CallbackInfo& info)
{
  return Napi::Boolean::New(info.Env(), CEFUtils::DInputHook::MouseFree());
}
