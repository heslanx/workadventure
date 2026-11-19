/**
 * The detail budget of a crowd: how many remote avatars the scene draws in full. The others are drawn as dots (see
 * AvatarDotLayer), so a whole-map view of a thousand people costs about what a view of a hundred does.
 *
 * This file holds the decision only. It reads no scene and no clock, so the same inputs give the same answer.
 */

/** Off by default. `localStorage["avatarDetailBudget"]` set to "1" turns it on for A/B runs, "0" turns it off. */
export const AVATAR_DETAIL_BUDGET_ENABLED = false;
export const AVATAR_DETAIL_STORAGE_KEY = "avatarDetailBudget";

/** How many remote avatars in the camera view stay full. Below it, nothing changes. */
export const AVATAR_DETAIL_BUDGET = 80;

/**
 * A full avatar keeps its place unless another one is this much closer (as a ratio of distances), so that two avatars
 * at about the same distance at the edge of the budget do not swap at every recompute.
 */
export const DETAIL_HYSTERESIS_RATIO = 1.25;
const HYSTERESIS_SQ = DETAIL_HYSTERESIS_RATIO * DETAIL_HYSTERESIS_RATIO;

/** Below this zoom modifier, the name tags are hidden, as one write on their layer. */
export const NAME_TAGS_MIN_ZOOM_MODIFIER = 0.65;

/** Recompute this often while nothing else asks for it: the player and the crowd move. */
export const DETAIL_RECOMPUTE_INTERVAL_MS = 250;
/** Recompute this long after the zoom last changed. */
export const DETAIL_ZOOM_SETTLE_MS = 150;

export type AvatarDetailLevel = "full" | "dot";

/** One remote avatar, as the budget sees it. */
export interface DetailCandidate<K> {
    readonly key: K;
    /** The squared distance to the local player, in world pixels. */
    readonly distanceSq: number;
    /** Whether it is in the camera view, i.e. not culled. */
    readonly inView: boolean;
    /** Hovered, followed or in the player's bubble: it stays full whatever the budget. */
    readonly pinned: boolean;
}

/**
 * The avatars that stay full.
 *
 * The pinned avatars are always full. Then, up to `budget` avatars in all, the avatars in the view nearest the player,
 * then the nearest outside it (so that they are full when they walk in, if the view leaves room). Everyone else is a
 * dot. So with at most `budget` avatars in the view, every one of them is full, as without a budget.
 *
 * An avatar that was full (`previousFull`) ranks as if it were DETAIL_HYSTERESIS_RATIO times closer than it is.
 */
export function chooseFullDetail<K>(
    candidates: readonly DetailCandidate<K>[],
    previousFull: ReadonlySet<K>,
    budget: number = AVATAR_DETAIL_BUDGET,
): Set<K> {
    const full = new Set<K>();
    const ranked: { key: K; inView: boolean; rank: number }[] = [];
    for (const candidate of candidates) {
        if (candidate.pinned) {
            full.add(candidate.key);
        } else {
            ranked.push({
                key: candidate.key,
                inView: candidate.inView,
                rank: previousFull.has(candidate.key) ? candidate.distanceSq / HYSTERESIS_SQ : candidate.distanceSq,
            });
        }
    }
    if (full.size + ranked.length <= budget) {
        for (const { key } of ranked) {
            full.add(key);
        }
        return full;
    }
    ranked.sort((a, b) => (a.inView === b.inView ? a.rank - b.rank : a.inView ? -1 : 1));
    for (let i = 0; i < ranked.length && full.size < budget; i++) {
        full.add(ranked[i].key);
    }
    return full;
}

/** Whether the detail budget is on: the constant, unless this browser's storage says otherwise. */
export function isAvatarDetailBudgetEnabled(storage: Pick<Storage, "getItem"> | undefined = globalStorage()): boolean {
    try {
        const value = storage?.getItem(AVATAR_DETAIL_STORAGE_KEY);
        if (value === "1") return true;
        if (value === "0") return false;
    } catch {
        // Storage can be blocked; the constant decides.
    }
    return AVATAR_DETAIL_BUDGET_ENABLED;
}

function globalStorage(): Storage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}
