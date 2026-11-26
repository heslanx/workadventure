# Bandwidth Management

WorkAdventure lets users control the bandwidth of their camera and screen share through a quality setting. This
document explains how that setting turns into a codec, a bitrate and a frame rate, on both P2P (WebRTC) and LiveKit
connections.

The codec preferences and bitrate budgets described here live in
[`play/src/front/WebRtc/VideoPresets.ts`](../../../play/src/front/WebRtc/VideoPresets.ts), which is their single
source of truth. The two transports only call it.

## Overview

Bandwidth management operates at two levels:

- **Publisher side**: chooses the codec and caps the bitrate and frame rate of the outgoing camera and screen share.
- **Subscriber side**: asks for a quality level of incoming streams (on LiveKit a simulcast layer, only when the viewer
  chose "low"; on P2P a bitrate hint).

Users choose between three quality levels, separately for the camera and the screen share:

1. **Low**: minimal bandwidth, a 360p camera, and no AV1 for screen shares (suitable for poor connections and weak
   machines)
2. **Recommended**: balanced quality and bandwidth
3. **High**: maximum quality within the budget

## User Settings Flow

### UI Component

[`SettingsSubMenu.svelte`](../../../play/src/front/Components/Menu/SettingsSubMenu.svelte) provides two sliders
(camera and screen share) with three positions:

```typescript
// Slider values mapping:
// 1 → Low
// 2 → Recommended
// 3 → High
```

The same menu holds the *"If network bandwidth is limited"* choice (`degradationPreference`): whether a constrained
screen share should keep its resolution, its frame rate, or a balance of both. It is applied on both transports and
is not covered further here.

### Storage

- **Stores**: `videoQualityStore` and `screenShareQualityStore`
    - Type: `"low" | "recommended" | "high"` (`VideoQualitySetting`)
    - Location: [`play/src/front/Stores/MediaStore.ts`](../../../play/src/front/Stores/MediaStore.ts) and
      [`play/src/front/Stores/ScreenSharingStore.ts`](../../../play/src/front/Stores/ScreenSharingStore.ts)
- **Persistence**: values saved to `localStorage` via `LocalUserStore`
- **When read**: at track publication (LiveKit) or peer creation and every encoding update (P2P). A change of the
  camera setting also republishes a LiveKit camera; a change of the screen share setting applies to the next share.

## Codec Selection

`preferredVideoCodecs(category, quality, direction, pixels, transport)` returns the codecs we are willing to encode
(or, for the P2P receive preference, decode) with at a given frame size, best first. The transport keeps the first
one the browser can use.

It starts from a static order and filters it with what the browser knows about this machine:

| Situation | Camera | Screen share |
|---|---|---|
| Quality recommended or high | VP9, H.264 | AV1, VP9, H.264 |
| Quality low | VP9, H.264 | VP9, H.264 |

LiveKit appends VP8. The last codec of the list is the floor and always stays: H.264 in P2P, VP8 on LiveKit (see
"H.264 is not hardware on LiveKit" below). On LiveKit, H.264 above the floor stays only when the browser reports it as
hardware or says nothing, whatever its history. Then, for every other codec:

- **Desktop**: the codec is kept unless the browser reports it as unsupported or remembers it as *not smooth* at that
  frame size (see below). With no verdict, it is kept.
- **Android and iOS**: the codec is kept only if the browser reports a hardware encoder (or decoder) for it, and it is
  smooth. With no verdict, it is dropped: a phone does not experiment on its battery.
- A codec dropped for smoothness gets **one retry per week**, so a single bad session cannot demote it forever.

So a Pixel with a hardware VP9 encoder keeps VP9; a phone without one encodes H.264; a weak laptop that struggled with
VP9 at 720p last week gets H.264 in P2P, and on LiveKit gets VP8 unless its H.264 is hardware.

### What the browser knows: `CodecPerformance.ts`

At startup, [`CodecPerformance.ts`](../../../play/src/front/WebRtc/CodecPerformance.ts) asks
`navigator.mediaCapabilities.encodingInfo()` and `decodingInfo()` with `type: "webrtc"` about AV1, VP9 and H.264 (and
H.265, for an analytics event only) at three frame sizes, 720p, 1080p and 1440p. That is a few milliseconds of
lookups, no encoding. The answers are cached and read synchronously afterwards; until they arrive, the lists behave as
if there were no verdict.

In Chromium (verified in the source):

- `powerEfficient` is true when a hardware encoder or decoder exists for the codec. There is no small-size heuristic
  on the WebRTC path. The probe gives H.264 no `profile-level-id`, which libwebrtc reads as Constrained Baseline:
  LiveKit's profile, not P2P's.
- `smooth` comes from the browser's WebRTC performance history: per codec, frame size bucket, hardware flag and
  direction, the 99th percentile of the processing time per frame measured in real sessions on this profile, on any
  site. A stream is smooth when that percentile stays under the frame duration. The history is only written while a
  **single** encoder runs (one camera, no screen share, no other P2P peer), so verdicts come from clean measurements,
  and a user who only ever sits in large bubbles never writes any. With no history the answer is optimistic.
  Verdicts infer across sizes: smooth at a large size implies smooth below, not smooth at a small size implies not
  smooth above.
- Safari answers the WebRTC type too. An iPhone 14 reports VP9 as decodable in hardware but encodable in software
  only, H.264 in hardware both ways, and no AV1 at all. A browser without the API leaves everything unknown, and the
  static rule applies.

The decision is made at the size we encode: the capture size on LiveKit, and 720p for a P2P connection, whose codec
set cannot change without a renegotiation. 720p is also the most sensitive question to ask a history that infers
across sizes: not smooth at any smaller size means not smooth at 720p.

The weekly retry is a timestamp per codec and direction, kept by `LocalUserStore` like every other local setting,
decided once per session so every stream of the session agrees. Without it, avoiding a codec would mean never encoding with it again, so the browser would
never refresh its verdict.

Why these choices:

- **AV1 for screen shares**: text and UI stay sharp at a much lower bitrate than with VP9. The price is the encoder:
  on nearly every machine AV1 is encoded in software (`libaom`), and a 1080p or 1440p screen share can saturate a
  laptop. The rough CPU cost is 3 to 5 times VP8 for AV1 and 2 times VP8 for VP9.
- **No AV1 on "low"**: the "low" setting is the user telling us the machine or the connection is weak. Dropping AV1 is
  the cheapest way to halve the encode cost.
- **VP9 for cameras**: at camera sizes the AV1 saving does not justify its CPU cost, and VP9 hardware encoders exist on
  some machines.
- **H.264 as the fallback**: it is the only codec with a hardware encoder nearly everywhere (VideoToolbox on macOS,
  MediaFoundation on Windows, MediaCodec on Android). macOS in particular has no hardware encoder for VP8, VP9 or AV1,
  so in P2P H.264 is the only rung that actually frees the CPU there. It costs bandwidth: H.264 as WebRTC encodes it
  is VP8-class, so about 40 % more than VP9 for the same quality, which is why it is not the default on desktop.
- **H.264 is not hardware on LiveKit**: a default LiveKit server registers H.264 as Constrained Baseline (`42e01f`),
  then High, and that is what gets negotiated. Chrome's hardware encoder factory only advertises Constrained Baseline
  on Android, ChromeOS and Linux; on
  Windows it is behind `kPlatformH264CbpEncoding`, off by default, and on macOS it is never there
  (`IsH264ConstrainedBaselineProfileAvailableForAcceleratedEncoder()`). The format then has no hardware candidate,
  and every simulcast layer is OpenH264, at every resolution. P2P is different: Chrome lists Baseline (`42001f`)
  first, which VideoToolbox does encode. libwebrtc runs OpenH264 on a single thread for all the layers
  (multithreading is behind a field trial), so it hits the overuse detector while other cores idle. In production
  (7 days, frames ≥ 540p), OpenH264 was CPU-limited in 2.6 % of LiveKit camera samples and 14 % of screen share
  samples, against 0.5 % at most for libvpx and libaom. So on LiveKit a software H.264 (the Constrained Baseline
  probe says `powerEfficient: false`) is skipped for VP8: software everywhere too, but 2 or 3 threads from 720p up,
  for the same bandwidth budget. Viewers decode it in software instead of in hardware, a small cost: a LiveKit
  viewer received at most one H.264 stream at the 90th percentile, at about 200p. Phones and Safari report a
  hardware H.264 and keep it.
