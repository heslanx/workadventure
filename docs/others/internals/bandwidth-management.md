# Bandwidth Management

WorkAdventure lets users control the bandwidth of their camera and screen share through a quality setting. This
document explains how that setting turns into a codec, a bitrate and a frame rate, on both P2P (WebRTC) and LiveKit
connections.

Everything described here lives in
[`play/src/front/WebRtc/VideoPresets.ts`](../../../play/src/front/WebRtc/VideoPresets.ts), which is the single
source of truth for codec preferences and bitrate budgets. The two transports only call it.

## Overview

Bandwidth management operates at two levels:

- **Publisher side**: chooses the codec and caps the bitrate and frame rate of the outgoing camera and screen share.
- **Subscriber side**: asks for a quality level of incoming streams (LiveKit simulcast layer, or a P2P bitrate hint).

Users choose between three quality levels, separately for the camera and the screen share:

1. **Low**: minimal bandwidth, and the cheapest codecs (suitable for poor connections and weak machines)
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
screen share should keep its resolution or its frame rate. It is applied on both transports and is not covered
further here.

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

- **Desktop**: the codec is kept unless the browser remembers it as *not smooth* at that frame size (see below). With
  no verdict, it is kept.
- **Android and iOS**: the codec is kept only if the browser reports a hardware encoder (or decoder) for it, and it is
  smooth. With no verdict, it is dropped: a phone does not experiment on its battery.
- A codec dropped for smoothness gets **one retry per week**, so a single bad session cannot demote it forever.

So a Pixel with a hardware VP9 encoder keeps VP9; a phone without one encodes H.264; a weak laptop that struggled with
VP9 at 720p last week gets H.264 in P2P, and on LiveKit gets VP8 unless its H.264 is hardware.

### What the browser knows: `CodecPerformance.ts`

At startup, [`CodecPerformance.ts`](../../../play/src/front/WebRtc/CodecPerformance.ts) asks
`navigator.mediaCapabilities.encodingInfo()` and `decodingInfo()` with `type: "webrtc"` about AV1, VP9 and H.264 at
three frame sizes, 720p, 1080p and 1440p. That is a few milliseconds of lookups, no encoding. The answers are
cached and read synchronously afterwards; until they arrive, the lists behave as if there were no verdict.

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

  The end-to-end test `tests/webrtc_codecs.spec.ts` checks what each side of a bubble encodes, with Bob in
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
load is gone, would bounce the bubble), so the next bubbles start on LiveKit without paying the window again. The
transport switch resets the detector's window; if the back cannot switch (no LiveKit, or
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
  for the whole room (turning the camera off pauses it, see `unpublishCameraTrack()`): a demotion is the one time it
  is really unpublished.
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
changes. The end-to-end test `tests/webrtc_cpu_limitation.spec.ts` (opt-in, `RUN_CPU_LIMITATION_E2E=1`, a few
minutes) drives the whole chain on a deployment by making one page report every outbound video stream as
CPU-limited: three users in a bubble, the flag, the switch to LiveKit, the bubble staying there when a member
leaves, then the camera republished in VP8 (Chromium on Linux has no hardware H.264 for LiveKit); with
`CPU_LIMITATION_EXPECT=demote` it checks the codec
renegotiation with both peers instead.

## Bitrate Budget

`selectVideoPreset(displayHeight, displayWidth, isScreenShare, quality, codec)` returns the `maxBitrate` and
`maxFramerate` to apply to an encoder producing frames of that size.

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
setting: 720p for "low", 1080p for "recommended", 1440p for "high". Nothing downstream lowers the resolution of a
screen share, so this cap is what bounds the encode cost of a 4K display.

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
- Elsewhere, VP9 and AV1 cameras go out as SVC: one stream, `L3T3_KEY`, that always carries its three layers. A screen
  share is always one `L1T3` stream. The SVC `maxBitrate`
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

- Maps the quality setting to the `VideoQuality` enum via `getVideoQualityFromSetting()`:
    - `"low"` → `VideoQuality.LOW`
    - `"recommended"` → `VideoQuality.MEDIUM`
    - `"high"` → `VideoQuality.HIGH`
- Calls `publication.setVideoQuality()` when subscribing to remote camera and screen share tracks, which selects the
  simulcast layer the server forwards.

## Uplink Cap: Automatic Camera Downgrade

**Files**: [`play/src/front/WebRtc/UplinkLimitationDetector.ts`](../../../play/src/front/WebRtc/UplinkLimitationDetector.ts)
(decisions and wiring), [`play/src/front/WebRtc/UplinkCap.ts`](../../../play/src/front/WebRtc/UplinkCap.ts) (the two
stores)

On LiveKit the browser already switches the largest simulcast layer off when the uplink cannot carry it, but the app
keeps publishing the whole ladder (720p + 360p + 180p). libwebrtc then pads up to its bandwidth estimate to try to get
the layer back, so the link stays saturated (the audio shares it), and on a link near the threshold the layer flaps:
a keyframe and a freeze for every viewer at each switch. The manual "low" setting (captured at 360p, published as
360p + 180p) is the answer to that; the uplink cap applies it by itself, for the session only, and takes it back when
the link recovers.

