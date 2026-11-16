import type { BaseTranslation } from "../i18n-types";

const area: BaseTranslation = {
    noAccess: "Você não tem acesso a esta área. Peça acesso a um administrador.",
    blocked: {
        locked: "Esta área está trancada. Peça a um administrador para destrancá-la.",
        maxUsers: "Esta área está cheia. Tente de novo quando alguém sair.",
        noAccess: "Você não tem acesso a esta área. Peça acesso a um administrador.",
        unlockWithTrigger: "{trigger} para desbloquear esta área.",
    },
    personalArea: {
        nameLabel: "Seu nome",
        claimDescription: "Esta é uma área pessoal. Você quer torná-la sua?",
        buttons: {
            yes: "Reivindicar esta área",
            no: "Agora não",
            confirm: "Substituir minha área",
        },
        personalSpaceWithNames: "Espaço pessoal de {name}",
        alreadyHavePersonalArea: "Você já tem uma área pessoal. Ela será excluída se você reivindicar esta.",
    },
};

export default area;
