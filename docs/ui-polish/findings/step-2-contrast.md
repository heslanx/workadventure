# Step 2, text contrast

## Method

Scripts (outside the repo): `/tmp/contrast/contrast.mjs` (full matrix), `/tmp/contrast/extra.mjs` (panel and card stacks), `/tmp/contrast/badge.mjs` (status badge and disabled checks).

1. Tokens read from `node_modules/@workadventure/design-system/src/theme.css` (only the default theme exists, dark: `color-scheme: dark`). HSL converted to sRGB.
   - `--contrast` = `216 41% 18%` (the panel fill), `--contrast-900` = `216 63% 12%`.
   - `--neutral-400/500/600/800` = `228 14% 86%` / `223 9% 71%` / `222 9% 61%` / `223 9% 46%`.
   - `text-gray-*` has no override in `theme.css` or `libs/tailwind/style/index.css`, so it is the stock Tailwind palette: gray-400 `#9ca3af`, gray-500 `#6b7280`.
2. Alpha is composited per channel, `out = fg*a + bg*(1-a)`, in sRGB space (same as the browser). Foreground `text-white/N` is first composited over the surface it sits on, then compared with that surface.
3. Ratio = `(L1+0.05)/(L2+0.05)` with WCAG relative luminance.
4. Surfaces modelled (all from real classes):
   - `bg-contrast` solid (Woka scenes, message input area, mini window header).
   - `bg-contrast-900` solid (mini window body).
   - Panel = `bg-contrast/80 backdrop-blur` (Menu.svelte:148/211, MapEditor sidebar, chat panels, action bar items). It is semi-transparent over the game canvas, so it was composited over three canvas values: black, mid grey (128), white. "Panel" below means over mid grey, the typical case. Blur averages the canvas, so mid is the fair central estimate; white is the worst case.
   - Stacks: panel + `bg-white/[0.02]` (side panels) + `bg-white/[0.04]` card (RoomSidePanelSettings:283); `bg-contrast` + `bg-white/5` (message input); `bg-contrast` + `bg-white/10` (chips and cards).
5. Target: 4.5 for body text and for 11-14 px text (all of these are below the 18.66 px bold or 24 px "large" threshold, so none qualify for 3:1).

Census (play/src/front, class occurrences): `text-white/60` 56, `/50` 51, `/80` 35, `/70` 33, `/55` 21, `/75` 19, `/90` 17, `/40` 13, `/45` 9, `/30` 1, `/35` 1; `text-gray-400` 11, `-500` 5, `-600` 1; `text-neutral-400` 1; `text-contrast-200` 23. No hardcoded hex text colors worth reporting (only palette tokens in `libs/tailwind`).

## Measured ratios, current state

Worst first. "Panel" = `bg-contrast/80` over mid grey canvas.

| Surface | Foreground class | Ratio | AA verdict |
|---|---|---|---|
| bg-contrast solid | text-white/30 | 2.63 | FAIL |
| panel + white/.02 + card white/.04 | text-white/45 | 3.31 | FAIL |
| panel | text-gray-500 | 2.33 | FAIL |
| bg-contrast solid | text-gray-500 | 2.98 | FAIL |
| panel | text-white/40 | 3.22 | FAIL |
| bg-contrast-900 solid | text-white/40 | 3.76 | FAIL |
| bg-contrast + white/10 | text-white/45 | 3.53 | FAIL |
| bg-contrast + white/10 | text-white/50 | 3.98 | FAIL |
| panel + white/.02 | text-white/50 | 3.99 | FAIL |
| panel | text-white/50 | 4.14 | FAIL |
| bg-contrast + white/5 | placeholder text-white/50 | 4.38 | FAIL (just) |
| panel | text-gray-400 | 4.44 | FAIL (just) |
| bg-contrast-900 solid | text-white/45 | 4.42 | FAIL (just) |
| bg-contrast solid | text-white/50 | 4.75 | pass |
| panel | text-white/60 | 5.21 | pass |
| panel | text-white/70 | 6.46 | pass |
| bg-contrast solid | text-white/60 | 6.16 | pass |
| bg-contrast solid | text-white/80 | 9.74 | pass |
| bg-contrast solid | text-neutral-500 | 6.81 | pass |