Every threshold below is derived from libwebrtc's allocator rules and is **not yet measured on a shaped link**. The
`media.camera_cap.changed` analytics event exists to tune them.

### Trigger

The detector reads `localEncoderStatsStore.video` once a second (the poll is a timer and an async `getStats()`, so its
readings come 1000 ms apart give or take a few: one up to 100 ms early still counts), and decides from
`stats.encoders[]`: the aggregate the tiles show drops the fields it needs. A sample is limited when
`bandwidthLimitedRatio` is at least 0.5, that is, when the allocator could not fund the largest layer for most of the
second (`qualityLimitationReason: "bandwidth"`).

- **Eligible reading**: the source is LiveKit, there is exactly one encoder, it delivers frames (`captureFps` of 1 or
  more) and has at least two active layers (fewer means no largest layer to lose: a layer already off, or a room nobody
  watches, since dynacast pauses the layers nobody subscribes to), no screen share is running (it competes for the same
  uplink), and the saved quality is not "low". An ineligible or missing reading, a change of transport or of codec, and a
  layer that resumes (`activeLayers` going up, as dynacast does when a viewer joins: the bandwidth estimate was held near
  what the other layers send, and has to climb to fund it) clear the window and restart the warm-up.
- **Cap**: after a warm-up of 15 samples (the keyframe and the rate-control ramp-up of a new publication look like a
  weak link), at least 18 of the last 30 samples are limited. The earliest cap is therefore 45 s after a publication
  starts. A dip of ten seconds does not count; a link limited two thirds of the time does.

### Action

`uplinkCapStore` goes up, and `effectiveVideoQualityStore` (in `MediaStore.ts`, derived from the saved quality and the
cap) reads "low". The camera constraints and the LiveKit publication follow it, as for a camera set to "low": the
camera reopens at 360p, and `LiveKitRoom` unpublishes and publishes again as 360p + 180p. Viewers see the tile go off
for a moment, which is why caps and lifts are rare.

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
  `media.video_quality.sample`, whose `bandwidthLimitedRatio`, `activeLayers`, `uploadLossRatio` and
  `availableOutgoingBitrate` are what the decisions are made on.

### Recovery

While only 360p + 180p are sent, the bandwidth estimate is capped near 1.5 times what is sent, so it cannot prove that
the full ladder fits: lifting the cap **is** the probe. It is done rarely, after a hold measured on the wall clock
(the camera can be off meanwhile) and that grows with each trial that fails:

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
   400 kbps. The last is a veto only: a high estimate never shortens the hold. Samples of a camera nobody watches neither
   advance nor clear that window.

A cap that comes back within 10 minutes of live time after a lift (the time between consecutive eligible samples, each
step counted for at most 2 s, so that idle time and a throttled tab do not count) was a failed trial: the level goes up
by one. A lift that survives 10 minutes of live time resets the level to 0.

### The user wins

A change of the saved camera quality, to any value, clears the cap, the notice, the windows and the level
(`media.camera_cap.changed` with `cleared` and reason `setting`). Choosing a different quality is the way to take the
cap off by hand: the Media pane keeps the saved choice selected under the cap, and choosing it again is no change, so it
does nothing.

### What it does not cover

- **P2P**: `RemotePeer` is unchanged, and a P2P sender is never eligible. There is one encoder per peer, and the
  relief there is the move to LiveKit (see `CpuLimitationDetector.ts`).
- **Firefox and Safari** report no `qualityLimitationDurations`: `bandwidthLimitedRatio` is undefined, no sample is
  ever limited, and the feature is inert by design.
- **The SVC fallback** (VP9 and AV1 on an older LiveKit server, or in Safari and iOS): one stream carries its layers, so
  there is a single active layer and no reading is eligible. "low" is also a single stream there.
- **Screen share**: never capped. Its running keeps the camera from being capped and from being lifted as `recovered`;
  a camera that is away is still lifted as `idle`.

## Technical Notes

- **VideoQuality enum**: `LOW` (0), `MEDIUM` (1), `HIGH` (2), maps to LiveKit simulcast layers.
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
| [`play/src/front/WebRtc/UplinkLimitationDetector.ts`](../../../play/src/front/WebRtc/UplinkLimitationDetector.ts) | Camera cap to "low" when the uplink cannot carry the full ladder, and its recovery |
| [`play/src/front/WebRtc/UplinkCap.ts`](../../../play/src/front/WebRtc/UplinkCap.ts) | The session-only cap and notice stores, and the effective quality |
| [`play/src/front/Stores/MediaStore.ts`](../../../play/src/front/Stores/MediaStore.ts) | Camera quality store, and the effective quality (saved, or capped) |
| [`play/src/front/Stores/ScreenSharingStore.ts`](../../../play/src/front/Stores/ScreenSharingStore.ts) | Screen share quality store |
| [`play/src/front/Components/Menu/SettingsSubMenu.svelte`](../../../play/src/front/Components/Menu/SettingsSubMenu.svelte) | User settings UI |
