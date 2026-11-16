# Accessibility and motion

Scope: `play/src/front` (490 `.svelte` files). Audit only, no source edited. Svelte 5 syntax is used (`onclick=`, not `on:click`), so searches use that form. All paths below are relative to `play/src/front/`.

Headline numbers:
- 74 non-semantic elements (div, span, li, p, img) carry a click or pointer handler. 65 lack a role, `tabindex` or key handler, of which about 61 are real controls (4 are stop-propagation wrappers or backdrops).
- About 610 motion sites; 6 sites in 5 files honor `prefers-reduced-motion` (about 1 percent).
- `ToastContainer` has no live region, so every toast (including connection lost) is silent to screen readers.

## Keyboard and focus

1. **Icon-only action buttons built as divs, no keyboard, no label** (rule: keyboard first). `Components/ActionsMenu/ExplorerMenu.svelte:129,145,163` (map explorer zoom in/out/open; zoom uses `onpointerdown`, so even Enter/Space cannot trigger it; label exists only in a hover tooltip), `Components/Cowebsites/ImageCowebsiteComponent.svelte:115,128,143` (zoom in/out/open in new tab), `Components/EmbedScreens/CoWebsitesContainer.svelte:259` (fullscreen toggle), `Components/ActionBar/ActionBar.svelte:106` (media settings toggle, 20px, `data-testid="media-settings-toggle-button"`), `Components/AudioManager/AudioManager.svelte:103` (mute). Today: not focusable, not announced. Smallest fix: change the element to `<button type="button" aria-label={...}>` and keep the classes. Confidence: high.
2. **Main navigation and menus made of clickable divs.** `Components/Menu/Menu.svelte:171` (every menu entry: settings, profile, about; shared by all menu items), `Components/ActionBar/MenuIcons/MapSubMenu.svelte:45`, `Components/ActionBar/MenuIcons/ParticipantMenuItem.svelte:217`, `Components/ActionBar/MenuIcons/ProfileMenu.svelte:70`. Today: the menu cannot be opened or traversed by keyboard (the Menu.svelte items are the only way into settings). Fix: `<button>` (or `role="button" tabindex="0"` plus Enter/Space handler) at those four sites. Confidence: high.
3. **User list actions are spans.** `Chat/Components/UserList/UserActionButton.svelte:216,229,243,269,288,315,336` (walk to, follow, invite, teleport, business card, ban) and `Chat/Components/UserList/User.svelte:91,102` (open the Woka menu). Today: the whole per-user action set is mouse only. Fix: `<button class="wa-dropdown-item">` with `role="menuitem"` on the container, once in `UserActionButton.svelte`, which covers all 7. Confidence: high.
4. **Camera, microphone and speaker pickers are clickable divs.** `Components/EnableCamera/SelectCamera.svelte:46,89`, `SelectMicrophone.svelte:47,86`, `SelectSpeaker.svelte:44`. Today: a keyboard user cannot choose a device on the entry screen. Fix: `role="radio"` plus `aria-checked` plus `tabindex` plus Enter/Space (or a `<button>`). Confidence: high.
5. **ActionBar buttons lose the keyboard focus ring.** `Components/ActionBar/ActionBarButton.svelte:150` has `outline-none focus:outline-none` and no `focus-visible:` class. The global ring in `style/style.css:44-48` sits in `@layer base`, and the file's own comment says component utilities win, so the ring is removed on every ActionBar button. Same pattern at `Components/ActionBar/AvailabilityStatus/AvailabilityStatusList.svelte:43,56` and `Chat/Components/UserList/RoomUserList.svelte:122`. Fix: replace `focus:outline-none` with `focus-visible:outline-2 focus-visible:outline-white/80` in `ActionBarButton.svelte` (one component, all action-bar buttons). Confidence: high for ActionBarButton, medium for the other two (verify in browser).
6. **Other clickable list items without semantics.** `Components/Exploration/Explorer.svelte:376,420,471,509` and `Components/Exploration/MapList.svelte:144` (also select on `onmouseenter`, so highlight is hover-only), `Components/MapEditor/WAMSettingsEditor.svelte:79,93,106` (settings tabs as `li`), `Components/MapEditor/EntityEditor/TagListItem.svelte:27`, `Components/MapEditor/EntityEditor/EntityItem/EntityItem.svelte:16`, `Components/EmbedScreens/CoWebsiteTab.svelte:62` (cowebsite tabs), `Components/Menu/AboutRoomSubMenu.svelte:79,105,137` (accordion headers), `Chat/Components/RoomList.svelte:535` (accordion header), `Components/Menu/SettingsSubMenu.svelte:343-449` (quality labels, 6 spans). Fix per site: `<button>`; for tabs add `role="tab"` and `aria-selected`; for accordions add `aria-expanded`. Confidence: high.
7. **Dialogs without a focus trap or focus return.** `Components/Modal/Modal.svelte:66` (iframe modal: no `role="dialog"`, no `aria-modal`, no trap, no focus return; it only handles Escape), `Chat/Components/Room/MessageActionSheet.svelte:70` (moves focus in, no trap, no return), `Components/Video/DesktopCapturerSourcePicker.svelte:123` (no Tab trap found), `Chat/Components/ChatImagePreviewModal.svelte:55` and `Chat/Components/MatrixPeerProfileDebugModal.svelte:71` (no Tab trap found; the click handler is only a stopPropagation wrapper). Good reference: `Components/Modal/Popup.svelte:19-70` already implements trap, Escape and focus return; reusing that block covers the others. Confidence: high for Modal.svelte, medium for the rest.
8. **Cursor-only resize handle and video overlay.** `Components/EmbedScreens/CoWebsitesContainer.svelte:297` (cowebsite divider, `cursor-row-resize`, no key alternative), `Components/Video/VideoMediaBox.svelte:702` (click to cancel a blacklist, div with `cursor-pointer`). Fix: `role="separator"` with `tabindex=0` and arrow-key handler for the divider; `<button>` for the overlay. Confidence: medium.

