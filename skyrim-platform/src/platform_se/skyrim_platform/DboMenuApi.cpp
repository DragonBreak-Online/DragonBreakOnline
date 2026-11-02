#include "DboMenuApi.h"
#include "NullPointerException.h"

#include <algorithm>
#include <deque>
#include <mutex>
#include <string>

namespace {
constexpr const char* kMenuName = "DboMenu";
// Messages the movie sent and JS has not polled yet; a movie that never stops calling cannot grow it without bound
constexpr size_t kMaxQueued = 512;
// The flags a caller may set: everything below kUsesMovementToDirection's next bit
constexpr uint32_t kFlagMask = (1u << 28) - 1;

std::mutex g_mutex;
std::string g_swf;
uint32_t g_flags = 0;
int8_t g_depth = 3;
std::deque<std::string> g_queue;

// _global.dboNative(...) in the movie: its arguments joined by \u0001, kept for dboMenuPoll
class NativeCallback : public RE::GFxFunctionHandler
{
public:
  void Call(Params& a_params) override
  {
    std::string line;
    for (uint32_t i = 0; i < a_params.argCount; ++i) {
      if (i > 0)
        line += '\x01';
      const auto& v = a_params.args[i];
      if (v.IsString())
        line += v.GetString();
      else if (v.IsNumber())
        line += std::to_string(v.GetNumber());
    }
    std::lock_guard l(g_mutex);
    if (g_queue.size() >= kMaxQueued)
      g_queue.pop_front();
    g_queue.push_back(std::move(line));
  }
};

RE::GFxFunctionHandler* Callback()
{
  static RE::GPtr<NativeCallback> handler(new NativeCallback);
  return handler.get();
}

class DboMenu : public RE::IMenu
{
public:
  DboMenu()
  {
    std::string swf;
    {
      std::lock_guard l(g_mutex);
      swf = g_swf;
      menuFlags.set(static_cast<Flag>(g_flags));
      depthPriority = g_depth;
    }
    inputContext = Context::kMenuMode;
    auto manager = RE::BSScaleformManager::GetSingleton();
    if (!manager || swf.empty()) {
      logger::error("DboMenu: no scaleform manager or no swf, nothing loaded");
      return;
    }
    if (!manager->LoadMovie(this, uiMovie, swf.c_str(),
                            RE::GFxMovieView::ScaleModeType::kNoBorder)) {
      logger::error("DboMenu: Interface/{}.swf did not load", swf);
      return;
    }
    RE::GFxValue global;
    if (uiMovie && uiMovie->GetVariable(&global, "_global") &&
        global.IsObject()) {
      RE::GFxValue fn;
      uiMovie->CreateFunction(&fn, Callback());
      global.SetMember("dboNative", fn);
    }
    logger::info("DboMenu: Interface/{}.swf loaded, flags {:x}", swf,
                 menuFlags.underlying());
  }

  static RE::IMenu* Create() { return new DboMenu(); }
};

void Message(RE::UI_MESSAGE_TYPE a_type)
{
  auto queue = RE::UIMessageQueue::GetSingleton();
  if (!queue)
    throw NullPointerException("UIMessageQueue");
  queue->AddMessage(kMenuName, a_type, nullptr);
}
}

Napi::Value DboMenuApi::Open(const Napi::CallbackInfo& info)
{
  auto swf = NapiHelper::ExtractString(info[0], "swf");
  if (swf.empty() || swf.find_first_of("/\\.:") != std::string::npos)
    throw std::runtime_error("dboMenuOpen: swf must be a bare name in Data\\Interface");
  auto flags = static_cast<uint32_t>(
    info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().Uint32Value() : 0);
  auto depth =
    info.Length() > 2 && info[2].IsNumber() ? info[2].As<Napi::Number>().Int32Value() : 3;
  {
    std::lock_guard l(g_mutex);
    g_swf = swf;
    g_flags = flags & kFlagMask;
    g_depth = static_cast<int8_t>(std::clamp(depth, 0, 20));
    g_queue.clear();
  }
  // A menu already up is a different movie or flags: it goes first, and the show creates it afresh
  auto ui = RE::UI::GetSingleton();
  if (ui && ui->IsMenuOpen(kMenuName))
    Message(RE::UI_MESSAGE_TYPE::kHide);
  Message(RE::UI_MESSAGE_TYPE::kShow);
  return info.Env().Undefined();
}

Napi::Value DboMenuApi::Close(const Napi::CallbackInfo& info)
{
  Message(RE::UI_MESSAGE_TYPE::kHide);
  return info.Env().Undefined();
}

Napi::Value DboMenuApi::IsOpen(const Napi::CallbackInfo& info)
{
  auto ui = RE::UI::GetSingleton();
  return Napi::Boolean::New(info.Env(), ui && ui->IsMenuOpen(kMenuName));
}

Napi::Value DboMenuApi::Invoke(const Napi::CallbackInfo& info)
{
  auto target = NapiHelper::ExtractString(info[0], "target");
  auto arg = info.Length() > 1 ? NapiHelper::ExtractString(info[1], "arg") : std::string();
  auto tasks = SKSE::GetTaskInterface();
  if (!tasks)
    throw NullPointerException("TaskInterface");
  // Scaleform is touched only on the UI thread, as SKSE's own UI.Invoke does
  tasks->AddUITask([target, arg] {
    auto ui = RE::UI::GetSingleton();
    if (!ui)
      return;
    auto view = ui->GetMovieView(kMenuName);
    if (!view)
      return;
    RE::GFxValue a(arg.c_str());
    view->Invoke(target.c_str(), nullptr, &a, 1);
  });
  return info.Env().Undefined();
}

Napi::Value DboMenuApi::Poll(const Napi::CallbackInfo& info)
{
  std::deque<std::string> lines;
  {
    std::lock_guard l(g_mutex);
    lines.swap(g_queue);
  }
  auto res = Napi::Array::New(info.Env(), lines.size());
  for (size_t i = 0; i < lines.size(); ++i)
    res.Set(static_cast<uint32_t>(i), Napi::String::New(info.Env(), lines[i]));
  return res;
}

void DboMenuApi::HandleSkseMessage(SKSE::MessagingInterface::Message* a_msg)
{
  if (!a_msg || a_msg->type != SKSE::MessagingInterface::kDataLoaded)
    return;
  auto ui = RE::UI::GetSingleton();
  if (!ui) {
    logger::error("DboMenu: no UI at kDataLoaded, the menu is not registered");
    return;
  }
  ui->Register(kMenuName, DboMenu::Create);
  logger::info("DboMenu: registered");
}
