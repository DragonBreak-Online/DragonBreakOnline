Scriptname RemovableTorchSconce01SCRIPT extends ObjectReference Hidden
{DragonBreak server override of the vanilla torch sconce (server\data\scripts, loaded before the game's archives).
The vanilla script remembers its torch only in PlacedTorch, which the SkyMP server does not save, so after every
restart each sconce placed another torch on top of the old ones (155 torches at 65 sconces locally, 18 Oct): taking
one left an enabled older torch behind that could not be taken. When the sconce has no record of its torch, it first
removes every torch at its spot, then places one. Everything else is the vanilla script.}

import debug

Light Property Torch01 Auto
{The Torch01 we look for in the players inventory}

Activator Property RemovableTorch01 Auto
{Base object for torch activator that gets placed}

Bool Property StartsEmpty Auto
{If this is TRUE the sconce will start empty.  Default = FALSE}

Bool Property TorchInSconce = TRUE Auto Hidden
{TRUE when there is a torch in the sonce, FALSE when there isn't.  Default = TRUE}

ObjectReference Property PlacedTorch Auto Hidden
{A way to refer to the torch after it's been placed at the sconce}

Sound Property ITMGenericUp Auto
Sound Property ITMGenericDown Auto

; Torches left at this sconce by earlier server runs. Capped, in case a deleted torch is still found
Function ClearStackedTorches()
	int guard = 0
	ObjectReference t = Game.FindClosestReferenceOfTypeFromRef(RemovableTorch01, Self, 64.0)
	while (t && guard < 8)
		t.Disable()
		t.Delete()
		guard += 1
		t = Game.FindClosestReferenceOfTypeFromRef(RemovableTorch01, Self, 64.0)
	endwhile
EndFunction

EVENT OnCellLoad()
	if (StartsEmpty == FALSE && !IsDisabled())
		if (PlacedTorch)
			PlacedTorch.Enable()
		else
			ClearStackedTorches()
			PlacedTorch = Self.PlaceAtMe(RemovableTorch01)
		endif
		EnableLinkChain()
		GoToState("HasTorch")
	elseif (StartsEmpty == FALSE && IsDisabled())
		if (PlacedTorch)
			PlacedTorch.Disable()
		else
			ClearStackedTorches()
		endif
		DisableLinkChain()
		goToState("AwaitingActivation")
	else
		if (!PlacedTorch)
			ClearStackedTorches()
		endif
		DisableLinkChain()
		GoToState("NoTorch")
	endif
EndEVENT

Function RemoveTorch()
	PlacedTorch.Disable()
	DisableLinkChain()
	GoToState("NoTorch")
EndFunction

STATE HasTorch
	EVENT onActivate(ObjectReference TriggerRef)
		GoToState("Busy")
		PlacedTorch.Disable()
		DisableLinkChain()
		TriggerRef.AddItem(Torch01)
		int TorchTaken = ITMGenericUp.Play(self)
		GoToState("NoTorch")
	EndEVENT
EndState

STATE NoTorch
	EVENT onActivate(ObjectReference TriggerRef)
		if TriggerRef.GetItemCount(Torch01) > 0
			GoToState("Busy")
			if (PlacedTorch)
				PlacedTorch.Enable()
			else
				ClearStackedTorches()
				PlacedTorch = Self.PlaceAtMe(RemovableTorch01)
			endif
			TriggerRef.RemoveItem(Torch01)
			EnableLinkChain()
			int TorchPlaced = ITMGenericDown.Play(self)
			GoToState("HasTorch")
		endif
	EndEVENT
EndState

STATE Busy
	;Do Nothing
EndState

STATE AwaitingActivation
	Event OnActivate(ObjectReference obj)
		Self.Enable()
		OnCellLoad()
	EndEvent
EndState
