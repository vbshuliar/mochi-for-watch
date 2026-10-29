# Shared tasks, booking changes and device acceptance

Prepared 28 October 2026. This is an acceptance procedure, not a record of a completed live test.

## Authorization and current evidence

The owner requested **prepare the test; do not call yet** and **build now; on-device testing later**. Do not dial, modify a real Calendar, install on physical devices or report hardware acceptance as part of test preparation.

Recorded earlier evidence: Calendar OAuth and availability reads succeeded; an initial live call connected but failed during conversation; later fixes passed synthetic checks. Existing Watch operation was confirmed previously, but updated feature installation and complete live booking acceptance remain pending. See [booking history](booking-calls.md) and [deployment](private-deployment.md).

## Automated preparation

From the repository root:

```sh
npm --prefix backend run format
npm --prefix backend run check:all
sh native/scripts/check.sh
```

The first command formats backend sources. The second checks backend formatting/types/build/tests, emulator behavior, animation and native host tests. The third builds native SDK targets as well. Verify the exact revision being shipped and preserve unrelated edits. Passing these commands does not verify external account grants, telephony, APNs or physical audio routing.

## Shared task acceptance

1. Create a pending booking proposal in one client and refresh Tasks on the other client. Confirm business, times and status match.
2. Review from the second client. Requests must retain the source task's session ID, while ordinary conversations keep their independent sessions.
3. With fixture providers, approve from both clients concurrently. There must be one call attempt and a consistent resulting status, never two calls.
4. Refresh while another client changes the task. An older network response must not replace newer state; an old approval must not start a second operation.
5. Restart or background a client and reopen it. Running, uncertain and recently finished work must be recovered from the backend.
6. Confirm errors keep the prior task visible and explicitly show that updates are unavailable.

## Live booking acceptance — pending owner readiness

Before any real attempt, confirm recipient readiness and obtain approval for that specific call. Use a consenting test recipient who understands the test and can confirm the exact outcome. Keep the test's identifiers, times and verification notes private; do not copy transcripts, phone numbers or credentials into public logs.

1. Verify deployed health, authenticated status and connected Calendar using read-only checks.
2. Request a booking from Watch, including allowed times and exclusions. Review the exact destination and window before approving the call.
3. Confirm the recipient hears Jolly identify itself as an AI assistant and seeks consent.
4. Offer one unavailable time, then one allowed time. Confirm the final appointment's date, time and duration verbally.
5. Verify that the app reports success only after the recipient explicitly confirms. Compare with the recipient's account of the call.
6. Review the separate Calendar proposal, approve it intentionally, then inspect the actual Calendar event and receipt. Retry the same request only to verify idempotency; it must not create duplicates.
7. Record the app/backend revision and outcome. A call connecting or ending is not a confirmed booking.

## Rescheduling and cancellation — separate approved tests

- Start from a verified existing booking. Preparing a change must not dial or edit Calendar.
- Review a rescheduling proposal with the original appointment and new allowed window; approve a new call explicitly. If no new slot is agreed, retain the original booking status honestly.
- After verified rescheduling, review the separate update to the existing Calendar event. Confirm that the original event is updated rather than duplicated.
- Prepare and explicitly approve a cancellation call. Only confirmed business cancellation permits a Calendar deletion proposal; deleting Calendar alone is not business cancellation.
- Test duplicate decisions, rejected changes, timeouts, lost callbacks and provider failures with fixtures first. Uncertain outcomes must keep a verification path and must not auto-redial.

## Physical Watch voice matrix — pending owner testing

| Scenario | Expected behavior | Evidence to record |
| --- | --- | --- |
| Tap while thinking/speaking | Old response loses ownership; new microphone turn starts; no late playback. | Screen/audio observation and bounded timing. |
| Wrist down/background while recording | Recording stops safely; no unintended submitted action. | Confirm microphone/voice state on resume. |
| Phone/Watch speaker and Bluetooth route | Correct audible route; route loss releases capture/playback cleanly. | Device, route and observed failure/recovery. |
| Network loss during reply | Honest recoverable error; no stale success or duplicate operation. | Error, reconnect and next successful turn. |
| Network loss after approval | Durable task stays pending/running/uncertain as appropriate. | Matching task state on both devices. |
| Short answers and natural pauses | No empty submissions or premature truncation. | Several utterances and transcripts checked privately. |
| Reduced Motion, text sizing, longer review | Readable controls and accessible approval details. | Physical screenshots/observations without secrets. |

