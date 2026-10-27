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
