import type { BaseTranslation } from "../i18n-types";

const area: BaseTranslation = {
    noAccess: "You don't have access to this area. Ask an administrator for access.",
    blocked: {
        locked: "This area is locked. Ask an administrator to unlock it.",
        maxUsers: "This area is full. Try again when someone leaves.",
        noAccess: "You don't have access to this area. Ask an administrator for access.",
        unlockWithTrigger: "{trigger} to unlock this area.",
    },
    personalArea: {
        nameLabel: "Your name",
        claimDescription: "This is a personal area. Do you want to make it yours?",
        buttons: {
            yes: "Claim this area",
            no: "Not now",
            confirm: "Replace my area",
        },
        personalSpaceWithNames: "{name}'s personal space",
        alreadyHavePersonalArea: "You already have a personal area. It will be deleted if you claim this one.",
    },
};

export default area;