## Hover dependency

Essential hover (fix these):
1. `Components/Video/PictureInPicture/DesktopMiniWindow.svelte:499` invite and other row actions use `hidden group-hover:flex`. They are unreachable by keyboard (display none) and on touch. Fix: `hidden group-hover:flex group-focus-within:flex [@media(pointer:coarse)]:flex`. Confidence: high.
2. `Chat/Components/Room/Message/MessageImage.svelte:32` image actions (open, download) are `opacity-0 group-hover:opacity-100` with no `group-focus-within` and no coarse-pointer fallback. Keyboard users tab onto invisible links; touch users never see them. Fix: add `focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100`. Confidence: high.
3. `Chat/Components/Room/Message.svelte:59,335` the message time is shown on hover only when `showTime` is false; the fallback is a `title` attribute, which is not available on touch or keyboard. Fix: expose the time in an `aria-label` or `<time>` element on the bubble (the options bar already shows on focus-within). Confidence: medium.
4. Icon-only controls whose only name is a hover tooltip: `Components/ActionsMenu/ExplorerMenu.svelte:138,154,169,184`, `Components/Cowebsites/ImageCowebsiteComponent.svelte:121,134,149`, `Components/MapEditor/MapEditorSideBar.svelte:157` (`peer-hover:` tooltip). Fix: add `aria-label` and `group-focus-visible:` / `peer-focus-visible:` to the tooltip classes. Confidence: high.
5. `Components/Video/VideoMediaBox.svelte:592` fullscreen/controls overlay: `opacity-0 hover:!opacity-100`, with only a coarse pointer escape. Keyboard focus does not reveal it. Fix: add `focus-within:!opacity-100`. Confidence: medium.

Decorative hover (no action needed): `Components/PopUp/Recording/RecordingsListModal.svelte:367,497` (play icon overlay, the row is the button), `Chat/Components/Room/Message/MessageReadReceipt.svelte:81` (already has `group-focus-within`), `Chat/Components/ChatSettings.svelte:232`, `Chat/Components/MatrixPeerProfileDebugModal.svelte:114,129`, and all `hover:bg-*` color changes. Good pattern to copy: `Chat/Components/Room/Message.svelte:448-471` (options bar shows on hover, focus-within and `pointer: coarse`).

## Color alone

1. Unread badges are a bare green dot with no text or accessible name: `Chat/Components/Room/RoomTimeline.svelte:850`, `Chat/Components/Room/ProximityRoomSidePanelHome.svelte:146`, `Components/Video/PictureInPicture/DesktopMiniWindow.svelte:630` (only a `title`). Fix: add a visually hidden count text inside the span (the parent button already has a label, so add the count to the `aria-label`). Confidence: high.
2. `Components/Video/PictureInPicture/DesktopMiniWindow.svelte:288` "meeting soon" dot (`bg-warning`, 8px) has no name or text. Fix: `aria-label` on the parent button or an `sr-only` span. Confidence: high.
3. `Components/ActionBar/ActionBarButton.svelte:136-141` states `forbidden` (red), `live` (green), `active` (blue) differ by background only; the icon is the same. Check that `aria-pressed` or a text label is set per state; otherwise add it (one component, all action-bar buttons). Confidence: medium.
4. `Chat/Components/UserList/User.svelte:136-141` availability status is color plus a text label (`getStatusLabel`): this one is compliant, listed as the reference pattern.

Contrast was not measured (needs rendered pixels). Candidates to measure: `text-white/50`, `text-white/60`, `opacity-50` text on `bg-contrast/50` (for example `Chat/Components/RoomList.svelte:415,421`, `Chat/Components/Room/TypingUsers.svelte:30`). Semi-transparent white on a variable game canvas background may fall below 4.5:1.

## Motion and reduced motion

Census (grep over `.svelte`):
- Tailwind `animate-*` uses: 45 (`animate-spin` 24, `animate-pulse` 12 plus 1 hover, `animate-ping` 3, `animate-bounce-in` 2).
- Svelte transitions (`in:`/`out:`/`transition:` fly, fade, slide, scale, blur): 62 uses in 49 files.
- `@keyframes`: 19. CSS `animation:` declarations: 21.
- Tailwind `transition*` utility: 412 uses in 196 files. CSS `transition:` declarations: 52.
- Phaser tweens and `requestAnimationFrame` code in `Phaser/` (camera, character, markers, speech bubble): not covered by CSS media queries.

Respecting `prefers-reduced-motion` today: 6 sites in 5 files, namely `Chat/Components/TypingDots.svelte:31`, `Chat/Components/UnreadCount.svelte:50`, `Chat/Components/RoomListSkeleton.svelte:15,16`, `Chat/Components/Room/RoomTimelineLoading.svelte:24`, `Chat/Components/Room/Message/MessageAttachmentRecipients.svelte:31`. There is no global rule in `style/style.css`. Not respecting: all the rest, about 600 sites (99 percent), of which the vestibular-relevant ones are slides and large movement.

