# Native companion layout contract

## Reproduction target

Reproduce the structure, typography hierarchy, colours, interactions and character artwork with native SwiftUI components. This browser design is a reference, not a claim of pixel-identical native rendering. iOS versions, Dynamic Type, system fonts, display scale and accessibility settings change metrics. Verify in Xcode Simulator and on a physical iPhone before calling the port complete.

## Component mapping

| Web concept | SwiftUI equivalent |
| --- | --- |
| Gray background + white groups | `List` with `.listStyle(.insetGrouped)` and semantic system colours |
| Mochi profile, connections, permissions | `Section` with headers and footers |
| Large page title | `NavigationStack` with a large navigation title |
| Mochi portrait | `Image` asset, resizable, scaled to fit; preserve transparent padding |
| Single-line service name and connection indicator | `HStack` with semantic body text and an accessible connection status |
| Open service details | Button/navigation destination in the leading part of the row |
| Service enabled setting | Separate `Toggle`, `.toggleStyle(.switch)`, labels hidden visually but accessible |
| Service detail screen | Navigation destination with grouped permission rows and action buttons |
| Refresh | Toolbar button or `refreshable` on the list |
| Inset separators | Native list separators aligned to the leading text column |
| Fixed browser phone chrome | Do not port it; iOS supplies safe areas, status bar and home indicator |

## Layout rules

- 16-point outer grouped-list insets as a reference; let the system adapt to size class.
- Use system text styles rather than porting scaled browser CSS font sizes.
- Service symbols around 28 points, 10–12 points from the text column.
- Compact single-line service rows: 48 CSS pixels in this browser preview; use native List sizing with at least 44-point hit targets, growing for wrapped text and Dynamic Type. Descriptions belong on the service detail screen.
- At least 44 × 44 point targets. Do not scale down native switches to match the browser mock.
- Keep the name/chevron navigation target separate from the trailing switch. Never nest a Toggle inside a Button or NavigationLink.
- Use semantic grouped background, secondary text, separator and system blue. Native switch uses default green.
- Avoid drawing duplicate separators: let List own its separators; hide the final separator when needed.
- At accessibility text sizes, allow names to wrap and rows to grow rather than clipping names.
- Support VoiceOver labels: “Enable Google Calendar”, checked/unchecked state, connection status and unavailable state.
- Preserve reduced-motion preferences and keyboard focus on navigation back.

## State contract

Connection and enablement are different:

- Disconnected/unavailable: switch is off and disabled. Tap the row to connect or learn about availability.
- Connected + enabled: Mochi may initiate Calendar operations.
- Connected + disabled: credentials remain saved, but new Calendar reads, proposals and confirmations are blocked server-side.
- Updating: disable the switch until the server answers; restore the previous value on failure.
- Disconnect: removes local credentials, not existing Calendar events.
- Already-running external requests cannot be retroactively cancelled by a switch. Completed/cached results may still be returned; disabling prevents new provider operations.

`GET /v1/status` supplies `calendar` and `calendarEnabled`. `PATCH /v1/integrations/google` accepts `{ "enabled": boolean }`. The preference is stored in encrypted local storage and shared between emulator and eventual native clients. Other services remain unavailable, not simulated as connected.

## Primary references

- [Apple HIG: Toggles](https://developer.apple.com/design/human-interface-guidelines/toggles)
- [SwiftUI Lists](https://developer.apple.com/documentation/swiftui/lists)
- [InsetGroupedListStyle](https://developer.apple.com/documentation/swiftui/insetgroupedliststyle)
- [SwitchToggleStyle](https://developer.apple.com/documentation/swiftui/togglestyle/switch)
