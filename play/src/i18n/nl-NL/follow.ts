import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "Volgt {leader}",
        waitingFollowers: "Wachten op bevestiging van volgers",
        followed: {
            one: "{follower} volgt je",
            two: "{firstFollower} en {secondFollower} volgen je",
            many: "{followers} en {lastFollower} volgen je",
        },
    },
    interactMenu: {
        title: {
            interact: "Interacties",
            follow: "Wil je {leader} volgen?",
        },
        stop: {
            leader: "Wil je stoppen met de weg leiden?",
            follower: "Wil je stoppen met {leader} volgen?",
        },
        yes: "Ja",
        no: "Nee",
        buttons: {
            follow: "{leader} volgen",
            notNow: "Niet nu",
            stopLeading: "Stoppen met leiden",
            keepLeading: "Blijven leiden",
            stopFollowing: "Stoppen met volgen",
            keepFollowing: "Blijven volgen",
        },
    },
    actionName: "Lokaliseren",
};

export default follow;
