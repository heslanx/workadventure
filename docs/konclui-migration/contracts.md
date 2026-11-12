# Native migration boundary contracts

These contracts define acceptance before implementation. Exact transport changes and type signatures require source review before each slice. No transport redesign is accepted merely by this document.

## Room activation and shell

Input is the native current room and scene readiness, not a pathname captured at module import. Output is either the native default layout, the Konclui room shell, or the existing loading/error UI. A missing room is not a Konclui room. Root navigation and direct-room navigation must converge after room resolution.

The router owns navigation. Phaser owns the scene and camera. Svelte owns shell elements and control subscriptions. One mounted shell subscribes once; room replacement destroys its room-bound resources. Pending asynchronous work is cancelled before it can update a replacement room. Engine controls use their existing stores and actions directly. No selector/text lookup activates an underlying control.

## Room roster, viewport, and call

Room roster entries use authoritative session/player IDs with a separate account UUID when available. Display name is a label, never a key. Multiple sessions require an explicit display policy without collapsing distinct movement or call participants.

The room owner supplies initial membership and incremental updates. A snapshot has a room identity and generation; reconnect replaces its generation. Stale updates from another generation cannot resurrect a departed user. Before synchronization, UI shows loading or unavailable state, not a false zero count. A last-known view is marked stale when disconnected.

Viewport visibility is a spatial subscription to player movement. Leaving view removes a rendered remote entity, not the person from the room roster. High-frequency position updates remain zone-scoped. Room-wide status/location changes are event-driven and batched; no room-wide per-frame position stream is allowed.

Call membership comes from the active conversation/space and media connection. Standing in the same map area, or having an in-conversation status, does not mean membership in the current user's call. A partially connected call exposes joining/reconnecting state; it does not manufacture missing participants.

The directory renders a bounded window of rows at 1000 users. Store updates batch once per scheduled UI update and preserve stable row identities. Benchmarks must record actual mounted rows, long tasks, latency, and errors. The legacy per-client `presenceGap` estimate is not a guaranteed aggregate rate limiter during concurrent arrivals.

### Native presence binding to verify in the roster slice

The existing `GameScene` joins `allWorldUser` with `FilterType.ALL_USERS`. `SpaceInterface` exposes `getUsers({signal})`, `observeUserJoined`, `observeUserLeft`, and `observeUserUpdated`. Reuse this scene-owned space; the directory must not create a second room-wide membership service. `WorldUserProvider` is a chat projection over the whole world and is not itself the room-roster contract.

| Input | Projection rule | Consumer |
|---|---|---|
| `SpaceUser.spaceUserId: string` | Authoritative session row key; never replace with display name or UUID | Directory selection and membership |
| `SpaceUser.uuid: string` | Account metadata; separate simultaneous sessions remain separate rows | Profile/account association |
| `SpaceUser.playUri: string` | Include only canonical URI equal to native `Room.key`; strip query/hash through URL parsing | Room count and directory |
| `name`, `characterTextures`, `availabilityStatus` | Native labels, texture identities and status; retain existing enum meanings | Windowed row renderer |
| World-space initial snapshot | Loading until resolved; empty synchronized map means zero, not an initialization shortcut | Count and empty state |
| Space add/remove/update events | Apply keyed diffs to the current room generation; ignore unrelated fields | Batched membership/status publication |
| Spatial `playersStore` / scene entities | Viewport positions only; leaving a zone does not remove roster membership | Nearby markers and scene rendering |
| Current media/conversation spaces | Actual membership and connection state, independent of roster availability | Call controls and participant count |

Subscribe to deltas before awaiting the initial snapshot, and reconcile against the authoritative snapshot without replaying stale removals or retaining a mutable upstream map as application state. The initial promise is abortable. Teardown aborts initialization, unsubscribes all three streams and connection status, cancels scheduled publication, and invalidates the generation before another room attaches. `Space.usersStore` only emits membership changes; status changes require `observeUserUpdated` or the native per-user stores.

Transport interruption marks retained rows stale. Reconnection must be proved against the actual space resynchronization lifecycle; a successful socket reopen alone cannot mark the roster live. A failed snapshot exposes an unavailable state and native retry behavior, not a nearby-player substitute. Multiple sessions of one account remain distinguishable; no implicit account aggregation is part of this migration.

The first correctness experiment uses two equal display names, two sessions sharing one UUID, an out-of-viewport participant, another room in the same world, simultaneous arrivals, departure during initial synchronization, and reconnect while a participant leaves. Assert the exact session-key set, not only the count. Then test 1000 entries with a bounded mounted row count, batched notifications, and no room-wide movement payloads. Full initial membership distribution necessarily carries membership information to its consumers; batching does not justify claiming constant total network cost.

Area labels and offscreen minimap coordinates require a separate low-frequency domain update contract. The current `SpaceUser` protocol contains no player coordinates. Do not add per-tick coordinates to `allWorldUser` to recreate the legacy `office-presence` broadcast. Until that contract and native UI are verified, U03/U05/U24 remain open and the generated map's old presence script is explicitly intermediate.

## Static assets and live map state

Asset identities include content/revision information. Shared sprites use Phaser's existing texture-key cache. Immutable HTTP caching applies only when the URL changes with the bytes. Mutable WAM/editor state is separately revalidated. Cache failures fall back to network without substituting stale state as current.

The provenance manifest owns selected imported source paths, hashes, notices, and target-relative destinations. Generated map output lives separately. Building or running the candidate cannot require the reference checkout. One-time import tooling accepts the reference as an explicit input.

## Media and economy

Existing native media stores own device intent, acquired tracks, and connection state. Economy records the prior preference and restores it only if the user has not superseded it. A preview releases only tracks it acquired exclusively. Call subscriptions and timers are disposed on leave/reconnect/destroy.

The remote-video budget includes camera and screen-share publications. Audio availability is independent; an arbitrary audio cap is not authorized. Correctness tests include joining/leaving while the budget changes and screen-share priority. Performance comparisons use synthetic local media with identical settings.

## Map rules and engine behavior

Map entities retain stable IDs, editor-authored positions, and their public scripting contracts. Sitting, desk ownership, doors, room locks, games, and bell actions preserve intended state transitions. Native engine integration owns collision, pose, input, and render lifecycle. Privacy rules remain active when visual effects are disabled.

Invalid or unavailable map data must surface a visible unavailable state or the existing native error behavior. It must not silently reset ownership or overwrite edited state. Persistent writes require the owning map-storage API; generated defaults never replace an edited WAM automatically.

## Proof required per slice

Record source identity, changed owners, affected consumers, initialization and disposal evidence, error paths, and observable acceptance in the migration matrix. Root/direct navigation, reconnect, denied devices, reduced motion, keyboard/touch, and four widths are cross-cutting consumers. Focused tests cannot certify an unexecuted runtime scenario. All performance budgets remain unproven until measured on identified production bundles.