Panel over a white canvas (worst case, light map behind a blurred panel): white/50 = 3.24, white/60 = 3.93, white/70 = 4.71, white/80 = 5.57, gray-400 = 2.99. Over a black canvas: white/50 = 5.01, white/60 = 6.60.

Primary text (`text-white`) on `bg-contrast` is 14.43:1, so primary/secondary separation survives the proposals below (white vs white/60 or /70).

## Findings

Ranked by user harm (lowest ratio, most-seen, smallest text). All are class swaps only; no size, layout or hue change. Proposed `text-white/N` values reuse opacity steps already present in the codebase.

1. `Components/Woka/WokaSelectScene.svelte:257` and `Components/Woka/WokaCustomizeScene.svelte:366` | `text-gray-500` | `text-white/60` | 2.98 -> 6.16 (surface: solid `bg-contrast`, WokaSelectScene:205) | high
2. `Chat/Components/Room/MessageInputBar.svelte:967` | `text-white/30` (quoted reply preview, text-xs) | `text-white/60` | 2.63 -> 6.16 (solid `bg-contrast`, :954) | high
3. `Chat/Components/RoomFolder.svelte:258` | `text-gray-500` | `text-white/60` | 2.33 -> 5.21 (panel). Same line 259 `text-white/50` -> `text-white/60`: 4.14 -> 5.21 | high
4. `Components/MapEditor/EntityEditor/EntitiesGrid.svelte:17` | `text-gray-500` | `text-white/60` | 2.33 -> 5.21 (map editor sidebar `bg-contrast/80`, MapEditor.svelte:72) | high
5. `Components/Video/PictureInPicture/DesktopMiniWindow.svelte:400,497,567,619,640,711,731,744,755,769,777` | `text-white/40` (text-xxs 11 px in 7 of them) | `text-white/60` | 3.76 -> 6.86 (solid `bg-contrast-900`, :217) | high
6. `Chat/Components/Room/MessageSystem.svelte:18` | `text-white/40` (timestamp, text-xs) | `text-white/60` | 3.22 -> 5.21 (panel) | high
7. `Chat/Components/Room/RoomSidePanelSettings.svelte:287,298,371,452,473`; `RoomSidePanelHome.svelte:241,261`; `ProximityRoomSidePanelQuestions.svelte:96,143` | `text-white/45` (text-xs) | `text-white/70` | 3.31 -> 5.60 in the settings card (panel + .02 + .04); 3.53 -> 6.14 on `bg-white/10` chips | high
8. `Chat/Components/Room/Message.svelte:371` | `text-white/50` ("edited", text-xxs) | `text-white/70` | 3.98 -> 6.14 (bubble `bg-white/10` over `bg-contrast`, :337) | medium (bubble stack not fully traced)
9. `Components/Input/InputSwitch.svelte:62,71,79` | `text-white/50` (off label and description) | `text-white/60` | 4.14 -> 5.21 (panel) | medium (surface depends on host menu)
10. `Components/ActionBar/MenuIcons/HeaderMenuItem.svelte:9`, `MediaSettingsList/SectionTitle.svelte:13`, `MediaSettingsList/MediaSettingsListHeader.svelte:18,33`, `MenuIcons/ParticipantMenuItem.svelte:324,414` | `text-white/50` (text-xxs uppercase 11 px) | `text-white/60` | 4.14 -> 5.21 (panel; 3.24 -> 3.93 over white canvas) | medium
11. `Chat/Components/ChatSettings.svelte:130,154,202,219`; `Room/RoomSidePanelParticipants.svelte:181,199`; `Chat/Components/RoomList.svelte:415,421` | `text-white/50` (text-xs uppercase headers) | `text-white/60` | 4.14 -> 5.21 (panel); 3.99 -> 5.00 on side panel `bg-white/[0.02]` | medium
12. `Chat/Components/Room/Room.svelte:128`, `CatchUpList.svelte:45`, `Room/RoomInvitation.svelte:81`, `Room/PollCard.svelte:151,155,160,243`, `Room/RoomSidePanelPollItem.svelte:130,134,218`, `Room/Message/MessageReadReceipt.svelte:95` | `text-white/50` (text-xs metadata) | `text-white/60` | 4.14 -> 5.21 (panel) | medium
13. `Chat/Components/Room/MessageInputBar.svelte:994` (and `ChatHeader.svelte:146`, `ProximityRoomSidePanelQuestions.svelte:88` at white/35) | `placeholder:text-white/50` (white/35 in the last) | `placeholder:text-white/60` (white/35 -> `placeholder:text-white/60`) | 4.38 -> 5.58 on `bg-contrast`+`bg-white/5`; white/35 on `bg-black/20` over contrast 3.17 -> 6.60 | medium (ChatHeader sits on `bg-contrast/30`, not measured exactly)
14. `Chat/Components/Room/MessageInputBar.svelte:626` and `Room/Application/ApplicationFormWrapper.svelte:191` (`text-gray-400`, text-xs) | `text-gray-400` | `text-neutral-500` | 4.17 -> 5.00 on hover `bg-white/10` over contrast (gray-400 is 5.68 on plain contrast, so only the hover state fails) | low
15. `Chat/Components/ShowMore.svelte:54` | `text-gray-400` (text-sm) | `text-neutral-500` | 4.44 -> 5.32 (panel) | low

