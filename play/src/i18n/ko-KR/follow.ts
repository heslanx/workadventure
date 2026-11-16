import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "{leader}님을 따라가는 중",
        waitingFollowers: "팔로워 확인 대기 중",
        followed: {
            one: "{follower}님이 당신을 따라가는 중입니다",
            two: "{firstFollower}님과 {secondFollower}님이 당신을 따라가는 중입니다",
            many: "{followers}님과 {lastFollower}님이 당신을 따라가는 중입니다",
        },
    },
    interactMenu: {
        title: {
            interact: "상호작용",
            follow: "{leader}님을 따라가시겠습니까?",
        },
        stop: {
            leader: "길 안내를 중단하시겠습니까?",
            follower: "{leader}님 따라가기를 중단하시겠습니까?",
        },
        yes: "예",
        no: "아니오",
        buttons: {
            follow: "{leader}님 따라가기",
            notNow: "나중에",
            stopLeading: "안내 중지",
            keepLeading: "계속 안내하기",
            stopFollowing: "따라가기 중지",
            keepFollowing: "계속 따라가기",
        },
    },
    actionName: "위치 찾기",
};

export default follow;
