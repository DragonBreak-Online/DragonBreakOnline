#include "OverlayMenuApi.h"

namespace {

// The movie the next opening loads, under Data/Interface, without ".swf"
std::string g_swfPath;
bool g_registered = false;

class OverlayMenu : public RE::IMenu
{
public:
  OverlayMenu()
  {
    // SKSE's CustomMenu is kModal | kPausesGame with kMenuMode input
    menuFlags = Flag::kNone;
    inputContext = Context::kNone;
    depthPriority = 10;
    auto scaleform = RE::BSScaleformManager::GetSingleton();
    if (scaleform) {
      scaleform->LoadMovie(this, uiMovie, g_swfPath.c_str(),
                           RE::GFxMovieView::ScaleModeType::kNoBorder, 0.0f);
    }
  }

  static RE::IMenu* Create() { return new OverlayMenu(); }
};

void Send(RE::UI_MESSAGE_TYPE type)
{
  auto queue = RE::UIMessageQueue::GetSingleton();
  if (!queue) {
    throw std::runtime_error("UIMessageQueue is not available");
  }
  queue->AddMessage(OverlayMenuApi::kMenuName, type, nullptr);
}

}

void OverlayMenuApi::RegisterMenu()
{
  auto ui = RE::UI::GetSingleton();
  if (!ui || g_registered) {
    return;
  }
  ui->Register(kMenuName, OverlayMenu::Create);
  g_registered = true;
}

Napi::Value OverlayMenuApi::Open(const Napi::CallbackInfo& info)
{
  if (!g_registered) {
    throw std::runtime_error("The overlay menu is not registered yet");
  }
  g_swfPath = NapiHelper::ExtractString(info[0], "swfPath");
  Send(RE::UI_MESSAGE_TYPE::kShow);
  return info.Env().Undefined();
}

Napi::Value OverlayMenuApi::Close(const Napi::CallbackInfo& info)
{
  if (g_registered) {
    Send(RE::UI_MESSAGE_TYPE::kHide);
  }
  return info.Env().Undefined();
}

Napi::Value OverlayMenuApi::IsOpen(const Napi::CallbackInfo& info)
{
  auto ui = RE::UI::GetSingleton();
  return Napi::Boolean::New(info.Env(), ui && ui->IsMenuOpen(kMenuName));
}
