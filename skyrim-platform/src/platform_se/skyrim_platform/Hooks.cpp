#include "Hooks.h"
#include "EventHandler.h"
#include <mutex>

namespace hook::internal {

uintptr_t GetAllocationBase(void* ptr)
{
  MEMORY_BASIC_INFORMATION mbi{};
  if (VirtualQuery(ptr, &mbi, sizeof(mbi))) {
    return reinterpret_cast<uintptr_t>(mbi.AllocationBase);
  }
  return 0;
}

std::mutex g_mutex;
std::vector<std::tuple<std::string, std::string, RE::BSScript::IFunction*,
                       uintptr_t, uintptr_t, uintptr_t>>
  g_boundNatives;
}

/**
 * @brief This hooks into the game main cycle
 * which behaves much like "our" tick cycle
 * but with a slight artificial delay between ticks.
 * Is mostly used for testing atm.
 */
struct OnFrameUpdate
{
  static void thunk(std::int64_t unk) { func(unk); };
  static inline REL::Relocation<decltype(&thunk)> func;
};

void InstallOnFrameUpdateHook()
{
  Hooks::write_thunk_call<OnFrameUpdate>(
    Offsets::Hooks::FrameUpdate.address());
}

struct OnConsoleVPrint
{
  static void thunk(void* unk1, const char* msg)
  {
    if (msg) {
      EventHandler::SendEventConsoleMsg(msg);
    }

    func(unk1, msg);
  };
  static inline REL::Relocation<decltype(&thunk)> func;
};

void InstallOnConsoleVPrintHook()
{
  Hooks::write_thunk_call<OnConsoleVPrint>(Offsets::Hooks::VPrint.address());
}

// Jump reads the player's character controller without a null check
struct JumpHandlerProcessButton
{
  static void thunk(RE::JumpHandler* handler, RE::ButtonEvent* event,
                    RE::PlayerControlsData* data)
  {
    auto player = RE::PlayerCharacter::GetSingleton();
    if (!player || !player->GetCharController()) {
      spdlog::warn(
        "JumpHandler: jump ignored, player has no character controller");
      return;
    }
    func(handler, event, data);
  };
  static inline REL::Relocation<decltype(&thunk)> func;
};

void InstallJumpHandlerHook()
{
  REL::Relocation<std::uintptr_t> vtbl{ RE::VTABLE_JumpHandler[0] };
  JumpHandlerProcessButton::func =
    vtbl.write_vfunc(0x4, JumpHandlerProcessButton::thunk);
}

// Actor::Disable (AE id 37267) only queues the disable as BSTaskPool task 0x50, which holds its own reference and runs
// later on a job thread. An actor deleted in between is still disabled by that task with its form id already 0; the
// Disable then builds a MovementControllerNPC for it, the controller finds no actor by that id, and its motion-driven
// update reads through null (AE 41702+0x22, 9 crashes 12-17 Oct). A reference that no longer resolves to itself is on its
// way out and has nothing to disable.
struct QueuedActorDisable
{
  static void thunk(RE::TESObjectREFR* ref)
  {
    if (ref && RE::TESForm::LookupByID(ref->GetFormID()) != ref) {
      spdlog::warn("QueuedActorDisable: skipped a queued Disable on a "
                   "reference that no longer resolves (form id {:X})",
                   ref->GetFormID());
      return;
    }
    func(ref);
  };
  static inline REL::Relocation<decltype(&thunk)> func;
};

// AE 1.6.1170 only: the call in the task dispatcher (id 36991) to the task 0x50 handler (id 37268, a jump to
// TESObjectREFR::Disable). The site is checked before it is patched, so another executable is left alone.
void InstallQueuedActorDisableHook()
{
  if (!REL::Module::IsAE()) {
    return;
  }
  const auto site = REL::ID(36991).address() + 0x1128;
  const auto handler = REL::ID(37268).address();
  const auto bytes = reinterpret_cast<const std::uint8_t*>(site);
  const auto target =
    site + 5 + *reinterpret_cast<const std::int32_t*>(bytes + 1);
  if (bytes[0] != 0xE8 || target != handler) {
    spdlog::warn("QueuedActorDisable: call site not found, hook not installed");
    return;
  }
  Hooks::write_thunk_call<QueuedActorDisable>(site);
}

void BindNativeMethod(RE::BSScript::Internal::VirtualMachine* thisArg,
                      RE::BSScript::IFunction* func);

decltype(&BindNativeMethod) _BindNativeMethod;

void HookVirtualMachineBind()
{
  spdlog::info("Hooking VirtualMachine::Bind");
  REL::Relocation<std::uintptr_t> Vtbl{
    RE::BSScript::Internal::VirtualMachine::VTABLE[0]
  };
  _BindNativeMethod = reinterpret_cast<decltype(_BindNativeMethod)>(
    Vtbl.write_vfunc(0x18, BindNativeMethod));
}

void BindNativeMethod(RE::BSScript::Internal::VirtualMachine* thisArg,
                      RE::BSScript::IFunction* func)
{
  std::stringstream memory;

  for (int i = 0; i < 100; i++) {
    uint8_t* funcPtr = reinterpret_cast<uint8_t*>(func);
    if (i % 8 == 0) {
      memory << std::hex << '[' << (int)i << ']' << ' ';
    }
    memory << std::hex << (int)funcPtr[i] << ' ';
  }

  uint8_t* raw = reinterpret_cast<uint8_t*>(func);
  uintptr_t realFunc = *reinterpret_cast<uintptr_t*>(raw + 0x50);

  uintptr_t moduleBase =
    hook::internal::GetAllocationBase(reinterpret_cast<void*>(realFunc));
  uintptr_t funcOffset = realFunc - moduleBase;

  auto skse = (uintptr_t)GetModuleHandleA("skse64_1_6_1170.dll");

  uintptr_t isLongSignature =
    moduleBase == skse ? *reinterpret_cast<uint8_t*>(raw + 0x58) : 0;

  const char* funcName = func ? func->GetName().data() : "<null func>";
  const char* className =
    func ? func->GetObjectTypeName().data() : "<null IFunction>";
  spdlog::trace("VirtualMachine::Bind called {} {} {} funcOffset={:x}, "
                "realFunc={:x}, moduleBase={:x}",
                className, funcName, memory.str(), funcOffset, realFunc,
                moduleBase);

  if (func) {
    std::lock_guard<std::mutex> lock(hook::internal::g_mutex);
    hook::internal::g_boundNatives.push_back(
      { className, funcName, func, moduleBase, funcOffset, isLongSignature });
  }

  _BindNativeMethod(thisArg, func);
}

std::vector<std::tuple<std::string, std::string, RE::BSScript::IFunction*,
                       uintptr_t, uintptr_t, uintptr_t>>
Hooks::GetBoundNatives()
{
  std::lock_guard<std::mutex> lock(hook::internal::g_mutex);
  return hook::internal::g_boundNatives;
}

void Hooks::Install()
{
  // InstallOnFrameUpdateHook();
  InstallOnConsoleVPrintHook();
  InstallJumpHandlerHook();
  InstallQueuedActorDisableHook();
  HookVirtualMachineBind();

  logger::info("CommonLib hooks installed.");
}
