# Configuration reference

Reviewed against `backend/src/config.ts`, `backend/.env.example` and `backend/package.json` on 29 October 2026. Those files remain authoritative. Secrets belong only in a private environment or hosting secret store.

## Runtime

| Variable | Default / requirement |
| --- | --- |
| `APP_MODE` | `mock`; `live` requires `MODEL_API_KEY` |
| `HOST`, `PORT` | `127.0.0.1`, `8787`; production binds `0.0.0.0` |
| `API_TOKEN` | Required, at least 32 characters; owner administration credential |
| `ENCRYPTION_KEY` | Required, 64 hexadecimal characters; preserve with existing data |
| `DATABASE_PATH` | `./data/muse.sqlite`; use separate mock/live databases |
| `BUILD_REVISION` | `unknown`; set to the exact committed source when building an image |
| `DAILY_CALL_LIMIT` | `10`, integer 1–100; approved attempts per UTC day, not a monetary cap |

`npm run setup` generates the required local credentials. It does not overwrite an existing `.env`. Never paste generated values into documentation or shell arguments.

## Model and voice

| Variable | Purpose / configured default |
| --- | --- |
| `MODEL_API_KEY`, `META_BASE_URL` | Meta credential and HTTPS API origin (`https://api.meta.ai/v1`) |
| `META_MODEL` | `muse-spark-1.3` |
| `META_REASONING_EFFORT` | `low`; also accepts minimal, medium, high |
| `META_TRANSCRIBE_MODEL` | `muse-voice-transcribe-1.0` |
| `ELEVENLABS_API_KEY` | Optional speech-output credential |
| `ELEVENLABS_VOICE_ID` | Jessica, `cgSgspJ2msm6clMCkdW9` |
| `ELEVENLABS_MODEL` | `eleven_flash_v2_5`; also accepts `eleven_multilingual_v2` |

These are repository defaults, not promises of continuing provider availability or credit balance. Speech failure preserves text rather than claiming audio played.

## Provider setup matrix

| Integration | Server settings | Separate account action |
| --- | --- | --- |
| Calendar | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Enable API, register exact callback, grant Calendar access |
| Gmail | Same Google client; `GMAIL_REDIRECT_URI` | Register Gmail callback separately; read grant, optional compose grant |
| Notion | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, `NOTION_REDIRECT_URI` | Finish workspace onboarding, create OAuth connection, grant intended pages, choose destination |
| Telephone | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_ALLOWED_NUMBERS`, `CALLS_PUBLIC_URL` | Consenting international destination, reachable signed callback and audio routes |
| Social | `META_SOCIAL_APP_ID`, `META_SOCIAL_APP_SECRET`, `META_SOCIAL_REDIRECT_BASE`, `GRAPH_API_VERSION` | Provider app permissions and selection of an eligible managed account |
| Push | `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, `APNS_ENVIRONMENT`, `APNS_TOPIC_IOS`, `APNS_TOPIC_WATCHOS` | Apple provisioning, matching entitlements and device notification permission |

OAuth redirect defaults are `http://127.0.0.1:8787/oauth/{google|gmail|notion}/callback`. Remote redirects require HTTPS. Social callbacks use `/oauth/instagram/callback` and `/oauth/facebook/callback`. `CALLS_PUBLIC_URL` is an HTTPS origin, not a URL with a path or query. `TWILIO_ALLOWED_NUMBERS` is the explicitly reviewed comma-separated allowlist; profile entry alone does not add a number.

## Local gateway and operator scripts

These settings are read by scripts, not the backend configuration schema:

- `EMULATOR_PORT`: loopback gateway port, default `4174`.
- `EMULATOR_BACKEND_URL`: backend origin, default local `PORT`; remote origins require HTTPS.
- `BACKEND_URL`: origin for pairing and preflight commands. Preflight requires it explicitly.
- `DEVELOPER_DIR`: selects the Xcode toolchain for native checks when needed.

## Commands

Run npm commands in `backend/`, or use `npm --prefix backend run NAME` from the root.

| Script | Purpose |
| --- | --- |
| `setup` | Create private local environment once |
| `dev`, `build`, `start` | Run TypeScript, compile, run compiled server |
| `emulator` | Start credential-holding loopback browser gateway |
| `demo` | Deterministic example; use a dedicated mock configuration |
| `doctor` | Configuration/provider diagnostic helper; inspect before live use |
| `oauth`, `voice`, `chat` | Interactive/operator helpers; inspect intended provider actions first |
| `format`, `format:check` | Write/check backend source, test and script formatting |
| `typecheck`, `test` | TypeScript checking and backend regression tests |
| `check` | Formatting, types, build and backend tests |
| `check:preview` | Browser tests and animation checks |
| `check:all` | All shared checks, including native host tests |
| `website:stage` | Synchronize website agent guide and stage allowlisted Docker assets |

See [runbook](runbook.md) for pairing, deployment and maintenance scripts outside npm aliases.
