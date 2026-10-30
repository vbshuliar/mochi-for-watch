# Streamed replies, cancellation and local commands

Implemented and checked 27 October 2026.

## Pipeline

`POST /v1/sessions/:id/stream` accepts the same text/request ID as `/turns` and returns newline-delimited JSON: cumulative `text`, a validated `result`, or a safe `error`. Meta SSE deltas are decoded across byte boundaries. Only a reply whose prefix identifies `kind: reply` and then `text` is eligible for early speech; action fields and clarification objects are not streamed to speech. Full schema validation remains mandatory before any tool operation or persisted result.

The emulator splits reply text at sentence boundaries, prefetches Jessica MP3 clips and plays them sequentially. Thinking changes to speaking only when actual playback starts. Speaking remains continuous across clip boundaries; the face returns to idle after the final clip. Short one-sentence responses may not benefit much because they have no earlier complete sentence. Clips may have audible prosody changes; this is sentence-level synthesis, not ElevenLabs byte-stream audio or phoneme-level lip sync.

The gateway forwards response chunks without buffering the entire reply and propagates browser disconnection to its upstream request. Fetch deadlines remain bounded. Provider stream frames, total reply size, speech queues and transport buffering are bounded.

A partial conversational sentence can have been heard if the provider later fails validation or the connection breaks. The UI reports failure and does not perform an action. This is an inherent early-output tradeoff; do not treat partial speech as a task receipt.

## Proper cancellation

`POST /v1/sessions/:id/turns/:requestId/cancel` cancels that request only. It aborts in-flight Meta requests, applicable Calendar reads and pending speech synthesis when the browser drops the speech request. The server waits for the turn to unwind, releases its session lock, and does not persist cancelled conversation results. A cancellation arriving before dispatch creates a request-ID tombstone, preventing a late request from starting. A completed turn reports completed instead of pretending it was undone.

The client aborts the old stream immediately and awaits cancellation acknowledgement before submitting the next turn. Old response callbacks still lose ownership as a second line of defence. Calendar confirmation/write endpoints are outside this cancellation route: an approved write must still be verified or recovered, never described as undone by interrupting Mochi.

A cancelled partial answer is not added to conversation history. “Continue” after interruption may therefore need clarification; only completed turns are durable context. Token-refresh work can finish independently, but cancelled reads cannot proceed to publish a turn result.

## Local commands

Exact utterances `repeat that`, `say that again`, `repeat your last reply/answer`, `stop talking`, `stop speaking`, and `be quiet` are handled locally. Repetition uses the last completed reply, without asking Meta to regenerate it. Speech synthesis may still call ElevenLabs; microphone input still uses transcription.

No generic greeting cache, canned factual answers or local “yes” approval path is used. Time-sensitive questions and conversational follow-ups retain Meta context. “Cancel my meeting” must never be mistaken for a playback command.

## Verification and measurements

- Tests cover escaped partial JSON, incremental SSE boundaries, truncation, authenticated stream routes, cancel-before-start, provider abort, lock release, no cancelled history, completed-turn protection, ordered sentence playback and narrow local intent matching.
- A live three-sentence request through the gateway produced first text at 3573 ms, first sentence at 3594 ms and a complete reply at 3672 ms. First-sentence MP3 preparation completed at 3996 ms from request start. This demonstrates transport streaming and overlap, not a guaranteed speedup: initial Meta reasoning still dominates this sample.
- A real Meta request cancelled 350 ms after submission acknowledged cancellation in 10 ms. Test sessions were removed afterward; no Calendar writes occurred.

Primary references: [Meta streaming](https://dev.meta.ai/docs/cookbook/streaming-responses), [Meta chat protocol](https://dev.meta.ai/docs/protocols/chat-completions), [ElevenLabs speech and continuity parameters](https://elevenlabs.io/docs/api-reference/text-to-speech/stream).

Run the backend and emulator test suites plus the renderer check. Native watch audio sequencing, real speech endpointing, speaker prosody and network variability still need hardware testing.