## Left alone on purpose

- Status colors: `bg-warning/success/danger text-contrast-900` in `MessageAttachmentRecipients.svelte:89-92` measure 10.53 / 11.16 / 5.64, all pass and are status hues.
- Disabled states (WCAG exempts them): `User.svelte:165` `text-gray-400` when sending is blocked; `disabled:text-gray-400 disabled:bg-gray-500` in `ResetKeyStorageConfirmationModal.svelte:31`, `RequiresLoginForChatModal.svelte:36`, `CreateRecoveryKeyDialog.svelte:155,163`, `AccessSecretStorageDialog.svelte:182` (1.90, intentionally muted; the lone worst number in the repo, but it signals "disabled").
- Icon-only `text-white/50` (non-text, 3:1 applies, 3.2+ on all panel states): `PwaInstallScreen.svelte:114,128,142`, `MediaSettingsPanel.svelte:187,305`, `MessageFileInput.svelte:78`, `BackgroundSettingsPanel.svelte:50`, `RecordingsListModal.svelte:326`.
- `ChatLoader.svelte:11` `text-gray-400 text-xl`: 24 px counts as large text, 4.44 >= 3.
- `Alert.svelte:19` `text-neutral-400` on `bg-neutral-1200`: 10.84.
- `Spinner.svelte:25` gray (graphic, not text).
- All `text-white/60` and above (the 56 + 35 + 33 + 19 + ... uses): at or above 5.21 on a mid canvas.
- `text-contrast-200` (23 uses): 7.53 on solid contrast, 5.89 on panel mid.
- Hover states (`hover:text-white/80`) only raise contrast.

## Cannot fix without a new token

- Panels over a very light game canvas. `bg-contrast/80` over a white canvas drops even `text-white/70` to 4.71 and `text-white/60` to 3.93. The fix is a more opaque panel (`bg-contrast/90` already exists as a class, but it changes the surface look and is a step-3/visual decision, not a text color swap), or a dedicated "panel" token. Not touched here.
- There is no semantic "text-muted/secondary" token (for example `--text-secondary`). The system relies on ad hoc `text-white/N`, which is why the same role uses 30, 35, 40, 45, 50, 55, 60, 65 and 70. Proposal for a later step: one `text-white/60` (or token) for secondary and one `text-white/70` for tertiary-on-card, adopted via a token, so the 8 steps collapse into 2.
- `text-gray-*` is the stock Tailwind palette, not a design-system token. The proposals use `text-neutral-500` or `text-white/N` instead; a gray override in the theme would be needed to keep `text-gray-*` meaningful.

## Landed (session 2)

Class swaps only; font size, layout, wording and hue untouched. Ratios from the Method above (panel = `bg-contrast/80` over a mid-grey canvas).

