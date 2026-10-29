# Private deployment — Fly.io

Updated 28 October 2026. **The owner confirmed Jolly works on Apple Watch after importing the Fly connection. The Mac no longer needs to stay on.** This is a private single-user deployment, not a public release. The latest backend release and remaining client/provisioning gates are recorded below.

## Shared tasks and booking changes deployed — 28 October 2026

Deployed source revision `f864398d287102cc93c5bacb979f81d3abc24ac4`, including the feature release `4bcc2b8` and complete website script packaging. The release was built from an isolated committed snapshot, with website assets staged before the remote build. Image: `registry.fly.io/muse-for-watch-vlad:deployment-01M61MS5MS2DR5SJWTSYYH0CAQ`. The existing single London Machine and encrypted volume were retained; no secrets or hosting resources were changed. A read-only preflight found no active calls.

Verification at 16:18 London time:

- Fly health check passed; public health, homepage, CSS, `site.js` and `mouse-gaze.js` returned 200.
- Anonymous status, task-feed and notification-status requests returned 401; authenticated requests succeeded.
- Live mode, ElevenLabs speech, connected Google Calendar and configured calling were reported.
- Shared tasks returned existing data. A real Google Calendar availability read succeeded without writing an event.
- A real Meta conversational response completed in 3,617 ms; ElevenLabs returned 18,851 bytes of MPEG audio in 153 ms. These are single synthetic smoke checks, not physical-device latency measurements. Temporary smoke sessions were removed.
- Local aggregate validation passed (152 backend, 74 emulator, 47 native tests and animation checks); both GitHub CI jobs passed for the deployed revision.

The backend now exposes shared task discovery, approved booking changes and the notification service. APNs reports `configured: false`: no signing key is present in Fly/project configuration, and Apple Developer requires sign-in before provisioning can continue. No live telephone call, Calendar write, app installation or physical-device test was performed. The earlier instruction to defer live calls remains pending explicit recipient readiness. Updated native UI still requires installation; see [acceptance](development-acceptance.md) and [push setup](task-notifications.md).

## Current configuration

