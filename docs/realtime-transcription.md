# Live microphone transcription

Implemented 27 October 2026 for the browser emulator.

## Flow

Tap Mochi → microphone chunks → same-origin WebSocket gateway → authenticated backend → Meta realtime ASR. Meta receives mono signed 16-bit little-endian PCM at 24 kHz, `PUSH_TO_TALK`, and cumulative partial transcripts. The API key appears only in the server-to-Meta handshake.

The recorder emits chunks while capturing. A stateful resampler preserves sample counts across chunk boundaries if the browser chooses another rate. Audio captured during connection setup is buffered within a fixed limit. Partial text is logged as it arrives, while the watch retains its listening caption.

The existing silence detector (1.1 seconds) or a second tap finishes recording. After the worklet flushes its last chunk, the client sends `end`; the backend maps it to Meta's `endStream`. Only a final transcript is sent to the existing agent turn endpoint. Partial text never creates a proposal or executes a tool. Calendar confirmations remain unchanged.

## Recovery and limits

- Original audio remains in browser memory during the turn for a logged upload fallback. It is not written to disk.
- Failed streams use the existing WAV transcription endpoint once the user finishes. No agent turn is submitted from a partial transcript.
- Closing/hiding the page cancels pending recording/transcription. Audio already streamed may already have reached Meta; cancellation cannot retract it.
- Gateway verifies the exact browser Origin and Host; it injects the local backend bearer token. Foreign/missing origins are rejected.
- Backend requires bearer authentication, permits at most two simultaneous streams, enforces 64 KiB messages, 60 seconds of PCM, bounded socket queues, handshake/finalization deadlines, and disconnect cleanup.
- A ten-second final-transcript timeout triggers the existing recording fallback; degraded connections can therefore remain slower than normal.

## Verification

29 backend tests and 14 audio/playback/client tests pass; TypeScript build and formatting checks pass. Tests cover auth, PCM resampling, partial/final distinction, stopping before readiness, cancellation, disconnects, and speech playback. Live gateway checks reject foreign and missing browser origins.

A prerecorded synthetic greeting was paced at normal speech speed through the actual gateway and Meta service. The first partial arrived while audio was still sending; the final transcript arrived 199 ms after the last audio chunk. A separate browser test using the actual RealtimeTranscriber returned the final transcript after 219 ms. These are individual synthetic samples, not production latency percentiles or microphone/hardware measurements.

The silence detector, Meta answer generation and ElevenLabs voice synthesis still contribute to total response latency. The change removes the need to start transcription only after recording ends; it does not promise instantaneous answers.

Reference: https://dev.meta.ai/docs/speech-to-text
