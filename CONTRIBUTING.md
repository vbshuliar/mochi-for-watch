# Contributing

Jolly is a private, single-owner assistant. Start with [AGENTS.md](AGENTS.md) and the [agent setup guide](docs/agent-setup.md). The signature workflow is approved autonomous booking; preserve its approval and recovery boundaries.

## Development loop

1. Use Node.js 24. On macOS install Xcode with the iOS/watchOS SDKs for native work.
2. In `backend/`, run `npm ci`, `npm run setup`, then `npm run dev`. Setup preserves an existing `.env`; never overwrite its encryption key.
3. In a second terminal in `backend/`, run `npm run emulator`. Open `http://127.0.0.1:4174/preview/emulator/`.
4. Use mock mode and a disposable database for development. Add a regression test for a behavioral fix, especially approval, cancellation, retries or external-write ambiguity.
5. From the repository root run `npm --prefix backend run format`, inspect the diff, then `npm --prefix backend run check:all`. Native UI changes additionally require `sh native/scripts/check.sh` on macOS.
6. Review the staged diff for secrets and unrelated changes. Commit only the intended files. Push when authorized, and inspect CI for that exact commit.

Use `codex/` for new agent-created branches. Do not force-push shared history. A passing local check is not a passing hosted check, a working telephone booking, or physical-device acceptance.

## Change requirements

- Validate external input at the API boundary; keep provider credentials on the server.
- Preserve idempotent decisions and uncertain outcomes. Never retry a potentially completed external write blindly.
- Keep `native/MuseCore/Sources/MuseCore/Models.swift` and browser consumers compatible with backend schemas.
- Keep npm checks and `.github/workflows/checks.yml` aligned.
- Update the relevant topic guide, not only the root README. Dated verification records are historical evidence.
- Label mocks, simulator screenshots, design studies and live results accurately.
- Do not include private configuration, phone numbers, account exports or database backups in issues or screenshots.

## Review and release

Describe the problem, resulting behavior and relevant validation. State any checks you could not run. Follow the [runbook](docs/runbook.md) for deployment; preserve the single writable SQLite machine and its encryption key. Calls, device installation and provider writes require their own task authorization.

## Rights

Read [LICENSE.md](LICENSE.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before reusing or contributing assets. No open-source license has been selected for this repository.