| Finding | File:line (play/src/front/...) | Before | After | Ratio before -> after |
|---|---|---|---|---|
| 7 | `Chat/Components/Room/RoomSidePanelSettings.svelte:287,298,371,452,473` | `text-white/45` | `text-white/70` | 3.31 -> 5.60 (panel + .02 + .04 card) |
| 7 | `Chat/Components/Room/RoomSidePanelHome.svelte:241,261` | `text-white/45` | `text-white/70` | 3.53 -> 6.14 (`bg-white/10` card) |
| 7 | `Chat/Components/Room/ProximityRoomSidePanelQuestions.svelte:96,143` | `text-white/45` | `text-white/70` | 3.31 -> 5.60 / 3.53 -> 6.14 |
| 8 | `Chat/Components/Room/Message.svelte:371` | `text-white/50` | `text-white/70` | 3.98 -> 6.14 (bubble `bg-white/10` over contrast) |
| 9 | `Components/Input/InputSwitch.svelte:62,71,79` | `text-white/50` | `text-white/60` | 4.14 -> 5.21 |
| 10 | `Components/ActionBar/MenuIcons/HeaderMenuItem.svelte:9`; `Components/ActionBar/MediaSettingsList/SectionTitle.svelte:13`; `.../MediaSettingsListHeader.svelte:18,33`; `Components/ActionBar/MenuIcons/ParticipantMenuItem.svelte:323,413` | `text-white/50` | `text-white/60` | 4.14 -> 5.21 (white canvas 3.24 -> 3.93) |
| 11 | `Chat/Components/ChatSettings.svelte:130,154,202,219`; `Chat/Components/Room/RoomSidePanelParticipants.svelte:181,199`; `Chat/Components/RoomList.svelte:415,421` | `text-white/50` | `text-white/60` | 4.14 -> 5.21; 3.99 -> 5.00 on side panel |
| 12 | `Chat/Components/Room/Room.svelte:129`; `Chat/Components/CatchUpList.svelte:45`; `Chat/Components/Room/RoomInvitation.svelte:81`; `Chat/Components/Room/PollCard.svelte:151,155,160,243`; `Chat/Components/Room/RoomSidePanelPollItem.svelte:130,134,218`; `Chat/Components/Room/Message/MessageReadReceipt.svelte:95` | `text-white/50` | `text-white/60` | 4.14 -> 5.21 |
| 13 | `Chat/Components/Room/MessageInputBar.svelte:994`; `Chat/Components/ChatHeader.svelte:146` | `placeholder:text-white/50` | `placeholder:text-white/60` | 4.38 -> 5.58 (contrast + white/5) |
| 13 | `Chat/Components/Room/ProximityRoomSidePanelQuestions.svelte:88` | `placeholder:text-white/35` | `placeholder:text-white/60` | 3.17 -> 6.60 (`bg-black/20` over contrast) |
| 15 | `Chat/Components/ShowMore.svelte:54` | `text-gray-400` | `text-neutral-500` | 4.44 -> 5.32 |

Primary `text-white` stays at 14.43:1, so secondary (/60, /70) remains visibly distinct.

## Skipped

- Findings 1-6 (WokaSelectScene/WokaCustomizeScene gray-500, MessageInputBar quoted reply white/30, RoomFolder, EntitiesGrid, DesktopMiniWindow white/40, MessageSystem timestamp): already present in the working tree as `text-white/60` before this session; nothing left to change.
- Finding 14 (MessageInputBar application hint and ApplicationFormWrapper:191 `text-gray-400`): the working tree already reads `text-white/60` (another step changed it; about 5.0 on hover `bg-white/10`, between the measured /50 = 3.98 and /70 = 6.14, and 6.16 on plain contrast), so the proposed `text-neutral-500` swap was not applied over it.

## Parked

- Panels over a very light game canvas (`bg-contrast/80` over white keeps `text-white/60` at 3.93): needs a more opaque panel or a panel token, a surface decision outside a text-colour swap.
- Semantic secondary/tertiary text token: needs a new token; out of scope for this pass.

## Review round (session 2)

