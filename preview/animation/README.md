# Character animation lab

Open `/preview/animation/` using the local server described in the parent README. This is a separate interactive design prototype, not the watchOS implementation.

## States and interactions

- Awake: gentle breathing, occasional eye blinks, centred gaze.
- Sleep/disconnected: closed eyes, relaxed tilted pose and slow breathing.
- Wake: tap the head to open its eyes and stretch, then return to awake. Waking does not restore connectivity; Reconnect does.
- Listen: attentive tilt, wider eyes and subtle response to simulated voice level.
- Think: upward gaze, narrowed eyes and contemplative tilt.
- Search: gaze moves between five directions with interpolation.
- Speak: mouth and head follow a synthetic speech rhythm; slider sets amplitude.
- Celebrate: happy squint, wider smile and one small hop.

Buttons may interrupt any pose. Play conversation sequences awake → listen → think → search → speak → celebrate → awake. Manual state selection cancels playback. Motion off and system Reduced Motion suppress decorative movement. No microphone, audio output, model, Calendar or network connectivity is used; connection status is simulated.

## Animation decision

Use a coded face on a persistent plush head image. SVG eyes, eyelids, mouth and gaze are interpolated independently; transitions start from the current pose rather than restarting a clip. The image remains visible while blinking. This fixes the earlier prototype's full-image opacity swapping.

For this interactive character, a coded rig is easier to interrupt and adapt to live voice amplitude than a set of videos. Videos can offer richer fur and lighting, but arbitrary transitions require matching poses and lighting, clip buffering and careful crossfades. Native watchOS rendering and performance still need validation on the Apple Watch SE 2. A future SwiftUI/Canvas rig can use the same state/pose model; this HTML is the visual reference.

## Asset provenance

The active renderer uses `../../docs/design/mochi-face-plate.png`, a transparent, featureless animation plate derived from the user-selected Mochi concept. See [Mochi asset provenance](../../docs/design/mochi.md). Earlier Mochi studies are historical and are not the active character.

Editing brief: preserve the fluffy cream head silhouette, peach face panel, rosy cheeks, lighting and transparency; remove eyes and mouth to provide a clean face plate for independently coded animated features. Use the existing head as the image reference. The eyes, glints, eyelids and mouth are drawn by the page, not baked into this plate.

## Validation

JavaScript syntax checked with `node --check`. Browser review covers rendered artwork, sleep, tap-to-wake with offline status preserved, state controls and interrupted conversation playback. Real audio responsiveness and native battery/rendering performance remain untested.

## Expression refinement — 26 October 2026

Speaking now uses a single morphing mouth contour rather than a smile plus a separate oval. Alternating vowel widths, syllable pulses and phrase pauses coordinate with brow lifts and head emphasis. This is synthetic speech animation, not phoneme-aligned lip sync. Thinking cycles through four held poses: wondering, weighing an alternative, concentration, and recognition. State-driven gaze eases faster than head movement; the browser preview adds gentle mouse-following eye movement, while native Watch gaze remains state-driven. Independent brow heights and eye openness add asymmetry; listening adds small acknowledgment nods. Curious and surprised states extend the expression palette. Celebration uses upturned closed-eye arcs. Tapping an awake head celebrates; tapping a sleeping head wakes it.

Voice energy controls simulated speech amplitude. Expressiveness adjusts gaze travel, tilt and brow emphasis. Both are preview controls. Reduced Motion freezes cyclic speech shapes and decorative gestures while retaining readable state changes. The same plush plate stays visible throughout.

## Watch-first interaction and motion passes

The watch viewport now contains only the head and one live status line. On load Mochi sleeps with “tap on me to wake up”. Tap → wake → Listening… automatically. Tap again to finish the simulated utterance → Thinking… → Looking into it… → Speaking… → All done! → Listening…. Tapping during a response interrupts it and returns to listening. The separate side panel is a design workbench and is not part of the watch UI. No microphone or generated speech is connected yet. Disconnected taps show “No connection”; reconnect explicitly restores the simulated flow.

Three refinement passes: (1) watch-sized composition and tap state flow; (2) authored 8.4-second speech sequence with eased vowel shapes, closures, phrase rests and coordinated emphasis instead of free-running mouth pulses; (3) critically damped head movement that preserves velocity across interruptions, faster facial articulation, clipped tongue detail and a dedicated confused expression. The plush base remains continuously visible. Browser visual review checks sleep, wake/listen and response states. These are design iterations, not measured native Watch performance.

## Open-mouth reference refinement

The user's Mochi reference establishes a wide smiling upper edge, rounded lower mouth, dark warm interior and a soft pink tongue at the bottom. The animated contour now follows that shape, with the tongue clipped inside the mouth and smoothly revealed as it opens. The Big smile control holds an open expression for inspection; speaking uses the same geometry throughout its changing articulation.

## Native-pixel renderer

