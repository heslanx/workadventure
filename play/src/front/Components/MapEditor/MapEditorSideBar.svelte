<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    // import { createPopperActions } from "svelte-popperjs";
    import type { LocalizedString } from "typesafe-i18n";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { EditorToolName } from "../../Phaser/Game/MapEditor/MapEditorModeManager";
    import { mapEditorSelectedToolStore, mapEditorVisibilityStore } from "../../Stores/MapEditorStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { mapEditorActivated, mapEditorActivatedForThematics } from "../../Stores/MenuStore";
    import { isMediaBreakpointUp } from "../../Utils/BreakpointsUtils";
    import ArrowBarRight from "../Icons/ArrowBarRight.svelte";
    import type { WorkAdventureComponent } from "../../../types/component";
    import { IconX, IconTexture, IconLamp, IconMapSearch, IconSettings, IconTrash } from "@wa-icons";

    type SideBarTool = {
        toolName: EditorToolName;
        iconComponent: WorkAdventureComponent;
        tooltiptext: LocalizedString;
    };

    const direction = document.documentElement.getAttribute("dir") || "ltr";

    const exploreTheRoomTool = {
        toolName: EditorToolName.ExploreTheRoom,
        iconComponent: IconMapSearch,
        tooltiptext: $LL.mapEditor.sideBar.exploreTheRoom(),
    };

    const entityEditorTool = {
        toolName: EditorToolName.EntityEditor,
        iconComponent: IconLamp,
        tooltiptext: $LL.mapEditor.sideBar.entityEditor(),
    };
    const trashEditorTool = {
        toolName: EditorToolName.TrashEditor,
        iconComponent: IconTrash,
        tooltiptext: $LL.mapEditor.sideBar.trashEditor(),
    };

    let availableTools = $derived.by<SideBarTool[]>(() => {
        const tools: SideBarTool[] = [exploreTheRoomTool];

        if ($mapEditorActivatedForThematics && !$mapEditorActivated) {
            tools.push(entityEditorTool, trashEditorTool);
        }

        if ($mapEditorActivated && !isMobile) {
            tools.push({
                toolName: EditorToolName.AreaEditor,
                iconComponent: IconTexture,
                tooltiptext: $LL.mapEditor.sideBar.areaEditor(),
            });
            tools.push(entityEditorTool);
            tools.push({
                toolName: EditorToolName.WAMSettingsEditor,
                iconComponent: IconSettings,
                tooltiptext: $LL.mapEditor.sideBar.configureMyRoom(),
            });
            tools.push(trashEditorTool);
        }

        return tools;
    });

    function switchTool(newTool: EditorToolName) {
        // The map sidebar is opened when the user clicks on the explorer for the first time.
        // If the user clicks on the Explorer again, we need to show the map sidebar.
        if (newTool === EditorToolName.ExploreTheRoom) {
            mapEditorVisibilityStore.set(!$mapEditorVisibilityStore);
        } else {
            mapEditorVisibilityStore.set(true);
        }
        analyticsClient.trackAdminEvent("map_editor.tool.opened", { name: newTool });
        gameManager.getCurrentGameScene().getMapEditorModeManager()?.equipTool(newTool);
    }

    function toggleMapEditor() {
        mapEditorVisibilityStore.set(!$mapEditorVisibilityStore);
    }

    let sectionSideBarContainer: HTMLElement;
    let isMobile = $state(isMediaBreakpointUp("md"));
    const resizeObserver = new ResizeObserver(() => {
        isMobile = isMediaBreakpointUp("md");
    });

    onMount(() => {
        resizeObserver.observe(sectionSideBarContainer);
    });

    onDestroy(() => {
        resizeObserver.unobserve(sectionSideBarContainer);
    });
</script>

<section
    bind:this={sectionSideBarContainer}
    class="side-bar-container z-[1999] pointer-events-auto"
    class:!right-20={!$mapEditorVisibilityStore}
>
    <!--put a section to avoid lower div to be affected by some css-->
    <div class="flex flex-col items-center gap-4 pt-24 side-bar">
        <div class="close-window k-control-column p-1.5 k-chrome rounded-lg flex flex-col gap-1.5">
            <button
                class="k-control"
                data-testid="closeMapEditorButton"
                aria-label={$LL.mapEditor.sideBar.closeMapEditor()}
                onclick={(event) => {
                    event.preventDefault();
                    switchTool(EditorToolName.CloseMapEditor);
                }}
            >
                <IconX aria-hidden="true" />
            </button>
            <button
                class="k-control"
                data-testid="hideMapEditorButton"
                aria-label={$LL.a11y.mapEditorToggleSidebar()}
                aria-expanded={$mapEditorVisibilityStore}
                onclick={(event) => {
                    event.preventDefault();
                    toggleMapEditor();
                }}
            >
                <ArrowBarRight
                    height="h-4.5"
                    width="w-4.5"
                    strokeColor="stroke-white"
                    fillColor="fill-transparent"
                    classList={`aspect-ratio transition-all motion-reduce:transition-none ${direction === "rtl" ? "rotate-180" : ""} ${
                        $mapEditorVisibilityStore ? "" : "rotate-180"
                    }`}
                />
            </button>
        </div>
        <div class="k-control-column p-1.5 k-chrome rounded-lg flex flex-col gap-1.5">
            {#each availableTools as tool (tool.toolName)}
                {@const ToolIcon = tool.iconComponent}
                <div class="tool-button relative flex">
                    <button
                        class="peer k-control"
                        id={tool.toolName}
                        aria-label={tool.tooltiptext}
                        aria-pressed={$mapEditorSelectedToolStore === tool.toolName}
                        class:active={$mapEditorSelectedToolStore === tool.toolName}
                        onclick={(event) => {
                            event.preventDefault();
                            switchTool(tool.toolName);
                        }}
                        type="button"
                    >
                        <ToolIcon aria-hidden="true" />
                    </button>
                    <div
                        class=" bg-contrast/90 backdrop-blur-xl text-white tooltip absolute text-nowrap px-2 py-1 text-sm invisible opacity-0 transition-all motion-reduce:transition-none peer-hover:visible peer-hover:opacity-100 peer-focus-visible:visible peer-focus-visible:opacity-100 rounded top-1/2 -translate-y-1/2 right-11"
                    >
                        {tool.tooltiptext}
                    </div>
                </div>
            {/each}
        </div>
    </div>
</section>
