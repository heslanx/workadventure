# Usability, interaction words and transparency

Scope: `play/src/front`. Read-only audit, no source edited. Paths are relative to `play/src/front`.

Context. The chat side is already ahead of the guide: drafts survive (`Chat/Services/DraftMessageService.ts`), destructive chat actions use `ConfirmDialog.svelte`, poll and settings saves show an inline error, and the room-folder load failure has a visible retry (`Chat/Components/RoomFolder.svelte:155-165`). The violations cluster in the shared controls (`UI/Button.svelte`, `ActionBar/ActionBarButton.svelte`, `Toasts/*`, `Modal/*`) and in the virtual-office paths (camera, microphone, connection, announcements, room list).

Confidence key: H = read the code path end to end, M = read the component, not every caller, L = inferred.

## Clique frustrado

1. **ActionBarButton blocks with a native `disabled` and no reason (class fix).** `Components/ActionBar/ActionBarButton.svelte:151` sets `disabled=` on the `<button>`, so a click is swallowed, the button leaves the tab order, and the `handleClick` guard at `:99` is dead code. The only explanation is the hover tooltip (`:183`, mouse-only; `compact` mode falls back to `title`, `:153`). Callers that land here with no explanation at all:
   - Calendar and To-do for admins when the module is off: `ActionBar/MenuIcons/AppsMenuContent.svelte:75`, `:85`.
   - Room list for admins when off: `ActionBar/MenuIcons/MapSubMenuContent.svelte:168`.
   - "Go to my desk" while already inside it: `MapSubMenuContent.svelte:200`.
   - Screen share when not activated: `ActionBar/MenuIcons/ScreenSharingMenuItem.svelte:36`.
   - Chat and user list while the chat connection loads or has failed: `ChatMenuItem.svelte:80`, `UserListMenuItem.svelte:41`.

   Fix (cascade): add a `blockedReason?: string` prop to `ActionBarButton`. Render `aria-disabled="true"` instead of `disabled`, keep the button focusable, and on click or Enter show the reason in a visible one-line notice. Then each caller above passes one i18n line. For admin-only "module off" buttons, REMOVE is the better step for non-admins (already done) and REDIRECT to the admin page for admins. Confidence H.

2. **Chat button stays disabled forever when the chat connection fails.** `ActionBar/MenuIcons/ChatMenuItem.svelte:43-45` and `UserListMenuItem.svelte:32-34` do `console.error("Could not get chat", e)` and leave `chatAvailable = false`. The person sees a greyed chat icon with no reason and no retry. Fix: a `chatFailed` state that turns the button into "Chat unavailable, retry" (RESOLVE), wired to `gameManager.getChatConnection()` again. Confidence H.

3. **Shared `Button` uses native `disabled` (class fix).** `UI/Button.svelte:95` passes `{disabled}` straight to `<button>`, while the anchor branch at `:89` already uses `aria-disabled`. Disabled submit buttons therefore give no feedback and no focus. Known cases: announcement send is disabled when the text is empty with no hint (`Announcement/AnnouncementComposerModal.svelte:158`), poll create (`Chat/Components/PollCreateDialog.svelte:213`), room create (`Chat/Components/Room/CreateRoomView.svelte:267`), room settings save (`Chat/Components/Room/RoomSidePanelSettings.svelte:519`). Fix: in `Button.svelte` render `aria-disabled` and swallow the click, plus an optional `disabledReason` prop shown under or beside the button and tied with `aria-describedby`. Callers with an obvious reason (empty text, missing title) pass it. Confidence H for the component, M for the per-caller reasons.

4. **Mute-audio and mute-video entries are dead when the target already muted.** `Video/ActionMediaBox.svelte:194` and `:262` use `disabled={!$isMicrophoneEnabled}` / `!$isVideoEnabled`, styled only with `disabled:opacity-50` (no `cursor-not-allowed`, no text). Cascade: REMOVE the entry when the target is already muted, or EXPLAIN "Already muted". Confidence H.

5. **Lock-area picker and recording picker disable rows silently.** `PopUp/LockableAreaPicker.svelte:89` (`disabled={!canLock(entry)}`, `canLock` at `:46`) and `PopUp/Recording/RecordingSpacePicker.svelte:87` (`disabled={row.disabled}`). The person sees a faded row and no reason (no permission, someone else is recording). Fix: EXPLAIN with a second text line under the row, using `aria-disabled`. Confidence H for the lock picker, M for the recording picker (the row text at `:57-73` says who records, but not why Start is blocked).

6. **Camera and microphone toggles do nothing inside a silent zone, and the click is still counted.** `ActionBar/MenuIcons/CameraMenuItem.svelte:100-103` and `MicrophoneMenuItem.svelte:98-101` call `trackAdminEvent(...)` then `if ($silentStore) return;`. The banner `ActionBar/SilentBlock.svelte` explains it, but its detail text is hidden below `sm` until the banner is tapped (`SilentBlock.svelte:15`). Fix: on a blocked click, flash the banner's detail line open and move the analytics call below the guard. Confidence M.

7. **Application and attachment tiles use native `disabled` with the reason in body text.** `Chat/Components/Room/MessageInputBar.svelte:703`, `:719`, `:735`, `:751`, `:767`, `:783`, `:799`, `:815`, `:831`, `:847`, `:880`, `:903`, `:916`. The reason is shown in the tile, which is the right EXPLAIN step. What is missing: they are not focusable, and none points to the way out (who can enable it). Lower severity than 1-6. Fix: the same `aria-disabled` conversion, and a "ask an admin" hint only where the reason is a permission. Confidence M.

8. **Go-live is explained but not resolved.** `Modal/GlobalCommunicationModal.svelte:237-244` shows "needs camera or microphone" next to a disabled button, but offers no control to turn one on. Fix (RESOLVE): add an "Enable microphone" button that calls the existing `requestedMicrophoneState.enableMicrophone()`. Confidence H.

## Porta

1. **Sender name in chat messages is dead text.** `Chat/Components/Room/Message.svelte:318` (header) and `:358` (quoted reply) render `sender?.username` in a `<span>`. A person expects it to open actions (message, invite to meet, mention, profile). Fix: wrap with the same popover as the participant row (`openParticipantWokaMenu`, `ActionBar/MenuIcons/ParticipantMenuItem.svelte:337`) so the action order is the same everywhere. Confidence H.

2. **Message time is title-only.** `Message.svelte:335` puts the time in `title=` (mouse hover) and `:264` prints bare `{timeLabel}` text. Not clickable, and touch gets nothing for runs where the stamp is hidden. Fix: make the stamp a button opening a small popover (full date, copy link to message, jump to this point). Confidence H.

3. **Unread counters in the action bar and room list.** `ActionBar/MenuIcons/ChatMenuItem.svelte:~85-95` (`unreadMessagesCount`) sits inside the chat button, which is acceptable as a door. `Chat/Components/RoomList.svelte:480` and `:546` render `UnreadCount`; confirm it is clickable ("show only unread"). Confidence L, needs a check of `Chat/Components/UnreadCount.svelte`.

4. **Participant counts and names in the room list.** `Components/Exploration/MapList.svelte:184-188` prints `countEntity` / `countArea` as plain text. No action ("list them", "go to the first"). Confidence M.

5. **Status chips in the settings lists are plain text.** `EnableCamera/SelectCamera.svelte:126`, `SelectMicrophone.svelte:118`, `SelectSpeaker.svelte:75` show a "disabled" `Chip` with no click action (enable it, open the browser permission help). Confidence M.

## Habitos

