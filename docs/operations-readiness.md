# Private assistant readiness and recovery

The deployment remains one owner's assistant. A readiness report is a configuration check, not proof of a real booking or device delivery. `GET /v1/readiness` is authenticated and makes no external provider requests. It includes build revision, source mode, Calendar configuration, calling configuration, the usual profile's allowlist eligibility, active or uncertain calls, push configuration and daily call-attempt usage. Recipient numbers and credentials are not returned.

`configurationReady` excludes optional push delivery and the two acceptance checks. `readyForDemo` remains false until there is a separate verified live/device acceptance record; this release does not manufacture one from unit tests. Unknown build revisions are displayed as unknown. Root deployment should set `BUILD_REVISION` to its exact source commit.

After building, run a read-only preflight with `BACKEND_URL` and `API_TOKEN` in the environment:

```sh
node backend/scripts/preflight.mjs
```

The command refuses non-HTTPS remote origins and redirects, and reports missing configuration without calling a recipient or writing to Calendar/Gmail. Real account consent, Apple signing/provisioning and device acceptance remain owner actions.

## Call usage limits

`DAILY_CALL_LIMIT` limits approved call attempts per UTC day. The independent encrypted call-attempt ledger survives session deletion. The readiness report deduplicates ledger entries and existing call records, shows remaining attempts and blocks readiness once exhausted. Active or uncertain calls independently prevent a new attempt.

This is an attempt limit, not a monetary billing cap. The reported elapsed call-task seconds are not Twilio billed seconds. Meta tokens, ElevenLabs characters/audio and provider charges are not measured by this report; actual charges must be checked with each provider. No estimated dollar amount is invented. Raising the configured attempt limit is an operator action.

## Encrypted SQLite backup and restore

Build first with `npm --prefix backend run build`. Supply `ENCRYPTION_KEY` via the environment or a private Node environment file; never place its value in a command or shared output.

```sh
node backend/scripts/maintenance.mjs backup /path/to/source.sqlite /private/backups/new-snapshot.sqlite
node backend/scripts/maintenance.mjs restore /private/backups/new-snapshot.sqlite /private/recovery/new-database.sqlite
```

Both commands require an existing source and a **new** destination. They refuse to overwrite any database, WAL or shared-memory file. Backup uses SQLite's online backup API, so committed WAL records are included while the source is open. It verifies database integrity and decryptability with the supplied key, writes a mode-0600 snapshot, then verifies every copied record. The key is never included in command output or the database snapshot.

Restore writes only to a new path. It never switches the running service or replaces its database. To recover production, first stop new work, resolve or account for active/uncertain external actions, stop the service, inspect the restored copy privately, and deliberately switch the deployment's database path. Restoring a database does not reverse external calls or Calendar/Gmail writes; a stale snapshot can lack later receipts. Reconcile those operations before enabling new actions. Preserve the exact encryption key separately from snapshots.

Automated recovery tests create a disposable database with encrypted credentials and an uncertain call, take a backup while the source is open, restore to a second path, verify values and isolation from later writes, verify private permissions and ciphertext, and reject wrong keys/overwrite. No production database has been restored by these tests. Fly volume snapshots remain useful but are separate from this verified application-level procedure.

## Narrow retention policy

Retention defaults to dry-run and outputs counts, never record content or identifiers:

```sh
node backend/scripts/maintenance.mjs retention
node backend/scripts/maintenance.mjs retention --apply
```

Set `DATABASE_PATH` and `ENCRYPTION_KEY` to the intended existing database. Only these ephemeral records qualify:

- Call audio expired more than 24 hours ago, when its call is resolved or no longer exists. Audio tied to active or uncertain calls stays untouched.
- Accepted or failed push deliveries older than seven days. Pending deliveries stay untouched.

Session histories, approvals, external receipts, uncertain actions, memories, reminders, OAuth credentials/state, pairing records and call-attempt usage remain untouched. There is no automatic broad deletion. Review the dry-run before explicitly applying. Long-term history deletion uses the existing conversation controls and must respect unresolved-operation guards.

## Deployment preflight

The Fly CLI on the development Mac is `/Users/admin/.fly/bin/flyctl`. Read-only inspection on 29 October 2026 confirmed the original single London machine remains started with a passing health check and image `deployment-01M61MS5MS2DR5SJWTSYYH0CAQ`; that observation does not deploy the latest code. Before updating, verify no active or uncertain calls, preserve the encrypted volume and key, deploy the exact tested commit to the existing single machine, and then inspect readiness and authentication. Never scale this SQLite design into independent writable replicas.

### Verified deployment and production-copy recovery

On 29 October 2026, source `f833b5e` was deployed to the existing single London machine. Public health and authenticated readiness returned its exact revision; protected endpoints rejected anonymous access. An online encrypted backup and isolated restore copy each verified all 59 production records without replacing or switching the live database. The latest snapshot and private backup locations are recorded in [deployment](private-deployment.md). Missing profile/push setup and deferred live/device acceptance remain honestly reported.
