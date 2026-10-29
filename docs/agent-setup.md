# Setup guide for coding agents

Last reviewed: 29 October 2026. This guide describes the implementation, not a claim of completed live-call or device acceptance.

## Read in this order

1. Root [AGENTS.md](../AGENTS.md): mandatory validation contract.
2. [README](../README.md): product promise, demo scope and mode distinctions.
3. [Code map](code-map.md): module ownership and cross-client contracts.
4. The relevant feature guide from the [index](README.md).
5. [Runbook](runbook.md) before touching hosting, credentials or persistence.

`docs/agents.md` describes Jolly's personality, not instructions for coding agents. Historical research and verification notes do not override current code or user authorization.

## Establish a safe baseline

From the repository root, inspect `git status --short`, `git branch --show-current`, `git remote -v`, and the applicable instructions. Preserve pre-existing changes. Use Node.js 24 (`.nvmrc`); Xcode with compatible Swift is needed for native host tests and SDK builds. Check tools before claiming they work.

```sh
node --version
npm --prefix backend ci
npm --prefix backend run setup
npm --prefix backend run build
npm --prefix backend run dev
```

npm runs these scripts in `backend/`. Setup creates `.env` with unique owner and encryption keys and leaves existing files untouched. On a new checkout it defaults to mock mode. On an existing checkout inspect only nonsecret settings first: never assume its `.env` is a disposable mock environment. Do not print or commit environment files.

In a second terminal:

```sh
npm --prefix backend run emulator
```

Open `http://127.0.0.1:4174/preview/emulator/`. The gateway holds the owner credential server-side. Do not expose it publicly or replace it with a browser-embedded bearer token. From `backend/`, `npm run demo` runs the deterministic approval/receipt example against the selected backend; use a dedicated mock configuration.

## Live setup checklist

Choose a separate database for live mode. Configure each provider independently using [configuration](configuration.md). Connect Calendar before testing availability. Call setup requires an HTTPS origin, Twilio configuration and an explicit consenting-recipient allowlist. An available provider key does not authorize a live call.

Gmail read and compose access are separate from Calendar access. Notion needs a completed workspace, an OAuth connection, server credentials, a page grant and a saved destination. Completing one of these steps does not complete the others. See [Gmail/Notion troubleshooting](gmail-notion.md).

Never infer permission to send mail, publish social content, call a phone, change appointments or install on devices from a request to build or run checks. The application's own approval requirements remain in force during testing.

## Native setup

Open the committed `native/MuseForWatch.xcodeproj`; ordinary changes do not require XcodeGen. If `native/project.yml` changes, regenerate with XcodeGen and review the generated diff. Use the MusePhone scheme for the phone and embedded Watch app. Minimum targets are iOS 17/watchOS 10.

Use one-time pairing for new devices. Load the intended backend's owner credentials privately, set `BACKEND_URL`, and run `node backend/scripts/pairing.mjs issue My iPhone`. Enter the returned short-lived code on iPhone and sync the Watch. Do not confuse local `.env` credentials with hosted credentials. See [native setup](../native/README.md).

## Change and review

Make the smallest coherent fix. Trace requests through schemas, service orchestration, durable action state, provider adapters, API serialization and both clients. Add behavioral regressions for discovered bugs. Re-run affected checks after edits. Avoid refactors whose only purpose is stylistic consistency.

```sh
npm --prefix backend run format
npm --prefix backend run check:all
# Native UI / SDK changes, on macOS:
sh native/scripts/check.sh
```

Review the format diff before staging. `check:all` includes formatting, TypeScript, build, backend tests, browser tests, animation checks and native host tests. It does not call real providers or prove microphone, push or booking behavior on hardware.

## Delivery contract

- State what changed, why, validation results and remaining limitations.
- Commit only intended files and push when authorized; inspect CI for the exact SHA.
- Deploy an isolated committed snapshot so untracked files and unrelated edits cannot leak into the image.
- Verify `/health`, authenticated `/v1/readiness`, unauthorized rejection, machine health and exact revision after deployment.
- Keep the demo focused on haircut request → call approval → autonomous conversation → result → Calendar approval. Gmail and Notion are optional capabilities outside this demo.
