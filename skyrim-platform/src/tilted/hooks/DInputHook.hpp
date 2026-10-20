#pragma once

#include <Stl.hpp>
#include <functional>
#include <memory>
#include <mutex>

class IInputListener;

namespace CEFUtils {
struct DInputHook
{
  static bool& ChromeFocus()
  {
    static bool chromeFocus;
    return chromeFocus;
  }

  // The mouse may leave the game window (MouseApi, setMouseFree): the game's menu cursor follows the Windows cursor
  // instead, so the device's movement is not handed to the game as well. Main thread only
  static bool& MouseFree()
  {
    static bool mouseFree;
    return mouseFree;
  }

  struct
  {
    std::mutex m;
    std::vector<std::function<void()>> tasks;
  } share;

  void Task(std::function<void()> f)
  {
    std::lock_guard<std::mutex> l(share.m);
    share.tasks.push_back(f);
  }

  void RunTasks()
  {
    std::vector<std::function<void()>> tasks_;
    {
      std::lock_guard<std::mutex> l(share.m);
      tasks_ = share.tasks;
    }
    for (auto& t : tasks_)
      t();
  }

  TP_NOCOPYMOVE(DInputHook);

  void SetEnabled(bool aEnabled) noexcept
  {
    m_enabled = aEnabled;
    Update();
  }
  [[nodiscard]] bool IsEnabled() const noexcept { return m_enabled; }
  void SetToggleKeys(std::initializer_list<unsigned long> aKeys) noexcept;
  [[nodiscard]] bool IsToggleKey(unsigned int aKey) const noexcept;

  void Acquire() const noexcept;
  void Unacquire() const noexcept;

  static void Install(std::shared_ptr<IInputListener> listener) noexcept;
  static DInputHook& Get() noexcept;

  void Update() const noexcept;

private:
  DInputHook() noexcept;
  ~DInputHook() = default;

  Set<unsigned long> m_toggleKeys;

  bool m_enabled{ false };
};
}
