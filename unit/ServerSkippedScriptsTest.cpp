#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>

#include "MpObjectReference.h"

TEST_CASE("The arrow volley script never runs server-side",
          "[MpObjectReference][Papyrus]")
{
  REQUIRE(MpObjectReference::IsServerSkippedScript(
    "CWArrowVolleyParentScript"));
  REQUIRE(MpObjectReference::IsServerSkippedScript(
    "cwarrowvolleyparentscript"));
}

TEST_CASE("Earlier skipped scripts stay skipped",
          "[MpObjectReference][Papyrus]")
{
  for (const char* name :
       { "DA06PreRitualSceneTriggerScript", "CritterSpawn",
         "PlayerBookShelfContainerScript", "fxDustDropRandomSCRIPT",
         "MineOreScript", "manny_up_noticeboardScript" }) {
    INFO(name);
    REQUIRE(MpObjectReference::IsServerSkippedScript(name));
  }
}

TEST_CASE("Other scripts are not skipped", "[MpObjectReference][Papyrus]")
{
  REQUIRE(!MpObjectReference::IsServerSkippedScript("CWArrowVolley"));
  REQUIRE(!MpObjectReference::IsServerSkippedScript(
    "CWArrowVolleyChildScript"));
  REQUIRE(!MpObjectReference::IsServerSkippedScript("Critter"));
  REQUIRE(!MpObjectReference::IsServerSkippedScript(""));
}
