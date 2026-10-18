#include "Hooks.h"
#include "CopyLifecycleApi.h"
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
    CopyLifecycleApi::OnQueuedDisableRan(ref);
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
  spdlog::info("QueuedActorDisable: hook installed");
}

// The face morph job (AE id 26999) holds its own reference to a head's BSFaceGenNiNode and runs on a job thread. When the
// head is rebuilt or unloaded before it runs, the node is detached (parent null), and the morph update (26988) calls a
// virtual on that parent without a null check (26988+0x399, 29 crashes 3-13 Oct). A detached head is not drawn, so its
// update is skipped.
struct FaceMorphJobUpdate
{
  static void thunk(RE::NiAVObject* faceNode, bool a_arg)
  {
    if (faceNode && !faceNode->parent) {
      return;
    }
    func(faceNode, a_arg);
  };
  static inline REL::Relocation<decltype(&thunk)> func;
};

// AE 1.6.1170 only: the job's one call to the morph update, checked before it is patched
void InstallFaceMorphJobHook()
{
  if (!REL::Module::IsAE()) {
    return;
  }
  const auto site = REL::ID(26999).address() + 0x13;
  const auto update = REL::ID(26988).address();
  const auto bytes = reinterpret_cast<const std::uint8_t*>(site);
  const auto target =
    site + 5 + *reinterpret_cast<const std::int32_t*>(bytes + 1);
  if (bytes[0] != 0xE8 || target != update) {
    spdlog::warn("FaceMorphJobUpdate: call site not found, hook not installed");
    return;
  }
  Hooks::write_thunk_call<FaceMorphJobUpdate>(site);
  spdlog::info("FaceMorphJobUpdate: hook installed");
}

// TESTrapListener updates each trap's hit on a target through TrapTargetEntry vtable slot 1 (AE 26032), which reads the
// trap's Havok object (TrapEntry +0x18) without checking that the trap still exists. A trap whose reference was
// deleted, disabled or unloaded under a live hit (a RemovableTorch01's flame, 16 Oct) leaves that object freed, and
// 26034+0x1C1 reads through it. The slot already reports "done" (*a_done = 1) when the target is gone; a trap that no
// longer resolves, or has no 3D, gets the same answer.
struct TrapTargetUpdate
{
  static void thunk(void* a_target, void* a_trap, std::uint8_t* a_done)
  {
    if (a_trap) {
      const auto handle = *reinterpret_cast<const RE::RefHandle*>(
        reinterpret_cast<std::uintptr_t>(a_trap) + 0x20);
      auto ref = RE::TESObjectREFR::LookupByHandle(handle);
      if (!ref || ref->IsDisabled() || ref->IsDeleted() || !ref->Get3D()) {
        if (a_done) {
          *a_done = 1;
        }
        return;
      }
    }
    func(a_target, a_trap, a_done);
  };
  static inline REL::Relocation<decltype(&thunk)> func;
};

// The animation file manager's completion job (AE 63997, called from 63974 and 63980) walks its load requests and calls
// each active one back through a raw pointer: a function (+0x48) or a listener's vtable slot 1 (+0x40). A listener freed
// while its load was pending (an animation graph torn down with its actor) leaves that pointer dangling, and the call
// jumps to address 0 (crash 17 Oct, 63997+0xC4). Before the job runs, a request whose callback does not lead into a
// loaded module is marked inactive (+0x60), which every loop of the job checks, so it is neither locked nor called.
namespace AnimLoadGuard {
bool InModule(std::uintptr_t p)
{
  HMODULE m = nullptr;
  return p && GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                                   GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                                 reinterpret_cast<LPCSTR>(p), &m) &&
    m;
}

bool CallbackValid(std::uintptr_t req)
{
  const auto fn = *reinterpret_cast<std::uintptr_t*>(req + 0x48);
  if (fn) {
    return InModule(fn);
  }
  const auto listener = *reinterpret_cast<std::uintptr_t*>(req + 0x40);
  if (!listener || IsBadReadPtr(reinterpret_cast<void*>(listener), 8)) {
    return false;
  }
  const auto vtbl = *reinterpret_cast<std::uintptr_t*>(listener);
  if (!InModule(vtbl) || IsBadReadPtr(reinterpret_cast<void*>(vtbl), 16)) {
    return false;
  }
  return InModule(*reinterpret_cast<std::uintptr_t*>(vtbl + 8));
}
}

struct AnimLoadJob
{
  static std::uint64_t thunk(std::uintptr_t job)
  {
    if (job) {
      const auto count = *reinterpret_cast<std::uint32_t*>(job + 0x98);
      const auto reqs = *reinterpret_cast<std::uintptr_t**>(job + 0x88);
      for (std::uint32_t i = 0; reqs && i < count; ++i) {
        const auto req = reqs[i];
        if (req && *reinterpret_cast<std::uint8_t*>(req + 0x60) &&
            !AnimLoadGuard::CallbackValid(req)) {
          *reinterpret_cast<std::uint8_t*>(req + 0x60) = 0;
          spdlog::warn("AnimLoadJob: skipped a load request whose listener "
                       "no longer exists");
        }
      }
    }
    return func(job);
  };
  static inline REL::Relocation<decltype(&thunk)> func;
};

void InstallAnimLoadJobHook()
{
  if (!REL::Module::IsAE()) {
    return;
  }
  const auto job = REL::ID(63997).address();
  const std::uintptr_t sites[] = { REL::ID(63974).address() + 0x22a,
                                   REL::ID(63980).address() + 0x1a0 };
  for (const auto site : sites) {
    const auto bytes = reinterpret_cast<const std::uint8_t*>(site);
    if (bytes[0] != 0xE8 ||
        site + 5 + *reinterpret_cast<const std::int32_t*>(bytes + 1) != job) {
      spdlog::warn("AnimLoadJob: call site not found, hook not installed");
      return;
    }
  }
  for (const auto site : sites) {
    Hooks::write_thunk_call<AnimLoadJob>(site);
  }
  spdlog::info("AnimLoadJob: hook installed");
}

void InstallTrapTargetHook()
{
  if (!REL::Module::IsAE()) {
    return;
  }
  REL::Relocation<std::uintptr_t> vtbl{ RE::VTABLE_TrapTargetEntry[0] };
  if (vtbl.address() == 0 ||
      *reinterpret_cast<std::uintptr_t*>(vtbl.address() + 8) !=
        REL::ID(26032).address()) {
    spdlog::warn("TrapTargetUpdate: vtable slot not found, hook not installed");
    return;
  }
  TrapTargetUpdate::func = vtbl.write_vfunc(1, TrapTargetUpdate::thunk);
  spdlog::info("TrapTargetUpdate: hook installed");
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
  InstallFaceMorphJobHook();
  InstallTrapTargetHook();
  InstallAnimLoadJobHook();
  HookVirtualMachineBind();

  logger::info("CommonLib hooks installed.");
}
