# Private deployment

Mochi for Watch serves one owner per backend instance. The public website is https://mochi-for-watch.fly.dev; it contains no provider credentials. The previous website redirects to this address after migration.

## Compatibility boundary

The existing owner's backend remains at `https://muse-for-watch-vlad.fly.dev`, as configured in `backend/fly.toml`. Its OAuth redirects, telephone callbacks, SQLite volume and encryption key remain unchanged. Renaming this service requires a separate coordinated provider migration; it is not necessary to rename the public website or open-source the application.

For a new installation, choose your own Fly app names, backend origin and provider callback registrations. Do not reuse this owner's deployment or credentials. See [configuration](configuration.md), [runbook](runbook.md) and [native setup](../native/README.md).

Existing bundle IDs, native keychain/storage keys and emulator storage identifiers remain stable so upgrades retain pairing and saved preferences. New device tokens use the Mochi prefix; previously issued tokens remain revocable and subject to their original expiry. Actual API model identifiers and provider names are retained in configuration and privacy disclosures because the integrations still use those services.

## Operations

Use a single writable backend instance with persistent storage, encrypted record values and a retained encryption key. Confirm no active or uncertain call before restarting. Take a volume snapshot, deploy an isolated committed source snapshot, verify the exact health revision and authenticated readiness, and verify anonymous API rejection. Never claim live-call or device acceptance from these checks alone. See [the runbook](runbook.md) for commands.
