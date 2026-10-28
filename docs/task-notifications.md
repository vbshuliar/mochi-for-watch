# Shared tasks and completion alerts

The private single-user backend exposes authenticated `GET /v1/tasks` across conversation sessions. Each returned task retains its original `sessionId`; approvals, stops and Calendar actions still target the exact persisted action using the existing session-bound routes. This does not introduce multi-user accounts or authorize sharing the private app token.

## Opt-in notifications

Clients request system permission only after the user chooses to enable notifications. APNs device registration uses authenticated `POST /v1/notifications/devices` with `{id, token, platform, environment}`; `id` is a stable installation UUID, `platform` is `ios` or `watchos`, and `environment` is `sandbox` or `production`. Re-registration updates a rotating token. `DELETE /v1/notifications/devices/:id` disables delivery and removes that device's queued alerts. Registration and status responses never return device tokens.

`GET /v1/notifications/status` reports `{configured, environment}`. Configured means valid server signing configuration, not verified Apple delivery. The registration environment must match the server. A mock backend never sends APNs requests.

Completion, failure, uncertain outcome and stopped-call transitions enqueue generic alerts without customer, business, phone, transcript or appointment details. Tapping an alert fetches the current task using authenticated API access. An alert never approves an action. Task IDs are opaque identifiers; they are not credentials.

The encrypted database stores device tokens and a durable outbox. Each task/status/outcome is deduplicated per device. Transient failures retry at bounded exponential intervals, up to six attempts and within 24 hours; invalid/unregistered tokens are removed. APNs collapse IDs reduce duplicate alerts after ambiguous failures. Queue records expire after seven days. APNs acceptance is not delivery confirmation, and crash/network boundaries cannot guarantee exactly-once delivery. In-app task refresh remains authoritative.

## Provisioning before live testing

Set `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, `APNS_ENVIRONMENT`, `APNS_TOPIC_IOS` and `APNS_TOPIC_WATCHOS` on the backend. Use an Apple ES256 `.p8` signing key with permission for the chosen environment/topics. Never commit it. Enable Push Notifications for the corresponding Apple application IDs and sign clients with matching provisioning/entitlements. Native build instructions describe the opt-in signing settings; ordinary unsigned builds do not demonstrate push readiness.

For an independent Watch app with a companion, register both devices so Apple can choose the notification destination. Apple documents that remote notifications are best effort, and device state may defer delivery.

Sources: [APNs requests](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns), [token signing](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns), [Watch notifications](https://developer.apple.com/documentation/watchos-apps/enabling-and-receiving-notifications).

## Verification status

Automated tests cover configuration, token validation, opt-in/out, private payloads, deduplication, retry persistence, expiry, invalid-token removal and account-authenticated shared task access. No real APNs notification has been sent or received as part of this implementation. Apple provisioning and device acceptance remain required.
