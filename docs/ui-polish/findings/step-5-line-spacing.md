# Step 5, line spacing

Scope: `play/src/front`, read only. No source file was edited.

## How the numbers were computed

The leading comes from the design system, not Tailwind's stock pairs
(`node_modules/@workadventure/design-system/src/theme.css:103-120`):

| Token | Font size | Default line-height | Ratio |
|---|---|---|---|
| `text-xxs` | 11px | 16px | 1.45 |
| `text-xs` | 13px | 20px | 1.54 |
| `text-sm` | 14px | 24px | 1.71 |
| `text-base` | 16px | 28px | 1.75 |
| `text-lg` | 18px | 28px | 1.56 |
| `text-xl` | 24px | 28px | 1.17 |
| `text-2xl` | 28px | 28px | 1.00 |

Two consequences drive every finding below:

1. The default pairs are already roomy up to `text-lg`. Any `leading-*` utility on `text-xs`/`text-sm` prose
   makes it tighter than the default. `leading-tight` is 1.25, `leading-snug` is 1.375, `leading-4` is 16px.
2. From `text-xl` up, the default line-height stays at 28px, so a wrapped paragraph at 24px runs at 1.17.
   That is the "inherited from a heading scale" case.

The base `html` line-height is not overridden by the repo (Tailwind preflight, 1.5), so plain `<p>` text with
no size class is fine and was left out.

## Prose surfaces found

| Surface | File | Font size | Current leading | Computed px | Verdict |
|---|---|---|---|---|---|
| Camera/mic permission help text | `Components/HelpSettings/HelpCameraSettingsPopup.svelte:59` | 14px | `leading-4` | 16px (1.14) | too tight, fix |
| Notification help text | `Components/HelpSettings/HelpNotificationSettingPopup.svelte:49` | 14px | `leading-4` | 16px (1.14) | too tight, fix |
| Confirmation modal bodies (3) | `Components/ActionBar/AvailabilityStatus/Modals/*.svelte` | 24px | default `text-xl` | 28px (1.17) | too tight, fix |
| Chat application card description | `Chat/Components/Room/Application/ApplicationFormWrapper.svelte:191` | 13px | `leading-tight` | 16.25px (1.25) | too tight, fix |
| Chat application card description (3 cards) | `Chat/Components/Room/MessageInputBar.svelte:626` | 13px | `leading-tight` | 16.25px (1.25) | too tight, fix |
| Quoted reply body | `Chat/Components/Room/Message/MessageText.svelte:131` | 13px | `leading-4` | 16px (1.23) | tight, fix |
| Toasts (4 sentences) | `Components/Toasts/{BrowserNoSoundInfo,LoudEnvironment,NoMicrophoneSound,BrowserAudioInterrupted}Toast.svelte` | 14px | `leading-snug` | 19.25px (1.375) | slightly tight, fix |
| Upload error title and hint | `Chat/Components/Room/MessageInputBar.svelte:684` | 14px | `leading-snug` | 19.25px (1.375) | slightly tight, fix |
| PWA install description | `Components/PwaInstall/PwaInstallScreen.svelte:100` | 14px italic | `leading-snug` | 19.25px (1.375) | slightly tight, fix |
| Meeting invitation sentence | `Components/MeetingInvitation/MeetingInvitationPopup.svelte:51` | 14px | `leading-snug` | 19.25px (1.375) | slightly tight, fix |
| Away overlay text | `Components/Video/AwayPausedOverlay.svelte:57,68` | 14px / 13px | `leading-tight` | 17.5px / 16.25px | tight in a narrow tile, fix |
| Recording toast subtitles | `Components/PopUp/Recording/RecordingStartedToast.svelte:103`, `RecordingCompletedToast.svelte:129` | 13px | `line-height: 1.3` | 16.9px | tight, fix |
| Chat message body | `Chat/Components/Room/Message/MessageText.svelte:131` | 14px | default `text-sm` | 24px (1.71) | fine |
| Poll question body | `Chat/Components/Room/ProximityRoomSidePanelQuestions.svelte:142` | 14px | `leading-5` | 20px (1.43) | fine |
| Generic toast container message | `Components/Toasts/ToastContainer.svelte:70` | inherited | `leading-6` | 24px | fine |
| Help tooltip description | `Components/Tooltip/HelpTooltip.svelte:75` | 13px italic | default `text-xs` | 20px (1.54) | fine |
| Error and map-deleted screens | `Components/UI/ErrorScreen.svelte`, `Components/MapDeletedPrompt.svelte` | 12-30px | inherited 1.5 | 1.5 x size | fine |

