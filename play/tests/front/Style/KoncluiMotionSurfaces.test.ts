import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The popovers, the dialog, the chips, the disclosures and the controls of the shell, and what they were given of the
 * motion language (play/src/front/Utils/surfaceTransition.ts, libs/tailwind/style/konclui.css). The behaviour of each
 * kind is run in its own component test; here are the facts that a test of behaviour cannot see in jsdom, the ones that
 * are in the markup and not in what runs: which directive stands on which element, which class a control carries, and
 * what was left alone on purpose. They are read from the sources, as KoncluiEntrance.test.ts reads its own.
 */
const front = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/front");
const read = (path: string): string => readFileSync(resolve(front, path), "utf8");

/** The directive is on the element that stands directly under the block that removes it, or it would not be held. */
const underBlock = (block: string, tag: string, directive: string): RegExp =>
    new RegExp(`${block}\\s*(?:<!--[^>]*-->\\s*)*<${tag}\\s[^>]*\\b${directive}\\b`);

describe("the popovers of the shared floating host", () => {
    const host = read("Components/Util/FloatingUiPopupList.svelte");

    it("carry the transition on their wrapper, with the registry entry that says whether it plays", () => {
        expect(host).toMatch(/import \{ popupSurface \} from "\.\.\/\.\.\/Utils\/floatingUiSurface";/);
        // Directly under the {#each}: only there does Svelte hold the wrapper for the exit. The {@const} lines are not
        // elements, and the comment is not a node.
        expect(host).toMatch(
            /\{#each [^\n]*\n(?:\s*\{@const [^\n]*\n)+(?:\s*<!--[\s\S]*?-->\s*)?\s*<div\s[^>]*\buse:action\b/,
        );
        expect(host).toMatch(/<div class="absolute z-\[3000\]"[^>]*\btransition:popupSurface=\{value\}/);
        expect(host).not.toMatch(/\s(?:in|out):[a-z]/);
        expect(host).not.toMatch(/transition:popupSurface\|global/);
    });

    it("are the menus and pickers the user opened: each says so when it registers", () => {
        // The profile menu already passed its layer, so the flag follows it.
        expect(read("Components/ActionBar/MenuIcons/ProfileMenu.svelte")).toMatch(
            /PROFILE_MENU_Z_INDEX,\s*true,\s*\);/,
        );
        for (const file of [
            "Components/ActionBar/MenuIcons/RecordingMenuItem.svelte",
            "Components/ActionBar/MenuIcons/LockDiscussionMenuItem.svelte",
            "Components/ActionBar/MenuIcons/RaiseHandMenuItem.svelte",
            "Components/ActionBar/EmojiSubMenu.svelte",
        ]) {
            // ... 8, true, false, undefined, undefined, <a comment,> true
            expect(read(file), file).toMatch(
                /\b(?:8|12),\s*true,\s*false,\s*undefined,\s*undefined,\s*(?:\/\/[^\n]*\n\s*)?true,?\s*\)/,
            );
        }
    });

    it("leave the hover tooltips of the chat as they were: they register without motion", () => {
        for (const file of ["Chat/Components/Room/Reaction.svelte", "Chat/Components/Room/ReactionTooltip.svelte"]) {
            const source = read(file);
            expect(source, file).not.toContain("popupSurface");
            expect(source, file).not.toMatch(/transition:|\bin:|\bout:/);
        }
    });

    it("do not carry an entrance of their own on top of the host's", () => {
        const profile = read("Components/ActionBar/MenuIcons/ProfileMenuContent.svelte");

        // The wrapper springs: a second entrance on the content inside it would run both.
        expect(profile).not.toMatch(/class="[^"]*(?<![-\w])k-enter(?![-\w])[^"]*"/);
    });
});

describe("the reactions menu, the camera popover and the apps menu", () => {
    it("arrive and leave on the surface transition, on the element that stands directly under their {#if}", () => {
        const reactions = read("Components/ActionBar/EmojiSubMenu.svelte");
        const camera = read("Components/ActionBar/MediaSettingsList/MediaSettingsList.svelte");
        const apps = read("Components/ActionBar/MenuIcons/AppsMenuItem.svelte");

        expect(reactions).toMatch(/import \{ surface \} from "\.\.\/\.\.\/Utils\/surfaceTransition";/);
        expect(reactions).toMatch(/<div\s[^>]*class="[^"]*origin-bottom-left[^"]*"[^>]*\btransition:surface\b/);
        expect(camera).toMatch(/import \{ surface \} from "\.\.\/\.\.\/\.\.\/Utils\/surfaceTransition";/);
        expect(camera).toMatch(/data-testid="media-settings-panel"[^>]*\btransition:surface\b/);
        expect(apps).toMatch(underBlock('\\{#if \\$openedMenuStore === "appMenu"\\}', "nav", "transition:surface"));
        expect(apps).toMatch(/<nav\s[^>]*class="absolute origin-bottom-left"/);
    });

    it("leave the old fly behind: one motion language, not two on one element", () => {
        for (const file of [
            "Components/ActionBar/EmojiSubMenu.svelte",
            "Components/ActionBar/MediaSettingsList/MediaSettingsList.svelte",
            "Components/ActionBar/MenuIcons/AppsMenuItem.svelte",
        ]) {
            const source = read(file);
            expect(source, file).not.toMatch(/\s(?:in|out|transition):fly/);
            expect(source, file).not.toContain("Utils/reducedMotion");
            expect(source, file).not.toMatch(/transition:surface\|global/);
        }
    });

    it("grow from the edge that faces the control they open from: the camera panel from the bottom of the dock", () => {
        const dock = read("Konclui/Shell/components/Dock.svelte");

        expect(dock).toMatch(/\[data-testid="media-settings-panel"\]\) \{[^}]*transform-origin: bottom center;/);
    });
});

