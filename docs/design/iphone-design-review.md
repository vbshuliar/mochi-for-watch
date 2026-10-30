# iPhone companion design review

Reviewed 26 October 2026. Scope: companion setup screen in the web emulator.

## Findings

“AI slop” is subjective; visual patterns do not establish authorship. Designer commentary commonly criticizes interchangeable hero sections, vague benefit slogans, repeated rounded cards, arbitrary decoration, and weak hierarchy. Our first phone layout had a centered marketing hero, generic reassuring copy, muted low-contrast text, an unnecessary card wrapper and a decorative device footer. These obscured its actual task: connecting Calendar.

## Direction implemented

- Native-style setup screen: white background, dark text, system typography and a single blue primary action.
- A compact Mochi profile provides identity without a promotional hero.
- Direct copy describes Calendar access and confirmation behavior.
- Sections use spacing and separators rather than nested cards.
- Connection indicators reflect backend status; errors and consent are actionable.
- Fixed phone proportions, independent content scrolling, fixed system chrome.
- Preserve lowercase starts while retaining proper names such as Google Calendar and Mochi.
- Keep the watch and compact activity log unchanged.

## Sources and interpretation

- [SmoothUI: AI design slop](https://smoothui.dev/blog/ai-design-slop) — practitioner criticism of generic gradients, glass effects and identical card grids; opinion, not a validated detection method.
- [Nielsen Norman Group: usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) — relevance, hierarchy, system status and reducing unnecessary information.
- [Apple: small writing changes](https://developer.apple.com/videos/play/wwdc2025/404/) — remove filler and repetition; use consistent terms.
- [GOV.UK: writing for user interfaces](https://www.gov.uk/service-manual/design/writing-for-user-interfaces) — concise, direct copy and clear action names.

The visual choices above are our application of these principles, not a claim that a particular colour or font makes an interface human-designed.

## Placement refinement

The next pass keeps a compact Mochi profile beside a clearly labelled future-buddy placeholder. Connections now use aligned service rows instead of one large onboarding panel. Google Calendar has a direct inline connect button; refresh remains adjacent to the section heading. Both controls retain 44 CSS-pixel minimum touch dimensions. Permissions move to a disclosure below the list, reducing competition with the main action. Consent and errors appear immediately beneath Calendar.

Future rows reflect documented or discussed directions: Instagram, Facebook Pages, notes, reminders and web search. These are roadmap placeholders, not available integrations or finalized provider choices. No OAuth capability is implied for the notes/reminders/search placeholders. The phone keeps its fixed viewport and internal scrolling, so additions do not elongate the device.

## Service details

Every service now has a details button and a connection dot. Rows also open when their non-button area is clicked. Details explain purpose, access and availability. Google Calendar exposes connect when disconnected, and edit/reconnect plus disconnect once connected. Editing uses Google's consent flow to change account/access; there is no unsupported calendar picker. Planned integrations remain inspectable with disabled connect controls. Back navigation restores list scroll and keyboard focus.