Measure at least ten ordinary voice turns and a few task turns. Record last speech to first audible response, failed turns and route/network conditions. Report median and range; do not present one synthetic request as representative device latency. Observe battery and thermal behavior over an actual session without claiming a battery budget from simulator results.

## Remote notifications — pending provisioning and device delivery

1. Verify APNs credentials/topic/environment match the signed app capability. Missing configuration must be shown as unavailable.
2. Request notification permission only after the user opts in. Denial must leave in-app task updates working.
3. Register the device token over the authenticated API; never log the token. Verify invalid token cleanup and bounded delivery retry using mocks.
4. With a fixture or separately approved real task, background the app and verify an actual completion alert arrives. Open it and confirm the correct task is refreshed without automatically approving anything.
5. Verify duplicate callback suppression, permission revocation and reconnect behavior. APNs acceptance is not proof the person saw the notification.

## Acceptance record

| Gate | Status at preparation |
| --- | --- |
| Automated suites | Passed 28 October 2026 on an isolated staged snapshot: 152 backend, 74 emulator and 47 native tests, plus 26-state animation checks; formatting, TypeScript and backend build passed. |
| Native SDK build | iPhone with embedded Watch simulator and unsigned physical SDK builds passed; no installation performed. |
| Updated physical app installation | Deferred by owner. |
| Successful live booking and Calendar write | Pending; no call authorized in this pass. |
| Live rescheduling/cancellation | Pending separately approved test. |
| APNs device delivery | Pending configuration/signing and real-device test. |
| Voice routing, wrist-down, battery and device latency | Pending owner hardware session. |

Independent backend and client reviews were completed. Review fixes cover valid May/name confirmations, exclusion of only the verified source event during rescheduling, and notification opt-out during network errors. An isolated browser smoke test with explicitly synthetic booking fixtures verified shared task review, change proposals and failure recovery; its temporary servers were stopped. Live provider delivery and physical-device behavior are not established by these checks.

## Browser verification during this development pass

On 28 October 2026, 74 emulator tests passed, including cross-session decisions/restoration, stale response protection, preservation of shared tasks when starting a new conversation, booking change proposals and operation-specific Calendar review. An isolated local mock backend and gateway were opened in an actual browser with synthetic booking records: owner-wide Tasks and original/new appointment review rendered correctly, and unavailable telephony surfaced an error without dialing. Browser inspection exposed a polling/form reset issue and a hidden-review error path; both were fixed and covered by regression tests. The temporary servers and browser tab were stopped afterward.

These results are not live telephony, Calendar or physical Watch evidence. Aggregate validation remains required against the final integrated revision.

## 29 October private-release implementation update

Usual haircut setup, unified booking follow-through, reviewed recovery proposals, daily call-attempt limits, readiness, private one-time pairing and encrypted backup/restore tooling are implemented. Latest local aggregate validation: 196 backend, 94 browser and 58 native tests, plus the 26-state animation check. Debug and Release simulator SDK builds passed; unsigned physical SDK build passed before the final client lifecycle fixes (subsequent Debug/Release simulator builds covered those fixes). A real browser against an isolated mock server verified saving/refetching a synthetic profile and honest readiness states; no call was placed. Backup/restore was exercised against disposable encrypted databases, not the production volume.

Review regressions cover encoded pairing admin paths, revocation/expiry and push ownership, profile-load overlap, retry approval races, dismissed pairing results and reminder form retention. The earlier live/device acceptance gates remain pending; these implementation checks do not satisfy them. Public multi-user sign-in is deliberately out of scope after the owner chose private pairing and operations.