describe("the preferences dialog", () => {
    const source = read("Konclui/Preferences/components/PreferencesDialog.svelte");
    const markup = source.slice(0, source.indexOf("<style>"));

    it("arrives and leaves through the surface transition: its box and its dimming, with no keyframes of its own", () => {
        expect(source).not.toContain("@keyframes");
        expect(source).not.toMatch(/animation:/);
        expect(markup).toMatch(/<div class="k-prefs-dim"[^>]*\btransition:surface=\{\{ x: 0, y: 0, scale: 1 \}\}/);
        expect(markup).toMatch(/<div\s[^>]*class="k-prefs block-user-action"[^>]*\btransition:surface\b/);
    });

    it("keeps the scrim that takes the press outside without a transition: it is not inert while the dialog leaves", () => {
        const scrim = /<div\s[^>]*class="k-prefs-scrim"[^>]*>/.exec(markup)?.[0] ?? "";

        expect(scrim).not.toBe("");
        expect(scrim).not.toMatch(/transition:|\bin:|\bout:/);
        // The dimming is its own element, under the box, so that it can fade on its own while the scrim stays.
        expect(source).toMatch(
            /\.k-prefs-dim \{[^}]*z-index: -1;[^}]*pointer-events: none;[^}]*background: rgb\(3 5 26 \/ 0\.62\);/,
        );
        expect(source).not.toMatch(/\.k-prefs-scrim \{[^}]*background:/);
    });

    it("has one pill under its sections, and its sections and its close button give under a press", () => {
        expect(markup).toMatch(/class="k-prefs-tabs k-glide"[^>]*\{@attach glide\(\{ item: '\[role="tab"\]' \}\)\}/);
        expect(markup).toMatch(/class="k-press"\s+role="tab"/);
        expect(markup).toMatch(/class="k-prefs-close k-press"/);
        // While the pill exists it is the hover of the sections that are not the selected one, which keeps its own.
        expect(source).toMatch(
            /\.k-prefs-tabs:global\(\.k-glide-on\) \[role="tab"\]:hover:not\(\[aria-selected="true"\]\) \{\s*background: transparent;/,
        );
    });
});