No code changed in this round; all three findings were rejected after checking the current tree.

- R1 `Chat/Components/ShowMore.svelte:54` (`text-gray-400` -> `text-neutral-500` lowers contrast): rejected. The reviewer used stock Tailwind neutral-500 (`#737373`). This design system overrides it: `node_modules/@workadventure/design-system/src/theme.css:9` sets `--neutral-500: 223 9% 71%` (about `#aeb2bc`), which is lighter than gray-400 `#9ca3af`. On the reviewer's own `#1b1b29` surface it measures 8.02:1 against 6.70:1 for gray-400, so the swap raises contrast and uses a design-system token instead of the stock gray palette.
- R2 `Chat/Components/Room/RoomSidePanelHome.svelte:215,233,253` (`text-xs` -> `text-base font-bold`): rejected for this step. The contrast step did not make this change; its only edits in this file are the hints at `:241,261` (`text-white/45` -> `text-white/70`). The size and weight change is step 6 (type hierarchy) findings 2 and R3 in `step-6-type-hierarchy.md`, a deliberate fix for counts that were smaller than their labels. Reverting it here would undo another step's work.
- R3 `Chat/Components/Room/MessageInputBar.svelte:706` and the other tiles (`disabled` -> `aria-disabled`): rejected for this step. The contrast step did not make this change. It is the usability-interaction step, Clique 7 (`usability-interaction.md:30` and `:141`), which made the tiles focusable on purpose so that a screen reader reads the reason printed in the tile. The click guards keep them inert. Reverting it would undo that step's documented change; any objection belongs to that step's review.

## Sprint 4: surfaces

Resolves the parked item "Panels over a very light game canvas" and the ad hoc secondary steps, without a new token. Scripts: `/tmp/contrast/panel.mjs` and `/tmp/contrast/low.mjs` (same compositing and WCAG maths as the Method above). Worst case = the panel composited over a white (`#ffffff`) canvas, since blur cannot make the canvas lighter than white.

### Opacity choice

Ratios of secondary text over white underneath, per panel opacity (`bg-contrast/N`):

| Panel | white/50 | white/60 | white/70 | text-white | white/60 on +.02 side panel | white/70 on +.02 +.04 card | white/70 on `bg-white/10` chip |
|---|---|---|---|---|---|---|---|
| /50 (chat sidebar, toasts) | 1.84 | 2.05 | 2.28 | 3.04 | n/a | n/a | 2.05 |
| /75 (Popup) | 2.92 | 3.49 | 4.12 | 6.44 | n/a | n/a | 3.40 |
| /80 (before) | 3.24 | 3.93 | 4.71 | 7.59 | 3.78 | 4.15 | 3.81 |
| /90 | 3.98 | 4.99 | 6.14 | 10.59 | 4.78 | 5.33 | 4.83 |
| **/95 (after)** | 4.38 | **5.58** | **6.97** | 12.43 | **5.35** | **6.05** | **5.45** |

`/90` passes on the bare panel but leaves white/60 on a card at 4.40 and on a chip at 4.03, so `/95` (already used by `RoomList.svelte:598`) is the step that clears 4.5 on every stack. Over a mid-grey canvas `/95` measures white/60 = 5.93 (5.21 at `/80`), so the look on dark maps barely moves; the backdrop blur stays.

### Landed

Surfaces (play/src/front/..., all `bg-contrast/80 -> bg-contrast/95` unless noted). Secondary white/60: 3.93 -> 5.58 over white.

