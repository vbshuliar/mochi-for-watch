# Security

## Scope

This is a single-owner experimental assistant, not a multi-tenant service. Deployments share one owner's conversations, integrations and tasks. Device pairing authorizes access to that owner's assistant; it does not create separate user accounts.

Provider credentials and encrypted record values live on the backend. Device credentials live in Keychain; the browser emulator uses a loopback credential-holding gateway. Encryption does not hide record identifiers or protect an already-compromised running server.

## Reporting

Do not open a public issue containing secrets, personal data or exploit details. Use GitHub's private vulnerability reporting option if enabled. Otherwise contact the repository owner privately through an established channel and ask for a secure reporting route before sending details. There is no guaranteed response time or security SLA.

Provide the affected revision, a minimal reproduction with synthetic data, expected/actual behavior and impact. Do not place calls, read another person's data or modify production to demonstrate a report.

## Operational safeguards

- Keep provider secrets and the database encryption key out of Git, client bundles, URLs and logs.
- Pair devices with expiring one-time codes; revoke lost-device credentials.
- Preserve explicit call and external-write approvals and provider callback verification.
- Restrict calling to consenting allowlisted recipients and keep the daily attempt limit enabled.
- Retain uncertain outcomes for reconciliation; do not use blind retries as recovery.
- Back up the encrypted database and separately preserve its key. Verify restores to a new path.
- Keep one writable backend machine. Independent SQLite volumes do not form a replicated database.

See [operations](docs/operations-readiness.md), [data boundaries](docs/architecture.md) and [release procedure](docs/runbook.md). Dependency and code checks reduce risk; they do not certify the system secure.
