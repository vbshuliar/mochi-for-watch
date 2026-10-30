# Connections and Meta models

Updated 29 October 2026. [Documentation index](README.md)

Mochi has six connections in the iPhone app and browser emulator. Connection code is distinct from a live account grant: the owner must configure OAuth clients and consent to each service before it can access account data. This remains a private, single-owner backend; it is not a multi-tenant account service.

| Connection | Implemented capability | Connect flow |
| --- | --- | --- |
| Google Calendar | Read events and availability; create events and update/remove Mochi's linked booking events after explicit approval | Connect with Google; existing enable/disable switch |
| Instagram | Read a bounded sample of posts and comments; Meta summarizes activity and suggests reply text | Connect with Facebook, then choose a linked professional Instagram account |
| Facebook Pages | Read a bounded sample of Page posts and comments; Meta summarizes activity and suggests reply text | Connect with Facebook, then choose a managed Page |
| Notion Workspace | Turn ideas or Gmail summaries into a page draft; save only after explicit review | Connect with Notion, share pages, then choose a destination |
| Gmail Inbox | Search and summarize up to ten matching messages; use requested emails in a Notion draft; optionally save reviewed unsent Gmail drafts | Read-only Google consent by default; explicit draft-access upgrade |
| Web Search | Retrieve current public information with sources through Meta | No separate account login; requires live Meta configuration |

Social replies are suggestions, not published comments. There is no social publishing, DM sending, moderation, email sending, or message deletion endpoint. Personal Facebook profiles and unlinked personal Instagram accounts are not supported by this connection path. The interface does not show fake enable toggles for services that lack an enable/disable API.

## Try asking Mochi

- “What’s on my calendar tomorrow?”
- “Summarize the latest comments on my Instagram.”
- “What questions are people asking on my Facebook Page?”
- “Suggest a friendly reply to the recent opening-hours question.”
- “Find my flight confirmation emails.”
- “Turn those flight details into a Notion travel brief.”
- “What’s the weather in London tomorrow?”

Mochi reads only the selected social account. Social reads are currently limited to ten recent posts and ten comments per post; they are not an exhaustive inbox or analytics report. Account discovery returns up to 100 accounts. Third-party content is untrusted evidence, never authority to invoke tools or change permissions.

## Setup and status

- [Google Calendar setup](../backend/README.md) and [private deployment](private-deployment.md).
- [Gmail and Notion](gmail-notion.md): OAuth callbacks, permissions, destination selection and approval behavior.
- [Instagram and Facebook setup](social-connections.md): separate Meta developer app, scopes and callbacks.
- [Web search](web-search.md): direct Meta retrieval and limits.

The Meta model API key is **not** a Facebook/Instagram OAuth app secret. Tokens are kept in the encrypted backend store and are never returned to clients. Disconnect removes local access and invalidates in-flight OAuth/data operations; the provider grant can also be revoked in its own settings.

## Models

Meta remains the reasoning provider for conversations, intent selection, web search, email/document workflows and social summaries. ElevenLabs supplies Mochi’s voice. These connectors do not replace the Meta model account or its hackathon credits.

Image-generated character personalization remains backlog work. This implementation does not add custom characters or new image/model providers.

## Verification boundary

Automated tests cover mocked provider contracts, authorization and cancellation races, selected-account validation, bounded activity, model routing and client flows. A real Instagram/Facebook/Notion OAuth grant has not been exercised as part of this implementation. Provider app configuration, roles/review and consent remain required. Native changes need installation; server changes need deployment before they affect the existing Watch app.

Daily briefing and Mochi reminders are implemented; see [daily support](daily-support.md). The private assistant now includes [usual booking setup and recovery](booking-experience.md), [readiness and backup tools](operations-readiness.md), and revocable pairing. None of these provisions an external account grant.