| File:line | Before | After |
|---|---|---|
| `Components/Menu/Menu.svelte:148,211` (menu nav and submenu container) | `bg-contrast/80` | `bg-contrast/95` |
| `Components/MapEditor/MapEditor.svelte:72` (editor sidebar) | `bg-contrast/80` | `bg-contrast/95` |
| `Components/MapEditor/WAMSettingsEditor.svelte:68`; `Components/MapEditor/EntityEditor/EntityUpload/EntityUpload.svelte:118` | `bg-contrast/80` | `bg-contrast/95` |
| `Components/ActionsMenu/ActionsMenu.svelte:64`; `Components/ActionsMenu/WokaMenu.svelte:88`; `Components/MeetingInvitation/MeetingInvitationPopup.svelte:33` | `bg-contrast/80` | `bg-contrast/95` |
| `Components/PopUp/PopUpContainer.svelte:28`; `Components/PopUp/PopUpFollow.svelte:85`; `Components/PopUp/LockableAreaPicker.svelte:55`; `Components/PopUp/RaiseHandSpacePicker.svelte:31`; `Components/PopUp/Recording/RecordingSpacePicker.svelte:43`; `Components/PopUp/Recording/RecordingContextMenuContent.svelte:86` | `bg-contrast/80` | `bg-contrast/95` |
| `Components/Calendar/Calendar.svelte:48`; `Components/TodoList/TodoList.svelte:71` | `bg-contrast/80` | `bg-contrast/95` |
| Action bar dropdowns: `Components/ActionBar/MenuIcons/ProfileMenuContent.svelte:156`, `MapSubMenu.svelte:87`, `ParticipantMenuItem.svelte:295`, `AppsMenuItem.svelte:82`; `Components/ActionBar/EmojiSubMenu.svelte:174`; `Components/AudioManager/AudioManager.svelte:94` | `bg-contrast/80` | `bg-contrast/95` |
| `Components/ActionBar/MediaSettingsList/MediaSettingsList.svelte:46` | `before:bg-contrast/80` | `before:bg-contrast/95` |
| `Components/HelpSettings/HelpPopUpBlocked.svelte:20`, `HelpCameraSettingsPopup.svelte:29`, `HelpNotificationSettingPopup.svelte:29`, `HelpWebRtcSettingsPopup.svelte:44` | `bg-contrast/80` | `bg-contrast/95` |
| `Components/Announcement/AnnouncementComposerModal.svelte:98`; `Components/Modal/GlobalCommunicationModal.svelte:132`; `Components/Modal/LimitRoomModal.svelte:12`; `Components/Modal/Modal.svelte:72` | `bg-contrast/80` | `bg-contrast/95` |
| `Components/Video/ActionMediaBox.svelte:129`; `Chat/Components/UserList/UserActionButton.svelte:211`; `Components/VisitCard/VisitCard.svelte:71` | `bg-contrast/80` | `bg-contrast/95` |
| `Components/Modal/Popup.svelte:76` | `bg-contrast/75` | `bg-contrast/95` (white/60 3.49 -> 5.58) |
| `Chat/ChatSidebar.svelte:123` (chat window, absolute over the map) | `bg-contrast/50` | `bg-contrast/95` (white/60 2.05 -> 5.58; even `text-white` was 3.04) |
| `Components/Toasts/ToastContainer.svelte:144` | `bg-contrast/50` | `bg-contrast/95` (white/80 2.52 -> 8.58) |
| `Components/ProximityNotification/ProximityNotification.svelte:53` | `bg-contrast/50 ... hover:bg-contrast/90` | `bg-contrast/95 ... hover:bg-contrast` (hover still darkens, so it still responds) |

Secondary text collapsed to two steps: `text-white/60` on a panel surface, `text-white/70` on a card layer (`bg-white/[0.04]`, `bg-white/5`, `bg-white/10`). After this pass no `text-white/45`, `/55` or `/65` remains in `play/src/front`.

