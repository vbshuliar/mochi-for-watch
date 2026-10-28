# Muse for Watch — live web emulator

This is the browser integration harness for the Apple Watch SE 2, 44 mm experience. It reuses the approved animation renderer and its 368 × 448 canvas. Browser display scaling is responsive; this does not emulate watchOS performance, physical display characteristics, haptics or battery use.

## Run

From `backend/`, run `npm start` after `npm run build`. In another terminal in `backend/`, run `npm run emulator`. Open http://127.0.0.1:4174/preview/emulator/ . Both processes must stay running. Configure credentials using the backend setup instructions, never in browser JavaScript.

### Use a deployed backend

The loopback gateway can proxy the same browser UI to your deployed backend. From the repository root, load the private connection environment and start only the gateway:

```sh
node --env-file=native/Local/fly.env backend/scripts/emulator-server.mjs
```

Set `EMULATOR_BACKEND_URL=https://your-app.fly.dev` in that process environment (or the private env file), and ensure `API_TOKEN` matches the deployed backend. For example, prefix the command above with `EMULATOR_BACKEND_URL=https://your-app.fly.dev`. No local backend process is needed. Open the same loopback emulator address; both HTTP requests and realtime WebSocket audio use the deployed backend. Authentication stays in the gateway and is never sent to browser JavaScript. OAuth and call webhooks continue using the deployed backend's configured public callback URLs.

`EMULATOR_BACKEND_URL` accepts an HTTPS origin or loopback HTTP origin, with no credentials, path, query or fragment. If omitted, the existing local backend at `http://127.0.0.1:${PORT:-8787}` is used. Keep private env files untracked.

## Use

- Tap the head, grant microphone permission, speak, then pause for about 0.9–1.7 seconds to send automatically (or tap again to send immediately). Recording ends automatically at 60 seconds. The watch shows listening, then thinking throughout transcription and processing, then the reply.
- Actual microphone volume enlarges the head. No decorative audio waves are shown.
- Meta transcribes live microphone audio while you speak, with WAV upload as a fallback, then handles the conversation.
- ElevenLabs Jessica reads replies; the head speaks during playback and returns to idle afterward. Tap during thinking or speech to interrupt and start a new recording. If autoplay is blocked, tap to hear the downloaded reply. Mouth movement is expressive animation, not phoneme-level lip sync.
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

## iPhone companion preview

Scroll the left device column below the watch to reach Jolly’s iPhone setup screen. There is one companion, no bot picker or additional-buddies placeholder. Connections add capabilities to Jolly; unavailable services remain placeholders. Calendar status is read from the same backend as the watch. Connect requests a Google consent link; check connection refreshes status; disconnect appears when an actual Google connection exists. These actions are recorded in the right-hand activity stream. Missing OAuth configuration shows a simple temporary-unavailability message; developer instructions never appear in the phone. This remains a single-user browser preview, not a native iPhone app or multi-user pairing flow.

### Calendar connection experience

Open Calendar → Connect with Google. The emulator opens Google sign-in in a new tab and checks connection status every 2.5 seconds for up to ten minutes. If the browser blocks the new tab, a Continue with Google link is shown instead. Returning focus also refreshes status. Declining consent does not save new access. The phone never exposes developer credentials or configuration steps.

### One-time developer setup

This is performed by the app developer, not each end user:

1. In Google Cloud, choose a project and enable Google Calendar API.
2. Configure Google Auth Platform Branding and Audience. For personal accounts use External, and add the test account under Test users while the app is in testing.
3. Create a Web application OAuth client. Register exactly `http://127.0.0.1:8787/oauth/google/callback` as an authorised redirect URI (or the deployed backend's configured URI).
4. Save its Client ID and Client secret privately in `backend/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Never put these in the phone UI or browser code.
5. Restart the backend. Users can now choose Connect with Google and grant consent.

See [backend configuration](../../backend/README.md#connect-live-providers) and [Google's server-side OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server). Public distribution needs the appropriate Google consent/verification process and real per-user authentication; the current backend is a single-user prototype.

## Conversation quality

See [research, timing measurements and regression cases](../../docs/research/conversation-ux.md). An empty recording ends locally after eight seconds; incomplete phrases get more pause time. Interrupted replies cannot take over the current UI. Requests remain serial on the backend; interruption aborts the old turn and waits for cancellation acknowledgement before the next is submitted. It does not undo external actions.

Conversational replies now stream in sentence clips; exact repeat/stop commands skip Meta reasoning. See [streaming design and verification](../../docs/streaming-replies.md).

## Web search

In live mode, current-information questions can use Meta web search. Source links appear in a compact expandable log row. The Web Search connection shows availability through Meta and requires no separate sign-in. See [implementation and verification](../../docs/web-search.md).

Flexible booking approval lists every allowed window separately (including multi-day requests). The date envelope is not a promise of continuous availability; Calendar busy periods further constrain the call.
