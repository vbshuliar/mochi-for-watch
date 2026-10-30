# Watch tasks

Mochi is the first Watch page. Swipe left to see tasks; swipe right to return. Two page indicators make this navigation discoverable.

The tasks page separates work into three groups:

- **In progress:** calls Mochi is currently completing, with the latest known progress.
- **Needs you:** an action awaiting review or approval. Opening it never approves it automatically.
- **Recently completed:** finished calls from the last 24 hours, including unsuccessful results with their actual outcome.

Tap a row to review details and use the existing controls. Stopping a call and saving a booking to Calendar retain their existing explicit actions. Appointments are not future tasks; scheduled automation is not part of this feature.

Task progress updates do not take the user away from a conversation. Completion cards retain their existing idle-only presentation. Appointment times use the device’s local timezone and 12-hour am/pm formatting.

The list spans conversations in the private account, so Watch and iPhone see the same booking tasks. Reviews retain each task's original session ID. New conversations preserve task history. Verified bookings offer reviewed rescheduling/cancellation; Calendar changes require their own approval. Optional [completion notifications](../task-notifications.md) require Apple provisioning and device permission; in-app refresh remains authoritative.

## Preview and validation

The browser preview uses the same task-page code as the emulator. The design fixture supplies synthetic calls, so opening it does not contact a business. Swipe over Mochi or use the page dots; vertical scrolling reveals longer task lists. The native app uses watchOS horizontal page navigation and semantic text styles.


Call history uses the server’s optional `finishedAt` timestamp for the 24-hour window. Undated legacy completions are not presented as newly completed. The server timestamp change must be included in the next backend deployment; native changes require a new app build on the device.
