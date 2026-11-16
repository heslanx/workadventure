# Step 4, shadows and elevation

Scope: `play/src/front`. Paths below are relative to it. No source file was edited.

Token note: the design system tops out at `--shadow-lg` (`theme.css:139-146`; dark variants `--shadow-dark*`). Tailwind's `shadow-xl` and `shadow-2xl` have no design-system counterpart. Tailwind `shadow-lg` may or may not resolve to the `--shadow-lg` token; this was not verified. Proposals use `shadow-lg` as "the top of the scale". The census shows 21 `shadow-lg`, 11 `shadow-2xl` and 9 `shadow-xl` classes, matching the baseline.

## Census

| class | count | files | does it truly float? |
|---|---|---|---|
| shadow-2xl | 11 | 7 Onboarding steps (Welcome:31, Complete:27, Movement:108, Communication:24, LockBubble:18, PictureInPicture:18, ScreenSharing:18), BrowserNotSupported:33, DuplicateUserConnectedModal:28, MessageActionSheet:74, RoomList:595 | yes, all over canvas or content. Too heavy: step down to lg |
| shadow-xl | 9 | CamerasContainer:516, AnnouncementCard:74, ProximityNotification:53, ChatImagePreviewModal:56, MatrixPeerProfileDebugModal:72, MentionSuggestions:159, DesktopMiniWindow:186 and :373, MapList:162 | 8 yes (heavy), 1 no (MapList:162) |
| shadow-lg | 21 | MovementStep x8 (126-185), MainLayout:238, ChatActionMenu:95, ChatMessageBanner:47, Message:397, MessageReadReceipt:81, MessageMoreMenu:65, ReactionTooltip:13, RoomTimeline:992, LockableAreaPicker:55, RaiseHandSpacePicker:31, RecordingContextMenuContent:86, RecordingSpacePicker:43, PresenterEffectsOverlay:87 | 12 yes (popovers, menus, floating button); 8 no (MovementStep keycaps); 1 dead (Presenter:87); 1 arguable (MainLayout:238) |
| shadow-md | 1 | MainLayout:288 (drawer toggle tab) | no |
| shadow-dark | 1 | CalendarReminders:41 | yes (toast over app) |
| shadow-[arbitrary] | 3 | DesktopMeetingBar:185 (`0 6px 24px .45`), ScreenAnnotationToolbar:94 (`0 4px 16px #0006`), HelpTooltip:72 (`0 2px 0` keycap edge) | 2 yes, 1 intentional keycap edge |
| shadow-sm | 0 | none as a box shadow. `drop-shadow-sm` at DroppingFileScene:10 | n/a, see Glows |
| shadow-md (other) | 2 | `drop-shadow-md` PwaInstallScreen:95, `text-shadow-md` UserName:72 | see Glows |

Rough read: about 40 of 46 token shadows sit on a real overlay. The weight problem is size (2xl/xl on cards that need only lg), plus a few decorative ones.

## Findings

Ranked by visual weight added. "Depth kept" means a real overlay keeps a shadow, one step lighter.