1. **Habit 3, never lose work: every modal closes on Esc or backdrop with no dirty check (class fix).** `Modal/Popup.svelte:46-49` calls `modals.close()` on Escape, and `Modal/MainModal.svelte:9` closes on a backdrop click. Dialogs with typed content use this base: `Chat/Components/PollCreateDialog.svelte:126` (question and answers), `Chat/Components/Room/CreateRoomView.svelte`, moderation report text in `Moderation/ModerationModal.svelte`. A misclick loses it. Fix: let `Popup` accept `dirty` and, when true, replace the close with "Discard changes?" (or keep the state in a store and restore it on reopen). Confidence H for the mechanism, M for each dialog's content.

2. **Habit 3, the announcement composer drops the text on Esc.** `Announcement/AnnouncementComposerModal.svelte:41-43` closes on Escape and `close()` at `:36` unmounts the Quill editor. An announcement is high effort. Fix: keep the delta in a store until sent, or confirm on Esc with content. Confidence H.

3. **Habit 5, preview before external action: announcement to the room has no recipient count.** `AnnouncementComposerModal.svelte:50-58` confirms only when the audience is the whole world. The room send goes with one click and no "N people will receive this". The preview exists, but it does not name the audience size. Confidence M. See the product decisions.

4. **Habit 10, explain the cause: the connection toasts say that, not why.** `Toasts/WebsocketReconnectingToast.svelte:16-17` shows "Connection lost / Connecting..." with no attempt number, next retry time, cause, or manual "retry now" (the delay is computed in `Connection/ConnectionManager.ts:~541`, `getConnectionRetryDelay`). `Toasts/ConnectionIssueToast.svelte:17` shows "unable to connect" and has no action. Fix: pass `attempt`, `nextRetryInSeconds` and a Retry button, and say "your typed message is kept" (true for the chat draft). Confidence H.

5. **Habit 6, revert honestly: the announcement toast reports success before anything is known.** See Transparency item 1.

6. **Habit 9, "show what matters per role": admin-only disabled buttons.** The `|| $userIsAdminStore` pattern at `ActionBar/MenuIcons/AppsMenuContent.svelte:72`, `:82` and `MapSubMenuContent.svelte:166` shows greyed features to admins only, with no hint. It is a good idea (admins see what is off) but needs the "why and where to turn it on" from Clique item 1 to be useful. Confidence M.

7. **Habit 4, never ask what is known: `PopUpCameraAccesDenied` repeats the instruction in English only.** `PopUp/PopUpCameraAccesDenied.svelte:27` and `PopUp/PopUpSharingScreenAcessDenied.svelte:27` hard-code "See preferences" (not i18n). `WarningContainer/WarningBanner.svelte:61` hard-codes "This map is available for 2 days...". Confidence H; i18n is a smaller issue than the others but breaks the "same words everywhere" rule.

## Sinal

The base is good: `style/style.css:1-5` gives `cursor: pointer` to every `a`, `button`, `select`, and `[role=button]` rows in the participant list carry `cursor-pointer` (`ParticipantMenuItem.svelte:335`, `:425`). Remaining gaps:

1. **`ActionMediaBox` menu toggles on any key.** `Video/ActionMediaBox.svelte:137-142` has `role="button"` with `onkeydown={() => toggleActionMenu(...)}` and no key check, so Tab, Shift or an arrow key opens and closes the menu. The class on `:129` has `cursor-pointer` but covers the whole container, including non-clickable gaps. Fix: copy the Enter/Space check from `Chat/Components/Room/Message/MessageImage.svelte:71-78`. Confidence H.

2. **Clickable divs without a pointer or a key path.** `Components/Exploration/MapList.svelte:~150` (the room card `onclick` on the outer `<div>` has `cursor-pointer` only on the inner div; no keyboard, two `svelte-ignore` lines), `MapEditor/EntityEditor/EntityItem/EntityVariantPositionPicker.svelte:19` (`hover:cursor-pointer` div with `onclick` and no role or key), `Components/Modal/MainModal.svelte:9` (backdrop). Fix: use `<button>` for cards. Confidence H for MapList and EntityVariantPositionPicker.

3. **Disabled action bar buttons use `cursor-not-allowed`.** `ActionBarButton.svelte:135-137`, `:199-200`. This follows from Clique item 1; with `aria-disabled` and a visible reason the pointer should remain `pointer`, because a click now gives a response. Confidence M (it depends on the product reading of the rule).

4. **Toasts are not announced and cannot be closed from the keyboard.** `Toasts/ToastContainer.svelte:45-82` has no `role="status"` / `aria-live` and no close button. A toast with no `duration` (connection toasts, `BrowserAudioInterruptedToast.svelte`) stays until the app clears it. Information then travels by sight only. Confidence H.

5. **No sound on hover.** No hover audio found (`grep` of `mouseenter` + `play`). Compliant.

## Desfazer

The app uses confirm-before, not undo-after, for most changes. Confirm is correct for irreversible actions (guide), but reversible ones have no undo.

1. **Message delete uses confirm, with no undo and no named consequence beyond the dialog.** `Chat/Components/Room/MessageOptions.svelte:33-39` calls `confirmDelete("message", ...)`. For a message you wrote, a soft delete with a 10 s "Undo" would remove the dialog. Product decision (redaction in Matrix is not reversible server-side, so Undo needs a delayed send). Confidence M.

2. **Edit and react have no undo.** `MessageOptions.svelte:41-47` (`selectMessageToEdit`, `addReaction`) apply immediately. Reaction toggles are self-undoing (click again), which is fine. Confidence L.

3. **Mute audio/video of another person has no undo notice.** `Video/ActionMediaBox.svelte:188-194` calls `muteAudio(spaceUser)` and closes. For a moderator who mutes the wrong person there is no "Undo" and no confirmation of who was muted. Confidence M.

4. **Unclaim personal desk is one click and irreversible.** `ActionBar/MenuIcons/MapSubMenuContent.svelte:~203-208` (`unclaimPersonalDesk`) has no confirmation and no undo. Confidence M (the handler was not traced to the end).

5. **Kick, ban and block have a confirm step but no undo.** `Moderation/ModerationModal.svelte:192-196` (confirm titles) and `toggleBlock` at `:~102`. Confirm is acceptable for kick and ban per the guide; block is reversible by the same control, so it needs the notice. Confidence M.

6. **Where undo exists it is hidden.** The `Chat/Components/Room/MessageMoreMenu.svelte:40-45` copy action closes after 600 ms with a "copied" label (good) and swallows the failure with `console.error` (`:45`): a failed copy shows nothing. Fix: show "Could not copy" in the same label. Confidence H.

## Recorte

Lists here are small (chat rooms, users, maps), so the guide's panel and URL rules apply mostly to the chat room list and the map list.

1. **The map-list search is not in the URL and resets on close.** `Components/Exploration/MapList.svelte:26` holds `search` in local state; `onUpdateSearch` (`:58-70`) rebuilds the list on each input. Reloading or sharing opens the full list. Confidence H.

2. **The chat search value is a global store with no URL and no reset rule.** `Chat/Stores/ChatStore.ts:69` (`chatSearchBarValue`) is read by `Chat/Components/RoomFolder.svelte:47`, `Room/ProximityRoomRow.svelte:45` and `Room/Room.svelte:43`. The user-provider filter has to be reset separately (`Chat/Components/ChatHeader.svelte:38-47` carries a comment about this). Fragile: two sources of truth. Confidence M.

3. **No filter or sort panel on any list.** Only a text search exists. Not a violation to fix per screen, but the guide's single panel has no home. Needs a product decision.

4. **A search with zero results shows the same text as a load failure.** `MapList.svelte:134-135` prints `noRoomFound()` for both. It does not name the active filter or offer "clear search". Confidence H. See also Transparency item 2.

5. **Work-queue mode, "worked items leave and do not return".** Nothing in the front end matches a work queue. Not applicable.

## Transparencia and silent errors

