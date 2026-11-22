// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { get, type Writable } from "svelte/store";
import type { PersonRow as PersonRowData } from "../domain/peopleList";
import type { PeoplePanelState } from "../stores/peopleListStore";

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    // Every key reads as its own path followed by its arguments, so a test finds a text by the key and the values it
    // was given. The words themselves are checked against the real locales in presenceTexts.test.ts.
    const path = (keys: string[]): unknown =>
        new Proxy((values?: unknown) => keys.join(".") + (values === undefined ? "" : JSON.stringify(values)), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    const LL = readable(path([]));
    return { LL, default: LL, locale: readable("en-US") };
});
vi.mock("../stores/peopleListStore", async () => {
    const { writable } = await import("svelte/store");
    return { peoplePanelStore: writable({}) };
});
vi.mock("../stores/worldRoster", async () => {
    const { writable } = await import("svelte/store");
    return { rosterListOpenStore: writable(false), chooseEveryone: vi.fn() };
});

import { chatInputFocusStore } from "../../../Stores/ChatStore";
import { peoplePanelStore } from "../stores/peopleListStore";
import {
    clearWalkNotice,
    goToPerson,
    installPresenceCommands,
    type PresenceCommands,
} from "../stores/presenceCommands";
import {
    clearSearchFocusRequest,
    peopleQueryStore,
    requestSearchFocus,
    searchFocusRequestStore,
    setPeopleQuery,
} from "../stores/peopleSearchStore";
import { chooseEveryone, rosterListOpenStore } from "../stores/worldRoster";
import PeoplePanel from "./PeoplePanel.svelte";

const panelStore = peoplePanelStore as unknown as Writable<PeoplePanelState>;
const listOpen = rosterListOpenStore;

const ROOM = "https://office.example/map";

const person = (id: number, name: string, extra: Partial<PersonRowData> = {}): PersonRowData => ({
    key: `${ROOM}_${id}`,
    uuid: `account-${id}`,
    playUri: ROOM,
    name,
    place: undefined,
    status: 1,
    elsewhere: false,
    roomName: undefined,
    ...extra,
});

const baseState: PeoplePanelState = {
    phase: "ready",
    mode: "everyone",
    count: 3,
    me: { name: "Eu", place: { kind: "area", name: "Sala azul" }, status: 1 },
    rows: [],
    users: new Map(),
    cutOf: undefined,
    empty: undefined,
    canChooseEveryone: false,
    searching: false,
};