| # | file:line | current | proposed | layering argument | confidence |
|---|---|---|---|---|---|
| 1 | `Components/Exploration/MapList.svelte:162` | `shadow-xl` on the `<img>` | remove | The image sits inline inside a `rounded-lg overflow-hidden` card (line 150) under a `z-10` gradient overlay. The shadow is clipped by the parent and covered by the gradient. Pure decoration, and the heaviest class on a non-overlay. | high |
| 2 | `Components/Onboarding/Steps/MovementStep.svelte:126,133,140,147,158,167,176,185` | `shadow-lg` on 8 active keycaps | remove | The keycaps are inside the opaque-ish onboarding card (`bg-contrast/90`, line 108). The highlight state is already carried by `bg-yellow-400/80` and `scale-110`. A shadow on a child inside a panel is not depth over a surface. | high |
| 3 | `Components/Onboarding/Steps/*.svelte` (Welcome:31, Complete:27, Movement:108, Communication:24, LockBubble:18, PictureInPicture:18, ScreenSharing:18) | `shadow-2xl` | `shadow-lg` | Card floats over the Phaser canvas, so depth stays. 2xl is heavier than the largest token, and 7 copies repeat it. `border-white/20` already separates it. | high |
| 4 | `Chat/Components/RoomList.svelte:595` | `shadow-2xl` | `shadow-lg` | Right side panel overlays the room list (`absolute inset-y-0 end-0 z-10`). It is a real overlay but already has `border-white/10` and a `bg-contrast/95` fill. Lighten only. | medium |
| 5 | `Components/UI/DuplicateUserConnectedModal.svelte:28` | `shadow-2xl` | `shadow-lg` | Modal over `bg-black/70` scrim. The scrim already separates it, so the shadow can be lightest. | high |
| 6 | `Components/BrowserNotSupported/BrowserNotSupported.svelte:33` | `shadow-2xl` | `shadow-lg` | Blocking modal over a blurred full-screen layer (`z-[9998]`). Real overlay, lighten. | high |
| 7 | `Chat/Components/Room/MessageActionSheet.svelte:74` | `shadow-2xl` | `shadow-lg` | Bottom sheet on mobile over the chat. Real overlay, lighten. | medium |
| 8 | `Components/Video/PictureInPicture/DesktopMiniWindow.svelte:186` and `:373` | `shadow-xl` (drawer, menu) | `shadow-lg` | Line 186: slide-over drawer above the video (`absolute z-20`), only when `inMeeting`. Line 373: popup menu (`z-40`). Both real overlays. | high |
| 9 | `Components/EmbedScreens/CamerasContainer.svelte:516` | `shadow-xl` | `shadow-lg` | Fixed picture-in-picture video over the canvas (`fixed bottom-20 right-2 z-30`). Real overlay. | high |
| 10 | `Components/Announcement/AnnouncementCard.svelte:74`, `Components/ProximityNotification/ProximityNotification.svelte:53` | `shadow-xl` | `shadow-lg` | Both are toast-like cards over the canvas. Real overlays. They already use `backdrop-blur-md`, so the shadow can be the lighter one. | high |
| 11 | `Chat/Components/ChatImagePreviewModal.svelte:56`, `Chat/Components/MatrixPeerProfileDebugModal.svelte:72`, `Chat/Components/Room/MentionSuggestions.svelte:159` | `shadow-xl` | `shadow-lg` | Two modals and one popover above the composer. Real overlays. | high |
| 12 | `Components/MainLayout.svelte:288` | `shadow-md` | remove | Toggle tab glued to the edge of the drawer it controls (`absolute right-0`, `border-e-0`). It is the same surface as the drawer, so it does not float above anything. Translucent fill makes the shadow muddy. | medium |
| 13 | `Components/Video/PresenterEffectsOverlay.svelte:87` | `shadow-lg` | remove | Dead class: the same element sets an inline `box-shadow` (line 88) that wins over the class. Remove the class; the inline ring and drop stay. | high |
| 14 | `Components/Video/PictureInPicture/DesktopMeetingBar.svelte:185` | `shadow-[0_6px_24px_rgba(0,0,0,0.45)]` | `shadow-lg` | Floating bar over the video, so depth is right, but the arbitrary value is not a token and is heavier. Use the token. | medium |
| 15 | `Components/Video/ScreenAnnotationToolbar.svelte:94` | `shadow-[0_4px_16px_#0006]` | `shadow-lg` | Floating toolbar over the shared screen. Same reasoning as 14. | medium |

## Glows and heavy blurs

| file:line | what | verdict |
|---|---|---|
| `Components/ActionBar/ActionBarButton.svelte:256,260` | `.gradient` button: `box-shadow` of `--bg-color` at 4px 2px on hover (brand-colour glow) | Remove the hover glow (keep the border). Not an overlay. High confidence. |
| `Components/Toasts/ToastContainer.svelte:113` | success progress bar: `0 0 10px rgba(34,197,94,.4)` | Remove. Green glow on a 4px bar inside the toast. High confidence. |
| `Components/ActionBar/MenuIcons/ParticipantMenuItem.svelte:477,481` | `participant-avatar-float` keyframes animate a `box-shadow` (0 4px 12px at 50%) | Drop the box-shadow from the keyframes, keep the transform. Animated shadow on inline avatars. Medium confidence. |
| `Components/FollowMenu/FollowButton.svelte:27` | `box-shadow: 2px 2px 24px #444` (diffuse glow, 24px blur) | No `.svelte` importer found. Remove, or delete if dead. Medium confidence. |
| `Components/Video/DesktopCapturerSourcePicker.svelte:227` | modal `box-shadow: 0 24px 80px rgb(0 0 0 / 45%)` | Real modal but 80px blur is heavier than any token. Use `var(--shadow-darkLg)`. Medium confidence. |
| `Components/Video/PresenterEffectsOverlay.svelte:109` | laser pointer dot: `0 0 12px 5px rgba(255,59,48,.6)` red glow | Arguable: it is a pointer marker over the video and the glow makes it visible. Reduce to about `0 0 6px 2px`. Low confidence. |
| `Components/Video/PresenterEffectsOverlay.svelte:88` | loupe inline `0 4px 14px rgba(0,0,0,.4)` | Real float over the video. Keep. |
| `Components/PwaInstall/PwaInstallScreen.svelte:95` | `drop-shadow-md` on the logo | Logo over a blurred splash. Arguable; remove if the logo reads on its own. Low confidence. |
| `Components/DroppingFile/DroppingFileScene.svelte:10` | `drop-shadow-sm` on text | Legibility over canvas. Keep. |
| `style/cowebsite/_short-screens.css:25` | `box-shadow: 3px 3px red, 1em 0 10em black` | Looks like debug leftover (hard red offset plus 10em blur). Check if the file is reachable (`cowebsite.css:2` imports `_..css`, which looks odd). Remove if live. Low confidence. |
| `style/chat.css:144-146` | tooltip `--shadow` of `0 10px 15px -3px`, a Tailwind-equivalent non-token shadow | Floating tooltip, real overlay. Could use the token. Low priority. |
| `Components/Onboarding/OnboardingHighlight.svelte:556` | `animate-pulse` on a red 4px highlight ring | Attention marker over the canvas, not a container glow. Keep. |
| `animate-pulse` elsewhere | CoWebsiteTab skeletons, RoomListSkeleton, RoomTimelineLoading, Recording dot, Loader text, WokaMenu text | Loading/recording indicators. Keep. |
| `backdrop-blur-*` | widespread on overlays | Out of scope for this step (blur is fill/glass, not elevation). Left alone. |

