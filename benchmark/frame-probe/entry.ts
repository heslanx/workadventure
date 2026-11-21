import type { Page } from "@playwright/test";

// The guest entry flow of the Konclui office is read by its Portuguese labels, so the browser locale must be pt-BR.
export const NAME_FIELD = "Digite seu nome";
export const USE_CHARACTER = /Usar este personagem|Continuar/;
export const ENTER_OFFICE = /Entrar no escritório|Salvar/;
export const SKIP_MEDIA = /Continuar sem/;

const ENTRY_TIMEOUT_MS = 60_000;
const SCENE_TIMEOUT_MS = 90_000;
// Lets the first frames and the media prompt settle before the caller measures or takes a screenshot.
const AFTER_SCENE_MS = 3000;

export type EntryStep = "login" | "woka" | "camera";

export interface EntryOptions {
    readonly name: string;
    /** Called when a step of the flow is on screen, before it is left: a screenshot goes here. */
    readonly onStep?: (step: EntryStep) => Promise<void>;
}

/** Enters the room as a guest and dismisses the media prompt: ready to be measured or photographed. */
export async function enterRoomAsGuest(page: Page, url: string, options: EntryOptions): Promise<void> {
    await page.goto(url);
    const nameField = page.getByPlaceholder(NAME_FIELD);
    await nameField.waitFor({ timeout: ENTRY_TIMEOUT_MS });
    await options.onStep?.("login");
    await nameField.fill(options.name);
    await page.keyboard.press("Enter");

    const useCharacter = page.getByRole("button", { name: USE_CHARACTER }).first();
    await useCharacter.waitFor({ timeout: ENTRY_TIMEOUT_MS });
    await options.onStep?.("woka");
    await useCharacter.click();

    const enterOffice = page.getByRole("button", { name: ENTER_OFFICE }).first();
    await enterOffice.waitFor({ timeout: ENTRY_TIMEOUT_MS });
    await options.onStep?.("camera");
    await enterOffice.click();

    await page.waitForFunction(() => document.querySelector("#game")?.classList.contains("game-scene-loaded"), null, {
        timeout: SCENE_TIMEOUT_MS,
    });
    await page.waitForTimeout(AFTER_SCENE_MS);
    const skip = page.getByRole("button", { name: SKIP_MEDIA });
    if ((await skip.count()) > 0) {
        await skip.first().click();
    }
}
