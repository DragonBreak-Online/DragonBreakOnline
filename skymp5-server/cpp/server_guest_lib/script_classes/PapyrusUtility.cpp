#include "PapyrusUtility.h"

#include "WorldState.h"
#include <TimeUtils.h>
#include <chrono>
#include <random>
#include <spdlog/spdlog.h>
#include <utility>

VarValue PapyrusUtility::Wait(VarValue self,
                              const std::vector<VarValue>& arguments)
{
  return WaitHelper(self, "Wait", arguments);
}

static std::mt19937 g_generator{ std::random_device{}() };

// A script hands us whatever it computed, and std::uniform_int_distribution
// is undefined unless min <= max: libstdc++ takes the range as unsigned, so a
// reversed one wraps to a vast value and its down-scaling branch recurses
// until the stack is gone. That killed the live server at 2026-11-10
// 01:55:12Z with 47 players on, about 105,000 frames deep
// (_work/crash-1110/REPORT.md). Nothing a script can pass may be able to do
// that, so the order is put right here. A call with too few arguments
// answered by reading past the end of the vector, which is the same class of
// fault; it answers 0 now.
VarValue PapyrusUtility::RandomInt(VarValue self,
                                   const std::vector<VarValue>& arguments)
{
  if (arguments.size() < 2) {
    return VarValue(0);
  }
  int32_t min = static_cast<int32_t>(arguments[0].CastToInt());
  int32_t max = static_cast<int32_t>(arguments[1].CastToInt());
  if (min > max) {
    // Once, with the numbers: a swallowed correction would hide the script
    // that computes a backwards range, and on 10 Nov nothing in the log
    // named the call, which is why that script is still unidentified
    static bool warned = false;
    if (!warned) {
      warned = true;
      spdlog::warn("Utility.RandomInt was asked for {}..{}, which is the "
                   "wrong way round; using {}..{}. A script is computing "
                   "that range: find it",
                   min, max, max, min);
    }
    std::swap(min, max);
  }
  std::uniform_int_distribution<> distribute{ min, max };
  return VarValue(distribute(g_generator));
}

// The same two faults: uniform_real_distribution is undefined unless
// min <= max, and the arguments were read without being counted. This one has
// not been seen to crash the server, but it is the same unguarded shape and
// is fixed the same way rather than left to be found later.
VarValue PapyrusUtility::RandomFloat(VarValue self,
                                     const std::vector<VarValue>& arguments)
{
  if (arguments.size() < 2) {
    return VarValue(0.f);
  }
  double min = static_cast<double>(arguments[0].CastToFloat());
  double max = static_cast<double>(arguments[1].CastToFloat());
  if (min > max) {
    static bool warned = false;
    if (!warned) {
      warned = true;
      spdlog::warn("Utility.RandomFloat was asked for {}..{}, which is the "
                   "wrong way round; using {}..{}",
                   min, max, max, min);
    }
    std::swap(min, max);
  }
  std::uniform_real_distribution<> distribute{ min, max };
  return VarValue(distribute(g_generator));
}

VarValue PapyrusUtility::GetCurrentRealTime(
  VarValue self, const std::vector<VarValue>& arguments)
{
  return VarValue(std::chrono::duration<double>(
                    std::chrono::steady_clock::now() -
                    compatibilityPolicy->GetWorldState()->GetStartPoint())
                    .count());
}

VarValue PapyrusUtility::WaitMenuMode(VarValue self,
                                      const std::vector<VarValue>& arguments)
{
  return WaitHelper(self, "WaitMenuMode", arguments);
}

//! In original game this was game hours. We use minutes.
constexpr double fHourSeconds = 60.0;

VarValue PapyrusUtility::WaitGameTime(VarValue self,
                                      const std::vector<VarValue>& arguments)
{
  std::vector<VarValue> modArguments = arguments;
  if (modArguments.size())
    modArguments[0] =
      VarValue(static_cast<double>(modArguments[0]) * fHourSeconds);
  return WaitHelper(self, "WaitGameTime", modArguments);
}

//! There's no MenuMode for multiplayer game
VarValue PapyrusUtility::IsInMenuMode(VarValue self,
                                      const std::vector<VarValue>& arguments)
{
  return VarValue(false);
}

const auto startDay =
  std::chrono::floor<std::chrono::years>(std::chrono::system_clock::now());
/*! This will return days from the start of the year. In original game it
 * returns number of passed game days */
VarValue PapyrusUtility::GetCurrentGameTime(
  VarValue self, const std::vector<VarValue>& arguments)
{
  return VarValue(std::chrono::duration<double, std::ratio<86400, 1>>(
                    std::chrono::system_clock::now() - startDay)
                    .count());
}

//! Using placeholder until we need it to return something real
VarValue PapyrusUtility::GameTimeToString(
  VarValue self, const std::vector<VarValue>& arguments)
{
  return VarValue("01/01/0713 11:11");
}

VarValue PapyrusUtility::CreateAliasArray(
  VarValue self, const std::vector<VarValue>& arguments)
{
  return ArrayHelper(self, "CreateAliasArray", arguments,
                     VarValue::kType_ObjectArray);
}

VarValue PapyrusUtility::CreateBoolArray(
  VarValue self, const std::vector<VarValue>& arguments)
{
  return ArrayHelper(self, "CreateBoolArray", arguments,
                     VarValue::kType_BoolArray);
}

VarValue PapyrusUtility::CreateFloatArray(
  VarValue self, const std::vector<VarValue>& arguments)
{
  return ArrayHelper(self, "CreateFloatArray", arguments,
                     VarValue::kType_FloatArray);
}

