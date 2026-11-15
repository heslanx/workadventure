# Step 8, long text stress test

Method: static audit of `play/src/front` (class-level reading of flex/truncate/wrap setup, no browser run). Confidence says how sure the layout failure is without a rendered check. No source file was edited.

Note: `MAX_USERNAME_LENGTH` (env, `Enum/EnvironmentVariable.ts:24`) caps names typed at login, but names that come from Matrix, SSO, admin API, calendar and map properties are not capped. The corpus below is therefore realistic for every surface except the login field.

## Worst-case corpus used

| Kind | String |
|---|---|
| Participant, pt-BR | `Maria Eduarda Albuquerque de Vasconcelos Nascimento (convidado)` |
| Participant, German | `Datenschutzbeauftragter Hans-Joachim Müller-Lüdenscheidt` |
| Participant, emoji | `🚀🔥 Ana 🎉✨ Lima 🧑‍💻🇧🇷🏳️‍🌈` |
| Participant, no spaces | `maria.eduarda.albuquerque.vasconcelos@empresa-de-consultoria-estrategica.com.br` (also used as email/uuid line) |
| Chat room | `Squad de Suporte ao Cliente Enterprise, turno da noite` |
| Folder/space | `Operações Globais e Atendimento ao Cliente — América Latina` |
| Map / room name | `escritório central, andar 12, sala de reuniões grandes` |
| Meeting subject | `Revisão trimestral de metas de atendimento com a diretoria, parceiros e o time de operações de São Paulo` |
| Status, multi-word | `Em reunião, volto às 15h (não perturbe)` and German `Nicht stören, in einer Besprechung` |
| Country | `República Democrática do Congo` / `Vereinigte Arabische Emirate` |
| Button labels (German) | `Wortbeitrag erteilen`, `Hand senken`, `Teilnahme ablehnen` |

## Surfaces and their current truncation setup

| Surface | File | Setup | Worst-case result |
|---|---|---|---|
| Contacts list row (user) | `Chat/Components/UserList/User.svelte:103-110` | `flex-auto` col, name `text-nowrap`, row `h-4`, no `min-w-0` | Name never shrinks, pushes action buttons off the row (BREAKS) |
| Wokà menu title | `Components/ActionsMenu/WokaMenu.svelte:111-112` | `w-max` h3 in `max-w-lg overflow-hidden`, `text-xl` | One line, clipped by the card, close button overlaps (BREAKS) |
| Proximity notification, room pill | `Components/ProximityNotification/ProximityNotification.svelte:90` | pill `shrink-0` beside `min-w-0 line-clamp-2` title | Pill eats the row, title squeezed to nothing (BREAKS) |
| Chat message banner, room pill | `Chat/Components/Room/ChatMessageBanner.svelte:78` | pill `shrink-0`, sender `truncate` | Same as above (BREAKS) |
| Action bar profile name | `Components/ActionBar/MenuIcons/ProfileMenu.svelte:101` | `whitespace-nowrap`, no max width, no truncate | Action bar grows or overflows (BREAKS) |
| Calendar event titles | `Components/Calendar/CalendarEventRow.svelte:41`, `CalendarOverlapGroup.svelte:65`, `CalendarMeetingsInProgress.svelte:28`, `CalendarReminders.svelte:54`, `Calendar.svelte:125` | `truncate`, no `title` | Subject cut to one line, full text unreachable |
| Chat header room name | `Chat/Components/Room/RoomTimeline.svelte:806` | `min-w-0 truncate`, no `title` | Cut, unreachable |
| Chat list row name | `Chat/Components/Room/Room.svelte:126`, `:123` | `truncate` on preview rows, no `title`; no-preview branch wraps unbounded | Cut, unreachable; unbroken email overflows in no-preview branch |
| Raised hands panel | `Components/Video/RaisedHandsPanel.svelte:80,120` | name `grow truncate` between two `min-w-20` buttons, no `title` | Name left with a few px in German, unreachable |
| Participant list (2nd copy) | `Components/ActionBar/MenuIcons/ParticipantMenuItem.svelte:402,441` | `truncate`, no `title` (first copy at `:312,:352` has `title`) | Inconsistent, name unreachable |
| Video name label | `Components/Video/UserTag.svelte:25` + `style/wa-theme/video-ui.css:97-110` | `break-words`, `max-h-10 overflow-y-auto`, `text-xs` minimal | Long name becomes a tiny scroll box inside the tag |
| Meeting invitation popup | `Components/MeetingInvitation/MeetingInvitationPopup.svelte:60-62` | `min-w-0` col, no break rule, card `overflow-hidden` | Normal names wrap; email-like name clipped |
| Warning toast | `Components/WarningContainer/WarningToast.svelte:8` | `h-6 truncate whitespace-pre-line` | Any sentence over the width is cut, message lost |
| Explorer object/area rows | `Components/Exploration/Explorer.svelte:439,529` | `w-full nowrap ellipsis`, no `title` on object (area row has `title` at wrapper) | Cut, object name unreachable |
| Co-website tab | `Components/EmbedScreens/CoWebsiteTab.svelte:83,97` | `max-w-[150px] nowrap ellipsis`, `title` on first only | Fixed 150px, URL line unreachable |
| Room folder header | `Chat/Components/RoomFolder.svelte:118-119` | `truncate` on inline `<span>` in non-flex `div` | Truncate has no effect, uppercase tracking name wraps or overflows |
| Participants / panel rows | `Chat/Components/Room/RoomSidePanelParticipantRow.svelte:73-75`, `ProximityRoomSidePanelParticipants.svelte:67-72` | `min-w-0 flex-1` + `truncate` | OK layout, no `title` (cosmetic) |
| Room invitation / suggested | `Chat/Components/Room/RoomInvitation.svelte:79-81`, `RoomSuggested.svelte:67-82` | `min-w-0` + `truncate` (`RoomSuggested` has `title`) | OK; invitation lacks `title` |
| Pickers | `PopUp/RaiseHandSpacePicker.svelte:54`, `LockableAreaPicker.svelte:98` | `truncate` with `title` | OK |
| Todo tasks | `Components/TodoList/TodoTask.svelte:27-29` | `min-w-0` + `truncate`, no `title` | Cut, unreachable |