- **VP8 is never preferred**: it is mandatory in WebRTC, so every browser negotiates it anyway, and it is software
  everywhere. It is LiveKit's floor, and the codec LiveKit rewrites an unsupported one to. P2P leaves it out of the
  negotiation: H.264 is always there.
- **Below 360p, Chrome uses software anyway**: `RTCVideoEncoder` hands H.264, VP8 and VP9 frames under 360p (AV1:
  270p) to the software encoder (`kForceSoftwareForRtcLowResolutions`, on by default on desktop). A small P2P tile, or
  the lowest simulcast layer, is software whatever the codec. `describeEncoder()` calls a simulcast adapter that mixes
  both hardware.

This choice is made once per session, from what the browser remembers of past ones. What happens when the encoder
cannot keep up with it *during* a stream is in "When the encoder cannot keep up" below.

### Applying the preference

- **LiveKit** ([`LiveKitRoom.ts`](../../../play/src/front/Livekit/LiveKitRoom.ts), `getVideoCodec()`): the first
  preferred codec for which `supportsAV1()` / `supportsVP9()` from `livekit-client` answers true, passed as
  `videoCodec` at `publishTrack()`. This is explicit on purpose: LiveKit silently rewrites an unsupported codec to its
  hardcoded default of VP8, not to `publishDefaults.videoCodec`. When the primary codec is VP8, LiveKit disables the
  VP8 backup track on its own.
- **P2P** ([`RemotePeer.ts`](../../../play/src/front/WebRtc/RemotePeer.ts)): the list is handed to
  `@workadventure/simple-peer` as `receiveCodecs`, **exclusive**. WebRTC separates what a peer prefers to receive
  from what it sends: `RTCRtpTransceiver.setCodecPreferences()` only shapes what we advertise for receiving, and a
  browser sends the codecs of the *remote* description, in the remote's order. On its own, a preference therefore
  drives the *peer's* encoder, not ours: a phone asking for H.264 made its desktop peer encode H.264, while the phone
  itself encoded whatever the desktop asked for. So the negotiation is limited to what we can afford to **encode**,
  ordered by what we prefer to decode (`negotiableVideoCodecs()`, judged at 720p since the set cannot change without
  a renegotiation): the fork (12.2.0) leaves the other codecs out of our offers and answers and removes them from
  every remote description before applying it, so neither direction can use anything else. Within that set the
  peer's order wins: the browser encodes the first codec the peer listed, and the encoder budget follows that codec,
  read from `RTCRtpSender.getParameters().codecs[0]`.

  An iPhone decodes VP9 in hardware but encodes it in software, so it ends up on hardware H.264 both ways, at the
  cost of about 40 % more bandwidth than VP9. Receiving VP9 while sending H.264 would need the peer to know what we
  can encode before it offers, a protocol change kept for later. The WebRTC codec selection API
  (`RTCRtpEncodingParameters.codec`, Chrome 119+, Firefox 142+) could pick the send codec per tile size without a
  renegotiation, but it yields the same codec in every common case, so it is not used.

  The end-to-end test `tests/tests/webrtc_codecs.spec.ts` checks what each side of a bubble encodes, with Bob in
  Chromium, Firefox or WebKit (`BOB_BROWSER`), against a deployment when `PLAY_URL` and `CODEC_TEST_MAP_URL` are
  set.

### When the encoder cannot keep up: `CpuLimitationDetector.ts`

The probe above is a memory: it says nothing about the current load. During a stream, the browser does.
`qualityLimitationReason === "cpu"` in the `outbound-rtp` stats is the verdict of libwebrtc's overuse detector: the
encoder took longer than a frame interval for several seconds, and the resolution or the frame rate has **already**
been lowered (following `degradationPreference`). The machine is never unprotected. The question is only whether that
degradation is the right one for the viewers: for a software encoder, a cheaper codec at full resolution usually is,
above all on a screen share where sharpness is the product, at the price of bandwidth.

[`CpuLimitationDetector.ts`](../../../play/src/front/WebRtc/CpuLimitationDetector.ts) watches the aggregated encoder
stats of each category (`localEncoderStatsStore`, the worst case over the encoders of the category, the same numbers
the local feedback tiles show) and takes one sample a second. The reason stays set while the adaptation is in force,
so the share of `cpu` samples over a window is the share of time the encoder was limited: gaps in a long episode
are tolerated, a lone spike is ignored.

- Window of 30 samples, threshold 70 % (Jitsi waits for a 60 s streak; half the length, and gaps tolerated rather
  than a streak, so the same episode is caught about twice as fast). The first 10
  samples after a stream starts are ignored: keyframes and rate-control ramp-up look like overload.
- The window starts over when the stream stops, the transport changes (P2P ↔ LiveKit) or the codec changes.
- One decision per full window, then a full window of cooldown.
- Never for VP8 (nothing below it), never for a hardware encoder (a cheaper codec gains it nothing). H.264 only on
  LiveKit, and only when every encoder is named software (OpenH264): elsewhere it is hardware until named otherwise
  (Safari names nothing), and in P2P it is the floor, where the relief is the move to LiveKit.
- The camera holds back while a screen share is being sent: the screen share is the heavy encoder and goes first;
  demoting the camera in the meantime would mark the wrong codec.

A decision takes one of two actions, then waits a full window.

**Fewer encoders first.** In P2P, Chrome runs one encoder per `RTCPeerConnection`: with three peers the machine
encodes every frame three times. On LiveKit it encodes once (SVC or simulcast add a fraction, not a multiple), and
the viewers lose nothing. So when the limited encoders serve more than one P2P peer, the first action is to raise
the `cpuLimited` flag of our `SpaceUser` (`cpuLimitedStore`, synchronised to the space by `SpacePeerManager` like
the camera state). The back's `TransitionPolicy` then moves the bubble to LiveKit even below `MAX_USERS_FOR_WEBRTC`,
provided the bubble has more than two users (a pair gives one encoder each), and refuses to bring it back while a
flagged user is present, whatever the count, the way an ongoing recording pins it. The two legs are asymmetric so
that a third member coming and going never bounces the bubble; the flagged user leaving takes the usual delayed
LiveKit → WebRTC path. The flag stays up for the session and never goes down (lowering it on LiveKit, where the
load is gone, would bounce the bubble), so a later bubble of more than two users moves to LiveKit without paying the
window again. The transport switch resets the detector's window; if the back cannot switch (no LiveKit, or
`LIVEKIT_SWITCH_ON_CPU_LIMITATION=false` for self-hosters who would rather not pay SFU bandwidth for small bubbles),
the next window falls through to the codec.

**Then the codec.** Otherwise the decision **demotes** the codec for the rest of the session: `demotedCodecStore`
in `CodecPerformance.ts` records it per category, and `preferredVideoCodecs()` leaves it out together with every
codec above it (screen share AV1 → VP9 → H.264, camera VP9 → H.264, then → VP8 on LiveKit only: P2P ignores a
demoted H.264, its floor, so a LiveKit demotion does not take hardware Baseline away from the next bubble). Nothing
is persisted, the browser's own smooth history is the memory across sessions, and nothing goes back up before the
page is reloaded. The publishers
subscribe to the store:

- **LiveKit**: the codec of a publication is fixed at `publishTrack()`, so `LiveKitRoom` unpublishes and publishes
  again, the same two updates a share that stops and starts goes through. The camera publication is normally reused
  for the whole room (turning the camera off pauses it, see `unpublishCameraTrack()`): a demotion, or a publication that
  no longer matches the quality setting or the captured size (see `cameraPublicationKey()`), really unpublishes it.
- **P2P**: `RemotePeer` sets the fork's `receiveCodecs` to the new `negotiableVideoCodecs()` and calls
  `negotiate()`. The fork (12.3.0) re-applies the preference before every offer and answer, so both sides end up on
  the remaining codecs whoever initiates the renegotiation, and the bitrate budget follows the new codec on the
  `negotiated` event. The transceivers and ICE stay: viewers get a keyframe and a sub-second freeze.

