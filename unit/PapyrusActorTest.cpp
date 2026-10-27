#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>

#include "script_classes/PapyrusActor.h"

#include "CropRegeneration.h"

PartOne& GetPartOne();

TEST_CASE("RestoreActorValue", "[Papyrus][Actor][espm]")
{
  PapyrusActor papyrusActor;

  using AV = espm::ActorValue;
  PartOne& p = GetPartOne();
  DoConnect(p, 0);
  p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  p.SetUserActor(0, 0xff000000);
  auto& actor = p.worldState.GetFormAt<MpActor>(0xff000000);
  ActorValues actorValues;
  actorValues.healthPercentage = .5f;
  actorValues.magickaPercentage = .5f;
  actorValues.staminaPercentage = .5f;
  actor.SetPercentages(actorValues);

  papyrusActor.RestoreActorValue(actor.ToVarValue(),
                                 { VarValue("HeaLth"), VarValue(100.f) });
  papyrusActor.RestoreActorValue(actor.ToVarValue(),
                                 { VarValue("stamina"), VarValue(-100.f) });
  papyrusActor.RestoreActorValue(actor.ToVarValue(),
                                 { VarValue("MAGICKA"), VarValue(-25.f) });

  MpChangeForm changeForm = actor.GetChangeForm();

  REQUIRE(changeForm.actorValues.healthPercentage == 1.f);
  REQUIRE(changeForm.actorValues.staminaPercentage == 1.f);
  REQUIRE(changeForm.actorValues.magickaPercentage == .75f);

  p.DestroyActor(0xff000000);
  DoDisconnect(p, 0);
}

TEST_CASE("DamageActorValue", "[Papyrus][Actor][espm]")
{
  PapyrusActor papyrusActor;

  using AV = espm::ActorValue;
  PartOne& p = GetPartOne();
  DoConnect(p, 0);
  p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  p.SetUserActor(0, 0xff000000);
  auto& actor = p.worldState.GetFormAt<MpActor>(0xff000000);
  ActorValues actorValues;
  actorValues.healthPercentage = .5f;
  actorValues.magickaPercentage = .5f;
  actorValues.staminaPercentage = .5f;
  actor.SetPercentages(actorValues);

  papyrusActor.DamageActorValue(actor.ToVarValue(),
                                { VarValue("HeaLth"), VarValue(-25.f) });
  papyrusActor.DamageActorValue(actor.ToVarValue(),
                                { VarValue("stamina"), VarValue(-100.f) });
  papyrusActor.DamageActorValue(actor.ToVarValue(),
                                { VarValue("MAGICKA"), VarValue(100.f) });

  MpChangeForm changeForm = actor.GetChangeForm();

  REQUIRE(changeForm.actorValues.healthPercentage == .25f);
  REQUIRE(changeForm.actorValues.staminaPercentage == 0.f);
  REQUIRE(changeForm.actorValues.magickaPercentage == 0.f);

  p.DestroyActor(0xff000000);
  DoDisconnect(p, 0);
}

TEST_CASE("IsDead()", "[Papyrus][Actor]")
{
  PapyrusActor papyrusActor;
  PartOne& partOne = GetPartOne();
  DoConnect(partOne, 0);
  uint32_t formId = partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);
  auto& actor = partOne.worldState.GetFormAt<MpActor>(formId);
  const bool worldActorDead = actor.IsDead();
  auto papyrusActorDead = static_cast<const bool>(
    papyrusActor.IsDead(actor.ToVarValue(), {}).CastToBool());
  REQUIRE(worldActorDead == papyrusActorDead);
  actor.Kill();
  papyrusActorDead = static_cast<bool>(
    papyrusActor.IsDead(actor.ToVarValue(), {}).CastToBool());
  REQUIRE(papyrusActorDead == true);

  partOne.DestroyActor(formId);
  DoDisconnect(partOne, 0);
}

