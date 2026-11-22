/**
 * The three avatar flags (avatarDetailBudget, avatarZeroWork, avatarBake) are on by default and each is turned off by the
 * value "0" in localStorage. A suite that specifies one of the supported off paths sets the flags it needs here, and
 * clears them in its afterEach (`localStorage.clear()`), so that the flags are independent in the test as in the product.
 */
export type AvatarFlag = "avatarDetailBudget" | "avatarZeroWork" | "avatarBake";

export function setAvatarFlags(flags: Partial<Record<AvatarFlag, boolean>>): void {
    for (const [key, on] of Object.entries(flags)) {
        localStorage.setItem(key, on ? "1" : "0");
    }
}
