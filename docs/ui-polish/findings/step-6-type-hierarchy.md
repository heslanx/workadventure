# Step 6, type hierarchy

Read-only audit. No source file was edited.

Scale used (`node_modules/@workadventure/design-system/src/theme.css`): `text-xxs` 11px, `text-xs` 13px, `text-sm` 14px, `text-base` 16px, `text-lg` 18px, `text-xl` 24px, `text-2xl` 28px, `text-3xl` 34px, `text-4xl` 42px. Line heights: xxs 16px, xs 20px, sm 24px, base/lg/xl 28px.

Correction to the scale: `text-xs` is 13px in this theme, not 12px. Every "13px" below is `text-xs`.

Unstyled `h1`..`h6` render from the base layer (Oswald, uppercase): h1 42, h2 34, h3 28, h4 24, h5/h6 18. Unstyled text inherits 16px.

`text-md` and `text-l` are not in the scale. They emit no CSS, so the element falls back to inherited 16px (or the h3 28px base).

## Surfaces audited

| Surface | Main value | Title | Support | Do the three levels separate? |
|---|---|---|---|---|
| Proximity notification toast (`ProximityNotification.svelte`) | message 18/400 | sender or mention 16/700 | room chip 13/400 | no, support is larger than title |
| Chat room panel home cards (`RoomSidePanelHome.svelte`) | count or status 13/400 | label 14/600 | hint 13/400 | no, value smaller than label, value and hint flat |
| Proximity room panel home cards (`ProximityRoomSidePanelHome.svelte`) | count 13/400 | label 14/600 | none | no, value smaller than label |
| Shortcuts settings (`ShortcutSubMenu.svelte`) | key combo 14/700 | page title 18/600, group title 16/700 | hint 13/400 | partly, page title and group title are 2px apart |
| Poll card results (`PollCard.svelte`) | `votes (pct%)` 13/400 | answer label 13/400 (600 if winning) | participants 13/400 | no, value equals label |
| Poll item in side panel (`RoomSidePanelPollItem.svelte`) | `votes (pct%)` 13/400 | answer label 13/400 | participants 13/400 | no, value equals label |
| Matrix chat settings rows (`ChatSettings.svelte`) | id or homeserver 13/400 | label 13/400 | copy action 13/400 | no, all 13/400 |
| PiP soon-meeting strip (`DesktopMiniWindow.svelte`) | detail 11/400 | title 13/700 | none | weak, value smaller than title |
| Calendar event row (`CalendarEventRow.svelte`) | start time 14/700 | title 16/400 | duration 13/400 | partly, value smaller than title |
| Calendar next meeting (`CalendarNextMeeting.svelte`) | countdown 14/400 | title 24 Oswald | time range 14/400 | partly, countdown equals detail line |
| Calendar reminder card (`CalendarReminders.svelte`) | when 14/700 | title 18/700 | place 14/400 | yes |
| Calendar meetings in progress | time range 14/400 | title 18 Oswald | caption 14/400 | yes |
| Calendar day header (`Calendar.svelte`) | count 14/400 | day 18/500 | date 14/400 | yes |
| Chat room header (`RoomTimeline.svelte`, `ConversationSubtitle.svelte`) | none | name 14/700 | subtitle 13/400 | yes |
| Chat room list row (`Room.svelte`, `LastMessagePreview.svelte`) | none | name 14/700 | preview 14/400, time 13/400 | yes, by weight and color only |
| Participant rows (`RoomSidePanelParticipantRow.svelte`, `User.svelte`) | none | name 14/600 or 14/700 | status 13/300-400 | yes |
| Onboarding steps (`Onboarding/Steps/*.svelte`) | none | 24/700 (28 or 34 on welcome and complete) | body 14 or 16, hint 13 | yes |
| Recordings list row (`RecordingsListModal.svelte`) | none | date 15/600 | expiry 13/400 | yes |
| Notification toasts (`WebsocketReconnectingToast.svelte`) | none | 14/600 | 13/400 | yes |
| Woka menu (`WokaMenu.svelte`) | none | name 28 Oswald | status 16/700 | yes |
| Moderation options (`ModerationModal.svelte`) | none | label 16/600 | hint 13/400 | yes |
| Settings sections (`SettingsSubMenu.svelte`) | none | section bar 18/700 | explanation 14 italic | yes |
| Object details (`ObjectDetails.svelte`) | none | 42 (entity) or 34/700 (area) | description 16 | yes, but the two branches disagree |

## Findings

Ranked by how much the failure hurts comprehension. 9 findings.

