import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "{leader} をフォローします",
        waitingFollowers: "フォロワーの確認を待っています",
        followed: {
            one: "{follower} がフォローしています",
            two: "{firstFollower} と {secondFollower} がフォローしています",
            many: "{followers} と {lastFollower} がフォローしています",
        },
    },
    interactMenu: {
        title: {
            interact: "対応",
            follow: "{leader} をフォローしますか？",
        },
        stop: {
            leader: "先導をやめますか？",
            follower: "{leader} のフォローをやめますか？",
        },
        yes: "はい",
        no: "いいえ",
        buttons: {
            follow: "{leader}さんについて行く",
            notNow: "今はしない",
            stopLeading: "案内をやめる",
            keepLeading: "案内を続ける",
            stopFollowing: "ついて行くのをやめる",
            keepFollowing: "ついて行き続ける",
        },
    },
    actionName: "位置を特定",
};

export default follow;
