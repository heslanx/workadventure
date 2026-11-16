# Step 1, icons

## What exists today

Two icon families share the UI.

1. **Custom SVG components** in `play/src/front/Components/Icons` (77 files, Tabler-derived paths). 70 use `viewBox="0 0 24 24"`. Size is two Tailwind class props (`height="h-6"` / `width="w-6"`, default in 69 files). Stroke weight is a `strokeWidth` prop bound to `stroke-width={strokeWidth}`. Default is `"1.5"` in 59 files. Colour is a Tailwind class (`strokeColor="stroke-white"`). Outliers: `ShareIcon` (`"stroke-2"`), `LoaderIcon` (`"1"`), and files with hard-coded 2 (`HangerIcon`, `DeskExitIcon`, `ArrowBarRight`, `LockHashIcon`). `DownloadIcon` sets no stroke width at all.
2. **Tabler via `@wa-icons`** (`play/src/front/Components/Icons.ts`, 169 `~icons/tabler/*` re-exports, unplugin-icons). Used in about 148 files as `<IconXxx>`. Size is `font-size`: 20 (88 uses), 18 (56), 16 (38), 14 (29), 12 (14), 24 (9), 22 (5, only four are icon uses), 1.2em when unset. Stroke weight is fixed at 2: the iconify body carries `stroke-width="2"` on each `<path>`.

Other inline `<svg>` blocks use `stroke-width` 2 (about 14), 1.8 (7, all in `DesktopMiniWindow.svelte`), 1.25 (17, all in `TutorialInstruction.svelte`) and 1.

Design system: `node_modules/@workadventure/design-system/src/theme.css` defines no icon size or stroke tokens. The only conventions are the ones above.

Verified fact that drives several findings: the iconify Tabler bodies set `stroke="currentColor" stroke-width="2"` on the `<path>`. A `stroke="1.5"` prop on an `<Icon...>` component lands on the `<svg>` root and is overridden by the path. Every `stroke=` prop on a Tabler icon is dead and the real weight is always 2.

## Findings

Ranked by visual impact.