## Findings

Ranked by readability harm. Proposed values keep font, size, weight, wording and width. Where a card has a
`min-h-*`, it is a minimum and lets the content grow, so no container change is needed.

1. `Components/HelpSettings/HelpCameraSettingsPopup.svelte:59` | `text-sm leading-4` | `text-sm leading-6` |
   16px (1.14) -> 24px (1.71) | high. Multi-sentence permission help at 14px with a 16px line box.
2. `Components/HelpSettings/HelpNotificationSettingPopup.svelte:49` | `text-sm leading-4` | `text-sm leading-6` |
   16px (1.14) -> 24px (1.71) | high. Same pattern, same fix.
3. `Components/ActionBar/AvailabilityStatus/Modals/NotificationPermissionModal.svelte:45`,
   `ChangeStatusConfirmationModal.svelte:26`, `BubbleConfirmationModal.svelte:30` | `text-xl` only (no leading) |
   `text-xl leading-8` | 28px (1.17) -> 32px (1.33) | high. A wrapped 24px sentence uses the heading-scale
   line box (28px). The modal grows by one extra 4px per wrapped line.
4. `Chat/Components/Room/MessageInputBar.svelte:626` (`applicationDescriptionClass`) and
   `Chat/Components/Room/Application/ApplicationFormWrapper.svelte:191` | `text-xs ... leading-tight` |
   `text-xs ... leading-5` | 16.25px (1.25) -> 20px (1.54) | high. The 144px wide (`w-36`) card wraps the
   description to three or four lines, the worst case for tight leading. Keep `min-h-12`/`min-h-8`; they do not
   clip.
5. `Components/Toasts/BrowserNoSoundInfoToast.svelte:55`, `LoudEnvironmentToast.svelte:24`,
   `NoMicrophoneSoundToast.svelte:33`, `BrowserAudioInterruptedToast.svelte:8` | `text-sm leading-snug` |
   `text-sm leading-normal` | 19.25px (1.375) -> 21px (1.5) | medium. Centered sentences on `max-w-sm`; they
   wrap to two or three lines.
6. `Chat/Components/Room/Message/MessageText.svelte:131` | `hasDepth ? 'text-xs leading-4'` |
   `'text-xs leading-5'` | 16px (1.23) -> 20px (1.54) | medium. Quoted reply text. The `.response` rule
   clamps the last paragraph to one line (`style/chat.css:253-258`), so the gain is limited to earlier
   paragraphs.
7. `Chat/Components/Room/MessageInputBar.svelte:684` | `leading-snug` | `leading-normal` |
   19.25px (1.375) -> 21px (1.5) | medium. Upload error hint wraps in a narrow input bar.
8. `Components/Video/AwayPausedOverlay.svelte:57` and `:68` | `leading-tight` | `leading-snug` |
   17.5px (1.25) -> 19.25px (1.375) for 14px; 16.25px -> 17.9px for 13px | medium. Text is shown only in
   wider tiles, but it wraps there. A smaller step is kept because the tile is height constrained.
9. `Components/PwaInstall/PwaInstallScreen.svelte:100` | `text-sm italic leading-snug` |
   `text-sm italic leading-normal` | 19.25px (1.375) -> 21px (1.5) | medium. Italic prose reads denser, so it
   benefits from more leading.
10. `Components/MeetingInvitation/MeetingInvitationPopup.svelte:51` | `leading-snug` | `leading-normal` |
    19.25px (1.375) -> 21px (1.5) | low. Usually one or two lines; the name can be long.
11. `Components/PopUp/Recording/RecordingStartedToast.svelte:103` and
    `RecordingCompletedToast.svelte:129` | `line-height: 1.3` | `line-height: 1.5` |
    16.9px -> 19.5px at 13px | low. Subtitles are short; the title rule (`1.4`, lines 96 and 118) stays.

Only 11 groups were needed; the 12-finding cap was not reached.

Open question: the repo has no stylesheet that overrides `line-height` globally, so findings 5 to 10 move
toward the design-system pair (`text-sm` = 24px) but stop at 1.5. If the team wants the design-system pair
everywhere, delete the `leading-*` utility instead.

## Left alone on purpose

Single-line labels, badges and headings that should stay tight:

- `Components/Tooltip/HelpTooltip.svelte:65,72`: title and shortcut keycaps, `leading-none`, single line.
- `Chat/Components/UnreadCount.svelte:34`, `Components/Video/RaisedHandBadge.svelte:22`,
  `Components/Video/PictureInPicture/DesktopMiniWindow.svelte:168`,
  `Components/ActionBar/MenuIcons/ChatMenuItem.svelte:94`: numeric badges, `leading-none`.
