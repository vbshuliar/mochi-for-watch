# Muse for Watch backend

Implemented 26 October 2026. This is the single-user Calendar MVP backend, runnable without an Apple Watch. It includes the real Meta and Google adapters plus an explicitly labelled local simulation. Live Meta reasoning and synthetic-audio transcription have been tested; Google Calendar is not connected. See [verification record](../docs/backend-verification.md). It is not a native watch app, public multi-user service, or an implementation of every stretch feature in the original brief.

## Run locally

Requires Node.js 24+ and npm. From this directory:

```sh
npm ci
npm run setup
npm run doctor
npm run dev
```

In a second terminal in this directory:

```sh
npm run demo
npm run chat
```

`setup` creates a private, ignored `.env` with random authentication and encryption keys. It never overwrites an existing file or prints keys. Default server: `http://127.0.0.1:8787`. It does not alter the animation preview on port 4173.

`demo` proposes, confirms and retries a simulated event, prints its receipt and timeline, then deletes the demo session. It refuses live mode. Mock calendar events remain in the local database so list/availability can be exercised. Mock mode has fixed phrases, not a real language model. Say `schedule demo lunch`, `list demo events`, or `check demo availability`. The lunch fixture is explicitly **tomorrow at 13:00 UTC**, not an approximation of local timezone conversion. Mock audio always transcribes to the demo phrase; it does not recognize speech.

`chat` supports `/yes`, `/no`, `/events` and `/quit`. It shows the full event title, start, end and timezone before confirmation. It retains the session for recovery. In live mode `/yes` really writes the proposed event to the connected primary Google calendar. Ordinary chat text, including “yes”, never bypasses the dedicated confirmation endpoint.

## Implemented boundaries

- Fastify HTTP API, strict Zod validation, bearer authentication, body/rate limits and private error responses.
- One configured user, with sessions, bounded conversation context, action receipts and a 100-entry per-session progress log.
- Meta chat completion planner and file transcription through the documented multipart WAV interface.
- Calendar intent parsing, clarification, event listing, availability lookup and one-event proposals.
- Explicit confirmation/cancellation, ten-minute approval expiry and superseding old unapproved proposals.
- Google OAuth state, PKCE, offline token refresh, narrow event/availability scopes and encrypted credentials.
- Stable Google event IDs, read-before-create and read-after-write verification for retry recovery.
- Per-session concurrency guards and restart recovery for in-flight actions; no automatic write retry after restart.
- AES-256-GCM encrypted SQLite record values, private database permissions, no retained audio, and session deletion.
- Client-ready state/status/speech fields; completion returns a 2.4-second neutral-state transition hint.
- Local simulation, adapter contract tests, setup/diagnostic/demo/chat/audio/connection scripts and a Docker build recipe.

Only primary-calendar reads and new single events are supported. No attendees, invites, event deletion/editing, recurring events, Instagram publishing, arbitrary web tools, long-term memory, Google Tasks/reminders, push notifications or multi-bot delegation. Availability currently returns busy intervals; the next conversational turn can propose a time using that context. There is no autonomous multi-tool loop or automatic compound task execution.

## Connect live providers

Keep a separate database for each mode. Edit the ignored `.env` locally:

```dotenv
APP_MODE=live
DATABASE_PATH=./data/live.sqlite
MODEL_API_KEY=your-meta-model-api-key
GOOGLE_CLIENT_ID=your-google-web-client-id
GOOGLE_CLIENT_SECRET=your-google-web-client-secret
GOOGLE_REDIRECT_URI=http://127.0.0.1:8787/oauth/google/callback
```

Do not regenerate `ENCRYPTION_KEY` for an existing database; the old key is required to decrypt it. Back up the key separately from the database.

1. Create/configure a Google Cloud project, enable Calendar API, configure the OAuth consent screen and add your account as a test user where required.
2. Create a **Web application** OAuth client and register the exact redirect URI above. The phone/watch need not be connected for this browser step.
3. Supply your Meta Model API key with access to the configured models and billing/credits.
4. Restart the backend, run `npm run doctor`, then `npm run oauth`. Open its short-lived consent URL yourself. Grant both requested scopes.
5. Run `npm run chat`. Try a read-only Calendar query first, then a clearly specified future event. Review all date/time fields before `/yes`.

The configured scopes are `calendar.events.owned` and `calendar.events.freebusy`. Account policies, OAuth testing limits and model entitlement can still block access. The application will report an error, never switch to mock mode automatically.

`DELETE /v1/integrations/google` forgets locally stored Google credentials. It does not revoke the grant at Google; revoke it in Google Account settings if desired.

## Voice without the watch

Provide a mono, 16-bit PCM WAV file, at 16, 24, 44.1 or 48 kHz, at most 60 seconds / 6 MiB:

```sh
npm run voice -- /absolute/path/recording.wav
```

The script uploads to the backend and prints the response. It never confirms an action. In live mode the audio is sent to Meta for transcription; it is not stored in the local database. The extracted transcript becomes part of the encrypted session history. The script prints the session ID for follow-up or deletion.

If FFmpeg is already installed, an example conversion is:

```sh
ffmpeg -i input.m4a -ac 1 -ar 16000 -c:a pcm_s16le -t 60 recording.wav
```

Speech synthesis stays on the Apple client. The backend returns `speechText`; no TTS voice service or phoneme timings are implemented. Watch recording/encoding, networking, microphone permissions and audio playback still require native-device validation.

## HTTP contract

Every `/v1` endpoint requires `Authorization: Bearer <API_TOKEN>`. No tokens in query strings. `/health` and the state-protected OAuth callback are public. The shared bearer credential is only for the private single-user prototype; it must not be embedded into a distributed public app.

