# Reply latency investigation — 3 November 2026

The dominant measured delay was the Meta planner's reasoning pass, not voice
generation. The voice path already uses Eleven Flash v2.5, with speaker boost
disabled. Production stays running in London; cold machine startup was not the
cause in these measurements.

## Measurements

Provider requests ran from the deployed London backend, using its actual planner
and full system instructions but only synthetic prompts, without owner context,
a database, or action execution. These are server measurements, **not Watch
microphone-to-speaker acceptance**. Network and provider load vary.

| Prompt | Current `low` total model time | `minimal` total model time |
| --- | ---: | ---: |
| Greeting, first sample | 6,991 ms | 2,671 ms |
| Greeting, second sample | 3,725 ms | 2,508 ms |
| Why is the sky blue? | 4,280 ms | 3,411 ms |
| Haircut request missing details | 6,565 ms | 4,753 ms |
| Hypothetical booking explanation | 4,577 ms | 3,240 ms |
| Synthetic favourite-colour memory request | 3,905 ms | 2,829 ms |

Median: 4,428.5 → 3,034.5 ms (31.5% lower). All six pairs produced the
expected plan kind at both settings; this small sample is not a comprehensive
model-quality evaluation. No proposed memory or booking action was executed.

Four greeting voice generations took 175–380 ms. A generated 1.625-second
greeting sent through the actual realtime transcription bridge returned its final
transcript 521 ms after end-of-audio. Opening that stream took 2,311 ms, which
normally overlaps listening but can matter for very short utterances. No owner
recordings were read or transmitted.

## Change and remaining costs

Default and deployed `META_PLANNER_REASONING_EFFORT` are now `minimal`, a supported
setting with a shorter reasoning pass. Explicit overrides remain available. Search,
document and social synthesis retain their existing `META_REASONING_EFFORT=low`;
those paths were not benchmarked. Full planning
instructions, schema validation, destination allowlists, approval gates,
idempotency, and uncertain-outcome handling are unchanged.

The native endpoint detector deliberately waits 900 ms of silence after a normal
transcript (longer for incomplete phrases). This remains unchanged to avoid
cutting off speech. The app buffers complete sentences and downloads each audio
clip before playing it. For measured greetings, first text preceded model
completion by only 117–280 ms, so changing audio transport would not address the
main observed delay. Clarifications/actions wait for validated results. Search
requires a separate verified result and will still take longer.

Realtime transcription failures can wait up to the existing finalization timeout
before uploading recorded audio. This fallback was not observed in the synthetic
test; repeated device delays should be checked against the app's Activity entries
for fallback and first-audio timing before changing timeout or transcript safety.

## Repeat safely

Build the backend, then run against a dedicated live provider environment:

```sh
npm --prefix backend run build
node --env-file=/path/to/private-provider.env backend/scripts/benchmark-reply.mjs --live
```

This explicitly opt-in script runs eight planner invocations using fixed public
synthetic text. It imports only the planner, loads no owner records and never
executes a plan. Search is disabled even if the model unexpectedly requests it.
It prints timings and plan kinds, not generated content or keys.
Fast greetings use no model request; remaining invocations make paid requests.
Keep credentials out of command arguments. More samples and a device rehearsal
are needed to characterize tail latency.

## Follow-up: instant generic small talk

Fresh conversations and consecutive small-talk exchanges now use a deterministic
fast path with over 100 phrases across nine categories: greetings, wellbeing,
presence, identity, AI/person questions, capabilities, thanks, farewells and
compliments. Greetings return “hello”; all wellbeing variants share one reply.
Addressing Mochi, greeting prefixes, punctuation and common contractions are
normalized. This removes the model
request entirely. Responses still use the existing voice, transcription,
cancellation and turn-persistence paths; the listening pause and network remain.

Matching requires the whole utterance, and every earlier message must be an
exact recognized small-talk/response pair. Translation instructions, emotional
context, task discussions, mixed requests, and truncated history fall back to
normal planning. Approval-like acknowledgements such as “yes” are not intercepted;
“thanks” qualifies only within this context guard. These intentionally fixed replies do not imply a general-purpose
answer cache or speedup for arbitrary factual questions.

## Provider references

- [Meta reasoning](https://dev.meta.ai/docs/reasoning): `minimal` is the shortest
  supported reasoning pass; higher effort increases latency. `none` is unsupported.
- [ElevenLabs latency optimization](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization):
  Flash is designed for realtime use; streaming helps time to first audio.
- [ElevenLabs measurement methodology](https://elevenlabs.io/docs/eleven-api/concepts/latency-methodology):
  advertised figures measure provider-side first audio, not full device latency.
