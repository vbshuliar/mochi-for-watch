# Mochi artwork and animation

The owner selected the simple sage plush head on 29 October 2026 and named it Mochi. It has no tuft, stitches, ears, hood or inset face.

## Provenance

The concept was generated with the built-in image tool from a written brief describing a sage short-pile plush squircle, head only, small dark eyes and a curved smile. The owner supplied that generated concept as the implementation reference. A transparent portrait was produced by removing the background; the blank animation plate was derived from that portrait by removing only eyes and mouth. No third-party character image was supplied to these generation/edit calls. This documents the process and is not a trademark-clearance claim.

`mochi-portrait.png` is the static reference. `mochi-face-plate.png` is the blank surface for coded expressions. Runtime copies are in website assets and the native Mochi image set. Original project rights in these files are offered under the Apache-2.0 project licence; no exclusive ownership of AI-generated material is promised.

## Native flat-color treatment — 3 November 2026

At the owner's request, the native renderer now draws an original Bézier body in `native/Shared/MochiView.swift` rather than sampling the plush bitmap. Two solid acid-lime fills (#D4F45C and #B7D843), brightened at the owner’s request, preserve the rounded silhouette with a broad lower shaded edge; the Watch canvas is muted dark sage (#303B38). The existing animated eyes, mouth, motion and phone indicator remain code-drawn. Website/browser artwork and the reference portrait retain their previous treatment.

This geometry was authored directly for the project using its existing original silhouette as reference, with no third-party artwork. Project-held rights are distributed under Apache-2.0. Two attempted built-in image-tool edits produced invalid transparency and were discarded; neither generated output is used or committed.

## Animation contract

Use a 1000 × 1000 reference canvas. Eye centres are (335, 487) and (665, 487), neutral radii approximately 39. Mouth baseline is y=548; multiply the state-driven width by 1.25. Preserve blinking, gaze, speaking, joy, sleep, pose blending and reduced motion. Never draw animated features over the static portrait: use the blank plate.

## Website screenshot

`mochi-website-capture.png` is a direct browser screenshot of the deployed website on 30 October 2026. It shows the actual Mochi face plate, coded eyes and mouth, and tap-to-talk interface rendered by the website. No generative retouching was applied. The surrounding watch hardware is the project-generated illustration documented in [the watch asset provenance](../../website/IMAGE-PROMPT.md); this is not a photograph of a physical device or evidence of device testing.

The README uses `mochi-website-cutout.png`, derived from this screenshot with the built-in image editing tool on 30 October 2026 to remove the outer background and clean the silhouette. It preserves the website composition and interface, but is an edited cutout rather than an unretouched screenshot. The original capture remains available for comparison.
