<script lang="ts">
    import { writable } from "svelte/store";
    import { onMount } from "svelte";
    import type {
        AreaDataPropertiesKeys,
        EntityDataPropertiesKeys,
        OpenWebsitePropertyData,
    } from "@workadventure/map-editor";
    import { activateOnEnterOrSpace } from "../../Utils/activateOnEnterOrSpace";
    import { LL } from "../../../i18n/i18n-svelte";
    import {
        mapEditorModeStore,
        mapExplorationAreasStore,
        mapExplorationEntitiesStore,
        mapExplorationObjectSelectedStore,
    } from "../../Stores/MapEditorStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import type { Entity } from "../../Phaser/ECS/Entity";
    import type { AreaPreview } from "../../Phaser/Components/MapEditor/AreaPreview";
    import type { ExplorerTool } from "../../Phaser/Game/MapEditor/Tools/ExplorerTool";
    import AddPropertyButtonWrapper from "../MapEditor/PropertyEditor/AddPropertyButtonWrapper.svelte";

    import { mapExplorerSearchinputFocusStore } from "../../Stores/UserInputStore";
    import Input from "../Input/Input.svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { WOKA_SPEED } from "../../Enum/EnvironmentVariable";
    import { IconChevronUp, IconEye, IconLamp, IconTexture, IconWalk } from "@wa-icons";

    // The property filters, in the order their chips are shown.
    const propertyFilters: ReadonlyArray<AreaDataPropertiesKeys | EntityDataPropertiesKeys> = [
        "personalAreaPropertyData",
        "restrictedRightsPropertyData",
        "jitsiRoomProperty",
        "playAudio",
        "openWebsite",
        "speakerMegaphone",
        "listenerMegaphone",
        "exit",
        "start",
        "focusable",
        "matrixRoomPropertyData",
        "openFile",
        "livekitRoomProperty",
    ];

    // A chip is upstream's property button, which takes no class and exposes no pressed state: the action gives the
    // button the dock control's class and the filter's state, which that class draws with the dock's selected look.
    function filterChip(node: HTMLElement, pressed: boolean) {
        const button = node.querySelector("button");
        button?.classList.add("k-control");
        const show = (value: boolean) => button?.setAttribute("aria-pressed", String(value));
        show(pressed);
        return { update: show };
    }

    let filter = $state("");
    let selectFilters = writable<Array<string>>(new Array<string>());
    let entitiesListFiltered = writable<Map<string, Entity>>(new Map());
    let areasListFiltered = writable<Map<string, AreaPreview>>(new Map());

    const applicationManager = gameManager.getCurrentGameScene().applicationManager;

    onMount(() => {
        init();
    });

    function init() {
        entitiesListFiltered.set($mapExplorationEntitiesStore);
        if ($mapExplorationAreasStore) areasListFiltered.set($mapExplorationAreasStore);
    }

    // Name used to display and sort an entity: its custom name if set, otherwise the prefab name.
    function getEntityDisplayName(entity: Entity): string {
        const name = entity.getEntityData().name;
        return name && name !== "" ? name : entity.getPrefab().name;
    }

    // Name used to display and sort an area (may be an empty string when the area has no name).
    function getAreaDisplayName(area: AreaPreview): string {
        return area.getAreaData().name;
    }

    // Sort the filtered entries alphabetically by display name (case-insensitive, natural number order).
    function sortByName<T>(entries: Iterable<[string, T]>, getName: (item: T) => string): Array<[string, T]> {
        return [...entries].sort(([, a], [, b]) =>
            getName(a).localeCompare(getName(b), undefined, { sensitivity: "base", numeric: true }),
        );
    }

    function onChangeFilterHandle() {
        entitiesListFiltered.set(new Map());
        for (let [key, entity] of $mapExplorationEntitiesStore) {
            // Check filter by name
            if (filter && filter != "" && entity.getPrefab().name.toLowerCase().indexOf(filter.toLowerCase()) == -1)
                continue;

            // Check filter by properties
            if ($selectFilters.length == 0) {
                $entitiesListFiltered.set(key, entity);
                entityListActive = true;
                continue;
            } else {
                // Check if the entity has the selected properties
                for (let filter of $selectFilters) {
                    if (
                        entity
                            .getProperties()
                            .find((p) => p.type === filter || (p as OpenWebsitePropertyData).application === filter)
                    ) {
                        $entitiesListFiltered.set(key, entity);
                        entityListActive = true;
                    }
                }
            }
        }

        areasListFiltered.set(new Map());
        if ($mapExplorationAreasStore) {
            for (let [key, area] of $mapExplorationAreasStore) {
                // Set area if the name match the filter and if the area has the selected properties
                if (filter && filter != "" && area.getAreaData().name.toLowerCase().indexOf(filter.toLowerCase()) == -1)
                    continue;

                // Check filter by properties
                if ($selectFilters.length == 0) {
                    $areasListFiltered.set(key, area);
                    areaListActive = true;
                    continue;
                } else {
                    // Check if the area has the selected properties
                    for (let filter of $selectFilters) {
                        if (
                            area
                                .getProperties()
                                .find((p) => p.type === filter || (p as OpenWebsitePropertyData).application === filter)
                        ) {
                            $areasListFiltered.set(key, area);
                            areaListActive = true;
                        }
                    }
                }
            }
        }
        analyticsClient.trackAdminEvent("map_explorer.filtered");
    }

    function addFilter(filterName: string) {
        selectFilters.update((filters) => {
            if (filters.includes(filterName)) {
                return filters.filter((f) => f !== filterName);
            }
            return [...filters, filterName];
        });
        onChangeFilterHandle();
    }
    let entityListActive = $state(false);
    let areaListActive = $state(false);
    // A list is drawn from the first time it opens and stays, hidden, while it is shut: it has to be in the page for
    // the length of its closing, and a room can hold hundreds of rows that nobody has asked to see yet. The latch is
    // set before the page is updated, so the rows of a list that opens are there for its first frame.
    let entityListSeen = $state(false);
    let areaListSeen = $state(false);
    $effect.pre(() => {
        if (entityListActive) entityListSeen = true;
    });
    $effect.pre(() => {
        if (areaListActive) areaListSeen = true;
    });
    function toggleEntityList() {
        entityListActive = !entityListActive;
    }
    function toggleAreaList() {
        areaListActive = !areaListActive;
    }

    function highlightEntity(entity: Entity) {
        if ($mapExplorationObjectSelectedStore != undefined) return;
        entity.setPointedToEditColor(0xf9e82d);
        gameManager.getCurrentGameScene().getCameraManager().centerCameraOn(entity);
        // Use explorer tool to define the zoom to center camera position
        const activeTool = gameManager.getCurrentGameScene().getMapEditorModeManager()?.currentlyActiveTool;
        (activeTool as ExplorerTool | undefined)?.defineZoomToCenterCameraPosition();
    }
    function unhighlightEntity(entity: Entity) {
        // Don't unhighlight if the entity is selected
        if ($mapExplorationObjectSelectedStore == entity) return;

        entity.setPointedToEditColor(0x00000);
        gameManager.getCurrentGameScene().markDirty();
    }
    function highlightArea(area: AreaPreview) {
        if ($mapExplorationObjectSelectedStore != undefined) return;
        area.setStrokeStyle(2, 0xf9e82d);
        gameManager.getCurrentGameScene().getCameraManager().centerCameraOn(area);
        // Use explorer tool to define the zoom to center camera position
        const activeTool = gameManager.getCurrentGameScene().getMapEditorModeManager()?.currentlyActiveTool;
        (activeTool as ExplorerTool | undefined)?.defineZoomToCenterCameraPosition();
    }
    function unhighlightArea(area: AreaPreview) {
        // Don't unhighlight if the area is selected
        if ($mapExplorationObjectSelectedStore == area) return;

        area.setStrokeStyle(2, 0x000000);
        gameManager.getCurrentGameScene().markDirty();
    }

    // Prevent the input form to be focused when clicking on the filter input
    // The UserInputManager service automatically focus the input form when a click event is detected
    // When user looking for entities or areas, we don't move the player
    function focusin(event: FocusEvent) {
        event.stopImmediatePropagation();
        event.preventDefault();
        mapExplorerSearchinputFocusStore.set(true);
    }
    function focusout(event: FocusEvent) {
        event.stopImmediatePropagation();
        event.preventDefault();
        mapExplorerSearchinputFocusStore.set(false);
    }

    let timeOutToSelectArea: ReturnType<typeof setTimeout> | undefined;
    function handlerToSelectArea(area: AreaPreview) {
        // If the area is already selected, unselect it
        if ($mapExplorationObjectSelectedStore == area) {
            unhighlightArea(area);
            mapExplorationObjectSelectedStore.set(undefined);
            return;
        }

        // If no area is selected, select it directly
        if ($mapExplorationObjectSelectedStore == undefined) {
            mapExplorationObjectSelectedStore.set(area);
            return;
        }

        // if not, unselect first and select after a delay
        mapExplorationObjectSelectedStore.set(undefined);
        highlightArea(area);
        if (timeOutToSelectArea) clearTimeout(timeOutToSelectArea);
        timeOutToSelectArea = setTimeout(() => {
            mapExplorationObjectSelectedStore.set(area);
        }, 800); // use 800ms because the fly transition duration is 500ms and we want to avoid flickering
    }

    let timeOutToSelectEntity: ReturnType<typeof setTimeout> | undefined;
    function handlerToSelectEntity(entity: Entity) {
        // If the entity is already selected, unselect it
        if ($mapExplorationObjectSelectedStore == entity) {
            unhighlightEntity(entity);
            mapExplorationObjectSelectedStore.set(undefined);
            return;
        }

        // If no entity is selected, select it directly
        if ($mapExplorationObjectSelectedStore == undefined) {
            mapExplorationObjectSelectedStore.set(entity);
            return;
        }

        // if not, unselect first and select after a delay
        mapExplorationObjectSelectedStore.set(undefined);
        highlightEntity(entity);
        if (timeOutToSelectEntity) clearTimeout(timeOutToSelectEntity);
        timeOutToSelectEntity = setTimeout(() => {
            mapExplorationObjectSelectedStore.set(entity);
        }, 800); // use 800ms because the fly transition duration is 500ms and we want to avoid flickering
    }

    // Go to the entity or area
    function goTo(object: Entity | AreaPreview) {
        gameManager
            .getCurrentGameScene()
            .moveTo(
                {
                    x: object.x,
                    y: object.y,
                },
                true,
                WOKA_SPEED * 2.5,
            )
            .catch((error) => {
                console.warn("Error while moving to the entity or area", error);
                warningMessageStore.addWarningMessage($LL.mapEditor.explorer.details.errorMovingToObject(), {
                    closable: true,
                });
            });
        gameManager.getCurrentGameScene().getMapEditorModeManager()?.equipTool(undefined);

        // Close map editor to walk on the entity or zone
        analyticsClient.trackAdminEvent(!$mapEditorModeStore ? "map_editor.opened" : "map_editor.closed");
        mapEditorModeStore.switchMode(!$mapEditorModeStore);

        // Close the modal
        mapExplorationObjectSelectedStore.set(undefined);
    }
