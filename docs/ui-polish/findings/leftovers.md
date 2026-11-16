# Leftovers from the visual pass

Paths are under `play/src/front/` unless stated. Sources: `step-7-alignment.md` (Parked 2, 5, 7, 12), `step-3-radius.md` (Parked #10 toolbar, HelpTooltip, `MessageInputBar:623`, `EntityEditorPicker:316`), `step-6-type-hierarchy.md` (Parked 9 and the `CalendarNextMeeting` countdown).

## Sprint 4: leftovers

### Landed

| Item | File:line | Before | After |
|---|---|---|---|
| Alignment 2 | `Chat/Components/Room/Room.svelte:158-171` | bell, `RoomMenu` and `UnreadCount` were loose row children, so the timestamp ended at a different x per row | wrapped in `<span class="flex shrink-0 items-center justify-end gap-2 min-w-[4.75rem]">` (bell 12 + menu 28 + badge 20 + two 8px gaps = 76px). The timestamp now ends on one edge for muted, unread (1 digit) and plain rows. `ChatMenu`'s menu is `absolute` and positions against the row (`relative`), which the unpositioned wrapper does not change |
| Alignment 5 | `Components/Calendar/CalendarEventRow.svelte:24` | `grid-cols-[3rem_minmax(0,1fr)_auto] gap-2.5` | `grid-cols-[5.5rem_1rem_minmax(0,1fr)_minmax(2rem,auto)] gap-2` (same time column as the overlap list) |
| Alignment 5 | `Components/Calendar/CalendarEventRow.svelte:35-40` | long icon inside the title line, shown only for long events, pushing that title 22px right | its own 1rem grid cell in every row; the icon renders in it only for long events, the title and the duration line start on one edge |
| Alignment 5 | `Components/Calendar/CalendarOverlapGroup.svelte:58-67` | `grid-cols-[5.5rem_minmax(0,1fr)_auto]`, color dot inside the title span | same 4 columns as the event row; dot centered in the 1rem cell. Title edge is 1 + 10 + 88 + 8 + 16 + 8 = 131px in both row types |
| Alignment 12 | same two grids, last column | `auto` | `minmax(2rem,auto)`: rows without a join link reserve the icon button's 32px (`btn-sm btn-square`, `p-2` + 16px icon), so their title column matches icon rows |
| Type 9 | `Components/Calendar/CalendarEventRow.svelte:32` | start time `text-sm font-bold` (14/700) | `text-base font-bold` (16/700). Unblocked by the 5.5rem column, which fits `10:30 AM` at 16/700 |
| Type, countdown | `Components/Calendar/CalendarNextMeeting.svelte:28-36` | one string `Next meeting · in 5 min` (or `In progress`), all `text-sm text-contrast-200` like the time range below | caption stays 14/400 contrast-200; the countdown is a `font-bold text-white` span; `In progress` is `font-bold text-danger-600`, as in `CalendarEventRow`. Same keys, same wording |
| Alignment 7 | `Components/Menu/SettingsSubMenu.svelte:332, 404` | `flex w-full mb-6 mt-2 ps-6 justify-center` | `flex w-full mb-6 mt-2 justify-center`. The labels are `absolute` buttons inside `flex justify-center` `li`s, so their static position is centered on the icon; `ps-6` compensated nothing and only moved the block 12px off the axis the `:634` slider uses |
| Radius, `MessageInputBar:623` | `Chat/Components/Room/MessageInputBar.svelte:622` (`applicationButtonClass`) | `rounded-2xl` | `rounded-lg` (same 16px, on-token name) |
| Radius, `EntityEditorPicker:316` | `Components/MapEditor/EntityEditor/EntityEditorPicker.svelte:316` | `rounded-2xl` | `rounded-lg` (same 16px) |
| Dead code | `Components/FollowMenu/FollowButton.svelte` | component with no importer (`rg FollowButton` over `play`, `tests`, `libs`: only the file itself) | deleted, with the now empty `FollowMenu/` directory |
| Dead code | `style/cowebsite/_short-screens.css:7-80` | `#cowebsite { ... }` block | removed; `#main-container` rule kept (`App.svelte:304` renders it). No element has `id="cowebsite"` (`rg` over `play/src`, `play/index.html`, `tests`); the co-website container is `#cowebsites-container` |
| Formatting | `style/style.css`, `style/wa-theme/video-ui.css` | not Prettier-formatted | `prettier --write` (whitespace and line breaks only) |

### Decisions

- Room row trailing width: `min-w-[4.75rem]` is arbitrary because no spacing token is 76px. It covers the common cases (no badge, 1-digit badge, bell). Two-digit and `99+` badges still widen the cluster; reserving for them would take 8 to 16px from every name in a narrow sidebar.
- Calendar time column: 5.5rem for both time-first row types, as the alignment finding proposed. The event row gains 40px of time column. In return the 12-hour start time fits at 16/700 and titles line up across both row types.
- Calendar marker slot: a dedicated 1rem grid column, not a `w-4` span inside the title line. A span inside the title line would have left the duration line indented under a blank slot.
- `MessageInputBar` toolbar (radius #10, `:1046, :1057, :1070, :1079`): kept `rounded-md`. Three of the four are 44px (`h-11 w-11`), where 12px is 27% (the same ratio as 8px on the 28px icon buttons), and all four sit beside the composer input, which is `rounded-md` since step 3 #12. Switching only the 34px paperclip would mix 8px and 12px inside one toolbar.
- `HelpTooltip` (radius queued note): kept `rounded-lg`. This tooltip is a media popover (`w-64`, video or GIF, title, shortcuts), not a one-line text tooltip like the five at 8px. Its nesting is already correct: 16 - 6 (`p-1.5`) = 10, media at 12. Moving the shell to 8px would force the media to 4px (`rounded-sm`), and 4px corners on a 256px video read as square.

### Not done

- Calendar in-progress list (`CalendarMeetingsInProgress.svelte`): different layout by intent (no time column), as the alignment finding states. Left alone.
- Join column with mixed variants: WorkAdventure meetings show a labelled `Go there` button, external ones a 32px icon button. Rows that mix the two still differ in width. Fixing that means one variant for every row, which is a product decision.
- `CalendarOverlapGroup.svelte:60` `start–end` at 12-hour locales (`10:30 AM–11:00 AM`, text-xs) is wider than 5.5rem and wraps. Existing behaviour, outside this unit's items. Noted only.
- `Components/images/follow.svg` lost its only importer with `FollowButton`. Not deleted: no item covered it, and asset references can be built at runtime. A follow-up can remove it after a wider search.
- `MessageInputBar.svelte:1055-1076`: the add-application and emoji buttons have no accessible name (`aria-label`). Outside this unit, so not changed here. Reported for the accessibility owner.
- Visual check in a browser and svelte-check: not run, per sprint rules; the orchestrator runs them.
