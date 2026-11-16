<script lang="ts" module>
    import { get, writable } from "svelte/store";

    // Kept outside the component so the search survives closing and reopening the room list.
    const roomListSearchStore = writable("");
</script>

<script lang="ts">
    import * as Sentry from "@sentry/svelte";
    import { asError } from "catch-unknown";
    import { onMount } from "svelte";
    import { SvelteMap } from "svelte/reactivity";
    import defaultMapImg from "../images/default-map.png";
    import { roomListVisibilityStore } from "../../Stores/ModalStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { scriptUtils } from "../../Api/ScriptUtils";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import LL from "../../../i18n/i18n-svelte";
    import PopUpContainer from "../PopUp/PopUpContainer.svelte";
    import Button from "../UI/Button.svelte";
    import Chip from "../UI/Chip.svelte";
    import InputSearch from "../Input/InputSearch.svelte";

    interface RoomData {
        name: string;
        description?: string;
        thumbnail?: string;
        wamUrl: string | undefined;
        roomUrl: string;
        areasSearchable?: boolean;
        entitiesSearchable?: boolean;
    }

    let search = $state(get(roomListSearchStore));
    let fetchError = $state<Error | undefined>(undefined);
    const currentRoomUrl = gameManager.getCurrentGameScene().room.href;
    const roomList = new SvelteMap<string, RoomData>();
    const roomListFiltered = writable<Map<string, RoomData>>(new Map<string, RoomData>());
    const isFetching = writable<boolean>(false);
    const isMoving = writable<boolean>(false);
    const roomNameSelected = writable<string | undefined>(undefined);

    async function fetchMaps(): Promise<void> {
        try {
            isFetching.set(true);
            fetchError = undefined;
            const connection = gameManager.getCurrentGameScene().connection;
            if (!connection) {
                throw new Error("Cannot fetch the room list: no connection to the server");
            }
            const response = await connection.queryRoomsFromSameWorld();
            roomList.clear();
            for (const room of response) {
                //const url = new URL(room.url);
                const map: RoomData = { ...room } as RoomData;
                roomList.set(room.roomUrl, map);
            }
        } catch (e) {
            const error = asError(e);
            console.error("Failed to fetch the room list", error);
            Sentry.captureException(error);
            fetchError = error;
        } finally {
            isFetching.set(false);
            onUpdateSearch();
        }
    }

    function clearSearch() {
        search = "";
        onUpdateSearch();
    }

    onMount(async () => {
        // Get the room list from the server
        await fetchMaps();
    });

    function onUpdateSearch() {
        // Filter the room list based on the search value and update the roomListFiltered
        roomListSearchStore.set(search);
        // Built first, then set once: mutating the store's map would not notify its subscribers.
        // A local value handed to a store, not reactive state.
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const filtered = new Map<string, RoomData>();
        for (const [roomUrl, roomData] of roomList) {
            if (roomData.name.toLowerCase().indexOf(search.toLowerCase()) != -1) {
                filtered.set(roomUrl, roomData);
            } else if (
                roomData.description != undefined &&
                roomData.description.toLowerCase().indexOf(search.toLowerCase()) != -1
            ) {
                filtered.set(roomUrl, roomData);
            }
        }
        roomListFiltered.set(filtered);
    }

    function close() {
        // Close the room list
        roomListVisibilityStore.set(false);
    }

    // Desktop app: the other worlds, recent rooms and links are on its Landing, in a new tab.
    function openLanding() {
        window.WAD?.openLanding?.();
        close();
    }

    function clickRoom(roomUrl: string, roomName: string) {
        isMoving.set(true);
        roomNameSelected.set(roomName);
        analyticsClient.trackAdminEvent("room_list.room_clicked", { roomId: roomUrl });
        // Use the room url to join the room
        scriptUtils.goToPage(roomUrl);
    }
</script>

