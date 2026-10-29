# Private deployment — Fly.io

Updated 29 October 2026. **The owner confirmed Jolly works on Apple Watch after importing the Fly connection. The Mac no longer needs to stay on.** This is a private single-user deployment, not a public release. The latest backend release and remaining client/provisioning gates are recorded below.

## Current operator guidance

Use the [release runbook](runbook.md) for current validation, isolated-source builds, exact revision stamping and verification. The dated release records below are historical snapshots. On 29 October, the usual demo booking profile was saved and Gmail read/draft and Notion access were connected; Notion destination validation succeeded. Live call/Calendar-write acceptance, latest client device acceptance and APNs provisioning remain pending. Gmail and Notion are excluded from the haircut demo.

## Booking-first private release deployed — 29 October 2026

Source at this recorded release: `f833b5e2ab1581e14d993b292c43d6a8ece3e94c`. Image: `registry.fly.io/muse-for-watch-vlad:deployment-01M62P84MTNVPWEQR3082XE6MM`. Built from an isolated committed snapshot, with public website assets staged, and deployed to the existing single London machine/volume. The unrelated local website and research changes were excluded. This release includes the preceding daily briefing, reminders and reviewed Gmail drafts implementation.

- All 348 automated tests passed locally (196 backend, 94 browser, 58 native), plus animation checks. Debug and Release native simulator SDK builds passed. Both [GitHub jobs](https://github.com/vbshuliar/muse-for-watch/actions/runs/40803845273) passed.
- Read-only preflight found zero active/uncertain calls. Fly created volume snapshot `vs_KXBjnNvQKYpSB9mGY2` before deployment.
- Post-deployment public health, authenticated status/readiness/profile/reminders/drafts returned 200; health and readiness returned the exact source revision. Anonymous readiness/profile/device-administration requests returned 401. Fly health is passing.
- Live model, voice, Calendar and calling configuration are available. No usual-booking profile is saved; push configuration is missing; live booking and physical-device acceptance remain unverified. The readiness screen reports these distinctions.
- Production encrypted backup `/data/muse/backups/release-f833b5e.sqlite` and an isolated restore check at `/tmp/jolly-restore-check-f833b5e.sqlite` both verified all 59 encrypted records. The running database was not replaced, rolled back or switched. Preserve the encryption key separately; the backup is private and must not be published.
- No calls, Calendar/Gmail writes, OAuth changes, device installations or organizer messages were performed. Credentials and the destination allowlist were unchanged.

[Private setup and pairing](booking-experience.md) and [readiness/recovery operations](operations-readiness.md) describe the new workflows. Historical records below describe earlier releases and are not the current feature inventory.

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

Follow the [release runbook](runbook.md). It requires the complete shared checks, exact pushed-commit CI, a read-only active-call check, backup/snapshot, isolated committed build context and `BUILD_REVISION` stamping. Keep `--ha=false` and one writable machine. Pushing Git alone does not deploy Fly.

For a fresh installation, use your own app name, create one volume, initialize `/data/muse` for UID/GID 1000 with mode 0700, configure secrets and update all hosted callback origins before deployment. Never reuse this owner's credentials.

## Connect iPhone and Apple Watch

Use the [native pairing guide](../native/README.md#connect-iphone-and-watch) for Debug and Release. Generate an expiring one-time code with the intended backend's owner credentials loaded privately. Enter the HTTPS origin and code on iPhone, then sync the Watch. Legacy owner-token JSON import is Debug-only and is retained for controlled development; it is not the recommended device onboarding path.

An older physical-device pilot worked, but that does not establish acceptance for subsequent client changes. Signing, microphone routes, background behavior and push still need checks on the updated devices.

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
