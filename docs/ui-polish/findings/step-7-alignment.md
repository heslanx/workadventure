# Step 7, alignment

Audit only; no source edited. Paths are under `play/src/front/`. Line numbers are as of branch `chore/orca-docker-ssh-env` at f63be787b.

## Row and list surfaces audited

| Surface | File | Leading edge | Trailing column | Aligned today? |
|---|---|---|---|---|
| Chat room list (people, rooms, folders) | `Chat/Components/RoomList.svelte`, `RoomFolder.svelte`, `Room/Room.svelte` | Section headers `px-3`; rows start at `px-2` body + `ps-2` button | Timestamp (`ms-auto`) then optional bell/menu/unread badge | partly |
| Chat invitations list | `RoomList.svelte:455`, `Room/RoomInvitation.svelte` | `ps-3 pr-4` body, `px-2` row | Accept/decline buttons | no |
| Chat user list (grouped by room) | `Chat/Components/UserList/RoomUserList.svelte`, `User.svelte` | Count badge, then title (badge only on some groups) | Chevron | no |
| Side panels: participants, polls, home, questions | `Chat/Components/Room/*SidePanel*.svelte` | Header `px-4`, body/cards `px-3` | Count pill (`justify-between`) | no |
| Participant rows | `Room/RoomSidePanelParticipantRow.svelte`, `ProximityRoomSidePanelParticipants.svelte:56` | `px-3` card, avatar, `flex-1` name | Fixed action buttons | yes |
| Calendar rows | `Components/Calendar/CalendarEventRow.svelte`, `CalendarOverlapGroup.svelte`, `CalendarMeetingsInProgress.svelte` | Time column 3rem / 5.5rem / none | `auto` Join button | partly |
| Settings sections | `Components/Menu/SettingsSubMenu.svelte` | Header `p-4`, switches `m-4`, radio titles centered | n/a | partly |
| Shortcut rows | `Components/Menu/ShortcutSubMenu.svelte:269` | `min-w-0` label column | `shrink-0` key chips, right edge shared | yes |
| Raised hands panel | `Components/Video/RaisedHandsPanel.svelte` | `px-1` titles, `p-1` rows | `min-w-20` buttons | yes |
| Action bar | `Components/ActionBar/ActionBar.svelte` | Centered cluster by design | `justify-end` wrapper | yes |
| Map editor property panels | `Components/MapEditor/PropertyEditor/PropertyEditorBase.svelte` | `ps-3` header | Close button | yes |
| Map list (explorer) | `Components/Exploration/MapList.svelte` | `px-6` container, label `pl-2` | Search icon | partly |
| Toasts | `Components/Toasts/ToastContainer.svelte` | Centered by design | Buttons centered | yes |

## Findings

Ranked by how visible the raggedness is.

