<script lang="ts">
    import type { Game } from "../../Phaser/Game/Game";
    import type { LoginScene } from "../../Phaser/Login/LoginScene";
    import { LoginSceneName } from "../../Phaser/Login/LoginScene";
    import { MAX_USERNAME_LENGTH } from "../../Enum/EnvironmentVariable";
    import logoImg from "../images/konclui-logo.svg";
    import poweredByWorkAdventureImg from "../images/Powered_By_WorkAdventure_Big.png";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { LL, locale } from "../../../i18n/i18n-svelte";
    import { NameNotValidError, NameTooLongError } from "../../Exception/NameError";
    import Button from "../UI/Button.svelte";

    interface Props {
        game: Game;
    }

    let { game }: Props = $props();

    let loginScene = $derived(game.scene.getScene(LoginSceneName) as LoginScene);

    let name = $state(gameManager.getPlayerName() || "");
    let startValidating = $state(false);
    let errorName = $state("");
    let invalid = $derived((name.trim() === "" && startValidating) || errorName !== "");

    let logo = gameManager.currentStartedRoom.loginSceneLogo ?? logoImg;
    let legals = gameManager.currentStartedRoom?.legals ?? {};

    const sceneBg = gameManager.currentStartedRoom.backgroundSceneImage;

    let legalStrings: string[] = [];
    if (legals?.termsOfUseUrl) {
        legalStrings.push(
            '<a href="' +
                encodeURI(legals.termsOfUseUrl) +
                '" target="_blank" class="text-white no-underline hover:underline bold hover:text-white">' +
                $LL.login.termsOfUse() +
                "</a>",
        );
    }
    if (legals?.privacyPolicyUrl) {
        legalStrings.push(
            '<a href="' +
                encodeURI(legals.privacyPolicyUrl) +
                '" target="_blank" class="text-white no-underline hover:underline bold hover:text-white">' +
                $LL.login.privacyPolicy() +
                "</a>",
        );
    }
    if (legals?.cookiePolicyUrl) {
        legalStrings.push(
            '<a href="' +
                encodeURI(legals.cookiePolicyUrl) +
                '" target="_blank" class="text-white no-underline hover:underline bold hover:text-white">' +
                $LL.login.cookiePolicy() +
                "</a>",
        );
    }

    let legalString: string | undefined = $state();
    if (legalStrings.length > 0) {
        if (Intl.ListFormat) {
            const formatter = new Intl.ListFormat($locale, { style: "long", type: "conjunction" });
            legalString = formatter.format(legalStrings);
        } else {
            // For old browsers
            legalString = legalStrings.join(", ");
        }
    }

    async function submit() {
        startValidating = true;

        let finalName = name.trim();
        if (finalName !== "") {
            try {
                await loginScene.login(finalName);
            } catch (err) {
                if (err instanceof NameTooLongError) {
                    errorName = $LL.login.input.name.tooLongError();
                } else if (err instanceof NameNotValidError) {
                    errorName = $LL.login.input.name.notValidError();
                } else {
                    errorName = $LL.login.genericError();
                    throw err;
                }
            }
        }
    }

    function getBackgroundColor() {
        if (!gameManager.currentStartedRoom) return undefined;
        return gameManager.currentStartedRoom.backgroundColor;
    }

    // A room's own color or image keeps its dimmed backdrop; without either, the page is the Konclui backdrop.
    const roomBackgroundColor = getBackgroundColor();

    /* eslint-disable svelte/no-at-html-tags */
</script>

<section class="self-center absolute z-30 top-0 text-center w-full">
    <img
        draggable="false"
        src={logo}
        alt={$LL.a11y.compRoomLogo()}
        class="main-logo inline mt-8 {gameManager.currentStartedRoom.loginSceneLogo
            ? 'max-h-[200px] object-cover'
            : ''}"
        style="width: 333px;"
    />
</section>

<form
    class="loginScene h-dvh flex flex-col items-center justify-center pointer-events-auto relative z-30"
    onsubmit={(event) => {
        event.preventDefault();
        submit().catch((error) => {
            console.error("Failed to submit login", error);
        });
    }}
>
    <div class="w-full sm:w-96 md:w-10/12 lg:w-1/2 xl:w-1/3 rounded mx-auto text-center p-8">
        <!-- The error sits in normal flow in a min-height slot, so a wrapped message pushes the button down instead of covering the input -->
        <section class="text-center flex h-fit flex-col justify-center items-center mb-0">
            <span class="text-(--k-fg) text-xl font-bold leading-[1.2] tracking-[-0.01em]">
                {$LL.login.input.name.placeholder()}
            </span>
            <!-- svelte-ignore a11y_autofocus -->
            <input
                type="text"
                name="fname"
                data-testid="loginSceneNameInput"
                aria-label={$LL.login.input.name.placeholder()}
                placeholder={$LL.login.input.name.placeholder()}
                class="w-52 md:w-96 h-12 text-base text-center text-(--k-fg) placeholder:text-(--k-fg-muted) bg-(--k-card) rounded-(--k-radius-menu) border border-solid mt-4 mb-0 focus:ring-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--k-accent) {invalid
                    ? 'border-(--k-danger-text)'
                    : 'border-(--k-border-strong) focus:border-(--k-accent)'}"
                autofocus
                maxlength={MAX_USERNAME_LENGTH}
                bind:value={name}
                onkeypress={() => {
                    startValidating = true;
                }}
            />
            <div class="min-h-7 w-full">
                {#if invalid}
                    <p
                        class="err m-0 pt-1 text-xs font-medium leading-normal not-italic text-(--k-danger-text)"
                        role="alert"
                    >
                        {#if errorName}{errorName}{:else}{$LL.login.input.name.empty()}{/if}
                    </p>
                {/if}
            </div>
        </section>
        <section class="action flex h-fit justify-center m-0" class:opacity-50={invalid}>
            <Button
                type="submit"
                disabled={invalid}
                variant="secondary"
                class="w-52 md:w-96 h-12 rounded-full text-base font-semibold text-center block loginSceneFormSubmit"
            >
                {$LL.login.continue()}
            </Button>
        </section>
        {#if legalString}
            <section class="terms-and-conditions h-fit text-center w-full">
                <p class="text-(--k-fg-muted) text-xs not-italic">
                    {@html $LL.login.terms({
                        links: legalString,
                    })}
                </p>
            </section>
        {/if}
    </div>
    {#if logo !== logoImg && gameManager.currentStartedRoom.showPoweredBy !== false}
        <section class="text-right flex powered-by justify-center items-end">
            <img
                draggable="false"
                src={poweredByWorkAdventureImg}
                alt={$LL.a11y.compPoweredByWorkAdventure()}
                class="h-14"
            />
        </section>
    {/if}
</form>
{#if roomBackgroundColor !== undefined || sceneBg}
    <div
        class="absolute left-0 top-0 w-full h-full z-20 bg-contrast opacity-80"
        style={roomBackgroundColor !== undefined ? `background-color: ${roomBackgroundColor};` : ""}
    ></div>
{:else}
    <div class="absolute left-0 top-0 w-full h-full z-20 bg-(image:--k-page-backdrop)"></div>
{/if}
{#if sceneBg}
    <div class="absolute left-0 top-0 w-full h-full bg-cover z-10" style="background-image: url('{sceneBg}');"></div>
{/if}
