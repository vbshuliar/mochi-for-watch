# Project knowledge base

Updated: 29 October 2026.

## Engineering handbook

| Guide | Start here when… |
| --- | --- |
| [Agent setup](agent-setup.md) | A coding agent or developer joins the repository |
| [Configuration](configuration.md) | Setting up environments and provider credentials |
| [Code map](code-map.md) | Tracing modules and cross-client contracts |
| [Runbook](runbook.md) | Releasing, verifying or recovering a deployment |
| [Troubleshooting](troubleshooting.md) | Setup or a provider flow fails |
| [Contributing](../CONTRIBUTING.md) | Preparing a change for review |
| [Security](../SECURITY.md) | Reporting vulnerabilities and understanding boundaries |
| [License status](../LICENSE.md) | Checking reuse rights before distribution |

## Start here

For the current product, start with the [project README](../README.md). To develop it, read [current architecture](architecture.md), [backend setup](../backend/README.md), and [verification](backend-verification.md). For the demo, read [booking calls](booking-calls.md) and [hackathon requirements](hackathon.md). Research and original briefs retain historical proposals; they do not override implemented behavior.

| Document | What belongs here |
|---|---|
| [Booking calls](booking-calls.md) | Meta-led phone bookings, approvals, provider setup and live acceptance |
| [Shared tasks and notifications](task-notifications.md) | Cross-device task access, opt-in APNs setup, delivery guarantees and verification limits |
| [Development acceptance](development-acceptance.md) | Final validation, approved live booking tests and physical Watch acceptance checklist |
| [Gmail and Notion](gmail-notion.md) | OAuth setup, email-to-document workflows, approvals and limits |
| [Personal memory](memory.md) | Cross-conversation facts, iPhone controls, API and privacy boundaries |
| [Web search](web-search.md) | Meta search routing, citations, client behaviour, verification and limits |
| [Muse Charm opportunities](research/muse-charm-opportunities.md) | Recent consumer features, public API boundaries and recommended integrations |
| [Private deployment](private-deployment.md) | Current Fly.io setup, operations, device import and retired Render deployment |
| [Cloud access investigation](meta-cloud-access-issue.md) | Meta diagnostics, evidence and successful Fly.io migration |
| [Native apps](../native/README.md) | Xcode setup, device pairing, voice implementation and physical-device checks |
| [Conversation quality](research/conversation-ux.md) | Turn-taking research, interruption semantics, live measurements and regression coverage |
| [Backend implementation](../backend/README.md) | Local setup, API, live-provider configuration, simulation, tests and deployment limits; [verification record](backend-verification.md) |
| [Sponsor credits](research/sponsor-credits.md) | Verified event partners, credit amounts, eligibility, claim routes and outstanding conditions |
| [User context](user-context.md) | Confirmed UI direction, SE 2 hardware, expected credits, available accounts and pending scope choices |
| [Market and product research](research/market-and-product-strategy.md) | Forum evidence, competitors, target audience, feature recommendation and validation plan; [source ledger](research/market-evidence-sources.md) |
| [Moment research](research/moment.md) | Public claims, provider evidence, documentation discrepancies and design implications |
| [Participant Guide record](sources/participant-guide-notes.md) | Structured extraction of the guide supplied in chat and corrections to the original brief |
| [Hackathon](hackathon.md) | Reported rules, tracks, themes, eligibility of models, originality, submission deadline, judging, prizes, credits and workshops |
| [Idea](idea.md) | Problem, audience, product promise, positioning and long-term vision |
| [Agents](agents.md) | Jolly’s identity, capabilities and permission boundaries |
| [Figma UI concept](design/README.md) | Editable Moment-inspired watch screens, linked Milo flow and preview |
| [Experience design](experience-design.md) | Watch screens, voice interaction, character states and accessibility |
| [Watch tasks](design/watch-tasks.md) | Swipeable progress, approvals and recent completions |
| [Watch confirmations](design/watch-confirmation.md) | Native-style booking results and explicit approval controls |
| [Architecture](architecture.md) | Watch-to-cloud flow, client, backend, approvals, storage, authentication and memory |
| [Integrations and models](integrations-and-models.md) | Implemented six-connector capabilities and live-setup boundaries |
| [Social connections](social-connections.md) | Instagram/Facebook OAuth setup, account selection and read/draft limits |
| [MVP and success](mvp-and-success.md) | Foundation, competitive target, stretch scope and acceptance criteria |
| [Roadmap](roadmap.md) | Tentative build phases and post-hackathon directions |
| [Quality, security and risks](quality-security-and-risks.md) | Functional/error testing, permissions, data handling, performance and mitigations |
| [Demo and submission](demo-and-submission.md) | Three-minute script and evidence aligned to judging |
| [Decisions](decisions.md) | Current stack and product preferences, all revisable |
| [Open questions](open-questions.md) | Unverified assumptions, missing information and decisions still needed |
| [References](references.md) | Supplied source links and their verification status |
| [Original brief](sources/original-project-brief.md) | Source snapshot with app naming normalized; historical specification |

## How to interpret this documentation

- **Supplied claim:** information stated in the original brief, including event rules and external API capabilities. This documentation pass did not independently verify those claims.
- **Working decision:** the current preferred product or engineering direction; it can change.
- **Proposed feature:** intended behaviour, not evidence that it exists.
- **Verified:** reserve this label for a dated primary source check or recorded test result. See the dated backend and realtime transcription verification records for tested capabilities.
- **Open:** a question or dependency still requiring evidence or a decision.

The user has now supplied the Participant Guide text. Its [structured record](sources/participant-guide-notes.md) supersedes conflicting event details in the original brief. [Moment research](research/moment.md) records dated public-source checks, and [user context](user-context.md) records direct preferences and available hardware/accounts. Live guide links and later amendments remain unverified.

## Maintaining context

Update the relevant topic document when a decision changes. Record the date, reason and supporting evidence in the decision log. Resolve questions with links or test results, and distinguish implemented work from planned work. Keep the original brief as a historical record; its app naming was normalized at the user’s request. Use the hackathon document as the home for event details and the MVP document as the home for scope.

The original source brief preserves the early multi-character proposal. Current product docs now describe one companion, Jolly. Topic documents are updated as new evidence arrives; the original archive remains unchanged. Current status notes and recorded corrections take precedence over the historical brief.
