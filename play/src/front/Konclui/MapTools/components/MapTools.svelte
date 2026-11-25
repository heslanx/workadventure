<script lang="ts">
    import { tick } from "svelte";
    import { asError } from "catch-unknown";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { cameraDetachedStore } from "../../../Stores/CameraStore";
    import { mapEditorModeStore } from "../../../Stores/MapEditorStore";
    import { deskToolStore } from "../stores/deskStore";
    import { cancelWalk, centerOnPlayer, goToDesk } from "../stores/mapToolsCommands";
    import { walkStore } from "../stores/walkStore";
    import MapToolButton from "./MapToolButton.svelte";
    import { IconDesk, IconFocusCentered, IconSPlayertop } from "@wa-icons";

    // The tools of the zoom column, above its zoom controls: they are more rows of that column, and each one is drawn
    // only while it can act, so none of them is a control that does nothing.
    //  - Cancel the walk, while the player walks.
    //  - Go to my desk, for a user whose room gives them one. While they already sit at it, the tool stays, dimmed and
    //    focusable, and says so: pressing it would do nothing, and a press that does nothing must still answer.
    //  - Center on me, while the view is away from the avatar. Upstream's own control for that stands in the map
    //    editor, where this one steps aside.
    let away = $derived($cameraDetachedStore && !$mapEditorModeStore);
    // The answer to a press on the desk tool that has nothing to do. It is kept only while that is still true.
    let deskNotice = $state("");
    $effect(() => {
        if ($deskToolStore !== "here") deskNotice = "";
    });
    let walkText = $derived(
        $walkStore.walkStatus === "going"
            ? $LL.konclui.mapTools.walking()
            : $walkStore.walkStatus === "cancelled"
              ? $LL.konclui.mapTools.walkCancelled()
              : deskNotice,
    );

    /**
     * The control that follows the one that will leave, else the one before it, in the order of the column. A tool
     * that is already leaving (inert, held for its exit) is not one to hand the focus to.
     */
    function neighbourOf(button: HTMLElement): HTMLElement | undefined {
        const controls = [...(button.parentElement?.querySelectorAll<HTMLElement>("button.k-control") ?? [])].filter(
            (control) => !control.inert,
        );
        const index = controls.indexOf(button);
        return controls[index + 1] ?? controls[index - 1];
    }

    /**
     * Runs a tool. A tool that leaves because it was used (the walk ends, the view is back) takes the focus with it, so
     * the focus goes to the next control of the column and a keyboard user keeps their place. The tool is still in the
     * page for the length of its exit, and the browser has taken the focus off it the moment it became inert: it has
     * left as soon as it is inert, not once it is gone.
     */
    function use(action: () => void, event: MouseEvent): void {
        const button = event.currentTarget;
        const hadFocus = button instanceof HTMLElement && document.activeElement === button;
        const next = button instanceof HTMLElement ? neighbourOf(button) : undefined;
        try {
            action();
        } catch (error: unknown) {
            console.error("[konclui] map tools: a tool failed", asError(error));
            return;
        }
        if (!hadFocus || !(button instanceof HTMLElement)) return;
        tick()
            .then(() => {
                if (!button.isConnected || button.inert) next?.focus();
            })
            .catch((error: unknown) => console.error("[konclui] map tools: could not move the focus", asError(error)));
    }
</script>

{#if $walkStore.walking}
    <MapToolButton
        label={$LL.konclui.mapTools.cancelWalk()}
        testid="map-tool-cancel-walk"
        onclick={(event) => use(cancelWalk, event)}
    >
        <IconSPlayertop aria-hidden="true" />
    </MapToolButton>
{/if}
{#if $deskToolStore !== "absent"}
    <MapToolButton
        label={$LL.konclui.mapTools.goToMyDesk()}
        testid="map-tool-go-to-desk"
        reason={$deskToolStore === "here" ? $LL.konclui.mapTools.alreadyAtDesk() : undefined}
        onblockedpress={() => (deskNotice = $LL.konclui.mapTools.alreadyAtDesk())}
        onclick={(event) => use(goToDesk, event)}
    >
        <IconDesk aria-hidden="true" />
    </MapToolButton>
{/if}
{#if away}
    <MapToolButton
        label={$LL.konclui.mapTools.centerOnMe()}
        testid="center-camera-on-player"
        onclick={(event) => use(centerOnPlayer, event)}
    >
        <IconFocusCentered aria-hidden="true" />
    </MapToolButton>
{/if}
<!-- What a screen reader hears of the walk, and of a press on the desk tool that has nothing to do. It changes when a
     walk starts or is cancelled, and the controller lets it change once a second at most; a repeated press leaves the
     same text, which is not read again, so it is never read out in a stream. -->
<span class="sr-only" role="status">{walkText}</span>
