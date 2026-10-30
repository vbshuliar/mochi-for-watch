# Current answers through Meta web search

Implemented and checked on 27 October 2026.

## Experience

Ask Mochi a current-information question, such as “search online for the latest Apple announcement” or “what's the weather in London today?” The Meta planner chooses search for current facts, recommendations and explicit lookups, resolves follow-ups from recent conversation, and asks for a location when needed. Ordinary conversation keeps its existing streaming path. Calendar questions continue to use Calendar tools.

Mochi stays in the existing thinking animation while searching, then speaks a short answer. Search does not add extra visible processing states. Citation markers and URLs are removed from speech; source titles and links travel separately with the answer.

- Browser emulator: sources appear in a compact expandable log row.
- Updated iPhone app: source links appear in conversation activity.
- Updated Watch app: tap a sourced answer's caption to open the source list.
- Existing installed apps can receive spoken search answers from the deployed backend immediately. The new source-viewing UI requires installing updated native builds. Phone and Watch session histories are separate.

The Web Search connection reports availability through Meta without an additional login or a pretend connect switch.

## Implementation

`backend/src/meta.ts` selects a private `web_search` plan. `backend/src/search.ts` calls Meta's `/v1/responses` endpoint with `tools: [{type: "web_search"}]`, the existing `MODEL_API_KEY` and configured `META_MODEL`. There is no alternate model or search provider. Meta usage goes through the existing account and credits; hosting and ElevenLabs are unchanged.

The search request uses `store: false`, at most two tool calls and a 1,600 output-token limit. It inherits the existing 25-second provider timeout and turn cancellation signal. Cancellation aborts our request; it is not a guarantee that Meta reverses incurred usage.

Search output is held until the terminal completed response. It must contain a completed search call, a final answer of at most 500 characters and at least one valid provider source URL. Commentary messages are excluded. Truncated streams, incomplete responses and missing sources fail closed. When Meta omits citation annotations, the adapter uses the documented `include: ["web_search_call.results"]` output from completed search calls. Those links are labelled “Search result”, rather than claimed to be citations for particular statements. Citation annotations take precedence when present. Only HTTP(S) URLs without embedded credentials are retained, deduplicated to eight links. Model-authored source fields from ordinary chat are discarded.

Replies add optional `sources: [{title, url}]`. Session history and idempotent retries retain the sources. `/v1/status` adds `webSearch`, which indicates live-mode configuration, not a real-time provider health probe. Mock mode does not pretend to perform a live search.

## Verification and limitations

- 49 backend tests pass, including search routing, citation validation, cancellation, incomplete streams, commentary filtering, retry persistence and safe failure messaging.
- 34 browser tests pass; native checks include 12 host tests and successful iPhone/Watch SDK builds.
- A live Meta test returned a current answer with a source in about 8 seconds. A deployed Fly streaming request also returned a final answer and citation. This is a smoke test, not a latency benchmark or a guarantee of factual correctness.
- An official Apple Newsroom query exposed a provider limitation: Meta completed searches but sometimes omitted citation annotations. The first implementation rejected these answers. After reproducing the same issue for UK and Ukrainian officeholder queries, it now retains provider-retrieved result links as described above. If both citations and usable retrieved sources are absent, it still returns “couldn’t verify that online; please try again”. No model-written URLs are promoted to sources.
- Search diagnostics record success/failure, source kind/count and validation reason without logging questions, answers or source URLs. Historical logs recorded only transport status and generic timeline errors, so exact causes cannot be reconstructed for older failed turns.
- Two model stages (routing, then search) make current-information answers slower than ordinary chat. Partial search drafts are deliberately not spoken before citation validation.
- The planner decides when to search; test realistic phrasing and follow-ups on-device. Sources improve checkability, but search results and generated summaries can still be wrong.


## Reliability follow-up — 27 October 2026

The user's session timeline recorded two completed replies followed by three errors at 16:23:22, 16:23:32 and 16:23:43 UTC. Each failed turn took roughly 4.7–5.2 seconds; cancellation calls followed the errors, rather than causing the recorded failures. HTTP 200 on the stream only means the stream opened, not that its final event was successful. Older logs did not retain detailed error reasons.

Replaying the reported UK prime-minister and Ukrainian-president questions reproduced `search_unavailable`: Meta returned a completed search and answer but zero annotations. Requesting the documented raw search results fixed that case while preserving real source URLs. Four live checks of the changed adapter passed (both officeholder questions and London weather twice); three used labelled retrieved results and one used citations. Latency in that small sample was 8–10 seconds. This validates the failure mechanism and recovery, not every future query or every factual claim.

After deployment, all four questions passed sequentially in one temporary Fly session, including the repeated weather question: 6.1 s, 4.1 s, 4.6 s and 4.6 s. Each returned source links. The temporary session was deleted successfully after verification.