A raised flag is reported as `media.livekit_switch.requested` (category) and each demotion as
`media.codec.degraded` (category, codec left, transport), both declared in `AnalyticsEventCatalog.ts`. Neither has an
entry in `AnalyticsPostHogKeys.ts`: they were added with this pipeline and PostHog never knew them, so they go to the
analytics database only. Read them against `media.video_quality.sample`, whose `qualityLimitationReason` is what the
decision is made on and whose `mimeType` shows the codec change itself. Firefox reports no limitation reason and
never reacts.

To see it happen: DevTools → Performance → CPU 6× slowdown, share a screen with the quality set to "high" (1440p,
AV1), enable the video quality stats overlay: the tile reports `Limited by: cpu`, and about 40 s later the codec
changes. The end-to-end test `tests/tests/webrtc_cpu_limitation.spec.ts` (opt-in, `RUN_CPU_LIMITATION_E2E=1`, a few
minutes) drives the whole chain on a deployment by making one page report every outbound video stream as
CPU-limited: three users in a bubble, the flag, the switch to LiveKit, the bubble staying there when a member
leaves, then the camera republished in VP8 (Chromium on Linux has no hardware H.264 for LiveKit); with
`CPU_LIMITATION_EXPECT=demote` it checks the codec
renegotiation with both peers instead.

## Bitrate Budget

`selectVideoPreset(displayHeight, displayWidth, isScreenShare, quality, codec, spatialLayers = 1)` returns the
`maxBitrate` and `maxFramerate` to apply to an encoder producing frames of that size.

### The formula

```
pixels  = min(width × height, 1920 × 1080)
bitrate = anchor[quality] × (pixels / anchorPixels) ^ exponent × codecFactor[codec] / codecFactor[anchorCodec]
```

A straight line on a log-log chart: the budget grows with the pixel count at a rate set by `exponent`, and is pinned
at one reference size (`anchorPixels`) by three `anchor` values, one per quality setting. Anything larger than 1080p is
budgeted like 1080p.

