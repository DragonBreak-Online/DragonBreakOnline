#pragma once
#include <cstdint>

class MpActor;

// The cast check ActionListener::OnSpellCast applies to a player's spell, shared with unit/HowlCastTest.cpp
namespace SpellCastRules {
bool CanCastSpell(const MpActor& actor, uint32_t spellId);
}