VarValue PapyrusUtility::CreateFormArray(
  VarValue self, const std::vector<VarValue>& arguments)
{
  return ArrayHelper(self, "CreateFormArray", arguments,
                     VarValue::kType_ObjectArray);
}

VarValue PapyrusUtility::CreateIntArray(VarValue self,
                                        const std::vector<VarValue>& arguments)
{
  return ArrayHelper(self, "CreateIntArray", arguments,
                     VarValue::kType_IntArray);
}

VarValue PapyrusUtility::ResizeAliasArray(
  VarValue self, const std::vector<VarValue>& arguments)
{
  return ArrayHelper(self, "ResizeAliasArray", arguments,
                     VarValue::kType_ObjectArray, true);
}

VarValue PapyrusUtility::ResizeBoolArray(
  VarValue self, const std::vector<VarValue>& arguments)
{
  return ArrayHelper(self, "ResizeBoolArray", arguments,
                     VarValue::kType_BoolArray, true);
}

VarValue PapyrusUtility::ResizeFloatArray(
  VarValue self, const std::vector<VarValue>& arguments)
{
  return ArrayHelper(self, "ResizeFloatArray", arguments,
                     VarValue::kType_FloatArray, true);
}

VarValue PapyrusUtility::ResizeFormArray(
  VarValue self, const std::vector<VarValue>& arguments)
{
  return ArrayHelper(self, "ResizeFormArray", arguments,
                     VarValue::kType_ObjectArray, true);
}

VarValue PapyrusUtility::ResizeIntArray(VarValue self,
                                        const std::vector<VarValue>& arguments)
{
  return ArrayHelper(self, "ResizeIntArray", arguments,
                     VarValue::kType_IntArray, true);
}

void PapyrusUtility::Register(
  VirtualMachine& vm, std::shared_ptr<IPapyrusCompatibilityPolicy> policy)

{
  compatibilityPolicy = policy;

  AddStatic(vm, "Wait", &PapyrusUtility::Wait);
  AddStatic(vm, "WaitMenuMode", &PapyrusUtility::WaitMenuMode);
  AddStatic(vm, "WaitGameTime", &PapyrusUtility::WaitGameTime);
  AddStatic(vm, "IsInMenuMode", &PapyrusUtility::IsInMenuMode);
  AddStatic(vm, "RandomInt", &PapyrusUtility::RandomInt);
  AddStatic(vm, "RandomFloat", &PapyrusUtility::RandomFloat);
  AddStatic(vm, "GetCurrentRealTime", &PapyrusUtility::GetCurrentRealTime);
  AddStatic(vm, "GetCurrentGameTime", &PapyrusUtility::GetCurrentGameTime);
  AddStatic(vm, "GameTimeToString", &PapyrusUtility::GameTimeToString);
  AddStatic(vm, "CreateAliasArray", &PapyrusUtility::CreateAliasArray);
  AddStatic(vm, "CreateBoolArray", &PapyrusUtility::CreateBoolArray);
  AddStatic(vm, "CreateFloatArray", &PapyrusUtility::CreateFloatArray);
  AddStatic(vm, "CreateFormArray", &PapyrusUtility::CreateFormArray);
  AddStatic(vm, "CreateIntArray", &PapyrusUtility::CreateIntArray);
  AddStatic(vm, "ResizeAliasArray", &PapyrusUtility::ResizeAliasArray);
  AddStatic(vm, "ResizeBoolArray", &PapyrusUtility::ResizeBoolArray);
  AddStatic(vm, "ResizeFloatArray", &PapyrusUtility::ResizeFloatArray);
  AddStatic(vm, "ResizeFormArray", &PapyrusUtility::ResizeFormArray);
  AddStatic(vm, "ResizeIntArray", &PapyrusUtility::ResizeIntArray);
}

VarValue PapyrusUtility::WaitHelper(VarValue& self, const char* funcName,
                                    const std::vector<VarValue>& arguments)
{
  if (arguments.size() < 1)
    throw std::runtime_error(std::string(funcName) +
                             " requires at least 1 argument");
  double seconds = static_cast<double>(arguments[0].CastToFloat());
  if (0.0 > seconds)
    seconds = 0.0;
  auto worldState = compatibilityPolicy->GetWorldState();
  if (!worldState) {
    throw std::runtime_error("worldState not found");
  }

  auto time = Viet::TimeUtils::To<std::chrono::milliseconds>(seconds);
  auto timerPromise = worldState->SetTimer(time);
  auto resultPromise = Viet::Promise<VarValue>();

  timerPromise
    .Then(
      [resultPromise](Viet::Void) { resultPromise.Resolve(VarValue::None()); })
    .Catch([resultPromise](const char* e) { resultPromise.Reject(e); });

  return VarValue(resultPromise);
}

VarValue PapyrusUtility::ArrayHelper(VarValue& self, const char* funcName,
                                     const std::vector<VarValue>& arguments,
                                     VarValue::Type type, bool resize)
{
  //! 'fill' argument should have default value in papyrus function definition
  if ((!resize && arguments.size() < 2) || (resize && arguments.size() < 3))
    throw std::runtime_error(std::string(funcName) + " requires at least " +
                             (resize ? "2 arguments" : "1 argument"));
  int32_t probableSize =
    static_cast<int32_t>(resize ? arguments[1] : arguments[0]);
  if (0 > probableSize)
    throw std::runtime_error(std::string(funcName) +
                             ": array size should be positive number");
  VarValue result(static_cast<uint8_t>(type));
  size_t arraySize = static_cast<uint32_t>(probableSize);
  VarValue fillValue = resize ? arguments[2] : arguments[1];
  result.pArray = std::make_shared<std::vector<VarValue>>();
  if (resize)
    *result.pArray = *arguments[0].pArray;
  result.pArray->resize(arraySize, fillValue);
  return result;
}
