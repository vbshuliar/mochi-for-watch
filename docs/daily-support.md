# Daily briefing, reminders and Gmail drafts

These supporting tools keep autonomous calling and booking as Jolly's main experience. “Book me a haircut” prepares a booking call using authoritative saved preferences; Jolly asks for missing details and presents the existing call approval. It does not replace arranging the appointment with a reminder or Calendar event. No call is placed until approval, and Calendar changes retain their separate review.

## Today

The iPhone Tasks screen, Watch and browser emulator expose Today. Ask “Brief me on today” for the same information by voice. The briefing leads with verified booking progress, then today's Calendar events, due reminders and a bounded recent inbox sample. Each source reports available, disabled, disconnected, unavailable or simulated. A failed source is never described as an empty day. Confirmed appointments include their date and time. Gmail content is not executed as instructions.

The briefing is on demand; it is not a scheduled morning message. Gmail uses up to ten recent inbox messages, not a complete unread count. Calendar and booking results remain explicitly simulated in mock mode.

## Jolly reminders

Create a reminder with a title, future time and timezone; optionally repeat daily or weekly. Complete, snooze or delete from Today. These reminders are stored in Jolly's encrypted backend and shared across the paired clients. They do not sync with Apple Reminders.

Due processing survives restart. Recurrence preserves local wall time across daylight saving transitions, shifting nonexistent times forward and choosing the earlier occurrence for repeated times. Missed recurring occurrences are aggregated rather than replayed as an alert storm. Stable creation IDs prevent duplicate reminders after a lost response.

When APNs is configured and the user has enabled notifications, due reminders enqueue a generic private alert. Completion, snooze or deletion suppresses alerts still in the queue. APNs acceptance is not proof of device delivery. Without provisioning, reminders remain visible in Today; no push delivery is claimed. The backend must be running for timely processing.

## Gmail drafts

Gmail remains read-only by default. Enable draft access explicitly in the iPhone Gmail connection settings or the browser Today panel and complete Google's OAuth consent. The OAuth app must allow `https://www.googleapis.com/auth/gmail.compose` alongside `gmail.readonly`. Google's compose scope includes sending, but Jolly's Gmail transport only permits the draft-create mutation and exposes no send endpoint.

Ask for a draft with an exact recipient email address, subject and body, or use the browser composer. Review the full recipient, subject and body, then choose **Save draft** or **Cancel**. Preparation is local; Save draft creates an unsent draft and verifies its returned content. The saved result never claims an email was sent. Gmail drafts require live mode and a connected account with the explicit draft grant.

A lost provider response becomes an unverified save. Verify again reconciles the original Message-ID and exact content; it never repeats the create request. If the original draft cannot be verified, check Gmail. Account changes invalidate pending save authority, and an unresolved save prevents deleting its conversation receipt.

## Validation and remaining acceptance

Automated tests cover reminder persistence, deduplication, recurrence/DST, unavailable briefing sources, Gmail permission upgrades, MIME fidelity, approval, account changes, ambiguous writes and integration routing. Native host tests and unsigned SDK builds cover client contracts. Real OAuth acceptance, Gmail draft creation, live calls, APNs delivery and on-device behavior remain separate acceptance steps; this implementation does not exercise those services.

Provider references: [Gmail draft guide](https://developers.google.com/workspace/gmail/api/guides/drafts), [Gmail draft listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/list).