## Findings

Ranked by how badly the layout breaks.

1. `Chat/Components/UserList/User.svelte:103,110` | `Maria Eduarda Albuquerque de Vasconcelos Nascimento (convidado)` | Name column is `flex-auto` with no `min-w-0`, the name div is `text-nowrap`, the wrapper is `h-4`; the nowrap text sets the column min width, so the action buttons are pushed out of the row (or the row scrolls). | Add `min-w-0` to the `flex-auto` column (`:103`) and to the `h-4` row (`:109`); on `:110` replace `text-nowrap` with `min-w-0 truncate` on the name text; keep the `#id` and admin badge `shrink-0`; add `title={username}` on the column. Keep text size. | High
2. `Components/ActionsMenu/WokaMenu.svelte:111-112` | `Datenschutzbeauftragter Hans-Joachim Müller-Lüdenscheidt`, or the corpus participant name | `<div class="w-max mt-[29px]"><h3>` forces one line at `text-xl`; the card is `overflow-hidden` with `max-w-lg` (89% on mobile), so the name is clipped and runs under the absolute close button. | Replace `w-max` with `max-w-full min-w-0 px-10 text-center` and put `break-words [overflow-wrap:anywhere]` on the `h3`. Wrapping keeps the size; the `px-10` keeps clear of the close button. | High
3. `Components/ProximityNotification/ProximityNotification.svelte:90` | room pill `Squad de Suporte ao Cliente Enterprise, turno da noite` | Pill is `ms-auto shrink-0` in a row with `min-w-0 line-clamp-2` title. A 50 char pill is about 320px at `text-xs` and takes the whole row; the mention title collapses. | `max-w-[45%] truncate` on the pill (keep `shrink-0` off or use `min-w-0`), add `title={$roomName}`. | High
4. `Chat/Components/Room/ChatMessageBanner.svelte:78` | same room name pill | Same pill pattern: `shrink-0` with no max width squeezes the `truncate` sender text out. | `min-w-0 max-w-[45%] truncate` on the pill, `title={banner.roomName}`. | High
5. `Components/ActionBar/MenuIcons/ProfileMenu.svelte:101` | `Maria Eduarda Albuquerque de Vasconcelos Nascimento` | Name has `whitespace-nowrap`, wrapper `grow`, no cap. A 50 char name is about 380px at `text-base` and stretches the action bar pill, so the bar overflows or squeezes neighbours. | Add `max-w-[10rem] @xl/actions:max-w-[14rem] truncate` on the name div and `min-w-0` on its `grow` parent (`:98`); add `title={userName}`. Keep `text-base`. | Medium-high
6. `Components/Calendar/CalendarEventRow.svelte:41` (also `CalendarOverlapGroup.svelte:65`, `CalendarMeetingsInProgress.svelte:28`, `CalendarReminders.svelte:54`, `Calendar.svelte:125`) | `Revisão trimestral de metas de atendimento com a diretoria, parceiros e o time de operações de São Paulo` | `truncate` on a meeting subject, which is the one field people read to decide whether to join; no `title`, the subject is cut to about 25 chars and never recoverable. | On the primary row (`CalendarEventRow`, `CalendarMeetingsInProgress`) switch to `line-clamp-2 break-words`; on compact rows keep `truncate` and add `title={event.title}`. | High (confirmed truncation, row height is the trade-off)
7. `Chat/Components/Room/RoomTimeline.svelte:806` | `Squad de Suporte ao Cliente Enterprise, turno da noite` | Header name is `truncate`, one line, no `title`; the section buttons (`:826`, `whitespace-nowrap`) take their width first at `@min-[600px]`. | Add `title={$roomName}` and `line-clamp-2` instead of `truncate` (header has room for two lines; subtitle below stays). | Medium
8. `Chat/Components/Room/Room.svelte:123-126,133` | same room name, and the email form `maria.eduarda...@empresa-de-consultoria-estrategica.com.br` | With a preview, `truncate` hides the tail with no `title`; without a preview (`:141`) the name chunks render in a plain span with no wrap rule, so an unbroken email overflows the `min-w-0` button. | Add `title={$roomName}` on the row button; add `break-words [overflow-wrap:anywhere]` on the `:123` span in the no-preview branch. | Medium
9. `Components/Video/RaisedHandsPanel.svelte:80,120` (and the speakers block) | Name `Maria Eduarda...` with German buttons `Wortbeitrag erteilen` + `Hand senken` | Two `min-w-20` buttons, which grow with label text, share the row with a `grow truncate` name; in German the name gets a few px and has no `title`. | Add `title={entry.name}` and `min-w-0` explicitly on the span; stack buttons under the name (`flex-wrap`) when the panel is narrow, or drop `min-w-20` to `min-w-0 shrink-0`. | Medium
10. `style/wa-theme/video-ui.css:97-110` (`UserTag.svelte:25`) | `Maria Eduarda Albuquerque de Vasconcelos Nascimento (convidado)` on a small tile | Minimal tag at `text-xs` has `max-h-10 overflow-y-auto`: three wrapped lines turn into a scroll box inside a 20px-high floating tag, which is unusable; unbreakable emails overflow the tile. | Replace `overflow-y-auto max-h-10` with `line-clamp-2 [overflow-wrap:anywhere]` and add `title={name}` on `#name` in `UserTag.svelte:25`; add `max-w-full` on `#tag.minimal`. Font size unchanged. | Medium
11. `Components/WarningContainer/WarningToast.svelte:8` | any warning sentence longer than the screen | `h-6 truncate whitespace-pre-line`: the message is cut to one line; the user cannot read why the warning appeared. | Drop `h-6 truncate`, use `break-words` with `max-h-24 overflow-y-auto` and keep centred. | Medium
12. `Components/ActionBar/MenuIcons/ParticipantMenuItem.svelte:402,441` | `Maria Eduarda...` | Second copy of the list (the one without `title`; first copy has it at `:312,:352`). Name cut, unreachable. | Add `title={item.name}` (and `title={$LL.camera.my.nameTag()}` on `:402`) to match the first copy. | Medium
13. `Components/MeetingInvitation/MeetingInvitationPopup.svelte:60-62` | `maria.eduarda.albuquerque.vasconcelos@empresa-de-consultoria-estrategica.com.br` | Sentence with the sender name has no break rule inside an `overflow-hidden` card; an unbroken name is clipped. | Add `break-words [overflow-wrap:anywhere]` on the `<p>`. | Medium
14. `Components/Exploration/Explorer.svelte:439,529` | `escritório central, andar 12, sala de reuniões grandes` (object names) | Fixed nowrap + ellipsis with `pointer-events-none` on the span, so the name cannot show a tooltip; the object row has no `title` (the area row has one on the wrapper, ~`:520`). | Add `title` on the object row wrapper (same pattern as the area row). | Medium
15. `Chat/Components/RoomFolder.svelte:118-119` | `Operações Globais e Atendimento ao Cliente — América Latina` | `truncate` sits on an inline `<span>` inside a non-flex `div`, so it has no effect; the uppercase, wide-tracked name wraps (or overflows for unbroken words) and pushes the suggested-rooms chip. | Make the wrapper `min-w-0 flex items-center gap-2` and keep `truncate` on the span, add `title={$name}`. | Medium

