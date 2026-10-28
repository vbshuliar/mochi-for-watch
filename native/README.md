# Muse for Watch · native apps

Two SwiftUI applications, one shared conversation engine. The iPhone handles connections and pairing; the Watch presents Jolly and a single status line. This is a private single-user hackathon client for the existing backend, not an App Store release or a multi-user authentication system.

See the [native simulator captures and verification record](Verification/README.md).

## Open and run

Open `MuseForWatch.xcodeproj` in Xcode. The generated project is committed; XcodeGen is only needed after editing `project.yml` (`xcodegen generate --spec native/project.yml` from the repository root).

- **MusePhone** builds the iPhone app and embeds the Watch app.
- **MuseWatch** runs the Watch app directly.
- Minimum deployment targets: iOS 17 and watchOS 10. The Watch layout is designed for Apple Watch SE 2, 44 mm (184 × 224 points / 368 × 448 pixels); it adapts to the space SwiftUI provides, including system safe areas.
- Choose your Apple development team in both targets for physical-device signing. Change both bundle IDs and the Watch’s `WKCompanionAppBundleIdentifier` together if your team needs unique identifiers.
- Install the iOS and watchOS simulator runtimes in Xcode Settings → Components before running simulators.

## Connect your development build

Provider keys stay on the backend: in local `backend/.env` for development or Fly secrets for the hosted service. Neither app contains Meta, ElevenLabs or Google client secrets. The app access token is a separate credential for this **single-user** backend. Both apps store their connection in device-only Keychain entries; WatchConnectivity copies setup from the paired iPhone.

