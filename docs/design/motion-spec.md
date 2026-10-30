# Character motion — required app behaviour

Updated: 26 October 2026. User requirement: the mascot must be animated, responsive and expressive in the app, with motion demonstrated in Figma before implementation. Static artwork alone does not satisfy the requirement.

## Implemented in Figma

The existing Milo prototype start (`4:60`) now contains a four-second native motion timeline:

- Head (`4:65`) scales from 1 to 1.035 and back, lifting 2 pt at the midpoint for breathing.
- A transparent closed-eye head layer (`16:35`) crossfades briefly over the open head at 2.16–2.30 seconds; eyes reopen by 2.36 seconds.
- Text and controls stay stationary.

The ordinary design canvas shows a resting frame. Use Figma's timeline playback or the exported video to inspect the motion. Existing clickable prototype links remain as before.

## Pending Figma work

Figma's Starter-plan MCP call limit rejected the next edit before it was applied. Remaining work:

- Repeat the idle breath/blink while preserving immediate access to the talk button.
- Listening: attentive lean/scale, blinking and waveform response (simulated audio in Figma).
- Thinking: gentle head tilt and clear processing feedback.
- Speaking: subtle pulse timed to simulated speech; a stop control. This is not phoneme-level lip sync.
- Success: one short bounce, then settle.
- Error: small concerned tilt, clear error message, no success gesture.
- Apply motion to the optional Pip preview and record motion checks for each state.

Do not claim the remaining motion is implemented. Continue in file `zJggHgjWkphyhlGaV8mmGE` with session `11c5ee89-f412-45fe-accb-763d54d7b833` when file-edit access is available. Existing prototype IDs and asset layers should be inspected before resuming; do not duplicate the idle animation.

## App behaviour and acceptance criteria

These are required future implementation behaviours; no app code exists yet.

| State | Required behaviour | Trigger |
|---|---|---|
| Idle | Gentle breathing; intermittent natural blink | App active, no task |
| Listening | Immediate attentive reaction; waveform/head response | Actual microphone state and smoothed audio level |
| Thinking | Subtle deliberate tilt/motion; processing indicator | Backend request pending |
| Speaking | Soft speech pulse and visible stop control | Actual speech playback activity; stop cancels playback |
| Approval | Calm settled character; stable readable action details | A concrete action awaits approval |
| Success | Brief celebratory bounce then settle | Confirmed external-service success only |
| Error | Concerned reaction and retry; no celebratory motion | Actual failed operation |

- State transitions must remain responsive to taps, cancellation and interruptions; animation must never block controls or imply success before confirmation.
- Prototype timing is an illustration, not a fixed runtime sequence. The app follows real microphone, playback and task states.
- Respect Reduce Motion with static or gentle opacity feedback; do not require animation to understand state.
- Pause decorative loops when inactive/offscreen. Measure frame smoothness and battery behaviour on the user's Watch SE 2.
- Use a reusable motion/state controller across preconfigured bots; keep text and controls stable during character transforms.
- Review generated open/closed image alignment at watch size. Consider a layered facial rig for richer expressions later; full mouth/lip animation is not currently implemented.

## Blink asset generation prompt

Create the closed-eye blink frame of this EXACT head-only plush mascot. Change ONLY both eyes: replace the open black eyes with two gently curved closed eyelids, like a natural happy blink. Preserve pixel alignment, head size, face position, fur silhouette, lighting, mouth, cheeks, framing and transparent background as closely as possible. No body. Do not redesign or change expression beyond eyelids. This will alternate with the original image for a brief blink animation.

## Local prototype update

The [HTML playground](../../preview/index.html) now demonstrates continuous blinking/breathing, listening waveform and attentive motion, thinking tilt, speech pulse, success bounce and error response. These are implemented in the local preview, not the native app or the quota-blocked Figma file. Browser timers simulate service events; no microphone or external account is accessed.

## Latest approved direction — watch surface and tap flow (26 October 2026)

The watch screen contains only the plush head and one short status line below it. No waveform, connection badge, state label, extra instructions or on-screen buttons. Desktop lab controls remain outside the watch frame.

Start sleeping: “tap on me to wake up”. Tap the head to wake; transition automatically to “Listening…”. In the HTML prototype a second tap ends simulated input, then runs “Thinking…” → “Looking into it…” → “Speaking…” → “All done!” → “Listening…”. A tap during a response interrupts it and returns to listening. Actual voice activity detection and audio-synchronised speech remain future app work. Offline interaction must not imply that microphone or model services are working.

Keep the blank plush plate continuously visible. Facial animation uses independently blended eyes, lids, brows and a single mouth contour. Speaking uses shaped vowels, mouth closures and phrase rests; head emphasis follows phrase accents, not every syllable. Head movement uses critically damped interpolation so interruptions preserve motion continuity. Gaze is state-driven, never pointer-driven. Include curious/confused expressions, and respect Reduced Motion.

### Compliment / kindness reaction

When the user says something kind to Mochi, show a short appreciative expression: happy eyelids, a warm smile, gentle head tilt and three red hearts floating beside the head. Fade the hearts away and return to listening after about 4.4 seconds. Tapping interrupts immediately. Reduced Motion keeps the hearts stationary. The local lab's Compliment button simulates this event; real speech intent detection is not connected yet.

### Watch microcopy casing

Start status and conversational lines with lowercase for a soft, playful voice. Preserve meaningful capitals such as Mochi, Google Calendar, API and the pronoun I. Author copy with this convention rather than applying blanket lowercase conversion, so names and acronyms remain correct. This preference applies to the watch experience, not necessarily the external design-workbench controls.

### Confirmed target hardware

The user confirmed Apple Watch SE 2, 44 mm. Use a 368 × 448 pixel preview buffer; remove the 40 mm preset and size selector. Keep native-pixel and inspection zoom controls.

Offline uses the exact sleeping pose and breathing loop (fully closed eyes, relaxed tilt), with no automatic blinks. Keep the offline/reconnect status text distinct from ordinary sleep.

## Listening audio bars

While the user speaks and Mochi listens, display a compact rounded-bar audio visualizer below the head, above the lowercase status. Drive amplitude from real microphone levels in the native app; settle to small bars during silence, and remove it on leaving listening. Keep head and status clear of the visualizer. Browser previews currently simulate input; they do not record audio. Respect Reduced Motion.

Update: in the animation lab, live input bars now replace the listening status text at the same vertical position. Microphone analysis is local only. Permission errors show text instead of fake bars. The main storyboard remains a simulated visual reference.

Latest direction: replace listening bars with a soft microphone-reactive glow and wave contours behind the head. Keep identical head layout across states; use continuous damped pose transitions and fade the halo on entry/exit. No synthetic audio activity.

Latest listening direction: no bars, glow or waves. Keep “listening…” beneath the head. Actual local microphone volume increases head size smoothly from its normal scale up to 12% larger; silence returns it to normal through the existing damped head motion. Reduced Motion suppresses this scaling. This supersedes previous listening visualizer directions.
