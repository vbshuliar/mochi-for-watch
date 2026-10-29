# Troubleshooting

Start with the exact running revision, mode and sanitized error. Never paste an environment file, OAuth callback URL, device token or database into an issue.

| Symptom | Check | Recovery |
| --- | --- | --- |
| Node SQLite or syntax error | `node --version` | Use Node 24 and reinstall with `npm ci` in backend |
| Backend rejects configuration | Required token/key and live model key | Run setup only for a new environment; preserve existing encryption keys |
| Browser returns 401 | Gateway and backend use different tokens/origins | Load the intended private environment; restart the gateway |
| Phone cannot reach localhost | Localhost is the device itself | Pair with a reachable HTTPS backend |
| Paired device stops authenticating | Revoked/expired token or wrong origin | Issue a new owner-authorized pairing code |
| Google `redirect_uri_mismatch` | Exact callback path in OAuth client | Register Gmail and Calendar callbacks separately; preserve existing entries |
| Consent finishes but connection is absent | Callback result; pending state expires | Start a fresh connection and complete all permissions promptly |
| Gmail connects without drafts | Read-only grant | Reconnect with explicit draft scope; Google compose also includes sending capability, though this app does not implement sends |
| Notion Create connection disabled, no workspaces | Account onboarding | Open Notion itself and finish personal workspace onboarding, then refresh developer tools |
| Notion cannot see a page | OAuth page grant and full access | Grant only the intended parent page, reconnect if needed, then select it as destination |
| Connection is configured but provider fails | API enabled, account access, quota/balance | Check the provider dashboard; readiness does not make a billable API request |
| Confirmed call lacks Calendar event | Separate Calendar proposal | Review and approve the event; never claim it was saved before a receipt |
| Call is uncertain | Prior provider outcome may have occurred | Verify with recipient/provider before another attempt |
| No completion notification | APNs credentials/provisioning and permission | Use in-app progress until Apple setup and device acceptance pass |
| SQLite permission error on Fly | Volume ownership and mount path | Initialize a new volume correctly; do not reset existing data or run the app as root |
| Existing data cannot decrypt | Wrong encryption key | Restore the matching key; do not generate a replacement over existing data |
| Native host checks fail | Swift/Xcode selection | Check `xcode-select -p`; use compatible Xcode via `DEVELOPER_DIR` |
| GitHub differs from local checks | Exact SHA, Node/Swift, lockfile, platform | Inspect failed job logs and fix the cause; do not weaken checks |

See [runbook](runbook.md) for deployment/recovery and the [acceptance checklist](development-acceptance.md) for real calls and devices.