- `Components/UI/Chip.svelte:40`: chip label, `leading-none`.
- `Chat/Components/Room/MessageOptions.svelte:127`, `MessageActionSheet.svelte:82`: icon-only buttons.
- `Components/Calendar/*.svelte`, `Components/TodoList/TodoList.svelte:86,113`,
  `Components/EnableCamera/Select{Camera,Microphone,Speaker}.svelte`: titles that are `truncate`d, so they
  never wrap.
- `Components/Calendar/Calendar.svelte:63`, `TodoList.svelte:86`: `h3` titles at `leading-none`, one line.
- `Chat/Components/Room/Message/MessageAttachmentRecipients.svelte:108`: 10px status label under a 11px name,
  one line (also below 12px, but it is a label, not prose).
- `Chat/Components/Room/MessageInputBar.svelte:624` and `ApplicationFormWrapper.svelte:187`: card titles
  (`text-sm leading-tight`, 17.5px), short headings.
- `Components/Toasts/WebsocketReconnectingToast.svelte:16-17`: two one-line status strings.
- `Chat/Components/Room/Message.svelte:259` (`text-xxs leading-4`, timestamp stamp), `RoomOption.svelte:44`
  (`leading-snug` title), `CoWebsiteTab.svelte:83` (`leading-3`, `whitespace-nowrap`): single-line.
- `Components/PopUp/PopUpTab.svelte:35`: `line-height: 32px` on a tab label.
- Markdown headings in chat (`style/chat.css:304`, `line-height: 1.3`): headings, intentionally tight.
- Prose already running at 1.43 to 1.75 (chat message body, poll question, tooltip description, toast
  container message) is not touched.

## Landed (session 2)

Findings 1 to 4 were already present in the code at the start of this session (see Skipped). Paths are under
`play/src/front`.

| Finding | File:line | Before | After |
|---|---|---|---|
| 5 | `Components/Toasts/BrowserNoSoundInfoToast.svelte:55` | `text-sm leading-snug` | `text-sm leading-normal` |
| 5 | `Components/Toasts/LoudEnvironmentToast.svelte:24` | `text-sm leading-snug` | `text-sm leading-normal` |
| 5 | `Components/Toasts/NoMicrophoneSoundToast.svelte:33` | `text-sm leading-snug` | `text-sm leading-normal` |
| 5 | `Components/Toasts/BrowserAudioInterruptedToast.svelte:8` | `text-sm leading-snug` | `text-sm leading-normal` |
| 6 | `Chat/Components/Room/Message/MessageText.svelte:131` | `'text-xs leading-4'` | `'text-xs leading-5'` |
| 7 | `Chat/Components/Room/MessageInputBar.svelte:684` | `class="leading-snug"` | `class="leading-normal"` |
| 8 | `Components/Video/AwayPausedOverlay.svelte:57` | `text-sm leading-tight` | `text-sm leading-snug` |
| 8 | `Components/Video/AwayPausedOverlay.svelte:68` | `text-xs leading-tight` | `text-xs leading-snug` |
| 9 | `Components/PwaInstall/PwaInstallScreen.svelte:100` | `text-sm italic leading-snug` | `text-sm italic leading-normal` |
| 10 | `Components/MeetingInvitation/MeetingInvitationPopup.svelte:51` | `text-white/95 leading-snug` | `text-white/95 leading-normal` |
| 11 | `Components/PopUp/Recording/RecordingStartedToast.svelte:103` | `line-height: 1.3;` | `line-height: 1.5;` |
| 11 | `Components/PopUp/Recording/RecordingCompletedToast.svelte:129` | `line-height: 1.3;` | `line-height: 1.5;` |

No container size was changed. Prettier `--check` passes on all touched files.

## Skipped

- Findings 1 and 2 (`HelpCameraSettingsPopup.svelte:59`, `HelpNotificationSettingPopup.svelte:49`): the code
  already reads `text-sm leading-6`.
- Finding 3 (`NotificationPermissionModal.svelte:45`, `BubbleConfirmationModal.svelte:30`,
  `ChangeStatusConfirmationModal.svelte:26`): the code already reads `text-xl leading-8`.
- Finding 4 (`MessageInputBar.svelte:626`, `ApplicationFormWrapper.svelte:191`): the descriptions already use
  `leading-5`.

## Parked

- Open question from the findings (drop the `leading-*` utility to use the design-system pair, 24px for
  `text-sm`, in findings 5 to 10): needs a team decision. This session stopped at 1.5 as proposed.