// The gameplay layer drives hunger and the blessings through Actor.SetActorValue("HealRateMult", ...).
// That used to reach the client alone, so the server kept its starting rate.
TEST_CASE("SetActorValue reaches the server's own actor values",
          "[Papyrus][Actor][espm]")
{
  PapyrusActor papyrusActor;

  PartOne& p = GetPartOne();
  DoConnect(p, 0);
  p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  p.SetUserActor(0, 0xff000000);
  auto& actor = p.worldState.GetFormAt<MpActor>(0xff000000);

  // The two the needs system and the blessings actually send, spelled as they
  // are spelled there. ConvertToAV compares without case.
  papyrusActor.SetActorValue(actor.ToVarValue(),
                             { VarValue("HealRateMult"), VarValue(300.f) });
  papyrusActor.SetActorValue(actor.ToVarValue(),
                             { VarValue("staminaratemult"), VarValue(250.f) });

  MpChangeForm changeForm = actor.GetChangeForm();
  REQUIRE(changeForm.actorValues.healRateMult == 300.f);
  REQUIRE(changeForm.actorValues.staminaRateMult == 250.f);

  p.DestroyActor(0xff000000);
  DoDisconnect(p, 0);
}

// An actor value the server does not model must still change nothing server-side. This is the case the
// old warning was really about - a scripted draugr's Aggression - and it has to keep working.
TEST_CASE("SetActorValue leaves a client-only actor value alone",
          "[Papyrus][Actor][espm]")
{
  PapyrusActor papyrusActor;

  PartOne& p = GetPartOne();
  DoConnect(p, 0);
  p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  p.SetUserActor(0, 0xff000000);
  auto& actor = p.worldState.GetFormAt<MpActor>(0xff000000);

  const ActorValues before = actor.GetChangeForm().actorValues;
  papyrusActor.SetActorValue(actor.ToVarValue(),
                             { VarValue("Aggression"), VarValue(2.f) });
  const ActorValues after = actor.GetChangeForm().actorValues;

  REQUIRE(before.ToTuple() == after.ToTuple());

  p.DestroyActor(0xff000000);
  DoDisconnect(p, 0);
}

// The point of the whole change: the anti-cheat ceiling is computed from the server's rate, so until the
// server saw the raised rate it clawed back every tick the client regenerated above the old one. That is
// the "a blessing destroys my magicka regeneration" report.
TEST_CASE("A raised rate mult raises the regeneration ceiling",
          "[Papyrus][Actor][espm]")
{
  PapyrusActor papyrusActor;

  PartOne& p = GetPartOne();
  DoConnect(p, 0);
  p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  p.SetUserActor(0, 0xff000000);
  auto& actor = p.worldState.GetFormAt<MpActor>(0xff000000);

  ActorValues half;
  half.healthPercentage = .5f;
  half.magickaPercentage = .5f;
  half.staminaPercentage = .5f;
  actor.SetPercentages(half);

  // The client claims a full bar; what comes back is the ceiling the server allows in one second.
  const float ceilingBefore = CropHealthRegeneration(1.0f, 1.0f, &actor);
  const float magickaBefore = CropMagickaRegeneration(1.0f, 1.0f, &actor);

  papyrusActor.SetActorValue(actor.ToVarValue(),
                             { VarValue("HealRateMult"), VarValue(5000.f) });
  papyrusActor.SetActorValue(
    actor.ToVarValue(), { VarValue("MagickaRateMult"), VarValue(5000.f) });

  const float ceilingAfter = CropHealthRegeneration(1.0f, 1.0f, &actor);
  const float magickaAfter = CropMagickaRegeneration(1.0f, 1.0f, &actor);

  REQUIRE(ceilingAfter > ceilingBefore);
  REQUIRE(magickaAfter > magickaBefore);

  // And it is the rate that moved it, not a cap: still short of a full bar.
  REQUIRE(ceilingAfter < 1.0f);

  p.DestroyActor(0xff000000);
  DoDisconnect(p, 0);
}