describe("the chips above the dock, and the tools of the zoom column", () => {
    it.each([
        [
            "Konclui/Presence/components/CallIndicator.svelte",
            /\{#if conversation !== undefined\}\s*<div class="chip k-chrome" transition:surface>/,
        ],
        [
            "Konclui/Focus/components/FocusChip.svelte",
            /\{#if chip\.kind !== "hidden"\}\s*<div\s[^>]*class="chip k-chrome"[^>]*\btransition:surface\b/,
        ],
        [
            "Konclui/Presence/components/PlaceChip.svelte",
            /\{#if name !== undefined && !inConversation\}\s*<div class="place k-chrome" transition:surface>/,
        ],
    ])("%s rises in and leaves on the surface transition, with no keyframes of its own", (file, directive) => {
        const source = read(file);

        expect(source).toMatch(directive);
        expect(source).toMatch(/import \{ surface \} from "\.\.\/\.\.\/\.\.\/Utils\/surfaceTransition";/);
        expect(source).not.toContain("@keyframes");
        expect(source).not.toMatch(/animation:/);
        expect(source).not.toMatch(/class="[^"]*(?<![-\w])k-enter(?![-\w])[^"]*"/);
    });

    it("has each tool of the zoom column come and go on the surface transition, on the button itself", () => {
        const button = read("Konclui/MapTools/components/MapToolButton.svelte");
        const tools = read("Konclui/MapTools/components/MapTools.svelte");

        expect(button).toMatch(/<button\s[^>]*class="group k-control k-press"[^>]*\btransition:surface\b/);
        // Each tool is drawn in an {#if} around the component, so the component's root belongs to that block.
        expect(tools).toMatch(/\{#if \$walkStore\.walking\}\s*<MapToolButton/);
        expect(tools).toMatch(/\{#if \$deskToolStore !== "absent"\}\s*<MapToolButton/);
        expect(tools).toMatch(/\{#if away\}\s*<MapToolButton/);
    });
});

describe("the explorer's lists", () => {
    const source = read("Components/Exploration/Explorer.svelte");

    it("open and shut on the disclosure, and their chevrons turn on the theme's spring", () => {
        // The old `{#if}` removed the rows at once, with nothing to close on.
        expect(source).not.toMatch(/\{#if (?:entity|area)ListActive && /);
        expect(source.match(/class="k-disclosure -mt-0\.5"/g)).toHaveLength(2);
        expect(source.match(/<IconChevronUp class="k-turn \[--k-turn-closed:180deg\]"/g)).toHaveLength(2);
        expect(source).not.toContain("IconChevronDown");
        expect(source).not.toMatch(/rotate-180/);
    });

    it("keeps its entrance on the class it has: its card sits under a parent that delays it, which is still open", () => {
        expect(source).toContain("mapexplorer k-enter");
    });
});

describe("the people panel's Online section", () => {
    const source = read("Konclui/Presence/components/PeoplePanel.svelte");

    it("opens and shuts on the disclosure, around a list that keeps its rows and its id", () => {
        expect(source).toMatch(
            /<div class="reveal k-disclosure" class:is-open=\{sectionOpen\}>\s*<div class="k-disclosure-body reveal-body">/,
        );
        // The list is what `aria-controls` names and what the keys of the panel act on: it stays a plain scroller.
        expect(source).toMatch(/id="konclui-people-list"\s+class="list k-scroll-y"/);
        // The old `hidden` took the rows away at once, with nothing to close on.
        expect(source).not.toMatch(/\bhidden=\{/);
    });

    it("turns its chevron on the theme's spring, and keeps no turn or transition of its own", () => {
        expect(source).toMatch(/<IconChevronDown class="k-turn" font-size="16"/);
        expect(source).not.toMatch(/IconChevronDown class="chevron"|:global\(\.chevron\)/);
        const style = source.slice(source.indexOf("<style>"));
        expect(style).not.toMatch(/\btransition\b|\brotate\b|\btransform\b/);
    });

    it("keeps its box where it was: the disclosure takes the height the list had, not a size of its own", () => {
        expect(source).toMatch(/\.reveal \{\s*flex: 1;\s*min-height: 0;\s*\}/);
        expect(source).toMatch(/\.reveal-body \{\s*display: flex;\s*flex-direction: column;\s*\}/);
    });
});

describe("the controls the user presses all day", () => {
    it("give under a press: the dock's buttons, the rows of the menus, the chip's button and the chevron", () => {
        const button = read("Components/ActionBar/ActionBarButton.svelte");

        expect(button).toMatch(/<button\s+type="button"\s+class="k-press \{compact/);
        expect(button).toMatch(/class="k-menu-row k-press group pointer-events-auto select-none"/);
        expect(
            read("Components/ActionBar/AvailabilityStatus/AvailabilityStatusList.svelte").match(/k-menu-row k-press/g),
        ).toHaveLength(2);
        expect(
            read("Components/ActionBar/MenuIcons/ProfileMenuContent.svelte").match(/k-menu-row k-press/g),
        ).toHaveLength(3);
        expect(read("Konclui/Shell/components/Dock.svelte")).toMatch(/class="media-settings k-press"/);
        expect(read("Konclui/Focus/components/FocusChip.svelte")).toMatch(/class="action k-press"/);
    });

    it("have one pill under the rows of the profile menu, which keeps the logout row red under the pointer", () => {
        const profile = read("Components/ActionBar/MenuIcons/ProfileMenuContent.svelte");

        expect(profile).toMatch(/import \{ glide \} from "\.\.\/\.\.\/\.\.\/Utils\/glide";/);
        expect(profile).toMatch(/class="k-scroll-y k-glide [^"]*"[^>]*\{@attach glide\(\{ item: "\.k-menu-row" \}\)\}/);
        expect(profile).toMatch(/class="k-menu-row k-press logout /);
        expect(profile).toMatch(/\.logout:hover \{\s*background-color: hsl\(var\(--danger-800\)\);/);
    });

    it("lift the tiles of the reactions on a hover, where a tile is a picture to pick", () => {
        const emotes = read("Konclui/Reactions/components/EmoteSection.svelte");

        expect(emotes).toMatch(/class="k-control k-lift emote"/);
        expect(emotes).toMatch(/\.emote \{[^}]*--k-lift-scale: 1\.08;/);
    });
});

describe("what stays still", () => {
    // The searches and the lists they filter, the typeahead, the hover tooltips and the keyboard's own rings: a row that
    // moved each time the user typed, or a ring that glided, would make the thing it carries harder to read.
    it.each([
        "Konclui/Presence/components/PersonRow.svelte",
        "Konclui/Presence/components/WalkNotice.svelte",
        "Chat/Components/Room/MentionSuggestions.svelte",
        "Chat/Components/Room/Reaction.svelte",
        "Chat/Components/Room/ReactionTooltip.svelte",
        "Components/Input/InfoButton.svelte",
        "Components/Tooltip/HelpTooltip.svelte",
    ])("%s gets none of the new motion", (file) => {
        const source = read(file);

        expect(source).not.toMatch(/transition:surface|popupSurface|\bk-glide\b|\bk-disclosure\b|\bk-turn\b/);
    });
});
