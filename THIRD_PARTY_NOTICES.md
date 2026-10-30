# Third-party notices

Mochi for Watch is an independent project. Its original code, documentation and project-created artwork are licensed under Apache-2.0, to the extent applicable rights are held. See [LICENSE](LICENSE) and [NOTICE](NOTICE). This grant does not relicense third-party material in earlier commits.

## Software dependencies

Exact JavaScript dependencies are pinned in `backend/package-lock.json`. Fastify, @fastify/rate-limit, ws and Zod retain their upstream licences; retain applicable notices when distributing their code. Node.js, Swift and Apple SDKs have their own licences and developer terms. Dependency package licence files are included by their upstream distributions, not replaced by this project's licence.

## Hosted services

The implementation connects to Meta Model API, ElevenLabs, Twilio, Google and Notion, and optionally Facebook Pages / Instagram. These services and their model weights are not part of this open-source grant. Users must supply their own accounts, credentials and any required permissions. Their terms, costs and privacy obligations continue to apply. Keeping accurate provider names in adapter code and setup documentation does not imply endorsement.

## Graphics

The current Mochi portrait and animation plate were generated for this project and selected by the owner; provenance is recorded in [the character guide](docs/design/mochi.md). Any rights held in these assets are included in the project licence; AI-generated material may not attract exclusive copyright protection in every jurisdiction.

Connection icons are original generic functional drawings, not provider logos. The website's generated watch illustration is documented in `website/IMAGE-PROMPT.md`; it depicts compatible hardware, is not a product photograph and grants no Apple trademark rights. Apple Watch is a compatibility reference. No third-party character artwork is included in the current release tree.

Older public commits may contain materials that are not covered by this licence. This release does not claim to clear or relicense those historical materials.
