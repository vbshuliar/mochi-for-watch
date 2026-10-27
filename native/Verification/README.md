# Native verification · 27 October 2026

The screenshots below are captures of installed native applications, not the HTML emulator.

| Watch | iPhone |
|---|---|
| ![Native Jolly on a 44 mm Watch simulator](watch-44mm.png) | ![Native iPhone companion](iphone.png) |

- Xcode 27.1 compiled the iPhone and Watch applications against simulator and physical-device SDKs without a signing identity.
- The installed watchOS 27 runtime cannot create an SE 2 simulator. The visual check uses **SE 3, 44 mm, 368 × 448 pixels**, as a display-size proxy. It does not prove compatibility or audio routing on the user's SE 2.
- The installed iOS 27.1 runtime exposes an **iPhone Duo** simulator. Its active exterior display was used for the iPhone capture; the system status area on the right belongs to that simulator.
- 17 host-side Swift tests pass: 12 core/API tests plus five tests of the actual conversation model with injected audio and transcription fixtures.
- The same five conversation-model tests also pass inside the iPhone simulator (Xcode result: 5 passed, 0 failed, 0 runtime warnings).
- The isolated native HTTP smoke test passes: status, session creation, reply streaming, Calendar proposal/cancel, cancellation-before-dispatch and session cleanup. It uses a temporary mock backend and cannot change a real Calendar.
- The resource bundle was checked after installation. Face artwork, vector connector logos and a native-rendered app icon are included in both apps.

## Pre-commit recheck

On 27 October, `native/scripts/check.sh` passed 12 host-discovered core/API tests and compiled the embedded iPhone/Watch apps for simulator and device SDKs. The earlier five conversation-model tests are a separate recorded simulator result, not five additional tests discovered by this host run.

## Physical-device pilot

The signed apps were subsequently installed on the paired iPhone and SE 2. After importing the Fly.io connection, the owner confirmed Jolly works on the Watch. This is an end-to-end user confirmation, not separate instrumentation of each audio/transcription path. See [deployment checks](../../docs/private-deployment.md).

## Remaining checks

Systematic microphone and speaker-route testing, real Google consent, battery use, wrist-down behavior and performance under poor connectivity. The simulator captures intentionally show an unconfigured device; provider keys are not embedded in the apps.

See [setup and device checklist](../README.md). All generated build products and test result bundles live in ignored `native/DerivedData/`; no signing identity or access token is committed.
