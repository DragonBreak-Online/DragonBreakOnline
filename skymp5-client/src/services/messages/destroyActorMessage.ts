import { MsgType } from "../../messages";

export interface DestroyActorMessage {
    t: MsgType.DestroyActor,
    idx: number;
    // The form the destroy is about. Optional: a server older than this field simply omits it.
    // Without it the client cannot say WHICH form ejected a player to the main menu, which is
    // exactly what went unanswered on 2026-10-13.
    formId?: number;
}