1. `play/src/front/Components/Icons/DownloadIcon.svelte:25` | `<svg>` has no `stroke-width`, so it renders at the SVG default of 1 | add `stroke-width="2"` after `stroke-linejoin="round"` | The icon is the thinnest in the app (the family uses 1.5). It sits at `h-4 w-4` next to `<IconTrash class="h-4 w-4" />` (weight 2) in `PopUp/Recording/RecordingsListModal.svelte:407,453` and `PopUp/Recording/RecordingContextMenuContent.svelte:92`. Use 2 to match its Tabler siblings in those rows. | high
2. `play/src/front/Components/Video/PictureInPicture/DesktopMiniWindow.svelte:196,233,256,280,318,662,684` | `stroke-width="1.8"` | `stroke-width="2"` | The same window uses 2 on its chevron/calendar/search svgs (lines 352, 419, 510, 528, 549, 595). 1.8 appears nowhere else in the codebase. The toolbar close/chat/open icons look lighter than their neighbours. | high
3. `play/src/front/Components/ActionBar/MenuIcons/ProfileMenuContent.svelte:198` and `:223` | `<IconBug font-size="22" />`, `<IconAppWindow font-size="22" />` | `font-size="20"` | They sit in the same action bar list as `IconFileDownload`, `IconHelpCircle` and `IconLogout`, which are 20, and the other Tabler action bar buttons (`MapSubMenu`, `CloseChatMenuItem`, `ParticipantMenuItem`) are 20. 22 is the odd size out. | high
4. `play/src/front/Components/ActionBar/MenuIcons/LoginMenuItem.svelte:30` | `<IconUserCircle />` (no size, falls back to 1.2em, about 19px) | `<IconUserCircle font-size="20" />` | Every other Tabler icon in an `ActionBarButton` sets 20. This one is the only one that inherits `1.2em`. | medium
5. `play/src/front/Components/ActionBar/MenuIcons/MusicMenuItem.svelte:41` | `<IconLoader class="animate-spin" />` (1.2em, about 19px) | `<IconLoader font-size="20" class="animate-spin" />` | In the same button slot it swaps with `PlayerPlayIcon`, `PlayerPauseIcon`, `PlayerStopIcon` and `PlayerMusicIcon` (all `h-6 w-6`, weight 1.5). The loading state shrinks visibly. 20 is the Tabler action bar size, 24 is the custom size. I pick 20 because a Tabler stroke of 2 at 24 would look heavier still. | medium
6. `play/src/front/Components/MainLayout.svelte:301` | `<ChevronLeftIcon height="h-7" width="w-7" strokeWidth="2" />` | `<ChevronLeftIcon height="h-8" width="w-8" strokeWidth="2" />` | `h-7` occurs once in the whole UI. The only other chevrons with `strokeWidth="2"` (`EmbedScreens/CamerasContainer.svelte` the four arrows, around lines the four arrows) use `h-8 w-8`. | low
7. `play/src/front/Components/Icons/ShareIcon.svelte:15` and `:26` | default `strokeWidth = "stroke-2"` and attribute `stroke-width="2"` | `strokeWidth = "stroke-[1.5]"` and `stroke-width="1.5"` | It is the only custom icon with a different default. Its only consumer, `ActionBar/MenuIcons/InviteMenuItem.svelte:72`, already overrides it to `stroke-[1.5]`. No rendered change. This removes the trap for the next consumer. | medium
8. `play/src/front/Components/Video/UpDownChevron.svelte:20` | `<IconChevronDown stroke="2.5" font-size="20" ...>` | remove `stroke="2.5"` | Dead prop. It renders at 2, so the chevron is not heavier than the others. The source claims a weight it does not have. No rendered change. | medium
9. `play/src/front/Components/Menu/GuestSubMenu.svelte:151` (`<IconShare font-size="20" stroke="1.5" />`) | `stroke="1.5"` | remove `stroke="1.5"` | Dead prop. It renders at 2. No rendered change. | medium
10. `play/src/front/Components/ActionBar/EmojiSubMenu.svelte:244` and `:247` | `<IconPencil stroke="1" font-size="12" ...>`, `<IconXIcon stroke="1" font-size="16" ...>` | remove `stroke="1"` | Dead props. They render at weight 2, so the 12px pencil is visually heavier than the code suggests. Removing makes the code honest. No rendered change. | medium
11. `play/src/front/Components/ActionBar/ActionBar.svelte:116`, `ActionBar/MenuIcons/MapSubMenu.svelte:68`, `ActionBar/MenuIcons/ParticipantMenuItem.svelte:274` | `stroke="2"` on Tabler icons | remove `stroke="2"` | Dead props (the weight is already 2). No rendered change. | medium

Left out: 0 (11 findings, below the cap of 15). Items 8 to 11 are clean-up of no-op props, kept only because they mislead the next editor.

## Left alone on purpose

- `Icons/HangerIcon.svelte:29`, `DeskExitIcon.svelte:11`, `ArrowBarRight.svelte:24`, `LockHashIcon.svelte:16` hard-code `stroke-width="2"`. They are exported through `@wa-icons` as `IconDeskExit`, `IconLockHash` and so on and sit beside Tabler icons (weight 2). Changing them to 1.5 would make them lighter than their neighbours.
- `HatIcon`, `HairIcon`, `BodyIcon`, `EyesIcon`, `SwordIcon` have no stroke width. They are filled Woka-customisation icons.
- `TutorialInstruction.svelte` `stroke-width="1.25"` (17 uses) is a 59px illustration on a `viewBox="0 0 59 59"`, not a UI icon.
- `LoaderIcon` (`strokeWidth = "1"`) and `Chat/Components/Loader.svelte`, `Chat/images/loading-small.svelte` (`stroke-width` 1 and 4) are animated spinners.
- `IconSpeakerPhone` and `IconMessageShare` at 22 in `Modal/GlobalCommunicationModal.svelte:136` and `Announcement/AnnouncementComposerModal.svelte:80` are modal headings beside `text-xl` titles. `ToolIcon font-size="22"` in `MapEditor/MapEditorSideBar.svelte:154` is a tool-rail icon. These are single-context sizes, not mixed with 20.
- `RaiseHandIcon` at `h-4` in `Video/RaisedHandBadge.svelte` and `h-5` in `Video/RaisedHandsDock.svelte` are different surfaces (badge versus dock).
- Sizes 12/14/16/18 in dense lists, chips and inputs follow the text size beside them.
- `Components/Icons/CamOnIcon` and the other action bar icons at `h-6 w-6` inside the `w-6 h-6` box of `ActionBarButton` are already aligned.