</script>

<div
    class="mapexplorer k-enter flex flex-col overflow-auto [--k-enter-x:16px] [--k-enter-y:0px] [--k-enter-dur:var(--k-dur-normal)]"
>
    <div class="header-container">
        <h3 class="text-l text-left">{$LL.mapEditor.explorer.title()}</h3>
    </div>
    <div class="flex flex-col gap-2 justify-center">
        <div class="flex *:w-full">
            <Input
                rounded
                bind:value={filter}
                oninput={onChangeFilterHandle}
                onfocusin={focusin}
                onfocusout={focusout}
                placeholder={$LL.mapEditor.entityEditor.itemPicker.searchPlaceholder()}
            />
        </div>
        <div class="filter-chips flex flex-row flex-wrap gap-1.5">
            {#each propertyFilters as property (property)}
                <span class="contents" use:filterChip={$selectFilters.includes(property)}>
                    <AddPropertyButtonWrapper {property} onclick={() => addFilter(property)} />
                </span>
            {/each}

            {#each applicationManager.applications as app, index (`my-own-app-${index}`)}
                <span class="contents" use:filterChip={$selectFilters.includes(app.name)}>
                    <AddPropertyButtonWrapper
                        property="openWebsite"
                        subProperty={app.name}
                        onclick={() => {
                            addFilter(app.name);
                        }}
                    />
                </span>
            {/each}
        </div>

        <div class="flex flex-col gap-0.5">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="group entities k-menu-row"
                onclick={toggleEntityList}
                role="button"
                tabindex="0"
                onkeydown={(event) => activateOnEnterOrSpace(event, toggleEntityList)}
            >
                <span class="k-menu-lead" aria-hidden="true"><IconLamp /></span>
                {#if $entitiesListFiltered.size > 0}
                    <span class="count px-1.5">{$entitiesListFiltered.size}</span>
                    <span class="k-menu-label">{$LL.mapEditor.explorer.entitiesFound($entitiesListFiltered.size)}</span>
                {:else}
                    <span class="k-menu-label">
                        {filter !== "" || $selectFilters.length > 0
                            ? $LL.mapEditor.explorer.noEntitiesMatch()
                            : $LL.mapEditor.explorer.noEntitiesFound()}
                    </span>
                {/if}

                <button
                    type="button"
                    aria-expanded={entityListActive}
                    aria-label={$LL.mapEditor.explorer.entitiesList()}
                    class="k-control"
                    data-testid="toggleFolderEntity"
                    onclick={(event) => {
                        event.stopPropagation();
                        toggleEntityList();
                    }}
                >
                    <!-- The up chevron, turned over while the list is shut: it turns to upright as the list opens. -->
                    <IconChevronUp class="k-turn [--k-turn-closed:180deg]" aria-hidden="true" />
                </button>
            </div>

            <!-- The list opens and shuts as a disclosure: its rows stay in the page while it is shut, hidden from the
                 keys and from a screen reader, and the box grows to what they hold. Its 2 px of margin and of padding
                 stand for the gap above it, so a shut list leaves the column as it was. -->
            <div class="k-disclosure -mt-0.5" class:is-open={entityListActive && $entitiesListFiltered.size > 0}>
                <div class="k-disclosure-body">
                    {#if entityListSeen}
                        <div class="entity-items flex flex-col gap-0.5 pt-0.5">
                            {#each sortByName($entitiesListFiltered, getEntityDisplayName) as [key, entity] (key)}
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <div
                                    id={entity.entityId}
                                    onmouseenter={() => highlightEntity(entity)}
                                    onmouseleave={() => unhighlightEntity(entity)}
                                    onfocusin={() => highlightEntity(entity)}
                                    onfocusout={() => unhighlightEntity(entity)}
                                    onclick={() => handlerToSelectEntity(entity)}
                                    role="button"
                                    tabindex="0"
                                    onkeydown={(event) =>
                                        activateOnEnterOrSpace(event, () => handlerToSelectEntity(entity))}
                                    class="item k-menu-row"
                                    class:is-selected={$mapExplorationObjectSelectedStore === entity}
                                    title={getEntityDisplayName(entity)}
                                >
                                    <span class="k-menu-lead" aria-hidden="true">
                                        <img
                                            draggable="false"
                                            class="pointer-events-none"
                                            src={entity.getPrefab().imagePath}
                                            alt=""
                                        />
                                    </span>
                                    <span class="k-menu-label">
                                        {entity.getEntityData().name && entity.getEntityData().name !== ""
                                            ? entity.getEntityData().name
                                            : entity.getPrefab().name}
                                    </span>
                                    <span class="flex flex-none items-center gap-1.5">
                                        <button
                                            type="button"
                                            aria-label={$LL.mapEditor.explorer.details.moveToEntity({
                                                name: getEntityDisplayName(entity),
                                            })}
                                            class="k-control"
                                            onclick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                goTo(entity);
                                            }}
                                        >
                                            <IconWalk aria-hidden="true" />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={$LL.mapEditor.explorer.details.show({
                                                name: getEntityDisplayName(entity),
                                            })}
                                            class="k-control"
                                            onclick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                handlerToSelectEntity(entity);
                                            }}
                                        >
                                            <IconEye aria-hidden="true" />
                                        </button>
                                    </span>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="group areas k-menu-row"
                onclick={toggleAreaList}
                role="button"
                tabindex="0"
                onkeydown={(event) => activateOnEnterOrSpace(event, toggleAreaList)}
            >
                <span class="k-menu-lead" aria-hidden="true"><IconTexture /></span>
                {#if $areasListFiltered.size > 0}
                    <span class="count px-1.5">{$areasListFiltered.size}</span>
                    <span class="k-menu-label">{$LL.mapEditor.explorer.areasFound($areasListFiltered.size)}</span>
                {:else}
                    <span class="k-menu-label">
                        {filter !== "" || $selectFilters.length > 0
                            ? $LL.mapEditor.explorer.noAreasMatch()
                            : $LL.mapEditor.explorer.noAreasFound()}
                    </span>
                {/if}
                <button
                    type="button"
                    aria-expanded={areaListActive}
                    aria-label={$LL.mapEditor.explorer.areasList()}
                    class="k-control"
                    data-testid="toggleFolderArea"
                    onclick={(event) => {
                        event.stopPropagation();
                        toggleAreaList();
                    }}
                >
                    <IconChevronUp class="k-turn [--k-turn-closed:180deg]" aria-hidden="true" />
                </button>
            </div>
            <div class="k-disclosure -mt-0.5" class:is-open={areaListActive && $areasListFiltered.size > 0}>
                <div class="k-disclosure-body">
                    {#if areaListSeen}
                        <div class="area-items flex flex-col gap-0.5 pt-0.5">
                            {#if $areasListFiltered.size > 0}
                                {#each sortByName($areasListFiltered, getAreaDisplayName) as [key, area] (key)}
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <div
                                        id={key}
                                        onmouseenter={() => highlightArea(area)}
                                        onmouseleave={() => unhighlightArea(area)}
                                        onfocusin={() => highlightArea(area)}
                                        onfocusout={() => unhighlightArea(area)}
                                        onclick={() => handlerToSelectArea(area)}
                                        role="button"
                                        tabindex="0"
                                        onkeydown={(event) =>
                                            activateOnEnterOrSpace(event, () => handlerToSelectArea(area))}
                                        class="item k-menu-row"
                                        class:is-selected={$mapExplorationObjectSelectedStore === area}
                                        title={area.getAreaData().name || "No name"}
                                    >
                                        <span class="k-menu-lead" aria-hidden="true"><IconTexture /></span>
                                        <span
                                            class="k-menu-label"
                                            class:italic={!area.getAreaData().name || area.getAreaData().name == ""}
                                            class:font-bold={area.getAreaData().name && area.getAreaData().name != ""}
                                        >
                                            {area.getAreaData().name || "No name"}
                                        </span>
                                        <span class="flex flex-none items-center gap-1.5">
                                            <button
                                                type="button"
                                                aria-label={$LL.mapEditor.explorer.details.moveToArea({
                                                    name: area.getAreaData().name || "No name",
                                                })}
                                                class="k-control"
                                                onclick={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    goTo(area);
                                                }}
                                            >
                                                <IconWalk aria-hidden="true" />
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={$LL.mapEditor.explorer.details.show({
                                                    name: area.getAreaData().name || "No name",
                                                })}
                                                class="k-control"
                                                onclick={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    handlerToSelectArea(area);
                                                }}
                                            >
                                                <IconEye aria-hidden="true" />
                                            </button>
                                        </span>
                                    </div>
                                {/each}
                            {/if}
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>
</div>

<style>
    /* The chips are upstream's property buttons (AddPropertyButton.svelte), sized here to the dock's control: the
       filter action puts `.k-control` and the pressed state on each button, and these rules fit the glyph box inside. */
    .filter-chips :global(.add-property-button > div) {
        width: 18px;
        height: 18px;
    }
    .filter-chips :global(.add-property-button > div > :is(svg, img)) {
        width: 18px;
        height: 18px;
        max-width: none;
        max-height: none;
        object-fit: contain;
    }
    /* The glyph carries its own white ink; a pressed chip draws it in the dock's on-accent ink. */
    .filter-chips :global(.add-property-button[aria-pressed="true"] svg) {
        color: inherit;
    }
    .count {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        height: 20px;
        border-radius: var(--k-radius-row);
        background: var(--k-elevated);
        color: var(--k-fg);
        font-size: 12px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }
    .item.is-selected {
        background: var(--k-hover);
        color: var(--k-fg);
    }
</style>