| File:line | Before | After | Ratio over white, after |
|---|---|---|---|
| `Chat/Components/ShowMore.svelte:69` | `text-white/50` | `text-white/60` | 5.58 |
| `Chat/Components/MatrixPeerProfileDebugModal.svelte:102,138` | `text-white/50` | `text-white/60` | 5.70 (`bg-contrast/90` over a `bg-black/50` scrim over white) |
| `Chat/Components/ChatSettings.svelte:241` | `text-white/55` | `text-white/60` | 5.58 |
| `Chat/Components/Room/QuestionCard.svelte:62`; `PollCard.svelte:171`; `ThreadPanel.svelte:173`; `RoomSidePanelPollItem.svelte:143`; `ProximityRoomSidePanelQuestions.svelte:83` | `text-white/55` | `text-white/60` | 5.35 to 5.58 |
| `Components/ActionBar/MediaSettingsList/MediaSettingsPanel.svelte:134,137,140,249,252,255,331` | `text-white/55` | `text-white/60` | 5.58 |
| `Components/ActionBar/MediaSettingsList/MediaSettingsPanel.svelte:229`; `Components/ActionBar/EmojiSubMenu.svelte:199`; `Components/MapEditor/PropertyEditor/StartPropertyEditor.svelte:47` | `text-white/50` | `text-white/60` | 5.58 |
| `Components/Menu/AboutRoomSubMenu.svelte:73,74`; `Components/Menu/SettingsSubMenu.svelte:536,708` | `text-white/50` | `text-white/60` | 5.58 |
| `Chat/Components/Room/RoomSidePanelHome.svelte:177,192`; `ProximityRoomSidePanelHome.svelte:99`; `ProximityRoomSidePanelParticipants.svelte:37`; `PollCard.svelte:255` | `text-white/65` | `text-white/70` | 5.45 (chip) to 6.05 (card) |
| `Chat/Components/Room/RoomSidePanelHome.svelte:215,233,253,274`; `ProximityRoomSidePanelHome.svelte:118,129,152`; `ProximityRoomSidePanelQuestions.svelte:130` | `text-white/55` | `text-white/70` | 6.05 (card), matching the `/70` hints already on the same cards |

### Decisions

- `/95` over `/90`: `/90` fails on the card and chip stacks over white (4.40, 4.03). `/95` is an existing step, so no new token.
- The chat sidebar, toasts and the proximity notification were at `/50`, not `/80` as the Method assumed for "chat panels". They are absolute over the map and failed for primary text too, so they were raised in the same pass.
- `text-white/75` and `/85` were left: they are emphasis or nav-row resting states (`RoomList.svelte`, `RoomFolder.svelte`, `ChatError.svelte`), not secondary metadata, and they pass.
- Cards keep `/70`, panels `/60`: white/60 on a `bg-white/10` chip over white is 4.48, so a card layer needs the higher step.
- Class swaps only. No wording, size, layout or behaviour change, so no i18n keys.

### Not done

- Panels stacked inside an already raised panel (`ActionsMenu.svelte:106`, `ShortcutSubMenu.svelte:257,263`, `Chat/Components/Room/MessageInputBar.svelte:634`, `ChatMessageBanner.svelte:47`, toast `buttons-wrapper` at `/60`): their effective opacity is above 95%, so they pass without a change.
- Action bar pills (`ActionBarButton.svelte:135`, `ProfileMenu.svelte:71`, `ParticipantMenuItem.svelte:235`, `MapSubMenu.svelte:62`) and icon-only chips (`ExplorerMenu.svelte:168`, `ImageCowebsiteComponent.svelte:109`, close buttons in `Menu.svelte:205,221` and `MapEditorSideBar.svelte`): primary text or icons only, 7.59 and 3:1+ at `/80` over white.
- Video backgrounds (`CenteredVideo.svelte`, `VideoMediaBox.svelte`, `InnerWebRtcVideo.svelte`, `EnableCameraScene.svelte:255,311`), the Woka/companion scene bars (over a solid `bg-contrast` scene) and `MainLayout.svelte:238` (camera list): no secondary text over a light map.
- `Chat/Components/ChatImagePreviewModal.svelte:56` (`/75`): it sits on a `bg-black/50` scrim, so the canvas underneath is at most mid grey; left as is.
- Remaining `text-white/50` and `/40` are icons (`MediaSettingsPanel.svelte:187,305`, `BackgroundSettingsPanel.svelte:50`, `PwaInstallScreen.svelte`, `MessageFileInput.svelte:78`, `RecordingsListModal.svelte:326`) or unselected tabs on solid `bg-contrast` (`WokaCustomizeScene.svelte:319,343`, 4.75). Left per "Left alone on purpose".
- Semantic secondary text token: still not added (a new token was out of scope); the two-step rule above is the convention to adopt into one.
- Not verified in a browser; the orchestrator runs the checks.