1. **The announcement send reports success without knowing.** `Announcement/AnnouncementComposerModal.svelte:58-59` calls `handleSendText?.sendTextMessage(...)` then immediately adds the "sent" success toast and closes. `Menu/TextGlobalMessage.svelte:30-32` returns silently when `gameScene == undefined`, and `:44` emits with `gameScene.connection?.` (optional chaining), so a dropped connection still prints "sent to the world" while nothing was delivered. The editor text is also cleared at `:43` before the emit. Fix: make `sendTextMessage` return a boolean or throw, show the success toast only on true, and keep the text on failure. Confidence H.

2. **A failed room-list fetch looks like an empty list.** `Exploration/MapList.svelte:45-46` does `console.error(e)` in the catch, and the `finally` at `:48-50` still sets the filtered list to the empty map. The screen then shows "No room found" (`:134-135`), a fake empty list. Fix: an `error` state with the cause and a Retry button next to it. Confidence H.

3. **Chat search failures are swallowed into an empty result.** `Chat/Components/ChatHeader.svelte:39` (`searchAccessibleRooms`, `.catch(console.error)`) and `:27` (`setFilter` catch). The search spinner stops and the list shows nothing. Fix: show "Search failed, retry" under the search bar. Confidence H.

4. **Error toasts expire after 5 s with no detail.** `Toasts/TextToast.svelte:7` defaults to `duration = 5000` and `theme = "error"`, used for `Chat/Components/Room/ThreadPanel.svelte:37` (`openError`) and `Chat/Components/Room/RoomSidePanelPolls.svelte:31`, `:40`, `:51`. A toast alone as the only evidence of a failure is what the rule forbids. Fix: put the failure inline in the panel (the way `PollCard` does with `errorMessage`) and keep the toast as a secondary signal. Confidence H.

5. **`WarningToast` truncates the failure message and cannot be opened.** `WarningContainer/WarningToast.svelte:7` uses `h-6 whitespace-pre-line truncate text-ellipsis` on every message, so long text is cut with no way to read it, and there is no dismiss or detail. Confidence H.

6. **Chat chat-connection failure is only in the console.** See Clique item 2. Same for `Chat/Components/Room/RoomTimeline.svelte:276`, `:358`, `:639` (`console.error` after a retry path) and `Chat/Components/RoomList.svelte:130`, `:650` (`Failed to initChatConnectionEncryption`). The timeline has `historyLoadFailed` (`:344-347`), which is correct; the other three have no UI. Confidence M.

7. **Failure memory and granular states do not exist for background work.** Recording (`Stores/RecordingStore.ts:170-179`), uploads (`Phaser/Game/MapEditor/Commands/File/UploadFileFrontCommand.ts`), and proximity file transfer (`Chat/Connection/Proximity/ProximityFileTransferService.ts`) report start and end only. The delivery states of the guide (Aguardando, Tentando de novo, Falhou) are only partly present in `Chat/Components/Room/Message/MessageAttachmentRecipients` (per-recipient delivery). Needs a product decision.

8. **Numbers are not doors.** Counts (`ChatMenuItem.svelte` unread, `MapList.svelte:184-188`, `Chat/Components/RoomList.svelte:480`) open nothing, and zero counts are hidden. See the product decisions.

## Needs a product decision

1. **Undo versus confirm for chat delete and moderation actions.** Matrix redaction cannot be reversed server-side. Options: delay the redaction by 10 s with an Undo notice, or keep the confirm and state in the dialog what is lost. Pick one policy for the whole front end.
2. **What counts as "external action" in a virtual office.** Is an announcement to the current room one (it reaches every person present, instantly)? If yes, add a recipient count and a confirm, as the world audience has today (`AnnouncementComposerModal.svelte:52-55`).
3. **Do admins keep greyed-out features?** The `|| $userIsAdminStore` entries (`AppsMenuContent.svelte:72`, `:82`; `MapSubMenuContent.svelte:166`) show off features to admins. Keep them with "why and where to enable", or REMOVE them everywhere.
4. **Single filter, sort and group panel.** Today only free-text search exists on the chat list and the map list. Decide whether the guide's panel applies to these small lists, or only when a table-style list is introduced. Decide if the URL should carry the search (`?q=`) in a game page that already uses the hash for `moveTo`.
5. **"Every number is clickable" for presence and unread counts.** What would the side sheet show for "3 unread" or "12 people in this room"? It needs a definition per number before any component work.
6. **Toast policy.** Which messages are ephemeral (5 s), which stay until acted on, which must also appear in a panel. A rule like "an error toast always has a persistent inline twin" would close Transparency items 4 and 5.
7. **Operational panel for background failures** (uploads, recording, delivery). Where does it live in a Phaser-first UI, and who sees it (the person who started it, or admins)?
8. **Granular delivery states and failure memory for chat attachments.** Which of the seven states apply to proximity files, and whether the history of a recovered retry is shown.

## Landed (session 2)

Paths relative to `play/src/front`.

- `Components/Video/ActionMediaBox.svelte:139` (Sinal 1). Before: `onkeydown={() => toggleActionMenu(!moreActionOpened)}` (any key, including keys bubbling from the inner buttons, toggled the menu). After: toggles only on Enter or Space pressed on the container itself (`event.target === event.currentTarget`), with `preventDefault`, same pattern as `MessageImage.svelte`.
- `Components/Video/ActionMediaBox.svelte:192`, `:260` (Clique 4, signal part only). Before: `disabled:opacity-50`. After: `disabled:opacity-50 disabled:cursor-not-allowed`, so the global `button { cursor: pointer }` no longer promises an action on the dead mute entries.
- `Chat/Components/Room/MessageInputBar.svelte:623` and the 13 application/attachment tiles (`:701`-`:925`) (Clique 7). Before: native `disabled={X}` (tile left the tab order; the reason was already printed in the tile) and `disabled:opacity-50`. After: `aria-disabled={X}` with the click guarded (`if (X) return;`) in each `onclick`, and `aria-disabled:opacity-50 aria-disabled:cursor-not-allowed` in `applicationButtonClass`. Tiles are now focusable and a screen reader reads the existing reason as part of the button name. No new copy.
- `Components/Toasts/ToastContainer.svelte:73` (Sinal 4, announcement part). Before: message body had no live role. After: `role={theme === "error" ? "alert" : "status"}`.
- `Components/MapEditor/EntityEditor/EntityItem/EntityVariantPositionPicker.svelte:17` (Sinal 2). Before: `<div class="hover:cursor-pointer" onclick>` with two `svelte-ignore` lines. After: `<button type="button" class="m-0 p-0 bg-transparent border-0 cursor-pointer" aria-pressed={selected}>`; the image `alt` gives the name.
- `Components/Exploration/MapList.svelte:144` (Sinal 2). Before: room card `<div onclick>` with two `svelte-ignore` lines and `cursor-pointer` only on the thumbnail. After: `role="button" tabindex="0"`, Enter/Space `onkeydown` calling `clickRoom`, `cursor-pointer` on the whole card.

Prettier check passes on all touched files.

## Skipped

- Sinal 3 (ActionBarButton `cursor-not-allowed`): only correct once Clique 1 gives a click response; without it the not-allowed cursor is the honest signal.
- Sinal 5: already compliant.
- Porta 3: confidence L, needs a check, no fix defined.
- Clique 6 (move `trackAdminEvent` below the silent guard): analytics behaviour change, not a visual refinement.

## Parked

