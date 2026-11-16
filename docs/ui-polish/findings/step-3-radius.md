# Step 3, corner radius

Scope: `play/src/front` (490 `.svelte` files). Audit only, no source edited. Paths below are relative to `play/src/front/`.

## How the radius scale resolves (read this first)

`node_modules/@workadventure/design-system/src/theme.css` (inside `@theme inline`) overrides Tailwind v4's radius scale. Tailwind's own defaults (`node_modules/tailwindcss/theme.css`) fill the rest. The result:

| Class | Real value | Token? |
|---|---|---|
| `rounded-sm` | 4px | yes (`--radius-sm`) |
| `rounded` (bare) | **8px** (`--radius`, overridden from Tailwind's 4px) | yes (`--radius`) |
| `rounded-md` | 12px | yes |
| `rounded-lg` | 16px | yes |
| `rounded-xl` | **32px** | yes, but very large |
| `rounded-2xl` | 16px (Tailwind default 1rem, not overridden) | **no**, duplicate of `-lg` |
| `rounded-3xl` | 24px (Tailwind default 1.5rem) | **no**, off-scale |
| `rounded-full` | 9999px | yes |
| `rounded-[6px]`, `[8px]`, `[10px]` | arbitrary | `[8px]` equals `--radius`; 6px and 10px are not tokens |

Confirmed by the design system itself: `components/buttons.css` `.btn` is `rounded-[8px]`, `components/inputs.css` default inputs are `rounded-md`, `chip.css` is `rounded-sm` (via `Components/UI/Chip.svelte`), `components/card.css` is `rounded-lg` with an inner `rounded` image. A comment in `Components/Video/PictureInPicture/DesktopMeetingBar.svelte:184` states the same scale.

Census total (all `.svelte`): rounded-lg 185, rounded-full 119, rounded-md 91, rounded-sm 29, rounded-xl 20, rounded-2xl 17, rounded-3xl 7, rounded-none 13, bare `rounded` about 220 (the baseline did not list it, and it is the second most used class). Counts match the given baseline.

Method note: the per-type counts below come from line-level pattern matching (a class string on one line is attributed to a type by neighbouring utilities). A multi-line class list can be missed or counted under a neighbour, so read counts as +/- 10%. Radii were derived from the token files, not measured in a browser.

## Census by element type

| Element type | Radii in use (count) | The one to keep | Files affected (outliers) |
|---|---|---|---|
| Primary / text button | rounded-lg 8, rounded 6, rounded-md 2 (design-system `.btn` = 8px via `rounded-[8px]`) | `rounded` (8px) | 10 |
| Icon button (square, hover bg) | rounded 34, rounded-full 17, rounded-md 13, rounded-lg 8, rounded-2xl 1-3 | `rounded` (8px); pills stay | 13 |
| Menu / dropdown row | rounded 27, rounded-lg 7, rounded-md 1 | `rounded` (8px) | 2 |
| Popup menu / popover surface | rounded-lg 30, rounded-md 21, rounded-xl 9, rounded 9, rounded-3xl 3, rounded-2xl 3 | `rounded-md` for p-1 menus; `rounded-lg` for floating cards | 5 |
| Modal / dialog | rounded-3xl 7, rounded-2xl 1, rounded-lg 4, rounded-md 2, rounded 1 | `rounded-lg` (16px), same as PopUpContainer and Toast | 7 |
| Toast | rounded-lg 2 (ToastContainer, PopUpContainer); CSS `12px` in Recording toasts | `rounded-lg` | 0 (already consistent in Tailwind) |
| Card / info panel | rounded-lg 37, rounded-xl 5-8, rounded 6, rounded-md 2, rounded-2xl 4 | `rounded-lg` (16px) | 14 |
| Onboarding card | rounded-xl 7 (all) | `rounded-lg` | 7 |
| Input / textarea / select | rounded-md 5+ (+ `!rounded-md` overrides, svelte-select CSS 8px), rounded-lg 2, rounded 3 (LoginScene, languages select), rounded-2xl 1 | `rounded-md` (12px, design-system default) | 4 |
| Chip / tag / badge | rounded-full 20 (counters, status), rounded-sm 5 (Chip, Todo, Calendar), rounded-md 2-3 (QuestionCard, RoomOption), rounded 2 | `rounded-sm` for labels, `rounded-full` for counters | 4 |
| Tooltip | rounded 6, rounded-md 1, rounded-lg 1 | `rounded` (8px) | 1 |
| Video tile / media | rounded-lg dominant | `rounded-lg` | 0 |
| List row with bg | rounded 15+, rounded-md 8 | `rounded` | 0 (see Left alone) |

Headline: icon buttons use four radii (8, 12, 16, plus 16 via 2xl), cards use three (16, 32, 16-as-2xl), modals use four (24, 16, 16-as-2xl, 12), primary buttons use three (8, 12, 16), and inputs use three (8, 12, 16).

## Findings

Ranked by visual impact. "Group" rows are one decision applied to several lines.

| # | `file:line` | Element type | Current | Proposed | Reason | Confidence |
|---|---|---|---|---|---|---|
| 1 | `Components/Modal/Popup.svelte:76`, `Components/BrowserNotSupported/BrowserNotSupported.svelte:33`, `Components/MapEditor/PropertyEditor/LivekitRoomConfigEditor.svelte:92`, `Components/MapEditor/PropertyEditor/JitsiRoomConfigEditor.svelte:76`, `Components/Modal/ObjectDetails.svelte:196`, `Chat/Components/ChatImagePreviewModal.svelte:56`, `Chat/Components/MatrixPeerProfileDebugModal.svelte:72` | Modal / dialog | `rounded-3xl` (24px) | `rounded-lg` | 24px is the only radius off the token scale. Every other floating surface (PopUpContainer.svelte:28, ToastContainer.svelte:53, HelpPopUp*, Notification) is 16px. `ChatImagePreviewModal:66` already has a 16px image inside a 24px shell. | High |
| 2 | `Chat/Components/MatrixPeerProfileDebugModal.svelte:95,107,122,141` | Card / row inside modal | `rounded-xl` (32px) | `rounded-lg` | 32px rows inside a 24px modal: the inner radius is larger than the outer one. After #1 (outer 16px) the rows should be 16px, like every sibling card in the chat panels (`ThreadPanel`, `RoomSidePanel*` all `rounded-lg`). | High |
| 3 | `Chat/Components/ChatSettings.svelte:148,157,227` | Card / row | `rounded-xl` (32px) | `rounded-lg` | Same card pattern (`border-white/10 bg-white/[0.04] px-3 py-2`) as 40+ siblings that use `rounded-lg`. 32px on a ~40px-tall row is nearly a pill. | High |
| 4 | `Components/Onboarding/Steps/{Welcome:31, Complete:27, PictureInPicture:18, LockBubble:18, ScreenSharing:18, Movement:108, Communication:24}Step.svelte` | Onboarding card (floating) | `rounded-xl` (32px) | `rounded-lg` | Same surface type as PopUpContainer (16px). The video inside (`rounded-lg`, 16px) and the buttons (`rounded-lg`) then match the outer shell instead of being nearly 2x smaller. | High |
| 5 | `Components/Menu/Menu.svelte:148` (`@md/main-layout:rounded-xl`) and `:211` (`rounded-xl`) | Large panel | `rounded-xl` (32px) at md+ | `rounded-lg` (drop the `@md` override at 148) | The only full-height panels at 32px; the mobile wrappers at `:205,:221` and every other panel are 16px. The nav rows inside (`:172`, `rounded-md` then `@md:rounded-lg`) already assume a 16px shell. | Medium (large surface, 32px may be deliberate branding) |
| 6 | `Chat/Components/ChatActionMenu.svelte:95` | Popup menu | `rounded-l` (8px, left corners only) | `rounded-md` | Almost certainly a typo for `rounded-lg`. Left-only radius leaves the right corners square. All other `p-1` menus use `rounded-md`. | High |
| 7 | `Chat/Components/ChatActionMenu.svelte:98,112` | Menu row | `rounded-lg` (16px) | `rounded` | Row sits in a `p-1` (4px) menu: 12 - 4 = 8px. See arithmetic. | High |
| 8 | `Chat/Components/UnreadConversationsPopover.svelte:23` | Popup menu | `rounded-lg` (16px) | `rounded-md` | Rows (`:35`) are already `rounded` (8px) and padding is `p-1`: 8 + 4 = 12px outer. Matches `UserActionButton:211`, `ProfileMenuContent:156`, `ActionMediaBox:129`, `RoomMenu:187`. | High |
| 9 | Icon buttons: `Chat/Components/RoomFolder.svelte:142,192`, `Chat/Components/Room/RoomSidePanel.svelte:84,111`, `Components/Exploration/Explorer.svelte:404,493`, `Chat/Components/Room/CreateRoomOrFolderOption.svelte:62`, `Chat/Components/ChatImagePreviewModal.svelte:81`, `Chat/Components/Room/MessageActionSheet.svelte:82`, `Chat/Components/ChatActionMenu.svelte:60,69` (`rounded-2xl`) | Icon button | `rounded-lg` / `rounded-2xl` (16px) | `rounded` | The same square hover-bg icon button is `rounded` (8px) in ~34 places (`ChatHeader:102,109`, `RoomList:447+`, `RoomTimeline:751+`, `ChatSettings:117`, `CoWebsitesContainer:214+`). `RoomFolder:142,192` also sit inside a 12px row, so 16px is larger than the container. | High |
| 10 | Icon buttons: `Chat/Components/Room/MessageInputBar.svelte:1007,1018,1031,1040`, `Chat/Components/Room/EmojiButton.svelte:59`, `Chat/Components/Room/MessageOptions.svelte:127,143,155`, `Chat/Components/UserList/User.svelte:163`, `Chat/Components/UserList/UserActionButton.svelte:198`, `Components/Exploration/Explorer.svelte:445,455,536,546` | Icon button | `rounded-md` (12px) | `rounded` | Same type as #9. 12px on a 28px button is 43%, visibly rounder than the 8px peers next to it in the same toolbars (e.g. Explorer mixes 8, 12 and 16 in one list row: `:377` rounded, `:445` rounded-md, `:404` rounded-lg). | Medium (12px may be fine on 44px buttons; 28 to 32px ones are the clear misses) |
| 11 | `Components/Onboarding/Steps/{Welcome:45,52, LockBubble:37, PictureInPicture:37, ScreenSharing:37, Movement:194, Communication:42, Complete:41}Step.svelte`, `Chat/Components/requireConnection.svelte:33`, `Components/Video/AwayPausedOverlay.svelte:40` (`-md`), `Components/Video/PictureInPicture/DesktopMiniWindow.svelte:166` (`-md`) | Primary / text button | `rounded-lg` / `rounded-md` (16 / 12px) | `rounded` | Design-system `.btn` is 8px (`buttons.css:27`), and `WokaCustomizeScene:280,302,400,404` already uses `rounded`. 16px on a 40px button reads as a different component family. | High |
| 12 | `Components/Login/LoginScene.svelte:131`, `Components/Menu/SettingsSubMenu.svelte:688`, `Chat/Components/Room/MessageInputBar.svelte:994`, `Chat/Components/Room/ProximityRoomSidePanelQuestions.svelte:88` | Input / textarea / select | `rounded` (8px) at 131 and 688; `rounded-lg` (16px) at 994 and 88 | `rounded-md` | Design-system inputs are `rounded-md` (`inputs.css:28,99,161,233`), as are `CreateRecoveryKeyDialog:102,114`, `AccessSecretStorageDialog:113,147`, `GuestSubMenu:165`, `MessageEdition:70`, `InputTags:118`, `MemberAutocomplete:65`, `SelectMatrixUser:125`. These four are the outliers. | Medium (the chat composer at 994 sits inside a `rounded-lg` bar; see arithmetic) |
| 13 | `Chat/Components/Room/QuestionCard.svelte:42,50`, `Chat/Components/Room/RoomMenu/RoomOption.svelte:46`, `Chat/Components/RoomList.svelte:660` | Chip / tag | `rounded-md` (12px) or `rounded` (8px) | `rounded-sm` | Static text tags: `Components/UI/Chip.svelte:31`, `TodoList:87,117,122`, `Calendar:64,123`, `User.svelte:126` are all `rounded-sm` (4px). A 12px radius on a 24px-tall `h-6` tag is a near-pill that does not match either the chip (4px) or the counter pills (`rounded-full`). | Medium |
| 14 | Arbitrary values: `Chat/Components/Room/MessageInputBar.svelte:654,661` (`[10px]`), `:666` (`[6px]`), `Components/ProximityNotification/ProximityNotification.svelte:54` (`[10px]`), `Components/Video/ScreenAnnotationToolbar.svelte:87`, `Components/Video/PictureInPicture/DesktopMeetingBar.svelte:270`, `Components/ActionBar/MediaSettingsList/SelectionCheckOverlay.svelte:6` (all `[6px]`) | Various | `rounded-[10px]`, `rounded-[6px]` | `rounded` for 10px, `rounded-sm` for 6px | Not tokens. 6px and 10px do not exist in the scale. `MapList.svelte:177` `rounded-[8px]` equals `--radius`, so it can become `rounded`. 654/661 sit in a 12px `p-0.5` frame (10px is the arithmetic value, 8px is the nearest token). | Medium |
| 15 | `Components/ActionBar/MediaSettingsList/BackgroundPresetButton.svelte:21` | Nested media tile | `rounded-sm` (4px) inside `rounded-md` + `border-2` | `rounded` | Outer 12px with a 2px border leaves a 10px inner edge, inner is 4px. See arithmetic. | High |

Not in the 15 but queued (same rule, lower impact):

- 2xl to lg (visually identical, removes the non-token class): `PollCard.svelte:141`, `QuestionCard.svelte:36`, `ShortcutSubMenu.svelte:257,263`, `DuplicateUserConnectedModal.svelte:28`, `PwaInstallScreen.svelte:81`, `MessageInputBar.svelte:696` (`rounded-t-2xl`), `MapEditorSideBar.svelte:105,117,138`, `EntityItem.svelte:19`. `MessageSystem.svelte:14` `rounded-2xl` on a ~30px pill: use `rounded-full`.
- Picker lists with `p-2`: `PopUp/LockableAreaPicker.svelte:55,65,85`, `PopUp/RaiseHandSpacePicker.svelte:31,41`, `PopUp/Recording/RecordingSpacePicker.svelte:43,48`. Outer 12px minus 8px padding is 4px, rows are 8px: `rounded-sm`.
- `Chat/Components/Room/MentionSuggestions.svelte:159` `rounded-xl` (32px) around `rounded-lg` rows with `px-2`: outer to `rounded-lg`.
- `Components/Tooltip/HelpTooltip.svelte:42` tooltip `rounded-lg` (and `before:rounded-lg`) to `rounded`, matching the other five tooltips.

## Nested shape arithmetic

Rule used: inner radius = outer radius minus the gap between them (padding, plus border width if the inner element is inside the border). When the gap is at or above the outer radius the inner shape is free, so it follows its element type instead.

| Outer | Gap | Inner should be | Current inner | Verdict |
|---|---|---|---|---|
| `ChatActionMenu:95` `rounded-l` (8px, left only), `p-1` (4px) | 4px | `rounded-md` outer gives 12 - 4 = 8px: `rounded` | `:98,112` `rounded-lg` 16px | Wrong: inner (16) is larger than the outer (8). Fix = #6 and #7. |
| `UnreadConversationsPopover:23` `rounded-lg` 16px, `p-1` | 4px | 16 - 4 = 12px: `rounded-md` | `:35` `rounded` 8px | Off by 4px. Cheaper to move the outer to `rounded-md` (12 - 4 = 8, matches the row). #8. |
| `BackgroundPresetButton:16` `rounded-md` 12px, `border-2` | 2px | 12 - 2 = 10px: nearest token `rounded` (8px) | `:21` `rounded-sm` 4px | 6px short, produces a visible gap at the corner. #15. |
| `MessageInputBar:640` `rounded-md` 12px, `p-0.5` | 2px | 10px (arbitrary) | `:654,661` `rounded-[10px]` | Arithmetic is right but 10px is not a token. Use `rounded` (8px). #14. |
| `MatrixPeerProfileDebugModal:72` `rounded-3xl` 24px, body `px-4` (16px) | 16px | Free (gap is not below the radius, follows card type): `rounded-lg` | `:95,107,122,141` `rounded-xl` 32px | Inner (32) larger than outer (24). #2. |
| `Onboarding/*Step` `rounded-xl` 32px, `p-6` (24px) | 24px | 32 - 24 = 8px for the video; after #4 (outer 16, gap 24) the inner is free | `LockBubbleStep:29` `rounded-lg` 16px | Today the video corner is 8px too round relative to the shell. After #4 the shell and the video are both 16px, which is also correct. |
| `RoomFolder:105` row `rounded-md` 12px, `px-3` | 12px | 0 to `rounded-sm`; free, follows icon-button type: `rounded` | `:142,192` `rounded-lg` 16px | Inner (16) larger than outer (12). #9. |
| `QuestionCard:36` / `PollCard:141` `rounded-2xl` 16px, `p-4` (16px) | 16px | Free, follows its type | `PollCard:195` `rounded-lg` 16px | Fine visually. Only the class name is off-token (2xl to lg). |
| `ChatImagePreviewModal:56` `rounded-3xl` 24px, image flush (0 gap) | 0 | Image should equal the outer: 24 now, 16 after #1 | `:66` `rounded-lg` 16px | Mismatch today (24 vs 16 flush against it). Fixed by #1. |

Correct today (checked, do not touch):

| Outer | Gap | Inner | Where |
|---|---|---|---|
| `rounded-md` 12px | `p-1` 4px | `rounded` 8px | `UserActionButton:211,217+`, `ProfileMenuContent:156,245+`, `ActionMediaBox:129,144+`, `RoomMenu:187` / `RoomOption:30`, `MemberActionsMenu:57`, `CreateRoomOrFolderOption:63` |
| `rounded-lg` 16px | `p-2` 8px | `rounded` 8px | `MapSubMenu:54,56`, `ParticipantMenuItem:226,228`, `ProfileMenu:71,96` (action-bar groups) |
| `rounded-2xl` 16px | `p-2` 8px | `rounded` 8px | `MapEditorSideBar:105,107,117,119,138,143` |
| `rounded-lg` 16px | `p-1` 4px | `rounded-md` 12px | `RoomFolder:103 to 105`, `RoomFolder:175 to 177` |
| bubble `rounded-md` 12px | `p-1` 4px | quoted message `rounded` 8px | `Message.svelte:336,378,379` |
| `rounded-lg` 16px segments | n/a | `first-of-type:rounded-s-lg` / `last-of-type:rounded-e-lg` end caps | `ActionBarButton.svelte:121-124` |

## Left alone on purpose

- All `rounded-full` (119): avatars, counters, status dots, toggles, scrollbar thumbs, `TypingDots`, `PictureInPicture` buttons. None converted. `MessageSystem.svelte:14` is listed only as a no-visual-change rename from `rounded-2xl` to `rounded-full`.
- `rounded-none` (13), including `MessageAttachmentOffer:100,107` (flush button halves inside a rounded card).
- Directional radii that shape one corner or one side on purpose: `Message.svelte:340,343` (`rounded-bl-none` / `rounded-br-none` bubble tails), `RoomTimelineLoading.svelte:25,26`, `rounded-t-[inherit]` / `last:rounded-b-[inherit]` in `MessageFile` and `MessageAttachmentOffer` (inherit from the bubble; already follows the outer radius), `MessageActionSheet:74` `rounded-t-xl` bottom sheet, `MessageInputBar:696` `rounded-t-2xl`, `ActionBar.svelte:97` `rounded-b mobile:rounded-t`, `AwayPausedOverlay:63` `rounded-t-lg`, `VisitCard:94` `rounded-b-lg`, `ActionBarButton:121-124` and `ChatMenuItem:74` end caps.
- Thin drag handles and bars (`w-1` / `h-1` with `rounded` or `rounded-sm`): `ChatSidebar:141`, `RoomList:630`, `CoWebsitesContainer:299,300`, `ResizeHandle:71`, `CalendarOverlapGroup:44`, `SoundMeterWidget:32`. At 4px thick the radius already renders as a pill.
- Skeleton blocks (`RoomListSkeleton:15,16`, `CoWebsiteTab:71,92,102`): placeholders, sized to match the thing they stand for.
- Design-system CSS in `node_modules/@workadventure/design-system` (Button, Chip, inputs, card, avatar): it is the source of the tokens. Any change there belongs to a design-system step, not this checklist.
- Spacing cases where the concentric rule does not bind (gap >= radius): `Calendar*` and `TodoList` `rounded-lg` cards with `p-3`, `PollCard` `p-4`, onboarding after #4.
- `Chat/Components/Avatar.svelte:38,39` (28px `rounded-md`, 40px `rounded-sm`): the file comment documents this as a deliberate size rule for avatars.
- `Components/ActionBar/AvailabilityStatus/Modals/ConfirmationModal.svelte:25,32`: commented-out markup.

Out of scope for a Tailwind-class pass, listed so they are not forgotten: hard-coded `border-radius` in CSS, not tokens. `style/style.css` (15px at 160,188,238,256,268,300,402,442,561; 10px at 165,512,870,874; 6px at 714; 20px at 794; 28px at 805; `1em` at 594), `style/chat.css` (10px, 8px, 0.5rem, 0.25rem, 3px, 0.15rem), `Components/Video/DesktopCapturerSourcePicker.svelte` (8px, 6px), `Components/PopUp/Recording/RecordingCompletedToast.svelte` (12px, 8px, 6px) and `RecordingStartedToast.svelte:60` (12px), `Components/FollowMenu/FollowButton.svelte:28` (48px), `Components/MapEditor/PropertyEditor/CloseButton.svelte:22` (8px), `style/input.css:65` (svelte-select, 8px `!important`, while its Tailwind overrides `InputTags:118` / `MemberAutocomplete:65` force 12px, so the select and its dropdown can differ). Recommend a follow-up pass that maps these to `var(--radius*)`.

## Verification state

Nothing was edited, so no checks were run. Before applying any group, view the changed screens (ChatActionMenu, Menu, an onboarding step, one modal) at the real sizes, since radius changes are only judged visually. Rendered radii were derived from `theme.css` and Tailwind's default theme, not measured.

## Landed (session 2)

Already in the working tree from session 1 (verified with `git diff`, not redone): #1 (all seven modals), #2, #3, #4 (all seven onboarding shells), #6, #7, #8. Paths relative to `play/src/front/`.

| file:line | Before | After | Finding |
|---|---|---|---|
| `Components/Menu/Menu.svelte:148` | `rounded-lg ... @md/main-layout:rounded-xl` | `rounded-lg` (md override dropped) | #5 |
| `Components/Menu/Menu.svelte:211` | `rounded-xl` | `rounded-lg` | #5 |
| `Chat/Components/RoomFolder.svelte:142,192` | `rounded-lg` | `rounded` | #9 |
| `Chat/Components/Room/RoomSidePanel.svelte:84,111` | `rounded-lg` | `rounded` | #9 |
| `Components/Exploration/Explorer.svelte:404,493` | `rounded-lg` | `rounded` | #9 |
| `Chat/Components/Room/CreateRoomOrFolderOption.svelte:62` | `rounded-lg` | `rounded` | #9 |
| `Chat/Components/ChatImagePreviewModal.svelte:81` | `rounded-lg` | `rounded` | #9 |
| `Chat/Components/Room/MessageActionSheet.svelte:82` | `rounded-lg` | `rounded` | #9 |
| `Chat/Components/ChatActionMenu.svelte:60,69` | `rounded-2xl` | `rounded` | #9 |
| `Chat/Components/Room/EmojiButton.svelte:59` | `rounded-md` | `rounded` | #10 |
| `Chat/Components/Room/MessageOptions.svelte:127,143,155` | `rounded-md` | `rounded` | #10 |
| `Chat/Components/UserList/User.svelte:164` (finding said 163) | `rounded-md` | `rounded` | #10 |
| `Chat/Components/UserList/UserActionButton.svelte:198` | `rounded-md` | `rounded` | #10 |
| `Components/Exploration/Explorer.svelte:445,455,536,546` | `rounded-md` | `rounded` | #10 |
| `Components/Onboarding/Steps/WelcomeStep.svelte:45,52`, `LockBubbleStep:37`, `PictureInPictureStep:37`, `ScreenSharingStep:37`, `MovementStep:194`, `CommunicationStep:42`, `CompleteStep:41` | `rounded-lg` | `rounded` | #11 |
| `Chat/Components/requireConnection.svelte:33` | `rounded-lg` | `rounded` | #11 |
| `Components/Video/AwayPausedOverlay.svelte:40` | `rounded-md` | `rounded` | #11 |
| `Components/Video/PictureInPicture/DesktopMiniWindow.svelte:166` (`textButton`) | `rounded-md` | `rounded` | #11 |
| `Components/Login/LoginScene.svelte:131` | `rounded` | `rounded-md` | #12 |
| `Components/Menu/SettingsSubMenu.svelte:688` | `rounded` | `rounded-md` | #12 |
| `Chat/Components/Room/MessageInputBar.svelte:994` (composer) | `rounded-lg` | `rounded-md` | #12 |
| `Chat/Components/Room/ProximityRoomSidePanelQuestions.svelte:88` | `rounded-lg` | `rounded-md` | #12 |
| `Chat/Components/Room/QuestionCard.svelte:42,50` | `rounded-md` | `rounded-sm` | #13 |
| `Chat/Components/Room/RoomMenu/RoomOption.svelte:46` | `rounded-md` | `rounded-sm` | #13 |
| `Chat/Components/RoomList.svelte:660-662` (prettier wrapped the line) | `rounded` | `rounded-sm` | #13 |
| `Chat/Components/Room/MessageInputBar.svelte:654,661` | `rounded-[10px]` | `rounded` | #14 |
| `Chat/Components/Room/MessageInputBar.svelte:666` | `rounded-[6px]` | `rounded-sm` | #14 |
| `Components/ProximityNotification/ProximityNotification.svelte:54` | `rounded-[10px]` | `rounded` (now same as the non-mention branch) | #14 |
| `Components/Video/ScreenAnnotationToolbar.svelte:87` | `rounded-[6px]` | `rounded-sm` | #14 |
| `Components/Video/PictureInPicture/DesktopMeetingBar.svelte:270` | `rounded-[6px]` | `rounded-sm` | #14 |
| `Components/ActionBar/MediaSettingsList/SelectionCheckOverlay.svelte:6` | `rounded-[6px]` | `rounded-sm` | #14 |
| `Components/Exploration/MapList.svelte:177` | `rounded-[8px]` | `rounded` | #14 |
| `Components/ActionBar/MediaSettingsList/BackgroundPresetButton.svelte:21` | `rounded-sm` | `rounded` | #15 |
| `Chat/Components/Room/PollCard.svelte:141`, `QuestionCard.svelte:36` | `rounded-2xl` | `rounded-lg` | queued (2xl to lg) |
| `Components/Menu/ShortcutSubMenu.svelte:257,263` | `rounded-2xl` | `rounded-lg` | queued |
| `Components/UI/DuplicateUserConnectedModal.svelte:28` | `rounded-2xl` | `rounded-lg` | queued |
| `Components/PwaInstall/PwaInstallScreen.svelte:81` | `rounded-2xl` | `rounded-lg` | queued |
| `Chat/Components/Room/MessageInputBar.svelte:696` | `rounded-t-2xl` | `rounded-t-lg` | queued |
| `Components/MapEditor/MapEditorSideBar.svelte:105,117,138` | `rounded-2xl` | `rounded-lg` | queued |
| `Components/MapEditor/EntityEditor/EntityItem/EntityItem.svelte:18,19` | `rounded-2xl` | `rounded-lg` | queued |
| `Chat/Components/Room/MessageSystem.svelte:14` | `rounded-2xl` | `rounded-full` | queued |
| `Components/PopUp/LockableAreaPicker.svelte:65,85` | `rounded` | `rounded-sm` | queued (picker rows, 12 - 8 = 4) |
| `Components/PopUp/RaiseHandSpacePicker.svelte:41` | `rounded` | `rounded-sm` | queued |
| `Components/PopUp/Recording/RecordingSpacePicker.svelte:48` | `rounded` | `rounded-sm` | queued |
| `Chat/Components/Room/MentionSuggestions.svelte:159` | `rounded-xl` | `rounded-lg` | queued |

Checks: `prettier --check` on all touched files passes (RoomList.svelte fixed with `--write`, one line wrapped). svelte-check and visual review left to the orchestrator.

## Skipped

- #1, #2, #3, #4, #6, #7, #8: already landed in session 1; current code matches the proposal.

## Parked

- #10 `Chat/Components/Room/MessageInputBar.svelte:1007,1018,1031,1040` (composer toolbar buttons, 44px `h-11`, and the send button): the finding itself flags 12px as fine on 44px buttons, and after #12 the composer input is `rounded-md` too, so these buttons now match the input they sit beside. Decide visually.
- Queued `Components/Tooltip/HelpTooltip.svelte:42` (`rounded-lg` to `rounded`): this tooltip has `p-1.5` (6px) and holds `rounded-md` (12px) media at `:55,60`. Moving the shell to 8px would make the inner radius larger than the outer; it needs the media moved to `rounded-sm` as well, which is a larger decision than the queued note covers.
- `Chat/Components/Room/MessageInputBar.svelte:623` `rounded-2xl` (attachment option tile) and `Components/MapEditor/EntityEditor/EntityEditorPicker.svelte:316` `rounded-2xl`: not in the findings list; same 2xl-to-lg rename would apply.