This is the budget of one resolution. A stream that carries several in one `maxBitrate` (an SVC camera on LiveKit) is
budgeted as the sum over its layers, each a quarter of the pixels of the one above (see
[LiveKit Implementation](#livekit-implementation)).

Two curves exist, one per stream category:

| Parameter | Camera | Screen share |
|---|---|---|
| `anchorPixels` | 1280 × 720 | 1920 × 1080 |
| `anchor.low` | 700 kbps | 1 Mbps |
| `anchor.recommended` | 700 kbps | 3 Mbps |
| `anchor.high` | 1.8 Mbps | 4.5 Mbps |
| `exponent` | 0.75 | 0.5 |
| `anchorCodec` | VP9 | AV1 |
| Frame rate | see below | 30 |

### Why an exponent, and why two different ones

At equal perceived quality, the bitrate a codec needs does not grow linearly with the pixel count. Natural video
(a camera, with motion and sensor noise) needs roughly `pixels ^ 0.75`. Static, sharp screen content needs less, about
`pixels ^ 0.5`: most of its cost is in edges and keyframes, not in the area. This is the only real difference between
the two curves. Nothing in VP9 or AV1 requires discrete resolution steps.

The camera curve is fitted on the [LiveKit bitrate guide](https://livekit.io/webrtc/bitrate-guide): "recommended" on
its webcam table (VMAF 90), "high" on its gaming table (VMAF 85). The fit is within 20 % at every standard size up to
1080p, and a unit test in [`VideoPresets.test.ts`](../../../play/src/front/WebRtc/VideoPresets.test.ts) keeps it there:
retuning the exponent or an anchor makes the test fail if the curve drifts away from the reference.

A camera on "low" gets the bitrate of "recommended" at each size. It saves by capturing 360p (see Capture resolution of
cameras) and by its lower frame rate, not by paying each size less: libwebrtc has a minimum bitrate per size (190 kbps
for VP9 at 640 × 360, 300 kbps for VP8, `GetDefaultSinglecastBitrateLimits`), and below it the encoder sends a smaller
picture than the one we ask for, reporting `qualityLimitationReason: "bandwidth"`. The guide's numbers are for 30 fps,
so at 15 fps "low" gets about twice the bits per frame.

### Why a curve rather than a table

- **Continuity.** The P2P viewer reports the exact size at which it displays a video, and that size moves with the
  layout. With a stepped table, a 640 × 360 tile that grows by one pixel jumped from 270 kbps to 450 kbps. The curve
  changes by a fraction of a percent.
- **One codec factor.** Scaling a curve for a cheaper codec is a multiplication. Scaling a table would have meant a
  table per codec.
- **Fewer numbers.** Six parameters per category instead of a nine-row table with three bitrates and three frame rates
  per row.

### The codec factor

`BITRATE_FACTOR` expresses how much bitrate each codec needs for the same visual quality, relative to AV1:

| Codec | Factor |
|---|---|
| AV1 | 1 |
| VP9 | 1.4 |
| H.264 | 2 |
| VP8 | 2 |

Each codec generation saves roughly 30 % over the previous one; constrained baseline H.264 sits with VP8. The anchors of a curve are expressed for one codec
(`anchorCodec`), and the budget is multiplied by the ratio of the two factors. So the camera anchors, which are VP9
values, are multiplied by 2 / 1.4 ≈ 1.43 for a VP8 encoder, and the screen share anchors, which are AV1 values, by 1.4
for VP9 and by 2 for VP8.

This is what makes dropping AV1 on the "low" setting safe: the screen share keeps its sharpness on VP9 because it gets
40 % more bandwidth to do so. The same applies when a stream lands on H.264: the hardware encoder is nearly free for
the CPU, and the budget doubles to compensate for its lower efficiency.

### Frame rate

Screen shares always target 30 fps: the frame rate follows the content anyway, and a static screen costs nothing at
30 fps.

Cameras lower the frame rate on small tiles, where it is the cheapest thing to give up:

| Quality | Below 1280 × 720 | 1280 × 720 and above |
|---|---|---|
| Low | 15 | 20 |
| Recommended | 20 | 30 |
| High | 30 | 30 |

### Worked examples

Camera, recommended:

| Displayed size | VP9 | H.264 or VP8 |
|---|---|---|
| 160 × 90 | 31 kbps | 44 kbps |
| 320 × 180 | 88 kbps | 125 kbps |
| 640 × 360 | 247 kbps | 354 kbps |
| 960 × 540 | 455 kbps | 650 kbps |
| 1280 × 720 | 700 kbps | 1 Mbps |
| 1920 × 1080 and above | 1.29 Mbps | 1.84 Mbps |

A VP9 camera sent as SVC on LiveKit (see LiveKit Implementation) adds its two lower layers to its budget: 672 kbps at
960 × 540, 1,035 kbps at 1280 × 720, 1.9 Mbps at 1920 × 1080.

Screen share, recommended:

| Captured size | AV1 | VP9 | H.264 or VP8 |
|---|---|---|---|
| 1280 × 720 | 2 Mbps | 2.8 Mbps | 4 Mbps |
| 1440 × 900 | 2.37 Mbps | 3.32 Mbps | 4.74 Mbps |
| 1920 × 1080 and above | 3 Mbps | 4.2 Mbps | 6 Mbps |

These are caps (`maxBitrate`). The encoder uses less when the content allows it, and the browser's congestion control
lowers the actual bitrate further when the network cannot carry it.

### Capture resolution of cameras

`videoConstraintStore` asks the camera for 1280 × 720, and for 640 × 360 on "low", which therefore never sends more
than 360p, on either transport. These are `ideal` values cropped and scaled to 16:9 by the browser: a camera can still
deliver another size (640 × 480 is seen in production), and every budget follows the size actually delivered.

### Capture resolution of screen shares

Independently of the bitrate, `screenShareMaxResolution` caps the **captured** size of a screen share per quality
setting: 720p for "low", 1080p for "recommended", 1440p for "high". On LiveKit the app lowers nothing after the
capture, and on P2P it only scales the share down to the viewer's tile, so this cap is what bounds the encode cost of
a 4K display.

### Tuning

- To make every stream of a category cheaper or richer, change its three `anchor` values.
- To change how small tiles compare to large ones, change `exponent`. Higher values starve small tiles, lower values
  starve large ones. Keep the fit test green, or update the reference table in it knowingly.
- To rebalance codecs, change `BITRATE_FACTOR`. The AV1 entry is the reference and stays at 1.
- To budget frames above 1080p, raise `MAX_PIXELS`.

## P2P (WebRTC) Implementation

**File**: [`play/src/front/WebRtc/RemotePeer.ts`](../../../play/src/front/WebRtc/RemotePeer.ts)

One `RTCPeerConnection` per remote peer, hence one encoder per peer: with three viewers, the camera is encoded three
times.

### Publisher side

- `applyVideoEncoding()` computes the encoding from the size the viewer reports, the negotiated codec and the local
  quality setting, through
  [`AdaptiveVideoEncoding.ts`](../../../play/src/front/WebRtc/AdaptiveVideoEncoding.ts).
- Applies it with `RTCRtpSender.setParameters()`: `maxBitrate`, `maxFramerate`, `scaleResolutionDownBy`, and for
  screen shares `degradationPreference`.
- Clamps the bitrate with the viewer's hint (see below).
- A viewer that does not display the video (hidden tile, background tab) gets no encoding at all.

### Subscriber side

- Reports its display size, plus a `maxBitrate` hint: the budget of `selectVideoPreset()` for that size and its own
  quality setting.
- The sender applies the minimum of its own budget and the hint, so the hint only bites when the viewer's quality
  setting is lower than the sender's.
- The viewer does not know which codec the sender picked, so the hint is budgeted for the most expensive one (VP8
  class, which H.264 shares). It therefore never starves the sender; on a VP9 sender it is 1.4× looser than the
  viewer's setting strictly implies. Sending the quality setting instead of a bitrate would remove that approximation.

## LiveKit Implementation

**File**: [`play/src/front/Livekit/LiveKitRoom.ts`](../../../play/src/front/Livekit/LiveKitRoom.ts)

### Publisher side

- Reads `effectiveVideoQualityStore` (the saved camera quality, or "low" while the uplink cap is on, see below) and
  `screenShareQualityStore` at track publication time.
- Chooses the codec with `getVideoCodec()` for the capture size of the track (see Codec Selection).
- Computes the budget with `selectVideoPreset()` for the captured size and that codec.
- Publishes the camera with `videoEncoding.maxBitrate` / `maxFramerate`, and the screen share with
  `screenShareEncoding.maxBitrate` / `maxFramerate` and the user's `degradationPreference`.
- Cameras go out as simulcast: separate streams at 180p, 360p and the captured size, so that dynacast pauses the ones
  nobody watches. Our budget applies to the **top** stream; `livekit-client` gives the lower ones its own presets
  (160 kbps and 450 kbps in 16:9). VP9 and AV1 cameras do it with `scalabilityMode: "L1T3"` on each stream, which
  `livekit-client` only honours on a LiveKit server newer than 1.13.6 and outside Safari and iOS
  (`supportsSvcSimulcast()`).
- Elsewhere, VP9 and AV1 cameras go out as SVC: one stream, `L3T3_KEY`, that always carries its three layers. `livekit-client`
  forces `L1T3` on every stream of a VP9 or AV1 screen share, so a share never carries several spatial layers inside one
  stream. The SVC `maxBitrate`
  covers every spatial layer, so the camera budget is the curve summed over its three layers (`spatialLayers` in
  `selectVideoPreset()`): 1,035 kbps at 720p "recommended" rather than 700. With the one-layer budget, libwebrtc never
  enables the top layer (a 720p VP9 stream needs 891 kbps for its three layers, a 1080p one 1,425 kbps), and the encoder
  reports `qualityLimitationReason: "bandwidth"` while the network has room to spare. libwebrtc also pads an SVC stream
  up to 1.2 × that rate to probe for the top layer, so the one-layer budget saves no upload: a 720p camera capped at
  700 kbps sends about 1 Mbps either way, 450 kbps of it padding.
- A camera on "low" is captured at 360p (see Capture resolution of cameras) and sent as 360p + 180p simulcast:
  thumbnails take the 180p stream and dynacast pauses the 360p one while nobody highlights the camera. The 180p stream
  is budgeted on our curve too (`lowCameraLowerLayer()`): `livekit-client`'s own 180p preset is sized for VP8 and runs
  at 20 fps, above the frame rate of "low". On the SVC fallback, "low" is a single `L1T3` stream: its 360p budget
  (247 kbps for VP9) is below the 299 kbps libwebrtc needs to turn the second SVC layer on at that size.
- The budget, the codec and the layers are fixed at `publishTrack()`. When the quality setting or the captured size no
  longer matches the publication, the camera is unpublished and published again (`cameraPublicationKey()`), instead of
  swapping the new track into the old publication.
- The camera declares VP8 as a backup codec (`backupCodecPolicy: SIMULCAST`): if a subscriber cannot decode VP9,
  LiveKit asks the publisher to also encode VP8, instead of downgrading everyone. When the primary codec is already
  VP8, LiveKit disables the backup itself.

### Subscriber side

**File**: [`play/src/front/Livekit/LivekitParticipant.ts`](../../../play/src/front/Livekit/LivekitParticipant.ts)

- Calls `publication.setVideoQuality(VideoQuality.MEDIUM)` when subscribing to a remote camera or screen share track
  (`handleTrackSubscribed()`), only when the viewer's own saved quality for that category is `"low"`. It is the highest
  simulcast layer the viewer accepts. `livekit-client` names the layers by position (`q`, `h`, `f`), so MEDIUM is the
  360p layer of a camera with three layers (longest side of 960 px or more), but the top layer of a publication with two
  layers (a screen share, or a camera captured below 960 px, such as one on "low"), where it changes nothing.
- With `"recommended"` or `"high"` the front sets nothing: the layer follows the adaptive stream of `livekit-client`
  (the size at which the video is displayed, see `adaptiveStream` in `LiveKitRoom.ts`) and the server.

## Uplink Cap: Automatic Camera Downgrade

**Files**: [`play/src/front/WebRtc/UplinkLimitationDetector.ts`](../../../play/src/front/WebRtc/UplinkLimitationDetector.ts)
(decisions and wiring), [`play/src/front/WebRtc/UplinkCap.ts`](../../../play/src/front/WebRtc/UplinkCap.ts) (the two
stores)

On LiveKit the browser already switches the largest simulcast layer off when the uplink cannot carry it, but the app
keeps publishing the whole ladder (720p + 360p + 180p). libwebrtc then pads up to its bandwidth estimate to try to get
the layer back, so the link stays saturated (the audio shares it), and on a link near the threshold the layer flaps:
a keyframe and a freeze for every viewer at each switch. The manual "low" setting (captured at 360p, published as
360p + 180p) is the answer to that; the uplink cap applies it by itself, for the session only, and takes it back when
the link recovers. It is meant to do so only where "low" helps. The readings of 2026-11-25 (see "Measured on
2026-11-25") found that on a link that still carries the 360p and 180p layers, the browser's own switch gives the
viewer a better picture than "low" does. The padding and the flapping above are derived from libwebrtc's rules and were
not looked at in those readings; what they saw is that the largest layer sent nothing in the periods they read.

Measured, once, in a browser on a shaped link (one run per rate, on a loaded host): what the viewer gets with and
without the cap, the time to the cap, the pauses at a cap and at a lift, and what the lift does where the shaping stays
on. The line between "the cap helps" and "the cap hurts" is a choice inside a measured bracket, not a measured
threshold. Still derived from libwebrtc's allocator rules and not measured: the size of the window (18 of 30), the
limited ratio of 0.5, the warm-up, the health window of the lift (at most 3 limited samples, 2 % loss, 400 kbps), the
holds, the backoff, the 15 s of idle and the 10 minutes that a lift must survive. Two batches of those readings were
made with the first rule. The trigger described below ran in a third batch (see "Measured on 2026-11-25"), once each at
600 kbps, 800 kbps and 1 Mbps and in one recovery from 600 kbps: it capped at 600 kbps and did not at 800 kbps and 1
Mbps. 700 and 900 kbps, 1.3 and 2 Mbps, the switching link under this rule and a quiet host are not seen. The
`media.camera_cap.changed` analytics event exists to tune what is derived.

### Trigger

The detector reads `localEncoderStatsStore.video` once a second (the poll is a timer and an async `getStats()`, so its
readings come 1000 ms apart give or take a few: one up to 100 ms early still counts), and decides from
`stats.encoders[]`: the aggregate the tiles show drops the fields it needs. A sample is limited when
`bandwidthLimitedRatio` is at least 0.5, that is, when the allocator could not fund the largest layer for most of the
second (`qualityLimitationReason: "bandwidth"`). A limited sample **counts toward the cap** only when
`availableOutgoingBitrate`, the browser's estimate on the selected candidate pair, is known and below 549 kbps: 90 % of
the 610 kbps that the 360p and 180p layers ask for together (450 + 160 kbps, `LOWER_LAYERS_BITRATE`). With no estimate
there is no cap: nothing says that the cap would help. This rule ran once per rate at 600 kbps, 800 kbps and 1 Mbps, and
in one recovery from 600 kbps (third batch, in "Measured on 2026-11-25"); T-337 in [`docs/TODO.md`](../../TODO.md) lists
what is left.

- **Eligible reading**: the source is LiveKit, there is exactly one encoder, it delivers frames (`captureFps` of 1 or
  more) and has at least two active layers (fewer means no largest layer to lose: a layer already off, or a room nobody
  watches, since dynacast pauses the layers nobody subscribes to), no screen share is running (it competes for the same
  uplink), and the saved quality is not "low". An ineligible or missing reading, a change of transport or of codec, and a
  layer that resumes (`activeLayers` going up, as dynacast does when a viewer joins: the bandwidth estimate was held near
  what the other layers send, and has to climb to fund it) clear the window and restart the warm-up.
- **Cap**: after a warm-up of 15 samples (the keyframe and the rate-control ramp-up of a new publication look like a
  weak link), at least 18 of the last 30 samples count toward the cap. The earliest cap is therefore 45 s after a
  publication starts. A dip of ten seconds does not count; a link where 60 % of the seconds count does.
- **Why the estimate is part of the rule**: limited alone says only that the largest layer is off. Chrome reports a
  layer that the allocator switched off as limited: in every shaped run of the first two batches, from 600 kbps to 1.3
  Mbps, the largest layer was limited in every sample read (in the third batch, 19 of 20 samples at 600 kbps, 298 of 299
  at 800 kbps and 297 of 298 at 1 Mbps). On a link that still carries 360p and 180p, the browser drops the largest layer
  alone. There the viewer got 360p at about 450 kbps and 20 fps, and "low" gives about 250 kbps and 15 fps (1 and 1.3
  Mbps in the first two batches, one run each). The cap helps where the layers under the largest one starve too: at 600
  kbps the 360p layer's target was 213 kbps before the cap and 205 in its trial, of 450, in the 600 kbps run of the
  first two batches (213 before the cap and 0 in its trial in the third batch's run; one run each). The estimate is the
  signal the rule uses to tell the two cases apart. In the readings it did so only roughly.
- **Where the line sits**: 549 kbps is a choice, not a measured threshold. The bracket it sits in rests on the trial
  periods of the runs (the 39 to 45 s between a lift and the next cap). The cap helped in the 600 kbps run (one run per
  rate), where the estimate was 369 to 518 kbps (518 is 85 % of 610). It did not help where the median was 583 kbps (96
  % of 610) or more: the 800 kbps link in its trial, where the viewer got 360p all the time without the cap (75 % before
  the cap; a noisy run), and the links above it. The 700 kbps run (noisy) was mixed, with medians of 433 and 520 kbps.
  No run had a median between 520 and 583 kbps, and 549 kbps (90 % of 610) falls in that gap.
  - Right after the shaping, with the estimate still coming down, the viewer got 360p less often than in the trial (900
    kbps: 17 % before the cap, median 589 kbps, against 100 % in the trial; 800 kbps, noisy: 75 % against 100 %). The
    bracket does not cover those periods.
  - A line at 610 kbps, with no margin, was rejected. At least half of the 800 kbps trial readings (median 583 kbps)
    would have counted (derived). The window asks for 60 %, so that link might have been capped. At 549 kbps fewer than
    half of them count (derived). Another 800 kbps run, in the third batch (median 601 kbps), had 16 % of its samples
    under the line (next point).
  - Single seconds fall on both sides of 549 kbps. Seen once at 800 kbps and at 1 Mbps (third batch: 16 % and 6 % of the
    samples under the line; the estimate 405 to 748 and 379 to 947 kbps). Derived, not seen, at 700 and 900 kbps, which
    were not run under the new rule. In the 800 kbps run of the first two batches every reading before the cap (358 to
    539 kbps) was under the line, so a link that has just been shaped might have been capped under the new rule all the
    same; in the third batch's run it was not (one run). The time to the cap can also be longer than the 18 to 20 s of
    most runs with the first rule (65 s in one noisy run), since the estimate has to be under 549 kbps as well; at 600
    kbps the new rule took 21 s and 20 s.

### Action

`uplinkCapStore` goes up, and `effectiveVideoQualityStore` (in `MediaStore.ts`, derived from the saved quality and the
cap) reads "low". The camera constraints and the LiveKit publication follow it, as for a camera set to "low": the
camera reopens at 360p, and `LiveKitRoom` unpublishes and publishes again as 360p + 180p. Viewers see the tile go off
for a moment (0.4 to 5.8 s in the first two batches, 13 of 25 pauses under 1 s; the third batch saw longer ones, up to
24.9 s, and the cause was not isolated), which is why caps and lifts are rare.

- The saved setting, `videoQualityStore`, is never written: the cap lives in memory and ends with the page. The code
  that reads the saved setting keeps reading it: the Settings screens, the selected value of the Media pane, what we
  ask the other side to send us (`RemotePeer`, `LivekitParticipant`). Screen share is untouched.
- `effectiveVideoQualityStore` only notifies when its value changes, so a change of the saved setting that leaves the
  cap on (recommended and high) is no event for the camera. In the app a change made by the user always clears the cap
  (see "The user wins"), and the camera then follows the quality the user chose.
- `LiveKitRoom` does not act on a change of the effective quality that crosses "low" (the cap going on or off, a
  user choosing "low"): the camera reopens, and the publication follows the new track when it arrives. Acting on the
  change itself would publish the track that the constraint change is about to stop. Between "recommended" and "high"
  the camera stays open, and the publication is checked against the new setting at once.
- A cap that is lifted while the camera is off (energy saving, outside a conversation) does not wake the camera:
  `deviceChanged10SecondsAgoStore` reads what the user chose (device, frame rate, saved quality), not the effective
  constraints.
- A toast says that others see the camera in lower quality and that it comes back on its own (raised by the first cap of
  an episode; a recovery trial that fails and caps again does not raise it again). The Media pane replaces the hint of
  the camera quality by a note that it is lowered for now and that the choice is kept.
- `media.camera_cap.changed` (`capped`, `lifted`, `cleared`, with the backoff level and the reason) is declared in
  `AnalyticsEventCatalog.ts`. Like the CPU events, it has no PostHog counterpart. Read it against
  `media.video_quality.sample`, whose `bandwidthLimitedRatio`, `uploadLossRatio` and `availableOutgoingBitrate` are what
  the decisions read. The number of active layers, which the detector also reads, is not in the sample.

### Recovery

While only 360p + 180p are sent (about 335 kbps, measured), the bandwidth estimate does not prove that the full ladder
fits: lifting the cap **is** the probe. The estimate was measured while capped. It sat still at 762, 849 and 1065 kbps
on the links of 1 and 1.3 Mbps, and in one recovery it did not climb when the link came back (see "Measured on
2026-11-25"). A camera that sends about 335 kbps and asks for no more leaves the estimate where it is once it is well
above that: that is a reading of the numbers, not a tested cause. The probe is done rarely, after a hold measured on the
wall clock (the camera can be off meanwhile) and that grows with each trial that fails:

| Backoff level | 0 | 1 | 2 | 3 (and after) |
|---|---|---|---|---|
| Hold | 5 min | 10 min | 20 min | 60 min |

Once the hold has elapsed:

1. No live LiveKit camera (nothing published, the room moved to P2P, the camera delivers no frames) for 15 s
   (`IDLE_CONFIRM_MS`, the time before the hold ended counts): the cap is lifted, reason `idle`. Nobody watches a
   republish. The 15 s are there because a publication that is replaced (a reconnection, a codec change) is away for
   one reading: lifting on that one would be a trial with no proof, on a link that just failed its health check. Two
   encoders sending the camera at once (a publication overlapping its successor) are a camera to protect that cannot
   be read: the detector waits for one. The stats store stops ticking when nothing is published, so the wiring arms a
   timer for whichever ends later, the hold or the 15 s, and clears it when a camera is read again or the cap goes.
2. A screen share is running: wait.
3. Otherwise the cap is lifted, reason `recovered`, when the last 30 live samples taken while capped (LiveKit, one
   encoder, frames delivered, at least one active layer) hold at most 3 limited samples, a mean `uploadLossRatio` of at
   most 0.02 (over the samples that report it), and the latest `availableOutgoingBitrate`, when reported, is at least
   400 kbps. The last is a veto only: a high estimate never shortens the hold, and in the readings it never stopped a
   lift. Samples of a camera nobody watches neither advance nor clear that window.

A cap that comes back within 10 minutes of live time after a lift (the time between consecutive eligible samples, each
step counted for at most 2 s, so that idle time and a throttled tab do not count) was a failed trial: the level goes up
by one. A lift that survives 10 minutes of live time resets the level to 0.

Measured on 2026-11-25 (one run per rate, with the first trigger; see below): every lift came 300 to 301 s after its
cap, as `recovered`: the capped camera looked healthy on every link. In the seven runs where the shaping stayed on (600
kbps to 1.3 Mbps and the switching link), a new cap followed 46 to 58 s after the lift. Each such lift cost the viewer
two pauses (at the lift and at the next cap) and 46 to 58 s without the cap. Whether those seconds were a worse picture
depends on the link. At 600 kbps they were (and perhaps at 700 kbps: mixed). At 1 and 1.3 Mbps, where the new rule would
not cap (the estimate was 717 to 1244 kbps in the first two batches; seen once at 1 Mbps in the third batch, no cap in
300 s; derived at 1.3 Mbps), the uncapped picture was the better one and only the pauses cost.
The holds would repeat all this at 5, 10, 20 and then every 60 minutes. Where the shaping was removed (a 1 Mbps and a
600 kbps link), no new cap came in 150 s, and the 720p layer was back 12.0 s and 4.7 s after the lift. The estimate
while capped tells a weak link from a recovered one only roughly. The rule is unchanged for now; what to do about it is
T-338 in [`docs/TODO.md`](../../TODO.md).

### The user wins

Two things take the cap off by hand, and each clears the cap, the notice, the pending timer, the windows and the level
(`media.camera_cap.changed` with `cleared`, and a reason that tells them apart); the second has two gestures, with one
reason:

- A change of the saved camera quality, to any value: reason `setting`. The camera then follows the quality the user
  chose.
- Choosing the selected quality again under a cap, by a click, a tap, Space or Enter: reason `manual`. The Media pane
  keeps the saved choice selected under the cap and passes `onreselect` to the choice only while the cap is on; it calls
  `requestUplinkCapClear` (`UplinkCap.ts`), and the detector, which listens, clears the cap as it does for a change of
  the saved quality. The saved quality stays as it was. Outside a cap, choosing the selected quality again does nothing,
  here and in every other choice of the preferences. The note under the choice says how to go back.
  The same pane shows a small button, "Try now", under the note, only while the cap is on. It puts the focus on the
  chosen option and calls `requestUplinkCapClear`, with the same reason `manual`. The note is a polite live region
  (`aria-live="polite"`, `aria-atomic="true"`), so its new text is announced by design; it has not been heard in a
  screen reader yet (T-341 in [`docs/TODO.md`](../../TODO.md)).

Either way the detector starts over, as after a change of the quality: on a link that is still weak the cap can come
back after the warm-up and the window (45 samples), at level 0, with the toast again. There is no quiet period after a
manual clear: it is the user's own call each time.

### What it does not cover

- **P2P**: `RemotePeer` is unchanged, and a P2P sender is never eligible. There is one encoder per peer, and the
  relief there is the move to LiveKit (see `CpuLimitationDetector.ts`).
- **Firefox and Safari** report no `qualityLimitationDurations`: `bandwidthLimitedRatio` is undefined, no sample is
  ever limited, and the feature is inert by design.
- **The SVC fallback** (VP9 and AV1 on an older LiveKit server, or in Safari and iOS): one stream carries its layers, so
  there is a single active layer and no reading is eligible. "low" is also a single stream there.
- **Screen share**: never capped. Its running keeps the camera from being capped and from being lifted as `recovered`;
  a camera that is away is still lifted as `idle`.
- **Cameras the line was not worked out for**: 549 kbps is 90 % of the 610 kbps that the 360p and 180p presets ask for
  on a 16:9 camera captured at 960 px or more on its long side (the front asks for 1280x720). A 4:3 camera gets presets
  that ask for 455 kbps (330 + 125), and one captured under 960 px publishes a single layer under the largest, asking
  for 160 kbps (taken from the presets of `livekit-client`, not measured). The line is too high for both, so the cap
  errs toward capping there. Only a 16:9 camera at 720p was measured (a fake camera fed from a 720p clip).

### Measured on 2026-11-25

Two batches of readings on one build, one run per rate, on a loaded host, made with the **first version of the rule**: a
sample counted toward the cap whenever the largest layer was limited, whatever the estimate. That rule capped the 1 and
1.3 Mbps links, where the cap made the picture worse, and the rule in "Trigger" was written because of the readings. A
third batch, at the end of this subsection, ran the new rule: once each at 600 kbps, 800 kbps and 1 Mbps, and in one
recovery from 600 kbps (the first half of T-337 in [`docs/TODO.md`](../../TODO.md); the second half is open). What is
said about the new rule outside that part is worked out from the first two batches, not seen, unless it says that the
third batch saw it. Read the tables as where to look, not as thresholds. The raw readings and the rig are on one Mac
only (`.local/konclui/work/uplink-rig/`, git-ignored); T-339 moves the rig into the repository.

**How it was measured**

- Build: QA candidate `candidate-0d2d32496128` (commit `77eed1271`, the first version of the cap). Two headless Chromium
  159 (Playwright 1.65.1, Linux arm64) in two containers on the QA docker network, one conversation of two users through
  LiveKit server 1.13.11 (one node, same network). The back ran with `MAX_USERS_FOR_WEBRTC=1`, so that a pair uses
  LiveKit.
- Sender: a fake camera fed from a looping 1280x720 30 fps clip, saved quality "recommended", VP9 simulcast with three
  layers (720p 700 kbps, 360p 450 kbps, 180p 160 kbps; software libvpx). Viewer: camera off, the sender's tile kept full
  screen, so that all three layers are asked for.
- Shaping: a `tc` token bucket on the egress of the sender's container (the rate as stated, a 300 ms queue, plus 25 ms
  of delay), set from the Colima VM. Everything the sender uploads goes through it, signalling included. Each run: 60 s
  unshaped after the three layers are up, then the shaping, then the wait for the cap, the lift (5 minute hold) and the
  next cap.
- Readings: `RTCPeerConnection.getStats()` once a second on both pages (not through the product), the detector's own
  console lines for the cap and the lift, and a 100 ms clock on the viewer's decoded frames for the pauses.
- Rates: 600, 700, 800 and 900 kbps, 1, 1.3 and 2 Mbps, a link switching between 800 and 1400 kbps every 20 s, and two
  runs where the shaping was removed 100 s after the cap (1 Mbps and 600 kbps).
- Host: the Mac was loaded by other work (mean load average 10 to 68, up to 216 at its peak, on 10 cores). The rig draws
  the game at 5 pictures a second to leave CPU to the encoder, and the 720p layer still ran at about 20 frames a second
  instead of 30. A run is marked "noisy" when it had freezes before any shaping or a stats poll that drifted (95th
  percentile of its period above 1.1 s): the 700 and 800 kbps runs and the 600 kbps recovery run.
- Not measured: Firefox, Safari, VP8, the "high" setting, a real camera, a real radio link, more than one viewer, a quiet
  host, anything between the rates listed (nothing between 700 and 800 kbps).

**What the viewer gets, with the cap and without it**

"Estimate" is `availableOutgoingBitrate` of the selected candidate pair (kbps: min to max, median). Without the cap, two
periods were read: "before" is the 12 to 14 s between the shaping settling and the cap, "trial" the 39 to 45 s between a
lift and the next cap (the steadier of the two); where they differ both are given. With the cap is the first hold.

| Link | Estimate, without the cap | 360p layer's target, without the cap (before; trial) | Viewer, without the cap | Viewer, with the cap |
| --- | --- | --- | --- | --- |
| 600 kbps | before: 410 to 499, 429; trial: 369 to 518, 420 | 213; 205 | 360p 43 % of the time before, 67 % in the trial, else 180p; 6 freezes in 39 s; video loss up to 23 %; audio 1.2 % concealed before the cap | 360p 93 % at 235 kbps and 15 fps; audio clean; one freeze of 11.7 s, 24 s after the cap, cause unknown |
| 700 kbps (noisy) | before: 468 to 598, 520; trial: 225 to 602, 433 | 305; 231 | 360p 100 % before (319 kbps); 30 % in the trial, 17 freezes (11 s) | first hold: 360p 51 %, 46 freezes (24 s); second hold: 360p 100 % at 246 kbps |
| 800 kbps (noisy) | before: 358 to 539, 460; trial: 418 to 713, 583 | 239; 349 | 360p 75 % before; 100 % in the trial (340 kbps, 18 fps) | first hold: 360p 58 to 62 %, 46 freezes (22 s) |
| 900 kbps | before: 454 to 703, 589; trial: 554 to 812, 695 | 350; 433 | 360p 17 % before (the estimate was still coming down); 100 % in the trial (413 kbps, 20 fps) | 360p 98 % at 243 kbps and 15 fps |
| 1 Mbps | before: 717 to 947, 783; trial: 733 to 921, 817 | 450; 450 | 360p 100 % (454 kbps, 20 fps), no freeze | 360p 100 % at 254 kbps and 15 fps |
| 1.3 Mbps | before: 986 to 1211, 1048; trial: 917 to 1244, 1086 | 450; 450 | 360p 100 % (438 kbps, 20 fps) | 360p 100 % at 247 kbps and 15 fps |
| 800 / 1400 kbps, switching every 20 s | not broken down | not broken down | before: 180p 100 %, 9 freezes; trial: 360p 100 % (411 kbps, 20 fps) | 360p 100 % at 247 kbps and 15 fps |
| 2 Mbps | 946 to 2319, 2222 | 420 | 720p 82 % of the time | not capped: no cap in 300 s (14 limited samples of 292) |

The 360p layer's target is in kbps, of the 450 kbps that the layer asks for. Without the cap, audio was clean at every
rate but 600 kbps; with the cap, it is noted only at 600 kbps (clean).
Unshaped (the first 60 s of every run) the estimate was 2410 to 2966 kbps, and the viewer got 720p at about 700 kbps
and 20 to 22 frames a second.

In every shaped run of the first two batches, from 600 kbps to 1.3 Mbps, the largest layer's `bandwidthLimitedRatio` was
at or above 0.5 in every sample read (11 to 13 samples before the cap, 25 to 44 in the trial), starting 1 to 3 s after
the shaping (the third batch, below, had 19 of 20, 298 of 299 and 297 of 298): Chrome does
report a simulcast layer that the allocator switched off as bandwidth-limited, and the 720p layer sent nothing in those
periods. "Limited" alone therefore says nothing about the layers under the largest one.

**Time to the cap, the pauses and the lift**

| Run | Shaping to cap | Pause at the cap / at the lift / at the next cap (ms) | Lift to next cap |
| --- | --- | --- | --- |
| 600 kbps | 20 s | 470 / 1199 / 1499 | 47 s |
| 700 kbps (noisy) | 19 s | 726 / 1798 / 2223 | 58 s |
| 800 kbps (noisy) | 19 s | 2473 / 1406 / 2023 | 52 s |
| 900 kbps | 19 s | 3010 / 699 / 3598 | 47 s |
| 1 Mbps | 20 s | 476 / 424 / 623 | 49 s |
| 1.3 Mbps | 18 s | 934 / 767 / 500 | 46 s |
| 800 / 1400 kbps, switching | 26 s | 1849 / 501 / 518 | 46 s |
| 1 Mbps, shaping removed 100 s after the cap | 19 s | 617 / 517 / no new cap | no cap in 150 s (0 limited samples of 176); 720p back 12.0 s after the lift |
| 600 kbps, shaping removed 100 s after the cap (noisy) | 65 s (24 samples were CPU-limited) | 5788 / 1815 / no new cap | no cap in 150 s (9 limited of 167); 720p back 4.7 s after the lift |

- In the first two batches the cap came 18 to 20 s after the shaping on a call already running (the window already held
  30 unlimited samples, and 18 limited ones are needed), 26 s on the switching link, and 65 s in the noisy 600 kbps
  recovery run, where 24 samples were CPU-limited. After a lift the next cap came 46 to 58 s later (15 warm-up samples,
  then 30).
- A pause is the longest time with no new decoded frame on the viewer, from the cap or the lift (the camera is published
  again). In the first two batches 13 of the 25 pauses were under 1 s, the longest 5.8 s (a noisy run); the third batch,
  below, saw longer ones.
- In the first two batches every lift came 300 to 301 s after its cap, as `recovered`. In the seven runs where the link
  stayed shaped, the next cap followed.

**The estimate while capped**

| Link while capped | Estimate while capped (kbps: min to max, median) |
| --- | --- |
| 600 kbps | 367 to 632, 626 (first run); 202 to 628, 477 (recovery run, noisy) |
| 700 kbps (noisy) | 158 to 703, 602 |
| 800 kbps (noisy) | 118 to 768, 722 |
| 900 kbps | 665 to 732, 702 |
| 1 Mbps | 762, constant for the whole hold; 849, constant, in the recovery run |
| 1.3 Mbps | 1065, constant |
| 600 kbps, then unshaped | 621 to 966 after the shaping was removed, median 966 |
| 1 Mbps, then unshaped | 849, unchanged for the 3 minutes after the shaping was removed |

- The capped camera sends about 335 kbps. On the links of 600 to 900 kbps the medians of the estimate were 477 to 722
  kbps, so it moved. On the 1 and 1.3 Mbps links it sat still. It did not climb when the 1 Mbps link came back (849 stayed
  849), and it did at 600 kbps (median 966).
- So the capped estimate tells a weak link (medians of 477 to 722 kbps) from a recovered one (849 to 966 kbps) only
  roughly: the ranges overlap (118 to 768 kbps on weak links, 621 to 966 after the shaping was removed). The 400 kbps
  veto of the lift never stopped a lift.

**What the cap buys**

At 600 kbps the cap helped, in one run: a steady 360p (93 % of the time, 235 kbps) and clean audio, against 360p 43 to
67 % of the time with freezes, loss and concealed audio, when the 360p layer's target was 213 and 205 kbps of 450. At 1
and 1.3 Mbps it hurt: the layer's target was 450 kbps, the viewer already got 360p all the time at about 450 kbps and 20
fps, and the cap gave about 250 kbps and 15 fps, plus the pauses. At 800 and 900 kbps the viewer got 360p all the time
in the trial periods (340 and 413 kbps) but not right after the shaping (75 % and 17 %); at 700 kbps the two periods
disagree, and the 700 and 800 kbps runs are noisy. Every cap and every lift of those two batches put a pause of 0.4 to
5.8 s on the viewer (the third batch, below, saw longer ones), and where the shaping stayed on each lift was followed by
a new cap: at 1 and 1.3 Mbps that cost only the pauses, at 600 kbps it also cost 46 to 58 s of a worse picture. So the
cap is worth taking only where the 360p layer itself starves, and the estimate tells the two cases apart only roughly
(369 to 518 kbps where the cap helped, trial medians of 583 kbps and up where it did not). One run per rate on a loaded
host says where to look, not where the line is.

**The new rule in a browser (third batch)**

Build: QA candidate `candidate-d116c5893900`, commit `9808a3cae` plus the change of the trigger, committed afterwards as
`ea3511151` (a limited sample counts toward the cap only when the estimate is under
`CAP_ESTIMATE_LINE`, 549 000 bits per second). The bundle that was served held the new console text. Same rig, same
clip, same shaping and same loaded Mac as above, one run per rate. "Under the line" is a sample whose estimate was under
549 kbps. Estimate and viewer are those of the periods without the cap (kbps: min to max, median). In this part "trial"
is the time without the cap between the lift and the next cap (86 s in the 600 kbps run, not the 39 to 45 s above); the
readings give its length only for the layer's target (60 s). The 800 kbps run was not marked noisy when it was read, but
it had 10 freezes before the shaping, which the definition of "noisy" above counts.

| Run (host load: mean / max) | What the rule did | Samples under the line | Estimate | What the viewer got |
| --- | --- | --- | --- | --- |
| 600 kbps (noisy; 34 / 112) | Capped 21 s after the shaping; lifted 302 s after the cap; capped again 86 s after the lift | Before the cap, 19 of 20 samples limited; not broken down by the line | Before: 388 to 559, 427; trial: 265 to 459, 348 | Before: 360p 57 % of the time, else 180p. Trial: 360p 7 %, 180p 93 %, 13 freezes (6.2 s) |
| 800 kbps (29 / 92) | Not capped in the 300 s that the run waited | 298 of 299 limited; 49 of them under the line (16 %) | 405 to 748, 601 | 360p 98 % of the time at 353 kbps and 19 fps; 13 freezes (3.6 s; 10 freezes, 4.4 s, in the unshaped minute before: the host) |
| 1 Mbps (14 / 23) | Not capped in 300 s | 297 of 298 limited; 18 of them under the line (6 %) | 379 to 947, 778 | 360p 92 % of the time at 413 kbps and 20 fps; 10 freezes (4.2 s) |
| 600 kbps, shaping removed 100 s after the cap (noisy: 35 CPU-limited samples, one codec demotion by the CPU detector; 17 / 33) | Capped 20 s after the shaping; lifted 301 s after the cap as `recovered`; no new cap in the 150 s that the run waited (6 limited samples of 146) | Before the cap, 18 of 18 samples limited; not broken down by the line | Before: median 428 | Before: 360p 67 %, else 180p |

- The 360p layer's target (of 450 kbps) was 213 kbps before the cap at 600 kbps and 0 in its trial (the layer sent
  nothing for 15 of 60 s), 357 at 800 kbps and 450 at 1 Mbps.
- With the cap at 600 kbps: 360p 68 % of the time in the first hold (37 freezes, 21.3 s; the host was at its busiest,
  load up to 112) and 100 % at 241 kbps in the second; in the recovery run, 360p 100 % at 246 kbps and 15 fps, 6 freezes
  (1.7 s). Audio was clean in all of them (0 to 0.1 % concealed). In the recovery run the 720p layer was back 8.3 s
  after the lift.
- **Four of the five pauses of this batch (8.0 to 24.9 s) were longer than the longest of the first two batches (5.8 s;
  those 25 pauses ran from 424 to 5788 ms), and the cause was not isolated.** The fifth, 1.4 s, was inside the old
  range, and none was under 1 s (13 of 25 were). At the cap: 1400 ms (600 kbps) and 8625 ms (recovery run). At the lift:
  24,905 ms (600 kbps, with the shaping still on: the lift published the full ladder again on a link that had not
  recovered) and 8026 ms (recovery run, the shaping removed). At the next cap: 10,909 ms (600 kbps). The host load is
  the only difference known, and it was not isolated. The 24.9 s pause and the trial after it (180p 93 % of the time, a
  new cap 86 s after the lift, against 46 to 58 s in the first two batches) are what a lift cost the viewer on a link
  that was still shaped, once (T-338).

What it shows, once each and on a loaded host: the new rule capped at 600 kbps as fast as the first rule did (21 s and
20 s, against 20 s), and left the 800 kbps and 1 Mbps links alone, where the first rule had capped after 19 and 20 s. At
800 kbps the estimate was under the line in 16 % of the samples, well under the 60 % that a cap asks for: what the first
two batches left open (a link just shaped being capped at 800 kbps all the same) did not happen in this run. The
recovery at 600 kbps went as in the earlier one (a lift, no new cap in 150 s; 720p back 8.3 s after the lift, against
4.7 s), with a longer pause at the lift.

What it still does not show: 700 and 900 kbps, where single seconds fall on both sides of the line, 1.3 and 2 Mbps and
the switching link under the new rule, and anything on a quiet host. One run per rate cannot say how often a link near
the line would be capped, and the longer pauses are not explained.

## Technical Notes

- **VideoQuality enum**: `LOW` (0), `MEDIUM` (1), `HIGH` (2), maps to LiveKit simulcast layers. The front only uses
  `MEDIUM` (see Subscriber side).
- **Congestion control** still applies on top of every cap: the browser lowers the actual bitrate when the network
  cannot carry it, and libwebrtc lowers resolution or frame rate when the CPU cannot keep up (reported as
  `qualityLimitationReason` in the encoder stats and in the video quality analytics).
- **Dynamic updates**: on P2P the quality setting is applied at every encoding update. On LiveKit a change of the
  camera setting publishes the camera again; a change of the screen share setting reaches it at its next publication.

## Future work

Left for later: persisting a demotion across sessions with an expiry, an encode-time-per-frame signal for Firefox,
and asymmetric codecs in P2P (a desktop sending VP9 to a phone that decodes it in hardware while the phone sends
H.264), which needs each peer to signal what it can encode before the offer.

## Related Files

| File | Purpose |
|------|---------|
| [`play/src/front/WebRtc/VideoPresets.ts`](../../../play/src/front/WebRtc/VideoPresets.ts) | Codec preferences, bitrate curves, frame rates |
| [`play/src/front/WebRtc/VideoPresets.test.ts`](../../../play/src/front/WebRtc/VideoPresets.test.ts) | Fit against the reference table, codec scaling, codec filtering |
| [`play/src/front/WebRtc/CodecPerformance.ts`](../../../play/src/front/WebRtc/CodecPerformance.ts) | What the browser knows about each codec: hardware, past smoothness |
| [`play/src/front/WebRtc/AdaptiveVideoEncoding.ts`](../../../play/src/front/WebRtc/AdaptiveVideoEncoding.ts) | P2P encoding from the viewer's display size |
| [`play/src/front/Livekit/LiveKitRoom.ts`](../../../play/src/front/Livekit/LiveKitRoom.ts) | LiveKit publisher codec and bandwidth limiting |
| [`play/src/front/Livekit/LivekitParticipant.ts`](../../../play/src/front/Livekit/LivekitParticipant.ts) | LiveKit subscriber quality selection |
| [`play/src/front/WebRtc/RemotePeer.ts`](../../../play/src/front/WebRtc/RemotePeer.ts) | P2P codec preference, bandwidth limiting, viewer hint |
| [`play/src/front/WebRtc/CpuLimitationDetector.ts`](../../../play/src/front/WebRtc/CpuLimitationDetector.ts) | Codec demotion when the encoder is CPU-limited |
| [`play/src/front/WebRtc/UplinkLimitationDetector.ts`](../../../play/src/front/WebRtc/UplinkLimitationDetector.ts) | Camera cap to "low" when the largest layer is limited and the estimate is under 90 % of what the 360p and 180p layers ask for, and its recovery |
| [`play/src/front/WebRtc/UplinkCap.ts`](../../../play/src/front/WebRtc/UplinkCap.ts) | The session-only cap and notice stores, and the effective quality |
| [`play/src/front/Stores/MediaStore.ts`](../../../play/src/front/Stores/MediaStore.ts) | Camera quality store, and the effective quality (saved, or capped) |
| [`play/src/front/Stores/ScreenSharingStore.ts`](../../../play/src/front/Stores/ScreenSharingStore.ts) | Screen share quality store |
| [`play/src/front/Components/Menu/SettingsSubMenu.svelte`](../../../play/src/front/Components/Menu/SettingsSubMenu.svelte) | User settings UI |
