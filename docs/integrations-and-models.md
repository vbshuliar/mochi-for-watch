# External integrations and Meta models

Updated: 26 October 2026.

> **Status:** Proposed integrations and reported model capabilities. Account eligibility, permissions, access, costs and API contracts must be validated before implementation commitments.

[Documentation index](README.md) · [Original brief](sources/original-project-brief.md) · [Open questions](open-questions.md)

## Account availability — 26 October 2026

The user has a personal Google Calendar account and may connect Instagram if the feature is chosen. No OAuth or permissions test has run. The expected $150 Meta credit allocation has not been confirmed claimed or applied. Instagram's priority below is inherited from the starting brief and remains undecided; Calendar is the recommended first validation candidate.


## External Service Integrations

### Instagram

Instagram is the strongest Meta-specific integration.

The official Instagram APIs support operations involving eligible professional accounts, subject to the relevant permissions and access requirements.

Potential features include:

- Listing supported media.
- Reading comments.
- Retrieving eligible insights.
- Replying to comments.
- Publishing supported media content.

Personal Instagram accounts do not automatically provide the same API capabilities.

#### Recommended MVP workflow

Retrieve the latest comments on one professional Instagram account.

Ask Muse Spark to identify relevant questions.

Generate a reply.

Display it for approval on Apple Watch.

Publish the response after authorisation.

Retrieve or verify the API response and report success.

#### API risk

Meta permissions may require app configuration, account roles or App Review.

We should confirm that a developer-controlled account can execute the necessary operations before committing to the full workflow.

If Instagram integration becomes difficult, we should switch to an easier verified action rather than weaken the entire demonstration.

### Facebook Pages

Facebook Pages provide another Meta-native integration opportunity.

The application could:

- Retrieve Page content.
- Summarise recent activity.
- Draft Page updates.
- Publish approved Page posts.
- Manage supported comments.

This applies to Pages the authenticated user is authorised to manage, not unrestricted posting to personal Facebook profiles.

We should choose Facebook or Instagram as the primary integration rather than implementing both simultaneously.

### Google Calendar

Calendar is a useful second integration because it demonstrates non-Meta tool execution.

Potential flow:

1. User asks Jolly for available time.
2. Muse Spark requests calendar information.
3. The backend retrieves events.
4. Muse Spark identifies suitable availability.
5. Jolly proposes a time.
6. User approves.
7. The backend creates the event.
8. The watch confirms success.

OAuth account setup and safe token storage are required.

For the hackathon, Google Calendar may serve as a more predictable fallback if social-media API permissions are delayed.

### Research tools

Research requires access to a real information source.

We can implement a search provider or another authorised retrieval integration.

Muse Spark can then reason over the returned source information.

Research responses should distinguish retrieved evidence from model-generated interpretations.

The initial research bot should stay simple and should not become a large autonomous browser automation project.

## Meta Model Capabilities We Will Showcase

The hackathon specifically encourages developers to go beyond basic model integrations.

Our project should make Meta's intelligence central to its functionality.

### Muse Spark 1.3

Primary uses:

- Intent understanding.
- Multi-turn conversation.
- Specialised agent instructions.
- Tool selection.
- Multi-step reasoning.
- Structured responses.
- Interpreting API results.
- Planning actions.
- Producing concise responses for Apple Watch.

The key demonstration is that the model can translate a high-level user intention into a sequence of useful operations.

### Muse Voice Transcribe

Primary uses:

- Speech-to-text.
- Natural voice commands.
- Short audio transcription.
- Multilingual interaction where supported.
- Potential future real-time transcription.

Using Meta's own speech model ensures that Meta AI powers more than just the reasoning stage.

### Muse Wonder

Muse Wonder is Meta's more capable model aimed at complex, long-horizon agentic work.

It is not necessary for the first MVP.

We may test it as an optional model for particularly difficult multi-step tasks, but should not introduce a more expensive or complex model without a demonstrated benefit.

### Muse Image

Muse Image enables image generation and editing.

Potential future use:

"Create an Instagram graphic announcing tomorrow's hackathon."

This could become a compelling feature for Jolly, but producing and approving visual content on a watch introduces interface challenges.

Image previews would be better displayed on an iPhone, web dashboard or shared link.

Muse Image is therefore a stretch feature, not part of the minimum viable build.

### Meta open-weight models

Meta also provides Muse Glimmer and Muse Spark Open.

They are relevant to the separate open-weight bonus prize.

However, using them would require hosting or serving the models through suitable infrastructure.

For our ten-day project, we should prioritise reliable access to the managed Muse Spark API.

Open weights should be pursued only if there is enough time and a strong technical reason.