- Clique 1 / Habit 6 (ActionBarButton `blockedReason` + aria-disabled): callers have no reason text in i18n; converting without a reason would make a focusable dead button. Needs new copy.
- Clique 2 / Transparency 6 (chat connection failure, retry): new state, new copy, new behaviour.
- Clique 3 (shared `Button` aria-disabled + `disabledReason`): cross-cutting change to submit semantics (Enter in forms would submit), and per-caller reasons need new copy.
- Clique 4 (explain or remove the dead mute entries): "Already muted" does not exist in i18n; removing is a feature change. Only the cursor was landed.
- Clique 5 (lock and recording picker reasons): no existing i18n line for "no permission" / "someone else records".
- Clique 8 (Enable microphone button on go-live): new control.
- Porta 1, 2, 4, 5; Transparency 8: new popovers or actions.
- Habits 1-4: dirty checks, recipient count, retry info need new copy and behaviour. Habit 7: hard-coded English strings need new i18n keys.
- Sinal 4 (toast close button): new control and label.
- Desfazer 1-6: undo/notice and "Could not copy" need new copy or product decisions.
- Recorte 1-4, Transparency 1-5, 7: new states, copy, or URL behaviour (announcement success before send, room list error state, search failure, inline errors, WarningToast detail).

## Sprint 4: chat-failure

Clique 2 / Transparency 6. Paths relative to `play/src/front`.

### Landed

- `Chat/Stores/ChatConnectionFailureStore.ts` (new). Before: nothing remembered a chat outage. After: `ChatConnectionAttemptStatus` ("connecting" | "retrying" | "failed" | "ready") and `chatConnectionFailureStore` (failure memory: `failedAt`, `recoveredAt`; a failed retry keeps the outage start; `dismiss()`). Covered by `Chat/Stores/ChatConnectionFailureStore.test.ts` (4 tests, pass).
- `Phaser/Game/GameManager.ts:82` and `:456-480`. Before: `getChatConnection()` gave no observable state; a rejection only reached each caller's `console.error`. After: `chatConnectionAttemptStore` moves connecting -> failed -> retrying -> ready; a rejection marks "failed" and records the outage, then still rethrows to the caller (GameScene keeps logging and reporting it). A void connection, re-opened on every call, no longer flashes back to "connecting" once ready.
- `Phaser/Game/GameManager.ts:487`. New `retryChatConnection()`: re-runs the same `getChatConnection()` path; its rejection is logged and sent to Sentry (no silent catch).
- `Phaser/Game/GameManager.ts:569`. The Matrix `connectionStatus` feeds the failure memory (ON_ERROR = failure, ONLINE = recovery), so an outage is remembered even when the chat panel is closed. Subscription released, memory cleared and attempt reset in `logout()`.
- `Components/ActionBar/MenuIcons/ChatMenuItem.svelte:37-40`, `UserListMenuItem.svelte:25-28`. Before: own `getChatConnection()` call with `.catch(console.error)`; on failure the button stayed disabled forever with no reason. After: `chatAvailable` derives from the attempt store; a failed attempt keeps the button clickable so the panel opens on the failure and its Retry. Only a pending attempt keeps it disabled (existing loading behaviour).
- `Chat/Components/Chat.svelte:36-43`. Before: with no connection object the panel showed "Connecting to server ..." forever, even after a failure (fake loading). After: failed -> `ChatError` with a Retry wired to `gameManager.retryChatConnection()`; retrying -> loader "Retrying the chat connection…"; otherwise the existing connecting loader.
- `Chat/Components/ChatError.svelte`. Before: "Chat not available / The map, video and audio keep working." with a Retry that gave no feedback. After: adds the impact line ("Messages cannot be sent or received until it reconnects."), "Unavailable since HH:MM" from the failure memory, a visible "Retrying…" status (`role="status"`, spinner with `motion-reduce:animate-none`) after Retry, and, if the block is still there 15 s later, "The chat is still unreachable. Retry again, or reload the page if it keeps failing." with Retry again. New optional `retry` prop (defaults to the old `chatConnection.retryConnection()`); timer cleared in `onDestroy`.
- `Chat/Components/RoomList.svelte:90-99`, `:373-389`. Failure memory after a recovery: a `role="status"` notice "The chat is back. It was unavailable from {from} to {to}." with a dismiss icon button (aria-label, cursor-pointer, 26 px target).
- `Chat/Components/ChatLoader.svelte:11-12`. `role="status"` and `motion-reduce:animate-none` on the spinner.
- i18n `en-US/chat.ts:662-667`, `pt-BR/chat.ts:662-667`: `chat.connectionErrorImpact`, `chat.connectionErrorSince`, `chat.connectionRetrying`, `chat.connectionRetryFailed`, `chat.connectionRecovered`, `chat.connectionRecoveredDismiss`.

### Decisions

- Reused the existing in-panel `ChatError` block (already shown for ON_ERROR) instead of a new component; a toast was not added.
- "Retrying" for the Matrix ON_ERROR case cannot observe a second failure (the status store does not re-emit ON_ERROR), so a 15 s window decides: if the error block is still mounted, the chat is still in error, which is what the message says.
- The action-bar items no longer open a connection themselves: `GameScene.create` already calls `getChatConnection()`, and the items only needed its outcome.
- Existing key values were not reworded, so the other locales stay correct; the impact is a new key shown next to them.

### Not done

- Retry after a failed Matrix `init()` with no client (`retryConnection()` returns false) still offers only "Reload the page": re-running init needs a new client from GameManager, and opening a second Matrix client in the same tab risks IndexedDB corruption (see the `getChatConnection()` comment). Needs a client factory in `MatrixChatConnection`.
- A failed download of the Matrix chunk (`GameManager.openChatConnection`, "Could not load the Matrix chat") still falls back to a void chat with no panel message: making it reject would also break the user list setup in `GameScene` that chains on `getChatConnection()`.
- Transparency 6 timeline and encryption `console.error` paths (`RoomTimeline.svelte:276`, `:358`, `:639`, `RoomList.svelte` `initChatConnectionEncryption`): outside this unit.

## Sprint 4: blocked

Paths relative to `play/src/front`.

### Landed

- `Components/ActionBar/ActionBarButton.svelte:19-21`, `:102-118`, `:166-172`, `:198-210`, `:228-276` (Clique 1, Sinal 3). Before: native `disabled` (click swallowed, out of the tab order, `handleClick` guard dead), reason only in a hover tooltip. After: new `blockedReason?: string` prop. With it a blocked button renders `aria-disabled="true"` (stays focusable), `aria-describedby` points to the reason, keeps `cursor-pointer`, and a click or Enter shows the reason in a one-line notice under the button (hidden again on blur or mouse leave; the help tooltip is hidden while it shows). In a menu row the reason is always visible as a second line under the label, and only the icon and label are dimmed. Without `blockedReason` the old native `disabled` behaviour is kept.
- Callers with a reason: `ActionBar/MenuIcons/AppsMenuContent.svelte:81` (calendar off), `:92` (to-do list off), `MapSubMenuContent.svelte:169` (room list off), `:202` (already at my desk), `ScreenSharingMenuItem.svelte:41` (screen sharing off by the map), `ChatMenuItem.svelte:76` and `UserListMenuItem.svelte:37` (chat still connecting; the failed case already opens the panel with Retry, landed by another unit).
- `Components/UI/Button.svelte:16-20`, `:58-76`, `:120-141` (Clique 3). Before: `{disabled}` straight on `<button>`. After: new `disabledReason?: string` (rendered as a `basis-full` line after the button, tied by `aria-describedby`) and `disabledReasonId?: string` (points to a line the caller already shows). With either, the button uses `aria-disabled`, stays focusable, and the click is guarded with `preventDefault` (which also stops the form submit, including the implicit one from Enter). A caller's own `aria-describedby` is kept when there is no reason. Without a reason the native `disabled` stays.
- Button callers: `Announcement/AnnouncementComposerModal.svelte:201` ("Write a message to send it."), `Chat/Components/PollCreateDialog.svelte:220` (existing `chat.poll.create.validationError` when the question or answers are missing; row gets `flex-wrap`), `Chat/Components/Room/CreateRoomView.svelte:268` ("Enter a name to create it."), `Chat/Components/Room/RoomSidePanelSettings.svelte:531` ("Change a setting to save it." / "Enter a room name to save."; row gets `flex-wrap`).
- `Components/Video/ActionMediaBox.svelte:193-220`, `:275-297` (Clique 4). Before: native `disabled`, dimmed, no text. After: `aria-disabled`, click guarded, a second line "Already muted" / "Video already off" under the label (icon and label dimmed, reason at full contrast).
- `Components/PopUp/LockableAreaPicker.svelte:83-112` (Clique 5). Before: `disabled={!canLock(entry)}`, faded row. After: `aria-disabled`, existing click guard kept, second line "You cannot lock this area. Ask an admin for the right to lock it."
- `Components/PopUp/Recording/RecordingSpacePicker.svelte:76-82`, `:89-93` (Clique 5). Before: a row recorded by someone else had no Start button and no reason. After: a second line "Only one recording at a time here. You can start yours when this one ends."; the action button uses `aria-disabled` (the existing `handleSelect` guard stays).
- `Components/Modal/GlobalCommunicationModal.svelte:114`, `:235-262` (Clique 8). Before: "needs camera or microphone" next to a disabled Go live button. After: a "Turn on microphone" button beside the warning that calls `requestedMicrophoneState.enableMicrophone()`, and Go live uses `disabledReasonId` so it stays focusable and is described by the warning line.
- i18n (en-US, pt-BR): `actionbar.blocked.*` (6), `actionbar.help.lock.noPermission`, `camera.menu.alreadyMuted`, `camera.menu.videoAlreadyOff`, `megaphone.announcement.emptyMessage`, `megaphone.modal.liveMessage.enableMicrophone`, `recording.actionbar.spacePicker.recordedByOther`, `chat.createView.nameRequired`, `chat.roomPanel.settings.nothingToSave`, `chat.roomPanel.settings.nameRequiredToSave`.

