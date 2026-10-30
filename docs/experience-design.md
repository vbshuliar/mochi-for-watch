# Mochi experience design

Updated: 27 October 2026.

## Watch

One head and one short status line, with comfortable separation. Tap Mochi to wake and listen. While listening, microphone volume gently enlarges the head; no waveform or decorative waves. When speech ends, transition into thinking, then speaking when playback starts. Thinking includes smooth side-to-side glances.

Sleep and offline share a sleepy face. Idle includes subtle breathing, blinking and occasional glances. Brief emotional reactions return to neutral together with the eyes, mouth and head. Keep motion continuous across states; do not snap positions. Captions stay visible for at least one second. Preserve reduced-motion behaviour.

Target Apple Watch SE 2 44 mm, with a 368 × 448 rendering buffer in the browser. Hardware performance, display and accessibility behaviour require native testing.

## iPhone

A single Mochi profile above compact Settings-style connection rows. No buddy picker or “more buddies” placeholder. Service names begin with uppercase; each row has an icon, connection indicator, navigation chevron and independent enable switch. Descriptions live on the detail screen and refer to Mochi.

Connection authorisation and enablement are distinct. Disabled connections cannot initiate operations; disconnected services open details to explain setup or availability. Future integrations must not appear connected.

Use native SwiftUI List/Section, navigation and Toggle components when porting. See [layout contract](design/swiftui-companion-spec.md).

## Approval and accessibility

Explicit approval is required before external writes. Keep proposed action details and recovery outcomes understandable. Preserve readable text, accessible control labels, focus restoration, adequate hit targets and reduced motion. The log column is an emulator debugging aid, not part of the watch product.