Gaps by harm:
1. 62 Svelte transitions (`fly`, `slide`, `blur`) run with JS-driven inline styles; CSS cannot cancel them. Examples: `Components/Modal/Popup.svelte:3` (`fly`), `Components/Modal/Modal.svelte:72` (`blur` 250 ms), every toast and popup. Smallest fix: one shared wrapper that sets `duration: 0` when `matchMedia("(prefers-reduced-motion: reduce)").matches`, imported in place of `svelte/transition` (or a tiny store). Confidence: high.
2. `Components/ActionsMenu/ExplorerMenu.svelte:138-184` and `Components/Cowebsites/ImageCowebsiteComponent.svelte:121-149` tooltips slide 15 rem sideways (`-right-60` to `right-11`). Covered by the global rule in item 3.
3. Add one global block in `style/style.css`: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }`. This covers the 19 keyframes, 21 animation declarations, 45 `animate-*` uses and 464 transitions in one change. Keep spinners for loading (replace with static text where the spinner is the only indicator). Confidence: high.
4. Phaser tweens in `Phaser/Game/CameraManager.ts`, `Phaser/Entity/Character.ts`, `Phaser/Components/WalkDestinationMarker.ts`: no reduced-motion check. Lower harm (game world, user-driven movement); gate camera zoom/pan easing only. Confidence: low.

## Tap targets

1. `Components/ActionBar/ActionBar.svelte:106` media settings toggle is `h-5 w-5` (20 px), below the 24 px minimum, with no padding hit area. Fix: `h-6 w-6` or add `before:absolute before:-inset-1`. Confidence: high.
2. `Chat/Components/Room/RoomTimeline.svelte:773` unread-elsewhere badge button, `p-0.5` around a small count (about 18 px). Fix: `min-h-6 min-w-6`. Confidence: medium.
3. `Components/Menu/SettingsSubMenu.svelte:343-449` six quality labels are bare text spans (`absolute -bottom-4`), height about 16 px. Fix with the button conversion from Keyboard 6, adding `min-h-6 px-1`. Confidence: medium.
4. `Chat/Components/Room/MessageOptions.svelte:127,143` and `Chat/Components/Room/EmojiButton.svelte:59` are `w-7 h-7` (28 px): compliant with 2.5.8 (24 px), under the 44 px comfort size. No action required for AA.
5. `Components/Input/ButtonClose.svelte:25` size `xs` is `h-6 w-6` (24 px, exactly the minimum). Pass.
6. `Chat/Components/Room/Message/MessageAttachmentRecipients.svelte:88` `w-[15px] h-[15px]` badge is not interactive (confirm it has no click handler).

Most buttons use 36 px or larger; the 24 px failures are rare.

## Live regions

Compliant already: `Chat/Components/Room/TypingUsers.svelte:30` (`aria-live="polite"`), `Chat/Components/Room/ChatMessageBanner.svelte:50` (`role="status"`), `Chat/Components/ChatError.svelte:23` and `Chat/Components/RefreshChat.svelte:27` (`role="alert"`), `Chat/Components/Room/EnteredZoneBanner.svelte:46`.

Gaps:
1. `Components/Toasts/ToastContainer.svelte:45` is the shared wrapper of every toast, and it has no `role`/`aria-live`. This silences `ConnectionIssueToast.svelte` ("unable to connect"), `WebsocketReconnectingToast.svelte` ("connection lost"), the loud-environment, no-microphone-sound, and audio-interrupted toasts, and `TextToast`. Fix: `role="status" aria-live="polite"` on the container root (`role="alert"` when `theme === "error"`). One edit covers all. The host list at `Components/MainLayout.svelte:377` should keep the container mounted. Confidence: high.
2. `Components/ProximityNotification/ProximityNotification.svelte:57` new chat messages arriving while the chat is closed show as `role="button"` with no live region, so a screen reader user is not told a message arrived. Fix: wrap the list in `ProximityNotificationContainer.svelte` with `aria-live="polite"`. Confidence: high.
3. `Chat/Components/Room/RoomTimeline.svelte` (message list): no `role="log"` or `aria-live`, so incoming messages in the open room are silent. Fix: `role="log" aria-live="polite" aria-relevant="additions"` on the scroll container. Confidence: high.
4. Participant joining or leaving: no live region in `Components` or `Chat` (the only matches for "announce" are scripting code in `Chat/Connection/Proximity/ProximityChatRoom.ts:1635`, which is not a screen-reader announcement). Fix: reuse the toast container (item 1) or a single visually hidden `aria-live="polite"` node fed from the same store. Confidence: medium (depends on whether a visual cue exists).
5. `Components/Input/ButtonState.svelte:48` has `role="status"` on an `aria-hidden` svg, which makes the status unreachable; move `role="status"` to the text span. Confidence: medium.

## Large text and clipping

Heights from Tailwind `h-N` use rem and scale with text; the clipping risk is fixed pixel heights around text:
1. `Chat/Components/Room/TypingUsers.svelte:29` `h-[22px] overflow-hidden whitespace-nowrap text-xs`: the typing indicator, which is also the live region, is cut off at larger text sizes. Fix: `min-h-[1.375rem]` and drop `overflow-hidden` (keep `truncate` on the inner text). Confidence: high.
2. `Components/PopUp/PopUpMessage.svelte:29,46` `max-h-[120px]` and `max-h-[140px]` with `overflow-y-auto`: scrolls rather than clips (acceptable) but the scroll area shrinks to one line at 200 percent. Fix: use `max-h-[7.5rem]`. Confidence: medium.
3. `Components/Tooltip/HelpTooltip.svelte:72` `h-[26px] leading-none text-sm` badge: text taller than box at large sizes. Fix: `min-h-[1.625rem]`. Confidence: medium.
4. `Components/MainLayout.svelte:248` `h-[135px] w-full shrink-0` wrapper around a content region. Fix: `min-h-[135px]` after verifying what it contains. Confidence: low.
5. `Components/Input/TextArea.svelte:41` (default `h-[85px]`) and `Components/Moderation/ModerationModal.svelte:338` (`h-[80px]`): text areas scroll, so only a minor concern; use `min-h-[5.3rem]`. Confidence: low.
6. `Components/Video/DesktopCapturerSourcePicker.svelte:264` `height: 36px` and `Components/FollowMenu/FollowButton.svelte:25` `height: 44px`: icon buttons, safe unless they carry text. Confidence: low.
7. `style/style.css:313,322,387,430,480` define text sizes in `px` (30, 24, 22, 16, 12 px), and 33 other places use `text-[Npx]` or `font-size: Npx`. These ignore the browser default font-size setting. Fix: convert to `rem` (px/16). Confidence: medium (needs a render check at 200 percent text).

Not measured: nothing was rendered. Verify items 1 to 3 by setting the browser's minimum font size to 24 px.

## Needs a product decision

1. **Spinners and pulses under reduced motion.** Hide or freeze the 24 `animate-spin` loaders, or keep them (WCAG treats essential progress indicators as allowed)? Recommendation: keep spinner rotation but drop all slides and fades; needs sign-off.
2. **Hover-revealed message time** (`Chat/Components/Room/Message.svelte:59`). Always show it, or expose it only to assistive tech? Touch and keyboard users currently have neither.
3. **Live announcements for participants joining and leaving.** Very noisy in busy rooms. Options: announce only for the proximity bubble, throttle to one message per 5 seconds, or off by default with a setting.
4. **Chat messages in the open room as `role="log"`.** Announces every message, which can interrupt a screen reader user in a fast channel. Option: announce only mentions and direct messages.
5. **Contrast for text over the game canvas.** `bg-contrast/50` and `text-white/50` over a map has no fixed background ratio. Does the product raise the overlay opacity (visual change), or accept the risk?
6. **Map explorer zoom keyboard model.** `ExplorerMenu.svelte:129,145` zoom is press-and-hold (`pointerdown`). Decide on the keyboard equivalent (click for one step, hold-repeat on Enter/Space).

## Landed (session 2)

Paths relative to `play/src/front/`.

| File:line | Before | After | Finding |
|---|---|---|---|
| `Components/ActionBar/ActionBarButton.svelte:150` | `... justify-center outline-none focus:outline-none gap-2 ...` | `... justify-center gap-2 ...` (global base-layer ring now applies; mouse focus still has no ring via `button:focus:not(:focus-visible)`) | Keyboard 5 |
| `Components/ActionBar/AvailabilityStatus/AvailabilityStatusList.svelte:43,56` | `... rounded active:outline-none focus:outline-none` | `... rounded` | Keyboard 5 |
| `Chat/Components/UserList/RoomUserList.svelte:122` | `... text-white outline-none border-y-0 ...` | `... text-white border-y-0 ...` | Keyboard 5 |
| `style/style.css:44` | global ring selector list: button, role=button, role=menuitem, summary, a | adds `body [role="radio"]:focus-visible` so the new device radios show the same ring | Keyboard 4 |
| `style/style.css:52-64` | no reduced-motion rule | `@media (prefers-reduced-motion: reduce)` block: animation/transition duration 0.01ms, iteration 1, `scroll-behavior: auto`, excluding `.animate-spin` (spinners keep turning, see product decision 1) | Motion 3 (covers Motion 2) |
| `Components/ActionsMenu/ExplorerMenu.svelte:161` | clickable `<div>` (open map explorer) with svelte-ignore | `<button type="button" aria-label={$LL.mapEditor.explorer.title()}>`, same classes; tooltip also shows on `group-focus-visible` (also on the existing center-camera button) | Keyboard 1, Hover 4 |
| `Components/Cowebsites/ImageCowebsiteComponent.svelte:113,126,141` | three clickable `<div>`s (zoom in, zoom out, open in new tab) | `<button type="button" aria-label={existing tooltip string}>`, same classes; tooltips add `group-focus-visible:opacity-90 group-focus-visible:right-11` | Keyboard 1, Hover 4 |
| `Components/EmbedScreens/CoWebsitesContainer.svelte:258` | clickable `<div>` fullscreen toggle | `<button type="button" aria-label={$LL.menu.settings.fullscreen()} aria-pressed={$fullScreenCowebsite}>`, same classes; imports `LL` | Keyboard 1 |
| `Components/ActionBar/MenuIcons/MapSubMenu.svelte:46` | clickable `<div data-testid="map-menu">` | adds `role="button" tabindex="0" aria-haspopup="menu" aria-expanded` and Enter/Space `onkeydown` (kept a div: wrapper has block children and a floating-ui ref, so no visual risk) | Keyboard 2 |
| `Components/ActionBar/MenuIcons/ParticipantMenuItem.svelte:218` | clickable `<div data-testid="participant-menu">` | same pattern as MapSubMenu | Keyboard 2 |
| `Components/ActionBar/MenuIcons/ProfileMenu.svelte:73` | clickable trigger `<div>` (`bind:this` typed `HTMLDivElement`) | same pattern, element type unchanged | Keyboard 2 |
| `Chat/Components/UserList/UserActionButton.svelte:214-328` | 7 clickable `<span class="wa-dropdown-item ...">` (talk to, follow, invite x2, teleport, business card, moderate) | `<button type="button" class="...">`, classes unchanged (all `flex w-full`, so layout unchanged) | Keyboard 3 |
| `Chat/Components/UserList/User.svelte:103` | clickable name `<div>` opening the Woka menu | `role="button" tabindex="0"` plus Enter/Space handler; the avatar div (same action) stays pointer-only to avoid a duplicate tab stop | Keyboard 3 |
| `Components/EnableCamera/SelectCamera.svelte:50,103`, `SelectMicrophone.svelte:51,100`, `SelectSpeaker.svelte:49` | clickable device `<div>`s | `role="radio" aria-checked={selected} tabindex="0"` plus Enter/Space `onkeydown` that ignores events from nested controls (`event.target !== event.currentTarget`) | Keyboard 4 |
| `Components/Input/ButtonState.svelte:46,58` | `role="status"` on an `aria-hidden` svg, bare `{loadingText}` | role removed from svg; `<span role="status">{loadingText}</span>` | Live 5 |

## Skipped

- Live 1 (`ToastContainer.svelte`): another agent landed `role={theme === "error" ? "alert" : "status"}` on the toast message node (`:73-76`) during this session. I had added the same on the root and removed mine to avoid double announcements.
- Keyboard 2, `Components/Menu/Menu.svelte:171`: each menu item already wraps a real `<button type="button">`, whose click bubbles to the div handler, so it is keyboard-reachable today.
- Keyboard 5 "verify in browser" items: changes are class removals only; the browser check is left to the orchestrator.

## Parked

- Keyboard 1, `ExplorerMenu.svelte` zoom in/out: press-and-hold on `pointerdown`; keyboard model is product decision 6.
- Keyboard 1, `ActionBar.svelte:106` media settings toggle and `AudioManager.svelte:103` mute: no existing i18n string names them, and adding one is a wording change outside this pass.
- Motion 1 (62 Svelte JS transitions): needs a shared reduced-motion transition wrapper imported in 49 files; a code change across files other agents are editing.
- Motion 4 (Phaser tweens): low confidence, game code, out of the visual pass.
- Keyboard 6, 7, 8; Hover 1-3, 5; Color 1-3; Tap targets 1-3; Live 2-4; Large text 1-7: not landed in this step (structural tab/accordion/dialog semantics, layout or size changes, or product decisions 2-5).

## Review round (session 2)

### Landed (session 2)

- R2-1 follow button disabled state. `play/src/front/Chat/Components/UserList/UserActionButton.svelte:228-230`. Before: `<button type="button" class={... userToLocate == undefined ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}>`, which stayed focusable and could be activated while it looked unavailable. After: `disabled={userToLocate == undefined}` added, `pointer-events-none` dropped, and `opacity-50 cursor-not-allowed` kept. The native `disabled` attribute takes the button out of the tab order and tells assistive technology it is unavailable. The visuals do not change.
- R2-2 device list radiogroup. `play/src/front/Components/EnableCamera/SelectCamera.svelte:20,28,44-48`, `SelectMicrophone.svelte:20,28,45`, `SelectSpeaker.svelte:18,26,41`. Before: the `role="radio"` rows had no grouping ancestor. After: `const uid = $props.id();`, `id="{uid}-title"` on the existing heading wrapper (the title snippet, or the `camera.editSpeaker()` text), and `role="radiogroup" aria-labelledby="{uid}-title"` on the existing list container. The group is named by the visible heading, so there is no new wording and no layout change. `$props.id()` (Svelte 5.57.3) keeps the IDs unique when the components render more than once.

### Skipped

- R2-2, the part about moving the widget snippet out of the radio. The camera preview and microphone level widget sit inside the selected row's card, so moving them out would change the row layout, which this pass does not allow. The widgets are display-only: the camera preview is a video and the microphone widget is a level meter. They add no focusable descendants, so the radio still has no interactive children. A roving tabindex with arrow keys is a keyboard-model change and is parked with product decision 6.

## Sprint 4: motion

Paths relative to `play/src/front/`.

### Landed

| File:line | Before | After | Finding |
|---|---|---|---|
| `Utils/reducedMotion.ts:1-44` (new) | none | `isReducedMotion()` reads `matchMedia("(prefers-reduced-motion: reduce)")` at call time (false when `matchMedia` is missing); `motionDuration(ms)` returns 0 under reduced motion; `blur`, `fade`, `fly`, `scale`, `slide` wrap the `svelte/transition` functions of the same name and return the same config with `duration: 0, delay: 0` under reduced motion | Motion 1 |
| `Utils/reducedMotion.test.ts` (new) | none | 3 tests: no `matchMedia`, no preference (durations kept), reduce (every wrapper instant, end state still applied). `npx vitest --run src/front/Utils/reducedMotion.test.ts`: 3 passed | Motion 1 |
| 46 `.svelte` files, import line: `Chat/ChatSidebar.svelte:2`, `Chat/Components/ChatSettings.svelte:3`, `Components/ActionBar/Applications.svelte:4`, `ActionBar/EmojiSubMenu.svelte:6`, `ActionBar/MediaSettingsList/MediaSettingsList.svelte:4`, `AudioManager/AudioManager.svelte:6`, `Calendar/Calendar.svelte:3`, `Calendar/CalendarReminders.svelte:3`, `ExternalModules/ExternalComponents.svelte:2`, `HelpSettings/HelpCameraSettingsPopup.svelte:2`, `HelpSettings/HelpNotificationSettingPopup.svelte:2`, `HelpSettings/HelpPopUpBlocked.svelte:2`, `HelpSettings/HelpWebRtcSettingsPopup.svelte:3`, `Loader/LoaderScene.svelte:2`, `MainLayout.svelte:4`, `MapDeletedPrompt.svelte:2`, `MapEditor/ConfigureMyRoom/Megaphone.svelte:3`, `MapEditor/MapEditor.svelte:3`, `MapEditor/PropertyEditor/AddPropertyButton.svelte:2`, `MapEditor/WAMSettingsEditor.svelte:4`, `Menu/AboutRoomSubMenu.svelte:3`, `Menu/Menu.svelte:5`, `Menu/SettingsSubMenu.svelte:3`, `Modal/LimitRoomModal.svelte:2`, `Modal/Modal.svelte:3`, `Modal/ObjectDetails.svelte:11`, `Modal/Popup.svelte:3`, `Onboarding/OnboardingStep.svelte:3`, `Onboarding/Steps/{Communication,Complete,LockBubble,PictureInPicture,ScreenSharing,Welcome}Step.svelte:2`, `Onboarding/Steps/MovementStep.svelte:3`, `ProximityNotification/ProximityNotification.svelte:3`, `Toasts/ToastContainer.svelte:4`, `TodoList/TodoList.svelte:4`, `Tooltip/HelpTooltip.svelte:3`, `TypeMessage/TextMessage.svelte:2`, `UI/ErrorScreen.svelte:3`, `UI/Notification.svelte:3`, `Util/Tooltip.svelte:3`, `Video/RaisedHandsDock.svelte:2`, `WarningContainer/WarningBanner.svelte:2`, `WarningContainer/WarningToast.svelte:2` (the `Components/` prefix is dropped after the third entry) | `import { fly } from "svelte/transition";` (or `fade`, `blur`, `scale`) | `import { fly } from "<relative>/Utils/reducedMotion";`, same names. In 17 files the line moved below the last package import to satisfy `import/order` (parent paths after packages) | Motion 1 |
| `Phaser/Game/CameraManager.ts:249` (`animateToFocus`) | tween runs for `duration` | `const duration = motionDuration(requestedDuration)`: camera pans to a focus target or player jump at once | Motion 4 |
| `Phaser/Game/CameraManager.ts:925` (`animateToZoomLevel`) | tween runs for `duration` | same gate: zoom level changes (focus zones, scripts, zoom by factor, restore) apply at once | Motion 4 |
| `Phaser/Game/CameraManager.ts:502` (camera offset tween) | `duration: 500` | `duration: motionDuration(500)` | Motion 4 |
| `Phaser/Game/CameraManager.ts:710-714` (walk framing blend) | `framing.duration = Math.min(...)`, `blend = Sine.InOut(min(elapsed / duration, 1))` | duration wrapped in `motionDuration`; `progress` is 1 when the duration is 0 (avoids a 0 division) | Motion 4 |
| `Phaser/Game/CameraManager.ts:1072-1083` (zoom button easing) | `SMOOTH_BUTTON_ZOOM_DURATION` (520 ms) | `smoothZoomDuration = motionDuration(SMOOTH_BUTTON_ZOOM_DURATION)`; `getSmoothButtonZoomModifier` already returns the target for a 0 duration | Motion 4 |

### Decisions

- Codemod (`/tmp/motion-codemod/run.mjs` and `order.mjs`, not committed): rewrote only `import { names } from "svelte/transition";` lines whose names are all in the wrapper set, then moved the new parent-path import below the last package import when `import/order` would flag it. The diff was read: 46 added import lines, no other line from this unit. `Video/MediaBox.svelte:2` is a commented-out import and was left alone.
- Wrappers take the Svelte config and zero `duration` and `delay` instead of editing the params, so there is no type assertion; Svelte applies the end state when the duration is 0, so elements still appear and leave.
- The flag is read when each animation starts (not cached in a store), so changing the system setting applies without a reload, and no listener needs cleanup. A reactive store was not added because no consumer needs one.
- `svelte/motion`'s `prefersReducedMotion` was not reused: it calls `window.matchMedia` at import time, which throws in jsdom tests and in any context without `matchMedia`.
- Phaser: only camera pan and zoom easing is gated, as the finding asks. User-driven keyboard pan inertia (`animate`), continuous hold zoom and trackpad zoom are left as is (they follow the user's input, not an automatic movement).

### Not done

- `Phaser/Entity/Character.ts` and `Phaser/Components/WalkDestinationMarker.ts` tweens: the finding limits the fix to camera zoom and pan; avatar and marker tweens are small, local and tied to user-driven movement.
- `Components/MapEditor/WAMSettingsEditor.svelte` and `Components/Menu/AboutRoomSubMenu.svelte` fail `prettier --check` on `activateOnEnterOrSpace` lines that another agent added; not formatted here to avoid touching their lines.
- No svelte-check, typecheck or lint run (orchestrator runs them at the end).

## Sprint 4 review round: toasts

### Applied

- `play/src/front/Chat/Components/Room/RoomSidePanelPolls.svelte:44-52`: the thread poll path set `selectedThreadStore` and switched the side panel to `threads` before `thread.ensureTimelineEventVisible(poll.id)` returned. `RoomSidePanel.svelte` keys the panel by `displayedSection`, so the switch unmounted the polls panel and the inline `pollFailure` was written to a destroyed component; only the transient toast survived. After: the visibility check runs first; on failure the polls panel stays mounted with the failure under the affected poll; on success the thread is selected and the section switches, then the event is focused. Verified that `MatrixChatThread.ensureTimelineEventVisible` does not depend on the thread being selected or rendered (it reads `rootMessage`/`replyMessages` and the parent room's events).

### Rejected

- None.

### Not done

- No svelte-check, typecheck or tests run (orchestrator runs them at the end). No existing unit test covers this component.

## Sprint 4: a11y-structural

Paths relative to `play/src/front/`. Two shared helpers were added and reused below: `Utils/activateOnEnterOrSpace.ts` (Enter/Space on a `role="button"`/`role="tab"` element runs its click action, ignoring keys from nested controls) and `Utils/focusTrap.ts` (`use:focusTrap`: moves focus in, cycles Tab/Shift+Tab, returns focus to the opener; `{ cycle: false }` for non-modal panels, and it reads focus from the node's own document so the desktop mini window works).

### Landed

| File:line | Before | After | Finding |
|---|---|---|---|
| `Components/ActionsMenu/ExplorerMenu.svelte:174-211` | zoom in/out were `<div onpointerdown>`: no focus, no key, name only in a hover tooltip | `<button type="button" aria-label={zoomIn/zoomOut}>`; Enter/Space (button direction) or `+`/`=`/`-` (explicit direction) on keydown start the same gesture as a pointer press (one smooth step, then continuous zoom while held); keyup or blur stops it; tooltip also shows on `group-focus-visible`. Pointer and keyboard share `beginZoom()` and the single-gesture guard | Keyboard 1, Hover 4, product decision 6 |
| `Components/ActionBar/ActionBar.svelte:104-122` | media settings toggle `<div onclick>` 20 px, no name, wrapper visible on hover only | `<button type="button" aria-label={actionbar.mediaSettingsToggle} aria-expanded>`, `cursor-pointer`, hit area `before:absolute before:-inset-1` (28 px, no visual change); wrapper adds `group-focus-within/hardware:opacity-100` | Keyboard 1, Tap 1, Hover |
| `Components/AudioManager/AudioManager.svelte:101-110` | mute `<div onclick class="pr-4">`, no name, no state | `<button type="button" aria-label={audio.mute} aria-pressed={muted}>`, `min-h-8 min-w-8 p-1 mr-3` (same 16 px gap to the slider), hover background, id kept for `style/audio-range.css` | Keyboard 1, Tap |
| `Components/MapEditor/WAMSettingsEditor.svelte:79-130` | 3 settings `li onclick`, no semantics | `ul role="tablist" aria-orientation="vertical"`, each `li role="tab" tabindex="0" aria-selected` + Enter/Space, content `role="tabpanel"`; one `selectMenuItem()` | Keyboard 6 |
| `Components/EmbedScreens/CoWebsiteTab.svelte:71-80`, `CoWebsitesContainer.svelte:252-268` | tab `<div onclick>` | `role="tab" tabindex="0" aria-selected={active}` + Enter/Space; container `role="tablist"`, wrapper `role="presentation"` | Keyboard 6 |
| `Components/Menu/AboutRoomSubMenu.svelte:80-160` | 3 accordion header `<div onclick>` | `role="button" tabindex="0" aria-expanded aria-controls` (ids from `$props.id()`) + Enter/Space, `cursor-pointer` | Keyboard 6 |
| `Chat/Components/RoomList.svelte:604-610` | rooms accordion chevron `<button>` with no name or state | `type="button" aria-expanded={displayRooms} aria-label={chat.rooms}`; header row `cursor-pointer` (the inner button already made it keyboard reachable) | Keyboard 6 |
| `Components/Menu/SettingsSubMenu.svelte:341-450` | 6 quality labels `<span onclick>` about 16 px tall | `<button type="button" aria-pressed>` with `min-h-6 px-1 rounded`, moved `-bottom-4` to `-bottom-5` so the text stays where it was | Keyboard 6, Tap 3 |
| `Components/Exploration/Explorer.svelte:406-560` | accordion chevrons and walk/eye icon buttons unnamed; map highlight on mouse only | `type="button"` + `aria-expanded` + `aria-label` (`mapEditor.explorer.entitiesList/areasList`, `details.moveToEntity/moveToArea`, new `details.show`); rows also highlight on `onfocusin`/`onfocusout` | Keyboard 6, Hover |
| `Components/MapEditor/EntityEditor/TagListItem.svelte:25-58` | `li onclick` | `li` keeps list semantics, inner `div role="button" tabindex="0"` + Enter/Space | Keyboard 6 |
| `Components/MapEditor/EntityEditor/EntityItem/EntityItem.svelte:15-22` | `<div onclick>` | `role="button" tabindex="0" aria-pressed={isActive}` + Enter/Space | Keyboard 6 |
| `style/style.css:45` | global ring list without tabs | adds `body [role="tab"]:focus-visible` | Keyboard 6 |
| `Components/Modal/Modal.svelte:72-82` | iframe modal: no dialog role, no focus handling; hover-only controls (opacity 25%); unnamed icon buttons | `role="dialog" aria-label={title} tabindex="-1" use:focusTrap={{ cycle: isBlocking }}`, `aria-modal={isBlocking}` (center, fullscreen, mobile); controls `focus-within:opacity-100`; fullscreen `aria-label` + `aria-pressed`, close `aria-label={actionbar.close}`. Escape kept | Keyboard 7, Hover |
| `Chat/Components/Room/MessageActionSheet.svelte:77-79` | focus moved in, no trap, no return | `tabindex="-1" use:focusTrap` | Keyboard 7 |
| `Chat/Components/ChatImagePreviewModal.svelte:56-58` | no trap or return | `tabindex="-1" use:focusTrap` on the panel | Keyboard 7 |
| `Chat/Components/MatrixPeerProfileDebugModal.svelte:72-85` | no trap, no Escape | `tabindex="-1" use:focusTrap`, Escape closes (`modals.close()`) | Keyboard 7 |
| `Components/Video/DesktopCapturerSourcePicker.svelte:119-128,139-142` | no trap, no Escape (keydown only stopped) | `use:focusTrap`; `onDialogKeydown` still stops propagation and cancels on Escape | Keyboard 7 |
| `Components/EmbedScreens/CoWebsitesContainer.svelte:122-145,322-345` | resize bar mouse/touch only | `role="separator" tabindex="0" aria-orientation aria-label={cowebsite.resize} aria-valuenow/min/max`, arrow keys move it 5% (direction follows orientation and RTL), clamped 10-90%, focus ring | Keyboard 8 |
| `Components/Video/VideoMediaBox.svelte:708-720` | click-to-unblock `<div onclick>` | `<button type="button">`, same classes | Keyboard 8 |
| `Components/Video/VideoMediaBox.svelte:592-625,672-684` | fullscreen overlays shown on hover only; 4 unnamed icon buttons | `focus-within:!opacity-100` / `focus-within:opacity-100`; `aria-label` (`video.reduce`, `actionbar.participantExitFullscreen`, `menu.settings.fullscreen`, new `video.enlarge`) | Hover 5 |
| `Components/Video/PictureInPicture/DesktopMiniWindow.svelte:501-506` | row actions `hidden group-hover:flex` (not focusable) | `flex w-0 overflow-hidden group-hover:w-auto group-focus-within:w-auto [@media(pointer:coarse)]:w-auto`: always in the Tab order, opens on focus and touch | Hover 1 |
| `Chat/Components/Room/Message/MessageImage.svelte:32` | image actions `opacity-0 group-hover:opacity-100` | adds `group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100` | Hover 2 |
| `Chat/Components/Room/Message.svelte:365-368` | grouped message time only in a `title` | `<time class="sr-only" datetime>` inside the bubble when the visible time is hidden | Hover 3, product decision 2 |
| `Components/Video/PictureInPicture/DesktopMiniWindow.svelte:635-643` | unread dot with `title` only | `role="img" aria-label` (existing unread strings) | Color 1 |
| `Chat/Components/Room/RoomTimeline.svelte:870-885` | side panel toggle named by `title` only; unread dot unnamed | sr-only toggle label, sr-only `chat.a11y.unreadCount` in the dot | Color 1 |
| `Chat/Components/Room/ProximityRoomSidePanelHome.svelte:144-150` | unread questions dot unnamed | sr-only `chat.a11y.unreadCount` | Color 1 |
| `Components/Video/PictureInPicture/DesktopMiniWindow.svelte:272-276` | "meeting soon" warning dot unnamed | agenda button `aria-label` becomes new `desktop.miniWindow.todayWithSoonMeeting` | Color 2 |
| `Components/ActionBar/ActionBarButton.svelte:22-25,174,250`; `MenuIcons/CameraMenuItem.svelte:115`, `MicrophoneMenuItem.svelte:113` | on/off told by background colour (icons differ, state not exposed) | optional `pressed` prop to `aria-pressed`, set on camera and microphone | Color 3 |
| `Chat/Components/Room/RoomTimeline.svelte:792` | unread-elsewhere badge button about 18 px | `before:absolute before:-inset-1` hit area (about 26 px, no visual change) | Tap 2 |
| `Chat/Components/Room/TypingUsers.svelte:29` | `h-[22px] overflow-hidden` | `min-h-[1.375rem]`, overflow removed (inner `truncate` kept) | Large text 1 |
| `Components/PopUp/PopUpMessage.svelte:46` | `max-h-[140px]` | `max-h-[8.75rem]` | Large text 2 |
| `Components/Tooltip/HelpTooltip.svelte:72` | `h-[26px]` | `min-h-[1.625rem]` | Large text 3 |
| `Components/Input/TextArea.svelte:41`, `Components/Moderation/ModerationModal.svelte:365` | `h-[85px]`, `h-[80px]` | `min-h-[5.3125rem]`, `min-h-[5rem]` (the textarea still auto-grows) | Large text 5 |
| `style/style.css:329-840` | 8 `font-size: Npx` | rem equivalents (30, 24, 22, 16, 16, 14, 12, 12 px / 16) | Large text 7 |

### Decisions

- Zoom keyboard model (product decision 6): one press is one smooth step and holding the key keeps zooming, the same as a pointer. `+`/`=`/`-` work while either zoom button has focus; they are not global shortcuts, so they do not compete with the game keys.
- Tabs use activation on Enter/Space with every tab in the Tab order. Roving tabindex with arrow keys was not added: it changes the keyboard model of three components, and manual activation is valid ARIA.
- The iframe modal traps focus only when it covers the game (center, fullscreen, mobile). A left or right modal is a side panel: focus is not pulled in, so the avatar keys keep working. The trap returns focus only when focus is still inside the dialog or was dropped to the body.
- Grouped message time (product decision 2) goes to assistive tech only (sr-only `<time>`). No visual change for sighted keyboard users, who keep the `title`.
- `aria-pressed` on ActionBarButton is opt-in per caller, not derived from `state`. `normal` vs `active` also marks non-toggle buttons, so a generic mapping would label menu openers as toggles.
- New i18n keys were added in en-US and pt-BR only.

### Not done

- Large text 4 (`Components/MainLayout.svelte:248` `h-[135px]` video tile): it holds a video box sized by `h-full`, not text. `min-h` would collapse the tile.
- Large text 6 (`DesktopCapturerSourcePicker` close 36 px, FollowButton): the close button shows one glyph. `FollowButton.svelte` no longer exists.
- Large text 7, the 33 `text-[Npx]` uses in components: spread over files other agents are editing. Only `style/style.css` was converted.
- Color 3, other ActionBarButton states (megaphone `forbidden`, `live`): the megaphone button shows only while live. No caller toggles, so `pressed` was not wired.
- Tap targets: no rendered measurement. Sizes come from the classes.
- Nothing was rendered or run (no svelte-check per sprint rules). Needs a browser pass: zoom by keyboard, the cowebsite splitter by arrows, focus return on the 5 dialogs, and the mini-window row actions at `w-0`.