## Left alone on purpose

- `Chat/Components/Room/RoomSidePanelParticipantRow.svelte:73-75`, `ProximityRoomSidePanelParticipants.svelte:67-72`, `RoomInvitation.svelte:79-81`, `UnreadConversationsPopover.svelte:39`, `CatchUpList.svelte:43`: `min-w-0` + `truncate` is correct, and the full value shows in the room or detail panel one click away. Missing `title` is cosmetic; add it only with the batch in finding 12.
- `PopUp/RaiseHandSpacePicker.svelte:54`, `PopUp/LockableAreaPicker.svelte:98`, `RoomSuggested.svelte:68,82`, `CoWebsiteTab.svelte:86`: already `truncate` with `title`.
- `Exploration/MapList.svelte:170`: map name is an absolute caption anchored to the bottom of a `w-80 h-52` card, wraps and grows upward on a gradient; four lines still fit.
- `Components/Calendar/Calendar.svelte:118`, `TodoTask.svelte:48`, `CalendarReminders.svelte:56`: `whitespace-nowrap` on times and counts is intended (short, fixed shape).
- `ActionBar/ActionBarButton.svelte:146`, `MapSubMenu.svelte:61`, `WokaMenu.svelte:171`, `MeetingInvitationPopup.svelte` buttons: `nowrap` on action labels; German labels there are short enough and the bar already scales text by container size.
- `Components/Video/PictureInPicture/DesktopMiniWindow.svelte:346,429,491,616,668,730,768`: all `min-w-0` flex children with `truncate`; width is fixed by a small window by design.
- `ThreadSummary.svelte:43` (`max-w-[26rem]`) and `RoomSidePanelHome.svelte:171-196`: topic uses `line-clamp-2 break-words`, room id uses `break-all`; fine.
- Phaser in-world name labels (canvas text, not Svelte) are outside this audit's scope; they need a separate pass.
- Text sizes `text-xxs` on status, group headers, and email lines were not raised, the brief asks to keep the existing scale; they are handled by the truncate and `title` fixes.

