import { ClientListener, CombinedController, Sp } from "./clientListener";

// The server refuses SweetCantDrop items itself (ActionListener OnDropItem, OnPutItem); this only saves the round trip
export class SweetTaffySweetCantDropService extends ClientListener {
    constructor(private sp: Sp, private controller: CombinedController) {
        super();
    }

    // A keyword the load order lacks marks nothing: HasKeyword(None) is true for any potion or ingredient with a keywordless Peak Value Modifier effect (salt, Aversion poisons, Waterbreathing)
    public canDropOrPutItem(itemId: number): boolean {
        const keyword = this.sp.Keyword.getKeyword(this.cantDropKeyword);
        if (!keyword) {
            return true;
        }
        const item = this.sp.Game.getFormEx(itemId);
        return !(item !== null && item.hasKeyword(keyword));
    }

    private cantDropKeyword = "SweetCantDrop";
}
