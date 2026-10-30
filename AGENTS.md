# Working in this repository

Read [the agent setup guide](docs/agent-setup.md), [code map](docs/code-map.md), and [release runbook](docs/runbook.md). `docs/agents.md` describes the in-product character, not coding-agent instructions.

- Preserve unrelated working-tree changes. Keep generated build contexts isolated from the user's checkout when deploying.
- Default to mock mode for development; never switch modes against an existing database. Keep credentials, phone numbers, connection files and database backups private.
- Preserve explicit approvals, destination allowlists, idempotency and uncertain-outcome recovery. Build/test authorization is not authorization to call a recipient or write to a real provider.
- Use one-time device pairing; legacy owner-token import is Debug-only. The service is single-owner, not multi-tenant.
- Keep the haircut demo focused on calls and Calendar. Gmail and Notion are optional integrations outside that demo.
- Label design fixtures, simulator captures and live evidence accurately. Never claim live/device acceptance from automated checks.
- Preserve the owner-selected Apache-2.0 licence and third-party notices. Keep provider terms distinct from the open-source application. Do not reintroduce third-party character art.

# Required validation

Before committing or pushing changes, and before reporting implementation work complete:

1. Install backend dependencies with `npm --prefix backend ci` when missing or when the lockfile changes.
2. Run `npm --prefix backend run format` and review the resulting diff, preserving unrelated work.
3. Run `npm --prefix backend run check:all`. This covers formatting, TypeScript, the backend build and tests, preview emulator and animation checks, and native Swift package tests, matching the GitHub Checks workflow.
4. Fix failures and rerun the affected checks. Revalidate after any subsequent edits that affect checked files. Never weaken checks or skip failing tests to obtain a pass.
5. After an authorized push, inspect the GitHub Actions run for the pushed commit and resolve failures within the task scope. Report remote CI as passed only when GitHub confirms it.

Use Node.js 24 and a Swift toolchain compatible with the native package. If a required tool or external service is unavailable, state which checks could not run rather than claiming success. Local validation cannot guarantee hosted runner or service availability.

Keep the shared npm check commands and `.github/workflows/checks.yml` in sync when checks change.

# Public history

The public history was rewritten on 30 October 2026. Never merge or push pre-cleanup history or private backup refs. Use a fresh clone for old checkouts; transplant only reviewed source changes. For new artwork, record provenance and redistribution permissions before committing. See [history maintenance](docs/history-maintenance.md).
