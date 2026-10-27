# Private deployment — Fly.io

Updated 27 October 2026. **The owner confirmed Jolly works on Apple Watch after importing the Fly connection. The Mac no longer needs to stay on.** This is a private single-user deployment, not a public release.

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
| Calendar | Disconnected; Google configuration and live validation deferred |

The approved hosting estimate was $4–5/month base, with an approved ceiling of $7.25/month base; tax and usage are separate. This is an estimate, not a billing cap. The account was verified as Good Standing after billing setup. Check actual charges in Fly billing before changing resources.

HTTPS is internet-reachable, with bearer-token protection for app API and realtime requests. `/health` and the state-validated Google OAuth callback are exceptions. There is no dedicated paid IPv4 or managed database.

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

The Watch still needs internet access. The initial setup requires the paired iPhone, but the backend runs on Fly. Debug connection setup is not available in Release builds; public distribution needs a real sign-in/pairing flow. Development signing remains separate from hosting and can require renewal through Xcode.

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

Google Calendar remains optional. Before enabling it, add Google credentials as secrets and register `https://muse-for-watch-vlad.fly.dev/oauth/google/callback` in the Google OAuth client. Validate consent, read, proposal, confirm and cancel against a real account. Other connector rows are placeholders.

Remaining device checks include interruption, wrist-down/background transitions, weak connectivity, speaker routing and battery use. Public release additionally requires per-user authentication and ownership boundaries.

## Retired Render deployment

Render was evaluated before Fly. The same Meta credentials returned an empty model catalog and `model_not_found` from Render while working from the Mac and Fly. The exact cause is unknown; see [the diagnostic record](meta-cloud-access-issue.md).

On 27 October 2026:

- Paid service `muse-for-watch` (`srv-dbgb740m7kps73buiopg`) was suspended; Render confirmed suspended compute is not billed.
- The old 1 GB disk was removed after the user authorized deletion; its page showed **Add Disk**, with no attached disk.
- The free Virginia diagnostic service was also suspended.
- A courtesy refund or accrued-usage waiver was requested from Render support. **It is pending, not approved.**

Do not use the old Render origin or connection credentials. The retired service records remain for reference; they are not the active deployment.