For the existing hosted installation, follow [private deployment and import](../docs/private-deployment.md#connect-iphone-and-apple-watch). The helper below reads the **local** backend token; do not use it to overwrite the hosted connection file.

1. Start the backend using its normal documented setup. Use `APP_MODE=live` for Meta and Jessica.
2. For **simulators on your Mac**, generate a private connection file:
   ```sh
   node native/scripts/connection.mjs http://127.0.0.1:8787
   ```
3. For **physical devices**, expose your backend at a reachable HTTPS origin and pass that origin to the same script. `localhost` on a Watch means the Watch, not your Mac. Arbitrary insecure remote HTTP URLs are rejected.
4. In the Debug iPhone app, tap the top-right **Connection** (link) button to open **Demo connection → Import connection file** and select `native/Local/connection.json`. Move it to your phone privately if needed. Do not publish or commit this file. If the simulator Files picker cannot access your Mac file, the same hidden screen accepts the backend origin and `API_TOKEN` manually; use the app access token, not a provider API key.
5. Open both apps; setup syncs automatically. **Sync with Apple Watch** in that same hidden Debug screen retries delivery if needed. WatchConnectivity delivery is asynchronous and requires real pairing; independent simulator installs may need a simulator pair to exercise it.
6. Tap Jolly to start talking, then pause or tap again to finish. Tap during a reply to interrupt and start a new turn.

The setup toolbar button exists only in Debug builds and does not add developer rows to the normal iPhone interface. A public Release distribution needs a real user sign-in/device-pairing service before it is ready to ship; the existing backend has one Calendar connection and one shared app token. Do not give this demo token to unrelated users.

## What is native

- `Shared/JollyView.swift`: Canvas renderer using the same plush face plate, bead-eye contours, mouth shapes, head movement, blinking and looking around. One heart burst per affectionate turn, retained across speech start. A 1.4-second speech-to-idle settle and quicker 0.4-second mouth closure. Reduced motion and inactive-scene pausing.
- `Shared/ConversationModel.swift`: tap-to-talk flow, context-bearing sessions, bounded activity log, streamed sentence scheduling, interruption ownership, local repeat/stop commands, Calendar proposal review, and minimum one-second captions.
- `Shared/AudioController.swift`: native audio session, 24 kHz mono PCM conversion, input-driven head scale, Jessica MP3 playback. Microphone permission is requested only when the user taps to talk.
- `Shared/RealtimeTranscriber.swift`: authenticated WebSocket transcription while speaking. Partial text never executes an action. Recorded WAV is an in-memory fallback if final live transcription fails. No microphone recordings are written to disk.
- `iPhone/`: native inset-grouped Lists, NavigationStack, actual connector logos, Calendar switch, Google browser sign-in, reconnect/disconnect. Unimplemented connectors remain visible and explain their availability on the detail screen.
- `Watch/`: one head and one caption. Calendar proposals open a separate review sheet with title, start/end, timezone and explicit confirmation.
- `MuseCore/`: Foundation-only models, API client, endpoint detector, sentence splitter, reaction rules, WAV encoder and motion math with unit tests.

## Calendar

Use the backend’s Google OAuth setup guide, including the correct HTTPS callback for a device-accessible deployment. The iPhone’s **Connect with Google** opens Google in the system browser; return to the app after consent. The connection screen polls briefly and refreshes when the app becomes active. Tokens are kept on the backend. Removing the local connection does not revoke Google’s grant; revoke it from Google account settings if desired.

The iPhone and Watch create separate conversation sessions. Approve a Calendar proposal on the device where you requested it. Uncertain saves retain their proposal and offer an explicit verification retry; they never silently claim success or create another event.

## Verification

```sh
native/scripts/check.sh
# After building the Node backend:
node native/scripts/smoke.mjs
```

The host-side verification package compiles the exact production conversation model with injectable audio/transcription interfaces. Its tests cover heart timing, playback completion, interruption and background suppression without needing microphone permissions. The shared-package tests cover authorization transport, connection validation, affection/context selection, silence endpointing, cumulative sentence framing, PCM WAV format, bounded motion and easing. Build checks compile both apps for Apple SDKs without requiring a signing identity. The native smoke script starts a temporary mock backend, exercises the Swift URLSession client against its real HTTP endpoints, and removes its fixture database afterward. It never uses live provider credits or your Calendar. Existing backend and browser tests remain separate.

Before the demo, test on your SE 2:

- Microphone permission denied, later allowed, silence/no-input and interrupted recording.
- Natural pauses, short answers, noisy surroundings and a 55-second recording limit.
- Actual built-in-speaker route and volume, optional Bluetooth route, first voice playback, and interruption mid-sentence. Short `.playAndRecord` sessions are used; long-form media routing is not requested. Simulator success does not prove speaker routing on SE 2.
- Locked phone, phone out of range, Wi-Fi failure, slow provider, playback failure, Watch wrist-down and app backgrounding.
- “Hey Jolly, I really love you”: expression first, one floating-heart burst, mouth moving during speech, smooth idle return.
- Calendar consent denied, disconnected/disabled, create/confirm/cancel, uncertain save recovery.
- Real display readability, Dynamic Type/VoiceOver, reduced motion, battery and 30 fps rendering.

## Scope limits

The native renderer reproduces the browser design in SwiftUI; it is not a WebView or a claim of pixel-perfect device parity. Native speech gestures are procedural, not phoneme-aligned lip sync. WebSocket availability, voice routing, pairing and background restrictions must be verified on the real Watch. The app does not keep recording in the background. Future connectors are not fake integrations.

Apple references: [WatchConnectivity](https://developer.apple.com/documentation/watchconnectivity/transferring-data-with-watch-connectivity), [audio input node](https://developer.apple.com/documentation/avfaudio/avaudioengine/inputnode), [watchOS audio activation](https://developer.apple.com/documentation/avfaudio/avaudiosession/activate(options:completionhandler:)).

## App icon

The included launcher icon is a static render of the native Jolly component. To regenerate it on a Mac, run `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift native/scripts/render-icon.swift "$PWD/native"` from the repository root.

## Web-search sources

The deployed backend can answer current-information questions on existing installed clients. Updated native clients also decode source links: iPhone shows them in the conversation activity; tapping a sourced Watch caption opens a source list. These UI additions require rebuilding/installing the updated apps. iPhone and Watch conversation histories are separate; source history does not automatically sync between them.

## Personal memory

The home screen’s **Memory** row opens saved facts shared with the Watch. Add, edit, delete or forget all with confirmation. Memories are stored on the private backend, not only in this client. See [memory behaviour and API](../docs/memory.md). Install an updated iPhone build to access this screen.

## Gmail and Notion

Native connection views support Gmail OAuth, Notion OAuth and destination selection. Document proposals show their full text and destination for confirmation on both phone and Watch. See [setup and limits](../docs/gmail-notion.md). Install updated clients before testing document approvals; installation remains deferred.

Booking reviews on iPhone and Watch show each allowed window for flexible requests. Older single-window proposals still decode. Install an updated build to see the separate windows; app installation remains a manual follow-up.


## Background booking cards

After call approval, booking progress has its own review button and does not block talking to Jolly. The backend continues the call while the app is inactive; the apps refresh the tracked task when reopened. Session/task pointers and dismissed-card IDs are scoped to a hash of the backend connection and stored locally. Ordinary replies cannot erase a running booking.

Completion cards wait until recording, thinking, speech, and foreground approvals finish. The compact card replaces Jolly until dismissal or another conversation, respecting Reduce Motion. Only a verified `booked` outcome is titled **booking confirmed**, with the actual booked start displayed in the viewer’s device timezone using a compact 12-hour clock (for example, `Fri, 6 Nov · 3:30 pm`), without a timezone label. Full call review retains the booking timezone. Other outcomes retain their honest summary. Review offers stop/refresh controls, including uncertain calls. Calendar writes still require a separate explicit approval. Dismissed completion cards do not reappear after refresh or restart.

These are in-app cards, with catch-up on resume. This feature requires no APNs setup, system-notification permission, or paid Apple developer membership. It does not promise delivery while the app is suspended. Building remains unsigned; installation is a separate manual step.

## Shared tasks, changes and notifications (28 October 2026)

Both clients load the private account's task feed from authenticated `GET /v1/tasks`. A fresh device can see bookings created by the other device; conversation histories remain separate. Reviews keep the task's original session identity for approval, stop and Calendar operations. Opening a task retrieves any linked pending Calendar approval. The iPhone has a Tasks entry; the Watch keeps its Tasks page. Foreground polling checks active work every three seconds and idle feeds every fifteen seconds, and stops when the app is inactive.

Confirmed bookings offer **Reschedule booking** and **Cancel booking**. These prepare a new call proposal; they never dial immediately. A reschedule selects an allowed window in the booking's timezone. Review shows the original appointment and the requested change. Jolly must obtain a verified result from the business; any Calendar update or removal has its own clearly labelled approval. Superseded bookings link conceptually to the newer task and no longer offer change controls.

Push delivery is implemented for both iPhone and independent Watch tokens, with explicit notification permission and task refresh on tap. Alerts contain generic task text, never the business, phone number or appointment details. The default development build has `MUSE_PUSH_ENVIRONMENT=disabled` and honestly reports that provisioning is needed. It continues to show task results in-app. Remote delivery has **not** been verified on hardware.

To enable actual push delivery later:

1. Enable Push Notifications for both app identifiers in the Apple developer account and create compatible signing profiles. Use the app's actual bundle identifiers as the server topics.
2. Set each target's `MUSE_PUSH_ENVIRONMENT` to `development` for sandbox signing or `production` for distribution, and `CODE_SIGN_ENTITLEMENTS` to `Resources/Push.entitlements`. The environment must match the signing profile and backend `APNS_ENVIRONMENT`. Do not set this on an unsigned or unprovisioned build.
3. Configure the backend APNs signing key, team/key IDs and separate iOS/watchOS topics. Keys stay server-side.
4. Install both signed clients. Enable updates from Tasks → Notifications on each device. Test with the apps inactive and confirm tapping an alert opens the correct refreshed task without granting any approval. System routing determines which paired device presents an alert; simultaneous delivery is not guaranteed.
5. Disable updates and confirm server registration removal. Revoking notification permission in system Settings also removes the registration on the next app refresh.

## Device acceptance checklist

The owner requested builds now and physical-device testing later. No device install, live telephone call or Calendar write is authorized by running these checks.

- Install the new signed iPhone and Watch apps; connect them to the same private backend. Start a booking on one device, review it on the other, and confirm duplicate taps do not dial twice.
- With a separately approved call to a ready consenting test recipient, verify original booking, reschedule and cancellation outcomes against the recipient's actual words. Separately approve and verify each Calendar change.
- Speak on Watch, pause naturally, interrupt speech, lower the wrist while recording/thinking/playing, reopen, and verify old audio never resumes or triggers an action.
- Repeat with Bluetooth audio connected, then disconnect during recording and playback. Verify recording stops and the next tap safely establishes the current route.
- Repeat after losing connectivity; confirm the app offers a clear retry and never retries a call automatically.
- Inspect the iPhone conversation activity entry `First audio: … ms after input finished`. This uses monotonic time from completing input capture (or submitting text) to the first actual playback callback, once per turn. It is client-observed latency, not a provider estimate or a timing guarantee. Record at least ten real Watch turns and report median and slowest values, including endpointing separately.
- Compare battery consumption and animation smoothness over a real session, including inactive periods and Reduce Motion. Automated checks cannot verify physical battery impact, microphone quality or wrist-down routing.