1. `Chat/Components/UserList/RoomUserList.svelte:122-136` | current: the member-count badge (`min-w-[20px]`) is rendered before the title, and is skipped for the "disconnected" group (`:127`), so that group's title starts about 28px further left than the others | proposed: always keep the badge on the leading side with a fixed `w-5` slot, or move it to the trailing side next to the chevron (`ms-auto` group), so every group title shares one start edge | edge: group-title leading edge | confidence: high
2. `Chat/Components/Room/Room.svelte:128, 154-168` | current: the timestamp trails the name with `ms-auto`, but the bell-off icon, `RoomMenu` and `UnreadCount` render after the button only when present, so each row's timestamp ends at a different x | proposed: wrap the trailing items (`:154-168`) in one `flex shrink-0 items-center gap-2 min-w-[Npx]` container with a reserved width, or put the unread badge inside the timestamp line, so the timestamp's right edge is the same in every row | edge: trailing value column (timestamp) | confidence: medium (depends on whether `RoomMenu` reserves width on hover; check in browser)
3. `Chat/Components/RoomList.svelte:455` | current: the invitations body is `ps-3 pr-4 pb-3`, while the people list (`:515`) and rooms list (`:561`) bodies are `px-2 pb-2`; `RoomInvitation` rows add `px-2` (`:62`) on top, so invitation avatars start 4px right of room avatars and end 8px further in | proposed: `px-2 pb-2` to match the sibling lists (also removes the physical `pr-4`); keep the row's own `px-2` | edge: avatar/title leading edge and trailing action edge | confidence: high
4. `Chat/Components/Room/ProximityRoomSidePanelParticipants.svelte:32`, `ProximityRoomSidePanelHome.svelte:86`, `RoomSidePanelHome.svelte:156`, `RoomSidePanelPolls.svelte:91`, `ProximityRoomSidePanelQuestions.svelte:75` | current: panel header is `px-4`, body and cards below are `px-3` (`:43`, `:108`, `:205`, `:97`, `:109/:128`), so the title sits 4px right of the card edge | proposed: header `px-3` in all five (one shared panel-header wrapper if one exists), so the title aligns with the card border edge | edge: title leading edge vs card edge | confidence: medium (4px; confirm the Questions header at `py-4` vs `py-5` was not chosen for height only)
5. `Components/Calendar/CalendarEventRow.svelte:25,38`, `CalendarOverlapGroup.svelte:58`, `CalendarMeetingsInProgress.svelte:25` | current: titles start after a `3rem` time column in event rows, after `5.5rem` in the overlap group, and at the card edge in the in-progress list; in event rows the `long` icon (`:38-40`) pushes the title right only for long events | proposed: one shared time-column width (use the 5.5rem the overlap list needs, `tabular-nums`) for the two time-first rows; render the long icon in the time column or reserve its slot (`w-4`) for all rows | edge: title leading edge across calendar row types | confidence: medium (the in-progress list is a different layout by intent)
6. `Components/Menu/SettingsSubMenu.svelte:470, 524` | current: the radio-group titles ("bandwidth preference", "noise suppression mode") are `text-center`, while section headers (`:328` etc.) and switch rows (`m-4`) are start-aligned | proposed: `text-start px-4` (drop `text-center`, keep the `input-label` style) so they share the 16px edge of the headers and switches | edge: label leading edge in the settings pane | confidence: high
7. `Components/Menu/SettingsSubMenu.svelte:332, 404` | current: the slider blocks use `ps-6 justify-center` with `w-10/12`, so the block sits 12px right of true center, while the third slider (`:634`) has no `ps-6` | proposed: remove `ps-6` at `:332` and `:404` so all three slider blocks share one center axis | edge: slider block start/end | confidence: medium (`ps-6` may compensate for the labels' absolute offset; compare against `:634` in browser)
8. `Chat/Components/RoomFolder.svelte:103, 105, 177` | current: a sub-folder is `mx-2 p-1` card with `px-3` header, so its title starts at 32px inside the Rooms body, while the "Rooms" header title is at 12px and root rows at 16px | proposed: keep the card but use `px-2` on the folder header so the title lands on the rows' 16px edge; or accept as nesting indent | edge: folder title vs row title | confidence: low (nesting indent may be intentional)
9. `Chat/Components/RoomList.svelte:531-561` | current: the Rooms header uses nested `space-x-2` wrappers (`:531`, `:540`) while the People header uses `gap-1` (`:466`), so trailing icons sit at different gaps from the chevron | proposed: one `gap-1` flex row for both headers, chevron `shrink-0` | edge: trailing icon column in section headers | confidence: medium
10. `Components/Exploration/MapList.svelte:103` | current: the search `label` has `pl-2` while the input below starts at the container's `px-6` edge | proposed: drop `pl-2` so the label starts on the input's left edge | edge: label leading edge | confidence: medium (the 8px may mimic the input's inner padding)
11. `Chat/Components/UserList/User.svelte:103` | current: the name column has `ms-1` on top of `gap-2`, so user names start 4px further from the avatar than room names in `Room.svelte:108` | proposed: remove `ms-1` | edge: name leading edge shared between room and user lists | confidence: low
12. `Components/Calendar/CalendarEventRow.svelte:25,50` | current: the Join button column is `auto`, so each row's button width follows its label/variant (icon-only vs text), making the left edge of the action column ragged | proposed: give the third column a fixed width (`grid-cols-[3rem_minmax(0,1fr)_2.25rem]` or `min-w-` on the button wrapper) when all rows show the same variant | edge: trailing action column | confidence: low

## Left alone on purpose

- Icon boxes with `items-center justify-center` and `aspect-square` chevrons in `RoomList.svelte`, `RoomFolder.svelte`, `RoomUserList.svelte`: centered in their own box.
- `ShortcutSubMenu.svelte:269` rows: the label column is `min-w-0`, the key chips are `shrink-0` on the right; the right edge is shared.
- Action bar (`ActionBar.svelte:63-179`): the centered cluster with `justify-start` and `justify-end` flanks is the layout's design.
- `RaisedHandsPanel.svelte`: titles at `px-1` and rows at `p-1` share an edge; buttons use `min-w-20`.
- `RoomSidePanelParticipantRow.svelte`, `PropertyEditorBase.svelte` (`ps-3` header, close button trailing): aligned.
- `Components/Menu/AboutRoomSubMenu.svelte:67-146`: the whole pane is centered text; the accordion titles are `text-left` with a trailing chevron on purpose.
- `ToastContainer.svelte` and `NoMicrophoneSoundToast.svelte`: centered text and centered buttons by design.
- Avatar placement in `Room.svelte` and `RoomInvitation.svelte` (`shrink-0` icon box): deliberate.

## Landed (session 2)

Paths under `play/src/front/`.

| Finding | File:line | Before | After |
|---|---|---|---|
| 1 | `Chat/Components/UserList/RoomUserList.svelte:134` | no element when the group is "disconnected" | `{:else}<span class="w-5 shrink-0" aria-hidden="true"></span>` reserves the badge slot, so every group title starts on one edge |
| 3 | `Chat/Components/RoomList.svelte:455` | `flex flex-col overflow-auto ps-3 pr-4 pb-3` | `flex flex-col overflow-auto px-2 pb-2` (matches people/rooms bodies) |
| 4 | `Chat/Components/Room/ProximityRoomSidePanelParticipants.svelte:32`, `ProximityRoomSidePanelHome.svelte:86`, `RoomSidePanelHome.svelte:156`, `RoomSidePanelPolls.svelte:91`, `ProximityRoomSidePanelQuestions.svelte:75` | header `px-4` | header `px-3` (title on the card edge; `py-*` untouched) |
| 6 | `Components/Menu/SettingsSubMenu.svelte:469-470` | `input-label` / inner `text-center` | `input-label px-4` / inner `text-start` |
| 6 | `Components/Menu/SettingsSubMenu.svelte:524` | `input-label text-center mt-4` | `input-label text-start px-4 mt-4` |
| 9 | `Chat/Components/RoomList.svelte:536` | Rooms header row `flex space-x-2 items-center` | `flex gap-1 items-center` (same trailing icon gap as People header) |
| 10 | `Components/Exploration/MapList.svelte:103` | `label class="text-white pl-2"` | `label class="text-white"` (design-system `Input` labels sit flush with the field) |
| 11 | `Chat/Components/UserList/User.svelte:103` | `flex-auto min-w-0 ms-1 ...` | `flex-auto min-w-0 ...` (names start where room names do) |

Prettier `--check` clean on all touched files.

## Skipped

- 8 (`RoomFolder.svelte` folder header indent): low confidence; the extra indent reads as nesting, which is intentional hierarchy.

## Parked

- 2 (`Room.svelte` trailing items): needs a reserved width with an arbitrary `min-w-[Npx]` and a browser check of `RoomMenu` hover width.
- 5 (calendar time column): unifying 3rem/5.5rem and reserving the long-icon slot changes the row grid; needs browser review.
- 7 (`SettingsSubMenu` slider `ps-6`): may compensate for the absolute label offsets; needs browser comparison with `:634`.
- 12 (calendar Join column): low confidence, needs an arbitrary grid width and depends on all rows using one variant.
- Out of scope note: the Invitations header (`RoomList.svelte:438`) also uses `space-x-2`; not in the finding, left as is.
