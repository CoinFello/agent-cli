import { Delegation } from "@metamask/smart-accounts-kit";

export interface SignedSubdelegation extends Delegation {
    signature: `0x${string}`
}
