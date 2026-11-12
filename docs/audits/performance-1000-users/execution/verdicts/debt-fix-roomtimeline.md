VERDICT: FAIL

| id | severity (blocker/major/minor/nit) | file:line | finding | evidence |
|---|---|---|---|---|
| F1 | major | `play/src/front/Chat/Components/Room/RoomTimeline.svelte:412` | The read effect can mark a room read before opening on the unread divider. | It checks `autoScroll` before `focusPendingTimelineRequestOrScrollToBottom()` calls `scrollToFirstUnread()` and sets `autoScroll = false` at line 386. Since `initialMessagesLoaded` is not part of this guard, a ready room with a last item can send a receipt before that positioning happens. The new tests do not assert the receipt count for the unread-divider open case. |
| F2 | minor | `play/src/front/Chat/Components/Room/RoomTimeline.svelte:412` | Returning to the bottom sends a read receipt even when nothing new arrived. | Changing `autoScroll` back to `true` retriggers this effect. `MatrixChatRoom.setTimelineAsRead()` calls `sendReadReceipt()` at `MatrixChatRoom.ts:1961-1963`. The new bottom-return test checks receipt counts when messages arrived, but not a return with no new messages. |

I could not run the tests or mutation checks under the read-only constraint, so the findings are based on the supplied post-patch source and the inspected callers; actual browser animation timing remains unverified.
