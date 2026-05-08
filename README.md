# Hold Still

Can you?

A tiny one-screen experiment that records ten seconds of how *not* still your
hand is, then bends the seismograph into your tremor's fingerprint.

→ **[hold-still-app.vercel.app](https://hold-still-app.vercel.app)**

## What it does

1. You tap **Begin** on a phone (or rest a hand on a mouse).
2. For ten seconds the screen is your live waveform — gyro on iOS, mouse
   deltas on desktop.
3. The waveform morphs inward and curls into a circular fingerprint derived
   from your dominant tremor frequency, amplitude, and asymmetry across axes.
4. You get a 1080×1080 PNG and a permalink with the feature vector packed
   into ~30 bytes — paste the URL anywhere, the fingerprint regenerates.

No backend. No DB. No accounts. The thing you record never leaves your phone.

## Stack

- Vite + TypeScript, vanilla `<canvas>` (no React — overkill for one screen
  and it complicates 60 fps drawing)
- Single-pole IIR low-pass + high-pass + deadband to suppress sensor noise
- Radix-2 Cooley–Tukey FFT, dominant-frequency / spectral-spread / kurtosis
  features per axis
- Permalink: 16-bit quantized features → base64url → `?f=…`
- Deployed on Vercel

## Run it

```bash
npm install
npm run dev
```

Open the LAN URL on your phone. Note: iOS gyro requires HTTPS, so for the
real demo deploy a preview (`vercel deploy`) or use a tunnel.

## Why

Because everyone's hand has a signature you've never seen.