### Decisions

- aria-disabled only when a reason is given. Converting every disabled `Button`/`ActionBarButton` would make focusable dead buttons with no reason (the rule this unit fixes); callers without a reason keep native `disabled` until they get one.
- Action bar icons show the reason on click or Enter, not permanently: a permanent line per icon does not fit the bar. Menu rows show it permanently. Screen readers get it on focus through `aria-describedby`.
- Admin-only "module off" entries (calendar, to-do, room list) explain and point to the admin settings instead of redirecting: the front end has no reliable deep link to the per-world module settings.
- Busy states (saving, creating, submitting) keep native `disabled` with no reason: the label or spinner already says what is happening.
- Mute entries: EXPLAIN ("Already muted") rather than REMOVE, so the menu keeps its shape and the state is visible.
- Playwright `toBeDisabled()` (e.g. `tests/tests/iframe_script.spec.ts:112` on `screenShareButton`) honours `aria-disabled`, so the e2e assertions still hold.

### Not done

- Poll create blocks other than "missing question or answers" (no right to create, text too long) keep a plain disabled button: no per-case copy, and length errors belong to the field.
- Room settings Cancel button keeps native `disabled` when nothing changed: not listed in the finding.
- `heldOff` (status dot) buttons keep native `disabled`: none of the listed callers, and the status itself is the explanation.
- No checks run (orchestrator runs them at the end); only Prettier on the touched files.

## Sprint 4: toasts

Covers Sinal 4 (this file) and Live 2-4 (`accessibility-motion.md`). Paths relative to `play/src/front`.

### Landed

- `Components/Toasts/ToastContainer.svelte:164-180` (Sinal 4). Before: no close control; the live role sat on the row. After: the live role (`alert` for errors, `status` otherwise) sits on the message only, and a `<button type="button">` with `aria-label`/`title` `notification.closeToast` ("Close notification"), 32 px, `cursor-pointer`, `data-testid="toast-close-button"`, is rendered whenever the toast has a `toastUuid` or an `onClose`. New optional prop `onClose` replaces the default `toastStore.removeToast(toastUuid)`.
- `Components/Toasts/ToastContainer.svelte:31-128`, `:155` (auto-dismiss). Before: a fixed `setTimeout(duration)`; error toasts used 4-5 s. After: error toasts never auto-dismiss in under 10 s (`ERROR_MIN_DURATION_MS`); pointer hover or keyboard focus inside the toast pauses the timer (remaining time kept) and the progress bar (`animation-play-state: paused`). Listeners use an `AbortController` aborted in `onDestroy`.
- `Stores/ToastStore.ts:32`, `:54-85`. Before: `removeToast` on a source toast (audio interrupted, audio blocked) did nothing. After: closing hides the source toast until its source emits a different value. Covered by the new `Stores/ToastStoreDismiss.test.ts` (3 tests, passing with the existing `ToastStore.test.ts`).
- `Components/Toasts/BrowserAudioInterruptedToast.svelte:5-12`, `BrowserNoSoundInfoToast.svelte:9-13`. Before: ignored the injected `toastUuid`. After: declare and forward it, so they get the close button.
- `Components/Toasts/NoMicrophoneSoundToast.svelte:35`. After: `onClose={closeToast}`, so closing behaves like "Ignore" (marks the device as checked).
- `Chat/Components/Room/ThreadPanel.svelte:35-41`, `:183-190` (persistent trace). Before: a failed thread open was shown only as a 5 s toast. After: the same message also stays under the thread row until the next attempt.
- `Chat/Components/Room/RoomSidePanelPolls.svelte:28-36`, `:155-159` (persistent trace). Same for the poll focus failures, under the poll card.
- `i18n/{en-US,pt-BR}/chat.ts:256`, `:588`. Before: "Unable to open this thread." / "Unable to open this poll in the timeline." After: "Could not open this thread. Select it again to retry." / "Could not show this poll in the conversation. Select it again to retry." (pt-BR equivalents). Changed existing keys: the other locales keep the old text until translated.
- `Components/ProximityNotification/ProximityNotificationContainer.svelte:9` (Live 2). Before: the list was mounted with its first notification and had no live region. After: an always-mounted `aria-live="polite" aria-relevant="additions"` wrapper around it.
- `Chat/Components/Room/RoomTimeline.svelte:117-119`, `:471-485`, `:891-897` (Live 3). Before: incoming messages in the open room were silent. After: a visually hidden polite region reads "{name} sends a message" (existing `notification.message`) for each new message from someone else. Back-pagination and timeline rebuilds are not announced (same `countIncomingMessagesAfter` guard as the jump button).
- `Stores/LiveAnnouncementStore.ts`, `Components/LiveAnnouncer.svelte` (new), mounted at `Components/MainLayout.svelte:84`, `:346`; fed by `Chat/Connection/Proximity/ProximityChatRoom.ts:481-511` (Live 4). Before: bubble joins and leaves were only a line in the proximity chat. After: the same line ("{userName} joined the discussion", "has left", "new discussion with") is also announced politely, even with the chat closed.

### Decisions

- Live roles: kept the existing split (error = `alert`/assertive, others = `status`/polite) and moved it to the message node only, so the close and action buttons are not read as part of the announcement.
- Error floor of 10 s plus pause on hover and focus, rather than errors that never expire: connection errors already persist (no duration) until the state clears, and every timed error now has a close button.
- Live 3 (product decision 4): no `role="log"` on the `<ul>`. It would drop list semantics and read whole history pages on scroll-up. A one-line "who wrote" announcement keeps fast channels short; the message body is one keystroke away.
- Live 4 (product decision 3): bubble only (meeting-room chats are already skipped by `isMeetingRoomChat`), and each announcement replaces the previous one, so a burst reads as its last line rather than a backlog.
- Closing a source toast hides it until the source changes, instead of muting it for the session: a new blocked sound or a new interruption is new information.

### Not done

