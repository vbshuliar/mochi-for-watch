# Watch confirmation presentation

Updated 28 October 2026. Applies to the booking completion view and native call/Calendar approval sheets.

## Direction

Use a focused watchOS presentation: black background, clear status symbol, concise hierarchy, readable local appointment time and full-width capsule actions. Avoid a nested web-card border, decorative gradients or simulated watchOS chrome. Mochi is hidden while the completion view is visible and returns when it is dismissed or conversation resumes.

Completion times use the viewer’s device timezone and 12-hour am/pm; the stored appointment and its booking timezone are unchanged. The detailed approval view retains the destination, phone number, booking name, allowed periods and any uncertainty or unchecked-Calendar warning.

Confirmed bookings use a green success symbol. Failed or unverified calls must not reuse success treatment. “review booking” opens details; it does not save a Calendar event. Saving still requires its separate explicit approval. “done” dismisses the result without modifying the booking.

Native controls use system styles and semantic fonts, with vertical scrolling for small screens and larger text. The HTML preview approximates the hierarchy and touch targets; it is not a pixel-perfect implementation of system materials or haptics.

## References

- [Apple: Designing for watchOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-watchos/) — quick, glanceable interactions and shallow navigation.
- [Apple: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons/) — native control styling and full-width watchOS capsule actions.

The image `background-booking-card.png` is a synthetic layout example, not evidence of a live booking.
