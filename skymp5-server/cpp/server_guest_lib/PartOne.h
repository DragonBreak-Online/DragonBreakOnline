#pragma once
#include "AnimationSystem.h"
#include "FormDesc.h"
#include "GamemodeApi.h"
#include "HitData.h"
#include "MpActor.h"
#include "MpChangeForms.h"
#include "NiPoint3.h"
#include "PartOneListener.h"
#include "ServerState.h"
#include "SpellCastData.h"
#include "UpdateMovementMessage.h"
#include "WorldState.h"
#include "formulas/IDamageFormula.h"
#include "libespm/Loader.h"
#include <functional>
#include <memory>
#include <nlohmann/json.hpp>
#include <save_storages/ISaveStorage.h>
#include <set>
#include <simdjson.h>
#include <spdlog/logger.h>

using ProfileId = int32_t;
class ActionListener;
class MessageSerializer;

class PartOneSendTargetWrapper : public Networking::ISendTarget
{
public:
  explicit PartOneSendTargetWrapper(
    Networking::ISendTarget& underlyingSendTarget_);

  void Send(Networking::UserId targetUserId, Networking::PacketData data,
            size_t length, bool reliable) override;

  void Send(Networking::UserId targetUserId, const IMessageBase& message,
            bool reliable);

private:
  Networking::ISendTarget& underlyingSendTarget;
};

class PartOne
{
public:
  struct Message
  {
    nlohmann::json j;
    std::shared_ptr<IMessageBase> message;
    Networking::UserId userId = Networking::InvalidUserId;
    bool reliable = false;
  };

  using Listener = PartOneListener;

  PartOne(Networking::ISendTarget* sendTarget = nullptr);
  PartOne(std::shared_ptr<Listener> listener,
          Networking::ISendTarget* sendTarget = nullptr);
  ~PartOne();

  void SetSendTarget(Networking::ISendTarget* sendTarget);
  void SetDamageFormula(std::unique_ptr<IDamageFormula> dmgFormula);
  void AddListener(std::shared_ptr<Listener> listener);
  bool IsConnected(Networking::UserId userId) const;
  void Tick();

  // TickStaleHosts' timings. Settable so a test can drive the sweep in
  // milliseconds instead of waiting staleHostAfter of real time; changing them
  // for the server needs a native rebuild. staleHostAfter: no movement for
  // this long and the hoster loses the NPC. staleReleaseCooldown: the shortest
  // gap between REPEAT releases of the SAME NPC. The first release is always
  // immediate, so the cases this sweep exists for - a hoster that unloaded an
  // NPC, the ogre that would not fight back - are rescued as fast as before.
  // It is the second and later releases of one NPC that are rate-limited,
  // because that is the loop: an NPC standing still never moves, so before
  // this it was released every staleHostAfter, which set its host to 0 and
  // made every nearby client ask for it again (measured at Nat's Bruma
  // event: 4.7 releases/min x ~65-94 clients, the 441.8 host attempts and
  // 306.9 "not a hoster" errors a minute in _work\perf-1031\NOTE.md).
  std::chrono::milliseconds staleHostAfter{ 5000 };
  std::chrono::milliseconds staleReleaseCooldown{ 30000 };
  std::chrono::milliseconds staleHostSweepEvery{ 1000 };
  // A silent NPC keeps a hoster that is online, in its cell or world and
  // within staleExemptRange units, for up to staleExemptFor of silence; 0
  // range turns the exemption off
  float staleExemptRange = 4096.f;
  std::chrono::milliseconds staleExemptFor{ 120000 };
  // Called by ReleaseHost before it marks the NPC unhosted; one that sets a
  // new hoster skips the unhosted broadcast. Fires the gamemode's
  // mp.onHostRelease(remoteId, oldHosterId) unless a test replaces it
  std::function<void(uint32_t remoteId, uint32_t oldHosterId)> hostReleaseHook;
  FormCallbacks CreateFormCallbacks();
  ActionListener& GetActionListener();
  const std::vector<std::shared_ptr<Listener>>& GetListeners() const;
  std::vector<Message>& Messages();

  // API
  uint32_t CreateActor(uint32_t formId, const NiPoint3& pos, float angleZ,
                       uint32_t cellOrWorld, ProfileId profileId = -1);
  void SetUserActor(Networking::UserId userId, uint32_t actorFormId);
  uint32_t GetUserActor(Networking::UserId userId);
  std::string GetUserGuid(Networking::UserId userId);
  Networking::UserId GetUserByActor(uint32_t formId);
  void DestroyActor(uint32_t actorFormId);
  void SetRaceMenuOpen(uint32_t formId, bool open);
  void SendCustomPacket(Networking::UserId userId,
                        const std::string& jContent);
  std::string GetActorName(uint32_t actorFormId);
  NiPoint3 GetActorPos(uint32_t actorFormId);
  uint32_t GetActorCellOrWorld(uint32_t actorFormId);
  const std::set<uint32_t>& GetActorsByProfileId(ProfileId profileId);
  void SetEnabled(uint32_t actorFormId, bool enabled);

  using OnActorStreamIn = std::function<void(const MpActor& emitter,
                                             const MpObjectReference& listener,
                                             CreateActorMessage& message)>;
  void SetOnActorStreamIn(OnActorStreamIn callback);