## Landed (session 2)

Findings 1-5 were already in the working tree (User.svelte, WokaMenu.svelte, ProximityNotification.svelte, ChatMessageBanner.svelte, ProfileMenu.svelte) and were kept as is, except the WokaMenu class noted below.

| Finding | File:line | Before | After |
|---|---|---|---|
| 2 (tidy) | `Components/ActionsMenu/WokaMenu.svelte:112` | `h3 class="break-words [overflow-wrap:anywhere]"` | `h3 class="wrap-anywhere"` (Tailwind 4 utility replaces the arbitrary class; the two classes set the same property) |
| 6 | `Components/Calendar/CalendarEventRow.svelte:41` | `span class="truncate"` | `span class="line-clamp-2 break-words" title={event.title}` |
| 6 | `Components/Calendar/CalendarMeetingsInProgress.svelte:28` | `truncate font-title text-lg` | `line-clamp-2 break-words font-title text-lg` + `title={event.title}` |
| 6 | `Components/Calendar/CalendarOverlapGroup.svelte:65`, `CalendarReminders.svelte:54`, `Calendar.svelte:125` | `truncate`, no title | `truncate` + `title={event.title}` |
| 7 | `Chat/Components/Room/RoomTimeline.svelte:806` | `text-sm font-bold truncate` | `text-sm font-bold line-clamp-2 break-words` + `title={$roomName}` |
| 8 | `Chat/Components/Room/Room.svelte:109,124` | row button without title; name column `m-0 flex-1 min-w-0` | `title={$roomName}` on the row button; column `m-0 flex-1 min-w-0 wrap-anywhere` (preview branch keeps its inner `truncate`) |
| 9 | `Components/Video/RaisedHandsPanel.svelte:80,120` | `grow truncate` | `grow min-w-0 truncate` + `title={entry.name}` |
| 10 | `style/wa-theme/video-ui.css:99,110` | `#name`: `break-words ... overflow-y-auto max-h-10 flex`; `#tag.minimal` no max width | `#name`: `wrap-anywhere ... line-clamp-2`; `#tag.minimal` adds `max-w-full` |
| 10 | `Components/Video/UserTag.svelte:25` | `<span id="name">` | `<span id="name" title={...same text...}>` |
| 11 | `Components/WarningContainer/WarningToast.svelte:8` | `h-6 whitespace-pre-line truncate text-ellipsis` | `whitespace-pre-line break-words max-h-24 overflow-y-auto` |
| 12 | `Components/ActionBar/MenuIcons/ParticipantMenuItem.svelte:401,440` | `truncate`, no title | `title={$LL.camera.my.nameTag()}` / `title={item.name}` (matches the first copy) |
| 13 | `Components/MeetingInvitation/MeetingInvitationPopup.svelte:51` | `p class="text-sm text-white/95 leading-normal"` | adds `wrap-anywhere` |
| 14 | `Components/Exploration/Explorer.svelte:431` | object row without title | `title={getEntityDisplayName(entity)}` (same pattern as the area row) |
| 15 | `Chat/Components/RoomFolder.svelte:111,113,118-121` | non-flex name wrapper, `truncate` had no effect | `min-w-0` on the outer div and button; name wrapper `flex min-w-0 items-center gap-2`; `title={$name}` on the span |

## Skipped

- Finding 9, stacking buttons or dropping `min-w-20`: that is a layout change; `min-w-0` + `title` on the name is enough to keep the name reachable.
- Finding 3/4 `max-w-[45%]` (already landed): kept; no percentage max-width token exists.

## Parked

- `style/wa-theme/video-ui.css` is not Prettier-clean at HEAD (pre-existing blank lines); not formatted to avoid rewriting unrelated lines.