describe("PeoplePanel", () => {
    const target = document.createElement("div");
    let panel: ReturnType<typeof mount> | undefined;
    let collapse: Mock<() => void>;
    let walkTo: Mock<PresenceCommands["walkTo"]>;

    beforeEach(() => {
        collapse = vi.fn<() => void>();
        walkTo = vi.fn<PresenceCommands["walkTo"]>();
        installPresenceCommands({ walkTo });
        clearWalkNotice();
        setPeopleQuery("");
        clearSearchFocusRequest();
        listOpen.set(false);
        vi.mocked(chooseEveryone).mockClear();
    });

    afterEach(async () => {
        const mounted = panel;
        panel = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
    });

    function show(state: Partial<PeoplePanelState> = {}) {
        panelStore.set({ ...baseState, ...state });
        document.body.append(target);
        panel = mount(PeoplePanel, { target, props: { onCollapse: collapse } });
        flushSync();
    }

    const rows = () => [...target.querySelectorAll<HTMLButtonElement>("[data-person-row]")];
    const rowNames = () => rows().map((row) => row.querySelector("b")?.textContent);
    const searchInput = () => {
        const input = target.querySelector<HTMLInputElement>('input[type="search"]');
        if (!input) throw new Error("no search field");
        return input;
    };
    const sectionButton = () => {
        const button = target.querySelector<HTMLButtonElement>("button.section");
        if (!button) throw new Error("no section button");
        return button;
    };
    const text = () => target.textContent ?? "";
    const press = (element: Element, key: string) => {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        flushSync();
        return event;
    };

    describe("the header", () => {
        it("names the panel Koncluí and collapses it with a labelled button", () => {
            show();

            expect(target.querySelector("header strong")?.textContent).toBe("Koncluí");
            const collapseButton = target.querySelector<HTMLButtonElement>("header button");
            expect(collapseButton?.getAttribute("aria-label")).toBe("konclui.collapsePanel");

            collapseButton?.click();
            expect(collapse).toHaveBeenCalledTimes(1);
        });

        it("says where the player is, when the map names the place", () => {
            show();

            expect(target.querySelector(".here")?.textContent).toBe("Sala azul");
        });

        it("says nothing about the place when the map names none", () => {
            show({ me: { name: "Eu", place: undefined, status: 1 } });

            expect(target.querySelector(".here")).toBeNull();
        });
    });

    describe("Online (N)", () => {
        it("reads the count of the world, not the number of rows it lists", () => {
            show({ count: 640, rows: [person(2, "Ana"), person(3, "Bia")] });

            expect(sectionButton().textContent).toContain('konclui.peopleList.online{"count":640}');
        });

        it("says Online with no number while the count is not known, never zero", () => {
            show({ count: 0 });

            expect(sectionButton().textContent).toContain("konclui.peopleList.onlineUnknown");
            expect(sectionButton().textContent).not.toContain("0");
        });

        it("collapses and expands the list, and says which with aria-expanded", () => {
            show({ rows: [person(2, "Ana")] });
            const list = target.querySelector<HTMLElement>("#konclui-people-list");
            expect(sectionButton().getAttribute("aria-controls")).toBe("konclui-people-list");
            expect(sectionButton().getAttribute("aria-expanded")).toBe("true");
            expect(list?.hidden).toBe(false);

            sectionButton().click();
            flushSync();
            expect(sectionButton().getAttribute("aria-expanded")).toBe("false");
            expect(list?.hidden).toBe(true);

            sectionButton().click();
            flushSync();
            expect(list?.hidden).toBe(false);
        });
    });

    describe("the rows", () => {
        it("puts the player first, as a row that is not a button, and the others after", () => {
            show({ rows: [person(2, "Ana"), person(3, "Bia")] });

            const you = target.querySelector("[data-person-you]");
            expect(you?.textContent).toContain('konclui.peopleList.you{"name":"Eu"}');
            expect(you?.tagName).not.toBe("BUTTON");
            expect(rowNames()).toEqual(["Ana", "Bia"]);
            expect(you?.compareDocumentPosition(rows()[0]) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        });

        it("names each row for who, where and how: go to the person, the place, the status", () => {
            show({ rows: [person(2, "Ana", { place: { kind: "area", name: "Sala 01" } })] });

            expect(rows()[0].getAttribute("aria-label")).toBe(
                'konclui.peopleList.goToPerson{"name":"Ana"}, Sala 01, actionbar.status.ONLINE',
            );
        });

        it("walks to the person when the row is pressed, and says it is going at once", () => {
            show({ rows: [person(2, "Ana")] });

            rows()[0].click();
            flushSync();

            expect(walkTo).toHaveBeenCalledTimes(1);
            expect(walkTo).toHaveBeenCalledWith(expect.objectContaining({ uuid: "account-2", playUri: ROOM }));
            // The words are on the panel for the eye; the live region that announces them is the shell's, not the panel's.
            const notice = target.querySelector("[data-walk-notice]");
            expect(notice?.textContent).toBe('konclui.peopleList.going{"name":"Ana"}');
            expect(notice?.getAttribute("aria-hidden")).toBe("true");
            expect(target.querySelector('[role="status"][aria-live]')).toBeNull();
        });

        it("does not show again, on the panel, a notice raised before it opened, and shows one raised while it is open", () => {
            // A phone closes the sheet as the walk starts, and the notice outlives the sheet for a few seconds.
            goToPerson({ uuid: "account-2", playUri: ROOM, name: "Ana" });
            show({ rows: [person(3, "Bia")] });

            expect(target.querySelector("[data-walk-notice]")?.textContent).toBe("");

            rows()[0].click();
            flushSync();

            expect(target.querySelector("[data-walk-notice]")?.textContent).toBe(
                'konclui.peopleList.going{"name":"Bia"}',
            );
        });

        it("tells the shell a walk started, once per press, so that a phone can close the sheet over the map", () => {
            const onWalk = vi.fn<() => void>();
            panelStore.set({ ...baseState, rows: [person(2, "Ana")] });
            document.body.append(target);
            panel = mount(PeoplePanel, { target, props: { onCollapse: collapse, onWalk } });
            flushSync();

            rows()[0].click();
            flushSync();

            expect(onWalk).toHaveBeenCalledTimes(1);
            expect(walkTo).toHaveBeenCalledTimes(1);
        });

        it("does not tell the shell of a walk when the person is in another room and nothing starts", () => {
            const onWalk = vi.fn<() => void>();
            panelStore.set({ ...baseState, rows: [person(2, "Bia", { elsewhere: true })] });
            document.body.append(target);
            panel = mount(PeoplePanel, { target, props: { onCollapse: collapse, onWalk } });
            flushSync();

            rows()[0].click();
            flushSync();

            expect(onWalk).not.toHaveBeenCalled();
        });

        it("keeps a person of another room focusable, says why it cannot act, and does nothing when pressed", () => {
            show({ rows: [person(2, "Bia", { elsewhere: true })] });
            const row = rows()[0];

            expect(row.getAttribute("aria-disabled")).toBe("true");
            expect(row.hasAttribute("disabled")).toBe(false);
            expect(row.getAttribute("aria-label")).toContain("konclui.peopleList.elsewhere");
            expect(row.textContent).toContain("konclui.peopleList.elsewhere");

            row.focus();
            expect(document.activeElement).toBe(row);
            row.click();
            expect(walkTo).not.toHaveBeenCalled();
        });

        it("has no button that cannot act: only the collapse, the section, the rows and a choice of everyone", () => {
            show({ rows: [person(2, "Ana")], mode: "nearby", canChooseEveryone: true });

            // The rows carry a marker, the collapse button is the one with a label of its own, the others have a class.
            const buttons = [...target.querySelectorAll("button")].map((button) =>
                button.hasAttribute("data-person-row")
                    ? "person"
                    : (button.getAttribute("aria-label") ?? button.className.split(" ")[0]),
            );

            expect(buttons).toEqual(["konclui.collapsePanel", "section", "person", "everyone"]);
            expect(text()).not.toMatch(/map/i);
        });
    });

    describe("the search field's focus ring", () => {
        // jsdom applies no stylesheet, so the rule is read from the component's source. The global field style rings a
        // focused input with a box-shadow (blue, off-palette); the label's mint border is the one ring the field has.
        const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "PeoplePanel.svelte"), "utf8");
        const style = source.slice(source.indexOf("<style>")).replace(/\/\*[\s\S]*?\*\//g, "");
        const bodyOf = (selector: string) => {
            const start = style.indexOf(`${selector} {`);
            return start < 0 ? undefined : style.slice(start, style.indexOf("}", start));
        };

        it("takes no ring of its own from the input: no outline and no box-shadow", () => {
            const input = bodyOf(".search input");

            expect(input).toMatch(/outline:\s*none;/);
            expect(input).toMatch(/box-shadow:\s*none;/);
        });

        it("leaves the one ring to the label's border, in the accent", () => {
            expect(bodyOf(".search:focus-within")).toMatch(/border-color:\s*var\(--k-accent\);/);
        });
    });

    describe("the empty states", () => {
        it.each([
            ["alone", "konclui.peopleList.nobodyElse"],
            ["noMatch", "konclui.peopleList.nobodyMatches"],
            ["nobodyNearby", "konclui.peopleList.nobodyNearby"],
            ["nobodyNearbyMatches", "konclui.peopleList.nobodyNearbyMatches"],
        ] as const)("says %s in its own words", (empty, words) => {
            show({ empty });

            expect(target.querySelector(".empty")?.textContent).toBe(words);
        });

        it("keeps the entry for everyone beside the words of a search that reached only the people near", () => {
            show({ mode: "nearby", empty: "nobodyNearbyMatches", canChooseEveryone: true, searching: true });

            expect(target.querySelector(".empty")?.textContent).toBe("konclui.peopleList.nobodyNearbyMatches");
            expect(target.querySelector("button.everyone")).not.toBeNull();
        });

        it("says nothing while there are rows", () => {
            show({ rows: [person(2, "Ana")] });

            expect(target.querySelector(".empty")).toBeNull();
        });

        it("says the list is on its way, not that nobody is there, while it loads", () => {
            show({ phase: "loading", empty: undefined });

            expect(target.querySelector(".notice")?.textContent).toBe("konclui.peopleList.loading");
            expect(target.querySelector(".empty")).toBeNull();
        });

        it("says the list could not be loaded", () => {
            show({ phase: "unavailable" });

            expect(target.querySelector(".notice")?.textContent).toBe("konclui.peopleList.unavailable");
        });
    });

    describe("near you and everyone", () => {
        it("titles the list Near you, and offers everyone as an explicit entry, in a big world", () => {
            show({ mode: "nearby", canChooseEveryone: true, rows: [person(2, "Ana")] });

            expect(target.querySelector(".title")?.textContent).toBe("konclui.peopleList.nearYou");
            const everyone = target.querySelector<HTMLButtonElement>("button.everyone");
            expect(everyone?.textContent).toContain("konclui.peopleList.showEveryone");
            expect(everyone?.textContent).toContain('konclui.peopleList.showEveryoneHint{"limit":200}');
        });

        it("asks for everyone when that entry is pressed", () => {
            show({ mode: "nearby", canChooseEveryone: true });

            target.querySelector<HTMLButtonElement>("button.everyone")?.click();

            expect(chooseEveryone).toHaveBeenCalledTimes(1);
        });

        it("keeps the focus in the panel when the entry that was pressed leaves the list", () => {
            // What asking for everyone does to the panel: the entry is gone and the list loads.
            vi.mocked(chooseEveryone).mockImplementationOnce(() => {
                panelStore.update((state) => ({
                    ...state,
                    mode: "everyone",
                    phase: "loading",
                    canChooseEveryone: false,
                    empty: undefined,
                }));
            });
            show({ mode: "nearby", canChooseEveryone: true, rows: [person(2, "Ana")] });
            const entry = target.querySelector<HTMLButtonElement>("button.everyone");
            if (!entry) throw new Error("no entry for everyone");
            entry.focus();
            expect(document.activeElement).toBe(entry);

            entry.click();
            flushSync();

            expect(target.querySelector("button.everyone")).toBeNull();
            expect(document.activeElement).not.toBe(document.body);
            expect(target.contains(document.activeElement)).toBe(true);
            expect(target.querySelector(".notice")?.textContent).toBe("konclui.peopleList.loading");
        });

        it("offers nothing to choose when the world is small, or everyone is already listed", () => {
            show({ mode: "everyone", canChooseEveryone: false });

            expect(target.querySelector("button.everyone")).toBeNull();
            expect(target.querySelector(".title")).toBeNull();
        });

        it("says it shows the first 200 of the world's count when the window cut the list", () => {
            show({
                rows: Array.from({ length: 200 }, (_, index) => person(index + 2, `P${index}`)),
                cutOf: 640,
                count: 900,
            });

            expect(target.querySelector(".cut")?.textContent).toBe(
                'konclui.peopleList.showingFirst{"shown":200,"total":900}',
            );
        });

        it("says it shows the first 200 of the matches of a search, which is not the world's count", () => {
            show({
                rows: Array.from({ length: 200 }, (_, index) => person(index + 2, `P${index}`)),
                cutOf: 250,
                count: 900,
                searching: true,
            });

            expect(target.querySelector(".cut")?.textContent).toBe(
                'konclui.peopleList.showingFirst{"shown":200,"total":250}',
            );
        });
    });

    describe("the search", () => {
        it("keeps what is typed in the search store", () => {
            show();
            const input = searchInput();

            input.value = "joão";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            expect(get(peopleQueryStore)).toBe("joão");
        });

        it("shows the shortcut as a keycap, hidden from assistive technology", () => {
            show();

            const keycap = target.querySelector("kbd");
            expect(keycap?.textContent).toMatch(/^(⌘K|Ctrl K)$/);
            expect(keycap?.getAttribute("aria-hidden")).toBe("true");
        });

        it("clears what was typed with Escape and keeps the panel open: the key goes no further", () => {
            show();
            setPeopleQuery("ana");
            flushSync();
            const reachedWindow = vi.fn();
            window.addEventListener("keydown", reachedWindow);

            const event = press(searchInput(), "Escape");

            expect(get(peopleQueryStore)).toBe("");
            expect(event.defaultPrevented).toBe(true);
            expect(reachedWindow).not.toHaveBeenCalled();
            window.removeEventListener("keydown", reachedWindow);
        });

        it("lets Escape go on to the shell, which closes the panel, once there is nothing to clear", () => {
            show();
            const reachedWindow = vi.fn();
            window.addEventListener("keydown", reachedWindow);

            const event = press(searchInput(), "Escape");

            expect(event.defaultPrevented).toBe(false);
            expect(reachedWindow).toHaveBeenCalledTimes(1);
            window.removeEventListener("keydown", reachedWindow);
        });

        it("stops the game's keys while the field has the focus, and gives them back when it loses it", () => {
            show();
            const input = searchInput();

            input.focus();
            expect(get(chatInputFocusStore)).toBe(true);

            input.blur();
            expect(get(chatInputFocusStore)).toBe(false);
        });

        it("takes the focus and selects its text when something asked for it, and the request is spent", () => {
            show();
            const input = searchInput();
            input.value = "ana";

            requestSearchFocus();
            flushSync();

            expect(document.activeElement).toBe(input);
            expect(input.selectionStart).toBe(0);
            expect(input.selectionEnd).toBe(3);
            expect(get(searchFocusRequestStore)).toBe(false);
        });

        it("takes the focus as soon as it is drawn, when the panel was opened for the request", () => {
            requestSearchFocus();

            show();

            expect(document.activeElement).toBe(searchInput());
        });
    });

    describe("the keyboard in the list", () => {
        it("goes from the search field to the first row with the down arrow", () => {
            show({ rows: [person(2, "Ana"), person(3, "Bia")] });
            searchInput().focus();

            press(searchInput(), "ArrowDown");

            expect(document.activeElement).toBe(rows()[0]);
        });

        it("keeps the down arrow in the field when the list has no row", () => {
            show({ rows: [] });
            searchInput().focus();

            const event = press(searchInput(), "ArrowDown");

            expect(event.defaultPrevented).toBe(false);
            expect(document.activeElement).toBe(searchInput());
        });

        it("moves the focus along the rows with the arrows, Home and End", () => {
            show({ rows: [person(2, "Ana"), person(3, "Bia"), person(4, "Caio")] });
            const [ana, bia, caio] = rows();

            ana.focus();
            press(ana, "ArrowDown");
            expect(document.activeElement).toBe(bia);

            press(bia, "End");
            expect(document.activeElement).toBe(caio);

            press(caio, "ArrowDown");
            expect(document.activeElement).toBe(caio);

            press(caio, "ArrowUp");
            expect(document.activeElement).toBe(bia);

            press(bia, "Home");
            expect(document.activeElement).toBe(ana);
        });
    });

    describe("while it is on screen", () => {
        it("tells the world roster the list is open, and that it is not once the panel is gone", async () => {
            expect(get(listOpen)).toBe(false);

            show();
            expect(get(listOpen)).toBe(true);

            const mounted = panel;
            panel = undefined;
            if (mounted) await unmount(mounted);
            expect(get(listOpen)).toBe(false);
        });

        it("forgets what was typed, asked and said once it is gone, and gives the game its keys back", async () => {
            show();
            setPeopleQuery("ana");
            chatInputFocusStore.set(true);
            requestSearchFocus();

            const mounted = panel;
            panel = undefined;
            if (mounted) await unmount(mounted);

            expect(get(peopleQueryStore)).toBe("");
            expect(get(searchFocusRequestStore)).toBe(false);
            expect(get(chatInputFocusStore)).toBe(false);
        });
    });
});
