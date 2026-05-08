§1 — Architecture & stack
Working title: Hold Still
Stack: Vite + TypeScript, vanilla <canvas> for rendering (no React — overkill for one screen and it complicates 60 fps drawing). Static site, deploy to Vercel. Zero backend.
Why no backend: Single mind-blowing reveal, no leaderboard, no DB. Sharing is a downloadable PNG plus an optional URL hash that encodes the fingerprint params so others can land directly on someone's fingerprint without us storing it.
Modules (one file each):
input/ — two adapters (gyroAdapter.ts, mouseAdapter.ts) both emitting a normalized stream of {t, dx, dy, dz} samples at ~60 Hz.
dsp/ — high-pass filter (removes gravity / slow drift), windowed FFT, feature extractor (dominant frequency, RMS amplitude, axis asymmetry, spectral spread).
viz/seismograph.ts — live scrolling waveform during the hold-still phase.
viz/fingerprint.ts — end-of-session generative image derived from features.
app/state.ts — small state machine (landing → calibrating → recording → revealing → fingerprint).
share/ — PNG export, Web Share API, hash-URL encoder/decoder.


§2 — User flow
The experience is one screen, no navigation. Five state transitions:
Landing — single dark page. Centered: "Can you hold still?" Below: a big circular tap target labeled "Begin." Below that, fine print detects your input mode: "Reading from your phone's motion sensors" or "Reading from your mouse". The whole landing is the user gesture iOS needs — tap kicks off DeviceMotionEvent.requestPermission() on iOS, no-ops elsewhere.
Calibrating (2s) — quick "Hold the phone naturally" / "Rest your hand on the mouse." We capture the gravity vector and DC offset to subtract. UI: a soft pulsing ring counting down. If permission is denied, fall back to mouse mode with an explanation.
Recording (10s) — full-screen live seismograph. Three softly-colored traces (X/Y/Z, or just X/Y on mouse) scrolling right-to-left. A small countdown ring in a corner. Copy at the top: "Hold as still as you can." The waveform itself is the spectacle — nothing else on screen.
Revealing (~2s transition) — the seismograph traces collapse and bend, morphing inward into a circular form. This is the visual punchline — the linear waveform you watched for 20s reshapes itself into your unique fingerprint.
Fingerprint — the static artifact, centered, with a one-line caption: "This is your tremor. Everyone has one." Below: three buttons — Save image, Share, Try again. Behind the artifact, a faint readout: dominant frequency in Hz, amplitude in milli-g, sample count.
Failure modes:
iOS permission denied → toast "Need motion access on your phone — or move your mouse instead" + auto-flip to mouse adapter.
DeviceMotion fires but values are all zero (some Android browsers in private mode) → detect within 500 ms of recording, show same fallback.
Tab loses focus mid-recording → pause + "Come back to keep recording" overlay.

§3 — The tremor fingerprint
The core question: what does the unique image actually look like, and how do we derive it deterministically from the signal so it's both pretty and personal.
Features extracted from the 10s recording (per axis):
dominantFreq — peak bin in the 3–15 Hz band of the FFT
amplitude — RMS of the high-pass-filtered signal (in milli-g for phone, pixel-deltas for mouse)
spectralSpread — bandwidth around the peak (sharp peak = consistent tremor, wide = jittery)
axisAsymmetry — ratio of energy across X/Y/Z (you tremor more in some directions)
peakiness — kurtosis of the waveform (smooth wobble vs. spiky jerks)
That's a 12–15 dimensional feature vector per visitor.
The visual — a circular polar plot, 720 px square:
The 10-second waveform is bent into a closed loop around the center, like a clock face with one full rotation = 10 seconds.
Radial distance from center = instantaneous tremor magnitude.
Three semi-transparent overlapping traces (one per axis), each in a hue derived from that axis's dominantFreq (faster tremor = warmer color).
A faint outer ring is drawn whose thickness modulates with spectralSpread.
A small inner glyph — a hash of all features rendered as a 5×5 dot grid — gives every fingerprint a unique "seal" you can recognize at a glance.
Background: deep navy with subtle noise texture so screenshots look intentional, not screen-grabbed.
Why this works: the morph at the start of §2.4 is mechanical — we're literally bending the timeline you just watched into a circle. The user sees their own waveform become the ornament. That's the satisfying click.
Determinism: same input → same image, byte-for-byte. The URL hash encodes the feature vector (~80 bytes base64) so visiting /?f=<hash> reproduces the fingerprint without storing anything server-side.

§4 — Sharing
The share story has three layers, ordered by effort:
PNG download (must) — canvas → blob → <a download>. The image carries a tasteful watermark in the bottom corner: site name + the URL of the fingerprint (see #3). 1080×1080, looks good on Instagram and Twitter cards.
Web Share API (cheap, ~10 lines) — on mobile, "Share" hits the native share sheet with the PNG attached. On desktop, falls back to "Copy link." Detected via navigator.canShare.
Permalink with feature hash (the elegant bit) — the 12–15 feature numbers get quantized and packed into ~80 bytes, base64'd into /?f=<hash>. Visiting that URL skips the recording flow and renders the fingerprint directly with a header "Someone else's tremor" and a CTA "See yours". Tweetable, no DB needed, fully reproducible.
<meta property="og:image"> is set to a static OG card — not the dynamic fingerprint, since serverless OG image generation adds infra. Trade-off: tweets won't unfurl with the user's specific fingerprint, only a generic card. Acceptable for v1.
§5 — Scope (what we're explicitly not building)
No backend, no database, no leaderboard, no percentile comparisons
No accounts, no analytics beyond the bare minimum (one anonymized count is OK if you want)
No PWA / offline / install
No sound design (the tremor is silent — adding audio is a tempting rabbit hole)
No multi-language (English only)
No accessibility audit beyond basics (keyboard skip-link, reduced-motion respects prefers-reduced-motion by skipping the morph and showing a still fingerprint)
No A/B testing, no copy variants
Browser support: last 2 versions of Safari, Chrome, Firefox. Anything older gets a "this site needs a modern browser" page