- Persistent trace for `MeetingInvitationLimitToast` and `MeetingInvitationDeclinedToast`: the invite is sent from the user-list dropdown, which closes on click, so there is no element left to carry the state. They now stay at least 10 s, pause on hover/focus and can be closed.
- Poll focus failure after the panel switched to the threads section (`RoomSidePanelPolls.svelte:44`): the polls panel is no longer shown, so only the toast remains for that case.
- `AnnouncementComposerModal` success before send (Transparency 1) and connection toast retry details (Habit 10): owned by other units.
- Focus return after closing a toast: focus falls back to the document; the toast stack has no stable previous focus target.
- No checks run beyond Prettier on the touched files and the focused vitest file.

## Sprint 4 review round: blocked

Landed

- `play/src/front/Components/ActionBar/ActionBarButton.svelte:177-181` (icon-only, non-menu button). Before: the blocked reason stayed `sr-only` until a click or Enter set `reasonRequested`. After: `onfocus` and `onmouseenter` also set `reasonRequested = explained`, so sighted pointer and keyboard users see the one-line reason as soon as they hover or tab to the button. `onblur` and `onmouseleave` still hide it; `aria-describedby` is unchanged. The help tooltip is already suppressed while `reasonShown`, so the two never overlap. Comment at line 205 updated to match.

Decisions

- Kept the reason hidden at rest instead of rendering it by default: the action bar has no room for a persistent caption under each icon, and hover/focus satisfies "visible without click".

Rejected

- None.

## Sprint 4 review round: chat-failure

Paths relative to `play/src/front`.

### Landed

- `Phaser/Game/GameManager.ts:67`, `:466-473`, `:532`, `:557` (finding 2). Before: a failed download of the Matrix chunk returned a void connection, the attempt went "ready" and the failure was only in the console. After: the catch sets `matrixChatLoadFailed`; `getChatConnection()` then marks the attempt "failed" and records the outage instead of "ready" (and skips the void "recovery"). The void connection is still returned, so GameScene's chains are unaffected, and Retry downloads the code again because a void connection is not memoised.
- `Chat/Components/Chat.svelte:27-30`, `:42-51` (findings 2 and 3). Before: the error showed only with no connection object, and "retrying" swapped it for a loader, unmounting `ChatError`. After: `ChatError` shows whenever the attempt is "failed" or "retrying", above the regular content when a void connection exists (proximity chat keeps working under it), and stays mounted while retrying.
- `Chat/Components/ChatError.svelte:14-16`, `:29-41`, `:53-58`, `:88` (finding 3). New optional `retryPending` prop. When given, "Retrying…" follows it, and a retry that ends while the block is still shown sets the "still unreachable" message; the 15 s timer is used only when the caller cannot observe the retry (the Matrix ON_ERROR banner in RoomList).

### Decisions

- Finding 2: the panel branch now keys on the attempt status, as suggested, but does not hide the room list when a void connection exists: proximity chat works without Matrix.

### Rejected

- Finding 1 (rejected `chatConnectionPromise` memoised forever): `MatrixChatConnection.init()` catches every error and sets `connectionStatus` to "ON_ERROR", so `init().then(() => matrixChatConnection)` never rejects. The paths that do reject (`isChatEnabledOnCurrentRoom()`, building the client wrapper) run before `chatConnectionPromise` is assigned, so Retry does start a new attempt and sets "retrying". Re-running a failed init on purpose would open a second Matrix client in the tab (see "Not done" in Sprint 4: chat-failure).

### Not done

- No checks run (orchestrator runs them at the end).

## Sprint 4: never-lose-work

Paths relative to `play/src/front`. Line numbers are after the change.

### Landed

- Transparency 1 / Habit 5 (honest send). `Components/Menu/TextGlobalMessage.svelte:33-48`. Before: `sendTextMessage` returned `void`, cleared the editor first, then emitted through `gameScene.connection?.` (a missing or dropped connection was silent). After: returns `boolean`; refuses (`false`, text kept) when there is no connection, it is closed, or the socket is not open (`connection.socket.isOpen()`); clears the editor only after `emitGlobalMessage`.
- Transparency 1. `Components/Announcement/AnnouncementComposerModal.svelte:74-80`, `:178-188`. Before: success toast and close right after the call, whatever happened. After: success toast and close only on `true`; on `false` an inline `role="alert"` line (`megaphone.announcement.sendFailed`) next to Send, modal stays open with the text; the line clears on the next edit.
- Habit 2 (announcement drops text on Esc). `AnnouncementComposerModal.svelte:1-4`, `:33-46`; `TextGlobalMessage.svelte:69-76` (new `initialContent` prop). Before: Esc/close unmounted Quill and lost the text. After: a module-level draft (delta, audience, place) is saved in `onDestroy` unless sent, and restored on the next opening. Esc stays a one-key close.
- Habit 1 (modal dirty check, class fix). `Components/Modal/Popup.svelte:15-53`, `:62-66`, `:140-162`; `Components/Modal/modalManager.ts` (re-exports `getModal`). Before: Esc, backdrop, close button and Cancel closed with typed content. After: optional `isDirty: () => boolean`; when set, Popup installs the modal's `onBeforeClose` guard and shows an inline "You typed something here. Close and lose it?" bar with "Keep editing" (focused) and "Discard text"; a second Esc means keep editing. Popups that register their own `onBeforeClose` (Matrix dialogs) do not pass it, so nothing changes for them.
- Habit 1 callers. `Chat/Components/PollCreateDialog.svelte:111` (question or any answer typed, cleared on successful create); `Components/Moderation/ModerationModal.svelte:203` (report text or kick/ban reason typed, cleared on submit).
- Habit 1 (create room/folder view). `Chat/Components/Room/CreateRoomView.svelte:1-6`, `:43`, `:55-66`. Before: Back, Esc or closing the chat lost name, topic and invites. After: module-level draft per kind and parent folder, saved on unmount unless created, restored on reopen.
- Desfazer 5 (block is reversible). `Components/Moderation/ModerationModal.svelte:108-128`. Before: block/unblock closed the modal with no notice. After: `UndoToast` naming who ("{userName} is blocked...") with "Unblock" / "Block again" calling `blackListManager` back.
- New `Components/Toasts/UndoToast.svelte`. Message + one specific-verb action button in the existing `ToastContainer` `buttons` snippet; own 10 s timer that pauses on pointer hover and while focus is inside (WCAG 2.2.1); listeners removed on destroy.
- Moderation silent send (no fake success). `ModerationModal.svelte:144-150`, `:286-295`. Before: `connection?.emitReport...` / `emitBan...` then close, even with no connection. After: no connection or closed connection shows `report.moderate.sendFailed` inline, keeps the text and the modal.
- Desfazer 6 (copy failure). `Chat/Components/Room/MessageMoreMenu.svelte:36-52`, `Chat/Components/Room/MessageActionSheet.svelte:44-56`. Before: failure only in `console.error`, label unchanged. After: label reads "Could not copy" (`chat.copyFailed`) and the menu stays open; the 600 ms close timer is cleared on destroy.
- Copy honesty elsewhere. `Components/EmbedScreens/CoWebsiteTab.svelte:46-61`. Before: "Url copied" popup shown before/regardless of `writeText`. After: popup and analytics only on success; error toast `notification.copyFailed` on failure. `Components/Menu/GuestSubMenu.svelte:27`, `:82-89`, `:187-191`: failure now shows the same message inline under the (already selected) link field.
- Desfazer 1 (delete is final, name what). `Chat/Components/Room/confirmDeleteMessage.ts:7-34`; callers `MessageOptions.svelte` and `MessageActionSheet.svelte`. Before: "Delete this message?" with no content and no "final" statement. After: title names the message (`chat.confirm.deleteMessageNamedTitle`, one-line excerpt of 60 chars) and the dialog warning says "This cannot be undone." (also for polls).
- Desfazer 4 (unclaim desk). `Components/ActionBar/MenuIcons/MapSubMenuContent.svelte:118-142`. Before: one click, irreversible, no confirmation. After: `ConfirmDialog` naming the desk (`actionbar.personalDesk.unclaimConfirmTitle`) and that someone else may claim it at once; a failure throws inside `onConfirm` so the dialog keeps its error and retry instead of a far-away warning.
- Desfazer 3 (mute another person). `Components/Video/ActionMediaBox.svelte:50-95`. Before: menu closed, no confirmation of who. After: success toast naming the person, different for a moderator mute ("Only they can turn it back on") and a request ("was asked to...").
- Habit 4 (connection toasts). `Connection/WorkAdventureWebSocket.ts:82-96` (new `reconnectNow()`), `Connection/ConnectionManager.ts:534-538`, `Components/Toasts/WebsocketReconnectingToast.svelte` (runes, `onRetry` prop). Before: "Connection lost / Connecting...", no next step. After: "Trying again automatically. What you typed stays in place." plus a "Try again now" button that skips the backoff wait. `Components/Toasts/ConnectionIssueToast.svelte:14-21`: adds the next step line `error.connectionRetry.retrying`.
- Habit 7 (hard-coded English). `PopUp/PopUpCameraAccesDenied.svelte:29`, `PopUp/PopUpSharingScreenAcessDenied.svelte:29`: "See preferences" became the existing `actionbar.microphone.openSettings` ("Open settings"). `WarningContainer/WarningBanner.svelte:61`: "This map is available for 2 days... here!" became `warning.limitMap` plus a descriptive link `warning.registerDomain`.

