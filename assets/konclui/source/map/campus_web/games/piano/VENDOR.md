# Piano vendor notes

**Nothing is copied here: the synth is our own small Web Audio code** in `index.html`. The suggested library was evaluated and set aside.

- **Evaluated:** https://github.com/keithwhor/audiosynth (11.5 KB engine)
- **Commit:** `d6eb4b0fa567ee276bfc6bda682dcba4dae7afe1` (2019-04-21, shallow clone in `.scratch/office-redesign/vendor-src/audiosynth/`)
- **License:** MIT, Copyright (c) 2013 Keith William Horwood.

## Why it was not used

`audiosynth.js` renders every (note, octave, duration) into a WAV blob on the main thread and plays it with `new Audio(url).play()`: one media
element per key press, the start latency of an `Audio` element, no velocity, no way to damp a note when the key is released, no polyphony control. For
a keyboard that has to feel immediate with several fingers and has to stay in step with the pre-rendered samples of the map, a buffer-based Web Audio
synth is smaller and simpler than adapting it.

## What is ours

- **Sound:** `render(midi)` builds a 1.2 s mono buffer at 22.05 kHz (5 harmonics with their own decay, a slight inharmonic stretch, a second string
  3 cents sharp, 4 ms attack, short fade-out), cached per note and rendered ahead one note at a time after the first gesture. A key plays a buffer through a gain
  (velocity) into a compressor; releasing the key damps it after at least 0.3 s. At most 24 voices.
- **Same recipe as the map:** `make_samples.py` renders the very same notes to `media/sounds/piano/<midi>.mp3` (midi 60 to 84) for people walking near the
  piano without the page open (`python3 map/campus_web/games/piano/make_samples.py`, stdlib + ffmpeg, VBR quality 2, about 6 KB per file, 143 KB the 25).
  Checked: the JavaScript and Python renders of C4, C5 and C6 differ by less than 1e-7 per sample. If a constant changes, change both.
- **Keyboard:** 25 keys (C4 to C6) as DOM elements; mouse and fingers by pointer events (several at once, sliding plays each key crossed, a lower hit is
  louder); computer keys by `event.code`: A S D F G H J K L Ç and W E T Y U O P play C4 to E5, Z and X move that window one octave (to reach F5 to C6).
- **Sharing:** every note played sends `KG.event.send("piano:nota", { n: 60..84, v: 0..1 })` and nothing else, at most 12 per second per page (extra notes
  still sound locally). Notes from others are validated (integer `n` in range, `v` in 0..1, at most 40 per second accepted), light the key for 0.4 s and play.
  Events carry no sender name, so the line "quem está tocando" says only "Você", "Alguém" or both.
- **Audio only after a gesture:** the `AudioContext` is created on the first key or touch. A page that only listens (a note arrives before any gesture) lights keys
  and stays silent without errors.
- `window.__game`: `audio()` (`none` | `suspended` | `running`), `lit()`, `base()`, `labels()`, `voices()`, `stats()` (`sent`, `dropped`, `received`), `keys()`.
