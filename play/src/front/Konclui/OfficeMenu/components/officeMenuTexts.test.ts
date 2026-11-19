import { describe, expect, it } from "vitest";
import { i18nObject, locales } from "../../../../i18n/i18n-util";
import { loadAllLocales } from "../../../../i18n/i18n-util.sync";

// The component tests read each text as its key, so the words are checked here against the real locales.

loadAllLocales();

const MENU_KEYS = [
    "statusGroup",
    "profileGroup",
    "settingsGroup",
    "toolsGroup",
    "online",
    "busy",
    "away",
    "doNotDisturb",
    "statusLocked",
    "editName",
    "avatar",
    "companion",
    "cameraMicrophone",
    "allSettings",
    "shareLink",
    "linkCopied",
    "linkCopyFailed",
    "mapEditor",
    "explore",
    "broadcast",
] as const;

describe("the office menu texts", () => {
    it.each(locales)("has every text in %s", (locale) => {
        const { menu } = i18nObject(locale).konclui;

        for (const key of MENU_KEYS) expect(menu[key]().trim(), `${locale} ${key}`).not.toBe("");
    });

    it("has the reference's words in pt-BR", () => {
        const { menu } = i18nObject("pt-BR").konclui;

        expect([menu.online(), menu.busy(), menu.away(), menu.doNotDisturb()]).toEqual([
            "Disponível",
            "Ocupado",
            "Ausente",
            "Não perturbe",
        ]);
        expect([menu.editName(), menu.avatar(), menu.companion()]).toEqual([
            "Editar nome",
            "Personalizar avatar",
            "Adicionar companheiro",
        ]);
        expect([menu.cameraMicrophone(), menu.allSettings(), menu.shareLink()]).toEqual([
            "Câmera e microfone",
            "Todas as configurações",
            "Compartilhar link",
        ]);
        expect([menu.mapEditor(), menu.explore(), menu.broadcast()]).toEqual([
            "Editor do mapa",
            "Explorar a sala",
            "Mensagem para todos",
        ]);
    });

    it("says the same things in en-US in sentence case", () => {
        const { menu } = i18nObject("en-US").konclui;

        expect([menu.online(), menu.busy(), menu.away(), menu.doNotDisturb()]).toEqual([
            "Available",
            "Busy",
            "Away",
            "Do not disturb",
        ]);
        expect(menu.broadcast()).toBe("Message everyone");
        expect(menu.explore()).toBe("Explore the room");
    });
});