| Setting | Value |
| --- | --- |
| Origin | `https://muse-for-watch-vlad.fly.dev` |
| Dashboard | [Fly.io monitoring](https://fly.io/apps/muse-for-watch-vlad/monitoring) |
| App / region | `muse-for-watch-vlad` / London `lhr` |
| Compute | One shared-CPU Machine, 512 MB RAM, always on |
| Storage | One encrypted 1 GB `muse_data` volume mounted at `/data` |
| Database | `/data/muse/muse.sqlite` |
| Configuration | [backend/fly.toml](../backend/fly.toml) and [Dockerfile](../backend/Dockerfile) |
| AI | Direct Meta API, `muse-spark-1.3`, existing $150 hackathon credits |
| Voice | ElevenLabs Jessica, existing account |
| Calendar | Connected; live availability read verified; Calendar write validation pending |

The approved hosting estimate was $4–5/month base, with an approved ceiling of $7.25/month base; tax and usage are separate. This is an estimate, not a billing cap. The account was verified as Good Standing after billing setup. Check actual charges in Fly billing before changing resources.

HTTPS is internet-reachable, with bearer-token protection for app API and realtime requests. The landing page (`/`, `/index.html`), its three assets (`/style.css`, `/assets/jolly.png`, `/assets/jolly-face.png`), `/health` and the state-validated OAuth callbacks are public exceptions. Website routes allow anonymous GET/HEAD only; API authentication is unchanged. There is no dedicated paid IPv4 or managed database.

## Secrets and storage

Provider credentials are supplied through Fly secrets, never bundled into either native app. Required private values include `API_TOKEN`, `ENCRYPTION_KEY`, `MODEL_API_KEY` and `ELEVENLABS_API_KEY`; retain the chosen ElevenLabs configuration as well. Public runtime settings are in `fly.toml`.

The current private backup is `native/Local/fly.env`, ignored by Git and mode 0600. It contains the deployment credentials, which differ from the local development app token. Do not print it, commit it or include it in support requests. Import an intentionally reviewed environment file through stdin, avoiding values in command arguments:

```sh
cd backend
fly secrets import < ../native/Local/fly.env
```

The CLI on the original development Mac is `/Users/admin/.fly/bin/flyctl`; substitute that path for `fly` if it is not on your PATH. Secret changes can restart the app.

Preserve `ENCRYPTION_KEY` with backups: replacing it makes existing encrypted records unreadable. Never switch `APP_MODE` against an existing database. No local history or Google credentials were copied into this deployment.

The Docker container runs as non-root UID/GID 1000. For a **new** volume, initialize `/data/muse` with owner `1000:1000` and permissions `0700` before starting the app. The initial deployment used a temporary root maintenance Machine mounting that volume, then removed it. Do not change the production container to root or reset the existing database to fix permissions.

Keep one writable Machine. A second independently mounted SQLite volume is not a replica and would split session and Calendar state. The current volume has five-day automatic snapshots; snapshots do not replace a tested recovery procedure or an encryption-key backup.

## Deploy an update

These commands update the existing app and volume; they do not provision a fresh account or storage:

```sh
cd backend
npm ci
npm test
npm run build
npm run website:stage
fly config validate
fly deploy --remote-only --ha=false --strategy immediate
fly status
fly checks list
```

The config uses the Dockerfile, port 8787, `/health`, forced HTTPS and disabled automatic stopping. Keep `--ha=false` to avoid adding another Machine. A single-Machine deployment can briefly interrupt an active conversation. Pushing Git alone does not deploy Fly; run the deployment separately.

For a fresh installation, choose an app name, configure billing, create one 1 GB volume in the selected region, initialize its permissions, supply secrets, and update the app name and Google redirect origin in `fly.toml` before deploying. Do not reuse the owner's app token for another user.

## Connect iPhone and Apple Watch

1. Install the signed Debug apps using the [native setup guide](../native/README.md).
2. Privately transfer the existing `native/Local/connection.json` to iPhone Files. `fly-connection.json` is its local backup. Both are ignored by Git and contain the **Fly** origin and deployment app token.
3. Open Muse on iPhone and tap the top-right **Connection** link button, then **Import connection file**. Select the file in Files.
4. Open both apps. Import stores the connection in Keychain and initiates WatchConnectivity sync. Use **Sync with Apple Watch** to retry delivery if necessary.
5. Tap Jolly on the Watch and speak. Test with the Mac backend stopped.

The local `native/scripts/connection.mjs` helper reads `backend/.env`; passing a Fly URL does **not** make it read Fly credentials. Do not overwrite the working hosted connection with a local token. For a new hosted connection, securely create JSON with `baseURL` and `token` matching that deployment.

The Watch still needs internet access. The initial setup requires the paired iPhone, but the backend runs on Fly. The latest build supports private one-time code pairing in Release as well as Debug. Legacy owner-token import remains Debug-only. This remains a single-owner service, not public multi-user sign-in. Development signing remains separate from hosting and can require renewal through Xcode.

## Recorded checks — 27 October 2026

- 36 backend tests and TypeScript build passed; Fly configuration validated.
- HTTPS health returned 200; anonymous status 401; authenticated status 200 with live mode, ElevenLabs and disconnected Calendar.
- An actual streamed Meta reply completed with a validated result in approximately 2.43 seconds. This was one measurement, not a latency guarantee.
- ElevenLabs returned a 54,377-byte MP3 in approximately 484 ms.
- A test session and event history survived a Machine restart unchanged; the test session was then deleted.
- Cancellation returned 200 with `cancelled: true` and no completed reply. The interrupted stream still emitted a generic `provider_unavailable` terminal error; verify native interruption handling separately.
- Unauthenticated realtime WebSocket was rejected with 403; authenticated connection received Meta `ready`. The user later confirmed Watch operation, but individual microphone/transcription paths were not separately instrumented.
- The new connection file was delivered by AirDrop, and the owner confirmed the Watch works after cutover.

Initial local DNS caching briefly required a diagnostic lookup override while retaining TLS hostname verification. No DNS override was deployed in the app.

## Operations and remaining work

Use `fly logs`, `fly status` and `fly checks list` for diagnosis; avoid sharing logs that contain conversation content. After a deployment, verify health, authentication, an actual reply and audio. Confirm restart persistence after storage changes. For recovery, redeploy a known-good image or revision; rolling back code does not roll back database contents. Test snapshot restoration before relying on it.

Google Calendar remains optional. Before enabling it, add Google credentials as secrets and register `https://muse-for-watch-vlad.fly.dev/oauth/google/callback` in the Google OAuth client. Validate consent, read, proposal, confirm and cancel against a real account. Gmail, Notion and social adapters are implemented; each still requires its own provider app configuration and account consent.

Remaining device checks include interruption, wrist-down/background transitions, weak connectivity, speaker routing and battery use. A shared public service would additionally require per-user authentication and ownership boundaries; the owner chose private deployment.

## Retired Render deployment

Render was evaluated before Fly. The same Meta credentials returned an empty model catalog and `model_not_found` from Render while working from the Mac and Fly. The exact cause is unknown; see [the diagnostic record](meta-cloud-access-issue.md).

On 27 October 2026:

- Paid service `muse-for-watch` (`srv-dbgb740m7kps73buiopg`) was suspended; Render confirmed suspended compute is not billed.
- The old 1 GB disk was removed after the user authorized deletion; its page showed **Add Disk**, with no attached disk.
- The free Virginia diagnostic service was also suspended.
- A courtesy refund or accrued-usage waiver was requested from Render support. **It is pending, not approved.**

Do not use the old Render origin or connection credentials. The retired service records remain for reference; they are not the active deployment.

## Meta web search update — 27 October 2026

The Fly backend now supports [current-information answers with sources](web-search.md), using the same direct Meta API key and credit account. No new service or secret is required. Live streamed news and London-weather requests returned answers with citations. The health/status endpoint remains distinct from a provider smoke test; `webSearch: true` indicates live configuration. Existing installed apps receive the answers; install the updated native build to view sources on-device.

## Booking calls — deployed, live acceptance pending

The [booking-call implementation](booking-calls.md) keeps Meta as the brain, uses ElevenLabs for speech and Twilio for telephony/transcription. `CALLS_PUBLIC_URL` points at the existing Fly origin. The owner approved storing the Twilio credentials in Fly secrets and the ignored local private environment file. The existing caller number and only the selected consenting demo destination are configured. Authenticated status reports `callsConfigured: true`; Twilio credentials and voice capability passed read-only checks. Fresh installs default to an empty allowlist and cannot dial. Do not add secrets to `fly.toml`.

Twilio callbacks use signature verification instead of the app bearer token; short-lived opaque audio links allow Twilio to fetch generated replies. There are no call recordings. Call transcripts, booking instructions and receipts are stored in the existing encrypted database; speech audio is sent to ElevenLabs and recipient speech/approved booking context to Meta. No other saved memories or Calendar event titles are sent to the call model.

Avoid deployments during an active call. After a restart, unresolved calls are treated as uncertain rather than automatically redialed. Check the provider and recipient before starting another booking if the outcome is unknown. Native installation and live phone acceptance remain separate from backend deployment.

### Calendar connection — 27 October 2026

Created the Muse for Watch Google project, web OAuth client with hosted/local Calendar callbacks, private test audience and the two scopes already used by the backend. The owner approved policy/API activation and completed Google consent directly. Client credentials were stored in the ignored private env file and Fly secrets. Calendar API status is enabled and hosted Muse status reports connected; a real availability-only request passed. No Calendar event was created during this check.

## Public website — 28 October 2026

The first landing page was hosted on the existing machine at https://muse-for-watch-vlad.fly.dev/. The public URL is now https://muse-for-watch.fly.dev/, served by a separate 256 MB static machine that stops when idle. The original backend address and page remain available. The Watch API remains authenticated. Source lives in `website/dist/`; run `npm run website:stage` from `backend/` before Docker/Fly builds to copy the four public files into the ignored `backend/public/` build input. The Dockerfile only copies those files. Keep deployment to one machine with the command above.

Verification: 105 backend tests and TypeScript build passed. Deployment updated the existing machine `18577940c1ee38`; Fly health check passed. Public HTML, CSS and image returned 200 and matched local SHA-256 hashes. Anonymous `/v1/status`, `/.env` and non-allowlisted assets returned 401. Desktop (1280px) and mobile (390px) layouts had no horizontal overflow, and the setup disclosure worked. Code review found no blocking issues.