The visible watch surface is now Canvas 2D at a fixed SE 2 resolution. Choose 40 mm (324 × 394) or 44 mm (368 × 448), then Native pixels or 2× inspection. Zoom changes display size only, not the render buffer. Eyes use a single filled contour per eye, including closed expressions; no layered eyelid crossfade. Research, sources and accuracy limits.

Validation: all 13 states produce finite path geometry in a renderer smoke check; both framebuffer sizes and DPR-aware native-pixel sizing checked. Browser review covers closed sleeping/happy eyes, case-size switching and native-pixel display.

Target hardware is now confirmed: Apple Watch SE 2, 44 mm only (368 × 448 pixels). The size selector and 40 mm preset have been removed; display zoom remains available. This supersedes earlier dual-size preview notes.

## Workflow demo expansion

The workbench now includes 26 states grouped into Conversation, Doing work, Emotions & reactions, and Recovery. Four stories cover scheduling, research, failed-save recovery and clarification. Scheduling stops for explicit approval; cancelling or choosing another state clears pending story timers. The head gives immediate press feedback. A bounded, clearable in-memory event log records state transitions and simulated actions outside the watch viewport.

Run `node preview/animation/check.cjs` from the repository root to check approval boundaries, cancellation, recovery, clarification, all state geometry, log bounds, pixel dimensions and reduced motion. See workflow research and state map.

Success reactions settle back into neutral idle after 2.4 seconds, with the status returning to “tap to talk”. Starting another interaction cancels the pending return so it cannot interrupt listening or a new task. The result remains in the event log.

All six emotion-library reactions (confused, curious, surprised, delighted, loved and happy) now return to neutral idle automatically after 2.4–4.4 seconds. Eyes, gaze, brows, mouth and head ease back together through the shared pose renderer. Task states such as clarification, approval, listening and thinking remain active until resolved; sleep/offline remain sleepy. Compliment hearts fade before returning to idle, rather than starting listening automatically.

Idle includes unevenly spaced sideways/upward glances, gaze-led head tilts and small smiles between quiet pauses, alongside natural blinking and breathing. The 32-second gesture sequence mirrors direction on alternate cycles. Gestures never change the idle status or block tapping; Motion off and Reduced Motion restore a still neutral pose.

Listening displays nine rounded audio bars below the head and above the status line in the native pixel buffer. Voice energy controls their simulated amplitude; zero energy rests at baseline and Reduced Motion keeps bars still. Listening reserves extra head/text clearance. The main storyboard already includes listening bars. Neither preview records microphone input; native implementation must drive the envelope from actual microphone levels.

### Live microphone update

The animation lab now replaces listening text with nine microphone-driven bars in the status-line position. Web Audio measures RMS and frequency bands locally, with a noise floor and smoothing; no timed synthetic waveform is used. Permission pending/denied states show honest text and a retry control. Leaving listening, hiding the page or navigating away stops microphone tracks. No audio is recorded, uploaded or transcribed here; task stories remain simulated. The voice slider controls simulated speaking only. Reduced Motion limits bar travel while retaining input feedback. This supersedes earlier simulated-listening descriptions. Verified with `node --test preview/animation/microphone-check.cjs` (input, silence, permission denial and late-grant cleanup); physical microphone response requires browser permission and a user voice test.

### Listening halo and continuous layout

The live listening bars have been replaced by a soft blue/lilac halo with faint wave contours behind the head. Measured microphone amplitude drives the glow intensity and expansion; silence retains only a faint listening indicator. The glow eases in/out independently of microphone cleanup, and Reduced Motion limits its expansion. The head now shares identical base position and size in every state, eliminating the previous listening layout jump; the existing damped pose transition preserves head velocity. Listening remains free of status text when the microphone is active.

Listening now retains “listening…” beneath the head. A wider radial glow originates at the artwork’s transformed center, and microphone-triggered wavefronts expand from that center toward the display edges. Waves are emitted only with measured input; Reduced Motion uses the restrained halo without travelling rings.

Latest listening direction: no bars, glow or waves. Keep “listening…” beneath the head. Actual local microphone volume increases head size smoothly from its normal scale up to 12% larger; silence returns it to normal through the existing damped head motion. Reduced Motion suppresses this scaling. This supersedes previous listening visualizer directions.

### Live conversation reactions

In the emulator, direct affection triggers the loved pose before reply playback. Hearts use an independent, one-shot clock: they float and fade once, without restarting when speech begins. Other conversational reactions use local English cues from the user message and final reply, with neutral as the default. After speech, the head and expression ease into idle over 1.4 seconds; the mouth closes over 0.4 seconds and idle glances wait for the settling motion. Reduced-motion preferences remain respected.

Mouse movement in the animation lab and surrounding emulator gently offsets the eyes toward the cursor. Travel is bounded and eased; leaving the page or losing focus releases attention. Sleeping/offline faces, touch input, and Reduced Motion do not follow the pointer.
