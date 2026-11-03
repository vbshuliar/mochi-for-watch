# Mochi artwork and animation

## Current appearance — 3 November 2026

Mochi is a smooth acid-lime head on a black Watch canvas. The base colour is #D4F45C, with a pale upper-left highlight and soft olive-lime shading around the sides. There is no grain, fur, separate bottom rim, tuft, ears or inset face. Two uninterrupted convex lower arcs keep the silhouette rounded without cheek seams.

The canonical geometry, colour gradients, eyes and mouth are in `native/Shared/MochiView.swift`. Both the live character and asset exporter call `MochiView.drawHead`; icons and website artwork are not separate redraws.

Run `sh native/scripts/render-artwork.sh` to regenerate the 1024 × 1024 assets:

- `mochi-portrait.png` and `website/dist/assets/mochi.png`: transparent smiling character for logos and previews.
- `mochi-face-plate.png`, `website/dist/assets/mochi-face.png` and the native Mochi image set: transparent blank head for animated facial features.
- Native `AppIcon.appiconset/icon.png`: smiling character on an opaque black background, shared by iPhone and Watch.

Native motion simulates three-axis rotation with face projection, near/far eye scaling and shifting highlights. Speaking mouth movement follows playback energy; Reduced Motion disables decorative movement. Browser previews use the same current artwork with their existing preview animation and interaction models.

## Provenance and redistribution

The earlier sage plush concept was generated for this project on 29 October 2026. It informed the character identity but is no longer used in current assets. The current Bézier geometry and gradient treatment were authored in code for the project at the owner's direction, with no third-party character artwork. Project-held rights in the renderer and its exported assets are distributed under Apache-2.0. No exclusive rights in earlier AI-generated concepts are claimed.

## Animation contract

Use a 1000 × 1000 reference canvas. Eye centres are (335, 487) and (665, 487), neutral radii approximately 39. Mouth baseline is y=548; multiply the state-driven width by 1.25. Preserve blinking, gaze, speaking, joy, sleep, pose blending and reduced motion. Never draw animated features over the static portrait: use the blank plate.

## Website screenshots

`mochi-website-capture.jpg` is a direct browser capture of the updated website, and `mochi-watch-preview.jpg` is a browser-cropped capture of its Watch illustration, both captured on 3 November 2026. The README uses the cropped capture. No generative retouching or background removal is applied. These show a website preview, not physical-device acceptance.

The surrounding Watch hardware remains the project-generated illustration documented in [the watch asset provenance](../../website/IMAGE-PROMPT.md). It contains no character artwork; the current Mochi UI is rendered over it by the website.