## Left alone on purpose

- Popovers and menus with `shadow-lg` over content: `ChatActionMenu:95`, `MessageMoreMenu:65`, `MessageReadReceipt:81`, `ReactionTooltip:13`, `Message.svelte:397` (hover options toolbar), `LockableAreaPicker:55`, `RaiseHandSpacePicker:31`, `RecordingSpacePicker:43`, `RecordingContextMenuContent:86`. All float above the action bar, the timeline or the canvas.
- `RoomTimeline.svelte:992`: "jump to latest" button floating over the message list.
- `ChatMessageBanner.svelte:47`: shadow-lg banner sitting above the composer; I did not confirm whether it is inline. Left alone, worth a visual check.
- `MainLayout.svelte:238`: slide-in drawer over the video grid, a real overlay. Could drop one step to the lightest token if the toggle is removed (#12).
- `CalendarReminders.svelte:41`: `shadow-dark` is an existing token, on a toast over the app.
- `HelpTooltip.svelte:72`: `0 2px 0` keycap bottom edge is a shape cue, not elevation (`shadow-white/50` there is a no-op colour).
- `VideoMediaBox.svelte:540`: triple black `drop-shadow` outline on the mute icon. It is a legibility halo over arbitrary video, not elevation. The commented-out copy at 776 is dead.
- `UserName.svelte:72` `text-shadow-md`: text legibility over video.
- `style.css:919-927` username pulse ring: a 0-blur spread ring, not a glow.
- `inputStyles="box-shadow:none !important"` resets: already shadow-free.

## Landed (session 2)

No new source edits. Re-verified against the current code: findings 1-15 and the glow fixes for ActionBarButton, ToastContainer, ParticipantMenuItem and DesktopCapturerSourcePicker were already applied in session 1 (visible in `git diff`). Census now shows 0 `shadow-2xl`, 0 `shadow-xl`, 0 arbitrary `shadow-[..]` and 0 `shadow-md` box shadows in `play/src/front`. Nothing was redone or reverted.

## Skipped

- `Components/Video/PresenterEffectsOverlay.svelte:109` laser glow: low confidence; the glow is what makes the pointer visible over arbitrary video, and the proposed `0 0 6px 2px` would be a new non-token value.
- `Components/PwaInstall/PwaInstallScreen.svelte:95` `drop-shadow-md`: low confidence; logo legibility over the blurred splash was not checked visually, so it stays.
- `style/chat.css:144-146` tooltip shadow: already equal to Tailwind `shadow-lg` values on a real floating tooltip; no visual change to gain.

## Parked

- `Components/FollowMenu/FollowButton.svelte:27` glow: the component has no importer (dead code). Editing its shadow has no visible effect; deleting the file is cleanup outside this visual pass.
- `style/cowebsite/_short-screens.css:25` debug-looking `3px 3px red, 1em 0 10em black`: the file is imported (`style/index.css:11` -> `cowebsite.css:2`), but no element with id `cowebsite` exists in the front end, so the rule is dead. Removal belongs to a dead-CSS cleanup, not this step.