### Decisions

- "After the send resolves": the global message has no server acknowledgement (`emitGlobalMessage` is fire-and-forget). The honest boundary is "handed to an open socket". A reconnecting socket is refused rather than queued, because the outgoing queue would replay it later and a resend would duplicate it.
- Drafts over "Discard?" for the announcement composer and the create-room view: both are reached again from the same entry point, so restoring costs nothing and Esc keeps working as one key. Popups (poll, moderation) are opened per target, so they ask instead.
- One close guard per modal: `Popup` only takes over `onBeforeClose` when `isDirty` is passed, so the Matrix dialogs that already guard their close keep their logic.
- Undo only where an existing API reverses the change (block). Message delete (Matrix redaction), desk unclaim (someone may claim it at once) and muting someone else (no remote unmute) are irreversible: delete and unclaim get a confirmation naming what, mute (low impact, the person can unmute) gets a notice naming who, not a dialog.
- `PopUpCameraAccesDenied` and `PopUpSharingScreenAcessDenied` are not imported anywhere today; translated anyway so they do not regress when revived.

### Not done

- Habit 3 (recipient count for a room announcement): the front end has no reliable room-wide headcount (`playersStore` only holds players in the visible zones; the chat user list is async and provider-dependent). A wrong number is worse than none. Needs a server count or product decision 2.
- Desfazer 2 (edit undo): editing again is the existing way back; an Undo would live in `MessageInputBar.svelte`, owned by other units this sprint. Reactions are already self-undoing.
- Desfazer 5, kick and ban: already confirmed with the name in the title; no reverse API from the front end (unban lives in the admin). Unchanged.
- Habit 4, attempt number and next-retry countdown: `WorkAdventureWebSocket.reconnectingStream` only carries a boolean; exposing the attempt counter is a wider API change than "Try again now" needed.
- Typed-content guard for `ConfirmDialog`'s optional reason field: a short optional line, not passed `isDirty` to keep the shared dialog unchanged.
- `Stores/GuestMenuStore.ts` `copyLink` / `shareLink`: no caller in the code base, left as is.

## Sprint 4: doors

Porta 1, 2, 4, 5; Transparency 1-5, 7, 8; Recorte 1-4. Paths relative to `play/src/front`.

### Landed

- `Chat/Components/UserList/UserActionButton.svelte:25-28`, `:71-77`, `:83-86`, `:211-235` (Porta 1, enabler). Before: the user menu could only be opened from its "..." icon in the user list. After: optional `trigger` snippet and `triggerLabel`; with a trigger the button wraps that content (`cursor-pointer`, hover underline, focus outline, `aria-expanded`). The passed user is completed from the user list entry (same `chatId` or `uuid`) so a message sender gets room, uuid and business card; when no menu entry applies, the trigger renders as plain text (no click into an empty menu). `buttonElement` became `$state`, so the click-outside listener is attached when the button appears later.
- `Chat/Components/Room/Message.svelte:331`, `:387` (Porta 1). Before: the sender name in the header and in the quoted reply was a dead `<span>`. After: both open the user list's action menu (talk to, follow, invite, business card, moderate), labelled `chat.a11y.optionsFor` ("Options for {name}"). My own name in a quote stays text.
- `Chat/Components/Room/Message.svelte:135`, `:267`, `:352`; `Chat/Components/Room/MessageActionSheet.svelte:85-92` (Porta 2, date part). Before: time only as "HH:MM", the hidden stamp of a run only in a hover `title`. After: the stamp is a `<time datetime>` whose `title` gives the full date and time; the run's bubble `title` gives the full date too; the long-press sheet (the touch path) shows the full date and time at its top.
- `Chat/Components/OnlineUsersCount.svelte:24-35` (Transparency 8, Porta 4 in spirit). Before: "12 users online" in the chat header was text. After: from the conversations view it is a button that opens the user list (`navChat.switchToUserList()`); in the user list it stays text.
- `Chat/Components/RoomList.svelte:508-522`, `:584-602` (Transparency 8). Before: the unread count of a collapsed "People" or "Rooms" section opened nothing. After: it is a button ("Show the unread conversations", existing key) that expands that section; the Rooms one stops propagation so the header's own toggle does not close it again.
- `Components/Exploration/MapList.svelte:42-65`, `:156-174` (Transparency 2, Recorte 4). Before: a failed fetch (or no connection) was `console.error` and then "No room found", the same text as an empty search. After: three states. Fetch failure: `role="alert"` "Could not load the room list" / "You stay in your current room. Check your connection, then try again." with a "Load rooms again" button (logged with `asError` and sent to Sentry). Search with no match: 'No room matches "{search}".' with a "Clear search" button. Empty world: "No room is available in this world yet."
- `Components/Exploration/MapList.svelte:1-6`, `:33`, `:79` (Recorte 1). Before: the search reset every time the room list closed. After: kept in a module-level store and restored on reopen (until a page reload). `onUpdateSearch` now builds the filtered map and sets it once (`:80-92`): it used to mutate the store's map after setting it empty.
- `Chat/Components/ChatHeader.svelte:28`, `:65-90`, `:168-182` (Transparency 3, Recorte 2). Before: the room search and the user filter each had a `.catch(console.error)`; a failure looked like "no result". After: one `runSearch()` applies the same text to both sources (`Promise.allSettled`), logs each rejection, and shows "Search failed. The list may be missing results." (`role="alert"`) under the search bar with a "Search again" button. Clearing or closing the search clears the failure.
- `Components/WarningContainer/WarningToast.svelte:10-30`, `Stores/ErrorStore.ts:112-114` (Transparency 5). Before (after the truncation fix from another unit): no way to dismiss, no live role. After: each message has `role="alert"`, and closable messages get a 32 px close button (existing `notification.closeToast` label, `cursor-pointer`, focus outline) that calls the new `warningMessageStore.removeWarningMessage(id)`.
- i18n (en-US, pt-BR): `mapEditor.listRoom.noRoomAvailable`, `noRoomMatch`, `clearSearch`, `fetchFailedTitle`, `fetchFailedDetail`, `retryFetch`; `chat.searchFailed`, `chat.searchRetry`.

### Decisions

