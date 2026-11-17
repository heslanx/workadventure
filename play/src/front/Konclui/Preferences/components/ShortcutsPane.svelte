<script lang="ts">
    import { LL, locale } from "../../../../i18n/i18n-svelte";
    import {
        bindingFromEvent,
        defaultShortcuts,
        editableShortcutActions,
        fixedShortcutFor,
        isBrowserReserved,
        sameBinding,
        shortcutOverridesStore,
        shortcutsStore,
        type FixedShortcut,
        type KeyBinding,
        type ShortcutAction,
    } from "../../../Stores/ShortcutsStore";
    import { isMac } from "../../../WebRtc/DeviceUtils";
    import { combinationKeys, movementKeys } from "../domain/shortcutKeys";
    import PrefRow from "./PrefRow.svelte";
    import PrefSection from "./PrefSection.svelte";

    // The keys of upstream's shortcut editor (ShortcutSubMenu.svelte), in the dialog's rows: the fixed keys first,
    // then the ones a user can change, recorded the same way and checked against the same conflicts.

    interface Problem {
        action: ShortcutAction;
        binding: KeyBinding;
        text: string;
        /** The action the keys would be taken from; only then can the user move them over. */
        owner?: ShortcutAction;
    }

    let t = $derived($LL.konclui.preferences.shortcuts);
    const mac = isMac();
    let capturing: ShortcutAction | undefined = $state(undefined);
    let problem: Problem | undefined = $state(undefined);
    // The "Change" buttons, which stay: they take the focus from a Reset or Replace button that is about to vanish.
    let changeButtons: Partial<Record<ShortcutAction, HTMLButtonElement>> = $state({});

    let actionLabels = $derived<Record<ShortcutAction, string>>({
        walkMyDesk: t.walkMyDesk(),
        follow: t.follow(),
        openChat: t.openChat(),
        openUserList: t.openUserList(),
        rotatePlayer: t.rotatePlayer(),
        toggleMapEditor: t.toggleMapEditor(),
    });
    let fixedLabels = $derived<Record<FixedShortcut, string>>({
        walk: t.walk(),
        interact: t.interact(),
        openSayPopup: t.say(),
        openThinkPopup: t.think(),
        sendEmote: t.emotes(),
    });
    let fixedRows = $derived<{ keys: string[][]; label: string }[]>([
        { keys: [[...movementKeys($locale)], ["↑", "←", "↓", "→"]], label: t.walk() },
        { keys: [[t.shift()]], label: t.run() },
        { keys: [[t.space()]], label: t.interact() },
        { keys: [[t.enter()]], label: t.say() },
        { keys: [["Ctrl", t.enter()]], label: t.think() },
        { keys: [["1…6"], ["F1…F6"]], label: t.emotes() },
        { keys: [["Esc"]], label: t.close() },
    ]);

    function keysOf(binding: KeyBinding): string[] {
        return combinationKeys(binding, { mac, shift: t.shift() });
    }

    function isChanged(action: ShortcutAction): boolean {
        const bound = $shortcutsStore[action];
        return bound === null || !sameBinding(bound, defaultShortcuts[action]);
    }

    function startCapture(action: ShortcutAction): void {
        capturing = action;
        problem = undefined;
    }

    function capture(event: KeyboardEvent, action: ShortcutAction): void {
        if (capturing !== action) return;
        // Tab alone leaves the button: it stops the recording and moves the focus on, as anywhere else.
        if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
            capturing = undefined;
            return;
        }
        // The keys are for the recording: neither the game, the dialog nor the browser acts on them.
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") {
            capturing = undefined;
            return;
        }
        const binding = bindingFromEvent(event);
        // A modifier alone: wait for the rest of the combination.
        if (!binding) return;
        capturing = undefined;
        const keys = keysOf(binding).join(" + ");
        if (isBrowserReserved(binding)) {
            problem = { action, binding, text: t.reserved({ keys }) };
            return;
        }
        const fixed = fixedShortcutFor(binding);
        if (fixed) {
            problem = { action, binding, text: t.fixedTaken({ keys, action: fixedLabels[fixed] }) };
            return;
        }
        const owner = editableShortcutActions.find((other) => {
            const bound = $shortcutsStore[other];
            return other !== action && bound !== null && sameBinding(bound, binding);
        });
        if (owner) {
            problem = { action, binding, owner, text: t.taken({ keys, action: actionLabels[owner] }) };
            return;
        }
        shortcutOverridesStore.assign(action, binding);
    }

    function replace(): void {
        if (problem?.owner === undefined) return;
        changeButtons[problem.action]?.focus();
        shortcutOverridesStore.assign(problem.action, problem.binding, problem.owner);
        problem = undefined;
    }

    function reset(action: ShortcutAction): void {
        changeButtons[action]?.focus();
        shortcutOverridesStore.reset(action);
        problem = undefined;
    }

    function resetAll(): void {
        changeButtons[editableShortcutActions[0]]?.focus();
        shortcutOverridesStore.resetAll();
        problem = undefined;
    }
</script>

{#snippet keyList(combos: string[][])}
    <span class="k-pref-keys">
        {#each combos as combo, index (index)}
            {#each combo as key, keyIndex (keyIndex)}<kbd>{key}</kbd>{/each}
        {/each}
    </span>
{/snippet}

<PrefSection title={t.fixed()}>
    {#each fixedRows as row (row.label)}
        <div class="k-pref-item">
            <span class="k-pref-text"><b>{row.label}</b></span>
            {@render keyList(row.keys)}
        </div>
    {/each}
</PrefSection>
<p class="k-pref-note">{t.yoursHint()}</p>
<PrefSection title={t.yours()}>
    {#each editableShortcutActions as action (action)}
        {@const binding = $shortcutsStore[action]}
        <div class="k-pref-item k-pref-stack">
            <span class="k-pref-text">
                <b>{actionLabels[action]}</b>
                {#if problem?.action === action}
                    <small class="k-pref-error" role="alert">{problem.text}</small>
                {/if}
            </span>
            {#if binding}
                {@render keyList([keysOf(binding)])}
            {:else}
                <span class="k-pref-muted">{t.none()}</span>
            {/if}
            <span class="k-pref-actions">
                {#if problem?.action === action && problem.owner !== undefined}
                    <button type="button" class="k-pref-button" onclick={replace}>{t.replace()}</button>
                {/if}
                <button
                    bind:this={changeButtons[action]}
                    type="button"
                    class="k-pref-button"
                    class:capturing={capturing === action}
                    aria-label={capturing === action ? t.pressKeys() : t.changeAction({ action: actionLabels[action] })}
                    onclick={() => startCapture(action)}
                    onkeydown={(event) => capture(event, action)}
                    onblur={() => {
                        if (capturing === action) capturing = undefined;
                    }}>{capturing === action ? t.pressKeys() : t.change()}</button
                >
                {#if isChanged(action)}
                    <button
                        type="button"
                        class="k-pref-button quiet"
                        aria-label={t.resetAction({ action: actionLabels[action] })}
                        onclick={() => reset(action)}>{t.reset()}</button
                    >
                {/if}
            </span>
        </div>
    {/each}
</PrefSection>
{#if editableShortcutActions.some(isChanged)}
    <PrefRow title={t.resetAll()} hint={t.resetAllHint()} onclick={resetAll} />
{/if}
