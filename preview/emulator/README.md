# Muse for Watch — live web emulator

This is the browser integration harness for the Apple Watch SE 2, 44 mm experience. It reuses the approved animation renderer and its 368 × 448 canvas. Browser display scaling is responsive; this does not emulate watchOS performance, physical display characteristics, haptics or battery use.

## Run

From `backend/`, run `npm start` after `npm run build`. In another terminal in `backend/`, run `npm run emulator`. Open http://127.0.0.1:4174/preview/emulator/ . Both processes must stay running. Configure credentials using the backend setup instructions, never in browser JavaScript.

## Use

- Tap the head, grant microphone permission, speak, then tap again to send. Recording ends automatically at 60 seconds.
- Actual microphone volume enlarges the head. No decorative audio waves are shown.
- Meta transcribes the mono WAV and handles the conversation. A typed request exercises the same agent without recording.
- Browser speech reads replies; the head speaks during playback and returns to idle afterward. Tap to interrupt. Voice quality depends on installed system voices; mouth movement is expressive animation, not phoneme-level lip sync.
- Event proposals show exact title, times and timezone beside the watch. Confirm explicitly or cancel. Uncertain saves retain the same action for verification/retry.
- The state log exposes backend progress. Simulation mode is clearly labelled if the backend uses it.
- Hiding the page discards an unfinished recording. Raw microphone audio is held only in memory; failed uploads retain the same recording for an explicit retry.

The separate design lab remains at `/preview/animation/` and uses scripted interactions. The emulator uses real backend results.

## Calendar and limitations

Google OAuth credentials and the user's consent are required to connect Calendar. Meta alone can chat and propose events, but cannot save or read a disconnected Calendar. Use the connect button after configuring Google in the backend. API keys and bearer authentication remain on the loopback gateway, not in the page.

The conversation sidebar is a debugging aid, not the final watch screen. The watch itself contains only the character and status line. Native microphone capture, audio routing, networking, background behavior and rendering still need testing on the physical watch.

## Verification — 26 October 2026

- Live browser request reached Meta and rendered a spoken reply, then returned to idle.
- Live lunch proposal displayed exact event details; cancellation returned “nothing changed.” No event was saved.
- Four audio tests pass: 16/48 kHz input conversion, clipping protection, and final worklet buffer flush.
- Existing renderer checks and 25 backend tests pass; backend typecheck/format pass.
- Gateway checks reject cross-origin API requests, missing emulator header and access to backend `.env`.
- Physical microphone capture in this browser remains for the user's first hands-on test. Calendar writes remain unverified until Google is connected.

Run `node --test preview/emulator/audio.test.mjs` and `node preview/animation/check.cjs` from the repository root; run `npm test` in `backend/`.