  void AttachEspm(espm::Loader* espm);
  void AttachSaveStorage(
    std::shared_ptr<
      Viet::ISaveStorage<MpChangeForm, FormDesc, std::vector<FormDesc>>>
      saveStorage);
  espm::Loader& GetEspm() const;
  bool HasEspm() const;
  void AttachLogger(std::shared_ptr<spdlog::logger> logger);
  spdlog::logger& GetLogger();

  static void HandlePacket(void* partOneInstance, Networking::UserId userId,
                           Networking::PacketType packetType,
                           Networking::PacketData data, size_t length);

  WorldState worldState;
  ServerState serverState;
  AnimationSystem animationSystem;

  PartOneSendTargetWrapper& GetSendTarget() const;

  float CalculateDamage(const MpActor& aggressor, const MpActor& target,
                        const HitData& hitData) const;

  float CalculateDamage(const MpActor& aggressor, const MpActor& target,
                        const SpellCastData& spellCastData) const;

  void NotifyGamemodeApiStateChanged(
    const GamemodeApi::State& newState) noexcept;

  void SetPrivateKey(const std::string& keyId, const std::string& pkeyPem);

  void EnableGamemodeDataUpdatesBroadcast(bool enable);

  void SetPacketHistoryRecording(Networking::UserId userId, bool value);
  PacketHistory GetPacketHistory(Networking::UserId userId);
  void ClearPacketHistory(Networking::UserId userId);
  void RequestPacketHistoryPlayback(Networking::UserId userId,
                                    const PacketHistory& history);

  // Makes newHosterId (an online player's actor, or 0 for nobody) the one
  // client that drives remoteId: HostStart to the new hoster, HostStop to the
  // old, isHostedByOther to every listener. Used by OnHostAttempt and by the
  // gamemode's mp.setHoster (NPC system v2: the server picks hosts). Throws if
  // either form is not what it should be.
  void AssignHoster(uint32_t remoteId, uint32_t newHosterId);

  void SendHostStop(Networking::UserId badHosterUserId,
                    MpObjectReference& remote);

  // An NPC the SERVER drives itself (Option B,
  // _work\server-npc-movement-1102.md). The gameplay layer sets the tag -
  // serverhostpin.js, and later the mover - and three things here read it: a
  // host attempt for it is refused, the stale sweep leaves it alone, and
  // clients are told isHostedByOther so they never ask.
  //
  // Why a change-form property and not a sentinel in worldState.hosters: a
  // made-up hoster id would be looked up as an actor by UserByActor,
  // SendHostStop, HosterInReach and the health resync, each of which would see
  // a form that is not there and treat the NPC as having a disconnected
  // hoster. The tag adds no state to reason about, survives a restart and a
  // gamemode reload, and can be set and cleared from hot-reloadable JS - which
  // a compile-time constant cannot. It is read through GetDynamicFields(), a
  // const reference, so the stale sweep's loop over every hoster costs a map
  // lookup and a string compare per NPC, not a ChangeForm copy.
  static const char* GetServerDrivenProperty() noexcept
  {
    return "private.dboServerHost";
  }
  static bool IsServerDriven(const MpObjectReference& remote);

  // Moves a server-driven NPC: one UpdateMovement to each watching player, and
  // the server's own copy moved to match. The gameplay layer owns when and
  // where; this is the part it cannot do itself. Throws if the NPC is not
  // tagged server-driven. The cell comes from the actor, never from the
  // caller.
  void SendServerMovement(uint32_t npcId,
                          const UpdateMovementMessage::Data& data);

  static MessageSerializer& GetMessageSerializerInstance();

private:
  void Init();

  enum class UserType
  {
    User,
    Bot
  };

  void AddUser(Networking::UserId userId, UserType userType,
               const std::string& guid);

  void HandleMessagePacket(Networking::UserId userId,
                           Networking::PacketData data, size_t length);

  void InitActionListener();

  void TickPacketHistoryPlaybacks();
  void TickDeferredMessages();
  // Drops the hosting state of a reference WorldState is about to destroy
  void BeforeRefrDestroy(MpObjectReference& refr);
  // Frees NPCs whose hoster stopped sending their movement, so a player who
  // has them loaded can take over
  void TickStaleHosts();
  bool HosterInReach(const MpObjectReference& remote, uint32_t hosterId);
  std::chrono::system_clock::time_point lastStaleHostSweep;
  // NPC -> (hoster, when the sweep first saw that hoster), for hosters with no
  // movement stamp yet
  std::unordered_map<
    uint32_t, std::pair<uint32_t, std::chrono::system_clock::time_point>>
    hostSeenSince;
  // NPC -> when the sweep last took it from a hoster for staleness, for the
  // repeat-release cooldown
  std::unordered_map<uint32_t, std::chrono::system_clock::time_point>
    staleReleasedAt;

  // Takes remote from its hoster: HostStop to the hoster's user,
  // isHostedByOther=false to the players who see it
  void ReleaseHost(MpObjectReference& remote, const std::string& reason);
  // Releases every reference hostered by hosterId
  void ReleaseHostedBy(uint32_t hosterId, const std::string& reason);
  // Applies the releases queued on unsubscribe, unless the hoster was
  // subscribed again meanwhile
  void TickHostReleases();
  struct PendingHostRelease
  {
    uint32_t remoteId = 0;
    uint32_t remoteIdx = 0;
    uint32_t hosterId = 0;
  };
  std::vector<PendingHostRelease> pendingHostReleases;

  std::string SignJavaScriptSources(const std::string& src) const;

  struct Impl;
  std::shared_ptr<Impl> pImpl;
};
