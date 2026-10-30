# Public history maintenance

Reviewed 30 October 2026.

## Cleanup scope

The audit inspected 66 commits, 342 historical paths and 879 distinct file versions. The rewrite removed 166 obsolete file versions: previous character art and app icons, screenshots and videos containing the previous designs, third-party connector logo variants, retired research/source documents, and superseded brand/design presentation files. Identical copies were removed by Git object identity regardless of filename.

The current application tree was verified byte-identical before adding this maintenance documentation. Original implementation history, current Mochi assets, Apache-2.0, required notices and functional provider integration references were retained. Four commits became empty after removal; the remaining 62 implementation commits were preserved with new identifiers.

A private offline Git bundle and removal manifest were retained outside the repository. Do not publish them. Automated secret scanning found no confirmed credential: its sole finding spanned an empty API-key setting and the next line's public voice identifier. Automated checks do not establish legal clearance or guarantee the absence of every possible secret.

## Existing clones

Clone the repository again instead of merging an old branch into the rewritten history. If a checkout contains unfinished work, save a source-only patch privately, inspect it for removed resources and credentials, then apply it to a fresh clone. Never use a mirror push from an old checkout. Do not commit private archives or rewrite mappings containing removed content.

## Future contributions

- Record the source and redistribution permission for new assets; use original artwork when permissions are unclear.
- Keep vendor service names and required licence notices accurate. API access does not grant rights to redistribute brand artwork.
- Keep credentials, personal connection details, provider exports and reference-image archives out of Git.
- Run the validation contract in AGENTS.md before publishing changes.

## Limits

A rewritten branch does not erase copies already downloaded elsewhere. GitHub may retain old commit pages or cached objects addressed by their old identifiers. The repository owner may need to contact GitHub Support about host-managed retention. No external forks, pull requests, releases or uploaded Actions artifacts were reported by GitHub at the time of this audit. This is a point-in-time observation, not a permanent guarantee.