| Method | Route | Request / response |
|---|---|---|
| GET | `/health` | Minimal liveness |
| GET | `/v1/status` | Mode, Calendar connection and audio contract |
| POST | `/v1/sessions` | `{ "timeZone": "Europe/London" }` → session ID |
| POST | `/v1/sessions/:id/turns` | `{ "requestId": "UUID", "text": "..." }` → turn result |
| POST | `/v1/sessions/:id/audio` | Raw `audio/wav`; UUID `Idempotency-Key` header → turn result |
| GET | `/v1/sessions/:id/events` | Bounded timestamped state/status timeline; poll during a pending request |
| GET | `/v1/sessions/:id/actions/:actionId` | Current authoritative action status and receipt |
| POST | `/v1/sessions/:id/actions/:actionId/decision` | `{ "decision": "confirm" }` or `{ "decision": "cancel" }` |
| DELETE | `/v1/sessions/:id` | Delete local history, timeline, actions and request cache; does not delete Calendar events |
| POST | `/v1/integrations/google/connect` | Return an OAuth consent URL; live mode only |
| DELETE | `/v1/integrations/google` | Remove local credentials |
| GET | `/oauth/google/callback` | Browser OAuth callback; one-time state and code |

A successful turn contains `sessionId`, `state`, `statusText`, `speechText`, `simulated`, optional `action`, optional `data`, and optional `returnTo`. Available task states include `transcribe`, `think`, `search`, `approval`, `working`, `happy`, `clarify`, `speak`, `cancelled`, `permission` and `error`. Progress is polling-based, not WebSocket streaming. While recording, the watch owns its `listen` state. Idle, sleep, offline, gestures, lip movement and reaction timing are client responsibilities.

For `approval`, `action.event` contains the exact title, start, end and timezone that will be saved. `speechText` reads the complete proposal. The native client must present that full proposal before sending confirmation; the short status line alone is not sufficient. On successful save, honour `returnTo: { "state": "idle", "afterMs": 2400 }`; interrupt this timer if the user starts another interaction.

Errors contain a client-safe `error.code`, `error.message`, request ID, `state`, `statusText`, `speechText` and `simulated`. They never contain provider response bodies or secrets. 400 means validation, 401 authentication, 404 unknown session/action, 409 conflicts/expired approval/disconnected integration, 422 unusable input, 429 rate limit and 502/503 upstream trouble. A model schema failure currently returns validation error 400; malformed/truncated completion text returns 502.

## Retry and cancellation semantics

Reuse a turn's UUID when retrying the same payload; changing the payload under that UUID returns 409. Successful turn responses are cached. **After replaying a cached proposal, fetch the action endpoint before showing approval**, because the action may since have been cancelled or completed.

Confirmation retries use the same action ID. After a timeout, `uncertain` means an event may already exist. Retry confirmation on that action to check/recover; do not create a new proposal to retry the write. A stable event ID and private action marker allow the adapter to recover existing results. Unexpected/mismatched receipts fail closed. This reduces duplicate risk; it is not a claim of universal distributed exactly-once delivery.

`cancel` stops an unexecuted pending proposal. It cannot undo a completed event or an uncertain/in-flight write. New requests invalidate older pending proposals in the same session. Sessions with uncertain writes cannot be deleted until those receipts are resolved. If the provider permanently cannot resolve an uncertain action, inspect Calendar and retain the receipt for manual recovery; no force-delete endpoint is exposed.

## Storage and deployment limits

SQLite is deliberately used to make the entire backend testable without provisioning Supabase. The service is **one process / one user / one writable volume**. In-memory session locks are not distributed locks. Do not run multiple instances against the same database or expose this as a multi-user service. A public release needs real user authentication, ownership enforced at storage boundaries, stronger budget controls and distributed job/lock design. Supabase remains a future migration option rather than a silently assumed dependency.

Transcript/action data persists until session deletion. Context is limited to the last 16 messages and each serialized assistant tool result is bounded to 8,000 characters. Terminal logs include route templates, request IDs, timings and HTTP status only. Local scripts intentionally print your interaction results. Provider retention is governed separately by the connected provider.

For the compiled server:

```sh
npm run build
npm start
```

The included Dockerfile builds the same server. Supply secrets at runtime, mount a writable persistent volume at `/app/data`, and use TLS termination before reaching it from a watch. `HOST=0.0.0.0` is for that deliberate deployment; local development binds to loopback. No deployment, OAuth grant or real Calendar modification was performed by implementation tests. Docker runtime operation has not been verified here.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run format:check
```

Tests exercise authentication, schema boundaries, explicit approvals, cancellation/expiry, session isolation, idempotency, simultaneous confirmation, uncertain-save recovery, WAV validation, encrypted persistence, startup recovery, OAuth state/PKCE/scopes, token refresh, provider errors and live-adapter request contracts through mocked HTTP responses. They do not prove live account access, speech quality, production latency or real hardware behavior.

API references checked on 26 October 2026:

- [Meta chat quickstart](https://dev.meta.ai/docs/cookbook/quickstart-chat-completions)
- [Meta file transcription](https://dev.meta.ai/docs/api-reference/voice/transcribe)
- [Google OAuth web applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google event insertion](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Google free/busy query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)

## Live browser emulator

With the backend running, run `npm run emulator` in another terminal in this directory. Open http://127.0.0.1:4174/preview/emulator/ . The loopback gateway keeps API credentials server-side and proxies the real backend. See [emulator controls, verification and limitations](../preview/emulator/README.md).