<div class="absolute top-0 bottom-0 w-full h-full flex items-center justify-center">
    <div class="w-11/12 lg:w-2/3 relative h-fit">
        <PopUpContainer extraClasses="w-full relative" fullContent={true}>
            <div class="flex flex-col items-center pointer-events-auto w-full">
                {#if $isMoving}
                    <h1>{$LL.mapEditor.listRoom.movingToRoom({ roomNameSelected: $roomNameSelected })}</h1>
                {:else}
                    <!-- room card -->
                    <div class="h-fit w-full flex flex-col items-center gap-8">
                        <div class="w-full flex flex-col items-start gap-2 px-6">
                            <label for="search" class="text-white">{$LL.mapEditor.listRoom.searchLabel()}</label>
                            <div class="relative flex grow w-full">
                                <InputSearch
                                    id="search"
                                    type="text"
                                    size="lg"
                                    placeholder={$LL.mapEditor.listRoom.searchPlaceholder()}
                                    bind:value={search}
                                    oninput={onUpdateSearch}
                                    class="grow peer w-full"
                                />
                                <svg
                                    class="icon icon-tabler icon-tabler-search stroke-contrast-400 absolute top-0 bottom-0 right-5 m-auto peer-focus:stroke-secondary peer-hover:stroke-secondary-500 transition-all peer-focus:-translate-x-1"
                                    aria-hidden="true"
                                    fill="none"
                                    height="20"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="1.5"
                                    viewBox="0 0 24 24"
                                    width="20"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <path d="M0 0h24v24H0z" fill="none" stroke="none" />
                                    <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
                                    <path d="M21 21l-6 -6" />
                                </svg>
                            </div>
                        </div>
                        <div class="flex flex-row flex-nowrap space-x-4 justify-center items-center w-full min-h-52">
                            {#if $isFetching}
                                <h3>{$LL.mapEditor.listRoom.isFetching()}</h3>
                            {:else if fetchError}
                                <div class="flex flex-col items-center gap-3 px-6 text-center" role="alert">
                                    <h3 class="m-0">{$LL.mapEditor.listRoom.fetchFailedTitle()}</h3>
                                    <p class="m-0 text-sm opacity-80">{$LL.mapEditor.listRoom.fetchFailedDetail()}</p>
                                    <Button variant="secondary" onclick={fetchMaps}>
                                        {$LL.mapEditor.listRoom.retryFetch()}
                                    </Button>
                                </div>
                            {:else if $roomListFiltered.size === 0 && search.trim() !== ""}
                                <div class="flex flex-col items-center gap-3 px-6 text-center" role="status">
                                    <h3 class="m-0">{$LL.mapEditor.listRoom.noRoomMatch({ search: search.trim() })}</h3>
                                    <Button variant="light" onclick={clearSearch}>
                                        {$LL.mapEditor.listRoom.clearSearch()}
                                    </Button>
                                </div>
                            {:else if $roomListFiltered.size === 0}
                                <h3 role="status">{$LL.mapEditor.listRoom.noRoomAvailable()}</h3>
                            {:else}
                                <div class="relative w-full flex space-x-6 snap-mandatory snap-x overflow-x-auto">
                                    <div class="snap-center shrink-0">
                                        <div class="shrink-0"></div>
                                    </div>
                                    {#each Array.from($roomListFiltered) as [roomUrl, roomData] (roomUrl)}
                                        <div
                                            id={roomUrl}
                                            class="flex flex-col items-center snap-center shrink-0 first:pl-8 last:pr-8 rounded-lg overflow-hidden cursor-pointer"
                                            role="button"
                                            tabindex="0"
                                            onclick={() => clickRoom(roomData.roomUrl, roomData.name)}
                                            onkeydown={(event) => {
                                                if (event.key !== "Enter" && event.key !== " ") return;
                                                event.preventDefault();
                                                clickRoom(roomData.roomUrl, roomData.name);
                                            }}
                                        >
                                            <div
                                                class="w-full rounded-lg relative overflow-hidden group cursor-pointer"
                                            >
                                                <div
                                                    class="absolute z-10 left-0 bottom-0-0 w-full h-full bg-gradient-to-t to-90% to-transparent {currentRoomUrl ===
                                                    new URL(roomData.roomUrl, window.location.href).toString()
                                                        ? 'from-secondary-900'
                                                        : 'from-contrast'}"
                                                ></div>
                                                <img
                                                    draggable="false"
                                                    src={roomData.thumbnail ?? defaultMapImg}
                                                    alt=""
                                                    class="shrink-0 w-80 h-52 bg-white object-cover group-hover:scale-110 motion-reduce:group-hover:scale-100 transition-all z-0"
                                                    onerror={(e) => {
                                                        const img = e.currentTarget as HTMLImageElement;
                                                        img.onerror = null;
                                                        img.src = defaultMapImg;
                                                    }}
                                                />
                                                <span
                                                    class="absolute z-20 bottom-0 max-w-full w-full flex items-center justify-center text-ellipsis overflow-hidden text-white text-xs font-bold px-2 py-3 bg-se"
                                                >
                                                    {roomData.name}
                                                </span>
                                                {#if currentRoomUrl === new URL(roomData.roomUrl, window.location.href).toString()}
                                                    <Chip
                                                        variant="secondary"
                                                        class="z-20 bg-secondary text-white rounded absolute top-3 right-3"
                                                    >
                                                        <div class="px-2">Active</div>
                                                    </Chip>
                                                {/if}
                                            </div>
                                            <div class="py-2 text-center">
                                                {#if roomData.areasSearchable || roomData.entitiesSearchable}
                                                    <div class="pointer-events-none m-0 px-3">
                                                        {$LL.mapEditor.listRoom.items({
                                                            countEntity: roomData.entitiesSearchable ?? 0,
                                                            countArea: roomData.areasSearchable ?? 0,
                                                        })}
                                                    </div>
                                                {/if}
                                            </div>
                                        </div>
                                    {/each}
                                    <div class="snap-center shrink-0">
                                        <div class="shrink-0"></div>
                                    </div>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/if}
            </div>
            {#snippet buttons()}
                <div class="flex flex-row justify-center gap-2 w-full">
                    {#if window.WAD?.openLanding}
                        <Button size="lg" variant="light" class="w-1/2" onclick={openLanding}>
                            {$LL.actionbar.desktop.openRoom()}
                        </Button>
                    {/if}
                    <Button size="lg" variant="secondary" class="w-1/2 m-auto" onclick={close}>
                        {$LL.mapEditor.listRoom.close()}
                    </Button>
                </div>
            {/snippet}
        </PopUpContainer>
    </div>
</div>

<style>
</style>
