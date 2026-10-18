#include "CopyLifecycleApi.h"

#include <mutex>
#include <unordered_map>

// Why the order matters (AE 1.6.1170 Address Library ids):
// - Actor::Disable (37267, Character vtable slot 0x89) only queues BSTaskPool task 0x50, which runs
//   TESObjectREFR::Disable (19801) later on a job thread, holding its own reference.
// - GarbageCollector::Add (36459) is the real teardown: it takes the reference out of the form map, invalidates
//   its handle and sets its form id to 0. A queued Disable that runs after that crashes (41702+0x22).
// So a copy is disabled first, torn down only after its queued Disable has run, and held by a NiPointer until then.
namespace {
constexpr std::uint32_t kGiveUpFrames = 3600;  // ~60 s of updates: tear down anyway, the 36991 hook is the net
constexpr std::uint32_t kSettleFrames = 2;     // updates between the Disable having run and the teardown
// The old deferred delete also waited for the 3D to go (kill moves, ragdolls: Havok still stepping the copy);
// a copy whose 3D stays is torn down this many updates after its Disable ran
constexpr std::uint32_t kMax3DWaitFrames = 30;

struct Retire
{
  RE::NiPointer<RE::TESObjectREFR> ref;
  RE::FormID id = 0;
  bool disableRan = false;
  std::uint32_t frames = 0;
  std::uint32_t framesSinceDisable = 0;
};

std::mutex g_mutex;
std::unordered_map<RE::TESObjectREFR*, Retire> g_retires;

// Character vtable slot 0x89 is Actor::Disable (37267), checked against the executable; CommonLib's slot comments
// around there are off by one, so its Disable() wrapper is not used
void QueueDisable(RE::TESObjectREFR* ref)
{
  using func_t = void (*)(RE::TESObjectREFR*);
  const auto vtbl = *reinterpret_cast<std::uintptr_t**>(ref);
  reinterpret_cast<func_t>(vtbl[0x89])(ref);
}

void TearDown(RE::TESObjectREFR* ref)
{
  using func_t = void (*)(void*, RE::TESObjectREFR*, bool);
  static REL::Relocation<void**> collector{ REL::ID(400329) };
  static REL::Relocation<func_t> add{ REL::ID(36459) };
  if (*collector) {
    add(*collector, ref, true);
  }
}
}

// retireCopy(localFormId): true when the native path took the copy, false when the caller should use its own
Napi::Value CopyLifecycleApi::RetireCopy(const Napi::CallbackInfo& info)
{
  const auto id = NapiHelper::ExtractUInt32(info[0], "localFormId");
  auto env = info.Env();
  if (!REL::Module::IsAE() || id < 0xFF000000) {
    return Napi::Boolean::New(env, false);
  }
  auto ref = RE::TESForm::LookupByID<RE::TESObjectREFR>(id);
  if (!ref || ref->GetFormType() != RE::FormType::ActorCharacter ||
      ref->IsDeleted() || ref == RE::PlayerCharacter::GetSingleton()) {
    return Napi::Boolean::New(env, false);
  }
  {
    std::lock_guard lock(g_mutex);
    if (g_retires.count(ref)) {
      return Napi::Boolean::New(env, true);
    }
    Retire r;
    r.ref = RE::NiPointer<RE::TESObjectREFR>(ref);
    r.id = id;
    // Already disabled: no task will be queued, nothing to wait for
    r.disableRan = ref->IsDisabled();
    g_retires.emplace(ref, std::move(r));
  }
  QueueDisable(ref);
  return Napi::Boolean::New(env, true);
}

// processCopyRetires(): called once per update; tears down every copy whose Disable has run and returns
// [{ id, frames, how }] for each one torn down, how = "disabled" | "gave-up"
Napi::Value CopyLifecycleApi::ProcessCopyRetires(const Napi::CallbackInfo& info)
{
  auto env = info.Env();
  auto out = Napi::Array::New(env);
  std::vector<Retire> ready;
  std::vector<const char*> how;
  {
    std::lock_guard lock(g_mutex);
    for (auto it = g_retires.begin(); it != g_retires.end();) {
      auto& r = it->second;
      ++r.frames;
      if (r.disableRan) {
        ++r.framesSinceDisable;
      }
      const bool settled = r.disableRan &&
        r.framesSinceDisable > kSettleFrames &&
        (!r.ref->Get3D() || r.framesSinceDisable > kMax3DWaitFrames);
      if (settled || r.frames > kGiveUpFrames) {
        how.push_back(settled ? "disabled" : "gave-up");
        ready.push_back(std::move(r));
        it = g_retires.erase(it);
      } else {
        ++it;
      }
    }
  }
  for (size_t i = 0; i < ready.size(); ++i) {
    auto& r = ready[i];
    // Something else (an area unload) may have torn it down already
    if (r.ref->GetFormID() == r.id && !r.ref->IsDeleted()) {
      TearDown(r.ref.get());
    }
    auto entry = Napi::Object::New(env);
    entry.Set("id", Napi::Number::New(env, r.id));
    entry.Set("frames", Napi::Number::New(env, r.frames));
    entry.Set("how", Napi::String::New(env, how[i]));
    out.Set(static_cast<uint32_t>(i), entry);
  }
  return out;
}

// isCopyRetiring(localFormId): true while that exact object is waiting to be torn down. Keyed by the object, not the
// id, so a new copy that reuses a retired copy's local id (they come back within seconds) reads false
Napi::Value CopyLifecycleApi::IsCopyRetiring(const Napi::CallbackInfo& info)
{
  const auto id = NapiHelper::ExtractUInt32(info[0], "localFormId");
  auto ref = RE::TESForm::LookupByID<RE::TESObjectREFR>(id);
  std::lock_guard lock(g_mutex);
  return Napi::Boolean::New(info.Env(), ref && g_retires.count(ref) > 0);
}

void CopyLifecycleApi::OnQueuedDisableRan(RE::TESObjectREFR* ref)
{
  std::lock_guard lock(g_mutex);
  auto it = g_retires.find(ref);
  if (it != g_retires.end()) {
    it->second.disableRan = true;
  }
}
