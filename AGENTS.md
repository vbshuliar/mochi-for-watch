# Required validation

Before committing or pushing changes, and before reporting implementation work complete:

1. Install backend dependencies with `npm --prefix backend ci` when missing or when the lockfile changes.
2. Run `npm --prefix backend run format` and review the resulting diff, preserving unrelated work.
3. Run `npm --prefix backend run check:all`. This covers formatting, TypeScript, the backend build and tests, preview emulator and animation checks, and native Swift package tests, matching the GitHub Checks workflow.
4. Fix failures and rerun the affected checks. Revalidate after any subsequent edits that affect checked files. Never weaken checks or skip failing tests to obtain a pass.
5. After an authorized push, inspect the GitHub Actions run for the pushed commit and resolve failures within the task scope. Report remote CI as passed only when GitHub confirms it.

Use Node.js 24 and a Swift toolchain compatible with the native package. If a required tool or external service is unavailable, state which checks could not run rather than claiming success. Local validation cannot guarantee hosted runner or service availability.

Keep the shared npm check commands and `.github/workflows/checks.yml` in sync when checks change.