| # | `file:line` | Level | Current classes (px) | Proposed classes (px) | Why it is flat or inverted | Confidence |
|---|---|---|---|---|---|---|
| 1 | `play/src/front/Components/ProximityNotification/ProximityNotification.svelte:108` | support (the message body) | `font-['Roboto_Condensed'] font-normal text-lg leading-[24px] ...` (18/400) | change `text-lg` to `text-base`, keep the rest (16/400) | The title at `:86` and `:97` is `font-bold text-base` (16/700). The support text is 2px larger than the title, so the eye lands on the message body and the sender line reads as the caption. Title and message become the same size, separated by weight 700 vs 400, which is the pattern the other toasts use. | high |
| 2 | `play/src/front/Chat/Components/Room/RoomSidePanelHome.svelte:215`, `:233-239`, `:253-259`, `:274` | main value | `text-xs text-white/55` (13/400), spinner wrapper `flex min-h-4 items-center text-xs` | `text-lg font-bold` on `:215`; `text-base font-bold` on `:233` and `:253` (the poll value is a string such as `3 · 1 open`); colors unchanged (18/700 and 16/700) | The label at `:214`, `:232`, `:252`, `:272` is `text-sm font-semibold` (14/600). The count is smaller and lighter than the word that names it, so a card reads "Participants" first and the number last. The hint at `:241` and `:261` is `text-xs` too (13/400), so value and hint are identical in size and weight and differ only by 10% opacity. Line height grows from 20px to 28px for `text-lg`, so check the `min-h-4` rows keep the spinner centered. | high |
| 3 | `play/src/front/Chat/Components/Room/ProximityRoomSidePanelHome.svelte:118`, `:129-134`, `:152` | main value | `mt-1 text-xs text-white/55` (13/400) | `text-lg font-bold` on `:118`; `text-base font-bold` on `:129` and `:152`; colors unchanged | Same card pattern as finding 2. Label `:117`, `:128`, `:151` is 14/600; value is 13/400, so the value is smaller than its label. Fix both files together so the two panels stay identical. | high |
| 4 | `play/src/front/Chat/Components/Room/PollCard.svelte:224-229` (also `:216`) | main value | `<div class="text-xs text-white/70">` parent, value `<span class="shrink-0">` (13/400) | value `<span class="shrink-0 text-sm font-semibold">` (14/600); at `:216` add `text-sm font-semibold` to `shrink-0 text-white/60` | The answer label at `:226` is 13/400 (600 only when it wins), and the number is also 13/400. The result `3 (50%)` carries the meaning of the poll and has no more weight than the answer text or the 13px participants line at `:151`. | medium |
| 5 | `play/src/front/Chat/Components/Room/RoomSidePanelPollItem.svelte:201-204` | main value | parent `text-xs text-white/70`, value `<span class="shrink-0">` (13/400) | value `<span class="shrink-0 text-sm font-semibold">` (14/600) | Same as finding 4. The compact poll item shows the top three answers; value and label are both 13/400. | medium |
| 6 | `play/src/front/Chat/Components/ChatSettings.svelte:230-238` | main value | label `text-xs text-white/60` (13/400), action `text-xs text-light-blue`, value `w-full break-all text-xs text-white/90` (13/400) | value `text-sm` (14/400), rest unchanged | Label, action, and value are all 13/400. Only color separates the user id or homeserver (the thing the user wants to read and copy) from its caption. `break-all` plus 14px can add a wrapped line for long ids, so check the width at the sidebar minimum. | medium |
| 7 | `play/src/front/Components/Menu/ShortcutSubMenu.svelte:200` and `:264` | title | page title `h2 ... text-lg font-semibold` (18/600), group title `h3 ... text-base font-bold` (16/700) | page title `text-xl font-semibold` (24/600), group title unchanged | Both are uppercase Oswald headings 2px apart, and the group title is bolder than the page title. The page title does not read as one level above the group titles. The same 18/600 `h2` is used at `HelpSubMenu.svelte:20`; apply the same change there if the two menus should match. | medium |
| 8 | `play/src/front/Components/Video/PictureInPicture/DesktopMiniWindow.svelte:429-430` | title and main value | title `truncate font-bold` (13/700, inherited from `text-xs` at `:217`), detail `text-xxs text-success` or `text-warning` (11/400) | title `truncate text-sm font-bold` (14/700), detail `text-xs` (13/400), colors unchanged | The detail line is the live or "starts in" status, the thing the strip exists to show, and it is the smallest text in the window. It is 2px below the title and carries no weight. This also matches `viewHead` at `:206`, which already uses `text-sm font-bold` for titles in the same window. | low |
| 9 | `play/src/front/Components/Calendar/CalendarEventRow.svelte:33` and `:41` | main value and title | time `text-sm font-bold` (14/700), end time `text-xs` (13), title `<span class="truncate">` with no size (16/400) | start time `text-base font-bold` (16/700); title unchanged | The start time is the column the eye scans for in an agenda, but it is 2px smaller than the title. Does not invert the three levels, it just lets the title outrank the time. The column is `3rem` wide; `HH:MM` at 16/700 in Roboto Condensed should fit, confirm at 12-hour locales (`10:30 AM`). | low |