- Porta 1 reuses the chat user list menu (`UserActionButton`), not `openParticipantWokaMenu`: the woka menu only opens for someone rendered on the current map, while chat senders can be anywhere or offline. The entries are the user list's, in the same order.
- Recorte 1: the search survives closing the panel, not the URL. The game URL already uses its hash for `moveTo` and the room list is a popup over the game, so a `?q=` would be shared state with no landing page to read it (product decision 4 stays open for the URL).
- Recorte 2: the store stays global (Room, RoomFolder and ProximityRoomRow read it); the fix is one function that drives both sources and one reset path (`clearSearch`), rather than moving the store.
- Each `UserActionButton` on a sender subscribes to the user list and adds a document click listener, as each user list row already does. Acceptable for the timeline sizes seen; a shared listener would be the next step if profiling says otherwise.
- `noRoomFound` (existing key, now unused by MapList) was left in place so the other locales stay valid; it can be removed once nothing references it.

### Not done

- Porta 2, "copy link to message" and "jump to this point": WorkAdventure has no permalink route to a chat message (the play URL addresses a map and a position, not a Matrix event), so there is nothing to copy or jump to. Not applicable until such a route exists.
- Porta 4 (`MapList` entity and area counts): not applicable. The numbers count the searchable entities and areas of another map; the only surface that lists them (the explorer) works on the current map only, and the card itself already opens the room.
- Porta 5 (device "Active" / "Not recommended" chips): not applicable. The chip is a label inside a selectable radio row; the row (keyboard-operable since another unit) and the Edit button are the action. A second target inside a radio would nest interactive content.
- Transparency 1 (announcement success before send): already landed by another unit (`AnnouncementComposerModal.svelte` `sendFailed`, `TextGlobalMessage.svelte` returns false on a closed socket). Not changed here.
- Transparency 4 (error toasts as only evidence): landed by the toasts unit (`ThreadPanel.svelte`, `RoomSidePanelPolls.svelte` inline traces, 10 s error floor).
- Transparency 7 (failure memory for recording, uploads, proximity file transfer): needs product decisions 7 and 8 (where the operational panel lives, who sees it, which delivery states apply).
- Recorte 3 (single filter/sort panel): product decision 4; only free-text search exists and the lists are small.
- `ChatMenuItem` unread count (Transparency 8): already inside the chat button, which opens the conversations; no change.
- No checks run (orchestrator runs them at the end); Prettier only on the touched files.

## Sprint 4 review round: doors

- Applied (medium): `play/src/front/Chat/Components/OnlineUsersCount.svelte:12-13,26`. Before: the "N users online" button rendered whenever the chat view was `chat`, but `navChat.switchToUserList()` (`ChatStore.ts:44-52`) does nothing when both `room.isChatOnlineListEnabled` and `room.isChatDisconnectedListEnabled` are false, so the click had no response. After: `canOpenUserList` is computed from the current room and the button renders only when `$navChat.key === "chat" && canOpenUserList`; otherwise the plain, non-interactive count stays.
- Decision: hide the door instead of an aria-disabled button, because the count is informational and there is no fix the user can apply (the world admin disables the lists).
- No i18n keys added. No checks run (orchestrator runs them at the end); Prettier only on the touched file.

## Sprint 4 review round: never-lose-work

- Applied (medium): `play/src/front/Components/Toasts/UndoToast.svelte:42-46`, `:59`, `:64`. Before: `pointerleave` was bound straight to `resume()`, so moving the pointer away while the focus sat on the Undo button restarted the countdown and the toast could vanish under the focus. After: `onPointerLeave` resumes only when `document.activeElement` is outside the wrapper; the focus path (`focusout`) still resumes when the focus leaves. Cleanup removes the same handler.
- Applied (medium): `play/src/front/Components/EmbedScreens/CoWebsiteTab.svelte:71-83`, `:118`. Before: the outer `<div>` had `role="tab"`, `tabindex="0"`, `aria-selected` and an Enter/Space handler while holding the copy, open-in-new-tab and close `<button>`s (nested interactive controls in a tab). After: the outer `<div>` is a plain styled container; a `<button type="button" role="tab" aria-selected={active}>` holds the icon and title and selects the co-website; the three action buttons are its siblings. `activateOnEnterOrSpace` import removed (a native button handles keys). `cursor-pointer` moved from the container to the tab button.
- Rejected (TextGlobalMessage claim): already narrowed. The Sprint 4 Decisions of this unit state "the global message has no server acknowledgement (`emitGlobalMessage` is fire-and-forget). The honest boundary is 'handed to an open socket'", and the code comments say the same (`TextGlobalMessage.svelte:18`, `:35-36`; `AnnouncementComposerModal.svelte:73`). No note claims a resolved send. An acknowledgement path needs a new pusher reply message in `messages/` and back-end work, outside this unit.
- No i18n keys added. No checks run (orchestrator runs them at the end); Prettier only on the two touched Svelte files.

## Sprint 4 check fixes

- Types: `play/src/front/Stores/ErrorScreenStore.ts` `clientError` images default is `Partial<Pick<ErrorScreenMessage, "image" | "imageLogo">>`. `play/src/front/Chat/Components/UserList/UserActionButton.svelte` `user` prop widened to `AnyKindOfUser` (an admin sender without `chatId` is matched by `uuid`; no other `chatId` use in the component).
- Lint: `eslint --fix` import order in `Message.svelte`, `RoomList.svelte`, `ActionBar.svelte`, `MapSubMenuContent.svelte`, `WAMSettingsEditor.svelte`. `CreateRoomView.svelte` drafts cache is a plain `Record` (not reactive state). `Exploration/MapList.svelte`: the local filtered `Map` handed to a store keeps the repo's `eslint-disable-next-line svelte/prefer-svelte-reactivity` with a reason; retry button is `onclick={fetchMaps}` (it never rejects) instead of `void`. `Toasts/ToastContainer.svelte`: named pointer/focus handlers added and removed in the `onMount` cleanup (the `UndoToast` pattern), replacing inline arrows plus an AbortController; attribute handlers were not used because they raise `a11y_no_static_element_interactions` on the wrapper `<div>`.
- Prettier: the 12 locale files from `pretty.log` (`src/i18n/*/camera.ts`, `th-TH/megaphone.ts`).
- `Modal/Popup.svelte` footer `rounded-b-3xl` -> `rounded-b-lg`, matching the container.
- `Icons/RecordingIcon.svelte`: `strokeWidth` now strokes the inner dot too; unset keeps the old look (1-unit ring, unstroked dot).
- `Toasts/UndoToast.svelte`: hover and focus are two flags; the countdown resumes only when neither holds (focusout while hovered no longer resumes).
- `EmbedScreens/CoWebsiteTab.svelte`: already restructured (tab `<button role="tab">` with sibling actions); no change.
- `Chat/Components/Room/MessageActionSheet.svelte`: the post-copy close timeout is stored and cleared on destroy, like `MessageMoreMenu`.
- `ActionBar/MenuIcons/MapSubMenuContent.svelte` `unclaimPersonalDesk()`: `getCurrentGameScene().getMapEditorModeManager()` is inside a `try`; a throw logs and shows `errorUnclaiming`, as before.
- `Modal/Modal.svelte`: `aria-label` falls back to "WorkAdventure" when the title is empty (`ModalEvent.title` already defaults to "WorkAdventure modal iframe"; no generic i18n dialog label exists).
- `Utils/focusTrap.ts`: focusable filter uses `getClientRects().length > 0`, which keeps `position: fixed` elements.
- Hover suppressed on `aria-disabled` (`aria-disabled:hover:*`, plus `cursor-not-allowed` where missing): `RecordingSpacePicker.svelte`, `MessageInputBar.svelte` app tiles, `LockableAreaPicker.svelte`, `ActionMediaBox.svelte` mute rows. `ActionBarButton` already drops hover when blocked; `UI/Button.svelte` relies on design-system `.btn` CSS (not checked here).