## Cannot fix without breaking a rule

- **Custom (1.5) versus Tabler (2) weight mismatch in the same toolbar.** The action bar and its menus mix `h-6` custom icons at 1.5 (for example `SettingsIcon`, `CamSettingsIcon`, `ProfilIcon`, `MicOnIcon`) with `Icon...` Tabler icons at 2. Aligning them needs either a global CSS override of `path { stroke-width }` for Tabler icons, or a stroke prop that unplugin-icons does not provide. Both are new mechanisms. The alternative is raising the 59 custom defaults from 1.5 to 2, which changes the weight of every action bar icon.
- **Custom 24px versus Tabler 20px optical size in the action bar.** The custom icons render at 24px in a 24px box and the Tabler ones at 20px. Matching them means choosing one of the two sizes for the other family across about 40 call sites. That is a layout-wide decision, not a smallest change.

## Landed (session 2)

All paths under `play/src/front/Components/`. Line numbers are as of this pass.

| # | File:line | Before | After |
|---|---|---|---|
| 1 | `Icons/DownloadIcon.svelte:26` | no `stroke-width` on `<svg>` (renders at 1) | `stroke-width="2"` after `stroke-linejoin="round"` |
| 2 | `Video/PictureInPicture/DesktopMiniWindow.svelte:196,233,256,280,318,662,684` | `stroke-width="1.8"` | `stroke-width="2"` |
| 3 | `ActionBar/MenuIcons/ProfileMenuContent.svelte:198,223` | `<IconBug font-size="22" />`, `<IconAppWindow font-size="22" />` | `font-size="20"` |
| 4 | `ActionBar/MenuIcons/LoginMenuItem.svelte:30` | `<IconUserCircle />` | `<IconUserCircle font-size="20" />` |
| 5 | `ActionBar/MenuIcons/MusicMenuItem.svelte:41` | `<IconLoader class="animate-spin" />` | `<IconLoader font-size="20" class="animate-spin" />` |
| 6 | `MainLayout.svelte:301` | `<ChevronLeftIcon height="h-7" width="w-7" strokeWidth="2" />` | `height="h-8" width="w-8"` (button stays `h-16 w-10`, tap target unchanged) |
| 7 | `Icons/ShareIcon.svelte:15,26` | `strokeWidth = "stroke-2"`, `stroke-width="2"` | `strokeWidth = "stroke-[1.5]"`, `stroke-width="1.5"` (no Tailwind token for 1.5; matches the only consumer's override) |
| 8 | `Video/UpDownChevron.svelte:20` | `<IconChevronDown stroke="2.5" ...>` | `stroke` prop removed |
| 9 | `Menu/GuestSubMenu.svelte:151` | `<IconShare font-size="20" stroke="1.5" />` | `<IconShare font-size="20" />` |
| 10 | `ActionBar/EmojiSubMenu.svelte:244,247` | `stroke="1"` on `IconPencil`, `IconXIcon` | removed |
| 11 | `ActionBar/ActionBar.svelte:116`, `ActionBar/MenuIcons/MapSubMenu.svelte:68`, `ActionBar/MenuIcons/ParticipantMenuItem.svelte:274` | `stroke="2"` line on Tabler icon | line removed |

Re-verified before 8 to 11: the iconify Tabler bodies (`chevron-down`, `share`) carry `stroke="currentColor" stroke-width="2"` on the `<path>`, so the removed props were dead. Prettier check passes on all 13 touched files.

## Skipped

None.

## Parked

- Custom 1.5 versus Tabler 2 stroke weight in the action bar, and custom 24px versus Tabler 20px optical size: see "Cannot fix without breaking a rule". Both need a design decision across families.

## Sprint 4: icons

Resolves the two parked items (custom 1.5/24px versus Tabler 2/20px in the action bar). The custom icons now render exactly like a Tabler icon: 20px box, stroke 2 on a 24 viewBox (1.67px on screen). Only call sites in the action bar changed; custom-icon defaults used elsewhere stay at `h-6 w-6` and 1.5. Paths under `play/src/front/Components/`.

### Landed

| # | File:line | Before | After |
|---|---|---|---|
| 1 | `ActionBar/MenuIcons/CameraMenuItem.svelte:126,128` | `<CamOnIcon />`, `<CamOffIcon />` | `height="h-5" width="w-5" strokeWidth="2"` |
| 2 | `ActionBar/MenuIcons/MicrophoneMenuItem.svelte:119,121` | `<MicOnIcon />`, `<MicOffIcon />` | same three props |
| 3 | `ActionBar/MenuIcons/ScreenSharingMenuItem.svelte:46,48` | `<ScreenShareOffIcon />`, `<ScreenShareIcon />` | same three props |
| 4 | `ActionBar/MenuIcons/PictureInPictureMenuItem.svelte:57,59` | `<PictureInPictureOffIcon />`, `<PictureInPictureIcon />` | same three props |
| 5 | `ActionBar/MenuIcons/ChatMenuItem.svelte:84` | `<MessageCircleIcon />` | same three props |
| 6 | `ActionBar/MenuIcons/UserListMenuItem.svelte:47` | `<UsersIcon />` | same three props |
| 7 | `ActionBar/MenuIcons/FollowMenuItem.svelte:41` | `<FollowIcon />` | same three props |
| 8 | `ActionBar/MenuIcons/LockDiscussionMenuItem.svelte:201,203` | `<LockIcon />`, `<LockOpenIcon />` | same three props |
| 9 | `ActionBar/MenuIcons/MegaphoneMenuItem.svelte:18` | `<MegaphoneIcon />` | same three props |
| 10 | `ActionBar/MenuIcons/MusicMenuItem.svelte:43,45,73,109` | `<PlayerPlayIcon />`, `<PlayerPauseIcon />`, `<PlayerStopIcon />`, `<PlayerMusicIcon />` | same three props (now the same size as the 20px `IconLoader` that swaps in during loading) |
| 11 | `ActionBar/MenuIcons/RaiseHandMenuItem.svelte:127`, `EmojiMenuItem.svelte:40`, `AppsMenuItem.svelte:60` | `<RaiseHandIcon ...>`, `<EmojiIcon ...>`, `<AppsIcon ...>` without size or stroke | same three props added; active/hover fill classes untouched |
| 12 | `ActionBar/MenuIcons/ProfileMenuContent.svelte:169,193,210` | `<ProfilIcon />`, `<CamSettingsIcon />`, `<SettingsIcon />` | same three props (they sit in the list with the 20px Tabler `IconBug`, `IconHelpCircle`, `IconLogout`) |
| 13 | `ActionBar/MenuIcons/ProfileMenu.svelte:98,100` | `<MenuBurgerIcon classList=... />`, `<XIcon classList=... />` | same three props |
| 14 | `ActionBar/MenuIcons/InviteMenuItem.svelte:72` | `<ShareIcon strokeWidth="stroke-[1.5]" />` | `<ShareIcon height="h-5" width="w-5" strokeWidth="stroke-2" />` (ShareIcon takes a Tailwind class for its weight) |
| 15 | `ActionBar/MenuIcons/ChangeLayoutMenuItem.svelte:35-38,58-61` | inline Tabler arrows svg `width="24" height="24" stroke-width="1.5"` | `width="20" height="20" stroke-width="2"` |
| 16 | `ActionBar/MenuIcons/RecordingMenuItem.svelte:140-142` | `<RecordingIcon status=... />` (28px, ring stroke 1 on a 28 viewBox, 1px on screen) | `width="24" height="24" strokeWidth="2"`: ring 1.7px, outer diameter about 16px, the optical size of a full-circle Tabler icon at 20px |
| 17 | `ActionBar/MenuIcons/AppsMenuContent.svelte:67-69` | `<RecordingIcon width="20" height="20" ...>` (ring 0.7px) | adds `strokeWidth="2.3"` (ring 1.64px, matching the 20px `IconCalendar` and `IconCheckList` below it) |
| 18 | `Icons/RecordingIcon.svelte:9-10,19,37` | ring path had no `stroke-width` and no prop | optional `strokeWidth` prop (default `"1"`, the SVG default, so other consumers render unchanged) bound on the ring path |
| 19 | `Icons/MegaphoneIcon.svelte:26` | `<svg>` without `viewBox` (only rendered right at exactly 24px; any other size cropped instead of scaling) | `viewBox="0 0 24 24"`; no change at the default `h-6 w-6` (`Video/CenteredVideo.svelte`) |

Tap targets and layout: `ActionBarButton` sizes the icon-only button itself (`h-12 w-12`, `h-10 w-10` in the `@sm` range, `h-9 w-9` compact) and centres its child, and the menu variant wraps the icon in a fixed `w-6 h-6` box, so the 4px smaller glyph does not move the bar or the menu rows. The status dot is positioned against the button, not the icon. Colours and state classes are untouched. Prettier passes on all touched files.

### Decisions

- Matched Tabler (20px, stroke 2) rather than raising Tabler to 24px: about 30 Tabler call sites in the action bar already use 20, and the task asked to align with the dominant family through the action bar call sites.
- Passed props at call sites instead of changing the 59 custom defaults, so chat, video and modal surfaces that use the same icons at `h-6`/1.5 do not change.
- `RecordingIcon` is a filled record glyph on its own 28 viewBox, so it got a stroke prop and per-site values (24px/2 in the bar, 20px/2.3 in the apps menu) that land on the same on-screen weight as Tabler (about 1.67px).

### Not done

- `RecordingActiveIcon` (`RecordingMenuItem.svelte:137`, 40px "STOP REC" text glyph): filled lettering, no stroke to match; shrinking it would make the text unreadable.
- `ChevronDownIcon` in `ProfileMenu.svelte:130` is already stroke 2 at `h-4`, a 16px disclosure chevron beside the user name; left as is.
- Spinner `<svg>` in `EmojiSubMenu.svelte:223` (stroke 4, animated) and `Spinner` in `ParticipantMenuItem`/`ParticipantWoka`: loading indicators, not family icons.
- Visual verification in a browser was not run (orchestrator runs checks at the end; no dev server in this unit).

## Sprint 4 review round: icons

Four reviewer findings checked against the current code. None applied; no code changed in this round.

### Rejected

1. `ActionBar/MenuIcons/RecordingMenuItem.svelte:140-142` (in-bar `RecordingIcon` at 24px instead of 20px). Deliberate and documented in Sprint 4 row 16. The ring path spans x 4.5 to 23.5 of the 28 viewBox (68% of the box), while Tabler glyphs span about 18 of 24 (75%). At 20px the ring would be about 13.6px across, visibly smaller than its 20px Tabler neighbours; at 24px it is about 16.3px, the optical size of a full-circle Tabler icon at 20px, and stroke 2 gives 1.71px on screen (Tabler: 1.67px). The button box (`h-12 w-12` / `h-10 w-10`) centres the child, so the 24px box does not change layout. The apps menu uses 20px/2.3 because there the icon sits in a fixed `w-6 h-6` row slot beside list icons, a different context.
2. `ActionBar/MenuIcons/ChatMenuItem.svelte:37-40` (store-derived `chatAvailable`). Not part of this unit's diff: it belongs to the Sprint 4 usability-interaction unit (`docs/ui-polish/findings/usability-interaction.md:176`, `GameManager.chatConnectionAttemptStore`), together with `blockedReason` and `actionbar.blocked.chatConnecting`. Behaviour changes are allowed in Sprint 4, and the error is not silent: `GameManager` records the failure and rethrows, and `GameScene` logs and reports it. Reverting it here would undo another unit's reviewed work. This unit only owns the icon props on line 80.
3. `ActionBar/MenuIcons/UserListMenuItem.svelte:25-28`. Same as 2: owned by the usability-interaction unit; this unit only owns the `UsersIcon` props on line 43.
4. `ActionBar/MenuIcons/ProfileMenu.svelte:73-87,109-114` (role/tabindex/aria/onkeydown, truncation). Not part of this unit's diff: the keyboard model comes from the accessibility-motion unit (`docs/ui-polish/findings/accessibility-motion.md:118`, Keyboard 2) and the truncation plus `title` from step 8 long-text (`docs/ui-polish/findings/step-8-long-text.md:56`). Each is already its own reviewed change. Nested-interactive check done: the trigger contains only the burger/X icon, the `Woka` avatar, the name text and the chevron, with no `<button>`, `<a>` or click handler inside, so `role="button"` on the div is valid. This unit only owns the `MenuBurgerIcon`/`XIcon` props on lines 98 and 100.

### Not done

- Visual check in a browser of the 24px versus 20px recording ring was not run (no dev server in this unit; orchestrator runs checks at the end).