An additional low-confidence candidate is held back: `CalendarNextMeeting.svelte:28` (countdown `Next meeting · in 5 min`) and `:43` (time range) are both `text-sm text-contrast-200` (14/400). Making the countdown stand out needs a wrapper `<span>`, which changes the DOM. Not proposed here.

## Left alone on purpose

- Chat room list rows (`Room.svelte:86`, `LastMessagePreview.svelte:17`): name 14/700 and preview 14/400 share a size, but weight and a 60% white color separate them. Not flat by the rule.
- Section eyebrows at 11-13px uppercase (`SectionTitle.svelte:13`, `MediaSettingsListHeader.svelte:18`, `RoomSidePanelSettings.svelte:287` and similar, `ChatSettings.svelte:130`): smaller than the rows below them on purpose. They are labels, not titles.
- Calendar reminder card, meetings in progress, day header, onboarding steps, participant rows, recordings row, toast pairs, Woka menu, moderation options: title, value and support already differ by 2px or more or by weight. No change.
- `text-md` (`ChatHeader.svelte:118`, `Room.svelte:95`, `ProximityRoomRow.svelte:52`, `RoomInvitation.svelte:62`, `User.svelte:87`, `RoomSuggested.svelte:61`, `RoomFolder.svelte:258`, `EmojiSubMenu.svelte:275`, `:298`) and `text-l` (`Explorer.svelte:260`, `TrashEditor.svelte:5`): classes not in the scale, no CSS emitted. Outcome today is 16px (and 28px for the `Explorer.svelte` h3, matching the other map editor panel titles), so nothing breaks. A dead class is a cleanup task, not a hierarchy fix, and defining them would change sizes. Parked for the step that owns design token cleanup.
- `text-[0.9375rem]` (`RecordingsListModal.svelte:373`, `:319`, `:333`): 15px is not in the scale. The title still separates from the 13px support. Fixing it is a token cleanup, not this step.
- `ObjectDetails.svelte:201` (h1, 42px) vs `:230` (h1 `text-3xl font-bold`, 34/700): the two branches disagree on the title size, but each still separates from the 16px description. Needs a product decision on which one wins.
- Fonts, DOM order, colors, alignment, and wording: untouched in every proposal above.

## Landed (session 2)

Findings 1-3 were already present in the code when this session started (applied earlier); verified, not re-edited.

| # | `file:line` | Before | After |
|---|---|---|---|
| 1 | `play/src/front/Components/ProximityNotification/ProximityNotification.svelte:108` | `text-lg` (18/400) | `text-base` (16/400), already in place |
| 2 | `play/src/front/Chat/Components/Room/RoomSidePanelHome.svelte:215`, `:233`, `:253` | `text-xs` (13/400) | `text-lg font-bold` / `text-base font-bold`, already in place |
| 3 | `play/src/front/Chat/Components/Room/ProximityRoomSidePanelHome.svelte:118`, `:129`, `:152` | `text-xs` (13/400) | `text-lg font-bold` / `text-base font-bold`, already in place |
| 4 | `play/src/front/Chat/Components/Room/PollCard.svelte:216` | `shrink-0 text-white/60` | `shrink-0 text-sm font-semibold text-white/60` |
| 4 | `play/src/front/Chat/Components/Room/PollCard.svelte:229` | `shrink-0` | `shrink-0 text-sm font-semibold` |
| 5 | `play/src/front/Chat/Components/Room/RoomSidePanelPollItem.svelte:204` | `shrink-0` | `shrink-0 text-sm font-semibold` |
| 5 | `play/src/front/Chat/Components/Room/RoomSidePanelPollItem.svelte:193` | `shrink-0 text-white/60` | `shrink-0 text-sm font-semibold text-white/60` (voting-state sibling, mirrors PollCard `:216`) |
| 6 | `play/src/front/Chat/Components/ChatSettings.svelte:238` | `w-full break-all text-xs text-white/90` | `w-full break-all text-sm text-white/90` |
| 7 | `play/src/front/Components/Menu/ShortcutSubMenu.svelte:200` | `text-white text-lg font-semibold m-0` | `text-white text-xl font-semibold m-0` |
| 7 | `play/src/front/Components/Menu/HelpSubMenu.svelte:20` | `text-white text-lg font-semibold mb-4` | `text-white text-xl font-semibold mb-4` (keeps the two menus matched) |
| 8 | `play/src/front/Components/Video/PictureInPicture/DesktopMiniWindow.svelte:429` | `truncate font-bold` | `truncate text-sm font-bold` |
| 8 | `play/src/front/Components/Video/PictureInPicture/DesktopMiniWindow.svelte:430` | `text-xxs {live color}` | `text-xs {live color}` |

Prettier `--check` clean on every touched file.

## Skipped

- None.

## Parked

- 9 `CalendarEventRow.svelte:33` start time `text-sm` -> `text-base`: `formatTime` uses `toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })`, so 12-hour locales render `10:30 AM`; at 16/700 that is wider than the fixed `3rem` grid column (`grid-cols-[3rem_minmax(0,1fr)_auto]`) and would overflow into the title. Needs a column-width change (layout) or a visual check first. Edit applied then reverted.
- `CalendarNextMeeting.svelte:28` countdown: needs a wrapper span (DOM change), as noted in the audit.

## Review round (session 2)

Cross-vendor review of the type step. 2 findings applied, 2 rejected.

### Applied

| Review finding | `file:line` | Before | After |
|---|---|---|---|
| R3 grid value sizes differ | `play/src/front/Chat/Components/Room/RoomSidePanelHome.svelte:215` | `mt-1 text-lg font-bold text-white/55` | `mt-1 text-base font-bold text-white/55` |
| R4 grid value sizes differ | `play/src/front/Chat/Components/Room/ProximityRoomSidePanelHome.svelte:118` | `mt-1 text-lg font-bold text-white/55` | `mt-1 text-base font-bold text-white/55` |

Every main value in both grids is now 16/700. I chose `text-base` over `text-lg` because the poll value is a string (`3 · 1 open`) that would crowd the tile at 18px, and because 16px keeps the `min-h-4` spinner rows unchanged. The value still outranks its 14/600 label. The settings tile at `RoomSidePanelHome.svelte:274` has no value, only a `text-xs` "read-only" hint, which is support text. Its size is correct as is. Prettier `--check` is clean on both files.

### Rejected

- R1 `DesktopMiniWindow.svelte:166`, `:186`, `:373` and the `stroke-width` lines: these changes are not from the type step. Each one is a landed finding of another step: `rounded-md` -> `rounded` is step-3-radius #11, `shadow-xl` -> `shadow-lg` is step-4-shadows #8, and `stroke-width` 1.8 -> 2 is step-1-icons #2. Reverting them would undo another step's approved work and break the rule against reverting lines this step did not change.
- R2 `DesktopMiniWindow.svelte` `text-white/40` -> `text-white/60` (11 lines): this is step-2-contrast #5 (3.76 -> 6.86 contrast), documented there. It is not part of the type pass, so it stays as is.

### Review round 2 (session 2)

Second cross-vendor review of the type step. 0 findings applied, 3 rejected. No code was changed.

#### Rejected

- `play/src/front/Chat/Components/Room/RoomSidePanelHome.svelte:156` header `px-4` -> `px-3`: this change is not from the type step. It is step-7-alignment finding #4, landed and listed in `step-7-alignment.md` ("header `px-4` -> header `px-3`", title on the card edge). Reverting it would undo another step's approved work and break the rule against reverting lines this step did not change.
- `play/src/front/Chat/Components/Room/ProximityRoomSidePanelHome.svelte:86` header `px-4` -> `px-3`: same as above. This is step-7-alignment finding #4, which covers the same five panel headers.
- `play/src/front/Components/ProximityNotification/ProximityNotification.svelte:90-92` room pill `min-w-0 max-w-[45%] truncate` + `title={$roomName}`: this change is not from the type step. It is step-8-long-text finding #3 (a long room name squeezed the mention title out, marked BREAKS), recorded in `step-8-long-text.md`, which also explains why `max-w-[45%]` stays: no token exists for a percentage max-width. The type step only touched `:108` (`text-lg` -> `text-base`), and that line is still correct.
